/**
 * Net protocol message shapes (spec 008, T8.6) — TYPES ONLY. The host-authoritative
 * star protocol: clients send their inputs tagged with a target tick; the Host
 * broadcasts authoritative inputs, periodic snapshots, and acks. Encoding lives
 * in the sim's wire module for inputs (serializeInputFrame) and is added for the
 * other kinds in spec 009 — this file only names the envelopes.
 */
import type { PlayerInput, SimSnapshot } from "@shoot-and-run/sim";

/**
 * Host -> Client: the connection handshake (spec 010). Sent once, right after a
 * client connects, before any authoritative tick. It tells the freshly-joined
 * client who it is and the session contract it must reconstruct its sim with:
 * the `slot` the Host assigned it (connection order), the session `seed`, the
 * total `playerCount`, the `arenaId` so the client loads the matching arena from
 * its content, and a `version` — a fingerprint of the host's pinned content
 * (arena + tuning + protocol; see version.ts). In 011 the client and host are
 * deployed independently (Pages vs VPS), so the client compares `version` to its
 * own and refuses a mismatched session (VersionMismatchError) rather than silently
 * desyncing. Tuning is pinned from local content at session init (amendment #4).
 */
export interface HelloMessage {
  type: "hello";
  slot: number;
  seed: number;
  playerCount: number;
  arenaId: string;
  /** Host's content fingerprint (computeContentVersion) — client must match. */
  version: number;
}

/** What a connecting client wants to be (spec 013, T13.1). `player` takes a slot
 *  and drives the sim; `spectator` (consumed in T13.2) only watches — no slot,
 *  never gates the start, sends no input. */
export type JoinRole = "player" | "spectator";

/**
 * Client -> Host: the FIRST message a client sends, right after the socket opens
 * (spec 013, T13.1). It precedes the host's `hello` so the host can assign by
 * INTENT — player vs spectator (T13.2), or reclaiming a specific slot via
 * `reconnectToken` (T13.3) — instead of blind connection order. It also carries
 * the client's content `version` so the host can refuse a drifted build loudly
 * (a `reject`) without wasting a slot, complementing the client-side check on
 * `hello` (S4). A pre-013 client never sends this; the host's join-grace falls
 * back to a legacy `hello` so such a client can't hang (see host-runtime).
 */
export interface JoinMessage {
  type: "join";
  role: JoinRole;
  /** Client's content fingerprint (computeContentVersion) — host must match. */
  version: number;
  /** Reclaim a prior slot after a drop (T13.3); absent on a fresh join. */
  reconnectToken?: string;
}

/** Why the host refused a `join` (spec 013, T13.1). The client surfaces a
 *  message per reason: `version` → "refresh the page"; `full` → "game is full". */
export type RejectReason = "version" | "full";

/**
 * Host -> Client: the join was refused (spec 013, T13.1). A typed, surfaced
 * reason — the actionable alternative to silently closing the socket. The host
 * does NOT close after sending it; the client closes on receipt (so the reason
 * is never dropped by a close that races ahead of delivery).
 */
export interface RejectMessage {
  type: "reject";
  reason: RejectReason;
}

/** Client -> Host: this client's input for a target tick (the Host applies its
 *  input-delay window before stepping). On the wire: a serializeInputFrame. */
export interface InputMessage {
  type: "input";
  tick: number;
  input: PlayerInput;
}

/** Host -> Client: the confirmed authoritative inputs for a tick (all players,
 *  slot order). Receiving these is what triggers a client rollback + re-sim. */
export interface AuthoritativeInputsMessage {
  type: "authoritative";
  tick: number;
  inputs: PlayerInput[];
}

/** Host -> Client: a periodic full snapshot to hard-resync prediction. */
export interface SnapshotMessage {
  type: "snapshot";
  snapshot: SimSnapshot;
}

/**
 * Host -> Client: liveness / round-trip clock sample. `tick` is the host's
 * current committed tick when it acked; `inputTick` echoes the tick of the
 * client input being acknowledged, so the client can pair this ack with the
 * exact send it answers (robust to loss/reorder — see ClockSync).
 */
export interface AckMessage {
  type: "ack";
  tick: number;
  inputTick: number;
}

/**
 * Client -> Host: a clock-sync probe (spec 011, T11.2). Carries no gameplay
 * input, so a freshly-connected client can converge its clock BEFORE it leads —
 * `id` is an opaque client-local counter the host echoes in its pong.
 */
export interface PingMessage {
  type: "ping";
  id: number;
}

/** Host -> Client: the answer to a ping. `hostTick` is the host's current
 *  committed tick when it replied; `id` echoes the ping it answers (so the
 *  client pairs it robustly to its send, like an ack). */
export interface PongMessage {
  type: "pong";
  id: number;
  hostTick: number;
}

/**
 * Host -> Client: pre-match lobby status (spec 011, T11.3). Broadcast as clients
 * join so a waiting player sees the roster fill up ("connected / expected"). It
 * stops mattering once the match starts (authoritative inputs begin); the client
 * shows the last value it received while waiting.
 */
export interface LobbyMessage {
  type: "lobby";
  connected: number;
  expected: number;
}

export type NetMessage =
  | HelloMessage
  | JoinMessage
  | RejectMessage
  | InputMessage
  | AuthoritativeInputsMessage
  | SnapshotMessage
  | AckMessage
  | PingMessage
  | PongMessage
  | LobbyMessage;
