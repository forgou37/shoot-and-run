/**
 * Bot-internal constants: behavioral geometry and timing shared across all
 * difficulties. Per-difficulty knobs (reaction, aim, dodge, dash) live in
 * content/bots.json; these are structural and not worth exposing as data.
 *
 * Distances are pixels, times seconds, durations ticks (60 Hz). Arrows fall
 * under gravity, so firing range is kept short enough that the drop stays
 * inside a body's kill band — this is what makes bot arrow kills land.
 */
export const FIRE_RANGE_PX = 90;
/** The bot closes to roughly this before it is content to stand and shoot. */
export const PREFERRED_RANGE_PX = 48;
/** Target this much higher than the bot's feet → it should jump to reach. */
export const VERTICAL_REACH_PX = 20;
/** How far ahead (seconds) to look for an incoming arrow's closest approach. */
export const THREAT_HORIZON_S = 0.35;
/** Closest-approach miss distance (px) that still counts as a threat. */
export const THREAT_RADIUS_PX = 16;
/** Minimum ticks between shots, so the bot doesn't fire every other tick. */
export const FIRE_COOLDOWN_TICKS = 16;
/** Ticks of committed evasive movement once a dodge is triggered. */
export const DODGE_TICKS = 14;
/** Beyond this gap the bot may spend a dash to close (gated by dashChance). */
export const DASH_CLOSE_RANGE_PX = 120;
