import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { parseArena, parseTuning } from "@shoot-and-run/sim";
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
});
