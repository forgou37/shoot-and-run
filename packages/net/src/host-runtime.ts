/**
 * Host runtime (spec 010, T10.2). Wraps a `HostSession` with the connection
 * management a real Host needs but the 009 session loop deliberately left out:
 * accept inbound connections from a `TransportServer`, assign each a slot in
 * connection order, send it the `HelloMessage` handshake, decode its inbound
 * inputs into `HostSession.receiveInput`, and gate the authoritative loop on a
 * simple start policy.
 *
 * v1 start policy: **wait for all expected clients, then run from tick 0.** While
 * waiting, `step()` is a no-op; once every expected client has connected it steps
 * the canonical sim and broadcasts. (Clients that connect early have already
 * received hello and begun predicting, so their inputs for the opening ticks are
 * buffered by the time the loop starts.)
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

export function createHostRuntime(config: HostRuntimeConfig): HostRuntimeHandle {
  const expected = config.expectedClients ?? config.players.length;
  const playerCount = config.players.length;

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
  let connections = 0;
  let malformed = 0;

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

  config.server.onConnection((transport) => {
    if (connections >= expected) {
      transport.close(); // session full — reject extras
      return;
    }
    const k = connections++;
    const clientId = `c${k}`;
    transports.set(clientId, transport);

    // Handshake: tell the client its slot + the session contract to rebuild from.
    transport.send(
      encodeMessage({
        type: "hello",
        slot: config.players[k]!.slot,
        seed: config.seed,
        playerCount,
        arenaId: config.arenaId
      })
    );

    transport.onMessage((data) => {
      let msg;
      try {
        msg = decodeMessage(data);
      } catch {
        malformed++; // version/format mismatch — drop, keep serving
        return;
      }
      if (msg.type === "input") host.receiveInput(clientId, msg.tick, msg.input);
      // The host originates everything else; ignore other inbound kinds.
    });

    transport.onClose(() => {
      transports.delete(clientId);
    });
  });

  return {
    get tick(): number {
      return host.tick;
    },
    get ready(): boolean {
      return connections >= expected;
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
      if (connections < expected) return false;
      host.step();
      return true;
    },
    snapshot(): SimSnapshot {
      return host.snapshot();
    }
  };
}
