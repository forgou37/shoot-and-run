# CLAUDE.md

Living document for this project: architecture, hard rules, conventions, and commands. Keep it current — when a command or convention changes, update it here in the same commit. Non-trivial decisions are logged in [docs/DECISIONS.md](docs/DECISIONS.md), not here.

## What this is

A TowerFall Ascension–**inspired** local-multiplayer arena game. An homage, not a clone: all names, art, and content must be original.

- 2–4 players on one screen, archer-vs-archer combat
- Each player starts with 3 arrows; fired arrows stick in the world and must be picked up; out of arrows → kill by stomping enemies from above
- Screen wraps at all edges (horizontal and vertical)
- One-hit kills, rounds last 10–60 seconds, best-of-N match structure
- Tight platforming: variable jump height, coyote time, jump buffering, air control
- Small single-screen arenas, pixel art later, juice (hitstop/shake/particles) later
- Local multiplayer always works offline on one screen. **Online multiplayer added 2026-06-14** (owner reversal of the original "permanently out of scope" clause) — host-authoritative rollback netcode on a self-hosted dedicated server; see specs/008-netcode.md. The sim-purity, determinism, and tuning-is-data hard rules are unchanged and constrain the netcode design.

Long-term direction (spec 005, **not now**): an offline AI pipeline generates arena layouts as JSON, a headless simulator plays them with scripted bots, balance metrics + LLM-as-judge score them, winners land in `content/arenas/`. The architecture below exists so this is possible without a rewrite.

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
| `content/tuning.json` | Every game-feel number. The only place tunables exist. Shell-only blocks `juice`, `input` (stickDeadzone), `ui` (lobbyCountdownMs), and `net` live here too — the sim ignores them all. The `net` block (validated in `packages/net`): `inputDelayTicks`/`snapshotIntervalTicks`/`maxRollbackTicks`/`jitterBufferTicks` (spec 008/009); `maxSpectators` (T13.2); `reconnectGraceTicks`/`reconnectAttempts`/`reconnectBackoffTicks` (T13.3); `maxInputsPerSecond`/`maxInputLeadTicks` (T13.5 hardening); `adaptiveInputDelay`/`minInputDelayTicks`/`maxInputDelayTicks`/`correctionSmoothingMs` (T13.6 lag-comp). |
| `content/players.json` | `{ slots: [{slot,name,color} ×4], keyboards: [KeyBindings ×2] }` — slot identities plus the two keyboard binding profiles. Devices bind to slots in the lobby, not here. |
| `content/bots.json` | `{ difficulties: { easy/normal/hard: {reactionDelayTicks, aimTolerance, aimErrorChance, dodgeChance, dashChance} } }` — bot difficulty presets (spec 004). Validated in `packages/bots`; never imported by the sim. |

Hot-reload: the Phaser shell watches `content/tuning.json` via Vite HMR in dev and pushes the new tuning object into the running sim. Note: hot-reloading mid-round breaks determinism for that run — fine in dev; replays/tests always pin the tuning snapshot at init.

## Project structure

```
arcade-game/
├─ CLAUDE.md
├─ package.json               # npm workspaces root: packages/*
├─ tsconfig.base.json
├─ .dependency-cruiser.cjs    # enforces sim + bots + net purity (hard rule 2); analyzes type-only edges
├─ specs/
│  ├─ 000-baseline.md
│  └─ backlog.md
├─ assets/                    # Aseprite sprite sources (art pass, spec 006); jungle-tiles/jungle-bg (spec 007) + castle-tiles/castle-bg (spec 016, dark-stone-castle theme); cards/ (cards.aseprite+cards.png — combined lobby character-card sheet, kept out of the export:art glob); fonts/ (FreePixel.ttf, the shell's pixel font)
├─ scripts/
│  ├─ export-art.mjs          # assets/*.aseprite → packages/game/public/assets/ (sprite atlases)
│  └─ slice-cards.mjs         # assets/cards/cards.png → public/assets/card_<name>.png (per-slot master cards)

├─ content/
│  ├─ arenas/arena-001.json   # "crossfire" — sim-test + golden-log fixture
│  ├─ arenas/arena-002.json   # "canopy" — jungle arena (online/server default; theme defaults to jungle when absent)
│  ├─ arenas/arena-003.json   # "ramparts" — castle arena the local shell boots into (spec 016; cosmetic theme:"castle")
│  ├─ tuning.json
│  ├─ players.json
│  └─ bots.json               # bot difficulty presets (spec 004)
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
│  │  │  ├─ events.ts         # SimEvent definitions
│  │  │  ├─ snapshot.ts       # spec 008: SimSnapshot + DOM-free deepClone (snapshot/restore)
│  │  │  └─ wire.ts           # spec 008: 1-byte input + versioned input-frame (de)serialization
│  │  └─ test/
│  │     └─ determinism.test.ts
│  ├─ bots/                   # spec 004: heuristic AI archers (pure, headless, imports only sim)
│  │  └─ src/
│  │     ├─ types.ts          # BotPolicy/BotContext/BotDifficulty contract
│  │     ├─ sense.ts          # wrap-aware perception primitives
│  │     ├─ bot.ts            # behavior stack (dodge→engage→scavenge), makeBot, botSeed
│  │     └─ config.ts         # content/bots.json validator
│  ├─ net/                    # spec 008: host-authoritative rollback netcode (pure, headless, imports only sim). types: transport/protocol/session; impl: loopback (latency/jitter/loss), codec (NetMessage wire — hello/join/reject/input/auth/snapshot/ack/ping/pong/lobby), host (authoritative loop + per-slot late-drop), host-runtime (join handshake + per-slot occupancy/reconnect + spectators + hardening + metrics), clock (tick sync + rttTicks), rollback (predict+rollback), client (ClientSession: predict/clock/spectator/reconnect/metrics/adaptive-delay), params (tuning.net validator), version (content-version guard). Spec 013 (T13.1–6): join handshake, spectators, reconnection (token reclaim), net metrics, hardening posture, lag-comp data. Real WebSocket transport lives in the shell + packages/server; no Cloudflare
│  ├─ server/                 # spec 011: self-hosted dedicated host = sim + net + a Node `ws` transport. ws-transport-server (ws→TransportServer adapter, optional direct-TLS wss), start.ts (createHostRuntime + 60 Hz loop + periodic health log + crypto.randomUUID reconnect tokens), main.ts (CLI entry — `npm run dev:host`/`start:host`, env PORT/HOST/PLAYERS/SEED/ARENA/CONTENT_DIR/TLS_CERT+TLS_KEY + JOIN_TOKEN). Headless Node, never imports Phaser/game (server-purity cruiser rule)
│  └─ game/
│     ├─ index.html
│     ├─ vite.config.ts
│     ├─ public/assets/       # committed sprite atlases (PNG + Aseprite JSON), via export:art; card_*.png (master-res lobby cards, drawn by the hi-res DOM overlay), via export:cards
│     └─ src/
│        ├─ main.ts           # Phaser game: registers boot→title→lobby→arena(+online) scenes
│        ├─ loop.ts           # accumulator + interpolation driver
│        ├─ app-context.ts    # app-wide singletons (DeviceManager, keyboard) in the registry
│        ├─ match-config.ts   # roster (slot+device+team) the lobby hands to the match
│        ├─ theme.ts          # pixel bitmap font: FreePixel→1-bit RetroFont atlas (buildPixelFont) + addPixelText/loadFont()
│        ├─ scene-transition.ts # spec 015: full-viewport DOM fade-through-black overlay (transitionTo/fadeIn wrap every scene change; above canvas + DOM card/input layers)
│        ├─ test-api.ts       # dev-only window.__testApi (getPhase + match probes + online getNetProbe[+metrics]/getConfirmedHashAt/forceDisconnect)
│        ├─ scenes/           # BootScene (?online/?spectate/?token/?netdebug), TitleScene (LOCAL/ONLINE), LobbyScene (character select — left/right pick your card, one human/bot per card, host dash=place bot; spec 017), ArenaScene (match + pause), OnlineJoinScene (host URL + join-token fields), OnlineArenaScene (online match: spectate/reconnect/net-overlay/correction-smoothing)
│        ├─ net/              # spec 010: WebSocketTransport (browser Transport impl over a DOM WebSocket)
│        ├─ input/            # InputDevice (keyboard/gamepad/bot), hot-plug manager, edge reader, players.json/tuning parsers
│        └─ render/           # sprite renderers (archer, arrows); environment.ts — theme-aware env (THEMES table maps autotile roles→tag names + tileset/bg per theme: jungle (spec 007) / castle (spec 016); ArenaTheme + themeFromArena()); cards.ts (card image URL) + card-overlay.ts (hi-res DOM card layer over the canvas); rect debug via ?rects=1
└─ packages/pipeline/         # FUTURE (spec 005): evals + generator. Do not create yet. (bots → packages/bots spec 004; net → packages/net spec 008)
```

## Commands

Keep this section current as scripts change.

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server for `packages/game` (tuning hot-reload from T0.5) |
| `npm run dev:host` | Dedicated netcode host (`packages/server`, spec 010/011), run via `tsx`. Serves browser clients over WebSocket. Env: `PORT` (8787), `HOST` (all interfaces), `PLAYERS` (2), `SEED` (1), `ARENA` (arena-002.json), `CONTENT_DIR` (repo /content), `TLS_CERT`+`TLS_KEY` (optional → direct `wss://`). Open two tabs at `?online=ws://localhost:8787` to play |
| `npm run start:host` | Same dedicated host via the package's `start` script (`npm run start -w @shoot-and-run/server`) — the documented production entry; see the deployment doc for running on a VPS behind TLS |
| `npm run build` | Type-check both packages + production Vite build |
| `npm run typecheck` | `tsc --noEmit` over sim src + tests, bots src + tests (no Node/DOM types — purity), net src, game, server src + tests (Node types), and e2e |
| `npm test` | All Vitest suites (sim + bots + net + server tests run headless in Node; incl. the server's ws-adapter TCP test) |
| `npm run e2e` | Playwright suite (Chromium/SwiftShader, dev server, `window.__testApi`): shell smoke + lobby flow + gamepad shim + bots (`?bots=N` / lobby add-bot) + online two-tab match (spec 010, second `webServer` = `dev:host`) |
| `npm run lint` | ESLint, incl. sim + bots determinism guards (no `Math.random`/`Date.now`/timers) |
| `npm run check:deps` | dependency-cruiser: fails if `packages/sim/src`, `packages/bots/src`, `packages/net/src`, or `packages/server/src` imports outside its allowed set (bots + net may import the sim; sim imports nothing; server may import net + sim + ws + Node, never Phaser/game). Analyzes type-only edges (`tsPreCompilationDeps`) so the sim↔net types seam is enforced |
| `npm run export:art` | Re-export all `assets/*.aseprite` → `packages/game/public/assets/` atlases (needs local Aseprite; exports are committed, CI never runs this) |
| `npm run export:cards` | Slice `assets/cards/cards.png` → per-slot `public/assets/card_<name>.png` master cards (pure Node, no Aseprite; outputs committed) |

Notes: `packages/sim` has no build step — its package `exports` points at `src/index.ts` and Vite/Vitest consume the TS source directly. Sim's tsconfig has no DOM lib, so `window`/`document` fail to typecheck there (first line of defense for hard rule 2).

## CI/CD

GitHub Actions quality gate (`gate` + `e2e` jobs): `npm ci` → typecheck (`tsc --noEmit`) → `lint` → `check:deps` → `npm test` → `vite build`, plus the Playwright `e2e` job. Runs on every PR and on push to `main`. Trunk-based on `main`, one task per commit (hard rule 5); changes land via PR with both checks green — **server-enforced** by the "Protect main" ruleset (required checks `gate` + `e2e` strict, PR required, squash-only, force-push + deletion blocked, admin bypass; enabled once the repo went public, see [CONTRIBUTING.md](CONTRIBUTING.md) § Enforcement).

The dev process — PR flow, roles, Definition of Done, releases — lives in [CONTRIBUTING.md](CONTRIBUTING.md); continuous deploy to GitHub Pages runs via `.github/workflows/deploy.yml` (push to `main`) and tag-triggered release builds via `.github/workflows/release.yml`.

- Linux CI re-verifying the golden determinism log produced on the Windows dev machine doubles as the cross-OS float-determinism check backing Decision #3.
- **CD: GitHub Pages continuous deploy is live** (`.github/workflows/deploy.yml`) — every green push to `main` builds `packages/game` and publishes to https://forgou37.github.io/shoot-and-run/, the always-playable playtest URL from spec 001. The Vite build uses a relative `base` so assets resolve under the project-pages subpath. Tagged releases to itch.io via `butler` remain later, once the game is fun.
- Generated arenas (spec 005) arrive as commits and pass the exact same gate as hand-written content.

## Decisions Log

The full decision history — every non-trivial choice with its reasoning and rejected alternatives — lives in **[docs/DECISIONS.md](docs/DECISIONS.md)**. Append a row there (not here) when a non-trivial choice is made, in the same PR; format `Date | Scope | Decision | Reasoning | Alternatives rejected`. The load-bearing invariants those decisions produced are codified above in **Hard rules** + **Conventions** and enforced by CI (`check:deps`, the determinism lint, `golden-state-hashes.json`).
