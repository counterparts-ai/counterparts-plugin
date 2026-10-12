/** What the search index and the embedder are given for a row, and the record of a row the embedder would not take (moved out of `store/index.ts`, 2026-10-11). */
import type { ProseDoc } from "./prose.js";

/**
 * Every method that can change durable state. The totality test asserts this list
 * equals the set of sites that consult the observer predicate, and that each one
 * refuses under observer (observer-mode.md G6: every stand-down is observable).
 */
/**
 * The backfill's give-up counter: `embed.failed.<id>` in box 2's meta, and the
 * number of ITEM-ATTRIBUTABLE failures after which `missingVectors` stops
 * offering that id.
 *
 * **Only the failures the provider blamed on the item itself may move it** — a
 * 400 the bisector narrowed down to one input (`ChunkFailure.item`). A 429, a
 * 5xx, a dropped socket, an aborted watchdog or a malformed body says nothing
 * about WHICH input is bad, and counting those was I33 inverted: three bad
 * boundaries in a row would retire a whole healthy window and `unembeddedCount`
 * — the coverage watch — would then read COMPLETE while those memories stayed
 * blind. Three rather than one because even a 400 can be answered for a reason
 * that is not the text.
 *
 * Written by whoever runs the backfill (`adapters/claude-code/vectors.ts`),
 * cleared the moment an id embeds, and cleared wholesale by
 * `counterparts verify --retry-skipped` — which is the remedy a repaired title
 * needs, because a skipped id is never offered again and so can never clear
 * itself. Meta keys only — no schema bump (precedent: `sleep.pruned.<id>`).
 */
export const EMBED_FAILED_PREFIX = "embed.failed.";

export const EMBED_SKIP_AFTER = 3;

/**
 * The string box 3 indexes for a document — and therefore the string a CALLER
 * must embed if it wants its vector to be the one this store looks up at `put`
 * time. Exported for exactly that: `counterpart.ts` composes it from a
 * proposal's title and its GATED content before the memory exists, so one live
 * call serves both the novelty seam and box 3.
 *
 * The word gated is the whole contract. This function is a pure join, so it
 * cannot enforce which content it is handed — a caller that composes it from the
 * author's raw draft will cache under a key `indexOne` never asks for, and every
 * redaction or hedge silently costs the deposit its vector. The ordering that
 * makes it true lives in `bridge.batteryGate`, and a test asserts it.
 */
export function indexTextOf(title: string | null | undefined, body: string): string {
  return [title ?? "", body].join("\n");
}

export function indexText(doc: ProseDoc): string {
  return indexTextOf(doc.title, doc.body);
}

/**
 * THE TWO ROWS THAT NEVER GET A VECTOR, and why the rule is one function.
 *
 * Both are `type: "schema"` rows that are DELIVERED AT THE WAKE and are skipped
 * by `recall/activate.ts`, so neither can reach a turn through the semantic
 * channel however good its vector is. Embedding either buys retrieval nothing
 * and costs three things that were measured rather than argued:
 *
 *   1. **The most sensitive prose in the store goes out to an embedding API for
 *      no use.** The self page is up to 16 KB of first-person identity; the
 *      handoff is the prose E1's own CONTRACT calls the likeliest to carry a
 *      token. Data leaves the machine only by the owner's choice (constitution
 *      6), and "because the indexer indexes everything" is not a choice.
 *   2. **They put a permanent floor under `unembeddedCount()`** — the number
 *      `doctor` and the parallel run watch, whose whole job is to say what is
 *      ACTIONABLE. On a keyless store that floor never falls.
 *   3. **A vector for a superseded body can displace a live neighbour** on the
 *      semantic slate (`cache.ts#deindexDoc`'s note: `nearestTo` scans
 *      `embeddings` with no liveness filter). Fewer rows in that table that
 *      nothing can deliver is strictly better.
 *
 *   - **`role: "page"`** — the self page (S1). Raised by E1's adversarial review
 *     as "worth checking whether the page is in the same position"; it was, and
 *     the coordinating session asked for the exclusion on 2026-09-20. **A
 *     WORKING DEFAULT, not a ruling — the owner has not been asked, and this is
 *     revisable without ceremony** (CLAUDE.md). The three reasons above are the
 *     whole of the argument for it; if any of them stops being true, so does
 *     this line.
 *   - **`role: "handoff"`** — the per-directory handoff (E1).
 *
 * Read STRUCTURALLY, for the reason `recall/` reads these roles structurally:
 * `store/` depends on no module above it, and a parse that fails reads as
 * "embed it", which is the direction that only ever costs a vector nobody asks
 * for. The strings' owners are `core/self/page.ts#SELF_PAGE_ROLE` and
 * `core/handoff/index.ts#HANDOFF_ROLE`.
 *
 * **What is NOT excluded, checked by the same test and left alone:**
 * the JOURNAL (`type: "episode"`) is a real recall candidate — `activate` does
 * not skip it, `expandHandle` returns it with `journal: true`, and the backfill
 * puts episodes in the FIRST group on purpose — so a vector buys it something
 * and it keeps one. Beliefs and entities (`role: "belief"`, `"entity"`) are
 * candidates too. S2's nightly writer mints no row of its own: it revises the
 * PAGE row and writes events, so excluding the page covers it whole.
 */
export function noVector(type: string, role: unknown): boolean {
  return type === "schema" && (role === "handoff" || role === "page");
}

/** The same rule for a caller holding box 2's columns rather than a document. */
export function notForEmbedding(row: { type: string; meta: string }): boolean {
  if (row.type !== "schema") return false;
  try {
    return noVector(row.type, (JSON.parse(row.meta) as Record<string, unknown>)["role"]);
  } catch {
    return false;
  }
}
