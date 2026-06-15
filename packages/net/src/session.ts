/**
 * Prediction / rollback session types (spec 008, T8.6) — TYPES ONLY. The loop
 * itself (clock sync, jitter buffer, predict/rollback over a transport) is
 * spec 009; this file fixes the contract it will implement, built on the sim's
 * snapshot/restore + input wire from T8.1–T8.4.
 */
import type { PlayerInput, SimEvent, SimSnapshot } from "@shoot-and-run/sim";

/** One tick's inputs for every player, in slot order. */
export type TickInputs = PlayerInput[];

/** Tunables for the predict/rollback loop. */
export interface PredictionParams {
  /** Ticks the Host delays applying client input, to absorb jitter (~2-3). */
  inputDelayTicks: number;
  /** How often the Host broadcasts a full snapshot to bound prediction drift. */
  snapshotIntervalTicks: number;
  /** Max ticks a client will roll back and re-simulate on a single correction. */
  maxRollbackTicks: number;
}

/**
 * Client-side prediction + rollback controller. Holds the last host-confirmed
 * snapshot plus the predicted input history; on a correction it restores the
 * snapshot and re-simulates forward — deterministically, so the re-sim is exact
 * (not a lerp) and only a CHANGED remote input causes a visible correction.
 */
export interface RollbackController {
  /** Latest tick the Host has confirmed authoritative inputs for. */
  readonly confirmedTick: number;
  /** Tick the local predicted sim has advanced to. */
  readonly predictedTick: number;
  /**
   * Record the local player's input for a tick and predict forward one tick.
   * Returns the events the predicted step emitted (for shell juice / animation);
   * empty when the controller is stalled at the rollback cap or `tick` is not the
   * next predicted tick. Rollback re-simulations do NOT surface events here — only
   * this single live forward step does — so juice fires once per real tick.
   */
  predict(tick: number, input: PlayerInput): SimEvent[];
  /**
   * Apply authoritative inputs for a tick. Rolls back to the last confirmed
   * tick and re-simulates if they differ from what was predicted; returns true
   * iff that produced a visible correction.
   */
  confirm(tick: number, inputs: TickInputs): boolean;
  /** Hard-resync to a Host snapshot, discarding divergent prediction. */
  resync(snapshot: SimSnapshot): void;
}

/**
 * The authoritative Host loop (dedicated process or listen-server). Applies the
 * input-delay window, steps the canonical sim, and broadcasts authoritative
 * inputs + periodic snapshots. Interface only.
 */
export interface HostSession {
  /** The tick the canonical sim has reached. */
  readonly tick: number;
  /** Buffer a client's input for a future tick. */
  receiveInput(clientId: string, tick: number, input: PlayerInput): void;
  /** Advance the canonical sim one tick and return what to broadcast. */
  step(): void;
}
