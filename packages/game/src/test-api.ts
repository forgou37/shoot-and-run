import type Phaser from "phaser";
import type { SimEvent, SimState } from "@shoot-and-run/sim";

/**
 * Dev-only hook for browser e2e (spec 001 T1.4, extended in spec 003 T3.5).
 * `getPhase` is installed once at boot and works in every scene; the match-only
 * methods are wired by ArenaScene while it is active and removed on shutdown.
 * Absent from production builds. Playwright treats this as its contract.
 */
export type ShellPhase = "title" | "lobby" | "match";

export interface TestApi {
  /** Active high-level phase, for cross-scene e2e. */
  getPhase(): ShellPhase;
  getState?(): Readonly<SimState>;
  getArenaName?(): string;
  /** Copy of the rolling event log (most recent ~1000 events). */
  getEvents?(): SimEvent[];
  /** Pause the rAF-driven accumulator; only stepTicks advances the sim. */
  setManual?(on: boolean): void;
  /** Step exactly n ticks; the real keyboard state is sampled each tick. */
  stepTicks?(n: number): void;
  /** Sprite smoke probe (spec 006): loaded archer texture keys plus any
   *  missing per-slot animation keys (empty when healthy). */
  getSpriteProbe?(): { textures: string[]; missingAnims: string[] };
  /** Online net probe (spec 010 + metrics spec 013 T13.4): the client session's
   *  progress + diagnostics + the confirmed state hash at the current confirmed
   *  tick (for cross-tab convergence). */
  getNetProbe?(): {
    ready: boolean;
    clockSynced: boolean;
    confirmedTick: number;
    predictedTick: number;
    leadTicks: number;
    rttTicks: number;
    rollbacks: number;
    resyncs: number;
    malformed: number;
    confirmedHash: number;
  };
  /** Online (spec 010): the recorded confirmed-state hash at a specific tick,
   *  or null if not yet confirmed / evicted — lets two tabs compare a shared tick. */
  getConfirmedHashAt?(tick: number): number | null;
  /** Online (spec 013 T13.3): force-close the current socket to exercise the
   *  scene's auto-reconnect path. Present only in the online scene. */
  forceDisconnect?(): void;
}

declare global {
  interface Window {
    __testApi?: TestApi;
  }
}

/** Install the base hook at boot: getPhase reflects the active scene. */
export function installBaseTestApi(game: Phaser.Game): void {
  if (!import.meta.env.DEV) return;
  window.__testApi = {
    getPhase: () => {
      const sm = game.scene;
      if (sm.isActive("arena") || sm.isActive("online")) return "match";
      if (sm.isActive("lobby")) return "lobby";
      return "title";
    }
  };
}
