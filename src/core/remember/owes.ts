/**
 * WHAT A SESSION OWES — the read-only half of raw-transcript retention.
 *
 * Owner's ruling 2026-09-23 (roadmap B3): **a session's captured text is
 * deleted 7 days after it ended, when nothing is owed; a session that owes a
 * write-up waits until it is written up.** This file decides; it never deletes.
 * The deleting half is `retention.ts`, which only the background worker may
 * import and which `index.ts` does NOT re-export (PR #189 review, B1): holding
 * a `Counterpart` — and so its public `SpanBuffer` — reaches the plan and never
 * the strike.
 *
 * ── WHAT "OWES" MEANS, DEFINED ONCE — AND NOT HERE ────────────────────────
 *
 * Since 2026-09-30 it is `core/coverage/`'s rule, read off its ledger: a
 * session owes a write-up when it holds an unwritten stretch of three pieces
 * over fifteen minutes or more, it is not active (it ended, or it has captured
 * nothing since the calendar date changed), and the stretch has not lapsed.
 * Retention reads it here, the next-session write-up reads it through
 * `planRetention` (`adapters/sessions.ts`), and doctor reads the counts — so
 * "what may be deleted" and "what the next session is asked to write" are
 * still one set. It replaced the asked / answered predicate of B3 and #285's
 * separate short debt: an ask, a chapter, a handoff or a "nothing new" are no
 * longer facts this file weighs — what they claimed in `coverage.jsonl` is.
 *
 * ── AND ONE THING THAT IS NOT A DEBT BUT STILL KEEPS ──────────────────────
 *
 * A session the host's registry still holds OPEN — a record with no end — is
 * not deleted while the registry holds it (review m10): an idle-but-alive
 * session is not an ended one. That lasts only as long as the record does, and
 * the registry forgets a record 7 days after its last write
 * (`adapters/sessions.ts#pruneSessions`) — the same week as the retention clock
 * (re-review R8). What actually protects a session active in the last week is
 * the capture clock, which reads the buffer and nothing the registry keeps.
 *
 * ── THE CLOCK ─────────────────────────────────────────────────────────────
 *
 * Seven days (`TUNABLES.RETENTION_MS`) from the LATEST thing known about the
 * session anywhere in the store: its last capture or boundary in any scope, its
 * write-up mark, its registry end. It is the buffer's own clock. A lapsed
 * stretch owes nothing, so its text goes on this same week.
 *
 * Every failure to read a fact moves toward KEEPING: a host that cannot answer
 * is read as holding the session open.
 */
import { Buffer } from "node:buffer";

import { ledger } from "../coverage/index.js";
import type { LedgerEntry, SessionState } from "../coverage/index.js";
import type { Store } from "../store/index.js";
import { resolveZone } from "../time.js";

import type { Span, SpanBuffer } from "./spans.js";
import { TUNABLES } from "./tunables.js";

/** The durable row one retention run leaves. Counts only — never a session id,
 *  never a hash, never a word (§16 G9's rule for a record of destruction). */
export const RETENTION_EVENT = "remember.prune";

// ── the facts ───────────────────────────────────────────────────────────────

/** What a session's standing is read from. Facts, no text. */
export interface WriteUpFacts {
  /** Conversation or jot text is still held for it somewhere in the store
   *  (buffer, jots, quarantine, a claim in flight). */
  readonly capturedText: boolean;
  /** Marked written up (`write-up-seam.ts`) at or after its last capture. */
  readonly writtenUp: boolean;
  /** The ledger's state; null when it holds no piece in the live streams. */
  readonly state: SessionState | null;
  /** Pieces in its unwritten stretch, and the minutes it spans. */
  readonly unwritten: number;
  readonly minutes: number;
  readonly lapsed: boolean;
}

/** What the HOST knows about one session. `NO_HOST_EVIDENCE` is what a host
 *  that knows nothing says. */
export interface HostSessionEvidence {
  /**
   * The host's registry holds a record for this session with no end. Kept while
   * it does — and ONLY while it does: the registry drops a record 7 days after
   * its last write (`adapters/sessions.ts#pruneSessions`), the same week as the
   * retention clock, so this is an extra guard, not the one that protects a
   * recently active session. That one is the capture clock (`kept-young`).
   */
  readonly open: boolean;
  /** The registry's end, epoch ms. */
  readonly endedAt: number | null;
}

export const NO_HOST_EVIDENCE: HostSessionEvidence = {
  open: false,
  endedAt: null,
};

/** Everything retention reads from outside the buffer: the host's evidence,
 *  and the zone the store names its days in. */
export interface RetentionSources {
  host(session: string): HostSessionEvidence;
  readonly zone: string;
}

/**
 * The sources as a host supplies them. Never throws: a host that cannot answer
 * may be holding the session open, so it is read as open.
 */
export function retentionSources(
  store: Partial<Pick<Store, "zone">>,
  opts: { host?: (session: string) => HostSessionEvidence } = {},
): RetentionSources {
  let zone: string;
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
  };
}

// ── the plan ────────────────────────────────────────────────────────────────

export type RetentionVerdict = "deleted" | "kept-owed" | "kept-young" | "kept-live";

/** One session's standing across the whole store. Ids and counts, never text. */
export interface HeldSession {
  readonly session: string;
  /** Every scope that holds text for it — the strike runs once per scope. */
  readonly scopes: readonly string[];
  readonly facts: WriteUpFacts;
  /** It owes a write-up — `coverage/`'s rule, and the only thing that keeps
   *  its text past its week. */
  readonly owes: boolean;
  /** It owes, and what it owes is small: one line is enough. */
  readonly small: boolean;
  /** The host's registry holds it open. */
  readonly open: boolean;
  /** When its retention clock started. */
  readonly clockFrom: number;
  /** Text lines and bytes it holds in the files retention deletes from. */
  readonly lines: number;
  readonly bytes: number;
  readonly verdict: RetentionVerdict;
}

interface Tally {
  scopes: Set<string>;
  lines: number;
  bytes: number;
  captured: number;
  lastCaptureAt: number;
  lastActivityAt: number;
  writtenUpAt: number | null;
}

const numberOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * EVERY SESSION THIS STORE HOLDS TEXT FOR, judged once across every scope,
 * with its facts and its verdict. Read-only: it plans and deletes nothing.
 */
export function planRetention(buffer: SpanBuffer, sources: RetentionSources): HeldSession[] {
  const now = buffer.now();
  const tallies = new Map<string, Tally>();
  const tally = (session: unknown): Tally | null => {
    if (typeof session !== "string" || session.length === 0) return null;
    let t = tallies.get(session);
    if (t === undefined) {
      t = {
        scopes: new Set(),
        lines: 0,
        bytes: 0,
        captured: 0,
        lastCaptureAt: 0,
        lastActivityAt: 0,
        writtenUpAt: null,
      };
      tallies.set(session, t);
    }
    return t;
  };

  for (const scope of buffer.scopes()) {
    const text = (span: Span, captured: boolean): void => {
      const t = tally(span.session);
      if (t === null) return;
      const at = numberOr(span.at, 0);
      t.scopes.add(scope);
      t.lines += 1;
      t.bytes += Buffer.byteLength(span.text, "utf8");
      if (captured) t.captured += 1;
      t.lastCaptureAt = Math.max(t.lastCaptureAt, at);
      t.lastActivityAt = Math.max(t.lastActivityAt, at);
    };
    // Conversation and jots, the assistant's own turns, quarantine, and
    // anything a claim holds right now: all of it is text this session still
    // has on disk. Only the non-assistant kinds are text a write-up could be
    // made FROM.
    for (const s of buffer.spans(scope)) text(s, true);
    for (const s of buffer.assistantSpans(scope)) text(s, false);
    for (const s of buffer.quarantined(scope)) text(s, s.kind !== "assistant");
    for (const s of buffer.claimedSpans(scope)) text(s, s.kind !== "assistant");
    for (const b of buffer.boundaries(scope)) {
      const t = tally(b.session);
      if (t === null) continue;
      t.lastActivityAt = Math.max(t.lastActivityAt, numberOr(b.at, 0));
    }
    for (const w of buffer.writeUps(scope)) {
      const t = tally(w.session);
      if (t === null) continue;
      t.writtenUpAt = Math.max(t.writtenUpAt ?? 0, w.at);
    }
  }

  // The host is asked once per session, whoever asks.
  const hostFacts = new Map<string, HostSessionEvidence>();
  const host = (session: string): HostSessionEvidence => {
    let h = hostFacts.get(session);
    if (h === undefined) {
      h = sources.host(session);
      hostFacts.set(session, h);
    }
    return h;
  };
  // THE ONE RULE, `coverage/`'s — read, never restated.
  const entries = new Map<string, LedgerEntry>(
    ledger(buffer, { now, zone: sources.zone, host: (s) => ({ endedAt: host(s).endedAt }) }).map((e) => [e.session, e]),
  );

  const out: HeldSession[] = [];
  for (const [session, t] of [...tallies.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    // A session that holds no text anywhere has nothing to delete and nothing
    // to write up from; it is not counted at all.
    if (t.lines === 0) continue;
    const h = host(session);
    const entry = entries.get(session);
    const facts: WriteUpFacts = {
      capturedText: t.captured > 0,
      writtenUp: t.writtenUpAt !== null && t.writtenUpAt >= t.lastCaptureAt,
      state: entry?.state ?? null,
      unwritten: entry?.stretch?.pieces ?? 0,
      minutes: entry?.stretch?.minutes ?? 0,
      lapsed: entry?.lapsed === true,
    };
    const owes = entry?.owed === true && !facts.writtenUp;
    const clockFrom = Math.max(t.lastActivityAt, t.writtenUpAt ?? 0, h.endedAt ?? 0);
    const verdict: RetentionVerdict = h.open
      ? "kept-live"
      : owes
        ? "kept-owed"
        : now - clockFrom < TUNABLES.RETENTION_MS
          ? "kept-young"
          : "deleted";
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
      verdict,
    });
  }
  return out;
}

// ── the report, the record, and its readers ─────────────────────────────────

/** What one run came to. Counts only. */
export interface RetentionReport {
  /** `STARTED` is the row a run writes the moment it holds the date's latch,
   *  before it plans; `LATCH_HELD` is the row a later run writes when it finds
   *  the latch held and no row at all for the date (re-review R7). Either one as
   *  the NEWEST row for a date means that run did not finish. */
  readonly reason: "PRUNED" | "NOTHING" | "ALREADY_RAN" | "OBSERVER" | "IO_FAILED" | "STARTED" | "LATCH_HELD";
  /** Scopes holding any session text at all. */
  readonly scopes: number;
  /** Sessions whose text was deleted this run. */
  readonly deleted: number;
  /** ...kept because they owe a write-up, however old. */
  readonly keptOwed: number;
  /** ...kept because their 7 days have not run yet. */
  readonly keptYoung: number;
  /** ...kept because the host's registry holds them open. */
  readonly keptLive: number;
  /** ...due for deletion that the strike could not complete. They stay, and
   *  are due again next run. */
  readonly failed: number;
  /** Text lines the strike took out, across every file. */
  readonly lines: number;
  /** Bytes of text held by the deleted sessions, as planned. */
  readonly bytes: number;
}

/** The payload of one `remember.prune` row. */
export function retentionRow(report: RetentionReport, date: string): Record<string, string | number> {
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
    retentionDays: Math.round(TUNABLES.RETENTION_MS / 86_400_000),
  };
}

/** One recorded run, as the log holds it. */
export interface RetentionRun {
  readonly date: string;
  readonly reason: string;
  readonly scopes: number;
  readonly deleted: number;
  readonly keptOwed: number;
  readonly keptYoung: number;
  readonly keptLive: number;
  readonly failed: number;
  readonly lines: number;
  readonly bytes: number;
  readonly at: number;
  readonly day: number;
}

/** How far back a reading looks, in lived days — the event log's own window. */
const RETENTION_LOOKBACK_DAYS = 90;
const RETENTION_ROW_CEILING = 5_000;

/** Every recorded run inside the log's window, NEWEST FIRST. Never throws. */
export function retentionRuns(store: Pick<Store, "eventLog" | "livedDay">): RetentionRun[] {
  let rows;
  try {
    rows = store.eventLog({
      name: RETENTION_EVENT,
      // Bounded by day as well as by count: an ascending `eventLog` read with a
      // limit keeps the OLDEST rows and drops the newest, so it is read newest
      // first (and sorted below either way).
      sinceDay: Math.max(0, store.livedDay() - RETENTION_LOOKBACK_DAYS),
      order: "desc",
      limit: RETENTION_ROW_CEILING,
    });
  } catch {
    return [];
  }
  const out: (RetentionRun & { seq: number })[] = [];
  for (const row of rows) {
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
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
      seq: row.seq,
    });
  }
  // Newest first, and the log's own order breaks a tie: two runs recorded in
  // one millisecond share an `at`, and "the newest" still has to mean one.
  return out
    .sort((a, b) => (b.at !== a.at ? b.at - a.at : b.seq - a.seq))
    .map(({ seq: _seq, ...run }) => run);
}

/**
 * THE READING DOCTOR SHOWS: the newest run — how many sessions it deleted, how
 * many are waiting on a write-up, how many are younger than a week, how many
 * the host still holds open — or null when retention has never run here.
 */
export function lastRetentionRun(store: Pick<Store, "eventLog" | "livedDay">): RetentionRun | null {
  return retentionRuns(store)[0] ?? null;
}
