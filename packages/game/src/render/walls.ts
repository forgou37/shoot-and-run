import Phaser from "phaser";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  WALL_HALF_LENGTH,
  WALL_HALF_THICKNESS,
  wallAxes,
  type SimEvent,
  type WallState
} from "@shoot-and-run/sim";

/**
 * Deployed-wall rendering (spec 018). A wall is a static 4×24 plank tinted by its
 * builder's color and rotated so its long axis matches the sim collider's `u`
 * axis (so what you see is what blocks). A build puff plays on `wall_built`, a
 * dissolve burst on `wall_destroyed`. Wrap mirrors parallel the other entity
 * renderers. Cosmetic only — reads sim state, never writes.
 */

const WALL_TEX = "wall-plank";
const TEX_W = WALL_HALF_THICKNESS * 2; // 4
const TEX_H = WALL_HALF_LENGTH * 2; // 24
/** Half the longest footprint, for the wrap-mirror test (the plank is ≤24 long). */
const HALF_FOOTPRINT = WALL_HALF_LENGTH;
/** Above tiles/chests, below players (0) and arrows (1) so actors read on top. */
const DEPTH_WALL = -0.5;
const DEPTH_BURST = 10;

/** Phaser rotation (radians) that aligns the vertical plank texture with the
 *  wall's local long axis u. atan2(-u.x, u.y) rotates (0,1) → u exactly. */
function wallAngle(rotation: WallState["rotation"]): number {
  const ax = wallAxes(rotation);
  return Math.atan2(-ax.ux, ax.uy);
}

export class WallRenderer {
  private readonly quads = new Map<number, Phaser.GameObjects.Image[]>();
  private readonly drawnThisFrame = new Set<number>();
  private readonly burst: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private readonly scene: Phaser.Scene) {
    if (!scene.textures.exists(WALL_TEX)) {
      const g = scene.make.graphics();
      g.fillStyle(0x8a8a8a); // darker edge tone (tints to a beveled plank)
      g.fillRect(0, 0, TEX_W, TEX_H);
      g.fillStyle(0xffffff); // bright core takes the owner tint at full strength
      g.fillRect(1, 1, TEX_W - 2, TEX_H - 2);
      g.generateTexture(WALL_TEX, TEX_W, TEX_H);
      g.destroy();
    }
    if (!scene.textures.exists("px")) {
      const g = scene.make.graphics();
      g.fillStyle(0xffffff);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture("px", 2, 2);
      g.destroy();
    }
    this.burst = scene.add
      .particles(0, 0, "px", {
        lifespan: { min: 150, max: 400 },
        speed: { min: 30, max: 110 },
        scale: { start: 1.4, end: 0 },
        gravityY: 90,
        emitting: false
      })
      .setDepth(DEPTH_BURST);
  }

  beginFrame(): void {
    this.drawnThisFrame.clear();
  }

  /** Draw one wall at its (static) position, tinted by the owner's color. */
  draw(w: WallState, tint: number): void {
    this.drawnThisFrame.add(w.id);
    const angle = wallAngle(w.rotation);

    let quad = this.quads.get(w.id);
    if (!quad) {
      quad = Array.from({ length: 4 }, () =>
        this.scene.add
          .image(0, 0, WALL_TEX)
          .setDepth(DEPTH_WALL)
          .setTint(tint)
          .setVisible(false)
      );
      this.quads.set(w.id, quad);
    }

    const offsets = wrapOffsets(w.x, w.y);
    for (let m = 0; m < quad.length; m++) {
      const img = quad[m]!;
      const off = offsets[m];
      if (!off) {
        img.setVisible(false);
        continue;
      }
      img.setPosition(w.x + off[0], w.y + off[1]).setRotation(angle).setVisible(true);
    }
  }

  /** Build puff (owner-tinted) and dissolve burst (stone gray) from sim events. */
  onEvents(events: readonly SimEvent[], tintForSlot: (slot: number) => number): void {
    for (const e of events) {
      if (e.type === "wall_built") {
        this.burst.setParticleTint(tintForSlot(e.slot));
        this.burst.explode(10, e.x, e.y);
      } else if (e.type === "wall_destroyed") {
        this.burst.setParticleTint(0xb0b0b8);
        this.burst.explode(16, e.x, e.y);
      }
    }
  }

  /** Destroy sprites for walls that left the sim (shot down, round reset). */
  endFrame(): void {
    for (const [id, quad] of this.quads) {
      if (this.drawnThisFrame.has(id)) continue;
      for (const img of quad) img.destroy();
      this.quads.delete(id);
    }
  }
}

/** Wrap-mirror offsets for a wall centered at (x, y). */
function wrapOffsets(x: number, y: number): ([number, number] | undefined)[] {
  const xs =
    x - HALF_FOOTPRINT < 0 ? [ARENA_WIDTH] : x + HALF_FOOTPRINT > ARENA_WIDTH ? [-ARENA_WIDTH] : [];
  const ys =
    y - HALF_FOOTPRINT < 0
      ? [ARENA_HEIGHT]
      : y + HALF_FOOTPRINT > ARENA_HEIGHT
        ? [-ARENA_HEIGHT]
        : [];
  const offsets: [number, number][] = [[0, 0]];
  for (const dx of xs) offsets.push([dx, 0]);
  for (const dy of ys) offsets.push([0, dy]);
  if (xs.length > 0 && ys.length > 0) offsets.push([xs[0]!, ys[0]!]);
  return offsets;
}
