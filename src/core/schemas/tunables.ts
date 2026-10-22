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

  /**
   * Card birth from the night's name tally (2026-10-11, Group 3 part D;
   * `names.ts`, `Schemas#birthsFromNames`). A name becomes a card when at
   * least `MIN_MEMORIES` live memories, written on at least `MIN_DAYS` lived
   * days, name it — the bar from review 12 (D3), kept as given. CAL:
   * `LOWER_CASE_SHARE`, measured once on a copy of the owner's store
   * (2026-10-11, 1,009 live memories): with code and addresses not counted,
   * the project and people names sat at or under 0.20, and the capitalized
   * English words ("Code", "Job", "Health") from 0.25 up. How many are born a
   * night is sleep's budget (`sleep/tunables.ts` BUDGETS.births), not a number
   * here.
   */
  BIRTH_TALLY: {
    MIN_MEMORIES: 3,
    MIN_DAYS: 2,
    LOWER_CASE_SHARE: 0.25,
  },

  /**
   * THE NIGHT'S TAG WORK (wave 2 lane B, 2026-10-21; design §1, lightly held).
   * One switch for all of it: the tags phase (card names as tags, stem
   * merges, dead merges pruned), the topic births, and the night's tagging
   * ask (untagged memories, look-alike tags, card kinds). Off, the night does
   * none of it; the write side (`remember`/`session_end` tags) is plain data
   * and stays. Read at use, so `harness compare --set schemas.TAGS_NIGHT=false`
   * reaches every reader.
   */
  TAGS_NIGHT: true as boolean,

  /**
   * A TAG BECOMES A TOPIC (`Schemas#birthsFromTags`): live memories carrying
   * it (through its merges) count toward `TOPIC_MIN_MEMORIES`, each one used
   * awake counting `TOPIC_USED_WEIGHT` more and each carrying a feeling
   * `TOPIC_FELT_WEIGHT` more — importance is earned, not only counted (Mike,
   * 10-21) — written on at least `TOPIC_MIN_DAYS` lived days in at least
   * `TOPIC_MIN_SESSIONS` sessions. Names keep their own bar (`BIRTH_TALLY`).
   * At most `TOPIC_BIRTHS_PER_NIGHT` a night, heaviest first. CAL: starting
   * points from the brief, check 2026-10-26.
   */
  TOPIC_MIN_MEMORIES: 5,
  TOPIC_MIN_DAYS: 3,
  TOPIC_MIN_SESSIONS: 2,
  TOPIC_USED_WEIGHT: 0.5,
  TOPIC_FELT_WEIGHT: 0.5,
  TOPIC_BIRTHS_PER_NIGHT: 5,

  /**
   * THE NIGHT'S TAGGING ASK (`dream/tags.ts`), per night: untagged memories
   * shown (recent and strong first), look-alike tag pairs asked "same?", and
   * cards with no subject kind asked which kind. CAL: starting points.
   */
  TAGS_BACKFILL_PER_NIGHT: 40,
  TAGS_MERGE_ASKS_PER_NIGHT: 10,
  TAGS_KINDS_PER_NIGHT: 10,

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

  // --- beliefs' producers (wave 2 lane C, 2026-10-21) ---
  //
  // Starting points, lightly held; check 2026-10-26 on live numbers. Each is
  // top-level so `harness compare --set schemas.KEY=…` can move it, and read
  // at use. Support's own arithmetic is physics §5.13.
  /**
   * THE SWITCH. On (the default): the night's reflection is shown the beliefs
   * on the subjects in play and asked to file support or birth a few; the
   * dream proposes candidates (C3). Off: neither is asked, and what either
   * sends is refused `beliefs-off`. Belief rows already written stay, inert,
   * fading like any memory. `compare --set schemas.BELIEFS_BIRTH=false`.
   */
  BELIEFS_BIRTH: true,
  /** Births a reflection may make, across its finishes (design "still open" 5 named 5). */
  BELIEF_BIRTHS_PER_REFLECTION: 3,
  /**
   * CAL. A birth this close to a live belief on the same subject (token
   * cosine, `remember/updates.ts#similarity`) is refused with that belief's
   * id, to file to instead. v1's dedup bar was 0.6 (behavioral-spec §14).
   */
  BELIEF_NEAR_DUPLICATE: 0.6,
  /** Subjects shown to a reflection: the self subject, then the cards its memories name most. */
  BELIEF_SUBJECTS_SHOWN: 6,
  /** Beliefs shown per subject, strongest first; the rest are counted. */
  BELIEFS_SHOWN_PER_SUBJECT: 5,
  /**
   * CAL. A birth this close to the body of one of its own cites (token
   * cosine) is a memory pasted in as a belief, not a claim drawn from it, and
   * is refused (review of #577). The review suggested ~0.8; a one-line claim
   * drawn from a short memory already reads ~0.8 ("I keep the hard problems
   * for dawn" from "I chose to keep the dawn slot for the hard problems",
   * 0.82), so 0.9 for now.
   */
  BELIEF_PASTED: 0.9,
  /**
   * CAL. A birth that `replaces` a contested belief and says it this nearly
   * again (token cosine) is refused: it would reissue the claim with what went
   * against it no longer counted (review of #577). Not the near-duplicate
   * bar (0.6): a real revision keeps the frame — "We work best late at night"
   * for "We work best at dawn" reads 0.73 — while the claim again reads ~1
   * ("…at dawn!" 1.00). A negation added or removed ("We don't work best at
   * dawn.", 0.91) is a replacement whatever it reads (`reflect.ts#negationDiffers`).
   */
  BELIEF_SAME_CLAIM: 0.9,
  /**
   * A SESSION'S RARE BIRTH (lane C3): at most this many beliefs born in the
   * moment a lived day, across sessions — the reflection is the usual author.
   * CAL.
   */
  BELIEF_SESSION_BIRTHS_PER_DAY: 2,
  /**
   * …and only from the owner's words, my own choice, or a vivid moment: a
   * memory felt at the time at least this strongly (its recorded feelings'
   * peak, not a caller's `emotional` score). CAL.
   */
  BELIEF_SESSION_VIVID: 0.6,
} as const;
