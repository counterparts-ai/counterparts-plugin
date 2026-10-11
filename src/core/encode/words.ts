/**
 * The ONE whole-word definition, and the ONE normalization the content floor
 * uses.
 *
 * Substring name matching is gone, settled by measurement (CONTRACT §4): the self
 * schema is *named* "self", so 21% of its matches came from the English inside
 * "myself", "itself", and "self-contained" — dragging ~100 KB of identity core
 * into prompts about nothing of the sort while the schemas the span actually
 * named went unshown.
 *
 * Behavioral-spec §8 G3: whole-word matching has ONE definition, SHARED WITH
 * SCHEMA BIRTH. `schemas/` must import this function rather than write its own,
 * or the two drift and a name that "was in the span" for one is not for the
 * other. That is why it lives in its own file with no other dependencies.
 */

/**
 * What counts as inside a word. Hyphens and apostrophes ARE word characters,
 * which is the whole point: it is precisely because `-` does not break a word
 * that "self" fails to match "self-contained" — the measured false positive.
 * A multi-word term like "claude code" still matches, because the boundary test
 * only looks at the characters on either END of the term.
 */
const WORD_CHAR = "[\\p{L}\\p{N}_'’-]";

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A regex matching `term` as a whole word. Case-insensitive, deliberately and
 * without an option: an option is how two callers drift apart, and "verbatim in
 * the source" is a claim about the WORDS, not about the shift key (NOTES.md).
 */
export function wholeWordRegex(term: string, flags = "iu"): RegExp {
  const t = escapeRegExp(term.trim());
  return new RegExp(`(?<!${WORD_CHAR})${t}(?!${WORD_CHAR})`, flags);
}

/**
 * THE NAME RULE (2026-10-03, review of #322): the whole-word rule above, with
 * a trailing possessive read as the name — "Han's", "Han’s", "James'" name
 * Han and James. The apostrophe stays a word character everywhere else, so
 * "Hans", "Oskarsson" and "Han'll" still do not. For what a text NAMES (the
 * alias index's `matchesIn` and `scanner`, and so subject links and the
 * crediting of a card a memory names); birth's name-in-source test and the
 * encoder's preselection keep the strict rule.
 */
export function nameRegex(term: string, flags = "iu"): RegExp {
  const t = escapeRegExp(term.trim());
  return new RegExp(`(?<!${WORD_CHAR})${t}(?:['’]s?)?(?!${WORD_CHAR})`, flags);
}

/** True when `term` occurs in `haystack` as a name (`nameRegex`). Empty terms never match. */
export function occursAsName(haystack: string, term: string): boolean {
  const t = term.trim();
  if (t.length === 0) return false;
  return nameRegex(t).test(haystack);
}

/**
 * A whole-word token with a trailing possessive taken off (`han's` → `han`,
 * `james'` → `james`), or the token itself — the prefilter's side of
 * `nameRegex`, so a scanner keyed on a term's first word still tries "Han"
 * on "Han's".
 */
export function unpossessed(token: string): string {
  const m = /^(.+?)['’]s?$/u.exec(token);
  return m === null ? token : (m[1] as string);
}

/** True when `term` occurs in `haystack` as a whole word. Empty terms never match. */
export function occursAsWholeWord(haystack: string, term: string): boolean {
  const t = term.trim();
  if (t.length === 0) return false;
  return wholeWordRegex(t).test(haystack);
}

/** How many whole-word occurrences. Used for per-channel attribution, not counts of text. */
/**
 * THE TEXT'S WHOLE WORDS, lower-cased: its runs of word characters, by the
 * one class the matcher above uses (v12, 2026-10-03). A PREFILTER'S INDEX,
 * never a match — a term can only occur as a whole word where its first run
 * of word characters is one of these, and every candidate is confirmed with
 * `occursAsWholeWord` (`schemas/aliases.ts#AliasIndex.scanner`).
 */
export function wordTokens(text: string): string[] {
  return text.toLowerCase().match(WORD_RUN) ?? [];
}

const WORD_RUN = new RegExp(`${WORD_CHAR}+`, "gu");

export function countWholeWord(haystack: string, term: string): number {
  const t = term.trim();
  if (t.length === 0) return 0;
  const re = wholeWordRegex(t, "giu");
  let n = 0;
  while (re.exec(haystack) !== null) n += 1;
  return n;
}

/**
 * The floor's normalization: case-folded, punctuation and markdown scaffolding
 * removed, whitespace collapsed. The stub list is matched against THIS, exactly
 * — never as a substring (§3), so "keeps a TODO list in vim" survives.
 */
export function normalizeForFloor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~>#\[\]()]/g, " ")
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word count over the normalized form. */
export function countWords(text: string): number {
  const n = normalizeForFloor(text);
  return n.length === 0 ? 0 : n.split(" ").length;
}
