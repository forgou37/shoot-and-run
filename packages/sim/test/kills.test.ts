import { describe, expect, it } from "vitest";
import { MUZZLE_IMMUNITY_TICKS } from "../src/constants";
import { createSim, type Sim, type SimEvent } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { FLAT_ARENA, STOMP_ARENA, TEST_TUNING } from "./fixtures";

function inp(partial: Partial<PlayerInput>): PlayerInput {
  return { ...emptyInput(), ...partial };
}

function makeTwoPlayerSim(arena = FLAT_ARENA): Sim {
  return createSim({ arena, tuning: TEST_TUNING, players: [{ slot: 0 }, { slot: 1 }], seed: 9 });
}

function runUntilKill(
  sim: Sim,
  inputsFor: (tick: number) => PlayerInput[],
  maxTicks: number
): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < maxTicks; t++) {
    all.push(...sim.step(inputsFor(t)));
    if (all.some((e) => e.type === "player_killed")) break;
  }
  return all;
}

describe("kills (spec 000 T0.7)", () => {
  it("a flying arrow kills on contact — across the wrap seam", () => {
    // FLAT spawns: P0 at x=20, P1 at x=300. Firing LEFT reaches P1 in ~40px
    // through the wrap seam, long before arrow drop matters.
    const sim = makeTwoPlayerSim();
    for (let i = 0; i < 60; i++) sim.step([emptyInput(), emptyInput()]); // settle

    const events = runUntilKill(
      sim,
      (t) => [inp({ left: true, shoot: t === 0 }), emptyInput()],
      60
    );

    const kill = events.find((e) => e.type === "player_killed");
    expect(kill).toMatchObject({ victim: 1, killer: 0, cause: "arrow" });
    expect(sim.state.players[1]!.alive).toBe(false);
    expect(sim.state.players[0]!.alive).toBe(true);
    // The killing arrow stopped and became a pickup.
    expect(sim.state.arrows[0]!.phase).toBe("stuck");
  });

  it("no self-kill at the muzzle, and the shooter survives the immunity window", () => {
    const sim = createSim({
      arena: FLAT_ARENA,
      tuning: TEST_TUNING,
      players: [{ slot: 0 }],
      seed: 9
    });
    for (let i = 0; i < 60; i++) sim.step([emptyInput()]);

    // The arrow spawns exactly at the player's center: maximum overlap.
    const events: SimEvent[] = [];
    events.push(...sim.step([inp({ shoot: true })]));
    for (let i = 0; i < MUZZLE_IMMUNITY_TICKS + 4; i++) {
      events.push(...sim.step([emptyInput()]));
    }
    expect(events.filter((e) => e.type === "player_killed")).toHaveLength(0);
    expect(sim.state.players[0]!.alive).toBe(true);
  });

  it("stomping from above kills the victim and bounces the killer", () => {
    // STOMP_ARENA: P0 falls from (100,40) straight onto P1 standing at (100,~202).
    const sim = makeTwoPlayerSim(STOMP_ARENA);
    const events = runUntilKill(sim, () => [emptyInput(), emptyInput()], 240);

    const kill = events.find((e) => e.type === "player_killed");
    expect(kill).toMatchObject({ victim: 1, killer: 0, cause: "stomp" });
    expect(sim.state.players[1]!.alive).toBe(false);
    expect(sim.state.players[0]!.alive).toBe(true);
    expect(sim.state.players[0]!.vy).toBeLessThan(0); // bounce
  });

  it("side collision is not a stomp — players pass through each other", () => {
    // FLAT: P0 at x=20 walks right, P1 at x=300 walks left; they cross.
    const sim = makeTwoPlayerSim();
    for (let i = 0; i < 60; i++) sim.step([emptyInput(), emptyInput()]);

    const events: SimEvent[] = [];
    for (let t = 0; t < 240; t++) {
      events.push(...sim.step([inp({ right: true }), inp({ left: true })]));
    }
    expect(events.filter((e) => e.type === "player_killed")).toHaveLength(0);
    expect(sim.state.players[0]!.alive).toBe(true);
    expect(sim.state.players[1]!.alive).toBe(true);
    // They actually crossed: P0 ended right of P1's start region or beyond.
    expect(sim.state.players[0]!.x).not.toBeCloseTo(20, 0);
  });

  it("a dead player's arrows remain in the world", () => {
    const sim = makeTwoPlayerSim();
    for (let i = 0; i < 60; i++) sim.step([emptyInput(), emptyInput()]);

    // P1 fires one arrow upward (it will stick somewhere), then P0 kills P1.
    sim.step([emptyInput(), inp({ up: true, shoot: true })]);
    sim.step([emptyInput(), emptyInput()]);
    const events = runUntilKill(
      sim,
      (t) => [inp({ left: true, shoot: t === 0 }), emptyInput()],
      60
    );
    expect(events.find((e) => e.type === "player_killed")).toBeDefined();
    // Both P1's arrow and P0's killing arrow are still tracked.
    expect(sim.state.arrows.filter((a) => a.ownerSlot === 1)).toHaveLength(1);
    expect(sim.state.arrows.filter((a) => a.ownerSlot === 0)).toHaveLength(1);
  });
});
