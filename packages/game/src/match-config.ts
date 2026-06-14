import type { InputDevice } from "./input/device";
import type { SlotConfig } from "./input/players-config";

/** One player in a match: a slot identity, the device driving it, and a team
 *  (null in free-for-all). */
export interface RosterEntry {
  slot: SlotConfig;
  device: InputDevice;
  team: 0 | 1 | null;
}

/** Everything ArenaScene needs to spin up a sim, assembled by the lobby (or by
 *  BootScene for ?quickstart=1). */
export interface MatchConfig {
  roster: RosterEntry[];
  /** Teams mode only; ignored in FFA. */
  friendlyFire: boolean;
  seed: number;
}

/**
 * Default FFA roster for the spec 000 boot path and ?quickstart=1. With no bot
 * devices this is the original two-keyboard match; with bots (?bots=N) it is one
 * keyboard plus the bot devices, filling slots in order up to the roster cap.
 */
export function quickstartConfig(
  devices: readonly InputDevice[],
  slots: SlotConfig[],
  seed: number,
  botDevices: readonly InputDevice[] = []
): MatchConfig {
  const humanCount = botDevices.length > 0 ? 1 : 2;
  const keyboards = devices.filter((d) => d.kind === "keyboard").slice(0, humanCount);
  const roster: RosterEntry[] = [...keyboards, ...botDevices]
    .slice(0, slots.length)
    .map((device, i) => ({ slot: slots[i]!, device, team: null }));
  return { roster, friendlyFire: true, seed };
}
