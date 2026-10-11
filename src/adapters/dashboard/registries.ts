/**
 * The axes the totality test enumerates (CONTRACT §3 / §5 [M]).
 *
 * The rule this file exists to keep: **a new axis in the core must break
 * something here, at compile time, before it can go missing on screen.** v1's
 * curation starvation hid inside a panel nobody rendered, and a hand-copied list
 * of kinds in a dashboard would reproduce that exactly — it would keep rendering
 * five kinds forever after a sixth was born.
 *
 * So none of these three lists is a copy:
 *
 *   - `KINDS` is `Object.keys(PHYSICS.TUNABLES.KINDS)`. That object is declared
 *     `satisfies Record<Kind, KindPhysics>` in `physics/`, so it IS the registry;
 *     reading its keys cannot go stale.
 *   - `BANDS` has no runtime registry in the core (`Band` is a bare union), so
 *     the order map below is declared `satisfies Record<Band, number>`. A band
 *     added to `core/types.ts` fails `tsc` HERE until it is given a position, and
 *     a band removed fails too. `INTERFACE-GAPS.md` §1 asks the core for the
 *     array so this workaround can be deleted.
 *   - `PHASES` is `sleep/`'s own exported tuple, imported, never restated.
 */
import { TUNABLES as PHYSICS } from "../../core/physics/index.js";
import type { PromotionCrossing, PruneRecord } from "../../core/physics/index.js";
import { PHASES } from "../../core/sleep/index.js";
import type { MergeRecord, Phase } from "../../core/sleep/index.js";
// A TYPE import, erased at runtime: the caller-universality test's own rule
// (`test/cli.test.ts`) is that a type import reaches no function on that seam.
import type { UnmergeRecord } from "../../core/store/owner-op-seam.js";
import type { PressureIncrement } from "../../core/schemas/index.js";
import type { Band, Kind } from "../../core/types.js";
import {
  ADAPTER_ASK_EVENT,
  ASSOCIATE_FLUSH_EVENT,
  AUTHORSHIP_ASK_EVENT,
  BOUNDARY_EVENT,
  CAPTURE_FAILED_EVENT,
  CHECKOUT_EVENT,
  EMBED_BACKFILL_EVENT,
  EPISODE_ASK_EVENT,
  GATE_CHUNK_EVENT,
  GATE_DEPOSIT_EVENT,
  PRIMACY_DELIVER_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  RECALL_CREDIT_EVENT,
  RECALL_DECISION_EVENT,
  RECALL_DELIVERED_EVENT,
  RUNNER_FAILED_EVENT,
  HOOK_CLAIM_LOST_EVENT,
  SELF_BRIEFING_EVENT,
  SEMANTIC_LAG_EVENT,
  SLEEP_CYCLE_EVENT,
  SNAPSHOT_FAILED_EVENT,
  SNAPSHOT_ROTATED_EVENT,
  SNAPSHOT_TAKEN_EVENT,
  MCP_RECALL_EVENT,
  MCP_PART_EVENT,
  MCP_OVERSIZE_EVENT,
  MCP_SPILLED_EVENT,
  ENVELOPE_GAVE_WAY_EVENT,
  ENVELOPE_OVERCAP_EVENT,
  INJECTION_OVERBUDGET_EVENT,
  NOTICE_DROPPED_EVENT,
  SPAWN_FAILED_EVENT,
  SPAWN_REFUSED_EVENT,
  SPAWN_STARTED_EVENT,
  STORE_EXPORT_EVENT,
  SWEEP_GATE_EVENT,
  SWEEP_WAKE_EVENT,
  WAKE_DELIVERED_EVENT,
  WAKE_INJECTED_EVENT,
  WRITE_UP_FAILED_EVENT,
} from "../../core/counterpart.js";
import { BAND_TRANSITION_EVENT } from "../../core/sleep/index.js";
// Prospective memory's two (2026-09-20, E2). The module had no durable row at
// all: `fires` is a column, so the store could say a window had ever fired and
// never when, or why one did not.
// And a third (2026-09-26): a PLAIN item told to the person on its day.
import {
  PROSPECTIVE_FIRE_EVENT,
  PROSPECTIVE_PLAIN_EVENT,
  PROSPECTIVE_REFUSED_EVENT,
} from "../../core/prospective/index.js";
// The self page's two, from `self/` itself (2026-09-18, S1): a written page is
// not a briefing render, and a refused write is not an accepted one.
import {
  JOURNAL_COPY_FAILED_EVENT,
  JOURNAL_COPY_WRITTEN_EVENT,
  SELF_PAGE_REFUSED_EVENT,
  SELF_PAGE_REVISED_EVENT,
  SELF_PAGE_WRITER_EVENT,
  WORK_OVERFLOW_EVENT,
} from "../../core/self/index.js";
// The per-directory handoff's four, from `handoff/` itself (2026-09-20, E1):
// working context for a place is not a memory, so its rows are its own.
import {
  HANDOFF_CLEARED_EVENT,
  HANDOFF_REFUSED_EVENT,
  HANDOFF_SHOWN_EVENT,
  HANDOFF_WRITTEN_EVENT,
} from "../../core/handoff/index.js";
// And the "Last here" line's one durable row (2026-10-01): dropped for room.
import { LAST_HERE_NOROOM_EVENT } from "../../core/handoff/last-here.js";
// Raw-transcript retention's one row (2026-09-23, B3), from `remember/` itself.
// The index re-exports the NAME and the readers, never the deleter.
import { RETENTION_EVENT } from "../../core/remember/index.js";
// The vector cache's identity check (2026-09-23, #190): the one durable row the
// store writes when an open changed what box 3's vectors are filed under.
import { EMBEDDER_RECONCILED_EVENT } from "../../core/store/index.js";
// Dreaming (2026-09-26, `dream/`): the five rows a dream leaves, from the module
// itself; the v8 upgrade's one-time census, from `sleep/`.
import {
  DREAM_ASK_EVENT,
  DREAM_BEGUN_EVENT,
  DREAM_CHANGED_EVENT,
  DREAM_JOURNALED_EVENT,
  DREAM_UNDONE_EVENT,
} from "../../core/dream/index.js";
import { V8_CENSUS_EVENT } from "../../core/sleep/index.js";
// Contradictions (2026-09-29, `core/contradictions.ts`): a flag, a settle, an
// undo — and a write's `updates` held as unrelated (2026-10-09).
import {
  CONTRADICTION_FLAGGED_EVENT,
  CONTRADICTION_HELD_EVENT,
  CONTRADICTION_SETTLED_EVENT,
  CONTRADICTION_UNDONE_EVENT,
} from "../../core/contradictions.js";
// What is not written up (2026-09-30, `core/coverage/`): one row per stretch per state.
import { COVERAGE_LAPSED_EVENT, COVERAGE_OWED_EVENT, COVERAGE_WRITTEN_EVENT } from "../../core/coverage/index.js";

/** Display order for the bands, weakest commitment first. EXHAUSTIVE BY TYPE. */
const BAND_ORDER = {
  episodic: 0,
  semantic: 1,
  identity: 2,
} as const satisfies Record<Band, number>;

export const BANDS: readonly Band[] = (Object.keys(BAND_ORDER) as Band[]).sort(
  (a, b) => BAND_ORDER[a] - BAND_ORDER[b],
);

/** Every kind physics knows how to move. Derived from the physics registry. */
export const KINDS: readonly Kind[] = Object.keys(PHYSICS.KINDS) as Kind[];

/** Every phase the cycle runs, in the cycle's own order. */
export const CYCLE_PHASES: readonly Phase[] = PHASES;

/**
 * Every event name that reaches box 2's `events` table — the DURABLE log, the
 * one that survives the process. Its writers today: `sleep/`'s consolidate,
 * prune, dedup and decay phases, `schemas/`'s credited challenge and
 * `core/revision.ts`'s identity arm (the same name, the same shape, the same
 * dedup latch — a story does not care which arm moved the row), the
 * composition root's four records — the chunk gate's, the AUTHORED gate's (both
 * doors of one battery, added 2026-09-05 with replay §2a), one per turn's
 * surfacing decision, and one per crash-fallback run's gate, whose ordinary
 * answer is "nothing crashed" and which is therefore the one record here
 * written to prove a SILENCE — and the one narrow seam an ADAPTER may write
 * through (`Counterpart.noteAdapterEvent`, typed on `AdapterDurableEventName`).
 *
 * EXHAUSTIVE BY TYPE, the same way `BAND_ORDER` is. Each record interface
 * declares its `event` as a string literal; the `satisfies` below is keyed on
 * the union of those literals, so one more durable record type — or a renamed
 * literal — fails `tsc` here rather than quietly never appearing in the feed.
 * That is the totality test applied to the log itself: "consolidation has
 * promoted nothing, ever" must be a line the owner can read, not an empty space
 * (scar §2.17, §2.4). The adapter seam is typed rather than `name: string` for
 * exactly this reason.
 */
export type DurableEventName =
  | PromotionCrossing["event"]
  | PruneRecord["event"]
  | MergeRecord["event"]
  | UnmergeRecord["event"]
  | PressureIncrement["event"]
  | typeof GATE_CHUNK_EVENT
  | typeof GATE_DEPOSIT_EVENT
  | typeof RECALL_DECISION_EVENT
  | typeof SWEEP_GATE_EVENT
  | typeof SWEEP_WAKE_EVENT
  | typeof SLEEP_CYCLE_EVENT
  | typeof SELF_BRIEFING_EVENT
  | typeof SELF_PAGE_REVISED_EVENT
  | typeof SELF_PAGE_REFUSED_EVENT
  | typeof SELF_PAGE_WRITER_EVENT
  | typeof HANDOFF_WRITTEN_EVENT
  | typeof HANDOFF_SHOWN_EVENT
  | typeof HANDOFF_REFUSED_EVENT
  | typeof HANDOFF_CLEARED_EVENT
  | typeof LAST_HERE_NOROOM_EVENT
  | typeof RECALL_CREDIT_EVENT
  | typeof ASSOCIATE_FLUSH_EVENT
  | typeof BAND_TRANSITION_EVENT
  | typeof PRIMACY_STANDDOWN_EVENT
  | typeof PRIMACY_DELIVER_EVENT
  | typeof WAKE_INJECTED_EVENT
  | typeof WAKE_DELIVERED_EVENT
  | typeof RECALL_DELIVERED_EVENT
  | typeof EPISODE_ASK_EVENT
  | typeof BOUNDARY_EVENT
  | typeof AUTHORSHIP_ASK_EVENT
  | typeof ADAPTER_ASK_EVENT
  | typeof EMBED_BACKFILL_EVENT
  | typeof SEMANTIC_LAG_EVENT
  | typeof SPAWN_REFUSED_EVENT
  | typeof SPAWN_FAILED_EVENT
  | typeof SPAWN_STARTED_EVENT
  | typeof RUNNER_FAILED_EVENT
  | typeof HOOK_CLAIM_LOST_EVENT
  | typeof WRITE_UP_FAILED_EVENT
  | typeof CAPTURE_FAILED_EVENT
  | typeof MCP_RECALL_EVENT
  | typeof MCP_PART_EVENT
  | typeof MCP_OVERSIZE_EVENT
  | typeof MCP_SPILLED_EVENT
  | typeof ENVELOPE_OVERCAP_EVENT
  | typeof NOTICE_DROPPED_EVENT
  | typeof ENVELOPE_GAVE_WAY_EVENT
  | typeof INJECTION_OVERBUDGET_EVENT
  | typeof WORK_OVERFLOW_EVENT
  | typeof CHECKOUT_EVENT
  | typeof SNAPSHOT_TAKEN_EVENT
  | typeof SNAPSHOT_FAILED_EVENT
  | typeof SNAPSHOT_ROTATED_EVENT
  | typeof PROSPECTIVE_FIRE_EVENT
  | typeof PROSPECTIVE_REFUSED_EVENT
  | typeof PROSPECTIVE_PLAIN_EVENT
  | typeof JOURNAL_COPY_WRITTEN_EVENT
  | typeof JOURNAL_COPY_FAILED_EVENT
  | typeof STORE_EXPORT_EVENT
  | typeof RETENTION_EVENT
  | typeof EMBEDDER_RECONCILED_EVENT
  | typeof DREAM_BEGUN_EVENT
  | typeof DREAM_CHANGED_EVENT
  | typeof DREAM_JOURNALED_EVENT
  | typeof DREAM_UNDONE_EVENT
  | typeof DREAM_ASK_EVENT
  // The owner's demotion (`Counterpart.demoteCore`) writes this name as a
  // literal; it is the mirror of `band.promoted`.
  | "band.demoted"
  | typeof V8_CENSUS_EVENT
  | typeof CONTRADICTION_FLAGGED_EVENT
  | typeof CONTRADICTION_SETTLED_EVENT
  | typeof CONTRADICTION_UNDONE_EVENT
  | typeof CONTRADICTION_HELD_EVENT
  | typeof COVERAGE_OWED_EVENT
  | typeof COVERAGE_WRITTEN_EVENT
  | typeof COVERAGE_LAPSED_EVENT;

export const DURABLE_EVENTS = {
  "adapter.ask": "the Stop ask was evaluated (asked, paced out, or capped for the day)",
  // The two names below are HISTORICAL: until 2026-09-04 the blocked moment
  // carried two asks on two pacers and each left its own row. Nothing writes
  // them now; they stay in the vocabulary so the days recorded under them are
  // still readable, which is what a feed the owner can trust requires (§16).
  "adapter.authorship.ask": "HISTORICAL: the authorship half of the old two-ask Stop",
  "adapter.boundary": "a session-ending path reached the boundary (spans captured, cursor moved)",
  "adapter.embed.backfill": "the worker gave vectors to memories that had none (embedded, remaining, failed)",
  "adapter.semantic.lag": "the worker left next turn's semantic cue (or named why it could not)",
  // The spawn seam's three, durable since 2026-09-11 (I32): for a week the
  // worker was refused at every boundary and the only record was a ring that
  // died with the hook process. One row per reason per date.
  "adapter.runner.failed": "the detached worker failed after opening the store (which step, and the code)",
  "adapter.hook.claim.lost": "two Counterparts wirings ran one event and this hook found it already claimed, so it delivered nothing (which hook, which side gave way)",
  "adapter.writeup.failed": "a session start could not compose the pointer to an earlier session's write-up (the code) — that session was not offered its write-up this time",
  "remember.capture.failed": "a turn's words could not be kept for its write-up (which step of the capture, and the code) — the next boundary reads the same turns again",
  "adapter.spawn.failed": "the detached worker could not be started at all (the OS said why)",
  "adapter.spawn.refused": "the detached worker was not started, by name (and how many times running)",
  // The other half of those three (2026-09-20, E2): until it existed, a worker
  // dead all week and a week with nothing to do left the same nothing.
  "adapter.spawn.started": "the detached worker DID start, at least once today (one row per date, with the day's count)",
  // The deliberate look's first durable row (2026-09-20, E2). The whole MCP tool
  // surface wrote nothing, so a session that asked and got nothing and a session
  // that never asked were the same silence.
  "mcp.recall": "the session went looking for a memory on purpose (what kind of ask, how much came back, and every verdict that kept something out)",
  "mcp.part": "a later part of a dream's or a reflection's bundle was handed over (which part of how many, and its size)",
  "mcp.result.oversize": "a tool result came to more than the host shows in one answer, and was cut to fit with a note saying so",
  "mcp.result.spilled": "the host showed one of the nightly run's tool results only as a short preview, so the run read part of it (found in the run's own transcript)",
  // What a delivery could not carry (durable since 2026-10-02; ring-only
  // before, so a dropped notice or a hook past the host's cap left nothing).
  "adapter.envelope.overcap": "a hook's output was past the host's 10,000-character cap even in plain form, so the host showed only a preview of it",
  "adapter.notice.dropped": "the owner's notice was dropped from a session start so the rest of the envelope stayed under the host's cap",
  "adapter.envelope.gave-way": "a part of a delivery waited for want of room — the write-up pointer, the scope question, the turn's recall, a reminder, the dream offer or the update notice (which hook, which part)",
  "adapter.injection.overbudget": "a session start sent more than the ceiling the host reported (what it sent, and the ceiling)",
  // Which CODE was live at a session start (2026-09-14): the hooks run whatever
  // the install tree has checked out, so a peer session's unmerged branch in
  // that tree is the memory layer the owner is using.
  "adapter.checkout": "which checkout the hooks were running at session start (branch, short sha, tracked modifications)",
  "adapter.episode.ask": "HISTORICAL: the episode half of the old two-ask Stop",
  "adapter.primacy.deliver": "a hook delivered while the parallel run was on",
  "adapter.primacy.standdown": "a hook withheld delivery so the other system could speak",
  "adapter.recall": "a turn's recall was composed for injection (counts and bytes)",
  "adapter.wake.delivered": "the wake's arrival was checked, at the first prompt or the first Stop",
  "adapter.wake.injected": "a wake bundle was handed to the host (bytes, never text)",
  "band.promoted": "a memory crossed into the identity band",
  "band.transition": "a memory changed bands (the symmetry counter's food)",
  "gate.chunk": "a swept chunk met the gate battery",
  "gate.deposit": "an authored deposit met the gate battery (which gates acted, and what they refused)",
  "memory.pruned": "a memory was let go at the floor",
  "memory.merged": "a duplicate was merged into its original",
  "memory.unmerged": "the owner put back a row a merge had archived (repair-merged-beliefs)",
  "recall.decision": "a turn decided what came to mind (and what stayed quiet)",
  "revision.pressure": "a belief or an identity element took a credited challenge",
  "sweep.gate": "the crash fallback ran its gate (scopes looked at, every scope's refusal counted by reason, spans swept)",
  "sweep.wake": "the crash fallback was woken as me before it read a transcript (whether a self went, its size, what the cap trimmed, what was held back)",
  // The two U9 rows: until 2026-09-14 the whole sleep cycle and the whole wake
  // render lived in an in-process ring that died with the worker, so "did the
  // cycle run today, did every phase succeed, what did the wake trim" could not
  // be answered from the store at all.
  "sleep.cycle": "the consolidation cycle ran (every phase by name, with its status, and the run's counts)",
  "self.briefing": "the wake briefing was re-rendered (what rendered per lane, and which elements the trim dropped)",
  // The page's two (2026-09-18, S1). The refusal has a row of its own because a
  // cap reports what it refused where the owner will see it (owner ruling 2's
  // corollary): the 196 refused asks sat in the events table unseen.
  "self.page.revised": "the written self page was amended (who wrote it, why, how big, and which version it produced)",
  "self.page.refused": "a write to the self page was turned away (empty, past the hard limit, stopped by the gate battery, carrying the wake's own markers, or naming a version the page has moved past)",
  // The nightly writer's own row (2026-09-20, S2). It is a row per ATTEMPT, not
  // per revision: the page's row says what changed, and this one says whether
  // the night ran at all, in which mode, and what it came to — including the
  // day it read and had nothing to say about, which is an answer and not a
  // silence.
  "self.page.writer.ran": "the nightly page writer ran (which day it read, in which mode, how many memories it was handed, and whether it revised the page, had nothing to say, was refused or failed)",
  // The handoff's four (2026-09-20, E1). Written and shown are separate rows
  // for scar §2.3's reason, one lane along: "we wrote one" is not "a session
  // was handed one", and a pointer that stops being delivered is exactly the
  // failure a single row would hide.
  "handoff.written": "a session left a handoff for the next one in that directory — one per session there (how big, which version, and how long it will show)",
  "handoff.shown": "a session opening in that directory was handed the pointer to a handoff there (how old it was, what it cost the wake, and how many were live beside it)",
  "handoff.cleared": "a session finished the work in a directory and retired a handoff there — its own, or another's by id — while any others stand (how big the retired one was, and which version)",
  "handoff.refused": "a handoff was turned away (past the hard limit, stopped by the gate battery, carrying the wake's own markers, written where no directory was named, sent as something other than text, sent from a Claude Desktop call that named no session, retiring an id that is not a handoff here, or — with `no-room` — composed before the wake had room reserved for its pointer)",
  // Durable since 2026-10-01: it was a ring event, gone with the hook, and
  // the wake bar could not say a session start went without it.
  "handoff.lasthere.noroom": "a session start had no room for the \"Last here\" line naming the chapter last written in that directory (the bundle's bytes, the ceiling, and whether a handoff was carried in its place)",
  // Durable since 2026-10-02: "Work here" had more lines than the wake carried.
  "self.work.overflow": "a session start had more \"Work here\" lines for its directory than it carried — more than the wake shows, so they rotate, or fewer fitted the room (how many, how many shown)",
  "recall.credit": "a boundary decided which memories the replies actually used, and credited them",
  // Learned association had no line in the log at all: an edge is its own
  // record, so a flush that never happened read exactly like a credit pass with
  // nothing to wire (2026-09-17, mechanism inventory §3 S3).
  "associate.flush": "the boundary's worker wired together the memories its sessions credited together (passes carried, pairs, edge rows written, evictions)",
  // The daily rotating snapshot (2026-09-18). Until it existed, a backup that
  // had run and one that never had were the same silence.
  "snapshot.taken": "a copy of the whole store was made and kept (which one, how many files, how many are kept, the oldest)",
  "snapshot.failed": "a copy could not be made (which step, and why) — the store is unharmed, and the worker carried on",
  "snapshot.rotated": "old copies were let go so the newest 14 remain (which ones went, and how many are left)",
  // Remembering to act (2026-09-20, E2), in two names so a refusal can never be
  // counted as a firing.
  "prospective.fire": "a future date arrived and the reminder was offered into the turn (which window, and how much of its budget is left)",
  "prospective.fire.refused": "a reminder was NOT offered (which brake held — one row per window per reason per lived day)",
  "prospective.plain": "a reminder its author marked plain was told to the person on its day (which window, which beat — its day, a month or range opening, or its last day — and the date)",
  // The journal's markdown copy and the hand export (2026-09-20, F6 and F7):
  // the two places the constitution's "prose the owner can view" is kept now
  // that every body is a column.
  "journal.copy.written": "a chapter's markdown copy was written beside the store, so the diary is readable in any editor (which episode, which file, how big)",
  "journal.copy.failed": "a chapter's markdown copy could not be written (which episode, and the reason code) — the chapter itself is safe in the database",
  "store.export": "the owner exported the store by hand (which kind of export, how many rows went, how many confidential ones were left out)",
  // Raw-transcript retention (2026-09-23, B3). One row per date; `STARTED` goes
  // in when the pass takes its latch and `LATCH_HELD` when a later worker finds
  // the latch taken with no row, so a pass that died is never a silence.
  "remember.prune": "the week-old raw transcript of sessions that owe nothing was deleted (sessions deleted, kept because they still owe a write-up, kept because they are under a week old or still open, and any that failed — or STARTED / LATCH_HELD for a pass that has not finished)",
  // The vector cache's identity check (2026-09-23, #190). Written only when an
  // open CHANGED something — never for a match — so a quiet week is no rows.
  "store.embedder.reconciled": "an open changed which model the stored vectors are filed under (reset to a new table and refilled, a paid model's vectors held until somebody chooses, a hold released, untagged vectors adopted, a decision deferred, or vectors dropped by a rebuild)",
  // Dreaming (2026-09-26). Five rows, each ids and counts only: the journal's
  // words live in the `dreams` table, never in the log.
  "dream.begun": "a dream began: the dreamer was shown what was lived since the last one (how many new memories, how many shown in all, how many chapters)",
  "dream.changed": "a dream changed memories (how many changes landed and were refused, by kind: merges, links, replays, gists, contradictions, feelings, nominations)",
  "dream.journaled": "a dream ended with its journal entry written (how long, and what it changed)",
  "dream.undone": "the owner reversed a whole dream (how many of its changes were put back)",
  "dream.ask": "the day's dream line started the nightly run or asked first (or again, for a run cut off), the owner said not today, or the dreaming setting changed",
  // The owner's door out of the core (2026-09-26).
  "band.demoted": "the owner sent a core memory back to ordinary fading (and why is kept beside it)",
  // The v8 upgrade's one-time proof (2026-09-26).
  "physics.upgrade.census": "after the v8 upgrade, every memory was measured by the old arithmetic and the new (how many moved a band, down or up, and how many would be let go sooner or later)",
  // Contradictions (2026-09-29). Ids and counts only; the why is on the pair's trail.
  "contradiction.flagged": "two memories that disagree were flagged as a pair, unsettled (by a dream, today)",
  "contradiction.settled": "a pair of memories that disagree was settled — changed, corrected or open — and by whom (a session, a dream, a reflection, the page writer or the owner)",
  "contradiction.undone": "a settle was undone: strength put back, a corrected memory back in recall, the pair unsettled again",
  // The update guard (2026-10-09). Ids, the reading and its numbers; no text.
  "contradiction.held": "a new memory said it changed or corrected one that looked unrelated to it, so the old one was left as it was and the two were not linked (the writer was shown it and asked to settle it if it meant to)",
  // What is not written up (2026-09-30). Ids and counts only; one row per stretch per state.
  "coverage.owed": "a session left a stretch that is not written up — three pieces or more over a quarter of an hour — and is no longer at work, so it owes a write-up (how many pieces, over how long)",
  "coverage.written": "a stretch of a session was written up (how many pieces, and by whom: the session itself, a \"nothing new\", a chapter, or the next session)",
  "coverage.lapsed": "an owed stretch nobody wrote up while it was owed was let go — lost to memory; nothing deleted, its text goes on the ordinary week",
} as const satisfies Record<DurableEventName, string>;

export const DURABLE_EVENT_NAMES: readonly DurableEventName[] = Object.keys(
  DURABLE_EVENTS,
) as DurableEventName[];

/**
 * What one axis reports. `absent` is a fact about the axis, not a formatting
 * hint: the renderer prints the absence marker when it is true, and the test
 * asserts the pairing (a nonzero axis marked absent is a bug either way).
 */
export interface AxisCount {
  readonly axis: string;
  readonly count: number;
  readonly absent: boolean;
}

export function countBy<T extends string>(
  registry: readonly T[],
  counts: ReadonlyMap<T, number>,
): AxisCount[] {
  return registry.map((axis) => {
    const count = counts.get(axis) ?? 0;
    return { axis, count, absent: count === 0 };
  });
}
