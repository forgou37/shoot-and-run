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
  /** Whether releasing jump still shortens the current jump (variable height). */
  jumpCutAvailable: boolean;
}

export type ArrowPhase = "flying" | "stuck";

export interface ArrowState {
  id: number;
  ownerSlot: number;
  phase: ArrowPhase;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimState {
  tick: number;
  players: PlayerState[];
  arrows: ArrowState[];
}
