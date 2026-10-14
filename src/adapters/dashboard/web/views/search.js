import { band, strength } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import { NEVER, NONE } from "../../layout.js";
import { reveal } from "../reveal.js";
import { feelingsShown, isChapterMemory, shownOf } from "./memory-words.js";
export function searchView(src, q, limit = 25) {
  const store = src.store;
  const day = store.livedDay();
  const query = q.trim();
  if (query.length === 0)
    return { q: "", hits: [], close: [], total: 0, absent: NEVER };
  let raw;
  let journal;
  try {
    raw = store.search(query, Math.max(limit * 2, store.countMemories() + 1));
    journal = new Set(store.list({ type: "episode" }));
  } catch {
    return { q: query, hits: [], close: [], total: 0, absent: NONE };
  }
  const matched = raw.filter((hit) => !journal.has(hit.id));
  const hits = [];
  for (const hit of matched) {
    const h = hitOf(store, hit.id, hit.score, day);
    if (h !== null)
      hits.push(h);
    if (hits.length >= limit)
      break;
  }
  const close = hits.length < CLOSE_BELOW ? closeMatches(store, query, new Set(matched.map((h) => h.id)), day) : [];
  return {
    q: query,
    hits,
    close,
    total: Math.max(hits.length, matched.length),
    absent: hits.length === 0 && close.length === 0 ? NONE : null
  };
}
function hitOf(store, id, score, day) {
  const row = store.row(id);
  if (row === undefined || isJournal(row))
    return null;
  const r = reveal(store, id, 100);
  let s = 0;
  let b = row.band;
  try {
    const physics = store.physicsOf(id);
    s = strength(physics, day);
    b = band(physics, day);
  } catch {}
  const chapter = isChapterMemory(row);
  const shown = shownOf(row.body, {
    chapter,
    learnedOn: row.learned_on,
    confidential: r.confidential || !r.present,
    withheld: r.text ?? r.label
  });
  return {
    id,
    score,
    text: r.text ?? r.label,
    kind: row.kind,
    band: b,
    strength: s,
    confidential: r.confidential,
    title: r.confidential || row.title === null || row.title.trim() === "" ? null : row.title.trim(),
    shown: shown.text || (r.text ?? r.label),
    date: shown.date,
    dateFrom: shown.dateFrom,
    core: row.promoted_identity === 1,
    protected: row.protected === 1,
    journal: chapter,
    feelings: feelingsShown(store, id)
  };
}
export const CLOSE_BELOW = 5;
export const CLOSE_MAX = 10;
const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
export const typosAllowed = (n) => n < 4 ? 0 : n < 7 ? 1 : 2;
export function typoDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max)
    return max + 1;
  let prev2 = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1;i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1;j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      if (d < best)
        best = d;
    }
    if (best > max)
      return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}
function closeMatches(store, query, exact, day) {
  const wanted = [...new Set(words(query))].filter((t) => typosAllowed(t.length) > 0 && !/^\d+$/.test(t));
  if (wanted.length === 0)
    return [];
  const found = [];
  let ids;
  try {
    ids = store.list({ archived: false }).filter((id) => !exact.has(id));
  } catch {
    return [];
  }
  for (const id of ids) {
    const row = store.row(id);
    if (row === undefined || row.type === "episode" || isJournal(row))
      continue;
    const own = new Set(words(`${row.title ?? ""} ${row.body}`));
    let met = 0;
    let typos = 0;
    const matched = [];
    for (const t of wanted) {
      const max = typosAllowed(t.length);
      let best = null;
      for (const w of own) {
        if (w === t) {
          best = null;
          break;
        }
        const d = typoDistance(t, w, max);
        if (d <= max && (best === null || d < best.d))
          best = { w, d };
      }
      if (best !== null) {
        met += 1;
        typos += best.d;
        matched.push(best.w);
      }
    }
    if (met > 0)
      found.push({ id, met, typos, matched });
  }
  found.sort((a, b) => b.met - a.met || a.typos - b.typos || (a.id < b.id ? -1 : 1));
  const out = [];
  for (const f of found) {
    const h = hitOf(store, f.id, 0, day);
    if (h !== null)
      out.push({ ...h, matched: h.confidential ? [] : f.matched });
    if (out.length >= CLOSE_MAX)
      break;
  }
  return out;
}
