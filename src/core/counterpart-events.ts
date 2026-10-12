/** The composition root's event names, their field lists, and the builders of the records it files under them (moved out of `counterpart.ts`, 2026-10-11). */
import { TERMINAL_ARCHIVE_LATCHES } from "./associate/index.js";
import type { CandidateVerdict, RecallDecision } from "./recall/index.js";
import type { ProposalSource } from "./remember/index.js";
import type {
  EncodeResult,
  GateRecord,
  ChannelRecord,
  SecretsGateRecord,
  PrecisionGateRecord,
  AliasGateRecord,
  EmotionGateRecord,
  FloorGateRecord,
} from "./encode/index.js";
import type { Phase } from "./sleep/index.js";
import type { Kind } from "./types.js";
import type { CounterpartEvent } from "./counterpart-types.js";

/** The durable per-chunk gate record (dashboard registry imports this literal). */
export const GATE_CHUNK_EVENT = "gate.chunk";

/**
 * The gate record's field list, in order — one of the three components of the
 * parallel run's machine-scored surface set (CONTRACT §5 G12: the surfacing
 * decision's fields PLUS the gate-record and band-transition fields). Pinned by
 * `satisfies` on the record literal below so the list cannot drift from the row.
 */
export const GATE_CHUNK_FIELDS = [
  "chunkKey", "index", "scope", "session", "day", "proposals", "accepted", "refused",
  "fullyGated", "effects", "blind", "shown", "shownIds", "shownLexicalOnly",
  "shownSemanticOnly", "shownBoth", "candidates", "semanticState", "semanticReason",
  "channels", "fires", "refusals", "refusalsByReason", "novelty", "noveltyReason",
] as const;

export type GateChunkField = (typeof GATE_CHUNK_FIELDS)[number];

/**
 * THE AUTHORED DOOR'S GATE RECORD — `gate.chunk`'s twin, one row per deposit
 * that reached the battery (replay INTERFACE-GAPS §2a).
 *
 * The sweep path has recorded its gate since 2026-08-25 because it gates text
 * nobody was watching. The authored path recorded nothing, on the argument that
 * it is gated in front of the person who asked — but the person who asked is not
 * there a week later when the question is "what did the battery refuse, and
 * which gate did it", and `remember/`'s verdict seam flattened the answer to a
 * first reason and a gate name before anyone could write it down. Half of
 * `gate.refusalMix` was therefore uncomputable from a replayed store, and the
 * dashboard's ENCODE node had to say, in its own words, that most of what the
 * battery did left no record (`web/flow.ts` `UNLOGGED_PATH`).
 *
 * SAME RULES AS `gate.chunk`, all of them. Content by reference only: gate
 * names, closed-vocabulary statuses and reasons, counts, secret FAMILIES, a hash
 * of the REDACTED text. No draft text, no alias, no quote, no secret, no hash of
 * one (store §5 G10, scar §2.20).
 */
export const GATE_DEPOSIT_EVENT = "gate.deposit";

/**
 * The authored gate record's field list, in order — the fourth component of the
 * parallel run's machine-scored surface set, pinned the same way the other three
 * are (`satisfies` on the record literal in `gateDepositRecord`).
 *
 * WHAT IS DELIBERATELY NOT HERE, so the omissions are read as decisions:
 *
 *  - **`novelty`.** `bridge.batteryGate` refuses before it embeds — nothing
 *    refused is ever sent to a vector provider — so the refusal arm could only
 *    ever carry a null, and a permanent null that means "never asked" sitting
 *    beside an accept arm's null that means "asked, no vector" is exactly the
 *    conflation scar §2.4 is about. The accepted proposal's novelty is on the
 *    memory row already; a second copy here would buy nothing and blur that.
 *  - **`shownIds` / the channel split.** The authored door runs no preselection
 *    at all, so there is nothing to split. `preselection: "not-run"` says that
 *    out loud rather than reporting a zero that reads as "selected, found none".
 */
export const GATE_DEPOSIT_FIELDS = [
  "source", "session", "scope", "day", "proposals", "accepted", "refused",
  "memoryId", "contentHash", "kind", "gates", "fires", "refusalsByReason",
  "blockedBy", "secretFamilies", "hedges", "aliasesDeclared", "aliasesKept",
  "aliasesDropped", "feelingExemption", "quoteStripped",
  "floorChars", "floorWords", "preselection", "preselectionReason", "shown",
  "channels",
] as const;

export type GateDepositField = (typeof GATE_DEPOSIT_FIELDS)[number];

/** The durable per-turn surfacing record (same registry, same rule). */
export const RECALL_DECISION_EVENT = "recall.decision";

/**
 * THE SWEEP GATE'S OWN RECORD — one row per `sweepFallback()` call, whether the
 * sweep read anything or nothing.
 *
 * The sweep is now a crash fallback in fact and not only in the CONTRACT
 * (`remember/fallback.ts`, owner ruling 2026-09-04), which means its ordinary
 * state is SILENCE. Silence must never masquerade as health (constitution 16):
 * without this row, "no sweeps today" is indistinguishable from a worker that
 * never started, a credential that never loaded, or a gate that refuses
 * everything. So the run says how many scopes it looked at, how many held a
 * crashed session, how many it skipped for `NO_CRASHED_SESSION`, and what it
 * swept and minted when it did run.
 *
 * SINCE 2026-09-14 (G48) THE ROW IS TOTAL BY REASON: `refusals` counts every
 * report by its `SweepReason`, zeros included, `SWEPT` included. The first cut
 * had one bucket for everything that was not `NO_CRASHED_SESSION` and a comment
 * claiming a nonzero bucket was a bad day — which the live run disproved by
 * reading 5–7 on every single day: a session stays in the crashed set after it
 * is swept and retired, so its scope answers `NOTHING_TO_SWEEP` forever.
 * `remember/fallback.ts#QUIET_SWEEP_REASONS` is the division that replaces the
 * claim; `noisyRefusals` sums the reasons worth an alarm on the FIRST one
 * (`NOISY_NOW_SWEEP_REASONS`), and `chronicCandidates` counts the one that is
 * only worth reading if it repeats (`BELOW_MIN_CLAIM`, permanent by
 * construction once a small crashed leftover exists).
 */
export const SWEEP_GATE_EVENT = "sweep.gate";

/**
 * ONE durable row per sweep run saying whether the fallback interpreter was
 * WOKEN AS THE SELF before it read anything (owner ruling 2026-09-17).
 *
 * It is its own row rather than a field on `sweep.gate` because it answers a
 * different question — "did this mechanism fire", constitution 11's `done means
 * seen firing`.
 *
 * **`included` MEANS A PROMPT ACTUALLY CARRIED IT.** The ordinary day is
 * "nothing crashed": not one chunk is read, so nothing is composed at all and
 * the row says `not-reached` with every measure at zero. A row saying
 * `included: true` on that day would be the silence-as-activity failure this log
 * exists to prevent (scar §2.4), so the row is written AFTER the run and
 * `chunks` is on it.
 *
 * CONTENT-FREE, and that is structural: the wake is the self in its own words,
 * and a telemetry row is not a place to keep a second copy of it. `included`,
 * `reason`, `chunks`, `bytes`, `cap`, `elements`, `trimmed`, `omitted` — counts,
 * a flag and a name. A reader can tell the mechanism fired, how much of the self
 * went, and whether the cap cut anything; it cannot read one line of the self
 * from here. `bytes` is the SELF's bytes, not the block's: the fence and its
 * instructions add a fixed 683 bytes on top, per chunk. `omitted` is the
 * confidential/protected stand-aside, COUNTED rather than silent — a filter
 * nobody can see firing is a filter nobody can trust.
 */
export const SWEEP_WAKE_EVENT = "sweep.wake";

/**
 * THE CYCLE'S OWN RECORD — one row per `runCycle()` call at a boundary.
 *
 * `sleep/cycle.ts` emits `sleep.cycle.start`, `sleep.cycle.done`,
 * `sleep.phase.failed` and the rest into an in-process ring (`EVENT_RING`) that
 * dies with the worker, so from the store nobody could answer "did the cycle run
 * today, and did every phase succeed" (IMPROVEMENTS U9). Only the side effects
 * other modules record — `band.transition`, `memory.pruned` — proved it had run,
 * and a cycle whose every phase was skipped leaves none of those. Same lesson as
 * I32: every gate that can say no must leave a row where a later reader looks.
 *
 * One row, from the `CycleReport`: `reason` first and always, every phase by NAME
 * with the status and reason the report gave it, and the run's counts. Ids and
 * numbers; never text.
 *
 * UNLATCHED, like `sweep.gate`: no `dedupKey`, so two boundaries on one lived day
 * leave two rows — which is the truth, since the cycle really did run twice. The
 * rows age out with every other row in the log, at the store's 90-LIVED-DAY
 * window (`sleep/log.ts`, `Store.pruneEvents`).
 */
export const SLEEP_CYCLE_EVENT = "sleep.cycle";

/**
 * THE WAKE RENDER'S OWN RECORD — one row per briefing render at a boundary.
 *
 * The other half of U9: `self.briefing.trim` fires once per trimmed element and
 * `self.briefing.rendered` carries the lane counts, and both lived only in the
 * ring, so "what did the wake trim today, and what actually rendered" was not a
 * question the store could answer either. `self/` has no store handle and must
 * not grow one, so the row is written HERE, from what the cycle's render emitted.
 *
 * Lane counts for what RENDERED, ids-only for what was trimmed (capped at
 * `BRIEFING_TRIM_LOG_CAP`, with the full count beside it). Never briefing text.
 * Unlatched and 90-lived-day-pruned, exactly like `sleep.cycle` above.
 */
export const SELF_BRIEFING_EVENT = "self.briefing";

/**
 * The durable events an ADAPTER may write, and the whole list of them.
 *
 * A mild tension with constitution line 5 (the core knows nothing about any
 * particular host), taken deliberately and narrowly: the NAMES live here, beside
 * `GATE_CHUNK_EVENT`, because `adapters/dashboard/registries.ts` derives
 * `DurableEventName` from string literals and a `name: string` seam would
 * silently break the property that file exists to keep — a new durable event
 * fails `tsc` in the registry before it can go missing on screen. The core knows
 * two names; it knows nothing about what a hook, a primacy file or a parallel
 * run is.
 */
export const PRIMACY_STANDDOWN_EVENT = "adapter.primacy.standdown";

export const PRIMACY_DELIVER_EVENT = "adapter.primacy.deliver";

/**
 * The four DELIVERY records, durable for the same reason the primacy pair is:
 * during the parallel run they are the contamination detectors on v2's side
 * (CONTRACT §5 G4 — a muted v2 that injected a wake is a contaminated day), and
 * a detector that lives only in the hook process's ring cannot be counted out
 * of the store after the fact (§5 G2). Counts, bytes, reasons, flags; no text.
 */
export const WAKE_INJECTED_EVENT = "adapter.wake.injected";

export const WAKE_DELIVERED_EVENT = "adapter.wake.delivered";

export const RECALL_DELIVERED_EVENT = "adapter.recall";

/**
 * **HISTORICAL, readable, no longer written.** Until 2026-09-04 a Stop raised
 * TWO asks on two independent pacers — the episode ritual's and the authorship
 * ask's — and each left its own row. One evening of 13 owner turns drew about a
 * dozen asks between them, which is the whole reason `ADAPTER_ASK_EVENT` exists.
 * The names stay in the vocabulary so the instrument can still read the days
 * that were recorded under them; nothing writes them any more.
 */
export const EPISODE_ASK_EVENT = "adapter.episode.ask";

/** The boundary itself — every session-ending path leaves one, so a day whose
 *  sessions ended only through `session-end` / `pre-compact` (no `stop`, no
 *  primacy row) is still evidenced as having reached a boundary (parallel-run
 *  "what counts as a day"). Counts and cursors; never text. */
export const BOUNDARY_EVENT = "adapter.boundary";

/** **HISTORICAL, readable, no longer written** — the authorship ask's own row,
 *  from the fortnight it had its own pacer. See `EPISODE_ASK_EVENT` above. */
export const AUTHORSHIP_ASK_EVENT = "adapter.authorship.ask";

/**
 * THE ONE STOP ASK, and the one row it leaves. Durable because its PACING must
 * survive the hook process — the next Stop reads the last ask's substance out of
 * the store — and because "how many times were you asked today" is a claim about
 * a RUN, which an in-process ring cannot answer after the fact.
 *
 * Payload: `outcome` (asked | paced | capped), the verdict's own `reason`, the
 * chapter it named, the substance at the ask, and the coverage numbers. Counts
 * and reasons; never text.
 */
export const ADAPTER_ASK_EVENT = "adapter.ask";

/** The worker's embedding backfill, durable because a coverage watch that lives
 *  only in a detached process's stderr is a watch nobody can read tomorrow: how
 *  many memories got a vector this run, how many still lack one, how many
 *  failed (2026-09-04 — 40 authored notes, 224 episodes and 288 migrated
 *  memories had none, so the semantic channel was blind to all of them). */
export const EMBED_BACKFILL_EVENT = "adapter.embed.backfill";

/** The lagged semantic cue the worker computed for the next turn — off, refused,
 *  or stored with a hit count. Three records, never one silence (scar §2.4). */
export const SEMANTIC_LAG_EVENT = "adapter.semantic.lag";

/**
 * THE THREE SPAWN-SEAM RECORDS, durable since 2026-09-11 (I32).
 *
 * For a week the detached worker was refused at every boundary and NOTHING
 * durable said so: the refusal lived in the hook process's ring, and a hook
 * process lives for one turn. Every visible surface — wake, recall, capture,
 * the daily — read healthy while the clock, the sleep cycle and the ask cap
 * were all frozen. Scar §2.4 says a door that failed must not be indistinguishable
 * from a door nobody opened; these are that door's rows.
 *
 * They are the one durable family that carries a `dedupKey` (one row per reason
 * per calendar date), because a refusal that repeats at every boundary would
 * otherwise write the same line hundreds of times a day. The COUNT is not in the
 * row — it is the persisted per-reason counter the adapter keeps in box 2's meta
 * — so the row is evidence that it happened and the counter is evidence of how
 * often (adapter `NOTES.md`, I32).
 */
/**
 * One row per session-ending boundary: what reference resolution (recall §9.2)
 * decided and what physics did with it. `reason` is the split the daily's
 * readers use — `credited` / `nothing-to-credit` / `no-candidates` /
 * `budget-exceeded` / `failed` — so the `memory.reinforced` watch's fail → pass
 * is readable from the store, not inferred. Ids only, never body text.
 */
export const RECALL_CREDIT_EVENT = "recall.credit";

/**
 * ONE ROW PER APPLY OF CARRIED CO-ACTIVATION, written by the process that
 * applies it — the boundary's detached worker.
 *
 * Learned association was invisible in exactly the way scar §2.4 names. An edge
 * is its own record, so nothing in the log ever said a flush had happened — and
 * a flush that never happened looked identical to a credit pass that had nothing
 * to wire. The owner's store carried 430 edges, every one stamped with the
 * import's lived day, through 214 credit passes (mechanism inventory 2026-09-17
 * §3 S3), and no surface could tell that from a quiet graph.
 *
 * Counts and reasons, never text: how many claim files the run carried, how many
 * lines and pairs were in them, how many edge rows landed, how many were blocked
 * at the boundary or dropped by a failed publish, how many evictions it cost,
 * how old the oldest carried work was, and the lived day the rows were stamped
 * with. A run that carried nothing writes no row at all — the mechanism's
 * roll-call reads this name, and a daily row saying "nothing pending" would make
 * an idle graph read as a working one.
 *
 * Since 2026-09-28 the boundary's OWN flush writes one too, with the same
 * fields plus `source: "boundary"` and `contiguity` (what temporal contiguity
 * planned and buffered) — but only when it flushed something: the same rule.
 *
 * Since 2026-10-11 (for the sidebar mod, lightly held) both rows also name the
 * memories they wired together, bounded (`ids`, at most `ROW_IDS_MAX`, and
 * `idCount`; absent when nothing passed the re-check), and the `session` whose
 * boundary ran the flush when the caller said (`SessionEndInput.session`). That
 * is the APPLYING session: a carried claim can hold lines several sessions
 * credited, and the pending file does not say whose.
 */
export const ASSOCIATE_FLUSH_EVENT = "associate.flush";

/**
 * Where temporal contiguity has got to (2026-09-28): the newest `created_at`
 * its last pass read, and the ids written at exactly that moment, as JSON in
 * the `meta` table. A moment rather than a rowid, so a table rebuild by a
 * future migration cannot move it. Absent on a store no pass has run on: the
 * first pass links only the memories born on the current lived day — a new
 * store's first session, never an old store's whole history.
 */
export const CONTIGUITY_CURSOR_META = "associateContiguityCursor";

/** Meta key: the v12 subject backfill's record (latch + what it linked, for doctor). */
export const SUBJECTS_BACKFILL_META = "subjects.v12.backfill";

/** Meta key: the one-time carry of the links regrown chapter copies were left
 *  holding (2026-10-09) — its latch, and what it carried. */
export const REGROWN_RELINK_META = TERMINAL_ARCHIVE_LATCHES["episode-regrown"] as string;

/** Meta key: the one-time carry of the links `corrected` memories were left
 *  holding before the one door carried them (2026-10-11, Group 2b). */
export const CORRECTED_RELINK_META = TERMINAL_ARCHIVE_LATCHES["corrected"] as string;

export const SPAWN_REFUSED_EVENT = "adapter.spawn.refused";

export const SPAWN_FAILED_EVENT = "adapter.spawn.failed";

export const RUNNER_FAILED_EVENT = "adapter.runner.failed";

/**
 * A HOOK THAT FOUND ITS EVENT ALREADY TAKEN (2026-10-09): two wirings of
 * Counterparts are live in one host (the npm install's hooks and the
 * plugin's, any two builds), both fired, and this one lost the per-event
 * claim and delivered nothing. One row per suppressed duplicate — the hook,
 * the session, which side lost and which won; never a word of the prompt.
 * Written by `adapters/claude-code/claim.ts`; read by doctor's `Installed
 * twice` line.
 */
export const HOOK_CLAIM_LOST_EVENT = "adapter.hook.claim.lost";

/**
 * A WRITE-UP POINTER THAT COULD NOT BE COMPOSED (2026-09-30), durable because
 * "was this session ever offered its write-up" is a fact a later reading needs
 * and the ring that said so died with the SessionStart that failed.
 */
export const WRITE_UP_FAILED_EVENT = "adapter.writeup.failed";

/**
 * THE NIGHTLY RUN'S CATCH-UP (2026-10-01, build 3): one row per run that had
 * anything owed — how many sessions it was granted, how many it wrote up, how
 * many parts, and how many it left owed (the night's bound, or a session it
 * did not finish). Ids and counts only. Written by the night's own process
 * (`adapters/claude-code/night-run.ts`); read by doctor's Nightly and
 * Write-ups lines.
 */
export const NIGHT_WRITE_UP_EVENT = "adapter.night.writeup";

/**
 * A TURN'S CAPTURE THAT FAILED (2026-09-30): the span buffer would not take
 * the turn (`remember/spans.ts` — a failed write, or the outermost swallow).
 * Written by `captureSpans`, which is where a store is. Code and site, never
 * the words: `remember.capture.failed` and `remember.write.failed` are both
 * this one row, told apart by `site`.
 */
export const CAPTURE_FAILED_EVENT = "remember.capture.failed";

/**
 * THE WORKER THAT DID START (2026-09-20, E2).
 *
 * The three rows above prove a door that failed; none of them proves a door
 * that opened. So a worker dead all week and a week with nothing to do read
 * exactly alike (mechanism inventory §2 row 23), which is scar §2.4's silence
 * with the arms the other way round.
 *
 * LATCHED PER CALENDAR DATE, one row a day and no more. A boundary is a hot
 * path and a healthy machine reaches many of them; the fact worth keeping is
 * "the worker ran today", not three hundred copies of it. The row carries the
 * running count of starts the adapter has seen in this process, so a day's one
 * row still says the machine was busy, and the reason the spawn planner gave.
 */
export const SPAWN_STARTED_EVENT = "adapter.spawn.started";

/**
 * ONE ROW PER DELIBERATE RECALL (2026-09-20, E2).
 *
 * `docs/recall-surfacing-diagnosis-2026-09-18.md`: the whole MCP tool surface
 * wrote no durable row at all. `mcp/deliberate.ts` has run every time a session
 * went looking for something on purpose, and the only trace was an in-process
 * ring that died with the server — so "the session asked and nothing came back"
 * and "the session never asked" were the same silence, and the fired view could
 * only mark the mechanism blind.
 *
 * **Counts and reasons. NEVER the question, never a body.** The question is
 * the one field here that could carry somebody's private words (scar §2.20),
 * so its LENGTH is recorded and its text is not. `blockedBy` is the refusal
 * column — every verdict the deeper look did not admit, by name — which is what
 * makes "nothing came back" tell "there was nothing" from "it was all gated".
 *
 * IDS AND THE SESSION (2026-10-11, for the sidebar mod, lightly held): the row
 * now carries the ids it DELIVERED, bounded (`boundedIds`: at most
 * `ROW_IDS_MAX`, plus `idCount`), and the `session` it was served to when one
 * is known. It used to carry no ids, on the ground that pairing ids with the
 * moment they were asked for was a link the store need not hold — but
 * `recall.decision` has written the ids of every surfacing, with its session,
 * since E2, so the line was never the store's policy, and without the ids the
 * sidebar could not say what a look-up opened.
 *
 * NO `dedupKey`: a tool call is a deliberate act by a session, not a boundary
 * that repeats on a timer, and it is bounded by the host's own tool budget.
 */
export const MCP_RECALL_EVENT = "mcp.recall";

/**
 * WHAT REACHED THE MODEL, NOT WHAT RAN (2026-10-02). Two rows the MCP server
 * writes because a tool result the host would not show looked, from the
 * store, exactly like one it did: the night of 10-02 the dream's begin and
 * its part 2 went past Claude Code's ceiling (`fit/TOOL_RESULT_CEILING`), were
 * saved to a file the run could not open, and every count stayed green.
 *
 *   - `mcp.part` — one later part of a dream's or a reflection's bundle was
 *     handed through phase `part`: the mechanism, its run's id, which part of
 *     how many, and the characters it left as. With `parts` on `dream.begun`
 *     and on the reflection's row, doctor can say a part was never fetched.
 *   - `mcp.result.oversize` — a result came to more than the ceiling and the
 *     server cut it there, saying so in the result: the tool, the phase, what
 *     it measured and what it was cut to. Never the text.
 *
 * Ids and counts only; no `dedupKey` (each is a deliberate call).
 */
export const MCP_PART_EVENT = "mcp.part";

export const MCP_OVERSIZE_EVENT = "mcp.result.oversize";

/**
 * …AND WHAT THE HOST DID AFTER (2026-10-09, U14 item 3). The two rows above
 * are the server's view: what it handed, what it cut. Neither can see the host
 * cut a result the server sized under the ceiling — a remote flag can lower
 * Claude Code's line below it. The nightly run reads its own child's
 * output once the child exits (`claude-code/night-run.ts#readNightSpills`)
 * and writes one `mcp.result.spilled` row per result of ours the host showed
 * only as a preview: the run, the tool, the phase, the marker's shape and the
 * size the host said. Never the saved file's path, never the text. No
 * `dedupKey`: a run is read once.
 */
export const MCP_SPILLED_EVENT = "mcp.result.spilled";

/**
 * WHAT A DELIVERY COULD NOT CARRY (durable since 2026-10-02; ring-only
 * before, so doctor could not see a dropped session-start notice or hook
 * output past the host's 10,000-character cap):
 *
 *   - `adapter.envelope.overcap` — even the plain form was past the host's
 *     cap, so the host showed a preview (`bin/hook.ts#Delivery.overCap`);
 *   - `adapter.notice.dropped` — the owner's notice was dropped so the JSON
 *     envelope stayed under it, and the wake went plain;
 *   - `adapter.envelope.gave-way` — a part waited for want of room (the
 *     write-up pointer, the scope question, the turn's recall, a reminder,
 *     the dream offer, the update notice): which hook, which part;
 *   - `adapter.injection.overbudget` — a session start sent more than the
 *     ceiling the host reported.
 *
 * Counts and bytes only. One row per hook, part and session per lived day
 * (`Lifecycle#noteDeliveryWarning`'s `dedupKey`), so a long session that
 * gives way at every prompt writes one row, not hundreds.
 */
export const ENVELOPE_OVERCAP_EVENT = "adapter.envelope.overcap";

export const NOTICE_DROPPED_EVENT = "adapter.notice.dropped";

export const ENVELOPE_GAVE_WAY_EVENT = "adapter.envelope.gave-way";

export const INJECTION_OVERBUDGET_EVENT = "adapter.injection.overbudget";

export type DeliveryWarningName =
  | typeof ENVELOPE_OVERCAP_EVENT
  | typeof NOTICE_DROPPED_EVENT
  | typeof ENVELOPE_GAVE_WAY_EVENT
  | typeof INJECTION_OVERBUDGET_EVENT;

/**
 * WHICH CHECKOUT WAS LIVE AT THIS SESSION START (2026-09-14).
 *
 * The host invokes the hooks by absolute path, so whatever the install tree has
 * checked out is what runs against the owner's memory — a peer session's
 * unmerged branch sitting in that tree was live for seven minutes before anyone
 * noticed. One ids-only row per session start (`reason`, branch, short sha,
 * count of tracked modifications), latched per date+head+dirty+reason so a day on
 * master leaves ONE row and a day that wandered leaves one per state.
 *
 * Here for the same narrow reason the two spawn names are: the dashboard's
 * registries derive `DurableEventName` from these literals, so a durable event
 * whose name lived in the adapter would fail the registry's totality silently.
 * The core knows a string; it knows nothing about git.
 */
export const CHECKOUT_EVENT = "adapter.checkout";

/**
 * THE DAILY ROTATING SNAPSHOT (2026-09-18, owner ruling 3).
 *
 * Until this date a backup that had run and a backup that had never run were the
 * same silence — no row, no ring, no directory the system read back — which is
 * scar §2.4 on the one mechanism whose absence costs everything. Three names,
 * because three different things happen: a copy landed, a copy did not, and old
 * copies were let go. The third says WHAT went and HOW MANY remain, because it
 * is the only mechanism in this package that deletes.
 *
 * Here, beside the two spawn names and the checkout one, for the same narrow
 * reason they are: `dashboard/registries.ts` derives `DurableEventName` from
 * these literals, so a durable event whose name lived only in the adapter would
 * fail the registry's totality silently. The core knows a string; it knows
 * nothing about directories, rotation or `keep`.
 */
export const SNAPSHOT_TAKEN_EVENT = "snapshot.taken";

export const SNAPSHOT_FAILED_EVENT = "snapshot.failed";

export const SNAPSHOT_ROTATED_EVENT = "snapshot.rotated";

/**
 * THE HAND EXPORT (2026-09-20, F7).
 *
 * `counterparts export` is the one door memory leaves by, and until this name
 * existed an export that ran and an export that never did were the same silence
 * — the same §2.4 gap the snapshot row above closed for the automatic copy.
 * (The console `backup` command still has it; `fired.ts`'s `backup` row says so
 * in its own words, and this is not that name.)
 *
 * The payload is counts and flags: which kind of export, how many rows went,
 * how many confidential ones were left out, whether it was encrypted. **Not the
 * target path** — where the owner sent his memories is more than the row needs
 * to prove the door works (§5 G10).
 *
 * Here for the same narrow reason as the three above: `dashboard/registries.ts`
 * derives `DurableEventName` from these literals.
 */
export const STORE_EXPORT_EVENT = "store.export";

export type AdapterDurableEventName =
  | typeof PRIMACY_STANDDOWN_EVENT
  | typeof PRIMACY_DELIVER_EVENT
  | typeof WAKE_INJECTED_EVENT
  | typeof WAKE_DELIVERED_EVENT
  | typeof RECALL_DELIVERED_EVENT
  | typeof BOUNDARY_EVENT
  | typeof ADAPTER_ASK_EVENT
  | typeof EMBED_BACKFILL_EVENT
  | typeof SEMANTIC_LAG_EVENT
  | typeof SPAWN_REFUSED_EVENT
  | typeof SPAWN_FAILED_EVENT
  | typeof SPAWN_STARTED_EVENT
  | typeof RUNNER_FAILED_EVENT
  | typeof HOOK_CLAIM_LOST_EVENT
  | typeof WRITE_UP_FAILED_EVENT
  | typeof MCP_RECALL_EVENT
  | typeof MCP_PART_EVENT
  | typeof MCP_OVERSIZE_EVENT
  | typeof MCP_SPILLED_EVENT
  | DeliveryWarningName
  | typeof CHECKOUT_EVENT
  | typeof SNAPSHOT_TAKEN_EVENT
  | typeof SNAPSHOT_FAILED_EVENT
  | typeof SNAPSHOT_ROTATED_EVENT
  | typeof RECALL_CREDIT_EVENT;

/**
 * The names the two durable U9 rows are read out of, spelled once.
 *
 * They are `self/`'s event names, not new vocabulary: this root copies what the
 * render emitted and states no rule about it. `CLOCK_PHASE` is likewise a
 * `Phase`, so a phase `sleep/` renames fails `tsc` here rather than turning
 * `sleep.cycle`'s `reason` into a permanent `ran`.
 */
const RENDERED_EVENT = "self.briefing.rendered";

export const BRIEFING_PUBLISHED_EVENT = "self.briefing.published";

export const TRIM_EVENT = "self.briefing.trim";

export const TRIMMED_FIELD = "trimmed";

export const CLOCK_PHASE: Phase = "clock";

/** The render's own summary for this cycle, or null when it did not render. */
export function renderedEvent(events: readonly CounterpartEvent[]): CounterpartEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e !== undefined && e.name === RENDERED_EVENT) return e;
  }
  return null;
}

export function numberField(event: CounterpartEvent | null, key: string): number | null {
  const v = event?.data?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function stringField(event: CounterpartEvent, key: string): string | null {
  const v = event.data?.[key];
  return typeof v === "string" ? v : null;
}

/**
 * A counter map with its zeroes dropped, or null when nothing was counted.
 *
 * Every sleep phase pre-seeds its whole skip vocabulary with zeroes so that a
 * category can never go missing from the report; a durable row does not want
 * eight zeroes per phase per boundary. Null, not `{}`, so the field is absent
 * rather than empty — "nothing was turned away" reads better as no field than
 * as an empty object a reader has to interpret.
 */
export function nonzero(counts: Readonly<Record<string, number>>): Record<string, number> | null {
  const out: Record<string, number> = {};
  let any = false;
  for (const [reason, n] of Object.entries(counts)) {
    if (typeof n === "number" && n > 0) {
      out[reason] = n;
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * The chunk gate's own record, as it is PERSISTED (store `events`, SEAMS K).
 *
 * `encodeChunk` returns a full `EncodeResult`; before this existed the
 * composition root emitted five counts from it and let the rest go, which made
 * three of the replay harness's baselines structurally not-computable
 * (`gate.refusalMix`, `preselect.meanSchemasShown`, `preselect.channelMix` —
 * `tools/replay/INTERFACE-GAPS.md` §1). A metric that cannot be computed from a
 * replayed store is a metric the parallel run cannot check.
 *
 * CONTENT-BY-REFERENCE, ALL OF IT (store §5 G10): a chunk key, a scope, ids,
 * counts, gate names, closed-vocabulary reasons and states. No span text, no
 * proposal text, no alias, no quote, no secret and no hash of one.
 *
 * This function DERIVES NOTHING. `fires` counts the battery's own per-gate
 * events by name (`gate.<name>` — the battery decides what an acting gate is,
 * and it already writes one event per acting gate); the channel and preselection
 * fields are copied off `Preselection`. A rule about what counts as a fire would
 * be a rule with no home here.
 */
export function gateChunkRecord(
  result: EncodeResult,
  ctx: { chunkKey: string; index: number; scope: string; session: string },
): Record<string, unknown> {
  const pre = result.preselection;
  const fires: Record<string, number> = {};
  for (const e of result.events) {
    const parts = e.event.split(".");
    const gate = parts[0] === "gate" ? parts[1] : undefined;
    if (gate === undefined) continue;
    fires[gate] = (fires[gate] ?? 0) + 1;
  }
  const refusalsByReason: Record<string, number> = {};
  for (const r of result.refused) {
    refusalsByReason[r.reason] = (refusalsByReason[r.reason] ?? 0) + 1;
  }
  return {
    chunkKey: ctx.chunkKey,
    index: ctx.index,
    scope: ctx.scope,
    session: ctx.session,
    day: result.day,
    proposals: result.accepted.length + result.refused.length,
    accepted: result.accepted.length,
    refused: result.refused.length,
    fullyGated: result.fullyGated,
    effects: result.effects.length,
    blind: pre.blind,
    // What the author was shown, and through WHICH channel — §8 G4's overlap is
    // reported rather than hidden, so "did the semantic channel add anything?"
    // is a number instead of an argument.
    shown: pre.shown.length,
    shownIds: pre.shown.map((s) => s.id),
    shownLexicalOnly: pre.lexicalIds.filter((id) => !pre.semanticIds.includes(id)).length,
    shownSemanticOnly: pre.semanticOnlyIds.length,
    shownBoth: pre.overlapIds.length,
    candidates: pre.candidates,
    // "off" is silence, "skipped" is a failure, "ran" is a measurement — three
    // records a bare zero cannot tell apart (§5 G8, scar §2.4).
    semanticState: pre.semantic.state,
    semanticReason: pre.semantic.reason,
    channels: result.channels.map((c) => ({
      channel: c.channel,
      state: c.state,
      reason: c.reason,
    })),
    novelty: result.novelty.novelty,
    noveltyReason: result.novelty.reason,
    fires,
    refusalsByReason,
    refusals: result.refused.map((r) => ({
      ref: r.ref,
      kind: r.kind,
      reason: r.reason,
      blockedBy: [...r.blockedBy],
    })),
  };
}

/** Find one gate's record by name, typed. Absent means the battery did not run
 *  — never "the gate was clear" (the caller writes no row at all in that case). */
function recordFor<T extends GateRecord>(
  records: readonly GateRecord[],
  gate: T["gate"],
): T | undefined {
  return records.find((r) => r.gate === gate) as T | undefined;
}

/**
 * The authored door's gate outcome, as it is PERSISTED (store `events`, SEAMS K).
 *
 * Like `gateChunkRecord` above, this function DERIVES NOTHING. `fires` counts an
 * acting gate exactly the way the battery's own `gate.<name>` events do — status
 * neither `clear` nor `not-invoked` — because that is the same rule the sweep
 * record already counts by, and `gate.refusalMix` sums the two sides together.
 * Everything else is copied off the records `remember/`'s verdict relayed.
 *
 * `refusalsByReason` is keyed on the SAME closed vocabulary `gate.chunk` uses
 * (`RefusalReason`), so a mix computed over both record kinds is a mix over one
 * vocabulary rather than a union of two.
 */
export function gateDepositRecord(
  records: readonly GateRecord[],
  channels: readonly ChannelRecord[],
  ctx: {
    source: ProposalSource;
    session: string;
    scope: string;
    day: number;
    accepted: boolean;
    memoryId: string | null;
    kind: Kind;
    blockedBy: readonly string[];
  },
): Record<GateDepositField, unknown> {
  const secrets = recordFor<SecretsGateRecord>(records, "secrets");
  const precision = recordFor<PrecisionGateRecord>(records, "precision");
  const aliases = recordFor<AliasGateRecord>(records, "aliases");
  const emotion = recordFor<EmotionGateRecord>(records, "emotion");
  const floor = recordFor<FloorGateRecord>(records, "floor");

  const fires: Record<string, number> = {};
  for (const r of records) {
    if (r.status === "clear" || r.status === "not-invoked") continue;
    fires[r.gate] = (fires[r.gate] ?? 0) + 1;
  }
  // THE FIRST blocking reason, counted ONCE — the same rule `gateChunkRecord`
  // uses (`refusalsByReason[r.reason]`, where `RefusedProposal.reason` is
  // `blockedBy[0]`). Counting every entry instead would make one refusal with
  // two reasons weigh two, and a reader summing this map across the two record
  // kinds would get a silently wrong number for the door that happens to refuse
  // on two gates at once. The whole list is in `blockedBy` beside it.
  const refusalsByReason: Record<string, number> = {};
  const firstBlock = ctx.blockedBy[0];
  if (firstBlock !== undefined) refusalsByReason[firstBlock] = 1;

  return {
    source: ctx.source,
    session: ctx.session,
    scope: ctx.scope,
    day: ctx.day,
    // Counted the way `gate.chunk` counts, because a chunk of one is what a
    // deposit is: a reader summing refusals across both kinds needs one shape.
    proposals: 1,
    accepted: ctx.accepted ? 1 : 0,
    refused: ctx.accepted ? 0 : 1,
    /** The minted id when there is one — an address, never the text. Null on
     *  the refuse arm, where no memory exists, and ALSO null when the gate was
     *  clean but the ledger write failed (`accepted: 1, memoryId: null`). */
    memoryId: ctx.memoryId,
    /** Hash of the REDACTED text, from the secrets gate itself (§5 G10). */
    contentHash: secrets?.contentHash ?? null,
    kind: ctx.kind,
    // THE PER-GATE STATUSES — the thing §2a said could not cross back.
    gates: records.map((r) => ({
      gate: r.gate,
      status: r.status,
      reason: r.reason,
      ablatable: r.ablatable,
    })),
    fires,
    refusalsByReason,
    blockedBy: [...ctx.blockedBy],
    // FAMILY AND COUNT AND SITE. Never the credential, and never a hash of one:
    // hashing a low-entropy secret is reversible (store §16 G9).
    secretFamilies: (secrets?.findings ?? []).map((f) => ({
      family: f.family,
      count: f.count,
      site: f.site,
    })),
    hedges: (precision?.hedges ?? []).map((h) => ({ kind: h.kind, count: h.count })),
    aliasesDeclared: aliases?.declared ?? 0,
    aliasesKept: aliases?.kept ?? 0,
    // By POSITION and reason. An alias is author text, so it is never logged.
    aliasesDropped: (aliases?.dropped ?? []).map((d) => ({ index: d.index, reason: d.reason })),
    // NO `feelingType` HERE, and the omission is the whole point.
    //
    // `EmotionGateRecord.type` is the author's declared feeling word, and the
    // first draft of this record copied it on the belief that a feeling type is
    // a closed vocabulary. IT IS NOT: `encode/emotion.ts` says so in as many
    // words — "the type and subject are the only things that become durable, and
    // both are author-supplied text" — and it is scanned for SECRETS on the way
    // out, not constrained to a word list. So a refused jot, which mints nothing
    // and leaves no prose behind, was putting a free-text field of the author's
    // into the durable log: `{feeling: "the merger with Acme closes Friday"}`
    // survived verbatim, in a table nothing chases on removal. That is scar
    // §2.20 and store §5 G10, through a door that had never been open before,
    // and on the ONE path where the memory itself does not exist.
    //
    // The gate's own verdict is the closed vocabulary, and it is already in this
    // record: `gates[]` carries `reason`, which for the emotion gate is
    // `EmotionVerdict` — `no-feeling-declared`, `quote-not-in-span`,
    // `accepted-by-exemption` and friends. That is what a mix wants; the word
    // the author typed is not.
    feelingExemption: emotion?.exemption ?? false,
    quoteStripped: emotion?.quoteStripped ?? false,
    floorChars: floor?.chars ?? null,
    floorWords: floor?.words ?? null,
    // NOT A ZERO. The authored door shows the author no schema cards at all, so
    // "0 shown" would read as a preselection that ran and selected nothing.
    preselection: "not-run",
    preselectionReason: "authored-door-shows-no-schema-cards",
    shown: null,
    channels: channels.map((c) => ({ channel: c.channel, state: c.state, reason: c.reason })),
  } satisfies Record<GateDepositField, unknown>;
}

/**
 * THE SURFACE SET'S SCHEMA — the ordered field list of the durable per-turn
 * record, in the order `recallDecisionRecord` writes it.
 *
 * `tools/parallel` hashes the surface set to decide whether a human rating
 * carries across a code change (§5 G12's "provably identical"), and a hash is
 * only as trustworthy as the agreement about WHAT was hashed. So the field names
 * are exported rather than restated at the reader: a field added on one side and
 * not the other is a silently different hash, which is the carry-forward rule
 * failing in the direction that laminates a stale verdict.
 *
 * Exhaustive BY TYPE, the way the dashboard's registries are: the record literal
 * below is `satisfies Record<SurfaceSetField, unknown>`, so a field added to the
 * record and not to this list — or listed and not written — fails `tsc` here.
 */
export const RECALL_DECISION_FIELDS = [
  "session",
  "turn",
  "day",
  "date",
  "reason",
  "observer",
  "budgetBytes",
  "bytes",
  "surfacedCount",
  "footnoteCount",
  "affectFlag",
  "affectReason",
  // Emotion part A (2026-09-26): admitted memories the current mood lifted.
  "moodMatched",
  "sentinelRendered",
  "surfaced",
  "footnotes",
  "elapsedMs",
  "aborted",
  // Association build 1 (2026-09-28): what spreading did, and the cut's count.
  "spread",
  "dropped",
  // Group 4 (2026-10-11): shown memories a link put there (pointers + lifted).
  "linksReached",
] as const;

export type SurfaceSetField = (typeof RECALL_DECISION_FIELDS)[number];

/** The same list, as a call — the shape `tools/parallel` and the tests read. */
export function surfaceSetFields(): readonly SurfaceSetField[] {
  return RECALL_DECISION_FIELDS;
}

/** Ids with the numbers they were judged by. `verdicts` keeps every candidate,
 *  including the ones the renderer trimmed, so the lookup is a copy, not a
 *  derivation — and a missing verdict reports null rather than inventing 0. */
function tierRows(
  ids: readonly string[],
  verdicts: readonly CandidateVerdict[],
): { id: string; sal: number | null; activation: number | null; via?: "link" }[] {
  return ids.map((id) => {
    const v = verdicts.find((x) => x.id === id);
    // A quiet pointer says so on the durable row (review of #281, finding 5),
    // so replay and readers of footnotes can tell it from a cued footnote. Only
    // present when the verdict has it; the row's field list does not move.
    return { id, sal: v?.sal ?? null, activation: v?.activation ?? null, ...(v?.via === undefined ? {} : { via: v.via }) };
  });
}

/**
 * The per-turn surfacing decision, as it is PERSISTED (store `events`, SEAMS K).
 *
 * §17.3's richest comparison surface lived only in the in-process ring, which
 * made every §6 Recall criterion un-recomputable from the store a parallel run
 * leaves behind — "a metric derivable only from a live event ring is not a
 * metric" (parallel CONTRACT §5 G2) — and left G12's carry-forward rule with
 * nothing to hash (replay INTERFACE-GAPS §7).
 *
 * CONTENT-BY-REFERENCE, ALL OF IT (store §5 G10, scar §2.20): a session id, a
 * turn number, ids, counts, bytes, closed-vocabulary reasons and the numbers the
 * gate judged by. **No memory text, no cue text, and no hash of either** — a cue
 * token is a word the user typed, and turn text is exactly what telemetry may not
 * carry. `sentinelRendered` is a boolean for the same reason the sentinel itself
 * is not copied: the counts it states are already fields here.
 *
 * This function DERIVES NOTHING. Every value is copied off the decision record
 * `recall/` returned; a rule about what the surface set means would be a rule
 * with no home here (the rule at the top of this file).
 */
export function recallDecisionRecord(
  d: RecallDecision,
  ctx: { date: string | null },
): Record<string, unknown> {
  const surfaceSet = {
    // The raw session id, as `gate.chunk` records it and as `gate_session` has
    // keyed its rows since SEAMS item B: hashing here would buy no privacy the
    // same store does not already give away, and would cost the join between a
    // turn's surfacing and the same session's gate state.
    session: d.sessionId,
    turn: d.turn,
    day: d.day,
    // The CALENDAR date the caller passed for the temporal channel, or null: a
    // lived day is not a date, and a run that buckets by day needs both.
    date: ctx.date,
    reason: d.reason,
    observer: d.observer,
    budgetBytes: d.budgetBytes,
    bytes: d.bytes,
    surfacedCount: d.surfaced.length,
    footnoteCount: d.footnotes.length,
    affectFlag: d.affectFlag,
    affectReason: d.affectReason,
    moodMatched: d.moodMatched,
    sentinelRendered: d.sentinel !== null,
    surfaced: tierRows(d.surfaced, d.verdicts),
    footnotes: tierRows(d.footnotes, d.verdicts),
    // The surfacing race, as the decision itself reports it. `aborted` is always
    // false in a written row — an abort writes nothing at all (recall §5 G2) —
    // and the field stays so the asymmetry is legible rather than assumed: the
    // timeout arm is counted where a timeout is still allowed to be seen, the
    // adapter's own `adapter.recall {reason: "latency-abort"}`.
    elapsedMs: d.elapsedMs,
    aborted: d.aborted,
    // What spreading did this turn and how many scored candidates the cut left
    // out — counts only (association build 1, 2026-09-28). `spread` is null on
    // a turn it did not run.
    spread: d.spread,
    dropped: d.dropped,
    // LINKS THAT REACHED RECALL (2026-10-11, Group 4 item 7; review 06 C6):
    // memories SHOWN this turn that a link put there — quiet pointers, and
    // candidates a hop lifted into the cut. Top-level, so the dashboard's
    // proof can sum it.
    linksReached: (d.spread?.pointersShown ?? 0) + (d.spread?.liftedShown ?? 0),
  } satisfies Record<SurfaceSetField, unknown>;
  return surfaceSet;
}
