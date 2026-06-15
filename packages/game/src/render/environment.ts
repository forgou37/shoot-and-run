import Phaser from "phaser";
import {
  ARENA_COLS,
  ARENA_ROWS,
  CHEST_HEIGHT,
  TILE_SIZE,
  isSolid,
  type ArenaData,
  type ChestState
} from "@shoot-and-run/sim";
import { orderedFrameNames, type AsepriteData } from "./aseprite-data";

/**
 * Jungle environment rendering (spec 007): background image, autotiled
 * platforms with hanging vines, chest sprites. Pure cosmetics — everything
 * here READS arena and sim state only; the rect renderer (`?rects=1`)
 * remains the hitbox-true debug view.
 */

const TILES_KEY = "jungle-tiles";
const TILES_DATA_KEY = "jungle-tiles-data";
const BG_KEY = "jungle-bg";
/** Chest atlas key (spec 014: now a 2-frame `closed`/`opened` atlas). The
 *  opened frame is the decoration the booster renderer draws under a floating
 *  booster, so the key + frame lookup are exported. */
export const CHEST_KEY = "chest";
const CHEST_DATA_KEY = "chest-data";

/** Resolve a chest atlas frame name by its tag (`closed` / `opened`). Requires
 *  the chest atlas data loaded (loadEnvironmentAssets). */
export function chestFrameName(scene: Phaser.Scene, tag: "closed" | "opened"): string {
  const data = scene.cache.json.get(CHEST_DATA_KEY) as AsepriteData | undefined;
  if (!data?.meta?.frameTags?.length) {
    throw new Error("chest atlas data missing frameTags — re-run `npm run export:art`");
  }
  const frames = orderedFrameNames(data);
  const ft = data.meta.frameTags.find((t) => t.name === tag);
  const frame = ft && frames[ft.from];
  if (!frame) throw new Error(`chest atlas has no "${tag}" tag`);
  return frame;
}

/** Explicit depths so runtime-created images never cover depth-0 entities:
 *  background < tiles/vines < chests < entities (0) < FX/overlays. */
const DEPTH_BG = -20;
const DEPTH_TILES = -10;
const DEPTH_CHESTS = -1;

export function loadEnvironmentAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.atlas(TILES_KEY, "assets/jungle-tiles.png", "assets/jungle-tiles.json");
  loader.json(TILES_DATA_KEY, "assets/jungle-tiles.json");
  loader.image(BG_KEY, "assets/jungle-bg.png");
  loader.atlas(CHEST_KEY, "assets/chest.png", "assets/chest.json");
  loader.json(CHEST_DATA_KEY, "assets/chest.json");
}

export class EnvironmentRenderer {
  private readonly chestImages = new Map<number, Phaser.GameObjects.Image>();
  /** Tile-variant tag name → atlas frame name. */
  private readonly tileFrame = new Map<string, string>();
  private readonly closedChestFrame: string;

  constructor(
    private readonly scene: Phaser.Scene,
    arena: ArenaData
  ) {
    const data = this.scene.cache.json.get(TILES_DATA_KEY) as AsepriteData | undefined;
    if (!data?.meta?.frameTags?.length) {
      throw new Error("jungle-tiles atlas data missing frameTags — re-run `npm run export:art`");
    }
    const frameNames = orderedFrameNames(data);
    for (const tag of data.meta.frameTags) {
      const frame = frameNames[tag.from];
      if (frame) this.tileFrame.set(tag.name, frame);
    }
    this.closedChestFrame = chestFrameName(scene, "closed");

    scene.add.image(0, 0, BG_KEY).setOrigin(0).setDepth(DEPTH_BG);
    this.placeTiles(arena);
  }

  /** Solid tiles pick their variant from a wrap-aware exposure mask; vines
   *  hang under platforms via a deterministic position hash (no RNG). */
  private placeTiles(arena: ArenaData): void {
    const wrapCol = (c: number): number => (c + ARENA_COLS) % ARENA_COLS;
    const wrapRow = (r: number): number => (r + ARENA_ROWS) % ARENA_ROWS;
    for (let r = 0; r < ARENA_ROWS; r++) {
      for (let c = 0; c < ARENA_COLS; c++) {
        if (!isSolid(arena.tiles, c, r)) continue;
        const openAbove = !isSolid(arena.tiles, c, wrapRow(r - 1));
        const openLeft = !isSolid(arena.tiles, wrapCol(c - 1), r);
        const openRight = !isSolid(arena.tiles, wrapCol(c + 1), r);
        const base = openAbove ? "grass" : "dirt";
        const suffix = openLeft && openRight ? "-lr" : openLeft ? "-l" : openRight ? "-r" : "";
        this.addTile(c, r, base + suffix);

        const below = wrapRow(r + 1);
        if (!isSolid(arena.tiles, c, below)) {
          const hash = (c * 7 + r * 13) % 5;
          if (hash === 0) this.addTile(c, below, "vine-a");
          else if (hash === 2) this.addTile(c, below, "vine-b");
        }
      }
    }
  }

  private addTile(col: number, row: number, variant: string): void {
    const frame = this.tileFrame.get(variant);
    if (!frame) throw new Error(`jungle-tiles atlas has no "${variant}" tag`);
    this.scene.add
      .image(col * TILE_SIZE, row * TILE_SIZE, TILES_KEY, frame)
      .setOrigin(0)
      .setDepth(DEPTH_TILES);
  }

  /** Chests never straddle edges (placement validation keeps their hitbox in
   *  bounds), so one image per chest id, feet-aligned to the hitbox bottom. */
  updateChests(chests: readonly ChestState[]): void {
    const seen = new Set<number>();
    for (const chest of chests) {
      seen.add(chest.id);
      if (!this.chestImages.has(chest.id)) {
        const img = this.scene.add
          .image(chest.x, chest.y + CHEST_HEIGHT / 2, CHEST_KEY, this.closedChestFrame)
          .setOrigin(0.5, 1)
          .setDepth(DEPTH_CHESTS);
        this.chestImages.set(chest.id, img);
      }
    }
    for (const [id, img] of this.chestImages) {
      if (!seen.has(id)) {
        img.destroy();
        this.chestImages.delete(id);
      }
    }
  }
}
