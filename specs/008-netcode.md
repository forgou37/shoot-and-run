# Spec 008 — Online Multiplayer

**Status:** planning. Owner-directed reversal of "online permanently out of scope" (hard rule 1 escape clause + "Explicitly never" in backlog). This spec is the umbrella; each phase below becomes its own numbered spec (008–013) when promoted. **Phase 008 is done** (T8.1–T8.6); **Phase 009 is task-broken-out below** (awaiting owner confirmation before code). Phases 010+ stay scoped at the goal/acceptance level until their predecessors land.

**Goal:** 2–4 players play a full match over the internet with feel close to local play, hosted by **either** a dedicated headless process **or** one player's browser, sharing one codebase. No game logic leaves `packages/sim`.

---

## Architecture (decided this session)

Three forks were locked with the owner:

| Fork | Decision | Why |
|---|---|---|
| Client model | **Host-authoritative + deterministic client-side prediction with rollback re-simulation** | The sim is already deterministic, input-driven, fixed-timestep; rollback is nearly free architecturally and gives the crisp, exact hit resolution one-hit kills demand. Host authority lets any float divergence self-heal, so the fixed-point rejection (Decisions Log) stands. |
| v1 host mode | **Dedicated server first**, player-hosting second | Defers NAT traversal, TURN, and host-migration pain; gets to a playable internet match on the lowest-risk path. The dedicated host is literally the existing headless golden-log runner + a transport. |
| Infra | **Cloudflare-native** | Workers + Durable Objects for signaling/rooms (a DO can *be* the dedicated host — the pure sim runs in `workerd`) + Cloudflare TURN. Matches the existing Cloudflare Pages lean. |

### The symmetric Host model

```
        ┌──────────── authoritative Host (owns the canonical sim, 60 Hz) ─────────┐
        │  · headless process (Cloudflare DO / Node) = dedicated server (v1)      │
        │  · player's browser                        = listen server (later)      │
        │    same packages/sim, same packages/net protocol — only env + transport │
        └──────────────────────────────▲──────────────────────────────────────────┘
                       inputs (1 B/tick) │ │ authoritative inputs + periodic snapshot + acks
                                         │ ▼
              Client ── runs its OWN sim, predicts, rolls back & re-sims on correction ──
```

- **Star topology** — every client talks only to the Host (never mesh). Identical in both deployment modes.
- **Clients send inputs**, tagged with a target tick. The Host applies a small input delay (≈2–3 ticks) to absorb jitter, steps the authoritative sim, and broadcasts authoritative inputs + periodic full-state snapshots + acks.
- **Clients predict**: apply own input immediately, guess remote inputs (repeat-last); on receiving authoritative inputs, roll back to the last confirmed tick and **re-simulate forward**. Deterministic ⇒ the re-sim is exact, not a lerp; only a *changed* remote input causes a visible correction.

### Why these facts make it cheap (verified against current code)

- `PlayerInput` ([packages/sim/src/input.ts](packages/sim/src/input.ts)) is **7 booleans → 1 byte/tick** on the wire. Bandwidth is a non-issue at ≤4 players + a handful of arrows; a full `SimState` snapshot is a few hundred bytes. Latency + determinism are the only real constraints.
- `SimState` ([packages/sim/src/state.ts](packages/sim/src/state.ts)) is **entirely plain serializable data** — no classes, Maps, or functions. Snapshot/restore is a structured clone.
- The sim uses **no transcendental functions**: only `Math.floor`/`Math.round`/`Math.imul` (bit-exact) and a single `Math.sqrt` at [arrow.ts:45](packages/sim/src/arrow.ts:45) (IEEE-754 mandates correct rounding → cross-engine safe). The cosmetic `atan2` is shell-side. The sim is therefore **very likely already cross-machine deterministic**; the Windows-dev/Linux-CI golden-log check is a partial proof. Phase 008 turns "likely" into "verified" and adds a guard.
- The only mutable state **outside** `SimState` is the RNG's `a` (one uint32, [rng.ts](packages/sim/src/rng.ts)) and the `nextEntityId` counter (a closure in [index.ts](packages/sim/src/index.ts)). Both must become snapshot-visible. `tuning`/`arena`/`teamsMode`/`friendlyFire` are init-constant (no mid-session `setTuning` in netplay).

---

## Decision amendments this endeavor requires (need owner sign-off)

1. **Hard rule 1 / "Explicitly never":** online is being added — satisfied by the rule's own "unless explicitly added by the owner" clause. Backlog "Explicitly never" line moves to the roadmap (done in this spec's commit).
2. **"No server component will ever exist; CD static-only" (Decisions Log, 2026-06-12):** internet play needs at minimum signaling, and dedicated mode needs a host process. Amended to: *static game client on Pages + a Cloudflare Worker/Durable-Object control & host plane + Cloudflare TURN.* Still no traditional always-on VM.
3. **Float-determinism / fixed-point rejection (Decisions Log):** **unchanged.** Host authority absorbs divergence; periodic snapshots hard-resync. Would only need revisiting for trustless host-less P2P lockstep (not planned).
4. **Tuning hot-reload (hard rule 3 / CLAUDE.md note):** must be **disabled for the duration of a net session** (tuning pinned at session init), as already flagged that hot-reload breaks determinism.

## Postures (not blockers, log when speccing the relevant phase)

- **Trust:** a player-host has full authority and can cheat — acceptable among friends; the dedicated server is the trusted option. State this when phase 012 lands.
- **Host migration:** when a player-host quits it is genuinely hard; v1 policy is "host leaving ends the session." Dedicated mode sidesteps it. Revisit in 013.
- **Lag compensation:** with one-hit kills, decide shooter-favored (rewind host to the shooter's view, capped, e.g. ≤100 ms) vs host-strict. A tunable; default modest shooter-favor. Tune in 013.

---

## Phased roadmap

Phases 008–009 are **fully headless and CI-gated** — all the hard determinism/rollback risk is retired before any browser or network code exists.

| Phase | Theme | First-playable? | Gate |
|---|---|---|---|
| **008** | Netcode foundation: snapshot/restore, input (de)serialization, determinism hardening, headless rollback harness — **done** (T8.1–T8.6) | no | 007 done ✓ |
| 009 | `packages/net` session layer: clock/tick sync, input delay, jitter buffer, prediction/rollback loop — over a loopback transport with injected latency/jitter/loss | no | 008 ✓ |
| 010 | Real transport + Cloudflare signaling: WebSocket adapter (dedicated path), Worker + Durable Object signaling, room codes | no (LAN/localhost connect) | 009 |
| 011 | **Dedicated server + browser client** — `packages/server` headless host on a Durable Object; browser becomes a pure prediction client | **yes — first internet match** | 010 |
| 012 | Player-hosted / listen-server: one browser becomes the Host; WebRTC DataChannel P2P; NAT traversal + TURN; host-leaving policy | yes (P2P) | 011 |
| 013 | Polish: lag-comp tuning, spectators, reconnection, metrics/telemetry, anti-cheat posture, host migration | — | 012 |

### Transport note (consequence of "dedicated first")

011 starts on **WebSocket** (TCP) to the Durable Object — simplest, Cloudflare-native, no signaling/TURN. The rollback design tolerates moderate jitter/loss, but TCP head-of-line blocking hitches under packet loss. The `packages/net` transport interface (009) keeps this swappable: WebRTC **DataChannel (unreliable + unordered)** arrives with player-hosting in 012, and WebTransport datagrams are a later drop-in if CF/browser support firms up. Document the TCP-HOL caveat honestly in 011.

### New workspaces

- `packages/net` — depends on `sim`, **never Phaser/DOM**. Transport interface + session/prediction/rollback logic. Loopback-testable in Node. (Add to the dependency-cruiser allow-list: `net` may import `sim`; `sim` still imports nothing outside itself.)
- `packages/server` — the dedicated host = `sim` + `net`, runs in `workerd` (Durable Object) and Node. No renderer.
- `packages/game` gains an online ArenaScene + online lobby/join; reuses the existing accumulator-freeze for disconnect-pause.

---

## Phase 008 — Netcode foundation (the only phase task-broken-out here)

**Goal:** the sim can be snapshotted, restored, and re-simulated bit-identically; inputs serialize to a compact versioned wire format; cross-engine determinism is proven and guarded — all headless, no transport, no browser.

**Definition of done:** the acceptance criteria below pass in `npm test` and the existing CI gate; sim purity (`check:deps`) still passes with `packages/net` added.

**Status: done** (T8.1–T8.6 landed 2026-06-15). Full gate green — typecheck/lint/check:deps + 161 Vitest tests; golden FFA event log byte-identical.

### Spec-level acceptance criteria

- [x] N1. `sim.snapshot()` returns a structurally-cloned, JSON-serializable value capturing **all** sim state needed to resume: `SimState`, the RNG internal state, and `nextEntityId`. `createSimFromSnapshot(snapshot, { arena, tuning, players, friendlyFire })` reconstructs a sim that is `step()`-for-`step()` identical to the original. _(snapshot.test.ts)_
- [x] N2. **Rollback identity:** create sim A, step N ticks with input log L, snapshot at tick K<N, then: (a) continuing A to N and (b) restoring from the K-snapshot and stepping the tail of L produce byte-identical state and event logs at tick N. _(rollback.test.ts)_
- [x] N3. **Divergence + reconverge:** from a tick-K snapshot, stepping a *different* tail L′ diverges; re-restoring K and stepping the original L returns to A's tick-N state byte-for-byte (proves restore fully resets hidden state — RNG, counters). _(rollback.test.ts)_
- [x] N4. RNG exposes `getState()/setState()` (or equivalent); `createRng` seeded then advanced M times, state captured, a fresh rng `setState`'d to it, produces an identical next stream. No behavioral change to the existing seed→stream mapping (golden log unaffected). _(rng.test.ts)_
- [x] N5. `serializeInput(PlayerInput): Uint8Array` (1 byte) and `deserializeInput`; round-trips for all 128 combinations. A versioned `serializeInputFrame(tick, inputs[])` / parser, tagged with `SIM_VERSION`; a version mismatch is a typed, catchable error. _(wire.test.ts; the frame carries a numeric `PROTOCOL_VERSION` bumped in lockstep with `SIM_VERSION`, kept compact rather than embedding the version string per tick.)_
- [x] N6. **Cross-engine determinism guard:** a checked-in golden state-hash sequence (e.g. FNV-1a over `snapshot()` every K ticks of the scripted-bot round) re-verified in CI. Extends the existing Windows/Linux golden-log proof to a state-level hash. (Browser-engine verification is wired in 010 when a browser is in the loop; 008 covers the Node/V8 + state-hash guard.) _(cross-engine.test.ts + golden-state-hashes.json)_
- [x] N7. `packages/net` workspace exists with the transport **interface only** (no implementation) and is added to `check:deps`: `net → sim` allowed, `sim → net` forbidden, neither imports Phaser/DOM. _(`net-purity` rule; `tsPreCompilationDeps:true` added so the type-only sim↔net seam is actually analyzed — verified a deliberate `sim→net` import fails the gate, then reverted.)_
- [x] N8. The existing golden FFA determinism log stays **byte-identical** (snapshot/RNG-exposure changes are additive; no gameplay path changes).

### Fixed design points

- Snapshot is a **value**, not a handle: deep, owns no references into the live sim. `structuredClone` is acceptable in `packages/net`/tests; the snapshot *producer* in `packages/sim` must stay DOM-free (`structuredClone` is a global in Node + workerd + browsers — confirm it's allowed by the sim's no-DOM tsconfig, else hand-write the clone).
- Input wire format (1 byte): bit 0 left, 1 right, 2 up, 3 down, 4 jump, 5 shoot, 6 dash, bit 7 reserved. Frame = `varint tick` + `playerCount` + bytes.
- Snapshot/restore lives behind the `Sim` API or a sibling pure function in `packages/sim`; it must not require `packages/net`.
- No new tunables (this phase is mechanism, not feel).

### Tasks

#### T8.1 — Expose hidden deterministic state
RNG `getState()/setState()` in [rng.ts](packages/sim/src/rng.ts); surface `nextEntityId` get/set through the sim (without letting external callers mutate it during normal play). No change to seed→stream behavior.
**Accept:** N4; golden log byte-identical (N8).

#### T8.2 — Snapshot / restore
`sim.snapshot()` + `createSimFromSnapshot(snapshot, config-sans-seed)` in `packages/sim`. Captures `SimState` + RNG state + `nextEntityId`. Init-constants (arena/tuning/players/friendlyFire/teamsMode) are supplied by the caller, not stored in the snapshot (they're the session contract).
**Accept:** N1.

#### T8.3 — Rollback identity + divergence tests
Headless Node tests building on the scripted-bot harness from T0.9: snapshot mid-round, replay tail, assert byte-identical; divergent-tail-then-reconverge.
**Accept:** N2, N3.

#### T8.4 — Input serialization
`serializeInput`/`deserializeInput` + versioned frame (de)serializer in `packages/sim`, tagged with `SIM_VERSION`; exhaustive round-trip + version-mismatch tests.
**Accept:** N5.

#### T8.5 — Cross-engine determinism guard
State-hash-every-K-ticks over the bot round; golden hash fixture; CI re-verifies (rides the existing Windows-dev/Linux-CI split as the cross-OS check).
**Accept:** N6.

#### T8.6 — `packages/net` skeleton + dep-cruiser
Create the workspace with the transport interface and prediction/rollback types only (no impl). Extend `.dependency-cruiser.cjs`: allow `net→sim`, forbid `sim→net` and any Phaser/DOM in either.
**Accept:** N7; `npm run check:deps` passes and fails on a deliberate `sim→net` import (dry run, revert).

### Out of scope for 008 (do not build, do not stub)

- Any transport implementation, clock sync, jitter buffer, or prediction loop (that's 009).
- Any browser, WebRTC, WebSocket, Cloudflare, or signaling code (010+).
- Lag compensation, spectators, reconnection, host migration (012–013).
- Snapshot **delta/diff** compression — full snapshots are tiny; deltas are a 009+ optimization only if measured necessary.
- Touching `setTuning` behavior beyond documenting that net sessions pin tuning.

---

## Phase 009 — Session layer: predict / rollback over a loopback transport

**Status: planning — awaiting owner confirmation of this breakdown before code.**

**Goal:** a complete host-authoritative session — clock/tick sync, input delay, jitter buffer, host loop, and client prediction + rollback — running entirely inside `packages/net`, headless, over an **in-process loopback transport** with injected latency / jitter / loss. No browser, no real network, no Cloudflare. When 009 lands, the hard real-time risk (does prediction + rollback actually converge under bad network conditions?) is retired in a deterministic, CI-gated test bed; 010 only swaps the loopback for a real transport.

This is pure `packages/net` work on top of the 008 primitives (`snapshot`/`createSimFromSnapshot`/`step`, the input wire, the transport + session **types**). **The sim is not touched at all** — so the golden FFA log and `golden-state-hashes.json` stay byte-identical by construction.

**Definition of done:** the acceptance criteria below pass in `npm test` + the CI gate; `check:deps` still green (`net → sim` only); the sim is unchanged.

### Spec-level acceptance criteria

- [ ] M1. **Loopback transport.** An in-process `LoopbackNetwork` implements the 008 `Transport` / `TransportServer` interfaces and connects one host to N clients. It is driven by an explicit tick clock (no wall-time) and injects, per a **seeded mulberry32** (from the sim, reused — not the sim's PRNG instance): fixed + jittered delivery delay and per-message drop probability. Same seed + same sends ⇒ identical delivery schedule (the whole test bed is deterministic).
- [ ] M2. **Message codec.** Encode/parse for the remaining `NetMessage` kinds on top of T8.4's input frame: `AuthoritativeInputsMessage`, `SnapshotMessage`, `AckMessage`, behind a 1-byte message-type tag and the existing `PROTOCOL_VERSION`. Exhaustive round-trips; a version/format mismatch is a typed, catchable error (`ProtocolVersionError` / `WireFormatError`).
- [ ] M3. **Host session.** `HostSession` buffers client inputs keyed by `(tick, slot)`, applies a fixed input-delay window, and on each authoritative tick: fills any missing client input by a **deterministic** policy (repeat-last, else neutral), `step()`s the canonical sim, and broadcasts `AuthoritativeInputs(tick)` + a `Snapshot` every `snapshotIntervalTicks` + `Ack`s. Late inputs for an already-committed tick are dropped (counted, not applied).
- [ ] M4. **Clock / tick sync.** A client estimates the host's current tick from ack round-trips (RTT/2 + smoothing) and targets `hostTick + inputDelay` so its inputs arrive just in time. Converges to within ±1 tick under fixed delay and stays bounded under jitter.
- [ ] M5. **Client prediction + rollback.** `RollbackController` predicts the local input immediately and guesses remote inputs (repeat-last); on `AuthoritativeInputs(tick, inputs)` it confirms cheaply if the prediction matched, else restores the last confirmed snapshot and **re-simulates forward** — a visible correction occurs **iff** a remote input actually differed from the guess. `resync(snapshot)` hard-resets to a host snapshot. Rollback never exceeds `maxRollbackTicks` (beyond it, wait for the next snapshot).
- [ ] M6. **End-to-end convergence.** Host + 2–4 bot-driven clients over the lossy loopback play a full round. Every client's **confirmed** state equals the host's state at each confirmed tick **byte-for-byte** (FNV-1a over snapshots) under `{0% loss, 10% loss, heavy jitter}`; a client forced past `maxRollbackTicks` recovers via the next snapshot; and the whole run is reproducible (same seed ⇒ identical rollback/correction trace).
- [ ] M7. **Net params are data.** Session knobs (`inputDelayTicks`, `snapshotIntervalTicks`, `maxRollbackTicks`, `jitterBufferTicks`) live in a shell/net-only `net` block in `content/tuning.json` (owner-confirmed; mirrors the sim-ignored `juice`/`input`/`ui` blocks), validated by `parseNetParams` in `packages/net`; the sim ignores them.

### Fixed design points

- 009 is **headless and engine-free**: `packages/net` still imports only `@shoot-and-run/sim`. The loopback, host, and client are plain objects driven by an explicit `advance(tick)` loop in tests (the real 60 Hz accumulator wiring is the shell's job in 011).
- Convergence is the invariant, not timing: host authority + deterministic re-sim mean the **converged** state is identical regardless of delivery order; only the *path* (mispredictions, rollbacks) varies with the network. Tests assert the invariant and bound the path.
- All injected randomness (jitter/loss) uses a **seeded** PRNG so failures reproduce; no `Math.random`/`Date.now` (lint guard already enforces this in `packages/net`... extend the guard's glob to net if needed).
- Snapshots cross the wire as the plain 008 `SimSnapshot` (JSON-encoded payload for now). **Delta/diff compression stays deferred** (008 out-of-scope) until a measurement says full snapshots cost too much.
- No lag compensation, reconnection, spectators, or host migration (012–013). No security/anti-cheat (a client can lie to the loopback; trust posture is a dedicated-server concern, 012).

### Tasks

#### T9.0 — Loopback transport (latency / jitter / loss, seeded, clock-driven)
Implement `LoopbackNetwork` + the `Transport`/`TransportServer` impls in `packages/net`; deterministic delivery schedule from a seeded PRNG; `advance(tick)` delivers all due datagrams. Unit tests for delay, reordering, drop, and seed-reproducibility.
**Accept:** M1.

#### T9.1 — NetMessage wire codec
Add tagged encode/parse for `AuthoritativeInputsMessage` / `SnapshotMessage` / `AckMessage` (inputs already covered by T8.4), versioned, with typed errors. Round-trip tests for every kind.
**Accept:** M2.

#### T9.2 — Host session loop
Implement `HostSession`: input buffer, input-delay window, deterministic missing-input fill, canonical `step()`, broadcast of authoritative inputs + periodic snapshots + acks; drop+count late inputs. Tests over the loopback with one scripted client.
**Accept:** M3.

#### T9.3 — Clock / tick sync
Client-side host-tick estimator from acks (RTT/2 + smoothing) targeting `hostTick + inputDelay`. Tests: convergence under fixed delay, boundedness under jitter.
**Accept:** M4.

#### T9.4 — Client prediction + rollback controller
Implement `RollbackController` (predict local + guess remote, confirm/rollback/re-sim, `resync`, `maxRollbackTicks` cap). Tests: matched prediction = no correction; one changed remote input = exactly one bounded rollback that matches the host.
**Accept:** M5.

#### T9.5 — End-to-end convergence harness (lossy loopback)
Host + 2–4 bot clients over the lossy loopback for a full round; assert byte-identical client/host confirmed state under {0%, 10% loss, heavy jitter}, snapshot recovery past `maxRollback`, and seed-reproducible traces.
**Accept:** M6.

#### T9.6 — Net params as data + verification sweep + docs
Move the session knobs into content (per O1), validate in `packages/net`; full gate sweep; update CLAUDE.md (content-as-data table, structure, Decisions Log) and mark Phase 009 done in this spec.
**Accept:** M7; gate green; sim/golden artifacts untouched.

### Open questions (resolve before / during T9.6)

- **O1 — where do net params live? RESOLVED (owner, 2026-06-15):** a shell/net-only `net` block in `content/tuning.json`, mirroring the sim-ignored `juice`/`input`/`ui` blocks, validated by a new `parseNetParams` in `packages/net`. (Separate `content/net.json` rejected.)
- **O2 — missing-input fill policy.** Repeat-last is proposed for both host (committing a tick with a missing client input) and client (predicting remote inputs). Confirm this over alternatives (hold-neutral, or freeze-and-wait) — repeat-last is the standard rollback choice and minimizes corrections for held inputs.
- **O3 — loopback fidelity.** The loopback models delay/jitter/loss but not bandwidth or duplication. Assumed sufficient for proving convergence; real-transport quirks (TCP head-of-line, WebRTC dup) are exercised in 010+.

### Out of scope for 009 (do not build, do not stub)

- Any real transport (WebSocket/WebRTC), signaling, room codes, Cloudflare/`workerd`, or `packages/server` (010–011).
- Any browser / Phaser wiring of the session into the live game loop (011).
- Lag compensation, reconnection, spectators, host migration, anti-cheat (012–013).
- Snapshot delta compression (deferred until measured necessary).
