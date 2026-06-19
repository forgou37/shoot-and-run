import type { ArenaData } from "./arena";
import { DT, PLAYER_HEIGHT, PLAYER_WIDTH } from "./constants";
import type { PlayerInput } from "./input";
import { isAgainstWall, isSupported, moveAxisX, moveAxisY } from "./physics";
import type { PlayerState } from "./state";
import type { DerivedTuning } from "./tuning";

const HALF_W = PLAYER_WIDTH / 2;
const HALF_H = PLAYER_HEIGHT / 2;

/**
 * One tick of movement for one player. Mutates `p` in place.
 *
 * Order matters and is part of the determinism contract:
 * input edges → dash start → horizontal velocity / gravity / wall-slide →
 * jump (buffer + coyote; ground / wall / flap) → jump cut → integrate X →
 * integrate Y → grounded/coyote bookkeeping → dash + wall-jump-lock timers.
 */
export function updatePlayer(
  p: PlayerState,
  input: PlayerInput,
  arena: ArenaData,
  t: DerivedTuning
): void {
  const jumpPressed = input.jump && !p.prevJumpHeld;
  const jumpReleased = !input.jump && p.prevJumpHeld;
  const dashPressed = input.dash && !p.prevDashHeld;

  if (jumpPressed) {
    p.jumpBufferTicksLeft = t.jumpBufferTicks;
  }

  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    p.facing = dir as 1 | -1;
  }

  // Dash: a short fast horizontal burst, available on the ground or in the air.
  // It locks a direction (held dir, else facing), overrides run/air control and
  // suspends gravity so the slide stays flat and fixed-length.
  if (dashPressed && p.dashTicksLeft === 0 && p.dashCooldownTicksLeft === 0) {
    p.dashTicksLeft = t.dashTicks;
    p.dashDir = (dir !== 0 ? dir : p.facing) as 1 | -1;
  }
  const dashing = p.dashTicksLeft > 0;

  if (dashing) {
    p.vx = p.dashDir * t.dashSpeed;
    p.vy = 0;
  } else {
    if (p.grounded) {
      // Instant accelerate/stop on the ground: tight controls.
      p.vx = dir * t.runSpeed;
    } else if (dir !== 0 && p.wallJumpLockTicksLeft === 0) {
      // Air control: accelerate toward the held direction, keep momentum
      // otherwise. Suspended briefly after a wall jump so its 45° launch arc
      // isn't immediately clamped back toward run speed.
      p.vx += dir * t.airAccel * DT;
      if (p.vx > t.runSpeed) p.vx = t.runSpeed;
      if (p.vx < -t.runSpeed) p.vx = -t.runSpeed;
    }

    if (!p.grounded) {
      p.vy += t.gravity * DT;
      if (p.vy > t.maxFallSpeed) p.vy = t.maxFallSpeed;
      // Wall slide: while falling and pressing into an adjacent wall, cling and
      // slide down at a capped speed instead of free-falling.
      if (p.vy > t.wallSlideSpeed && dir !== 0 && isAgainstWall(arena, p.x, p.y, HALF_W, HALF_H, dir)) {
        p.vy = t.wallSlideSpeed;
      }
    }
  }

  let jumpedThisTick = false;
  const groundJump = p.grounded || p.coyoteTicksLeft > 0;
  if (p.jumpBufferTicksLeft > 0) {
    // Wall jump: airborne and clinging to a wall (pressing into an adjacent
    // wall) — launch off it at 45°, away from the wall and upward. Ranks below
    // a ground/coyote jump and above a mid-air flap.
    const wallJump =
      !groundJump && dir !== 0 && isAgainstWall(arena, p.x, p.y, HALF_W, HALF_H, dir);
    if (groundJump || wallJump || p.flightTicksLeft > 0) {
      if (wallJump) {
        // Equal away-from-wall and upward components ⇒ a 45° launch. Suspend
        // air control briefly so the arc holds, and turn to face the leap.
        p.vx = -dir * t.wallJumpSpeed;
        p.vy = -t.wallJumpSpeed;
        p.facing = -dir as 1 | -1;
        p.wallJumpLockTicksLeft = t.wallJumpLockTicks;
      } else {
        // Flight: mid-air presses flap with flapVelocity; from the ground it's a
        // normal jump even while the power-up is active.
        p.vy = groundJump ? -t.jumpVelocity : -t.flapVelocity;
      }
      p.grounded = false;
      p.coyoteTicksLeft = 0;
      p.jumpBufferTicksLeft = 0;
      p.jumpCutAvailable = groundJump || wallJump;
      jumpedThisTick = true;
      // A jump cancels an in-progress dash (and arms its cooldown).
      if (p.dashTicksLeft > 0) {
        p.dashTicksLeft = 0;
        p.dashCooldownTicksLeft = t.dashCooldownTicks;
      }
    }
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
    p.wallJumpLockTicksLeft = 0;
  } else if (wasGrounded && !jumpedThisTick) {
    // Walked off a ledge this tick: drop straight down by shedding carried run
    // momentum (no parabolic launch), and open the coyote window. Holding a
    // direction still steers via air control; a dash off the edge is preserved.
    if (!dashing) p.vx = 0;
    p.coyoteTicksLeft = t.coyoteTicks;
  } else if (p.coyoteTicksLeft > 0) {
    p.coyoteTicksLeft--;
  }

  // Dash timers: count the active burst down, then hold the cooldown.
  if (p.dashTicksLeft > 0) {
    p.dashTicksLeft--;
    if (p.dashTicksLeft === 0) p.dashCooldownTicksLeft = t.dashCooldownTicks;
  } else if (p.dashCooldownTicksLeft > 0) {
    p.dashCooldownTicksLeft--;
  }

  if (p.jumpBufferTicksLeft > 0) {
    p.jumpBufferTicksLeft--;
  }
  if (p.wallJumpLockTicksLeft > 0) {
    p.wallJumpLockTicksLeft--;
  }
  if (p.invisibleTicksLeft > 0) p.invisibleTicksLeft--;
  if (p.flightTicksLeft > 0) p.flightTicksLeft--;
  if (p.noHomoTicksLeft > 0) p.noHomoTicksLeft--;

  p.prevJumpHeld = input.jump;
  p.prevDashHeld = input.dash;
}
