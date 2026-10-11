/* Number and text formatting shared by every page. */
import { esc } from "./dom.js";

export const n2 = (x) => (typeof x === "number" && isFinite(x) ? x.toFixed(2) : "—");
export const n3 = (x) => (typeof x === "number" && isFinite(x) ? x.toFixed(3) : "—");
export const pct = (x) => Math.max(0, Math.min(100, (x || 0) * 100));

/** A withheld sentence is rendered as a withholding, not as empty space. */
export function said(text, confidential) {
  if (confidential) return '<span class="withheld">' + esc(text) + "</span>";
  return esc(text);
}
/**
 * A ROW'S LIVED DAYS, which is the metadata that actually varies.
 *
 * The identity list used to end every row with `learned 2026-09-04`, the same
 * date fifteen times, because that is the day the store was built — beside
 * `strength 1.00` fifteen times, which is what being in the identity band
 * means. Two of three visible fields said nothing. The lived days are the ones
 * the physics ran on: born spreads across the month, and last-used is what
 * "still load-bearing" looks like as a number. The calendar date is in the
 * memory's own card, where there is room to say what it means.
 */
export function livedSpan(el) {
  return "<span>born day " + el.bornDay + "</span><span>last used day " + el.lastUsedDay + "</span>";
}
/** Most memories carry no title: the first sentence is what they are called. */
export function headline(text) {
  const first = String(text).split(/(?<=[.!?])\s/)[0] || String(text);
  return first.length > 96 ? first.slice(0, 95).trimEnd() + "…" : first;
}
