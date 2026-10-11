/**
 * The span buffer — durable holding for lived experience, written at microsecond
 * speed so no host ever waits on judgment (contract §5 G1).
 *
 * Everything durable lives under `<dataDir>/spans/`, one directory per scope:
 *
 *   spans/
 *     scopes.json                the key -> scope legend (keys are hashes, see NOTES §2)
 *     cursors/<scope>.<session>.json  ONE file per (scope, session) — disjoint by
 *                                construction, and scoped so one session id under
 *                                two scopes cannot starve either (PR-1 review)
 *     <key>/buffer.jsonl         the live conversational buffer (append-only)
 *     <key>/assistant.jsonl      the assistant's own turns, kept separately
 *     <key>/boundaries.jsonl     every session-ending boundary, and its ask
 *     <key>/coverage.jsonl       spanHash -> proposalId (the engine's claims)
 *     <key>/proposals.jsonl      minted proposals (also the content-idempotency ledger)
 *     <key>/consumed.jsonl       bounded hash ledger — dedup layer 2 after a claim dies
 *     <key>/failures.jsonl       bounded {hash, at, code} ledger — the retry bound
 *     <key>/quarantine.jsonl     spans that failed MAX_SPAN_FAILURES times, in full
 *     <key>/writeups.jsonl       sessions written up AFTER they ended — {session, at, by}
 *     <key>/strikes.jsonl        what the strike and retention destroyed — counts only
 *     <key>/claims/<id>.jsonl    a claim, renamed ASIDE from the buffer
 *
 * Four structural properties, each load-bearing (contract §5 G3):
 *
 *   advance-after-success   the cursor moves only after the append landed;
 *   two dedup layers        a per-session cursor for a GROWING transcript, a content
 *                           hash for exact repeats — neither catches the other's case;
 *   rename choreography     a claim is `rename(2)`d aside, so a concurrent append
 *                           lands in a fresh buffer and cannot be destroyed;
 *   restore-before-consume  a failed restore keeps the claim, so a failed arc is
 *                           never in neither place.
 *
 * Nothing here calls a model, and nothing here throws into the host (G2): every
 * public capture path is synchronous, wrapped, and returns a REASON.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";

import { grantSpanStrike } from "./owner-strike-seam.js";
import { grantWriteUp } from "./write-up-seam.js";
import { carriesDreamMark } from "../dream/mark.js";
import { hashText } from "../store/prose.js";
import { dataDir } from "../store/paths.js";
import { isObserver } from "../observer.js";
import type { Stance } from "../observer.js";
import { TUNABLES } from "./tunables.js";

// ── vocabulary ───────────────────────────────────────────────────────────────

/** Provenance of a turn. Only conversational text (and host-injected context)
 *  enters capture; tool output, file contents and images never do. This is a
 *  DECLARED blind spot, not an oversight (§3, behavioral-spec §2 G10/G11).
 *
 *  `foreign` is the parallel run's addition: material ANOTHER memory system's
 *  hooks put into this host's context. It is not the host speaking (`injected`)
 *  and it is certainly not the user, so it enters nothing — see `enters()`.
 *
 *  `ritual` is THIS system's own asks, read back off the transcript. A host that
 *  returns hook output into the context (Claude Code's `Stop hook feedback:`)
 *  hands us our own words as though the user had said them; encoding those is
 *  the self-referential half of the same mistake `foreign` names. It enters
 *  nothing either, and — because it is refused rather than dropped silently —
 *  it is COUNTED in `CaptureResult.excluded`, so the exclusion is a number the
 *  boundary record carries rather than an absence nobody can see. */
export type TurnSource =
  | "conversation"
  | "injected"
  | "tool"
  | "file"
  | "image"
  | "foreign"
  | "ritual"
  /** A DREAM's words (2026-09-26, `dream/`): the bundle a dreamer was shown or
   *  its hand-back, read back off a transcript. What was dreamed is not what
   *  happened; it enters nothing, and it is counted like `ritual`. */
  | "dream";

export interface Turn {
  role: "user" | "assistant";
  text: string;
  /** Absent reads as "conversation". */
  source?: TurnSource;
}

export type SpanKind = "conversation" | "assistant" | "jot";

/** One appended span. `text` is the only content; everything else is reference. */
export interface Span {
  hash: string;
  session: string;
  scope: string;
  kind: SpanKind;
  text: string;
  at: number;
  day: number;
  /** Cursor positions this span covers — [from, to) in the session's turn list. */
  from: number;
  to: number;
}

/** Every session-ending path is a boundary (contract §3, spec §2 G5). All three
 *  route through `boundary()`, and all three raise the ask. */
export type BoundaryKind = "stop" | "session-end" | "pre-compaction";
export const BOUNDARY_KINDS: readonly BoundaryKind[] = [
  "stop",
  "session-end",
  "pre-compaction",
];

export interface BoundaryRecord {
  session: string;
  scope: string;
  kind: BoundaryKind;
  at: number;
  day: number;
  /** G11's mechanized half: an ask exists at every session-ending path. */
  askRaised: boolean;
}

export interface RememberEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

/**
 * Every site that can change durable state under `spans/`. The totality test
 * asserts this list equals the set of sites that consult the observer predicate,
 * and that each one refuses under observer (contract §5 G8 — checked at the seam,
 * not only at the entry point).
 */
export const WRITE_SITES = [
  "capture",
  "jot",
  "boundary",
  "claim",
  "consume",
  "restore",
  "coverage",
  "proposal",
  "sweep",
  "failure",
  // The OWNER's strike. It is a write site like any other — an instrument that
  // has stood down may not destroy a span any more than it may append one
  // (observer-mode G3) — and it is reachable only by importing
  // `owner-strike-seam.ts`, never by holding a `SpanBuffer` (§5 G2's shape,
  // borrowed from `store/owner-op-seam.ts`).
  "strike",
  // The mark that a session which ended owing a write-up has been written up
  // after the fact (the next-session write-up, roadmap C2). It closes that
  // session's debt and starts its retention clock — a deletion on a seven-day
  // fuse — so it is reachable only by importing `write-up-seam.ts`, never by
  // holding a `SpanBuffer` (PR #189 re-review, R1).
  "writeup",
] as const;
export type WriteSite = (typeof WRITE_SITES)[number];

export type CaptureReason =
  | "APPENDED"
  | "OBSERVER"
  | "NOTHING_NEW"
  | "ALL_EXCLUDED"
  | "DEDUPED"
  | "IO_FAILED";

export interface CaptureResult {
  captured: boolean;
  reason: CaptureReason;
  spans: Span[];
  /** Layer-2 hits: content already held. Bounded duplication is acceptable; loss is not. */
  deduped: number;
  /** Turns dropped as non-conversational (the declared blind spot). */
  excluded: number;
  cursorBefore: number;
  cursorAfter: number;
}

export interface Claim {
  id: string;
  scope: string;
  path: string;
  spans: Span[];
  bytes: number;
  /** Claim files from crashed runs that merged into this one (spec §2 G6). */
  mergedOrphans: string[];
}

export type ClaimRefusal =
  | "OBSERVER"
  | "EMPTY"
  | "BELOW_MIN_CLAIM"
  | "IO_FAILED";

export type ClaimOutcome =
  | { claimed: true; claim: Claim }
  | { claimed: false; reason: ClaimRefusal; bytes: number };

export interface CoverageMark {
  spanHash: string;
  proposalId: string;
  session: string;
  at: number;
  /** True for the proposal's OWN span, which is withheld from the sweep outright
   *  (§4.1 G4) rather than merely marked. */
  own: boolean;
}

/** A session written up after it ended — the mark that closes what it owed.
 *  Written only by `write-up-seam.ts`. */
export interface WriteUpRecord {
  session: string;
  at: number;
  /** Who wrote it up: one of `write-up-seam.ts#WRITE_UP_BY`, never free text. */
  by: string;
}

/** One recorded interpretation failure. The hash is the buffer's own span hash —
 *  the identifier that already lives in `consumed.jsonl` — and never the text. */
export interface FailureRecord {
  hash: string;
  at: number;
  /** The LIVED day of the failure (scar E8). The bound counts distinct days, not
   *  attempts: three Stop hooks inside one API outage are one day's failure. */
  day: number;
  /** The chunk's failure code, or its `ChunkReason` when it carried none. */
  code: string;
}

/** What `noteFailures()` decided about a batch of failed spans. */
export interface FailureOutcome {
  /** Still under the bound: these go back to the buffer and are retried. */
  retry: Span[];
  /** At the bound: written to `quarantine.jsonl` IN FULL and never restored. */
  quarantined: Span[];
}

export interface CoverageReport {
  scope: string;
  spans: number;
  covered: number;
  uncovered: number;
  /** Spans captured after the last session-ending boundary — the stretch nobody
   *  can be asked about. Bounded and reported, never pretended away (G12). */
  unaskableSpans: number;
  unaskableBytes: number;
  lastBoundaryAt: number | null;
  /** Spans that left the buffer at the retry bound. They are NOT in `spans`, and
   *  counting them here is the point: a span the sweep gave up on is a number the
   *  owner can see, never a silent absence (scar §2.4). The text is in
   *  `quarantine.jsonl`. */
  quarantined: number;
}

export interface BufferOptions extends Stance {
  /** Defaults to `dataDir()` — resolved at call time, so tests redirect via env. */
  dir?: string;
  now?: () => number;
  /** The lived day (active-day clock, scar E8). Days, never calendar timestamps. */
  day?: () => number;
  minClaimBytes?: number;
  staleClaimMs?: number;
  /** How long a session must be silent before the fallback may call it crashed
   *  (TUNABLES.CRASH_STALE_MS). Nothing to do with `staleClaimMs`. */
  crashStaleMs?: number;
  consumedLedgerMax?: number;
  maxSpanFailures?: number;
  onEvent?: (event: RememberEvent) => void;
}

const EVENT_RING = 500;

// ── the buffer ───────────────────────────────────────────────────────────────

export class SpanBuffer {
  readonly dir: string;
  readonly root: string;
  readonly observer: boolean;
  readonly minClaimBytes: number;
  readonly staleClaimMs: number;
  readonly crashStaleMs: number;
  readonly consumedLedgerMax: number;
  readonly maxSpanFailures: number;
  private readonly nowFn: () => number;
  private readonly dayFn: () => number;
  private readonly onEvent: ((e: RememberEvent) => void) | undefined;
  private readonly ring: RememberEvent[] = [];

  constructor(opts: BufferOptions = {}) {
    this.dir = opts.dir ?? dataDir();
    this.root = join(this.dir, "spans");
    this.observer = isObserver(opts);
    this.minClaimBytes = opts.minClaimBytes ?? TUNABLES.MIN_CLAIM_BYTES;
    this.staleClaimMs = opts.staleClaimMs ?? TUNABLES.STALE_CLAIM_MS;
    this.crashStaleMs = opts.crashStaleMs ?? TUNABLES.CRASH_STALE_MS;
    this.consumedLedgerMax = opts.consumedLedgerMax ?? TUNABLES.CONSUMED_LEDGER_MAX;
    this.maxSpanFailures = opts.maxSpanFailures ?? TUNABLES.MAX_SPAN_FAILURES;
    this.nowFn = opts.now ?? (() => Date.now());
    this.dayFn = opts.day ?? (() => 0);
    this.onEvent = opts.onEvent;
    // The destruction capability, handed over at construction the way `Store`
    // hands `owner-op-seam.ts` its own: holding a buffer does not let you strike
    // a span; importing the seam does, and a test pins who may import it.
    const access = {
      observer: this.observer,
      scopes: () => this.scopes(),
      scopeDir: (scope: string) => this.scopeDir(scope),
      path: (scope: string, name: string) => this.path(scope, name),
      claimFiles: (scope: string) => this.claimFiles(scope),
      streamPath: (scope: string, kind: SpanKind) => this.streamPath(scope, kind),
      ensureScope: (scope: string) => this.ensureScope(scope),
      readLines: <T>(file: string) => this.readLines<T>(file),
      mutate: <T>(site: WriteSite, fn: () => T) => this.mutate(site, fn),
      emit: (name: string, ref?: string, data?: Record<string, string | number | boolean | null>) =>
        this.emit(name, ref, data),
      now: () => this.nowFn(),
      day: () => this.dayFn(),
      trimLedger: (file: string) => this.trimLedger(file),
    };
    grantSpanStrike(this, access);
    // The write-up mark gets the same closures MINUS `ensureScope`: it may never
    // add a scope (re-review R1). Not even present at runtime.
    const { ensureScope: _ensure, day: _day, trimLedger: _trim, ...writeUpAccess } = access;
    grantWriteUp(this, writeUpAccess);
  }

  now(): number {
    return this.nowFn();
  }

  day(): number {
    return this.dayFn();
  }

  // ── the seam ───────────────────────────────────────────────────────────────

  /**
   * The one place a span-side write happens. Stance first, work second — the same
   * ordering the store seam uses, for the same reason: an instrument refuses before
   * it has staged a byte, and a future caller inherits the refusal (§5 G8).
   *
   * It returns a discriminated result rather than throwing, because every caller
   * on the capture path is forbidden to throw into the host (§5 G2).
   */
  private mutate<T>(site: WriteSite, fn: () => T): { ok: true; value: T } | { ok: false; reason: "OBSERVER" | "IO_FAILED"; code: string } {
    if (this.observer) {
      this.emit("remember.observer.standdown", undefined, { site });
      return { ok: false, reason: "OBSERVER", code: "OBSERVER" };
    }
    try {
      return { ok: true, value: fn() };
    } catch (err) {
      const code = errCode(err);
      this.emit("remember.write.failed", undefined, { site, code });
      return { ok: false, reason: "IO_FAILED", code };
    }
  }

  emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const event: RememberEvent = { at: this.nowFn(), name };
    if (ref !== undefined) event.ref = ref;
    if (data !== undefined) event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(event);
  }

  events(name?: string): RememberEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  // ── capture ────────────────────────────────────────────────────────────────

  /**
   * A turn boundary: append what is new since this session's cursor, then advance.
   *
   * Synchronous by construction — a boundary is an appender, not a thinker, and a
   * `Promise` return type here would be the first crack in that (G1). Failures are
   * logged and swallowed; the cursor stays put so the next boundary re-reads (G2).
   */
  capture(input: { session: string; scope: string; turns: readonly Turn[] }): CaptureResult {
    try {
      return this.captureInner(input);
    } catch (err) {
      // The outermost swallow. Nothing below is allowed to reach the host (G2).
      const code = errCode(err);
      this.emit("remember.capture.failed", undefined, { code });
      return {
        captured: false,
        reason: "IO_FAILED",
        spans: [],
        deduped: 0,
        excluded: 0,
        cursorBefore: 0,
        cursorAfter: 0,
      };
    }
  }

  private captureInner(input: {
    session: string;
    scope: string;
    turns: readonly Turn[];
  }): CaptureResult {
    const cursorBefore = this.cursor(input.scope, input.session);
    const empty = (reason: CaptureReason, cursorAfter = cursorBefore): CaptureResult => ({
      captured: false,
      reason,
      spans: [],
      deduped: 0,
      excluded: 0,
      cursorBefore,
      cursorAfter,
    });

    if (this.observer) {
      this.emit("remember.observer.standdown", undefined, { site: "capture" });
      return empty("OBSERVER");
    }

    const slice = input.turns.slice(cursorBefore);
    if (slice.length === 0) return empty("NOTHING_NEW");

    const kept = slice.filter((t) => enters(t));
    const excluded = slice.length - kept.length;
    if (kept.length === 0) {
      // Nothing conversational happened: still advance, or the same tool output is
      // re-scanned forever. Nothing durable was skipped — it was never eligible.
      const advanced = this.mutate("capture", () =>
        this.writeCursor(input.scope, input.session, input.turns.length),
      );
      const out = empty(advanced.ok ? "ALL_EXCLUDED" : "IO_FAILED", advanced.ok ? input.turns.length : cursorBefore);
      out.excluded = excluded;
      return out;
    }

    const at = this.nowFn();
    const day = this.dayFn();
    const drafts: Span[] = [];
    for (const kind of ["conversation", "assistant"] as const) {
      const text = kept
        .filter((t) => (kind === "assistant" ? t.role === "assistant" : t.role !== "assistant"))
        .map((t) => t.text)
        .join("\n\n");
      if (text.trim().length === 0) continue;
      drafts.push({
        hash: hashText(text),
        session: input.session,
        scope: input.scope,
        kind,
        text,
        at,
        day,
        from: cursorBefore,
        to: input.turns.length,
      });
    }

    const seen = this.seenHashes(input.scope);
    const fresh = drafts.filter((s) => !seen.has(s.hash));
    const deduped = drafts.length - fresh.length;

    const written = this.mutate("capture", () => {
      this.ensureScope(input.scope);
      // Append FIRST. If the cursor write then fails, the hash is already in the
      // buffer, so the next boundary's layer-2 catches the repeat (G3's pairing).
      for (const span of fresh) {
        appendFileSync(this.streamPath(span.scope, span.kind), `${JSON.stringify(span)}\n`, "utf8");
      }
      this.writeCursor(input.scope, input.session, input.turns.length);
      return fresh;
    });

    if (!written.ok) {
      const out = empty("IO_FAILED");
      out.excluded = excluded;
      out.deduped = deduped;
      return out;
    }

    for (const span of fresh) {
      this.emit("remember.span.appended", span.hash, {
        session: span.session,
        kind: span.kind,
        bytes: span.text.length,
        day: span.day,
      });
    }
    if (deduped > 0) {
      this.emit("remember.span.deduped", undefined, { scope: keyFor(input.scope), count: deduped });
    }
    return {
      captured: fresh.length > 0,
      reason: fresh.length > 0 ? "APPENDED" : "DEDUPED",
      spans: fresh,
      deduped,
      excluded,
      cursorBefore,
      cursorAfter: input.turns.length,
    };
  }

  /**
   * An in-the-moment jot. It rides in the buffer with ordinary spans (uniform
   * ordering, claim and dedup semantics — CONTRACT open question 3, answered the
   * simple way in NOTES §4) and carries no cursor movement of its own.
   */
  jot(input: { session: string; scope: string; text: string }): CaptureResult {
    const cursorBefore = this.cursor(input.scope, input.session);
    const base: CaptureResult = {
      captured: false,
      reason: "APPENDED",
      spans: [],
      deduped: 0,
      excluded: 0,
      cursorBefore,
      cursorAfter: cursorBefore,
    };
    if (this.observer) {
      this.emit("remember.observer.standdown", undefined, { site: "jot" });
      return { ...base, reason: "OBSERVER" };
    }
    if (input.text.trim().length === 0) return { ...base, reason: "NOTHING_NEW" };

    const span: Span = {
      hash: hashText(input.text),
      session: input.session,
      scope: input.scope,
      kind: "jot",
      text: input.text,
      at: this.nowFn(),
      day: this.dayFn(),
      from: cursorBefore,
      to: cursorBefore,
    };
    if (this.seenHashes(input.scope).has(span.hash)) {
      this.emit("remember.span.deduped", span.hash, { scope: keyFor(input.scope), count: 1 });
      return { ...base, reason: "DEDUPED", deduped: 1 };
    }
    const written = this.mutate("jot", () => {
      this.ensureScope(span.scope);
      appendFileSync(this.streamPath(span.scope, "jot"), `${JSON.stringify(span)}\n`, "utf8");
    });
    if (!written.ok) return { ...base, reason: "IO_FAILED" };
    this.emit("remember.span.appended", span.hash, {
      session: span.session,
      kind: "jot",
      bytes: span.text.length,
      day: span.day,
    });
    return { ...base, captured: true, reason: "APPENDED", spans: [span] };
  }

  /**
   * A session-ending boundary. All three kinds route through here, and all three
   * raise the ask — compaction destroying the transcript must not destroy the day
   * (§3, spec §2 G5). The ask's WORDING is advisory (G11 [A]); that an ask exists
   * at every one of these paths is what is mechanized.
   */
  boundary(input: { session: string; scope: string; kind: BoundaryKind }): BoundaryRecord {
    const record: BoundaryRecord = {
      session: input.session,
      scope: input.scope,
      kind: input.kind,
      at: this.nowFn(),
      day: this.dayFn(),
      askRaised: !this.observer,
    };
    const written = this.mutate("boundary", () => {
      this.ensureScope(input.scope);
      appendFileSync(
        this.path(input.scope, "boundaries.jsonl"),
        `${JSON.stringify(record)}\n`,
        "utf8",
      );
    });
    if (written.ok) {
      this.emit("remember.boundary", input.session, { kind: input.kind, ask: record.askRaised });
    }
    return record;
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /** Turns already captured for this session IN THIS SCOPE. Per-(scope, session)
   *  file: two concurrent boundaries cannot drop each other's advance (spec §2
   *  G4 — v1's shared map), and the same session id running under two scopes
   *  cannot starve one of them (the PR-1 review's blocker 2: a session-only
   *  cursor made scope B read scope A's advance as NOTHING_NEW — 11 real-corpus
   *  session ids appear under more than one scope). */
  cursor(scope: string, session: string): number {
    const file = join(this.root, "cursors", `${keyFor(scope)}.${keyFor(session)}.json`);
    if (!existsSync(file)) return 0;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      const value = (parsed as { turns?: unknown }).turns;
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    } catch {
      // An unreadable cursor reads as 0: re-capture (deduped by hash) beats loss.
      this.emit("remember.cursor.unreadable", undefined, {
        scope: keyFor(scope),
        session: keyFor(session),
      });
      return 0;
    }
  }

  /** Live spans awaiting a claim: conversational plus jots, in append order. */
  spans(scope: string): Span[] {
    return [
      ...this.readSpans(this.streamPath(scope, "conversation")),
      ...this.readSpans(this.streamPath(scope, "jot")),
      // Stable sort on `at` alone: within one millisecond, APPEND ORDER is the
      // truth, and a hash tiebreak would shuffle a session's own sequence.
    ].sort((a, b) => a.at - b.at);
  }

  /** The assistant's own turns, kept SEPARATELY — the substrate for "was a
   *  surfaced memory actually used?" They are never claimed and never swept. */
  assistantSpans(scope: string): Span[] {
    return this.readSpans(this.streamPath(scope, "assistant"));
  }

  boundaries(scope: string): BoundaryRecord[] {
    return this.readLines<BoundaryRecord>(this.path(scope, "boundaries.jsonl"));
  }

  /** Spans held in CLAIM FILES right now — a sweep in flight, or a crashed
   *  run's orphans. Read-only; `retention.ts` counts them as text a session
   *  still holds, so nothing in flight can make a session look empty. */
  claimedSpans(scope: string): Span[] {
    return this.claimFiles(scope).flatMap((file) => this.readSpans(file));
  }

  /** Write-up marks recorded for this scope (`write-up-seam.ts` writes them). */
  writeUps(scope: string): WriteUpRecord[] {
    return this.readLines<WriteUpRecord>(this.path(scope, "writeups.jsonl")).filter(
      (r) => typeof r.session === "string" && typeof r.at === "number",
    );
  }

  /**
   * THE MECHANICAL DEFINITION OF "CRASHED" (owner ruling 2026-09-04, adapter
   * CONTRACT open question 3). A session is crashed when all three hold:
   *
   *   1. it has recorded NO `session-end` boundary — an author who reached the
   *      host's own end-of-session path got the pen, and what it chose not to
   *      write is forgotten by design (constitution 3);
   *   2. it has had NO boundary activity for `crashStaleMs` — silence is the
   *      only crash signal this host offers, since an abrupt exit looks exactly
   *      like an ordinary one at the hook seam;
   *   3. it holds uncovered spans — the third clause, checked by
   *      `crashedPending()` below, because a session that crashed months ago
   *      and was already swept must not keep the sweep claiming forever.
   *
   * A session with no boundary at all is not here either: nothing has ended, and
   * its author may still get the pen. Note what falls out of (1): a
   * `pre-compaction` boundary is NOT a session end, so a session that compacted
   * and then went silent past the window IS crashed — the compaction-amnesia
   * case is recovered by the silence, never by the compaction event itself.
   */
  crashedSessions(scope: string, opts: { staleMs?: number } = {}): Set<string> {
    const staleMs = opts.staleMs ?? this.crashStaleMs;
    const now = this.nowFn();
    const lastAt = new Map<string, number>();
    const endedNormally = new Set<string>();
    for (const b of this.boundaries(scope)) {
      if (typeof b.session !== "string") continue;
      const at = typeof b.at === "number" ? b.at : 0;
      lastAt.set(b.session, Math.max(lastAt.get(b.session) ?? 0, at));
      if (b.kind === "session-end") endedNormally.add(b.session);
    }
    const crashed = new Set<string>();
    for (const [session, at] of lastAt) {
      if (endedNormally.has(session)) continue;
      if (now - at >= staleMs) crashed.add(session);
    }
    return crashed;
  }

  /**
   * The sweep's eligibility test, answered BEFORE any claim: which sessions are
   * crashed, how many spans they left behind, and how many of those nobody
   * authored.
   *
   * Pre-claim on purpose. A scope with nothing crashed must cost no rename, no
   * restore and no consume — and, more importantly, its record must read
   * "nothing crashed" rather than "claimed and found nothing already authored",
   * or the daily cannot tell a quiet sweep from a broken one (constitution 16).
   *
   * TWO NUMBERS, because they gate two different things. `spans` decides whether
   * the sweep looks at this scope at all; `uncovered` is what a model call would
   * ever be spent on. A crashed session whose spans were ALL authored is still
   * worth claiming — it retires them without a call (the `NOTHING_UNCLAIMED`
   * path) — and if it were not claimed, its spans would sit in the buffer for
   * good.
   *
   * Spans held in CLAIM FILES count: a worker that died mid-arc left its spans
   * there, and `claim()` merges those back in past the staleness window. Without
   * them, a crashed run's orphans could be stranded by this very gate.
   */
  crashedPending(scope: string, opts: { staleMs?: number } = {}): {
    sessions: Set<string>;
    spans: number;
    uncovered: number;
  } {
    const sessions = this.crashedSessions(scope, opts);
    if (sessions.size === 0) return { sessions, spans: 0, uncovered: 0 };
    const covered = this.coveredHashes(scope);
    const seen = new Set<string>();
    let spans = 0;
    let uncovered = 0;
    const consider = (span: Span): void => {
      if (!sessions.has(span.session)) return;
      if (seen.has(span.hash)) return;
      seen.add(span.hash);
      spans += 1;
      if (!covered.has(span.hash)) uncovered += 1;
    };
    for (const span of this.spans(scope)) consider(span);
    for (const file of this.claimFiles(scope)) {
      for (const span of this.readSpans(file)) consider(span);
    }
    return { sessions, spans, uncovered };
  }

  coverage(scope: string): CoverageMark[] {
    return this.readLines<CoverageMark>(this.path(scope, "coverage.jsonl"));
  }

  coveredHashes(scope: string): Set<string> {
    return new Set(this.coverage(scope).map((c) => c.spanHash));
  }

  /** Hashes withheld from the sweep OUTRIGHT: a proposal's own span, whose
   *  re-encoding is guaranteed duplication (§4.1 G4). */
  withheldHashes(scope: string): Set<string> {
    return new Set(this.coverage(scope).filter((c) => c.own).map((c) => c.spanHash));
  }

  /**
   * Dedup layer 2's full extent: everything this scope currently holds, everything
   * a live claim holds, and the bounded tail of what was already consumed. The
   * consumed ledger is what closes the crash window between "hashes recorded" and
   * "claim file removed" — a replayed orphan dedups away instead of re-entering.
   */
  seenHashes(scope: string): Set<string> {
    const seen = new Set<string>();
    for (const s of this.spans(scope)) seen.add(s.hash);
    for (const s of this.assistantSpans(scope)) seen.add(s.hash);
    for (const file of this.claimFiles(scope)) {
      for (const s of this.readSpans(file)) seen.add(s.hash);
    }
    for (const line of this.readLines<{ hash: string }>(this.path(scope, "consumed.jsonl"))) {
      seen.add(line.hash);
    }
    return seen;
  }

  /** Every scope holding experience — the all-scopes sweep's input (spec §2 G9):
   *  a project never revisited would otherwise keep captured spans forever. */
  scopes(): string[] {
    const legend = this.legend();
    return [...legend.values()].sort();
  }

  /**
   * Coverage measured, not assumed (G12). The unaskable stretch — spans captured
   * after the last session-ending boundary, which nobody can be asked about — is
   * bounded and reported rather than pretended away.
   */
  coverageReport(scope: string): CoverageReport {
    const spans = this.spans(scope);
    const covered = this.coveredHashes(scope);
    const bounds = this.boundaries(scope);
    const last = bounds.length > 0 ? Math.max(...bounds.map((b) => b.at)) : null;
    const tail = last === null ? spans : spans.filter((s) => s.at > last);
    const report: CoverageReport = {
      scope,
      spans: spans.length,
      covered: spans.filter((s) => covered.has(s.hash)).length,
      uncovered: spans.filter((s) => !covered.has(s.hash)).length,
      unaskableSpans: tail.length,
      unaskableBytes: tail.reduce((n, s) => n + s.text.length, 0),
      lastBoundaryAt: last,
      quarantined: this.quarantined(scope).length,
    };
    this.emit("remember.coverage.measured", keyFor(scope), {
      spans: report.spans,
      covered: report.covered,
      uncovered: report.uncovered,
      unaskableSpans: report.unaskableSpans,
      unaskableBytes: report.unaskableBytes,
      quarantined: report.quarantined,
    });
    return report;
  }

  // ── the retry bound ────────────────────────────────────────────────────────

  /** Failures recorded per span hash. History, not state: a span that later
   *  succeeds keeps its lines and is consumed normally. */
  /**
   * Failures per span hash, counted as DISTINCT LIVED DAYS (PR-8 review): a
   * poison pill fails every day it is tried; an outage fails every attempt of
   * one day. Only the first shape should ever reach the bound. A line with no
   * day (none exist in production; the field arrived with the cadence rule)
   * counts as its own day, the conservative direction for an old ledger.
   */
  failureCounts(scope: string): Map<string, number> {
    const days = new Map<string, Set<number>>();
    for (const line of this.readLines<FailureRecord>(this.path(scope, "failures.jsonl"))) {
      if (typeof line.hash !== "string") continue;
      const set = days.get(line.hash) ?? new Set<number>();
      set.add(typeof line.day === "number" ? line.day : -1 - set.size);
      days.set(line.hash, set);
    }
    return new Map([...days.entries()].map(([hash, set]) => [hash, set.size]));
  }

  /** Spans the sweep gave up on, in full. The sweep never drops them: this file
   *  is the owner's copy, readable in any editor (constitution line 16), until
   *  RETENTION ages a line out — 7 days after its session ended, and only when
   *  that session owes no write-up (`retention.ts`). */
  quarantined(scope: string): Span[] {
    return this.readSpans(this.path(scope, "quarantine.jsonl"));
  }

  /**
   * Record one interpretation failure per span, and decide which of them may go
   * back. A span that has now failed `maxSpanFailures` times is QUARANTINED — its
   * full line appended to `quarantine.jsonl`, and never restored — so a
   * permanently-failing span costs a bounded number of model calls instead of one
   * per boundary forever (replay-review 2026-08-26 follow-up; the P0 fix traded
   * silent loss for indefinite retry, and this is the other half of that trade).
   *
   * Only a FAILURE calls this. A restore that is merely a deferral — scraps under
   * `MIN_CLAIM_BYTES` riding to the next boundary, spans of a session still
   * running — touches no ledger and is never a step toward quarantine.
   *
   * Every failure mode here fails toward RETRY: if the ledger or the quarantine
   * write does not land, nothing is quarantined and every span goes back. A
   * retry costs a call; a drop costs the day.
   */
  noteFailures(scope: string, spans: readonly Span[], code: string): FailureOutcome {
    if (spans.length === 0) return { retry: [], quarantined: [] };
    const counts = this.failureCounts(scope);
    const day = this.dayFn();
    // Today's failures, per hash — a second failure on the SAME lived day does
    // not move the count (the outage rule), so the pre-read set decides.
    const failedToday = new Set(
      this.readLines<FailureRecord>(this.path(scope, "failures.jsonl"))
        .filter((l) => typeof l.hash === "string" && l.day === day)
        .map((l) => l.hash),
    );
    const at = this.nowFn();
    const retry: Span[] = [];
    const quarantined: Span[] = [];
    for (const span of spans) {
      const n = (counts.get(span.hash) ?? 0) + (failedToday.has(span.hash) ? 0 : 1);
      counts.set(span.hash, n);
      if (n >= this.maxSpanFailures) quarantined.push(span);
      else retry.push(span);
    }

    const out = this.mutate("failure", () => {
      this.ensureScope(scope);
      const file = this.path(scope, "failures.jsonl");
      const lines = spans.map((s) => JSON.stringify({ hash: s.hash, at, day, code } satisfies FailureRecord));
      appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
      // Bounded exactly like the consumed ledger, and for the same reason: this is
      // bookkeeping, not canonical memory. A trim can drop old failures and so
      // reset a count — which spends a few more calls, never loses a span.
      this.trimLedger(file);
      if (quarantined.length > 0) {
        // ONE append: a half-written batch would put a span in quarantine AND
        // back in the buffer. Bounded duplication is the acceptable failure.
        appendFileSync(
          this.path(scope, "quarantine.jsonl"),
          `${quarantined.map((s) => JSON.stringify(s)).join("\n")}\n`,
          "utf8",
        );
      }
    });
    if (!out.ok) return { retry: [...spans], quarantined: [] };

    if (quarantined.length > 0) {
      // Counts and a code, never text — and never the hash of text either: hashing
      // low-entropy content leaks it. (The hash inside `failures.jsonl` is the
      // buffer's own span hash, which already lives in `consumed.jsonl`.)
      this.emit("remember.span.quarantined", undefined, {
        scope: keyFor(scope),
        spans: quarantined.length,
        code,
      });
    }
    return { retry, quarantined };
  }

  // ── claim / consume / restore ──────────────────────────────────────────────

  /**
   * Rename the live buffer ASIDE. Not a mutex: a concurrent append lands in a
   * fresh `buffer.jsonl` and cannot be destroyed by the claim (spec §2 G6).
   * Leftovers from crashed runs — claim files older than the staleness window —
   * merge in, deduped by hash against this claim AND the consumed ledger.
   */
  claim(scope: string, opts: { minBytes?: number; staleClaimMs?: number } = {}): ClaimOutcome {
    if (this.observer) {
      this.emit("remember.observer.standdown", undefined, { site: "claim" });
      return { claimed: false, reason: "OBSERVER", bytes: 0 };
    }
    const minBytes = opts.minBytes ?? this.minClaimBytes;
    const staleMs = opts.staleClaimMs ?? this.staleClaimMs;
    const id = `clm_${randomBytes(6).toString("hex")}`;
    const claimPath = join(this.claimsDir(scope), `${id}.jsonl`);

    const staged = this.mutate("claim", () => {
      this.ensureScope(scope);
      mkdirSync(this.claimsDir(scope), { recursive: true });
      const live = this.streamPath(scope, "conversation");
      const jots = this.streamPath(scope, "jot");
      let any = false;
      if (existsSync(live)) {
        renameSync(live, claimPath);
        any = true;
      }
      if (existsSync(jots)) {
        // Jots ride with the spans; a second rename would clobber the first, so
        // they are appended into the claim and their file renamed aside first.
        // The aside keeps the `.jsonl` suffix and lives in `claims/` ON PURPOSE:
        // a crash between the rename and the rm must leave an ORDINARY orphan
        // that a later claim can merge, or those spans would be in neither
        // claim nor buffer — the one state spec §2 G6 forbids.
        const aside = join(this.claimsDir(scope), `${id}.jots.jsonl`);
        renameSync(jots, aside);
        appendFileSync(claimPath, readFileSync(aside, "utf8"), "utf8");
        rmSync(aside, { force: true });
        any = true;
      }
      return any;
    });
    if (!staged.ok) {
      return { claimed: false, reason: staged.reason === "OBSERVER" ? "OBSERVER" : "IO_FAILED", bytes: 0 };
    }

    const merged = this.mergeOrphans(scope, claimPath, id, staleMs);
    const spans = this.readSpans(claimPath);
    const bytes = spans.reduce((n, s) => n + s.text.length, 0);
    const claim: Claim = { id, scope, path: claimPath, spans, bytes, mergedOrphans: merged };

    if (spans.length === 0) {
      rmSync(claimPath, { force: true });
      return { claimed: false, reason: "EMPTY", bytes: 0 };
    }
    if (bytes < minBytes) {
      // Scraps ride to the next boundary (spec §2 G8) — and they ride by being
      // RESTORED, never by being dropped on the floor.
      this.restore(claim);
      this.emit("remember.claim.refused", id, { reason: "BELOW_MIN_CLAIM", bytes, minBytes });
      return { claimed: false, reason: "BELOW_MIN_CLAIM", bytes };
    }
    this.emit("remember.claim", id, {
      scope: keyFor(scope),
      spans: spans.length,
      bytes,
      mergedOrphans: merged.length,
    });
    return { claimed: true, claim };
  }

  /**
   * Truncate the claim — ONLY ever called after results are applied and persisted
   * (spec §2 G6). The hashes go into the bounded consumed ledger FIRST, so a crash
   * between the two leaves a claim whose spans dedup away rather than duplicate.
   *
   * `except` names the spans that were RESTORED rather than applied, and their
   * hashes MUST NOT enter the ledger: `restore()` dedups against it, so a
   * restored span whose hash is recorded here is un-restorable the next time
   * its chunk fails — the second failure of the same content becomes silent
   * loss. Not hypothetical: the 2026-08-26 replay destroyed a live span exactly
   * this way (docs/replay-review-2026-08-26.md, P0), and scar E6 says an outage
   * must never mean "nothing durable". The ledger records what was CONSUMED —
   * never what merely passed through a claim.
   *
   * A QUARANTINED span is the third disposition, and it is NOT excepted: it left
   * the buffer for good, its text is durable in `quarantine.jsonl`, and its hash
   * belongs in the ledger — that is what stops an identical re-capture from
   * restarting the retry loop, and what lets `mergeOrphans()` filter it out of a
   * replayed claim. Terminal, not pass-through: this is not the P0 regression.
   */
  consume(
    claim: Claim,
    opts: { except?: readonly Span[] } = {},
  ): { consumed: boolean; reason: "CONSUMED" | "OBSERVER" | "IO_FAILED" } {
    const skip = new Set((opts.except ?? []).map((s) => s.hash));
    const kept = claim.spans.filter((s) => !skip.has(s.hash));
    const out = this.mutate("consume", () => {
      this.ensureScope(claim.scope);
      if (kept.length > 0) {
        const file = this.path(claim.scope, "consumed.jsonl");
        const lines = kept.map((s) => JSON.stringify({ hash: s.hash, at: s.at }));
        appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
        this.trimLedger(file);
      }
      rmSync(claim.path, { force: true });
    });
    if (!out.ok) {
      return { consumed: false, reason: out.reason === "OBSERVER" ? "OBSERVER" : "IO_FAILED" };
    }
    this.emit("remember.claim.consumed", claim.id, {
      spans: kept.length,
      excepted: claim.spans.length - kept.length,
      // The KEPT spans' bytes — pairing the full claim's bytes with the kept
      // count would make bytes-per-span nonsense (PR-1 review nit).
      bytes: kept.reduce((n, s) => n + s.text.length, 0),
    });
    return { consumed: true, reason: "CONSUMED" };
  }

  /**
   * Put the claim's spans back where the next claim will find them. A failed
   * restore FORBIDS consuming the claim (spec §2 G7): the claim file is kept, so
   * a failed arc never lives in neither place.
   */
  restore(
    claim: Claim,
    only?: readonly Span[],
  ): { restored: boolean; reason: "RESTORED" | "OBSERVER" | "IO_FAILED"; spans: number } {
    const wanted = only ?? claim.spans;
    const out = this.mutate("restore", () => {
      this.ensureScope(claim.scope);
      const held = this.seenHashesExcludingClaim(claim);
      const back = wanted.filter((s) => !held.has(s.hash));
      for (const span of back) {
        appendFileSync(
          this.streamPath(claim.scope, span.kind === "jot" ? "jot" : "conversation"),
          `${JSON.stringify(span)}\n`,
          "utf8",
        );
      }
      return back.length;
    });
    if (!out.ok) {
      // The claim stays on disk. Its spans are still in claim-or-buffer, and the
      // next claim past the staleness window merges them back in.
      this.emit("remember.claim.restore.failed", claim.id, { spans: wanted.length });
      return { restored: false, reason: out.reason === "OBSERVER" ? "OBSERVER" : "IO_FAILED", spans: 0 };
    }
    if (only === undefined) rmSync(claim.path, { force: true });
    this.emit("remember.claim.restored", claim.id, { spans: out.value, partial: only !== undefined });
    return { restored: true, reason: "RESTORED", spans: out.value };
  }

  /**
   * The arc: commit the output or restore the input (§5 G4). A throw means the arc
   * is RETRIED, not lost — and "returned nothing" and "failed" are distinct records
   * (scar §2.4), which is why the empty case logs its own event and does not throw.
   */
  async arc<T>(
    claim: Claim,
    work: (spans: readonly Span[]) => Promise<T>,
    commit: (value: T) => void | Promise<void>,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: "RESTORED" | "RESTORE_FAILED"; code: string }> {
    let value: T;
    try {
      value = await work(claim.spans);
      await commit(value);
    } catch (err) {
      const code = errCode(err);
      const restored = this.restore(claim);
      this.emit("remember.arc.failed", claim.id, { code, restored: restored.restored });
      return {
        ok: false,
        reason: restored.restored ? "RESTORED" : "RESTORE_FAILED",
        code,
      };
    }
    this.consume(claim);
    this.emit("remember.arc.done", claim.id, { spans: claim.spans.length });
    return { ok: true, value };
  }

  // ── coverage (engine-side only) ────────────────────────────────────────────

  /**
   * The ENGINE claims coverage, never the author — the author cannot see the
   * buffer (§5 G5). Claims are sequential: each accepted proposal takes the spans
   * still uncovered in its session, so successive proposals PARTITION a session
   * instead of each claiming the backlog (§4.1 G4).
   */
  claimCoverage(input: {
    scope: string;
    session: string;
    proposalId: string;
    ownSpanHash?: string | null;
  }): CoverageMark[] {
    if (this.observer) {
      // Checked before the scan, not only at the append: an instrument does not
      // get to compute a claim it would then be refused (observer-mode.md G6).
      this.emit("remember.observer.standdown", undefined, { site: "coverage" });
      return [];
    }
    const covered = this.coveredHashes(input.scope);
    const at = this.nowFn();
    const marks: CoverageMark[] = this.spans(input.scope)
      .filter((s) => s.session === input.session && !covered.has(s.hash))
      .map((s) => ({
        spanHash: s.hash,
        proposalId: input.proposalId,
        session: input.session,
        at,
        own: input.ownSpanHash !== undefined && input.ownSpanHash !== null && s.hash === input.ownSpanHash,
      }));
    if (marks.length === 0) return [];
    const out = this.mutate("coverage", () => {
      this.ensureScope(input.scope);
      appendFileSync(
        this.path(input.scope, "coverage.jsonl"),
        `${marks.map((m) => JSON.stringify(m)).join("\n")}\n`,
        "utf8",
      );
    });
    if (!out.ok) return [];
    this.emit("remember.coverage.claimed", input.proposalId, {
      spans: marks.length,
      withheld: marks.filter((m) => m.own).length,
    });
    return marks;
  }

  /** Append one proposal record (also the content-idempotency ledger, §4.1 G9). */
  recordProposal(scope: string, record: unknown): boolean {
    const out = this.mutate("proposal", () => {
      this.ensureScope(scope);
      appendFileSync(this.path(scope, "proposals.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
    });
    return out.ok;
  }

  proposalRecords<T>(scope: string): T[] {
    return this.readLines<T>(this.path(scope, "proposals.jsonl"));
  }

  // ── paths + internals ──────────────────────────────────────────────────────

  /** Scope keys are HASHES, not the scope string: a scope is a project path, and
   *  a path pasted into `join()` escapes the data dir (NOTES §2). */
  scopeDir(scope: string): string {
    return join(this.root, keyFor(scope));
  }

  /** Pure: creates nothing. Every directory is made by `ensureScope()`, which runs
   *  only on write paths, INSIDE the seam — so a read can never throw into a host
   *  and an observer can never create a directory by looking at one. */
  path(scope: string, name: string): string {
    return join(this.scopeDir(scope), name);
  }

  private streamPath(scope: string, kind: SpanKind): string {
    const name =
      kind === "assistant" ? "assistant.jsonl" : kind === "jot" ? "jots.jsonl" : "buffer.jsonl";
    return this.path(scope, name);
  }

  private claimsDir(scope: string): string {
    return this.path(scope, "claims");
  }

  private claimFiles(scope: string): string[] {
    const dir = join(this.scopeDir(scope), "claims");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f))
      .sort();
  }

  private ensureScope(scope: string): void {
    const dir = this.scopeDir(scope);
    if (existsSync(dir)) return;
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(this.root, "cursors"), { recursive: true });
    const legend = this.legend();
    legend.set(keyFor(scope), scope);
    const file = join(this.root, "scopes.json");
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(legend), null, 2), "utf8");
    renameSync(tmp, file);
  }

  private legend(): Map<string, string> {
    const file = join(this.root, "scopes.json");
    if (!existsSync(file)) return new Map();
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
      return new Map(Object.entries(parsed));
    } catch {
      this.emit("remember.legend.unreadable", undefined, {});
      return new Map();
    }
  }

  private writeCursor(scope: string, session: string, turns: number): void {
    const dir = join(this.root, "cursors");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${keyFor(scope)}.${keyFor(session)}.json`);
    const tmp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify({ scope, session, turns }), "utf8");
    renameSync(tmp, file);
  }

  private mergeOrphans(scope: string, claimPath: string, id: string, staleMs: number): string[] {
    const merged: string[] = [];
    const now = this.nowFn();
    const held = new Set(this.readSpans(claimPath).map((s) => s.hash));
    for (const line of this.readLines<{ hash: string }>(this.path(scope, "consumed.jsonl"))) {
      held.add(line.hash);
    }
    for (const file of this.claimFiles(scope)) {
      if (file === claimPath) continue;
      let age = Infinity;
      try {
        age = now - statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (age < staleMs) continue;
      const spans = this.readSpans(file).filter((s) => !held.has(s.hash));
      try {
        if (spans.length > 0) {
          appendFileSync(claimPath, `${spans.map((s) => JSON.stringify(s)).join("\n")}\n`, "utf8");
          for (const s of spans) held.add(s.hash);
        }
        rmSync(file, { force: true });
        merged.push(file);
        this.emit("remember.claim.orphan.merged", id, { spans: spans.length, ageMs: Math.round(age) });
      } catch (err) {
        this.emit("remember.claim.orphan.failed", id, { code: errCode(err) });
      }
    }
    return merged;
  }

  private seenHashesExcludingClaim(claim: Claim): Set<string> {
    const held = new Set<string>();
    for (const s of this.spans(claim.scope)) held.add(s.hash);
    for (const file of this.claimFiles(claim.scope)) {
      if (file === claim.path) continue;
      for (const s of this.readSpans(file)) held.add(s.hash);
    }
    for (const line of this.readLines<{ hash: string }>(this.path(claim.scope, "consumed.jsonl"))) {
      held.add(line.hash);
    }
    return held;
  }

  private trimLedger(file: string): void {
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0);
    if (lines.length <= this.consumedLedgerMax) return;
    const keep = lines.slice(lines.length - this.consumedLedgerMax);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${keep.join("\n")}\n`, "utf8");
    renameSync(tmp, file);
    this.emit("remember.ledger.trimmed", undefined, {
      // WHICH ledger: two of them trim now (consumed and failures), and a count
      // with no name is a number nobody can act on.
      ledger: basename(file),
      dropped: lines.length - keep.length,
      kept: keep.length,
    });
  }

  private readSpans(file: string): Span[] {
    return this.readLines<Span>(file).filter(
      (s) => typeof s.hash === "string" && typeof s.text === "string",
    );
  }

  private readLines<T>(file: string): T[] {
    if (!existsSync(file)) return [];
    let raw = "";
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      this.emit("remember.read.failed", undefined, { code: errCode(err) });
      return [];
    }
    const out: T[] = [];
    let corrupt = 0;
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // A half-written line from a crash is skipped and COUNTED — never
        // silently, and never fatally (scar §2.4).
        corrupt += 1;
      }
    }
    if (corrupt > 0) this.emit("remember.line.corrupt", undefined, { count: corrupt });
    return out;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Tool output, file contents and images never enter capture; host-injected
 *  context does (it is conversational material the model actually saw). */
export function enters(turn: Turn): boolean {
  const source = turn.source ?? "conversation";
  // THE FOREIGN EXCLUSION, named rather than left to fall through the clause
  // below: another memory system's injection is text this store would otherwise
  // read as lived experience and encode as its own — v1's briefing coming back
  // to v2 as a memory of having thought it. `injected` is kept and merely
  // unpaced; `foreign` is refused outright.
  if (source === "foreign") return false;
  // THE RITUAL EXCLUSION, named for the same reason: this system's OWN ask,
  // handed back by a host that returns hook output into the context, is not
  // something that happened to us — it is us. Capturing it would let the ask's
  // wording become a memory of having thought it, and the ask already has a
  // durable record of its own (`adapter.authorship.ask`). Refused, and counted.
  if (source === "ritual") return false;
  // THE DREAM EXCLUSION (2026-09-26), by source AND by the mark itself, so a
  // host whose reader never learned the `dream` tag still cannot let a dream's
  // bundle or hand-back through: the sweep mints from these turns, and a dream
  // is never a lived event (`dream/mark.ts`).
  if (source === "dream" || carriesDreamMark(turn.text)) return false;
  return source === "conversation" || source === "injected";
}

/** A stable, path-safe directory key for an arbitrary scope or session string. */
export function keyFor(value: string): string {
  return hashText(value).slice(0, 12);
}

export function errCode(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "UNKNOWN";
}
