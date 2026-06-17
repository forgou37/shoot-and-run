<!-- See CONTRIBUTING.md for the full process and Definition of Done. -->

## What & why

<!-- One paragraph: what this changes and the reason. Link the spec if there is one. -->

Closes #

## Evidence

<!-- Test/preview proof. Screenshot for visual changes; golden-log status for sim changes;
     CI is attached automatically. Delete lines that don't apply. -->

- Local gate: `typecheck` / `lint` / `check:deps` / `test` / `build` →
- `e2e` (if shell changed) →
- Determinism / golden log →
- Preview / screenshot →

## Definition of Done

- [ ] Acceptance criteria met
- [ ] Tests added/updated (sim tests headless)
- [ ] Local gate green (typecheck, lint, check:deps, test, build)
- [ ] `e2e` green if `packages/game` changed
- [ ] Golden log byte-identical, or regenerated with a logged reason (hard rule 4)
- [ ] Sim purity held — no Phaser/DOM/ambient-time in sim/bots/net (hard rule 2)
- [ ] No hardcoded tunables — values in `content/tuning.json` (hard rule 3)
- [ ] `/code-review` + `/security-review` run, findings addressed
- [ ] docs/DECISIONS.md appended + CLAUDE.md updated (Commands / Conventions) if a non-trivial choice was made
