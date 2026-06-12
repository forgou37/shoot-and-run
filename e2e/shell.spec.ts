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
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__testApi));
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
  expect(probe.textures).toContain("archer");
  expect(probe.textures).toContain("archer-1"); // P2's recolored copy
  expect(probe.missingAnims).toEqual([]);
});

test("sprites: jungle environment and arrow atlases loaded (spec 007)", async ({ page }) => {
  await boot(page);
  const probe = await page.evaluate(() => window.__testApi!.getSpriteProbe());
  for (const key of ["jungle-tiles", "jungle-bg", "chest", "arrow"]) {
    expect(probe.textures).toContain(key);
  }
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
