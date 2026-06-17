# Spec 017 — Lobby character select

**Goal:** Turn the "press a button to join" lobby into a real character-select screen. A joined player chooses *which* card (character identity from `content/players.json`) is theirs by moving left/right with the keyboard arrows or a gamepad, instead of being auto-assigned the lowest free slot. A character that another player (or a bot) already holds cannot be selected — each card holds at most one occupant. The host places bots on the cards of their choosing.

This was the long-standing "lobby/character-select" backlog item under spec 003's deferred list. It is a shell-only change: no sim, net, or content-schema changes.

**Scope note:** purely `packages/game` (lobby scene + one menu-input edge). The roster the lobby hands to the match is unchanged in shape — only *how* a player ends up on a given slot changes. No new tuning keys, no `players.json` changes, no art changes (each column already shows its slot's card art; choosing a column = choosing that character).

**Definition of done:** all acceptance criteria pass; a multi-keyboard/gamepad lobby lets each player pick a distinct character and start a match on the chosen identities; the host can add/remove bots on specific cards; full gate + e2e green; sim golden determinism log untouched (no sim changes).

---

## Spec-level acceptance criteria

- [x] A17.1 A joined, **not-ready** human moves their selection between cards with left/right (keyboard arrows / d-pad / left stick). Movement lands on the nearest card in that direction that is **free** (no other human, no bot), skipping occupied cards; if none is free in that direction the selection stays put. No wrap.
- [x] A17.2 Exclusive selection: a card occupied by another human or a bot can never be selected by a second player. Because join still claims the lowest free card and navigation only ever lands on free cards, at most one occupant exists per card at all times.
- [x] A17.3 `jump` locks the current card in (ready); `shoot` steps back (ready → unready → leave), exactly as before. A **ready** player's left/right is inert (selection is locked until they unready).
- [x] A17.4 Teams mode: a player's team follows their chosen card's column (even columns → team 1, odd → team 2). Picking a card on the other side switches your team; there is no separate team-switch control. Bots keep the same column-parity team rule.
- [x] A17.5 Host bot placement: the host (lowest-slot human) presses **dash** (keyboard dash key / pad RB) to enter bot placement; the selection cursor jumps to the first empty card. left/right moves the cursor across non-human cards (empty *or* bot); `jump` confirms — placing a bot on an empty card, or removing the bot on a bot card; `shoot` or `dash` cancels. The lobby countdown is suspended while placement is active.
- [x] A17.6 The lowest-slot human remains the controller for mode/friendly-fire/difficulty (up / down) as today. While the host is in bot placement, their normal controls (navigation, ready, mode/FF/difficulty) are suspended in favour of the placement controls.
- [x] A17.7 e2e: the existing two-keyboard join→ready→countdown flow still passes unchanged; the lobby add-bot e2e is updated to the dash→confirm flow; a new check exercises navigation onto a different character and starts the match on it. Full gate + e2e green.

## Fixed design points

- **Controls (lobby), joined human, not in bot placement:**
  - `jump` — join (unjoined) → ready toggle (joined). Claims the lowest free card on join (unchanged).
  - `shoot` — back one step: ready → unready → leave.
  - `left` / `right` — move selection to the nearest free card in that direction (no-op when ready). In teams mode this also sets the player's team from the destination column parity.
  - Controller (lowest human) only: `up` cycles mode (FFA/teams, ≥3 participants for teams), `down` toggles friendly fire (teams) / cycles bot difficulty (FFA).
  - Controller only: `dash` opens bot placement.
- **Bot placement (controller only, modal):** a transient `{ cursor }` over the cards that are not held by a human. Enter via `dash` (only when at least one such card exists); cursor starts on the first empty card, else the first bot card. `left`/`right` step the cursor across eligible cards; `jump` toggles a bot at the cursor (add on empty, remove on bot) and exits; `shoot`/`dash` cancels. Placement suspends the countdown.
- **Team derivation:** `team = slotIndex % 2` for humans and bots, recomputed on join, navigation, bot placement, and mode change. The old "non-controller left/right switches team" branch is removed.
- **No new state on the roster.** `startMatch` still emits `RosterEntry[]` keyed by the slot each occupant ended on; identity/colour/card art already follow the slot.
- **No new tuning/content/sim.** `EdgeReader` gains a `dash` rising-edge (the only menu-input addition); `dash` is already in `KeyBindings` and sampled by every device.

## Tasks

### T17.1 — `dash` menu edge
Add `dash` to `DeviceEdges` + `EdgeReader.read` (rising edge of `PlayerInput.dash`). No behaviour change elsewhere.

### T17.2 — Selection + exclusivity + team-by-column (LobbyScene)
Left/right navigation across free cards for joined-unready humans; ready locks it; team derived from column in teams mode; remove the team-switch branch. Selection-cursor visual (border in the slot colour for an unready human).

### T17.3 — Host bot placement (LobbyScene)
Modal placement entered with `dash`; cursor over non-human cards; jump add/remove + exit; shoot/dash cancel; countdown suspended; replaces the old left/right add/remove. Placement-cursor visual + updated bottom hints.

### T17.4 — e2e + docs
Update `e2e/bots.spec.ts` add-bot flow to dash→confirm; add a navigation check to `e2e/lobby.spec.ts`; update CLAUDE.md lobby control description + backlog roadmap + DECISIONS row.

## Out of scope for 017

- Multiple players hovering the same card before lock-in (we keep one-occupant-per-card; simplest reading of "if chosen, another can't choose it").
- Random / "?" character pick, per-character stats (all four are cosmetically identical today).
- Key/button rebinding, arena select — still backlog.
