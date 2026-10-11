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
   */
  matchesIn(text: string): AliasHit[] {
    const hits: AliasHit[] = [];
    for (const [id, reg] of this.byId) {
      if (occursAsName(text, reg.name)) hits.push({ id, term: reg.name, source: "name" });
      for (const alias of reg.aliases) {
        if (occursAsName(text, alias)) hits.push({ id, term: alias, source: "alias" });
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
    const byFirst = new Map<string, { id: string; term: string; source: "name" | "alias"; re: RegExp }[]>();
    const always: { id: string; term: string; source: "name" | "alias"; re: RegExp }[] = [];
    for (const [id, reg] of this.byId) {
      const terms: [string, "name" | "alias"][] = [[reg.name, "name"], ...reg.aliases.map((a): [string, "alias"] => [a, "alias"])];
      for (const [term, source] of terms) {
        if (term.trim().length === 0) continue;
        const entry = { id, term, source, re: nameRegex(term) };
        const first = wordTokens(term)[0];
        if (first === undefined) always.push(entry);
        else {
          const list = byFirst.get(first) ?? [];
          list.push(entry);
          byFirst.set(first, list);
        }
      }
    }
    return (text: string): AliasHit[] => {
      const tried = new Set<(typeof always)[number]>(always);
      // A possessive's token ("han's") tries the name it ends ("han") too.
      const tokens = new Set(wordTokens(text).flatMap((t) => [t, unpossessed(t)]));
      for (const token of tokens) for (const e of byFirst.get(token) ?? []) tried.add(e);
      const hits: AliasHit[] = [];
      for (const e of tried) if (e.re.test(text)) hits.push({ id: e.id, term: e.term, source: e.source });
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
