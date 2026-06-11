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
  arrowSpeed: number;
  arrowGravity: number;
  stompBounceVelocity: number;
  roundRestartDelayMs: number;
  startingArrows: number;
  /** Round wins needed to take the match (best-of-N). */
  roundsToWin: number;
  matchRestartDelayMs: number;
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
  "arrowSpeed",
  "arrowGravity",
  "stompBounceVelocity",
  "roundRestartDelayMs",
  "startingArrows",
  "roundsToWin",
  "matchRestartDelayMs"
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
}

export function deriveTuning(t: Tuning): DerivedTuning {
  return {
    ...t,
    coyoteTicks: msToTicks(t.coyoteTimeMs),
    jumpBufferTicks: msToTicks(t.jumpBufferMs),
    roundRestartDelayTicks: msToTicks(t.roundRestartDelayMs),
    matchRestartDelayTicks: msToTicks(t.matchRestartDelayMs)
  };
}
