/**
 * Every recall knob, in one visible place — the shape `physics/` uses, for the
 * same reason: a threshold hiding in a function body cannot be audited.
 *
 * **CAL = calibration-required** (scar §2.8: no threshold ships unmeasured against
 * the real space). Values marked CAL below are *v1's live calibration*, inherited
 * as the best surviving record of what real use moved — the starting point, NOT a
 * v2 measurement (recall/CONTRACT.md §4: "v1's values in behavioral-spec §9 are
 * the best surviving record of what lived use moved — the starting point, not the
 * default"). `tools/replay` is where they get re-earned against v2's own corpus.
 *
 * Structural (never tunable, never ablatable): the three hard gates, the
 * build/record split, tier disjointness, the composed budget, the sentinel,
 * the observer refusal.
 */

/** One embedder's semantic-channel calibration on one recall path. */
export interface SemanticTuning {
  /** Cosine below this is not a seed at all; above it, `(score − floor) / (1 − floor)`. */
  readonly floor: number;
  /** Multiplier on that scaled score — the channel's weight against the cue channel. */
  readonly weight: number;
}

/**
 * The two recall paths, and why they are calibrated apart (measured, 2026-09-23):
 *
 *   - `inline` — the DELIBERATE path: the caller embedded THIS text and hands
 *     the vector in (the MCP `recall` tool). The ranking is of the question
 *     itself, so a low floor mostly adds the right memory.
 *   - `lagged` — the PER-TURN path: the hook never embeds the turn it is
 *     answering; the worker ranked the PREVIOUS exchange, and that ranking is
 *     this turn's cue (`session.ts`). When the conversation has moved on, every
 *     lagged hit is about the last subject, so the same floor costs differently.
 */
export type SemanticPath = "inline" | "lagged";

/** A per-path calibration for one embedder identity. */
export interface SemanticProfile {
  readonly inline: SemanticTuning;
  readonly lagged: SemanticTuning;
}

export interface RecallTunables {
  // ── cue extraction ───────────────────────────────────────────────────────
  /** Minimum cue token length. Shorter tokens are noise, not names. [v1: 3] */
  MIN_CUE_LENGTH: number;
  /** Cap on distinct cue tokens taken from one turn — a latency bound. CAL. */
  MAX_CUES: number;
  /** Docs fetched per cue token. A postings bound and NOTHING else: it used to
   *  double as the df ceiling for rarity weighting, which meant rarity stopped
   *  being measured once a store held more than this many documents carrying a
   *  word. `Store.docFrequency` counts now (MEASURED 2026-09-04, see
   *  `store/cache.ts#docFrequency`). CAL. */
  PER_CUE_FETCH: number;
  /**
   * A cue whose rarity (`informativeness(df, storeSize)`) is below this is not
   * looked up in the index (Lane 0, 2026-10-10, scale review C4): a word in
   * almost every memory adds almost nothing to any of them, and fetching its
   * postings read a list the size of the store on every turn (52% of a turn at
   * 10x). 0.1 is a word in more than ~80% of memories; 0 is off (the default
   * since the review of #368: a skipped word's postings were the gate's
   * background, so skipping them changed what surfaced). CAL.
   */
  CUE_FETCH_MIN_IDF: number;
  /** Ambiguous-handle weight: a name pointing at two memories retrieves neither
   *  well, and trains nothing at all. [v1: 0.5] CAL. */
  AMBIGUOUS_WEIGHT: number;
  /** Cue carry-over: previous turn's cues re-enter at this weight, for one turn.
   *  [v1: 1 turn, decay 0.5] CAL. */
  CARRY_DECAY: number;
  /**
   * EVERYDAY WORDS (2026-10-19, an experiment; check ~10-22, revert by 11-02):
   * a cue's rarity weight is scaled by how much the embedder's table weighs the
   * word in English generally (`cues.ts#everydayFactor`, `Store.wordNorm`) —
   * 0 at or below LOW, 1 at or above HIGH, a smoothstep between. In
   * potion-base-8M's own row-norm units (the only table it is calibrated on,
   * `embed-client.ts#WORD_NORM_CALIBRATED`). HIGH <= LOW turns it off. CAL.
   */
  EVERYDAY_NORM_LOW: number;
  EVERYDAY_NORM_HIGH: number;

  // ── the document side of §9 G4: length normalization + a per-doc ceiling ──
  /** tf saturation for a cue's evidence in ONE document (BM25 k1). At `k1 = 1`
   *  and `CUE_LENGTH_NORM = 0` this is exactly the previous `2·tf/(tf+1)`, which
   *  is why it is 1: the change ships length normalization and nothing else. CAL. */
  CUE_TF_SATURATION: number;
  /** How much of a cue's evidence is normalized by document length (BM25 b).
   *  0 = none (the measured bug); 1 = fully proportional to length. CAL. */
  CUE_LENGTH_NORM: number;
  /** Clamp the length factor at 1: penalize a long document, never REWARD a
   *  short one. BM25's factor is centered on the mean, which raises short
   *  documents above their old scores — harmless for ranking, not harmless for
   *  the ABSOLUTE floors below, which are v1 inheritances calibrated against the
   *  old scale. See `store/cache.ts#LengthNorm.oneSided` for the measurement. CAL. */
  CUE_LENGTH_ONE_SIDED: boolean;
  /** Per-document ceiling on the cue channel, as a multiple of that document's
   *  single strongest cue. Corroboration is real evidence; sheer coverage is
   *  not. v1 capped the same quantity absolutely (`entityCueCap`); this is the
   *  scale-free form, because v2's cue weights are smoothed idf rather than v1's
   *  normalized similarities and an absolute number would not transfer. CAL. */
  CUE_DOC_CAP: number;

  // ── channels ─────────────────────────────────────────────────────────────
  /** Weight on the embedding channel's contribution — the FALLBACK since
   *  2026-09-23: it applies only to an identity `SEMANTIC_BY_IDENTITY` does not
   *  list (or to a store with no recorded identity). CAL. */
  SEMANTIC_WEIGHT: number;
  /** Cosine below this is not a seed at all — the FALLBACK, like
   *  `SEMANTIC_WEIGHT`: listed identities use their own floor. [v1: 0.45] CAL. */
  SEMANTIC_SEED_FLOOR: number;
  /** Nearest-neighbour slice pulled from the vector index. [v1 top-M: 8] CAL. */
  SEMANTIC_TOP_M: number;
  /**
   * PER-EMBEDDER, PER-PATH floor and weight, keyed by the identity box 3
   * RECORDS for its vectors (`cache_meta.embedder`, cache v5): the exact tag
   * (`potion-base-8M@256`) first, then its model alone (`voyage-3-large`, which
   * also answers `voyage-3-large@1024`). An identity with no entry — an unknown
   * table, a store with no tag, a handle with no identity — gets
   * `SEMANTIC_SEED_FLOOR` / `SEMANTIC_WEIGHT`, the values every store had
   * before this table existed. The identity is read FRESH from the file at
   * every activation (`Store.rankingIdentity`, one primary-key read), never
   * from configuration and never from the handle's open-time snapshot: the
   * cosines being scaled are the recorded model's. A LAGGED row ranked under
   * another model than the file now records is dropped before it gets here
   * (`session.ts`, source `other-model`). CAL —
   * `tools/bench/embedder-trial.ts`, `docs/research/static-embedder-trial-2026-09-23.md`.
   */
  SEMANTIC_BY_IDENTITY: Readonly<Record<string, SemanticProfile>>;
  /**
   * The most vectors box 3 may hold for an AMBIENT turn with no fresh lagged
   * cue (a session's first prompt, or a stale lag row) to embed its own text
   * and rank it in line (`session.ts#inLineSemantic`). A COUNT, not a clock:
   * the rank runs inside `activate()`, before `build()`'s first time check, so
   * an overrun there would abort the turn rather than degrade the channel.
   * Above it the channel stays dark and the turn records `in-line-skipped`. CAL.
   */
  SEMANTIC_INLINE_MAX_VECTORS: number;
  /** Weight on base-level activation (strength). The recency/arrival channel:
   *  it can make a memory warm, never loud. [v1: 0.15] CAL. */
  ARRIVAL_WEIGHT: number;

  // ── the gate ─────────────────────────────────────────────────────────────
  /** Relative admission: bar = mean + SNR_GLOBAL x sd of THIS turn's background. [v1: 1.2] CAL. */
  SNR_GLOBAL: number;
  /** Relative loud tier: bar = mean + SNR_STRONG x sd. [v1: 2.5] CAL. */
  SNR_STRONG: number;
  /** Hard gate (b): the absolute floor, checked BEFORE any salience adjustment.
   *  **In cue units** — multiples of `informativeness(1, storeSize)`, the weight
   *  of one maximally-rare cue (`gate.ts#floorUnit`). The `_UNITS` suffix is not
   *  decoration: this knob was `FLOOR_GLOBAL`, an absolute number on v1's 0-1
   *  cosine scale, and renaming it is how every stale reading of the old scale
   *  becomes a compile error rather than a silent miscalibration. CAL. */
  FLOOR_GLOBAL_UNITS: number;
  /** Per-kind OVERRIDES of the loud-tier floor, in the same cue units. The
   *  mechanism of §9 G12 — kinds may live on different activation scales — is
   *  kept; v1's numbers for it are not, because v2's own corpus refuses them
   *  (see the measurement at the value below). An empty map means no kind has
   *  earned an override yet. The BACKGROUND statistic stays global. CAL. */
  FLOOR_STRONG_BY_KIND_UNITS: Record<string, number>;
  /** The loud-tier floor for a kind with no override — today, every kind. CAL. */
  FLOOR_STRONG_DEFAULT_UNITS: number;
  /** Hard gate (c): fraction of a candidate's activation that must come from
   *  cues before it may go loud. Recency alone can never carry a memory there,
   *  however sacred. [v1: 0.5] CAL. */
  MIN_CUE_FRACTION: number;
  /** Two-sided salience modulation of the RELATIVE bar only. [v1 bar weight: 0.5] CAL. */
  SAL_BAR_WEIGHT: number;
  /** Salience's weight in the surfaced PICK's sort key — ordering and admission
   *  use deliberately different keys. [v1 sort weight: 0.5; fixture-bounded
   *  below ~0.3 and above ~1.2] CAL. */
  SAL_SORT_WEIGHT: number;
  /** Candidates carried into the gate. A count that must not become an
   *  undercount for aggregation lives in deliberate recall, not here. CAL. */
  MAX_CANDIDATES: number;

  // ── cold start: stricter, not looser (small stores over-surface) ──────────
  /** Below this many live memories the variance estimate is meaningless. [v1: 15] CAL. */
  COLD_START_MIN_STORE: number;
  /** Cold-start absolute floor, replacing the relative bar entirely. In the same
   *  cue units as the other two floors — a store this small is exactly where an
   *  absolute number on the wrong scale does the most damage. CAL. */
  COLD_START_FLOOR_UNITS: number;
  /** Cold-start candidate cap. [v1: 3] CAL. */
  COLD_START_MAX_CANDIDATES: number;
  /** Fewer cued candidates than this and the background distribution is a
   *  fiction — the gate degrades to the absolute regime rather than comparing a
   *  candidate against itself (see NOTES.md, the sigma-zero degeneracy). CAL. */
  MIN_BACKGROUND_SAMPLE: number;

  // ── inhibition + caps ────────────────────────────────────────────────────
  /** Near-duplicate similarity: above this, the weaker candidate is suppressed. [v1: 0.85] CAL. */
  NEAR_DUPLICATE: number;
  /** Hard cap on the loud tier. [v1: 2] */
  MAX_SURFACED: number;
  /** Hard cap on footnotes. [v1: 6] */
  MAX_FOOTNOTES: number;

  // ── quiet pointers from links (association build 2, 2026-09-28) ──────────
  /** Memories reached ONLY through links that may join a turn as footnote-tier
   *  pointers — pattern completion, held to a few. Their own slots, beside
   *  `MAX_FOOTNOTES`, so a pointer never displaces a memory the words found.
   *  Working default, unmeasured on a live store. CAL. */
  LINK_POINTERS_MAX: number;
  /** The activation threshold a link-only memory must reach to be pointed at:
   *  this fraction of the strongest seed's activation. Relative, so it means the
   *  same on a small store as a big one. At 0.05 a direct link from the
   *  strongest seed must weigh about 0.4 (four co-uses: `0.5 · w / 4 ≥ 0.05`);
   *  a single fresh co-use (0.1) or a legacy gist tie does not reach it. CAL.
   *  Since 2026-10-19 two co-uses in `rated` stretches reach it
   *  (`associate` `CO_USE_DEPOSIT` 0.25); this threshold is left alone. */
  LINK_POINTER_MIN_FRACTION: number;
  /** How many of the turn's strongest candidates (ranked the way the cut
   *  ranks them, words and meaning both) SEED spreading — 2026-09-28. Not the
   *  whole cue union, which on a big store is ~1,000 ids, most of them one weak
   *  word from the turn. Set equal to `MAX_CANDIDATES` so the seeds are the
   *  memories the cut would keep before links touch anything; a seed receives
   *  no contribution, so links lift only what ranks past them. CAL. */
  SPREAD_SEEDS: number;
  /** "Links suggest, they don't take over", as arithmetic (2026-09-28): a
   *  candidate's hop score is capped at this multiple of its own cue +
   *  semantic. At 1 the graph can at most double what the conversation gave a
   *  memory, however many paths reach it. Counted when it binds. CAL. */
  HOP_CEILING: number;

  // ── habituation (an experiment, 2026-10-19, light; check ~10-22) ─────────
  // Trying a raised bar for memories rated 0 twice to see whether footnote
  // noise drops. Revert by setting `HABITUATION_BAR_LIFT` to 0.
  /** How far back, in lived days (today included), a rating of 0 counts toward
   *  habituation. Why 7: the brief's week; an old rating ages out by itself. */
  HABITUATION_WINDOW_DAYS: number;
  /** Rated 0 in at least this many sessions inside the window: the memory is
   *  habituated. Why 2: one 0 can be one odd turn; two sessions agreeing is a
   *  pattern. */
  HABITUATION_MIN_SESSIONS: number;
  /** A rating at or above this, later than the zeros, clears them (the brief:
   *  "a later useful rating clears it"). Why 2: "useful background". */
  HABITUATION_CLEAR_SCORE: number;
  /** A habituated memory's bar to be shown is raised by this factor (×1.5 at
   *  0.5) — a penalty on its chance to show, never on its strength, and never
   *  a veto: a turn that reaches it strongly still shows it. Why 0.5: light;
   *  about the margin an ordinary footnote clears its bar by. CAL. */
  HABITUATION_BAR_LIFT: number;

  // ── context priming (an experiment, 2026-10-19; check ~10-22) ───────────
  // Trying a head start for memories connected to what this session is doing,
  // to see whether primed footnotes are rated more useful than unprimed ones
  // without one cluster winning turn after turn (`prime.ts`). Ambient only;
  // only candidates the turn's own words or meaning reached; never the
  // session's own writes; never past the absolute floors. Revert by setting
  // `PRIME_LINK_UNITS` and `PRIME_TRAIN_SHARE` to 0.
  /** Along LINKS: a source passes `weight × decayed edge × this` CUE UNITS
   *  (`floorUnit`) to each linked partner. Why 1: a fresh source and a link
   *  two co-uses made (0.5, associate `CO_USE_DEPOSIT`) give half a
   *  maximally-rare cue — two and a half times the floor, enough to clear an
   *  ordinary bar; a faint dream or contiguity link (~0.05) only breaks ties. */
  PRIME_LINK_UNITS: number;
  /** Along MEANING: the train of thought's head start, as a SHARE of what the
   *  turn's own meaning gives at the same cosine (the in-line semantic floor and
   *  weight of the store's embedder, `semanticTuning`). Why 0.5: the last few
   *  turns count half as much as this one. */
  PRIME_TRAIN_SHARE: number;
  /** CENTRING (review, 2026-10-19, an experiment inside the experiment):
   *  1 = a candidate gets a train head start only for the part of its cosine
   *  above the mean of the turn's cut before priming (or the floor, if higher); 0 =
   *  above the floor alone. Why 1: on a steady topic every candidate is a
   *  little near the train, and the floor alone gave all of them a head start
   *  (24 of 24 in the cost run) — priming should make the memories closer to
   *  the train than their peers win, not lift everyone. Revert by setting 0. */
  PRIME_TRAIN_CENTRE: number;
  /** The train's decay per turn. Why 0.5: the previous prompt weighs 1, the one
   *  before 0.5, then 0.25 — "the last few turns", so a dropped topic is mostly
   *  gone three turns on. */
  PRIME_TRAIN_DECAY: number;
  /** A source's link head start decays by this per turn since it first counted.
   *  Why 0.8: something opened or written five turns ago still primes at a
   *  third, ten turns ago at a tenth. */
  PRIME_SOURCE_DECAY: number;
  /** Each kind of source's weight. Why: a use or a write is this session's own
   *  act (1); the folder's open threads and handoff are what was left here, a
   *  softer sign of what this session is for (0.5). */
  PRIME_SOURCE_WEIGHT: Readonly<Record<"used" | "wrote" | "open", number>>;
  /** A handoff's weight as a source falls by this per lived day of its age
   *  (review, 2026-10-19). Why 0.7: yesterday's handoff is what this folder is
   *  for now (0.7); last week's is history (0.08 at 7 days, 0.03 at 10), which
   *  would otherwise open every session there with its train for its whole
   *  14-day life — the tunnel the brief worried about. */
  PRIME_HANDOFF_DAY_DECAY: number;
  /** At most this many sources, the newest first. Why 24: a long session's
   *  older acts have decayed to almost nothing anyway; it bounds the edge reads. */
  PRIME_MAX_SOURCES: number;
  /** How many of the turn's candidates, in the cut's order, are scored against
   *  the train (one box-3 vector read each). Why 72: three times
   *  `MAX_CANDIDATES`, so a memory just past the cut can be primed into it. */
  PRIME_TRAIN_POOL: number;
  /** "Priming gives a head start, it does not carry", as arithmetic: a
   *  candidate's priming is capped at this multiple of its own cue + semantic.
   *  Why 1: like `HOP_CEILING`, at most double what the conversation gave it;
   *  the dial to turn down first if the review sees tunnel vision. */
  PRIME_CEILING: number;
  /**
   * CONCEPT EDGES PRIME TOO (wave 2 lane E, 2026-10-22; an experiment, check
   * 2026-10-29): a source's TAGS are a partner source beside its links
   * (`prime.ts`, `PrimeInput.tagPartners`, bound from `schemas/tags.ts#tagPartners`)
   * — memories carrying the same tag, and memories carrying a tag that keeps
   * appearing with it (B's concept edges), at a modest weight through the same
   * link channel, so `PRIME_LINK_UNITS`, `PRIME_CEILING` and every limit of
   * priming hold. Off: the partner source is never asked, and priming is what
   * it was. Read at use; `harness compare --set recall.TAGS_PRIME=false`.
   */
  TAGS_PRIME: boolean;
  /** A tag partner's weight, in the units of a decayed link (`PartnersFn`).
   *  Why 0.1: a modest weight — under one co-use link (associate
   *  `CO_USE_DEPOSIT` 0.25), so a shared tag nudges a close call and a link
   *  someone made by using the two together still counts for more. A partner
   *  through a concept edge (a neighbouring tag) gets half. CAL. */
  TAGS_PRIME_WEIGHT: number;
  /** A tag on more live memories than this primes nothing: it is about
   *  everything here, so it says nothing (as rarity weighs cues). Why 40: a
   *  few weeks of a working topic; the live store's biggest tags (the
   *  project's own name) are far past it. Also bounds the reads. CAL. */
  TAGS_PRIME_MAX_TAG_MEMORIES: number;
  /** How many concept-edge neighbours of a source's tags are followed (the
   *  ones sharing the most memories). Why 2: bounded reads on the hot path. CAL. */
  TAGS_PRIME_NEIGHBOURS: number;

  // ── the beliefs slot (wave 2 lane E, 2026-10-22; design §7) ─────────────
  /**
   * BELIEFS IN THEIR OWN SLOT (an experiment, check 2026-10-29): when a
   * turn's words name a subject — a card through the alias index, a topic
   * through its tag — its strongest current beliefs are shown in a labelled
   * slot of their own, IN ADDITION to the footnotes, which stay belief-free.
   * Each line has a strength word, its support count and its id, rateable
   * like a footnote (`rated.ts`, lane `beliefs`): a rating is a use, once a
   * lived day, never support, and never anything for a belief about me or
   * us; being shown credits nothing. Ambient only. Off: the lookup is never
   * asked and the turn is byte for byte what it was. Read at use;
   * `harness compare --set recall.BELIEFS_IN_RECALL=false`.
   */
  BELIEFS_IN_RECALL: boolean;
  /** At most this many beliefs a turn, strongest first across the subjects
   *  named. Why 3: the design's "2–3 strongest". CAL. */
  BELIEFS_SLOT_MAX: number;
  /** A belief is shown only ABOVE this strength (today's, physics). Why 0.3:
   *  the brief's start — a belief is born at `BELIEF_BIRTH_CEILING` (0.3), so
   *  only one life has backed shows. CAL. */
  BELIEFS_SLOT_FLOOR: number;
  /** A belief's statement is clipped to this many bytes on its line. Why 200:
   *  a statement is one claim (`MAX_BELIEF_CHARS`); the line's word, count
   *  and id ride outside the clip. CAL. */
  BELIEF_LINE_BYTES: number;

  // ── affect ───────────────────────────────────────────────────────────────
  /** Emotional salience a candidate needs before it can raise the affect flag. [v1: 0.7] CAL. */
  AFFECT_MIN_EMOTION: number;
  /** Turns the affect flag stays down after firing — the emotional refractory.
   *  A high-salience wound must not light up every turn. [v1: 2] CAL. */
  AFFECT_REFRACTORY_TURNS: number;

  // ── mood-matching (recall G18, emotion part A — WORKING DEFAULTS) ─────────────
  /** How far back a recorded feeling still counts as how someone feels NOW, in
   *  hours of the store's clock. No classifier reads the turn: the mood is only
   *  what was recorded. CAL. */
  MOOD_WINDOW_HOURS: number;
  /** A recorded feeling weaker than this does not set a mood. CAL. */
  MOOD_MIN_STRENGTH: number;
  /** Salience a memory gains when it carried the SAME person's matching feeling,
   *  times that feeling's softened strength. Modulates the relative bar only —
   *  never activation, never an uncued memory. CAL. */
  /**
   * WORK STAYS IN ITS PROJECT, IN AMBIENT RECALL TOO (2026-10-21, wave 2 lane
   * G, design §8; OFF — Mike has not said, and §8 came from the wake's rule).
   * On: a turn in a folder does not show (footnote, surfaced or pointer) a
   * memory that is ANOTHER project's work (`self/work.ts#isWorkMemory`, craft
   * travelling as the wake's switch says) — the gate turns it away as
   * `project-skipped` where it would have been shown, and the decision row
   * counts it (`projectSkipped`). Deliberate recall is never filtered. Off:
   * nothing is skipped. Read at use.
   */
  RECALL_BY_PROJECT: boolean;
  /**
   * ANOTHER PROJECT'S WORK FACES A SLIGHTLY HIGHER BAR (2026-10-21, Mike's
   * ruling on lane G item 4: "we could try a slightly higher bar, and review
   * after a week"; an experiment, check ~2026-10-29). A memory that is another
   * project's work (`Turn.elsewhere`) has its admit and loud bars multiplied
   * by this, as habituation's lift does (`HABITUATION_BAR_LIFT`), after the
   * floor. Personal memories and craft are never another project's work, so
   * never lifted. The decision row counts what the lift alone turned away
   * (`crossProjectLifted`). 1 is off. Read at use. CAL.
   */
  CROSS_PROJECT_BAR_LIFT: number;
  MOOD_SAME_WEIGHT: number;
  /** The same for the OTHER person's matching feeling: the light cross-link. CAL. */
  MOOD_CROSS_WEIGHT: number;
  /** How far apart in VALENCE a memory's feeling and a mood may be and still
   *  match (wheel v2, 2026-09-30): the match is `1 − |Δvalence| / span`,
   *  nothing past the span. Replaced matching by core. CAL. */
  MOOD_VALENCE_SPAN: number;
  /** A low mood meeting a low memory lifts it by this share of the full lift
   *  (both valences below 0). The approved page: "Mood-matching stays a light
   *  tie-breaker, read from valence, so a low mood can't feed itself." CAL. */
  MOOD_LOW_LOW_WEIGHT: number;

  // ── a deliberate question about feeling (2026-09-30, U13 — WORKING DEFAULTS) ─
  /** The cue a nominated stamp brings, in cue units (one maximally-rare word),
   *  times its softened strength. Sized to clear the floor and compete for the
   *  gate's slots; the ORDER is the softened strength's (`deliberate.ts`). CAL. */
  FEELING_CUE_UNITS: number;
  /** How many of the strongest stamped memories a question about feeling
   *  nominates on its own — the lane's bound, beside the words' candidates. CAL. */
  FEELING_CANDIDATES_MAX: number;

  // ── render ───────────────────────────────────────────────────────────────
  /** Composed byte budget for the WHOLE injection, sentinel included. The host
   *  owns the real ceiling (scar §2.18) and passes it in; this is the default. CAL. */
  BUDGET_BYTES: number;
  /** Bytes of gist rendered per surfaced item before elision. CAL. */
  GIST_BYTES: number;
  /** Bytes of title rendered per footnote. CAL. 80 → 150 on 2026-09-14
   *  (IMPROVEMENTS U2): a title authored at session_end runs past 80 and was
   *  clipped mid-clause, and an 80-character title with one multi-byte dash
   *  lost its tail to the byte cap. Migrated titles are STORED at 80
   *  characters and render exactly as before. Six footnotes at 150 bytes plus
   *  ids and framing is ~1,100 bytes against a 2,048 default budget. */
  FOOTNOTE_TITLE_BYTES: number;
  /** Fraction of the budget above which a pressure tripwire fires (scar §2.4:
   *  every budget gets an event when it is approached, not only when it blows). */
  BUDGET_PRESSURE: number;
  /** Latency budget for the BUILD pass, milliseconds. On overrun: nothing
   *  injected, nothing buffered, no telemetry, no state written. CAL. */
  BUDGET_MS: number;

  // ── gate state ───────────────────────────────────────────────────────────
  /** Cap on remembered per-session surfacing records. The store has no meta
   *  expiry (INTERFACE-GAPS.md #1), so the row bounds itself. CAL. */
  MAX_SESSION_RECORDS: number;
}

export const TUNABLES: RecallTunables = {
  MIN_CUE_LENGTH: 3,
  MAX_CUES: 24,
  PER_CUE_FETCH: 24,
  // Decided by b2, 2026-10-10, lightly held. Why: it shifts what recall shows on small stores (new users: 2 → 0 footnotes at 40 memories); Lane 0 is meant to change speed, not behaviour. Re-enable after a recall-bench run on a store copy, with a minimum store size.
  CUE_FETCH_MIN_IDF: 0,
  AMBIGUOUS_WEIGHT: 0.5,
  CARRY_DECAY: 0.5,
  // Below ~20 sit only the true function words (the 1.7, for 5.3, you 7.2, that 9.3): they count nothing.
  EVERYDAY_NORM_LOW: 20,
  // Topic words start near here (kitchen 74, guitar 80); the grey zone below keeps part (music 59 → 0.89, any 33 → 0.17).
  EVERYDAY_NORM_HIGH: 70,

  // MEASURED 2026-09-04 on a copy of the live store (15,421 indexed documents,
  // mean 106 indexed tokens, max 3,184 — a 30x spread). Ambient recall returned
  // the same nine memories of 9–20 KB for every topic across two unrelated
  // sessions, judged 0-of-9 relevant by the instance that lived them, and 12 of
  // 19 turns then read "all-gated" because those nine were spent.
  //
  // `tools/recall-bench` swept one-sided x b ∈ {0, 0.5, 0.75, 1.0} x
  // cap ∈ {inf, 3, 2} — 23 cells — over the 13 prompts of that conversation.
  // What the grid says, in order:
  //   - b = 0 (no normalization) is the bug: 31 of 32 delivered items were hubs,
  //     on 13 of 13 turns.
  //   - THE CAP ALONE MAKES IT WORSE. At b = 0, cap = 3 took hub hits from 31 to
  //     52 — capping the hubs' sums compresses the turn's variance, which lowers
  //     the relative bar and admits MORE of them. The ceiling is the second half
  //     of this rule and is not a substitute for the first.
  //   - every b >= 0.5 takes hub hits to zero, at every cap and either sidedness.
  //     So b is chosen on what it COSTS, and the labeled positives decide:
  //     b = 1.0 loses one labeled positive (a long quoted passage) from the
  //     deliberate answer; cap = 2 loses a second one from it.
  //   - ONE cell in the grid delivers an AMBIENT labeled positive —
  //     one-sided, b = 0.5, cap = 3, which footnotes a third (a correction the
  //     owner once gave) on turn 4.
  //     Nothing else in 23 cells does, and "0 of 9 delivered footnotes were
  //     relevant" is the finding this change exists to move. It also carries the
  //     fewest recurring ids of the hub-free cells (7 ids / 33 of 79 deliveries,
  //     against 9 / 38 for two-sided b = 0.75) and keeps both deliberate
  //     positives. So: 0.5, clamped, cap 3 — not BM25's textbook 0.75, which is
  //     what the grid was expected to pick and did not.
  // The bench measures the LEXICAL channel only (no embeddings on authored
  // memories, and the bench passes no turn vector), so it is a floor, not a
  // forecast. CAL.
  CUE_TF_SATURATION: 1.0,
  CUE_LENGTH_NORM: 0.5,
  CUE_LENGTH_ONE_SIDED: true,
  CUE_DOC_CAP: 3.0,

  SEMANTIC_WEIGHT: 1.0,
  SEMANTIC_SEED_FLOOR: 0.45,
  SEMANTIC_TOP_M: 8,
  // PER-EMBEDDER, PER-PATH (CAL, 2026-09-23, keyless/recall-tune). Chosen from
  // `tools/bench/embedder-trial.ts`: 5 reseeds of the synthetic persona, 30
  // paraphrase + 10 lexical queries, a 54-cell grid on both paths plus a
  // topic-changing per-turn arm (`docs/research/static-embedder-trial-2026-09-23.md`,
  // "the retune").
  //
  //   potion-base-8M@256, INLINE 0.15 / 6 — the deliberate path's best cell with
  //     no delivery lost: paraphrase targets delivered 11/30 against lexical-only's
  //     6 (MRR 0.211 vs 0.169), lexical 10/10, items per turn 4.90 → 5.03, and
  //     7–8 rank slips (targets lexical-only ranked higher: most delivered by
  //     neither arm, two — ranks 3→6 and 3→4 — delivered by both). One step past
  //     it loses a delivery (weight 7; floor 0.08 at weight 6): it sits at the
  //     edge the bench can see.
  //   potion-base-8M@256, LAGGED 0.05 / 1 — today's weight with potion's floor,
  //     because on this path the cue can be about the PREVIOUS subject: on topic
  //     9.8/30 within two turns against lexical-only's 8.4–9.0, and on a topic
  //     change 0 targets lost and 1.2 stale items ADDED over 40 pairs (items the
  //     lag brought that lexical-only did not deliver anyway). Heavier pairs buy
  //     little on topic and pay in stale items: 0.08 / 2 reaches 10/30 for 2.6
  //     added, weight 6 at floor 0.15 or below loses a topic-changed target and
  //     adds 15–26, floor 0 at weight 8 reaches 14.8/30 for 39 added.
  //   voyage-3-large — UNMEASURED (no key in the bench; the seat is frozen): the
  //     values every Voyage store has always had, pinned here so the fallback is
  //     not the only thing standing between a paid store and a new default.
  //
  // One synthetic persona with builder-written queries is a first measurement,
  // not a calibration; the recall-bench's labelled real prompts should re-earn it.
  SEMANTIC_BY_IDENTITY: {
    "potion-base-8M@256": { inline: { floor: 0.15, weight: 6 }, lagged: { floor: 0.05, weight: 1 } },
    "voyage-3-large": { inline: { floor: 0.45, weight: 1.0 }, lagged: { floor: 0.45, weight: 1.0 } },
  },
  // 100,000 (CAL, 2026-10-19, ~/counterparts-notes/2026-10-19-first-prompt-recall-diagnosis.md):
  // measured cold, in a fresh process per run, the in-line rank added ~18 ms
  // at the live store's 2,207 vectors and ~60 ms p50 (~160 ms p95) at 22,207,
  // against a 1,200 ms budget the live recall build uses ~45 ms of at p50.
  // 100,000 is ~4.5x the largest size measured, still well inside the budget
  // if the scan stays linear (warm, at 10x: ~0.8 ms per 1,000 vectors).
  SEMANTIC_INLINE_MAX_VECTORS: 50_000,
  ARRIVAL_WEIGHT: 0.15,

  // 1.2 -> 1.6 (CAL, 2026-09-04). Once length normalization stopped nine hubs
  // from setting every turn's variance, the relative bar admitted far more:
  // over the 13-prompt bench, delivered items went from 2.5 to 6.1 per turn.
  // 1.6 takes that to 4.8 without losing any of the four labeled positives; at
  // 2.0 the ambient positive goes. Scale-free by construction — it is a count
  // of standard deviations — which is why it is the volume knob that shipped
  // and the absolute floors below are not. `tools/recall-bench --gate-sweep`.
  SNR_GLOBAL: 1.6,
  SNR_STRONG: 2.5,

  // ── THE FLOORS, RE-EARNED. In cue units: multiples of one maximally-rare
  // cue, `informativeness(1, storeSize)` (`gate.ts#floorUnit`).
  //
  // MEASURED 2026-09-04 on a copy of the live store (14,431 live memories,
  // unit = 8.88), over the same 13 real prompts as `CUE_LENGTH_NORM` above.
  // With document frequency finally COUNTED rather than read off the length of
  // a bounded top-K (`store/cache.ts#docFrequency`), each turn's best candidate
  // lands at, in units:
  //
  //   turn  3 → 0.88   ("thanks, as before interesting to chat with you. where
  //                      would you like to take the conversation from here?")
  //   turn  2 → 1.86 · 13 → 2.13 · 4 → 3.13 · 6 → 3.19 · 10 → 3.19
  //   turn 12 → 3.28 ·  9 → 3.55 ·  1 → 3.88 · 11 → 4.20
  //   turn  8 → 4.68 ·  5 → 4.70 ·  7 → 5.17
  //
  // The near-contentless turn is now FOUR TIMES below the busiest, on a scale
  // that says the same thing at N=17 and N=15,000 — which is what the relative
  // bar could never give (it ranked turn 3 FIRST, at 3.5 sd over its own thin
  // background). And the scale-freeness is checked at the other end rather than
  // asserted: a hermetic 17-memory fixture whose turn cleanly cues one memory
  // lands at 3.00 units, INSIDE the live store's 0.88-5.17 band, where before
  // this change the same fixture sat two orders of magnitude below the floors.
  //
  // `FLOOR_GLOBAL_UNITS` — hard gate (b), admission. A FIFTH of one
  // maximally-rare cue: below that a candidate was grazed, not cued. Swept at
  // 0 / 0.5 / 1.0 against the 13 prompts; 0 and 0.5 are identical (37
  // deliveries, 2.8 per turn) and 1.0 costs six deliveries for nothing the
  // targets asked for, so anywhere in [0, 0.5] is free on this corpus and the
  // value is chosen at the OTHER end — by the weakest signal a channel is
  // allowed to offer at full strength. That is a temporal arrival
  // (`prospective.CUE_STRENGTH` 0.5 units) and an ambiguous handle
  // (`AMBIGUOUS_WEIGHT` 0.5 of a cue that is itself rarely maximal): measured
  // at 0.41 units for a two-way "Robin" on an eight-memory store. 0.2 sits
  // under both with room. Zero is not an option — a floor of zero is the dead
  // knob this change exists to retire.
  //
  // `FLOOR_STRONG_DEFAULT_UNITS` — the loud tier. Sorted, the thirteen best
  // candidates leave their widest upper gap between 4.20 and 4.68, and 4.5 sits
  // in it: loud on 3 of 13 turns (23%, against a target of "at most about one
  // in four"), turn 3 silent, all four labeled positives kept. 4.0 gives 4 of 13
  // and 3.5 gives 6 of 13 — the same knee read one notch looser; 5.0 gives 1 of
  // 13, which is a different claim than "rarely". CAL.
  FLOOR_GLOBAL_UNITS: 0.2,
  // EMPTY, AND THE EMPTINESS IS THE MEASUREMENT. v1 shipped a per-kind shape
  // (self/person/entity 0.6, place 0.8, skill/fact 1.0) because in v1 the kinds
  // sat on different activation scales — person peaked near 0.79 where craft
  // material floored at 1.0. On v2's corpus they do not: over 312 candidate
  // rows from the 13 prompts, p50 runs 1.21-1.45 and p90 1.93-2.79 across
  // `fact`, `person`, `self`, `skill` and `entity` — one distribution, not five.
  // v2's activation is cue-driven and kind-agnostic, so there is nothing for a
  // shape to correct. Scar §2.8 says a knob ships measured or disabled: the
  // MECHANISM of §9 G12 stays (a kind that earns an override gets one), and
  // v1's unearned numbers do not ride along inside it.
  FLOOR_STRONG_BY_KIND_UNITS: {},
  FLOOR_STRONG_DEFAULT_UNITS: 4.5,
  MIN_CUE_FRACTION: 0.5,
  SAL_BAR_WEIGHT: 0.5,
  SAL_SORT_WEIGHT: 0.5,
  MAX_CANDIDATES: 24,

  COLD_START_MIN_STORE: 15,
  // 0.7 on v1's cosine scale -> 0.4 CUE UNITS: TWICE `FLOOR_GLOBAL_UNITS`, so
  // "cold start is stricter, not looser" is arithmetic rather than a comment.
  // The old number could not be carried across because the two scales do not
  // meet — on an eight-memory store one cue unit is 1.50, so v1's 0.7 was 0.47
  // units there and 0.08 units on the live store: the same numeral meaning two
  // different bars, which is the whole finding. CAL.
  COLD_START_FLOOR_UNITS: 0.4,
  COLD_START_MAX_CANDIDATES: 3,
  MIN_BACKGROUND_SAMPLE: 3,

  NEAR_DUPLICATE: 0.85,
  // 2 -> 1 (CAL, 2026-09-04). §3 says the loud tier is for RARELY, and after
  // length normalization it fired on 13 of 13 real turns. A cap could not fix
  // the TURN count — only a floor can, and the floor above now does (3 of 13) —
  // but the cap is what bounds a single turn, it is scale-free, and it halves
  // what the owner reads uninvited. Left at 1: with the loud floor in place the
  // cap binds on no turn of the 13, so raising it back to 2 would be trading a
  // measured bound for an unmeasured one.
  MAX_SURFACED: 1,
  MAX_FOOTNOTES: 6,

  LINK_POINTERS_MAX: 2,
  LINK_POINTER_MIN_FRACTION: 0.05,
  SPREAD_SEEDS: 24,
  HOP_CEILING: 1,

  HABITUATION_WINDOW_DAYS: 7,
  HABITUATION_MIN_SESSIONS: 2,
  HABITUATION_CLEAR_SCORE: 2,
  HABITUATION_BAR_LIFT: 0.5,

  PRIME_LINK_UNITS: 1,
  PRIME_TRAIN_SHARE: 0.5,
  PRIME_TRAIN_CENTRE: 1,
  PRIME_TRAIN_DECAY: 0.5,
  PRIME_SOURCE_DECAY: 0.8,
  PRIME_SOURCE_WEIGHT: { used: 1, wrote: 1, open: 0.5 },
  PRIME_HANDOFF_DAY_DECAY: 0.7,
  PRIME_MAX_SOURCES: 24,
  PRIME_TRAIN_POOL: 72,
  PRIME_CEILING: 1,
  TAGS_PRIME: true,
  TAGS_PRIME_WEIGHT: 0.1,
  TAGS_PRIME_MAX_TAG_MEMORIES: 40,
  TAGS_PRIME_NEIGHBOURS: 2,

  BELIEFS_IN_RECALL: true,
  BELIEFS_SLOT_MAX: 3,
  BELIEFS_SLOT_FLOOR: 0.3,
  BELIEF_LINE_BYTES: 200,

  AFFECT_MIN_EMOTION: 0.7,
  AFFECT_REFRACTORY_TURNS: 2,

  // Emotion part A (2026-09-26). The window is "this sitting": long enough to
  // span a working session's feelings, short enough that yesterday's mood is
  // not today's. The weights are sized against SAL_BAR_WEIGHT = 0.5: a fresh
  // same-person match at strength 0.9 adds 0.27 to salience, which lowers that
  // candidate's relative bar by ~27%; the cross-link at 0.1 moves it ~9%. A
  // match a month old has softened to ~0.2 of its strength (S_FEELING = 20;
  // an unpleasant one softens faster, a pleasant one slower — physics
  // S_FEELING_NEGATIVE) and moves the bar by ~6%. Unmeasured — recorded as a
  // working default.
  MOOD_WINDOW_HOURS: 3,
  MOOD_MIN_STRENGTH: 0.3,
  // Decided by b2+f8, 2026-10-10, lightly held. Evidence from the old use metric (lifted memories used 1.3% vs 2.4%); re-test after Group 1's engaged credit gives a real signal.
  // (Review 02 C3. Were 0.3 and 0.1; the code in `mood.ts` is kept whole, and
  // with both at 0 recall skips the per-turn `feelings` scan — `Recall#turn`.)
  RECALL_BY_PROJECT: false,
  CROSS_PROJECT_BAR_LIFT: 1.25,
  MOOD_SAME_WEIGHT: 0,
  MOOD_CROSS_WEIGHT: 0,
  // Wheel v2 (2026-09-30): 0.5 lets neighbours match in part — a sad mood
  // (−0.6) meets uneasy (−0.5) at 0.8 and wistful (−0.3) at 0.4, never calm
  // or happy; a happy one (+0.7) meets warm at 1, calm (+0.5) at 0.6.
  MOOD_VALENCE_SPAN: 0.5,
  // The review of #301 (M2), the page's own words: "so a low mood can't feed
  // itself". A sad mood still finds sad memories — a quarter as easily; a
  // pleasant or mixed match is untouched.
  MOOD_LOW_LOW_WEIGHT: 0.25,

  // U13 (2026-09-30). A fresh stamp at 0.4 brings 1.6 cue units — eight times
  // the global floor (0.2) and under the loud floor (4.5), so a feeling alone
  // is quietly available and the words decide what is loud. Six nominations
  // leave room in a 12-row answer for what the words found. Unmeasured.
  FEELING_CUE_UNITS: 4,
  FEELING_CANDIDATES_MAX: 6,

  BUDGET_BYTES: 2048,
  GIST_BYTES: 240,
  FOOTNOTE_TITLE_BYTES: 150,
  BUDGET_PRESSURE: 0.9,
  // 250 → 1200 on day 0 of the parallel run (2026-09-03): the first recall in a
  // fresh process — every hook is one — measured 794–819 ms warming the page
  // cache over a 263 MB token index after the worker's writes, and 5 of 6 real
  // turns aborted. bansai runs its surfacing at 800 ms; 1200 covers the measured
  // cold case with headroom. The structural fix (why the index churns after each
  // cycle) is the day-1 watch; this is the calibration that makes recall exist
  // in the meantime. CAL.
  BUDGET_MS: 1200,

  MAX_SESSION_RECORDS: 200,
};

export function withTunables(overrides: Partial<RecallTunables> = {}): RecallTunables {
  return { ...TUNABLES, ...overrides };
}

/**
 * The floor and weight for THIS store's recorded embedder on THIS path: the
 * exact identity tag, then its model alone, then the global defaults. `identity`
 * is what box 3 records (`recordedIdentity` in `activate.ts`), never a
 * configured one.
 */
export function semanticTuning(t: RecallTunables, identity: string | null, path: SemanticPath): SemanticTuning {
  const table = t.SEMANTIC_BY_IDENTITY;
  if (identity !== null) {
    // The model part, split exactly as the store's `parseIdentityTag` splits a
    // tag: on the LAST `@`, and only when what follows is a positive integer.
    const at = identity.lastIndexOf("@");
    const suffix = at > 0 ? identity.slice(at + 1) : "";
    const model = /^[1-9][0-9]*$/.test(suffix) ? identity.slice(0, at) : identity;
    const profile = Object.hasOwn(table, identity) ? table[identity] : Object.hasOwn(table, model) ? table[model] : undefined;
    if (profile !== undefined) return profile[path];
  }
  return { floor: t.SEMANTIC_SEED_FLOOR, weight: t.SEMANTIC_WEIGHT };
}

/**
 * The loud-tier floor for one kind, in ACTIVATION, from the per-kind override
 * table and the declared fallback (§9 G12). `unit` is `gate.ts#floorUnit` — the
 * weight of one maximally-rare cue on this store — because the table is in cue
 * units and a floor has to be a number in the same space as an activation before
 * it can refuse one.
 */
export function strongFloor(t: RecallTunables, kind: string, unit: number): number {
  return (t.FLOOR_STRONG_BY_KIND_UNITS[kind] ?? t.FLOOR_STRONG_DEFAULT_UNITS) * unit;
}
