/**
 * GROWTH — every growing table has a named exit, and one line here each (FD1
 * step 2, 2026-11-07, Mike's "wherever something is growing, consider fading
 * more"; lightly held, re-read ~3 lived days after install: CHECK-AFTER).
 *
 * One finding per growing thing: how full it is, what came in and what left
 * over the last `GROWTH_WINDOW_DAYS` lived days, and which is faster. The
 * association edges are counted on the `Association` line (`doctor.ts`), not
 * twice. Every line is GREEN: a ratio alone is not a fault (guards loose
 * first), and the numbers are for the person who re-reads them.
 *
 * Not in the session-start reading: the memories line walks every live row.
 */
import { SHORT_RETENTION_NAMES, EVENTS_ROLLED_EVENT } from "../../core/store/index.js";
import type { Store } from "../../core/store/index.js";
import { SLEEP_CYCLE_EVENT } from "../../core/counterpart-events.js";
import { LOG_SWEEP_EVENT, TUNABLES as SLEEP_TUNABLES } from "../../core/sleep/index.js";
import { TUNABLES as ASSOCIATE_TUNABLES } from "../../core/associate/index.js";
import { TUNABLES as PHYSICS_TUNABLES } from "../../core/physics/index.js";
import { finding, num, payloadOf } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

/** The window every Growth line reads, in lived days. */
export const GROWTH_WINDOW_DAYS = 7;
/** Rows of one name a Growth line reads in its window; a full read is a floor. */
const GROWTH_ROWS = 5_000;

export interface GrowthWindow {
  readonly day: number;
  readonly since: number;
  /** The moment lived day `since` began, or null when the log holds nothing that recent. */
  readonly sinceAt: number | null;
}

export function growthWindow(store: Store): GrowthWindow {
  const day = store.livedDay();
  const since = Math.max(0, day - GROWTH_WINDOW_DAYS + 1);
  return { day, since, sinceAt: store.livedDayStartAt(since) };
}

/** "growing faster than it leaves (+12)", "leaving faster than it grows (−3)", "steady". */
export function pace(cameIn: number, left: number): string {
  if (cameIn > left) return `growing faster than it leaves (+${String(cameIn - left)})`;
  if (left > cameIn) return `leaving faster than it grows (−${String(left - cameIn)})`;
  return "steady";
}

function n(x: number): string {
  return x.toLocaleString("en-US");
}

function windowWords(): string {
  return `last ${String(GROWTH_WINDOW_DAYS)} lived days`;
}

export function growthFindings(store: Store): Finding[] {
  let w: GrowthWindow;
  try {
    w = growthWindow(store);
  } catch {
    return [];
  }
  const out: Finding[] = [];
  for (const read of [memoriesLine, eventsLine, cuesLine, queueLine]) {
    try {
      const f = read(store, w);
      if (f !== null) out.push(f);
    } catch {
      // One line that will not read costs only itself.
    }
  }
  return out;
}

/** The newest-first rows of `name` in the window. */
function rowsIn(store: Store, name: string, w: GrowthWindow): ReturnType<Store["eventLog"]> {
  return store.eventLog({ name, sinceDay: w.since, order: "desc", limit: GROWTH_ROWS });
}

// ── memories ────────────────────────────────────────────────────────────────

/**
 * Exits: the night's prune (archived after 14 lived days under `PHI_PRUNE`), a
 * merge, a revision's old words, a card's fade. The prune walks a budget of
 * rows a night with a cursor (`sleep/prune.ts`), so a lap of the store takes
 * several nights; the line says how many. Rows the prune never examines are
 * counted apart, each with its own exit: the journal has none, by contract
 * (`sleep/CONTRACT.md` guarantee 15).
 */
function memoriesLine(store: Store, w: GrowthWindow): Finding {
  const c = store.reachCensus();
  const flow = w.sinceAt === null ? { born: 0, archived: 0 } : store.memoryFlow(w.since, w.sinceAt);
  let pruned = 0;
  let merged = 0;
  let faded = 0;
  let lastPrune: { exhausted: boolean; left: number } | null = null;
  for (const row of rowsIn(store, SLEEP_CYCLE_EVENT, w)) {
    const p = payloadOf(row);
    pruned += num(p, "pruned") ?? 0;
    merged += num(p, "merged") ?? 0;
    faded += num(p, "faded") ?? 0;
    if (lastPrune !== null || !Array.isArray(p["phases"])) continue;
    for (const ph of p["phases"] as unknown[]) {
      if (ph === null || typeof ph !== "object") continue;
      const e = ph as Record<string, unknown>;
      if (e["phase"] !== "prune" || typeof e["budgetExhausted"] !== "boolean") continue;
      lastPrune = { exhausted: e["budgetExhausted"], left: num(e, "skippedForBudget") ?? 0 };
    }
  }
  const budget = SLEEP_TUNABLES.BUDGETS.prune;
  const lap = lastPrune === null ? null : Math.max(1, Math.ceil((budget + lastPrune.left) / budget));
  const pruneSaid =
    lastPrune === null
      ? "the prune has not run in the window"
      : lastPrune.exhausted
        ? `the prune's last pass used its whole budget (${n(budget)} rows) and left ${n(lastPrune.left)} unexamined: one lap of the store takes ~${String(lap)} nights`
        : `the prune's last pass reached every row (budget ${n(budget)})`;
  const x = c.exempt;
  const detail =
    `${n(c.live)} live: ${n(c.inReach)} in reach, ${n(c.belowReach)} below reach, of them ${n(c.underFloor)} under the prune floor (they wait ${String(PHYSICS_TUNABLES.D_FLOOR_DAYS)} lived days there, then the prune may take them)` +
    (c.unranked > 0 ? `; ${n(c.unranked)} not ranked yet` : "") +
    `. ${windowWords()}: ${n(flow.born)} born, ${n(flow.archived)} left (night: ${n(pruned)} pruned, ${n(merged)} merged, ${n(faded)} cards faded), ${pace(flow.born, flow.archived)}; ${pruneSaid}` +
    `. Not the prune's: journal ${n(x.journal)} (no exit, by contract), chapter copies ${n(x.chapterCopies)} (replaced when a chapter is re-minted), handoffs ${n(x.handoffs)} (cleared or expired), cards ${n(x.cards)} (fade, not before their calendar floor)` +
    (x.selfPage > 0 ? `, self page ${n(x.selfPage)}` : "");
  return finding("growth-memories", "green", "Growth: memories", detail, "", {
    live: c.live,
    inReach: c.inReach,
    belowReach: c.belowReach,
    underFloor: c.underFloor,
    unranked: c.unranked,
    born: flow.born,
    left: flow.archived,
    pruned,
    merged,
    faded,
    pruneBudgetExhausted: lastPrune?.exhausted ?? null,
    pruneUnexamined: lastPrune?.left ?? null,
    pruneLapNights: lap,
    journal: x.journal,
    chapterCopies: x.chapterCopies,
    handoffs: x.handoffs,
    cards: x.cards,
    selfPage: x.selfPage,
    floor: PHYSICS_TUNABLES.PHI_PRUNE,
  });
}

// ── the event log ───────────────────────────────────────────────────────────

/**
 * Exit: the night's log sweep (`sleep/log.ts`), oldest first, capped. The
 * per-turn names (`SHORT_RETENTION_NAMES`) keep the short window and are
 * rolled into one latched `events.rolled` row a lived day first; every other
 * unlatched row keeps the store's `retentionDays`. Latched records (prunes,
 * promotions, merges, the roll-ups) are kept at any age, by design.
 */
function eventsLine(store: Store, w: GrowthWindow): Finding {
  const census = store.eventLogCensus();
  const sizes = store.eventLogBytes();
  const all = store.eventCounts();
  const recent = store.eventCounts({ sinceDay: w.since });
  const cameIn = recent.filter((c) => c.name !== EVENTS_ROLLED_EVENT).reduce((s, c) => s + c.count, 0);
  let left = 0;
  let remaining: number | null = null;
  let rolled = 0;
  for (const row of rowsIn(store, LOG_SWEEP_EVENT, w)) {
    const p = payloadOf(row);
    left += num(p, "count") ?? 0;
    rolled += num(p, "rolled") ?? 0;
    remaining ??= num(p, "remaining");
  }
  const top = [...all].sort((a, b) => b.count - a.count).slice(0, 5);
  const short = new Set(SHORT_RETENTION_NAMES);
  const shortRows = all.filter((c) => short.has(c.name)).reduce((s, c) => s + c.count, 0);
  const mb = (sizes.bytes / 1_048_576).toFixed(1);
  const detail =
    `${n(census.rows)} rows, ${sizes.exact ? "" : "~"}${mb} MB (${n(census.latched)} latched records, kept at any age); ` +
    `per-turn rows (${SHORT_RETENTION_NAMES.join(", ")}: ${n(shortRows)}) keep ${String(census.shortRetentionDays)} lived days and are rolled into one row a day first, the rest ${String(census.retentionDays)}` +
    (census.oldestDay === null ? "" : `; oldest lived day ${String(census.oldestDay)}`) +
    `. ${windowWords()}: ${n(cameIn)} written, ${n(left)} swept` +
    (rolled > 0 ? `, ${n(rolled)} days rolled up` : "") +
    `, ${pace(cameIn, left)}` +
    (census.eligible > 0 ? `; ${n(census.eligible)} past the window wait for the next pass` : "") +
    (top.length === 0 ? "" : `. Largest: ${top.map((c) => `${c.name} ${n(c.count)}`).join(", ")}`);
  const data: Record<string, string | number | boolean | null> = {
    rows: census.rows,
    bytes: sizes.bytes,
    bytesExact: sizes.exact,
    latched: census.latched,
    retentionDays: census.retentionDays,
    shortRetentionDays: census.shortRetentionDays,
    shortRows,
    written: cameIn,
    swept: left,
    rolledDays: rolled,
    eligible: census.eligible,
    lastRemaining: remaining,
  };
  for (const c of all) if (short.has(c.name) || c.name === EVENTS_ROLLED_EVENT) data[`count:${c.name}`] = c.count;
  return finding("growth-events", "green", "Growth: event log", detail, "", data);
}

// ── cue pairs ───────────────────────────────────────────────────────────────

/**
 * Exit: each pair fades (`S_CUE` lived days, exponential) and the flush's
 * sweep drops one under `CUE_FLOOR`, or one whose memory left. No count cap,
 * by design: a word's pairs scale down together past `CUE_MAX_OUT` (weight,
 * not a cut). Silent on a store without the table.
 */
function cuesLine(store: Store, w: GrowthWindow): Finding | null {
  const counts = store.growthCounts(w.sinceAt ?? Number.MAX_SAFE_INTEGER).cues;
  if (counts === null) return null;
  let swept = 0;
  for (const row of rowsIn(store, "associate.flush", w)) swept += num(payloadOf(row), "cueSwept") ?? 0;
  const t = ASSOCIATE_TUNABLES;
  const life = Math.round(t.S_CUE * Math.log(t.CUE_W_CAP / t.CUE_FLOOR));
  const detail =
    `${n(counts.rows)} word-to-memory pairs. ${windowWords()}: ${n(counts.recent)} new, ${n(swept)} swept, ${pace(counts.recent, swept)}` +
    `; an unused pair fades over ${String(t.S_CUE)} lived days and goes under the floor in at most ~${String(life)}, or when its memory leaves`;
  return finding("growth-cues", "green", "Growth: cue pairs", detail, "", {
    rows: counts.rows,
    recent: counts.recent,
    swept,
    fadeDays: t.S_CUE,
    longestLifeDays: life,
  });
}

// ── the dream queue ─────────────────────────────────────────────────────────

/**
 * Exit: a queued memory leaves when a dream that stands is shown it, or when
 * its own curve takes it below reach (`agedOut`); the queue and forgetting
 * share one clock (`dream/tunables.ts`). Read from the `dream.begun` rows.
 */
function queueLine(store: Store, w: GrowthWindow): Finding | null {
  const rows = rowsIn(store, "dream.begun", w).filter((r) => payloadOf(r)["resumed"] !== true);
  if (rows.length === 0) return null;
  const newest = payloadOf(rows[0]);
  const oldest = payloadOf(rows[rows.length - 1]);
  const queue = num(newest, "queue") ?? 0;
  let shown = 0;
  let agedOut = 0;
  for (const r of rows) {
    const p = payloadOf(r);
    shown += num(p, "shown") ?? 0;
    agedOut += num(p, "agedOut") ?? 0;
  }
  // BETWEEN THE OLDEST NIGHT READ AND THE NEWEST: each row's `queue` is the
  // length as that dream began; what it was shown leaves after it, and
  // `agedOut` counts what fell below reach since the dream before it. So what
  // left between the two lengths is every night's shown but the newest's,
  // plus every night's agedOut but the oldest's, and what came in is the
  // change in length plus that.
  const leftAfterFirst = shown - (num(newest, "shown") ?? 0) + agedOut - (num(oldest, "agedOut") ?? 0);
  const cameIn = Math.max(0, queue - (num(oldest, "queue") ?? queue) + leftAfterFirst);
  const detail =
    `${n(queue)} memories wait to be dreamed (${n(num(newest, "waiting") ?? 0)} not shown last night). ${windowWords()}, ${String(rows.length)} ${rows.length === 1 ? "night" : "nights"}: ${n(shown)} shown to a dream, ${n(agedOut)} fell below reach undreamed` +
    (rows.length > 1 ? `, ${pace(cameIn, leftAfterFirst)}` : "");
  return finding("growth-queue", "green", "Growth: dream queue", detail, "", {
    queue,
    waiting: num(newest, "waiting"),
    nights: rows.length,
    shown,
    agedOut,
    cameIn: rows.length > 1 ? cameIn : null,
  });
}
