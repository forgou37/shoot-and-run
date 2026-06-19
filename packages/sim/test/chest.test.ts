import { describe, expect, it } from "vitest";
import { createSim, type Sim, type SimEvent } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { msToTicks } from "../src/tuning";
import { CHEST_ARENA, FLAT_ARENA, TEST_TUNING } from "./fixtures";

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

describe("treasure chests (spec 002 T2.3)", () => {
  it("spawns at the interval on a defined spot with pooled contents", () => {
    const sim = makeSim(123);
    const events = idle(sim, INTERVAL_TICKS + 2);
    const spawned = events.find((e) => e.type === "chest_spawned");
    expect(spawned).toBeDefined();
    if (spawned?.type === "chest_spawned") {
      expect(CHEST_ARENA.chestSpots).toContainEqual({ x: spawned.x, y: spawned.y });
      expect(["bomb", "laser", "bounce", "invisibility", "flight", "shield", "wall"]).toContain(
        spawned.contents
      );
    }
    expect(sim.state.chests).toHaveLength(1);
  });

  it("same seed produces the identical chest sequence; respects maxChestsAlive", () => {
    const a = makeSim(777);
    const b = makeSim(777);
    const eventsA = idle(a, INTERVAL_TICKS * 5 + 10).filter((e) => e.type === "chest_spawned");
    const eventsB = idle(b, INTERVAL_TICKS * 5 + 10).filter((e) => e.type === "chest_spawned");
    expect(JSON.stringify(eventsA)).toBe(JSON.stringify(eventsB));
    // Nobody opened anything: the alive cap (2) held despite 5 intervals.
    expect(a.state.chests.length).toBeLessThanOrEqual(TEST_TUNING.maxChestsAlive);
  });

  it("walking into a chest opens it, popping a booster without granting (spec 014)", () => {
    const sim = makeSim(42);
    const events = idle(sim, INTERVAL_TICKS + 2);
    const spawned = events.find((e) => e.type === "chest_spawned");
    expect(spawned).toBeDefined();
    if (spawned?.type !== "chest_spawned") return;

    // March P0 toward the chest along the floor (wrap makes direction moot,
    // but pick the shorter way).
    const all: SimEvent[] = [];
    const dir = spawned.x > sim.state.players[0]!.x ? { right: true } : { left: true };
    for (let i = 0; i < 600 && sim.state.chests.length > 0; i++) {
      all.push(...sim.step([inp(dir), emptyInput()]));
    }
    const opened = all.find((e) => e.type === "chest_opened");
    expect(opened).toMatchObject({ slot: 0, contents: spawned.contents });
    expect(sim.state.chests).toHaveLength(0);

    // Opening now pops a floating booster; the contents are NOT granted yet, and
    // nothing was collected at the open moment (the booster floats overhead).
    expect(all.filter((e) => e.type === "booster_collected")).toHaveLength(0);
    expect(sim.state.boosters).toHaveLength(1);
    expect(sim.state.boosters[0]).toMatchObject({ contents: spawned.contents });

    const p = sim.state.players[0]!;
    expect(p.quiver.length).toBe(TEST_TUNING.startingArrows);
    expect(p.invisibleTicksLeft).toBe(0);
    expect(p.flightTicksLeft).toBe(0);
  });

  it("arenas without chestSpots never spawn chests", () => {
    const sim = createSim({
      arena: FLAT_ARENA,
      tuning: TEST_TUNING,
      players: [{ slot: 0 }, { slot: 1 }],
      seed: 9
    });
    const events = idle(sim, INTERVAL_TICKS * 3);
    expect(events.filter((e) => e.type === "chest_spawned")).toHaveLength(0);
    expect(sim.state.chests).toHaveLength(0);
  });

  it("round reset clears chests and reschedules spawning", () => {
    const sim = makeSim(55);
    idle(sim, INTERVAL_TICKS + 2);
    expect(sim.state.chests).toHaveLength(1);

    // P0 kills P1 via wrap shot to end the round.
    for (let t = 0; t < 80 && sim.state.round.phase === "running"; t++) {
      sim.step([inp({ left: true, shoot: t === 0 }), emptyInput()]);
    }
    expect(sim.state.round.phase).toBe("ended");
    idle(sim, msToTicks(TEST_TUNING.roundRestartDelayMs) + 2);
    expect(sim.state.round.phase).toBe("running");
    expect(sim.state.chests).toHaveLength(0);
    expect(sim.state.nextChestTick).toBeGreaterThan(sim.state.tick);
  });
});
