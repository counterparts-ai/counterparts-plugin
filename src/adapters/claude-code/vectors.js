import { EMBED_BACKFILL_EVENT, SEMANTIC_LAG_EVENT } from "../../core/counterpart.js";
import { stripBoilerplate } from "../../core/recall/index.js";
import { EMBED_FAILED_PREFIX, indexTextOf } from "../../core/store/index.js";
export const LAG_PROMPT_BYTES = 2000;
export const LAG_REPLY_BYTES = 800;
export const BACKFILL_LIMIT = 64;
export const STATIC_BACKFILL_LIMIT = 1000;
function isStatic(embedder) {
  return embedder?.kind === "static";
}
function vectorsWithdrawn(counterpart) {
  const kind = counterpart.store.embedderVerdict.kind;
  return kind === "held" || kind === "cache-ahead" ? kind : null;
}
export async function laggedSemantic(input) {
  const { counterpart, sessionId, scope } = input;
  const emit = input.onEvent ?? (() => {});
  const note = (reason, vector, bytes, detail = {}) => {
    const out = counterpart.noteSessionSemantic({
      sessionId,
      reason,
      vector,
      model: input.embedder?.model ?? null
    });
    emit("vectors.lag", { reason: out.reason, hits: out.hits, stored: out.stored, bytes, ...detail });
    if (!counterpart.observer) {
      counterpart.noteAdapterEvent(SEMANTIC_LAG_EVENT, {
        session: sessionId,
        reason: out.reason,
        hits: out.hits,
        stored: out.stored,
        turn: out.turn,
        bytes,
        ...detail
      });
    }
    return { reason: out.reason, stored: out.stored, hits: out.hits, bytes };
  };
  if (input.embedder === null)
    return note("embedder-off", null, 0);
  if (input.embedder.unavailable !== undefined) {
    return note("embed-failed", null, 0, { unavailable: input.embedder.unavailable });
  }
  const withdrawn = vectorsWithdrawn(counterpart);
  if (withdrawn !== null)
    return note("embed-failed", null, 0, { withdrawn });
  const text = lagText(counterpart, sessionId, scope);
  if (text.length === 0)
    return note("no-text", null, 0);
  let vector = null;
  try {
    vector = await input.embedder.vector(text);
  } catch {
    vector = null;
  }
  return note(vector === null ? "embed-failed" : "ok", vector, text.length);
}
export function lagText(counterpart, sessionId, scope) {
  const mine = (kind) => {
    const spans = counterpart.spans.spans(scope);
    for (let i = spans.length - 1;i >= 0; i -= 1) {
      const s = spans[i];
      if (s !== undefined && s.session === sessionId && s.kind === kind)
        return s.text;
    }
    return null;
  };
  const prompt = clip(strip(mine("conversation")), LAG_PROMPT_BYTES);
  const replies = counterpart.spans.assistantSpans(scope).filter((s) => s.session === sessionId);
  const reply = clip(strip(replies.at(-1)?.text ?? null), LAG_REPLY_BYTES);
  return [prompt, reply].filter((s) => s.length > 0).join(`

`);
}
function strip(text) {
  if (text === null)
    return "";
  return stripBoilerplate(text).text.trim();
}
function clip(text, bytes) {
  return text.length <= bytes ? text : text.slice(0, bytes);
}
export async function backfillVectors(input) {
  const { counterpart } = input;
  const emit = input.onEvent ?? (() => {});
  const limit = input.limit ?? (isStatic(input.embedder) ? STATIC_BACKFILL_LIMIT : BACKFILL_LIMIT);
  const store = counterpart.store;
  const done = (reason, embedded, failed, attempted, codes = "") => {
    const remaining = store.unembeddedCount();
    let skipped = 0;
    try {
      skipped = store.skippedVectorIds().length;
    } catch {}
    const report = {
      embedded,
      failed,
      remaining,
      attempted,
      reason,
      codes,
      skipped,
      kind: input.embedder?.kind ?? null,
      weights: input.embedder?.weights ?? null,
      model: input.embedder === null || input.embedder.unavailable !== undefined ? null : input.embedder.model
    };
    emit("vectors.backfill", { ...report });
    if (!counterpart.observer) {
      counterpart.noteAdapterEvent(EMBED_BACKFILL_EVENT, { ...report });
    }
    return report;
  };
  if (counterpart.observer)
    return done("observer", 0, 0, 0);
  if (input.embedder === null)
    return done("embedder-off", 0, 0, 0);
  if (input.embedder.unavailable !== undefined) {
    return done("embedder-unavailable", 0, 0, 0, input.embedder.unavailable);
  }
  const withdrawn = vectorsWithdrawn(counterpart);
  if (withdrawn !== null)
    return done("vectors-withdrawn", 0, 0, 0, withdrawn);
  const ids = store.missingVectors(limit);
  if (ids.length === 0)
    return done("nothing-missing", 0, 0, 0);
  const texts = [];
  const wanted = [];
  for (const id of ids) {
    let doc;
    try {
      doc = store.readProse(id);
    } catch {
      continue;
    }
    texts.push(indexTextOf(doc.title, doc.body));
    wanted.push(id);
  }
  if (wanted.length === 0)
    return done("nothing-missing", 0, 0, 0);
  try {
    await input.embedder.warm(texts);
  } catch {}
  const codes = codesOf(input.embedder);
  const itemBlamed = itemAttributable(input.embedder) || isStatic(input.embedder);
  let counters;
  try {
    counters = store.metaWithPrefix(EMBED_FAILED_PREFIX);
  } catch {
    counters = new Map;
  }
  let embedded = 0;
  let failed = 0;
  const moves = [];
  const refusals = new Set;
  for (const id of wanted) {
    let landed = false;
    let refused;
    try {
      const got = store.embedOne(id);
      landed = got.vector;
      refused = got.refused;
    } catch {
      landed = false;
    }
    if (landed)
      embedded += 1;
    else
      failed += 1;
    if (refused !== undefined)
      refusals.add(`refused:${refused}`);
    const key = `${EMBED_FAILED_PREFIX}${id}`;
    const now = Number(counters.get(key) ?? "0");
    if (landed) {
      if (now !== 0)
        moves.push([key, "0"]);
    } else if (itemBlamed && refused === undefined) {
      moves.push([key, String(now + 1)]);
    }
  }
  writeCounters(counterpart, store, moves, emit);
  const named = [codes, ...refusals].filter((c) => c.length > 0).join(",");
  return done("ran", embedded, failed, wanted.length, named);
}
function itemAttributable(embedder) {
  try {
    return embedder.stats().lastFailures.some((f) => f.item === true);
  } catch {
    return false;
  }
}
function codesOf(embedder) {
  try {
    const seen = new Set;
    for (const f of embedder.stats().lastFailures) {
      seen.add(f.status === undefined ? f.code : `${f.code}:${String(f.status)}`);
    }
    return [...seen].join(",");
  } catch {
    return "";
  }
}
function writeCounters(counterpart, store, moves, emit) {
  if (counterpart.observer || moves.length === 0)
    return;
  try {
    store.setMetaMany(moves);
  } catch (err) {
    emit("vectors.backfill.count.failed", { code: err instanceof Error ? err.name : "UNKNOWN" });
  }
}
