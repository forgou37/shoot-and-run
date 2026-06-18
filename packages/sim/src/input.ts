/**
 * Plain per-player, per-tick input struct. The shell translates devices
 * (keyboard/gamepad) into these; the sim never sees key codes.
 */
export interface PlayerInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  shoot: boolean;
  /** Dash: a short fast horizontal burst (ground or air), edge-triggered. */
  dash: boolean;
  /** Build: deploy a wall booster charge in front of the player (spec 018),
   *  edge-triggered like shoot/dash. */
  build: boolean;
}

export function emptyInput(): PlayerInput {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    shoot: false,
    dash: false,
    build: false
  };
}

/**
 * The shared 8-way aim direction from this tick's held direction keys: a unit
 * vector toward the held octant, or horizontally toward `facing` when no
 * direction is held. Firing (handleShooting) and building (handleBuilding) both
 * read this, so an arrow and a wall built on the same tick share an aim by
 * construction. Diagonal components are exactly ±Math.SQRT1_2, so derived
 * quantities (e.g. wall rotation) stay JSON-stable and deterministic.
 */
export function aimDir(input: PlayerInput, facing: 1 | -1): { nx: number; ny: number } {
  const dirX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dirY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dirX === 0 && dirY === 0) return { nx: facing, ny: 0 };
  const len = Math.sqrt(dirX * dirX + dirY * dirY);
  return { nx: dirX / len, ny: dirY / len };
}
