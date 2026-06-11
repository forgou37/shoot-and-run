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
