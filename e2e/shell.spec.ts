import { expect, test, type Page } from "@playwright/test";

/**
 * Shell smoke suite (spec 001 T1.5). Tests the glue the headless sim suite
 * can't reach: boot, content loading through Vite, real-keyboard input
 * mapping, and the accumulator. Game rules are NEVER re-tested here.
 */

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  // Spec 003: the default boot now lands on the title screen; ?quickstart=1
  // skips straight into the 2-keyboard FFA match these smoke tests assert on.
  // The base hook (getPhase) installs at boot; wait for ArenaScene to wire the
  // match-only methods before the tests call them.
  await page.goto("/?quickstart=1");
  await page.waitForFunction(() => typeof window.__testApi?.getState === "function");
  return errors;
}

test("boot: canvas renders, round starts, zero console errors", async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForFunction(() =>
    window.__testApi!.getEvents().some((e) => e.type === "round_started")
  );
  expect(errors).toEqual([]);
});

test("content: arena and tuning flowed through Vite into the sim", async ({ page }) => {
  await boot(page);
  const info = await page.evaluate(() => {
    const api = window.__testApi!;
    const state = api.getState();
    return {
      arena: api.getArenaName(),
      playerCount: state.players.length,
      startingArrows: state.players[0]!.quiver.length,
      scores: state.match.scores
    };
  });
  expect(info.arena).toBe("canopy"); // spec 007: the shell boots into arena-002
  expect(info.playerCount).toBe(2);
  expect(info.startingArrows).toBe(3); // from content/tuning.json
  expect(info.scores).toHaveLength(2);
});

test("input: real key events move both players simultaneously", async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() =>
    window.__testApi!.getState().players.every((p) => p.grounded)
  );
  const before = await page.evaluate(() =>
    window.__testApi!.getState().players.map((p) => p.x)
  );

  await page.keyboard.down("KeyD"); // P1 right (content/players.json binding)
  await page.keyboard.down("ArrowLeft"); // P2 left
  await page.waitForFunction(() => {
    const players = window.__testApi!.getState().players;
    return players[0]!.vx > 0 && players[1]!.vx < 0;
  });
  await page.waitForTimeout(250);
  await page.keyboard.up("KeyD");
  await page.keyboard.up("ArrowLeft");

  const after = await page.evaluate(() =>
    window.__testApi!.getState().players.map((p) => p.x)
  );
  expect(after[0]!).toBeGreaterThan(before[0]!);
  expect(after[1]!).toBeLessThan(before[1]!);
});

test("sprites: archer atlas and per-slot animations loaded (spec 006)", async ({ page }) => {
  await boot(page);
  const probe = await page.evaluate(() => window.__testApi!.getSpriteProbe());
  expect(probe.textures).toContain("archer"); // generic atlas — always loaded, recolor-fallback base
  // spec 014: default-roster slots use per-character named sheets (covered by the
  // four-atlas test below), so the per-slot recolor copy ("archer-1") is no longer
  // created; what matters here is every per-slot animation built with no gaps.
  expect(probe.missingAnims).toEqual([]);
});

test("sprites: four per-character archer atlases loaded (spec 014)", async ({ page }) => {
  await boot(page);
  const probe = await page.evaluate(() => window.__testApi!.getSpriteProbe());
  for (const key of ["archer_maks", "archer_igorb", "archer_lyosha", "archer_igorsh"]) {
    expect(probe.textures).toContain(key);
  }
  expect(probe.missingAnims).toEqual([]);
});

test("sprites: jungle environment and arrow atlases loaded (spec 007)", async ({ page }) => {
  await boot(page);
  const probe = await page.evaluate(() => window.__testApi!.getSpriteProbe());
  for (const key of ["jungle-tiles", "jungle-bg", "chest", "arrow"]) {
    expect(probe.textures).toContain(key);
  }
});

test("sprites: booster and shield-bubble atlases loaded (spec 014)", async ({ page }) => {
  await boot(page);
  const probe = await page.evaluate(() => window.__testApi!.getSpriteProbe());
  for (const key of ["boosters", "shield-bubble"]) {
    expect(probe.textures).toContain(key);
  }
});

test("render: floating boosters + shield bubble draw without errors (spec 014)", async ({ page }) => {
  const errors = await boot(page);
  // Inject a floating booster and a shielded player, then step so the renderers
  // exercise the new draw paths (a chest spawn is too slow for an e2e).
  await page.evaluate(() => {
    const api = window.__testApi!;
    api.setManual(true);
    const state = api.getState() as unknown as {
      boosters: { id: number; x: number; y: number; contents: string; spawnTick: number }[];
      players: { shielded: boolean }[];
      tick: number;
    };
    state.boosters.push({ id: 9001, x: 160, y: 120, contents: "shield", spawnTick: state.tick });
    state.boosters.push({ id: 9002, x: 80, y: 90, contents: "bomb", spawnTick: state.tick });
    if (state.players[0]) state.players[0].shielded = true;
    api.stepTicks(1);
  });
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
});

test("stability: ~10s under rAF ticks the sim at ~60 Hz with no errors", async ({ page }) => {
  const errors = await boot(page);
  const t0 = await page.evaluate(() => window.__testApi!.getState().tick);
  await page.waitForTimeout(10_000);
  const t1 = await page.evaluate(() => window.__testApi!.getState().tick);
  const ticks = t1 - t0;
  expect(ticks).toBeGreaterThan(450);
  expect(ticks).toBeLessThan(750);
  expect(errors).toEqual([]);
});
