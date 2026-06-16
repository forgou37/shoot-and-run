/**
 * Host runtime (spec 010, T10.2; join handshake spec 013, T13.1). Wraps a
 * `HostSession` with the connection management a real Host needs but the 009
 * session loop deliberately left out: accept inbound connections from a
 * `TransportServer`, admit each as a player slot, send it the `HelloMessage`
 * handshake, decode its inbound inputs into `HostSession.receiveInput`, and gate
 * the authoritative loop on a simple start policy.
 *
 * Handshake (T13.1): the client sends a `JoinMessage` FIRST; the host reads it
 * before assigning a slot, so it can admit by intent (player now; spectator /
 * reconnect-token land in T13.2/T13.3) and refuse a drifted-build client with a
 * typed `reject` — without wasting a slot on a doomed connection. A pre-013
 * client that never sends `join` would otherwise hang waiting for `hello`, so a
 * tick-driven **join-grace** falls back to a legacy `hello` after
 * `joinGraceTicks` (then the client's own version check surfaces any drift). The
 * grace is counted off `step()`, which the caller already calls every tick — no
 * wall-clock timer, so the host stays pure and deterministic.
 *
 * v1 start policy: **wait for all expected players, then run from tick 0.** While
 * waiting, `step()` is a no-op (but still ages pending joins); once every expected
 * player has been admitted it steps the canonical sim and broadcasts.
 *
 * Pure and transport-agnostic: it is driven by an explicit `step()` (one sim tick)
 * — the wall clock (a Node interval / the browser accumulator) lives in the
 * caller. The loopback exercises it headlessly; the dev host wires it to `ws`.
 */
import type {
  ArenaData,
  PlayerSlotConfig,
  SimSnapshot,
  Tuning
} from "@shoot-and-run/sim";
import { decodeMessage, encodeMessage } from "./codec";
import { createHostSession, type HostSessionHandle } from "./host";
import type { Transport, TransportServer } from "./transport";
import { computeContentVersion } from "./version";

export interface HostRuntimeConfig {
  /** Listener that yields one Transport per inbound client connection. */
  server: TransportServer;
  arena: ArenaData;
  tuning: Tuning;
  /** Player roster in slot order; `expectedClients` defaults to its length. */
  players: PlayerSlotConfig[];
  seed: number;
  friendlyFire?: boolean;
  /** Broadcast a full snapshot every this many committed ticks (>= 1). */
  snapshotIntervalTicks: number;
  /** Sent in each hello so clients load the matching local arena. */
  arenaId: string;
  /** Start the loop once this many clients have connected (default players.length). */
  expectedClients?: number;
  /**
   * Ticks to wait for a connection's `join` before falling back to a legacy
   * `hello` (T13.1) — rescues a pre-013 client that never sends `join`. Default
   * ~3 s at 60 Hz; a real `join` arrives within one RTT, long before this.
   */
  joinGraceTicks?: number;
}

export interface HostRuntimeHandle {
  /** The tick the canonical sim has reached. */
  readonly tick: number;
  /** True once all expected clients have connected (the loop is running). */
  readonly ready: boolean;
  /** Clients currently connected. */
  readonly connectedCount: number;
  /** Inputs that arrived for an already-committed tick (diagnostics). */
  readonly lateDropped: number;
  /** Datagrams from clients that failed to decode (diagnostics). */
  readonly malformed: number;
  /**
   * Advance the canonical sim one tick and broadcast, IFF ready. Returns whether
   * it actually stepped (false while still waiting for clients).
   */
  step(): boolean;
  /** Deep snapshot of the canonical state (tests / diagnostics). */
  snapshot(): SimSnapshot;
}

/** Default join-grace: ~3 s at 60 Hz (see HostRuntimeConfig.joinGraceTicks). */
const DEFAULT_JOIN_GRACE_TICKS = 180;

/** A connection that has not yet been admitted as a player (awaiting its join). */
interface PendingConnection {
  transport: Transport;
  state: "pending" | "admitted" | "rejected";
  ageTicks: number;
  /** Set once admitted — the HostSession client id its inputs route to. */
  clientId?: string;
}

export function createHostRuntime(config: HostRuntimeConfig): HostRuntimeHandle {
  const expected = config.expectedClients ?? config.players.length;
  const playerCount = config.players.length;
  const joinGraceTicks = config.joinGraceTicks ?? DEFAULT_JOIN_GRACE_TICKS;

  // Contract enforced loudly at init: clients are assigned slots in connection
  // order and the canonical sim addresses players by ARRAY INDEX, while the
  // client rebuilds a dense `{slot:i}` roster from `playerCount`. So the host's
  // roster must use dense, in-order slots (`players[i].slot === i`), or a client's
  // input would route to the wrong sim player. And the start gate can only ever
  // see at most `playerCount` valid connections, so `expected` must fit the roster.
  if (!Number.isInteger(expected) || expected < 1 || expected > playerCount) {
    throw new Error(`HostRuntime: expectedClients must be an integer in [1, ${String(playerCount)}]`);
  }
  config.players.forEach((p, i) => {
    if (p.slot !== i) {
      throw new Error(
        `HostRuntime: roster must use dense in-order slots — players[${String(i)}].slot=${String(p.slot)}, expected ${String(i)}`
      );
    }
  });

  /** clientId -> its transport, for the host's per-client send. */
  const transports = new Map<string, Transport>();
  /** Connections awaiting their `join` (or grace fallback). */
  const pending: PendingConnection[] = [];
  /** Players admitted so far (== the next slot to assign; only grows in v1). */
  let admittedPlayers = 0;
  let malformed = 0;
  // Content fingerprint stamped into every hello so a client on a drifted build
  // (different pinned arena/tuning) is rejected loudly instead of desyncing (S4).
  const version = computeContentVersion(config.arena, config.tuning);

  const host: HostSessionHandle = createHostSession({
    arena: config.arena,
    tuning: config.tuning,
    players: config.players,
    seed: config.seed,
    friendlyFire: config.friendlyFire,
    clients: config.players.map((p, i) => ({ id: `c${i}`, slot: p.slot })),
    snapshotIntervalTicks: config.snapshotIntervalTicks,
    send: (clientId, data) => transports.get(clientId)?.send(data)
  });

  function dropPending(conn: PendingConnection): void {
    const i = pending.indexOf(conn);
    if (i >= 0) pending.splice(i, 1);
  }

  /** Admit a connection as a player: assign the next slot, send hello, announce
   *  the lobby; returns whether it was admitted. Refuses with `reject:full` (no
   *  close — the client closes) when every slot is taken. Shared by the join path
   *  and the grace fallback. */
  function admitPlayer(conn: PendingConnection): boolean {
    if (conn.state !== "pending") return false;
    dropPending(conn);
    if (admittedPlayers >= expected) {
      conn.state = "rejected";
      conn.transport.send(encodeMessage({ type: "reject", reason: "full" }));
      return false;
    }
    const k = admittedPlayers++;
    const clientId = `c${k}`;
    conn.state = "admitted";
    conn.clientId = clientId;
    transports.set(clientId, conn.transport);
    conn.transport.send(
      encodeMessage({
        type: "hello",
        slot: config.players[k]!.slot,
        seed: config.seed,
        playerCount,
        version,
        arenaId: config.arenaId
      })
    );
    // Tell every waiting client the roster filled up ("connected / expected") so
    // the join lobby can show progress until the match starts (T11.3).
    broadcastLobby();
    return true;
  }

  function routeAdmitted(conn: PendingConnection, msg: ReturnType<typeof decodeMessage>): void {
    if (msg.type === "input") {
      host.receiveInput(conn.clientId!, msg.tick, msg.input);
    } else if (msg.type === "ping") {
      // Clock-sync probe: answer with the host's current tick so the client can
      // converge its clock before it leads (T11.2). Echo the ping id to pair it.
      conn.transport.send(encodeMessage({ type: "pong", id: msg.id, hostTick: host.tick }));
    }
    // The host originates everything else; ignore other inbound kinds.
  }

  config.server.onConnection((transport) => {
    const conn: PendingConnection = { transport, state: "pending", ageTicks: 0 };
    pending.push(conn);

    transport.onMessage((data) => {
      let msg;
      try {
        msg = decodeMessage(data);
      } catch {
        malformed++; // version/format mismatch — drop, keep serving
        return;
      }
      if (conn.state === "pending") {
        if (msg.type === "join") {
          if (msg.version !== version) {
            // Drifted build: refuse loudly, without consuming a slot. We do NOT
            // close — the client closes on `reject`, so the reason is never lost
            // to a close racing ahead of delivery.
            conn.state = "rejected";
            dropPending(conn);
            transport.send(encodeMessage({ type: "reject", reason: "version" }));
            return;
          }
          // T13.1: any valid-version join is admitted as a player. role + token
          // are decoded but not yet acted on (spectator → T13.2, reconnect → T13.3).
          admitPlayer(conn);
        } else {
          // A pre-013 client that sends input/ping before any join: admit it the
          // legacy way (player), then process this first message normally.
          if (admitPlayer(conn)) routeAdmitted(conn, msg);
        }
        return;
      }
      if (conn.state === "admitted") routeAdmitted(conn, msg);
      // rejected: ignore further traffic
    });

    transport.onClose(() => {
      if (conn.clientId) transports.delete(conn.clientId);
      conn.state = "rejected";
      dropPending(conn);
    });
  });

  function broadcastLobby(): void {
    const data = encodeMessage({ type: "lobby", connected: transports.size, expected });
    for (const t of transports.values()) t.send(data);
  }

  return {
    get tick(): number {
      return host.tick;
    },
    get ready(): boolean {
      return admittedPlayers >= expected;
    },
    get connectedCount(): number {
      return transports.size;
    },
    get lateDropped(): number {
      return host.lateDropped;
    },
    get malformed(): number {
      return malformed;
    },
    step(): boolean {
      // Age connections still awaiting their join; once past the grace, admit
      // them the legacy way so a pre-013 client can't hang waiting for hello.
      // Runs every tick (the caller calls step() unconditionally), even while the
      // start gate isn't satisfied — that's the only window a join can be pending.
      for (let i = pending.length - 1; i >= 0; i--) {
        const conn = pending[i]!;
        if (conn.state === "pending" && ++conn.ageTicks >= joinGraceTicks) admitPlayer(conn);
      }
      if (admittedPlayers < expected) return false;
      host.step();
      return true;
    },
    snapshot(): SimSnapshot {
      return host.snapshot();
    }
  };
}
