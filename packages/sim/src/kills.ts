import { ARENA_HEIGHT, ARENA_WIDTH } from "./arena";
import { arrowHalves } from "./arrow";
import {
  MUZZLE_IMMUNITY_TICKS,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  STOMP_TOLERANCE
} from "./constants";
import type { SimEvent } from "./events";
import { wrapDelta } from "./physics";
import type { ArrowState, PlayerState } from "./state";
import type { DerivedTuning } from "./tuning";

/**
 * Flying-arrow-vs-player overlap, wrap-aware. One hit kills. The shooter is
 * immune to their own arrow for MUZZLE_IMMUNITY_TICKS after firing (the arrow
 * spawns at the player's center); after that, your own arrow can kill you.
 * A killing arrow stops at the impact point and becomes a pickup.
 */
export function checkArrowKills(
  arrows: ArrowState[],
  players: PlayerState[],
  events: SimEvent[],
  tick: number
): void {
  for (const a of arrows) {
    if (a.phase !== "flying") continue;
    const { hw, hh } = arrowHalves(a);
    for (const p of players) {
      if (!p.alive) continue;
      if (p.slot === a.ownerSlot && tick - a.firedTick < MUZZLE_IMMUNITY_TICKS) continue;
      const dx = wrapDelta(p.x - a.x, ARENA_WIDTH);
      const dy = wrapDelta(p.y - a.y, ARENA_HEIGHT);
      if (Math.abs(dx) < hw + PLAYER_WIDTH / 2 && Math.abs(dy) < hh + PLAYER_HEIGHT / 2) {
        if (a.kind === "bomb") {
          // Bombs detonate on body contact; the radius kill (including this
          // player) is resolved in resolveExplosions this same tick.
          a.phase = "exploding";
          break;
        }
        p.alive = false;
        events.push({
          tick,
          type: "player_killed",
          victim: p.slot,
          killer: a.ownerSlot,
          cause: "arrow",
          x: p.x,
          y: p.y
        });
        if (a.kind === "laser") {
          continue; // lasers pierce: keep flying, keep scanning
        }
        a.phase = "stuck";
        a.vx = 0;
        a.vy = 0;
        events.push({ tick, type: "arrow_stuck", arrowId: a.id, x: a.x, y: a.y });
        break;
      }
    }
  }
}

/** Resolve bombs marked exploding this tick: radius kill (cause "bomb",
 *  shooter included — no muzzle immunity for blasts), then mark spent.
 *  Exploded arrows are removed and never become pickups. */
export function resolveExplosions(
  arrows: ArrowState[],
  players: PlayerState[],
  t: DerivedTuning,
  events: SimEvent[],
  tick: number
): void {
  for (const a of arrows) {
    if (a.phase !== "exploding") continue;
    events.push({ tick, type: "arrow_exploded", arrowId: a.id, x: a.x, y: a.y });
    for (const p of players) {
      if (!p.alive) continue;
      const dx = wrapDelta(p.x - a.x, ARENA_WIDTH);
      const dy = wrapDelta(p.y - a.y, ARENA_HEIGHT);
      if (dx * dx + dy * dy <= t.bombRadiusPx * t.bombRadiusPx) {
        p.alive = false;
        events.push({
          tick,
          type: "player_killed",
          victim: p.slot,
          killer: a.ownerSlot,
          cause: "bomb",
          x: p.x,
          y: p.y
        });
      }
    }
    a.phase = "spent";
  }
}

/**
 * Stomp: attacker's feet inside the victim's head band while moving downward
 * relative to the victim. The killer bounces. Side overlap is never a kill —
 * players pass through each other.
 */
export function checkStomps(
  players: PlayerState[],
  t: DerivedTuning,
  events: SimEvent[],
  tick: number
): void {
  for (const attacker of players) {
    if (!attacker.alive) continue;
    for (const victim of players) {
      if (victim === attacker || !victim.alive) continue;
      if (attacker.vy - victim.vy <= 0) continue;
      const dx = wrapDelta(attacker.x - victim.x, ARENA_WIDTH);
      if (Math.abs(dx) >= PLAYER_WIDTH) continue;
      const feetToHead = wrapDelta(
        attacker.y + PLAYER_HEIGHT / 2 - (victim.y - PLAYER_HEIGHT / 2),
        ARENA_HEIGHT
      );
      if (feetToHead < 0 || feetToHead > STOMP_TOLERANCE) continue;

      victim.alive = false;
      events.push({
        tick,
        type: "player_killed",
        victim: victim.slot,
        killer: attacker.slot,
        cause: "stomp",
        x: victim.x,
        y: victim.y
      });
      attacker.vy = -t.stompBounceVelocity;
      attacker.grounded = false;
      attacker.coyoteTicksLeft = 0;
      attacker.jumpCutAvailable = false;
    }
  }
}
