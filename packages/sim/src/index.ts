import type { ArenaData } from "./arena";
import type { SimEvent } from "./events";
import type { PlayerInput } from "./input";
import { createRng, type Rng } from "./rng";
import type { SimState } from "./state";
import type { Tuning } from "./tuning";

export const SIM_VERSION = "0.0.0";

export * from "./arena";
export * from "./events";
export * from "./input";
export * from "./rng";
export * from "./state";
export * from "./tuning";

export interface PlayerSlotConfig {
  slot: number;
}

export interface SimConfig {
  arena: ArenaData;
  tuning: Tuning;
  players: PlayerSlotConfig[];
  seed: number;
}

export interface Sim {
  /** Readonly snapshot for rendering and stats. Never mutate from outside. */
  readonly state: Readonly<SimState>;
  /**
   * Advance exactly one 60 Hz tick. `inputs[i]` belongs to `players[i]`
   * from SimConfig. Returns the events emitted during this tick.
   */
  step(inputs: readonly PlayerInput[]): SimEvent[];
}

export function createSim(config: SimConfig): Sim {
  // The only randomness source in the sim (hard rule 4). Unused until
  // gameplay needs it, but seeded at init so the seed is part of the
  // sim's identity from tick 0.
  const _rng: Rng = createRng(config.seed);

  let nextEntityId = 1;
  const allocId = (): number => nextEntityId++;

  const state: SimState = {
    tick: 0,
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
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        facing: 1 as const,
        arrows: config.tuning.startingArrows,
        alive: true
      };
    }),
    arrows: []
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
        // Proper round state machine lands in T0.8.
        events.push({ tick: 0, type: "round_started" });
      }
      // T0.4: movement & collision. T0.6: arrows. T0.7: kills. T0.8: round flow.
      state.tick++;
      return events;
    }
  };
}
