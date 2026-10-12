/**
 * `Counterpart` — the composition root: one brain over one data dir.
 *
 * Every module below this file is deliberately ignorant of its neighbours, and
 * every seam between them is already closed and proved (`docs/SEAMS.md` items
 * 1–3 and A–N). What was still missing was a place where all of them are
 * assembled ONCE, so an adapter composes a brain instead of re-deriving the
 * wiring — which is how a caller "forgets the map and silently loses the safety
 * half that rides along with it" (recall/INTERFACE-GAPS §2, scar §2.6).
 *
 * **This file is wiring. It states no rule of its own.**
 *
 * That is not a style note, it is a mechanized property: `test/counterpart.test.ts`
 * scans this source with comments and string literals stripped and fails on any
 * numeric literal other than 0 or 1. Every number that governs behaviour —
 * budgets, floors, chunk sizes, candidate limits, retention — arrives as an
 * argument or as an import from the module that owns it. A threshold invented
 * here would be a threshold with no home, no CAL marking and no test
 * (scar §2.8), and a host ceiling invented here would be scar §2.18 exactly.
 *
 * The four things this file DOES decide, all of them structural:
 *
 *   1. **Construction order.** `associate` exists before `schemas`, because
 *      `SchemasOptions.retarget` (SEAMS E) is the callback that keeps a
 *      successor from being born cold.
 *   2. **The gates are always wired.** `bridge.batteryGate()` on the authored
 *      front door, `bridge.episodeGate()` on `self/` (SEAMS H — self's own
 *      default REFUSES, and this is what makes that unreachable in production),
 *      and `bridge.gateSweepChunk()` on the fallback, chunk-level (SEAMS 1).
 *   3. **The channel is engine-set.** `"authored"` for the session-end dump and
 *      the jot; `"fallback"` for anything a transcript sweep produced. No
 *      author field and no interpreter output can move it (SEAMS N).
 *   4. **The host's ceiling travels as an argument.** `wake(budgetBytes)` is
 *      where the host reports it; the same number is what `runCycle` hands the
 *      renderer at the boundary. Absent, the briefing REFUSES to render and says
 *      so — an invented ceiling is the failure scar §2.18 records.
 */
import { randomUUID } from "node:crypto";

import { Associate, appendPendingDeltas, claimPending, releasePending } from "./associate/index.js";
import type { CoactivateResult, Credited, FlushReport, PairDelta, PendingClaim } from "./associate/index.js";
import { horizonFor } from "./briefing.js";
import { episodeGate } from "./bridge.js";
import { Dreams, Reflections } from "./dream/index.js";
import { meetingDay } from "./onboarding.js";
import type { VectorSource } from "./bridge.js";
import type { MintResult } from "./mint.js";
import { isObserver } from "./observer.js";
import type { Stance } from "./observer.js";
import { Prospective } from "./prospective/index.js";
import type { PlainDue } from "./prospective/index.js";
import {
  ASKED_KIND,
  ASKED_MAX,
  askedTurn,
  Recall,
  headOf,
  judgedThrough,
  loadGateState,
  loadSessionSemantic,
  markJudged,
  saveSessionSemantic,
} from "./recall/index.js";
import { DREW_ON_MAX_PER_BOUNDARY, resolveReferences } from "./recall/reference.js";
import type { ReferenceCandidate } from "./recall/reference.js";
import type {
  CreditResult,
  GateState,
  RecallDecision,
  Turn as RecallTurn,
  RecallResult,
  SemanticReason,
} from "./recall/index.js";
import {
  SpanBuffer,
  TUNABLES as REMEMBER,
  errCode,
} from "./remember/index.js";
import type {
  BoundaryKind,
  BoundaryRecord,
  CaptureResult,
  InterpretFn,
  Proposal,
  ProposalSource,
  SubmitResult,
  SweepChunk,
  SweepReport,
  Turn as CapturedTurn,
  UpdatesResolution,
} from "./remember/index.js";
import { redactSecrets } from "./encode/index.js";
import type { SchemaSlice as EncodeSchemaSlice } from "./encode/index.js";
import { recallTurn } from "./retrieval.js";
import { applyRevision } from "./revision.js";
import type { RevisionApplication } from "./revision.js";
import {
  CORRECTED_REASON,
  settle as settleContradiction,
  settleMovedReminders,
  undo as undoContradiction,
  writeNeighbours,
} from "./reconsolidation.js";
import type { HeldUpdate, Neighbour, SettleInput, SettleOutcome, SlotOutcome, UndoOutcome } from "./reconsolidation.js";
import { Schemas } from "./schemas/index.js";
import {
  HANDOFF_CLEARED_EVENT,
  HANDOFF_SHOWN_EVENT,
  HANDOFF_WRITTEN_EVENT,
  HANDOFF_REFUSED_EVENT,
  HANDOFF_RESERVE_MARGIN_BYTES,
  reserveBytes,
  Handoffs,
  isHandoffRow,
  staleWords,
} from "./handoff/index.js";
import type { Handoff, HandoffRefusal, HandoffWrite, PointerSince } from "./handoff/index.js";
import { CLAIM_CHAPTER, askFromStretch, chapterClaims, claimUnwritten, sessionStretch, sessionsHere, workSince } from "./coverage/index.js";
import { LAST_HERE_LIFE_DAYS, LAST_HERE_NOROOM_EVENT, chaptersBySession, chaptersHere, chaptersOn, elsewhereLine, lastHereLadder, sinceElsewhereLines, stampWords, todayElsewhereLines, yesterdayLine, yesterdayShorter } from "./handoff/last-here.js";
import type { ChapterHere, LastHere, SinceElsewhere, TodayElsewhere } from "./handoff/last-here.js";
import { LAST_EXCHANGE_LINE_MAX_BYTES, exchangeLikely, lastExchange, lastExchangeLine, withExchange } from "./handoff/last-exchange.js";
import type { LastExchange } from "./handoff/last-exchange.js";
import { addDays, isDay, localStamp, localStampAfter, startOfLocalDay } from "./time.js";
import type { Recurrence } from "./time.js";
import { EPISODE_REGROWN_REASON, leftAs } from "./leaving.js";
import type { LeftAs } from "./leaving.js";
import {
  BRIEFING_KEY,
  NIGHT_WRITER_MEMORY_MAX,
  NIGHT_WRITER_TOOL,
  PREFACE_RESERVE_BYTES,
  Self,
  byteLength,
  markWakeBehind,
  nearDue,
  pageRoomNote,
  readSentinel,
  settledOver,
  threadsShown,
  spliceBeforeSentinel,
  WORK_OVERFLOW_EVENT,
  rotateWork,
  workHere,
  workHereBlock,
  workHereBytes,
  writerInstruction,
  fitNightWriter,
} from "./self/index.js";
import type {
  BriefingResult,
  ChapterAsk,
  IngestResult,
  PageRevision,
  PageVersion,
  PageWriteOptions,
  PageWriterDue,
  PageWriterMode,
  PageWriterOutcome,
  PageWriterRun,
  PageWriterStatus,
  SelfPage,
  WakeDelivery,
  WakeResult,
  WakeTrigger,
  WriterInput,
} from "./self/index.js";
import { acceptsReflectedFeeling, keepCore, retireCore } from "./sleep/index.js";
import type { CoreDecision, CoreDecisionActor } from "./sleep/index.js";
import type { CyclePartial, CycleReport } from "./sleep/index.js";
import { ABOUT_MARKS, CORE_ABOUT_MARKS, Store, assertSafeDataDir, rowTombstoned, hashText, indexTextOf } from "./store/index.js";
import type {
  AboutMark,
  AddFeelingsResult,
  Inherited,
  FeelingInput,
  StoreEvent,
  TraitInput,
  MemoryRow,
  MemoryStatus,
} from "./store/index.js";
import { TUNABLES as PHYSICS, band as bandOf, fadeOf } from "./physics/index.js";
import type { UseTier } from "./physics/index.js";
import type { Kind } from "./types.js";
import { isKnownSession } from "./types.js";
import {
  SELF_BRIEFING_EVENT,
  CAPTURE_FAILED_EVENT,
  SEMANTIC_LAG_EVENT,
  RECALL_DECISION_EVENT,
  recallDecisionRecord,
  ASSOCIATE_FLUSH_EVENT,
  SUBJECTS_BACKFILL_META,
  REGROWN_RELINK_META,
  CORRECTED_RELINK_META,
} from "./counterpart-events.js";
import type { AdapterDurableEventName } from "./counterpart-events.js";
import type {
  CounterpartEvent,
  CounterpartOptions,
  WakeHere,
  WakeOutcome,
  WakeSession,
  PlainReminder,
  CreditReferencesInput,
  CreditSummary,
  CreditHow,
  DrewOnResult,
  ShownLanes,
  PendingApplyReport,
  SessionEndDepositContext,
  DepositResult,
  DepositContext,
  ChapterResult,
  MarkAboutOutcome,
  SessionEndInput,
  SessionEndReport,
  ContiguityPass,
  AtWritePass,
  RebriefReport,
  WakeRefreshReport,
  SweepEntry,
  SweepSkipped,
  SweepWake,
  SentFacts,
  DepositFacts,
  ThreadRefusal,
  ReminderCarryPlan,
  DepositReminder,
} from "./counterpart-types.js";
import * as boundaryPart from "./counterpart-boundary.js";
import { rowIds } from "./counterpart-boundary.js";
import * as sweepPart from "./counterpart-sweep.js";
import * as depositPart from "./counterpart-deposit.js";

// What moved to the counterpart-*.ts parts, re-exported so every import of this file still resolves.
export {
  GATE_CHUNK_EVENT,
  GATE_CHUNK_FIELDS,
  GATE_DEPOSIT_EVENT,
  GATE_DEPOSIT_FIELDS,
  RECALL_DECISION_EVENT,
  SWEEP_GATE_EVENT,
  SWEEP_WAKE_EVENT,
  SLEEP_CYCLE_EVENT,
  SELF_BRIEFING_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  PRIMACY_DELIVER_EVENT,
  WAKE_INJECTED_EVENT,
  WAKE_DELIVERED_EVENT,
  RECALL_DELIVERED_EVENT,
  EPISODE_ASK_EVENT,
  BOUNDARY_EVENT,
  AUTHORSHIP_ASK_EVENT,
  ADAPTER_ASK_EVENT,
  EMBED_BACKFILL_EVENT,
  SEMANTIC_LAG_EVENT,
  RECALL_CREDIT_EVENT,
  ASSOCIATE_FLUSH_EVENT,
  CONTIGUITY_CURSOR_META,
  SUBJECTS_BACKFILL_META,
  REGROWN_RELINK_META,
  CORRECTED_RELINK_META,
  SPAWN_REFUSED_EVENT,
  SPAWN_FAILED_EVENT,
  RUNNER_FAILED_EVENT,
  HOOK_CLAIM_LOST_EVENT,
  WRITE_UP_FAILED_EVENT,
  NIGHT_WRITE_UP_EVENT,
  CAPTURE_FAILED_EVENT,
  SPAWN_STARTED_EVENT,
  MCP_RECALL_EVENT,
  MCP_PART_EVENT,
  MCP_OVERSIZE_EVENT,
  MCP_SPILLED_EVENT,
  ENVELOPE_OVERCAP_EVENT,
  NOTICE_DROPPED_EVENT,
  ENVELOPE_GAVE_WAY_EVENT,
  INJECTION_OVERBUDGET_EVENT,
  CHECKOUT_EVENT,
  SNAPSHOT_TAKEN_EVENT,
  SNAPSHOT_FAILED_EVENT,
  SNAPSHOT_ROTATED_EVENT,
  STORE_EXPORT_EVENT,
  RECALL_DECISION_FIELDS,
  surfaceSetFields,
} from "./counterpart-events.js";
export type {
  GateChunkField,
  GateDepositField,
  DeliveryWarningName,
  AdapterDurableEventName,
  SurfaceSetField,
} from "./counterpart-events.js";
export type {
  MarkAboutOutcome,
  SweepWakeReason,
  CreditHow,
  DrewOnResult,
  ContiguityPass,
  AtWritePass,
  CreditReferencesInput,
  CreditSummary,
  ShownLanes,
  PendingApplyReport,
  CounterpartEvent,
  LiveVectors,
  CounterpartOptions,
  WakeOutcome,
  WakeHere,
  WakeSession,
  SentFacts,
  FactField,
  DepositFacts,
  DepositContext,
  SessionEndDepositContext,
  DepositReason,
  PlainReminder,
  DepositResult,
  ThreadRefusal,
  DepositReminder,
  SweepEntry,
  SweepSkipped,
  SessionEndInput,
  ChapterResult,
  SessionEndReport,
  RebriefReport,
  WakeRefreshReport,
  EpisodeReconcileReport,
} from "./counterpart-types.js";

/** The boundary's `drewOn` cap, decided in `recall/reference.ts`. */
export { DREW_ON_MAX_PER_BOUNDARY };

// The bound on ids an event row names lives with the other shared shapes
// (`types.ts#boundedIds`); re-exported for the adapters that write such rows.
export { ROW_IDS_MAX, boundedIds } from "./types.js";

const EVENT_RING = REMEMBER.CONSUMED_LEDGER_MAX;

/**
 * A use whose STRENGTH credit was refused only for its day cadence — recall's
 * once-per-lived-day gate, or physics' birth-day / stale-day / already-today —
 * still counts as co-activation for links (2026-09-28, associate NOTES §8).
 */
function linksDespite(r: CreditResult): boolean {
  if (r.reason === "already-credited-at-or-above") return true;
  if (r.reason !== "physics-refused") return false;
  const why = r.outcome?.reason;
  return why === "birth-day" || why === "stale-day" || why === "already-credited-today";
}

export class Counterpart {
  readonly store: Store;
  readonly spans: SpanBuffer;
  readonly associate: Associate;
  readonly schemas: Schemas;
  readonly self: Self;
  readonly recall: Recall;
  readonly prospective: Prospective;
  /** Working context per directory (E1) — never memory. See `handoff/`. */
  readonly handoffs: Handoffs;
  /** Dreaming (2026-09-26, `dream/`): the ask, the bundle, the changes, the journal, undo. */
  readonly dreams: Dreams;
  /** Reflection (2026-09-27, `dream/reflect.ts`): the waking self — entry, page, share, marks. */
  readonly reflections: Reflections;
  /** One predicate, one definition: the store's. Never re-derived here. */
  readonly observer: boolean;

  /** Undefined when no embedder was wired, and under observer. See below. */
  private readonly vectors: VectorSource | undefined;
  /** The owner's own session? Recall's rule, kept for the plain lane: a
   *  confidential memory is said only to its owner (recall §9.1 G5). */
  private readonly owner: boolean;
  /** The host's `pageWriter.mode` (`session` when absent): who runs the nightly writer. */
  private readonly pageWriterModeOpt: PageWriterMode;
  /** The package version this process runs, when the adapter said (`CounterpartOptions.build`). */
  private readonly build: string | null;
  private reportedBudget: number | null;
  private readonly onEvent: ((e: CounterpartEvent) => void) | undefined;
  private readonly nowFn: () => number;
  private readonly ring: CounterpartEvent[] = [];
  /**
   * THE BRIEFING COLLECTOR, and the seam `self.briefing` is written from.
   *
   * Null except for the span of one `runCycle()` call. `self/` emits
   * `self.briefing.trim` per trimmed id and `self.briefing.rendered` with the
   * lane counts; both arrive through the SELF relay wired in the constructor
   * below — not through `selfRenderer`'s own `onEvent`, which carries only the
   * no-budget refusal. Arming a field for the cycle and reading it after is the
   * cheapest seam that is also honest about scope: the alternative, filtering
   * this root's ring afterwards, cannot tell this boundary's render from the
   * previous one in a long-lived process, and the alternative on the other side
   * — appending from inside `self/` — is not available at all, because `self/`
   * holds no store handle and must not grow one (SEAMS G).
   */
  private briefingEvents: CounterpartEvent[] | null = null;
  /**
   * WHAT THE WAKE BEING DELIVERED LISTS UNDER "Still open:" (2026-10-10), set
   * for the length of one delivery when the wake was assembled at session
   * start (`assembleWake`): the handoff's "since" line reads it in place of
   * the published bundle's (`THREADS_SHOWN_KEY`), so it leaves out what THIS
   * wake says is open. Null otherwise.
   */
  private deliveredThreads: Set<string> | null = null;
  /** True for the length of one delivery; the chapter walk it made, kept
   *  for the rest of it (`chaptersInWindow`). */
  private delivering = false;
  private deliveryWalk: { day: number; chapters: Map<string, ChapterHere> } | null = null;

  private constructor(opts: CounterpartOptions) {
    // THE PATH GUARD, BEFORE ANYTHING OPENS (scar §2.13). `dataDir()` asserts
    // this for the environment-resolved path, but an EXPLICIT `dir` reaches
    // `Store.open` unchecked — so a caller who passes one aims straight at v1's
    // live memory with nothing in the way. Found live while writing
    // `test/counterpart.test.ts`, which created a directory under `~/.bansai`
    // before this line existed. Filed in `INTERFACE-GAPS.md` §2: the assertion
    // belongs in `Store.open` too, and this is not a substitute for that.
    if (opts.dir !== undefined) assertSafeDataDir(opts.dir);
    this.observer = isObserver(opts);
    this.owner = opts.owner === true && !this.observer;
    this.pageWriterModeOpt = opts.pageWriterMode ?? "session";
    this.build = typeof opts.build === "string" && opts.build.length > 0 ? opts.build : null;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? ((): number => Date.now());
    this.reportedBudget = opts.budgetBytes ?? null;

    this.store = Store.open({
      observer: this.observer,
      // THE PROVENANCE CLOCK, handed down (§I7). One clock per session, and the
      // store is the thing that writes dates — so it gets the same function the
      // recall, self, prospective and span-buffer halves already got, and a
      // seeded or replayed brain stops stamping the run day on every row.
      now: this.nowFn,
      ...(opts.dir === undefined ? {} : { dir: opts.dir }),
      ...(opts.embed === undefined ? {} : { embed: opts.embed }),
      ...(opts.retentionDays === undefined ? {} : { retentionDays: opts.retentionDays }),
      ...(opts.snapshotsDir === undefined ? {} : { snapshotsDir: opts.snapshotsDir }),
      ...(opts.timeZone === undefined ? {} : { timeZone: opts.timeZone }),
      onEvent: (e: StoreEvent) => this.relay("store", e),
    });

    // THE VECTOR SOURCE (bridge `VectorSource`), assembled from the two halves
    // the host injected and the ONE thing only this file holds: the store the
    // context slice is read from. Absent both halves it stays undefined and the
    // gates behave exactly as they did before an embedder existed.
    //
    // NOT UNDER OBSERVER. An instrument opens no sockets: embedding a text is
    // egress, it costs money, and observer mode's rule is that a stood-down
    // instrument leaves the world as it found it (docs/observer-mode.md, scar
    // E7). The stand-down is visible — `novelty.reason` stays `no-chunk-vector`.
    const embed = opts.embed;
    const live = opts.vectors;
    this.vectors =
      this.observer || (embed === undefined && live === undefined)
        ? undefined
        : {
            vector: async (title, content) =>
              live === undefined
                ? embed?.(indexTextOf(title, content)) ?? null
                : live.vector(indexTextOf(title, content)),
            // One batched call for a whole chunk's mints. Without a live half
            // there is nothing to warm — the cache is whatever it already was.
            warm: async (items) => {
              if (live === undefined) return;
              await live.warm(items.map((i) => indexTextOf(i.title, i.content)));
            },
            // E(m): the K nearest memories this brain already holds. K is
            // `physics/`'s CAL number, imported — a size chosen here would be a
            // threshold with no home (the rule at the top of this file).
            context: (vec) => this.store.neighbourVectors(vec, PHYSICS.K_NEAREST),
          };

    // SEAMS E: `schemas/` may not import `associate/`, so the retarget callback
    // is injected — which means the edge graph must exist FIRST. Without this
    // line a revision leaves its successor cold (scar §2.2, live until wired).
    this.associate = new Associate({
      store: this.store,
      onEvent: (e) => this.relay("associate", e),
    });
    this.schemas = Schemas.open({
      store: this.store,
      retarget: (oldId, newId, day) => {
        this.associate.retargetOnSupersede(oldId, newId, day);
      },
      onEvent: (e) => this.relay("schemas", { at: e.at, name: e.event, ...(e.ref === undefined ? {} : { ref: e.ref }), ...(e.data === undefined ? {} : { data: e.data }) }),
    });
    // v12 (2026-10-03): WHAT A MEMORY NAMES, linked at every write. The store
    // cannot import `schemas/`, so the finder is handed to it here, and every
    // door that writes a memory — this file's, `dream/`'s, `self/`'s — links
    // through the same one. Then, once per store, the memories written before.
    this.store.findSubjectsWith((text) => this.schemas.subjectsIn(text));
    if (!this.observer) this.backfillSubjects();
    // Once per store, the links regrown chapter copies were left holding
    // before a regrowth carried them (2026-10-09).
    if (!this.observer) this.relinkRegrownCopies();
    // …and the links corrected memories were left holding before the one
    // door carried them (2026-10-11, Group 2b).
    if (!this.observer) this.relinkCorrected();
    // Once per store, the memories whose reminder moved before a move wrote
    // its own row (2026-10-11, Group 2b): each steps back behind its holder.
    if (!this.observer) settleMovedReminders(this.store, { retarget: this.retargetLinks });
    // SEAMS H: the REAL battery, so `self/`'s refusing default is unreachable.
    this.self = new Self({
      store: this.store,
      gate: episodeGate(),
      // The relay, plus the one tap the durable briefing row is read from. The
      // tap is inert whenever `briefingEvents` is null, which is everywhere but
      // inside a boundary's cycle.
      onEvent: (e) => {
        if (this.briefingEvents !== null && e.name.startsWith(SELF_BRIEFING_EVENT)) {
          this.briefingEvents.push({ ...e });
        }
        this.relay("self", e);
      },
      onMemoryMinted: (m) => this.creditNamedIn(m.title, m.body, m.day, m.id, "episode"),
      // SEAMS E once more: a regrown chapter copy inherits its archived copy's
      // links, as a revision's successor and a dream merge's memory do.
      retarget: (oldId, newId, day) => {
        this.associate.retargetOnSupersede(oldId, newId, day);
      },
      now: this.nowFn,
      ...(opts.selfTunables === undefined ? {} : { tunables: opts.selfTunables }),
    });
    this.recall = new Recall({
      store: this.store,
      owner: opts.owner === true,
      ...(this.reportedBudget === null ? {} : { budgetBytes: this.reportedBudget }),
      onEvent: (e) => this.relay("recall", e),
      now: this.nowFn,
    });
    this.prospective = new Prospective({
      store: this.store,
      onEvent: (e) => this.relay("prospective", e),
      now: this.nowFn,
    });
    // The same battery the journal and the self page pass (SEAMS H): a handoff
    // is prose written in a hurry at the end of a session, which is exactly the
    // kind of text a credential gets pasted into.
    this.handoffs = new Handoffs({
      store: this.store,
      gate: episodeGate(),
      observer: this.observer,
      onEvent: (e) => this.relay("handoff", e),
      now: this.nowFn,
      // The "since" line beside the pointer (2026-10-09): a confidential
      // memory named to the owner only, and nothing a later one settled over.
      owner: this.owner,
      settled: () => settledOver(this.store),
      // …and nothing the published wake already lists under "Still open:"
      // (review of #332): one place for an open question.
      listed: () => this.deliveredThreads ?? threadsShown(this.store),
    });
    this.spans = new SpanBuffer({
      dir: this.store.dir,
      observer: this.observer,
      day: () => this.store.livedDay(),
      now: this.nowFn,
      onEvent: (e) => this.relay("remember", e),
    });

    // DREAMING. Every word a dream writes is REDACTED of credentials before it
    // is stored — the secrets scan the battery runs, without the battery's
    // length and shape gates: a dream's words are a rewording of memories that
    // already crossed the full battery, and a one-line journal, a nomination's
    // reason or a merged sentence is short by nature (the full gate refused
    // them `content-too-short`). Text that was nothing but a credential is
    // refused. A merge hands its originals' links to the merged memory through
    // `associate/`'s retarget, which had no caller until now.
    this.dreams = new Dreams({
      store: this.store,
      observer: this.observer,
      owner: this.owner,
      ...(opts.bundlesAsOwner === true ? { bundleOwner: this.owner } : {}),
      gate: (text) => {
        const redacted = redactSecrets(text);
        return redacted.replace(/\[REDACTED[^\]]*\]/g, "").trim().length === 0
          ? { ok: false, reason: "only-a-credential" }
          : { ok: true, text: redacted };
      },
      page: () => this.self.page()?.body ?? null,
      wake: () => this.store.getMeta(BRIEFING_KEY) ?? null,
      today: () => this.store.today(),
      holds: (at) => meetingDay(this.store, at),
      retarget: (oldId, newId, day) => {
        this.associate.retargetOnSupersede(oldId, newId, day);
      },
      // A dream's links go through the edge module's rules (2026-09-28).
      link: (pairs, weight, day) => this.associate.propose(pairs, weight, day),
      emit: (name, ref, data) => this.emit(name, ref, data),
      ownerName: () => this.ownerDisplayName(),
    });

    // REFLECTION (2026-09-27). The same credential scan as a dream's words.
    // The page is rewritten through the one seam (`Self#revisePage`), BY
    // `reflection` since 2026-09-28 — its own author, not the nightly
    // writer's: the writer runs just before it in the same nightly run, both
    // may write the page for now, and the version history tells them apart.
    // It records no page-writer run any more (that row was what made the old
    // SessionStart writer stand down; the writer is in the run now, and the
    // row would say the writer revised on a night it may have refused).
    this.reflections = new Reflections({
      store: this.store,
      observer: this.observer,
      owner: this.owner,
      ...(opts.bundlesAsOwner === true ? { bundleOwner: this.owner } : {}),
      gate: (text) => {
        const redacted = redactSecrets(text);
        return redacted.replace(/\[REDACTED[^\]]*\]/g, "").trim().length === 0
          ? { ok: false, reason: "only-a-credential" }
          : { ok: true, text: redacted };
      },
      page: () => this.self.page()?.body ?? null,
      pageInfo: () => {
        const p = this.self.page();
        return p === null ? null : { version: p.version, by: p.by, revisedOn: p.revisedOn };
      },
      pageWrites: opts.pageWriterMode !== "off",
      today: () => this.store.today(),
      ownerName: () => this.ownerDisplayName(),
      dreamLine: (dreamId) => this.dreams.handBackOf(dreamId),
      writePage: (body, o) => {
        const common = {
          by: "reflection" as const,
          reason: o.reason,
          session: o.session,
          ...(o.model === null ? {} : { model: o.model }),
        };
        // The page with its short version, or — `body: null` — the short
        // version alone, added to the page as it stands (2026-10-10).
        const written =
          body === null
            ? this.self.addPageShort(o.short ?? "", { ...common, ...(o.ifVersion === undefined ? {} : { ifVersion: o.ifVersion }) })
            : this.self.revisePage(body, { ...common, ...(o.short === undefined ? {} : { short: o.short }) });
        const note = pageRoomNote(
          written,
          this.self.tunables.PAGE_ROOM_BYTES,
          "call finish again with page.short alone (the entry and the page stand)",
        );
        return written.written && written.version !== null
          ? { ok: true, version: written.version, note }
          : written.reason === "too-large"
            ? { ok: false, reason: written.reason, bytes: written.bytes, limit: this.self.tunables.PAGE_MAX_BYTES, note }
            : { ok: false, reason: written.reason, note };
      },
      emit: (name, ref, data) => this.emit(name, ref, data),
    });

    if (opts.identity !== undefined) this.self.ensureIdentityCore(opts.identity);
  }

  static open(opts: CounterpartOptions = {}): Counterpart {
    return new Counterpart(opts);
  }

  close(): void {
    this.store.close();
  }

  /** The ceiling the host reported, or null. Checkable, never assumed (§2.18). */
  budgetBytes(): number | null {
    return this.reportedBudget;
  }

  events(name?: string): CounterpartEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  // ── wake ───────────────────────────────────────────────────────────────────

  /**
   * Read what the previous boundary published, and record what the host says it
   * can carry. Zero model calls, zero network, no state written (§1 G1); the
   * ranking's cost was paid by the previous boundary. A DELIVERY assembles the
   * lanes that are plain reads for this moment (`assembleWake`, 2026-10-10).
   *
   * The ceiling is REPORTED here rather than configured here. A host that
   * reports none gets a tripwire event and a brain that will refuse to render a
   * briefing at the next boundary — loudly, rather than composing to a number
   * nobody chose.
   *
   * **`here` is the handoff pointer's whole reason to be a parameter** (E1). One
   * bundle is published per store and read by sessions in every directory, so
   * WHICH directory this session opened in is a delivery-time fact, like the
   * date and the store's size. `self/` knows nothing about scopes and gains
   * nothing here: the pointer is composed by `handoff/`, spliced by
   * `self/briefing.ts#spliceBeforeSentinel`, and joined to the two at this root,
   * which is the one place that holds both.
   */
  wake(budgetBytes?: number, delivery?: WakeDelivery, here?: WakeHere): WakeOutcome {
    if (budgetBytes === undefined) {
      this.emit("counterpart.budget.unreported", undefined, { had: this.reportedBudget });
    } else {
      this.reportedBudget = budgetBytes;
      this.emit("counterpart.budget.reported", undefined, { budgetBytes });
    }
    // `delivery` present means THIS read is an injection: the bundle gets the
    // preface that states which system, which day, which date and what size —
    // the facts the body was composed too early to know. A read that is not a
    // delivery (the dashboard, replay) gets the published bundle untouched.
    // THE WAKE ASSEMBLED NOW (2026-10-10): at a delivery, "Still open",
    // "Arriving:", the Yesterday line and the page are read for this moment
    // and composed by the same rules as the published bundle, around what
    // it showed of the stateful lanes (`assembleWake`). Null — a bundle an
    // older build published, no budget, another ceiling, anything that
    // throws — delivers the published bundle as it always was.
    let withPointer: WakeResult;
    this.delivering = delivery !== undefined;
    try {
      const assembled = delivery === undefined ? null : this.assembleWake(delivery, here);
      const result = delivery === undefined ? this.self.wake() : this.self.wake(delivery, assembled?.text);
      this.deliveredThreads = assembled === null ? null : new Set(assembled.kept.threads);
      withPointer = delivery === undefined ? result : this.addHandoffPointer(result, here);
    } finally {
      this.deliveredThreads = null;
      this.delivering = false;
      this.deliveryWalk = null;
    }
    this.emit("counterpart.wake", undefined, {
      ok: withPointer.ok,
      reason: withPointer.reason,
      bytes: withPointer.bytes,
      preface: withPointer.preface !== null,
      budgetBytes: this.reportedBudget,
    });
    return { ...withPointer, budgetBytes: this.reportedBudget };
  }

  /**
   * THE WAKE, ASSEMBLED AT SESSION START (2026-10-10; Mike approved the option
   * that day, details b2's and random-f8's). The published bundle was composed
   * at the last turn-end — the evening before, for a morning's first sessions
   * — so its Yesterday line named the day before yesterday, and a note's open
   * question or reminder waited for the next render. Now the lanes that are
   * plain reads are read for THIS moment and THIS date: "Still open" (an
   * indexed read of the open memories), "Arriving:" (`prospective/`'s horizon
   * for the session's date), the Yesterday line (`yesterdayFor`) and the page;
   * "Who I am", craft and "Nearby" are what the published bundle showed,
   * because showing them writes state the turn-end owns (the rotation's
   * stamps, Nearby's habituation). Plus the "Today, elsewhere" line
   * (`elsewhereFor`). Composed by `Self#assemble` under the published room,
   * by the published rules (`ROOM_ORDER`, the page's ladder).
   *
   * Reads only (self CONTRACT §5 G1): no scan of the store, no model, no
   * embedding, no write — a ring event says what it cost. Null when there is
   * nothing to assemble from or anything throws; the caller then delivers the
   * published bundle, exactly as before. A damaged published bundle is
   * delivered as found, so its damage stays readable.
   */
  private assembleWake(delivery: WakeDelivery, here?: WakeHere): BriefingResult | null {
    const budget = this.reportedBudget;
    const at = delivery.date;
    if (budget === null || at === undefined || !isDay(at)) return null;
    const started = performance.now();
    try {
      const stored = this.store.getMeta(BRIEFING_KEY);
      if (stored === undefined || stored.length === 0 || !readSentinel(stored).intact) return null;
      const day = this.store.livedDay();
      const asked = horizonFor(this.prospective, at, day);
      // FIRST CLAIM ON THE SESSION-START ROOM (2026-10-12, RANDOM's ruling,
      // lightly held): a dated item due today or within the next few days
      // takes room before "Last here", "Last said here", "Today, elsewhere"
      // and the older handoffs (`HorizonItem.near`). Not one in its grace
      // days (RANDOM, review of #445): "was due" waits its ordinary turn. Bounded by date, so
      // a long lane of far dates does not empty the furniture.
      const horizon = asked.items.map((i) => (nearDue(i.due, at) ? { ...i, near: true } : i));
      const out = this.self.assemble({
        day,
        ceilingBytes: budget,
        publishedHash: hashText(stored),
        horizon,
        ...(asked.more.length === 0 ? {} : { horizonMore: asked.more }),
        ...this.yesterdayFor(at, { here }),
        ...this.elsewhereFor(at, here),
      });
      if (out === null) return null;
      this.emit("counterpart.wake.assembled", undefined, {
        ms: performance.now() - started,
        bytes: out.bytes,
        threads: out.kept.threads.length,
        horizon: out.kept.horizon.length,
        elsewhere: out.elsewhere !== undefined,
        page: out.page?.rung ?? "",
        // What it counted rather than listed, and what it left unsaid
        // (2026-10-12). Ring only: a session start writes no `self.briefing` row.
        counted: Object.values(out.more).reduce((n, k) => n + (k ?? 0), 0),
        untold: Object.values(out.untold).reduce((n, k) => n + (k ?? 0), 0),
        quiet: Object.values(out.quiet).reduce((n, k) => n + (k ?? 0), 0),
      });
      return out;
    } catch (err) {
      this.emit("counterpart.wake.assemble.failed", undefined, { code: errCode(err) });
      return null;
    }
  }

  /**
   * THE "TODAY, ELSEWHERE" LINE for a session starting on `at` in
   * `here.scope` (2026-10-10): the other directories worked in today, from
   * the host's session registry (when, live or ended), the store's count of
   * memories written there today, and today's newest chapter there.
   *
   * THE GATES, held firmly (the brief's privacy lines):
   *   - a directory is named only when the host's scope setting lets its
   *     chapters be named elsewhere (`exportsFrom`) — with no way to ask,
   *     there is no line;
   *   - this session's own directory, this session, and the nightly run's
   *     directory (the store's own) are never named — "Last here" and the
   *     handoffs speak for this directory;
   *   - a chapter's title only on the "About me, from another directory"
   *     line's gate: not confidential, and a copy marked about me, us or the
   *     owner — never one the line already names;
   *   - memories as COUNTS only (confidential ones to the owner only); never
   *     a work memory's title, a word of a span, or a handoff's body.
   *
   * Empty when there is nothing to say; never throws.
   */
  private elsewhereFor(at: string, here?: WakeHere): { elsewhere?: string; elsewhereShorter?: string[] } {
    const gate = this.elsewhereGate(here);
    if (gate === null) return {};
    try {
      const { named, reader } = gate;
      const zone = this.store.zone();
      const since = startOfLocalDay(at, zone);
      const until = startOfLocalDay(addDays(at, 1), zone);
      type Dir = { scope: string; firstAt: number | null; lastAt: number | null; live: boolean; chapter: ChapterHere | null; memories: number };
      const dirs = new Map<string, Dir>();
      const dirOf = (scope: string): Dir => {
        const key = gate.norm(scope);
        let d = dirs.get(key);
        if (d === undefined) {
          d = { scope: key, firstAt: null, lastAt: null, live: false, chapter: null, memories: 0 };
          dirs.set(key, d);
        }
        return d;
      };
      for (const s of here?.sessions?.() ?? []) {
        if (s.session === reader || s.lastAt < since || s.startedAt >= until || !named(s.scope)) continue;
        const d = dirOf(s.scope);
        d.firstAt = d.firstAt === null ? s.startedAt : Math.min(d.firstAt, s.startedAt);
        d.lastAt = d.lastAt === null ? s.lastAt : Math.max(d.lastAt, s.lastAt);
        d.live = d.live || s.live;
      }
      for (const { scope, count } of this.store.memoryCountsByScopeSince(since, { confidential: this.owner })) {
        if (named(scope)) dirOf(scope).memories = count;
      }
      const chapters = this.chaptersInWindow(this.store.livedDay());
      // The chapter the "About me, from another directory" line names — with
      // the chapters "Last here" names in this directory set aside, as that
      // line sets them aside (`lastHereLadder`) — is not named twice.
      const hereIds = new Set(this.chaptersHereFor(here?.scope ?? "", reader, chapters).map((f) => f.chapter.id));
      const aboutMe = this.selfChapterElsewhere(chapters, hereIds, reader, here?.exportsFrom);
      for (const c of chapters.values()) {
        if (c.scope === null || c.writtenAt < since || c.writtenAt >= until || hereIds.has(c.id)) continue;
        if (c.id === aboutMe?.id || !gate.crosses(c)) continue;
        const d = dirOf(c.scope);
        if (d.chapter === null || d.chapter.writtenAt < c.writtenAt) d.chapter = c;
      }
      const lines = todayElsewhereLines([...dirs.values()] as TodayElsewhere[], zone);
      if (lines === null) return {};
      return lines.shorter.length === 0 ? { elsewhere: lines.line } : { elsewhere: lines.line, elsewhereShorter: lines.shorter };
    } catch {
      return {};
    }
  }

  /**
   * THE ONE GATE FOR BOTH ELSEWHERE LINES — "Today, elsewhere" in the wake and
   * "Since you started" at a prompt (2026-10-11: one gate, so the two cannot
   * drift apart). Null with no way to ask the host's scope setting: then
   * nothing crosses.
   *   - `named`: a directory is named only when the scope setting lets its
   *     chapters be named elsewhere (`exportsFrom`); this session's own
   *     directory and the nightly run's (the store's own) never are.
   *   - `crosses`: a chapter's title only on the "About me, from another
   *     directory" line's gate — not confidential, a copy marked about me, us
   *     or the owner, not the reader's own, from a directory `named` lets
   *     through.
   * Memories cross as COUNTS only (confidential ones to the owner only); the
   * callers read no work memory's title, no word of a span and no handoff.
   */
  private elsewhereGate(here?: WakeHere): {
    named(scope: string): boolean;
    crosses(c: ChapterHere): boolean;
    norm(scope: string): string;
    reader: string | null;
  } | null {
    const exportsFrom = here?.exportsFrom;
    if (exportsFrom === undefined) return null;
    const norm = (scope: string): string => scope.trim().replace(/\/+$/, "");
    const own = norm(here?.scope ?? "");
    const reader = here?.session ?? null;
    const allowed = new Map<string, boolean>();
    const named = (scope: string): boolean => {
      const key = norm(scope);
      if (key.length === 0 || key === own || key === norm(this.store.dir)) return false;
      let open = allowed.get(key);
      if (open === undefined) {
        try {
          open = exportsFrom(scope) === true;
        } catch {
          open = false;
        }
        allowed.set(key, open);
      }
      return open;
    };
    const crosses = (c: ChapterHere): boolean => {
      if (c.scope === null || c.confidential === true || c.aboutMe !== true) return false;
      if (reader !== null && c.session === reader) return false;
      return named(c.scope);
    };
    return { named, crosses, norm, reader };
  }

  /**
   * THE "SINCE YOU STARTED" LINE (2026-10-11; option C of the fresh-wake
   * brief, which Mike approved 2026-10-10): for a session already open in
   * `here.scope`, what changed in the other directories inside `window` —
   * from when it last heard (its wake, or the last such line) until now: a
   * session there that started and is still open, one that ended, a chapter,
   * and how many memories. A directory where only time passed is not named.
   *
   * The same gate as "Today, elsewhere" (`elsewhereGate`), and the same reads:
   * the host's registry, the store's counts, the fortnight's chapter walk.
   * Reads only — no model, no embedding, no write. Both ends of the window are
   * the CALLER's, so the hook's clock decides. The line and its shorter forms
   * (`handoff/last-here.ts#sinceElsewhereLines`), or null when there is
   * nothing to say; never throws.
   */
  sinceElsewhere(
    window: { readonly since: number; readonly until: number; readonly started: boolean },
    here: WakeHere,
  ): { line: string; shorter: string[] } | null {
    const gate = this.elsewhereGate(here);
    if (gate === null || !(window.until > window.since)) return null;
    try {
      const { named, reader } = gate;
      const { since, until } = window;
      type Dir = { scope: string; startedAt: number | null; live: boolean; endedAt: number | null; chapter: ChapterHere | null; memories: number };
      const dirs = new Map<string, Dir>();
      const dirOf = (scope: string): Dir => {
        const key = gate.norm(scope);
        let d = dirs.get(key);
        if (d === undefined) {
          d = { scope: key, startedAt: null, live: false, endedAt: null, chapter: null, memories: 0 };
          dirs.set(key, d);
        }
        return d;
      };
      for (const s of here.sessions?.() ?? []) {
        if (s.session === reader || s.startedAt >= until || !named(s.scope)) continue;
        const ended = s.endedAt ?? null;
        const startedSince = s.live && s.startedAt >= since;
        const endedSince = ended !== null && ended >= since && ended < until;
        if (!startedSince && !endedSince && !s.live) continue;
        const d = dirOf(s.scope);
        d.live = d.live || s.live;
        if (startedSince) d.startedAt = Math.max(d.startedAt ?? 0, s.startedAt);
        if (endedSince) d.endedAt = Math.max(d.endedAt ?? 0, ended);
      }
      for (const { scope, count } of this.store.memoryCountsByScopeSince(since, { confidential: this.owner })) {
        if (named(scope)) dirOf(scope).memories = count;
      }
      for (const c of this.chaptersInWindow(this.store.livedDay()).values()) {
        if (c.scope === null || c.writtenAt < since || c.writtenAt >= until || !gate.crosses(c)) continue;
        const d = dirOf(c.scope);
        if (d.chapter === null || d.chapter.writtenAt < c.writtenAt) d.chapter = c;
      }
      return sinceElsewhereLines([...dirs.values()] as SinceElsewhere[], { at: since, started: window.started, now: until }, this.store.zone());
    } catch {
      return null;
    }
  }

  /**
   * THE PER-DIRECTORY POINTER, spliced into the delivered bundle above its tail
   * sentinel — or not, in which case the bundle is returned exactly as `self/`
   * produced it, byte for byte.
   *
   * Five ways to get nothing, and four of them are the ordinary case and stay
   * silent: no directory was named, the bundle is not a clean render (a damaged
   * bundle is delivered as found, so the damage stays readable), this directory
   * has no handoff, or the one it has has run out.
   *
   * The FIFTH leaves a durable row — `handoff.refused{reason:"no-room"}`,
   * deduped per row per lived day. The boundary reserves room whenever a live
   * pointer exists and the ceiling is big enough for the share rule, so no room
   * means one of two things and both are worth a trace: the bundle was composed
   * before that reserve existed (one boundary's lag, which is how every wake
   * fact behaves), or this host's ceiling is too small for the share rule and
   * the pointer will never be carried here. It was ring-only, and every hook is
   * its own process, so the exact failure the brief asked to be findable — the
   * pointer stops being delivered and nothing says so — was real for the whole
   * window (adversarial review MINOR-1).
   *
   * `handoff.shown` is written here and only here: after the splice, so the row
   * says a pointer was DELIVERED rather than that one existed.
   *
   * SEVERAL HANDOFFS (2026-09-30): a directory holds one per writing session,
   * and the pointer shows up to three newest-first. The blocks come as a
   * ladder, widest first (`handoff/#pointerLadder`), and the first that fits
   * the ceiling is delivered — so a reserve sized for fewer than the directory
   * now holds (the one-boundary lag, when a new author appears) shows fewer
   * rather than none. `no-room` is written only when not even the last rung
   * fits. Each handoff shown in full gets its own `handoff.shown` row; the
   * block's cost is split so the rows sum to it — each its own line's bytes,
   * and the newest the rest (the header and the door).
   */
  private addHandoffPointer(result: WakeResult, here?: WakeHere): WakeResult {
    const scope = here?.scope?.trim() ?? "";
    if (scope.length === 0 || !result.ok) return result;
    // ONE chapter walk for the whole delivery (the line, its no-room row, and
    // each handoff's "a newer chapter here since"): a session start waits on it.
    let chapters: Map<string, ChapterHere> = new Map();
    let allHere: ReturnType<Counterpart["chaptersHereFor"]> = [];
    try {
      chapters = this.chaptersInWindow(this.store.livedDay());
      allHere = this.chaptersHereFor(scope, null, chapters);
    } catch {
      chapters = new Map();
      allHere = [];
    }
    let ladder: ReturnType<Handoffs["pointerChoices"]> = [];
    try {
      ladder = this.handoffs.pointerChoices(
        scope,
        undefined,
        (h, newest) => this.handoffSince(h, scope, newest, here, allHere),
        here?.session ?? null,
      );
    } catch {
      // A store that will not answer is not a reason to fail a wake (§1 G7).
      ladder = [];
    }
    // LAST HERE (2026-09-30): the session that last wrote a chapter in this
    // directory, finished or not — above the handoff, and the first thing
    // given up when there is not room for both (`handoff/last-here.ts`).
    const lastHere = this.lastHereLadder(scope, here?.session ?? null, chapters, here?.exportsFrom);
    // LAST SAID HERE (2026-10-11): the last exchange in this directory, one
    // line at the foot of the blocks above the handoff — the first thing they
    // give up, at each of their widths (`withExchange`).
    const exchange = here === undefined ? null : this.lastExchangeLine(here);
    const aboveLadder = withExchange(lastHere, exchange);
    // Which chapter the line would name first, for its durable no-room row.
    const reader = here?.session ?? null;
    // Only for a "Last here" line proper: the about-me line alone names no
    // chapter here, and its drop is not this row's (review of #311, NIT).
    const named = lastHere.some((b) => b.startsWith("Last here:"));
    const lastHereId = !named ? null : (allHere.find((c) => (reader === null || c.chapter.session !== reader) && (this.owner || c.chapter.confidential !== true))?.chapter.id ?? null);
    const newest = ladder[0];
    const budget = this.reportedBudget;
    // THIS DIRECTORY'S WORK (2026-10-01, lane 8): the craft lane, composed
    // here because the stored bundle has no directory. It goes ABOVE whatever
    // handoff block is chosen, in the room that block leaves — the handoff and
    // "Last here" are chosen first and never give way to it (`withWorkHere`).
    const work = this.workHereLines(scope);
    if (newest === undefined && aboveLadder.length === 0) return this.withWorkHere(result, null, work, budget, scope);
    const fits = (block: string): ReturnType<typeof spliceBeforeSentinel> | null => {
      const spliced = spliceBeforeSentinel(result.text, block);
      return spliced.applied && (budget === null || spliced.bytes <= budget) ? spliced : null;
    };
    // THE HANDOFF FIRST (review of #300 MAJOR-1): the widest handoff rung that
    // fits ALONE is the one carried — unfinished work outranks orientation —
    // and only then is the line tried above it, widest first, with that rung
    // alone as the fallback. The line alone only when no handoff rung fits.
    // With no chapter here this is the handoff ladder as it was, rung for rung.
    // A bundle that is not a clean render is delivered as found.
    if (!spliceBeforeSentinel(result.text, ladder[0]?.block ?? aboveLadder[0] ?? "").applied) return result;
    const best = ladder.find((rung) => fits(rung.block) !== null) ?? null;
    const tries: { rung: (typeof ladder)[number] | null; above: string | null }[] =
      best !== null
        ? [...aboveLadder.map((above) => ({ rung: best, above })), { rung: best, above: null }]
        : aboveLadder.map((above) => ({ rung: null, above }));
    // What `no-room` reports: the SMALLEST handoff rung, which is the one that
    // decided there was no room for it (review of #295, NIT-3).
    const last = ladder[ladder.length - 1];
    const smallest = last === undefined ? null : spliceBeforeSentinel(result.text, last.block);
    for (const { rung, above } of tries) {
      const block = [above, rung?.block ?? null].filter((b): b is string => b !== null).join("\n");
      const spliced = fits(block);
      if (spliced === null) continue;
      const total = spliced.bytes - result.bytes;
      const aboveBytes = above === null ? 0 : (rung === null ? total : new TextEncoder().encode(above).length + 1);
      if (rung !== null) {
        const cost = total - aboveBytes;
        const lines = rung.block.split("\n");
        const own = (i: number): number =>
          rung.shown.length === 1 ? cost : new TextEncoder().encode(lines[i + 1] ?? "").length + 1;
        const others = rung.shown.slice(1).reduce((n, _, i) => n + own(i + 1), 0);
        rung.shown.forEach((h, i) => {
          this.handoffs.noteShown(h, {
            bytes: i === 0 ? cost - others : own(i),
            session: here?.session ?? null,
            among: rung.live,
            ...(i === 0 ? { plans: rung.plans.length } : {}),
          });
        });
      } else if (newest !== undefined) {
        this.noteHandoffNoRoom(newest.handoff, smallest?.bytes ?? result.bytes, budget, result.bytes);
      }
      // The exchange line rides at the foot of `above` when it was carried.
      const saidShown = exchange !== null && above !== null && (above === exchange || above.endsWith(`\n${exchange}`));
      const hereShown = above !== null && above !== exchange;
      if (hereShown) {
        // Its own bytes and lines, without the exchange line at its foot.
        const said = saidShown ? byteLength(exchange) + 1 : 0;
        this.emit("counterpart.lasthere.shown", undefined, { bytes: aboveBytes - said, lines: above.split("\n").length - (saidShown ? 1 : 0) });
      } else if (lastHere.length > 0) {
        // The handoff was carried and the line above it was not.
        this.noteLastHereNoRoom(lastHereId, { budget, was: result.bytes, besideHandoff: true });
      }
      if (exchange !== null) this.emit(saidShown ? "counterpart.lastexchange.shown" : "counterpart.lastexchange.noroom", undefined, { bytes: byteLength(exchange) });
      // A memory the "since" line names is not named again in the work lines
      // above it (2026-10-09).
      const named = rung?.plans ?? [];
      const lines = work.lines.filter((l) => !named.some((id) => l.endsWith(`(${id})`)));
      return this.withWorkHere(result, block, { lines, found: work.found - (work.lines.length - lines.length) }, budget, scope);
    }
    if (newest !== undefined) this.noteHandoffNoRoom(newest.handoff, smallest?.bytes ?? result.bytes, budget, result.bytes);
    if (lastHere.length > 0) this.noteLastHereNoRoom(lastHereId, { budget, was: result.bytes, besideHandoff: false });
    if (exchange !== null) this.emit("counterpart.lastexchange.noroom", undefined, { bytes: byteLength(exchange) });
    return this.withWorkHere(result, null, work, budget, scope);
  }

  /**
   * THE LAST EXCHANGE IN `here.scope` (2026-10-11; Mike's design of
   * 2026-10-10, "pull, not push"): what was last said to another session in
   * this directory, and its last text reply, inside about a day — read from
   * the span buffer alone (`handoff/last-exchange.ts`). The wake's "Last said here" line
   * and the `last exchange` recall handle both ask here, so the two cannot
   * disagree. Reads only; nothing is stored; nothing crosses directories.
   * Null when there is none; never throws.
   */
  lastExchange(here: WakeHere): LastExchange | null {
    const scope = here.scope?.trim() ?? "";
    if (scope.length === 0) return null;
    let sessions: readonly WakeSession[] = [];
    try {
      sessions = here.sessions?.() ?? [];
    } catch {
      sessions = [];
    }
    return lastExchange({
      buffer: this.spans,
      scope,
      reader: here.session ?? null,
      now: this.nowFn(),
      sessions: sessions.map((s) => ({ session: s.session, scope: s.scope, lastAt: s.lastAt })),
    });
  }

  /** The wake's "Last said here" line for `here`, or null. Never throws. Only
   *  in the owner's session (review of #392): a span is the raw slice, which no
   *  confidential mark has reached yet, so a non-owner wake gets no quote. */
  private lastExchangeLine(here: WakeHere): string | null {
    if (!this.owner) return null;
    try {
      const ex = this.lastExchange(here);
      return ex === null ? null : lastExchangeLine(ex, { zone: this.store.zone(), now: this.nowFn() });
    } catch {
      return null;
    }
  }

  /**
   * THIS DIRECTORY'S WORK LINES, best first (`self/work.ts#workHere`), or none
   * — with the switch off, with no directory, or with a store that will not
   * answer. What a later memory settled over is left out, as every lane but
   * identity leaves it out. Up to `WORK_HERE_POOL` are ranked and today's
   * `WORK_HERE_MAX` chosen from them (`rotateWork`, 2026-10-02); `found` is
   * how many were ranked, for the overflow row. Never throws.
   */
  private workHereLines(scope: string): { lines: string[]; found: number } {
    const t = this.self.tunables;
    if (!t.CRAFT_AT_DELIVERY || scope.trim().length === 0) return { lines: [], found: 0 };
    try {
      const day = this.store.livedDay();
      const ranked = workHere(this.store, scope, {
        day,
        max: t.WORK_HERE_MAX,
        pool: t.WORK_HERE_POOL,
        excerpt: t.WORK_HERE_EXCERPT,
        skip: settledOver(this.store),
      });
      return { lines: rotateWork(ranked, t.WORK_HERE_MAX, day), found: ranked.length };
    } catch {
      return { lines: [], found: 0 };
    }
  }

  /**
   * MORE WORK THAN THIS WAKE CARRIED (2026-10-02): the ring event, and one
   * durable row per directory per lived day (`WORK_OVERFLOW_EVENT`), so doctor
   * and the dashboard can say the lines rotate or had no room. Never under
   * observer; never throws.
   */
  private noteWorkOverflow(scope: string, opts: { found: number; shown: number; budget: number | null; was: number }): void {
    const max = this.self.tunables.WORK_HERE_MAX;
    const cause = opts.shown < Math.min(opts.found, max) ? "room" : "cap";
    this.emit("counterpart.work.overflow", undefined, { cause, found: opts.found, shown: opts.shown });
    if (this.observer) return;
    try {
      const day = this.store.livedDay();
      this.store.appendEvent({
        name: WORK_OVERFLOW_EVENT,
        day,
        dedupKey: `${WORK_OVERFLOW_EVENT}:${cause}:${scope}:${String(day)}`,
        payload: { scope, cause, found: opts.found, shown: opts.shown, max, budget: opts.budget ?? 0, bytes: opts.was },
      });
    } catch {
      /* an overflow that cannot be recorded still rotated */
    }
  }

  /**
   * THE DELIVERY'S FOOT: the work lines that fit, widest first, above the
   * chosen handoff `block` (or alone when there is none), spliced in ONE go
   * above the sentinel. The block was chosen against the bundle without the
   * work lines, so they can only take room it left; when not even one line
   * fits, the block is spliced alone, exactly as before, and a ring event
   * says the lines had no room. With no lines and no block, the bundle is
   * returned untouched. Never throws.
   */
  private withWorkHere(
    result: WakeResult,
    block: string | null,
    work: { lines: readonly string[]; found: number },
    budget: number | null,
    scope: string,
  ): WakeResult {
    const { lines, found } = work;
    const spliced = (text: string): WakeResult | null => {
      const s = spliceBeforeSentinel(result.text, text);
      if (!s.applied || (budget !== null && s.bytes > budget)) return null;
      return { ...result, text: s.text, bytes: s.bytes, sentinel: s.sentinel };
    };
    for (let k = lines.length; k > 0; k--) {
      const shown = workHereBlock(lines.slice(0, k));
      const out = spliced(block === null ? shown : `${shown}\n\n${block}`);
      if (out === null) continue;
      this.emit("counterpart.work.shown", undefined, { lines: k, of: lines.length, bytes: out.bytes - result.bytes });
      if (found > k) this.noteWorkOverflow(scope, { found, shown: k, budget, was: result.bytes });
      return out;
    }
    if (lines.length > 0) {
      this.emit("counterpart.work.noroom", undefined, { lines: lines.length, budget, was: result.bytes });
      this.noteWorkOverflow(scope, { found, shown: 0, budget, was: result.bytes });
    }
    if (block === null) return result;
    const s = spliceBeforeSentinel(result.text, block);
    return s.applied ? { ...result, text: s.text, bytes: s.bytes, sentinel: s.sentinel } : result;
  }

  /**
   * The "Last here" line could not be carried at this ceiling: the ring
   * event, and since 2026-10-01 a durable row (`LAST_HERE_NOROOM_EVENT`), one
   * per chapter per lived day, so the dashboard's wake bar can say so. Never
   * under observer; never throws.
   */
  private noteLastHereNoRoom(chapterId: string | null, opts: { budget: number | null; was: number; besideHandoff: boolean }): void {
    this.emit("counterpart.lasthere.noroom", chapterId ?? undefined, { budget: opts.budget, was: opts.was, besideHandoff: opts.besideHandoff });
    if (this.observer || chapterId === null) return;
    try {
      const day = this.store.livedDay();
      this.store.appendEvent({
        name: LAST_HERE_NOROOM_EVENT,
        day,
        ref: chapterId,
        dedupKey: `${LAST_HERE_NOROOM_EVENT}:${chapterId}:${String(day)}`,
        payload: { budget: opts.budget ?? 0, bytes: opts.was, besideHandoff: opts.besideHandoff },
      });
    } catch {
      /* a drop that cannot be recorded is still a drop */
    }
  }

  /** The handoff could not be carried at this ceiling: a ring event and the
   *  durable `no-room` row, as the pointer has always left. */
  private noteHandoffNoRoom(h: Handoff, bytes: number, budget: number | null, was: number): void {
    this.emit("counterpart.handoff.noroom", h.id, { bytes, budget, was });
    this.handoffs.noteNoRoom(h, { bytes, budget: budget ?? 0 });
  }

  /**
   * THE "LAST HERE" BLOCKS for this directory, widest first, or none: the
   * chapters inside the fortnight written here — by the row's directory, the
   * chapter claims in this directory's coverage file, or failing both, the
   * session's turn-ends (`handoff/last-here.ts#chaptersHere`) — with when
   * each session was here. `chapters` is passed by a caller asking for every
   * directory at once, so the episode walk is one. Never throws.
   */
  private lastHereLadder(
    scope: string,
    reader: string | null,
    chapters?: ReadonlyMap<string, ChapterHere>,
    exportsFrom?: (scope: string) => boolean,
  ): string[] {
    try {
      const all = chapters ?? this.chaptersInWindow(this.store.livedDay());
      const found = this.chaptersHereFor(scope, reader, all);
      const zone = this.store.zone();
      const entries: LastHere[] = found.map((f) => ({
        chapter: f.chapter,
        when: `${stampWords(localStamp(f.firstAt, zone))}–${stampWords(localStampAfter(f.lastAt, f.firstAt, zone))}`,
        // `09-30 17:50` → `Sep 30`.
        date: stampWords(localStamp(f.chapter.writtenAt, zone).split(" ")[0] ?? ""),
      }));
      const base = entries.length === 0 ? [] : lastHereLadder(entries, reader);
      // ABOUT ME, FROM ANOTHER DIRECTORY (2026-10-01): one more line on the
      // widest rungs, given up first; alone when nothing was written here.
      const away = this.selfChapterElsewhere(all, new Set(found.map((f) => f.chapter.id)), reader, exportsFrom);
      if (away === null) return base;
      const line = elsewhereLine(away, stampWords(localStamp(away.writtenAt, zone).split(" ")[0] ?? ""), reader);
      return base.length === 0 ? [line] : [...base.map((b) => `${b}\n${line}`), ...base];
    } catch {
      return [];
    }
  }

  /**
   * THE NEWEST CHAPTER ABOUT ME FROM ANOTHER DIRECTORY, inside the fortnight
   * (2026-10-01, random-f2's item 6): not one shown here already, not the
   * reader's own, and with a live copy marked `me`, `us` or `owner`
   * (`ChapterHere.aboutMe`, read with the walk's one grouped query). Null when
   * none; throws only what the store throws.
   */
  private selfChapterElsewhere(
    chapters: ReadonlyMap<string, ChapterHere>,
    here: ReadonlySet<string>,
    reader: string | null,
    exportsFrom?: (scope: string) => boolean,
  ): ChapterHere | null {
    // Only from a directory the host says may be read elsewhere (its scope
    // setting is on), and never a confidential chapter (review of #311). With
    // no way to ask, nothing crosses.
    if (exportsFrom === undefined) return null;
    let best: ChapterHere | null = null;
    for (const c of chapters.values()) {
      if (here.has(c.id) || (reader !== null && c.session === reader)) continue;
      if (c.confidential === true || c.scope === null || c.aboutMe !== true) continue;
      if (best !== null && best.writtenAt >= c.writtenAt) continue;
      let open = false;
      try {
        open = exportsFrom(c.scope);
      } catch {
        open = false;
      }
      if (!open) continue;
      best = c;
    }
    return best;
  }

  /**
   * THE CHAPTERS "LAST HERE" WOULD NAME for this directory, newest first, with
   * when each session was here — not the reader's own. What the wake's line
   * prints and what recall's question about time means by "the most recent
   * session" (2026-09-30), so the two cannot disagree. Throws only what the
   * store throws; callers wrap it.
   */
  chaptersHereFor(
    scope: string,
    reader: string | null,
    chapters?: ReadonlyMap<string, ChapterHere>,
  ): { chapter: ChapterHere; firstAt: number; lastAt: number }[] {
    const day = this.store.livedDay();
    const all = chapters ?? this.chaptersInWindow(day);
    if (all.size === 0) return [];
    const only = new Set(all.keys());
    const sessions = new Map(sessionsHere(this.spans, scope, { only }).map((s) => [s.session, s] as const));
    return chaptersHere(all, { scope, claimed: chapterClaims(this.spans, scope), sessions }, day, { reader });
  }

  /**
   * THE WAKE'S "YESTERDAY" LINE (2026-10-01, build 3), for a render whose
   * calendar date is `at`: the chapters written the day before, by title and
   * id, the date in the line (`handoff/last-here.ts#yesterdayLine`). Undefined
   * without a date or a chapter that day; never throws — a store that will not
   * answer composes the wake without it.
   *
   * Its SHORTER FORMS ride beside it (review of #350, 2026-10-09): fewer
   * titles, the rest by count, for the wake to step down only when "Still
   * open" would otherwise list nothing (`handoff/last-here.ts#yesterdayShorter`).
   *
   * AT A SESSION START, GATED (2026-10-11; self INTERFACE-GAPS §14 files the rest):
   * `reader` is the session the line is for, and another directory's chapter
   * is named by title and id only on the "About me, from another directory"
   * line's gate — a copy marked about me, us or the owner, and that
   * directory's scope setting on (`WakeHere.exportsFrom`; no way to ask, or a
   * chapter whose row recorded no directory, and it is not named). One this
   * session's own directory wrote is named as before. The rest are counted.
   * Without `reader` — the turn-end's and `rebrief`'s published render, which
   * no one session reads — the line is store-wide, as it was.
   */
  private yesterdayFor(at: string | undefined, reader?: { here: WakeHere | undefined }): { yesterday?: string; yesterdayShorter?: string[] } {
    if (at === undefined || !isDay(at)) return {};
    try {
      const date = addDays(at, -1);
      const fromDay = Math.max(0, this.store.livedDay() - LAST_HERE_LIFE_DAYS + 1);
      const all = chaptersOn(this.store, date, { fromDay });
      const day = reader === undefined ? all : all.filter((c) => this.nameableHere(c.scope ?? null, c.aboutMe === true, reader.here));
      const hidden = all.length - day.length;
      const line = yesterdayLine(day, date, undefined, hidden);
      if (line === null) return {};
      const shorter = yesterdayShorter(day, date, hidden);
      return shorter.length === 0 ? { yesterday: line } : { yesterday: line, yesterdayShorter: shorter };
    } catch {
      return {};
    }
  }

  /**
   * May a chapter born in `scope` be named, by title and id, in a wake for
   * `here`? Its own directory's, yes; another's only on the "About me, from
   * another directory" gate (`selfChapterElsewhere`): about me, us or the
   * owner, and that directory's scope setting on. No directory recorded, or
   * no way to ask, and it is not. Confidential chapters never reach here
   * (`chaptersOn` leaves them out). Never throws.
   */
  private nameableHere(scope: string | null, aboutMe: boolean, here: WakeHere | undefined): boolean {
    if (scope === null) return false;
    const norm = (s: string): string => s.trim().replace(/\/+$/, "");
    const own = norm(here?.scope ?? "");
    if (own.length > 0 && norm(scope) === own) return true;
    const exportsFrom = here?.exportsFrom;
    if (!aboutMe || exportsFrom === undefined) return false;
    try {
      return exportsFrom(scope) === true;
    } catch {
      return false;
    }
  }

  /** Every session's latest chapter among the episodes born inside the
   *  fortnight — the SQL bound on the walk (review of #300 MINOR-5). */
  private chaptersInWindow(day: number): Map<string, ChapterHere> {
    // One walk per delivery (2026-10-10): the "Today, elsewhere" line and
    // the handoff pointer read the same chapters.
    if (this.delivering && this.deliveryWalk?.day === day) return this.deliveryWalk.chapters;
    const all = chaptersBySession(this.store, { fromDay: Math.max(0, day - LAST_HERE_LIFE_DAYS + 1) });
    // A confidential chapter is named to the owner only (review of #311).
    const out = this.owner ? all : new Map([...all].filter(([, c]) => c.confidential !== true));
    if (this.delivering) this.deliveryWalk = { day, chapters: out };
    return out;
  }

  /**
   * HOW CURRENT THIS DIRECTORY'S POINTER IS, at delivery (2026-09-30): when
   * it was written, in the store's zone, and — when sessions here captured work
   * past the owed floor after that, not counting the writing session's own turn
   * — when that work ran, by the pieces' own times, and whether it is written up
   * (`coverage/#workSince`). Null when the write time is unknown: the line then
   * says the date alone, as it always did. An OLDER handoff in a directory
   * that holds several (`newest` false) is asked only when it was written: it
   * never prints the rest, so the span read is skipped.
   */
  private handoffSince(
    h: Handoff,
    scope: string,
    newest = true,
    here?: WakeHere,
    allHere?: ReturnType<Counterpart["chaptersHereFor"]>,
  ): PointerSince | null {
    const writtenAt = this.handoffs.writtenAt(h);
    if (writtenAt === null) return null;
    const zone = this.store.zone();
    const stale = this.handoffStale(h, scope, writtenAt, here, allHere);
    if (!newest) return { written: localStamp(writtenAt, zone), after: null, stale };
    const work = workSince(this.spans, scope, writtenAt, { writer: h.session });
    if (!work.overFloor || work.firstAt === null || work.lastAt === null) {
      return { written: localStamp(writtenAt, zone), after: null, stale };
    }
    // A clock time alone while the day is the one before it; the day as well
    // when it is not.
    return {
      written: localStamp(writtenAt, zone),
      stale,
      after: {
        from: localStampAfter(work.firstAt, writtenAt, zone),
        to: localStampAfter(work.lastAt, work.firstAt, zone),
        writtenUp: work.unwritten === 0,
        // How far, when not wholly (2026-09-30): the latest claim's time,
        // spelled as `to` is, and what made it.
        upTo: work.writtenUpTo === null ? null : localStampAfter(work.writtenUpTo, work.firstAt, zone),
        by: work.writtenUpBy,
        unwritten: work.unwritten,
        unwrittenAfter: work.unwrittenAfter,
      },
    };
  }

  /**
   * WHY THIS HANDOFF MAY BE OUT OF DATE, at delivery (2026-10-01, random-f2's
   * item 1: a handoff still said it was waiting on a fix
   * the morning after that fix was installed). Two facts already recorded, and no
   * judging whether what it waited on happened: the release that wrote it —
   * the row's own stamp, else the version its session opened with — is older
   * than the one installed now; or a session other than its writer wrote a
   * chapter in this directory after it. Null when neither; never throws.
   */
  private handoffStale(
    h: Handoff,
    scope: string,
    writtenAt: number,
    here?: WakeHere,
    allHere?: ReturnType<Counterpart["chaptersHereFor"]>,
  ): string | null {
    try {
      let writtenWith = h.build ?? null;
      if (writtenWith === null && h.session !== null && here?.openedWith !== undefined) {
        try {
          writtenWith = here.openedWith(h.session);
        } catch {
          writtenWith = null;
        }
      }
      let newerChapter = false;
      try {
        newerChapter = (allHere ?? this.chaptersHereFor(scope, null)).some(
          (c) => c.chapter.session !== h.session && c.chapter.writtenAt > writtenAt,
        );
      } catch {
        newerChapter = false;
      }
      return staleWords({ writtenWith, installed: here?.installed ?? null, newerChapter });
    } catch {
      return null;
    }
  }

  /**
   * WRITE THIS SESSION'S HANDOFF FOR THIS DIRECTORY — the one seam, reached
   * today by the optional `handoff` field on the `session_end` tool. No second
   * ask and no second pacer: the field rides the ask that already exists
   * (self/CONTRACT's scar). One live row per directory per session; `model`
   * is the writing session's, from host state, so the wake can say who.
   */
  writeHandoff(
    body: string,
    ctx: { scope: string; session?: string | null; model?: string | null; build?: string | null; day?: number },
  ): HandoffWrite {
    return this.handoffBehind(
      this.handoffs.write({
        body,
        scope: ctx.scope,
        ...(ctx.session === undefined ? {} : { session: ctx.session }),
        ...(ctx.model === undefined ? {} : { model: ctx.model }),
        ...(ctx.build === undefined ? {} : { build: ctx.build }),
        ...(ctx.day === undefined ? {} : { day: ctx.day }),
      }),
    );
  }

  /**
   * A HANDOFF CHANGED, SO THE WAKE IS BEHIND IT (2026-10-10): the bundle's
   * room for the handoff pointer is sized at render time, so a new, retired
   * or cleared handoff waited for the next lived day to get its room or give
   * it back. The mark is set here because `handoff/` does not import `self/`.
   * Only on a write that landed: a refusal changed nothing.
   */
  private handoffBehind(out: HandoffWrite): HandoffWrite {
    if (out.written) markWakeBehind(this.store, "handoff");
    return out;
  }

  /**
   * RETIRE ONE HANDOFF IN THIS DIRECTORY BY ITS ID, whoever wrote it — the
   * `session_end` tool's `retireHandoff` field. See `Handoffs.retire`.
   */
  retireHandoff(id: string, ctx: { scope: string; session?: string | null; day?: number }): HandoffWrite {
    return this.handoffBehind(
      this.handoffs.retire(id, {
        scope: ctx.scope,
        ...(ctx.session === undefined ? {} : { session: ctx.session }),
        ...(ctx.day === undefined ? {} : { day: ctx.day }),
      }),
    );
  }

  /**
   * RETIRE THIS SESSION'S HANDOFF FOR THIS DIRECTORY — the same seam, reached
   * by sending the `session_end` field present and empty. Others' stand. See
   * `Handoffs.clear`.
   */
  clearHandoff(ctx: { scope: string; session?: string | null; day?: number }): HandoffWrite {
    return this.handoffBehind(
      this.handoffs.clear(ctx.scope, {
        ...(ctx.session === undefined ? {} : { session: ctx.session }),
        ...(ctx.day === undefined ? {} : { day: ctx.day }),
      }),
    );
  }

  /** A named, durable refusal raised by a door — see `Handoffs.refuseWrite`. */
  refuseHandoff(
    reason: HandoffRefusal,
    ctx: { session?: string | null; day?: number } = {},
  ): HandoffWrite {
    return this.handoffs.refuseWrite(reason, ctx);
  }

  /** This directory's NEWEST live handoff, whoever wrote it, or null. A read:
   *  writes nothing. */
  readHandoff(scope: string): Handoff | null {
    return this.handoffs.read(scope);
  }

  /** Every live handoff for this directory, one per session, newest first. */
  readHandoffs(scope: string): Handoff[] {
    return this.handoffs.readAll(scope);
  }

  /**
   * WHAT THE COMPOSITION MUST LEAVE FOR DELIVERY — the preface always, and the
   * handoff pointer only while some directory holds a live one.
   *
   * Conditional, and that is the whole point: a store that has never had a
   * handoff composes its wake to exactly the number it composed before this
   * module existed, so "with no handoff written the wake is byte-identical to
   * master" is a property of the code rather than of a careful reading.
   *
   * Unconditional would be the simpler line and the wrong one in the other
   * direction too: a full store trimmed to `budget - PREFACE_RESERVE` already
   * fills the ceiling, so a pointer spliced at delivery would be dropped at
   * every wake and the only symptom would be `handoff.shown` going quiet.
   *
   * **Who pays, and how much, is `handoff/#reserveBytes`'s to decide**, and the
   * ceiling is passed in because it is half of that decision: the reserve is
   * store-wide while the pointer is per-directory, so on a small ceiling a
   * session that will be shown nothing would otherwise lose memories for it
   * (adversarial review MAJOR-1, measured). This root's only job is to hand over
   * the live blocks and the budget.
   *
   * The scan is bounded by the number of DIRECTORIES the owner has worked in —
   * a handful — and it never throws: a store that will not answer reserves
   * nothing, which composes the wake that master composes.
   *
   * **The "Last here" line rides the same reserve (2026-09-30).** Per
   * directory, each of its blocks is a candidate on its own and beside each of
   * that directory's handoff rungs, exactly as delivery tries them; the share
   * rule still takes the widest that passes, so the line can never make the
   * pointer cost more than the eighth it could already. With no handoff and
   * no chapter here inside the fortnight, the reserve is zero as before.
   */
  private wakeReserveBytes(
    budgetBytes: number,
    work = this.workReserveBytes(budgetBytes),
    handoff = this.handoffRoom(budgetBytes).reserve,
  ): number {
    return PREFACE_RESERVE_BYTES + handoff + work;
  }

  /**
   * THE HANDOFF POINTER'S AND "LAST HERE"'S TERM of `wakeReserveBytes`, on
   * its own (2026-10-10): the composition lends it to "Arriving:" and "Still
   * open"'s first item after "Work here" and the Yesterday line's titles
   * (`self/briefing.ts#ROOM_ORDER`), and the delivery then drops "Last here"
   * first and shows fewer handoffs in what is left. Never throws.
   *
   * WHAT IS LENT STOPS AT THE NEWEST HANDOFF (review of #367): `lend` is the
   * reserve less every directory's smallest rung — its newest handoff alone,
   * with the margin — so the delivery shows fewer handoffs in full, never
   * none: the next session's instructions are not room "Arriving:" or
   * "Still open" takes. `keep`, the rest of the reserve, is lent to a plain
   * reminder due the day the wake is read and to nothing else
   * (`self/briefing.ts#ROOM_ORDER`'s `handoffsKept`): a promise with its day
   * on it outranks the pointer. With no handoff, all of it is `lend` (it is
   * "Last here"'s).
   */
  private handoffRoom(budgetBytes: number): { reserve: number; lend: number; keep: number } {
    const norm = (s: string): string => s.trim().replace(/\/+$/, "");
    const blocks: number[] = [];
    let byScope = new Map<string, number[]>();
    try {
      byScope = this.handoffs.liveBlockBytesByScope();
    } catch {
      byScope = new Map();
    }
    const handoffBytes = new Map<string, number[]>();
    for (const [scope, rungs] of byScope) {
      handoffBytes.set(norm(scope), [...(handoffBytes.get(norm(scope)) ?? []), ...rungs]);
      blocks.push(...rungs);
    }
    try {
      const chapters = this.chaptersInWindow(this.store.livedDay());
      if (chapters.size > 0) {
        for (const scope of this.spans.scopes()) {
          // Sized as if every directory's chapters may cross: the reserve is
          // a bound, and the boundary cannot read the host's scope setting.
          const lines = this.lastHereLadder(scope, null, chapters, () => true).map((b) => byteLength(b));
          for (const l of lines) {
            blocks.push(l);
            for (const h of handoffBytes.get(norm(scope)) ?? []) blocks.push(l + 1 + h);
          }
        }
      }
    } catch {
      /* no chapter lines is the reserve as it was */
    }
    const reserve = reserveBytes(blocks, budgetBytes);
    let kept = 0;
    for (const rungs of handoffBytes.values()) {
      const smallest = Math.min(...rungs.filter((b) => b > 0));
      if (Number.isFinite(smallest)) kept = Math.max(kept, smallest + HANDOFF_RESERVE_MARGIN_BYTES);
    }
    const lend = Math.max(0, reserve - kept);
    return { reserve, lend, keep: reserve - lend };
  }

  /**
   * THE ROOM THE WORK LINES NEED (2026-10-01, lane 8), beside the handoff's
   * and under the same share rule (`handoff/#reserveBytes`): the widest
   * directory's whole block, with the margin, while it is at most an eighth
   * of the budget; nothing past that, and nothing with the switch off or no
   * work anywhere. Its OWN term, not a rung of the handoff's: the handoff
   * block alone already sits near the eighth at the owner's ceiling, so a
   * combined candidate would never pass and the lines would never be carried.
   * What it takes comes out of the stored lanes by their trim order — Nearby
   * first. Never throws.
   *
   * **"LAST SAID HERE" RIDES THIS TERM (2026-10-11)**: its bound
   * (`LAST_EXCHANGE_LINE_MAX_BYTES` and a newline) alone and beside each
   * directory's block, when a session was at work in any directory inside the
   * line's window — a bound, since the boundary cannot know who opens the
   * next session where. Under the same share rule, so the term is still one
   * of `self/briefing.ts#DELIVERY_SHARED_RESERVES` and the page's limit still
   * holds. Here ON PURPOSE: this is the room the page borrows before it steps
   * down a rung (`Self#build`), so the line is never the reason the page is
   * shorter, and the lanes above "Work here" in `ROOM_ORDER` come first too;
   * what is left of it at a delivery is the line's, chosen before the work
   * lines (`addHandoffPointer`). Measured, docs/IMPROVEMENTS.md.
   */
  private workReserveBytes(budgetBytes: number): number {
    const said = this.exchangeWithin() ? LAST_EXCHANGE_LINE_MAX_BYTES + 1 : 0;
    const blocks: number[] = said > 0 ? [said] : [];
    if (!this.self.tunables.CRAFT_AT_DELIVERY) return reserveBytes(blocks, budgetBytes);
    try {
      for (const scope of this.spans.scopes()) {
        const { lines } = this.workHereLines(scope);
        if (lines.length === 0) continue;
        blocks.push(workHereBytes(lines));
        if (said > 0) blocks.push(workHereBytes(lines) + said);
      }
      return reserveBytes(blocks, budgetBytes);
    } catch {
      return reserveBytes(said > 0 ? [said] : [], budgetBytes);
    }
  }

  /** Was a session at work in any directory inside "Last said here"'s window
   *  — not the store's own, where only the nightly run turn-ends? Never throws. */
  private exchangeWithin(): boolean {
    try {
      const now = this.nowFn();
      const norm = (s: string): string => s.trim().replace(/\/+$/, "");
      const own = norm(this.store.dir);
      return this.spans.scopes().some((scope) => norm(scope) !== own && exchangeLikely(this.spans, scope, now));
    } catch {
      return false;
    }
  }

  /** The DELIVERY-side record, distinct from the render-side one (scar §2.3). */
  noteWakeDelivered(sentinelSeen: string | null, expected: string | null): boolean {
    return this.self.noteDelivered(sentinelSeen, expected);
  }

  // ── the turn ───────────────────────────────────────────────────────────────

  /**
   * A turn boundary: append what is new, advance the cursor. Microseconds, no
   * model call, and it cannot throw — `SpanBuffer.capture` swallows its own
   * failures and returns a reason (§2 G1/G12).
   */
  captureSpans(input: { session: string; scope: string; turns: readonly CapturedTurn[] }): CaptureResult {
    const out = this.spans.capture(input);
    if (out.reason === "IO_FAILED") this.noteCaptureFailed(input.session);
    return out;
  }

  /**
   * A TURN THE BUFFER WOULD NOT TAKE, as a durable row (2026-09-30). The
   * buffer holds no store, so its failure is read off its own ring — the
   * newest `remember.write.failed` or `remember.capture.failed`, which this
   * synchronous call just emitted — and written here. Never throws.
   */
  private noteCaptureFailed(session: string): void {
    if (this.observer) return;
    const failed = this.spans
      .events()
      .reverse()
      .find((e) => e.name === "remember.write.failed" || e.name === "remember.capture.failed");
    const site = failed?.data?.["site"];
    const code = failed?.data?.["code"];
    try {
      this.store.appendEvent({
        name: CAPTURE_FAILED_EVENT,
        day: this.store.livedDay(),
        payload: {
          session,
          site: typeof site === "string" ? site : "capture",
          code: typeof code === "string" ? code : "UNKNOWN",
          date: this.store.today(),
        },
      });
    } catch (err) {
      this.emit("counterpart.capture.record.failed", undefined, { code: errCode(err) });
    }
  }

  /** An in-the-moment jot, riding in the buffer with ordinary spans. */
  captureJot(input: { session: string; scope: string; text: string }): CaptureResult {
    return this.spans.jot(input);
  }

  /**
   * Compose one turn's recall with ALL THREE borrowed channels bound
   * (`src/core/retrieval.ts`, SEAMS C/D/L): the alias map from `schemas/`, the
   * temporal cues from `prospective/`, the hop function from `associate/`. A
   * missing `at` means no temporal channel — a lived day is not a date.
   */
  recallForTurn(
    turn: RecallTurn,
    opts: {
      at?: string;
      /** Memory ids whose temporal cue is held back THIS turn: plain items the
       *  host is saying outright in the same breath (2026-09-26 review), so the
       *  model is not handed the same date twice in one turn. */
      withhold?: ReadonlySet<string>;
      /** No temporal cues at all THIS turn (2026-10-12): a turn nobody will
       *  read — the headless nightly run's own — must not spend the fires a
       *  person's day is owed. */
      noCues?: boolean;
    } = {},
  ): RecallResult {
    // THE TEMPORAL CUES ARE COMPUTED HERE, not inside `composeTurn`, for one
    // reason: the window each one came from has to survive the turn, so the
    // arrivals the gate actually admitted can SPEND their fire budget below.
    // `composeTurn` skips its own read when `turn.temporal` is already set, so
    // this is the same channel and the same ceiling (§12 G1, G5) — one read of
    // `arrivals()`, never two.
    const arrived =
      opts.at === undefined || turn.temporal !== undefined
        ? null
        : opts.noCues === true
          ? []
          : this.prospective.arrivals({
            at: opts.at,
            ...(turn.day === undefined ? {} : { day: turn.day }),
            sessionId: turn.sessionId,
          }).arrivals.filter((a) => opts.withhold?.has(a.memoryId) !== true);
    const withCues: RecallTurn =
      arrived === null ? turn : { ...turn, temporal: arrived.map((a) => ({ id: a.memoryId, weight: a.cueWeight })) };
    const result = recallTurn(this.recall, this.withSemantic(withCues), {
      schemas: this.schemas,
      prospective: this.prospective,
      associate: this.associate,
      ...(opts.at === undefined ? {} : { at: opts.at }),
    });
    this.recordDecision(result.decision, opts.at ?? null);
    if (arrived !== null && opts.at !== undefined) this.spendArrivals(arrived, result.decision, opts.at);
    return result;
  }

  /**
   * `Prospective.fire()`'s LIVE CALLER (2026-09-26; until today the only one was
   * `tools/demo/seed.ts`, so a dated memory would have been re-offered every
   * turn of its window). A fire is a surfacing that HAPPENED (prospective NOTES
   * §6): an arrival is spent only when the gate put its memory in this turn's
   * surfaced or footnoted set — which is what makes brake 1 (once per lived
   * day) and brake 2 (`FIRES_PER_WINDOW`) real. An aborted turn surfaced
   * nothing and spends nothing (recall §5 G2); an observer's `fire()` stands
   * down on its own (§5 G9). Never throws into the turn: a lost fire row costs
   * one extra polite mention, never the recall (§12 G12).
   */
  private spendArrivals(
    arrived: readonly { memoryId: string; windowKey: string }[],
    decision: RecallDecision,
    at: string,
  ): void {
    if (decision.aborted || arrived.length === 0) return;
    const shown = new Set<string>([...decision.surfaced, ...decision.footnotes]);
    for (const a of arrived) {
      if (!shown.has(a.memoryId)) continue;
      try {
        const first = this.prospective.occurrenceUndelivered(a.memoryId, a.windowKey);
        const fired = this.prospective.fire({
          memoryId: a.memoryId,
          windowKey: a.windowKey,
          at,
          day: decision.day,
          sessionId: decision.sessionId,
        });
        if (fired.fired && first) this.creditOccurrence(a.memoryId, a.windowKey, decision.day, "quiet");
      } catch (err) {
        this.emit("counterpart.prospective.fire.failed", a.memoryId, { code: errCode(err) });
      }
    }
  }

  /**
   * A REPEAT IS KEPT ALIVE BY COMING ROUND (owner decision 2026-10-09, held
   * lightly). The first delivery of each occurrence of a repeating date — a
   * quiet fire the gate admitted, or a plain line the host claimed — counts as
   * one use of the memory, the way rehearsal keeps a memory: `store.reinforce`,
   * the seam recall's credit ends in, at the `surfaced` tier. Surfaced and not
   * referenced: it was shown, nothing says the reply used it, and a schedule
   * earns no RETURN (`physics#creditReturn` refuses `not-referenced`), so a
   * daily repeat never walks the core's slow lane on the calendar alone. Once
   * per occurrence (`Prospective.occurrenceUndelivered`, asked before the
   * delivery); a one-off date, or a repeat whose `recurring` was dropped, is
   * never credited here. Physics keeps its own refusals (birth day, already
   * credited today). Never throws into the turn.
   */
  private creditOccurrence(memoryId: string, windowKey: string, day: number, via: "quiet" | "plain"): void {
    try {
      const out = this.store.reinforce(memoryId, day, "surfaced");
      this.emit("counterpart.prospective.occurrence.credited", memoryId, {
        window: windowKey,
        via,
        credited: out.credited,
        reason: out.reason,
        day,
      });
    } catch (err) {
      this.emit("counterpart.prospective.occurrence.failed", memoryId, { window: windowKey, code: errCode(err) });
    }
  }

  /**
   * PLAIN REMINDERS DUE TODAY, NOT YET CLAIMED — a read. The owner-decided
   * exception to "a cue, not a command" (prospective CONTRACT §3): an item its
   * author marked plain is SAID on its day, to the person and to the model,
   * once per beat. A host that can tell whether its line will actually reach
   * the person reads here and claims (`claimPlainReminder`) only what it is
   * certainly about to show — "mark only what is certainly leaving", the
   * update notice's rule (2026-09-26 review). `plainReminders` is the two in
   * one, for a host with no such question.
   *
   * `what` is the memory's title, else the first line of its body, with its
   * whitespace folded — the handle a person recognizes. How long a line may be
   * and the sentence around it are the host adapter's to decide. Never throws:
   * any failure is an empty list.
   */
  plainDueToday(input: { at: string }): PlainReminder[] {
    if (this.observer) return [];
    const out: PlainReminder[] = [];
    try {
      for (const due of this.prospective.plainDue({ at: input.at })) {
        let what = "";
        try {
          const read = this.store.read(due.memoryId);
          // Confidential is said only in the owner's own session — recall's
          // boundary gate 1, which a line outside recall must keep by hand.
          if (read.confidential && !this.owner) continue;
          const doc = read.doc;
          const title = doc.title?.trim() ?? "";
          const line = doc.body.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
          what = (title.length > 0 ? title : line).replace(/\s+/g, " ").trim();
        } catch {
          continue;
        }
        if (what.length === 0) continue;
        out.push({ ...due, what });
      }
    } catch (err) {
      this.emit("counterpart.prospective.plain.failed", undefined, { code: errCode(err) });
    }
    return out;
  }

  /**
   * Claim one plain beat: TRUE only when this call wrote the latch
   * (`Prospective.claimPlain`), so two processes racing for the same beat
   * cannot both show it. Show the line only on true. Never throws.
   */
  claimPlainReminder(reminder: PlainDue, input: { at: string; day?: number; session?: string }): boolean {
    if (this.observer) return false;
    try {
      const day = input.day ?? this.store.livedDay();
      // Asked BEFORE the claim, which is itself what would make it false.
      const first = this.prospective.occurrenceUndelivered(reminder.memoryId, reminder.windowKey);
      const claimed = this.prospective.claimPlain(reminder, {
        at: input.at,
        day,
        ...(input.session === undefined ? {} : { session: input.session }),
      });
      if (claimed && first) this.creditOccurrence(reminder.memoryId, reminder.windowKey, day, "plain");
      // TOLD ON ITS DAY, IT LEAVES "ARRIVING:" (2026-09-29) — and the wake
      // published before the telling still lists it, until something
      // re-renders. A day's first render can come before the day's first tell
      // (a late session's turn ending after midnight), and on 2026-10-09 a
      // reminder said outright on the 8th was still under "Arriving:" the next
      // morning. So the telling marks the wake behind, and the next turn-end
      // worker re-renders it (`refreshWake`).
      if (claimed && reminder.beat !== "opens") markWakeBehind(this.store, "told");
      return claimed;
    } catch (err) {
      this.emit("counterpart.prospective.plain.failed", reminder.memoryId, { code: errCode(err) });
      return false;
    }
  }

  /**
   * PLAIN REMINDERS DUE TODAY, each already CLAIMED (`plainDueToday`, then
   * `claimPlainReminder` on each) — so the caller shows every one it gets
   * back, and a second process asking the same morning gets none. For a host
   * that shows whatever it reads; the Claude Code hooks instead claim only
   * what their envelope will carry (`bin/hook.ts#deliverTurn`).
   */
  plainReminders(input: { at: string; day?: number }): PlainReminder[] {
    return this.plainDueToday({ at: input.at }).filter((r) => this.claimPlainReminder(r, input));
  }

  /**
   * THE FOURTH BORROWED CHANNEL, and the one that had no wiring: the lagged
   * semantic cue.
   *
   * `Turn.vector` existed from the first commit of `recall/` and neither live
   * path ever set it — the hook built its turn without one, the deliberate tool
   * built its own — so the store's embeddings were consulted by nothing live
   * (measured 2026-09-04). This is where that ends, and it is here rather than
   * in an adapter for the same reason the alias map is: a caller that forgets a
   * channel loses it silently, and this composition root is the one place all of
   * them meet.
   *
   * A CALLER-SUPPLIED input always wins — the deliberate ask embeds its own
   * question in line and must not be overridden by a stale conversational cue.
   */
  private withSemantic(turn: RecallTurn): RecallTurn {
    if (turn.vector !== undefined || turn.semanticHits !== undefined) return turn;
    const lag = loadSessionSemantic(this.store, turn.sessionId);
    return {
      ...turn,
      ...(lag.hits === null ? {} : { semanticHits: lag.hits }),
      semanticSource: lag.source,
      ...(lag.fromTurn === null ? {} : { semanticFromTurn: lag.fromTurn }),
    };
  }

  /**
   * Record the lagged semantic cue for the NEXT turn: rank the vector the caller
   * embedded, and store the top-M slice as this session's gate state.
   *
   * The RANK lives here, in the detached caller's process, because it is the
   * expensive half — `Store.nearestTo` measured 590-1040 ms over a live-sized
   * vector index — and the whole point of the lag is that the hot path spends
   * none of that. `SEMANTIC_TOP_M` is `recall/`'s own number, read off the gate
   * rather than restated by an adapter: a slice size chosen at the caller would
   * be a threshold with no home.
   *
   * It writes on EVERY call, including the ones with no vector, so the next
   * turn's decision can say *why* the channel was dark by name.
   */
  noteSessionSemantic(input: {
    sessionId: string;
    reason: SemanticReason;
    vector?: readonly number[] | null;
    model?: string | null;
  }): { stored: boolean; hits: number; reason: SemanticReason; turn: number | null } {
    const vec = input.vector ?? null;
    const reason: SemanticReason =
      input.reason === "ok" && (vec === null || vec.length === 0) ? "embed-failed" : input.reason;
    const hits =
      reason === "ok" && vec !== null
        ? // The turn's lagged semantic cue is AMBIENT: below-reach rows take
          // no slot (2026-10-10, physics `REACH`; `cache.ts#reachJoin`).
          this.store.nearestTo(vec, this.recall.tunables.SEMANTIC_TOP_M, { minStrength: PHYSICS.REACH })
        : [];
    if (this.observer) {
      // An instrument leaves the world as it found it, and says so (G6).
      this.emit(SEMANTIC_LAG_EVENT, input.sessionId, { reason, hits: hits.length, stored: false });
      return { stored: false, hits: hits.length, reason, turn: null };
    }
    // The turn this cue is FOR: the session's served count right now, which the
    // next turn's `loadSessionSemantic` compares against to expire it after one.
    const served = loadGateState(this.store, input.sessionId).state.turn;
    try {
      saveSessionSemantic(this.store, {
        sessionId: input.sessionId,
        turn: served,
        lastDay: this.store.livedDay(),
        reason,
        model: input.model ?? null,
        dim: vec?.length ?? 0,
        hits,
      });
    } catch {
      // A lock lost to a concurrent hook costs the CUE, never the run.
      this.emit(SEMANTIC_LAG_EVENT, input.sessionId, { reason, hits: hits.length, stored: false });
      return { stored: false, hits: hits.length, reason, turn: served };
    }
    this.emit(SEMANTIC_LAG_EVENT, input.sessionId, { reason, hits: hits.length, stored: true });
    return { stored: true, hits: hits.length, reason, turn: served };
  }

  /**
   * THE DURABLE RECORD of one turn's surfacing decision — the same seam
   * `gate.chunk` is written through, for the same reason: the store a run leaves
   * behind is the only evidence it leaves, and §17.3's comparison surface was
   * reachable only from a live process (replay INTERFACE-GAPS §7).
   *
   * Two skips, and they are not the same skip:
   *
   *   - **An abort writes NOTHING, here or in the ring.** `recall/` §5 G2 is
   *     "nothing injected, buffered, LOGGED, or spent" — a subconscious that
   *     lost its race must not then pay for a durable write to say so. The
   *     timeout arm of the race is counted by the adapter's own per-turn event
   *     (`adapter.recall {reason: "latency-abort"}`), which is a log, not a ring.
   *   - **An observer stands down at the store seam** and says so in the
   *     in-process event, exactly as `recall/`'s own gate-state write does
   *     (observer-mode.md G6): a stood-down instrument stays distinguishable
   *     from a broken hook (scar §2.4).
   *
   * No `dedupKey` — deliberately. A turn number restarts at 1 whenever gate
   * state is reset or evicted, so a `session:turn` latch would swallow a genuine
   * second decision; and this is per-turn telemetry, which is exactly what the
   * log's existing retention window is for. No retention rule is added here.
   */
  private recordDecision(d: RecallDecision, date: string | null): void {
    if (d.aborted) return;
    let durable = !this.observer;
    if (durable) {
      // Guarded like `noteAdapterEvent`: a lock lost to the detached worker
      // must cost the ROW, never the turn's injection — a throw here would be
      // swallowed by the adapter's guard and take the recall down with it.
      try {
        this.store.appendEvent({
          name: RECALL_DECISION_EVENT,
          day: d.day,
          ref: d.sessionId,
          payload: recallDecisionRecord(d, { date }),
        });
      } catch (err) {
        durable = false;
        this.emit("counterpart.recall.decision.failed", d.sessionId, { code: errCode(err) });
      }
    }
    this.emit("counterpart.recall.decision", d.sessionId, {
      turn: d.turn,
      reason: d.reason,
      surfaced: d.surfaced.length,
      footnotes: d.footnotes.length,
      bytes: d.bytes,
      durable,
      standdown: durable ? null : "observer",
    });
  }

  /** Retrospective reinforcement for ONE memory the reply actually used. */
  resolveUse(sessionId: string, memoryId: string, tier: UseTier, opts: { cued?: boolean } = {}): CreditResult {
    return this.recall.resolveUse(sessionId, memoryId, tier, opts);
  }

  /**
   * THE MEMORIES A DELIBERATE QUESTION'S ANSWER SHOWED, for one session
   * (Release B, 2026-10-03): recorded as `asked` gate records, so that
   * quoting one's words in a reply credits it at the boundary
   * (`creditReferences`). A list shown credits nothing on its own. Written
   * through the store's gate-record door, so an observer's store refuses it
   * (the caller swallows that, as it does every telemetry write).
   */
  noteAsked(sessionId: string, ids: readonly string[]): void {
    if (ids.length === 0) return;
    const day = this.store.livedDay();
    const at = askedTurn(this.store.now());
    this.store.setGateRecords(
      [...new Set(ids)].map((id) => ({ sessionId, kind: ASKED_KIND, ref: id, turn: at, lastDay: day, tier: "asked", trains: true })),
    );
  }

  /**
   * THE CREDIT SEAM, decided and applied in one call (recall §9.2; INTERFACE-GAPS
   * §5, closed). Candidates are what this session surfaced LOUD — read from the
   * gate state, bodies from prose — plus whatever the assistant expanded by id.
   * Decision is `reference.ts` (pure); credit is `resolveUses` (the gate state's
   * two refusals, then physics). Nothing here trains on a footnote, a wake line
   * or a name in prose.
   */
  creditReferences(sessionId: string, input: CreditReferencesInput): CreditSummary {
    const day = this.store.livedDay();
    const now = input.now ?? Date.now;
    const state = this.recall.gateState(sessionId);
    const candidates: ReferenceCandidate[] = [];
    let unreadable = 0;
    let budgetExceeded = false;
    // The prose reads are under the same deadline as the compare: a loud
    // candidate never read is reported by the resolver as skipped-for-budget,
    // not silently absent. (In practice the gate state's record cap bounds
    // this loop, and loud surfacing is rare; the deadline is the tripwire.)
    for (const [id, rec] of Object.entries(state.surfaced)) {
      if (rec.tier !== "surfaced" || !rec.trains) continue;
      if (input.deadline !== undefined && now() > input.deadline) {
        budgetExceeded = true;
        candidates.push({ id, tier: "surfaced", body: "" });
        continue;
      }
      try {
        candidates.push({ id, tier: "surfaced", body: this.store.readProse(id).body });
      } catch {
        unreadable += 1;
      }
    }
    // WHAT A DELIBERATE QUESTION SHOWED (Release B, 2026-10-03): its answer's
    // memories, with their words, are quotable as a loud surfacing is — the
    // owner's 09-14 rule (opening or quoting credits) on the deliberate path.
    // Not `cued`: the display decides, as for an expansion. A memory already a
    // candidate is not added twice.
    const have = new Set(candidates.map((c) => c.id));
    let asked: { ref: string; turn: number }[] = [];
    try {
      asked = this.store
        .gateRecords(sessionId, ASKED_KIND)
        .sort((a, b) => b.turn - a.turn)
        .slice(0, ASKED_MAX);
    } catch {
      asked = [];
    }
    for (const rec of asked) {
      if (have.has(rec.ref)) continue;
      have.add(rec.ref);
      if (input.deadline !== undefined && now() > input.deadline) {
        budgetExceeded = true;
        candidates.push({ id: rec.ref, tier: "surfaced", body: "" });
        continue;
      }
      try {
        candidates.push({ id: rec.ref, tier: "surfaced", body: this.store.readProse(rec.ref).body });
      } catch {
        unreadable += 1;
      }
    }
    const refs = resolveReferences({
      assistantTurns: input.assistantTurns,
      expansions: input.expansions,
      candidates,
      ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    // SHOWN, AND NOT USED (2026-10-09). Recall predicts on every turn that what
    // it shows will help the reply, and until now a miss left no record per
    // memory. The ambient showings since the last boundary that judged are
    // scored once, here: used when a reply expanded or quoted them (whether or
    // not credit then landed), otherwise listed. Measurement only. A boundary
    // whose slice holds no reply and no expansion judges nothing (review of
    // #329): a capture that failed or found nothing new is not a reply that
    // ignored what it was shown.
    const replied = input.assistantTurns.length > 0 || input.expansions.length > 0;
    const showings = this.scoreShowings(sessionId, state, refs.uses, day, replied);
    // An expansion is an ADDRESS the assistant typed into a tool call, and a
    // well-shaped address can still name nothing: a typo, or a memory removed
    // since it was footnoted. Physics would throw on it (`requireRow`) and take
    // the whole boundary's credit down as `failed` — the reason the daily's
    // readers alarm on. A bad address is a refusal, counted, not a failure.
    const refused: Record<string, number> = {};
    const refuse = (why: string): void => {
      refused[why] = (refused[why] ?? 0) + 1;
    };
    const uses = refs.uses.filter((u) => {
      const row = this.store.row(u.memoryId);
      if (row === undefined) {
        refuse("unknown-id");
        return false;
      }
      // `store.row` still answers for an archived row (merged, pruned): a
      // stale footnote expanded after its memory left must not revive it.
      if (row.archived === 1) {
        refuse("archived");
        return false;
      }
      // A HANDOFF TAKES NO CREDIT (E1). It is the one row a session is invited
      // to expand by id from its own wake, and crediting that would be the
      // system reinforcing itself for handing something over: `uses` and
      // `reinforced_days` would climb on working context, and
      // `physics#promotionEligibility` — reinforcement on N distinct lived days
      // — is exactly the door that turns a row into identity. Refused by name so
      // the boundary's row says it happened rather than swallowing it.
      if (isHandoffRow(this.store, u.memoryId)) {
        refuse("handoff");
        return false;
      }
      return true;
    });
    // ONE USE AT A TIME, each inside its own try. `resolveUse` reaches physics
    // through `requireRow`, which consults the deny-list `store.row` does not:
    // an id at removal stage `dark` passes the filter above and throws REMOVED
    // there. Before this, one throw mid-batch left earlier credits standing,
    // later uses never attempted, coactivation never run, and the row reading
    // `failed` for a boundary that half-succeeded (review of #99, finding 1).
    // A throw is a refusal keyed by its code; the batch goes on.
    const ids: string[] = [];
    const how: CreditHow[] = [];
    const coactivated: Credited[] = [];
    let credited = 0;
    /** Uses whose strength credit was refused for its day cadence and that
     *  joined the turn's links anyway (2026-09-28) — counted, so the decoupling
     *  is visible on the credit row. */
    let linkedDespite = 0;
    for (const u of uses) {
      try {
        // A QUOTED use was a loud candidate recall surfaced on a turn's own cue
        // this session: organic, whatever the wake's hints lane was showing. An
        // EXPANDED id may have been read off the wake — the display decides
        // whether it is a return (physics §5.11).
        const r = this.resolveUse(sessionId, u.memoryId, "referenced", u.how === "quoted" ? { cued: true } : {});
        // LINKS DO NOT INHERIT THE ONCE-A-DAY RULE (2026-09-28; associate NOTES
        // §8). Strength is credited once per lived day; a PAIR is a different
        // question — a memory used on turn 1 and again on turn 5 beside a new
        // one was thought together with it. So every use that was refused only
        // for its day cadence still joins this turn's pair set. What stays out:
        // an ambiguous handle (it trains nothing, edges included — §9 G5), an
        // observer, and a use that threw. Pairs are still at most once per turn:
        // `coactivate` takes each id once.
        if (r.credited || linksDespite(r)) coactivated.push({ id: u.memoryId, tier: "referenced" });
        if (!r.credited && linksDespite(r)) linkedDespite += 1;
        if (r.credited) {
          credited += 1;
          ids.push(u.memoryId);
          how.push(u.how);
          continue;
        }
        // The physics enum where physics refused, recall's own reason
        // otherwise — both are closed sets the daily can split on.
        refuse(r.outcome?.reason ?? r.reason);
      } catch (err) {
        refuse(errCode(err));
      }
    }
    if (coactivated.length > 0) this.publishCoactivation(coactivated, day);
    const reason: CreditSummary["reason"] = refs.budgetExceeded || budgetExceeded
      ? "budget-exceeded"
      : credited > 0
        ? "credited"
        : candidates.length === 0 && refs.uses.length === 0
          ? "no-candidates"
          : "nothing-to-credit";
    const expandedIds = refs.uses.filter((u) => u.how === "expanded").map((u) => u.memoryId);
    const pointersExpanded = expandedIds.filter((id) => state.surfaced[id]?.via === "link").length;
    const summary: CreditSummary = {
      reason,
      day,
      expandedIds,
      pointersExpanded,
      considered: refs.considered,
      expanded: refs.expanded,
      quoted: refs.quoted,
      credited,
      unresolvedHandles: refs.unresolvedHandles,
      skippedForBudget: refs.skippedForBudget,
      unreadable,
      refused,
      ids,
      how,
      linkedDespite,
      shown: showings.shown,
      unused: showings.unused,
      shownNotUsed: showings.shownNotUsed,
      judgedThrough: showings.judgedThrough,
    };
    this.emit("counterpart.credit", sessionId, {
      reason,
      day,
      considered: summary.considered,
      expanded: summary.expanded,
      quoted: summary.quoted,
      credited,
      linkedDespite,
      pointersExpanded,
      shown: showings.shown.loud + showings.shown.footnotes + showings.shown.pointers,
      shownNotUsed: showings.shownNotUsed.length,
    });
    return summary;
  }

  /**
   * THE `drewOn` FIELD (2026-10-11): the session SAYS which memories it was
   * shown that shaped what it did or said, on `session_end` or `chapter`, and
   * each is credited at the `engaged` tier — half a use, a half-weight
   * `engaged` return, no core-lane day. The successor to #371's matcher, which
   * guessed at it from rare title words (hand-read precision 0.17–0.33, parked
   * 2026-10-10). Built by the drewOn builder, 2026-10-11, from Mike's 10-10
   * direction, lightly held.
   *
   * THE ONE GUARD: only an id this session was actually SHOWN counts — what
   * recall's per-session record holds: the ambient footnotes and loud
   * memories (`surfaced`) and what a deliberate question's answer showed
   * (`asked`). Anything else is refused `not-shown` and nothing is credited
   * for it. The wake is not in that record (it is published per store, not
   * per session), so a wake line is credited by opening it, as before.
   *
   * Then, each by name: an id that names nothing, an archived row, a handoff
   * (E1), and — never revived by engagement — a superseded memory or one faded
   * under a newer one (synthesis collision G). At most
   * `DREW_ON_MAX_PER_BOUNDARY` land per boundary, the first in the order
   * given; the rest come back `capped`. Once per lived day per memory is
   * recall's and physics' own rule (`already-credited-at-or-above`,
   * `already-credited-today`): an id this session opened or quoted today is
   * already credited above this tier. An open later the same day lifts an
   * engaged credit to a full use (`physics#creditUse`'s `upgradeFrom`).
   *
   * A DATED memory named here was ACTED ON (2026-10-11, review 07 C3; wired
   * by the group-5 builder, lightly held): once an id passes the guards
   * above — shown, live, not replaced — its open reminder window is stopped
   * (`Prospective#actedOn`, the referenced-stop), whether or not the credit
   * itself lands under the cap or the once-a-day rule: the session said it
   * used it, and a reminder already used should not come back as a footnote.
   * Needs the calendar day the host is on (`opts.at`); without one, nothing
   * is stopped. A plain reminder keeps its day (`actedOn`).
   *
   * Under observer stance nothing is read or written: every id comes back
   * refused `observer`.
   */
  creditDrewOn(sessionId: string, named: readonly string[], opts: { at?: string } = {}): DrewOnResult {
    const day = this.store.livedDay();
    const ids = [...new Set(named.map((id) => id.trim()).filter((id) => id.length > 0))];
    const credited: string[] = [];
    const refused: { id: string; reason: string }[] = [];
    const capped: string[] = [];
    const actedOn: string[] = [];
    let linked = 0;
    const done = (): DrewOnResult => ({ day, named: ids.length, credited, refused, capped, actedOn, linked });
    if (this.observer) {
      for (const id of ids) refused.push({ id, reason: "observer" });
      return done();
    }
    const state = this.recall.gateState(sessionId);
    const shown = new Set(Object.keys(state.surfaced));
    try {
      for (const rec of this.store.gateRecords(sessionId, ASKED_KIND)) shown.add(rec.ref);
    } catch {
      // An unreadable `asked` record narrows what counts as shown; never wider.
    }
    // What this boundary already credited this way: the other tool's answer
    // to the same ask shares the cap.
    const members: Credited[] = [];
    let slots =
      DREW_ON_MAX_PER_BOUNDARY -
      Object.values(state.credited).filter((c) => c.tier === "engaged" && c.day === day && c.turn === state.turn).length;
    for (const id of ids) {
      const refuse = (reason: string): void => {
        refused.push({ id, reason });
      };
      if (!shown.has(id)) {
        refuse("not-shown");
        continue;
      }
      const row = this.store.row(id);
      if (row === undefined) {
        refuse("unknown-id");
        continue;
      }
      if (row.archived === 1) {
        refuse("archived");
        continue;
      }
      if (isHandoffRow(this.store, id)) {
        refuse("handoff");
        continue;
      }
      // ENGAGEMENT NEVER REVIVES WHAT A NEWER MEMORY REPLACED (ported from
      // #371; synthesis collision G). Opening an old memory on purpose still
      // credits it, as before.
      if (row.superseded_by !== null) {
        refuse("superseded");
        continue;
      }
      if (fadeOf({ fade: row.fade }) < 1) {
        refuse("faded-under-newer");
        continue;
      }
      if (opts.at !== undefined && row.event_date !== null) {
        try {
          if (this.prospective.actedOn(id, opts.at, day).length > 0) actedOn.push(id);
        } catch (err) {
          // A lost stop costs one more polite footnote, never the credit (§12 G12).
          this.emit("counterpart.drewOn.actedOn.failed", id, { code: errCode(err) });
        }
      }
      if (slots <= 0) {
        capped.push(id);
        continue;
      }
      try {
        const r = this.resolveUse(sessionId, id, "engaged");
        // THE DEPOSIT (2026-10-11, Group 4 item 1; review 06 C1): what the
        // session drew on together was thought together, so the named
        // memories enter one pair set at the REFERENCED tier — a co-use, one
        // `HEBB_RATE` per pair, homeostasis bounding it at the flush. Strength
        // stays the engaged tier's half use; only the link is a full deposit.
        // As in `creditReferences`, a memory refused only for its day cadence
        // (opened earlier today, born today) still joins the pair set. The set
        // holds at most DREW_ON_MAX_PER_BOUNDARY (reviewer of #423): a refusal
        // for cadence spends no credit slot, so without this bound a session
        // naming twenty memories it had opened would send 190 full-rate pairs.
        if ((r.credited || linksDespite(r)) && members.length < DREW_ON_MAX_PER_BOUNDARY) members.push({ id, tier: "referenced" });
        if (r.credited) {
          credited.push(id);
          slots -= 1;
          continue;
        }
        refuse(r.outcome?.reason ?? r.reason);
      } catch (err) {
        refuse(errCode(err));
      }
    }
    if (members.length > 1) linked = this.publishCoactivation(members, day);
    this.emit("counterpart.drewOn", sessionId, {
      day,
      named: ids.length,
      credited: credited.length,
      refused: refused.length,
      capped: capped.length,
      actedOn: actedOn.length,
      linked,
    });
    return done();
  }

  /**
   * One boundary's score of recall's ambient showings (2026-10-09; Hawkins
   * "2a", measurement only). The stretch is every memory this session's gate
   * state records as shown after the session's `judged` mark — loud,
   * footnoted, or footnoted as a quiet pointer — and the mark then moves to the
   * session's newest recall turn, so the next boundary scores only what came
   * after. A showing used at a later boundary than its own is still counted
   * once as not used here, and then as used there (`expandedIds`, or a quote):
   * the score is of the reply it was shown for. A deliberate answer's memories
   * (`asked`) are not ambient and are not in the gate state's `surfaced`.
   *
   * Never throws: a mark that cannot be read scores from the session's start,
   * one that cannot be written is re-scored next time — both say more misses,
   * never fewer, and neither costs the boundary its credit. Under observer the
   * mark is not written (an instrument deposits nothing).
   *
   * `replied` false (the slice held no reply and no expansion): nothing is
   * scored and the mark stays, so the showings wait for the first boundary
   * that read a reply (review of #329).
   */
  private scoreShowings(
    sessionId: string,
    state: GateState,
    uses: readonly { memoryId: string }[],
    day: number,
    replied: boolean,
  ): { shown: ShownLanes; unused: ShownLanes; shownNotUsed: string[]; judgedThrough: number } {
    let from = 0;
    try {
      from = judgedThrough(this.store, sessionId);
    } catch {
      from = 0;
    }
    const used = new Set(uses.map((u) => u.memoryId));
    const shown = { loud: 0, footnotes: 0, pointers: 0 };
    const unused = { loud: 0, footnotes: 0, pointers: 0 };
    const shownNotUsed: { id: string; turn: number }[] = [];
    if (!replied) return { shown, unused, shownNotUsed: [], judgedThrough: from };
    for (const [id, rec] of Object.entries(state.surfaced)) {
      if (rec.turn <= from) continue;
      const lane = rec.tier === "surfaced" ? "loud" : rec.via === "link" ? "pointers" : "footnotes";
      shown[lane] += 1;
      if (used.has(id)) continue;
      unused[lane] += 1;
      shownNotUsed.push({ id, turn: rec.turn });
    }
    shownNotUsed.sort((a, b) => a.turn - b.turn || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const through = Math.max(from, state.turn);
    if (through > from && !this.observer) {
      try {
        markJudged(this.store, sessionId, through, day);
      } catch (err) {
        this.emit("counterpart.credit.judged.failed", sessionId, { code: errCode(err) });
      }
    }
    return { shown, unused, shownNotUsed: shownNotUsed.map((s) => s.id), judgedThrough: through };
  }

  /**
   * THE HEBBIAN HALF OF THE CREDIT PASS — buffered here, written down elsewhere.
   *
   * `coactivate()` accumulates pair deltas in an in-process `DeltaBuffer` (the
   * declared durability exemption, `associate/CONTRACT.md` §5 G11) and `flush()`
   * turns them into edge rows. On a host whose every hook is a fresh process
   * those two halves are in different processes: this pass runs inside a Stop
   * hook, and `sessionEnd` runs in the worker that Stop spawns. For the whole
   * of the parallel run the buffer therefore died at hook exit — the owner's
   * store carried 430 edges, every one stamped with the import's lived day,
   * through 214 credit passes (mechanism inventory 2026-09-17 §3 S3).
   *
   * So the pass DRAINS its buffer to a file and the worker applies it
   * (`associate/pending.ts`). It does not flush, and it does not append a
   * durable row. Both were writes, and this path meets the detached worker's
   * own write lock: an adversarial probe measured 5.3 s of blocking apiece
   * under a held lock — I38's exact scenario, `database is locked` in 3 of 8
   * runs — with the drained deltas then recorded nowhere. **No database lock is
   * taken for association on the hook path at all**; the reads `coactivate`
   * makes (the deny-list, the member rows) are reads.
   *
   * CONTAINED, because a hook may not fail its host (adapter CONTRACT §5 G2).
   * `coactivate` reads the graph, and the append is a filesystem write; both are
   * wrapped, so neither can climb into the adapter's outer catch and mark a
   * boundary `failed` whose physics credit had already landed. An append that
   * fails costs the pass's deltas and leaves an in-process event as the only
   * record of it — the one loss this redesign does not close, and it is a disk
   * that refused a kilobyte rather than a lock somebody else was holding.
   *
   * An observer buffers nothing (`associate/` G7) and writes no file: the
   * stand-down returns before the directory is so much as created. It is
   * evented in process, so it stays distinguishable from a hook that broke
   * (observer-mode.md G6, scar §2.4).
   */
  private publishCoactivation(members: readonly Credited[], day: number): number {
    const started = this.store.now();
    let co: CoactivateResult | null = null;
    let deltas: PairDelta[] = [];
    let thrown: string | null = null;
    try {
      co = this.associate.coactivate(members);
      deltas = this.associate.drain();
    } catch (err) {
      thrown = errCode(err);
    }
    if (this.observer) {
      this.emit("counterpart.associate.standdown", undefined, { site: "pending" });
      return 0;
    }
    const eligible = co?.members.filter((m) => m.reason === "eligible").length ?? 0;
    const append =
      deltas.length === 0
        ? { ok: thrown === null, lines: 0, pairs: 0, droppedPairs: 0, code: thrown }
        : appendPendingDeltas(this.store.dir, deltas, { day, at: started });
    this.emit("counterpart.associate.pending", undefined, {
      day,
      members: co?.members.length ?? members.length,
      eligible,
      // What was drained, and what reached the file. They differ only when the
      // append failed, and then the difference IS the loss.
      pairs: deltas.length,
      written: append.pairs,
      dropped: append.droppedPairs + (append.ok ? 0 : deltas.length - append.pairs),
      code: append.code,
      elapsedMs: this.store.now() - started,
    });
    // What reached the file: the pairs a later boundary can land.
    return append.pairs;
  }

  /**
   * THE WORKER'S HALF — take what the hooks left on disk and write the edges.
   *
   * Called from `sessionEnd`, which runs in the detached worker: the process
   * that already holds the operational database's write lock, and the one place
   * where waiting on it costs nobody a turn. Each claim file is its own unit of
   * work (`pending.ts#claimPending` renames it aside), and the file is removed
   * only after its deltas have landed — an apply that meets a busy database
   * leaves the claim exactly where it is and the next boundary's worker retries
   * it, so nothing is lost and the eventual row says how old the carried work
   * was.
   *
   * ONE FLUSH PER CLAIM, stamped with the newest lived day the claim carries.
   * Splitting a claim by day would mean a claim whose first group landed and
   * whose second failed, and a retry of that claim would then apply the first
   * group twice — the one direction `associate/CONTRACT.md` §5 G4 rules out.
   * The cost is that a claim spanning two days stamps the older day's pairs with
   * the newer day, which happens only when no worker ran for a day.
   *
   * A run that carried nothing writes no row (see `ASSOCIATE_FLUSH_EVENT`). An
   * observer claims nothing: the stand-down is checked before the rename.
   */
  applyPendingAssociations(opts: { now?: number; staleMs?: number; session?: string } = {}): PendingApplyReport {
    const idle: PendingApplyReport = {
      reason: "nothing-pending",
      claims: 0,
      passes: 0,
      pairs: 0,
      rows: 0,
      blocked: 0,
      evicted: 0,
      swept: 0,
      dropped: 0,
      pendingDropped: 0,
      corrupt: 0,
      stuck: 0,
      oldestMs: 0,
    };
    if (this.observer) {
      this.emit("counterpart.associate.standdown", undefined, { site: "apply" });
      return { ...idle, reason: "observer" };
    }
    const now = opts.now ?? this.store.now();
    let claims: PendingClaim[] = [];
    try {
      claims = claimPending(this.store.dir, {
        now,
        ...(opts.staleMs === undefined ? {} : { staleMs: opts.staleMs }),
      });
    } catch (err) {
      this.emit("counterpart.associate.claim.failed", undefined, { code: errCode(err) });
      return { ...idle, reason: "failed" };
    }
    if (claims.length === 0) return idle;

    const out = {
      ...idle,
      reason: "flushed" as PendingApplyReport["reason"],
      claims: claims.length,
      oldestMs: Math.max(
        0,
        ...claims.map((c) => (c.oldestAt === null ? 0 : now - c.oldestAt)),
      ),
    };
    let failure: string | null = null;
    const linked: string[] = [];
    for (const claim of claims) {
      out.passes += claim.passes;
      out.pairs += claim.deltas.length;
      out.pendingDropped += claim.droppedPairs;
      out.corrupt += claim.corrupt;
      let report: FlushReport | null = null;
      let threw: string | null = null;
      try {
        this.associate.absorb(claim.deltas);
        report = this.associate.flush(claim.day ?? this.store.livedDay());
      } catch (err) {
        threw = errCode(err);
      }
      if (report !== null) {
        out.rows += report.rows;
        out.blocked += report.blocked;
        out.evicted += report.evictions.length;
        out.swept += report.swept;
        out.dropped += report.dropped;
        linked.push(...(report.linkedIds ?? []));
      }
      // `busy` is not applied either, and it is the subtle one: `flush()`
      // returns it WITHOUT draining, so the claim's deltas were never
      // published. Removing the file there would drop them on the floor.
      const applied =
        threw === null && report !== null && report.reason !== "failed" && report.reason !== "busy";
      if (!applied) {
        // THE CLAIM STAYS. Its deltas are gone from this process's buffer (the
        // drain precedes the publish, by design) but they are still on disk,
        // which is the whole point of the file.
        failure = threw ?? report?.code ?? "UNKNOWN";
        out.dropped += threw === null ? 0 : claim.deltas.length;
        continue;
      }
      const released = releasePending(claim);
      if (released.stuck) {
        // A claim that cannot be removed will be applied again by a later run:
        // doubling, which G4 rules out. Counted here rather than hidden, and
        // recorded in `associate/INTERFACE-GAPS.md` §3.
        out.stuck += 1;
        this.emit("counterpart.associate.claim.stuck", undefined, { code: released.code });
      }
    }
    if (failure !== null) out.reason = "failed";
    else if (out.pairs === 0) out.reason = "nothing-buffered";

    // The lived day is a database read; a busy database must not lose the row
    // over it (second review, 2026-09-17), so the newest day a claim carried
    // stands in, and the row says which it used.
    let rowDay: number | null = null;
    try {
      rowDay = this.store.livedDay();
    } catch {
      rowDay = null;
    }
    const data: Record<string, unknown> = {
      reason: out.reason,
      day: rowDay ?? Math.max(0, ...claims.map((c) => c.day ?? 0)),
      dayFrom: rowDay === null ? "claim" : "clock",
      claims: out.claims,
      passes: out.passes,
      pairs: out.pairs,
      rows: out.rows,
      blocked: out.blocked,
      evicted: out.evicted,
      swept: out.swept,
      dropped: out.dropped,
      pendingDropped: out.pendingDropped,
      corrupt: out.corrupt,
      stuck: out.stuck,
      oldestMs: out.oldestMs,
      // LINKS LAID (2026-10-11, Group 4 item 7): co-use pairs that landed —
      // not `rows`, which counts both directions and every sibling a touched
      // node's decay rewrote. What the dashboard's "links made" sums.
      deposited: Math.max(0, out.pairs - out.blocked - out.dropped),
      ...rowIds(linked),
      // The APPLYING session (2026-10-11): the boundary whose worker carried
      // these claims. A claim may hold lines several sessions credited.
      ...(isKnownSession(opts.session) ? { session: opts.session } : {}),
    };
    if (failure !== null) data["error"] = failure;
    this.emit("counterpart.associate.applied", undefined, {
      reason: out.reason,
      claims: out.claims,
      pairs: out.pairs,
      rows: out.rows,
      dropped: out.dropped,
      oldestMs: out.oldestMs,
    });
    try {
      this.store.appendEvent({
        name: ASSOCIATE_FLUSH_EVENT,
        day: Number(data["day"]),
        payload: data,
      });
    } catch (err) {
      this.emit("counterpart.associate.flush.unrecorded", undefined, { code: errCode(err) });
    }
    return out;
  }

  /**
   * The same as `resolveUse`, for the whole set a reply used — and then the
   * Hebbian half: what fired together in one reply is buffered as
   * co-activation, flushed at the boundary. `associate/` refuses a set of
   * fewer than two on its own terms.
   */
  resolveUses(
    sessionId: string,
    uses: readonly { memoryId: string; tier: UseTier }[],
  ): CreditResult[] {
    const results: CreditResult[] = [];
    const credited: Credited[] = [];
    for (const use of uses) {
      const result = this.resolveUse(sessionId, use.memoryId, use.tier);
      results.push(result);
      // The same rule as `creditReferences` (2026-09-28): links do not inherit
      // the once-a-day credit cadence.
      if (result.credited || linksDespite(result)) credited.push({ id: use.memoryId, tier: use.tier });
    }
    this.associate.coactivate(credited);
    return results;
  }

  // ── the authored front door ────────────────────────────────────────────────

  /** The experiencer's end-of-session dump. Channel: `authored` (SEAMS N). */
  async submitSessionEnd(draft: unknown, ctx: SessionEndDepositContext): Promise<DepositResult> {
    // A WRITE-UP LANDED — this door is the one both the Stop ask's answer and
    // the next-session write-up take — so the wake is behind it (2026-09-30,
    // `self/behind.ts`). The host re-fires Stop after the answer, and that
    // Stop's worker catches the wake up. The mark is set in `deposit` since
    // 2026-10-10, for every door; this one names it `write-up`.
    return this.deposit(draft, "session-end", ctx);
  }

  /**
   * Feelings on a memory (schema v7, `store/feelings.ts`), through the SECRETS
   * half of the battery: `carried_by` and an `other` word are words about the
   * moment, and a credential must not land in them any more than in a body.
   * Once stored they weigh (emotion part A): physics reads the strongest one
   * beside the row (§5.10) and recall reads recent ones as the mood (G18).
   * Throws what the store throws (`FEELING_INVALID`).
   */
  addFeelings(memoryId: string, inputs: readonly FeelingInput[], opts: { model?: string } = {}): AddFeelingsResult {
    // The emotion too (2026-09-28): an emotion that carries a phrase is split
    // and its tail lands in `carried_by`, so it crosses the same scan.
    const clean = inputs.map((f) => ({
      ...f,
      ...(typeof f.emotion === "string" ? { emotion: redactSecrets(f.emotion) } : {}),
      ...(typeof f.carriedBy === "string" ? { carriedBy: redactSecrets(f.carriedBy) } : {}),
      ...(typeof f.otherWord === "string" ? { otherWord: redactSecrets(f.otherWord) } : {}),
    }));
    return this.store.addFeelings(memoryId, clean, opts);
  }

  /**
   * Trait nudges on a memory (folded into v9, `store/traits.ts`), through the
   * same SECRETS half of the battery: `carried_by` is words about the moment.
   * Display only — nothing in the core reads them. Throws what the store
   * throws (`TRAIT_INVALID`).
   */
  addTraits(memoryId: string, inputs: readonly TraitInput[], opts: { model?: string } = {}): { ids: readonly string[]; repairs: readonly { index: number; note: string }[] } {
    const clean = inputs.map((t) => ({
      ...t,
      ...(typeof t.carriedBy === "string" ? { carriedBy: redactSecrets(t.carriedBy) } : {}),
    }));
    return this.store.addTraits(memoryId, clean, opts);
  }

  /**
   * SETTLE A CONTRADICTION (2026-09-29, `reconsolidation.ts`) — an existing
   * pair, or two memories by `holds` and `over` — with the `why` through the
   * SECRETS half of the battery: a reason is words, and a credential must not
   * land in the trail any more than in a body.
   */
  settleContradiction(input: SettleInput): SettleOutcome {
    return settleContradiction(
      this.store,
      {
        ...input,
        ...(typeof input.why === "string" ? { why: redactSecrets(input.why) } : {}),
      },
      { retarget: this.retargetLinks },
    );
  }

  /** Undo a settle (`reconsolidation.ts#undo`), the reason through the same scan. */
  undoContradiction(input: Parameters<typeof undoContradiction>[1]): UndoOutcome {
    return undoContradiction(
      this.store,
      {
        ...input,
        ...(typeof input.why === "string" ? { why: redactSecrets(input.why) } : {}),
      },
      { retarget: this.retargetLinks },
    );
  }

  /** SEAMS E for the one door (2026-10-11): a memory that leaves recall hands its links to the one that holds. */
  private readonly retargetLinks = (oldId: string, newId: string, day: number): void => {
    this.associate.retargetOnSupersede(oldId, newId, day);
  };

  /**
   * The nearest few live memories of one just written (`reconsolidation.ts
   * #writeNeighbours`), for the write's result — minus the memory it updates.
   */
  writeNeighbours(id: string, opts: { exclude?: readonly string[]; owner: boolean; session?: string | null }): Neighbour[] {
    try {
      return writeNeighbours(this.store, {
        id,
        owner: opts.owner,
        ...(opts.exclude === undefined ? {} : { exclude: opts.exclude }),
        ...(opts.session === undefined ? {} : { session: opts.session }),
      });
    } catch {
      // A neighbour search that fails costs the list, never the write.
      return [];
    }
  }

  /** An in-the-moment deliberate deposit. Channel: `authored`. Always covers
   *  its own session's words: `cover` is not taken here, and is dropped if a
   *  caller outside TypeScript sends it. */
  async submitJot(draft: unknown, ctx: DepositContext): Promise<DepositResult> {
    return this.deposit(draft, "jot", {
      session: ctx.session,
      scope: ctx.scope,
      ...(ctx.ownSpanHash === undefined ? {} : { ownSpanHash: ctx.ownSpanHash }),
      ...(ctx.model === undefined ? {} : { model: ctx.model }),
      ...(ctx.owner === undefined ? {} : { owner: ctx.owner }),
      ...(ctx.facts === undefined ? {} : { facts: ctx.facts }),
      ...(ctx.about === undefined ? {} : { about: ctx.about }),
    });
  }

  // ── episodes ───────────────────────────────────────────────────────────────

  /**
   * ONE ask, and the advance is committed before it blocks (§13 G3–G4).
   * `scope` hands the pacer this session's unwritten stretch there
   * (`coverage/`, 2026-09-30); without it, turns and bytes decide alone.
   */
  episodeAsk(
    sessionId: string,
    substance: { turns: number; bytes: number },
    day?: number,
    opts: { rebase?: boolean; scope?: string } = {},
  ): ChapterAsk {
    const { scope, ...pace } = opts;
    let stretch: ReturnType<typeof sessionStretch> = null;
    if (scope !== undefined && scope.length > 0 && sessionId.length > 0) {
      try {
        stretch = sessionStretch(this.spans, sessionId, [scope]);
      } catch {
        stretch = null;
      }
    }
    const now = this.nowFn();
    return this.self.openChapter(sessionId, substance, day, {
      ...pace,
      ...(stretch === null
        ? {}
        : {
            unwritten: {
              pieces: stretch.pieces,
              minutes: stretch.minutes,
              due: (lastAskAt: number | null) => askFromStretch(stretch, lastAskAt, now),
            },
          }),
    });
  }

  /**
   * Append a chapter to the day's journal — THROUGH THE BATTERY.
   *
   * FOUND BY THE CALLER-UNIVERSALITY TEST (SEAMS queued item 12, scar §2.7): the
   * episode's own prose is a durable ingestion entrance, and `self/` gates only
   * `ingestEpisode`, not `appendChapter`. So a credential written into a chapter
   * landed in canonical prose and stayed there even though the memory minted
   * from it was redacted — "a gate covers every ingestion path AND every side
   * channel", with the journal as the side channel. The gate is the same one
   * SEAMS H wired; wiring it at this entrance too is composition, not a new
   * rule. Filed in `INTERFACE-GAPS.md` §3: `self/` should take the gate the way
   * `ingestEpisode` does, so this cannot be forgotten by the next caller.
   */
  appendEpisode(
    sessionId: string,
    text: string,
    /** `model`: the model writing this chapter, when the host knows it.
     *  `scope`: the project it was written in — the one whose unwritten pieces
     *  it writes up (`coverage/`); without it, a chapter claims nothing.
     *  `about`: what the session was about, carried to the chapter's memory
     *  copy (2026-10-01, `self/index.ts#appendChapter`). */
    opts: { day?: number; title?: string; happenedOn?: string; model?: string; scope?: string; about?: AboutMark } = {},
  ): ChapterResult {
    const verdict = episodeGate()({ text, handles: [], sessionId });
    if (!verdict.ok) {
      this.emit("counterpart.episode.chapter.refused", sessionId, {
        gate: verdict.gate,
        reason: verdict.reason,
      });
      return {
        appended: false,
        reason: "gate-refused",
        gate: { gate: verdict.gate, reason: verdict.reason },
        episodeId: null,
        chapter: 0,
        created: false,
      };
    }
    // The GATE's text, never the draft — the same rule ingestion follows.
    const body = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : text;
    const { scope } = opts;
    const written = this.self.appendChapter(sessionId, body, opts);
    // A CHAPTER WRITES THE SESSION'S STRETCH UP (2026-09-30): a claim naming
    // the episode and the chapter, with no proposal behind it, in the one file
    // the coverage ledger reads — in the project it was written in only.
    if (written.reason === "appended" && written.episodeId !== null && !this.observer && scope !== undefined && scope.length > 0) {
      claimUnwritten(this.spans, {
        session: sessionId,
        scope,
        by: CLAIM_CHAPTER,
        ref: `${written.episodeId}#${String(written.chapter)}`,
      });
    }
    // AND IT PUTS THE WAKE BEHIND: the "Last here" line it makes needs its
    // room reserved, and a bundle composed before it may have none — so the
    // turn-end worker re-renders (`refreshWake`), as it does for a write-up
    // (review of #300 MAJOR-2).
    if (written.reason === "appended" && !this.observer) markWakeBehind(this.store, "write-up");
    return {
      appended: written.reason === "appended",
      reason: written.reason,
      gate: null,
      episodeId: written.episodeId,
      chapter: written.chapter,
      created: written.created,
    };
  }

  /** Through the REAL battery: a first-person reflection is not exempt (SEAMS H). */
  ingestEpisode(input: { sessionId: string; day?: number; handles?: readonly string[] }): IngestResult {
    return this.self.ingestEpisode(input);
  }

  /**
   * How an archived row LEFT — replaced by a newer reading, let go, or removed
   * (`leaving.ts`, the one table the `status` census and the dashboard read).
   * A door on the composition root, so an adapter asks it through the object it
   * already holds.
   */
  leftAs(reason: string | null, superseded = false): LeftAs | null {
    return leftAs(reason, superseded);
  }

  /** The owner's name as written on the identity core (not lower-cased), or null. */
  ownerDisplayName(): string | null {
    for (const id of this.store.list({ type: "schema", kind: "self", archived: false })) {
      try {
        const meta = this.store.readProse(id).meta;
        if (meta["role"] === "entity" && typeof meta["name"] === "string" && meta["name"].trim().length > 0) {
          return meta["name"].trim();
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  // ── the core: what it holds, and the owner's door out of it ────────────────

  /**
   * THE CORE, as the owner reads it (2026-09-26): every identity-band memory,
   * with the lane that carried it there (when a promotion recorded one) and
   * whether it is on the page's row; plus the recent nominations dreams made.
   * A read.
   */
  coreList(): {
    core: { id: string; kind: string; lane: string | null; day: number | null; body: string | null; confidential: boolean }[];
    nominated: { id: string; day: number; reason: string | null; dream: string | null }[];
    demoted: { id: string; day: number; reason: string | null }[];
    /** Core memories being reconsidered (2026-10-11): still core, waiting on a decision. `reason` is the category. */
    reconsidering: { id: string; day: number; reason: string | null }[];
  } {
    const core: ReturnType<Counterpart["coreList"]>["core"] = [];
    for (const id of this.store.list({ archived: false })) {
      const row = this.store.row(id);
      if (row === undefined || row.promoted_identity !== 1) continue;
      const promoted = this.store.coreEvents({ memoryId: id, action: "promoted", limit: 1 })[0];
      let body: string | null = null;
      try {
        const doc = this.store.readProse(id);
        body = row.confidential === 1 && !this.owner ? null : (doc.title ?? doc.body).split("\n")[0] ?? "";
      } catch {
        body = null;
      }
      core.push({
        id,
        kind: row.kind,
        lane: promoted?.lane ?? null,
        day: promoted?.day ?? null,
        body,
        confidential: row.confidential === 1,
      });
    }
    const nominated = this.store
      .coreEvents({ action: "nominated" })
      .map((e) => ({ id: e.memory_id, day: e.day, reason: e.reason, dream: e.dream_id }));
    const demoted = this.store
      .coreEvents({ action: "demoted" })
      .map((e) => ({ id: e.memory_id, day: e.day, reason: e.reason }));
    const reconsidering = this.store.coreReconsidering().map((r) => ({ id: r.id, day: r.day, reason: r.reason }));
    return { core, nominated, demoted, reconsidering };
  }

  /**
   * THE DEMOTE DOOR (owner decision 2026-09-26): send a core memory back to
   * ordinary fading, and record why — `sleep/core-standing.ts#retireCore`,
   * which a reflection's `core` part calls too. The owner's by default; since
   * 2026-10-11 (Group 3 part A, item 14) also mine awake (`actor: "self"`):
   * either of us may retire a core memory, flagged or not.
   */
  demoteCore(id: string, opts: { reason: string; actor?: CoreDecisionActor }): { ok: boolean; reason: string } {
    const out = retireCore(this.store, { id, reason: opts.reason, actor: opts.actor ?? "owner" });
    if (out.ok) this.emit("counterpart.core.demoted", id, { day: this.store.livedDay() });
    return out;
  }

  /**
   * THE KEEP DOOR (2026-10-11, Group 3 part A): decide that a core memory
   * stays — the answer to "being reconsidered", the owner's or mine awake.
   * `sleep/core-standing.ts#keepCore`: a `reaffirmed` row with the why; a flag
   * is lifted and not raised again for what the memory is.
   */
  keepCore(id: string, opts: { why: string; actor?: CoreDecisionActor }): CoreDecision {
    const out = keepCore(this.store, { id, why: opts.why, actor: opts.actor ?? "owner" });
    if (out.ok) this.emit("counterpart.core.kept", id, { day: this.store.livedDay() });
    return out;
  }

  /**
   * THE ABOUT DOOR (2026-10-11, the about-marks lane): change what a memory
   * is about. One path for the owner's door (`counterparts about`, which the
   * dashboard runs) and the session's (`remember`'s `remark`), through
   * `store.setAbout` — so the record is the one a reflection's re-mark writes:
   * the column, who set it, and a `core_events` row with the mark it replaced
   * and the why. An archived memory may be marked (the mark counts if it
   * comes back); an earlier version forwards to the current one. By `self`,
   * a dream's or a reflection's words move only toward work or world, as the
   * reflection's do, and a confidential memory outside the owner's session is
   * not found. Refusals come back as reasons, never thrown.
   *
   * `night` (2026-10-11): the call comes from a night run's child (a dream or
   * a reflection whose user allowed `remember`). The owner's `--reflected-feeling
   * off` closes the core to the night's own judgment, and the reflection's
   * re-marks already honour it (`dream/reflect.ts`, `door-closed-work-or-world-only`);
   * a night child's `remark` is the same judgment by another door, so it is
   * held to the same rule: only work or world. An AWAKE session's re-mark is
   * not the reflection's, and the switch does not reach it.
   */
  markAbout(input: { id: string; mark: string; by: "owner" | "self"; why?: string | null; owner?: boolean; night?: boolean }): MarkAboutOutcome {
    if (this.observer) return { ok: false, reason: "observer", detail: "This is an observer; it reads and changes nothing." };
    const mark = input.mark.trim();
    if (!(ABOUT_MARKS as readonly string[]).includes(mark)) {
      return { ok: false, reason: "about-is-me-us-owner-work-or-world", detail: `"${mark}" is not a mark: use one of ${ABOUT_MARKS.join(", ")}.` };
    }
    const asked = input.id.trim();
    const missing: MarkAboutOutcome = { ok: false, reason: "unknown-id", detail: `No memory ${asked} in this store.` };
    let id: string;
    try {
      id = this.store.resolve(asked);
    } catch {
      return missing;
    }
    const row = this.store.row(id);
    if (row === undefined || rowTombstoned(row)) return missing;
    if (row.type !== "memory") return { ok: false, reason: "not-a-memory", detail: `${asked} is a ${row.type}, not a memory; only a memory is marked.` };
    const core = (CORE_ABOUT_MARKS as readonly string[]).includes(mark);
    if (input.by === "self") {
      if (row.confidential === 1 && input.owner !== true) return missing;
      if (core && (row.source === "dreamed" || row.source === "reflection")) {
        return {
          ok: false,
          reason: row.source === "dreamed" ? "dreamed-is-a-suggestion" : "reflection-does-not-mark-itself",
          detail: `${id} was written by a ${row.source === "dreamed" ? "dream" : "reflection"}; only work or world may be set on it (the owner can mark it anything).`,
        };
      }
      if (core && input.night === true && !acceptsReflectedFeeling(this.store)) {
        return {
          ok: false,
          reason: "door-closed-work-or-world-only",
          detail: "The owner has closed the core to the night's own judgment: from a night run, a mark may only move toward work or world.",
        };
      }
    }
    const notes: string[] = [];
    // Through the SECRETS half of the battery, as a settle's why and the
    // reflection's: a reason is words, and a credential must not land in the
    // trail any more than in a body.
    const why = redactSecrets((input.why ?? "").trim());
    if (input.by === "self" && why.length === 0) notes.push("No why was given; the mark records that. Say why next time.");
    if (row.kind === "skill" && core) notes.push("A skill memory is the craft and never becomes core, whatever its mark.");
    if (row.archived === 1) notes.push("It is archived: the mark is kept, and counts if it comes back.");
    const set = this.store.setAbout(id, mark as AboutMark, {
      by: input.by,
      why: why.length > 0 ? why : input.by === "self" ? "no why given" : null,
    });
    return {
      ok: true,
      id,
      ...(id !== asked ? { forwardedFrom: asked } : {}),
      mark: mark as AboutMark,
      before: set.before,
      changed: set.changed,
      archived: row.archived === 1,
      why: why.length > 0 ? why : null,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
  }

  // ── the self page ──────────────────────────────────────────────────────────

  /** The written page, or null while none has been written. A pure read. */
  selfPage(): SelfPage | null {
    return this.self.page();
  }

  /** Every earlier state of the page, newest first. A pure read. `bodies: false`
   *  skips the per-version file read, for a caller that wants the shape only. */
  selfPageVersions(opts: { bodies?: boolean } = {}): PageVersion[] {
    return this.self.pageVersions(opts);
  }

  /** How many earlier states, without reading one of them off disk. */
  selfPageVersionCount(): number {
    return this.self.pageVersionCount();
  }

  /** Put an earlier version back — an ordinary revision, so itself versioned. */
  restorePage(seq: number, opts: { reason?: string; day?: number } = {}): PageRevision {
    return this.self.restorePage(seq, opts);
  }

  /**
   * Unwrite the page — the OWNER's door, and deliberately not reachable from any
   * MCP tool. A session that could unwrite the page could erase the self between
   * two turns.
   */
  clearPage(opts: { reason: string; day?: number }): PageRevision {
    return this.self.clearPage(opts);
  }

  /**
   * THE ONE DOOR TO THE PAGE — the MCP tool, the owner's console and the nightly
   * writer (S2) all arrive here, and they arrive THROUGH THE BATTERY.
   *
   * The gate is the journal's, and the reason is the journal's (SEAMS H, found
   * by the caller-universality test): the page is canonical prose that is
   * injected into every session from here on, so a credential written into it
   * would be the most durable place on the machine to leave one. It is applied
   * inside `self/`, on the gate this root injected, so there is ONE refusal path
   * and one durable row — and `self/`'s refusing default (`NO_GATE`) stays the
   * behaviour of a page door nobody wired a battery into.
   */
  revisePage(body: string, opts: PageWriteOptions): PageRevision {
    return this.self.revisePage(body, opts);
  }

  /** Add a short version to the page as it stands (2026-10-10) — the same seam, the same battery. */
  addPageShort(short: string, opts: Omit<PageWriteOptions, "short" | "reason"> & { reason?: string }): PageRevision {
    return this.self.addPageShort(short, opts);
  }

  // ── the nightly page writer (S2) ───────────────────────────────────────────

  /**
   * IS THE PAGE OWED A REVISION for the day just gone? Pure; the caller that
   * acts on it writes the claim. `off` and `observer` are named refusals, not a
   * bare false, so a mechanism that is standing down says which kind it is.
   */
  pageWriterDue(opts: { mode: PageWriterMode; today?: string }): PageWriterDue {
    return this.self.pageWriterDue(opts);
  }

  /**
   * WHAT THE NIGHTLY WRITER IS HANDED — the page as it stands and the day just
   * gone, bounded and ordered by salience.
   *
   * **CONFIDENTIAL ROWS DO NOT GO**, in either mode, and what was held back is
   * counted onto the run's row. It is the same rule the crash fallback's wake
   * follows (`sweepWake`) for the same reason: this material is put in front of
   * a model call, and a row the owner marked confidential is not material for
   * one. PROTECTED rows are not held back here, and that is the one deliberate
   * difference: `sweepWake` hides them because its reader is about to propose
   * new memories from a transcript and must not restate permanent ink as
   * discovery, while this reader's whole job is to write about the self. The
   * page itself is governed by `PAGE_ON_EGRESS` where it goes out at all; in
   * session mode it is already in the session's own wake.
   *
   * Pass `omit` to widen the filter; the default is confidential-only.
   */
  pageWriterInput(opts: {
    about: string;
    today?: string;
    day?: number;
    budgetBytes?: number;
    /** Most memories carried (the tunable's when absent). */
    max?: number;
    omit?: (m: { id: string; confidential: boolean; protectedRow: boolean }) => boolean;
  }): WriterInput {
    return this.self.pageWriterInput({
      ...opts,
      omit: opts.omit ?? ((m): boolean => m.confidential),
    });
  }

  /** The run's durable row — the only thing S2 writes that is not the page. */
  recordPageWriterRun(run: {
    about: string;
    mode: PageWriterMode;
    outcome: PageWriterOutcome;
    detail?: string;
    bytesBefore?: number;
    bytesAfter?: number;
    considered?: number;
    omitted?: number;
    day?: number;
    dedupKey?: string;
  }): boolean {
    return this.self.recordPageWriterRun(run);
  }

  /** How a date came out, with the derivation named. Pure. */
  pageWriterStatus(about: string, today?: string): PageWriterStatus {
    return this.self.pageWriterStatus(about, today);
  }

  /** Every recorded attempt, newest first. Pure. */
  pageWriterRuns(opts: { about?: string; limit?: number } = {}): PageWriterRun[] {
    return this.self.pageWriterRuns(opts);
  }

  /** Is that night's claim still open? What the page's door asks before it
   *  writes `by: "writer"` rather than `by: "session"`. Pure. */
  pageWriterClaimOpen(about: string, today?: string): boolean {
    return this.self.pageWriterClaimOpen(about, today);
  }

  // ── the nightly run's writer (2026-09-28) ──────────────────────────────────

  /** The nightly run's open writer claim for this session, or null. What the
   *  page's door reads to label a write `writer`. Pure. */
  nightClaimFor(session: string): PageWriterRun | null {
    return this.self.nightClaimFor(session);
  }

  /**
   * CLAIM THE NIGHT FOR THE NIGHTLY RUN'S WRITER — called by the run's writer
   * phase (the MCP server's `dream writer`), the run's first part. The writer
   * moved out of the wake into the run: writer, then dream, then reflection,
   * one background agent (the owner's order, 2026-09-28). The claim is the
   * ordinary `asked` row for the night (`about` = yesterday's local calendar
   * date, `pageWriterNight`), carrying the SESSION and the run — which is what
   * lets the page's door record the writer's `self_page` write `by: "writer"`
   * (`nightClaimFor`). A claim this session already holds is reused (a run
   * started again claims nothing twice).
   *
   * Only in `session` mode, the default: `off` writes nothing. Never throws.
   */
  claimNightWriter(input: { session: string; run: string }): { claimed: boolean; about: string; reason: string } {
    try {
      if (this.observer) return { claimed: false, about: "", reason: "observer" };
      const mode = this.pageWriterModeOpt;
      if (mode !== "session") return { claimed: false, about: "", reason: "off" };
      const open = this.self.nightClaimFor(input.session);
      if (open !== null) return { claimed: true, about: open.about, reason: "claimed-earlier" };
      const due = this.self.pageWriterDue({ mode: "session" });
      if (!due.due) {
        // A NIGHT THE WRITER LOOKED AT AND HAD NOTHING TO READ is written down
        // (review of #271): a `skipped` row, which never closes a night, so
        // doctor does not read a store used every other day as a writer that
        // stopped. One per night and reason.
        if (due.reason === "no-memories" || due.reason === "asks-spent") {
          this.self.recordPageWriterRun({
            about: due.about,
            mode: "session",
            outcome: "skipped",
            detail: due.reason,
            session: input.session,
            run: input.run,
            dedupKey: `self.page.writer.ran:night:${due.about}:${due.reason}`,
          });
        }
        return { claimed: false, about: due.about, reason: due.reason };
      }
      const built = this.nightWriterFitted({ about: due.about, session: input.session, tool: NIGHT_WRITER_TOOL }).built;
      const ok = this.self.recordPageWriterRun({
        about: due.about,
        mode: "session",
        outcome: "asked",
        detail: `nightly run ${input.run}, attempt ${String(due.attempt)}`,
        bytesBefore: built.page?.bytes ?? 0,
        considered: built.memories.length,
        omitted: built.omitted,
        session: input.session,
        run: input.run,
      });
      return { claimed: ok, about: due.about, reason: ok ? "claimed" : "unrecorded" };
    } catch (err) {
      return { claimed: false, about: "", reason: err instanceof Error ? err.name : "UNKNOWN" };
    }
  }

  /**
   * THE RUN MOVED PAST THE WRITER WITHOUT A WRITE (review of #271): this
   * session's open claim is closed as `nothing-to-say` — or as `failed` when
   * the session's write was refused and not sent again (review of #358) — so
   * the night is answered and a later `self_page` write by the session is an
   * ordinary amendment, not the writer's. Called at the phase after the writer (the
   * dream's `begin`, the reflection's `begin`). Nothing when there is no open
   * claim — the writer wrote, or never claimed. Never throws.
   */
  closeNightWriter(input: { session: string; phase: string }): boolean {
    try {
      if (this.observer) return false;
      const open = this.self.nightClaimFor(input.session);
      if (open === null) return false;
      const page = this.self.page();
      // A REFUSED WRITE IS NOT "NOTHING TO SAY" (review of #358). A refusal
      // keeps the claim open so the same run can send the page again; a run
      // that moved on instead had something to say and did not get it
      // written, so the night closes as `failed`, carrying the refusal — for a
      // page refused for length, its bytes and how far over the limit it was.
      // Closed as `nothing-to-say`, it read as a quiet night and doctor went
      // green over a page that was never written.
      const refused = this.self
        .pageWriterRuns({ about: open.about })
        .find((r) => r.outcome === "refused" && (r.at > open.at || (r.at === open.at && r.seq > open.seq)));
      return this.self.recordPageWriterRun({
        about: open.about,
        mode: open.mode,
        outcome: refused === undefined ? "nothing-to-say" : "failed",
        detail:
          refused === undefined
            ? `the run moved on to ${input.phase} without writing`
            : `${refused.detail === "" ? "refused" : refused.detail}; not sent again before the run moved on to ${input.phase}`,
        bytesBefore: open.bytesBefore,
        bytesAfter: page === null ? 0 : byteLength(page.body),
        considered: open.considered,
        omitted: open.omitted,
        session: input.session,
        run: open.run,
      });
    } catch {
      return false;
    }
  }

  /**
   * WHAT THE NIGHTLY RUN'S WRITER IS HANDED, through a tool result (the dream
   * tool's `writer` phase) rather than the wake: the instruction, the page
   * WHOLE (the background agent never got the wake), and the day — no
   * injection ceiling, so no `no-room`. Null reason when this session holds no
   * open claim. Pure: it reads and composes.
   */
  nightWriter(input: { session: string; tool: string }):
    | { ok: true; about: string; text: string; considered: number; dropped: number; omitted: number; version: number | null }
    | { ok: false; reason: string } {
    const claim = this.self.nightClaimFor(input.session);
    if (claim === null) return { ok: false, reason: "no-claim" };
    const { built, text } = this.nightWriterFitted({ about: claim.about, session: input.session, tool: input.tool });
    return {
      ok: true,
      about: claim.about,
      text,
      considered: built.memories.length,
      dropped: built.dropped,
      omitted: built.omitted,
      version: built.page?.version ?? null,
    };
  }

  /**
   * The night's day for the writer, fitted to one tool result
   * (`self/writer.ts#fitNightWriter`, 2026-10-02) — the claim and the block
   * count the same memories. Pure: it reads and composes.
   */
  private nightWriterFitted(input: { about: string; session: string; tool: string }): {
    built: ReturnType<Counterpart["pageWriterInput"]>;
    text: string;
  } {
    return fitNightWriter(
      (budgetBytes) => this.pageWriterInput({ about: input.about, budgetBytes, max: NIGHT_WRITER_MEMORY_MAX }),
      (built) => writerInstruction(built, { tool: input.tool, session: input.session, pageInline: true }),
    );
  }

  /** The unaskable tail — bounded and measured, never pretended away (§2 G12). */
  noteOrphanTail(
    sessionId: string,
    substance: { turns: number; bytes: number },
    day?: number,
    opts: { rebase?: boolean } = {},
  ): void {
    this.self.noteOrphanTail(sessionId, substance, day, opts);
  }

  /**
   * THE NARROW DURABLE SEAM FOR AN ADAPTER (SEAMS K's log).
   *
   * An adapter's own telemetry lives in an in-process ring that dies with the
   * hook process, which is fine for everything the adapter can re-derive — and
   * useless for a claim about a RUN. "v2 stood down 14 times today" has to be
   * countable out of the store after the fact, or it is a hope. So exactly the
   * two names above may cross into box 2, addressed by name and carrying their
   * own calendar date in the payload.
   *
   * Most of these ACCUMULATE (a day has many hooks) and pass no `dedupKey`. The
   * exception, added 2026-09-11 with the spawn-seam records (I32): a caller may
   * supply one, and then the row lands AT MOST ONCE for that key — the store's
   * `INSERT OR IGNORE` latch. A refusal that repeats at every boundary needs
   * exactly one row per reason per date; the count belongs in the adapter's
   * persisted counter, not in three hundred identical rows.
   *
   * **A deduped write is a SUCCESS.** `appendEvent` returns 0 when the latch
   * refused, and "the row is already durable" is the outcome the caller asked
   * for — reporting it as a failure would make an adapter retry something that
   * cannot be retried, or emit a failure line for a healthy path.
   *
   * Returns whether the fact is durable, and never throws — an observer refuses
   * at the store's own seam, and a stand-down that threw would cost the boundary
   * that follows it.
   */
  /**
   * `data` is ids, counts, bytes, reasons, flags — and, since `recall.credit`,
   * nested lists and maps of those. NEVER body text (store §5 G10). The type
   * was a flat record until 2026-09-14 and that flatness was part of how G10
   * was mechanized; it is now an instruction at this seam, so a caller adding a
   * field here owes the same check the flat type used to make for free.
   */
  noteAdapterEvent(
    name: AdapterDurableEventName,
    data: Record<string, unknown>,
    opts: { dedupKey?: string } = {},
  ): boolean {
    if (this.observer) {
      this.emit("counterpart.adapter.standdown", undefined, { name });
      return false;
    }
    try {
      const seq = this.store.appendEvent({
        name,
        day: this.store.livedDay(),
        payload: data,
        ...(opts.dedupKey === undefined ? {} : { dedupKey: opts.dedupKey }),
      });
      // 0 with a latch means "already there", which is durable; 0 without one
      // would be a store that wrote nothing, and there is no such path.
      return seq > 0 || opts.dedupKey !== undefined;
    } catch (err) {
      this.emit("counterpart.adapter.event.failed", undefined, { name, code: errCode(err) });
      return false;
    }
  }

  // ── boundaries ─────────────────────────────────────────────────────────────

  /**
   * Every session-ending path is a boundary (§2 G5, adapter CONTRACT §3): normal
   * stop, session end, and pre-compaction all land here, and all three raise the
   * ask. Compaction destroying the transcript must not destroy the day.
   *
   * An appender, not a thinker: no model call, no cycle, no throw.
   */
  boundary(input: { session: string; scope: string; kind: BoundaryKind }): BoundaryRecord {
    return this.spans.boundary(input);
  }

  /**
   * The heavy half, run detached by whoever owns detachment: sweep, then sleep.
   *
   * Order is behaviour. The crash fallback runs FIRST, so anything it recovers is
   * inside the boundary that decays it, consolidates it and re-renders the
   * briefing around it. Then the Hebbian buffer flushes — which on a host that
   * runs this detached finds an empty buffer, because the credit pass ran in a
   * different process; that call is the flush for a caller living in ONE
   * process, such as the demo seeder or the replay driver, and the sweep's own
   * credit if it ever gains one. THEN the carried co-activation the hooks left
   * on disk (`applyPendingAssociations`), which is where the host's own learned
   * association is actually written: the hook appends, this process applies, and
   * a claim it cannot apply waits for the next boundary. Then the cycle, whose LAST
   * content write is `self.boundary()` through `briefing.selfRenderer` (SEAMS G),
   * carrying the ceiling the HOST reported and refusing to invent one — minus
   * the room the wake's delivery preface will take at injection. That
   * subtraction is HERE and nowhere else: the preface is composed at wake
   * (`self/briefing.ts`), so this root is the one place that knows both numbers,
   * and reserving is the difference between a wake that fits the host's cliff
   * and one that blows it by its own first line every day.
   */
  sessionEnd(input?: SessionEndInput): Promise<SessionEndReport> {
    return boundaryPart.sessionEnd(this, input);
  }

  /**
   * TEMPORAL CONTIGUITY — the boundary's half (association build 2,
   * 2026-09-28). Reads the memories written since the last pass
   * (`CONTIGUITY_CURSOR_META`), and for each session that has one, that
   * session's memories in write order; `associate/contiguity.ts` plans the
   * adjacent pairs that touch a new memory, and `Associate.contiguity` buffers
   * them for this boundary's flush.
   *
   * THE CURSOR MOVES FIRST, before anything is buffered: a flush that then
   * fails drops this pass's deltas (bounded loss), and a crash after the flush
   * cannot re-plan pairs that already landed — at most once, the direction
   * `associate/CONTRACT.md` §5 G4 chooses. A cursor that cannot be written
   * means nothing is buffered; the memories wait for the next boundary.
   *
   * Fail-open, like every other step of the boundary: a pass that throws is a
   * `failed` report and the boundary goes on. An observer does nothing.
   *
   * This public door buffers and returns; the boundary itself goes through
   * `bufferContiguity` so it can keep the planned pairs and say, after its
   * flush, which of them landed (`contiguityOutcome`).
   */
  contiguityPass(): ContiguityPass {
    return boundaryPart.contiguityPass(this);
  }

  private bufferContiguity(): { pass: ContiguityPass; pairs: readonly PairDelta[] } {
    return boundaryPart.bufferContiguity(this);
  }

  private linkAtWrite(
    fresh: readonly { id: string; session: string; at: number; bornDay: number }[],
    day: number,
  ): AtWritePass | null {
    return boundaryPart.linkAtWrite(this, fresh, day);
  }

  private jotsAmong(fresh: readonly { id: string; bornDay: number }[]): Set<string> {
    return boundaryPart.jotsAmong(this, fresh);
  }

  private contiguityOutcome(
    planned: { pass: ContiguityPass; pairs: readonly PairDelta[] },
    edges: FlushReport,
  ): ContiguityPass {
    return boundaryPart.contiguityOutcome(this, planned, edges);
  }

  private recordBoundaryFlush(edges: FlushReport, contiguity: ContiguityPass, session?: string): boolean {
    return boundaryPart.recordBoundaryFlush(this, edges, contiguity, session);
  }

  private clearContiguityPending(): void {
    return boundaryPart.clearContiguityPending(this);
  }

  /**
   * RE-RENDER THE WAKE NOW — the owner's lever, and nothing else.
   *
   * The briefing is re-rendered at the day's first boundary and again only when
   * a page write or a write-up puts it behind (`refreshWake`), so a change to
   * the lane rules merged mid-day is invisible until one of those, and an owner
   * who wants their wake regenerated would have to wait (measured 2026-09-04,
   * the day the identity share shipped). This is the same render the sleep step
   * runs — `briefing.selfRenderer`, SEAMS G, one renderer and not a second — and
   * it reserves the delivery preface's room exactly as `sessionEnd` does,
   * because a rebrief that spent the whole ceiling would blow it by its own
   * first line at the next wake.
   *
   * What it deliberately does NOT do: advance the clock, advance any sleep
   * marker, or run any other sleep phase. Decay, consolidation, dedup and prune
   * are the boundary's work and stay the boundary's; this republishes the
   * bundle over the store as it is. A marker moved here would silently cost the
   * next boundary its own re-render (scar E8: a marker is a completion record).
   * It does catch the wake up to a pending mark (`refreshWake`), since it
   * renders the store as it is.
   */
  rebrief(input?: { budgetBytes?: number; at?: string }): RebriefReport {
    return boundaryPart.rebrief(this, input);
  }

  /**
   * CATCH THE WAKE UP (2026-09-30) — re-render and republish when the wake is
   * behind (`self/behind.ts`: the page was written, a write-up landed), or
   * when the caller names a trigger of its own (the nightly run's end, which
   * renders whatever its state). Nothing to catch up to: nothing rendered,
   * `current`.
   *
   * The same render as `rebrief` — one renderer, the preface reserved, no
   * marker moved, no other sleep phase — with a budget or not at all: the
   * no-budget refusal stands. Called where a process holding the host's
   * ceiling next runs: the turn-end worker (`runner.ts`, after the cycle) and
   * the nightly process (`night-run.ts`, after the child returns). Not at
   * SessionStart, whose wake ranks nothing and writes nothing (self CONTRACT
   * §5 G1). Its `self.briefing` row says `refresh` and which triggers.
   *
   * AND WHEN ANOTHER BUILD PUBLISHED IT (2026-10-02, `version`): the first
   * turn-end after an install re-renders the wake the old version composed,
   * so a question the new code closes leaves "Still open" for every session
   * after that one, not at the next lived day.
   */
  refreshWake(input?: { budgetBytes?: number; at?: string; trigger?: WakeTrigger }): WakeRefreshReport {
    return boundaryPart.refreshWake(this, input);
  }

  private republish(
    input: { budgetBytes?: number; at?: string },
    why: "rebrief" | "refresh",
    triggers: readonly WakeTrigger[],
  ): RebriefReport {
    return boundaryPart.republish(this, input, why, triggers);
  }

  /**
   * THE CRASH FALLBACK — the only remaining transcript-reading path, and the one
   * that must not lose the day, since it runs precisely when the experiencer
   * never got the pen. The model call is INJECTED: streaming, token headroom,
   * retries and detachment belong to the adapter that owns the host
   * (`remember/INTERFACE-GAPS` §3).
   *
   * By default every scope holding experience is swept, not only the one whose
   * boundary fired — a project never revisited would otherwise keep captured
   * spans forever (§2 G9).
   */
  sweepFallback(entry: SweepEntry): Promise<SweepReport[]> {
    return sweepPart.sweepFallback(this, entry);
  }

  private recordSweepGate(
    reports: readonly SweepReport[],
    date: string | null,
    reason?: "ran" | SweepSkipped["skipped"],
  ): void {
    return sweepPart.recordSweepGate(this, reports, date, reason);
  }

  private takeBriefingEvents(): readonly CounterpartEvent[] {
    return boundaryPart.takeBriefingEvents(this);
  }

  private recordSleepCycle(
    report: CycleReport | null,
    date: string,
    briefing: readonly CounterpartEvent[],
    threwCode: string | null,
    partial?: CyclePartial | null,
  ): void {
    return boundaryPart.recordSleepCycle(this, report, date, briefing, threwCode, partial);
  }

  private recordSelfBriefing(
    briefing: readonly CounterpartEvent[],
    date: string,
    reason?: "rendered" | "rebrief" | "refresh",
    triggers?: readonly WakeTrigger[],
  ): void {
    return boundaryPart.recordSelfBriefing(this, briefing, date, reason, triggers);
  }

  private sweepSlices(): Promise<{ slices: EncodeSchemaSlice[]; elided: number }> {
    return sweepPart.sweepSlices(this);
  }

  private sweepWake(override?: number): SweepWake {
    return sweepPart.sweepWake(this, override);
  }

  private recordSweepWake(wake: SweepWake | null, chunks: number, date: string | null): void {
    return sweepPart.recordSweepWake(this, wake, chunks, date);
  }

  private wrapSweepInterpret(
    interpret: InterpretFn,
    slices: readonly EncodeSchemaSlice[],
    vectorFor: (chunk: SweepChunk) => Promise<number[] | null | undefined>,
    fenceNonce: string,
    wakeText: () => string | null,
  ): InterpretFn {
    return sweepPart.wrapSweepInterpret(this, interpret, slices, vectorFor, fenceNonce, wakeText);
  }

  private sweepCardBlock(
    chunk: SweepChunk,
    chunkKey: string,
    slices: readonly EncodeSchemaSlice[],
    vectorFor: (chunk: SweepChunk) => Promise<number[] | null | undefined>,
    fenceNonce: string,
  ): Promise<string | null> {
    return sweepPart.sweepCardBlock(this, chunk, chunkKey, slices, vectorFor, fenceNonce);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private recordDeposit(
    result: SubmitResult,
    ctx: DepositContext,
    source: ProposalSource,
    mint: { id: string } | null,
  ): void {
    return depositPart.recordDeposit(this, result, ctx, source, mint);
  }

  private deposit(draft: unknown, source: ProposalSource, ctx: SessionEndDepositContext): Promise<DepositResult> {
    return depositPart.deposit(this, draft, source, ctx);
  }

  private proposeSlotFor(
    id: string,
    p: Proposal,
    session: string,
    siblings: readonly string[],
  ): Extract<SlotOutcome, { ok: true }> | null {
    return depositPart.proposeSlotFor(this, id, p, session, siblings);
  }

  private guardUpdate(p: Proposal, ctx: DepositContext): Promise<HeldUpdate | null> {
    return depositPart.guardUpdate(this, p, ctx);
  }

  private closesOrRedates(p: Proposal, target: string, row: MemoryRow, sent: SentFacts | undefined): boolean {
    return depositPart.closesOrRedates(this, p, target, row, sent);
  }

  private recordHold(
    held: HeldUpdate,
    holds: string,
    source: ProposalSource,
    ctx: SessionEndDepositContext,
    day: number,
  ): void {
    return depositPart.recordHold(this, held, holds, source, ctx, day);
  }

  private carryAbout(p: Proposal, sent: string | null | undefined): (NonNullable<Inherited["about"]>) | null {
    return depositPart.carryAbout(this, p, sent);
  }

  private carryFacts(p: Proposal, sent: SentFacts | undefined): DepositFacts | null {
    return depositPart.carryFacts(this, p, sent);
  }

  private closeThread(
    p: Proposal,
    successor: string,
    owner: boolean,
  ): { from: string; closed: boolean; refused?: ThreadRefusal } | null {
    return depositPart.closeThread(this, p, successor, owner);
  }

  private carryReminder(p: Proposal, sentStatus?: MemoryStatus | null): ReminderCarryPlan {
    return depositPart.carryReminder(this, p, sentStatus);
  }

  private reminderHolder(target: string): string | null {
    return depositPart.reminderHolder(this, target);
  }

  private moveReminder(carry: ReminderCarryPlan, successor: string): DepositReminder {
    return depositPart.moveReminder(this, carry, successor);
  }

  private applySweep(
    raw: readonly unknown[],
    chunk: SweepChunk,
    slices?: readonly EncodeSchemaSlice[],
    vectorFor?: (chunk: SweepChunk) => Promise<number[] | null | undefined>,
  ): Promise<void> {
    return sweepPart.applySweep(this, raw, chunk, slices, vectorFor);
  }

  private applyDeclaredRevision(
    proposal: Proposal,
    mint: MintResult,
    door: string,
    session?: string | null,
  ): RevisionApplication | null {
    return sweepPart.applyDeclaredRevision(this, proposal, mint, door, session);
  }

  private resolveUpdatesFor(scope: string, declared: string | null, content: string): Promise<UpdatesResolution> {
    return sweepPart.resolveUpdatesFor(this, scope, declared, content);
  }

  private relay(module: string, event: { at: number; name: string; ref?: string; data?: Record<string, string | number | boolean | null> }): void {
    const out: CounterpartEvent = { at: event.at, name: event.name };
    if (event.ref !== undefined) out.ref = event.ref;
    out.data = { ...(event.data ?? {}), module };
    this.push(out);
  }


  private creditNamedIn(title: string | null, body: string, day: number, memoryId: string, door: string): void {
    return depositPart.creditNamedIn(this, title, body, day, memoryId, door);
  }

  /**
   * THE v12 BACKFILL (2026-10-03): the memories written before subject links
   * existed, linked once to the live cards they name (`via: backfill`), by
   * the rule a write uses (`Schemas#subjectLinksForAll`). Latched by its
   * record in meta (`SUBJECTS_BACKFILL_META`), read first, so every open
   * after the first costs one meta read; idempotent if it is cut short (a
   * link that exists stays as it was found). Writer-only. Fail-open: a store
   * whose backfill fails opens all the same, and tries again next open.
   */
  private backfillSubjects(): void {
    try {
      if (this.store.getMeta(SUBJECTS_BACKFILL_META) !== undefined) return;
      const started = this.nowFn();
      const found = this.schemas.subjectLinksForAll();
      const added = found.links.length === 0 ? 0 : this.store.linkSubjects(found.links, "backfill");
      this.store.setMeta(
        SUBJECTS_BACKFILL_META,
        JSON.stringify({ at: this.nowFn(), ms: this.nowFn() - started, memories: found.memories, links: added, cards: found.cards }),
      );
      this.emit("counterpart.subjects.backfill", undefined, { memories: found.memories, links: added, cards: found.cards });
    } catch (err) {
      this.emit("counterpart.subjects.backfill.failed", undefined, { code: errCode(err) });
    }
  }

  /**
   * THE LINKS REGROWN COPIES WERE LEFT HOLDING, carried once (2026-10-09).
   * Until then a chapter copy archived `episode-regrown` kept every link it
   * had learned, and an archived row conducts nothing: the owner's store held
   * 260 of its 1,200 edge rows on such copies on 10-02. Each copy's links go
   * to its chapter's live copy (`origin_ref`, the chapter's id) by the rule a
   * regrowth now uses at the time — `associate.retargetOnSupersede`: the
   * weight as it stands today, `max`, both ways — so a link that has faded
   * below the floor since carries nothing. Read from the edge table, so the
   * pass is as long as the links are, not as long as the store. Latched like
   * the v12 backfill (its record in meta, read first); idempotent if cut
   * short; writer-only; fail-open, tried again next open.
   *
   * Review of #329: a copy a removal has taken dark carries nothing (its rows
   * wait for the chase, and must not outlive it on the live copy), and the
   * reads are one per kind, not one per row: `origin_ref` has no index, and a
   * `list({ originRef })` per chapter cost 2.3 s of a 2.8 s pass on a
   * 15k-row store (`store.copiesOf` is the one-scan read the wake uses).
   */
  private relinkRegrownCopies(): void {
    try {
      if (this.store.getMeta(REGROWN_RELINK_META) !== undefined) return;
      const started = this.nowFn();
      const day = this.store.livedDay();
      const denied = new Set(this.store.deniedIds());
      const archived = new Set(this.store.list({ type: "memory", archived: true }));
      let removed = 0;
      const stale: { id: string; episode: string | null }[] = [];
      for (const src of new Set(this.store.allEdges().map((e) => e.src))) {
        if (!archived.has(src)) continue;
        const row = this.store.row(src);
        if (row === undefined || row.archived !== 1 || row.archived_reason !== EPISODE_REGROWN_REASON) continue;
        if (denied.has(src)) {
          removed += 1;
          continue;
        }
        stale.push({ id: src, episode: row.origin_ref });
      }
      // Each chapter's live copy. There is one, unless the chapter's copy was
      // itself taken out since; were there two, the latest written.
      const episodes = stale.flatMap((s) => (s.episode === null ? [] : [s.episode]));
      const held = episodes.length === 0 ? new Map<string, { id: string }[]>() : this.store.copiesOf(episodes);
      const liveCopy = new Map<string, string | null>();
      for (const [episode, found] of held) {
        const ids = found.map((f) => f.id).filter((id) => !denied.has(id));
        liveCopy.set(
          episode,
          ids.length === 0 ? null : ids.reduce((a, b) => ((this.store.row(b)?.created_at ?? 0) > (this.store.row(a)?.created_at ?? 0) ? b : a)),
        );
      }
      let copies = 0;
      let edges = 0;
      let noLiveCopy = 0;
      let failed = 0;
      for (const { id: src, episode } of stale) {
        const to = episode === null ? null : (liveCopy.get(episode) ?? null);
        if (to === null) {
          noLiveCopy += 1;
          continue;
        }
        const out = this.associate.retargetOnSupersede(src, to, day);
        // The edge module answers a failed write rather than throwing it.
        if (out.reason === "failed") {
          failed += 1;
          continue;
        }
        copies += 1;
        edges += out.pairs;
      }
      this.emit("counterpart.regrown.relink", undefined, { copies, edges, noLiveCopy, removed, failed, day });
      // A pass a failed write cut short is NOT latched, so the next open tries
      // again (`max` makes the second carry of what did land a no-op).
      if (failed > 0) return;
      this.store.setMeta(
        REGROWN_RELINK_META,
        JSON.stringify({ at: this.nowFn(), ms: this.nowFn() - started, day, copies, edges, noLiveCopy, removed }),
      );
    } catch (err) {
      this.emit("counterpart.regrown.relink.failed", undefined, { code: errCode(err) });
    }
  }

  /**
   * THE LINKS CORRECTED MEMORIES WERE LEFT HOLDING, carried once (2026-10-11,
   * Group 2b). Until the one door, a `corrected` settle archived the old
   * memory and kept its links on it, so the sweep of rows archived for good
   * left `corrected` out (Group 4). Each standing `corrected` settle's old
   * memory hands its links to the memory that holds now (`headOf`, else the
   * pair's holder), by the carry a settle now makes. Latched like the
   * regrown pass, which the sweep reads before it takes `corrected`; not
   * latched when a write failed, so the next open tries again.
   */
  private relinkCorrected(): void {
    try {
      if (this.store.getMeta(CORRECTED_RELINK_META) !== undefined) return;
      const day = this.store.livedDay();
      let carried = 0;
      let failed = 0;
      for (const p of this.store.contradictions({ state: "settled", limit: 100_000 })) {
        if (p.how !== "corrected" || p.via !== null || p.over === null || p.holds === null) continue;
        const over = this.store.row(p.over);
        if (over === undefined || over.archived !== 1 || over.archived_reason !== CORRECTED_REASON) continue;
        const holder = this.store.row(p.holds);
        const to = holder !== undefined && holder.archived === 0 && holder.superseded_by === null ? p.holds : headOf(this.store, p.holds);
        if (to === null) continue;
        const out = this.associate.retargetOnSupersede(p.over, to, day);
        if (out.reason === "failed") failed += 1;
        else carried += 1;
      }
      this.emit("counterpart.corrected.relink", undefined, { carried, failed, day });
      if (failed > 0) return;
      this.store.setMeta(CORRECTED_RELINK_META, JSON.stringify({ at: this.nowFn(), day, carried }));
    } catch (err) {
      this.emit("counterpart.corrected.relink.failed", undefined, { code: errCode(err) });
    }
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const event: CounterpartEvent = { at: this.nowFn(), name };
    if (ref !== undefined) event.ref = ref;
    if (data !== undefined) event.data = data;
    this.push(event);
  }

  private push(event: CounterpartEvent): void {
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(event);
  }
}
