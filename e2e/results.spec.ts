import { expect, test } from "@playwright/test";

/**
 * Post-match results e2e (spec 016). Boots a bots-heavy FFA match, fast-forwards
 * it to match_ended via the manual-step test hook (no real-time wait), and
 * asserts the shell transitions to the awards screen. Also confirms the new
 * movement events (player_jumped) reach the event log the awards fold over.
 */
test("a finished match shows the post-match awards screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  // All-bot 4-player FFA (?bots=4 = 0 humans): the bots fight to a real winner,
  // so the match reaches match_ended (an idle human would stalemate the round).
  await page.goto("/?bots=4&difficulty=hard");
  await page.waitForFunction(() => window.__testApi?.getPhase() === "match", undefined, {
    timeout: 12000
  });

  // Fast-forward deterministically: step in chunks until the match has a winner,
  // capturing that the new movement events and match_ended landed in the log.
  const outcome = await page.evaluate(() => {
    const api = window.__testApi!;
    api.setManual!(true);
    for (let i = 0; i < 120; i++) {
      api.stepTicks!(100);
      const st = api.getState?.();
      if (st && st.match.winner !== null) {
        const ev = api.getEvents!();
        return {
          ended: true,
          hadMatchEnded: ev.some((e) => e.type === "match_ended"),
          hadJump: ev.some((e) => e.type === "player_jumped")
        };
      }
    }
    return { ended: false, hadMatchEnded: false, hadJump: false };
  });

  expect(outcome.ended).toBe(true);
  expect(outcome.hadMatchEnded).toBe(true);
  expect(outcome.hadJump).toBe(true);

  // The match-end hand-off (fade) lands on the results scene.
  await page.waitForFunction(() => window.__testApi?.getPhase() === "results", undefined, {
    timeout: 5000
  });

  expect(errors).toEqual([]);
});
