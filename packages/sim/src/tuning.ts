/**
 * Shape of content/tuning.json (hard rule 3: the ONLY place tunables live).
 * Durations are in milliseconds; the sim converts to ticks at init.
 */
export interface Tuning {
  gravity: number;
  maxFallSpeed: number;
  runSpeed: number;
  airAccel: number;
  jumpVelocity: number;
  jumpCutFactor: number;
  coyoteTimeMs: number;
  jumpBufferMs: number;
  arrowSpeed: number;
  arrowGravity: number;
  stompBounceVelocity: number;
  roundRestartDelayMs: number;
  startingArrows: number;
}
