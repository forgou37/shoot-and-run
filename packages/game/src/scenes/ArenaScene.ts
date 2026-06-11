import Phaser from "phaser";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  TILE_SIZE,
  arrowHalves,
  createSim,
  parseArena,
  parseTuning,
  wrapMod,
  type ArenaData,
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

const TILE_COLOR = 0x5a5a6e;
const ARROW_COLOR = 0xf0e6c8;
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
  private killEmitters = new Map<number, Phaser.GameObjects.Particles.ParticleEmitter>();
  private stickEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super("arena");
  }

  create(): void {
    const arena = parseArena(arenaJson);
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
  }

  override update(_time: number, delta: number): void {
    if (this.hitstopRemainingMs > 0) {
      // Hitstop: hold the sim and the interpolation where they are. The
      // camera shake effect still plays — frozen frame + shake reads as impact.
      this.hitstopRemainingMs -= delta;
      this.render(this.lastAlpha);
      return;
    }
    const alpha = this.driver.advance(delta, () => {
      const inputs = this.slots.map((s) => this.keyboard.sample(s.keys));
      this.prev = this.snapshot();
      const events = this.sim.step(inputs);
      this.applyJuice(events);
      if (import.meta.env.DEV) {
        for (const e of events) console.log("[sim]", JSON.stringify(e));
      }
    });
    this.lastAlpha = alpha;
    this.render(alpha);
  }

  private applyJuice(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === "player_killed") {
        this.hitstopRemainingMs = this.juice.hitstopMs;
        this.cameras.main.shake(
          this.juice.shakeDurationMs,
          this.juice.shakeMagnitudePx / ARENA_WIDTH
        );
        this.killEmitters.get(e.victim)?.explode(this.juice.killBurstParticles, e.x, e.y);
      } else if (e.type === "arrow_stuck") {
        this.stickEmitter.explode(this.juice.stickPuffParticles, e.x, e.y);
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
    this.sim.state.players.forEach((p, i) => {
      if (!p.alive) return;
      const prev = this.prev.players[i] ?? p;
      const x = lerpWrapped(prev.x, p.x, alpha, ARENA_WIDTH);
      const y = lerpWrapped(prev.y, p.y, alpha, ARENA_HEIGHT);
      const color = Phaser.Display.Color.HexStringToColor(this.slots[i]!.color).color;
      this.drawWrappedRect(x, y, PLAYER_WIDTH, PLAYER_HEIGHT, color);
    });
    for (const a of this.sim.state.arrows) {
      const prev = this.prev.arrows.get(a.id) ?? a;
      const x = lerpWrapped(prev.x, a.x, alpha, ARENA_WIDTH);
      const y = lerpWrapped(prev.y, a.y, alpha, ARENA_HEIGHT);
      if (a.phase === "flying") {
        const { hw, hh } = arrowHalves(a);
        this.drawWrappedRect(x, y, hw * 2, hh * 2, ARROW_COLOR);
      } else {
        this.drawWrappedRect(x, y, 4, 4, ARROW_COLOR);
      }
    }
  }

  private slotName(slot: number): string {
    return this.slots.find((s) => s.slot === slot)?.name ?? `P${String(slot)}`;
  }

  /** Draw a centered rect, plus mirror copies when it straddles arena edges. */
  private drawWrappedRect(cx: number, cy: number, w: number, h: number, color: number): void {
    const xs = [0];
    const ys = [0];
    if (cx - w / 2 < 0) xs.push(ARENA_WIDTH);
    if (cx + w / 2 > ARENA_WIDTH) xs.push(-ARENA_WIDTH);
    if (cy - h / 2 < 0) ys.push(ARENA_HEIGHT);
    if (cy + h / 2 > ARENA_HEIGHT) ys.push(-ARENA_HEIGHT);
    this.entityGfx.fillStyle(color);
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
