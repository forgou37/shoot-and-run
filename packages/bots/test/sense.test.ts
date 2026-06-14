import { ARENA_WIDTH, emptyInput } from "@shoot-and-run/sim";
import { describe, expect, it } from "vitest";
import {
  aimAt,
  faceAndFire,
  moveToward,
  nearestOpponent,
  nearestPickup,
  nearestThreat,
  opponentsOf,
  stompTargetBelow,
  wrapVecTo
} from "../src/sense";
import { mkArrow, mkPlayer, mkState } from "./fixtures";

describe("wrapVecTo", () => {
  it("takes the shortest path across the horizontal seam", () => {
    const a = { x: 10, y: 100 };
    const b = { x: ARENA_WIDTH - 10, y: 100 };
    // Naively b is +300 to the right; the short way is 20px to the LEFT.
    expect(wrapVecTo(a, b).dx).toBe(-20);
  });
});

describe("opponentsOf", () => {
  it("excludes self, the dead, and teammates", () => {
    const me = mkPlayer({ slot: 0, x: 50, y: 50, team: 0 });
    const teammate = mkPlayer({ slot: 1, x: 60, y: 50, team: 0 });
    const enemy = mkPlayer({ slot: 2, x: 70, y: 50, team: 1 });
    const deadEnemy = mkPlayer({ slot: 3, x: 80, y: 50, team: 1, alive: false });
    const opp = opponentsOf(me, mkState([me, teammate, enemy, deadEnemy]));
    expect(opp.map((p) => p.slot)).toEqual([2]);
  });

  it("treats everyone else as an opponent in FFA", () => {
    const me = mkPlayer({ slot: 0, x: 50, y: 50 });
    const o1 = mkPlayer({ slot: 1, x: 60, y: 50 });
    const o2 = mkPlayer({ slot: 2, x: 70, y: 50 });
    expect(opponentsOf(me, mkState([me, o1, o2])).map((p) => p.slot)).toEqual([1, 2]);
  });
});

describe("nearestOpponent", () => {
  it("picks the closest by wrap distance", () => {
    const me = mkPlayer({ slot: 0, x: 10, y: 100 });
    const far = mkPlayer({ slot: 1, x: 160, y: 100 });
    const nearViaWrap = mkPlayer({ slot: 2, x: ARENA_WIDTH - 15, y: 100 }); // 25px left
    const opp = opponentsOf(me, mkState([me, far, nearViaWrap]));
    expect(nearestOpponent(me, opp)?.slot).toBe(2);
  });
});

describe("nearestPickup", () => {
  it("finds the nearest stuck arrow or chest, ignoring flying arrows", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100, quiver: [] });
    const flying = mkArrow({ id: 1, x: 105, y: 100, phase: "flying" });
    const stuck = mkArrow({ id: 2, x: 130, y: 100, phase: "stuck" });
    const state = mkState([me], [flying, stuck], [{ id: 9, x: 200, y: 100, contents: "bomb" }]);
    const p = nearestPickup(me, state);
    expect(p).toEqual({ x: 130, y: 100, kind: "arrow" });
  });
});

describe("nearestThreat", () => {
  it("flags an arrow flying toward the bot", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100 });
    const incoming = mkArrow({ id: 1, x: 60, y: 100, vx: 350, vy: 0, ownerSlot: 1 });
    expect(nearestThreat(me, mkState([me], [incoming]))?.id).toBe(1);
  });

  it("ignores arrows moving away and the bot's own arrows", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100 });
    const away = mkArrow({ id: 1, x: 140, y: 100, vx: 350, vy: 0, ownerSlot: 1 });
    const mine = mkArrow({ id: 2, x: 60, y: 100, vx: 350, vy: 0, ownerSlot: 0 });
    expect(nearestThreat(me, mkState([me], [away, mine]))).toBeNull();
  });

  it("ignores an arrow that will sail past out of range", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100 });
    const wide = mkArrow({ id: 1, x: 60, y: 160, vx: 350, vy: 0, ownerSlot: 1 }); // 60px below
    expect(nearestThreat(me, mkState([me], [wide]))).toBeNull();
  });
});

describe("moveToward", () => {
  it("steers along the shortest wrap direction", () => {
    const me = mkPlayer({ slot: 0, x: 10, y: 100 });
    const input = emptyInput();
    expect(moveToward(input, me, ARENA_WIDTH - 10)).toBe(-1); // wrap left
    expect(input.left).toBe(true);
    expect(input.right).toBe(false);
  });
});

describe("aimAt / faceAndFire", () => {
  it("lines up a horizontal shot toward the target", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100 });
    const aim = aimAt(me, 140, 102, 8);
    expect(aim).toMatchObject({ dirX: 1, dirY: 0, aligned: true });
  });

  it("lines up a vertical shot when stacked", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100 });
    const aim = aimAt(me, 102, 60, 8);
    expect(aim).toMatchObject({ dirX: 0, dirY: -1, aligned: true });
  });

  it("is not aligned when neither axis is within tolerance", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100 });
    expect(aimAt(me, 150, 130, 8).aligned).toBe(false);
  });

  it("faceAndFire holds aim keys and reports in-range alignment", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100 });
    const input = emptyInput();
    const lined = faceAndFire(input, me, 140, 101, 8, 90);
    expect(lined).toBe(true);
    expect(input.right).toBe(true);
    expect(input.shoot).toBe(false); // never presses shoot itself
  });

  it("faceAndFire reports false when target is beyond range", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100 });
    const input = emptyInput();
    expect(faceAndFire(input, me, 100 + 120, 101, 8, 90)).toBe(false);
  });
});

describe("stompTargetBelow", () => {
  it("detects an opponent directly below", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 80 });
    const below = mkPlayer({ slot: 1, x: 103, y: 110 });
    expect(stompTargetBelow(me, [below])?.slot).toBe(1);
  });

  it("ignores an opponent off to the side", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 80 });
    const beside = mkPlayer({ slot: 1, x: 140, y: 110 });
    expect(stompTargetBelow(me, [beside])).toBeNull();
  });
});
