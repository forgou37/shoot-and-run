import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { emptyInput, parseArena, parseTuning, type PlayerInput } from "@shoot-and-run/sim";
import { ClientSession } from "../src/client";
import { createHostRuntime } from "../src/host-runtime";
import { LoopbackNetwork } from "../src/loopback";

/**
 * T13.2 — spectators. A spectator joins with no slot, never gates the start, sends
 * no input, and follows the authoritative stream: its CONFIRMED state must be
 * byte-identical to the host's (it replays the exact authoritative inputs on the
 * same seed). And a spectator dropping mid-match must not disturb the players.
 * Driven over the lossy/jittery loopback alongside two scripted player sessions.
 */

const arena = parseArena(arena001);
const tuning = parseTuning(tuningJson);
const players = [{ slot: 0 }, { slot: 1 }];

function scriptInput(slot: number, tick: number): PlayerInput {
  const input = emptyInput();
  if ((tick + slot) % 2 === 0) input.right = true;
  else input.left = true;
  if ((tick + slot) % 7 === 0) input.jump = true;
  if ((tick * (slot + 1)) % 11 === 0) input.shoot = true;
  return input;
}

function makeRuntime(net: LoopbackNetwork) {
  return createHostRuntime({
    server: net.server,
    arena,
    tuning,
    players,
    seed: 0xfeed,
    snapshotIntervalTicks: 20,
    arenaId: "crossfire"
  });
}

function makePlayer(net: LoopbackNetwork, id: string): ClientSession {
  return new ClientSession({ transport: net.connect(id), arena, tuning, inputDelayTicks: 6, maxRollbackTicks: 200 });
}

describe("spectators (T13.2)", () => {
  it("a spectator's confirmed state stays byte-identical to the host", () => {
    const net = new LoopbackNetwork({ seed: 0xfeed, latencyTicks: 3, jitterTicks: 2 });
    const runtime = makeRuntime(net);
    const p0 = makePlayer(net, "c0");
    const p1 = makePlayer(net, "c1");
    const spec = new ClientSession({
      transport: net.connect("s0"),
      arena,
      tuning,
      role: "spectator",
      inputDelayTicks: 6,
      maxRollbackTicks: 200
    });

    for (let t = 0; t <= 240; t++) {
      net.advance(t);
      runtime.step();
      p0.tick(scriptInput(p0.ready ? p0.localSlot : 0, t));
      p1.tick(scriptInput(p1.ready ? p1.localSlot : 1, t));
      spec.tick(emptyInput()); // a spectator feeds nothing; the session ignores it
    }
    for (let t = 241; t <= 240 + 3 + 2 + 20 + 5; t++) net.advance(t); // drain in-flight

    const hostFinal = JSON.stringify(runtime.snapshot());
    expect(spec.spectating).toBe(true);
    expect(spec.localSlot).toBe(-1); // no slot
    expect(spec.confirmedTick).toBe(runtime.tick);
    expect(JSON.stringify(spec.snapshotConfirmed())).toBe(hostFinal);
    // sanity: the players converged too, so the spectator isn't matching a stalled host
    expect(JSON.stringify(p0.snapshotConfirmed())).toBe(hostFinal);
  });

  it("a spectator dropping mid-match never disturbs the players' convergence", () => {
    const net = new LoopbackNetwork({ seed: 0xabcd, latencyTicks: 2, jitterTicks: 1 });
    const runtime = makeRuntime(net);
    const p0 = makePlayer(net, "c0");
    const p1 = makePlayer(net, "c1");
    const spec = new ClientSession({
      transport: net.connect("s0"),
      arena,
      tuning,
      role: "spectator",
      inputDelayTicks: 6,
      maxRollbackTicks: 200
    });

    for (let t = 0; t <= 240; t++) {
      net.advance(t);
      runtime.step();
      p0.tick(scriptInput(p0.ready ? p0.localSlot : 0, t));
      p1.tick(scriptInput(p1.ready ? p1.localSlot : 1, t));
      if (t === 120) spec.close(); // spectator leaves halfway
      else if (t < 120) spec.tick(emptyInput());
    }
    for (let t = 241; t <= 240 + 2 + 1 + 20 + 5; t++) net.advance(t);

    const hostFinal = JSON.stringify(runtime.snapshot());
    expect(JSON.stringify(p0.snapshotConfirmed())).toBe(hostFinal);
    expect(JSON.stringify(p1.snapshotConfirmed())).toBe(hostFinal);
  });
});
