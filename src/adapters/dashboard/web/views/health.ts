/**
 * `/api/health`.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { LAST_HERE_NOROOM_EVENT } from "../../../../core/handoff/last-here.js";
import { WORK_OVERFLOW_EVENT } from "../../../../core/self/work.js";
import { readPageTopLine } from "../../../../core/self/briefing.js";
import { symmetryCheck } from "../../../../core/physics/index.js";
import { MARKER_UNSET, MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON, readMarker } from "../../../../core/sleep/index.js";
import { cadenceFor, markerDue } from "../../../../core/sleep/markers.js";
import type { Phase } from "../../../../core/sleep/types.js";
import type { Kind } from "../../../../core/types.js";
import { localDate } from "../../../../core/time.js";
import { NEVER, NONE } from "../../layout.js";
import { CYCLE_PHASES, DURABLE_EVENTS, DURABLE_EVENT_NAMES, KINDS } from "../../registries.js";
import type { DurableEventName } from "../../registries.js";
import type { DashboardSource } from "../../source.js";
import { isSleepCheck } from "../lanes.js";
import { reveal, revealHere } from "../reveal.js";

import { ARCHIVE_PHRASES, REMOVED_BY_OWNER, unmappedArchiveWords } from "./archive-words.js";
import { lastRender, wakePartLabel, wakeParts } from "./mind.js";
import type { WakePart } from "./mind.js";
import { LOG_CEILING, eventCountsByName } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// health
// ─────────────────────────────────────────────────────────────────────────────

export interface HealthView {
  readonly phases: { phase: string; day: number | null; ago: number | null; torn: boolean; absent: string | null }[];
  readonly symmetry: { kind: Kind; up: number; down: number; unexplained: number; reason: string; ok: boolean }[];
  /**
   * ONE TABLE, LED BY ENGLISH. There were two — "what a host told me" over the
   * eleven `adapter.*` names, and "everything I can record durably" over all
   * nineteen — so seven identifiers were listed twice on one screen with
   * near-duplicate glosses, and the first thing the health tab showed a person
   * was 23 dotted names against a column of `(never run)` (design review,
   * 2026-09-04, §9 and ranked #4). The gloss each row already carried in its
   * third column now LEADS it and the dotted name is the second line, which is
   * the order a reader needs them in: what this records, then what it is
   * called. `adapter` says whether a host wrote it or the machinery did — the
   * only thing the split table was really saying — and `note` carries the
   * adapter-specific caveat the old table had room for.
   */
  readonly records: {
    name: DurableEventName;
    gloss: string;
    count: number;
    absent: string | null;
    adapter: boolean;
    note: string | null;
  }[];
  readonly heatmap: { days: number[]; names: string[]; cells: { day: number; name: string; count: number }[] };
  readonly removals: { id: string; label: string; stage: string; actor: string; reason: string | null; at: number }[];
  readonly removalsAbsent: string | null;
  readonly blind: readonly { readonly what: string; readonly why: string }[];
  /**
   * THE LAST CYCLE, as one line: the newest lived day any phase finished on,
   * which phases finished that day, and when the newest `sleep.cycle` row that
   * did something was written — a check that found nothing due is passed over —
   * (ms; null when none is held) so the page can say "today" only when it was.
   */
  readonly cycle: {
    readonly day: number | null;
    readonly at: number | null;
    /**
     * `at`'s calendar day in the person's zone (`store.zone()`), and whether it
     * is today there — dated by the server, so the line agrees with every
     * other date on the page (review of #335, 2026-10-09). Null with `at`.
     */
    readonly on: string | null;
    readonly today: boolean;
    readonly ran: number;
    /** Phases that did not run because their cadence had not come round: not a problem. */
    readonly waiting: number;
    readonly total: number;
    readonly phases: { phase: string; gloss: string; state: "ran" | "waiting" | "behind" | "never" | "torn"; day: number | null; nextInDays: number | null }[];
  };
  /**
   * WHERE ARCHIVED MEMORIES WENT — every archived row counted by its
   * `archived_reason`, each reason in plain words, with the ids behind it so a
   * segment can list them. "Removed by you" is the removal record's memories
   * (a removed row keeps only a skeleton), with its stage and reason.
   *
   * ONE LINE PER MEMORY, NOT PER ROW (2026-10-01): a chapter rebuilt from the
   * journal archives its previous copy every time, so the list read 61 rows
   * for 23 distinct memories (Fable's review of Health, 2026-09-28). The
   * copies of one chapter (one `episodeId`) are one item, with `times` saying
   * how many rows it stands for and `id` the newest of them; every other row
   * is its own item, whatever its words. `listed` is how many rows the items
   * cover, so "older, not listed" counts rows, as `count` does.
   */
  readonly archive: {
    readonly total: number;
    readonly reasons: {
      reason: string;
      phrase: string;
      count: number;
      known: boolean;
      listed: number;
      items: { id: string; label: string; note: string | null; times: number }[];
    }[];
  };
  /**
   * IS THE WAKE OVERFLOWING? (round 3b, item 3 — moved here from the self
   * tab): the published wake's size in its parts against the ceiling the last
   * render was composed to, and how many elements that render trimmed to fit.
   */
  readonly wake: WakeBudget;
}

export interface WakeBudget {
  /** False when no wake has been published. */
  readonly ok: boolean;
  readonly bytes: number;
  /** The ceiling the newest render recorded; null when none did. */
  readonly budget: number | null;
  /** The published wake cut into its parts, in the order it reads. */
  readonly parts: WakePart[];
  /** Elements the newest render dropped to fit, and the parts they came from. */
  readonly trimmed: number;
  readonly trimmedFrom: string[];
  /** What a full wake COST, read from what is recorded (see `wakeCosts`). */
  readonly costs: WakeCosts;
}

/**
 * WHAT A FULL WAKE COST (Mike, 2026-10-01: a full wake is the normal state, so
 * it is green; amber only when being full cost something, and the amber names
 * it). Each from a record that already exists:
 *
 *   page       — the published wake itself, read off its page's top line
 *                (`briefing.ts#readPageTopLine`, 2026-10-10): a page shown as
 *                its outline, its headings, or one line. The page whole or its
 *                short version costs nothing — doctor is green for both. A
 *                wake published before 2026-10-09 may carry a cut page's
 *                `page.ts#truncationMarker` instead. Each names bytes.
 *   handoffs   — `handoff.refused` rows with reason `no-room` (durable, one per
 *                handoff per lived day) since the published wake was rendered:
 *                how many distinct handoffs a session start could not carry.
 *   writerHeld — the newest page-writer night was held back for lack of room
 *                (`no-room`, the retired session-start ask's reason; old rows
 *                still carry it).
 *
 *   lastHere   — `handoff.lasthere.noroom` rows (durable since 2026-10-01,
 *                one per chapter per lived day) since the published wake was
 *                rendered: how many "Last here" lines a session start could
 *                not carry. Until then a ring event only, gone with the hook.
 *   work       — `self.work.overflow` rows with cause `room` (durable since
 *                2026-10-02, one per directory per lived day) since the
 *                published wake was rendered: how many directories' "Work
 *                here" lines did not all fit. More work than a wake shows
 *                (cause `cap`) is the rotation, not a cost.
 */
export interface WakeCosts {
  /** `rung` (2026-10-10): `cut` for an old bundle's marker, else the ladder's rung. */
  readonly page: { readonly shown: number; readonly whole: number; readonly rung: "cut" | "outline" | "headings" | "line" } | null;
  readonly handoffs: number;
  readonly lastHere: number;
  readonly work: number;
  readonly writerHeld: boolean;
}

/** `page.ts#truncationMarker`, as a wake published before 2026-10-09 (when
 *  the page could be cut) printed it. */
const PAGE_CUT = /\[This page is (\d+) bytes; the wake shows the first (\d+)\./;

/** The self page's cost, read off the published wake's own words. Pure. */
export function pageCostOf(text: string): WakeCosts["page"] {
  const cut = PAGE_CUT.exec(text);
  if (cut !== null) return { whole: Number(cut[1]), shown: Number(cut[2]), rung: "cut" };
  const top = readPageTopLine(text);
  if (top === null || top.rung === "whole" || top.rung === "short") return null;
  return { whole: top.wholeBytes, shown: 0, rung: top.rung };
}

export function wakeCosts(src: DashboardSource, text: string, renderDay: number | null): WakeCosts {
  const page = pageCostOf(text);

  const dropped = new Set<string>();
  try {
    const since = renderDay ?? src.store.livedDay();
    for (const row of src.store.eventLog({ name: "handoff.refused", sinceDay: since, order: "desc", limit: LOG_CEILING })) {
      if (payloadOf(row.payload)["reason"] === "no-room") dropped.add(row.ref ?? `seq:${row.seq}`);
    }
  } catch {
    /* no rows read is no handoff known to be dropped */
  }

  const lastHere = new Set<string>();
  try {
    const since = renderDay ?? src.store.livedDay();
    for (const row of src.store.eventLog({ name: LAST_HERE_NOROOM_EVENT, sinceDay: since, order: "desc", limit: LOG_CEILING })) {
      lastHere.add(row.ref ?? `seq:${row.seq}`);
    }
  } catch {
    /* no rows read is no line known to be dropped */
  }

  const work = new Set<string>();
  try {
    const since = renderDay ?? src.store.livedDay();
    for (const row of src.store.eventLog({ name: WORK_OVERFLOW_EVENT, sinceDay: since, order: "desc", limit: LOG_CEILING })) {
      const p = payloadOf(row.payload);
      if (p["cause"] === "room") work.add(typeof p["scope"] === "string" ? p["scope"] : `seq:${row.seq}`);
    }
  } catch {
    /* no rows read is no line known to be dropped */
  }

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

const NO_COSTS: WakeCosts = { page: null, handoffs: 0, lastHere: 0, work: 0, writerHeld: false };

/** The wake against its ceiling. A read: `wake()` on the observer source writes nothing. */
export function wakeBudget(src: DashboardSource): WakeBudget {
  const wake = src.self.wake();
  const render = lastRender(src);
  if (!wake.ok) return { ok: false, bytes: 0, budget: render?.budget ?? null, parts: [], trimmed: 0, trimmedFrom: [], costs: NO_COSTS };
  return {
    ok: true,
    bytes: wake.bytes,
    budget: render?.budget ?? null,
    parts: wakeParts(wake.text, src.self.page() !== null),
    trimmed: render?.trimmed ?? 0,
    trimmedFrom: (render?.trimmedLanes ?? []).map(wakePartLabel),
    costs: wakeCosts(src, wake.text, render?.day ?? null),
  };
}

/** Each phase of the cycle, in a few plain words (hover text on its dot). */
const PHASE_GLOSS: Record<string, string> = {
  clock: "move the lived day on",
  decay: "let unused memories weaken",
  consolidate: "strengthen and promote what was used",
  prune: "let go of what fell to the floor",
  fade: "fade cards nothing mentions any more",
  dedup: "merge duplicates",
  versions: "tidy old versions",
  briefing: "write the next wake briefing",
  log: "sweep old log rows",
};

/** How many `sleep.cycle` rows the cycle line reads past checks for the newest real sleep. */
const CYCLE_LOOKBACK = 60;

/** A row's payload as an object; anything unreadable is an empty one. */
function payloadOf(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Shown even at zero: the three ways out that are forgetting by design. */
const ALWAYS_SHOWN = new Set<string>([PRUNE_ARCHIVE_REASON, MERGE_ARCHIVE_REASON, REMOVED_BY_OWNER]);
/** How many ids one segment carries to the page. */
const ARCHIVE_ITEMS_CAP = 200;

/** The events an ADAPTER writes — the only ones that can tell the owner what a
 *  host actually did with what was composed for it. */
const ADAPTER_EVENTS: readonly DurableEventName[] = [
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
  "adapter.episode.ask",
];

const ADAPTER_NOTE: Partial<Record<DurableEventName, string>> = {
  "adapter.wake.injected": "bytes handed to the host, never the text",
  "adapter.wake.delivered": "whether the briefing actually arrived, checked at the first prompt or the first Stop",
  "adapter.recall": "how long recall took, when the adapter recorded it",
  "adapter.ask": "asked, paced out, or capped for the day",
  "adapter.authorship.ask": "historical — nothing writes this now",
  "adapter.episode.ask": "historical — nothing writes this now",
};

export function healthView(src: DashboardSource): HealthView {
  const store = src.store;
  const day = store.livedDay();
  const everLived = day > 0 || store.list().length > 0;

  const phases = CYCLE_PHASES.map((phase) => {
    const marker = readMarker(store, phase);
    if (marker.health === "torn") {
      return { phase, day: null, ago: null, torn: true, absent: "torn marker" };
    }
    if (marker.day === MARKER_UNSET) return { phase, day: null, ago: null, torn: false, absent: NEVER };
    return { phase, day: marker.day, ago: Math.max(0, day - marker.day), torn: false, absent: null };
  });

  const transitions = store.eventLog({ name: "band.transition", order: "desc", limit: LOG_CEILING });
  const symmetry = KINDS.map((kind) => {
    let up = 0;
    let down = 0;
    let unexplained = 0;
    for (const row of transitions) {
      if (row.payload === null) continue;
      try {
        const p = JSON.parse(row.payload) as { kind?: string; direction?: string; cause?: string };
        if (p.kind !== kind) continue;
        // A new curve's own moves (`recurve`, review of #372) are not counted.
        if (p.cause === "recurve") continue;
        if (p.direction === "up") {
          up += 1;
          if (p.cause === "unexplained") unexplained += 1;
        } else if (p.direction === "down") down += 1;
      } catch {
        continue;
      }
    }
    // Only an UP-ratchet is an alarm (2026-10-10, `physics#symmetryCheck`).
    const verdict = symmetryCheck(kind, { up, down, unexplained });
    return { kind, up, down, unexplained, reason: verdict.reason, ok: verdict.reason === "within-expectation" };
  });

  // The merged record table. Every durable name appears exactly once — the
  // totality rule is unchanged, and the test still walks `DURABLE_EVENT_NAMES`
  // against it — but what HAS happened is ordered above what never has, so the
  // first screen of this tab is the log's actual contents rather than eleven
  // adapter names nobody has ever run. The order is stated on the page.
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
      note: adapter ? (ADAPTER_NOTE[name] ?? "counts and reasons; never text") : null,
    };
  }).sort((a, b) => (b.count === a.count ? 0 : b.count - a.count));

  // The heatmap: lived day × event name. Bounded to the last 21 lived days so a
  // long-lived store still fits on a screen without a scrollbar in two axes.
  const span = 21;
  const from = Math.max(0, day - span + 1);
  const days = Array.from({ length: Math.max(1, Math.min(span, day + 1)) }, (_, i) => from + i);
  const cells: { day: number; name: string; count: number }[] = [];
  for (const name of DURABLE_EVENT_NAMES) {
    // Newest first: past the ceiling the missing rows are the window's oldest
    // days, not today's (an ascending read kept the oldest and emptied the right edge).
    const rows = store.eventLog({ name, sinceDay: from, order: "desc", limit: LOG_CEILING });
    const per = new Map<number, number>();
    for (const row of rows) per.set(row.day, (per.get(row.day) ?? 0) + 1);
    for (const d of days) cells.push({ day: d, name, count: per.get(d) ?? 0 });
  }

  const removals = store.removalRecord().map((x) => ({
    id: x.memory_id,
    label: reveal(store, x.memory_id, 72).label,
    stage: x.stage,
    actor: x.actor,
    reason: x.reason,
    at: x.at,
  }));

  // The last cycle: the newest day any phase finished on is "the last cycle".
  // A phase whose marker is older than that is behind ONLY if it was due that
  // day by its own cadence (consolidate runs every few lived days, not
  // nightly); one that simply wasn't due yet is waiting, with its next run.
  const newest = phases.reduce<number | null>((m, p) => (p.day === null ? m : m === null ? p.day : Math.max(m, p.day)), null);
  // WHEN, from the newest cycle that DID something: a session end on a day
  // that already slept writes a check row ("nothing was due"), and taking the
  // newest row of all said "Sleep last ran today" of a night that ran
  // yesterday (Fable's review of Health, 2026-09-28). None in the window: the
  // line says the lived day alone.
  const lastCycleRow = store
    .eventLog({ name: "sleep.cycle", order: "desc", limit: CYCLE_LOOKBACK })
    .find((row) => !isSleepCheck(payloadOf(row.payload)));
  const cyclePhases = phases.map((p) => {
    const cadence = cadenceFor(p.phase as Phase);
    const state = p.torn
      ? ("torn" as const)
      : p.day === null
        ? ("never" as const)
        : p.day === newest
          ? ("ran" as const)
          : newest !== null && markerDue(p.day, newest, cadence) === "due"
            ? ("behind" as const)
            : ("waiting" as const);
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
    phases: cyclePhases,
  };

  // Where archived memories went. One pass over the rows, then the removal
  // record for "removed by you" (a removed row keeps only a skeleton, so its
  // words are gone and the record is what says what happened).
  // NEWEST FIRST: each list carries at most `ARCHIVE_ITEMS_CAP`, and in id
  // order (random) those were an arbitrary 200. Archiving stamps `updated_at`,
  // so it is the moment each one left.
  const archivedAt = new Map<string, number>();
  const byReason = new Map<string, string[]>();
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || row.archived !== 1) continue;
    const reason = row.archived_reason ?? "";
    if (reason === REMOVED_BY_OWNER) continue;
    archivedAt.set(id, row.updated_at ?? row.created_at ?? 0);
    const ids = byReason.get(reason) ?? [];
    ids.push(id);
    byReason.set(reason, ids);
  }
  const newestFirst = (ids: readonly string[], at: (id: string) => number): string[] =>
    [...ids].sort((a, b) => at(b) - at(a) || (a < b ? -1 : 1));
  const removedLatest = new Map<string, (typeof removals)[number]>();
  for (const r of removals) removedLatest.set(r.id, r);
  const removedIds = new Set<string>(removedLatest.keys());
  for (const id of store.list()) {
    const row = store.row(id);
    if (row !== undefined && row.archived === 1 && row.archived_reason === REMOVED_BY_OWNER) removedIds.add(id);
  }
  const reasons: HealthView["archive"]["reasons"] = [];
  type Item = HealthView["archive"]["reasons"][number]["items"][number];
  /** Which MEMORY a row is a copy of: a chapter's journal copies share the
   *  chapter's `episodeId` (`self/episodes.ts#memoriesForEpisode`); any other
   *  row is its own memory. Never the words, which two memories can share. */
  const memoryOf = (id: string): string => {
    try {
      const ep = store.readProse(id).meta["episodeId"];
      return typeof ep === "string" && ep.length > 0 ? `episode:${ep}` : id;
    } catch {
      return id;
    }
  };
  /** Newest first, the copies of one memory as one item (the newest row's id),
   *  at most `ARCHIVE_ITEMS_CAP` items; `listed` is the rows they cover. */
  const itemsOf = (ids: readonly string[]): { items: Item[]; listed: number } => {
    const items: Item[] = [];
    const byMemory = new Map<string, Item>();
    let listed = 0;
    for (const id of newestFirst(ids, (x) => archivedAt.get(x) ?? 0)) {
      const key = memoryOf(id);
      const same = byMemory.get(key);
      if (same !== undefined) {
        same.times += 1;
        listed += 1;
        continue;
      }
      if (items.length >= ARCHIVE_ITEMS_CAP) break;
      // The archived row's OWN words (not its successor's) when they can be
      // shown; otherwise the named absence or the withholding.
      const r = revealHere(store, id, 90);
      const item: Item = { id, label: r.text ?? r.label, note: null, times: 1 };
      items.push(item);
      byMemory.set(key, item);
      listed += 1;
    }
    return { items, listed };
  };
  for (const [reason, phrase] of ARCHIVE_PHRASES) {
    if (reason === REMOVED_BY_OWNER) {
      const ids = [...removedIds];
      if (ids.length === 0 && !ALWAYS_SHOWN.has(reason)) continue;
      // Each removal is its own act, with its own stage and reason: one row each.
      const items = newestFirst(ids, (id) => removedLatest.get(id)?.at ?? 0).slice(0, ARCHIVE_ITEMS_CAP).map((id) => {
        const rec = removedLatest.get(id);
        return {
          id,
          label: rec?.label ?? reveal(store, id, 72).label,
          note: rec === undefined ? null : `${rec.stage} · by ${rec.actor}${rec.reason ? ` · ${rec.reason}` : ""}`,
          times: 1,
        };
      });
      reasons.push({ reason, phrase, count: ids.length, known: true, listed: items.length, items });
      continue;
    }
    const ids = byReason.get(reason) ?? [];
    byReason.delete(reason);
    if (ids.length === 0 && !ALWAYS_SHOWN.has(reason)) continue;
    reasons.push({ reason, phrase, count: ids.length, known: true, ...itemsOf(ids) });
  }
  for (const [reason, ids] of byReason) {
    reasons.push({
      reason: reason === "" ? "(none)" : reason,
      phrase: unmappedArchiveWords(reason),
      count: ids.length,
      known: false,
      ...itemsOf(ids),
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
    removalsAbsent: removals.length === 0 ? (everLived ? NONE : NEVER) : null,
    blind: BLIND_SPOTS,
  };
}

/**
 * WHAT I CANNOT SEE — the named absences, in the shape the terminal `status`
 * view established: a number I do not durably hold is stated as a number I do
 * not hold, never invented to fill a panel. Every line here is a real gap, and
 * three of them are filed in `INTERFACE-GAPS.md`.
 */
export const BLIND_SPOTS: readonly { readonly what: string; readonly why: string }[] = [
  {
    what: "What one cycle did.",
    why: "There is no durable per-cycle outcome record — the report goes back to its caller and is gone. What survives is each phase's completion marker and each row's archived-with-reason state, so every exit count on this page is SINCE BIRTH, never 'this cycle'.",
  },
  {
    what: "A protected element I can no longer read.",
    why: "Protection is a flag on the row whose physics stopped reading, so a removed protected element simply leaves the list. The identity band is queryable and that half is recovered above; this half is not (INTERFACE-GAPS §3).",
  },
  {
    what: "Recall latency, unless an adapter recorded it.",
    why: "The core times its own surfacing race and reports it in the decision row. A turn whose adapter wrote no `adapter.recall` leaves no latency behind at all.",
  },
  {
    what: "Anything older than the retention window.",
    why: "The event log is bounded telemetry, not canonical memory. Rows past the window are swept unless a replay latch holds them, so every count on this page is 'what I still have', not 'what ever happened'.",
  },
  {
    what: "Whether a memory was ever actually useful to you.",
    why: "I record that the reply used it, which is the closest thing I have. Whether it helped is a judgement only you can make, and nothing here should be read as evidence of it.",
  },
  {
    what: "Anything a host did not tell me.",
    why: "The wake bundle's arrival, the ask's outcome, the bytes injected — all of it reaches me only if the adapter wrote a row. Silence on this page is sometimes the adapter's silence, not the machine's.",
  },
];

/** Everything the terminal views print, as one number each — the JSON the app's
 *  header badge reads without pulling a whole page. */
