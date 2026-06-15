# Spec 008 — Online Multiplayer

**Status:** planning. Owner-directed reversal of "online permanently out of scope" (hard rule 1 escape clause + "Explicitly never" in backlog). This spec is the umbrella; each phase below becomes its own numbered spec (008–013) when promoted. **Phases 008, 009, and 010 are done** (T8.1–T8.6, T9.0–T9.6, T10.0–T10.6). Phase 010 was owner-re-scoped 2026-06-15 to the cheapest tangible win — a real WebSocket transport + local two-tab play, *before* any Cloudflare — and landed: two browser tabs play a full match against a local dedicated Node host on `localhost`, converging byte-for-byte. Phases 011+ stay scoped at the goal/acceptance level until their predecessors land.

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
| **010** | **Real WebSocket transport + local online play**: browser + Node `ws` adapters on the 009 `Transport` seam, a local dedicated Node host, and an online Phaser scene — **two browser tabs play a full match on `localhost`**. No Cloudflare, no signaling, no room codes, no `packages/server`. **Done** (T10.0–T10.6, below). | no (localhost only) | 009 ✓ |
| 011 | **Cloudflare signaling + dedicated server — first internet match**: `packages/server` headless host on a Durable Object, Worker + DO signaling + room codes (moved here from 010); browser stays a pure prediction client | **yes — first internet match** | 010 |
| 012 | Player-hosted / listen-server: one browser becomes the Host; WebRTC DataChannel P2P; NAT traversal + TURN; host-leaving policy | yes (P2P) | 011 |
| 013 | Polish: lag-comp tuning, spectators, reconnection, metrics/telemetry, anti-cheat posture, host migration | — | 012 |

### Transport note (consequence of "dedicated first")

Online play starts on **WebSocket** (TCP): **010** runs it to a local dedicated Node host (no signaling/TURN); **011** moves the same adapter to the Durable Object. The rollback design tolerates moderate jitter/loss, but TCP head-of-line blocking hitches under packet loss. The `packages/net` transport interface (009) keeps this swappable: WebRTC **DataChannel (unreliable + unordered)** arrives with player-hosting in 012, and WebTransport datagrams are a later drop-in if CF/browser support firms up. Document the TCP-HOL caveat honestly in 010 (carried into 011).

### New workspaces

- `packages/net` — depends on `sim`, **never Phaser/DOM**. Transport interface + session/prediction/rollback logic, plus (010) the pure transport-agnostic `ClientSession` + `HostRuntime` orchestrators. Loopback-testable in Node. (`net` may import `sim`; `sim` still imports nothing outside itself.)
- `packages/server` — the dedicated host = `sim` + `net`, runs in `workerd` (Durable Object) and Node. No renderer. **Created in 011**; 010's localhost host is a dev-only Node script (run via `tsx`) instead, carrying the `ws`→`TransportServer` adapter that graduates into `packages/server` then.
- `packages/game` gains (010) a browser `WebSocketTransport` + an online ArenaScene driving a `ClientSession`; the online lobby/join UI + disconnect polish land with 011+. Reuses the existing accumulator-freeze for pause.

---

## Phase 008 — Netcode foundation

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

**Status: done** (T9.0–T9.6, 2026-06-15). Full gate green — typecheck/lint/check:deps + all Vitest suites (34 net tests); the sim is untouched, so the golden event log and `golden-state-hashes.json` are byte-identical.

**Goal:** a complete host-authoritative session — clock/tick sync, input delay, jitter buffer, host loop, and client prediction + rollback — running entirely inside `packages/net`, headless, over an **in-process loopback transport** with injected latency / jitter / loss. No browser, no real network, no Cloudflare. When 009 lands, the hard real-time risk (does prediction + rollback actually converge under bad network conditions?) is retired in a deterministic, CI-gated test bed; 010 only swaps the loopback for a real transport.

This is pure `packages/net` work on top of the 008 primitives (`snapshot`/`createSimFromSnapshot`/`step`, the input wire, the transport + session **types**). **The sim is not touched at all** — so the golden FFA log and `golden-state-hashes.json` stay byte-identical by construction.

**Definition of done:** the acceptance criteria below pass in `npm test` + the CI gate; `check:deps` still green (`net → sim` only); the sim is unchanged.

### Spec-level acceptance criteria

- [x] M1. **Loopback transport.** An in-process `LoopbackNetwork` implements the 008 `Transport` / `TransportServer` interfaces and connects one host to N clients. It is driven by an explicit tick clock (no wall-time) and injects, per a **seeded mulberry32** (from the sim, reused — not the sim's PRNG instance): fixed + jittered delivery delay and per-message drop probability. Same seed + same sends ⇒ identical delivery schedule (the whole test bed is deterministic). _(loopback.ts)_
- [x] M2. **Message codec.** Encode/parse for the remaining `NetMessage` kinds on top of T8.4's input frame: `AuthoritativeInputsMessage`, `SnapshotMessage`, `AckMessage`, behind a 1-byte message-type tag and the existing `PROTOCOL_VERSION`. Exhaustive round-trips; a version/format mismatch is a typed, catchable error (`ProtocolVersionError` / `WireFormatError`). _(codec.ts)_
- [x] M3. **Host session.** `HostSession` buffers client inputs keyed by `(tick, slot)`, applies a fixed input-delay window, and on each authoritative tick: fills any missing client input by a **deterministic** policy (repeat-last, else neutral), `step()`s the canonical sim, and broadcasts `AuthoritativeInputs(tick)` + a `Snapshot` every `snapshotIntervalTicks` + `Ack`s. Late inputs for an already-committed tick are dropped (counted, not applied). _(host.ts)_
- [x] M4. **Clock / tick sync.** A client estimates the host's current tick from ack round-trips (RTT/2 + smoothing) and targets `hostTick + inputDelay` so its inputs arrive just in time. Converges to within ±1 tick under fixed delay and stays bounded under jitter. _(clock.ts)_
- [x] M5. **Client prediction + rollback.** `RollbackController` predicts the local input immediately and guesses remote inputs (repeat-last); on `AuthoritativeInputs(tick, inputs)` it confirms cheaply if the prediction matched, else restores the last confirmed snapshot and **re-simulates forward** — a visible correction occurs **iff** a remote input actually differed from the guess. `resync(snapshot)` hard-resets to a host snapshot. Rollback never exceeds `maxRollbackTicks` (beyond it, wait for the next snapshot). _(rollback.ts)_
- [x] M6. **End-to-end convergence.** Host + 2–4 bot-driven clients over the lossy loopback play a full round. Every client's **confirmed** state equals the host's state at each confirmed tick **byte-for-byte** under `{0% loss, 10% loss, heavy jitter}`; a client forced past `maxRollbackTicks` recovers via the next snapshot; and the whole run is reproducible (same seed ⇒ identical result). _(convergence.test.ts; clients are deterministic scripted inputs — real bots integrate at the shell in 011)_
- [x] M7. **Net params are data.** Session knobs (`inputDelayTicks`, `snapshotIntervalTicks`, `maxRollbackTicks`, `jitterBufferTicks`) live in a shell/net-only `net` block in `content/tuning.json` (owner-confirmed; mirrors the sim-ignored `juice`/`input`/`ui` blocks), validated by `parseNetParams` in `packages/net`; the sim ignores them. _(params.ts)_

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

---

## Phase 010 — Real WebSocket transport + local online play

**Status: done** (T10.0–T10.6, landed 2026-06-15; **owner re-scoped** the original "010 = real transport + Cloudflare signaling" line). The cheapest tangible win was pulled out front: a real WebSocket transport on the existing `Transport` seam, wired into the Phaser shell so **two browser tabs play a full match on `localhost`** against a local dedicated Node host — verified converging byte-for-byte by a Playwright two-tab e2e. Everything Cloudflare — signaling (Worker + Durable Object), room codes, and the `packages/server` workspace — moves to **011** (a Cloudflare account is still a pending owner decision and is **not** assumed by this phase). Full gate green: typecheck/lint/check:deps + 211 unit tests + 11 e2e + build; `packages/sim` untouched (golden artifacts byte-identical).

**Goal:** prove the host-authoritative session (008 primitives + the 009 host/clock/prediction/rollback layer) runs over a **real, non-loopback** transport and is wired into the live game loop, on the lowest-risk path: localhost, no internet, no Cloudflare. When 010 lands, the only thing standing between us and an internet match is *where the host runs* and *how clients find it* — i.e. 011 is "move the host to a Durable Object + add signaling/room codes," not "make rollback work over a wire."

This is the first phase that is **not** fully headless. The boundary stays strict: every impure dependency (the DOM `WebSocket`, Node `ws`, a wall-clock `setInterval`, the Phaser scene) lives in `packages/game` or the dev host; `packages/net` gains only **pure, transport-agnostic** orchestration (`ClientSession`, `HostRuntime`) driven by an explicit `tick()`/`step()` over a `Transport`. `packages/sim` is **not touched at all**, so the golden FFA log and `golden-state-hashes.json` stay byte-identical by construction.

### Architecture for this phase

```
   Node dev host  (tsx, 60 Hz setInterval)        Browser tab A (client)        Browser tab B (client)
   ┌───────────────────────────────────┐          ┌─────────────────────┐       ┌─────────────────────┐
   │ ws WebSocketServer → TransportServer │◄──ws───►│ WebSocket→Transport  │       │ WebSocket→Transport  │
   │ HostRuntime (slot assign, decode)    │◄──ws──────────────────────────────────►│                      │
   │ HostSession (canonical sim, 008/009) │          │ ClientSession:       │       │ ClientSession:       │
   │                                       │          │  ClockSync +         │       │  ClockSync +         │
   │                                       │          │  RollbackController  │       │  RollbackController  │
   └───────────────────────────────────┘          │ OnlineArenaScene     │       │ OnlineArenaScene     │
        authoritative (dedicated, Node)             └─────────────────────┘       └─────────────────────┘
                                                       predicts + rolls back          predicts + rolls back
```

The host is the existing `HostSession`, now driven by a real wall clock; the clients are the existing `ClockSync` + `RollbackController`, now routed through a real `WebSocket` and a reusable `ClientSession`. The genuinely new code is small: two `Transport` adapters (browser + Node), a one-message handshake (slot + session params), the host's wall-clock loop, and the client-session orchestrator + its integration into a live Phaser scene.

**Definition of done:** the acceptance criteria below pass in `npm test`, the e2e two-tab test passes in `npm run e2e`, and the full CI gate is green; `check:deps` still passes (`net → sim` only, the `ws`/host live outside `packages/net`); `packages/sim` is unchanged (golden artifacts byte-identical).

### Spec-level acceptance criteria

(Criteria are prefixed **W#** — "wire-up / WebSocket"; tasks below cite the W# they satisfy, mirroring 008's N# / 009's M#.)

- [x] W1. **Browser WebSocket transport.** `WebSocketTransport` in `packages/game` wraps a browser `WebSocket` (binary frames) and implements the 008 `Transport` interface (`send`/`onMessage`/`onClose`/`close`, stable `id`). It lives in the shell (it names the DOM `WebSocket`), never in `packages/net`. Round-trips bytes against a local ws echo (smoke, exercised by the e2e at minimum).
- [x] W2. **Node WebSocket server transport.** A `ws`-based adapter (in the dev host, importing `ws` — never `packages/net`) implements the 008 `TransportServer`, yielding one `Transport` per inbound connection with a host-assigned id. A connect/echo test proves a client `WebSocketTransport` and a server-side `Transport` exchange datagrams over real loopback TCP.
- [x] W3. **Reusable pure `ClientSession` (`packages/net`).** A headless `ClientSession` ties `ClockSync` + `RollbackController` + message routing over any `Transport`: it decodes inbound (`authoritative`→`confirm`, `snapshot`→`resync`, `ack`→clock, `hello`→bootstrap) and, on an explicit `tick(localInput)` (no wall-time), records the local input and sends it tagged at `clockSync.targetTick(...)`. Headless test over the loopback reproduces the 009 convergence result **through the orchestrator** (not inline test wiring): confirmed state stays byte-identical to the host's.
- [x] W4. **Host runtime + handshake (`packages/net`).** A pure `HostRuntime` manages a `TransportServer`: assigns each connection a slot in connection order, sends a `HelloMessage` ({assigned `slot`, `seed`, `playerCount`, `arenaId`}), decodes inbound `input` → `HostSession.receiveInput`, and exposes `step()` (tick the canonical sim + broadcast). The v1 start policy is **wait for all expected clients, then run from tick 0**. `HelloMessage` is added to the protocol + codec behind a new tag and the existing `PROTOCOL_VERSION`, with exhaustive round-trip + version/format-error tests.
- [x] W5. **Local dedicated host process.** A dev-only Node entry (`npm run dev:host`, run via `tsx`) starts the `ws` `TransportServer`, builds `HostRuntime` + `HostSession` from local `content/` (arena/tuning/players pinned at init), and drives `step()` at 60 Hz on a wall clock. Port + expected player count are dev launch config (CLI/env), **not** `content/tuning.json`. This is the dedicated host of the dedicated-first plan, minus Cloudflare.
- [x] W6. **Online Phaser scene + boot path.** An online play path: an `OnlineArenaScene` (or an online mode of `ArenaScene`) that, instead of stepping its own sim, drives a `ClientSession` on the existing fixed-timestep accumulator — sampling the local device for its slot each tick — and renders the predicted sim state through the existing renderers (archer/arrow/environment) with the existing wrap-aware interpolation. Tuning hot-reload is **disabled** in online mode (amendment #4: tuning pinned for the net session). Reached via a URL param for the cheapest win (e.g. `?online=ws://localhost:PORT`), mirroring `?quickstart`.
- [x] W7. **Two-tab match end-to-end.** A Playwright test starts the dev host (a second `webServer`) and opens **two** browser pages as clients; both reach the `match` phase, the match runs with inputs flowing both ways, and a new dev-only `getNetProbe()` hook proves convergence: at a shared confirmed tick each tab's confirmed-state hash equals the other's (byte-identical), and both advance. Zero console / page errors.
- [x] W8. **Purity + determinism held.** `packages/sim` untouched (golden FFA log + `golden-state-hashes.json` byte-identical). `packages/net` gains only pure additions (still imports only the sim); `check:deps` green; `ws`/`tsx` and the Node host live outside `packages/net`. No new game-feel tunables — or any added are justified in the `net` block of `content/tuning.json` (hard rule 3).

### Fixed design points

- **Strict impurity boundary.** All wall-clock, DOM, and Node-only code is in `packages/game` + the dev host. `packages/net` stays pure and transport-agnostic: `ClientSession`/`HostRuntime` take a `Transport`/`TransportServer` and are driven by explicit `tick()`/`step()` — exactly like 009's loopback bed, so they remain unit-testable headlessly and the `net-purity` cruiser rule is unaffected.
- **Dedicated host, not listen-server.** The authoritative host is a real separate Node process (the dedicated-first plan, minus Cloudflare). Neither browser is the host — a browser cannot accept WebSocket connections, and player-hosting/listen-server is explicitly 012. "Two tabs on localhost" means **two clients of one local dedicated host**, three processes total.
- **WebSocket is required (owner-specified), and forces a server endpoint.** Browsers can't peer directly over WS, so a Node `ws` endpoint is necessary even on localhost. (Same-origin tricks like `BroadcastChannel` are rejected: not a WebSocket, and the wrong abstraction to invest in — it doesn't generalize to internet play.)
- **Clock-driven prediction is the main new risk.** The client advances its predicted sim on the shell's existing accumulator; `ClockSync` sets the tick its outgoing inputs are tagged with so they reach the host ~`inputDelayTicks` before it commits that tick. Keeping the predicted lead inside the `maxRollbackTicks` window under **real, variable, wall-clock** latency — not 009's virtual clock — is the integration risk this phase retires. `ClockSync` is integrated end-to-end with prediction here for the first time.
- **Session params by deployment, not by wire (for now).** Both sides load the same `content/` (localhost), so the `HelloMessage` carries only `seed`, `arenaId`, `playerCount`, and the assigned `slot`; arena/tuning are taken from shared local content and pinned at session init. Over-the-wire content/tuning negotiation (and the cross-build mismatch story beyond `PROTOCOL_VERSION`) is 011+.
- **Wire shapes unchanged from 009.** Inputs are 1 byte/tick; snapshots cross as the JSON `SimSnapshot` (009 codec); WS frames are binary. Snapshot delta compression stays deferred until measured necessary.
- **TCP head-of-line caveat, documented honestly.** WebSocket is TCP, so packet loss hitches all subsequent frames; rollback tolerates jitter/reorder but cannot hide HOL stalls. Acceptable for localhost/v1; the unreliable transport (WebRTC DataChannel) is 012, swappable behind the same `Transport` seam.
- **No `packages/sim` change; no new game-feel tunables.** This phase is transport + wiring, not feel.

### Tasks

#### T10.0 — Handshake message + codec (`HelloMessage`)
Add `HelloMessage { type: "hello", slot, seed, playerCount, arenaId }` to [protocol.ts](packages/net/src/protocol.ts); encode/decode in [codec.ts](packages/net/src/codec.ts) behind a new 1-byte tag and the existing `PROTOCOL_VERSION`; exhaustive round-trip + `ProtocolVersionError`/`WireFormatError` tests (incl. an unknown/short `arenaId`).
**Accept:** W4 (codec part).

#### T10.1 — Pure `ClientSession` orchestrator (`packages/net`)
Implement `ClientSession`: bootstrap from `hello`, route `authoritative`/`snapshot`/`ack` into `RollbackController` + `ClockSync`, and on an explicit `tick(localInput)` record + send the local input tagged at the clock-targeted tick. Expose readables a renderer needs (e.g. `predictedState()` / `confirmedTick`). Headless test over the loopback reproduces 009 convergence through the orchestrator (byte-identical confirmed state under clean + lossy + jittery networks).
**Accept:** W3.

#### T10.2 — Pure `HostRuntime` (`packages/net`)
Implement `HostRuntime` over `TransportServer`: connection→slot assignment, `hello` on connect, decode `input` → `HostSession.receiveInput`, `step()` wrapper; "wait for all expected, start at tick 0" policy + drop/count of unknown-client traffic. Headless test: `HostRuntime` + N `ClientSession`s over the loopback converge byte-for-byte (the 009 convergence proof, re-expressed on the reusable runtime + session pair).
**Accept:** W4 (runtime part); folds the loopback convergence proof onto the reusable pieces.

#### T10.3 — Browser `WebSocketTransport` (`packages/game`)
Wrap a browser `WebSocket` (binary `arraybuffer`) as a 008 `Transport` in `packages/game/src/net/`. Handle open buffering, `onmessage`→handler (`Uint8Array`), `onclose`→close handler. Smoke-tested via the e2e (and/or a small ws echo).
**Accept:** W1.

#### T10.4 — Node `ws` `TransportServer` + dev host entry
Implement the `ws`→`TransportServer` adapter and a dev-only Node entry (`scripts/dev-host.ts` or similar) run via `tsx` as `npm run dev:host`: build `HostRuntime` + `HostSession` from local `content/`, 60 Hz wall-clock loop, port + player count from CLI/env. Add `ws` + `tsx` as root devDeps; add the `dev:host` script.
**Accept:** W2, W5.

#### T10.5 — Online Phaser scene + boot route
`OnlineArenaScene` driving a `ClientSession` on the existing accumulator (sample local device → `tick(localInput)`), rendering predicted state through the existing renderers + interpolation; `?online=ws://...` boot route (in `BootScene`, alongside `?quickstart`); disable tuning hot-reload online; add online `__testApi` probes (`getNetProbe()`; `getState()` reads predicted state). Minimal disconnect handling: a closed socket pauses/ends via the existing accumulator-freeze.
**Accept:** W6.

#### T10.6 — Two-tab e2e + verification sweep + docs
Playwright two-page online test with the dev host as a second `webServer`; assert both tabs reach `match`, inputs flow both ways, and `getNetProbe()` shows byte-identical confirmed-state hashes at a shared confirmed tick; zero console errors. Full local gate + e2e sweep. Update CLAUDE.md (Commands: `dev:host`; Project structure: shell `net/` + dev host + `ws`/`tsx` devDeps; Content-as-data note that the `net` block is unchanged; Decisions Log: the 010 re-scope, WS-on-localhost + dedicated-Node-host, and the TCP-HOL caveat) and the specs roadmap rows; mark Phase 010 done.
**Accept:** W7, W8; gate + e2e green; sim/golden artifacts untouched.

### Open questions (resolve before / during 010)

- **OA — Host process home.** Dev-only `scripts/` entry run via `tsx` (proposed) vs creating a minimal `packages/server` workspace now. Proposed: keep it a script — `packages/server` (the `workerd`/DO target) is explicitly deferred to 011 per owner. The `ws`→`TransportServer` adapter is written so it graduates into `packages/server` unchanged.
- **OB — Start / join policy.** "Host waits for all expected clients, then starts at tick 0" (proposed, simplest, no mid-join catch-up) vs allowing late join via the periodic snapshot (`resync` already supports it). Proposed: wait-for-all for v1; mid-session join is 011+.
- **OC — Content negotiation.** Both sides share `content/` by deployment, so `HelloMessage` carries only `seed`/`arenaId`/`playerCount`/`slot` and arena+tuning come from local content. Real over-the-wire content/tuning negotiation (host and client on different builds) is 011+; `PROTOCOL_VERSION` already rejects mismatched protocol builds today.
- **OD — New tunables.** Expected: none (port/player-count are launch config; interpolation reuses the existing `alpha`). If a genuine client knob emerges (extra interpolation delay, input resend cadence, a tighter prediction clamp), it lands in the `net` block of `content/tuning.json` (hard rule 3), never in source — flagged here so it's a conscious choice, not a drive-by constant.
- **OE — Run-it script ergonomics.** Whether `npm run dev` should optionally spawn the dev host too (one command for the demo) or stay separate (`dev` + `dev:host` in two terminals). Proposed: keep them separate for clarity; revisit if the e2e or the owner wants a single command.

### Out of scope for 010 (do not build, do not stub)

- Any Cloudflare Worker / Durable Object / Pages Functions, the `packages/server` workspace, or deploying the host anywhere but `localhost` (011).
- Signaling service, room codes, matchmaking, or a lobby-driven online-join UI (011) — 010 connects via a URL param to a known host address.
- WebRTC / DataChannel / P2P / listen-server (a browser as host), NAT traversal, TURN (012).
- Lag compensation, reconnection, spectators, host migration, anti-cheat (012–013).
- Snapshot delta/diff compression (deferred until measured necessary).
- Over-the-wire content/tuning negotiation, and late/mid-session join beyond the existing snapshot `resync` (011+).
- TCP head-of-line mitigation — 010 documents the caveat; the unreliable transport is 012.
- Touching `packages/sim` or regenerating any golden artifact (this phase needs neither).
