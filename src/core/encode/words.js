const WORD_CHAR = "[\\p{L}\\p{N}_'’-]";
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function wholeWordRegex(term, flags = "iu") {
  const t = escapeRegExp(term.trim());
  return new RegExp(`(?<!${WORD_CHAR})${t}(?!${WORD_CHAR})`, flags);
}
export function nameRegex(term, flags = "iu") {
  const t = escapeRegExp(term.trim());
  return new RegExp(`(?<!${WORD_CHAR})${t}(?:['’]s?)?(?!${WORD_CHAR})`, flags);
}
export function occursAsName(haystack, term) {
  const t = term.trim();
  if (t.length === 0)
    return false;
  return nameRegex(t).test(haystack);
}
export function unpossessed(token) {
  const m = /^(.+?)['’]s?$/u.exec(token);
  return m === null ? token : m[1];
}
export function occursAsWholeWord(haystack, term) {
  const t = term.trim();
  if (t.length === 0)
    return false;
  return wholeWordRegex(t).test(haystack);
}
export function wordTokens(text) {
  return text.toLowerCase().match(WORD_RUN) ?? [];
}
const WORD_RUN = new RegExp(`${WORD_CHAR}+`, "gu");
export function countWholeWord(haystack, term) {
  const t = term.trim();
  if (t.length === 0)
    return 0;
  const re = wholeWordRegex(t, "giu");
  let n = 0;
  while (re.exec(haystack) !== null)
    n += 1;
  return n;
}
export function normalizeForFloor(text) {
  return text.toLowerCase().replace(/[`*_~>#\[\]()]/g, " ").replace(/[^\p{L}\p{N}\s/-]/gu, " ").replace(/\s+/g, " ").trim();
}
export function countWords(text) {
  const n = normalizeForFloor(text);
  return n.length === 0 ? 0 : n.split(" ").length;
}
