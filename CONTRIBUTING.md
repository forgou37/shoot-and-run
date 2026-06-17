# Development process

How work moves from idea to `main` in this repo. The goal is a small, **production-like** loop — every change passes a gate and is reviewed by someone other than the agent that wrote it — without enterprise ceremony that a solo + AI team doesn't need.

This complements [CLAUDE.md](CLAUDE.md): CLAUDE.md is the *what* (architecture, hard rules, decisions); this is the *how* (the workflow around a change). The hard rules in CLAUDE.md are not restated here — the Definition of Done references them by number.

## Roles

| Role | Who | Owns |
|---|---|---|
| **Product / final review** | Owner (Igor) | What we build and why; approves specs; reviews the PR diff; merges. |
| **Engineering** | Claude | Implements the spec; keeps the gate green; opens the PR with evidence. |
| **First-pass review + QA** | Claude | Runs `/code-review` + `/security-review` and the full local gate *before* asking for review; finds its own bugs first. |

The point of the split: the agent that writes the change is no longer the only thing that blesses it. The owner reviews a diff with evidence attached, not just a running build.

## The loop

1. **Intake → Issue.** A prompt becomes a tracked GitHub Issue (use the *Task* template): problem statement, acceptance criteria, linked spec, Definition-of-Done checklist. Tracked work, not an ephemeral chat message.
2. **Design → approved spec.** Non-trivial work gets a spec in `specs/` (hard rule 1) or a plan the owner approves before code. "Approved" is an explicit state.
3. **Branch.** One branch per task off `main` (worktrees encouraged). Direct commits to `main` are reserved for docs/config/art tweaks that don't touch the sim, game, or content rules.
4. **Build.** One task per commit (hard rule 5), conventional-commit prefix + task id (`feat: T4.7 ...`).
5. **Self-verify.** Local gate green (`typecheck` → `lint` → `check:deps` → `test` → `build`, plus `e2e` if the shell changed) **and** `/code-review` + `/security-review` run with findings addressed.
6. **Open PR.** Use the PR template. CI runs against the PR; attach test/preview evidence (screenshot for visual changes, golden-log status for sim changes).
7. **Review → merge.** Owner reviews the diff. **Squash-merge** so `main` keeps exactly one commit per task (hard rule 5). The PR closes its issue (`Closes #N`).
8. **`main` stays green.** A red gate blocks the next task. CI (`gate` + `e2e`) runs on every PR; a red PR is not merged. (See *Enforcement* below — this is convention, not yet server-blocked.)
9. **Record.** Log any non-trivial choice in [docs/DECISIONS.md](docs/DECISIONS.md) *in the same PR*. Promote remaining ideas to `specs/backlog.md`, never into code.

### Enforcement

`main` is protected server-side by an **active repository ruleset** ("Protect main"):

- Required status checks: `gate` + `e2e`, strict (branch must be up to date with `main`).
- A pull request is **required** to merge; **0** approvals — GitHub forbids self-approval, so 0 lets the solo maintainer self-merge once checks pass.
- **Squash** is the only allowed merge method (one commit per task on `main`, hard rule 5).
- Force-push and branch deletion are blocked.
- The repo **admin bypasses** the ruleset (`always`) — the owner is never locked out for an emergency push.

So "don't merge a red PR / don't push straight to `main`" is a hard block, not just a convention. This became possible when the repo was made public (2026-06-15) — protection and rulesets are free on public repos. Going public also lifts the old "Pages unavailable on private Free" blocker on continuous deploy (now live — see Releases).

### When a full PR is overkill

PRs are for anything touching `packages/sim`, `packages/net`, `packages/bots`, `packages/game` rules, or `content/`. Pure docs, a tuning tweak, or an art-asset swap can go straight to `main` — judgment call, but if it could break the gate, branch it.

## Definition of Done

A change is done when **all** of these hold (this is the PR checklist):

- [ ] Acceptance criteria in the linked issue/spec are met.
- [ ] Tests added or updated; sim tests run headless in Node (no Phaser in their tree).
- [ ] Local gate green: `npm run typecheck && npm run lint && npm run check:deps && npm test && npm run build`.
- [ ] `npm run e2e` green if the shell (`packages/game`) changed.
- [ ] **Determinism:** the golden log is byte-identical, *or* it was regenerated with the justification logged in [docs/DECISIONS.md](docs/DECISIONS.md) (hard rule 4).
- [ ] **Sim purity** held — no Phaser/DOM/ambient-time in `packages/sim` / `packages/bots` / `packages/net` (hard rule 2; `check:deps` enforces).
- [ ] **Tuning is data** — no hardcoded tunable numbers; they live in `content/tuning.json` (hard rule 3).
- [ ] `/code-review` and `/security-review` run; findings fixed or consciously deferred to the backlog.
- [ ] [docs/DECISIONS.md](docs/DECISIONS.md) appended (if a non-trivial choice was made) and CLAUDE.md updated (Commands / Conventions / Project structure) in the same PR if anything non-trivial changed.
- [ ] PR description states what + why, links the issue, and includes test/preview evidence.

## Branching & commits

- Trunk-based on `main`; short-lived task branches.
- Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) carrying the task id — already the house style.
- Squash-merge keeps one commit per task on `main`.

## Releases

The client is static. **Continuous deploy to GitHub Pages is live** — [`deploy.yml`](.github/workflows/deploy.yml) publishes every green push to `main` at <https://forgou37.github.io/shoot-and-run/>. Tagged releases are a separate, occasional ritual on top of that:

1. Update `CHANGELOG.md` — move `Unreleased` items under the new version.
2. Tag `vMAJOR.MINOR.PATCH` on a green `main`.
3. `.github/workflows/release.yml` builds the client, zips `packages/game/dist`, and publishes a GitHub Release with auto-generated notes.

Deploy is continuous (above), not tied to tags; itch.io distribution via `butler` stays a later add-on once the game is fun.

Semantic versioning: **MAJOR** for breaking sim API / save-format changes, **MINOR** for a shipped spec / feature, **PATCH** for fixes and content.
