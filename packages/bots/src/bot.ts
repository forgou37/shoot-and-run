/**
 * The bot policy: a small fixed priority stack — dodge → engage → scavenge —
 * producing one PlayerInput per tick from the live SimState. Pure and
 * deterministic given the bot's own seeded RNG (see `botSeed`); it never reads
 * the sim's PRNG, so it can't desync chest spawns.
 *
 * The sim triggers jump/shoot/dash on rising edges only, so "wants" computed by
 * the behaviors are converted to clean press/release pulses at the very end.
 */
import {
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  createRng,
  emptyInput,
  isAgainstWall,
  type ArenaData,
  type ArrowState,
  type PlayerInput,
  type PlayerState,
  type SimState
} from "@shoot-and-run/sim";
import {
  DASH_CLOSE_RANGE_PX,
  DODGE_TICKS,
  FIRE_COOLDOWN_TICKS,
  FIRE_RANGE_PX,
  PREFERRED_RANGE_PX,
  VERTICAL_REACH_PX
} from "./constants";
import {
  faceAndFire,
  findSelf,
  moveToward,
  nearestOpponent,
  nearestPickup,
  nearestThreat,
  opponentsOf,
  stompTargetBelow,
  wrapVecTo
} from "./sense";
import type { Bot, BotContext, BotDifficulty, BotMemory } from "./types";

const HALF_W = PLAYER_WIDTH / 2;
const HALF_H = PLAYER_HEIGHT / 2;

/** Per-bot PRNG seed, derived from the match seed and the slot so each bot has
 *  its own deterministic stream (design point in specs/004-bots.md). */
export function botSeed(matchSeed: number, slot: number): number {
  return (matchSeed ^ ((slot + 1) * 0x9e3779b1)) >>> 0;
}

export function createBotMemory(): BotMemory {
  return {
    decisionTicksLeft: 0,
    targetSlot: null,
    wasThreatened: false,
    dodgeTicksLeft: 0,
    dodgeDir: 1,
    fireCooldownLeft: 0,
    prevJumpOut: false,
    prevShootOut: false,
    prevDashOut: false
  };
}

/** Direction to flee an incoming arrow: away from where it currently is. */
function dodgeDirAway(me: PlayerState, threat: ArrowState): 1 | -1 {
  const { dx } = wrapVecTo(threat, me); // threat → me; positive = me is to the right
  if (dx > 0) return 1;
  if (dx < 0) return -1;
  return me.facing;
}

/** Solid wall within reach on the side the bot is currently steering toward. */
function wallAhead(arena: ArenaData, me: PlayerState, input: PlayerInput): boolean {
  const dir = input.right ? 1 : input.left ? -1 : 0;
  return dir !== 0 && isAgainstWall(arena, me.x, me.y, HALF_W, HALF_H, dir);
}

/**
 * One tick of decision-making. Mutates `mem` for cross-tick state; returns this
 * tick's input. Exposed (alongside createBotMemory) for headless unit tests.
 */
export function botTick(
  state: Readonly<SimState>,
  slot: number,
  ctx: BotContext,
  mem: BotMemory
): PlayerInput {
  const out = emptyInput();
  const me = findSelf(state, slot);
  if (!me || !me.alive) {
    // Dead or absent: emit neutral and clear edge/dodge state so a respawn
    // starts from a clean slate (no stale "wants" leaking across rounds).
    mem.prevJumpOut = false;
    mem.prevShootOut = false;
    mem.prevDashOut = false;
    mem.dodgeTicksLeft = 0;
    mem.wasThreatened = false;
    return out;
  }

  if (mem.fireCooldownLeft > 0) mem.fireCooldownLeft--;
  if (mem.decisionTicksLeft > 0) mem.decisionTicksLeft--;

  const { difficulty: diff } = ctx;
  const opponents = opponentsOf(me, state);

  // Reaction delay: only re-pick the target every reactionDelayTicks.
  if (mem.decisionTicksLeft <= 0) {
    const near = nearestOpponent(me, opponents);
    mem.targetSlot = near ? near.slot : null;
    mem.decisionTicksLeft = Math.max(1, Math.round(diff.reactionDelayTicks));
  }
  const target =
    opponents.find((o) => o.slot === mem.targetSlot) ?? nearestOpponent(me, opponents);

  let wantJump = false;
  let wantShoot = false;
  let wantDash = false;

  // --- 1. Dodge (highest priority) ---------------------------------------
  const threat = nearestThreat(me, state);
  if (threat && !mem.wasThreatened && ctx.rng.next() < diff.dodgeChance) {
    mem.dodgeTicksLeft = DODGE_TICKS;
    mem.dodgeDir = dodgeDirAway(me, threat);
  }
  mem.wasThreatened = threat !== null;

  if (mem.dodgeTicksLeft > 0) {
    mem.dodgeTicksLeft--;
    if (mem.dodgeDir === 1) out.right = true;
    else out.left = true;
    if (me.grounded) wantJump = true; // hop over a horizontal shot
    else if (ctx.rng.next() < diff.dashChance) wantDash = true; // juke in the air
  } else if (me.quiver.length > 0 && target) {
    // --- 2a. Engage: aim and close to firing range -----------------------
    const lined = faceAndFire(out, me, target.x, target.y, diff.aimTolerance, FIRE_RANGE_PX);
    const v = wrapVecTo(me, target);
    const gap = Math.abs(v.dx);
    if (!lined || gap > PREFERRED_RANGE_PX) {
      moveToward(out, me, target.x);
      if (
        gap > DASH_CLOSE_RANGE_PX &&
        me.dashCooldownTicksLeft === 0 &&
        ctx.rng.next() < diff.dashChance
      ) {
        wantDash = true;
      }
    }
    if (v.dy < -VERTICAL_REACH_PX && me.grounded) wantJump = true; // target above
    if (me.grounded && wallAhead(ctx.arena, me, out)) wantJump = true; // climb obstacle
    // Fire when lined up and off cooldown; aimErrorChance fumbles the shot.
    if (lined && mem.fireCooldownLeft === 0 && ctx.rng.next() >= diff.aimErrorChance) {
      wantShoot = true;
    }
  } else {
    // --- 2b. Scavenge: out of arrows (or no target) ----------------------
    const stompable = stompTargetBelow(me, opponents);
    if (stompable) {
      moveToward(out, me, stompable.x); // hover over the victim and drop on them
    } else if (me.quiver.length === 0) {
      const pickup = nearestPickup(me, state);
      if (pickup) {
        moveToward(out, me, pickup.x);
        if (wrapVecTo(me, pickup).dy < -VERTICAL_REACH_PX && me.grounded) wantJump = true;
      } else if (target) {
        moveToward(out, me, target.x); // nothing to grab: keep the pressure on
      }
    } else if (target) {
      moveToward(out, me, target.x);
    }
    if (me.grounded && wallAhead(ctx.arena, me, out)) wantJump = true;
  }

  // --- Rising-edge conversion (press only when the want goes false→true) ---
  out.jump = wantJump && !mem.prevJumpOut;
  out.shoot = wantShoot && !mem.prevShootOut;
  out.dash = wantDash && !mem.prevDashOut;
  if (out.shoot) mem.fireCooldownLeft = FIRE_COOLDOWN_TICKS;
  mem.prevJumpOut = out.jump;
  mem.prevShootOut = out.shoot;
  mem.prevDashOut = out.dash;
  return out;
}

export interface MakeBotOptions {
  /** This bot's own PRNG seed — use `botSeed(matchSeed, slot)` for replayable
   *  matches, or any fixed number in tests. */
  seed: number;
  /** Which player slot this bot controls. */
  slot: number;
  difficulty: BotDifficulty;
  arena: ArenaData;
}

/** Build a stateful bot bound to one slot. Call `input(state)` once per tick. */
export function makeBot(opts: MakeBotOptions): Bot {
  const ctx: BotContext = {
    rng: createRng(opts.seed),
    difficulty: opts.difficulty,
    arena: opts.arena
  };
  const mem = createBotMemory();
  return { input: (state) => botTick(state, opts.slot, ctx, mem) };
}
