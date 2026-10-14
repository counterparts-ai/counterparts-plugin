import { homedir } from "node:os";
import { sessionsHere } from "../../core/coverage/index.js";
import { wireChars } from "../../core/fit/index.js";
import { handoffAuthorship, sessionWords } from "../../core/handoff/index.js";
import { belowReach, strength } from "../../core/physics/index.js";
import { isConfidential, isSelfPage, standingOf } from "../../core/recall/index.js";
import { parseChapterAddress, resolveChapter } from "../../core/self/chapter-address.js";
import { localStamp } from "../../core/time.js";
import { UNBOUND_SESSION } from "../../core/types.js";
export const RECALL_EXCERPT_CHARS = 300;
export const RECALL_BODY_CHARS = 8000;
export const RECALL_RESULT_CHARS = 12000;
export const RECALL_ID_RESULT_CHARS = 56000;
export const RECALL_MAX_IDS = 10;
export function boundById(memories, part = 1, pageChars = RECALL_BODY_CHARS, totalChars = RECALL_ID_RESULT_CHARS) {
  const out = [];
  const waiting = [];
  let chars = 0;
  let truncated = false;
  const p = Number.isInteger(part) && part >= 1 ? part : 1;
  let wire = 0;
  for (const m of memories) {
    const parts = Math.max(1, Math.ceil(m.body.length / pageChars));
    const excerpt = p > parts ? "" : m.body.slice((p - 1) * pageChars, p * pageChars);
    const item = {
      id: m.id,
      kind: m.kind,
      title: m.title,
      journal: m.journal,
      excerpt,
      bodyChars: m.body.length,
      truncated: parts > 1,
      part: p,
      parts,
      ...m.standing === undefined ? {} : { standing: m.standing },
      ...m.from === undefined ? {} : { from: m.from },
      ...m.address === undefined ? {} : { address: m.address },
      ...m.moments === undefined ? {} : { moments: [...m.moments] }
    };
    const cost = 2 * wireChars(JSON.stringify(item, null, 2));
    if (waiting.length > 0 || out.length > 0 && wire + cost > totalChars) {
      waiting.push(m.id);
      continue;
    }
    if (parts > 1)
      truncated = true;
    chars += excerpt.length;
    wire += cost;
    out.push(item);
  }
  return { memories: out, truncated, droppedForBudget: 0, chars, ...waiting.length > 0 ? { waiting } : {} };
}
export function hasFaded(p, day) {
  return belowReach(p, day);
}
export function cutExcerpt(body, limit) {
  if (body.length <= limit)
    return body;
  const hard = body.slice(0, Math.max(0, limit - 1));
  const space = hard.lastIndexOf(" ");
  return `${space > limit * 0.6 ? hard.slice(0, space) : hard}…`;
}
export const JOURNAL_GLOSS = "A row marked journal: true is a chapter — the first-person account a memory was made from, not a memory. It is outside decay, dedup and the prune, and it is not a claim about the world the way a memory is.";
export async function embedQuestion(embedder, question) {
  if (embedder === null)
    return { vector: null, semantic: "embedder-off" };
  try {
    const vector = await embedder.vector(question);
    return vector === null || vector.length === 0 ? { vector: null, semantic: "embed-failed" } : { vector, semantic: "in-line" };
  } catch {
    return { vector: null, semantic: "embed-failed" };
  }
}
const EMPTY = {
  semantic: "none",
  memories: [],
  considered: 0,
  storeSize: 0,
  ambiguous: []
};
function liveCount(counterpart) {
  try {
    return counterpart.store.list({ archived: false }).length;
  } catch {
    return 0;
  }
}
export function deliberateRecall(counterpart, input, opts) {
  const hasHandle = typeof input.handle === "string" && input.handle.trim().length > 0;
  const hasQuestion = typeof input.question === "string" && input.question.trim().length > 0;
  const askedIds = (input.ids ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
  const hasIds = askedIds.length > 0;
  if ([hasHandle, hasQuestion, hasIds].filter(Boolean).length > 1) {
    return { path: "none", reason: "both-arguments", ...EMPTY, storeSize: liveCount(counterpart) };
  }
  if (hasHandle)
    return expandHandle(counterpart, input.handle.trim(), opts);
  if (hasIds)
    return expandIds(counterpart, askedIds, opts);
  if (hasQuestion)
    return { path: "none", reason: "question-needs-mode", ...EMPTY, storeSize: liveCount(counterpart) };
  return { path: "none", reason: "no-argument", ...EMPTY, storeSize: liveCount(counterpart) };
}
export function expandHandle(counterpart, handle, opts) {
  const store = counterpart.store;
  const storeSize = store.list({ archived: false }).length;
  const base = {
    path: "handle",
    semantic: "none",
    storeSize,
    ambiguous: []
  };
  if (parseChapterAddress(handle) !== null)
    return expandChapter(counterpart, handle.trim(), opts, base);
  const matches = [];
  const own = (() => {
    try {
      return store.row(handle);
    } catch {
      return;
    }
  })();
  if (own !== undefined && own.superseded_by !== null && !(own.body === "" && own.content_hash === "")) {
    matches.push(own.id);
  }
  try {
    if (matches.length === 0)
      matches.push(store.resolve(handle));
  } catch {}
  if (matches.length === 0) {
    const wanted = handle.toLowerCase();
    for (const id of store.list({ archived: false })) {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null)
        continue;
      let title = null;
      try {
        title = store.readProse(id).title ?? null;
      } catch {
        continue;
      }
      if (title !== null && title.trim().toLowerCase() === wanted)
        matches.push(id);
    }
  }
  if (matches.length === 0) {
    return { ...base, reason: "handle-unknown", memories: [], considered: 0 };
  }
  if (matches.length > 1) {
    return {
      ...base,
      reason: "handle-ambiguous",
      memories: [],
      considered: matches.length,
      ambiguous: matches
    };
  }
  const id = matches[0];
  const read = store.read(id);
  if (isSelfPage(read.doc)) {
    return { ...base, reason: "handle-unknown", memories: [], considered: 0 };
  }
  if (!opts.owner && isConfidential(read.doc)) {
    return { ...base, reason: "handle-confidential-withheld", memories: [], considered: 1 };
  }
  return {
    ...base,
    reason: "expanded",
    considered: 1,
    memories: [
      {
        id,
        kind: read.physics.kind,
        title: read.doc.title ?? null,
        journal: read.doc.type === "episode",
        body: read.doc.body,
        strength: strength(read.physics, store.livedDay()),
        ...standingField(store, id, true),
        ...fromField(store, id, opts.sessionId, counterpart.spans)
      }
    ]
  };
}
function expandChapter(counterpart, address, opts, base) {
  const store = counterpart.store;
  const got = resolveChapter(store, address);
  if (!got.ok)
    return { ...base, reason: "handle-unknown", memories: [], considered: 0 };
  const c = got.chapter;
  let read;
  try {
    read = store.read(c.episodeId);
  } catch {
    return { ...base, reason: "handle-unknown", memories: [], considered: 0 };
  }
  if (!opts.owner && isConfidential(read.doc)) {
    return { ...base, reason: "handle-confidential-withheld", memories: [], considered: 1 };
  }
  const shown = !opts.owner ? c.moments.filter((id) => {
    try {
      return !isConfidential(store.read(id).doc);
    } catch {
      return false;
    }
  }) : c.moments;
  return {
    ...base,
    reason: "expanded",
    considered: 1,
    memories: [
      {
        id: c.episodeId,
        kind: read.physics.kind,
        title: `${c.title ?? "journal"} — chapter ${String(c.chapter)} of ${String(c.of)}`,
        journal: true,
        body: c.heading === null ? c.text.trim() : `${c.heading}

${c.text.trim()}`,
        strength: strength(read.physics, store.livedDay()),
        address: c.address,
        moments: [...shown],
        ...fromField(store, c.episodeId, opts.sessionId, counterpart.spans)
      }
    ]
  };
}
export function provenanceOf(store, id, reader = null, spans) {
  const parts = provenanceParts(store, id, reader, spans);
  if (parts === null)
    return null;
  return [parts.who, parts.where, parts.when].filter((p) => p !== null && p.length > 0).join(", ");
}
export function provenanceParts(store, id, reader = null, spans) {
  try {
    const row = store.row(id);
    if (row === undefined)
      return null;
    let session = row.origin_session;
    if ((session === null || session.length === 0) && row.type === "episode") {
      const meta = JSON.parse(row.meta || "{}");
      session = typeof meta["sessionId"] === "string" ? meta["sessionId"] : null;
    }
    const handoff = row.type === "schema" ? handoffAuthorship(store, id) : null;
    if (handoff !== null)
      session = handoff.session;
    const placed = session === UNBOUND_SESSION && spans !== undefined ? placedByTime(spans, row) : null;
    const named = placed !== null ? `${sessionWords(placed, null, reader)} (placed by when it was written)` : session === null || session.length === 0 ? null : sessionWords(session, null, reader);
    const made = nightlyMade(row);
    const who = made === "dream" ? named === null ? "a dream" : `a dream launched from ${named}` : made === "reflection" ? "a reflection" : row.source === "migrated" ? "carried over from an older store" : named ?? "an earlier session";
    const home = homedir();
    const scope = handoff?.scope ?? row.origin_scope;
    const where = scope === null || scope.length === 0 ? null : home.length > 1 && (scope === home || scope.startsWith(`${home}/`)) ? `~${scope.slice(home.length)}` : scope;
    const at = handoff !== null ? handoff.at : row.type === "episode" ? row.updated_at ?? row.created_at : row.created_at;
    const learned = handoff?.on ?? (row.learned_on.length > 0 ? row.learned_on : null);
    const when = at === null ? learned : localStamp(at, store.zone());
    return { who, where, when };
  } catch {
    return null;
  }
}
function placedByTime(spans, row) {
  const scope = row.origin_scope;
  const at = row.created_at;
  if (scope === null || scope.length === 0 || at === null)
    return null;
  const covering = sessionsHere(spans, scope).filter((s) => at >= s.firstAt && at <= s.lastAt);
  return covering.length === 1 ? covering[0]?.session ?? null : null;
}
export function nightlyMade(row) {
  const ref = row.origin_ref ?? "";
  if (row.source === "dreamed" || ref.startsWith("dream:"))
    return "dream";
  if (row.source === "reflection" || ref.startsWith("reflection:"))
    return "reflection";
  return null;
}
function fromField(store, id, reader, spans) {
  const from = provenanceOf(store, id, reader, spans);
  return from === null ? {} : { from };
}
function standingField(store, id, byId) {
  try {
    const s = standingOf(store, id, { byId });
    return s === null ? {} : { standing: s.note };
  } catch {
    return {};
  }
}
export function expandIds(counterpart, ids, opts) {
  const unique = [...new Set(ids)];
  const storeSize = counterpart.store.list({ archived: false }).length;
  const base = { path: "handle", semantic: "none", storeSize };
  if (unique.length > RECALL_MAX_IDS) {
    return {
      ...base,
      reason: "ids-too-many",
      memories: [],
      considered: unique.length,
      ambiguous: [],
      perId: unique.map((id) => ({ id, reason: "ids-too-many" }))
    };
  }
  const memories = [];
  const ambiguous = [];
  const perId = [];
  for (const id of unique) {
    const one = expandHandle(counterpart, id, opts);
    perId.push({ id, reason: one.reason });
    memories.push(...one.memories);
    ambiguous.push(...one.ambiguous);
  }
  return {
    ...base,
    reason: memories.length > 0 ? "expanded" : perId[0]?.reason ?? "handle-unknown",
    memories,
    considered: unique.length,
    ambiguous,
    perId
  };
}
