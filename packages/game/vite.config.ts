import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // Project Pages serve under a subpath (/shoot-and-run/), so the production
  // build uses a relative base: every emitted URL then resolves under any
  // subpath (and under local `vite preview`). Dev/e2e keep "/" (command ===
  // "serve") so the Playwright suite (baseURL :5173/) is unaffected. Phaser's
  // own runtime load.* paths are already relative ("assets/…"), so base only
  // steers the bundle entry + JS-imported assets (the FreePixel font).
  base: command === "build" ? "./" : "/",
  build: {
    target: "es2022"
  },
  optimizeDeps: {
    // Pre-bundle at server start: the first e2e page load must not pay
    // the one-time Phaser optimization cost.
    include: ["phaser"]
  }
}));
