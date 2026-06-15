/** Enforces CLAUDE.md hard rule 2: packages/sim imports nothing outside itself —
 *  no Phaser, no DOM shims, no node builtins, no npm packages. Spec 004 adds the
 *  same guard for packages/bots and spec 008 for packages/net; both may import
 *  the sim but nothing else. The sim-purity rule also forbids sim -> net. */
module.exports = {
  forbidden: [
    {
      name: "sim-purity",
      comment:
        "packages/sim/src must stay engine-free and dependency-free (CLAUDE.md hard rule 2)",
      severity: "error",
      from: { path: "^packages/sim/src" },
      to: { pathNot: "^packages/sim/src" }
    },
    {
      name: "bots-purity",
      comment:
        "packages/bots/src must stay headless: only @shoot-and-run/sim is allowed — " +
        "no Phaser, no DOM, no packages/game (spec 004; mirrors hard rule 2)",
      severity: "error",
      from: { path: "^packages/bots/src" },
      to: { pathNot: ["^packages/bots/src", "^packages/sim/src"] }
    },
    {
      name: "net-purity",
      comment:
        "packages/net/src must stay headless: only @shoot-and-run/sim is allowed — " +
        "no Phaser, no DOM, no packages/game (spec 008; mirrors hard rule 2)",
      severity: "error",
      from: { path: "^packages/net/src" },
      to: { pathNot: ["^packages/net/src", "^packages/sim/src"] }
    }
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    // Analyze type-only imports too: the purity boundaries forbid ANY coupling,
    // and the sim<->net seam is exchanged purely as types, so type-only edges
    // must be visible to the cruiser (else net-purity would be unenforced).
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "default"]
    }
  }
};
