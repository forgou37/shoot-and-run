/**
 * Character-select card art (owner-supplied lobby cards). Each slot has a single
 * static illustration — ornate frame + full-body portrait — committed at full
 * master resolution under packages/game/public/assets/card_<name>.png.
 *
 * The owner delivers all four as one transparent sheet (assets/cards.aseprite);
 * scripts/slice-cards.mjs auto-detects each card's column and writes the per-slot
 * PNGs at master resolution. They are drawn by the lobby's hi-res DOM overlay
 * (see render/card-overlay.ts) rather than through the 320×240 pixel buffer, so
 * the painted detail survives instead of being crushed to the buffer footprint.
 *
 * URLs are derived from the slot's players.json name (lowercased, spaces
 * stripped: "Lyosha"→lyosha, "Igor B"→igorb) so the mapping follows roster
 * identity rather than a hardcoded slot order.
 */

const normalize = (slotName: string): string => slotName.toLowerCase().replace(/\s+/g, "");

/** Public URL of a slot's full-resolution card image (relative, like the Phaser
 *  loader paths, so it resolves under the GitHub Pages project subpath too). */
export function cardImageUrl(slotName: string): string {
  return `assets/card_${normalize(slotName)}.png`;
}

/** Phaser texture/atlas key for a slot's per-character in-match archer sheet
 *  (spec 014), name-normalized like the cards so the mapping follows roster
 *  identity ("Igor B" → archer_igorb). */
export function archerAtlasKey(slotName: string): string {
  return `archer_${normalize(slotName)}`;
}
