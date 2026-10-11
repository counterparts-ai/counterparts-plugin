/**
 * The content floor — the named earned mechanism (§3, earned-mechanism #3).
 *
 * v1's model bake-off minted a literal `"placeholder"` trace that passed every
 * other gate. A degenerate-but-well-formed proposal is not a memory (scar §2.14),
 * and the four checks above this one all pass it happily, because none of them
 * asks whether there is anything there.
 *
 * The floor evaluates the FINAL content — after redaction and after hedging — so
 * that a proposal which is nothing but a redacted credential fails here as well
 * as at the secrets gate, and both reasons are reported. Redaction placeholders
 * are stripped before measuring: `[REDACTED:google-api-key]` is 26 characters of
 * nothing.
 *
 * The stub list is matched EXACTLY after normalization, never as a substring, so
 * "keeps a TODO list in vim" survives while a bare "TODO" does not.
 *
 * §5 G12: the exact minimums and the stub vocabulary are preferences (TUNABLES).
 * That the floor EXISTS is mechanized.
 */

import { stripRedactions } from "./secrets.js";
import { TUNABLES } from "./tunables.js";
import { normalizeForFloor } from "./words.js";
import type { RefusalReason } from "./types.js";

export type FloorReason =
  | "above-floor"
  | "content-empty"
  | "content-stub"
  | "content-too-short"
  | "content-too-few-words";

export interface FloorResult {
  ok: boolean;
  /** The first blocking reason, or "above-floor". */
  reason: FloorReason;
  /** Every blocking reason — the same shape physics' verdicts use. */
  blockedBy: Exclude<FloorReason, "above-floor">[];
  chars: number;
  words: number;
  minChars: number;
  minWords: number;
}

const STUBS = new Set(TUNABLES.STUB_TOKENS.map((s) => normalizeForFloor(s)));

export function contentFloor(content: string): FloorResult {
  const real = stripRedactions(content).trim();
  const normalized = normalizeForFloor(real);
  const chars = normalized.length;
  const words = chars === 0 ? 0 : normalized.split(" ").length;
  const blockedBy: Exclude<FloorReason, "above-floor">[] = [];

  if (chars === 0) blockedBy.push("content-empty");
  else {
    if (STUBS.has(normalized)) blockedBy.push("content-stub");
    if (chars < TUNABLES.FLOOR_MIN_CHARS) blockedBy.push("content-too-short");
    if (words < TUNABLES.FLOOR_MIN_WORDS) blockedBy.push("content-too-few-words");
  }

  return {
    ok: blockedBy.length === 0,
    reason: blockedBy[0] ?? "above-floor",
    blockedBy,
    chars,
    words,
    minChars: TUNABLES.FLOOR_MIN_CHARS,
    minWords: TUNABLES.FLOOR_MIN_WORDS,
  };
}

/** The floor's reasons are refusal reasons verbatim; this keeps that checkable. */
export function floorRefusals(f: FloorResult): RefusalReason[] {
  return f.blockedBy;
}
