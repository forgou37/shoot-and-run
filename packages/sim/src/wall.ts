import { ARENA_HEIGHT, ARENA_WIDTH } from "./arena";
import type { SimEvent } from "./events";
import { aimDir, type PlayerInput } from "./input";
import { wrapMod } from "./physics";
import type { PlayerState, WallState } from "./state";
import type { DerivedTuning } from "./tuning";

/**
 * Deployable walls (spec 018). Pressing build spends one charge and spawns a
 * thin 4×24 solid plank `wallBuildDistancePx` in front of the player, oriented
 * perpendicular to the aim. Collision (player + arrow vs wall) lives in
 * collision/arrow code; this module just places walls.
 */

/**
 * Sprite rotation of the base (vertical) wall for an aim unit vector. The wall's
 * long axis is perpendicular to the aim:
 *  - horizontal aim (ny == 0) → vertical wall → 0
 *  - vertical aim (nx == 0) → horizontal wall → 90
 *  - diagonals → 45 ("/" aim) or 135 ("\" aim)
 * aimDir emits exact 0 / ±Math.SQRT1_2 components, so these comparisons are
 * exact and deterministic.
 */
export function wallRotation(nx: number, ny: number): 0 | 45 | 90 | 135 {
  if (ny === 0) return 0;
  if (nx === 0) return 90;
  // Same-sign components ("\" aim) → 135; opposite-sign ("/" aim) → 45.
  return nx > 0 === ny > 0 ? 135 : 45;
}

/**
 * Per alive player, on the build-press edge: if a charge is available, spend one
 * and append a wall placed in front of the player along the aim direction.
 * Building with no charge is a no-op (no event, no charge change). Mirrors
 * handleShooting's edge bookkeeping (prevBuildHeld updated for alive players).
 */
export function handleBuilding(
  players: PlayerState[],
  inputs: readonly PlayerInput[],
  walls: WallState[],
  allocId: () => number,
  t: DerivedTuning,
  events: SimEvent[],
  tick: number
): void {
  players.forEach((p, i) => {
    if (!p.alive) return;
    const input = inputs[i]!;
    const pressed = input.build && !p.prevBuildHeld;
    p.prevBuildHeld = input.build;
    if (!pressed || p.wallCharges <= 0) return;

    p.wallCharges--;
    const { nx, ny } = aimDir(input, p.facing);
    const x = wrapMod(p.x + nx * t.wallBuildDistancePx, ARENA_WIDTH);
    const y = wrapMod(p.y + ny * t.wallBuildDistancePx, ARENA_HEIGHT);
    const rotation = wallRotation(nx, ny);
    const wall: WallState = { id: allocId(), ownerSlot: p.slot, x, y, rotation };
    walls.push(wall);
    events.push({ tick, type: "wall_built", wallId: wall.id, slot: p.slot, x, y, rotation });
  });
}
