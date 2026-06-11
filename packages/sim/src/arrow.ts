import { ARENA_HEIGHT, ARENA_WIDTH, type ArenaData } from "./arena";
import { ARROW_HALF_LONG, ARROW_HALF_SHORT, DT, PICKUP_RADIUS } from "./constants";
import type { SimEvent } from "./events";
import type { PlayerInput } from "./input";
import { moveAxisX, moveAxisY, wrapDelta } from "./physics";
import type { ArrowState, PlayerState } from "./state";
import type { DerivedTuning } from "./tuning";

/** Flying arrows are a thin box aligned to their dominant velocity axis. */
export function arrowHalves(a: { vx: number; vy: number }): { hw: number; hh: number } {
  return Math.abs(a.vx) >= Math.abs(a.vy)
    ? { hw: ARROW_HALF_LONG, hh: ARROW_HALF_SHORT }
    : { hw: ARROW_HALF_SHORT, hh: ARROW_HALF_LONG };
}

/**
 * Fire on shoot-press edges. Aim is 8-directional from the held direction
 * keys at the moment of fire; with no direction held, fires horizontally
 * toward facing. Firing with 0 arrows is a no-op.
 */
export function handleShooting(
  players: PlayerState[],
  inputs: readonly PlayerInput[],
  arrows: ArrowState[],
  allocId: () => number,
  t: DerivedTuning,
  events: SimEvent[],
  tick: number
): void {
  players.forEach((p, i) => {
    if (!p.alive) return;
    const input = inputs[i]!;
    const pressed = input.shoot && !p.prevShootHeld;
    p.prevShootHeld = input.shoot;
    if (!pressed || p.arrows <= 0) return;

    const dirX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dirY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    let nx: number;
    let ny: number;
    if (dirX === 0 && dirY === 0) {
      nx = p.facing;
      ny = 0;
    } else {
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      nx = dirX / len;
      ny = dirY / len;
    }

    p.arrows--;
    const arrow: ArrowState = {
      id: allocId(),
      ownerSlot: p.slot,
      phase: "flying",
      firedTick: tick,
      x: p.x,
      y: p.y,
      vx: nx * t.arrowSpeed,
      vy: ny * t.arrowSpeed
    };
    arrows.push(arrow);
    events.push({ tick, type: "arrow_fired", playerSlot: p.slot, arrowId: arrow.id });
  });
}

/** Flight: slight gravity, wrap-aware swept movement, stick on first solid hit. */
export function updateArrows(
  arena: ArenaData,
  arrows: ArrowState[],
  t: DerivedTuning,
  events: SimEvent[],
  tick: number
): void {
  for (const a of arrows) {
    if (a.phase !== "flying") continue;
    a.vy += t.arrowGravity * DT;
    const { hw, hh } = arrowHalves(a);

    const movedX = moveAxisX(arena, a.x, a.y, hw, hh, a.vx * DT);
    a.x = movedX.pos;
    if (movedX.hit) {
      stick(a, events, tick);
      continue;
    }
    const movedY = moveAxisY(arena, a.x, a.y, hw, hh, a.vy * DT);
    a.y = movedY.pos;
    if (movedY.hit) {
      stick(a, events, tick);
    }
  }
}

function stick(a: ArrowState, events: SimEvent[], tick: number): void {
  a.phase = "stuck";
  a.vx = 0;
  a.vy = 0;
  events.push({ tick, type: "arrow_stuck", arrowId: a.id, x: a.x, y: a.y });
}

/**
 * Stuck arrows are pickups: any alive player within PICKUP_RADIUS collects
 * (+1 ammo). Iteration order (arrows by age, players by index) is part of
 * the determinism contract. Returns the surviving arrow list.
 */
export function collectPickups(
  arrows: ArrowState[],
  players: PlayerState[],
  events: SimEvent[],
  tick: number
): ArrowState[] {
  return arrows.filter((a) => {
    if (a.phase !== "stuck") return true;
    for (const p of players) {
      if (!p.alive) continue;
      const dx = wrapDelta(p.x - a.x, ARENA_WIDTH);
      const dy = wrapDelta(p.y - a.y, ARENA_HEIGHT);
      if (dx * dx + dy * dy <= PICKUP_RADIUS * PICKUP_RADIUS) {
        p.arrows++;
        events.push({ tick, type: "arrow_picked_up", arrowId: a.id, playerSlot: p.slot });
        return false;
      }
    }
    return true;
  });
}
