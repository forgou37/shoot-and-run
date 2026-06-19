# Spec 019 — Character abilities (character-specific booster)

**Goal:** A new chest item, the **character booster**. Collecting its floating booster grants the collecting player an ability **unique to the character they are playing** (their `slot` identity from `content/players.json`). Four abilities, one per character:

- **Maks** (slot 0) — *"Blackout"*: the screen goes dark for 10 s; every **other** player is lit by a circle of light, Maks stays faintly visible. Pure visual — no gameplay change.
- **Igor B** (slot 1) — *"No homo"*: a 30 s shield that makes him immune to **head-stomps** and to **any kill whose source is within 16 px** (point-blank arrows, adjacent bombs). A rainbow-circle-with-a-bar indicator floats above his head while it lasts.
- **Lyosha** (slot 2) — *"Get things done"*: 3 **auto-aim (`seeker`) arrows**. A fired seeker locks the nearest enemy, ignores gravity, and homes in at **0.75×** normal arrow speed; otherwise it sticks/kills/dissolves-walls like a normal arrow.
- **Igor Sh** (slot 3) — *"Where am I?"*: 3 charges of **phasing** for 1 s each (spent with the **build** button). While phasing, arrows pass through him without harm and he renders nearly invisible.

This promotes an owner-requested item from the backlog into a numbered spec (hard rule 1). It is gameplay + a little shell render work, independent of netcode.

**Numbering note:** 019 is the next free number (000–004, 006–008, 013–018 taken; 005 and 009–012 reserved by their roadmaps).

## Owner-confirmed design points (2026-06-19)

- **Character identity == `slot`.** Lobby character-select (spec 017) only chooses which slot/card a player occupies; `players.json` fixes slot 0 = Maks, 1 = Igor B, 2 = Lyosha, 3 = Igor Sh. The ability is therefore keyed by `slot`. (Trade-off: couples ability→`players.json` order. Accepted for the four fixed characters; revisit if the roster ever grows.)
- **One chest item.** A single new `ChestContents` value `"character"` (equal weight in the pool, one booster icon). `grant()` dispatches on the collector's `slot` to apply the right ability. There is **no** standalone `seeker` chest drop — seeker arrows only enter Lyosha's quiver via the character grant.
- **Triggers.** Igor B's shield and Maks's blackout start **on pickup** (passive, like invisibility/flight). Lyosha's seekers go to the quiver and are fired with **shoot**. Igor Sh's three phase charges are spent with the existing **build** button (one charge per press).
- **No input-wire / `PROTOCOL_VERSION` change.** The input byte is full (build = bit 7). We reuse `build`; we add no new action bit. New `PlayerState`/`ArrowState` fields ride along inside the JSON snapshot, exactly as specs 014/018 did.
- **No new SimEvents.** The shell drives every ability off readable state (`booster_collected` already says which slot, and slot ⇒ character) plus the new timers/charges. (Adding event *types* would be safe — the golden event log only contains the bot round, which never spawns chests — but none are needed.)
- **Igor B shield strength:** stomp immunity **plus** negation of any kill whose source is within `noHomoRadiusPx` (16). Bombs detonating farther than 16 px still kill.
- **Igor Sh phase:** negates **arrow** kills only (stomps still land — "arrows go through him"). Phase-vs-build precedence: a held phase charge is consumed **first**, so building a wall is skipped on a tick that triggers a phase.
- **Lyosha seeker tracking:** perfect lock-on (re-steers straight at the locked target every tick) at `seekerSpeedFactor`×`arrowSpeed`, gravity ignored. A turn-rate cap is backlog.
- **On-death / round-reset:** every new timer/charge clears on death and round reset, following the existing invisibility/flight/shield/wall convention. (So Maks's blackout ends if Maks dies mid-effect — consistent with the established rule.)

**Definition of done:** all acceptance criteria pass; a 2–4 player match plays start to finish with character boosters dropping from chests and each of the four characters using its ability; sim changes are deterministic and headless-tested; the golden **event** log is byte-identical and the golden **state-hash** file is consciously regenerated (shape change only) for each phase that adds a state field; full gate + e2e green; works both local-couch and online.

---

## Spec-level acceptance criteria

Grouped by phase. Each phase is one PR (it may sub-split into a sim PR + a shell PR like spec 018 if smaller PRs are preferred).

### Phase 1 — Foundation + Igor B "No homo" shield

- [ ] A19.1 **`"character"` is a new `ChestContents`** (equal weight in `CHEST_CONTENTS_POOL`). Collecting a character booster runs `grant()`, which dispatches on the collector's `slot` to a per-character apply step (`grantCharacterAbility`). Unknown slots are a no-op.
- [ ] A19.2 `PlayerState` gains `noHomoTicksLeft: number` (init 0). Granting Igor B's ability sets it to `noHomoTicks` (from `noHomoDurationMs`). It decrements each tick in `updatePlayer`; cleared on death and round reset.
- [ ] A19.3 While `noHomoTicksLeft > 0`, the player is immune to **stomp** kills and to **any** kill (arrow/bomb) whose killing source is within `noHomoRadiusPx` (16) of the victim's center (wrap-aware). The hit otherwise resolves as normal for the attacker (a blocked arrow still sticks, a stomp still bounces) — same shape as `consumeShield`, but distance-gated and non-consuming (it is a timer, not a charge).
- [ ] A19.4 **Determinism + carry:** snapshot/restore round-trips `noHomoTicksLeft`; the golden **event** log is byte-identical (no chest spawns in the bot round); the golden **state-hash** file is regenerated consciously (`UPDATE_GOLDEN=1`) for the new `PlayerState` field + `"character"` in the pool. `packages/net` re-sims correctly.
- [ ] A19.5 **Shell:** the `"character"` booster gets a distinct 16×16 icon (new frame in `boosters.aseprite`, `npm run export:art`, committed) with a `?rects=1` fallback. A rainbow-circle-with-a-diagonal-bar indicator (per the owner reference image) floats above an Igor-B player while `noHomoTicksLeft > 0` (wrap-mirrored like the shield bubble). No console errors.
- [ ] A19.6 Verified end-to-end (local + online): an Igor-B player collects the character booster, survives a stomp and a point-blank arrow for the duration, shows the indicator, then loses immunity when it expires.

### Phase 2 — Maks "Blackout"

- [ ] A19.7 `PlayerState` gains `blackoutTicksLeft: number` (init 0). Granting Maks's ability sets it to `blackoutTicks` (from `blackoutDurationMs`); decrements in `updatePlayer`; cleared on death/round reset. **No gameplay effect** — movement, kills, and arrows are unchanged.
- [ ] A19.8 **Shell:** while any player's `blackoutTicksLeft > 0`, the arena renders darkened (a near-black overlay above the environment/entities) with a circle of light cut around **every other** player and a faint light around Maks, so other players read clearly and Maks stays slightly visible. The darkness lifts when the timer ends.
- [ ] A19.9 **Determinism + carry:** snapshot/restore round-trips `blackoutTicksLeft`; golden event log byte-identical; state-hash regenerated consciously; net re-sim correct.
- [ ] A19.10 Verified end-to-end (local + online): a Maks player collects the booster, the screen darkens for ~10 s with lit opponents, then returns to normal.

### Phase 3 — Igor Sh "Where am I?" (phase-dodge)

- [ ] A19.11 `PlayerState` gains `phaseChargesLeft: number` (init 0) and `phaseTicksLeft: number` (init 0). Granting Igor Sh's ability adds `phaseCharges` (3) to `phaseChargesLeft`.
- [ ] A19.12 On a **build**-press edge, if `phaseTicksLeft === 0 && phaseChargesLeft > 0`, spend one charge and set `phaseTicksLeft = phaseTicks` (from `phaseDurationMs`). This runs **before** wall building and consumes the build edge, so no wall is built on that tick. `phaseTicksLeft` decrements in `updatePlayer`; both fields clear on death/round reset.
- [ ] A19.13 While `phaseTicksLeft > 0`, `checkArrowKills` skips this player (arrows pass through without harm; the arrow keeps flying / is unaffected). Stomps and bombs are unaffected (arrows only, per the confirmed scope).
- [ ] A19.14 **Determinism + carry:** snapshot/restore round-trips both fields; golden event log byte-identical; state-hash regenerated consciously; net re-sim correct.
- [ ] A19.15 **Shell:** an Igor-Sh player renders at `juice.invisibilityOpacity` while `phaseTicksLeft > 0` (reusing the invisibility alpha path), with a small charge indicator (remaining `phaseChargesLeft`) near the player. No console errors.
- [ ] A19.16 Verified end-to-end (local + online): an Igor-Sh player collects the booster, presses build to phase, an arrow passes through harmlessly during the 1 s, and the charge count drops; phasing while holding wall charges does not build a wall.

### Phase 4 — Lyosha "Get things done" (auto-aim arrows)

- [ ] A19.17 `ArrowKind` gains `"seeker"`. `ArrowState` gains `targetSlot: number` (`-1` = unacquired/none; meaningful only for seekers). Granting Lyosha's ability pushes `seekerArrowsPerPickup` (3) `"seeker"` arrows to the front of the quiver. Picked-up stuck seekers retain their kind (like laser/bomb).
- [ ] A19.18 A new step `steerSeekers(arrows, players, t, friendlyFire)` runs in `step()` **before** `updateArrows`: for each flying seeker, (re)acquire the nearest **alive, non-spared** enemy (wrap-aware distance, tie-break lowest slot; skip the owner; respect friendly-fire), store it in `targetSlot`, and set the arrow's velocity to `unit(toTarget) × arrowSpeed × seekerSpeedFactor`. With no valid target, the seeker keeps its current heading.
- [ ] A19.19 In `updateArrows`, a `"seeker"` moves **without gravity** (straight-line integration like a ballistic move but skipping the `arrowGravity` step), sticks on tile contact, kills a touched player like a normal arrow (cause `"arrow"`, then sticks → pickup), and dissolves a wall on its swept path like any arrow (the wall sweep is already kind-generic).
- [ ] A19.20 **Determinism + carry:** target selection and steering are fully deterministic (pure functions of state + tuning); snapshot/restore round-trips `targetSlot`; `arrow_fired.kind` may be `"seeker"`; golden event log byte-identical (bot round fires only `normal`); state-hash regenerated consciously for the new `ArrowState` field; net re-sim correct.
- [ ] A19.21 **Shell:** a seeker arrow gets a distinct sprite/tint (flying and stuck), wrap-mirrored like the other arrows; quiver dots include the seeker color. No console errors.
- [ ] A19.22 Verified end-to-end (local + online): a Lyosha player collects the booster, fires a seeker that curves toward and kills a moving opponent, and a seeker that misses sticks and is collectable.

---

## Fixed design points

### Acquisition, dispatch & reset (sim, all phases)
- `ChestContents` union gains `"character"`; `CHEST_CONTENTS_POOL` gains `"character"` (equal weight). `ArrowKind` gains `"seeker"` (Phase 4), but `"seeker"` is **not** added to `ChestContents`/the pool.
- `grant()` (in `booster.ts`) gets a `case "character"` → `grantCharacterAbility(p, t)`, a small `switch (p.slot)` mapping 0→blackout, 1→noHomo, 2→seekers, 3→phase charges. Documented as keyed to `players.json` slot order.
- Round reset (`round.ts` `resetPlayer` + the reset block) clears `noHomoTicksLeft`, `blackoutTicksLeft`, `phaseChargesLeft`, `phaseTicksLeft`; `createSim`/`createSimFromSnapshot` init them. All four also clear on death (same place invisibility/flight do).

### Kill gates (sim)
- **No-homo (Phase 1):** a helper `protectedByNoHomo(victim, sourceX, sourceY)` returns true when `victim.noHomoTicksLeft > 0` and either the cause is a stomp or `wrap-dist(victim, source) ≤ noHomoRadiusPx`. Wired into `checkArrowKills` (source = arrow position), `resolveExplosions` (source = bomb position), and `checkStomps` (cause = stomp ⇒ always within range). On block: skip the kill, but let the arrow stick / the attacker bounce, exactly as the existing shield path does (it does **not** consume a charge — it's a timer).
- **Phase (Phase 3):** `checkArrowKills` skips a victim with `phaseTicksLeft > 0` before the overlap test.

### Timers, charges & step order (sim)
- New `PlayerState` fields: `noHomoTicksLeft`, `blackoutTicksLeft`, `phaseTicksLeft` (all decremented in `updatePlayer` alongside `invisibleTicksLeft`/`flightTicksLeft`), `phaseChargesLeft` (a count, not decremented by time). `prevBuildHeld` already exists.
- Phase activation: a new step (e.g. `handlePhase`) runs in `step()` **before** `handleBuilding`. For an alive player with a build-press edge, `phaseChargesLeft > 0`, and `phaseTicksLeft === 0`: start the phase and mark the build edge consumed (update `prevBuildHeld`) so `handleBuilding` sees no edge that tick. Otherwise leave the edge for `handleBuilding`. Only one of the two updates `prevBuildHeld` per player per tick.
- Seeker steering: `steerSeekers(...)` runs **before** `updateArrows`. `handleShooting` sets `targetSlot = -1` for newly fired seekers (and `-1` for every other kind); acquisition happens in `steerSeekers`. `updateArrows` skips the gravity line for `kind === "seeker"`.

### Tuning (`content/tuning.json` + `Tuning`)
| Key | Default | Notes |
|---|---|---|
| `noHomoDurationMs` | 30000 | duration → `noHomoTicks` in `derive` |
| `noHomoRadiusPx` | 16 | distance, not a duration — no derive |
| `blackoutDurationMs` | 10000 | duration → `blackoutTicks` |
| `phaseDurationMs` | 1000 | duration → `phaseTicks` |
| `phaseCharges` | 3 | integer ≥ 1, no derive |
| `seekerSpeedFactor` | 0.75 | multiplier on `arrowSpeed`, no derive |
| `seekerArrowsPerPickup` | 3 | integer ≥ 1, no derive (like `specialArrowsPerChest`) |

`juice` (shell-only): `blackoutDarknessAlpha`, `blackoutLightRadiusPx`, `blackoutMaksLightRadiusPx` (Phase 2). Phase render reuses `invisibilityOpacity`.

### Shell render (per phase)
- **Phase 1:** new `"character"` frame in `assets/boosters.aseprite` (+ `?rects=1` fallback color); a rainbow-bar indicator drawn over an Igor-B player while no-homo is active. Generate the indicator texture procedurally at boot (Phaser `Graphics` → `generateTexture`, like the `px`/shield textures) to avoid a new art asset, or commit a small `assets/no-homo.png` loaded via `loader.image` (parity with `shield-bubble.png`).
- **Phase 2:** a darkness layer over the arena with per-other-player light cutouts (render-texture mask or additive-blend spotlights), driven by `blackoutTicksLeft > 0`. Faint light on Maks. The novel render piece — isolated, no gameplay coupling.
- **Phase 3:** low-alpha player render during phase (reuse the invisibility path) + a charge pip; no new asset required.
- **Phase 4:** seeker arrow sprite/tint in the arrow renderer + quiver-dot color.

### Net / determinism (all phases)
- No codec or `PROTOCOL_VERSION` change (input byte unchanged; we reuse `build`). Snapshots ship as `JSON.stringify(snapshot)`, so new `PlayerState`/`ArrowState` fields ride along and the rollback path re-sims them.
- Golden **event** log stays byte-identical every phase (the bot golden round ends before any chest spawns, so no character code runs — same reasoning as spec 018's "wall" pool addition).
- Golden **state-hash** file is regenerated consciously per phase that adds a state field (Phases 1–4), via `UPDATE_GOLDEN=1`. A shape change, not a determinism regression.

---

## Tasks

### Phase 1 — Foundation + Igor B (PR 1)
- **T19.1 — Character-booster framework + no-homo (sim).** `"character"` in `ChestContents` + pool; `grant()` slot-dispatch (`grantCharacterAbility`); `PlayerState.noHomoTicksLeft` + decrement + death/reset clear; `protectedByNoHomo` gate wired into `checkArrowKills`/`resolveExplosions`/`checkStomps`; `noHomoDurationMs`/`noHomoRadiusPx` tuning (+ `noHomoTicks` derive); `createSim`/snapshot/restore carry the field. Tests: grant sets timer; stomp + ≤16px arrow + adjacent bomb blocked, >16px bomb kills; timer expiry restores vulnerability; same-seed determinism; reset clears; state-hash regen. **Accept:** A19.1–A19.4.
- **T19.2 — Booster icon + no-homo indicator (shell).** `"character"` frame in `boosters.aseprite` (+ fallback); `export:art`; commit. Rainbow-bar indicator over an Igor-B player while active (wrap-mirrored). Browser-verified. **Accept:** A19.5, A19.6.

### Phase 2 — Maks blackout (PR 2)
- **T19.3 — Blackout timer (sim).** `PlayerState.blackoutTicksLeft` + grant + decrement + death/reset clear; `blackoutDurationMs`/`blackoutTicks`; snapshot/restore; state-hash regen. Tests: grant sets timer, no gameplay effect, reset/death clears, determinism. **Accept:** A19.7, A19.9.
- **T19.4 — Darkness + spotlights (shell).** Darkness overlay with light cutouts on other players + faint Maks light, driven by `blackoutTicksLeft`; `juice` knobs. Browser-verified local + online. **Accept:** A19.8, A19.10.

### Phase 3 — Igor Sh phase (PR 3)
- **T19.5 — Phase charges + activation + arrow pass-through (sim).** `PlayerState.phaseChargesLeft`/`phaseTicksLeft` + grant; `handlePhase` before `handleBuilding` (build edge → spend charge, suppress wall); `checkArrowKills` skip while phasing; decrement + death/reset clear; `phaseDurationMs`/`phaseCharges` tuning; snapshot/restore; state-hash regen. Tests: build edge consumes charge + suppresses wall; arrow passes through while phasing; precedence with wall charges; expiry/reset; determinism. **Accept:** A19.11–A19.14.
- **T19.6 — Phase render (shell).** Low-alpha player during phase + charge pip. Browser-verified. **Accept:** A19.15, A19.16.

### Phase 4 — Lyosha seekers (PR 4)
- **T19.7 — Seeker arrow (sim).** `ArrowKind "seeker"`; `ArrowState.targetSlot`; grant pushes 3 seekers; `steerSeekers` (deterministic target acquisition + perfect-lock steering, wrap-aware, FF-aware) before `updateArrows`; gravity skipped for seeker in `updateArrows`; `seekerSpeedFactor`/`seekerArrowsPerPickup` tuning; `handleShooting` sets `targetSlot=-1`; snapshot/restore; state-hash regen. Tests: target = nearest live enemy (tie-break slot); homes toward a moving target; ignores gravity; sticks on tile and becomes a pickup retaining kind; kills on contact; dissolves a wall; FF spares teammates; determinism. **Accept:** A19.17–A19.20.
- **T19.8 — Seeker render (shell).** Distinct seeker sprite/tint (flying + stuck) + quiver-dot color, wrap-mirrored. Browser-verified. **Accept:** A19.21, A19.22.

Each phase's final task also updates `CLAUDE.md` (booster list, new sim fields/steps, tuning keys), appends a `docs/DECISIONS.md` row, and trims the backlog entry — in the same PR (per the docs-in-the-same-commit rule).

## Out of scope for 019 (→ backlog)
- Seeker turn-rate limiting / dodgeable homing; multiple targeting modes; seeker re-acquire policy beyond "nearest live enemy".
- Bot use of abilities (a bot Igor Sh won't phase — bots sample `build:false`; a bot Lyosha still fires seekers via shoot; a bot Igor B/Maks still benefit from on-pickup effects).
- Per-character ability balancing/rarity tables; weighted chest tables to bias the character drop rate.
- Igor Sh phase also dodging stomps/bombs (this spec: arrows only).
- Blackout behavior in online spectator/observer views beyond the normal client render; blackout persisting past Maks's death.
- Ability SFX, cooldowns, stacking rules beyond "re-collect refreshes/adds" (mirrors invisibility/flight/wall).
- A dedicated ability button / second input byte (kept out to avoid a wire/protocol change).
