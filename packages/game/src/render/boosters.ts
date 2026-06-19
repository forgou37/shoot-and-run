import Phaser from "phaser";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  CHEST_HEIGHT,
  wrapMod,
  type BoosterState,
  type ChestContents,
  type SimEvent
} from "@shoot-and-run/sim";
import { orderedFrameNames, type AsepriteData } from "./aseprite-data";
import { CHEST_KEY, chestFrameName } from "./environment";

/**
 * Floating booster rendering (spec 014). Each booster draws its content icon at
 * the booster's fixed pickup point with a small cosmetic up/down bob, plus an
 * opened-chest decoration at the chest base below it (the booster floats
 * `boosterFloatOffsetPx` overhead). A pickup burst plays on `booster_collected`.
 * Wrap mirrors parallel the other entity renderers. Cosmetic only — reads sim
 * state, never writes; the bob never affects the sim's fixed pickup position.
 */

const BOOSTERS_KEY = "boosters";
const BOOSTERS_DATA_KEY = "boosters-data";
/** Shield-bubble texture (loaded here, drawn by the archer renderer). */
export const SHIELD_BUBBLE_KEY = "shield-bubble";
/** Character-booster icon — generated procedurally (spec 019), no atlas frame. */
const CHARACTER_ICON_KEY = "character-icon";
/** "No homo" over-head indicator — generated procedurally (spec 019), drawn by
 *  the archer renderer above an Igor-B player while the shield is active. */
export const NO_HOMO_KEY = "no-homo-indicator";

/** Rainbow ramp shared by the character icon + the no-homo indicator. */
const RAINBOW = [0xff3b3b, 0xff9e2c, 0xffe14d, 0x49d65a, 0x3aa0ff, 0x9b4dff] as const;

/** Build the 16×16 character-booster icon (a rainbow bullseye orb) once. */
function ensureCharacterIcon(scene: Phaser.Scene): void {
  if (scene.textures.exists(CHARACTER_ICON_KEY)) return;
  const g = scene.make.graphics();
  for (let i = 0; i < RAINBOW.length; i++) {
    g.fillStyle(RAINBOW[i]!, 1);
    g.fillCircle(8, 8, 7.5 - i * 1.1);
  }
  g.fillStyle(0xffffff, 1);
  g.fillCircle(8, 8, 1.4); // bright core
  g.generateTexture(CHARACTER_ICON_KEY, 16, 16);
  g.destroy();
}

/** Build the 16×16 "No homo" indicator (rainbow-striped circle with a dark ring
 *  and a diagonal bar, per the owner reference) once. */
export function ensureNoHomoTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(NO_HOMO_KEY)) return;
  const g = scene.make.graphics();
  const cx = 8;
  const cy = 8;
  const r = 7;
  const bandH = (2 * r) / RAINBOW.length;
  for (let i = 0; i < RAINBOW.length; i++) {
    const top = cy - r + i * bandH;
    const midDy = top + bandH / 2 - cy;
    const halfW = Math.sqrt(Math.max(0, r * r - midDy * midDy));
    g.fillStyle(RAINBOW[i]!, 1);
    g.fillRect(cx - halfW, top, halfW * 2, bandH + 0.5);
  }
  g.lineStyle(1.5, 0x1b1b1b, 1);
  g.strokeCircle(cx, cy, r); // dark ring hides the blocky stripe edges
  g.lineStyle(2, 0x1b1b1b, 1);
  g.lineBetween(cx + r - 1, cy - r + 1, cx - r + 1, cy + r - 1); // diagonal slash
  g.generateTexture(NO_HOMO_KEY, 16, 16);
  g.destroy();
}
const SPRITE_SIZE = 16;
/** Main image + up to 3 wrap mirrors, parity with the other renderers. */
const QUAD = 4;
/** Above arrows (1) and players (0) so a floating pickup reads clearly. */
const DEPTH_BOOSTER = 2;
/** Opened-chest decoration sits at the chest depth, under everything else. */
const DEPTH_OPEN_CHEST = -1;
const DEPTH_BURST = 10;

export function loadBoosterAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.atlas(BOOSTERS_KEY, "assets/boosters.png", "assets/boosters.json");
  loader.json(BOOSTERS_DATA_KEY, "assets/boosters.json");
  loader.image(SHIELD_BUBBLE_KEY, "assets/shield-bubble.png");
}

export class BoosterRenderer {
  private readonly frameFor = new Map<ChestContents, string>();
  private readonly openedChestFrame: string;
  private readonly icons = new Map<number, Phaser.GameObjects.Image[]>();
  private readonly chestDeco = new Map<number, Phaser.GameObjects.Image>();
  private readonly lastPos = new Map<number, { x: number; y: number }>();
  private readonly drawnThisFrame = new Set<number>();
  private readonly burst: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly bobAmplitudePx: number,
    private readonly bobPeriodMs: number,
    /** Sim's boosterFloatOffsetPx — places the opened-chest deco below the icon. */
    private readonly floatOffsetPx: number
  ) {
    const data = scene.cache.json.get(BOOSTERS_DATA_KEY) as AsepriteData | undefined;
    if (!data?.meta?.frameTags?.length) {
      throw new Error("boosters atlas data missing frameTags — re-run `npm run export:art`");
    }
    const frames = orderedFrameNames(data);
    for (const tag of data.meta.frameTags) {
      const frame = frames[tag.from];
      if (frame) this.frameFor.set(tag.name as ChestContents, frame);
    }
    this.openedChestFrame = chestFrameName(scene, "opened");
    ensureCharacterIcon(scene); // "character" has no atlas frame — generated

    // 1-color particle texture, shared with ArenaScene's "px" if present.
    if (!scene.textures.exists("px")) {
      const g = scene.make.graphics();
      g.fillStyle(0xffffff);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture("px", 2, 2);
      g.destroy();
    }
    this.burst = scene.add
      .particles(0, 0, "px", {
        lifespan: { min: 150, max: 380 },
        speed: { min: 40, max: 120 },
        scale: { start: 1, end: 0 },
        gravityY: 120,
        emitting: false,
        tint: [0xffffff, 0xffe066, 0x9fd8ff]
      })
      .setDepth(DEPTH_BURST);
  }

  beginFrame(): void {
    this.drawnThisFrame.clear();
  }

  /** Draw one booster: opened-chest deco at the base + bobbing icon overhead. */
  draw(b: BoosterState): void {
    const isChar = b.contents === "character";
    const frame = this.frameFor.get(b.contents);
    if (!isChar && !frame) return;
    this.drawnThisFrame.add(b.id);

    // Opened chest sits at the original chest spot (floatOffset below the icon),
    // feet-aligned to its hitbox bottom like the live chests.
    const chestY = wrapMod(b.y + this.floatOffsetPx, ARENA_HEIGHT);
    let deco = this.chestDeco.get(b.id);
    if (!deco) {
      deco = this.scene.add
        .image(b.x, chestY + CHEST_HEIGHT / 2, CHEST_KEY, this.openedChestFrame)
        .setOrigin(0.5, 1)
        .setDepth(DEPTH_OPEN_CHEST);
      this.chestDeco.set(b.id, deco);
    }
    deco.setPosition(b.x, chestY + CHEST_HEIGHT / 2);

    const bob =
      this.bobAmplitudePx * Math.sin((this.scene.time.now / this.bobPeriodMs) * Math.PI * 2 + b.id);
    const x = b.x;
    const y = b.y + bob;
    this.lastPos.set(b.id, { x, y });

    let quad = this.icons.get(b.id);
    if (!quad) {
      quad = Array.from({ length: QUAD }, () =>
        (isChar
          ? this.scene.add.image(0, 0, CHARACTER_ICON_KEY)
          : this.scene.add.image(0, 0, BOOSTERS_KEY, frame)
        )
          .setDepth(DEPTH_BOOSTER)
          .setVisible(false)
      );
      this.icons.set(b.id, quad);
    }
    const offsets = wrapMirrorOffsets(x, y, SPRITE_SIZE / 2);
    for (let m = 0; m < QUAD; m++) {
      const img = quad[m]!;
      const off = offsets[m];
      if (!off) {
        img.setVisible(false);
        continue;
      }
      img.setPosition(x + off[0], y + off[1]).setVisible(true);
    }
  }

  /** Pickup burst at the collected booster's last drawn position. */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type !== "booster_collected") continue;
      const pos = this.lastPos.get(e.boosterId);
      if (pos) this.burst.explode(14, pos.x, pos.y);
    }
  }

  /** Destroy sprites for boosters that left the sim (collected, round reset). */
  endFrame(): void {
    for (const [id, quad] of this.icons) {
      if (this.drawnThisFrame.has(id)) continue;
      for (const img of quad) img.destroy();
      this.icons.delete(id);
      this.chestDeco.get(id)?.destroy();
      this.chestDeco.delete(id);
      this.lastPos.delete(id);
    }
  }
}

/** Wrap-mirror offsets for a `2*half`-wide sprite centered at (x, y): the main
 *  copy plus up to 3 mirrors when it straddles an edge. Shared by the booster
 *  icons here and the archer renderer's shield bubble / no-homo indicator. */
export function wrapMirrorOffsets(x: number, y: number, half: number): [number, number][] {
  const xs = x - half < 0 ? [ARENA_WIDTH] : x + half > ARENA_WIDTH ? [-ARENA_WIDTH] : [];
  const ys = y - half < 0 ? [ARENA_HEIGHT] : y + half > ARENA_HEIGHT ? [-ARENA_HEIGHT] : [];
  const offsets: [number, number][] = [[0, 0]];
  for (const dx of xs) offsets.push([dx, 0]);
  for (const dy of ys) offsets.push([0, dy]);
  if (xs.length > 0 && ys.length > 0) offsets.push([xs[0]!, ys[0]!]);
  return offsets;
}
