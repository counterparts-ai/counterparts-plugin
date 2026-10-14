import { softenedFeeling } from "../core/physics/index.js";
import { feelingValence } from "../core/store/index.js";
export function whoseLabel(whose) {
  return whose === "owner" ? "you" : whose === "self" ? "me" : whose;
}
export function feelingWord(row) {
  if (row.emotion === "other")
    return row.other_word ?? "other";
  const dot = row.emotion.indexOf(".");
  return dot >= 0 ? row.emotion.slice(dot + 1) : row.emotion;
}
export function shownFeelings(rows, ageDays) {
  return rows.map((r) => ({
    who: whoseLabel(r.whose),
    word: feelingWord(r),
    strength: r.strength,
    now: softenedFeeling(r.strength, ageDays, feelingValence(r))
  }));
}
const n1 = (x) => x.toFixed(1);
export function feelingsLine(rows, ageDays) {
  const shown = shownFeelings(rows, ageDays);
  if (shown.length === 0)
    return "";
  const order = (who) => who === "you" ? 0 : who === "me" ? 1 : 2;
  const people = [...new Set(shown.map((s) => s.who))].sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1));
  return people.map((who) => {
    const words = shown.filter((s) => s.who === who).map((s) => {
      const at = n1(s.strength);
      const now = n1(s.now);
      return now === at ? `${s.word} ${at}` : `${s.word} ${at} (now ${now})`;
    });
    return `${who}: ${words.join(", ")}`;
  }).join(" · ");
}
