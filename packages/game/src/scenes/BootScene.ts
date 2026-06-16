import { botDifficulty, parseBotConfig } from "@shoot-and-run/bots";
import Phaser from "phaser";
import botsJson from "../../../../content/bots.json";
import playersJson from "../../../../content/players.json";
import tuningJson from "../../../../content/tuning.json";
import { setAppContext } from "../app-context";
import { BotDevice } from "../input/bot-device";
import { DeviceManager, windowGamepadHost } from "../input/device-manager";
import { KeyboardInput } from "../input/keyboard";
import { parsePlayersConfig } from "../input/players-config";
import { parseInputSettings, parseUiSettings } from "../input/settings";
import { quickstartConfig } from "../match-config";
import { installBaseTestApi } from "../test-api";
import { buildPixelFont } from "../theme";

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
    // Rasterize the pixel font into its bitmap-font atlas before any scene
    // renders text (FreePixel was loaded before the game booted, in main.ts).
    buildPixelFont(this);

    const players = parsePlayersConfig(playersJson);
    const botConfig = parseBotConfig(botsJson);
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
      lobbyCountdownMs: parseUiSettings(tuningJson).lobbyCountdownMs,
      botConfig
    });
    installBaseTestApi(this.game);

    const params = new URLSearchParams(window.location.search);

    // ?online=ws://host:port (or ?online=1 → ws://<host>:8787) connects to a
    // dedicated host as a pure prediction client (spec 010). No Cloudflare/lobby
    // yet — the address is passed directly, mirroring ?quickstart.
    const online = params.get("online");
    if (online !== null) {
      const url = online.startsWith("ws")
        ? online
        : `ws://${window.location.hostname}:8787`;
      // ?spectate=1 joins as a watch-only spectator (spec 013, T13.2).
      this.scene.start("online", { url, spectate: params.get("spectate") === "1" });
      return;
    }

    // ?bots=N (1–3) boots a quick human-vs-bots match for dev/e2e, optionally
    // ?difficulty=easy|normal|hard; it implies quickstart. ?quickstart=1 alone
    // is still the original two-keyboard match.
    const botCount = Math.max(0, Math.min(3, Number.parseInt(params.get("bots") ?? "", 10) || 0));
    const quickstart = params.get("quickstart") === "1" || botCount > 0;
    if (quickstart) {
      const requested = params.get("difficulty") ?? "normal";
      const name = requested in botConfig.difficulties ? requested : Object.keys(botConfig.difficulties)[0]!;
      const difficulty = botDifficulty(botConfig, name);
      const botDevices = Array.from({ length: botCount }, (_, i) => new BotDevice(i, name, difficulty));
      this.scene.start(
        "arena",
        quickstartConfig(manager.devices(), players.slots, QUICKSTART_SEED, botDevices)
      );
    } else {
      this.scene.start("title");
    }
  }
}
