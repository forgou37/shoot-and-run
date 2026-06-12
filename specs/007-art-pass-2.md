# Spec 007 — Art pass II: jungle environment & arrow sprites

**Goal:** The level gets complete jungle-themed graphics — tileset, full-screen background, a new denser arena — and arrows become directional sprites. Same pipeline as 006: Claude draws in Aseprite via MCP, sources in `assets/`, committed exports, sim untouched.

**Scope note (owner direction, 2026-06-13):** owner requested "complete level graphics — jungle theme, more obstacles" and "arrow sprite and its direction changes", skipping the usual pre-spec review. 006's art-pass-II leftovers not needed for that (HUD sprites, FX art, visual-regression screenshots) stay in backlog. Chest sprite is included — chests spawn in the level, so level graphics aren't complete without it.

**Definition of done:** the game boots into the jungle arena with tiled platforms, background, sprite arrows and chests; `?rects=1` still shows the full rect debug view; golden determinism log untouched; full gate + e2e green.

---

## Spec-level acceptance criteria

- [ ] A7.1 Jungle tileset, 320×240 background, chest and arrow sprites exist as `assets/*.aseprite` sources; `npm run export:art` regenerates their committed atlases in `packages/game/public/assets/`.
- [ ] A7.2 New arena `content/arenas/arena-002.json` ("canopy"): noticeably more obstacles than crossfire, 4 valid spawns, ≥3 chest spots, passes `parseArena`; covered by the content test; the shell boots into it (e2e arena assertion updated consciously). arena-001 is untouched — sim tests and the golden log keep using it.
- [ ] A7.3 Solid tiles render from the tileset, frame chosen per tile by a wrap-aware exposure mask (open-above ⇒ grass top, open-left/right ⇒ capped edges); cosmetic vines hang below platforms, chosen by a deterministic hash of tile position (no RNG); the background image sits behind everything; `?rects=1` keeps rect tiles and no background.
- [ ] A7.4 Flying arrows render as the arrow sprite rotated to their velocity direction (`atan2(vy, vx)`), updated as gravity/bounces change it; stuck arrows keep their final flight angle; special kinds are tinted with the existing kind colors (normal stays natural); wrap mirrors drawn at edges; `?rects=1` keeps rect arrows.
- [ ] A7.5 Chests render as the chest sprite (rect in `?rects=1`).
- [ ] A7.6 Shell-only + content-only change: `packages/sim/src` untouched; golden determinism log byte-identical; full gate + e2e green locally and in CI.

## Fixed design points

- **Tileset frames** (16×16, one tag per frame): `grass`, `grass-l`, `grass-r`, `grass-lr`, `dirt`, `dirt-l`, `dirt-r`, `dirt-lr`, plus `vine-a`, `vine-b` decorations. Mask: open-above selects grass vs dirt; open-left/right selects the `-l/-r/-lr` cap. Neighbor checks wrap at arena edges (an edge tile's off-screen neighbor is the opposite edge, matching sim physics).
- **Vines** are pure decoration (never solid, never in sim): under a solid tile with open space below, `(col * 7 + row * 13) % 5 === 0` hangs `vine-a`, `% 5 === 2` hangs `vine-b` — deterministic, no shell RNG.
- **Arrow sprite** drawn pointing right (16×16: head, shaft, cream fletching). Tint = existing `ARROW_COLORS` for bomb/laser/bounce; normal untinted. The shell tracks each arrow's last flight angle by id for the stuck pose (sim zeroes velocity on stick); the map is pruned as arrows despawn.
- **Background** is one 320×240 frame loaded as a plain image at depth below tiles; kept dark/low-contrast so sprites read.
- **Arena-002 "canopy"** is the shell's boot arena (still hardcoded import — arena select stays deferred to a future spec). Layout: symmetric, denser than crossfire (~9 platform groups vs 4), wrap-friendly bottom gaps preserved.
- **No new tuning keys.** All art timing/choices are art data or fixed cosmetic mapping.

## Tasks

### T7.1 — Jungle environment art
`jungle-tiles.aseprite` (10 tagged frames), `jungle-bg.aseprite` (320×240), `chest.aseprite`; export; commit sources + atlases.
**Accept:** A7.1 (arrow source lands in T7.4).

### T7.2 — Arena-002 "canopy" (content)
Author the layout (more obstacles, 4 spawns, 3 chest spots); add to the content validation test. Shell still boots arena-001 in this commit.
**Accept:** A7.2 validation half.

### T7.3 — Jungle renderer (shell)
Background image + tile sprites by exposure mask + vines; shell switches to arena-002; chest sprite; e2e arena assertion updated; `?rects=1` fallback intact.
**Accept:** A7.2 boot half, A7.3, A7.5 — browser-verified.

### T7.4 — Arrow sprite & rotation (shell)
`arrow.aseprite` + export; ArrowRenderer: rotation from velocity, stuck-angle hold, kind tints, wrap mirrors, pickup/despawn cleanup; rects fallback.
**Accept:** A7.4 — browser-verified (fire all 8 directions, arc visible, stuck angles held).

### T7.5 — Verification sweep
Full gate + e2e locally and CI; golden log confirmed untouched; CLAUDE.md/backlog updated (007 row, decisions log entry for the jungle-arena default).
**Accept:** A7.6.

## Out of scope for 007

- HUD/UI sprites, FX/particle art, kill-burst art — art pass III / backlog.
- Animated tiles (swaying vines, water) — backlog.
- Arena select UI — spec 003+ territory (deferred there).
- Visual regression screenshots — backlog (revisit after this pass).
- Any sim change whatsoever.
