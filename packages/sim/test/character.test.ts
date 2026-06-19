import { describe, expect, it } from "vitest";
import {
  ARENA_WIDTH,
  checkArrowKills,
  checkStomps,
  createSim,
  deriveTuning,
  emptyInput,
  grant,
  MUZZLE_IMMUNITY_TICKS,
  protectedByNoHomo,
  resolveExplosions,
  type ArrowState,
  type BoosterState,
  type PlayerState,
  type Sim,
  type SimEvent
} from "../src/index";
import { FLAT_ARENA, TEST_TUNING } from "./fixtures";

/**
 * Spec 019 T19.1 — character-booster framework + Igor B "No homo" shield.
 * Most of the kill-gate behavior is exercised with the kill functions directly
 * (precise control over distances), plus a couple of createSim integration tests
 * for the grant/pickup path, round-reset clearing, and determinism.
 */

const DERIVED = deriveTuning(TEST_TUNING);

function mkPlayer(slot: number, over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: slot + 1,
    slot,
    team: null,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    facing: 1,
    quiver: [],
    alive: true,
    grounded: false,
    coyoteTicksLeft: 0,
    jumpBufferTicksLeft: 0,
    prevJumpHeld: false,
    prevShootHeld: false,
    prevDashHeld: false,
    dashTicksLeft: 0,
    dashCooldownTicksLeft: 0,
    dashDir: 1,
    wallJumpLockTicksLeft: 0,
    jumpCutAvailable: false,
    invisibleTicksLeft: 0,
    flightTicksLeft: 0,
    shielded: false,
    wallCharges: 0,
    prevBuildHeld: false,
    noHomoTicksLeft: 0,
    ...over
  };
}

function mkArrow(over: Partial<ArrowState> = {}): ArrowState {
  return {
    id: 99,
    ownerSlot: 0,
    kind: "normal",
    phase: "flying",
    firedTick: 0,
    bouncesLeft: 0,
    pierced: false,
    insideSolid: false,
    x: 100,
    y: 100,
    vx: 100,
    vy: 0,
    ...over
  };
}

const farPastImmunity = MUZZLE_IMMUNITY_TICKS + 5;

describe("character booster — grant dispatch (spec 019)", () => {
  it("grants Igor B (slot 1) the no-homo timer; other slots are a no-op", () => {
    const igorB = mkPlayer(1);
    grant(igorB, "character", DERIVED);
    expect(igorB.noHomoTicksLeft).toBe(DERIVED.noHomoTicks);

    for (const slot of [0, 2, 3]) {
      const p = mkPlayer(slot);
      grant(p, "character", DERIVED);
      expect(p.noHomoTicksLeft).toBe(0); // filled in by later phases
    }
  });

  it("collecting a floating character booster grants the ability (Igor B)", () => {
    const sim = createSim({ arena: FLAT_ARENA, tuning: TEST_TUNING, players: [{ slot: 0 }, { slot: 1 }], seed: 7 });
    const p1 = sim.state.players[1]!;
    // Drop a booster right on Igor B so the next tick collects it.
    (sim.state.boosters as BoosterState[]).push({
      id: 500,
      x: p1.x,
      y: p1.y,
      contents: "character",
      spawnTick: sim.state.tick
    });
    const events = sim.step([emptyInput(), emptyInput()]);
    expect(events.find((e) => e.type === "booster_collected")).toMatchObject({ slot: 1, contents: "character" });
    expect(p1.noHomoTicksLeft).toBeGreaterThan(0);
  });
});

describe("no-homo gate — protectedByNoHomo (spec 019)", () => {
  it("active + within radius → protected; beyond radius / inactive → not", () => {
    const victim = mkPlayer(1, { x: 100, y: 100, noHomoTicksLeft: 100 });
    expect(protectedByNoHomo(victim, 110, 100, DERIVED)).toBe(true); // 10px ≤ 16
    expect(protectedByNoHomo(victim, 100, 100, DERIVED)).toBe(true); // point-blank
    expect(protectedByNoHomo(victim, 120, 100, DERIVED)).toBe(false); // 20px > 16
    victim.noHomoTicksLeft = 0;
    expect(protectedByNoHomo(victim, 100, 100, DERIVED)).toBe(false); // inactive
  });

  it("is wrap-aware across the arena seam", () => {
    const victim = mkPlayer(1, { x: 5, y: 100, noHomoTicksLeft: 100 });
    // source at x=317 is 8px away across the left seam (5 → 0 → 320 → 317).
    expect(protectedByNoHomo(victim, ARENA_WIDTH - 3, 100, DERIVED)).toBe(true);
  });
});

describe("no-homo kill gates (spec 019)", () => {
  it("arrow: a point-blank hit is negated (arrow still sticks); without it, kills", () => {
    const victim = mkPlayer(1, { x: 100, y: 100, noHomoTicksLeft: 100 });
    const arrow = mkArrow({ ownerSlot: 0, x: 100, y: 100 });
    const events: SimEvent[] = [];
    checkArrowKills([arrow], [mkPlayer(0, { x: 50 }), victim], DERIVED, events, farPastImmunity, true);
    expect(victim.alive).toBe(true);
    expect(events.some((e) => e.type === "player_killed")).toBe(false);
    expect(arrow.phase).toBe("stuck"); // the blocked arrow becomes a pickup
    expect(events.find((e) => e.type === "arrow_stuck")).toBeDefined();

    // Same hit, timer expired → kill.
    const exposed = mkPlayer(1, { x: 100, y: 100, noHomoTicksLeft: 0 });
    const ev2: SimEvent[] = [];
    checkArrowKills([mkArrow({ ownerSlot: 0, x: 100, y: 100 })], [mkPlayer(0, { x: 50 }), exposed], DERIVED, ev2, farPastImmunity, true);
    expect(exposed.alive).toBe(false);
  });

  it("bomb: an adjacent blast (≤16) is negated, a farther one (>16, ≤radius) still kills", () => {
    const near = mkPlayer(1, { x: 110, y: 100, noHomoTicksLeft: 100 }); // 10px from blast
    const far = mkPlayer(2, { x: 122, y: 100, noHomoTicksLeft: 100 }); // 22px: outside 16, inside 28
    const bomb = mkArrow({ ownerSlot: 0, kind: "bomb", phase: "exploding", x: 100, y: 100 });
    const events: SimEvent[] = [];
    resolveExplosions([bomb], [near, far], DERIVED, events, 10, true);
    expect(near.alive).toBe(true); // shielded by no-homo
    expect(far.alive).toBe(false); // beyond the no-homo radius
  });

  it("stomp: an active shield makes the victim un-stompable (attacker still bounces)", () => {
    const attacker = mkPlayer(0, { x: 100, y: 88, vy: 20 }); // above the victim, falling
    const victim = mkPlayer(1, { x: 100, y: 100, vy: 0, noHomoTicksLeft: 100 });
    const events: SimEvent[] = [];
    checkStomps([attacker, victim], DERIVED, events, 10, true);
    expect(victim.alive).toBe(true);
    expect(events.some((e) => e.type === "player_killed")).toBe(false);
    expect(attacker.vy).toBe(-DERIVED.stompBounceVelocity); // bounced off the head

    // Without the shield, the same stomp kills.
    const attacker2 = mkPlayer(0, { x: 100, y: 88, vy: 20 });
    const exposed = mkPlayer(1, { x: 100, y: 100, vy: 0 });
    const ev2: SimEvent[] = [];
    checkStomps([attacker2, exposed], DERIVED, ev2, 10, true);
    expect(exposed.alive).toBe(false);
    expect(ev2.find((e) => e.type === "player_killed")).toMatchObject({ victim: 1, cause: "stomp" });
  });
});

describe("no-homo lifecycle (spec 019)", () => {
  it("round reset clears the no-homo timer", () => {
    const sim: Sim = createSim({ arena: FLAT_ARENA, tuning: TEST_TUNING, players: [{ slot: 0 }, { slot: 1 }], seed: 3 });
    sim.state.players[1]!.noHomoTicksLeft = 500;

    sim.state.players[1]!.alive = false; // P0 wins → round ends
    sim.step([emptyInput(), emptyInput()]);
    expect(sim.state.round.phase).toBe("ended");
    const delay = DERIVED.roundRestartDelayTicks + 2;
    for (let i = 0; i < delay; i++) sim.step([emptyInput(), emptyInput()]);
    expect(sim.state.round.phase).toBe("running");
    expect(sim.state.players[0]!.noHomoTicksLeft).toBe(0);
  });

  it("no-homo interactions are deterministic per seed", () => {
    const scenario = (): SimEvent[] => {
      const sim = createSim({ arena: FLAT_ARENA, tuning: TEST_TUNING, players: [{ slot: 0 }, { slot: 1 }], seed: 9 });
      for (let i = 0; i < 60; i++) sim.step([emptyInput(), emptyInput()]); // settle
      sim.state.players[1]!.noHomoTicksLeft = 30;
      const ev: SimEvent[] = [];
      for (let t = 0; t < 120 && sim.state.round.phase === "running"; t++) {
        ev.push(...sim.step([{ ...emptyInput(), left: true, shoot: t % 10 === 0 }, emptyInput()]));
      }
      return ev;
    };
    expect(JSON.stringify(scenario())).toBe(JSON.stringify(scenario()));
  });
});
