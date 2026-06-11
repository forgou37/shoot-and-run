import { describe, expect, it } from "vitest";
import { createSim, type Sim, type SimEvent } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { msToTicks } from "../src/tuning";
import { FLAT_ARENA, TEST_TUNING } from "./fixtures";

const RESTART_TICKS = msToTicks(TEST_TUNING.roundRestartDelayMs); // 1500ms -> 90

function inp(partial: Partial<PlayerInput>): PlayerInput {
  return { ...emptyInput(), ...partial };
}

/** Two settled players on FLAT (P0 x=20, P1 x=300), P0 kills P1 via wrap shot. */
function simWithKill(): { sim: Sim; events: SimEvent[] } {
  const sim = createSim({
    arena: FLAT_ARENA,
    tuning: TEST_TUNING,
    players: [{ slot: 0 }, { slot: 1 }],
    seed: 5
  });
  const events: SimEvent[] = [];
  for (let i = 0; i < 60; i++) events.push(...sim.step([emptyInput(), emptyInput()]));
  for (let t = 0; t < 60; t++) {
    events.push(...sim.step([inp({ left: true, shoot: t === 0 }), emptyInput()]));
    if (sim.state.round.phase === "ended") break;
  }
  return { sim, events };
}

describe("round flow (spec 000 T0.8)", () => {
  it("last player standing ends the round with a winner, same tick as the kill", () => {
    const { sim, events } = simWithKill();
    const kill = events.find((e) => e.type === "player_killed");
    const ended = events.find((e) => e.type === "round_ended");
    expect(kill).toBeDefined();
    expect(ended).toMatchObject({ winner: 0 });
    expect(ended!.tick).toBe(kill!.tick);
    expect(sim.state.round.phase).toBe("ended");
    expect(sim.state.round.winner).toBe(0);
  });

  it("gameplay is frozen during the end pause", () => {
    const { sim } = simWithKill();
    const xBefore = sim.state.players[0]!.x;
    for (let i = 0; i < 10; i++) sim.step([inp({ right: true }), emptyInput()]);
    expect(sim.state.players[0]!.x).toBe(xBefore);
  });

  it("after the delay the round restarts fully reset", () => {
    const { sim } = simWithKill();
    const events: SimEvent[] = [];
    for (let i = 0; i < RESTART_TICKS + 2 && sim.state.round.phase === "ended"; i++) {
      events.push(...sim.step([emptyInput(), emptyInput()]));
    }

    expect(events.find((e) => e.type === "round_started")).toBeDefined();
    expect(sim.state.round).toMatchObject({ phase: "running", winner: null, number: 2 });
    expect(sim.state.arrows).toHaveLength(0);
    sim.state.players.forEach((p, i) => {
      expect(p.alive).toBe(true);
      expect(p.arrows).toBe(TEST_TUNING.startingArrows);
      expect(p.x).toBe(FLAT_ARENA.spawns[i]!.x);
      expect(p.y).toBe(FLAT_ARENA.spawns[i]!.y);
      expect(p.vx).toBe(0);
      expect(p.vy).toBe(0);
    });
  });

  it("simultaneous deaths end the round in a draw", () => {
    // Symmetric wrap shots: P0 at x=20 fires left, P1 at x=300 fires right;
    // both arrows cross the seam and land on the same tick.
    const sim = createSim({
      arena: FLAT_ARENA,
      tuning: TEST_TUNING,
      players: [{ slot: 0 }, { slot: 1 }],
      seed: 5
    });
    for (let i = 0; i < 60; i++) sim.step([emptyInput(), emptyInput()]);

    const events: SimEvent[] = [];
    for (let t = 0; t < 60 && sim.state.round.phase === "running"; t++) {
      events.push(
        ...sim.step([
          inp({ left: true, shoot: t === 0 }),
          inp({ right: true, shoot: t === 0 })
        ])
      );
    }

    expect(events.filter((e) => e.type === "player_killed")).toHaveLength(2);
    expect(events.find((e) => e.type === "round_ended")).toMatchObject({ winner: "draw" });
    expect(sim.state.round.winner).toBe("draw");
  });
});
