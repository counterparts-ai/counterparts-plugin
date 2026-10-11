/**
 * The consolidation cycle — the librarian's whole run.
 *
 * Five properties live in this file, and every one of them is a test:
 *
 * 1. **Phase order is behavior** (§5 G5). `PHASES` is the order; the report
 *    echoes the order actually executed so an assertion can compare them.
 * 2. **Completion markers make a crash resumable** (§5 G4). A marker advances
 *    only after the work AND its persist succeed, and only forward. A cycle
 *    killed mid-phase leaves earlier markers advanced and the killed phase's
 *    marker where it was, so the rerun neither redoes nor skips.
 * 3. **A budget is not a debt** (§3, v1 §5 G4). Per-phase budgets cap effort;
 *    the marker still advances when a budget truncates a phase, and
 *    `skippedForBudget` is reported rather than carried as arrears.
 * 4. **Degrade, don't abort** (§5 G6). A phase that throws is caught, recorded
 *    as `failed` with its code, and the cycle continues — with its marker NOT
 *    advanced, so the work is retried on the next lived day. The one exception
 *    is `CycleKilled`, which is a process kill wearing an exception's clothes
 *    and must not be papered over.
 * 5. **An observer runs the whole cycle as a read-only report** (§5 G10, scar
 *    E7). Every phase computes; `ctx.apply` is false, so not one `WRITE_METHOD`
 *    is called — the report is produced without a single stand-down, because
 *    nothing was ever attempted. The spawner's own answer is separate and
 *    blunter: `shouldSpawn()` says no.
 *
 * ZERO GENERATIVE MODEL CALLS. There is no client, no fetch, no network import
 * anywhere in this module, and a test scans the source to say so.
 */

import type { Kind } from "../types.js";
import { todayIn } from "../time.js";
import { TUNABLES as PHYSICS, symmetryCheck } from "../physics/index.js";
import { runBriefing } from "./briefing.js";
import type { RenderFn } from "./briefing.js";
import { runConsolidate } from "./consolidate.js";
import { runDecay } from "./decay.js";
import { runDedup } from "./dedup.js";
import { runFade } from "./fade.js";
import type { FadeFn } from "./fade.js";
import type { DedupCandidateSource } from "./dedup.js";
import { runLogSweep } from "./log.js";
import { advanceMarker, budgetFor, cadenceFor, markerDue, readMarker } from "./markers.js";
import { runPrune } from "./prune.js";
import { sqliteStrengthCache, storeRankingCache, supportsRanking } from "./strength-cache.js";
import type { StrengthCache } from "./strength-cache.js";
import { shouldSpawn } from "./tunables.js";
import { isJournal } from "./types.js";
import type {
  BandTransition,
  CycleReport,
  CycleStep,
  KindCensus,
  MergeRecord,
  Phase,
  PhaseCtx,
  PhaseOutcome,
  PhaseReason,
  PhaseReport,
  PromotionRecord,
  PrunedRecord,
  SleepEvent,
  SleepStore,
  StepStage,
  SymmetryCheck,
} from "./types.js";
import { BAND_TRANSITION_EVENT, CycleKilled, PHASES, attachCyclePartial, emptyOutcome } from "./types.js";

export interface SleepOptions {
  store: SleepStore;
  /** The calendar date this cycle belongs to. Defaults to today, UTC-dated. */
  date?: string;
  /** `self/`'s briefing render. Absent ⇒ the phase reports `no-render-fn`. */
  render?: RenderFn;
  /**
   * The host's reported injection ceiling, passed to the renderer untouched
   * (SEAMS item G). It joins the cycle options rather than being closed over at
   * the call site so that a wrong number is a visible ARGUMENT, not a constant
   * hidden in a lambda between a host's real cliff and the render (scar §2.18).
   */
  budgetBytes?: number;
  /**
   * `schemas/`' fade sweep, injected like `render` (this module does not import
   * `schemas/`). Absent ⇒ the fade phase reports `no-fade-fn`, and entity cards
   * stay where they are: the floor prune does not take them either.
   */
  fade?: FadeFn;
  /** Injected ranking cache. Absent ⇒ the box-3 SQLite one, opened lazily. */
  strengthCache?: StrengthCache;
  /** Extra dedup candidates (embeddings). Isolated: a throw degrades to lexical. */
  candidates?: DedupCandidateSource;
  budgets?: Partial<Record<Phase, number>>;
  cadence?: Partial<Record<Phase, number>>;
  onEvent?: (event: SleepEvent) => void;
  /**
   * Per-step telemetry, and the crash seam. Throwing `CycleKilled` from here
   * simulates the watchdog's hard kill at a chosen point in a chosen phase.
   */
  onStep?: (step: CycleStep) => void;
}

const EVENT_RING = 500;

/**
 * Today's calendar date in the machine's zone — the fallback when a caller
 * hands the cycle no date. UTC until 2026-09-25, local since (docs/time.md): the
 * hooks' `at` moved the same day, and the two must stay one calendar. The
 * lived-day mapping is the store's, not this module's.
 */
export function todayDate(): string {
  return todayIn();
}

export function runCycle(opts: SleepOptions): CycleReport {
  const { store } = opts;
  const observer = store.observer;
  const apply = !observer;
  const date = opts.date ?? todayDate();

  const events: SleepEvent[] = [];
  const emit = (
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void => {
    const event: SleepEvent = {
      at: Date.now(),
      name,
      ...(ref !== undefined ? { ref } : {}),
      ...(data !== undefined ? { data } : {}),
    };
    events.push(event);
    if (events.length > EVENT_RING) events.shift();
    opts.onEvent?.(event);
  };

  const step = (phase: Phase, stage: StepStage, detail?: { index?: number; id?: string }): void => {
    opts.onStep?.({ phase, stage, ...detail });
  };

  const reports: PhaseReport[] = [];
  const order: Phase[] = [];
  const promoted: PromotionRecord[] = [];
  const pruned: PrunedRecord[] = [];
  const merged: MergeRecord[] = [];
  const faded: string[] = [];
  const bandTransitions: BandTransition[] = [];

  // The ranking cache is opened LAZILY by the decay phase, and never at all
  // under observer: a created file is a mutation.
  const injectedCache = opts.strengthCache;
  // SEAMS item J: box 3's own `ranking` table, through the store's connection, is
  // the default wherever the port implements it; the side file remains only for a
  // store-shaped port that does not.
  const cache: StrengthCache | null = observer
    ? null
    : (injectedCache ?? (supportsRanking(store) ? storeRankingCache(store) : sqliteStrengthCache(store.dir)));

  emit("sleep.cycle.start", undefined, { date, observer, spawn: shouldSpawn(store).reason });

  try {
    // ── phase 1: the clock ────────────────────────────────────────────────
    const day = runClock();

    const ctxFor = (phase: Phase, budget: number): PhaseCtx => ({
      store,
      day,
      apply,
      budget,
      step: (stage, detail) => step(phase, stage, detail),
      event: emit,
    });

    /**
     * One phase, with its marker gate, its budget, its degrade-don't-abort
     * wrapper, and its three-way outcome vocabulary.
     */
    const runPhase = <T extends PhaseOutcome>(
      phase: Phase,
      body: (ctx: PhaseCtx) => T,
      collect?: (result: T) => void,
      precheck?: () => PhaseReason | null,
    ): void => {
      const before = readMarker(store, phase);
      if (before.health === "torn") {
        // A torn marker is LOUD (§3, v1 §11 G9) and repairs forward only.
        emit("sleep.marker.torn", undefined, { phase, raw: before.raw ?? "" });
      }
      const budget = budgetFor(phase, opts.budgets);
      const skeleton = { phase, budget, markerBefore: before.day, markerAfter: before.day };
      const idle = (reason: PhaseReason): PhaseReport => ({
        ...skeleton,
        status: "did-not-run",
        reason,
        examined: 0,
        changed: 0,
        skipped: {},
        budgetExhausted: false,
        skippedForBudget: 0,
      });

      order.push(phase);
      step(phase, "start");

      const blocked = precheck?.() ?? null;
      if (blocked !== null) {
        reports.push(idle(blocked));
        return;
      }
      if (!observer) {
        const due = markerDue(before.day, day, cadenceFor(phase, opts.cadence));
        if (due !== "due") {
          reports.push(idle(due));
          return;
        }
      }

      let result: T;
      try {
        result = body(ctxFor(phase, budget));
      } catch (err) {
        if (err instanceof CycleKilled) throw err;
        // Degrade, don't abort. The marker stays put, so the next lived day
        // retries this phase rather than skipping it forever.
        const code = errorCode(err);
        emit("sleep.phase.failed", undefined, { phase, error: code });
        reports.push({
          ...skeleton,
          status: "failed",
          reason: "failed",
          examined: 0,
          changed: 0,
          skipped: {},
          budgetExhausted: false,
          skippedForBudget: 0,
          error: code,
        });
        return;
      }
      collect?.(result);

      const shape = {
        examined: result.examined,
        changed: result.changed,
        skipped: result.skipped,
        budgetExhausted: result.budgetExhausted,
        skippedForBudget: result.skippedForBudget,
        // Present only where the phase set it (the decay pass, U8). Copied like
        // every other number here — this function invents no verdict.
        ...(result.reconciled === undefined ? {} : { reconciled: result.reconciled }),
      };

      if (observer) {
        // Nothing ran and nothing advanced; `changed` is the count that WOULD
        // have changed, and `status` keeps that from being misread as work.
        reports.push({ ...skeleton, status: "did-not-run", reason: "observer-report", ...shape });
        emit("sleep.observer.report", undefined, { phase, would: result.changed });
        return;
      }

      step(phase, "work-done");
      // The marker advances AFTER the work and its persist, both of which are
      // complete by the time `body` returns — every phase persists as it goes.
      // A budget-truncated phase still advances: a budget is not a debt.
      const after = advanceMarker(store, phase, day);
      step(phase, "marked");
      reports.push({
        ...skeleton,
        markerAfter: after,
        status: result.changed > 0 ? "ran" : "ran-nothing-found",
        reason: result.changed > 0 ? "completed" : "nothing-to-do",
        ...shape,
      });
    };

    // ── phase 2: the decay tick ───────────────────────────────────────────
    runPhase(
      "decay",
      (ctx) => runDecay(ctx, cache),
      (r) => {
        bandTransitions.push(...r.transitions);
      },
    );

    // ── phase 3: consolidation marking + the identity crossing ────────────
    runPhase(
      "consolidate",
      (ctx) => runConsolidate(ctx),
      (r) => {
        promoted.push(...r.promoted);
      },
    );

    // ── phase 4: the floor prune (archival) ───────────────────────────────
    runPhase(
      "prune",
      (ctx) => runPrune(ctx),
      (r) => {
        pruned.push(...r.pruned);
      },
    );

    // ── phase 4b: the entity fade (archival, `schemas/`' gentle verdict) ──
    runPhase(
      "fade",
      (ctx) => runFade(ctx, opts.fade, date),
      (r) => {
        faded.push(...r.faded);
      },
      () => (opts.fade === undefined ? "no-fade-fn" : null),
    );

    // ── phase 5: dedup ────────────────────────────────────────────────────
    runPhase(
      "dedup",
      (ctx) => runDedup(ctx, opts.candidates),
      (r) => {
        merged.push(...r.merged);
      },
    );

    // ── phase 6: version retention past H ─────────────────────────────────
    runPhase("versions", (ctx) => {
      const out = emptyOutcome();
      if (!ctx.apply) {
        out.skipped["observer-report"] = 1;
        return out;
      }
      const report = store.pruneSupersededVersions();
      out.examined = report.pruned;
      out.changed = report.pruned;
      emit("sleep.versions.pruned", undefined, {
        count: report.pruned,
        cutoffDay: report.cutoffDay,
        retentionDays: report.retentionDays,
      });
      return out;
    });

    // ── phase 7: the wake briefing — the LAST content write ───────────────
    runPhase(
      "briefing",
      (ctx) => runBriefing(ctx, opts.render, opts.budgetBytes),
      undefined,
      () => (opts.render === undefined ? "no-render-fn" : null),
    );

    // ── phase 8: the log sweep — bounded retention on the durable log ─────
    // LAST, and deliberately after the briefing: it deletes telemetry rows
    // past the store's window and writes no content, so §3's "the briefing is
    // the last content write" holds with it here. `BUDGETS.log` is the per-pass
    // cap — a backlog is taken a cap's worth a day, never all at once. A port
    // with no durable log has nothing to sweep and says so by name.
    runPhase(
      "log",
      (ctx) => runLogSweep(ctx),
      undefined,
      () =>
        store.pruneEvents === undefined || store.eventLogCensus === undefined
          ? "no-durable-event-log"
          : null,
    );

    // ── the tripwire, at cycle end (physics guarantee 12, scar §2.10) ─────
    const symmetry = symmetryVerdicts(store, day, emit);

    const report: CycleReport = {
      day,
      date,
      observer,
      order,
      phases: reports,
      promoted,
      pruned,
      merged,
      faded,
      bandTransitions,
      symmetry,
      census: census(store, day, pruned, merged, faded),
      events,
    };
    emit("sleep.cycle.done", undefined, {
      day,
      phases: reports.length,
      promoted: promoted.length,
      pruned: pruned.length,
      merged: merged.length,
      faded: faded.length,
      bandUp: bandTransitions.filter((t) => t.direction === "up").length,
      bandDown: bandTransitions.filter((t) => t.direction === "down").length,
      failed: reports.filter((p) => p.status === "failed").length,
    });
    return report;
  } catch (err) {
    // A CYCLE THAT DIES CARRIES ITS WORK OUT WITH IT (see `CyclePartial`).
    // Degrade-don't-abort already covers a phase body that throws; what escapes
    // here threw from OUTSIDE one — a marker advance, the clock, `onStep`'s hard
    // kill — and the caller is left with an exception and no report. Without
    // this, a recorder reading that exception writes a row of zeroes over a
    // night in which seven phases ran, which is a fabricated zero (scar §2.4)
    // arriving through a throw. Attaching cannot itself throw.
    attachCyclePartial(err, {
      phases: [...reports],
      order: [...order],
      ...(err instanceof CycleKilled ? { phase: err.phase, stage: err.stage } : {}),
    });
    throw err;
  } finally {
    // Only a cache this cycle created is this cycle's to close.
    if (injectedCache === undefined) cache?.close();
  }

  // ── the clock phase, inline: it produces the day everything else gates on ──
  function runClock(): number {
    const phase: Phase = "clock";
    const before = readMarker(store, phase);
    const budget = budgetFor(phase, opts.budgets);
    const skeleton = { phase, budget, markerBefore: before.day, markerAfter: before.day };
    order.push(phase);
    step(phase, "start");

    if (observer) {
      reports.push({
        ...skeleton,
        status: "did-not-run",
        reason: "observer-report",
        examined: 0,
        changed: 0,
        skipped: { "observer-report": 1 },
        budgetExhausted: false,
        skippedForBudget: 0,
      });
      return store.livedDay();
    }

    const wasDay = store.livedDay();
    let day: number;
    try {
      day = store.advanceClock(date);
    } catch (err) {
      if (err instanceof CycleKilled) throw err;
      // A torn clock is LOUD and repair moves FORWARD ONLY: a backwards date is
      // refused by the store, and the cycle continues on the day the store
      // already believes in rather than retro-running history.
      const code = errorCode(err);
      emit("sleep.clock.failed", undefined, { date, error: code });
      reports.push({
        ...skeleton,
        status: "failed",
        reason: "failed",
        examined: 0,
        changed: 0,
        skipped: {},
        budgetExhausted: false,
        skippedForBudget: 0,
        error: code,
      });
      return wasDay;
    }
    step(phase, "work-done");
    const after = advanceMarker(store, phase, day);
    step(phase, "marked");
    const advanced = day > wasDay;
    reports.push({
      ...skeleton,
      markerAfter: after,
      status: advanced ? "ran" : "ran-nothing-found",
      reason: advanced ? "completed" : "nothing-to-do",
      examined: 1,
      changed: advanced ? 1 : 0,
      skipped: advanced ? {} : { "same-lived-day": 1 },
      budgetExhausted: false,
      skippedForBudget: 0,
    });
    return day;
  }
}

/**
 * No ceiling worth naming: the WHOLE transition history is the sample. v1's
 * ratchet ran 279:0 across three days and `SYMMETRY_MIN_SAMPLE` is 20 moves, so
 * a one-cycle window would answer `never-asked` forever — which is the shape of
 * failure this tripwire was written to end, not one to reproduce.
 */
const TRANSITION_LOG_LIMIT = 1_000_000;

type Emit = (
  name: string,
  ref?: string,
  data?: Record<string, string | number | boolean | null>,
) => void;

/**
 * GUARANTEE 12, FED AND CONSUMED — the ratchet tripwire, at cycle end.
 *
 * Up-moves and down-moves per kind, summed over the durable `band.transition`
 * log, handed to `physics.symmetryCheck`, and emitted as a verdict per kind.
 * Physics owns the arithmetic and the expected ratio; this function owns
 * nothing but the summation and the announcement.
 *
 * TWO THINGS THAT MUST NOT BE SMOOTHED OVER, both scar §2.4:
 *
 *   - Below the minimum sample the verdict is `never-asked`, and it carries
 *     `ok: true`. Anything reading `ok` alone reads a starved counter as
 *     health. Every event below leads with `reason`.
 *   - A store with no event log has not asked the question at all, and gets NO
 *     verdicts plus a loud `sleep.symmetry.unavailable` — six `never-asked`
 *     rows would claim a counter was consulted when none exists.
 *
 * `ratio` is `Infinity` by design when nothing ever moved down (v1's exact
 * shape) and `JSON.stringify` turns that into `null`, so it is reported only
 * when finite: a null that means infinity is a lie in the log.
 */
export function symmetryVerdicts(store: SleepStore, day: number, emit: Emit): SymmetryCheck[] {
  const kinds = Object.keys(PHYSICS.KINDS) as Kind[];
  if (store.eventLog === undefined) {
    emit("sleep.symmetry.unavailable", undefined, { day, reason: "no-durable-event-log" });
    return [];
  }

  const up = new Map<string, number>();
  const down = new Map<string, number>();
  /** Up-moves no input explains (2026-10-10; a row from before carries no cause and is not one). */
  const unexplained = new Map<string, number>();
  let unreadable = 0;
  for (const row of store.eventLog({
    name: BAND_TRANSITION_EVENT,
    limit: TRANSITION_LOG_LIMIT,
  })) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload ?? "") as Record<string, unknown>;
    } catch {
      unreadable += 1;
      continue;
    }
    const kind = typeof payload["kind"] === "string" ? payload["kind"] : null;
    const direction = payload["direction"];
    if (kind === null) {
      unreadable += 1;
      continue;
    }
    // A move a new curve made on the pass it arrived (`recurve`, review of
    // #372) is the build's, neither a climb nor a fall: not counted.
    if (payload["cause"] === "recurve") continue;
    if (direction === "up") {
      up.set(kind, (up.get(kind) ?? 0) + 1);
      if (payload["cause"] === "unexplained") unexplained.set(kind, (unexplained.get(kind) ?? 0) + 1);
    }
    else if (direction === "down") down.set(kind, (down.get(kind) ?? 0) + 1);
    else unreadable += 1;
  }
  if (unreadable > 0) {
    // A row the counter could not read is a row the counter did not count.
    emit("sleep.symmetry.unreadable", undefined, { day, rows: unreadable });
  }

  const out: SymmetryCheck[] = [];
  for (const kind of kinds) {
    const verdict = symmetryCheck(kind, {
      up: up.get(kind) ?? 0,
      down: down.get(kind) ?? 0,
      unexplained: unexplained.get(kind) ?? 0,
    });
    out.push(verdict);
    emit("sleep.symmetry", undefined, {
      day,
      kind: verdict.kind,
      reason: verdict.reason,
      ok: verdict.ok,
      up: verdict.up,
      down: verdict.down,
      ratio: Number.isFinite(verdict.ratio) ? verdict.ratio : null,
      expectedMax: verdict.expectedMax,
      unexplained: verdict.unexplained,
    });
    if (!verdict.ok) {
      // Only an UP-ratchet trips it (2026-10-10): fading down a band is the
      // curve working, never an alarm.
      emit("sleep.symmetry.tripped", undefined, {
        day,
        kind: verdict.kind,
        reason: verdict.reason,
        says:
          verdict.unexplained > 0
            ? `up-ratchet suspected: ${String(verdict.unexplained)} band climb(s) with no use, return, feeling or promotion behind them`
            : "up-ratchet suspected: up-moves far outnumber down-moves",
        up: verdict.up,
        down: verdict.down,
        unexplained: verdict.unexplained,
        expectedMax: verdict.expectedMax,
      });
    }
  }
  return out;
}

/**
 * §5 G13 / scar §2.17 — created versus exited, per kind, every cycle. A kind
 * with a zero exit count after the bake-in window is a defect to investigate:
 * a curation path that never fires is indistinguishable from one that is broken.
 *
 * NOT SPLIT like the `status` census (2026-09-30, U13; `core/leaving.ts`). The
 * exits here are this cycle's own curation ACTIONS — prune, merge, fade — and
 * the question is whether each path fires, so a merge counts even though a live
 * row carries what it merged. A journal copy archived `episode-regrown` never
 * lands here: that happens at ingestion, not in the cycle. What does reach this
 * count is the regrown copy's BIRTH (a new row, born today), so a self kind
 * whose chapters grew reads a little high on `created`.
 */
export function census(
  store: SleepStore,
  day: number,
  pruned: readonly PrunedRecord[],
  merged: readonly MergeRecord[],
  faded: readonly string[] = [],
): Record<Kind, KindCensus> {
  const kinds = Object.keys(PHYSICS.KINDS) as Kind[];
  const created = new Map<Kind, number>();
  const exited = new Map<Kind, number>();
  // ONE GROUPED READ where the port has it (2026-10-10, review 13 C2): this
  // runs at every boundary, outside the phases' once-a-lived-day markers, and
  // walked every row — archived ones too — with a two-subquery read each.
  // The grouped count is the same number, indexed by birth day.
  const born = store.bornOn?.(day);
  if (born !== undefined) {
    for (const b of born) created.set(b.kind, (created.get(b.kind) ?? 0) + b.n);
  } else {
    // ONLY TODAY'S BIRTHS ARE READ (2026-10-10, Lane 0 / scale review C3): the
    // census asked every row in the store — archived ones included — for its
    // birth day, at every boundary. The filter is SQL now. Archived rows born
    // today still count: a memory written and merged the same day is one created
    // and one exited, and dropping its birth would unbalance G13.
    // Decided by lane0-builder, 2026-10-10, lightly held; revisit after ~5 lived days. Why: "archived out of the census" taken as "only today's births read"; excluding archived births outright would change what the census counts.
    for (const id of store.list({ bornFromDay: day })) {
      const row = store.row(id);
      if (row === undefined || row.birth_day !== day) continue;
      // MEMORIES. A chapter written today is not a memory born today, and
      // counting it as one would give every journal kind a permanent
      // created-without-exit imbalance — the exact signal G13 exists to raise
      // (`sleep/types.ts#isJournal`).
      if (isJournal(row)) continue;
      created.set(row.kind, (created.get(row.kind) ?? 0) + 1);
    }
  }
  for (const p of pruned) exited.set(p.record.kind, (exited.get(p.record.kind) ?? 0) + 1);
  for (const m of merged) {
    const row = store.row(m.candidateId);
    if (row === undefined) continue;
    exited.set(row.kind, (exited.get(row.kind) ?? 0) + 1);
  }
  // A faded card is an exit for its kind — the prune no longer takes cards, so
  // without this `person`, `place` and `entity` would read as never exiting.
  for (const id of faded) {
    const row = store.row(id);
    if (row === undefined) continue;
    exited.set(row.kind, (exited.get(row.kind) ?? 0) + 1);
  }
  const out = {} as Record<Kind, KindCensus>;
  for (const kind of kinds) {
    out[kind] = { created: created.get(kind) ?? 0, exited: exited.get(kind) ?? 0 };
  }
  return out;
}

function errorCode(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return err instanceof Error ? err.name : "UNKNOWN";
}

export { PHASES };
export type { Phase, PhaseReport, CycleReport };
