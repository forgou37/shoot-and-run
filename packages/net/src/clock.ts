/**
 * Client-side clock / tick sync (spec 008, Phase 009 / T9.3). Estimates the
 * host's current tick from ack round-trips so the client can target
 * `hostTick + inputDelay` for its inputs — far enough ahead that they reach the
 * host before it commits that tick.
 *
 * Pure and transport-free: the caller feeds it `onSend(localTick)` when it emits
 * an ack-eliciting message and `onAck(hostTick, localNow)` when an ack returns.
 * Acks are assumed to return in send order (true on an ordered channel; under
 * loss/jitter the estimate stays bounded, which is all the contract requires).
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
  /** Local ticks of sends still awaiting their ack, in send order. */
  private readonly pending: number[] = [];

  constructor(private readonly smoothing = 0.2) {}

  /** Record that an ack-eliciting message was sent at this local tick. */
  onSend(localTick: number): void {
    this.pending.push(localTick);
  }

  /** Fold in an ack: the host was at `hostTick` when it acked, received now. */
  onAck(hostTick: number, localNow: number): void {
    const sentTick = this.pending.shift();
    if (sentTick === undefined) return; // unmatched ack (e.g. after loss); ignore
    const rtt = localNow - sentTick;
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
