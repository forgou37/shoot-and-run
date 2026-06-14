import type Phaser from "phaser";

/**
 * Character-select card art (spec: owner-supplied lobby cards). Each slot has a
 * single static 96×180 illustration with its frame, portrait and name banner
 * baked in — committed under packages/game/public/assets/card_<name>.png.
 *
 * Keys/paths are derived from the slot's players.json name (lowercased, spaces
 * stripped: "Lyosha"→lyosha, "Igor B"→igorb) so the mapping follows roster
 * identity rather than a hardcoded slot order.
 */

/** Native pixel dimensions of every card PNG. */
export const CARD_SRC_W = 96;
export const CARD_SRC_H = 180;

const normalize = (slotName: string): string => slotName.toLowerCase().replace(/\s+/g, "");

/** Texture key for a slot's card (e.g. "card-igorb"). */
export function cardTextureKey(slotName: string): string {
  return `card-${normalize(slotName)}`;
}

/** Load each slot's card image, skipping any already cached (lobby is re-entered
 *  after a match, when the textures persist). Safe to call from preload(). */
export function loadCardAssets(scene: Phaser.Scene, slots: readonly { name: string }[]): void {
  for (const s of slots) {
    const key = cardTextureKey(s.name);
    if (!scene.textures.exists(key)) scene.load.image(key, `assets/card_${normalize(s.name)}.png`);
  }
}
