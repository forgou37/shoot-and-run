import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH } from "@shoot-and-run/sim";
import { wrapMirrorOffsets } from "./boosters";

/**
 * Maks "Blackout" overlay (spec 019, Phase 2 / T19.4). While any player's
 * `blackoutTicksLeft > 0` the arena is covered by a near-black layer and a soft
 * circle of light is erased from it over each lit player, so opponents read
 * clearly and Maks (the blackout owner) keeps only a small light pool. Purely
 * cosmetic — reads sim state, never writes. Wrap-mirrored like the entities.
 */

/** Procedural soft-light stamp; its radius is scaled per spotlight. */
const LIGHT_KEY = "blackout-light";
const LIGHT_R = 64;
/** Above all gameplay entities, below the HUD chips (20) and pause menu (29/30). */
const DEPTH = 15;

export interface LightSpot {
  x: number;
  y: number;
  radius: number;
}

/** Build the radial-gradient light stamp once (solid core, soft falloff). */
function ensureLightTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(LIGHT_KEY)) return;
  const size = LIGHT_R * 2;
  const tex = scene.textures.createCanvas(LIGHT_KEY, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(LIGHT_R, LIGHT_R, 0, LIGHT_R, LIGHT_R, LIGHT_R);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

export class BlackoutRenderer {
  private readonly rt: Phaser.GameObjects.RenderTexture;
  /** A single off-scene stamp reused for every erase. */
  private readonly stamp: Phaser.GameObjects.Image;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly darknessAlpha: number
  ) {
    ensureLightTexture(scene);
    this.rt = scene.add
      .renderTexture(0, 0, ARENA_WIDTH, ARENA_HEIGHT)
      .setOrigin(0, 0)
      .setDepth(DEPTH)
      .setVisible(false);
    this.stamp = scene.make.image({ key: LIGHT_KEY, add: false }).setOrigin(0.5);
  }

  /** Redraw the darkness with one light hole per spot; hidden when none. */
  update(spots: readonly LightSpot[]): void {
    if (spots.length === 0) {
      this.rt.setVisible(false);
      return;
    }
    this.rt.setVisible(true);
    this.rt.clear();
    this.rt.fill(0x000000, this.darknessAlpha);
    for (const s of spots) {
      this.stamp.setScale(s.radius / LIGHT_R);
      for (const [dx, dy] of wrapMirrorOffsets(s.x, s.y, s.radius)) {
        this.stamp.setPosition(s.x + dx, s.y + dy);
        this.rt.erase(this.stamp);
      }
    }
  }
}
