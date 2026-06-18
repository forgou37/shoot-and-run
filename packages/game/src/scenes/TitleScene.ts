import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH } from "@shoot-and-run/sim";
import { getAppContext, type AppContext } from "../app-context";
import { EdgeReader } from "../input/menu-input";
import { fadeIn, transitionTo } from "../scene-transition";
import { addPixelText } from "../theme";

interface MenuItem {
  label: string;
  scene: string;
}

/** Title menu items, top to bottom. LOCAL is the default so a bare confirm
 *  (Space/Start) still goes straight to the lobby, as before the menu existed. */
const ITEMS: readonly MenuItem[] = [
  { label: "LOCAL PLAY", scene: "lobby" },
  { label: "ONLINE", scene: "online-join" }
];

const TINT_ON = 0xf0e6c8;
const TINT_OFF = 0x9aa0b8;

/** Title card with a Local / Online menu over the night-castle art. Navigate
 *  with up/down (any device or keyboard W/S/arrows); confirm with
 *  jump/Start/Space/Enter. */
export class TitleScene extends Phaser.Scene {
  private app!: AppContext;
  private edges!: EdgeReader;
  private selected = 0;
  private items: Phaser.GameObjects.BitmapText[] = [];
  private prevUp = false;
  private prevDown = false;
  private prevConfirm = false;

  constructor() {
    super("title");
  }

  preload(): void {
    this.load.image("title-bg", "assets/title-bg.png");
  }

  create(): void {
    this.app = getAppContext(this);
    this.edges = new EdgeReader();
    this.selected = 0;
    this.prevUp = this.prevDown = this.prevConfirm = false;
    this.cameras.main.setBackgroundColor("#10121f");
    fadeIn();

    // Full-screen art background (exactly ARENA_WIDTH×ARENA_HEIGHT, drawn 1:1),
    // dimmed slightly so the light text stays legible over the bright moon/sky.
    this.add.image(0, 0, "title-bg").setOrigin(0, 0);
    this.add.rectangle(0, 0, ARENA_WIDTH, ARENA_HEIGHT, 0x0a0c16, 0.32).setOrigin(0, 0);

    this.addShadowed(ARENA_WIDTH / 2, 56, "SHOOT & RUN", 28, "#f0e6c8");
    this.items = ITEMS.map((it, i) =>
      this.addShadowed(ARENA_WIDTH / 2, 132 + i * 22, it.label, 14, "#ffffff")
    );
    this.addShadowed(ARENA_WIDTH / 2, ARENA_HEIGHT - 14, "up/down · jump start space", 9, "#c2c8de");
    this.renderSelection();
  }

  /** A pixel label with a 1px dark drop shadow behind it, for contrast on the
   *  art. The pixel font only renders crisply at integer scales (addPixelText
   *  snaps to those), so labels stay at the font's native sizes — no sub-cell
   *  shrinking, which mangles the 1-bit glyphs. Returns the foreground. */
  private addShadowed(
    x: number,
    y: number,
    text: string,
    sizePx: number,
    color: string
  ): Phaser.GameObjects.BitmapText {
    addPixelText(this, x + 1, y + 1, text, sizePx, "#000000").setOrigin(0.5).setAlpha(0.6);
    return addPixelText(this, x, y, text, sizePx, color).setOrigin(0.5);
  }

  override update(): void {
    const dev = this.edges.read(this.app.manager.devices());
    const kUp = this.app.keyboard.isDown("ArrowUp") || this.app.keyboard.isDown("KeyW");
    const kDown = this.app.keyboard.isDown("ArrowDown") || this.app.keyboard.isDown("KeyS");
    const kConfirm = this.app.keyboard.isDown("Space") || this.app.keyboard.isDown("Enter");

    const up = (kUp && !this.prevUp) || dev.some((e) => e.up);
    const down = (kDown && !this.prevDown) || dev.some((e) => e.down);
    const confirm = (kConfirm && !this.prevConfirm) || dev.some((e) => e.joinOrConfirm);
    this.prevUp = kUp;
    this.prevDown = kDown;
    this.prevConfirm = kConfirm;

    if (up !== down) {
      this.selected = (this.selected + (down ? 1 : -1) + ITEMS.length) % ITEMS.length;
      this.renderSelection();
    }
    if (confirm) transitionTo(this, ITEMS[this.selected]!.scene);
  }

  private renderSelection(): void {
    this.items.forEach((t, i) => t.setTint(i === this.selected ? TINT_ON : TINT_OFF));
  }
}
