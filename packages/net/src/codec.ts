/**
 * NetMessage wire codec (spec 008, Phase 009 / T9.1). Turns the protocol
 * envelopes into bytes for the transport and back. Every message is prefixed
 * with the sim's `PROTOCOL_VERSION` so a peer on a mismatched build is rejected
 * with the same typed `ProtocolVersionError` the input frames use; malformed
 * buffers raise `WireFormatError`.
 *
 * Layout: `[uvarint PROTOCOL_VERSION][uint8 tag][payload]`
 *   input        → [uvarint tick][input byte]
 *   authoritative→ [uvarint tick][uvarint count][count input bytes]
 *   ack          → [uvarint tick]
 *   snapshot     → [uvarint utf8Len][utf8(JSON.stringify(snapshot))]
 *
 * Reuses the sim's exported byte primitives (`encodeInputByte`, the version +
 * error types). The varint + UTF-8 helpers are kept local rather than exported
 * from the sim so `packages/sim` stays byte-for-byte untouched this phase; they
 * are tiny and fully covered by the round-trip tests.
 */
import {
  PROTOCOL_VERSION,
  ProtocolVersionError,
  WireFormatError,
  decodeInputByte,
  encodeInputByte,
  type PlayerInput,
  type SimSnapshot
} from "@shoot-and-run/sim";
import type { NetMessage } from "./protocol";

const TAG_INPUT = 0;
const TAG_AUTHORITATIVE = 1;
const TAG_SNAPSHOT = 2;
const TAG_ACK = 3;

// --- unsigned LEB128 varint (arithmetic form; correct for any non-negative
//     safe integer). Intentionally local — see file header. ---

function writeUvarint(out: number[], value: number): void {
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

function readUvarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
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

// --- minimal DOM-free UTF-8 (TextEncoder/Decoder are not in the no-DOM lib) ---

function encodeUtf8(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const lo = str.charCodeAt(++i);
      c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++]!;
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      const b1 = bytes[i++]!;
      out += String.fromCharCode(((b & 0x1f) << 6) | (b1 & 0x3f));
    } else if (b < 0xf0) {
      const b1 = bytes[i++]!;
      const b2 = bytes[i++]!;
      out += String.fromCharCode(((b & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else {
      const b1 = bytes[i++]!;
      const b2 = bytes[i++]!;
      const b3 = bytes[i++]!;
      const c = (((b & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    }
  }
  return out;
}

/** Encode a NetMessage to a single datagram. */
export function encodeMessage(msg: NetMessage): Uint8Array {
  const out: number[] = [];
  writeUvarint(out, PROTOCOL_VERSION);
  switch (msg.type) {
    case "input":
      out.push(TAG_INPUT);
      writeUvarint(out, msg.tick);
      out.push(encodeInputByte(msg.input));
      break;
    case "authoritative":
      out.push(TAG_AUTHORITATIVE);
      writeUvarint(out, msg.tick);
      writeUvarint(out, msg.inputs.length);
      for (const input of msg.inputs) out.push(encodeInputByte(input));
      break;
    case "ack":
      out.push(TAG_ACK);
      writeUvarint(out, msg.tick);
      break;
    case "snapshot": {
      out.push(TAG_SNAPSHOT);
      const json = encodeUtf8(JSON.stringify(msg.snapshot));
      writeUvarint(out, json.length);
      for (const b of json) out.push(b);
      break;
    }
  }
  return Uint8Array.from(out);
}

/** Parse a datagram. Throws ProtocolVersionError on a version mismatch and
 *  WireFormatError on a malformed/truncated/unknown buffer. */
export function decodeMessage(bytes: Uint8Array): NetMessage {
  const version = readUvarint(bytes, 0);
  if (version.value !== PROTOCOL_VERSION) {
    throw new ProtocolVersionError(PROTOCOL_VERSION, version.value);
  }
  let pos = version.next;
  if (pos >= bytes.length) throw new WireFormatError("message missing tag");
  const tag = bytes[pos++]!;

  switch (tag) {
    case TAG_INPUT: {
      const tick = readUvarint(bytes, pos);
      pos = tick.next;
      if (pos >= bytes.length) throw new WireFormatError("input message missing input byte");
      return { type: "input", tick: tick.value, input: decodeInputByte(bytes[pos]!) };
    }
    case TAG_AUTHORITATIVE: {
      const tick = readUvarint(bytes, pos);
      const count = readUvarint(bytes, tick.next);
      pos = count.next;
      if (bytes.length - pos < count.value) {
        throw new WireFormatError(`authoritative message truncated: expected ${count.value} inputs`);
      }
      const inputs: PlayerInput[] = [];
      for (let i = 0; i < count.value; i++) inputs.push(decodeInputByte(bytes[pos++]!));
      return { type: "authoritative", tick: tick.value, inputs };
    }
    case TAG_ACK: {
      const tick = readUvarint(bytes, pos);
      return { type: "ack", tick: tick.value };
    }
    case TAG_SNAPSHOT: {
      const len = readUvarint(bytes, pos);
      pos = len.next;
      if (bytes.length - pos < len.value) throw new WireFormatError("snapshot message truncated");
      const json = decodeUtf8(bytes.subarray(pos, pos + len.value));
      return { type: "snapshot", snapshot: JSON.parse(json) as SimSnapshot };
    }
    default:
      throw new WireFormatError(`unknown message tag ${tag}`);
  }
}
