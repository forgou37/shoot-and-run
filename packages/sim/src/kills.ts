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
        p.alive = false;
        events.push({
          tick,
          type: "player_killed",
          victim: p.slot,
          killer: a.ownerSlot,
          cause: "arrow"
        });
        a.phase = "stuck";
        a.vx = 0;
        a.vy = 0;
        events.push({ tick, type: "arrow_stuck", arrowId: a.id, x: a.x, y: a.y });
        break;
      }
    }
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
        cause: "stomp"
      });
      attacker.vy = -t.stompBounceVelocity;
      attacker.grounded = false;
      attacker.coyoteTicksLeft = 0;
      attacker.jumpCutAvailable = false;
    }
  }
}
