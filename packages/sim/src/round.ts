import type { ArenaData } from "./arena";
import type { SimEvent } from "./events";
import type { PlayerState, SimState } from "./state";
import type { DerivedTuning } from "./tuning";

/**
 * Round state machine: running → ended(winner|draw) → restart after
 * roundRestartDelayTicks. Gameplay is frozen while ended; on restart all
 * players respawn (spawn assignment by player index) with fresh arrows and
 * all arrow entities are cleared.
 */
export function updateRound(
  state: SimState,
  arena: ArenaData,
  t: DerivedTuning,
  events: SimEvent[]
): void {
  if (state.round.phase === "running") {
    const alive = state.players.filter((p) => p.alive);
    // Multi-player: last one standing (or nobody) ends the round.
    // Single-player sims (tests, future target practice) run until the lone
    // player dies — otherwise the round would end at tick 0.
    const roundOver =
      alive.length === 0 || (state.players.length > 1 && alive.length <= 1);
    if (roundOver) {
      state.round.phase = "ended";
      state.round.winner = alive.length === 1 ? alive[0]!.slot : "draw";
      state.round.restartTicksLeft = t.roundRestartDelayTicks;
      events.push({ tick: state.tick, type: "round_ended", winner: state.round.winner });
    }
    return;
  }

  state.round.restartTicksLeft--;
  if (state.round.restartTicksLeft <= 0) {
    state.players.forEach((p, index) => resetPlayer(p, index, arena, t));
    state.arrows = [];
    state.round.phase = "running";
    state.round.winner = null;
    state.round.number++;
    events.push({ tick: state.tick, type: "round_started" });
  }
}

function resetPlayer(p: PlayerState, index: number, arena: ArenaData, t: DerivedTuning): void {
  const spawn = arena.spawns[index]!; // validated at createSim
  p.x = spawn.x;
  p.y = spawn.y;
  p.vx = 0;
  p.vy = 0;
  p.facing = 1;
  p.arrows = t.startingArrows;
  p.alive = true;
  p.grounded = false;
  p.coyoteTicksLeft = 0;
  p.jumpBufferTicksLeft = 0;
  p.prevJumpHeld = false;
  p.prevShootHeld = false;
  p.jumpCutAvailable = false;
}
