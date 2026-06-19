# Spec 018 — Build Wall (deployable wall booster)

**Goal:** A new chest item, the **wall**. Collecting its floating booster grants **one build charge**. Pressing a new dedicated **build** button spends the charge and spawns a short solid wall **16 px in front** of the player, **oriented to the way the player is aiming** (vertical when aiming sideways, horizontal when aiming up/down, 45°-rotated on the diagonals). The wall is a **neutral solid obstacle**: it blocks every player's movement and stops every arrow. It exists until **a flying arrow hits it** — then the wall **dissolves** and that arrow **stops and sticks** at the impact point (becoming a ground pickup, exactly like hitting a tile).

This is the project's first **entity-vs-entity solid collision**: today players pass through each other and all collision is AABB-vs-static-tile-grid. A deployable, possibly-45°-rotated solid is a genuinely new collision category — the bulk of the work is in the sim.

**Numbering note:** 018 is the next free number (000–004, 006–017 taken; 005/009–012 reserved by their roadmaps). This promotes a new owner-requested item (per hard rule 1, new ideas land in the backlog then get promoted into a numbered spec when their time comes — this spec is that promotion). It is gameplay + a little art, independent of netcode.

**Owner-confirmed design points (2026-06-18):**
- Wall is **completely solid** to **both players and every arrow type** — a true physical barrier, not a projectile-only force field. It blocks the **builder too** and the builder's **own arrows** (no shooting through your own cover); collision is fully **neutral** (ignores team/ownership).
- The **only** thing that passes through a standing wall is a **bomb's area blast** (a thin plank doesn't occlude an explosion) — blast line-of-sight is deliberately **not** modeled. A bomb arrow that detonates *on* the wall still dissolves it.
- A flying arrow that hits a wall **dissolves the wall and sticks** at the contact point (becomes a pickup).
- **One build charge per pickup** (no timer, no stacking-by-design beyond what extra pickups give).

**Definition of done:** all acceptance criteria pass; a 2–4 player match plays start to finish with wall boosters dropping from chests, players building oriented walls that block movement and arrows, walls dissolving when shot (the arrow sticking where the wall was); sim changes are deterministic and headless-tested; the golden **event** log is byte-identical and the golden **state-hash** file is consciously regenerated (shape change only); full gate + e2e green; works both local-couch and online.

---

## Spec-level acceptance criteria

### Gameplay (sim) — PR A

- [ ] A18.1 A new `build` action exists on `PlayerInput` (edge-triggered like `shoot`/`dash`). It packs into input-byte **bit 7** (previously reserved-zero); `PROTOCOL_VERSION` is bumped so mismatched builds are rejected at the handshake. `wire.test.ts` round-trips `build`; `emptyInput()` and every `PlayerInput` literal carry `build: false`.
- [ ] A18.2 **`"wall"` is a new `ChestContents`** (equal weight in the chest pool). Collecting a wall booster runs `grant()`, which adds `wallChargesPerPickup` (tuning, default 1) to `PlayerState.wallCharges` (init 0). Cleared on death/round reset.
- [ ] A18.3 On the **build-press edge**, if `wallCharges > 0`, the player spends one charge and a `WallState` is appended to `SimState.walls`. Building with 0 charges is a no-op (no event, no charge change).
- [ ] A18.4 The wall spawns **16 px (`wallBuildDistancePx`) from the player's center along the aim direction**, oriented **perpendicular to the aim** (the same 8-way aim `handleShooting` uses; default = `facing` horizontal). Resulting sprite rotations: **0°** (vertical wall, aiming sideways), **90°** (horizontal wall, aiming up/down), **45°/135°** (diagonals). Wall geometry is **4 px thick × 24 px long** (`WALL_HALF_THICKNESS = 2`, `WALL_HALF_LENGTH = 12`, in `constants.ts`).
- [ ] A18.5 A wall is **solid to player movement**: an alive player's AABB can never end a tick overlapping a wall — it is pushed out along the wall's nearest face (wrap-aware), with the velocity component into the face zeroed. A player cannot pass through a wall at any reachable speed (verified by a dashing-into-wall headless test). Walls are **neutral**: they block every player including the builder, regardless of team/friendly-fire.
- [ ] A18.6 A wall is **solid to arrows**: a flying arrow whose swept path this tick crosses a wall stops at the contact point **before** it can reach any player behind the wall; the wall is removed (`wall_destroyed`) and the arrow resolves as if it hit a tile — **normal/laser/bounce → stick** (becomes a pickup), **bomb → explode**. One wall stops exactly one arrow. Neutral: any arrow (incl. the builder's own) triggers it.
- [ ] A18.7 New events: `wall_built { tick, wallId, slot, x, y, rotation }` and `wall_destroyed { tick, wallId, x, y }`. Walls do not expire (collect-or-shoot only); `round_started`/reset clears `SimState.walls` and every player's `wallCharges`.
- [ ] A18.8 **Determinism:** same seed + same inputs ⇒ identical walls, events, and state. Snapshot/restore round-trips `SimState.walls` and `PlayerState.wallCharges`/`prevBuildHeld`; `createSimFromSnapshot` restores them; `packages/net` types + codec compile and the online rollback path re-sims walls. The golden **event** log (`golden-bot-round.json`) is **byte-identical** (the bot round ends before any chest spawns — no wall code runs). The golden **state-hash** file (`golden-state-hashes.json`) is **regenerated consciously** (`UPDATE_GOLDEN=1`) because the snapshot JSON gains `walls`/`wallCharges`/`prevBuildHeld` — a shape change, not a determinism regression (the same move spec 014 made for `boosters`/`shielded`).

### Shell + art — PR B

- [ ] A18.9 The build action is bound on every device: a new `build` key in both `content/players.json` keyboard profiles and in `KeyboardInput.sample`; a gamepad button in `readStandardGamepad`; `build` added to `ACTION_KEYS` and the `KeyBindings` validator. Bots sample `build: false` (no wall AI this spec).
- [ ] A18.10 Walls render as a 4×24 sprite drawn at the wall's position and rotation (wrap-aware, all four orientations), tinted by the owner's color. A build burst plays on `wall_built`; a dissolve burst on `wall_destroyed`. `?rects=1` draws walls as oriented rect outlines. No console errors.
- [ ] A18.11 The `"wall"` booster gets a distinct 16×16 icon (added frame in `boosters.aseprite`); the booster renderer and `?rects=1` fallback map `contents:"wall"` to it. `npm run export:art` regenerates; exports committed.
- [ ] A18.12 Verified end-to-end: a player collects a wall booster, builds an oriented wall that blocks an opponent and stops an arrow (arrow sticks where the wall was), then dissolves — confirmed in the browser, local and online; shell-smoke/e2e + full gate green.

---

## Fixed design points

### Input & wire (sim)
- `PlayerInput` gains `build: boolean`. `PlayerState` gains `prevBuildHeld: boolean` for press-edge detection (mirrors `prevShootHeld`/`prevDashHeld`).
- `wire.ts`: `encodeInputByte`/`decodeInputByte` use **bit 7** for `build`. Bump `PROTOCOL_VERSION` 1 → 2 (the net codec + input-frame header inherit it, so peers on mismatched builds fail loudly at the handshake). `serializeInput`/`parseInputFrame` are otherwise unchanged (still one byte per input).
- No new net codec work beyond the shared bit: the net codec already calls the sim's `encodeInputByte`; snapshots already ship as `JSON.stringify(snapshot)`, so `walls`/`wallCharges` ride along automatically. (Optionally extend `assertSnapshotShape` to assert `state.walls` is an array.)

### Wall entity & state (sim)
```ts
export interface WallState {
  id: number;          // deterministic entity-id counter
  ownerSlot: number;   // builder, for FX tint + event attribution only (collision is neutral)
  x: number; y: number;// wall center
  rotation: 0 | 45 | 90 | 135; // sprite rotation of the base (vertical) 4×24 wall
}
```
- `SimState.walls: WallState[]` (init `[]`). `PlayerState.wallCharges: number` (init `0`), `prevBuildHeld: boolean` (init `false`).
- `constants.ts`: `WALL_HALF_THICKNESS = 2`, `WALL_HALF_LENGTH = 12` (geometry, like player/arrow/chest dims — not tuning).
- `tuning.json` + `Tuning`: `wallBuildDistancePx` (16, the front-of-player placement distance — a feel knob) and `wallChargesPerPickup` (1, integer ≥ 1, like `specialArrowsPerChest`). Neither is a duration, so no `derive` entry.

### Aim, placement & orientation (sim)
- Factor the 8-way aim currently inlined in `handleShooting` into a shared helper `aimDir(input, facing) → { nx, ny }` (unit vector; default `facing` horizontal when no direction held). `handleBuilding` reuses it so build direction and fire direction stay identical by construction.
- Wall center = wrap(player center + aim·`wallBuildDistancePx`). The wall's **long axis is perpendicular to the aim** ⇒ `rotation` is one of `{0, 45, 90, 135}` derived from the aim octant (sideways → 0 vertical; up/down → 90 horizontal; diagonals → 45 or 135). The collider derives local axes `u` (length) / `v` (thickness) from `rotation` using exact constants (`0`, `±1`, `±Math.SQRT1_2`), so stored state stays JSON-stable.
- v1 places the wall unconditionally (no validity check) even if it overlaps a tile, player, or another wall — simplest and deterministic. It spawns 16 px out, clear of the builder's own 12 px body, so it never self-pushes the builder. Placement validation is backlog.

### Collision model (sim) — the core work
New step `resolveWallCollisions(players, walls)` runs **right after the per-player `updatePlayer` loop** (before stomps), plus arrow-vs-wall handling inside arrow movement.

- **Player vs wall — discrete SAT pushout (post-move).** Per (alive player AABB, wall OBB): test the 4 SAT axes (player x, player y, wall `u`, wall `v`), wrap-aware on the center delta. If overlapping on all, push the player out by the minimum-overlap axis and zero the player's velocity along that axis's normal; if the push is mostly upward, set `grounded` (so players can stand on a horizontal/diagonal wall). **Tunnel-safe:** the overlap band on a wall's thin face is `playerHalf + wallHalfThick = 6 + 2 = 8 px` each side (16 px total); the fastest player move is `dashSpeed·DT = 300/60 = 5 px/tick < 16`, so a player can never skip across a wall's broad face in one tick — discrete pushout suffices for players (no sweep needed). Standing-on-wall is supported; deeper polish (coyote/wall-slide off built walls) is best-effort and not gated.
- **Arrow vs wall — swept (must sweep).** Arrows move `arrowSpeed·DT ≈ 5.8 px/tick`, larger than the thin-wall band, so a discrete test would tunnel. In `updateArrows`, capture each flying arrow's pre-move position, and after its tile move, test the swept segment `(pre → post)` against every wall (arrow modeled as a point vs the wall OBB expanded by the arrow's half-extents). The **earliest** wall contact along the segment wins: snap the arrow to the contact point, emit `wall_destroyed`, remove the wall, and resolve the arrow by kind (normal/laser/bounce → `stick` + `arrow_stuck`; bomb → `exploding`). This runs **before `checkArrowKills`**, so a wall reliably shields the player behind it. Walls don't trigger bounce reflection — a bounce arrow is caught and sticks (the wall is one-shot cover).

### Acquisition, supply & reset (sim)
- `CHEST_CONTENTS_POOL` gains `"wall"` (equal weight). `ChestContents` union gains `"wall"`. `grant()` case `"wall": p.wallCharges += t.wallChargesPerPickup`.
- `handleBuilding(players, inputs, walls, allocId, t, events, tick)`: per alive player, edge-detect `build`; if charge available, decrement, append a `WallState`, push `wall_built`. Placed in `step()` after `checkStomps`, before `handleShooting`.
- Round reset (`round.ts` `resetPlayer` + the reset block) clears `wallCharges = 0`, `prevBuildHeld = false`, and `state.walls = []` (alongside arrows/chests/boosters). `createSim` inits the new fields.

### Shell binding & render (PR B)
- `players-config.ts`: add `"build"` to `ACTION_KEYS`. `keyboard.ts`: sample `build`. `device.ts` `readStandardGamepad`: map a button to `build` (proposed **button 1 / B·Circle**; distinct from jump 0 / shoot 2 / dash 5). `content/players.json`: add a `build` key to both profiles (proposed: profile 0 `"KeyR"`, profile 1 `"Comma"` — owner may retune). `bot-device.ts` / bot policies sample `build: false`.
- New `render/walls.ts`: draw each wall (rotated 4×24 sprite tinted by owner color, wrap-aware), build burst on `wall_built`, dissolve burst on `wall_destroyed`, `?rects=1` oriented-rect fallback. `boosters.ts` maps `contents:"wall"` → its atlas frame (+ rect fallback color).
- Art: extend `assets/boosters.aseprite` with a `wall` frame; a simple 4×24 (or 16×16 padded) wall sprite (`assets/wall.aseprite`, or reuse a tinted rect for v1 and add art in the same PR). `npm run export:art`; commit atlases.

## Tasks

### PR A — gameplay (sim, headless)
- **T18.1 — Build input + wall entity + placement.** `PlayerInput.build` + bit 7 + `PROTOCOL_VERSION` bump; `WallState` + `SimState.walls`; `PlayerState.wallCharges`/`prevBuildHeld`; `constants` wall geometry; `tuning` `wallBuildDistancePx`/`wallChargesPerPickup`; `"wall"` in `ChestContents` + pool + `grant()`; extract `aimDir` helper; `handleBuilding` (edge → spend charge → spawn wall) wired into `step()`; events `wall_built`/`wall_destroyed`; reset clears walls + charges; `createSim`/snapshot/restore carry the new fields; update `emptyInput` + all `PlayerInput` literals (incl. test fixtures). Tests: build spends one charge and places an oriented wall at the right spot per aim octant; 0-charge build is a no-op; same-seed determinism; reset clears.
  **Accept:** A18.1–A18.4, A18.7 (build half), A18.8 (snapshot/golden-event/state-hash regen).
- **T18.2 — Wall solidity (collision).** `resolveWallCollisions` SAT pushout (player solid, neutral, tunnel-safety) wired after `updatePlayer`; arrow-vs-wall swept dissolve-and-resolve in `updateArrows` before `checkArrowKills`. Tests: player blocked by / standing on each orientation; dashing player never tunnels; normal arrow dissolves wall and sticks; bomb arrow dissolves wall and explodes; wall shields the player behind it; builder's own arrow also dissolves it; one wall stops one arrow.
  **Accept:** A18.5, A18.6, A18.7 (destroy half).

### PR B — shell + art
- **T18.3 — Device binding (shell).** `build` across `players-config`/`keyboard`/`device` gamepad mapping, both `players.json` profiles, bots `build:false`. Shell-smoke: bound key/button produces `build` in the sampled input.
  **Accept:** A18.9.
- **T18.4 — Render + art (shell).** `render/walls.ts` (oriented sprite, wrap, build/dissolve FX, `?rects=1`); `boosters` `wall` icon + fallback; `assets/boosters.aseprite` wall frame (+ optional `assets/wall.aseprite`); `export:art`; commit.
  **Accept:** A18.10, A18.11 — browser-verified.
- **T18.5 — Verification sweep.** e2e: build-and-block flow local + online (two tabs); shell-smoke asserts the wall/booster atlases load; full gate + e2e green; golden event log byte-identical; state-hash regen committed.
  **Accept:** A18.12, A18.8 reconfirmed.

## Out of scope for 018 (→ backlog)
- Wall placement validation (refuse to build inside terrain/another wall), build cooldown, and any per-player/arena cap beyond what one-charge-per-pickup gives.
- Timed wall despawn or multi-hit walls (this spec: one arrow dissolves it).
- Bot wall-awareness (pathing around walls) and bots using walls offensively/defensively.
- Walls as cover for stomps/bombs beyond the arrow rule (bomb blast radius still ignores walls — line-of-sight is not modeled); arrow-vs-arrow and laser nuances stay as today.
- Deeper platforming feel on built walls (coyote time off a wall, wall-jumping/-sliding on a built wall) — basic stand-on works; polish later.
- Weighted chest tables to bias wall drop rate.
