/**
 * NetMessage wire codec (spec 008, Phase 009 / T9.1). Turns the protocol
 * envelopes into bytes for the transport and back. Every message is prefixed
 * with the sim's `PROTOCOL_VERSION` so a peer on a mismatched build is rejected
 * with the same typed `ProtocolVersionError` the input frames use; malformed
 * buffers raise `WireFormatError`.
 *
 * Layout: `[uvarint PROTOCOL_VERSION][uint8 tag][payload]`
 *   hello        → [uvarint slot][uvarint seed][uvarint playerCount][uvarint version][uvarint len][utf8(arenaId)][uvarint len][utf8(token)]
 *   join         → [uint8 roleCode][uvarint version][uvarint len][utf8(reconnectToken)][uvarint len][utf8(joinToken)]   (len 0 = absent)
 *   reject       → [uint8 reasonCode]
 *   input        → [uvarint tick][input byte]
 *   authoritative→ [uvarint tick][uvarint count][count input bytes]
 *   ack          → [uvarint tick][uvarint inputTick]
 *   snapshot     → [uvarint utf8Len][utf8(JSON.stringify(snapshot))]
 *   ping         → [uvarint id]
 *   pong         → [uvarint id][uvarint hostTick]
 *   lobby        → [uvarint connected][uvarint expected]
 *
 * Reuses the sim's exported byte primitives — `encodeInputByte`, the
 * `writeVarint`/`readVarint` LEB128 helpers, and the version + error types — so
 * there is one wire implementation, not two. Only the tiny DOM-free UTF-8 codec
 * is local (the sim has no UTF-8 helper to share, and its no-DOM tsconfig lacks
 * TextEncoder).
 *
 * Snapshot payloads are JSON. JSON coerces `-0`/`NaN`/`Infinity`, which is why
 * the sim's in-memory clone is hand-written (snapshot.ts) — but it is safe here:
 * the cross-engine determinism guard (T8.5) already hashes `JSON.stringify` of
 * snapshots, so the sim is required to keep its state JSON-stable (finite,
 * sign-normalized). If that ever changes, this codec must switch to a
 * value-preserving snapshot encoding (and so must the determinism hash).
 */
import {
  PROTOCOL_VERSION,
  ProtocolVersionError,
  WireFormatError,
  decodeInputByte,
  encodeInputByte,
  readVarint,
  writeVarint,
  type PlayerInput,
  type SimSnapshot
} from "@shoot-and-run/sim";
import type { JoinMessage, NetMessage } from "./protocol";

const TAG_INPUT = 0;
const TAG_AUTHORITATIVE = 1;
const TAG_SNAPSHOT = 2;
const TAG_ACK = 3;
const TAG_HELLO = 4;
const TAG_PING = 5;
const TAG_PONG = 6;
const TAG_LOBBY = 7;
const TAG_JOIN = 8;
const TAG_REJECT = 9;

// Small closed enums carried as a single code byte. Order is the wire contract —
// only append, never reorder. An out-of-range code is a WireFormatError on decode.
const JOIN_ROLES = ["player", "spectator"] as const;
const REJECT_REASONS = ["version", "full", "token"] as const;

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

/**
 * Validate the shape of a decoded (untrusted) snapshot before it is fed to
 * resync/createSimFromSnapshot — a malformed-but-parseable payload must fail
 * loudly here rather than seed the client sim with `NaN`/missing fields.
 */
function assertSnapshotShape(snap: unknown): asserts snap is SimSnapshot {
  if (typeof snap !== "object" || snap === null) {
    throw new WireFormatError("snapshot is not an object");
  }
  const s = snap as Record<string, unknown>;
  const state = s["state"];
  if (typeof state !== "object" || state === null) {
    throw new WireFormatError("snapshot.state is not an object");
  }
  const st = state as Record<string, unknown>;
  if (typeof st["tick"] !== "number" || !Number.isFinite(st["tick"])) {
    throw new WireFormatError("snapshot.state.tick is not a finite number");
  }
  if (!Array.isArray(st["players"])) {
    throw new WireFormatError("snapshot.state.players is not an array");
  }
  if (!Array.isArray(st["walls"])) {
    throw new WireFormatError("snapshot.state.walls is not an array");
  }
  if (typeof s["rngState"] !== "number" || !Number.isFinite(s["rngState"])) {
    throw new WireFormatError("snapshot.rngState is not a finite number");
  }
  if (typeof s["nextEntityId"] !== "number" || !Number.isFinite(s["nextEntityId"])) {
    throw new WireFormatError("snapshot.nextEntityId is not a finite number");
  }
}

/** Encode a NetMessage to a single datagram. */
export function encodeMessage(msg: NetMessage): Uint8Array {
  const out: number[] = [];
  writeVarint(out, PROTOCOL_VERSION);
  switch (msg.type) {
    case "hello": {
      out.push(TAG_HELLO);
      writeVarint(out, msg.slot);
      writeVarint(out, msg.seed);
      writeVarint(out, msg.playerCount);
      writeVarint(out, msg.version);
      const id = encodeUtf8(msg.arenaId);
      writeVarint(out, id.length);
      for (const b of id) out.push(b);
      const tok = encodeUtf8(msg.token);
      writeVarint(out, tok.length);
      for (const b of tok) out.push(b);
      break;
    }
    case "join": {
      out.push(TAG_JOIN);
      out.push(JOIN_ROLES.indexOf(msg.role)); // role validated by the type; codec stores its index
      writeVarint(out, msg.version);
      const tok = encodeUtf8(msg.reconnectToken ?? "");
      writeVarint(out, tok.length);
      for (const b of tok) out.push(b);
      const jt = encodeUtf8(msg.joinToken ?? "");
      writeVarint(out, jt.length);
      for (const b of jt) out.push(b);
      break;
    }
    case "reject":
      out.push(TAG_REJECT);
      out.push(REJECT_REASONS.indexOf(msg.reason));
      break;
    case "input":
      out.push(TAG_INPUT);
      writeVarint(out, msg.tick);
      out.push(encodeInputByte(msg.input));
      break;
    case "authoritative":
      out.push(TAG_AUTHORITATIVE);
      writeVarint(out, msg.tick);
      writeVarint(out, msg.inputs.length);
      for (const input of msg.inputs) out.push(encodeInputByte(input));
      break;
    case "ack":
      out.push(TAG_ACK);
      writeVarint(out, msg.tick);
      writeVarint(out, msg.inputTick);
      break;
    case "snapshot": {
      out.push(TAG_SNAPSHOT);
      const json = encodeUtf8(JSON.stringify(msg.snapshot));
      writeVarint(out, json.length);
      for (const b of json) out.push(b);
      break;
    }
    case "ping":
      out.push(TAG_PING);
      writeVarint(out, msg.id);
      break;
    case "pong":
      out.push(TAG_PONG);
      writeVarint(out, msg.id);
      writeVarint(out, msg.hostTick);
      break;
    case "lobby":
      out.push(TAG_LOBBY);
      writeVarint(out, msg.connected);
      writeVarint(out, msg.expected);
      break;
  }
  return Uint8Array.from(out);
}

/** Parse a datagram. Throws ProtocolVersionError on a version mismatch and
 *  WireFormatError on a malformed/truncated/unknown buffer. */
export function decodeMessage(bytes: Uint8Array): NetMessage {
  const version = readVarint(bytes, 0);
  if (version.value !== PROTOCOL_VERSION) {
    throw new ProtocolVersionError(PROTOCOL_VERSION, version.value);
  }
  let pos = version.next;
  if (pos >= bytes.length) throw new WireFormatError("message missing tag");
  const tag = bytes[pos++]!;

  switch (tag) {
    case TAG_HELLO: {
      const slot = readVarint(bytes, pos);
      const seed = readVarint(bytes, slot.next);
      const playerCount = readVarint(bytes, seed.next);
      const version = readVarint(bytes, playerCount.next);
      const len = readVarint(bytes, version.next);
      pos = len.next;
      if (bytes.length - pos < len.value) throw new WireFormatError("hello message truncated");
      const arenaId = decodeUtf8(bytes.subarray(pos, pos + len.value));
      pos += len.value;
      const tokLen = readVarint(bytes, pos);
      pos = tokLen.next;
      if (bytes.length - pos < tokLen.value) throw new WireFormatError("hello message truncated (token)");
      const token = decodeUtf8(bytes.subarray(pos, pos + tokLen.value));
      return {
        type: "hello",
        slot: slot.value,
        seed: seed.value,
        playerCount: playerCount.value,
        version: version.value,
        arenaId,
        token
      };
    }
    case TAG_JOIN: {
      if (pos >= bytes.length) throw new WireFormatError("join message missing role");
      const role = JOIN_ROLES[bytes[pos++]!];
      if (role === undefined) throw new WireFormatError("join message has unknown role");
      const version = readVarint(bytes, pos);
      const rcLen = readVarint(bytes, version.next);
      pos = rcLen.next;
      if (bytes.length - pos < rcLen.value) throw new WireFormatError("join message truncated");
      const reconnectToken = rcLen.value === 0 ? undefined : decodeUtf8(bytes.subarray(pos, pos + rcLen.value));
      pos += rcLen.value;
      const jtLen = readVarint(bytes, pos);
      pos = jtLen.next;
      if (bytes.length - pos < jtLen.value) throw new WireFormatError("join message truncated (joinToken)");
      const joinToken = jtLen.value === 0 ? undefined : decodeUtf8(bytes.subarray(pos, pos + jtLen.value));
      const msg: JoinMessage = { type: "join", role, version: version.value };
      if (reconnectToken !== undefined) msg.reconnectToken = reconnectToken;
      if (joinToken !== undefined) msg.joinToken = joinToken;
      return msg;
    }
    case TAG_REJECT: {
      if (pos >= bytes.length) throw new WireFormatError("reject message missing reason");
      const reason = REJECT_REASONS[bytes[pos]!];
      if (reason === undefined) throw new WireFormatError("reject message has unknown reason");
      return { type: "reject", reason };
    }
    case TAG_INPUT: {
      const tick = readVarint(bytes, pos);
      pos = tick.next;
      if (pos >= bytes.length) throw new WireFormatError("input message missing input byte");
      return { type: "input", tick: tick.value, input: decodeInputByte(bytes[pos]!) };
    }
    case TAG_AUTHORITATIVE: {
      const tick = readVarint(bytes, pos);
      const count = readVarint(bytes, tick.next);
      pos = count.next;
      if (bytes.length - pos < count.value) {
        throw new WireFormatError(`authoritative message truncated: expected ${count.value} inputs`);
      }
      const inputs: PlayerInput[] = [];
      for (let i = 0; i < count.value; i++) inputs.push(decodeInputByte(bytes[pos++]!));
      return { type: "authoritative", tick: tick.value, inputs };
    }
    case TAG_ACK: {
      const tick = readVarint(bytes, pos);
      const inputTick = readVarint(bytes, tick.next);
      return { type: "ack", tick: tick.value, inputTick: inputTick.value };
    }
    case TAG_PING: {
      const id = readVarint(bytes, pos);
      return { type: "ping", id: id.value };
    }
    case TAG_PONG: {
      const id = readVarint(bytes, pos);
      const hostTick = readVarint(bytes, id.next);
      return { type: "pong", id: id.value, hostTick: hostTick.value };
    }
    case TAG_LOBBY: {
      const connected = readVarint(bytes, pos);
      const expected = readVarint(bytes, connected.next);
      return { type: "lobby", connected: connected.value, expected: expected.value };
    }
    case TAG_SNAPSHOT: {
      const len = readVarint(bytes, pos);
      pos = len.next;
      if (bytes.length - pos < len.value) throw new WireFormatError("snapshot message truncated");
      const json = decodeUtf8(bytes.subarray(pos, pos + len.value));
      let snapshot: SimSnapshot;
      try {
        snapshot = JSON.parse(json) as SimSnapshot;
      } catch {
        throw new WireFormatError("snapshot message has invalid JSON");
      }
      assertSnapshotShape(snapshot);
      return { type: "snapshot", snapshot };
    }
    default:
      throw new WireFormatError(`unknown message tag ${tag}`);
  }
}
