/**
 * THE UNMARKED OFFER'S ORDER (2026-10-20, Mike's go, lightly held, an
 * experiment). A memory nobody marked that the work lane counts as a
 * project's work only for want of a mark (`self/work.ts#isWorkMemory`: an
 * unmarked fact, entity or place written in a directory, or a skill) is shown
 * only in that directory. The nightly reflection is offered some of them to
 * mark by meaning, and the ones most likely personal come first, so the
 * personal ones — which, marked owner or us, flow to every folder — are not
 * left waiting behind the work.
 *
 * Read from what the store holds and a cheap word check, never a model: a
 * feeling recorded on it, a person's name from the store's own `person`
 * memories, a word of life outside the work, an entity, the owner's name.
 * Pure: the caller hands the rows and the names; `tools/audit/unmarked-offer.ts`
 * reads a snapshot copy through the same functions.
 */

/**
 * Words of life outside the work (CAL, lightly held). Whole words, lower case.
 * Not this project's own vocabulary — no "feeling", "dream", "sleep", "home",
 * "health", "rest" or "walk", which name parts of the build, and no "doctor"
 * (`counterparts doctor`: 458 paragraphs of the repo's notes and docs, review
 * of #558) — so a work note about the feelings wheel does not read as personal.
 */
export const PERSONAL_WORDS: readonly string[] = [
  "visit", "visited", "visiting", "visitor", "visitors",
  "friend", "friends", "family", "wife", "husband", "partner", "girlfriend", "boyfriend",
  "kid", "kids", "son", "daughter", "mom", "mum", "dad", "mother", "father", "sister", "brother",
  "parents", "grandma", "grandpa", "grandmother", "grandfather", "cousin", "aunt", "uncle", "niece", "nephew",
  "birthday", "wedding", "funeral", "anniversary",
  "weekend", "vacation", "holiday", "trip", "travel", "travelling", "traveling",
  "dinner", "lunch", "breakfast", "cooking", "cooked",
  "sick", "ill", "illness", "pneumonia", "flu", "fever", "hospital", "surgery",
  "tired", "exhausted", "worn", "burned", "burnt", "stressed", "anxious", "lonely", "grief", "grieving",
  "garden", "dog", "cat", "pet", "hike", "hiking", "beach", "movie", "concert", "music",
  "taxes", "rent", "apartment", "moving", "church",
];

/** What the rank reads off one candidate. */
export interface UnmarkedCandidate {
  readonly id: string;
  readonly kind: string;
  readonly title: string | null;
  readonly body: string;
  readonly uses: number;
  readonly createdAt: number;
  /** A feeling is recorded on it. */
  readonly felt: boolean;
}

/** What the rank reads off the store as a whole. */
export interface UnmarkedNames {
  /** The owner's names (`sleep/consolidate.ts#ownerNames`), lower case. */
  readonly owner: readonly string[];
  /** Other people's names, from the store's `person` memories (`personNames`), lower case. */
  readonly people: readonly string[];
}

/**
 * Other people's names, from live `person` memories and the store's `person`
 * cards (`schemas/`: a name and its aliases): their `name`, `entity` and
 * `aliases` meta, and a title of one to three words (a name, not a sentence).
 * Lower case, at least three characters, the owner's names left out — they
 * have their own, weaker, weight (his name is in half the work notes too).
 */
export function personNames(rows: Iterable<{ readonly title: string | null; readonly meta: string }>, owner: readonly string[]): string[] {
  const out = new Set<string>();
  const skip = new Set(owner);
  const add = (v: unknown): void => {
    if (typeof v !== "string") return;
    const n = v.trim().toLowerCase();
    if (n.length >= 3 && n.length <= 40 && !skip.has(n)) out.add(n);
  };
  for (const r of rows) {
    let meta: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(r.meta);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
    } catch {
      meta = {};
    }
    add(meta["name"]);
    add(meta["entity"]);
    if (Array.isArray(meta["aliases"])) for (const a of meta["aliases"]) add(a);
    const t = (r.title ?? "").trim();
    if (t.length > 0 && t.split(/\s+/).length <= 3) add(t);
  }
  return [...out];
}

/** One regex for a list of whole words or phrases (letters and digits bound them), or null for none. */
export function wordsPattern(words: readonly string[]): RegExp | null {
  const alts = words.filter((w) => w.length > 0).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (alts.length === 0) return null;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${alts.join("|")})(?:$|[^\\p{L}\\p{N}])`, "u");
}

/** The weights (CAL, lightly held): what each sign of a personal memory adds. */
export const UNMARKED_WEIGHTS = { felt: 2, person: 2, word: 1, entity: 1, owner: 1 } as const;

/**
 * How likely personal one candidate reads: a feeling recorded on it, another
 * person named, a word of life outside the work, an entity, the owner named.
 */
export function unmarkedRanker(names: UnmarkedNames): (c: UnmarkedCandidate) => number {
  const people = wordsPattern(names.people);
  const owner = wordsPattern(names.owner);
  const words = wordsPattern(PERSONAL_WORDS);
  const W = UNMARKED_WEIGHTS;
  return (c) => {
    const text = `${c.title ?? ""} ${c.body}`.toLowerCase();
    return (
      (c.felt ? W.felt : 0) +
      (people !== null && people.test(text) ? W.person : 0) +
      (words !== null && words.test(text) ? W.word : 0) +
      (c.kind === "entity" ? W.entity : 0) +
      (owner !== null && owner.test(text) ? W.owner : 0)
    );
  };
}

/**
 * The offer's order: the most likely personal first, then the most used, then
 * the oldest, then the id — and ROTATED: what the last few reflections were
 * offered (`lately`) waits behind the rest and comes back when they run out.
 * At most `cap`.
 */
export function orderUnmarked(candidates: readonly UnmarkedCandidate[], names: UnmarkedNames, lately: ReadonlySet<string>, cap: number): string[] {
  const rank = unmarkedRanker(names);
  const ranked = candidates
    .map((c) => ({ c, r: rank(c) }))
    .sort((a, b) => b.r - a.r || b.c.uses - a.c.uses || a.c.createdAt - b.c.createdAt || (a.c.id < b.c.id ? -1 : 1))
    .map((x) => x.c.id);
  return [...ranked.filter((x) => !lately.has(x)), ...ranked.filter((x) => lately.has(x))].slice(0, Math.max(0, cap));
}
