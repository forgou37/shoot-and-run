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
  type Sim
} from "@shoot-and-run/sim";
import arenaJson from "../../../../content/arenas/arena-001.json";
import playersJson from "../../../../content/players.json";
import tuningJson from "../../../../content/tuning.json";
import { KeyboardInput } from "../input/keyboard";
import { parsePlayersConfig, type PlayerSlotConfig } from "../input/players-config";
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
  private prev!: PrevPositions;

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

    this.keyboard = new KeyboardInput(window);
    this.drawTiles(arena);
    this.entityGfx = this.add.graphics();
    this.overlayText = this.add
      .text(ARENA_WIDTH / 2, ARENA_HEIGHT / 2 - 24, "", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#ffffff"
      })
      .setOrigin(0.5)
      .setVisible(false);

    // Dev-only tuning hot-reload (A9): Vite HMR pushes the edited JSON into
    // the running sim without a page refresh.
    if (import.meta.hot) {
      import.meta.hot.accept("../../../../content/tuning.json", (mod) => {
        if (!mod) return;
        try {
          this.sim.setTuning(parseTuning(mod.default));
          console.log("tuning hot-reloaded");
        } catch (err) {
          console.error("tuning hot-reload rejected:", err);
        }
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.keyboard.dispose());
  }

  override update(_time: number, delta: number): void {
    const alpha = this.driver.advance(delta, () => {
      const inputs = this.slots.map((s) => this.keyboard.sample(s.keys));
      this.prev = this.snapshot();
      const events = this.sim.step(inputs);
      if (import.meta.env.DEV) {
        for (const e of events) console.log("[sim]", JSON.stringify(e));
      }
    });
    this.render(alpha);
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
    const { round } = this.sim.state;
    if (round.phase === "ended") {
      const label =
        round.winner === "draw"
          ? "Draw"
          : `${this.slots.find((s) => s.slot === round.winner)?.name ?? `P${String(round.winner)}`} wins!`;
      this.overlayText.setText(label).setVisible(true);
    } else {
      this.overlayText.setVisible(false);
    }
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
