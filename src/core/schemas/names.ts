/**
 * THE NAME TALLY (2026-10-11, Group 3 part D): which names the store's own
 * memories keep saying, counted mechanically — the night's half of card birth.
 *
 * A card used to be born from a memory's TITLE (`counterpart.ts`'s
 * `mentionFromProposal`), and an authored title is a sentence that never occurs
 * verbatim in its own body, so every authored write refused `name-not-in-source`:
 * after 19 lived days the one card on the owner's store was the install-seeded
 * identity core (review 12 §3a). Names are where they actually are — in the
 * text — so the birth door reads the text.
 *
 * What counts as a name here, all of it mechanical and none of it a model call:
 *
 * - **A capitalized run, seen mid-sentence at least once.** One to
 *   `MAX_WORDS` adjacent capitalized words ("Copper Kettle"), where a
 *   capitalized word starts upper-then-lower case (so "PR", "MCP" and "ELI5"
 *   are acronyms, not names) and has no digits. A sentence's first word is
 *   capitalized by grammar, so a run that starts a sentence, a line, a bullet or
 *   a title does not PROPOSE a name; it still COUNTS for a name proposed
 *   elsewhere.
 * - **Counted by the linker's own rule.** A candidate's memories are the ones
 *   `nameRegex` finds it in (whole word, possessive read as the name,
 *   case-insensitive) — exactly what a newborn card links when it looks back
 *   (`Schemas#linkNamingMemories`), so the count the tally reports is the count
 *   the card gets.
 * - **Mostly written as a name.** The whole-word matcher has no case option
 *   (words.ts), so a card named "Will" would name every "will" forever. A
 *   candidate that `lowerCaseShare` or more of its memories also write in
 *   another case, in prose, is an English word that is sometimes capitalized
 *   ("Code", "Job", "Health"), not a name. A use inside code or an address is
 *   not prose — a path, a command in backticks, a version, a domain — so a
 *   project whose name is also its command still reads as a name.
 * - **Not a weekday or a month** (or their short forms) — those are
 *   capitalized mid-sentence and never written lower-case, and they are time
 *   words, which recall reads its own way.
 * - **The whole name, not a piece of it.** A name inside a longer reported
 *   name that at least half its memories say as part of the longer one
 *   ("Kettle" inside "Copper Kettle", "Lights" inside "Harbour Lights") is the longer
 *   name's word, and only the longer one is reported: a card for the piece
 *   would refuse the whole name as a near collision.
 *
 * Pure: texts in, counts out. The thresholds, the cap and the gates
 * (`mention()`'s whole-word source test, collisions, never a second self) are
 * the caller's (`Schemas#birthsFromNames`).
 */

import { nameRegex, unpossessed } from "../encode/words.js";

/** One live memory, as the tally reads it. */
export interface TalliedText {
  readonly id: string;
  readonly title: string | null;
  readonly body: string;
  /** The lived day it was written on (`birth_day`). */
  readonly day: number;
  readonly kind: string;
}

export interface NameCount {
  /** The name, verbatim as first proposed. */
  readonly name: string;
  /** The memories naming it by the linker's rule. Sorted ids. */
  readonly memories: readonly string[];
  /** Distinct lived days those memories were written on. */
  readonly days: number;
  /** Those memories by kind. */
  readonly kinds: Readonly<Record<string, number>>;
  /** Those of them that name it in their title, by kind — what a memory is ABOUT. */
  readonly titledKinds: Readonly<Record<string, number>>;
}

export interface NameTally {
  /** Names that met the bar and passed the case and time-word tests, most-named first. */
  readonly names: readonly NameCount[];
  /** How many distinct names were proposed mid-sentence at all. */
  readonly proposed: number;
  /** Of the names that met the bar, how many read as words (the case test). */
  readonly lowerCase: number;
}

export interface TallyOptions {
  readonly minMemories: number;
  readonly minDays: number;
  /** A name this share of whose memories write it in another case is a word. */
  readonly lowerCaseShare: number;
  /** The caller's: a name it does not want counted (one a card already holds). */
  readonly skip?: (name: string) => boolean;
}

/** Runs longer than this are title-case phrases, not names. */
export const MAX_WORDS = 3;

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_WORDS = new Set([
  ...WEEKDAYS,
  ...WEEKDAYS.map((d) => `${d}s`),
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

/** A word, by the one word class `words.ts` matches with. */
const TOKEN = /[\p{L}\p{N}_'’-]+/gu;
const CAPITALIZED = /^\p{Lu}\p{Ll}/u;
const HAS_DIGIT_OR_UNDERSCORE = /[\p{N}_]/u;
/** Skipped when looking back for a sentence boundary: openers and markup. */
const OPENERS = new Set([" ", "\t", "\r", '"', "'", "“", "‘", "(", "[", "{", "*", "_", "`", ">"]);
/** What ends a sentence or starts a line item. A newline is handled apart. */
const BOUNDARY = new Set([".", "!", "?", ":", ";", "•", "#", "|", "-"]);
const CODE_BEFORE = /[`/.@~_\\]/u;
const CODE_AFTER = /^(?:[/@`]|\.\p{L})/u;

interface Run {
  readonly words: readonly string[];
  readonly initial: boolean;
}

/** True when the word starting at `at` begins a sentence, a line or the text. */
function startsSentence(text: string, at: number): boolean {
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = text[i] as string;
    if (ch === "\n") return true;
    if (!OPENERS.has(ch)) return BOUNDARY.has(ch);
  }
  return true;
}

/** A use at `at`, `n` long, sits in code or an address, not in prose. */
function inCode(text: string, at: number, n: number): boolean {
  return CODE_BEFORE.test(text[at - 1] ?? "") || CODE_AFTER.test(text.slice(at + n, at + n + 2));
}

/** The capitalized runs of one text (a title or a body), in order. */
function runsOf(text: string): Run[] {
  const runs: Run[] = [];
  let words: string[] = [];
  let initial = false;
  let lastEnd = -1;
  const flush = (): void => {
    if (words.length > 0) runs.push({ words, initial });
    words = [];
  };
  for (const m of text.matchAll(TOKEN)) {
    const token = m[0];
    const at = m.index;
    const capitalized = CAPITALIZED.test(token) && !HAS_DIGIT_OR_UNDERSCORE.test(token);
    // Adjacent means one plain space between the words, and the previous word
    // not possessive ("Han's Garden" is two names, not one).
    const prev = words[words.length - 1];
    const adjacent = prev !== undefined && at === lastEnd + 1 && text[lastEnd] === " " && unpossessed(prev) === prev;
    if (!capitalized) {
      flush();
    } else if (adjacent) {
      words.push(token);
    } else {
      flush();
      words = [token];
      initial = startsSentence(text, at);
    }
    lastEnd = at + token.length;
  }
  flush();
  return runs;
}

/** A run as a name: the trailing possessive read off its last word. */
function nameOf(words: readonly string[]): string {
  const last = unpossessed(words[words.length - 1] as string);
  return [...words.slice(0, -1), last].join(" ");
}

/** True when the text writes a (longer) name in another case, in prose. */
function writesOtherCase(text: string, name: string): boolean {
  for (const m of text.matchAll(new RegExp(nameRegex(name, "iu").source, "giu"))) {
    if (unpossessed(m[0]) === name || inCode(text, m.index, m[0].length)) continue;
    return true;
  }
  return false;
}

/**
 * Count the names the texts keep saying. A name is reported when at least
 * `minMemories` memories on at least `minDays` lived days name it, fewer than
 * `lowerCaseShare` of them write it in another case, it is not a time word,
 * and `skip` does not claim it.
 */
export function tallyNames(texts: readonly TalliedText[], opts: TallyOptions): NameTally {
  // Pass 1, one read of each memory: the names proposed (mid-sentence runs);
  // every capitalized run, as the cheap prefilter; which memories hold each
  // word; and how each word is written in prose, memory by memory.
  const proposed = new Map<string, string>();
  const capMemories = new Map<string, Set<number>>();
  const byWord = new Map<string, number[]>();
  const proseForms = new Map<string, Map<number, Set<string>>>();
  const joined: string[] = [];
  texts.forEach((t, index) => {
    const text = t.title === null || t.title.length === 0 ? t.body : `${t.title}\n${t.body}`;
    joined.push(text);
    const words = new Set<string>();
    for (const m of text.matchAll(TOKEN)) {
      const word = unpossessed(m[0]);
      const key = word.toLowerCase();
      words.add(key);
      if (inCode(text, m.index, m[0].length)) continue;
      let forms = proseForms.get(key);
      if (forms === undefined) proseForms.set(key, (forms = new Map()));
      const seen = forms.get(index);
      if (seen === undefined) forms.set(index, new Set([word]));
      else seen.add(word);
    }
    for (const w of words) {
      const list = byWord.get(w);
      if (list === undefined) byWord.set(w, [index]);
      else list.push(index);
    }
    const runs = new Set<string>();
    for (const part of [t.title ?? "", t.body]) {
      for (const run of runsOf(part)) {
        if (run.words.length > MAX_WORDS) continue;
        // Every contiguous piece counts, so a sentence-initial "Yesterday Wren"
        // still counts for "Wren"; only the whole run, mid-sentence, proposes.
        for (let i = 0; i < run.words.length; i += 1) {
          for (let j = i + 1; j <= run.words.length; j += 1) {
            const name = nameOf(run.words.slice(i, j));
            runs.add(name);
            if (i === 0 && j === run.words.length && !run.initial && !proposed.has(name.toLowerCase())) {
              proposed.set(name.toLowerCase(), name);
            }
          }
        }
      }
    }
    for (const name of runs) {
      const set = capMemories.get(name) ?? new Set<number>();
      set.add(index);
      capMemories.set(name, set);
    }
  });

  // Pass 2: only names that could meet the bar on their capitalized uses alone
  // are counted with the linker's rule, and only in the memories holding their
  // first word. A one-word name is in a memory exactly when the memory holds it
  // as a word (the same word class and possessive as `nameRegex`), so only a
  // longer name needs the regex.
  const counted: NameCount[] = [];
  let lowerCase = 0;
  for (const name of proposed.values()) {
    if (name.split(" ").some((w) => TIME_WORDS.has(w.toLowerCase()))) continue;
    const caps = capMemories.get(name);
    if (caps === undefined || caps.size < opts.minMemories) continue;
    if (new Set([...caps].map((i) => (texts[i] as TalliedText).day)).size < opts.minDays) continue;
    if (opts.skip?.(name) === true) continue;
    const anyCase = nameRegex(name, "iu");
    const lower = name.toLowerCase();
    const first = lower.split(" ")[0] as string;
    const oneWord = first === lower;
    const memories: string[] = [];
    const days = new Set<number>();
    const kinds: Record<string, number> = {};
    const titledKinds: Record<string, number> = {};
    let otherCase = 0;
    for (const i of byWord.get(first) ?? []) {
      const text = joined[i] as string;
      if (!oneWord && !anyCase.test(text)) continue;
      const t = texts[i] as TalliedText;
      memories.push(t.id);
      days.add(t.day);
      kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
      if (t.title !== null && anyCase.test(t.title)) titledKinds[t.kind] = (titledKinds[t.kind] ?? 0) + 1;
      const written = oneWord
        ? [...(proseForms.get(lower)?.get(i) ?? [])].some((w) => w !== name)
        : writesOtherCase(text, name);
      if (written) otherCase += 1;
    }
    if (memories.length < opts.minMemories || days.size < opts.minDays) continue;
    if (otherCase >= opts.lowerCaseShare * memories.length) {
      lowerCase += 1;
      continue;
    }
    counted.push({ name, memories: memories.sort(), days: days.size, kinds, titledKinds });
  }
  // A piece of a longer name, said as part of it in at least half its
  // memories, is that name's word: "Lights" mostly says "Harbour Lights". A card
  // for the piece would refuse the whole name (`collision-near`) for good.
  const names = counted.filter(
    (short) =>
      !counted.some(
        (long) =>
          long !== short &&
          2 * long.memories.length >= short.memories.length &&
          long.name.split(" ").length > short.name.split(" ").length &&
          ` ${long.name.toLowerCase()} `.includes(` ${short.name.toLowerCase()} `),
      ),
  );
  names.sort((a, b) => b.memories.length - a.memories.length || b.days - a.days || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { names, proposed: proposed.size, lowerCase };
}
