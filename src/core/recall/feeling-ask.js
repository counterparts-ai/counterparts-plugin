import { ALIASES, CORE_EMOTIONS, FEELINGS_WHEEL, OTHER_EMOTION, coresOfFeeling, lookupWord, wheelEntry } from "../feelings-wheel.js";
import { tokenize } from "../store/index.js";
export const FEEL_WORDS = [
  "feel",
  "feels",
  "feeling",
  "feelings",
  "felt",
  "emotion",
  "emotions",
  "emotional",
  "mood",
  "moods"
];
export const WHEEL_VOCABULARY = new Set([
  ...CORE_EMOTIONS,
  ...FEELINGS_WHEEL.map((e) => e.word),
  ...Object.keys(ALIASES)
]);
export const EVERYDAY_TO_WHEEL = {
  shame: "ashamed",
  shamed: "ashamed",
  guilt: "guilty",
  embarrassment: "embarrassed",
  awkward: "embarrassed",
  mortified: "humiliated",
  humiliation: "humiliated",
  fearful: "afraid",
  dread: "afraid",
  terror: "terrified",
  scary: "scared",
  anxiety: "anxious",
  stressed: "worried",
  uncomfortable: "uneasy",
  unease: "uneasy",
  insecurity: "insecure",
  unhappy: "sad",
  sorrow: "sad",
  miserable: "sad",
  upset: "sad",
  grief: "grieving",
  lonesome: "lonely",
  regret: "regretful",
  heartbreak: "heartbroken",
  disappointment: "disappointed",
  boredom: "bored",
  thrilled: "excited",
  excitement: "excited",
  elated: "ecstatic",
  delight: "delighted",
  gratitude: "grateful",
  relief: "relieved",
  warmth: "warm",
  affection: "affectionate",
  confusion: "confused",
  awed: "awe",
  frustration: "frustrated",
  annoyance: "annoyed",
  rage: "enraged",
  fury: "furious",
  resentment: "resentful",
  jealousy: "jealous"
};
const WHEEL_PHRASE_KEYS = new Map(FEELINGS_WHEEL.map((e) => [words(e.word), e.key]).filter(([w]) => w.length === 2).map(([w, key]) => [w.join(" "), key]));
const STRONGEST = new Set(["most", "ever", "strongest", "strongly", "since", "always", "deepest", "biggest", "hardest", "worst"]);
const STRONGEST_REACH = 2;
const RECENT = new Set(["recent", "recently", "lately", "latest", "last", "today", "yesterday", "tonight", "now"]);
const STEMMABLE = new Set(["happy", "sad", "angry", "lonely", "proud", "glad", "calm", "fond", "tender", "nervous", "anxious", "grateful"]);
export function feelingWord(w, stored = new Set) {
  if (w.length >= 3 && Object.hasOwn(ALIASES, w)) {
    const to = wheelEntry(ALIASES[w])?.word;
    if (to !== undefined)
      return { word: to, superlative: false, via: "wheel" };
  }
  if (w.length >= 3 && (WHEEL_VOCABULARY.has(w) || stored.has(w)))
    return { word: w, superlative: false, via: "wheel" };
  if (Object.hasOwn(EVERYDAY_TO_WHEEL, w))
    return { word: EVERYDAY_TO_WHEEL[w], superlative: false, via: "everyday" };
  const known = (x) => STEMMABLE.has(x) ? x : null;
  const undouble = (x) => x.length >= 4 && x[x.length - 1] === x[x.length - 2] ? x.slice(0, -1) : x;
  const tries = [];
  if (w.endsWith("iest"))
    tries.push([`${w.slice(0, -4)}y`, true]);
  if (w.endsWith("ier"))
    tries.push([`${w.slice(0, -3)}y`, false]);
  if (w.endsWith("iness"))
    tries.push([`${w.slice(0, -5)}y`, false]);
  if (w.endsWith("ness"))
    tries.push([w.slice(0, -4), false]);
  if (w.endsWith("est"))
    tries.push([w.slice(0, -3), true], [undouble(w.slice(0, -3)), true], [w.slice(0, -2), true]);
  if (w.endsWith("er"))
    tries.push([w.slice(0, -2), false], [undouble(w.slice(0, -2)), false], [w.slice(0, -1), false]);
  for (const [stem, superlative] of tries) {
    const hit = known(stem);
    if (hit !== null)
      return { word: hit, superlative, via: "stem" };
  }
  return null;
}
export function coresOfWord(word) {
  const entry = lookupWord(word)?.entry;
  return entry === undefined ? [] : coresOfFeeling(entry.core, entry.key);
}
export function isFeelingFrameWord(token, stored, names = new Set) {
  if (names.has(token))
    return false;
  return FEEL_WORDS.includes(token) || STRONGEST.has(token) || QUESTION_FRAME.has(token) || FIRST.has(token) || SECOND.has(token) || PLURAL.has(token) || feelingWord(token, stored) !== null;
}
const QUESTION_FRAME = new Set([
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "how",
  "whats",
  "was",
  "were",
  "is",
  "are",
  "am",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "can",
  "could",
  "will",
  "would",
  "should",
  "may",
  "ive",
  "im",
  "the",
  "an",
  "this",
  "that",
  "these",
  "those",
  "some",
  "any",
  "them",
  "they",
  "their",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "about",
  "from",
  "by",
  "as",
  "into",
  "and",
  "or",
  "but",
  "if",
  "than",
  "then",
  "not",
  "very",
  "really",
  "time",
  "times"
]);
export function askedNames(text) {
  const out = new Set;
  if (!/[a-z]/.test(text))
    return out;
  let start = true;
  for (const m of text.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*|[.?!;:\n]/g)) {
    const tok = m[0];
    if (/^[.?!;:\n]$/.test(tok)) {
      start = true;
      continue;
    }
    const w = words(tok).join("");
    if (!start && /^[A-Z]/.test(tok) && !FIRST.has(w) && w !== "id" && w.length >= 2 && !WHEEL_VOCABULARY.has(w))
      out.add(w);
    start = false;
  }
  return out;
}
const FIRST = new Set(["i", "im", "ive", "me", "my", "mine", "myself"]);
const SECOND = new Set(["you", "youre", "youve", "your", "yours", "yourself"]);
const PLURAL = new Set(["we", "weve", "us", "our", "ours", "ourselves"]);
const OWNER_WORDS = new Set(["owner", "user"]);
const POSSESSIVE = new Set(["my", "mine", "your", "yours"]);
function words(text) {
  return text.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 0);
}
function possessiveNames(text, names) {
  const out = new Set;
  for (const m of text.matchAll(/([A-Za-z0-9]+)['’](s?)(?![A-Za-z0-9])/g)) {
    const base = m[1].toLowerCase();
    if (names.has(base))
      out.add(base + (m[2] === "" ? "" : "s"));
  }
  return out;
}
export function whoseAsked(text, input) {
  const other = input.asker === "self" ? "owner" : "self";
  const names = new Set((input.ownerNames ?? []).flatMap((n) => words(n)).filter((w) => w.length >= 2));
  const said = new Set;
  const possessive = possessiveNames(text, names);
  for (const w of words(text)) {
    if (FIRST.has(w))
      said.add(input.asker);
    else if (SECOND.has(w))
      said.add(other);
    else if (PLURAL.has(w)) {
      said.add("owner");
      said.add("self");
    } else if (OWNER_WORDS.has(w) || names.has(w) || possessive.has(w))
      said.add("owner");
  }
  return said.size === 1 ? [...said][0] : null;
}
function stampKey(f) {
  if (f.emotion !== OTHER_EMOTION)
    return f.emotion;
  return f.other_word === null ? OTHER_EMOTION : lookupWord(f.other_word)?.entry.key ?? OTHER_EMOTION;
}
export function stampCores(f) {
  return coresOfFeeling(f.core, stampKey(f));
}
export function feelingTokens(f) {
  const out = new Set;
  const add = (text) => {
    const toks = tokenize(text);
    if (toks.length === 1)
      out.add(toks[0]);
    else {
      const phrase = words(text);
      if (phrase.length > 1)
        out.add(phrase.join(" "));
    }
  };
  const key = stampKey(f);
  if (key !== OTHER_EMOTION) {
    const entry = wheelEntry(key);
    add(entry?.word ?? key.split(".").pop() ?? key);
    if (entry?.parent !== null && entry?.parent !== undefined)
      add(entry.parent);
    const label = entry?.label ?? (entry?.parent ? wheelEntry(entry.parent)?.label : undefined);
    if (label !== undefined)
      add(label);
    for (const [alias, to] of Object.entries(ALIASES))
      if (to === key)
        add(alias);
  }
  for (const c of coresOfFeeling(f.core, key))
    add(c);
  if (f.other_word !== null) {
    const own = tokenize(f.other_word);
    if (own.length === 1)
      out.add(own[0]);
  }
  return out;
}
const DETERMINERS = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "some",
  "my",
  "your",
  "his",
  "her",
  "its",
  "it",
  "them",
  "our",
  "their"
]);
export const EVERYDAY_FEELING_WORDS = new Set([
  "close",
  "content",
  "settled",
  "seen",
  "caught",
  "engaged",
  "open",
  "important",
  "empty",
  "sorry",
  "familiar",
  "critical",
  "distant",
  "absorbed",
  "accepted",
  "satisfied",
  "powerful",
  "grounded"
]);
const FEELING_FRAME = new Set([...FEEL_WORDS, "am", "im", "is", "are", "was", "were", "be", "been", "being", "youre"]);
const PREPOSITIONS = new Set(["to", "with", "on", "in", "of", "for", "at", "about"]);
const OPINION = new Set(["like", "that"]);
const THIRD = new Set(["he", "she", "they", "it", "its", "his", "her", "their", "theyre"]);
const BEFORE = 3;
const AFTER = 2;
function aboutAPerson(toks, at, feelWord, names, possessive = new Set) {
  const person = (w) => FIRST.has(w) && (feelWord || !POSSESSIVE.has(w)) || SECOND.has(w) && (feelWord || !POSSESSIVE.has(w)) || OWNER_WORDS.has(w) || names.has(w) || feelWord && possessive.has(w) || feelWord && PLURAL.has(w);
  for (let j = at - 1;j >= Math.max(0, at - BEFORE); j--) {
    const w = toks[j];
    if (THIRD.has(w))
      break;
    if (person(w))
      return true;
  }
  for (let j = at + 1;j <= Math.min(toks.length - 1, at + AFTER); j++) {
    if (person(toks[j]))
      return true;
  }
  return false;
}
export function readFeelingAsk(text, input, stored, minLength) {
  const toks = words(text);
  const names = new Set((input.ownerNames ?? []).flatMap((n) => words(n)).filter((w) => w.length >= 2));
  const possessive = possessiveNames(text, names);
  const proper = askedNames(text);
  const person = (at, feelWord) => aboutAPerson(toks, at, feelWord, names, possessive);
  const named = new Set;
  const cores = new Set;
  const feelingAt = [];
  let ranked = false;
  let superlative = false;
  const name = (asked, word) => {
    named.add(asked);
    named.add(word);
    for (const c of coresOfWord(word))
      cores.add(c);
  };
  const inPhrase = new Set;
  const isPerson = (w) => FIRST.has(w) || SECOND.has(w) || PLURAL.has(w) || OWNER_WORDS.has(w) || names.has(w);
  for (let i = 0;i + 1 < toks.length; i++) {
    const key = WHEEL_PHRASE_KEYS.get(`${toks[i]} ${toks[i + 1]}`);
    if (key === undefined || DETERMINERS.has(toks[i + 2] ?? ""))
      continue;
    if (key === "caught out" && (PREPOSITIONS.has(toks[i + 2] ?? "") || toks[i + 2] === "from"))
      continue;
    const prev = toks[i - 1] ?? "";
    const joined = (prev === "or" || prev === "and") && feelingWord(toks[i - 2] ?? "", stored) !== null;
    const subject = joined || isPerson(prev) || (FEEL_WORDS.includes(prev) || FEELING_FRAME.has(prev)) && isPerson(toks[i - 2] ?? "");
    const framed = (FEEL_WORDS.includes(prev) || FEELING_FRAME.has(prev)) && person(i, false);
    if (!subject && !framed)
      continue;
    inPhrase.add(i);
    inPhrase.add(i + 1);
    feelingAt.push(i, i + 1);
    name(`${toks[i]} ${toks[i + 1]}`, key);
    if (!joined || isPerson(prev) || person(i, false))
      ranked = true;
  }
  const anyFeelWord = toks.some((w) => FEEL_WORDS.includes(w));
  toks.forEach((w, i) => {
    if (inPhrase.has(i))
      return;
    if (FEEL_WORDS.includes(w)) {
      if (OPINION.has(toks[i + 1] ?? ""))
        return;
      feelingAt.push(i);
      if (person(i, true))
        ranked = true;
      return;
    }
    if (w.length < minLength || proper.has(w))
      return;
    const read = feelingWord(w, stored);
    if (read === null)
      return;
    if (DETERMINERS.has(toks[i + 1] ?? ""))
      return;
    const before = [toks[i - 1] ?? "", toks[i - 2] ?? ""];
    if (read.via !== "wheel" && !anyFeelWord && !before.some((b) => FEELING_FRAME.has(b)))
      return;
    if (EVERYDAY_FEELING_WORDS.has(w) || EVERYDAY_FEELING_WORDS.has(read.word)) {
      const felt = before.some((b) => FEEL_WORDS.includes(b));
      if (!felt) {
        if (!before.some((b) => FEELING_FRAME.has(b)))
          return;
        if (PREPOSITIONS.has(toks[i + 1] ?? ""))
          return;
      }
    }
    name(w, read.word);
    feelingAt.push(i);
    if (read.superlative)
      superlative = true;
    if (person(i, false))
      ranked = true;
  });
  const recent = toks.some((w) => RECENT.has(w));
  const strongest = !recent && (superlative || toks.some((w, i) => STRONGEST.has(w) && feelingAt.some((j) => Math.abs(j - i) <= STRONGEST_REACH)));
  return { ranked, named, whose: whoseAsked(text, input), cores, strongest };
}
