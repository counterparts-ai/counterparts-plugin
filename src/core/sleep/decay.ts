/**
 * The decay tick — synaptic downscaling, as a cache refresh.
 *
 * What this phase does: recompute `strength(m, d)` and `band(m, d)` for every
 * live memory and materialize the result into the ranking cache (box 3) — and,
 * since 2026-09-14, write each row's band back to the box-2 `band` column when
 * the column disagrees with the arithmetic.
 *
 * What it does NOT do, and cannot: apply a decay STEP to canonical state.
 * Strength is a pure function of stored state and the lived day, so there is no
 * "step" to apply and nothing to double-apply. `uses`, `lastUsedDay` and the
 * prose are untouched. v1 materialized decay into canonical files (~1.9K file
 * writes a day); v2 received that as an open choice with the evidence attached
 * (behavioral-spec §11) and declined it, and still declines it.
 *
 * THE BAND COLUMN IS THE ONE EXCEPTION, and it is a reconciliation rather than a
 * materialization (IMPROVEMENTS U8, 2026-09-14). `band(m, d)` is the same pure
 * function either way; the column existed as a fossil — episodic at mint,
 * identity at promotion, and never "semantic" — so on the live store 869 rows
 * were semantic in the cache and episodic in the table, and every surface that
 * read the column (the `status` tool's `byBand`) reported a number the system
 * itself did not believe. A pass that EMITS `band.transition` rows and leaves
 * the table contradicting them is a pass that lies in two places at once
 * (constitution 16). So: one UPDATE per row whose column is wrong, never a
 * strength write, never a row that already agrees — a caught-up store writes a
 * handful a day, and a replayed day writes nothing at all. See `NOTES.md` §5.
 *
 * THE SKIP LIST IS BEHAVIOR, and each skip is reported separately (§3, v1 §11
 * G5). Note what "skipped" means here: because the recompute is arithmetic, an
 * identity-band memory is not branched around — `physics.decay()` returns D = 1
 * for it, so the exemption IS the arithmetic. The category is still counted,
 * because "how many rows did not move, and why" is the question the telemetry
 * exists to answer, and a category that is structurally zero is a different
 * record from one that never fired (scar §2.4).
 *
 * CALM BY DEFAULT (v1 §11 G8): a row is written only when it actually moves
 * past `DECAY_QUANTUM` or changes band. A quiet day writes almost nothing.
 *
 * AND — since 2026-08-25 — THIS IS THE ONE PLACE BAND MOVES ARE COUNTED BY
 * DIRECTION, which is what makes `physics.symmetryCheck` (guarantee 12, scar
 * §2.10) a live tripwire instead of a function nobody calls.
 *
 * One place, deliberately, and the reason is arithmetic. Every way a band can
 * change is visible HERE, because `band(m, d)` is a pure function of stored
 * state and this pass reads it for every live row against its last reading:
 *
 *   - a DECAY DEMOTION (semantic→episodic) is only ever a number falling back
 *     under `THETA_SEM`, so this pass is the only place it exists at all —
 *     it was v1's dominant crossing, 268 of 345;
 *   - a REVISION-DRIVEN demotion is the same fact: a challenged memory's
 *     strength moves, and the next tick reads the new band. `schemas/` writes
 *     no band and neither does `supersede` — a source scan says so;
 *   - the IDENTITY CROSSING is a decision `consolidate/` makes and records for
 *     itself, and it becomes a band move here on the next tick, because
 *     `promotedIdentity` makes `band()` answer "identity".
 *
 * Counting the crossing at the promotion site TOO would count it twice — the
 * cache diff has no way to know a move was already recorded — and a
 * double-counted up-move is a ratchet tripwire lying in the ratchet's own
 * direction. So the promotion's up-move is counted one lived day later, which
 * is a lag in a counter whose sample threshold is 20 moves across the whole
 * history, and is the price of having exactly one definition of a crossing.
 */

import { NEVER_CHANGES, band, bandMove, nextChangeDay, strength } from "../physics/index.js";
import { TUNABLES as PHYSICS } from "../physics/index.js";
import type { Band, DatedHold } from "../physics/index.js";
import { CLAIMS_ERA_CUTOFF_KEY, reachExempt, rowToPhysics } from "../store/operational.js";
import { TUNABLES } from "./tunables.js";
import type { BandTransition, PhaseCtx, PhaseOutcome } from "./types.js";
import { countSkip, emptyOutcome, isEntityCard, isHandoffRow, isJournal, isJournalCopy, isSelfPageRow, recordBandTransition } from "./types.js";
import { censusDue, upgradeCensus } from "./upgrade.js";
import type { StrengthCache, StrengthRow } from "./strength-cache.js";
import type { Phase } from "./types.js";
import { readCursor, resumeIndex, writeCursor } from "./markers.js";

/** This phase's own name, for the cursor it keeps (typed: a rename fails `tsc`). */
const DECAY_PHASE: Phase = "decay";

/**
 * THE CURVE A STORE'S NEXT-CHANGE DAYS WERE COMPUTED UNDER (2026-10-10). The
 * turn-down trusts `memories.next_change_day` only while the constants that
 * produced it are the ones this build runs; a build with another curve forgets
 * them all once (`clearNextChangeDays`) and looks at every row on its first
 * pass. Meta key + the signature it holds.
 *
 * EVERY constant that moves a strength, a line or the hold belongs here —
 * height's (`base`: each kind's `wSal`/`wRep`, `REP_PER_USE`, `REP_CAP`,
 * `REP_SCALE_USES`, `CONS_BONUS`; `salArm`'s lift), steepness's, the lines', the hold's (review
 * of #372: the height constants were missing, so a build that changed a
 * kind's salience weight would have trusted next-change days computed under
 * the old heights). Group 1c's `FELT_HEIGHT_CAP` (`salArm`) is one of them;
 * a constant added to `salArm` or `base` later joins it too.
 */
export const CURVE_META_KEY = "decay.curve";
export function curveSignature(eraCutoff: string | null = null): string {
  return JSON.stringify({
    // THE OLD-CLAIMS ERA (2026-10-10): the cutoff the curve reads, and the
    // defaults it reads old claims at (`operational.ts#eraClaimOf`). Turning
    // the era on or off, or moving its cutoff, changes the effective claim of
    // every old memory, so every next-change day is forgotten once.
    era: eraCutoff,
    // Which old claims it reads at today's default: 1, explicit claims when
    // lower (2026-10-10); 2, defaults too, either way (2026-10-11). A store
    // signed under 1 re-curves once.
    eraReads: 2,
    defaults: [
      PHYSICS.DEFAULT_CLAIM_WORK_EVENT,
      PHYSICS.AUTHORED_DEFAULT_CLAIM,
      PHYSICS.DEFAULT_CLAIM_WORLD,
      PHYSICS.DEFAULT_CLAIM_PERSONAL,
    ],
    shape: PHYSICS.DECAY_SHAPE,
    psi: PHYSICS.POWER_LAW_PSI,
    s0: PHYSICS.S0,
    g: PHYSICS.STABILITY_GAIN,
    q: PHYSICS.EMO_Q,
    lift: PHYSICS.EMO_LIFT,
    beta: PHYSICS.BETA,
    ret: PHYSICS.RETURN_GAIN,
    rep: PHYSICS.REP_PER_USE,
    repCap: PHYSICS.REP_CAP,
    // The saturating repetition arm (2026-10-11, `drewOn`; review of #385):
    // `rep()` reads this, not `REP_PER_USE`, so a store whose next-change days
    // were computed under the linear arm forgets them once.
    repScale: PHYSICS.REP_SCALE_USES,
    cons: PHYSICS.CONS_BONUS,
    sem: PHYSICS.THETA_SEM,
    reach: PHYSICS.REACH,
    floor: PHYSICS.PHI_PRUNE,
    dwell: PHYSICS.D_FLOOR_DAYS,
    grace: PHYSICS.HOLD_GRACE_DAYS,
    lead: PHYSICS.HOLD_LEAD_DAYS,
    // After a one-off date's window: its own curve from its own anchor
    // (2026-10-11; replaces `spent: 4`, the ÷4 slope — named, so a store
    // signed by any build before it re-curves once).
    afterHold: "own-curve",
    // Group 1c's height cap (`salArm`).
    felt: PHYSICS.FELT_HEIGHT_CAP,
    kinds: Object.fromEntries(Object.entries(PHYSICS.KINDS).map(([k, v]) => [k, [v.wSal, v.wRep, v.kappa]])),
  });
}

/**
 * WHY A BAND MOVED (2026-10-10, the up-ratchet tripwire; review of #372). Pure.
 * Down is the curve; up has to have something behind it, or it is the ratchet
 * the tripwire exists for:
 *
 *   - `recurve`: the pass a new curve arrived on (`CURVE_META_KEY` changed) —
 *     either way, the build's constants moved it; the tripwire skips it;
 *   - `promoted`: into the identity band;
 *   - `input`: the row's next-change day was NULL — read BEFORE this pass wrote
 *     anything, so a trigger cleared it because an input of the curve was
 *     written (or a rebuilt cache cleared them all);
 *   - `held`: a held dated memory — its standing turns on the CALENDAR (a
 *     repeating date's window opening lifts it to t = 0), so it is read daily
 *     and a climb there is the date's, not a ratchet;
 *   - `unexplained`: none of these — a strength that rose by itself.
 */
export function bandMoveCause(
  direction: "up" | "down",
  to: Band,
  nextChangeDay: number | null | undefined,
  hold: DatedHold | null,
  recurved: boolean,
): BandTransition["cause"] {
  if (recurved && to !== "identity") return "recurve";
  if (direction === "down") return "curve";
  if (to === "identity") return "promoted";
  if (nextChangeDay === null || nextChangeDay === undefined) return "input";
  return hold !== null ? "held" : "unexplained";
}

/** Skip categories, enumerated so a zero is distinguishable from an absence. */
export const DECAY_SKIPS = [
  "archived",
  "removed",
  /** The journal, which is a source and not a memory (`types.ts#isJournal`). */
  "journal",
  /** A chapter's copy — journal too (2026-10-10, review 03 C4a; `types.ts#isJournalCopy`). */
  "journal-copy",
  /** A handoff — its own lived-day expiry is its clock (2026-10-10, review 03 C4b). */
  "handoff",
  /** An entity card — a stub at salience 0, faded by `schemas/`' own verdict (2026-10-10). */
  "entity-card",
  /** The self page — never decayed below reach (2026-10-10, review of #372). */
  "self-page",
  "identity-band",
  "reinforced-today",
  "at-floor",
  "under-audit",
  "unchanged",
] as const;

export type DecaySkip = (typeof DECAY_SKIPS)[number];

export interface DecayResult extends PhaseOutcome {
  /** The rows written this cycle — ids and numbers, never text. */
  written: readonly StrengthRow[];
  /**
   * Band crossings this tick, BY DIRECTION (guarantee 12). v1's dominant
   * crossing was the semantic→episodic decay demotion — 268 of 345 — and this
   * pass is the only place one is observable, because a demotion is not a
   * decision anybody makes: it is the arithmetic falling back under `THETA_SEM`.
   */
  transitions: readonly BandTransition[];
  /**
   * Rows whose box-2 `band` column disagreed with `band(m, d)` and was brought
   * to it this pass (U8). It is a RECONCILIATION count, not a crossing count:
   * `transitions` is the crossing record and is read off the cache diff, while
   * this is "how many rows did the table have wrong". On a caught-up store it is
   * the same handful as the crossings; the first pass after this shipped carries
   * the whole backlog, which is the number worth seeing once.
   *
   * It is ALSO `PhaseOutcome.reconciled`, which is how it reaches the phase
   * report and the durable `sleep.cycle` row; this field is the name the phase's
   * own callers already use. Counted under observer too — only the write is
   * gated on `apply`.
   */
  bandsReconciled: number;
}

export function runDecay(ctx: PhaseCtx, cache: StrengthCache | null): DecayResult {
  const out = emptyOutcome();
  for (const skip of DECAY_SKIPS) out.skipped[skip] = 0;
  // Once per store, the first decay pass after the v8 upgrade measures every
  // row old-vs-new (`upgrade.ts`). It is a READ plus one meta row; a failure
  // here is recorded and never costs the tick.
  if (ctx.apply && censusDue(ctx.store)) {
    try {
      upgradeCensus(ctx);
    } catch (err) {
      ctx.event("sleep.upgrade.census.failed", undefined, { error: err instanceof Error ? err.name : "UNKNOWN" });
    }
  }

  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  const prior = cache === null ? new Map<string, StrengthRow>() : cache.readAll();
  const written: StrengthRow[] = [];
  const transitions: BandTransition[] = [];
  let bandsReconciled = 0;
  // THE TURN-DOWN (2026-10-10, Group 1, review 13 C2): only the rows whose
  // band, reach or prune eligibility changes today — their stored next-change
  // day has come — and the rows with none (new, or an input of their curve was
  // written since: a trigger clears it). Everything else reads exactly what it
  // read at its last pass, so there is nothing to recompute. A store written
  // under another curve forgets every next-change day first (`CURVE_META_KEY`);
  // an observer, which writes nothing, walks the whole store as before, and so
  // does a port without the turn-down.
  const signature = curveSignature(store.getMeta(CLAIMS_ERA_CUTOFF_KEY) ?? null);
  const sameCurve = store.getMeta(CURVE_META_KEY) === signature;
  const turnDown =
    typeof store.turnDownDue === "function" && typeof store.setNextChangeDays === "function" && (sameCurve || ctx.apply);
  // Forgotten and re-signed together: every row is then NULL, so it stays due
  // until a pass reaches it, however many passes a budget takes.
  if (turnDown && !sameCurve && ctx.apply) {
    store.clearNextChangeDays?.();
    store.setMeta(CURVE_META_KEY, signature);
  }
  // THE PASS A NEW CURVE ARRIVES ON (review of #372): every band it moves moved
  // because this build's constants differ, not because anything was used or
  // anything ratcheted — `recurve`, which the tripwire does not count.
  const recurved = turnDown && !sameCurve && ctx.apply;
  // A RANKING CACHE THAT IS GONE (`rebuildCache`, `verify --rebuild`) holds
  // nothing for the rows the turn-down would leave alone, so every row is looked
  // at again — the same as a new curve.
  if (turnDown && sameCurve && ctx.apply && cache !== null && prior.size === 0) store.clearNextChangeDays?.();
  // LIVE ROWS ONLY (2026-10-10, Lane 0 / scale review C3): archived rows are
  // left out in SQL instead of each being read and skipped (`turnDownDue` reads
  // live rows only too). Still counted, by their ids alone, so the named skip
  // says what it said.
  const ids = turnDown && store.turnDownDue !== undefined ? store.turnDownDue(day) : store.list({ archived: false });
  countSkip(out, "archived", store.list({ archived: true }).length);
  const nextChanges: { id: string; day: number }[] = [];
  const dropped: string[] = [];
  // WHERE THE LAST RUN STOPPED (2026-09-28, build B; the audit's #4). `store.list()`
  // is `ORDER BY id` and ids are random, so without a resume point a budget
  // smaller than the store examined the same slice every night and the rest
  // never. Like `consolidate`: this run starts strictly after the cursor and
  // wraps; the cursor moves only under `apply`.
  const start = resumeIndex(ids, readCursor(store, DECAY_PHASE));
  const order = start === 0 ? ids : [...ids.slice(start), ...ids.slice(0, start)];
  let stoppedAt: string | null = null;

  let index = 0;
  for (const id of order) {
    if (out.examined >= ctx.budget) {
      out.budgetExhausted = true;
      out.skippedForBudget = ids.length - index;
      break;
    }
    index += 1;
    stoppedAt = id;
    const row = store.row(id);
    if (row === undefined) continue;
    if (denied.has(id)) {
      countSkip(out, "removed");
      nextChanges.push({ id, day: NEVER_CHANGES });
      continue;
    }
    if (row.archived === 1) {
      // Archived between the list and the read: counted as the rest were.
      countSkip(out, "archived");
      continue;
    }
    // The journal is a source, not a memory: it is not examined, so it cannot
    // move a band or write a strength row (`types.ts#isJournal`).
    if (isJournal(row)) {
      countSkip(out, "journal");
      nextChanges.push({ id, day: NEVER_CHANGES });
      continue;
    }
    // A chapter's copy is the journal too, a handoff keeps its own clock, and
    // an entity card fades by `schemas/`' verdict (2026-10-10, review 03 C4;
    // `operational.ts#reachExempt`): none is examined, and any ranking row an
    // earlier build wrote for one is dropped, so the ambient prefilter never
    // reads it as below reach.
    if (reachExempt(row)) {
      countSkip(
        out,
        isJournalCopy(row) ? "journal-copy" : isHandoffRow(row) ? "handoff" : isEntityCard(row) ? "entity-card" : isSelfPageRow(row) ? "self-page" : "journal",
      );
      nextChanges.push({ id, day: NEVER_CHANGES });
      if (prior.has(id)) dropped.push(id);
      continue;
    }
    out.examined += 1;

    const p = rowToPhysics(row);
    const s = strength(p, day);
    const b = band(p, day);
    nextChanges.push({ id, day: nextChangeDay(p, day) });

    // The named skip categories. They are reported, not branched on: the
    // arithmetic already produces the right number for each.
    if (p.promotedIdentity) countSkip(out, "identity-band");
    if (p.lastUsedDay === day) countSkip(out, "reinforced-today");
    if (s < PHYSICS.PHI_PRUNE) countSkip(out, "at-floor");

    // THE BAND OF RECORD (U8), and why it is here rather than inside the
    // `moved` branch below. `moved` is a question about the CACHE — has this row
    // changed since its last reading — and a row whose cache was right all along
    // while the table was wrong answers "no" forever. Asking the column directly
    // is what makes the reconciliation total: after a pass that was not cut
    // short by the budget, no live non-journal row's column contradicts the
    // arithmetic, which is exactly what `counterparts verify` now counts.
    //
    // THE COUNT IS NOT GATED ON `apply`, only the WRITE is. `PhaseCtx.apply`'s
    // contract is that the read-only path walks the identical code and computes
    // the identical verdicts — it simply never reaches a write — and
    // `sleep.observer.report`'s `would` rides on that. Counting inside the
    // `apply` branch made an observer report 0 disagreements on a store with
    // 869 of them, which is the one number an instrument exists to print.
    const wrong = row.band !== b;
    if (wrong) {
      bandsReconciled += 1;
      if (ctx.apply) store.setBand(id, b, day);
    }

    const was = prior.get(id);
    // Crossing REACH is a move however small the step (2026-10-10): the
    // ambient prefilter reads the cache's side of the line.
    const moved =
      was === undefined ||
      was.band !== b ||
      Math.abs(was.strength - s) >= TUNABLES.DECAY_QUANTUM ||
      was.strength < PHYSICS.REACH !== s < PHYSICS.REACH;
    if (!moved) {
      // A ROW THE PASS ACTED ON IS NOT AN UNCHANGED ROW, even when the cache had
      // nothing to say about it. On the exact U8 shape — the column wrong and
      // the ranking cache already right — `moved` is false for every row, and
      // counting those as `unchanged` is what made `runCycle` issue 869 UPDATEs
      // and then file the phase as `ran-nothing-found` / `nothing-to-do`. Either
      // or, never both: the row is counted once, in the category that is true.
      if (wrong) out.changed += 1;
      else countSkip(out, "unchanged");
      continue;
    }
    // A CROSSING, not a first reading. `was === undefined` is the cache filling
    // in — a fresh store, or the tick after `rebuildCache()` dropped box 3 — and
    // counting those as up-moves would hand the ratchet tripwire a burst of
    // fabricated promotions on exactly the days it is least able to tell.
    if (was !== undefined && was.band !== b) {
      const direction = bandMove(was.band, b);
      if (direction !== "none") {
        // Why it moved (2026-10-10): `bandMoveCause`.
        const cause = bandMoveCause(direction, b, row.next_change_day, p.hold ?? null, recurved);
        const transition: BandTransition = {
          id,
          kind: row.kind,
          from: was.band,
          to: b,
          direction,
          site: "decay",
          day,
          cause,
        };
        transitions.push(transition);
        recordBandTransition(ctx, transition);
      }
    }
    written.push({ id, strength: s, band: b, day });
    out.changed += 1;
    ctx.step("item", { index, id });
  }

  // A PASS THAT ONLY RECONCILED STILL DID SOMETHING. The old guard asked the
  // cache alone, so the U8 catch-up — 869 columns rewritten, no strength row
  // moved — left no ring event at all, and the one pass worth watching was the
  // one the log could not see.
  if (ctx.apply && cache !== null && dropped.length > 0) cache.drop?.(dropped);
  if (ctx.apply && turnDown) {
    store.setNextChangeDays?.(nextChanges);
  }
  if (ctx.apply && cache !== null && (written.length > 0 || bandsReconciled > 0)) {
    if (written.length > 0) cache.write(written);
    ctx.event("sleep.decay.materialized", undefined, {
      rows: written.length,
      examined: out.examined,
      bandsReconciled,
      day,
    });
  }
  if (ctx.apply && stoppedAt !== null) writeCursor(store, DECAY_PHASE, stoppedAt);
  return { ...out, reconciled: bandsReconciled, written, transitions, bandsReconciled };
}
