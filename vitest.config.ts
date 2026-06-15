import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Package suites + the dev host's ws-adapter test (spec 010). All run in Node.
    include: ["packages/*/test/**/*.test.ts", "scripts/dev-host/**/*.test.ts"],
    environment: "node"
  }
});
