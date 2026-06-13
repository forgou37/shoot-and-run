import fontUrl from "../../../assets/fonts/FreePixel.ttf";

/** The shell's pixel font (assets/fonts/FreePixel.ttf). Every Phaser Text
 *  style references this; load it via loadFont() before the game boots so the
 *  first render rasterizes the real glyphs, not a fallback. */
export const FONT_FAMILY = "FreePixel";

/** Register and fully load the pixel font. Resolves once glyphs are ready
 *  (or immediately if the FontFace API is unavailable). */
export async function loadFont(): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  const face = new FontFace(FONT_FAMILY, `url(${fontUrl})`);
  await face.load();
  document.fonts.add(face);
}
