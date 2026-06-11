import {
  MIN_SPAWNS,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  SPAWN_GROUND_TOLERANCE
} from "./constants";

/** Logical arena geometry. Fixed for spec 000 (see specs/000-baseline.md). */
export const TILE_SIZE = 16;
export const ARENA_COLS = 20;
export const ARENA_ROWS = 15;
export const ARENA_WIDTH = ARENA_COLS * TILE_SIZE;
export const ARENA_HEIGHT = ARENA_ROWS * TILE_SIZE;

const SOLID = "#";
const EMPTY = ".";
const EPS = 1e-6;

export interface SpawnPoint {
  /** Pixel coordinates of the spawn (player center). */
  x: number;
  y: number;
}

/**
 * One arena, loaded from content/arenas/*.json.
 * `tiles` is ARENA_ROWS strings of ARENA_COLS chars: '#' solid, '.' empty.
 */
export interface ArenaData {
  name: string;
  tiles: string[];
  spawns: SpawnPoint[];
}

export function isSolid(tiles: readonly string[], col: number, row: number): boolean {
  const r = tiles[row];
  return r !== undefined && r[col] === SOLID;
}

/** Tile columns/rows overlapped by an AABB given its center and half extents. */
function overlappedRange(center: number, halfExtent: number): { min: number; max: number } {
  return {
    min: Math.floor((center - halfExtent) / TILE_SIZE),
    max: Math.floor((center + halfExtent - EPS) / TILE_SIZE)
  };
}

function anySolidUnderAabb(
  tiles: readonly string[],
  spawn: SpawnPoint,
  fromY: number,
  toY: number
): boolean {
  const cols = overlappedRange(spawn.x, PLAYER_WIDTH / 2);
  const rowMin = Math.floor(fromY / TILE_SIZE);
  const rowMax = Math.floor((toY - EPS) / TILE_SIZE);
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = cols.min; col <= cols.max; col++) {
      if (isSolid(tiles, col, row)) return true;
    }
  }
  return false;
}

/**
 * Validate untyped data (e.g. parsed JSON) as an arena. Throws an Error with
 * a precise message on the first violation; returns a typed copy on success.
 * Used by the shell at load time and by the future generation pipeline to
 * reject malformed LLM output before spending any simulation on it.
 */
export function parseArena(data: unknown): ArenaData {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("arena: expected an object");
  }
  const { name, tiles, spawns } = data as Record<string, unknown>;

  if (typeof name !== "string" || name.length === 0) {
    throw new Error("arena: name must be a non-empty string");
  }
  if (!Array.isArray(tiles)) {
    throw new Error(`arena "${name}": tiles must be an array of strings`);
  }
  if (tiles.length !== ARENA_ROWS) {
    throw new Error(`arena "${name}": expected ${ARENA_ROWS} tile rows, got ${tiles.length}`);
  }
  tiles.forEach((row, r) => {
    if (typeof row !== "string") {
      throw new Error(`arena "${name}": row ${r} must be a string`);
    }
    if (row.length !== ARENA_COLS) {
      throw new Error(`arena "${name}": row ${r} must be ${ARENA_COLS} chars, got ${row.length}`);
    }
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch !== SOLID && ch !== EMPTY) {
        throw new Error(`arena "${name}": row ${r} col ${c} has invalid char "${ch}"`);
      }
    }
  });

  if (!Array.isArray(spawns)) {
    throw new Error(`arena "${name}": spawns must be an array`);
  }
  if (spawns.length < MIN_SPAWNS) {
    throw new Error(`arena "${name}": at least ${MIN_SPAWNS} spawns required, got ${spawns.length}`);
  }

  const typedTiles = tiles as string[];
  const halfW = PLAYER_WIDTH / 2;
  const halfH = PLAYER_HEIGHT / 2;

  const typedSpawns = spawns.map((s, i): SpawnPoint => {
    if (typeof s !== "object" || s === null) {
      throw new Error(`arena "${name}": spawn ${i} must be an object`);
    }
    const { x, y } = s as Record<string, unknown>;
    if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) {
      throw new Error(`arena "${name}": spawn ${i} must have finite numeric x and y`);
    }
    if (x - halfW < 0 || x + halfW > ARENA_WIDTH || y - halfH < 0 || y + halfH > ARENA_HEIGHT) {
      throw new Error(
        `arena "${name}": spawn ${i} at (${x},${y}) places the player hitbox outside the arena`
      );
    }
    // Spawn-inside-solid check: the player AABB must not overlap any solid tile.
    if (anySolidUnderAabb(typedTiles, { x, y }, y - halfH, y + halfH)) {
      throw new Error(`arena "${name}": spawn ${i} at (${x},${y}) overlaps a solid tile`);
    }
    // Spawn-on-ground check: solid ground within tolerance below the feet.
    const feet = y + halfH;
    if (!anySolidUnderAabb(typedTiles, { x, y }, feet, feet + SPAWN_GROUND_TOLERANCE)) {
      throw new Error(
        `arena "${name}": spawn ${i} at (${x},${y}) is not above ground ` +
          `(no solid tile within ${SPAWN_GROUND_TOLERANCE}px below feet)`
      );
    }
    return { x, y };
  });

  return { name, tiles: [...typedTiles], spawns: typedSpawns };
}
