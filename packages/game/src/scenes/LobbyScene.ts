import Phaser from "phaser";
import { getAppContext, type AppContext } from "../app-context";
import type { InputDevice } from "../input/device";
import { EdgeReader } from "../input/menu-input";
import type { MatchConfig, RosterEntry } from "../match-config";
import { FONT_FAMILY } from "../theme";

type Mode = "ffa" | "teams";

interface Entry {
  device: InputDevice;
  /** Claimed slot index (0..3) → player identity from players.json. */
  slotIndex: number;
  ready: boolean;
  team: 0 | 1;
}

const MAX_SLOTS = 4;
/** Shell-chosen seeds for lobby-started matches need only be distinct per run;
 *  Date.now is fine here (this is the shell, not the deterministic sim). */
const seedNow = (): number => Date.now() & 0x7fffffff;

/**
 * "Press a button to join" lobby (A3.4). Each unassigned device joins by
 * pressing jump and claims the lowest free slot; jump toggles ready, shoot
 * steps back (ready→unready→leave). The first joined player cycles mode and
 * friendly fire with up/down; joined-unready players switch team with left/
 * right (teams mode). With ≥2 joined and all ready, a countdown starts the
 * match — cancelled by anyone un-readying or leaving. Placeholder text UI.
 */
export class LobbyScene extends Phaser.Scene {
  private app!: AppContext;
  private edges!: EdgeReader;
  private entries!: Map<string, Entry>;
  private mode!: Mode;
  private friendlyFire!: boolean;
  private countdownMsLeft!: number | null;
  private text!: Phaser.GameObjects.Text;

  constructor() {
    super("lobby");
  }

  create(): void {
    this.app = getAppContext(this);
    this.edges = new EdgeReader();
    this.entries = new Map();
    this.mode = "ffa";
    this.friendlyFire = false;
    this.countdownMsLeft = null;
    this.cameras.main.setBackgroundColor("#10121f");
    this.text = this.add.text(10, 8, "", {
      fontFamily: FONT_FAMILY,
      fontSize: "10px",
      color: "#f0e6c8",
      lineSpacing: 3
    });
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
      if (this.mode === "teams" && !entry.ready && (e.left || e.right)) {
        entry.team = entry.team === 0 ? 1 : 0;
      }
      if (this.isController(entry)) {
        if (e.up) this.cycleMode();
        if (e.down && this.mode === "teams") this.friendlyFire = !this.friendlyFire;
      }
    }

    this.updateCountdown(delta);
    this.render();
  }

  private join(device: InputDevice): void {
    const used = new Set([...this.entries.values()].map((e) => e.slotIndex));
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (!used.has(i)) {
        this.entries.set(device.id, { device, slotIndex: i, ready: false, team: (i % 2) as 0 | 1 });
        return;
      }
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
    if (this.mode === "teams" && this.entries.size < 3) this.setMode("ffa");
  }

  /** The first joined player (lowest claimed slot) owns the mode/FF toggles. */
  private isController(entry: Entry): boolean {
    const min = Math.min(...[...this.entries.values()].map((e) => e.slotIndex));
    return entry.slotIndex === min;
  }

  private cycleMode(): void {
    if (this.mode === "ffa") {
      if (this.entries.size >= 3) this.setMode("teams"); // teams needs ≥3 joined
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
    if (mode === "teams") this.friendlyFire = false; // FF defaults off in teams
  }

  private pruneDisconnected(devices: readonly InputDevice[]): void {
    const live = new Set(devices.map((d) => d.id));
    for (const id of [...this.entries.keys()]) {
      if (!live.has(id)) {
        this.entries.delete(id);
        this.edges.forget(id);
      }
    }
  }

  private updateCountdown(delta: number): void {
    const joined = [...this.entries.values()];
    const allReady = joined.length >= 2 && joined.every((e) => e.ready);
    const teamsValid =
      this.mode !== "teams" ||
      (joined.some((e) => e.team === 0) && joined.some((e) => e.team === 1));

    if (allReady && teamsValid) {
      this.countdownMsLeft =
        this.countdownMsLeft === null ? this.app.lobbyCountdownMs : this.countdownMsLeft - delta;
      if (this.countdownMsLeft <= 0) this.startMatch();
    } else {
      this.countdownMsLeft = null;
    }
  }

  private startMatch(): void {
    const joined = [...this.entries.values()].sort((a, b) => a.slotIndex - b.slotIndex);
    const roster: RosterEntry[] = joined.map((e) => ({
      slot: this.app.slots[e.slotIndex]!,
      device: e.device,
      team: this.mode === "teams" ? e.team : null
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
    const bySlot = new Map([...this.entries.values()].map((e) => [e.slotIndex, e]));
    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = this.app.slots[i];
      const name = slot ? slot.name : `P${String(i + 1)}`;
      const entry = bySlot.get(i);
      if (!entry) {
        lines.push(`${name}  —  press jump to join`);
      } else {
        const star = this.isController(entry) ? "*" : " ";
        const teamTag = this.mode === "teams" ? `  team ${String(entry.team + 1)}` : "";
        lines.push(`${name}${star} ${entry.ready ? "READY" : "joined"}${teamTag}`);
      }
    }
    lines.push("");
    lines.push(
      `mode: ${this.mode.toUpperCase()}${this.mode === "teams" ? `   friendly fire: ${this.friendlyFire ? "on" : "off"}` : ""}`
    );
    lines.push("jump=join/ready   shoot=back");
    lines.push("*first player: up=mode  down=FF   L/R=team");
    if (this.countdownMsLeft !== null) {
      lines.push("");
      lines.push(`starting in ${String(Math.ceil(this.countdownMsLeft / 1000))}...`);
    }
    this.text.setText(lines);
  }
}
