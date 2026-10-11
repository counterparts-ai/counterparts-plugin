/**
 * `dream/feeling-weeks.ts` — FEELINGS OVER WEEKS, for the nightly reflection
 * (2026-10-02, lane B, owner pick 1; working defaults, held lightly).
 *
 * The reflection was shown each memory's feelings, one memory at a time, and
 * nothing of how they ran: whether I have been more uneasy lately, whether the
 * owner's warmth went quiet. This is that pattern, small: counts by core per
 * week for the last few weeks, mine and the owner's apart; what changed (the
 * last two weeks against the two before); and a few memory ids it rests on, so
 * the reflection can read them, cite them, and — if it means something — say
 * it on the self page in its own words, through the page's own door.
 *
 * COMPUTED FROM STORED FEELINGS, never from text: every feeling on a live,
 * lived memory, as written at the time or recorded later (a reflection's, an
 * awake feeling-now) — each dated by when it was recorded, in the person's
 * zone. Not a dream's feeling-now (a dream is not lived), and not a feeling on
 * what a dream or a reflection wrote. Counts carry no words, so a confidential
 * memory's feelings count; only what `citable` allows is named in `restsOn`.
 *
 * A few hundred characters in the bundle. No dashboard page: this is the
 * reflection's to read, not another place to show the same thing.
 */
import { addDays, daysBetween, isDay, localDate } from "../time.js";
import { TUNABLES as PHYSICS_TUNABLES } from "../physics/index.js";
import { FEELING_SOURCES, LATER_FEELING_SOURCES } from "../store/index.js";
import type { FeelingSource, MemoryRow, Store } from "../store/index.js";

export const FEELING_WEEKS_TUNABLES = {
  /** Seven-day windows, the last ending today. */
  WEEKS: 4,
  /** The most cores named per person (the commonest in the span). */
  CORES_SHOWN: 4,
  /** A core "went up" when the last two weeks have at least this many more than the two before, and at least twice as many. CAL. */
  MIN_CHANGE: 2,
  /** What-changed lines at most. */
  CHANGED: 3,
  /** Memory ids the pattern rests on, at most, and per line of change. */
  RESTS_ON: 6,
  PER_CHANGE: 3,
} as const;

export interface FeelingWeeks {
  /** The first day of each seven-day window, oldest first; the last window ends today. */
  readonly weeks: readonly string[];
  /** My feelings by core, a count per window (oldest first). A core with none in the span is left out. */
  readonly mine: Readonly<Record<string, readonly number[]>>;
  /** The owner's, the same way. */
  readonly owner: Readonly<Record<string, readonly number[]>>;
  /**
   * Of the counts above, how many were recorded LATER, looking back (by a
   * reflection or awake), by core — mine and the owner's; a core with none is
   * left out. Review of #316: one number for everything said nothing.
   */
  readonly lookingBack: { readonly mine: Readonly<Record<string, number>>; readonly owner: Readonly<Record<string, number>> };
  /**
   * What changed, the last two weeks against the two before, in words. Empty
   * on a steady month. A reflection's OWN later feelings are left out of it
   * (review of #316): three uneasy recorded tonight must not read tomorrow as
   * "my uneasy up" — the reflection would be reading itself back.
   */
  readonly changed: readonly string[];
  /** Memory ids the pattern rests on — the strongest feelings behind what changed (or behind the commonest core). Read them before you cite them. */
  readonly restsOn: readonly string[];
}

/** Every source but a dream's feeling-now (a dream is not lived); null is a bare row, felt at the time. */
const COUNTED_SOURCES = new Set<string | null>([null, ...FEELING_SOURCES.filter((x) => x !== "dream")]);
const LATER = new Set<string | null>(LATER_FEELING_SOURCES);
/** The source left out of `changed`: the reader's own. */
const OWN: FeelingSource = "reflection";

/**
 * The pattern as of `today` (a calendar day), or null when no feeling was
 * recorded in the span — a quiet month says nothing, and the bundle carries no
 * empty field. `citable` says which memories may be named in `restsOn` (the
 * reflection's showable rule).
 */
export function feelingWeeks(
  store: Pick<Store, "feelingsLive" | "row" | "zone">,
  today: string,
  citable: (row: MemoryRow) => boolean,
): FeelingWeeks | null {
  const T = FEELING_WEEKS_TUNABLES;
  if (!isDay(today)) return null;
  const span = T.WEEKS * 7;
  const first = addDays(today, -(span - 1));
  const zone = store.zone();
  const rows = new Map<string, (MemoryRow & { feeling_peak?: number | null }) | null>();
  const lived = (id: string): (MemoryRow & { feeling_peak?: number | null }) | null => {
    if (!rows.has(id)) {
      const r = store.row(id);
      rows.set(id, r === undefined || r.source === "dreamed" || r.source === "reflection" ? null : r);
    }
    return rows.get(id) ?? null;
  };
  type Hit = { memory: string; whose: "self" | "owner"; core: string; week: number; strength: number; own: boolean };
  const hits: Hit[] = [];
  const back: { self: Record<string, number>; owner: Record<string, number> } = { self: {}, owner: {} };
  for (const f of store.feelingsLive()) {
    if (!COUNTED_SOURCES.has(f.source ?? null)) continue;
    if (f.whose !== "self" && f.whose !== "owner") continue;
    const day = localDate(f.created_at, zone);
    if (day < first || day > today) continue;
    if (lived(f.memory_id) === null) continue;
    const ago = daysBetween(day, today);
    const week = T.WEEKS - 1 - Math.floor(ago / 7);
    if (week < 0 || week >= T.WEEKS) continue;
    hits.push({ memory: f.memory_id, whose: f.whose, core: f.core, week, strength: f.strength, own: f.source === OWN });
    if (LATER.has(f.source ?? null)) back[f.whose][f.core] = (back[f.whose][f.core] ?? 0) + 1;
  }
  if (hits.length === 0) return null;

  const tally = (whose: "self" | "owner", withOwn = true): Map<string, number[]> => {
    const out = new Map<string, number[]>();
    for (const h of hits) {
      if (h.whose !== whose || (!withOwn && h.own)) continue;
      const counts = out.get(h.core) ?? new Array<number>(T.WEEKS).fill(0);
      counts[h.week] = (counts[h.week] ?? 0) + 1;
      out.set(h.core, counts);
    }
    return out;
  };
  const sum = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);
  const top = (m: Map<string, number[]>): Record<string, number[]> =>
    Object.fromEntries([...m].sort((a, b) => sum(b[1]) - sum(a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, T.CORES_SHOWN));
  const mineAll = tally("self");
  const ownerAll = tally("owner");

  // WHAT CHANGED: the last two windows against the two before.
  const half = Math.floor(T.WEEKS / 2);
  type Change = { whose: "self" | "owner"; core: string; before: number; recent: number; up: boolean };
  const changes: Change[] = [];
  for (const [whose, m] of [["self", tally("self", false)], ["owner", tally("owner", false)]] as const) {
    for (const [core, counts] of m) {
      const before = sum(counts.slice(0, half));
      const recent = sum(counts.slice(half));
      if (recent >= before + T.MIN_CHANGE && recent >= 2 * before) changes.push({ whose, core, before, recent, up: true });
      else if (before >= recent + T.MIN_CHANGE && before >= 2 * recent) changes.push({ whose, core, before, recent, up: false });
    }
  }
  changes.sort((a, b) => Math.abs(b.recent - b.before) - Math.abs(a.recent - a.before) || (a.whose < b.whose ? 1 : -1) || (a.core < b.core ? -1 : 1));
  const shownChanges = changes.slice(0, T.CHANGED);
  const changed = shownChanges.map(
    (c) => `${c.whose === "self" ? "my" : "the owner's"} ${c.core} ${c.up ? "up" : "down"}: ${String(c.before)} in the two weeks before, ${String(c.recent)} in the last two`,
  );

  // WHAT IT RESTS ON: the strongest feelings behind each change (recent ones
  // for a rise, earlier ones for a fall); with no change, behind my commonest
  // core of the span. Only what the reflection may cite.
  const restsOn: string[] = [];
  const add = (pick: (h: Hit) => boolean, n: number): void => {
    const ranked = hits.filter(pick).sort((a, b) => b.strength - a.strength || b.week - a.week || (a.memory < b.memory ? -1 : 1));
    let took = 0;
    for (const h of ranked) {
      if (restsOn.length >= T.RESTS_ON || took >= n) return;
      if (restsOn.includes(h.memory)) continue;
      const r = lived(h.memory);
      if (r === null || !citable(r)) continue;
      restsOn.push(h.memory);
      took += 1;
    }
  };
  for (const c of shownChanges) add((h) => !h.own && h.whose === c.whose && h.core === c.core && (c.up ? h.week >= half : h.week < half), T.PER_CHANGE);
  if (shownChanges.length === 0) {
    const commonest = [...mineAll].sort((a, b) => sum(b[1]) - sum(a[1]) || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    if (commonest !== undefined) add((h) => h.whose === "self" && h.core === commonest, T.PER_CHANGE);
  }

  return {
    weeks: Array.from({ length: T.WEEKS }, (_, i) => addDays(first, i * 7)),
    mine: top(mineAll),
    owner: top(ownerAll),
    lookingBack: { mine: back.self, owner: back.owner },
    changed,
    restsOn,
  };
}

/**
 * AWAKE LATER FEELINGS, COUNTED (2026-10-02, review of #316, item 8): the way
 * from an ordinary session to the core's fast lane is kept loose (the owner's
 * rule: few guards, tighten after a real issue) and made VISIBLE instead. The
 * rows are the durable record (`source = awake`); this reads them on live
 * memories — how many, how many at the fast lane's strength
 * (`CORE_FAST_FEELING`), how many the owner's. Doctor's Reflection line says it.
 */
export function awakeFeelingCounts(store: Pick<Store, "feelingsLive">): { total: number; fast: number; owner: number } {
  let total = 0;
  let fast = 0;
  let owner = 0;
  for (const f of store.feelingsLive()) {
    if (f.source !== "awake") continue;
    total += 1;
    if (f.strength >= PHYSICS_TUNABLES.CORE_FAST_FEELING) fast += 1;
    if (f.whose === "owner") owner += 1;
  }
  return { total, fast, owner };
}
