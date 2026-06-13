import Phaser from "phaser";
import playersJson from "../../../../content/players.json";
import tuningJson from "../../../../content/tuning.json";
import { setAppContext } from "../app-context";
import { DeviceManager, windowGamepadHost } from "../input/device-manager";
import { KeyboardInput } from "../input/keyboard";
import { parsePlayersConfig } from "../input/players-config";
import { parseInputSettings, parseUiSettings } from "../input/settings";
import { quickstartConfig } from "../match-config";
import { installBaseTestApi } from "../test-api";

/** Fixed seed for the dev/e2e quickstart match so its boot is reproducible. */
const QUICKSTART_SEED = 1;

/**
 * Runs once at startup: builds the app-wide input singletons (one KeyboardInput
 * + one DeviceManager, both owning window listeners), stashes them in the
 * registry, then routes — straight into the match for ?quickstart=1 (dev/e2e),
 * otherwise to the title screen.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    const players = parsePlayersConfig(playersJson);
    const keyboard = new KeyboardInput(window);
    const manager = new DeviceManager(
      windowGamepadHost(window),
      keyboard,
      players.keyboards,
      parseInputSettings(tuningJson).stickDeadzone
    );
    setAppContext(this, {
      manager,
      keyboard,
      slots: players.slots,
      lobbyCountdownMs: parseUiSettings(tuningJson).lobbyCountdownMs
    });
    installBaseTestApi(this.game);

    const quickstart = new URLSearchParams(window.location.search).get("quickstart") === "1";
    if (quickstart) {
      this.scene.start("arena", quickstartConfig(manager.devices(), players.slots, QUICKSTART_SEED));
    } else {
      this.scene.start("title");
    }
  }
}
