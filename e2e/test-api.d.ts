/** Browser-context contract with the shell's dev-only test hook
 *  (packages/game/src/test-api.ts). Kept as a minimal structural duplicate
 *  so the e2e suite treats the hook as an API, not an internal import. */
interface ShellTestApi {
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
}

interface Window {
  __testApi?: ShellTestApi;
}
