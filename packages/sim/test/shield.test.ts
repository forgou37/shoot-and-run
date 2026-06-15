import { describe, expect, it } from "vitest";
import type { ArenaData } from "../src/arena";
import { createSim, type Sim, type SimEvent } from "../src/index";
import { emptyInput, type PlayerInput } from "../src/input";
import { msToTicks } from "../src/tuning";
import { FLAT_ARENA, STOMP_ARENA, TEST_TUNING, WALL_ARENA } from "./fixtures";

function inp(partial: Partial<PlayerInput>): PlayerInput {
  return { ...emptyInput(), ...partial };
}

function makeSim(arena: ArenaData = FLAT_ARENA, settle = true): Sim {
  const sim = createSim({ arena, tuning: TEST_TUNING, players: [{ slot: 0 }, { slot: 1 }], seed: 9 });
  if (settle) for (let i = 0; i < 60; i++) sim.step([emptyInput(), emptyInput()]); // settle
  return sim;
}

/** Step until an event of `until` appears (or maxTicks), returning all events. */
function runUntil(
  sim: Sim,
  inputsFor: (t: number) => PlayerInput[],
  until: SimEvent["type"],
  maxTicks: number
): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < maxTicks; t++) {
    all.push(...sim.step(inputsFor(t)));
    if (all.some((e) => e.type === until)) break;
  }
  return all;
}

describe("shield power-up (spec 014 T14.2)", () => {
  it("arrow: blocks the first hit (arrow still sticks) then the next kills", () => {
    const sim = makeSim(); // FLAT: P0 x=20, P1 x=300 — a left shot wraps to P1
    sim.state.players[1]!.shielded = true;

    const first = runUntil(
      sim,
      (t) => [inp({ left: true, shoot: t === 0 }), emptyInput()],
      "shield_blocked",
      60
    );
    expect(first.find((e) => e.type === "shield_blocked")).toMatchObject({ slot: 1 });
    expect(first.filter((e) => e.type === "player_killed")).toHaveLength(0);
    expect(sim.state.players[1]!.alive).toBe(true);
    expect(sim.state.players[1]!.shielded).toBe(false);
    // The blocked arrow still became a pickup.
    expect(first.find((e) => e.type === "arrow_stuck")).toBeDefined();

    // A second arrow (no shield left) kills.
    const second = runUntil(
      sim,
      (t) => [inp({ left: true, shoot: t === 0 }), emptyInput()],
      "player_killed",
      60
    );
    expect(second.find((e) => e.type === "player_killed")).toMatchObject({
      victim: 1,
      killer: 0,
      cause: "arrow"
    });
  });

  it("bomb: a shield absorbs the first blast then the next kills", () => {
    const sim = makeSim(WALL_ARENA); // P0 x=200, wall face ~240
    sim.state.players[1]!.x = 260; // behind the wall, inside the blast radius
    sim.state.players[1]!.shielded = true;
    sim.state.players[0]!.quiver.unshift("bomb");

    const first = runUntil(sim, (t) => [inp({ shoot: t === 0 }), emptyInput()], "shield_blocked", 60);
    expect(first.find((e) => e.type === "arrow_exploded")).toBeDefined();
    expect(first.find((e) => e.type === "shield_blocked")).toMatchObject({ slot: 1 });
    expect(first.filter((e) => e.type === "player_killed")).toHaveLength(0);
    expect(sim.state.players[1]!.alive).toBe(true);
    expect(sim.state.players[1]!.shielded).toBe(false);

    sim.state.players[0]!.quiver.unshift("bomb");
    const second = runUntil(sim, (t) => [inp({ shoot: t === 0 }), emptyInput()], "player_killed", 60);
    expect(second.find((e) => e.type === "player_killed")).toMatchObject({
      victim: 1,
      cause: "bomb"
    });
  });

  it("stomp: a shield blocks the first stomp (attacker still bounces) then the next kills", () => {
    // No settle: P0 falls from above onto P1, so set the shield before it lands.
    const sim = makeSim(STOMP_ARENA, false);
    sim.state.players[1]!.shielded = true;

    const events: SimEvent[] = [];
    let bounceVy = 0;
    for (let t = 0; t < 600 && sim.state.round.phase === "running"; t++) {
      const ev = sim.step([emptyInput(), emptyInput()]);
      if (bounceVy === 0 && ev.some((e) => e.type === "shield_blocked")) {
        bounceVy = sim.state.players[0]!.vy; // captured the tick of the blocked stomp
      }
      events.push(...ev);
      if (ev.some((e) => e.type === "player_killed")) break;
    }

    const blocked = events.find((e) => e.type === "shield_blocked");
    const kill = events.find((e) => e.type === "player_killed");
    expect(blocked).toMatchObject({ slot: 1 });
    expect(kill).toMatchObject({ victim: 1, killer: 0, cause: "stomp" });
    expect(blocked!.tick).toBeLessThan(kill!.tick);
    expect(bounceVy).toBeLessThan(0); // the attacker bounced off the shielded head
  });

  it("round reset clears the shield charge", () => {
    const sim = makeSim();
    sim.state.players[0]!.shielded = true;

    sim.state.players[1]!.alive = false;
    sim.step([emptyInput(), emptyInput()]);
    expect(sim.state.round.phase).toBe("ended");

    const delay = msToTicks(TEST_TUNING.roundRestartDelayMs) + 2;
    for (let i = 0; i < delay; i++) sim.step([emptyInput(), emptyInput()]);
    expect(sim.state.round.phase).toBe("running");
    expect(sim.state.players[0]!.shielded).toBe(false);
  });

  it("shield interactions are deterministic per seed", () => {
    const scenario = (): SimEvent[] => {
      const sim = makeSim();
      sim.state.players[1]!.shielded = true;
      const ev: SimEvent[] = [];
      for (let t = 0; t < 120 && sim.state.round.phase === "running"; t++) {
        ev.push(...sim.step([inp({ left: true, shoot: t % 10 === 0 }), emptyInput()]));
      }
      return ev;
    };
    const a = scenario();
    const b = scenario();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Meaningful: the run both blocked and then killed.
    expect(a.some((e) => e.type === "shield_blocked")).toBe(true);
    expect(a.some((e) => e.type === "player_killed")).toBe(true);
  });
});
