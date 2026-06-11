import { defineConfig } from "@playwright/test";

/** Shell e2e smoke suite (spec 001 T1.5). Runs against the Vite DEV server —
 *  window.__testApi is dev-only. Never re-tests game rules (sim owns those). */
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5173"
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});
