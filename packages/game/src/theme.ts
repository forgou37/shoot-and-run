import Phaser from "phaser";
import fontUrl from "../../../assets/fonts/FreePixel.ttf";

/** The source pixel font (assets/fonts/FreePixel.ttf). We do NOT render it as
 *  live canvas text — a TTF rasterized through the 2D text API is always
 *  grayscale-anti-aliased, and those soft edges turn to mush when the 320×240
 *  buffer is upscaled ×N. Instead we rasterize it ONCE at boot into a 1-bit
 *  glyph atlas (see buildPixelFont) and render with Phaser BitmapText, which
 *  samples that texture with NEAREST — hard pixels, crisp at any integer scale,
 *  in every browser. FONT_FAMILY is only used by the one-time rasterization. */
export const FONT_FAMILY = "FreePixel";

/** Shared key for the generated bitmap font (texture cache + bitmapFont cache). */
export const PIXEL_FONT_KEY = "pixelfont";

// Fixed-grid metrics, measured from FreePixel rasterized at PIXEL_FONT_PX.
// FreePixel is monospace (advance = px/2). At 12px the whole printable set fits
// a 6×11 cell with the baseline 9px down from the cell top.
const PIXEL_FONT_PX = 12;
const CELL_W = 6;
const CELL_H = 11;
const BASELINE = 9;
const COLS = 16;
/** Threshold: a glyph pixel is "on" when canvas coverage is ≥ this alpha. */
const ALPHA_CUTOFF = 128;
/** Glyphs fill the full monospace cell, so add 1px between characters (scales
 *  with the text) — otherwise edge-heavy caps like H/O/N/R touch and blur into
 *  each other. In font units; multiplied by the text's integer scale. */
const LETTER_SPACING = 1;

/** Printable ASCII (32–126) plus the two punctuation glyphs the UI uses that
 *  fall outside it: middle dot (·, U+00B7) and em dash (—, U+2014). */
function charset(): string {
  let s = "";
  for (let c = 32; c <= 126; c++) s += String.fromCharCode(c);
  return s + "·—";
}

function hexToInt(color: string): number {
  return parseInt(color.replace("#", "").slice(0, 6), 16);
}

/**
 * Rasterize FreePixel into a 1-bit glyph atlas and register it as a Phaser
 * BitmapText font (a fixed-grid RetroFont). Runs once in BootScene after the
 * FontFace is loaded. Each glyph is drawn into its own cell, thresholded to
 * hard white-on-transparent pixels, and the atlas texture is filtered NEAREST
 * so BitmapText stays crisp through the pixel-art upscale. Idempotent.
 */
export function buildPixelFont(scene: Phaser.Scene): void {
  if (scene.textures.exists(PIXEL_FONT_KEY)) return;

  const chars = charset();
  const rows = Math.ceil(chars.length / COLS);
  const atlas = document.createElement("canvas");
  atlas.width = COLS * CELL_W;
  atlas.height = rows * CELL_H;
  const actx = atlas.getContext("2d");
  if (!actx) return;
  const out = actx.createImageData(atlas.width, atlas.height);

  const tmp = document.createElement("canvas");
  tmp.width = CELL_W;
  tmp.height = CELL_H;
  const tctx = tmp.getContext("2d");
  if (!tctx) return;
  tctx.font = `${String(PIXEL_FONT_PX)}px ${FONT_FAMILY}`;
  tctx.textBaseline = "alphabetic";
  tctx.fillStyle = "#fff";

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    tctx.clearRect(0, 0, CELL_W, CELL_H);
    if (ch !== " ") tctx.fillText(ch, 0, BASELINE);
    const src = tctx.getImageData(0, 0, CELL_W, CELL_H).data;
    const ox = (i % COLS) * CELL_W;
    const oy = Math.floor(i / COLS) * CELL_H;
    for (let y = 0; y < CELL_H; y++) {
      for (let x = 0; x < CELL_W; x++) {
        const on = src[(y * CELL_W + x) * 4 + 3]! >= ALPHA_CUTOFF;
        const di = ((oy + y) * atlas.width + (ox + x)) * 4;
        out.data[di] = 255;
        out.data[di + 1] = 255;
        out.data[di + 2] = 255;
        out.data[di + 3] = on ? 255 : 0;
      }
    }
  }
  actx.putImageData(out, 0, 0);

  scene.textures.addCanvas(PIXEL_FONT_KEY, atlas);
  scene.textures.get(PIXEL_FONT_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
  const data = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: PIXEL_FONT_KEY,
    width: CELL_W,
    height: CELL_H,
    chars,
    charsPerRow: COLS,
    "spacing.x": 0,
    "spacing.y": 0,
    "offset.x": 0,
    "offset.y": 0,
    lineSpacing: 0
  });
  scene.cache.bitmapFont.add(PIXEL_FONT_KEY, data);
}

export interface PixelTextOpts {
  align?: "left" | "center" | "right";
  lineSpacing?: number;
  /** Wrap to this width in display pixels (word-wrap). Omitted = no wrap. */
  maxWidth?: number;
}

/**
 * Add a crisp pixel-font label. `sizePx` is the desired glyph height; it snaps
 * to the nearest integer multiple of the font's native cell height so the
 * BitmapText is only ever scaled by a whole number (keeping pixels square).
 * `color` is applied as a tint over the white glyph atlas.
 */
export function addPixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  sizePx: number,
  color: string,
  opts: PixelTextOpts = {}
): Phaser.GameObjects.BitmapText {
  const scale = Math.max(1, Math.round(sizePx / CELL_H));
  const bt = scene.add.bitmapText(Math.round(x), Math.round(y), PIXEL_FONT_KEY, text);
  bt.setScale(scale);
  bt.setLetterSpacing(LETTER_SPACING);
  if (color) bt.setTint(hexToInt(color));
  if (opts.lineSpacing != null) bt.setLineSpacing(opts.lineSpacing);
  // maxWidth wraps in the text's own (pre-scale) units, so divide the desired
  // display width by the integer scale. Phaser's word-wrap measures by the glyph
  // advance (CELL_W) but rendering adds LETTER_SPACING per glyph, so scale the
  // wrap width by CELL_W/(CELL_W+LETTER_SPACING) for the rendered line to honor
  // the requested display width.
  if (opts.maxWidth != null) {
    const wrapUnits = (opts.maxWidth / scale) * (CELL_W / (CELL_W + LETTER_SPACING));
    bt.setMaxWidth(Math.floor(wrapUnits));
  }
  if (opts.align === "center") bt.setCenterAlign();
  else if (opts.align === "right") bt.setRightAlign();
  return bt;
}

/** Register and fully load the pixel font. Resolves once glyphs are ready
 *  (or immediately if the FontFace API is unavailable). */
export async function loadFont(): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  const face = new FontFace(FONT_FAMILY, `url(${fontUrl})`);
  await face.load();
  document.fonts.add(face);
}
