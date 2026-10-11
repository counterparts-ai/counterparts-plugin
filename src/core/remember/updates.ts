/**
 * `updates:` resolution — the one rule that decides whether an author's declared
 * address is honored (contract §5 G10, scar §2.5).
 *
 * **No model-supplied identifier is trusted as an address without a fallback.** The
 * author declares `updates: <id>`; the engine validates that the id RESOLVES, and on
 * a miss falls back to content matching, where:
 *
 *   - a score floor AND a margin are both required;
 *   - ambiguity REFUSES (v1's confabulation incident: 7 of 8 rejected ids existed in
 *     the schema, in a different section, in the identical `- [id]` format — a
 *     plausible-looking id is exactly the input this rule exists to survive);
 *   - the author's hint is a tiebreak INSIDE the margin and can never defeat a
 *     refusal — it cannot rescue a below-floor set;
 *   - score, margin and method are logged as provenance.
 *
 * A refusal costs nothing durable: the memory still lands, unlinked. That is also
 * why the two thresholds ship enabled while still marked CAL (tunables.ts) — being
 * wrong here produces a missing link, not a wrong write.
 */
import { tokenize, cosine } from "../store/cache.js";
import { TUNABLES } from "./tunables.js";

export interface Candidate {
  id: string;
  /** The text content matching scores against. */
  text: string;
  /** Optional aliases/handles; matched as a whole string, never as a substring. */
  aliases?: readonly string[];
}

/** INJECTED (INTERFACE-GAPS.md #4): who the candidates are is `store/`+`schemas/`
 *  business, and this module refuses to know about either. */
export type CandidateSource = (
  query: { scope: string; content: string; limit: number },
) => readonly Candidate[] | Promise<readonly Candidate[]>;

/** INJECTED: does this id resolve to a live memory? Returns the resolved (possibly
 *  forwarded) id, or null. `store.resolve()` is the obvious implementation. */
export type IdResolver = (id: string) => string | null | Promise<string | null>;

export type UpdatesMethod = "declared" | "content" | "content+hint" | "none";

export type UpdatesReason =
  | "NO_DECLARATION"
  | "DECLARED_RESOLVED"
  | "NO_CANDIDATES"
  | "BELOW_FLOOR"
  | "AMBIGUOUS"
  | "MATCHED";

export interface UpdatesResolution {
  /** The memory this proposal revises, or null. Null is not a failure (§5 G10). */
  resolved: string | null;
  method: UpdatesMethod;
  reason: UpdatesReason;
  /** Best candidate's score, when content matching ran. */
  score: number | null;
  /** Best minus runner-up, when content matching ran. */
  margin: number | null;
  declared: string | null;
  /** True only when the hint broke a tie INSIDE the margin. */
  hintUsed: boolean;
  floor: number;
  marginBar: number;
}

export interface UpdatesContext {
  scope: string;
  content: string;
  resolveId: IdResolver;
  candidates: CandidateSource;
  floor?: number;
  margin?: number;
  limit?: number;
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}

export async function resolveUpdates(
  declared: string | null,
  ctx: UpdatesContext,
): Promise<UpdatesResolution> {
  const floor = ctx.floor ?? TUNABLES.UPDATES_FLOOR;
  const marginBar = ctx.margin ?? TUNABLES.UPDATES_MARGIN;
  const base = {
    declared,
    floor,
    marginBar,
    hintUsed: false,
    score: null as number | null,
    margin: null as number | null,
  };
  const done = (r: UpdatesResolution): UpdatesResolution => {
    ctx.onEvent?.("remember.updates.resolved", {
      method: r.method,
      reason: r.reason,
      resolved: r.resolved,
      declared: r.declared,
      score: r.score,
      margin: r.margin,
      hintUsed: r.hintUsed,
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

  const limit = ctx.limit ?? TUNABLES.UPDATES_CANDIDATES;
  const candidates = await ctx.candidates({ scope: ctx.scope, content: ctx.content, limit });
  if (candidates.length === 0) {
    return done({ ...base, resolved: null, method: "content", reason: "NO_CANDIDATES" });
  }

  const scored = candidates
    .map((c) => ({ candidate: c, score: similarity(ctx.content, c.text) }))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));

  const best = scored[0];
  if (best === undefined) {
    return done({ ...base, resolved: null, method: "content", reason: "NO_CANDIDATES" });
  }
  const runnerUp = scored[1]?.score ?? 0;
  const margin = best.score - runnerUp;
  const withScores = { ...base, score: round(best.score), margin: round(margin) };

  if (best.score < floor) {
    // The hint is powerless here, by design. A declared id that points at nothing
    // must not be able to attach a memory to a weak match.
    return done({ ...withScores, resolved: null, method: "content", reason: "BELOW_FLOOR" });
  }

  if (margin < marginBar) {
    // Inside the margin: the hint may break the tie, but only among candidates that
    // ALREADY clear the floor.
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
        score: round(only.score),
      });
    }
    return done({ ...withScores, resolved: null, method: "content", reason: "AMBIGUOUS" });
  }

  return done({ ...withScores, resolved: best.candidate.id, method: "content", reason: "MATCHED" });
}

/** The hint's reach: the candidate IS the declared id, or names it in its text or
 *  aliases. Whole-value matching only — one definition, no substrings (encode §3). */
function mentions(candidate: Candidate, declared: string): boolean {
  if (candidate.id === declared) return true;
  if ((candidate.aliases ?? []).some((a) => a === declared)) return true;
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(declared)}([^A-Za-z0-9_]|$)`).test(candidate.text);
}

/**
 * Content similarity: cosine over token frequency vectors, using the store's one
 * tokenizer so "the same cue scores the same everywhere". Deterministic, no
 * embedder required — the semantic channel is `encode/`'s business, and this rule
 * must work when no embedder exists at all.
 */
export function similarity(a: string, b: string): number {
  const va = counts(a);
  const vb = counts(b);
  const vocab = [...new Set([...va.keys(), ...vb.keys()])];
  if (vocab.length === 0) return 0;
  return cosine(
    vocab.map((t) => va.get(t) ?? 0),
    vocab.map((t) => vb.get(t) ?? 0),
  );
}

function counts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokenize(text)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
