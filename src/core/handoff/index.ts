/**
 * THE HANDOFF — where the work in THIS directory stands, for the next session
 * that opens here.
 *
 * It is not a memory, and that is the whole of its design. A memory is an
 * interpretation of what was learned; a handoff is working context — "what I was
 * doing here" — which is true for a fortnight and then is not true at all. v1
 * had the same lane under the name `task-state`, expiring; the spec's §6.4 is
 * where it comes back, and the owner's words for why (§15 item 6) are that today
 * he types "prep a handoff so we can pick up from here in a new session" and
 * wants that to happen on its own.
 *
 * **Never a memory** — every clause below is a mechanism, not a promise:
 *
 *   - **Not recalled.** `recall/activate.ts` skips the row in the scan, the way
 *     it skips the self page, and `creditReferences` refuses it a use even when
 *     a session expands it by id. Nothing here ever accrues `uses` or
 *     `reinforced_days`, so `physics#promotionEligibility` — which needs
 *     reinforcement on N distinct lived days — can never be satisfied and the
 *     row can never cross into the identity band.
 *   - **Not consolidated, never identity, never in "Who I am".** `scanActive`
 *     lists `{ type: "memory" }` and this is a schema row, so no briefing lane
 *     can reach it. The pointer the wake prints is FURNITURE, like the page and
 *     the day-0 line: the lane counts and the sentinel's `elements=` are
 *     untouched by it.
 *   - **Exempt from dedup**, free, by `sleep/types.ts#isSchemaRow`: a schema row
 *     is not a duplicate candidate.
 *   - **Invisible to `schemas/`**: `toMetaRecord` returns null for any role but
 *     entity, belief and current-state, so the index build skips it.
 *   - **It is let go by the ordinary means, once it has expired.** The row is
 *     NOT `protected` — the one thing the self page is and this is not. It is
 *     born in the episodic band with nothing on any salience dimension, so it
 *     sits at the floor from birth. Since 2026-10-10 (review 03 C4b) the decay
 *     pass does not rank it and the prune does not take it WHILE IT LIVES
 *     (`sleep/types.ts#isLiveHandoffRow`): with a 14-day dwell the floor could
 *     otherwise archive a pointer a session is still revising. Once expired,
 *     `physics#pruneVerdict` archives it at the floor after its dwell, as
 *     before.
 *
 * **One live pointer per directory PER SESSION** (2026-09-30). A session writing
 * again for the same scope is an ordinary `store.revise` of ITS OWN row, so the
 * one it replaces becomes an ordinary version and the row keeps its whole chain
 * — the self page's precedent (`self/page.ts`, "ONE ROW FOR THE LIFE OF THE
 * PAGE"), chosen over an archived row because a superseded row is one more thing
 * `revise`'s readers have to find and because `pruneSupersededVersions` already
 * bounds versions at the ordinary retention. A DIFFERENT session writing in the
 * same directory mints its own row: until 2026-09-30 it revised the same one,
 * and several sessions often work in one repo at once, so the last to end
 * overwrote the others' pointers (that day, "Two builds are in flight" was
 * replaced by a session that knew nothing of either). The wake shows every live
 * one for the directory, newest first, each saying which session wrote it.
 *
 * **It expires in LIVED days** (`store.livedDay()`), not calendar days, because
 * a fortnight of holidays is not a fortnight of work. An expired handoff stops
 * being shown and stops being written over: the row is simply left to the prune.
 */
import type { LastHere, LaterHere } from "./last-here.js";
import type { MemoryStatus, ProseDoc, Store } from "../store/index.js";
import { isKnownSession, isModelId } from "../types.js";

/** The `meta.role` that makes a schema row a handoff. One per scope and session. */
export const HANDOFF_ROLE = "handoff";

/**
 * The `kind` the row carries. A handoff is about a DIRECTORY — a place of work —
 * and `kind` is the row's subject everywhere else in the store (the self page is
 * `kind: "self"`). It also keeps the recall scan's exemption cheap: the prose
 * read is gated on `type === "schema" && kind === "place"`, so only schema rows
 * about places pay for it.
 */
export const HANDOFF_KIND = "place";

/** The durable row every accepted handoff leaves. Read by `fired`. */
export const HANDOFF_WRITTEN_EVENT = "handoff.written";

/** The durable row every pointer shown at a wake leaves. Read by `fired`. */
export const HANDOFF_SHOWN_EVENT = "handoff.shown";

/**
 * The durable row every REFUSED handoff leaves, beside the accepted ones rather
 * than instead of them — owner ruling 2's corollary (2026-09-18): a cap reports
 * what it refused where the owner will see it.
 */
export const HANDOFF_REFUSED_EVENT = "handoff.refused";

/**
 * The durable row a RETIRED pointer leaves. A session that finished the work
 * says so by sending the field empty, and "there is nothing to pick up here
 * any more" is a fact about this directory worth one row.
 */
export const HANDOFF_CLEARED_EVENT = "handoff.cleared";

/**
 * THE WRITE CAP. Refused past it, never cut: what gets cut at write time is the
 * only copy (the page's rule, `self/index.ts#revisePage`). A handoff is a
 * paragraph or two about where a directory stands — 2 KB is a generous ceiling
 * for that and a small one against the page's (about 6 KB of room,
 * `self/briefing.ts#PAGE_ROOM_BYTES`, under a 16 KB write ceiling).
 */
export const HANDOFF_MAX_BYTES = 2048;

/** The excerpt's cap in the pointer line. The body is never shown whole at a
 *  wake; the id is the door to the whole of it. */
export const HANDOFF_EXCERPT_BYTES = 160;

/**
 * THE CEILING ON THE RESERVE, in bytes. It is a CEILING and not the reserve: see
 * `reserveBytes`. Since WK1 (2026-10-30) a block can pass it, with many live
 * handoffs a line each: what the reserve cannot cover gives way at delivery
 * (`standsLadder`). Until then it was the widest block this module could produce:
 *
 * 448 while a directory held one pointer. Since 2026-09-30 the widest block is
 * the several-handoff one — three shown in full at full-width excerpts, the
 * widest model id `isModelId` admits, five more named by id — measured at 1,389
 * (1,319 before the door line named `retireHandoff`, review of #295), and
 * 1,431 since the newest says how far its work since is written up
 * (2026-09-30), and 1,646 since each says why it may be out of date — an
 * older release wrote it, or a newer chapter was written here (2026-10-01).
 * 1,963 since a "since" line can follow it (2026-10-09): three plans at the
 * title cap and a count, 317 bytes on the widest block (1,646). 1,946 since
 * each says its staleness as one sentence and the newest no longer counts the
 * work since it (2026-10-18, the wake-polish builder). 1,949 since that
 * sentence is two clauses (2026-10-25: a byte longer at its widest, each of three).
 * In practice the share rule binds first: at the 9,000 bytes the owner's hosts
 * report, no reserve can pass 1,125, so a block that wide is carried with two
 * shown rather than three.
 */
export const HANDOFF_RESERVE_MAX_BYTES = 1949;

/**
 * Slack on top of the block that actually exists, so a reserve taken at one
 * boundary still covers the block delivered at the next wake. Only two things
 * move between them — the days-left number gains or loses a digit, and a
 * cleared-then-rewritten pointer changes length — and the second is bounded by
 * the reserve's own ceiling.
 */
export const HANDOFF_RESERVE_MARGIN_BYTES = 48;

/**
 * THE SHARE RULE — the reserve is taken only when the budget is at least this
 * many times the reserve.
 *
 * The adversarial review measured what the flat 448-byte reserve cost
 * (MAJOR-1): at a 1,200-byte ceiling a session in a directory with NO handoff
 * lost 4 of its 6 identity elements, at 2,000 it lost 4 of 13, at 3,000 five of
 * 23 — because the reserve is store-wide and the bundle is one. At the budget
 * the parallel run uses (9,000) the lane caps bind first and the cost is zero.
 *
 * A pointer is a fortnight of working context. It is not worth a third of a
 * small wake's memories, and on a ceiling that tight the honest answer is to
 * carry no pointer at all — which is what returning 0 does: nothing is
 * reserved, nothing is trimmed, and the splice at delivery simply finds no room
 * and drops the pointer whole. Eight is chosen so that the reserve can never
 * cost more than an eighth of the bundle, which at the measured block size
 * turned the reserve on from about 2,400 bytes up — about 3,000 since the
 * pointer says how current it is (2026-09-30), whose widest words the reserve
 * is sized to, and about 3,650 since the pointer says who left it and how to
 * retire it (about 3,900 when it names a session and a model).
 *
 * One comparison, not a second budgeter: nothing here decides what to trim.
 */
export const HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE = 8;

/**
 * THE ROOM THE POINTER TAKES IN THE WAKE — what `Counterpart` subtracts from the
 * compose budget at a boundary, beside `PREFACE_RESERVE_BYTES`.
 *
 * Three properties, in the order they matter:
 *
 *   1. **No live handoff anywhere ⇒ zero.** That is what makes a store with no
 *      handoff compose the wake it composed before this module existed, byte
 *      for byte.
 *   2. **Sized to the block that EXISTS**, not to the widest one that could. The
 *      review measured 295 bytes of ceiling left unused at budget 2,000 — five
 *      memories spent to buy two lines and a third of a kilobyte of nothing.
 *      The boundary already knows which handoffs are live and what their
 *      pointers say, so it can ask.
 *   3. **Off entirely below the share rule**, because the reserve is store-wide
 *      and the bundle is one: a directory that will never be shown a pointer
 *      pays for it otherwise, and on a small ceiling it pays in memories.
 *
 * Since 2026-09-30 a directory can hold several handoffs, and the caller
 * passes every block a delivery might splice — for such a directory, each
 * rung of its ladder (three shown, two, one, the newest alone). The reserve
 * is the WIDEST of them the share rule allows, so a ceiling too small for
 * three still reserves for one, and several handoffs can never take more than
 * the eighth one could. With one block per directory this is the rule as it
 * was, with one difference: a narrow block in one directory is reserved for
 * even when a wider one elsewhere fails the share, where before the wider one
 * turned the reserve off for both.
 *
 * Pure. The caller passes the candidate blocks' byte lengths and its ceiling.
 */
export function reserveBytes(blockBytes: readonly number[], budgetBytes: number): number {
  let best = 0;
  for (const b of blockBytes) {
    if (b <= 0) continue;
    const want = Math.min(b + HANDOFF_RESERVE_MARGIN_BYTES, HANDOFF_RESERVE_MAX_BYTES);
    if (want * HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE <= budgetBytes && want > best) best = want;
  }
  return best;
}

/**
 * How long a pointer shows, in LIVED days since it was written. About a
 * fortnight of use (spec §15 item 6). After it the pointer stops showing; the
 * row is then let go by the ordinary prune, which is the only forgetting this
 * module has.
 */
export const HANDOFF_LIFE_DAYS = 14;

/** Prose meta the row keeps beside its body. */
export const HANDOFF_META_SCOPE = "scope";
export const HANDOFF_META_WRITTEN_ON = "writtenOn";
export const HANDOFF_META_WRITTEN_DAY = "writtenDay";
export const HANDOFF_META_SESSION = "session";
/** The model the writing session was answering with, when the host said
 *  (`sessions.ts#SessionRecord.model`); absent on a row written before
 *  2026-09-30 or by a caller that knew none. */
export const HANDOFF_META_MODEL = "model";
/** Epoch ms of the write, from this module's clock — what "newest first"
 *  ranks by within a lived day. Absent on a row written before 2026-09-30,
 *  which then ranks by its lived day and falls back to its `handoff.written`
 *  row for the time it prints. */
export const HANDOFF_META_WRITTEN_AT = "writtenAt";
/**
 * The Counterparts version the writing process was running (2026-10-01), so
 * the wake can say a handoff was "written on 0.3.9, 0.3.10 now" (`staleWords`).
 * Absent on a row written before then, which falls back to the version the
 * writing session OPENED with, from the host's registry (`WakeHere`).
 */
export const HANDOFF_META_BUILD = "build";
/** The longest version string the wake prints; a longer one is not printed. */
export const HANDOFF_VERSION_MAX_CHARS = 16;

/**
 * HOW MANY LINES OF THE NEWEST HANDOFF A WAKE SHOWS (WK1, 2026-10-30; Mike's
 * markup of the wake, via ROADMAP). Until then: three handoffs a line each, the
 * rest by bare id (`HANDOFF_WAKE_SHOWN`, `HANDOFF_WAKE_LISTED`, both gone). A
 * working default.
 */
export const HANDOFF_LEAD_LINES = 5;

/**
 * THE MOST BYTES ONE LINE OF THAT LEAD TAKES (WK1, 2026-10-30): a handoff's line
 * is often a whole paragraph, and "five lines" that are five paragraphs is the
 * handoff, not its lead. Half as long again as the first-sentence cap
 * (`HANDOFF_EXCERPT_BYTES`), because a line here stands for itself; cut with `…`
 * like it. A working default.
 */
export const HANDOFF_LEAD_LINE_BYTES = 240;

/**
 * HOW MANY OTHER LIVE HANDOFFS GET A LINE, newest first (WK1, 2026-10-30; ROADMAP,
 * after the first numbers: a line each with no cap took "Work here"'s room on a
 * folder holding seven). The rest are a count and the `handoffs here` handle. A
 * working default, until WK2 looks at which seat a handoff belongs to.
 */
export const HANDOFF_OTHERS_SHOWN = 2;


/** The title's cap in the line. The id is the door to the whole chapter. */
export const LAST_HERE_TITLE_BYTES = 100;

/**
 * The wake's own structural markers, refused in a handoff body for the reason
 * `revisePage` refuses them: the excerpt is spliced INSIDE the wake block, so a
 * body carrying an end-of-wake comment would put a false end in front of real
 * lanes for the model reading it. The constant's owner is
 * `self/index.ts#WAKE_MARKER`; it is spelled here rather than imported because
 * `handoff/` depends on `store/` and nothing else.
 */
export const WAKE_MARKER = "<!-- counterparts:wake";

export type HandoffRefusal =
  | "observer"
  | "no-scope"
  | "empty"
  | "empty-after-gate"
  | "not-text"
  | "nothing-to-clear"
  | "not-here"
  | "session-unnamed"
  | "no-room"
  | "store-refused"
  | "too-large"
  | "forged-markers"
  | "gate-refused";

export interface HandoffWrite {
  readonly written: boolean;
  /** `created`, `revised` or `cleared` when written; the refusal otherwise. */
  readonly reason: HandoffRefusal | "created" | "revised" | "cleared";
  readonly id: string | null;
  readonly version: number | null;
  readonly bytes: number;
  /** The gate that turned it away, when one did. */
  readonly gate: { readonly gate: string; readonly reason: string } | null;
  /** Set when the battery took something out on the way in (a credential). */
  readonly redacted: { readonly gate: string; readonly bytesBefore: number } | null;
  /** Lived days this pointer will show for, counting the day it was written. */
  readonly showsForDays: number | null;
  /**
   * After a write: the OTHER sessions' live handoffs in this directory, newest
   * first (2026-09-30), so the writer can retire any whose work is finished in
   * the same call. Absent on every other outcome.
   */
  readonly others?: readonly HandoffNeighbour[];
}

/** Another session's live handoff here, as a write's result names it. */
export interface HandoffNeighbour {
  readonly id: string;
  readonly session: string | null;
  readonly writtenOn: string;
  /** Its first sentence, as the wake prints it. */
  readonly excerpt: string;
}

/** A session id as this module keys it: a blank one is no session (the rule
 *  `Lifecycle#composeWake` applies to what it is handed). */
function sessionKey(session: string | null | undefined): string | null {
  return typeof session === "string" && session.trim().length > 0 ? session : null;
}

export interface Handoff {
  readonly id: string;
  readonly scope: string;
  /** The handoff, verbatim. Never truncated here — see `excerpt`. */
  readonly body: string;
  readonly bytes: number;
  /** The calendar date it was written, `YYYY-MM-DD`; "" when unrecorded. */
  readonly writtenOn: string;
  /** The lived day it was written; null when unrecorded. */
  readonly writtenDay: number | null;
  readonly session: string | null;
  /** The writing session's model id (`claude-opus-5-5`); null when unrecorded. */
  readonly model?: string | null;
  /** Epoch ms of the write, from the row's meta; null on an older row. */
  readonly writtenAt?: number | null;
  /** The Counterparts version that wrote it (`0.3.10`); null on an older row. */
  readonly build?: string | null;
  /** `revision` on the row: 0 for one written once and never replaced. */
  readonly version: number;
}

/** The gate every entrance passes (SEAMS H). Shaped like `bridge.EpisodeGate`,
 *  restated as a parameter so this module imports no gate of its own. */
export type HandoffGate = (input: {
  text: string;
  handles: readonly string[];
  sessionId: string;
}) => { ok: true; text?: string } | { ok: false; gate: string; reason: string };

function byteLengthOf(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * A statement is a line here, as it is in the wake (`briefing.ts#flatten`) —
 * AND nothing in it can steer a terminal or a reader.
 *
 * `\s+` is `\n \r \t` and friends. It is not NUL, not ESC, and not U+202E:
 * measured by the adversarial review (MINOR-4), a right-to-left override in a
 * handoff reversed the display of everything after it in the delivered wake for
 * any reader that honours bidi, and an ANSI escape landed in a prompt that is
 * sometimes rendered in a terminal. Line injection was already blocked — the CR
 * case folds here and only one line is ever excerpted — and this closes the
 * rest of the class in the same place, so there is one function to check.
 *
 * `\p{Cc}` is the C0/C1 controls, `\p{Cf}` the format characters (the bidi
 * overrides and embeddings, the zero-width joiner, the byte-order mark). They
 * are DROPPED rather than replaced: a handoff is prose about work, and a
 * visible substitute for an invisible character is noise in a two-line pointer.
 */
export function flatten(text: string): string {
  // A control that IS whitespace becomes a space — `\n` must not join two words
  // into one — and everything else in the two classes is dropped. Then the
  // ordinary collapse, so a dropped character cannot leave a double space.
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (/\s/u.test(c) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
}

// ── finding it ──────────────────────────────────────────────────────────────

/**
 * Is this document a handoff? Read STRUCTURALLY by `recall/` for the reason
 * `isSelfPage` is: a shape check that fails reads as "not a handoff", which is
 * the direction that only ever costs a candidate slot.
 */
export function isHandoffDoc(doc: ProseDoc): boolean {
  return doc.type === "schema" && doc.meta["role"] === HANDOFF_ROLE;
}

/** `isHandoffDoc` by id, for callers holding rows rather than documents. */
export function isHandoffRow(store: Store, id: string): boolean {
  const row = store.row(id);
  if (row === undefined || row.type !== "schema" || row.kind !== HANDOFF_KIND) return false;
  try {
    return isHandoffDoc(store.readProse(id));
  } catch {
    return false;
  }
}

/**
 * WHO WROTE A HANDOFF AND WHEN (2026-10-01, random-f2's item 2) — for a reader
 * that holds an id and asks where the row came from (`recall`'s `from`). A
 * handoff names its writer on the row's meta, never on `origin_session`, and a
 * row born before 2026-09-30 was revised in place by later sessions, so its
 * birth date is the FIRST writer's: read as a memory it said "an earlier
 * session, 2026-09-23" for words written 09-30 18:45. The session is the
 * meta's; the time is the newest `handoff.written` row, else the meta's write
 * time, else the row's last update. Null for a row that is not a handoff.
 */
export function handoffAuthorship(
  store: Store,
  id: string,
): { session: string | null; at: number | null; on: string | null; scope: string | null } | null {
  try {
    if (!isHandoffRow(store, id)) return null;
    const row = store.row(id);
    const meta = store.readProse(id).meta;
    const session = meta[HANDOFF_META_SESSION];
    const metaAt = meta[HANDOFF_META_WRITTEN_AT];
    const on = meta[HANDOFF_META_WRITTEN_ON];
    let at: number | null = typeof metaAt === "number" && Number.isFinite(metaAt) ? metaAt : null;
    try {
      const logged = store.eventLog({ name: HANDOFF_WRITTEN_EVENT, ref: id, order: "desc", limit: 1 })[0];
      if (logged !== undefined) at = logged.at;
    } catch {
      /* the meta's time, or the row's */
    }
    if (at === null) at = row?.updated_at ?? row?.created_at ?? null;
    return {
      session: typeof session === "string" && session.length > 0 ? session : null,
      at,
      on: typeof on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null,
      scope: typeof meta[HANDOFF_META_SCOPE] === "string" && (meta[HANDOFF_META_SCOPE] as string).length > 0 ? (meta[HANDOFF_META_SCOPE] as string) : null,
    };
  } catch {
    return null;
  }
}

/** One live handoff row, read far enough to rank it. */
interface LiveRow {
  readonly id: string;
  readonly scope: string;
  readonly writtenDay: number | null;
  /** The writing session, or null — the other half of the row's key. */
  readonly session: string | null;
  /** Epoch ms of the write, when the row recorded it (2026-09-30 on). */
  readonly writtenAt: number | null;
}

/**
 * Every live handoff row in the store, whatever its scope, with the fields
 * every caller here ranks and keys by. One walk, one prose read per row.
 */
export function liveHandoffRows(store: Store): LiveRow[] {
  const out: LiveRow[] = [];
  for (const id of store.list({ type: "schema", kind: HANDOFF_KIND, archived: false })) {
    try {
      const meta = store.readProse(id).meta;
      if (meta["role"] !== HANDOFF_ROLE) continue;
      const scope = meta[HANDOFF_META_SCOPE];
      const day = meta[HANDOFF_META_WRITTEN_DAY];
      const session = meta[HANDOFF_META_SESSION];
      const at = meta[HANDOFF_META_WRITTEN_AT];
      out.push({
        id,
        scope: typeof scope === "string" ? scope : "",
        writtenDay: typeof day === "number" ? day : null,
        session: typeof session === "string" && session.length > 0 ? session : null,
        writtenAt: typeof at === "number" && Number.isFinite(at) ? at : null,
      });
    } catch {
      continue;
    }
  }
  return out;
}

/** Ids only, for the callers that do not rank. */
export function handoffRows(store: Store): string[] {
  return liveHandoffRows(store).map((r) => r.id);
}

/**
 * IS `a` NEWER THAN `b`? The lived day first, then the write's own time (a
 * row from before 2026-09-30 has none and ranks as the older of two on one
 * day), then the id, so the answer is stable.
 */
function newer(a: LiveRow, b: LiveRow): boolean {
  const da = a.writtenDay ?? -1;
  const db = b.writtenDay ?? -1;
  if (da !== db) return da > db;
  const ta = a.writtenAt ?? -1;
  const tb = b.writtenAt ?? -1;
  if (ta !== tb) return ta > tb;
  return a.id > b.id;
}

/** The newest row per key, by `newer`. Rows with no scope are no one's. */
function newestBy(rows: readonly LiveRow[], key: (r: LiveRow) => string): Map<string, LiveRow> {
  const best = new Map<string, LiveRow>();
  for (const r of rows) {
    if (r.scope.length === 0) continue;
    const k = key(r);
    const held = best.get(k);
    if (held === undefined || newer(r, held)) best.set(k, r);
  }
  return best;
}

/**
 * THE NEWEST live row per scope, whoever wrote it — what `dream/mind.ts` reads
 * for its one open loop per directory.
 *
 * Two rows for one directory AND one session should be impossible — `write`
 * mints only when `findHandoffRow` returns null — but `findHandoffRow` → `put`
 * is not one transaction, and the deployment is one process per hook and one
 * server per session, so a cross-process race is narrow rather than closed
 * (adversarial review MINOR-8). `newestPerKey` is where that is handled; this
 * is the per-directory view over it.
 */
export function newestPerScope(rows: readonly LiveRow[]): Map<string, LiveRow> {
  return newestBy(rows, (r) => r.scope);
}

/**
 * THE NEWEST live row per (directory, session) — the unit a write revises and
 * a wake shows. When a race leaves two rows for one key the loser used to be
 * picked by `list()`'s id ordering, silently, and went on holding the reserve
 * open while invisible to every read; the losers are named by
 * `duplicateHandoffRows` so `write` can retire them.
 */
export function newestPerKey(rows: readonly LiveRow[]): Map<string, LiveRow> {
  return newestBy(rows, (r) => `${r.scope}\u0000${r.session ?? ""}`);
}

/**
 * A handoff row, live or expired, or null — the newest one when a race has
 * left more than one.
 *
 * With `session` left out: this directory's NEWEST row, whoever wrote it. With
 * `session` given (null included): THAT session's row here — the one its next
 * write revises and its blank field retires.
 *
 * Box 2 has no meta query (`schemas/INTERFACE-GAPS §2`), so the scope match is a
 * body read, exactly as `findSelfPage` reads for the role.
 */
export function findHandoffRow(store: Store, scope: string, session?: string | null): string | null {
  const want = scope.trim();
  if (want.length === 0) return null;
  const rows = liveHandoffRows(store).filter(
    (r) => r.scope === want && (session === undefined || r.session === (session ?? null)),
  );
  return newestPerScope(rows).get(want)?.id ?? null;
}

/** The OTHER live rows for this directory and session — a race's losers,
 *  which `write` retires. */
export function duplicateHandoffRows(store: Store, scope: string, session: string | null = null): string[] {
  const want = scope.trim();
  if (want.length === 0) return [];
  const rows = liveHandoffRows(store).filter((r) => r.scope === want && r.session === session);
  const winner = newestPerScope(rows).get(want)?.id ?? null;
  return rows.filter((r) => r.id !== winner).map((r) => r.id);
}

/** A handoff as a value, or null — `findHandoffRow`'s pick. A row whose prose
 *  will not read is absent to every reader here, never a throw (`self/` §5
 *  G7's rule, borrowed). */
export function readHandoff(store: Store, scope: string, session?: string | null): Handoff | null {
  const id = findHandoffRow(store, scope, session);
  if (id === null) return null;
  return handoffOf(store, { id, scope: scope.trim(), writtenDay: null, session: null, writtenAt: null });
}

/**
 * EVERY UNEXPIRED HANDOFF FOR THIS DIRECTORY, one per writing session, newest
 * first. One walk; the prose is read once more per row kept.
 */
export function liveHandoffsFor(store: Store, scope: string, day: number, lifeDays = HANDOFF_LIFE_DAYS): Handoff[] {
  const want = scope.trim();
  if (want.length === 0) return [];
  return handoffsNewestFirst(
    store,
    liveHandoffRows(store).filter((r) => r.scope === want),
    day,
    lifeDays,
  );
}

/** One key's newest row each, unexpired, as values, newest first. */
function handoffsNewestFirst(store: Store, rows: readonly LiveRow[], day: number, lifeDays: number): Handoff[] {
  const kept = [...newestPerKey(rows).values()]
    .filter((r) => r.writtenDay !== null && daysLeft(r.writtenDay, day, lifeDays) > 0)
    .sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0));
  const out: Handoff[] = [];
  for (const r of kept) {
    const h = handoffOf(store, r);
    if (h !== null && !expired(h, day, lifeDays)) out.push(h);
  }
  return out;
}

/** The same read, for a caller that has already walked and holds the row. */
function handoffOf(store: Store, live: LiveRow): Handoff | null {
  const id = live.id;
  let doc: ProseDoc;
  try {
    doc = store.readProse(id);
  } catch {
    return null;
  }
  const scope = live.scope;
  const row = store.row(id);
  const writtenDay = doc.meta[HANDOFF_META_WRITTEN_DAY];
  const writtenOn = doc.meta[HANDOFF_META_WRITTEN_ON];
  const session = doc.meta[HANDOFF_META_SESSION];
  const model = doc.meta[HANDOFF_META_MODEL];
  const writtenAt = doc.meta[HANDOFF_META_WRITTEN_AT];
  const build = doc.meta[HANDOFF_META_BUILD];
  return {
    id,
    scope,
    body: doc.body,
    bytes: byteLengthOf(doc.body),
    writtenOn: typeof writtenOn === "string" ? writtenOn : "",
    writtenDay: typeof writtenDay === "number" ? writtenDay : null,
    session: typeof session === "string" && session.length > 0 ? session : null,
    model: isModelId(model) ? model : null,
    writtenAt: typeof writtenAt === "number" && Number.isFinite(writtenAt) ? writtenAt : null,
    build: isVersion(build) ? build : null,
    version: row?.revision ?? 0,
  };
}

/** A version as the wake may print it: dotted numbers, an optional tag. */
export function isVersion(v: unknown): v is string {
  return typeof v === "string" && v.length <= HANDOFF_VERSION_MAX_CHARS && /^\d+(\.\d+){0,3}(-[0-9A-Za-z.]+)?$/.test(v);
}

/**
 * IS `a` AN OLDER RELEASE THAN `b`? Dotted numbers compared part by part; a
 * pre-release tag (`0.3.10-rc.1`) is older than the release it names. False
 * when either is not a version: a comparison it cannot make says nothing.
 */
export function versionOlder(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!isVersion(a) || !isVersion(b)) return false;
  const parse = (v: string): { nums: number[]; tag: boolean } => {
    const cut = v.indexOf("-");
    const core = cut < 0 ? v : v.slice(0, cut);
    return { nums: core.split(".").map(Number), tag: cut >= 0 };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const x = pa.nums[i] ?? 0;
    const y = pb.nums[i] ?? 0;
    if (x !== y) return x < y;
  }
  return pa.tag && !pb.tag;
}

/**
 * WHY A HANDOFF MAY BE OUT OF DATE, as ONE PLAIN SENTENCE (2026-10-18, the
 * wake-polish builder, lightly held; first built 2026-10-01 for random-f2's
 * item 1): how old it is, and what has happened since —
 *
 *   `2 days old, with a newer chapter here since; release 0.3.24 then, 0.3.25 now`
 *
 * (that wording since 2026-10-25 — below, in the function).
 *
 * "A newer chapter here" when a session other than its writer wrote a chapter
 * in this directory after it; the release when the process that wrote it ran
 * an older one than is installed now. The release is said as what it was and
 * what it is, not as "installed since": a session that installed the new
 * release and wrote its handoff before restarting was still on the old one.
 * `age` is calendar days, in the store's zone, from the day it was written to
 * the day it is read; said from one day on. Computed at delivery from records
 * that already exist; nothing judges whether what it waited on happened. Null
 * when neither holds — a handoff that is only old says its date, as before.
 * (Before 2026-10-18 the words were "before 0.3.10 was installed, and a newer
 * chapter here since", and the newest added the work since it with how much
 * of that was written up; random-6c's 10-17 wake found the line unparseable.)
 */
export function staleWords(opts: {
  readonly writtenWith?: string | null;
  readonly installed?: string | null;
  readonly newerChapter?: boolean;
  readonly age?: number | null;
}): string | null {
  const release = versionOlder(opts.writtenWith, opts.installed);
  if (!release && opts.newerChapter !== true) return null;
  // TWO CLAUSES, NOT THREE (2026-10-25, the wake-polish builder from
  // random-5b's 10-25 wake, lightly held): how old and what came since read
  // as one ("1 day old, with a newer chapter here since"), the release as the
  // other ("release 0.3.34 then, 0.3.35 now") — before, three clauses and
  // "written" twice beside the stamp: "1 day old; since then: a newer
  // chapter here; written on 0.3.34, 0.3.35 now".
  const age = opts.age ?? null;
  const old = age !== null && Number.isFinite(age) && age >= 1 ? `${String(Math.floor(age))} ${age < 2 ? "day" : "days"} old` : null;
  const since = opts.newerChapter !== true ? null : old === null ? "a newer chapter here since" : `${old}, with a newer chapter here since`;
  const parts = [since ?? old, release ? `release ${opts.writtenWith as string} then, ${opts.installed as string} now` : null];
  return parts.filter((p): p is string => p !== null).join("; ");
}

/**
 * Has this one run out? A handoff with no recorded lived day has: an undated
 * pointer cannot be aged, and showing one forever is the failure the expiry
 * exists to prevent.
 */
export function expired(h: Handoff, day: number, lifeDays = HANDOFF_LIFE_DAYS): boolean {
  if (h.writtenDay === null) return true;
  return daysLeft(h.writtenDay, day, lifeDays) <= 0;
}

/**
 * LIVED DAYS THIS POINTER HAS LEFT, counting the day it was written as the
 * first of them. Zero or less means it has run out.
 *
 * The first draft was `day - writtenDay > lifeDays`, which showed the pointer on
 * days 0…14 — fifteen days, while every word around it said fourteen — and made
 * `pointerDoor` print "It stops showing after 0 more days of use." on the last
 * one, which reads as a bug to anyone who sees it (adversarial review NIT 1 and
 * 2). One function, so the constant, the prose and the sentence cannot disagree.
 */
export function daysLeft(writtenDay: number, day: number, lifeDays = HANDOFF_LIFE_DAYS): number {
  return lifeDays - (day - writtenDay);
}

// ── what the wake prints ────────────────────────────────────────────────────

/** The shortest run that counts as a sentence the excerpt may stop at. */
export const EXCERPT_MIN_SENTENCE = 20;

/** The marker a cut excerpt ends with. Three bytes, and the cut reserves them. */
export const ELLIPSIS = "\u2026";

/**
 * A heading line \u2014 Markdown ATX or a Setext underline \u2014 or a blank one. Not
 * what the pointer is for; see `excerpt`.
 */
function isHeading(line: string): boolean {
  const t = line.trim();
  return t.length === 0 || /^#{1,6}\s/.test(t) || /^[=-]{3,}$/.test(t);
}

/**
 * The first SENTENCE of a handoff's first substantive line, flattened and cut
 * to fit, with an ellipsis when it was cut. Cuts at a word where one is near
 * the end, never mid-word when a space is within the last fifth of the room.
 *
 * A sentence, not the line (2026-09-30): a pointer that stops at 160 bytes in
 * the middle of a second sentence reads as a fragment of something the reader
 * was not shown. A sentence ends at `.`, `!` or `?` followed by a space, and
 * only once it is `EXCERPT_MIN_SENTENCE` characters long — so "Step 2.",
 * "e.g." and a list number are not sentences (review of #289); a leading list
 * marker ("1.", "2)", "-", "*") is dropped first. With no such end, the byte
 * cap cuts. A version number or a path keeps its dots.
 */
export function excerpt(body: string, capBytes = HANDOFF_EXCERPT_BYTES): string {
  const lines = body.split("\n");
  // The first line with SUBSTANCE on it: not blank, and not the title the
  // writer put above the substance. A model asked for a handoff writes a titled
  // note about as often as a bare paragraph, and `"# Handoff\n\nThe empty-input
  // case still fails…"` produced a pointer that said nothing at all
  // (adversarial review MINOR-6).
  const line = lines.find((l) => !isHeading(l)) ?? lines.find((l) => l.trim().length > 0) ?? body;
  const flat = flatten(line).replace(/^(?:[-*+•]|\d{1,3}[.)])\s+/u, "");
  let first = flat;
  for (const m of flat.matchAll(/[.!?](?=\s)/gu)) {
    const end = (m.index ?? 0) + 1;
    if (end < EXCERPT_MIN_SENTENCE) continue;
    first = flat.slice(0, end);
    break;
  }
  return cutToBytes(first, capBytes);
}

/**
 * WHERE A HANDOFF SAYS WHAT COMES NEXT: the last `next:` it has, as a writer puts
 * it (`next:`, `Next for me:`, `Next step:`). Its index in `flat`, or -1.
 */
function nextAt(flat: string): number {
  let at = -1;
  for (const m of flat.matchAll(/(?<![\p{L}\p{N}])next\b[^.:!?]{0,24}:/giu)) at = m.index ?? at;
  return at;
}

/**
 * THE NEWEST HANDOFF'S LEAD (WK1, 2026-10-30; Mike's markup of the wake, via
 * ROADMAP): up to `maxLines` lines of what it says, in order: its lines with
 * substance (a title above them is not one), a long one taken a sentence at a
 * time, since a handoff is as often one paragraph as a list. Each flat, each at
 * most `HANDOFF_LEAD_LINE_BYTES`, cut at a word's end (`cutToBytes`).
 *
 * WHAT COMES NEXT IS NEVER WHAT THE CAPS LOSE: from two lines up, a handoff's
 * last `next:` part keeps a line of its own at the end, however long the
 * paragraphs above it, with the lines before it giving way for it. It is what the
 * next session opens the handoff for. Pure.
 */
export function handoffLead(body: string, maxLines = HANDOFF_LEAD_LINES): string[] {
  const pieces: { text: string; next: boolean }[] = [];
  const sentences = (flat: string): void => {
    let from = 0;
    for (const m of flat.matchAll(/[.!?](?=\s)/gu)) {
      const end = (m.index ?? 0) + 1;
      if (end - from < EXCERPT_MIN_SENTENCE) continue;
      pieces.push({ text: cutToBytes(flat.slice(from, end).trim(), HANDOFF_LEAD_LINE_BYTES), next: false });
      from = end;
    }
    const rest = flat.slice(from).trim();
    if (rest.length > 0) pieces.push({ text: cutToBytes(rest, HANDOFF_LEAD_LINE_BYTES), next: false });
  };
  const lines = body.split("\n").filter((l) => !isHeading(l) && l.trim().length > 0).map(flatten);
  // Only the last line that says it holds the part kept.
  let nextLine = -1;
  for (let i = lines.length - 1; i >= 0 && nextLine < 0; i--) if (nextAt(lines[i] ?? "") >= 0) nextLine = i;
  lines.forEach((flat, i) => {
    const at = i === nextLine ? nextAt(flat) : -1;
    if (byteLengthOf(flat) <= HANDOFF_LEAD_LINE_BYTES) {
      pieces.push({ text: flat, next: at >= 0 });
      return;
    }
    if (at < 0) {
      sentences(flat);
      return;
    }
    // A long line: what is before the part, then the part, one line, cut only at its own end.
    const before = flat.slice(0, at).replace(/[\s,;—-]+$/u, "");
    if (before.length > 0) sentences(before);
    pieces.push({ text: cutToBytes(flat.slice(at), HANDOFF_LEAD_LINE_BYTES), next: true });
  });
  if (pieces.length === 0) return [excerpt(body)];
  if (pieces.length <= maxLines) return pieces.map((p) => p.text);
  const part = pieces.findIndex((p) => p.next);
  // The part is among those kept, or one line is all there is room for.
  if (part < 0 || part < maxLines || maxLines < 2) return pieces.slice(0, maxLines).map((p) => p.text);
  return [...pieces.slice(0, maxLines - 1), pieces[part] as { text: string }].map((p) => p.text);
}

/** `text`, cut to `capBytes` with `…` when it is longer, at the end of a word. Only one word too long to fit by itself is ever cut through. */
function cutToBytes(first: string, capBytes: number): string {
  if (byteLengthOf(first) <= capBytes) return first;
  // The ellipsis is THREE bytes, not one: `…` is U+2026. Reserving a character
  // rather than its bytes is how a cap that says 160 renders 161 — measured,
  // not reasoned about.
  const room = Math.max(0, capBytes - byteLengthOf(ELLIPSIS));
  const bytes = new TextEncoder().encode(first);
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, room));
  const clean = prefix.replace(/�+$/u, "");
  // Already at a word's end, or back to the last one, unless the word being cut
  // could never fit by itself (a URL, a path, a run of text with no spaces): going
  // back past it would leave "See…" of a whole line.
  const atEnd = /^\s/u.test(first.slice(clean.length));
  const space = clean.lastIndexOf(" ");
  const word = first.slice(space + 1).split(/\s/u, 1)[0] ?? "";
  const kept = atEnd || space <= 0 || byteLengthOf(word) > room ? clean : clean.slice(0, space);
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

/**
 * HOW CURRENT THE POINTER IS (2026-09-30), computed at delivery by whoever
 * splices it: when it was written, as a person reads it in the store's zone,
 * and why it may be out of date (`staleWords`). Since 2026-10-18 it no longer
 * carries the work done here after it and how much of that is written up:
 * doctor and `counterparts coverage` say that, and the wake line could not.
 */
export interface PointerSince {
  /** `09-29 12:47`. */
  readonly written: string;
  /** Why it may be out of date (`staleWords`), or null/absent. */
  readonly stale?: string | null;
}

/** The widest `PointerSince` the words can take — what the reserve is sized to. */
export const WIDEST_POINTER_SINCE: PointerSince = {
  written: "12-31 23:59",
  stale: staleWords({
    writtenWith: "8".repeat(HANDOFF_VERSION_MAX_CHARS),
    installed: "9".repeat(HANDOFF_VERSION_MAX_CHARS),
    newerChapter: true,
    age: 9999,
  }),
};

/**
 * A model id as a person says it: `claude-opus-5-5` → `Opus 5.5`, with a
 * context suffix (`[1m]`) and a date stamp dropped. Anything that does not
 * read as family-then-version is printed as it came, so an unfamiliar id is
 * never guessed at.
 */
export function modelWords(id: string): string {
  const bare = id.replace(/^claude-/, "").replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");
  const m = /^([a-z]+)-(\d{1,2}(?:-\d{1,2})*)$/.exec(bare);
  const family = m?.[1];
  const version = m?.[2];
  if (family === undefined || version === undefined) return flatten(id);
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.replace(/-/g, ".")}`;
}

/**
 * WHO LEFT IT, for the reader (2026-09-30): "this session" when it is the one
 * waking, the session's short id otherwise, and "an earlier session" when the
 * row names none (a caller that passed no session). The model, when the row
 * recorded one, rides beside it. The short id is the first eight characters —
 * enough to tell a handful of sessions apart, and the full id is on the row.
 */
export function authorWords(h: Handoff, reader: string | null = null): string {
  return sessionWords(h.session, h.model ?? null, reader);
}

/**
 * `authorWords` for anything that names a session and a model — a handoff, or
 * a chapter in the "Last here" line (2026-09-30), so the two say who in the
 * same words.
 *
 * The unbound server's shared id (`UNBOUND_SESSION`) names no session, so it
 * is never "this session" and never `session mcp`: it reads
 * `UNIDENTIFIED_SESSION_WORDS` (the 0.3.10 release check). Nor is a reader
 * that IS it anyone's "this session" — a server that has not bound does not
 * know which rows are its own.
 */
export function sessionWords(session: string | null, model: string | null, reader: string | null = null): string {
  const who =
    session === null || session.length === 0
      ? "an earlier session"
      : !isKnownSession(session)
        ? UNIDENTIFIED_SESSION_WORDS
        : isKnownSession(reader) && session === reader
          ? "this session"
          : `session ${flatten(session).slice(0, 8)}`;
  return model === null ? who : `${who} on ${modelWords(model)}`;
}

/** Who wrote a row filed under the unbound server's id, in words. */
export const UNIDENTIFIED_SESSION_WORDS = "a session that hadn't been identified yet";

/** When it was written, by whom, and — when it may be out of date — why, in
 *  one sentence: after a dash inside the single pointer's parentheses, in
 *  parentheses of its own in a several-handoff entry. */
export function whenWords(h: Handoff, since: PointerSince | null, author: string | null = null, nested = false): string {
  const by = author === null ? "" : ` by ${author}`;
  if (since === null || since.written.length === 0) {
    const on = /^\d{4}-\d{2}-\d{2}$/.test(h.writtenOn.trim()) ? h.writtenOn.trim() : "an unrecorded date";
    return `${on}${by}`;
  }
  // WHY IT MAY BE OUT OF DATE (2026-10-01), right after who and when, so it
  // is read before the handoff's own first sentence.
  const stale = since.stale === undefined || since.stale === null ? "" : nested ? ` \u2014 ${since.stale}` : ` (${since.stale})`;
  return `written ${since.written}${by}${stale}`;
}

// ── what was planned here since (2026-10-09) ────────────────────────────────

/**
 * THE STATUSES THAT READ AS A PLAN OR A NEXT STEP — the v12 field the writer
 * fills (`store/index.ts#STATUSES`): `planned` (decided, not yet done),
 * `proposed` (put forward, not decided) and `asked` (a question or request
 * still open). Not `done`, and not a memory with no status.
 */
export const PLAN_STATUSES: readonly MemoryStatus[] = ["planned", "proposed", "asked"];

/** How many the "since" line names, newest first; the rest are a count. */
export const SINCE_SHOWN = 3;

/** A title's cap in the line, in bytes. The id is the door to the whole memory. */
export const SINCE_TITLE_BYTES = 60;

/**
 * WHAT ITS OWN SESSION WROTE THIS SOON AFTER THE HANDOFF IS PART OF THE SAME
 * ANSWER, not news: the `session_end` call writes its handoff first and its
 * memories straight after (`mcp/server.ts#sessionEndTool`), and an end-of-
 * stretch answer may add a note or a chapter in the same turn. Five minutes,
 * the grace a chapter's span gives the same answer
 * (`self/chapter-address.ts#CHAPTER_MOMENT_GRACE_MS`). A working default.
 */
export const SINCE_SAME_ANSWER_MS = 5 * 60_000;

/** How many candidates one read takes, newest first (`Store#planCandidates`). */
export const SINCE_READ = 30;

/** One memory the "since" line names. */
export interface PlanSince {
  readonly id: string;
  /** Its title, or its first sentence when it has none, cut to `SINCE_TITLE_BYTES`. */
  readonly title: string;
  /** What kind of thing it is, as the line prints it (`planWord`). */
  readonly word: string;
}

/** What was planned here since a handoff: the newest first, and how many more. */
export interface PlansSince {
  readonly items: readonly PlanSince[];
  readonly more: number;
}

/**
 * IS THIS A PLAN OR A NEXT STEP, and the word the line prints for it: its
 * status when that is one of `PLAN_STATUSES`, else "open" for a memory still
 * flagged `unresolved` (the word the wake's "Still open:" lane uses). Null
 * for anything else. Pure.
 */
export function planWord(status: string | null | undefined, unresolved: boolean): string | null {
  if (typeof status === "string" && (PLAN_STATUSES as readonly string[]).includes(status)) return status;
  return unresolved ? "open" : null;
}

/**
 * THE LINE UNDER THE POINTER (2026-10-09): what this directory's sessions
 * wrote after the newest handoff that reads as a plan or a next step — up to
 * `SINCE_SHOWN` by title, word and id, newest first, the rest by count.
 * `several` says the block shows more than one handoff, so the line says
 * which one it counts from. Flattened, no bullet: the pointer is furniture.
 * Null with nothing to name. Pure.
 */
export function sinceLine(plans: PlansSince, several: boolean): string | null {
  const shown = plans.items.slice(0, SINCE_SHOWN);
  if (shown.length === 0) return null;
  const more = plans.more + plans.items.length - shown.length;
  const lead = several ? "Since the newest handoff here:" : "Since this handoff:";
  const list = shown.map((p) => `${p.title} (${p.word}, ${p.id})`).join("; ");
  return flatten(`${lead} ${list}${more > 0 ? `; and ${String(more)} more` : ""}.`);
}

/** `/a/b/` and `/a/b` name one directory, as `self/work.ts` reads them. */
function scopeSpellings(scope: string): string[] {
  const trimmed = scope.trim();
  const bare = trimmed.replace(/\/+$/, "");
  return bare.length > 0 && bare !== trimmed ? [trimmed, bare] : [trimmed];
}

// ── where this folder stands (WK1, 2026-10-30) ──────────────────────────────

/**
 * WHERE THIS FOLDER STANDS (WK1, 2026-10-30; ROADMAP's call, for Mike's review).
 *
 * Until now a session start could carry three separate answers to "where were
 * we": "Last here" (the newest chapter written here), "Last said here" (the
 * last exchange, about a day back) and the handoff block (one per writing
 * session, newest first). They were spliced in that order whatever their
 * times, so the 10-30 ~/random wake read a two-day-old handoff as where the
 * work stood beside a newer session's chapter, and the 10-04 and 10-30 reads
 * both said the "here" threads disagree. Older handoffs and same-day chapters
 * were listed by bare id ("+6 older here: sch_…", "+2 more here on Oct 29:
 * epi_…").
 *
 * Now they are one block, grouped BY SESSION, and THE NEWEST HANDOFF LEADS:
 *
 *   Where this folder stands: a handoff from session <id> on Opus 5.5, written
 *   10-29 14:46 (1 day old) (sch_…):
 *     up to five lines of what it says
 *   Since then: session <id>, Oct 29 16:00–17:00 — "Title" (epi_…).
 *   Other handoffs here, newest first:
 *   - session <id>, 10-27: its first sentence (sch_…)
 *   (+4 older handoffs: recall "handoffs here" lists them. Expand one by its id with
 *   recall; retire a finished one with …)
 *
 *   - One session's chapter, last words and newest handoff are ONE entry.
 *   - THE HANDOFF LEADS, EVEN WHEN A CHAPTER IS NEWER (ROADMAP, 10-30, as review of
 *     #300 MAJOR-1 asked: unfinished work outranks orientation). A newer chapter
 *     goes under it by title, "Since then:", if there is room, which is how the
 *     block says the handoff may be out of date. With no handoff, the newest chapter
 *     leads, with its first sentence.
 *   - An entry under the lead is a different session, so it says something the lead
 *     does not: judged by session and time, never by comparing text.
 *   - THE NEWEST HANDOFF'S LEAD IS UP TO `HANDOFF_LEAD_LINES` LINES (Mike's markup of
 *     the wake, via ROADMAP, 10-30), and the next `HANDOFF_OTHERS_SHOWN` live
 *     handoffs get a line each. A body line is indented and flat, so it can never
 *     read as a heading or a line of the wake's own.
 *   - The handoffs without a line are a count and the `handoffs here` recall handle
 *     (`HANDOFFS_HERE_HANDLE`). No wake line lists bare ids.
 *   - Other same-day chapters here ("Before it", "+N more") are not repeated:
 *     "Today so far" and the Yesterday line name them.
 *
 * WHAT GIVES WAY, IN ORDER (`standsLadder`, one rung per step): the about-me
 * line from another folder; the last exchange; the chapter's first sentence;
 * the older chapter a chapterless later session follows; whatever else is under
 * the lead; the other handoffs' lines, oldest first; the "since" line; the newest
 * handoff's lead, line by line down to one. Only when not even that fits, the
 * chapter alone, the door counting the handoffs.
 *
 * Pure.
 */

/** The recall handle that lists this folder's live handoffs. Exact, trimmed, case-folded, like `last exchange`. */
export const HANDOFFS_HERE_HANDLE = "handoffs here";

/** How the block opens, how an older entry does, and how the other handoffs do. */
export const STANDS_HEAD = "Where this folder stands:";
export const STANDS_BEFORE = "Before that:";
export const STANDS_SINCE = "Since then:";
export const STANDS_OTHERS = "Other handoffs here, newest first:";

/** One live handoff, with when it was written (epoch ms, null when unrecorded) and how current it is (the newest's, read at delivery). */
export interface StandsHandoff {
  readonly handoff: Handoff;
  readonly at: number | null;
  readonly since: PointerSince | null;
}

/** The last exchange here, in words. */
export interface StandsSaid {
  readonly session: string;
  readonly at: number;
  /** `14:40`, or `10-29 14:40` the day after. */
  readonly when: string;
  /** The owner's first words, cut, with `…`. */
  readonly quote: string;
  /** The recall handle that reads it whole. */
  readonly handle: string;
}

/** A chapter here, with its session's last time here. */
export interface StandsChapter {
  readonly entry: LastHere;
  readonly at: number;
}

/** A session here newer than every chapter, with none of its own, and the newest chapter before it. */
export interface StandsLater {
  readonly later: LaterHere;
  readonly at: number;
  readonly before: StandsChapter | null;
}

/** What "Last here" knows, as facts (`Counterpart#lastHereFacts`). */
export interface LastHereFacts {
  readonly chapter: StandsChapter | null;
  readonly later: StandsLater | null;
  /** "A chapter about me from …" (`last-here.ts#elsewhereLine`), rendered, or null. */
  readonly aboutMe: string | null;
}

export interface StandsInput extends Partial<LastHereFacts> {
  /** This folder's live handoffs, newest first. */
  readonly handoffs: readonly StandsHandoff[];
  /** What was planned here since the newest handoff (`Handoffs#plansSince`). */
  readonly plans?: PlansSince | null;
  readonly said?: StandsSaid | null;
  readonly day: number;
  readonly reader?: string | null;
  readonly lifeDays?: number;
  /** An episode the wake's body already names: not named again as an older entry. */
  readonly named?: (id: string) => boolean;
}

export interface StandsRung {
  readonly block: string;
  /** The handoffs with a line in it, newest first. */
  readonly shown: readonly Handoff[];
  /** Each shown handoff's own words, in bytes. */
  readonly handoffBytes: readonly number[];
  /** How many live handoffs there are here. */
  readonly live: number;
  /** The ids the "since" line names, or none. */
  readonly plans: readonly string[];
  /** The chapter (or the later session) is in it — "Last here"'s part. */
  readonly chapter: boolean;
  /** That part's own bytes. */
  readonly chapterBytes: number;
  /** The last exchange is in it. */
  readonly said: boolean;
  /** The about-me line from another folder is in it. */
  readonly aboutMe: boolean;
  /** That line's own bytes, its newline included; 0 when it is not in it. */
  readonly aboutMeBytes: number;
}

/** One mention, before grouping. */
type Mention =
  | { readonly kind: "chapter"; readonly session: string; readonly at: number; readonly entry: LastHere; readonly sentence: boolean }
  | { readonly kind: "later"; readonly session: string; readonly at: number; readonly later: LaterHere }
  | { readonly kind: "handoff"; readonly session: string | null; readonly at: number; readonly h: StandsHandoff; readonly lead: number }
  | { readonly kind: "said"; readonly session: string; readonly at: number; readonly said: StandsSaid };

interface Entry {
  readonly key: string;
  readonly at: number;
  readonly mentions: readonly Mention[];
}

/** `— "Title" (epi_…)`; an untitled chapter by its first words; with neither, nothing (no bare ids). */
function chapterNamed(e: LastHere): string {
  const t = (e.chapter.title ?? "").trim() || e.chapter.excerpt.trim();
  return t.length === 0 ? "" : ` — "${excerpt(t, LAST_HERE_TITLE_BYTES)}" (${e.chapter.id})`;
}

/** An entry's head and the handoff's lead lines under it, and the bytes its parts take. */
function entryWords(e: Entry, reader: string | null): { head: string; lead: readonly string[]; handoffId: string | null; handoffBytes: number; chapterBytes: number } {
  const chapter = e.mentions.find((m) => m.kind === "chapter" || m.kind === "later");
  const handoff = e.mentions.find((m): m is Extract<Mention, { kind: "handoff" }> => m.kind === "handoff");
  const said = e.mentions.find((m): m is Extract<Mention, { kind: "said" }> => m.kind === "said");
  const model = chapter?.kind === "chapter" ? chapter.entry.chapter.model : (handoff?.h.handoff.model ?? null);
  const session = chapter?.session ?? handoff?.session ?? said?.session ?? null;
  const who = sessionWords(session, model, reader);
  const parts: string[] = [];
  let chapterBytes = 0;
  if (chapter?.kind === "chapter") {
    const c = chapter.entry.chapter;
    // Its first sentence only when no handoff of its own says where it stood.
    const titled = (c.title ?? "").trim().length > 0;
    const first = chapter.sentence && handoff === undefined && titled && c.excerpt.length > 0 ? ` ${excerpt(c.excerpt, HANDOFF_EXCERPT_BYTES)}` : "";
    parts.push(`${who}, ${chapter.entry.when}${chapterNamed(chapter.entry)}.${first}`);
  } else if (chapter?.kind === "later") {
    const l = chapter.later;
    // Its own handoff beside it is a write-up, so not "not written up yet".
    const what = l.memory === null ? (handoff === undefined ? ", no chapter, not written up yet." : ", no chapter.") : `, no chapter — "${excerpt(l.memory.title, LAST_HERE_TITLE_BYTES)}" (${l.memory.id}).`;
    parts.push(`${who}, ${l.when}${what}`);
  }
  if (parts[0] !== undefined) chapterBytes = byteLengthOf(parts[0]);
  if (said !== undefined) {
    const s = said.said;
    parts.push(`${parts.length === 0 ? `${who}, last` : "Last"} said ${s.when}: "${s.quote}" — recall "${s.handle}".`);
  }
  let lead: readonly string[] = [];
  let handoffBytes = 0;
  if (handoff !== undefined) {
    const h = handoff.h;
    const when = whenWords(h.handoff, h.since);
    const lines = handoffLead(h.handoff.body, handoff.lead);
    const open = `${parts.length === 0 ? `a handoff from ${who},` : "Its handoff,"} ${h.since === null ? `on ${when}` : when} (${h.handoff.id})`;
    // One line of it stays on the head's line; more go under it, indented.
    const words = lines.length === 1 ? `${open}: ${lines[0] ?? ""}` : `${open}:`;
    if (lines.length > 1) lead = lines.map((l) => `  ${l}`);
    handoffBytes = byteLengthOf(words) + 1 + lead.reduce((n, l) => n + byteLengthOf(l) + 1, 0);
    parts.push(words);
  }
  return { head: parts.join(" "), lead, handoffId: handoff?.h.handoff.id ?? null, handoffBytes, chapterBytes };
}

/** One other live handoff's line: who, the day, its first sentence and its id. No staleness sentence: the day says it. */
function otherLine(h: Handoff, reader: string | null): string {
  const on = /^\d{4}-(\d{2}-\d{2})$/.exec(h.writtenOn.trim())?.[1];
  return flatten(`- ${sessionWords(h.session, null, reader)}${on === undefined ? "" : `, ${on}`}: ${excerpt(h.body)} (${h.id})`);
}

/** The block's tail: the handoffs it does not show, by count and handle, and how to expand and retire. */
function doorWords(shown: readonly Handoff[], live: readonly Handoff[], day: number, lifeDays: number): string | null {
  if (live.length === 0) return null;
  const rest = live.length - shown.length;
  const older = shown.length === 0 ? "" : "older ";
  const count = rest > 0 ? `+${String(rest)} ${older}handoff${rest === 1 ? "" : "s"}: recall "${HANDOFFS_HERE_HANDLE}" lists ${rest === 1 ? "it" : "them"}.` : "";
  if (shown.length === 0) return `(${count})`;
  const only = shown.length === 1 && rest === 0 ? shown[0] : undefined;
  if (only !== undefined) {
    const left = only.writtenDay === null ? lifeDays : daysLeft(only.writtenDay, day, lifeDays);
    return `(Expand it by its id with recall; retire it once done with session_end's retireHandoff: [id]. It stops showing after ${left <= 1 ? "one more day" : `${String(left)} more days`} of use.)`;
  }
  return `(${count === "" ? "" : `${count} `}Expand one by its id with recall; retire a finished one with session_end's retireHandoff: [id]. Each stops showing after ${String(lifeDays)} days of use.)`;
}

interface Choice {
  readonly aboutMe: boolean;
  readonly said: boolean;
  /** The chapter's first sentence. */
  readonly sentence: boolean;
  /** The chapter a later session follows. */
  readonly before: boolean;
  /** How many of the other live handoffs have a line. */
  readonly others: number;
  readonly plans: boolean;
  /** How many lines of the newest handoff's lead. */
  readonly lead: number;
  /** What is under the lead entry. */
  readonly under: boolean;
  /** The chapter alone: not even one line of the handoff fit. */
  readonly noHandoff: boolean;
}

/**
 * THE RUNGS, widest first, each one step narrower than the last (the order is
 * this file's head). Duplicates dropped; the delivery takes the first that
 * fits. Empty with nothing to say. Pure.
 */
export function standsLadder(input: StandsInput): StandsRung[] {
  const lifeDays = input.lifeDays ?? HANDOFF_LIFE_DAYS;
  const reader = input.reader ?? null;
  const live = input.handoffs.filter((s) => !expired(s.handoff, input.day, lifeDays));
  const newest = live[0];
  const others = live.slice(1, 1 + HANDOFF_OTHERS_SHOWN).map((s) => s.handoff);
  const liveHs = live.map((s) => s.handoff);
  const leadMost = newest === undefined ? 0 : Math.max(1, handoffLead(newest.handoff.body, HANDOFF_LEAD_LINES).length);
  const later = input.later ?? null;
  const lead = later === null ? (input.chapter ?? null) : null;
  const before = later?.before ?? null;
  const beforeOk = before !== null && input.named?.(before.entry.chapter.id) !== true;
  const plans = input.plans ?? null;
  const planIds = (plans?.items ?? []).slice(0, 3).map((p) => p.id);
  const said = input.said ?? null;
  const aboutMe = input.aboutMe ?? null;

  const rung = (c: Choice): StandsRung | null => {
    const mentions: Mention[] = [];
    if (lead !== null) mentions.push({ kind: "chapter", session: lead.entry.chapter.session, at: lead.at, entry: lead.entry, sentence: c.sentence });
    if (later !== null) mentions.push({ kind: "later", session: later.later.session, at: later.at, later: later.later });
    if (c.before && before !== null) mentions.push({ kind: "chapter", session: before.entry.chapter.session, at: before.at, entry: before.entry, sentence: false });
    if (newest !== undefined && !c.noHandoff) mentions.push({ kind: "handoff", session: newest.handoff.session, at: newest.at ?? 0, h: newest, lead: c.lead });
    if (c.said && said !== null) mentions.push({ kind: "said", session: said.session, at: said.at, said });
    return render(mentions, c, liveHs, others, { day: input.day, lifeDays, reader, plans: c.plans ? plans : null, aboutMe: c.aboutMe ? aboutMe : null, planIds });
  };

  // Walk the give-ups in their order: each step keeps every earlier one.
  let c: Choice = {
    aboutMe: aboutMe !== null,
    said: said !== null,
    // Under a handoff a chapter is its title; its first sentence only when it leads.
    sentence: lead !== null && newest === undefined,
    before: beforeOk,
    others: others.length,
    plans: planIds.length > 0,
    lead: leadMost,
    under: true,
    noHandoff: false,
  };
  const steps: Choice[] = [c];
  const step = (next: Partial<Choice>): void => {
    c = { ...c, ...next };
    steps.push(c);
  };
  if (c.aboutMe) step({ aboutMe: false });
  if (c.said) step({ said: false });
  if (c.sentence) step({ sentence: false });
  if (c.before) step({ before: false });
  if (newest !== undefined) step({ under: false });
  for (let k = others.length - 1; k >= 0; k--) step({ others: k });
  if (c.plans) step({ plans: false });
  for (let n = leadMost - 1; n >= 1; n--) step({ lead: n });
  if (newest !== undefined && (lead !== null || later !== null)) step({ under: true, others: 0, plans: false, noHandoff: true });

  const out: StandsRung[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    const r = rung(s);
    if (r === null || seen.has(r.block)) continue;
    seen.add(r.block);
    out.push(r);
  }
  return out;
}

/** One rung's block, and what it carries; null for nothing to say. */
function render(
  all: readonly Mention[],
  c: Choice,
  liveHs: readonly Handoff[],
  others: readonly Handoff[],
  opts: { day: number; lifeDays: number; reader: string | null; plans: PlansSince | null; aboutMe: string | null; planIds: readonly string[] },
): StandsRung | null {
  const entries = group(all);
  const kept = c.under ? entries : entries.slice(0, 1);
  const mentions = kept.flatMap((e) => e.mentions);
  const lines: string[] = [];
  const bytesOf = new Map<string, number>();
  let chapterBytes = 0;
  kept.forEach((e, i) => {
    const w = entryWords(e, opts.reader);
    if (w.handoffId !== null) bytesOf.set(w.handoffId, w.handoffBytes);
    chapterBytes += w.chapterBytes;
    const lead = kept[0];
    const word = i === 0 ? STANDS_HEAD : lead !== undefined && e.at > lead.at ? STANDS_SINCE : STANDS_BEFORE;
    lines.push(flatten(`${word} ${w.head}`), ...w.lead);
  });
  const hasEntry = lines.length > 0;
  // The other handoffs a line each, while their newest has its own.
  const leadShown = liveHs.filter((h) => bytesOf.has(h.id));
  const otherShown = leadShown.length === 0 ? [] : others.slice(0, c.others);
  if (otherShown.length > 0) {
    lines.push(STANDS_OTHERS);
    for (const h of otherShown) {
      const l = otherLine(h, opts.reader);
      bytesOf.set(h.id, byteLengthOf(l) + 1);
      lines.push(l);
    }
  }
  const shown = [...leadShown, ...otherShown];
  const door = hasEntry ? doorWords(shown, liveHs, opts.day, opts.lifeDays) : null;
  if (door !== null) lines.push(flatten(door));
  const since = opts.plans === null || !hasEntry ? null : sinceLine(opts.plans, liveHs.length > 1);
  if (since !== null) lines.push(flatten(since));
  if (opts.aboutMe !== null) lines.push(flatten(opts.aboutMe));
  if (lines.length === 0) return null;
  return {
    block: lines.join("\n"),
    shown,
    handoffBytes: shown.map((h) => bytesOf.get(h.id) ?? 0),
    live: liveHs.length,
    plans: since === null ? [] : opts.planIds,
    chapter: mentions.some((m) => m.kind === "later" || m.kind === "chapter"),
    chapterBytes,
    said: mentions.some((m) => m.kind === "said"),
    aboutMe: opts.aboutMe !== null,
    aboutMeBytes: opts.aboutMe === null ? 0 : byteLengthOf(flatten(opts.aboutMe)) + 1,
  };
}

/** The mentions by session: the handoff's entry first, then the newest first; ties by key. */
function group(mentions: readonly Mention[]): Entry[] {
  const entries = new Map<string, Entry>();
  for (const m of mentions) {
    const key = m.session === null || m.session.length === 0 ? `handoff:${m.kind === "handoff" ? m.h.handoff.id : ""}` : `session:${m.session}`;
    const e = entries.get(key);
    entries.set(key, e === undefined ? { key, at: m.at, mentions: [m] } : { key, at: Math.max(e.at, m.at), mentions: [...e.mentions, m] });
  }
  return [...entries.values()].sort(
    (a, b) =>
      Number(b.mentions.some((m) => m.kind === "handoff")) - Number(a.mentions.some((m) => m.kind === "handoff")) ||
      b.at - a.at ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * THE BYTES THE BOUNDARY RESERVES FOR THIS FOLDER'S HANDOFFS, widest first
 * (`Handoffs#liveBlockBytesByScope`): the block with the handoffs alone, as a
 * delivery would say them, since the reserve is sized to the words that exist.
 */
export function handoffRungBytes(handoffs: readonly StandsHandoff[], day: number, plans: PlansSince | null): number[] {
  return standsLadder({ handoffs, day, plans }).map((r) => byteLengthOf(r.block));
}

/**
 * THE BYTES OF THE CHAPTER'S PART ALONE, widest first
 * (`Counterpart#handoffRoom`): the reserve's "Last here" term.
 */
export function chapterRungBytes(facts: LastHereFacts, day: number, reader: string | null): number[] {
  return standsLadder({ handoffs: [], day, reader, ...facts }).map((r) => byteLengthOf(r.block));
}

/** One live handoff as the `handoffs here` handle lists it. */
export interface HandoffListed {
  readonly id: string;
  readonly writtenOn: string;
  readonly session: string | null;
  readonly model: string | null;
  /** Its first sentence, as the line would say it. */
  readonly excerpt: string;
  /** Lived days until it stops showing. */
  readonly daysLeft: number;
}

/** This folder's live handoffs for the `handoffs here` handle, newest first. Pure. */
export function handoffsListed(handoffs: readonly Handoff[], day: number, lifeDays = HANDOFF_LIFE_DAYS): HandoffListed[] {
  return handoffs
    .filter((h) => !expired(h, day, lifeDays))
    .map((h) => ({
      id: h.id,
      writtenOn: h.writtenOn,
      session: h.session,
      model: h.model ?? null,
      excerpt: excerpt(h.body),
      daysLeft: h.writtenDay === null ? lifeDays : daysLeft(h.writtenDay, day, lifeDays),
    }));
}

// ── the module ──────────────────────────────────────────────────────────────

export interface HandoffsOptions {
  readonly store: Store;
  readonly gate: HandoffGate;
  readonly observer?: boolean;
  readonly onEvent?: (e: {
    at: number;
    name: string;
    ref?: string;
    data?: Record<string, string | number | boolean | null>;
  }) => void;
  readonly now?: () => number;
  /**
   * The memories a later one settled over (`self/index.ts#settledOver`), which
   * no wake line shows; asked only when there is something to name. Passed in
   * by the root, because `handoff/` depends on `store/` and nothing else.
   */
  readonly settled?: () => ReadonlySet<string>;
  /**
   * The memories the published wake already lists under "Still open:"
   * (`self/index.ts#threadsShown`), which the "since" line leaves to that
   * lane rather than name twice (review of #332). Asked only when there is
   * something to name; passed in by the root, as `settled` is.
   */
  readonly listed?: () => ReadonlySet<string>;
}

export interface WriteInput {
  readonly body: string;
  /** The canonical directory this handoff is about. Required and non-empty. */
  readonly scope: string;
  readonly session?: string | null;
  /** The writing session's model id, when the host said which (2026-09-30). */
  readonly model?: string | null;
  /** The Counterparts version the writing process runs (2026-10-01). */
  readonly build?: string | null;
  readonly day?: number;
}

export class Handoffs {
  private readonly store: Store;
  private readonly gate: HandoffGate;
  private readonly observer: boolean;
  private readonly onEvent: HandoffsOptions["onEvent"];
  private readonly nowFn: () => number;
  private readonly settled: (() => ReadonlySet<string>) | undefined;
  private readonly listed: (() => ReadonlySet<string>) | undefined;

  constructor(opts: HandoffsOptions) {
    this.store = opts.store;
    this.gate = opts.gate;
    this.observer = opts.observer === true;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? Date.now;
    this.settled = opts.settled;
    this.listed = opts.listed;
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    this.onEvent?.({
      at: this.nowFn(),
      name,
      ...(ref === undefined ? {} : { ref }),
      ...(data === undefined ? {} : { data }),
    });
  }

  /** This directory's NEWEST live, unexpired handoff, whoever wrote it, or null. */
  read(scope: string, day?: number): Handoff | null {
    return this.readAll(scope, day)[0] ?? null;
  }

  /** Every live, unexpired handoff for this directory — one per writing
   *  session, newest first (2026-09-30). */
  readAll(scope: string, day?: number): Handoff[] {
    return liveHandoffsFor(this.store, scope, day ?? this.store.livedDay());
  }

  /** A row whatever its age — this directory's newest, or with `session`
   *  given, THAT session's: the door `write` revises. */
  readAny(scope: string, session?: string | null): Handoff | null {
    return readHandoff(this.store, scope, session);
  }

  /**
   * DOES ANY DIRECTORY HOLD A LIVE POINTER? Kept because it reads as the
   * question it is, and because the doctor and the tests ask it.
   */
  anyLive(day?: number): boolean {
    return this.liveBlockBytes(day).length > 0;
  }

  /**
   * THE BYTE LENGTHS OF EVERY BLOCK A DELIVERY MIGHT SPLICE — what the boundary
   * hands `reserveBytes`, which reserves for the widest one the share rule
   * allows.
   *
   * Per DIRECTORY, and for a directory with several handoffs every rung of its
   * ladder (`handoff/#handoffRungBytes`: every line, then fewer), so
   * a ceiling that cannot afford room for three can still afford room for one.
   * Per directory and per writing session, never per row: a race's loser is
   * invisible to every read, and before `newestPerScope` it went on holding
   * the reserve open until it expired (adversarial review MINOR-8). The walk is
   * bounded by the number of directories the owner has worked in, and it never
   * throws — a store that will not answer reserves nothing, which composes the
   * wake master composes.
   */
  liveBlockBytes(day?: number): number[] {
    return [...this.liveBlockBytesByScope(day).values()].flat();
  }

  /** `liveBlockBytes`, kept per directory (2026-09-30) — so the boundary can
   *  size a directory's handoff together with its "Last here" line. */
  liveBlockBytesByScope(day?: number): Map<string, number[]> {
    const d = day ?? this.store.livedDay();
    const out = new Map<string, number[]>();
    // ONE walk, not one per directory. The first draft called `readHandoff`
    // per scope, and each of those walks the store again — D+1 walks for D
    // directories, at every boundary, for a number that is the same shape as
    // the one already in hand.
    const byScope = new Map<string, LiveRow[]>();
    for (const row of liveHandoffRows(this.store)) {
      if (row.scope.length === 0) continue;
      const held = byScope.get(row.scope);
      if (held === undefined) byScope.set(row.scope, [row]);
      else held.push(row);
    }
    for (const [scope, rows] of byScope) {
      const hs = handoffsNewestFirst(this.store, rows, d, HANDOFF_LIFE_DAYS);
      // Sized to the widest "how current" words the delivery can add, which
      // it computes only then — on the newest in full, the rest a stamp.
      // What was planned here since the newest, as it stands now (2026-10-09):
      // sized to the line that exists, as the rest of the block is.
      const plans = hs[0] === undefined ? null : this.plansSince(scope, hs[0]);
      const rungs = handoffRungBytes(hs.map((h, i) => ({ handoff: h, at: null, since: i === 0 ? WIDEST_POINTER_SINCE : null })), d, plans);
      if (rungs.length > 0) out.set(scope, rungs);
    }
    return out;
  }

  /**
   * THE ONE SEAM THAT WRITES A HANDOFF. Refusals are named and durable, as the
   * page's are: there is no silent no-op on this path.
   */
  write(input: WriteInput): HandoffWrite {
    const day = input.day ?? this.store.livedDay();
    const draft = input.body.replace(/\r\n/g, "\n").trim();
    let bytes = byteLengthOf(draft);
    const scope = input.scope.trim();
    const session = sessionKey(input.session);
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null } as const;
    const refuse = (
      reason: HandoffRefusal,
      detail: Record<string, string | number | boolean> = {},
      extra: Partial<HandoffWrite> = {},
    ): HandoffWrite => this.refuse(reason, { day, session, bytes, ...detail }, { ...none, ...extra });

    if (this.observer) {
      // The stand-down writes nothing at all, the durable row included: an
      // instrument that logged its own refusal would be changing the store it is
      // reading (observer-mode G3).
      this.emit("handoff.observer.standdown", undefined, { site: "write" });
      return { ...none, written: false, reason: "observer", bytes };
    }
    // NO SCOPE, NO POINTER — and the rule lives HERE rather than at the MCP
    // door, which is what makes the refusal durable (adversarial review
    // MAJOR-2a: the adapter's own short-circuit wrote a ring event and no row,
    // so guarantee 3 was false on the only live entrance).
    //
    // Two shapes of "no place to be about": a host that named no directory at
    // all, and one whose only answer was the STORE'S OWN directory — which is
    // `resolveScope`'s last resort, "a bad answer… kept only because a server
    // with no scope at all cannot deposit". A pointer filed there is about
    // nowhere and every session in every project would be handed it.
    if (scope.length === 0 || sameDirectory(scope, this.store.dir)) {
      return refuse("no-scope", {});
    }
    // AN EMPTY BODY IS A CLEAR, not a refusal, and the caller decides which it
    // meant by what it passed: `write("")` is unreachable from the live door,
    // which routes a present-but-blank field to `clear()`. A direct caller that
    // reaches here with nothing still gets the named, durable refusal.
    if (draft.length === 0) return refuse("empty", {});
    if (bytes > HANDOFF_MAX_BYTES) {
      return refuse("too-large", { bytes, limit: HANDOFF_MAX_BYTES });
    }
    if (draft.includes(WAKE_MARKER)) return refuse("forged-markers", { bytes });
    // THE BATTERY, on the handoff as on the page and the journal (SEAMS H). A
    // handoff is written in a hurry at the end of a session and is exactly the
    // kind of prose a token gets pasted into.
    const verdict = this.gate({ text: draft, handles: [], sessionId: `handoff:${session ?? ""}` });
    if (!verdict.ok) {
      return refuse(
        "gate-refused",
        { bytes, gate: verdict.gate, gateReason: verdict.reason },
        { gate: { gate: verdict.gate, reason: verdict.reason } },
      );
    }
    // THE GATE'S TEXT, and never the draft as a fallback. The first draft read
    // `verdict.text.length > 0 ? verdict.text : draft`, so a gate that ever
    // accepted a body that redacted down to NOTHING would have stored the
    // ORIGINAL, unredacted words — a trapdoor pointing the wrong way
    // (adversarial review MINOR-7). Unreachable today, because
    // `empty-after-redaction` refuses that case first; a latent hole in a
    // redaction path is worth one line whether or not anything can reach it.
    const text = verdict.text ?? draft;
    if (text.length === 0) return refuse("empty-after-gate", {});
    const redacted = text === draft ? null : { gate: "secrets", bytesBefore: bytes };
    bytes = byteLengthOf(text);

    const meta: Record<string, unknown> = {
      role: HANDOFF_ROLE,
      [HANDOFF_META_SCOPE]: scope,
      [HANDOFF_META_WRITTEN_ON]: this.store.today(),
      [HANDOFF_META_WRITTEN_DAY]: day,
      [HANDOFF_META_SESSION]: session,
      [HANDOFF_META_WRITTEN_AT]: this.nowFn(),
      // A value that is not a plain model id is no mark: it would be printed
      // into the wake. Left out rather than stored as null, so a row says
      // nothing it does not know.
      ...(isModelId(input.model) ? { [HANDOFF_META_MODEL]: input.model } : {}),
      // The release that wrote it (2026-10-01): what "written on 0.3.9, 0.3.10
      // now" compares (`staleWords`). Left out when the caller knew none.
      ...(isVersion(input.build) ? { [HANDOFF_META_BUILD]: input.build } : {}),
    };
    // THIS SESSION'S row here, and only its own (2026-09-30): a different
    // session in the same directory mints its own rather than overwriting the
    // one that stood, which is what "last writer wins" cost when several
    // sessions work in one repo at once.
    const existing = findHandoffRow(this.store, scope, session);
    let id: string;
    let version: number;
    // THE STORE'S OWN REFUSALS ARE NAMED TOO. `put` and `revise` refuse inputs
    // of their own — a body that is whitespace or NUL only, a lone surrogate
    // (F5, the floor) — and an uncaught throw here would leave the caller a
    // thrown error and the owner no row, which is MAJOR-2's shape on a
    // different input. The store's verdict is the truth and is reported as
    // such rather than second-guessed: nothing here pre-strips a body to get
    // past a refusal that exists for a reason.
    try {
      if (existing === null) {
        id = this.store.put({
          type: "schema",
          kind: HANDOFF_KIND,
          title: handoffTitle(scope),
          body: text,
          meta,
          learnedOn: this.store.today(),
          // NOT protected, on purpose: this is the one standing row in the
          // store that is meant to be let go, and `protected` is what would
          // stop the prune from ever doing it.
        });
        version = 0;
      } else {
        id = existing;
        version = this.store.revise(id, {
          body: text,
          title: handoffTitle(scope),
          meta,
          reason: "handoff",
        });
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      return refuse("store-refused", { bytes, code: typeof code === "string" ? code : "UNKNOWN" });
    }
    // THE DWELL CLOCK, RESET. `store.revise` writes the body and a version row
    // and touches no physics column, so a row born on day 1 and rewritten on day
    // 200 still reads `lastUsedDay = 1` — dwell 199, strength under the floor,
    // and `pruneVerdict` archives a pointer that was written this morning.
    // Moving the clock to the write is what makes "a live pointer is never
    // pruned out from under the wake" true rather than hoped for.
    this.store.updatePhysics(id, { lastUsedDay: day });
    // A RACE'S LOSERS ARE RETIRED HERE, where a write for this scope is already
    // happening. `findHandoffRow` now picks the newest, so a duplicate is
    // already invisible to every read; archiving it is what stops it holding
    // the reserve open until it expires (adversarial review MINOR-8).
    for (const stale of duplicateHandoffRows(this.store, scope, session)) {
      if (stale === id) continue;
      try {
        this.store.archive(stale, "handoff-duplicate");
        this.emit("handoff.duplicate.retired", stale, {});
      } catch {
        /* a duplicate that will not archive is still not the one that is read */
      }
    }
    this.store.appendEvent({
      name: HANDOFF_WRITTEN_EVENT,
      day,
      ref: id,
      payload: {
        // THE SCOPE AS A LENGTH, never the path: telemetry is ids, counts,
        // bytes, reasons and flags, and a directory path is neither (store §5
        // G10). Which directory it was is on the row, where the owner reads it.
        session,
        bytes,
        version,
        created: existing === null,
        ...(redacted === null ? {} : { redacted: true, redactedBy: redacted.gate }),
        lifeDays: HANDOFF_LIFE_DAYS,
      },
    });
    this.emit(HANDOFF_WRITTEN_EVENT, id, {
      bytes,
      version,
      created: existing === null,
    });
    return {
      written: true,
      reason: existing === null ? "created" : "revised",
      id,
      version,
      bytes,
      gate: null,
      redacted,
      showsForDays: HANDOFF_LIFE_DAYS,
      others: this.neighbours(scope, session, day),
    };
  }

  /**
   * THE OTHER SESSIONS' LIVE HANDOFFS HERE, newest first — what a write hands
   * back so the writer can retire, in the same call, any whose work it has
   * finished (review of #295, MAJOR-1: per-session handoffs pile up unless
   * the session that finishes the work is told they are there). Never throws;
   * a store that will not answer names none.
   */
  private neighbours(scope: string, session: string | null, day: number): HandoffNeighbour[] {
    try {
      return this.readAll(scope, day)
        .filter((h) => h.session !== session)
        .map((h) => ({ id: h.id, session: h.session, writtenOn: h.writtenOn, excerpt: excerpt(h.body) }));
    } catch {
      return [];
    }
  }

  /**
   * WHAT WAS PLANNED HERE SINCE THIS HANDOFF (2026-10-09): the memories this
   * directory's sessions wrote by hand after its words were written whose
   * status is a plan or a next step (`PLAN_STATUSES`) or that are still
   * flagged `unresolved` — newest first, `SINCE_SHOWN` of them named and the
   * rest counted. A session that wrote a handoff and later changed the plan
   * in a note, without rewriting the handoff, left the newer memory quiet:
   * the pointer was the only place a waking session was told to resume from.
   *
   * Its own session's memories count, except what it wrote within
   * `SINCE_SAME_ANSWER_MS` of the handoff, which is the same answer. Left
   * out: what a later memory settled over, what the published wake already
   * lists under "Still open:" (`HandoffsOptions.listed`), a journal chapter's
   * copy. The
   * columns are read first (`Store#planCandidates`), then the prose of what
   * comes back. Never throws: a store that will not answer names nothing.
   */
  plansSince(scope: string, h: Handoff): PlansSince {
    const none: PlansSince = { items: [], more: 0 };
    try {
      const after = this.writtenAt(h);
      if (after === null) return none;
      const ids = this.store.planCandidates({
        scopes: scopeSpellings(scope),
        after,
        statuses: PLAN_STATUSES,
        limit: SINCE_READ,
      });
      if (ids.length === 0) return none;
      const ask = (f: (() => ReadonlySet<string>) | undefined): ReadonlySet<string> => {
        try {
          return f?.() ?? new Set();
        } catch {
          return new Set();
        }
      };
      const settled = ask(this.settled);
      // ONE PLACE FOR AN OPEN QUESTION (review of #332): one the published
      // wake already lists under "Still open:" is left to that lane. One it
      // does not — opened since the last boundary, or past the lane's cap,
      // which takes the oldest first — is named here.
      const listed = ask(this.listed);
      const found: PlanSince[] = [];
      for (const id of ids) {
        if (settled.has(id) || listed.has(id)) continue;
        const row = this.store.row(id);
        if (row === undefined) continue;
        if (h.session !== null && row.origin_session === h.session && (row.created_at ?? 0) - after <= SINCE_SAME_ANSWER_MS) {
          continue;
        }
        let doc: ProseDoc;
        try {
          doc = this.store.readProse(id);
        } catch {
          continue;
        }
        if (typeof doc.meta["episodeId"] === "string") continue;
        const word = planWord(row.status ?? null, doc.meta["unresolved"] === true);
        if (word === null) continue;
        const title = flatten(doc.title ?? "");
        const text = excerpt(title.length > 0 ? title : doc.body, SINCE_TITLE_BYTES);
        if (text.length === 0) continue;
        found.push({ id, title: text, word });
      }
      return { items: found.slice(0, SINCE_SHOWN), more: Math.max(0, found.length - SINCE_SHOWN) };
    } catch {
      return none;
    }
  }

  /**
   * WHEN THIS HANDOFF'S WORDS WERE WRITTEN, epoch ms: its newest
   * `handoff.written` row (the log keeps ~90 lived days; a pointer lives 14).
   * Null when no row says.
   */
  writtenAt(h: Handoff): number | null {
    try {
      const row = this.store.eventLog({ name: HANDOFF_WRITTEN_EVENT, ref: h.id, order: "desc", limit: 1 })[0];
      return row === undefined ? (h.writtenAt ?? null) : row.at;
    } catch {
      return h.writtenAt ?? null;
    }
  }

  /**
   * The durable row a SHOWN pointer leaves — ONCE per handoff per lived day
   * (one per directory until 2026-09-30, when a directory began to hold one
   * per session; each shown in full gets its own row).
   *
   * It was one row per wake, which is consistent with `wake.injected` and is
   * still the wrong shape for the one question the row exists to answer.
   * CONTRACT §8 names `handoff.shown`'s `ageDays` as the measurement that would
   * settle the fortnight; measured, 40 wakes of one session in one directory
   * wrote 40 rows (adversarial review MINOR-2), so that distribution would have
   * been dominated by a session re-waking rather than by distinct pickups.
   *
   * `dedupKey` is the store's own latch and returns 0 when it refuses a repeat,
   * so "recorded" and "already recorded today" stay tellable apart. The key is
   * the ROW's id and the lived day — never the directory, which is a path
   * (§5 G10).
   */
  noteShown(h: Handoff, opts: { bytes: number; session?: string | null; day?: number; among?: number; plans?: number }): void {
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "noteShown" });
      return;
    }
    const day = opts.day ?? this.store.livedDay();
    let seq = 0;
    try {
      seq = this.store.appendEvent({
        name: HANDOFF_SHOWN_EVENT,
        day,
        ref: h.id,
        dedupKey: `${HANDOFF_SHOWN_EVENT}:${h.id}:${day}`,
        payload: {
          session: opts.session ?? null,
          bytes: opts.bytes,
          ageDays: h.writtenDay === null ? null : day - h.writtenDay,
          version: h.version,
          // How many live handoffs the directory held when this one was shown
          // (2026-09-30) — absent when it was the only one.
          ...(opts.among === undefined || opts.among <= 1 ? {} : { among: opts.among }),
          // How many memories the "since" line named beside it (2026-10-09) —
          // absent when it named none.
          ...(opts.plans === undefined || opts.plans <= 0 ? {} : { plans: opts.plans }),
        },
      });
    } catch {
      /* a pointer that was shown and could not be logged was still shown */
    }
    this.emit(HANDOFF_SHOWN_EVENT, h.id, { bytes: opts.bytes, first: seq !== 0 });
  }

  /**
   * NO ROOM FOR THE POINTER at this ceiling — the documented one-boundary lag,
   * and a tripwire if it ever stops being temporary.
   *
   * It was ring-only, and `Counterpart.emit` pushes to an in-process ring while
   * every hook is its own process, so the exact shape the brief asked the
   * reviewer to hunt — "the pointer stops being delivered and nothing says so" —
   * was real for the whole lag window (adversarial review MINOR-1). It is a
   * REFUSAL row rather than a fourth event name: a cap turning the pointer away
   * is this mechanism working out loud, which is what `handoff.refused` already
   * means. Deduped per row per lived day, so a lag that lasts a day is one row
   * and a lag that lasts a fortnight is fourteen.
   */
  noteNoRoom(h: Handoff, opts: { bytes: number; budget: number; day?: number }): void {
    if (this.observer) return;
    const day = opts.day ?? this.store.livedDay();
    this.refuse(
      "no-room",
      { day, session: null, bytes: opts.bytes, budget: opts.budget },
      { id: h.id, version: null, gate: null, redacted: null, showsForDays: null },
      `${HANDOFF_REFUSED_EVENT}:no-room:${h.id}:${day}`,
      h.id,
    );
  }

  /**
   * CLEAR THIS SESSION'S POINTER FOR THIS DIRECTORY — the retirement that had
   * no door. Only the caller's own (2026-09-30): the others standing here were
   * written by sessions that may still be working, and `retire` is the door for
   * one whose work this session finished.
   *
   * CONTRACT open question 3, closed: the ask fires up to six times a session,
   * so a session can write "half done" at the first and finish the work by the
   * last, and leaving the field out leaves the stale pointer standing for
   * whoever opens the directory next. A model that means "it is done" reaches
   * for `handoff: ""`, which used to be total silence (adversarial review
   * MAJOR-2b). A PRESENT but blank field is now this.
   *
   * The row is ARCHIVED, which is the ordinary means: the words stay readable
   * on the row for an owner who asks for it by id, every reader here filters
   * `archived: false` so the pointer is gone from the wake and from the
   * reserve, and the next handoff for this directory mints a fresh row rather
   * than reviving a retired one. An ABSENT field still means "leave what
   * stands"; that is the ordinary case and it is right.
   */
  clear(scope: string, opts: { session?: string | null; day?: number } = {}): HandoffWrite {
    const day = opts.day ?? this.store.livedDay();
    const session = sessionKey(opts.session);
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null } as const;
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "clear" });
      return { ...none, written: false, reason: "observer", bytes: 0 };
    }
    const trimmed = scope.trim();
    if (trimmed.length === 0 || sameDirectory(trimmed, this.store.dir)) {
      return this.refuse("no-scope", { day, session, bytes: 0 }, none);
    }
    const h = readHandoff(this.store, trimmed, session);
    if (h === null) {
      // NOTHING TO CLEAR is not a failure and not a silence: a session that
      // finished work in a directory where it never left a pointer said
      // something true, and the row says so.
      return this.refuse("nothing-to-clear", { day, session, bytes: 0 }, none);
    }
    for (const id of [h.id, ...duplicateHandoffRows(this.store, trimmed, session)]) {
      this.store.archive(id, "handoff-cleared");
    }
    this.store.appendEvent({
      name: HANDOFF_CLEARED_EVENT,
      day,
      ref: h.id,
      payload: { session, bytes: h.bytes, version: h.version },
    });
    this.emit(HANDOFF_CLEARED_EVENT, h.id, { bytes: h.bytes });
    return { ...none, written: true, reason: "cleared", id: h.id, bytes: h.bytes };
  }

  /**
   * RETIRE ONE HANDOFF IN THIS DIRECTORY BY ITS ID, whoever wrote it
   * (2026-09-30). Per-session handoffs accumulate — a session that picks up
   * another's work and finishes it could otherwise only leave the old pointer
   * standing for the rest of its fortnight. The id is what the wake prints.
   *
   * Only a handoff filed under THIS directory and not yet retired: an id that
   * is anything else — another directory's, an archived one, not a handoff — is `not-here`,
   * one durable refusal, and nothing is touched. Retiring is the same archive
   * `clear` does, and leaves the same `handoff.cleared` row, which says whose
   * it was and that it went by id.
   */
  retire(id: string, opts: { scope: string; session?: string | null; day?: number }): HandoffWrite {
    const day = opts.day ?? this.store.livedDay();
    const session = sessionKey(opts.session);
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null } as const;
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "retire" });
      return { ...none, written: false, reason: "observer", bytes: 0 };
    }
    const scope = opts.scope.trim();
    if (scope.length === 0 || sameDirectory(scope, this.store.dir)) {
      return this.refuse("no-scope", { day, session, bytes: 0 }, none);
    }
    const want = id.trim();
    const live = liveHandoffRows(this.store).find((r) => r.id === want && r.scope === scope);
    const h = live === undefined ? null : handoffOf(this.store, live);
    if (h === null) return this.refuse("not-here", { day, session, bytes: 0 }, none);
    // A race's losers for the retired row's own key go with it, as `clear`
    // takes them: left standing, one would surface as the pointer just retired.
    for (const stale of [h.id, ...duplicateHandoffRows(this.store, scope, h.session).filter((d) => d !== h.id)]) {
      this.store.archive(stale, "handoff-cleared");
    }
    this.store.appendEvent({
      name: HANDOFF_CLEARED_EVENT,
      day,
      ref: h.id,
      payload: { session, bytes: h.bytes, version: h.version, byId: true, author: h.session },
    });
    this.emit(HANDOFF_CLEARED_EVENT, h.id, { bytes: h.bytes, byId: true });
    return { ...none, written: true, reason: "cleared", id: h.id, bytes: h.bytes };
  }

  /**
   * A NAMED REFUSAL FROM A DOOR, for the shapes this module cannot judge for
   * itself — today, a `handoff` field that is present and is not text. The
   * adapter knows what arrived on the wire; the durable row is still this
   * module's to write, so guarantee 3 has one owner.
   */
  refuseWrite(
    reason: HandoffRefusal,
    opts: { session?: string | null; day?: number } = {},
  ): HandoffWrite {
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null } as const;
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "refuseWrite" });
      return { ...none, written: false, reason: "observer", bytes: 0 };
    }
    return this.refuse(
      reason,
      { day: opts.day ?? this.store.livedDay(), session: opts.session ?? null, bytes: 0 },
      none,
    );
  }

  /** One refusal, one ring event and one durable row. Every named refusal in
   *  this module comes through here, which is what makes guarantee 3 checkable
   *  in one place rather than at six call sites. */
  private refuse(
    reason: HandoffRefusal,
    detail: { day: number; session: string | null; bytes: number } & Record<
      string,
      string | number | boolean | null
    >,
    base: Omit<HandoffWrite, "written" | "reason" | "bytes">,
    dedupKey?: string,
    ref?: string,
  ): HandoffWrite {
    const { day, ...payload } = detail;
    this.emit(HANDOFF_REFUSED_EVENT, ref, { reason, bytes: detail.bytes });
    try {
      this.store.appendEvent({
        name: HANDOFF_REFUSED_EVENT,
        day,
        ...(ref === undefined ? {} : { ref }),
        ...(dedupKey === undefined ? {} : { dedupKey }),
        payload: { reason, ...payload },
      });
    } catch {
      /* a refusal that cannot be recorded is still a refusal */
    }
    return { ...base, written: false, reason, bytes: detail.bytes };
  }
}

/**
 * Two directory strings naming the same place, for the one comparison this
 * module makes: is the scope the store's own directory? Canonicalisation is the
 * ADAPTER's (`adapters/sessions.ts#canonicalScope`), and both live callers do
 * it; this only has to survive a trailing slash.
 */
function sameDirectory(a: string, b: string): boolean {
  const norm = (s: string): string => s.replace(/\/+$/, "");
  return norm(a.trim()) === norm(b.trim());
}

/** The title the row carries, so every id-listing surface names it in words. */
export function handoffTitle(scope: string): string {
  return `Handoff — ${scope}`;
}
