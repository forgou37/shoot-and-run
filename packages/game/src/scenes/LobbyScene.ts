import { botDifficulty } from "@shoot-and-run/bots";
import Phaser from "phaser";
import { getAppContext, type AppContext } from "../app-context";
import { BotDevice } from "../input/bot-device";
import type { InputDevice } from "../input/device";
import { EdgeReader } from "../input/menu-input";
import type { MatchConfig, RosterEntry } from "../match-config";
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

/**
 * "Press a button to join" lobby (A3.4, extended for bots in spec 004). Each
 * unassigned device joins by pressing jump and claims the lowest free slot;
 * jump toggles ready, shoot steps back (ready→unready→leave). The first joined
 * human is the controller: up cycles mode, down toggles friendly fire (teams)
 * or cycles bot difficulty (FFA), and left/right add/remove computer players in
 * the free slots. Other joined-unready humans switch team with left/right.
 * With ≥2 participants (humans + bots) and all humans ready, a countdown starts
 * the match. Bots are always ready and count toward the participant total, so a
 * lone human can start a match against bots. Placeholder text UI.
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
  private text!: Phaser.GameObjects.BitmapText;

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
    this.text = addPixelText(this, 10, 8, "", 10, "#f0e6c8", { lineSpacing: 3 });
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
    const lines: string[] = ["SHOOT & RUN  ·  LOBBY", ""];
    const humanBySlot = new Map([...this.entries.values()].map((e) => [e.slotIndex, e]));
    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = this.app.slots[i];
      const name = slot ? slot.name : `P${String(i + 1)}`;
      const entry = humanBySlot.get(i);
      const bot = this.bots.get(i);
      if (entry) {
        const star = this.isController(entry) ? "*" : " ";
        const teamTag = this.mode === "teams" ? `  team ${String(entry.team + 1)}` : "";
        lines.push(`${name}${star} ${entry.ready ? "READY" : "joined"}${teamTag}`);
      } else if (bot) {
        const teamTag = this.mode === "teams" ? `  team ${String(bot.team + 1)}` : "";
        lines.push(`${name}  BOT (${bot.difficultyName})${teamTag}`);
      } else {
        lines.push(`${name}  —  press jump to join`);
      }
    }
    lines.push("");
    lines.push(
      `mode: ${this.mode.toUpperCase()}${this.mode === "teams" ? `   friendly fire: ${this.friendlyFire ? "on" : "off"}` : `   bot difficulty: ${this.currentDifficulty()}`}`
    );
    lines.push("jump=join/ready   shoot=back");
    lines.push("*first player: up=mode  L/R=add/remove bot");
    lines.push(this.mode === "teams" ? "*down=friendly fire" : "*down=bot difficulty");
    if (this.countdownMsLeft !== null) {
      lines.push("");
      lines.push(`starting in ${String(Math.ceil(this.countdownMsLeft / 1000))}...`);
    }
    this.text.setText(lines.join("\n"));
  }
}
