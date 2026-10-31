/**
 * The alias index — this module's, and the one `recall/` borrows (SEAMS §6).
 *
 * ONE WHOLE-WORD RULE. `occursAsWholeWord` is imported from `encode/words.ts`
 * and there is no second definition here, deliberately and by SEAMS §7 /
 * behavioral-spec §8 G3: birth must test a proposed name by EXACTLY the rule
 * preselection uses, or a name that "was in the span" for one is not for the
 * other. The subtlety that matters is that hyphens and apostrophes are word
 * characters — which is why `self` does not match `self-contained`, v1's
 * measured 21% false-positive rate on the self schema. A copy of that rule here
 * would drift from it in exactly one release.
 *
 * What a text NAMES (`matchesIn`, `scanner`) reads the rule through
 * `nameRegex` (2026-10-03, review of #322): the same rule, with a trailing
 * possessive read as the name, so "Han's birthday" names Han. Birth's
 * name-in-source test keeps the strict rule.
 *
 * Aliases are first-class and change only through explicit alias operations,
 * never as a side effect of editing prose (§4.2 G4) — which is why this index
 * has `register` / `unregister` and no "sync from body text" path.
 */

import { nameRegex, occursAsName, unpossessed, wordTokens } from "../encode/words.js";

/**
 * THE PREFILTER'S TWO SIDES (LT1, 2026-10-30): which words of a text a term's
 * first word could be, and which term's first word can be looked up at all. It
 * may try a term that does not match (the whole-word rule then says no) and must
 * never skip one that does.
 *
 * `nameRegex` matches by the `iu` flags' case folding and `wordTokens` by
 * `toLowerCase`, and those two disagree: a final sigma, a long s, a micro sign.
 * Exactly one non-ASCII character folds onto an ASCII letter and survives
 * `toLowerCase` (the long s; the Kelvin sign lower-cases to `k`), so a term in plain
 * ASCII is safe once that one is mapped. A term with anything else in it is simply
 * always tried, which is what every term cost before: that also covers U+0345,
 * which folds to iota and is no word character.
 *
 * One input where the hits do move, on no real card or text so far. Under bun,
 * `nameRegex`'s lookbehind doesn't see a letter outside the BMP as a word character,
 * so the rule alone finds "kim" in "\u{10400}kim". Node's doesn't, and now neither
 * does bun for a plain ASCII term, since that text's word is the whole run.
 */
function wordsIn(text: string): Set<string> {
  return new Set(wordTokens(text.replace(/\u017f/gu, "s")).flatMap((t) => [t, unpossessed(t)]));
}

/** The word to look a term up by; null means try it on every text. */
function firstWordKey(term: string): string | null {
  if (!/^[\x00-\x7f]*$/.test(term)) return null;
  return wordTokens(term)[0] ?? null;
}

function mayOccur(words: ReadonlySet<string>, term: string): boolean {
  const key = firstWordKey(term);
  return key === null || words.has(key);
}

export interface AliasHit {
  id: string;
  /** The registered term that matched, verbatim as registered. */
  term: string;
  source: "name" | "alias";
}

interface Registered {
  name: string;
  aliases: string[];
}

/**
 * Handles fold to lower case for LOOKUP because the shared whole-word matcher is
 * case-insensitive without an option — an option is how two callers drift apart
 * (words.ts). Keying any other way would make `lookup` and `matchesIn` disagree.
 */
export function handleKey(term: string): string {
  return term.trim().toLowerCase();
}

export class AliasIndex {
  private readonly byKey = new Map<string, Set<string>>();
  private readonly byId = new Map<string, Registered>();

  /** Idempotent: re-registering an id replaces its terms wholesale. */
  register(id: string, name: string, aliases: readonly string[] = []): void {
    this.unregister(id);
    const terms: Registered = { name, aliases: [...aliases] };
    this.byId.set(id, terms);
    for (const term of [name, ...terms.aliases]) {
      const key = handleKey(term);
      if (key.length === 0) continue;
      const set = this.byKey.get(key) ?? new Set<string>();
      set.add(id);
      this.byKey.set(key, set);
    }
  }

  unregister(id: string): void {
    const prior = this.byId.get(id);
    if (prior === undefined) return;
    for (const term of [prior.name, ...prior.aliases]) {
      const key = handleKey(term);
      const set = this.byKey.get(key);
      if (set === undefined) continue;
      set.delete(id);
      if (set.size === 0) this.byKey.delete(key);
    }
    this.byId.delete(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  termsFor(id: string): { name: string; aliases: string[] } | undefined {
    const r = this.byId.get(id);
    return r === undefined ? undefined : { name: r.name, aliases: [...r.aliases] };
  }

  /** Exact handle resolution. Two ids means the handle is ambiguous (§9 G5). */
  lookup(term: string): string[] {
    return [...(this.byKey.get(handleKey(term)) ?? [])].sort();
  }

  /** Handles that resolve to more than one entity — the half recall enforces. */
  ambiguous(): string[] {
    return [...this.byKey.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([key]) => key)
      .sort();
  }

  /**
   * The map `recall/`'s `Turn.aliases` wants, so the caller stops supplying it
   * from thin air (recall/INTERFACE-GAPS §2). Handle -> ids, both halves live.
   */
  map(): ReadonlyMap<string, readonly string[]> {
    const out = new Map<string, readonly string[]>();
    for (const [key, ids] of this.byKey) out.set(key, [...ids].sort());
    return out;
  }

  /**
   * Every registered term occurring in `text` AS A WHOLE WORD, by the one shared
   * definition — a trailing possessive ("Han's", "James'") read as the name
   * (`encode/words.ts#nameRegex`). Subject links and the crediting of a card a
   * memory names both read this.
   *
   * It runs on every prompt, in a fresh process, so it compiles only the terms
   * whose first word the text holds (LT1, 2026-10-30). The hits are the same:
   * `mayOccur` only skips work.
   */
  matchesIn(text: string): AliasHit[] {
    const hits: AliasHit[] = [];
    const words = wordsIn(text);
    for (const [id, reg] of this.byId) {
      if (mayOccur(words, reg.name) && occursAsName(text, reg.name)) hits.push({ id, term: reg.name, source: "name" });
      for (const alias of reg.aliases) {
        if (mayOccur(words, alias) && occursAsName(text, alias)) hits.push({ id, term: alias, source: "alias" });
      }
    }
    return hits.sort((a, b) => a.id.localeCompare(b.id) || a.term.localeCompare(b.term));
  }

  size(): number {
    return this.byId.size;
  }

  /** Every registered card and its terms, by id (v12: the backfill's term table). */
  entries(): { id: string; name: string; aliases: string[] }[] {
    return [...this.byId.entries()].map(([id, r]) => ({ id, name: r.name, aliases: [...r.aliases] }));
  }

  /**
   * `matchesIn` FOR MANY TEXTS (v12, 2026-10-03): the same hits, by the same
   * rule, without testing every term against every text. Built once over the
   * index as it stands; each text is cut into its whole words
   * (`encode/words.ts#wordTokens`), only the terms whose first word is among
   * them are tried, and every one tried is CONFIRMED by the one whole-word
   * rule — so the scanner can skip work, never add a hit or lose one
   * (`test/subjects.test.ts` holds it equal to `matchesIn`). A term with no
   * word characters at all is tried against every text. For the v12 backfill
   * and anything else that reads the whole store at once.
   */
  scanner(): (text: string) => AliasHit[] {
    type Entry = { id: string; term: string; source: "name" | "alias"; re: RegExp; order: number };
    const byFirst = new Map<string, Entry[]>();
    const always: Entry[] = [];
    let order = 0;
    for (const [id, reg] of this.byId) {
      const terms: [string, "name" | "alias"][] = [[reg.name, "name"], ...reg.aliases.map((a): [string, "alias"] => [a, "alias"])];
      for (const [term, source] of terms) {
        if (term.trim().length === 0) continue;
        const entry = { id, term, source, re: nameRegex(term), order: order++ };
        const first = firstWordKey(term);
        if (first === null) always.push(entry);
        else {
          const list = byFirst.get(first) ?? [];
          list.push(entry);
          byFirst.set(first, list);
        }
      }
    }
    return (text: string): AliasHit[] => {
      const tried = new Set<Entry>(always);
      // A possessive's token ("han's") tries the name it ends ("han") too.
      for (const token of wordsIn(text)) for (const e of byFirst.get(token) ?? []) tried.add(e);
      const hits: AliasHit[] = [];
      // In registration order, so a tie in the sort below lands as `matchesIn`'s does.
      for (const e of [...tried].sort((a, b) => a.order - b.order)) {
        if (e.re.test(text)) hits.push({ id: e.id, term: e.term, source: e.source });
      }
      return hits.sort((a, b) => a.id.localeCompare(b.id) || a.term.localeCompare(b.term));
    };
  }
}

// ---------------------------------------------------------------------------
// Collision — exact, and near
// ---------------------------------------------------------------------------

/** Tokens for the near-collision test. Hyphens and apostrophes stay INSIDE a
 *  token, for the same reason they are word characters in words.ts. */
export function nameTokens(name: string): string[] {
  return handleKey(name)
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export type CollisionKind = "none" | "exact" | "near";

/**
 * "Mike" against "Mike Chen" is a NEAR collision: one name's tokens are wholly
 * contained in the other's. The engine has no evidence that they are the same
 * thing, and silently deciding either way — a second schema, or a wrong merge —
 * is worse than declining and saying so (§14.3). CAL: see tunables.
 */
export function collision(a: string, b: string): CollisionKind {
  const ka = handleKey(a);
  const kb = handleKey(b);
  if (ka.length === 0 || kb.length === 0) return "none";
  if (ka === kb) return "exact";
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return "none";
  const sa = new Set(ta);
  const sb = new Set(tb);
  const aInB = ta.every((t) => sb.has(t));
  const bInA = tb.every((t) => sa.has(t));
  return aInB || bInA ? "near" : "none";
}
