import { expect, test, type Page } from "@playwright/test";

/**
 * Online join-menu e2e (spec 011, T11.3). Covers the shell wiring of the new
 * Title → Online → join flow: navigating the title menu, the DOM host-URL field
 * appearing pre-filled, and Escape returning to the title. The actual connect +
 * two-tab convergence (through this same menu) is the online.spec.ts test; this
 * one needs no host, so it can't consume the single-session dev host's slots.
 */

async function waitForPhase(page: Page, phase: "title" | "lobby" | "match", timeout = 9000): Promise<void> {
  await page.waitForFunction((p) => window.__testApi?.getPhase() === p, phase, { timeout });
}

test("title menu opens the online join screen, then Escape returns", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__testApi));
  await waitForPhase(page, "title");

  // Title → select ONLINE (second item) → confirm.
  await page.keyboard.press("ArrowDown", { delay: 90 });
  await page.keyboard.press("Enter", { delay: 90 });

  // The DOM host-URL field appears, pre-filled with a ws(s):// default.
  const url = page.getByTestId("online-host-url");
  await expect(url).toBeVisible();
  await expect(url).toHaveValue(/^wss?:\/\/.+/);

  // Escape returns to the title and removes the field.
  await url.press("Escape");
  await waitForPhase(page, "title");
  await expect(page.getByTestId("online-host-url")).toHaveCount(0);

  expect(errors).toEqual([]);
});
