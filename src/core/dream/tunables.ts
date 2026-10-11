/**
 * Every `dream/` knob, in one visible place. WORKING DEFAULTS from the owner's
 * conversation of 2026-09-26 ("try it, see how it goes, adjust"); CAL = not
 * yet measured against real dreams.
 */
import { TOOL_RESULT_CEILING } from "../fit/index.js";

export const DREAM_TUNABLES = {
  // ── when to ask ───────────────────────────────────────────────────────────
  /** The ask is due only when at least this many memories wait in the queue
   *  (undreamed, within `QUEUE_DAYS`) — a dream with nothing to replay is not
   *  worth his minutes. CAL. */
  MIN_NEW: 3,
  /** A store that has never dreamed reads its journal this many lived days back. */
  FIRST_DREAM_DAYS: 7,
  /**
   * THE NIGHTLY RUN (2026-09-28, held lightly). A dream begun and quiet this
   * long — no change, no journal — was left behind (its session closed and the
   * background agent went with it). It no longer holds the day: the next
   * session's line may start the run again, and `begin` resumes it. CAL.
   */
  ABANDONED_AFTER_MS: 30 * 60_000,
  /** How many times one calendar day's run may be started again after it was left behind. CAL. */
  RELAUNCHES_PER_DAY: 2,
  /**
   * A HEADLESS RUN THAT NEVER REPORTED (2026-09-29, review of #282): a row
   * still `started` this long past its own watchdog (the row carries it) is
   * LOST — its process died, slept or was killed — and the day's line falls
   * back to asking. CAL.
   */
  NIGHT_LOST_GRACE_MS: 10 * 60_000,
  /** The watchdog assumed for a `started` row that does not carry its own. */
  NIGHT_RUN_ASSUMED_MS: 20 * 60_000,
  /**
   * THE NIGHTLY RUN'S ORDER — the page writer, then the dream, then the
   * reflection (the owner's call, 2026-09-28; held lightly). The writer goes
   * FIRST: it reads yesterday's memories before any merge archives the
   * originals, it survives a session cut off mid-run because it ran first,
   * and the dream and the reflection both see the fresh page. The launch
   * prompt and each phase's `next` follow this list, and the writer claims its
   * night whenever it runs, so another order is this one line. The reflection
   * stays after the dream: it reads what the dream saw.
   */
  NIGHT_ORDER: ["writer", "dream", "reflection"] as readonly ("dream" | "writer" | "reflection")[],

  // ── the bundle ────────────────────────────────────────────────────────────
  /**
   * THE QUEUE (2026-09-28, build B; held lightly). What the dream replays is
   * every memory not yet shown to a dream that stands — "undreamed", read
   * from the dreams' own `shown`, no table of its own — born within this many
   * lived days. Ranked by replay priority, not by age; what tonight's room
   * cannot take WAITS for the next night, with a count. Past the window a
   * memory leaves the queue for ordinary fading, and the count of those that
   * aged out is said. The same span as the look-back. CAL.
   */
  QUEUE_DAYS: 7,
  /** The queue is read at most this many rows deep (said when reached). CAL. */
  QUEUE_READ: 2_000,
  /**
   * TONIGHT'S ROOM, in characters of shown text (plus a fixed cost per item):
   * the whole bundle across its parts. Sized from the dreamer's context (the
   * first dream cost ~111k tokens with far less), not from one tool result —
   * a bundle longer than one result comes in parts. What it cannot take waits
   * (new memories) or is counted (the rest). CAL.
   */
  NIGHT_CHARS: 100_000,
  /** The share of tonight's room tonight's new memories and their neighbours may take as lines. CAL. */
  FRESH_SHARE: 0.5,
  /** The share for the journal's new entries. CAL. */
  CHAPTER_SHARE: 0.3,
  /** The most tonight's fresh LIST (ids and neighbours, in part 1) may cost on the wire. CAL. */
  FRESH_LIST_CHARS: 12_000,
  /** Nearest OLDER neighbours shown beside each new memory (owner: 5–8). */
  NEIGHBOURS: 6,
  /** Loosely related older memories shown for mixing (the REM half). CAL. */
  MIXING: 5,
  /** The loose band: neighbours ranked this far down are "loosely related". */
  MIXING_FROM_RANK: 12,
  MIXING_TO_RANK: 40,
  /** The look-back: the strongest-feeling memories from about a week back. */
  LOOKBACK_DAYS: 7,
  /** …within this many lived days either side of it. */
  LOOKBACK_SPREAD: 2,
  LOOKBACK_COUNT: 5,
  /**
   * DETAIL BY IMPORTANCE (2026-09-28: was a flat 400 characters each). Every
   * memory shown gets a line; the most important get their whole text, up to
   * this many characters — longer is an excerpt with its whole length said,
   * and the rest is a lookup away.
   */
  DETAIL_CHARS: 4_000,
  /** Bytes of a memory's line. */
  LINE_BYTES: 200,
  /** The longest journal entry shown whole; longer is an excerpt with its length said. */
  ENTRY_CHARS: 6_000,
  /**
   * The self page and the wake as the bundle carries them, by wire cost
   * (`fit/wireChars`); their whole lengths are said. The wake is the page
   * first, then its lanes (craft, open threads, what's coming, hints): the
   * page part mostly repeats `selfPage`.
   */
  PAGE_CHARS: 6_000,
  WAKE_CHARS: 6_000,
  /**
   * THE BUNDLE IN PARTS (2026-09-28), measured the way the MCP server sends
   * it (`dreamResultChars`): the begin result under this, each later part
   * under `PART_CHARS`.
   *
   * THE HOST'S CEILING, MEASURED (2026-10-02): were 54,000 each, on a guess of
   * three characters a token. Claude Code saves a result past 50,000
   * characters to a file the nightly run cannot open — the begin (51.5 KB)
   * and part 2 (51,306) of the night's bundle never reached the dream. Both
   * now sit at the one ceiling (`fit/TOOL_RESULT_CEILING`, 20% under that
   * line): more parts, each one read.
   */
  RESULT_CHARS: TOOL_RESULT_CEILING.CHARS,
  PART_CHARS: TOOL_RESULT_CEILING.CHARS,

  // ── what one dream may change (owner: "start ~10 merges, 20 links, 3 gists") ─
  LIMITS: {
    merge: 10,
    link: 20,
    gist: 3,
    replayed: 60,
    contradiction: 10,
    // 2026-09-29: a dream may settle a pair when the reason is plain; it
    // mostly flags, so few.
    settle: 5,
    "feeling-now": 10,
    "nominate-core": 3,
  },
  /**
   * The weight a dream PROPOSES for a link or a gist's tie, both ways — about
   * one co-activation (`associate` `HEBB_RATE`, 0.1). Was 0.3, three full
   * co-activations, written around homeostasis (2026-09-28: the dream proposes,
   * waking use confirms, and edge decay fades what it never does). A proposal
   * raises an edge to at least this from its decayed weight; it never adds. CAL.
   */
  LINK_WEIGHT: 0.1,
  /**
   * TEXT CAPS, raised 2026-09-28 (owner direction: loosen the limits; design a
   * real answer when something really grows too long). Longer is kept to the
   * cap and the result says so — never cut without a word.
   */
  /** Longest merged or dreamed text, in characters (was 2,000). */
  MAX_TEXT_CHARS: 8_000,
  /** Longest journal entry, in characters (was 12,000). */
  MAX_JOURNAL_CHARS: 30_000,
  /** Longest title of a merge, a gist or the journal (were 200, 180 and 120). */
  MAX_TITLE_CHARS: 200,
  /** Longest nomination why (was 300). */
  MAX_WHY_CHARS: 1_000,
} as const;

export type DreamAction = keyof typeof DREAM_TUNABLES.LIMITS;
export const DREAM_ACTIONS = Object.keys(DREAM_TUNABLES.LIMITS) as DreamAction[];

/**
 * WHAT A DREAM'S BUNDLE IS READ AS: a guest, always (review of #318, a
 * coordinator default that keeps the behaviour from before it — the owner may
 * revisit). A dream's journal and a nomination's `why` carry no
 * confidentiality mark and are read later by other bundles and the
 * dashboard, so a confidential memory may not reach them. Until #318 every
 * server that built a bundle was a guest; since then a Claude Code server can
 * be the owner's, and the bundle stays as it was. `ctx.owner` still decides
 * the GATE (what counts as new for the ask), which is the session's own.
 */
export const BUNDLE_OWNER = false;
