import Phaser from "phaser";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  emptyInput,
  parseArena,
  parseTuning,
  wrapMod,
  type SimState
} from "@shoot-and-run/sim";
import { ClientSession, parseNetParams } from "@shoot-and-run/net";
import arenaJson from "../../../../content/arenas/arena-002.json";
import tuningJson from "../../../../content/tuning.json";
import { getAppContext, type AppContext } from "../app-context";
import type { InputDevice } from "../input/device";
import { EdgeReader } from "../input/menu-input";
import type { SlotConfig } from "../input/players-config";
import { parseJuice, type JuiceConfig } from "../juice";
import { FixedStepDriver } from "../loop";
import { addPixelText } from "../theme";
import { ArcherRenderer, loadArcherAssets } from "../render/archer";
import { ArrowRenderer, loadArrowAssets } from "../render/arrows";
import { BoosterRenderer, loadBoosterAssets } from "../render/boosters";
import { EnvironmentRenderer, loadEnvironmentAssets } from "../render/environment";
import { WebSocketTransport } from "../net/websocket-transport";

interface OnlineConfig {
  /** ws://host:port of the dedicated host (spec 010). */
  url: string;
  /** Join as a spectator — watch only, no slot, no input (spec 013, T13.2). */
  spectate?: boolean;
}

interface PrevPositions {
  players: { x: number; y: number }[];
  arrows: Map<number, { x: number; y: number }>;
}

/**
 * Online match scene (spec 010, T10.5). Unlike ArenaScene it does NOT own a sim:
 * it drives a `ClientSession` (clock + predict/rollback over a real WebSocket) on
 * the same fixed-timestep accumulator, sampling the local device for its slot,
 * and renders the session's PREDICTED state through the existing renderers with
 * the existing wrap-aware interpolation. Tuning is pinned at init — no hot-reload
 * in a net session (amendment #4). No local hitstop: freezing the client clock
 * would desync it from the host, so juice is limited to state/event-driven anims.
 */
export class OnlineArenaScene extends Phaser.Scene {
  private app!: AppContext;
  private cfg!: OnlineConfig;
  private transport!: WebSocketTransport;
  private session!: ClientSession;
  private localDevice!: InputDevice;
  private slots!: SlotConfig[];
  private juice!: JuiceConfig;
  private readonly driver = new FixedStepDriver();

  private env!: EnvironmentRenderer;
  private archers!: ArcherRenderer;
  private arrowSprites!: ArrowRenderer;
  private boosters!: BoosterRenderer;
  private statusText!: Phaser.GameObjects.BitmapText;
  private overlayText!: Phaser.GameObjects.BitmapText;
  private scoreTexts: Phaser.GameObjects.BitmapText[] = [];
  private hudBuilt = false;

  private prev: PrevPositions | null = null;
  private disconnected = false;
  /** Edge reader for "press to return to the menu" in the error states. */
  private edges!: EdgeReader;
  private prevReturnKey = false;
  /** Dev-only: confirmed-state hashes by tick, for the two-tab convergence probe. */
  private readonly confirmedHashes = new Map<number, number>();

  constructor() {
    super("online");
  }

  init(data: OnlineConfig): void {
    this.cfg = data;
    this.prev = null;
    this.disconnected = false;
    this.prevReturnKey = false;
    this.hudBuilt = false;
    this.scoreTexts = [];
    this.confirmedHashes.clear();
  }

  preload(): void {
    loadArcherAssets(this.load);
    loadEnvironmentAssets(this.load);
    loadArrowAssets(this.load);
    loadBoosterAssets(this.load);
  }

  create(): void {
    this.app = getAppContext(this);
    this.edges = new EdgeReader();
    this.slots = this.app.slots;
    const arena = parseArena(arenaJson);
    const tuning = parseTuning(tuningJson);
    const net = parseNetParams(tuningJson);
    this.juice = parseJuice(tuningJson);

    this.env = new EnvironmentRenderer(this, arena);
    this.archers = new ArcherRenderer(this, this.slots);
    this.arrowSprites = new ArrowRenderer(this);
    this.boosters = new BoosterRenderer(
      this,
      this.juice.boosterBobAmplitudePx,
      this.juice.boosterBobPeriodMs,
      tuning.boosterFloatOffsetPx
    );

    // Local input: the first keyboard profile in this tab (each tab/machine has
    // its own). Online play binds one device per browser, not a lobby roster.
    this.localDevice =
      this.app.manager.devices().find((d) => d.kind === "keyboard") ??
      this.app.manager.devices()[0]!;

    this.transport = new WebSocketTransport(this.cfg.url);
    this.transport.onClose(() => {
      this.disconnected = true;
    });
    this.session = new ClientSession({
      transport: this.transport,
      arena,
      tuning,
      role: this.cfg.spectate ? "spectator" : "player",
      inputDelayTicks: net.inputDelayTicks,
      maxRollbackTicks: net.maxRollbackTicks
    });

    this.statusText = addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT / 2, "Connecting…", 11, "#ffffff", {
      align: "center"
    })
      .setOrigin(0.5)
      .setDepth(30);
    this.overlayText = addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT / 2 - 24, "", 22, "#ffffff")
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);

    if (this.cfg.spectate) {
      addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT - 10, "SPECTATING", 9, "#9aa0b5")
        .setOrigin(0.5)
        .setDepth(30);
    }

    this.installTestApi();
  }

  override update(_time: number, delta: number): void {
    // Version mismatch wins over "disconnected" (the refusal closes the socket,
    // which also flags disconnected) — show the actionable message.
    if (this.session.versionMismatch) {
      this.statusText.setText("Version mismatch\nrefresh the page · space for menu").setVisible(true);
      this.handleReturnToMenu();
      return;
    }
    if (this.disconnected) {
      this.statusText.setText("Disconnected\nspace for menu").setVisible(true);
      this.handleReturnToMenu();
      return;
    }
    const alpha = this.driver.advance(delta, this.doNetTick);
    this.render(alpha);
  }

  /** In an error state, a confirm/back press returns to the join menu with the
   *  host URL pre-filled so the player can retry or edit it. */
  private handleReturnToMenu(): void {
    const kDown =
      this.app.keyboard.isDown("Space") ||
      this.app.keyboard.isDown("Enter") ||
      this.app.keyboard.isDown("Escape");
    const keyEdge = kDown && !this.prevReturnKey;
    this.prevReturnKey = kDown;
    const dev = this.edges.read(this.app.manager.devices());
    if (keyEdge || dev.some((e) => e.joinOrConfirm || e.back || e.pause)) {
      this.scene.start("online-join", { url: this.cfg.url, spectate: this.cfg.spectate });
    }
  }

  /** One fixed step: sample the local input, predict + send via the session. */
  private readonly doNetTick = (): void => {
    const before = this.session.predictedState();
    const beforeTick = this.session.predictedTick;
    this.prev = before ? this.snapshotPositions(before) : null;
    // A spectator feeds no input (the session ignores it and sends nothing).
    const input = this.cfg.spectate ? emptyInput() : this.localDevice.sample();
    const events = this.session.tick(input);
    // A single tick() can advance prediction by >1 tick (startup lead, or
    // catch-up after a rollback-cap stall). One `prev` can't interpolate a
    // multi-tick jump, so snap to the current state instead of smearing across it.
    if (this.session.predictedTick - beforeTick > 1) this.prev = null;
    if (events.length > 0) {
      this.archers.onEvents(events);
      this.boosters.onEvents(events);
    }
    this.recordConfirmedHash();
  };

  private snapshotPositions(state: Readonly<SimState>): PrevPositions {
    return {
      players: state.players.map((p) => ({ x: p.x, y: p.y })),
      arrows: new Map(state.arrows.map((a) => [a.id, { x: a.x, y: a.y }]))
    };
  }

  private render(alpha: number): void {
    const state = this.session.predictedState();
    if (!state) {
      this.statusText.setText("Connecting…").setVisible(true);
      return;
    }
    if (!this.session.ready || this.session.confirmedTick === 0) {
      this.statusText.setText(this.waitingLabel()).setVisible(true);
    } else {
      this.statusText.setVisible(false);
    }
    if (!this.hudBuilt) this.buildHud(state.players.length);

    if (state.round.phase === "ended") {
      this.overlayText.setText(this.endLabel(state)).setVisible(true);
    } else {
      this.overlayText.setVisible(false);
    }
    this.scoreTexts.forEach((t, i) => {
      const label = `${this.slots[i]!.name} ${String(state.match.scores[i] ?? 0)}`;
      if (t.text !== label) t.setText(label);
    });

    this.env.updateChests(state.chests);
    this.boosters.beginFrame();
    for (const b of state.boosters) this.boosters.draw(b);
    this.boosters.endFrame();
    state.players.forEach((p, i) => {
      const prev = this.prev?.players[i] ?? p;
      const x = lerpWrapped(prev.x, p.x, alpha, ARENA_WIDTH);
      const y = lerpWrapped(prev.y, p.y, alpha, ARENA_HEIGHT);
      const a = p.invisibleTicksLeft > 0 ? this.juice.invisibilityOpacity : 1;
      this.archers.update(p, i, x, y, a);
    });

    this.arrowSprites.beginFrame();
    for (const ar of state.arrows) {
      if (ar.phase !== "flying" && ar.phase !== "stuck") continue;
      const prev = this.prev?.arrows.get(ar.id) ?? ar;
      const x = lerpWrapped(prev.x, ar.x, alpha, ARENA_WIDTH);
      const y = lerpWrapped(prev.y, ar.y, alpha, ARENA_HEIGHT);
      this.arrowSprites.draw(ar, x, y);
    }
    this.arrowSprites.endFrame();
  }

  /** Pre-match status: connecting → "waiting for players n/N" once the host's
   *  hello + lobby status arrive (T11.3). */
  private waitingLabel(): string {
    if (!this.session.ready) return "Connecting…";
    const lobby = this.session.lobbyStatus;
    return lobby
      ? `Waiting for players ${String(lobby.connected)}/${String(lobby.expected)}…`
      : "Waiting for host…";
  }

  private buildHud(playerCount: number): void {
    const n = Math.min(playerCount, this.slots.length);
    this.scoreTexts = Array.from({ length: n }, (_, i) =>
      addPixelText(this, ((i + 0.5) * ARENA_WIDTH) / n, 3, "", 10, this.slots[i]!.color)
        .setOrigin(0.5, 0)
        .setDepth(20)
    );
    this.hudBuilt = true;
  }

  private endLabel(state: Readonly<SimState>): string {
    const name = (slot: number | null): string =>
      slot === null ? "" : (this.slots.find((s) => s.slot === slot)?.name ?? `P${String(slot)}`);
    if (state.match.winner !== null) return `${name(state.match.winner)} wins the match!`;
    const w = state.round.winner;
    if (w === "draw" || w === null) return "Draw";
    return `${name(w)} wins!`;
  }

  /** Record the confirmed-state hash at each newly confirmed tick (dev probe). */
  private recordConfirmedHash(): void {
    if (!import.meta.env.DEV || !this.session.ready) return;
    const ct = this.session.confirmedTick;
    if (this.confirmedHashes.has(ct)) return;
    const snap = this.session.snapshotConfirmed();
    if (snap) this.confirmedHashes.set(ct, fnv1a(JSON.stringify(snap)));
    if (this.confirmedHashes.size > 800) {
      const oldest = this.confirmedHashes.keys().next().value;
      if (oldest !== undefined) this.confirmedHashes.delete(oldest);
    }
  }

  private installTestApi(): void {
    if (!import.meta.env.DEV) return;
    const api = window.__testApi;
    if (!api) return;
    api.getState = () => this.session.predictedState() ?? ({ players: [], arrows: [], chests: [] } as unknown as SimState);
    api.getNetProbe = () => ({
      ready: this.session.ready,
      confirmedTick: this.session.confirmedTick,
      predictedTick: this.session.predictedTick,
      confirmedHash: this.confirmedHashes.get(this.session.confirmedTick) ?? 0
    });
    api.getConfirmedHashAt = (tick: number) => this.confirmedHashes.get(tick) ?? null;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      const a = window.__testApi;
      if (!a) return;
      delete a.getState;
      delete a.getNetProbe;
      delete a.getConfirmedHashAt;
      this.transport.close();
    });
  }
}

/** FNV-1a, 32-bit — same construction as the sim's cross-engine guard, so two
 *  tabs' confirmed snapshots hash identically when byte-identical. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Interpolate along the shortest path on a wrapping axis. */
function lerpWrapped(prev: number, curr: number, alpha: number, range: number): number {
  let d = curr - prev;
  if (d > range / 2) d -= range;
  if (d < -range / 2) d += range;
  return wrapMod(prev + d * alpha, range);
}
