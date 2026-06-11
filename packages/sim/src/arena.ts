/** Logical arena geometry. Fixed for spec 000 (see specs/000-baseline.md). */
export const TILE_SIZE = 16;
export const ARENA_COLS = 20;
export const ARENA_ROWS = 15;
export const ARENA_WIDTH = ARENA_COLS * TILE_SIZE;
export const ARENA_HEIGHT = ARENA_ROWS * TILE_SIZE;

export interface SpawnPoint {
  /** Pixel coordinates of the spawn (player center). */
  x: number;
  y: number;
}

/**
 * One arena, loaded from content/arenas/*.json.
 * `tiles` is ARENA_ROWS strings of ARENA_COLS chars: '#' solid, '.' empty.
 * Validation lives in T0.3; this is the shape contract.
 */
export interface ArenaData {
  name: string;
  tiles: string[];
  spawns: SpawnPoint[];
}
