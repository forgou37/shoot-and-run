import { describe, expect, it } from "vitest";
import { createSim, type Sim, type SimEvent } from "../src/index";
import type { PlayerInput } from "../src/input";
import { CHEST_ARENA, TEST_TUNING } from "./fixtures";

/**
 * T3.0 — sim step-time budget (spec 003, A3.1).
 *
 * A loose order-of-magnitude tripwire, NOT a performance target. The future
 * eval pipeline (spec 005) runs thousands of headless rounds, so a 10×+
 * regression in per-tick cost is the thing this guards against — a real bug
 * (accidental O(n²), per-tick allocation storm, a leaked log), not a few
 * microseconds of drift. Observed mean on the dev machine is well under
 * 0.05 ms/tick; the 0.5 ms budget leaves an order of magnitude of slack so
 * the test is not flaky on a loaded CI runner.
 *
 * Placement is a plain Vitest test in packages/sim/test/ (not src/), so using
 * `performance` here does not trip the sim's nondeterminism guards — those
 * cover src/ only (the sim itself never reads a clock).
 */
const BUDGET_MS = 0.5;

/** ≥5000 ticks of a 4-player match (A3.1). 6000 ≈ 100 s of sim time. */
const MEASURED_TICKS = 6000;
/** Untimed steps on a throwaway sim to warm the JIT before measuring. */
const WARMUP_TICKS = 1000;

/**
 * Deterministic per-(tick, slot) input. Designed to keep all four systems hot,
 * not to play well: players sweep left/right across the flat floor (crossing
 * the three chest spots and stuck-arrow pickups), jump on staggered cadences,
 * and shoot on staggered cadences with `up` sometimes held so arrows arc and
 * stick in the floor rather than always trading instant horizontal kills.
 */
function scriptedInput(tick: number, slot: number): PlayerInput {
  const phase = tick + slot * 37;
  return {
    left: phase % 8 < 3,
    right: phase % 8 >= 5,
    up: phase % 5 === 0,
    down: false,
    jump: tick % 24 === slot * 6,
    shoot: tick % 9 === (slot * 2) % 9
  };
}

function makeSim(seed: number): Sim {
  return createSim({
    arena: CHEST_ARENA, // 4 spawns + 3 chest spots → chests spawn during the run
    tuning: TEST_TUNING,
    players: [{ slot: 0 }, { slot: 1 }, { slot: 2 }, { slot: 3 }],
    seed
  });
}

describe("sim step-time budget (T3.0)", () => {
  it(`4 players over ${MEASURED_TICKS} ticks stays under ${BUDGET_MS} ms/step on average`, () => {
    // Pre-build every tick's inputs so input generation is excluded from the
    // timed loop — we measure step() and nothing else.
    const inputs: PlayerInput[][] = Array.from({ length: MEASURED_TICKS }, (_, tick) =>
      [0, 1, 2, 3].map((slot) => scriptedInput(tick, slot))
    );

    // Warm the JIT on a throwaway sim so the measured run reflects steady state.
    const warm = makeSim(0x1234);
    for (let tick = 0; tick < WARMUP_TICKS; tick++) {
      warm.step([0, 1, 2, 3].map((slot) => scriptedInput(tick, slot)));
    }

    const sim = makeSim(0xb0d9e7);
    const events: SimEvent[] = [];
    const start = performance.now();
    for (let tick = 0; tick < MEASURED_TICKS; tick++) {
      const stepEvents = sim.step(inputs[tick]!);
      for (const e of stepEvents) events.push(e);
    }
    const elapsedMs = performance.now() - start;
    const meanMs = elapsedMs / MEASURED_TICKS;

    // Sanity-check the scenario actually exercised arrows AND chests, so the
    // budget covers a real workload and not an accidentally-idle sim.
    const fired = events.filter((e) => e.type === "arrow_fired").length;
    const chestsSpawned = events.filter((e) => e.type === "chest_spawned").length;
    expect(fired, "scenario should fire many arrows").toBeGreaterThan(100);
    expect(chestsSpawned, "scenario should spawn chests").toBeGreaterThan(0);

    expect(
      meanMs,
      `mean step time ${meanMs.toFixed(4)} ms over ${MEASURED_TICKS} ticks ` +
        `(${fired} arrows fired, ${chestsSpawned} chests spawned) exceeded the ` +
        `${BUDGET_MS} ms tripwire — likely a per-tick complexity or allocation regression`
    ).toBeLessThan(BUDGET_MS);
  });
});
