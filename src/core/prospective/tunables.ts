/**
 * Every prospective knob, in one visible place — the shape `physics/` and
 * `recall/` use, for the same reason: a threshold hiding in a function body
 * cannot be audited.
 *
 * **CAL = calibration-required** (scar §2.8, CONTRACT §4: "v1's knob set is not
 * inherited as defaults"). The numbers below ARE v1's live §12 values, carried as
 * the recorded starting point and nothing more — a starting point, not a v2
 * measurement. `tools/replay` is where each one gets re-earned, and PR-A..PR-F are
 * the bar that must pass before this channel turns on at all.
 *
 * **Structural** (never tunable, never ablatable): no bypass lane; prospectivity
 * derived, never stored; the exclusions; the footnote cap; referenced-stop; the
 * window as the firing key; observer no-advance.
 */
import type { UseTier } from "../physics/index.js";
import { TUNABLES as PHYSICS } from "../physics/index.js";

export interface ProspectiveTunables {
  /** Salience below this never becomes prospective, however well dated.
   *  Salience, NOT strength: eligibility is a predicate over the event date, the
   *  encode date, salience and flags (§12 G2), and a decay exemption before
   *  arrival is exactly what G10 forbids. [v1: 0.6] CAL.
   *  Since 2026-09-26 (owner decision) it gates only a date a CALLER extracted:
   *  a memory with an explicit `eventDate` is exempt, because choosing a date
   *  is itself the importance signal. Decay (`FADED_STRENGTH`) still holds. */
  SALIENCE_FLOOR: number;
  /** Calendar days before the event the window opens. [v1: 3] CAL. */
  LEAD_DAYS: number;
  /** Calendar days after the event (or after month end) the window stays open —
   *  the post-window grace beat, whose warmth is open question 1. [v1: 7] CAL. */
  GRACE_DAYS: number;
  /** Weight a temporal cue carries into `recall/`'s cue stage, before the ramp
   *  scales it. It is ONE MORE CUE, never a channel of its own. [v1: 0.5] CAL. */
  CUE_STRENGTH: number;
  /** Cap on ambient fires per window — brake 2 of four. [v1: 2] CAL. */
  FIRES_PER_WINDOW: number;
  /** Arrivals offered to the wake horizon. [v1: 2 lines] CAL. */
  HORIZON_ITEMS: number;
  /** Ramp intensity on the day the window opens: a plan three days out means
   *  something, just less than the day itself. CAL, and with no v1 ancestry —
   *  v1 recorded lead DAYS, never a shape. */
  RAMP_OPEN: number;
  /** Ramp intensity on the last grace day. CAL, same provenance gap. */
  RAMP_CLOSE: number;
  /** Strength at or below which an unfired, closed window exits as FADED rather
   *  than EXPIRED (§5 G12's four named exits). Defaults to physics' prune floor:
   *  one rule, one owner. CAL by inheritance — PHI_PRUNE is itself uncalibrated.
   *  Since 2026-10-10 it never refuses a memory whose date is still pending
   *  (physics' dated hold; `index.ts`'s load): decay holds it until its window
   *  closes, so "faded before arrival" cannot happen — G10 reversed, lightly
   *  held, on the rules audit. NOT `REACH`: below reach is ambient recall's
   *  line, and a pending reminder is never below it on the way. */
  FADED_STRENGTH: number;
  /** Bound on the in-process session-dedup set (INTERFACE-GAPS #3). */
  MAX_SESSION_WINDOWS: number;
  /** Tune question (a), 2026-09-26: a month-dated memory peaks on the 1st plus a
   *  stable per-memory offset of `0..N-1` days, so a month-heavy store does not
   *  warm everything on day 1. 0 or 1 turns the stagger off. CAL — v1 measured
   *  the clustering, never a spread; seven is "the first week". */
  MONTH_STAGGER_DAYS: number;
  /** Tune question (b), 2026-09-26: a month or range window keeps its LAST fire
   *  for after the span it names — the "after" beat a month item never got in
   *  v1 (Rosa's post-surgery check-in). Only meaningful with
   *  `FIRES_PER_WINDOW >= 2`; with one fire it would never fire, so it is
   *  ignored there. Structural in shape, CAL in whether it is warm (open
   *  question 1). */
  HOLD_LAST_FIRE_FOR_AFTER: boolean;
}

/**
 * §12 G5 / CONTRACT §5 G4: **a temporal cue alone reaches the footnote tier at
 * most.** Not a tunable — the ceiling is the guarantee.
 */
export const TEMPORAL_MAX_TIER: UseTier = "footnoted";

export const TUNABLES: ProspectiveTunables = {
  SALIENCE_FLOOR: 0.6,
  // One owner (2026-10-10): decay holds a repeating date from this lead, too.
  LEAD_DAYS: PHYSICS.HOLD_LEAD_DAYS,
  // One rule, one owner (2026-10-10): decay holds a dated memory through the
  // same grace (physics `HOLD_GRACE_DAYS`), so the window and the hold close together.
  GRACE_DAYS: PHYSICS.HOLD_GRACE_DAYS,
  CUE_STRENGTH: 0.5,
  FIRES_PER_WINDOW: 2,
  HORIZON_ITEMS: 2,
  RAMP_OPEN: 0.4,
  RAMP_CLOSE: 0.2,
  FADED_STRENGTH: PHYSICS.PHI_PRUNE,
  MAX_SESSION_WINDOWS: 200,
  MONTH_STAGGER_DAYS: 7,
  HOLD_LAST_FIRE_FOR_AFTER: true,
};

export function withTunables(overrides: Partial<ProspectiveTunables> = {}): ProspectiveTunables {
  return { ...TUNABLES, ...overrides };
}
