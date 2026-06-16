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

/**
 * Visual theme of an arena. The sim never sees this — it's read from the
 * arena JSON's optional cosmetic `theme` field (parseArena ignores unknown
 * keys), and selects which tileset + background the shell renders. Jungle is
 * the default for arenas that don't declare one (spec 007's arena-002).
 */
export type ArenaTheme = "jungle" | "castle";

/** Per-theme asset keys + the autotile role → frame-tag mapping. Each theme's
 *  atlas tags its own variants; the renderer only knows the abstract roles
 *  (top-exposed surface, interior fill, two under-platform decorations) and
 *  looks the concrete tag names up here. */
interface ThemeAssets {
  tilesKey: string;
  tilesPng: string;
  tilesJson: string;
  bgKey: string;
  bgPng: string;
  /** Tag for a tile whose top is exposed (a platform's lit surface). */
  topTag: string;
  /** Tag for a covered interior tile. */
  fillTag: string;
  /** Tags hung in the empty tile below a platform (hash 0 / hash 2). */
  hangTags: readonly [string, string];
}

const THEMES: Record<ArenaTheme, ThemeAssets> = {
  jungle: {
    tilesKey: "jungle-tiles",
    tilesPng: "assets/jungle-tiles.png",
    tilesJson: "assets/jungle-tiles.json",
    bgKey: "jungle-bg",
    bgPng: "assets/jungle-bg.png",
    topTag: "grass",
    fillTag: "dirt",
    hangTags: ["vine-a", "vine-b"]
  },
  castle: {
    tilesKey: "castle-tiles",
    tilesPng: "assets/castle-tiles.png",
    tilesJson: "assets/castle-tiles.json",
    bgKey: "castle-bg",
    bgPng: "assets/castle-bg.png",
    topTag: "cap",
    fillTag: "block",
    hangTags: ["hang-a", "hang-b"]
  }
};

/** Cache key under which a theme's tileset atlas JSON is stored. */
const tilesDataKey = (t: ThemeAssets): string => `${t.tilesKey}-data`;

/** Resolve an arena's render theme from its raw JSON. The cosmetic `theme`
 *  field is shell-only (the sim's parseArena strips it), so we read it off the
 *  untyped import; anything but a known theme falls back to jungle. */
export function themeFromArena(raw: unknown): ArenaTheme {
  const theme = (raw as { theme?: unknown } | null)?.theme;
  return theme === "castle" ? "castle" : "jungle";
}

/** Chest atlas key (spec 014: now a 2-frame `closed`/`opened` atlas). The
 *  opened frame is the decoration the booster renderer draws under a floating
 *  booster, so the key + frame lookup are exported. Chests are theme-neutral
 *  (wooden) and shared across all themes. */
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

export function loadEnvironmentAssets(
  loader: Phaser.Loader.LoaderPlugin,
  theme: ArenaTheme = "jungle"
): void {
  const t = THEMES[theme];
  loader.atlas(t.tilesKey, t.tilesPng, t.tilesJson);
  loader.json(tilesDataKey(t), t.tilesJson);
  loader.image(t.bgKey, t.bgPng);
  loader.atlas(CHEST_KEY, "assets/chest.png", "assets/chest.json");
  loader.json(CHEST_DATA_KEY, "assets/chest.json");
}

export class EnvironmentRenderer {
  private readonly chestImages = new Map<number, Phaser.GameObjects.Image>();
  /** Tile-variant tag name → atlas frame name. */
  private readonly tileFrame = new Map<string, string>();
  private readonly closedChestFrame: string;
  private readonly theme: ThemeAssets;

  constructor(
    private readonly scene: Phaser.Scene,
    arena: ArenaData,
    theme: ArenaTheme = "jungle"
  ) {
    this.theme = THEMES[theme];
    const data = this.scene.cache.json.get(tilesDataKey(this.theme)) as AsepriteData | undefined;
    if (!data?.meta?.frameTags?.length) {
      throw new Error(`${this.theme.tilesKey} atlas data missing frameTags — re-run \`npm run export:art\``);
    }
    const frameNames = orderedFrameNames(data);
    for (const tag of data.meta.frameTags) {
      const frame = frameNames[tag.from];
      if (frame) this.tileFrame.set(tag.name, frame);
    }
    this.closedChestFrame = chestFrameName(scene, "closed");

    scene.add.image(0, 0, this.theme.bgKey).setOrigin(0).setDepth(DEPTH_BG);
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
        const base = openAbove ? this.theme.topTag : this.theme.fillTag;
        const suffix = openLeft && openRight ? "-lr" : openLeft ? "-l" : openRight ? "-r" : "";
        this.addTile(c, r, base + suffix);

        const below = wrapRow(r + 1);
        if (!isSolid(arena.tiles, c, below)) {
          const hash = (c * 7 + r * 13) % 5;
          if (hash === 0) this.addTile(c, below, this.theme.hangTags[0]);
          else if (hash === 2) this.addTile(c, below, this.theme.hangTags[1]);
        }
      }
    }
  }

  private addTile(col: number, row: number, variant: string): void {
    const frame = this.tileFrame.get(variant);
    if (!frame) throw new Error(`${this.theme.tilesKey} atlas has no "${variant}" tag`);
    this.scene.add
      .image(col * TILE_SIZE, row * TILE_SIZE, this.theme.tilesKey, frame)
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
