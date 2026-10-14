import { tokenize, cosine } from "../store/cache.js";
import { TUNABLES } from "./tunables.js";
export async function resolveUpdates(declared, ctx) {
  const floor = ctx.floor ?? TUNABLES.UPDATES_FLOOR;
  const marginBar = ctx.margin ?? TUNABLES.UPDATES_MARGIN;
  const base = {
    declared,
    floor,
    marginBar,
    hintUsed: false,
    score: null,
    margin: null
  };
  const done = (r) => {
    ctx.onEvent?.("remember.updates.resolved", {
      method: r.method,
      reason: r.reason,
      resolved: r.resolved,
      declared: r.declared,
      score: r.score,
      margin: r.margin,
      hintUsed: r.hintUsed
    });
    return r;
  };
  if (declared === null || declared.trim().length === 0) {
    return done({ ...base, resolved: null, method: "none", reason: "NO_DECLARATION" });
  }
  const hit = await ctx.resolveId(declared);
  if (typeof hit === "string" && hit.length > 0) {
    return done({ ...base, resolved: hit, method: "declared", reason: "DECLARED_RESOLVED" });
  }
  if (ctx.removed !== undefined && await ctx.removed(declared)) {
    return done({ ...base, resolved: null, method: "none", reason: "DECLARED_REMOVED" });
  }
  const limit = ctx.limit ?? TUNABLES.UPDATES_CANDIDATES;
  const candidates = await ctx.candidates({ scope: ctx.scope, content: ctx.content, limit });
  if (candidates.length === 0) {
    return done({ ...base, resolved: null, method: "content", reason: "NO_CANDIDATES" });
  }
  const scored = candidates.map((c) => ({ candidate: c, score: similarity(ctx.content, c.text) })).sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  const best = scored[0];
  if (best === undefined) {
    return done({ ...base, resolved: null, method: "content", reason: "NO_CANDIDATES" });
  }
  const runnerUp = scored[1]?.score ?? 0;
  const margin = best.score - runnerUp;
  const withScores = { ...base, score: round(best.score), margin: round(margin) };
  if (best.score < floor) {
    return done({ ...withScores, resolved: null, method: "content", reason: "BELOW_FLOOR" });
  }
  if (margin < marginBar) {
    const tied = scored.filter((s) => s.score >= floor && best.score - s.score < marginBar);
    const hinted = tied.filter((s) => mentions(s.candidate, declared));
    const only = hinted.length === 1 ? hinted[0] : undefined;
    if (only !== undefined) {
      return done({
        ...withScores,
        resolved: only.candidate.id,
        method: "content+hint",
        reason: "MATCHED",
        hintUsed: true,
        score: round(only.score)
      });
    }
    return done({ ...withScores, resolved: null, method: "content", reason: "AMBIGUOUS" });
  }
  return done({ ...withScores, resolved: best.candidate.id, method: "content", reason: "MATCHED" });
}
function mentions(candidate, declared) {
  if (candidate.id === declared)
    return true;
  if ((candidate.aliases ?? []).some((a) => a === declared))
    return true;
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(declared)}([^A-Za-z0-9_]|$)`).test(candidate.text);
}
export function similarity(a, b) {
  const va = counts(a);
  const vb = counts(b);
  const vocab = [...new Set([...va.keys(), ...vb.keys()])];
  if (vocab.length === 0)
    return 0;
  return cosine(vocab.map((t) => va.get(t) ?? 0), vocab.map((t) => vb.get(t) ?? 0));
}
function counts(text) {
  const m = new Map;
  for (const t of tokenize(text))
    m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}
function round(n) {
  return Math.round(n * 1000) / 1000;
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
