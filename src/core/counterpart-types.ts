/** The composition root's option, input and report shapes (moved out of `counterpart.ts`, 2026-10-11). */
import type { FlushReport } from "./associate/index.js";
import type { MintResult } from "./mint.js";
import type { Stance } from "./observer.js";
import type { PlainDue } from "./prospective/index.js";
import type { Proposal, MalformedReason, InterpretFn, SweepReport } from "./remember/index.js";
import type { RevisionApplication } from "./revision.js";
import type { HeldUpdate, SlotOutcome } from "./reconsolidation.js";
import type { Recurrence } from "./time.js";
import type {
  IdentityCoreSpec,
  PageWriterMode,
  SelfTunables,
  WakeResult,
  ChapterAppend,
  WakeTrigger,
} from "./self/index.js";
import type { CycleReport } from "./sleep/index.js";
import type { AboutMark, Embedder, SaidBy, MemoryStatus } from "./store/index.js";

/** What `Counterpart.markAbout` did, or why it did nothing. */
export type MarkAboutOutcome =
  | {
      readonly ok: true;
      readonly id: string;
      /** The id asked for, when it was an earlier version of `id`. */
      readonly forwardedFrom?: string;
      readonly mark: AboutMark;
      readonly before: AboutMark | null;
      readonly changed: boolean;
      readonly archived: boolean;
      /** The why as recorded (credentials redacted), or null when none was given. */
      readonly why: string | null;
      readonly note?: string;
    }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

/** Why a sweep carried a wake, or did not. One name, and it lands on the row. */
export type SweepWakeReason =
  /** A self was composed and at least one chunk's prompt carried it. */
  | "composed"
  /** No chunk was read, so no self was composed — the ordinary "nothing
   *  crashed" day. There was nothing to carry a wake to, and the run paid
   *  nothing for one: `bytes`, `elements` and the rest are 0. */
  | "not-reached"
  /** Nothing to carry: no element rendered (a fresh store, or one whose whole
   *  active set was stood aside). Today's behaviour, exactly. */
  | "cold-start"
  /** The host reported no injection ceiling and no cap was configured, so there
   *  is no budget to compose against — and none is invented (scar §2.18). */
  | "no-budget"
  /** A cap so small that not even the bundle's own furniture fits it. */
  | "no-room"
  /** Composition threw. The sweep runs on, cold; `code` says what happened. */
  | "failed";

/** What one sweep's wake composition produced. Internal to `sweepFallback`. */
export interface SweepWake {
  /** The block's body, or null when this sweep carries none. */
  readonly text: string | null;
  readonly reason: SweepWakeReason;
  /** Bytes of `text` as it will be sent, redaction included. 0 when there is none. */
  readonly bytes: number;
  /** The compose budget this run used, or null when there was none to use. */
  readonly cap: number | null;
  readonly elements: number;
  /** Elements the cap's trim order dropped — the cap having bitten. */
  readonly trimmed: number;
  /** Rows stood aside as confidential or protected, before any lane saw them. */
  readonly omitted: number;
  readonly code: string | null;
}

/**
 * How a credit was earned (2026-10-11): an id OPENED (`expanded`), a loud or
 * asked memory's words QUOTED (`quoted`), or named in a `drewOn` field — the
 * session saying it drew on a memory it was shown (`drewOn`). Carried on the
 * `recall.credit` row as `how`, aligned with `ids`.
 */
export type CreditHow = "expanded" | "quoted" | "drewOn";

/** What one `drewOn` field did (`Counterpart#creditDrewOn`). */
export interface DrewOnResult {
  readonly day: number;
  /** Distinct ids named, in the order given. */
  readonly named: number;
  /** Credited at the engaged tier, in the order given. */
  readonly credited: string[];
  /** Refused by name, in the order given: `not-shown`, `unknown-id`,
   *  `archived`, `handoff`, `superseded`, `faded-under-newer`, or recall's or
   *  physics' own reason (`already-credited-at-or-above`,
   *  `already-credited-today`, `birth-day`, `observer`, …). */
  readonly refused: { id: string; reason: string }[];
  /** Past the boundary's cap (`DREW_ON_MAX_PER_BOUNDARY`), not attempted. */
  readonly capped: string[];
  /** Dated memories whose open reminder window this stopped
   *  (`Prospective#actedOn`): acted on, so no more footnotes this window. */
  readonly actedOn: string[];
  /**
   * Pairs of named memories handed to the edge module as one co-use
   * (2026-10-11, Group 4 item 1): the ones credited, and the ones refused only
   * for their day cadence (the credit pass's own rule, `linksDespite`), each
   * pair at the referenced tier — one `HEBB_RATE` deposit. Written to the
   * pending file; the boundary's worker lands them. 0 when fewer than two.
   */
  readonly linked: number;
}

/** What one boundary's temporal contiguity pass did. Counts only. */
export interface ContiguityPass {
  readonly reason: "buffered" | "nothing-new" | "observer" | "failed";
  /** Sessions with a new memory, and the new memories themselves. */
  readonly sessions: number;
  readonly memories: number;
  /** New rows the NIGHTLY RUN wrote (a dream's gist or merge, a reflection's
   *  entry), which carry the launching session's id and are left out of
   *  contiguity — counted, never cut silently (review of #281, finding 1). */
  readonly excluded: number;
  /** Pairs an EARLIER pass planned whose boundary never recorded its flush —
   *  the process died between moving the cursor and writing the row, so they
   *  were dropped (at most once, by design) and are counted here instead of
   *  nowhere (review of #281, finding 3). */
  readonly lostEarlier: number;
  /** Pairs planned: with a real order between them (forward bias), or one batch (flat). */
  readonly pairs: number;
  readonly timed: number;
  readonly batch: number;
  /** Directed deltas at or under the conduct floor (see `ContiguityPlan`). */
  readonly underFloor: number;
  /** Pairs buffered for the flush, and refused (an endpoint not live, or pinned). */
  readonly buffered: number;
  readonly blocked: number;
  readonly frozen: number;
  /**
   * After the boundary's flush (review of #281, findings 2 and 9): buffered
   * pairs that LANDED as a conducting link, the pairs' own new links the count
   * cap evicted, other links it evicted at nodes contiguity touched, and those
   * nodes the outgoing bound scaled back. Absent from a pass that buffered
   * nothing, or one called on its own (`contiguityPass`), which has no flush.
   */
  readonly landed?: number;
  readonly evictedOwn?: number;
  readonly evictedOther?: number;
  readonly renormalizedNodes?: number;
  readonly code?: string;
  /** The same pass's write-time links (Group 4 item 2, 2026-10-11): what was in mind. */
  readonly atWrite?: AtWritePass;
}

/**
 * WRITE-TIME LINKS (Group 4 item 2, 2026-10-11; bench item 5): each new memory
 * the boundary's contiguity pass reads gets a faint link (`WRITE_LINK_WEIGHT`)
 * to what was in mind when it was written — what a deliberate question showed
 * near the write, and what recall showed its session in the last few turns.
 * Proposed, so room-only: `noRoom` pairs were refused, never forced. Counts
 * only, on the boundary's `associate.flush` row as `atWrite`.
 */
export interface AtWritePass {
  readonly reason: "linked" | "nothing-in-mind" | "failed";
  /** New memories that had something in mind, and the pairs planned for them. */
  readonly memories: number;
  readonly pairs: number;
  /** Pairs that landed (or already weighed at least the proposal). */
  readonly landed: number;
  readonly noRoom: number;
  readonly blocked: number;
  readonly frozen: number;
  readonly code?: string;
}

export interface CreditReferencesInput {
  readonly assistantTurns: readonly string[];
  readonly expansions: readonly string[];
  readonly deadline?: number;
  readonly now?: () => number;
}

export interface CreditSummary {
  readonly reason: "credited" | "nothing-to-credit" | "no-candidates" | "budget-exceeded" | "failed";
  readonly day: number;
  readonly considered: number;
  readonly expanded: number;
  readonly quoted: number;
  readonly credited: number;
  readonly unresolvedHandles: number;
  readonly skippedForBudget: number;
  /** Loud candidates whose prose would not read. Counted, never silently skipped. */
  readonly unreadable: number;
  /** Refusals keyed by the physics `CreditReason` (or recall's own gate reason). */
  readonly refused: Record<string, number>;
  readonly ids: string[];
  /** How each of `ids` was earned, aligned with it (2026-10-11). */
  readonly how: CreditHow[];
  /** Uses refused strength credit only for their day cadence that still joined
   *  the turn's links (2026-09-28; associate NOTES §13). */
  readonly linkedDespite: number;
  /** Every id the assistant EXPANDED this boundary, credited or refused — the
   *  OQ4 probe's input (`recall/probe.ts`): footnotes delivered ∩ later expanded. */
  readonly expandedIds: string[];
  /** Of those, how many this session had been shown as a QUIET POINTER — a
   *  memory only links reached (association build 2, 2026-09-28). Pointers
   *  shown are on each turn's `recall.decision` (`spread.pointersShown`);
   *  this is the other half: whether they get used. */
  readonly pointersExpanded: number;
  /** The ambient showings this boundary scored (2026-10-09): what recall showed
   *  this session since the last boundary that judged, by lane. Measurement
   *  only — nothing is strengthened, weakened or re-ranked by it. */
  readonly shown: ShownLanes;
  /** Of those, how many the replies neither expanded nor quoted, by lane. */
  readonly unused: ShownLanes;
  /** Their ids, oldest showing first: with `recall.decision`'s rows, a hit rate
   *  per memory and per lane. */
  readonly shownNotUsed: string[];
  /** The recall turn the scored stretch ends at (the session's `judged` mark
   *  after this pass); 0 when the session has shown nothing yet. */
  readonly judgedThrough: number;
}

/** Ambient showings by lane: shown loud, footnoted on the turn's own cues, or
 *  footnoted as a quiet pointer (reached only through links). */
export interface ShownLanes {
  readonly loud: number;
  readonly footnotes: number;
  readonly pointers: number;
}

/**
 * What one worker run did with the co-activation its hooks left on disk. Counts
 * only — the ids are in the edge rows, where they are the record.
 */
export interface PendingApplyReport {
  readonly reason: "flushed" | "failed" | "observer" | "nothing-pending" | "nothing-buffered";
  /** Claim files carried: this boundary's, plus any a dead run left behind. */
  readonly claims: number;
  /** Lines in them — one credit pass, or a fragment of a large one. */
  readonly passes: number;
  readonly pairs: number;
  readonly rows: number;
  readonly blocked: number;
  readonly evicted: number;
  /** Dead edge rows the flushes swept (2026-09-28). */
  readonly swept: number;
  /** Deltas drained and not landed — the failed arm's chosen direction. */
  readonly dropped: number;
  /** Pairs the pending file's cap refused while the hooks were writing it. */
  readonly pendingDropped: number;
  /** Lines in a claim that were not JSON. Counted, never swallowed. */
  readonly corrupt: number;
  /** Applied claims this run could not remove — the one doubling window. */
  readonly stuck: number;
  /** How old the oldest carried work was when it was applied. */
  readonly oldestMs: number;
}

/** Telemetry: ids, counts, bytes, reasons, flags. NEVER body text (store §5 G10). */
export interface CounterpartEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

/**
 * The LIVE half of an embedder — the half that may reach a network, kept apart
 * from `Embedder` because the store's socket is synchronous and a network call
 * is not. Whoever owns the host owns this, exactly as it owns `InterpretFn`
 * (`remember/INTERFACE-GAPS §3`); `adapters/claude-code/embed-client.ts` is the
 * implementation for this repo's first host, and nothing in `core/` names it.
 *
 * `warm` exists because the fallback sweep mints in batches: one batched call
 * for a chunk's accepted proposals, rather than one round trip each.
 */
export interface LiveVectors {
  vector(text: string): Promise<number[] | null>;
  warm(texts: readonly string[]): Promise<unknown>;
}

export interface CounterpartOptions extends Stance {
  /** Defaults to `dataDir()` — resolved by the store at call time, so tests redirect. */
  dir?: string;
  /**
   * The host's reported injection ceiling, in bytes (scar §2.18). It has NO
   * default anywhere in this package: absent, the briefing phase refuses to
   * render and events `briefing.no-budget`, which is the correct behaviour.
   * `wake()` can report it later, which is the ordinary path — the adapter
   * learns the ceiling from its host's configuration at session start.
   */
  budgetBytes?: number;
  /** Is this the owner's own session? Defaults FALSE in `recall/` (§15 G7). */
  owner?: boolean;
  embed?: Embedder;
  /**
   * The LIVE half of the same embedder: text in, vector out, and it may reach a
   * network. Injected separately from `embed` because the store's socket is
   * synchronous and a network call is not — the adapter that owns the host owns
   * the client, exactly as it owns `InterpretFn` (`remember/INTERFACE-GAPS §3`).
   *
   * Wiring it turns novelty from `no-chunk-vector` into a measurement on the
   * authored door. The gate's vector is NOT handed to the store: `Store.put →
   * indexOne` asks the sync `embed` for its own, by the same string. What keeps
   * that to one computation is the embedder (the static table remembers its
   * last text, `embed-client.ts#createStaticEmbedder`) — and an ordering that is
   * easy to break: the text embedded here is the GATE'S output, shaped by
   * `indexTextOf`, which is exactly what `Store.indexOne` will ask for.
   *
   * Embed the author's draft instead and BOTH halves fail at once: the novelty
   * is measured on text the gate redacted or rewrote (the redaction is
   * bypassed), and every gate rewrite — 18.9% of chunks in the replay corpus —
   * asks under a key the store never asks for, so the write pays for a vector it
   * then discards. `bridge.batteryGate` holds that order;
   * `test/claude-code.test.ts` holds it to it.
   */
  vectors?: LiveVectors;
  /** Retention window for the bounded logs. `store/` owns the default. */
  retentionDays?: number;
  /** Where the store's pre-migration copy goes; `store/` owns the default. */
  snapshotsDir?: string;
  /** The identity core's name is the OWNER's; there is no default (SEAMS F). */
  identity?: IdentityCoreSpec;
  onEvent?: (e: CounterpartEvent) => void;
  now?: () => number;
  /**
   * The person's zone, an IANA name — the host config's `timeZone`
   * (docs/time.md rule 2). Handed to the store, which every local date here
   * reads through (`Store#zone`). Absent: the machine's current zone.
   */
  timeZone?: string;
  /**
   * The host config's `pageWriter.mode` (owner ruling D3 on #256,
   * 2026-09-27): `off` means nothing writes the self page on its own — the
   * reflection too. It still reflects, keeps its entry and offers its share;
   * it does not write the page. Absent: `session`, the config's own default.
   */
  pageWriterMode?: PageWriterMode;
  /**
   * The package version this process runs (2026-10-02), from the adapter that
   * knows it (`sessions.ts#installedVersion`). Each wake this process publishes
   * is stamped with it, and `refreshWake` re-renders a wake another build
   * published (`self/behind.ts`, the `version` trigger). Absent or null: no
   * stamp and no comparison — today's behaviour.
   */
  build?: string | null;
  /**
   * READ A DREAM'S AND A REFLECTION'S BUNDLES AS THE OWNER (review of #318).
   * No host sets it: a bundle is a guest's on every server
   * (`dream/tunables.ts#BUNDLE_OWNER`). The store-level tests of what an
   * owner-read bundle must keep — a merge of a confidential memory is
   * confidential, a page rests on nothing confidential — set it. Absent: false.
   */
  bundlesAsOwner?: boolean;
  /**
   * `self/`'s knobs over its defaults (`self/tunables.ts`). Absent: the
   * defaults. Added 2026-10-01 so the craft lane's switch
   * (`CRAFT_AT_DELIVERY`) can be turned off for a whole counterpart.
   */
  selfTunables?: Partial<SelfTunables>;
}

/** What `wake()` returns: the bundle, plus what the host told us about itself. */
export interface WakeOutcome extends WakeResult {
  /** The ceiling this brain will compose to, or null if none was ever reported. */
  readonly budgetBytes: number | null;
}

/**
 * WHERE this session woke — the delivery-time facts the published bundle could
 * not know, beyond the date. Only the per-directory handoff pointer reads it
 * today (E1); absent means no pointer is looked for, which is what every
 * non-host caller (the dashboard, replay, the CLI) wants.
 */
export interface WakeHere {
  /** The canonical directory this session opened in. */
  readonly scope?: string;
  /** The session id, for the `handoff.shown` row. Never guessed. */
  readonly session?: string | null;
  /**
   * The Counterparts version installed now, as the host adapter reads it
   * (2026-10-01): a handoff written by an older one says "written before
   * 0.3.10 was installed". Absent: no such words.
   */
  readonly installed?: string | null;
  /**
   * The version a session OPENED with, from the host's registry
   * (`sessions.ts#SessionRecord.opened`) — for a handoff written before rows
   * carried their own (`handoff/#HANDOFF_META_BUILD`). Null when unknown.
   */
  readonly openedWith?: (session: string) => string | null;
  /**
   * May a chapter written in that directory be named in another directory's
   * wake? The host's scope setting, read at delivery (review of #311): only a
   * directory that is `on` exports; `off`, `paused`, `observer`, an unreadable
   * setting, or no way to ask (absent) keep its chapters where they were made.
   */
  readonly exportsFrom?: (scope: string) => boolean;
  /**
   * THE HOST'S SESSIONS, for the "Today, elsewhere" line (2026-10-10): every
   * session its registry holds — which directory, when it started, its last
   * boundary, whether it ended or is still live. Host state, no content; the
   * line keeps today's, in other directories, that may be named here
   * (`exportsFrom`). Absent: the line names no session.
   */
  readonly sessions?: () => readonly WakeSession[];
}

/** One session in the host's registry, as `WakeHere.sessions` hands it. */
export interface WakeSession {
  readonly session: string;
  readonly scope: string;
  readonly startedAt: number;
  readonly lastAt: number;
  readonly live: boolean;
  /** When the host closed it, epoch ms; null or absent while it has not
   *  (the "Since you started" line's "ended", 2026-10-11). */
  readonly endedAt?: number | null;
}

/**
 * v12 (2026-10-03): THE WRITER'S THREE FIELDS AS SENT, read and checked by
 * the door (`mcp/server.ts#readWriteFacts` drops what it cannot read, with a
 * note, and never refuses the memory for it). Per field: absent = not sent —
 * a revision (`updates:`, declared and resolved) carries it over from the
 * memory it revises; `null` = sent as none — nothing is carried.
 */
export interface SentFacts {
  readonly occurredOn?: string | null;
  readonly saidBy?: SaidBy | null;
  readonly status?: MemoryStatus | null;
}

/** The three fields' names, as a writer sends them. */
export type FactField = "occurredOn" | "saidBy" | "status";

/** What a deposit recorded of the three fields (v12), and what it carried over. */
export interface DepositFacts {
  readonly occurredOn: string | null;
  readonly saidBy: SaidBy | null;
  readonly status: MemoryStatus | null;
  /** Fields taken from the memory this one revises because the writer left them out. */
  readonly inherited: readonly FactField[];
  /** The memory they were taken from, when any was. */
  readonly from: string | null;
}

export interface DepositContext {
  session: string;
  scope: string;
  /** v12: the writer's three fields, as sent (`SentFacts`). Absent: none sent. */
  facts?: SentFacts;
  /**
   * What the memory is about, as the writer marked it (`me`, `us`, `owner`,
   * `work`, `world`), or null/absent when unmarked. Read at the mint only for
   * an UNCLAIMED memory's default floor (`physics.defaultClaimFor`, 2026-10-10);
   * the mark itself is recorded after the deposit, as before (`recordAbout`).
   */
  about?: string | null;
  /** The span this deposit IS (a jot's own words), withheld from the sweep. */
  ownSpanHash?: string | null;
  /** The model writing it, from host state (`MintOptions.model`); absent = NULL. */
  model?: string;
  /**
   * THE CALLER'S STANCE FOR THIS DEPOSIT, when it is not the process's
   * (2026-10-02): a Claude Code session from Desktop's Code tab is served by
   * Desktop's server, whose store opened as a guest, and it is still the
   * owner's own session. Read only by the thread close (`closeThread`).
   * Absent: the process's own `owner`.
   */
  owner?: boolean;
  /**
   * Memories the same call wrote before this one (a dump's earlier entries):
   * the writer's own words of the same moment, never read as an earlier state
   * of this one by the slot detector (review of #420; the neighbours' rule,
   * review of #284 M1).
   */
  siblings?: readonly string[];
}

/**
 * `submitSessionEnd`'s context — and ONLY its (PR #192 re-review, NIT): a jot is
 * always its own session's words, so `submitJot` takes the plain
 * `DepositContext` and drops `cover` even from a caller that sends it.
 */
export interface SessionEndDepositContext extends DepositContext {
  /** Whose uncovered spans the deposit claims — `remember/proposals.ts#
   *  SubmitContext.cover`. Absent: the depositing session's own (every caller
   *  but the next-session write-up's door). */
  cover?: false | { readonly session: string };
  /** A WRITE-UP's deposit (2026-10-01): the memory is that session's, lived on
   *  `happenedOn`, and marked second-hand (`mint.ts#MintOptions.writeUp`).
   *  Absent: the depositing session's own memory, as ever. */
  writeUp?: { readonly session: string; readonly happenedOn: string | null };
}

export type DepositReason =
  | "minted"
  | "observer"
  | "malformed"
  | "duplicate-content"
  | "gate-rejected"
  | "gate-failed"
  | "io-failed";

/**
 * One plain reminder, claimed and due to be told (`Counterpart.plainReminders`).
 * The record `prospective/` hands out, plus `what`: the memory's title or its
 * first line, which is the one piece of the memory's own words a host needs to
 * say it. The sentence around it is the host's.
 */
export interface PlainReminder extends PlainDue {
  readonly what: string;
}

export interface DepositResult {
  readonly deposited: boolean;
  readonly reason: DepositReason;
  readonly memoryId: string | null;
  readonly proposal: Proposal | null;
  readonly mint: MintResult | null;
  /** The battery's own name for its refusal, when the battery refused. */
  readonly gate: string | null;
  /** Span hashes this deposit took off the sweep's input pile. */
  readonly covers: readonly string[];
  /** Intake's own name for a malformed draft (`KIND_UNKNOWN`, `CONTENT_EMPTY`,
   *  …), when that is why it was refused. A bare "malformed" told the author
   *  nothing to fix (IMPROVEMENTS U11). */
  readonly malformed?: MalformedReason | null;
  /**
   * Present when this deposit REVISED a dated memory (`updates:`, declared and
   * resolved): the reminder the new memory carries after the carry-over, and
   * where it came from (`Counterpart#carryReminder`, review N7).
   */
  readonly reminder?: DepositReminder;
  /**
   * What the declared `updates:` did (2026-09-29): which arm of the revision
   * dispatch ran, and — on the ordinary-memory arm — how the old memory was
   * settled, or why it was not. Absent when nothing was declared.
   */
  readonly revision?: RevisionApplication;
  /**
   * The declared `updates:` this deposit HELD (2026-10-09, the update guard):
   * a `changed` or `corrected` at a memory that looked unrelated to the new
   * one, so the new memory landed unlinked and the old one was not settled
   * (`Counterpart#guardUpdate`). The old memory's title and text ride out, so
   * the writer can settle it itself if it meant to. Absent otherwise.
   */
  readonly held?: HeldUpdate;
  /**
   * The open thread this deposit CLOSED (2026-10-01, lane 8): the memory it
   * revises was flagged `unresolved` and the author sent `unresolved` — false
   * (it is answered) or true (this memory carries it on). `closed` is false
   * when it was refused (`refused`: the revision step's own reasons — see
   * `Counterpart#closeThread`) or the clear did not land. Absent otherwise.
   */
  readonly thread?: { readonly from: string; readonly closed: boolean; readonly refused?: ThreadRefusal };
  /** v12: the writer's three fields as recorded — after a revision's carry-over. */
  readonly facts?: DepositFacts;
  /**
   * The older memory the slot detector read this one as the newer state of
   * (2026-10-11, Group 2): proposed provisionally, for the writer to confirm
   * now or the dream tonight (`reconsolidation.ts#detectSlot`). Absent when
   * none qualified.
   */
  readonly slot?: Extract<SlotOutcome, { ok: true }>;
  /**
   * What it is about, when the writer sent no mark and this revision took the
   * one of the memory it revises (2026-10-11, `Counterpart#carryAbout`).
   */
  readonly aboutCarried?: { readonly mark: AboutMark; readonly from: string };
}

/**
 * Why a deposit did not close the open thread it names (review of #313): the
 * revision step's own refusals for a protected or archived row, and the two
 * a session that is not the owner's meets — a confidential row, or a row
 * written in another directory.
 */
export type ThreadRefusal = "protected-refuses-revision" | "target-archived" | "confidential" | "other-directory";

/** A revision's reminder: carried over, replaced, or dropped — and moved. */
export interface DepositReminder {
  /** The memory the reminder came from — the one revised, or, when its reminder
   *  had already moved on, the memory holding it now. Its own date was cleared
   *  (kept in its version) when `moved`. */
  readonly from: string;
  /** The date the new memory carries, or null when the revision dropped it. */
  readonly eventDate: string | null;
  readonly remind: "plain" | "quiet" | null;
  /** How often the carried date comes round (2026-10-09), or null: once. */
  readonly recurring: Recurrence | null;
  /** A repeat — sent or carried — that the new date cannot take (only a day
   *  repeats), so it was dropped: said in the answer, never silently lost. */
  readonly recurringDropped?: boolean;
  /** Which fields came from `from` because the author left them out. */
  readonly inherited: readonly ("eventDate" | "remind" | "recurring")[];
  /** False only when clearing `from`'s date failed (evented). */
  readonly moved: boolean;
}

/** `carryReminder`'s answer: the proposal to mint, and what it took from where. */
export interface ReminderCarryPlan {
  readonly proposal: Proposal;
  /** The dated memory being revised, or null when there is nothing to carry. */
  readonly from: string | null;
  readonly inherited: readonly ("eventDate" | "remind" | "recurring")[];
  readonly recurringDropped?: boolean;
}

export interface SweepEntry {
  /** The model call. Streaming, headroom and detachment are the adapter's
   *  (`remember/INTERFACE-GAPS` §3, SEAMS queued item 10). */
  interpret: InterpretFn;
  /** One scope, or every scope holding experience (spec §2 G9 — the default). */
  scope?: string;
  chunkBytes?: number;
  minBytes?: number;
  staleClaimMs?: number;
  /** How long a session must be SILENT before the fallback may call it crashed
   *  (`TUNABLES.CRASH_STALE_MS`). The replay harness overrides it, because a
   *  corpus of finished days is a corpus of sessions nobody will come back to. */
  crashStaleMs?: number;
  /** The calendar date this run belongs to, carried into the `sweep.gate` row so
   *  it is self-attributing. Absent ⇒ the row is attributed by lived day alone. */
  date?: string;
  /** Byte cap for the WAKE this sweep's interpreter is woken with. Absent ⇒
   *  `TUNABLES.SWEEP_WAKE_BYTES`, and absent there ⇒ the ordinary wake budget
   *  the host reported. No budget anywhere ⇒ no wake, and the row says so. */
  wakeBytes?: number;
}

/**
 * "The sweep did not run, and here is why" — a caller's way to say SKIPPED
 * rather than to say nothing.
 *
 * Added 2026-09-11 (I32). Until then `sweep: undefined` meant "no sweep", and
 * no sweep meant NO `sweep.gate` ROW AT ALL: a boundary whose worker could not
 * make a model call left exactly the same trace as a boundary nobody reached.
 * The gate row exists so silence is evidenced (constitution 16); a run that
 * skipped the sweep on purpose still owes the record, with the reason on it.
 */
export interface SweepSkipped {
  /** Why the caller did not sweep. One name, and it lands on the gate row.
   *  `not-opted-in` (roadmap C2, 2026-09-23): the sweep is an opt-in upgrade,
   *  and the owner has not opted in — whatever key is present. The next
   *  session in a crashed session's project writes it up instead. */
  readonly skipped: "no-credential" | "not-opted-in";
}

export interface SessionEndInput {
  /** The calendar date this cycle belongs to; `sleep/` defaults to today, UTC. */
  date?: string;
  /** The calendar date the horizon lane asks about. Absent ⇒ no horizon lane. */
  at?: string;
  /** When present, the crash fallback runs BEFORE the cycle, so anything it
   *  mints is inside the boundary that decays, consolidates and re-renders.
   *  A `SweepSkipped` runs no sweep and still writes the gate row, named. */
  sweep?: SweepEntry | SweepSkipped;
  /** Override the ceiling reported at wake, for this boundary only. */
  budgetBytes?: number;
  /** The session whose boundary this is, when the caller knows (2026-10-11):
   *  stamped on the `associate.flush` rows this boundary writes. */
  session?: string;
}

/** What an appended chapter comes back as, gate verdict included. */
export interface ChapterResult {
  readonly appended: boolean;
  readonly reason: ChapterAppend["reason"] | "gate-refused";
  readonly gate: { gate: string; reason: string } | null;
  readonly episodeId: string | null;
  readonly chapter: number;
  readonly created: boolean;
}

export interface SessionEndReport {
  readonly sweeps: readonly SweepReport[];
  readonly edges: FlushReport;
  /** Temporal contiguity: what this boundary planned and buffered before its
   *  flush (2026-09-28). */
  readonly contiguity: ContiguityPass;
  /** The co-activation the hooks left on disk, applied here. Null if it threw. */
  readonly carried: PendingApplyReport | null;
  readonly cycle: CycleReport;
  readonly budgetBytes: number | null;
  /** The episode reconciler's pass: what the boundary ingested (§5 G12). */
  readonly episodes: EpisodeReconcileReport;
}

/** What one out-of-band wake re-render produced. Counts and bytes, never text. */
export interface RebriefReport {
  readonly rendered: boolean;
  readonly reason: "rendered" | "no-budget";
  readonly published: boolean;
  readonly day: number;
  /** The ceiling used, and the composed budget after the preface reserve. */
  readonly budgetBytes: number | null;
  readonly composeBudget: number | null;
  readonly bytes: number;
  readonly elements: number;
  /** Per-lane counts, as the render's own telemetry recorded them. */
  readonly counts: Record<string, number>;
}

/** What `refreshWake` came to: `current` when nothing put the wake behind. */
export interface WakeRefreshReport {
  readonly reason: "current" | "rendered" | "no-budget" | "observer";
  readonly triggers: readonly WakeTrigger[];
  readonly day: number;
  readonly bytes: number;
}

export interface EpisodeReconcileReport {
  readonly considered: number;
  readonly ingested: number;
  readonly regrown: number;
  readonly skipped: number;
}
