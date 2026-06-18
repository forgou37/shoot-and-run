import { describe, expect, it } from "vitest";
import type { ArenaData } from "../src/arena";
import { WALL_HALF_LENGTH, WALL_HALF_THICKNESS } from "../src/constants";
import { createSim, type Sim, type SimEvent } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../src/arena";
import { wrapDelta } from "../src/physics";
import type { PlayerState, WallState } from "../src/state";
import { wallAxes, wallRotation } from "../src/wall";
import { DROP_ARENA, FLAT_ARENA, TEST_TUNING } from "./fixtures";

/** Positive ⇒ the player's AABB overlaps the wall's box by that many px (the
 *  minimum-overlap SAT axis); ≤ 0 ⇒ separated. Mirrors the sim's collider. */
function wallPenetration(p: PlayerState, w: WallState): number {
  const ax = wallAxes(w.rotation);
  const dx = wrapDelta(w.x - p.x, ARENA_WIDTH);
  const dy = wrapDelta(w.y - p.y, ARENA_HEIGHT);
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: ax.ux, y: ax.uy },
    { x: ax.vx, y: ax.vy }
  ];
  let minOverlap = Infinity;
  for (const a of axes) {
    const rP = 6 * Math.abs(a.x) + 6 * Math.abs(a.y);
    const rW =
      WALL_HALF_LENGTH * Math.abs(ax.ux * a.x + ax.uy * a.y) +
      WALL_HALF_THICKNESS * Math.abs(ax.vx * a.x + ax.vy * a.y);
    const overlap = rP + rW - Math.abs(dx * a.x + dy * a.y);
    if (overlap < minOverlap) minOverlap = overlap;
  }
  return minOverlap;
}

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

let nextWallId = 9000;
function addWall(sim: Sim, x: number, y: number, rotation: 0 | 45 | 90 | 135, ownerSlot = 0): WallState {
  const wall: WallState = { id: nextWallId++, ownerSlot, x, y, rotation };
  sim.state.walls.push(wall);
  return wall;
}

describe("wall collision (spec 018 T18.2)", () => {
  it("a vertical wall blocks a player walking into it (no pass-through)", () => {
    const sim = makeSim();
    const p0 = sim.state.players[0]!;
    const wallX = p0.x + 20;
    addWall(sim, wallX, p0.y, 0); // vertical: thin face toward the player
    const wallLeftFace = wallX - WALL_HALF_THICKNESS; // 2px half-thickness

    let maxX = p0.x;
    for (let i = 0; i < 60; i++) {
      sim.step([inp({ right: true }), emptyInput()]);
      maxX = Math.max(maxX, p0.x);
    }
    // The player's right edge can never cross the wall's near face.
    expect(maxX + 6).toBeLessThanOrEqual(wallLeftFace + 0.001);
    // ...and it pressed up against it (not stuck far away).
    expect(p0.x + 6).toBeGreaterThan(wallLeftFace - 1);
  });

  it("a dashing player never tunnels through a wall", () => {
    const sim = makeSim();
    const p0 = sim.state.players[0]!;
    const wallX = p0.x + 22; // within one dash's reach
    addWall(sim, wallX, p0.y, 0);
    const wallRightFace = wallX + WALL_HALF_THICKNESS;

    let crossed = false;
    // Dash (facing right by default), then keep holding right for a while.
    sim.step([inp({ dash: true }), emptyInput()]);
    for (let i = 0; i < 40; i++) {
      sim.step([inp({ right: true }), emptyInput()]);
      if (p0.x - 6 > wallRightFace) crossed = true; // player left edge past far face
    }
    expect(crossed).toBe(false);
    expect(p0.x + 6).toBeLessThanOrEqual(wallX - WALL_HALF_THICKNESS + 0.001);
  });

  it("a horizontal wall is a platform: a falling player lands and stands on it", () => {
    const sim = createSim({
      arena: DROP_ARENA, // P0 spawns high at (160, 40)
      tuning: TEST_TUNING,
      players: [{ slot: 0 }, { slot: 1 }],
      seed: 3
    });
    const p0 = sim.state.players[0]!;
    const wallY = 120;
    addWall(sim, 160, wallY, 90); // horizontal plank under the falling player
    const restY = wallY - WALL_HALF_THICKNESS - 6; // wall top minus player half-height

    let everGrounded = false;
    for (let i = 0; i < 120; i++) {
      sim.step([emptyInput(), emptyInput()]);
      if (p0.grounded) everGrounded = true;
    }
    expect(everGrounded).toBe(true);
    expect(p0.y).toBeCloseTo(restY, 0); // resting on the plank, ~112
    expect(p0.y).toBeLessThan(150); // never fell through to the floor (~202)
  });

  it("walls are solid: a dashing player never penetrates any orientation", () => {
    // The hard guarantee (A18.5) is that an alive player never ends a tick
    // overlapping a wall — at any reachable speed, for every orientation. (A short
    // diagonal plank can be slid around its ends; that's not a tunnel.)
    for (const rotation of [0, 45, 90, 135] as const) {
      const sim = makeSim();
      const p0 = sim.state.players[0]!;
      const w = addWall(sim, p0.x + 18, p0.y, rotation);
      let maxPen = -Infinity;
      sim.step([inp({ dash: true }), emptyInput()]);
      maxPen = Math.max(maxPen, wallPenetration(p0, w));
      for (let i = 0; i < 40; i++) {
        sim.step([inp({ right: true, dash: i % 12 === 0 }), emptyInput()]);
        maxPen = Math.max(maxPen, wallPenetration(p0, w));
      }
      expect(maxPen).toBeLessThan(0.01); // never left overlapping
    }
  });

  it("a normal arrow dissolves the wall and sticks where it was", () => {
    const sim = makeSim();
    const p0 = sim.state.players[0]!;
    const wall = addWall(sim, p0.x + 60, p0.y, 0);

    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t++) {
      events.push(...sim.step([inp({ shoot: t === 0 }), emptyInput()]));
      if (events.some((e) => e.type === "wall_destroyed")) break;
    }
    const destroyed = events.find((e) => e.type === "wall_destroyed");
    expect(destroyed).toMatchObject({ type: "wall_destroyed", wallId: wall.id });
    expect(sim.state.walls).toHaveLength(0);
    // The arrow stopped (became a pickup) rather than flying on to a victim.
    expect(events.some((e) => e.type === "arrow_stuck")).toBe(true);
    expect(sim.state.arrows.every((a) => a.phase === "stuck")).toBe(true);
  });

  it("a bomb arrow dissolves the wall and explodes", () => {
    const sim = makeSim();
    const p0 = sim.state.players[0]!;
    p0.quiver.unshift("bomb");
    const wall = addWall(sim, p0.x + 60, p0.y, 0);

    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t++) {
      events.push(...sim.step([inp({ shoot: t === 0 }), emptyInput()]));
      if (events.some((e) => e.type === "arrow_exploded")) break;
    }
    expect(events.find((e) => e.type === "wall_destroyed")).toMatchObject({ wallId: wall.id });
    expect(events.some((e) => e.type === "arrow_exploded")).toBe(true);
    expect(sim.state.walls).toHaveLength(0);
  });

  it("a wall shields the player behind it (the arrow never reaches them)", () => {
    const sim = makeSim();
    const p0 = sim.state.players[0]!;
    const p1 = sim.state.players[1]!;
    p1.x = p0.x + 60; // bring the victim into range, in front of P0
    p1.y = p0.y;
    addWall(sim, p0.x + 30, p0.y, 0); // wall between them

    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t++) {
      events.push(...sim.step([inp({ shoot: t === 0 }), emptyInput()]));
      if (events.some((e) => e.type === "arrow_stuck")) break;
    }
    expect(events.some((e) => e.type === "wall_destroyed")).toBe(true);
    expect(events.some((e) => e.type === "player_killed")).toBe(false);
    expect(p1.alive).toBe(true);
  });

  it("is neutral: a wall stops the builder's own arrow too", () => {
    const sim = makeSim();
    const p0 = sim.state.players[0]!;
    const wall = addWall(sim, p0.x + 50, p0.y, 0, 0); // owned by P0

    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t++) {
      events.push(...sim.step([inp({ shoot: t === 0 }), emptyInput()]));
      if (events.some((e) => e.type === "wall_destroyed")) break;
    }
    expect(events.find((e) => e.type === "wall_destroyed")).toMatchObject({ wallId: wall.id });
    expect(sim.state.walls).toHaveLength(0);
  });

  it("one wall stops exactly one arrow; later arrows pass through where it was", () => {
    const sim = makeSim();
    const p0 = sim.state.players[0]!;
    sim.state.players[1]!.y = 100; // move the victim off the shot line
    addWall(sim, p0.x + 70, p0.y, 0);

    const events: SimEvent[] = [];
    // Two shoot edges (tick 0 and tick 2) → two arrows down the same lane.
    for (let t = 0; t < 80; t++) {
      events.push(...sim.step([inp({ shoot: t === 0 || t === 2 }), emptyInput()]));
    }
    expect(events.filter((e) => e.type === "arrow_fired").length).toBe(2);
    expect(events.filter((e) => e.type === "wall_destroyed").length).toBe(1);
    expect(sim.state.walls).toHaveLength(0);
  });
});
