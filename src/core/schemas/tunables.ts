/**
 * Every constant this module owns, in one visible place.
 *
 * CAL = calibration-required: it must ship with a recorded measurement against
 * the real name space, or ship disabled (scar §2.8 — "the near-collision
 * similarity bar is measured, not intuited"; v1's 0.60 embedding floor was set
 * from intuition and was inert because arbitrary same-corpus pairs already sat
 * at 0.576).
 */
import type { Kind } from "../types.js";

export const TUNABLES = {
  /**
   * CAL. Near collision is TOKEN CONTAINMENT: "Mike" against "Mike Chen".
   * Chosen because it is the exact shape §14.3 names, needs no embedder, and
   * fails toward refusal rather than toward a silent merge. It is NOT a
   * measured similarity bar; a measured one replaces it, and the replacement is
   * the reason this is a tunable rather than a hard-coded `if`.
   */
  NEAR_COLLISION: "token-containment" as const,

  /** At most one birth per chunk, counted by the engine (§5 G3). */
  MAX_BIRTHS_PER_CHUNK: 1,

  /** Minimum characters in a name. Shorter than this cannot be whole-worded
   *  usefully and mints handles that collide with English. */
  NAME_MIN_CHARS: 2,

  /** The tier a re-mention credits. `referenced` deliberately: a mention is the
   *  entity being USED, and the ignorable tier (footnoted, w = 0) would make
   *  "accumulates" unreachable — a stub that is mentioned every day would still
   *  fade, which is not the lifecycle the contract describes (NOTES.md §4). */
  MENTION_TIER: "referenced" as const,

  /** Why an entity's archive row says it left. One string, one meaning. */
  FADE_REASON: "faded-by-decay" as const,

  /**
   * How gently an entity card fades (owner, 2026-09-24: "don't fade people away
   * too quickly"). A card fades only when physics says the row is prunable AND
   * these floors have passed too. Experimental defaults, not measured; NOTES §14.
   */
  FADE: {
    /** Calendar days since the card was last used before it may fade. Lived days
     *  alone are too fast for someone who uses the tool every day. */
    CALENDAR_FLOOR_DAYS: 180,
    /** Per-kind calendar floor, where a kind wants a slower one. A person you
     *  have not talked about in half a year is still someone you know. */
    CALENDAR_FLOOR_DAYS_BY_KIND: { person: 365 } as Readonly<Partial<Record<Kind, number>>>,
    /** Multiplies physics' lived-day dwell (`D_FLOOR_DAYS`) per kind. People get
     *  twice the lived quiet a project does before they can fade. */
    LIVED_DWELL_FACTOR_BY_KIND: { person: 2 } as Readonly<Partial<Record<Kind, number>>>,
  },

  /** Box-2 meta key prefix for a card's calendar anchor (`{ day, date }`): a
   *  lived day and the calendar date the fade sweep saw it on. NOTES §14. */
  FADE_ANCHOR_PREFIX: "schemas.fade.anchor." as const,

  /** What the versions row says when a belief fell to accumulated pressure. */
  REVISED_REASON: "revised-by-pressure" as const,

  /** And when a "now" fact was replaced on one clear correction (§4.3). The two
   *  are DIFFERENT strings because they are different crossings: a reader of the
   *  lineage must be able to tell a bar that was climbed from a fact that simply
   *  changed (scar §2.4). */
  REPLACED_REASON: "replaced-by-declaration" as const,
} as const;
