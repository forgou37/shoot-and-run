# Spec 000 — Baseline: First Playable

**Goal:** Two players on one keyboard, in one arena loaded from a data file, can run, jump, shoot arrows, pick them up, kill each other (arrow or stomp), and the round restarts. The sim core is proven deterministic by a headless Node test.

**Definition of done:** all spec-level acceptance criteria below pass, and two humans can play a complete round that *feels* responsive (subjective check by the owner — tuning iteration is in scope for T0.4/T0.6).

---

## Spec-level acceptance criteria

- [ ] A1. `npm run dev` opens the game; two players (colored rects) spawn in the arena defined by `content/arenas/arena-001.json`.
- [ ] A2. Both players are controlled from one keyboard simultaneously without input loss (key-rollover-safe default bindings).
- [ ] A3. Movement feel features verifiably work: variable jump height, coyote time, jump buffering, air control (each has a sim-level unit test, not just manual feel).
- [ ] A4. Screen wraps at all four edges for players and arrows; an entity straddling an edge renders and collides correctly on both sides.
- [ ] A5. Each player starts a round with 3 arrows; fired arrows stick into solid tiles and become pickups; walking over a stuck arrow picks it up; out of arrows ⇒ shooting does nothing.
- [ ] A6. Arrow hit on a player kills in one hit. A player landing on top of another player kills them (stomp) and bounces slightly.
- [ ] A7. When ≤1 player is alive, the round ends (winner or draw), pauses briefly, and restarts: players back at spawns, 3 arrows each, stuck arrows cleared.
- [ ] A8. **Determinism proof:** `packages/sim` runs a scripted 2-bot round headless in a Node test (no Phaser in the test's dependency tree) with a fixed seed, and produces byte-identical serialized event logs across repeated runs. The logged round includes at least one `arrow_fired`, one `player_killed`, and one `round_ended` event.
- [ ] A9. All tuning values used in this spec exist in `content/tuning.json` and nowhere else; editing the file in dev hot-reloads into the running game without a page refresh.
- [ ] A10. `npm run check:deps` fails if a Phaser/DOM import is added to `packages/sim` (verified by a deliberate broken-import dry run during T0.1, then reverted).

---

## Fixed design points for this spec

- Sim tick rate: 60 Hz. Shell renders at display rate with interpolation.
- Arena: 320×240 logical px, 20×15 grid of 16 px tiles. Renderer integer-scales up.
- Player hitbox: 12×12 px. Arrow hitbox: 10×4 px (flying), pickup radius 12 px (stuck).
- Aiming: 8-directional (4 cardinal + 4 diagonal), from held direction keys at the moment of fire; no held direction ⇒ shoot facing direction (horizontal).
- Arrows fly fast with slight gravity, stick into the first solid tile they touch, and wrap at edges like everything else.
- Stomp: kill registers when the attacker's feet overlap the victim's head region while the attacker is moving downward relative to the victim.
- Round end: last player alive wins; simultaneous death ⇒ draw. No match score yet (backlog).
- Event log: every externally meaningful occurrence is a `SimEvent { tick, type, ...payload }`. Initial event set: `round_started`, `arrow_fired`, `arrow_stuck`, `arrow_picked_up`, `player_killed { victim, killer, cause: "arrow" | "stomp" }`, `round_ended { winner | "draw" }`.

### Initial tuning values (starting points — iterate freely in `content/tuning.json`)

| Key | Value | Notes |
|---|---|---|
| `gravity` | 900 px/s² | |
| `maxFallSpeed` | 240 px/s | |
| `runSpeed` | 100 px/s | |
| `airAccel` | 600 px/s² | air control |
| `jumpVelocity` | 260 px/s | upward |
| `jumpCutFactor` | 0.4 | releasing jump multiplies upward vy by this (variable height) |
| `coyoteTimeMs` | 80 | ≈5 ticks |
| `jumpBufferMs` | 100 | ≈6 ticks |
| `arrowSpeed` | 350 px/s | |
| `arrowGravity` | 180 px/s² | slight drop |
| `stompBounceVelocity` | 180 px/s | |
| `roundRestartDelayMs` | 1500 | |
| `startingArrows` | 3 | |

---

## Tasks

### T0.1 — Monorepo scaffolding + CI gate
npm workspaces root; `packages/sim` (tsc, no bundler needed) and `packages/game` (Vite + Phaser); shared `tsconfig.base.json` with `strict: true`; Vitest; ESLint; dependency-cruiser config forbidding Phaser/DOM/canvas imports in `packages/sim`; scripts per CLAUDE.md Commands table; `git init` + first commit; GitHub remote + Actions workflow running the full gate per CLAUDE.md CI/CD section (typecheck → lint → check:deps → test → build) on every push.
**Accept:** `npm run dev` serves a blank Phaser canvas; `npm test` runs a placeholder sim test in Node; `npm run check:deps` passes, and fails when a `phaser` import is temporarily added to sim (dry run, then revert); first push to GitHub shows a green Actions run.

### T0.2 — Deterministic sim skeleton
`createSim({ arena, tuning, players, seed })`, `sim.step(inputs): SimEvent[]`, `sim.state` readonly snapshot. Mulberry32 PRNG seeded at init; PRNG is the only randomness source. `PlayerInput` struct: `{ left, right, up, down, jump, shoot }` booleans per player per tick. Deterministic entity-id counter. Event types from the list above defined in `events.ts`.
**Accept:** unit test constructs two sims with the same seed, steps both 600 ticks with identical canned inputs, and asserts deep-equal state snapshots and event logs. Lint/grep guard: no `Math.random` / `Date.now` / `performance` anywhere in `packages/sim/src`.

### T0.3 — Arena data format + loader
Arena JSON schema: `{ name, tiles: string[15], spawns: [{x,y}, …≥4] }` where `tiles` is 15 rows of 20 chars (`"#"` solid, `"."` empty — room to grow). Validation function in `packages/sim` with precise error messages (row length, spawn count, spawn-inside-solid, spawn-on-ground check). Author `content/arenas/arena-001.json`: a simple symmetric arena with 3–4 floating platforms, ground, and ≥4 valid spawns.
**Accept:** loader test passes on arena-001 and rejects 4 deliberately malformed fixtures with the expected error each.

### T0.4 — Player movement (sim)
Gravity, run, jump with variable height (jump-cut on release), coyote time, jump buffering, air control; wrap-aware AABB collision against the tile grid (player can straddle any edge); all constants read from the tuning object.
**Accept:** sim unit tests prove — (a) jump tapped vs held produces measurably different apex heights; (b) jump pressed ≤ `coyoteTimeMs` after walking off a ledge still jumps, later does not; (c) jump pressed ≤ `jumpBufferMs` before landing executes on landing; (d) a player walking off the left edge re-enters on the right at the same height, and the same vertically.

### T0.5 — Phaser shell: loop, input, debug rendering
Fixed-timestep accumulator (with spiral-of-death clamp) driving `sim.step()`; interpolated rendering of `sim.state` as colored rects (players, tiles, arrows); wrap-straddling entities rendered on both sides. Keyboard mapping for two players from `content/players.json` (suggested: P1 WASD + F shoot, P2 arrows + `/` shoot — chosen to be rollover-safe). Input layer converts device state → `PlayerInput` structs; the sim never sees key codes. Tuning hot-reload via Vite HMR pushing into the running sim.
**Accept:** A1, A2, A9 pass; moving with both players simultaneously shows no logic in render callbacks (loop code review: render path reads state only).

### T0.6 — Arrows: shoot, fly, stick, pick up (sim)
8-directional aim from held keys; fire consumes 1 arrow; arrow entity flies with `arrowSpeed` + `arrowGravity`, wraps at edges, sticks into the first solid tile hit (becomes a static pickup at the impact point); player overlap with a stuck arrow picks it up (+1 ammo); firing with 0 arrows does nothing. Events: `arrow_fired`, `arrow_stuck`, `arrow_picked_up`.
**Accept:** sim tests cover: ammo decrements/increments correctly; arrow sticks and is collectable; 0-ammo fire is a no-op; an arrow fired across a wrapping edge continues and sticks on the other side. Manual: A5 feels right.

### T0.7 — Kills: arrow and stomp (sim)
Flying-arrow-vs-player overlap kills victim (shooter immune to own arrow for the first few ticks of flight to avoid self-kill at muzzle); stomp detection per the fixed design point, killer bounces with `stompBounceVelocity`; dead players are removed from play (no respawn within a round); each kill emits `player_killed` with cause and killer/victim ids; a player's stuck-and-flying arrows remain in the world after their death.
**Accept:** sim tests cover arrow kill, stomp kill, no-self-kill at muzzle, and side-collision-is-not-a-stomp. Manual: A6.

### T0.8 — Round flow
Round state machine in sim: `running → ended(winner|draw) → restart after roundRestartDelayMs`. On restart: players at spawn points (deterministic spawn assignment by player index for now), 3 arrows each, all arrow entities cleared. Events: `round_started`, `round_ended`. Shell shows a minimal text overlay ("P1 wins" / "Draw") during the pause.
**Accept:** A7 passes; sim test: kill one player, assert `round_ended{winner}`, step through the delay, assert `round_started` and a fully reset state.

### T0.9 — Determinism proof: headless scripted-bot round
Two scripted bots as deterministic policies — pure functions `(state, tick) → PlayerInput` (e.g. bot A advances toward the nearest opponent and fires on rough alignment; bot B patrols and jumps periodically). Policies live in `packages/sim/test/`. The test: create sim with arena-001, fixed seed, run until `round_ended` (cap 3600 ticks), serialize the full event log; run the entire thing twice with fresh sim instances; assert the two serialized logs are byte-identical and contain ≥1 `arrow_fired`, ≥1 `player_killed`, 1 `round_ended`. Additionally store a golden copy of the log as a fixture — future sim changes that alter behavior must consciously regenerate it (regression guard).
**Accept:** A8 passes in `npm test` on Node with no Phaser installed in the resolution path of the test (verified: `packages/sim` has no dependency on `packages/game` or `phaser`).

---

## Out of scope for 000 (do not build, do not stub)

- Gamepad support; players 3–4 (input layer must not *preclude* them: slot→device mapping is a list, not two hardcoded fields)
- Match structure: best-of-N, scores, victory screen
- Arrow variants, power-ups, arrow catching, shields, dodging
- Juice: hitstop, screen shake, particles, corpses, slow-mo
- Audio, menus, pause, settings, key rebinding
- Pixel art or any sprite work (colored rects only — hard rule 6)
- AI bots beyond the deterministic test policies of T0.9
- Arena generation pipeline, balance metrics, LLM anything
- Multiple arenas / arena selection (one arena file is enough; the loader already takes any conforming file)
- Replays (determinism makes them nearly free later — backlog)
- Online anything (permanently out of scope)
