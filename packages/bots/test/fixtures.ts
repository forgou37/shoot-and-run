import type { ArenaData, ArrowState, PlayerState, SimState } from "@shoot-and-run/sim";
import type { BotContext, BotDifficulty } from "../src/types";
import { createRng } from "@shoot-and-run/sim";

/** An open arena (no solid tiles) for behavior tests that don't exercise walls. */
export function blankArena(): ArenaData {
  return { name: "blank", tiles: Array.from({ length: 15 }, () => ".".repeat(20)), spawns: [] };
}

/** A difficulty with sensible defaults; override the knob under test. */
export function mkDifficulty(over: Partial<BotDifficulty> = {}): BotDifficulty {
  return {
    reactionDelayTicks: 1,
    aimTolerance: 8,
    aimErrorChance: 0,
    dodgeChance: 0,
    dashChance: 0,
    ...over
  };
}

export function mkCtx(difficulty: BotDifficulty, seed = 1, arena: ArenaData = blankArena()): BotContext {
  return { rng: createRng(seed), difficulty, arena };
}

/** A fully-typed player at rest; override only what a test cares about. */
export function mkPlayer(over: Partial<PlayerState> & Pick<PlayerState, "slot" | "x" | "y">): PlayerState {
  return {
    id: over.slot + 1,
    team: null,
    vx: 0,
    vy: 0,
    facing: 1,
    quiver: ["normal", "normal", "normal"],
    alive: true,
    grounded: true,
    coyoteTicksLeft: 0,
    jumpBufferTicksLeft: 0,
    prevJumpHeld: false,
    prevShootHeld: false,
    prevDashHeld: false,
    dashTicksLeft: 0,
    dashCooldownTicksLeft: 0,
    dashDir: 1,
    jumpCutAvailable: false,
    wallJumpLockTicksLeft: 0,
    invisibleTicksLeft: 0,
    flightTicksLeft: 0,
    shielded: false,
    ...over
  };
}

export function mkArrow(over: Partial<ArrowState> & Pick<ArrowState, "id" | "x" | "y">): ArrowState {
  return {
    ownerSlot: 99,
    kind: "normal",
    phase: "flying",
    firedTick: 0,
    bouncesLeft: 0,
    pierced: false,
    insideSolid: false,
    vx: 0,
    vy: 0,
    ...over
  };
}

/** Minimal running-round state wrapping a set of players and arrows. */
export function mkState(players: PlayerState[], arrows: ArrowState[] = [], chests: SimState["chests"] = []): SimState {
  return {
    tick: 0,
    round: { phase: "running", winner: null, restartTicksLeft: 0, number: 1 },
    match: { scores: players.map(() => 0), winner: null, teamScores: null },
    players,
    arrows,
    chests,
    boosters: [],
    nextChestTick: 999999
  };
}
