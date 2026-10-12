/**
 * `physics/` — all the arithmetic of memory on one page.
 *
 * Implements CONTRACT.md §5 exactly (including the 2026-08-25 rewrites of §5.3
 * bands and §5.6 revision). PURE FUNCTIONS ONLY: no I/O, no model calls, no
 * imports beyond `../types.js` and this module's own clock. Guarantee 1 is a test
 * that asserts precisely that.
 *
 * Nothing here mutates its arguments. Every state-changing operation returns the
 * NEXT values for the caller to persist, plus the verdict and the reason for it.
 * Reasons are first-class: a bare boolean cannot be told apart from a bug
 * (scar §2.4 — "a number in a log is not a monitor").
 *
 * Implementation choices where the contract is silent are recorded in NOTES.md.
 */

import type { Band, Kind, MemoryPhysics, Salience } from "../types.js";
import { BOUNDARY_HOUR_DEFAULT } from "./clock.js";

export { dayKey, livedDay, livedDaysBetween } from "./clock.js";
export type { Band, DatedHold, Kind, MemoryPhysics, Salience } from "../types.js";

// ---------------------------------------------------------------------------
// The TUNABLE table — every constant in physics, in one visible place.
// CAL = calibration-required: it must ship with a recorded measurement against
// the real space, or ship disabled (scar §2.8, guarantee 11).
// ---------------------------------------------------------------------------

export const TUNABLES = {
  // --- §5.2 strength ---
  /** Repetition credit per use [v0, verbatim]. RETIRED from `rep()` on
   *  2026-10-11 (`drewOn`, the engaged tier): the arm saturates instead
   *  (below). Kept so the old linear arm can be named and restored in one line. */
  REP_PER_USE: 0.12,
  /**
   * THE REPETITION ARM SATURATES (2026-10-11, with the engaged tier; ported
   * from #371): `rep = REP_CAP x (1 − e^(−uses / REP_SCALE_USES))` — 0.14
   * after one use, 0.24 after two, 0.40 after five, never a cliff at the cap.
   * Was `min(0.12 x uses, 0.5)`, linear to a wall. With `drewOn` (half a use
   * for a memory the session says it drew on) use can come more often, and
   * each further use must add less. Built by the drewOn builder, 2026-10-11,
   * from Mike's 10-10 direction, lightly held. Why: review 05 C2/D3; the shape
   * keeps "the 5th use adds clearly less than the 1st" at any intake.
   */
  REP_SCALE_USES: 3,
  /** Repetition cap [v0; v1 §10 G11]. Repetition is also no road to the
   *  identity band for any kind but `self`/`person` — guarantee 4, now a rule of
   *  `promotionEligibility` rather than a threshold (§5.3, 2026-09-26). */
  REP_CAP: 0.5,
  /**
   * The one-time consolidation bonus [v0, verbatim] — now a LEGACY path
   * (2026-09-26): only a memory born before schema v8 (`legacy`) can still be
   * marked consolidated and carry it, so the upgrade moves nothing down. Every
   * memory made since earns its durability from RETURNS (§5.11) instead.
   */
  CONS_BONUS: 0.2,

  // --- §5.3 bands ---
  /** Semantic floor, evaluated on DECAYED strength (§5.3 rewrite). */
  THETA_SEM: 0.5,

  // --- §5.11 returns (owner decisions 2026-09-26 — WORKING DEFAULTS) ---
  /**
   * How spacing weighs a return: `1 - exp(-gap / RETURN_SPACING_DAYS)`, `gap`
   * the lived days since the memory's previous counted return (or its birth).
   * 7 gives 0.13 the next day, 0.35 after three, 0.63 after a week and 0.95
   * after three weeks — full weight once forgetting has visibly started (a fact
   * with S = 60 has lost ~11% by day 7). Harvested from #238's spacing credit,
   * with its penalty DROPPED: this scales what a return adds to durability and
   * nothing else — `uses`, `lastUsedDay` and the rep arm credit exactly as
   * before, so close-together use never counts against a memory. CAL.
   */
  RETURN_SPACING_DAYS: 7,
  /**
   * How much the returns lengthen stability: `x (1 + RETURN_GAIN x ln(1 +
   * returns))`. One full-weight return x1.69, three x2.39, ten x3.40 — each
   * spaced return slows fading, with diminishing returns (the log), and never
   * makes a memory immortal. 1 at zero returns, so no memory's curve moves at
   * the upgrade. NOTES "Returns" has the 60-day simulation. CAL.
   */
  RETURN_GAIN: 1.0,
  /** A dream replay counts as a return worth this fraction of an awake one
   *  (owner: "start ~0.5"), at most once per dream per memory. CAL. */
  DREAM_RETURN_WEIGHT: 0.5,
  /**
   * A REFLECTION's return (v9, 2026-09-27): the waking self deliberately
   * revisited and cited the memory. Lived, so full awake weight for
   * durability (spacing-scaled like any return). CAL.
   */
  REFLECTION_RETURN_WEIGHT: 1.0,
  /**
   * An ENGAGED use's return (2026-10-11, `drewOn`; ported from #371): the
   * session said it drew on a memory it was shown, without opening it. Half a
   * return, spacing-scaled like the others, and no core-lane day of its own
   * (`returns.source = 'engaged'` is outside the lanes' `awake`/`reflection`).
   * Lightly held. Why: review 05 D1; saying you drew on something is weaker
   * evidence than opening it.
   */
  ENGAGED_RETURN_WEIGHT: 0.5,
  /**
   * What an engaged return will count for toward the core's RECURRENCE lane
   * (b2+f8, 2026-10-10: half weight, and never alone). NOTHING READS IT YET:
   * the recurrence lane is Group 3's (mechanisms synthesis, Group 3
   * consolidation) and is not built — today's slow lane counts `awake` and
   * `reflection` days only (`store#recomputeReturns`), so an engaged return
   * buys no lane day at all. This is the hook that lane reads when it lands.
   */
  ENGAGED_RECURRENCE_WEIGHT: 0.5,
  /**
   * A reflection counts a memory as returned at most once every this many
   * lived days (working default 2026-09-27): "the reflection can't cite the
   * same memory every night", and the SLOW lane gets at most one reflection
   * day a week from it — so reflection alone cannot carry a memory through
   * the slow lane's five days in ~10 (it would take four weeks of weekly
   * citing). A citation inside the window still stands in the entry; it just
   * is not a return. CAL.
   */
  REFLECTION_SPACING_DAYS: 7,
  /**
   * The claimed-salience ceiling for a DREAMED memory (a dream's gist or
   * pattern, source `dreamed`): below the semantic floor, so what a dream
   * concludes starts lower than anything lived and rises only by proving true
   * awake — used (the rep arm, returns) or confirmed. Above the
   * `AUTHORED_DEFAULT_CLAIM` a silent note gets, so a gist is not prunable
   * from birth, and below `THETA_SEM`. CAL.
   */
  DREAMED_CLAIM_CEILING: 0.3,

  // --- §5.3 core lanes (owner decisions 2026-09-26 — WORKING DEFAULTS) ---
  /** Fast lane: strongly felt — `emotionalIntensity` at or above this, his
   *  feeling or mine. CAL. */
  CORE_FAST_FEELING: 0.6,
  /**
   * CAL. "STRONGLY FELT", RELATIVE TO THE WORD (2026-10-10, Group 1c; review
   * 08 C3). Wheel v2 (09-30) gave every word a default strength, and every
   * core's default is at or under 0.55, so a feeling written without a number
   * could not reach `CORE_FAST_FEELING` and the fast lane shut on day 10 (1 of
   * 44 feelings after it was at 0.6). A feeling now counts as strongly felt
   * when it is at least this much above its own word's default — the writer
   * meant more than ordinary — or at `CORE_FAST_FEELING` absolute. The default
   * is the one the store writes (`store/feelings.ts#defaultStrength`, capped at
   * 0.55), so a feeling nobody weighed still never opens the lane. Read off the
   * feelings themselves in consolidation (`sleep/consolidate.ts#stronglyFelt`,
   * `CoreContext.stronglyFelt`); a bare `emotional` score has no word and is
   * read at `CORE_FAST_FEELING` alone. Decided by g1c-builder, 2026-10-10,
   * lightly held; revisit after ~5 lived days. Why: 08 C3's own reading
   * ("`strength − feelingNumbers(word) ≥ 0.1`"), so a defaulted word does not
   * pass and a writer who raised it does.
   */
  CORE_FAST_ABOVE_DEFAULT: 0.1,
  /**
   * CAL. …and never under this, however far above its default (2026-10-10,
   * review of #369; decided by b2+f8, lightly held): a word whose default is
   * low (calm's 0.35) recorded at 0.45 is above its default, not strongly felt.
   */
  CORE_FAST_RELATIVE_FLOOR: 0.5,
  /**
   * Does the fast lane's feeling read feelings a REFLECTION recorded later
   * (v9, `feelings.source = 'reflection'`; since 2026-10-02 an awake one too,
   * `'awake'`)? Default OPEN — the owner's call of
   * 2026-09-27, held lightly: nearly all sessions are straight work with
   * little typing, so what matters may never come up in the moment, and a
   * memory has to be able to reach the core on reflection alone. Such a
   * promotion is SHOWN to him — its record names the returns' sources, doctor
   * counts "promoted on reflection alone", and the next morning share says it
   * — not gated on him. Closed (`false`), the fast lane reads only feelings
   * felt at the time or written in a session, and its return must be an
   * ordinary use, not a reflection's citation (`CoreContext.organicReturnDay`;
   * owner ruling D1 on #256: closed is fully closed). Height and decay read
   * every feeling either way. The owner flips it without a release
   * (`counterparts core --reflected-feeling off|on`, a meta row the
   * consolidate phase reads); this is the default when the row is absent.
   */
  CORE_FAST_ACCEPTS_REFLECTED_FEELING: true,
  /** Fast lane: "and it has come back at least once after a gap" — an awake
   *  return at least this many lived days after the memory was made (2 = not
   *  the very next day). CAL. */
  CORE_FAST_GAP_DAYS: 2,
  /** Slow lane: awake returns on at least this many distinct lived days… CAL. */
  CORE_SLOW_DAYS: 5,
  /** …spanning at least this many lived days, first return to last. CAL. */
  CORE_SLOW_SPAN_DAYS: 21,
  /** …and standing at least this strong (decayed) on the day it is promoted:
   *  the semantic floor, so a faint memory does not become core on repetition
   *  alone (working default 2026-09-26, review of #251). CAL. */
  CORE_SLOW_FLOOR: 0.5,
  /**
   * The salience-claim ceiling for a FALLBACK-minted memory (owner ruling
   * 2026-08-29, the authorship doctrine's salience half): the experiencer's own
   * "remember this" commands the full 0-1 floor — lived testimony, the analog
   * of affect stamping a memory vivid at encoding — but the crash fallback's
   * author is a model retelling a transcript after the fact, and a reteller's
   * claim is CAPPED. The first blind replay showed why: 97.9% of sweep mints
   * self-claimed importance (mode 0.8), parking ~75% of the store above
   * THETA_SEM with no independent check (review F5). 0.6 clears the semantic
   * floor (a crashed day still matters); identity is reached only through the
   * core lanes (§5.3), never by a claim. WORKING DEFAULT — to be revisited
   * against the re-run's watch metrics.
   */
  SWEEP_CLAIM_CEILING: 0.6,
  /**
   * CAL. The claimed floor an AUTHORED memory gets when its author claimed
   * nothing — the authorship doctrine's other half, measured 2026-09-04 on the
   * live parallel-run store: all 48 authored memories carried
   * relevance/emotional/predictive = 0, so an unclaimed note's `sal(m)` was
   * ZERO. It was the weakest thing in the store, first to decay, and (now that
   * `challengeForce = strength x sal`) any revision it declared pushed with no
   * force at all — the exact inversion of "the experiencer's testimony is
   * trusted". Silence is the common case: the asks never say to set salience.
   *
   * WHY THIS NUMBER, and it is arithmetic rather than taste:
   *   - `AUTHORED_DEFAULT_CLAIM + CONS_BONUS = 0.45 < THETA_SEM = 0.5`, and the
   *     largest `wSal` is 1.0, so a defaulted memory CANNOT reach the semantic
   *     band on the default alone — not even after consolidation. It gets there
   *     only by being used (rep 0.3 needs 3 credited days) or by an author
   *     actually claiming something. That is the structural form of v1's scar:
   *     a mode-0.8 self-claim parked ~75% of the store above THETA_SEM.
   *   - 0.25 < 0.34, the measured mean of the claims authors DID make, so
   *     staying silent says strictly less than speaking.
   *   - 0.25 < SWEEP_CLAIM_CEILING = 0.6: the default is a floor under the
   *     lived channel, not a promotion of it over the retelling channel.
   *   - It buys survival rather than rank: at kind `fact` it is not prunable
   *     from birth. (Under the 2026-10-10 curve a never-used 0.25 fact leaves
   *     reach in ~2 lived days and reaches PHI_PRUNE = 0.02 in ~34; it was ~152
   *     under the old exponential with S = 60.)
   * ENGINE-SET off the mint CHANNEL, exactly like `SWEEP_CLAIM_CEILING`; an
   * explicit claim, however low, is never overridden. WORKING DEFAULT.
   */
  AUTHORED_DEFAULT_CLAIM: 0.25,
  /**
   * CAL. THE DEFAULT BY WHAT A MEMORY IS ABOUT (2026-10-10, Group 1c; review
   * 01 C2). One constant gave every unclaimed memory 0.25 whatever it was, and
   * the claims the writers DID make ran backwards — work events 0.54 against
   * readings 0.41 on the 10-10 snapshot. Keyed on fields the writer already
   * fills (`about`, `status`, `said_by`, `kind`), `defaultClaimFor`:
   *
   *   - a done work event (`about=work`, `status=done`): `DEFAULT_CLAIM_WORK_EVENT` (0.20);
   *   - other work, and an unmarked memory: `AUTHORED_DEFAULT_CLAIM` (unchanged);
   *   - the world (readings, news): `DEFAULT_CLAIM_WORLD`;
   *   - the owner, us or me — or said by the owner, or kind self/person:
   *     `DEFAULT_CLAIM_PERSONAL`.
   *
   * Every default stays below `THETA_SEM`. It sets HEIGHT and (through the
   * curve) stability, never the band: a strong feeling on top cannot carry it
   * across the semantic floor either (`salArm`'s `FELT_HEIGHT_CAP`), so a
   * silent memory reaches the semantic band only by being used. Decided by
   * g1c-builder, 2026-10-10, lightly held; revisit after ~5 lived days. Why:
   * 01 D2's table as written; f8: "that sets stability, not the band".
   */
  /** Decided by b2+f8, 2026-10-10, lightly held: 0.20, not 01's 0.10. G1a's
   *  REACH is 0.15, so 0.10 started a routine work event below reach — never in
   *  ambient recall or the wake's "Work here". f8: routine work is remembered
   *  weakly "for a day or two"; at 0.20 with no feeling it stays in reach about
   *  one lived day. */
  DEFAULT_CLAIM_WORK_EVENT: 0.2,
  DEFAULT_CLAIM_WORLD: 0.35,
  DEFAULT_CLAIM_PERSONAL: 0.4,

  // --- §5.4 decay (2026-10-10, Group 1: the curve, mechanisms review 03 C1) ---
  /**
   * Stability at q = 0, in lived days: `S = S0 · e^(G·q) · uses · returns / κ`
   * (`stability`). 0.4 makes a memory nobody claimed or felt leave reach the
   * day after it was written; a default 0.25 note (S ≈ 3) leaves in ~2 lived
   * days; a 0.5 one (S ≈ 22) in ~7 weeks; a 0.7 fact (S ≈ 109) in about a
   * year. Was `S_BASE = 60` for every memory, so nothing fell below anything
   * for ~100 lived days (review 03 §3).
   *
   * Decided by b2+f8, 2026-10-10, lightly held; revisit after ~5 lived days.
   * Why: steep early, flat for strong — routine items leave the working layer
   * in days, readings and felt things stay for months (03 §5 design table).
   */
  S0: 0.4,
  /**
   * How steeply stability grows with q (salience, plus half the feeling):
   * `e^(G·q)`, ×7.4 per 0.25 of q, ×3000 across the whole range. Decided by
   * b2+f8, 2026-10-10, lightly held; revisit after ~5 lived days. Why: the
   * spread between a routine note and a felt reading has to be seen in DAYS
   * vs MONTHS, and kind spans only ×2 (03 D2).
   */
  STABILITY_GAIN: 8,
  /**
   * How much a memory's emotional intensity adds to q, the input that sets its
   * steepness: `q = clamp01(sal + EMO_Q · I)`. Replaces `EMO_SLOPE` (stability
   * × (1 + 0.5·I), at most ×1.45 — a factor nobody could see). Through
   * `e^(G·q)` a 0.6 feeling now multiplies stability by e^2.4 ≈ ×11.
   * Decided by b2+f8, 2026-10-10, lightly held; revisit after ~5 lived days.
   * Why: feeling was the one signal that separated readings from changelog on
   * the live store (38/49 vs 6/131, review 02/03), so it sets the slope; it is
   * counted ONCE for height (`EMO_LIFT`) and once for slope (here) — not also
   * in `sal()`'s mean (02 C1).
   */
  EMO_Q: 0.5,
  /** Use-stability coupling; logarithmic so a well-used memory slows without
   *  becoming immortal. */
  BETA: 0.5,
  /** Local rollover hour for the active-day clock (see clock.ts). */
  BOUNDARY_HOUR: BOUNDARY_HOUR_DEFAULT,
  /**
   * The curve's shape. Power-law (hyperbolic) since 2026-10-10: steep early and
   * flat late INSIDE one memory's curve, which an exponential cannot be (03 D1;
   * Wickelgren, Murre & Dros, and the site's own "retention fits a power law").
   * Decided by b2+f8, 2026-10-10, lightly held; revisit after ~5 lived days.
   * Revision PRESSURE stays exponential (`pressureAt` names its shape): the
   * pressure curve is the revision model's, not this one, and Group 2 owns it
   * (decided by g1a-builder, 2026-10-10, lightly held).
   */
  DECAY_SHAPE: "power-law" as DecayShape,
  /** The power-law exponent ψ: `(1 + t/S)^−ψ`. 1 = hyperbolic (03 D1). */
  POWER_LAW_PSI: 1.0,
  /**
   * BELOW REACH (2026-10-10, Group 1, review 03 C2): strength under this and a
   * memory is left out of every AMBIENT channel — turn recall's surfaced and
   * footnote tiers, spreading's landings, the wake's work lines — while
   * deliberate recall still finds it (facts mode: ranked with the rest, its
   * words shown, labeled faded — 2026-10-10; meaning mode: after the arc).
   * A computed state, never stored, never a deletion: a use, a deliberate open
   * or a dream replay brings it back. One threshold for "faded" everywhere
   * (it replaces deliberate recall's `FADED_RETAINED`). The identity band is
   * never below reach. Must sit below encoding's routine default or routine
   * items are born out of reach (03 D3).
   *
   * Decided by b2+f8, 2026-10-10, lightly held; revisit after ~5 lived days.
   * Why: forgetting in awareness, never in storage — strength has to gate what
   * comes to mind, or decay changes nothing anybody sees.
   */
  REACH: 0.15,
  /**
   * THE DATED HOLD's grace (2026-10-10, review 07 C1): a memory with a future
   * date is held (t = 0) through its date and this many calendar days after,
   * the same window `prospective/` keeps open for its grace beat — so the
   * reminder is not below reach while its window can still fire. Prospective's
   * `GRACE_DAYS` defaults to this number (one rule, one owner).
   * Decided by g1a-builder, 2026-10-10, lightly held; revisit after ~5 lived
   * days. Why: the synthesis says "while event_date ≥ today"; a missed day's
   * late beat (Group 5) and the open window's quiet fire both need the memory
   * in reach for the grace week too.
   */
  HOLD_GRACE_DAYS: 7,
  /**
   * A REPEATING date is held through each occurrence's window: from this many
   * calendar days before it (prospective's `LEAD_DAYS`, which defaults to this
   * number) to `HOLD_GRACE_DAYS` after. Between windows it fades on its curve,
   * as the owner's 2026-10-09 design says ("its strength still decays for
   * recall and display"); each occurrence told is a use. Decided by
   * g1a-builder, 2026-10-10, lightly held; revisit after ~5 lived days. Why:
   * ambient recall now leaves out what is below reach, and a yearly date used
   * once a year would be below reach on the very day it comes round.
   */
  HOLD_LEAD_DAYS: 3,

  // --- §5.1 salience ---
  /** CAL. Size of the nearest-neighbour slice in E(m) for novelty (v1's top-M). */
  K_NEAREST: 8,

  // --- §5.10 emotion (owner decisions 2026-09-25/26 — WORKING DEFAULTS) ---
  /**
   * How much a memory's emotional intensity ADDS to its salience arm (§5.2):
   * `clamp01(sal + EMO_LIFT x I)`. Before this, a 0.9 `emotional` on a note
   * with no other dimensions read as mean 0.3 — the feeling averaged away by
   * the claimed floor. 0.15 is chosen so the lift is felt but cannot on its
   * own carry a silent note across a band: `AUTHORED_DEFAULT_CLAIM + EMO_LIFT
   * = 0.40 < THETA_SEM` (a strong feeling alone does not make a silent note
   * semantic at birth; use still has to) — since 2026-10-10 that is held by
   * `FELT_HEIGHT_CAP`, not by this sum, because the default by what a memory
   * is about reaches 0.40. The lift is height only: identity
   * reads the FEELING itself, in the core fast lane (§5.3, 2026-09-26), and
   * only for memories about me or about us. NOTES.md "Emotion, part A" has
   * the simulation. CAL.
   */
  EMO_LIFT: 0.15,
  /**
   * CAL. THE HIGHEST A FEELING ALONE CAN LIFT A MEMORY (2026-10-10, Group 1c):
   * just under `THETA_SEM`. The lift used to be safe by arithmetic — the only
   * silent default was 0.25, and 0.25 + EMO_LIFT = 0.40 — but the default by
   * what a memory is about reaches 0.40 for the owner, us and me, and 0.40 +
   * 0.15 x 0.9 = 0.535 would start a silent, strongly felt memory semantic.
   * Feeling sets stability, not the band (b2 and f8's decision #7): a memory
   * whose own salience is below the floor is lifted at most to here, and one
   * already at or above it keeps the whole lift. Decided by g1c-builder,
   * 2026-10-10, lightly held; revisit after ~5 lived days. Why: a cap on the
   * lift rather than on the default keeps the default's height and needs no
   * new column or meta read; it also covers a feeling recorded later (a
   * reflection's, an awake one), which a cap at the mint could not.
   */
  FELT_HEIGHT_CAP: 0.49,
  /**
   * How fast a recorded FEELING softens, in lived days: `strength x
   * exp(-age / S)`, age counted from the lived day the feeling was RECORDED
   * (`feelings.recorded_day`, v13 — before v13, the memory's birth day, so a
   * feeling a reflection added weeks later read as already softened). 20 lived
   * days is the owner's "the feeling softens faster than the fact": half the
   * feeling is gone in ~14 lived days. Softening is READ-SIDE ONLY — the table keeps the
   * strength as recorded, and height and slope use that recorded peak; the
   * softened value is what mood-matching, recall's feeling lane and the
   * displays read. S_FEELING is the clock of a NEUTRAL feeling (valence 0, or
   * one read without its valence). CAL.
   */
  S_FEELING: 20,
  /**
   * VALENCE-ASYMMETRIC SOFTENING (wheel v2, 2026-09-30): an unpleasant feeling
   * softens faster than a pleasant one — the fading affect bias (the emotion
   * research §3.2: the hurt goes out of a bad memory sooner than the warmth
   * out of a good one, while the memory itself stays). S runs from S_FEELING
   * at valence 0 to S_FEELING_NEGATIVE at −1 and S_FEELING_POSITIVE at +1, in
   * proportion: at the cores' defaults angry (−0.7) softens on ~15.8 lived
   * days, sad (−0.6) ~16.4, happy and warm (+0.7) ~25.6. Read-side only, like
   * S_FEELING: it never touches the memory's height, slope or durability,
   * which read the recorded peak. CAL.
   */
  S_FEELING_NEGATIVE: 14,
  S_FEELING_POSITIVE: 28,

  // --- §5.5 reinforcement ---
  /** Retrospective credit weights by tier. The ignorable tier never trains. */
  W_REFERENCED: 1.0,
  /**
   * The session said it DREW ON a memory it was shown (`drewOn` on
   * `session_end` / `chapter`, 2026-10-11): half a use. Display alone still
   * trains nothing — `W_FOOTNOTED` stays 0. Built by the drewOn builder,
   * 2026-10-11, from Mike's 10-10 direction, lightly held. Why: review 05 D1.
   */
  W_ENGAGED: 0.5,
  W_SURFACED: 0.25,
  W_FOOTNOTED: 0.0,

  // --- §5.6 revision ---
  /** Pressure stability, lived days. Same curve FAMILY as memory decay, its own
   *  constant: challenge persistence is not the target's use history (NOTES.md). */
  S_PRESSURE: 60,
  /** Slow-kind daily force cap (iota >= SLOW_KIND_IOTA: self, person). Without
   *  it, one flawless claimed-maximal challenge (F = 1.0) crosses even the
   *  highest self bar (0.9) in a single day, and the ratified "one odd act
   *  doesn't rewrite your model of a friend" ~3-day property is an
   *  approximation, not a bound. 0.35 x 3 days > 0.9 max bar => >= 3 lived days
   *  is now arithmetic. Fast kinds are deliberately uncapped: world-state
   *  should flip on one clear correction. TUNABLE. */
  F_DAY_CAP_SLOW: 0.35,
  /** The iota threshold above which a kind is "slow" for the daily cap. */
  SLOW_KIND_IOTA: 0.8,
  /** Lived days a superseded version stays resolvable. TUNABLE default —
   *  assistant-recommended, explicitly NOT an owner ruling. */
  H_SUPERSEDED_DAYS: 90,

  // --- §5.7 dedup ---
  /** CAL, and the sharpest instance of scar §2.8: in v1's embedding space
   *  arbitrary same-corpus pairs sat at median cosine 0.576, so an intuited
   *  floor is inert. Do not ship this number unmeasured. */
  TAU_DUP: 0.95,

  // --- §5.8 forgetting ---
  /** CAL, and the one constant here with NO ancestry — v1 never pruned, so there
   *  is no measurement to inherit (open question 5). */
  PHI_PRUNE: 0.02,
  /**
   * Lived days of dwell (since the last use, return or replay — `decayAnchor`)
   * before a memory under `PHI_PRUNE` may be archived. 90 until 2026-10-10,
   * which made the first possible exit lived day 91 on every store (review 03
   * §3). Exit is ARCHIVAL, never deletion: an archived row keeps its words and
   * stays readable by id (`sleep/prune.ts`; synthesis §8 A).
   * Decided by b2+f8, 2026-10-10, lightly held; revisit after ~5 lived days.
   * Why: exit should follow reach — a default note leaves reach in ~2 lived
   * days and reaches the floor in ~34; felt or salient memories take months
   * to years (03 C3).
   */
  D_FLOOR_DAYS: 14,

  // --- guarantee 12: the symmetry counter (scar §2.10) ---
  /** Stated expected ceiling on up-moves : down-moves. v1's ratchet read
   *  279:0 — this is the tripwire that would have fired. CAL. */
  SYMMETRY_MAX_UP_DOWN_RATIO: 4,
  /** Below this many moves, the answer is "never asked", not "healthy"
   *  (scar §2.4: "did not fire" and "was never asked" are different records). */
  SYMMETRY_MIN_SAMPLE: 20,

  // --- §5.12 a changed fact fades once (2026-09-29, contradictions) ---
  /**
   * What a memory's DECAY is multiplied by, once, when it is settled as
   * `changed` — true at its time, not now ("used React, now Vue"). 0.5 halves
   * its strength today; ordinary forgetting does the rest, and a real use
   * re-anchors the curve like any other (FadeMem's graded weakening, not a
   * switch). Working default from the 2026-09-29 brief ("start around half").
   * CAL.
   */
  CHANGED_FADE: 0.5,

  // --- §5.2 per-kind physics [v1 §4.3] ---
  /** CAL, all of it. v1 recorded which ARM DRIVES, not a weight, so every
   *  non-driving omega below is a proposed reading, not a measurement
   *  (open question 3 asks whether the 0.4s exist at all).
   *
   *  SKILL AND PLACE SALIENCE WEIGH 1.0 (2026-10-10, review of #372; was 0.4).
   *  Decided by Mike, 2026-10-10, loosely held (b2 and f8 proposed it); revisit after ~5 lived
   *  days. Why: under the reach line a 0.4 weight put every skill claimed
   *  under 0.375 below reach from birth (a 0.25 skill was born at 0.10), and
   *  one deliberate open could not bring it back; procedural memory is the
   *  slowest to fade in the brain, not the first to vanish. If skill notes are
   *  over-produced, that is encoding's to fix, not a special weight's. (Open
   *  question 3 answered for these two kinds: no 0.4.) */
  KINDS: {
    //         driver (v1)    omega_sal  omega_rep  kappa  iota
    self: { wSal: 1.0, wRep: 0.0, kappa: 0.7, iota: 0.9 },
    person: { wSal: 1.0, wRep: 0.0, kappa: 0.75, iota: 0.8 },
    entity: { wSal: 1.0, wRep: 1.0, kappa: 0.85, iota: 0.5 },
    skill: { wSal: 1.0, wRep: 1.0, kappa: 0.5, iota: 0.25 },
    place: { wSal: 1.0, wRep: 1.0, kappa: 0.85, iota: 0.25 },
    fact: { wSal: 1.0, wRep: 1.0, kappa: 1.0, iota: 0.2 },
  } as const satisfies Record<Kind, KindPhysics>,
} as const;

export interface KindPhysics {
  /** Weight on the salience arm of `base` (§5.2). */
  wSal: number;
  /** Weight on the repetition arm of `base` (§5.2). */
  wRep: number;
  /** Decay multiplier — it DIVIDES stability: fact (1.00) erodes fastest,
   *  skill (0.50) slowest (§5.4). */
  kappa: number;
  /** Revision inertia — the fraction of the target's strength a challenge must
   *  out-sum to land (§5.6). */
  iota: number;
}

export type DecayShape = "exponential" | "flat" | "power-law";

export function kindPhysics(kind: Kind): KindPhysics {
  return TUNABLES.KINDS[kind];
}

// ---------------------------------------------------------------------------
// Small shared arithmetic
// ---------------------------------------------------------------------------

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Distinct reinforced lived days; an absent field reads as 0 (the
 *  promotion-blocking direction, so an un-migrated row cannot be promoted). */
export function reinforcedDays(m: Pick<MemoryPhysics, "reinforcedDays">): number {
  return m.reinforcedDays ?? 0;
}

/** Cosine similarity over caller-supplied vectors. Physics never fetches one. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dimension mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// §5.1 Salience, fixed at encoding
// ---------------------------------------------------------------------------

/**
 * novelty = 1 - max cos( v(m), v(e) ) over the schema slice E(m).
 *
 * E(m) EMPTY — a blind chunk — yields `null`, RECORDED, never defaulted to a
 * number (scar §2.9: blind encoding must be countable, not invisible).
 * Vectors are inputs; this module never fetches one.
 */
export function novelty(
  v: readonly number[],
  context: readonly (readonly number[])[],
): number | null {
  if (context.length === 0) return null;
  let best = -1;
  for (const e of context) best = Math.max(best, cosine(v, e));
  return clamp01(1 - best);
}

/** True when novelty could not be computed — the countable blind-write case. */
export function isBlindEncoding(s: Salience): boolean {
  return s.novelty === null;
}

/**
 * sal(m) = mean of the salience dimensions, floored by the author's claim.
 *
 * FEELING IS NOT IN THE MEAN (2026-10-10, Group 1, review 02 C1). Until then
 * this was v0's mean of four — novelty, relevance, emotional, predictive — and
 * the same feeling counted again in height (`EMO_LIFT`) and slope. Now emotion
 * reaches a memory's strength twice and only twice, each once: its height
 * through `salArm` (`EMO_LIFT x I`) and its steepness through `stability`'s q
 * (`EMO_Q x I`). The numeric `emotional` score stays on the row as an input to
 * `emotionalIntensity` (I is the max of it and the recorded feelings).
 * Decided by b2+f8, 2026-10-10, lightly held; revisit after ~5 lived days.
 * Why: one feeling, one count for height (02 D1).
 *
 * With novelty present the mean is of three; with novelty null it is the mean
 * of the TWO author-supplied dimensions — the null case specified, not
 * implicit (review finding 2), and never a defaulted zero or one.
 */
export function sal(s: Salience): number {
  const dims: number[] = [s.relevance, s.predictive];
  if (s.novelty !== null) dims.unshift(s.novelty);
  let sum = 0;
  for (const x of dims) sum += clamp01(x);
  const mean = sum / dims.length;
  return clamp01(Math.max(mean, s.claimed ?? 0));
}

/**
 * THE SALIENCE THE CURVE READS (2026-10-10, the old-claims era): `sal()` with
 * the era's claim (`MemoryPhysics.eraClaim`) in place of the stored one when
 * the read seam set it, else exactly `sal(m.salience)`. Height (`salArm`),
 * steepness (`steepnessInput`) and recall's turn gate read this; whatever asks
 * what the author CLAIMED (`challengeForce`, the dashboard's salience line,
 * the v8 census) still reads `sal(m.salience)`.
 * Decided by Mike, 2026-10-10, loosely held. Why: claims made under the old
 * field text ("set it on anything that should last") held the store in reach
 * for months under the new curve; read as defaults, never rewritten.
 * Extended by Mike, 2026-10-11, lightly held: an old DEFAULT reads at today's
 * default for what it is about, up or down, so an upgrader reads what a fresh
 * install writes.
 */
export function curveSal(m: { readonly salience: Salience; readonly eraClaim?: number | null | undefined }): number {
  const era = m.eraClaim;
  return typeof era === "number" && Number.isFinite(era) ? sal({ ...m.salience, claimed: era }) : sal(m.salience);
}

/** The mean of the stored dimensions alone, ignoring any claimed floor. */
export function computedSal(s: Salience): number {
  return sal({ ...s, claimed: null });
}

export interface SalienceLiftEvent {
  readonly event: "salience.lifted";
  readonly computed: number;
  /** The claim as the author made it (clamped to [0,1] at intake), pre-CAP.
   *  Telemetry must carry it, or the re-run's watch metrics cannot propose
   *  the right ceiling. */
  readonly claimed: number;
  /** The claim actually stored (post-cap): what `sal(m)` will honor. */
  readonly applied: number;
  /** The ceiling this claim was subject to (1 for lived testimony). */
  readonly ceiling: number;
  /** True when the raw claim exceeded the ceiling and was cut down to it. */
  readonly capped: boolean;
}

/**
 * The claim the author never made. Kept SEPARATE from `salience.lifted` on
 * purpose: the lift metric is "how often does an author's claim out-rank the
 * computed dimensions", and folding a defaulted floor into it would read every
 * silent note as a claim and destroy the number the ceiling decision needs.
 */
export interface SalienceDefaultEvent {
  readonly event: "salience.defaulted";
  /** The mean of the stored dimensions — 0 for the case this exists for. */
  readonly computed: number;
  /** The floor applied, i.e. `TUNABLES.AUTHORED_DEFAULT_CLAIM`. */
  readonly floor: number;
  /** What `sal(m)` will honor with the default in place. */
  readonly applied: number;
}

/** Which row of the default table an unclaimed memory took (`defaultClaimFor`). */
export type DefaultClaimClass = "work-event" | "work" | "unmarked" | "world" | "personal";

/** What `defaultClaimFor` reads: fields the writer fills, never the text. */
export interface DefaultClaimInput {
  readonly about?: string | null;
  readonly status?: string | null;
  readonly saidBy?: string | null;
  readonly kind?: string | null;
}

/**
 * THE DEFAULT FLOOR FOR AN UNCLAIMED AUTHORED MEMORY, BY WHAT IT IS ABOUT
 * (2026-10-10, Group 1c; review 01 C2; `TUNABLES.DEFAULT_CLAIM_*`). Pure.
 *
 * Order: personal first — the owner, us or me, or said by the owner, or kind
 * self/person — so the owner's ruling about work is not a work event (f8:
 * "Mike's rulings, preferences and corrections stay high even about work");
 * then the world; then a done work event; then other work. An unmarked memory
 * keeps the old 0.25: the `about` field says an unmarked fact written in a
 * project counts as that project's work, but `status: done` alone is not
 * enough to call an unmarked memory a routine work event. Decided by
 * g1c-builder, 2026-10-10, lightly held; revisit after ~5 lived days. Why:
 * 01's table is keyed on `about=work` for the low row, and 201 legacy rows
 * carry no mark at all.
 */
export function defaultClaimFor(input: DefaultClaimInput): { readonly claim: number; readonly class: DefaultClaimClass } {
  const about = input.about ?? null;
  if (
    about === "owner" ||
    about === "us" ||
    about === "me" ||
    input.saidBy === "owner" ||
    input.kind === "self" ||
    input.kind === "person"
  ) {
    return { claim: TUNABLES.DEFAULT_CLAIM_PERSONAL, class: "personal" };
  }
  if (about === "world") return { claim: TUNABLES.DEFAULT_CLAIM_WORLD, class: "world" };
  if (about === "work") {
    return input.status === "done"
      ? { claim: TUNABLES.DEFAULT_CLAIM_WORK_EVENT, class: "work-event" }
      : { claim: TUNABLES.AUTHORED_DEFAULT_CLAIM, class: "work" };
  }
  return { claim: TUNABLES.AUTHORED_DEFAULT_CLAIM, class: "unmarked" };
}

export interface SeamClamp {
  /** The salience to store: dimensions untouched, claim recorded as the floor. */
  salience: Salience;
  /** True only when an AUTHOR's own claim out-ranked the computed dimensions.
   *  A defaulted floor is never a lift — see `SalienceDefaultEvent`. */
  lifted: boolean;
  blind: boolean;
  /** True when the author's raw claim was cut to the ceiling. */
  capped: boolean;
  /** True when the author claimed nothing and the channel's default floor was
   *  applied in its place. Recorded on the row as `meta.claimedDefault`. */
  defaulted: boolean;
  /** The raw claim when it was capped, else null — the minting seam preserves
   *  it in prose meta so the un-capped testimony is never silently lost. */
  rawClaim: number | null;
  event: SalienceLiftEvent | null;
  defaultEvent: SalienceDefaultEvent | null;
}

/**
 * The proposal -> memory seam (guarantee 2). A claimed salience is a FLOOR:
 * `sal(m) >= sal_claimed(m)`, clamped here, and ANY LIFT EMITS AN EVENT.
 * The stored dimensions are never rewritten to satisfy the claim, so salience
 * stays fixed at birth and a null novelty stays null.
 *
 * `ceiling` is the authorship doctrine's salience half (owner ruling
 * 2026-08-29): lived testimony — the experiencer's own deposit — passes 1, the
 * full floor; a retelling author (the crash-fallback sweep) passes
 * `TUNABLES.SWEEP_CLAIM_CEILING`, and a raw claim above it is CUT to it, with
 * the cut recorded on the event and the raw claim handed back for prose meta.
 * The cap runs here and nowhere else, exactly like the floor ("clamped here,
 * once" stays literally true).
 *
 * `defaultClaim` is the same idea in the other direction and the same kind of
 * engine-set number: when the author claimed NOTHING, the channel's default
 * floor stands in (`TUNABLES.AUTHORED_DEFAULT_CLAIM` for the lived channel,
 * `null` — nothing at all — for every other). Silence is not testimony, so a
 * default is recorded as `defaulted`, never as a lift; and an explicit claim,
 * however low, is never overridden, because the branch is on `claimed === null`
 * and nothing else.
 */
export function clampSalienceAtSeam(
  dims: Salience,
  claimedSal: number | null,
  ceiling = 1,
  defaultClaim: number | null = null,
): SeamClamp {
  const raw = claimedSal === null ? null : clamp01(claimedSal);
  const capped = raw !== null && raw > ceiling;
  const defaulted = raw === null && defaultClaim !== null;
  const claimed =
    raw === null ? (defaultClaim === null ? null : clamp01(defaultClaim)) : Math.min(raw, ceiling);
  const salience: Salience = { ...dims, claimed };
  const computed = computedSal(salience);
  const lifted = !defaulted && claimed !== null && claimed > computed;
  return {
    salience,
    lifted,
    blind: isBlindEncoding(salience),
    capped,
    defaulted,
    rawClaim: capped ? raw : null,
    event:
      lifted || capped
        ? {
            event: "salience.lifted",
            computed,
            claimed: raw as number,
            applied: sal(salience),
            ceiling,
            capped,
          }
        : null,
    defaultEvent: defaulted
      ? {
          event: "salience.defaulted",
          computed,
          floor: claimed as number,
          applied: sal(salience),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// §5.2 Strength — the one number
// ---------------------------------------------------------------------------

export function rep(m: Pick<MemoryPhysics, "uses">): number {
  if (!(m.uses > 0)) return 0;
  return TUNABLES.REP_CAP * (1 - Math.exp(-m.uses / TUNABLES.REP_SCALE_USES));
}

export function cons(m: Pick<MemoryPhysics, "consolidated">): number {
  return m.consolidated ? TUNABLES.CONS_BONUS : 0;
}

/**
 * base = max( omega_sal x sal, omega_rep x rep ) + cons.
 *
 * A MAX, never a product, and age is NOT an input [v1 Appendix A #1] — "a
 * formative one-shot consolidates without repetition" is true only because of
 * the max. Monotone non-decreasing (guarantee 3): salience is fixed, uses only
 * rise, consolidation only turns on.
 */
export function base(m: MemoryPhysics): number {
  const k = kindPhysics(m.kind);
  return Math.max(k.wSal * salArm(m), k.wRep * rep(m)) + cons(m);
}

// ---------------------------------------------------------------------------
// §5.10 Emotion — height, slope, and the feeling that softens
// ---------------------------------------------------------------------------

/**
 * I(m) — a memory's emotional intensity: the STRONGEST of its numeric
 * `emotional` score and the recorded strengths of the feelings on it (since
 * 2026-10-11, its LATEST recording's — `store.row()`'s `feeling_peak`), whoever's
 * they are (owner decision 2026-09-25/26: "how long a memory lasts follows the
 * strongest feeling on it, his or mine"). A MAX, like `base`, so a lone strong
 * feeling is never averaged down by quieter ones. 0 when there is neither.
 */
export function emotionalIntensity(m: { salience: Salience; feelingPeak?: number | null | undefined }): number {
  const peak = m.feelingPeak;
  return Math.max(
    clamp01(m.salience.emotional),
    typeof peak === "number" && Number.isFinite(peak) ? clamp01(peak) : 0,
  );
}

/**
 * The salience ARM of `base`: `sal(m)` with the emotion ADDED on top of it.
 * `sal()` itself is the mean-with-floor of the non-emotional dimensions (since
 * 2026-10-10) — it is also what `challengeForce` reads, which may not see this
 * lift; recall's turn gate (§9 G10) adds it only on a self-felt turn.
 * The repetition arm gets no lift at all, so "repetition is capped below
 * identity" (§3) is untouched.
 */
export function salArm(m: Pick<MemoryPhysics, "salience" | "feelingPeak"> & Partial<Pick<MemoryPhysics, "eraClaim">>): number {
  const own = curveSal(m);
  const lifted = clamp01(own + TUNABLES.EMO_LIFT * emotionalIntensity(m));
  // Feeling sets stability, not the band (2026-10-10, `FELT_HEIGHT_CAP`): below
  // the semantic floor, the lift stops just under it.
  return own >= TUNABLES.THETA_SEM ? lifted : Math.min(lifted, Math.max(own, TUNABLES.FELT_HEIGHT_CAP));
}

/**
 * How a recorded feeling reads NOW — softened over the lived days since it was
 * recorded. `ageDays` is lived days (the one clock); a negative or non-finite
 * age reads as fresh. `valence` (−1..+1) sets the clock — an unpleasant
 * feeling softens faster (`feelingSofteningDays`); left out, the neutral one.
 * Never written back: the table keeps the strength as felt.
 */
export function softenedFeeling(strength: number, ageDays: number, valence?: number): number {
  const age = Number.isFinite(ageDays) ? Math.max(0, ageDays) : 0;
  return clamp01(strength) * Math.exp(-age / feelingSofteningDays(valence));
}

/** The softening clock S, in lived days, for a feeling of this valence (`S_FEELING_NEGATIVE`). */
export function feelingSofteningDays(valence?: number): number {
  const v = typeof valence === "number" && Number.isFinite(valence) ? Math.max(-1, Math.min(1, valence)) : 0;
  const end = v < 0 ? TUNABLES.S_FEELING_NEGATIVE : TUNABLES.S_FEELING_POSITIVE;
  return TUNABLES.S_FEELING + Math.abs(v) * (end - TUNABLES.S_FEELING);
}

/**
 * q — what sets a memory's STEEPNESS (2026-10-10, review 03 C1): its salience
 * (`sal`, the claimed floor included) plus half its emotional intensity,
 * clamped to [0, 1]. Height is `base` (with `EMO_LIFT`); this is the slope.
 */
export function steepnessInput(m: Pick<MemoryPhysics, "salience" | "feelingPeak"> & Partial<Pick<MemoryPhysics, "eraClaim">>): number {
  return clamp01(curveSal(m) + TUNABLES.EMO_Q * emotionalIntensity(m));
}

/**
 * Stability S, in lived days (2026-10-10, Group 1, review 03 C1):
 *
 *   S = S0 · e^(G·q) · (1 + β·ln(1 + uses)) · (1 + ln(1 + returns)) / κ_kind
 *
 * q = clamp01(sal + EMO_Q · I) (`steepnessInput`). kappa DIVIDES (§5.4); use
 * lengthens it (deposit); spaced RETURNS lengthen it (§5.11) — a factor of
 * exactly 1 at zero returns. Feeling enters through q — `EMO_SLOPE`'s
 * multiplier is folded in and gone.
 *
 * NEVER FADES = S = ∞: an identity-band memory (the core), and any kind whose
 * κ is 0 (none today; the owner's records later). `(1 + t/∞)^−1 = 1`, so the
 * exemption is the arithmetic, not a branch in every reader (03 D6).
 *
 * A dated memory's slope is its own, before its window and after it: the
 * steeper "spent" slope after the window (÷4, 2026-10-10) was cut by Mike,
 * 2026-10-11, lightly held — ending the hold does the same job with no extra
 * logic (`elapsed`).
 */
export function stability(
  m: Pick<MemoryPhysics, "kind" | "uses" | "salience"> &
    Partial<Pick<MemoryPhysics, "feelingPeak" | "returns" | "promotedIdentity" | "eraClaim">>,
): number {
  const kappa = kindPhysics(m.kind).kappa;
  if (m.promotedIdentity === true || !(kappa > 0)) return Number.POSITIVE_INFINITY;
  const q = steepnessInput(m);
  return (
    (TUNABLES.S0 *
      Math.exp(TUNABLES.STABILITY_GAIN * q) *
      (1 + TUNABLES.BETA * Math.log(1 + Math.max(0, m.uses))) *
      returnFactor(m.returns ?? 0)) /
    kappa
  );
}

/** The returns' share of stability: `1 + RETURN_GAIN x ln(1 + returns)`. */
export function returnFactor(returns: number): number {
  const r = Number.isFinite(returns) ? Math.max(0, returns) : 0;
  return 1 + TUNABLES.RETURN_GAIN * Math.log(1 + r);
}

/** The decay curve itself, over an elapsed lived-day interval. S = ∞ never decays. */
export function decayCurve(
  elapsedDays: number,
  s: number,
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): number {
  const dt = Math.max(0, elapsedDays);
  if (s === Number.POSITIVE_INFINITY) return 1;
  switch (shape) {
    case "flat":
      return Math.max(0, 1 - dt / s);
    case "power-law":
      return Math.pow(1 + dt / s, -TUNABLES.POWER_LAW_PSI);
    case "exponential":
    default:
      return Math.exp(-dt / s);
  }
}

/**
 * THE LIVED DAY A MEMORY'S CURVE COUNTS FROM (2026-10-10, review 03 C2): its
 * last credited use, its last counted return, or its last counted dream
 * replay, whichever is latest. A use was always the anchor; a RETURN — a
 * reflection that cited it, a dream that replayed it — now re-anchors it too,
 * which is how a replay "revives" a memory below reach without being a use
 * (no `uses`, no rep arm, no credit-today latch: `creditUse` still reads
 * `lastUsedDay` alone). The prune's dwell counts from the same day.
 * Decided by g1a-builder, 2026-10-10, lightly held; revisit after ~5 lived
 * days. Why: the synthesis says a dream replay revives; a return's ×(1 +
 * ln 1.4) on S alone lifts a faded default note by ~0.01 — not back in reach.
 */
export function decayAnchor(
  m: Pick<MemoryPhysics, "lastUsedDay"> & Partial<Pick<MemoryPhysics, "lastReturnDay" | "lastDreamDay">>,
): number {
  return Math.max(m.lastUsedDay, m.lastReturnDay ?? Number.NEGATIVE_INFINITY, m.lastDreamDay ?? Number.NEGATIVE_INFINITY);
}

/**
 * The elapsed lived days the curve reads on day d — the one place the dated
 * hold acts (07 C1/C2):
 *
 *   - PENDING (a future date, or its window still open; a repeat inside an
 *     occurrence's window): t = 0. The memory holds at its height until its
 *     window closes. No use is credited — `uses`, `lastUsedDay` and returns
 *     are untouched.
 *   - otherwise: t = d − `decayAnchor`. A one-off date whose window has
 *     closed carries no hold (`store/operational.ts#datedHold`), so it is back
 *     on its own curve AS IF IT HAD NEVER BEEN HELD: t from its own anchor,
 *     not from the close — an old routine reminder is below reach at once, a
 *     felt dated fact lands where its own curve puts it. (Mike, 2026-10-11,
 *     lightly held: this replaces the 2026-10-10 "spent" slope, t from the
 *     close on stability ÷ 4 until a use.) A repeat between windows is the
 *     same.
 */
export function elapsed(m: MemoryPhysics, d: number): number {
  return m.hold?.state === "pending" ? 0 : Math.max(0, d - decayAnchor(m));
}

/**
 * D(m, d) — the curve over LIVED days, from the memory's anchor.
 *
 * Identity-band memories are decay-exempt (D = 1) through S = ∞ — the named
 * deviation of §2 (flashbulb memories do fade in humans, here they do not).
 * Idempotent by construction: D is a pure function of d, so there is no step
 * to run twice (guarantee 5, scar E8).
 */
export function decay(m: MemoryPhysics, d: number, shape: DecayShape = TUNABLES.DECAY_SHAPE): number {
  if (m.promotedIdentity) return 1;
  return decayCurve(elapsed(m, d), stability(m), shape);
}

/** The memory's height before decay: `base x fade` (03 C1's h). */
export function height(m: MemoryPhysics): number {
  return clamp01(base(m) * fadeOf(m));
}

export function strength(m: MemoryPhysics, d: number, shape: DecayShape = TUNABLES.DECAY_SHAPE): number {
  return clamp01(base(m) * decay(m, d, shape) * fadeOf(m));
}

/**
 * IS IT BELOW REACH on lived day d? (2026-10-10, review 03 C2.) Strength under
 * `REACH`, and not in the identity band (the core never leaves reach). A
 * computed state, never stored. Pure.
 */
export function belowReach(m: MemoryPhysics, d: number, shape: DecayShape = TUNABLES.DECAY_SHAPE): boolean {
  if (m.promotedIdentity) return false;
  return strength(m, d, shape) < TUNABLES.REACH;
}

/**
 * The first whole lived day, counting from the memory's anchor, on which its
 * strength is BELOW `theta` — assuming nothing about it changes (no use, no
 * return, no new feeling). `null` when it never gets there (S = ∞, or it holds
 * at t = 0), `0` when it is already below at t = 0. Closed form on the
 * power-law (`h/(1 + t/S) < θ ⇔ t > S·(h/θ − 1)`); the other shapes are
 * stepped, since only a replay tool asks them.
 */
export function daysUntilBelow(m: MemoryPhysics, theta: number, shape: DecayShape = TUNABLES.DECAY_SHAPE): number | null {
  if (m.promotedIdentity) return null;
  const h = height(m);
  if (h < theta) return 0;
  if (m.hold?.state === "pending") return null;
  const S = stability(m);
  if (S === Number.POSITIVE_INFINITY) return null;
  if (shape === "power-law" && TUNABLES.POWER_LAW_PSI === 1) {
    return Math.floor(S * (h / theta - 1)) + 1;
  }
  for (let t = 1; t <= 100_000; t++) if (h * decayCurve(t, S, shape) < theta) return t;
  return null;
}

/** `next_change_day`'s "nothing will change": a lived day no store reaches. */
export const NEVER_CHANGES = 1_000_000_000;

/**
 * THE NEXT LIVED DAY THIS MEMORY'S BAND, REACH OR PRUNE ELIGIBILITY CHANGES
 * (2026-10-10, Group 1, review 13 C2), assuming nothing about it changes —
 * the day the nightly turn-down has to look at it again. Strictly after `d`.
 *
 *   - the identity band, S = ∞: `NEVER_CHANGES`;
 *   - a held (pending) dated memory: `d + 1` — its hold turns on the
 *     CALENDAR, which a lived day cannot predict, so it is looked at daily
 *     (there are few of them). So the first pass after its window closes
 *     looks at it, finds no hold, and gives it its normal day below;
 *   - otherwise the first day it falls under the next of `THETA_SEM`, `REACH`
 *     and `PHI_PRUNE` below where it stands, or — once under the floor — the
 *     day its dwell reaches `D_FLOOR_DAYS`.
 *
 * Every input change (a use, a return, a feeling, a fade) is the WRITER's to
 * signal by clearing the stored day (store v13's trigger does it for all of
 * them); this function never guesses one.
 */
export function nextChangeDay(m: MemoryPhysics, d: number, shape: DecayShape = TUNABLES.DECAY_SHAPE): number {
  if (m.promotedIdentity) return NEVER_CHANGES;
  if ((m.hold ?? null) !== null) return d + 1;
  const anchor = decayAnchor(m);
  const now = strength(m, d, shape);
  const candidates: number[] = [];
  for (const theta of [TUNABLES.THETA_SEM, TUNABLES.REACH]) {
    if (now < theta) continue;
    const t = daysUntilBelow(m, theta, shape);
    if (t !== null) candidates.push(anchor + t);
  }
  // The prune's eligibility turns when BOTH halves hold: under the floor, and
  // dwelt `D_FLOOR_DAYS` since the anchor — the later of the two days.
  const floor = now < TUNABLES.PHI_PRUNE ? 0 : daysUntilBelow(m, TUNABLES.PHI_PRUNE, shape);
  if (floor !== null) candidates.push(anchor + Math.max(floor, TUNABLES.D_FLOOR_DAYS));
  const next = candidates.filter((x) => x > d).sort((a, b) => a - b)[0];
  return next === undefined ? NEVER_CHANGES : next;
}

/**
 * The memory's FADE (§5.12): a multiplier on strength, 1 for every memory
 * until a settle marks it `changed`. Outside `base` (guarantee 3 holds: base is
 * still monotone) and outside `decay` (guarantee 5: decay is still a pure
 * function of d and the last use). Absent, or anything but a number in (0, 1],
 * reads as 1.
 */
export function fadeOf(m: Pick<MemoryPhysics, "fade">): number {
  const f = m.fade;
  return typeof f === "number" && Number.isFinite(f) && f > 0 && f < 1 ? f : 1;
}

// ---------------------------------------------------------------------------
// §5.12 A changed fact fades once
// ---------------------------------------------------------------------------

/** What `changedFade` proposes: the new fade, and strength today before and after. */
export interface FadeOutcome {
  /** The patch: the memory's fade after this settle (its fade before x `factor`). */
  readonly fade: number;
  /** The factor applied — what an undo divides back out. */
  readonly factor: number;
  readonly before: number;
  readonly after: number;
}

/**
 * ONE STRENGTH CUT FOR A MEMORY SETTLED AS `changed` (2026-09-29; reworked
 * after the review of #284): the memory's `fade` multiplier is multiplied by
 * `factor`, so its strength today — and on every later day — is `factor` x
 * what it would have been. Nothing else moves: not `lastUsedDay` (the prune's
 * dwell still counts from the real last use, and the history stays true), not
 * `base`, not the uses. Ordinary decay carries on; a use resets decay as always
 * and leaves the fade alone, so a used "earlier" memory is held at the cut
 * height. Two settles multiply; an undo divides its own factor back out, in
 * any order. Null when there is nothing to cut: a core memory (decay-exempt;
 * its path is pressure) or a factor of 1 or more.
 */
export function changedFade(
  m: MemoryPhysics,
  d: number,
  factor: number = TUNABLES.CHANGED_FADE,
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): FadeOutcome | null {
  if (m.promotedIdentity) return null;
  if (!Number.isFinite(factor) || factor <= 0 || factor >= 1) return null;
  const fade = fadeOf(m) * factor;
  return {
    fade,
    factor,
    before: strength(m, d, shape),
    after: strength({ ...m, fade }, d, shape),
  };
}

/**
 * THE UNDO OF ONE `changedFade`: the fade with `factor` divided back out,
 * snapped to exactly 1 when that is what is left (floating point), and never
 * above 1.
 */
export function unfade(fade: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return fade;
  const next = fade / factor;
  return next >= 1 - 1e-9 ? 1 : next;
}

// ---------------------------------------------------------------------------
// §5.3 Bands
// ---------------------------------------------------------------------------

/**
 * band = identity if promoted; semantic if DECAYED strength >= THETA_SEM;
 * episodic otherwise.
 *
 * Nothing is born into identity, whatever salience is claimed: identity is
 * entered only by inheriting it through a declared revision, or by the explicit
 * counted promotion crossing of `promotionEligibility()`. Semantic and episodic
 * are evaluated on decayed strength, so a faded semantic memory demotes and
 * gains the prune exit — every band names its way out (scar §2.17).
 */
export function band(m: MemoryPhysics, d: number, shape: DecayShape = TUNABLES.DECAY_SHAPE): Band {
  if (m.promotedIdentity) return "identity";
  return strength(m, d, shape) >= TUNABLES.THETA_SEM ? "semantic" : "episodic";
}

// ---------------------------------------------------------------------------
// §5.3 Core — the two lanes into the identity band (2026-09-26)
// ---------------------------------------------------------------------------

/** Which lane carried a memory into the core. */
export type CoreLane = "fast" | "slow";

export type PromotionReason =
  | "eligible"
  | "already-identity"
  /** Not a memory about me or about us: only `self`, and `person` memories
   *  about the owner, may become core. Repetition alone makes nothing else
   *  identity, however often it returns (guarantee 4). */
  | "not-about-me"
  /** The owner sent it back to ordinary fading; the lanes do not re-promote it. */
  | "demoted-by-owner"
  /** About me, but neither lane is met yet (`fast` / `slow` say which part). */
  | "no-lane-yet";

export interface PromotionVerdict {
  eligible: boolean;
  /** The first blocking reason, or "eligible". */
  reason: PromotionReason;
  /** Every blocking reason. */
  blockedBy: PromotionReason[];
  /** The lane that is met (fast first), or null. */
  lane: CoreLane | null;
  /** Fast lane: strongly felt AND it came back at least once after a gap. */
  fast: {
    readonly met: boolean;
    readonly intensity: number;
    readonly needIntensity: number;
    /** Lived days from birth to the latest awake return; null when none. */
    readonly gap: number | null;
    readonly needGap: number;
  };
  /** Slow lane: awake returns on several distinct lived days over weeks. */
  slow: {
    readonly met: boolean;
    readonly days: number;
    readonly needDays: number;
    /** Lived days from the first awake return to the last. */
    readonly span: number;
    readonly needSpan: number;
    /** Decayed strength on `ctx.day` (null when no day was given) and the floor it must reach. */
    readonly strength: number | null;
    readonly needStrength: number;
  };
  /** `base` as it stands — carried for the record, never a threshold. */
  base: number;
  /** Distinct lived days with a counted awake return. */
  returnDays: number;
}

/** Who a memory is about, as the core lanes need it — decided by the caller,
 *  which can read the words and the owner's names (sleep's consolidate phase). */
export interface CoreContext {
  /** Kind `self`, or a `person` memory about the owner. */
  readonly aboutMe: boolean;
  /** The owner demoted it (`counterparts core --demote`). */
  readonly demoted?: boolean;
  /**
   * v9: may the fast lane's feeling read the feelings a reflection recorded
   * later? Absent: `CORE_FAST_ACCEPTS_REFLECTED_FEELING`.
   */
  readonly acceptsReflectedFeeling?: boolean;
  /**
   * v9 (owner ruling D1 on #256, 2026-09-27): the last lived day of an
   * ORDINARY awake use that counted as a return (source `awake`, not
   * `reflection`), or null when there was none. With the door CLOSED
   * (`acceptsReflectedFeeling` false) the fast lane's "came back after a gap"
   * reads this one, so nothing reaches the core on a reflection alone. Absent:
   * the lane reads every awake-class return, as when the door is open.
   */
  readonly organicReturnDay?: number | null;
  /**
   * The lived day the verdict is for. With it, the SLOW lane also asks the
   * memory to stand in the semantic band on that day (decayed strength at or
   * above `THETA_SEM`): coming back on many days is not by itself a reason to
   * be part of who I am when the memory is faint (working default, 2026-09-26,
   * after the review of #251 saw six zero-salience `self` rows cross on
   * repetition alone). `promote` always passes it; a reader that only wants
   * the lane progress may leave it out.
   */
  readonly day?: number;
  /**
   * Wheel v2 (2026-09-30): the memory carries a SELF-RELEVANT feeling — the
   * recognition group (`feelings-wheel.ts#isSelfRelevantFeeling`) — and nothing
   * has marked what it is about. The fast lane alone may then count it as
   * about me; the slow lane still needs the mark. Absent: false.
   */
  readonly selfRelevantFeeling?: boolean;
  /**
   * 2026-10-10 (Group 1c, review 08 C3): a feeling on the memory is STRONGLY
   * FELT by its own word's measure — at least `CORE_FAST_ABOVE_DEFAULT` above
   * the word's default, or at `CORE_FAST_FEELING` — read by the caller, which
   * can see the words (`sleep/consolidate.ts#stronglyFelt`), from the same
   * feelings the intensity reads (the lived ones only when the door to later
   * feelings is closed). Either this or the intensity opens the fast lane's
   * feeling half. Absent: false — the intensity alone decides, as before.
   */
  readonly stronglyFelt?: boolean;
}

/**
 * Core eligibility (§5.3, owner decisions 2026-09-26). Only for memories about
 * me or about us (`ctx.aboutMe`), and then by one of two lanes:
 *
 *   - FAST: strongly felt (`emotionalIntensity >= CORE_FAST_FEELING`, either
 *     person's feeling) AND it has come back awake at least once, at least
 *     `CORE_FAST_GAP_DAYS` after it was made;
 *   - SLOW: not strongly felt, but it kept coming back organically — awake
 *     returns on `>= CORE_SLOW_DAYS` distinct lived days spanning
 *     `>= CORE_SLOW_SPAN_DAYS`.
 *
 * `base` is no longer read (the `promotionBase` stopgap of #244 is retired):
 * emotion counts toward core ON PURPOSE, through the fast lane, and a dream's
 * replays do not count toward either lane — a dream can nominate, only a lane
 * promotes. Evaluated at consolidation by `sleep/`, which executes the crossing
 * (and caps how many cross per night).
 */
export function promotionEligibility(m: MemoryPhysics, ctx: CoreContext): PromotionVerdict {
  // v9: the fast lane's feeling, without the feelings a reflection recorded
  // later unless the owner opened that door (`CORE_FAST_ACCEPTS_REFLECTED_FEELING`).
  const accepts = ctx.acceptsReflectedFeeling ?? TUNABLES.CORE_FAST_ACCEPTS_REFLECTED_FEELING;
  const intensity = accepts || m.feelingPeakLived === undefined ? emotionalIntensity(m) : emotionalIntensity({ ...m, feelingPeak: m.feelingPeakLived });
  const days = m.returnDays ?? 0;
  const first = m.firstReturnDay ?? null;
  const last = m.lastReturnDay ?? null;
  const gap = last === null ? null : last - m.birthDay;
  const span = first === null || last === null ? 0 : last - first;
  // CLOSED means fully closed (owner ruling D1 on #256): the fast lane's
  // return must be an ordinary use, not a reflection's citation.
  const fastLast = !accepts && ctx.organicReturnDay !== undefined ? ctx.organicReturnDay : last;
  const fastGap = fastLast === null ? null : fastLast - m.birthDay;
  // Strongly felt (2026-10-10): the intensity at the absolute bar, or a
  // feeling above its own word's default (`CoreContext.stronglyFelt`).
  const felt = intensity >= TUNABLES.CORE_FAST_FEELING || ctx.stronglyFelt === true;
  const fastMet = felt && fastGap !== null && fastGap >= TUNABLES.CORE_FAST_GAP_DAYS;
  const now = ctx.day === undefined ? null : strength(m, ctx.day);
  const slowMet =
    days >= TUNABLES.CORE_SLOW_DAYS &&
    span >= TUNABLES.CORE_SLOW_SPAN_DAYS &&
    (now === null || now >= TUNABLES.CORE_SLOW_FLOOR);
  const blockedBy: PromotionReason[] = [];
  if (m.promotedIdentity) blockedBy.push("already-identity");
  // Recognising myself in it counts as about me, for the fast lane only, when
  // nothing marked what it is about (wheel v2, `CoreContext.selfRelevantFeeling`).
  if (!ctx.aboutMe && !(ctx.selfRelevantFeeling === true && fastMet)) blockedBy.push("not-about-me");
  if (ctx.demoted === true) blockedBy.push("demoted-by-owner");
  if (!fastMet && !slowMet) blockedBy.push("no-lane-yet");
  return {
    eligible: blockedBy.length === 0,
    reason: blockedBy[0] ?? "eligible",
    blockedBy,
    lane: fastMet ? "fast" : slowMet ? "slow" : null,
    fast: {
      met: fastMet,
      intensity,
      needIntensity: TUNABLES.CORE_FAST_FEELING,
      gap: fastGap,
      needGap: TUNABLES.CORE_FAST_GAP_DAYS,
    },
    slow: {
      met: slowMet,
      days,
      needDays: TUNABLES.CORE_SLOW_DAYS,
      span,
      needSpan: TUNABLES.CORE_SLOW_SPAN_DAYS,
      strength: now,
      needStrength: TUNABLES.CORE_SLOW_FLOOR,
    },
    base: base(m),
    returnDays: days,
  };
}

export type ConsolidationReason =
  | "eligible"
  | "not-legacy"
  | "already-consolidated"
  | "archived"
  | "born-today"
  | "below-semantic-floor";

export interface ConsolidationVerdict {
  eligible: boolean;
  /** The first blocking reason, or "eligible". */
  reason: ConsolidationReason;
  /** Every blocking reason — consolidation needs ALL conditions (scar §2.4). */
  blockedBy: ConsolidationReason[];
  band: Band;
  birthDay: number;
}

/**
 * THE LEGACY consolidation marking (SEAMS item M), kept for memories born
 * before schema v8 and for them alone (`legacy`, 2026-09-26): a memory that
 * survived at least one lived day past its birth and sits at or above the
 * semantic floor is marked, worth `+CONS_BONUS` for the rest of its life. The
 * upgrade leaves this path open for exactly the rows that had it, so no memory
 * is marked later than it would have been — nothing drops a band or prunes
 * sooner because of the upgrade. A memory made since the upgrade is refused
 * `not-legacy`: returns (§5.11) are its road to staying strong.
 *
 * There is still deliberately NO reinforcement requirement on the legacy path
 * ("a formative one-shot consolidates without repetition"). Nothing
 * consolidates on the day it was encoded.
 */
export function consolidationEligibility(
  m: MemoryPhysics,
  d: number,
  opts: { archived?: boolean } = {},
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): ConsolidationVerdict {
  const b = band(m, d, shape);
  const blockedBy: ConsolidationReason[] = [];
  if (m.legacy !== true) blockedBy.push("not-legacy");
  if (opts.archived === true) blockedBy.push("archived");
  if (m.consolidated) blockedBy.push("already-consolidated");
  if (d <= m.birthDay) blockedBy.push("born-today");
  if (b !== "semantic" && !m.promotedIdentity) blockedBy.push("below-semantic-floor");
  return {
    eligible: blockedBy.length === 0,
    reason: blockedBy[0] ?? "eligible",
    blockedBy,
    band: b,
    birthDay: m.birthDay,
  };
}

export interface PromotionCrossing {
  readonly event: "band.promoted";
  readonly day: number;
  readonly kind: Kind;
  readonly lane: CoreLane;
  readonly base: number;
  readonly intensity: number;
  readonly returnDays: number;
  /** Kept on the record for the readers that print it; now equals `returnDays`. */
  readonly reinforcedDays: number;
}

export interface PromotionOutcome {
  promoted: boolean;
  verdict: PromotionVerdict;
  /** The explicit, counted crossing record — never an emergent side effect
   *  (scar §2.4). Null when the memory was not eligible. */
  crossing: PromotionCrossing | null;
  next: Pick<MemoryPhysics, "promotedIdentity"> | null;
}

export function promote(m: MemoryPhysics, d: number, ctx: CoreContext): PromotionOutcome {
  const verdict = promotionEligibility(m, { ...ctx, day: d });
  if (!verdict.eligible || verdict.lane === null) return { promoted: false, verdict, crossing: null, next: null };
  return {
    promoted: true,
    verdict,
    crossing: {
      event: "band.promoted",
      day: d,
      kind: m.kind,
      lane: verdict.lane,
      base: verdict.base,
      intensity: verdict.fast.intensity,
      returnDays: verdict.returnDays,
      reinforcedDays: verdict.returnDays,
    },
    next: { promotedIdentity: true },
  };
}

// ---------------------------------------------------------------------------
// §5.11 Returns — durability from coming back
// ---------------------------------------------------------------------------

/**
 * Where a return came from: an organic AWAKE use, a DREAM replay (durability
 * only), or a REFLECTION that deliberately revisited and cited the memory (v9,
 * 2026-09-27) — an awake return, counted toward the core lanes beside `awake`,
 * though the reflection was HANDED what it cites. That is on display by
 * construction, and it counts anyway, on purpose: awake returns are rare (14
 * memories used across 391 turns in the owner's first week), so without it
 * the lanes starve, and deliberately revisiting a memory is what rehearsal
 * is. Its guard is spacing (`REFLECTION_SPACING_DAYS`), not the display rule
 * #238 gave `awake` — do not "fix" it back to `on-display` (physics
 * CONTRACT §5.11).
 */
export type ReturnSource = "awake" | "dream" | "reflection" | "engaged";

export type ReturnReason =
  | "counted"
  /** Shown in the wake's hints lane when it was used: the display may have
   *  prompted the use, and counting it is the rich-get-richer loop (#238). */
  | "on-display"
  | "birth-day"
  /** An awake credit below full weight (surfaced, not used): not a return. */
  | "not-referenced"
  /** An awake return already counted this lived day (or later); for a dream
   *  replay, a return of either kind. */
  | "already-returned-today"
  /** A dream replay within `RETURN_SPACING_DAYS` of the memory's last one. */
  | "dream-spaced"
  /** A reflection return within `REFLECTION_SPACING_DAYS` of the memory's last one. */
  | "reflection-spaced"
  | "ignorable-tier";

export interface ReturnOutcome {
  counted: boolean;
  reason: ReturnReason;
  source: ReturnSource;
  /** Lived days since the previous counted return (or birth). */
  gap: number;
  /** What it added to `returns`: the source's weight x `spacingWeight(gap)`. */
  weight: number;
  next: {
    returns: number;
    returnDays: number;
    firstReturnDay: number | null;
    lastReturnDay: number | null;
    lastDreamDay: number | null;
  };
}

/** How spacing weighs a return: `1 - exp(-gap / RETURN_SPACING_DAYS)`, 0 for no gap. */
export function spacingWeight(gap: number): number {
  if (!Number.isFinite(gap) || gap <= 0) return 0;
  return 1 - Math.exp(-gap / TUNABLES.RETURN_SPACING_DAYS);
}

/** The lived day spacing is measured from: the last counted return of either
 *  kind, or the birth day when there has been none. */
export function lastReturnAnchor(m: Pick<MemoryPhysics, "birthDay" | "lastReturnDay" | "lastDreamDay">): number {
  return Math.max(m.birthDay, m.lastReturnDay ?? -Infinity, m.lastDreamDay ?? -Infinity);
}

/**
 * One RETURN (§5.11, owner decisions 2026-09-26): a credited organic use on a
 * lived day after the memory's previous counted return (awake), or a dream
 * replay (at `DREAM_RETURN_WEIGHT`). Its weight is spacing-scaled, so returns
 * close together count less — and NEVER against: this adds to `returns` and
 * nothing else, and it is computed BESIDE `creditUse`, which is unchanged.
 *
 * An awake return is refused `on-display` when the memory was showing in the
 * wake's hints lane: the use still credits (`creditUse`), but it buys no
 * durability and no lane day, because the display may have prompted it.
 * `tierWeight` is the credited use's §5.5 weight; only a full-weight
 * (referenced) use is a return at all — a memory surfaced and left unused did
 * not come back, it was offered.
 */
export function creditReturn(
  m: MemoryPhysics,
  d: number,
  opts: {
    source: ReturnSource;
    tierWeight?: number;
    onDisplay?: boolean;
    /**
     * The last lived day of a return the physics fields do not carry — the
     * LEGACY returns the v8 upgrade credited for a memory's pre-upgrade
     * reinforcement days (`store/operational.ts`). Spacing is measured from it
     * too; the lanes never read it.
     */
    since?: number | null;
    /** v9: the last lived day a REFLECTION return was counted for this
     *  memory (the store reads it off the `returns` table). */
    lastReflectionDay?: number | null;
  },
): ReturnOutcome {
  const unchanged = {
    returns: m.returns ?? 0,
    returnDays: m.returnDays ?? 0,
    firstReturnDay: m.firstReturnDay ?? null,
    lastReturnDay: m.lastReturnDay ?? null,
    lastDreamDay: m.lastDreamDay ?? null,
  };
  const gap = d - Math.max(lastReturnAnchor(m), opts.since ?? -Infinity);
  const refuse = (reason: ReturnReason): ReturnOutcome => ({
    counted: false,
    reason,
    source: opts.source,
    gap,
    weight: 0,
    next: unchanged,
  });
  const tier =
    opts.source === "dream"
      ? TUNABLES.DREAM_RETURN_WEIGHT
      : opts.source === "reflection"
        ? TUNABLES.REFLECTION_RETURN_WEIGHT
        : opts.source === "engaged"
          ? TUNABLES.ENGAGED_RETURN_WEIGHT
          : (opts.tierWeight ?? TUNABLES.W_REFERENCED);
  if (tier <= 0) return refuse("ignorable-tier");
  if (opts.source === "awake" && tier < TUNABLES.W_REFERENCED) return refuse("not-referenced");
  if (d <= m.birthDay) return refuse("birth-day");
  if (opts.source === "awake" && opts.onDisplay === true) return refuse("on-display");
  // AN ENGAGED RETURN (2026-10-11, `drewOn`; ported from #371): half a
  // return, spaced from the last return of ANY kind (the caller passes the
  // last engaged day as `since`), and refused on a day that already counted
  // one of any kind. It touches only the `returns` sum: no lane day, no
  // `lastReturnDay` (those are the core lanes'), no `lastDreamDay`. Only a
  // memory recall showed this session can earn one (`Counterpart#creditDrewOn`
  // refuses the rest), so the wake's display rule does not apply.
  if (opts.source === "engaged") {
    if (gap <= 0) return refuse("already-returned-today");
    const weight = tier * spacingWeight(gap);
    return {
      counted: true,
      reason: "counted",
      source: "engaged",
      gap,
      weight,
      next: { ...unchanged, returns: unchanged.returns + weight },
    };
  }
  // "Already today" is asked of the SAME kind of return for an awake one: a
  // dream that replayed the memory earlier this lived day (the ask comes
  // mid-session, and the day goes on) takes the spacing — the awake return
  // adds nothing to `returns` — but it must not take the lane day an organic
  // return earns. A dream is refused against either kind, as before.
  // (Adversarial review of #251, 2026-09-26.)
  //
  // A REFLECTION is an awake return and is asked the same question: a
  // reflection and an organic use on one lived day are ONE lane day (the
  // aggregate counts distinct days), so the second of them is refused
  // `already-returned-today` whichever came first. Harmless for the lanes;
  // the day is already counted (v9).
  const sameKindGap = opts.source !== "dream" ? d - Math.max(m.birthDay, m.lastReturnDay ?? -Infinity) : gap;
  if (sameKindGap <= 0) return refuse("already-returned-today");
  // A REFLECTION FOLLOWS ITS OWN SPACING (v9): at most once every
  // `REFLECTION_SPACING_DAYS` per memory, so it cannot cite its way through
  // the slow lane night after night.
  if (
    opts.source === "reflection" &&
    opts.lastReflectionDay !== null &&
    opts.lastReflectionDay !== undefined &&
    d - opts.lastReflectionDay < TUNABLES.REFLECTION_SPACING_DAYS
  ) {
    return refuse("reflection-spaced");
  }
  // A DREAM FOLLOWS SPACING (working default 2026-09-26, review of #251): a
  // replay counts at most once every `RETURN_SPACING_DAYS` per memory, so a
  // memory that sits in every night's bundle cannot outgrow one that comes
  // back awake every week.
  if (opts.source === "dream" && m.lastDreamDay !== null && m.lastDreamDay !== undefined && d - m.lastDreamDay < TUNABLES.RETURN_SPACING_DAYS) {
    return refuse("dream-spaced");
  }
  const weight = (opts.source === "awake" ? 1 : tier) * spacingWeight(gap);
  const next = { ...unchanged, returns: unchanged.returns + weight };
  if (opts.source === "dream") {
    next.lastDreamDay = d;
  } else {
    next.lastReturnDay = d;
    next.returnDays = unchanged.returnDays + 1;
    if (next.firstReturnDay === null) next.firstReturnDay = d;
  }
  return { counted: true, reason: "counted", source: opts.source, gap, weight, next };
}

// ---------------------------------------------------------------------------
// Guarantee 12 — the symmetry counter (scar §2.10)
// ---------------------------------------------------------------------------

const BAND_RANK: Record<Band, number> = { episodic: 0, semantic: 1, identity: 2 };

export function bandMove(from: Band, to: Band): "up" | "down" | "none" {
  const delta = BAND_RANK[to] - BAND_RANK[from];
  return delta > 0 ? "up" : delta < 0 ? "down" : "none";
}

export type SymmetryReason =
  | "within-expectation"
  | "ratchet-suspected"
  | "never-asked";

export interface SymmetryCheck {
  ok: boolean;
  reason: SymmetryReason;
  kind: Kind;
  up: number;
  down: number;
  /** up : down. Infinity when nothing ever moved down — v1's exact shape. */
  ratio: number;
  expectedMax: number;
  /** Up-moves no input explains — a strength that rose with no use, return,
   *  replay, feeling, claim, promotion or hold behind it (2026-10-10). */
  unexplained: number;
}

/**
 * Up-moves and down-moves, counted separately, PER KIND (guarantee 12). This
 * is the tripwire v1 lacked: it ran 279 up-moves against zero down-moves for
 * three days and nothing fired. Below the minimum sample the answer is
 * "never-asked", not "healthy".
 *
 * IT FLAGS UP-RATCHETS ONLY (2026-10-10, review of #372). Decided by Mike,
 * 2026-10-10, lightly held; revisit after ~5 lived days. Why: under the
 * power-law curve memories fading down a band is the design, and up-moves come
 * only from an input — so the old "reverse ratchet" (downs over ups past the
 * stated ratio) flagged ordinary forgetting as an alarm. Two up-ratchet signs:
 *   - `unexplained` up-moves: a band crossing upward that the decay pass could
 *     tie to no input since its last reading (`sleep/decay.ts` records each
 *     up-move's cause). The arithmetic never raises a strength by itself, so
 *     one is enough;
 *   - up-moves out of all proportion to down-moves (`ratio` over
 *     `SYMMETRY_MAX_UP_DOWN_RATIO`), v1's exact shape, past the minimum sample.
 * Down-moves past any ratio are not an alarm.
 */
export function symmetryCheck(kind: Kind, counts: { up: number; down: number; unexplained?: number }): SymmetryCheck {
  const { up, down } = counts;
  const unexplained = Math.max(0, counts.unexplained ?? 0);
  const ratio = down === 0 ? (up === 0 ? 0 : Infinity) : up / down;
  const expectedMax = TUNABLES.SYMMETRY_MAX_UP_DOWN_RATIO;
  const shape = { kind, up, down, ratio, expectedMax, unexplained };
  if (unexplained > 0) return { ok: false, reason: "ratchet-suspected", ...shape };
  if (up + down < TUNABLES.SYMMETRY_MIN_SAMPLE) {
    return { ok: true, reason: "never-asked", ...shape };
  }
  if (ratio > expectedMax) return { ok: false, reason: "ratchet-suspected", ...shape };
  return { ok: true, reason: "within-expectation", ...shape };
}

// ---------------------------------------------------------------------------
// §5.5 Reinforcement
// ---------------------------------------------------------------------------

export type UseTier = "referenced" | "engaged" | "surfaced" | "footnoted";

export const USE_TIER_WEIGHT: Record<UseTier, number> = {
  referenced: TUNABLES.W_REFERENCED,
  engaged: TUNABLES.W_ENGAGED,
  surfaced: TUNABLES.W_SURFACED,
  footnoted: TUNABLES.W_FOOTNOTED,
};

export type CreditReason =
  | "credited"
  | "ignorable-tier"
  | "birth-day"
  | "already-credited-today"
  | "stale-day";

export interface CreditOutcome {
  credited: boolean;
  reason: CreditReason;
  w: number;
  /** State to persist. Identical to the input state when nothing was credited. */
  next: Pick<MemoryPhysics, "uses" | "lastUsedDay" | "reinforcedDays">;
}

/**
 * Graded retrospective reinforcement (§5.5). At most ONE credited occasion per
 * memory per lived day, never on its birth day [v1 §10 G9], and the ignorable
 * (footnoted) tier never trains. Credit is resolved at the boundary, when the
 * reply is known — this function is the arithmetic, not the trigger.
 *
 * A credited use also resets the forgetting curve: `lastUsedDay := d` raises
 * S through `uses`, so the next interval is longer — the testing effect.
 *
 * THE TIER ONLY GOES UP WITHIN A DAY (2026-10-11, `drewOn`; ported from
 * #371). `upgradeFrom` names a lower tier the SAME memory was credited at
 * earlier this lived day (the caller knows it; physics carries no tier). Then
 * the day's credit is lifted to `tier`: `uses` gains the difference, the clock
 * is already today's, and the reinforced day is not counted twice. Without it
 * a `drewOn` credit at one boundary would refuse an expansion at the next as
 * `already-credited-today`. Lightly held. Why: review 05 C2 ("a referenced use
 * the same day supersedes it").
 */
export function creditUse(m: MemoryPhysics, d: number, tier: UseTier, opts: { upgradeFrom?: UseTier } = {}): CreditOutcome {
  const w = USE_TIER_WEIGHT[tier];
  const days = reinforcedDays(m);
  const unchanged = { uses: m.uses, lastUsedDay: m.lastUsedDay, reinforcedDays: days };
  if (w <= 0) return { credited: false, reason: "ignorable-tier", w, next: unchanged };
  if (d === m.birthDay) return { credited: false, reason: "birth-day", w, next: unchanged };
  if (d < m.lastUsedDay) return { credited: false, reason: "stale-day", w, next: unchanged };
  if (d === m.lastUsedDay) {
    const from = opts.upgradeFrom === undefined ? 0 : USE_TIER_WEIGHT[opts.upgradeFrom];
    if (from > 0 && from < w) {
      return { credited: true, reason: "credited", w, next: { uses: m.uses + (w - from), lastUsedDay: d, reinforcedDays: days } };
    }
    return { credited: false, reason: "already-credited-today", w, next: unchanged };
  }
  return {
    credited: true,
    reason: "credited",
    w,
    next: { uses: m.uses + w, lastUsedDay: d, reinforcedDays: days + 1 },
  };
}

// ---------------------------------------------------------------------------
// §5.6 Revision — declared, pressure-accumulated, no second object
// ---------------------------------------------------------------------------

/** The challenging memory, as physics sees it: its own state plus its declaration. */
export interface Challenge {
  id: string;
  /** The `updates: <memory-id>` field, DECLARED BY THE WRITER. There is no
   *  inferred-revision path (guarantee 7). */
  declaredUpdates: string | null;
  physics: MemoryPhysics;
}

export type ChallengeReason =
  | "revised"
  | "below-bar"
  | "no-declared-target"
  | "target-mismatch"
  | "already-challenged-today"
  | "stale-day";

export interface ChallengeLogEntry {
  readonly event: "revision.pressure";
  readonly day: number;
  readonly challengerId: string;
  readonly force: number;
  readonly pressureAfter: number;
  readonly bar: number;
}

export interface ChallengeOutcome {
  verdict: "revise" | "hold";
  credited: boolean;
  reason: ChallengeReason;
  /** F(new -> old) for this challenge; 0 when nothing was credited. */
  force: number;
  /** P(old) decayed to day d, before this challenge. */
  pressureBefore: number;
  pressureAfter: number;
  /** iota(kind) x strength(old, d) — what the pressure has to beat. */
  bar: number;
  next: Pick<MemoryPhysics, "pressure" | "lastChallengedDay">;
  /** Every increment is logged — the pressure history IS the evidence record. */
  log: ChallengeLogEntry | null;
}

/**
 * F(new -> old) = strength(new, d) x sal(new) — author-assessed evidence weight.
 *
 * NOVELTY PLAYS NO ROLE HERE by design (review condition (c)): it was doing
 * double duty as detector and magnitude, and because novelty is computed against
 * context that CONTAINS the target when the author was informed, it rewarded
 * blind challenges over informed ones. The declaration carries intent; sal
 * carries magnitude.
 */
export function challengeForce(
  challenger: MemoryPhysics,
  d: number,
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): number {
  return strength(challenger, d, shape) * sal(challenger.salience);
}

/**
 * P(old) decayed to day d. Same curve family as memory, keyed to the last
 * challenge day, so an abandoned challenge FADES instead of lying in ambush.
 * Pressure decays even against an identity-band target: D = 1 exempts the
 * memory, never the pressure standing against it.
 */
export function pressureAt(
  m: Pick<MemoryPhysics, "pressure" | "lastChallengedDay">,
  d: number,
  // Pinned exponential (2026-10-10): the memory curve went power-law; the
  // pressure curve is the revision model's and stays as it was (`DECAY_SHAPE`).
  shape: DecayShape = "exponential",
): number {
  if (m.pressure <= 0 || m.lastChallengedDay === null) return 0;
  return m.pressure * decayCurve(d - m.lastChallengedDay, TUNABLES.S_PRESSURE, shape);
}

/** iota(kind) x strength(old, d) — the revision bar. */
export function revisionBar(
  target: MemoryPhysics,
  d: number,
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): number {
  return kindPhysics(target.kind).iota * strength(target, d, shape);
}

/**
 * One declared challenge landing on one target on lived day d (§5.6, rewritten
 * 2026-08-25). Order of operations: decay P to d, add F, compare.
 *
 *   P(old) += F(new -> old)
 *   REVISE iff P(old) > iota(kind(old)) x strength(old, d)
 *
 * ONE credited challenge per target per lived day — no session can spam a belief
 * into flipping. The pressure is a FIELD ON THE TARGET ROW; there is no second
 * object, so scar §2.2's dangling-ledger family cannot recur.
 */
export function applyChallenge(
  targetId: string,
  target: MemoryPhysics,
  challenge: Challenge,
  d: number,
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): ChallengeOutcome {
  const bar = revisionBar(target, d, shape);
  const pressureBefore = pressureAt(target, d);
  const unchanged = { pressure: target.pressure, lastChallengedDay: target.lastChallengedDay };
  const refuse = (reason: ChallengeReason): ChallengeOutcome => ({
    verdict: "hold",
    credited: false,
    reason,
    force: 0,
    pressureBefore,
    pressureAfter: pressureBefore,
    bar,
    next: unchanged,
    log: null,
  });

  if (challenge.declaredUpdates === null) return refuse("no-declared-target");
  if (challenge.declaredUpdates !== targetId) return refuse("target-mismatch");
  if (target.lastChallengedDay !== null && d === target.lastChallengedDay) {
    return refuse("already-challenged-today");
  }
  if (target.lastChallengedDay !== null && d < target.lastChallengedDay) return refuse("stale-day");

  const rawForce = challengeForce(challenge.physics, d, shape);
  const slow = kindPhysics(target.kind).iota >= TUNABLES.SLOW_KIND_IOTA;
  const force = slow ? Math.min(rawForce, TUNABLES.F_DAY_CAP_SLOW) : rawForce;
  const pressureAfter = pressureBefore + force;
  const revise = pressureAfter > bar;
  return {
    verdict: revise ? "revise" : "hold",
    credited: true,
    reason: revise ? "revised" : "below-bar",
    force,
    pressureBefore,
    pressureAfter,
    bar,
    next: { pressure: pressureAfter, lastChallengedDay: d },
    log: {
      event: "revision.pressure",
      day: d,
      challengerId: challenge.id,
      force,
      pressureAfter,
      bar,
    },
  };
}

export interface SupersedeRecord {
  readonly event: "memory.superseded";
  readonly predecessorId: string;
  readonly successorId: string;
  readonly day: number;
  /** Superseded versions stay RESOLVABLE until this lived day (guarantee 9).
   *  Nothing in physics deletes one. */
  readonly resolvableUntilDay: number;
}

export function supersedeRecord(
  predecessorId: string,
  successorId: string,
  d: number,
): SupersedeRecord {
  return {
    event: "memory.superseded",
    predecessorId,
    successorId,
    day: d,
    resolvableUntilDay: d + TUNABLES.H_SUPERSEDED_DAYS,
  };
}

export function supersededResolvable(supersededOnDay: number, d: number): boolean {
  return d - supersededOnDay <= TUNABLES.H_SUPERSEDED_DAYS;
}

/**
 * The successor's revision-relevant seed state on REVISE. Pressure resets to 0,
 * and identity membership is INHERITED (§5.3(a)) unless the caller declares the
 * revision a demotion — the only way out of the identity band.
 */
export function successorSeed(
  target: MemoryPhysics,
  opts: { inheritIdentity?: boolean } = {},
): Pick<MemoryPhysics, "promotedIdentity" | "pressure" | "lastChallengedDay"> {
  const inherit = opts.inheritIdentity ?? true;
  return {
    promotedIdentity: inherit ? target.promotedIdentity : false,
    pressure: 0,
    lastChallengedDay: null,
  };
}

// ---------------------------------------------------------------------------
// §5.7 Dedup
// ---------------------------------------------------------------------------

export type DedupReason =
  | "declared-revision-never-merged"
  | "revision-successor-never-merged"
  | "identical-content-hash"
  | "cosine-at-or-above-tau"
  | "below-tau"
  | "no-similarity-supplied";

export interface DedupInput {
  /** The id of the ORIGINAL this candidate would merge into. */
  originalId: string;
  /** The candidate's `updates:` declaration, if it made one. */
  declaredUpdates: string | null;
  /**
   * True when merging this pair would archive a revision's SUCCESSOR — either
   * because the two rows stand in a direct successor relation (one was minted by
   * revising, carrying the other's words), or because the candidate is a
   * successor and the pair is same-hash. The second case is sound for the same
   * reason as the first: a successor's body IS its challenger's body by
   * construction, so any same-hash group it belongs to is that challenger plus
   * ordinary twins of the same sentence, and none of those is what the revision
   * produced. Lineage is a store fact, so the caller reads it and supplies it
   * here — the same division of labour as `sameContentHash`.
   */
  revisionSuccessorPair?: boolean;
  /** Content hashes, supplied by the caller. */
  sameContentHash?: boolean;
  /** cos( v(new), v(orig) ), supplied by the caller. Null when no vector exists. */
  cosine?: number | null;
}

export interface DedupVerdict {
  verdict: "merge" | "leave-alone";
  reason: DedupReason;
  /** The whole effect of a merge: uses(orig) += 1. Never a rewrite, never a blend. */
  effect: { usesDelta: number } | null;
}

/**
 * Dedup (§5.7). Ambiguous near-duplicates are LEFT ALONE (owner decision) —
 * accepted rent, paid for zero substrate confabulation [v1 §4.2 G9].
 *
 * A memory that declares `updates:` is NEVER deduplicated into its target
 * (guarantee 8): otherwise a topically-close refutation merges into the belief
 * it refutes and REINFORCES it — scar §2.10's one-way ratchet, rebuilt by
 * accident. The declaration is checked FIRST, before hash and before cosine.
 *
 * The declaration's other half, and the same refusal (guarantee 8b): **a
 * revision's SUCCESSOR and the challenger it was made from are never merged
 * into each other, in either direction**. A revision mints the successor with
 * the challenger's own words — that is what winning an argument means here
 * (§5.6) — so the two bodies are identical BY CONSTRUCTION and every dedup pass
 * after the crossing finds them. Checked before hash and cosine, because the
 * hash is precisely what is guaranteed to match.
 */
export function dedupVerdict(input: DedupInput): DedupVerdict {
  if (input.declaredUpdates !== null && input.declaredUpdates === input.originalId) {
    return { verdict: "leave-alone", reason: "declared-revision-never-merged", effect: null };
  }
  if (input.revisionSuccessorPair === true) {
    return { verdict: "leave-alone", reason: "revision-successor-never-merged", effect: null };
  }
  if (input.sameContentHash === true) {
    return { verdict: "merge", reason: "identical-content-hash", effect: { usesDelta: 1 } };
  }
  const cos = input.cosine ?? null;
  if (cos === null) {
    return { verdict: "leave-alone", reason: "no-similarity-supplied", effect: null };
  }
  if (cos >= TUNABLES.TAU_DUP) {
    return { verdict: "merge", reason: "cosine-at-or-above-tau", effect: { usesDelta: 1 } };
  }
  return { verdict: "leave-alone", reason: "below-tau", effect: null };
}

// ---------------------------------------------------------------------------
// §5.8 Forgetting
// ---------------------------------------------------------------------------

export type PruneReason =
  | "prunable"
  | "above-floor"
  | "dwell-too-short"
  | "band-not-episodic"
  | "protected"
  | "in-live-revision-chain"
  /** Its reminder date still repeats (`meta.recurring`, 2026-10-09): see `pruneVerdict`. */
  | "recurring";

/** Counts, kind, dates. NEVER a body and NEVER a content hash (scar §2.20). */
export interface PruneRecord {
  readonly event: "memory.pruned";
  readonly day: number;
  readonly kind: Kind;
  readonly band: Band;
  readonly birthDay: number;
  readonly lastUsedDay: number;
  readonly uses: number;
  readonly strength: number;
}

export interface PruneVerdict {
  prune: boolean;
  reason: PruneReason;
  /** Every failing gate, not just the first — all six are named; the three
   *  named rules (`protected`, `in-live-revision-chain`, `recurring`) only
   *  where the floor alone would have let the memory go. */
  blockedBy: PruneReason[];
  strength: number;
  band: Band;
  dwellDays: number;
  record: PruneRecord | null;
}

/**
 * The ONLY physics-driven removal (§5.8), gated on all six conditions. No
 * model, on any path, holds delete power — this returns a verdict and a record;
 * it deletes nothing itself. Everything else merely fades: a low-strength memory
 * is still present and still retrievable by a strong enough cue.
 *
 * `ctx.recurring` (2026-10-09, the owner's decision, held lightly): the memory's
 * reminder date still repeats. Each occurrence it is told or surfaced on counts
 * as a use (`Counterpart#creditOccurrence`), which carries a daily, weekly or
 * monthly repeat; a yearly one is used once a year, and no single use outlasts
 * 365 lived days at an ordinary salience. So a live repeat is refused here by
 * name, as `protected` is — and, like `protected`, only where the floor would
 * otherwise have let it go, since both are exemptions from the floor and not
 * standing rules (review of #341; `protected` on the same terms, 2026-10-09,
 * and `in-live-revision-chain` too, review of #343). No outcome turns on it:
 * where the floor holds, the verdict is already a refusal.
 * Only the prune: it still fades, its band and strength read as
 * before. Prospective does not refuse a live repeat `faded` (review of #341,
 * `prospective/derive.ts`), so each occurrence is still delivered.
 */
export function pruneVerdict(
  m: MemoryPhysics,
  d: number,
  ctx: { inLiveRevisionChain: boolean; recurring?: boolean },
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): PruneVerdict {
  const s = strength(m, d, shape);
  const b = band(m, d, shape);
  // Dwell from the curve's own anchor (2026-10-10): a dream replay or a
  // reflection that revived a memory restarts its dwell as a use does.
  const dwellDays = d - decayAnchor(m);
  const blockedBy: PruneReason[] = [];
  if (s >= TUNABLES.PHI_PRUNE) blockedBy.push("above-floor");
  if (dwellDays < TUNABLES.D_FLOOR_DAYS) blockedBy.push("dwell-too-short");
  if (b !== "episodic") blockedBy.push("band-not-episodic");
  // The three floor conditions above are arithmetic ("not yet"); the rest are
  // named rules.
  const floorLetsGo = blockedBy.length === 0;
  // The owner's "never forget this" is an exemption FROM THE FLOOR too, named
  // on the same terms as `recurring` below (2026-10-09): a protected memory
  // above the floor is held by arithmetic alone. Named on every protected row
  // every night — the self page is born protected — it read as a refusal in
  // the fired view's prune row on a store too young for anything to reach the
  // floor. Outcomes are unchanged: where the floor holds, `blockedBy` is
  // already non-empty.
  if (m.protected && floorLetsGo) blockedBy.push("protected");
  // A live revision chain holds back a row the floor would otherwise have let
  // go — and is named on the same terms (review of #343): a row under
  // challenge pressure, or one whose version still names a successor within H
  // lived days, was counted on every night it stayed so, however strong it was.
  if (ctx.inLiveRevisionChain && floorLetsGo) blockedBy.push("in-live-revision-chain");
  // An exemption FROM THE FLOOR, so named only where the floor would have let
  // the memory go (review of #341): a repeat well above it is held by
  // `above-floor` and nothing else, and naming `recurring` on every live repeat
  // every night read as a refusal in the fired view's prune row.
  if (ctx.recurring === true && floorLetsGo) blockedBy.push("recurring");
  const prune = blockedBy.length === 0;
  return {
    prune,
    reason: blockedBy[0] ?? "prunable",
    blockedBy,
    strength: s,
    band: b,
    dwellDays,
    record: prune
      ? {
          event: "memory.pruned",
          day: d,
          kind: m.kind,
          band: b,
          birthDay: m.birthDay,
          lastUsedDay: m.lastUsedDay,
          uses: m.uses,
          strength: s,
        }
      : null,
  };
}
