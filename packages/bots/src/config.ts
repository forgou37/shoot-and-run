/**
 * Validation for content/bots.json (the difficulty presets). Like the sim's
 * arena/tuning validators this throws a precise Error on the first violation,
 * so the headless eval pipeline and the shell both reject malformed data before
 * spawning a bot. The presets themselves live ONLY in content/bots.json — the
 * bots package never imports content (that would break the purity guard).
 */
import type { BotDifficulty } from "./types";

export interface BotConfig {
  /** Named difficulty presets, e.g. easy/normal/hard. At least one required. */
  difficulties: Record<string, BotDifficulty>;
}

/** [0,1] knobs vs. the rest, validated with the right rule for each. */
const CHANCE_KEYS = ["aimErrorChance", "dodgeChance", "dashChance"] as const;
const POSITIVE_KEYS = ["aimTolerance"] as const;

export function parseBotDifficulty(data: unknown, where: string): BotDifficulty {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`bots: ${where} must be an object`);
  }
  const obj = data as Record<string, unknown>;
  const num = (key: string): number => {
    const v = obj[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`bots: ${where}.${key} must be a finite number`);
    }
    return v;
  };

  const reactionDelayTicks = num("reactionDelayTicks");
  if (!Number.isInteger(reactionDelayTicks) || reactionDelayTicks < 1) {
    throw new Error(`bots: ${where}.reactionDelayTicks must be an integer >= 1`);
  }
  for (const key of POSITIVE_KEYS) {
    if (num(key) <= 0) throw new Error(`bots: ${where}.${key} must be > 0`);
  }
  for (const key of CHANCE_KEYS) {
    const v = num(key);
    if (v < 0 || v > 1) throw new Error(`bots: ${where}.${key} must be in [0, 1]`);
  }

  return {
    reactionDelayTicks,
    aimTolerance: num("aimTolerance"),
    aimErrorChance: num("aimErrorChance"),
    dodgeChance: num("dodgeChance"),
    dashChance: num("dashChance")
  };
}

export function parseBotConfig(data: unknown): BotConfig {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("bots: expected an object");
  }
  const { difficulties } = data as Record<string, unknown>;
  if (typeof difficulties !== "object" || difficulties === null || Array.isArray(difficulties)) {
    throw new Error("bots: difficulties must be an object of named presets");
  }
  const entries = Object.entries(difficulties as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error("bots: at least one difficulty preset is required");
  }
  const parsed: Record<string, BotDifficulty> = {};
  for (const [name, value] of entries) {
    parsed[name] = parseBotDifficulty(value, `difficulties.${name}`);
  }
  return { difficulties: parsed };
}

/** Look up a preset by name, throwing if the config has no such difficulty. */
export function botDifficulty(config: BotConfig, name: string): BotDifficulty {
  const d = config.difficulties[name];
  if (!d) {
    const known = Object.keys(config.difficulties).join(", ");
    throw new Error(`bots: unknown difficulty "${name}" (have: ${known})`);
  }
  return d;
}
