import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH, SIM_VERSION } from "@shoot-and-run/sim";
import { ArenaScene } from "./scenes/ArenaScene";
import { BootScene } from "./scenes/BootScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { TitleScene } from "./scenes/TitleScene";
import { loadFont } from "./theme";

// Load the pixel font before the game boots so Phaser Text rasterizes the real
// glyphs on first render (it does not auto-refresh when a webfont loads later).
void loadFont().finally(() => {
  new Phaser.Game({
    type: Phaser.AUTO,
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    pixelArt: true,
    backgroundColor: "#1a1a2e",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    // BootScene (first → auto-started) builds shared input and routes to title
    // or, with ?quickstart=1, straight into the match.
    scene: [BootScene, TitleScene, LobbyScene, ArenaScene]
  });

  console.log(`shoot-and-run shell up, sim ${SIM_VERSION}`);
});
