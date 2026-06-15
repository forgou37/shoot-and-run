import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { emptyInput, parseArena, parseTuning, type PlayerInput } from "@shoot-and-run/sim";
import { decodeMessage, encodeMessage } from "../src/codec";
import { createHostSession } from "../src/host";
import { LoopbackNetwork } from "../src/loopback";
import { createRollbackController, type RollbackControllerHandle } from "../src/rollback";
import type { Transport } from "../src/transport";

/**
 * T9.5 / M6 — the full host-authoritative session over the lossy loopback. Two
 * scripted clients predict + rollback against a dedicated host; we assert the
 * invariant that makes the whole design correct: each client's CONFIRMED state
 * (fed only the host's authoritative inputs) is byte-identical to the host's
 * state at that tick, under clean, lossy, and high-jitter networks — and that
 * the whole thing is reproducible for a fixed seed.
 *
 * Clock sync (T9.3) is unit-tested separately; here the client tick lead is
 * driven directly from the virtual clock so this test isolates predict/rollback.
 */

const arena = parseArena(arena001);
const tuning = parseTuning(tuningJson);
const players = [{ slot: 0 }, { slot: 1 }];

/** Deterministic stand-in for a bot: a varied input per (slot, tick). */
function scriptInput(slot: number, tick: number): PlayerInput {
  const input = emptyInput();
  if ((tick + slot) % 2 === 0) input.right = true;
  else input.left = true;
  if ((tick + slot) % 7 === 0) input.jump = true;
  if ((tick * (slot + 1)) % 11 === 0) input.shoot = true;
  return input;
}

interface SessionOpts {
  seed: number;
  latency: number;
  jitter: number;
  loss: number;
  inputDelay: number;
  snapshotInterval: number;
  maxRollback: number;
  ticks: number;
}

interface ClientResult {
  confirmedTick: number;
  confirmed: string;
}

interface SessionResult {
  hostTick: number;
  hostFinal: string;
  hostStates: Map<number, string>;
  clients: Map<string, ClientResult>;
  dropped: number;
}

function runSession(o: SessionOpts): SessionResult {
  const clientIds = ["c0", "c1"];
  const net = new LoopbackNetwork({
    seed: o.seed,
    latencyTicks: o.latency,
    jitterTicks: o.jitter,
    lossRate: o.loss
  });

  const hostTransports = new Map<string, Transport>();
  net.server.onConnection((h) => hostTransports.set(h.id.slice("host:".length), h));
  const clientTransports = new Map<string, Transport>();
  for (const id of clientIds) clientTransports.set(id, net.connect(id));

  const host = createHostSession({
    arena,
    tuning,
    players,
    seed: o.seed,
    clients: clientIds.map((id, i) => ({ id, slot: i })),
    snapshotIntervalTicks: o.snapshotInterval,
    send: (clientId, data) => hostTransports.get(clientId)!.send(data) // host encodes once
  });

  const hostStates = new Map<number, string>();
  hostStates.set(0, JSON.stringify(host.snapshot()));

  const controllers = new Map<string, RollbackControllerHandle>();
  for (const id of clientIds) {
    const slot = clientIds.indexOf(id);
    const controller = createRollbackController({
      arena,
      tuning,
      players,
      seed: o.seed,
      localSlot: slot,
      maxRollbackTicks: o.maxRollback
    });
    controllers.set(id, controller);
    clientTransports.get(id)!.onMessage((data) => {
      const msg = decodeMessage(data);
      if (msg.type === "authoritative") controller.confirm(msg.tick, msg.inputs);
      else if (msg.type === "snapshot") controller.resync(msg.snapshot);
      // ack ignored — clock sync is exercised in clock.test.ts
    });
  }

  for (let t = 0; t <= o.ticks; t++) {
    net.advance(t);
    host.step();
    hostStates.set(host.tick, JSON.stringify(host.snapshot()));
    for (const id of clientIds) {
      const controller = controllers.get(id)!;
      const slot = clientIds.indexOf(id);
      const transport = clientTransports.get(id)!;
      const target = t + o.inputDelay;
      while (controller.predictedTick <= target) {
        const tk = controller.predictedTick;
        if (tk - controller.confirmedTick >= o.maxRollback) break;
        const input = scriptInput(slot, tk);
        controller.predict(tk, input);
        if (controller.predictedTick === tk) break; // capped — avoid spinning
        transport.send(encodeMessage({ type: "input", tick: tk, input }));
      }
    }
  }

  // Drain all in-flight datagrams (no further host steps / sends).
  const drainUntil = o.ticks + o.latency + o.jitter + o.snapshotInterval + 5;
  for (let t = o.ticks + 1; t <= drainUntil; t++) net.advance(t);

  const clients = new Map<string, ClientResult>();
  for (const id of clientIds) {
    const c = controllers.get(id)!;
    clients.set(id, { confirmedTick: c.confirmedTick, confirmed: JSON.stringify(c.snapshotConfirmed()) });
  }
  return { hostTick: host.tick, hostFinal: JSON.stringify(host.snapshot()), hostStates, clients, dropped: net.dropped };
}

const BASE: SessionOpts = {
  seed: 0xfeed,
  latency: 3,
  jitter: 2,
  loss: 0,
  inputDelay: 6,
  snapshotInterval: 20,
  maxRollback: 200,
  ticks: 240
};

describe("end-to-end convergence (T9.5 / M6)", () => {
  it("clean network: every client fully converges to the host's final state", () => {
    const r = runSession(BASE);
    for (const [, client] of r.clients) {
      expect(client.confirmedTick).toBe(r.hostTick); // confirmed everything
      expect(client.confirmed).toBe(r.hostFinal); // byte-identical
    }
    expect(r.dropped).toBe(0);
  });

  it("10% packet loss: clients fully recover to the host's state via snapshots", () => {
    const r = runSession({ ...BASE, loss: 0.1, seed: 0x105510 });
    expect(r.dropped).toBeGreaterThan(0);
    for (const [, client] of r.clients) {
      // Confirmed state is the host's state at that tick, byte-for-byte...
      expect(r.hostStates.get(client.confirmedTick)).toBe(client.confirmed);
      // ...and after draining, periodic snapshots have healed every loss gap, so
      // the client is fully caught up to the host — not merely "past halfway"
      // (deterministic per seed; a regression that stalls a client would fail here).
      expect(client.confirmedTick).toBe(r.hostTick);
      expect(client.confirmed).toBe(r.hostFinal);
    }
  });

  it("heavy jitter: clients fully converge to the host's state", () => {
    const r = runSession({ ...BASE, latency: 3, jitter: 8, inputDelay: 12, seed: 0x317120 });
    for (const [, client] of r.clients) {
      expect(r.hostStates.get(client.confirmedTick)).toBe(client.confirmed);
      expect(client.confirmedTick).toBe(r.hostTick);
      expect(client.confirmed).toBe(r.hostFinal);
    }
  });

  it("is fully reproducible for a fixed seed", () => {
    const opts = { ...BASE, loss: 0.12, seed: 0xabcd };
    const a = runSession(opts);
    const b = runSession(opts);
    expect(a.hostFinal).toBe(b.hostFinal);
    expect(a.dropped).toBe(b.dropped);
    for (const id of ["c0", "c1"]) {
      expect(a.clients.get(id)).toEqual(b.clients.get(id));
    }
  });
});
