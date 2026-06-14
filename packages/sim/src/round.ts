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
  const teamsMode = state.match.teamScores !== null;

  if (state.round.phase === "running") {
    const alive = state.players.filter((p) => p.alive);
    // FFA — last one standing (or nobody) ends the round; single-player sims
    // (tests) run until the lone player dies. Teams — the round ends once every
    // alive player shares a team (or nobody is left).
    const roundOver = teamsMode
      ? alive.length === 0 || alive.every((p) => p.team === alive[0]!.team)
      : alive.length === 0 || (state.players.length > 1 && alive.length <= 1);
    if (roundOver) {
      state.round.phase = "ended";
      if (teamsMode) endTeamsRound(state, t, events, alive);
      else endFfaRound(state, t, events, alive);
      state.round.restartTicksLeft =
        state.match.winner !== null ? t.matchRestartDelayTicks : t.roundRestartDelayTicks;
    }
    return;
  }

  state.round.restartTicksLeft--;
  if (state.round.restartTicksLeft <= 0) {
    if (state.match.winner !== null) {
      // Match over: the restart begins a fresh match.
      state.match.scores = state.players.map(() => 0);
      if (state.match.teamScores !== null) state.match.teamScores = [0, 0];
      state.match.winner = null;
      state.round.number = 0;
    }
    state.players.forEach((p, index) => resetPlayer(p, index, arena, t));
    state.arrows = [];
    state.chests = [];
    state.nextChestTick = state.tick + t.chestIntervalTicks;
    state.round.phase = "running";
    state.round.winner = null;
    state.round.number++;
    events.push({ tick: state.tick, type: "round_started" });
  }
}

/** FFA round end: lone survivor (or draw), winner scores, match at roundsToWin.
 *  Byte-identical to the pre-teams logic — the golden log depends on it. */
function endFfaRound(
  state: SimState,
  t: DerivedTuning,
  events: SimEvent[],
  alive: PlayerState[]
): void {
  const winner = alive.length === 1 ? alive[0]!.slot : "draw";
  state.round.winner = winner;
  events.push({ tick: state.tick, type: "round_ended", winner });

  if (winner !== "draw") {
    const idx = state.players.findIndex((p) => p.slot === winner);
    state.match.scores[idx] = (state.match.scores[idx] ?? 0) + 1;
    if (state.match.scores[idx]! >= t.roundsToWin) {
      state.match.winner = winner;
      events.push({
        tick: state.tick,
        type: "match_ended",
        winner,
        scores: [...state.match.scores]
      });
    }
  }
}

/** Teams round end: the surviving team wins (draw if none survive). Each
 *  survivor's per-player score ticks up (individual survivals), but the match
 *  is decided by teamScores; match_ended carries the team tally. */
function endTeamsRound(
  state: SimState,
  t: DerivedTuning,
  events: SimEvent[],
  alive: PlayerState[]
): void {
  const winner: number | "draw" = alive.length === 0 ? "draw" : alive[0]!.team!;
  state.round.winner = winner;
  events.push({ tick: state.tick, type: "round_ended", winner });

  for (const p of alive) {
    const idx = state.players.indexOf(p);
    state.match.scores[idx] = (state.match.scores[idx] ?? 0) + 1;
  }

  if (winner !== "draw") {
    const teamScores = state.match.teamScores!;
    teamScores[winner] = (teamScores[winner] ?? 0) + 1;
    if (teamScores[winner]! >= t.roundsToWin) {
      state.match.winner = winner;
      events.push({
        tick: state.tick,
        type: "match_ended",
        winner,
        scores: [...teamScores]
      });
    }
  }
}

function resetPlayer(p: PlayerState, index: number, arena: ArenaData, t: DerivedTuning): void {
  const spawn = arena.spawns[index]!; // validated at createSim
  p.x = spawn.x;
  p.y = spawn.y;
  p.vx = 0;
  p.vy = 0;
  p.facing = 1;
  p.quiver = Array.from({ length: t.startingArrows }, () => "normal" as const);
  p.alive = true;
  p.grounded = false;
  p.coyoteTicksLeft = 0;
  p.jumpBufferTicksLeft = 0;
  p.prevJumpHeld = false;
  p.prevShootHeld = false;
  p.prevDashHeld = false;
  p.dashTicksLeft = 0;
  p.dashCooldownTicksLeft = 0;
  p.dashDir = 1;
  p.wallJumpLockTicksLeft = 0;
  p.jumpCutAvailable = false;
  p.invisibleTicksLeft = 0;
  p.flightTicksLeft = 0;
}
