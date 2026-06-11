export interface PlayerState {
  /** Deterministic entity id, assigned by the sim's id counter at init. */
  id: number;
  /** Player slot (0-based); stable across rounds, maps to a device in the shell. */
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  arrows: number;
  alive: boolean;
  grounded: boolean;
  /** Ticks of post-ledge jump grace remaining (0 when grounded or consumed). */
  coyoteTicksLeft: number;
  /** Ticks the pending jump press stays valid (jump buffering). */
  jumpBufferTicksLeft: number;
  /** Previous tick's jump-held state, for press/release edge detection. */
  prevJumpHeld: boolean;
  /** Previous tick's shoot-held state, for press edge detection. */
  prevShootHeld: boolean;
  /** Whether releasing jump still shortens the current jump (variable height). */
  jumpCutAvailable: boolean;
}

export type ArrowPhase = "flying" | "stuck";

export interface ArrowState {
  id: number;
  ownerSlot: number;
  phase: ArrowPhase;
  /** Tick the arrow was fired on; drives muzzle immunity for the shooter. */
  firedTick: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type RoundPhase = "running" | "ended";

export interface RoundState {
  phase: RoundPhase;
  /** Winning slot or "draw" while ended; null while running. */
  winner: number | "draw" | null;
  /** Ticks until the next round starts (only meaningful while ended). */
  restartTicksLeft: number;
  /** 1-based round counter. */
  number: number;
}

export interface MatchState {
  /** Round wins by player index (parallel to the players array). */
  scores: number[];
  /** Winning slot once someone reaches roundsToWin; null while contested. */
  winner: number | null;
}

export interface SimState {
  tick: number;
  round: RoundState;
  match: MatchState;
  players: PlayerState[];
  arrows: ArrowState[];
}
