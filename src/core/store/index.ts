/**
 * The store seam.
 *
 * TWO boxes behind one object, since the floor (schema v6, 2026-09-20):
 *   2. canonical      — `counterparts.sqlite`   (box 2, `operational.ts`)
 *   3. rebuildable    — `cache/cache.sqlite`    (box 3, `cache.ts`)
 *
 * Box 1 — `prose/**.md`, one markdown file per memory — is gone. `memories`
 * carries `title`, `body` and `meta`, and `versions` carries its own copy of the
 * three, so a memory and its history are one row and one transaction. Markdown
 * is an EXPORT (`render.ts`), and `ProseDoc` is still the read shape, which is
 * why `physics/`, `recall/`, `associate/`, `prospective/`, `encode/` and most of
 * `sleep/` never learned the floor moved.
 *
 * What that buys, in the words of the scars it closes: a crash can no longer
 * leave a row whose words are missing (there is no window between "commit the
 * row" and "publish the file"), removing a memory is one transaction rather than
 * a file chase, a backup is one file, and a copied store cannot read or delete
 * the source store's words because there are none outside the database (I22,
 * whose mechanism is deleted and whose criterion is kept).
 *
 * Every write crosses `mutate()`: it checks the observer stance FIRST, then opens a
 * transaction on box 2. That ordering is the point — an instrument refuses before it
 * has staged a byte, and a future caller inherits the refusal instead of having to
 * remember it (observer-mode.md G3, contract §5 G1).
 *
 * There is no delete/remove/unlink/rm export or method anywhere in this module, for
 * prose or anything else. Removal is an owner operation on a structurally distinct
 * path — see `owner-op-seam.ts`; the store's half of it is the append-only removal
 * record plus the deny-list consulted at load and rebuild (§16 G1, G7, G12).
 *
 * The deny-list is consulted HERE, at the seam, so every module inherits the
 * refusal instead of having to remember it: `read`/`readProse`/`physicsOf`/
 * `readVersion` raise a named `REMOVED` rather than an ENOENT on a chased file,
 * `resolve` stops at a removed id instead of dangling past it, and `put` refuses
 * to reuse one. `row()` is the deliberate exception — it is the raw box-2
 * accessor, and an instrument reading the skeleton of a removed memory is how the
 * owner sees that something WAS here (constitution 16).
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Band, Kind, MemoryPhysics, MemorySource, Salience } from "../types.js";
import { isModelId } from "../types.js";
import {
  calendarOverlaps,
  compareCalendarDates,
  daysBetween,
  isCalendarDate,
  isDay,
  isRecurrence,
  isoInstant,
  localDate,
  parseCalendarDate,
  resolveZone,
  utcDate,
} from "../time.js";
import type { Recurrence } from "../time.js";
import { LATER_FEELING_SOURCES, checkFeelings } from "./feelings.js";
import type { AddFeelingsResult, FeelingInput, FeelingRow, FeelingSource } from "./feelings.js";
import { checkTraitsRepaired } from "./traits.js";
import type { TraitRepair } from "./traits.js";
import type { TraitInput, TraitRead, TraitRow, TraitSource } from "./traits.js";
import { TUNABLES as PHYSICS_TUNABLES, USE_TIER_WEIGHT, creditReturn, creditUse } from "../physics/index.js";
import type { CreditOutcome, ReturnOutcome, UseTier } from "../physics/index.js";
import type { Db, Statement, WalFold } from "./db.js";
import { foldWal, isLocked, wroteOn } from "./db.js";
import { StoreError } from "./errors.js";
import { isObserver } from "../observer.js";
import type { Stance } from "../observer.js";
import {
  CLAIMS_ERA_CUTOFF_KEY,
  CLAIMS_ERA_RECORDED_KEY,
  DEFAULT_RETENTION_DAYS,
  ERA_WRITTEN_AT_META,
  RECURRING_META,
  SCHEMA_VERSION,
  eraCarriedFrom,
  olderFirst,
  openOperational,
  reachExempt,
  rowToPhysics,
  rowTombstoned,
} from "./operational.js";
import type {
  ContradictionRow,
  CoreEventRow,
  DreamAskRow,
  DreamChangeRow,
  DreamRow,
  EdgeRow,
  EventRow,
  FeelingPeak,
  GateSessionRow,
  MemoryRow,
  MigrationNote,
  ProspectiveRow,
  ReflectionRow,
  RemovalRow,
  ReturnRow,
  SettleRow,
  TombstoneRow,
  VersionRow,
  WakeDisplayRow,
} from "./operational.js";
import { grantOwnerOps } from "./owner-op-seam.js";
import { rollbackHeld } from "./rollback-hold.js";
import {
  DATABASE_FILE,
  LAYOUT,
  PRE_ROWS_READABLE_BY,
  assertLayoutClassified,
  assertSafeDataDir,
  dataDir,
  paths,
  preRowsLeftoversAreEmpty,
  preRowsMarkersIn,
} from "./paths.js";
import {
  ID_PREFIX,
  assertIdWellFormed,
  bodyForStorage,
  hashText,
  parseMeta,
  serializeMeta,
} from "./prose.js";
import type { ProseDoc, ProseType } from "./prose.js";
import {
  DEFAULT_LENGTH_NORM,
  NEIGHBOURS_KEPT,
  allVectors,
  rankAgainst,
  readNeighbours,
  writeNeighbours,
  decodeVector,
  deindexDoc,
  docFrequency,
  embeddingCount,
  indexDoc,
  nearest,
  nearestVectors,
  heldExits,
  cacheAhead,
  heldEmbedder,
  openCache,
  searchRefusal,
  reconcileEmbedder,
  recordedEmbedder,
  resetCache,
  searchIndex,
  setEmbedding,
} from "./cache.js";
import type { EmbedderIdentity, EmbedderVerdict, Hit, LengthNorm, VectorRefusal } from "./cache.js";

export * from "./errors.js";
export * from "../observer.js";
export * from "./paths.js";
export * from "./prose.js";
export * from "./render.js";
export * from "./feelings.js";

/** `LATER_FEELING_SOURCES` as a SQL list — the sources `feeling_peak_lived` leaves out. Constants only, never input. */
const LATER_SQL = LATER_FEELING_SOURCES.map((x) => `'${x}'`).join(", ");
export * from "./traits.js";
export type { Db, Statement, WalFold } from "./db.js";
export type {
  ContradictionRow,
  SettleRow,
  CoreEventRow,
  DreamAskRow,
  DreamChangeRow,
  DreamRow,
  ReflectionRow,
  ReturnRow,
  WakeDisplayRow,
  MemoryRow,
  FeelingPeak,
  VersionRow,
  EdgeRow,
  EventRow,
  GateSessionRow,
  ProspectiveRow,
  RemovalRow,
  TombstoneRow,
  MigrationNote,
} from "./operational.js";
export {
  ROLLBACK_HOLD_DIR,
  ROLLBACK_HOLD_FILE,
  readRollbackHold,
  rollbackHeld,
  rollbackHoldPath,
  writeRollbackHold,
} from "./rollback-hold.js";
export type { RollbackHold } from "./rollback-hold.js";
export {
  PRE_MIGRATION_NAME_RE,
  PRE_MIGRATION_TAG,
  assertPreMigrationTarget,
  preMigrationDir,
  preMigrationName,
  preMigrationVersions,
  realpathDeep,
  vacuumInto,
} from "./pre-migration.js";
export {
  ADDED_COLUMNS,
  DEFAULT_RETENTION_DAYS,
  isPreRowsDatabase,
  OBSERVER_READ_FLOOR,
  pendingMigration,
  SCHEMA_VERSION,
  V8_UPGRADE_KEY,
  V9_UPGRADE_KEY,
  V10_UPGRADE_KEY,
  V11_UPGRADE_KEY,
  V12_UPGRADE_KEY,
  V13_UPGRADE_KEY,
  CLAIMS_ERA_CUTOFF_KEY,
  CLAIMS_ERA_RECORDED_KEY,
  CLAIMED_DEFAULT_SPELLED,
  ERA_WRITTEN_AT_META,
  backfillRecordedDays,
  datedHold,
  eraCarriedFrom,
  eraClaimOf,
  reachExempt,
  carriedPairId,
  refileFeelingsV11,
  refileStrayV10Cores,
  restoreFeelingsV10,
  olderFirst,
  rowToPhysics,
  rowTombstoned,
} from "./operational.js";
export {
  tokenize,
  cosine,
  CACHE_SCHEMA_VERSION,
  DEFAULT_LENGTH_NORM,
  backfillLengths,
  avgDocLen,
  convertVectorBatch,
  countNonFinite,
  decodeVector,
  encodeVector,
  vectorFormats,
  EMBEDDER_META_KEY,
  EMBEDDER_REBUILD_META_KEY,
  EMBEDDER_HELD_META_KEY,
  heldExits,
  heldEmbedder,
  identityTag,
  parseIdentityTag,
  recordedEmbedder,
  schemaAhead,
} from "./cache.js";
export type { EmbedderIdentity, EmbedderVerdict, RecordedEmbedder, VectorRefusal } from "./cache.js";
export type { ConvertBatchReport, Hit, LengthNorm, VectorFormatCensus } from "./cache.js";
// The seam's TYPES travel as one unit (cli/INTERFACE-GAPS §3). The chase itself
// does not: `chaseRemoved` is importable only from `owner-op-seam.js`, by the one
// directory the caller-universality test allows (§16 G1–G2).
export type {
  ChaseReport,
  OwnerRemovalOutcome,
  OwnerRemovalPort,
  OwnerRemovalRequest,
} from "./owner-op-seam.js";

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

/**
 * v12 (2026-10-03): WHO SAID IT — the owner, me (`self`), or my inference
 * (`inferred`). Not which channel wrote the row (`source` says that): a note
 * I write can record something the owner said.
 */
export const SAID_BY = ["owner", "self", "inferred"] as const;
export type SaidBy = (typeof SAID_BY)[number];
/**
 * v12 (2026-10-03): WHAT KIND OF THING IT IS — `done` (it happened),
 * `planned` (decided, not yet done), `proposed` (put forward, not decided),
 * `asked` (a question or request still open). `kind` is taken (physics kind).
 */
export const STATUSES = ["done", "planned", "proposed", "asked"] as const;
export type MemoryStatus = (typeof STATUSES)[number];

/** The writer's three fields, as one value (v12). Each one optional. */
export interface WriteFacts {
  readonly occurredOn?: string;
  readonly saidBy?: SaidBy;
  readonly status?: MemoryStatus;
}

/** A value read as who-said-it: anything else is unknown (null). */
export function saidByOf(v: unknown): SaidBy | null {
  return typeof v === "string" && (SAID_BY as readonly string[]).includes(v) ? (v as SaidBy) : null;
}

/** A value read as a status: anything else is unknown (null). */
export function statusOf(v: unknown): MemoryStatus | null {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v) ? (v as MemoryStatus) : null;
}

/** An occurred-on date as stored — the `time.ts` reading's text — or null when unreadable. */
export function occurredOnOf(v: unknown): string | null {
  return parseCalendarDate(v)?.text ?? null;
}

/** How a subject link was found (`memory_subjects.via`, v12). */
export type SubjectLinkVia = "write" | "birth" | "backfill";

/**
 * A memory's confidentiality class, from its `meta`.
 *
 * The truth table lives HERE, beside the writes that carry it, because it is a
 * gate: `recall/activate.ts#isConfidential` is the same answer by the same
 * function, so the surfacing boundary and `StoredMemory.confidential` can never
 * disagree. Since the floor it is also evaluated ONCE PER WRITE and stored in
 * `memories.confidential`, so the gate no longer parses JSON on every read —
 * a gate that re-parses at every call site is a gate that will one day fail
 * open. The function stays the single definition both the column and the
 * boundary are computed from.
 */
export function confidentialByMeta(meta: Readonly<Record<string, unknown>>): boolean {
  if (meta["confidential"] === true) return true;
  const klass = meta["confidentiality"];
  return typeof klass === "string" && klass !== "" && klass !== "open" && klass !== "normal";
}

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

/**
 * v9 (2026-09-27): WHAT A MEMORY IS ABOUT — a neutral, descriptive mark, so a
 * writer is not nudged toward "core-eligible": `me` (who I am), `us` (the
 * owner and me together), `owner` (the owner himself), `work` (the craft: how
 * a job is done), `world` (anything else). Set by an awake model that read the
 * words — the writer at `note` / `session_end`, or the reflection — or by the
 * v9 upgrade carrying the old kind rule. It is not a topic (a separate axis,
 * later). Only `me`, `us` and `owner` are core candidates
 * (`CORE_ABOUT_MARKS`, `sleep/consolidate.ts#aboutMe`).
 */
export const ABOUT_MARKS = ["me", "us", "owner", "work", "world"] as const;
export type AboutMark = (typeof ABOUT_MARKS)[number];
/** The marks that make a memory a core candidate. */
export const CORE_ABOUT_MARKS: readonly AboutMark[] = ["me", "us", "owner"];
/**
 * Who set a mark. `self` (2026-10-11): the counterpart awake, re-marking an
 * existing memory in a session (`remember`'s `remark`) — `writer` is the mark
 * given at birth; `owner` is the owner's door (`counterparts about`, and the
 * dashboard through it).
 */
export const ABOUT_SETTERS = ["writer", "reflection", "owner", "upgrade", "self"] as const;
export type AboutSetter = (typeof ABOUT_SETTERS)[number];

/** A column value read as a mark: anything else is unmarked. */
export function aboutMarkOf(v: unknown): AboutMark | null {
  return typeof v === "string" && (ABOUT_MARKS as readonly string[]).includes(v) ? (v as AboutMark) : null;
}

/** What `inheritFrom` reads of a source: its mark, and — for `era` — its moment and meta. */
export type InheritSource = Pick<MemoryRow, "id" | "about" | "about_by"> & Partial<Pick<MemoryRow, "created_at" | "meta">>;

/** What a new row takes from the rows it is made from (`inheritFrom`). */
export interface Inherited {
  /**
   * What it is about, who set that mark (`about_by`), and which source gave
   * it. Null: no source was marked.
   */
  readonly about: { readonly about: AboutMark; readonly aboutBy: AboutSetter | null; readonly from: string } | null;
  /**
   * The best source's era standing, as meta keys (`operational.ts
   * #eraCarriedFrom`) — for a row that takes the best source's STORED claim
   * (a dream merge) and only for one: a row with a claim of its own (a
   * revision, a gist) is new, and the era reads it as new. Empty without a
   * `cutoff`.
   */
  readonly era: Record<string, unknown>;
}

/**
 * WHAT A NEW ROW MADE FROM EXISTING ONES INHERITS (2026-10-11; decided by
 * random-06, 2026-10-11, lightly held): one model for "this replaces that",
 * so each path that makes a row out of others reads it the same way — the
 * dream's merge and gist (D6 closed by Mike, 2026-10-11, lightly held), a
 * revision by `updates:` (its one source, the memory it revises). `best` is
 * the source whose words and claim the new row takes; absent, the first in
 * order.
 *
 * WHAT IT IS ABOUT: the best source's mark unless that is not personal and
 * another source is (`CORE_ABOUT_MARKS`: me, us, owner): a personal mark is
 * never lost to a work one, or to none. Of several personal marks, the best
 * source's when it is one, else the first in order. An unmarked best source
 * with only work or world marks beside it takes the first of those — what
 * `Store#supersedeInto`'s fill-if-unmarked carry would give it anyway, named
 * here so a caller's note says what lands. The mark keeps who set it.
 *
 * The caller with no explicit claim reads its default BY THAT mark
 * (`physics.defaultClaimFor`), with its own row's status, said-by and kind:
 * the revision's door hands the mark to `mint.ts`, which already asks.
 */
export function inheritFrom(
  sources: readonly InheritSource[],
  opts: {
    best?: InheritSource;
    /** The era's cutoff (or its first recorded moment), for `era`. */
    cutoff?: string | number | null;
  } = {},
): Inherited {
  const best = opts.best ?? sources[0];
  if (best === undefined) return { about: null, era: {} };
  const personal = (r: Pick<MemoryRow, "about">): boolean => {
    const m = aboutMarkOf(r.about);
    return m !== null && CORE_ABOUT_MARKS.includes(m);
  };
  const marked = (r: Pick<MemoryRow, "about">): boolean => aboutMarkOf(r.about) !== null;
  const chosen = personal(best) ? best : (sources.find(personal) ?? (marked(best) ? best : (sources.find(marked) ?? best)));
  const mark = aboutMarkOf(chosen.about);
  const by = chosen.about_by;
  const about =
    mark === null
      ? null
      : { about: mark, aboutBy: typeof by === "string" && (ABOUT_SETTERS as readonly string[]).includes(by) ? (by as AboutSetter) : null, from: chosen.id };
  return {
    about,
    era: opts.cutoff === undefined ? {} : eraCarriedFrom({ created_at: best.created_at ?? null, meta: best.meta ?? "" }, opts.cutoff),
  };
}

/** One memory with a reminder date, as `Store.datedMemories` returns it. */
export interface DatedMemory {
  readonly id: string;
  /** As stated — never widened, never narrowed. */
  readonly eventDate: string;
}

/**
 * HOW OFTEN A REMINDER DATE COMES ROUND (2026-10-09, the owner's design, held
 * lightly): `daily`, `weekly`, `monthly` or `yearly` (`time.ts#RECURRENCES`),
 * anchored on the memory's `event_date`, in the memory's meta bag under this
 * key — beside `remind`, and for the same reason: NO SCHEMA BUMP, so a store
 * written with it opens in a build that never heard of it, which reads the
 * anchor as a one-off date already passed. Only a DAY repeats; on a month, a
 * range or a year the key is inert. `prospective/` is its reader.
 */
export { RECURRING_META };

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

/**
 * Every method that can change durable state. The totality test asserts this list
 * equals the set of sites that consult the observer predicate, and that each one
 * refuses under observer (observer-mode.md G6: every stand-down is observable).
 */
/**
 * The backfill's give-up counter: `embed.failed.<id>` in box 2's meta, and the
 * number of ITEM-ATTRIBUTABLE failures after which `missingVectors` stops
 * offering that id.
 *
 * **Only the failures the provider blamed on the item itself may move it** — a
 * 400 the bisector narrowed down to one input (`ChunkFailure.item`). A 429, a
 * 5xx, a dropped socket, an aborted watchdog or a malformed body says nothing
 * about WHICH input is bad, and counting those was I33 inverted: three bad
 * boundaries in a row would retire a whole healthy window and `unembeddedCount`
 * — the coverage watch — would then read COMPLETE while those memories stayed
 * blind. Three rather than one because even a 400 can be answered for a reason
 * that is not the text.
 *
 * Written by whoever runs the backfill (`adapters/claude-code/vectors.ts`),
 * cleared the moment an id embeds, and cleared wholesale by
 * `counterparts verify --retry-skipped` — which is the remedy a repaired title
 * needs, because a skipped id is never offered again and so can never clear
 * itself. Meta keys only — no schema bump (precedent: `sleep.pruned.<id>`).
 */
export const EMBED_FAILED_PREFIX = "embed.failed.";
export const EMBED_SKIP_AFTER = 3;

/**
 * THE DAY THIS STORE CAME INTO EXISTENCE — one meta row, written once.
 *
 * The finding (new-user findings #8, 2026-09-21): `doctor`'s Authorship line
 * reports a seven-day window and printed `2026-09-15→2026-09-21` on a store made
 * that morning — a week the store did not exist for. A reading that names a
 * window it could not have observed is the diagnostic telling its reader
 * something that is not so, which is the one thing a diagnostic may not do.
 *
 * Nothing in the store knew its own age. `livedDay` is the PHYSICS clock (the
 * worker advances it, and it is 0 on a store whose worker has never run),
 * `lastActiveDate` is empty until a boundary, and the meta table carried no date
 * at all. `store.started` exists but only `start-fresh` writes it.
 *
 * **Written only by the open that CREATED the file** (`fresh`, and never under
 * observer), and `INSERT OR IGNORE` on top of that, so a store that was already
 * there is never stamped with a day it did not begin on — the same rule
 * `install` keeps for `store.started`. A store made before this key existed
 * simply does not have it, and every reader must treat it as unknown rather than
 * as "today".
 */
export const STORE_CREATED_KEY = "store.created";

export const WRITE_METHODS = [
  "put",
  "putMany",
  "revise",
  "supersede",
  "archive",
  "updatePhysics",
  "reinforce",
  "setBand",
  "link",
  "linkMany",
  "setProspective",
  "addFeelings",
  "addTraits",
  "advanceClock",
  "setMeta",
  "setMetaMany",
  "updateMeta",
  "setGateRecords",
  "pruneGateSessions",
  "appendEvent",
  "pruneEvents",
  "setRanking",
  "pruneSupersededVersions",
  "appendRemovalRecord",
  "rebuildCache",
  "pruneDeadIndex",
  "embedOne",
  // v8 (2026-09-26, dreaming + consolidation).
  "replayReturn",
  "recordHintDisplay",
  "supersedeInto",
  "restoreSuperseded",
  "restoreEdge",
  // 2026-09-28 (association build 1): the flush sweeps edge rows that carry nothing.
  "sweepEdges",
  "retractFeelings",
  "retractDreamReturns",
  "retractDreamNominations",
  "appendCoreEvent",
  "openDream",
  "updateDream",
  "recordDreamChange",
  "markDreamChangeUndone",
  "setDreamAsk",
  // 2026-09-28 (the nightly run): start a left-behind run again.
  "reclaimDreamAsk",
  // v9 (2026-09-27, reflection + core by meaning).
  "reflectReturn",
  "setAbout",
  "openReflection",
  "updateReflection",
  // v10 (2026-09-29, contradictions).
  "flagContradiction",
  "markContradictionRaised",
  "withdrawContradiction",
  "settleContradiction",
  "undoContradictionSettle",
  // v12 (2026-10-03): a card's birth and the backfill link what names it.
  "linkSubjects",
  // v13 (2026-10-10, the turn-down): derived bookkeeping and box 3.
  "dropRanking",
  "setNextChangeDays",
  "clearNextChangeDays",
] as const;

export type WriteMethod = (typeof WRITE_METHODS)[number];

/**
 * THE READ HALF OF `Store`, as a type (dashboard INTERFACE-GAPS §4) — so code
 * that only observes can be typed against it and "an instrument cannot reach a
 * write method" is a compile error rather than a source scan.
 *
 * Defined by SUBTRACTION from `WRITE_METHODS`, not by listing the reads: the
 * totality test holds that list equal to the set of sites that enter `mutate`,
 * so a write method added tomorrow drops out of this type the day it is
 * listed, and a read added tomorrow appears in it with no edit here.
 *
 * Two more are left out though neither is a durable write, because neither is
 * a reader's to call: `close()` ends a handle the reader does not own (and on a
 * writable handle it folds the write-ahead log — see `close`), and
 * `guardWrites()` installs or REMOVES the guard a composition root put on the
 * handle. `Omit` over a class keeps only its public members, and a `Store` is
 * assignable to this type, so a real handle passes wherever one is asked for.
 *
 * A type, not a wrapper: it narrows what a caller can NAME, and a cast gets
 * round it. The stance (`observer: true`) is still what the seam refuses on.
 */
export type ReadOnlyStore = Omit<Store, WriteMethod | "close" | "guardWrites" | "findSubjectsWith">;

const MAX_CHAIN = 32;
const EVENT_RING = 500;

/**
 * The DURABLE row an open writes when the identity check changed something
 * (a reset, a new hold, an adoption, a released hold). Box 2's event log, so
 * doctor and tomorrow can read what the open did to box 3's vectors.
 */
export const EMBEDDER_RECONCILED_EVENT = "store.embedder.reconciled";

/** The durable row an open writes after it migrated the schema: from, to, and the copy. */
export const STORE_MIGRATED_EVENT = "store.migrated";

/** Rows per box-3 transaction in the at-open inline refill. CAL. */
const REFILL_BATCH = 500;
/**
 * Wall budget for the at-open inline refill, checked between batches. CAL:
 * measured 2026-09-23 (store NOTES) — a static table refills ~a thousand
 * memories in well under this, and the worker's backfill finishes a larger
 * store at the next boundary.
 */
const REFILL_BUDGET_MS = 1500;

/** An `EmbedderVerdict` as telemetry: tags and counts, never text. */
function verdictData(v: EmbedderVerdict): Record<string, string | number | boolean | null> {
  switch (v.kind) {
    case "none":
      return { kind: v.kind };
    case "tagged":
      return { kind: v.kind, tag: v.tag, adopted: v.adopted };
    case "reset":
      return { kind: v.kind, from: v.from, to: v.to, dropped: v.dropped };
    case "held":
      return { kind: v.kind, recorded: v.recorded, configured: v.configured, rows: v.rows };
    case "match":
      return v.released === true ? { kind: v.kind, tag: v.tag, released: true } : { kind: v.kind, tag: v.tag };
    case "cache-ahead":
      return { kind: v.kind, found: v.found, expected: v.expected };
    case "deferred":
      return { kind: v.kind, reason: v.reason };
  }
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

function memoryWhere(filter: MemoryFilter): { clause: string; args: (string | number)[] } {
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

/** A memory row the NIGHTLY RUN wrote — a dream's gist or merge, a reflection's
 *  entry — as SQL (temporal contiguity's reads, review of #281 finding 1). */
const NIGHTLY_SQL = `(COALESCE(source, '') IN ('dreamed', 'reflection')
  OR COALESCE(origin_ref, '') LIKE 'dream:%' OR COALESCE(origin_ref, '') LIKE 'reflection:%')`;

export class Store {
  readonly dir: string;
  readonly observer: boolean;
  readonly retentionDays: number;
  private readonly ops: Db;
  private readonly cache: Db;
  private readonly embed: Embedder | undefined;
  /**
   * The identity this handle writes and ranks under — `opts.embed.identity`,
   * never under observer. Kept past open because the at-open check is not
   * enough for a handle that lives all session (re-review MAJOR A): every
   * vector write and every ranking re-reads the file's claim against it.
   */
  private readonly identity: EmbedderIdentity | undefined;
  /**
   * What the at-open identity check found (cache v5). `none` when this process
   * configured no identified embedder. `held` means box 3 holds another paid
   * model's vectors and this handle neither writes vectors nor ranks against
   * them until the owner confirms the drop. `cache-ahead` means box 3 was
   * written by a newer build: the same two refusals, and the version is left
   * as found.
   */
  readonly embedderVerdict: EmbedderVerdict;
  /** The migration this open ran, and the copy taken before it; null when none. */
  readonly migration: MigrationNote | null;
  /** The provenance clock (§I7). The ONE `Date.now` in this file is its default. */
  private readonly nowFn: () => number;
  /** The configured zone, as given; `zone()` resolves it per call. */
  private readonly configuredZone: string | undefined;
  private readonly onEvent: ((e: StoreEvent) => void) | undefined;
  private readonly ring: StoreEvent[] = [];

  private constructor(opts: StoreOptions) {
    // The guard runs on EVERY path, explicit or defaulted — an explicit `dir`
    // reaching mkdirSync unchecked is how a test once deposited a skeleton
    // inside the live v1 store (found by the caller-universality build, fixed
    // at this root the same day).
    this.dir = assertSafeDataDir(opts.dir ?? dataDir());
    this.observer = isObserver(opts);
    this.retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.embed = opts.embed;
    this.nowFn = opts.now ?? Date.now;
    this.configuredZone = opts.timeZone;
    this.onEvent = opts.onEvent;

    // ── THE PRE-ROWS REFUSAL, AND IT IS THE FIRST THING THAT HAPPENS ───────
    //
    // Before `fresh`, before the first `mkdirSync`, before `openOperational`,
    // before `assertLayout` — because every one of those writes something, and
    // the whole promise of this refusal is that a store written by an older
    // floor is left BYTE-IDENTICAL by an attempt to open it.
    //
    // The hazard it closes is the one thing in this rebuild that could destroy
    // the owner's live memory. `openOperational` migrates any store below
    // `SCHEMA_VERSION`; a v5 store reaching it would get `body` NULL on every
    // row while its words sat in ~16,000 markdown files this build cannot see,
    // and it would then be stamped v6 — unreadable by the build that CAN read
    // it. There is no migration and there is not going to be one (owner ruling
    // 6): the cut-over carries nothing and he starts as a new user.
    //
    // ORDER MATTERS TWICE OVER. `assertLayout()` would also refuse a v5 store,
    // on the unclassified `prose/` — but only after the database had been
    // opened and a blank `counterparts.sqlite` minted beside the old one, and a
    // refusal that names the layout instead of the floor is the wrong sentence
    // for somebody looking at three weeks of memory.
    //
    // It reads FILENAMES, never the old database (`preRowsMarkersIn`): since F1
    // the live store is in WAL, so an open-and-close to read its schema version
    // could checkpoint and remove its `-wal` — moving the bytes of the store
    // this exists to leave alone. `openOperational` carries the SECOND lock,
    // for a v5 database wearing the v6 name, where the file is already open and
    // that argument no longer applies.
    const preRows = preRowsMarkersIn(this.dir);
    if (preRows.length > 0) {
      throw new StoreError("STORE_PRE_ROWS", {
        dir: this.dir,
        // ALL of them, not the first: a refusal that named only
        // `operational.sqlite` never mentioned the 16,000 files under `prose/`,
        // which is the part the owner would want named.
        found: preRows.join(", "),
        expected: SCHEMA_VERSION,
        ...preRowsRemedy(this.dir, preRows),
      });
    }

    // A ROLLBACK'S HOLD, SECOND, for the first one's reason: nothing below may
    // run on a store `counterparts rollback` took back to an older schema. A
    // writer would upgrade it again, and an observer would build this build's
    // cache beside it, which the older build then refuses (`rollback-hold.ts`).
    if (opts.releaseRollbackHold !== true) {
      const hold = rollbackHeld(this.dir);
      if (hold !== null) {
        const h = hold === "unreadable" ? null : hold;
        // No database under the hold: the rollback stopped before its copy
        // went in. The older version is NOT the way on there (it has no hold
        // to read, and would start a blank store); `--undo` is.
        const halfway = !existsSync(join(this.dir, DATABASE_FILE));
        throw new StoreError("STORE_ROLLED_BACK", {
          dir: this.dir,
          from: h?.from ?? null,
          to: h?.to ?? null,
          at: h === null ? null : isoInstant(h.at),
          snapshot: h?.snapshot ?? null,
          aside: h?.aside ?? null,
          halfway,
          remedy: halfway
            ? "A rollback of this store stopped before its copy went in, so there is no database here and the " +
              `newer store is set aside${h === null ? "" : ` in ${h.aside}`}. Run counterparts rollback --dir ${this.dir} --undo ` +
              "to put it back. Don't install the older version first: it would start a blank store here."
            : `This store was rolled back${h === null ? "" : ` to schema v${h.to}`} with counterparts rollback, ` +
              "so this build leaves it alone: install the version you went back to, or run " +
              `counterparts rollback --dir ${this.dir} --upgrade-again to upgrade it again ` +
              "(or --undo to put the newer store back).",
        });
      }
    }

    // AN INSTRUMENT WRITES NOTHING AT OPEN when there is a store to read.
    //
    // The old constructor ran the DDL and four meta upserts on every open,
    // whatever the stance — and a write at open takes SQLite's write lock, which
    // is how a live `counterparts backup` threw "database is locked" while a
    // session held an open transaction (live-verify 2026-08-25; CLI CONTRACT §5
    // G8 says a backup never throws). An up-to-date store now opens clean, and a
    // store that is a schema BEHIND refuses under observer by name rather than
    // migrating itself out from under the process that owns it.
    //
    // An ABSENT store refuses under observer too (cli INTERFACE-GAPS §7, closed
    // 2026-08-26). There is no lock to contend for there — but "an instrument
    // that MINTS a data dir by looking at one is a wart" (`statusCommand`), and
    // a stood-down hook with an unreadable config was exactly the caller that
    // would quietly deposit a skeleton store on a machine that had none. Same
    // named refusal as the schema-behind case: to a reader, "not created yet"
    // and "not migrated yet" are one condition — nothing here to read.
    const fresh = !existsSync(paths.operational(this.dir));
    if (this.observer && fresh) {
      throw new StoreError("STORE_UNINITIALIZED", {
        path: paths.operational(this.dir),
        expected: SCHEMA_VERSION,
      });
    }
    // ONE DIRECTORY, either way: box 3's. `prose/`, `versions/` and `tmp/` went
    // with the floor — the canonical box is a single file SQLite makes itself,
    // and there is nothing left to stage. Box 3's container is made even under
    // observer, and only because it is DECLARED rebuildable: an instrument
    // needs somewhere to open the cache, and materializing the cache's own
    // directory changes no canonical state and takes no canonical lock.
    mkdirSync(paths.cacheDir(this.dir), { recursive: true });
    let migration = null as MigrationNote | null;
    this.ops = openOperational(paths.operational(this.dir), {
      initialize: !this.observer,
      // For the v7 migration's clamp of `lastActiveDate` (review S1).
      localToday: localDate(this.nowFn(), resolveZone(this.configuredZone)),
      retentionDays: this.retentionDays,
      ...(opts.snapshotsDir === undefined ? {} : { snapshotsDir: opts.snapshotsDir }),
      ...(opts.releaseRollbackHold === true ? { freshMigrationCopy: true } : {}),
      onMigrated: (note) => {
        migration = note;
      },
    });
    this.migration = migration;
    this.cache = openCache(paths.cache(this.dir));
    // THE AT-OPEN IDENTITY CHECK (cache v5, roadmap C1). Once per open, never
    // per call, and never under observer: an instrument has no embedder, and
    // "a recorded identity with no configured embedder" keeps the rows as they
    // are.
    //
    // A cache from a NEWER build is checked first and wins over everything:
    // no reconcile (it could drop rows or write a tag), no vectors written, no
    // ranking — whatever this process configured. Named, never silent.
    //
    // A HOLD IS THE FILE'S, NOT THE HANDLE'S (review of #190, MAJOR 1): a
    // handle with no identity — the MCP server's, the dashboard's, the
    // console's — reads the durable marker and refuses to rank exactly as the
    // handle that wrote it does. Either way a held or ahead handle has its
    // embedder withdrawn, so no vector is written beside another model's.
    const identity = this.observer ? undefined : opts.embed?.identity;
    this.identity = identity;
    const ahead = cacheAhead(this.cache);
    const held = ahead === null && identity === undefined ? heldEmbedder(this.cache) : null;
    // A DECISION that lost box 3's write lock past the busy timeout costs the
    // tag for this open, never the open (re-review NIT 1): `deferred`, the
    // embedder withdrawn, and the next open decides again.
    const reconcile = (id: EmbedderIdentity): EmbedderVerdict => {
      try {
        return reconcileEmbedder(this.cache, id);
      } catch (err) {
        if (!isLocked(err)) throw err;
        return { kind: "deferred", reason: "locked" };
      }
    };
    this.embedderVerdict =
      ahead !== null
        ? { kind: "cache-ahead", found: ahead.found, expected: ahead.expected }
        : identity !== undefined
          ? reconcile(identity)
          : held !== null
            ? {
                kind: "held",
                recorded: recordedEmbedder(this.cache)?.tag ?? null,
                configured: held,
                rows: embeddingCount(this.cache),
                fresh: false,
              }
            : { kind: "none" };
    if (
      this.embedderVerdict.kind === "held" ||
      this.embedderVerdict.kind === "cache-ahead" ||
      this.embedderVerdict.kind === "deferred"
    ) {
      this.embed = undefined;
    }
    if (this.embedderVerdict.kind === "cache-ahead") {
      this.emit("cache.schema.ahead", undefined, verdictData(this.embedderVerdict));
    } else if (this.embedderVerdict.kind !== "none" && this.embedderVerdict.kind !== "match") {
      this.emit("cache.embedder.reconciled", undefined, verdictData(this.embedderVerdict));
    }
    // THE DAY THIS STORE BEGAN (`STORE_CREATED_KEY`, new-user finding 8). Only
    // the open that CREATED the file writes it, and `OR IGNORE` on top of that:
    // a store that was already here must never be stamped with a day it did not
    // begin on. Under observer nothing is written at all — an instrument that
    // minted this row would be writing at open, which is the rule two comments
    // up. The provenance clock, so a seeded test dates it as it dates everything
    // else.
    if (fresh && !this.observer) {
      this.ops.run(
        "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
        STORE_CREATED_KEY,
        // The person's day (2026-09-25); a store made before this carries UTC.
        this.today(),
      );
    }
    // THE OLD-CLAIMS ERA's cutoff (2026-10-10, `operational.ts#CLAIMS_ERA_CUTOFF_KEY`),
    // recorded ONCE, at the first writable open by a build that knows it: on a
    // v12 store that is this same open, the one that just migrated it to v13;
    // on a store already at v13, its next open; on a new store, its birth.
    // Read first, written only when absent — a write at every open would take
    // the write lock (the "database is locked" scar above). Keyed on the
    // RECORDED marker, so a switch turned off stays off. A lost lock costs the
    // record for this open, never the open: the next writable open records it.
    if (!this.observer) {
      try {
        const recorded = this.ops.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", CLAIMS_ERA_RECORDED_KEY);
        if (recorded === undefined) {
          const at = String(this.nowFn());
          this.ops.transaction(() => {
            // Asked again under the write lock (review of #377): another opener
            // may have recorded it since the read above, and an owner may have
            // turned it off since — a second insert would switch it back on.
            if (this.ops.get("SELECT 1 FROM meta WHERE key = ?", CLAIMS_ERA_RECORDED_KEY) !== undefined) return;
            this.ops.run("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", CLAIMS_ERA_RECORDED_KEY, at);
            this.ops.run("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", CLAIMS_ERA_CUTOFF_KEY, at);
          });
        }
      } catch (err) {
        if (!isLocked(err)) throw err;
      }
    }
    // The owner-op capability. Handed to the seam module, never to a caller:
    // holding a Store gives you no way to destroy anything, and `ownerMutate`
    // routes the chase through the same stance check every write crosses.
    grantOwnerOps(this, {
      dir: this.dir,
      ownerMutate: (site, fn) => {
        this.assertWritable(site);
        return this.ops.transaction(() => fn(this.ops));
      },
      rawRow: (id) => this.row(id),
      isDenied: (id) => this.isDenied(id),
      // The narrowest possible route to box 3, and the LEXICAL half only: it
      // rewrites `doc_tokens` / `doc_lens` for one id from that id's own prose,
      // and leaves the `embeddings` row exactly where it is (`indexDoc` writes a
      // vector only when it is HANDED one, and it is not handed one here). A
      // restore must never make a paid embedding call, and it must never drop a
      // vector it cannot recompute.
      //
      // It exists because `archive()` is on its way to DEINDEXING (PR #64,
      // `overnight/df-live-rows`, counts document frequency over live rows by
      // removing archived rows from the index). Without this, whichever of the
      // two lands second leaves `unarchiveMerged` restoring a row that is live,
      // listed in `beliefs(entity)`, and invisible to lexical recall — with no
      // cheap repair, since a cache rebuild without an embedder drops every
      // vector on the store. Harmless on a master where `archive()` still
      // leaves the index alone: re-indexing an already-indexed row from its own
      // prose is a write of the same rows.
      reindexLexical: (id) => {
        const row = this.row(id);
        if (row === undefined) return;
        indexDoc(this.cache, id, indexTextOf(row.title, row.body));
      },
    });
    this.assertLayout();
    this.afterReconcile(identity);
    if (migration !== null) this.noteMigration(migration);
  }

  /** The durable row for a migration this open ran, naming the copy taken first. */
  private noteMigration(note: MigrationNote): void {
    const data = { from: note.from, to: note.to, snapshot: note.snapshot, reused: note.reused, dir: note.dir };
    this.emit(STORE_MIGRATED_EVENT, undefined, data);
    try {
      this.appendEvent({ name: STORE_MIGRATED_EVENT, day: this.livedDay(), payload: data });
    } catch {
      // A lost lock costs the row, never the open; the copy is on disk either way.
    }
  }

  /**
   * What an open does AFTER the identity check wrote something — and only then;
   * the steady state (a match, `none`, a standing hold) writes nothing here.
   *
   *   1. **A durable row** (`EMBEDDER_RECONCILED_EVENT`) for every transition:
   *      a reset (and how many vectors it dropped), a NEW hold (with the two
   *      exits), an adoption, a released hold. Through box 2's event log, not
   *      only the in-process ring — the hook's composition root passes no
   *      `onEvent`, and a drop nobody can read tomorrow is the §2.4 failure.
   *   2. **The skip list starts over for a new identity** (review MINOR 3): an
   *      id the old embedder gave up on (a Voyage 400, a table with no token
   *      for an emoji) is offered to the new one. `embed.failed.<id>` counters
   *      are not keyed by identity, so a reset is when they stop meaning
   *      anything.
   *   3. **Inline refill**, for an embedder that can: every live memory is
   *      missing its vector and a static table computes them in-process for
   *      nothing. The tag went down FIRST (inside `reconcileEmbedder`), so a
   *      process that dies part-way leaves rows that all match their tag, and
   *      the worker's backfill finishes the rest.
   */
  private afterReconcile(identity: EmbedderIdentity | undefined): void {
    if (this.observer) return;
    const v = this.embedderVerdict;
    const newIdentity = v.kind === "reset" || (v.kind === "tagged" && v.tag !== null && v.adopted === 0);
    const durable =
      v.kind === "reset" ||
      v.kind === "deferred" ||
      (v.kind === "held" && v.fresh) ||
      (v.kind === "tagged" && v.adopted > 0) ||
      (v.kind === "match" && v.released === true);
    if (durable) {
      try {
        this.appendEvent({
          name: EMBEDDER_RECONCILED_EVENT,
          day: this.livedDay(),
          payload: { ...verdictData(v), ...(v.kind === "held" ? { exits: heldExits(v.recorded) } : {}) },
        });
      } catch {
        // A lost lock costs the row, never the open (§5 G2's spirit).
      }
    }
    if (newIdentity) {
      try {
        const moves: [string, string][] = [];
        for (const [key, value] of this.metaWithPrefix(EMBED_FAILED_PREFIX)) {
          if (value !== "0") moves.push([key, "0"]);
        }
        if (moves.length > 0) this.setMetaMany(moves);
      } catch {
        // Same bargain: the counters are a retry hint, not memory.
      }
    }
    if (identity?.rebuild === "inline" && (v.kind === "reset" || (v.kind === "tagged" && v.tag !== null))) {
      this.refillVectorsInline();
    }
  }

  static open(opts: StoreOptions = {}): Store {
    return new Store(opts);
  }

  private closed = false;

  /**
   * Close both boxes. A handle that WROTE folds the write-ahead log of each box
   * it wrote to first (`db.ts#foldWal`, cli INTERFACE-GAPS §13), so a clean close
   * leaves a `-wal` of zero bytes (or none) rather than one at its high-water
   * size.
   *
   * **Only a box this handle wrote** (`db.ts#wroteOn`, SQLite's
   * `total_changes()` on this connection — row changes only). A writable handle
   * that only read — a dry run, a report opened without `observer` — leaves the
   * files exactly as it found them, which is what the dry-run suites' byte
   * fingerprints assert; a log some other process left is that process's to
   * fold on ITS close. A schema-only write (an open that migrated or tagged,
   * changing no row) does not fold either; the next writer's close does.
   *
   * **Never under observer.** A checkpoint moves committed pages from the `-wal`
   * into the database file — bytes of the canonical box change even though no
   * row does — and the byte-identity suites hash the file WITH its `-wal`
   * around an instrument's open and close to prove it wrote nothing (NOTES §8).
   * An instrument leaves the log for the next writer.
   *
   * **Never waits, never throws.** A reader holding an older snapshot (the MCP
   * server, the worker, the dashboard) makes the fold partial: whatever could be
   * copied is, the log keeps its size, and the ring carries
   * `store.wal.checkpoint` with `busy: true`. One event per box either way,
   * emitted AFTER both handles are closed so a listener cannot write a frame
   * back into a log that was just folded.
   *
   * A second call returns at once: nothing folds and neither handle is closed
   * again (`node:sqlite` throws on a double close).
   */
  close(): void {
    if (this.closed) return;
    const folds: [string, WalFold][] = [];
    if (!this.observer) {
      if (wroteOn(this.ops)) folds.push(["store", foldWal(this.ops)]);
      if (wroteOn(this.cache)) folds.push(["cache", foldWal(this.cache)]);
    }
    this.closed = true;
    this.ops.close();
    this.cache.close();
    for (const [box, f] of folds) {
      try {
        this.emit("store.wal.checkpoint", undefined, {
          box,
          busy: f.busy,
          log: f.log,
          checkpointed: f.checkpointed,
          ...(f.error === undefined ? {} : { error: f.error }),
        });
      } catch {
        // A listener that throws costs its own event, never the close.
      }
    }
  }

  /** Prepared once, on first use; see `schemaVersions`. */
  private schemaReads: { store: Statement; cache: Statement } | undefined;

  /**
   * THE SCHEMA STAMPS ON DISK NOW, read fresh on this store's own two
   * connections — two primary-key lookups, no transaction, no write, and
   * nothing that changes under observer.
   *
   * `SCHEMA_AHEAD` is decided ONCE, at open (`operational.ts#openOperational`),
   * and that is right for every process that opens a store and closes it again
   * within one event. It is not enough for one that stays open: a hook running
   * newer code can migrate the file underneath it, and nothing on the handle it
   * already holds would say so. This is how such a process asks.
   *
   * It SEES the other process's migration because neither read runs inside a
   * transaction: each one starts a fresh read on the connection and so reads
   * whatever was last committed, WAL or not. Prepared once and kept, so the
   * steady-state cost is two statement steps (measured, ~3 µs — the MCP
   * adapter's NOTES). It may THROW — a table another build dropped, a
   * disk that went away — and the caller decides what that means; the only
   * caller today refuses its tool rather than guess.
   */
  schemaVersions(): SchemaVersions {
    this.schemaReads ??= {
      store: this.ops.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'"),
      cache: this.cache.prepare("SELECT value FROM cache_meta WHERE key = 'schemaVersion'"),
    };
    return {
      store: this.schemaReads.store.get<{ value: string }>()?.value ?? null,
      cache: this.schemaReads.cache.get<{ value: string }>()?.value ?? null,
    };
  }

  // ── the seam ───────────────────────────────────────────────────────────────

  /**
   * The one place a write becomes durable. Stance first, transaction second: an
   * observer refuses before any staging, and a partial multi-row change is
   * impossible because box 2 rolls back as a unit.
   */
  private mutate<T>(site: WriteMethod, fn: () => T): T {
    this.assertWritable(site);
    return this.ops.transaction(fn);
  }

  /** `chaseRemoved` and `unarchiveMerged` are not Store methods — they are the
   *  owner-op seam's, and they cross the same stance check, which is why their
   *  site names are spelled here. */
  private assertWritable(site: WriteMethod | "chaseRemoved" | "unarchiveMerged"): void {
    if (this.observer) {
      // Telemetry is the deliberate exception: a stood-down instrument must be
      // distinguishable from a broken hook (observer-mode.md G5/G6, scar §2.4).
      this.emit("store.observer.standdown", undefined, { site });
      throw new StoreError("OBSERVER_REFUSED", { site });
    }
    // The caller's own check, when it installed one (`guardWrites`): AFTER the
    // stance, so an instrument's refusal stays the observer's, and BEFORE any
    // transaction, so a write it refuses has staged nothing.
    this.writeGuard?.(site);
  }

  /** The one slot `guardWrites` fills. */
  private writeGuard: ((site: string) => void) | null = null;

  /**
   * A CHECK RUN BEFORE EVERY WRITE THIS STORE MAKES — every `WRITE_METHODS` site
   * and the owner-op seam's, through `assertWritable`, after the stance check
   * and before the transaction. It refuses by THROWING; whatever it throws is
   * what the writer sees, and nothing has been staged.
   *
   * It exists for the one long-lived caller (2026-09-23, roadmap E, #187
   * re-review N5): the MCP server holds this store for a whole session while
   * the hooks, on a newer build, may migrate it. Its tools check the schema
   * stamps on entry, but a deposit can `await` (the embedder, at write time)
   * between that check and its writes; the guard re-reads the stamps at the
   * moment each write happens (`schemaVersions`, ~3 µs). One slot; null
   * removes it. The store itself decides nothing with it.
   */
  guardWrites(check: ((site: string) => void) | null): void {
    this.writeGuard = check;
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const event: StoreEvent = { at: this.nowFn(), name };
    if (ref !== undefined) event.ref = ref;
    if (data !== undefined) event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(event);
  }

  /**
   * The provenance clock's instant, and the calendar date it falls on.
   *
   * TWO CLOCKS, and this is the second one. `livedDay()` above is the physics
   * clock — how much EXPERIENCE has passed, which is what decay and
   * consolidation run on. These two say WHEN IN THE WORLD, which is what a
   * memory's provenance is made of. A caller that wants "the date this store
   * thinks it is" asks here rather than reading the ambient clock, so a seeded,
   * replayed or migrated store dates its rows by the run it is replaying.
   *
   * `today()` is the person's calendar day — the LOCAL date of `now()` in
   * `zone()` (docs/time.md, 2026-09-25). It was UTC until then, on the reasoning
   * NOTES 2026-09-05 records: provenance and the hooks' dates on one calendar.
   * They moved together, so they are still on one — the local one.
   */
  now(): number {
    return this.nowFn();
  }

  today(): string {
    return localDate(this.nowFn(), this.zone());
  }

  /** The zone this store reads a person's day in: the configured one, else the
   *  machine's current zone, resolved now (`time.ts#resolveZone`). */
  zone(): string {
    return resolveZone(this.configuredZone);
  }

  /** Copies, ordered oldest first. Optionally filtered by name. */
  events(name?: string): StoreEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  /** Contract §5 G11: a top-level path nobody classified fails loudly. */
  assertLayout(): void {
    assertLayoutClassified(readdirSync(this.dir));
  }

  backupSet(): string[] {
    return LAYOUT.filter((e) => e.backup).map((e) => e.name);
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  put(input: PutInput): string {
    const doc = this.mutate("put", () => this.insertOne(input));
    this.indexOne(doc);
    this.emit("store.put", doc.id, { type: doc.type, kind: input.kind, hash: hashText(doc.body) });
    return doc.id;
  }

  /**
   * Atomic by default: one bad input and NOTHING lands. `isolate: true` opts into
   * per-item persistence isolation (§16 G6) — the failure is logged and skipped and
   * the rest persist. Two different promises; the caller picks, out loud.
   */
  putMany(inputs: readonly PutInput[], opts: { isolate?: boolean } = {}): string[] {
    const landed = this.mutate("putMany", () => {
      const out: { doc: ProseDoc; input: PutInput }[] = [];
      for (const input of inputs) {
        try {
          // A SAVEPOINT PER ITEM under `isolate`, not a bare call. The insert
          // used to be preceded by a file stage that validated everything
          // first, so a throw happened before any row was written; now the
          // validation and the INSERT are in the same method, and a failure
          // after the INSERT — a constraint, a foreign key, anything a later
          // reviewer adds below it — would otherwise be swallowed here and
          // COMMITTED by the outer transaction. `Db.transaction` nests as
          // SAVEPOINT / ROLLBACK TO, so per-item isolation is structural
          // (§16 G6) rather than a property of the current line order.
          out.push({ doc: this.isolatedInsert(input, opts.isolate === true), input });
        } catch (err) {
          if (!opts.isolate) throw err;
          this.emit("store.put.skipped", input.id, {
            reason: err instanceof StoreError ? err.code : "UNKNOWN",
          });
        }
      }
      return out;
    });
    for (const s of landed) {
      this.indexOne(s.doc);
      this.emit("store.put", s.doc.id, {
        type: s.doc.type,
        kind: s.input.kind,
        hash: hashText(s.doc.body),
      });
    }
    return landed.map((s) => s.doc.id);
  }

  /** `insertOne`, inside its own savepoint when the caller asked for isolation. */
  private isolatedInsert(input: PutInput, isolate: boolean): ProseDoc {
    return isolate ? this.ops.transaction(() => this.insertOne(input)) : this.insertOne(input);
  }

  /**
   * In-place content revision. The prior version is written in the SAME
   * transaction as the update (§16 G4) — not before it, because there is no
   * longer a before: the version is a row, not a file copied out of the way.
   *
   * `learnedOn` / `happenedOn` are the PROVENANCE half, and they travel this same
   * door on purpose (§I7, `NOTES.md` 2026-09-05): correcting a date is a change to
   * canonical content, so it keeps the prior version exactly the way a body change
   * does — constitution 7, nothing is silently overwritten and the old date stays
   * readable in the version. **That is why `versions` carries `learned_on` and
   * `happened_on` of its own**, which the floor plan did not ask for: with the
   * dates read off the live row instead, one correction would have silently
   * rewritten every version behind it.
   */
  revise(
    id: string,
    patch: {
      body?: string;
      title?: string;
      meta?: Record<string, unknown>;
      learnedOn?: string;
      happenedOn?: string;
      /** A new reminder date, or `null` to clear it (a reschedule, a cancel). */
      eventDate?: string | null;
      /** v12: the writer's three fields, or `null` to clear one. Absent keeps it. */
      occurredOn?: string | null;
      saidBy?: SaidBy | null;
      status?: MemoryStatus | null;
      /** Who wrote the new words (see `PutInput.model`). A revise that changes
       *  the BODY and names no model records NULL: the words are no longer the
       *  last model's. A revise that leaves the body alone keeps the model. */
      model?: string;
      reason?: string;
    },
  ): number {
    const { doc, seq, hash } = this.mutate("revise", () => {
      const row = this.requireRow(id);
      const prior = this.docOf(row);
      const seq = row.revision + 1;
      // THE PRIOR VERSION, WORDS AND ALL, IN THE SAME TRANSACTION. It used to be
      // a file copied into `versions/<id>/` before the new text was staged, with
      // a `wx` collision loop and a crash window between the two; it is now a
      // row written beside the update, so "an overwrite keeps the prior version"
      // is a property of the transaction rather than of the ordering (§5 G5).
      const at = this.nowFn();
      const eventDate =
        patch.eventDate === undefined || patch.eventDate === null ? patch.eventDate : assertEventDate(patch.eventDate, id);
      this.ops.run(
        `INSERT INTO versions
           (memory_id, seq, reason, version_day, archived_at, content_hash, successor_id,
            title, body, meta, learned_on, happened_on, created_at, model, event_date,
            occurred_on, said_by, status)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        seq,
        patch.reason ?? "revise",
        this.livedDay(),
        at,
        row.content_hash,
        row.title,
        row.body,
        row.meta,
        row.learned_on,
        row.happened_on,
        // The archived words' own moment: when they were last written.
        row.updated_at ?? row.created_at,
        row.model,
        row.event_date,
        row.occurred_on ?? null,
        row.said_by ?? null,
        row.status ?? null,
      );
      const next: ProseDoc = {
        ...prior,
        body: patch.body ?? prior.body,
        meta: patch.meta ? { ...prior.meta, ...patch.meta } : prior.meta,
      };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.learnedOn !== undefined) next.learnedOn = patch.learnedOn;
      if (patch.happenedOn !== undefined) next.happenedOn = patch.happenedOn;
      if (eventDate === null) delete next.eventDate;
      else if (eventDate !== undefined) next.eventDate = eventDate;
      const model =
        patch.model !== undefined
          ? modelOrNull(patch.model)
          : patch.body !== undefined
            ? null
            : row.model;
      // THE SAME RULE AS `put`, through the same function. `patch.body ?? ...`
      // accepts `""` happily, and on this floor that would write the one state
      // no write path may produce — a row whose hash names words its body no
      // longer holds, which every read answers as `MEMORY_BODY_MISSING` and
      // which takes the next session's `Schemas.open` down on a schema row.
      // Whitespace-only and a lone surrogate go through it too.
      next.body = bodyForStorage(next.body, id);
      const nextHash = hashText(next.body);
      // v12: the writer's three fields — a patch's, else the row's as they were.
      const occurredOn =
        patch.occurredOn === undefined ? (row.occurred_on ?? null) : patch.occurredOn === null ? null : occurredOnOf(patch.occurredOn);
      const saidBy = patch.saidBy === undefined ? (row.said_by ?? null) : saidByOf(patch.saidBy);
      const status = patch.status === undefined ? (row.status ?? null) : statusOf(patch.status);
      this.ops.run(
        `UPDATE memories
            SET content_hash = ?, revision = ?, title = ?, body = ?, meta = ?,
                confidential = ?, learned_on = ?, happened_on = ?,
                event_date = ?, model = ?, updated_at = ?,
                occurred_on = ?, said_by = ?, status = ?
          WHERE id = ?`,
        nextHash,
        seq,
        next.title ?? null,
        next.body,
        serializeMeta(next.meta, id),
        // RECOMPUTED, never carried: a revision that patches `meta` can turn
        // the confidentiality gate on or off, and a column that went stale
        // against its own truth table is a gate that fails open silently.
        confidentialByMeta(next.meta) ? 1 : 0,
        next.learnedOn,
        next.happenedOn ?? null,
        next.eventDate ?? null,
        model,
        at,
        occurredOn,
        saidBy,
        status,
        id,
      );
      // v12: NEW WORDS, NEW SUBJECTS — a revise that changes the title or the
      // body links what the words name now (a chapter copy regrows here); a
      // meta-only revise (a reminder moved, a thread closed) rescans nothing.
      if (row.type === "memory" && (patch.body !== undefined || patch.title !== undefined)) {
        this.relinkSubjects(id, next.title ?? null, next.body);
      }
      return { doc: next, seq, hash: nextHash };
    });
    this.indexOne(doc);
    this.emit("store.revise", id, { seq, hash });
    return seq;
  }

  /**
   * Supersession: the new memory is born, the old one keeps its id, its prose, and
   * a forwarding address. `resolve(oldId)` follows it forever — the VERSION ROW is
   * what expires at H, not the ability to resolve (§5 G4, §16 G3).
   */
  supersede(oldId: string, input: PutInput, reason = "supersede"): string {
    const { doc, newId } = this.mutate("supersede", () => {
      const row = this.requireRow(oldId);
      const created = this.insertOne(input);
      // The version row carries a COPY of the head's words rather than a pointer
      // to the file both used to share. The head keeps its own row and its own
      // body too, so the text is held twice for as long as the version row
      // lives — the honest cost of rows over files, bounded by the 90-day
      // version prune (owner ruling 1). See `store/NOTES.md`.
      const at = this.nowFn();
      this.ops.run(
        `INSERT INTO versions
           (memory_id, seq, reason, version_day, archived_at, content_hash, successor_id,
            title, body, meta, learned_on, happened_on, created_at, model, event_date,
            occurred_on, said_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        oldId,
        row.revision + 1,
        reason,
        this.livedDay(),
        at,
        row.content_hash,
        created.id,
        row.title,
        row.body,
        row.meta,
        row.learned_on,
        row.happened_on,
        row.updated_at ?? row.created_at,
        row.model,
        row.event_date,
        row.occurred_on ?? null,
        row.said_by ?? null,
        row.status ?? null,
      );
      this.ops.run(
        `UPDATE memories SET superseded_by = ?, archived = 1, archived_reason = ?, revision = ?,
                updated_at = ?
          WHERE id = ?`,
        created.id,
        reason,
        row.revision + 1,
        at,
        oldId,
      );
      // v9: THE ABOUT-ME MARK TRAVELS with the memory to its successor, unless
      // the successor was given its own — a revision is still the same memory.
      carryAboutMark(this.ops, oldId, created.id);
      carryWriteFacts(this.ops, oldId, created.id);
      return { doc: created, newId: created.id };
    });
    this.indexOne(doc);
    // The head leaves box 3 as the successor enters it. Box 2 keeps the row,
    // the prose and the forwarding address — this is the INDEX, and the index
    // is the index of the live store (`cache.ts#deindexDoc`).
    deindexDoc(this.cache, oldId);
    this.emit("store.supersede", oldId, { successor: newId, reason });
    return newId;
  }

  /** Archive is a state, not a deletion: the id stays resolvable (§4.2 G3). */
  archive(id: string, reason: string): void {
    this.mutate("archive", () => {
      this.requireRow(id);
      this.ops.run(
        "UPDATE memories SET archived = 1, archived_reason = ?, updated_at = ? WHERE id = ?",
        reason,
        this.nowFn(),
        id,
      );
    });
    // Out of the index, not out of the store: `read`, `resolve` and the version
    // chain are untouched. An archived row was never deliverable — `activate`
    // discards the hit — and while it stayed indexed it went on voting on
    // rarity against a live denominator (`cache.ts#deindexDoc`, I13).
    deindexDoc(this.cache, id);
    this.emit("store.archive", id, { reason });
  }

  /**
   * Physics-only bookkeeping. It never rewrites prose, which is why v1's
   * "strength-only exemption to archive-on-overwrite" is not ported: with physics in
   * box 2 the exemption is structural rather than a line-level diff (see NOTES.md).
   */
  updatePhysics(id: string, patch: Partial<MemoryPhysics>): void {
    this.mutate("updatePhysics", () => {
      this.requireRow(id);
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      const put = (col: string, val: string | number | null) => {
        sets.push(`${col} = ?`);
        args.push(val);
      };
      if (patch.kind !== undefined) put("kind", patch.kind);
      if (patch.salience !== undefined) {
        put("novelty", patch.salience.novelty);
        put("relevance", patch.salience.relevance);
        put("emotional", patch.salience.emotional);
        put("predictive", patch.salience.predictive);
        put("claimed", patch.salience.claimed ?? null);
      }
      if (patch.birthDay !== undefined) put("birth_day", patch.birthDay);
      if (patch.uses !== undefined) put("uses", patch.uses);
      if (patch.lastUsedDay !== undefined) put("last_used_day", patch.lastUsedDay);
      if (patch.reinforcedDays !== undefined) put("reinforced_days", patch.reinforcedDays);
      if (patch.consolidated !== undefined) put("consolidated", patch.consolidated ? 1 : 0);
      if (patch.promotedIdentity !== undefined)
        put("promoted_identity", patch.promotedIdentity ? 1 : 0);
      if (patch.protected !== undefined) put("protected", patch.protected ? 1 : 0);
      if (patch.pressure !== undefined) put("pressure", patch.pressure);
      if (patch.lastChallengedDay !== undefined)
        put("last_challenged_day", patch.lastChallengedDay);
      // v10: the settle's multiplier (physics §5.12). Written only by a settle and its undo.
      if (patch.fade !== undefined) put("fade", patch.fade);
      if (sets.length === 0) return;
      this.ops.run(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`, ...args, id);
    });
    this.emit("store.physics", id, { fields: Object.keys(patch).join(",") });
  }

  /**
   * Persist one credited use. The crediting RULE is owned entirely by
   * physics.creditUse (§5.5 tier weights, birth-day / stale-day / same-day
   * refusals, distinct-day counting for §5.3 promotion) — the store applies the
   * verdict absolutely and adds no opinion of its own. One rule, one owner:
   * a second implementation of this arithmetic is exactly the divergence that
   * produced v1's "two clocks" fiction.
   *
   * v8 (2026-09-26): a credited use is ALSO asked whether it is a RETURN
   * (`physics.creditReturn`, §5.11) — in the same transaction, with the one fact
   * only the store holds: whether the memory was SHOWING in the wake's hints
   * lane on this day (`wake_display`). A return is recorded as a `returns` row
   * and the aggregate columns are recomputed from the table. The use itself is
   * credited exactly as before either way.
   */
  reinforce(
    id: string,
    day: number,
    tier: UseTier = "referenced",
    opts: {
      /**
       * The use came from recall SURFACING the memory on this turn's own cue
       * (a quoted loud candidate), not from an id the model could have read
       * off the wake: organic whatever the hints lane was showing, so the
       * display check is skipped. Absent — every other caller — the display
       * decides.
       */
      cued?: boolean;
      /**
       * A lower tier this memory was credited at earlier THIS lived day, which
       * this use lifts (`physics.creditUse`, 2026-10-11). The caller that
       * recorded the earlier credit knows it (recall's gate state, for its own
       * session). Absent, an `engaged` credit today is still found by its
       * return row, so another session's open lifts it too.
       */
      upgradeFrom?: UseTier;
    } = {},
  ): CreditOutcome & { ret: ReturnOutcome | null } {
    const outcome = this.mutate("reinforce", () => {
      const row = this.requireRow(id);
      let physics = rowToPhysics(row);
      const upgradeFrom = opts.upgradeFrom ?? this.engagedToday(id, day, row.last_used_day, tier);
      const verdict = creditUse(physics, day, tier, upgradeFrom === undefined ? {} : { upgradeFrom });
      let ret: ReturnOutcome | null = null;
      if (verdict.credited) {
        this.ops.run(
          `UPDATE memories
              SET uses = ?, last_used_day = ?, reinforced_days = ?
            WHERE id = ?`,
          verdict.next.uses,
          verdict.next.lastUsedDay,
          verdict.next.reinforcedDays,
          id,
        );
        // AN ENGAGED USE (2026-10-11, `drewOn`) is half a return of its own
        // source, outside the core lanes. A use that LIFTS today's engaged
        // credit takes its return back first, so the day's one return is the
        // higher one.
        if (upgradeFrom === "engaged" && tier !== "engaged") {
          this.ops.run("DELETE FROM returns WHERE memory_id = ? AND day = ? AND source = 'engaged'", id, day);
          this.recomputeReturns(id);
          physics = rowToPhysics(this.requireRow(id));
        }
        ret =
          tier === "engaged"
            ? creditReturn(physics, day, { source: "engaged", since: this.spacingSince(id) })
            : creditReturn(physics, day, {
                source: "awake",
                tierWeight: verdict.w,
                onDisplay: opts.cued !== true && this.shownInHints(id, day),
                since: this.spacingSince(id),
              });
        if (ret.counted) this.writeReturn(id, day, ret, null);
      }
      return { ...verdict, ret };
    });
    this.emit("store.reinforce", id, {
      credited: outcome.credited,
      reason: outcome.reason,
      day,
      tier,
      returned: outcome.ret?.counted ?? false,
      returnReason: outcome.ret?.reason ?? null,
    });
    return outcome;
  }

  /**
   * A DREAM REPLAY (physics §5.11): a return worth `DREAM_RETURN_WEIGHT` of an
   * awake one, spacing-scaled, at most once per dream per memory — and never a
   * USE: `uses`, `lastUsedDay` and the rep arm are untouched, and the core
   * lanes do not count it. Tagged with the dream's id so undoing the dream
   * removes it (`retractDreamReturns`).
   */
  replayReturn(id: string, day: number, dreamId: string): ReturnOutcome {
    const outcome = this.mutate("replayReturn", () => {
      const row = this.requireRow(id);
      const ret = creditReturn(rowToPhysics(row), day, { source: "dream", since: this.spacingSince(id) });
      if (ret.counted) this.writeReturn(id, day, ret, dreamId);
      return ret;
    });
    this.emit("store.replay", id, { counted: outcome.counted, reason: outcome.reason, day, dream: dreamId });
    return outcome;
  }

  /**
   * A REFLECTION RETURN (physics §5.11, v9, 2026-09-27): the waking self after
   * a dream deliberately revisited this memory and cited it. An awake return —
   * it counts toward the core lanes — though the reflection was HANDED the
   * memory: on display by construction, counted on purpose (physics CONTRACT
   * §5.11). At most once per lived day per memory, and at most once every
   * `REFLECTION_SPACING_DAYS` per memory, so a reflection cannot carry a
   * memory through the slow lane by citing it every night. Not a use: `uses`
   * and `lastUsedDay` are untouched. No dream id: undoing the dream does not
   * take back what was lived awake after it.
   */
  reflectReturn(id: string, day: number): ReturnOutcome {
    const outcome = this.mutate("reflectReturn", () => {
      const row = this.requireRow(id);
      const last =
        this.ops.get<{ d: number | null }>("SELECT MAX(day) AS d FROM returns WHERE memory_id = ? AND source = 'reflection'", id)?.d ??
        null;
      const ret = creditReturn(rowToPhysics(row), day, {
        source: "reflection",
        since: this.spacingSince(id),
        lastReflectionDay: last,
      });
      if (ret.counted) this.writeReturn(id, day, ret, null);
      return ret;
    });
    this.emit("store.reflect", id, { counted: outcome.counted, reason: outcome.reason, day });
    return outcome;
  }

  /**
   * The last day of a return the physics fields do not carry, which spacing
   * still measures from (the lanes never read it): a LEGACY return the v8
   * upgrade credited, or an ENGAGED one (2026-10-11, `drewOn` — no column, so
   * "spaced like the others" reads it off the table).
   */
  private spacingSince(id: string): number | null {
    return (
      this.ops.get<{ d: number | null }>(
        "SELECT MAX(day) AS d FROM returns WHERE memory_id = ? AND source IN ('legacy', 'engaged')",
        id,
      )?.d ?? null
    );
  }

  /**
   * `engaged` when today's credit for this memory was an ENGAGED one — its
   * return row says so — and a use above that tier would lift it; otherwise
   * undefined (2026-10-11). Only an engaged credit writes that row, and a
   * lift deletes it, so its presence on a day the memory was used means the
   * day stands at the engaged tier. Not seen: an engaged credit whose return
   * was refused (another return already counted that day) — that lift is
   * left to the gate state of the session that gave it.
   */
  private engagedToday(id: string, day: number, lastUsedDay: number, tier: UseTier): UseTier | undefined {
    if (lastUsedDay !== day || USE_TIER_WEIGHT[tier] <= USE_TIER_WEIGHT.engaged) return undefined;
    const r = this.ops.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM returns WHERE memory_id = ? AND day = ? AND source = 'engaged'",
      id,
      day,
    );
    return (r?.n ?? 0) > 0 ? "engaged" : undefined;
  }

  /** Insert one `returns` row and bring the aggregate columns in line with the table. */
  private writeReturn(id: string, day: number, ret: ReturnOutcome, dreamId: string | null): void {
    this.ops.run(
      `INSERT OR IGNORE INTO returns (memory_id, day, source, weight, gap, dream_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      day,
      ret.source,
      ret.weight,
      Number.isFinite(ret.gap) ? ret.gap : 0,
      dreamId,
      this.nowFn(),
    );
    this.recomputeReturns(id);
  }

  /**
   * The aggregate columns FROM the `returns` table — the one place they are
   * written, so a removed dream's replays or a carried history can never leave
   * the physics disagreeing with its own evidence.
   *
   * v9 (2026-09-27): the LANE columns (`return_days`, `first_return_day`,
   * `last_return_day`) read `awake` AND `reflection` rows — a reflection that
   * deliberately revisits and cites a memory is an awake return (physics
   * §5.11). Dream replays and legacy credits still count toward durability
   * only.
   */
  private recomputeReturns(id: string): void {
    const agg = this.ops.get<{
      total: number | null;
      days: number | null;
      first: number | null;
      last: number | null;
      dream: number | null;
    }>(
      `SELECT SUM(weight) AS total,
              COUNT(DISTINCT CASE WHEN source IN ('awake', 'reflection') THEN day END) AS days,
              MIN(CASE WHEN source IN ('awake', 'reflection') THEN day END) AS first,
              MAX(CASE WHEN source IN ('awake', 'reflection') THEN day END) AS last,
              MAX(CASE WHEN source = 'dream' THEN day END) AS dream
         FROM returns WHERE memory_id = ?`,
      id,
    );
    this.ops.run(
      `UPDATE memories
          SET returns = ?, return_days = ?, first_return_day = ?, last_return_day = ?, last_dream_day = ?
        WHERE id = ?`,
      agg?.total ?? 0,
      agg?.days ?? 0,
      agg?.first ?? null,
      agg?.last ?? null,
      agg?.dream ?? null,
      id,
    );
  }

  /** One memory's counted returns, oldest first. A read. */
  returnsOf(id: string): ReturnRow[] {
    return this.ops.all<ReturnRow>("SELECT * FROM returns WHERE memory_id = ? ORDER BY day, source", id);
  }

  /**
   * Returns counted since a moment (UTC ms) or a lived day, by source — for
   * `fired`, the mechanism lights and the dashboard. With neither, all of them.
   */
  returnCounts(filter: { sinceAt?: number; sinceDay?: number } = {}): {
    awake: number;
    dream: number;
    /** v9: returns a reflection counted (also lane returns, beside `awake`). */
    reflection: number;
    memories: number;
  } {
    const r = this.ops.get<{ awake: number | null; dream: number | null; reflection: number | null; memories: number | null }>(
      `SELECT SUM(CASE WHEN source = 'awake' THEN 1 ELSE 0 END) AS awake,
              SUM(CASE WHEN source = 'dream' THEN 1 ELSE 0 END) AS dream,
              SUM(CASE WHEN source = 'reflection' THEN 1 ELSE 0 END) AS reflection,
              COUNT(DISTINCT CASE WHEN source != 'legacy' THEN memory_id END) AS memories
         FROM returns WHERE at >= ? AND day >= ? AND source != 'legacy'`,
      filter.sinceAt ?? 0,
      filter.sinceDay ?? -2_147_483_648,
    );
    return { awake: r?.awake ?? 0, dream: r?.dream ?? 0, reflection: r?.reflection ?? 0, memories: r?.memories ?? 0 };
  }

  // ── what the wake's hints lane showed (v8) ─────────────────────────────────

  /**
   * Was this memory SHOWING in the wake's hints lane on lived day `day`? True
   * from the first day of its current showing through the day a publish
   * dropped it: the day it is dropped is ambiguous (a session opened earlier
   * that day still read the old bundle), and #238's reading of that ambiguity —
   * count it as shown — is kept.
   */
  shownInHints(id: string, day: number): boolean {
    const r = this.ops.get<WakeDisplayRow>("SELECT * FROM wake_display WHERE memory_id = ?", id);
    if (r === undefined || r.lane !== "hints") return false;
    if (day < r.first_day) return false;
    return r.closed_day === null || day <= r.closed_day;
  }

  /** Every display row, by memory id. A read (`self/`'s habituation reads it). */
  wakeDisplays(): Map<string, WakeDisplayRow> {
    const out = new Map<string, WakeDisplayRow>();
    for (const r of this.ops.all<WakeDisplayRow>("SELECT * FROM wake_display")) out.set(r.memory_id, r);
    return out;
  }

  /**
   * Record what a PUBLISHED bundle kept in its hints lane on lived day `day`:
   * each kept id with the habituation load `self/` computed for it. A kept id
   * already showing extends its showing; a new one opens one; every OTHER
   * showing row still open is closed on `day`. Ids that no longer resolve to a
   * row are skipped. One transaction.
   */
  recordHintDisplay(day: number, kept: readonly { id: string; load: number }[]): void {
    this.mutate("recordHintDisplay", () => {
      const at = this.nowFn();
      const keptIds = new Set<string>();
      for (const k of kept) {
        const row = this.row(k.id);
        if (row === undefined) continue;
        keptIds.add(k.id);
        const prior = this.ops.get<WakeDisplayRow>("SELECT * FROM wake_display WHERE memory_id = ?", k.id);
        const open = prior !== undefined && prior.closed_day === null;
        this.ops.run(
          `INSERT INTO wake_display
             (memory_id, lane, first_day, shown_day, closed_day, load, ever_day, ever_uses, ever_last_used, updated_at)
           VALUES (?, 'hints', ?, ?, NULL, ?, ?, ?, ?, ?)
           ON CONFLICT (memory_id) DO UPDATE SET
             lane = 'hints', first_day = excluded.first_day, shown_day = excluded.shown_day,
             closed_day = NULL, load = excluded.load, updated_at = excluded.updated_at`,
          k.id,
          open ? prior.first_day : day,
          day,
          k.load,
          day,
          row.uses,
          row.last_used_day,
          at,
        );
      }
      for (const r of this.ops.all<WakeDisplayRow>("SELECT * FROM wake_display WHERE closed_day IS NULL")) {
        if (keptIds.has(r.memory_id)) continue;
        this.ops.run("UPDATE wake_display SET closed_day = ?, updated_at = ? WHERE memory_id = ?", day, at, r.memory_id);
      }
    });
    this.emit("store.display", undefined, { day, kept: kept.length });
  }

  // ── merges, and undoing them (v8, `core/dream/`) ───────────────────────────

  /**
   * One original FOLDED INTO an already-written successor — a dream's merge of
   * two or more near-copies. The original keeps its id, its words (a version
   * row carries them, with the successor named) and a forwarding address, and
   * is archived `reason`; nothing is deleted. With `carryReturns`, its return
   * history is copied onto the successor (a return day both had is kept once),
   * so the merged memory is at least as durable as what it was made from.
   */
  supersedeInto(oldId: string, successorId: string, reason: string, opts: { carryReturns?: boolean } = {}): void {
    this.mutate("supersedeInto", () => {
      const row = this.requireRow(oldId);
      this.requireRow(successorId);
      const at = this.nowFn();
      this.ops.run(
        `INSERT INTO versions
           (memory_id, seq, reason, version_day, archived_at, content_hash, successor_id,
            title, body, meta, learned_on, happened_on, created_at, model, event_date,
            occurred_on, said_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        oldId,
        row.revision + 1,
        reason,
        this.livedDay(),
        at,
        row.content_hash,
        successorId,
        row.title,
        row.body,
        row.meta,
        row.learned_on,
        row.happened_on,
        row.updated_at ?? row.created_at,
        row.model,
        row.event_date,
        row.occurred_on ?? null,
        row.said_by ?? null,
        row.status ?? null,
      );
      this.ops.run(
        `UPDATE memories SET superseded_by = ?, archived = 1, archived_reason = ?, revision = ?, updated_at = ?
          WHERE id = ?`,
        successorId,
        reason,
        row.revision + 1,
        at,
        oldId,
      );
      // v9: the about-me mark travels too (the first original that has one).
      carryAboutMark(this.ops, oldId, successorId);
      carryWriteFacts(this.ops, oldId, successorId);
      if (opts.carryReturns === true) {
        this.ops.run(
          `INSERT OR IGNORE INTO returns (memory_id, day, source, weight, gap, dream_id, at)
           SELECT ?, day, source, weight, gap, dream_id, at FROM returns WHERE memory_id = ?`,
          successorId,
          oldId,
        );
        this.recomputeReturns(successorId);
      }
    });
    deindexDoc(this.cache, oldId);
    this.emit("store.supersede", oldId, { successor: successorId, reason });
  }

  /**
   * The undo of `supersedeInto`: the original is live again — no forwarding
   * address, not archived — and back in the index. Its version row stays, as
   * history. Refused (a no-op) for a row that is not archived with `reason`.
   */
  restoreSuperseded(oldId: string, reason: string): boolean {
    const restored = this.mutate("restoreSuperseded", () => {
      const row = this.requireRow(oldId);
      if (row.archived !== 1 || row.archived_reason !== reason) return false;
      this.ops.run(
        `UPDATE memories SET superseded_by = NULL, archived = 0, archived_reason = NULL, updated_at = ?
          WHERE id = ?`,
        this.nowFn(),
        oldId,
      );
      return true;
    });
    if (restored) {
      try {
        this.indexOne(this.readProse(oldId));
      } catch {
        /* a row that will not read stays out of the index; the restore stands */
      }
      this.emit("store.restore", oldId, { reason });
    }
    return restored;
  }

  /** Remove one edge, or put back the weight it had before (a dream's link, undone). */
  restoreEdge(src: string, dst: string, restore: { weight: number; day: number } | null = null): void {
    this.mutate("restoreEdge", () => {
      if (restore === null) {
        this.ops.run("DELETE FROM edges WHERE src = ? AND dst = ?", src, dst);
      } else {
        this.ops.run(
          "UPDATE edges SET weight = ?, last_day = ?, updated_at = ? WHERE src = ? AND dst = ?",
          restore.weight,
          restore.day,
          this.nowFn(),
          src,
          dst,
        );
      }
    });
    this.emit("store.edge.restored", src, { dst, restored: restore !== null });
  }

  /** Delete feelings by id (a dream's feeling-now, undone). */
  retractFeelings(ids: readonly string[]): number {
    const n = this.mutate("retractFeelings", () => {
      let count = 0;
      for (const id of ids) {
        this.ops.run("UPDATE feelings SET beneath_id = NULL WHERE beneath_id = ?", id);
        this.ops.run("DELETE FROM feelings WHERE id = ?", id);
        count += this.ops.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
      }
      return count;
    });
    this.emit("store.feelings.retracted", undefined, { count: n });
    return n;
  }

  /** Delete a dream's replays and recompute each memory's returns from what is left. */
  retractDreamReturns(dreamId: string): number {
    const n = this.mutate("retractDreamReturns", () => {
      const ids = this.ops
        .all<{ memory_id: string }>("SELECT DISTINCT memory_id FROM returns WHERE dream_id = ?", dreamId)
        .map((r) => r.memory_id);
      this.ops.run("DELETE FROM returns WHERE dream_id = ?", dreamId);
      for (const id of ids) if (this.row(id) !== undefined) this.recomputeReturns(id);
      return ids.length;
    });
    this.emit("store.replay.retracted", undefined, { dream: dreamId, memories: n });
    return n;
  }

  // ── the core's history (v8) ────────────────────────────────────────────────

  /** Append one core event: a promotion (with its lane), a demotion, a nomination. */
  appendCoreEvent(input: {
    memoryId: string;
    /** v9 adds `about` (a mark set; `reason` is the mark and why) and `told`
     *  (a morning share that cited it was told to the owner). */
    action: "promoted" | "demoted" | "nominated" | "about" | "told";
    day: number;
    lane?: string | null;
    reason?: string | null;
    dreamId?: string | null;
    actor?: string | null;
  }): number {
    const seq = this.mutate("appendCoreEvent", () => {
      this.ops.run(
        `INSERT INTO core_events (memory_id, action, day, at, lane, reason, dream_id, actor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.memoryId,
        input.action,
        input.day,
        this.nowFn(),
        input.lane ?? null,
        input.reason ?? null,
        input.dreamId ?? null,
        input.actor ?? null,
      );
      return this.ops.get<{ seq: number }>("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
    });
    this.emit("store.core", input.memoryId, { action: input.action });
    return seq;
  }

  /** Core events, newest first, optionally for one memory / one action / since a moment. */
  coreEvents(filter: { memoryId?: string; action?: string; sinceAt?: number; limit?: number } = {}): CoreEventRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.memoryId !== undefined) {
      where.push("memory_id = ?");
      args.push(filter.memoryId);
    }
    if (filter.action !== undefined) {
      where.push("action = ?");
      args.push(filter.action);
    }
    if (filter.sinceAt !== undefined) {
      where.push("at >= ?");
      args.push(filter.sinceAt);
    }
    const sql = `SELECT * FROM core_events${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`;
    args.push(filter.limit ?? 1_000);
    return this.ops.all<CoreEventRow>(sql, ...args);
  }

  /** Delete a dream's nominations (the undo of its `nominate-core` changes). */
  retractDreamNominations(dreamId: string): number {
    const n = this.mutate("retractDreamNominations", () => {
      this.ops.run("DELETE FROM core_events WHERE dream_id = ? AND action = 'nominated'", dreamId);
      return this.ops.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
    });
    this.emit("store.core.retracted", undefined, { dream: dreamId, count: n });
    return n;
  }

  // ── what a memory is about (v9) ──────────────────────────────────────────

  /**
   * SET WHAT A MEMORY IS ABOUT (v9, 2026-09-27) — `me`, `us`, `owner`, `work`
   * or `world` — and record who said so and why in `core_events` (action
   * `about`, `reason` = `<mark> (was <before|unmarked>): <why>`). The mark is descriptive; only `me`,
   * `us` and `owner` make a core candidate. Refuses an unknown mark and a
   * removed or non-memory row by throwing, like every other seam write.
   */
  setAbout(
    id: string,
    mark: AboutMark,
    opts: { by: AboutSetter; day?: number; why?: string | null; dreamId?: string | null },
  ): { changed: boolean; before: AboutMark | null } {
    if (!(ABOUT_MARKS as readonly string[]).includes(mark)) throw new StoreError("ABOUT_UNKNOWN", { id, mark });
    const out = this.mutate("setAbout", () => {
      const row = this.requireRow(id);
      if (row.type !== "memory" || rowTombstoned(row)) throw new StoreError("ABOUT_NOT_A_MEMORY", { id });
      const before = aboutMarkOf(row.about);
      this.ops.run("UPDATE memories SET about = ?, about_by = ? WHERE id = ?", mark, opts.by, id);
      const why = (opts.why ?? "").trim();
      this.ops.run(
        `INSERT INTO core_events (memory_id, action, day, at, lane, reason, dream_id, actor)
         VALUES (?, 'about', ?, ?, NULL, ?, ?, ?)`,
        id,
        opts.day ?? this.livedDay(),
        this.nowFn(),
        // What it was before rides in the reason (owner ruling D2 on #256):
        // doctor counts re-labels, and moves into me/us/owner, off this row.
        `${mark} (was ${before ?? "unmarked"})${why.length > 0 ? `: ${why.slice(0, 300)}` : ""}`,
        opts.dreamId ?? null,
        opts.by,
      );
      return { changed: before !== mark, before };
    });
    this.emit("store.about", id, { mark, by: opts.by, changed: out.changed });
    return out;
  }

  // ── reflections (v9, `core/dream/reflect.ts`) ─────────────────────────────

  /** Open a reflection: its row, state `begun`. */
  openReflection(input: {
    id: string;
    dreamId?: string | null;
    session?: string | null;
    scope?: string | null;
    day: number;
    date?: string | null;
    model?: string | null;
    questions: readonly string[];
    shown: readonly string[];
  }): void {
    this.mutate("openReflection", () => {
      this.ops.run(
        `INSERT INTO reflections (id, dream_id, session, scope, day, date, state, started_at, model, questions, shown)
         VALUES (?, ?, ?, ?, ?, ?, 'begun', ?, ?, ?, ?)`,
        input.id,
        input.dreamId ?? null,
        input.session ?? null,
        input.scope ?? null,
        input.day,
        input.date ?? null,
        this.nowFn(),
        modelOrNull(input.model ?? undefined),
        JSON.stringify(input.questions),
        JSON.stringify(input.shown),
      );
    });
    this.emit("store.reflection", input.id, { state: "begun", day: input.day });
  }

  /**
   * Change a reflection: close it with its entry, share and citations
   * (`reflected`, stamps `finished_at`), or move its share along
   * (`offered` → `carried` → `told`, stamping `share_at` / `share_session`).
   *
   * `ifShareState` makes it a CLAIM (review of #256, S5): the row changes only
   * if its share is still in that state when the write lands, and the return
   * says whether it did — so two sessions racing to carry one share cannot
   * both carry it. Without it the write always lands (true).
   */
  updateReflection(
    id: string,
    patch: {
      state?: "begun" | "reflected";
      entry?: string | null;
      entryId?: string | null;
      cites?: readonly string[];
      share?: string | null;
      shareCites?: readonly string[];
      shareState?: "none" | "offered" | "carried" | "told";
      shareSession?: string | null;
      pageVersion?: number | null;
      detail?: Record<string, unknown>;
      ifShareState?: "none" | "offered" | "carried" | "told";
    },
  ): boolean {
    const landed = this.mutate("updateReflection", () => {
      const row = this.ops.get<ReflectionRow>("SELECT * FROM reflections WHERE id = ?", id);
      if (row === undefined) throw new StoreError("ID_UNKNOWN", { id });
      if (patch.ifShareState !== undefined && row.share_state !== patch.ifShareState) return false;
      const at = this.nowFn();
      this.ops.run(
        `UPDATE reflections
            SET state = ?, finished_at = ?, entry = ?, entry_id = ?, cites = ?, share = ?, share_cites = ?,
                share_state = ?, share_at = ?, share_session = ?, page_version = ?, detail = ?
          WHERE id = ?${patch.ifShareState === undefined ? "" : " AND share_state = ?"}`,
        patch.state ?? row.state,
        patch.state === "reflected" ? at : row.finished_at,
        patch.entry === undefined ? row.entry : patch.entry,
        patch.entryId === undefined ? row.entry_id : patch.entryId,
        patch.cites === undefined ? row.cites : JSON.stringify(patch.cites),
        patch.share === undefined ? row.share : patch.share,
        patch.shareCites === undefined ? row.share_cites : JSON.stringify(patch.shareCites),
        patch.shareState ?? row.share_state,
        patch.shareState === undefined || patch.shareState === row.share_state ? row.share_at : at,
        patch.shareSession === undefined ? row.share_session : patch.shareSession,
        patch.pageVersion === undefined ? row.page_version : patch.pageVersion,
        patch.detail === undefined ? row.detail : JSON.stringify(patch.detail),
        id,
        ...(patch.ifShareState === undefined ? [] : [patch.ifShareState]),
      );
      return patch.ifShareState === undefined ? true : (this.ops.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) > 0;
    });
    if (landed) this.emit("store.reflection", id, { state: patch.state ?? null, share: patch.shareState ?? null });
    return landed;
  }

  /** One reflection's row. */
  reflection(id: string): ReflectionRow | undefined {
    return this.ops.get<ReflectionRow>("SELECT * FROM reflections WHERE id = ?", id);
  }

  /** Reflections, newest first; optionally only one dream's. */
  reflections(filter: { limit?: number; dreamId?: string } = {}): ReflectionRow[] {
    return filter.dreamId === undefined
      ? this.ops.all<ReflectionRow>("SELECT * FROM reflections ORDER BY started_at DESC, rowid DESC LIMIT ?", filter.limit ?? 100)
      : this.ops.all<ReflectionRow>(
          "SELECT * FROM reflections WHERE dream_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?",
          filter.dreamId,
          filter.limit ?? 100,
        );
  }

  /** How many reflections the store holds, counted in SQL — so a caller that wants every one (`export --markdown`) can ask for exactly that many. */
  reflectionCount(): number {
    return this.ops.get<{ n: number }>("SELECT COUNT(*) AS n FROM reflections")?.n ?? 0;
  }

  /** True when the owner's latest word on this memory's core membership is a demotion. */
  coreDemoted(id: string): boolean {
    const last = this.ops.get<{ action: string }>(
      "SELECT action FROM core_events WHERE memory_id = ? AND action IN ('promoted', 'demoted') ORDER BY seq DESC LIMIT 1",
      id,
    );
    return last?.action === "demoted";
  }

  // ── contradictions (v10, `core/contradictions.ts`) ─────────────────────────

  /** One pair. */
  contradiction(id: string): ContradictionRow | undefined {
    if (!this.hasTable("contradictions")) return undefined;
    return this.ops.get<ContradictionRow>("SELECT * FROM contradictions WHERE id = ?", id);
  }

  /** The standing pair between two memories, either order (not withdrawn), newest first. */
  contradictionBetween(x: string, y: string): ContradictionRow | undefined {
    if (!this.hasTable("contradictions")) return undefined;
    return this.ops.get<ContradictionRow>(
      `SELECT * FROM contradictions
        WHERE state != 'withdrawn' AND ((a = ? AND b = ?) OR (a = ? AND b = ?))
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      x,
      y,
      y,
      x,
    );
  }

  /**
   * Every standing pair (not withdrawn) that names any of these memories,
   * keyed by memory — one indexed read per id. What recall's labels read.
   */
  contradictionsOf(ids: readonly string[]): Map<string, ContradictionRow[]> {
    const out = new Map<string, ContradictionRow[]>();
    if (ids.length === 0 || !this.hasTable("contradictions")) return out;
    const stmt = this.ops.prepare(
      `SELECT * FROM contradictions WHERE state != 'withdrawn' AND (a = ? OR b = ?)
        ORDER BY created_at DESC, rowid DESC`,
    );
    for (const id of new Set(ids)) {
      const rows = stmt.all<ContradictionRow>(id, id);
      if (rows.length > 0) out.set(id, rows);
    }
    return out;
  }

  /** Pairs, newest first — by state, since a moment (created or changed). */
  contradictions(filter: { state?: string; sinceAt?: number; limit?: number } = {}): ContradictionRow[] {
    if (!this.hasTable("contradictions")) return [];
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.state !== undefined) {
      where.push("state = ?");
      args.push(filter.state);
    }
    if (filter.sinceAt !== undefined) {
      where.push("updated_at >= ?");
      args.push(filter.sinceAt);
    }
    args.push(filter.limit ?? 1_000);
    return this.ops.all<ContradictionRow>(
      `SELECT * FROM contradictions${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}
        ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      ...args,
    );
  }

  /** The trail, in order: one pair's, or everything since a moment. */
  contradictionSettles(filter: { pairId?: string; sinceAt?: number; limit?: number } = {}): SettleRow[] {
    if (!this.hasTable("contradiction_settles")) return [];
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.pairId !== undefined) {
      where.push("pair_id = ?");
      args.push(filter.pairId);
    }
    if (filter.sinceAt !== undefined) {
      where.push("at >= ?");
      args.push(filter.sinceAt);
    }
    args.push(filter.limit ?? 1_000);
    return this.ops.all<SettleRow>(
      `SELECT * FROM contradiction_settles${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY seq LIMIT ?`,
      ...args,
    );
  }

  /**
   * RECORD A PAIR THAT DISAGREES, unsettled. Idempotent on its two memories:
   * a standing pair between them (unsettled or settled) is returned as it is,
   * never re-opened. Both must be rows in the store; the older is `a`.
   */
  flagContradiction(input: {
    id: string;
    x: string;
    y: string;
    source: string;
    day: number;
    dreamId?: string | null;
    dreamSeq?: number | null;
  }): { id: string; created: boolean; state: string } {
    const out = this.mutate("flagContradiction", () => {
      if (input.x === input.y) throw new StoreError("CONTRADICTION_SAME_MEMORY", { id: input.x });
      const standing = this.contradictionBetween(input.x, input.y);
      if (standing !== undefined) return { id: standing.id, created: false, state: standing.state };
      const [a, b] = olderFirst(this.ageOf(input.x), this.ageOf(input.y));
      const at = this.nowFn();
      this.ops.run(
        `INSERT INTO contradictions
           (id, a, b, state, how, holds, over, via, source, dream_id, dream_seq, flagged_day, raised_day, settled_day, created_at, updated_at)
         VALUES (?, ?, ?, 'unsettled', NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        input.id,
        a,
        b,
        input.source,
        input.dreamId ?? null,
        input.dreamSeq ?? null,
        input.day,
        at,
        at,
      );
      return { id: input.id, created: true, state: "unsettled" };
    });
    this.emit("store.contradiction", out.id, { action: "flag", created: out.created, source: input.source });
    return out;
  }

  /** What `olderFirst` reads of a memory, insertion order included; throws for an unknown id. */
  private ageOf(id: string): { id: string; birth_day: number; created_at: number | null; rid: number } {
    this.requireRow(id);
    const r = this.ops.get<{ birth_day: number; created_at: number | null; rid: number }>(
      "SELECT birth_day, created_at, rowid AS rid FROM memories WHERE id = ?",
      id,
    );
    return { id, birth_day: r?.birth_day ?? 0, created_at: r?.created_at ?? null, rid: r?.rid ?? 0 };
  }

  /** The once-only awake line was handed out for this pair, on this lived day. */
  markContradictionRaised(id: string, day: number): void {
    this.mutate("markContradictionRaised", () => {
      this.ops.run("UPDATE contradictions SET raised_day = ? WHERE id = ? AND raised_day IS NULL", day, id);
    });
  }

  /** The dream that flagged an UNSETTLED pair was undone: the pair is withdrawn. Settled pairs stand. */
  withdrawContradiction(id: string): boolean {
    const n = this.mutate("withdrawContradiction", () => {
      this.ops.run(
        "UPDATE contradictions SET state = 'withdrawn', updated_at = ? WHERE id = ? AND state = 'unsettled'",
        this.nowFn(),
        id,
      );
      return this.ops.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
    });
    if (n > 0) this.emit("store.contradiction", id, { action: "withdraw" });
    return n > 0;
  }

  /**
   * SETTLE A PAIR, in one transaction: the pair's standing, the trail row, and
   * what the settle does to the memory it is over — a physics patch the caller
   * computed through `physics/` (`fade`, a `changed` memory's one cut), or an
   * archive (`corrected`: out of recall, readable by its own id, never
   * deleted). `pairId` names an existing pair; absent, a new settled pair of
   * `x` and `y` is written (the older is `a`). `closes` are unsettled pairs
   * this settle closes through itself (`via`). Returns the pair id and the
   * trail row's sequence number.
   */
  settleContradiction(input: {
    pairId?: string;
    newId?: string;
    x?: string;
    y?: string;
    source?: string;
    how: string;
    holds: string | null;
    over: string | null;
    actor: string;
    actorId: string | null;
    why: string | null;
    day: number;
    fade?: { id: string; fade: number } | null;
    archive?: { id: string; reason: string } | null;
    closes?: readonly string[];
    detail?: Record<string, unknown>;
  }): { pairId: string; seq: number } {
    const out = this.mutate("settleContradiction", () => {
      const at = this.nowFn();
      let pairId = input.pairId;
      if (pairId === undefined) {
        if (input.x === undefined || input.y === undefined || input.newId === undefined) {
          throw new StoreError("CONTRADICTION_PAIR_REQUIRED", {});
        }
        const [a, b] = olderFirst(this.ageOf(input.x), this.ageOf(input.y));
        pairId = input.newId;
        this.ops.run(
          `INSERT INTO contradictions
             (id, a, b, state, how, holds, over, via, source, dream_id, dream_seq, flagged_day, raised_day, settled_day, created_at, updated_at)
           VALUES (?, ?, ?, 'settled', ?, ?, ?, NULL, ?, NULL, NULL, ?, NULL, ?, ?, ?)`,
          pairId,
          a,
          b,
          input.how,
          input.holds,
          input.over,
          input.source ?? input.actor,
          input.day,
          input.day,
          at,
          at,
        );
      } else {
        if (this.contradiction(pairId) === undefined) throw new StoreError("CONTRADICTION_UNKNOWN", { id: pairId });
        this.ops.run(
          `UPDATE contradictions SET state = 'settled', how = ?, holds = ?, over = ?, via = NULL,
                  settled_day = ?, updated_at = ? WHERE id = ?`,
          input.how,
          input.holds,
          input.over,
          input.day,
          at,
          pairId,
        );
      }
      const closes = (input.closes ?? []).filter((c) => c !== pairId);
      for (const c of closes) {
        this.ops.run(
          `UPDATE contradictions SET state = 'settled', how = ?, via = ?, settled_day = ?, updated_at = ?
            WHERE id = ? AND state = 'unsettled'`,
          input.how,
          pairId,
          input.day,
          at,
          c,
        );
      }
      this.ops.run(
        `INSERT INTO contradiction_settles (pair_id, action, how, holds, over, actor, actor_id, why, day, at, undone, detail)
         VALUES (?, 'settle', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        pairId,
        input.how,
        input.holds,
        input.over,
        input.actor,
        input.actorId,
        input.why,
        input.day,
        at,
        JSON.stringify({ ...(input.detail ?? {}), closes }),
      );
      const seq = this.ops.get<{ seq: number }>("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
      // What it does to the memory it is over, LAST, so a refusal above has
      // staged nothing on the memory itself.
      if (input.fade !== undefined && input.fade !== null) {
        this.updatePhysics(input.fade.id, { fade: input.fade.fade });
      }
      if (input.archive !== undefined && input.archive !== null) {
        this.archive(input.archive.id, input.archive.reason);
      }
      return { pairId, seq };
    });
    this.emit("store.contradiction", out.pairId, { action: "settle", how: input.how, actor: input.actor });
    return out;
  }

  /**
   * UNDO A SETTLE, in one transaction: the settle's trail row is marked undone
   * and an `undo` row follows it; the pair — and every pair the settle closed
   * through itself — is unsettled again; a `changed` memory's cut is put back
   * (`restore`, only when the caller found the cut still standing) and a
   * `corrected` one comes back into recall (`unarchive`).
   */
  undoContradictionSettle(input: {
    pairId: string;
    settleSeq: number;
    actor: string;
    actorId: string | null;
    why: string | null;
    day: number;
    /** Where the pair goes: `unsettled` (it was a flag) or `withdrawn` (it never was). */
    state?: "unsettled" | "withdrawn";
    restore?: { id: string; fade: number } | null;
    unarchive?: { id: string; reason: string } | null;
    reopen?: readonly string[];
    detail?: Record<string, unknown>;
  }): { seq: number; unarchived: boolean } {
    const out = this.mutate("undoContradictionSettle", () => {
      const at = this.nowFn();
      const pair = this.contradiction(input.pairId);
      if (pair === undefined) throw new StoreError("CONTRADICTION_UNKNOWN", { id: input.pairId });
      this.ops.run("UPDATE contradiction_settles SET undone = 1 WHERE seq = ? AND pair_id = ?", input.settleSeq, input.pairId);
      this.ops.run(
        `INSERT INTO contradiction_settles (pair_id, action, how, holds, over, actor, actor_id, why, day, at, undone, detail)
         VALUES (?, 'undo', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        input.pairId,
        pair.how,
        pair.holds,
        pair.over,
        input.actor,
        input.actorId,
        input.why,
        input.day,
        at,
        JSON.stringify({ ...(input.detail ?? {}), undoes: input.settleSeq }),
      );
      const seq = this.ops.get<{ seq: number }>("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
      const states: [string, string][] = [[input.pairId, input.state ?? "unsettled"], ...(input.reopen ?? []).map((id): [string, string] => [id, "unsettled"])];
      for (const [id, state] of states) {
        this.ops.run(
          `UPDATE contradictions SET state = ?, how = NULL, holds = NULL, over = NULL, via = NULL,
                  settled_day = NULL, raised_day = NULL, updated_at = ? WHERE id = ?`,
          state,
          at,
          id,
        );
      }
      if (input.restore !== undefined && input.restore !== null) {
        this.updatePhysics(input.restore.id, { fade: input.restore.fade });
      }
      let unarchived = false;
      if (input.unarchive !== undefined && input.unarchive !== null) {
        unarchived = this.restoreSuperseded(input.unarchive.id, input.unarchive.reason);
      }
      return { seq, unarchived };
    });
    this.emit("store.contradiction", input.pairId, { action: "undo", actor: input.actor });
    return out;
  }

  // ── dreams (v8, `core/dream/`) ─────────────────────────────────────────────

  /** Open a dream: its row, state `begun`. */
  openDream(input: {
    id: string;
    session?: string | null;
    scope?: string | null;
    day: number;
    date?: string | null;
    model?: string | null;
    shown?: readonly string[];
  }): void {
    this.mutate("openDream", () => {
      this.ops.run(
        `INSERT INTO dreams (id, session, scope, day, date, state, started_at, model, shown)
         VALUES (?, ?, ?, ?, ?, 'begun', ?, ?, ?)`,
        input.id,
        input.session ?? null,
        input.scope ?? null,
        input.day,
        input.date ?? null,
        this.nowFn(),
        modelOrNull(input.model ?? undefined),
        JSON.stringify(input.shown ?? []),
      );
    });
    this.emit("store.dream", input.id, { state: "begun", day: input.day });
  }

  /**
   * Change a dream's state, journal or title. `journaled` / `undone` stamp their
   * moment. A RESUMED dream (2026-09-28: a dream left behind by a session that
   * closed is picked up by the next one) also moves to the session, lived day
   * and calendar date that resumed it, its start moves to the moment it was
   * resumed (`startedAt`), and its shown set grows.
   */
  updateDream(
    id: string,
    patch: {
      state?: "begun" | "journaled" | "undone";
      title?: string | null;
      journal?: string | null;
      session?: string | null;
      day?: number;
      date?: string | null;
      shown?: readonly string[];
      startedAt?: number;
    },
  ): void {
    this.mutate("updateDream", () => {
      const row = this.ops.get<DreamRow>("SELECT * FROM dreams WHERE id = ?", id);
      if (row === undefined) throw new StoreError("ID_UNKNOWN", { id });
      const at = this.nowFn();
      const state = patch.state ?? row.state;
      this.ops.run(
        `UPDATE dreams SET state = ?, title = ?, journal = ?, finished_at = ?, undone_at = ?,
                session = ?, day = ?, date = ?, shown = ?, started_at = ? WHERE id = ?`,
        state,
        patch.title === undefined ? row.title : patch.title,
        patch.journal === undefined ? row.journal : patch.journal,
        patch.state === "journaled" ? at : row.finished_at,
        patch.state === "undone" ? at : row.undone_at,
        patch.session === undefined ? row.session : patch.session,
        patch.day ?? row.day,
        patch.date === undefined ? row.date : patch.date,
        patch.shown === undefined ? row.shown : JSON.stringify(patch.shown),
        patch.startedAt ?? row.started_at,
        id,
      );
    });
    this.emit("store.dream", id, { state: patch.state ?? null });
  }

  /** Record one change a dream made; returns its sequence number within the dream. */
  recordDreamChange(dreamId: string, change: { action: string; ref?: string | null; ref2?: string | null; detail?: Record<string, unknown> }): number {
    const seq = this.mutate("recordDreamChange", () => {
      const next =
        (this.ops.get<{ n: number | null }>("SELECT MAX(seq) AS n FROM dream_changes WHERE dream_id = ?", dreamId)?.n ?? 0) + 1;
      this.ops.run(
        `INSERT INTO dream_changes (dream_id, seq, action, ref, ref2, detail, at, undone)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        dreamId,
        next,
        change.action,
        change.ref ?? null,
        change.ref2 ?? null,
        JSON.stringify(change.detail ?? {}),
        this.nowFn(),
      );
      return next;
    });
    return seq;
  }

  /** Mark one recorded change as reversed. */
  markDreamChangeUndone(dreamId: string, seq: number): void {
    this.mutate("markDreamChangeUndone", () => {
      this.ops.run("UPDATE dream_changes SET undone = 1 WHERE dream_id = ? AND seq = ?", dreamId, seq);
    });
  }

  /**
   * Raise or snooze the day's dream line: one row per calendar date. `offered`
   * (the ask, setting `ask`) and `launched` (the run was started, setting
   * `auto`, 2026-09-28) are CLAIMS — of two sessions racing, one writes the row.
   */
  setDreamAsk(input: { date: string; state: "offered" | "launched" | "declined"; session?: string | null; day: number }): boolean {
    const wrote = this.mutate("setDreamAsk", () => {
      if (input.state === "offered" || input.state === "launched") {
        this.ops.run(
          "INSERT OR IGNORE INTO dream_asks (date, state, session, day, at) VALUES (?, ?, ?, ?, ?)",
          input.date,
          input.state,
          input.session ?? null,
          input.day,
          this.nowFn(),
        );
        return (this.ops.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) > 0;
      }
      this.ops.run(
        `INSERT INTO dream_asks (date, state, session, day, at) VALUES (?, 'declined', ?, ?, ?)
         ON CONFLICT (date) DO UPDATE SET state = 'declined', at = excluded.at`,
        input.date,
        input.session ?? null,
        input.day,
        this.nowFn(),
      );
      return true;
    });
    this.emit("store.dream.ask", undefined, { date: input.date, state: input.state, wrote });
    return wrote;
  }

  /**
   * CLAIM THE DAY'S LINE AGAIN (2026-09-28): a run that was started and left
   * behind may be started once more. A compare-and-set on the row's moment —
   * only the write that still finds `prevAt` there lands, so of two sessions
   * racing to restart one run, one does. A declined day is never reclaimed.
   */
  reclaimDreamAsk(input: { date: string; prevAt: number; state: "offered" | "launched"; session?: string | null; day: number }): boolean {
    const wrote = this.mutate("reclaimDreamAsk", () => {
      this.ops.run(
        "UPDATE dream_asks SET state = ?, session = ?, day = ?, at = ? WHERE date = ? AND at = ? AND state != 'declined'",
        input.state,
        input.session ?? null,
        input.day,
        this.nowFn(),
        input.date,
        input.prevAt,
      );
      return (this.ops.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) > 0;
    });
    this.emit("store.dream.ask", undefined, { date: input.date, state: input.state, wrote, again: true });
    return wrote;
  }

  /**
   * Live memories made since a dream — one bounded read, for the ask (which
   * runs on every prompt) and a dream's bundle. Since a MOMENT when there was a
   * dream (`created_at`; a pre-v7 row with no moment falls back to its lived
   * birth day), else since a lived day. Newest first. Only the columns decide:
   * `type` memory, not archived, not superseded, not protected, not a dream's
   * own words. The caller applies the rest of recall's gates (the deny-list,
   * confidentiality) to what comes back.
   */
  newMemoryIds(filter: { sinceAt: number | null; sinceDay: number; limit: number; beforeDay?: number }): string[] {
    // Nor a dream's own MERGES (origin `dream:<id>`): a merged memory is a
    // rewording of what a dream already saw, and counting it as new would let
    // one dream's output raise the next day's ask by itself (review of #251).
    const base = `SELECT id FROM memories
                   WHERE type = 'memory' AND archived = 0 AND superseded_by IS NULL AND protected = 0
                     AND (source IS NULL OR source != 'dreamed')
                     AND (origin_ref IS NULL OR origin_ref NOT LIKE 'dream:%')`;
    const order = "ORDER BY COALESCE(created_at, 0) DESC, birth_day DESC, id LIMIT ?";
    const rows =
      filter.sinceAt === null
        ? filter.beforeDay === undefined
          ? this.ops.all<{ id: string }>(`${base} AND birth_day >= ? ${order}`, filter.sinceDay, filter.limit)
          : this.ops.all<{ id: string }>(`${base} AND birth_day >= ? AND birth_day < ? ${order}`, filter.sinceDay, filter.beforeDay, filter.limit)
        : this.ops.all<{ id: string }>(
            `${base} AND (created_at > ? OR (created_at IS NULL AND birth_day > ?)) ${order}`,
            filter.sinceAt,
            filter.sinceDay,
            filter.limit,
          );
    return rows.map((r) => r.id);
  }

  /** One dream's row. */
  dream(id: string): DreamRow | undefined {
    return this.ops.get<DreamRow>("SELECT * FROM dreams WHERE id = ?", id);
  }

  /** Dreams, newest first. */
  dreams(filter: { limit?: number; sinceAt?: number } = {}): DreamRow[] {
    return filter.sinceAt === undefined
      ? this.ops.all<DreamRow>("SELECT * FROM dreams ORDER BY started_at DESC, id DESC LIMIT ?", filter.limit ?? 100)
      : this.ops.all<DreamRow>(
          "SELECT * FROM dreams WHERE started_at >= ? ORDER BY started_at DESC, id DESC LIMIT ?",
          filter.sinceAt,
          filter.limit ?? 100,
        );
  }

  /** How many dreams the store holds, counted in SQL — the "of N" beside a list of the newest. */
  dreamCount(): number {
    return this.ops.get<{ n: number }>("SELECT COUNT(*) AS n FROM dreams")?.n ?? 0;
  }

  /** One dream's changes, in the order they were made. */
  dreamChanges(dreamId: string): DreamChangeRow[] {
    return this.ops.all<DreamChangeRow>("SELECT * FROM dream_changes WHERE dream_id = ? ORDER BY seq", dreamId);
  }

  /**
   * OPEN CHANGES OF ONE KIND, across every dream that stands (2026-09-28,
   * build B; the audit's #6): not undone, of a dream not undone, newest dream
   * first — with the dream's date. Read by open state, not through a window of
   * the newest N dreams, so a pair flagged eleven dreams ago is still open.
   */
  openDreamChanges(action: string, limit = 1_000): (DreamChangeRow & { dream_date: string | null })[] {
    return this.ops.all<DreamChangeRow & { dream_date: string | null }>(
      `SELECT c.*, d.date AS dream_date FROM dream_changes c JOIN dreams d ON d.id = c.dream_id
        WHERE c.action = ? AND c.undone = 0 AND d.state != 'undone'
        ORDER BY d.started_at DESC, d.rowid DESC, c.seq ASC LIMIT ?`,
      action,
      limit,
    );
  }

  /**
   * Reflections whose morning share is in this state, newest first (2026-09-28,
   * build B): an offered share older than the newest few reflections is still
   * found — read by state, not through a window.
   */
  reflectionsWithShare(shareState: string, limit = 50): ReflectionRow[] {
    return this.ops.all<ReflectionRow>(
      "SELECT * FROM reflections WHERE state = 'reflected' AND share_state = ? ORDER BY started_at DESC, rowid DESC LIMIT ?",
      shareState,
      limit,
    );
  }

  /** The day's ask row, when one was raised. */
  dreamAsk(date: string): DreamAskRow | undefined {
    return this.ops.get<DreamAskRow>("SELECT * FROM dream_asks WHERE date = ?", date);
  }

  /** The stored vector of one memory, or null (no embedder, or not embedded). A read of box 3. */
  vectorOf(id: string): number[] | null {
    try {
      const r = this.cache.get<{ vec: unknown }>("SELECT vec FROM embeddings WHERE memory_id = ?", id);
      if (r === undefined || r.vec === null || r.vec === undefined) return null;
      return Array.from(decodeVector(r.vec as never));
    } catch {
      return null;
    }
  }
  setBand(id: string, band: Band, day: number): void {
    this.mutate("setBand", () => {
      this.requireRow(id);
      this.ops.run("UPDATE memories SET band = ?, band_day = ? WHERE id = ?", band, day, id);
    });
    this.emit("store.band", id, { band, day });
  }

  link(edge: EdgeInput): void {
    this.mutate("link", () => {
      const at = this.nowFn();
      this.ops.run(EDGE_UPSERT, edge.src, edge.dst, edge.weight, edge.day, at, at);
    });
    this.emit("store.link", edge.src, { dst: edge.dst, weight: edge.weight });
  }

  /** Multi-row and foreign-keyed: one bad endpoint rolls the whole batch back. */
  linkMany(edges: readonly EdgeInput[]): void {
    this.mutate("linkMany", () => {
      const st = this.ops.prepare(EDGE_UPSERT);
      const at = this.nowFn();
      for (const e of edges) st.run(e.src, e.dst, e.weight, e.day, at, at);
    });
    this.emit("store.link", undefined, { count: edges.length });
  }

  /**
   * Remove the edge rows `dead` names — `associate/`'s sweep of rows that
   * already carry nothing (an eviction's zero, a weight decayed to the floor;
   * 2026-09-28). The predicate is the caller's, because the decay arithmetic is
   * `associate/`'s, not the store's. One transaction; returns the count.
   *
   * PREFILTERED IN SQL, so the write transaction reads only candidates: rows
   * at or below `floor`, or last written on or before `staleOnOrBefore` (the
   * caller's day by which even a full-weight edge has decayed under the
   * floor). `dead` decides on that subset. A row that has faded more recently
   * is swept on a later flush, once it is old enough to be a candidate. Rows
   * touching a PINNED memory are never candidates: a pinned memory's edges are
   * frozen both ways (associate G9), and that includes their removal.
   */
  sweepEdges(
    filter: { floor: number; staleOnOrBefore: number },
    dead: (e: EdgeRow) => boolean,
  ): number {
    const n = this.mutate("sweepEdges", () => {
      const doomed = this.ops
        .all<EdgeRow>(
          `SELECT e.* FROM edges e
            WHERE (e.weight <= ? OR e.last_day <= ?)
              AND NOT EXISTS (SELECT 1 FROM memories m
                               WHERE m.id IN (e.src, e.dst) AND m.protected = 1)`,
          filter.floor,
          filter.staleOnOrBefore,
        )
        .filter(dead);
      if (doomed.length === 0) return 0;
      const st = this.ops.prepare("DELETE FROM edges WHERE src = ? AND dst = ?");
      for (const e of doomed) st.run(e.src, e.dst);
      return doomed.length;
    });
    if (n > 0) this.emit("store.edge.swept", undefined, { count: n });
    return n;
  }

  setProspective(entry: ProspectiveInput): void {
    this.mutate("setProspective", () => {
      this.requireRow(entry.memoryId);
      // An UPSERT, not `INSERT OR REPLACE`: a replace deletes the row first and
      // would reset `created_at` on every state change (v7).
      const at = this.nowFn();
      this.ops.run(
        `INSERT INTO prospective
           (memory_id, window_key, event_date, precision, state, fires, last_fired_day,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (memory_id, window_key) DO UPDATE SET
           event_date = excluded.event_date, precision = excluded.precision,
           state = excluded.state, fires = excluded.fires,
           last_fired_day = excluded.last_fired_day, updated_at = excluded.updated_at`,
        entry.memoryId,
        entry.windowKey,
        entry.eventDate,
        entry.precision,
        entry.state,
        entry.fires ?? 0,
        entry.lastFiredDay ?? null,
        at,
        at,
      );
    });
    this.emit("store.prospective", entry.memoryId, {
      window: entry.windowKey,
      state: entry.state,
    });
  }

  /**
   * Record feelings on a memory (schema v7; `store/feelings.ts`). All or none:
   * one bad input refuses the call `FEELING_INVALID` and writes nothing. An
   * emotion not on the wheel is stored as `other` with the word kept, and the
   * result's `notices` name a wheel key only when one is a near misspelling (and
   * an alias read as a wheel word carries `readAs`).
   * `beneath` is an existing feeling's id ON THIS MEMORY or another input's
   * index. `model` is the writer's model id, screened like `PutInput.model`.
   */
  addFeelings(
    memoryId: string,
    inputs: readonly FeelingInput[],
    opts: {
      model?: string;
      /** v9: who recorded them — `session` (the default: a writer in a
       *  session), `dream`, `reflection`. The fast lane's feeling reads only
       *  the ones not recorded later by a reflection (physics §5.3). */
      source?: FeelingSource;
      /** v9: the calendar date a feeling was recorded AFTER the moment (the
       *  reflection's feeling-now). Absent: felt at the time. */
      recordedLater?: string;
      /** Per input, overriding the two above — a merge carries each
       *  original's own (`dream/`). Indexed like `inputs`. `createdAt`
       *  (2026-10-02): the moment it was first recorded — a feeling is a
       *  moment's, so a merge does not make it new (as a trait nudge's,
       *  below); before, every feeling a merge carried was dated the merge
       *  night, and the reflection's weeks of feelings read it as felt then. */
      provenance?: readonly ({ source?: string | null; recordedLater?: string | null; createdAt?: number | null; recordedDay?: number | null } | undefined)[];
    } = {},
  ): AddFeelingsResult {
    const { rows, notices, repairs } = checkFeelings(inputs);
    const ids = rows.map(() => `fel_${randomBytes(6).toString("hex")}`);
    this.mutate("addFeelings", () => {
      this.requireRow(memoryId);
      const at = this.nowFn();
      const model = modelOrNull(opts.model);
      const insert = this.ops.prepare(
        `INSERT INTO feelings
           (id, memory_id, whose, core, emotion, other_word, strength, beneath_id, carried_by, model,
            created_at, updated_at, source, recorded_later, valence, recorded_day)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      // v13: the lived day it is recorded on — what its softening counts from
      // (physics §5.10, review 02 C5). A merge carries each original's own.
      const today = this.livedDay();
      const later = opts.recordedLater !== undefined && opts.recordedLater.trim().length > 0 ? opts.recordedLater.trim() : null;
      const source = opts.source ?? "session";
      rows.forEach((r, i) => {
        const own = opts.provenance?.[i];
        const first = typeof own?.createdAt === "number" && Number.isFinite(own.createdAt) ? own.createdAt : at;
        insert.run(
          ids[i] as string,
          memoryId,
          r.whose,
          r.core,
          r.emotion,
          r.otherWord,
          r.strength,
          r.carriedBy,
          model,
          first,
          at,
          own?.source ?? source,
          own === undefined ? later : (own.recordedLater ?? null),
          r.valence,
          typeof own?.recordedDay === "number" && Number.isFinite(own.recordedDay) ? own.recordedDay : today,
        );
      });
      // THEN the links, so an input may sit on one listed after it.
      rows.forEach((r, i) => {
        if (r.beneath === null) return;
        let under: string;
        if (typeof r.beneath === "number") {
          under = ids[r.beneath] as string;
        } else {
          const found = this.ops.get<{ memory_id: string }>("SELECT memory_id FROM feelings WHERE id = ?", r.beneath);
          if (found === undefined || found.memory_id !== memoryId) {
            throw new StoreError("FEELING_INVALID", { index: i, reason: "beneath-not-on-this-memory" });
          }
          under = r.beneath;
        }
        this.ops.run("UPDATE feelings SET beneath_id = ? WHERE id = ?", under, ids[i] as string);
      });
    });
    this.emit("store.feelings", memoryId, { count: rows.length, other: notices.filter((n) => n.readAs === undefined).length });
    return { ids, notices, repairs };
  }

  /**
   * Record TRAIT NUDGES on a memory (folded into v9; `store/traits.ts`): how
   * the moment showed I acted, on one of the seven axes. All or none: one bad
   * input refuses the call `TRAIT_INVALID` and writes nothing. Display only —
   * nothing in the core reads them. `model` is screened like `PutInput.model`.
   */
  addTraits(
    memoryId: string,
    inputs: readonly TraitInput[],
    opts: {
      model?: string;
      /** `session` (the default: the awake writer) or `reflection`. */
      source?: TraitSource;
      /** Per input, overriding the above — a dream's merge carries each
       *  original's own source, model and moment (`dream/`). Indexed like
       *  `inputs`. */
      provenance?: readonly ({ source?: string | null; model?: string | null; createdAt?: number | null } | undefined)[];
    } = {},
  ): { ids: readonly string[]; repairs: readonly TraitRepair[] } {
    const { rows, repairs } = checkTraitsRepaired(inputs);
    const ids = rows.map(() => `trt_${randomBytes(6).toString("hex")}`);
    this.mutate("addTraits", () => {
      this.requireRow(memoryId);
      const at = this.nowFn();
      const model = modelOrNull(opts.model);
      const source = opts.source ?? "session";
      const insert = this.ops.prepare(
        `INSERT INTO traits (id, memory_id, axis, toward, strength, carried_by, source, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      rows.forEach((r, i) => {
        const own = opts.provenance?.[i];
        insert.run(
          ids[i] as string,
          memoryId,
          r.axis,
          r.toward,
          r.strength,
          r.carriedBy,
          own === undefined ? source : (own.source ?? null),
          own === undefined ? model : modelOrNull(own.model ?? undefined),
          own?.createdAt ?? at,
          at,
        );
      });
    });
    this.emit("store.traits", memoryId, { count: rows.length });
    return { ids, repairs };
  }

  /** The active-day clock (scar E8): days actually lived, not calendar days. */
  advanceClock(date: string): number {
    const day = this.mutate("advanceClock", () => {
      const last = this.getMeta("lastActiveDate") ?? "";
      if (last !== "" && date < last) {
        // ONE CALENDAR DAY BACK IS THE SAME LIVED DAY (review S1, 2026-09-25).
        // Since the person's day became local, a date one day behind the last
        // one is ordinary: the upgrade evening west of UTC (the last 0.3.1
        // boundary stamped UTC's tomorrow), or a flight west across midnight.
        // It is lived time that already counted, so it holds the day — no
        // advance, no rewrite of `lastActiveDate`, no failure. A real jump back
        // of more than a day is still refused, as it always was.
        if (isDay(date) && isDay(last) && daysBetween(date, last) <= 1) {
          this.emit("store.clock.held", undefined, { date, last });
          return this.livedDay();
        }
        throw new StoreError("CLOCK_BACKWARDS", { date, last });
      }
      if (date === last) return this.livedDay();
      const next = this.livedDay() + 1;
      this.ops.run("UPDATE meta SET value = ? WHERE key = 'livedDay'", String(next));
      this.ops.run("UPDATE meta SET value = ? WHERE key = 'lastActiveDate'", date);
      return next;
    });
    this.emit("store.clock", undefined, { livedDay: day, date });
    return day;
  }

  setMeta(key: string, value: string): void {
    this.mutate("setMeta", () => {
      this.ops.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
    });
    this.emit("store.meta", undefined, { key });
  }

  /**
   * Many meta rows, ONE transaction and one ring line.
   *
   * `setMeta` in a loop is one write transaction — one lock acquisition — per
   * key, and the caller this exists for moves a whole window's worth of the
   * backfill's give-up counters at a boundary where the adapter has measured six
   * overlapping workers against a 5 s busy timeout (adapter `NOTES.md`, I33).
   * One `mutate` is one acquisition and rolls back as a unit: the same bargain
   * `linkMany` and `setRanking` already make, and the reason the ring gets a
   * count here rather than N identical `key` lines.
   *
   * Keys repeated within one call resolve last-wins, as `INSERT OR REPLACE` does
   * anywhere else. An empty list still crosses the stance check, because a
   * stand-down that depends on how much work there was is not a stand-down.
   */
  setMetaMany(entries: readonly (readonly [string, string])[]): void {
    this.mutate("setMetaMany", () => {
      for (const [key, value] of entries) {
        this.ops.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
      }
    });
    this.emit("store.meta", undefined, { count: entries.length });
  }

  /**
   * READ, CHANGE AND WRITE ONE META ROW IN ONE TRANSACTION (2026-10-01, review
   * of #308). `fn` gets the row as it stands INSIDE the write transaction —
   * `BEGIN IMMEDIATE`, so a second process doing the same waits on the busy
   * timeout and then reads what the first wrote — and returns the new value,
   * `null` to delete the row, or `undefined` to leave it. What `fn` returned is
   * returned. For a row two processes change at once (the write-up progress
   * map), where `getMeta` then `setMeta` would lose one of them.
   */
  updateMeta(key: string, fn: (current: string | undefined) => string | null | undefined): string | null | undefined {
    const out = this.mutate("updateMeta", () => {
      const row = this.ops.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key);
      const next = fn(row?.value);
      if (next === null) this.ops.run("DELETE FROM meta WHERE key = ?", key);
      else if (next !== undefined) this.ops.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, next);
      return next;
    });
    this.emit("store.meta", undefined, { key });
    return out;
  }

  // ── box 2: per-session gate state (SEAMS item B) ───────────────────────────

  /**
   * Upsert gate records. One transaction, one row per record — a writer replaces
   * only the records it names, so two processes in one session cannot drop each
   * other's (recall/INTERFACE-GAPS.md §1, scar §2.1).
   */
  setGateRecords(rows: readonly GateRecordInput[]): void {
    // Stance FIRST, then the empty check: an observer must refuse even a no-op
    // write, or the stand-down becomes conditional on the payload (G6).
    this.assertWritable("setGateRecords");
    if (rows.length === 0) return;
    this.ops.transaction(() => {
      const st = this.ops.prepare(
        `INSERT OR REPLACE INTO gate_session
           (session_id, kind, ref, turn, tier, trains, value, last_day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of rows) {
        st.run(
          r.sessionId,
          r.kind,
          r.ref,
          r.turn,
          r.tier ?? null,
          r.trains === undefined || r.trains === null ? null : r.trains ? 1 : 0,
          r.value ?? null,
          r.lastDay,
        );
      }
    });
    this.emit("store.gate.records", undefined, { count: rows.length });
  }

  gateRecords(sessionId: string, kind?: string): GateSessionRow[] {
    return kind === undefined
      ? this.ops.all<GateSessionRow>(
          "SELECT * FROM gate_session WHERE session_id = ? ORDER BY kind, ref",
          sessionId,
        )
      : this.ops.all<GateSessionRow>(
          "SELECT * FROM gate_session WHERE session_id = ? AND kind = ? ORDER BY ref",
          sessionId,
          kind,
        );
  }

  /**
   * The retention sweep the meta keyspace could never have (recall's gap §1: "a
   * long-lived store accumulates one dead row per session forever"). Operational
   * state with a lifetime, swept on the active-day clock beside the version prune.
   */
  pruneGateSessions(): PruneReport {
    const report = this.mutate("pruneGateSessions", () => {
      const cutoffDay = this.livedDay() - this.retentionDays;
      const doomed = this.ops.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM gate_session WHERE last_day < ?",
        cutoffDay,
      );
      this.ops.run("DELETE FROM gate_session WHERE last_day < ?", cutoffDay);
      return { pruned: doomed?.n ?? 0, cutoffDay, retentionDays: this.retentionDays };
    });
    this.emit("store.gate.pruned", undefined, {
      count: report.pruned,
      cutoffDay: report.cutoffDay,
    });
    return report;
  }

  // ── box 2: the durable event log (SEAMS item K) ────────────────────────────

  /**
   * Append one event. Returns its seq, or 0 when a `dedupKey` latch refused a
   * repeat — the caller can tell "recorded" from "already recorded", which is
   * what replay idempotence needs to stay a fact rather than a hope.
   */
  appendEvent(input: EventInput): number {
    const seq = this.mutate("appendEvent", () => {
      this.ops.run(
        `INSERT OR IGNORE INTO events (at, day, name, ref, dedup_key, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
        this.nowFn(),
        input.day,
        input.name,
        input.ref ?? null,
        input.dedupKey ?? null,
        input.payload === undefined || input.payload === null
          ? null
          : JSON.stringify(input.payload),
      );
      const row = this.ops.get<{ n: number }>("SELECT changes() AS n");
      if ((row?.n ?? 0) === 0) return 0;
      return this.ops.get<{ seq: number }>("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
    });
    this.emit("store.event.appended", input.ref ?? undefined, {
      name: input.name,
      seq,
      deduped: seq === 0,
    });
    return seq;
  }

  /**
   * Oldest first by default, so a story reads in the order it happened.
   *
   * `order: "desc"` is NEWEST first (cli INTERFACE-GAPS §10): with a `limit`, an
   * ascending read is the OLDEST N rows, so "the newest row of this name" was not
   * a query — a caller that took `rows.at(-1)` off a full window was reading last
   * week. `eventLog({ name, order: "desc", limit: 1 })` is that row, exactly.
   * Rows come back in the order asked for; nothing is re-sorted after the LIMIT.
   */
  eventLog(filter: EventLogFilter = {}): EventRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.name !== undefined) {
      where.push("name = ?");
      args.push(filter.name);
    }
    if (filter.ref !== undefined) {
      where.push("ref = ?");
      args.push(filter.ref);
    }
    if (filter.sinceDay !== undefined) {
      where.push("day >= ?");
      args.push(filter.sinceDay);
    }
    const sql =
      "SELECT * FROM events" +
      (where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`) +
      ` ORDER BY seq ${filter.order === "desc" ? "DESC" : "ASC"} LIMIT ?`;
    return this.ops.all<EventRow>(sql, ...args, filter.limit ?? 500);
  }

  /**
   * THE LOG COUNTED BY NAME, in SQL — one `GROUP BY`, no row leaves the
   * database (cli INTERFACE-GAPS §11, dashboard INTERFACE-GAPS §5).
   *
   * Sorted by name. Every name present in the window appears exactly once, so
   * this is also the distinct-name read: a writer that appended a name no
   * registry knows shows up here rather than going unlisted. A name with no
   * rows in the window is ABSENT, not zero — a caller rendering a vocabulary
   * looks its names up and reads a miss as never.
   *
   * `sinceDay` bounds on the LIVED-day column (`day >= ?`, as `eventLog` does);
   * `sinceAt` on the wall clock the row was written at (`at >= ?`, epoch ms).
   * Both may be given. Neither reads a payload: a count by a calendar date some
   * payloads carry (`adapters/fired.ts` dates rows by `payload.date`) is not a
   * column and is not answered here.
   *
   * READ-ONLY: never enters `mutate`, so an observer may ask it.
   */
  eventCounts(filter: { sinceDay?: number; sinceAt?: number } = {}): EventCount[] {
    const where: string[] = [];
    const args: number[] = [];
    if (filter.sinceDay !== undefined) {
      where.push("day >= ?");
      args.push(filter.sinceDay);
    }
    if (filter.sinceAt !== undefined) {
      where.push("at >= ?");
      args.push(filter.sinceAt);
    }
    const rows = this.ops.all<{ name: string; n: number; newest_at: number; newest_day: number; newest_seq: number }>(
      "SELECT name, COUNT(*) AS n, MAX(at) AS newest_at, MAX(day) AS newest_day, MAX(seq) AS newest_seq" +
        " FROM events" +
        (where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`) +
        " GROUP BY name ORDER BY name",
      ...args,
    );
    return rows.map((r) => ({
      name: r.name,
      count: r.n,
      newestAt: r.newest_at,
      newestDay: r.newest_day,
      newestSeq: r.newest_seq,
    }));
  }

  /** Every event name the log holds, sorted. `eventCounts()` without the counts. */
  eventNames(): string[] {
    return this.ops.all<{ name: string }>("SELECT DISTINCT name FROM events ORDER BY name").map((r) => r.name);
  }

  /**
   * Bounded retention — logs are telemetry, not canonical memory: "the one
   * system-path exception to no-deletion — bounded-retention logs"
   * (`docs/harvest/behavioral-spec.md` #17, v1's `pruneLogs` in `log-audit.md`
   * §3). Events carrying a `dedupKey` are KEPT regardless of age: they are the
   * replay latch, and sweeping one would let a replayed day re-append a record
   * the store already accounted for.
   *
   * `limit` caps the rows one call deletes, OLDEST FIRST by `seq`, so a pass on a
   * store that has never been swept cannot run long or hold the write lock across
   * a backlog: it takes the cap's worth and reports how much is left. Its caller
   * is `sleep/log.ts`, on the cycle's own budget; before 2026-09-05 nothing
   * called this at all (`sleep/NOTES.md` §13), and the window it documents was
   * a number the log was eligible for and never subject to.
   */
  pruneEvents(opts: { limit?: number } = {}): EventPruneReport {
    const limit = opts.limit === undefined ? null : Math.max(0, Math.floor(opts.limit));
    const report = this.mutate("pruneEvents", () => {
      const cutoffDay = this.livedDay() - this.retentionDays;
      const eligible =
        this.ops.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM events WHERE day < ? AND dedup_key IS NULL",
          cutoffDay,
        )?.n ?? 0;
      if (limit === null) {
        this.ops.run("DELETE FROM events WHERE day < ? AND dedup_key IS NULL", cutoffDay);
      } else {
        this.ops.run(
          `DELETE FROM events WHERE seq IN (
             SELECT seq FROM events WHERE day < ? AND dedup_key IS NULL
             ORDER BY seq ASC LIMIT ?)`,
          cutoffDay,
          limit,
        );
      }
      const pruned = this.ops.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
      return {
        pruned,
        eligible,
        remaining: eligible - pruned,
        limit,
        cutoffDay,
        retentionDays: this.retentionDays,
      };
    });
    this.emit("store.events.pruned", undefined, {
      count: report.pruned,
      eligible: report.eligible,
      remaining: report.remaining,
      limit: report.limit,
      cutoffDay: report.cutoffDay,
      retentionDays: report.retentionDays,
    });
    return report;
  }

  /**
   * The log counted, not touched. READ-ONLY by construction — it never calls
   * `mutate`, so an observer may ask it (the cycle's read-only report does) and
   * `counterparts verify` prints it without opening a writable store.
   */
  eventLogCensus(): EventLogCensus {
    const cutoffDay = this.livedDay() - this.retentionDays;
    const totals = this.ops.get<{
      total: number;
      latched: number;
      oldest_day: number | null;
      oldest_at: number | null;
      newest_day: number | null;
    }>(
      `SELECT COUNT(*) AS total,
              COUNT(dedup_key) AS latched,
              MIN(day) AS oldest_day,
              MIN(at) AS oldest_at,
              MAX(day) AS newest_day
         FROM events`,
    );
    const past = this.ops.get<{ eligible: number; latched: number }>(
      `SELECT COUNT(*) - COUNT(dedup_key) AS eligible,
              COUNT(dedup_key) AS latched
         FROM events WHERE day < ?`,
      cutoffDay,
    );
    return {
      rows: totals?.total ?? 0,
      latched: totals?.latched ?? 0,
      oldestDay: totals?.oldest_day ?? null,
      oldestAt: totals?.oldest_at ?? null,
      newestDay: totals?.newest_day ?? null,
      cutoffDay,
      retentionDays: this.retentionDays,
      eligible: past?.eligible ?? 0,
      latchedPastCutoff: past?.latched ?? 0,
    };
  }

  // ── box 3: the ranking cache (SEAMS item J) ────────────────────────────────

  /**
   * Materialize `strength(m, d)` / `band(m, d)` into box 3. Box 3 only: nothing
   * here is truth, and `rebuildCache()` drops it with the rest of the cache. A
   * replayed day is a no-op by construction — same state, same day, same number.
   */
  setRanking(rows: readonly RankingRow[]): void {
    this.assertWritable("setRanking");
    if (rows.length === 0) return;
    this.cache.transaction(() => {
      const st = this.cache.prepare(
        "INSERT OR REPLACE INTO ranking (memory_id, strength, band, day) VALUES (?, ?, ?, ?)",
      );
      for (const r of rows) st.run(r.id, r.strength, r.band, r.day);
    });
    this.emit("store.ranking", undefined, { count: rows.length });
  }

  /**
   * Drop rows from box 3's ranking (2026-10-10): a row the turn-down no longer
   * ranks — a chapter's copy, a handoff — must not sit there at the strength
   * it was last read at, or the ambient prefilter (`search`'s `minStrength`)
   * would keep reading it as below reach.
   */
  dropRanking(ids: readonly string[]): void {
    this.assertWritable("dropRanking");
    if (ids.length === 0) return;
    this.cache.transaction(() => {
      const st = this.cache.prepare("DELETE FROM ranking WHERE memory_id = ?");
      for (const id of ids) st.run(id);
    });
  }

  /**
   * THE TURN-DOWN'S WORK LIST (2026-10-10, review 13 C2): live rows whose
   * next-change day has come (`physics#nextChangeDay`), or that have none yet
   * (NULL — never looked at, or an input of the curve was written since and a
   * trigger cleared it). Ordered by id, for the phase's cursor. Indexed
   * (`memories(archived, next_change_day)`).
   */
  turnDownDue(day: number): string[] {
    return this.ops
      .all<{ id: string }>(
        "SELECT id FROM memories WHERE archived = 0 AND (next_change_day IS NULL OR next_change_day <= ?) ORDER BY id",
        day,
      )
      .map((r) => r.id);
  }

  /**
   * Write the turn-down's next-change days back (v13). Derived bookkeeping, not
   * an input of anything: no event, no `updated_at`, and the column is outside
   * the trigger's list, so writing it clears nothing.
   */
  setNextChangeDays(rows: readonly { id: string; day: number }[]): void {
    this.assertWritable("setNextChangeDays");
    if (rows.length === 0) return;
    this.ops.transaction(() => {
      const st = this.ops.prepare("UPDATE memories SET next_change_day = ? WHERE id = ?");
      for (const r of rows) st.run(r.day, r.id);
    });
  }

  /**
   * Rows born on lived day `day`, counted by kind — every row but a chapter
   * (`type = 'episode'`), archived ones included: the sleep census's
   * "created" (`sleep/cycle.ts#census`), as one grouped read.
   */
  bornOn(day: number): { kind: Kind; n: number }[] {
    return this.ops.all<{ kind: Kind; n: number }>(
      "SELECT kind, COUNT(*) AS n FROM memories WHERE birth_day = ? AND type != 'episode' GROUP BY kind",
      day,
    );
  }

  /**
   * HOW MANY LIVE MEMORIES ARE BELOW REACH NOW (2026-10-10, review 03 C3: the
   * dashboard counts below reach and exited apart) — as the last decay pass
   * read them (box 3's `ranking`, a pass stale at most): live rows that are not
   * chapters, ranked under physics' `REACH` and not in the identity band. A
   * chapter's copy and a handoff have no ranking row, so they are never
   * counted. Exited (archived) rows are counted by the prune's own records.
   */
  belowReachCount(): number {
    const ranking = this.rankingAll();
    let n = 0;
    for (const r of this.ops.all<MemoryRow>("SELECT * FROM memories WHERE archived = 0 AND type != 'episode'")) {
      if (reachExempt(r)) continue;
      const rk = ranking.get(r.id);
      if (rk !== undefined && rk.band !== "identity" && rk.strength < PHYSICS_TUNABLES.REACH) n += 1;
    }
    return n;
  }

  /**
   * THE OLD-CLAIMS ERA, as it stands (2026-10-10, `operational.ts#eraClaimOf`):
   * the cutoff the curve reads (null: off), the moment first recorded (what
   * `--on` restores), and how many live memories the curve now reads at
   * today's default rather than their stored claim — `down` below it (an old
   * explicit claim, or an old default above today's), `up` above it (an old
   * default below today's, 2026-10-11); `affected` is both. A read; one pass
   * over the live memory rows, each through `row()` so the hold and the cutoff
   * are the ones the curve sees. A dream's merged memory carrying its best
   * source's moment (`ERA_WRITTEN_AT_META`, 2026-10-11) is a candidate too,
   * whatever its own `created_at`; `eraClaimOf` decides.
   */
  claimsEra(): { cutoff: number | null; recorded: number | null; affected: number; down: number; up: number } {
    const num = (v: string | undefined): number | null => {
      const n = v === undefined || v === "" ? Number.NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const cutoff = num(this.getMeta(CLAIMS_ERA_CUTOFF_KEY));
    const recorded = num(this.getMeta(CLAIMS_ERA_RECORDED_KEY));
    let down = 0;
    let up = 0;
    if (cutoff !== null) {
      for (const { id } of this.ops.all<{ id: string }>(
        `SELECT id FROM memories WHERE archived = 0 AND type = 'memory' AND claimed IS NOT NULL
           AND (created_at IS NULL OR created_at < ? OR meta LIKE '%"${ERA_WRITTEN_AT_META}"%')`,
        cutoff,
      )) {
        const row = this.row(id);
        if (row === undefined || reachExempt(row) || row.claimed === null) continue;
        const era = rowToPhysics(row).eraClaim;
        if (typeof era !== "number") continue;
        if (era < row.claimed) down += 1;
        else up += 1;
      }
    }
    return { cutoff, recorded, affected: down + up, down, up };
  }

  /** Every row's next-change day forgotten (a new curve: the turn-down looks at all of them once). */
  clearNextChangeDays(): void {
    this.assertWritable("clearNextChangeDays");
    this.ops.run("UPDATE memories SET next_change_day = NULL WHERE next_change_day IS NOT NULL");
  }

  ranking(id: string): RankingRow | undefined {
    const row = this.cache.get<{ memory_id: string; strength: number; band: string; day: number }>(
      "SELECT * FROM ranking WHERE memory_id = ?",
      id,
    );
    return row === undefined
      ? undefined
      : { id: row.memory_id, strength: row.strength, band: row.band as Band, day: row.day };
  }

  rankingAll(): Map<string, RankingRow> {
    const out = new Map<string, RankingRow>();
    for (const row of this.cache.all<{
      memory_id: string;
      strength: number;
      band: string;
      day: number;
    }>("SELECT * FROM ranking")) {
      out.set(row.memory_id, {
        id: row.memory_id,
        strength: row.strength,
        band: row.band as Band,
        day: row.day,
      });
    }
    return out;
  }

  /**
   * Bounded versioning (contract §4): superseded-version rows older than H lived
   * days go. Every discard reports what and how much (scar §2.4).
   *
   * **THIS DELETES THE OWNER'S EARLIER WORDS, and since the floor that is the
   * plain truth of it.** The line that used to stand here said "the archived
   * prose file is left where it is — this module destroys nothing", and it was
   * true: a version row was a NOTE about a file nothing ever unlinked, so the
   * prune cost the history its index and not one word. The words are IN the row
   * now, so at H the wording itself is gone.
   *
   * Kept anyway, at 90 lived days (owner ruling 1, 2026-09-18), and his reason
   * is the general steer: simple, elegant working-memory mechanics over keeping
   * everything, and losing some history after a month or two is an acceptable
   * price. Our own store sets `retentionDays` high for debugging.
   * `test/self-page.test.ts` makes the cost visible on the self page, which is
   * where an owner would feel it first.
   */
  pruneSupersededVersions(): PruneReport {
    const report = this.mutate("pruneSupersededVersions", () => {
      const cutoffDay = this.livedDay() - this.retentionDays;
      const doomed = this.ops.all<VersionRow>(
        "SELECT * FROM versions WHERE version_day < ?",
        cutoffDay,
      );
      this.ops.run("DELETE FROM versions WHERE version_day < ?", cutoffDay);
      return { pruned: doomed.length, cutoffDay, retentionDays: this.retentionDays };
    });
    this.emit("store.versions.pruned", undefined, {
      count: report.pruned,
      cutoffDay: report.cutoffDay,
      retentionDays: report.retentionDays,
    });
    return report;
  }

  /**
   * The store's half of the owner-removal seam: the canonical, append-only record.
   * A later stage appends; it never rewrites the earlier line (§16 G8). If this
   * cannot be written, the caller must move nothing (§16 G10).
   */
  appendRemovalRecord(note: RemovalNote): number {
    const seq = this.mutate("appendRemovalRecord", () => {
      this.ops.run(
        "INSERT INTO removal_record (memory_id, stage, at, actor, reason) VALUES (?, ?, ?, ?, ?)",
        note.memoryId,
        note.stage,
        this.nowFn(),
        note.actor,
        note.reason ?? null,
      );
      const row = this.ops.get<{ seq: number }>("SELECT last_insert_rowid() AS seq");
      return row?.seq ?? 0;
    });
    this.emit("store.removal.recorded", note.memoryId, { stage: note.stage, seq });
    return seq;
  }

  /**
   * Box 3 only. Deleting the cache file and calling this must lose nothing
   * canonical; what cannot be recomputed is declared and counted (§5 G8).
   */
  rebuildCache(opts: RebuildOptions = {}): RebuildReport {
    this.assertWritable("rebuildCache");
    const keepVectors = opts.keepVectors === true;
    // Read the surviving vector ids BEFORE the reset, so "kept" is a count and
    // not an assumption, and so the sweep below knows what it is sweeping.
    const heldVectors = keepVectors
      ? new Set(
          this.cache
            .all<{ memory_id: string }>("SELECT memory_id FROM embeddings")
            .map((r) => r.memory_id),
        )
      : new Set<string>();
    // THE DROP-VECTORS EXIT LEAVES A DURABLE ROW (re-review NIT 2): what a
    // plain rebuild drops, and the hold it ends, read before the reset.
    const droppingVectors = keepVectors ? 0 : embeddingCount(this.cache);
    const endingHold = keepVectors ? null : heldEmbedder(this.cache);
    resetCache(this.cache, { keepEmbeddings: keepVectors });
    const denied = new Set(this.deniedIds());
    const rows = this.ops.all<MemoryRow>("SELECT * FROM memories ORDER BY id");
    let indexed = 0;
    let skippedDenied = 0;
    let skippedArchived = 0;
    let unrecomputed = 0;
    for (const row of rows) {
      if (denied.has(row.id)) {
        // A stray copy of a removed memory is skipped and LOGGED, never deleted (§16 G12).
        skippedDenied += 1;
        this.emit("cache.rebuild.denied", row.id, {});
        continue;
      }
      // Not live, not indexed. `archive` and `supersede` take a row out of box 3
      // as it goes dark; a rebuild that put it back would restore the I13 bug on
      // the owner's next `verify --rebuild` — the index's denominator would
      // count rows `recall`'s `storeSize` does not.
      if (row.archived === 1 || row.superseded_by !== null) {
        skippedArchived += 1;
        continue;
      }
      const text = indexTextOf(row.title, row.body);
      // KEEP MEANS KEEP. A row that already has a vector is not offered to the
      // embedder at all under `keepVectors` — the first version called it and
      // let `indexDoc` overwrite what it had just promised to preserve, so a
      // process with an embedder wired paid a network call per row and reported
      // the result as `keptVectors`. Two words for one behaviour is how an API
      // starts lying; the name picks the behaviour, and the caller that wants
      // fresh vectors wants a plain `rebuildCache()`.
      const held = keepVectors && heldVectors.has(row.id);
      const vec = held ? null : this.embed ? this.embed(text) : null;
      if (vec !== null) {
        if (indexDoc(this.cache, row.id, text, vec) !== null) unrecomputed += 1;
      } else {
        indexDoc(this.cache, row.id, text);
        // A miss is only a LOSS when there was nothing there to keep. Under
        // `keepVectors` the row's existing vector is still in the table, so
        // counting it un-recomputed would report a gap box 3 does not have.
        if (!held) unrecomputed += 1;
      }
      indexed += 1;
    }
    // Vectors whose memory is no longer canonical do NOT survive a rebuild —
    // `keepVectors` preserves the cache, it does not resurrect a removed
    // memory's trace (§16 G12) or keep an orphan the set diff would then report
    // forever. Deleted here rather than skipped, because the plain rebuild
    // drops them by dropping the table and the two paths must agree.
    let droppedVectors = 0;
    let keptVectors = 0;
    if (keepVectors && heldVectors.size > 0) {
      const canonical = new Set(rows.map((r) => r.id));
      const del = this.cache.prepare("DELETE FROM embeddings WHERE memory_id = ?");
      this.cache.transaction(() => {
        for (const id of heldVectors) {
          if (!canonical.has(id) || denied.has(id)) {
            del.run(id);
            droppedVectors += 1;
          } else keptVectors += 1;
        }
      });
    }
    // Declared when there is no embedder at all, AND when a configured one
    // could not answer for some rows — both are "box 3 does not hold what a
    // vector channel would need", and a silent partial is the worse of the two.
    //
    // `keepVectors` is the third way to have nothing to declare, and it is the
    // reason this is not simply "is there an embedder": a rebuild that kept
    // every vector it started with is not missing them, whatever this process
    // could or could not have recomputed. Without the extra arm a
    // `verify --rebuild --keep-vectors` that lost nothing would still print a
    // repair instruction for a gap box 3 does not have.
    const declared =
      unrecomputed === 0 && (this.embed !== undefined || keepVectors)
        ? []
        : [
            {
              what: "embeddings",
              owner: "encode/ (the embedder)",
              repair: "Store.open({ embed }) then rebuildCache()",
            },
          ];
    const report: RebuildReport = {
      indexed,
      skippedDenied,
      skippedArchived,
      unrecomputed,
      declared,
      keptVectors,
      droppedVectors,
    };
    this.emit("cache.rebuild", undefined, {
      indexed,
      skippedDenied,
      skippedArchived,
      unrecomputed,
      keptVectors,
      droppedVectors,
      declaredKinds: declared.map((d) => d.what).join(",") || "none",
    });
    if (droppingVectors > 0 || endingHold !== null) {
      try {
        this.appendEvent({
          name: EMBEDDER_RECONCILED_EVENT,
          day: this.livedDay(),
          payload: { kind: "dropped", by: "rebuildCache", dropped: droppingVectors, releasedHold: endingHold },
        });
      } catch {
        // A lost lock costs the row, never the rebuild.
      }
    }
    return report;
  }

  /**
   * Take every NOT-LIVE document out of the text index, and touch nothing else.
   *
   * This is I13's migration, and it exists for the same reason `backfillLengths`
   * does: the repair is a pure function of state box 3 and box 2 already hold,
   * so it must not be paid for with `rebuildCache`, which begins with
   * `resetCache` and drops every embedding — roughly 13.9K of them on the store
   * this was written against, one paid network call each. `counterparts verify
   * --rebuild` refuses outright for that reason unless the owner passes
   * `--drop-vectors`, so a rebuild is not a repair anyone can actually run here.
   *
   * `archive` and `supersede` keep the invariant going forward
   * (`cache.ts#deindexDoc`); this is how a store that predates them catches up.
   * It is NOT run at open: an instrument writes nothing at open, and a write at
   * open takes the write lock (see the constructor). The owner runs it by name.
   *
   * Returns the number of documents removed from the index.
   */
  pruneDeadIndex(): number {
    this.assertWritable("pruneDeadIndex");
    const live = new Set(this.list({ archived: false }));
    const indexed = this.cache
      .all<{ memory_id: string }>("SELECT DISTINCT memory_id FROM doc_tokens")
      .map((r) => r.memory_id);
    let removed = 0;
    for (const id of indexed) {
      if (live.has(id)) continue;
      deindexDoc(this.cache, id);
      removed += 1;
    }
    if (removed > 0) this.emit("cache.prune.dead", undefined, { removed });
    return removed;
  }

  /**
   * Give ONE existing memory its vector — **the vector row only**, never the
   * token rows.
   *
   * `rebuildCache()` was the only public way to put a vector in box 3, and it
   * resets the whole cache: a store whose embedder arrived after its memories
   * did (this one — 40 authored notes, 224 episodes and 288 migrated memories
   * with no vector, measured 2026-09-04) had no way to fill the gap
   * incrementally, so the semantic channel stayed blind to exactly the
   * first-person material it most wanted.
   *
   * **Why not `indexDoc`, which would have been the obvious reuse:** it deletes
   * and re-inserts every `doc_tokens` row for the document. The text has not
   * changed — only the vector is missing — so that is pure churn on the 263 MB
   * token index whose page-cache warming is what pushed `recall/`'s BUDGET_MS
   * from 250 to 1200. A backfill of 64 memories per Stop would have made the
   * cold recall it exists to serve slower.
   *
   * It reads the SYNC embedder, like every other indexing site, so the caller's
   * job is to have warmed the live half first with `indexTextOf(title, body)` —
   * the same string `indexOne` looks a vector up by. A miss is not an error and
   * not a lie: nothing is written and `vector` comes back false, so a backfill
   * that warmed the wrong text reports zero rather than success.
   */
  embedOne(id: string): { found: boolean; vector: boolean; refused?: VectorRefusal } {
    this.assertWritable("embedOne");
    if (this.isDenied(id)) return { found: false, vector: false };
    const row = this.row(id);
    if (row === undefined) return { found: false, vector: false };
    let doc: ProseDoc;
    try {
      doc = this.readProse(id);
    } catch {
      return { found: false, vector: false };
    }
    // THE THIRD DOOR, guarded like the other two. `unembeddedIds` will never
    // offer one of these, but this method takes an id from a caller and a
    // backfill that named one directly would embed it — the whole point of
    // `noVector` is that a caller cannot reach the wire for these rows by any
    // route. `found: true, vector: false` is the honest answer: the row is
    // there, and it has no vector on purpose.
    const vec = this.embed && !noVector(doc.type, doc.meta["role"]) ? this.embed(indexText(doc)) : null;
    if (vec === null) return { found: true, vector: false };
    // `refused`: the FILE said no (held, ahead, or now another identity's) —
    // not the item's fault, so a backfill must not count it against the id.
    const refused = setEmbedding(this.cache, id, vec);
    if (refused !== null) {
      this.emit("cache.vector.refused", id, { site: "embedOne", reason: refused });
      return { found: true, vector: false, refused };
    }
    return { found: true, vector: true };
  }

  /**
   * Live memories box 3 holds no vector for, in the order a backfill should take
   * them: **the first-person material first** — what the experiencer authored
   * (`source = 'authored'`) and its own episodes — then everything else, oldest
   * first inside each group.
   *
   * The order is the whole point and it is a memory claim, not a convenience:
   * an authored note and an episode are the memories this brain wrote about
   * itself, so if a bounded backfill only ever reaches N per run, those are the
   * N that should arrive first.
   *
   * Two boxes, two queries, diffed here: box 2 knows what is live, box 3 knows
   * what is embedded, and they are separate files by design.
   */
  missingVectors(limit = 64): string[] {
    return this.unembeddedIds(limit, false);
  }

  /**
   * The ids a backfill has given up on — `EMBED_SKIP_AFTER` failed runs each.
   *
   * THE HEAD-OF-LINE SCAR (I33, 2026-09-11). Two migrated memories carried a
   * lone UTF-16 surrogate in their title; the provider answered 400 for the
   * whole 64-text chunk; `missingVectors` returns a STABLE order, so the same
   * head-64 was retried at every boundary for a week and 165 blind memories
   * behind them never got a turn. A skip list is the general fix: whatever the
   * poison is, an id that has failed three runs stops holding the queue.
   *
   * Distinct from `deniedIds()` by design. A denial is a REMOVAL — the row is
   * dark and must never come back. A skip is an operational give-up on ONE
   * channel: the memory is live, recallable, and lexically indexed; only its
   * vector is missing, and a repair (or a rebuild) clears the counter.
   *
   * Kept in box 2's meta rather than a column, because it is a fact about a
   * retry loop and not about the memory — same shape as `sleep.pruned.<id>`,
   * and no schema bump.
   */
  skippedVectorIds(): string[] {
    return this.unembeddedIds(Number.MAX_SAFE_INTEGER, true);
  }

  /**
   * Live memories with no vector, in backfill order. `skipped` selects WHICH
   * half: the ones a backfill should try (false) or the ones it has given up on
   * (true). One query, one order, two readings — a second copy of this walk is
   * how the two lists would drift.
   */
  private unembeddedIds(limit: number, skipped: boolean): string[] {
    const embedded = new Set(
      this.cache.all<{ memory_id: string }>("SELECT memory_id FROM embeddings").map(
        (r) => r.memory_id,
      ),
    );
    const denied = new Set(this.deniedIds());
    // ONE read of the failure counters per call, not one per candidate row.
    const failures = this.metaWithPrefix(EMBED_FAILED_PREFIX);
    const givenUp = (id: string): boolean =>
      Number(failures.get(`${EMBED_FAILED_PREFIX}${id}`) ?? "0") >= EMBED_SKIP_AFTER;
    const rows = this.ops.all<{ id: string; type: string; meta: string }>(
      `SELECT id, type, meta FROM memories
        WHERE archived = 0 AND superseded_by IS NULL
        ORDER BY CASE WHEN source IN ('authored', 'episode') OR type = 'episode' THEN 0 ELSE 1 END,
                 birth_day ASC, id ASC`,
    );
    const out: string[] = [];
    for (const r of rows) {
      if (embedded.has(r.id) || denied.has(r.id)) continue;
      if (notForEmbedding(r)) continue;
      if (givenUp(r.id) !== skipped) continue;
      out.push(r.id);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * How many live memories a backfill could still act on — the denominator a
   * coverage watch needs, and the number that must fall run over run.
   *
   * Since I33 it EXCLUDES the give-up list, because the number's job is to say
   * what is actionable: a count that never falls because three ids in it can
   * never be embedded is a watch that has stopped meaning anything. The excluded
   * ids are not hidden — `skippedVectorIds()` names them, the backfill row
   * carries `skipped`, and `verify` prints both, so the two numbers add up on
   * the page where an owner reads them.
   */
  unembeddedCount(): number {
    return this.missingVectors(Number.MAX_SAFE_INTEGER).length;
  }

  /**
   * Every meta row under one key prefix. A read; nothing is created.
   *
   * The meta table is this store's general-purpose key space, and two of its
   * inhabitants are per-id counters (`sleep.pruned.<id>`, `embed.failed.<id>`)
   * whose readers want the whole family at once. One `LIKE` beats N `getMeta`
   * calls in a loop over every live memory, which is what the alternative was.
   * `_` and `%` in the prefix are escaped: the caller passes a key prefix, not
   * a pattern.
   */
  metaWithPrefix(prefix: string): Map<string, string> {
    const pattern = `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.ops.all<{ key: string; value: string }>(
      `SELECT key, value FROM meta WHERE key LIKE ? ESCAPE '\\'`,
      pattern,
    );
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  /**
   * How many vectors box 3 HOLDS — the numerator, and a different number from
   * `unembeddedCount()`.
   *
   * Filed as a core follow-up by PR #43's review (`adapters/cli/NOTES.md`,
   * 2026-09-04): the console needed "how many embeddings would `--rebuild`
   * destroy" before it could refuse, `unembeddedCount()` is the coverage
   * denominator instead, and with no read API for the count the CLI reached
   * past the Store into `cache.sqlite` with its own `openDb`. It still does for
   * the census — that read is deliberately gated on the FILE existing, so it
   * cannot mint the box it inspects, which a Store constructor cannot promise —
   * but a caller that already holds an open Store now has the number here.
   *
   * Counts every vector, including one held for an archived or superseded row:
   * this is what box 3 contains, not what a live coverage ratio would want.
   */
  embeddingCount(): number {
    return embeddingCount(this.cache);
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  has(id: string): boolean {
    return this.row(id) !== undefined;
  }

  /**
   * One memory's row — plus `feeling_peak`, the strongest feeling recorded on
   * it (physics §5.10, emotion part A). Every physics read goes through here
   * (`read`, `physicsOf`, sleep, recall, the dashboard), so this one subquery
   * is what makes a feeling weigh the same everywhere. `feelings_memory` is
   * indexed, so it is one index probe per row.
   */
  row(id: string): (MemoryRow & FeelingPeak) | undefined {
    // v9: `feeling_peak_lived` is the same peak WITHOUT the feelings a
    // reflection recorded later — the one the core's fast lane reads unless
    // `CORE_FAST_ACCEPTS_REFLECTED_FEELING` is set (physics §5.3). Since
    // 2026-10-02 an awake feeling-now (`awake`) is left out the same way
    // (`LATER_FEELING_SOURCES`).
    // v13 (2026-10-10): `today_date`, the store's calendar today, so the
    // dated hold (`operational.ts#datedHold`) reads off this one statement.
    // The old-claims era's cutoff rides the same way (`eraClaimOf`).
    return this.ops.get<MemoryRow & FeelingPeak>(
      `SELECT m.*,
              (SELECT value FROM meta WHERE key = 'lastActiveDate') AS today_date,
              (SELECT value FROM meta WHERE key = '${CLAIMS_ERA_CUTOFF_KEY}') AS claims_era_cutoff,
              (SELECT MAX(f.strength) FROM feelings f WHERE f.memory_id = m.id) AS feeling_peak,
              (SELECT MAX(f.strength) FROM feelings f
                WHERE f.memory_id = m.id AND (f.source IS NULL OR f.source NOT IN (${LATER_SQL}))) AS feeling_peak_lived
         FROM memories m WHERE m.id = ?`,
      id,
    );
  }

  read(id: string): StoredMemory {
    const row = this.requireRow(id);
    const doc = this.docOf(row);
    if (row.archived === 1) {
      // §5 G13: a read-back of archived content is an event, so "did the archival
      // mechanisms ever pay for themselves" is an answerable question in v2.
      this.emit("store.archived.read", id, { reason: row.archived_reason });
    }
    return {
      doc,
      physics: rowToPhysics(row),
      band: row.band,
      bandDay: row.band_day,
      archived: row.archived === 1,
      archivedReason: row.archived_reason,
      supersededBy: row.superseded_by,
      revision: row.revision,
      contentHash: row.content_hash,
      confidential: row.confidential === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      model: row.model,
      about: aboutMarkOf(row.about),
      aboutBy: row.about_by ?? null,
    };
  }

  readProse(id: string): ProseDoc {
    return this.read(id).doc;
  }

  physicsOf(id: string): MemoryPhysics {
    return rowToPhysics(this.requireRow(id));
  }

  /**
   * Follows the forwarding addresses to the live head. Cycles are a hard error.
   *
   * A REMOVED id is terminal: the walk stops there and returns it, rather than
   * walking past it or reporting the address as dangling. That is what makes a
   * survivor's lineage pointer resolve to a named removal — `read` refuses the
   * returned id by name, so a renderer prints "[removed by the owner]" instead
   * of "[a forwarding address with nothing at the end]". The deny-list is
   * checked BEFORE the row, so the answer is the same before and after the
   * chase has stripped the row to a skeleton.
   */
  resolve(id: string): string {
    let current = id;
    const seen = new Set<string>();
    for (let depth = 0; depth <= MAX_CHAIN; depth++) {
      if (seen.has(current)) throw new StoreError("ID_CYCLE", { id, at: current });
      seen.add(current);
      if (this.isDenied(current)) return current;
      const row = this.row(current);
      if (row === undefined) {
        throw new StoreError(current === id ? "ID_UNKNOWN" : "ID_DANGLING", { id, at: current });
      }
      if (row.superseded_by === null) return current;
      current = row.superseded_by;
    }
    throw new StoreError("ID_CHAIN_TOO_DEEP", { id, max: MAX_CHAIN });
  }

  list(filter: MemoryFilter = {}): string[] {
    const { clause, args } = memoryWhere(filter);
    const sql = `SELECT id FROM memories ${clause} ORDER BY id`;
    return this.ops.all<{ id: string }>(sql, ...args).map((r) => r.id);
  }

  /**
   * THE LIVE MEMORIES MINTED FROM THESE ROWS (`origin_ref`), grouped by the
   * row they came from, each with what a wake's line needs to decide on it:
   * confidentiality and the `about` mark (2026-10-01, review of #311).
   * `origin_ref` has no index, so a per-row `list({ originRef })` was a scan
   * per episode — 300 episodes on a 15k-row store cost the wake seconds. This
   * is ONE scan for the whole set, in chunks the SQL parameter limit allows.
   * No schema change. Never returns a removed row's words; ids and flags only.
   */
  copiesOf(refs: readonly string[]): Map<string, { id: string; confidential: boolean; about: string | null }[]> {
    const out = new Map<string, { id: string; confidential: boolean; about: string | null }[]>();
    const unique = [...new Set(refs)];
    const CHUNK = 500;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const part = unique.slice(i, i + CHUNK);
      const rows = this.ops.all<{ id: string; origin_ref: string; confidential: number; about: string | null }>(
        `SELECT id, origin_ref, confidential, about FROM memories
          WHERE type = 'memory' AND archived = 0 AND origin_ref IN (${part.map(() => "?").join(", ")})
          ORDER BY id`,
        ...part,
      );
      for (const r of rows) {
        const held = out.get(r.origin_ref) ?? [];
        held.push({ id: r.id, confidential: r.confidential === 1, about: r.about });
        out.set(r.origin_ref, held);
      }
    }
    return out;
  }

  /**
   * THE WAKE'S WORK CANDIDATES IN ONE DIRECTORY (2026-10-01, lane 8; review of
   * #313): live memories written in `scope` that the row's own columns allow
   * to be work — marked `work`, or unmarked and a skill, fact, entity or place
   * — and not identity, dated, confidential or emptied; newest touched first
   * (born or used, the later), then id, at most `limit`. The columns only:
   * the caller reads the prose of what comes back, never of the whole store
   * (a session start read every row's text, 370 ms at 3,000 rows).
   */
  workCandidates(scope: string, limit: number): string[] {
    return this.ops
      .all<{ id: string }>(
        `SELECT id FROM memories
          WHERE type = 'memory' AND archived = 0 AND origin_scope = ?
            AND band != 'identity' AND event_date IS NULL AND confidential = 0 AND body != ''
            AND (about = 'work' OR (about IS NULL AND kind IN ('skill', 'fact', 'entity', 'place')))
          ORDER BY MAX(birth_day, last_used_day) DESC, id
          LIMIT ?`,
        scope,
        Math.max(0, Math.floor(limit)),
      )
      .map((r) => r.id);
  }

  /**
   * WHAT A SESSION WROTE IN ONE DIRECTORY AFTER A MOMENT THAT MAY BE A PLAN
   * (2026-10-09, the handoff's "since" line): live memories a session wrote
   * itself (`source = 'authored'`: a note, a `session_end` entry) under one of
   * `scopes`, born after `after` (epoch ms), whose v12 `status` is one of
   * `statuses` or whose meta may say `unresolved` — a loose text match the
   * caller confirms on the prose. Not archived, superseded or emptied, and
   * not confidential unless `confidential`. Newest first, then id, at most
   * `limit`. The columns only, as `workCandidates`. A store without the v12
   * column throws; the caller wraps it.
   */
  planCandidates(input: {
    readonly scopes: readonly string[];
    readonly after: number;
    readonly statuses: readonly MemoryStatus[];
    readonly limit: number;
    readonly confidential?: boolean;
  }): string[] {
    const scopes = input.scopes.filter((s) => s.length > 0);
    const statuses = input.statuses.filter((s) => (STATUSES as readonly string[]).includes(s));
    if (scopes.length === 0 || input.limit <= 0) return [];
    const marks = (n: number): string => Array.from({ length: n }, () => "?").join(", ");
    const status = statuses.length === 0 ? "" : `status IN (${marks(statuses.length)}) OR `;
    return this.ops
      .all<{ id: string }>(
        `SELECT id FROM memories
          WHERE type = 'memory' AND archived = 0 AND superseded_by IS NULL AND body != ''
            AND source = 'authored' AND origin_scope IN (${marks(scopes.length)}) AND created_at > ?
            ${input.confidential === true ? "" : "AND confidential = 0"}
            AND (${status}meta LIKE '%"unresolved":true%')
          ORDER BY created_at DESC, id
          LIMIT ?`,
        ...scopes,
        input.after,
        ...statuses,
        Math.max(0, Math.floor(input.limit)),
      )
      .map((r) => r.id);
  }

  /**
   * How many rows `list()` would return, counted in SQL rather than materialized.
   * The same filter, the same WHERE, one number — for the callers that want the
   * SIZE of the store (the wake's delivery preface states it) and would otherwise
   * build an array of every id to take its length.
   */
  countMemories(filter: MemoryFilter = {}): number {
    const { clause, args } = memoryWhere(filter);
    const sql = `SELECT COUNT(*) AS n FROM memories ${clause}`;
    return this.ops.get<{ n: number }>(sql, ...args)?.n ?? 0;
  }

  /**
   * LIVE memories whose reminder date (`event_date`) covers any day from `from`
   * to `to`, inclusive — `YYYY-MM-DD` both (prospective/INTERFACE-GAPS §2).
   * Ordered by the date, earliest first, then id.
   *
   * The SQL bound is loose on purpose and the exact test is `time.ts`'s: a
   * month `2026-10` sorts BEFORE `2026-10-01` as text and a range's text runs
   * past its first day, so a plain `BETWEEN` would miss both. The index answers
   * "starts no later than `to`" (`'~'` sorts after every digit and `..`), and
   * `calendarOverlaps` decides the rest. The older meta convention
   * (`meta.eventDate`) is read by nothing since 2026-09-26: this column is the
   * one place a reminder date lives.
   *
   * `archived: true` includes archived memories too — for `prospective/`'s exit
   * accounting, where a dated memory archived before its window is the `faded`
   * exit and has to be found to be counted.
   */
  datedMemories(from: string, to: string, opts: { archived?: boolean } = {}): DatedMemory[] {
    const rows = this.ops.all<{ id: string; event_date: string }>(
      `SELECT id, event_date FROM memories
        WHERE event_date IS NOT NULL AND event_date <= ?${opts.archived === true ? "" : " AND archived = 0"}`,
      `${to}~`,
    );
    return rows
      .filter((r) => calendarOverlaps(r.event_date, from, to))
      .sort((a, b) => compareCalendarDates(a.event_date, b.event_date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r) => ({ id: r.id, eventDate: r.event_date }));
  }

  /**
   * LIVE memories whose reminder date REPEATS (`RECURRING_META`, 2026-10-09):
   * a day `event_date` and a recurrence word in meta. `datedMemories` asks
   * whether the date AS STATED reaches a span, and a birthday stated as
   * `1990-05-14` never reaches this year's; this is the other half, and
   * `prospective/` asks it for the occurrence that does. The SQL match is
   * loose (a text match on the meta, as `planCandidates` does for
   * `unresolved`) and the parsed meta decides. Ordered by id.
   */
  recurringMemories(opts: { archived?: boolean } = {}): RecurringMemory[] {
    const rows = this.ops.all<{ id: string; event_date: string; meta: string }>(
      `SELECT id, event_date, meta FROM memories
        WHERE event_date IS NOT NULL AND meta LIKE '%"${RECURRING_META}":"%'${opts.archived === true ? "" : " AND archived = 0"}
        ORDER BY id`,
    );
    const out: RecurringMemory[] = [];
    for (const r of rows) {
      const rule = recurrenceOfRow(r);
      if (rule !== null) out.push({ id: r.id, eventDate: r.event_date, recurring: rule });
    }
    return out;
  }

  /** A memory's feelings, oldest first (then in the order written). A removed memory has none. */
  feelingsFor(memoryId: string): FeelingRow[] {
    return this.ops.all<FeelingRow>(
      "SELECT * FROM feelings WHERE memory_id = ? ORDER BY created_at, rowid",
      memoryId,
    );
  }

  /**
   * Feelings recorded at or after `sinceMs` (the store's clock, UTC ms) — the
   * raw material of "how each person feels right now" (recall G18). Newest
   * first. Only feelings on a memory that is still live: an archived or
   * superseded memory's feelings no longer speak for the moment.
   */
  feelingsSince(sinceMs: number): FeelingRow[] {
    return this.ops.all<FeelingRow>(
      `SELECT f.* FROM feelings f JOIN memories m ON m.id = f.memory_id
        WHERE f.created_at >= ? AND m.archived = 0 AND m.superseded_by IS NULL
        ORDER BY f.created_at DESC, f.rowid DESC`,
      sinceMs,
    );
  }

  /**
   * Every feeling on a LIVE memory, with its memory's birth day beside it — the
   * pool a deliberate question about feeling ranks from (recall, 2026-09-30,
   * U13). One scan of the `feelings` table, which is small (a few per memory at
   * most), the same scan `feelingsSince` makes. An archived or superseded
   * memory's feelings are not in it.
   */
  feelingsLive(): (FeelingRow & { birth_day: number })[] {
    return this.ops.all<FeelingRow & { birth_day: number }>(
      `SELECT f.*, m.birth_day AS birth_day FROM feelings f JOIN memories m ON m.id = f.memory_id
        WHERE m.archived = 0 AND m.superseded_by IS NULL
        ORDER BY f.created_at, f.rowid`,
    );
  }

  /**
   * The feelings on several memories in ONE query, with each memory's birth
   * day beside them (a feeling softens from the day its memory was born —
   * physics §5.10). Recall's mood-matching reads this for its candidates only,
   * inside its latency budget. Ids with no feelings are simply absent.
   */
  feelingsOn(ids: readonly string[]): Map<string, (FeelingRow & { birth_day: number })[]> {
    const out = new Map<string, (FeelingRow & { birth_day: number })[]>();
    if (ids.length === 0) return out;
    const unique = [...new Set(ids)];
    // SQLite's default bound-variable ceiling is far above recall's candidate
    // cap; chunk anyway so no caller can walk into it.
    for (let at = 0; at < unique.length; at += 500) {
      const part = unique.slice(at, at + 500);
      const rows = this.ops.all<FeelingRow & { birth_day: number }>(
        `SELECT f.*, m.birth_day AS birth_day FROM feelings f JOIN memories m ON m.id = f.memory_id
          WHERE f.memory_id IN (${part.map(() => "?").join(",")})
          ORDER BY f.created_at, f.rowid`,
        ...part,
      );
      for (const r of rows) {
        const list = out.get(r.memory_id) ?? [];
        list.push(r);
        out.set(r.memory_id, list);
      }
    }
    return out;
  }

  /**
   * THE EMOTION CENSUS — how many live memories carry feeling, and how many of
   * those the feeling actually weighs on (intensity > 0: held higher at birth
   * and fading slower, physics §5.10). `sinceDay` narrows both to memories born
   * on or after that lived day. Counts only; no word of any feeling leaves.
   */
  emotionCensus(opts: { sinceDay?: number } = {}): { withFeelings: number; weighted: number } {
    const since = opts.sinceDay ?? Number.MIN_SAFE_INTEGER;
    const row = this.ops.get<{ with_feelings: number | null; weighted: number | null }>(
      `SELECT
         SUM(CASE WHEN EXISTS (SELECT 1 FROM feelings f WHERE f.memory_id = m.id) THEN 1 ELSE 0 END) AS with_feelings,
         SUM(CASE WHEN m.emotional > 0
                    OR EXISTS (SELECT 1 FROM feelings f WHERE f.memory_id = m.id AND f.strength > 0)
                  THEN 1 ELSE 0 END) AS weighted
         FROM memories m
        WHERE m.archived = 0 AND m.superseded_by IS NULL AND m.birth_day >= ?`,
      since,
    );
    return { withFeelings: row?.with_feelings ?? 0, weighted: row?.weighted ?? 0 };
  }

  /**
   * How many feelings, by `whose` and by `core` or `emotion` (an `other` counts
   * under `other`), recorded from `from` to `to` — the person's calendar days,
   * inclusive, read in `zone()`; either end may be left open. Counts only: no
   * word of any feeling leaves here.
   */
  feelingCounts(
    opts: { by: "core" | "emotion"; whose?: string; from?: string; to?: string },
  ): { whose: string; key: string; count: number }[] {
    const col = opts.by === "core" ? "core" : "emotion";
    const rows = this.ops.all<{ whose: string; key: string; created_at: number }>(
      `SELECT whose, ${col} AS key, created_at FROM feelings ${opts.whose === undefined ? "" : "WHERE whose = ?"}`,
      ...(opts.whose === undefined ? [] : [opts.whose]),
    );
    const zone = this.zone();
    const tally = new Map<string, { whose: string; key: string; count: number }>();
    for (const r of rows) {
      if (opts.from !== undefined || opts.to !== undefined) {
        const day = localDate(r.created_at, zone);
        if (opts.from !== undefined && day < opts.from) continue;
        if (opts.to !== undefined && day > opts.to) continue;
      }
      const k = `${r.whose}\u0000${r.key}`;
      const t = tally.get(k) ?? { whose: r.whose, key: r.key, count: 0 };
      t.count += 1;
      tally.set(k, t);
    }
    return [...tally.values()].sort((a, b) => b.count - a.count || (a.whose + a.key < b.whose + b.key ? -1 : 1));
  }

  // ── traits (folded into v9): READ-ONLY, for the dashboard ────────────────
  //
  // THE CONFIDENTIALITY RULE, in one place: a nudge on a confidential memory
  // comes back with its axis, pole and strength — numbers, the way the
  // dashboard shows a confidential memory's physics — and its `carried_by`
  // (words about the moment) EMPTY and `withheld: true`, unless the caller
  // asks `includeConfidential`. It follows the memory's column as it stands
  // now, so a memory made confidential later is withheld from then on, and a
  // merge that inherits the marker withholds the nudges it carried over.
  // The store computes no balance: that arithmetic is the dashboard's.

  /**
   * Is `name` a table in box 2? A development store stamped v9 before a table
   * was folded into v9 lacks it until its next writer open
   * (`operational.ts#ensureCurrentTables`); an observer read of such a table
   * answers empty rather than throwing. A positive answer is kept; a negative
   * one is asked again next time, since a writer may have created it since.
   */
  private hasTable(name: string): boolean {
    if (this.tablesSeen.has(name)) return true;
    const found = this.ops.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
      name,
    );
    if ((found?.n ?? 0) > 0) {
      this.tablesSeen.add(name);
      return true;
    }
    return false;
  }

  /** Whether `table` has `column` — for a reader that may meet a file from
   *  before the column (v12's fields are read below `OBSERVER_READ_FLOOR`). */
  hasColumn(table: string, column: string): boolean {
    try {
      return this.ops.all<{ name: string }>(`PRAGMA table_info(${table.replace(/[^A-Za-z0-9_]/g, "")})`).some((c) => c.name === column);
    } catch {
      return false;
    }
  }

  // ── what a memory names (v12, `memory_subjects`) ──────────────────────────

  /** The one slot `findSubjectsWith` fills. */
  private subjectFinder: ((text: string) => readonly string[]) | null = null;

  /**
   * THE FUNCTION THAT SAYS WHICH ENTITY CARDS A TEXT NAMES (v12, 2026-10-03)
   * — installed by the composition root (`Counterpart`, from `schemas/`'s
   * alias index: the store cannot import it). With one installed, every
   * memory written through `put` / `putMany` / `supersede`, and every revise
   * that changes a memory's words, links the cards its title and body name,
   * in the same transaction. None installed (a bare store, a tool): nothing
   * is linked, and nothing else changes. One slot; null removes it.
   */
  findSubjectsWith(finder: ((text: string) => readonly string[]) | null): void {
    this.subjectFinder = finder;
  }

  /**
   * Inside a write's transaction: the memory's links become what its words
   * name now — added (`via`), and dropped where the words no longer name a
   * card. Fail-open: a finder that throws, or a store without the table,
   * costs the links and never the write (an event says so).
   */
  private relinkSubjects(id: string, title: string | null, body: string, via: SubjectLinkVia = "write"): void {
    const finder = this.subjectFinder;
    if (finder === null) return;
    try {
      if (!this.hasTable("memory_subjects")) return;
      const want = new Set(finder(title === null || title.length === 0 ? body : `${title}\n${body}`).filter((s) => s !== id));
      const have = this.ops
        .all<{ subject_id: string }>("SELECT subject_id FROM memory_subjects WHERE memory_id = ?", id)
        .map((r) => r.subject_id);
      for (const s of have) {
        if (!want.has(s)) this.ops.run("DELETE FROM memory_subjects WHERE memory_id = ? AND subject_id = ?", id, s);
      }
      const at = this.nowFn();
      for (const s of [...want].sort()) {
        this.ops.run(
          "INSERT OR IGNORE INTO memory_subjects (memory_id, subject_id, via, created_at) VALUES (?, ?, ?, ?)",
          id,
          s,
          via,
          at,
        );
      }
    } catch (err) {
      this.emit("store.subjects.failed", id, { code: err instanceof StoreError ? err.code : "UNKNOWN" });
    }
  }

  /**
   * Links found outside a memory's own write — a card born after the memories
   * that name it (`via: birth`), and the one pass after the v12 upgrade
   * (`backfill`). One transaction; idempotent (an existing link stays as it
   * was found). Returns how many were new. A link to itself is skipped.
   */
  linkSubjects(links: readonly { readonly memoryId: string; readonly subjectId: string }[], via: SubjectLinkVia): number {
    return this.mutate("linkSubjects", () => {
      if (!this.hasTable("memory_subjects")) return 0;
      const insert = this.ops.prepare(
        "INSERT OR IGNORE INTO memory_subjects (memory_id, subject_id, via, created_at) VALUES (?, ?, ?, ?)",
      );
      const at = this.nowFn();
      let added = 0;
      for (const l of links) {
        if (l.memoryId === l.subjectId) continue;
        insert.run(l.memoryId, l.subjectId, via, at);
        added += (this.ops.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) > 0 ? 1 : 0;
      }
      return added;
    });
  }

  /** The cards a memory names (v12), sorted. Empty on a store without the table. */
  subjectsOf(memoryId: string): string[] {
    if (!this.hasTable("memory_subjects")) return [];
    return this.ops
      .all<{ subject_id: string }>("SELECT subject_id FROM memory_subjects WHERE memory_id = ? ORDER BY subject_id", memoryId)
      .map((r) => r.subject_id);
  }

  /** Every link a memory has, with how it was found (v12). */
  subjectLinksOf(memoryId: string): { subjectId: string; via: string; createdAt: number }[] {
    if (!this.hasTable("memory_subjects")) return [];
    return this.ops
      .all<{ subject_id: string; via: string; created_at: number }>(
        "SELECT subject_id, via, created_at FROM memory_subjects WHERE memory_id = ? ORDER BY subject_id",
        memoryId,
      )
      .map((r) => ({ subjectId: r.subject_id, via: r.via, createdAt: r.created_at }));
  }

  /**
   * The memories that name a card (v12), by id. Live ones only unless
   * `archived` is true; a removed memory has no links (the owner-op seam
   * deletes them).
   */
  memoriesNaming(subjectId: string, opts: { archived?: boolean } = {}): string[] {
    if (!this.hasTable("memory_subjects")) return [];
    return this.ops
      .all<{ memory_id: string }>(
        `SELECT s.memory_id FROM memory_subjects s JOIN memories m ON m.id = s.memory_id
          WHERE s.subject_id = ?${opts.archived === true ? "" : " AND m.archived = 0"}
          ORDER BY s.memory_id`,
        subjectId,
      )
      .map((r) => r.memory_id);
  }

  /**
   * EVERY LIVE ROW deliberate recall's facts mode can answer with (Release B,
   * 2026-10-03), in one read: memories, episodes and schemas that are not
   * archived, not superseded and not a tombstone, with the columns facts mode
   * ranks and labels by — never a body. One query for the whole store, so a
   * question's pool is matched in memory rather than with a row read per
   * candidate. A read; nothing here crosses the write seam.
   */
  recallRows(): RecallRow[] {
    const v12 = this.hasColumn("memories", "occurred_on");
    return this.ops.all<RecallRow>(
      `SELECT id, type, kind, title, learned_on, created_at, updated_at,
              ${v12 ? "occurred_on, said_by, status" : "NULL AS occurred_on, NULL AS said_by, NULL AS status"},
              source, origin_session, origin_scope, origin_ref, confidential,
              CASE WHEN type = 'memory' THEN NULL ELSE meta END AS meta
         FROM memories
        WHERE archived = 0 AND superseded_by IS NULL AND NOT (body = '' AND content_hash = '')
        ORDER BY id`,
    );
  }

  /**
   * The words of every memory with words — live and archived, never a
   * tombstone — for a scan that must look at all of them once (a card's
   * birth, the v12 backfill). Ids, titles and bodies only.
   */
  memoryTexts(): { id: string; title: string | null; body: string }[] {
    return this.ops.all<{ id: string; title: string | null; body: string }>(
      "SELECT id, title, body FROM memories WHERE type = 'memory' AND body != '' ORDER BY id",
    );
  }

  /** How many subject links there are, and on how many memories (v12). Null without the table. */
  subjectLinkCount(): { links: number; memories: number; subjects: number } | null {
    if (!this.hasTable("memory_subjects")) return null;
    const row = this.ops.get<{ links: number; memories: number; subjects: number }>(
      "SELECT COUNT(*) AS links, COUNT(DISTINCT memory_id) AS memories, COUNT(DISTINCT subject_id) AS subjects FROM memory_subjects",
    );
    return { links: row?.links ?? 0, memories: row?.memories ?? 0, subjects: row?.subjects ?? 0 };
  }

  /**
   * DOCTOR'S `Write fields` READING (v12): of the memories written since
   * `since` (UTC ms; null = all) by a door that takes the writer's three
   * fields — `note`, `session_end` (its write-ups too), a dream's gist — how
   * many carry each. A dream's MERGE is left out (its words are a dream's,
   * its `source` the strongest original's, and it takes no fields), as are
   * chapter copies, the sweep and reflection entries. Null when this file has
   * no v12 columns yet.
   */
  writeFieldShare(since: number | null): { written: number; occurredOn: number; saidBy: number; status: number; all: number } | null {
    if (!this.hasColumn("memories", "occurred_on")) return null;
    const row = this.ops.get<{ written: number; occurred_on: number; said_by: number; status: number; all_three: number }>(
      `SELECT COUNT(*) AS written,
              COALESCE(SUM(occurred_on IS NOT NULL), 0) AS occurred_on,
              COALESCE(SUM(said_by IS NOT NULL), 0) AS said_by,
              COALESCE(SUM(status IS NOT NULL), 0) AS status,
              COALESCE(SUM(occurred_on IS NOT NULL AND said_by IS NOT NULL AND status IS NOT NULL), 0) AS all_three
         FROM memories
        WHERE type = 'memory' AND body != ''
          AND (source = 'dreamed' OR (source = 'authored' AND (origin_ref IS NULL OR origin_ref NOT LIKE 'dream:%')))
          AND (? IS NULL OR created_at >= ?)`,
      since,
      since,
    );
    return {
      written: row?.written ?? 0,
      occurredOn: row?.occurred_on ?? 0,
      saidBy: row?.said_by ?? 0,
      status: row?.status ?? 0,
      all: row?.all_three ?? 0,
    };
  }

  private readonly tablesSeen = new Set<string>();

  private traitReads(rows: (TraitRow & { confidential: number })[], includeConfidential: boolean): TraitRead[] {
    return rows.map((r) => {
      const confidential = r.confidential === 1;
      const withheld = confidential && !includeConfidential;
      return {
        id: r.id,
        memory_id: r.memory_id,
        axis: r.axis,
        toward: r.toward,
        strength: r.strength,
        carried_by: withheld ? "" : r.carried_by,
        source: r.source,
        model: r.model,
        created_at: r.created_at,
        updated_at: r.updated_at,
        confidential,
        withheld,
      };
    });
  }

  /**
   * A memory's trait nudges, oldest first (then in the order written). A
   * removed memory has none. Works under observer. Confidentiality: above.
   */
  traitsFor(memoryId: string, opts: { includeConfidential?: boolean } = {}): TraitRead[] {
    if (!this.hasTable("traits")) return [];
    const rows = this.ops.all<TraitRow & { confidential: number }>(
      `SELECT t.*, m.confidential AS confidential FROM traits t JOIN memories m ON m.id = t.memory_id
        WHERE t.memory_id = ? ORDER BY t.created_at, t.rowid`,
      memoryId,
    );
    return this.traitReads(rows, opts.includeConfidential === true);
  }

  /**
   * The nudges on several memories in ONE query, keyed by memory id; ids with
   * none are simply absent. Works under observer. Confidentiality: above.
   */
  traitsOn(ids: readonly string[], opts: { includeConfidential?: boolean } = {}): Map<string, TraitRead[]> {
    const out = new Map<string, TraitRead[]>();
    if (ids.length === 0 || !this.hasTable("traits")) return out;
    const unique = [...new Set(ids)];
    for (let at = 0; at < unique.length; at += 500) {
      const part = unique.slice(at, at + 500);
      const rows = this.ops.all<TraitRow & { confidential: number }>(
        `SELECT t.*, m.confidential AS confidential FROM traits t JOIN memories m ON m.id = t.memory_id
          WHERE t.memory_id IN (${part.map(() => "?").join(",")})
          ORDER BY t.created_at, t.rowid`,
        ...part,
      );
      for (const r of this.traitReads(rows, opts.includeConfidential === true)) {
        const list = out.get(r.memory_id) ?? [];
        list.push(r);
        out.set(r.memory_id, list);
      }
    }
    return out;
  }

  /**
   * EVERY NUDGE, each with its memory id — what the dashboard draws each
   * axis's balance from (it weighs them by the memory's firmness itself).
   * By default only nudges on LIVE memories (not archived, not superseded):
   * a merged original's nudges were carried onto the merged memory, and
   * counting both would count the moment twice. `live: false` reads them all.
   * `sinceMs` (the store's clock, UTC ms) narrows to nudges recorded since.
   * Oldest first. Works under observer. Confidentiality: above.
   */
  traitsAll(opts: { includeConfidential?: boolean; live?: boolean; sinceMs?: number } = {}): TraitRead[] {
    if (!this.hasTable("traits")) return [];
    const live = opts.live !== false;
    const rows = this.ops.all<TraitRow & { confidential: number }>(
      `SELECT t.*, m.confidential AS confidential FROM traits t JOIN memories m ON m.id = t.memory_id
        WHERE t.created_at >= ?${live ? " AND m.archived = 0 AND m.superseded_by IS NULL" : ""}
        ORDER BY t.created_at, t.rowid`,
      opts.sinceMs ?? Number.MIN_SAFE_INTEGER,
    );
    return this.traitReads(rows, opts.includeConfidential === true);
  }

  /**
   * THE TRAIT CENSUS, counts only: live memories carrying at least one
   * nudge, and the nudges on them — both narrowed to nudges recorded at or
   * after `sinceMs` when it is given. No word and no axis leaves here.
   */
  traitCensus(opts: { sinceMs?: number } = {}): { memories: number; nudges: number } {
    if (!this.hasTable("traits")) return { memories: 0, nudges: 0 };
    const row = this.ops.get<{ memories: number | null; nudges: number | null }>(
      `SELECT COUNT(DISTINCT t.memory_id) AS memories, COUNT(*) AS nudges
         FROM traits t JOIN memories m ON m.id = t.memory_id
        WHERE t.created_at >= ? AND m.archived = 0 AND m.superseded_by IS NULL`,
      opts.sinceMs ?? Number.MIN_SAFE_INTEGER,
    );
    return { memories: row?.memories ?? 0, nudges: row?.nudges ?? 0 };
  }

  versions(id: string): VersionRow[] {
    return this.ops.all<VersionRow>(
      "SELECT * FROM versions WHERE memory_id = ? ORDER BY seq",
      id,
    );
  }

  /** Reading a superseded/archived version is an event (§5 G13). */
  readVersion(id: string, seq: number): ProseDoc {
    // The version row survives a removal as a lineage pointer with its content
    // pointers blanked; reading it is refused by name, never by ENOENT.
    this.refuseIfDenied(id);
    const row = this.ops.get<VersionRow>(
      "SELECT * FROM versions WHERE memory_id = ? AND seq = ?",
      id,
      seq,
    );
    if (row === undefined) throw new StoreError("VERSION_UNKNOWN", { id, seq });
    this.emit("store.version.read", id, { seq, reason: row.reason });
    return this.versionDoc(id, row);
  }

  /**
   * Rows whose WORDS WENT MISSING — `body = ''` with a content hash that still
   * names them. Ids only; never a body (§5 G10).
   *
   * The fault `MEMORY_BODY_MISSING` is raised for, counted. It is not a
   * tombstone (both halves blank, the owner's removal) and no write path in
   * this build produces it: `put` and `revise` both refuse an empty body, and
   * the chase blanks the pair together. So a non-empty answer means something
   * happened to the store underneath itself.
   *
   * It exists because the fault stands EVERY session down while `status` and
   * `verify` both read green, and doctor's red line named the class and not the
   * row — so the owner could not find which of thousands of rows to act on
   * (review B, MAJOR-3). A read; nothing here crosses the write seam.
   */
  faultedIds(): string[] {
    return this.ops
      .all<{ id: string }>(
        "SELECT id FROM memories WHERE body = '' AND content_hash <> '' ORDER BY id",
      )
      .map((r) => r.id);
  }

  edgesFrom(src: string): EdgeRow[] {
    return this.ops.all<EdgeRow>("SELECT * FROM edges WHERE src = ? ORDER BY dst", src);
  }

  /** Every edge row, for a census (doctor's Association line, 2026-09-28). A read. */
  allEdges(): EdgeRow[] {
    return this.ops.all<EdgeRow>("SELECT * FROM edges ORDER BY src, dst");
  }

  /**
   * Live MEMORY rows written at or after a moment (`created_at`, UTC ms), with
   * their session and their place in write order — temporal contiguity's read
   * (association build 2, 2026-09-28). Ids, sessions, moments and days only.
   * Rows with no session, no moment (pre-v7), archived or superseded are left
   * out: contiguity links what one session made, in the order it made it.
   *
   * `nightly` marks a row the NIGHTLY RUN wrote (review of #281, finding 1): a
   * dream's gist or merge, a reflection's entry. They carry the launching
   * session's id, but the session did not make them, so contiguity counts them
   * and links nothing to them. Marked by origin (`dream:` / `reflection:`,
   * which catches merges too, whose `source` is their best source's) and by
   * source (`dreamed` / `reflection`), in case a later writer keeps one and
   * not the other.
   */
  memoriesWrittenSince(at: number): { id: string; session: string; at: number; bornDay: number; nightly: boolean }[] {
    return this.ops
      .all<{ id: string; origin_session: string; created_at: number; birth_day: number; nightly: number }>(
        `SELECT id, origin_session, created_at, birth_day, ${NIGHTLY_SQL} AS nightly FROM memories
          WHERE type = 'memory' AND created_at >= ? AND origin_session IS NOT NULL
            AND archived = 0 AND superseded_by IS NULL
          ORDER BY created_at, rowid`,
        at,
      )
      .map((r) => ({ id: r.id, session: r.origin_session, at: r.created_at, bornDay: r.birth_day, nightly: r.nightly === 1 }));
  }

  /**
   * WHAT EACH DIRECTORY WROTE SINCE A MOMENT, as COUNTS (2026-10-10, the
   * wake's "Today, elsewhere" line): live memories by `origin_scope`, born at
   * or after `at` (epoch ms), not the nightly run's (`NIGHTLY_SQL`), and not
   * confidential unless `confidential`. Numbers only — no id, no title, no
   * word of any memory leaves this read. Largest first, then the scope.
   */
  memoryCountsByScopeSince(at: number, opts: { confidential?: boolean } = {}): { scope: string; count: number }[] {
    return this.ops
      .all<{ origin_scope: string; n: number }>(
        `SELECT origin_scope, COUNT(*) AS n FROM memories
          WHERE type = 'memory' AND created_at IS NOT NULL AND created_at >= ? AND origin_scope IS NOT NULL AND origin_scope != ''
            AND archived = 0 AND superseded_by IS NULL AND NOT ${NIGHTLY_SQL}
            ${opts.confidential === true ? "" : "AND confidential = 0"}
          GROUP BY origin_scope
          ORDER BY n DESC, origin_scope`,
        at,
      )
      .map((r) => ({ scope: r.origin_scope, count: r.n }));
  }

  /**
   * THE OPEN QUESTIONS, by id (2026-10-10): live memories whose meta says
   * `unresolved` — what the wake's "Still open:" lane is drawn from, read at
   * session start without the full scan (`self/#assemble`). The SQL match is
   * the loose text match `planCandidates` uses, and the caller confirms on the
   * prose. Answered by the partial index `memories_open` where the store has
   * it (a fresh store, or one upgraded to v13, which it rides); a plain scan
   * of one column where it does not. Oldest-born first, then id.
   */
  openThreadIds(): string[] {
    return this.ops
      .all<{ id: string }>(
        `SELECT id FROM memories
          WHERE type = 'memory' AND archived = 0 AND meta LIKE '%"unresolved":true%'
          ORDER BY birth_day, id`,
      )
      .map((r) => r.id);
  }

  /** The same rows for ONE session, in write order — the neighbours a newly
   *  written memory sits beside (2026-09-28). The nightly run's rows are left
   *  out, so a note made after the dream sits next to the note made before
   *  it (finding 1 of the review of #281). */
  memoriesOfSession(session: string): { id: string; session: string; at: number; bornDay: number }[] {
    return this.ops
      .all<{ id: string; origin_session: string; created_at: number; birth_day: number }>(
        `SELECT id, origin_session, created_at, birth_day FROM memories
          WHERE type = 'memory' AND origin_session = ? AND created_at IS NOT NULL
            AND archived = 0 AND superseded_by IS NULL AND NOT ${NIGHTLY_SQL}
          ORDER BY created_at, rowid`,
        session,
      )
      .map((r) => ({ id: r.id, session: r.origin_session, at: r.created_at, bornDay: r.birth_day }));
  }

  prospectiveFor(id: string): ProspectiveRow[] {
    return this.ops.all<ProspectiveRow>(
      "SELECT * FROM prospective WHERE memory_id = ? ORDER BY window_key",
      id,
    );
  }

  /**
   * Every memory id that has at least one firing-state row, sorted. The exit
   * accounting's other half (prospective §5 G12): a row can outlive its
   * memory's date — a date cleared by `revise`, a reschedule's retired window —
   * and `datedMemories` alone would never find it.
   */
  prospectiveMemoryIds(): string[] {
    return this.ops
      .all<{ memory_id: string }>("SELECT DISTINCT memory_id FROM prospective ORDER BY memory_id")
      .map((r) => r.memory_id);
  }

  removalRecord(id?: string): RemovalRow[] {
    const rows =
      id === undefined
        ? this.ops.all<RemovalRow>("SELECT * FROM removal_record ORDER BY seq")
        : this.ops.all<RemovalRow>(
            "SELECT * FROM removal_record WHERE memory_id = ? ORDER BY seq",
            id,
          );
    this.emit("store.removalRecord.read", id, { rows: rows.length });
    return rows;
  }

  /**
   * What removal left behind, joined into one row per removed memory: the
   * tombstone's flags and counts, the latest stage of its record, and whether a
   * skeleton row survives in `memories`.
   *
   * This is the read that keeps scar §2.19 true from the other side — "everything
   * permanent is enumerable and inspectable" has to survive the one operation
   * that ends permanence, or a removed protected element simply vanishes from
   * the list and nobody can tell it apart from one that was never there.
   *
   * PURE and emit-free, unlike `removalRecord()`: `self.enumerate` calls it on
   * every enumeration, and an enumeration that logged would stop being a read
   * (§14.1 G8).
   */
  tombstones(): Tombstone[] {
    const rows = this.ops.all<
      TombstoneRow & { last_stage: string | null; row_survives: number }
    >(
      `SELECT t.*,
              (SELECT r.stage FROM removal_record r
                WHERE r.memory_id = t.memory_id ORDER BY r.seq DESC LIMIT 1) AS last_stage,
              (SELECT COUNT(*) FROM memories m WHERE m.id = t.memory_id) AS row_survives
         FROM removal_tombstone t
        ORDER BY t.memory_id`,
    );
    return rows.map((r) => ({
      id: r.memory_id,
      type: r.type,
      kind: r.kind,
      band: r.band,
      wasProtected: r.protected === 1,
      wasPromotedIdentity: r.promoted_identity === 1,
      supersededBy: r.superseded_by,
      stage: (r.last_stage ?? "dark") as RemovalNote["stage"],
      at: r.at,
      rowSurvives: r.row_survives > 0,
      chased: {
        versions: r.versions,
        edges: r.edges,
        prospective: r.prospective,
        gateRows: r.gate_rows,
      },
    }));
  }

  /** Ids a removal has taken dark: consulted at load and at rebuild (§16 G12). */
  deniedIds(): string[] {
    return this.ops
      .all<{ memory_id: string }>(
        "SELECT DISTINCT memory_id FROM removal_record WHERE stage IN ('dark', 'chased', 'complete')",
      )
      .map((r) => r.memory_id);
  }

  /**
   * The token channel's read. `norm` is the document-length normalization
   * (`cache.ts#LengthNorm`); recall passes its own CAL values, and the two
   * callers that are not recall take the default.
   */
  search(cue: string, limit = 10, norm: LengthNorm = DEFAULT_LENGTH_NORM, opts: { minStrength?: number } = {}): Hit[] {
    // `minStrength` (2026-10-10): the ambient prefilter — below-reach rows, as
    // the last decay pass read them, take no slot (`cache.ts#reachJoin`).
    return searchIndex(this.cache, cue, limit, norm, opts.minStrength ?? null);
  }

  /**
   * How many indexed documents hold each token — the rarity denominator.
   *
   * Separate from `search` on purpose: `search` returns a bounded TOP-K, and a
   * top-K's length is `min(trueDf, k)`, not a document frequency. Reading it as
   * one is the measurement error `cache.ts#docFrequency` documents.
   */
  docFrequency(tokens: readonly string[]): Map<string, number> {
    return docFrequency(this.cache, tokens);
  }

  nearestTo(vec: readonly number[], limit = 10, opts: { minStrength?: number } = {}): Hit[] {
    // A held mismatch ranks nothing: the rows are another model's, and a
    // cosine across two models is a number that means nothing (§2.15). A cache
    // from a newer build ranks nothing either: its vectors are not this
    // build's to interpret.
    if (!this.rankable(vec.length, "nearestTo")) return [];
    return nearest(this.cache, vec, limit, opts.minStrength ?? null);
  }

  /**
   * NEIGHBOURS BY ID, FOR MANY QUERIES (2026-10-10, Lane 0 / scale review C1).
   * Returns a reader: `read(id, limit)` is `id`'s nearest memories by vector,
   * nearest first, never `id` itself — read from box 3's `neighbours` table,
   * which the write path fills (`indexOne`). A memory with no stored list (one
   * written before v6, or whose vector came by backfill) is ranked here, against
   * the embedding table read ONCE per reader however many ids miss, and the
   * list is written back so the next night reads it. Null when `id` has no
   * vector or this handle may not rank (the caller falls back to words).
   *
   * Before this, the dream's `begin` re-read and re-ranked the whole table once
   * per queued memory: 299 ms at today's size, 22 s at 10x (13-scale.md).
   */
  neighbourReader(): (id: string, limit: number) => string[] | null {
    let table: { id: string; vec: Float32Array | number[] }[] | null = null;
    return (id, limit) => {
      const vec = this.vectorOf(id);
      if (vec === null) return null;
      // A vector this handle may not rank against ranks nothing — as
      // `nearestTo` answered here before: an empty list, not the word fallback.
      if (!this.rankable(vec.length, "neighbourReader")) return [];
      const stored = readNeighbours(this.cache, id, limit);
      // A stored list shorter than asked is still the whole list when the
      // table was that small; a short list from a store that has grown since
      // is not wrong either — what it lacks is NEWER than the memory, which
      // the dream does not show as a neighbour.
      if (stored !== null) return stored.map((h) => h.id);
      table ??= allVectors(this.cache);
      const hits = rankAgainst(table, vec, NEIGHBOURS_KEPT + 1).filter((h) => h.id !== id);
      if (!this.observer) {
        try {
          writeNeighbours(this.cache, id, hits);
        } catch {
          /* box 3 is best-effort: the list is recomputed next time */
        }
      }
      return hits.slice(0, limit).map((h) => h.id);
    };
  }

  /**
   * The vectors of the `limit` memories nearest `vec` — E(m), the context a
   * novelty measurement is prediction error AGAINST (physics §5.1). Read-only,
   * box 3 only, and it strengthens nothing: this is an instrument's read.
   *
   * Returns fewer than `limit` (or none) whenever box 3 holds fewer vectors,
   * which is the ordinary state of a store whose embedder is switched off — and
   * `computeNovelty` turns that emptiness into `blind-no-context` rather than a
   * number, which is the whole point of asking it this way.
   */
  neighbourVectors(vec: readonly number[], limit = 10): number[][] {
    if (!this.rankable(vec.length, "neighbourVectors")) return [];
    return nearestVectors(this.cache, vec, limit);
  }

  /**
   * The identity box 3 records for its vectors RIGHT NOW — read fresh, one
   * primary-key read — when THIS handle may rank against them; null otherwise
   * (a hold, a newer build's cache, a file now another identity's than this
   * handle's, or no tag at all).
   *
   * It is what recall calibrates the semantic channel by (`recall/tunables.ts`
   * `SEMANTIC_BY_IDENTITY`, keyless/recall-tune): the file's tag rather than the
   * handle's open-time verdict, so a handle whose open was `deferred` (lost the
   * lock) or that has no identity of its own still gets the calibration of the
   * vectors it actually ranks — and a handle whose file moved to another model
   * gets null, the defaults, while its ranking is refused anyway.
   */
  rankingIdentity(): string | null {
    const v = this.embedderVerdict.kind;
    if (v === "held" || v === "cache-ahead") return null;
    try {
      if (searchRefusal(this.cache, this.identity, this.identity?.dim ?? 0) !== null) return null;
      return recordedEmbedder(this.cache)?.tag ?? null;
    } catch {
      return null;
    }
  }

  /**
   * May this handle take a cosine against box 3 RIGHT NOW? The at-open
   * verdict first (held, ahead), then the FILE's claim read fresh against this
   * handle's identity (`cache.ts#searchRefusal`) — one primary-key read, the
   * per-call pattern #187 uses for the schema stamp. A refusal is an event with
   * its reason, and an empty answer, never a cosine across two models.
   */
  private rankable(dim: number, site: string): boolean {
    const v = this.embedderVerdict.kind;
    if (v === "held" || v === "cache-ahead") return false;
    const refused = searchRefusal(this.cache, this.identity, dim);
    if (refused === null) return true;
    this.emit("cache.vector.refused", undefined, { site, reason: refused });
    return false;
  }

  livedDay(): number {
    return Number(this.getMeta("livedDay") ?? "0");
  }

  getMeta(key: string): string | undefined {
    return this.ops.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private requireRow(id: string): MemoryRow {
    // The deny-list answers FIRST, and answers even after the chase has taken
    // the row away: a removed id must never come back as "no such memory", and
    // never as an ENOENT on the prose file that used to hold it.
    this.refuseIfDenied(id);
    const row = this.row(id);
    if (row === undefined) throw new StoreError("ID_UNKNOWN", { id });
    return row;
  }

  /** Emit-free (§14.1 G8: reads are pure) — this is called on every read path. */
  private isDenied(id: string): boolean {
    const denied = this.ops.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM removal_record WHERE memory_id = ? AND stage IN ('dark','chased','complete')",
      id,
    );
    return (denied?.n ?? 0) > 0;
  }

  private refuseIfDenied(id: string): void {
    if (this.isDenied(id)) throw new StoreError("REMOVED", { id, by: "owner" });
  }

  /** Runs INSIDE the caller's transaction. One INSERT; there is nothing to publish. */
  private insertOne(input: PutInput): ProseDoc {
    const id = input.id ?? newId(input.type);
    // Both id checks BEFORE the row: the shape rule used to live in
    // `serializeProse`, which ran while the file was staged and so refused
    // before anything had been written. It has to keep refusing first.
    assertIdWellFormed(id);
    if (!id.startsWith(`${ID_PREFIX[input.type]}_`)) {
      throw new StoreError("ID_MALFORMED", { id, type: input.type });
    }
    // A removed id is taken FOREVER. Ids are never reused (§4.2 G2), and the one
    // reuse that would matter is the one that quietly resurrects what the owner
    // removed — so the deny-list is consulted at birth as well as at read.
    if (this.has(id) || this.isDenied(id)) throw new StoreError("ID_TAKEN", { id });
    // NORMALISED AND CHECKED BEFORE THE ROW. `bodyForStorage` is the one rule
    // both write doors share: whitespace-only is empty, and a lone surrogate is
    // folded to what SQLite will actually store so the hash below addresses the
    // bytes that land (review B, MINOR-4/-5).
    const body = bodyForStorage(input.body, id);
    const day = this.livedDay();
    // Source and origin mirror into the prose meta: the document is canonical
    // and self-describing; the columns are the query surface for the same fact.
    const meta: Record<string, unknown> = { ...(input.meta ?? {}) };
    if (input.source !== undefined) meta["source"] = input.source;
    if (input.origin !== undefined) {
      const origin: Record<string, string> = {};
      if (input.origin.session !== undefined) origin["session"] = input.origin.session;
      if (input.origin.scope !== undefined) origin["scope"] = input.origin.scope;
      if (input.origin.ref !== undefined) origin["ref"] = input.origin.ref;
      if (input.origin.spanHash !== undefined) origin["spanHash"] = input.origin.spanHash;
      if (Object.keys(origin).length > 0) meta["origin"] = origin;
    }
    const eventDate = input.eventDate === undefined ? undefined : assertEventDate(input.eventDate, id);
    // ONE MOMENT for the row, and `learned_on` is its local date unless the
    // caller dated the memory itself (mint dates a deposit by its own instant).
    const at = this.nowFn();
    const doc: ProseDoc = {
      id,
      type: input.type,
      learnedOn: input.learnedOn ?? localDate(at, this.zone()),
      bornDay: input.physics?.birthDay ?? day,
      meta,
      body,
    };
    if (input.title !== undefined) doc.title = input.title;
    if (input.happenedOn !== undefined) doc.happenedOn = input.happenedOn;
    if (eventDate !== undefined) doc.eventDate = eventDate;
    // Serialized (and so G6-checked) BEFORE the INSERT, for the same reason:
    // a function or a NaN in `meta` is silent data loss, and the refusal must
    // land while nothing has been written.
    const metaJson = serializeMeta(meta, id);
    const contentHash = hashText(doc.body);
    const s: Salience = {
      novelty: input.salience?.novelty ?? null,
      relevance: input.salience?.relevance ?? 0,
      emotional: input.salience?.emotional ?? 0,
      predictive: input.salience?.predictive ?? 0,
      claimed: input.salience?.claimed ?? null,
    };
    this.ops.run(
      `INSERT INTO memories (
         id, type, kind, band, band_day, novelty, relevance, emotional, predictive,
         claimed, birth_day, uses, last_used_day, reinforced_days, consolidated,
         promoted_identity, protected, pressure, last_challenged_day, archived,
         archived_reason, superseded_by, revision, content_hash,
         learned_on, happened_on, source, origin_session, origin_scope, origin_ref,
         title, body, meta, confidential, created_at, updated_at, model, event_date, legacy,
         about, about_by, occurred_on, said_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.type,
      input.kind,
      input.band ?? "episodic",
      day,
      s.novelty,
      s.relevance,
      s.emotional,
      s.predictive,
      s.claimed ?? null,
      doc.bornDay,
      input.physics?.uses ?? 0,
      input.physics?.lastUsedDay ?? day,
      input.physics?.reinforcedDays ?? 0,
      input.physics?.consolidated ? 1 : 0,
      input.physics?.promotedIdentity ? 1 : 0,
      input.physics?.protected ? 1 : 0,
      input.physics?.pressure ?? 0,
      input.physics?.lastChallengedDay ?? null,
      contentHash,
      doc.learnedOn,
      doc.happenedOn ?? null,
      input.source ?? null,
      input.origin?.session ?? null,
      input.origin?.scope ?? null,
      input.origin?.ref ?? null,
      doc.title ?? null,
      doc.body,
      metaJson,
      confidentialByMeta(meta) ? 1 : 0,
      at,
      at,
      modelOrNull(input.model),
      doc.eventDate ?? null,
      // v8: only a caller carrying a pre-upgrade memory's physics forward (a
      // dream merge of legacy rows) sets it; every new memory is post-upgrade.
      input.physics?.legacy === true ? 1 : 0,
      input.about !== undefined && aboutMarkOf(input.about) !== null ? input.about : null,
      input.about !== undefined && aboutMarkOf(input.about) !== null ? (input.aboutBy ?? "writer") : null,
      // v12: the writer's three fields. Unreadable or unknown writes NULL —
      // the belt; the doors drop them with a note before they get here.
      input.occurredOn === undefined ? null : occurredOnOf(input.occurredOn),
      input.saidBy === undefined ? null : saidByOf(input.saidBy),
      input.status === undefined ? null : statusOf(input.status),
    );
    // v12: WHAT IT NAMES, linked in the same transaction as the row — every
    // door that writes a memory passes here (a note, a session's dump, a
    // write-up, the sweep, a chapter copy, a dream's merge or gist, a
    // reflection's entry), so no door can forget. Memories only.
    if (input.type === "memory") this.relinkSubjects(id, doc.title ?? null, doc.body, "write");
    return doc;
  }

  /**
   * A row read as the document it is.
   *
   * THE READ SEAM, and the reason nothing above `store/` noticed the floor
   * move: `ProseDoc` is the shape it always was, assembled from columns now
   * instead of parsed out of a file's frontmatter.
   *
   * The body check is the fault `PROSE_FILE_MISSING` used to be. A blank body
   * beside a blank hash is a TOMBSTONE — the owner removed this — and never
   * reaches here through a read, because the deny-list refuses the id by name
   * first (`requireRow`); a blank body beside a real hash is a row whose words
   * went missing underneath the store, which no write path in this module
   * produces and which is worth a loud, named refusal rather than an empty
   * memory that reads as if it said nothing.
   */
  private docOf(row: MemoryRow): ProseDoc {
    if (row.body.length === 0) {
      throw new StoreError("MEMORY_BODY_MISSING", {
        id: row.id,
        tombstoned: rowTombstoned(row),
      });
    }
    const doc: ProseDoc = {
      id: row.id,
      type: row.type,
      learnedOn: row.learned_on,
      bornDay: row.birth_day,
      meta: parseMeta(row.meta, row.id),
      body: row.body,
    };
    if (row.title !== null) doc.title = row.title;
    if (row.happened_on !== null) doc.happenedOn = row.happened_on;
    if (row.event_date !== null) doc.eventDate = row.event_date;
    return doc;
  }

  /**
   * An archived version read as the document it was.
   *
   * `title`, `body`, `meta` and the two PROVENANCE dates come from the version
   * row, because all five can be revised and the version is what they were;
   * `type` and `bornDay` come from the live row, because neither can (an id's
   * prefix pins its family, and a birth day is physics, not content).
   */
  private versionDoc(id: string, version: VersionRow): ProseDoc {
    if (version.body.length === 0) {
      throw new StoreError("MEMORY_BODY_MISSING", { id, seq: version.seq });
    }
    const head = this.row(id);
    const doc: ProseDoc = {
      id,
      type: head?.type ?? "memory",
      learnedOn: version.learned_on,
      bornDay: head?.birth_day ?? 0,
      meta: parseMeta(version.meta, id),
      body: version.body,
    };
    if (version.title !== null) doc.title = version.title;
    if (version.happened_on !== null) doc.happenedOn = version.happened_on;
    if (version.event_date !== null) doc.eventDate = version.event_date;
    return doc;
  }

  /**
   * Give every live memory its vector, in-process, right now — the INLINE half
   * of the identity check, for an embedder whose sync face computes (a static
   * table). Not a public door: it runs from the constructor, after a reset or
   * a first tag, and only there.
   *
   * Batched: one box-3 transaction per `REFILL_BATCH` rows, because box 3 runs
   * `synchronous = FULL` and a commit per row is an fsync per row. Bounded by
   * `REFILL_BUDGET_MS` between batches: the first open after a switch is often
   * a hook, and a store too large to refill inside the budget is finished by
   * the worker's backfill rather than holding the hook. Reports what it did.
   */
  private refillVectorsInline(): void {
    const embed = this.embed;
    if (embed === undefined) return;
    // A BUDGET timer, not a clock: `performance.now()` is monotonic and dates
    // nothing, so the provenance rule (one ambient `Date.now` in this file,
    // `two-clocks.test.ts`) is untouched.
    const t0 = performance.now();
    const ids = this.missingVectors(Number.MAX_SAFE_INTEGER);
    let embedded = 0;
    let skipped = 0;
    let at = 0;
    while (at < ids.length && performance.now() - t0 < REFILL_BUDGET_MS) {
      const batch = ids.slice(at, at + REFILL_BATCH);
      at += batch.length;
      this.cache.transaction(() => {
        for (const id of batch) {
          let doc: ProseDoc;
          try {
            doc = this.readProse(id);
          } catch {
            skipped += 1;
            continue;
          }
          // `missingVectors` already leaves out every `noVector` row; asked again
          // here because this is a write path, and every write path asks.
          const vec = noVector(doc.type, doc.meta["role"]) ? null : embed(indexText(doc));
          if (vec === null) {
            skipped += 1;
            continue;
          }
          if (setEmbedding(this.cache, id, vec) !== null) {
            skipped += 1;
            continue;
          }
          embedded += 1;
        }
      });
    }
    this.emit("cache.embedder.refilled", undefined, {
      embedded,
      skipped,
      remaining: ids.length - at,
      ms: Math.round(performance.now() - t0),
    });
  }

  /**
   * Box 3 is best-effort by design: it is rebuildable, so it never fails a
   * write.
   *
   * **This is where `noVector` has to be asked, and the backfill is the second
   * place and not the first.** The live adapter wires a SYNC embedder
   * (`claude-code/index.ts`), so every `put` and `revise` embeds here, at write
   * time, long before `unembeddedIds` is consulted — a filter only on the
   * backfill leaves the write path handing the whole body to an embedder. That
   * was measured, with a stub, before it was fixed.
   *
   * The TOKENS are still written either way. A row nobody should embed is still
   * a row the OWNER should be able to find: the dashboard's search, the console
   * `remove` flow and `expandHandle`'s exact-title match all read the lexical
   * index, and none of them is a recall candidate path.
   */
  private indexOne(doc: ProseDoc): void {
    const text = indexText(doc);
    const vec = this.embed && !noVector(doc.type, doc.meta["role"]) ? this.embed(text) : null;
    if (vec === null) {
      indexDoc(this.cache, doc.id, text);
      return;
    }
    // The per-write check (re-review MAJOR A): a long-lived handle whose file
    // now names another identity writes the words and NOT the vector, leaving
    // the memory for the owning identity's backfill.
    const refused = indexDoc(this.cache, doc.id, text, vec);
    if (refused !== null) {
      this.emit("cache.vector.refused", doc.id, { site: "put", reason: refused });
      return;
    }
    // ITS NEIGHBOURS, NOW (v6, Lane 0 / scale review C1): the memories nearest
    // it as the store stands — all of them older than it — kept so the dream
    // reads them instead of scanning the table once per queued memory.
    // Decided by lane0-builder, 2026-10-10, lightly held; revisit after ~5 lived days. Why: one more scan per write (~1 ms now, ~12 ms at 10x) rather than threading ids through the gate's novelty read (`bridge.ts`), which runs before the memory has an id; the reuse can come with interference's slot check.
    try {
      if (this.rankable(vec.length, "neighbours")) {
        writeNeighbours(this.cache, doc.id, nearest(this.cache, vec, NEIGHBOURS_KEPT + 1));
      }
    } catch {
      /* box 3 is best-effort: the dream ranks it when it asks */
    }
  }
}

/**
 * The string box 3 indexes for a document — and therefore the string a CALLER
 * must embed if it wants its vector to be the one this store looks up at `put`
 * time. Exported for exactly that: `counterpart.ts` composes it from a
 * proposal's title and its GATED content before the memory exists, so one live
 * call serves both the novelty seam and box 3.
 *
 * The word gated is the whole contract. This function is a pure join, so it
 * cannot enforce which content it is handed — a caller that composes it from the
 * author's raw draft will cache under a key `indexOne` never asks for, and every
 * redaction or hedge silently costs the deposit its vector. The ordering that
 * makes it true lives in `bridge.batteryGate`, and a test asserts it.
 */
export function indexTextOf(title: string | null | undefined, body: string): string {
  return [title ?? "", body].join("\n");
}

function indexText(doc: ProseDoc): string {
  return indexTextOf(doc.title, doc.body);
}

/**
 * What to TELL somebody whose directory holds pre-rows names — and, when it is
 * ambiguous, what not to tell them.
 *
 * Three cases, and the middle one is the finding this exists for (review A,
 * MAJOR-1). The PRE-FLOOR build's `Store` constructor — the one tagged
 * `floor/v5-last`, and what a stale worktree or an un-deployed checkout still
 * runs — mkdirs `prose/`, `versions/`, `tmp/`
 * and mints `operational.sqlite` BEFORE it reaches `assertLayout()`, so **one**
 * old-build SessionStart hook on a v6 store leaves every marker behind. That is
 * the rollback the cut-over plan actually calls for, and after it the new build
 * refuses its own store for ever while telling the owner it is "readable by
 * floor/v5-last" — the build that just stood down on the same directory. Both
 * builds dead, and nothing saying which four names to remove.
 *
 * **The discrimination is by LISTING, never by opening** — see
 * `preRowsLeftoversAreEmpty`. An old build's leftovers are EMPTY `prose/` and
 * `versions/`; a real v5 store's are not, and a directory that has both names
 * because somebody hand-copied a `counterparts.sqlite` into a v5 store is
 * holding every memory he has under `prose/`. "Remove those four" is the right
 * instruction for the first and a catastrophe for the second, so the sentence
 * asks before it says it. **Nothing here deletes anything**; the owner does.
 */
function preRowsRemedy(
  dir: string,
  found: readonly string[],
): { readableBy: string } | { alsoFound: string; remedy: string } {
  if (!existsSync(paths.operational(dir))) return { readableBy: PRE_ROWS_READABLE_BY };
  const leftovers = found.filter((n) => n !== DATABASE_FILE).join(", ");
  // MOVE ASIDE, NEVER REMOVE — and that is what makes the guess below safe to
  // get wrong (third review, NEW-MINOR-2). By LISTING alone an old build's
  // empty leftovers and a REAL v5 store whose `prose/` somebody moved out look
  // identical: both have an empty `prose/` and an `operational.sqlite`, and the
  // second one's database holds every memory's physics, bands, dates and the
  // permanent removal record. Telling him to delete it would destroy the store.
  // Telling him to move it into a folder of its own costs one `mv` and is
  // reversible whichever of the two it turns out to be.
  if (preRowsLeftoversAreEmpty(dir)) {
    return {
      alsoFound: DATABASE_FILE,
      remedy:
        `${DATABASE_FILE} is THIS build's store. Beside it are ${leftovers} (and possibly tmp/), ` +
        `which an older build leaves behind when it is pointed at a store like this one — its ` +
        `prose/ and versions/ are empty here. MOVE THOSE OUT of this directory into a folder of ` +
        `their own; do not delete them, and do not delete ${DATABASE_FILE}. This store then opens ` +
        `again with every memory in it. If you moved prose/ aside yourself, that operational.sqlite ` +
        `is your PRE-ROWS store and the words that go with it are wherever you put them — keep both, ` +
        `and open it with the build tagged ${PRE_ROWS_READABLE_BY}.`,
    };
  }
  return {
    alsoFound: DATABASE_FILE,
    remedy:
      `this directory holds TWO stores' names — a pre-rows store (${leftovers}, WITH FILES IN IT) ` +
      `and a ${DATABASE_FILE}. DELETE NEITHER. Move one of them out into a directory of its own and ` +
      `point at the one you mean; the pre-rows half is read by the build tagged ${PRE_ROWS_READABLE_BY}.`,
  };
}

/**
 * THE TWO ROWS THAT NEVER GET A VECTOR, and why the rule is one function.
 *
 * Both are `type: "schema"` rows that are DELIVERED AT THE WAKE and are skipped
 * by `recall/activate.ts`, so neither can reach a turn through the semantic
 * channel however good its vector is. Embedding either buys retrieval nothing
 * and costs three things that were measured rather than argued:
 *
 *   1. **The most sensitive prose in the store goes out to an embedding API for
 *      no use.** The self page is up to 16 KB of first-person identity; the
 *      handoff is the prose E1's own CONTRACT calls the likeliest to carry a
 *      token. Data leaves the machine only by the owner's choice (constitution
 *      6), and "because the indexer indexes everything" is not a choice.
 *   2. **They put a permanent floor under `unembeddedCount()`** — the number
 *      `doctor` and the parallel run watch, whose whole job is to say what is
 *      ACTIONABLE. On a keyless store that floor never falls.
 *   3. **A vector for a superseded body can displace a live neighbour** on the
 *      semantic slate (`cache.ts#deindexDoc`'s note: `nearestTo` scans
 *      `embeddings` with no liveness filter). Fewer rows in that table that
 *      nothing can deliver is strictly better.
 *
 *   - **`role: "page"`** — the self page (S1). Raised by E1's adversarial review
 *     as "worth checking whether the page is in the same position"; it was, and
 *     the coordinating session asked for the exclusion on 2026-09-20. **A
 *     WORKING DEFAULT, not a ruling — the owner has not been asked, and this is
 *     revisable without ceremony** (CLAUDE.md). The three reasons above are the
 *     whole of the argument for it; if any of them stops being true, so does
 *     this line.
 *   - **`role: "handoff"`** — the per-directory handoff (E1).
 *
 * Read STRUCTURALLY, for the reason `recall/` reads these roles structurally:
 * `store/` depends on no module above it, and a parse that fails reads as
 * "embed it", which is the direction that only ever costs a vector nobody asks
 * for. The strings' owners are `core/self/page.ts#SELF_PAGE_ROLE` and
 * `core/handoff/index.ts#HANDOFF_ROLE`.
 *
 * **What is NOT excluded, checked by the same test and left alone:**
 * the JOURNAL (`type: "episode"`) is a real recall candidate — `activate` does
 * not skip it, `expandHandle` returns it with `journal: true`, and the backfill
 * puts episodes in the FIRST group on purpose — so a vector buys it something
 * and it keeps one. Beliefs and entities (`role: "belief"`, `"entity"`) are
 * candidates too. S2's nightly writer mints no row of its own: it revises the
 * PAGE row and writes events, so excluding the page covers it whole.
 */
export function noVector(type: string, role: unknown): boolean {
  return type === "schema" && (role === "handoff" || role === "page");
}

/** The same rule for a caller holding box 2's columns rather than a document. */
function notForEmbedding(row: { type: string; meta: string }): boolean {
  if (row.type !== "schema") return false;
  try {
    return noVector(row.type, (JSON.parse(row.meta) as Record<string, unknown>)["role"]);
  } catch {
    return false;
  }
}

export function newId(type: ProseType): string {
  return `${ID_PREFIX[type]}_${randomBytes(6).toString("hex")}`;
}

/**
 * The UTC calendar date an INSTANT falls on.
 *
 * This WAS the provenance clock's arithmetic, UTC by deliberate choice while
 * every other date in the codebase was UTC too (NOTES 2026-09-05). Since
 * docs/time.md (2026-09-25) a person's day is LOCAL and is `time.ts#localDate`
 * (a store: `store.today()`, `localDate(at, store.zone())`). What is left here
 * is the UTC reading, kept under its old name for the callers that mean UTC on
 * purpose — reading a pre-v7 row's `learned_on`, the tools under `tools/`, and
 * the dashboard's `todayUtc` — so none of them changes meaning silently.
 *
 * NOT `physics/clock.ts#dayKey`: that shifts by the BOUNDARY HOUR, a physics idea.
 */
export function dateOf(at: number): string {
  return utcDate(at);
}

/** The ambient UTC date (see `dateOf`). A store's person's day is `store.today()`. */
export function today(): string {
  return utcDate(Date.now());
}

/** The v7 column's screen: a model id the host reported, or NULL. */
/**
 * v9: a successor takes its predecessor's about-mark (and who set it) when it
 * has none of its own — a revision or a merge is still the same memory, and a
 * mark that fell off at a supersede would quietly take it out of the core's
 * candidates. Inside the caller's transaction.
 */
function carryAboutMark(ops: Db, fromId: string, toId: string): void {
  ops.run(
    `UPDATE memories
        SET about = (SELECT about FROM memories WHERE id = ?),
            about_by = (SELECT about_by FROM memories WHERE id = ?)
      WHERE id = ? AND about IS NULL AND (SELECT about FROM memories WHERE id = ?) IS NOT NULL`,
    fromId,
    fromId,
    toId,
    fromId,
  );
}

/**
 * v12: a successor takes each of the writer's three fields its predecessor
 * had and it was not given — a revision or a merge is still the same memory
 * (as `carryAboutMark`). Of several originals merged, the first that has one
 * gives it. Inside the caller's transaction; a file without the columns is
 * left alone.
 */
function carryWriteFacts(ops: Db, fromId: string, toId: string): void {
  for (const col of ["occurred_on", "said_by", "status"] as const) {
    try {
      ops.run(
        `UPDATE memories SET ${col} = (SELECT ${col} FROM memories WHERE id = ?)
          WHERE id = ? AND ${col} IS NULL AND (SELECT ${col} FROM memories WHERE id = ?) IS NOT NULL`,
        fromId,
        toId,
        fromId,
      );
    } catch {
      return;
    }
  }
}

function modelOrNull(model: string | undefined): string | null {
  return model !== undefined && isModelId(model) ? model : null;
}

/** An event date that cannot be read is a reminder that never comes up: refused
 *  by name. Returns the date as it will be STORED — trimmed (review N5). */
function assertEventDate(date: string, id: string): string {
  if (!isCalendarDate(date)) throw new StoreError("EVENT_DATE_INVALID", { id, date: String(date).slice(0, 64) });
  return date.trim();
}

/**
 * `link` / `linkMany`: an UPSERT, not `INSERT OR REPLACE` — a replace deletes
 * the row first and would reset `created_at` on every re-weighting (v7).
 */
const EDGE_UPSERT = `INSERT INTO edges (src, dst, weight, last_day, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (src, dst) DO UPDATE SET
    weight = excluded.weight, last_day = excluded.last_day, updated_at = excluded.updated_at`;

/**
 * True when a data dir has already been initialized (used by adapters, not writes).
 *
 * A PRE-ROWS store counts, and has to: ~20 console commands gate on this before
 * they open anything, and a v5 store answering "false" would send every one of
 * them down the "there is no store here, run init" path — which is both wrong
 * and the one sentence that invites somebody to create a store on top of his
 * old one. Answering true sends them all to the named `STORE_PRE_ROWS` refusal
 * instead, which says what happened and which build still reads it.
 */
export function storeExists(dir: string = dataDir()): boolean {
  return existsSync(paths.operational(dir)) || preRowsMarkersIn(dir).length > 0;
}
