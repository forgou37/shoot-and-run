/** Enforces CLAUDE.md hard rule 2: packages/sim imports nothing outside itself —
 *  no Phaser, no DOM shims, no node builtins, no npm packages. */
module.exports = {
  forbidden: [
    {
      name: "sim-purity",
      comment:
        "packages/sim/src must stay engine-free and dependency-free (CLAUDE.md hard rule 2)",
      severity: "error",
      from: { path: "^packages/sim/src" },
      to: { pathNot: "^packages/sim/src" }
    }
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "default"]
    }
  }
};
