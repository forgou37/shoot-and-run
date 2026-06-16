import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import {
  ProtocolVersionError,
  WireFormatError,
  createSim,
  emptyInput,
  parseArena,
  parseTuning,
  type PlayerInput
} from "@shoot-and-run/sim";
import { decodeMessage, encodeMessage } from "../src/codec";
import type { NetMessage } from "../src/protocol";

function input(bits: number): PlayerInput {
  return {
    left: (bits & 1) !== 0,
    right: (bits & 2) !== 0,
    up: (bits & 4) !== 0,
    down: (bits & 8) !== 0,
    jump: (bits & 16) !== 0,
    shoot: (bits & 32) !== 0,
    dash: (bits & 64) !== 0
  };
}

function makeSnapshot() {
  const sim = createSim({
    arena: parseArena(arena001),
    tuning: parseTuning(tuningJson),
    players: [{ slot: 0 }, { slot: 1 }],
    seed: 0xc0ffee
  });
  for (let t = 0; t < 40; t++) sim.step([emptyInput(), emptyInput()]);
  return sim.snapshot();
}

describe("NetMessage codec (T9.1 / M2)", () => {
  it("round-trips input messages across tick varint sizes and all input bits", () => {
    for (const tick of [0, 1, 200, 100_000]) {
      for (let bits = 0; bits < 128; bits += 17) {
        const msg: NetMessage = { type: "input", tick, input: input(bits) };
        expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
      }
    }
  });

  it("round-trips authoritative messages with 1..4 players", () => {
    for (let n = 1; n <= 4; n++) {
      const inputs = Array.from({ length: n }, (_, i) => input(i * 9));
      const msg: NetMessage = { type: "authoritative", tick: 1234, inputs };
      expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
    }
  });

  it("round-trips ack messages (host tick + echoed input tick)", () => {
    const msg: NetMessage = { type: "ack", tick: 54321, inputTick: 53999 };
    expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
  });

  it("round-trips hello messages across slot/seed/playerCount/version, arena ids and tokens", () => {
    for (const slot of [0, 1, 3]) {
      for (const seed of [0, 1, 0xfeed, 0xffffffff]) {
        for (const version of [0, 1, 0x9abcdef0]) {
          for (const arenaId of ["", "canopy", "crossfire", "árena-é日本"]) {
            for (const token of ["", "abcd-1234", "tøken-é"]) {
              const msg: NetMessage = { type: "hello", slot, seed, playerCount: 4, version, arenaId, token };
              expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
            }
          }
        }
      }
    }
  });

  it("round-trips ping and pong messages", () => {
    for (const id of [0, 1, 255, 100_000]) {
      const ping: NetMessage = { type: "ping", id };
      expect(decodeMessage(encodeMessage(ping))).toEqual(ping);
      for (const hostTick of [0, 7, 99_999]) {
        const pong: NetMessage = { type: "pong", id, hostTick };
        expect(decodeMessage(encodeMessage(pong))).toEqual(pong);
      }
    }
  });

  it("round-trips lobby status messages", () => {
    for (const connected of [0, 1, 4]) {
      for (const expected of [1, 2, 4]) {
        const msg: NetMessage = { type: "lobby", connected, expected };
        expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
      }
    }
  });

  it("round-trips join messages across roles, versions, and optional reconnect tokens (T13.1)", () => {
    for (const role of ["player", "spectator"] as const) {
      for (const version of [0, 1, 0x9abcdef0]) {
        const noToken: NetMessage = { type: "join", role, version };
        expect(decodeMessage(encodeMessage(noToken))).toEqual(noToken); // no reconnectToken key
        for (const reconnectToken of ["t", "abc-123", "tøken-日本"]) {
          const withToken: NetMessage = { type: "join", role, version, reconnectToken };
          expect(decodeMessage(encodeMessage(withToken))).toEqual(withToken);
        }
      }
    }
  });

  it("round-trips a join carrying a joinToken (T13.5)", () => {
    for (const joinToken of ["secret", "tøk-é"]) {
      const m1: NetMessage = { type: "join", role: "player", version: 7, joinToken };
      expect(decodeMessage(encodeMessage(m1))).toEqual(m1);
      const m2: NetMessage = { type: "join", role: "spectator", version: 9, reconnectToken: "r", joinToken };
      expect(decodeMessage(encodeMessage(m2))).toEqual(m2);
    }
  });

  it("round-trips reject messages for every reason (T13.1 + T13.5)", () => {
    for (const reason of ["version", "full", "token"] as const) {
      const msg: NetMessage = { type: "reject", reason };
      expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
    }
  });

  it("rejects a join with an unknown role byte, and a reject with an unknown reason byte", () => {
    // Layout is [version varint (1 B for v1)][tag][code byte] — the code is at index 2.
    const join = encodeMessage({ type: "join", role: "player", version: 7 });
    join[2] = 99;
    expect(() => decodeMessage(join)).toThrow(WireFormatError);

    const reject = encodeMessage({ type: "reject", reason: "version" });
    reject[2] = 99;
    expect(() => decodeMessage(reject)).toThrow(WireFormatError);
  });

  it("rejects a truncated hello buffer with WireFormatError", () => {
    const hello = encodeMessage({ type: "hello", slot: 1, seed: 99, playerCount: 2, version: 42, arenaId: "canopy", token: "abc" });
    expect(() => decodeMessage(hello.slice(0, hello.length - 2))).toThrow(WireFormatError);
  });

  it("round-trips a real snapshot message byte-for-byte", () => {
    const snapshot = makeSnapshot();
    const msg: NetMessage = { type: "snapshot", snapshot };
    const decoded = decodeMessage(encodeMessage(msg));
    expect(decoded.type).toBe("snapshot");
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(msg));
  });

  it("rejects a mismatched protocol version with a typed, catchable error", () => {
    const bytes = encodeMessage({ type: "ack", tick: 1, inputTick: 1 });
    bytes[0] = bytes[0]! + 1; // bump the version varint (single byte for v1)
    expect(() => decodeMessage(bytes)).toThrow(ProtocolVersionError);
  });

  it("rejects an unknown tag and a truncated buffer with WireFormatError", () => {
    const ack = encodeMessage({ type: "ack", tick: 1, inputTick: 1 });
    ack[1] = 99; // clobber the tag
    expect(() => decodeMessage(ack)).toThrow(WireFormatError);

    const auth = encodeMessage({ type: "authoritative", tick: 5, inputs: [emptyInput(), emptyInput()] });
    expect(() => decodeMessage(auth.slice(0, auth.length - 1))).toThrow(WireFormatError);
  });

  it("rejects a structurally-invalid snapshot payload with WireFormatError", () => {
    // Valid JSON, wrong shape (state.tick missing/non-numeric) — must fail loudly
    // rather than seed the client sim with garbage on resync.
    const bad = { type: "snapshot", snapshot: { state: { players: [] } } } as unknown as NetMessage;
    expect(() => decodeMessage(encodeMessage(bad))).toThrow(WireFormatError);
  });
});
