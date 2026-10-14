export const FIT_TUNABLES = {
  LINE_BYTES: 160,
  OVERHEAD: 120,
  LOOKUP_WINDOW_MS: 12 * 60 * 60 * 1000,
  LOOKUP_GRACE_MS: 10 * 60 * 1000,
  INDEX_PREFIX: "fit.index."
};
export function fit(candidates, opts) {
  const over = opts.overhead ?? FIT_TUNABLES.OVERHEAD;
  const least = opts.least ?? "id";
  const order = candidates.map((c, i) => ({ c, i })).sort((a, b) => b.c.priority - a.c.priority || a.i - b.i).map((x) => x.c);
  const level = new Map;
  const waiting = [];
  let used = 0;
  const lineOf = (c) => c.whole.length <= c.line.length ? c.whole : c.line;
  const detail = (c) => wireChars(c.whole) <= opts.excerptChars ? { text: c.whole, fidelity: "whole" } : { text: clipWire(c.whole, opts.excerptChars), fidelity: "excerpt" };
  for (const c of order) {
    const cost = least === "line" ? over + wireChars(lineOf(c)) : over;
    if (used + cost > opts.room) {
      waiting.push(c.id);
      continue;
    }
    used += cost;
    level.set(c.id, least === "line" ? lineOf(c) === c.whole ? "whole" : "line" : "id");
  }
  if (least === "id") {
    for (const c of order) {
      if (level.get(c.id) !== "id")
        continue;
      const add = wireChars(lineOf(c));
      if (used + add > opts.room)
        continue;
      used += add;
      level.set(c.id, lineOf(c) === c.whole ? "whole" : "line");
    }
  }
  for (const c of order) {
    if (level.get(c.id) !== "line")
      continue;
    const d = detail(c);
    const add = wireChars(d.text) - wireChars(lineOf(c));
    if (add <= 0 || used + add > opts.room)
      continue;
    used += add;
    level.set(c.id, d.fidelity);
  }
  const placed = [];
  const counts = { whole: 0, excerpt: 0, line: 0, id: 0 };
  for (const c of order) {
    const f = level.get(c.id);
    if (f === undefined)
      continue;
    counts[f] += 1;
    const text = f === "id" ? "" : f === "line" ? lineOf(c) : f === "whole" ? c.whole : detail(c).text;
    placed.push({ id: c.id, fidelity: f, text, chars: c.whole.length });
  }
  return {
    placed,
    waiting,
    used,
    report: {
      candidates: candidates.length,
      whole: counts.whole,
      excerpt: counts.excerpt,
      lined: counts.line,
      ids: counts.id,
      waiting: waiting.length,
      agedOut: opts.agedOut ?? 0
    }
  };
}
export const TOOL_RESULT_CEILING = {
  HOST_CHARS: 50000,
  HOST_TOKENS: 25000,
  HOST_MESSAGE_CHARS: 200000,
  CHARS: 40000
};
export function wireChars(text) {
  let extra = 0;
  for (let i = 0;i < text.length; i += 1)
    if (text.charCodeAt(i) > 127)
      extra += 1;
  return text.length + 2 * extra;
}
export function clipWire(text, max) {
  if (wireChars(text) <= max)
    return text;
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = ch.length === 1 && ch.charCodeAt(0) <= 127 ? 1 : 3 * ch.length;
    if (used + w > max - 3)
      break;
    out += ch;
    used += w;
  }
  return `${out}…`;
}
const CHAPTER_HEADING = /^#{1,6}\s*chapter\s+\d+\b/i;
export function lineOf(src, bytes = FIT_TUNABLES.LINE_BYTES) {
  const title = (src.title ?? "").replace(/\s+/g, " ").trim();
  let line = title;
  if (line.length === 0) {
    for (const raw of src.body.split(`
`)) {
      const t = raw.trim();
      if (t.length === 0 || CHAPTER_HEADING.test(t))
        continue;
      const bare = t.replace(/^(?:#{1,6}|[-*>]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim();
      if (bare.length === 0 || /^[-=*_#>`~]+$/.test(bare))
        continue;
      line = bare;
      break;
    }
  }
  return clipBytes(line, bytes);
}
export function clipBytes(text, bytes) {
  const enc = new TextEncoder;
  if (enc.encode(text).length <= bytes)
    return text;
  let out = "";
  let size = 0;
  const room = Math.max(0, bytes - 3);
  for (const ch of text) {
    const n = enc.encode(ch).length;
    if (size + n > room)
      break;
    out += ch;
    size += n;
  }
  return `${out.trimEnd()}…`;
}
const DERIVED_KEYS = [
  ["mergedFrom", "merged-from"],
  ["sources", "gist-of"],
  ["cites", "cites"],
  ["groundedIn", "grounded-in"],
  ["revisedFrom", "revised-from"],
  ["updates", "updates"],
  ["migratedFrom", "migrated-from"],
  ["reminderFrom", "reminder-from"],
  ["episodeId", "episode"]
];
export function derivedFrom(row) {
  let meta;
  try {
    const v = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
    if (v === null || typeof v !== "object" || Array.isArray(v))
      return [];
    meta = v;
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set;
  for (const [key, how] of DERIVED_KEYS) {
    const v = meta[key];
    const ids = typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    for (const id of ids) {
      if (id.length === 0 || seen.has(`${how}:${id}`))
        continue;
      seen.add(`${how}:${id}`);
      out.push({ id, how });
    }
  }
  return out;
}
export function packParts(pieces, first, later) {
  const parts = [[]];
  let room = first;
  let used = 0;
  for (const p of pieces) {
    const current = parts[parts.length - 1];
    if (used + p.size > room && (current.length > 0 || parts.length === 1)) {
      parts.push([p]);
      room = later;
      used = p.size;
      continue;
    }
    current.push(p);
    used += p.size;
  }
  return parts;
}
export const FIT_MECHANISMS = ["dream", "reflection"];
export function indexKey(mechanism) {
  return `${FIT_TUNABLES.INDEX_PREFIX}${mechanism}`;
}
export function writeIndex(store, mechanism, index) {
  try {
    store.setMeta(indexKey(mechanism), JSON.stringify(index));
  } catch {}
}
export function readIndex(store, mechanism) {
  try {
    const raw = store.getMeta(indexKey(mechanism));
    if (raw === undefined)
      return null;
    const v = JSON.parse(raw);
    if (typeof v.ref !== "string" || typeof v.at !== "number" || v.offered === undefined)
      return null;
    const ids = (x) => Array.isArray(x) ? x.filter((y) => typeof y === "string") : [];
    const o = v.offered;
    return {
      ref: v.ref,
      at: v.at,
      offered: { whole: ids(o["whole"]), excerpt: ids(o["excerpt"]), line: ids(o["line"]), id: ids(o["id"]) },
      ...Array.isArray(v.parts) ? { parts: v.parts.map(ids) } : {},
      looked: ids(v.looked),
      counted: ids(v.counted),
      ...Array.isArray(v.fresh) ? { fresh: ids(v.fresh) } : {},
      ...v.entries !== undefined && v.entries !== null && typeof v.entries === "object" ? { entries: Object.fromEntries(Object.entries(v.entries).filter((e) => typeof e[1] === "number")) } : {},
      ...v.unread !== undefined && v.unread !== null && typeof v.unread === "object" ? { unread: Object.fromEntries(Object.entries(v.unread).map(([k, x]) => [k, Array.isArray(x) ? x.filter((n) => typeof n === "number") : []])) } : {}
    };
  } catch {
    return null;
  }
}
export function offeredOf(placed) {
  const by = (f) => placed.filter((p) => p.fidelity === f).map((p) => p.id);
  return { whole: by("whole"), excerpt: by("excerpt"), line: by("line"), id: by("id") };
}
export function offeredInPart(index) {
  return index.offered.excerpt.length + index.offered.line.length + index.offered.id.length;
}
export function noteLookups(store, delivered) {
  const out = {};
  if (delivered.length === 0)
    return out;
  let now;
  try {
    now = store.now();
  } catch {
    return out;
  }
  for (const m of FIT_MECHANISMS) {
    const index = readIndex(store, m);
    if (index === null || now - index.at > FIT_TUNABLES.LOOKUP_WINDOW_MS || !runOpen(store, m, index.ref, now))
      continue;
    const inPart = new Set([...index.offered.excerpt, ...index.offered.line, ...index.offered.id]);
    const mine = delivered.filter((d) => inPart.has(d.id));
    if (mine.length === 0)
      continue;
    const counted = new Set(index.counted ?? []);
    const fresh = [...new Set(mine.map((d) => d.id))].filter((id) => !counted.has(id));
    const whole = mine.filter((d) => d.whole).map((d) => d.id);
    if (fresh.length > 0)
      out[m] = fresh.length;
    if (fresh.length === 0 && whole.every((id) => (index.looked ?? []).includes(id)))
      continue;
    writeIndex(store, m, { ...index, counted: [...counted, ...fresh], looked: [...new Set([...index.looked ?? [], ...whole])] });
  }
  return out;
}
function runOpen(store, m, ref, now) {
  try {
    const row = m === "dream" ? store.dream(ref) : store.reflection(ref);
    if (row === undefined)
      return false;
    if (row.state === "begun")
      return true;
    if (row.state !== (m === "dream" ? "journaled" : "reflected"))
      return false;
    return row.finished_at !== null && now - row.finished_at <= FIT_TUNABLES.LOOKUP_GRACE_MS;
  } catch {
    return false;
  }
}
export function fidelityOf(index, ref, ids) {
  const out = {};
  const mine = index !== null && index.ref === ref ? index : null;
  for (const id of ids) {
    if (mine === null) {
      out[id] = "unseen";
      continue;
    }
    if ((mine.looked ?? []).includes(id) || mine.offered.whole.includes(id))
      out[id] = "whole";
    else if (mine.offered.excerpt.includes(id))
      out[id] = "excerpt";
    else if (mine.offered.line.includes(id))
      out[id] = "line";
    else if (mine.offered.id.includes(id))
      out[id] = "id";
    else
      out[id] = "unseen";
  }
  return out;
}
