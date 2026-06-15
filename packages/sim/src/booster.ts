import { ARENA_HEIGHT, ARENA_WIDTH } from "./arena";
import { BOOSTER_HEIGHT, BOOSTER_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH } from "./constants";
import type { SimEvent } from "./events";
import { wrapDelta, wrapMod } from "./physics";
import type { BoosterState, ChestContents, PlayerState, SimState } from "./state";
import type { DerivedTuning } from "./tuning";

/**
 * Floating boosters (spec 014). Opening a chest no longer grants instantly: it
 * pops a booster that hovers `boosterFloatOffsetPx` above the chest's spot, and
 * the contents are granted only when an alive player touches the booster. The
 * `grant()` logic moved here from chest.ts so the chest just opens.
 */

/**
 * Spawn a booster floating above an opened chest's spot. It hovers
 * `boosterFloatOffsetPx` overhead (wrap-aware) so the opener can't reach it the
 * same tick — collection needs moving/jumping up to it.
 */
export function spawnBooster(
  state: SimState,
  x: number,
  y: number,
  contents: ChestContents,
  allocId: () => number,
  t: DerivedTuning
): BoosterState {
  const booster: BoosterState = {
    id: allocId(),
    x,
    y: wrapMod(y - t.boosterFloatOffsetPx, ARENA_HEIGHT),
    contents,
    spawnTick: state.tick
  };
  state.boosters.push(booster);
  return booster;
}

/**
 * Pickup-on-contact: an alive player whose AABB overlaps a booster (wrap-aware,
 * same test as chest contact) is granted its contents, the booster is removed,
 * and `booster_collected` fires. The pickup position is fixed — the booster's
 * cosmetic up/down bob is shell-only and never affects this collision.
 */
export function updateBoosters(state: SimState, t: DerivedTuning, events: SimEvent[]): void {
  state.boosters = state.boosters.filter((booster) => {
    for (const p of state.players) {
      if (!p.alive) continue;
      const dx = wrapDelta(p.x - booster.x, ARENA_WIDTH);
      const dy = wrapDelta(p.y - booster.y, ARENA_HEIGHT);
      if (
        Math.abs(dx) < (PLAYER_WIDTH + BOOSTER_WIDTH) / 2 &&
        Math.abs(dy) < (PLAYER_HEIGHT + BOOSTER_HEIGHT) / 2
      ) {
        grant(p, booster.contents, t);
        events.push({
          tick: state.tick,
          type: "booster_collected",
          boosterId: booster.id,
          slot: p.slot,
          contents: booster.contents
        });
        return false;
      }
    }
    return true;
  });
}

/**
 * Apply a chest content to a player. Moved out of chest.ts (spec 014): the grant
 * now happens when the floating booster is collected, not when the chest opens.
 */
export function grant(p: PlayerState, contents: ChestContents, t: DerivedTuning): void {
  switch (contents) {
    case "bomb":
    case "laser":
    case "bounce":
      for (let i = 0; i < t.specialArrowsPerChest; i++) p.quiver.unshift(contents);
      break;
    case "invisibility":
      p.invisibleTicksLeft = t.invisibilityTicks;
      break;
    case "flight":
      p.flightTicksLeft = t.flightTicks;
      break;
  }
}
