import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH, type ArrowKind, type ArrowState } from "@shoot-and-run/sim";

/**
 * Sprite arrows (spec 007): the canonical sprite points right; rotation
 * follows the flight velocity each frame, and stuck arrows hold their last
 * flight angle (the sim zeroes velocity on stick). Wrap mirrors parallel the
 * archer quads. Cosmetic only — reads sim state, never writes.
 */

const ARROW_KEY = "arrow";
const SPRITE_SIZE = 16;
/** Main image + up to 3 wrap mirrors, parity with drawWrappedRect. */
const QUAD = 4;
/** Above chests (-1), below particles (10); ties with players resolve to
 *  arrows-on-top, which reads correctly for a projectile. */
const DEPTH_ARROWS = 1;

/** Kind tints matching the rect renderer's palette; normal stays natural. */
const KIND_TINTS: Partial<Record<ArrowKind, number>> = {
  bomb: 0xff5252,
  laser: 0x40e8ff,
  bounce: 0xffd740
};

export function loadArrowAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.image(ARROW_KEY, "assets/arrow.png");
}

export class ArrowRenderer {
  private readonly quads = new Map<number, Phaser.GameObjects.Image[]>();
  private readonly angles = new Map<number, number>();
  private readonly drawnThisFrame = new Set<number>();

  constructor(private readonly scene: Phaser.Scene) {}

  beginFrame(): void {
    this.drawnThisFrame.clear();
  }

  /** (x, y) is the interpolated arrow center. */
  draw(a: ArrowState, x: number, y: number): void {
    this.drawnThisFrame.add(a.id);
    if (a.phase === "flying" && (a.vx !== 0 || a.vy !== 0)) {
      this.angles.set(a.id, Math.atan2(a.vy, a.vx));
    }
    const angle = this.angles.get(a.id) ?? 0;

    let quad = this.quads.get(a.id);
    if (!quad) {
      const tint = KIND_TINTS[a.kind];
      quad = Array.from({ length: QUAD }, () => {
        const img = this.scene.add.image(0, 0, ARROW_KEY).setDepth(DEPTH_ARROWS).setVisible(false);
        if (tint !== undefined) img.setTint(tint);
        return img;
      });
      this.quads.set(a.id, quad);
    }

    const xs =
      x - SPRITE_SIZE / 2 < 0 ? [ARENA_WIDTH] : x + SPRITE_SIZE / 2 > ARENA_WIDTH ? [-ARENA_WIDTH] : [];
    const ys =
      y - SPRITE_SIZE / 2 < 0 ? [ARENA_HEIGHT] : y + SPRITE_SIZE / 2 > ARENA_HEIGHT ? [-ARENA_HEIGHT] : [];
    const offsets: [number, number][] = [[0, 0]];
    for (const dx of xs) offsets.push([dx, 0]);
    for (const dy of ys) offsets.push([0, dy]);
    if (xs.length > 0 && ys.length > 0) offsets.push([xs[0]!, ys[0]!]);

    for (let m = 0; m < QUAD; m++) {
      const img = quad[m]!;
      const off = offsets[m];
      if (!off) {
        img.setVisible(false);
        continue;
      }
      img.setPosition(x + off[0], y + off[1]).setRotation(angle).setVisible(true);
    }
  }

  /** Destroy sprites for arrows that left the sim (picked up, exploded). */
  endFrame(): void {
    for (const [id, quad] of this.quads) {
      if (this.drawnThisFrame.has(id)) continue;
      for (const img of quad) img.destroy();
      this.quads.delete(id);
      this.angles.delete(id);
    }
  }
}
