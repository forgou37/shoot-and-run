import { describe, expect, it } from "vitest";
import playersJson from "../../../content/players.json";
import tuningJson from "../../../content/tuning.json";
import {
  GamepadDevice,
  readPausePressed,
  readStandardGamepad,
  type GamepadLike
} from "../src/input/device";
import { DeviceManager, type GamepadHost } from "../src/input/device-manager";
import { KeyboardInput } from "../src/input/keyboard";
import { parsePlayersConfig } from "../src/input/players-config";
import { parseInputSettings, parseUiSettings } from "../src/input/settings";

const DEADZONE = 0.25;

/** Build a fake standard-mapping pad with all inputs neutral, then override. */
function fakePad(over: Partial<{ axes: number[]; pressed: number[]; connected: boolean }> = {}): GamepadLike {
  const pressed = new Set(over.pressed ?? []);
  return {
    connected: over.connected ?? true,
    axes: over.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i) }))
  };
}

describe("parsePlayersConfig (spec 003 reshape)", () => {
  it("accepts content/players.json: 4 slots + 2 keyboard profiles", () => {
    const cfg = parsePlayersConfig(playersJson);
    expect(cfg.slots.map((s) => s.slot)).toEqual([0, 1, 2, 3]);
    expect(cfg.slots[0]).toEqual({ slot: 0, name: "Maks", color: "#ba68c8" });
    expect(cfg.keyboards).toHaveLength(2);
    expect(cfg.keyboards[0]!.right).toBe("KeyD");
    expect(cfg.keyboards[1]!.left).toBe("ArrowLeft");
  });

  it("rejects malformed shapes", () => {
    expect(() => parsePlayersConfig({ keyboards: [] })).toThrow(/slots array/);
    expect(() => parsePlayersConfig({ slots: [{ slot: 0, name: "P1", color: "#fff" }], keyboards: [] })).toThrow(
      /at least 2/
    );
    const slots = [
      { slot: 0, name: "P1", color: "#4fc3f7" },
      { slot: 0, name: "P2", color: "#ff8a65" }
    ];
    expect(() => parsePlayersConfig({ slots, keyboards: [] })).toThrow(/duplicate slot id 0/);
    expect(() =>
      parsePlayersConfig({
        slots: [
          { slot: 0, name: "P1", color: "nothex" },
          { slot: 1, name: "P2", color: "#ff8a65" }
        ],
        keyboards: [{ left: "KeyA", right: "KeyD", up: "KeyW", down: "KeyS", jump: "KeyG", shoot: "KeyF" }]
      })
    ).toThrow(/color must be a #rrggbb/);
    expect(() =>
      parsePlayersConfig({
        slots: [
          { slot: 0, name: "P1", color: "#4fc3f7" },
          { slot: 1, name: "P2", color: "#ff8a65" }
        ],
        keyboards: [{ left: "KeyA" }]
      })
    ).toThrow(/keyboards\[0\]\.right/);
  });
});

describe("readStandardGamepad (standard mapping, A3.2)", () => {
  it("ignores stick movement within the deadzone", () => {
    const input = readStandardGamepad(fakePad({ axes: [0.2, -0.2] }), DEADZONE);
    expect(input).toEqual({ left: false, right: false, up: false, down: false, jump: false, shoot: false, dash: false });
  });

  it("maps the left stick past the deadzone to directions", () => {
    expect(readStandardGamepad(fakePad({ axes: [-0.9, 0] }), DEADZONE).left).toBe(true);
    expect(readStandardGamepad(fakePad({ axes: [0.9, 0] }), DEADZONE).right).toBe(true);
    expect(readStandardGamepad(fakePad({ axes: [0, -0.9] }), DEADZONE).up).toBe(true);
    expect(readStandardGamepad(fakePad({ axes: [0, 0.9] }), DEADZONE).down).toBe(true);
  });

  it("maps the d-pad (buttons 12-15) regardless of deadzone", () => {
    expect(readStandardGamepad(fakePad({ pressed: [12] }), DEADZONE).up).toBe(true);
    expect(readStandardGamepad(fakePad({ pressed: [13] }), DEADZONE).down).toBe(true);
    expect(readStandardGamepad(fakePad({ pressed: [14] }), DEADZONE).left).toBe(true);
    expect(readStandardGamepad(fakePad({ pressed: [15] }), DEADZONE).right).toBe(true);
  });

  it("maps A→jump (0), X→shoot (2), RB→dash (5), Start→pause (9)", () => {
    expect(readStandardGamepad(fakePad({ pressed: [0] }), DEADZONE).jump).toBe(true);
    expect(readStandardGamepad(fakePad({ pressed: [2] }), DEADZONE).shoot).toBe(true);
    expect(readStandardGamepad(fakePad({ pressed: [5] }), DEADZONE).dash).toBe(true);
    expect(readPausePressed(fakePad({ pressed: [9] }))).toBe(true);
    expect(readPausePressed(fakePad())).toBe(false);
  });
});

describe("GamepadDevice", () => {
  it("samples a connected pad and reports neutral + disconnected when absent", () => {
    let pad: GamepadLike | null = fakePad({ axes: [0.9, 0], pressed: [0] });
    const dev = new GamepadDevice(0, DEADZONE, () => [pad]);
    expect(dev.connected).toBe(true);
    expect(dev.sample()).toMatchObject({ right: true, jump: true });

    pad = null; // unplugged
    expect(dev.connected).toBe(false);
    expect(dev.sample()).toEqual({ left: false, right: false, up: false, down: false, jump: false, shoot: false, dash: false });
    expect(dev.pausePressed()).toBe(false);
  });
});

describe("DeviceManager hot-plug (A3.2)", () => {
  it("tracks pads connecting and disconnecting alongside the keyboards", () => {
    const pads: (GamepadLike | null)[] = [];
    const listeners = new Map<string, (e: { gamepad: { index: number } }) => void>();
    const host: GamepadHost = {
      getGamepads: () => pads,
      addEventListener: (type, l) => listeners.set(type, l),
      removeEventListener: (type) => listeners.delete(type)
    };
    const cfg = parsePlayersConfig(playersJson);
    const mgr = new DeviceManager(host, new KeyboardInput(fakeWindow()), cfg.keyboards, DEADZONE);

    // Starts with just the two keyboard profiles.
    expect(mgr.devices().map((d) => d.id)).toEqual(["keyboard:0", "keyboard:1"]);

    // Pad plugged in at index 1.
    pads[1] = fakePad();
    listeners.get("gamepadconnected")!({ gamepad: { index: 1 } });
    expect(mgr.devices().map((d) => d.id)).toEqual(["keyboard:0", "keyboard:1", "pad:1"]);

    // Pad unplugged.
    pads[1] = null;
    listeners.get("gamepaddisconnected")!({ gamepad: { index: 1 } });
    expect(mgr.devices().map((d) => d.id)).toEqual(["keyboard:0", "keyboard:1"]);

    mgr.dispose();
    expect(listeners.size).toBe(0);
  });

  it("picks up pads already present at construction", () => {
    const pads: (GamepadLike | null)[] = [fakePad()];
    const host: GamepadHost = {
      getGamepads: () => pads,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    };
    const cfg = parsePlayersConfig(playersJson);
    const mgr = new DeviceManager(host, new KeyboardInput(fakeWindow()), cfg.keyboards, DEADZONE);
    expect(mgr.devices().map((d) => d.id)).toContain("pad:0");
  });
});

describe("parseInputSettings / parseUiSettings (spec 003 tuning blocks)", () => {
  it("reads the input and ui blocks from content/tuning.json", () => {
    expect(parseInputSettings(tuningJson).stickDeadzone).toBe(0.25);
    expect(parseUiSettings(tuningJson).lobbyCountdownMs).toBe(3000);
  });

  it("rejects missing blocks and out-of-range values", () => {
    expect(() => parseInputSettings({})).toThrow(/input block missing/);
    expect(() => parseInputSettings({ input: { stickDeadzone: 1 } })).toThrow(/\[0, 1\)/);
    expect(() => parseUiSettings({})).toThrow(/ui block missing/);
    expect(() => parseUiSettings({ ui: { lobbyCountdownMs: -1 } })).toThrow(/non-negative/);
  });
});

/** A KeyboardInput needs only addEventListener/removeEventListener; the manager
 *  tests never dispatch keys, so a no-op window stand-in is enough. */
function fakeWindow(): Window {
  return { addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as Window;
}
