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
  private initialized = false;
  /** inputTick -> local tick it was sent at, awaiting that input's ack. */
  private readonly sentAt = new Map<number, number>();

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
    const rtt = localNow - sentLocal;
    const oneWay = rtt / 2;
    const sampleOffset = hostTick + oneWay - localNow;
    if (!this.initialized) {
      this.offset = sampleOffset;
      this.initialized = true;
    } else {
      this.offset += this.smoothing * (sampleOffset - this.offset);
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

  /** The tick a client should tag its current input with. */
  targetTick(localNow: number, inputDelayTicks: number): number {
    return this.estimateHostTick(localNow) + inputDelayTicks;
  }
}
