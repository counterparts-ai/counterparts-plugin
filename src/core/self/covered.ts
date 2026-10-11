/**
 * WHAT THE PAGE ALREADY SAYS (2026-10-01): a Nearby line that repeats what the
 * self page just told the reader spends the lane on nothing new. A hint the
 * page covers is left out of the lane, by one of two cheap tests and no model:
 *
 *   - **The page's own sources.** A page a reflection wrote was drawn from the
 *     memories that reflection cited (`reflections.cites`, the row the page's
 *     `reason` names). Those are covered, whatever their words.
 *   - **Its words, one sentence at a time.** A hint whose distinctive words —
 *     weighted by how rare each is across the memories scanned (inverse
 *     document frequency), so common words count for little and names for
 *     much — sit at least `PAGE_COVER_SHARE` in ONE sentence or bullet of the
 *     page. A sentence, not a paragraph (review of #311): a one-paragraph page
 *     shares a few words with any new fact about a subject it mentions, and
 *     that fact is exactly what Nearby is for.
 *
 * Words are four letters or more, and capitalised three-letter words that are
 * not sentence furniture (a name like "Sam" or "Ida"), since a short name is
 * often the most distinctive word a line has. The share was measured on a
 * copy of the owner's store (the PR for this change has the numbers); it is a
 * working default, held lightly. The cites are the reliable path.
 *
 * Pure: reads what it is handed, writes nothing.
 */
import type { Scanned } from "./identity.js";

/** The share of a hint's word weight one page sentence must hold. */
export const PAGE_COVER_SHARE = 0.35;

/** A hint with fewer distinctive words than this is never judged by words. */
export const PAGE_COVER_MIN_WORDS = 8;

const STOPWORDS = new Set(
  (
    "that this with from have were what when they them their there then than into about which would could should been being just like your mine ours also only some more most very much over such each other after before while because where whose these those itself myself said says will does doesn't didn't don't isn't wasn't"
  ).split(" "),
);

/** Capitalised three-letter words that are furniture, not names. */
const SHORT_FURNITURE = new Set(
  "the and but for not all any are can did few got had has her him his how its let may new nor now off old one our out own per put saw say see she six ten too two use was way who why yes yet you".split(" "),
);

/** The distinctive words of a text: lower case, four letters or more, no
 *  function words — and a capitalised three-letter name. */
export function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.match(/\p{L}[\p{L}'’-]*/gu) ?? []) {
    const word = raw.replace(/['’]s$/, "");
    const w = word.toLowerCase();
    if (w.length >= 4) {
      if (!STOPWORDS.has(w)) out.add(w);
    } else if (w.length === 3 && /^\p{Lu}\p{Ll}{2}$/u.test(word) && !SHORT_FURNITURE.has(w)) {
      out.add(w);
    }
  }
  return out;
}

/** The page's sentences and bullets, each as its words. */
function unitsOf(page: string): Set<string>[] {
  return page
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map(wordsOf)
    .filter((u) => u.size > 0);
}

/**
 * THE IDS THE PAGE COVERS among `scanned`: the cited ones, and those whose
 * words one sentence holds (see the header). Empty when there is no page.
 */
export function coveredByPage(page: string | null, scanned: readonly Scanned[], cited: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  if (page === null || page.trim().length === 0) return out;
  for (const s of scanned) if (cited.has(s.id)) out.add(s.id);
  const words = new Map<string, Set<string>>();
  const df = new Map<string, number>();
  for (const s of scanned) {
    const w = wordsOf(s.doc.body);
    words.set(s.id, w);
    for (const x of w) df.set(x, (df.get(x) ?? 0) + 1);
  }
  const n = scanned.length;
  const idf = (w: string): number => Math.log((n + 1) / ((df.get(w) ?? 0) + 1));
  const units = unitsOf(page);
  for (const s of scanned) {
    if (out.has(s.id)) continue;
    const w = words.get(s.id) ?? new Set<string>();
    if (w.size < PAGE_COVER_MIN_WORDS) continue;
    let total = 0;
    for (const x of w) total += idf(x);
    if (total <= 0) continue;
    for (const u of units) {
      let held = 0;
      for (const x of w) if (u.has(x)) held += idf(x);
      if (held / total >= PAGE_COVER_SHARE) {
        out.add(s.id);
        break;
      }
    }
  }
  return out;
}
