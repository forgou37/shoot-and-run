import { describe, expect, it } from "vitest";
import type { ArenaData } from "../src/arena";
import { createSim, type Sim } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { msToTicks } from "../src/tuning";
import {
  DROP_ARENA,
  FLAT_ARENA,
  LEDGE_ARENA,
  TALL_WALL_ARENA,
  TEST_TUNING,
  VOID_COLUMN_ARENA,
  WALL_ARENA
} from "./fixtures";

/** Single-player sim on the given arena, settled onto the ground. */
function makeSettledSim(arena: ArenaData, settleTicks = 60): Sim {
  const sim = createSim({
    arena,
    tuning: TEST_TUNING,
    players: [{ slot: 0 }],
    seed: 42
  });
  for (let i = 0; i < settleTicks; i++) sim.step([emptyInput()]);
  return sim;
}

function inp(partial: Partial<PlayerInput>): PlayerInput {
  return { ...emptyInput(), ...partial };
}

function p0(sim: Sim) {
  return sim.state.players[0]!;
}

const COYOTE_TICKS = msToTicks(TEST_TUNING.coyoteTimeMs); // 80ms -> 5 ticks

describe("movement acceptance (spec 000 T0.4)", () => {
  it("(a) held jump reaches a measurably higher apex than a tapped jump", () => {
    const apexHeight = (jumpHeldTicks: number): number => {
      const sim = makeSettledSim(FLAT_ARENA);
      const groundY = p0(sim).y;
      let minY = groundY;
      for (let t = 0; t < 90; t++) {
        sim.step([inp({ jump: t < jumpHeldTicks })]);
        minY = Math.min(minY, p0(sim).y);
      }
      return groundY - minY; // pixels risen
    };

    const tapped = apexHeight(2);
    const held = apexHeight(40);
    expect(tapped).toBeGreaterThan(0);
    expect(held).toBeGreaterThan(tapped + 10);
  });

  it("(b) jump within the coyote window after walking off a ledge still jumps; after it, does not", () => {
    const jumpAfterLeavingLedge = (delayTicks: number): boolean => {
      const sim = makeSettledSim(LEDGE_ARENA, 10); // spawn 0 stands on the platform
      expect(p0(sim).grounded).toBe(true);

      // Walk right until the player leaves the platform.
      let walked = 0;
      while (p0(sim).grounded && walked < 300) {
        sim.step([inp({ right: true })]);
        walked++;
      }
      expect(p0(sim).grounded).toBe(false);

      // Wait, then press jump for one tick.
      for (let i = 0; i < delayTicks; i++) sim.step([emptyInput()]);
      sim.step([inp({ jump: true })]);
      return p0(sim).vy < 0; // rising means the jump happened
    };

    expect(jumpAfterLeavingLedge(COYOTE_TICKS - 2)).toBe(true);
    expect(jumpAfterLeavingLedge(COYOTE_TICKS + 3)).toBe(false);
  });

  it("(c) jump pressed shortly before landing executes on landing; too early does not", () => {
    const jumpsAfterLanding = (pressHeightPx: number): boolean => {
      const sim = createSim({
        arena: DROP_ARENA,
        tuning: TEST_TUNING,
        players: [{ slot: 0 }],
        seed: 42
      });
      // Player falls ~160px from the floating spawn. Press jump once when
      // within pressHeightPx of standing height, watch for a post-landing jump.
      const standingY = 202; // floor top 208 minus half height 6
      let pressed = false;
      for (let t = 0; t < 240; t++) {
        const closeEnough = !pressed && standingY - p0(sim).y < pressHeightPx && p0(sim).vy > 0;
        sim.step([inp({ jump: closeEnough })]);
        if (closeEnough) pressed = true;
        if (pressed && p0(sim).vy < 0) return true; // rising again: buffered jump fired
        if (pressed && p0(sim).grounded) {
          // Give the buffer two ticks past landing to fire.
          sim.step([emptyInput()]);
          sim.step([emptyInput()]);
          return p0(sim).vy < 0 || !p0(sim).grounded;
        }
      }
      return false;
    };

    // maxFallSpeed 240 px/s = 4 px/tick; buffer 6 ticks = ~24 px of fall.
    expect(jumpsAfterLanding(12)).toBe(true); // ~3 ticks before landing
    expect(jumpsAfterLanding(60)).toBe(false); // ~15 ticks: buffer expires
  });

  it("(d) walking off the left edge re-enters on the right at the same height", () => {
    const sim = makeSettledSim(FLAT_ARENA);
    // Spawn 0 is at x=20 on flat ground.
    const yBefore = p0(sim).y;
    let wrapped = false;
    let prevX = p0(sim).x;
    for (let t = 0; t < 600 && !wrapped; t++) {
      sim.step([inp({ left: true })]);
      if (p0(sim).x > prevX + 100) wrapped = true; // jumped from ~0 to ~320
      else prevX = p0(sim).x;
    }
    expect(wrapped).toBe(true);
    expect(p0(sim).x).toBeGreaterThan(300);
    expect(p0(sim).y).toBeCloseTo(yBefore, 6);
    expect(p0(sim).grounded).toBe(true);
  });

  it("(d) falling through a bottom gap re-enters at the top in the same column", () => {
    const sim = createSim({
      arena: VOID_COLUMN_ARENA,
      tuning: TEST_TUNING,
      players: [{ slot: 0 }],
      seed: 42
    });
    const xBefore = p0(sim).x;
    let wrapped = false;
    let prevY = p0(sim).y;
    for (let t = 0; t < 600 && !wrapped; t++) {
      sim.step([emptyInput()]);
      if (p0(sim).y < prevY - 100) wrapped = true; // jumped from ~240 to ~0
      else prevY = p0(sim).y;
    }
    expect(wrapped).toBe(true);
    expect(p0(sim).x).toBe(xBefore);
  });

  it("stays grounded while running on flat ground, including across the wrap seam", () => {
    const sim = makeSettledSim(FLAT_ARENA);
    // Spawn 0 at x=20: 30 ticks of walking left crosses x=0 onto the right side.
    for (let t = 0; t < 30; t++) {
      sim.step([inp({ left: true })]);
      expect(p0(sim).grounded).toBe(true);
      expect(p0(sim).vy).toBe(0);
    }
  });

  it("stops at a wall and stays put while pushing into it", () => {
    const sim = makeSettledSim(WALL_ARENA);
    // Spawn 0 at x=200; wall col 15 starts at x=240, so the player stops at 234.
    for (let t = 0; t < 100; t++) {
      sim.step([inp({ right: true })]);
    }
    expect(p0(sim).x).toBeCloseTo(234, 6);
    expect(p0(sim).grounded).toBe(true);
  });
});

describe("movement adjustments (owner-directed)", () => {
  it("wall slide: holding into a wall while airborne caps the descent speed", () => {
    const sim = createSim({
      arena: TALL_WALL_ARENA,
      tuning: TEST_TUNING,
      players: [{ slot: 0 }],
      seed: 1
    });
    // Spawn 0 floats with its right edge against the wall. Hold right (into it).
    for (let t = 0; t < 15; t++) sim.step([inp({ right: true })]);
    const sliding = p0(sim);
    expect(sliding.grounded).toBe(false);
    expect(sliding.vy).toBeCloseTo(TEST_TUNING.wallSlideSpeed, 6);

    // Releasing the into-wall input drops the cling: free-fall resumes.
    for (let t = 0; t < 10; t++) sim.step([emptyInput()]);
    expect(p0(sim).vy).toBeGreaterThan(TEST_TUNING.wallSlideSpeed);
  });

  it("wall jump: jumping off a clung wall launches up and away at 45°", () => {
    const sim = createSim({
      arena: TALL_WALL_ARENA,
      tuning: TEST_TUNING,
      players: [{ slot: 0 }],
      seed: 1
    });
    // Cling to the right wall (right edge against col 10).
    for (let t = 0; t < 15; t++) sim.step([inp({ right: true })]);
    expect(p0(sim).grounded).toBe(false);
    expect(p0(sim).vy).toBeCloseTo(TEST_TUNING.wallSlideSpeed, 6);

    // Jump while still holding into the wall.
    sim.step([inp({ right: true, jump: true })]);
    const j = p0(sim);
    expect(j.vy).toBeCloseTo(-TEST_TUNING.wallJumpSpeed, 6); // upward
    expect(j.vx).toBeCloseTo(-TEST_TUNING.wallJumpSpeed, 6); // away from the wall (left)
    expect(Math.abs(j.vx)).toBeCloseTo(Math.abs(j.vy), 6); // equal components ⇒ 45°
    expect(j.facing).toBe(-1); // turns to face away from the wall
  });

  it("wall jump: air control is briefly suspended so the launch arc holds", () => {
    const sim = createSim({
      arena: TALL_WALL_ARENA,
      tuning: TEST_TUNING,
      players: [{ slot: 0 }],
      seed: 1
    });
    for (let t = 0; t < 15; t++) sim.step([inp({ right: true })]);
    sim.step([inp({ right: true, jump: true })]); // wall jump leftward

    // Holding back into the wall would normally clamp horizontal speed to
    // runSpeed within a tick; during the lock the away momentum is preserved.
    sim.step([inp({ right: true })]);
    expect(p0(sim).vx).toBeLessThan(-TEST_TUNING.runSpeed);

    // After the lock expires, air control is responsive again.
    const lockTicks = msToTicks(TEST_TUNING.wallJumpControlLockMs);
    for (let t = 0; t < lockTicks; t++) sim.step([inp({ right: true })]);
    expect(p0(sim).vx).toBeGreaterThanOrEqual(-TEST_TUNING.runSpeed);
  });

  it("wall jump: a grounded jump beside a wall is a normal vertical jump, not a wall jump", () => {
    const sim = makeSettledSim(WALL_ARENA);
    // Walk into the wall (col 15) and settle against it on the ground.
    for (let t = 0; t < 40; t++) sim.step([inp({ right: true })]);
    expect(p0(sim).grounded).toBe(true);

    sim.step([inp({ right: true, jump: true })]);
    const j = p0(sim);
    expect(j.vy).toBeCloseTo(-TEST_TUNING.jumpVelocity, 6); // ground jump height
    expect(j.vx).not.toBeCloseTo(-TEST_TUNING.wallJumpSpeed, 6); // not launched off the wall
  });

  it("edge fall: walking off a ledge sheds run momentum and drops straight down", () => {
    const sim = makeSettledSim(LEDGE_ARENA, 10); // spawn 0 stands on the platform
    expect(p0(sim).grounded).toBe(true);

    let walked = 0;
    while (p0(sim).grounded && walked < 300) {
      sim.step([inp({ right: true })]);
      walked++;
    }
    expect(p0(sim).grounded).toBe(false);
    expect(p0(sim).vx).toBe(0); // carried horizontal velocity is zeroed at the ledge

    // With no horizontal input it falls in place (same column), gaining only vy.
    const xAfter = p0(sim).x;
    for (let t = 0; t < 10; t++) sim.step([emptyInput()]);
    expect(p0(sim).x).toBeCloseTo(xAfter, 6);
    expect(p0(sim).vy).toBeGreaterThan(0);
  });

  it("dash (ground): a fast horizontal burst over a short distance", () => {
    const sim = makeSettledSim(FLAT_ARENA);
    const x0 = p0(sim).x;
    expect(p0(sim).facing).toBe(1); // faces right by default

    sim.step([inp({ dash: true })]); // dash in the facing direction
    expect(Math.abs(p0(sim).vx)).toBeCloseTo(TEST_TUNING.dashSpeed, 6);

    const dashTicks = msToTicks(TEST_TUNING.dashDurationMs);
    for (let t = 0; t < dashTicks; t++) sim.step([emptyInput()]);
    const dist = p0(sim).x - x0;
    expect(dist).toBeGreaterThan(20);
    expect(dist).toBeLessThan(80); // short, not a full sprint
  });

  it("dash (air): bursts in the held direction while airborne, suspending gravity", () => {
    const sim = makeSettledSim(FLAT_ARENA);
    sim.step([inp({ jump: true })]);
    for (let t = 0; t < 6; t++) sim.step([emptyInput()]); // rise into the air
    expect(p0(sim).grounded).toBe(false);

    sim.step([inp({ dash: true, left: true })]);
    expect(p0(sim).vx).toBeCloseTo(-TEST_TUNING.dashSpeed, 6);
    expect(p0(sim).vy).toBe(0); // dash suspends gravity for the burst
    expect(p0(sim).grounded).toBe(false);
  });
});
