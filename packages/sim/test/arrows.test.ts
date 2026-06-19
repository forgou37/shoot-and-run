import { describe, expect, it } from "vitest";
import type { ArenaData } from "../src/arena";
import { collectPickups } from "../src/arrow";
import { createSim, type Sim, type SimEvent } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { FLAT_ARENA, TEST_TUNING, WALL_ARENA } from "./fixtures";

function makeSettledSim(arena: ArenaData): Sim {
  const sim = createSim({ arena, tuning: TEST_TUNING, players: [{ slot: 0 }], seed: 7 });
  for (let i = 0; i < 60; i++) sim.step([emptyInput()]);
  return sim;
}

function inp(partial: Partial<PlayerInput>): PlayerInput {
  return { ...emptyInput(), ...partial };
}

function p0(sim: Sim) {
  return sim.state.players[0]!;
}

/** Press shoot for one tick (with optional aim keys), then release. */
function fire(sim: Sim, aim: Partial<PlayerInput> = {}): SimEvent[] {
  const events = [...sim.step([inp({ ...aim, shoot: true })]), ...sim.step([inp(aim)])];
  return events;
}

describe("arrows (spec 000 T0.6)", () => {
  it("firing consumes ammo and emits arrow_fired", () => {
    const sim = makeSettledSim(FLAT_ARENA);
    const events = fire(sim);
    expect(p0(sim).quiver).toHaveLength(TEST_TUNING.startingArrows - 1);
    expect(events.filter((e) => e.type === "arrow_fired")).toHaveLength(1);
    expect(sim.state.arrows).toHaveLength(1);
  });

  it("firing with 0 arrows is a no-op", () => {
    const sim = makeSettledSim(FLAT_ARENA);
    for (let i = 0; i < 3; i++) fire(sim, { up: true }); // shoot upward to keep them flying a while
    expect(p0(sim).quiver).toHaveLength(0);
    const events = fire(sim, { up: true });
    expect(events.filter((e) => e.type === "arrow_fired")).toHaveLength(0);
    expect(sim.state.arrows.length).toBeLessThanOrEqual(3);
  });

  it("default aim fires horizontally toward facing", () => {
    const sim = makeSettledSim(FLAT_ARENA);
    fire(sim);
    const arrow = sim.state.arrows[0]!;
    // One flight tick has already applied a little gravity to vy.
    expect(arrow.vx).toBe(TEST_TUNING.arrowSpeed);
    expect(Math.abs(arrow.vy)).toBeLessThan(10);
  });

  it("diagonal aim is normalized to arrowSpeed", () => {
    const sim = makeSettledSim(FLAT_ARENA);
    fire(sim, { up: true, right: true });
    const arrow = sim.state.arrows[0]!;
    // Two flight ticks have added gravity to vy; remove it to get the at-fire speed.
    const speedAtFire = Math.hypot(arrow.vx, arrow.vy - 2 * (TEST_TUNING.arrowGravity / 60));
    expect(speedAtFire).toBeCloseTo(TEST_TUNING.arrowSpeed, 0);
    expect(arrow.vx).toBeGreaterThan(0);
    expect(arrow.vy).toBeLessThan(0);
  });

  it("sticks into a wall and can be picked back up (+1 ammo)", () => {
    const sim = makeSettledSim(WALL_ARENA); // spawn x=200, wall at x=240
    const allEvents: SimEvent[] = [...fire(sim)];
    for (let i = 0; i < 30; i++) allEvents.push(...sim.step([emptyInput()]));

    const stuck = allEvents.find((e) => e.type === "arrow_stuck");
    expect(stuck).toBeDefined();
    expect(sim.state.arrows[0]!.phase).toBe("stuck");
    // Snapped against the wall face at x=240 minus the long half (5).
    expect(sim.state.arrows[0]!.x).toBeCloseTo(235, 0);

    // Walk into the wall; the player stops at 234, within pickup radius.
    for (let i = 0; i < 60; i++) allEvents.push(...sim.step([inp({ right: true })]));
    expect(allEvents.filter((e) => e.type === "arrow_picked_up")).toHaveLength(1);
    expect(p0(sim).quiver).toHaveLength(TEST_TUNING.startingArrows);
    expect(sim.state.arrows).toHaveLength(0);
  });

  it("picked-up arrows keep their kind and go to the quiver front", () => {
    // Unit-level: exercise collectPickups directly with a stuck special.
    const player = {
      ...JSON.parse(JSON.stringify(makeSettledSim(FLAT_ARENA).state.players[0]!)),
      quiver: ["normal"] as import("../src/state").ArrowKind[]
    };
    const stuckBomb = {
      id: 99,
      ownerSlot: 1,
      kind: "bomb" as const,
      phase: "stuck" as const,
      firedTick: 0,
      bouncesLeft: 0,
      pierced: false,
      insideSolid: false,
      targetSlot: -1,
      x: player.x,
      y: player.y,
      vx: 0,
      vy: 0
    };
    const events: SimEvent[] = [];
    const survivors = collectPickups([stuckBomb], [player], events, 100);
    expect(survivors).toHaveLength(0);
    expect(player.quiver).toEqual(["bomb", "normal"]);
    expect(events[0]).toMatchObject({ type: "arrow_picked_up", arrowId: 99 });
  });

  it("an arrow fired across the wrap edge continues and sticks on the other side", () => {
    const sim = makeSettledSim(FLAT_ARENA); // spawn x=20 on a full-width floor
    const allEvents: SimEvent[] = [...fire(sim, { left: true })];

    let sawWrap = false;
    let prevX = sim.state.arrows[0]!.x;
    for (let i = 0; i < 120 && sim.state.arrows[0]!.phase === "flying"; i++) {
      allEvents.push(...sim.step([emptyInput()]));
      const x = sim.state.arrows[0]!.x;
      if (x > prevX + 100) sawWrap = true; // jumped from ~0 to ~320
      prevX = x;
    }

    expect(sawWrap).toBe(true);
    expect(sim.state.arrows[0]!.phase).toBe("stuck");
    const stuck = allEvents.find((e) => e.type === "arrow_stuck");
    expect(stuck).toBeDefined();
    // It dropped into the floor well past the wrap seam, on the right side.
    expect(sim.state.arrows[0]!.x).toBeGreaterThan(200);
  });
});
