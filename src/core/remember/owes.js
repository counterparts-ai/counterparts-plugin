import { Buffer } from "node:buffer";
import { ledger } from "../coverage/index.js";
import { resolveZone } from "../time.js";
import { TUNABLES } from "./tunables.js";
export const RETENTION_EVENT = "remember.prune";
export const NO_HOST_EVIDENCE = {
  open: false,
  endedAt: null
};
const clockOr = (ms, fallback) => typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : fallback;
export function retentionSources(store, opts = {}) {
  let zone;
  try {
    zone = store.zone?.() ?? resolveZone();
  } catch {
    zone = resolveZone();
  }
  return {
    host: (session) => {
      try {
        return opts.host?.(session) ?? NO_HOST_EVIDENCE;
      } catch {
        return { ...NO_HOST_EVIDENCE, open: true };
      }
    },
    zone,
    retentionMs: clockOr(opts.retentionMs, TUNABLES.RETENTION_MS),
    maxMs: clockOr(opts.maxMs, TUNABLES.RETENTION_MAX_MS)
  };
}
const numberOr = (v, fallback) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
export function planRetention(buffer, sources) {
  const now = buffer.now();
  const tallies = new Map;
  const tally = (session) => {
    if (typeof session !== "string" || session.length === 0)
      return null;
    let t = tallies.get(session);
    if (t === undefined) {
      t = {
        scopes: new Set,
        lines: 0,
        bytes: 0,
        captured: 0,
        lastCaptureAt: 0,
        lastActivityAt: 0,
        writtenUpAt: null
      };
      tallies.set(session, t);
    }
    return t;
  };
  for (const scope of buffer.scopes()) {
    const text = (span, captured) => {
      const t = tally(span.session);
      if (t === null)
        return;
      const at = numberOr(span.at, 0);
      t.scopes.add(scope);
      t.lines += 1;
      t.bytes += Buffer.byteLength(span.text, "utf8");
      if (captured)
        t.captured += 1;
      t.lastCaptureAt = Math.max(t.lastCaptureAt, at);
      t.lastActivityAt = Math.max(t.lastActivityAt, at);
    };
    for (const s of buffer.spans(scope))
      text(s, true);
    for (const s of buffer.assistantSpans(scope))
      text(s, false);
    for (const s of buffer.quarantined(scope))
      text(s, s.kind !== "assistant");
    for (const s of buffer.claimedSpans(scope))
      text(s, s.kind !== "assistant");
    for (const b of buffer.boundaries(scope)) {
      const t = tally(b.session);
      if (t === null)
        continue;
      t.lastActivityAt = Math.max(t.lastActivityAt, numberOr(b.at, 0));
    }
    for (const w of buffer.writeUps(scope)) {
      const t = tally(w.session);
      if (t === null)
        continue;
      t.writtenUpAt = Math.max(t.writtenUpAt ?? 0, w.at);
    }
  }
  const hostFacts = new Map;
  const host = (session) => {
    let h = hostFacts.get(session);
    if (h === undefined) {
      h = sources.host(session);
      hostFacts.set(session, h);
    }
    return h;
  };
  const entries = new Map(ledger(buffer, { now, zone: sources.zone, host: (s) => ({ endedAt: host(s).endedAt }) }).map((e) => [e.session, e]));
  const out = [];
  for (const [session, t] of [...tallies.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (t.lines === 0)
      continue;
    const h = host(session);
    const entry = entries.get(session);
    const facts = {
      capturedText: t.captured > 0,
      writtenUp: t.writtenUpAt !== null && t.writtenUpAt >= t.lastCaptureAt,
      state: entry?.state ?? null,
      unwritten: entry?.stretch?.pieces ?? 0,
      minutes: entry?.stretch?.minutes ?? 0,
      lapsed: entry?.lapsed === true
    };
    const owes = entry?.owed === true && !facts.writtenUp;
    const clockFrom = Math.max(t.lastActivityAt, t.writtenUpAt ?? 0, h.endedAt ?? 0);
    const maxMs = clockOr(sources.maxMs, TUNABLES.RETENTION_MAX_MS);
    const retentionMs = clockOr(sources.retentionMs, TUNABLES.RETENTION_MS);
    const verdict = t.lastActivityAt > 0 && now - t.lastActivityAt >= maxMs ? "deleted" : h.open ? "kept-live" : owes ? "kept-owed" : now - clockFrom < retentionMs ? "kept-young" : "deleted";
    out.push({
      session,
      scopes: [...t.scopes].sort(),
      facts,
      owes,
      small: owes && entry?.small === true,
      open: h.open,
      clockFrom,
      lines: t.lines,
      bytes: t.bytes,
      verdict
    });
  }
  return out;
}
export function retentionRow(report, date, clocks = {}) {
  return {
    date,
    reason: report.reason,
    scopes: report.scopes,
    deleted: report.deleted,
    keptOwed: report.keptOwed,
    keptYoung: report.keptYoung,
    keptLive: report.keptLive,
    failed: report.failed,
    lines: report.lines,
    bytes: report.bytes,
    retentionDays: Math.round(clockOr(clocks.retentionMs, TUNABLES.RETENTION_MS) / 86400000),
    maxDays: Math.round(clockOr(clocks.maxMs, TUNABLES.RETENTION_MAX_MS) / 86400000)
  };
}
const RETENTION_LOOKBACK_DAYS = 90;
const RETENTION_ROW_CEILING = 5000;
export function retentionRuns(store) {
  let rows;
  try {
    rows = store.eventLog({
      name: RETENTION_EVENT,
      sinceDay: Math.max(0, store.livedDay() - RETENTION_LOOKBACK_DAYS),
      order: "desc",
      limit: RETENTION_ROW_CEILING
    });
  } catch {
    return [];
  }
  const out = [];
  for (const row of rows) {
    let p;
    try {
      p = JSON.parse(row.payload ?? "{}");
    } catch {
      continue;
    }
    out.push({
      date: typeof p["date"] === "string" ? p["date"] : "",
      reason: typeof p["reason"] === "string" ? p["reason"] : "",
      scopes: numberOr(p["scopes"], 0),
      deleted: numberOr(p["deleted"], 0),
      keptOwed: numberOr(p["keptOwed"], 0),
      keptYoung: numberOr(p["keptYoung"], 0),
      keptLive: numberOr(p["keptLive"], 0),
      failed: numberOr(p["failed"], 0),
      lines: numberOr(p["lines"], 0),
      bytes: numberOr(p["bytes"], 0),
      at: row.at,
      day: row.day,
      seq: row.seq
    });
  }
  return out.sort((a, b) => b.at !== a.at ? b.at - a.at : b.seq - a.seq).map(({ seq: _seq, ...run }) => run);
}
export function lastRetentionRun(store) {
  return retentionRuns(store)[0] ?? null;
}
