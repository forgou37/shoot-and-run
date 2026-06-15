import { describe, expect, it } from "vitest";
import { emptyInput, type PlayerInput } from "../src/input";
import {
  PROTOCOL_VERSION,
  ProtocolVersionError,
  WireFormatError,
  deserializeInput,
  parseInputFrame,
  serializeInput,
  serializeInputFrame
} from "../src/wire";

/** Build a PlayerInput from a 7-bit pattern (bit 0 left ... bit 6 dash). */
function inputFromBits(bits: number): PlayerInput {
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

describe("input serialization (T8.4 / N5)", () => {
  it("round-trips all 128 input combinations through a single byte", () => {
    for (let bits = 0; bits < 128; bits++) {
      const input = inputFromBits(bits);
      const bytes = serializeInput(input);
      expect(bytes.length).toBe(1);
      expect(bytes[0]).toBe(bits); // bit layout matches the pattern exactly
      expect(deserializeInput(bytes)).toEqual(input);
    }
  });

  it("ignores the reserved high bit when decoding", () => {
    // 0xFF = all 7 flags + reserved bit 7; decode must equal the all-flags input.
    expect(deserializeInput(Uint8Array.of(0xff))).toEqual(inputFromBits(0x7f));
  });

  it("frame round-trips tick + inputs across varint sizes", () => {
    const rosters: PlayerInput[][] = [
      [emptyInput()],
      [inputFromBits(0b1010101), inputFromBits(0b0101010)],
      [inputFromBits(1), inputFromBits(64), inputFromBits(0), inputFromBits(127)]
    ];
    // ticks spanning 1-, 2-, and 3-byte varints
    for (const tick of [0, 1, 127, 128, 300, 16383, 16384, 1_000_000]) {
      for (const inputs of rosters) {
        const frame = serializeInputFrame(tick, inputs);
        const parsed = parseInputFrame(frame);
        expect(parsed.tick).toBe(tick);
        expect(parsed.inputs).toEqual(inputs);
      }
    }
  });

  it("a frame carries the current protocol version", () => {
    const frame = serializeInputFrame(42, [emptyInput()]);
    expect(frame[0]).toBe(PROTOCOL_VERSION); // version is the first (varint) byte
  });

  it("rejects a mismatched protocol version with a typed, catchable error", () => {
    const frame = serializeInputFrame(7, [emptyInput()]);
    frame[0] = PROTOCOL_VERSION + 1; // pretend it came from a different build

    expect(() => parseInputFrame(frame)).toThrow(ProtocolVersionError);
    try {
      parseInputFrame(frame);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProtocolVersionError);
      expect((err as ProtocolVersionError).expected).toBe(PROTOCOL_VERSION);
      expect((err as ProtocolVersionError).received).toBe(PROTOCOL_VERSION + 1);
    }
  });

  it("rejects a truncated frame with WireFormatError", () => {
    const frame = serializeInputFrame(3, [emptyInput(), emptyInput()]);
    expect(() => parseInputFrame(frame.slice(0, frame.length - 1))).toThrow(WireFormatError);
  });
});
