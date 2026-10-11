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
 * THE CEILING ON THE RESERVE, in bytes — the widest block this module can
 * produce, measured by a test at a full-width excerpt, a real id and a six-digit
 * lived day. It is a CEILING and not the reserve: see `reserveBytes`.
 *
 * 448 while a directory held one pointer. Since 2026-09-30 the widest block is
 * the several-handoff one — three shown in full at full-width excerpts, the
 * widest model id `isModelId` admits, five more named by id — measured at 1,389
 * (1,319 before the door line named `retireHandoff`, review of #295), and
 * 1,431 since the newest says how far its work since is written up
 * (2026-09-30), and 1,646 since each says why it may be out of date — an
 * older release wrote it, or a newer chapter was written here (2026-10-01).
 * 1,963 since a "since" line can follow it (2026-10-09): three plans at the
 * title cap and a count, 317 bytes on the widest block (1,646).
 * In practice the share rule binds first: at the 9,000 bytes the owner's hosts
 * report, no reserve can pass 1,125, so a block that wide is carried with two
 * shown rather than three.
 */
export const HANDOFF_RESERVE_MAX_BYTES = 1963;

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
 * the wake can say a handoff was "written before 0.3.10 was installed".
 * Absent on a row written before then, which falls back to the version the
 * writing session OPENED with, from the host's registry (`WakeHere`).
 */
export const HANDOFF_META_BUILD = "build";
/** The longest version string the wake prints; a longer one is not printed. */
export const HANDOFF_VERSION_MAX_CHARS = 16;

/**
 * HOW MANY HANDOFFS ONE WAKE SHOWS IN FULL for a directory, newest first. The
 * rest are named by id on one line (`HANDOFF_WAKE_LISTED` of them) so a
 * session can still expand or retire them. Three is a working default: enough
 * for the builds that are really in flight in one repo on a busy day, few
 * enough that the reserve stays inside the share rule at the ceilings the
 * owner's hosts report.
 */
export const HANDOFF_WAKE_SHOWN = 3;

/** How many further handoffs the "+N older" line names by id; past it, a count. */
export const HANDOFF_WAKE_LISTED = 5;

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
 * WHY A HANDOFF MAY BE OUT OF DATE, in words (2026-10-01, random-f2's item 1):
 * "before 0.3.10 was installed" when the process that wrote it ran an older
 * release than the one installed now, and "a newer chapter here since" when a
 * session wrote a chapter in this directory after it. Computed at delivery
 * from records that already exist; nothing judges whether what it waited on
 * happened. Null when neither holds.
 */
export function staleWords(opts: {
  readonly writtenWith?: string | null;
  readonly installed?: string | null;
  readonly newerChapter?: boolean;
}): string | null {
  const parts: string[] = [];
  if (versionOlder(opts.writtenWith, opts.installed)) parts.push(`before ${opts.installed as string} was installed`);
  if (opts.newerChapter === true) parts.push("a newer chapter here since");
  return parts.length === 0 ? null : parts.join(", and ");
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
  if (byteLengthOf(first) <= capBytes) return first;
  // The ellipsis is THREE bytes, not one: `…` is U+2026. Reserving a character
  // rather than its bytes is how a cap that says 160 renders 161 — measured,
  // not reasoned about.
  const room = Math.max(0, capBytes - byteLengthOf(ELLIPSIS));
  const bytes = new TextEncoder().encode(first);
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, room));
  const clean = prefix.replace(/�+$/u, "");
  const space = clean.lastIndexOf(" ");
  const kept = space > clean.length * 0.8 ? clean.slice(0, space) : clean;
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

/**
 * HOW CURRENT THE POINTER IS (2026-09-30), computed at delivery by whoever
 * splices it: when it was written, as a person reads it in the store's zone,
 * and — when sessions here captured work after that, past the owed floor —
 * when that work ran (the pieces' own times, never the registry's boundary
 * clock, which a close bumps) and whether it has been written up since.
 */
export interface PointerSince {
  /** `09-29 12:47`. */
  readonly written: string;
  /** `from` and `to` as the caller spells them: `13:02`, or `09-30 13:02`
   *  when the day is not the one before it. */
  readonly after: {
    readonly from: string;
    readonly to: string;
    readonly writtenUp: boolean;
    /**
     * HOW FAR it is written up when it is not wholly (2026-09-30): the time of
     * the latest claim on that work, spelled as `to` is, and what made it
     * (`chapter`, `memories`, …). Absent or null: nothing of it is written up.
     */
    readonly upTo?: string | null;
    readonly by?: string | null;
    /** Pieces of that work not written up, and how many of them came after `upTo`. */
    readonly unwritten?: number;
    readonly unwrittenAfter?: number;
  } | null;
  /** Why it may be out of date (`staleWords`), or null/absent. */
  readonly stale?: string | null;
}

/** The widest `PointerSince` the words can take — what the reserve is sized to. */
export const WIDEST_POINTER_SINCE: PointerSince = {
  written: "12-31 23:59",
  after: {
    from: "12-31 23:59",
    to: "12-31 23:59",
    writtenUp: false,
    upTo: "12-31 23:59",
    // The widest of the written-up forms: "nothing new to write up as of …".
    by: "nothing new",
    unwritten: 9999,
    unwrittenAfter: 0,
  },
  stale: staleWords({ writtenWith: "0", installed: "9".repeat(HANDOFF_VERSION_MAX_CHARS), newerChapter: true }),
};

/** The widest stamp an OLDER entry of a several-handoff block can carry —
 *  what the reserve sizes the entries after the newest to. */
const WIDEST_OLDER_SINCE: PointerSince = { written: "12-31 23:59", after: null, stale: WIDEST_POINTER_SINCE.stale ?? null };

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

/**
 * HOW MUCH OF THE WORK SINCE IS WRITTEN UP, in words (2026-09-30). "Not yet
 * written up" only when nothing of it is: a chapter at 17:50 and three turns
 * after it read as "not yet written up" while the answer was yes or no, which
 * told the next session there was nothing to read (the continuity test).
 */
function writtenUpWords(after: NonNullable<PointerSince["after"]>): string {
  if (after.writtenUp) return "written up since";
  if (after.upTo === undefined || after.upTo === null || after.upTo.length === 0) return "not yet written up";
  const n = after.unwritten ?? 0;
  const tail = n === 0 ? "" : `, ${String(n)} ${n === 1 ? "piece" : "pieces"} ${after.unwrittenAfter === n ? "after" : "not yet"}`;
  // "Nothing new" wrote nothing up: it said there was nothing to (review of
  // #300 MINOR-7).
  if (after.by === "nothing new") return `nothing new to write up as of ${after.upTo}${tail}`;
  return `written up to ${after.upTo}${after.by ? ` (${after.by})` : ""}${tail}`;
}

/** When it was written, and — for the newest — how current it is. */
function whenWords(h: Handoff, since: PointerSince | null, author: string | null = null): string {
  const by = author === null ? "" : ` by ${author}`;
  if (since === null || since.written.length === 0) {
    const on = /^\d{4}-\d{2}-\d{2}$/.test(h.writtenOn.trim()) ? h.writtenOn.trim() : "an unrecorded date";
    return `${on}${by}`;
  }
  // WHY IT MAY BE OUT OF DATE (2026-10-01), right after who and when, so it
  // is read before the handoff's own first sentence.
  const stale = since.stale === undefined || since.stale === null ? "" : `, ${since.stale}`;
  const written = `written ${since.written}${by}${stale}`;
  if (since.after === null) return written;
  return `${written}; work here ${since.after.from}\u2013${since.after.to} since, ${writtenUpWords(since.after)}`;
}

/** The pointer's first line: when it was written, by whom, how current it is,
 *  and the first sentence of what was written. `author` is left out for a row
 *  that names no session, which is the line as it read before 2026-09-30. */
export function pointerLine(
  h: Handoff,
  capBytes = HANDOFF_EXCERPT_BYTES,
  since: PointerSince | null = null,
  author: string | null = null,
): string {
  return `Where I left off in this directory (${whenWords(h, since, author)}): ${excerpt(h.body, capBytes)}`;
}

/** The pointer's second line: the door to the whole of it, and its life. */
export function pointerDoor(h: Handoff, day: number, lifeDays = HANDOFF_LIFE_DAYS): string {
  const left = h.writtenDay === null ? lifeDays : daysLeft(h.writtenDay, day, lifeDays);
  // Never "0 more days": `pointerBlock` returns null once `daysLeft` reaches 0,
  // so the smallest number this line can print is 1 — the last day it shows.
  const days = left === 1 ? "one more day" : `${Math.max(1, left)} more days`;
  return `(The whole of it is ${h.id} — expand it with the counterparts recall tool; once its work is done, retire it with session_end's retireHandoff: [id]. It stops showing after ${days} of use.)`;
}

/**
 * THE BLOCK the wake splices in for a directory with ONE live handoff, or null
 * when it has run out.
 *
 * Two lines and no heading: the pointer is FURNITURE, and furniture that opens
 * its own section costs a blank line and a heading for two lines of content.
 * Both lines are flattened, so a handoff body can never inject a line into the
 * bundle — the scar `identityCoreLine` carries (a name with newlines in it
 * forged a resolved statement into the wake). `reader` is the waking session,
 * so its own handoff reads "by this session".
 */
export function pointerBlock(
  h: Handoff,
  day: number,
  lifeDays = HANDOFF_LIFE_DAYS,
  since: PointerSince | null = null,
  reader: string | null = null,
): string | null {
  if (expired(h, day, lifeDays)) return null;
  const author = h.session === null ? null : authorWords(h, reader);
  return [
    flatten(pointerLine(h, HANDOFF_EXCERPT_BYTES, since, author)),
    flatten(pointerDoor(h, day, lifeDays)),
  ].join("\n");
}

/**
 * THE BLOCK FOR A DIRECTORY WITH SEVERAL (2026-09-30): a line saying how many,
 * the newest `shown` of them one line each — who, when, the first sentence and
 * the id — then the rest by id on one line, and one door for all of them.
 * Every line flattened, for `pointerBlock`'s reason; no `- ` bullet, because
 * the pointer is furniture and a bullet is what an element looks like.
 *
 * `since[i]` is how current the i-th one is. Only the NEWEST says whether work
 * ran here after it: for an older one the answer is always yes — the newer
 * handoffs are that work — and the words would cost a line's worth of bytes
 * each to say so.
 */
export function pointerBlockMany(
  hs: readonly Handoff[],
  day: number,
  opts: {
    readonly shown?: number;
    readonly since?: readonly (PointerSince | null)[];
    readonly reader?: string | null;
    readonly lifeDays?: number;
  } = {},
): string | null {
  const lifeDays = opts.lifeDays ?? HANDOFF_LIFE_DAYS;
  const live = hs.filter((h) => !expired(h, day, lifeDays));
  if (live.length === 0) return null;
  const shown = Math.max(1, Math.min(opts.shown ?? HANDOFF_WAKE_SHOWN, live.length));
  const reader = opts.reader ?? null;
  const lines = [
    `Where the work in this directory was left off \u2014 ${live.length} handoffs, one per session, newest first:`,
  ];
  live.slice(0, shown).forEach((h, i) => {
    const raw = opts.since?.[i] ?? null;
    const since = raw === null || i === 0 ? raw : { written: raw.written, after: null, stale: raw.stale ?? null };
    const when = whenWords(h, since);
    lines.push(`${i + 1}) From ${authorWords(h, reader)}, ${since === null ? `on ${when}` : when}: ${excerpt(h.body)} (${h.id})`);
  });
  const rest = live.slice(shown);
  if (rest.length > 0) {
    const named = rest.slice(0, HANDOFF_WAKE_LISTED).map((h) => {
      const on = /^\d{4}-(\d{2}-\d{2})$/.exec(h.writtenOn.trim())?.[1];
      return on === undefined ? h.id : `${h.id} (${on})`;
    });
    const unnamed = rest.length - named.length;
    lines.push(`+${rest.length} older here: ${named.join(", ")}${unnamed > 0 ? `, and ${unnamed} more` : ""}.`);
  }
  lines.push(
    `(Expand any of them by id with the counterparts recall tool; retire one whose work is done with session_end's retireHandoff: [id]. Each stops showing ${lifeDays} days of use after it was written.)`,
  );
  return lines.map(flatten).join("\n");
}

/**
 * THE BLOCKS A DELIVERY MAY TRY, widest first — the ladder `Counterpart` walks
 * until one fits the ceiling.
 *
 * One live handoff: its two-line block. Several: the several-handoff block
 * showing `HANDOFF_WAKE_SHOWN` of them in full, then fewer, then — last — the
 * newest one's own two-line block, which says nothing of the others. That last
 * rung is for the one-boundary lag (NOTES §2): a directory's first second
 * author appears at a boundary whose reserve was sized to one handoff, and a
 * shorter pointer that fits beats a fuller one dropped whole.
 *
 * With `plans` (2026-10-09), each of those rungs comes first with the "since"
 * line under it (`sinceLine`), and then the rungs above, unchanged. A rung's
 * `plans` is the ids its line names — none on a rung without one.
 */
export function pointerLadder(
  hs: readonly Handoff[],
  day: number,
  opts: {
    readonly since?: readonly (PointerSince | null)[];
    readonly reader?: string | null;
    readonly lifeDays?: number;
    /** What was planned here since the newest (`Handoffs#plansSince`). */
    readonly plans?: PlansSince | null;
  } = {},
): { block: string; shown: readonly Handoff[]; plans: readonly string[] }[] {
  const lifeDays = opts.lifeDays ?? HANDOFF_LIFE_DAYS;
  const live = hs.filter((h) => !expired(h, day, lifeDays));
  const first = live[0];
  if (first === undefined) return [];
  const single = pointerBlock(first, day, lifeDays, opts.since?.[0] ?? null, opts.reader ?? null);
  const out: { block: string; shown: readonly Handoff[]; several: boolean }[] = [];
  if (live.length > 1) {
    for (let k = Math.min(HANDOFF_WAKE_SHOWN, live.length); k >= 1; k--) {
      const block = pointerBlockMany(live, day, { ...opts, shown: k });
      if (block !== null) out.push({ block, shown: live.slice(0, k), several: true });
    }
  }
  if (single !== null) out.push({ block: single, shown: [first], several: false });
  // SINCE THIS HANDOFF (2026-10-09): every rung once WITH the line, widest
  // first, then every rung as it was — so a ceiling with no room for the line
  // carries today's block byte for byte. The line is tried before an older
  // handoff is kept in full: what was planned here after the newest handoff
  // is newer than any of them.
  const plans = opts.plans ?? null;
  const listed = (plans?.items ?? []).slice(0, SINCE_SHOWN).map((p) => p.id);
  const withPlans = out.flatMap((rung) => {
    const line = plans === null ? null : sinceLine(plans, rung.several);
    return line === null ? [] : [{ block: `${rung.block}\n${line}`, shown: rung.shown, plans: listed }];
  });
  return [...withPlans, ...out.map((rung) => ({ block: rung.block, shown: rung.shown, plans: [] as readonly string[] }))];
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
   * Whether a confidential memory may be named in the "since" line — the
   * owner's own session, as a confidential chapter is "last here" to the
   * owner only (2026-10-09).
   */
  readonly owner?: boolean;
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
  private readonly owner: boolean;
  private readonly settled: (() => ReadonlySet<string>) | undefined;
  private readonly listed: (() => ReadonlySet<string>) | undefined;

  constructor(opts: HandoffsOptions) {
    this.store = opts.store;
    this.gate = opts.gate;
    this.observer = opts.observer === true;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? Date.now;
    this.owner = opts.owner === true;
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
   * ladder (`pointerLadder`: three shown, two, one, and the newest alone), so
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
      const since = hs.map((_, i) => (i === 0 ? WIDEST_POINTER_SINCE : WIDEST_OLDER_SINCE));
      // What was planned here since the newest, as it stands now (2026-10-09):
      // sized to the line that exists, as the rest of the block is.
      const plans = hs[0] === undefined ? null : this.plansSince(scope, hs[0]);
      const rungs = pointerLadder(hs, d, { since, plans }).map((rung) => byteLengthOf(rung.block));
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
      // The release that wrote it (2026-10-01): what "written before 0.3.10
      // was installed" compares. Left out when the caller knew none.
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
   * THE POINTER FOR THIS WAKE, or null — the first rung of `pointerChoices`,
   * for a caller that does not need to fit a ceiling. Pure.
   */
  pointer(
    scope: string,
    day?: number,
    since?: (h: Handoff, newest: boolean) => PointerSince | null,
    reader?: string | null,
  ): { block: string; handoff: Handoff; shown: readonly Handoff[]; live: number; plans: readonly string[] } | null {
    return this.pointerChoices(scope, day, since, reader)[0] ?? null;
  }

  /**
   * EVERY BLOCK THIS WAKE MAY SPLICE, widest first (`pointerLadder`), or none.
   * Pure — it writes nothing, so a caller that finds no room can drop it
   * without having claimed it was shown. `since` is how current each shown one
   * is (`PointerSince`), asked with `newest` so the caller can skip the work
   * count for the older ones, which never print it. `reader` is the waking
   * session, so its own handoff reads "by this session".
   */
  pointerChoices(
    scope: string,
    day?: number,
    since?: (h: Handoff, newest: boolean) => PointerSince | null,
    reader?: string | null,
  ): { block: string; handoff: Handoff; shown: readonly Handoff[]; live: number; plans: readonly string[] }[] {
    const d = day ?? this.store.livedDay();
    const hs = this.readAll(scope, d);
    const first = hs[0];
    if (first === undefined) return [];
    const current = hs.slice(0, HANDOFF_WAKE_SHOWN).map((h, i) => {
      try {
        return since?.(h, i === 0) ?? null;
      } catch {
        return null;
      }
    });
    const plans = this.plansSince(scope, first);
    return pointerLadder(hs, d, { since: current, reader: reader ?? null, plans }).map((rung) => ({
      block: rung.block,
      handoff: first,
      shown: rung.shown,
      live: hs.length,
      plans: rung.plans,
    }));
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
   * copy, and a confidential memory unless the owner's (`HandoffsOptions.owner`). The
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
        confidential: this.owner,
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
