export type ArrowKind = "normal" | "bomb" | "laser" | "bounce";

export interface PlayerState {
  /** Deterministic entity id, assigned by the sim's id counter at init. */
  id: number;
  /** Player slot (0-based); stable across rounds, maps to a device in the shell. */
  slot: number;
  /** Team id (0 or 1) in teams mode; null in free-for-all. Stable across rounds. */
  team: number | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  /** Typed ammo, fired front-first. Specials are pushed to the front. */
  quiver: ArrowKind[];
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
  /** Previous tick's dash-held state, for press edge detection. */
  prevDashHeld: boolean;
  /** Ticks left in the active dash burst (0 = not dashing). */
  dashTicksLeft: number;
  /** Cooldown ticks before the next dash is allowed (0 = ready). */
  dashCooldownTicksLeft: number;
  /** Locked horizontal direction of the active dash. */
  dashDir: 1 | -1;
  /** Ticks of air-control suspension left after a wall jump (0 = free control). */
  wallJumpLockTicksLeft: number;
  /** Whether releasing jump still shortens the current jump (variable height). */
  jumpCutAvailable: boolean;
  /** Power-up timers (ticks). 0 = inactive. Reset on round reset. */
  invisibleTicksLeft: number;
  flightTicksLeft: number;
  /** Shield charge (spec 014): absorbs the first lethal hit, then clears.
   *  A persistent charge — no timer. Cleared on death/round reset. */
  shielded: boolean;
  /** Build charges (spec 018): each spends one deployable wall. A persistent
   *  count — no timer. Granted by a "wall" booster, cleared on death/round reset. */
  wallCharges: number;
  /** Previous tick's build-held state, for press edge detection. */
  prevBuildHeld: boolean;
  /** "No homo" shield timer (spec 019, Igor B / slot 1): while > 0 the player is
   *  immune to stomps and to any kill whose source is within noHomoRadiusPx. A
   *  timer, not a charge — blocking does not consume it. Cleared on death/reset. */
  noHomoTicksLeft: number;
}

/** "exploding" and "spent" are transient within a tick: a contacted bomb is
 *  marked exploding, resolved (radius kills + event), then spent and removed
 *  before the tick ends — the shell never sees either. */
export type ArrowPhase = "flying" | "stuck" | "exploding" | "spent";

export interface ArrowState {
  id: number;
  ownerSlot: number;
  kind: ArrowKind;
  phase: ArrowPhase;
  /** Tick the arrow was fired on; drives muzzle immunity for the shooter. */
  firedTick: number;
  /** Bounce kind: reflections remaining before the next contact sticks. */
  bouncesLeft: number;
  /** Laser kind: passed through its first contiguous obstacle. */
  pierced: boolean;
  /** Laser kind: currently inside the first obstacle. */
  insideSolid: boolean;
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

export type ChestContents =
  | Exclude<ArrowKind, "normal">
  | "invisibility"
  | "flight"
  | "shield"
  | "wall"
  | "character";

export interface ChestState {
  id: number;
  x: number;
  y: number;
  /** Decided deterministically (sim PRNG) at spawn time. */
  contents: ChestContents;
}

/**
 * A floating booster popped by an opened chest (spec 014): it hovers at a fixed
 * point `boosterFloatOffsetPx` above the chest's spot until an alive player
 * touches it, granting the contents then. The visual up/down bob is cosmetic
 * (shell-only) and never affects the fixed pickup position.
 */
export interface BoosterState {
  id: number;
  x: number;
  y: number;
  contents: ChestContents;
  /** Tick the booster was spawned on; drives the shell's cosmetic bob phase. */
  spawnTick: number;
}

/**
 * A deployed wall (spec 018): a thin 4×24 solid plank built in front of a player.
 * Neutral — it blocks every player and every arrow (including the builder's own).
 * Removed when a flying arrow hits it. `ownerSlot` is for FX tint + event
 * attribution only; collision ignores it. `rotation` is the sprite rotation of the
 * base (vertical) wall; the collider derives local length/thickness axes from it
 * with exact constants so stored state stays JSON-stable.
 */
export interface WallState {
  id: number;
  ownerSlot: number;
  x: number;
  y: number;
  rotation: 0 | 45 | 90 | 135;
  /** Absolute tick the wall dissolves on its own (built tick + wallLifetimeTicks,
   *  spec 018). Reaching it emits the same wall_destroyed event an arrow hit does. */
  expireTick: number;
}

export interface MatchState {
  /** Per-player round-survival count, by player index (parallel to players).
   *  In teams mode this still tallies individual survivals but does not decide
   *  the match — teamScores does. */
  scores: number[];
  /** Winning id once the match is decided; null while contested. In FFA this is
   *  the winning slot; in teams mode it is the winning team id. */
  winner: number | null;
  /** Team round-win tally `[team0, team1]` in teams mode; null in FFA. Match
   *  victory (first to roundsToWin) reads this. */
  teamScores: number[] | null;
}

export interface SimState {
  tick: number;
  round: RoundState;
  match: MatchState;
  players: PlayerState[];
  arrows: ArrowState[];
  chests: ChestState[];
  /** Floating boosters popped by opened chests, awaiting pickup (spec 014). */
  boosters: BoosterState[];
  /** Deployed walls (spec 018), in build order; each blocks until an arrow hits it. */
  walls: WallState[];
  /** Next tick a chest spawn is attempted (arena must have chestSpots). */
  nextChestTick: number;
}
