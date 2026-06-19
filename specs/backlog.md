# Backlog

Everything that is not in the current spec lives here. New ideas land here first (hard rule 1), then get promoted into a numbered spec when their time comes. Items are grouped; within a group, order is rough priority. Nothing here is committed until it appears in a spec the owner approved.

## Proposed spec roadmap

| Spec | Theme | Gate |
|---|---|---|
| 000 | Baseline first playable — **done** | — |
| 001 | Game feel & match structure: juice, best-of-N, scores; shell e2e smoke suite — **done** (specs/001-feel-and-match.md) | 000 done and fun in 2P |
| 002 | Treasure chests, special arrows (bomb/laser/bounce), power-ups (invisibility/flight) — **done** (specs/002-chests-and-powers.md; re-scoped 2026-06-12, gamepads moved out) | 001 done |
| 003 | Full roster: gamepads, 3–4 players, teams/FF, title/lobby/pause — **done** (specs/003-roster.md) | 002 done ✓ |
| 006 | Art pass I: sprite pipeline + player animation — **done** (specs/006-art-pass.md; Claude generates art via Aseprite MCP, owner art-directs) | 000–002 done ✓ (hard rule 6) |
| 007 | Art pass II: jungle environment (tileset, background, chest, arena-002 "canopy") + arrow sprites — **done** (specs/007-art-pass-2.md; owner-directed 2026-06-13) | 006 done ✓ |
| 004 | Real bots: heuristic AI archers playable from the lobby (FFA/teams, 3 difficulties) — **done** (specs/004-bots.md; couch-play core, headless eval runner pushed to 005) | game is fun by hand ✓ |
| 005 | AI pipeline: headless `run-rounds` eval runner → arena generator + metrics + judge loop | 004 done |
| 008 | Online multiplayer umbrella + netcode foundation (snapshot/restore, input serialization, determinism hardening) — **planning** (specs/008-netcode.md; owner reversed "online never" 2026-06-14) | 007 done ✓ |
| 009 | Netcode session layer (`packages/net`): clock sync, input delay, jitter buffer, prediction/rollback over loopback | 008 |
| 010 | Real WebSocket transport + local online play: browser + Node `ws` adapters on the `Transport` seam, a local dedicated Node host, an online Phaser scene — two browser tabs on `localhost` (no Cloudflare/signaling/room codes) — **done** (T10.0–T10.6, specs/008-netcode.md § Phase 010; owner re-scope 2026-06-15) | 009 |
| 011 | Self-hosted dedicated server (`packages/server` Node process on owner's VPS/local, reached over `wss://`) + clock/version hardening for real RTT + Title→Online join menu (single game, no room codes) — **first internet match, no Cloudflare** — **done** (T11.1–T11.4, specs/008-netcode.md § Phase 011) | 010 ✓ |
| 012 | Player-hosted / listen-server: WebRTC DataChannel P2P, NAT traversal + TURN, host-leaving policy + **host migration** (moved from 013 — only meaningful with a player-host) | 011 |
| 013 | Netplay polish (dedicated-server): spectators, reconnection, metrics, anti-cheat posture, lag-comp tuning — **done** (T13.1–T13.6, specs/013-netplay-polish.md; reordered ahead of 012 — these five ride the 011 dedicated host, host migration split out to 012) | 011 ✓ |
| 017 | Lobby character select: pick your card with arrows/gamepad, exclusive per character, host places bots — **done** (specs/017-character-select.md; shell-only) | 003 ✓ |
| 018 | Build-wall booster: a chest item grants a build charge; a dedicated button deploys a neutral solid 4×24 wall in front, dissolved when shot — **done** (specs/018-build-wall.md; first entity-vs-entity solid) | 002 ✓ |

---

## Combat & arrows (bomb/laser/bounce arrows + chests moved to spec 002)

- More arrow variants: splitting, drill (through any number of walls), oversized. Data-described where possible.
- Weighted/biased chest content tables; chest variety (big chests, cursed chests).
- Tile destruction by bomb arrows (needs mutable arena state in sim — design carefully vs determinism/replays).
- Arrow catching: grab an arrow mid-flight with precise timing.
- Dodge/roll with brief invulnerability.
- Shield pickup that absorbs one hit.
- Arrow-vs-arrow collision (deflection).
- Build-wall follow-ups (deferred from spec 018): placement validation (refuse to build inside terrain/another wall), a build cooldown, per-player/arena wall caps beyond one-charge-per-pickup; multi-hit walls (018: one arrow dissolves it) — a timed 30s despawn shipped 2026-06-19 (`wallLifetimeMs`, reuses `wall_destroyed`); bot wall-awareness (path around / use walls); weighted chest tables to bias the wall drop rate; bomb-blast line-of-sight occlusion by walls (018 keeps blasts a pure radius); deeper platforming on built walls (coyote/wall-jump/-slide off a built wall — basic stand-on works).

## Power-ups (invisibility + flight moved to spec 002)

- Speed boost, mirror/decoy, shield. All original takes, all parameters in content files.

## Game feel / juice (hitstop, shake, kill/stick particles moved to spec 001)

- Corpses with physics tumble (decide: sim entities for determinism, or shell-only cosmetic — log the decision).
- Slow-mo on round-winning kill — deferred from 001: in 2P every kill ends the round, so the end pause owns that moment; meaningful with 3–4 players or corpses.
- Death cam nudge / kill flash.
- Jump/land dust particles.
- Particle wrap at arena seams (001 accepts the cosmetic glitch).

## Match structure (best-of-N, scores, HUD moved to spec 001)

- Round timer with sudden-death variant (e.g. shrinking safe area or auto-spawning hazard) to enforce the 10–60 s round envelope — evaluate after 001 playtesting.
- Draw handling polish (replay the round, or both gain nothing).
- Match victory screen beyond the text overlay.

## Input & roster (spec 003 candidates — moved from 002 at owner direction)

- Gamepad API support: hot-plug detection, up to 4 controllers, deadzone handling in shell.
- Slot↔device assignment UI ("press a button to join" lobby).
- 3–4 player support end-to-end (spawns, colors from `content/players.json`, HUD scaling).
- Key/button rebinding, persisted locally.

## Game modes (spec 003 candidates)

- Free-for-all (baseline), 2v2 teams with friendly fire toggle, headhunter/score-by-kills variant, target-practice solo mode (doubles as input/feel test bed).

## Menus & UX (spec 003 candidates)

- Arena select (reads whatever is in `content/arenas/`), settings (volume, screen scale). (Title screen + pause menu shipped in spec 003; lobby character-select in spec 017.)

## Audio

- SFX for fire/stick/pickup/jump/kill/round-end; event-driven from SimEvents (shell-only). Music later. No audio before 001 at the earliest.

## Testing / e2e (Playwright suite + __testApi moved to spec 001)

Game-rule e2e stays headless in `packages/sim`; browser e2e covers only shell glue and never re-tests game rules.

- Gamepad e2e (spec 003): Playwright cannot synthesize gamepad input — inject a `navigator.getGamepads` shim in test mode.
- Visual regression screenshots — consider after the art pass, not before.

## Engineering / infrastructure

- Replay system: record `{ arenaId, tuning snapshot, seed, per-tick inputs }` → playback through the sim. Nearly free thanks to determinism; also the foundation for bug repros and the eval pipeline's "watch this round" feature.
- CI quality gate (GitHub Actions, lands with T0.1 in spec 000): `npm ci` → typecheck → lint → `check:deps` → Vitest → build, on every push. Trunk-based on `main`; `main` must stay green — a red gate blocks the next task. Staged additions: validation of all `content/**/*.json` (with T0.3), Playwright shell smoke (spec 001), sim step-time benchmark vs an explicit budget (before spec 003 — protects the eval pipeline that runs thousands of rounds). Bonus: Linux CI re-verifying the golden determinism log from the Windows dev machine is the cross-OS float-determinism check.
- CD, static-only (no servers ever): continuous deploy of green `main` builds — **blocked**: GitHub Pages needs a public repo or paid plan; Cloudflare Pages needs an account decision. Revisit when hosting is decided. Tagged releases to itch.io via `butler` later, once the game is fun.
- Crash-safe tuning hot-reload (validate before applying).
- In-game debug overlay: hitboxes, sim tick, event ticker, input viewer.

## Real bots (spec 004 — see specs/004-bots.md)

Prerequisite for the AI pipeline (spec 005); also useful for solo playtesting. Now spec'd as couch-play core (bots as `InputDevice`s over a pure policy in `packages/bots`). Remaining backlog items below were deferred from 004 to 005:

- Headless runner CLI: `run-rounds --arena X --bots A,B --rounds N --seed S` → JSONL event logs + summary stats. This is the eval harness substrate — **moved to spec 005** (its first task).
- More bot behaviors / a 4th difficulty tier / per-arena bot tuning — revisit after 004 playtesting.

## AI arena-generation pipeline (spec 005) — see "Future direction" in the project brief

Offline pipeline, target only after the game is fun to play by hand (prereq: bots from spec 004). Architecture is already shaped for it: arenas are data files validated by sim code, and the sim exposes `createSim(arena, tuning, players, seed) / step / events / state`.

1. **Generator.** LLM agent emits candidate arenas as structured JSON conforming to the arena schema (tile grid + spawns). Schema validation (already in `packages/sim`) rejects malformed output before any simulation is spent; structural pre-checks (connectivity given wrapping, spawn fairness by symmetry, open-space ratio) filter cheap failures.
2. **Headless evals.** For each candidate: N rounds (varied seeds, varied bot pairings from spec 004) via the headless runner. Output: per-round event logs.
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

- Copying TowerFall names, assets, or text.

> Online multiplayer / netcode was here ("unless the owner explicitly reverses this"). **Reversed by the owner 2026-06-14** → now the spec 008–013 endeavor (host-authoritative rollback, dedicated-first, Cloudflare-native). See specs/008-netcode.md.
