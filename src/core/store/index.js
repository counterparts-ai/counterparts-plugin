import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { isModelId } from "../types.js";
import {
  daysBetween,
  isCalendarDate,
  isDay,
  isoInstant,
  localDate,
  resolveZone,
  utcDate
} from "../time.js";
import { checkFeelings } from "./feelings.js";
import { checkTraitsRepaired } from "./traits.js";
import { USE_TIER_WEIGHT, creditReturn, creditUse } from "../physics/index.js";
import { foldWal, isLocked, wroteOn } from "./db.js";
import { StoreError } from "./errors.js";
import { isObserver } from "../observer.js";
import {
  CLAIMS_ERA_CUTOFF_KEY,
  CLAIMS_ERA_RECORDED_KEY,
  DEFAULT_RETENTION_DAYS,
  RECURRING_META,
  SCHEMA_VERSION,
  olderFirst,
  openOperational,
  rowToPhysics,
  rowTombstoned
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
  preRowsMarkersIn
} from "./paths.js";
import {
  ID_PREFIX,
  assertIdWellFormed,
  bodyForStorage,
  hashText,
  parseMeta,
  serializeMeta
} from "./prose.js";
import {
  DEFAULT_LENGTH_NORM,
  NEIGHBOURS_KEPT,
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
  setEmbedding
} from "./cache.js";
import {
  occurredOnOf,
  saidByOf,
  statusOf,
  confidentialByMeta,
  carryAboutMark,
  carryWriteFacts,
  ABOUT_MARKS,
  aboutMarkOf
} from "./marks.js";
import { memoryWhere } from "./shapes.js";
import {
  indexTextOf,
  EMBED_FAILED_PREFIX,
  noVector,
  indexText,
  EMBED_SKIP_AFTER,
  notForEmbedding
} from "./index-text.js";
import * as memoryReads from "./reads-memories.js";
import * as markReads from "./reads-marks.js";
import * as historyReads from "./reads-history.js";
export {
  SAID_BY,
  STATUSES,
  saidByOf,
  statusOf,
  occurredOnOf,
  confidentialByMeta,
  ABOUT_MARKS,
  CORE_ABOUT_MARKS,
  IDENTITY_ABOUT_MARKS,
  IDENTITY_KINDS,
  PLAN_STATUSES,
  ABOUT_SETTERS,
  aboutMarkOf,
  inheritFrom,
  foldMarkFrom
} from "./marks.js";
export { recurrenceOfRow } from "./shapes.js";
export { EMBED_FAILED_PREFIX, EMBED_SKIP_AFTER, indexTextOf, noVector } from "./index-text.js";
export * from "./errors.js";
export * from "../observer.js";
export * from "./paths.js";
export * from "./prose.js";
export * from "./render.js";
export * from "./feelings.js";
export * from "./traits.js";
export {
  ROLLBACK_HOLD_DIR,
  ROLLBACK_HOLD_FILE,
  readRollbackHold,
  rollbackHeld,
  rollbackHoldPath,
  writeRollbackHold
} from "./rollback-hold.js";
export {
  PRE_MIGRATION_NAME_RE,
  PRE_MIGRATION_TAG,
  assertPreMigrationTarget,
  preMigrationDir,
  preMigrationName,
  preMigrationVersions,
  realpathDeep,
  vacuumInto
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
  rowTombstoned
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
  schemaAhead
} from "./cache.js";
export { RECURRING_META };
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
  "carryInto",
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
  "rewriteGateValues",
  "appendEvent",
  "pruneEvents",
  "setRanking",
  "pruneSupersededVersions",
  "appendRemovalRecord",
  "rebuildCache",
  "pruneDeadIndex",
  "embedOne",
  "replayReturn",
  "recordHintDisplay",
  "supersedeInto",
  "restoreSuperseded",
  "restoreEdge",
  "sweepEdges",
  "sweepArchivedEdges",
  "retractFeelings",
  "retractDreamReturns",
  "retractDreamNominations",
  "appendCoreEvent",
  "openDream",
  "updateDream",
  "recordDreamChange",
  "markDreamChangeUndone",
  "setDreamAsk",
  "reclaimDreamAsk",
  "reflectReturn",
  "setAbout",
  "openReflection",
  "updateReflection",
  "flagContradiction",
  "markContradictionRaised",
  "withdrawContradiction",
  "settleContradiction",
  "undoContradictionSettle",
  "proposeContradiction",
  "withdrawProposal",
  "reinstateProposal",
  "linkSubjects",
  "dropRanking",
  "setNextChangeDays",
  "clearNextChangeDays"
];
const EVENT_RING = 500;
export const EMBEDDER_RECONCILED_EVENT = "store.embedder.reconciled";
export const STORE_MIGRATED_EVENT = "store.migrated";
const REFILL_BATCH = 500;
const REFILL_BUDGET_MS = 1500;
function verdictData(v) {
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

export class Store {
  dir;
  observer;
  retentionDays;
  ops;
  cache;
  embed;
  identity;
  embedderVerdict;
  migration;
  nowFn;
  configuredZone;
  onEvent;
  ring = [];
  constructor(opts) {
    this.dir = assertSafeDataDir(opts.dir ?? dataDir());
    this.observer = isObserver(opts);
    this.retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.embed = opts.embed;
    this.nowFn = opts.now ?? Date.now;
    this.configuredZone = opts.timeZone;
    this.onEvent = opts.onEvent;
    const preRows = preRowsMarkersIn(this.dir);
    if (preRows.length > 0) {
      throw new StoreError("STORE_PRE_ROWS", {
        dir: this.dir,
        found: preRows.join(", "),
        expected: SCHEMA_VERSION,
        ...preRowsRemedy(this.dir, preRows)
      });
    }
    if (opts.releaseRollbackHold !== true) {
      const hold = rollbackHeld(this.dir);
      if (hold !== null) {
        const h = hold === "unreadable" ? null : hold;
        const halfway = !existsSync(join(this.dir, DATABASE_FILE));
        throw new StoreError("STORE_ROLLED_BACK", {
          dir: this.dir,
          from: h?.from ?? null,
          to: h?.to ?? null,
          at: h === null ? null : isoInstant(h.at),
          snapshot: h?.snapshot ?? null,
          aside: h?.aside ?? null,
          halfway,
          remedy: halfway ? "A rollback of this store stopped before its copy went in, so there is no database here and the " + `newer store is set aside${h === null ? "" : ` in ${h.aside}`}. Run counterparts rollback --dir ${this.dir} --undo ` + "to put it back. Don't install the older version first: it would start a blank store here." : `This store was rolled back${h === null ? "" : ` to schema v${h.to}`} with counterparts rollback, ` + "so this build leaves it alone: install the version you went back to, or run " + `counterparts rollback --dir ${this.dir} --upgrade-again to upgrade it again ` + "(or --undo to put the newer store back)."
        });
      }
    }
    const fresh = !existsSync(paths.operational(this.dir));
    if (this.observer && fresh) {
      throw new StoreError("STORE_UNINITIALIZED", {
        path: paths.operational(this.dir),
        expected: SCHEMA_VERSION
      });
    }
    mkdirSync(paths.cacheDir(this.dir), { recursive: true });
    let migration = null;
    this.ops = openOperational(paths.operational(this.dir), {
      initialize: !this.observer,
      localToday: localDate(this.nowFn(), resolveZone(this.configuredZone)),
      retentionDays: this.retentionDays,
      ...opts.snapshotsDir === undefined ? {} : { snapshotsDir: opts.snapshotsDir },
      ...opts.releaseRollbackHold === true ? { freshMigrationCopy: true } : {},
      onMigrated: (note) => {
        migration = note;
      }
    });
    this.migration = migration;
    this.cache = openCache(paths.cache(this.dir));
    const identity = this.observer ? undefined : opts.embed?.identity;
    this.identity = identity;
    const ahead = cacheAhead(this.cache);
    const held = ahead === null && identity === undefined ? heldEmbedder(this.cache) : null;
    const reconcile = (id) => {
      try {
        return reconcileEmbedder(this.cache, id);
      } catch (err) {
        if (!isLocked(err))
          throw err;
        return { kind: "deferred", reason: "locked" };
      }
    };
    this.embedderVerdict = ahead !== null ? { kind: "cache-ahead", found: ahead.found, expected: ahead.expected } : identity !== undefined ? reconcile(identity) : held !== null ? {
      kind: "held",
      recorded: recordedEmbedder(this.cache)?.tag ?? null,
      configured: held,
      rows: embeddingCount(this.cache),
      fresh: false
    } : { kind: "none" };
    if (this.embedderVerdict.kind === "held" || this.embedderVerdict.kind === "cache-ahead" || this.embedderVerdict.kind === "deferred") {
      this.embed = undefined;
    }
    if (this.embedderVerdict.kind === "cache-ahead") {
      this.emit("cache.schema.ahead", undefined, verdictData(this.embedderVerdict));
    } else if (this.embedderVerdict.kind !== "none" && this.embedderVerdict.kind !== "match") {
      this.emit("cache.embedder.reconciled", undefined, verdictData(this.embedderVerdict));
    }
    if (fresh && !this.observer) {
      this.ops.run("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", STORE_CREATED_KEY, this.today());
    }
    if (!this.observer) {
      try {
        const recorded = this.ops.get("SELECT value FROM meta WHERE key = ?", CLAIMS_ERA_RECORDED_KEY);
        if (recorded === undefined) {
          const at = String(this.nowFn());
          this.ops.transaction(() => {
            if (this.ops.get("SELECT 1 FROM meta WHERE key = ?", CLAIMS_ERA_RECORDED_KEY) !== undefined)
              return;
            this.ops.run("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", CLAIMS_ERA_RECORDED_KEY, at);
            this.ops.run("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", CLAIMS_ERA_CUTOFF_KEY, at);
          });
        }
      } catch (err) {
        if (!isLocked(err))
          throw err;
      }
    }
    grantOwnerOps(this, {
      dir: this.dir,
      ownerMutate: (site, fn) => {
        this.assertWritable(site);
        return this.ops.transaction(() => fn(this.ops));
      },
      rawRow: (id) => this.row(id),
      isDenied: (id) => this.isDenied(id),
      reindexLexical: (id) => {
        const row = this.row(id);
        if (row === undefined)
          return;
        indexDoc(this.cache, id, indexTextOf(row.title, row.body));
      }
    });
    this.assertLayout();
    this.afterReconcile(identity);
    if (migration !== null)
      this.noteMigration(migration);
  }
  noteMigration(note) {
    const data = { from: note.from, to: note.to, snapshot: note.snapshot, reused: note.reused, dir: note.dir };
    this.emit(STORE_MIGRATED_EVENT, undefined, data);
    try {
      this.appendEvent({ name: STORE_MIGRATED_EVENT, day: this.livedDay(), payload: data });
    } catch {}
  }
  afterReconcile(identity) {
    if (this.observer)
      return;
    const v = this.embedderVerdict;
    const newIdentity = v.kind === "reset" || v.kind === "tagged" && v.tag !== null && v.adopted === 0;
    const durable = v.kind === "reset" || v.kind === "deferred" || v.kind === "held" && v.fresh || v.kind === "tagged" && v.adopted > 0 || v.kind === "match" && v.released === true;
    if (durable) {
      try {
        this.appendEvent({
          name: EMBEDDER_RECONCILED_EVENT,
          day: this.livedDay(),
          payload: { ...verdictData(v), ...v.kind === "held" ? { exits: heldExits(v.recorded) } : {} }
        });
      } catch {}
    }
    if (newIdentity) {
      try {
        const moves = [];
        for (const [key, value] of this.metaWithPrefix(EMBED_FAILED_PREFIX)) {
          if (value !== "0")
            moves.push([key, "0"]);
        }
        if (moves.length > 0)
          this.setMetaMany(moves);
      } catch {}
    }
    if (identity?.rebuild === "inline" && (v.kind === "reset" || v.kind === "tagged" && v.tag !== null)) {
      this.refillVectorsInline();
    }
  }
  static open(opts = {}) {
    return new Store(opts);
  }
  closed = false;
  close() {
    if (this.closed)
      return;
    const folds = [];
    if (!this.observer) {
      if (wroteOn(this.ops))
        folds.push(["store", foldWal(this.ops)]);
      if (wroteOn(this.cache))
        folds.push(["cache", foldWal(this.cache)]);
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
          ...f.error === undefined ? {} : { error: f.error }
        });
      } catch {}
    }
  }
  schemaReads;
  schemaVersions() {
    this.schemaReads ??= {
      store: this.ops.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'"),
      cache: this.cache.prepare("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")
    };
    return {
      store: this.schemaReads.store.get()?.value ?? null,
      cache: this.schemaReads.cache.get()?.value ?? null
    };
  }
  mutate(site, fn) {
    this.assertWritable(site);
    return this.ops.transaction(fn);
  }
  assertWritable(site) {
    if (this.observer) {
      this.emit("store.observer.standdown", undefined, { site });
      throw new StoreError("OBSERVER_REFUSED", { site });
    }
    this.writeGuard?.(site);
  }
  writeGuard = null;
  guardWrites(check) {
    this.writeGuard = check;
  }
  emit(name, ref, data) {
    const event = { at: this.nowFn(), name };
    if (ref !== undefined)
      event.ref = ref;
    if (data !== undefined)
      event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING)
      this.ring.shift();
    this.onEvent?.(event);
  }
  now() {
    return this.nowFn();
  }
  today() {
    return localDate(this.nowFn(), this.zone());
  }
  zone() {
    return resolveZone(this.configuredZone);
  }
  events(name) {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }
  assertLayout() {
    assertLayoutClassified(readdirSync(this.dir));
  }
  backupSet() {
    return LAYOUT.filter((e) => e.backup).map((e) => e.name);
  }
  put(input) {
    const doc = this.mutate("put", () => this.insertOne(input));
    this.indexOne(doc);
    this.emit("store.put", doc.id, { type: doc.type, kind: input.kind, hash: hashText(doc.body) });
    return doc.id;
  }
  putMany(inputs, opts = {}) {
    const landed = this.mutate("putMany", () => {
      const out = [];
      for (const input of inputs) {
        try {
          out.push({ doc: this.isolatedInsert(input, opts.isolate === true), input });
        } catch (err) {
          if (!opts.isolate)
            throw err;
          this.emit("store.put.skipped", input.id, {
            reason: err instanceof StoreError ? err.code : "UNKNOWN"
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
        hash: hashText(s.doc.body)
      });
    }
    return landed.map((s) => s.doc.id);
  }
  isolatedInsert(input, isolate) {
    return isolate ? this.ops.transaction(() => this.insertOne(input)) : this.insertOne(input);
  }
  revise(id, patch) {
    const { doc, seq, hash } = this.mutate("revise", () => {
      const row = this.requireRow(id);
      const prior = this.docOf(row);
      const seq = row.revision + 1;
      const at = this.nowFn();
      const eventDate = patch.eventDate === undefined || patch.eventDate === null ? patch.eventDate : assertEventDate(patch.eventDate, id);
      this.ops.run(`INSERT INTO versions
           (memory_id, seq, reason, version_day, archived_at, content_hash, successor_id,
            title, body, meta, learned_on, happened_on, created_at, model, event_date,
            occurred_on, said_by, status)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, seq, patch.reason ?? "revise", this.livedDay(), at, row.content_hash, row.title, row.body, row.meta, row.learned_on, row.happened_on, row.updated_at ?? row.created_at, row.model, row.event_date, row.occurred_on ?? null, row.said_by ?? null, row.status ?? null);
      const next = {
        ...prior,
        body: patch.body ?? prior.body,
        meta: patch.meta ? { ...prior.meta, ...patch.meta } : prior.meta
      };
      if (patch.title !== undefined)
        next.title = patch.title;
      if (patch.learnedOn !== undefined)
        next.learnedOn = patch.learnedOn;
      if (patch.happenedOn !== undefined)
        next.happenedOn = patch.happenedOn;
      if (eventDate === null)
        delete next.eventDate;
      else if (eventDate !== undefined)
        next.eventDate = eventDate;
      const model = patch.model !== undefined ? modelOrNull(patch.model) : patch.body !== undefined ? null : row.model;
      next.body = bodyForStorage(next.body, id);
      const nextHash = hashText(next.body);
      const occurredOn = patch.occurredOn === undefined ? row.occurred_on ?? null : patch.occurredOn === null ? null : occurredOnOf(patch.occurredOn);
      const saidBy = patch.saidBy === undefined ? row.said_by ?? null : saidByOf(patch.saidBy);
      const status = patch.status === undefined ? row.status ?? null : statusOf(patch.status);
      this.ops.run(`UPDATE memories
            SET content_hash = ?, revision = ?, title = ?, body = ?, meta = ?,
                confidential = ?, learned_on = ?, happened_on = ?,
                event_date = ?, model = ?, updated_at = ?,
                occurred_on = ?, said_by = ?, status = ?
          WHERE id = ?`, nextHash, seq, next.title ?? null, next.body, serializeMeta(next.meta, id), confidentialByMeta(next.meta) ? 1 : 0, next.learnedOn, next.happenedOn ?? null, next.eventDate ?? null, model, at, occurredOn, saidBy, status, id);
      if (row.type === "memory" && (patch.body !== undefined || patch.title !== undefined)) {
        this.relinkSubjects(id, next.title ?? null, next.body);
      }
      return { doc: next, seq, hash: nextHash };
    });
    this.indexOne(doc);
    this.emit("store.revise", id, { seq, hash });
    return seq;
  }
  supersede(oldId, input, reason = "supersede") {
    const { doc, newId } = this.mutate("supersede", () => {
      const row = this.requireRow(oldId);
      const created = this.insertOne(input);
      const at = this.nowFn();
      this.ops.run(`INSERT INTO versions
           (memory_id, seq, reason, version_day, archived_at, content_hash, successor_id,
            title, body, meta, learned_on, happened_on, created_at, model, event_date,
            occurred_on, said_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, oldId, row.revision + 1, reason, this.livedDay(), at, row.content_hash, created.id, row.title, row.body, row.meta, row.learned_on, row.happened_on, row.updated_at ?? row.created_at, row.model, row.event_date, row.occurred_on ?? null, row.said_by ?? null, row.status ?? null);
      this.ops.run(`UPDATE memories SET superseded_by = ?, archived = 1, archived_reason = ?, revision = ?,
                updated_at = ?
          WHERE id = ?`, created.id, reason, row.revision + 1, at, oldId);
      carryAboutMark(this.ops, oldId, created.id);
      carryWriteFacts(this.ops, oldId, created.id);
      return { doc: created, newId: created.id };
    });
    this.indexOne(doc);
    deindexDoc(this.cache, oldId);
    this.emit("store.supersede", oldId, { successor: newId, reason });
    return newId;
  }
  archive(id, reason) {
    this.mutate("archive", () => {
      this.requireRow(id);
      this.ops.run("UPDATE memories SET archived = 1, archived_reason = ?, updated_at = ? WHERE id = ?", reason, this.nowFn(), id);
    });
    deindexDoc(this.cache, id);
    this.emit("store.archive", id, { reason });
  }
  updatePhysics(id, patch) {
    this.mutate("updatePhysics", () => {
      this.requireRow(id);
      const sets = [];
      const args = [];
      const put = (col, val) => {
        sets.push(`${col} = ?`);
        args.push(val);
      };
      if (patch.kind !== undefined)
        put("kind", patch.kind);
      if (patch.salience !== undefined) {
        put("novelty", patch.salience.novelty);
        put("relevance", patch.salience.relevance);
        put("emotional", patch.salience.emotional);
        put("predictive", patch.salience.predictive);
        put("claimed", patch.salience.claimed ?? null);
      }
      if (patch.birthDay !== undefined)
        put("birth_day", patch.birthDay);
      if (patch.uses !== undefined)
        put("uses", patch.uses);
      if (patch.lastUsedDay !== undefined)
        put("last_used_day", patch.lastUsedDay);
      if (patch.reinforcedDays !== undefined)
        put("reinforced_days", patch.reinforcedDays);
      if (patch.consolidated !== undefined)
        put("consolidated", patch.consolidated ? 1 : 0);
      if (patch.promotedIdentity !== undefined)
        put("promoted_identity", patch.promotedIdentity ? 1 : 0);
      if (patch.protected !== undefined)
        put("protected", patch.protected ? 1 : 0);
      if (patch.pressure !== undefined)
        put("pressure", patch.pressure);
      if (patch.lastChallengedDay !== undefined)
        put("last_challenged_day", patch.lastChallengedDay);
      if (patch.fade !== undefined)
        put("fade", patch.fade);
      if (sets.length === 0)
        return;
      this.ops.run(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`, ...args, id);
    });
    this.emit("store.physics", id, { fields: Object.keys(patch).join(",") });
  }
  reinforce(id, day, tier = "referenced", opts = {}) {
    const outcome = this.mutate("reinforce", () => {
      const row = this.requireRow(id);
      let physics = rowToPhysics(row);
      const upgradeFrom = opts.upgradeFrom ?? this.engagedToday(id, day, row.last_used_day, tier);
      const verdict = creditUse(physics, day, tier, upgradeFrom === undefined ? {} : { upgradeFrom });
      let ret = null;
      if (verdict.credited) {
        this.ops.run(`UPDATE memories
              SET uses = ?, last_used_day = ?, reinforced_days = ?
            WHERE id = ?`, verdict.next.uses, verdict.next.lastUsedDay, verdict.next.reinforcedDays, id);
        if (upgradeFrom === "engaged" && tier !== "engaged") {
          this.ops.run("DELETE FROM returns WHERE memory_id = ? AND day = ? AND source = 'engaged'", id, day);
          this.recomputeReturns(id);
          physics = rowToPhysics(this.requireRow(id));
        }
        ret = tier === "engaged" ? creditReturn(physics, day, { source: "engaged", since: this.spacingSince(id) }) : creditReturn(physics, day, {
          source: "awake",
          tierWeight: verdict.w,
          onDisplay: opts.cued !== true && this.shownInHints(id, day),
          since: this.spacingSince(id)
        });
        if (ret.counted)
          this.writeReturn(id, day, ret, null, opts.session ?? null);
      }
      return { ...verdict, ret };
    });
    this.emit("store.reinforce", id, {
      credited: outcome.credited,
      reason: outcome.reason,
      day,
      tier,
      returned: outcome.ret?.counted ?? false,
      returnReason: outcome.ret?.reason ?? null
    });
    return outcome;
  }
  replayReturn(id, day, dreamId) {
    const outcome = this.mutate("replayReturn", () => {
      const row = this.requireRow(id);
      const ret = creditReturn(rowToPhysics(row), day, { source: "dream", since: this.spacingSince(id) });
      if (ret.counted)
        this.writeReturn(id, day, ret, dreamId);
      return ret;
    });
    this.emit("store.replay", id, { counted: outcome.counted, reason: outcome.reason, day, dream: dreamId });
    return outcome;
  }
  reflectReturn(id, day, opts = {}) {
    const outcome = this.mutate("reflectReturn", () => {
      const row = this.requireRow(id);
      const last = this.ops.get("SELECT MAX(day) AS d FROM returns WHERE memory_id = ? AND source = 'reflection'", id)?.d ?? null;
      const ret = creditReturn(rowToPhysics(row), day, {
        source: "reflection",
        since: this.spacingSince(id),
        lastReflectionDay: last
      });
      if (ret.counted)
        this.writeReturn(id, day, ret, null, opts.session ?? null);
      return ret;
    });
    this.emit("store.reflect", id, { counted: outcome.counted, reason: outcome.reason, day });
    return outcome;
  }
  spacingSince(id) {
    return this.ops.get("SELECT MAX(day) AS d FROM returns WHERE memory_id = ? AND source IN ('legacy', 'engaged')", id)?.d ?? null;
  }
  engagedToday(id, day, lastUsedDay, tier) {
    if (lastUsedDay !== day || USE_TIER_WEIGHT[tier] <= USE_TIER_WEIGHT.engaged)
      return;
    const r = this.ops.get("SELECT COUNT(*) AS n FROM returns WHERE memory_id = ? AND day = ? AND source = 'engaged'", id, day);
    return (r?.n ?? 0) > 0 ? "engaged" : undefined;
  }
  writeReturn(id, day, ret, dreamId, session = null) {
    this.ops.run(`INSERT OR IGNORE INTO returns (memory_id, day, source, weight, gap, dream_id, at, session)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, day, ret.source, ret.weight, Number.isFinite(ret.gap) ? ret.gap : 0, dreamId, this.nowFn(), session);
    this.recomputeReturns(id);
  }
  recomputeReturns(id) {
    const agg = this.ops.get(`SELECT SUM(weight) AS total,
              COUNT(DISTINCT CASE WHEN source IN ('awake', 'reflection') THEN day END) AS days,
              MIN(CASE WHEN source IN ('awake', 'reflection') THEN day END) AS first,
              MAX(CASE WHEN source IN ('awake', 'reflection') THEN day END) AS last,
              MAX(CASE WHEN source = 'dream' THEN day END) AS dream
         FROM returns WHERE memory_id = ?`, id);
    this.ops.run(`UPDATE memories
          SET returns = ?, return_days = ?, first_return_day = ?, last_return_day = ?, last_dream_day = ?
        WHERE id = ?`, agg?.total ?? 0, agg?.days ?? 0, agg?.first ?? null, agg?.last ?? null, agg?.dream ?? null, id);
  }
  returnsOf(id) {
    return this.ops.all("SELECT * FROM returns WHERE memory_id = ? ORDER BY day, source", id);
  }
  returnCounts(filter) {
    return memoryReads.returnCounts(this, filter);
  }
  shownInHints(id, day) {
    const r = this.ops.get("SELECT * FROM wake_display WHERE memory_id = ?", id);
    if (r === undefined || r.lane !== "hints")
      return false;
    if (day < r.first_day)
      return false;
    return r.closed_day === null || day <= r.closed_day;
  }
  wakeDisplays() {
    const out = new Map;
    for (const r of this.ops.all("SELECT * FROM wake_display"))
      out.set(r.memory_id, r);
    return out;
  }
  recordHintDisplay(day, kept) {
    this.mutate("recordHintDisplay", () => {
      const at = this.nowFn();
      const keptIds = new Set;
      for (const k of kept) {
        const row = this.row(k.id);
        if (row === undefined)
          continue;
        keptIds.add(k.id);
        const prior = this.ops.get("SELECT * FROM wake_display WHERE memory_id = ?", k.id);
        const open = prior !== undefined && prior.closed_day === null;
        this.ops.run(`INSERT INTO wake_display
             (memory_id, lane, first_day, shown_day, closed_day, load, ever_day, ever_uses, ever_last_used, updated_at)
           VALUES (?, 'hints', ?, ?, NULL, ?, ?, ?, ?, ?)
           ON CONFLICT (memory_id) DO UPDATE SET
             lane = 'hints', first_day = excluded.first_day, shown_day = excluded.shown_day,
             closed_day = NULL, load = excluded.load, updated_at = excluded.updated_at`, k.id, open ? prior.first_day : day, day, k.load, day, row.uses, row.last_used_day, at);
      }
      for (const r of this.ops.all("SELECT * FROM wake_display WHERE closed_day IS NULL")) {
        if (keptIds.has(r.memory_id))
          continue;
        this.ops.run("UPDATE wake_display SET closed_day = ?, updated_at = ? WHERE memory_id = ?", day, at, r.memory_id);
      }
    });
    this.emit("store.display", undefined, { day, kept: kept.length });
  }
  supersedeInto(oldId, successorId, reason, opts = {}) {
    this.mutate("supersedeInto", () => {
      const row = this.requireRow(oldId);
      this.requireRow(successorId);
      const at = this.nowFn();
      this.ops.run(`INSERT INTO versions
           (memory_id, seq, reason, version_day, archived_at, content_hash, successor_id,
            title, body, meta, learned_on, happened_on, created_at, model, event_date,
            occurred_on, said_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, oldId, row.revision + 1, reason, this.livedDay(), at, row.content_hash, successorId, row.title, row.body, row.meta, row.learned_on, row.happened_on, row.updated_at ?? row.created_at, row.model, row.event_date, row.occurred_on ?? null, row.said_by ?? null, row.status ?? null);
      this.ops.run(`UPDATE memories SET superseded_by = ?, archived = 1, archived_reason = ?, revision = ?, updated_at = ?
          WHERE id = ?`, successorId, reason, row.revision + 1, at, oldId);
      carryAboutMark(this.ops, oldId, successorId);
      carryWriteFacts(this.ops, oldId, successorId);
      if (opts.carryReturns === true)
        this.copyReturnsRaw(oldId, successorId);
    });
    deindexDoc(this.cache, oldId);
    this.emit("store.supersede", oldId, { successor: successorId, reason });
  }
  carryInto(fromId, toId, opts = {}) {
    this.mutate("carryInto", () => {
      this.requireRow(fromId);
      this.requireRow(toId);
      carryAboutMark(this.ops, fromId, toId);
      carryWriteFacts(this.ops, fromId, toId);
      if (opts.returns !== false)
        this.copyReturnsRaw(fromId, toId);
    });
  }
  copyReturnsRaw(fromId, toId) {
    this.ops.run(`INSERT OR IGNORE INTO returns (memory_id, day, source, weight, gap, dream_id, at)
       SELECT ?, day, source, weight, gap, dream_id, at FROM returns WHERE memory_id = ?`, toId, fromId);
    this.recomputeReturns(toId);
  }
  restoreSuperseded(oldId, reason) {
    const restored = this.mutate("restoreSuperseded", () => {
      const row = this.requireRow(oldId);
      if (row.archived !== 1 || row.archived_reason !== reason)
        return false;
      this.ops.run(`UPDATE memories SET superseded_by = NULL, archived = 0, archived_reason = NULL, updated_at = ?
          WHERE id = ?`, this.nowFn(), oldId);
      return true;
    });
    if (restored) {
      try {
        this.indexOne(this.readProse(oldId));
      } catch {}
      this.emit("store.restore", oldId, { reason });
    }
    return restored;
  }
  restoreEdge(src, dst, restore = null) {
    this.mutate("restoreEdge", () => {
      if (restore === null) {
        this.ops.run("DELETE FROM edges WHERE src = ? AND dst = ?", src, dst);
      } else {
        this.ops.run("UPDATE edges SET weight = ?, last_day = ?, updated_at = ? WHERE src = ? AND dst = ?", restore.weight, restore.day, this.nowFn(), src, dst);
      }
    });
    this.emit("store.edge.restored", src, { dst, restored: restore !== null });
  }
  retractFeelings(ids) {
    const n = this.mutate("retractFeelings", () => {
      let count = 0;
      for (const id of ids) {
        this.ops.run("UPDATE feelings SET beneath_id = NULL WHERE beneath_id = ?", id);
        this.ops.run("DELETE FROM feelings WHERE id = ?", id);
        count += this.ops.get("SELECT changes() AS n")?.n ?? 0;
      }
      return count;
    });
    this.emit("store.feelings.retracted", undefined, { count: n });
    return n;
  }
  retractDreamReturns(dreamId) {
    const n = this.mutate("retractDreamReturns", () => {
      const ids = this.ops.all("SELECT DISTINCT memory_id FROM returns WHERE dream_id = ?", dreamId).map((r) => r.memory_id);
      this.ops.run("DELETE FROM returns WHERE dream_id = ?", dreamId);
      for (const id of ids)
        if (this.row(id) !== undefined)
          this.recomputeReturns(id);
      return ids.length;
    });
    this.emit("store.replay.retracted", undefined, { dream: dreamId, memories: n });
    return n;
  }
  appendCoreEvent(input) {
    const seq = this.mutate("appendCoreEvent", () => {
      this.ops.run(`INSERT INTO core_events (memory_id, action, day, at, lane, reason, dream_id, actor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, input.memoryId, input.action, input.day, this.nowFn(), input.lane ?? null, input.reason ?? null, input.dreamId ?? null, input.actor ?? null);
      return this.ops.get("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
    });
    this.emit("store.core", input.memoryId, { action: input.action });
    return seq;
  }
  coreEvents(filter) {
    return historyReads.coreEvents(this, filter);
  }
  retractDreamNominations(dreamId) {
    const n = this.mutate("retractDreamNominations", () => {
      this.ops.run("DELETE FROM core_events WHERE dream_id = ? AND action = 'nominated'", dreamId);
      return this.ops.get("SELECT changes() AS n")?.n ?? 0;
    });
    this.emit("store.core.retracted", undefined, { dream: dreamId, count: n });
    return n;
  }
  setAbout(id, mark, opts) {
    if (!ABOUT_MARKS.includes(mark))
      throw new StoreError("ABOUT_UNKNOWN", { id, mark });
    const out = this.mutate("setAbout", () => {
      const row = this.requireRow(id);
      if (row.type !== "memory" || rowTombstoned(row))
        throw new StoreError("ABOUT_NOT_A_MEMORY", { id });
      const before = aboutMarkOf(row.about);
      this.ops.run("UPDATE memories SET about = ?, about_by = ? WHERE id = ?", mark, opts.by, id);
      const why = (opts.why ?? "").trim();
      this.ops.run(`INSERT INTO core_events (memory_id, action, day, at, lane, reason, dream_id, actor)
         VALUES (?, 'about', ?, ?, NULL, ?, ?, ?)`, id, opts.day ?? this.livedDay(), this.nowFn(), `${mark} (was ${before ?? "unmarked"})${why.length > 0 ? `: ${why.slice(0, 300)}` : ""}`, opts.dreamId ?? null, opts.by);
      return { changed: before !== mark, before };
    });
    this.emit("store.about", id, { mark, by: opts.by, changed: out.changed });
    return out;
  }
  openReflection(input) {
    this.mutate("openReflection", () => {
      this.ops.run(`INSERT INTO reflections (id, dream_id, session, scope, day, date, state, started_at, model, questions, shown)
         VALUES (?, ?, ?, ?, ?, ?, 'begun', ?, ?, ?, ?)`, input.id, input.dreamId ?? null, input.session ?? null, input.scope ?? null, input.day, input.date ?? null, this.nowFn(), modelOrNull(input.model ?? undefined), JSON.stringify(input.questions), JSON.stringify(input.shown));
    });
    this.emit("store.reflection", input.id, { state: "begun", day: input.day });
  }
  updateReflection(id, patch) {
    const landed = this.mutate("updateReflection", () => {
      const row = this.ops.get("SELECT * FROM reflections WHERE id = ?", id);
      if (row === undefined)
        throw new StoreError("ID_UNKNOWN", { id });
      if (patch.ifShareState !== undefined && row.share_state !== patch.ifShareState)
        return false;
      const at = this.nowFn();
      this.ops.run(`UPDATE reflections
            SET state = ?, finished_at = ?, entry = ?, entry_id = ?, cites = ?, share = ?, share_cites = ?,
                share_state = ?, share_at = ?, share_session = ?, page_version = ?, detail = ?
          WHERE id = ?${patch.ifShareState === undefined ? "" : " AND share_state = ?"}`, patch.state ?? row.state, patch.state === "reflected" ? at : row.finished_at, patch.entry === undefined ? row.entry : patch.entry, patch.entryId === undefined ? row.entry_id : patch.entryId, patch.cites === undefined ? row.cites : JSON.stringify(patch.cites), patch.share === undefined ? row.share : patch.share, patch.shareCites === undefined ? row.share_cites : JSON.stringify(patch.shareCites), patch.shareState ?? row.share_state, patch.shareState === undefined || patch.shareState === row.share_state ? row.share_at : at, patch.shareSession === undefined ? row.share_session : patch.shareSession, patch.pageVersion === undefined ? row.page_version : patch.pageVersion, patch.detail === undefined ? row.detail : JSON.stringify(patch.detail), id, ...patch.ifShareState === undefined ? [] : [patch.ifShareState]);
      return patch.ifShareState === undefined ? true : (this.ops.get("SELECT changes() AS n")?.n ?? 0) > 0;
    });
    if (landed)
      this.emit("store.reflection", id, { state: patch.state ?? null, share: patch.shareState ?? null });
    return landed;
  }
  reflection(id) {
    return this.ops.get("SELECT * FROM reflections WHERE id = ?", id);
  }
  reflections(filter) {
    return historyReads.reflections(this, filter);
  }
  reflectionCount() {
    return this.ops.get("SELECT COUNT(*) AS n FROM reflections")?.n ?? 0;
  }
  coreStanding(id) {
    return this.ops.get("SELECT * FROM core_events WHERE memory_id = ? AND action IN ('promoted', 'demoted', 'reconsidering', 'reaffirmed') ORDER BY seq DESC LIMIT 1", id);
  }
  coreReconsidering() {
    return historyReads.coreReconsidering(this);
  }
  coreDemoted(id) {
    const last = this.ops.get("SELECT action FROM core_events WHERE memory_id = ? AND action IN ('promoted', 'demoted') ORDER BY seq DESC LIMIT 1", id);
    return last?.action === "demoted";
  }
  contradiction(id) {
    if (!this.hasTable("contradictions"))
      return;
    return this.ops.get("SELECT * FROM contradictions WHERE id = ?", id);
  }
  contradictionBetween(x, y) {
    return historyReads.contradictionBetween(this, x, y);
  }
  contradictionsOf(ids) {
    return historyReads.contradictionsOf(this, ids);
  }
  contradictions(filter) {
    return historyReads.contradictions(this, filter);
  }
  contradictionSettles(filter) {
    return historyReads.contradictionSettles(this, filter);
  }
  flagContradiction(input) {
    const out = this.mutate("flagContradiction", () => {
      if (input.x === input.y)
        throw new StoreError("CONTRADICTION_SAME_MEMORY", { id: input.x });
      const standing = this.contradictionBetween(input.x, input.y);
      if (standing !== undefined)
        return { id: standing.id, created: false, state: standing.state };
      const [a, b] = olderFirst(this.ageOf(input.x), this.ageOf(input.y));
      const at = this.nowFn();
      this.ops.run(`INSERT INTO contradictions
           (id, a, b, state, how, holds, over, via, source, dream_id, dream_seq, flagged_day, raised_day, settled_day, created_at, updated_at)
         VALUES (?, ?, ?, 'unsettled', NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?)`, input.id, a, b, input.source, input.dreamId ?? null, input.dreamSeq ?? null, input.day, at, at);
      return { id: input.id, created: true, state: "unsettled" };
    });
    this.emit("store.contradiction", out.id, { action: "flag", created: out.created, source: input.source });
    return out;
  }
  ageOf(id) {
    this.requireRow(id);
    const r = this.ops.get("SELECT birth_day, created_at, rowid AS rid FROM memories WHERE id = ?", id);
    return { id, birth_day: r?.birth_day ?? 0, created_at: r?.created_at ?? null, rid: r?.rid ?? 0 };
  }
  idsWithMetaKey(key) {
    return this.ops.all("SELECT id FROM memories WHERE archived = 0 AND superseded_by IS NULL AND meta LIKE ?", `%"${key}"%`).map((r) => r.id);
  }
  foldsCiting(id) {
    return historyReads.foldsCiting(this, id);
  }
  contradictionEverBetween(x, y) {
    if (!this.hasTable("contradictions"))
      return false;
    return (this.ops.get("SELECT COUNT(*) AS n FROM contradictions WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", x, y, y, x)?.n ?? 0) > 0;
  }
  proposeContradiction(input) {
    const out = this.mutate("proposeContradiction", () => {
      if (input.holds === input.over)
        throw new StoreError("CONTRADICTION_SAME_MEMORY", { id: input.holds });
      const standing = this.contradictionBetween(input.holds, input.over);
      if (standing !== undefined)
        return { id: standing.id, created: false, seq: null };
      const [a, b] = olderFirst(this.ageOf(input.holds), this.ageOf(input.over));
      const at = this.nowFn();
      this.ops.run(`INSERT INTO contradictions
           (id, a, b, state, how, holds, over, via, source, dream_id, dream_seq, flagged_day, raised_day, settled_day, created_at, updated_at)
         VALUES (?, ?, ?, 'unsettled', NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, NULL, NULL, ?, ?)`, input.id, a, b, input.source, input.day, at, at);
      this.ops.run(`INSERT INTO contradiction_settles (pair_id, action, how, holds, over, actor, actor_id, why, day, at, undone, detail)
         VALUES (?, 'propose', 'changed', ?, ?, ?, ?, NULL, ?, ?, 0, ?)`, input.id, input.holds, input.over, input.actor, input.actorId, input.day, at, JSON.stringify(input.detail ?? {}));
      const seq = this.ops.get("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
      if (input.fade !== null)
        this.updatePhysics(input.fade.id, { fade: input.fade.fade });
      return { id: input.id, created: true, seq };
    });
    if (out.created)
      this.emit("store.contradiction", out.id, { action: "propose", source: input.source });
    return out;
  }
  withdrawProposal(input) {
    const out = this.mutate("withdrawProposal", () => {
      const at = this.nowFn();
      const pair = this.contradiction(input.pairId);
      if (pair === undefined)
        throw new StoreError("CONTRADICTION_UNKNOWN", { id: input.pairId });
      this.ops.run("UPDATE contradiction_settles SET undone = 1 WHERE seq = ? AND pair_id = ?", input.proposeSeq, input.pairId);
      this.ops.run(`INSERT INTO contradiction_settles (pair_id, action, how, holds, over, actor, actor_id, why, day, at, undone, detail)
         VALUES (?, 'withdraw', NULL, NULL, NULL, ?, ?, ?, ?, ?, 0, ?)`, input.pairId, input.actor, input.actorId, input.why, input.day, at, JSON.stringify({ ...input.detail ?? {}, withdraws: input.proposeSeq }));
      const seq = this.ops.get("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
      this.ops.run("UPDATE contradictions SET state = 'withdrawn', raised_day = NULL, updated_at = ? WHERE id = ?", at, input.pairId);
      if (input.restore !== null)
        this.updatePhysics(input.restore.id, { fade: input.restore.fade });
      return { seq };
    });
    this.emit("store.contradiction", input.pairId, { action: "withdraw", actor: input.actor });
    return out;
  }
  reinstateProposal(input) {
    this.mutate("reinstateProposal", () => {
      this.ops.run("UPDATE contradiction_settles SET undone = 0 WHERE seq = ? AND pair_id = ?", input.proposeSeq, input.pairId);
      this.ops.run("UPDATE contradiction_settles SET undone = 1 WHERE seq = ? AND pair_id = ?", input.withdrawSeq, input.pairId);
      this.ops.run("UPDATE contradictions SET state = 'unsettled', updated_at = ? WHERE id = ? AND state = 'withdrawn'", this.nowFn(), input.pairId);
      if (input.fade !== null)
        this.updatePhysics(input.fade.id, { fade: input.fade.fade });
    });
    this.emit("store.contradiction", input.pairId, { action: "reinstate" });
  }
  markContradictionRaised(id, day) {
    this.mutate("markContradictionRaised", () => {
      this.ops.run("UPDATE contradictions SET raised_day = ? WHERE id = ? AND raised_day IS NULL", day, id);
    });
  }
  withdrawContradiction(id) {
    const n = this.mutate("withdrawContradiction", () => {
      this.ops.run("UPDATE contradictions SET state = 'withdrawn', updated_at = ? WHERE id = ? AND state = 'unsettled'", this.nowFn(), id);
      return this.ops.get("SELECT changes() AS n")?.n ?? 0;
    });
    if (n > 0)
      this.emit("store.contradiction", id, { action: "withdraw" });
    return n > 0;
  }
  settleContradiction(input) {
    const out = this.mutate("settleContradiction", () => {
      const at = this.nowFn();
      let pairId = input.pairId;
      if (pairId === undefined) {
        if (input.x === undefined || input.y === undefined || input.newId === undefined) {
          throw new StoreError("CONTRADICTION_PAIR_REQUIRED", {});
        }
        const [a, b] = olderFirst(this.ageOf(input.x), this.ageOf(input.y));
        pairId = input.newId;
        this.ops.run(`INSERT INTO contradictions
             (id, a, b, state, how, holds, over, via, source, dream_id, dream_seq, flagged_day, raised_day, settled_day, created_at, updated_at)
           VALUES (?, ?, ?, 'settled', ?, ?, ?, NULL, ?, NULL, NULL, ?, NULL, ?, ?, ?)`, pairId, a, b, input.how, input.holds, input.over, input.source ?? input.actor, input.day, input.day, at, at);
      } else {
        if (this.contradiction(pairId) === undefined)
          throw new StoreError("CONTRADICTION_UNKNOWN", { id: pairId });
        this.ops.run(`UPDATE contradictions SET state = 'settled', how = ?, holds = ?, over = ?, via = NULL,
                  settled_day = ?, updated_at = ? WHERE id = ?`, input.how, input.holds, input.over, input.day, at, pairId);
      }
      const closes = (input.closes ?? []).filter((c) => c !== pairId);
      for (const c of closes) {
        this.ops.run(`UPDATE contradictions SET state = 'settled', how = ?, via = ?, settled_day = ?, updated_at = ?
            WHERE id = ? AND state = 'unsettled'`, input.how, pairId, input.day, at, c);
      }
      this.ops.run(`INSERT INTO contradiction_settles (pair_id, action, how, holds, over, actor, actor_id, why, day, at, undone, detail)
         VALUES (?, 'settle', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`, pairId, input.how, input.holds, input.over, input.actor, input.actorId, input.why, input.day, at, JSON.stringify({ ...input.detail ?? {}, closes }));
      const seq = this.ops.get("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
      for (const l of input.lifts ?? [])
        this.updatePhysics(l.id, { fade: l.fade });
      if (input.leaveCore !== undefined && input.leaveCore !== null) {
        const c = input.leaveCore;
        this.updatePhysics(c.id, { promotedIdentity: false, lastUsedDay: c.lastUsedDay });
        this.ops.run("UPDATE memories SET band = ?, band_day = ? WHERE id = ?", c.band, input.day, c.id);
      }
      if (input.fade !== undefined && input.fade !== null) {
        this.updatePhysics(input.fade.id, { fade: input.fade.fade });
      }
      if (input.reminder !== undefined && input.reminder !== null) {
        const m = input.reminder;
        if (m.to !== null)
          this.revise(m.to, { eventDate: m.eventDate, meta: m.toMeta, reason: "reminder-carried" });
        this.revise(m.from, { eventDate: null, meta: m.fromMeta, reason: m.to === null ? "reminder-spent" : "reminder-moved" });
      }
      if (input.archive !== undefined && input.archive !== null) {
        this.archive(input.archive.id, input.archive.reason);
      }
      return { pairId, seq };
    });
    this.emit("store.contradiction", out.pairId, { action: "settle", how: input.how, actor: input.actor });
    return out;
  }
  undoContradictionSettle(input) {
    const out = this.mutate("undoContradictionSettle", () => {
      const at = this.nowFn();
      const pair = this.contradiction(input.pairId);
      if (pair === undefined)
        throw new StoreError("CONTRADICTION_UNKNOWN", { id: input.pairId });
      this.ops.run("UPDATE contradiction_settles SET undone = 1 WHERE seq = ? AND pair_id = ?", input.settleSeq, input.pairId);
      this.ops.run(`INSERT INTO contradiction_settles (pair_id, action, how, holds, over, actor, actor_id, why, day, at, undone, detail)
         VALUES (?, 'undo', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`, input.pairId, pair.how, pair.holds, pair.over, input.actor, input.actorId, input.why, input.day, at, JSON.stringify({ ...input.detail ?? {}, undoes: input.settleSeq }));
      const seq = this.ops.get("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
      const states = [[input.pairId, input.state ?? "unsettled"], ...(input.reopen ?? []).map((id) => [id, "unsettled"])];
      for (const [id, state] of states) {
        this.ops.run(`UPDATE contradictions SET state = ?, how = NULL, holds = NULL, over = NULL, via = NULL,
                  settled_day = NULL, raised_day = NULL, updated_at = ? WHERE id = ?`, state, at, id);
      }
      for (const r of input.reapply ?? [])
        this.updatePhysics(r.id, { fade: r.fade });
      if (input.restore !== undefined && input.restore !== null) {
        this.updatePhysics(input.restore.id, { fade: input.restore.fade });
      }
      if (input.rejoinCore !== undefined && input.rejoinCore !== null) {
        const c = input.rejoinCore;
        this.updatePhysics(c.id, { promotedIdentity: c.promoted, lastUsedDay: c.lastUsedDay });
        this.ops.run("UPDATE memories SET band = ?, band_day = ? WHERE id = ?", c.band, c.bandDay, c.id);
      }
      let unarchived = false;
      if (input.unarchive !== undefined && input.unarchive !== null) {
        unarchived = this.restoreSuperseded(input.unarchive.id, input.unarchive.reason);
      }
      if (input.reminderBack !== undefined && input.reminderBack !== null) {
        const m = input.reminderBack;
        if (m.to !== null)
          this.revise(m.to, { eventDate: null, meta: m.toMeta, reason: "reminder-carried-back" });
        this.revise(m.from, { eventDate: m.eventDate, meta: m.fromMeta, reason: "reminder-carried-back" });
      }
      return { seq, unarchived };
    });
    this.emit("store.contradiction", input.pairId, { action: "undo", actor: input.actor });
    return out;
  }
  openDream(input) {
    this.mutate("openDream", () => {
      this.ops.run(`INSERT INTO dreams (id, session, scope, day, date, state, started_at, model, shown)
         VALUES (?, ?, ?, ?, ?, 'begun', ?, ?, ?)`, input.id, input.session ?? null, input.scope ?? null, input.day, input.date ?? null, this.nowFn(), modelOrNull(input.model ?? undefined), JSON.stringify(input.shown ?? []));
    });
    this.emit("store.dream", input.id, { state: "begun", day: input.day });
  }
  updateDream(id, patch) {
    this.mutate("updateDream", () => {
      const row = this.ops.get("SELECT * FROM dreams WHERE id = ?", id);
      if (row === undefined)
        throw new StoreError("ID_UNKNOWN", { id });
      const at = this.nowFn();
      const state = patch.state ?? row.state;
      this.ops.run(`UPDATE dreams SET state = ?, title = ?, journal = ?, finished_at = ?, undone_at = ?,
                session = ?, day = ?, date = ?, shown = ?, started_at = ? WHERE id = ?`, state, patch.title === undefined ? row.title : patch.title, patch.journal === undefined ? row.journal : patch.journal, patch.state === "journaled" ? at : row.finished_at, patch.state === "undone" ? at : row.undone_at, patch.session === undefined ? row.session : patch.session, patch.day ?? row.day, patch.date === undefined ? row.date : patch.date, patch.shown === undefined ? row.shown : JSON.stringify(patch.shown), patch.startedAt ?? row.started_at, id);
    });
    this.emit("store.dream", id, { state: patch.state ?? null });
  }
  recordDreamChange(dreamId, change) {
    const seq = this.mutate("recordDreamChange", () => {
      const next = (this.ops.get("SELECT MAX(seq) AS n FROM dream_changes WHERE dream_id = ?", dreamId)?.n ?? 0) + 1;
      this.ops.run(`INSERT INTO dream_changes (dream_id, seq, action, ref, ref2, detail, at, undone)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`, dreamId, next, change.action, change.ref ?? null, change.ref2 ?? null, JSON.stringify(change.detail ?? {}), this.nowFn());
      return next;
    });
    return seq;
  }
  markDreamChangeUndone(dreamId, seq) {
    this.mutate("markDreamChangeUndone", () => {
      this.ops.run("UPDATE dream_changes SET undone = 1 WHERE dream_id = ? AND seq = ?", dreamId, seq);
    });
  }
  setDreamAsk(input) {
    const wrote = this.mutate("setDreamAsk", () => {
      if (input.state === "offered" || input.state === "launched") {
        this.ops.run("INSERT OR IGNORE INTO dream_asks (date, state, session, day, at) VALUES (?, ?, ?, ?, ?)", input.date, input.state, input.session ?? null, input.day, this.nowFn());
        return (this.ops.get("SELECT changes() AS n")?.n ?? 0) > 0;
      }
      this.ops.run(`INSERT INTO dream_asks (date, state, session, day, at) VALUES (?, 'declined', ?, ?, ?)
         ON CONFLICT (date) DO UPDATE SET state = 'declined', at = excluded.at`, input.date, input.session ?? null, input.day, this.nowFn());
      return true;
    });
    this.emit("store.dream.ask", undefined, { date: input.date, state: input.state, wrote });
    return wrote;
  }
  reclaimDreamAsk(input) {
    const wrote = this.mutate("reclaimDreamAsk", () => {
      this.ops.run("UPDATE dream_asks SET state = ?, session = ?, day = ?, at = ? WHERE date = ? AND at = ? AND state != 'declined'", input.state, input.session ?? null, input.day, this.nowFn(), input.date, input.prevAt);
      return (this.ops.get("SELECT changes() AS n")?.n ?? 0) > 0;
    });
    this.emit("store.dream.ask", undefined, { date: input.date, state: input.state, wrote, again: true });
    return wrote;
  }
  newMemoryIds(filter) {
    return memoryReads.newMemoryIds(this, filter);
  }
  dream(id) {
    return this.ops.get("SELECT * FROM dreams WHERE id = ?", id);
  }
  dreams(filter) {
    return historyReads.dreams(this, filter);
  }
  dreamsShown(filter) {
    return historyReads.dreamsShown(this, filter);
  }
  firstDreamDay() {
    return this.ops.get("SELECT MIN(day) AS d FROM dreams WHERE state != 'undone'")?.d ?? null;
  }
  dreamCount() {
    return this.ops.get("SELECT COUNT(*) AS n FROM dreams")?.n ?? 0;
  }
  dreamChanges(dreamId) {
    return this.ops.all("SELECT * FROM dream_changes WHERE dream_id = ? ORDER BY seq", dreamId);
  }
  openDreamChanges(action, limit = 1000) {
    return this.ops.all(`SELECT c.*, d.date AS dream_date FROM dream_changes c JOIN dreams d ON d.id = c.dream_id
        WHERE c.action = ? AND c.undone = 0 AND d.state != 'undone'
        ORDER BY d.started_at DESC, d.rowid DESC, c.seq ASC LIMIT ?`, action, limit);
  }
  reflectionsWithShare(shareState, limit = 50) {
    return this.ops.all("SELECT * FROM reflections WHERE state = 'reflected' AND share_state = ? ORDER BY started_at DESC, rowid DESC LIMIT ?", shareState, limit);
  }
  dreamAsk(date) {
    return this.ops.get("SELECT * FROM dream_asks WHERE date = ?", date);
  }
  vectorOf(id) {
    try {
      const r = this.cache.get("SELECT vec FROM embeddings WHERE memory_id = ?", id);
      if (r === undefined || r.vec === null || r.vec === undefined)
        return null;
      return Array.from(decodeVector(r.vec));
    } catch {
      return null;
    }
  }
  textVector(text) {
    try {
      if (this.embed === undefined || text.trim().length === 0)
        return null;
      const v = this.embed(text);
      return v === null || !this.rankable(v.length, "textVector") ? null : Array.from(v);
    } catch {
      return null;
    }
  }
  setBand(id, band, day) {
    this.mutate("setBand", () => {
      this.requireRow(id);
      this.ops.run("UPDATE memories SET band = ?, band_day = ? WHERE id = ?", band, day, id);
    });
    this.emit("store.band", id, { band, day });
  }
  link(edge) {
    this.mutate("link", () => {
      const at = this.nowFn();
      this.ops.run(EDGE_UPSERT, edge.src, edge.dst, edge.weight, edge.day, at, at);
    });
    this.emit("store.link", edge.src, { dst: edge.dst, weight: edge.weight });
  }
  linkMany(edges) {
    this.mutate("linkMany", () => {
      const st = this.ops.prepare(EDGE_UPSERT);
      const at = this.nowFn();
      for (const e of edges)
        st.run(e.src, e.dst, e.weight, e.day, at, at);
    });
    this.emit("store.link", undefined, { count: edges.length });
  }
  sweepEdges(filter, dead) {
    const n = this.mutate("sweepEdges", () => {
      const doomed = this.ops.all(`SELECT e.* FROM edges e
            WHERE (e.weight <= ? OR e.last_day <= ?)
              AND NOT EXISTS (SELECT 1 FROM memories m
                               WHERE m.id IN (e.src, e.dst) AND m.protected = 1)`, filter.floor, filter.staleOnOrBefore).filter(dead);
      if (doomed.length === 0)
        return 0;
      const st = this.ops.prepare("DELETE FROM edges WHERE src = ? AND dst = ?");
      for (const e of doomed)
        st.run(e.src, e.dst);
      return doomed.length;
    });
    if (n > 0)
      this.emit("store.edge.swept", undefined, { count: n });
    return n;
  }
  sweepArchivedEdges(reasons, graceMs = 0) {
    if (reasons.length === 0)
      return 0;
    const marks = reasons.map(() => "?").join(", ");
    const cutoff = this.nowFn() - Math.max(0, graceMs);
    const n = this.mutate("sweepArchivedEdges", () => {
      const doomed = this.ops.all(`SELECT e.src, e.dst FROM edges e
          WHERE EXISTS (SELECT 1 FROM memories m
                         WHERE m.id IN (e.src, e.dst) AND m.archived = 1 AND m.archived_reason IN (${marks})
                           AND COALESCE(m.updated_at, 0) <= ?)
            AND NOT EXISTS (SELECT 1 FROM memories m
                             WHERE m.id IN (e.src, e.dst) AND m.protected = 1)`, ...reasons, cutoff);
      if (doomed.length === 0)
        return 0;
      const st = this.ops.prepare("DELETE FROM edges WHERE src = ? AND dst = ?");
      for (const e of doomed)
        st.run(e.src, e.dst);
      return doomed.length;
    });
    if (n > 0)
      this.emit("store.edge.swept", undefined, { count: n, archived: true });
    return n;
  }
  setProspective(entry) {
    this.mutate("setProspective", () => {
      this.requireRow(entry.memoryId);
      const at = this.nowFn();
      this.ops.run(`INSERT INTO prospective
           (memory_id, window_key, event_date, precision, state, fires, last_fired_day,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (memory_id, window_key) DO UPDATE SET
           event_date = excluded.event_date, precision = excluded.precision,
           state = excluded.state, fires = excluded.fires,
           last_fired_day = excluded.last_fired_day, updated_at = excluded.updated_at`, entry.memoryId, entry.windowKey, entry.eventDate, entry.precision, entry.state, entry.fires ?? 0, entry.lastFiredDay ?? null, at, at);
    });
    this.emit("store.prospective", entry.memoryId, {
      window: entry.windowKey,
      state: entry.state
    });
  }
  addFeelings(memoryId, inputs, opts = {}) {
    const { rows, notices, repairs } = checkFeelings(inputs);
    const ids = rows.map(() => `fel_${randomBytes(6).toString("hex")}`);
    this.mutate("addFeelings", () => {
      this.requireRow(memoryId);
      const at = this.nowFn();
      const model = modelOrNull(opts.model);
      const insert = this.ops.prepare(`INSERT INTO feelings
           (id, memory_id, whose, core, emotion, other_word, strength, beneath_id, carried_by, model,
            created_at, updated_at, source, recorded_later, valence, recorded_day)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const today = this.livedDay();
      const later = opts.recordedLater !== undefined && opts.recordedLater.trim().length > 0 ? opts.recordedLater.trim() : null;
      const source = opts.source ?? "session";
      rows.forEach((r, i) => {
        const own = opts.provenance?.[i];
        const first = typeof own?.createdAt === "number" && Number.isFinite(own.createdAt) ? own.createdAt : at;
        insert.run(ids[i], memoryId, r.whose, r.core, r.emotion, r.otherWord, r.strength, r.carriedBy, model, first, at, own?.source ?? source, own === undefined ? later : own.recordedLater ?? null, r.valence, typeof own?.recordedDay === "number" && Number.isFinite(own.recordedDay) ? own.recordedDay : today);
      });
      rows.forEach((r, i) => {
        if (r.beneath === null)
          return;
        let under;
        if (typeof r.beneath === "number") {
          under = ids[r.beneath];
        } else {
          const found = this.ops.get("SELECT memory_id FROM feelings WHERE id = ?", r.beneath);
          if (found === undefined || found.memory_id !== memoryId) {
            throw new StoreError("FEELING_INVALID", { index: i, reason: "beneath-not-on-this-memory" });
          }
          under = r.beneath;
        }
        this.ops.run("UPDATE feelings SET beneath_id = ? WHERE id = ?", under, ids[i]);
      });
    });
    this.emit("store.feelings", memoryId, { count: rows.length, other: notices.filter((n) => n.readAs === undefined).length });
    return { ids, notices, repairs };
  }
  addTraits(memoryId, inputs, opts = {}) {
    const { rows, repairs } = checkTraitsRepaired(inputs);
    const ids = rows.map(() => `trt_${randomBytes(6).toString("hex")}`);
    this.mutate("addTraits", () => {
      this.requireRow(memoryId);
      const at = this.nowFn();
      const model = modelOrNull(opts.model);
      const source = opts.source ?? "session";
      const insert = this.ops.prepare(`INSERT INTO traits (id, memory_id, axis, toward, strength, carried_by, source, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      rows.forEach((r, i) => {
        const own = opts.provenance?.[i];
        insert.run(ids[i], memoryId, r.axis, r.toward, r.strength, r.carriedBy, own === undefined ? source : own.source ?? null, own === undefined ? model : modelOrNull(own.model ?? undefined), own?.createdAt ?? at, at);
      });
    });
    this.emit("store.traits", memoryId, { count: rows.length });
    return { ids, repairs };
  }
  advanceClock(date) {
    const day = this.mutate("advanceClock", () => {
      const last = this.getMeta("lastActiveDate") ?? "";
      if (last !== "" && date < last) {
        if (isDay(date) && isDay(last) && daysBetween(date, last) <= 1) {
          this.emit("store.clock.held", undefined, { date, last });
          return this.livedDay();
        }
        throw new StoreError("CLOCK_BACKWARDS", { date, last });
      }
      if (date === last)
        return this.livedDay();
      const next = this.livedDay() + 1;
      this.ops.run("UPDATE meta SET value = ? WHERE key = 'livedDay'", String(next));
      this.ops.run("UPDATE meta SET value = ? WHERE key = 'lastActiveDate'", date);
      return next;
    });
    this.emit("store.clock", undefined, { livedDay: day, date });
    return day;
  }
  setMeta(key, value) {
    this.mutate("setMeta", () => {
      this.ops.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
    });
    this.emit("store.meta", undefined, { key });
  }
  setMetaMany(entries) {
    this.mutate("setMetaMany", () => {
      for (const [key, value] of entries) {
        this.ops.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
      }
    });
    this.emit("store.meta", undefined, { count: entries.length });
  }
  updateMeta(key, fn) {
    const out = this.mutate("updateMeta", () => {
      const row = this.ops.get("SELECT value FROM meta WHERE key = ?", key);
      const next = fn(row?.value);
      if (next === null)
        this.ops.run("DELETE FROM meta WHERE key = ?", key);
      else if (next !== undefined)
        this.ops.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, next);
      return next;
    });
    this.emit("store.meta", undefined, { key });
    return out;
  }
  setGateRecords(rows) {
    this.assertWritable("setGateRecords");
    if (rows.length === 0)
      return;
    this.ops.transaction(() => {
      const st = this.ops.prepare(`INSERT OR REPLACE INTO gate_session
           (session_id, kind, ref, turn, tier, trains, value, last_day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of rows) {
        st.run(r.sessionId, r.kind, r.ref, r.turn, r.tier ?? null, r.trains === undefined || r.trains === null ? null : r.trains ? 1 : 0, r.value ?? null, r.lastDay);
      }
    });
    this.emit("store.gate.records", undefined, { count: rows.length });
  }
  gateRecords(sessionId, kind) {
    return historyReads.gateRecords(this, sessionId, kind);
  }
  pruneGateSessions() {
    const report = this.mutate("pruneGateSessions", () => {
      const cutoffDay = this.livedDay() - this.retentionDays;
      const doomed = this.ops.get("SELECT COUNT(*) AS n FROM gate_session WHERE last_day < ?", cutoffDay);
      this.ops.run("DELETE FROM gate_session WHERE last_day < ?", cutoffDay);
      return { pruned: doomed?.n ?? 0, cutoffDay, retentionDays: this.retentionDays };
    });
    this.emit("store.gate.pruned", undefined, {
      count: report.pruned,
      cutoffDay: report.cutoffDay
    });
    return report;
  }
  rewriteGateValues(kind, ref, contains, rewrite) {
    const changed = this.mutate("rewriteGateValues", () => {
      const rows = this.ops.all("SELECT session_id, value FROM gate_session WHERE kind = ? AND ref = ? AND value IS NOT NULL AND instr(value, ?) > 0", kind, ref, contains);
      let n = 0;
      for (const row of rows) {
        const next = rewrite(row.value);
        if (next === null || next === row.value)
          continue;
        this.ops.run("UPDATE gate_session SET value = ? WHERE session_id = ? AND kind = ? AND ref = ? AND value = ?", next, row.session_id, kind, ref, row.value);
        n++;
      }
      return n;
    });
    this.emit("store.gate.rewritten", undefined, { kind, count: changed });
    return changed;
  }
  appendEvent(input) {
    const seq = this.mutate("appendEvent", () => {
      this.ops.run(`INSERT OR IGNORE INTO events (at, day, name, ref, dedup_key, payload)
         VALUES (?, ?, ?, ?, ?, ?)`, this.nowFn(), input.day, input.name, input.ref ?? null, input.dedupKey ?? null, input.payload === undefined || input.payload === null ? null : JSON.stringify(input.payload));
      const row = this.ops.get("SELECT changes() AS n");
      if ((row?.n ?? 0) === 0)
        return 0;
      return this.ops.get("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
    });
    this.emit("store.event.appended", input.ref ?? undefined, {
      name: input.name,
      seq,
      deduped: seq === 0
    });
    return seq;
  }
  eventLog(filter) {
    return historyReads.eventLog(this, filter);
  }
  eventCounts(filter) {
    return historyReads.eventCounts(this, filter);
  }
  eventNames() {
    return this.ops.all("SELECT DISTINCT name FROM events ORDER BY name").map((r) => r.name);
  }
  pruneEvents(opts = {}) {
    const limit = opts.limit === undefined ? null : Math.max(0, Math.floor(opts.limit));
    const report = this.mutate("pruneEvents", () => {
      const cutoffDay = this.livedDay() - this.retentionDays;
      const eligible = this.ops.get("SELECT COUNT(*) AS n FROM events WHERE day < ? AND dedup_key IS NULL", cutoffDay)?.n ?? 0;
      if (limit === null) {
        this.ops.run("DELETE FROM events WHERE day < ? AND dedup_key IS NULL", cutoffDay);
      } else {
        this.ops.run(`DELETE FROM events WHERE seq IN (
             SELECT seq FROM events WHERE day < ? AND dedup_key IS NULL
             ORDER BY seq ASC LIMIT ?)`, cutoffDay, limit);
      }
      const pruned = this.ops.get("SELECT changes() AS n")?.n ?? 0;
      return {
        pruned,
        eligible,
        remaining: eligible - pruned,
        limit,
        cutoffDay,
        retentionDays: this.retentionDays
      };
    });
    this.emit("store.events.pruned", undefined, {
      count: report.pruned,
      eligible: report.eligible,
      remaining: report.remaining,
      limit: report.limit,
      cutoffDay: report.cutoffDay,
      retentionDays: report.retentionDays
    });
    return report;
  }
  eventLogCensus() {
    return historyReads.eventLogCensus(this);
  }
  setRanking(rows) {
    this.assertWritable("setRanking");
    if (rows.length === 0)
      return;
    this.cache.transaction(() => {
      const st = this.cache.prepare("INSERT OR REPLACE INTO ranking (memory_id, strength, band, day) VALUES (?, ?, ?, ?)");
      for (const r of rows)
        st.run(r.id, r.strength, r.band, r.day);
    });
    this.emit("store.ranking", undefined, { count: rows.length });
  }
  dropRanking(ids) {
    this.assertWritable("dropRanking");
    if (ids.length === 0)
      return;
    this.cache.transaction(() => {
      const st = this.cache.prepare("DELETE FROM ranking WHERE memory_id = ?");
      for (const id of ids)
        st.run(id);
    });
  }
  turnDownDue(day) {
    return this.ops.all("SELECT id FROM memories WHERE archived = 0 AND (next_change_day IS NULL OR next_change_day <= ?) ORDER BY id", day).map((r) => r.id);
  }
  setNextChangeDays(rows) {
    this.assertWritable("setNextChangeDays");
    if (rows.length === 0)
      return;
    this.ops.transaction(() => {
      const st = this.ops.prepare("UPDATE memories SET next_change_day = ? WHERE id = ?");
      for (const r of rows)
        st.run(r.day, r.id);
    });
  }
  bornOn(day) {
    return this.ops.all("SELECT kind, COUNT(*) AS n FROM memories WHERE birth_day = ? AND type != 'episode' GROUP BY kind", day);
  }
  belowReachCount() {
    return memoryReads.belowReachCount(this);
  }
  claimsEra() {
    return memoryReads.claimsEra(this);
  }
  clearNextChangeDays() {
    this.assertWritable("clearNextChangeDays");
    this.ops.run("UPDATE memories SET next_change_day = NULL WHERE next_change_day IS NOT NULL");
  }
  ranking(id) {
    const row = this.cache.get("SELECT * FROM ranking WHERE memory_id = ?", id);
    return row === undefined ? undefined : { id: row.memory_id, strength: row.strength, band: row.band, day: row.day };
  }
  rankingAll() {
    return historyReads.rankingAll(this);
  }
  pruneSupersededVersions() {
    const report = this.mutate("pruneSupersededVersions", () => {
      const cutoffDay = this.livedDay() - this.retentionDays;
      const doomed = this.ops.all("SELECT * FROM versions WHERE version_day < ?", cutoffDay);
      this.ops.run("DELETE FROM versions WHERE version_day < ?", cutoffDay);
      return { pruned: doomed.length, cutoffDay, retentionDays: this.retentionDays };
    });
    this.emit("store.versions.pruned", undefined, {
      count: report.pruned,
      cutoffDay: report.cutoffDay,
      retentionDays: report.retentionDays
    });
    return report;
  }
  appendRemovalRecord(note) {
    const seq = this.mutate("appendRemovalRecord", () => {
      this.ops.run("INSERT INTO removal_record (memory_id, stage, at, actor, reason) VALUES (?, ?, ?, ?, ?)", note.memoryId, note.stage, this.nowFn(), note.actor, note.reason ?? null);
      const row = this.ops.get("SELECT last_insert_rowid() AS seq");
      return row?.seq ?? 0;
    });
    this.emit("store.removal.recorded", note.memoryId, { stage: note.stage, seq });
    return seq;
  }
  rebuildCache(opts = {}) {
    this.assertWritable("rebuildCache");
    const keepVectors = opts.keepVectors === true;
    const heldVectors = keepVectors ? new Set(this.cache.all("SELECT memory_id FROM embeddings").map((r) => r.memory_id)) : new Set;
    const droppingVectors = keepVectors ? 0 : embeddingCount(this.cache);
    const endingHold = keepVectors ? null : heldEmbedder(this.cache);
    resetCache(this.cache, { keepEmbeddings: keepVectors });
    const denied = new Set(this.deniedIds());
    const rows = this.ops.all("SELECT * FROM memories ORDER BY id");
    let indexed = 0;
    let skippedDenied = 0;
    let skippedArchived = 0;
    let unrecomputed = 0;
    for (const row of rows) {
      if (denied.has(row.id)) {
        skippedDenied += 1;
        this.emit("cache.rebuild.denied", row.id, {});
        continue;
      }
      if (row.archived === 1 || row.superseded_by !== null) {
        skippedArchived += 1;
        continue;
      }
      const text = indexTextOf(row.title, row.body);
      const held = keepVectors && heldVectors.has(row.id);
      const vec = held ? null : this.embed ? this.embed(text) : null;
      if (vec !== null) {
        if (indexDoc(this.cache, row.id, text, vec) !== null)
          unrecomputed += 1;
      } else {
        indexDoc(this.cache, row.id, text);
        if (!held)
          unrecomputed += 1;
      }
      indexed += 1;
    }
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
          } else
            keptVectors += 1;
        }
      });
    }
    const declared = unrecomputed === 0 && (this.embed !== undefined || keepVectors) ? [] : [
      {
        what: "embeddings",
        owner: "encode/ (the embedder)",
        repair: "Store.open({ embed }) then rebuildCache()"
      }
    ];
    const report = {
      indexed,
      skippedDenied,
      skippedArchived,
      unrecomputed,
      declared,
      keptVectors,
      droppedVectors
    };
    this.emit("cache.rebuild", undefined, {
      indexed,
      skippedDenied,
      skippedArchived,
      unrecomputed,
      keptVectors,
      droppedVectors,
      declaredKinds: declared.map((d) => d.what).join(",") || "none"
    });
    if (droppingVectors > 0 || endingHold !== null) {
      try {
        this.appendEvent({
          name: EMBEDDER_RECONCILED_EVENT,
          day: this.livedDay(),
          payload: { kind: "dropped", by: "rebuildCache", dropped: droppingVectors, releasedHold: endingHold }
        });
      } catch {}
    }
    return report;
  }
  pruneDeadIndex() {
    this.assertWritable("pruneDeadIndex");
    const live = new Set(this.list({ archived: false }));
    const indexed = this.cache.all("SELECT DISTINCT memory_id FROM doc_tokens").map((r) => r.memory_id);
    let removed = 0;
    for (const id of indexed) {
      if (live.has(id))
        continue;
      deindexDoc(this.cache, id);
      removed += 1;
    }
    if (removed > 0)
      this.emit("cache.prune.dead", undefined, { removed });
    return removed;
  }
  embedOne(id) {
    this.assertWritable("embedOne");
    if (this.isDenied(id))
      return { found: false, vector: false };
    const row = this.row(id);
    if (row === undefined)
      return { found: false, vector: false };
    let doc;
    try {
      doc = this.readProse(id);
    } catch {
      return { found: false, vector: false };
    }
    const vec = this.embed && !noVector(doc.type, doc.meta["role"]) ? this.embed(indexText(doc)) : null;
    if (vec === null)
      return { found: true, vector: false };
    const refused = setEmbedding(this.cache, id, vec);
    if (refused !== null) {
      this.emit("cache.vector.refused", id, { site: "embedOne", reason: refused });
      return { found: true, vector: false, refused };
    }
    return { found: true, vector: true };
  }
  missingVectors(limit = 64) {
    return this.unembeddedIds(limit, false);
  }
  skippedVectorIds() {
    return this.unembeddedIds(Number.MAX_SAFE_INTEGER, true);
  }
  unembeddedIds(limit, skipped) {
    const embedded = new Set(this.cache.all("SELECT memory_id FROM embeddings").map((r) => r.memory_id));
    const denied = new Set(this.deniedIds());
    const failures = this.metaWithPrefix(EMBED_FAILED_PREFIX);
    const givenUp = (id) => Number(failures.get(`${EMBED_FAILED_PREFIX}${id}`) ?? "0") >= EMBED_SKIP_AFTER;
    const rows = this.ops.all(`SELECT id, type, meta FROM memories
        WHERE archived = 0 AND superseded_by IS NULL
        ORDER BY CASE WHEN source IN ('authored', 'episode') OR type = 'episode' THEN 0 ELSE 1 END,
                 birth_day ASC, id ASC`);
    const out = [];
    for (const r of rows) {
      if (embedded.has(r.id) || denied.has(r.id))
        continue;
      if (notForEmbedding(r))
        continue;
      if (givenUp(r.id) !== skipped)
        continue;
      out.push(r.id);
      if (out.length >= limit)
        break;
    }
    return out;
  }
  unembeddedCount() {
    return this.missingVectors(Number.MAX_SAFE_INTEGER).length;
  }
  metaWithPrefix(prefix) {
    const pattern = `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.ops.all(`SELECT key, value FROM meta WHERE key LIKE ? ESCAPE '\\'`, pattern);
    return new Map(rows.map((r) => [r.key, r.value]));
  }
  embeddingCount() {
    return embeddingCount(this.cache);
  }
  has(id) {
    return this.row(id) !== undefined;
  }
  row(id) {
    return memoryReads.row(this, id);
  }
  read(id) {
    return memoryReads.read(this, id);
  }
  readProse(id) {
    return this.read(id).doc;
  }
  physicsOf(id) {
    return rowToPhysics(this.requireRow(id));
  }
  resolve(id) {
    return memoryReads.resolve(this, id);
  }
  list(filter = {}) {
    const { clause, args } = memoryWhere(filter);
    const sql = `SELECT id FROM memories ${clause} ORDER BY id`;
    return this.ops.all(sql, ...args).map((r) => r.id);
  }
  copiesOf(refs) {
    return memoryReads.copiesOf(this, refs);
  }
  workCandidates(scope, limit) {
    return memoryReads.workCandidates(this, scope, limit);
  }
  planCandidates(input) {
    return memoryReads.planCandidates(this, input);
  }
  countMemories(filter = {}) {
    const { clause, args } = memoryWhere(filter);
    const sql = `SELECT COUNT(*) AS n FROM memories ${clause}`;
    return this.ops.get(sql, ...args)?.n ?? 0;
  }
  datedMemories(from, to, opts) {
    return memoryReads.datedMemories(this, from, to, opts);
  }
  recurringMemories(opts) {
    return memoryReads.recurringMemories(this, opts);
  }
  feelingsFor(memoryId) {
    return this.ops.all("SELECT * FROM feelings WHERE memory_id = ? ORDER BY created_at, rowid", memoryId);
  }
  feelingsSince(sinceMs) {
    return this.ops.all(`SELECT f.* FROM feelings f JOIN memories m ON m.id = f.memory_id
        WHERE f.created_at >= ? AND m.archived = 0 AND m.superseded_by IS NULL${this.notMergedAway("m")}
        ORDER BY f.created_at DESC, f.rowid DESC`, sinceMs);
  }
  feelingsLive() {
    return this.ops.all(`SELECT f.*, m.birth_day AS birth_day FROM feelings f JOIN memories m ON m.id = f.memory_id
        WHERE m.archived = 0 AND m.superseded_by IS NULL${this.notMergedAway("m")}
        ORDER BY f.created_at, f.rowid`);
  }
  notMergedAway(m) {
    if (!this.hasTable("contradictions"))
      return "";
    return ` AND ${m}.id NOT IN (SELECT over FROM contradictions WHERE state = 'settled' AND source = 'dream-merge' AND over IS NOT NULL)`;
  }
  feelingsOn(ids) {
    return markReads.feelingsOn(this, ids);
  }
  emotionCensus(opts) {
    return markReads.emotionCensus(this, opts);
  }
  feelingCounts(opts) {
    return markReads.feelingCounts(this, opts);
  }
  hasTable(name) {
    if (this.tablesSeen.has(name))
      return true;
    const found = this.ops.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", name);
    if ((found?.n ?? 0) > 0) {
      this.tablesSeen.add(name);
      return true;
    }
    return false;
  }
  hasColumn(table, column) {
    try {
      return this.ops.all(`PRAGMA table_info(${table.replace(/[^A-Za-z0-9_]/g, "")})`).some((c) => c.name === column);
    } catch {
      return false;
    }
  }
  subjectFinder = null;
  findSubjectsWith(finder) {
    this.subjectFinder = finder;
  }
  relinkSubjects(id, title, body, via = "write") {
    const finder = this.subjectFinder;
    if (finder === null)
      return;
    try {
      if (!this.hasTable("memory_subjects"))
        return;
      const want = new Set(finder(title === null || title.length === 0 ? body : `${title}
${body}`).filter((s) => s !== id));
      const have = this.ops.all("SELECT subject_id FROM memory_subjects WHERE memory_id = ?", id).map((r) => r.subject_id);
      for (const s of have) {
        if (!want.has(s))
          this.ops.run("DELETE FROM memory_subjects WHERE memory_id = ? AND subject_id = ?", id, s);
      }
      const at = this.nowFn();
      for (const s of [...want].sort()) {
        this.ops.run("INSERT OR IGNORE INTO memory_subjects (memory_id, subject_id, via, created_at) VALUES (?, ?, ?, ?)", id, s, via, at);
      }
    } catch (err) {
      this.emit("store.subjects.failed", id, { code: err instanceof StoreError ? err.code : "UNKNOWN" });
    }
  }
  linkSubjects(links, via) {
    return this.mutate("linkSubjects", () => {
      if (!this.hasTable("memory_subjects"))
        return 0;
      const insert = this.ops.prepare("INSERT OR IGNORE INTO memory_subjects (memory_id, subject_id, via, created_at) VALUES (?, ?, ?, ?)");
      const at = this.nowFn();
      let added = 0;
      for (const l of links) {
        if (l.memoryId === l.subjectId)
          continue;
        insert.run(l.memoryId, l.subjectId, via, at);
        added += (this.ops.get("SELECT changes() AS n")?.n ?? 0) > 0 ? 1 : 0;
      }
      return added;
    });
  }
  subjectsOf(memoryId) {
    if (!this.hasTable("memory_subjects"))
      return [];
    return this.ops.all("SELECT subject_id FROM memory_subjects WHERE memory_id = ? ORDER BY subject_id", memoryId).map((r) => r.subject_id);
  }
  subjectLinksOf(memoryId) {
    return markReads.subjectLinksOf(this, memoryId);
  }
  memoriesNaming(subjectId, opts) {
    return markReads.memoriesNaming(this, subjectId, opts);
  }
  recallRows() {
    return memoryReads.recallRows(this);
  }
  memoryTexts() {
    return this.ops.all("SELECT id, title, body FROM memories WHERE type = 'memory' AND body != '' ORDER BY id");
  }
  liveMemoryTexts() {
    return this.ops.all("SELECT id, title, body, birth_day AS day, kind FROM memories WHERE type = 'memory' AND archived = 0 AND body != '' ORDER BY id");
  }
  cardTombstoneLinks() {
    return markReads.cardTombstoneLinks(this);
  }
  subjectLinkCount() {
    return markReads.subjectLinkCount(this);
  }
  writeFieldShare(since) {
    return memoryReads.writeFieldShare(this, since);
  }
  tablesSeen = new Set;
  traitReads(rows, includeConfidential) {
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
        withheld
      };
    });
  }
  traitsFor(memoryId, opts) {
    return markReads.traitsFor(this, memoryId, opts);
  }
  traitsOn(ids, opts) {
    return markReads.traitsOn(this, ids, opts);
  }
  traitsAll(opts) {
    return markReads.traitsAll(this, opts);
  }
  traitCensus(opts) {
    return markReads.traitCensus(this, opts);
  }
  versions(id) {
    return this.ops.all("SELECT * FROM versions WHERE memory_id = ? ORDER BY seq", id);
  }
  readVersion(id, seq) {
    return memoryReads.readVersion(this, id, seq);
  }
  faultedIds() {
    return this.ops.all("SELECT id FROM memories WHERE body = '' AND content_hash <> '' ORDER BY id").map((r) => r.id);
  }
  edgesFrom(src) {
    return this.ops.all("SELECT * FROM edges WHERE src = ? ORDER BY dst", src);
  }
  allEdges() {
    return this.ops.all("SELECT * FROM edges ORDER BY src, dst");
  }
  memoriesWrittenSince(at) {
    return memoryReads.memoriesWrittenSince(this, at);
  }
  memoryCountsByScopeSince(at, opts) {
    return memoryReads.memoryCountsByScopeSince(this, at, opts);
  }
  openThreadIds() {
    return this.ops.all(`SELECT id FROM memories
          WHERE type = 'memory' AND archived = 0 AND meta LIKE '%"unresolved":true%'
          ORDER BY birth_day, id`).map((r) => r.id);
  }
  memoriesOfSession(session) {
    return memoryReads.memoriesOfSession(this, session);
  }
  prospectiveFor(id) {
    return this.ops.all("SELECT * FROM prospective WHERE memory_id = ? ORDER BY window_key", id);
  }
  prospectiveMemoryIds() {
    return this.ops.all("SELECT DISTINCT memory_id FROM prospective ORDER BY memory_id").map((r) => r.memory_id);
  }
  removalRecord(id) {
    return memoryReads.removalRecord(this, id);
  }
  tombstones() {
    return memoryReads.tombstones(this);
  }
  deniedIds() {
    return this.ops.all("SELECT DISTINCT memory_id FROM removal_record WHERE stage IN ('dark', 'chased', 'complete')").map((r) => r.memory_id);
  }
  search(cue, limit = 10, norm = DEFAULT_LENGTH_NORM, opts = {}) {
    return searchIndex(this.cache, cue, limit, norm, opts.minStrength ?? null);
  }
  docFrequency(tokens) {
    return docFrequency(this.cache, tokens);
  }
  nearestTo(vec, limit = 10, opts = {}) {
    if (!this.rankable(vec.length, "nearestTo"))
      return [];
    return nearest(this.cache, vec, limit, opts.minStrength ?? null);
  }
  neighbourReader() {
    return memoryReads.neighbourReader(this);
  }
  neighbourVectors(vec, limit = 10) {
    if (!this.rankable(vec.length, "neighbourVectors"))
      return [];
    return nearestVectors(this.cache, vec, limit);
  }
  rankingIdentity() {
    const v = this.embedderVerdict.kind;
    if (v === "held" || v === "cache-ahead")
      return null;
    try {
      if (searchRefusal(this.cache, this.identity, this.identity?.dim ?? 0) !== null)
        return null;
      return recordedEmbedder(this.cache)?.tag ?? null;
    } catch {
      return null;
    }
  }
  rankable(dim, site) {
    const v = this.embedderVerdict.kind;
    if (v === "held" || v === "cache-ahead")
      return false;
    const refused = searchRefusal(this.cache, this.identity, dim);
    if (refused === null)
      return true;
    this.emit("cache.vector.refused", undefined, { site, reason: refused });
    return false;
  }
  livedDay() {
    return Number(this.getMeta("livedDay") ?? "0");
  }
  getMeta(key) {
    return this.ops.get("SELECT value FROM meta WHERE key = ?", key)?.value;
  }
  requireRow(id) {
    this.refuseIfDenied(id);
    const row = this.row(id);
    if (row === undefined)
      throw new StoreError("ID_UNKNOWN", { id });
    return row;
  }
  isDenied(id) {
    const denied = this.ops.get("SELECT COUNT(*) AS n FROM removal_record WHERE memory_id = ? AND stage IN ('dark','chased','complete')", id);
    return (denied?.n ?? 0) > 0;
  }
  refuseIfDenied(id) {
    if (this.isDenied(id))
      throw new StoreError("REMOVED", { id, by: "owner" });
  }
  insertOne(input) {
    const id = input.id ?? newId(input.type);
    assertIdWellFormed(id);
    if (!id.startsWith(`${ID_PREFIX[input.type]}_`)) {
      throw new StoreError("ID_MALFORMED", { id, type: input.type });
    }
    if (this.has(id) || this.isDenied(id))
      throw new StoreError("ID_TAKEN", { id });
    const body = bodyForStorage(input.body, id);
    const day = this.livedDay();
    const meta = { ...input.meta ?? {} };
    if (input.source !== undefined)
      meta["source"] = input.source;
    if (input.origin !== undefined) {
      const origin = {};
      if (input.origin.session !== undefined)
        origin["session"] = input.origin.session;
      if (input.origin.scope !== undefined)
        origin["scope"] = input.origin.scope;
      if (input.origin.ref !== undefined)
        origin["ref"] = input.origin.ref;
      if (input.origin.spanHash !== undefined)
        origin["spanHash"] = input.origin.spanHash;
      if (Object.keys(origin).length > 0)
        meta["origin"] = origin;
    }
    const eventDate = input.eventDate === undefined ? undefined : assertEventDate(input.eventDate, id);
    const at = this.nowFn();
    const doc = {
      id,
      type: input.type,
      learnedOn: input.learnedOn ?? localDate(at, this.zone()),
      bornDay: input.physics?.birthDay ?? day,
      meta,
      body
    };
    if (input.title !== undefined)
      doc.title = input.title;
    if (input.happenedOn !== undefined)
      doc.happenedOn = input.happenedOn;
    if (eventDate !== undefined)
      doc.eventDate = eventDate;
    const metaJson = serializeMeta(meta, id);
    const contentHash = hashText(doc.body);
    const s = {
      novelty: input.salience?.novelty ?? null,
      relevance: input.salience?.relevance ?? 0,
      emotional: input.salience?.emotional ?? 0,
      predictive: input.salience?.predictive ?? 0,
      claimed: input.salience?.claimed ?? null
    };
    this.ops.run(`INSERT INTO memories (
         id, type, kind, band, band_day, novelty, relevance, emotional, predictive,
         claimed, birth_day, uses, last_used_day, reinforced_days, consolidated,
         promoted_identity, protected, pressure, last_challenged_day, archived,
         archived_reason, superseded_by, revision, content_hash,
         learned_on, happened_on, source, origin_session, origin_scope, origin_ref,
         title, body, meta, confidential, created_at, updated_at, model, event_date, legacy,
         about, about_by, occurred_on, said_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, input.type, input.kind, input.band ?? "episodic", day, s.novelty, s.relevance, s.emotional, s.predictive, s.claimed ?? null, doc.bornDay, input.physics?.uses ?? 0, input.physics?.lastUsedDay ?? day, input.physics?.reinforcedDays ?? 0, input.physics?.consolidated ? 1 : 0, input.physics?.promotedIdentity ? 1 : 0, input.physics?.protected ? 1 : 0, input.physics?.pressure ?? 0, input.physics?.lastChallengedDay ?? null, contentHash, doc.learnedOn, doc.happenedOn ?? null, input.source ?? null, input.origin?.session ?? null, input.origin?.scope ?? null, input.origin?.ref ?? null, doc.title ?? null, doc.body, metaJson, confidentialByMeta(meta) ? 1 : 0, at, at, modelOrNull(input.model), doc.eventDate ?? null, input.physics?.legacy === true ? 1 : 0, input.about !== undefined && aboutMarkOf(input.about) !== null ? input.about : null, input.about !== undefined && aboutMarkOf(input.about) !== null ? input.aboutBy ?? "writer" : null, input.occurredOn === undefined ? null : occurredOnOf(input.occurredOn), input.saidBy === undefined ? null : saidByOf(input.saidBy), input.status === undefined ? null : statusOf(input.status));
    if (input.type === "memory")
      this.relinkSubjects(id, doc.title ?? null, doc.body, "write");
    return doc;
  }
  docOf(row) {
    if (row.body.length === 0) {
      throw new StoreError("MEMORY_BODY_MISSING", {
        id: row.id,
        tombstoned: rowTombstoned(row)
      });
    }
    const doc = {
      id: row.id,
      type: row.type,
      learnedOn: row.learned_on,
      bornDay: row.birth_day,
      meta: parseMeta(row.meta, row.id),
      body: row.body
    };
    if (row.title !== null)
      doc.title = row.title;
    if (row.happened_on !== null)
      doc.happenedOn = row.happened_on;
    if (row.event_date !== null)
      doc.eventDate = row.event_date;
    return doc;
  }
  versionDoc(id, version) {
    if (version.body.length === 0) {
      throw new StoreError("MEMORY_BODY_MISSING", { id, seq: version.seq });
    }
    const head = this.row(id);
    const doc = {
      id,
      type: head?.type ?? "memory",
      learnedOn: version.learned_on,
      bornDay: head?.birth_day ?? 0,
      meta: parseMeta(version.meta, id),
      body: version.body
    };
    if (version.title !== null)
      doc.title = version.title;
    if (version.happened_on !== null)
      doc.happenedOn = version.happened_on;
    if (version.event_date !== null)
      doc.eventDate = version.event_date;
    return doc;
  }
  refillVectorsInline() {
    const embed = this.embed;
    if (embed === undefined)
      return;
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
          let doc;
          try {
            doc = this.readProse(id);
          } catch {
            skipped += 1;
            continue;
          }
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
      ms: Math.round(performance.now() - t0)
    });
  }
  indexOne(doc) {
    const text = indexText(doc);
    const vec = this.embed && !noVector(doc.type, doc.meta["role"]) ? this.embed(text) : null;
    if (vec === null) {
      indexDoc(this.cache, doc.id, text);
      return;
    }
    const refused = indexDoc(this.cache, doc.id, text, vec);
    if (refused !== null) {
      this.emit("cache.vector.refused", doc.id, { site: "put", reason: refused });
      return;
    }
    try {
      if (this.rankable(vec.length, "neighbours")) {
        writeNeighbours(this.cache, doc.id, nearest(this.cache, vec, NEIGHBOURS_KEPT + 1));
      }
    } catch {}
  }
}
function preRowsRemedy(dir, found) {
  if (!existsSync(paths.operational(dir)))
    return { readableBy: PRE_ROWS_READABLE_BY };
  const leftovers = found.filter((n) => n !== DATABASE_FILE).join(", ");
  if (preRowsLeftoversAreEmpty(dir)) {
    return {
      alsoFound: DATABASE_FILE,
      remedy: `${DATABASE_FILE} is THIS build's store. Beside it are ${leftovers} (and possibly tmp/), ` + `which an older build leaves behind when it is pointed at a store like this one — its ` + `prose/ and versions/ are empty here. MOVE THOSE OUT of this directory into a folder of ` + `their own; do not delete them, and do not delete ${DATABASE_FILE}. This store then opens ` + `again with every memory in it. If you moved prose/ aside yourself, that operational.sqlite ` + `is your PRE-ROWS store and the words that go with it are wherever you put them — keep both, ` + `and open it with the build tagged ${PRE_ROWS_READABLE_BY}.`
    };
  }
  return {
    alsoFound: DATABASE_FILE,
    remedy: `this directory holds TWO stores' names — a pre-rows store (${leftovers}, WITH FILES IN IT) ` + `and a ${DATABASE_FILE}. DELETE NEITHER. Move one of them out into a directory of its own and ` + `point at the one you mean; the pre-rows half is read by the build tagged ${PRE_ROWS_READABLE_BY}.`
  };
}
export function newId(type) {
  return `${ID_PREFIX[type]}_${randomBytes(6).toString("hex")}`;
}
export function dateOf(at) {
  return utcDate(at);
}
export function today() {
  return utcDate(Date.now());
}
function modelOrNull(model) {
  return model !== undefined && isModelId(model) ? model : null;
}
function assertEventDate(date, id) {
  if (!isCalendarDate(date))
    throw new StoreError("EVENT_DATE_INVALID", { id, date: String(date).slice(0, 64) });
  return date.trim();
}
const EDGE_UPSERT = `INSERT INTO edges (src, dst, weight, last_day, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (src, dst) DO UPDATE SET
    weight = excluded.weight, last_day = excluded.last_day, updated_at = excluded.updated_at`;
export function storeExists(dir = dataDir()) {
  return existsSync(paths.operational(dir)) || preRowsMarkersIn(dir).length > 0;
}
