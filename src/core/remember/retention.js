import { closeSync, mkdirSync, openSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { planRetention } from "./owes.js";
import { strikeSpans } from "./owner-strike-seam.js";
export const RETENTION_LATCH_DIR = "retention";
const LATCHES_KEPT = 31;
const EMPTY_REPORT = {
  scopes: 0,
  deleted: 0,
  keptOwed: 0,
  keptYoung: 0,
  keptLive: 0,
  failed: 0,
  lines: 0,
  bytes: 0
};
function takeLatch(buffer, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return "failed";
  const dir = join(buffer.root, RETENTION_LATCH_DIR);
  try {
    mkdirSync(dir, { recursive: true });
    closeSync(openSync(join(dir, `${date}.latch`), "wx"));
  } catch (err) {
    return err.code === "EEXIST" ? "held" : "failed";
  }
  try {
    const latches = readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.latch$/.test(n)).sort();
    for (const old of latches.slice(0, Math.max(0, latches.length - LATCHES_KEPT))) {
      rmSync(join(dir, old), { force: true });
    }
  } catch {}
  return "taken";
}
export function pruneRetention(buffer, sources, opts) {
  if (buffer.observer) {
    buffer.emit("remember.observer.standdown", undefined, { site: "strike" });
    return { ...EMPTY_REPORT, reason: "OBSERVER" };
  }
  const latch = takeLatch(buffer, opts.date);
  if (latch === "held")
    return { ...EMPTY_REPORT, reason: "ALREADY_RAN" };
  if (latch === "failed")
    return { ...EMPTY_REPORT, reason: "IO_FAILED" };
  opts.onLatched?.();
  const plan = planRetention(buffer, sources);
  const doomed = new Map;
  for (const h of plan) {
    if (h.verdict !== "deleted")
      continue;
    for (const scope of h.scopes) {
      const list = doomed.get(scope) ?? [];
      list.push(h.session);
      doomed.set(scope, list);
    }
  }
  const failedSessions = new Set;
  let lines = 0;
  let observed = false;
  let ioFailed = false;
  for (const [scope, sessions] of doomed) {
    const struck = strikeSpans(buffer, { scope, sessions, by: "retention" });
    if (struck.reason === "OBSERVER" || struck.reason === "IO_FAILED") {
      for (const s of sessions)
        failedSessions.add(s);
      if (struck.reason === "OBSERVER")
        observed = true;
      else
        ioFailed = true;
      continue;
    }
    lines += struck.struck;
  }
  const deletedPlan = plan.filter((h) => h.verdict === "deleted" && !failedSessions.has(h.session));
  const report = {
    reason: observed ? "OBSERVER" : ioFailed ? "IO_FAILED" : deletedPlan.length > 0 ? "PRUNED" : "NOTHING",
    scopes: new Set(plan.flatMap((h) => h.scopes)).size,
    deleted: deletedPlan.length,
    keptOwed: plan.filter((h) => h.verdict === "kept-owed").length,
    keptYoung: plan.filter((h) => h.verdict === "kept-young").length,
    keptLive: plan.filter((h) => h.verdict === "kept-live").length,
    failed: failedSessions.size,
    lines,
    bytes: deletedPlan.reduce((n, h) => n + h.bytes, 0)
  };
  buffer.emit("remember.retention", undefined, {
    reason: report.reason,
    scopes: report.scopes,
    deleted: report.deleted,
    keptOwed: report.keptOwed,
    keptYoung: report.keptYoung,
    keptLive: report.keptLive,
    failed: report.failed,
    lines: report.lines
  });
  return report;
}
