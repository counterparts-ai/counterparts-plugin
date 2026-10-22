/**
 * Every `dream/` knob, in one visible place. WORKING DEFAULTS from the owner's
 * conversation of 2026-09-26 ("try it, see how it goes, adjust"); CAL = not
 * yet measured against real dreams.
 */
import { TOOL_RESULT_CEILING } from "../fit/index.js";

export const DREAM_TUNABLES = {
  // ── when to ask ───────────────────────────────────────────────────────────
  /** The ask is due only when at least this many memories wait in the queue
   *  (undreamed, within reach) — a dream with nothing to replay is not
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
   * THE QUEUE (2026-09-28, build B; read whole and ranked by value ×
   * fragility since 2026-10-11, Group 3 part C; held lightly). What the dream
   * replays is every memory not yet shown to a dream that stands —
   * "undreamed", read from the dreams' own `shown`, no table of its own —
   * that is still within reach (`physics.REACH`). The whole queue is read and
   * ranked; what tonight's room cannot take WAITS for the next night, with a
   * count. A memory leaves the queue when its own curve takes it below reach
   * (the count of those that did since the last dream is said, `agedOut`),
   * not after a fixed number of days: the queue and the forgetting share one
   * clock. The core never falls below reach; it waits for its turn.
   *
   * The per-prompt ASK reads only this many lived days back, newest first, and
   * stops at `MIN_NEW` (a floor, said as one): the ask runs on every prompt, and
   * an older memory still waiting is counted by the night's full read. CAL.
   */
  ASK_QUEUE_DAYS: 7,
  /**
   * THE LEAST FRAGILITY A QUEUED MEMORY IS RANKED WITH (Group 3 part C,
   * 2026-10-11): replay priority is value × fragility, and a strongly held
   * memory — the most charged and the most salient — is barely fragile, so
   * without a floor it would rank last every night while staying queued (it
   * is far from falling below reach), shut out of the look-back and the
   * neighbours that skip queued memories. At this floor its value still
   * counts: a strongly felt memory ranks beside an ordinary one on its first
   * night. CAL.
   */
  FRAGILITY_FLOOR: 0.1,
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
   * THE DAY'S REPLAY (2026-10-19, feedback-loop part E). An experiment, set
   * strong on purpose so its effect is easy to see; check on ~10-22, then tune
   * down; revert by setting every lift to 0. What the
   * day since the last dream did with a memory (`day.ts#readDay`) lifts a
   * QUEUED memory's replay priority: priority × (1 + lift). Why these: a
   * `drewOn` or a 3 (the reward tag) and a use are the day's own check on what
   * matters, so they outrank value × fragility nearly always (×4, ×3); a
   * rating of 2 the same as a use; a memory only shown gets a nudge (×1.5),
   * since about half of footnotes are rated noise.
   */
  DAY_LIFT: { reward: 3, used: 2, useful: 2, shown: 0.5 },
  /**
   * At most this many memories the day used, rated useful or drew on are
   * listed as tonight's `today`; one already dreamed joins the bundle in the
   * role `today`. Why 20: the owner's store shows about 4 drewOn and 10 useful
   * ratings a day, so this rarely cuts.
   */
  TODAY_COUNT: 20,
  /**
   * At most this many pairs used together in one session are listed
   * (`todayPairs`). Why 12: a hint for the replay, not a second fresh list,
   * and a long session's pairs grow with the square of its uses.
   */
  TODAY_PAIRS: 12,
  /**
   * A `today` memory's place when tonight's room is spent: beside `new` (4),
   * `on-mind` (3) and `lookback` (2). Why 3.5: the day's lived use is the
   * night's strongest outside signal after what is new tonight.
   */
  TODAY_FIT: 3.5,
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
    // 2026-10-11 (Group 2): slot proposals confirmed or undone — at most the
    // night's "to confirm" (`SLOT_PER_NIGHT`, 4).
    slot: 4,
    "feeling-now": 10,
    "nominate-core": 3,
    // 2026-10-21 (wave 2 lane C3): a belief proposed, never made. Its ceiling
    // is `BELIEF_CANDIDATES` (below, top-level so a compare can set it); this
    // entry names the action.
    "belief-candidate": 2,
  },
  /**
   * BELIEF CANDIDATES A NIGHT (wave 2 lane C3, 2026-10-21; design §3, Mike's
   * "try it"): a pattern the dream sees across memories may be proposed as a
   * belief — never minted by the dream ("the interpreter flags; the engine
   * mints", v1). The next reflection adopts it (route `dream`) or lets it go.
   * Read at use; off with `schemas.BELIEFS_BIRTH`. CAL.
   */
  BELIEF_CANDIDATES: 2,
  /**
   * FOLDS A NIGHT (2026-10-11, Group 3 part B; review 11 D5): a fold is a
   * `gist` flagged `fold: true` — not an action of its own — so it has its own
   * ceiling beside `LIMITS`, and the insight gists keep their 3. A fold past it
   * is refused, counted on the night's `dream.changed` row (`foldOverflow`)
   * and said in the hand-back; since Group 3 part C its foldable parts are
   * carried to the next night's queue, together (`foldCarried`). CAL.
   */
  FOLDS: 5,
  /**
   * A FELT PART A FOLD KEEPS AT ITS OWN WEIGHT (2026-10-11, review of #432;
   * review 11 C3/D3): a `self` or `person` memory whose recorded feeling peaks
   * at or above this. A mild feeling on a routine work memory does not keep it
   * out of the fold it belongs to. CAL.
   */
  FOLD_FELT_FLOOR: 0.5,
  /**
   * The weight a dream PROPOSES for a link or a gist's tie, both ways — about
   * one co-activation (`associate` `HEBB_RATE`, 0.1). Was 0.3, three full
   * co-activations, written around homeostasis (2026-09-28: the dream proposes,
   * waking use confirms, and edge decay fades what it never does). A proposal
   * raises an edge to at least this from its decayed weight; it never adds. CAL.
   */
  LINK_WEIGHT: 0.1,
  /**
   * THE REPLAY'S OWN DEPOSIT (Group 4 item 3, 2026-10-11; review 06 C2, D5):
   * when a dream opens, each new memory its bundle shows is proposed a link to
   * each older neighbour shown beside it, at this weight — half a dream's own
   * `link`, because nobody chose these pairs: the bundle did. Through the same
   * door (`associate.propose`: live ends, pinned frozen, room-only, never
   * evicting); no model call, and not a change the dream made (it is not in
   * the dream's changes, so an undo does not reach it — decay does). CAL.
   */
  REPLAY_LINK_WEIGHT: 0.05,
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
  /**
   * THE NIGHT PROPOSES A PROJECT (2026-10-21, wave 2 lane G, design §8):
   * two folders used on the same lived days, their memories naming the same
   * subjects, are proposed as one project in the morning share — one pair a
   * night at most, never one asked about in the last `PROJECT_JOIN_REST`
   * reflections — and the owner's yes joins them (`dream/project-ask.ts`).
   * Off: no proposal. Read at use.
   */
  PROJECT_JOIN_ASK: true,
  /** Lived days looked back over for co-use. CAL. */
  PROJECT_JOIN_WINDOW: 14,
  /** Lived days both folders were written in, at least. CAL. */
  PROJECT_JOIN_DAYS: 3,
  /** Subjects (cards, by name) both folders' memories name, at least — only
   *  subjects named in at most half the active folders count. CAL. */
  PROJECT_JOIN_SUBJECTS: 3,
  /** ...and at least this share of the telling subjects of the folder that
   *  names fewer. CAL. */
  PROJECT_JOIN_OVERLAP: 0.4,
  /** ...and at least this share of the telling subjects of the folder that
   *  names more (review of #580: a general folder names much). CAL. */
  PROJECT_JOIN_OVERLAP_MAX: 0.25,
  /** A folder used on the same days as this many others or more is general,
   *  and never proposed. CAL. */
  PROJECT_JOIN_GENERAL: 3,
  /** Lived days a proposal may be acted on; past them a yes is refused and
   *  the night may ask again. CAL. */
  PROJECT_JOIN_EXPIRE_DAYS: 3,
  /** Reflections a pair is not asked about again after it was. CAL. */
  PROJECT_JOIN_REST: 7,
} as const;

export type DreamAction = keyof typeof DREAM_TUNABLES.LIMITS;
export const DREAM_ACTIONS = Object.keys(DREAM_TUNABLES.LIMITS) as DreamAction[];

