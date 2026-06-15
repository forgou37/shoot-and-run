import { defineConfig } from "@playwright/test";

/** Shell e2e smoke suite (spec 001 T1.5). Runs against the Vite DEV server —
 *  window.__testApi is dev-only. Never re-tests game rules (sim owns those). */
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5173",
    // Force stable software WebGL (SwiftShader). Headless Chromium's GPU-backed
    // WebGL context can drop and only lazily restore, which stalls Phaser's
    // first boot into an idle (loader-less) scene like the title screen.
    launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader"] }
  },
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    },
    {
      // Dedicated host for the spec-010 online e2e (two tabs on localhost). It's
      // a ws server, so readiness is a TCP port check (it doesn't answer HTTP).
      command: "npm run dev:host",
      port: 8787,
      env: { PORT: "8787", PLAYERS: "2", SEED: "1" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    }
  ]
});
