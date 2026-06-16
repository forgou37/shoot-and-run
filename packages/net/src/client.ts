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
  emptyInput,
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
import type { JoinMessage, JoinRole, RejectReason } from "./protocol";
import { createRollbackController, type RollbackControllerHandle } from "./rollback";
import type { Transport } from "./transport";
import { SessionRejectedError, VersionMismatchError, computeContentVersion } from "./version";

/**
 * Read-only net diagnostics for the shell overlay + e2e (spec 013, T13.4). All
 * client-observable, no PII — just how the prediction/clock are doing.
 */
export interface NetMetrics {
  ready: boolean;
  clockSynced: boolean;
  confirmedTick: number;
  predictedTick: number;
  /** Predicted lead over confirmed (ticks the client is running ahead). */
  leadTicks: number;
  /** Smoothed round-trip time in ticks. */
  rttTicks: number;
  /** Rollback corrections so far (a remote input differed from the guess). */
  rollbacks: number;
  /** Snapshot-driven resyncs so far (loss heals / reconnect). */
  resyncs: number;
  /** Datagrams that failed to decode (version/format mismatch). */
  malformed: number;
}

export interface ClientSessionConfig {
  /** The channel to the Host. The client registers its sole message handler. */
  transport: Transport;
  /** Arena to simulate — must match the Host's (shared local content for v1). */
  arena: ArenaData;
  /** Tuning, pinned for the whole session (hot-reload disabled online). */
  tuning: Tuning;
  friendlyFire?: boolean;
  /** What to join as (T13.1): `player` (default) or `spectator` (wired in T13.2). */
  role?: JoinRole;
  /**
   * Reclaim a prior slot after a drop (spec 013, T13.3): the token the host issued
   * on the original connection. Present only on a reconnect attempt; the host
   * sends an immediate snapshot, so this session resyncs to the live tick on hello.
   */
  reconnectToken?: string;
  /** Shared join secret for a gated host (spec 013, T13.5); omit for an open host. */
  joinToken?: string;
  /** Ticks of input lead — how far ahead of the estimated host tick to predict. */
  inputDelayTicks: number;
  /** Max ticks prediction may run ahead of confirmed (bounds rollback). */
  maxRollbackTicks: number;
  /**
   * Fatal-error sink (T11.2). Invoked once with a typed error the session cannot
   * recover from — currently only `VersionMismatchError` (host on a drifted
   * build). The shell surfaces it (e.g. "refresh the page") and leaves the menu.
   */
  onError?: (err: Error) => void;
}

export class ClientSession {
  private readonly clock = new ClockSync();
  private controller: RollbackControllerHandle | null = null;
  /** The client's own monotonic tick counter (its local clock), 1 per `tick()`. */
  private localTick = 0;
  private slot = -1;
  /** Spectator mode (T13.2): never sends input; predicts every slot to follow. */
  private readonly spectator: boolean;
  private arenaId = "";
  /** Datagrams that failed to decode (version/format mismatch) — diagnostics. */
  private malformed = 0;
  /** Net diagnostics (T13.4): rollback corrections + snapshot resyncs so far. */
  private rollbackCount = 0;
  private resyncCount = 0;
  /** True once the first authoritative tick has arrived — i.e. the host's loop is
   *  running (it parks at tick 0 until all clients connect). Before this the
   *  client pre-fills the opening buffer; after it, it syncs the clock then leads. */
  private hostStarted = false;
  /** Monotonic ping id for clock-bootstrap probes (T11.2). */
  private nextPingId = 0;
  /** Set if the host's content fingerprint differs from ours — session refused. */
  private versionMismatched = false;
  /** Set once the host has refused our join (any reason) — session is dead. */
  private rejected = false;
  /** Our content fingerprint, computed once: sent in the join + checked on hello. */
  private contentVersion = 0;
  /** The reconnect token the host issued for our slot (T13.3) — "" until hello. */
  private hostToken = "";
  /** Latest pre-match lobby status from the host (null until first received). */
  private lobby: { connected: number; expected: number } | null = null;

  constructor(private readonly config: ClientSessionConfig) {
    this.spectator = config.role === "spectator";
    this.contentVersion = computeContentVersion(config.arena, config.tuning);
    config.transport.onMessage((data) => this.onMessage(data));
    // Announce ourselves first (T13.1): role + our content fingerprint, so the
    // host admits by intent and can refuse a drifted build before wasting a slot.
    // A reconnectToken (T13.3) asks the host to reclaim our prior slot; a joinToken
    // (T13.5) presents the shared secret for a gated host. The browser transport
    // buffers this until the socket finishes opening.
    const join: JoinMessage = { type: "join", role: config.role ?? "player", version: this.contentVersion };
    if (config.reconnectToken) join.reconnectToken = config.reconnectToken;
    if (config.joinToken) join.joinToken = config.joinToken;
    config.transport.send(encodeMessage(join));
  }

  /** True once the Host's hello has bootstrapped the rollback controller. */
  get ready(): boolean {
    return this.controller !== null;
  }
  /** True if the host rejected us for a content/version mismatch (S4). */
  get versionMismatch(): boolean {
    return this.versionMismatched;
  }
  /** Latest pre-match lobby status (connected vs expected), or null until the
   *  host has sent one. The shell shows it on the waiting screen (T11.3). */
  get lobbyStatus(): { connected: number; expected: number } | null {
    return this.lobby;
  }
  /** True if this session is a spectator (no slot, never sends input — T13.2). */
  get spectating(): boolean {
    return this.spectator;
  }
  /** Slot the Host assigned this client (−1 until bootstrapped, and for spectators). */
  get localSlot(): number {
    return this.slot;
  }
  /** The host-issued reconnect token for our slot (T13.3) — "" until hello, or when
   *  reconnection is disabled. The shell stashes it to reclaim the slot after a drop. */
  get reconnectToken(): string {
    return this.hostToken;
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

  /** Read-only net diagnostics for the overlay / e2e (T13.4). */
  metrics(): NetMetrics {
    return {
      ready: this.ready,
      clockSynced: this.clock.synced,
      confirmedTick: this.confirmedTick,
      predictedTick: this.predictedTick,
      leadTicks: this.predictedTick - this.confirmedTick,
      rttTicks: this.clock.rttTicks,
      rollbacks: this.rollbackCount,
      resyncs: this.resyncCount,
      malformed: this.malformed
    };
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
    if (!controller) return []; // not bootstrapped (or the session was refused)

    if (this.spectator) return this.spectatorTick(controller);

    if (this.clock.synced) {
      // Steady state: lead off the synced clock, but only SEND inputs the host
      // won't have committed by the time they ARRIVE — i.e. tick >= the host tick
      // one one-way-delay from now. Otherwise the opening catch-up right after sync
      // re-tags ticks the host already (or imminently) commits, which it drops —
      // the 010 bootstrap input loss at real RTT. (Inputs below the floor can't
      // reach the host in time anyway, so skipping them loses nothing.)
      const sendFloor = this.clock.estimateHostTick(this.localTick) + this.clock.estimateOneWay();
      const target = this.clock.targetTick(this.localTick, this.config.inputDelayTicks);
      return this.predictTo(controller, target, localInput, sendFloor);
    }

    if (!this.hostStarted) {
      // Pre-start: the host is parked at tick 0 waiting for all clients. Lead off
      // the confirmed tick to PRE-FILL its opening-input buffer — correct because
      // the host begins at tick 0, so nothing sent here is late (send everything).
      const target = controller.confirmedTick + this.config.inputDelayTicks;
      return this.predictTo(controller, target, localInput, -Infinity);
    }

    // Host is running but the clock hasn't converged yet: do NOT lead off the now-
    // lagging confirmed tick (that tags inputs for committed ticks → late-dropped).
    // Hold prediction (confirm() keeps predictedTick tracking confirmedTick) and
    // ping until the first pong syncs the clock; the next tick then leads correctly.
    this.sendPing();
    return [];
  }

  /**
   * Spectator step (T13.2): never sends input. The controller's localSlot is −1,
   * so prediction guesses EVERY slot by repeat-last — a smooth follow view that
   * authoritative messages keep honest. Before the host starts there is nothing
   * to predict; once it runs, ping until the clock syncs, then predict up to the
   * estimated host tick (no inputDelay — a spectator isn't racing inputs there).
   */
  private spectatorTick(controller: RollbackControllerHandle): SimEvent[] {
    if (!this.hostStarted) return [];
    if (!this.clock.synced) {
      this.sendPing();
      return [];
    }
    const target = this.clock.estimateHostTick(this.localTick);
    return this.predictTo(controller, target, emptyInput(), Infinity); // Infinity floor = send nothing
  }

  /**
   * Predict forward to `target`, applying `localInput` each step and sending each
   * predicted input tagged with its tick — but only for ticks `>= sendFloor`. The
   * floor keeps the client from sending inputs for ticks the host has already
   * committed (which it would just drop); pass `-Infinity` to send unconditionally.
   */
  private predictTo(
    controller: RollbackControllerHandle,
    target: number,
    localInput: PlayerInput,
    sendFloor: number
  ): SimEvent[] {
    const events: SimEvent[] = [];
    while (controller.predictedTick <= target) {
      const tk = controller.predictedTick;
      if (tk - controller.confirmedTick >= this.config.maxRollbackTicks) break; // capped
      const stepEvents = controller.predict(tk, localInput);
      if (controller.predictedTick === tk) break; // didn't advance (capped) — avoid spin
      if (tk >= sendFloor) {
        this.config.transport.send(encodeMessage({ type: "input", tick: tk, input: localInput }));
        this.clock.onSend(tk, this.localTick);
      }
      for (const e of stepEvents) events.push(e);
    }
    return events;
  }

  /** Emit a clock-sync probe and record its send time, so the matching pong
   *  converges the clock without committing any gameplay input (T11.2). */
  private sendPing(): void {
    const id = this.nextPingId++;
    this.clock.onPingSent(id, this.localTick);
    this.config.transport.send(encodeMessage({ type: "ping", id }));
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
        this.onHello(msg.slot, msg.seed, msg.playerCount, msg.arenaId, msg.version, msg.token);
        break;
      case "authoritative":
        this.hostStarted = true; // the host's authoritative loop is running
        if (this.controller?.confirm(msg.tick, msg.inputs)) this.rollbackCount++; // a correction occurred
        break;
      case "snapshot":
        this.hostStarted = true;
        this.resyncCount++;
        this.controller?.resync(msg.snapshot);
        break;
      case "ack":
        this.clock.onAck(msg.inputTick, msg.tick, this.localTick);
        break;
      case "pong":
        this.clock.onPong(msg.id, msg.hostTick, this.localTick);
        break;
      case "lobby":
        this.lobby = { connected: msg.connected, expected: msg.expected };
        break;
      case "reject":
        this.onReject(msg.reason);
        break;
      case "input":
      case "ping":
      case "join":
        break; // clients never receive these
    }
  }

  /**
   * Handle the host refusing our join (T13.1). A `version` reject also flips the
   * `versionMismatch` flag so the shell renders the same "refresh the page"
   * message the client-side hello check produces; any reason is surfaced via
   * `onError` and tears the session down.
   */
  private onReject(reason: RejectReason): void {
    if (this.controller || this.versionMismatched || this.rejected) return;
    this.rejected = true;
    if (reason === "version") this.versionMismatched = true;
    this.config.onError?.(new SessionRejectedError(reason));
    this.config.transport.close();
  }

  /**
   * Handle the host's hello: reject (once) if its content fingerprint differs
   * from ours — the host is on a drifted build and a shared deterministic sim is
   * impossible (S4) — otherwise bootstrap the rollback controller.
   */
  private onHello(
    slot: number,
    seed: number,
    playerCount: number,
    arenaId: string,
    version: number,
    token: string
  ): void {
    if (this.controller || this.versionMismatched || this.rejected) return; // already bootstrapped / refused
    if (version !== this.contentVersion) {
      this.versionMismatched = true;
      this.config.onError?.(new VersionMismatchError(this.contentVersion, version));
      this.config.transport.close(); // refuse the drifted session
      return;
    }
    this.hostToken = token; // remember our slot's reconnect secret (T13.3)
    this.bootstrap(slot, seed, playerCount, arenaId);
  }

  private bootstrap(slot: number, seed: number, playerCount: number, arenaId: string): void {
    // A spectator owns no slot: localSlot −1 makes the controller guess every slot
    // by repeat-last (no slot matches), and the hello's placeholder slot is ignored.
    this.slot = this.spectator ? -1 : slot;
    this.arenaId = arenaId;
    // FFA roster: slot index == player index (matches the Host's player order).
    const players: PlayerSlotConfig[] = Array.from({ length: playerCount }, (_, i) => ({ slot: i }));
    this.controller = createRollbackController({
      arena: this.config.arena,
      tuning: this.config.tuning,
      players,
      seed,
      friendlyFire: this.config.friendlyFire,
      localSlot: this.slot,
      maxRollbackTicks: this.config.maxRollbackTicks
    });
  }
}
