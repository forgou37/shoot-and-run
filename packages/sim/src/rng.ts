/**
 * Mulberry32 — small, fast, deterministic 32-bit PRNG.
 * Hard rule 4 (CLAUDE.md): this is the only randomness source allowed
 * inside the sim.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [0, max). */
  nextInt(max: number): number;
  /**
   * The full internal state (one uint32) — everything needed to resume the
   * stream. For snapshot/restore (spec 008); not used during normal play.
   */
  getState(): number;
  /** Reseed the internal state to a previously captured `getState()` value. */
  setState(state: number): void;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;

  function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    nextInt: (max: number) => Math.floor(next() * max),
    getState: () => a,
    setState: (state: number) => {
      a = state >>> 0;
    }
  };
}
