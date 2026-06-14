# Spec 004 — Real bots

**Goal:** The game becomes playable solo and with uneven player counts: a human can fill empty slots with computer-controlled archers from the lobby, free-for-all or teams, at one of three difficulty levels. Bots move, platform, aim 8-directionally, fire, retrieve arrows, stomp when out of ammo, and dodge incoming shots. The bot logic is a pure, headless, deterministic module — the substrate the spec 005 eval pipeline will consume.

**Scope note:** couch-play core only. The headless `run-rounds` eval CLI, the balance-metrics layer, and anything LLM-driven stay in the backlog for spec 005. No pathfinding, no learned/ML behavior, no per-arena bot tuning. The sim is **not** touched — bots are a new input source, not a new game rule.

**Definition of done:** all acceptance criteria pass; a human-vs-3-bots FFA match and a 2v2 (humans + bots) teams match each play title → lobby → match → pause → back to lobby; bot logic passes the dependency-cruiser purity check; a bot-vs-bot round is byte-identical across two headless runs; the FFA golden determinism log and the `packages/sim/test/bots.ts` scaffold bots are untouched; full gate + e2e green.

---

## Why this shape

The shell already exposes the exact seam bots need. Every tick [`ArenaScene.doTick`](../packages/game/src/scenes/ArenaScene.ts) samples each roster device and steps the sim:

```ts
const inputs = this.devices.map((d) => d.sample());
const events = this.sim.step(inputs);
```

A device is just `InputDevice { id, kind, connected, sample(): PlayerInput, pausePressed() }`. **A bot is therefore another `InputDevice`** whose `sample()` runs a heuristic policy over the live `sim.state`. The match scene, roster (`MatchConfig`/`RosterEntry`), kills, rounds, and teams need no changes; the sim keeps seeing only `PlayerInput`. This realizes the backlog's bot contract — `(state, slot, rng) → PlayerInput`, pure, living outside the sim.

Two sim mechanics the bot relies on (both already true):
- **Aim is 8-directional**: arrows fire from the held direction keys at the moment of shoot; with no direction held they fly horizontally toward `facing` ([arrow.ts](../packages/sim/src/arrow.ts)). A bot aims up/down/diagonally simply by holding direction keys while pressing shoot.
- **`facing` follows movement** ([player.ts](../packages/sim/src/player.ts)) — steering toward a target also aims at it.

## Spec-level acceptance criteria

- [ ] A4.1 New workspace package `packages/bots` exists, imports only `@shoot-and-run/sim` (types + `wrapDelta`/`wrapMod` + seeded RNG) and nothing else; a dependency-cruiser rule fails the build if `packages/bots/src` imports Phaser, the DOM, or `packages/game`. Its tsconfig has no DOM lib. Wired into the root workspace, CI typecheck, and `npm test`.
- [ ] A4.2 A `BotPolicy` produces a `PlayerInput` each tick from `(state, slot, ctx)`, where `ctx` carries the bot's **own** seeded mulberry32 (never the sim's PRNG) and a difficulty preset. Shared primitives (`moveToward`, `faceAndFire`, `nearestThreat`, `nearestPickup`) are wrap-aware and individually unit-tested.
- [ ] A4.3 The behavior stack works, verified on crafted states: (1) dodge a flying arrow whose path crosses the bot within the reaction window; (2) when out of arrows, seek the nearest stuck arrow or chest, or stomp an opponent the bot is above; (3) with arrows + a target, close to range and fire 8-directionally toward the wrap-shortest direction; (4) otherwise patrol toward the nearest opponent, jumping gaps and dashing to close.
- [ ] A4.4 `content/bots.json` holds three difficulty presets (`easy`/`normal`/`hard`); every behavioral knob (`reactionDelayTicks`, `aimTolerance`, `aimErrorChance`, `dodgeChance`, `dashChance`) is data, validated in `packages/bots`. A malformed config is rejected at load with a clear error.
- [ ] A4.5 Headless determinism: a bot-vs-bot full round, run twice with fresh sims and a fixed seed, yields byte-identical serialized event logs; a full multi-round match completes without throwing and produces ≥1 kill and a `round_ended`. Runs in Node with no Phaser in the test's dependency tree.
- [ ] A4.6 `BotDevice implements InputDevice` (`kind: "bot"`, `connected: true`, `pausePressed(): false`); `ArenaScene` calls `attach(getState, slot)` on bot devices right after `createSim`. `?bots=N&difficulty=<preset>` boots a human-vs-bots match directly for dev/e2e. Browser-verified: a bot-driven archer moves and fires.
- [ ] A4.7 Lobby: a joined human can add/remove bots into open slots and cycle a bot's difficulty; bots respect team assignment in teams mode. Browser-verified in FFA and teams.
- [ ] A4.8 e2e: a `?bots=1` match asserts (via `__testApi`) that the bot-driven player acts; full gate + e2e green locally and in CI. FFA golden log confirmed untouched.

## Fixed design points

- **Package home.** `packages/bots` (narrow). `packages/pipeline` stays reserved for spec 005 (evals + generator) and is not created here.
- **Policy contract.**
  ```ts
  export interface BotContext { rng: Rng; difficulty: BotDifficulty; }
  export type BotPolicy = (state: Readonly<SimState>, slot: number, ctx: BotContext) => PlayerInput;
  ```
- **Determinism.** A bot never touches the sim's PRNG (that would desync chest spawns). Each bot gets its own mulberry32 seeded from `matchSeed ^ (slot * 0x9e37)`. Consequence: a bot-driven shell match is fully replayable (same arena + tuning + seed ⇒ identical event log) — the property spec 005 needs, and free bug-repro value now.
- **Behavior model.** One policy, a small fixed priority stack (dodge → seek/stomp → engage → patrol), all targeting via `wrapDelta` for shortest wrap path. No pathfinding — single-screen arenas make heuristics sufficient (matches the backlog's "no pathfinding gold-plating").
- **Difficulty knobs** (all in `content/bots.json`, all data): `reactionDelayTicks` (decision cadence / perception staleness), `aimTolerance` (alignment slack before firing), `aimErrorChance` (PRNG mis-hold of an aim direction), `dodgeChance` (PRNG roll to react to a threat), `dashChance` (aggression of dash use to close/dodge). Presets: easy / normal / hard.
- **Scaffold bots untouched.** `packages/sim/test/bots.ts` (`hunterBot`/`patrolBot`) pin the golden log and stay byte-for-byte as-is. The new package supersedes them for gameplay but does not modify them; the golden log is **not** regenerated this spec.
- **Shell device.** `BotDevice` is built by the lobby (or `?bots=`) before the sim exists, so it late-binds via `attach(getState, slot)` — the single, contained `ArenaScene` change. `DeviceKind` gains `"bot"`; a disconnected/neutral concept does not apply (bots are always connected).
- **Lobby controls** (placeholder text/rect UI, consistent with 003): a joined human adds a bot to the next open slot and cycles its difficulty / removes it via a dedicated control; bots inherit the current mode (FFA/teams) and are assignable to either team.
- **No new sim tuning keys.** Bot data lives in `content/bots.json`, not `content/tuning.json` (tuning.json is game-feel for the sim; bot behavior is shell/headless-side).

## Tasks

### T4.0 — `packages/bots` scaffold
New workspace package; tsconfig without DOM lib; `package.json` `exports` → `src/index.ts` (no build step, like sim); dependency-cruiser rule forbidding Phaser/DOM/`packages/game` imports from `packages/bots/src`; root workspace + CI wiring.
**Accept:** A4.1.

### T4.1 — Policy contract + shared primitives
`BotPolicy`/`BotContext` types; wrap-aware primitives `moveToward`, `faceAndFire`, `nearestThreat`, `nearestPickup`; the bot's own seeded RNG helper.
**Accept:** A4.2.

### T4.2 — Behavior stack + difficulty data
Priority stack (dodge → seek/stomp → engage → patrol); `content/bots.json` schema + validator in `packages/bots`; easy/normal/hard presets.
**Accept:** A4.3, A4.4 — headless unit tests per behavior + a bad-config rejection test.

### T4.3 — Headless determinism + smoke
Bot-vs-bot full round twice → byte-identical logs; a full match completes with ≥1 kill and a `round_ended`; assert no Phaser in the test's resolution path (mirrors the existing sim purity test).
**Accept:** A4.5.

### T4.4 — `BotDevice` + match wiring
`BotDevice implements InputDevice`; `ArenaScene` `attach` after `createSim`; `?bots=N&difficulty=` quickstart in BootScene/match-config.
**Accept:** A4.6 — browser-verified.

### T4.5 — Lobby bot management
Add/remove bot into open slots; difficulty cycle; team assignment in teams mode; HUD shows bot slots like player slots.
**Accept:** A4.7 — browser-verified FFA + teams.

### T4.6 — e2e + verification sweep
`?bots=1` e2e asserting the bot-driven player acts via `__testApi`; full gate + e2e green; golden log confirmed untouched; CLAUDE.md (structure/commands if changed), backlog roadmap, and Decisions Log updated.
**Accept:** A4.8; definition of done.

## Out of scope for 004 (→ backlog / spec 005)

- Headless `run-rounds` eval CLI + JSONL logs + summary stats — spec 005 substrate.
- Balance metrics, LLM-as-judge, arena generator — spec 005.
- Pathfinding, learned/ML bots, per-arena bot tuning, difficulty beyond three presets.
- Online play (never), audio (unchanged).
