# Backlog

Everything that is not in the current spec lives here. New ideas land here first (hard rule 1), then get promoted into a numbered spec when their time comes. Items are grouped; within a group, order is rough priority. Nothing here is committed until it appears in a spec the owner approved.

## Proposed spec roadmap

| Spec | Theme | Gate |
|---|---|---|
| 000 | Baseline first playable (current) | — |
| 001 | Game feel & match structure: juice, best-of-N, scores; shell e2e smoke suite | 000 done and fun in 2P |
| 002 | Full roster: gamepads, 3–4 players, modes, menus/lobby | 001 done |
| — | Pixel-art pass (owner does art; can overlap 003+) | 000–002 done (hard rule 6) |
| 003 | Scripted bots + headless eval harness | game is fun by hand |
| 004 | AI arena-generation pipeline: generator + metrics + judge loop | 003 done |

---

## Combat & arrows

- Arrow variants (original designs, original names — e.g. explosive, piercing/drill, splitting, bouncing). Each variant is data-described where possible (speed/gravity/behavior flags in content, behavior code in sim).
- Arrow catching: grab an arrow mid-flight with precise timing.
- Dodge/roll with brief invulnerability.
- Shield pickup that absorbs one hit.
- Arrow-vs-arrow collision (deflection).
- Treasure chests that spawn pickups mid-round (uses sim PRNG — determinism preserved).

## Power-ups

- Wings (extended air control / glide), speed boost, oversized arrows, brief invisibility, mirror/decoy. All original takes, all parameters in content files.

## Game feel / juice (spec 001 candidates)

- Hitstop on kills (a few frames of sim-presented freeze — implement in shell as render/step pause so sim stays pure).
- Screen shake (shell-only, driven by events).
- Particles: arrow impact dust, jump/land dust, kill burst (shell-only, event-driven).
- Corpses with physics tumble (decide: sim entities for determinism, or shell-only cosmetic — log the decision).
- Slow-mo on round-winning kill (shell timestep manipulation; sim unaware).
- Death cam nudge / kill flash.

## Match structure (spec 001 candidates)

- Best-of-N match flow, round score HUD, match victory screen.
- Round timer with sudden-death variant (e.g. shrinking safe area or auto-spawning hazard) to enforce the 10–60 s round envelope.
- Draw handling polish (replay the round, or both gain nothing).

## Input & roster (spec 002 candidates)

- Gamepad API support: hot-plug detection, up to 4 controllers, deadzone handling in shell.
- Slot↔device assignment UI ("press a button to join" lobby).
- 3–4 player support end-to-end (spawns, colors from `content/players.json`, HUD scaling).
- Key/button rebinding, persisted locally.

## Game modes (spec 002 candidates)

- Free-for-all (baseline), 2v2 teams with friendly fire toggle, headhunter/score-by-kills variant, target-practice solo mode (doubles as input/feel test bed).

## Menus & UX (spec 002 candidates)

- Title screen, lobby/character-select, arena select (reads whatever is in `content/arenas/`), pause menu, settings (volume, screen scale).

## Audio

- SFX for fire/stick/pickup/jump/kill/round-end; event-driven from SimEvents (shell-only). Music later. No audio before 001 at the earliest.

## Testing / e2e (spec 001 candidates)

Game-rule e2e is already covered headless: bot-driven full rounds in `packages/sim` (spec 000, T0.9). Browser e2e covers only the shell glue and never re-tests game rules — re-testing rules in a browser duplicates the sim suite in a slower, flakier place.

- Playwright shell smoke suite (~4 tests against the real Vite build):
  - Boot: page loads, canvas exists, `round_started` appears in the event log, zero console errors.
  - Content loading: arena-001 tiles/spawns visible in sim state (proves JSON flows through Vite into the sim).
  - Input mapping with real key events: `page.keyboard.down(...)` per player's actual bindings → input struct → movement; includes both players pressing simultaneously.
  - Stability: ~10 wall-clock seconds under rAF, no errors, tick count ≈ 600 (validates the accumulator).
- `window.__testApi` hook (dev/test builds only): read access to sim state + event log, plus `stepTicks(n, inputs)` bypassing the wall-clock accumulator so browser runs can be deterministic.
- Playwright in CI (headless Chromium), kept small and fast.
- Gamepad e2e (spec 002): Playwright cannot synthesize gamepad input — inject a `navigator.getGamepads` shim in test mode.

## Engineering / infrastructure

- Replay system: record `{ arenaId, tuning snapshot, seed, per-tick inputs }` → playback through the sim. Nearly free thanks to determinism; also the foundation for bug repros and the eval pipeline's "watch this round" feature.
- CI quality gate (GitHub Actions, lands with T0.1 in spec 000): `npm ci` → typecheck → lint → `check:deps` → Vitest → build, on every push. Trunk-based on `main`; `main` must stay green — a red gate blocks the next task. Staged additions: validation of all `content/**/*.json` (with T0.3), Playwright shell smoke (spec 001), sim step-time benchmark vs an explicit budget (before spec 003 — protects the eval pipeline that runs thousands of rounds). Bonus: Linux CI re-verifying the golden determinism log from the Windows dev machine is the cross-OS float-determinism check.
- CD, static-only (no servers ever): continuous deploy of green `main` builds to GitHub Pages or Cloudflare Pages (spec 001 candidate — always-playable playtest URL); tagged releases to itch.io via `butler` (later, once the game is fun).
- Crash-safe tuning hot-reload (validate before applying).
- In-game debug overlay: hitboxes, sim tick, event ticker, input viewer.

## Scripted bots (spec 003)

Prerequisite for the AI pipeline; also useful for solo playtesting.

- Bot policy interface: `(state, slot, rng) → PlayerInput`, pure and deterministic given the sim's PRNG stream. Lives in `packages/pipeline` (or `packages/bots`) — NOT in sim; sim only consumes inputs.
- Behaviors in increasing order: patrol/random-walk, arrow-seeker (path to nearest pickup), hunter (chase + line-of-sight shot), survivor (evade + opportunistic stomp). No pathfinding gold-plating — single-screen arenas allow simple heuristics.
- Difficulty knobs (reaction delay ticks, aim error via PRNG) as data.
- Headless runner CLI: `run-rounds --arena X --bots A,B --rounds N --seed S` → JSONL event logs + summary stats. This is the eval harness substrate.

## AI arena-generation pipeline (spec 004) — see "Future direction" in the project brief

Offline pipeline, target only after the game is fun to play by hand. Architecture is already shaped for it: arenas are data files validated by sim code, and the sim exposes `createSim(arena, tuning, players, seed) / step / events / state`.

1. **Generator.** LLM agent emits candidate arenas as structured JSON conforming to the arena schema (tile grid + spawns). Schema validation (already in `packages/sim`) rejects malformed output before any simulation is spent; structural pre-checks (connectivity given wrapping, spawn fairness by symmetry, open-space ratio) filter cheap failures.
2. **Headless evals.** For each candidate: N rounds (varied seeds, varied bot pairings from spec 003) via the headless runner. Output: per-round event logs.
3. **Balance metrics** (computed from event logs — this is why every meaningful occurrence must be a SimEvent):
   - Kill distribution per spawn point (spawn fairness)
   - Round length distribution vs the 10–60 s envelope
   - Draw rate
   - Map-area usage (position-heatmap coverage; sim may need a periodic `heartbeat` position event or state sampling hook)
   - Arrow economy: pickup latency, time-at-zero-arrows
4. **LLM-as-judge.** Rubric-scored layout interestingness (flow, verticality, risk/reward of arrow placement zones, wrap exploitation) over the arena JSON + rendered ASCII preview + metric summary.
5. **Iterate.** Generator ← judge/metrics feedback loop (mutate or regenerate); candidates that pass thresholds land in `content/arenas/` for human play-approval. They arrive as ordinary commits, so generated content passes the exact same CI gate (schema validation + full test suite) as hand-written content. The pipeline itself is not CD — it runs offline, manually triggered (local script or `workflow_dispatch`).

Open items to resolve when speccing 004: candidate budget per iteration, metric thresholds, whether the judge sees gameplay traces or only layout + stats, and bot-skill sensitivity of metrics.

## Explicitly never

- Online multiplayer / netcode (unless the owner explicitly reverses this).
- Copying TowerFall names, assets, or text.
