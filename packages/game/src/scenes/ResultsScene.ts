import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH, type SimEvent } from "@shoot-and-run/sim";
import awardsJson from "../../../../content/awards.json";
import { getAppContext, type AppContext } from "../app-context";
import { EdgeReader } from "../input/menu-input";
import { fadeIn, transitionTo } from "../scene-transition";
import { addPixelText } from "../theme";
import {
  assignAwards,
  foldMatchStats,
  parseAwards,
  type Award,
  type PlayerMeta
} from "../match-stats";

/** Payload the arena scenes hand to the results screen on match_ended. */
export interface ResultsConfig {
  /** The whole match's event log (local sim, or the online confirmed stream). */
  events: SimEvent[];
  /** Identity + color per player slot, in display order. */
  players: PlayerMeta[];
  /** Pre-rendered "X wins the match!" banner (the arena scene owns FFA/teams). */
  winnerLabel: string;
  /** Scene to return to on continue (e.g. "lobby" local, "title" online). */
  returnTo: string;
  /** Data payload for the return scene (e.g. { url } for online-join). */
  returnData?: object;
}

/**
 * Post-match awards screen (spec 016). Pure presentation: it folds the match's
 * SimEvent log into per-player tallies and assigns superlative awards (one winner
 * each) via the Phaser-free aggregator, then renders the winner banner and each
 * player's earned titles. Continue (jump/Start/Space/Enter) fades back to the
 * caller's return scene.
 */
export class ResultsScene extends Phaser.Scene {
  private app!: AppContext;
  private cfg!: ResultsConfig;
  private edges!: EdgeReader;
  private prevConfirm = false;

  constructor() {
    super("results");
  }

  init(data: ResultsConfig): void {
    this.cfg = data;
    this.prevConfirm = false;
  }

  create(): void {
    this.app = getAppContext(this);
    this.edges = new EdgeReader();
    this.cameras.main.setBackgroundColor("#10121f");
    fadeIn();

    const catalog = parseAwards(awardsJson);
    const stats = foldMatchStats(this.cfg.events, this.cfg.players);
    const awards = assignAwards(stats, catalog);
    const bySlot = new Map<number, Award[]>();
    for (const a of awards) {
      const list = bySlot.get(a.slot) ?? [];
      list.push(a);
      bySlot.set(a.slot, list);
    }

    addPixelText(this, ARENA_WIDTH / 2, 10, "MATCH RESULTS", 14, "#f0e6c8").setOrigin(0.5);
    addPixelText(this, ARENA_WIDTH / 2, 28, this.cfg.winnerLabel, 11, "#ffd740").setOrigin(0.5);

    // One stacked block per player (a name in the slot color, then their earned
    // award titles wrapped to the screen width) — robust for 2–4 players where
    // four side-by-side columns would overlap and clip at the 320px buffer edge.
    let y = 48;
    for (const p of this.cfg.players) {
      addPixelText(this, ARENA_WIDTH / 2, y, p.name, 11, p.color).setOrigin(0.5, 0);
      y += 13;
      const earned = bySlot.get(p.slot) ?? [];
      const line = earned.length > 0 ? earned.map((a) => this.awardLabel(a)).join("  ·  ") : "—";
      const awards = addPixelText(this, ARENA_WIDTH / 2, y, line, 9, earned.length > 0 ? "#cdbfe8" : "#5a6079", {
        align: "center",
        maxWidth: ARENA_WIDTH - 12
      }).setOrigin(0.5, 0);
      y += awards.height + 7;
    }

    addPixelText(
      this,
      ARENA_WIDTH / 2,
      ARENA_HEIGHT - 12,
      "jump start space to continue",
      9,
      "#5a6079"
    ).setOrigin(0.5);
  }

  /** Award title, with the winning count for multi-valued stats (a "First Blood"
   *  flag stays bare). */
  private awardLabel(a: Award): string {
    return a.stat === "firstBlood" ? a.title : `${a.title} ${String(a.value)}`;
  }

  override update(): void {
    const dev = this.edges.read(this.app.manager.devices());
    const kConfirm =
      this.app.keyboard.isDown("Space") ||
      this.app.keyboard.isDown("Enter") ||
      this.app.keyboard.isDown("Escape");
    const confirm = (kConfirm && !this.prevConfirm) || dev.some((e) => e.joinOrConfirm || e.pause);
    this.prevConfirm = kConfirm;
    if (confirm) transitionTo(this, this.cfg.returnTo, this.cfg.returnData);
  }
}
