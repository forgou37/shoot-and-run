/**
 * Wrap-aware perception primitives — pure functions of SimState the behavior
 * stack composes. Everything uses `wrapDelta` so targeting takes the shortest
 * path across the screen seams (an opponent just off the left edge is "near").
 */
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PLAYER_HEIGHT,
  wrapDelta,
  type ArrowState,
  type PlayerInput,
  type PlayerState,
  type SimState
} from "@shoot-and-run/sim";
import { THREAT_HORIZON_S, THREAT_RADIUS_PX } from "./constants";

export interface Vec {
  dx: number;
  dy: number;
}

/** Shortest signed vector from `from` to `to` on the wrapping arena torus. */
export function wrapVecTo(from: { x: number; y: number }, to: { x: number; y: number }): Vec {
  return {
    dx: wrapDelta(to.x - from.x, ARENA_WIDTH),
    dy: wrapDelta(to.y - from.y, ARENA_HEIGHT)
  };
}

/** The bot's own player record, or undefined if it isn't in the round. */
export function findSelf(state: Readonly<SimState>, slot: number): PlayerState | undefined {
  return state.players.find((p) => p.slot === slot);
}

/** Alive players the bot may attack: not itself, and — in teams mode — not a
 *  teammate. In FFA (`me.team === null`) everyone else is fair game. */
export function opponentsOf(me: PlayerState, state: Readonly<SimState>): PlayerState[] {
  return state.players.filter(
    (p) => p.alive && p.slot !== me.slot && (me.team === null || p.team !== me.team)
  );
}

/** Nearest attackable opponent by wrap distance, or null if none are alive. */
export function nearestOpponent(me: PlayerState, opponents: readonly PlayerState[]): PlayerState | null {
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const o of opponents) {
    const { dx, dy } = wrapVecTo(me, o);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

export interface Pickup {
  x: number;
  y: number;
  kind: "arrow" | "chest";
}

/** Nearest thing worth walking to when out of ammo: a stuck arrow (+1) or a
 *  chest (special arrows / power-up). Nearest overall wins. */
export function nearestPickup(me: PlayerState, state: Readonly<SimState>): Pickup | null {
  let best: Pickup | null = null;
  let bestD = Infinity;
  const consider = (x: number, y: number, kind: Pickup["kind"]): void => {
    const { dx, dy } = wrapVecTo(me, { x, y });
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = { x, y, kind };
    }
  };
  for (const a of state.arrows) {
    if (a.phase === "stuck") consider(a.x, a.y, "arrow");
  }
  for (const c of state.chests) {
    consider(c.x, c.y, "chest");
  }
  return best;
}

/**
 * The most imminent incoming arrow, or null. Considers only flying arrows the
 * bot didn't fire, projects each along its velocity, and keeps the one whose
 * closest approach to the bot lands within THREAT_RADIUS_PX inside the horizon.
 */
export function nearestThreat(me: PlayerState, state: Readonly<SimState>): ArrowState | null {
  let best: ArrowState | null = null;
  let bestT = Infinity;
  for (const a of state.arrows) {
    if (a.phase !== "flying" || a.ownerSlot === me.slot) continue;
    const r = wrapVecTo(a, me); // arrow → me
    const vv = a.vx * a.vx + a.vy * a.vy;
    if (vv < 1e-6) continue;
    const t = (r.dx * a.vx + r.dy * a.vy) / vv; // seconds to closest approach
    if (t < 0 || t > THREAT_HORIZON_S) continue; // moving away, or too far off
    const missX = r.dx - a.vx * t;
    const missY = r.dy - a.vy * t;
    if (missX * missX + missY * missY <= THREAT_RADIUS_PX * THREAT_RADIUS_PX && t < bestT) {
      bestT = t;
      best = a;
    }
  }
  return best;
}

/** Steer horizontally toward a wrap-target x; sets left/right on `input` and
 *  returns the chosen direction (0 if already aligned within a pixel). */
export function moveToward(input: PlayerInput, me: PlayerState, targetX: number): -1 | 0 | 1 {
  const dx = wrapDelta(targetX - me.x, ARENA_WIDTH);
  if (dx > 1) {
    input.right = true;
    return 1;
  }
  if (dx < -1) {
    input.left = true;
    return -1;
  }
  return 0;
}

export interface Aim {
  dirX: -1 | 0 | 1;
  dirY: -1 | 0 | 1;
  /** Target lies within `tolerance` of one of the 8 aim rays. */
  aligned: boolean;
  /** Straight-line wrap distance to the target (px). */
  dist: number;
}

/** Resolve an 8-directional aim at a point and whether the bot is lined up to
 *  hit it within `tolerance` px of perpendicular slack. Pure; no firing here. */
export function aimAt(me: PlayerState, tx: number, ty: number, tolerance: number): Aim {
  const dx = wrapDelta(tx - me.x, ARENA_WIDTH);
  const dy = wrapDelta(ty - me.y, ARENA_HEIGHT);
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const sx = (dx > 0 ? 1 : dx < 0 ? -1 : 0) as -1 | 0 | 1;
  const sy = (dy > 0 ? 1 : dy < 0 ? -1 : 0) as -1 | 0 | 1;
  let dirX: -1 | 0 | 1 = 0;
  let dirY: -1 | 0 | 1 = 0;
  let aligned = false;
  if (ady <= tolerance && sx !== 0) {
    dirX = sx; // horizontal shot
    aligned = true;
  } else if (adx <= tolerance && sy !== 0) {
    dirY = sy; // vertical shot
    aligned = true;
  } else if (Math.abs(adx - ady) <= tolerance && sx !== 0 && sy !== 0) {
    dirX = sx; // diagonal shot
    dirY = sy;
    aligned = true;
  }
  return { dirX, dirY, aligned, dist: Math.hypot(dx, dy) };
}

/**
 * Face a target and hold the directional keys that aim at it (so the next
 * shoot press flies the right way), returning whether a shot is worth taking
 * now — i.e. lined up within `tolerance` and inside `range`. Does NOT press
 * shoot: the caller owns the fire cooldown and rising-edge pulse.
 */
export function faceAndFire(
  input: PlayerInput,
  me: PlayerState,
  tx: number,
  ty: number,
  tolerance: number,
  range: number
): boolean {
  const aim = aimAt(me, tx, ty, tolerance);
  if (aim.dirX === 1) input.right = true;
  else if (aim.dirX === -1) input.left = true;
  if (aim.dirY === 1) input.down = true;
  else if (aim.dirY === -1) input.up = true;
  return aim.aligned && aim.dist <= range;
}

/** True when an opponent is below the bot and horizontally lined up enough that
 *  dropping (no jump, let gravity work) could land a stomp. */
export function stompTargetBelow(me: PlayerState, opponents: readonly PlayerState[]): PlayerState | null {
  for (const o of opponents) {
    const { dx, dy } = wrapVecTo(me, o);
    if (dy > 0 && dy < PLAYER_HEIGHT * 4 && Math.abs(dx) < PLAYER_HEIGHT) return o;
  }
  return null;
}
