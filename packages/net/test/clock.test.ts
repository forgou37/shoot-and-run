import { describe, expect, it } from "vitest";
import { ClockSync } from "../src/clock";

/**
 * Feed the estimator synthetic send/ack pairs for a true offset K and one-way
 * delay D: a send at local S is acked with host tick S + D + K, arriving at
 * local S + 2D.
 */
function simulate(opts: {
  trueOffset: number;
  oneWay: (i: number) => number;
  samples: number;
  smoothing?: number;
}): ClockSync {
  const sync = new ClockSync(opts.smoothing);
  let local = 0;
  for (let i = 0; i < opts.samples; i++) {
    const d = opts.oneWay(i);
    const sendLocal = local;
    sync.onSend(sendLocal);
    const hostAtAck = sendLocal + d + opts.trueOffset;
    const ackLocal = sendLocal + 2 * d;
    sync.onAck(hostAtAck, ackLocal);
    local = ackLocal + 1; // next send a bit later
  }
  return sync;
}

describe("clock sync (T9.3 / M4)", () => {
  it("recovers the host offset exactly under fixed delay (±0)", () => {
    const K = 17;
    const sync = simulate({ trueOffset: K, oneWay: () => 4, samples: 20 });
    expect(sync.synced).toBe(true);
    for (const local of [0, 50, 1000]) {
      expect(sync.estimateHostTick(local)).toBe(local + K); // exact
    }
  });

  it("targets hostTick + inputDelay", () => {
    const sync = simulate({ trueOffset: 10, oneWay: () => 3, samples: 20 });
    expect(sync.targetTick(100, 3)).toBe(100 + 10 + 3);
  });

  it("stays within ±1 tick under jitter", () => {
    // one-way delay jitters in [2, 8]; deterministic pattern, no RNG needed
    const pattern = [2, 8, 3, 7, 4, 6, 5, 2, 8, 3, 7, 5, 4, 6, 2, 8];
    const sync = simulate({
      trueOffset: 25,
      oneWay: (i) => pattern[i % pattern.length]!,
      samples: 200,
      smoothing: 0.15
    });
    const err = Math.abs(sync.estimateHostTick(500) - (500 + 25));
    expect(err).toBeLessThanOrEqual(1);
  });

  it("ignores an unmatched ack (more acks than sends)", () => {
    const sync = new ClockSync();
    sync.onAck(5, 5); // no prior send
    expect(sync.synced).toBe(false);
  });
});
