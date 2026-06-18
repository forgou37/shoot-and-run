import type { ArenaData } from "./arena";
import { collectPickups, handleShooting, updateArrows } from "./arrow";
import { updateBoosters } from "./booster";
import { updateChests } from "./chest";
import type { SimEvent } from "./events";
import type { PlayerInput } from "./input";
import { checkArrowKills, checkStomps, resolveExplosions } from "./kills";
import { updatePlayer } from "./player";
import { createRng, type Rng } from "./rng";
import { updateRound } from "./round";
import { deepClone, type SimSnapshot } from "./snapshot";
import type { SimState } from "./state";
import { deriveTuning, type DerivedTuning, type Tuning } from "./tuning";
import { handleBuilding, resolveWallCollisions } from "./wall";

export const SIM_VERSION = "0.0.0";

export * from "./arena";
export * from "./arrow";
export * from "./booster";
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
export * from "./wall";
export * from "./wire";
export type { SimSnapshot } from "./snapshot";

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
  /**
   * Deep, JSON-serializable capture of all state needed to resume bit-exactly:
   * SimState + RNG state + entity-id counter. The snapshot owns no references
   * into the live sim. Restore with `createSimFromSnapshot` (spec 008).
   */
  snapshot(): SimSnapshot;
  /**
   * The deterministic entity-id allocator's next value — hidden state that
   * lives outside `SimState` (a closure counter). Exposed for snapshot/restore
   * (spec 008); reading is harmless. NOT for use during normal play —
   * `step()` owns the counter, and reseeding it mid-round corrupts entity
   * identity. Restore reseeds it once, before the first `step()`.
   */
  getEntityIdCounter(): number;
  setEntityIdCounter(value: number): void;
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

/**
 * The shared sim engine: given already-resolved init constants, a seeded/restored
 * RNG, a live SimState, and the entity-id counter's current value, returns the
 * Sim. Both createSim (fresh) and createSimFromSnapshot (restore) funnel through
 * here, so the step logic exists in exactly one place — the determinism proof
 * covers the restore path for free.
 */
function buildSim(
  arena: ArenaData,
  initialTuning: DerivedTuning,
  friendlyFire: boolean,
  rng: Rng,
  state: SimState,
  initialNextEntityId: number
): Sim {
  let tuning = initialTuning;
  let nextEntityId = initialNextEntityId;
  const allocId = (): number => nextEntityId++;

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
          updatePlayer(p, inputs[i]!, arena, tuning);
        });
        resolveWallCollisions(state.players, state.walls);
        checkStomps(state.players, tuning, events, state.tick, friendlyFire);
        handleBuilding(state.players, inputs, state.walls, allocId, tuning, events, state.tick);
        handleShooting(state.players, inputs, state.arrows, allocId, tuning, events, state.tick);
        updateArrows(arena, state.arrows, state.walls, tuning, events, state.tick);
        checkArrowKills(state.arrows, state.players, events, state.tick, friendlyFire);
        resolveExplosions(state.arrows, state.players, tuning, events, state.tick, friendlyFire);
        state.arrows = collectPickups(
          state.arrows.filter((a) => a.phase !== "spent"),
          state.players,
          events,
          state.tick
        );
        updateChests(state, arena, rng, allocId, tuning, events);
        updateBoosters(state, tuning, events);
      }
      updateRound(state, arena, tuning, events);
      state.tick++;
      return events;
    },
    setTuning(next: Tuning): void {
      tuning = deriveTuning(next);
    },
    snapshot(): SimSnapshot {
      return {
        version: SIM_VERSION,
        state: deepClone(state),
        rngState: rng.getState(),
        nextEntityId
      };
    },
    getEntityIdCounter(): number {
      return nextEntityId;
    },
    setEntityIdCounter(value: number): void {
      nextEntityId = value >>> 0;
    }
  };
}

export function createSim(config: SimConfig): Sim {
  // The only randomness source in the sim (hard rule 4). Unused until
  // gameplay needs it, but seeded at init so the seed is part of the
  // sim's identity from tick 0.
  const rng: Rng = createRng(config.seed);
  const tuning = deriveTuning(config.tuning);

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
        wallJumpLockTicksLeft: 0,
        jumpCutAvailable: false,
        invisibleTicksLeft: 0,
        flightTicksLeft: 0,
        shielded: false,
        wallCharges: 0,
        prevBuildHeld: false
      };
    }),
    arrows: [],
    chests: [],
    boosters: [],
    walls: [],
    nextChestTick: tuning.chestIntervalTicks
  };

  return buildSim(config.arena, tuning, friendlyFire, rng, state, nextEntityId);
}

/**
 * Init constants for restoring a sim from a snapshot — the session contract the
 * snapshot intentionally does NOT carry. Seed is absent: the RNG is restored
 * from the snapshot's captured state, not reseeded.
 */
export interface RestoreConfig {
  arena: ArenaData;
  tuning: Tuning;
  players: PlayerSlotConfig[];
  friendlyFire?: boolean;
}

/**
 * Rebuild a sim from a snapshot so it is step()-for-step() identical to the
 * sim the snapshot came from. The snapshot supplies the mutable state (SimState
 * + RNG + entity-id counter); the caller supplies the immutable session
 * constants (arena/tuning/players/friendlyFire), which must match the original
 * session. (spec 008, T8.2)
 */
export function createSimFromSnapshot(snapshot: SimSnapshot, config: RestoreConfig): Sim {
  const state = deepClone(snapshot.state);
  if (config.players.length !== state.players.length) {
    throw new Error(
      `restore: config has ${config.players.length} players but the snapshot has ` +
        `${state.players.length}`
    );
  }
  const rng: Rng = createRng(0);
  rng.setState(snapshot.rngState);
  const tuning = deriveTuning(config.tuning);
  const friendlyFire = config.friendlyFire ?? true;

  return buildSim(config.arena, tuning, friendlyFire, rng, state, snapshot.nextEntityId);
}
