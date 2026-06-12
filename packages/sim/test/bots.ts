import { ARENA_HEIGHT, ARENA_WIDTH } from "../src/arena";
import { emptyInput, type PlayerInput } from "../src/input";
import { wrapDelta } from "../src/physics";
import type { SimState } from "../src/state";

/**
 * Scripted bot policies for the headless determinism proof (T0.9): pure,
 * deterministic functions of (state, tick, slot). NOT game AI — real bots
 * are spec 003. These only need to reliably produce a complete round.
 */
export type BotPolicy = (
  state: Readonly<SimState>,
  tick: number,
  mySlot: number
) => PlayerInput;

/** Chases the nearest opponent (shortest wrap path) and fires when aligned. */
export const hunterBot: BotPolicy = (state, tick, mySlot) => {
  const input = emptyInput();
  const me = state.players.find((p) => p.slot === mySlot);
  if (!me?.alive) return input;
  const target = state.players.find((p) => p.alive && p.slot !== mySlot);
  if (!target) return input;

  const dx = wrapDelta(target.x - me.x, ARENA_WIDTH);
  const dy = wrapDelta(target.y - me.y, ARENA_HEIGHT);
  if (dx > 2) input.right = true;
  else if (dx < -2) input.left = true;
  if (tick % 120 === 100) input.jump = true;

  const aligned = Math.abs(dy) < 4 && Math.abs(dx) < 70;
  if (aligned && me.quiver.length > 0 && tick % 20 === 0) input.shoot = true;
  return input;
};

/** Walks back and forth, hops periodically. A moving target. */
export const patrolBot: BotPolicy = (state, tick, mySlot) => {
  const input = emptyInput();
  const me = state.players.find((p) => p.slot === mySlot);
  if (!me?.alive) return input;

  if (Math.floor(tick / 90) % 2 === 0) input.right = true;
  else input.left = true;
  if (tick % 50 === 25) input.jump = true;
  return input;
};
