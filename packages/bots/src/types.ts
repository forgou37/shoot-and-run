import type { ArenaData, PlayerInput, Rng, SimState } from "@shoot-and-run/sim";

/**
 * Per-difficulty behavioral knobs — all data, loaded from content/bots.json
 * (spec 004 hard rule: bot behavior is tunable data, not hardcoded numbers).
 */
export interface BotDifficulty {
  /** Re-evaluate target/threat selection only every N ticks; higher = sluggish. */
  reactionDelayTicks: number;
  /** Perpendicular slack (px) within which the bot considers a shot lined up. */
  aimTolerance: number;
  /** Per-opportunity chance [0,1] to fumble a shot (hesitate this tick). */
  aimErrorChance: number;
  /** Chance [0,1] to actually react to an incoming arrow when one threatens. */
  dodgeChance: number;
  /** Chance [0,1] to spend a dash when closing distance or evading. */
  dashChance: number;
}

/**
 * Everything a bot reads beyond the live SimState: its OWN seeded RNG (never
 * the sim's PRNG — sharing it would desync chest spawns), the difficulty knobs,
 * and the static arena geometry for wall/ledge sensing.
 */
export interface BotContext {
  rng: Rng;
  difficulty: BotDifficulty;
  arena: ArenaData;
}

/**
 * Mutable per-bot scratch carried across ticks. Internal to the policy; created
 * by `createBotMemory()`. Holds edge-pulse state (the sim fires/jumps/dashes on
 * rising edges, so a bot must release between actions) and the reaction timer.
 */
export interface BotMemory {
  /** Ticks until the next target/threat re-evaluation (reaction delay). */
  decisionTicksLeft: number;
  /** Cached target slot from the last evaluation (may be dead now). */
  targetSlot: number | null;
  /** Whether a threat was present last tick (dodge rolls on the rising edge). */
  wasThreatened: boolean;
  /** Ticks of committed evasive action remaining. */
  dodgeTicksLeft: number;
  /** Locked horizontal direction of the current dodge. */
  dodgeDir: 1 | -1;
  /** Cooldown before the bot will fire again (avoids per-tick spam). */
  fireCooldownLeft: number;
  /** Last tick's emitted held-state, so we can produce clean rising edges. */
  prevJumpOut: boolean;
  prevShootOut: boolean;
  prevDashOut: boolean;
}

/** Pure decision function: (state, my slot, ctx, memory) -> this tick's input. */
export type BotPolicy = (
  state: Readonly<SimState>,
  slot: number,
  ctx: BotContext,
  memory: BotMemory
) => PlayerInput;

/** A stateful bot bound to one slot: call `input(state)` once per sim tick. */
export interface Bot {
  input(state: Readonly<SimState>): PlayerInput;
}
