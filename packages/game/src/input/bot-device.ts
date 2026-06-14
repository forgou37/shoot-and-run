import { botSeed, makeBot, type Bot, type BotDifficulty } from "@shoot-and-run/bots";
import { emptyInput, type ArenaData, type PlayerInput, type SimState } from "@shoot-and-run/sim";
import type { InputDevice } from "./device";

/**
 * A computer-controlled player presented to the match as an ordinary
 * InputDevice (spec 004). The lobby builds it before the sim exists, so it
 * late-binds via `attach()` once ArenaScene has created the sim: only then are
 * the arena, the live state source, and the bot's slot known.
 *
 * Always "connected" (so it never triggers the pad-disconnect auto-pause) and
 * never the pause source. Its own PRNG is seeded from the match seed + slot, so
 * a bot-driven match stays replayable.
 */
export class BotDevice implements InputDevice {
  readonly kind = "bot" as const;
  readonly connected = true;
  readonly id: string;
  private bot: Bot | null = null;
  private getState: (() => Readonly<SimState>) | null = null;

  constructor(
    index: number,
    /** Preset name, kept for lobby/HUD display. */
    readonly difficultyName: string,
    private readonly difficulty: BotDifficulty
  ) {
    this.id = `bot:${index}`;
  }

  /** Bind to the running sim. Call once, right after createSim. */
  attach(getState: () => Readonly<SimState>, slot: number, matchSeed: number, arena: ArenaData): void {
    this.getState = getState;
    this.bot = makeBot({ seed: botSeed(matchSeed, slot), slot, difficulty: this.difficulty, arena });
  }

  sample(): PlayerInput {
    if (!this.bot || !this.getState) return emptyInput(); // not in a match yet
    return this.bot.input(this.getState());
  }

  pausePressed(): boolean {
    return false;
  }
}
