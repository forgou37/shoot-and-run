/**
 * Client-side clock / tick sync (spec 008, Phase 009 / T9.3). Estimates the
 * host's current tick from ack round-trips so the client can target
 * `hostTick + inputDelay` for its inputs — far enough ahead that they reach the
 * host before it commits that tick.
 *
 * Pure and transport-free: the caller feeds it `onSend(inputTick, localTick)`
 * when it emits an ack-eliciting input and `onAck(inputTick, hostTick, localNow)`
 * when the matching ack returns. Each send/ack is paired by the input's tick
 * (the ack echoes it — see AckMessage), NOT by arrival order, so a dropped or
 * reordered ack only loses its own sample; it never mispairs later acks.
 *
 * Derivation (fixed one-way delay D, true offset K where hostTick = localTick+K):
 *   send at local S → host acks at host tick H = S + D + K → ack arrives at
 *   local R = S + 2D. Then rtt = R - S = 2D, oneWay = D, and
 *   sampleOffset = (H + oneWay) - R = K  — exact. EMA-smoothed across samples.
 */
export class ClockSync {
  /** Estimated hostTick - localTick. */
  private offset = 0;
  /** Estimated one-way delay in ticks (EMA) — how long a datagram is in flight.
   *  Used to floor outbound input ticks at the host tick they'll arrive on, so the
   *  client never sends inputs the host will already have committed (T11.2). */
  private oneWayEst = 0;
  private initialized = false;
  /** inputTick -> local tick it was sent at, awaiting that input's ack. */
  private readonly sentAt = new Map<number, number>();
  /** pingId -> local tick it was sent at, awaiting that ping's pong. A disjoint
   *  id space from `sentAt` so ping and input samples never collide (T11.2). */
  private readonly pingSentAt = new Map<number, number>();

  constructor(
    private readonly smoothing = 0.2,
    /** Cap on outstanding unacked sends; oldest is dropped past this (its ack
     *  was lost) so the map can't grow without bound under sustained loss. */
    private readonly maxPending = 512
  ) {}

  /** Record that the client sent its input for `inputTick` at `localTick`. */
  onSend(inputTick: number, localTick: number): void {
    this.sentAt.set(inputTick, localTick);
    if (this.sentAt.size > this.maxPending) {
      const oldest = this.sentAt.keys().next().value; // insertion order
      if (oldest !== undefined) this.sentAt.delete(oldest);
    }
  }

  /** Fold in the ack for `inputTick`: host was at `hostTick`, received now. */
  onAck(inputTick: number, hostTick: number, localNow: number): void {
    const sentLocal = this.sentAt.get(inputTick);
    if (sentLocal === undefined) return; // no matching send (lost/duplicate); ignore
    this.sentAt.delete(inputTick);
    this.fold(sentLocal, hostTick, localNow);
  }

  /** Record that the client sent ping `pingId` at `localTick` (clock bootstrap). */
  onPingSent(pingId: number, localTick: number): void {
    this.pingSentAt.set(pingId, localTick);
    if (this.pingSentAt.size > this.maxPending) {
      const oldest = this.pingSentAt.keys().next().value; // insertion order
      if (oldest !== undefined) this.pingSentAt.delete(oldest);
    }
  }

  /** Fold in the pong for `pingId`: host was at `hostTick`, received now. The
   *  same RTT estimator as `onAck`, but driven by a ping that carries no input —
   *  so the clock can converge before the client ever leads (T11.2). */
  onPong(pingId: number, hostTick: number, localNow: number): void {
    const sentLocal = this.pingSentAt.get(pingId);
    if (sentLocal === undefined) return; // no matching ping (lost/duplicate); ignore
    this.pingSentAt.delete(pingId);
    this.fold(sentLocal, hostTick, localNow);
  }

  /** Fold one round-trip sample (sent at `sentLocal`, host at `hostTick`, back
   *  at `localNow`) into the EMA offset estimate. Shared by acks and pongs. */
  private fold(sentLocal: number, hostTick: number, localNow: number): void {
    const rtt = localNow - sentLocal;
    const oneWay = rtt / 2;
    const sampleOffset = hostTick + oneWay - localNow;
    if (!this.initialized) {
      this.offset = sampleOffset;
      this.oneWayEst = oneWay;
      this.initialized = true;
    } else {
      this.offset += this.smoothing * (sampleOffset - this.offset);
      this.oneWayEst += this.smoothing * (oneWay - this.oneWayEst);
    }
  }

  /** True once at least one ack has been folded in. */
  get synced(): boolean {
    return this.initialized;
  }

  /** Best estimate of the host's current tick. */
  estimateHostTick(localNow: number): number {
    return Math.round(localNow + this.offset);
  }

  /** Estimated one-way delay in ticks (rounded UP, so flooring outbound input
   *  ticks by it is conservative — never sends an input the host already has). */
  estimateOneWay(): number {
    return Math.max(0, Math.ceil(this.oneWayEst));
  }

  /** The tick a client should tag its current input with. */
  targetTick(localNow: number, inputDelayTicks: number): number {
    return this.estimateHostTick(localNow) + inputDelayTicks;
  }
}
