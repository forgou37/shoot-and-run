import { describe, expect, it } from "vitest";
import {
  ARENA_WIDTH,
  checkArrowKills,
  checkStomps,
  createSim,
  deriveTuning,
  emptyInput,
  grant,
  handleBuilding,
  handlePhase,
  MUZZLE_IMMUNITY_TICKS,
  protectedByNoHomo,
  resolveExplosions,
  type ArrowState,
  type BoosterState,
  type PlayerInput,
  type PlayerState,
  type Sim,
  type SimEvent,
  type WallState
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
    blackoutTicksLeft: 0,
    phaseChargesLeft: 0,
    phaseTicksLeft: 0,
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
  it("grants Igor B (slot 1) the no-homo timer; Maks (slot 0) the blackout timer", () => {
    const igorB = mkPlayer(1);
    grant(igorB, "character", DERIVED);
    expect(igorB.noHomoTicksLeft).toBe(DERIVED.noHomoTicks);
    expect(igorB.blackoutTicksLeft).toBe(0);

    const maks = mkPlayer(0);
    grant(maks, "character", DERIVED);
    expect(maks.blackoutTicksLeft).toBe(DERIVED.blackoutTicks);
    expect(maks.noHomoTicksLeft).toBe(0);

    const igorSh = mkPlayer(3);
    grant(igorSh, "character", DERIVED);
    expect(igorSh.phaseChargesLeft).toBe(DERIVED.phaseCharges);
    expect(igorSh.phaseTicksLeft).toBe(0); // charges only — phasing is spent on build

    const lyosha = mkPlayer(2);
    grant(lyosha, "character", DERIVED);
    expect(lyosha.noHomoTicksLeft).toBe(0); // filled in by Phase 4
    expect(lyosha.blackoutTicksLeft).toBe(0);
    expect(lyosha.phaseChargesLeft).toBe(0);
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

describe("blackout (spec 019, Maks / slot 0)", () => {
  it("the timer decrements each tick and changes no gameplay", () => {
    const sim = createSim({ arena: FLAT_ARENA, tuning: TEST_TUNING, players: [{ slot: 0 }, { slot: 1 }], seed: 5 });
    // Baseline event stream with no blackout active.
    const baseline = createSim({ arena: FLAT_ARENA, tuning: TEST_TUNING, players: [{ slot: 0 }, { slot: 1 }], seed: 5 });
    sim.state.players[0]!.blackoutTicksLeft = 5;
    let ev = "";
    let evBase = "";
    for (let i = 0; i < 8; i++) {
      ev += JSON.stringify(sim.step([emptyInput(), emptyInput()]));
      evBase += JSON.stringify(baseline.step([emptyInput(), emptyInput()]));
    }
    expect(sim.state.players[0]!.blackoutTicksLeft).toBe(0); // 5 → 0, then clamped
    expect(ev).toBe(evBase); // purely cosmetic: identical events with/without blackout
  });

  it("round reset clears the blackout timer", () => {
    const sim = createSim({ arena: FLAT_ARENA, tuning: TEST_TUNING, players: [{ slot: 0 }, { slot: 1 }], seed: 3 });
    sim.state.players[0]!.blackoutTicksLeft = 500;
    sim.state.players[1]!.alive = false; // P0 wins → round ends
    sim.step([emptyInput(), emptyInput()]);
    const delay = DERIVED.roundRestartDelayTicks + 2;
    for (let i = 0; i < delay; i++) sim.step([emptyInput(), emptyInput()]);
    expect(sim.state.round.phase).toBe("running");
    expect(sim.state.players[0]!.blackoutTicksLeft).toBe(0);
  });
});

describe("phase / 'Where am I?' (spec 019, Igor Sh / slot 3)", () => {
  const build = (over: Partial<PlayerInput> = {}): PlayerInput => ({ ...emptyInput(), build: true, ...over });

  it("a build edge spends a charge, starts the phase, and builds no wall", () => {
    const p = mkPlayer(3, { phaseChargesLeft: 2, wallCharges: 5, prevBuildHeld: false });
    const walls: WallState[] = [];
    let nextId = 1;
    handlePhase([p], [build()], DERIVED);
    handleBuilding([p], [build()], walls, () => nextId++, DERIVED, [], 0);
    expect(p.phaseChargesLeft).toBe(1); // one charge spent
    expect(p.phaseTicksLeft).toBe(DERIVED.phaseTicks);
    expect(walls.length).toBe(0); // phase consumed the edge → no wall built
    expect(p.wallCharges).toBe(5); // wall charge untouched
  });

  it("with no charge, the build edge falls through to wall building", () => {
    const p = mkPlayer(3, { phaseChargesLeft: 0, wallCharges: 1, prevBuildHeld: false });
    const walls: WallState[] = [];
    let nextId = 1;
    handlePhase([p], [build()], DERIVED);
    handleBuilding([p], [build()], walls, () => nextId++, DERIVED, [], 0);
    expect(p.phaseTicksLeft).toBe(0);
    expect(walls.length).toBe(1); // a normal wall
  });

  it("does not re-trigger while already phasing (needs a fresh press)", () => {
    const p = mkPlayer(3, { phaseChargesLeft: 2, phaseTicksLeft: 10, prevBuildHeld: false });
    handlePhase([p], [build()], DERIVED);
    expect(p.phaseChargesLeft).toBe(2); // already phasing → no spend
    expect(p.phaseTicksLeft).toBe(10);
  });

  it("arrows pass through a phasing player (keep flying); a stomp still lands", () => {
    const victim = mkPlayer(3, { x: 100, y: 100, phaseTicksLeft: 30 });
    const arrow = mkArrow({ ownerSlot: 0, x: 100, y: 100 });
    const events: SimEvent[] = [];
    checkArrowKills([arrow], [mkPlayer(0, { x: 50 }), victim], DERIVED, events, farPastImmunity, true);
    expect(victim.alive).toBe(true);
    expect(arrow.phase).toBe("flying"); // unaffected — does NOT stick (unlike no-homo)
    expect(events.length).toBe(0);

    // Stomps are unaffected by phase (arrows only): the same player is stompable.
    const attacker = mkPlayer(0, { x: 100, y: 88, vy: 20 });
    const phasing = mkPlayer(3, { x: 100, y: 100, vy: 0, phaseTicksLeft: 30 });
    const ev2: SimEvent[] = [];
    checkStomps([attacker, phasing], DERIVED, ev2, 10, true);
    expect(phasing.alive).toBe(false);
  });

  it("once the phase timer expires, arrows kill again", () => {
    const victim = mkPlayer(3, { x: 100, y: 100, phaseTicksLeft: 0 });
    const events: SimEvent[] = [];
    checkArrowKills([mkArrow({ ownerSlot: 0, x: 100, y: 100 })], [mkPlayer(0, { x: 50 }), victim], DERIVED, events, farPastImmunity, true);
    expect(victim.alive).toBe(false);
  });

  it("the phase timer decrements each tick and clears on round reset", () => {
    const sim = createSim({ arena: FLAT_ARENA, tuning: TEST_TUNING, players: [{ slot: 0 }, { slot: 3 }], seed: 4 });
    sim.state.players[1]!.phaseTicksLeft = 3;
    sim.state.players[1]!.phaseChargesLeft = 2;
    sim.step([emptyInput(), emptyInput()]);
    expect(sim.state.players[1]!.phaseTicksLeft).toBe(2); // decremented

    sim.state.players[1]!.alive = false; // P0 wins → round ends
    sim.step([emptyInput(), emptyInput()]);
    const delay = DERIVED.roundRestartDelayTicks + 2;
    for (let i = 0; i < delay; i++) sim.step([emptyInput(), emptyInput()]);
    expect(sim.state.round.phase).toBe("running");
    expect(sim.state.players[1]!.phaseTicksLeft).toBe(0);
    expect(sim.state.players[1]!.phaseChargesLeft).toBe(0);
  });
});
