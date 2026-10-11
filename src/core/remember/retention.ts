/**
 * RAW TRANSCRIPT RETENTION — THE DELETING HALF. Owner's ruling 2026-09-23.
 *
 * `owes.ts` decides what a session owes and plans; this file is the one place
 * that acts on the plan, and it acts through the owner's strike
 * (`owner-strike-seam.ts`) naming whole sessions, recorded `by: "retention"` —
 * so `remember/` still has exactly one path that destroys a span.
 *
 * **Who may call it** (PR #189 review, B1). `remember/index.ts` does NOT
 * re-export this file, and `test/cli.test.ts` pins its importers to the
 * background worker (`adapters/claude-code/bin/runner.ts`). `pruneRetention`
 * takes a buffer and a set of facts; a caller that could reach it with the
 * public `Counterpart.spans` and facts of its own making could delete a
 * session that owes. Nothing that holds a `Counterpart` — the MCP server, the
 * hooks, a model through either — can import it.
 *
 * **Once per date, atomically** (review m6). Before it plans, let alone
 * deletes, a run creates `spans/retention/<date>.latch` with `O_EXCL`. Two
 * workers that both pass the caller's "has today's row been written" check
 * cannot both get past this: the second is told `ALREADY_RAN` and touches
 * nothing. A run that crashes after taking the latch spends that date; the next
 * date runs again, and nothing it did not finish is lost — the sessions it did
 * not reach are still due.
 */
import { closeSync, mkdirSync, openSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { planRetention } from "./owes.js";
import type { RetentionReport, RetentionSources } from "./owes.js";
import { strikeSpans } from "./owner-strike-seam.js";
import type { SpanBuffer } from "./spans.js";

/** Where the per-date latches live, under `spans/`. */
export const RETENTION_LATCH_DIR = "retention";
/** How many dated latches are kept — a month, so the directory stays bounded. */
const LATCHES_KEPT = 31;

const EMPTY_REPORT: Omit<RetentionReport, "reason"> = {
  scopes: 0,
  deleted: 0,
  keptOwed: 0,
  keptYoung: 0,
  keptLive: 0,
  failed: 0,
  lines: 0,
  bytes: 0,
};

/**
 * TAKE THIS DATE'S LATCH, or learn that another run already has. `O_EXCL` is
 * the whole mechanism: the create either makes the file or fails with EEXIST,
 * atomically, whoever else is racing for it.
 */
function takeLatch(buffer: SpanBuffer, date: string): "taken" | "held" | "failed" {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "failed";
  const dir = join(buffer.root, RETENTION_LATCH_DIR);
  try {
    mkdirSync(dir, { recursive: true });
    closeSync(openSync(join(dir, `${date}.latch`), "wx"));
  } catch (err) {
    return (err as { code?: unknown }).code === "EEXIST" ? "held" : "failed";
  }
  // Bounded: the newest month of latches stays, older ones go. Names are dates,
  // so they sort. A latch that will not delete costs a file, never the run.
  try {
    const latches = readdirSync(dir)
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.latch$/.test(n))
      .sort();
    for (const old of latches.slice(0, Math.max(0, latches.length - LATCHES_KEPT))) {
      rmSync(join(dir, old), { force: true });
    }
  } catch {
    /* housekeeping only */
  }
  return "taken";
}

/**
 * PLAN, THEN DELETE exactly the sessions the plan calls `deleted` — and only
 * those: the strike is handed session ids from the plan, never a pattern. A
 * session the predicate says owes, or the host holds open, is not in any
 * request, whatever its age.
 */
export function pruneRetention(
  buffer: SpanBuffer,
  sources: RetentionSources,
  opts: {
    date: string;
    /** Called the moment the date's latch is held, BEFORE anything is planned
     *  or deleted — where the worker writes its `STARTED` row, so a run that
     *  dies after this point still leaves the date visible (re-review R7). */
    onLatched?: () => void;
  },
): RetentionReport {
  // An instrument writes nothing — not even the latch.
  if (buffer.observer) {
    buffer.emit("remember.observer.standdown", undefined, { site: "strike" });
    return { ...EMPTY_REPORT, reason: "OBSERVER" };
  }
  const latch = takeLatch(buffer, opts.date);
  if (latch === "held") return { ...EMPTY_REPORT, reason: "ALREADY_RAN" };
  if (latch === "failed") return { ...EMPTY_REPORT, reason: "IO_FAILED" };
  opts.onLatched?.();

  const plan = planRetention(buffer, sources);
  // Per scope: the strike runs one scope at a time, and a session deleted is
  // struck from every scope that holds its text.
  const doomed = new Map<string, string[]>();
  for (const h of plan) {
    if (h.verdict !== "deleted") continue;
    for (const scope of h.scopes) {
      const list = doomed.get(scope) ?? [];
      list.push(h.session);
      doomed.set(scope, list);
    }
  }
  const failedSessions = new Set<string>();
  let lines = 0;
  let observed = false;
  let ioFailed = false;
  for (const [scope, sessions] of doomed) {
    const struck = strikeSpans(buffer, { scope, sessions, by: "retention" });
    if (struck.reason === "OBSERVER" || struck.reason === "IO_FAILED") {
      for (const s of sessions) failedSessions.add(s);
      if (struck.reason === "OBSERVER") observed = true;
      else ioFailed = true;
      continue;
    }
    lines += struck.struck;
  }
  const deletedPlan = plan.filter((h) => h.verdict === "deleted" && !failedSessions.has(h.session));
  const report: RetentionReport = {
    reason: observed ? "OBSERVER" : ioFailed ? "IO_FAILED" : deletedPlan.length > 0 ? "PRUNED" : "NOTHING",
    scopes: new Set(plan.flatMap((h) => h.scopes)).size,
    deleted: deletedPlan.length,
    keptOwed: plan.filter((h) => h.verdict === "kept-owed").length,
    keptYoung: plan.filter((h) => h.verdict === "kept-young").length,
    keptLive: plan.filter((h) => h.verdict === "kept-live").length,
    failed: failedSessions.size,
    lines,
    bytes: deletedPlan.reduce((n, h) => n + h.bytes, 0),
  };
  buffer.emit("remember.retention", undefined, {
    reason: report.reason,
    scopes: report.scopes,
    deleted: report.deleted,
    keptOwed: report.keptOwed,
    keptYoung: report.keptYoung,
    keptLive: report.keptLive,
    failed: report.failed,
    lines: report.lines,
  });
  return report;
}
