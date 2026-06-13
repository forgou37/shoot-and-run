import { describe, expect, it } from "vitest";
import { createSim, type Sim, type SimEvent } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { msToTicks, type Tuning } from "../src/tuning";
import { FLAT_ARENA, TEST_TUNING } from "./fixtures";

/** Quick matches: first to 2 round wins. */
const MATCH_TUNING: Tuning = { ...TEST_TUNING, roundsToWin: 2 };
const MATCH_PAUSE_TICKS = msToTicks(MATCH_TUNING.matchRestartDelayMs);

function inp(partial: Partial<PlayerInput>): PlayerInput {
  return { ...emptyInput(), ...partial };
}

function makeSim(): Sim {
  return createSim({
    arena: FLAT_ARENA,
    tuning: MATCH_TUNING,
    players: [{ slot: 0 }, { slot: 1 }],
    seed: 11
  });
}

/** Settle, then P0 kills P1 via the wrap shot. Returns events seen. */
function playRoundWithP0Kill(sim: Sim): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < 80 && sim.state.round.phase === "ended"; i++) {
    events.push(...sim.step([emptyInput(), emptyInput()])); // ride out a pause
  }
  for (let i = 0; i < 60; i++) events.push(...sim.step([emptyInput(), emptyInput()]));
  for (let t = 0; t < 80 && sim.state.round.phase === "running"; t++) {
    events.push(...sim.step([inp({ left: true, shoot: t === 0 }), emptyInput()]));
  }
  expect(sim.state.round.phase).toBe("ended");
  return events;
}

describe("match structure (spec 001 T1.1)", () => {
  it("round wins accumulate; reaching roundsToWin ends the match", () => {
    const sim = makeSim();

    const round1 = playRoundWithP0Kill(sim);
    expect(sim.state.match.scores).toEqual([1, 0]);
    expect(round1.filter((e) => e.type === "match_ended")).toHaveLength(0);
    expect(sim.state.match.winner).toBeNull();

    // Ride out the (short) round pause, then round 2.
    const restartTicks = msToTicks(MATCH_TUNING.roundRestartDelayMs);
    for (let i = 0; i <= restartTicks; i++) sim.step([emptyInput(), emptyInput()]);
    expect(sim.state.round.phase).toBe("running");

    const round2 = playRoundWithP0Kill(sim);
    const matchEnd = round2.find((e) => e.type === "match_ended");
    expect(matchEnd).toMatchObject({ winner: 0, scores: [2, 0] });
    expect(sim.state.match.winner).toBe(0);
    expect(sim.state.round.restartTicksLeft).toBe(MATCH_PAUSE_TICKS);
  });

  it("after the match pause everything resets: scores, round number, players", () => {
    const sim = makeSim();
    playRoundWithP0Kill(sim);
    const restartTicks = msToTicks(MATCH_TUNING.roundRestartDelayMs);
    for (let i = 0; i <= restartTicks; i++) sim.step([emptyInput(), emptyInput()]);
    playRoundWithP0Kill(sim);
    expect(sim.state.match.winner).toBe(0);

    const events: SimEvent[] = [];
    for (let i = 0; i <= MATCH_PAUSE_TICKS + 1 && sim.state.round.phase === "ended"; i++) {
      events.push(...sim.step([emptyInput(), emptyInput()]));
    }

    expect(events.find((e) => e.type === "round_started")).toBeDefined();
    expect(sim.state.match).toEqual({ scores: [0, 0], winner: null, teamScores: null });
    expect(sim.state.round).toMatchObject({ phase: "running", winner: null, number: 1 });
    sim.state.players.forEach((p) => {
      expect(p.alive).toBe(true);
      expect(p.quiver).toHaveLength(MATCH_TUNING.startingArrows);
    });
  });

  it("draws increment nobody's score", () => {
    const sim = makeSim();
    for (let i = 0; i < 60; i++) sim.step([emptyInput(), emptyInput()]);
    for (let t = 0; t < 80 && sim.state.round.phase === "running"; t++) {
      sim.step([inp({ left: true, shoot: t === 0 }), inp({ right: true, shoot: t === 0 })]);
    }
    expect(sim.state.round.winner).toBe("draw");
    expect(sim.state.match.scores).toEqual([0, 0]);
    expect(sim.state.match.winner).toBeNull();
  });

  it("player_killed events carry the victim position", () => {
    const sim = makeSim();
    const events = playRoundWithP0Kill(sim);
    const kill = events.find((e) => e.type === "player_killed");
    expect(kill).toBeDefined();
    if (kill?.type === "player_killed") {
      expect(Number.isFinite(kill.x)).toBe(true);
      expect(Number.isFinite(kill.y)).toBe(true);
      // Victim stood on the flat floor; death position should be near it.
      expect(kill.y).toBeGreaterThan(180);
    }
  });
});
