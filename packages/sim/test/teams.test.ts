import { describe, expect, it } from "vitest";
import {
  checkArrowKills,
  checkStomps,
  createSim,
  deriveTuning,
  emptyInput,
  MUZZLE_IMMUNITY_TICKS,
  PLAYER_HEIGHT,
  resolveExplosions,
  type ArrowState,
  type PlayerState,
  type Sim
} from "../src/index";
import { FLAT_ARENA, TEST_TUNING } from "./fixtures";

/**
 * T3.2 — teams mode and friendly fire (spec 003, A3.6). FFA paths are proven
 * byte-identical by the untouched golden log (bot-round.test.ts); this suite
 * covers the new teams/FF behavior and the all-or-none mode validation.
 */

const DERIVED = deriveTuning(TEST_TUNING);

/** 2v2: slots 0,1 = team 0; slots 2,3 = team 1. */
const TEAM_PLAYERS = [
  { slot: 0, team: 0 as const },
  { slot: 1, team: 0 as const },
  { slot: 2, team: 1 as const },
  { slot: 3, team: 1 as const }
];

function teamsSim(roundsToWin = TEST_TUNING.roundsToWin): Sim {
  return createSim({
    arena: FLAT_ARENA,
    tuning: { ...TEST_TUNING, roundsToWin },
    players: TEAM_PLAYERS,
    seed: 1
  });
}

const empties = (n: number): ReturnType<typeof emptyInput>[] =>
  Array.from({ length: n }, () => emptyInput());

function mkPlayer(slot: number, team: number | null, over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: slot + 1,
    slot,
    team,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    quiver: [],
    alive: true,
    grounded: false,
    coyoteTicksLeft: 0,
    jumpBufferTicksLeft: 0,
    prevJumpHeld: false,
    prevShootHeld: false,
    prevDashHeld: false,
    dashTicksLeft: 0,
    dashCooldownTicksLeft: 0,
    dashDir: 1,
    wallJumpLockTicksLeft: 0,
    jumpCutAvailable: false,
    invisibleTicksLeft: 0,
    flightTicksLeft: 0,
    ...over
  };
}

function mkArrow(over: Partial<ArrowState> = {}): ArrowState {
  return {
    id: 99,
    ownerSlot: 0,
    kind: "normal",
    phase: "flying",
    firedTick: 0,
    bouncesLeft: 0,
    pierced: false,
    insideSolid: false,
    x: 0,
    y: 0,
    vx: 100,
    vy: 0,
    ...over
  };
}

describe("teams mode validation (createSim)", () => {
  it("runs FFA when no player carries a team", () => {
    const sim = createSim({ arena: FLAT_ARENA, tuning: TEST_TUNING, players: [{ slot: 0 }, { slot: 1 }], seed: 1 });
    expect(sim.state.match.teamScores).toBeNull();
    expect(sim.state.players.every((p) => p.team === null)).toBe(true);
  });

  it("runs teams mode when all players carry a team", () => {
    const sim = teamsSim();
    expect(sim.state.match.teamScores).toEqual([0, 0]);
    expect(sim.state.players.map((p) => p.team)).toEqual([0, 0, 1, 1]);
  });

  it("rejects a partial team assignment (all-or-none)", () => {
    expect(() =>
      createSim({ arena: FLAT_ARENA, tuning: TEST_TUNING, players: [{ slot: 0, team: 0 }, { slot: 1 }], seed: 1 })
    ).toThrow(/all players carry a team or none/);
  });

  it("rejects a one-sided team split", () => {
    expect(() =>
      createSim({
        arena: FLAT_ARENA,
        tuning: TEST_TUNING,
        players: [{ slot: 0, team: 0 }, { slot: 1, team: 0 }],
        seed: 1
      })
    ).toThrow(/both team 0 and team 1 must be non-empty/);
  });
});

describe("teams round & match scoring", () => {
  it("round ends when all alive players share a team; team scores tick up", () => {
    const sim = teamsSim();
    sim.step(empties(4)); // tick 0: round_started

    // Wipe team 1 (slots 2 & 3); team 0 now the only team alive.
    sim.state.players[2]!.alive = false;
    sim.state.players[3]!.alive = false;
    const events = sim.step(empties(4));

    expect(events.find((e) => e.type === "round_ended")).toMatchObject({ winner: 0 });
    expect(sim.state.match.teamScores).toEqual([1, 0]);
    // Both survivors get an individual-survival tick; team 1 stays at zero.
    expect(sim.state.match.scores).toEqual([1, 1, 0, 0]);
    expect(sim.state.match.winner).toBeNull();
  });

  it("first team to roundsToWin wins the match; match_ended carries the team tally", () => {
    const sim = teamsSim(1); // single round decides the match
    sim.step(empties(4));
    sim.state.players[0]!.alive = false;
    sim.state.players[1]!.alive = false; // team 0 wiped → team 1 wins
    const events = sim.step(empties(4));

    expect(events.find((e) => e.type === "round_ended")).toMatchObject({ winner: 1 });
    const matchEnd = events.find((e) => e.type === "match_ended");
    expect(matchEnd).toMatchObject({ winner: 1, scores: [0, 1] });
    expect(sim.state.match.winner).toBe(1);
  });

  it("a mutual wipe (nobody alive) is a draw, no team scored", () => {
    const sim = teamsSim();
    sim.step(empties(4));
    sim.state.players.forEach((p) => (p.alive = false));
    const events = sim.step(empties(4));
    expect(events.find((e) => e.type === "round_ended")).toMatchObject({ winner: "draw" });
    expect(sim.state.match.teamScores).toEqual([0, 0]);
  });
});

describe("friendly fire off — kill suppression", () => {
  const farPastImmunity = MUZZLE_IMMUNITY_TICKS + 5;

  it("a teammate arrow passes through; an enemy arrow still kills", () => {
    const owner = mkPlayer(0, 0);
    const mate = mkPlayer(1, 0);
    const foe = mkPlayer(2, 1);
    const arrow = mkArrow({ ownerSlot: 0 });

    const noEvents: Parameters<typeof checkArrowKills>[2] = [];
    checkArrowKills([arrow], [owner, mate], noEvents, farPastImmunity, false);
    expect(noEvents).toHaveLength(0);
    expect(mate.alive).toBe(true);
    expect(arrow.phase).toBe("flying"); // passed through, still flying

    const killEvents: Parameters<typeof checkArrowKills>[2] = [];
    checkArrowKills([mkArrow({ ownerSlot: 0 })], [owner, foe], killEvents, farPastImmunity, false);
    expect(killEvents.find((e) => e.type === "player_killed")).toMatchObject({ victim: 2 });
    expect(foe.alive).toBe(false);
  });

  it("a teammate laser passes through without killing", () => {
    const mate = mkPlayer(1, 0);
    const laser = mkArrow({ ownerSlot: 0, kind: "laser" });
    const events: Parameters<typeof checkArrowKills>[2] = [];
    checkArrowKills([laser], [mkPlayer(0, 0), mate], events, farPastImmunity, false);
    expect(events).toHaveLength(0);
    expect(mate.alive).toBe(true);
  });

  it("a bomb blast spares teammates and the shooter, but not enemies", () => {
    const owner = mkPlayer(0, 0); // at the blast center
    const mate = mkPlayer(1, 0, { x: 5, y: 0 });
    const foe = mkPlayer(2, 1, { x: 5, y: 0 });
    const bomb = mkArrow({ ownerSlot: 0, kind: "bomb", phase: "exploding" });
    const events: Parameters<typeof resolveExplosions>[3] = [];
    resolveExplosions([bomb], [owner, mate, foe], DERIVED, events, 10, false);
    expect(owner.alive).toBe(true); // shooter is their own teammate
    expect(mate.alive).toBe(true);
    expect(foe.alive).toBe(false);
  });

  it("a teammate stomp bounces the attacker without killing", () => {
    const attacker = mkPlayer(0, 0, { y: -PLAYER_HEIGHT, vy: 20 });
    const victim = mkPlayer(1, 0, { y: 0, vy: 0 });
    const events: Parameters<typeof checkStomps>[2] = [];
    checkStomps([attacker, victim], DERIVED, events, 10, false);
    expect(victim.alive).toBe(true);
    expect(events).toHaveLength(0);
    expect(attacker.vy).toBe(-DERIVED.stompBounceVelocity); // still bounces
  });
});

describe("friendly fire on (default) and FFA are never suppressed", () => {
  it("with FF on, a teammate's arrow kills", () => {
    const mate = mkPlayer(1, 0);
    const events: Parameters<typeof checkArrowKills>[2] = [];
    // Owner off the arrow so the teammate is the one in the line of fire.
    checkArrowKills([mkArrow({ ownerSlot: 0 })], [mkPlayer(0, 0, { x: 200 }), mate], events, 999, true);
    expect(mate.alive).toBe(false);
  });

  it("FFA self-bomb kills even with the friendlyFire flag false (null-team guard)", () => {
    const owner = mkPlayer(0, null);
    const bomb = mkArrow({ ownerSlot: 0, kind: "bomb", phase: "exploding" });
    const events: Parameters<typeof resolveExplosions>[3] = [];
    resolveExplosions([bomb], [owner], DERIVED, events, 10, false);
    expect(owner.alive).toBe(false);
  });
});
