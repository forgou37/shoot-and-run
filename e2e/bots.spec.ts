import { expect, test, type Page } from "@playwright/test";

/**
 * Bot e2e (spec 004 T4.6). Covers shell glue the headless bot suite can't reach:
 * the ?bots=N quickstart boot and the lobby add-bot flow actually wiring a
 * BotDevice into a running match. The bot's decision logic is tested headless in
 * packages/bots; here we only assert a bot-driven player comes alive and acts.
 */

async function waitForPhase(
  page: Page,
  phase: "title" | "lobby" | "match",
  timeout = 12000
): Promise<void> {
  await page.waitForFunction((p) => window.__testApi?.getPhase() === p, phase, { timeout });
}

/** The bot-controlled player (slot 1) moves or shoots; the keyboard player
 *  (slot 0) is idle in these tests, so any arrow_fired is the bot's. */
async function waitForBotToAct(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = window.__testApi;
      const st = api?.getState?.();
      const ev = api?.getEvents?.();
      if (!st || !ev) return false;
      const bot = st.players[1];
      const moved = Boolean(bot && bot.vx !== 0);
      const fired = ev.some((e) => e.type === "arrow_fired");
      return moved || fired;
    },
    undefined,
    { timeout: 20000 }
  );
}

test("?bots=1 boots a human-vs-bot match and the bot acts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/?bots=1&difficulty=hard");
  await page.waitForFunction(() => Boolean(window.__testApi));
  await waitForPhase(page, "match");

  const players = await page.evaluate(() => window.__testApi!.getState!().players.length);
  expect(players).toBe(2); // one keyboard + one bot

  await waitForBotToAct(page);
  expect(errors).toEqual([]);
});

test("lobby: a human adds a bot and starts the match", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__testApi));
  await waitForPhase(page, "title");

  await page.keyboard.press("Space", { delay: 90 }); // title → lobby
  await waitForPhase(page, "lobby");

  await page.keyboard.press("KeyG", { delay: 90 }); // P1 (keyboard 0) joins slot 0 = controller
  await page.keyboard.press("KeyD", { delay: 90 }); // controller right → add a bot
  await page.keyboard.press("KeyG", { delay: 90 }); // P1 readies; bot is always ready

  await waitForPhase(page, "match"); // the lobby countdown elapses
  const players = await page.evaluate(() => window.__testApi!.getState!().players.length);
  expect(players).toBe(2);

  await waitForBotToAct(page);
  expect(errors).toEqual([]);
});
