# Spec 006 — Art pass I: sprite pipeline & player animation

**Goal:** Players render as the animated archer sprite instead of colored rects, driven by sim state and events; a reproducible asset pipeline exists (Aseprite source → scripted export → committed atlas → Phaser). Tiles, arrows, chests, FX, and HUD keep their placeholder rendering.

**Numbering note:** 003–005 are reserved by the roadmap (roster, bots, AI pipeline). The art pass is independent of all three — its gate (000–002 done) is satisfied — so it takes the next free number and may land before or alongside 003.

**Workflow note (decision):** pixel art is generated in-session by Claude driving Aseprite via MCP, with the owner as art director (amends the backlog's "owner does art"; owner direction 2026-06-12). The first asset already exists: `assets/archer.aseprite` — 16×16, 19 frames, tags `idle / run / jump / fall / shoot / death`, P1-blue ramp.

**Definition of done:** all acceptance criteria pass; a 2-player match plays start to finish with animated archers (run, jump, shoot, die, corpse, reset); full gate + e2e green; `packages/sim` untouched.

---

## Spec-level acceptance criteria

- [ ] A6.1 Asset pipeline: `.aseprite` sources live in `assets/`; `npm run export:art` (Aseprite CLI batch) regenerates every committed atlas (PNG + Aseprite-JSON with frame tags and durations) into `packages/game/public/assets/`; same source ⇒ identical output; exports are committed (CD stays a static build, CI never needs Aseprite).
- [ ] A6.2 Players render from the archer atlas with a per-slot palette: the canonical sheet's P1 ramp is recolored at texture-load time from each slot's `players.json` color; P1 renders the sheet as-is.
- [ ] A6.3 Locomotion animation is selected from current-tick sim state per the fixed mapping below; `facing` drives horizontal flip; the 16×16 sprite is anchored bottom-center to the 12×12 hitbox's bottom-center; positions stay interpolated exactly as today.
- [ ] A6.4 `shoot` plays once per `arrow_fired` (then locomotion resumes); `death` plays once per `player_killed` and holds its final lying frame as a corpse until the round restarts; both are cosmetic one-shots timed by their own frame durations.
- [ ] A6.5 Invisibility still renders the player at `juice.invisibilityOpacity` (now applied to the sprite).
- [ ] A6.6 `?rects=1` URL param restores the full rect renderer (hitbox-true debug view); placeholder rendering for arrows/chests/tiles is unchanged in both modes.
- [ ] A6.7 Shell-only change: golden determinism log untouched; full gate + e2e green with one added shell-smoke assertion (archer texture present after boot). No new tuning keys — frame timing is art data inside the `.aseprite`, not game-feel tuning.

## Fixed design points

- **Asset layout.** Sources: `assets/*.aseprite` (one file per sprite, tags per animation). Exports: `packages/game/public/assets/<name>.png` + `<name>.json`, generated only by `npm run export:art`, never hand-edited. The current `assets/export/` files move there in T6.1.
- **Animation selection** (evaluated per render frame from the current sim tick):
  1. `!alive` → `death` (one-shot, hold last frame)
  2. shoot one-shot still playing → `shoot`
  3. airborne: `vy < 0` → `jump`, else `fall`
  4. grounded, `|vx| > 1` → `run`
  5. otherwise → `idle`
- **Flip.** Sprite is drawn facing right; `facing === -1` sets `flipX`. No mirrored frames in the sheet.
- **Anchor.** Origin (0.5, 1) placed at `(x, y + PLAYER_HEIGHT / 2)`: feet sit on the hitbox bottom; the sprite overflows 2 px per side and 4 px above — visual only, hitboxes unchanged.
- **Palette swap.** One canonical sheet; per-slot textures derived once at load by exact-match recolor of the P1 ramp `{#2d7fc4, #4fc3f7, #a8e6ff}` → slot ramp computed in HSL from the slot's `players.json` color (base = slot color, shadow ≈ −22 % lightness, highlight ≈ +22 %). Slots 2–3 get this for free when 003 adds them. Rejected: pre-exporting one sheet per slot (4× asset upkeep for a cosmetic transform).
- **Corpse.** The death one-shot ends lying flat; that frame persists through the round-end pause (replaces hiding the player). `round_started` resets everyone to `idle`. Kill-burst particles unchanged.
- **Rect renderer stays.** It remains the debug view (`?rects=1`) and the only renderer for everything that isn't a player this spec.

## Tasks

### T6.1 — Asset pipeline
`assets/` layout as specced; `npm run export:art` via Aseprite CLI; move existing exports to `packages/game/public/assets/`; commit archer source + exports; CLAUDE.md commands table + project structure updated in the same commit.
**Accept:** A6.1.

### T6.2 — Player sprite rendering (shell)
Atlas load, animations created from `frameTags` + durations, locomotion mapping, flip, anchor, per-slot recolor, invisibility alpha on the sprite, `?rects=1` fallback.
**Accept:** A6.2, A6.3, A6.5, A6.6 — browser-verified with both players moving.

### T6.3 — Event one-shots (shell)
`shoot` on `arrow_fired`; `death` on `player_killed` + corpse hold through the restart pause; interaction rules per the selection order above.
**Accept:** A6.4 — browser-verified 2P kill and reset.

### T6.4 — Verification sweep
e2e smoke gains the texture-loaded assertion; full gate + e2e green locally and in CI; golden log confirmed untouched.
**Accept:** A6.7.

## Out of scope for 006

- Tiles, arrows, chests, FX, HUD/UI sprites — **art pass II**, specced after the owner reviews players in motion.
- Animation polish passes (anticipation frames, hood physics, more run frames) — iterate inside art pass II.
- Visual regression screenshots — backlog (revisit after art pass II).
- Corpse physics tumble — backlog (unchanged).
- Running Aseprite in CI — exports are committed precisely so CI never needs it.
