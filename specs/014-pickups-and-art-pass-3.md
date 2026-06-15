# Spec 014 — Floating booster pickups, shield power-up & art pass III

**Goal:** Opening a chest no longer grants instantly — it pops a **booster** that floats above the chest (gently bobbing); a player must *touch the floating booster* to acquire it, then it vanishes. A new **shield** power-up absorbs the first hit and renders as a bubble around the player. Alongside, an art pass: a hand-drawn icon for every booster type, a redrawn arrow, **four distinct per-character archer sheets** built from the lobby cards (replacing the per-slot recolor for players), and **directional aim poses** so the archer visibly points where it will shoot (↗45° up, ↑ straight up, ↘45° down) in every animation state.

**Numbering note:** 008–013 are reserved by the netcode roadmap (CLAUDE.md netcode decision, 2026-06-14). This spec is gameplay + art, independent of netcode, so it takes the next free number, 014. It promotes two long-standing backlog items: "Shield pickup that absorbs one hit" and per-character/portrait-driven sprites.

**Workflow note:** pixel art is generated in-session by Claude driving Aseprite via MCP, owner as art director (per spec 006 / Decision 2026-06-12). Source art for the four characters is the owner-supplied card sheet `assets/cards/cards.png` — the in-game archers must read as pixel-art versions of those four portraits.

**Definition of done:** all acceptance criteria pass; a 2–4 player match plays start to finish with chests popping floating boosters that are picked up in the air, shields blocking one hit each, the redrawn arrow, four visually-distinct archers, and aim poses that track the held aim direction; sim changes are deterministic and headless-tested; the golden determinism log is byte-identical; full gate + e2e green.

---

## Spec-level acceptance criteria

### Gameplay (sim) — PR A
- [ ] A14.1 Touching a chest **opens** it (emits `chest_opened`, chest removed) and spawns a **booster** floating `boosterFloatOffsetPx` above the chest's spot. Contents are **not** granted at this moment.
- [ ] A14.2 A booster is acquired only when an alive player's AABB overlaps it (wrap-aware): contents are granted then (the exact `grant()` that chests used to do), the booster is removed, and a `booster_collected { boosterId, slot, contents }` event fires. The booster's pickup position is a fixed point — its visual up/down bob is cosmetic and never affects collision.
- [ ] A14.3 Boosters persist until collected or round reset; `round_started`/reset clears all boosters and chests. Same seed ⇒ identical chest **and** booster sequence (sim test).
- [ ] A14.4 **Shield** is a new chest content (equal weight in the pool). Granting it sets `PlayerState.shielded = true` (a persistent charge, no timer); cleared on death/round reset.
- [ ] A14.5 While `shielded`, the **first** lethal hit from any cause (arrow, bomb blast, stomp) is consumed instead of killing: `shielded → false`, a `shield_blocked { slot }` event fires, the victim survives. A blocking arrow still sticks/becomes a pickup; a blocked stomp still bounces the attacker; a blocked laser keeps flying. The next hit (no shield) kills normally.
- [ ] A14.6 Snapshot/restore covers the new state: `sim.snapshot()` round-trips `SimState.boosters` and `PlayerState.shielded`; `createSimFromSnapshot` restores them; `packages/net` types/codec compile against the new `SimState`.
- [ ] A14.7 Determinism preserved: the golden bot-round log is **byte-identical** (the round ends ~tick 165 on an arrow kill, before any chest spawns — no booster/shield code runs in it). `chest.test.ts` / `powerups.test.ts` updated to the two-step flow; new booster + shield headless tests added; full gate green.

### Booster / arrow art + shell (PR B)
- [ ] A14.8 Each booster renders as a distinct icon for its content (`bomb`, `laser`, `bounce`, `invisibility`, `flight`, `shield`), drawn at the booster's position with a small cosmetic up/down bob (`juice.boosterBobAmplitudePx` / `boosterBobPeriodMs`), wrap-aware, plus an **opened-chest** decoration at the chest base (matches reference). A pickup burst plays on `booster_collected`.
- [ ] A14.9 A shielded player is wrapped in a **bubble ring** (reference image 4); the ring pops (brief FX) on `shield_blocked` and disappears.
- [ ] A14.10 The arrow is redrawn (reference image 2: dark head, wood shaft, red fletching), still authored pointing +x so the `atan2(vy,vx)` rotation and the per-kind tints (bomb/laser/bounce) are unchanged.
- [ ] A14.11 Shell-only PR: golden log untouched; `?rects=1` debug renderer still works for the new entities (boosters draw as colored rects, shield as a ring outline); no console errors; e2e green.

### Per-character archers + aim poses (PR C)
- [ ] A14.12 Four `.aseprite` archer sheets exist — one per identity (Maks, Igor B, Lyosha, Igor Sh) — each visually derived from that player's card, 16×16, with the full tag set. `npm run export:art` regenerates all four atlases; exports committed.
- [ ] A14.13 In-match players load their per-identity atlas keyed by normalized slot name (the `cards.ts` normalization, e.g. "Igor B" → `archer_igorb`). The per-slot recolor path is retired for players but kept as a fallback for any slot whose named sheet is missing.
- [ ] A14.14 Every aim-relevant state (`idle`, `run`, `jump`, `fall`, `shoot`) has four directional variants — horizontal (base), `_up45`, `_up`, `_down45`; `death` has none. The renderer picks the variant from the player's **currently held aim direction** (derived in the shell from the live input sample — no sim change), falling back to the base tag if a variant is absent.
- [ ] A14.15 Aim selection mapping (held input, after `facing` flip): `dirY<0 & dirX≠0 → _up45`; `dirY<0 & dirX=0 → _up`; `dirY>0 → _down45`; else base. `facing` still drives `flipX`. Aim tracks continuously (TowerFall-style), not only while shooting.
- [ ] A14.16 Determinism untouched (pure shell/art); full gate + e2e green; a shell-smoke assertion confirms the four archer atlases load.

## Fixed design points

### Floating booster pickup (sim)
- New entity `BoosterState { id, x, y, contents, spawnTick }`; new `SimState.boosters: BoosterState[]` (init `[]`). New module `packages/sim/src/booster.ts` owns booster spawn-from-chest, pickup-on-contact, and the `grant()` logic (moved out of `chest.ts`).
- Step order: `updateChests` (now: open → spawn booster, **no grant**) → `updateBoosters` (overlap → grant + collect). A chest opened this tick spawns a booster that the opener can't reach the same tick (it floats `boosterFloatOffsetPx` overhead), so there is a natural travel gap — collection requires moving/jumping to the booster.
- Pickup hitbox: `BOOSTER_WIDTH`/`BOOSTER_HEIGHT` constants in `constants.ts` (geometry, not game-feel tuning). Overlap is the same wrap-aware AABB as chest contact.
- Events: `chest_opened { chestId, slot, contents }` is **kept as-is** (now means "opened, booster spawned" — the shell uses it to play the open burst); `booster_collected { boosterId, slot, contents }` is the grant moment.
- New tuning: `boosterFloatOffsetPx` (sim, ~20). Juice (shell-only, sim ignores): `boosterBobAmplitudePx` (~2), `boosterBobPeriodMs` (~1400).
- Boosters do not expire (collect-or-reset). Timed despawn is backlog.

### Shield power-up (sim)
- `ChestContents` gains `"shield"`; the chest pool gains one `"shield"` entry (equal weight). `PlayerState.shielded: boolean` (init `false`).
- `grant()` case `"shield": p.shielded = true`. Persistent charge — no `shieldTicks`, no tuning duration.
- Kill paths gate on a shared helper `consumeShield(victim, events, tick): boolean` (in `kills.ts`): if `victim.shielded` → set `false`, push `shield_blocked { slot }`, return `true` (caller skips the kill). Applied at: arrow contact ([kills.ts:41]), bomb radius ([kills.ts:82]), stomp ([kills.ts:122]). A shield-blocked arrow still transitions to `stuck` (becomes a pickup); a blocked stomp still applies the attacker bounce.
- Reset: `shielded = false` in `round.ts` alongside the power-up timer resets.
- New event `shield_blocked { tick, type: "shield_blocked", slot }`.

### Snapshot / net seam
- `snapshot.ts` `deepClone` and `SimSnapshot` extend to carry `boosters` and `shielded` (hand-written clone — add the array + field). `createSimFromSnapshot` restores them through the shared `buildSim`. `packages/net` types compile against the widened `SimState`; no wire change to the 1-byte input encoding (no new input).

### Booster / arrow / chest art (shell + assets)
- `assets/boosters.aseprite` — one 16×16 frame per content (`bomb`, `laser`, `bounce`, `invisibility`, `flight`, `shield`), exported as a tagged atlas; the shell maps `contents → frame`. Optional 2-frame glint, looped shell-side.
- `assets/shield-bubble.aseprite` — a ~20×20 ring (1–3 frame shimmer) drawn around shielded players; pop FX on `shield_blocked`.
- `assets/chest.aseprite` gains an **opened** frame; the shell draws closed for live `chests`, opened as the decoration under a floating booster (chest base = booster `y + boosterFloatOffsetPx`).
- `assets/arrow.aseprite` redrawn (dark head / wood shaft / red fletching), authored pointing +x. Renderer and per-kind tints unchanged.
- New `render/boosters.ts` (bob + wrap + opened-chest decoration + pickup burst). Shield bubble drawn in/around the archer renderer. `?rects=1` fallbacks for both.

### Per-character archers + aim poses (assets + shell)
- Four sources: `assets/archer-maks.aseprite`, `archer-igorb.aseprite`, `archer-lyosha.aseprite`, `archer-igorsh.aseprite`, each a pixel-art reading of its card (hair/outfit/palette), 16×16, same anchor/flip rules as spec 006.
- **Tag set per sheet:** `death` (no aim); and `{idle, run, jump, fall, shoot} × {base, _up45, _up, _down45}`. Authoring tip to manage volume: an Aseprite **legs** layer (locomotion) + an **arms/bow** layer (per aim direction) composited into the exported flat frames — legs are shared across aim variants.
- `render/archer.ts`: load `archer_<normalizedName>` atlas per slot (reuse `cards.ts` name normalization → new `archerAtlasKey(name)`); build anims from `frameTags`. Retire per-slot recolor for players; keep the generic recolored `archer.png` as a fallback when a named sheet is absent. ArenaScene/lobby `preload` loads the four atlases (guarded).
- Aim direction is computed **in the shell** from the per-slot live input sample (already taken each `doTick`), passed into `archers.update(...)`. Tag selected as `${selectTag(p)}${aimSuffix}` with a base-tag fallback. No `PlayerInput`/sim change — aim stays a render concern (the sim already computes fire direction from the same held keys at shoot time).

## Tasks

### PR A — gameplay (sim, headless)
**T14.1 — Floating booster pickup (sim).** Add `BoosterState` + `SimState.boosters`; `booster.ts` with spawn-from-chest, `updateBoosters` pickup-on-contact, and the moved `grant()`; `chest.ts` opens without granting; `constants.ts` booster hitbox; `boosterFloatOffsetPx` tuning + `juice` bob keys; round reset clears boosters; events `chest_opened` (kept) + `booster_collected`. Snapshot/restore + net-types updated. Update `chest.test.ts`/`powerups.test.ts`; add `booster.test.ts` (open→float→pickup, same-seed sequence, reset clears).
**Accept:** A14.1–A14.3, A14.6 (booster half), A14.7.

**T14.2 — Shield power-up (sim).** `"shield"` in `ChestContents` + pool; `PlayerState.shielded`; `grant()` case; `consumeShield` helper wired into all three kill paths; `shield_blocked` event; reset clears it; snapshot carries it. Tests: arrow/bomb/stomp each blocked once then lethal; reset clears; same-seed determinism.
**Accept:** A14.4–A14.5, A14.6 (shield half), A14.7.

### PR B — booster / arrow art + shell
**T14.3 — Booster, shield-bubble, arrow & opened-chest art.** Draw `boosters.aseprite`, `shield-bubble.aseprite`, redraw `arrow.aseprite`, add opened frame to `chest.aseprite`; `npm run export:art`; commit atlases.
**Accept:** A14.10 (and assets for A14.8/A14.9).

**T14.4 — Shell rendering (boosters, shield, arrow).** `render/boosters.ts` (icon + bob + wrap + opened-chest decoration + `booster_collected` burst); shield bubble around `shielded` players + `shield_blocked` pop; arrow renderer consumes the new sprite (unchanged logic); `?rects=1` fallbacks.
**Accept:** A14.8, A14.9, A14.11 — browser-verified.

### PR C — per-character archers + aim poses
**T14.5 — Four character sheets (art).** Author `archer-{maks,igorb,lyosha,igorsh}.aseprite` from the cards, full tag set incl. aim variants (legs/bow layered); `npm run export:art`; commit four atlases.
**Accept:** A14.12.

**T14.6 — Per-identity load + directional aim (shell).** `archerAtlasKey` name-keyed atlas load with recolor fallback; build directional anims from `frameTags`; derive aim from live input and select `${tag}${aimSuffix}` with base fallback; `preload` the four atlases.
**Accept:** A14.13–A14.15 — browser-verified all four archers + aim tracking.

**T14.7 — Verification sweep.** e2e contract for the widened `SimState` (`boosters`, `shielded`); shell-smoke asserts the four archer atlases + booster/shield atlases load; full gate + e2e green locally and in CI; golden log confirmed byte-identical.
**Accept:** A14.16, A14.7/A14.11 reconfirmed.

## Out of scope for 014
- Weighted/biased chest tables, chest variety (big/cursed), timed booster despawn — backlog.
- Shield duration/expiry or multi-hit shields — backlog (this spec ships the single-hit charge).
- A straight-down (↓) aim pose — only ↗45°/↑/↘45° are authored; pure-down maps to `_down45`.
- More power-ups (speed boost, mirror/decoy) — backlog.
- Re-arting tiles/background/HUD — unchanged this spec.
- Lobby card art changes — the cards stay as-is; this spec only *derives* in-game sprites from them.
- Animation polish (anticipation frames, hood physics) — iterate after owner review.
