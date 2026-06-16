import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { createSim, emptyInput, parseArena, parseTuning, type PlayerInput } from "@shoot-and-run/sim";
import { decodeMessage } from "../src/codec";
import { createHostSession } from "../src/host";
import type { NetMessage } from "../src/protocol";

const arena = parseArena(arena001);
const tuning = parseTuning(tuningJson);

function withFlag(flag: keyof PlayerInput): PlayerInput {
  return { ...emptyInput(), [flag]: true };
}

interface Sent {
  /** The targeted client for a per-client `send` (ack); null for a `broadcast`. */
  clientId: string | null;
  message: NetMessage;
}

function makeHost(snapshotIntervalTicks = 30) {
  const sent: Sent[] = [];
  const host = createHostSession({
    arena,
    tuning,
    players: [{ slot: 0 }, { slot: 1 }],
    seed: 0xbada55,
    clients: [
      { id: "c0", slot: 0 },
      { id: "c1", slot: 1 }
    ],
    snapshotIntervalTicks,
    send: (clientId, data) => sent.push({ clientId, message: decodeMessage(data) }),
    broadcast: (data) => sent.push({ clientId: null, message: decodeMessage(data) })
  });
  return { host, sent };
}

/** Broadcast authoritative-input messages, in tick order. */
function authInputs(sent: Sent[]): PlayerInput[][] {
  return sent
    .filter((s) => s.message.type === "authoritative")
    .map((s) => (s.message as Extract<NetMessage, { type: "authoritative" }>).inputs);
}

describe("host session (T9.2 / M3)", () => {
  it("commits ticks and broadcasts authoritative inputs that reproduce its state", () => {
    const { host, sent } = makeHost();
    for (let t = 0; t < 50; t++) {
      host.receiveInput("c0", t, withFlag("right"));
      host.receiveInput("c1", t, withFlag("left"));
      host.step();
    }
    expect(host.tick).toBe(50);

    // Replaying the broadcast authoritative inputs through a fresh sim must
    // reproduce the host's authoritative state byte-for-byte.
    const broadcast = authInputs(sent);
    expect(broadcast).toHaveLength(50);
    const shadow = createSim({ arena, tuning, players: [{ slot: 0 }, { slot: 1 }], seed: 0xbada55 });
    for (const inputs of broadcast) shadow.step(inputs);
    expect(JSON.stringify(shadow.snapshot())).toBe(JSON.stringify(host.snapshot()));
  });

  it("repeat-last fills a missing client input", () => {
    const { host, sent } = makeHost();
    host.receiveInput("c0", 0, withFlag("right"));
    host.receiveInput("c1", 0, withFlag("left"));
    host.step(); // tick 0: [right, left]
    host.receiveInput("c0", 1, withFlag("jump")); // c1 silent for tick 1
    host.step(); // tick 1: [jump, left(repeat-last)]

    const broadcast = authInputs(sent);
    expect(broadcast[0]).toEqual([withFlag("right"), withFlag("left")]);
    expect(broadcast[1]).toEqual([withFlag("jump"), withFlag("left")]);
  });

  it("broadcasts a snapshot every snapshotIntervalTicks", () => {
    const { host, sent } = makeHost(30);
    for (let t = 0; t < 35; t++) host.step();
    const snaps = sent.filter((s) => s.message.type === "snapshot");
    expect(snaps).toHaveLength(2); // committed ticks 0 and 30
  });

  it("acks each received input with the host's current tick", () => {
    const { host, sent } = makeHost();
    host.step(); // tick -> 1
    host.receiveInput("c0", 5, emptyInput());
    const acks = sent.filter((s) => s.clientId === "c0" && s.message.type === "ack");
    expect(acks).toHaveLength(1);
    const ack = acks[0]!.message as Extract<NetMessage, { type: "ack" }>;
    expect(ack.tick).toBe(1); // host's current committed tick
    expect(ack.inputTick).toBe(5); // echoes the input's tick for clock pairing
  });

  it("drops and counts inputs for an already-committed tick", () => {
    const { host } = makeHost();
    for (let t = 0; t < 10; t++) host.step(); // committedTick = 10
    host.receiveInput("c0", 3, withFlag("shoot")); // tick 3 is in the past
    expect(host.lateDropped).toBe(1);
  });
});
