import { describe, expect, it } from "vitest";
import { ARENA_WIDTH } from "../src/arena";
import { createSim, type Sim, type SimEvent } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { wrapDelta } from "../src/physics";
import type { SimState } from "../src/state";
import { msToTicks } from "../src/tuning";
import { CHEST_ARENA, TEST_TUNING } from "./fixtures";

const INTERVAL_TICKS = msToTicks(TEST_TUNING.chestIntervalMs); // 120

function inp(partial: Partial<PlayerInput>): PlayerInput {
  return { ...emptyInput(), ...partial };
}

function makeSim(seed: number): Sim {
  return createSim({
    arena: CHEST_ARENA,
    tuning: TEST_TUNING,
    players: [{ slot: 0 }, { slot: 1 }],
    seed
  });
}

function idle(sim: Sim, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...sim.step([emptyInput(), emptyInput()]));
  return events;
}

/** Spawn a chest, then march P0 into it to open it. Returns the spawn event so
 *  callers can compare the booster's position against the chest spot. */
function openAChest(sim: Sim): Extract<SimEvent, { type: "chest_spawned" }> {
  const spawned = idle(sim, INTERVAL_TICKS + 2).find((e) => e.type === "chest_spawned");
  if (spawned?.type !== "chest_spawned") throw new Error("no chest spawned");
  const dir = spawned.x > sim.state.players[0]!.x ? { right: true } : { left: true };
  for (let i = 0; i < 600 && sim.state.chests.length > 0; i++) {
    sim.step([inp(dir), emptyInput()]);
  }
  if (sim.state.boosters.length !== 1) throw new Error("chest did not pop a booster");
  return spawned;
}

/**
 * A tiny scripted controller for P0: collect a floating booster if one exists
 * (walk under it, then hop up to it), else walk into the nearest chest to open
 * it. A pure function of state, so two same-seed sims fed it independently stay
 * in lockstep — the basis of the determinism check below.
 */
function drive(state: Readonly<SimState>): PlayerInput {
  const p = state.players[0]!;
  const booster = state.boosters[0];
  if (booster) {
    const dx = wrapDelta(booster.x - p.x, ARENA_WIDTH);
    const input = emptyInput();
    if (dx > 2) input.right = true;
    else if (dx < -2) input.left = true;
    if (Math.abs(dx) < 6 && p.grounded) input.jump = true; // hop up to it
    return input;
  }
  const chest = state.chests[0];
  if (chest) {
    const dx = wrapDelta(chest.x - p.x, ARENA_WIDTH);
    const input = emptyInput();
    if (dx > 0) input.right = true;
    else if (dx < 0) input.left = true;
    return input;
  }
  return emptyInput();
}

describe("floating booster pickups (spec 014 T14.1)", () => {
  it("a popped booster floats boosterFloatOffsetPx above the chest spot", () => {
    const sim = makeSim(42);
    const spawned = openAChest(sim);
    const b = sim.state.boosters[0]!;
    expect(b.x).toBe(spawned.x);
    expect(b.y).toBe(spawned.y - TEST_TUNING.boosterFloatOffsetPx);
    expect(b.contents).toBe(spawned.contents);
  });

  it("the opener cannot reach the booster from the floor — it floats overhead", () => {
    const sim = makeSim(42);
    openAChest(sim);
    // Stand still under the booster: it stays uncollected (the float gap).
    const events = idle(sim, 30);
    expect(events.filter((e) => e.type === "booster_collected")).toHaveLength(0);
    expect(sim.state.boosters).toHaveLength(1);
  });

  it("touching the floating booster collects it and grants the contents", () => {
    const sim = makeSim(42);
    const spawned = openAChest(sim);
    const before = sim.state.players[0]!;
    expect(before.quiver.length).toBe(TEST_TUNING.startingArrows); // not yet granted

    // Move P0's body onto the booster's fixed pickup point.
    const b = sim.state.boosters[0]!;
    const p = sim.state.players[0]!;
    p.x = b.x;
    p.y = b.y;
    const events = sim.step([emptyInput(), emptyInput()]);

    const collected = events.find((e) => e.type === "booster_collected");
    expect(collected).toMatchObject({ slot: 0, boosterId: b.id, contents: spawned.contents });
    expect(sim.state.boosters).toHaveLength(0);

    if (spawned.contents === "invisibility") {
      expect(p.invisibleTicksLeft).toBeGreaterThan(0);
    } else if (spawned.contents === "flight") {
      expect(p.flightTicksLeft).toBeGreaterThan(0);
    } else if (spawned.contents === "shield") {
      expect(p.shielded).toBe(true);
    } else {
      expect(p.quiver.slice(0, TEST_TUNING.specialArrowsPerChest)).toEqual(
        Array.from({ length: TEST_TUNING.specialArrowsPerChest }, () => spawned.contents)
      );
      expect(p.quiver.length).toBe(
        TEST_TUNING.startingArrows + TEST_TUNING.specialArrowsPerChest
      );
    }
  });

  it("same seed produces the identical chest + booster sequence", () => {
    const a = makeSim(777);
    const b = makeSim(777);
    const relevant = (e: SimEvent): boolean =>
      e.type === "chest_spawned" || e.type === "chest_opened" || e.type === "booster_collected";
    const logA: SimEvent[] = [];
    const logB: SimEvent[] = [];
    for (let i = 0; i < 600; i++) {
      logA.push(...a.step([drive(a.state), emptyInput()]).filter(relevant));
      logB.push(...b.step([drive(b.state), emptyInput()]).filter(relevant));
    }
    expect(JSON.stringify(logA)).toBe(JSON.stringify(logB));
    // The drive controller actually collected at least one booster, so the
    // equality above is meaningful (not two empty logs).
    expect(logA.some((e) => e.type === "booster_collected")).toBe(true);
  });

  it("round reset clears uncollected boosters", () => {
    const sim = makeSim(55);
    openAChest(sim);
    expect(sim.state.boosters).toHaveLength(1);

    // End the round: drop P1, then step so updateRound sees a lone survivor.
    sim.state.players[1]!.alive = false;
    sim.step([emptyInput(), emptyInput()]);
    expect(sim.state.round.phase).toBe("ended");

    idle(sim, msToTicks(TEST_TUNING.roundRestartDelayMs) + 2);
    expect(sim.state.round.phase).toBe("running");
    expect(sim.state.boosters).toHaveLength(0);
  });
});
