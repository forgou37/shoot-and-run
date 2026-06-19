import { ARENA_HEIGHT, ARENA_WIDTH, TILE_SIZE, type ArenaData } from "./arena";
import { ARROW_HALF_LONG, ARROW_HALF_SHORT, DT, PICKUP_RADIUS } from "./constants";
import type { SimEvent } from "./events";
import { aimDir, type PlayerInput } from "./input";
import { moveAxisX, moveAxisY, solidAt, wrapDelta, wrapMod } from "./physics";
import type { ArrowState, PlayerState, WallState } from "./state";
import type { DerivedTuning } from "./tuning";
import { earliestWallHit } from "./wall";

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
    if (!pressed || p.quiver.length === 0) return;

    const { nx, ny } = aimDir(input, p.facing);

    const kind = p.quiver.shift()!;
    const arrow: ArrowState = {
      id: allocId(),
      ownerSlot: p.slot,
      kind,
      phase: "flying",
      firedTick: tick,
      bouncesLeft: kind === "bounce" ? t.arrowBounceCount : 0,
      pierced: false,
      insideSolid: false,
      x: p.x,
      y: p.y,
      vx: nx * t.arrowSpeed,
      vy: ny * t.arrowSpeed
    };
    arrows.push(arrow);
    events.push({ tick, type: "arrow_fired", playerSlot: p.slot, arrowId: arrow.id, kind });
  });
}

/** What an arrow's move this tick resolves to, before any event is emitted. */
type ArrowOutcome = "fly" | "stick" | "explode";

/**
 * Flight per kind:
 * - normal: slight gravity, sticks on first solid hit
 * - bomb: like normal, but tile contact marks it exploding (resolved in kills.ts)
 * - bounce: reflects off the contacted axis up to bouncesLeft times, then sticks
 * - laser: straight line (no gravity), passes through the first contiguous
 *   obstacle, embeds in the second (center-point sampling; arrow speed per
 *   tick is well under a tile, so no tunneling)
 *
 * After the tile move, the arrow's swept path (pre → post) is tested against
 * every wall (spec 018). A wall on the path is one-shot cover: it dissolves and
 * stops the arrow (normal/laser/bounce stick, bomb explodes), overriding the tile
 * outcome — the wall always lies on or before the tile stop along this segment.
 * This runs before checkArrowKills, so a wall reliably shields the player behind
 * it. Walls never reflect a bounce arrow: it is caught and sticks.
 */
export function updateArrows(
  arena: ArenaData,
  arrows: ArrowState[],
  walls: WallState[],
  t: DerivedTuning,
  events: SimEvent[],
  tick: number
): void {
  for (const a of arrows) {
    if (a.phase !== "flying") continue;
    const preX = a.x;
    const preY = a.y;
    const { hw, hh } = arrowHalves(a);

    let outcome: ArrowOutcome =
      a.kind === "laser" ? moveLaser(a, arena) : moveBallistic(a, arena, t);

    if (walls.length > 0) {
      const hit = earliestWallHit(preX, preY, a.x, a.y, hw, hh, walls);
      if (hit) {
        a.x = hit.x;
        a.y = hit.y;
        const idx = walls.indexOf(hit.wall);
        if (idx >= 0) walls.splice(idx, 1);
        events.push({
          tick,
          type: "wall_destroyed",
          wallId: hit.wall.id,
          x: hit.wall.x,
          y: hit.wall.y
        });
        outcome = a.kind === "bomb" ? "explode" : "stick";
      }
    }

    if (outcome === "explode") {
      a.phase = "exploding";
    } else if (outcome === "stick") {
      a.phase = "stuck";
      a.vx = 0;
      a.vy = 0;
      events.push({ tick, type: "arrow_stuck", arrowId: a.id, x: a.x, y: a.y });
    }
  }
}

/** Ballistic move (normal/bomb/bounce) for one tick. Mutates position/velocity;
 *  returns the tile outcome without emitting (the caller emits after the wall
 *  sweep so wall and tile outcomes can't double-fire). */
function moveBallistic(a: ArrowState, arena: ArenaData, t: DerivedTuning): ArrowOutcome {
  a.vy += t.arrowGravity * DT;
  const { hw, hh } = arrowHalves(a);

  const movedX = moveAxisX(arena, a.x, a.y, hw, hh, a.vx * DT);
  a.x = movedX.pos;
  if (movedX.hit) {
    if (a.kind === "bomb") return "explode";
    if (a.kind === "bounce" && a.bouncesLeft > 0) {
      a.vx = -a.vx;
      a.bouncesLeft--;
    } else {
      return "stick";
    }
  }

  const movedY = moveAxisY(arena, a.x, a.y, hw, hh, a.vy * DT);
  a.y = movedY.pos;
  if (movedY.hit) {
    if (a.kind === "bomb") return "explode";
    if (a.kind === "bounce" && a.bouncesLeft > 0) {
      a.vy = -a.vy;
      a.bouncesLeft--;
    } else {
      return "stick";
    }
  }
  return "fly";
}

/** Laser move for one tick: straight line, pierces the first contiguous obstacle
 *  and embeds in the second. Returns the tile outcome without emitting. */
function moveLaser(a: ArrowState, arena: ArenaData): ArrowOutcome {
  a.x = wrapMod(a.x + a.vx * DT, ARENA_WIDTH);
  a.y = wrapMod(a.y + a.vy * DT, ARENA_HEIGHT);
  const solidNow = solidAt(arena, Math.floor(a.x / TILE_SIZE), Math.floor(a.y / TILE_SIZE));
  if (a.pierced) {
    if (solidNow) return "stick"; // embeds inside the second obstacle
  } else if (a.insideSolid && !solidNow) {
    a.pierced = true;
  } else if (solidNow) {
    a.insideSolid = true;
  }
  return "fly";
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
        // Kind is preserved: a stuck laser is a laser again in the quiver.
        p.quiver.unshift(a.kind);
        events.push({ tick, type: "arrow_picked_up", arrowId: a.id, playerSlot: p.slot });
        return false;
      }
    }
    return true;
  });
}
