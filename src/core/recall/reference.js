export const QUOTE_WINDOW_WORDS = 8;
export const DREW_ON_MAX_PER_BOUNDARY = 3;
export const QUOTE_CONTENT_WORDS = 3;
export const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "so",
  "if",
  "then",
  "than",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "onto",
  "to",
  "up",
  "with",
  "without",
  "about",
  "over",
  "under",
  "i",
  "me",
  "my",
  "we",
  "us",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "it",
  "its",
  "they",
  "them",
  "their",
  "this",
  "that",
  "these",
  "those",
  "there",
  "here",
  "what",
  "which",
  "who",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "will",
  "would",
  "can",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "not",
  "no",
  "yes",
  "just",
  "very",
  "really",
  "also",
  "too",
  "only",
  "still",
  "even",
  "again",
  "think",
  "thought",
  "good",
  "idea",
  "keep",
  "make",
  "made",
  "get",
  "got",
  "go",
  "going",
  "want",
  "like",
  "know",
  "see",
  "say",
  "said",
  "way",
  "thing",
  "things",
  "some",
  "any",
  "all",
  "more",
  "most",
  "one",
  "two",
  "how",
  "when",
  "where",
  "why",
  "because",
  "well",
  "now",
  "let",
  "lets"
]);
export const MEMORY_ID = /^mem_[0-9a-f]{12,16}$/;
export function normalizeWords(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length > 0);
}
export function contentWords(words) {
  let n = 0;
  for (const w of words)
    if (!STOPWORDS.has(w))
      n += 1;
  return n;
}
export function quotesWindow(body, text, window = QUOTE_WINDOW_WORDS) {
  const t = normalizeWords(text);
  const b = normalizeWords(body);
  if (t.length < window || b.length < window)
    return false;
  const seen = new Set;
  for (let i = 0;i + window <= t.length; i++)
    seen.add(t.slice(i, i + window).join(" "));
  for (let i = 0;i + window <= b.length; i++) {
    const run = b.slice(i, i + window);
    if (seen.has(run.join(" ")) && contentWords(run) >= QUOTE_CONTENT_WORDS)
      return true;
  }
  return false;
}
export function resolveReferences(input) {
  const now = input.now ?? Date.now;
  const uses = [];
  const credited = new Set;
  let unresolvedHandles = 0;
  for (const raw of input.expansions) {
    const id = raw.trim();
    if (!MEMORY_ID.test(id)) {
      unresolvedHandles += 1;
      continue;
    }
    if (credited.has(id))
      continue;
    credited.add(id);
    uses.push({ memoryId: id, how: "expanded" });
  }
  const expanded = uses.length;
  const turns = input.assistantTurns.filter((t) => t.trim().length > 0);
  let considered = 0;
  let skippedForBudget = 0;
  let budgetExceeded = false;
  for (const c of input.candidates) {
    if (input.deadline !== undefined && now() > input.deadline) {
      budgetExceeded = true;
      if (c.tier === "surfaced" && !credited.has(c.id))
        skippedForBudget += 1;
      continue;
    }
    considered += 1;
    if (c.tier !== "surfaced" || credited.has(c.id))
      continue;
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
    budgetExceeded
  };
}
