/** Shell-side parsing of content/players.json. Key codes and colors are
 *  device/render concerns, so unlike arena/tuning this validator does NOT
 *  live in the sim. Spec 003 reshaped the file to separate slot identity
 *  (name/color, up to 4 players) from the shared keyboard binding profiles. */

const ACTION_KEYS = ["left", "right", "up", "down", "jump", "shoot", "dash", "build"] as const;
type Action = (typeof ACTION_KEYS)[number];

export type KeyBindings = Record<Action, string>;

/** One player slot's device-independent identity. Devices are bound to slots
 *  in the lobby (join order), not in this file. */
export interface SlotConfig {
  slot: number;
  name: string;
  /** CSS hex color, e.g. "#4fc3f7". */
  color: string;
}

export interface PlayersConfig {
  /** Slot identities, slot ids unique and non-negative (up to 4 players). */
  slots: SlotConfig[];
  /** Keyboard binding profiles (two: a WASD-style and an arrows-style). */
  keyboards: KeyBindings[];
}

function parseKeyBindings(keys: unknown, where: string): KeyBindings {
  if (typeof keys !== "object" || keys === null) {
    throw new Error(`players: ${where} must be an object`);
  }
  const obj = keys as Record<string, unknown>;
  for (const action of ACTION_KEYS) {
    if (typeof obj[action] !== "string" || (obj[action] as string).length === 0) {
      throw new Error(`players: ${where}.${action} must be a key code string`);
    }
  }
  return obj as KeyBindings;
}

export function parsePlayersConfig(data: unknown): PlayersConfig {
  if (typeof data !== "object" || data === null) {
    throw new Error("players: expected an object");
  }
  const { slots, keyboards } = data as Record<string, unknown>;

  if (!Array.isArray(slots) || slots.length < 2) {
    throw new Error("players: need a slots array of at least 2 entries");
  }
  const seen = new Set<number>();
  const parsedSlots = slots.map((s, i): SlotConfig => {
    if (typeof s !== "object" || s === null) {
      throw new Error(`players: slot ${i} must be an object`);
    }
    const { slot, name, color } = s as Record<string, unknown>;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0) {
      throw new Error(`players: slot ${i} slot must be a non-negative integer`);
    }
    if (seen.has(slot)) {
      throw new Error(`players: duplicate slot id ${slot}`);
    }
    seen.add(slot);
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`players: slot ${i} name must be a non-empty string`);
    }
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error(`players: slot ${i} color must be a #rrggbb hex string`);
    }
    return { slot, name, color };
  });

  if (!Array.isArray(keyboards) || keyboards.length < 1) {
    throw new Error("players: need a keyboards array of at least 1 profile");
  }
  const parsedKeyboards = keyboards.map((k, i) => parseKeyBindings(k, `keyboards[${i}]`));

  return { slots: parsedSlots, keyboards: parsedKeyboards };
}
