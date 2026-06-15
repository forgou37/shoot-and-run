import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // All package suites (sim/bots/net/server) run headless in Node. The server's
    // ws-adapter test (spec 010, graduated to packages/server in 011) is included
    // by the packages glob.
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node"
  }
});
