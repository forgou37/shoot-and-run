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
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    pixelArt: true,
    roundPixels: true, // snap draws to integer pixels so text stays crisp
    backgroundColor: "#1a1a2e",
    // We drive the canvas CSS size ourselves (sizeCanvas below); NONE keeps
    // Phaser from re-fitting it fractionally.
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    // BootScene (first → auto-started) builds shared input and routes to title
    // or, with ?quickstart=1, straight into the match.
    scene: [BootScene, TitleScene, LobbyScene, ArenaScene]
  });

  // Pixel-perfect scaling. The canvas backing stays 320×240; we size its CSS box
  // to the largest INTEGER multiple of the arena that fits the *device* pixels,
  // so the browser nearest-upscales it by a whole number (e.g. ×5) instead of a
  // fractional factor. A fractional fit — which Scale.FIT produces, made worse by
  // devicePixelRatio — lands pixels off the device grid and blurs small text.
  const sizeCanvas = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const zoom = Math.max(
      1,
      Math.floor(
        Math.min((window.innerWidth * dpr) / ARENA_WIDTH, (window.innerHeight * dpr) / ARENA_HEIGHT)
      )
    );
    game.canvas.style.width = `${String((ARENA_WIDTH * zoom) / dpr)}px`;
    game.canvas.style.height = `${String((ARENA_HEIGHT * zoom) / dpr)}px`;
  };
  game.events.once(Phaser.Core.Events.READY, () => {
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);
  });

  console.log(`shoot-and-run shell up, sim ${SIM_VERSION}`);
});
