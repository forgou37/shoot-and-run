import type Phaser from "phaser";
import type { DeviceManager } from "./input/device-manager";
import type { KeyboardInput } from "./input/keyboard";
import type { SlotConfig } from "./input/players-config";

/**
 * Process-wide singletons created once by BootScene and shared across all
 * scenes via the Phaser game registry. The DeviceManager and KeyboardInput own
 * window event listeners, so there must be exactly one of each for the app.
 */
export interface AppContext {
  manager: DeviceManager;
  keyboard: KeyboardInput;
  /** Slot identities (name/color) from content/players.json. */
  slots: SlotConfig[];
  lobbyCountdownMs: number;
}

const KEY = "appContext";

export function setAppContext(scene: Phaser.Scene, ctx: AppContext): void {
  scene.registry.set(KEY, ctx);
}

export function getAppContext(scene: Phaser.Scene): AppContext {
  const ctx = scene.registry.get(KEY) as AppContext | undefined;
  if (!ctx) throw new Error("AppContext not initialized — BootScene must run first");
  return ctx;
}
