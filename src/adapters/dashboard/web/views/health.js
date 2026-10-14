import { LAST_HERE_NOROOM_EVENT } from "../../../../core/handoff/last-here.js";
import { WORK_OVERFLOW_EVENT } from "../../../../core/self/work.js";
import { readPageTopLine } from "../../../../core/self/briefing.js";
import { symmetryCheck } from "../../../../core/physics/index.js";
import { MARKER_UNSET, MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON, readMarker } from "../../../../core/sleep/index.js";
import { cadenceFor, markerDue } from "../../../../core/sleep/markers.js";
import { localDate } from "../../../../core/time.js";
import { NEVER, NONE } from "../../layout.js";
import { CYCLE_PHASES, DURABLE_EVENTS, DURABLE_EVENT_NAMES, KINDS } from "../../registries.js";
import { isSleepCheck } from "../lanes.js";
import { reveal, revealHere } from "../reveal.js";
import { ARCHIVE_PHRASES, REMOVED_BY_OWNER, unmappedArchiveWords } from "./archive-words.js";
import { lastRender, wakePartLabel, wakeParts } from "./mind.js";
import { LOG_CEILING, eventCountsByName } from "./shared.js";
const PAGE_CUT = /\[This page is (\d+) bytes; the wake shows the first (\d+)\./;
export function pageCostOf(text) {
  const cut = PAGE_CUT.exec(text);
  if (cut !== null)
    return { whole: Number(cut[1]), shown: Number(cut[2]), rung: "cut" };
  const top = readPageTopLine(text);
  if (top === null || top.rung === "whole" || top.rung === "short")
    return null;
  return { whole: top.wholeBytes, shown: 0, rung: top.rung };
}
export function wakeCosts(src, text, renderDay) {
  const page = pageCostOf(text);
  const dropped = new Set;
  try {
    const since = renderDay ?? src.store.livedDay();
    for (const row of src.store.eventLog({ name: "handoff.refused", sinceDay: since, order: "desc", limit: LOG_CEILING })) {
      if (payloadOf(row.payload)["reason"] === "no-room")
        dropped.add(row.ref ?? `seq:${row.seq}`);
    }
  } catch {}
  const lastHere = new Set;
  try {
    const since = renderDay ?? src.store.livedDay();
    for (const row of src.store.eventLog({ name: LAST_HERE_NOROOM_EVENT, sinceDay: since, order: "desc", limit: LOG_CEILING })) {
      lastHere.add(row.ref ?? `seq:${row.seq}`);
    }
  } catch {}
  const work = new Set;
  try {
    const since = renderDay ?? src.store.livedDay();
    for (const row of src.store.eventLog({ name: WORK_OVERFLOW_EVENT, sinceDay: since, order: "desc", limit: LOG_CEILING })) {
      const p = payloadOf(row.payload);
      if (p["cause"] === "room")
        work.add(typeof p["scope"] === "string" ? p["scope"] : `seq:${row.seq}`);
    }
  } catch {}
  let writerHeld = false;
  try {
    const last = src.self.pageWriterRuns({ limit: 1 })[0];
    if (last !== undefined) {
      const s = src.self.pageWriterStatus(last.about, src.self.calendarToday());
      writerHeld = s.outcome !== "revised" && s.outcome !== "nothing-to-say" && (s.run?.detail ?? "").trim() === "no-room";
    }
  } catch {
    writerHeld = false;
  }
  return { page, handoffs: dropped.size, lastHere: lastHere.size, work: work.size, writerHeld };
}
const NO_COSTS = { page: null, handoffs: 0, lastHere: 0, work: 0, writerHeld: false };
export function wakeBudget(src) {
  const wake = src.self.wake();
  const render = lastRender(src);
  if (!wake.ok)
    return { ok: false, bytes: 0, budget: render?.budget ?? null, parts: [], trimmed: 0, trimmedFrom: [], costs: NO_COSTS };
  return {
    ok: true,
    bytes: wake.bytes,
    budget: render?.budget ?? null,
    parts: wakeParts(wake.text, src.self.page() !== null),
    trimmed: render?.trimmed ?? 0,
    trimmedFrom: (render?.trimmedLanes ?? []).map(wakePartLabel),
    costs: wakeCosts(src, wake.text, render?.day ?? null)
  };
}
const PHASE_GLOSS = {
  clock: "start the next day of use",
  decay: "let unused memories weaken",
  consolidate: "strengthen and promote what was used",
  prune: "let go of what fell to the floor",
  fade: "fade cards nothing mentions any more",
  dedup: "merge duplicates",
  versions: "tidy old versions",
  briefing: "write the next wake briefing",
  log: "sweep old log rows"
};
const CYCLE_LOOKBACK = 60;
function payloadOf(raw) {
  if (raw === null)
    return {};
  try {
    const v = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
const ALWAYS_SHOWN = new Set([PRUNE_ARCHIVE_REASON, MERGE_ARCHIVE_REASON, REMOVED_BY_OWNER]);
const ARCHIVE_ITEMS_CAP = 200;
const ADAPTER_EVENTS = [
  "adapter.ask",
  "adapter.boundary",
  "adapter.recall",
  "adapter.wake.injected",
  "adapter.wake.delivered",
  "adapter.primacy.deliver",
  "adapter.primacy.standdown",
  "adapter.embed.backfill",
  "adapter.semantic.lag",
  "adapter.authorship.ask",
  "adapter.episode.ask"
];
const ADAPTER_NOTE = {
  "adapter.wake.injected": "bytes handed to the host, never the text",
  "adapter.wake.delivered": "whether the briefing actually arrived, checked at the first prompt or the first Stop",
  "adapter.recall": "how long recall took, when the adapter recorded it",
  "adapter.ask": "asked, paced out, or capped for the day",
  "adapter.authorship.ask": "historical — nothing writes this now",
  "adapter.episode.ask": "historical — nothing writes this now"
};
export function healthView(src) {
  const store = src.store;
  const day = store.livedDay();
  const everLived = day > 0 || store.list().length > 0;
  const phases = CYCLE_PHASES.map((phase) => {
    const marker = readMarker(store, phase);
    if (marker.health === "torn") {
      return { phase, day: null, ago: null, torn: true, absent: "torn marker" };
    }
    if (marker.day === MARKER_UNSET)
      return { phase, day: null, ago: null, torn: false, absent: NEVER };
    return { phase, day: marker.day, ago: Math.max(0, day - marker.day), torn: false, absent: null };
  });
  const transitions = store.eventLog({ name: "band.transition", order: "desc", limit: LOG_CEILING });
  const symmetry = KINDS.map((kind) => {
    let up = 0;
    let down = 0;
    let unexplained = 0;
    for (const row of transitions) {
      if (row.payload === null)
        continue;
      try {
        const p = JSON.parse(row.payload);
        if (p.kind !== kind)
          continue;
        if (p.cause === "recurve")
          continue;
        if (p.direction === "up") {
          up += 1;
          if (p.cause === "unexplained")
            unexplained += 1;
        } else if (p.direction === "down")
          down += 1;
      } catch {
        continue;
      }
    }
    const verdict = symmetryCheck(kind, { up, down, unexplained });
    return { kind, up, down, unexplained, reason: verdict.reason, ok: verdict.reason === "within-expectation" };
  });
  const counts = eventCountsByName(src);
  const records = DURABLE_EVENT_NAMES.map((name) => {
    const count = counts.get(name) ?? 0;
    const adapter = ADAPTER_EVENTS.includes(name);
    return {
      name,
      gloss: DURABLE_EVENTS[name],
      count,
      absent: count === 0 ? NEVER : null,
      adapter,
      note: adapter ? ADAPTER_NOTE[name] ?? "counts and reasons; never text" : null
    };
  }).sort((a, b) => b.count === a.count ? 0 : b.count - a.count);
  const span = 21;
  const from = Math.max(0, day - span + 1);
  const days = Array.from({ length: Math.max(1, Math.min(span, day + 1)) }, (_, i) => from + i);
  const cells = [];
  for (const name of DURABLE_EVENT_NAMES) {
    const rows = store.eventLog({ name, sinceDay: from, order: "desc", limit: LOG_CEILING });
    const per = new Map;
    for (const row of rows)
      per.set(row.day, (per.get(row.day) ?? 0) + 1);
    for (const d of days)
      cells.push({ day: d, name, count: per.get(d) ?? 0 });
  }
  const removals = store.removalRecord().map((x) => ({
    id: x.memory_id,
    label: reveal(store, x.memory_id, 72).label,
    stage: x.stage,
    actor: x.actor,
    reason: x.reason,
    at: x.at
  }));
  const newest = phases.reduce((m, p) => p.day === null ? m : m === null ? p.day : Math.max(m, p.day), null);
  const lastCycleRow = store.eventLog({ name: "sleep.cycle", order: "desc", limit: CYCLE_LOOKBACK }).find((row) => !isSleepCheck(payloadOf(row.payload)));
  const cyclePhases = phases.map((p) => {
    const cadence = cadenceFor(p.phase);
    const state = p.torn ? "torn" : p.day === null ? "never" : p.day === newest ? "ran" : newest !== null && markerDue(p.day, newest, cadence) === "due" ? "behind" : "waiting";
    const nextInDays = state === "waiting" && p.day !== null ? Math.max(0, p.day + cadence - day) : null;
    return { phase: p.phase, gloss: PHASE_GLOSS[p.phase] ?? p.phase, state, day: p.day, nextInDays };
  });
  const cycleOn = lastCycleRow === undefined ? null : localDate(lastCycleRow.at, store.zone()) || null;
  const cycle = {
    day: newest,
    at: lastCycleRow === undefined ? null : lastCycleRow.at,
    on: cycleOn,
    today: cycleOn !== null && cycleOn === store.today(),
    ran: cyclePhases.filter((p) => p.state === "ran").length,
    waiting: cyclePhases.filter((p) => p.state === "waiting").length,
    total: cyclePhases.length,
    phases: cyclePhases
  };
  const archivedAt = new Map;
  const byReason = new Map;
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || row.archived !== 1)
      continue;
    const reason = row.archived_reason ?? "";
    if (reason === REMOVED_BY_OWNER)
      continue;
    archivedAt.set(id, row.updated_at ?? row.created_at ?? 0);
    const ids = byReason.get(reason) ?? [];
    ids.push(id);
    byReason.set(reason, ids);
  }
  const newestFirst = (ids, at) => [...ids].sort((a, b) => at(b) - at(a) || (a < b ? -1 : 1));
  const removedLatest = new Map;
  for (const r of removals)
    removedLatest.set(r.id, r);
  const removedIds = new Set(removedLatest.keys());
  for (const id of store.list()) {
    const row = store.row(id);
    if (row !== undefined && row.archived === 1 && row.archived_reason === REMOVED_BY_OWNER)
      removedIds.add(id);
  }
  const reasons = [];
  const memoryOf = (id) => {
    try {
      const ep = store.readProse(id).meta["episodeId"];
      return typeof ep === "string" && ep.length > 0 ? `episode:${ep}` : id;
    } catch {
      return id;
    }
  };
  const itemsOf = (ids) => {
    const items = [];
    const byMemory = new Map;
    let listed = 0;
    for (const id of newestFirst(ids, (x) => archivedAt.get(x) ?? 0)) {
      const key = memoryOf(id);
      const same = byMemory.get(key);
      if (same !== undefined) {
        same.times += 1;
        listed += 1;
        continue;
      }
      if (items.length >= ARCHIVE_ITEMS_CAP)
        break;
      const r = revealHere(store, id, 90);
      const item = { id, label: r.text ?? r.label, note: null, times: 1 };
      items.push(item);
      byMemory.set(key, item);
      listed += 1;
    }
    return { items, listed };
  };
  for (const [reason, phrase] of ARCHIVE_PHRASES) {
    if (reason === REMOVED_BY_OWNER) {
      const ids = [...removedIds];
      if (ids.length === 0 && !ALWAYS_SHOWN.has(reason))
        continue;
      const items = newestFirst(ids, (id) => removedLatest.get(id)?.at ?? 0).slice(0, ARCHIVE_ITEMS_CAP).map((id) => {
        const rec = removedLatest.get(id);
        return {
          id,
          label: rec?.label ?? reveal(store, id, 72).label,
          note: rec === undefined ? null : `${rec.stage} · by ${rec.actor}${rec.reason ? ` · ${rec.reason}` : ""}`,
          times: 1
        };
      });
      reasons.push({ reason, phrase, count: ids.length, known: true, listed: items.length, items });
      continue;
    }
    const ids = byReason.get(reason) ?? [];
    byReason.delete(reason);
    if (ids.length === 0 && !ALWAYS_SHOWN.has(reason))
      continue;
    reasons.push({ reason, phrase, count: ids.length, known: true, ...itemsOf(ids) });
  }
  for (const [reason, ids] of byReason) {
    reasons.push({
      reason: reason === "" ? "(none)" : reason,
      phrase: unmappedArchiveWords(reason),
      count: ids.length,
      known: false,
      ...itemsOf(ids)
    });
  }
  const archive = { total: reasons.reduce((n, r) => n + r.count, 0), reasons };
  return {
    cycle,
    archive,
    wake: wakeBudget(src),
    phases,
    symmetry,
    records,
    heatmap: { days, names: [...DURABLE_EVENT_NAMES], cells },
    removals,
    removalsAbsent: removals.length === 0 ? everLived ? NONE : NEVER : null,
    blind: BLIND_SPOTS
  };
}
export const BLIND_SPOTS = [
  {
    what: "What one cycle did.",
    why: "There is no durable per-cycle outcome record — the report goes back to its caller and is gone. What survives is each phase's completion marker and each row's archived-with-reason state, so every exit count on this page is SINCE BIRTH, never 'this cycle'."
  },
  {
    what: "A protected element I can no longer read.",
    why: "Protection is a flag on the row whose physics stopped reading, so a removed protected element simply leaves the list. The identity band is queryable and that half is recovered above; this half is not (INTERFACE-GAPS §3)."
  },
  {
    what: "Recall latency, unless an adapter recorded it.",
    why: "The core times its own surfacing race and reports it in the decision row. A turn whose adapter wrote no `adapter.recall` leaves no latency behind at all."
  },
  {
    what: "Anything older than the retention window.",
    why: "The event log is bounded telemetry, not canonical memory. Rows past the window are swept unless a replay latch holds them, so every count on this page is 'what I still have', not 'what ever happened'."
  },
  {
    what: "Whether a memory was ever actually useful to you.",
    why: "I record that the reply used it, which is the closest thing I have. Whether it helped is a judgement only you can make, and nothing here should be read as evidence of it."
  },
  {
    what: "Anything a host did not tell me.",
    why: "The wake bundle's arrival, the ask's outcome, the bytes injected — all of it reaches me only if the adapter wrote a row. Silence on this page is sometimes the adapter's silence, not the machine's."
  }
];
