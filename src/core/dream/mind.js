import { HANDOFF_LIFE_DAYS, daysLeft, liveHandoffRows, newestPerScope } from "../handoff/index.js";
import { lineOf } from "../fit/index.js";
import { headOf } from "../recall/standing.js";
import { CONTRADICTION_TUNABLES, SLOT_SOURCE, slotsToConfirm } from "../reconsolidation.js";
import { addDays, daysBetween, isDay } from "../time.js";
export const MIND_TUNABLES = {
  MAX_ITEMS: 5,
  COMING_UP_DAYS: 14,
  TEXT_CHARS: 200,
  HABITUATION: 0.5,
  REASK_AFTER_DAYS: 7
};
export const MIND_SEEN_PREFIX = "mind.seen.";
function readMindSeen(store, pair) {
  try {
    const raw = store.getMeta(`${MIND_SEEN_PREFIX}${pair}`);
    if (raw === undefined)
      return null;
    const v = JSON.parse(raw);
    return typeof v.times === "number" && typeof v.day === "number" ? { times: v.times, day: v.day, reasked: v.reasked === true } : null;
  } catch {
    return null;
  }
}
export function noteMindShown(store, items, day) {
  for (const item of items) {
    if (item.pair === undefined)
      continue;
    try {
      const seen = readMindSeen(store, item.pair);
      let times = seen?.times ?? 0;
      if (seen !== null) {
        const used = Math.max(...item.ids.map((id) => store.physicsOf(id).lastUsedDay));
        if (used > seen.day)
          times = 0;
      }
      const reask = reaskDue(store.contradiction(item.pair)?.flagged_day ?? null, seen, day);
      if (reask)
        times = 0;
      store.setMeta(`${MIND_SEEN_PREFIX}${item.pair}`, JSON.stringify({ times: times + 1, day, ...reask || seen?.reasked === true ? { reasked: true } : {} }));
    } catch {}
  }
}
function reaskDue(flaggedDay, seen, day) {
  return seen !== null && !seen.reasked && flaggedDay !== null && day - flaggedDay >= MIND_TUNABLES.REASK_AFTER_DAYS;
}
export function onMyMind(store, input) {
  return mindRanked(store, input).items;
}
export function mindRanked(store, input) {
  const T = MIND_TUNABLES;
  const scored = [];
  const push = (item, score) => {
    scored.push({ item, score, order: scored.length });
  };
  const words = (id) => {
    const row = store.row(id);
    if (row === undefined || !input.showable(row))
      return null;
    return lineOf({ title: row.title, body: row.body }, T.TEXT_CHARS);
  };
  if (isDay(input.today)) {
    try {
      for (const d of store.datedMemories(input.today, addDays(input.today, T.COMING_UP_DAYS))) {
        if (headOf(store, d.id) !== null)
          continue;
        const text = words(d.id);
        if (text === null)
          continue;
        const start = d.eventDate.slice(0, 10);
        let away = T.COMING_UP_DAYS;
        try {
          away = isDay(start) ? Math.max(0, daysBetween(input.today, start)) : T.COMING_UP_DAYS;
        } catch {
          away = T.COMING_UP_DAYS;
        }
        push({ kind: "coming-up", text, ids: [d.id], date: d.eventDate }, 1 + (1 - Math.min(away, T.COMING_UP_DAYS) / T.COMING_UP_DAYS));
      }
    } catch {}
  }
  try {
    let n = 0;
    for (const c of store.contradictions({ state: "unsettled" })) {
      if (c.source === SLOT_SOURCE)
        continue;
      const a = words(c.a);
      const b = words(c.b);
      if (a === null || b === null)
        continue;
      const pair = c.id;
      const seen = readMindSeen(store, pair);
      let times = seen?.times ?? 0;
      if (seen !== null) {
        try {
          const used = Math.max(store.physicsOf(c.a).lastUsedDay, store.physicsOf(c.b).lastUsedDay);
          if (used > seen.day)
            times = 0;
        } catch {}
      }
      if (reaskDue(c.flagged_day, seen, input.day))
        times = 0;
      push({ kind: "unsettled", text: `"${a}" / "${b}"`, ids: [c.a, c.b], pair }, 1.5 * T.HABITUATION ** times - n * 0.001);
      n += 1;
    }
  } catch {}
  try {
    for (const h of newestPerScope(liveHandoffRows(store)).values()) {
      if (h.writtenDay === null)
        continue;
      const left = daysLeft(h.writtenDay, input.day, HANDOFF_LIFE_DAYS);
      if (left <= 0)
        continue;
      const row = store.row(h.id);
      if (row === undefined || row.confidential === 1 && !input.owner)
        continue;
      const first = lineOf({ body: row.body }, T.TEXT_CHARS);
      if (first.length === 0)
        continue;
      push({ kind: "open-loop", text: first, ids: [] }, 1 + Math.min(left, HANDOFF_LIFE_DAYS) / HANDOFF_LIFE_DAYS);
    }
  } catch {}
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const items = scored.slice(0, T.MAX_ITEMS).map((s) => s.item);
  const more = Math.max(0, scored.length - T.MAX_ITEMS);
  if (input.slots !== true)
    return { items, more };
  const all = slotsToConfirm(store, Number.MAX_SAFE_INTEGER).pairs.map((p, i) => ({ p, i, shown: readMindSeen(store, p.pair)?.times ?? 0 })).sort((a, b) => a.shown - b.shown || a.i - b.i).map((x) => x.p);
  const confirm = [];
  let skipped = 0;
  for (const p of all) {
    if (confirm.length >= CONTRADICTION_TUNABLES.SLOT_PER_NIGHT)
      break;
    const older = words(p.over);
    const newer = words(p.holds);
    if (older === null || newer === null) {
      skipped += 1;
      continue;
    }
    confirm.push({ kind: "to-confirm", text: `"${older}" → "${newer}"`, ids: [p.over, p.holds], pair: p.pair });
  }
  return { items: [...items, ...confirm], more, slotsMore: Math.max(0, all.length - confirm.length - skipped) };
}
