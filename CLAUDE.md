# CLAUDE.md

Living document for this project: architecture, hard rules, conventions, commands, and the Decisions Log. Keep it current — when a non-trivial choice is made, log it. When a command or convention changes, update it here in the same commit.

## What this is

A TowerFall Ascension–**inspired** local-multiplayer arena game. An homage, not a clone: all names, art, and content must be original.

- 2–4 players on one screen, archer-vs-archer combat
- Each player starts with 3 arrows; fired arrows stick in the world and must be picked up; out of arrows → kill by stomping enemies from above
- Screen wraps at all edges (horizontal and vertical)
- One-hit kills, rounds last 10–60 seconds, best-of-N match structure
- Tight platforming: variable jump height, coyote time, jump buffering, air control
- Small single-screen arenas, pixel art later, juice (hitstop/shake/particles) later
- Local multiplayer only. Online netcode is permanently out of scope unless explicitly added by the owner.

Long-term direction (specs 004–005, **not now**): an offline AI pipeline generates arena layouts as JSON, a headless simulator plays them with scripted bots, balance metrics + LLM-as-judge score them, winners land in `content/arenas/`. The architecture below exists so this is possible without a rewrite.

## Architecture

Monorepo (npm workspaces) with one hard boundary:

```
packages/sim    pure TypeScript game simulation — ZERO Phaser/DOM/canvas imports
packages/game   Phaser 3 shell — rendering, input devices, (later) audio/menus
content/        all game data as JSON — arenas, tuning, player configs
```

`packages/sim` owns **all** game rules: movement, physics, arrows, kills, round state. It is deterministic and runs headless in Node. `packages/game` is a thin shell: it translates keyboard/gamepad into plain input structs, calls `sim.step()` on a fixed timestep, and renders the resulting state with interpolation. No game logic in render callbacks, ever.

### Sim API contract (sketch — see specs/000-baseline.md)

```ts
const sim = createSim({ arena, tuning, players, seed });
const events = sim.step(inputs);   // advances exactly one 60 Hz tick, returns SimEvent[]
sim.state;                         // readonly snapshot for rendering / stats
```

The sim communicates outward **only** via returned events and readable state — no callbacks, no globals. This is the API the future AI pipeline consumes (init with arena + seed, step, read events/stats).

### Timing model

60 Hz fixed-timestep simulation driven by an accumulator in the shell. The shell may render at any refresh rate and interpolates entity positions between the previous and current sim tick. The sim itself has no concept of wall-clock time — only ticks.

## Hard rules

1. **Spec discipline.** Implement only what the current spec says. New ideas go to `specs/backlog.md`, not into the code.
2. **Sim purity.** `packages/sim` never imports Phaser, DOM, or canvas APIs — no `window`, `document`, `performance`, `requestAnimationFrame`. Enforced by a dependency-cruiser check (`npm run check:deps`) that runs in CI and must pass before merge.
3. **Tuning is data.** All game-feel tuning values (gravity, jump velocity, coyote time ms, jump buffer ms, arrow speed, …) live in ONE file: `content/tuning.json`. Hot-reloadable in dev. A hardcoded tunable number in source is a bug by definition.
4. **Deterministic sim.** Seeded RNG only inside `packages/sim`. No `Date.now()`, `Math.random()`, `performance.now()`, or any other ambient nondeterminism. Same arena + tuning + seed + input sequence ⇒ identical event log, always.
5. **One task per commit**, message prefixed with the task id (e.g. `T0.4: player movement with coyote time and jump buffer`).
6. **Placeholder visuals** (colored rects) until specs 000–002 are done. No art tasks before that. Pixel art is done by the owner, later.

## Conventions

- TypeScript strict mode everywhere. No `any` in `packages/sim`.
- Units: pixels. Tile size 16 px. Arena logical size 320×240 (20×15 tiles). Positions are floats in pixel units; the renderer may scale up integer-multiple.
- Durations in `content/tuning.json` are in milliseconds (designer-friendly); the sim converts to ticks at init (60 Hz ⇒ 1 tick ≈ 16.67 ms).
- Sim entity collections use plain arrays with stable insertion order; entity ids are assigned by a deterministic counter, never randomly.
- All content files are validated on load (schema validation lives in `packages/sim` so the headless pipeline gets it for free).
- Original naming only — no TowerFall terms, names, or assets anywhere in code or content.
- Tests: Vitest. Sim tests run headless in Node with no Phaser installed in their dependency tree.

## Content-as-data

Everything a designer (or a future LLM generator) might touch is a data file, never code:

| File | Contents |
|---|---|
| `content/arenas/*.json` | One arena per file: tile grid, spawn points, metadata. Conforms to the arena schema in `packages/sim`. |
| `content/tuning.json` | Every game-feel number. The only place tunables exist. Shell-only blocks `juice`, `input` (stickDeadzone), `ui` (lobbyCountdownMs) live here too — the sim ignores them. |
| `content/players.json` | `{ slots: [{slot,name,color} ×4], keyboards: [KeyBindings ×2] }` — slot identities plus the two keyboard binding profiles. Devices bind to slots in the lobby, not here. |

Hot-reload: the Phaser shell watches `content/tuning.json` via Vite HMR in dev and pushes the new tuning object into the running sim. Note: hot-reloading mid-round breaks determinism for that run — fine in dev; replays/tests always pin the tuning snapshot at init.

## Project structure

```
arcade-game/
├─ CLAUDE.md
├─ package.json               # npm workspaces root: packages/*
├─ tsconfig.base.json
├─ .dependency-cruiser.cjs    # enforces sim purity (hard rule 2)
├─ specs/
│  ├─ 000-baseline.md
│  └─ backlog.md
├─ assets/                    # Aseprite sprite sources (art pass, spec 006); fonts/ (FreePixel.ttf, the shell's pixel font)
├─ scripts/
│  └─ export-art.mjs          # assets/*.aseprite → packages/game/public/assets/
├─ content/
│  ├─ arenas/arena-001.json   # "crossfire" — sim-test + golden-log fixture
│  ├─ arenas/arena-002.json   # "canopy" — jungle arena the shell boots into
│  ├─ tuning.json
│  └─ players.json
├─ packages/
│  ├─ sim/
│  │  ├─ src/
│  │  │  ├─ index.ts          # public API: createSim, types
│  │  │  ├─ rng.ts            # seeded PRNG (mulberry32)
│  │  │  ├─ arena.ts          # arena types + schema validation
│  │  │  ├─ physics.ts        # wrap-aware AABB vs tile grid
│  │  │  ├─ player.ts         # movement, jump, stomp, power-up timers
│  │  │  ├─ arrow.ts          # flight per kind, sticking, pickup
│  │  │  ├─ kills.ts          # arrow/stomp/bomb kills
│  │  │  ├─ chest.ts          # chest spawn/open (PRNG-driven)
│  │  │  ├─ round.ts          # round + match state machine
│  │  │  └─ events.ts         # SimEvent definitions
│  │  └─ test/
│  │     └─ determinism.test.ts
│  └─ game/
│     ├─ index.html
│     ├─ vite.config.ts
│     ├─ public/assets/       # committed sprite atlases (PNG + Aseprite JSON), via export:art
│     └─ src/
│        ├─ main.ts           # Phaser game: registers boot→title→lobby→arena scenes
│        ├─ loop.ts           # accumulator + interpolation driver
│        ├─ app-context.ts    # app-wide singletons (DeviceManager, keyboard) in the registry
│        ├─ match-config.ts   # roster (slot+device+team) the lobby hands to the match
│        ├─ theme.ts          # FONT_FAMILY + loadFont() (FreePixel.ttf, loaded before boot)
│        ├─ test-api.ts       # dev-only window.__testApi (getPhase + match probes)
│        ├─ scenes/           # BootScene, TitleScene, LobbyScene, ArenaScene (match + pause)
│        ├─ input/            # InputDevice (keyboard/gamepad), hot-plug manager, edge reader, players.json/tuning parsers
│        └─ render/           # sprite renderers (archer, arrows, jungle env); rect debug via ?rects=1
└─ packages/pipeline/         # FUTURE (specs 004–005): bots, evals, generator. Do not create yet.
```

## Commands

Keep this section current as scripts change.

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server for `packages/game` (tuning hot-reload from T0.5) |
| `npm run build` | Type-check both packages + production Vite build |
| `npm run typecheck` | `tsc --noEmit` over sim src (no Node/DOM types — purity), sim tests (Node types), and game |
| `npm test` | All Vitest suites (sim tests run headless in Node) |
| `npm run e2e` | Playwright suite (Chromium/SwiftShader, dev server, `window.__testApi`): shell smoke + lobby flow + gamepad shim |
| `npm run lint` | ESLint, incl. sim determinism guards (no `Math.random`/`Date.now`/timers in sim) |
| `npm run check:deps` | dependency-cruiser: fails if `packages/sim/src` imports anything outside itself |
| `npm run export:art` | Re-export all `assets/*.aseprite` → `packages/game/public/assets/` atlases (needs local Aseprite; exports are committed, CI never runs this) |

Notes: `packages/sim` has no build step — its package `exports` points at `src/index.ts` and Vite/Vitest consume the TS source directly. Sim's tsconfig has no DOM lib, so `window`/`document` fail to typecheck there (first line of defense for hard rule 2).

## CI/CD

One GitHub Actions workflow on every push (lands in T0.1): `npm ci` → typecheck (`tsc --noEmit`) → `lint` → `check:deps` → `npm test` → `vite build`. Trunk-based on `main`, one task per commit (hard rule 5); `main` must stay green — a red gate blocks the next task, not a merge. Staged additions: validation of all `content/**/*.json` (with T0.3), Playwright shell smoke (spec 001), sim step-time benchmark vs budget (before spec 003).

- Linux CI re-verifying the golden determinism log produced on the Windows dev machine doubles as the cross-OS float-determinism check backing Decision #3.
- CD is static-only — no server component will ever exist: continuous deploy of green `main` builds to GitHub Pages or Cloudflare Pages (from spec 001, an always-playable playtest URL); tagged releases to itch.io via `butler` (later, once the game is fun).
- Generated arenas (spec 004) arrive as commits and pass the exact same gate as hand-written content.

## Decisions Log

Format: `Date | Scope | Decision | Reasoning | Alternatives rejected`

| Date | Scope | Decision | Reasoning | Alternatives rejected |
|---|---|---|---|---|
| 2026-06-12 | engine | Phaser 3 + TS + Vite | developer's primary stack, fastest iteration | Godot 4 rejected: stack consistency and web-first distribution preferred |
| 2026-06-12 | architecture | Engine-agnostic sim core in packages/sim, Phaser as rendering shell | enables headless simulation for future AI arena-generation pipeline and deterministic replay/testing | logic-inside-Phaser-scenes rejected: couples game rules to renderer, blocks headless mode |
| 2026-06-12 | sim-core | 60 Hz fixed-timestep accumulator with interpolated rendering; custom wrap-aware AABB-vs-tile-grid collision implemented in packages/sim; mulberry32 seeded PRNG | determinism + headless execution require zero engine dependencies; single-screen 20×15 tile arenas make tile-grid AABB simple and fast; edge wrapping needs custom collision handling anyway (an entity can overlap two opposite edges simultaneously, which engine broadphases don't model) | Phaser Arcade Physics rejected: imports Phaser → violates headless rule, and its variable-delta integration is not run-to-run deterministic; fixed-point math rejected: float determinism within a single JS engine is sufficient — no cross-machine lockstep is ever needed (online play permanently out of scope) |
| 2026-06-12 | tooling | npm workspaces + Vitest + ESLint + dependency-cruiser | zero extra toolchain for a 2-package solo repo; Vitest shares Vite's transform pipeline and runs sim tests in plain Node | pnpm/turborepo rejected: overkill at this scale; Jest rejected: slower TS/ESM story than Vitest alongside Vite |
| 2026-06-12 | testing | Layered e2e: game-rule e2e runs headless in packages/sim (bot-driven full rounds, spec 000 T0.9); browser e2e is a small Playwright shell-smoke suite via a dev-only `window.__testApi` hook, deferred to spec 001 | rules live entirely in sim, so browser re-testing would duplicate the suite in a slower, flakier place; keeps 000 lean | Playwright-in-000 rejected: shell glue is small enough to risk for one spec; rule-level browser e2e rejected: duplicates sim suite |
| 2026-06-12 | ci-cd | GitHub Actions single quality gate on every push (typecheck, lint, check:deps, Vitest, build from T0.1; content validation from T0.3; Playwright from 001; perf benchmark before 003); trunk-based on main with a green-gate rule; CD = static deploys only (Pages continuous from 001, itch.io via butler on tags later) | local-only multiplayer compiles to static files, so deployment is publishing the Vite build; Linux CI re-running the golden determinism log verifies cross-OS float determinism; generated arenas merge as commits and pass the same gate as hand-written content | PR-based flow rejected: solo repo, ceremony without reviewers — green-main rule gives the same safety; other CI hosts rejected: Actions is zero-setup alongside the GitHub remote; containerized/server deploys rejected: no server component exists or ever will |
| 2026-06-12 | ci-cd | Continuous Pages deploy deferred (amends the row above) | repo is private on a free plan — GitHub Pages unavailable; Cloudflare Pages needs an account decision by the owner | deploying anyway rejected: would require making the repo public as a side effect of a tooling choice |
| 2026-06-12 | sim-events | player_killed carries the victim's position (x, y) | shell FX (kill burst placement) need it now; pipeline balance metrics need kill heatmaps later; events are the sim's only output channel, so position must be in the payload | shell reading victim position from state rejected: at the time the event is consumed the round may already have reset; golden log consciously regenerated once for the payload change |
| 2026-06-12 | roadmap | Spec 002 re-scoped to treasure chests + special arrows (bomb/laser/bounce) + power-ups (invisibility/flight); gamepads/roster/menus deferred to 003; bots → 004, AI pipeline → 005 | owner direction: content/combat variety before input breadth; chests are also the first consumer of the seeded PRNG, proving the determinism design under randomness | keeping 002 as roster rejected by owner |
| 2026-06-12 | art | Pixel art is generated in-session by Claude driving Aseprite (MCP), owner as art director; sources in `assets/*.aseprite`, committed exports (PNG + Aseprite-JSON atlas) in `packages/game/public/assets/` consumed by the shell; per-slot colors via runtime ramp recolor of one canonical 16×16 sheet (spec 006, proposed) | owner delegated generation after reviewing the archer (19 frames, 6 tags); committed exports keep CI/CD free of an Aseprite dependency; one sheet + recolor avoids 4× asset upkeep | owner hand-drawing deferred: iteration speed; per-slot pre-exported sheets rejected; sprite sizes other than 16×16 rejected — matches tile grid, overlays the 12×12 hitbox |
| 2026-06-13 | art/content | Spec 007 (owner-directed, skipped pre-spec review): shell boots the new jungle arena-002 "canopy"; arena-001 stays the sim-test/golden fixture; tile variants chosen at render time by a wrap-aware exposure mask (8 frames + 2 vines, vines placed by a deterministic position hash); arrows rotate by `atan2(vy, vx)`, stuck arrows hold the last flight angle tracked shell-side | complete level art + a denser layout without touching the sim (golden log pinned to arena-001 stays byte-identical); autotiling keeps arenas pure collision data and the tileset tiny | per-tile art indices in arena JSON rejected: arenas remain collision data the generator pipeline can emit; storing stick angles in sim state rejected: cosmetic-only concern, sim purity wins |
| 2026-06-13 | sim-modes | Teams mode is implied by every player carrying `team?: 0\|1`; `friendlyFire?: boolean` defaults true; FFA paths kept byte-identical (golden log untouched) by branching round-end logic and gating kills behind a `team!==null` check; in teams mode `round_ended`/`match_ended.winner` carry the team id, match victory reads `match.teamScores` while per-player `scores` still tallies survivals | one sim, two modes without forking the kill/round code; the null-team guard guarantees FFA can never be suppressed so the determinism proof stays valid | a separate teams sim rejected: duplicates rules; regenerating the golden log rejected: FFA behavior is unchanged so it must stay identical |
| 2026-06-13 | shell-input/scenes | Spec 003: uniform `InputDevice {id,kind,connected,sample(),pausePressed()}` (keyboard profiles + standard-mapping pads, hot-plug via a DeviceManager); one app-wide DeviceManager+KeyboardInput in the Phaser registry; scene flow boot→title→lobby→arena with `?quickstart=1` skipping to the 2-keyboard match; pause is a shell-only flag that stops the accumulator (sim untouched); lobby assembles a MatchConfig roster the match consumes | keeps the sim seeing only PlayerInput; the device abstraction lets the lobby map devices→slots and the match auto-pause on pad-disconnect; freezing the accumulator (not the sim) preserves determinism | Phaser keyboard/gamepad plugins rejected: thin testable layer preferred; pausing via a separate sim concept rejected: pause is cosmetic, belongs in the shell |
| 2026-06-13 | e2e | T3.5 forces software WebGL (`--use-gl=angle --use-angle=swiftshader`) for Playwright; cross-scene `__testApi.getPhase()` installed at boot, match-only probes augmented by ArenaScene; gamepad e2e drives a player via an injected `navigator.getGamepads` shim | headless Chromium's GPU WebGL context drops and only lazily restores, stalling Phaser's first boot into the loader-less title scene; SwiftShader is deterministic across local Windows + Linux CI | bumping the boot timeout rejected: masks the stall without fixing it; Playwright gamepad emulation rejected: none exists, a shim is the standard approach |
