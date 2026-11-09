/**
 * ONE LIVED DAY OF PER-TURN ROWS, KEPT AS A SUMMARY (FD1 step 2, 2026-11-07).
 *
 * The per-turn names (`store/operational.ts` `SHORT_RETENTION_NAMES`) go after
 * `SHORT_RETENTION_DAYS` lived days. Before a day of them goes, the store
 * writes one latched `events.rolled` row for that day, and this file is what
 * goes in it: what every all-time reader needs so its number does not shrink
 * when the rows do (Mike's roadmap ruling R2, 11-07).
 *
 * - `counts`, and the first and last moment and calendar date of each name:
 *   the dashboard's per-name counts and `counterparts mechanisms`' total and
 *   last fired (`adapters/fired.ts`).
 * - `positive`: rows whose payload field is above 0, per `ROLLED_POSITIVE` —
 *   the filtered mechanisms `fired.ts` counts (`recall.decision#moodMatched`).
 *   `test/fd1-growth.test.ts` keeps the two lists in step.
 * - `used`: the memory ids `recall.credit` credited, with the lived days — the
 *   memory card's "days used". Ids of memories, as the rows themselves held.
 *   Kept at any age, so a removed id never stays in one: the roll-up leaves
 *   out every id on the deny-list when it writes (`denied`), and the owner's
 *   removal takes the id out of summaries already written (`owner-op-seam.ts`).
 *   A summary holds no memory's words, title or body.
 * - The day's counts include the rows about a removed memory, as the log's
 *   own counts did; a count is not about any one memory.
 * - `sessions`: the session refs the day's `recall.decision` rows named — the
 *   flow tab's "N sessions seen". A session id names a conversation, not a
 *   memory: the owner's removal of a memory has nothing to take from it.
 * - `probe` and `ratings`: `probe-oq4`'s two reports over the day's rows
 *   (`recall/probe.ts`), without the per-session list; the console merges them
 *   with the report over the rows still held (`mergeProbe`, `mergeRatings`).
 *
 * NOT COUNTED, said: a per-turn row written later with a lived day already
 * summarised (only a catch-up writing into the past could) is skipped by the
 * all-time readers with the rest of that day's held rows, and goes uncounted.
 *
 * Pure: no store, no clock. A leaf the store imports.
 */
import { probeOQ4, probeRatings } from "./recall/probe.js";
import type { ProbeReport, RatingReport } from "./recall/probe.js";

/** The payload field, per name, whose rows above 0 are counted apart (`fired.ts`'s `positive`). */
export const ROLLED_POSITIVE: Readonly<Record<string, readonly string[]>> = {
  "recall.decision": ["moodMatched"],
};

/** The rows a summary is made from: the event log's columns. */
export interface RollupRow {
  readonly name: string;
  readonly day: number;
  readonly at: number;
  readonly payload: string | null;
  readonly ref?: string | null;
}

export interface NameSpan {
  readonly n: number;
  readonly firstAt: number;
  readonly lastAt: number;
  /** The payload's own calendar `date`, when the rows carried one. */
  readonly firstDate: string | null;
  readonly lastDate: string | null;
}

export interface RolledDay {
  readonly day: number;
  /** Rows by name: the summary's whole count (what the dashboard and `verify` sum). */
  readonly counts: Readonly<Record<string, number>>;
  readonly spans: Readonly<Record<string, NameSpan>>;
  /** `name#field` → the rows whose payload field was above 0. */
  readonly positive: Readonly<Record<string, NameSpan>>;
  /** Memory id → the lived days a `recall.credit` row credited it. */
  readonly used: Readonly<Record<string, readonly number[]>>;
  /** The session refs the day's `recall.decision` rows named. */
  readonly sessions: readonly string[];
  readonly probe: Omit<ProbeReport, "sessions"> | null;
  readonly ratings: RatingReport | null;
}

function parse(payload: string | null): Record<string, unknown> {
  if (payload === null) return {};
  try {
    const p: unknown = JSON.parse(payload);
    return p !== null && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function widen(m: Map<string, { n: number; firstAt: number; lastAt: number; firstDate: string | null; lastDate: string | null }>, key: string, at: number, date: string | null): void {
  const s = m.get(key);
  if (s === undefined) {
    m.set(key, { n: 1, firstAt: at, lastAt: at, firstDate: date, lastDate: date });
    return;
  }
  s.n += 1;
  if (at < s.firstAt) s.firstAt = at;
  if (at > s.lastAt) s.lastAt = at;
  if (date !== null && (s.firstDate === null || date < s.firstDate)) s.firstDate = date;
  if (date !== null && (s.lastDate === null || date > s.lastDate)) s.lastDate = date;
}

/**
 * The summary of one lived day: `rows` are that day's per-turn rows, `lookups`
 * its `mcp.recall` rows (the ratings report reads them; they are not rolled
 * and keep their own window).
 */
export function summarizeDay(
  day: number,
  rows: readonly RollupRow[],
  lookups: readonly RollupRow[] = [],
  /** Ids the owner removed (or holds): never written into `used`, whatever the rows still say. */
  denied: ReadonlySet<string> = new Set(),
): RolledDay {
  const spans = new Map<string, { n: number; firstAt: number; lastAt: number; firstDate: string | null; lastDate: string | null }>();
  const positive = new Map<string, { n: number; firstAt: number; lastAt: number; firstDate: string | null; lastDate: string | null }>();
  const used = new Map<string, Set<number>>();
  const sessions = new Set<string>();
  for (const r of rows) {
    if (r.name === "recall.decision" && typeof r.ref === "string" && r.ref.length > 0) sessions.add(r.ref);
    const p = parse(r.payload);
    const date = typeof p["date"] === "string" && p["date"].length === 10 ? p["date"] : null;
    widen(spans, r.name, r.at, date);
    for (const field of ROLLED_POSITIVE[r.name] ?? []) {
      const v = p[field];
      if (typeof v === "number" && v > 0) widen(positive, `${r.name}#${field}`, r.at, date);
    }
    if (r.name === "recall.credit" && Array.isArray(p["ids"])) {
      const d = typeof p["day"] === "number" ? p["day"] : r.day;
      for (const id of p["ids"] as unknown[]) {
        if (typeof id !== "string" || denied.has(id)) continue;
        const days = used.get(id) ?? new Set<number>();
        days.add(d);
        used.set(id, days);
      }
    }
  }
  const probeRows = rows.map((r) => ({ name: r.name, day: r.day, payload: r.payload }));
  const hasProbe = rows.some((r) => r.name === "recall.decision" || r.name === "recall.credit");
  const hasRatings = rows.some((r) => r.name === "recall.rated");
  let probe: Omit<ProbeReport, "sessions"> | null = null;
  if (hasProbe) {
    const { sessions: _sessions, ...rest } = probeOQ4(probeRows);
    probe = rest;
  }
  const ratings = hasRatings
    ? probeRatings([...probeRows, ...lookups.map((r) => ({ name: r.name, day: r.day, payload: r.payload }))])
    : null;
  return {
    day,
    counts: Object.fromEntries([...spans].map(([k, s]) => [k, s.n])),
    spans: Object.fromEntries(spans),
    positive: Object.fromEntries(positive),
    used: Object.fromEntries([...used].map(([id, d]) => [id, [...d].sort((a, b) => a - b)])),
    sessions: [...sessions].sort(),
    probe,
    ratings,
  };
}

/** A stored summary read back; null for a payload that is not one. Tolerant of fields a build added later. */
export function rolledOf(payload: string | null, rowDay: number): RolledDay | null {
  const p = parse(payload);
  const counts = p["counts"];
  if (counts === null || typeof counts !== "object") return null;
  const obj = (v: unknown): Record<string, never> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, never>) : {});
  return {
    day: typeof p["day"] === "number" ? p["day"] : rowDay,
    counts: counts as Record<string, number>,
    spans: obj(p["spans"]),
    positive: obj(p["positive"]),
    used: obj(p["used"]),
    sessions: Array.isArray(p["sessions"]) ? (p["sessions"] as unknown[]).filter((x): x is string => typeof x === "string") : [],
    probe: (p["probe"] as RolledDay["probe"] | undefined) ?? null,
    ratings: (p["ratings"] as RolledDay["ratings"] | undefined) ?? null,
  };
}
