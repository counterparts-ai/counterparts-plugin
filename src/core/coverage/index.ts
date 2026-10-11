/**
 * COVERAGE — what is not written up yet, read in one place (2026-09-30).
 *
 * A captured piece of conversation (a line of `buffer.jsonl` or `jots.jsonl`)
 * counts as WRITTEN UP only when a claim for it stands in `coverage.jsonl`. An
 * accepted memory claims every piece of its session not yet claimed; since this
 * module, so do "nothing new" and a chapter, as claims with no proposal behind
 * them. What a session said after its last claim is its unwritten STRETCH.
 *
 * This module is the one reader of that. It does not change how pieces are
 * claimed — `SpanBuffer.claimCoverage` still does all of it — and it knows no
 * host: whether a session has ended is evidence the caller hands in, the way
 * `remember/owes.ts` has always taken it.
 *
 *   - **The ledger** (`ledger`): per session, what it captured, what is written
 *     up, the unwritten stretch (pieces, first and last piece, minutes), and
 *     its state — `active` (captured today and not ended), `quiet` (captured
 *     nothing since the calendar date changed) or `ended`.
 *   - **The pacer's third arm** (`askFromStretch`): three unwritten pieces and
 *     half an hour since the later of the stretch's first piece and the last ask.
 *   - **What a session owes** (the `owed` field): a stretch of three pieces over
 *     fifteen minutes, in a session that is not active, that has not lapsed.
 *     `remember/owes.ts` reads it for retention and the write-up; nothing else
 *     decides it.
 *   - **Lapse** — a LOSS, and said as one (2026-10-10): at the first turn-end
 *     of `LAPSE_DAYS_OF_USE` (14) days of use after the day the stretch's
 *     latest piece was lived; until then it stays owed, and the nightly
 *     write-up takes the oldest first. Nothing is deleted by a lapse; the
 *     session only stops owing, so its text goes on retention's ordinary week
 *     — and what it said never becomes memory. (Three days of use until
 *     2026-10-10, review 01 C4.)
 *   - **Rows** (`recordCoverage`): one durable row per stretch per state —
 *     owed, written up (and by whom), lapsed — written by the turn-end worker.
 *
 * Every date here is the piece's own `at` read in the store's zone, never the
 * lived day on the piece: the lived day advances in the worker AFTER the first
 * turn-end of a date, so the pieces and boundaries of that turn-end carry the
 * day before. Days of use are counted the same way — distinct dates on which a
 * turn-end was recorded (`boundaries.jsonl`, which retention never strikes) —
 * which is what the lived clock counts, without its lag.
 */
import { Buffer } from "node:buffer";

import { keyFor } from "../remember/spans.js";
import type { Span, SpanBuffer } from "../remember/spans.js";
import type { Store } from "../store/index.js";
import { localDate } from "../time.js";
import { isKnownSession } from "../types.js";

import { COVERAGE_TUNABLES } from "./tunables.js";

export { COVERAGE_TUNABLES } from "./tunables.js";
export type { CoverageTunables } from "./tunables.js";

// ── vocabulary ──────────────────────────────────────────────────────────────

/** A session's state, from what it captured and what the host says ended. */
export type SessionState = "active" | "quiet" | "ended";

/** What a session said that is not written up yet. Counts and times, no text. */
export interface Stretch {
  readonly pieces: number;
  /** UTF-8 bytes of those pieces — the pacer's own unit. */
  readonly bytes: number;
  readonly firstAt: number;
  readonly lastAt: number;
  /** First piece to last, rounded down. */
  readonly minutes: number;
  /** The scopes its pieces are in. */
  readonly scopes: readonly string[];
  /** Each piece's time, ascending — what "pieces since the last ask" counts. */
  readonly times: readonly number[];
}

/** One session, as the ledger reads it. */
export interface LedgerEntry {
  readonly session: string;
  /** Every scope that holds a piece of it. */
  readonly scopes: readonly string[];
  readonly state: SessionState;
  /** Its latest piece of any kind, the assistant's own turns included. */
  readonly lastCaptureAt: number;
  /** When it ended, when an end is at or after its latest capture. */
  readonly endedAt: number | null;
  /** Pieces captured (conversation and jots), and how many are written up. */
  readonly pieces: number;
  readonly written: number;
  /** What is not written up, or null. */
  readonly stretch: Stretch | null;
  /** The stretch is past the floor (pieces and minutes). */
  readonly overFloor: boolean;
  readonly owed: boolean;
  readonly lapsed: boolean;
  /** Owed, and under `SMALL_STRETCH_PIECES`: one line is enough. */
  readonly small: boolean;
  /** Days of use recorded after the date of the stretch's latest piece. */
  readonly daysOfUseSince: number;
  /** Its pieces by the date they were captured on (store zone), and how many
   *  of each date's are written up — what a per-date reading keys on. */
  readonly perDate: Readonly<Record<string, { readonly pieces: number; readonly written: number }>>;
}

/** What the host knows about how a session ended. `null`: no end it knows of. */
export interface HostEnd {
  readonly endedAt: number | null;
}

export interface LedgerOptions {
  readonly now: number;
  /** The store's zone: every date here is read in it. */
  readonly zone: string;
  readonly host?: (session: string) => HostEnd;
}

// ── the stretch ─────────────────────────────────────────────────────────────

interface Piece {
  readonly at: number;
  readonly bytes: number;
  readonly scope: string;
}

function stretchOf(pieces: readonly Piece[]): Stretch | null {
  if (pieces.length === 0) return null;
  let firstAt = Infinity;
  let lastAt = -Infinity;
  let bytes = 0;
  const scopes = new Set<string>();
  for (const p of pieces) {
    firstAt = Math.min(firstAt, p.at);
    lastAt = Math.max(lastAt, p.at);
    bytes += p.bytes;
    scopes.add(p.scope);
  }
  return {
    pieces: pieces.length,
    bytes,
    firstAt,
    lastAt,
    minutes: Math.floor((lastAt - firstAt) / 60_000),
    scopes: [...scopes].sort(),
    times: pieces.map((p) => p.at).sort((a, b) => a - b),
  };
}

const atOf = (s: Span): number => (typeof s.at === "number" && Number.isFinite(s.at) ? s.at : 0);

/**
 * ONE SCOPE'S PIECES: the live conversation and jots, and any a claim holds
 * in flight — a claim is the buffer renamed aside, and nothing in flight may
 * make a session look written up. Quarantine is not here: it is the sweep's
 * terminal give-up, not something said that waits for a writer.
 */
function piecesIn(buffer: SpanBuffer, scope: string): Span[] {
  const seen = new Set<string>();
  const out: Span[] = [];
  for (const s of [...buffer.spans(scope), ...buffer.claimedSpans(scope).filter((x) => x.kind !== "assistant")]) {
    if (seen.has(s.hash)) continue;
    seen.add(s.hash);
    out.push(s);
  }
  return out;
}

/**
 * ONE SESSION'S UNWRITTEN STRETCH, in the scopes named (all of them when
 * none are) — the pacer reads its own project's, at every Stop.
 */
export function sessionStretch(buffer: SpanBuffer, session: string, scopes?: readonly string[]): Stretch | null {
  const pieces: Piece[] = [];
  for (const scope of scopes ?? buffer.scopes()) {
    const covered = buffer.coveredHashes(scope);
    for (const s of piecesIn(buffer, scope)) {
      if (s.session !== session || covered.has(s.hash)) continue;
      pieces.push({ at: atOf(s), bytes: Buffer.byteLength(s.text, "utf8"), scope });
    }
  }
  return stretchOf(pieces);
}

/**
 * THE PACER'S THIRD ARM, beside typed turns and bytes: `ASK_PIECES` unwritten
 * pieces captured since the session's last ask, and `ASK_AFTER_MS` since the
 * later of the stretch's first piece and that ask. It applies to a first ask as
 * well. New pieces AND time: an ask nobody answers is not asked again on the
 * clock alone (review of #289). Pure.
 */
export function askFromStretch(
  stretch: Pick<Stretch, "pieces" | "firstAt" | "times"> | null,
  lastAskAt: number | null,
  now: number,
  t: Pick<typeof COVERAGE_TUNABLES, "ASK_PIECES" | "ASK_AFTER_MS"> = COVERAGE_TUNABLES,
): boolean {
  if (stretch === null) return false;
  const fresh = lastAskAt === null ? stretch.pieces : stretch.times.filter((at) => at > lastAskAt).length;
  if (fresh < t.ASK_PIECES) return false;
  return now - Math.max(stretch.firstAt, lastAskAt ?? -Infinity) >= t.ASK_AFTER_MS;
}

/** Past the floor that makes a stretch a debt: pieces AND minutes. Pure. */
export function overFloor(stretch: Pick<Stretch, "pieces" | "firstAt" | "lastAt"> | null): boolean {
  if (stretch === null) return false;
  return (
    stretch.pieces >= COVERAGE_TUNABLES.OWED_PIECES &&
    stretch.lastAt - stretch.firstAt >= COVERAGE_TUNABLES.OWED_SPAN_MS
  );
}

// ── days of use ─────────────────────────────────────────────────────────────

/**
 * EVERY DATE A TURN-END WAS RECORDED ON, in the store's zone, sorted — the
 * days of use. Read from `boundaries.jsonl` in every scope, `stop` boundaries
 * only (a session's end or a compaction is not a turn-end): one is written at
 * every turn-end before the worker runs, and retention strikes text, never
 * boundaries.
 */
export function daysOfUse(buffer: SpanBuffer, zone: string): string[] {
  const dates = new Set<string>();
  for (const scope of buffer.scopes()) {
    for (const b of buffer.boundaries(scope)) {
      if (b.kind !== "stop" || typeof b.at !== "number" || !Number.isFinite(b.at)) continue;
      const d = localDate(b.at, zone);
      if (d.length > 0) dates.add(d);
    }
  }
  return [...dates].sort();
}

function usesAfter(uses: readonly string[], date: string): number {
  let n = 0;
  for (const d of uses) if (d > date) n += 1;
  return n;
}

// ── the ledger ──────────────────────────────────────────────────────────────

interface Tally {
  scopes: Set<string>;
  all: Piece[];
  unwritten: Piece[];
  pieces: number;
  lastCaptureAt: number;
  endAt: number | null;
  writtenUpAt: number | null;
}

/**
 * THE LEDGER: every session holding a captured piece, judged once. Read-only.
 * Sessions with only the assistant's own turns are not in it: nothing is
 * written up from those.
 */
export function ledger(buffer: SpanBuffer, opts: LedgerOptions): LedgerEntry[] {
  const today = localDate(opts.now, opts.zone);
  const uses = daysOfUse(buffer, opts.zone);
  const tallies = new Map<string, Tally>();
  const tally = (session: unknown): Tally | null => {
    if (typeof session !== "string" || session.length === 0) return null;
    let t = tallies.get(session);
    if (t === undefined) {
      t = { scopes: new Set(), all: [], unwritten: [], pieces: 0, lastCaptureAt: 0, endAt: null, writtenUpAt: null };
      tallies.set(session, t);
    }
    return t;
  };

  for (const scope of buffer.scopes()) {
    const covered = buffer.coveredHashes(scope);
    for (const s of piecesIn(buffer, scope)) {
      const t = tally(s.session);
      if (t === null) continue;
      const at = atOf(s);
      t.scopes.add(scope);
      t.pieces += 1;
      t.lastCaptureAt = Math.max(t.lastCaptureAt, at);
      const piece = { at, bytes: Buffer.byteLength(s.text, "utf8"), scope };
      t.all.push(piece);
      if (!covered.has(s.hash)) t.unwritten.push(piece);
    }
    // The rest is read into a tally too, whichever scope comes first: a
    // session with no piece at all is dropped below.
    for (const s of buffer.assistantSpans(scope)) {
      const t = tally(s.session);
      if (t !== null) t.lastCaptureAt = Math.max(t.lastCaptureAt, atOf(s));
    }
    for (const b of buffer.boundaries(scope)) {
      if (b.kind !== "session-end" || typeof b.at !== "number") continue;
      const t = tally(b.session);
      if (t !== null) t.endAt = Math.max(t.endAt ?? 0, b.at);
    }
    for (const w of buffer.writeUps(scope)) {
      const t = tally(w.session);
      if (t !== null) t.writtenUpAt = Math.max(t.writtenUpAt ?? 0, w.at);
    }
  }

  const out: LedgerEntry[] = [];
  for (const [session, t] of [...tallies.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (t.pieces === 0) continue;
    let hostEnd: number | null = null;
    try {
      hostEnd = opts.host?.(session).endedAt ?? null;
    } catch {
      hostEnd = null;
    }
    const endAt = maxOf(t.endAt, hostEnd);
    const ended = endAt !== null && endAt >= t.lastCaptureAt;
    const state: SessionState = ended ? "ended" : localDate(t.lastCaptureAt, opts.zone) < today ? "quiet" : "active";
    // A write-up mark at or after a piece covers it, whatever the claim file
    // says: the door's own claim is the ordinary road, the mark its fallback.
    const unwritten = t.writtenUpAt === null ? t.unwritten : t.unwritten.filter((p) => p.at > (t.writtenUpAt as number));
    const stretch = stretchOf(unwritten);
    const floor = overFloor(stretch);
    const since = stretch === null ? 0 : usesAfter(uses, localDate(stretch.lastAt, opts.zone));
    const lapsed = floor && since >= COVERAGE_TUNABLES.LAPSE_DAYS_OF_USE;
    const owed = floor && state !== "active" && !lapsed;
    const perDate: Record<string, { pieces: number; written: number }> = {};
    const open = new Set(unwritten);
    for (const p of t.all) {
      const d = localDate(p.at, opts.zone);
      const cell = (perDate[d] ??= { pieces: 0, written: 0 });
      cell.pieces += 1;
      if (!open.has(p)) cell.written += 1;
    }
    out.push({
      session,
      scopes: [...t.scopes].sort(),
      state,
      lastCaptureAt: t.lastCaptureAt,
      endedAt: ended ? endAt : null,
      pieces: t.pieces,
      written: t.pieces - unwritten.length,
      stretch,
      overFloor: floor,
      owed,
      lapsed,
      small: owed && (stretch?.pieces ?? 0) < COVERAGE_TUNABLES.SMALL_STRETCH_PIECES,
      daysOfUseSince: since,
      perDate,
    });
  }
  return out;
}

function maxOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

// ── claims with no proposal behind them ─────────────────────────────────────

/**
 * WHO A CLAIM IN `coverage.jsonl` SAYS WROTE A STRETCH UP. A claim's
 * `proposalId` is a proposal's id (`prp_…`) when a memory made it; these
 * prefixes name the other writers, each followed by `:` and an id.
 */
export const CLAIM_NOTHING_NEW = "nothing-new";
export const CLAIM_CHAPTER = "chapter";
/** The write-up door's own claim (`mcp/write-up.ts#finish`), `writeup:<writer>`. */
export const CLAIM_WRITE_UP = "writeup";

/**
 * CLAIM A SESSION'S UNWRITTEN PIECES for a writer with no proposal — "nothing
 * new" or a chapter — in the ONE scope the answer was given in, as a memory's
 * claim is (review of #289: "nothing new" in project A must not write up what
 * the same session said in B). The claim is `<by>:<ref>:<time>`, so every
 * answer is its own claim. Returns how many pieces it claimed; never throws (a
 * claim that did not land costs a later reader a stretch that still reads
 * unwritten, never words).
 */
export function claimUnwritten(
  buffer: SpanBuffer,
  input: { session: string; scope: string; by: typeof CLAIM_NOTHING_NEW | typeof CLAIM_CHAPTER; ref: string },
): { pieces: number } {
  try {
    const marks = buffer.claimCoverage({
      scope: input.scope,
      session: input.session,
      proposalId: `${input.by}:${input.ref}:${String(buffer.now())}`,
    });
    return { pieces: marks.length };
  } catch {
    return { pieces: 0 };
  }
}

/** The writer a claim names, in the words the rows and the console use. */
export type Writer = "session" | "nothing-new" | "chapter" | "next-session" | "other";

function writerOf(claim: string, markSession: string, proposalSession: string | undefined): Writer {
  if (claim.startsWith(`${CLAIM_NOTHING_NEW}:`)) return "nothing-new";
  if (claim.startsWith(`${CLAIM_CHAPTER}:`)) return "chapter";
  if (claim.startsWith(`${CLAIM_WRITE_UP}:`)) return "next-session";
  if (claim.startsWith("prp_")) {
    // A write-up's last part deposits under the WRITING session and covers the
    // ended one's words (`cover: { session }`): the proposal names the writer.
    return proposalSession === undefined || proposalSession === markSession ? "session" : "next-session";
  }
  return "other";
}

// ── the work since a moment, for the handoff pointer ────────────────────────

/**
 * WHAT WAS CAPTURED IN ONE SCOPE AFTER `since`, by any session: how many
 * pieces, how many are not written up, the first and last piece's time, and
 * whether that is past the owed floor — piece times, never the registry's
 * boundary clock, which a close bumps.
 *
 * `writer` is the session that wrote at `since` (a handoff's): its own pieces
 * up to its next boundary after `since` are not "work since" — a handoff is
 * written mid-turn, and that turn's Stop captures the prompt that asked for it
 * afterwards (review of #289).
 *
 * HOW FAR IT IS WRITTEN UP (2026-09-30, the continuity test): `writtenUpTo` is
 * the time of the LATEST WRITTEN-UP PIECE (a piece time, like `from` and `to`;
 * review of #300 MINOR-7), `writtenUpBy` what claimed it, and
 * `unwrittenAfter` how many of the unwritten pieces came after it. A chapter
 * written at 17:50 with a few turns said after it read "not yet written up"
 * while the answer was yes or no, which told the next session there was
 * nothing to read.
 */
export function workSince(
  buffer: SpanBuffer,
  scope: string,
  since: number,
  opts: { writer?: string | null } = {},
): {
  pieces: number;
  unwritten: number;
  firstAt: number | null;
  lastAt: number | null;
  overFloor: boolean;
  writtenUpTo: number | null;
  writtenUpBy: WrittenUpBy | null;
  unwrittenAfter: number;
} {
  const norm = (s: string): string => s.trim().replace(/\/+$/, "");
  let pieces = 0;
  let unwritten = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  let latest: { at: number; claim: string; session: string; scope: string } | null = null;
  const unwrittenAt: number[] = [];
  for (const held of buffer.scopes()) {
    if (norm(held) !== norm(scope)) continue;
    const writer = opts.writer ?? null;
    let writerUntil = -Infinity;
    if (writer !== null) {
      const next = buffer
        .boundaries(held)
        .filter((b) => b.session === writer && typeof b.at === "number" && b.at >= since)
        .map((b) => b.at);
      writerUntil = next.length === 0 ? Infinity : Math.min(...next);
    }
    const marks = new Map(buffer.coverage(held).map((m) => [m.spanHash, m]));
    for (const s of piecesIn(buffer, held)) {
      const at = atOf(s);
      if (at <= since) continue;
      if (s.session === writer && at <= writerUntil) continue;
      pieces += 1;
      const mark = marks.get(s.hash);
      if (mark === undefined) {
        unwritten += 1;
        unwrittenAt.push(at);
      } else if (latest === null || at > latest.at) {
        latest = { at, claim: mark.proposalId, session: mark.session, scope: held };
      }
      firstAt = Math.min(firstAt ?? Infinity, at);
      lastAt = Math.max(lastAt ?? 0, at);
    }
  }
  const floor = firstAt !== null && lastAt !== null && overFloor({ pieces, firstAt, lastAt });
  const upTo = latest?.at ?? null;
  return {
    pieces,
    unwritten,
    firstAt,
    lastAt,
    overFloor: floor,
    writtenUpTo: upTo,
    writtenUpBy: latest === null ? null : writtenUpWords(writerOf(latest.claim, latest.session, proposalSession(buffer, latest.scope, latest.claim))),
    unwrittenAfter: upTo === null ? unwritten : unwrittenAt.filter((at) => at > upTo).length,
  };
}

/** The session a `prp_` claim's proposal was written under, so a later
 *  session's write-up reads as one (review of #300 MINOR-7). */
function proposalSession(buffer: SpanBuffer, scope: string, claim: string): string | undefined {
  if (!claim.startsWith("prp_")) return undefined;
  try {
    for (const p of buffer.proposalRecords<{ id?: unknown; session?: unknown }>(scope)) {
      if (p?.id === claim && typeof p.session === "string") return p.session;
    }
  } catch {
    /* unknown reads as the session's own */
  }
  return undefined;
}

/**
 * THE CHAPTERS CLAIMED IN ONE SCOPE: the episode ids named by its chapter
 * claims (`chapter:<epi>#<n>:<time>`) — the directory a chapter was written in,
 * as the coverage file records it (review of #300 MINOR-1). Never throws.
 */
export function chapterClaims(buffer: SpanBuffer, scope: string): Set<string> {
  const norm = (s: string): string => s.trim().replace(/\/+$/, "");
  const out = new Set<string>();
  try {
    for (const held of buffer.scopes()) {
      if (norm(held) !== norm(scope)) continue;
      for (const m of buffer.coverage(held)) {
        if (typeof m.proposalId !== "string" || !m.proposalId.startsWith(`${CLAIM_CHAPTER}:`)) continue;
        const id = m.proposalId.slice(CLAIM_CHAPTER.length + 1).split("#")[0];
        if (id !== undefined && id.length > 0) out.add(id);
      }
    }
  } catch {
    return out;
  }
  return out;
}

/** What wrote up the latest of the work since, in the words the pointer uses. */
export type WrittenUpBy = "memories" | "chapter" | "nothing new" | "write-up";

function writtenUpWords(w: Writer): WrittenUpBy | null {
  switch (w) {
    case "session":
      return "memories";
    case "chapter":
      return "chapter";
    case "nothing-new":
      return "nothing new";
    case "next-session":
      return "write-up";
    default:
      return null;
  }
}

/**
 * THE SESSIONS THAT RAN IN ONE SCOPE, newest first (2026-09-30, the wake's
 * "Last here" line): each with the first and last moment it was at work here
 * — its turn-ends (`stop` boundaries in `boundaries.jsonl`, which retention
 * never strikes) and the pieces still held, never a `session-end`, whose time
 * is when the host closed it (review of #300 MINOR-2) — and whether it has
 * ended. It is how a chapter that records no directory is joined to the one it
 * was written in, and when that session was here.
 *
 * `only` keeps the walk to the sessions the caller can use; everything else is
 * dropped while reading. Never throws: a buffer that will not answer names no
 * session.
 */
export function sessionsHere(
  buffer: SpanBuffer,
  scope: string,
  opts: { only?: ReadonlySet<string> } = {},
): { session: string; firstAt: number; lastAt: number; ended: boolean }[] {
  const norm = (s: string): string => s.trim().replace(/\/+$/, "");
  const seen = new Map<string, { session: string; firstAt: number; lastAt: number; ended: boolean }>();
  // The unbound memory server's shared id is not a session (`UNBOUND_SESSION`):
  // its jots are every unbound server's, so it never ran "here" as one.
  const wanted = (session: unknown): session is string =>
    typeof session === "string" && isKnownSession(session) && (opts.only === undefined || opts.only.has(session));
  const note = (session: string, at: number): void => {
    if (!Number.isFinite(at) || at <= 0) return;
    const held = seen.get(session);
    if (held === undefined) seen.set(session, { session, firstAt: at, lastAt: at, ended: false });
    else {
      held.firstAt = Math.min(held.firstAt, at);
      held.lastAt = Math.max(held.lastAt, at);
    }
  };
  const ended = new Set<string>();
  try {
    for (const held of buffer.scopes()) {
      if (norm(held) !== norm(scope)) continue;
      for (const b of buffer.boundaries(held)) {
        if (!wanted(b.session)) continue;
        if (b.kind === "stop") note(b.session, b.at);
        else if (b.kind === "session-end") ended.add(b.session);
      }
      for (const s of piecesIn(buffer, held)) if (wanted(s.session)) note(s.session, atOf(s));
    }
  } catch {
    return [];
  }
  for (const s of seen.values()) s.ended = ended.has(s.session);
  return [...seen.values()].sort((a, b) => b.lastAt - a.lastAt);
}

// ── the rows ────────────────────────────────────────────────────────────────

/** A stretch became owed. */
export const COVERAGE_OWED_EVENT = "coverage.owed";
/** A stretch was written up, and by whom. */
export const COVERAGE_WRITTEN_EVENT = "coverage.written";
/** An owed stretch lapsed: nothing deleted, nothing owed any more. */
export const COVERAGE_LAPSED_EVENT = "coverage.lapsed";

/** Where the written-up rows have been read up to, in box 2's meta. */
export const COVERAGE_WRITTEN_THROUGH_KEY = "coverage.written.through";
/** How far back each pass re-reads claims, so one appended by another process
 *  a moment late is still seen. The dedup key makes a re-read free. */
const WRITTEN_SLACK_MS = 10 * 60_000;

export interface CoverageRecordReport {
  readonly reason: "recorded" | "observer" | "failed";
  readonly owed: number;
  readonly lapsed: number;
  readonly written: number;
  /** Rows that landed this pass (a repeat is refused by its dedup key). */
  readonly rows: number;
}

type RowStore = Pick<Store, "appendEvent" | "eventLog" | "livedDay" | "getMeta" | "setMeta">;

/** How many of a name's newest rows are read to skip a repeat before writing. */
const KNOWN_ROW_CEILING = 5_000;

/**
 * THE ROWS — one per stretch per state, so a pass that runs at every
 * turn-end writes each fact once: owed and lapsed under a dedup key (they are
 * bounded, one per stretch), written-up rows with none, so the log's ordinary
 * prune lets them go. Ids, counts and a code:
 * the scope as its buffer key (`keyFor`), never the path; no text.
 *
 * Written-up rows are read off `coverage.jsonl` from a watermark in meta. On a
 * store that has never run this, the watermark starts NOW: no backfill of old
 * claims. Owed and lapsed rows are the ledger's, so an old store's standing
 * stretches get one row each the first time — owed, or lapsed — and no more.
 */
export function recordCoverage(
  buffer: SpanBuffer,
  store: RowStore,
  opts: LedgerOptions,
): CoverageRecordReport {
  if (buffer.observer) return { reason: "observer", owed: 0, lapsed: 0, written: 0, rows: 0 };
  let rows = 0;
  let owed = 0;
  let lapsed = 0;
  let written = 0;
  try {
    const day = store.livedDay();
    // A stretch stays owed or lapsed for as long as its text is held, and this
    // runs at every turn-end: the keys already written are read once, so a
    // repeat costs a set lookup rather than a refused write.
    const known = new Set<string>();
    for (const name of [COVERAGE_OWED_EVENT, COVERAGE_LAPSED_EVENT]) {
      for (const row of store.eventLog({ name, order: "desc", limit: KNOWN_ROW_CEILING })) {
        if (row.dedup_key !== null) known.add(row.dedup_key);
      }
    }
    // Written-up rows carry NO dedup key, so the log's ordinary prune lets them
    // go (review of #289); a repeat inside the re-read window is found by the
    // same key rebuilt from the recent rows themselves.
    for (const row of store.eventLog({ name: COVERAGE_WRITTEN_EVENT, order: "desc", limit: KNOWN_ROW_CEILING })) {
      try {
        const p = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
        known.add(writtenKey(String(p["scope"] ?? ""), String(p["session"] ?? ""), row.ref ?? ""));
      } catch {
        /* a row that will not parse is not a repeat of anything */
      }
    }
    const append = (
      name: string,
      key: string,
      payload: Record<string, unknown>,
      opts: { ref?: string; dedup: boolean },
    ): void => {
      if (known.has(key)) return;
      known.add(key);
      const seq = store.appendEvent({
        name,
        day,
        payload,
        ...(opts.dedup ? { dedupKey: key } : {}),
        ...(opts.ref === undefined ? {} : { ref: opts.ref }),
      });
      if (seq !== 0) rows += 1;
    };
    for (const e of ledger(buffer, opts)) {
      const s = e.stretch;
      if (s === null || !(e.owed || e.lapsed)) continue;
      const payload = {
        session: e.session,
        scope: keyFor(s.scopes[0] ?? ""),
        scopes: s.scopes.length,
        pieces: s.pieces,
        minutes: s.minutes,
        from: localDate(s.firstAt, opts.zone),
        to: localDate(s.lastAt, opts.zone),
        state: e.state,
      };
      if (e.owed) {
        owed += 1;
        append(COVERAGE_OWED_EVENT, `${COVERAGE_OWED_EVENT}:${e.session}:${String(s.firstAt)}`, payload, { dedup: true });
      } else {
        lapsed += 1;
        append(
          COVERAGE_LAPSED_EVENT,
          `${COVERAGE_LAPSED_EVENT}:${e.session}:${String(s.firstAt)}`,
          { ...payload, daysOfUse: e.daysOfUseSince },
          { dedup: true },
        );
      }
    }
    const through = Number(store.getMeta(COVERAGE_WRITTEN_THROUGH_KEY) ?? "NaN");
    if (Number.isFinite(through)) written = writtenRows(buffer, through - WRITTEN_SLACK_MS, opts, append);
    // Moved only when it has fallen a slack behind (or on the first pass), so a
    // quiet turn-end writes nothing; the window re-read stays two slacks wide.
    if (!Number.isFinite(through) || opts.now - through >= WRITTEN_SLACK_MS) {
      store.setMeta(COVERAGE_WRITTEN_THROUGH_KEY, String(opts.now));
    }
    return { reason: "recorded", owed, lapsed, written, rows };
  } catch {
    return { reason: "failed", owed, lapsed, written, rows };
  }
}

/** The key a written-up row is known by: scope key, session, claim. */
function writtenKey(scopeKey: string, session: string, claim: string): string {
  return `${COVERAGE_WRITTEN_EVENT}:${scopeKey}:${session}:${claim}`;
}

/** One row per claim made after `from`: a claim is one stretch written up. */
function writtenRows(
  buffer: SpanBuffer,
  from: number,
  opts: LedgerOptions,
  append: (name: string, key: string, payload: Record<string, unknown>, opts: { ref?: string; dedup: boolean }) => void,
): number {
  let n = 0;
  for (const scope of buffer.scopes()) {
    const marks = buffer.coverage(scope).filter((m) => typeof m.at === "number" && m.at > from && m.at <= opts.now);
    if (marks.length === 0) continue;
    const pieceAt = new Map(buffer.spans(scope).map((s) => [s.hash, atOf(s)] as const));
    const proposals = new Map<string, string>();
    for (const p of buffer.proposalRecords<{ id?: unknown; session?: unknown }>(scope)) {
      if (typeof p?.id === "string" && typeof p.session === "string") proposals.set(p.id, p.session);
    }
    const groups = new Map<string, { session: string; claim: string; hashes: string[] }>();
    for (const m of marks) {
      if (typeof m.session !== "string" || typeof m.proposalId !== "string") continue;
      const key = `${m.session}\u0000${m.proposalId}`;
      const g = groups.get(key) ?? { session: m.session, claim: m.proposalId, hashes: [] };
      g.hashes.push(m.spanHash);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const times = g.hashes.map((h) => pieceAt.get(h)).filter((t): t is number => t !== undefined);
      const minutes = times.length === 0 ? 0 : Math.floor((Math.max(...times) - Math.min(...times)) / 60_000);
      append(
        COVERAGE_WRITTEN_EVENT,
        writtenKey(keyFor(scope), g.session, g.claim),
        {
          session: g.session,
          scope: keyFor(scope),
          pieces: g.hashes.length,
          minutes,
          by: writerOf(g.claim, g.session, proposals.get(g.claim)),
        },
        { ref: g.claim, dedup: false },
      );
      n += 1;
    }
  }
  return n;
}

// ── reading the rows ────────────────────────────────────────────────────────

/** One lapse, as the log holds it. */
export interface LapseRow {
  readonly session: string;
  readonly pieces: number;
  readonly minutes: number;
  readonly at: number;
}

/** Lapses recorded since `sinceAt`, newest first. Never throws. */
export function lapsesSince(store: Pick<Store, "eventLog">, sinceAt: number): LapseRow[] {
  try {
    const out: LapseRow[] = [];
    for (const row of store.eventLog({ name: COVERAGE_LAPSED_EVENT, order: "desc", limit: 5_000 })) {
      if (row.at < sinceAt) break;
      let p: Record<string, unknown> = {};
      try {
        p = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
      } catch {
        continue;
      }
      out.push({
        session: typeof p["session"] === "string" ? p["session"] : "",
        pieces: typeof p["pieces"] === "number" ? p["pieces"] : 0,
        minutes: typeof p["minutes"] === "number" ? p["minutes"] : 0,
        at: row.at,
      });
    }
    return out;
  } catch {
    return [];
  }
}
