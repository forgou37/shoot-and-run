# Spec 008 — Online Multiplayer

**Status:** planning. Owner-directed reversal of "online permanently out of scope" (hard rule 1 escape clause + "Explicitly never" in backlog). This spec is the umbrella; each phase below becomes its own numbered spec (008–013) when promoted. Only the **Foundation** phase (008) has a task-level breakdown here — later phases are scoped at the goal/acceptance level until their predecessors land.

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
| **008** | Netcode foundation: snapshot/restore, input (de)serialization, determinism hardening, headless rollback harness | no | 007 done ✓ |
| 009 | `packages/net` session layer: clock/tick sync, input delay, jitter buffer, prediction/rollback loop — over a loopback transport with injected latency/jitter/loss | no | 008 |
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

### Spec-level acceptance criteria

- [ ] N1. `sim.snapshot()` returns a structurally-cloned, JSON-serializable value capturing **all** sim state needed to resume: `SimState`, the RNG internal state, and `nextEntityId`. `createSimFromSnapshot(snapshot, { arena, tuning, players, friendlyFire })` reconstructs a sim that is `step()`-for-`step()` identical to the original.
- [ ] N2. **Rollback identity:** create sim A, step N ticks with input log L, snapshot at tick K<N, then: (a) continuing A to N and (b) restoring from the K-snapshot and stepping the tail of L produce byte-identical state and event logs at tick N.
- [ ] N3. **Divergence + reconverge:** from a tick-K snapshot, stepping a *different* tail L′ diverges; re-restoring K and stepping the original L returns to A's tick-N state byte-for-byte (proves restore fully resets hidden state — RNG, counters).
- [ ] N4. RNG exposes `getState()/setState()` (or equivalent); `createRng` seeded then advanced M times, state captured, a fresh rng `setState`'d to it, produces an identical next stream. No behavioral change to the existing seed→stream mapping (golden log unaffected).
- [ ] N5. `serializeInput(PlayerInput): Uint8Array` (1 byte) and `deserializeInput`; round-trips for all 128 combinations. A versioned `serializeInputFrame(tick, inputs[])` / parser, tagged with `SIM_VERSION`; a version mismatch is a typed, catchable error.
- [ ] N6. **Cross-engine determinism guard:** a checked-in golden state-hash sequence (e.g. FNV-1a over `snapshot()` every K ticks of the scripted-bot round) re-verified in CI. Extends the existing Windows/Linux golden-log proof to a state-level hash. (Browser-engine verification is wired in 010 when a browser is in the loop; 008 covers the Node/V8 + state-hash guard.)
- [ ] N7. `packages/net` workspace exists with the transport **interface only** (no implementation) and is added to `check:deps`: `net → sim` allowed, `sim → net` forbidden, neither imports Phaser/DOM.
- [ ] N8. The existing golden FFA determinism log stays **byte-identical** (snapshot/RNG-exposure changes are additive; no gameplay path changes).

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
