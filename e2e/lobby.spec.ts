import { expect, test, type Page } from "@playwright/test";

/**
 * Lobby + gamepad e2e (spec 003 T3.5). Covers shell glue the headless sim
 * suite can't reach: the title→lobby→match join/ready/countdown flow, and a
 * standard-mapping gamepad driving a player via an injected
 * navigator.getGamepads shim. Game rules are never re-tested here.
 */

async function waitForPhase(
  page: Page,
  phase: "title" | "lobby" | "match",
  timeout = 9000
): Promise<void> {
  await page.waitForFunction((p) => window.__testApi?.getPhase() === p, phase, { timeout });
}

test("lobby flow: two keyboards join, ready, countdown starts the match", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__testApi));
  await waitForPhase(page, "title");

  await page.keyboard.press("Space", { delay: 90 }); // title -> lobby
  await waitForPhase(page, "lobby");

  // Join both keyboards (P1 jump=KeyG, P2 jump=Period), then ready both.
  await page.keyboard.press("KeyG", { delay: 90 });
  await page.keyboard.press("Period", { delay: 90 });
  await page.keyboard.press("KeyG", { delay: 90 });
  await page.keyboard.press("Period", { delay: 90 });

  await waitForPhase(page, "match"); // the lobby countdown elapses
  await page.waitForFunction(() =>
    window.__testApi?.getEvents?.().some((e) => e.type === "round_started")
  );
  const players = await page.evaluate(() => window.__testApi!.getState!().players.length);
  expect(players).toBe(2);
  expect(errors).toEqual([]);
});

test("gamepad: a standard-mapping pad joins and drives its player", async ({ page }) => {
  // Inject one connected standard-mapping pad at index 0 before the app boots,
  // so the DeviceManager picks it up at construction.
  await page.addInitScript(() => {
    const pad: ShimGamepad = {
      index: 0,
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
    };
    window.__shimPad = pad;
    navigator.getGamepads = (() => [pad]) as unknown as Navigator["getGamepads"];
  });

  const tapPad = async (btn: number): Promise<void> => {
    await page.evaluate((b) => (window.__shimPad!.buttons[b]!.pressed = true), btn);
    await page.waitForTimeout(90);
    await page.evaluate((b) => (window.__shimPad!.buttons[b]!.pressed = false), btn);
    await page.waitForTimeout(150);
  };

  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__testApi));
  await waitForPhase(page, "title");
  await page.keyboard.press("Space", { delay: 90 });
  await waitForPhase(page, "lobby");

  // Keyboard P1 joins (slot 0); the pad joins (slot 1) via button 0 (A). Then
  // ready both.
  await page.keyboard.press("KeyG", { delay: 90 });
  await tapPad(0);
  await page.keyboard.press("KeyG", { delay: 90 });
  await tapPad(0);

  await waitForPhase(page, "match");

  // Drive the pad right (axis 0 past the deadzone) and assert its player — the
  // second roster slot — gains rightward velocity.
  await page.evaluate(() => (window.__shimPad!.axes[0] = 1));
  await page.waitForFunction(() => {
    const p = window.__testApi?.getState?.().players;
    return Boolean(p && p.length === 2 && p[1]!.vx > 0);
  });
  await page.evaluate(() => (window.__shimPad!.axes[0] = 0));
});
