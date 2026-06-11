import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022"
  },
  optimizeDeps: {
    // Pre-bundle at server start: the first e2e page load must not pay
    // the one-time Phaser optimization cost.
    include: ["phaser"]
  }
});
