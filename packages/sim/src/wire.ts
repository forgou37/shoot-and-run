/**
 * Compact, versioned wire (de)serialization for inputs (spec 008, T8.4). This is
 * the only thing clients send every tick, so it is tiny: one PlayerInput packs
 * into a single byte. A frame bundles a tick's inputs for all players.
 *
 * No transport here — just bytes in, bytes out. The session/transport layers
 * arrive in packages/net (009+).
 */
import { type PlayerInput } from "./input";

/**
 * Numeric version of the input wire protocol. Bump in lockstep with SIM_VERSION
 * (or whenever the PlayerInput bit layout or frame layout changes). A frame
 * carrying any other value is rejected with ProtocolVersionError, so peers on
 * mismatched builds fail loudly at the handshake instead of desyncing silently.
 */
export const PROTOCOL_VERSION = 1;

/** A frame failed to parse (truncated / malformed). */
export class WireFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WireFormatError";
  }
}

/** A frame's protocol version did not match this build's PROTOCOL_VERSION. */
export class ProtocolVersionError extends Error {
  constructor(
    readonly expected: number,
    readonly received: number
  ) {
    super(`input frame protocol version ${received} != expected ${expected}`);
    this.name = "ProtocolVersionError";
  }
}

/**
 * Pack a PlayerInput into one byte. Bit 0 left, 1 right, 2 up, 3 down, 4 jump,
 * 5 shoot, 6 dash; bit 7 reserved (always 0).
 */
export function encodeInputByte(input: PlayerInput): number {
  return (
    (input.left ? 1 : 0) |
    (input.right ? 1 << 1 : 0) |
    (input.up ? 1 << 2 : 0) |
    (input.down ? 1 << 3 : 0) |
    (input.jump ? 1 << 4 : 0) |
    (input.shoot ? 1 << 5 : 0) |
    (input.dash ? 1 << 6 : 0)
  );
}

/** Unpack a PlayerInput from one byte (bit 7 is ignored). */
export function decodeInputByte(byte: number): PlayerInput {
  return {
    left: (byte & 1) !== 0,
    right: (byte & (1 << 1)) !== 0,
    up: (byte & (1 << 2)) !== 0,
    down: (byte & (1 << 3)) !== 0,
    jump: (byte & (1 << 4)) !== 0,
    shoot: (byte & (1 << 5)) !== 0,
    dash: (byte & (1 << 6)) !== 0
  };
}

/** One PlayerInput as a 1-byte buffer. */
export function serializeInput(input: PlayerInput): Uint8Array {
  return Uint8Array.of(encodeInputByte(input));
}

/** Read one PlayerInput from the first byte of a buffer. */
export function deserializeInput(bytes: Uint8Array): PlayerInput {
  if (bytes.length < 1) throw new WireFormatError("empty input buffer");
  return decodeInputByte(bytes[0]!);
}

// --- unsigned LEB128 varint (arithmetic form, correct for any non-negative
//     safe integer — avoids 32-bit shift overflow on large ticks) ---

function writeVarint(out: number[], value: number): void {
  if (value < 0 || !Number.isInteger(value)) {
    throw new WireFormatError(`varint requires a non-negative integer, got ${value}`);
  }
  let v = value;
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let scale = 1;
  let pos = offset;
  for (;;) {
    if (pos >= bytes.length) throw new WireFormatError("truncated varint");
    const b = bytes[pos++]!;
    value += (b & 0x7f) * scale;
    if ((b & 0x80) === 0) break;
    scale *= 128;
    if (scale > Number.MAX_SAFE_INTEGER) throw new WireFormatError("varint too long");
  }
  return { value, next: pos };
}

export interface InputFrame {
  tick: number;
  inputs: PlayerInput[];
}

/**
 * Serialize one tick's inputs: [varint PROTOCOL_VERSION][varint tick]
 * [uint8 playerCount][playerCount input bytes]. The version-tagged header lets
 * `parseInputFrame` reject a peer on a different build (N5).
 */
export function serializeInputFrame(tick: number, inputs: readonly PlayerInput[]): Uint8Array {
  if (inputs.length > 255) {
    throw new WireFormatError(`playerCount ${inputs.length} exceeds 255`);
  }
  const out: number[] = [];
  writeVarint(out, PROTOCOL_VERSION);
  writeVarint(out, tick);
  out.push(inputs.length);
  for (const input of inputs) out.push(encodeInputByte(input));
  return Uint8Array.from(out);
}

/** Parse a frame produced by serializeInputFrame. Throws ProtocolVersionError on
 *  a version mismatch and WireFormatError on a malformed/truncated buffer. */
export function parseInputFrame(bytes: Uint8Array): InputFrame {
  const versionRead = readVarint(bytes, 0);
  if (versionRead.value !== PROTOCOL_VERSION) {
    throw new ProtocolVersionError(PROTOCOL_VERSION, versionRead.value);
  }
  const tickRead = readVarint(bytes, versionRead.next);
  let pos = tickRead.next;
  if (pos >= bytes.length) throw new WireFormatError("frame missing playerCount");
  const count = bytes[pos++]!;
  if (bytes.length - pos < count) {
    throw new WireFormatError(`frame truncated: expected ${count} input bytes`);
  }
  const inputs: PlayerInput[] = [];
  for (let i = 0; i < count; i++) inputs.push(decodeInputByte(bytes[pos++]!));
  return { tick: tickRead.value, inputs };
}
