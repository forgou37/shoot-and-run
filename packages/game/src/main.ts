import Phaser from "phaser";
import { SIM_VERSION } from "@shoot-and-run/sim";

new Phaser.Game({
  type: Phaser.AUTO,
  width: 320,
  height: 240,
  pixelArt: true,
  backgroundColor: "#1a1a2e",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
});

console.log(`shoot-and-run shell up, sim ${SIM_VERSION}`);
