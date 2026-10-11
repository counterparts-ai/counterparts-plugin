/**
 * Reference resolution (CONTRACT §9.2) — which memories a session's replies
 * actually USED, decided from the assistant's own turns and nothing else.
 *
 * This is the consumer INTERFACE-GAPS §5 said had no home: `resolveUse` routes
 * a DECIDED tier to physics, and until this module nothing decided one. The
 * live consequence, measured 2026-09-14 on the owner's store: every memory
 * minted since launch sat at `uses = 0`, `reinforced_days = 0`, so nothing new
 * could ever cross into the semantic or identity bands (IMPROVEMENTS U10).
 *
 * THE RULE (owner ruling 2026-09-14): a memory is credited when the assistant
 * EXPANDED it through deliberate recall, or QUOTED it at content level. Never
 * for being named in prose, never for being surfaced, never for being rendered
 * in a wake. Reinforcement is for thinking with a memory, not for having been
 * shown it.
 *
 * Two doors, and what each one can see:
 *
 *   **Expanded.** The assistant called the recall tool with `ids` or a
 *   `handle`. The call is an assistant turn; its `input` is the evidence. Ids
 *   are taken from the tool call's input ONLY — never parsed out of prose. The
 *   fixture: on 2026-09-14 the model wrote five `[mem_…]` ids into a reply
 *   having read none of them (IMPROVEMENTS U5). A `handle` that is not itself a
 *   memory id is counted `unresolvedHandles` and credits nothing here: this
 *   module resolves nothing fuzzily, and the tool's own answer was already
 *   exact or not-found.
 *
 *   **Quoted.** A run of `QUOTE_WINDOW_WORDS` consecutive words of a memory's
 *   body appears verbatim (normalized) in an assistant `conversation` turn.
 *   Only a memory that surfaced LOUD is a candidate: a footnoted memory showed
 *   the model nothing but an 80-byte title, so any quote of it is naming, and a
 *   memory the model expanded is credited by the expansion. Paraphrase misses.
 *   That is the contract's bar — precision over recall: a false "used" pollutes
 *   learning permanently, a miss merely leaves weak credit — and the reason
 *   bansai's IDF token overlap (`consolidate/thread-match.ts`) was NOT ported:
 *   an overlap score credits co-mention, a verbatim window credits use.
 *
 * What this module never does: read the store (bodies arrive on the input),
 * call a model, read a file, or judge agreement. A memory the assistant
 * expanded and then argued with is credited — contradiction is engagement,
 * and physics §5.5 counts distinct days, not endorsement.
 *
 * Pure and synchronous: the boundary hook runs under a latency budget, so the
 * caller passes a `deadline` and the resolver stops between candidates rather
 * than truncating silently — an overrun is REPORTED (`budgetExceeded`), and
 * what was decided before it stands.
 */

export const QUOTE_WINDOW_WORDS = 8;

/**
 * At most this many `drewOn` credits land per BOUNDARY (2026-10-11): one ask
 * and its answers, `session_end` and `chapter` together — the recall turn the
 * session is on, which no answer to the ask moves. Only credits that LANDED
 * use a slot; past it, the rest of the ids named come back `capped`, in the
 * order given (`Counterpart#creditDrewOn`). Built by the drewOn builder,
 * 2026-10-11, from Mike's 10-10 direction, lightly held.
 */
export const DREW_ON_MAX_PER_BOUNDARY = 3;

/**
 * Owner ruling 2026-09-14 (R3, review of #99): a matching window must carry at
 * least this many NON-stopword tokens, or it is boilerplate, not a quote.
 * Repro that forced it: body "I think it would be a good idea to keep …" and a
 * reply "I think it would be a good idea to move on" share eight words and
 * say nothing about the memory.
 */
export const QUOTE_CONTENT_WORDS = 3;

/** Function words that carry no content. Small on purpose: the floor is a
 *  guard against boilerplate, not a linguistics project. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "so", "if", "then", "than", "as", "at", "by", "for", "from",
  "in", "into", "of", "on", "onto", "to", "up", "with", "without", "about", "over", "under",
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his", "she", "her", "it", "its",
  "they", "them", "their", "this", "that", "these", "those", "there", "here", "what", "which", "who",
  "is", "am", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "will", "would", "can", "could", "should", "may", "might", "must", "shall",
  "not", "no", "yes", "just", "very", "really", "also", "too", "only", "still", "even", "again",
  "think", "thought", "good", "idea", "keep", "make", "made", "get", "got", "go", "going", "want",
  "like", "know", "see", "say", "said", "way", "thing", "things", "some", "any", "all", "more", "most",
  "one", "two", "how", "when", "where", "why", "because", "well", "now", "let", "lets",
]);

/** A memory id as the store mints them. Anything else is not an address. */
export const MEMORY_ID = /^mem_[0-9a-f]{12,16}$/;

export type ReferenceHow = "expanded" | "quoted";

export interface ReferenceCandidate {
  readonly id: string;
  /** Only `surfaced` is quotable; `footnoted` is listed for the accounting. */
  readonly tier: "surfaced" | "footnoted";
  /** Canonical body. Never rendered anywhere by this module. */
  readonly body: string;
}

export interface ReferenceInput {
  /** Assistant `conversation` text for the slice under judgment, in order. */
  readonly assistantTurns: readonly string[];
  /** Raw `ids` / `handle` values from recall tool calls in the same slice. */
  readonly expansions: readonly string[];
  readonly candidates: readonly ReferenceCandidate[];
  /** `Date.now()`-comparable; the resolver stops between candidates past it. */
  readonly deadline?: number;
  readonly now?: () => number;
}

export interface ReferenceUse {
  readonly memoryId: string;
  readonly how: ReferenceHow;
}

export interface ReferenceResult {
  readonly uses: readonly ReferenceUse[];
  readonly expanded: number;
  readonly quoted: number;
  /** Candidates looked at before the deadline (or all of them). */
  readonly considered: number;
  /** Loud candidates never compared because the deadline hit first. */
  readonly skippedForBudget: number;
  readonly unresolvedHandles: number;
  readonly budgetExceeded: boolean;
}

/** Lowercase alphanumeric words, in order. The one normalization, used on both sides. */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0);
}

/** Content tokens in a run of words: what is left after the stopwords. */
export function contentWords(words: readonly string[]): number {
  let n = 0;
  for (const w of words) if (!STOPWORDS.has(w)) n += 1;
  return n;
}

/**
 * True when some `window`-word run of `body` appears verbatim in `text` AND
 * that run carries at least `QUOTE_CONTENT_WORDS` content tokens (R3). A run
 * of function words shared by two sentences is boilerplate, not a quote.
 * O(|text| + |body|): the text's windows go into a set once, the body's are
 * looked up.
 */
export function quotesWindow(body: string, text: string, window: number = QUOTE_WINDOW_WORDS): boolean {
  const t = normalizeWords(text);
  const b = normalizeWords(body);
  if (t.length < window || b.length < window) return false;
  const seen = new Set<string>();
  for (let i = 0; i + window <= t.length; i++) seen.add(t.slice(i, i + window).join(" "));
  for (let i = 0; i + window <= b.length; i++) {
    const run = b.slice(i, i + window);
    if (seen.has(run.join(" ")) && contentWords(run) >= QUOTE_CONTENT_WORDS) return true;
  }
  return false;
}

export function resolveReferences(input: ReferenceInput): ReferenceResult {
  const now = input.now ?? Date.now;
  const uses: ReferenceUse[] = [];
  const credited = new Set<string>();
  let unresolvedHandles = 0;

  // Door one: expansions. Exact addresses only, each memory once.
  for (const raw of input.expansions) {
    const id = raw.trim();
    if (!MEMORY_ID.test(id)) {
      unresolvedHandles += 1;
      continue;
    }
    if (credited.has(id)) continue;
    credited.add(id);
    uses.push({ memoryId: id, how: "expanded" });
  }
  const expanded = uses.length;

  // Door two: verbatim windows against what surfaced loud, one turn at a
  // time: a quote split across two assistant turns is not a quote.
  const turns = input.assistantTurns.filter((t) => t.trim().length > 0);
  let considered = 0;
  let skippedForBudget = 0;
  let budgetExceeded = false;
  for (const c of input.candidates) {
    if (input.deadline !== undefined && now() > input.deadline) {
      budgetExceeded = true;
      if (c.tier === "surfaced" && !credited.has(c.id)) skippedForBudget += 1;
      continue;
    }
    considered += 1;
    if (c.tier !== "surfaced" || credited.has(c.id)) continue;
    if (turns.some((text) => quotesWindow(c.body, text))) {
      credited.add(c.id);
      uses.push({ memoryId: c.id, how: "quoted" });
    }
  }

  return {
    uses,
    expanded,
    quoted: uses.length - expanded,
    considered,
    skippedForBudget,
    unresolvedHandles,
    budgetExceeded,
  };
}
