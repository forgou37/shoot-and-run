# Spec 016 — Post-match stats & awards

**Goal:** When a match ends, instead of the bare "X wins the match!" text overlay, show a **results screen** that gives each player one or more **awards** — short, punchy superlative titles earned from what they actually did during the match (e.g. *Super Jumper*, *Arrow Spender*, *Booster-Man*, *Deadeye*). The awards are computed from the sim's event stream, so they are exact, deterministic, and the same on every screen of an online match.

**Numbering note:** 015 was the last shell spec; 008–013 are reserved by netcode. This is the next free number, 016. It promotes a new idea (post-match stats) straight into a numbered spec per hard rule 1.

**Scope note:** this is the second "game feel / flow" polish item after 015 (scene transitions). It is **not** the full round/match "ceremony" item from the 015 backlog (ROUND 1 / FIGHT intro, slow-mo on the winning kill, best-of-N pips, animated victory screen) — those stay in the backlog. 016 ships only the post-match awards screen.

**Owner decisions (2026-06-16):**
- **Coverage:** Tier A (all event-derived combat/loot/survival awards) **plus** Tier B movement awards (Super Jumper / Dash Demon / Wall Monkey), which require new sim events.
- **Award style:** **superlative-only** — each award goes to exactly one winner (the match leader for that stat). A player may earn several awards or none. Ties broken deterministically by lowest slot index.

**Definition of done:** all acceptance criteria pass; a match end shows the results/awards screen; awards are derived purely from sim events via a Phaser-free aggregator that is unit-tested headless; the new movement events are additive; `packages/sim` determinism is preserved (state-hash fixture byte-identical; the golden **event** log is regenerated once, consciously, only if the new movement events fire during the recorded bot round); award titles/thresholds live in data per the content-as-data ethos; full gate + e2e green.

---

## What's trackable (grounding)

Every award must derive from the sim's only two output channels: the `SimEvent` log (`packages/sim/src/events.ts`) and `SimState` (`state.ts`). Audited at spec time:

**Tier A — already in the event log today, no sim rule change:**
`arrow_fired`, `arrow_stuck`, `arrow_picked_up`, `arrow_exploded`, `player_killed {victim,killer,cause}`, `round_ended {winner}`, `match_ended`, `chest_opened`, `booster_collected`, `shield_blocked`.

**Tier B — NOT currently emitted.** `packages/sim/src/player.ts` runs movement silently (no `events.push`). Jumps, dashes, and wall jumps leave no trace in events or state. Tier B therefore requires threading the per-tick `events` array into the movement step and emitting new movement events.

**Time/positional stats** (e.g. distance travelled, time invisible) would need per-tick sampling; deferred (see Out of scope) to keep v1 bounded.

## The award catalog (v1)

Superlative-only. Each row = one award; winner = the player with the max tally (min slot index breaks ties); an award with an all-zero tally is **not shown** (nobody fired a bomb ⇒ no Bombardier). Titles and the stat each maps to live in **data** (`content/awards.json`), not hardcoded, so they can be reworded/localized/extended without code.

| Award (working title) | Stat tallied | Source |
|---|---|---|
| **Super Jumper** | total jumps (all kinds) | `player_jumped` (Tier B) |
| **Wall Monkey** | wall jumps | `player_jumped {kind:"wall"}` (Tier B) |
| **Dash Demon** | dashes started | `player_dashed` (Tier B) |
| **Arrow Spender** | arrows fired | `arrow_fired` |
| **Deadeye** | arrow kills (as killer, `cause:"arrow"`) | `player_killed` |
| **Curb-Stomper** | stomp kills (`cause:"stomp"`) | `player_killed` |
| **Bombardier** | bomb kills (`cause:"bomb"`) | `player_killed` |
| **Booster-Man** | boosters collected | `booster_collected` |
| **Treasure Hunter** | chests opened | `chest_opened` |
| **Scavenger** | arrows picked up | `arrow_picked_up` |
| **Bulletproof** | shield hits absorbed | `shield_blocked` |
| **Survivor** | rounds survived (alive at `round_ended`) | derived |
| **Punching Bag** | deaths (times the `victim`) | `player_killed` |
| **First Blood** | first kill of the match (boolean award) | first `player_killed` |
| **Pacifist** | rounds survived with the fewest arrows fired | derived (tie-break: must have survived ≥1 round) |

Final selection of which ~12–15 ship and their exact wording is an authoring detail in `content/awards.json`; the table above is the design intent. (Self-Destruct, Avenger, Litterbug, Efficiency%, Clutch, Friendly-Fire are easy follow-ons left for a later pass to keep v1 tight.)

---

## Fixed design points

### Aggregator — pure, Phaser-free, headless-testable
- New module `packages/game/src/match-stats.ts` exporting:
  - `foldMatchStats(events: SimEvent[], players: PlayerMeta[]): MatchStats` — folds the full match event log into per-player tallies. Pure, no Phaser/DOM imports, deterministic (same events ⇒ same tallies).
  - `assignAwards(stats: MatchStats, catalog: AwardCatalog): Award[]` — applies the superlative rule (max tally, min-slot tie-break, drop all-zero awards) and resolves titles from the catalog.
- It imports **only types** from `packages/sim` (`SimEvent`, and a tiny local `PlayerMeta = {slot,name,team}`). It is unit-tested in Node with hand-built event logs — no Phaser in the test path.
- **Why shell-side, not `packages/sim`:** awards are a *consumer* of sim output (like bots and the future eval pipeline), not a game rule; the pure core stays rules-only. It is written Phaser-free so spec 005's eval pipeline can lift it into a shared package unchanged when it needs match metrics. (Alternative — a new `packages/stats` package — rejected as overkill for one shell consumer; revisit at spec 005.)

### Award catalog as data
- `content/awards.json`: `{ awards: [{ id, title, stat, hidden? }] }` where `stat` names a tally key the aggregator computes. Validated by a `parseAwards` validator in the shell (same pattern as `parseUiSettings`/`parseNetParams`). Follows the content-as-data ethos: titles are content, not code. (The sim ignores this file entirely.)

### Tier B — new movement events (sim change)
- Thread the per-tick `events: SimEvent[]` into the movement step (`updatePlayer`/`player.ts`), which currently takes no events array, and emit:
  - `{ tick, type: "player_jumped"; slot; kind: "ground" | "wall" | "flap" }` — at each successful jump in `player.ts` (the existing `groundJump` / `wallJump` / flight-flap branches map to the three kinds).
  - `{ tick, type: "player_dashed"; slot }` — when a dash burst starts (`dashTicksLeft` set from 0).
- These are **additive** event types. They feed Super Jumper (all `player_jumped`), Wall Monkey (`kind:"wall"`), Dash Demon (`player_dashed`).
- **Determinism / golden artifacts:**
  - `golden-state-hashes.json` is over **snapshots (SimState)**; events are not in state, so it stays **byte-identical**.
  - The golden **event log** fixture *will* change iff the scripted bot round on arena-001 performs a jump or dash before its early grounded arrow kill. If so, regenerate it once, consciously (same precedent as the `player_killed` payload change, Decisions Log 2026-06-12). Document the regen in the commit + Decisions Log.
- Online: events emitted during prediction must not corrupt the tally. The aggregator consumes the **confirmed/authoritative** event stream only (see next point), so predicted re-sims that get rolled back never double-count.

### Match-end flow (shell)
- Today ArenaScene shows an overlay and the sim auto-loops into a fresh match (`round.ts` resets scores after `matchRestartDelayTicks`). 016 intercepts `match_ended`:
  - The shell accumulates every event returned by `sim.step` across the whole match into a match-scoped log.
  - On the `match_ended` event, freeze the match (the existing pause flag — stop the accumulator, sim untouched) and route to a **ResultsScene** (via `transitionTo`, spec 015) carrying `{ events, players, winner }`.
  - ResultsScene runs `foldMatchStats` → `assignAwards`, renders the winner banner + a card/row per player listing their awards (BitmapText via `addPixelText`; reuse the per-slot colors), and a "press to continue" that returns to the lobby (or title) through a fade.
- **Online (host-broadcast — corrected during implementation):** the client's *confirmed* event stream is **not** a safe source — under jitter/loss the rollback controller heals gaps via periodic snapshots (`resync`), which jump the confirmed sim forward and skip the `step()` events for those ticks, and the skip pattern differs per client (verified: two clients' confirmed logs diverged). So instead the **host broadcasts its canonical event log** once at `match_ended` (new `match-stats` NetMessage, encoded as one datagram for all clients). The host sim has no rollback/resync gaps, and every client receives identical bytes ⇒ identical awards. `OnlineArenaScene` waits for `session.matchStats()`, then shows the same ResultsScene. (Sent unreliably like the snapshot — a client that drops it just won't show the screen; acceptable for v1, matching the existing no-retransmit caveat.)

### Determinism / purity summary
- Sim change is limited to two additive event types emitted from existing movement branches; no new rules, no state fields, no tuning. State-hash fixture byte-identical; golden event log regenerated once if the bot round jumps/dashes. Everything else (aggregator, catalog, ResultsScene) is shell-side and cosmetic.

---

## Spec-level acceptance criteria

- [x] A16.1 `foldMatchStats` turns a match event log into correct per-player tallies for every catalog stat; unit-tested headless with hand-built logs (incl. ties, all-zero). (`packages/game/test/match-stats.test.ts`, 13 tests.)
- [x] A16.2 `assignAwards` is superlative-only: one winner per award (max tally, lowest-slot tie-break), all-zero awards omitted; titles resolved from `content/awards.json`.
- [x] A16.3 New `player_jumped {slot,kind}` and `player_dashed {slot}` events fire once per jump (ground/wall/flap) and per dash start, for the right slot. (Threaded into `player.ts`; emitted from the existing jump/dash branches.)
- [x] A16.4 `golden-state-hashes.json` byte-identical (events aren't in state); the golden **event** log was regenerated once (the bot round now emits 4 `player_jumped`) — `UPDATE_GOLDEN=1`, documented here + in the Decisions Log.
- [x] A16.5 On `match_ended`, a local match shows the ResultsScene with the winner and each player's earned awards; continue returns to the lobby through the spec-015 fade. (e2e `results.spec.ts` + browser screenshot.)
- [x] A16.6 An online match shows the same ResultsScene on both tabs with identical awards — guaranteed by the host broadcasting one identical `match-stats` datagram (net test asserts both clients receive identical bytes incl. `match_ended`). The full two-tab *browser* drive-to-match-end is impractical with idle inputs (nobody dies), so it is proven at the net layer; the scene wiring is shared with the verified local path.
- [x] A16.7 Award titles + which stat each maps to live in `content/awards.json`, validated by `parseAwards`; no hardcoded title strings in scene code.
- [x] A16.8 Pure boundaries hold: `match-stats.ts` imports no Phaser/DOM (only sim types); `packages/sim`/`net` purity intact; `check:deps` green (46 modules). Full gate + e2e green (246 unit + 16 e2e + build), incl. the two-tab online convergence.

## Tasks

**T16.1 — Movement events (sim).** Thread `events` into `player.ts`; emit `player_jumped {slot,kind}` and `player_dashed {slot}`. Add the event types to `events.ts`. Update determinism tests; regenerate the golden event log if the bot round fires them (document it). **Accept:** A16.3, A16.4.

**T16.2 — Pure aggregator + catalog.** Add `packages/game/src/match-stats.ts` (`foldMatchStats`, `assignAwards`, types), `content/awards.json`, and `parseAwards`. Headless unit tests. **Accept:** A16.1, A16.2, A16.7, A16.8 (purity).

**T16.3 — Results screen + match-end wiring.** Accumulate the match event log in ArenaScene/OnlineArenaScene; on `match_ended` freeze + `transitionTo` a new ResultsScene that renders winner + awards and returns to lobby/title. Online uses the confirmed stream. **Accept:** A16.5, A16.6.

**T16.4 — Verification sweep.** Browser-verify local + two-tab online results screens; both online tabs show identical awards; `?quickstart`/`?online`/`?rects` unaffected; no console errors; gate + e2e green; extend the online e2e to assert both tabs reach results. **Accept:** A16.4, A16.6, A16.8.

## Out of scope for 016 (stay in backlog)
- Time/positional awards (Globetrotter = distance travelled, Ghost = time invisible, Icarus = time in flight) — need per-tick state sampling; defer.
- The second tranche of event-derived awards (Self-Destruct, Avenger, Litterbug, Efficiency%, Clutch, Friendly-Fire) — trivial follow-ons once the framework exists.
- "Everyone gets a title" mode (per-player descriptive profile even without a superlative) — owner chose superlative-only for v1.
- Round/match **ceremony** (ROUND 1 / FIGHT intro, slow-mo winning kill, best-of-N pips, animated victory art) — separate flow-polish spec.
- Persisting stats across matches / lifetime leaderboards — no storage layer in scope.
- Audio stings on award reveal — part of the deferred audio backlog.
