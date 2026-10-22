/**
 * THE ONE SCREEN A TAG PASSES (wave 2 lane B, 2026-10-21; review of #570):
 * every door that hands the core tags — the MCP door (`mcp/server-args.ts
 * #readTags`) and an embedder calling `submitJot` or `submitSessionEnd`
 * directly (`counterpart-deposit.ts#carryTags`) — screens them here, so the
 * rule cannot differ by door.
 *
 * Loose first: nothing here refuses a memory. A tag that is not text, or
 * carries a secret (`containsSecret`, read on the words AS SENT: lowercasing
 * hides some keys from the battery, and nothing of a secret is echoed back),
 * or is longer than `TAG_MAX_CHARS`, or comes past `TAGS_PER_MEMORY`, is
 * dropped and said; the rest are normalized (`normalizeTag`) and
 * deduplicated. A blank one is skipped silently. Not stemmed: the stored word
 * is the word as sent; stems are the night's merge key.
 */
import { containsSecret } from "./encode/index.js";
import { normalizeTag } from "./store/index.js";

/** Loose limits (lightly held): a tag is a few words, and a memory has a few. */
export const TAG_MAX_CHARS = 48;
export const TAGS_PER_MEMORY = 8;

export interface ScreenedTags {
  readonly kept: readonly string[];
  /** What was dropped, said plainly (never a secret's words). */
  readonly dropped: readonly string[];
}

export function screenTags(items: readonly unknown[]): ScreenedTags {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") {
      dropped.push("a tag that was not text");
      continue;
    }
    if (containsSecret(item)) {
      dropped.push("a tag that looked like a secret");
      continue;
    }
    const t = normalizeTag(item);
    if (t.length === 0) continue;
    if (t.length > TAG_MAX_CHARS) dropped.push(`"${t.slice(0, 24)}…" (longer than ${String(TAG_MAX_CHARS)} characters; a tag is a few words)`);
    else if (!kept.includes(t)) kept.push(t);
  }
  if (kept.length > TAGS_PER_MEMORY) {
    dropped.push(`${kept.slice(TAGS_PER_MEMORY).map((t) => `"${t}"`).join(", ")} (past ${String(TAGS_PER_MEMORY)} tags)`);
    kept.length = TAGS_PER_MEMORY;
  }
  return { kept, dropped };
}
