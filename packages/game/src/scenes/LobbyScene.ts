import { botDifficulty } from "@shoot-and-run/bots";
import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH } from "@shoot-and-run/sim";
import { getAppContext, type AppContext } from "../app-context";
import { BotDevice } from "../input/bot-device";
import type { InputDevice } from "../input/device";
import { EdgeReader } from "../input/menu-input";
import type { MatchConfig, RosterEntry } from "../match-config";
import { CardOverlay } from "../render/card-overlay";
import { cardImageUrl } from "../render/cards";
import { addPixelText } from "../theme";

type Mode = "ffa" | "teams";

interface Entry {
  device: InputDevice;
  /** Claimed slot index (0..3) → player identity from players.json. */
  slotIndex: number;
  ready: boolean;
  team: 0 | 1;
}

/** A bot occupying a slot. Not a real device — its BotDevice is built only when
 *  the match starts, so difficulty can be re-cycled in the lobby up to then. */
interface BotSlot {
  difficultyName: string;
  team: 0 | 1;
}

const MAX_SLOTS = 4;
/** Shell-chosen seeds for lobby-started matches need only be distinct per run;
 *  Date.now is fine here (this is the shell, not the deterministic sim). */
const seedNow = (): number => Date.now() & 0x7fffffff;

// Card layout in the 320×240 logical buffer: four columns evenly spread (side
// margins ≈ inter-card gaps). The illustrated cards are tall narrow banners; the
// rects below are their footprint in logical space, but the art itself is drawn
// by a hi-res DOM overlay (see render/card-overlay.ts), not through the buffer,
// so it stays crisp. The pixel UI (status text, highlight borders) uses these
// same rects to line up with the overlaid cards.
const CARD_W = 42;
const CARD_H = 150;
const CARD_GAP = 30;
const CARD_MARGIN = (ARENA_WIDTH - MAX_SLOTS * CARD_W - (MAX_SLOTS - 1) * CARD_GAP) / 2;
const CARD_TOP = 16;
// The frame/portrait fills the card; status/device chip stack just beneath it.
const STATUS_Y = CARD_TOP + CARD_H + 2;
const CHIP_Y = STATUS_Y + 10;

const COLOR_TEXT = "#f0e6c8";
const COLOR_MUTED = "#6a708a";
const COLOR_READY = "#8bff7a";
const COLOR_BOT = "#b39ddb";

const cardLeft = (i: number): number => CARD_MARGIN + i * (CARD_W + CARD_GAP);
const cardCenter = (i: number): number => cardLeft(i) + CARD_W / 2;
const hexToInt = (hex: string): number => parseInt(hex.replace("#", ""), 16);

/** Compact device tag for a card chip, e.g. "KEY 1" / "PAD 2". */
function deviceLabel(device: InputDevice): string {
  const n = Number(device.id.split(":")[1] ?? "0") + 1;
  return `${device.kind === "keyboard" ? "KEY" : "PAD"} ${String(n)}`;
}

/**
 * "Press a button to join" lobby (A3.4, extended for bots in spec 004). Each
 * unassigned device joins by pressing jump and claims the lowest free slot;
 * jump toggles ready, shoot steps back (ready→unready→leave). The first joined
 * human is the controller: up cycles mode, down toggles friendly fire (teams)
 * or cycles bot difficulty (FFA), and left/right add/remove computer players in
 * the free slots. Other joined-unready humans switch team with left/right.
 * With ≥2 participants (humans + bots) and all humans ready, a countdown starts
 * the match. Bots are always ready and count toward the participant total, so a
 * lone human can start a match against bots. Rendered as four illustrated
 * character-select cards (owner-supplied art) with the slot name + device-or-
 * BOT/difficulty line beneath each.
 */
export class LobbyScene extends Phaser.Scene {
  private app!: AppContext;
  private edges!: EdgeReader;
  private entries!: Map<string, Entry>;
  /** Bots by claimed slot index (parallel to `entries`, which holds humans). */
  private bots!: Map<number, BotSlot>;
  private difficultyNames!: string[];
  private difficultyIndex!: number;
  private mode!: Mode;
  private friendlyFire!: boolean;
  private countdownMsLeft!: number | null;
  // Persistent card display objects, rebuilt only in create(); render() mutates them.
  private frameGfx!: Phaser.GameObjects.Graphics;
  // Hi-res card art lives in a DOM layer over the canvas, not on the display list.
  private cardOverlay!: CardOverlay;
  private statuses!: Phaser.GameObjects.BitmapText[];
  private chips!: Phaser.GameObjects.BitmapText[];
  private headerIdle!: Phaser.GameObjects.BitmapText;
  private headerFight!: Phaser.GameObjects.BitmapText;
  private modeLine!: Phaser.GameObjects.BitmapText;
  private hintMode!: Phaser.GameObjects.BitmapText;

  constructor() {
    super("lobby");
  }

  create(): void {
    this.app = getAppContext(this);
    this.edges = new EdgeReader();
    this.entries = new Map();
    this.bots = new Map();
    this.difficultyNames = Object.keys(this.app.botConfig.difficulties);
    this.difficultyIndex = Math.max(0, this.difficultyNames.indexOf("normal"));
    this.mode = "ffa";
    this.friendlyFire = false;
    this.countdownMsLeft = null;
    this.cameras.main.setBackgroundColor("#10121f");

    this.headerIdle = addPixelText(this, ARENA_WIDTH / 2, 4, "CHOOSE YOUR FIGHTER", 11, COLOR_TEXT)
      .setOrigin(0.5, 0);
    this.headerFight = addPixelText(this, ARENA_WIDTH / 2, 2, "FIGHT!", 18, "#ffd24a")
      .setOrigin(0.5, 0)
      .setVisible(false);

    // Behind the cards/text (added first → lowest on the display list); holds the
    // ready/bot highlight outline drawn around each occupied card.
    this.frameGfx = this.add.graphics();

    this.statuses = [];
    this.chips = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const cx = cardCenter(i);
      this.statuses.push(addPixelText(this, cx, STATUS_Y, "", 8, COLOR_MUTED));
      this.chips.push(addPixelText(this, cx, CHIP_Y, "", 8, COLOR_MUTED));
    }

    // Hi-res card art as a DOM layer over the canvas (see CardOverlay), built from
    // the same logical rects the pixel UI lines up against, and torn down when the
    // lobby hands off to the match or is otherwise shut down.
    this.cardOverlay = new CardOverlay(
      this.game.canvas,
      Array.from({ length: MAX_SLOTS }, (_, i) => cardImageUrl(this.app.slots[i]?.name ?? "")),
      Array.from({ length: MAX_SLOTS }, (_, i) => ({ x: cardLeft(i), y: CARD_TOP, w: CARD_W, h: CARD_H }))
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cardOverlay.destroy());

    this.modeLine = addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT - 50, "", 9, COLOR_TEXT);
    addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT - 36, "jump=join/ready   shoot=back", 8, COLOR_MUTED)
      .setOrigin(0.5, 0);
    addPixelText(
      this,
      ARENA_WIDTH / 2,
      ARENA_HEIGHT - 25,
      "*first player: up=mode  L/R=add/remove bot",
      8,
      COLOR_MUTED
    ).setOrigin(0.5, 0);
    this.hintMode = addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT - 14, "", 8, COLOR_MUTED);

    this.render();
  }

  override update(_time: number, delta: number): void {
    const devices = this.app.manager.devices();
    this.pruneDisconnected(devices);

    for (const e of this.edges.read(devices)) {
      const entry = this.entries.get(e.device.id);
      if (!entry) {
        if (e.joinOrConfirm) this.join(e.device);
        continue;
      }
      if (e.back) {
        this.back(entry);
        continue;
      }
      if (e.joinOrConfirm) entry.ready = !entry.ready;
      if (this.isController(entry)) {
        if (e.up) this.cycleMode();
        if (e.down) this.controllerDown();
        if (e.right) this.addBot();
        if (e.left) this.removeBot();
      } else if (this.mode === "teams" && !entry.ready && (e.left || e.right)) {
        entry.team = entry.team === 0 ? 1 : 0;
      }
    }

    this.updateCountdown(delta);
    this.render();
  }

  /** Lowest unclaimed slot across humans and bots, or null if the lobby is full. */
  private lowestFreeSlot(): number | null {
    const used = new Set<number>([
      ...[...this.entries.values()].map((e) => e.slotIndex),
      ...this.bots.keys()
    ]);
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (!used.has(i)) return i;
    }
    return null;
  }

  private participantCount(): number {
    return this.entries.size + this.bots.size;
  }

  private currentDifficulty(): string {
    return this.difficultyNames[this.difficultyIndex]!;
  }

  private join(device: InputDevice): void {
    const slot = this.lowestFreeSlot();
    if (slot !== null) {
      this.entries.set(device.id, { device, slotIndex: slot, ready: false, team: (slot % 2) as 0 | 1 });
    }
  }

  /** Back out one step: ready→unready, else leave the lobby entirely. */
  private back(entry: Entry): void {
    if (entry.ready) {
      entry.ready = false;
      return;
    }
    this.entries.delete(entry.device.id);
    this.edges.forget(entry.device.id);
    this.maybeDowngradeTeams();
  }

  private addBot(): void {
    const slot = this.lowestFreeSlot();
    if (slot !== null) {
      this.bots.set(slot, { difficultyName: this.currentDifficulty(), team: (slot % 2) as 0 | 1 });
    }
  }

  /** Remove the highest-slot bot (last added). */
  private removeBot(): void {
    const slots = [...this.bots.keys()].sort((a, b) => b - a);
    if (slots.length > 0) {
      this.bots.delete(slots[0]!);
      this.maybeDowngradeTeams();
    }
  }

  /** Controller `down`: friendly-fire toggle in teams, bot-difficulty cycle in FFA. */
  private controllerDown(): void {
    if (this.mode === "teams") {
      this.friendlyFire = !this.friendlyFire;
    } else {
      this.cycleDifficulty();
    }
  }

  private cycleDifficulty(): void {
    if (this.difficultyNames.length === 0) return;
    this.difficultyIndex = (this.difficultyIndex + 1) % this.difficultyNames.length;
    const name = this.currentDifficulty();
    for (const b of this.bots.values()) b.difficultyName = name; // apply to existing bots too
  }

  /** The lowest-slot human owns the mode/FF/bot toggles (a bot can't press keys,
   *  so the controller is always a human even if a bot holds a lower slot). */
  private controllerSlot(): number | null {
    const slots = [...this.entries.values()].map((e) => e.slotIndex);
    return slots.length > 0 ? Math.min(...slots) : null;
  }

  private isController(entry: Entry): boolean {
    return entry.slotIndex === this.controllerSlot();
  }

  private cycleMode(): void {
    if (this.mode === "ffa") {
      if (this.participantCount() >= 3) this.setMode("teams"); // teams needs ≥3
    } else {
      this.setMode("ffa");
    }
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.countdownMsLeft = null;
    // A mode change invalidates readiness; re-seed teams by slot parity.
    for (const e of this.entries.values()) {
      e.ready = false;
      if (mode === "teams") e.team = (e.slotIndex % 2) as 0 | 1;
    }
    for (const [slot, b] of this.bots) {
      if (mode === "teams") b.team = (slot % 2) as 0 | 1;
    }
    if (mode === "teams") this.friendlyFire = false; // FF defaults off in teams
  }

  private maybeDowngradeTeams(): void {
    if (this.mode === "teams" && this.participantCount() < 3) this.setMode("ffa");
  }

  private pruneDisconnected(devices: readonly InputDevice[]): void {
    const live = new Set(devices.map((d) => d.id));
    for (const id of [...this.entries.keys()]) {
      if (!live.has(id)) {
        this.entries.delete(id);
        this.edges.forget(id);
      }
    }
    this.maybeDowngradeTeams();
  }

  private updateCountdown(delta: number): void {
    const humans = [...this.entries.values()];
    const teams = [...humans.map((e) => e.team), ...[...this.bots.values()].map((b) => b.team)];
    // Bots are always ready; the match needs ≥2 participants and every human ready.
    const allReady = this.participantCount() >= 2 && humans.every((e) => e.ready);
    const teamsValid = this.mode !== "teams" || (teams.includes(0) && teams.includes(1));

    if (allReady && teamsValid) {
      this.countdownMsLeft =
        this.countdownMsLeft === null ? this.app.lobbyCountdownMs : this.countdownMsLeft - delta;
      if (this.countdownMsLeft <= 0) this.startMatch();
    } else {
      this.countdownMsLeft = null;
    }
  }

  private startMatch(): void {
    const all: { slotIndex: number; device: InputDevice; team: 0 | 1 }[] = [
      ...[...this.entries.values()].map((e) => ({
        slotIndex: e.slotIndex,
        device: e.device,
        team: e.team
      })),
      ...[...this.bots.entries()].map(([slotIndex, b]) => ({
        slotIndex,
        device: new BotDevice(
          slotIndex,
          b.difficultyName,
          botDifficulty(this.app.botConfig, b.difficultyName)
        ) as InputDevice,
        team: b.team
      }))
    ].sort((a, b) => a.slotIndex - b.slotIndex);

    const roster: RosterEntry[] = all.map((x) => ({
      slot: this.app.slots[x.slotIndex]!,
      device: x.device,
      team: this.mode === "teams" ? x.team : null
    }));
    const config: MatchConfig = {
      roster,
      friendlyFire: this.mode === "teams" ? this.friendlyFire : true,
      seed: seedNow()
    };
    this.scene.start("arena", config);
  }

  private render(): void {
    // Keep the hi-res card layer aligned to the canvas (it settles a few frames
    // after create and can move on resize); no-ops once the box is stable.
    this.cardOverlay.layout();

    const counting = this.countdownMsLeft !== null;
    this.headerIdle.setVisible(!counting);
    this.headerFight.setVisible(counting);

    const humanBySlot = new Map([...this.entries.values()].map((e) => [e.slotIndex, e]));
    this.frameGfx.clear();
    for (let i = 0; i < MAX_SLOTS; i++) {
      const cx = cardCenter(i);
      const entry = humanBySlot.get(i);
      const bot = this.bots.get(i);
      const occupied = entry !== undefined || bot !== undefined;

      // The card art (ornate frame + full-body portrait) is the card; dim it
      // while the slot is empty so a lit card reads as "claimed".
      this.cardOverlay.setAlpha(i, occupied ? 1 : 0.35);

      // Highlight outline: green when a human is ready, purple for a bot (always
      // ready). Drawn fully outside the art (frameGfx is below the cards) so the
      // whole 2px band frames the card rather than hiding behind it.
      const highlight = entry?.ready ? COLOR_READY : bot !== undefined ? COLOR_BOT : null;
      if (highlight !== null) {
        this.drawBorder(cardLeft(i) - 2, CARD_TOP - 2, CARD_W + 4, CARD_H + 4, 2, hexToInt(highlight), 1);
      }

      // Row 1 = occupant identity (the cards carry no baked name): the slot's
      // player name for humans, "BOT" for computer players, dimmed when empty.
      // Readiness reads off the name colour + the green highlight border above.
      // Row 2 = device/difficulty (+ team), or the join prompt when empty.
      const slotName = this.app.slots[i]?.name ?? "";
      const teamTag = (t: 0 | 1): string => (this.mode === "teams" ? `  T${String(t + 1)}` : "");
      let name: string;
      let nameColor: string;
      let chip: string;
      let chipColor: string;
      if (entry !== undefined) {
        name = slotName; // ready reads off the green name colour + highlight border
        nameColor = entry.ready ? COLOR_READY : COLOR_TEXT;
        chip = `${deviceLabel(entry.device)}${teamTag(entry.team)}`;
        chipColor = COLOR_MUTED;
        // The lowest-slot human owns the mode/bot toggles; mark it (see bottom hint).
        if (this.isController(entry)) name += " *";
      } else if (bot !== undefined) {
        name = "BOT";
        nameColor = COLOR_BOT;
        chip = `${bot.difficultyName}${teamTag(bot.team)}`;
        chipColor = COLOR_BOT;
      } else {
        name = slotName;
        nameColor = COLOR_MUTED;
        chip = "press jump";
        chipColor = COLOR_MUTED;
      }
      this.statuses[i]!.setTint(hexToInt(nameColor));
      this.centerText(this.statuses[i]!, cx, name);
      this.chips[i]!.setTint(hexToInt(chipColor));
      this.centerText(this.chips[i]!, cx, chip);
    }

    if (counting) {
      this.modeLine.setTint(hexToInt(COLOR_READY));
      this.centerText(
        this.modeLine,
        ARENA_WIDTH / 2,
        `starting in ${String(Math.ceil(this.countdownMsLeft! / 1000))}...`
      );
    } else {
      this.modeLine.setTint(hexToInt(COLOR_TEXT));
      const extra =
        this.mode === "teams"
          ? `   friendly fire: ${this.friendlyFire ? "on" : "off"}`
          : `   bot difficulty: ${this.currentDifficulty()}`;
      this.centerText(this.modeLine, ARENA_WIDTH / 2, `mode: ${this.mode.toUpperCase()}${extra}`);
    }
    this.centerText(
      this.hintMode,
      ARENA_WIDTH / 2,
      this.mode === "teams" ? "*down=friendly fire" : "*down=bot difficulty"
    );
  }

  /** Set text on a (left-origin) BitmapText and recenter it on cx. */
  private centerText(bt: Phaser.GameObjects.BitmapText, cx: number, text: string): void {
    bt.setText(text);
    bt.setX(Math.round(cx - bt.width / 2));
  }

  /** Pixel-aligned rectangle outline (four fill strips) — crisper than strokeRect. */
  private drawBorder(
    x: number,
    y: number,
    w: number,
    h: number,
    t: number,
    color: number,
    alpha: number
  ): void {
    this.frameGfx.fillStyle(color, alpha);
    this.frameGfx.fillRect(x, y, w, t);
    this.frameGfx.fillRect(x, y + h - t, w, t);
    this.frameGfx.fillRect(x, y, t, h);
    this.frameGfx.fillRect(x + w - t, y, t, h);
  }
}
