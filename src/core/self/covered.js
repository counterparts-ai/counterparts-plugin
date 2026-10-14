export const PAGE_COVER_SHARE = 0.35;
export const PAGE_COVER_MIN_WORDS = 8;
const STOPWORDS = new Set("that this with from have were what when they them their there then than into about which would could should been being just like your mine ours also only some more most very much over such each other after before while because where whose these those itself myself said says will does doesn't didn't don't isn't wasn't".split(" "));
const SHORT_FURNITURE = new Set("the and but for not all any are can did few got had has her him his how its let may new nor now off old one our out own per put saw say see she six ten too two use was way who why yes yet you".split(" "));
export function wordsOf(text) {
  const out = new Set;
  for (const raw of text.match(/\p{L}[\p{L}'’-]*/gu) ?? []) {
    const word = raw.replace(/['’]s$/, "");
    const w = word.toLowerCase();
    if (w.length >= 4) {
      if (!STOPWORDS.has(w))
        out.add(w);
    } else if (w.length === 3 && /^\p{Lu}\p{Ll}{2}$/u.test(word) && !SHORT_FURNITURE.has(w)) {
      out.add(w);
    }
  }
  return out;
}
function unitsOf(page) {
  return page.split(/\n+/).flatMap((line) => line.split(/(?<=[.!?])\s+/)).map(wordsOf).filter((u) => u.size > 0);
}
export function coveredByPage(page, scanned, cited = new Set) {
  const out = new Set;
  if (page === null || page.trim().length === 0)
    return out;
  for (const s of scanned)
    if (cited.has(s.id))
      out.add(s.id);
  const words = new Map;
  const df = new Map;
  for (const s of scanned) {
    const w = wordsOf(s.doc.body);
    words.set(s.id, w);
    for (const x of w)
      df.set(x, (df.get(x) ?? 0) + 1);
  }
  const n = scanned.length;
  const idf = (w) => Math.log((n + 1) / ((df.get(w) ?? 0) + 1));
  const units = unitsOf(page);
  for (const s of scanned) {
    if (out.has(s.id))
      continue;
    const w = words.get(s.id) ?? new Set;
    if (w.size < PAGE_COVER_MIN_WORDS)
      continue;
    let total = 0;
    for (const x of w)
      total += idf(x);
    if (total <= 0)
      continue;
    for (const u of units) {
      let held = 0;
      for (const x of w)
        if (u.has(x))
          held += idf(x);
      if (held / total >= PAGE_COVER_SHARE) {
        out.add(s.id);
        break;
      }
    }
  }
  return out;
}
