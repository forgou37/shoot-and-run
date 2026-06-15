import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { parseArena } from "../src/arena";
import {
  createSim,
  createSimFromSnapshot,
  type SimEvent,
  type SimSnapshot
} from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { parseTuning } from "../src/tuning";
import { hunterBot, patrolBot } from "./bots";

/**
 * T8.3 / N2 + N3 — the rollback proof, on the real arena-001 + tuning content
 * driven by the scripted bots (so chests, the sim PRNG, kills and round resets
 * all fire). This is exactly the operation the netcode does every time a remote
 * input correction arrives: restore the last confirmed snapshot, re-simulate
 * the input tail, and land on byte-identical state.
 */

const SEED = 0xbada55;
const N = 600; // total ticks (spans at least one round + reset)
const K = 200; // snapshot tick, K < N

const arena = parseArena(arena001);
const tuning = parseTuning(tuningJson);
const config = { arena, tuning, players: [{ slot: 0 }, { slot: 1 }] };

interface Recorded {
  inputs: PlayerInput[][]; // recorded per-tick inputs, indexed by tick
  snapAtK: SimSnapshot; // snapshot of the state entering tick K
  finalSnap: SimSnapshot; // snapshot after tick N-1
  tailEvents: SimEvent[][]; // events for ticks K..N-1
}

/** Run the full bot round to N ticks, recording inputs and a mid-round snapshot. */
function runRecording(): Recorded {
  const sim = createSim({ ...config, seed: SEED });
  const inputs: PlayerInput[][] = [];
  const tailEvents: SimEvent[][] = [];
  let snapAtK: SimSnapshot | null = null;
  for (let t = 0; t < N; t++) {
    if (t === K) snapAtK = sim.snapshot();
    const tickInputs = [hunterBot(sim.state, t, 0), patrolBot(sim.state, t, 1)];
    inputs.push(tickInputs);
    const ev = sim.step(tickInputs);
    if (t >= K) tailEvents.push(ev);
  }
  return { inputs, snapAtK: snapAtK!, finalSnap: sim.snapshot(), tailEvents };
}

/** Restore from a snapshot and step the given input tail [from, to). */
function replayTail(
  snap: SimSnapshot,
  inputs: PlayerInput[][],
  from: number,
  to: number
): { finalSnap: SimSnapshot; events: SimEvent[][] } {
  const sim = createSimFromSnapshot(snap, config);
  const events: SimEvent[][] = [];
  for (let t = from; t < to; t++) events.push(sim.step(inputs[t]!));
  return { finalSnap: sim.snapshot(), events };
}

describe("rollback identity (T8.3 / N2)", () => {
  it("snapshot at K + replay of the tail equals continuing the original to N", () => {
    const rec = runRecording();
    const tail = replayTail(rec.snapAtK, rec.inputs, K, N);

    // State (incl. RNG state + entity counter) is byte-identical at tick N.
    expect(JSON.stringify(tail.finalSnap)).toBe(JSON.stringify(rec.finalSnap));
    // And the event log over the replayed tail matches byte-for-byte.
    expect(JSON.stringify(tail.events)).toBe(JSON.stringify(rec.tailEvents));
  });
});

describe("divergence + reconverge (T8.3 / N3)", () => {
  it("a different tail diverges; re-restoring + the original tail reconverges exactly", () => {
    const rec = runRecording();

    // A different input tail (both players idle) must produce different state...
    const idle = emptyInput();
    const idleInputs = rec.inputs.map(() => [idle, idle]);
    const diverged = replayTail(rec.snapAtK, idleInputs, K, N);
    expect(JSON.stringify(diverged.finalSnap)).not.toBe(JSON.stringify(rec.finalSnap));

    // ...yet a fresh restore of the SAME K-snapshot stepped with the ORIGINAL
    // tail returns to A's tick-N state byte-for-byte. This only holds if restore
    // fully reset the hidden state (RNG + entity counter), not just SimState.
    const recovered = replayTail(rec.snapAtK, rec.inputs, K, N);
    expect(JSON.stringify(recovered.finalSnap)).toBe(JSON.stringify(rec.finalSnap));
  });
});
