import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { createSim, emptyInput, parseArena, parseTuning, type PlayerInput } from "@shoot-and-run/sim";
import { ClientSession } from "../src/client";
import { decodeMessage, encodeMessage } from "../src/codec";
import type { NetMessage } from "../src/protocol";
import type { Transport } from "../src/transport";
import { VersionMismatchError, computeContentVersion } from "../src/version";

/**
 * T10.1 / W3 — ClientSession unit behavior, driven through a spy Transport so the
 * orchestration (bootstrap, prediction + send, confirm/resync/ack routing, error
 * handling) is asserted in isolation. The full byte-identical convergence of
 * HostRuntime + ClientSessions over the lossy loopback is T10.2's integration test.
 */

const arena = parseArena(arena001);
const tuning = parseTuning(tuningJson);
const INPUT_DELAY = 3;
const MAX_ROLLBACK = 120;
/** The content fingerprint the client computes for itself — a hello must carry
 *  this (the host stamps the same) or the client refuses the session (S4). */
const VERSION = computeContentVersion(arena, tuning);

/** A Transport stub: records outbound datagrams and injects inbound ones. */
class SpyTransport implements Transport {
  readonly id = "spy";
  readonly sent: Uint8Array[] = [];
  closed = false;
  private handler: ((d: Uint8Array) => void) | null = null;

  send(data: Uint8Array): void {
    this.sent.push(data);
  }
  onMessage(handler: (d: Uint8Array) => void): void {
    this.handler = handler;
  }
  onClose(): void {
    /* unused in these tests */
  }
  close(): void {
    this.closed = true;
  }

  /** Push a decoded message inbound (as the Host would). */
  deliver(msg: NetMessage): void {
    this.handler?.(encodeMessage(msg));
  }
  /** Push raw bytes inbound (for malformed-datagram tests). */
  deliverRaw(data: Uint8Array): void {
    this.handler?.(data);
  }
  /** Decoded view of everything the client sent. */
  sentMessages(): NetMessage[] {
    return this.sent.map(decodeMessage);
  }
}

function makeSession(transport: SpyTransport): ClientSession {
  return new ClientSession({
    transport,
    arena,
    tuning,
    inputDelayTicks: INPUT_DELAY,
    maxRollbackTicks: MAX_ROLLBACK
  });
}

function rightInput(): PlayerInput {
  return { ...emptyInput(), right: true };
}

describe("ClientSession (T10.1 / W3)", () => {
  it("is a no-op until the Host's hello arrives", () => {
    const t = new SpyTransport();
    const s = makeSession(t);
    expect(s.ready).toBe(false);
    expect(s.tick(rightInput())).toEqual([]);
    expect(t.sent).toHaveLength(0);
  });

  it("bootstraps on hello and predicts forward, sending inputs tagged from tick 0", () => {
    const t = new SpyTransport();
    const s = makeSession(t);
    t.deliver({ type: "hello", slot: 1, seed: 0xfeed, playerCount: 2, version: VERSION, arenaId: "crossfire" });

    expect(s.ready).toBe(true);
    expect(s.localSlot).toBe(1);
    expect(s.arena).toBe("crossfire");

    s.tick(emptyInput());
    // Pre-sync lead = confirmed(0) + inputDelay → predicts ticks 0..inputDelay.
    const sentInputs = t.sentMessages();
    expect(sentInputs.every((m) => m.type === "input")).toBe(true);
    expect(sentInputs.map((m) => (m.type === "input" ? m.tick : -1))).toEqual([0, 1, 2, 3]);
    expect(s.predictedTick).toBe(INPUT_DELAY + 1);
  });

  it("applies the local input to the predicted sim", () => {
    const t = new SpyTransport();
    const s = makeSession(t);
    t.deliver({ type: "hello", slot: 1, seed: 1, playerCount: 2, version: VERSION, arenaId: "crossfire" });
    s.tick(rightInput()); // several predicted steps of rightward air accel
    expect(s.predictedState()!.players[1]!.vx).toBeGreaterThan(0);
  });

  it("confirms contiguous authoritative ticks, advancing confirmedTick", () => {
    const t = new SpyTransport();
    const s = makeSession(t);
    t.deliver({ type: "hello", slot: 0, seed: 7, playerCount: 2, version: VERSION, arenaId: "crossfire" });
    s.tick(emptyInput());
    for (let tk = 0; tk < 5; tk++) {
      t.deliver({ type: "authoritative", tick: tk, inputs: [emptyInput(), emptyInput()] });
    }
    expect(s.confirmedTick).toBe(5);
  });

  it("confirmed state stays byte-identical to a host fed the same inputs", () => {
    // Ground-truth host: an independent sim stepped with the same authoritative
    // inputs. The client's confirmed sim must match it byte-for-byte.
    const host = createSim({ arena, tuning, players: [{ slot: 0 }, { slot: 1 }], seed: 0xabc });
    const t = new SpyTransport();
    const s = makeSession(t);
    t.deliver({ type: "hello", slot: 0, seed: 0xabc, playerCount: 2, version: VERSION, arenaId: "crossfire" });

    for (let tk = 0; tk < 40; tk++) {
      s.tick(rightInput()); // client predicts (irrelevant to confirmed)
      const inputs = [rightInput(), emptyInput()];
      host.step(inputs);
      t.deliver({ type: "authoritative", tick: tk, inputs });
    }
    expect(s.confirmedTick).toBe(40);
    expect(JSON.stringify(s.snapshotConfirmed())).toBe(JSON.stringify(host.snapshot()));
  });

  it("syncs the clock from an ack that echoes a sent input's tick", () => {
    const t = new SpyTransport();
    const s = makeSession(t);
    t.deliver({ type: "hello", slot: 0, seed: 1, playerCount: 2, version: VERSION, arenaId: "crossfire" });
    expect(s.clockSynced).toBe(false);
    s.tick(emptyInput()); // sends input for tick 0 (among others)
    t.deliver({ type: "ack", tick: 0, inputTick: 0 });
    expect(s.clockSynced).toBe(true);
  });

  it("counts a malformed datagram and keeps the session alive", () => {
    const t = new SpyTransport();
    const s = makeSession(t);
    t.deliver({ type: "hello", slot: 0, seed: 1, playerCount: 2, version: VERSION, arenaId: "crossfire" });
    t.deliverRaw(Uint8Array.of(250, 250, 250)); // bad version varint
    expect(s.malformedCount).toBe(1);
    expect(s.ready).toBe(true);
  });

  it("resyncs to a host snapshot, jumping confirmedTick", () => {
    const host = createSim({ arena, tuning, players: [{ slot: 0 }, { slot: 1 }], seed: 5 });
    for (let tk = 0; tk < 30; tk++) host.step([emptyInput(), emptyInput()]);
    const t = new SpyTransport();
    const s = makeSession(t);
    t.deliver({ type: "hello", slot: 0, seed: 5, playerCount: 2, version: VERSION, arenaId: "crossfire" });
    t.deliver({ type: "snapshot", snapshot: host.snapshot() });
    expect(s.confirmedTick).toBe(30);
  });

  it("tracks pre-match lobby status from lobby messages (T11.3)", () => {
    const t = new SpyTransport();
    const s = makeSession(t);
    expect(s.lobbyStatus).toBeNull();
    t.deliver({ type: "hello", slot: 0, seed: 1, playerCount: 2, version: VERSION, arenaId: "crossfire" });
    t.deliver({ type: "lobby", connected: 1, expected: 2 });
    expect(s.lobbyStatus).toEqual({ connected: 1, expected: 2 });
    t.deliver({ type: "lobby", connected: 2, expected: 2 });
    expect(s.lobbyStatus).toEqual({ connected: 2, expected: 2 });
  });

  it("refuses to bootstrap on a content-version mismatch and reports it (S4)", () => {
    const t = new SpyTransport();
    const errors: Error[] = [];
    const s = new ClientSession({
      transport: t,
      arena,
      tuning,
      inputDelayTicks: INPUT_DELAY,
      maxRollbackTicks: MAX_ROLLBACK,
      onError: (e) => errors.push(e)
    });
    // Host on a drifted build → different (still unsigned) fingerprint.
    const wrong = (VERSION ^ 0xabc) >>> 0;
    t.deliver({ type: "hello", slot: 0, seed: 1, playerCount: 2, version: wrong, arenaId: "crossfire" });
    expect(s.ready).toBe(false);
    expect(s.versionMismatch).toBe(true);
    expect(errors[0]).toBeInstanceOf(VersionMismatchError);
    expect(t.closed).toBe(true);
    // A subsequent (matching) hello is ignored — the session stays refused.
    t.deliver({ type: "hello", slot: 0, seed: 1, playerCount: 2, version: VERSION, arenaId: "crossfire" });
    expect(s.ready).toBe(false);
  });

  it("holds (sending no gameplay input) until a pong syncs the clock, then leads (S3)", () => {
    const t = new SpyTransport();
    const s = makeSession(t);
    t.deliver({ type: "hello", slot: 0, seed: 1, playerCount: 2, version: VERSION, arenaId: "crossfire" });
    // Host starts (an authoritative tick arrives). The client must NOT lead off
    // its now-lagging confirmed tick — it pings and holds until the clock syncs.
    t.deliver({ type: "authoritative", tick: 0, inputs: [emptyInput(), emptyInput()] });
    t.sent.length = 0;
    s.tick(rightInput());
    const held = t.sentMessages();
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((m) => m.type === "ping")).toBe(true); // pinged, sent no input
    expect(s.clockSynced).toBe(false);

    // Answer the ping → the clock syncs; the next tick leads and sends inputs.
    const ping = held.find((m) => m.type === "ping")!;
    t.deliver({ type: "pong", id: (ping as { id: number }).id, hostTick: 5 });
    expect(s.clockSynced).toBe(true);
    t.sent.length = 0;
    s.tick(rightInput());
    expect(t.sentMessages().some((m) => m.type === "input")).toBe(true);
  });
});
