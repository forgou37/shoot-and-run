/** Browser-context contract with the shell's dev-only test hook
 *  (packages/game/src/test-api.ts). Kept as a minimal structural duplicate
 *  so the e2e suite treats the hook as an API, not an internal import. */
interface ShellTestApi {
  /** Active high-level phase (spec 003 T3.5). Always present. */
  getPhase(): "title" | "lobby" | "match";
  getState(): {
    tick: number;
    round: { phase: string; winner: number | string | null };
    match: { scores: number[]; winner: number | null };
    players: {
      slot: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      quiver: string[];
      alive: boolean;
      grounded: boolean;
    }[];
    arrows: unknown[];
    chests: { x: number; y: number }[];
  };
  getArenaName(): string;
  getEvents(): { tick: number; type: string }[];
  setManual(on: boolean): void;
  stepTicks(n: number): void;
  getSpriteProbe(): { textures: string[]; missingAnims: string[] };
  /** Online net probe (spec 010 T10.6). Present only in the online scene. */
  getNetProbe?(): { ready: boolean; confirmedTick: number; predictedTick: number; confirmedHash: number };
  getConfirmedHashAt?(tick: number): number | null;
}

/** Minimal standard-mapping gamepad injected by the T3.5 gamepad e2e. */
interface ShimGamepad {
  index: number;
  connected: boolean;
  mapping: string;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

interface Window {
  __testApi?: ShellTestApi;
  __shimPad?: ShimGamepad;
}
