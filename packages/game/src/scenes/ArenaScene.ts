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
import arenaJson from "../../../../content/arenas/arena-002.json";
import tuningJson from "../../../../content/tuning.json";
import { getAppContext, type AppContext } from "../app-context";
import type { InputDevice } from "../input/device";
import { EdgeReader, type DeviceEdges } from "../input/menu-input";
import type { SlotConfig } from "../input/players-config";
import type { MatchConfig } from "../match-config";
import { parseJuice, type JuiceConfig } from "../juice";
import { FixedStepDriver } from "../loop";
import { ARCHER_TAGS, ArcherRenderer, animKey, loadArcherAssets } from "../render/archer";
import { ArrowRenderer, loadArrowAssets } from "../render/arrows";
import { EnvironmentRenderer, loadEnvironmentAssets } from "../render/environment";

const TILE_COLOR = 0x5a5a6e;
const CHEST_COLOR = 0xd4a017;
const ARROW_COLORS: Record<ArrowKind, number> = {
  normal: 0xf0e6c8,
  bomb: 0xff5252,
  laser: 0x40e8ff,
  bounce: 0xffd740
};
const PAUSE_OPTIONS = ["Resume", "To Lobby", "To Title"] as const;

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
  private matchConfig!: MatchConfig;
  private app!: AppContext;
  private slots!: SlotConfig[];
  /** One input device per slot, assembled by the lobby (or quickstart). */
  private devices!: InputDevice[];
  /** Edge reader for pause-menu navigation (pad Start, jump/shoot/up/down). */
  private edges!: EdgeReader;
  private paused = false;
  private pauseIndex = 0;
  private prevEsc = false;
  private pauseText!: Phaser.GameObjects.Text;
  private readonly driver = new FixedStepDriver();
  private entityGfx!: Phaser.GameObjects.Graphics;
  private overlayText!: Phaser.GameObjects.Text;
  private scoreTexts: Phaser.GameObjects.Text[] = [];
  /** Team round-win readouts, populated only in teams mode. */
  private teamTexts: Phaser.GameObjects.Text[] = [];
  private teamsMode = false;
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
  /** Jungle environment renderer (spec 007); null in `?rects=1` debug mode. */
  private env: EnvironmentRenderer | null = null;
  /** Sprite arrows (spec 007); null in `?rects=1` debug mode. */
  private arrowSprites: ArrowRenderer | null = null;

  constructor() {
    super("arena");
  }

  /** Scenes are singletons reused across matches, so reset all per-match state
   *  here (runs before create on every scene.start). */
  init(data: MatchConfig): void {
    this.matchConfig = data;
    this.edges = new EdgeReader();
    this.paused = false;
    this.pauseIndex = 0;
    this.prevEsc = false;
    this.hitstopRemainingMs = 0;
    this.lastAlpha = 0;
    this.manualMode = false;
    this.eventLog.length = 0;
    this.killEmitters.clear();
  }

  preload(): void {
    loadArcherAssets(this.load);
    loadEnvironmentAssets(this.load);
    loadArrowAssets(this.load);
  }

  create(): void {
    this.app = getAppContext(this);
    const arena = parseArena(arenaJson);
    this.arenaName = arena.name;
    // Roster comes from the lobby (or the quickstart default): slots, devices,
    // teams and friendly fire all flow in through the MatchConfig.
    this.slots = this.matchConfig.roster.map((r) => r.slot);
    this.devices = this.matchConfig.roster.map((r) => r.device);
    this.sim = createSim({
      arena,
      tuning: parseTuning(tuningJson),
      players: this.matchConfig.roster.map((r) =>
        r.team !== null ? { slot: r.slot.slot, team: r.team } : { slot: r.slot.slot }
      ),
      seed: this.matchConfig.seed,
      friendlyFire: this.matchConfig.friendlyFire
    });
    this.prev = this.snapshot();

    this.juice = parseJuice(tuningJson);
    const rectsMode = new URLSearchParams(window.location.search).get("rects") === "1";
    if (rectsMode) {
      this.drawTiles(arena);
    } else {
      this.env = new EnvironmentRenderer(this, arena);
    }
    this.entityGfx = this.add.graphics();
    if (!rectsMode) {
      this.archers = new ArcherRenderer(this, this.slots);
      this.arrowSprites = new ArrowRenderer(this);
    }
    this.createParticles();
    this.overlayText = this.add
      .text(ARENA_WIDTH / 2, ARENA_HEIGHT / 2 - 24, "", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#ffffff"
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);
    // Per-player score chips, evenly spaced along the top edge in slot colors
    // (A3.5). In teams mode they drop a row to clear the team tally above.
    this.teamsMode = this.matchConfig.roster.some((r) => r.team !== null);
    const n = this.slots.length;
    const chipY = this.teamsMode ? 15 : 3;
    this.scoreTexts = this.slots.map((s, i) =>
      this.add
        .text(((i + 0.5) * ARENA_WIDTH) / n, chipY, "", {
          fontFamily: "monospace",
          fontSize: "10px",
          color: s.color
        })
        .setOrigin(0.5, 0)
        .setDepth(20)
    );
    this.teamTexts = [];
    if (this.teamsMode) {
      const teamColor = (team: number): string =>
        this.matchConfig.roster.find((r) => r.team === team)?.slot.color ?? "#ffffff";
      this.teamTexts = [0, 1].map((team) =>
        this.add
          .text(team === 0 ? 4 : ARENA_WIDTH - 4, 2, "", {
            fontFamily: "monospace",
            fontSize: "10px",
            color: teamColor(team)
          })
          .setOrigin(team === 0 ? 0 : 1, 0)
          .setDepth(20)
      );
    }
    this.pauseText = this.add
      .text(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, "", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#ffffff",
        align: "center",
        backgroundColor: "#000000a0",
        padding: { x: 8, y: 6 }
      })
      .setOrigin(0.5)
      .setDepth(30)
      .setVisible(false);

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

    this.installTestApi();
  }

  override update(_time: number, delta: number): void {
    if (this.manualMode) {
      this.render(1);
      return;
    }
    // Pause (Esc / pad Start) is purely shell-side: the accumulator stops
    // advancing, so the sim is untouched and determinism is unaffected.
    const edges = this.edges.read(this.devices);
    const escEdge = this.escEdge();
    if (this.paused) {
      this.updatePauseMenu(edges, escEdge);
      this.render(this.lastAlpha);
      return;
    }
    // An assigned pad dropping out mid-match auto-pauses (A3.2); a disconnected
    // pad also samples neutral, so play can't continue on a dead device.
    const padLost = this.devices.some((d) => d.kind === "pad" && !d.connected);
    if (escEdge || edges.some((e) => e.pause) || padLost) {
      this.openPause();
      this.render(this.lastAlpha);
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

  /** Rising edge of the Escape key (keyboard pause; pads use Start). */
  private escEdge(): boolean {
    const down = this.app.keyboard.isDown("Escape");
    const edge = down && !this.prevEsc;
    this.prevEsc = down;
    return edge;
  }

  private openPause(): void {
    this.paused = true;
    this.pauseIndex = 0;
    this.anims.pauseAll(); // freeze sprite anims with the sim
    this.pauseText.setVisible(true);
    this.renderPauseMenu();
  }

  private resumePause(): void {
    this.paused = false;
    this.anims.resumeAll();
    this.pauseText.setVisible(false);
  }

  private updatePauseMenu(edges: DeviceEdges[], escEdge: boolean): void {
    if (escEdge || edges.some((e) => e.back)) {
      this.resumePause();
      return;
    }
    const n = PAUSE_OPTIONS.length;
    if (edges.some((e) => e.up)) this.pauseIndex = (this.pauseIndex + n - 1) % n;
    if (edges.some((e) => e.down)) this.pauseIndex = (this.pauseIndex + 1) % n;
    if (edges.some((e) => e.joinOrConfirm)) {
      this.confirmPause();
      return;
    }
    this.renderPauseMenu();
  }

  private confirmPause(): void {
    const choice = PAUSE_OPTIONS[this.pauseIndex];
    if (choice === "Resume") this.resumePause();
    else if (choice === "To Lobby") this.scene.start("lobby");
    else this.scene.start("title");
  }

  private renderPauseMenu(): void {
    const menu = PAUSE_OPTIONS.map((o, i) => (i === this.pauseIndex ? `> ${o}` : `  ${o}`));
    this.pauseText.setText(["— PAUSED —", "", ...menu].join("\n"));
  }

  /** One sim tick: sample devices, step, apply FX, record events. The only
   *  place the sim is advanced — both the accumulator and __testApi use it. */
  private readonly doTick = (): void => {
    const inputs = this.devices.map((d) => d.sample());
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
          .filter((k) => /^(archer|jungle|chest|arrow)/.test(k))
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
    // The 1-color particle texture is game-global; only generate it once (it
    // survives scene restarts when returning to a match from the lobby).
    if (!this.textures.exists("px")) {
      const gfx = this.make.graphics();
      gfx.fillStyle(0xffffff);
      gfx.fillRect(0, 0, 2, 2);
      gfx.generateTexture("px", 2, 2);
      gfx.destroy();
    }

    const base = {
      lifespan: { min: 150, max: 400 },
      scale: { start: 1, end: 0 },
      gravityY: 300,
      emitting: false
    };
    this.stickEmitter = this.add
      .particles(0, 0, "px", {
        ...base,
        speed: { min: 20, max: 60 },
        tint: 0xaaaaaa
      })
      .setDepth(10);
    this.bombEmitter = this.add
      .particles(0, 0, "px", {
        ...base,
        speed: { min: 80, max: 240 },
        lifespan: { min: 200, max: 500 },
        tint: [0xffa726, 0xff5252, 0xffffff]
      })
      .setDepth(10);
    for (const s of this.slots) {
      this.killEmitters.set(
        s.slot,
        this.add
          .particles(0, 0, "px", {
            ...base,
            speed: { min: 60, max: 180 },
            tint: Phaser.Display.Color.HexStringToColor(s.color).color
          })
          .setDepth(10)
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
      this.overlayText.setText(this.endLabel(match.winner, round.winner)).setVisible(true);
    } else {
      this.overlayText.setVisible(false);
    }
    this.scoreTexts.forEach((text, i) => {
      const label = `${this.slots[i]!.name} ${String(match.scores[i] ?? 0)}`;
      if (text.text !== label) text.setText(label);
    });
    if (this.teamsMode) {
      const teamScores = match.teamScores ?? [0, 0];
      this.teamTexts.forEach((text, team) => {
        const label = `T${String(team + 1)} ${String(teamScores[team] ?? 0)}`;
        if (text.text !== label) text.setText(label);
      });
    }
    this.entityGfx.clear();
    if (this.env) {
      this.env.updateChests(this.sim.state.chests);
    } else {
      for (const chest of this.sim.state.chests) {
        this.drawWrappedRect(chest.x, chest.y, CHEST_WIDTH, CHEST_HEIGHT, CHEST_COLOR);
      }
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
    this.arrowSprites?.beginFrame();
    for (const a of this.sim.state.arrows) {
      if (a.phase !== "flying" && a.phase !== "stuck") continue;
      const prev = this.prev.arrows.get(a.id) ?? a;
      const x = lerpWrapped(prev.x, a.x, alpha, ARENA_WIDTH);
      const y = lerpWrapped(prev.y, a.y, alpha, ARENA_HEIGHT);
      if (this.arrowSprites) {
        this.arrowSprites.draw(a, x, y);
        continue;
      }
      const color = ARROW_COLORS[a.kind];
      if (a.phase === "flying") {
        const { hw, hh } = arrowHalves(a);
        this.drawWrappedRect(x, y, hw * 2, hh * 2, color);
      } else {
        this.drawWrappedRect(x, y, 4, 4, color);
      }
    }
    this.arrowSprites?.endFrame();
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

  /** Round/match end overlay text. In teams mode the winner id is a team. */
  private endLabel(matchWinner: number | null, roundWinner: number | "draw" | null): string {
    if (matchWinner !== null) {
      return this.teamsMode
        ? `Team ${String(matchWinner + 1)} wins the match!`
        : `${this.slotName(matchWinner)} wins the match!`;
    }
    if (roundWinner === "draw" || roundWinner === null) return "Draw";
    return this.teamsMode
      ? `Team ${String(roundWinner + 1)} wins!`
      : `${this.slotName(roundWinner)} wins!`;
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
