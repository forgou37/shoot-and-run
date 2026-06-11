import { TICK_RATE } from "@shoot-and-run/sim";

export const TICK_MS = 1000 / TICK_RATE;

/** Longest frame delta we honor; anything slower (tab switch, debugger pause)
 *  is clamped so the sim never enters a catch-up spiral. */
const MAX_FRAME_MS = 100;

/**
 * Fixed-timestep accumulator. The render loop calls advance() once per frame;
 * `step` runs zero or more times at exactly TICK_MS intervals; the returned
 * alpha in [0, 1) is how far we are into the next tick, for interpolation.
 */
export class FixedStepDriver {
  private accumulatorMs = 0;

  advance(deltaMs: number, step: () => void): number {
    this.accumulatorMs += Math.min(deltaMs, MAX_FRAME_MS);
    while (this.accumulatorMs >= TICK_MS) {
      step();
      this.accumulatorMs -= TICK_MS;
    }
    return this.accumulatorMs / TICK_MS;
  }
}
