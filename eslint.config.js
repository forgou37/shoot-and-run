import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }
      ]
    }
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "writable", require: "readonly" }
    }
  },
  {
    // Repo tooling scripts run under Node (e.g. scripts/export-art.mjs).
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" }
    }
  },
  {
    // Hard rules 2 and 4 (CLAUDE.md): sim is engine-free and deterministic.
    // The missing DOM lib in packages/sim/tsconfig.json is the primary guard;
    // these rules catch the cases tsc lets through.
    files: ["packages/sim/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-globals": [
        "error",
        { name: "window", message: "Sim is headless (hard rule 2)." },
        { name: "document", message: "Sim is headless (hard rule 2)." },
        { name: "navigator", message: "Sim is headless (hard rule 2)." },
        { name: "performance", message: "Sim has no wall-clock (hard rule 4)." },
        { name: "requestAnimationFrame", message: "Sim is tick-driven (hard rule 2)." },
        { name: "setTimeout", message: "Sim is tick-driven (hard rule 4)." },
        { name: "setInterval", message: "Sim is tick-driven (hard rule 4)." }
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded PRNG in rng.ts (hard rule 4)." },
        { object: "Date", property: "now", message: "Sim has no wall-clock (hard rule 4)." }
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message: "Sim has no wall-clock (hard rule 4)."
        }
      ]
    }
  }
);
