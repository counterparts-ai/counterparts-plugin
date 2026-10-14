import { addDays, daysBetween, isDay, localDate } from "../time.js";
import { TUNABLES as PHYSICS_TUNABLES } from "../physics/index.js";
import { FEELING_SOURCES, LATER_FEELING_SOURCES } from "../store/index.js";
export const FEELING_WEEKS_TUNABLES = {
  WEEKS: 4,
  CORES_SHOWN: 4,
  MIN_CHANGE: 2,
  CHANGED: 3,
  RESTS_ON: 6,
  PER_CHANGE: 3
};
const COUNTED_SOURCES = new Set([null, ...FEELING_SOURCES.filter((x) => x !== "dream")]);
const LATER = new Set(LATER_FEELING_SOURCES);
const OWN = "reflection";
export function feelingWeeks(store, today, citable) {
  const T = FEELING_WEEKS_TUNABLES;
  if (!isDay(today))
    return null;
  const span = T.WEEKS * 7;
  const first = addDays(today, -(span - 1));
  const zone = store.zone();
  const rows = new Map;
  const lived = (id) => {
    if (!rows.has(id)) {
      const r = store.row(id);
      rows.set(id, r === undefined || r.source === "dreamed" || r.source === "reflection" ? null : r);
    }
    return rows.get(id) ?? null;
  };
  const hits = [];
  const back = { self: {}, owner: {} };
  for (const f of store.feelingsLive()) {
    if (!COUNTED_SOURCES.has(f.source ?? null))
      continue;
    if (f.whose !== "self" && f.whose !== "owner")
      continue;
    const day = localDate(f.created_at, zone);
    if (day < first || day > today)
      continue;
    if (lived(f.memory_id) === null)
      continue;
    const ago = daysBetween(day, today);
    const week = T.WEEKS - 1 - Math.floor(ago / 7);
    if (week < 0 || week >= T.WEEKS)
      continue;
    hits.push({ memory: f.memory_id, whose: f.whose, core: f.core, week, strength: f.strength, own: f.source === OWN });
    if (LATER.has(f.source ?? null))
      back[f.whose][f.core] = (back[f.whose][f.core] ?? 0) + 1;
  }
  if (hits.length === 0)
    return null;
  const tally = (whose, withOwn = true) => {
    const out = new Map;
    for (const h of hits) {
      if (h.whose !== whose || !withOwn && h.own)
        continue;
      const counts = out.get(h.core) ?? new Array(T.WEEKS).fill(0);
      counts[h.week] = (counts[h.week] ?? 0) + 1;
      out.set(h.core, counts);
    }
    return out;
  };
  const sum = (xs) => xs.reduce((n, x) => n + x, 0);
  const top = (m) => Object.fromEntries([...m].sort((a, b) => sum(b[1]) - sum(a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, T.CORES_SHOWN));
  const mineAll = tally("self");
  const ownerAll = tally("owner");
  const half = Math.floor(T.WEEKS / 2);
  const changes = [];
  for (const [whose, m] of [["self", tally("self", false)], ["owner", tally("owner", false)]]) {
    for (const [core, counts] of m) {
      const before = sum(counts.slice(0, half));
      const recent = sum(counts.slice(half));
      if (recent >= before + T.MIN_CHANGE && recent >= 2 * before)
        changes.push({ whose, core, before, recent, up: true });
      else if (before >= recent + T.MIN_CHANGE && before >= 2 * recent)
        changes.push({ whose, core, before, recent, up: false });
    }
  }
  changes.sort((a, b) => Math.abs(b.recent - b.before) - Math.abs(a.recent - a.before) || (a.whose < b.whose ? 1 : -1) || (a.core < b.core ? -1 : 1));
  const shownChanges = changes.slice(0, T.CHANGED);
  const changed = shownChanges.map((c) => `${c.whose === "self" ? "my" : "the owner's"} ${c.core} ${c.up ? "up" : "down"}: ${String(c.before)} in the two weeks before, ${String(c.recent)} in the last two`);
  const restsOn = [];
  const add = (pick, n) => {
    const ranked = hits.filter(pick).sort((a, b) => b.strength - a.strength || b.week - a.week || (a.memory < b.memory ? -1 : 1));
    let took = 0;
    for (const h of ranked) {
      if (restsOn.length >= T.RESTS_ON || took >= n)
        return;
      if (restsOn.includes(h.memory))
        continue;
      const r = lived(h.memory);
      if (r === null || !citable(r))
        continue;
      restsOn.push(h.memory);
      took += 1;
    }
  };
  for (const c of shownChanges)
    add((h) => !h.own && h.whose === c.whose && h.core === c.core && (c.up ? h.week >= half : h.week < half), T.PER_CHANGE);
  if (shownChanges.length === 0) {
    const commonest = [...mineAll].sort((a, b) => sum(b[1]) - sum(a[1]) || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    if (commonest !== undefined)
      add((h) => h.whose === "self" && h.core === commonest, T.PER_CHANGE);
  }
  return {
    weeks: Array.from({ length: T.WEEKS }, (_, i) => addDays(first, i * 7)),
    mine: top(mineAll),
    owner: top(ownerAll),
    lookingBack: { mine: back.self, owner: back.owner },
    changed,
    restsOn
  };
}
export function awakeFeelingCounts(store) {
  let total = 0;
  let fast = 0;
  let owner = 0;
  for (const f of store.feelingsLive()) {
    if (f.source !== "awake")
      continue;
    total += 1;
    if (f.strength >= PHYSICS_TUNABLES.CORE_FAST_FEELING)
      fast += 1;
    if (f.whose === "owner")
      owner += 1;
  }
  return { total, fast, owner };
}
