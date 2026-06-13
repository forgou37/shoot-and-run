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
}

export function emptyInput(): PlayerInput {
  return { left: false, right: false, up: false, down: false, jump: false, shoot: false, dash: false };
}
