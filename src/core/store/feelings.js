import {
  CORE_EMOTIONS,
  OTHER_EMOTION,
  V10_CORES,
  closestKeys,
  feelingNumbers,
  isCoreEmotion,
  lookupWord,
  remapV10Feeling,
  resolveEmotion
} from "../feelings-wheel.js";
export { isSelfRelevantFeeling } from "../feelings-wheel.js";
import { StoreError } from "./errors.js";
export const FEELING_WHOSE = ["owner", "self"];
export const FEELING_SOURCES = ["session", "dream", "reflection", "awake"];
export const LATER_FEELING_SOURCES = ["reflection", "awake"];
export const CARRIED_BY_MAX_CHARS = 1000;
export const OTHER_WORD_MAX_CHARS = 80;
export const DEFAULT_STRENGTH_CAP = 0.55;
export function defaultStrength(core, emotion, otherWord) {
  return Math.min(feelingNumbers(core, emotion, otherWord).intensity, DEFAULT_STRENGTH_CAP);
}
export function feltDay(row) {
  return typeof row.recorded_day === "number" && Number.isFinite(row.recorded_day) ? row.recorded_day : row.birth_day;
}
export function feelingValence(row) {
  const own = row.valence;
  if (typeof own === "number" && Number.isFinite(own))
    return Math.max(-1, Math.min(1, own));
  return feelingNumbers(row.core, row.emotion, row.other_word).valence;
}
const STRONG_BREAK = /\s*(?:[:;—–]|\s-\s)\s*/u;
const ANY_BREAK = /\s*(?:[:;,—–]|\s-\s)\s*/u;
export function repairEmotion(emotion, carriedBy) {
  const raw = emotion.trim();
  const long = raw.length > OTHER_WORD_MAX_CHARS;
  if (!long && !STRONG_BREAK.test(raw))
    return null;
  const cut = (long ? ANY_BREAK : STRONG_BREAK).exec(raw);
  let head;
  let tail;
  if (cut !== null && cut.index > 0) {
    head = raw.slice(0, cut.index).trim();
    tail = raw.slice(cut.index + cut[0].length).trim();
  } else {
    const stripped = raw.replace(/^[\s:;,—–-]+/u, "").trim();
    if (stripped.length > 0 && stripped !== raw) {
      const again = repairEmotion(stripped, carriedBy);
      return again ?? { emotion: stripped, carriedBy: carriedBy.trim(), tail: "" };
    }
    head = stripped.length > 0 ? stripped : raw;
    tail = "";
  }
  if (head.length > OTHER_WORD_MAX_CHARS) {
    const [kept, rest] = fitWords(head, OTHER_WORD_MAX_CHARS);
    head = kept;
    tail = [rest, tail].filter((x) => x.length > 0).join(" ");
  }
  if (head.length === 0)
    return null;
  const carried = carriedBy.trim();
  const joined = tail.length === 0 ? carried : carried.length === 0 ? tail : `${carried}; ${tail}`;
  return { emotion: head, carriedBy: joined, tail };
}
function fitWords(text, max) {
  if (text.length <= max)
    return [text, ""];
  const at = text.lastIndexOf(" ", max);
  if (at > 0)
    return [text.slice(0, at).trim(), text.slice(at).trim()];
  return [text.slice(0, max), text.slice(max)];
}
export function splitNote(split, field = "emotion") {
  return `"${split.emotion}" was kept as the ${field === "emotion" ? "emotion" : "word"}${split.tail.length > 0 ? " and the rest went to carried_by" : ""}: ${field} is one word, carried_by holds the nuance.`;
}
function keepCarried(text) {
  return text.length <= CARRIED_BY_MAX_CHARS ? text : `${text.slice(0, CARRIED_BY_MAX_CHARS - 1)}…`;
}
function invalid(index, reason, extra = {}) {
  throw new StoreError("FEELING_INVALID", { index, reason, ...extra });
}
export function checkFeelings(inputs) {
  const rows = [];
  const notices = [];
  const repairs = [];
  inputs.forEach((given, i) => {
    let f = given;
    if (f === null || typeof f !== "object")
      invalid(i, "not-an-object");
    if (typeof f.whose !== "string" || !FEELING_WHOSE.includes(f.whose)) {
      invalid(i, "whose-unknown", { allowed: FEELING_WHOSE.join("|") });
    }
    const sentCore = f.core ?? "";
    if (typeof sentCore !== "string")
      invalid(i, "core-unknown", { allowed: CORE_EMOTIONS.join("|") });
    const named = sentCore.trim();
    if (named.length > 0 && !isCoreEmotion(named) && !V10_CORES.includes(named)) {
      invalid(i, "core-unknown", { allowed: CORE_EMOTIONS.join("|") });
    }
    if (f.strength !== undefined && (typeof f.strength !== "number" || !Number.isFinite(f.strength) || f.strength < 0 || f.strength > 1)) {
      invalid(i, "strength-out-of-range");
    }
    if (f.valence !== undefined && (typeof f.valence !== "number" || !Number.isFinite(f.valence) || f.valence < -1 || f.valence > 1)) {
      invalid(i, "valence-out-of-range");
    }
    if (f.carriedBy !== undefined && typeof f.carriedBy !== "string")
      invalid(i, "carried-by-not-a-string");
    if (typeof f.emotion !== "string" || f.emotion.trim().length === 0)
      invalid(i, "emotion-missing");
    if (f.otherWord !== undefined && typeof f.otherWord !== "string")
      invalid(i, "other-word-not-a-string");
    const split = (field, text) => {
      const fixed = repairEmotion(text, f.carriedBy ?? "");
      if (fixed === null)
        return;
      f = field === "emotion" ? { ...f, emotion: fixed.emotion, carriedBy: fixed.carriedBy } : { ...f, otherWord: fixed.emotion, carriedBy: fixed.carriedBy };
      repairs.push({
        index: i,
        field,
        was: text.trim(),
        now: fixed.emotion,
        note: splitNote(fixed, field)
      });
    };
    split("emotion", f.emotion);
    if (typeof f.otherWord === "string")
      split("other_word", f.otherWord);
    const sentCarried = f.carriedBy ?? "";
    const carriedBy = keepCarried(sentCarried);
    if (carriedBy !== sentCarried) {
      repairs.push({
        index: i,
        field: "carried_by",
        was: sentCarried,
        now: carriedBy,
        note: `carried_by was kept to its first ${String(CARRIED_BY_MAX_CHARS)} characters.`
      });
    }
    if (f.beneath !== undefined && typeof f.beneath !== "string" && typeof f.beneath !== "number") {
      invalid(i, "beneath-not-an-id-or-index");
    }
    const isOther = f.emotion.trim().toLowerCase() === OTHER_EMOTION;
    let core;
    if (isCoreEmotion(named))
      core = named;
    else if (named.length > 0) {
      core = remapV10Feeling(named, isOther ? OTHER_EMOTION : f.emotion, f.otherWord ?? null).core;
      repairs.push({
        index: i,
        field: "core",
        was: named,
        now: core,
        note: `"${named}" is not one of the cores now (${CORE_EMOTIONS.join(", ")}); it was stored under ${core}.`
      });
    } else {
      const home = lookupWord(isOther ? f.otherWord ?? "" : f.emotion)?.entry.core;
      if (home === undefined)
        invalid(i, "core-unknown", { allowed: CORE_EMOTIONS.join("|") });
      core = home;
    }
    let emotion;
    let otherWord = null;
    if (isOther) {
      const word = (f.otherWord ?? "").trim();
      if (word.length === 0)
        invalid(i, "other-word-missing");
      emotion = OTHER_EMOTION;
      otherWord = word;
      notices.push({ index: i, word, core, closest: closestKeys(core, word.toLowerCase()) });
    } else {
      const read = resolveEmotion(core, f.emotion);
      if (read.kind === "wheel") {
        emotion = read.entry.key;
        if (read.alias !== undefined)
          notices.push({ index: i, word: read.alias, core, closest: [], readAs: read.entry.key });
      } else {
        emotion = OTHER_EMOTION;
        otherWord = read.word;
        notices.push({ index: i, word: otherWord, core, closest: read.closest });
      }
    }
    if (typeof f.beneath === "number") {
      if (!Number.isInteger(f.beneath) || f.beneath < 0 || f.beneath >= inputs.length || f.beneath === i) {
        invalid(i, "beneath-index-out-of-range");
      }
    }
    rows.push({
      whose: f.whose,
      core,
      emotion,
      otherWord,
      strength: f.strength ?? defaultStrength(core, emotion, otherWord),
      valence: f.valence ?? null,
      carriedBy,
      beneath: f.beneath ?? null
    });
  });
  rows.forEach((_, start) => {
    const seen = new Set([start]);
    let at = rows[start]?.beneath;
    while (typeof at === "number") {
      if (seen.has(at))
        invalid(start, "beneath-cycle");
      seen.add(at);
      at = rows[at]?.beneath;
    }
  });
  return { rows, notices, repairs };
}
