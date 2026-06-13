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

/** Default 2-keyboard FFA roster — the spec 000 boot path and ?quickstart=1. */
export function quickstartConfig(
  devices: readonly InputDevice[],
  slots: SlotConfig[],
  seed: number
): MatchConfig {
  const roster: RosterEntry[] = devices
    .filter((d) => d.kind === "keyboard")
    .slice(0, 2)
    .map((device, i) => ({ slot: slots[i]!, device, team: null }));
  return { roster, friendlyFire: true, seed };
}
