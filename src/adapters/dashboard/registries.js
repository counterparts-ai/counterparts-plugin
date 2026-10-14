import { TUNABLES as PHYSICS } from "../../core/physics/index.js";
import { PHASES } from "../../core/sleep/index.js";
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
  WRITE_UP_FAILED_EVENT
} from "../../core/counterpart.js";
import { BAND_TRANSITION_EVENT } from "../../core/sleep/index.js";
import {
  PROSPECTIVE_FIRE_EVENT,
  PROSPECTIVE_PLAIN_EVENT,
  PROSPECTIVE_REFUSED_EVENT
} from "../../core/prospective/index.js";
import {
  JOURNAL_COPY_FAILED_EVENT,
  JOURNAL_COPY_WRITTEN_EVENT,
  SELF_PAGE_REFUSED_EVENT,
  SELF_PAGE_REVISED_EVENT,
  SELF_PAGE_WRITER_EVENT,
  WORK_OVERFLOW_EVENT
} from "../../core/self/index.js";
import {
  HANDOFF_CLEARED_EVENT,
  HANDOFF_REFUSED_EVENT,
  HANDOFF_SHOWN_EVENT,
  HANDOFF_WRITTEN_EVENT
} from "../../core/handoff/index.js";
import { LAST_HERE_NOROOM_EVENT } from "../../core/handoff/last-here.js";
import { RETENTION_EVENT } from "../../core/remember/index.js";
import { EMBEDDER_RECONCILED_EVENT } from "../../core/store/index.js";
import {
  DREAM_ASK_EVENT,
  DREAM_BEGUN_EVENT,
  DREAM_CHANGED_EVENT,
  DREAM_JOURNALED_EVENT,
  DREAM_UNDONE_EVENT
} from "../../core/dream/index.js";
import { V8_CENSUS_EVENT } from "../../core/sleep/index.js";
import {
  CONTRADICTION_FLAGGED_EVENT,
  CONTRADICTION_HELD_EVENT,
  CONTRADICTION_PROPOSED_EVENT,
  CONTRADICTION_SETTLED_EVENT,
  CONTRADICTION_UNDONE_EVENT
} from "../../core/reconsolidation.js";
import { COVERAGE_LAPSED_EVENT, COVERAGE_OWED_EVENT, COVERAGE_WRITTEN_EVENT } from "../../core/coverage/index.js";
const BAND_ORDER = {
  episodic: 0,
  semantic: 1,
  identity: 2
};
export const BANDS = Object.keys(BAND_ORDER).sort((a, b) => BAND_ORDER[a] - BAND_ORDER[b]);
export const KINDS = Object.keys(PHYSICS.KINDS);
export const CYCLE_PHASES = PHASES;
export const DURABLE_EVENTS = {
  "adapter.ask": "the Stop ask was evaluated (asked, paced out, or capped for the day)",
  "adapter.authorship.ask": "HISTORICAL: the authorship half of the old two-ask Stop",
  "adapter.boundary": "a session-ending path reached the boundary (spans captured, cursor moved)",
  "adapter.embed.backfill": "the worker gave vectors to memories that had none (embedded, remaining, failed)",
  "adapter.semantic.lag": "the worker left next turn's semantic cue (or named why it could not)",
  "adapter.runner.failed": "the detached worker failed after opening the store (which step, and the code)",
  "adapter.hook.claim.lost": "two Counterparts wirings ran one event and this hook found it already claimed, so it delivered nothing (which hook, which side gave way)",
  "adapter.writeup.failed": "a session start could not compose the pointer to an earlier session's write-up (the code) — that session was not offered its write-up this time",
  "remember.capture.failed": "a turn's words could not be kept for its write-up (which step of the capture, and the code) — the next boundary reads the same turns again",
  "adapter.spawn.failed": "the detached worker could not be started at all (the OS said why)",
  "adapter.spawn.refused": "the detached worker was not started, by name (and how many times running)",
  "adapter.spawn.started": "the detached worker DID start, at least once today (one row per date, with the day's count)",
  "mcp.recall": "the session went looking for a memory on purpose (what kind of ask, how much came back, and every verdict that kept something out)",
  "mcp.part": "a later part of a dream's or a reflection's bundle was handed over (which part of how many, and its size)",
  "mcp.result.oversize": "a tool result came to more than the host shows in one answer, and was cut to fit with a note saying so",
  "mcp.result.spilled": "the host showed one of the nightly run's tool results only as a short preview, so the run read part of it (found in the run's own transcript)",
  "adapter.envelope.overcap": "a hook's output was past the host's 10,000-character cap even in plain form, so the host showed only a preview of it",
  "adapter.notice.dropped": "the notice meant for you was dropped from a session start so the rest of the envelope stayed under the host's cap",
  "adapter.envelope.gave-way": "a part of a delivery waited for want of room — the write-up pointer, the scope question, the turn's recall, a reminder, the dream offer or the update notice (which hook, which part)",
  "adapter.injection.overbudget": "a session start sent more than the ceiling the host reported (what it sent, and the ceiling)",
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
  "memory.unmerged": "you put back a row a merge had archived (repair-merged-beliefs)",
  "recall.decision": "a turn decided what came to mind (and what stayed quiet)",
  "revision.pressure": "a belief or an identity element took a credited challenge",
  "sweep.gate": "the crash fallback ran its gate (scopes looked at, every scope's refusal counted by reason, spans swept)",
  "sweep.wake": "the crash fallback was woken as me before it read a transcript (whether a self went, its size, what the cap trimmed, what was held back)",
  "sleep.cycle": "the consolidation cycle ran (every phase by name, with its status, and the run's counts)",
  "self.briefing": "the wake briefing was re-rendered (what rendered per lane, and which elements the trim dropped)",
  "self.page.revised": "the written self page was amended (who wrote it, why, how big, and which version it produced)",
  "self.page.refused": "a write to the self page was turned away (empty, past the hard limit, stopped by the gate battery, carrying the wake's own markers, or naming a version the page has moved past)",
  "self.page.writer.ran": "the nightly page writer ran (which day it read, in which mode, how many memories it was handed, and whether it revised the page, had nothing to say, was refused or failed)",
  "handoff.written": "a session left a handoff for the next one in that project — one per session there (how big, which version, and how long it will show)",
  "handoff.shown": "a session opening in that project was handed the pointer to a handoff there (how old it was, what it cost the wake, and how many were live beside it)",
  "handoff.cleared": "a session finished the work in a project and retired a handoff there — its own, or another's by id — while any others stand (how big the retired one was, and which version)",
  "handoff.refused": "a handoff was turned away (past the hard limit, stopped by the gate battery, carrying the wake's own markers, written where no project was named, sent as something other than text, sent from a Claude Desktop call that named no session, retiring an id that is not a handoff here, or — with `no-room` — composed before the wake had room reserved for its pointer)",
  "handoff.lasthere.noroom": `a session start had no room for the "Last here" line naming the chapter last written in that project (the bundle's bytes, the ceiling, and whether a handoff was carried in its place)`,
  "self.work.overflow": 'a session start had more "Work here" lines for its project than it carried — more than the wake shows, so they rotate, or fewer fitted the room (how many, how many shown)',
  "recall.credit": "a boundary decided which memories the replies actually used, and credited them",
  "associate.flush": "the boundary's worker wired together the memories its sessions credited together (passes carried, pairs, edge rows written, evictions)",
  "snapshot.taken": "a copy of the whole store was made and kept (which one, how many files, how many are kept, the oldest)",
  "snapshot.failed": "a copy could not be made (which step, and why) — the store is unharmed, and the worker carried on",
  "snapshot.rotated": "old copies were let go so the newest 14 remain (which ones went, and how many are left)",
  "prospective.fire": "a future date arrived and the reminder was offered into the turn (which window, and how much of its budget is left)",
  "prospective.fire.refused": "a reminder was NOT offered (which brake held — one row per window per reason per day of use)",
  "prospective.plain": "a reminder its author marked plain was told to the person on its day (which window, which beat — its day, a month or range opening, or its last day — and the date; `late` when a day passed untold was told within its week after)",
  "journal.copy.written": "a chapter's markdown copy was written beside the store, so the diary is readable in any editor (which episode, which file, how big)",
  "journal.copy.failed": "a chapter's markdown copy could not be written (which episode, and the reason code) — the chapter itself is safe in the database",
  "store.export": "you exported the store by hand (which kind of export, how many rows went, how many confidential ones were left out)",
  "remember.prune": "the week-old raw transcript of sessions that owe nothing was deleted (sessions deleted, kept because they still owe a write-up, kept because they are under a week old or still open, and any that failed — or STARTED / LATCH_HELD for a pass that has not finished)",
  "store.embedder.reconciled": "an open changed which model the stored vectors are filed under (reset to a new table and refilled, a paid model's vectors held until somebody chooses, a hold released, untagged vectors adopted, a decision deferred, or vectors dropped by a rebuild)",
  "dream.begun": "a dream began: the dreamer was shown what was lived since the last one (how many new memories, how many shown in all, how many chapters)",
  "dream.changed": "a dream changed memories (how many changes landed and were refused, by kind: merges, links, replays, gists, contradictions, feelings, nominations)",
  "dream.journaled": "a dream ended with its journal entry written (how long, and what it changed)",
  "dream.undone": "you reversed a whole dream (how many of its changes were put back)",
  "dream.ask": "the day's dream line started the nightly run or asked first (or again, for a run cut off), you said not today, or the dreaming setting changed",
  "band.demoted": "you sent a core memory back to ordinary fading (and why is kept beside it)",
  "physics.upgrade.census": "after the v8 upgrade, every memory was measured by the old arithmetic and the new (how many moved a band, down or up, and how many would be let go sooner or later)",
  "contradiction.flagged": "two memories that disagree were flagged as a pair, unsettled (by a dream, today)",
  "contradiction.settled": "a pair of memories that disagree was settled — changed, corrected or open — and by whom (a session, a dream, a reflection, the page writer or you)",
  "contradiction.undone": "a settle was undone: strength put back, a corrected memory back in recall, the pair unsettled again",
  "contradiction.held": "a new memory said it changed or corrected one that looked unrelated to it, so the old one was left as it was and the two were not linked (the writer was shown it and asked to settle it if it meant to)",
  "contradiction.proposed": "a new memory read as the newer state of the same thing as an older one (status moved on, or very close in meaning), so the older was marked possibly out of date and faded a little, until the writer or the dream confirms it or says they are two things",
  "coverage.owed": "a session left a stretch that is not written up — three pieces or more over a quarter of an hour — and is no longer at work, so it owes a write-up (how many pieces, over how long)",
  "coverage.written": 'a stretch of a session was written up (how many pieces, and by whom: the session itself, a "nothing new", a chapter, or the next session)',
  "coverage.lapsed": "an owed stretch nobody wrote up while it was owed was let go — lost to memory; nothing deleted, its text goes on the ordinary week"
};
export const DURABLE_EVENT_NAMES = Object.keys(DURABLE_EVENTS);
export function countBy(registry, counts) {
  return registry.map((axis) => {
    const count = counts.get(axis) ?? 0;
    return { axis, count, absent: count === 0 };
  });
}
