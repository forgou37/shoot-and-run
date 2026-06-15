import { expect, test, type Page } from "@playwright/test";

/**
 * Online e2e (spec 010 T10.6 / W7; spec 011 T11.4 / S7). Two browser tabs connect
 * to the local dedicated host (the dev:host webServer = packages/server) over a
 * real WebSocket and play one match. We assert the win: both reach the match, the
 * session advances with inputs flowing, and — the convergence invariant — each
 * tab's CONFIRMED state is byte-identical to the other's at a shared confirmed
 * tick. Game rules are never re-tested here (the sim owns those).
 *
 * Tab A joins THROUGH the Online menu (Title → Online → type host → connect),
 * exercising the 011 join flow; tab B uses the ?online= deep-link, proving it
 * still works. The dev host is single-session (monotonic connection counter), so
 * only this one connecting test may consume its slots — the menu-UI test
 * (online-menu.spec.ts) deliberately backs out without connecting.
 */

const HOST_WS = "ws://localhost:8787";
const DEEPLINK_URL = `/?online=${HOST_WS}`;

async function waitForPhase(page: Page, timeout = 20_000): Promise<void> {
  await page.waitForFunction(() => window.__testApi?.getPhase() === "match", null, { timeout });
}
async function confirmedTick(page: Page): Promise<number> {
  return page.evaluate(() => window.__testApi?.getNetProbe?.().confirmedTick ?? 0);
}

/** Drive the Title → Online → join-and-connect flow with the keyboard. */
async function joinViaMenu(page: Page, url: string): Promise<void> {
  await page.waitForFunction(() => window.__testApi?.getPhase() === "title", null, { timeout: 9000 });
  await page.keyboard.press("ArrowDown", { delay: 90 }); // select ONLINE
  await page.keyboard.press("Enter", { delay: 90 }); // open the join screen
  const field = page.getByTestId("online-host-url");
  await field.waitFor({ state: "visible", timeout: 9000 });
  await field.fill(url);
  await field.press("Enter"); // connect
}

test("two tabs play a real match over WebSocket and converge byte-for-byte", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const errors: string[] = [];
  for (const [pg, label] of [
    [pageA, "A"],
    [pageB, "B"]
  ] as const) {
    pg.on("pageerror", (e) => errors.push(`${label}: ${String(e)}`));
    pg.on("console", (m) => {
      if (m.type() === "error") errors.push(`${label}: ${m.text()}`);
    });
  }

  // Tab A goes through the Online menu; tab B uses the ?online= deep-link. The
  // host starts once both have connected (wait-for-all).
  await Promise.all([pageA.goto("/"), pageB.goto(DEEPLINK_URL)]);
  await Promise.all([
    pageA.waitForFunction(() => Boolean(window.__testApi)),
    pageB.waitForFunction(() => Boolean(window.__testApi))
  ]);
  await joinViaMenu(pageA, HOST_WS);
  await Promise.all([waitForPhase(pageA), waitForPhase(pageB)]);

  // Drive input from both tabs (each controls its own slot) so inputs flow both
  // ways and the authoritative stream is non-trivial.
  await pageA.keyboard.down("KeyD"); // local player runs right
  await pageB.keyboard.down("KeyA"); // local player runs left

  // Both sessions advance well past the start: the host is stepping and each
  // client's confirmed stream is keeping up.
  await pageA.waitForFunction(() => (window.__testApi?.getNetProbe?.().confirmedTick ?? 0) > 90, null, {
    timeout: 20_000
  });
  await pageB.waitForFunction(() => (window.__testApi?.getNetProbe?.().confirmedTick ?? 0) > 90, null, {
    timeout: 20_000
  });
  await pageA.keyboard.up("KeyD");
  await pageB.keyboard.up("KeyA");

  // Convergence: pick a tick both tabs have confirmed and recorded, then compare
  // their confirmed-state hashes. Byte-identical determinism ⇒ equal hashes.
  const target = Math.min(await confirmedTick(pageA), await confirmedTick(pageB)) - 30;
  expect(target).toBeGreaterThan(0);
  const hashA = await pageA.evaluate((t) => window.__testApi!.getConfirmedHashAt!(t), target);
  const hashB = await pageB.evaluate((t) => window.__testApi!.getConfirmedHashAt!(t), target);
  expect(hashA).not.toBeNull();
  expect(hashA).toBe(hashB);

  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
