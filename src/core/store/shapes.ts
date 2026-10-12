/** The store's options and the shapes its methods take and return (moved out of `store/index.ts`, 2026-10-11). */
import type { Band, Kind, MemoryPhysics, MemorySource, Salience } from "../types.js";
import { isDay, isRecurrence } from "../time.js";
import type { Recurrence } from "../time.js";
import type { Stance } from "../observer.js";
import { RECURRING_META } from "./operational.js";
import type { DreamRow } from "./operational.js";
import type { ProseType, ProseDoc } from "./prose.js";
import type { EmbedderIdentity } from "./cache.js";
import type { AboutMark, AboutSetter, SaidBy, MemoryStatus } from "./marks.js";

/** Telemetry: ids, hashes, counts, kinds, tiers. Never body text (§5 G10). */
export interface StoreEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

/**
 * Text in, vector out — or NULL when this embedder has no vector for this text.
 *
 * The null arm is load-bearing and was added when the first real embedder was
 * built (`adapters/claude-code/embed-client.ts`). Every production embedder is a
 * network client behind a cache, and `put`/`rebuildCache` are synchronous: a
 * lookup that misses has nothing to return. The two dishonest alternatives are
 * both worse — throwing fails a write over a rebuildable cache, and returning
 * `[]` writes a dim-0 row that `cosine` reads as 0.0 similarity, which is a lie
 * with a number on it. A miss is counted (`unrecomputed`), exactly as a
 * missing embedder already was, and `tools/replay/INTERFACE-GAPS §4` asks for
 * the same shape ("a cache miss must be a counted `not-exercised`").
 */
export interface Embedder {
  (text: string): number[] | null;
  /**
   * WHICH vectors this embedder produces (cache v5, roadmap C1). Optional, so a
   * plain function is still an embedder — a test stub, a replay harness — and
   * such an embedder is never checked against the cache's tag. A production
   * embedder carries one, and `Store.open` reconciles it with
   * `cache_meta.embedder` once, at open (`cache.ts#reconcileEmbedder`).
   */
  readonly identity?: EmbedderIdentity;
}

export interface StoreOptions extends Stance {
  /** Defaults to `dataDir()` — resolved at call time, so tests redirect via env. */
  dir?: string;
  /** Retention for superseded-version rows, in LIVED days. TUNABLE; default 90. */
  retentionDays?: number;
  /** Optional; without it, embeddings are declared un-recomputed at rebuild. */
  embed?: Embedder;
  /**
   * THE PROVENANCE CLOCK (LAUNCH-STATUS §I7, `NOTES.md` 2026-09-05).
   *
   * The session's wall clock, injected. Everything this store records about
   * WHEN IN THE WORLD something happened — `learnedOn`, event `at`, a version's
   * `archived_at`, a removal record's `at` — reads THIS and never the ambient
   * `Date.now`. The PHYSICS clock is a different clock and stays where it is:
   * `livedDay()` counts days the owner actually lived, advanced by
   * `advanceClock()`, and no wall-clock instant moves it.
   *
   * Defaults to `Date.now`, so a host that injects nothing behaves exactly as
   * before. A seeder, a replay harness and a migration pass one.
   */
  now?: () => number;
  /**
   * The zone a moment is read in when this store names a person's day —
   * `learned_on`, `today()`, the day the store began (docs/time.md, 2026-09-25).
   * An IANA name from the host's config (`timeZone`); absent or unknown, the
   * machine's CURRENT zone, resolved at every call so a laptop that moves shows
   * where it is now (`time.ts#resolveZone`).
   */
  timeZone?: string;
  onEvent?: (event: StoreEvent) => void;
  /**
   * Where the copy taken before a schema migration goes. Absent ⇒ beside the
   * store (`<base>/snapshots`); a store outside that layout with none named
   * refuses to migrate (`MIGRATION_SNAPSHOT_FAILED`).
   */
  snapshotsDir?: string;
  /**
   * Open past a rollback's hold (`rollback-hold.ts`) and, if the store is
   * behind, upgrade it from a NEW pre-migration copy. Only
   * `counterparts rollback --upgrade-again` sets it; it clears the hold after.
   */
  releaseRollbackHold?: boolean;
}

export interface PutInput {
  /** Optional; generated when absent. Never reused — a taken id is a hard error. */
  id?: string;
  type: ProseType;
  kind: Kind;
  body: string;
  title?: string;
  happenedOn?: string;
  learnedOn?: string;
  /**
   * The calendar date this memory is ABOUT, as the person said it — `2026-10-15`,
   * `2026-10`, `2026`, or `2026-10-20..2026-10-31` (`time.ts#parseCalendarDate`).
   * A reminder's date. Refused by name when it is not one (`EVENT_DATE_INVALID`):
   * a date that cannot be read is a reminder that will never come up.
   */
  eventDate?: string;
  /**
   * The model id that wrote these words, as the host reported it (schema v7).
   * Screened with `isModelId`; anything else — or absent — writes NULL, which
   * reads "not a named model" (the sweep, the owner, an unknown host).
   */
  model?: string;
  meta?: Record<string, unknown>;
  band?: Band;
  salience?: Partial<Salience>;
  physics?: Partial<Omit<MemoryPhysics, "kind" | "salience">>;
  /** Who is minting (engine-set upstream; see `types.MemorySource`). Absent
   *  writes NULL — "unrecorded" — never a defaulted claim of authorship. */
  source?: MemorySource;
  /** Light provenance: ids only, never text (F9, owner ruling 2026-08-29).
   *  Mirrored into the prose doc's meta so the document is self-describing.
   *
   *  `spanHash` is the buffer's own hash of the span this memory WAS — a jot's
   *  own words — and it is here so removal can chase that line by identity
   *  rather than by re-deriving it from the body (cli/INTERFACE-GAPS §9). It
   *  lives in the prose meta and NOWHERE ELSE on purpose: a hash of low-entropy
   *  content is brute-forceable (§16 G9), and the prose document is the one
   *  carrier a removal destroys, so the pointer dies with the thing it points
   *  at instead of outliving it in a box-2 column. */
  origin?: { session?: string; scope?: string; ref?: string; spanHash?: string };
  /**
   * v9: what the memory is about (`ABOUT_MARKS`), and who said so. Absent
   * writes NULL — unmarked. A mark set later goes through `setAbout`, which
   * also records it in the core's history; one given at birth does not.
   */
  about?: AboutMark;
  aboutBy?: AboutSetter;
  /**
   * v12: THE WRITER'S THREE FIELDS (`WriteFacts`) — when the thing happened
   * (a day, month, year or range, `time.ts#parseCalendarDate`), who said it,
   * and what kind of thing it is. Absent writes NULL. A belt, not the check:
   * an unreadable date or an unknown word writes NULL here rather than
   * refusing the memory (the doors drop them with a note before this).
   */
  occurredOn?: string;
  saidBy?: SaidBy;
  status?: MemoryStatus;
}

/** How a subject link was found (`memory_subjects.via`, v12). */
export type SubjectLinkVia = "write" | "birth" | "backfill";

export interface StoredMemory {
  doc: ProseDoc;
  physics: MemoryPhysics;
  band: Band;
  bandDay: number;
  archived: boolean;
  archivedReason: string | null;
  supersededBy: string | null;
  revision: number;
  contentHash: string;
  /** The confidentiality class, read off the ROW's column (written from
   *  `confidentialByMeta` at every write). Carried on the read so a caller gates
   *  on a boolean rather than on JSON it had to re-interpret. */
  confidential: boolean;
  /** v7 moments, UTC ms (docs/time.md). Null on a row written before v7. */
  createdAt: number | null;
  updatedAt: number | null;
  /** v7: the model that wrote the current words; null = not a named model. */
  model: string | null;
  /** v9: what the memory is about, or null when unmarked. */
  about: AboutMark | null;
  /** v9: who set it (`writer`, `reflection`, `owner`, `upgrade`), or null. */
  aboutBy: string | null;
}

/** One memory with a reminder date, as `Store.datedMemories` returns it. */
export interface DatedMemory {
  readonly id: string;
  /** As stated — never widened, never narrowed. */
  readonly eventDate: string;
}

/**
 * The repeat a ROW carries, or null: a day `event_date` and a recurrence word
 * in its meta — the one predicate `recurringMemories` and the prune's
 * `recurring` gate (`sleep/prune.ts`, 2026-10-09) both read. Unreadable meta,
 * a month or a range, or `recurring` dropped: null, the date is once.
 */
export function recurrenceOfRow(row: { readonly event_date: string | null; readonly meta: string }): Recurrence | null {
  if (!isDay(row.event_date)) return null;
  if (!row.meta.includes(`"${RECURRING_META}"`)) return null;
  let rule: unknown;
  try {
    rule = (JSON.parse(row.meta) as Record<string, unknown>)[RECURRING_META];
  } catch {
    return null;
  }
  return isRecurrence(rule) ? rule : null;
}

/** One memory whose reminder date repeats, as `Store.recurringMemories` returns it. */
export interface RecurringMemory {
  readonly id: string;
  /** The day as stated — the anchor every occurrence is counted from. */
  readonly eventDate: string;
  readonly recurring: Recurrence;
}

/**
 * ONE LIVE ROW as deliberate recall's facts mode ranks and labels it (Release
 * B, 2026-10-03): the columns, never the body (`Store#recallRows`). The
 * writer's three fields are null on a row from before v12, and on a file
 * that has not been upgraded.
 */
export interface RecallRow {
  readonly id: string;
  readonly type: string;
  readonly kind: string;
  readonly title: string | null;
  readonly learned_on: string;
  readonly created_at: number | null;
  readonly updated_at: number | null;
  readonly occurred_on: string | null;
  readonly said_by: string | null;
  readonly status: string | null;
  readonly source: string | null;
  readonly origin_session: string | null;
  readonly origin_scope: string | null;
  readonly origin_ref: string | null;
  readonly confidential: number;
  /** `meta` for a schema or an episode row (a role, a session); null for a memory. */
  readonly meta: string | null;
}

export interface PruneReport {
  pruned: number;
  cutoffDay: number;
  retentionDays: number;
}

/**
 * What one bounded sweep of the durable event log did, and what it left. The
 * sweep is capped per pass, so `pruned` and `eligible` are different numbers
 * and both are reported: a report that said only how many rows went could not
 * tell "the backlog is cleared" from "the cap was hit" (scar §2.4).
 */
export interface EventPruneReport extends PruneReport {
  /** Unlatched rows older than the window when the sweep began. */
  eligible: number;
  /** Eligible rows the cap left for the next pass. Zero means the window is clean. */
  remaining: number;
  /** The per-pass cap in force, or null when the caller set none. */
  limit: number | null;
}

/** What `eventLog` selects on. `order` defaults to `"asc"` (oldest first). */
/** A dream row as the queue reads it (`dreamsShown`): no journal, title or model. */
export type DreamShownRow = Pick<DreamRow, "id" | "day" | "date" | "state" | "started_at" | "shown">;

export interface EventLogFilter {
  name?: string;
  ref?: string;
  sinceDay?: number;
  limit?: number;
  order?: "asc" | "desc";
}

/**
 * One row of `eventCounts`: a name, how many rows of it the window holds, and
 * the newest of them — by wall clock (`newestAt`, epoch ms), by lived day
 * (`newestDay`) and by `seq` (`newestSeq`, the one to fetch it by). Each is the
 * MAX of its own column, so they need not come from the same row if a clock
 * was ever set back; `newestSeq` is the one that is always the last appended.
 */
export interface EventCount {
  name: string;
  count: number;
  newestAt: number;
  newestDay: number;
  newestSeq: number;
}

/**
 * The durable event log, counted without being touched — what `verify` prints
 * and what an observer's cycle report is computed from. Every number here is a
 * read; nothing in it crosses the write seam.
 */
export interface EventLogCensus {
  /** Rows held, latched and unlatched. */
  rows: number;
  /** Rows carrying a `dedup_key` — records, kept at any age. */
  latched: number;
  /** The oldest row's lived day and wall-clock instant, or null on an empty log. */
  oldestDay: number | null;
  oldestAt: number | null;
  newestDay: number | null;
  /** `livedDay - retentionDays`: rows with `day` strictly below it are past the window. */
  cutoffDay: number;
  retentionDays: number;
  /** Unlatched rows past the window — what the next sweep would delete, before its cap. */
  eligible: number;
  /** Latched rows past the window — kept by kind, and counted so "kept" is a number. */
  latchedPastCutoff: number;
}

export interface RebuildReport {
  indexed: number;
  skippedDenied: number;
  /**
   * Rows that are canonical but not live — archived, or a superseded head. The
   * text index is the index OF THE LIVE STORE (`cache.ts#deindexDoc`), so a
   * rebuild reproduces exactly what `archive`/`supersede` maintain. COUNTED,
   * not silent: `counterparts verify --rebuild` accounts for every canonical
   * row, and a skip that did not appear in the arithmetic would read as a
   * mismatch (I13).
   */
  skippedArchived: number;
  unrecomputed: number;
  /** Contract §5 G8: what rebuild cannot recompute is DECLARED, with owner + repair. */
  declared: { what: string; owner: string; repair: string }[];
  /** Vectors kept across the rebuild (`keepVectors`), and vectors dropped as
   *  no longer canonical — removed ids and orphans. Both zero by default. */
  keptVectors: number;
  droppedVectors: number;
}

export interface RebuildOptions {
  /**
   * Re-index the TOKEN side without dropping `embeddings`.
   *
   * Off by default, because the default is the older and louder claim: box 3 is
   * rebuildable and a rebuild rebuilds it. It exists because that claim prices
   * the four tables the same when they are not — a vector costs a paid network
   * call and a console with no embedder cannot replace one at any price
   * (`adapters/cli/NOTES.md`, 2026-09-04, the follow-up filed by PR #43's
   * review). With it on, a vector whose memory is still canonical survives, a
   * vector for a removed or orphaned id is deleted, and a row whose embedder
   * misses keeps the vector it had instead of counting as `unrecomputed`.
   *
   * **A row that already has a vector is not re-embedded**, even when an
   * embedder is wired: keep means keep, and the caller that wants fresh vectors
   * wants a plain `rebuildCache()`. Rows with NO vector are embedded as usual.
   */
  keepVectors?: boolean;
}

export interface EdgeInput {
  src: string;
  dst: string;
  weight: number;
  day: number;
}

export interface ProspectiveInput {
  memoryId: string;
  windowKey: string;
  eventDate: string;
  /** `range` since 2026-09-26 (prospective windows.ts) — the column is TEXT, so
   *  this widens the type and nothing on disk. */
  precision: "day" | "month" | "year" | "range";
  state: "armed" | "fired" | "suppressed" | "expired";
  fires?: number;
  lastFiredDay?: number | null;
}

/**
 * One per-session gate record (SEAMS item B). A ROW, never a re-serialized
 * document: two writers on one session each insert their own record, so a late
 * `resolveUse()` can no longer drop a turn's `recall()` records (scar §2.1).
 */
export interface GateRecordInput {
  sessionId: string;
  /** `surfaced` / `credited` (recall), `window` (prospective), `scalar` (row state). */
  kind: string;
  /** Memory id, window key, or — for `scalar` — the field name. */
  ref: string;
  turn: number;
  lastDay: number;
  tier?: string | null;
  /** False when the memory arrived only through ambiguous handles (recall §9 G5). */
  trains?: boolean | null;
  /** JSON for `scalar` records. Never body text (§5 G10). */
  value?: string | null;
}

/**
 * One durable event (SEAMS item K). Content-BY-REFERENCE: ids, hashes, counts,
 * scores, kinds, tiers — never body text, never a user turn.
 *
 * `dedupKey` is the replay latch: an event carrying one lands AT MOST ONCE, ever
 * (sleep §5 G3 — "every day-gated concern is idempotent under replay"), and
 * `appendEvent` returns 0 when the latch held. Telemetry omits it and accumulates.
 */
export interface EventInput {
  name: string;
  day: number;
  ref?: string | null;
  dedupKey?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * THE TWO SCHEMA STAMPS AS THEY STAND ON DISK RIGHT NOW — box 2's
 * `meta.schemaVersion` and box 3's `cache_meta.schemaVersion`, each exactly as
 * written (a string), or null when the row is not there.
 *
 * Read by `Store.schemaVersions()`, which exists for ONE caller shape: a process
 * that opened this store long ago and has to ask, before it touches anything,
 * whether a newer build has migrated it since. That is the MCP server — the one
 * long-lived process a host starts once per session and never restarts on its
 * own (the MCP adapter's schema gate; LAUNCH-STATUS I36). The core names no
 * adapter, so the pointer is in words.
 */
export interface SchemaVersions {
  readonly store: string | null;
  readonly cache: string | null;
}

export interface RankingRow {
  id: string;
  strength: number;
  band: Band;
  day: number;
}

/**
 * One removed memory, as it survives: an address, what family it belonged to,
 * what it WAS (protected? identity band?), and counts of what the chase took.
 * No title, no body, no content hash — the same rule as the record (§16 G9).
 */
export interface Tombstone {
  readonly id: string;
  readonly type: ProseType;
  readonly kind: Kind;
  readonly band: Band;
  /** Permanent ink at the moment it was removed — why it still shows in the list. */
  readonly wasProtected: boolean;
  readonly wasPromotedIdentity: boolean;
  readonly supersededBy: string | null;
  readonly stage: RemovalNote["stage"];
  readonly at: number;
  /** True while a stripped skeleton row survives to carry lineage pointers. */
  readonly rowSurvives: boolean;
  readonly chased: {
    readonly versions: number;
    readonly edges: number;
    readonly prospective: number;
    readonly gateRows: number;
  };
}

/** No body, no content hash — hashing low-entropy content leaks it (§16 G9). */
export interface RemovalNote {
  memoryId: string;
  stage: "requested" | "dark" | "chased" | "complete";
  actor: string;
  reason?: string;
}

/** What `list()` and `countMemories()` both select on — one filter, one WHERE. */
export interface MemoryFilter {
  type?: ProseType;
  kind?: Kind;
  band?: Band;
  archived?: boolean;
  /**
   * WHO WROTE IT — the mint-source doctrine's column (`authored`, `fallback`,
   * `episode`, `migrated`). Nullable in the schema on purpose, so a filter on a
   * source never matches a row that predates the doctrine, which is what a
   * caller asking "how many did the author write" wants.
   */
  source?: string;
  /**
   * BORN ON OR AFTER this calendar date, `YYYY-MM-DD` — a string comparison,
   * which is exact for that spelling. Undated rows carry `learned_on = ''`
   * (`self/briefing.ts`) and are excluded by the same comparison, which is
   * right: a row with no date is not a row born in a window.
   */
  learnedOnFrom?: string;
  /**
   * MINTED FROM THIS id — the `origin_ref` column (a proposal, a trace, or a
   * journal chapter's `epi_` id for its copy). Exact match. Added 2026-09-30 so
   * recall can credit a chapter's copy without reading every prose file.
   */
  originRef?: string;
  /**
   * BORN ON OR AFTER this LIVED day — the `birth_day` column. Added 2026-09-30
   * so the wake's "Last here" walk reads only the episodes inside its window.
   */
  bornFromDay?: number;
  /**
   * WRITTEN BY THIS SESSION — the `origin_session` column. Exact match. Added
   * 2026-09-30 so a recall asked about "the last session" can find what that
   * session wrote without reading every row.
   */
  originSession?: string;
  /**
   * MARKED ABOUT THIS — v9's `about` column (`ABOUT_MARKS`). Exact match; an
   * unmarked row never matches. Added 2026-10-03 for recall's meaning mode,
   * where "us" is the memories marked `us`.
   */
  about?: AboutMark;
}

export function memoryWhere(filter: MemoryFilter): { clause: string; args: (string | number)[] } {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.type) {
    where.push("type = ?");
    args.push(filter.type);
  }
  if (filter.kind) {
    where.push("kind = ?");
    args.push(filter.kind);
  }
  if (filter.band) {
    where.push("band = ?");
    args.push(filter.band);
  }
  if (filter.archived !== undefined) {
    where.push("archived = ?");
    args.push(filter.archived ? 1 : 0);
  }
  if (filter.source !== undefined) {
    where.push("source = ?");
    args.push(filter.source);
  }
  if (filter.learnedOnFrom !== undefined) {
    where.push("learned_on >= ?");
    args.push(filter.learnedOnFrom);
  }
  if (filter.originRef !== undefined) {
    where.push("origin_ref = ?");
    args.push(filter.originRef);
  }
  if (filter.bornFromDay !== undefined) {
    where.push("birth_day >= ?");
    args.push(filter.bornFromDay);
  }
  if (filter.originSession !== undefined) {
    where.push("origin_session = ?");
    args.push(filter.originSession);
  }
  if (filter.about !== undefined) {
    where.push("about = ?");
    args.push(filter.about);
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
}
