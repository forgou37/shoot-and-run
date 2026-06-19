import { TICK_RATE } from "./constants";

/**
 * Shape of content/tuning.json (hard rule 3: the ONLY place tunables live).
 * Durations are in milliseconds; the sim converts to ticks at init.
 */
export interface Tuning {
  gravity: number;
  maxFallSpeed: number;
  runSpeed: number;
  airAccel: number;
  jumpVelocity: number;
  jumpCutFactor: number;
  coyoteTimeMs: number;
  jumpBufferMs: number;
  /** Capped descent speed while wall-sliding (px/s), well below maxFallSpeed. */
  wallSlideSpeed: number;
  /** Speed of a wall jump's launch; used for BOTH the up and away-from-wall
   *  components, so the launch leaves the wall at exactly 45° (px/s). */
  wallJumpSpeed: number;
  /** How long air control is suspended after a wall jump so its 45° launch arc
   *  holds instead of being clamped straight back to run speed. */
  wallJumpControlLockMs: number;
  /** Horizontal speed during a dash burst (px/s). */
  dashSpeed: number;
  /** How long one dash burst lasts. */
  dashDurationMs: number;
  /** Cooldown after a dash before another is allowed. */
  dashCooldownMs: number;
  arrowSpeed: number;
  arrowGravity: number;
  stompBounceVelocity: number;
  roundRestartDelayMs: number;
  startingArrows: number;
  /** Round wins needed to take the match (best-of-N). */
  roundsToWin: number;
  matchRestartDelayMs: number;
  /** Kill radius of a bomb-arrow explosion (player center distance, px). */
  bombRadiusPx: number;
  /** Wall/floor reflections a bouncing arrow makes before sticking. */
  arrowBounceCount: number;
  invisibilityDurationMs: number;
  flightDurationMs: number;
  /** Upward impulse per mid-air jump press while flight is active. */
  flapVelocity: number;
  /** Interval between chest spawn attempts. */
  chestIntervalMs: number;
  maxChestsAlive: number;
  specialArrowsPerChest: number;
  /** Height a popped booster floats above its chest's spot before pickup (px). */
  boosterFloatOffsetPx: number;
  /** Distance in front of the player center where a built wall spawns (spec 018, px). */
  wallBuildDistancePx: number;
  /** Build charges granted per "wall" booster collected (integer ≥ 1, spec 018). */
  wallChargesPerPickup: number;
  /** Lifetime of a built wall before it dissolves on its own (ms, spec 018). */
  wallLifetimeMs: number;
  /** "No homo" shield duration (ms, spec 019, Igor B). */
  noHomoDurationMs: number;
  /** Radius within which a kill source is negated by an active "No homo" shield
   *  (px, spec 019). Stomps are always negated regardless of distance. */
  noHomoRadiusPx: number;
  /** "Blackout" duration (ms, spec 019, Maks). */
  blackoutDurationMs: number;
  /** "Where am I?" phase duration per charge (ms, spec 019, Igor Sh). */
  phaseDurationMs: number;
  /** Phase charges granted per character booster (integer ≥ 1, spec 019). */
  phaseCharges: number;
  /** Seeker arrow speed as a fraction of arrowSpeed (spec 019, Lyosha). */
  seekerSpeedFactor: number;
  /** Seeker arrows granted per character booster (integer ≥ 1, spec 019). */
  seekerArrowsPerPickup: number;
}

const TUNING_KEYS: readonly (keyof Tuning)[] = [
  "gravity",
  "maxFallSpeed",
  "runSpeed",
  "airAccel",
  "jumpVelocity",
  "jumpCutFactor",
  "coyoteTimeMs",
  "jumpBufferMs",
  "wallSlideSpeed",
  "wallJumpSpeed",
  "wallJumpControlLockMs",
  "dashSpeed",
  "dashDurationMs",
  "dashCooldownMs",
  "arrowSpeed",
  "arrowGravity",
  "stompBounceVelocity",
  "roundRestartDelayMs",
  "startingArrows",
  "roundsToWin",
  "matchRestartDelayMs",
  "bombRadiusPx",
  "arrowBounceCount",
  "invisibilityDurationMs",
  "flightDurationMs",
  "flapVelocity",
  "chestIntervalMs",
  "maxChestsAlive",
  "specialArrowsPerChest",
  "boosterFloatOffsetPx",
  "wallBuildDistancePx",
  "wallChargesPerPickup",
  "wallLifetimeMs",
  "noHomoDurationMs",
  "noHomoRadiusPx",
  "blackoutDurationMs",
  "phaseDurationMs",
  "phaseCharges",
  "seekerSpeedFactor",
  "seekerArrowsPerPickup"
];

/** Validate untyped data (parsed content/tuning.json) as a Tuning object. */
export function parseTuning(data: unknown): Tuning {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("tuning: expected an object");
  }
  const obj = data as Record<string, unknown>;
  for (const key of TUNING_KEYS) {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`tuning: ${key} must be a finite number`);
    }
  }
  const t = obj as unknown as Tuning;
  if (t.jumpCutFactor < 0 || t.jumpCutFactor > 1) {
    throw new Error("tuning: jumpCutFactor must be in [0, 1]");
  }
  if (!Number.isInteger(t.startingArrows) || t.startingArrows < 0) {
    throw new Error("tuning: startingArrows must be a non-negative integer");
  }
  if (!Number.isInteger(t.roundsToWin) || t.roundsToWin < 1) {
    throw new Error("tuning: roundsToWin must be a positive integer");
  }
  if (!Number.isInteger(t.maxChestsAlive) || t.maxChestsAlive < 0) {
    throw new Error("tuning: maxChestsAlive must be a non-negative integer");
  }
  if (!Number.isInteger(t.specialArrowsPerChest) || t.specialArrowsPerChest < 1) {
    throw new Error("tuning: specialArrowsPerChest must be a positive integer");
  }
  if (!Number.isInteger(t.wallChargesPerPickup) || t.wallChargesPerPickup < 1) {
    throw new Error("tuning: wallChargesPerPickup must be a positive integer");
  }
  if (t.wallLifetimeMs <= 0) {
    throw new Error("tuning: wallLifetimeMs must be positive");
  }
  if (!Number.isInteger(t.phaseCharges) || t.phaseCharges < 1) {
    throw new Error("tuning: phaseCharges must be a positive integer");
  }
  if (t.seekerSpeedFactor <= 0) {
    throw new Error("tuning: seekerSpeedFactor must be positive");
  }
  if (!Number.isInteger(t.seekerArrowsPerPickup) || t.seekerArrowsPerPickup < 1) {
    throw new Error("tuning: seekerArrowsPerPickup must be a positive integer");
  }
  return TUNING_KEYS.reduce((acc, key) => {
    acc[key] = t[key];
    return acc;
  }, {} as Tuning);
}

export function msToTicks(ms: number): number {
  return Math.round((ms * TICK_RATE) / 1000);
}

/** Tuning plus tick-converted durations, computed once at sim init. */
export interface DerivedTuning extends Tuning {
  coyoteTicks: number;
  jumpBufferTicks: number;
  roundRestartDelayTicks: number;
  matchRestartDelayTicks: number;
  invisibilityTicks: number;
  flightTicks: number;
  chestIntervalTicks: number;
  dashTicks: number;
  dashCooldownTicks: number;
  wallJumpLockTicks: number;
  wallLifetimeTicks: number;
  noHomoTicks: number;
  blackoutTicks: number;
  phaseTicks: number;
}

export function deriveTuning(t: Tuning): DerivedTuning {
  return {
    ...t,
    coyoteTicks: msToTicks(t.coyoteTimeMs),
    jumpBufferTicks: msToTicks(t.jumpBufferMs),
    dashTicks: msToTicks(t.dashDurationMs),
    dashCooldownTicks: msToTicks(t.dashCooldownMs),
    wallJumpLockTicks: msToTicks(t.wallJumpControlLockMs),
    roundRestartDelayTicks: msToTicks(t.roundRestartDelayMs),
    matchRestartDelayTicks: msToTicks(t.matchRestartDelayMs),
    invisibilityTicks: msToTicks(t.invisibilityDurationMs),
    flightTicks: msToTicks(t.flightDurationMs),
    chestIntervalTicks: msToTicks(t.chestIntervalMs),
    wallLifetimeTicks: msToTicks(t.wallLifetimeMs),
    noHomoTicks: msToTicks(t.noHomoDurationMs),
    blackoutTicks: msToTicks(t.blackoutDurationMs),
    phaseTicks: msToTicks(t.phaseDurationMs)
  };
}
