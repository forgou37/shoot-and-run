import type { PlayerInput } from "@shoot-and-run/sim";
import type { InputDevice } from "./device";

/** Rising-edge actions for one device this frame (menus/lobby navigation). */
export interface DeviceEdges {
  device: InputDevice;
  /** jump pressed — join / ready / confirm. */
  joinOrConfirm: boolean;
  /** shoot pressed — back out one step. */
  back: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** pad Start pressed — open/close pause. */
  pause: boolean;
}

interface PrevState extends PlayerInput {
  pause: boolean;
}

/**
 * Per-device edge detector for menu and lobby navigation. Call read() once per
 * frame; it returns this frame's rising edges and remembers each device's last
 * state by id. Held inputs only fire on the frame they go down.
 */
export class EdgeReader {
  private readonly prev = new Map<string, PrevState>();

  read(devices: readonly InputDevice[]): DeviceEdges[] {
    return devices.map((device) => {
      const cur = device.sample();
      const pause = device.pausePressed();
      const prev = this.prev.get(device.id);
      this.prev.set(device.id, { ...cur, pause });
      // First frame a device is tracked: take its current state as the baseline
      // and report no edges. This swallows a button still held from a previous
      // scene (e.g. the confirm press that opened this one) so it can't
      // double-fire as a fresh action here.
      if (!prev) return noEdges(device);
      return {
        device,
        joinOrConfirm: cur.jump && !prev.jump,
        back: cur.shoot && !prev.shoot,
        up: cur.up && !prev.up,
        down: cur.down && !prev.down,
        left: cur.left && !prev.left,
        right: cur.right && !prev.right,
        pause: pause && !prev.pause
      };
    });
  }

  /** Drop a device's remembered state (e.g. it left the lobby or unplugged). */
  forget(id: string): void {
    this.prev.delete(id);
  }
}

function noEdges(device: InputDevice): DeviceEdges {
  return {
    device,
    joinOrConfirm: false,
    back: false,
    up: false,
    down: false,
    left: false,
    right: false,
    pause: false
  };
}
