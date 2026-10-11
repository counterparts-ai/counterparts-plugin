/**
 * A QUESTION ABOUT FEELING — the deliberate path only (2026-09-30, U13 items 1
 * and 2).
 *
 * Asked by name or topic, recall answered well; asked by feeling ("what have I
 * felt most strongly", "times I felt moved or sad") it answered with plumbing.
 * Stored feelings only REWEIGHTED candidates the words had already found
 * (`activate.ts#gatedSal`, `mood.ts#moodLift`); they never NOMINATED one, and a
 * memory stamped `moved` whose text never says the word could not be reached by
 * "moved" at all.
 *
 * This file answers two questions about the asked text, and one about a stamp:
 *
 *   `readFeelingAsk` — is the question about feeling, which words of it name a
 *     feeling, and whose feeling it asks about.
 *   `feelingTokens`  — the words a stamp answers to: the emotion word as the
 *     writer's key spells it, its group's word (wheel v2), the everyday words
 *     that alias to it, the wheel core(s) it counts under (a blend under both),
 *     and the writer's own word when it is off the wheel (`other_word`) — each
 *     only when it is one word.
 *
 * **Deliberate only, and why.** The ambient path's affect gate (§9 G10/G11:
 * stated-only, first-person, turn-gated — `cues.ts#detectAffect`) is a safety
 * property, not a vocabulary gap: a turn that says "sad" must not pull every
 * sad memory into a conversation nobody asked it into. A deliberate question is
 * the experiencer asking on purpose. Nothing here is read by `detectAffect`,
 * and `Recall.build` runs the lane only when the turn carries a `feeling` ask,
 * which only a deliberate caller sets (the old question path until 2026-10-03;
 * meaning mode's now, `mcp/meaning.ts`, when it asks).
 *
 * **Whose.** The table holds two: `owner` and `self`. First person means the
 * ASKER (the counterpart, through its `recall` tool; the owner, through the
 * console's `ask`), second person the other one, the owner's names or "owner"
 * the owner, and "we" both. Nothing said, or both said: both.
 *
 * **Round 2 (2026-10-01, lane 6).** Any feeling word reaches its core: a
 * question word is read through the wheel, a short question-side list of
 * everyday words off it (`EVERYDAY_TO_WHEEL`: shame, guilt, dread, relief,
 * regret…), a light stemmer (happiest, sadness) and the wheel's
 * phrases ("caught out"); its home core(s) come back as `FeelingAsk.cores`,
 * the second tier `activate.ts` matches on. "Most / ever / strongest / since"
 * beside a feeling word (or a superlative) set `FeelingAsk.strongest`. Nothing here is a write door: the wheel's own
 * `ALIASES`, which decide for a writer, are untouched.
 *
 * NO MODEL CALL: a fixed vocabulary and the store's own tokenizer.
 */
import { ALIASES, CORE_EMOTIONS, FEELINGS_WHEEL, OTHER_EMOTION, coresOfFeeling, lookupWord, wheelEntry } from "../feelings-wheel.js";
import { tokenize } from "../store/index.js";

export type FeelingWhose = "owner" | "self";

/** What the caller knows and this file cannot: who is asking, and the owner's names. */
export interface FeelingAskInput {
  /** Whose "I" it is. `self` for the counterpart's own `recall`; `owner` at the console. */
  readonly asker: FeelingWhose;
  /** The owner's names, lower-case (`sleep/consolidate.ts#ownerNames`). */
  readonly ownerNames?: readonly string[];
  /** The owner's own session — filled in by `Recall.build` from its own stance,
   *  so a confidential stamp takes no nomination slot a non-owner can't see. */
  readonly owner?: boolean;
}

/** Words that make a question about feeling on their own, with no feeling named. */
export const FEEL_WORDS: readonly string[] = [
  "feel", "feels", "feeling", "feelings", "felt", "emotion", "emotions", "emotional", "mood", "moods",
];

/** Every word the wheel knows a feeling by: its words, its cores, and the aliases. */
export const WHEEL_VOCABULARY: ReadonlySet<string> = new Set<string>([
  ...CORE_EMOTIONS,
  ...FEELINGS_WHEEL.map((e) => e.word),
  ...Object.keys(ALIASES),
]);

/**
 * EVERYDAY WORDS OFF THE WHEEL that name a wheel word, read on the QUESTION
 * side only (2026-10-01, lane 6). Not the wheel's `ALIASES`: those decide for
 * a writer at the write door, and this lane writes nothing. Small on purpose,
 * and nothing a question often uses about a thing or a name ("panic", "hope",
 * "love", "worry", "pleased", "joy", "pride", "curiosity" are left out — the
 * B2 scar of #293). Like a stem, one of these names a feeling only in a
 * feeling's frame (`readFeelingAsk`): "when was I stressed", not "the
 * endpoints I stressed". A word that is
 * already on the wheel needs no line here (ashamed, scared, nervous, anxious,
 * lonely, proud, grateful, guilty and embarrassed are).
 */
export const EVERYDAY_TO_WHEEL: Readonly<Record<string, string>> = {
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
  jealousy: "jealous",
};

/** The wheel's PHRASES ("caught out", "let down", "at ease", "that's me",
 *  "it clicked"), spelled as `words` spells a question, to their keys. */
const WHEEL_PHRASE_KEYS: ReadonlyMap<string, string> = new Map(
  FEELINGS_WHEEL.map((e) => [words(e.word), e.key] as const)
    .filter(([w]) => w.length === 2)
    .map(([w, key]) => [w.join(" "), key]),
);

/** Words that ask for the strongest, or over all time (item 2 of lane 6) —
 *  only within `STRONGEST_REACH` words of a feel-word or a feeling word
 *  ("felt most strongly", "most moved"), never "the most recent release". */
const STRONGEST = new Set(["most", "ever", "strongest", "strongly", "since", "always", "deepest", "biggest", "hardest", "worst"]);
const STRONGEST_REACH = 2;
/** A question about the recent past is never one about the strongest ("what have I felt most recently"). */
const RECENT = new Set(["recent", "recently", "lately", "latest", "last", "today", "yesterday", "tonight", "now"]);

/**
 * The wheel words a LIGHT stem may land on: feelings whose -er/-est/-ness forms
 * are about a feeling ("happiest", "saddest", "sadness", "angrier",
 * "loneliest"). Not every wheel word: "opener", "warmer cache", "closer" are
 * about things.
 */
const STEMMABLE = new Set(["happy", "sad", "angry", "lonely", "proud", "glad", "calm", "fond", "tender", "nervous", "anxious", "grateful"]);

/**
 * A question word read as a wheel word: itself when the wheel (or a stamp in
 * this store) knows it (`via: "wheel"`), an everyday word's wheel word
 * (`"everyday"`), or a LIGHT stem of a `STEMMABLE` feeling (`"stem"`) —
 * happiest, happier, happiness → happy; saddest, sadness → sad.
 * `superlative` marks an "-est" form ("when was I happiest").
 */
export function feelingWord(
  w: string,
  stored: ReadonlySet<string> = new Set(),
): { word: string; superlative: boolean; via: "wheel" | "everyday" | "stem" } | null {
  // AN ALIAS READS AS ITS WHEEL WORD (2026-10-02, lane B; 0.3.10's follow-up):
  // "fear" is an alias of afraid, and read as itself it reached only a stamp
  // of afraid — never scared or frightened, which answer to their group's
  // word ("afraid"), not to its aliases. The question keeps the word asked too.
  if (w.length >= 3 && Object.hasOwn(ALIASES, w)) {
    const to = wheelEntry(ALIASES[w] as string)?.word;
    if (to !== undefined) return { word: to, superlative: false, via: "wheel" };
  }
  if (w.length >= 3 && (WHEEL_VOCABULARY.has(w) || stored.has(w))) return { word: w, superlative: false, via: "wheel" };
  if (Object.hasOwn(EVERYDAY_TO_WHEEL, w)) return { word: EVERYDAY_TO_WHEEL[w] as string, superlative: false, via: "everyday" };
  const known = (x: string): string | null => (STEMMABLE.has(x) ? x : null);
  const undouble = (x: string): string => (x.length >= 4 && x[x.length - 1] === x[x.length - 2] ? x.slice(0, -1) : x);
  const tries: [string, boolean][] = [];
  if (w.endsWith("iest")) tries.push([`${w.slice(0, -4)}y`, true]);
  if (w.endsWith("ier")) tries.push([`${w.slice(0, -3)}y`, false]);
  if (w.endsWith("iness")) tries.push([`${w.slice(0, -5)}y`, false]);
  if (w.endsWith("ness")) tries.push([w.slice(0, -4), false]);
  if (w.endsWith("est")) tries.push([w.slice(0, -3), true], [undouble(w.slice(0, -3)), true], [w.slice(0, -2), true]);
  if (w.endsWith("er")) tries.push([w.slice(0, -2), false], [undouble(w.slice(0, -2)), false], [w.slice(0, -1), false]);
  for (const [stem, superlative] of tries) {
    const hit = known(stem);
    if (hit !== null) return { word: hit, superlative, via: "stem" };
  }
  return null;
}

/**
 * The cores a question's feeling word reaches (the second tier): its home core
 * and a blend's second, for a word on the wheel; nothing for a word only a
 * writer's own `other_word` knows.
 */
export function coresOfWord(word: string): string[] {
  const entry = lookupWord(word)?.entry;
  return entry === undefined ? [] : coresOfFeeling(entry.core, entry.key);
}

/**
 * Is a cue token part of a feeling question's FRAME rather than its topic — a
 * feel-word, a feeling word (as `feelingWord` reads it), or a word asking for
 * the strongest? `activate.ts` uses it to tell a memory some topic word
 * reached from one only the feeling words (or the meaning) did (item 3).
 */
export function isFeelingFrameWord(token: string, stored: ReadonlySet<string>, names: ReadonlySet<string> = new Set()): boolean {
  if (names.has(token)) return false;
  return (
    FEEL_WORDS.includes(token) ||
    STRONGEST.has(token) ||
    QUESTION_FRAME.has(token) ||
    FIRST.has(token) ||
    SECOND.has(token) ||
    PLURAL.has(token) ||
    feelingWord(token, stored) !== null
  );
}

/**
 * The words a question is built from rather than about: wh-words, auxiliaries,
 * determiners, prepositions, conjunctions. The cue channel has no stop list
 * (rarity weighs every word, `cues.ts#informativeness`), so on a store where
 * few memories say "when", "when was I afraid" reaches a note by "when". This
 * list only decides what counts as a TOPIC word for item 3; it weighs nothing.
 */
// Only function words. Lower-case "will", "may", "can", "do" are here; the
// asker's capitalised Will or May is a topic anyway (`askedNames`, checked
// first). "it", "done" and "id" are left out (IT, a to-do, a memory id).
const QUESTION_FRAME = new Set([
  "what", "when", "where", "which", "who", "whom", "whose", "why", "how", "whats",
  "was", "were", "is", "are", "am", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "can", "could", "will", "would", "should", "may", "ive", "im",
  "the", "an", "this", "that", "these", "those", "some", "any", "them", "they", "their",
  "of", "to", "in", "on", "at", "for", "with", "about", "from", "by", "as", "into",
  "and", "or", "but", "if", "than", "then", "not", "very", "really", "time", "times",
]);

/**
 * Words the asker CAPITALISED other than at a sentence's start (and other than
 * "I"): a name or a proper noun — "how did I feel about Will", "in May", "a
 * person named Joy". Such a word is a topic (item 3), never a feeling word.
 * Not a word on the wheel ("I felt Sad" is still sad), and nothing in a
 * question typed all in capitals.
 */
export function askedNames(text: string): Set<string> {
  const out = new Set<string>();
  // A question typed in capitals ("WHEN WAS I SAD") capitalises nothing in particular.
  if (!/[a-z]/.test(text)) return out;
  let start = true;
  for (const m of text.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*|[.?!;:\n]/g)) {
    const tok = m[0];
    if (/^[.?!;:\n]$/.test(tok)) {
      start = true;
      continue;
    }
    const w = words(tok).join("");
    // A wheel word or core stays a feeling whatever its case ("when was I Sad").
    if (!start && /^[A-Z]/.test(tok) && !FIRST.has(w) && w !== "id" && w.length >= 2 && !WHEEL_VOCABULARY.has(w)) out.add(w);
    start = false;
  }
  return out;
}

// Not "id" ("I'd" without its apostrophe): in this store "id" is far more often a
// memory id, and a missed "I'd" only falls back to both.
const FIRST = new Set(["i", "im", "ive", "me", "my", "mine", "myself"]);
const SECOND = new Set(["you", "youre", "youve", "your", "yours", "yourself"]);
const PLURAL = new Set(["we", "weve", "us", "our", "ours", "ourselves"]);
const OWNER_WORDS = new Set(["owner", "user"]);
/** First- and second-person words that own a thing rather than feel one. */
const POSSESSIVE = new Set(["my", "mine", "your", "yours"]);

/** Lower-case words, apostrophes dropped, "I" kept (`cues.ts#words`'s rule). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/**
 * The owner's name in the possessive — "Mike's" (which `words` spells
 * `mikes`) or "James'" — as `words` spells it, read off the ORIGINAL text: only
 * a word written with an apostrophe, so a plain plural ("bills", "marks") is
 * never the owner Bill or Mark (a follow-up of #293).
 */
function possessiveNames(text: string, names: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/([A-Za-z0-9]+)['’](s?)(?![A-Za-z0-9])/g)) {
    const base = (m[1] as string).toLowerCase();
    if (names.has(base)) out.add(base + (m[2] === "" ? "" : "s"));
  }
  return out;
}

/**
 * Whose feeling the question asks about, or null for both. `ownerNames` are
 * matched as whole words, each word of a multi-word name on its own, and in
 * the possessive ("Mike's feelings").
 */
export function whoseAsked(text: string, input: FeelingAskInput): FeelingWhose | null {
  const other: FeelingWhose = input.asker === "self" ? "owner" : "self";
  const names = new Set((input.ownerNames ?? []).flatMap((n) => words(n)).filter((w) => w.length >= 2));
  const said = new Set<FeelingWhose>();
  const possessive = possessiveNames(text, names);
  for (const w of words(text)) {
    if (FIRST.has(w)) said.add(input.asker);
    else if (SECOND.has(w)) said.add(other);
    else if (PLURAL.has(w)) {
      said.add("owner");
      said.add("self");
    } else if (OWNER_WORDS.has(w) || names.has(w) || possessive.has(w)) said.add("owner");
  }
  return said.size === 1 ? ([...said][0] as FeelingWhose) : null;
}

/**
 * The wheel key a stamp reads as: its emotion, or — for an `other` whose own
 * word is on the wheel ("sheepish" kept as the writer's word) — that word's
 * key, so it answers to its group and counts under its home core like any
 * stamp of the word (2026-10-01, lane 6).
 */
function stampKey(f: { emotion: string; other_word: string | null }): string {
  if (f.emotion !== OTHER_EMOTION) return f.emotion;
  return f.other_word === null ? OTHER_EMOTION : (lookupWord(f.other_word)?.entry.key ?? OTHER_EMOTION);
}

/** Every core a stamp counts under (`coresOfFeeling` on `stampKey`): the second tier's match. */
export function stampCores(f: { core: string; emotion: string; other_word: string | null }): string[] {
  return coresOfFeeling(f.core, stampKey(f));
}

/** The words one stamp answers to. See the header. */
export function feelingTokens(f: { core: string; emotion: string; other_word: string | null }): Set<string> {
  const out = new Set<string>();
  // ONE word, or a PHRASE kept whole (wheel v2; phrases whole since lane 6):
  // "caught out" or "that's me" split into words would make "out" and "me"
  // feeling words for the whole store — the same rule as the writer's own
  // word below. Kept whole, spelled as `words` spells a question, it answers
  // only to the phrase asked as a phrase ("when was I caught out").
  const add = (text: string): void => {
    const toks = tokenize(text);
    if (toks.length === 1) out.add(toks[0] as string);
    else {
      const phrase = words(text);
      if (phrase.length > 1) out.add(phrase.join(" "));
    }
  };
  const key = stampKey(f);
  if (key !== OTHER_EMOTION) {
    const entry = wheelEntry(key);
    add(entry?.word ?? key.split(".").pop() ?? key);
    // Its group's word too (wheel v2): "when was I afraid" reaches a stamp of
    // scared, which sits under afraid (an alias of it on the first wheel).
    if (entry?.parent !== null && entry?.parent !== undefined) add(entry.parent);
    // And the page's name for the group when its key is another word: sad's
    // `wounded` group is the page's "hurt", so "when was I hurt" reaches stung.
    const label = entry?.label ?? (entry?.parent ? wheelEntry(entry.parent)?.label : undefined);
    if (label !== undefined) add(label);
    for (const [alias, to] of Object.entries(ALIASES)) if (to === key) add(alias);
  }
  for (const c of coresOfFeeling(f.core, key)) add(c);
  if (f.other_word !== null) {
    // The writer's own word — ONE word only (review of #293, B2). A phrase kept
    // as the word ("at the edge of something") would make "something" a
    // feeling word for the whole store.
    const own = tokenize(f.other_word);
    if (own.length === 1) out.add(own[0] as string);
  }
  return out;
}

export interface FeelingAsk {
  /**
   * A REAL question about feeling, so the answer is RANKED by the stamps'
   * strength: a feel-word, or a word naming a feeling, used about a PERSON
   * (see `aboutAPerson`). "what have I felt most strongly", "what moved me".
   */
  readonly ranked: boolean;
  /** Question words that name a feeling (wheel words, cores, aliases, or a
   *  word a stamp in this store answers to), leaving out a word used as a verb
   *  on a thing ("where we moved THE parser"). Empty with `ranked`: every stamp
   *  is in the pool. Without `ranked`, the stamps these words answer to are
   *  ordinary cues — they can find a memory, never lead the answer. */
  readonly named: ReadonlySet<string>;
  readonly whose: FeelingWhose | null;
  /**
   * The cores the named words reach (2026-10-01, lane 6): each named word's
   * home core, and a blend's second. A RANKED question's second tier — a stamp
   * under one of these that answers to no named word ranks after every stamp
   * that does. Empty when nothing is named.
   */
  readonly cores: ReadonlySet<string>;
  /**
   * The question asks for the STRONGEST, or over all time ("most", "ever",
   * "strongest", "since", a superlative like "happiest"): a ranked answer is
   * nominated by the stamps' recorded strength, not their softened strength.
   */
  readonly strongest: boolean;
}

/**
 * A word that, right after a feeling word, makes it a verb acting on a thing
 * ("moved THE parser", "moved MY parser", "I moved IT to src"). Not "me", "him"
 * or "us": "what moved ME" is the case this lane exists for.
 */
const DETERMINERS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "some",
  "my", "your", "his", "her", "its", "it", "them", "our", "their",
]);
/**
 * EVERYDAY WORDS ON THE WHEEL (the review of #301, m1): words a question uses
 * far more often about things than about feelings — "is my PR still open",
 * "I settled on the second option", "the most important thing". One names a
 * feeling only beside a feel-word or a form of "to be" (`FEELING_FRAME`) among
 * the two words before it: "felt close", "I was content", "was I content".
 * A stamp still answers to it; only the question's reading changes.
 */
export const EVERYDAY_FEELING_WORDS: ReadonlySet<string> = new Set([
  "close", "content", "settled", "seen", "caught", "engaged", "open", "important", "empty", "sorry",
  "familiar", "critical", "distant", "absorbed", "accepted", "satisfied", "powerful", "grounded",
]);
const FEELING_FRAME = new Set([...FEEL_WORDS, "am", "im", "is", "are", "was", "were", "be", "been", "being", "youre"]);

/** After "to be", an everyday word followed by one of these is not a feeling ("close to done"). */
const PREPOSITIONS = new Set(["to", "with", "on", "in", "of", "for", "at", "about"]);

/** A feel-word followed by one of these is an OPINION: "I feel like the test is flaky". */
const OPINION = new Set(["like", "that"]);
/** Scanning back stops here: another subject owns what follows (`cues.ts`'s rule). */
const THIRD = new Set(["he", "she", "they", "it", "its", "his", "her", "their", "theyre"]);
/** How far a person word may stand from the feeling word: before, and after. */
const BEFORE = 3;
const AFTER = 2;

/**
 * Is the feeling word at `at` used ABOUT A PERSON — the way `detectAffect`
 * decides, widened to both sides for "what moved ME"? A person is the first
 * person singular, the second person, the owner by word or by name, and — for a
 * feel-word only — "we": "what have we felt" is a feeling question, "where we
 * moved the parser" is not. Scanning back stops at a third-person subject.
 */
function aboutAPerson(
  toks: readonly string[],
  at: number,
  feelWord: boolean,
  names: ReadonlySet<string>,
  possessive: ReadonlySet<string> = new Set(),
): boolean {
  // A POSSESSIVE is not a person feeling something: "is MY build open", "MY
  // happy path test fails" (review of #293, R3). The subject and object forms are.
  // Beside a feel-word the possessive IS the person: "what are MY feelings",
  // "what's YOUR mood" — the shape the dashboard's rewrite hands over (final check, F1).
  const person = (w: string): boolean =>
    (FIRST.has(w) && (feelWord || !POSSESSIVE.has(w))) ||
    (SECOND.has(w) && (feelWord || !POSSESSIVE.has(w))) ||
    OWNER_WORDS.has(w) ||
    names.has(w) ||
    // The owner's name in the possessive is a possessive: a person only beside a feel-word.
    (feelWord && possessive.has(w)) ||
    (feelWord && PLURAL.has(w));
  for (let j = at - 1; j >= Math.max(0, at - BEFORE); j--) {
    const w = toks[j] as string;
    if (THIRD.has(w)) break;
    if (person(w)) return true;
  }
  for (let j = at + 1; j <= Math.min(toks.length - 1, at + AFTER); j++) {
    if (person(toks[j] as string)) return true;
  }
  return false;
}

/**
 * Read a deliberate question. `stored` is every word some stamp in the store
 * answers to, so a writer's own word off the wheel ("unsettled") names a
 * feeling here even though the wheel never heard of it.
 *
 * The everyday words on the wheel (`open`, `happy`, `moved`, `critical`) and
 * the everyday feel-word ("how does the importer feel to use") are why the
 * ranking needs a person: without one, a question about the happy path would
 * put six stamped memories ahead of the answer (review of #293, B2).
 */
export function readFeelingAsk(
  text: string,
  input: FeelingAskInput,
  stored: ReadonlySet<string>,
  minLength: number,
): FeelingAsk {
  const toks = words(text);
  const names = new Set((input.ownerNames ?? []).flatMap((n) => words(n)).filter((w) => w.length >= 2));
  const possessive = possessiveNames(text, names);
  /** Capitalised mid-sentence: a name or proper noun, never a feeling ("a person named Joy", "in May"). */
  const proper = askedNames(text);
  const person = (at: number, feelWord: boolean): boolean => aboutAPerson(toks, at, feelWord, names, possessive);
  const named = new Set<string>();
  const cores = new Set<string>();
  /** Where the feel-words and feeling words stand: "most" asks for the strongest only beside one. */
  const feelingAt: number[] = [];
  let ranked = false;
  let superlative = false;
  /** A word (or phrase) that names a feeling, read as `word` on the wheel. */
  const name = (asked: string, word: string): void => {
    named.add(asked);
    named.add(word);
    for (const c of coresOfWord(word)) cores.add(c);
  };
  // The wheel's PHRASES first ("caught out", "let down"), as two words in a
  // row — else "caught" meets the everyday frame rule alone and "out" is
  // nothing. A phrase followed by a determiner is a verb on a thing ("let
  // down THE team"), and it needs a PERSON right before it, directly or
  // through a feel-word or "to be" ("I was caught out", "felt let down") —
  // "caught out of range errors" is not a feeling.
  const inPhrase = new Set<number>();
  const isPerson = (w: string): boolean => FIRST.has(w) || SECOND.has(w) || PLURAL.has(w) || OWNER_WORDS.has(w) || names.has(w);
  for (let i = 0; i + 1 < toks.length; i++) {
    const key = WHEEL_PHRASE_KEYS.get(`${toks[i]} ${toks[i + 1]}`);
    if (key === undefined || DETERMINERS.has(toks[i + 2] ?? "")) continue;
    // "caught out of range errors", "caught out on a typo": a preposition after it makes it a thing's state.
    if (key === "caught out" && (PREPOSITIONS.has(toks[i + 2] ?? "") || toks[i + 2] === "from")) continue;
    const prev = toks[i - 1] ?? "";
    // "ashamed or caught out": a phrase joined to a feeling word shares its frame.
    const joined = (prev === "or" || prev === "and") && feelingWord(toks[i - 2] ?? "", stored) !== null;
    const subject =
      joined || isPerson(prev) || ((FEEL_WORDS.includes(prev) || FEELING_FRAME.has(prev)) && isPerson(toks[i - 2] ?? ""));
    const framed = (FEEL_WORDS.includes(prev) || FEELING_FRAME.has(prev)) && person(i, false);
    if (!subject && !framed) continue;
    inPhrase.add(i);
    inPhrase.add(i + 1);
    feelingAt.push(i, i + 1);
    name(`${toks[i]} ${toks[i + 1]}`, key);
    // Joined to a feeling word only, it ranks as that word would: about a person.
    if (!joined || isPerson(prev) || person(i, false)) ranked = true;
  }
  /** A feel-word anywhere in the question: the frame an everyday word or a stem needs. */
  const anyFeelWord = toks.some((w) => FEEL_WORDS.includes(w));
  toks.forEach((w, i) => {
    if (inPhrase.has(i)) return;
    if (FEEL_WORDS.includes(w)) {
      if (OPINION.has(toks[i + 1] ?? "")) return; // "I feel like…", "I felt that…": an opinion
      feelingAt.push(i);
      if (person(i, true)) ranked = true;
      return;
    }
    if (w.length < minLength || proper.has(w)) return;
    const read = feelingWord(w, stored);
    if (read === null) return;
    if (DETERMINERS.has(toks[i + 1] ?? "")) return; // a verb on a thing, not a feeling
    const before = [toks[i - 1] ?? "", toks[i - 2] ?? ""];
    // A word off the wheel (an everyday word, a stem) names a feeling only in
    // a feeling's frame: a feel-word in the question, or "to be" just before
    // ("when was I stressed", not "the endpoints I stressed").
    if (read.via !== "wheel" && !anyFeelWord && !before.some((b) => FEELING_FRAME.has(b))) return;
    // An everyday word is a feeling only in a feeling's frame ("I was content").
    if (EVERYDAY_FEELING_WORDS.has(w) || EVERYDAY_FEELING_WORDS.has(read.word)) {
      const felt = before.some((b) => FEEL_WORDS.includes(b));
      if (!felt) {
        if (!before.some((b) => FEELING_FRAME.has(b))) return;
        // After "to be" only: a preposition next makes it a state of a thing
        // or a task — "close to done", "engaged with", "familiar to you". After
        // a feel-word it stays a feeling: "felt close to Mike".
        if (PREPOSITIONS.has(toks[i + 1] ?? "")) return;
      }
    }
    name(w, read.word);
    feelingAt.push(i);
    if (read.superlative) superlative = true;
    if (person(i, false)) ranked = true;
  });
  // STRONGEST (item 2): a superlative feeling ("happiest"), or a "most / ever /
  // strongest / since" word within reach of a feel-word or a feeling word
  // ("felt most strongly", "most moved") — and never in a question about the
  // recent past ("what have I felt most recently", "the most recent release").
  const recent = toks.some((w) => RECENT.has(w));
  const strongest =
    !recent &&
    (superlative ||
      toks.some((w, i) => STRONGEST.has(w) && feelingAt.some((j) => Math.abs(j - i) <= STRONGEST_REACH)));
  return { ranked, named, whose: whoseAsked(text, input), cores, strongest };
}
