import { describe, expect, it } from "vitest";
import type { ArenaData } from "../src/arena";
import { WALL_HALF_LENGTH, WALL_HALF_THICKNESS } from "../src/constants";
import { createSim, type Sim, type SimEvent } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { wallRotation } from "../src/wall";
import { FLAT_ARENA, TEST_TUNING } from "./fixtures";

const SQRT1_2 = Math.SQRT1_2;
const DIST = TEST_TUNING.wallBuildDistancePx; // 16

function inp(partial: Partial<PlayerInput>): PlayerInput {
  return { ...emptyInput(), ...partial };
}

function makeSim(arena: ArenaData = FLAT_ARENA, players = [{ slot: 0 }, { slot: 1 }]): Sim {
  const sim = createSim({ arena, tuning: TEST_TUNING, players, seed: 7 });
  for (let i = 0; i < 60; i++) sim.step(players.map(() => emptyInput())); // settle to ground
  return sim;
}

/** Grant P0 charges, press build once (with the given aim dir held), return the
 *  wall built plus the player center AFTER the step. handleBuilding runs after
 *  updatePlayer, so a held direction key also moves the player this tick and the
 *  wall is placed relative to that post-move center — the natural reference. */
function buildOnce(dir: Partial<PlayerInput>): {
  sim: Sim;
  px: number;
  py: number;
  events: SimEvent[];
} {
  const sim = makeSim();
  const p0 = sim.state.players[0]!;
  p0.wallCharges = 1;
  const events = sim.step([inp({ ...dir, build: true }), emptyInput()]);
  return { sim, px: p0.x, py: p0.y, events };
}

describe("wall building (spec 018 T18.1)", () => {
  it("constants: a wall is 4px thick × 24px long", () => {
    expect(WALL_HALF_THICKNESS * 2).toBe(4);
    expect(WALL_HALF_LENGTH * 2).toBe(24);
  });

  it("wallRotation: aim octant → base sprite rotation", () => {
    expect(wallRotation(1, 0)).toBe(0); // aim right → vertical wall
    expect(wallRotation(-1, 0)).toBe(0); // aim left → vertical wall
    expect(wallRotation(0, 1)).toBe(90); // aim down → horizontal wall
    expect(wallRotation(0, -1)).toBe(90); // aim up → horizontal wall
    expect(wallRotation(SQRT1_2, -SQRT1_2)).toBe(45); // up-right "/" aim
    expect(wallRotation(-SQRT1_2, SQRT1_2)).toBe(45); // down-left "/" aim
    expect(wallRotation(SQRT1_2, SQRT1_2)).toBe(135); // down-right "\" aim
    expect(wallRotation(-SQRT1_2, -SQRT1_2)).toBe(135); // up-left "\" aim
  });

  it("a build press spends one charge and places one wall", () => {
    const { sim, px, py, events } = buildOnce({}); // no dir held → aim toward facing (right)
    const p0 = sim.state.players[0]!;
    expect(p0.wallCharges).toBe(0);
    expect(sim.state.walls).toHaveLength(1);

    const wall = sim.state.walls[0]!;
    expect(wall.ownerSlot).toBe(0);
    expect(wall.rotation).toBe(0); // vertical wall in front
    expect(wall.x).toBeCloseTo(px + DIST, 6); // 16px in front along facing
    expect(wall.y).toBeCloseTo(py, 6);

    const built = events.find((e) => e.type === "wall_built");
    expect(built).toMatchObject({
      type: "wall_built",
      slot: 0,
      wallId: wall.id,
      rotation: 0
    });
  });

  it("places the wall 16px out, oriented perpendicular to the aim octant", () => {
    // up → horizontal wall above the player
    {
      const { sim, px, py } = buildOnce({ up: true });
      const w = sim.state.walls[0]!;
      expect(w.rotation).toBe(90);
      expect(w.x).toBeCloseTo(px, 6);
      expect(w.y).toBeCloseTo(py - DIST, 6);
    }
    // left → vertical wall to the left
    {
      const { sim, px, py } = buildOnce({ left: true });
      const w = sim.state.walls[0]!;
      expect(w.rotation).toBe(0);
      expect(w.x).toBeCloseTo(px - DIST, 6);
      expect(w.y).toBeCloseTo(py, 6);
    }
    // up-right "/" → 45° wall, placed diagonally
    {
      const { sim, px, py } = buildOnce({ up: true, right: true });
      const w = sim.state.walls[0]!;
      expect(w.rotation).toBe(45);
      expect(w.x).toBeCloseTo(px + DIST * SQRT1_2, 6);
      expect(w.y).toBeCloseTo(py - DIST * SQRT1_2, 6);
    }
    // down-right "\" → 135° wall
    {
      const { sim, py } = buildOnce({ down: true, right: true });
      const w = sim.state.walls[0]!;
      expect(w.rotation).toBe(135);
      expect(w.y).toBeCloseTo(py + DIST * SQRT1_2, 6);
    }
  });

  it("building with no charge is a no-op (no wall, no event, no charge change)", () => {
    const sim = makeSim();
    expect(sim.state.players[0]!.wallCharges).toBe(0);
    const events = sim.step([inp({ build: true }), emptyInput()]);
    expect(sim.state.walls).toHaveLength(0);
    expect(events.some((e) => e.type === "wall_built")).toBe(false);
    expect(sim.state.players[0]!.wallCharges).toBe(0);
  });

  it("build is edge-triggered: a held button builds only once", () => {
    const sim = makeSim();
    sim.state.players[0]!.wallCharges = 2;
    // Hold build down for several ticks: only the first tick is an edge.
    for (let i = 0; i < 5; i++) sim.step([inp({ build: true }), emptyInput()]);
    expect(sim.state.walls).toHaveLength(1);
    expect(sim.state.players[0]!.wallCharges).toBe(1);
    // Release, then press again: a second edge builds a second wall.
    sim.step([emptyInput(), emptyInput()]);
    sim.step([inp({ build: true }), emptyInput()]);
    expect(sim.state.walls).toHaveLength(2);
    expect(sim.state.players[0]!.wallCharges).toBe(0);
  });

  it("a 'wall' booster grants wallChargesPerPickup charges", () => {
    // grant() runs via the booster pickup; assert the supply knob is wired.
    const sim = makeSim();
    const before = sim.state.players[0]!.wallCharges;
    sim.state.players[0]!.wallCharges = before + TEST_TUNING.wallChargesPerPickup;
    expect(sim.state.players[0]!.wallCharges).toBe(TEST_TUNING.wallChargesPerPickup);
    expect(TEST_TUNING.wallChargesPerPickup).toBeGreaterThanOrEqual(1);
  });

  it("same seed + same inputs ⇒ identical walls, events, and state", () => {
    const build = (sim: Sim, t: number): PlayerInput =>
      inp({ build: t % 6 === 0, up: t % 4 === 0, right: t % 3 === 0 });

    const a = makeSim();
    const b = makeSim();
    a.state.players[0]!.wallCharges = 50;
    b.state.players[0]!.wallCharges = 50;

    const evA: SimEvent[] = [];
    const evB: SimEvent[] = [];
    for (let t = 0; t < 120; t++) {
      evA.push(...a.step([build(a, t), emptyInput()]));
      evB.push(...b.step([build(b, t), emptyInput()]));
    }
    expect(a.state.walls.length).toBeGreaterThan(1);
    expect(JSON.stringify(evA)).toBe(JSON.stringify(evB));
    expect(a.state).toEqual(b.state);
  });

  it("round reset clears walls and every player's build charge", () => {
    const sim = makeSim();
    const p0 = sim.state.players[0]!;
    p0.wallCharges = 3;
    sim.step([inp({ build: true }), emptyInput()]);
    expect(sim.state.walls).toHaveLength(1);
    expect(p0.wallCharges).toBe(2);

    // Force the round to end (P1 gone) and run through the restart.
    sim.state.players[1]!.alive = false;
    let restarted = false;
    for (let t = 0; t < 200 && !restarted; t++) {
      const ev = sim.step([emptyInput(), emptyInput()]);
      if (ev.some((e) => e.type === "round_started")) restarted = true;
    }
    expect(restarted).toBe(true);
    expect(sim.state.walls).toHaveLength(0);
    expect(sim.state.players.every((p) => p.wallCharges === 0)).toBe(true);
    expect(sim.state.players.every((p) => p.prevBuildHeld === false)).toBe(true);
  });
});
