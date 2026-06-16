/**
 * Post-match stats & awards (spec 016). A pure, Phaser-free fold over a match's
 * SimEvent log into per-player tallies, plus a superlative-only award assigner.
 *
 * This is a CONSUMER of the sim's only output channel (events), exactly like the
 * bots and the future eval pipeline — not a game rule. It lives in the shell for
 * now (its sole consumer is the results screen) but imports ONLY sim *types*, so
 * it stays headless-testable in Node and can be lifted into a shared package
 * unchanged when spec 005's eval pipeline needs match metrics.
 *
 * Awards are superlative-only (owner decision, 2026-06-16): each award goes to
 * exactly one winner — the player with the highest tally for that stat — with
 * ties broken by the lowest slot index, and an all-zero award is not shown.
 */
import type { SimEvent } from "@shoot-and-run/sim";

/** One numeric tally per player. The keys are the stat ids the award catalog
 *  (`content/awards.json`) maps titles onto. `firstBlood` is a 0/1 flag stored
 *  as a number so every award is a uniform "highest tally wins" superlative. */
export interface PlayerTallies {
  /** All jumps (ground + wall + flight flap). */
  jumps: number;
  /** Wall jumps only. */
  wallJumps: number;
  dashes: number;
  arrowsFired: number;
  /** Kills with cause "arrow" (excludes self-kills). */
  arrowKills: number;
  stompKills: number;
  /** Kills with cause "bomb" (excludes self-kills). */
  bombKills: number;
  boostersCollected: number;
  chestsOpened: number;
  arrowsPickedUp: number;
  shieldsBlocked: number;
  /** Rounds the player was alive at round end (never a victim that round). */
  roundsSurvived: number;
  deaths: number;
  /** 1 for the player who scored the match's first kill, else 0. */
  firstBlood: number;
}

export type StatKey = keyof PlayerTallies;

export const STAT_KEYS: readonly StatKey[] = [
  "jumps",
  "wallJumps",
  "dashes",
  "arrowsFired",
  "arrowKills",
  "stompKills",
  "bombKills",
  "boostersCollected",
  "chestsOpened",
  "arrowsPickedUp",
  "shieldsBlocked",
  "roundsSurvived",
  "deaths",
  "firstBlood"
];

/** Identity + display info for one player slot (the subset the screen needs). */
export interface PlayerMeta {
  slot: number;
  name: string;
  color: string;
  team?: number | null;
}

export interface MatchStats {
  /** Per-slot tallies, keyed by slot. */
  bySlot: Map<number, PlayerTallies>;
}

export interface AwardDef {
  id: string;
  title: string;
  stat: StatKey;
}

export interface AwardCatalog {
  awards: AwardDef[];
}

export interface Award {
  id: string;
  title: string;
  stat: StatKey;
  /** Winning slot. */
  slot: number;
  /** The winning tally value (always > 0; all-zero awards are dropped). */
  value: number;
}

function zeroTallies(): PlayerTallies {
  return {
    jumps: 0,
    wallJumps: 0,
    dashes: 0,
    arrowsFired: 0,
    arrowKills: 0,
    stompKills: 0,
    bombKills: 0,
    boostersCollected: 0,
    chestsOpened: 0,
    arrowsPickedUp: 0,
    shieldsBlocked: 0,
    roundsSurvived: 0,
    deaths: 0,
    firstBlood: 0
  };
}

/**
 * Fold a whole match's event log into per-player tallies. Pure and deterministic:
 * the same events + players always produce the same tallies. Events referencing
 * an unknown slot (not in `players`) are ignored defensively.
 */
export function foldMatchStats(events: readonly SimEvent[], players: readonly PlayerMeta[]): MatchStats {
  const bySlot = new Map<number, PlayerTallies>();
  for (const p of players) bySlot.set(p.slot, zeroTallies());

  let firstKillDone = false;
  // Victims since the current round started — survivors of a round are everyone
  // who was never a victim during it.
  let victimsThisRound = new Set<number>();

  for (const e of events) {
    switch (e.type) {
      case "round_started":
        victimsThisRound = new Set();
        break;
      case "player_jumped": {
        const t = bySlot.get(e.slot);
        if (!t) break;
        t.jumps++;
        if (e.kind === "wall") t.wallJumps++;
        break;
      }
      case "player_dashed": {
        const t = bySlot.get(e.slot);
        if (t) t.dashes++;
        break;
      }
      case "arrow_fired": {
        const t = bySlot.get(e.playerSlot);
        if (t) t.arrowsFired++;
        break;
      }
      case "arrow_picked_up": {
        const t = bySlot.get(e.playerSlot);
        if (t) t.arrowsPickedUp++;
        break;
      }
      case "player_killed": {
        victimsThisRound.add(e.victim);
        const victim = bySlot.get(e.victim);
        if (victim) victim.deaths++;
        // Kill credit excludes self-kills (a bomb can kill its own thrower).
        if (e.killer !== e.victim) {
          const killer = bySlot.get(e.killer);
          if (killer) {
            if (e.cause === "arrow") killer.arrowKills++;
            else if (e.cause === "stomp") killer.stompKills++;
            else if (e.cause === "bomb") killer.bombKills++;
          }
          if (!firstKillDone && killer) {
            killer.firstBlood = 1;
          }
        }
        // The match's first kill closes first-blood eligibility whether or not it
        // was creditable (a self-kill first ⇒ nobody gets First Blood).
        if (!firstKillDone) firstKillDone = true;
        break;
      }
      case "chest_opened": {
        const t = bySlot.get(e.slot);
        if (t) t.chestsOpened++;
        break;
      }
      case "booster_collected": {
        const t = bySlot.get(e.slot);
        if (t) t.boostersCollected++;
        break;
      }
      case "shield_blocked": {
        const t = bySlot.get(e.slot);
        if (t) t.shieldsBlocked++;
        break;
      }
      case "round_ended": {
        for (const p of players) {
          if (!victimsThisRound.has(p.slot)) bySlot.get(p.slot)!.roundsSurvived++;
        }
        break;
      }
      default:
        // arrow_stuck, arrow_exploded, match_ended — not tallied.
        break;
    }
  }

  return { bySlot };
}

/**
 * Assign awards superlatively: one winner per catalog entry (the highest tally
 * for that stat; ties broken by the lowest slot), dropping any award whose best
 * tally is zero. A player may win several awards or none.
 */
export function assignAwards(stats: MatchStats, catalog: AwardCatalog): Award[] {
  const slots = [...stats.bySlot.keys()].sort((a, b) => a - b);
  const out: Award[] = [];
  for (const def of catalog.awards) {
    let best = 0;
    let bestSlot = -1;
    for (const slot of slots) {
      const v = stats.bySlot.get(slot)![def.stat];
      // Strict `>` over ascending slots ⇒ the lowest slot wins a tie.
      if (v > best) {
        best = v;
        bestSlot = slot;
      }
    }
    if (bestSlot >= 0) {
      out.push({ id: def.id, title: def.title, stat: def.stat, slot: bestSlot, value: best });
    }
  }
  return out;
}

/**
 * Validate the awards catalog (`content/awards.json`). Titles are content, not
 * code (content-as-data ethos), so the scene never hardcodes them. Each entry's
 * `stat` must name a known tally key.
 */
export function parseAwards(data: unknown): AwardCatalog {
  if (typeof data !== "object" || data === null) {
    throw new Error("awards: expected an object");
  }
  const awards = (data as Record<string, unknown>)["awards"];
  if (!Array.isArray(awards)) {
    throw new Error("awards: 'awards' must be an array");
  }
  const known = STAT_KEYS as readonly string[];
  const seen = new Set<string>();
  const out: AwardDef[] = awards.map((a, i) => {
    if (typeof a !== "object" || a === null) {
      throw new Error(`awards[${String(i)}]: expected an object`);
    }
    const o = a as Record<string, unknown>;
    const id = o["id"];
    const title = o["title"];
    const stat = o["stat"];
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`awards[${String(i)}]: id must be a non-empty string`);
    }
    if (seen.has(id)) {
      throw new Error(`awards: duplicate id "${id}"`);
    }
    seen.add(id);
    if (typeof title !== "string" || title.length === 0) {
      throw new Error(`awards[${String(i)}]: title must be a non-empty string`);
    }
    if (typeof stat !== "string" || !known.includes(stat)) {
      throw new Error(`awards[${String(i)}]: stat must be one of ${known.join(", ")}`);
    }
    return { id, title, stat: stat as StatKey };
  });
  return { awards: out };
}
