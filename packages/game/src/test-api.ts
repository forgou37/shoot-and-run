import type { SimEvent, SimState } from "@shoot-and-run/sim";

/**
 * Dev-only hook for browser e2e (spec 001 T1.4). Installed on window by
 * ArenaScene when import.meta.env.DEV — absent from production builds.
 * Playwright treats this as its contract with the shell.
 */
export interface TestApi {
  getState(): Readonly<SimState>;
  getArenaName(): string;
  /** Copy of the rolling event log (most recent ~1000 events). */
  getEvents(): SimEvent[];
  /** Pause the rAF-driven accumulator; only stepTicks advances the sim. */
  setManual(on: boolean): void;
  /** Step exactly n ticks; the real keyboard state is sampled each tick. */
  stepTicks(n: number): void;
  /** Sprite smoke probe (spec 006): loaded archer texture keys plus any
   *  missing per-slot animation keys (empty when healthy). */
  getSpriteProbe(): { textures: string[]; missingAnims: string[] };
}

declare global {
  interface Window {
    __testApi?: TestApi;
  }
}
