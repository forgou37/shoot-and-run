import { describe, expect, it } from "vitest";
import type { ArenaData } from "../src/arena";
import { createSim, type Sim, type SimEvent } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import type { ArrowKind } from "../src/state";
import { FLAT_ARENA, TEST_TUNING, TWO_WALL_ARENA, WALL_ARENA } from "./fixtures";

function inp(partial: Partial<PlayerInput>): PlayerInput {
  return { ...emptyInput(), ...partial };
}

function makeSim(arena: ArenaData, playerCount = 2): Sim {
  const sim = createSim({
    arena,
    tuning: TEST_TUNING,
    players: Array.from({ length: playerCount }, (_, slot) => ({ slot })),
    seed: 21
  });
  const idle = Array.from({ length: playerCount }, () => emptyInput());
  for (let i = 0; i < 60; i++) sim.step(idle);
  return sim;
}

/** Tests hand the shooter a special quiver directly — chests arrive in T2.3. */
function arm(sim: Sim, slot: number, kinds: ArrowKind[]): void {
  sim.state.players[slot]!.quiver = kinds;
}

function run(sim: Sim, inputsFor: (t: number) => PlayerInput[], maxTicks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < maxTicks; t++) {
    events.push(...sim.step(inputsFor(t)));
    if (sim.state.round.phase === "ended") break;
  }
  return events;
}

describe("bomb arrows (A2.4)", () => {
  it("explodes on tile contact and radius-kills through the wall; never sticks", () => {
    const sim = makeSim(WALL_ARENA); // P0 at x=200, wall face at x=240
    arm(sim, 0, ["bomb"]);
    // Victim BEHIND the wall (out of the arrow's path, within blast radius of
    // the wall face at ~235): blasts ignore line of sight by design.
    sim.state.players[1]!.x = 260;
    const events = run(sim, (t) => [inp({ shoot: t === 0 }), emptyInput()], 60);

    expect(events.find((e) => e.type === "arrow_exploded")).toBeDefined();
    const kill = events.find((e) => e.type === "player_killed");
    expect(kill).toMatchObject({ victim: 1, killer: 0, cause: "bomb" });
    expect(sim.state.players[0]!.alive).toBe(true); // shooter at ~35px is outside 28px radius
    expect(sim.state.arrows).toHaveLength(0); // exploded arrows are removed, no pickup
    expect(events.filter((e) => e.type === "arrow_stuck")).toHaveLength(0);
  });

  it("detonates on body contact; a point-blank blast kills the shooter too (draw)", () => {
    const sim = makeSim(FLAT_ARENA); // P0 x=20, P1 x=300: wrap shot is ~40px
    arm(sim, 0, ["bomb"]);
    // Walking left while firing left: contact happens ~17px from the shooter,
    // inside the 28px radius — both die.
    const events = run(sim, (t) => [inp({ left: true, shoot: t === 0 }), emptyInput()], 60);
    const kills = events.filter((e) => e.type === "player_killed");
    expect(kills).toHaveLength(2);
    expect(kills.every((k) => k.type === "player_killed" && k.cause === "bomb")).toBe(true);
    expect(events.find((e) => e.type === "round_ended")).toMatchObject({ winner: "draw" });
    expect(events.find((e) => e.type === "arrow_exploded")).toBeDefined();
  });
});

describe("laser arrows (A2.5)", () => {
  it("flies straight, kills through its path, pierces the first wall, embeds in the second", () => {
    // 3 players: a kill must not end the round, or the arrow freezes mid-flight.
    const sim = makeSim(TWO_WALL_ARENA, 3);
    arm(sim, 0, ["laser"]);
    // P0 fires right from x=60. Wall A at col 8 (x128) gets pierced, P1 at
    // x=190 is in the path between the walls, wall B at col 15 (x240) embeds.
    sim.state.players[2]!.x = 136; // parked on TOP of wall A, out of the path
    sim.state.players[2]!.y = 170;
    const yAtFire = sim.state.players[0]!.y;
    const events = run(
      sim,
      (t) => [inp({ shoot: t === 0 }), emptyInput(), emptyInput()],
      240
    );

    // Killed the player between the walls without stopping there...
    const kill = events.find((e) => e.type === "player_killed");
    expect(kill).toMatchObject({ victim: 1, cause: "arrow" });
    // ...having already passed through wall A, then embedded in wall B.
    const stuck = events.find((e) => e.type === "arrow_stuck");
    expect(stuck).toBeDefined();
    const arrow = sim.state.arrows[0]!;
    expect(arrow.phase).toBe("stuck");
    expect(arrow.x).toBeGreaterThanOrEqual(240);
    expect(arrow.x).toBeLessThan(256); // inside wall B's column
    expect(arrow.y).toBeCloseTo(yAtFire, 6); // no gravity: dead straight
  });
});

describe("bouncing arrows (A2.6)", () => {
  it("reflects off a wall (vx flips) instead of sticking", () => {
    const sim = makeSim(WALL_ARENA, 1);
    arm(sim, 0, ["bounce"]);
    sim.step([inp({ shoot: true })]);
    const arrow = () => sim.state.arrows[0]!;
    expect(arrow().vx).toBeGreaterThan(0);
    for (let t = 0; t < 30 && arrow().vx > 0; t++) sim.step([emptyInput()]);
    expect(arrow().vx).toBeLessThan(0); // reflected off the wall
    expect(arrow().phase).toBe("flying");
    expect(arrow().bouncesLeft).toBe(TEST_TUNING.arrowBounceCount - 1);
  });

  it("sticks after exhausting its 5 bounces", () => {
    const sim = makeSim(FLAT_ARENA, 1);
    arm(sim, 0, ["bounce"]);
    sim.step([inp({ down: true, right: true, shoot: true })]); // diagonal into the floor
    let bouncedUp = false;
    const events: SimEvent[] = [];
    for (let t = 0; t < 900 && sim.state.arrows[0]!.phase === "flying"; t++) {
      events.push(...sim.step([emptyInput()]));
      if (sim.state.arrows[0]!.vy < 0) bouncedUp = true;
    }
    expect(bouncedUp).toBe(true);
    expect(sim.state.arrows[0]!.phase).toBe("stuck");
    expect(sim.state.arrows[0]!.bouncesLeft).toBe(0);
    expect(events.filter((e) => e.type === "arrow_stuck")).toHaveLength(1);
  });
});
