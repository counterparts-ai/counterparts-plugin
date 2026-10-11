/**
 * `/api/search`. (`/api/chapters`, the chapter an Ask answer came from, left
 * with the "from chapter" link on 2026-10-09: facts mode folds a chapter and
 * the memory drawn from it into one answer itself.)
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { band, strength } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import type { DashboardSource } from "../../source.js";
import { reveal } from "../reveal.js";
import { feelingsShown, isChapterMemory, shownOf } from "./memory-words.js";
import type { DateFrom, FeelingShown } from "./memory-words.js";

// ─────────────────────────────────────────────────────────────────────────────
// search
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchView {
  readonly q: string;
  readonly hits: Hit[];
  /** When the words found few: memories a typo or two away, after the hits (`closeMatches`). */
  readonly close: CloseHit[];
  /** Every memory the words match, of which `hits` are the best-ranked (journal excluded). */
  readonly total: number;
  readonly absent: string | null;
}

/** A close match: a hit, and the memory's own words that were close to the query's. */
export type CloseHit = Hit & { readonly matched: string[] };

/** One search answer, in the row shape the memories list uses. */
export interface Hit {
  id: string;
  score: number;
  text: string;
  kind: Kind;
  band: Band;
  strength: number;
  confidential: boolean;
  /** The row shape the memories list uses (`memory-words.ts`). */
  title: string | null;
  shown: string;
  date: string | null;
  dateFrom: DateFrom | null;
  core: boolean;
  protected: boolean;
  journal: boolean;
  feelings: FeelingShown[];
}

export function searchView(src: DashboardSource, q: string, limit = 25): SearchView {
  const store = src.store;
  const day = store.livedDay();
  const query = q.trim();
  if (query.length === 0) return { q: "", hits: [], close: [], total: 0, absent: NEVER };
  // EVERY match, ranked, so the page can say "the first 25 of N" rather than
  // calling the first 25 all there is. One grouped query either way; the rows
  // are ids and scores. The journal is left out by one id read, not a row each.
  let raw: { id: string; score: number }[];
  let journal: Set<string>;
  try {
    raw = store.search(query, Math.max(limit * 2, store.countMemories() + 1));
    journal = new Set(store.list({ type: "episode" }));
  } catch {
    return { q: query, hits: [], close: [], total: 0, absent: NONE };
  }
  const matched = raw.filter((hit) => !journal.has(hit.id));
  const hits: SearchView["hits"] = [];
  for (const hit of matched) {
    const h = hitOf(store, hit.id, hit.score, day);
    if (h !== null) hits.push(h);
    if (hits.length >= limit) break;
  }
  const close = hits.length < CLOSE_BELOW ? closeMatches(store, query, new Set(matched.map((h) => h.id)), day) : [];
  return {
    q: query,
    hits,
    close,
    total: Math.max(hits.length, matched.length),
    absent: hits.length === 0 && close.length === 0 ? NONE : null,
  };
}

/** One hit in the row shape the list uses; null for a row that is gone or a journal entry. */
function hitOf(store: DashboardSource["store"], id: string, score: number, day: number): Hit | null {
  const row = store.row(id);
  // The journal is searchable in the owner's editor; it is not a memory here.
  if (row === undefined || isJournal(row)) return null;
  const r = reveal(store, id, 100);
  let s = 0;
  let b: Band = row.band;
  try {
    const physics = store.physicsOf(id);
    s = strength(physics, day);
    b = band(physics, day);
  } catch {
    /* a row that will not read is still a hit; it lists with a named absence */
  }
  const chapter = isChapterMemory(row);
  const shown = shownOf(row.body, {
    chapter,
    learnedOn: row.learned_on,
    confidential: r.confidential || !r.present,
    withheld: r.text ?? r.label,
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
    feelings: feelingsShown(store, id),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// close matches: a typo-tolerant second pass, the dashboard's own (M4, 2026-09-30)
// ─────────────────────────────────────────────────────────────────────────────

/** Under this many exact hits, the close-match pass runs. */
export const CLOSE_BELOW = 5;
/** How many close matches are listed at most. */
export const CLOSE_MAX = 10;

/** The word index's own split (`store/cache.ts#tokenize`): lower case, letters and digits, two or more. */
const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);

/** How many typos a word of this length may carry and still be meant: none under four letters. */
export const typosAllowed = (n: number): number => (n < 4 ? 0 : n < 7 ? 1 : 2);

/** Edit distance (insert, delete, change, and a swap of two neighbours), or `max + 1` once it is past `max`. Pure. */
export function typoDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, (prev2[j - 2] as number) + 1);
      cur.push(d);
      if (d < best) best = d;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length] as number;
}

/**
 * Memories whose title or words hold a word a typo or two away from one of the
 * query's (`typosAllowed`; a number is never a typo), best first: more of the query's words met, then
 * fewer typos. `exact` (the word search's own hits) are left out. Each carries
 * `matched`, the words as they are written in the memory, so the page marks
 * what matched. A confidential memory is found the way the word search finds
 * one, and listed as withheld. Reads rows only.
 */
function closeMatches(store: DashboardSource["store"], query: string, exact: ReadonlySet<string>, day: number): CloseHit[] {
  const wanted = [...new Set(words(query))].filter((t) => typosAllowed(t.length) > 0 && !/^\d+$/.test(t));
  if (wanted.length === 0) return [];
  const found: { id: string; met: number; typos: number; matched: string[] }[] = [];
  let ids: string[];
  try {
    ids = store.list({ archived: false }).filter((id) => !exact.has(id));
  } catch {
    return [];
  }
  for (const id of ids) {
    const row = store.row(id);
    if (row === undefined || row.type === "episode" || isJournal(row)) continue;
    const own = new Set(words(`${row.title ?? ""} ${row.body}`));
    let met = 0;
    let typos = 0;
    const matched: string[] = [];
    for (const t of wanted) {
      const max = typosAllowed(t.length);
      let best: { w: string; d: number } | null = null;
      for (const w of own) {
        if (w === t) {
          best = null;
          break;
        }
        const d = typoDistance(t, w, max);
        if (d <= max && (best === null || d < best.d)) best = { w, d };
      }
      if (best !== null) {
        met += 1;
        typos += best.d;
        matched.push(best.w);
      }
    }
    if (met > 0) found.push({ id, met, typos, matched });
  }
  found.sort((a, b) => b.met - a.met || a.typos - b.typos || (a.id < b.id ? -1 : 1));
  const out: CloseHit[] = [];
  for (const f of found) {
    const h = hitOf(store, f.id, 0, day);
    if (h !== null) out.push({ ...h, matched: h.confidential ? [] : f.matched });
    if (out.length >= CLOSE_MAX) break;
  }
  return out;
}
