import Phaser from "phaser";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  CHEST_HEIGHT,
  CHEST_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  TILE_SIZE,
  arrowHalves,
  createSim,
  parseArena,
  parseTuning,
  wrapMod,
  type ArenaData,
  type ArrowKind,
  type Sim,
  type SimEvent
} from "@shoot-and-run/sim";
import arenaJson from "../../../../content/arenas/arena-001.json";
import playersJson from "../../../../content/players.json";
import tuningJson from "../../../../content/tuning.json";
import { KeyboardInput } from "../input/keyboard";
import { parsePlayersConfig, type PlayerSlotConfig } from "../input/players-config";
import { parseJuice, type JuiceConfig } from "../juice";
import { FixedStepDriver } from "../loop";
import { ARCHER_TAGS, ArcherRenderer, animKey, loadArcherAssets } from "../render/archer";

const TILE_COLOR = 0x5a5a6e;
const CHEST_COLOR = 0xd4a017;
const ARROW_COLORS: Record<ArrowKind, number> = {
  normal: 0xf0e6c8,
  bomb: 0xff5252,
  laser: 0x40e8ff,
  bounce: 0xffd740
};
const SIM_SEED = 1;

interface PrevPositions {
  players: { x: number; y: number }[];
  arrows: Map<number, { x: number; y: number }>;
}

/**
 * The entire shell: drives the sim on a fixed timestep and renders its state
 * as colored rects. No game logic lives here — render code only READS
 * sim.state (hard rule: no game logic in render callbacks).
 */
export class ArenaScene extends Phaser.Scene {
  private sim!: Sim;
  private slots!: PlayerSlotConfig[];
  private keyboard!: KeyboardInput;
  private readonly driver = new FixedStepDriver();
  private entityGfx!: Phaser.GameObjects.Graphics;
  private overlayText!: Phaser.GameObjects.Text;
  private scoreTexts: Phaser.GameObjects.Text[] = [];
  private prev!: PrevPositions;
  private juice!: JuiceConfig;
  private hitstopRemainingMs = 0;
  private lastAlpha = 0;
  private manualMode = false;
  private arenaName = "";
  private readonly eventLog: SimEvent[] = [];
  private killEmitters = new Map<number, Phaser.GameObjects.Particles.ParticleEmitter>();
  private stickEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bombEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Sprite renderer (spec 006); null in `?rects=1` debug mode. */
  private archers: ArcherRenderer | null = null;

  constructor() {
    super("arena");
  }

  preload(): void {
    loadArcherAssets(this.load);
  }

  create(): void {
    const arena = parseArena(arenaJson);
    this.arenaName = arena.name;
    // Spec 000: two keyboard players.
    this.slots = parsePlayersConfig(playersJson).slice(0, 2);
    this.sim = createSim({
      arena,
      tuning: parseTuning(tuningJson),
      players: this.slots.map((s) => ({ slot: s.slot })),
      seed: SIM_SEED
    });
    this.prev = this.snapshot();

    this.juice = parseJuice(tuningJson);
    this.keyboard = new KeyboardInput(window);
    this.drawTiles(arena);
    this.entityGfx = this.add.graphics();
    const rectsMode = new URLSearchParams(window.location.search).get("rects") === "1";
    if (!rectsMode) this.archers = new ArcherRenderer(this, this.slots);
    this.createParticles();
    this.overlayText = this.add
      .text(ARENA_WIDTH / 2, ARENA_HEIGHT / 2 - 24, "", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#ffffff"
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.scoreTexts = this.slots.map((s, i) =>
      this.add
        .text(i === 0 ? 4 : ARENA_WIDTH - 4, 3, "", {
          fontFamily: "monospace",
          fontSize: "10px",
          color: s.color
        })
        .setOrigin(i === 0 ? 0 : 1, 0)
    );

    // Dev-only tuning hot-reload (A9): Vite HMR pushes the edited JSON into
    // the running sim without a page refresh.
    if (import.meta.hot) {
      import.meta.hot.accept("../../../../content/tuning.json", (mod) => {
        if (!mod) return;
        try {
          this.sim.setTuning(parseTuning(mod.default));
          this.juice = parseJuice(mod.default);
          console.log("tuning hot-reloaded");
        } catch (err) {
          console.error("tuning hot-reload rejected:", err);
        }
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.keyboard.dispose());
    this.installTestApi();
  }

  override update(_time: number, delta: number): void {
    if (this.manualMode) {
      this.render(1);
      return;
    }
    if (this.hitstopRemainingMs > 0) {
      // Hitstop: hold the sim and the interpolation where they are. The
      // camera shake effect still plays — frozen frame + shake reads as impact.
      this.hitstopRemainingMs -= delta;
      if (this.hitstopRemainingMs <= 0) this.anims.resumeAll();
      this.render(this.lastAlpha);
      return;
    }
    const alpha = this.driver.advance(delta, this.doTick);
    this.lastAlpha = alpha;
    this.render(alpha);
  }

  /** One sim tick: sample devices, step, apply FX, record events. The only
   *  place the sim is advanced — both the accumulator and __testApi use it. */
  private readonly doTick = (): void => {
    const inputs = this.slots.map((s) => this.keyboard.sample(s.keys));
    this.prev = this.snapshot();
    const events = this.sim.step(inputs);
    this.applyJuice(events);
    this.archers?.onEvents(events);
    if (events.length > 0) {
      this.eventLog.push(...events);
      if (this.eventLog.length > 1000) {
        this.eventLog.splice(0, this.eventLog.length - 1000);
      }
      if (import.meta.env.DEV) {
        for (const e of events) console.log("[sim]", JSON.stringify(e));
      }
    }
  };

  private installTestApi(): void {
    if (!import.meta.env.DEV) return;
    window.__testApi = {
      getState: () => this.sim.state,
      getArenaName: () => this.arenaName,
      getEvents: () => [...this.eventLog],
      setManual: (on: boolean) => {
        this.manualMode = on;
      },
      stepTicks: (n: number) => {
        for (let i = 0; i < n; i++) this.doTick();
        this.render(1);
      },
      getSpriteProbe: () => ({
        textures: this.textures
          .getTextureKeys()
          .filter((k) => k.startsWith("archer"))
          .sort(),
        missingAnims: this.slots.flatMap((s) =>
          ARCHER_TAGS.filter((t) => !this.anims.exists(animKey(s.slot, t))).map((t) =>
            animKey(s.slot, t)
          )
        )
      })
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      delete window.__testApi;
    });
  }

  private applyJuice(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === "player_killed") {
        this.hitstopRemainingMs = this.juice.hitstopMs;
        // Sprite animations are driven by Phaser's clock, not the sim
        // accumulator — freeze them too so the hitstop frame truly holds.
        this.anims.pauseAll();
        this.cameras.main.shake(
          this.juice.shakeDurationMs,
          this.juice.shakeMagnitudePx / ARENA_WIDTH
        );
        this.killEmitters.get(e.victim)?.explode(this.juice.killBurstParticles, e.x, e.y);
      } else if (e.type === "arrow_stuck") {
        this.stickEmitter.explode(this.juice.stickPuffParticles, e.x, e.y);
      } else if (e.type === "arrow_exploded") {
        this.bombEmitter.explode(this.juice.bombBurstParticles, e.x, e.y);
        this.cameras.main.shake(
          this.juice.shakeDurationMs * 1.5,
          (this.juice.shakeMagnitudePx * 2) / ARENA_WIDTH
        );
      }
    }
  }

  private createParticles(): void {
    const gfx = this.make.graphics();
    gfx.fillStyle(0xffffff);
    gfx.fillRect(0, 0, 2, 2);
    gfx.generateTexture("px", 2, 2);
    gfx.destroy();

    const base = {
      lifespan: { min: 150, max: 400 },
      scale: { start: 1, end: 0 },
      gravityY: 300,
      emitting: false
    };
    this.stickEmitter = this.add.particles(0, 0, "px", {
      ...base,
      speed: { min: 20, max: 60 },
      tint: 0xaaaaaa
    });
    this.bombEmitter = this.add.particles(0, 0, "px", {
      ...base,
      speed: { min: 80, max: 240 },
      lifespan: { min: 200, max: 500 },
      tint: [0xffa726, 0xff5252, 0xffffff]
    });
    for (const s of this.slots) {
      this.killEmitters.set(
        s.slot,
        this.add.particles(0, 0, "px", {
          ...base,
          speed: { min: 60, max: 180 },
          tint: Phaser.Display.Color.HexStringToColor(s.color).color
        })
      );
    }
  }

  private snapshot(): PrevPositions {
    return {
      players: this.sim.state.players.map((p) => ({ x: p.x, y: p.y })),
      arrows: new Map(this.sim.state.arrows.map((a) => [a.id, { x: a.x, y: a.y }]))
    };
  }

  private drawTiles(arena: ArenaData): void {
    const gfx = this.add.graphics();
    gfx.fillStyle(TILE_COLOR);
    arena.tiles.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === "#") {
          gfx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    });
  }

  private render(alpha: number): void {
    const { round, match } = this.sim.state;
    if (round.phase === "ended") {
      const label =
        match.winner !== null
          ? `${this.slotName(match.winner)} wins the match!`
          : round.winner === "draw"
            ? "Draw"
            : `${this.slotName(round.winner!)} wins!`;
      this.overlayText.setText(label).setVisible(true);
    } else {
      this.overlayText.setVisible(false);
    }
    this.scoreTexts.forEach((text, i) => {
      const label = `${this.slots[i]!.name} ${String(match.scores[i] ?? 0)}`;
      if (text.text !== label) text.setText(label);
    });
    this.entityGfx.clear();
    for (const chest of this.sim.state.chests) {
      this.drawWrappedRect(chest.x, chest.y, CHEST_WIDTH, CHEST_HEIGHT, CHEST_COLOR);
    }
    this.sim.state.players.forEach((p, i) => {
      const prev = this.prev.players[i] ?? p;
      const x = lerpWrapped(prev.x, p.x, alpha, ARENA_WIDTH);
      const y = lerpWrapped(prev.y, p.y, alpha, ARENA_HEIGHT);
      const playerAlpha = p.invisibleTicksLeft > 0 ? this.juice.invisibilityOpacity : 1;
      if (this.archers) {
        this.archers.update(p, i, x, y, playerAlpha);
        if (p.alive) this.drawQuiverDots(p.quiver, x, y, playerAlpha);
        return;
      }
      if (!p.alive) return;
      const color = Phaser.Display.Color.HexStringToColor(this.slots[i]!.color).color;
      this.drawWrappedRect(x, y, PLAYER_WIDTH, PLAYER_HEIGHT, color, playerAlpha);
      this.drawQuiverDots(p.quiver, x, y, playerAlpha);
    });
    for (const a of this.sim.state.arrows) {
      const prev = this.prev.arrows.get(a.id) ?? a;
      const x = lerpWrapped(prev.x, a.x, alpha, ARENA_WIDTH);
      const y = lerpWrapped(prev.y, a.y, alpha, ARENA_HEIGHT);
      const color = ARROW_COLORS[a.kind];
      if (a.phase === "flying") {
        const { hw, hh } = arrowHalves(a);
        this.drawWrappedRect(x, y, hw * 2, hh * 2, color);
      } else if (a.phase === "stuck") {
        this.drawWrappedRect(x, y, 4, 4, color);
      }
    }
  }

  /** Ammo readout: one dot per arrow, colored by kind, above the head.
   *  Shares the player's alpha so invisibility hides it too. */
  private drawQuiverDots(quiver: readonly ArrowKind[], x: number, y: number, alpha: number): void {
    const shown = Math.min(quiver.length, 6);
    const totalWidth = shown * 3 - 1;
    for (let i = 0; i < shown; i++) {
      this.entityGfx.fillStyle(ARROW_COLORS[quiver[i]!], alpha);
      this.entityGfx.fillRect(
        x - totalWidth / 2 + i * 3,
        y - PLAYER_HEIGHT / 2 - 5,
        2,
        2
      );
    }
  }

  private slotName(slot: number): string {
    return this.slots.find((s) => s.slot === slot)?.name ?? `P${String(slot)}`;
  }

  /** Draw a centered rect, plus mirror copies when it straddles arena edges. */
  private drawWrappedRect(
    cx: number,
    cy: number,
    w: number,
    h: number,
    color: number,
    alpha = 1
  ): void {
    const xs = [0];
    const ys = [0];
    if (cx - w / 2 < 0) xs.push(ARENA_WIDTH);
    if (cx + w / 2 > ARENA_WIDTH) xs.push(-ARENA_WIDTH);
    if (cy - h / 2 < 0) ys.push(ARENA_HEIGHT);
    if (cy + h / 2 > ARENA_HEIGHT) ys.push(-ARENA_HEIGHT);
    this.entityGfx.fillStyle(color, alpha);
    for (const dx of xs) {
      for (const dy of ys) {
        this.entityGfx.fillRect(cx + dx - w / 2, cy + dy - h / 2, w, h);
      }
    }
  }
}

/** Interpolate along the shortest path on a wrapping axis. */
function lerpWrapped(prev: number, curr: number, alpha: number, range: number): number {
  let d = curr - prev;
  if (d > range / 2) d -= range;
  if (d < -range / 2) d += range;
  return wrapMod(prev + d * alpha, range);
}
