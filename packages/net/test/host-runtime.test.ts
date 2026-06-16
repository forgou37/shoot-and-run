import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { emptyInput, parseArena, parseTuning } from "@shoot-and-run/sim";
import { decodeMessage, encodeMessage } from "../src/codec";
import { createHostRuntime, type HostRuntimeConfig } from "../src/host-runtime";
import { LoopbackNetwork } from "../src/loopback";
import type { NetMessage } from "../src/protocol";
import type { Transport } from "../src/transport";
import { computeContentVersion } from "../src/version";

/**
 * T13.1 — the join handshake on the host side. The 010 host sent `hello` blindly
 * on connect; the 013 host waits for the client's `JoinMessage` so it can admit by
 * intent and refuse a drifted build (a typed `reject`) without wasting a slot — and
 * a tick-driven join-grace still rescues a pre-013 client that never sends `join`.
 * Driven over the deterministic loopback (latency 0 ⇒ a datagram lands one advance
 * later), capturing what the host sends back to the client.
 */

const arena = parseArena(arena001);
const tuning = parseTuning(tuningJson);
const version = computeContentVersion(arena, tuning);

function makeRuntime(net: LoopbackNetwork, overrides: Partial<HostRuntimeConfig> = {}) {
  return createHostRuntime({
    server: net.server,
    arena,
    tuning,
    players: [{ slot: 0 }, { slot: 1 }],
    seed: 1,
    snapshotIntervalTicks: 20,
    arenaId: "crossfire",
    ...overrides
  });
}

/** Collect everything the host sends to this client transport. */
function collectInbound(transport: Transport): NetMessage[] {
  const msgs: NetMessage[] = [];
  transport.onMessage((data) => msgs.push(decodeMessage(data)));
  return msgs;
}

describe("HostRuntime join handshake (T13.1)", () => {
  it("sends no hello until a join arrives, then admits the player", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net);
    const client = net.connect("c0");
    const inbound = collectInbound(client);

    net.advance(0);
    expect(inbound).toHaveLength(0); // nothing sent before the join
    expect(runtime.connectedCount).toBe(0);

    client.send(encodeMessage({ type: "join", role: "player", version }));
    net.advance(1); // join → host: admit + emit hello
    expect(runtime.connectedCount).toBe(1);

    net.advance(2); // hello → client
    const hello = inbound.find((m) => m.type === "hello");
    expect(hello).toMatchObject({ type: "hello", slot: 0, playerCount: 2, version, arenaId: "crossfire" });
  });

  it("rejects a version-mismatched join with reject:version and consumes no slot", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net);
    const client = net.connect("c0");
    const inbound = collectInbound(client);

    client.send(encodeMessage({ type: "join", role: "player", version: (version ^ 0x1234) >>> 0 }));
    net.advance(1);
    expect(runtime.connectedCount).toBe(0); // not admitted
    expect(runtime.ready).toBe(false);

    net.advance(2);
    expect(inbound).toContainEqual({ type: "reject", reason: "version" });
    expect(inbound.some((m) => m.type === "hello")).toBe(false);
  });

  it("two matching-version joins fill the roster and start the loop", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net);
    const a = net.connect("c0");
    const b = net.connect("c1");
    a.send(encodeMessage({ type: "join", role: "player", version }));
    b.send(encodeMessage({ type: "join", role: "player", version }));
    net.advance(1); // both joins → host
    expect(runtime.connectedCount).toBe(2);
    expect(runtime.ready).toBe(true);
    expect(runtime.step()).toBe(true); // loop runs once both players are in
    expect(runtime.tick).toBe(1);
  });

  it("falls back to a legacy hello after the join-grace for a client that never joins", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net, { joinGraceTicks: 5 });
    const client = net.connect("c0");
    const inbound = collectInbound(client);

    // Never send a join. The grace ages off step(), which the caller drives every tick.
    for (let t = 0; t <= 10; t++) {
      net.advance(t);
      runtime.step();
    }
    expect(runtime.connectedCount).toBe(1); // admitted via the grace fallback
    expect(inbound.some((m) => m.type === "hello")).toBe(true); // legacy hello reached it
  });

  it("admits a pre-013 client that sends a ping before any join, then answers it", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net);
    const client = net.connect("c0");
    const inbound = collectInbound(client);

    client.send(encodeMessage({ type: "ping", id: 0 })); // non-join first message
    net.advance(1); // ping → host: legacy-admit + pong
    expect(runtime.connectedCount).toBe(1);

    net.advance(2);
    expect(inbound.some((m) => m.type === "hello")).toBe(true);
    expect(inbound.some((m) => m.type === "pong")).toBe(true);
  });

  it("admits a spectator without a player slot and does not gate the start (T13.2)", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net); // expects 2 players
    const spec = net.connect("s0");
    const inbound = collectInbound(spec);

    spec.send(encodeMessage({ type: "join", role: "spectator", version }));
    net.advance(1); // join → host: admit as spectator
    expect(runtime.connectedCount).toBe(0); // spectators aren't counted as players
    expect(runtime.ready).toBe(false); // and never satisfy the start gate

    net.advance(2);
    expect(inbound.some((m) => m.type === "hello")).toBe(true);
  });

  it("refuses a spectator past maxSpectators with reject:full (T13.2)", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    makeRuntime(net, { maxSpectators: 1 });
    const a = net.connect("s0");
    const b = net.connect("s1");
    const bIn = collectInbound(b);
    a.send(encodeMessage({ type: "join", role: "spectator", version })); // takes the only slot
    b.send(encodeMessage({ type: "join", role: "spectator", version })); // over the cap
    net.advance(1);
    net.advance(2);
    expect(bIn).toContainEqual({ type: "reject", reason: "full" });
    expect(bIn.some((m) => m.type === "hello")).toBe(false);
  });
});

describe("HostRuntime hardening (T13.5)", () => {
  it("drops an oversize inbound datagram before decode and counts it", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net);
    const c = net.connect("c0");
    c.send(new Uint8Array(300)); // > the 256-byte inbound cap
    net.advance(1);
    expect(runtime.metrics().oversized).toBe(1);
    expect(runtime.connectedCount).toBe(0); // junk never admitted anyone
  });

  it("rate-limits an input flood from one connection", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net, { maxInputsPerSecond: 5 });
    const c = net.connect("c0");
    c.send(encodeMessage({ type: "join", role: "player", version }));
    net.advance(1); // admit (slot 0)
    for (let i = 0; i < 12; i++) c.send(encodeMessage({ type: "input", tick: 0, input: emptyInput() }));
    net.advance(2); // deliver the flood in one batch (one window)
    expect(runtime.metrics().rateLimited).toBe(7); // 12 sent, 5 accepted, 7 dropped
    expect(runtime.connectedCount).toBe(1); // connection still served
  });

  it("rejects an input tagged absurdly far in the future", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net, { maxInputLeadTicks: 10 });
    const c = net.connect("c0");
    c.send(encodeMessage({ type: "join", role: "player", version }));
    net.advance(1);
    c.send(encodeMessage({ type: "input", tick: 5000, input: emptyInput() })); // way past tick 0 + 10
    net.advance(2);
    expect(runtime.metrics().farFuture).toBe(1);
  });

  it("gates joins on a shared token when configured", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net, { joinToken: "secret" });
    const bad = net.connect("bad");
    const badIn = collectInbound(bad);
    bad.send(encodeMessage({ type: "join", role: "player", version })); // missing token
    const wrong = net.connect("wrong");
    const wrongIn = collectInbound(wrong);
    wrong.send(encodeMessage({ type: "join", role: "player", version, joinToken: "nope" }));
    const good = net.connect("good");
    const goodIn = collectInbound(good);
    good.send(encodeMessage({ type: "join", role: "player", version, joinToken: "secret" }));
    net.advance(1);
    net.advance(2);
    expect(badIn).toContainEqual({ type: "reject", reason: "token" });
    expect(wrongIn).toContainEqual({ type: "reject", reason: "token" });
    expect(goodIn.some((m) => m.type === "hello")).toBe(true);
    expect(runtime.connectedCount).toBe(1); // only the correct-token client got in
  });

  it("ignores the join token when the host is open (default)", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const runtime = makeRuntime(net); // no joinToken
    const c = net.connect("c0");
    const cIn = collectInbound(c);
    c.send(encodeMessage({ type: "join", role: "player", version })); // no token, fine
    net.advance(1);
    net.advance(2);
    expect(cIn.some((m) => m.type === "hello")).toBe(true);
    expect(runtime.connectedCount).toBe(1);
  });
});

describe("HostRuntime reconnection (T13.3)", () => {
  /** Admit two players over the loopback and return A's transport + its hello token. */
  function startTwoPlayers(net: LoopbackNetwork, grace: number) {
    const runtime = makeRuntime(net, { reconnectGraceTicks: grace });
    const a = net.connect("a");
    const aIn = collectInbound(a);
    const b = net.connect("b");
    a.send(encodeMessage({ type: "join", role: "player", version }));
    b.send(encodeMessage({ type: "join", role: "player", version }));
    net.advance(1); // both joins → host: admitted, started
    net.advance(2); // hellos → clients
    const hello = aIn.find((m) => m.type === "hello") as Extract<NetMessage, { type: "hello" }> | undefined;
    return { runtime, a, b, tokenA: hello?.token ?? "" };
  }

  it("issues a non-empty reconnect token in hello when reconnect is enabled", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const { runtime, tokenA } = startTwoPlayers(net, 100);
    expect(runtime.ready).toBe(true);
    expect(tokenA).not.toBe("");
  });

  it("reclaims a reserved slot via its token within the grace, sending a snapshot", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const { runtime, a, tokenA } = startTwoPlayers(net, 100);
    for (let i = 0; i < 5; i++) runtime.step(); // play a few ticks so the snapshot is live
    a.close(); // host sees the close synchronously → slot reserved (started + grace>0)
    expect(runtime.connectedCount).toBe(1);

    const a2 = net.connect("a2");
    const a2In = collectInbound(a2);
    a2.send(encodeMessage({ type: "join", role: "player", version, reconnectToken: tokenA }));
    net.advance(3); // reconnect join → host: reclaim, emits hello + snapshot
    net.advance(4); // hello + snapshot → a2
    expect(a2In.some((m) => m.type === "hello")).toBe(true);
    expect(a2In.some((m) => m.type === "snapshot")).toBe(true); // immediate resync
    expect(runtime.connectedCount).toBe(2); // slot reclaimed
  });

  it("refuses a reconnect after the grace expires (slot lost)", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const { runtime, a, tokenA } = startTwoPlayers(net, 5);
    a.close(); // slot reserved
    for (let i = 0; i < 8; i++) runtime.step(); // age past the grace → lost

    const a2 = net.connect("a2");
    const a2In = collectInbound(a2);
    a2.send(encodeMessage({ type: "join", role: "player", version, reconnectToken: tokenA }));
    net.advance(3);
    net.advance(4);
    expect(a2In).toContainEqual({ type: "reject", reason: "full" });
    expect(a2In.some((m) => m.type === "hello")).toBe(false);
  });

  it("refuses a forged token and leaves the reserved slot intact", () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const { runtime, a } = startTwoPlayers(net, 100);
    a.close(); // slot reserved
    expect(runtime.connectedCount).toBe(1);

    const x = net.connect("x");
    const xIn = collectInbound(x);
    x.send(encodeMessage({ type: "join", role: "player", version, reconnectToken: "not-a-real-token" }));
    net.advance(3);
    net.advance(4);
    expect(xIn).toContainEqual({ type: "reject", reason: "full" });
    expect(runtime.connectedCount).toBe(1); // reserved slot not stolen
  });
});
