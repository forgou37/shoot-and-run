/**
 * Authoritative host session (spec 008, Phase 009 / T9.2). Owns the canonical
 * sim. Each tick it gathers the buffered client inputs for that tick (filling
 * any it has not received with repeat-last — a deterministic policy), steps the
 * sim, and broadcasts the authoritative inputs for that tick plus a periodic
 * full snapshot. It acks each received input with its current tick so clients
 * can estimate the clock (T9.3).
 *
 * The "input-delay window" lives on the client (T9.3/T9.4): clients send inputs
 * tagged for a near-future tick so they land before the host commits it. The
 * host never stalls — anything missing is repeat-last-filled, and clients
 * reconcile via the authoritative broadcast (rollback, T9.4).
 *
 * Pure/headless: the host is driven by an explicit `step()` (one sim tick each),
 * and emits outbound messages through the injected `send` callback — the caller
 * wires that to a transport. No timers, no DOM.
 */
import {
  createSim,
  emptyInput,
  type ArenaData,
  type PlayerInput,
  type PlayerSlotConfig,
  type Sim,
  type SimEvent,
  type SimSnapshot,
  type Tuning
} from "@shoot-and-run/sim";
import { encodeMessage } from "./codec";
import type { NetMessage } from "./protocol";
import type { HostSession } from "./session";

/** Which player slot a connected client drives. */
export interface HostClient {
  id: string;
  slot: number;
}

export interface HostSessionConfig {
  arena: ArenaData;
  tuning: Tuning;
  players: PlayerSlotConfig[];
  seed: number;
  friendlyFire?: boolean;
  clients: HostClient[];
  /** Broadcast a full snapshot every this many committed ticks (>= 1). */
  snapshotIntervalTicks: number;
  /** Emit one already-encoded datagram to one client (wire to a transport). */
  send: (clientId: string, data: Uint8Array) => void;
}

export interface HostSessionHandle extends HostSession {
  /** Deep snapshot of the canonical state (for tests / convergence checks). */
  snapshot(): SimSnapshot;
  /** Diagnostics: inputs that arrived for an already-committed tick. */
  readonly lateDropped: number;
}

export function createHostSession(config: HostSessionConfig): HostSessionHandle {
  if (config.snapshotIntervalTicks < 1) {
    throw new Error("snapshotIntervalTicks must be >= 1");
  }
  const sim: Sim = createSim({
    arena: config.arena,
    tuning: config.tuning,
    players: config.players,
    seed: config.seed,
    friendlyFire: config.friendlyFire
  });

  const slotByClient = new Map<string, number>(config.clients.map((c) => [c.id, c.slot]));
  const playerCount = config.players.length;
  /** tick -> per-slot received input (undefined slot = not yet received). */
  const buffer = new Map<number, (PlayerInput | undefined)[]>();
  /** Last input actually committed per slot — the repeat-last source. */
  const lastInput: PlayerInput[] = config.players.map(() => emptyInput());
  let committedTick = 0;
  let lateDropped = 0;
  /** Canonical event log for the current match — broadcast once at match_ended
   *  so every client renders identical post-match awards (spec 016). */
  let matchEvents: SimEvent[] = [];

  function broadcast(message: NetMessage): void {
    const data = encodeMessage(message); // encode once, send the same bytes to every client
    for (const c of config.clients) config.send(c.id, data);
  }

  return {
    get tick(): number {
      return committedTick;
    },
    get lateDropped(): number {
      return lateDropped;
    },

    receiveInput(clientId: string, tick: number, input: PlayerInput): void {
      const slot = slotByClient.get(clientId);
      if (slot === undefined) return; // unknown client
      if (tick < committedTick) {
        lateDropped++; // too late — this tick is already authoritative
      } else {
        let row = buffer.get(tick);
        if (!row) {
          row = new Array<PlayerInput | undefined>(playerCount).fill(undefined);
          buffer.set(tick, row);
        }
        row[slot] = input;
      }
      // Echo the host's current tick + the acked input's tick so the client can
      // pair this ack with its send and estimate the host clock + RTT.
      config.send(clientId, encodeMessage({ type: "ack", tick: committedTick, inputTick: tick }));
    },

    step(): void {
      const t = committedTick;
      const row = buffer.get(t);
      const inputs: PlayerInput[] = [];
      for (let slot = 0; slot < playerCount; slot++) {
        const used = row?.[slot] ?? lastInput[slot]!; // repeat-last fill
        inputs.push(used);
        lastInput[slot] = used;
      }
      const events = sim.step(inputs);
      broadcast({ type: "authoritative", tick: t, inputs });
      if (t % config.snapshotIntervalTicks === 0) {
        broadcast({ type: "snapshot", snapshot: sim.snapshot() });
      }
      // Accumulate the canonical (gap-free) event log; on match end broadcast it
      // for the post-match awards screen, then reset for the next match (the host
      // sim loops into a fresh match after the restart delay).
      for (const e of events) matchEvents.push(e);
      if (events.some((e) => e.type === "match_ended")) {
        broadcast({ type: "match-stats", events: matchEvents });
        matchEvents = [];
      }
      buffer.delete(t);
      committedTick = t + 1;
    },

    snapshot(): SimSnapshot {
      return sim.snapshot();
    }
  };
}
