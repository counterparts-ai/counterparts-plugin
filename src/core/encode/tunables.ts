/**
 * The TUNABLE table — every constant in `encode/`, in one visible place, the way
 * `physics/` keeps its own.
 *
 * CAL = calibration-required (scar §2.8, CONTRACT §5 G13): a threshold ships with
 * a recorded measurement against the real corpus and a fixture-bounded window
 * naming what breaks on each side, or it ships DISABLED. Every CAL entry below
 * carries the v1 measurement it inherits; the ones with no measurement to inherit
 * say so out loud.
 *
 * NOTE WHAT IS NOT HERE: there is no key that switches the secrets gate off, in
 * any spelling. That is guarantee 1, and `test/encode.test.ts` source-scans for it.
 */

export const TUNABLES = {
  // --- the content floor (§3, earned-mechanism #3) ---
  /** CAL [v1: 20 chars, set at about HALF the shortest real memory in v1's own
   *  fixtures]. Window: below ~12 the literal `"placeholder"` trace that minted
   *  this mechanism survives; above ~40 real one-line memories ("Mike uses bun,
   *  not npm") start dying. */
  FLOOR_MIN_CHARS: 20,
  /** CAL [v1: 3 words, same fixture calibration]. Window: 2 admits "no thoughts";
   *  4 kills real short facts. */
  FLOOR_MIN_WORDS: 3,
  /**
   * The stub vocabulary. Matched EXACTLY after normalization, never as a
   * substring — so "keeps a TODO list in vim" survives while a bare "todo" does
   * not (§3). [A] advisory: the LIST is a preference, that the floor EXISTS is
   * mechanized (§5 G12).
   */
  STUB_TOKENS: [
    "placeholder",
    "todo",
    "tbd",
    "n/a",
    "na",
    "none",
    "nothing",
    "null",
    "undefined",
    "test",
    "example",
    "sample",
    "lorem ipsum",
    "xxx",
    "no content",
    "no memory",
    "nothing to record",
    "nothing of note",
  ] as readonly string[],

  // --- aliases (§3) ---
  /** [A] TUNABLE minimum alias length. Below this an alias is a retrieval hazard,
   *  not a handle: one- and two-character aliases match everything. */
  ALIAS_MIN_CHARS: 3,

  // --- precision hedging (§3; [A] phrasings are preferences, §5 G12) ---
  HEDGE_YEAR: (year: string) => `around ${year}`,
  HEDGE_EARLY: (month: string) => `early ${month}`,
  HEDGE_MID: (month: string) => `mid-${month}`,
  HEDGE_LATE: (month: string) => `late ${month}`,

  // --- encode-time preselection (§8) ---
  /**
   * CAL [v1: 0.60, measured — 8 schema vectors x 13,608 traces, voyage-3-large:
   * all-pairs median cosine 0.576, best-per-trace median 0.635]. Window: the
   * intuitive 0.35-0.45 is INERT (clears 99% of pairs); above ~0.70 the channel
   * adds nothing the lexical channel did not already have.
   *
   * OPEN (CONTRACT open question 2, v1's own live watch): 0.60 was calibrated on
   * TRACE-length text and is applied here to CHUNK-length text, where dilution
   * may pull real chunks below it. Recalibrate on the text length v2 actually
   * sees before trusting this number.
   */
  SEMANTIC_FLOOR: 0.6,
  /** CAL [v1: 2]. A cap is a guard against re-inflating what a fix deflated —
   *  two slices is a rounding error against a 16 KB chunk; ten is the old cost
   *  back by another door. Zero means the channel is deliberately OFF (silence),
   *  which is a different record from a skip (§5 G8). */
  SEMANTIC_CAP: 2,
  /** [A] CHARACTER budget for the compressed identity-core render (§8 G7).
   *  v1's 6,144 was a BYTE budget; this counts JS characters, which is the same
   *  number for ASCII and smaller for anything else — the safe direction, and the
   *  one the elision notice can honestly report. Beliefs and current state are
   *  NEVER compressed: a paraphrase of a belief cannot be honestly confirmed or
   *  contradicted. */
  IDENTITY_CORE_BUDGET: 6144,

  // --- the emotion classifier channel (CONTRACT §4) ---
  /**
   * Ships DISABLED and stays disabled until it re-earns its fired-cue precision
   * bar against a held-out reference set (§17.3: "do not enable a channel on a
   * rewrite's promise"). This is a CHANNEL, not one of the five gates: the
   * stated-only emotion GATE runs on every proposal regardless.
   */
  EMOTION_CLASSIFIER_ENABLED: false,
  /** The bar the classifier must clear before the flag above may flip. */
  EMOTION_CLASSIFIER_PRECISION_BAR: 0.8,
} as const;
