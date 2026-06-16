import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { emptyInput, parseArena, parseTuning, type PlayerInput } from "@shoot-and-run/sim";
import { ClientSession } from "../src/client";
import { createHostRuntime } from "../src/host-runtime";
import { LoopbackNetwork } from "../src/loopback";

/**
 * T11.2 / S3 — clock bootstrap at REAL internet RTT. 010 was localhost (sub-tick
 * latency); here the loopback injects tens-of-ms one-way delays (ticks at 60 Hz:
 * ~2 ≈ 33 ms, ~5 ≈ 83 ms, ~7 ≈ 117 ms) plus jitter and loss. The client must sync
 * its clock via ping/pong BEFORE it leads, so its opening inputs are not tagged
 * for already-committed ticks (the 010-deferred bootstrap loss), and every client
 * must still converge byte-for-byte to the host.
 *
 * inputDelayTicks must cover the one-way latency (+ jitter) for inputs to arrive
 * on time — the deployment doc records recommended internet values; here each
 * profile sets it accordingly.
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
  ticks: number;
}

interface Result {
  hostTick: number;
  hostFinal: string;
  hostMoved: boolean;
  lateDropped: number;
  clients: { confirmedTick: number; confirmed: string }[];
}

function runSession(o: Opts): Result {
  const net = new LoopbackNetwork({
    seed: o.seed,
    latencyTicks: o.latency,
    jitterTicks: o.jitter,
    lossRate: o.loss
  });
  const runtime = createHostRuntime({
    server: net.server,
    arena,
    tuning,
    players,
    seed: o.seed,
    snapshotIntervalTicks: 20,
    arenaId: "crossfire"
  });
  const sessions = ["c0", "c1"].map(
    (id) =>
      new ClientSession({
        transport: net.connect(id),
        arena,
        tuning,
        inputDelayTicks: o.inputDelay,
        maxRollbackTicks: 200
      })
  );

  const spawn0 = arena.spawns[0]!;
  for (let t = 0; t <= o.ticks; t++) {
    net.advance(t);
    runtime.step();
    for (const s of sessions) s.tick(scriptInput(s.ready ? s.localSlot : 0, t));
  }
  // Drain in-flight datagrams so confirmed catches up to the host.
  const drainUntil = o.ticks + o.latency + o.jitter + 20 + 10;
  for (let t = o.ticks + 1; t <= drainUntil; t++) net.advance(t);

  const hostState = runtime.snapshot().state;
  return {
    hostTick: runtime.tick,
    hostFinal: JSON.stringify(runtime.snapshot()),
    hostMoved: hostState.players.some((p) => p.x !== spawn0.x || p.y !== spawn0.y),
    lateDropped: runtime.lateDropped,
    clients: sessions.map((s) => ({
      confirmedTick: s.confirmedTick,
      confirmed: JSON.stringify(s.snapshotConfirmed())
    }))
  };
}

describe("clock bootstrap at real RTT (T11.2 / S3)", () => {
  // Jitter (reorder) — never drops a datagram in the loopback, so exact tail
  // convergence is robust here; loss RECOVERY is already covered by the 010
  // runtime-convergence test. This isolates the clock-bootstrap behavior under
  // real RTT + reordering.
  for (const latency of [2, 5, 7]) {
    it(`converges byte-for-byte at ${String(latency)}-tick one-way delay with jitter`, () => {
      const r = runSession({
        seed: 0x600d + latency,
        latency,
        jitter: 2,
        loss: 0,
        inputDelay: latency + 4,
        ticks: 300
      });
      expect(r.hostMoved).toBe(true); // inputs reached the host and drove the sim
      for (const c of r.clients) {
        expect(c.confirmedTick).toBe(r.hostTick);
        expect(c.confirmed).toBe(r.hostFinal);
      }
    });
  }

  it("late-drops no inputs under fixed delay — the bootstrap loss is gone", () => {
    // Fixed (even) delay, no jitter/loss: the synced clock estimate is exact, so
    // the one-way-aware send floor emits only inputs that arrive on time and the
    // host drops none. WITHOUT the T11.2 fix the client would lead off its lagging
    // confirmed tick and the host would drop a burst of opening inputs.
    const r = runSession({ seed: 0xfeed, latency: 6, jitter: 0, loss: 0, inputDelay: 10, ticks: 200 });
    expect(r.hostMoved).toBe(true);
    expect(r.lateDropped).toBe(0);
    for (const c of r.clients) {
      expect(c.confirmedTick).toBe(r.hostTick);
      expect(c.confirmed).toBe(r.hostFinal);
    }
  });
});
