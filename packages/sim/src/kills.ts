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
 * Friendly-fire gate. With friendly fire off, two players on the same team
 * don't harm each other. Teams are null in FFA, so this never blocks an FFA
 * kill — the `teamA !== null` guard keeps the FFA paths byte-identical.
 */
function spared(friendlyFire: boolean, teamA: number | null, teamB: number | null): boolean {
  return !friendlyFire && teamA !== null && teamA === teamB;
}

/**
 * Shield gate (spec 014). If the victim holds a shield charge, spend it instead
 * of killing: clear the flag, emit `shield_blocked`, and return true so the
 * caller skips the kill (the hit itself — arrow stick, stomp bounce, laser
 * pierce — still resolves). Returns false when there is no shield to spend, and
 * the caller kills normally. The first lethal hit from any cause is absorbed;
 * the next one (no shield) kills.
 */
export function consumeShield(victim: PlayerState, events: SimEvent[], tick: number): boolean {
  if (!victim.shielded) return false;
  victim.shielded = false;
  events.push({ tick, type: "shield_blocked", slot: victim.slot });
  return true;
}

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
  tick: number,
  friendlyFire: boolean
): void {
  for (const a of arrows) {
    if (a.phase !== "flying") continue;
    const { hw, hh } = arrowHalves(a);
    const ownerTeam = teamOf(players, a.ownerSlot);
    for (const p of players) {
      if (!p.alive) continue;
      if (p.slot === a.ownerSlot && tick - a.firedTick < MUZZLE_IMMUNITY_TICKS) continue;
      const dx = wrapDelta(p.x - a.x, ARENA_WIDTH);
      const dy = wrapDelta(p.y - a.y, ARENA_HEIGHT);
      if (Math.abs(dx) < hw + PLAYER_WIDTH / 2 && Math.abs(dy) < hh + PLAYER_HEIGHT / 2) {
        if (spared(friendlyFire, ownerTeam, p.team)) continue; // teammate: pass through
        if (a.kind === "bomb") {
          // Bombs detonate on body contact; the radius kill (including this
          // player) is resolved in resolveExplosions this same tick (where the
          // shield, if any, is consumed).
          a.phase = "exploding";
          break;
        }
        // A shield absorbs this hit: the victim survives, but the arrow still
        // sticks (becomes a pickup) / a laser still pierces, exactly as a kill.
        if (!consumeShield(p, events, tick)) {
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
        }
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
  tick: number,
  friendlyFire: boolean
): void {
  for (const a of arrows) {
    if (a.phase !== "exploding") continue;
    const ownerTeam = teamOf(players, a.ownerSlot);
    events.push({ tick, type: "arrow_exploded", arrowId: a.id, x: a.x, y: a.y });
    for (const p of players) {
      if (!p.alive) continue;
      if (spared(friendlyFire, ownerTeam, p.team)) continue; // spares teammates (and self)
      const dx = wrapDelta(p.x - a.x, ARENA_WIDTH);
      const dy = wrapDelta(p.y - a.y, ARENA_HEIGHT);
      if (dx * dx + dy * dy <= t.bombRadiusPx * t.bombRadiusPx) {
        if (consumeShield(p, events, tick)) continue; // shield eats the blast
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
  tick: number,
  friendlyFire: boolean
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

      // A teammate stomp (friendly fire off) bounces without killing — heads
      // become platforms. The kill + event are skipped; the bounce still fires.
      // A shield likewise absorbs the stomp (no kill) but the attacker still
      // bounces off the shielded head.
      if (!spared(friendlyFire, attacker.team, victim.team) && !consumeShield(victim, events, tick)) {
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
      }
      attacker.vy = -t.stompBounceVelocity;
      attacker.grounded = false;
      attacker.coyoteTicksLeft = 0;
      attacker.jumpCutAvailable = false;
    }
  }
}

/** Team of the player owning `slot`, or null if not found (FFA → always null). */
function teamOf(players: readonly PlayerState[], slot: number): number | null {
  return players.find((p) => p.slot === slot)?.team ?? null;
}
