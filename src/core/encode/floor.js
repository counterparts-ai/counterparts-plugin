import { stripRedactions } from "./secrets.js";
import { TUNABLES } from "./tunables.js";
import { normalizeForFloor } from "./words.js";
const STUBS = new Set(TUNABLES.STUB_TOKENS.map((s) => normalizeForFloor(s)));
export function contentFloor(content) {
  const real = stripRedactions(content).trim();
  const normalized = normalizeForFloor(real);
  const chars = normalized.length;
  const words = chars === 0 ? 0 : normalized.split(" ").length;
  const blockedBy = [];
  if (chars === 0)
    blockedBy.push("content-empty");
  else {
    if (STUBS.has(normalized))
      blockedBy.push("content-stub");
    if (chars < TUNABLES.FLOOR_MIN_CHARS)
      blockedBy.push("content-too-short");
    if (words < TUNABLES.FLOOR_MIN_WORDS)
      blockedBy.push("content-too-few-words");
  }
  return {
    ok: blockedBy.length === 0,
    reason: blockedBy[0] ?? "above-floor",
    blockedBy,
    chars,
    words,
    minChars: TUNABLES.FLOOR_MIN_CHARS,
    minWords: TUNABLES.FLOOR_MIN_WORDS
  };
}
export function floorRefusals(f) {
  return f.blockedBy;
}
