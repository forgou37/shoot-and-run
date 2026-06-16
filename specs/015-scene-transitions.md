# Spec 015 — Scene transitions (fade flow)

**Goal:** Every scene change in the shell — title → lobby/online, lobby → match, online-join → match, pause → lobby/title, and the online error/back paths — currently hard-cuts via an instant `scene.start()`. Replace those cuts with a short **fade-through-black** so the game reads as one cohesive product instead of a set of disconnected screens. The very first screen after boot fades in from black too.

**Numbering note:** 008–013 are reserved by the netcode roadmap (CLAUDE.md netcode decision, 2026-06-14); 014 is the last gameplay/art spec. This is shell-only UX, independent of both, so it takes the next free number, 015. It promotes a new idea (scene transitions) straight into a numbered spec per hard rule 1 — the item was not previously in `specs/backlog.md`.

**Scope note:** this is the first of several "game feel / flow" polish items discussed with the owner (transitions, round/match ceremony, living title screen, arena ambiance, combat hit-flash, HUD identity). This spec ships **only transitions**; the rest stay in the backlog until promoted.

**Definition of done:** all acceptance criteria pass; every scene-to-scene navigation fades out to black and the incoming scene fades in; the first visible screen fades in from black on load; the fade covers the canvas **and** the DOM overlays (lobby cards, online input field); transition duration lives in `content/tuning.json`; pure shell change — sim, determinism, and the golden log are untouched; full gate + e2e green.

---

## Spec-level acceptance criteria

- [ ] A15.1 A single full-viewport DOM fade overlay sits **above every layer** — the Phaser canvas and both existing DOM overlays (lobby cards `z-index: 10`, online input `z-index: 20`). It is `pointer-events: none` so it never eats input.
- [ ] A15.2 Leaving a scene fades the overlay 0 → opaque over `ui.transitionMs`, then performs the `scene.start(...)` (with the same data payload as today). Re-entrant calls while a fade is already running are ignored (a confirm can't fire two transitions).
- [ ] A15.3 Entering a scene fades the overlay opaque → 0 in its `create()`, revealing the new screen. The net effect is a fade-through-black hand-off.
- [ ] A15.4 The overlay is initialized **opaque** so the first visible screen after boot — title, or the `?quickstart`/`?bots`/`?online` deep-link targets — fades in from black rather than popping in.
- [ ] A15.5 Every existing navigation goes through the fade: title → lobby, title → online-join, lobby → arena (after countdown), online-join → online (Enter/connect), online-join → title (Esc/back), arena pause → lobby, arena pause → title, and the online scene's disconnect/version-mismatch/back → online-join/title paths. No bare `scene.start()` to another screen remains in the shell (BootScene's initial route is the one allowed instant start, since boot is invisible and the target fades itself in).
- [ ] A15.6 `ui.transitionMs` is read from `content/tuning.json` (validated alongside `lobbyCountdownMs`); a hardcoded duration in source is a bug (hard rule 3).
- [ ] A15.7 Pure shell change: `packages/sim` untouched, golden FFA log + `golden-state-hashes.json` byte-identical, `?rects=1` debug view unaffected, no new console errors.
- [ ] A15.8 e2e stays green: transitions are `pointer-events: none` and short, tests poll on `__testApi.getPhase()` (not pixels), so the only effect is a small added latency the existing polling absorbs. The two-tab online e2e still converges.

## Fixed design points

### Mechanism — DOM overlay, not a camera fade
- The shell composites a Phaser canvas with DOM overlays drawn over it (`render/card-overlay.ts`, `scenes/OnlineJoinScene.ts`). `cameras.main.fade*` only affects the canvas, so it would leave the cards/input visible mid-transition. The transition is therefore a single `<div>`:
  - `position: fixed; inset: 0; background: #000; pointer-events: none;` appended to `document.body`.
  - `z-index` above both existing overlays (cards 10, input 20) — e.g. `1000`.
  - opacity animated via a CSS `transition: opacity <ms>` (or rAF tween) between `0` and `1`.
- One module owns it: `packages/game/src/scene-transition.ts`, exporting a small API used by every scene:
  - `setTransitionDurationMs(ms)` — called once in `BootScene.create()` from `parseUiSettings(tuning).transitionMs`, so the module has the configured duration without threading it through every scene (and works in `OnlineJoinScene`, which has no `AppContext`).
  - `transitionTo(scene, key, data?)` — fade to opaque, then `scene.scene.start(key, data)`; no-op if a fade-out is already in flight (re-entrancy guard, A15.2).
  - `fadeIn()` — fade the (currently opaque) overlay back to transparent; called at the top of each visible scene's `create()`.
- The overlay element is created lazily on first use and initialized **opaque** (A15.4). BootScene primes it (so the boot canvas flash is masked) and then routes with a plain `scene.start` to the first visible scene, which calls `fadeIn()`.

### Tuning
- New `ui.transitionMs` (~220 ms) in `content/tuning.json`, in the existing shell-only `ui` block next to `lobbyCountdownMs`. `parseUiSettings` (`input/settings.ts`) gains the field with the same non-negative-finite-number validation; `UiSettings` widens accordingly. The sim continues to ignore the whole `ui` block.

### Determinism / purity
- Entirely shell-side and cosmetic: no sim API, state, event, or constant changes. The fade is a DOM element animated by wall-clock CSS — it touches neither the accumulator nor `sim.step`. Fading *into* the arena does not gate input or freeze the sim (input gating / round-intro is the separate, deferred ceremony item); the match simply runs underneath the fade for ~220 ms, which is acceptable and standard. The golden log and state hashes are byte-identical because no sim code is touched.

### Scenes touched (wiring only)
- `BootScene` — prime overlay opaque + `setTransitionDurationMs`; initial routes stay instant `scene.start`.
- `TitleScene`, `LobbyScene`, `OnlineJoinScene`, `ArenaScene`, `OnlineArenaScene` — `fadeIn()` in `create()`; replace each outgoing `scene.start(<screen>)` with `transitionTo(this, <screen>, data)`.
- `ArenaScene`/`OnlineArenaScene` `?quickstart`/deep-link entries need no outgoing change (BootScene routes in; they fade in via `create()`).

## Tasks

**T15.1 — Scene transition fade (helper + wiring + tuning).** Add `scene-transition.ts` (DOM overlay, lazy opaque init, `setTransitionDurationMs`/`transitionTo`/`fadeIn`, re-entrancy guard). Add `ui.transitionMs` to `content/tuning.json` and `parseUiSettings`. Prime + configure in `BootScene`; add `fadeIn()` to every visible scene's `create()`; route every outgoing scene change through `transitionTo`.
**Accept:** A15.1–A15.7.

**T15.2 — Verification sweep.** Browser-verify each navigation fades (title↔online-join, title→lobby→match, pause→lobby/title, online connect + error/back). Confirm `?rects=1`, `?quickstart`, `?online` still work; no console errors; golden log + state hashes byte-identical; full gate + e2e green (incl. the two-tab online convergence).
**Accept:** A15.7, A15.8.

## Out of scope for 015 (stay in backlog)
- Round/match **ceremony** — "ROUND 1 / FIGHT" intro, slow-mo + zoom on the match-winning kill, a real victory screen, best-of-N round pips. (The next flow-polish spec.)
- **Living title screen** — animated background, archer sprites, logo motion.
- **Arena ambiance** — background parallax, ambient particles (dust/fireflies), vignette/light shafts.
- **Combat hit-flash** — white victim flash, distinct wall-impact spark, death edge-flash.
- **HUD identity** — portrait score chips, arrow-kind ammo icons.
- Non-fade transition styles (pixel dissolve, iris/circle wipe) — fade-through-black is the chosen style; revisit if the owner wants more character.
- Audio (the single biggest feel multiplier, but a separate backlog item).
