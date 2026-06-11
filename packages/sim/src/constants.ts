/** Fixed design points from specs/000-baseline.md — deliberately NOT in
 *  content/tuning.json: these define entity geometry and the timing model,
 *  not game feel. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const PLAYER_WIDTH = 12;
export const PLAYER_HEIGHT = 12;

/** Flying arrows are a long, thin box aligned to their dominant axis. */
export const ARROW_HALF_LONG = 5;
export const ARROW_HALF_SHORT = 2;
/** Distance (player center to arrow) within which a stuck arrow is collected. */
export const PICKUP_RADIUS = 12;

/** Ticks during which an arrow cannot kill its own shooter (muzzle overlap). */
export const MUZZLE_IMMUNITY_TICKS = 6;
/** Vertical band below a victim's head top that counts as a stomp contact. */
export const STOMP_TOLERANCE = 8;

/** Max distance below a spawn's feet where solid ground must exist. */
export const SPAWN_GROUND_TOLERANCE = 32;

export const MIN_SPAWNS = 4;
