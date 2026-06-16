/** Shell-side tuning blocks added in spec 003: `input` (gamepad feel) and `ui`
 *  (lobby). Like `juice`, they live in content/tuning.json (hard rule 3: one
 *  tuning file) but the sim never reads them. */

export interface InputSettings {
  /** Left-stick magnitude below which an axis reads neutral (0..1). */
  stickDeadzone: number;
}

export function parseInputSettings(tuningData: unknown): InputSettings {
  const input = block(tuningData, "input");
  const v = input["stickDeadzone"];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v >= 1) {
    throw new Error("tuning: input.stickDeadzone must be a number in [0, 1)");
  }
  return { stickDeadzone: v };
}

export interface UiSettings {
  /** Countdown after the lobby is all-ready before the match begins (ms). */
  lobbyCountdownMs: number;
  /** Scene fade-through-black duration, each direction (ms; spec 015). */
  transitionMs: number;
}

export function parseUiSettings(tuningData: unknown): UiSettings {
  const ui = block(tuningData, "ui");
  const lobbyCountdownMs = ui["lobbyCountdownMs"];
  if (typeof lobbyCountdownMs !== "number" || !Number.isFinite(lobbyCountdownMs) || lobbyCountdownMs < 0) {
    throw new Error("tuning: ui.lobbyCountdownMs must be a non-negative number");
  }
  const transitionMs = ui["transitionMs"];
  if (typeof transitionMs !== "number" || !Number.isFinite(transitionMs) || transitionMs < 0) {
    throw new Error("tuning: ui.transitionMs must be a non-negative number");
  }
  return { lobbyCountdownMs, transitionMs };
}

function block(tuningData: unknown, name: string): Record<string, unknown> {
  if (typeof tuningData !== "object" || tuningData === null) {
    throw new Error("tuning: expected an object");
  }
  const b = (tuningData as Record<string, unknown>)[name];
  if (typeof b !== "object" || b === null) {
    throw new Error(`tuning: ${name} block missing`);
  }
  return b as Record<string, unknown>;
}
