import { describe, expect, it } from "vitest";
import { createSim, type Sim } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { FLAT_ARENA, TEST_TUNING } from "./fixtures";

function inp(partial: Partial<PlayerInput>): PlayerInput {
  return { ...emptyInput(), ...partial };
}

function makeSettledSim(): Sim {
  const sim = createSim({
    arena: FLAT_ARENA,
    tuning: TEST_TUNING,
    players: [{ slot: 0 }],
    seed: 3
  });
  for (let i = 0; i < 60; i++) sim.step([emptyInput()]);
  return sim;
}

function p0(sim: Sim) {
  return sim.state.players[0]!;
}

/** Jump once, coast to past the apex, then tap jump again mid-air. */
function airTapAttempt(sim: Sim): { flapped: boolean } {
  sim.step([inp({ jump: true })]); // ground jump
  sim.step([emptyInput()]);
  // Coast until clearly airborne and past coyote, still rising or near apex.
  for (let i = 0; i < 10; i++) sim.step([emptyInput()]);
  const vyBefore = p0(sim).vy;
  sim.step([inp({ jump: true })]); // mid-air tap
  const vyAfter = p0(sim).vy;
  return { flapped: vyAfter < vyBefore && vyAfter < 0 };
}

describe("power-ups (spec 002 T2.4)", () => {
  it("flight: mid-air jump presses flap while the timer runs", () => {
    const sim = makeSettledSim();
    p0(sim).flightTicksLeft = 600;
    const { flapped } = airTapAttempt(sim);
    expect(flapped).toBe(true);
    expect(p0(sim).vy).toBeCloseTo(-TEST_TUNING.flapVelocity, 5);
  });

  it("flight: without the power-up a mid-air tap does nothing", () => {
    const sim = makeSettledSim();
    const { flapped } = airTapAttempt(sim);
    expect(flapped).toBe(false);
  });

  it("flight: expires — taps stop working at 0", () => {
    const sim = makeSettledSim();
    p0(sim).flightTicksLeft = 5; // expires during the coast
    const { flapped } = airTapAttempt(sim);
    expect(flapped).toBe(false);
    expect(p0(sim).flightTicksLeft).toBe(0);
  });

  it("invisibility: timer decrements to 0 and stays", () => {
    const sim = makeSettledSim();
    p0(sim).invisibleTicksLeft = 10;
    for (let i = 0; i < 10; i++) sim.step([emptyInput()]);
    expect(p0(sim).invisibleTicksLeft).toBe(0);
    sim.step([emptyInput()]);
    expect(p0(sim).invisibleTicksLeft).toBe(0);
  });
});
