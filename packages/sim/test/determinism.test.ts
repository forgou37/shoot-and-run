import { describe, expect, it } from "vitest";
import { createSim, type Sim, type SimEvent } from "../src/index";
import type { PlayerInput } from "../src/input";
import { TEST_ARENA, TEST_TUNING } from "./fixtures";

/**
 * T0.2 acceptance: two sims with the same seed, stepped with identical
 * canned inputs, stay deep-equal in state and event log. The full
 * scripted-bot round version of this proof lands in T0.9.
 */

function cannedInput(tick: number, slot: number): PlayerInput {
  return {
    left: (tick + slot) % 3 === 0,
    right: (tick + slot) % 3 === 1,
    up: (tick + slot) % 13 === 0,
    down: tick % 7 === 0,
    jump: tick % 5 === slot,
    shoot: tick % 11 === 0,
    dash: tick % 9 === slot,
    build: tick % 17 === slot
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

describe("sim determinism (skeleton)", () => {
  it("same seed + same inputs => identical state and event logs over 600 ticks", () => {
    const a = makeSim(0xc0ffee);
    const b = makeSim(0xc0ffee);
    const eventsA: SimEvent[] = [];
    const eventsB: SimEvent[] = [];

    for (let tick = 0; tick < 600; tick++) {
      const inputs = [cannedInput(tick, 0), cannedInput(tick, 1)];
      eventsA.push(...a.step(inputs));
      eventsB.push(...b.step(inputs));
    }

    expect(a.state).toEqual(b.state);
    expect(eventsA).toEqual(eventsB);
    // Byte-identical serialization is the bar the headless proof (T0.9) uses.
    expect(JSON.stringify(eventsA)).toBe(JSON.stringify(eventsB));
  });

  it("players spawn at arena spawn points with starting arrows", () => {
    const sim = makeSim(1);
    expect(sim.state.players).toHaveLength(2);
    expect(sim.state.players[0]).toMatchObject({
      x: 40,
      y: 192,
      quiver: ["normal", "normal", "normal"],
      alive: true
    });
    expect(sim.state.players[1]).toMatchObject({
      x: 280,
      y: 192,
      quiver: ["normal", "normal", "normal"],
      alive: true
    });
  });

  it("emits round_started first on the first tick", () => {
    const sim = makeSim(1);
    const events = sim.step([cannedInput(0, 0), cannedInput(0, 1)]);
    expect(events[0]).toEqual({ tick: 0, type: "round_started" });
  });

  it("rejects mismatched input count", () => {
    const sim = makeSim(1);
    expect(() => sim.step([cannedInput(0, 0)])).toThrow(/1 inputs for 2 players/);
  });

  // T8.1 — the entity-id allocator is hidden state outside SimState; snapshot/
  // restore (T8.2) needs to read and reseed it.
  it("exposes the entity-id counter past the ids already allocated at init", () => {
    const sim = makeSim(1); // 2 players => ids 1, 2 allocated at init
    expect(sim.state.players.map((p) => p.id)).toEqual([1, 2]);
    expect(sim.getEntityIdCounter()).toBe(3);
  });

  it("setEntityIdCounter reseeds the allocator (uint32)", () => {
    const sim = makeSim(1);
    sim.setEntityIdCounter(500);
    expect(sim.getEntityIdCounter()).toBe(500);
  });
});
