import { TUNABLES as ENCODE } from "../core/encode/tunables.js";
import {
  DATE_FROM_META,
  DATE_LINEAGE_MAX,
  PROSPECTIVE_PLAIN_EVENT,
  cueModeOf,
  windowKey
} from "../core/prospective/index.js";
import { addDays, daysBetween as calendarDaysBetween, localDate, parseCalendarDate } from "../core/time.js";
import { rowToPhysics } from "../core/store/index.js";
import { emotionalIntensity } from "../core/physics/index.js";
import { NON_INTERACTIVE_ENTRYPOINTS, readSession } from "./sessions.js";
export const FIRED_DAYS = 7;
export const EVENT_CEILING = 200000;
export const PROBE_CEILING = 50000;
export const FIRED_STATES = [
  "quiet",
  "blocked",
  "never",
  "blind",
  "firing",
  "new",
  "waiting",
  "done",
  "disabled",
  "retired"
];
export const STATE_ORDER = [
  "quiet",
  "blocked",
  "never",
  "blind",
  "firing",
  "new",
  "waiting",
  "done",
  "disabled",
  "retired"
];
export const STATE_MEANING = {
  firing: "a row landed in the last 7 days",
  quiet: "it has fired before, but not in the last 7 days",
  blocked: "it did not fire this week, and a durable row says what stopped it",
  never: "the evidence exists and has never carried a row",
  new: "never fired, and its evidence is younger than the window — not yet a worry",
  blind: "nothing durable records it, so firing and silence read alike",
  waiting: "it fires only when its occasion comes — an owner's action, a failure, a reminder falling due — so a week without one is not a fault",
  done: "a one-time job: it ran once, as designed, and has nothing more to do",
  disabled: "stood down by a named decision, not a fault",
  retired: "a phase of the run ended and took it with it"
};
export const MECHANISMS = [
  {
    id: "capture",
    label: "the conversation is captured when a session pauses or ends",
    module: "remember/spans",
    evidence: { kind: "event", names: ["adapter.boundary"] },
    covers: ["remember.capture.failed"]
  },
  {
    id: "ask",
    label: "the session is asked to write its own memories before it stops",
    module: "lifecycle.ts (the pacer), claude-code/hooks.ts (the words)",
    evidence: { kind: "event", names: ["adapter.ask"] },
    covers: ["adapter.writeup.failed"]
  },
  {
    id: "ask-two-part",
    label: "the older two-part version of that ask — one for the chapter, one for the memories",
    module: "claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.authorship.ask", "adapter.episode.ask"] },
    retired: "replaced by a single ask on 2026-09-04; the days recorded under these names stay readable"
  },
  {
    id: "deposit",
    label: "a memory the session wrote for itself passed the gates and landed",
    module: "mcp/ → encode/battery.ts",
    evidence: { kind: "event", names: ["gate.deposit"] }
  },
  {
    id: "journal-chapter",
    label: "the session wrote a chapter of its own journal",
    module: "mcp/chapter → self/",
    evidence: { kind: "probe", probe: "versions:episode-chapter" }
  },
  {
    id: "sweep-gate",
    label: "the crash fallback checked whether a session died with something unsaid",
    module: "remember/fallback.ts",
    evidence: { kind: "event", names: ["sweep.gate"] }
  },
  {
    id: "sweep-wake",
    label: "that fallback was woken as me before it read a transcript",
    module: "core/counterpart.ts",
    evidence: { kind: "event", names: ["sweep.wake"] },
    since: "2026-09-17"
  },
  {
    id: "chunk-gate",
    label: "a swept fragment met the gate battery and was scored at the door",
    module: "encode/battery.ts",
    evidence: { kind: "event", names: ["gate.chunk"] }
  },
  {
    id: "gate-refusal",
    label: "the gate battery turned a proposal away",
    module: "encode/battery.ts",
    evidence: {
      kind: "none",
      reason: "refusals are counted inside the gate rows, and that count has been empty in every row ever written — so a gate that has never had to say no and a gate nothing reaches read exactly alike. Only a deliberate probe deposit separates them."
    }
  },
  {
    id: "emotion",
    label: "how something felt is read at the door and used to weight what comes back",
    module: "encode/, recall/",
    evidence: {
      kind: "none",
      reason: "the gate records the channel as off in every row; nothing measures a classifier that does not run."
    },
    ...ENCODE.EMOTION_CLASSIFIER_ENABLED ? {} : {
      disabled: `the classifier ships off until it clears its precision bar of ${String(ENCODE.EMOTION_CLASSIFIER_PRECISION_BAR)} (encode/tunables.ts) — a named decision, not a fault`
    }
  },
  {
    id: "feelings",
    label: "how something felt was recorded on a memory, the owner's or the self's",
    module: "store/feelings.ts",
    evidence: { kind: "probe", probe: "feelings" },
    since: "2026-09-25"
  },
  {
    id: "emotion-weight",
    label: "a memory's strongest feeling holds it higher at birth and slows its fading",
    module: "physics/ §5.10",
    evidence: { kind: "probe", probe: "emotion.weighted" },
    since: "2026-09-26"
  },
  {
    id: "traits",
    label: "a memory that showed how I acted was given a trait nudge",
    module: "store/traits.ts",
    evidence: { kind: "probe", probe: "traits" },
    since: "2026-09-27"
  },
  {
    id: "mood-match",
    label: "a memory that felt the way someone feels now came to mind more easily",
    module: "recall/mood.ts",
    evidence: { kind: "event", names: ["recall.decision"], positive: "moodMatched" },
    since: "2026-09-26"
  },
  {
    id: "salience",
    label: "every memory is scored for novelty, relevance, feeling and usefulness as it is written",
    module: "encode/",
    evidence: {
      kind: "none",
      reason: "the scores are columns on each memory, not rows in the log, so the store can say what every memory scored and never when one was scored."
    }
  },
  {
    id: "entity-birth",
    label: "a name mentioned in passing becomes someone the system knows about",
    module: "schemas/",
    evidence: {
      kind: "none",
      reason: "a birth shows only as another entity in the store, and a refusal shows nowhere at all — the reasons live in an in-process ring that dies with the hook."
    }
  },
  {
    id: "accommodation",
    label: "something the owner declared outright replaced what had been inferred",
    module: "schemas/",
    cadence: { kind: "occasion", when: "the owner declares outright something that had only been inferred" },
    evidence: { kind: "probe", probe: "versions:replaced-by-declaration" }
  },
  {
    id: "recall-decision",
    label: "each turn decides what comes to mind and what stays quiet",
    module: "recall/",
    evidence: { kind: "event", names: ["recall.decision"] }
  },
  {
    id: "recall-injected",
    label: "what came to mind was handed to the host for the model to read",
    module: "lifecycle.ts, claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.recall"] }
  },
  {
    id: "credit",
    label: "memories the reply actually used are credited, so using one strengthens it",
    module: "recall/, physics/",
    evidence: { kind: "event", names: ["recall.credit"] }
  },
  {
    id: "gate-session",
    label: "what a session has already been shown, so it is not shown the same thing twice",
    module: "recall/session.ts",
    evidence: {
      kind: "none",
      reason: "the table is written every turn and read by no surface at all — not this view, not the dashboard, not the daily. Nothing new is needed; the rows that exist simply have to be rendered."
    }
  },
  {
    id: "deliberate-recall",
    label: "the session went looking for a memory on purpose and opened it in full",
    module: "mcp/deliberate.ts",
    evidence: { kind: "event", names: ["mcp.recall"] },
    since: "2026-09-20"
  },
  {
    id: "result-cut",
    label: "a tool answer too long for the host to show was cut to fit, with a note saying so, instead of vanishing into a file",
    module: "mcp/server.ts (withinCeiling)",
    cadence: { kind: "occasion", when: "a tool answer comes out too long for the host to show" },
    evidence: { kind: "event", names: ["mcp.result.oversize"] },
    covers: ["mcp.result.spilled"],
    since: "2026-10-02"
  },
  {
    id: "association",
    label: "two memories that came to mind together got wired to each other",
    module: "associate/",
    evidence: {
      kind: "probe",
      probe: "edges",
      undated: "the links carry no date at all, so nothing says when one was last made."
    }
  },
  {
    id: "association-saved",
    label: "the links noticed during a session were written down by the boundary's worker",
    module: "associate/",
    evidence: { kind: "event", names: ["associate.flush"] },
    since: "2026-09-17"
  },
  {
    id: "spreading",
    label: "remembering one thing pulls its neighbours with it",
    module: "associate/spread.ts",
    evidence: {
      kind: "none",
      reason: "the turn's record counts what surfaced but never which channel found it; a `channelCounts` field on the decision row that already exists would fix it without a new name."
    }
  },
  {
    id: "temporal-channel",
    label: "what happened around the same time is treated as a cue",
    module: "core/retrieval.ts",
    evidence: {
      kind: "none",
      reason: "the same gap as spreading activation: folded into the turn's totals with no breakdown."
    }
  },
  {
    id: "confidentiality",
    label: "something confidential is held back rather than surfaced",
    module: "recall/gate.ts",
    evidence: {
      kind: "none",
      reason: "the gate reports itself clear inside the deposit and turn records and is never broken out, so a withholding that happened and one that never had to are the same absence."
    }
  },
  {
    id: "sleep-cycle",
    label: "the consolidation cycle ran, with every phase by name",
    module: "sleep/, bin/runner.ts",
    evidence: { kind: "event", names: ["sleep.cycle"] }
  },
  {
    id: "decay",
    label: "memories weaken with time and drop to a lower band",
    module: "physics/, sleep/decay.ts",
    evidence: { kind: "event", names: ["band.transition"] }
  },
  {
    id: "promotion",
    label: "a memory about me or about us comes back and becomes core, by the fast or slow lane",
    module: "sleep/consolidate.ts",
    evidence: { kind: "event", names: ["band.promoted"] }
  },
  {
    id: "returns",
    label: "a memory used again after a gap comes back stronger: it will fade more slowly",
    module: "physics/ (creditReturn), store/index.ts#reinforce",
    evidence: { kind: "probe", probe: "returns.awake" },
    since: "2026-09-26"
  },
  {
    id: "core-demote",
    label: "the owner sent a core memory back to ordinary fading, and said why",
    module: "counterpart.ts#demoteCore",
    cadence: { kind: "occasion", when: "the owner sends a core memory back" },
    evidence: { kind: "event", names: ["band.demoted"] },
    since: "2026-09-26"
  },
  {
    id: "upgrade-census",
    label: "after the v8 upgrade, every memory was checked by the old rules and the new",
    module: "sleep/upgrade.ts",
    cadence: { kind: "one-time", when: "a store made before v8 is upgraded" },
    evidence: { kind: "event", names: ["physics.upgrade.census"] },
    since: "2026-09-26"
  },
  {
    id: "dedup",
    label: "an exact copy of a memory is merged into the one it copies, overnight",
    module: "sleep/dedup.ts",
    cadence: {
      kind: "occasion",
      when: "an exact copy of a memory's words gets past the door, which turns a repeat away first (near-copies are a dream's to merge, on the dream's row)"
    },
    evidence: { kind: "event", names: ["memory.merged"] },
    refusals: {
      names: ["sleep.cycle"],
      under: "dedup/left-alone:",
      only: ["declared-revision-never-merged", "revision-successor-never-merged"],
      since: "2026-09-20"
    }
  },
  {
    id: "prune",
    label: "a memory that has sat at the floor long enough is let go",
    module: "sleep/prune.ts",
    evidence: { kind: "event", names: ["memory.pruned"] },
    refusals: {
      names: ["sleep.cycle"],
      under: "prune/blocked:",
      only: ["protected", "in-live-revision-chain", "recurring"],
      since: "2026-09-20"
    }
  },
  {
    id: "fade",
    label: "a card nobody has mentioned in months fades out of the vocabulary (gently: months of quiet, longer for people)",
    module: "sleep/fade.ts, schemas/index.ts",
    evidence: { kind: "event", names: ["sleep.cycle"], positive: "faded" },
    since: "2026-09-24"
  },
  {
    id: "revision",
    label: "a belief took a credited challenge and was revised under the pressure",
    module: "schemas/index.ts",
    cadence: { kind: "occasion", when: "a belief takes a credited challenge" },
    evidence: { kind: "event", names: ["revision.pressure"] }
  },
  {
    id: "contradictions",
    label: "two memories that disagree were settled — changed, corrected or kept open — or flagged, or a settle undone",
    module: "core/reconsolidation.ts (revision.ts, dream/, mcp remember, cli settle)",
    cadence: { kind: "occasion", when: "two memories disagree" },
    evidence: { kind: "event", names: ["contradiction.settled"] },
    covers: ["contradiction.flagged", "contradiction.undone", "contradiction.held", "contradiction.proposed"],
    since: "2026-09-29"
  },
  {
    id: "night-refusals",
    label: "why a belief was NOT revised under a challenge it took",
    module: "schemas/index.ts",
    evidence: {
      kind: "none",
      reason: "the credit is durable and the refusal is an in-process ring (`schemas/index.ts:682`), so a belief that refused a challenge and one that was never challenged read alike. A `refused` map on the `revision.pressure` row that already exists would fix it."
    }
  },
  {
    id: "gist",
    label: "a dream distilled a pattern across several memories into one, in its own words",
    module: "dream/ (gist)",
    evidence: { kind: "probe", probe: "dreamed" },
    since: "2026-09-26"
  },
  {
    id: "dream",
    label: "the counterpart dreamed: replayed what was lived since the last dream, and wrote a journal",
    module: "dream/",
    evidence: { kind: "event", names: ["dream.journaled"] },
    covers: ["dream.begun", "dream.undone", "mcp.part"],
    since: "2026-09-26"
  },
  {
    id: "dream-changes",
    label: "a dream changed memories: merged near-copies, drew links, replayed, flagged a contradiction",
    module: "dream/ (propose)",
    evidence: { kind: "event", names: ["dream.changed"] },
    since: "2026-09-26"
  },
  {
    id: "dream-ask",
    label: "the day's line started the nightly run (or asked first), or the owner said not today or changed the setting",
    module: "dream/ (offer, claimOffer, decline, setSetting), claude-code/hooks.ts",
    evidence: { kind: "event", names: ["dream.ask"] },
    since: "2026-09-26"
  },
  {
    id: "dream-replays",
    label: "a dream replayed a memory: a return worth half an awake one",
    module: "store/index.ts#replayReturn",
    evidence: { kind: "probe", probe: "returns.dream" },
    since: "2026-09-26"
  },
  {
    id: "briefing",
    label: "the waking briefing was composed — who I am, what is live, what is owed",
    module: "self/briefing.ts",
    evidence: { kind: "event", names: ["self.briefing"] }
  },
  {
    id: "self-page",
    label: "the written page of who I am was amended — by me, by the owner, or by the nightly writer",
    module: "self/page.ts",
    evidence: { kind: "event", names: ["self.page.revised"] },
    covers: ["self.page.refused"],
    since: "2026-09-18"
  },
  {
    id: "page-writer",
    label: "the day just lived was read back and my page was offered a revision — the first part of the nightly run",
    module: "self/writer.ts, dream tool (writer phase)",
    evidence: { kind: "event", names: ["self.page.writer.ran"] },
    since: "2026-09-20"
  },
  {
    id: "handoff-written",
    label: "a session left a handoff for the next one in that directory",
    module: "handoff/index.ts",
    evidence: { kind: "event", names: ["handoff.written"] },
    covers: ["handoff.refused", "handoff.cleared"],
    since: "2026-09-20"
  },
  {
    id: "handoff-shown",
    label: "a session waking in that directory was handed the pointer to a handoff",
    module: "handoff/index.ts",
    evidence: { kind: "event", names: ["handoff.shown"] },
    covers: ["handoff.lasthere.noroom", "self.work.overflow"],
    since: "2026-09-20"
  },
  {
    id: "wake-injected",
    label: "that briefing was handed to the host at the start of a session",
    module: "claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.wake.injected"] },
    covers: ["adapter.envelope.overcap", "adapter.notice.dropped", "adapter.envelope.gave-way", "adapter.injection.overbudget"]
  },
  {
    id: "wake-delivered",
    label: "whether the briefing actually arrived was checked at the first prompt or the first Stop",
    module: "claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.wake.delivered"] }
  },
  {
    id: "primacy",
    label: "the A/B hand-off that let the older system speak first during the parallel run",
    module: "claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.primacy.deliver", "adapter.primacy.standdown"] },
    retired: "the parallel run left its primacy phase on 2026-09-04"
  },
  {
    id: "protection",
    label: "the owner marked a memory permanent, so nothing may revise or forget it",
    module: "physics/, store/",
    cadence: { kind: "occasion", when: "the owner marks a memory permanent" },
    evidence: {
      kind: "probe",
      probe: "protected",
      undated: "protection is a flag on the row with no history behind it — the store can say which memories carry it and never when one was given it. A `versions` row with reason `protected` would fix it."
    }
  },
  {
    id: "removal",
    label: "the owner erased a memory, and the erasure left a record",
    module: "store/owner-op-seam.ts",
    cadence: { kind: "occasion", when: "the owner erases a memory" },
    evidence: { kind: "probe", probe: "removals" }
  },
  {
    id: "unmerge",
    label: "the owner put back a memory a merge had archived",
    module: "store/owner-op-seam.ts",
    cadence: { kind: "occasion", when: "the owner puts back a memory a merge archived" },
    evidence: { kind: "event", names: ["memory.unmerged"] }
  },
  {
    id: "prospective-armed",
    label: "something to remember at a future date was set",
    module: "prospective/",
    evidence: {
      kind: "probe",
      probe: "prospective.armed",
      undated: "the row records the date it is FOR and never the day it was set, so nothing says when one was armed."
    }
  },
  {
    id: "prospective-dated",
    label: "a memory was given a date to come back on",
    module: "prospective/, mcp/tools.ts",
    evidence: { kind: "probe", probe: "prospective.dated" }
  },
  {
    id: "prospective-fired",
    label: "that future date arrived and the reminder came back",
    module: "prospective/, counterpart.ts#spendArrivals",
    cadence: { kind: "occasion", when: "a dated memory's day comes round and it comes up in a turn" },
    evidence: { kind: "event", names: ["prospective.fire"] },
    covers: ["prospective.fire.refused"],
    since: "2026-09-26"
  },
  {
    id: "prospective-plain",
    label: "a reminder marked plain was said plainly on its day",
    module: "prospective/, lifecycle.ts",
    cadence: { kind: "occasion", when: "a reminder marked plain falls due on a day a session runs", check: "plain-due" },
    evidence: { kind: "event", names: ["prospective.plain"] },
    since: "2026-09-26"
  },
  {
    id: "embed",
    label: "memories without a vector were given one by the background worker",
    module: "bin/runner.ts, store/cache.ts",
    evidence: { kind: "event", names: ["adapter.embed.backfill"] },
    covers: ["store.embedder.reconciled"]
  },
  {
    id: "semantic-lag",
    label: "the worker left the next turn's semantic cue ready",
    module: "store/cache.ts",
    evidence: { kind: "event", names: ["adapter.semantic.lag"] }
  },
  {
    id: "worker-start",
    label: "the background worker started when a session reached a boundary",
    module: "lifecycle.ts, bin/runner.ts",
    evidence: { kind: "event", names: ["adapter.spawn.started"] },
    refusals: {
      names: ["adapter.spawn.refused", "adapter.spawn.failed", "adapter.runner.failed"]
    },
    since: "2026-09-20"
  },
  {
    id: "worker-trouble",
    label: "the worker was refused, could not be started, or failed after starting",
    module: "lifecycle.ts, bin/runner.ts",
    cadence: { kind: "occasion", when: "the worker is refused, cannot start, or fails" },
    evidence: {
      kind: "event",
      names: ["adapter.spawn.refused", "adapter.spawn.failed", "adapter.runner.failed"]
    }
  },
  {
    id: "hook-claim",
    label: "a second Counterparts hook found its event already taken, and said nothing",
    module: "claude-code/claim.ts",
    cadence: { kind: "occasion", when: "two Counterparts installs run the same hook at once" },
    evidence: { kind: "event", names: ["adapter.hook.claim.lost"] },
    since: "2026-10-09"
  },
  {
    id: "checkout",
    label: "which copy of the code the hooks were actually running",
    module: "claude-code/doctor.ts",
    evidence: { kind: "event", names: ["adapter.checkout"] }
  },
  {
    id: "scope-verdict",
    label: "a directory's own setting decided whether to remember there at all",
    module: "adapters/scopes.ts",
    evidence: {
      kind: "none",
      reason: "off and paused are decided BEFORE the store is opened, so no store row is possible at that instant. A counter file beside the scope registry, read by doctor, is the only shape that fits."
    }
  },
  {
    id: "snapshot",
    label: "a whole copy of the store was set aside, and old copies were let go",
    module: "adapters/snapshots.ts",
    evidence: { kind: "event", names: ["snapshot.taken"] },
    covers: ["snapshot.rotated"],
    since: "2026-09-18"
  },
  {
    id: "snapshot-trouble",
    label: "a copy of the store could not be made (the store itself is unharmed)",
    module: "adapters/snapshots.ts",
    cadence: { kind: "occasion", when: "a copy of the store fails" },
    evidence: { kind: "event", names: ["snapshot.failed"] },
    since: "2026-09-18"
  },
  {
    id: "retention",
    label: "the raw transcript of a session that owes nothing was let go a few days after it ended (never more than 14 days after its last activity)",
    module: "remember/retention.ts (run by the worker)",
    evidence: { kind: "event", names: ["remember.prune"] },
    since: "2026-09-23"
  },
  {
    id: "write-ups",
    label: 'what a session said was written up — by the session itself, a "nothing new", a chapter, or the next session',
    module: "coverage/ (rows written by the worker)",
    evidence: { kind: "event", names: ["coverage.written"] },
    covers: ["coverage.owed", "coverage.lapsed"],
    since: "2026-09-30"
  },
  {
    id: "backup",
    label: "the store was backed up BY HAND, from the console",
    module: "cli/commands.ts",
    evidence: {
      kind: "none",
      reason: "the `backup` command leaves no row at all, so one that ran and one that never has are the same silence. The AUTOMATIC daily copy has had its own rows since 2026-09-18 (the `snapshot` row above); the console command is the other half. One `store.backup` event would fix it."
    }
  },
  {
    id: "journal-copy",
    label: "the journal was written out as markdown files you can open in any editor",
    module: "core/self/journal-file.ts",
    evidence: { kind: "event", names: ["journal.copy.written"] },
    covers: ["journal.copy.failed"],
    since: "2026-09-20"
  },
  {
    id: "export",
    label: "the owner took a readable copy of the memories off this machine, by hand",
    module: "cli/export.ts",
    cadence: { kind: "occasion", when: "the owner exports" },
    evidence: { kind: "event", names: ["store.export"] },
    since: "2026-09-20"
  }
];
export const YOUNG_LIVED_DAYS = 2;
export function daysBefore(today, back) {
  try {
    return addDays(today, -back);
  } catch {
    return today;
  }
}
function comparisonIsTooYoung(id, w) {
  const since = MECHANISMS.find((m) => m.id === id)?.refusals?.since;
  return since !== undefined && since > w.previousFrom;
}
export function daysBetween(from, to) {
  try {
    return calendarDaysBetween(from, to);
  } catch {
    return 0;
  }
}
function safeLivedDay(store) {
  try {
    return store.livedDay();
  } catch {
    return 0;
  }
}
export function firedReport(store, today, opts = {}) {
  const window = {
    from: daysBefore(today, FIRED_DAYS - 1),
    to: today,
    previousFrom: daysBefore(today, FIRED_DAYS * 2 - 1),
    previousTo: daysBefore(today, FIRED_DAYS),
    zone: store.zone()
  };
  const log = readLog(store, window);
  const probed = opts.probes === false ? null : readProbes(store, window);
  const rows = [];
  const notRead = [];
  const missedOccasion = [];
  for (const m of MECHANISMS) {
    if (m.evidence.kind === "probe" && probed === null) {
      notRead.push(m.id);
      continue;
    }
    const occasion = probed === null ? null : readOccasion(m, store, log, window);
    const row = rowFor(m, log, probed, window, occasion);
    rows.push(row);
    if (occasion !== null && occasion.missed > 0)
      missedOccasion.push(`${row.label} (${occasion.says})`);
  }
  const counts = Object.fromEntries(FIRED_STATES.map((s) => [s, 0]));
  for (const row of rows)
    counts[row.state] += 1;
  const livedDay = safeLivedDay(store);
  const calendarDays = log.oldestDate === null ? null : Math.max(0, daysBetween(log.oldestDate, today));
  return {
    today,
    from: window.from,
    previousFrom: window.previousFrom,
    previousTo: window.previousTo,
    rows: sortRows(rows),
    notRead,
    truncated: log.truncated,
    probesRead: probed !== null,
    probesTruncated: probed?.truncated ?? false,
    counts,
    livedDay,
    calendarDays,
    young: livedDay < YOUNG_LIVED_DAYS && (calendarDays === null || calendarDays < YOUNG_LIVED_DAYS),
    wentBlocked: rows.filter((r) => r.state === "blocked" && r.firedInPreviousWindow > 0 && !comparisonIsTooYoung(r.id, window)).map((r) => `${r.label} (${r.topRefusal ?? UNNAMED_REFUSAL})`),
    missedOccasion,
    wentQuiet: rows.filter((r) => r.state === "quiet" && r.firedInPreviousWindow > 0 && r.occasionMissed === 0).map((r) => r.lastFiredIsDate ? r.label : `${r.label} (measured in lived days)`)
  };
}
export function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const byState = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);
    if (byState !== 0)
      return byState;
    if (a.lastFiredIsDate !== b.lastFiredIsDate)
      return a.lastFiredIsDate ? -1 : 1;
    if (a.lastFired !== b.lastFired) {
      if (a.lastFired === null)
        return 1;
      if (b.lastFired === null)
        return -1;
      return a.lastFired < b.lastFired ? 1 : -1;
    }
    return a.id < b.id ? -1 : 1;
  });
}
const EMPTY_READING = {
  total: 0,
  lastFired: null,
  lastFiredIsDate: false,
  inWindow: 0,
  inPreviousWindow: 0,
  refused: 0,
  topRefusal: null,
  refusals: new Map,
  evidence: "",
  refusalEvidence: "",
  blind: null
};
function rowFor(m, log, probed, w, occasion = null) {
  const read = readEvidence(m, log, probed);
  const state = stateOf(m, read, w, occasion);
  return {
    id: m.id,
    label: m.label,
    module: m.module,
    state,
    lastFired: read.lastFired,
    lastFiredIsDate: read.lastFiredIsDate,
    firedInWindow: read.inWindow,
    firedInPreviousWindow: read.inPreviousWindow,
    total: read.total,
    refusedInWindow: read.refused,
    topRefusal: read.topRefusal,
    evidence: read.evidence,
    note: noteFor(m, read, state, occasion),
    cadence: m.cadence?.kind ?? null,
    occasionMissed: occasion?.missed ?? 0
  };
}
function stateOf(m, read, w, occasion = null) {
  if (m.disabled !== undefined)
    return "disabled";
  if (m.retired !== undefined)
    return "retired";
  if (read.blind !== null)
    return "blind";
  if (read.inWindow > 0)
    return "firing";
  if (read.refused > 0)
    return "blocked";
  if (m.cadence?.kind === "one-time" && read.total > 0)
    return "done";
  if (m.cadence !== undefined && (occasion === null || occasion.missed === 0))
    return "waiting";
  if (read.total > 0)
    return "quiet";
  if (occasion !== null && occasion.missed > 0)
    return "never";
  if (m.since !== undefined && m.since >= w.from)
    return "new";
  return "never";
}
function noteFor(m, read, state, occasion = null) {
  if (state === "disabled")
    return m.disabled ?? null;
  if (state === "retired")
    return m.retired ?? null;
  if (state === "blind")
    return read.blind;
  if (occasion !== null && occasion.missed > 0) {
    return `its occasion came this week and was not answered: ${occasion.says}`;
  }
  if (state === "done" && m.cadence !== undefined) {
    return `a one-time job, run when ${m.cadence.when}; it has run, and has nothing more to do`;
  }
  if (state === "waiting" && m.cadence !== undefined) {
    if (m.cadence.kind === "one-time") {
      return `a one-time job, run when ${m.cadence.when}; this store has not needed it`;
    }
    return `it fires only when ${m.cadence.when}${occasion === null ? "" : `; ${occasion.says}`}`;
  }
  if (state === "new" && m.since !== undefined)
    return `its evidence was added ${m.since}`;
  if (state === "blocked") {
    const by = read.topRefusal === null ? "" : `, most often ${read.topRefusal}`;
    return `it did not fire this week; ${String(read.refused)} refusal${read.refused === 1 ? "" : "s"} landed instead${by} (${read.refusalEvidence})`;
  }
  return null;
}
function readEvidence(m, log, probed) {
  const base = m.evidence.kind === "none" ? { ...EMPTY_READING, evidence: "no durable row", blind: m.evidence.reason } : m.evidence.kind === "probe" ? probeReading(m.evidence.probe, m.evidence.undated ?? null, probed) : eventReading(m.evidence.names, log, m.evidence.positive);
  if (m.refusals === undefined)
    return base;
  const extra = refusalReading(m.refusals, log);
  if (extra.refused === 0)
    return { ...base, refusalEvidence: base.evidence };
  const merged = new Map(extra.refusals);
  for (const [reason, n] of base.refusals)
    merged.set(reason, (merged.get(reason) ?? 0) + n);
  return {
    ...base,
    refused: base.refused + extra.refused,
    refusals: merged,
    topRefusal: topOf(merged),
    refusalEvidence: m.refusals.names.join(", ")
  };
}
function refusalReading(src, log) {
  const refusals = new Map;
  let refused = 0;
  for (const name of src.names) {
    const t = log.byName.get(name);
    if (t === undefined)
      continue;
    for (const [reason, n] of t.refusals) {
      if (src.under !== undefined && !reason.startsWith(src.under))
        continue;
      const key = src.under === undefined ? reason : reason.slice(src.under.length);
      if (src.only !== undefined && !src.only.includes(key))
        continue;
      refusals.set(key, (refusals.get(key) ?? 0) + n);
      refused += n;
    }
  }
  return { refused, refusals };
}
function eventReading(names, log, positive) {
  let total = 0;
  let inWindow = 0;
  let inPreviousWindow = 0;
  let refused = 0;
  let lastFired = null;
  const refusals = new Map;
  for (const name of names) {
    const t = log.byName.get(positive === undefined ? name : filteredKey(name, positive));
    if (t === undefined)
      continue;
    total += t.total;
    inWindow += t.inWindow;
    inPreviousWindow += t.inPreviousWindow;
    refused += t.refused;
    if (t.lastDate !== null && (lastFired === null || t.lastDate > lastFired)) {
      lastFired = t.lastDate;
    }
    for (const [reason, n] of t.refusals)
      refusals.set(reason, (refusals.get(reason) ?? 0) + n);
  }
  return {
    total,
    lastFired,
    lastFiredIsDate: lastFired !== null,
    inWindow,
    inPreviousWindow,
    refused,
    topRefusal: topOf(refusals),
    refusals,
    evidence: positive === undefined ? names.join(", ") : `${names.join(", ")} (${positive} > 0)`,
    refusalEvidence: names.join(", "),
    blind: null
  };
}
function topOf(refusals) {
  let top = null;
  for (const [reason, n] of refusals) {
    if (top === null || n > top[1] || n === top[1] && reason < top[0])
      top = [reason, n];
  }
  return top === null ? null : `${top[0]} ×${String(top[1])}`;
}
const WAKE_EVENT = "adapter.wake.injected";
const PRESENCE_EVENTS = new Set([WAKE_EVENT, "recall.decision"]);
function filteredKey(name, field) {
  return `${name}#${field}`;
}
const POSITIVE_FIELDS = (() => {
  const out = new Map;
  for (const m of MECHANISMS) {
    if (m.evidence.kind !== "event" || m.evidence.positive === undefined)
      continue;
    for (const name of m.evidence.names) {
      const fields = out.get(name) ?? [];
      if (!fields.includes(m.evidence.positive))
        fields.push(m.evidence.positive);
      out.set(name, fields);
    }
  }
  return out;
})();
function emptyTally() {
  return {
    total: 0,
    lastDate: null,
    inWindow: 0,
    inPreviousWindow: 0,
    refused: 0,
    refusals: new Map
  };
}
function readLog(store, w) {
  const byName = new Map;
  const age = { oldest: null, presence: [], attended: new Map };
  const first = store.eventLog({ limit: EVENT_CEILING });
  for (const row of first)
    tallyRow(byName, row, w, age);
  if (first.length < EVENT_CEILING) {
    return { byName, truncated: false, oldestDate: age.oldest, presence: age.presence, attended: age.attended };
  }
  const lastSeq = first[first.length - 1]?.seq ?? 0;
  const recent = store.eventLog({
    sinceDay: Math.max(0, store.livedDay() - FIRED_DAYS * 2),
    limit: EVENT_CEILING
  });
  for (const row of recent) {
    if (row.seq <= lastSeq)
      continue;
    tallyRow(byName, row, w, age);
  }
  return { byName, truncated: true, oldestDate: age.oldest, presence: age.presence, attended: age.attended };
}
function tallyRow(byName, row, w, age) {
  const payload = payloadOf(row);
  const date = rowDate(row, payload, w.zone);
  if (age.oldest === null || date < age.oldest)
    age.oldest = date;
  if (PRESENCE_EVENTS.has(row.name)) {
    const session = str(payload, "session") ?? (row.ref !== null && row.ref.length > 0 ? row.ref : null);
    const said = payload["interactive"];
    if (row.name === WAKE_EVENT && session !== null && typeof said === "boolean" && age.attended.get(session) !== false) {
      age.attended.set(session, said);
    }
    if (date >= w.from && date <= w.to)
      age.presence.push({ date, at: row.at, session });
  }
  const t = countInto(byName, row.name, date, w);
  for (const field of POSITIVE_FIELDS.get(row.name) ?? []) {
    const v = payload[field];
    if (typeof v === "number" && v > 0)
      countInto(byName, filteredKey(row.name, field), date, w);
  }
  const inWindow = date >= w.from && date <= w.to;
  if (!inWindow)
    return;
  const reader = REFUSAL_READERS[row.name];
  if (reader === undefined)
    return;
  for (const [reason, n] of reader(payload)) {
    if (n <= 0)
      continue;
    t.refused += n;
    t.refusals.set(reason, (t.refusals.get(reason) ?? 0) + n);
  }
}
function countInto(byName, key, date, w) {
  let t = byName.get(key);
  if (t === undefined) {
    t = emptyTally();
    byName.set(key, t);
  }
  t.total += 1;
  if (t.lastDate === null || date > t.lastDate)
    t.lastDate = date;
  if (date >= w.from && date <= w.to)
    t.inWindow += 1;
  else if (date >= w.previousFrom && date <= w.previousTo)
    t.inPreviousWindow += 1;
  return t;
}
export function rowDate(row, payload, zone) {
  const date = payload["date"];
  if (typeof date === "string" && date.length === 10)
    return date;
  return localDate(row.at, zone);
}
function payloadOf(row) {
  if (row.payload === null)
    return {};
  try {
    const parsed = JSON.parse(row.payload);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
const REFUSAL_READERS = {
  "adapter.ask": (p) => {
    const outcome = str(p, "outcome");
    if (outcome === null || outcome === "asked")
      return [];
    return [[str(p, "reason") ?? outcome, 1]];
  },
  "sweep.gate": (p) => countsIn(p, "refusals").filter(([reason]) => reason !== "SWEPT"),
  "gate.chunk": (p) => countsIn(p, "refusalsByReason"),
  "gate.deposit": (p) => countsIn(p, "refusalsByReason"),
  "recall.credit": (p) => countsIn(p, "refused"),
  "snapshot.failed": (p) => {
    const reason = str(p, "reason");
    return reason === null ? [] : [[reason, 1]];
  },
  "adapter.spawn.refused": (p) => reasonOnce(p),
  "adapter.spawn.failed": (p) => reasonOnce(p),
  "adapter.runner.failed": (p) => reasonOnce(p),
  "sleep.cycle": (p) => {
    const out = [];
    const phases = p["phases"];
    if (!Array.isArray(phases))
      return out;
    for (const entry of phases) {
      if (entry === null || typeof entry !== "object")
        continue;
      const e = entry;
      const phase = typeof e["phase"] === "string" ? e["phase"] : null;
      if (phase === null)
        continue;
      for (const [reason, n] of countsIn(e, "skipped"))
        out.push([`${phase}/${reason}`, n]);
    }
    return out;
  },
  "self.page.refused": (p) => reasonOnce(p),
  "prospective.fire.refused": (p) => reasonOnce(p),
  "mcp.recall": (p) => countsIn(p, "blockedBy").filter(([reason]) => reason.startsWith("dim-cap:")),
  "recall.decision": (p) => {
    const reason = str(p, "reason");
    return reason === null || reason === "rendered" ? [] : [[reason, 1]];
  }
};
export const UNNAMED_REFUSAL = "(no reason recorded)";
function reasonOnce(p) {
  return [[str(p, "reason") ?? UNNAMED_REFUSAL, 1]];
}
function countsIn(p, key) {
  const raw = p[key];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return [];
  const out = [];
  for (const [reason, n] of Object.entries(raw)) {
    if (typeof n === "number" && n > 0)
      out.push([reason, n]);
  }
  return out;
}
function str(p, key) {
  const v = p[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
const OCCASION_CHECKS = {
  "plain-due": plainDueReading
};
function readOccasion(m, store, log, w) {
  if (m.cadence?.kind !== "occasion" || m.cadence.check === undefined)
    return null;
  try {
    return OCCASION_CHECKS[m.cadence.check](store, log, w);
  } catch {
    return null;
  }
}
function plainDueReading(store, log, w) {
  const lastDay = daysBefore(w.to, 1);
  const none = { missed: 0, says: "none fell due this week on a day a session ran" };
  if (lastDay < w.from)
    return none;
  const denied = new Set(store.deniedIds());
  let present = null;
  let due = 0;
  let missed = 0;
  for (const dated of store.datedMemories(w.from, lastDay)) {
    if (denied.has(dated.id))
      continue;
    const row = store.row(dated.id);
    if (row === undefined || row.archived === 1 || row.superseded_by !== null)
      continue;
    let doc;
    try {
      doc = store.read(dated.id).doc;
    } catch {
      continue;
    }
    if (doc.type === "episode" || cueModeOf(doc) !== "plain")
      continue;
    const span = parseCalendarDate(dated.eventDate);
    if (span === null || span.text !== dated.eventDate || span.precision === "year")
      continue;
    present ??= presentDays(store, log);
    const beats = new Set;
    for (let day = span.first > w.from ? span.first : w.from;day <= lastDay && day <= span.last; day = addDays(day, 1)) {
      const seen = present.get(day);
      if (seen === undefined || seen <= (row.created_at ?? 0))
        continue;
      beats.add(span.precision === "day" ? "day" : day === span.last ? "last-day" : "opens");
    }
    if (beats.size === 0)
      continue;
    due += 1;
    const key = windowKey(dated.eventDate, span.precision);
    const lineage = plainLineage(store, dated.id);
    const untold = [...beats].some((beat) => !lineage.some((id) => store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT, ref: id, order: "desc", limit: 50 }).some((e) => e.dedup_key === `${PROSPECTIVE_PLAIN_EVENT}:${id}:${key}:${beat}`)));
    if (untold)
      missed += 1;
  }
  if (due === 0)
    return none;
  if (missed === 0) {
    return { missed: 0, says: `${String(due)} fell due this week, and ${due === 1 ? "it was" : "each was"} said` };
  }
  return {
    missed,
    says: `${String(missed)} plain ${missed === 1 ? "reminder was" : "reminders were"} due on a day a session ran and not said`
  };
}
function presentDays(store, log) {
  const asked = new Map;
  const unattended = (session) => {
    if (session === null)
      return false;
    const said = log.attended.get(session);
    if (said !== undefined)
      return !said;
    let known = asked.get(session);
    if (known === undefined) {
      const entrypoint = readSession(store.dir, session)?.entrypoint;
      known = entrypoint !== undefined && NON_INTERACTIVE_ENTRYPOINTS.has(entrypoint);
      asked.set(session, known);
    }
    return known;
  };
  const out = new Map;
  for (const p of log.presence) {
    if (unattended(p.session))
      continue;
    const was = out.get(p.date);
    if (was === undefined || p.at > was)
      out.set(p.date, p.at);
  }
  return out;
}
function plainLineage(store, memoryId) {
  const out = [memoryId];
  let current = memoryId;
  for (let hop = 0;hop < DATE_LINEAGE_MAX; hop++) {
    const raw = store.row(current)?.meta;
    if (raw === undefined || raw === null)
      break;
    let from;
    try {
      from = JSON.parse(raw)[DATE_FROM_META];
    } catch {
      break;
    }
    if (typeof from !== "string" || out.includes(from))
      break;
    out.push(from);
    current = from;
  }
  return out;
}
function readProbes(store, w) {
  const byId = new Map;
  const livedDay = store.livedDay();
  const bump = (id, at = {}) => {
    let t = byId.get(id);
    if (t === undefined) {
      t = { total: 0, lastLivedDay: null, lastAt: null, inWindow: 0, inPreviousWindow: 0 };
      byId.set(id, t);
    }
    t.total += 1;
    const day = at.livedDay ?? null;
    if (day !== null && (t.lastLivedDay === null || day > t.lastLivedDay))
      t.lastLivedDay = day;
    const when = at.at ?? null;
    if (when !== null && (t.lastAt === null || when > t.lastAt))
      t.lastAt = when;
    if (when !== null) {
      const date = localDate(when, w.zone);
      if (date >= w.from && date <= w.to)
        t.inWindow += 1;
      else if (date >= w.previousFrom && date <= w.previousTo)
        t.inPreviousWindow += 1;
      return;
    }
    if (day === null)
      return;
    const ago = livedDay - day;
    if (ago < FIRED_DAYS)
      t.inWindow += 1;
    else if (ago < FIRED_DAYS * 2)
      t.inPreviousWindow += 1;
  };
  for (const record of store.removalRecord())
    bump("removals", { at: record.at });
  const ids = store.list();
  const scanned = ids.length > PROBE_CEILING ? ids.slice(0, PROBE_CEILING) : ids;
  const traitNewest = new Map;
  for (const t of store.traitsAll()) {
    const was = traitNewest.get(t.memory_id);
    if (was === undefined || t.created_at > was)
      traitNewest.set(t.memory_id, t.created_at);
  }
  for (const id of scanned) {
    const row = store.row(id);
    if (row !== undefined && row.archived === 0 && row.protected === 1)
      bump("protected");
    if (row !== undefined && row.archived === 0 && row.superseded_by === null) {
      if (emotionalIntensity(rowToPhysics(row)) > 0)
        bump("emotion.weighted", { livedDay: row.birth_day });
      if (row.feeling_peak !== null && row.feeling_peak !== undefined) {
        let newest = null;
        for (const f of store.feelingsFor(id))
          if (newest === null || f.created_at > newest)
            newest = f.created_at;
        bump("feelings", { at: newest });
      }
      const traitAt = traitNewest.get(id);
      if (traitAt !== undefined)
        bump("traits", { at: traitAt });
    }
    if (row !== undefined && row.archived === 0 && row.event_date !== null) {
      bump("prospective.dated", { at: row.created_at });
    }
    for (const edge of store.edgesFrom(id))
      bump("edges", { livedDay: edge.last_day });
    for (const p of store.prospectiveFor(id)) {
      bump("prospective.armed");
      if (p.last_fired_day !== null)
        bump("prospective.fired", { livedDay: p.last_fired_day });
    }
    for (const v of store.versions(id)) {
      bump(`versions:${v.reason}`, { livedDay: v.version_day, at: v.archived_at });
    }
    for (const r of store.returnsOf(id)) {
      if (r.source === "legacy")
        continue;
      bump(r.source === "dream" ? "returns.dream" : "returns.awake", { at: r.at });
    }
    if (row !== undefined && row.archived === 0 && row.source === "dreamed") {
      bump("dreamed", { at: row.created_at, livedDay: row.birth_day });
    }
  }
  return { byId, livedDay, truncated: scanned.length < ids.length, zone: w.zone };
}
function probeReading(probe, undated, probed) {
  const base = {
    ...EMPTY_READING,
    evidence: probeLabel(probe),
    refusalEvidence: probeLabel(probe)
  };
  if (probed === null)
    return { ...base, blind: "the tables were not read on this pass" };
  const t = probed.byId.get(probe);
  if (t === undefined || t.total === 0)
    return base;
  const counted = {
    ...base,
    total: t.total,
    inWindow: t.inWindow,
    inPreviousWindow: t.inPreviousWindow
  };
  if (t.lastAt !== null) {
    return { ...counted, lastFired: localDate(t.lastAt, probed.zone), lastFiredIsDate: true };
  }
  if (t.lastLivedDay !== null) {
    return {
      ...counted,
      lastFired: `lived day ${String(t.lastLivedDay)}`,
      lastFiredIsDate: false
    };
  }
  return {
    ...base,
    total: t.total,
    blind: undated ?? "this table records no date, so nothing says when it last happened"
  };
}
function probeLabel(probe) {
  if (probe.startsWith("versions:"))
    return `versions (${probe.slice("versions:".length)})`;
  if (probe === "protected")
    return "memories marked permanent";
  if (probe === "removals")
    return "the removal record";
  if (probe === "edges")
    return "the links table";
  if (probe === "feelings")
    return "memories carrying a recorded feeling";
  if (probe === "traits")
    return "memories carrying a trait nudge";
  if (probe === "emotion.weighted")
    return "memories a feeling holds higher and fades slower";
  if (probe === "returns.awake")
    return "the returns table (awake returns)";
  if (probe === "returns.dream")
    return "the returns table (dream replays)";
  if (probe === "dreamed")
    return "memories a dream wrote";
  return `the ${probe.replace(".", " ")} table`;
}
