import { ARENA_HEIGHT, ARENA_WIDTH, type ArenaData } from "./arena";
import { spawnBooster } from "./booster";
import { CHEST_HEIGHT, CHEST_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH } from "./constants";
import type { SimEvent } from "./events";
import { wrapDelta } from "./physics";
import type { Rng } from "./rng";
import type { ChestContents, SimState } from "./state";
import type { DerivedTuning } from "./tuning";

/** Equal weights for now (spec 002 fixed point); weighted tables are backlog. */
const CHEST_CONTENTS_POOL: readonly ChestContents[] = [
  "bomb",
  "laser",
  "bounce",
  "invisibility",
  "flight",
  "shield",
  "wall",
  "character"
];

/**
 * Chest lifecycle, all PRNG-driven and deterministic per seed:
 * every chestIntervalTicks, if below maxChestsAlive and a free spot exists,
 * spawn a chest at a random free spot with random contents. Touching a chest
 * opens it — popping a floating booster (spec 014); the contents are granted
 * later, when a player collects that booster (see booster.ts).
 */
export function updateChests(
  state: SimState,
  arena: ArenaData,
  rng: Rng,
  allocId: () => number,
  t: DerivedTuning,
  events: SimEvent[]
): void {
  const spots = arena.chestSpots ?? [];
  if (spots.length === 0) return;

  if (state.tick >= state.nextChestTick) {
    if (state.chests.length < t.maxChestsAlive) {
      const free = spots.filter(
        (s) => !state.chests.some((c) => c.x === s.x && c.y === s.y)
      );
      if (free.length > 0) {
        const spot = free[rng.nextInt(free.length)]!;
        const contents = CHEST_CONTENTS_POOL[rng.nextInt(CHEST_CONTENTS_POOL.length)]!;
        const chest = { id: allocId(), x: spot.x, y: spot.y, contents };
        state.chests.push(chest);
        events.push({
          tick: state.tick,
          type: "chest_spawned",
          chestId: chest.id,
          x: chest.x,
          y: chest.y,
          contents
        });
      }
    }
    state.nextChestTick = state.tick + t.chestIntervalTicks;
  }

  state.chests = state.chests.filter((chest) => {
    for (const p of state.players) {
      if (!p.alive) continue;
      const dx = wrapDelta(p.x - chest.x, ARENA_WIDTH);
      const dy = wrapDelta(p.y - chest.y, ARENA_HEIGHT);
      if (
        Math.abs(dx) < (PLAYER_WIDTH + CHEST_WIDTH) / 2 &&
        Math.abs(dy) < (PLAYER_HEIGHT + CHEST_HEIGHT) / 2
      ) {
        spawnBooster(state, chest.x, chest.y, chest.contents, allocId, t);
        events.push({
          tick: state.tick,
          type: "chest_opened",
          chestId: chest.id,
          slot: p.slot,
          contents: chest.contents
        });
        return false;
      }
    }
    return true;
  });
}
