/** Shell-side parsing of content/players.json. Key codes and colors are
 *  device/render concerns, so unlike arena/tuning this validator does NOT
 *  live in the sim. */

const ACTION_KEYS = ["left", "right", "up", "down", "jump", "shoot"] as const;
type Action = (typeof ACTION_KEYS)[number];

export type KeyBindings = Record<Action, string>;

export interface PlayerSlotConfig {
  slot: number;
  name: string;
  /** CSS hex color, e.g. "#4fc3f7". */
  color: string;
  /** KeyboardEvent.code values. */
  keys: KeyBindings;
}

export function parsePlayersConfig(data: unknown): PlayerSlotConfig[] {
  if (typeof data !== "object" || data === null) {
    throw new Error("players: expected an object");
  }
  const { players } = data as Record<string, unknown>;
  if (!Array.isArray(players) || players.length < 2) {
    throw new Error("players: need an array of at least 2 player configs");
  }
  return players.map((p, i): PlayerSlotConfig => {
    if (typeof p !== "object" || p === null) {
      throw new Error(`players: entry ${i} must be an object`);
    }
    const { slot, name, color, keys } = p as Record<string, unknown>;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0) {
      throw new Error(`players: entry ${i} slot must be a non-negative integer`);
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`players: entry ${i} name must be a non-empty string`);
    }
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error(`players: entry ${i} color must be a #rrggbb hex string`);
    }
    if (typeof keys !== "object" || keys === null) {
      throw new Error(`players: entry ${i} keys must be an object`);
    }
    const keyObj = keys as Record<string, unknown>;
    for (const action of ACTION_KEYS) {
      if (typeof keyObj[action] !== "string" || keyObj[action].length === 0) {
        throw new Error(`players: entry ${i} keys.${action} must be a key code string`);
      }
    }
    return { slot, name, color, keys: keyObj as KeyBindings };
  });
}
