# Spec 013 — Netplay polish (dedicated-server): spectators, reconnection, metrics, anti-cheat posture & lag-comp tuning

**Status:** planning. Part of the spec 008 online-multiplayer umbrella. This promotes **five of the six** items the umbrella parked under "013 Polish" (`specs/008-netcode.md` roadmap) — everything that sits on the **existing dedicated-server stack (011)** and needs no player-hosting. **Host migration is carved out** and moves to 012, because it is only meaningful when the host is a player who can quit; on a dedicated host there is no peer to migrate authority to (the umbrella already says "Dedicated mode sidesteps it", [008-netcode.md:55](008-netcode.md:55)). Consequently this spec's gate is **011 ✓**, not 012 — see the roadmap amendment below (needs owner sign-off).

**Goal:** make the self-hosted internet match (011) pleasant to actually run and play among friends: a friend can **watch** without taking a slot, a friend who **drops can rejoin** the match in progress, the host operator and players can **see what the netcode is doing** (RTT, rollback, loss), an internet-facing host has a basic **defensive posture** against junk/abuse, and the input-delay / correction feel is **tunable as data**. Still host-authoritative, still byte-for-byte convergent (008/009/010/011 core unchanged), still **no game logic leaves `packages/sim`**.

**Definition of done:** the acceptance criteria below pass in `npm test`; an e2e runs the `packages/server` host with a player tab + a spectator tab + a drop/rejoin to a converging match; the full CI gate + e2e are green; `check:deps` still passes (`server → {net, sim}`, `net → sim`, neither imports Phaser/DOM); `packages/sim` is unchanged (golden FFA log + `golden-state-hashes.json` byte-identical); the deployment doc gains the new env/knobs.

---

## Why this is possible without 012 (the reorder)

The umbrella ordered 013 after 012 as a convenience (P2P was the headline of 012), not as a hard dependency. Mapped against the **011 dedicated-server** stack that already exists:

| 013 item | Needs 012 (player-hosting)? | Where it lives on the 011 stack |
|---|---|---|
| Spectators | No — *easier* on a server | Host already broadcasts authoritative + snapshots; add a read-only role that takes no slot and never gates the start. |
| Reconnection | No — *simpler* on a server | The authoritative state lives on the host that does **not** leave; a dropped client re-handshakes and `resync`s from the next snapshot. (P2P reconnection is the hard one.) |
| Metrics / telemetry | No | Pure instrumentation of `ClientSession` / `HostRuntime` counters + a shell overlay + host stdout. |
| Anti-cheat posture | No — *belongs* on the trusted host | The umbrella repeatedly calls this "a dedicated-server concern" ([008-netcode.md:173](008-netcode.md:173), [:383](008-netcode.md:383)). Input validation / rate-limiting / optional join token on the trusted host. |
| Lag-comp tuning | No | A knob on the existing input-delay + rollback machinery; transport-agnostic. |
| **Host migration** | **Yes** | Only meaningful with a player-host. **Deferred to 012.** |

## Roadmap amendment (applied with this spec)

The owner delegated these calls; applied across the planning docs in this spec's commit (spec discipline, hard rule 1 — the Decisions Log row lands when 013 lands, per T13.6, matching the netcode precedent of logging phases at landing):

1. **`specs/008-netcode.md` + `specs/backlog.md` roadmap rows:** the old "013 Polish" row is split into **013 (this spec)** gated on **011 ✓** and **host migration → 012** (folded into the player-hosting/listen-server phase, where host-leaving policy already lives). 013 no longer depends on 012. The 008 "Postures" notes for host migration (→012) and lag compensation (model corrected) are updated to match.
2. **Lag-comp posture correction** (OA, resolved): the 008 posture floated "default modest shooter-favor" server-rewind ([008-netcode.md:56](008-netcode.md:56)). In the deterministic host-authoritative **rollback** model actually shipped in 009–011, per-client hit-rewind is incompatible with deterministic convergence, so it is **rejected**; "lag-comp tuning" is redefined here as **input-delay strategy + rollback-correction smoothing**.

---

## What's already done vs what 013 adds

011 delivered the converging internet match: `HostRuntime` (connection→slot in order, `hello` with content `version`, wait-for-all-then-tick-0), `HostSession` (canonical sim, input buffer, repeat-last fill of a missing/disconnected slot, periodic snapshots + acks), `ClientSession` (`ClockSync` bootstrap + `RollbackController` over any `Transport`), `packages/server` (`ws` host, optional direct-TLS), and the Title→Online join menu. **013 changes none of that core.** It adds, around it:

1. **A client→host `join` message** (the one real protocol addition) carrying `{ role, version, reconnectToken? }`, so the host can assign a slot by *intent* (player vs spectator vs rejoining-a-specific-slot) instead of blind connection order. Today the only client→host messages are `input` and `ping`, and slots are a monotonic counter ([host-runtime.ts:107-126](../packages/net/src/host-runtime.ts)) — that's the seam everything else hangs off.
2. **Spectator role** — net + shell.
3. **Reconnection** — host tracks per-slot occupancy (connected / disconnected-but-reserved) instead of a one-way counter; client auto-reconnects and `resync`s.
4. **Net metrics** — counters surfaced into a shell debug overlay + host stdout.
5. **Anti-cheat / hardening posture** — datagram/size/rate caps, far-future input clamp, optional join token.
6. **Lag-comp tuning** — input-delay strategy + correction smoothing, all as `net`-block data.

### Architecture delta

```
   packages/server (unchanged host loop)        Friends' browsers (Pages client)
   ┌────────────────────────────────────┐      ┌── player tab ──┐  ┌── spectator tab ──┐
   │ HostRuntime:                         │◄─join {role,ver,tok}─┤  │ join {role:spectate}│
   │  · reads `join`, assigns by intent   │      │ ClientSession │  │ ClientSession      │
   │  · per-SLOT occupancy (not a counter)│◄─wss─┤ (+reconnect)  │  │ (spectator: no in) │
   │  · spectator fan-out (no slot/gate)  │      │ +net overlay  │  │ +net overlay       │
   │  · rate/size/lead caps + join token  │      └───────────────┘  └────────────────────┘
   │  · stdout metrics                     │         predict + roll back     follow (confirmed)
   └────────────────────────────────────┘
```

---

## Spec-level acceptance criteria

Criteria are prefixed **P#** — "polish" — mirroring 008's N# / 009's M# / 010's W# / 011's S#. Tasks below cite the P# they satisfy.

### Handshake foundation
- [ ] P1. **`join` handshake.** A new client→host `JoinMessage { type:"join", role:"player"|"spectator", version, reconnectToken? }` is sent by the client immediately on socket open; the host assigns the connection based on it (player slot / spectator / reclaimed slot) and *then* sends `hello`. The **host** now rejects a version mismatch loudly (typed close reason → client shows the friendly message), in addition to the client-side self-check from 011 (S4). Round-trip + version/format-error + unknown-role tests. The `?online=`/menu happy path still reaches a converging match (existing e2e green).

### Spectators
- [ ] P2. **Spectator role.** A connection with `role:"spectator"` is **not** assigned a player slot, does **not** count toward the wait-for-all start gate, and is **never** expected to send input (none is read from it). The host fans out `hello` (with a sentinel "spectator" slot), authoritative inputs, and snapshots to spectators exactly as to players. Spectator count is capped by `net.maxSpectators` (extra spectators rejected with a clear reason). Headless test: a host with N players + M spectators starts when the N players are in (spectators don't block/advance the gate), and each spectator's **confirmed** state is byte-identical to the host's. A spectator dropping never disturbs the match.
- [ ] P3. **Spectate in the shell.** The Online menu offers **Spectate** (or a `?spectate` deep-link) → joins as a spectator → an `OnlineArenaScene` in follow mode: renders the confirmed authoritative state (no local prediction, no input sampling), with a small "SPECTATING" marker. No console errors; e2e covers one spectator tab following a 2-player match.

### Reconnection
- [ ] P4. **Host-side slot occupancy + reconnect.** The host tracks each player slot as `connected | disconnected`, replacing the monotonic `connections` counter for player gating. On a player socket close mid-match the slot becomes `disconnected` and is held **reserved** for `net.reconnectGraceTicks`; its inputs continue to be repeat-last/neutral filled (existing S6 policy). A reconnecting client presenting the matching `reconnectToken` in its `join` reclaims that exact slot, receives `hello` + an immediate `snapshot`, and resumes; after the grace window the slot stays filled for the rest of the match and a late reconnect is refused with a clear reason. The host issues the token (in `hello`) so it's unforgeable per session; the client stashes it in memory + `localStorage`. Headless tests: drop-and-rejoin within grace re-converges byte-for-byte from the snapshot; rejoin after grace is refused; a wrong/absent token never steals an occupied or reserved slot.
- [ ] P5. **Client-side auto-reconnect.** On an unexpected socket close mid-match the `ClientSession`/scene attempts a bounded auto-reconnect (a few tries, fixed backoff from `net`), presenting its `reconnectToken`; on success it `resync`s from the host snapshot, re-runs the clock bootstrap (011 S3), and resumes prediction; on exhaustion it returns to the menu with "Disconnected" (existing posture). e2e: a tab is forced to drop and rejoins the same match, converging.

### Metrics / telemetry
- [ ] P6. **Net metrics surfaced.** `ClientSession` exposes a readonly metrics struct (smoothed RTT, clock offset/lead, rollback depth + frequency, mispredict rate, snapshot/resync count, late-drop count, frame/tick health). A shell **net debug overlay** (toggle: `?netdebug=1` and a dev key) renders it via the pixel font over the online scene; `getNetProbe()` is extended to return the struct for e2e. `HostRuntime` exposes per-slot input-lateness + the existing `lateDropped`/`malformed`/`connectedCount`, and `packages/server` logs a periodic one-line health summary to stdout (for the VPS operator). No PII; friends-only. e2e asserts the overlay shows non-zero RTT and zero errors.

### Anti-cheat / hardening posture
- [ ] P7. **Defensive host posture.** On the trusted dedicated host: (a) inbound datagrams over a max size are dropped+counted (extends the existing bounds-checked codec); (b) per-connection **input rate-limit** (`net.maxInputsPerSecond`) drops+counts floods; (c) inputs tagged further than `net.maxInputLeadTicks` ahead of the host's committed tick are rejected (pairs with the existing late-drop of past-tick inputs — clamps both ends of the valid window); (d) an **optional shared join token** (`JOIN_TOKEN` env on the server; entered once in the menu, `localStorage`-remembered): when set, a `join` lacking it is refused. Explicitly **not** behavioral anti-cheat (no aimbot/wallhack detection — a friends-only deterministic host can't and needn't). Headless tests: oversize/flood/far-future inputs are dropped without disturbing convergence; a wrong/absent join token is refused when the token is configured; everything is a no-op when unset. This is defensive hardening of an internet-facing endpoint, documented as friends-scale.

### Lag-comp tuning
- [ ] P8. **Lag-comp as data (input delay + correction smoothing).** Per OA (resolved). In the deterministic rollback model the levers are (i) **input-delay strategy** — keep fixed `inputDelayTicks` and/or add an opt-in **adaptive** delay bounded by `net.minInputDelayTicks`/`maxInputDelayTicks` that tracks measured RTT so high-latency clients mispredict less; and (ii) **rollback-correction smoothing** — the shell visually eases a predicted→corrected position jump over `net.correctionSmoothingMs` instead of snapping (this also addresses the 010-deferred "interpolation teleport on a rollback correction", [008-netcode.md:325](008-netcode.md:325)). All knobs live in the `net` block (sim ignores them); headless tests cover the adaptive-delay bound math and that smoothing is purely cosmetic (confirmed state byte-identical with it on or off). No Source-style server hit-rewind (incompatible with deterministic convergence — see OA).

### Purity / determinism held
- [ ] P9. **Sim untouched; knobs are data.** `packages/sim` unchanged (golden FFA log + `golden-state-hashes.json` byte-identical); `packages/net` gains only pure additions (still imports only the sim); `ws`/server/TLS/DOM code stays out of `packages/net`; `check:deps` green. Every new game-feel/session knob is in the `net` block of `content/tuning.json` (hard rule 3); server-operator config (`JOIN_TOKEN`, caps that are deployment policy) is launch env, matching 011. Full gate + e2e green.

---

## Fixed design points

- **Core convergence is sacred.** None of these features may change *what state the host commits*. Spectators and metrics are read-only; reconnection re-enters via the existing `resync`; anti-cheat only **drops** untrusted inputs (a dropped input is filled by the existing deterministic repeat-last/neutral policy, so convergence is unaffected by construction); lag-comp tuning changes *when/which* inputs are committed and *how corrections are drawn*, never the deterministic step. The byte-identical-confirmed-hash assertion (`getNetProbe()`) remains the invariant in every test.
- **`join` before `hello` is the one protocol change.** It's additive (new tagged message) behind a bumped `PROTOCOL_VERSION`; the host defers slot assignment until the join arrives. Keep the change minimal: role + version + optional reconnect/join token only — no roster/mode/character negotiation (that's backlog/OC-from-011).
- **A handshake change must not strand a stale cached client.** Because the Pages client and VPS host deploy independently (011), an old browser tab that doesn't send `join` could otherwise hang forever waiting for `hello`. The host therefore keeps a short **join-grace timeout**: if no `join` arrives, it falls back to sending `hello` as a legacy player assignment, and the existing client-side version guard (011 S4) surfaces the friendly "version mismatch — refresh" instead of a silent stall. So the protocol bump degrades to a clear message, never a deadlock.
- **Per-slot occupancy, not a counter.** Reconnection requires the host to know which slots are filled vs reserved-disconnected; the monotonic `connections` counter ([host-runtime.ts](../packages/net/src/host-runtime.ts)) is replaced for player gating (spectators tracked separately). The wait-for-all start gate counts only `connected` players.
- **Deterministic rollback ⇒ no server hit-rewind.** Every client and the host simulate the same tick with the same committed inputs, so "the shooter's view" and "the host's view" of a hit converge by construction; there is no per-client divergence to rewind. Lag is hidden by input delay + prediction, and felt only as an occasional rollback when a remote input was mispredicted. The honest knobs are input-delay strategy and correction smoothing (P8) — not Source-style rewind, which would make canonical state depend on per-client views and break determinism.
- **Trust is friends-scale.** The posture (P7) raises the bar against junk traffic and slot-squatting on an open `wss://`, not against a determined cheater. A deterministic host can't distinguish a human from a local bot policy feeding it legal inputs, and that's fine for a pet project. Documented as such.
- **No `packages/sim` change; no golden-artifact regeneration.** This phase is net/server/shell only.

## New data (all in the `net` block of `content/tuning.json`)

Validated by `parseNetParams` ([params.ts](../packages/net/src/params.ts)); the sim ignores the whole block (mirrors `juice`/`input`/`ui`). Proposed knobs (final names/defaults settled in the tasks):

- `maxSpectators` — cap on spectator connections (e.g. 4).
- `reconnectGraceTicks` — how long a dropped player slot is reserved for rejoin (e.g. 600 ≈ 10 s) before it stays filled for the match.
- `reconnectAttempts` / `reconnectBackoffTicks` — client auto-reconnect bound + spacing.
- `maxInputsPerSecond` — per-connection input flood cap.
- `maxInputLeadTicks` — reject inputs tagged this far ahead of the host's committed tick.
- `correctionSmoothingMs` — shell easing of a rollback position correction (0 = snap, current behavior).
- `adaptiveInputDelay` (bool) + `minInputDelayTicks` / `maxInputDelayTicks` — optional RTT-tracking input delay; when off, the fixed `inputDelayTicks` (already present) is used.

Server-operator config stays **env** (not tuning), extending 011's `PORT`/`PLAYERS`/`SEED`/`ARENA`/`TLS_*`: `JOIN_TOKEN` (optional shared secret; unset = open), and a max-datagram-size constant may stay a code/server constant since it's a protocol safety limit, not game feel.

---

## Tasks

One task per commit (hard rule 5), each prefixed `T13.x`.

#### T13.1 — `join` handshake + host-side version rejection (`packages/net`)
Add `JoinMessage { type:"join", role, version, reconnectToken? }` to [protocol.ts](../packages/net/src/protocol.ts) + [codec.ts](../packages/net/src/codec.ts) behind a new tag; client sends it on open; `HostRuntime` reads it before assigning + sending `hello`, and now rejects a version mismatch host-side (typed close reason) in addition to the client self-check. Exhaustive round-trip + mismatch + unknown-role tests; existing loopback convergence + the `?online=` happy path stay green.
**Accept:** P1.

#### T13.2 — Spectator role (net + shell)
`HostRuntime`: accept `role:"spectator"` without a slot, exclude from the start gate, never read input, fan out hello/authoritative/snapshot, cap at `maxSpectators`. Shell: Online menu **Spectate** + `?spectate`; `OnlineArenaScene` follow mode (render confirmed state, no prediction/sampling, "SPECTATING" marker). Headless N-players+M-spectators convergence test; e2e spectator-follows-a-match.
**Accept:** P2, P3.

#### T13.3 — Reconnection (host occupancy + client auto-reconnect)
Replace the player-gating counter in `HostRuntime` with per-slot `connected|disconnected` occupancy; reserve a dropped slot for `reconnectGraceTicks`; reclaim it on a matching host-issued `reconnectToken` (stamped into `hello`), sending an immediate snapshot; refuse late/forged reclaims. `ClientSession`/scene: bounded auto-reconnect (`reconnectAttempts`/`reconnectBackoffTicks`) → `resync` + clock re-bootstrap → resume; exhaustion → menu. Headless drop/rejoin-within-grace, after-grace-refused, wrong-token tests; e2e drop-and-rejoin converges.
**Accept:** P4, P5.

#### T13.4 — Net metrics + debug overlay + host logging
`ClientSession` metrics struct (RTT, offset/lead, rollback depth/freq, mispredict rate, resync count, late-drop, tick health); shell net overlay (`?netdebug=1` + key, pixel font); extend `getNetProbe()`. `HostRuntime` per-slot lateness; `packages/server` periodic stdout health line. e2e asserts overlay shows live RTT, zero errors.
**Accept:** P6.

#### T13.5 — Anti-cheat / hardening posture (net + server)
Max-datagram-size drop+count; per-connection `maxInputsPerSecond`; far-future input clamp via `maxInputLeadTicks`; optional `JOIN_TOKEN` env enforced in the `join` path. All counted in diagnostics. Headless: oversize/flood/far-future dropped without disturbing convergence; wrong/absent token refused when configured, no-op when unset.
**Accept:** P7.

#### T13.6 — Lag-comp tuning + e2e/docs/verification sweep
Optional adaptive input delay (bounded by `min/maxInputDelayTicks`, tracks RTT) behind `adaptiveInputDelay`; shell rollback-correction smoothing over `correctionSmoothingMs` (cosmetic — confirmed state unchanged). Add all new `net` knobs to `parseNetParams` + `content/tuning.json` + the schema; full Playwright sweep (player + spectator + reconnect); update the deployment doc (docs/05-netcode.md: `JOIN_TOKEN`, spectate URL, the new `net` knobs + recommended internet values) and CLAUDE.md (Commands/Content-as-data/Decisions Log + the roadmap amendment) and the spec/backlog rows; mark Phase 013 done. Confirm `packages/sim` + golden artifacts byte-identical.
**Accept:** P8, P9; gate + e2e green; sim/golden artifacts untouched.

---

## Resolved decisions

These were open questions; the owner delegated them, so they're decided here (revisit only if implementation surfaces a reason):

- **OA — Lag-comp model. RESOLVED:** in the deterministic host-authoritative rollback model, "lag-comp tuning" = **input-delay strategy + rollback-correction smoothing**; Source-style shooter-favored server hit-rewind is **rejected** (it would make canonical state depend on per-client views and break deterministic convergence). Corrects the exploratory 008 posture ([008-netcode.md:56](008-netcode.md:56)).
- **OB — Adaptive vs fixed input delay. RESOLVED:** implement adaptive delay **off by default**; fixed `inputDelayTicks` (documented per-session) stays the shipped behavior, so the convergence proof isn't disturbed unless an operator opts in.
- **OC — Reconnect identity. RESOLVED:** **host-issued** per-session token (stamped into `hello`) — unforgeable, needs no client identity scheme.
- **OD — Spectator scale. RESOLVED:** a hard `net.maxSpectators` cap (small); doubles as a DoS bound on an open `wss://` (ties into P7).
- **OE — Overlay exposure. RESOLVED:** dev-gated for 013 (`?netdebug=1` + a dev key); a player-facing settings toggle is backlog.
- **OF — Correction smoothing location. RESOLVED:** the `net` block (keeps all net knobs together, sim-ignored like the rest of the block).

## Out of scope for 013 (do not build, do not stub)

- **Host migration** — only meaningful with a player-host; **moved to 012** (listen-server host-leaving policy).
- WebRTC / DataChannel / P2P / listen-server / NAT / TURN (012). The unreliable transport and its TCP-HOL fix remain 012, swappable behind the `Transport` seam.
- Behavioral anti-cheat (aimbot/wallhack/replay-of-others detection), accounts, real auth — beyond the friends-scale posture in P7.
- Matchmaking, room codes, multiple concurrent games on one host, a server browser (still single game per process, as 011).
- Team/character/arena selection over the wire (host pins at init; backlog/011-OC).
- Mid-session content/tuning renegotiation, snapshot delta/diff compression (deferred until measured necessary).
- Touching `packages/sim` or regenerating any golden artifact.
