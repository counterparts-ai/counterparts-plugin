import { nameRegex, occursAsName, unpossessed, wordTokens } from "../encode/words.js";
export function handleKey(term) {
  return term.trim().toLowerCase();
}

export class AliasIndex {
  byKey = new Map;
  byId = new Map;
  register(id, name, aliases = []) {
    this.unregister(id);
    const terms = { name, aliases: [...aliases] };
    this.byId.set(id, terms);
    for (const term of [name, ...terms.aliases]) {
      const key = handleKey(term);
      if (key.length === 0)
        continue;
      const set = this.byKey.get(key) ?? new Set;
      set.add(id);
      this.byKey.set(key, set);
    }
  }
  unregister(id) {
    const prior = this.byId.get(id);
    if (prior === undefined)
      return;
    for (const term of [prior.name, ...prior.aliases]) {
      const key = handleKey(term);
      const set = this.byKey.get(key);
      if (set === undefined)
        continue;
      set.delete(id);
      if (set.size === 0)
        this.byKey.delete(key);
    }
    this.byId.delete(id);
  }
  has(id) {
    return this.byId.has(id);
  }
  termsFor(id) {
    const r = this.byId.get(id);
    return r === undefined ? undefined : { name: r.name, aliases: [...r.aliases] };
  }
  lookup(term) {
    return [...this.byKey.get(handleKey(term)) ?? []].sort();
  }
  ambiguous() {
    return [...this.byKey.entries()].filter(([, ids]) => ids.size > 1).map(([key]) => key).sort();
  }
  map() {
    const out = new Map;
    for (const [key, ids] of this.byKey)
      out.set(key, [...ids].sort());
    return out;
  }
  matchesIn(text) {
    const hits = [];
    for (const [id, reg] of this.byId) {
      if (occursAsName(text, reg.name))
        hits.push({ id, term: reg.name, source: "name" });
      for (const alias of reg.aliases) {
        if (occursAsName(text, alias))
          hits.push({ id, term: alias, source: "alias" });
      }
    }
    return hits.sort((a, b) => a.id.localeCompare(b.id) || a.term.localeCompare(b.term));
  }
  size() {
    return this.byId.size;
  }
  entries() {
    return [...this.byId.entries()].map(([id, r]) => ({ id, name: r.name, aliases: [...r.aliases] }));
  }
  scanner() {
    const byFirst = new Map;
    const always = [];
    for (const [id, reg] of this.byId) {
      const terms = [[reg.name, "name"], ...reg.aliases.map((a) => [a, "alias"])];
      for (const [term, source] of terms) {
        if (term.trim().length === 0)
          continue;
        const entry = { id, term, source, re: nameRegex(term) };
        const first = wordTokens(term)[0];
        if (first === undefined)
          always.push(entry);
        else {
          const list = byFirst.get(first) ?? [];
          list.push(entry);
          byFirst.set(first, list);
        }
      }
    }
    return (text) => {
      const tried = new Set(always);
      const tokens = new Set(wordTokens(text).flatMap((t) => [t, unpossessed(t)]));
      for (const token of tokens)
        for (const e of byFirst.get(token) ?? [])
          tried.add(e);
      const hits = [];
      for (const e of tried)
        if (e.re.test(text))
          hits.push({ id: e.id, term: e.term, source: e.source });
      return hits.sort((a, b) => a.id.localeCompare(b.id) || a.term.localeCompare(b.term));
    };
  }
}
export function nameTokens(name) {
  return handleKey(name).replace(/[^\p{L}\p{N}'’-]+/gu, " ").trim().split(/\s+/).filter((t) => t.length > 0);
}
export function collision(a, b) {
  const ka = handleKey(a);
  const kb = handleKey(b);
  if (ka.length === 0 || kb.length === 0)
    return "none";
  if (ka === kb)
    return "exact";
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0)
    return "none";
  const sa = new Set(ta);
  const sb = new Set(tb);
  const aInB = ta.every((t) => sb.has(t));
  const bInA = tb.every((t) => sa.has(t));
  return aInB || bInA ? "near" : "none";
}
