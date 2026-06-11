import type { ArenaData } from "../src/arena";
import type { Tuning } from "../src/tuning";

/** Local test fixtures. Real content files arrive in T0.3/T0.4. */

export const TEST_TUNING: Tuning = {
  gravity: 900,
  maxFallSpeed: 240,
  runSpeed: 100,
  airAccel: 600,
  jumpVelocity: 260,
  jumpCutFactor: 0.4,
  coyoteTimeMs: 80,
  jumpBufferMs: 100,
  arrowSpeed: 350,
  arrowGravity: 180,
  stompBounceVelocity: 180,
  roundRestartDelayMs: 1500,
  startingArrows: 3
};

/** Flat full-width floor (rows 13–14), nothing else. For wrap-X tests. */
export const FLAT_ARENA: ArenaData = {
  name: "test-flat",
  tiles: [
    ...Array.from({ length: 13 }, () => "...................."),
    "####################",
    "####################"
  ],
  spawns: [
    { x: 20, y: 192 },
    { x: 300, y: 192 },
    { x: 100, y: 192 },
    { x: 220, y: 192 }
  ]
};

/** Flat floor with spawn 0 floating high above it. For jump-buffer tests
 *  (needs a long fall). Bypasses parseArena's spawn-on-ground check. */
export const DROP_ARENA: ArenaData = {
  name: "test-drop",
  tiles: [
    ...Array.from({ length: 13 }, () => "...................."),
    "####################",
    "####################"
  ],
  spawns: [
    { x: 160, y: 40 },
    { x: 40, y: 192 },
    { x: 280, y: 192 },
    { x: 100, y: 192 }
  ]
};

/** Full floor plus a wall (col 15, rows 11–12). For wall-collision tests. */
export const WALL_ARENA: ArenaData = {
  name: "test-wall",
  tiles: [
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "...............#....",
    "...............#....",
    "####################",
    "####################"
  ],
  spawns: [
    { x: 200, y: 192 },
    { x: 40, y: 192 },
    { x: 100, y: 192 },
    { x: 60, y: 192 }
  ]
};

/** Flat floor; spawn 0 floats directly above spawn 1's column. For stomp
 *  tests (bypasses parseArena's spawn-on-ground check for spawn 0). */
export const STOMP_ARENA: ArenaData = {
  name: "test-stomp",
  tiles: [
    ...Array.from({ length: 13 }, () => "...................."),
    "####################",
    "####################"
  ],
  spawns: [
    { x: 100, y: 40 },
    { x: 100, y: 192 },
    { x: 200, y: 192 },
    { x: 280, y: 192 }
  ]
};

/** One platform (row 5, cols 6–11) over a full floor. For ledge/coyote tests. */
export const LEDGE_ARENA: ArenaData = {
  name: "test-ledge",
  tiles: [
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "......######........",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "####################",
    "####################"
  ],
  spawns: [
    { x: 100, y: 74 },
    { x: 280, y: 192 },
    { x: 40, y: 192 },
    { x: 200, y: 192 }
  ]
};

/**
 * Floor with a central gap (cols 9–10) and NO other tiles. For wrap-Y tests.
 * Spawn 0 floats over the gap — this fixture deliberately bypasses
 * parseArena (createSim trusts its input; validation happens at load time).
 */
export const VOID_COLUMN_ARENA: ArenaData = {
  name: "test-void-column",
  tiles: [
    ...Array.from({ length: 13 }, () => "...................."),
    "#########..#########",
    "#########..#########"
  ],
  spawns: [
    { x: 152, y: 100 },
    { x: 40, y: 192 },
    { x: 280, y: 192 },
    { x: 100, y: 192 }
  ]
};

export const TEST_ARENA: ArenaData = {
  name: "test-box",
  tiles: [
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "......######........",
    "....................",
    "....................",
    "........######......",
    "....................",
    "....................",
    "....................",
    "....................",
    "####################",
    "####################"
  ],
  spawns: [
    { x: 40, y: 192 },
    { x: 280, y: 192 },
    { x: 120, y: 64 },
    { x: 200, y: 112 }
  ]
};
