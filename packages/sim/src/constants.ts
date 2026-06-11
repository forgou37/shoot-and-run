/** Fixed design points from specs/000-baseline.md — deliberately NOT in
 *  content/tuning.json: these define entity geometry and the timing model,
 *  not game feel. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const PLAYER_WIDTH = 12;
export const PLAYER_HEIGHT = 12;

/** Max distance below a spawn's feet where solid ground must exist. */
export const SPAWN_GROUND_TOLERANCE = 32;

export const MIN_SPAWNS = 4;
