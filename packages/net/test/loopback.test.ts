import { describe, expect, it } from "vitest";
import { LoopbackNetwork } from "../src/loopback";
import type { Transport } from "../src/transport";

/** Wire a host that records (clientId-tagged) received bytes, plus a connected
 *  client transport, on a fresh network. */
function connectPair(net: LoopbackNetwork, clientId = "c0"): {
  client: Transport;
  hostReceived: number[][];
} {
  const hostReceived: number[][] = [];
  net.server.onConnection((hostSide) => {
    hostSide.onMessage((data) => hostReceived.push(Array.from(data)));
  });
  const client = net.connect(clientId);
  return { client, hostReceived };
}

describe("loopback transport (T9.0 / M1)", () => {
  it("delivers a datagram only once its latency has elapsed", () => {
    const net = new LoopbackNetwork({ seed: 1, latencyTicks: 3 });
    const { client, hostReceived } = connectPair(net);

    net.advance(0);
    client.send(Uint8Array.of(42)); // sent at tick 0, latency 3 => arrives tick 3

    net.advance(1);
    expect(hostReceived).toHaveLength(0);
    net.advance(2);
    expect(hostReceived).toHaveLength(0);
    net.advance(3);
    expect(hostReceived).toEqual([[42]]);
  });

  it("is bidirectional: host -> client too", () => {
    const net = new LoopbackNetwork({ seed: 1, latencyTicks: 1 });
    const clientReceived: number[][] = [];
    let hostSide: Transport | null = null;
    net.server.onConnection((h) => {
      hostSide = h;
    });
    const client = net.connect("c0");
    client.onMessage((d) => clientReceived.push(Array.from(d)));

    net.advance(0);
    hostSide!.send(Uint8Array.of(7));
    net.advance(1);
    expect(clientReceived).toEqual([[7]]);
  });

  it("drops everything at lossRate 1 and nothing at lossRate 0", () => {
    const lossy = new LoopbackNetwork({ seed: 5, latencyTicks: 1, lossRate: 1 });
    const a = connectPair(lossy);
    lossy.advance(0);
    for (let i = 0; i < 10; i++) a.client.send(Uint8Array.of(i));
    lossy.advance(5);
    expect(a.hostReceived).toHaveLength(0);
    expect(lossy.dropped).toBe(10);

    const clean = new LoopbackNetwork({ seed: 5, latencyTicks: 1, lossRate: 0 });
    const b = connectPair(clean);
    clean.advance(0);
    for (let i = 0; i < 10; i++) b.client.send(Uint8Array.of(i));
    clean.advance(5);
    expect(b.hostReceived).toHaveLength(10);
  });

  it("jitter can reorder, but delivery is fully reproducible for a given seed", () => {
    function run(): { tick: number; byte: number }[] {
      const net = new LoopbackNetwork({ seed: 0xabc, latencyTicks: 4, jitterTicks: 3 });
      const delivered: { tick: number; byte: number }[] = [];
      net.server.onConnection((h) => h.onMessage((d) => delivered.push({ tick: net.now, byte: d[0]! })));
      const client = net.connect("c0");
      for (let t = 0; t <= 20; t++) {
        net.advance(t);
        if (t < 8) client.send(Uint8Array.of(t)); // one datagram per early tick
      }
      return delivered;
    }
    const first = run();
    const second = run();
    expect(second).toEqual(first); // same seed => identical schedule
    expect(first.length).toBe(8); // no loss configured => all arrive
    expect(first.map((d) => d.byte).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // jitter perturbed the delay (byte == sendTick, so delay = arrivalTick - byte != latency for some)
    const delays = first.map((d) => d.tick - d.byte);
    expect(delays.some((x) => x !== 4)).toBe(true);
  });

  it("never delivers in the past or the same tick it was sent", () => {
    const net = new LoopbackNetwork({ seed: 2, latencyTicks: 0, jitterTicks: 0 });
    const { client, hostReceived } = connectPair(net);
    net.advance(10);
    client.send(Uint8Array.of(1)); // latency 0 => clamped to now+1 = tick 11
    net.advance(10);
    expect(hostReceived).toHaveLength(0);
    net.advance(11);
    expect(hostReceived).toEqual([[1]]);
  });

  it("stops delivering to a closed endpoint", () => {
    const net = new LoopbackNetwork({ seed: 1, latencyTicks: 1 });
    const { client, hostReceived } = connectPair(net);
    let closedSeen = false;
    net.advance(0);
    client.onClose(() => {
      closedSeen = true;
    });
    client.send(Uint8Array.of(9));
    client.close();
    expect(closedSeen).toBe(true);
    net.advance(5);
    expect(hostReceived).toHaveLength(0); // peer closed before delivery
  });
});
