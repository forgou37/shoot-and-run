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
