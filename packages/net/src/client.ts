/**
 * Client session orchestrator (spec 010, T10.1). Ties the 009 primitives —
 * ClockSync (T9.3) + RollbackController (T9.4) + the message codec — together
 * over a single Transport, so the shell (and the headless tests) drive ONE
 * object instead of re-wiring clock/rollback/decode by hand.
 *
 * Pure and transport-agnostic: it takes a `Transport` (loopback in tests, a
 * browser WebSocket in the shell) and is driven by an explicit `tick(localInput)`
 * once per fixed sim step — no wall-time, no DOM. The wall clock lives entirely
 * in the caller (the shell's accumulator / a Node interval).
 *
 * Lifecycle:
 *   1. Construct with the session's static content (arena/tuning/friendlyFire)
 *      + the net params. It immediately listens on the transport.
 *   2. The Host sends a `HelloMessage` on connect → the client bootstraps its
 *      RollbackController (it now knows its slot, the seed, and playerCount).
 *   3. Each fixed step the caller invokes `tick(localInput)`: the client predicts
 *      forward to the clock-estimated host tick + inputDelay and sends each
 *      predicted input tagged with its tick. Inbound `authoritative`/`snapshot`
 *      messages confirm / resync the prediction; `ack`s feed the clock.
 *
 * The CONFIRMED state is ground truth (fed only the host's authoritative inputs)
 * and is byte-identical to the host's at every confirmed tick by determinism;
 * the PREDICTED state is what a renderer shows.
 */
import {
  type ArenaData,
  type PlayerInput,
  type PlayerSlotConfig,
  type SimEvent,
  type SimSnapshot,
  type SimState,
  type Tuning
} from "@shoot-and-run/sim";
import { ClockSync } from "./clock";
import { decodeMessage, encodeMessage } from "./codec";
import { createRollbackController, type RollbackControllerHandle } from "./rollback";
import type { Transport } from "./transport";

export interface ClientSessionConfig {
  /** The channel to the Host. The client registers its sole message handler. */
  transport: Transport;
  /** Arena to simulate — must match the Host's (shared local content for v1). */
  arena: ArenaData;
  /** Tuning, pinned for the whole session (hot-reload disabled online). */
  tuning: Tuning;
  friendlyFire?: boolean;
  /** Ticks of input lead — how far ahead of the estimated host tick to predict. */
  inputDelayTicks: number;
  /** Max ticks prediction may run ahead of confirmed (bounds rollback). */
  maxRollbackTicks: number;
}

export class ClientSession {
  private readonly clock = new ClockSync();
  private controller: RollbackControllerHandle | null = null;
  /** The client's own monotonic tick counter (its local clock), 1 per `tick()`. */
  private localTick = 0;
  private slot = -1;
  private arenaId = "";
  /** Datagrams that failed to decode (version/format mismatch) — diagnostics. */
  private malformed = 0;

  constructor(private readonly config: ClientSessionConfig) {
    config.transport.onMessage((data) => this.onMessage(data));
  }

  /** True once the Host's hello has bootstrapped the rollback controller. */
  get ready(): boolean {
    return this.controller !== null;
  }
  /** Slot the Host assigned this client (−1 until bootstrapped). */
  get localSlot(): number {
    return this.slot;
  }
  get confirmedTick(): number {
    return this.controller?.confirmedTick ?? 0;
  }
  get predictedTick(): number {
    return this.controller?.predictedTick ?? 0;
  }
  /** True once at least one ack has synced the clock. */
  get clockSynced(): boolean {
    return this.clock.synced;
  }
  get malformedCount(): number {
    return this.malformed;
  }
  get arena(): string {
    return this.arenaId;
  }

  /** Live predicted state for rendering (null until bootstrapped). */
  predictedState(): Readonly<SimState> | null {
    return this.controller?.predictedState() ?? null;
  }
  /** Confirmed (ground-truth) snapshot — equals the host's at confirmedTick. */
  snapshotConfirmed(): SimSnapshot | null {
    return this.controller?.snapshotConfirmed() ?? null;
  }

  /**
   * Advance one fixed step: predict forward to the clock-targeted tick using
   * `localInput` for the local slot, sending each predicted input to the Host.
   * Returns the events the live forward prediction emitted (for shell juice).
   * A no-op (returns []) until the Host's hello has arrived.
   */
  tick(localInput: PlayerInput): SimEvent[] {
    this.localTick++;
    const controller = this.controller;
    if (!controller) return [];

    // Where the predicted sim should reach: the estimated host tick plus the
    // input-delay lead so our inputs land just before the host commits them.
    // Before the first ack the clock has no estimate, so lead off the confirmed
    // tick — enough to start inputs (and therefore acks) flowing.
    const target = this.clock.synced
      ? this.clock.targetTick(this.localTick, this.config.inputDelayTicks)
      : controller.confirmedTick + this.config.inputDelayTicks;

    const events: SimEvent[] = [];
    while (controller.predictedTick <= target) {
      const tk = controller.predictedTick;
      if (tk - controller.confirmedTick >= this.config.maxRollbackTicks) break; // capped
      const stepEvents = controller.predict(tk, localInput);
      if (controller.predictedTick === tk) break; // didn't advance (capped) — avoid spin
      this.config.transport.send(encodeMessage({ type: "input", tick: tk, input: localInput }));
      this.clock.onSend(tk, this.localTick);
      for (const e of stepEvents) events.push(e);
    }
    return events;
  }

  /** Tear the session down. */
  close(): void {
    this.config.transport.close();
  }

  private onMessage(data: Uint8Array): void {
    let msg;
    try {
      msg = decodeMessage(data);
    } catch {
      this.malformed++; // version/format mismatch — drop, keep the session alive
      return;
    }
    switch (msg.type) {
      case "hello":
        if (!this.controller) this.bootstrap(msg.slot, msg.seed, msg.playerCount, msg.arenaId);
        break;
      case "authoritative":
        this.controller?.confirm(msg.tick, msg.inputs);
        break;
      case "snapshot":
        this.controller?.resync(msg.snapshot);
        break;
      case "ack":
        this.clock.onAck(msg.inputTick, msg.tick, this.localTick);
        break;
      case "input":
        break; // clients never receive raw inputs
    }
  }

  private bootstrap(slot: number, seed: number, playerCount: number, arenaId: string): void {
    this.slot = slot;
    this.arenaId = arenaId;
    // FFA roster: slot index == player index (matches the Host's player order).
    const players: PlayerSlotConfig[] = Array.from({ length: playerCount }, (_, i) => ({ slot: i }));
    this.controller = createRollbackController({
      arena: this.config.arena,
      tuning: this.config.tuning,
      players,
      seed,
      friendlyFire: this.config.friendlyFire,
      localSlot: slot,
      maxRollbackTicks: this.config.maxRollbackTicks
    });
  }
}
