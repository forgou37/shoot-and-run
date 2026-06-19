import { ARENA_HEIGHT, ARENA_WIDTH } from "./arena";
import {
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  WALL_HALF_LENGTH,
  WALL_HALF_THICKNESS
} from "./constants";
import type { SimEvent } from "./events";
import { aimDir, type PlayerInput } from "./input";
import { wrapDelta, wrapMod } from "./physics";
import type { PlayerState, WallState } from "./state";
import type { DerivedTuning } from "./tuning";

const PLAYER_HALF_W = PLAYER_WIDTH / 2;
const PLAYER_HALF_H = PLAYER_HEIGHT / 2;

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
 * Local axes of a wall's oriented box: `u` is the long (24px) axis, `v` the thin
 * (4px) axis, both unit and perpendicular. Derived from `rotation` with exact
 * constants (0 / ±1 / ±Math.SQRT1_2) so the wall's stored state stays JSON-stable
 * and the collision is bit-deterministic. By construction `u` is perpendicular to
 * the aim that built the wall (a wall blocks across the line of fire).
 */
export interface WallAxes {
  ux: number;
  uy: number;
  vx: number;
  vy: number;
}

const SQRT1_2 = Math.SQRT1_2;

export function wallAxes(rotation: 0 | 45 | 90 | 135): WallAxes {
  switch (rotation) {
    case 0:
      return { ux: 0, uy: 1, vx: 1, vy: 0 };
    case 90:
      return { ux: 1, uy: 0, vx: 0, vy: 1 };
    case 45:
      return { ux: SQRT1_2, uy: SQRT1_2, vx: SQRT1_2, vy: -SQRT1_2 };
    case 135:
      return { ux: -SQRT1_2, uy: SQRT1_2, vx: SQRT1_2, vy: SQRT1_2 };
  }
}

/**
 * Player-vs-wall solidity (spec 018). Runs right after the per-player move loop,
 * before stomps. Each alive player's AABB is pushed out of every wall's oriented
 * box by discrete minimum-overlap SAT (wrap-aware). Neutral: every player is
 * blocked, the builder included; team/friendly-fire is irrelevant.
 *
 * Discrete (no sweep) is tunnel-safe for players: the overlap band on a wall's
 * thin face is playerHalf + wallHalfThick = 6 + 2 = 8px each side; the fastest
 * player step is dashSpeed·DT = 5px < 8px, so a player can never skip a wall's
 * broad face in one tick.
 */
export function resolveWallCollisions(players: PlayerState[], walls: readonly WallState[]): void {
  if (walls.length === 0) return;
  for (const p of players) {
    if (!p.alive) continue;
    for (const w of walls) pushOutOfWall(p, w);
  }
}

/** Push one player out of one wall along the minimum-overlap SAT axis. No-op if
 *  they do not overlap (any axis separates). */
function pushOutOfWall(p: PlayerState, w: WallState): void {
  const ax = wallAxes(w.rotation);
  // Player→wall center delta, wrap-aware.
  const dx = wrapDelta(w.x - p.x, ARENA_WIDTH);
  const dy = wrapDelta(w.y - p.y, ARENA_HEIGHT);

  // Candidate SAT axes (all unit): player x, player y, wall u, wall v.
  const axes: readonly { x: number; y: number }[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: ax.ux, y: ax.uy },
    { x: ax.vx, y: ax.vy }
  ];

  let minOverlap = Infinity;
  let nx = 0;
  let ny = 0; // unit outward normal (away from the wall) of the min-overlap axis
  for (const a of axes) {
    const rP = PLAYER_HALF_W * Math.abs(a.x) + PLAYER_HALF_H * Math.abs(a.y);
    const rW =
      WALL_HALF_LENGTH * Math.abs(ax.ux * a.x + ax.uy * a.y) +
      WALL_HALF_THICKNESS * Math.abs(ax.vx * a.x + ax.vy * a.y);
    const dist = dx * a.x + dy * a.y; // signed center distance along a
    const overlap = rP + rW - Math.abs(dist);
    if (overlap <= 0) return; // separating axis → no collision
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const dir = dist >= 0 ? -1 : 1; // wall on +a side ⇒ push player to -a
      nx = a.x * dir;
      ny = a.y * dir;
    }
  }

  // Push out (axes are unit, so |normal·overlap| == overlap).
  p.x = wrapMod(p.x + nx * minOverlap, ARENA_WIDTH);
  p.y = wrapMod(p.y + ny * minOverlap, ARENA_HEIGHT);
  // Kill only the velocity component heading into the wall (preserve sliding).
  const vn = p.vx * nx + p.vy * ny;
  if (vn < 0) {
    p.vx -= vn * nx;
    p.vy -= vn * ny;
  }
  // Mostly-upward push ⇒ the player is standing on the wall: ground them.
  if (ny < 0 && Math.abs(ny) >= Math.abs(nx)) {
    p.grounded = true;
    p.coyoteTicksLeft = 0;
    p.jumpCutAvailable = false;
  }
}

/** A flying arrow's contact with a wall along its move this tick. */
export interface WallHit {
  wall: WallState;
  /** Wrapped contact point to snap the arrow to. */
  x: number;
  y: number;
  /** Entry parameter along the move segment, in [0, 1]. */
  t: number;
}

/**
 * Earliest wall an arrow's swept move (pre → post) crosses this tick, or null.
 * Arrows move ~5.8px/tick — larger than a wall's 4px thickness — so a discrete
 * test would tunnel; this sweeps. The arrow is modelled as a point against each
 * wall's oriented box inflated by the arrow's half-extents (Minkowski), using the
 * slab method in the wall's local frame. Wrap-aware via shortest deltas (a single
 * tick's move is far smaller than the arena, so the nearest wall image is right).
 */
export function earliestWallHit(
  preX: number,
  preY: number,
  postX: number,
  postY: number,
  arrowHalfW: number,
  arrowHalfH: number,
  walls: readonly WallState[]
): WallHit | null {
  const mdx = wrapDelta(postX - preX, ARENA_WIDTH);
  const mdy = wrapDelta(postY - preY, ARENA_HEIGHT);

  let best: WallHit | null = null;
  for (const w of walls) {
    const ax = wallAxes(w.rotation);
    // Segment start relative to the wall center, projected into local (u, v).
    const rx = wrapDelta(preX - w.x, ARENA_WIDTH);
    const ry = wrapDelta(preY - w.y, ARENA_HEIGHT);
    const su = rx * ax.ux + ry * ax.uy;
    const sv = rx * ax.vx + ry * ax.vy;
    const du = mdx * ax.ux + mdy * ax.uy;
    const dv = mdx * ax.vx + mdy * ax.vy;
    // Wall half-extents inflated by the arrow's AABB projected onto each axis.
    const halfU =
      WALL_HALF_LENGTH + Math.abs(arrowHalfW * ax.ux) + Math.abs(arrowHalfH * ax.uy);
    const halfV =
      WALL_HALF_THICKNESS + Math.abs(arrowHalfW * ax.vx) + Math.abs(arrowHalfH * ax.vy);
    const t = segmentBoxEntry(su, sv, du, dv, halfU, halfV);
    if (t !== null && (best === null || t < best.t)) {
      best = {
        wall: w,
        x: wrapMod(preX + t * mdx, ARENA_WIDTH),
        y: wrapMod(preY + t * mdy, ARENA_HEIGHT),
        t
      };
    }
  }
  return best;
}

const SEG_EPS = 1e-9;

/**
 * Slab method: entry parameter t ∈ [0, 1] where the segment (start s, delta d)
 * first enters the axis-aligned box [-hx, hx] × [-hy, hy], or null if it never
 * does. Returns 0 if the segment starts inside the box.
 */
function segmentBoxEntry(
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  hx: number,
  hy: number
): number | null {
  let tmin = 0;
  let tmax = 1;
  // X slab.
  if (Math.abs(dx) < SEG_EPS) {
    if (sx < -hx || sx > hx) return null;
  } else {
    let t1 = (-hx - sx) / dx;
    let t2 = (hx - sx) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Y slab.
  if (Math.abs(dy) < SEG_EPS) {
    if (sy < -hy || sy > hy) return null;
  } else {
    let t1 = (-hy - sy) / dy;
    let t2 = (hy - sy) / dy;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

/**
 * Drop walls whose lifetime has elapsed (spec 018), in build order. A timed
 * despawn reuses the wall_destroyed event an arrow dissolve emits, so the shell's
 * dissolve FX and the net codec need no new event. Returns the survivors.
 */
export function expireWalls(walls: WallState[], events: SimEvent[], tick: number): WallState[] {
  if (walls.length === 0) return walls;
  const survivors: WallState[] = [];
  for (const w of walls) {
    if (tick >= w.expireTick) {
      events.push({ tick, type: "wall_destroyed", wallId: w.id, x: w.x, y: w.y });
    } else {
      survivors.push(w);
    }
  }
  return survivors;
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
    const wall: WallState = {
      id: allocId(),
      ownerSlot: p.slot,
      x,
      y,
      rotation,
      expireTick: tick + t.wallLifetimeTicks
    };
    walls.push(wall);
    events.push({ tick, type: "wall_built", wallId: wall.id, slot: p.slot, x, y, rotation });
  });
}
