import {
  GamepadDevice,
  KeyboardDevice,
  type GamepadLike,
  type InputDevice
} from "./device";
import type { KeyboardInput } from "./keyboard";
import type { KeyBindings } from "./players-config";

/** The browser surface DeviceManager needs, narrowed so tests can fake it. */
export interface GamepadHost {
  getGamepads(): readonly (GamepadLike | null)[];
  addEventListener(type: GamepadHotplugEvent, listener: (e: GamepadConnectionEvent) => void): void;
  removeEventListener(type: GamepadHotplugEvent, listener: (e: GamepadConnectionEvent) => void): void;
}
export type GamepadHotplugEvent = "gamepadconnected" | "gamepaddisconnected";
export interface GamepadConnectionEvent {
  gamepad: { index: number };
}

/** Adapts a real Window into a GamepadHost (gamepads live on navigator, events
 *  on the window). */
export function windowGamepadHost(target: Window): GamepadHost {
  return {
    getGamepads: () =>
      (target.navigator.getGamepads ? target.navigator.getGamepads() : []) as readonly (
        | GamepadLike
        | null
      )[],
    addEventListener: (type, listener) => target.addEventListener(type, listener as unknown as EventListener),
    removeEventListener: (type, listener) =>
      target.removeEventListener(type, listener as unknown as EventListener)
  };
}

/**
 * Owns the live device list: the fixed keyboard profiles plus whatever pads are
 * connected. Tracks hot-plug via the gamepad connect/disconnect events (A3.2),
 * so the lobby sees pads appear/vanish and the match can detect an assigned pad
 * dropping out. The keyboard tracker is shared by all keyboard devices.
 */
export class DeviceManager {
  private readonly keyboards: KeyboardDevice[];
  private readonly pads = new Map<number, GamepadDevice>();

  private readonly onConnect = (e: GamepadConnectionEvent): void => {
    this.pads.set(e.gamepad.index, this.makePad(e.gamepad.index));
  };
  private readonly onDisconnect = (e: GamepadConnectionEvent): void => {
    this.pads.delete(e.gamepad.index);
  };

  constructor(
    private readonly host: GamepadHost,
    keyboard: KeyboardInput,
    keyboards: readonly KeyBindings[],
    private readonly deadzone: number
  ) {
    this.keyboards = keyboards.map((keys, i) => new KeyboardDevice(i, keyboard, keys));
    // Pads already present at load (e.g. a button was held during boot).
    host.getGamepads().forEach((pad, index) => {
      if (pad && pad.connected) this.pads.set(index, this.makePad(index));
    });
    host.addEventListener("gamepadconnected", this.onConnect);
    host.addEventListener("gamepaddisconnected", this.onDisconnect);
  }

  private makePad(index: number): GamepadDevice {
    return new GamepadDevice(index, this.deadzone, () => this.host.getGamepads());
  }

  /** Keyboard profiles followed by every currently-connected pad, in index order. */
  devices(): InputDevice[] {
    const pads = [...this.pads.values()]
      .filter((p) => p.connected)
      .sort((a, b) => a.index - b.index);
    return [...this.keyboards, ...pads];
  }

  dispose(): void {
    this.host.removeEventListener("gamepadconnected", this.onConnect);
    this.host.removeEventListener("gamepaddisconnected", this.onDisconnect);
  }
}
