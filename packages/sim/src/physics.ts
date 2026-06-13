import {
  ARENA_COLS,
  ARENA_HEIGHT,
  ARENA_ROWS,
  ARENA_WIDTH,
  TILE_SIZE,
  isSolid,
  type ArenaData
} from "./arena";

const EPS = 1e-6;

export function wrapMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Shortest signed delta on a wrapping axis (result in [-range/2, range/2)). */
export function wrapDelta(d: number, range: number): number {
  const r = wrapMod(d, range);
  return r > range / 2 ? r - range : r;
}

/**
 * Wrap-aware solidity lookup: indices may be any integer; they wrap onto the
 * grid. This is what makes an entity straddling an arena edge collide
 * correctly with tiles on the opposite side.
 */
export function solidAt(arena: ArenaData, col: number, row: number): boolean {
  return isSolid(arena.tiles, wrapMod(col, ARENA_COLS), wrapMod(row, ARENA_ROWS));
}

/** Inclusive tile index span overlapped by [center-half, center+half). */
export function tileSpan(center: number, half: number): { min: number; max: number } {
  return {
    min: Math.floor((center - half) / TILE_SIZE),
    max: Math.floor((center + half - EPS) / TILE_SIZE)
  };
}

function colsSolidAtRow(arena: ArenaData, row: number, colMin: number, colMax: number): boolean {
  for (let col = colMin; col <= colMax; col++) {
    if (solidAt(arena, col, row)) return true;
  }
  return false;
}

function rowsSolidAtCol(arena: ArenaData, col: number, rowMin: number, rowMax: number): boolean {
  for (let row = rowMin; row <= rowMax; row++) {
    if (solidAt(arena, col, row)) return true;
  }
  return false;
}

export interface AxisMove {
  pos: number;
  hit: boolean;
}

/**
 * Move an AABB horizontally by dx with tile collision, sweeping column by
 * column (speeds in this game stay well under one tile per tick, but the
 * sweep makes it safe regardless). Returns the wrapped position.
 */
export function moveAxisX(
  arena: ArenaData,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  dx: number
): AxisMove {
  const newX = x + dx;
  const rows = tileSpan(y, halfH);
  if (dx > 0) {
    const fromCol = Math.floor((x + halfW - EPS) / TILE_SIZE);
    const toCol = Math.floor((newX + halfW - EPS) / TILE_SIZE);
    for (let col = fromCol + 1; col <= toCol; col++) {
      if (rowsSolidAtCol(arena, col, rows.min, rows.max)) {
        return { pos: wrapMod(col * TILE_SIZE - halfW, ARENA_WIDTH), hit: true };
      }
    }
  } else if (dx < 0) {
    const fromCol = Math.floor((x - halfW) / TILE_SIZE);
    const toCol = Math.floor((newX - halfW) / TILE_SIZE);
    for (let col = fromCol - 1; col >= toCol; col--) {
      if (rowsSolidAtCol(arena, col, rows.min, rows.max)) {
        return { pos: wrapMod((col + 1) * TILE_SIZE + halfW, ARENA_WIDTH), hit: true };
      }
    }
  }
  return { pos: wrapMod(newX, ARENA_WIDTH), hit: false };
}

/** Vertical counterpart of moveAxisX. */
export function moveAxisY(
  arena: ArenaData,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  dy: number
): AxisMove {
  const newY = y + dy;
  const cols = tileSpan(x, halfW);
  if (dy > 0) {
    const fromRow = Math.floor((y + halfH - EPS) / TILE_SIZE);
    const toRow = Math.floor((newY + halfH - EPS) / TILE_SIZE);
    for (let row = fromRow + 1; row <= toRow; row++) {
      if (colsSolidAtRow(arena, row, cols.min, cols.max)) {
        return { pos: wrapMod(row * TILE_SIZE - halfH, ARENA_HEIGHT), hit: true };
      }
    }
  } else if (dy < 0) {
    const fromRow = Math.floor((y - halfH) / TILE_SIZE);
    const toRow = Math.floor((newY - halfH) / TILE_SIZE);
    for (let row = fromRow - 1; row >= toRow; row--) {
      if (colsSolidAtRow(arena, row, cols.min, cols.max)) {
        return { pos: wrapMod((row + 1) * TILE_SIZE + halfH, ARENA_HEIGHT), hit: true };
      }
    }
  }
  return { pos: wrapMod(newY, ARENA_HEIGHT), hit: false };
}

/** Solid ground within 1px below the AABB's feet (wrap-aware). */
export function isSupported(
  arena: ArenaData,
  x: number,
  y: number,
  halfW: number,
  halfH: number
): boolean {
  const cols = tileSpan(x, halfW);
  const probeRow = Math.floor((y + halfH + 1) / TILE_SIZE);
  return colsSolidAtRow(arena, probeRow, cols.min, cols.max);
}

/** Solid wall within 1px of the AABB's side on `dir` (>0 right, <0 left),
 *  wrap-aware. Used to engage wall-sliding. */
export function isAgainstWall(
  arena: ArenaData,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  dir: number
): boolean {
  const rows = tileSpan(y, halfH);
  const probeCol =
    dir > 0
      ? Math.floor((x + halfW + 1) / TILE_SIZE)
      : Math.floor((x - halfW - 1) / TILE_SIZE);
  return rowsSolidAtCol(arena, probeCol, rows.min, rows.max);
}
