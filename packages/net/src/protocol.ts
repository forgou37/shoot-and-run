/**
 * Net protocol message shapes (spec 008, T8.6) — TYPES ONLY. The host-authoritative
 * star protocol: clients send their inputs tagged with a target tick; the Host
 * broadcasts authoritative inputs, periodic snapshots, and acks. Encoding lives
 * in the sim's wire module for inputs (serializeInputFrame) and is added for the
 * other kinds in spec 009 — this file only names the envelopes.
 */
import type { PlayerInput, SimSnapshot } from "@shoot-and-run/sim";

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

export type NetMessage =
  | InputMessage
  | AuthoritativeInputsMessage
  | SnapshotMessage
  | AckMessage;
