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
  /**
   * OWED WRITE-UPS COUNT AS NEW (S2, 2026-10-26; lightly held): when the gate
   * says "too little new" and a night would start for its catch-up alone, each
   * session from an earlier day still owing a write-up counts as one new
   * memory toward `MIN_NEW` — the catch-up runs first in the night, so what it
   * writes is in the dream's queue by the time the dream begins. A person who
   * only checks in (a few short sessions a day, a remember or two) otherwise
   * never gets a whole night. Read by the host (`claude-code/hooks.ts#
   * catchUpWhenOwed`), which knows what is owed; a first day stays catch-up
   * only (there is no night behind it to dream on). Revert: false.
   */
  OWED_COUNTS_AS_NEW: true,
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
  /**
   * A ROOM THAT SCALES WITH THE DAY (2026-10-23, lean bundles; Mike's go 10-23):
   * the memories' share of tonight's room is at most this base plus
   * `NIGHT_ROOM_PER_NEW` for each memory in the queue, and never more than
   * `NIGHT_CHARS` gives — so a quiet day spends less on whole texts, and a busy
   * store (the owner's: hundreds a day) sees no change. Never below what every
   * memory shown costs as a line: a memory the full room would show is shown.
   * Set the base to `NIGHT_CHARS` to turn it off. CAL.
   */
  NIGHT_ROOM_BASE: 40_000,
  NIGHT_ROOM_PER_NEW: 1_500,
  /**
   * LEAN NIGHT BUNDLES (2026-10-23, Mike's go 10-23; held lightly, an
   * experiment): the dream's and the reflection's bundles go out as plain
   * lines — a memory a line, its fields in a fixed order under a legend, ids
   * short for the run (`m1…`, `c1…`; `fit/AliasMap`), no JSON inside the
   * result's JSON — the dream's journal as its chapters' summaries with their
   * addresses, and `propose` and `finish` answer with counts and the
   * failures. Every door (dream, reflect, recall) reads a short id back to
   * its real one for the life of the run; real ids are still taken. Off: the
   * bundles and the answers are as they were, so a test night can compare
   * both. Read at use; a run keeps the shape it began with.
   */
  LEAN_BUNDLE: true as boolean,
  /**
   * THE REFLECTION'S ROOM, REORDERED (2026-10-23, lane D1; Mike's go 15:32,
   * lightly held): the reflection is the morning's long view, so its room is
   * filled in that order — the small fixed parts (the page, its last
   * reflections, the dream's journal, gists and nominations), then the long
   * view (the whole core, the spine when on, every core candidate, the most
   * felt), then the last few days' chapters by their summaries, each a line
   * with its address — those three always shown, a line each at least,
   * whatever the room — then what the dream changed and the OLDER memories it
   * saw (`SAW_OLDER` at most; the fresh ones come in through `recent`), then
   * everything else in what is left. Was: the fixed parts, the chapters whole
   * (up to 24k) and a line for every memory the dream was shown came first,
   * and on a busy night the long view got no room at all. Off: exactly as
   * before. Read at use (`dream/reflect.ts#compose`); a reflection keeps the
   * shape it began with.
   */
  REFLECT_ROOM_ORDER: true as boolean,
  /**
   * THE REFLECTION'S CORE CANDIDATES, CAPPED (R1, 2026-10-24, lightly held):
   * at most `REFLECT_TUNABLES.CANDIDATES` a night, part of them rotated
   * through the rest, and the rest counted in one line. Off: every candidate,
   * exactly as before. Read at use (`dream/reflect.ts#compose`).
   */
  REFLECT_CANDIDATES_CAP: true as boolean,
  /** With `REFLECT_ROOM_ORDER`: the most OLDER memories the dream saw (neighbours, mixing, lookback) the reflection is shown, a line each. CAL. */
  SAW_OLDER: 40,
  /**
   * With `REFLECT_ROOM_ORDER`: the room the last few days' chapters aim for,
   * by their summaries. Every chapter is shown, a line each at least: on a
   * busy few days the lines get shorter (`REFLECT_TUNABLES.
   * CHAPTER_LINE_MIN_BYTES` at the least) and past that the room grows; on a
   * quiet few days the summaries come whole. CAL.
   */
  REFLECT_CHAPTER_CHARS: 16_000,
  /**
   * THE TIMELINE (2026-10-23, lane D2, with `self.DAY_SUMMARY` and
   * `REFLECT_ROOM_ORDER`): the reflection sees the last this-many days as a
   * line a day — day's end's summary of each, or, for a day without one, its
   * chapters' summaries' first lines — beside the last few days' chapters. CAL.
   */
  TIMELINE_DAYS: 21,
  /** With `TIMELINE_DAYS`: a day's line, at most, in characters; a summary no longer comes whole, else its first line, cut with "…" and its whole length. CAL. */
  TIMELINE_LINE_CHARS: 240,
  /** The share of tonight's room tonight's new memories and their neighbours may take as lines. CAL. */
  FRESH_SHARE: 0.5,
  /** The share for the journal's new entries. CAL. */
  CHAPTER_SHARE: 0.3,
  /**
   * The most tonight's fresh LIST (ids and neighbours, in part 1) may cost on the wire. CAL.
   * 16k since 2026-10-23 (was 12k, an experiment, Mike's go 10-22 for 24k): at 12k the list,
   * not the fresh room, capped a night at ~44 new memories. Not 24k: a full 24k list with the
   * wake and the page passes part 1's furniture line and drops the wake on a busy night
   * (test/result-ceiling.test.ts); the 10-22 night used 14.5k of it. See
   * docs/decisions.d/feat-dream-intake-1023.md.
   */
  FRESH_LIST_CHARS: 16_000,
  /**
   * Nearest OLDER neighbours shown beside each new memory (owner: 5–8; 4 since
   * 2026-10-23, an experiment, his go 10-22, to fit more new memories in the list).
   */
  NEIGHBOURS: 4,
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

  // ── remembering a dream (D1, 2026-10-27) ─────────────────────────────────
  /**
   * A DREAM IS RECALLED BY WHAT IT WAS ABOUT (D1, 2026-10-27; Mike: "if humans
   * remember it then so should counterparts, humans talk a lot about what they
   * dreamed and think about it during the day"). A question that does NOT
   * name dreaming reaches a journal only by MEANING, at or above this cosine
   * (the higher of the question against the title and against each passage of
   * the journal, `DREAM_RECALL_PASSAGE_CHARS` long), and at most
   * `DREAM_RECALL_UNNAMED_MAX` of them. CAL on potion-base-8M@256, 10-27
   * (NOTES "D1"): "keys" 0.74 and "locked doors" 0.47 against the ring-of-keys
   * dream; the nearest ordinary misses 0.41 ("where did I leave my car keys"
   * against a work dream) and 0.35 ("what did I say about my sister"). With
   * no embedder, such a question reaches no dream (words alone pulled work
   * dreams beside 6 of 8 ordinary questions, review of #645).
   */
  DREAM_RECALL_MEANING_BAR: 0.45,
  /** The most dreams a question that does not name dreaming carries. */
  DREAM_RECALL_UNNAMED_MAX: 1,
  /**
   * A question that DOES name dreaming ("did you dream about the greenhouse?")
   * reaches a journal by a shared content word (as since OL1b) or by the
   * meaning of its content words once the dream words and the asking are out
   * (`nights.ts#dreamlessQuestion`), at or above this cosine. Lower than the
   * unnamed bar: the question already asks for a dream. CAL on
   * potion-base-8M@256, 10-27: "greenhouse seedlings" 0.48 against its own
   * dream, 0.14 against the keys dream; "keys" 0.74 / 0.20; "release" 0.51
   * against a work dream, 0.12 against the keys dream.
   */
  DREAM_RECALL_NAMED_FLOOR: 0.3,
  /** How much of a journal one vector reads: under the static table's 512-token cap (~2,000 characters). */
  DREAM_RECALL_PASSAGE_CHARS: 1_500,
  /**
   * FADING (D1, 2026-10-27; coordinator: "fast unless used, the way a human
   * dream is gone by lunch unless someone tells it"). A question that does not
   * name dreaming reaches a journal by what it was about only while the
   * lived day is within its REACH of its last touch — the day it was dreamed, or the last lived day it was
   * recalled or retold (`dream/recalled.ts`). The reach starts at this many
   * lived days (the day after a dream is still in reach; the one after that
   * is not) and is multiplied by `DREAM_RECALL_REACH_GROWTH` for every lived
   * day it was touched, up to `DREAM_RECALL_REACH_MAX_DAYS`: spaced use keeps
   * a dream, as it keeps a memory. A faded dream stays in the journal: a question
   * that names dreaming, "last dream" and its id still reach it. Read at use.
   */
  DREAM_RECALL_REACH_DAYS: 1,
  /** The reach's growth for each lived day a dream was recalled or retold. CAL. */
  DREAM_RECALL_REACH_GROWTH: 3,
  /** The longest a dream's reach grows. CAL. */
  DREAM_RECALL_REACH_MAX_DAYS: 90,
} as const;

export type DreamAction = keyof typeof DREAM_TUNABLES.LIMITS;
export const DREAM_ACTIONS = Object.keys(DREAM_TUNABLES.LIMITS) as DreamAction[];

