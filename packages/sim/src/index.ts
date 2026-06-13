import type { ArenaData } from "./arena";
import { collectPickups, handleShooting, updateArrows } from "./arrow";
import { updateChests } from "./chest";
import type { SimEvent } from "./events";
import type { PlayerInput } from "./input";
import { checkArrowKills, checkStomps, resolveExplosions } from "./kills";
import { updatePlayer } from "./player";
import { createRng, type Rng } from "./rng";
import { updateRound } from "./round";
import type { SimState } from "./state";
import { deriveTuning, type Tuning } from "./tuning";

export const SIM_VERSION = "0.0.0";

export * from "./arena";
export * from "./arrow";
export * from "./chest";
export * from "./constants";
export * from "./events";
export * from "./input";
export * from "./kills";
export * from "./physics";
export * from "./rng";
export * from "./round";
export * from "./state";
export * from "./tuning";

export interface PlayerSlotConfig {
  slot: number;
  /** Team id for teams mode. All players carry one or none (validated at init);
   *  if all carry one, the sim runs in teams mode. */
  team?: 0 | 1;
}

export interface SimConfig {
  arena: ArenaData;
  tuning: Tuning;
  players: PlayerSlotConfig[];
  seed: number;
  /** Teams mode only: when false, same-team players can't harm each other
   *  (arrows/lasers pass through, bombs and stomps spare teammates). Default true. */
  friendlyFire?: boolean;
}

export interface Sim {
  /** Readonly snapshot for rendering and stats. Never mutate from outside. */
  readonly state: Readonly<SimState>;
  /**
   * Advance exactly one 60 Hz tick. `inputs[i]` belongs to `players[i]`
   * from SimConfig. Returns the events emitted during this tick.
   */
  step(inputs: readonly PlayerInput[]): SimEvent[];
  /**
   * Swap tuning mid-run (dev hot-reload). Applies from the next tick;
   * startingArrows takes effect on the next round reset. Replays and the
   * determinism proof always pin one tuning snapshot at init instead.
   */
  setTuning(next: Tuning): void;
}

/**
 * Teams mode is implied by every player carrying a team. Validates all-or-none
 * (a partial team assignment is a config bug) and that both teams are non-empty.
 */
function resolveTeamsMode(players: readonly PlayerSlotConfig[]): boolean {
  const withTeam = players.filter((p) => p.team === 0 || p.team === 1);
  if (withTeam.length === 0) return false; // FFA
  if (withTeam.length !== players.length) {
    throw new Error("teams: either all players carry a team or none do");
  }
  if (!players.some((p) => p.team === 0) || !players.some((p) => p.team === 1)) {
    throw new Error("teams: both team 0 and team 1 must be non-empty");
  }
  return true;
}

export function createSim(config: SimConfig): Sim {
  // The only randomness source in the sim (hard rule 4). Unused until
  // gameplay needs it, but seeded at init so the seed is part of the
  // sim's identity from tick 0.
  const rng: Rng = createRng(config.seed);
  let tuning = deriveTuning(config.tuning);

  const teamsMode = resolveTeamsMode(config.players);
  const friendlyFire = config.friendlyFire ?? true;

  let nextEntityId = 1;
  const allocId = (): number => nextEntityId++;

  const state: SimState = {
    tick: 0,
    round: { phase: "running", winner: null, restartTicksLeft: 0, number: 1 },
    match: {
      scores: config.players.map(() => 0),
      winner: null,
      teamScores: teamsMode ? [0, 0] : null
    },
    players: config.players.map((p, index) => {
      const spawn = config.arena.spawns[index];
      if (!spawn) {
        throw new Error(
          `Arena "${config.arena.name}" has ${config.arena.spawns.length} spawns, ` +
            `but player index ${index} needs one`
        );
      }
      return {
        id: allocId(),
        slot: p.slot,
        team: teamsMode ? (p.team as number) : null,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        facing: 1 as const,
        quiver: Array.from({ length: config.tuning.startingArrows }, () => "normal" as const),
        alive: true,
        grounded: false,
        coyoteTicksLeft: 0,
        jumpBufferTicksLeft: 0,
        prevJumpHeld: false,
        prevShootHeld: false,
        prevDashHeld: false,
        dashTicksLeft: 0,
        dashCooldownTicksLeft: 0,
        dashDir: 1 as const,
        jumpCutAvailable: false,
        invisibleTicksLeft: 0,
        flightTicksLeft: 0
      };
    }),
    arrows: [],
    chests: [],
    nextChestTick: tuning.chestIntervalTicks
  };

  return {
    get state(): Readonly<SimState> {
      return state;
    },
    step(inputs: readonly PlayerInput[]): SimEvent[] {
      if (inputs.length !== state.players.length) {
        throw new Error(
          `step() got ${inputs.length} inputs for ${state.players.length} players`
        );
      }
      const events: SimEvent[] = [];
      if (state.tick === 0) {
        events.push({ tick: 0, type: "round_started" });
      }
      if (state.round.phase === "running") {
        state.players.forEach((p, i) => {
          if (!p.alive) return;
          updatePlayer(p, inputs[i]!, config.arena, tuning);
        });
        checkStomps(state.players, tuning, events, state.tick, friendlyFire);
        handleShooting(state.players, inputs, state.arrows, allocId, tuning, events, state.tick);
        updateArrows(config.arena, state.arrows, tuning, events, state.tick);
        checkArrowKills(state.arrows, state.players, events, state.tick, friendlyFire);
        resolveExplosions(state.arrows, state.players, tuning, events, state.tick, friendlyFire);
        state.arrows = collectPickups(
          state.arrows.filter((a) => a.phase !== "spent"),
          state.players,
          events,
          state.tick
        );
        updateChests(state, config.arena, rng, allocId, tuning, events);
      }
      updateRound(state, config.arena, tuning, events);
      state.tick++;
      return events;
    },
    setTuning(next: Tuning): void {
      tuning = deriveTuning(next);
    }
  };
}
