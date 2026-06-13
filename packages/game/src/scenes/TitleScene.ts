import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH } from "@shoot-and-run/sim";
import { getAppContext, type AppContext } from "../app-context";
import { EdgeReader } from "../input/menu-input";
import { FONT_FAMILY } from "../theme";

/** Title card. Any device's jump/Start (or keyboard Space/Enter) → lobby. */
export class TitleScene extends Phaser.Scene {
  private app!: AppContext;
  private edges!: EdgeReader;
  private prevKey = false;

  constructor() {
    super("title");
  }

  create(): void {
    this.app = getAppContext(this);
    this.edges = new EdgeReader();
    this.prevKey = false;
    this.cameras.main.setBackgroundColor("#10121f");
    this.add
      .text(ARENA_WIDTH / 2, ARENA_HEIGHT / 2 - 18, "SHOOT & RUN", {
        fontFamily: FONT_FAMILY,
        fontSize: "28px",
        color: "#f0e6c8"
      })
      .setOrigin(0.5);
    this.add
      .text(ARENA_WIDTH / 2, ARENA_HEIGHT / 2 + 20, "press jump · start · space", {
        fontFamily: FONT_FAMILY,
        fontSize: "10px",
        color: "#9aa0b5"
      })
      .setOrigin(0.5);
  }

  override update(): void {
    const edges = this.edges.read(this.app.manager.devices());
    const keyDown = this.app.keyboard.isDown("Space") || this.app.keyboard.isDown("Enter");
    const keyEdge = keyDown && !this.prevKey;
    this.prevKey = keyDown;
    if (keyEdge || edges.some((e) => e.joinOrConfirm || e.pause)) {
      this.scene.start("lobby");
    }
  }
}
