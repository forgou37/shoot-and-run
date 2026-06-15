import Phaser from "phaser";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PLAYER_HEIGHT,
  type PlayerState,
  type SimEvent
} from "@shoot-and-run/sim";
import { orderedFrameNames, type AsepriteData } from "./aseprite-data";
import { SHIELD_BUBBLE_KEY } from "./boosters";
import { archerAtlasKey } from "./cards";
import type { PlayerInput } from "@shoot-and-run/sim";

/**
 * Player sprite rendering (spec 006). One canonical archer atlas (P1 ramp);
 * other slots get a runtime-recolored copy. Animations are built from the
 * Aseprite JSON's frameTags with exact per-frame durations. Render code only
 * READS sim state — selection below is cosmetic mapping, not game logic.
 */

/** Canonical archer atlas key; per-slot recolors are `${ARCHER_ATLAS_KEY}-${slot}`. */
export const ARCHER_ATLAS_KEY = "archer";
const DATA_KEY = "archer-data";

/** The P1 ramp baked into the canonical sheet: [shadow, base, highlight]. */
const CANONICAL_RAMP = ["#2d7fc4", "#4fc3f7", "#a8e6ff"] as const;
/** Lightness offsets used to derive a slot ramp from its players.json color. */
const SHADOW_OFFSET = -0.22;
const HIGHLIGHT_OFFSET = 0.22;

const SPRITE_SIZE = 16;
/** Mirror copies drawn when the sprite straddles a wrapping edge (parity with
 *  drawWrappedRect): main + up to 3 mirrors. */
const QUAD = 4;
/** Shield bubble (spec 014): a ~20px ring drawn around a `shielded` player. */
const BUBBLE_HALF = 10;
const DEPTH_SHIELD = 3;

export const ARCHER_TAGS = ["idle", "run", "jump", "fall", "shoot", "death"] as const;
export type ArcherTag = (typeof ARCHER_TAGS)[number];

/** Playback per tag: loops follow the tag's direction; jump/shoot/death are
 *  one-shots that hold their final frame. */
const PLAYBACK: Record<ArcherTag, { repeat: number; yoyo: boolean }> = {
  idle: { repeat: -1, yoyo: true },
  run: { repeat: -1, yoyo: false },
  jump: { repeat: 0, yoyo: false },
  fall: { repeat: -1, yoyo: true },
  shoot: { repeat: 0, yoyo: false },
  death: { repeat: 0, yoyo: false }
};

/**
 * Normalized identity names that have a committed per-character archer atlas
 * (spec 014). Only listed sheets are loaded, so absent ones never 404; a slot
 * whose named sheet isn't listed falls back to the recolored generic archer.
 * Add a name here once its `assets/archer_<name>.aseprite` is exported.
 */
export const NAMED_ARCHER_SHEETS: readonly string[] = [];

export function loadArcherAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.atlas(ARCHER_ATLAS_KEY, "assets/archer.png", "assets/archer.json");
  loader.json(DATA_KEY, "assets/archer.json");
  for (const name of NAMED_ARCHER_SHEETS) {
    const key = `archer_${name}`;
    loader.atlas(key, `assets/${key}.png`, `assets/${key}.json`);
    loader.json(`${key}-data`, `assets/${key}.json`);
  }
}

/** Held-aim → tag suffix (spec 014 A14.15). Pure-up → `_up`, any up-diagonal →
 *  `_up45`, any down → `_down45`, else horizontal (base). facing drives flipX,
 *  so left/right share a suffix. */
export function aimSuffix(input: PlayerInput): string {
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dy < 0) return dx !== 0 ? "_up45" : "_up";
  if (dy > 0) return "_down45";
  return "";
}

/** First idle frame name — a good static portrait pose (lobby/menus). Requires
 *  the archer atlas data to be loaded (loadArcherAssets). */
export function archerIdleFrameName(scene: Phaser.Scene): string {
  const data = scene.cache.json.get(DATA_KEY) as AsepriteData | undefined;
  const name = data && orderedFrameNames(data)[0];
  if (!name) throw new Error("archer atlas data missing — re-run `npm run export:art`");
  return name;
}

/**
 * Build (once) a per-slot recolored archer texture and return its key. Slot 0 is
 * the canonical sheet untouched; other slots recolor the canonical
 * [shadow, base, highlight] ramp toward the slot color. The recolored canvas
 * mirrors the canonical frame definitions and is sampled NEAREST so it stays
 * crisp when scaled. Reused by the in-match renderer and the lobby portraits.
 * Idempotent: textures are game-global and survive scene restarts (e.g. lobby →
 * match → lobby), so an existing recolor is returned rather than rebuilt.
 */
export function recolorArcherTexture(scene: Phaser.Scene, slot: number, color: string): string {
  if (slot === 0) return ARCHER_ATLAS_KEY;
  const key = `${ARCHER_ATLAS_KEY}-${String(slot)}`;
  if (scene.textures.exists(key)) return key;
  const canonical = scene.textures.get(ARCHER_ATLAS_KEY);
  const source = canonical.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const canvas = scene.textures.createCanvas(key, source.width, source.height);
  if (!canvas) throw new Error(`texture key collision: ${key}`);
  canvas.context.drawImage(source, 0, 0);
  const image = canvas.context.getImageData(0, 0, source.width, source.height);
  const ramp = slotRamp(color);
  const map = new Map<number, readonly [number, number, number]>();
  CANONICAL_RAMP.forEach((hex, i) => map.set(packHex(hex), ramp[i]!));
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const replacement = map.get((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    if (replacement) {
      px[i] = replacement[0];
      px[i + 1] = replacement[1];
      px[i + 2] = replacement[2];
    }
  }
  canvas.context.putImageData(image, 0, 0);
  canvas.refresh();
  canvas.setFilter(Phaser.Textures.FilterMode.NEAREST);
  for (const name of canonical.getFrameNames()) {
    const f = canonical.get(name);
    canvas.add(name, 0, f.cutX, f.cutY, f.cutWidth, f.cutHeight);
  }
  return key;
}

export class ArcherRenderer {
  private readonly quads: Phaser.GameObjects.Sprite[][] = [];
  /** Per-slot last held-aim suffix, so a fired-shoot one-shot aims correctly. */
  private readonly lastAim: string[] = [];
  /** Per-slot shield bubble wrap-quad + its last drawn center (for the pop FX). */
  private readonly shieldQuads: Phaser.GameObjects.Image[][] = [];
  private readonly shieldPos: { x: number; y: number }[] = [];
  private shieldPop: Phaser.GameObjects.Image | null = null;
  private readonly hasShieldTex: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly slots: readonly { slot: number; color: string; name: string }[]
  ) {
    const genericData = scene.cache.json.get(DATA_KEY) as AsepriteData | undefined;
    if (!genericData?.meta?.frameTags?.length) {
      throw new Error("archer atlas data missing frameTags — re-run `npm run export:art`");
    }
    for (const s of slots) {
      // Per-character sheet (spec 014) keyed by identity name; fall back to the
      // recolored generic archer when a named sheet isn't loaded.
      const named = archerAtlasKey(s.name);
      const useNamed = scene.textures.exists(named);
      const textureKey = useNamed ? named : recolorArcherTexture(this.scene, s.slot, s.color);
      const data =
        (useNamed ? (scene.cache.json.get(`${named}-data`) as AsepriteData | undefined) : genericData) ??
        genericData;
      const frameNames = orderedFrameNames(data);
      this.buildSlotAnims(s.slot, textureKey, data, frameNames);
      this.lastAim.push("");
      const quad: Phaser.GameObjects.Sprite[] = [];
      for (let m = 0; m < QUAD; m++) {
        quad.push(
          scene.add.sprite(0, 0, textureKey, frameNames[0]).setOrigin(0.5, 1).setVisible(false)
        );
      }
      this.quads.push(quad);
    }

    // Shield bubbles (spec 014): one wrap-quad per slot + a shared pop sprite.
    // Guarded so scenes that don't load the bubble texture still construct.
    this.hasShieldTex = scene.textures.exists(SHIELD_BUBBLE_KEY);
    if (this.hasShieldTex) {
      for (let i = 0; i < slots.length; i++) {
        this.shieldQuads.push(
          Array.from({ length: QUAD }, () =>
            scene.add.image(0, 0, SHIELD_BUBBLE_KEY).setDepth(DEPTH_SHIELD).setVisible(false)
          )
        );
        this.shieldPos.push({ x: 0, y: 0 });
      }
      this.shieldPop = scene.add
        .image(0, 0, SHIELD_BUBBLE_KEY)
        .setDepth(DEPTH_SHIELD)
        .setVisible(false);
    }
  }

  /** Cosmetic one-shots driven by sim events (spec 006 T6.3): `shoot` plays
   *  on every arrow_fired; death is driven from state in update(). */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === "arrow_fired") {
        const idx = this.slots.findIndex((s) => s.slot === e.playerSlot);
        if (idx >= 0) {
          this.quads[idx]?.[0]?.play(this.resolveAnim(e.playerSlot, "shoot", this.lastAim[idx] ?? ""));
        }
      } else if (e.type === "shield_blocked") {
        const idx = this.slots.findIndex((s) => s.slot === e.slot);
        if (idx >= 0) this.popShield(idx);
      }
    }
  }

  /** Per render frame. (x, y) is the interpolated hitbox center. `aimSuf` is the
   *  held-aim tag suffix (spec 014), derived shell-side from live input. */
  update(p: PlayerState, slotIndex: number, x: number, y: number, alpha: number, aimSuf = ""): void {
    const quad = this.quads[slotIndex]!;
    const main = quad[0]!;
    const slot = this.slots[slotIndex]!.slot;
    this.lastAim[slotIndex] = aimSuf;
    const bottomY = y + PLAYER_HEIGHT / 2;
    const desired = this.resolveAnim(slot, this.selectTag(p), aimSuf);
    const current = main.anims.currentAnim?.key;
    // A playing shoot one-shot wins over locomotion; death wins over everything.
    const holdShoot =
      current?.startsWith(animKey(slot, "shoot")) === true && main.anims.isPlaying && p.alive;
    if (!holdShoot && current !== desired) main.play(desired);
    this.place(main, x, bottomY, p, alpha);

    const offsets: [number, number][] = [];
    const xs = x - SPRITE_SIZE / 2 < 0 ? [ARENA_WIDTH] : x + SPRITE_SIZE / 2 > ARENA_WIDTH ? [-ARENA_WIDTH] : [];
    const ys = bottomY - SPRITE_SIZE < 0 ? [ARENA_HEIGHT] : bottomY > ARENA_HEIGHT ? [-ARENA_HEIGHT] : [];
    for (const dx of xs) offsets.push([dx, 0]);
    for (const dy of ys) offsets.push([0, dy]);
    if (xs.length > 0 && ys.length > 0) offsets.push([xs[0]!, ys[0]!]);
    for (let m = 1; m < QUAD; m++) {
      const mirror = quad[m]!;
      const off = offsets[m - 1];
      if (!off) {
        mirror.setVisible(false);
        continue;
      }
      mirror.setTexture(main.texture.key, main.frame.name);
      this.place(mirror, x + off[0], bottomY + off[1], p, alpha);
    }

    this.updateShield(p, slotIndex, x, y);
  }

  /** Shield bubble around a `shielded`, alive player — a gentle alpha pulse,
   *  wrap-mirrored. Hidden otherwise; the pop FX is driven by shield_blocked. */
  private updateShield(p: PlayerState, slotIndex: number, x: number, y: number): void {
    if (!this.hasShieldTex) return;
    const quad = this.shieldQuads[slotIndex]!;
    if (!p.alive || !p.shielded) {
      for (const img of quad) img.setVisible(false);
      return;
    }
    this.shieldPos[slotIndex] = { x, y };
    const pulse = 0.6 + 0.2 * Math.sin(this.scene.time.now / 220);
    const xs = x - BUBBLE_HALF < 0 ? [ARENA_WIDTH] : x + BUBBLE_HALF > ARENA_WIDTH ? [-ARENA_WIDTH] : [];
    const ys = y - BUBBLE_HALF < 0 ? [ARENA_HEIGHT] : y + BUBBLE_HALF > ARENA_HEIGHT ? [-ARENA_HEIGHT] : [];
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
      img.setPosition(x + off[0], y + off[1]).setAlpha(pulse).setVisible(true);
    }
  }

  /** Brief expanding-fade pop when a shield absorbs a hit (shield_blocked). */
  private popShield(slotIndex: number): void {
    if (!this.shieldPop) return;
    for (const img of this.shieldQuads[slotIndex] ?? []) img.setVisible(false);
    const pos = this.shieldPos[slotIndex] ?? { x: 0, y: 0 };
    const pop = this.shieldPop;
    this.scene.tweens.killTweensOf(pop);
    pop.setPosition(pos.x, pos.y).setScale(1).setAlpha(0.95).setVisible(true);
    this.scene.tweens.add({
      targets: pop,
      scale: 2.2,
      alpha: 0,
      duration: 260,
      ease: "Quad.Out",
      onComplete: () => pop.setVisible(false)
    });
  }

  private place(
    sprite: Phaser.GameObjects.Sprite,
    x: number,
    bottomY: number,
    p: PlayerState,
    alpha: number
  ): void {
    sprite.setPosition(x, bottomY).setFlipX(p.facing === -1).setAlpha(alpha).setVisible(true);
  }

  /** Animation mapping (spec 006 fixed design points). The dead pose holds
   *  its final lying frame as the corpse until the round restarts. */
  private selectTag(p: PlayerState): ArcherTag {
    if (!p.alive) return "death";
    if (!p.grounded) return p.vy < 0 ? "jump" : "fall";
    return Math.abs(p.vx) > 1 ? "run" : "idle";
  }

  /** Pick the directional aim variant of a base tag if this slot's sheet has it
   *  (spec 014 A14.14), else the base tag. `death` has no aim variant. */
  private resolveAnim(slot: number, baseTag: ArcherTag, aimSuf: string): string {
    if (baseTag !== "death" && aimSuf) {
      const withAim = animKey(slot, `${baseTag}${aimSuf}`);
      if (this.scene.anims.exists(withAim)) return withAim;
    }
    return animKey(slot, baseTag);
  }

  /** Mirrors Phaser's createFromAseprite timing: base rate from the tag's
   *  shortest frame, per-frame `duration` carries the remainder. */
  private buildSlotAnims(
    slot: number,
    textureKey: string,
    data: AsepriteData,
    frameNames: readonly string[]
  ): void {
    for (const tag of data.meta.frameTags) {
      // Aim variants (e.g. "run_up45") share the base tag's playback ("run").
      const baseTag = tag.name.split("_")[0] as ArcherTag;
      const playback = PLAYBACK[baseTag];
      if (!playback) continue;
      // Anims, like textures, are game-global and outlive the scene; skip ones
      // already built for this slot on an earlier match.
      if (this.scene.anims.exists(animKey(slot, tag.name))) continue;
      const names = frameNames.slice(tag.from, tag.to + 1);
      const durations = names.map((n) => data.frames[n]?.duration ?? 100);
      const minDuration = Math.min(...durations);
      this.scene.anims.create({
        key: animKey(slot, tag.name),
        frames: names.map((frame, i) => ({
          key: textureKey,
          frame,
          duration: durations[i]! - minDuration
        })),
        frameRate: 1000 / minDuration,
        repeat: playback.repeat,
        yoyo: playback.yoyo
      });
    }
  }
}

export function animKey(slot: number, tag: string): string {
  return `archer-${String(slot)}-${tag}`;
}

function slotRamp(color: string): [number, number, number][] {
  const [h, s, l] = rgbToHsl(packHex(color));
  return [
    hslToRgb(h, s, clamp01(l + SHADOW_OFFSET, 0.08, 0.92)),
    hslToRgb(h, s, l),
    hslToRgb(h, s, clamp01(l + HIGHLIGHT_OFFSET, 0.08, 0.92))
  ];
}

function packHex(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

function clamp01(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function rgbToHsl(rgb: number): [number, number, number] {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255)
  ];
}
