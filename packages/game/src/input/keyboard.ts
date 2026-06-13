import type { PlayerInput } from "@shoot-and-run/sim";
import type { KeyBindings } from "./players-config";

/**
 * Raw keyboard state tracker keyed by KeyboardEvent.code. Deliberately not
 * Phaser's keyboard plugin: device handling stays a thin, testable layer and
 * the sim only ever sees PlayerInput structs.
 */
export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.down.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  constructor(private readonly target: Window) {
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
    // Avoid stuck keys when the window loses focus mid-press.
    target.addEventListener("blur", this.clear);
  }

  private readonly clear = (): void => {
    this.down.clear();
  };

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  sample(keys: KeyBindings): PlayerInput {
    return {
      left: this.isDown(keys.left),
      right: this.isDown(keys.right),
      up: this.isDown(keys.up),
      down: this.isDown(keys.down),
      jump: this.isDown(keys.jump),
      shoot: this.isDown(keys.shoot),
      dash: this.isDown(keys.dash)
    };
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("blur", this.clear);
  }
}
