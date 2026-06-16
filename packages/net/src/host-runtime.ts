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
 * player has connected the loop latches `started` and steps the canonical sim.
 *
 * Reconnection (T13.3): each player slot is tracked as empty/connected/reserved/
 * lost rather than a one-way counter. When a connected slot drops mid-match it
 * becomes `reserved` for `reconnectGraceTicks` (its input is repeat-last-filled
 * meanwhile); a client presenting the slot's host-issued token in a later `join`
 * reclaims it and is sent an immediate snapshot to resync. Past the grace the slot
 * goes `lost` (stays filled for the match; late/forged reclaims refused). The
 * reconnect-grace is counted off `step()`, like the join-grace — no wall clock.
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
  /**
   * Max concurrent spectators (spec 013, T13.2; from the `net` block). Spectators
   * receive the authoritative stream but take no slot and never gate the start.
   * Extra spectators are refused with `reject:full`. Default 4; 0 disables.
   */
  maxSpectators?: number;
  /**
   * Ticks a dropped player's slot is held for reconnection (spec 013, T13.3; from
   * the `net` block). Default 0 = reconnection disabled (a drop frees the slot /
   * the slot just stays filled, no token issued).
   */
  reconnectGraceTicks?: number;
  /**
   * Mint a per-slot reconnect token. Injected so `packages/net` stays free of
   * ambient randomness (the server passes a `crypto.randomUUID`-based generator;
   * tests use the deterministic default). Only called when reconnect is enabled.
   */
  generateToken?: () => string;
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
/** Default spectator cap when the caller doesn't pass one (tests). */
const DEFAULT_MAX_SPECTATORS = 4;

/** A connection awaiting admission (its join), then admitted as a player/spectator. */
interface PendingConnection {
  transport: Transport;
  state: "pending" | "admitted" | "rejected";
  ageTicks: number;
  /** What it was admitted as (set on admit). */
  role?: "player" | "spectator";
  /** Set once admitted as a player — the HostSession client id its inputs route to. */
  clientId?: string;
  /** Player slot index this connection occupies (set on player admit). */
  slotIndex?: number;
}

/** A player slot's occupancy over the match's life (spec 013, T13.3). */
interface PlayerSlot {
  /** `c${index}` — the fixed HostSession client id inputs route to. */
  clientId: string;
  index: number;
  /** Reconnect secret, minted on first admit; "" when reconnect is disabled. */
  token: string;
  /** The live transport while connected; null while reserved/lost/empty. */
  transport: Transport | null;
  state: "empty" | "connected" | "reserved" | "lost";
  /** Ticks since the slot was reserved (reconnect-grace countdown). */
  disconnectAge: number;
}

export function createHostRuntime(config: HostRuntimeConfig): HostRuntimeHandle {
  const expected = config.expectedClients ?? config.players.length;
  const playerCount = config.players.length;
  const joinGraceTicks = config.joinGraceTicks ?? DEFAULT_JOIN_GRACE_TICKS;
  const maxSpectators = config.maxSpectators ?? DEFAULT_MAX_SPECTATORS;
  const reconnectGraceTicks = config.reconnectGraceTicks ?? 0;
  let tokenCounter = 0;
  const mintToken = config.generateToken ?? ((): string => `tk${String(tokenCounter++)}`);

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

  /** clientId -> its transport, for the host's per-client send (acks). */
  const transports = new Map<string, Transport>();
  /** Admitted spectators (no slot, no ack) — broadcast targets only (T13.2). */
  const spectators = new Set<Transport>();
  /** Connections awaiting their `join` (or grace fallback). */
  const pending: PendingConnection[] = [];
  /** Per-slot occupancy (T13.3) — replaces the old monotonic admitted counter. */
  const slots: PlayerSlot[] = config.players.map((_, i) => ({
    clientId: `c${String(i)}`,
    index: i,
    token: "",
    transport: null,
    state: "empty" as const,
    disconnectAge: 0
  }));
  /** Latches true once `expected` slots have first connected — the loop then runs
   *  even while a slot is reserved/lost (its input is repeat-last-filled). */
  let started = false;
  let malformed = 0;
  // Content fingerprint stamped into every hello so a client on a drifted build
  // (different pinned arena/tuning) is rejected loudly instead of desyncing (S4).
  const version = computeContentVersion(config.arena, config.tuning);

  /** Fan a datagram out to every sink — players + spectators (T13.2). */
  function broadcastToAll(data: Uint8Array): void {
    for (const t of transports.values()) t.send(data);
    for (const t of spectators) t.send(data);
  }

  const host: HostSessionHandle = createHostSession({
    arena: config.arena,
    tuning: config.tuning,
    players: config.players,
    seed: config.seed,
    friendlyFire: config.friendlyFire,
    clients: config.players.map((p, i) => ({ id: `c${i}`, slot: p.slot })),
    snapshotIntervalTicks: config.snapshotIntervalTicks,
    send: (clientId, data) => transports.get(clientId)?.send(data),
    broadcast: broadcastToAll
  });

  function dropPending(conn: PendingConnection): void {
    const i = pending.indexOf(conn);
    if (i >= 0) pending.splice(i, 1);
  }

  function sendHello(transport: Transport, slot: PlayerSlot): void {
    transport.send(
      encodeMessage({
        type: "hello",
        slot: slot.index,
        seed: config.seed,
        playerCount,
        version,
        arenaId: config.arenaId,
        token: slot.token
      })
    );
  }

  function connectedPlayers(): number {
    return slots.reduce((n, s) => n + (s.state === "connected" ? 1 : 0), 0);
  }
  /** Latch the start once every expected slot has connected (first time only). */
  function maybeStart(): void {
    if (!started && connectedPlayers() >= expected) started = true;
  }

  /** Admit a fresh player into the first empty slot (no reconnect token). Refuses
   *  with `reject:full` (no close — the client closes) when none is free. Shared by
   *  the join path, the legacy fallback, and the join-grace. */
  function admitPlayerFresh(conn: PendingConnection): boolean {
    if (conn.state !== "pending") return false;
    dropPending(conn);
    const slot = slots.find((s) => s.state === "empty");
    if (!slot) {
      conn.state = "rejected";
      conn.transport.send(encodeMessage({ type: "reject", reason: "full" }));
      return false;
    }
    slot.state = "connected";
    slot.transport = conn.transport;
    slot.token = reconnectGraceTicks > 0 ? mintToken() : "";
    slot.disconnectAge = 0;
    conn.state = "admitted";
    conn.role = "player";
    conn.clientId = slot.clientId;
    conn.slotIndex = slot.index;
    transports.set(slot.clientId, conn.transport);
    sendHello(conn.transport, slot);
    // Tell every waiting client the roster filled up ("connected / expected") so
    // the join lobby can show progress until the match starts (T11.3).
    maybeStart();
    broadcastLobby();
    return true;
  }

  /** Reclaim a reserved slot via its host-issued token (T13.3): re-point the slot
   *  at the new transport, re-send hello (same slot + token), and immediately push
   *  a snapshot so the client resyncs to the live tick. Returns false if no
   *  reserved slot matches (expired / forged / already connected) — the caller
   *  refuses. */
  function reclaimSlot(conn: PendingConnection, token: string): boolean {
    if (token === "") return false;
    const slot = slots.find((s) => s.state === "reserved" && s.token === token);
    if (!slot) return false;
    dropPending(conn);
    slot.state = "connected";
    slot.transport = conn.transport;
    slot.disconnectAge = 0;
    conn.state = "admitted";
    conn.role = "player";
    conn.clientId = slot.clientId;
    conn.slotIndex = slot.index;
    transports.set(slot.clientId, conn.transport);
    sendHello(conn.transport, slot);
    conn.transport.send(encodeMessage({ type: "snapshot", snapshot: host.snapshot() })); // resync to live
    broadcastLobby();
    return true;
  }

  /** Admit a connection as a spectator (T13.2): no slot, never gates the start,
   *  just joins the broadcast fan-out. Refuses past the cap with `reject:full`.
   *  The hello's `slot` is a placeholder (the client knows it's a spectator and
   *  uses slot −1 locally); `playerCount` lets it build the matching confirmed sim. */
  function admitSpectator(conn: PendingConnection): void {
    if (conn.state !== "pending") return;
    dropPending(conn);
    if (spectators.size >= maxSpectators) {
      conn.state = "rejected";
      conn.transport.send(encodeMessage({ type: "reject", reason: "full" }));
      return;
    }
    conn.state = "admitted";
    conn.role = "spectator";
    spectators.add(conn.transport);
    conn.transport.send(
      encodeMessage({
        type: "hello",
        slot: 0,
        seed: config.seed,
        playerCount,
        version,
        arenaId: config.arenaId,
        token: ""
      })
    );
    broadcastLobby();
  }

  function routeAdmitted(conn: PendingConnection, msg: ReturnType<typeof decodeMessage>): void {
    if (msg.type === "ping") {
      // Clock-sync probe: answer with the host's current tick so the client can
      // converge its clock (T11.2). Spectators ping too (they have no acks), so
      // answer regardless of role. Echo the ping id to pair it.
      conn.transport.send(encodeMessage({ type: "pong", id: msg.id, hostTick: host.tick }));
    } else if (msg.type === "input" && conn.role === "player") {
      host.receiveInput(conn.clientId!, msg.tick, msg.input); // spectators send none; ignore if they do
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
          // Admit by intent: spectator (T13.2) takes no slot; a player either
          // reclaims its reserved slot via its token (T13.3) or takes a fresh one.
          if (msg.role === "spectator") {
            admitSpectator(conn);
          } else if (msg.reconnectToken) {
            // A reconnect attempt: reclaim or refuse — never silently fall back to a
            // fresh slot (the client meant its old one; a forged/expired token is
            // refused, per spec).
            if (!reclaimSlot(conn, msg.reconnectToken)) {
              conn.state = "rejected";
              dropPending(conn);
              transport.send(encodeMessage({ type: "reject", reason: "full" }));
            }
          } else {
            admitPlayerFresh(conn);
          }
        } else {
          // A pre-013 client that sends input/ping before any join: admit it the
          // legacy way (player), then process this first message normally.
          if (admitPlayerFresh(conn)) routeAdmitted(conn, msg);
        }
        return;
      }
      if (conn.state === "admitted") routeAdmitted(conn, msg);
      // rejected: ignore further traffic
    });

    transport.onClose(() => {
      spectators.delete(conn.transport);
      const slot = conn.slotIndex !== undefined ? slots[conn.slotIndex] : undefined;
      // Only act if this conn is still the slot's live transport — a reconnect may
      // have re-pointed the slot at a newer socket before this old close fires.
      if (slot && slot.transport === conn.transport) {
        slot.transport = null;
        transports.delete(slot.clientId);
        if (!started || reconnectGraceTicks === 0) {
          slot.state = "empty"; // pre-start (re-joinable) or reconnect disabled
          slot.token = "";
        } else {
          slot.state = "reserved"; // hold for a token reclaim within the grace
          slot.disconnectAge = 0;
        }
        broadcastLobby();
      }
      conn.state = "rejected";
      dropPending(conn);
    });
  });

  /** `connected` counts admitted PLAYERS only (the start gate), but the status is
   *  fanned out to spectators too so a watching tab also sees the roster fill. */
  function broadcastLobby(): void {
    broadcastToAll(encodeMessage({ type: "lobby", connected: transports.size, expected }));
  }

  return {
    get tick(): number {
      return host.tick;
    },
    get ready(): boolean {
      return started;
    },
    get connectedCount(): number {
      return connectedPlayers();
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
        if (conn.state === "pending" && ++conn.ageTicks >= joinGraceTicks) admitPlayerFresh(conn);
      }
      // Age reserved slots; past the reconnect-grace they become `lost` — no longer
      // reclaimable, but kept filled (repeat-last) for the rest of the match (T13.3).
      for (const slot of slots) {
        if (slot.state === "reserved" && ++slot.disconnectAge >= reconnectGraceTicks) slot.state = "lost";
      }
      if (!started) return false;
      host.step();
      return true;
    },
    snapshot(): SimSnapshot {
      return host.snapshot();
    }
  };
}
