import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH, SIM_VERSION } from "@shoot-and-run/sim";
import { ArenaScene } from "./scenes/ArenaScene";

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
  scene: [ArenaScene]
});

console.log(`shoot-and-run shell up, sim ${SIM_VERSION}`);
