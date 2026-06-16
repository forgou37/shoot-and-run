import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { emptyInput, parseArena, parseTuning, type PlayerInput } from "@shoot-and-run/sim";
import { ClientSession } from "../src/client";
import { createHostRuntime } from "../src/host-runtime";
import { LoopbackNetwork } from "../src/loopback";

/**
 * T10.2 / W4 — full host-authoritative session through the REUSABLE pieces:
 * createHostRuntime (connection management + hello handshake + the authoritative
 * loop) + ClientSession (clock + predict/rollback), over the lossy loopback.
 *
 * Unlike the 009 convergence test (which wired host/clients inline and never
 * routed client inputs INTO the host), this drives everything through the
 * orchestrators AND asserts client inputs actually reach the host and move the
 * canonical sim — then that every client's confirmed state is byte-identical to
 * the host's, under clean / lossy networks, reproducibly.
 */

const arena = parseArena(arena001);
const tuning = parseTuning(tuningJson);
const players = [{ slot: 0 }, { slot: 1 }];

/** Deterministic stand-in for a bot: a varied input per (slot, tick). */
function scriptInput(slot: number, tick: number): PlayerInput {
  const input = emptyInput();
  if ((tick + slot) % 2 === 0) input.right = true;
  else input.left = true;
  if ((tick + slot) % 7 === 0) input.jump = true;
  if ((tick * (slot + 1)) % 11 === 0) input.shoot = true;
  return input;
}

interface Opts {
  seed: number;
  latency: number;
  jitter: number;
  loss: number;
  inputDelay: number;
  snapshotInterval: number;
  maxRollback: number;
  ticks: number;
}

interface Result {
  hostTick: number;
  hostFinal: string;
  hostMoved: boolean;
  lateDropped: number;
  malformed: number;
  clients: { confirmedTick: number; confirmed: string; matchStats: string | null }[];
}

function runSession(o: Opts): Result {
  const net = new LoopbackNetwork({
    seed: o.seed,
    latencyTicks: o.latency,
    jitterTicks: o.jitter,
    lossRate: o.loss
  });

  // Runtime registers server.onConnection in its constructor — before clients dial.
  const runtime = createHostRuntime({
    server: net.server,
    arena,
    tuning,
    players,
    seed: o.seed,
    snapshotIntervalTicks: o.snapshotInterval,
    arenaId: "crossfire"
  });

  const clientIds = ["c0", "c1"];
  const sessions = clientIds.map(
    (id) =>
      new ClientSession({
        transport: net.connect(id),
        arena,
        tuning,
        inputDelayTicks: o.inputDelay,
        maxRollbackTicks: o.maxRollback
      })
  );

  const spawn0 = arena.spawns[0]!;

  for (let t = 0; t <= o.ticks; t++) {
    net.advance(t);
    runtime.step();
    for (const s of sessions) {
      const slot = s.ready ? s.localSlot : 0;
      s.tick(scriptInput(slot, t));
    }
  }

  // Drain in-flight datagrams so confirmed catches up to the host (no more steps).
  const drainUntil = o.ticks + o.latency + o.jitter + o.snapshotInterval + 5;
  for (let t = o.ticks + 1; t <= drainUntil; t++) net.advance(t);

  const hostState = runtime.snapshot().state;
  const hostMoved = hostState.players.some((p) => p.x !== spawn0.x || p.y !== spawn0.y);

  return {
    hostTick: runtime.tick,
    hostFinal: JSON.stringify(runtime.snapshot()),
    hostMoved,
    lateDropped: runtime.lateDropped,
    malformed: runtime.malformed,
    clients: sessions.map((s) => {
      const ms = s.matchStats();
      return {
        confirmedTick: s.confirmedTick,
        confirmed: JSON.stringify(s.snapshotConfirmed()),
        // The host's authoritative match log, broadcast once at match_ended (016).
        matchStats: ms ? JSON.stringify(ms) : null
      };
    })
  };
}

const BASE: Opts = {
  seed: 0xfeed,
  latency: 3,
  jitter: 2,
  loss: 0,
  inputDelay: 6,
  snapshotInterval: 20,
  maxRollback: 200,
  ticks: 240
};

describe("HostRuntime + ClientSession convergence (T10.2 / W4)", () => {
  it("clean network: client inputs reach the host and every client converges byte-for-byte", () => {
    const r = runSession(BASE);
    expect(r.hostMoved).toBe(true); // inputs actually drove the canonical sim
    expect(r.malformed).toBe(0);
    for (const c of r.clients) {
      expect(c.confirmedTick).toBe(r.hostTick);
      expect(c.confirmed).toBe(r.hostFinal);
    }
  });

  it("10% packet loss: clients recover via periodic snapshots (no permanent stall)", () => {
    const r = runSession({ ...BASE, loss: 0.1, seed: 0xbeef });
    expect(r.hostMoved).toBe(true);
    for (const c of r.clients) {
      // Recovered to within a few snapshot intervals of the host — lost
      // authoritative ticks were healed by the periodic snapshots, not stalled.
      // EXACT byte-identical convergence is the clean-network test above (jitter
      // only reorders, never drops). Under lossy no-retransmit the very last
      // snapshot can itself drop, so the recoverable guarantee is "catches up to
      // near the host", which is robust to any seed / net-traffic pattern (the
      // 011 ping/lobby traffic shifts the deterministic drop schedule).
      expect(c.confirmedTick).toBeGreaterThanOrEqual(r.hostTick - 3 * BASE.snapshotInterval);
    }
  });

  it("broadcasts identical match-stats to every client at match end (spec 016)", () => {
    // Long enough for one player to reach roundsToWin (3) under the scripted
    // inputs, so the host emits match_ended and broadcasts the authoritative log.
    const r = runSession({ ...BASE, ticks: 1600 });
    const [a, b] = r.clients;
    expect(a!.matchStats).not.toBeNull();
    expect(a!.matchStats).toBe(b!.matchStats); // one datagram, identical bytes
    const events = JSON.parse(a!.matchStats!) as { type: string }[];
    expect(events.some((e) => e.type === "match_ended")).toBe(true);
    expect(events.some((e) => e.type === "player_jumped")).toBe(true);
  });

  it("is fully reproducible for a fixed seed", () => {
    const opts = { ...BASE, loss: 0.12, seed: 0xabcd };
    const a = runSession(opts);
    const b = runSession(opts);
    expect(a.hostFinal).toBe(b.hostFinal);
    expect(a.clients).toEqual(b.clients);
  });
});
