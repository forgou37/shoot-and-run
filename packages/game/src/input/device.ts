import { emptyInput, type PlayerInput } from "@shoot-and-run/sim";
import type { KeyboardInput } from "./keyboard";
import type { KeyBindings } from "./players-config";

/**
 * Spec 003 device model. A device is a uniform source of one player's
 * PlayerInput plus the pause signal the shell needs. The lobby maps
 * devices→slots in join order; the match samples each assigned device per tick.
 * The sim only ever sees PlayerInput, never a device.
 */
export type DeviceKind = "keyboard" | "pad";

export interface InputDevice {
  /** Stable id, e.g. "keyboard:0", "pad:2". */
  readonly id: string;
  readonly kind: DeviceKind;
  /** Usable right now. Keyboards are always connected; a pad flips false on unplug. */
  readonly connected: boolean;
  /** This tick's movement/action input. A disconnected pad samples neutral. */
  sample(): PlayerInput;
  /** Pause source (pad Start). Keyboard pause is a scene-level Esc listener,
   *  so keyboard devices always return false here. */
  pausePressed(): boolean;
}

/** A keyboard binding profile wrapped as a device over a shared key tracker. */
export class KeyboardDevice implements InputDevice {
  readonly kind = "keyboard" as const;
  readonly connected = true;
  readonly id: string;

  constructor(
    index: number,
    private readonly keyboard: KeyboardInput,
    private readonly keys: KeyBindings
  ) {
    this.id = `keyboard:${index}`;
  }

  sample(): PlayerInput {
    return this.keyboard.sample(this.keys);
  }

  pausePressed(): boolean {
    return false;
  }
}

/** Minimal structural view of a W3C Gamepad — keeps the mapping pure and
 *  testable without depending on the DOM Gamepad type at the seams. */
export interface GamepadLike {
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { readonly pressed: boolean }[];
}

const btn = (pad: GamepadLike, i: number): boolean => pad.buttons[i]?.pressed ?? false;

/**
 * Standard-mapping gamepad → PlayerInput (spec 003 fixed point):
 * left-stick axes 0/1 past `deadzone`, OR d-pad buttons 12–15, for direction;
 * button 0 (A/Cross) jump, button 2 (X/Square) shoot, button 5 (RB) dash.
 */
export function readStandardGamepad(pad: GamepadLike, deadzone: number): PlayerInput {
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  return {
    left: ax < -deadzone || btn(pad, 14),
    right: ax > deadzone || btn(pad, 15),
    up: ay < -deadzone || btn(pad, 12),
    down: ay > deadzone || btn(pad, 13),
    jump: btn(pad, 0),
    shoot: btn(pad, 2),
    dash: btn(pad, 5)
  };
}

/** Standard-mapping pause button (button 9, Start). */
export function readPausePressed(pad: GamepadLike): boolean {
  return btn(pad, 9);
}

/** Polls `navigator.getGamepads()` lazily; returns [] off the browser. */
export function defaultGamepadPoll(): readonly (GamepadLike | null)[] {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
  return navigator.getGamepads() as readonly (GamepadLike | null)[];
}

/** A standard-mapping gamepad by index, re-read fresh on every sample so
 *  button/axis state never goes stale. */
export class GamepadDevice implements InputDevice {
  readonly kind = "pad" as const;
  readonly id: string;

  constructor(
    readonly index: number,
    private readonly deadzone: number,
    /** Injectable for tests; defaults to the live navigator poll. */
    private readonly poll: () => readonly (GamepadLike | null)[] = defaultGamepadPoll
  ) {
    this.id = `pad:${index}`;
  }

  private current(): GamepadLike | null {
    const pad = this.poll()[this.index];
    return pad && pad.connected ? pad : null;
  }

  get connected(): boolean {
    return this.current() !== null;
  }

  sample(): PlayerInput {
    const pad = this.current();
    return pad ? readStandardGamepad(pad, this.deadzone) : emptyInput();
  }

  pausePressed(): boolean {
    const pad = this.current();
    return pad ? readPausePressed(pad) : false;
  }
}
