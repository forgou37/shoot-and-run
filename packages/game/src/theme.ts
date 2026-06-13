import Phaser from "phaser";
import fontUrl from "../../../assets/fonts/FreePixel.ttf";

/** The shell's pixel font (assets/fonts/FreePixel.ttf). Every Phaser Text
 *  style references this; load it via loadFont() before the game boots so the
 *  first render rasterizes the real glyphs, not a fallback. */
export const FONT_FAMILY = "FreePixel";

/**
 * Create a crisp pixel-font Text. The game renders into a 320×240 buffer that
 * is upscaled to fill the window; FreePixel rasterizes cleanly at native size,
 * but Phaser's dynamic text textures default to LINEAR filtering, so they smear
 * when sampled into the upscaled buffer. Forcing NEAREST (matching the sprite
 * pipeline) keeps the glyph edges hard. The font is kept at its authored pixel
 * size — no resolution scaling, which would re-introduce a downsample.
 */
export function addPixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  fontSizePx: number,
  color: string,
  extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}
): Phaser.GameObjects.Text {
  const t = scene.add.text(Math.round(x), Math.round(y), text, {
    fontFamily: FONT_FAMILY,
    fontSize: `${String(fontSizePx)}px`,
    color,
    resolution: 1,
    ...extra
  });
  t.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return t;
}

/** Register and fully load the pixel font. Resolves once glyphs are ready
 *  (or immediately if the FontFace API is unavailable). */
export async function loadFont(): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  const face = new FontFace(FONT_FAMILY, `url(${fontUrl})`);
  await face.load();
  document.fonts.add(face);
}
