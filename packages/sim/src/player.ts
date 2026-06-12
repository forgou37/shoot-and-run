import type { ArenaData } from "./arena";
import { DT, PLAYER_HEIGHT, PLAYER_WIDTH } from "./constants";
import type { PlayerInput } from "./input";
import { isSupported, moveAxisX, moveAxisY } from "./physics";
import type { PlayerState } from "./state";
import type { DerivedTuning } from "./tuning";

const HALF_W = PLAYER_WIDTH / 2;
const HALF_H = PLAYER_HEIGHT / 2;

/**
 * One tick of movement for one player. Mutates `p` in place.
 *
 * Order matters and is part of the determinism contract:
 * input edges → horizontal velocity → gravity → jump (buffer + coyote) →
 * jump cut → integrate X → integrate Y → grounded/coyote bookkeeping.
 */
export function updatePlayer(
  p: PlayerState,
  input: PlayerInput,
  arena: ArenaData,
  t: DerivedTuning
): void {
  const jumpPressed = input.jump && !p.prevJumpHeld;
  const jumpReleased = !input.jump && p.prevJumpHeld;

  if (jumpPressed) {
    p.jumpBufferTicksLeft = t.jumpBufferTicks;
  }

  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    p.facing = dir as 1 | -1;
  }

  if (p.grounded) {
    // Instant accelerate/stop on the ground: tight controls.
    p.vx = dir * t.runSpeed;
  } else if (dir !== 0) {
    // Air control: accelerate toward the held direction, keep momentum otherwise.
    p.vx += dir * t.airAccel * DT;
    if (p.vx > t.runSpeed) p.vx = t.runSpeed;
    if (p.vx < -t.runSpeed) p.vx = -t.runSpeed;
  }

  if (!p.grounded) {
    p.vy += t.gravity * DT;
    if (p.vy > t.maxFallSpeed) p.vy = t.maxFallSpeed;
  }

  let jumpedThisTick = false;
  const groundJump = p.grounded || p.coyoteTicksLeft > 0;
  if (p.jumpBufferTicksLeft > 0 && (groundJump || p.flightTicksLeft > 0)) {
    // Flight: mid-air presses flap with flapVelocity; from the ground it's a
    // normal jump even while the power-up is active.
    p.vy = groundJump ? -t.jumpVelocity : -t.flapVelocity;
    p.grounded = false;
    p.coyoteTicksLeft = 0;
    p.jumpBufferTicksLeft = 0;
    p.jumpCutAvailable = groundJump;
    jumpedThisTick = true;
  }

  // Variable jump height: releasing jump while still rising cuts the ascent.
  if (jumpReleased && p.vy < 0 && p.jumpCutAvailable) {
    p.vy *= t.jumpCutFactor;
    p.jumpCutAvailable = false;
  }
  if (p.vy >= 0) {
    p.jumpCutAvailable = false;
  }

  const wasGrounded = p.grounded || jumpedThisTick;

  const movedX = moveAxisX(arena, p.x, p.y, HALF_W, HALF_H, p.vx * DT);
  p.x = movedX.pos;
  if (movedX.hit) p.vx = 0;

  const movedY = moveAxisY(arena, p.x, p.y, HALF_W, HALF_H, p.vy * DT);
  p.y = movedY.pos;
  const landed = movedY.hit && p.vy > 0;
  if (movedY.hit) p.vy = 0;

  const supported = p.vy >= 0 && isSupported(arena, p.x, p.y, HALF_W, HALF_H);
  p.grounded = landed || (p.grounded && supported);

  if (p.grounded) {
    p.coyoteTicksLeft = 0;
  } else if (wasGrounded && !jumpedThisTick) {
    // Walked off a ledge this tick: open the coyote window.
    p.coyoteTicksLeft = t.coyoteTicks;
  } else if (p.coyoteTicksLeft > 0) {
    p.coyoteTicksLeft--;
  }

  if (p.jumpBufferTicksLeft > 0) {
    p.jumpBufferTicksLeft--;
  }
  if (p.invisibleTicksLeft > 0) p.invisibleTicksLeft--;
  if (p.flightTicksLeft > 0) p.flightTicksLeft--;

  p.prevJumpHeld = input.jump;
}
