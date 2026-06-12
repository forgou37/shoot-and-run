# Spec 002 — Treasure Chests, Special Arrows & Power-ups

**Goal:** Mid-round treasure chests spawn at arena-defined spots and grant either special arrows (bomb, laser, bouncing) or timed power-ups (invisibility, flight). This is the first feature to consume the seeded PRNG — chest timing/placement/contents are deterministic per seed.

**Re-scope note:** gamepads & roster were originally penciled in here; moved to spec 003 at owner direction (2026-06-12). Downstream specs renumbered (+1).

**Definition of done:** all acceptance criteria pass; a 2-player match with chests enabled plays start to finish; every new behavior is deterministic and covered by headless sim tests.

---

## Spec-level acceptance criteria

- [ ] A2.1 Chests spawn during a round at free `chestSpots` from the arena file, on a fixed interval, capped by `maxChestsAlive`; spot and contents are chosen via the sim PRNG — same seed ⇒ identical chest sequence (sim test).
- [ ] A2.2 Touching a chest opens it: contents granted instantly, `chest_opened` event, chest removed.
- [ ] A2.3 Quiver is typed: special arrows go to the FRONT of the quiver and are fired first; picked-up stuck arrows retain their kind. `arrow_fired` carries the kind.
- [ ] A2.4 **Bomb arrow:** explodes on first contact (tile or player) — never sticks; kills every player whose center is within `bombRadiusPx` (cause `"bomb"`, including the shooter); emits `arrow_exploded`.
- [ ] A2.5 **Laser arrow:** flies straight (no gravity), passes through the first contiguous obstacle, embeds in the second; kills every player it touches along the way (does not stop on a kill).
- [ ] A2.6 **Bouncing arrow:** reflects off walls/floor/ceiling up to `arrowBounceCount` (5) times at full speed, sticks on the following contact; kills like a normal arrow.
- [ ] A2.7 **Invisibility:** for `invisibilityDurationMs` (10 s) the player renders at `juice.invisibilityOpacity` (20%); sim tracks the timer, shell renders the alpha.
- [ ] A2.8 **Flight:** for `flightDurationMs`, every jump press grants an air impulse (`flapVelocity`) with no ground/coyote requirement — repeated tapping flies.
- [ ] A2.9 All new knobs live in `content/tuning.json` (sim keys flat, render-side opacity in `juice`), hot-reloadable.
- [ ] A2.10 Arena schema gains optional `chestSpots`, validated like spawns (bounds, not-in-solid, on-ground); arena-001 gets 3 spots. Arenas without spots simply never spawn chests (all 000-era fixtures stay valid).
- [ ] A2.11 Determinism preserved: golden log regenerated once (consciously — `arrow_fired` payload gains `kind`), then byte-identical across runs; full headless suite green; e2e suite green.

## Fixed design points

- `ArrowKind = "normal" | "bomb" | "laser" | "bounce"`. `PlayerState.arrows: number` becomes `PlayerState.quiver: ArrowKind[]` (count = length). Chests grant `specialArrowsPerChest` of a kind, pushed to the front.
- Chest contents pool (equal weights for now): bomb arrows, laser arrows, bounce arrows, invisibility, flight.
- Chest entity: 10×8 px, opened by player AABB contact (wrap-aware). Events: `chest_spawned { chestId, x, y, contents }`, `chest_opened { chestId, slot, contents }`.
- Laser semantics: "obstacle" = contiguous solid run. Tracked by center-point sampling (arrow speed ≪ tile size, no tunneling): entering solid the first time = piercing; after exiting, the next solid entry embeds it (stuck, collectable).
- Flight does not stack with itself (re-collect refreshes the timer); invisibility likewise. Both cleared on death/round reset.
- New tuning keys: `chestIntervalMs` 8000, `maxChestsAlive` 2, `specialArrowsPerChest` 3, `bombRadiusPx` 28, `arrowBounceCount` 5, `invisibilityDurationMs` 10000, `flightDurationMs` 10000, `flapVelocity` 220. Juice: `invisibilityOpacity` 0.2, `bombBurstParticles` 48.

## Tasks

### T2.1 — Quiver refactor (sim)
`quiver: ArrowKind[]` replaces the ammo count; firing pops the front; stuck-arrow pickup pushes its kind to the front; `arrow_fired` gains `kind`. All existing tests updated; golden log consciously regenerated.
**Accept:** suite green; quiver order verified (special-first), kind preserved through stick→pickup.

### T2.2 — Special arrow behaviors (sim)
Bomb (contact explosion, radius kill cause `"bomb"`, `arrow_exploded`, no stick), laser (no gravity, pierce first contiguous obstacle, embed in second, piercing multi-kill), bounce (reflect on axis hits up to 5, then stick).
**Accept:** sim tests per A2.4–A2.6, including a laser multi-obstacle case and a bounce-count case.

### T2.3 — Chests (sim + content)
Arena schema `chestSpots` + validation; spawn scheduler (fixed interval, PRNG spot/contents, alive cap, only free spots); open-on-contact granting; round reset clears chests; arena-001 gains 3 spots.
**Accept:** A2.1, A2.2, A2.10; same-seed chest-sequence test.

### T2.4 — Power-ups (sim)
`invisibleTicksLeft` / `flightTicksLeft` on players; flight flap (jump press while airborne ⇒ `-flapVelocity`); timers decrement, cleared on death/reset.
**Accept:** A2.7 timer behavior, A2.8 flap test (gains height with taps mid-air only while active).

### T2.5 — Shell: rendering & juice
Chests as gold rects; arrows tinted by kind (flying and stuck); invisible players at `juice.invisibilityOpacity`; quiver dots above each player's head colored by kind; bomb explosion uses a bigger burst + shake.
**Accept:** A2.7 visual, browser-verified chest + tinted arrows; no console errors.

### T2.6 — Verification sweep
e2e contract (`test-api.d.ts`, content test) updated for `quiver`; golden regenerated; full gate + e2e green locally and in CI; browser sanity pass.
**Accept:** A2.11.

## Out of scope for 002

- Gamepads, 3–4 players, menus/lobby — **spec 003** (moved, was here).
- Chest opening animation/lid physics, chest variety (big/cursed) — backlog.
- Tile destruction by bombs — backlog (sim tiles are static this spec).
- Arrow-vs-arrow deflection, catching — backlog.
- Weighted/biased chest content tables — equal weights now; revisit with playtesting.
- More power-ups (shield, speed) — backlog.
