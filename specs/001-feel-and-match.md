# Spec 001 — Game Feel & Match Structure

**Goal:** Rounds aggregate into a best-of-N match with a visible score; kills feel impactful (hitstop, screen shake, particles); the shell gains its e2e smoke suite (Playwright + `window.__testApi`), closing the testing gap deliberately left open in 000.

**Definition of done:** all acceptance criteria pass; a 2-player match plays start-to-finish with scores, a match winner, and a reset — and kills visibly *hit*.

---

## Spec-level acceptance criteria

- [ ] A1.1 First player to `roundsToWin` round wins takes the match: `match_ended` event fires, a match-winner overlay shows, and after `matchRestartDelayMs` the match fully resets (scores zeroed, round counter back to 1, players respawned).
- [ ] A1.2 Draws end the round but increment nobody's score.
- [ ] A1.3 The HUD shows live per-player scores in player colors, updated the tick the round ends.
- [ ] A1.4 Every kill produces hitstop (sim stepping pauses ~`hitstopMs` while rendering holds) and a camera shake; kills and arrow impacts spawn particle bursts. All values live in the `juice` block of `content/tuning.json` and hot-reload in dev.
- [ ] A1.5 `player_killed` events carry the victim's position (needed by shell FX now, kill-heatmap metrics in spec 004). The golden determinism log is consciously regenerated once for this payload change and is byte-identical across runs again.
- [ ] A1.6 `window.__testApi` (dev builds only) exposes readonly state, an event ring buffer, and manual stepping; it is absent from production builds.
- [ ] A1.7 Playwright suite passes locally and in CI as a separate job: boot (canvas + `round_started` + zero console errors), content loading (arena/tuning reached the sim), real-keyboard input mapping for both players including simultaneous presses, and a ~10 s rAF stability run with tick count ≈ 600.
- [ ] A1.8 All spec-000 sim tests still pass; sim purity and determinism guards unchanged.

## Fixed design points

- Match: first to `roundsToWin` (default 3) round **wins**; draws count for nobody. Match end pause uses `matchRestartDelayMs` (default 4000), then everything resets.
- New tuning keys (flat, sim-consumed): `roundsToWin`, `matchRestartDelayMs`. New `juice` object (shell-consumed): `hitstopMs`, `shakeDurationMs`, `shakeMagnitudePx`, `killBurstParticles`, `stickPuffParticles`. One file, one hot-reload path (hard rule 3).
- Hitstop is shell-side (the accumulator pauses; the sim is pure and unaware). Determinism is unaffected: ticks are simply delayed in wall-clock time.
- Particles are cosmetic shell objects and do not wrap at arena edges (accepted glitch at seams; revisit with the art pass).

## Tasks

### T1.1 — Sim: match structure + kill positions
`MatchState { scores: number[], winner: slot | null }` in SimState; round wins increment scores; reaching `roundsToWin` sets the match winner, emits `match_ended { winner, scores }`, and uses the longer match pause; the following restart resets scores and round number. `player_killed` gains `x, y` (victim position at death). Regenerate the golden log (conscious, documented in the commit).
**Accept:** sim tests: two quick kills with `roundsToWin: 2` produce `match_ended` and a full match reset; draws don't score; kill events carry positions; determinism proof green.

### T1.2 — Shell: score HUD + match overlay
Per-player score text in player colors (top corners); existing round overlay extended: match winner shows "<name> wins the match!" during the match pause.
**Accept:** A1.3; match overlay verified in browser.

### T1.3 — Shell: juice (hitstop, shake, particles)
`juice` block in `content/tuning.json` + shell-side validation; on `player_killed`: hitstop pauses the accumulator for `hitstopMs` and the camera shakes; particle bursts on kills (victim color) and arrow sticks (neutral). Hot-reload applies juice edits live.
**Accept:** A1.4 verified in browser (events fire, no console errors, visible burst on kill).

### T1.4 — Shell: `window.__testApi` (dev only)
Exposes `getState()`, `getArenaName()`, `getEvents()` (ring buffer, cap 1000), `setManual(on)`, `stepTicks(n)` (manual stepping samples the real keyboard each tick). Gated on `import.meta.env.DEV`.
**Accept:** A1.6; a prod build (`npm run build` + preview) has no `__testApi`.

### T1.5 — Playwright shell smoke suite + CI job
`@playwright/test` at root, `e2e/` test dir, dev-server `webServer` config. Four tests per the backlog shape (boot / content / input incl. simultaneous / stability ≈600 ticks in 10 s). Separate `e2e` CI job (Chromium only) so the fast gate stays fast. `npm run e2e` locally.
**Accept:** A1.7.

## Out of scope for 001

- Slow-mo on the winning kill — in 2P every kill ends the round, so the end pause already owns that moment; revisit with 3–4 players (002) or corpses.
- Corpse physics, death-cam, dust on jump/land, audio — backlog.
- Round timer / sudden death — with best-of-N in place, evaluate after playtesting (candidate for 002).
- Continuous deploy to Pages — blocked: private repo on a free plan can't use GitHub Pages, and Cloudflare Pages needs an account decision. Stays in backlog until hosting is decided.
- Gamepads, 3–4 players, menus, modes — spec 002.
