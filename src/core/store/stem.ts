/**
 * Light stemming for the word index — an EXPERIMENT (2026-10-19, Mike's word,
 * first-prompt recall diagnosis Bug 2). Check ~10-22; revert by 11-02 if the
 * live record and the bench do not show it earning its place (see
 * `docs/decisions.d/2026-10-19-stemming-everyday-words.md`).
 *
 * WHAT WE ARE TRYING: "bake", "bakes", "baked" and "baking" become ONE indexed
 * term, so a question that says "bake" reaches the memory titled "Birthday
 * baking plans". Before this the index was lowercase-and-split only, and in the
 * bench store the diagnosis used those four words were four separate words
 * spread over sixteen memories.
 *
 * WHERE IT RUNS, AND WHERE IT NEVER DOES. `indexTerms` (below) is what the index
 * stores and what `searchIndex` / `docFrequency` look up. It is NOT `tokenize`:
 * about fifteen callers read `tokenize` for things that are not the index —
 * the gate's near-duplicate overlap, facts mode's dedup sets, meaning's name
 * matching, the feeling ask — and they keep seeing the words as written.
 * Callers above the store (recall's cues, facts mode) keep SURFACE words as
 * their keys too; they only group surface words that share a stem, so "bake …
 * baking" in one question is one cue, not two cues reading one posting list.
 *
 * THE RULES are Porter's step 1 (plurals; -ed / -ing with the -e, double
 * consonant and short-word fixups; y → i), Porter's step 5a (a final -e), and
 * "-ie" → "-i" so "cookie" meets "cookies". Nothing past that — no -ness,
 * -ation, -ful — because those change meaning more often than they keep it,
 * and an experiment should be the smallest change that could show something.
 *
 * GUARDS, which are the part that must not move:
 *   - a token holding a DIGIT is never touched ("v13", "0.3.26"'s "26",
 *     "251c2ccb8a01"): ids, versions and numbers stay exact;
 *   - a token shorter than four letters is never touched ("bus", "gas", "his",
 *     "mem", "abc"), and no rule leaves fewer than three;
 *   - "-ss", "-us" and "-is" keep their s ("glass", "bonus", "Paris", "this");
 *   - Porter2's own exceptions are kept ("news" is not "new"; "skies" is "sky").
 * A name is stemmed like any word ("James" → "jame"), and that is safe for the
 * same reason everything here is: the question and the memory go through the
 * same function, so an exact name still meets itself. What stemming CAN do is
 * merge two different words; the known merges are listed in the decision
 * fragment (even/evening, sim/sims, horse → "hor", use/uses but not used/using).
 *
 * IDEMPOTENT BY CONSTRUCTION: the rules run to a fixed point (every rule
 * shortens the word, so it stops), which is what lets the worker re-stem an
 * index whose rows are already half stemmed (`cache.ts#restemBatch`) without
 * stemming anything twice.
 *
 * NO DEPENDENCY: forty lines written here (runtime deps default to zero).
 */

/** Names the rule set, as `cache_meta.terms` records it. A change to the rules
 *  is a change to the index, and NOT one the worker's re-stem can make: that
 *  derives from rows already stemmed under these rules, so new rules need a
 *  cache bump whose worker step re-indexes from prose. */
export const STEMMER_VERSION = "light-1";

/**
 * Porter2's exceptional forms that this rule set would otherwise get wrong:
 * left as they are ("news" is not the plural of "new"), or mapped to the word
 * they are a form of. Every value is its own stem, so the map stays idempotent.
 */
const EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["news", "news"], ["atlas", "atlas"], ["cosmos", "cosmos"], ["bias", "bias"], ["andes", "andes"],
  ["skies", "sky"], ["skis", "ski"], ["dying", "die"], ["lying", "lie"], ["tying", "tie"],
]);

const VOWEL = new Set(["a", "e", "i", "o", "u"]);

/** Porter's consonant: not a vowel, and a "y" only when it follows a vowel (or starts the word). */
function cons(w: string, i: number): boolean {
  const c = w[i] as string;
  if (VOWEL.has(c)) return false;
  if (c === "y") return i === 0 ? true : !cons(w, i - 1);
  return true;
}

/** Porter's measure m: the number of vowel-consonant sequences in `[C](VC){m}[V]`. */
function measure(w: string): number {
  let m = 0;
  let i = 0;
  const n = w.length;
  while (i < n && cons(w, i)) i++;
  while (i < n) {
    while (i < n && !cons(w, i)) i++;
    if (i >= n) break;
    while (i < n && cons(w, i)) i++;
    m++;
  }
  return m;
}

function hasVowel(w: string): boolean {
  for (let i = 0; i < w.length; i++) if (!cons(w, i)) return true;
  return false;
}

/** consonant-vowel-consonant at the end, the last not w, x or y ("hop", "bak"). */
function cvc(w: string): boolean {
  const n = w.length;
  if (n < 3) return false;
  if (!cons(w, n - 3) || cons(w, n - 2) || !cons(w, n - 1)) return false;
  const last = w[n - 1] as string;
  return last !== "w" && last !== "x" && last !== "y";
}

function doubleConsonant(w: string): boolean {
  const n = w.length;
  return n >= 2 && w[n - 1] === w[n - 2] && cons(w, n - 1);
}

/** One pass of the rules. */
function pass(word: string): string {
  let w = word;
  // Step 1a — plurals.
  if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ies")) w = w.length > 4 ? w.slice(0, -2) : w.slice(0, -1);
  else if (w.endsWith("ss") || w.endsWith("us") || w.endsWith("is")) {
    // kept: glass, bonus, Paris, this
  } else if (w.endsWith("s") && hasVowel(w.slice(0, -2))) w = w.slice(0, -1);
  // Step 1b — -eed, -ed, -ing.
  if (w.endsWith("eed")) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else {
    for (const suffix of ["ing", "ed"]) {
      if (!w.endsWith(suffix)) continue;
      const stem = w.slice(0, -suffix.length);
      if (stem.length >= 3 && hasVowel(stem)) {
        w = stem;
        if (w.endsWith("at") || w.endsWith("bl") || w.endsWith("iz")) w += "e";
        else if (doubleConsonant(w) && w.length > 3 && !/[lsz]$/.test(w)) w = w.slice(0, -1);
        else if (measure(w) === 1 && cvc(w)) w += "e";
      }
      break;
    }
  }
  // Step 1c — a final y after a consonant (not the first letter) reads as i.
  if (w.endsWith("y") && w.length >= 3 && cons(w, w.length - 2)) w = `${w.slice(0, -1)}i`;
  // "-ie" → "-i", so "cookie" meets "cookies" (whose -ies became -i above).
  if (w.length >= 5 && w.endsWith("ie")) w = w.slice(0, -1);
  // Step 5a — a final e, unless the word is short and ends consonant-vowel-consonant ("bake", "hope").
  if (w.endsWith("e")) {
    const stem = w.slice(0, -1);
    const m = measure(stem);
    if (stem.length >= 3 && (m > 1 || (m === 1 && !cvc(stem)))) w = stem;
  }
  return w;
}

/** The index form of one token from `tokenize` (lowercase a–z0–9). */
export function stemTerm(token: string): string {
  if (token.length < 4 || !/^[a-z]+$/.test(token)) return token;
  const exception = EXCEPTIONS.get(token);
  if (exception !== undefined) return exception;
  let w = token;
  // To a fixed point: every rule shortens the word, so this ends, and a word
  // that comes out is one the rules leave alone (or shorter than four).
  while (w.length >= 4) {
    const next = pass(w);
    if (next === w) break;
    w = next;
  }
  return w;
}

/** The index's terms for a text: `tokenize`, then `stemTerm` on each token. */
export function stemTokens(tokens: readonly string[]): string[] {
  return tokens.map(stemTerm);
}
