# Spec 003 — Full roster: gamepads, 3–4 players, modes & menus

**Goal:** The game becomes a couch game: up to 4 players on 2 keyboards profiles + up to 4 gamepads, joining through a "press a button" lobby, playing free-for-all or 2v2 teams, with a title screen and pause menu wrapping the match. Also lands the sim step-time budget test the backlog requires before this spec (it protects the future eval pipeline).

**Scope note:** the backlog's 003 candidates are trimmed to a playable core. Deferred (stay in backlog): key rebinding UI, settings menu (pointless before audio), arena select (only one arena exists), headhunter and target-practice modes. The sim already supports N players and arena-001 already has 4 spawns — sim work in this spec is teams/friendly-fire only.

**Definition of done:** all acceptance criteria pass; a 4-player match (2 keyboard profiles + 2 gamepads, or shimmed pads) plays title → lobby → match → pause → back to lobby; a 2v2 teams match scores by team; full gate + e2e green; FFA golden determinism log untouched.

---

## Spec-level acceptance criteria

- [x] A3.1 A step-time budget test runs in the normal suite: 4 players, scripted deterministic inputs, ≥5000 ticks with arrows/chests active; mean step time below an explicit budget constant (0.5 ms — a loose order-of-magnitude tripwire, not a perf target). Runs in CI via `npm test`.
- [x] A3.2 Standard-mapping gamepads work: left stick (deadzone `input.stickDeadzone` from tuning.json) + d-pad → left/right/up/down, A/Cross → jump, X/Square → shoot, Start → pause. Hot-plug: pads appear in the lobby when connected; an assigned pad disconnecting mid-match auto-pauses.
- [x] A3.3 `content/players.json` is reshaped: 4 slot definitions (name, color) + 2 keyboard binding profiles, shell-validated. Slots 2–3 get sprite recolor for free via 006's ramp swap.
- [x] A3.4 Lobby: unassigned devices join by pressing jump and claim slots in join order; jump toggles ready, shoot steps back (unready → leave); with ≥2 joined and all ready a `ui.lobbyCountdownMs` countdown starts (cancelled by any unready/leave), then the match begins.
- [x] A3.5 3- and 4-player FFA matches run end-to-end: per-slot spawns/colors/HUD scores (evenly spaced along the top edge, slot colors), kills/scores/match flow all work as in 2P.
- [x] A3.6 Teams mode (sim): each player carries a team (0/1, both teams non-empty); the round ends when all alive players share a team; team round wins accumulate in `match.teamScores`; first team to `roundsToWin` wins the match. Friendly fire toggle: when off, teammate arrows/lasers pass through, bombs spare teammates (the shooter counts as their own teammate), teammate stomps bounce without killing. FFA behavior and event payloads are byte-identical to before — golden log NOT regenerated this spec.
- [x] A3.7 Scene flow: title → lobby → match; Esc/Start opens a pause overlay (resume / back to lobby / back to title) that freezes the accumulator (sim untouched, determinism unaffected); `?quickstart=1` skips straight into the current 2-keyboard FFA match for dev/e2e.
- [x] A3.8 e2e: existing suite migrated to `?quickstart=1` and green; new tests cover the lobby flow (title → join 2 keyboards → ready → countdown → `round_started`) and a gamepad-driven player via a `navigator.getGamepads` shim injected by Playwright. Full gate + e2e green locally and in CI.

## Fixed design points

- **Device model.** `InputDevice { id, kind, sample(): PlayerInput }` with instances `keyboard:0`, `keyboard:1` (the two binding profiles), `pad:<index>` (0–3). The lobby produces a device→slot assignment in join order; the match scene samples assigned devices each tick. A disconnected pad samples neutral input (all false) in addition to triggering auto-pause.
- **players.json shape:** `{ "slots": [{slot, name, color} ×4], "keyboards": [KeyBindings ×2] }`. Colors: P1 `#4fc3f7` (blue), P2 `#ff8a65` (orange), P3 `#81c784` (green), P4 `#ba68c8` (purple). Validation stays shell-side (device/render concern, as today).
- **Gamepad mapping is fixed** (standard mapping only; rebinding deferred): axes 0/1 + buttons 12–15 for direction, button 0 jump, button 2 shoot, button 9 pause, button 1 back (lobby). Non-standard-mapping pads are listed but may misbehave — accepted.
- **Sim config for modes:** `PlayerSlotConfig` gains optional `team?: 0 | 1`; `SimConfig` gains optional `friendlyFire?: boolean` (default true). Teams mode is implied by all players having teams; createSim validates all-or-none and both teams non-empty. In teams mode `round_ended.winner` / `match_ended.winner` carry the winning **team** id (same field, same type — consumers know the mode); per-player `match.scores` keeps counting individual round survivals, but match victory reads `match.teamScores`.
- **Lobby controls** (placeholder text/rect UI): jump = join → ready toggle; shoot = back out one step; left/right while joined-unready switches team (teams mode); the first joined player cycles mode (FFA / teams) and friendly fire with up/down. Teams selectable with ≥3 joined; friendly fire defaults off in teams.
- **Match lifecycle.** Match end keeps the sim's built-in auto-rematch (same roster, fresh sim with a new shell-chosen seed only when returning via lobby). Pause is purely shell-side: the accumulator stops advancing; quitting to lobby/title destroys the sim.
- **New tuning keys** (shell-consumed blocks, hot-reloadable like `juice`): `input.stickDeadzone` 0.25, `ui.lobbyCountdownMs` 3000. No new sim tuning keys.
- **Benchmark placement:** plain Vitest test in `packages/sim/test/` (test code may use `performance` — purity guards cover `src/` only). Budget lives as a named constant with the reasoning in a comment.

## Tasks

### T3.0 — Sim step-time budget test
4-player sim, scripted inputs that fire/jump/move deterministically, ≥5000 ticks, assert mean step time < 0.5 ms. Backlog's "before spec 003" CI item.
**Accept:** A3.1.

### T3.1 — Input device layer (shell)
`InputDevice` abstraction; keyboard profiles refactored onto it; `GamepadInput` polling with standard mapping, deadzone from `input.stickDeadzone`, hot-plug events; `players.json` reshape + validator update.
**Accept:** A3.2 (mapping + hot-plug), A3.3.

### T3.2 — Teams & friendly fire (sim)
`team` on players, mode validation, team round/match scoring (`teamScores`), friendly-fire-off kill suppression (arrows, lasers, bombs, stomps). FFA paths byte-identical; golden log untouched.
**Accept:** A3.6 via headless sim tests (team round end, team match win, FF-off suppression cases incl. bomb-self, FFA determinism proof unchanged).

### T3.3 — Scene flow: title, lobby, pause (shell)
TitleScene; LobbyScene (join/ready/leave, slot claiming, team/mode/FF toggles, countdown); pause overlay with accumulator freeze and quit paths; `?quickstart=1`; `ui.lobbyCountdownMs`.
**Accept:** A3.4, A3.7 — browser-verified.

### T3.4 — 3–4 player match wiring (shell)
Lobby roster → `createSim`; per-slot sprites (recolor exists) and HUD score layout for 2–4 players; team score HUD in teams mode; pad-disconnect auto-pause.
**Accept:** A3.5; teams HUD browser-verified.

### T3.5 — e2e: quickstart migration, lobby flow, gamepad shim
Existing tests on `?quickstart=1`; lobby-flow test (keyboard only); gamepad test via injected `getGamepads` shim driving one player; `__testApi` gains a minimal `getPhase()` ("title" | "lobby" | "match").
**Accept:** A3.8.

### T3.6 — Verification sweep
Full gate + e2e locally and in CI; golden log confirmed untouched; CLAUDE.md (commands/structure if changed) and backlog roadmap updated.
**Accept:** definition of done.

## Out of scope for 003

- Key/button rebinding UI, persisted bindings — backlog.
- Settings menu (volume, screen scale) — backlog until audio exists.
- Arena select — backlog until a second arena exists.
- Headhunter / target-practice modes — backlog; revisit after 003 playtesting.
- Slow-mo on round-winning kill — now unblocked by 3–4P (001 deferred it for exactly this); evaluate after 003 playtesting.
- Audio, online play (never) — unchanged.
