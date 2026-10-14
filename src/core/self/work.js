import { belowReach, strength } from "../physics/index.js";
import { datePrefix, flatten } from "./briefing.js";
const UNMARKED_WORK_IN_A_DIRECTORY = new Set(["fact", "entity", "place"]);
export function isDirectoryScope(scope) {
  if (scope === null)
    return false;
  const s = scope.trim();
  return s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s);
}
export function isWorkMemory(m) {
  if (m.journal)
    return false;
  if (m.about === "work")
    return true;
  if (m.about !== null)
    return false;
  if (m.kind === "skill")
    return true;
  return UNMARKED_WORK_IN_A_DIRECTORY.has(m.kind) && isDirectoryScope(m.originScope);
}
export const WORK_HERE_HEADING = "Work here, if it helps:";
export const WORK_OVERFLOW_EVENT = "self.work.overflow";
function scopesFor(scope) {
  const trimmed = scope.trim();
  const bare = trimmed.replace(/\/+$/, "");
  return bare.length > 0 && bare !== trimmed ? [trimmed, bare] : [trimmed];
}
export function excerptOf(text, n) {
  const flat = flatten(text);
  if (flat.length <= n)
    return flat;
  const head = flat.slice(0, Math.max(1, n));
  const space = head.lastIndexOf(" ");
  return `${(space > n / 2 ? head.slice(0, space) : head).replace(/[\s,;:.—-]+$/, "")}…`;
}
export const WORK_HERE_READ_PER_LINE = 5;
export function workHere(store, scope, opts) {
  const pool = Math.max(opts.max, opts.pool ?? opts.max);
  if (opts.max <= 0 || scope.trim().length === 0)
    return [];
  const seen = new Set;
  const found = [];
  for (const where of scopesFor(scope)) {
    for (const id of store.workCandidates(where, pool * WORK_HERE_READ_PER_LINE)) {
      if (seen.has(id) || opts.skip?.has(id) === true)
        continue;
      seen.add(id);
      const row = store.row(id);
      if (row === undefined || row.band === "identity" || row.event_date !== null || row.confidential === 1)
        continue;
      let doc;
      let physics;
      try {
        doc = store.readProse(id);
        physics = store.physicsOf(id);
      } catch {
        continue;
      }
      if (doc.meta["unresolved"] === true)
        continue;
      if (belowReach(physics, opts.day))
        continue;
      const journal = typeof doc.meta["episodeId"] === "string";
      if (!isWorkMemory({ about: row.about ?? null, kind: row.kind, originScope: row.origin_scope, journal }))
        continue;
      if (flatten(doc.body).length === 0)
        continue;
      found.push({
        id,
        touched: Math.max(doc.bornDay, physics.lastUsedDay),
        strength: strength(physics, opts.day),
        doc,
        bounded: row.source === "migrated"
      });
    }
  }
  found.sort((a, b) => b.touched - a.touched || b.strength - a.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return found.slice(0, pool).map((c) => workLine(c.id, c.doc, opts.excerpt, c.bounded));
}
export function rotateWork(lines, max, day) {
  if (max <= 0)
    return [];
  if (lines.length <= max)
    return [...lines];
  const [first, ...rest] = lines;
  const k = max - 1;
  if (first === undefined || k === 0)
    return first === undefined ? [] : [first];
  const offset = (Math.floor(day) * k % rest.length + rest.length) % rest.length;
  const picked = new Set;
  for (let i = 0;i < k; i++)
    picked.add((offset + i) % rest.length);
  return [first, ...rest.filter((_, i) => picked.has(i))];
}
export function workLine(id, doc, excerpt, bounded = false) {
  const paragraph = doc.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? doc.body;
  const title = flatten(doc.title ?? "");
  const date = datePrefix({
    statement: "",
    learnedOn: doc.learnedOn,
    ...doc.happenedOn === undefined ? {} : { happenedOn: doc.happenedOn },
    boundedDate: bounded
  });
  const words = title.length === 0 ? excerptOf(paragraph, excerpt + 40) : `${title} — ${excerptOf(paragraph, excerpt)}`;
  return `- ${date}${words} (${id})`;
}
export function workHereBlock(lines) {
  return [WORK_HERE_HEADING, ...lines].join(`
`);
}
export function workHereBytes(lines) {
  return new TextEncoder().encode(`${workHereBlock(lines)}

`).length;
}
