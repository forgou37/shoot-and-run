import { describe, expect, it } from "vitest";
import {
  createSim,
  createSimFromSnapshot,
  type Sim,
  type SimEvent,
  type SimSnapshot
} from "../src/index";
import type { PlayerInput } from "../src/input";
import { TEST_ARENA, TEST_TUNING } from "./fixtures";

/**
 * T8.2 / N1 — snapshot() is a deep, JSON-serializable value; createSimFromSnapshot
 * reconstructs a sim that is step()-for-step() identical to the original.
 */

function cannedInput(tick: number, slot: number): PlayerInput {
  return {
    left: (tick + slot) % 3 === 0,
    right: (tick + slot) % 3 === 1,
    up: (tick + slot) % 13 === 0,
    down: tick % 7 === 0,
    jump: tick % 5 === slot,
    shoot: tick % 11 === 0,
    dash: tick % 9 === slot
  };
}

function makeSim(seed: number): Sim {
  return createSim({
    arena: TEST_ARENA,
    tuning: TEST_TUNING,
    players: [{ slot: 0 }, { slot: 1 }],
    seed
  });
}

const RESTORE_CONFIG = {
  arena: TEST_ARENA,
  tuning: TEST_TUNING,
  players: [{ slot: 0 }, { slot: 1 }]
};

describe("snapshot / restore (T8.2 / N1)", () => {
  it("snapshot is JSON-serializable and captures version, rng state, and entity counter", () => {
    const sim = makeSim(0xc0ffee);
    for (let t = 0; t < 50; t++) sim.step([cannedInput(t, 0), cannedInput(t, 1)]);

    const snap = sim.snapshot();
    expect(snap.version).toBe("0.0.0");
    expect(snap.nextEntityId).toBe(sim.getEntityIdCounter());
    expect(typeof snap.rngState).toBe("number");

    // Round-trips through JSON with no loss (it is a plain value).
    const roundTripped = JSON.parse(JSON.stringify(snap)) as SimSnapshot;
    expect(roundTripped).toEqual(snap);
  });

  it("snapshot is a value, not a handle — stepping the live sim does not mutate it", () => {
    const sim = makeSim(1);
    for (let t = 0; t < 20; t++) sim.step([cannedInput(t, 0), cannedInput(t, 1)]);
    const snap = sim.snapshot();
    const capturedTick = snap.state.tick;

    sim.step([cannedInput(20, 0), cannedInput(20, 1)]);
    expect(sim.state.tick).toBe(capturedTick + 1);
    expect(snap.state.tick).toBe(capturedTick); // frozen
  });

  it("restored sim is step-for-step identical to the original over many ticks", () => {
    const original = makeSim(0xbada55);
    for (let t = 0; t < 137; t++) original.step([cannedInput(t, 0), cannedInput(t, 1)]);

    const snap = original.snapshot();
    const restored = createSimFromSnapshot(snap, RESTORE_CONFIG);

    // Identical immediately after restore.
    expect(restored.state).toEqual(original.state);
    expect(restored.getEntityIdCounter()).toBe(original.getEntityIdCounter());

    // ...and identical tick-for-tick as both advance with the same inputs.
    for (let t = 137; t < 400; t++) {
      const inputs = [cannedInput(t, 0), cannedInput(t, 1)];
      const evO: SimEvent[] = original.step(inputs);
      const evR: SimEvent[] = restored.step(inputs);
      expect(JSON.stringify(evR)).toBe(JSON.stringify(evO));
      expect(restored.state).toEqual(original.state);
    }
  });

  it("restore rejects a roster whose size disagrees with the snapshot", () => {
    const sim = makeSim(3);
    const snap = sim.snapshot();
    expect(() =>
      createSimFromSnapshot(snap, { arena: TEST_ARENA, tuning: TEST_TUNING, players: [{ slot: 0 }] })
    ).toThrow(/1 players but the snapshot has 2/);
  });
});
