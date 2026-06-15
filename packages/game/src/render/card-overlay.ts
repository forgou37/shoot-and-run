import { ARENA_HEIGHT, ARENA_WIDTH } from "@shoot-and-run/sim";

/**
 * High-resolution lobby card layer (owner-directed: cards must look painted, not
 * pixelated). The game renders into a fixed 320×240 buffer that is then nearest-
 * upscaled, so anything drawn through Phaser is capped at its tiny buffer
 * footprint. To escape that cap for the illustrated character cards — the one
 * high-detail asset in an otherwise 16px pixel-art game — they are drawn as plain
 * DOM <img> elements layered over the canvas at full master resolution and
 * smooth-scaled by the browser. Everything else in the lobby (text, borders,
 * controls) stays in the pixel buffer; only the card art is hi-res.
 *
 * The layer mirrors the canvas's on-screen box: each card's logical rect (in the
 * 320×240 space) maps to CSS pixels via the live canvas getBoundingClientRect,
 * re-synced on window resize. The sim, determinism and in-match rendering are
 * untouched — this is a lobby-only presentation layer.
 */

/** A card's placement in logical (320×240) buffer coordinates. */
export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class CardOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly rects: readonly CardRect[];
  private readonly container: HTMLDivElement;
  private readonly imgs: HTMLImageElement[];
  private readonly onResize: () => void;
  // Last canvas box we positioned against; lets layout() run every frame cheaply
  // (the canvas is sized/centered a few frames after the lobby is created, and
  // can move on resize — re-sync only writes styles when the box actually moved).
  private lastBox = "";

  constructor(canvas: HTMLCanvasElement, urls: readonly string[], rects: readonly CardRect[]) {
    this.canvas = canvas;
    this.rects = rects;

    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "fixed",
      inset: "0",
      margin: "0",
      padding: "0",
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: "10"
    });

    this.imgs = urls.map((url) => {
      const img = document.createElement("img");
      img.src = url;
      img.draggable = false;
      Object.assign(img.style, {
        position: "absolute",
        imageRendering: "auto", // smooth scaling — these are illustrations, not pixel art
        pointerEvents: "none",
        userSelect: "none",
        display: "block"
      });
      this.container.appendChild(img);
      return img;
    });

    document.body.appendChild(this.container);
    this.onResize = (): void => this.layout();
    window.addEventListener("resize", this.onResize);
    this.layout();
  }

  /** Position every card over its logical rect, scaled to the canvas's CSS box.
   *  Safe to call every frame: it no-ops unless the canvas box has moved/resized. */
  layout(): void {
    const r = this.canvas.getBoundingClientRect();
    const box = `${String(r.left)},${String(r.top)},${String(r.width)},${String(r.height)}`;
    if (box === this.lastBox) return;
    this.lastBox = box;
    const sx = r.width / ARENA_WIDTH;
    const sy = r.height / ARENA_HEIGHT;
    this.imgs.forEach((img, i) => {
      const rect = this.rects[i];
      if (rect === undefined) return;
      img.style.left = `${String(r.left + rect.x * sx)}px`;
      img.style.top = `${String(r.top + rect.y * sy)}px`;
      img.style.width = `${String(rect.w * sx)}px`;
      img.style.height = `${String(rect.h * sy)}px`;
    });
  }

  /** Card opacity (1 = claimed, dim = empty), mirroring the old Phaser alpha. */
  setAlpha(i: number, alpha: number): void {
    const img = this.imgs[i];
    if (img !== undefined) img.style.opacity = String(alpha);
  }

  destroy(): void {
    window.removeEventListener("resize", this.onResize);
    this.container.remove();
  }
}
