import { describe, expect, it } from "vitest";
import { botTick, createBotMemory } from "../src/bot";
import { mkArrow, mkCtx, mkDifficulty, mkPlayer, mkState } from "./fixtures";

describe("engage", () => {
  it("fires when a target is lined up, in range, and off cooldown", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100, facing: 1 });
    const foe = mkPlayer({ slot: 1, x: 150, y: 101 }); // aligned horizontally, 50px away
    const out = botTick(mkState([me, foe]), 0, mkCtx(mkDifficulty()), createBotMemory());
    expect(out.shoot).toBe(true);
    expect(out.right).toBe(true); // faces/aims toward the target
  });

  it("closes the distance instead of firing when not lined up", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100 });
    const foe = mkPlayer({ slot: 1, x: 200, y: 140 }); // far and 40px below
    const out = botTick(mkState([me, foe]), 0, mkCtx(mkDifficulty()), createBotMemory());
    expect(out.shoot).toBe(false);
    expect(out.right).toBe(true);
  });

  it("aimErrorChance=1 suppresses the shot even when perfectly lined up", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100, facing: 1 });
    const foe = mkPlayer({ slot: 1, x: 150, y: 100 });
    const out = botTick(
      mkState([me, foe]),
      0,
      mkCtx(mkDifficulty({ aimErrorChance: 1 })),
      createBotMemory()
    );
    expect(out.shoot).toBe(false);
  });

  it("jumps to climb a wall blocking the path to the target", () => {
    // Solid column at col 3 (x 48–63); bot flush against its left face, moving right.
    const tiles = Array.from({ length: 15 }, (_, r) => (r < 14 ? "...#................" : "####################"));
    const me = mkPlayer({ slot: 0, x: 42, y: 13 * 16 - 6, grounded: true });
    const foe = mkPlayer({ slot: 1, x: 120, y: 13 * 16 - 6 });
    const ctx = mkCtx(mkDifficulty(), 1, { name: "wall", tiles, spawns: [] });
    const out = botTick(mkState([me, foe]), 0, ctx, createBotMemory());
    expect(out.right).toBe(true);
    expect(out.jump).toBe(true);
  });
});

describe("dodge", () => {
  it("hops and breaks away from an incoming arrow when the roll succeeds", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100, grounded: true });
    const foe = mkPlayer({ slot: 1, x: 100, y: 100 }); // present so a target exists
    foe.x = 250;
    const threat = mkArrow({ id: 7, x: 60, y: 100, vx: 350, vy: 0, ownerSlot: 1 });
    const out = botTick(
      mkState([me, foe], [threat]),
      0,
      mkCtx(mkDifficulty({ dodgeChance: 1 })),
      createBotMemory()
    );
    expect(out.jump).toBe(true); // grounded → hop the horizontal shot
    expect(out.right).toBe(true); // flee away from the arrow (to its right)
  });

  it("does not dodge when dodgeChance is 0", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100, grounded: true });
    const foe = mkPlayer({ slot: 1, x: 250, y: 100 });
    const threat = mkArrow({ id: 7, x: 60, y: 100, vx: 350, vy: 0, ownerSlot: 1 });
    const mem = createBotMemory();
    const out = botTick(mkState([me, foe], [threat]), 0, mkCtx(mkDifficulty()), mem);
    expect(mem.dodgeTicksLeft).toBe(0);
    void out;
  });
});

describe("scavenge (out of arrows)", () => {
  it("walks toward the nearest pickup", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100, quiver: [] });
    const stuck = mkArrow({ id: 1, x: 60, y: 100, phase: "stuck" });
    const out = botTick(mkState([me], [stuck]), 0, mkCtx(mkDifficulty()), createBotMemory());
    expect(out.left).toBe(true);
    expect(out.shoot).toBe(false);
  });

  it("hovers over an opponent it can stomp, without jumping away", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 80, quiver: [] });
    const victim = mkPlayer({ slot: 1, x: 112, y: 110 });
    const out = botTick(mkState([me, victim]), 0, mkCtx(mkDifficulty()), createBotMemory());
    expect(out.right).toBe(true); // stay above the victim (x 100 → 112)
    expect(out.jump).toBe(false);
  });
});

describe("reaction delay", () => {
  it("keeps the cached target until the reaction window elapses", () => {
    const me = mkPlayer({ slot: 0, x: 100, y: 100 });
    const a = mkPlayer({ slot: 1, x: 130, y: 100 }); // nearest now
    const b = mkPlayer({ slot: 2, x: 220, y: 100 });
    const mem = createBotMemory();
    const ctx = mkCtx(mkDifficulty({ reactionDelayTicks: 5 }));
    botTick(mkState([me, a, b]), 0, ctx, mem);
    expect(mem.targetSlot).toBe(1);

    // b is now the closest, but within the reaction window the target sticks.
    const a2 = mkPlayer({ slot: 1, x: 260, y: 100 });
    const b2 = mkPlayer({ slot: 2, x: 140, y: 100 });
    botTick(mkState([me, a2, b2]), 0, ctx, mem);
    expect(mem.targetSlot).toBe(1);
  });
});
