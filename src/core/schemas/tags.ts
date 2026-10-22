/**
 * TAGS AT NIGHT, THE ARITHMETIC (wave 2 lane B, 2026-10-21; design §1). What
 * the night does with tags without a model: the names of the cards a memory
 * is linked to become its tags (a name is a tag already promoted), tags whose
 * stems match are merged (`tag_merges`, `via: stem`), and a merge whose words
 * no memory carries any more is let go. Plus the reads the topic births and
 * the night's tagging ask share: the merge map, the stop list, the tally, and
 * the look-alike pairs a model is asked about.
 *
 * Everything here is lightly held (an experiment with a check on 2026-10-26).
 * Nothing in recall or the wake reads tags yet (lane E).
 */
import { normalizeTag, stemTerm } from "../store/index.js";
import type { Store } from "../store/index.js";
import { TUNABLES } from "./tunables.js";

/** A tag's MERGE KEY: each word stemmed (`store/stem.ts`). Two tags with one key are one tag. */
export function stemKey(tag: string): string {
  return normalizeTag(tag)
    .split(" ")
    .map((w) => stemTerm(w))
    .join(" ");
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const STOP = new Set<string>([
  ...MONTHS,
  ...MONTHS.map((m) => m.slice(0, 3)),
  "sept",
  ...WEEKDAYS,
  ...WEEKDAYS.map((d) => d.slice(0, 3)),
  "tues",
  "thur",
  "thurs",
  "today",
  "tonight",
  "yesterday",
  "tomorrow",
  "morning",
  "afternoon",
  "evening",
  "night",
  "day",
  "week",
  "weekend",
  "month",
  "year",
  "memory",
  "memories",
  "note",
  "notes",
  "misc",
  "general",
  "other",
  "stuff",
  "thing",
  "things",
]);

/**
 * A TAG THAT STAYS A TAG ("October" stays a tag): a date word, a word of time,
 * a word about memory itself, or anything with a digit in it (a date, a
 * version, a number). It can be a tag; it is never promoted into a subject.
 */
export function isStopTag(tag: string): boolean {
  const t = normalizeTag(tag);
  if (t.length === 0 || /\d/.test(t)) return true;
  return STOP.has(t) || t.split(" ").every((w) => STOP.has(w));
}

/** Every recorded merge, alias → tag. */
export function mergeMap(store: Store): Map<string, string> {
  return new Map(store.tagMerges().map((m) => [m.alias, m.tag]));
}

/** What a tag reads as through the merges, following a chain to its end (a cycle stops where it closes). */
export function resolveTag(merges: ReadonlyMap<string, string>, tag: string): string {
  let t = normalizeTag(tag);
  const seen = new Set<string>([t]);
  for (;;) {
    const next = merges.get(t);
    if (next === undefined || seen.has(next)) return t;
    seen.add(next);
    t = next;
  }
}

/** One tag (as it reads through the merges) and what carries it. */
export interface TagTally {
  readonly tag: string;
  /** The words that read as it, itself included, sorted. */
  readonly words: readonly string[];
  readonly memories: readonly string[];
  readonly days: number;
  readonly sessions: number;
  readonly used: number;
  readonly felt: number;
  /** The memory count weighted by use and feeling (`TOPIC_USED_WEIGHT`, `TOPIC_FELT_WEIGHT`). */
  readonly weight: number;
}

/** Every tag on a live memory, resolved through the merges, with what the topic bar reads; heaviest first. */
export function tallyTags(store: Store): TagTally[] {
  const merges = mergeMap(store);
  const by = new Map<string, { words: Set<string>; memories: Map<string, { day: number; session: string | null; used: boolean; felt: boolean }> }>();
  for (const u of store.tagUses()) {
    const tag = resolveTag(merges, u.tag);
    const e = by.get(tag) ?? { words: new Set<string>([tag]), memories: new Map() };
    e.words.add(u.tag);
    e.memories.set(u.memoryId, { day: u.day, session: u.session, used: u.used, felt: u.felt });
    by.set(tag, e);
  }
  const out: TagTally[] = [];
  for (const [tag, e] of by) {
    const ms = [...e.memories.values()];
    const used = ms.filter((m) => m.used).length;
    const felt = ms.filter((m) => m.felt).length;
    out.push({
      tag,
      words: [...e.words].sort(),
      memories: [...e.memories.keys()].sort(),
      days: new Set(ms.map((m) => m.day)).size,
      sessions: new Set(ms.map((m) => m.session).filter((s): s is string => s !== null)).size,
      used,
      felt,
      weight: ms.length + used * TUNABLES.TOPIC_USED_WEIGHT + felt * TUNABLES.TOPIC_FELT_WEIGHT,
    });
  }
  return out.sort((a, b) => b.weight - a.weight || b.memories.length - a.memories.length || a.tag.localeCompare(b.tag));
}

/** Whether a tally clears the topic bar (read at use: compare can set every number). */
export function clearsTopicBar(t: TagTally): boolean {
  return t.weight >= TUNABLES.TOPIC_MIN_MEMORIES && t.days >= TUNABLES.TOPIC_MIN_DAYS && t.sessions >= TUNABLES.TOPIC_MIN_SESSIONS;
}

/** The meta key a "not the same" answer is kept under, so the pair is not asked again. */
export const NOT_SAME_PREFIX = "schemas.tags.notSame.";

export function notSameKey(a: string, b: string): string {
  const [x, y] = [normalizeTag(a), normalizeTag(b)].sort() as [string, string];
  return `${NOT_SAME_PREFIX}${x}|${y}`;
}

/** Two tags that LOOK alike and are not merged: the night asks a model "same?" (`dream/tags.ts`). */
export interface LookAlike {
  readonly a: string;
  readonly b: string;
  /** Memories carrying each. */
  readonly aCount: number;
  readonly bCount: number;
}

function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length] as number;
}

/**
 * THE PAIRS WORTH ASKING ABOUT: two live tags (as they read through the
 * merges) that look alike — one's words inside the other's ("castle" and
 * "castle game"), or a letter apart on words of five or more ("color",
 * "colour"; two letters on eight or more) — that no merge joins and no earlier answer called
 * different. Most-carried first; at least one of the two on two memories.
 */
export function lookAlikePairs(store: Store, limit: number): LookAlike[] {
  if (limit <= 0) return [];
  const notSame = store.metaWithPrefix(NOT_SAME_PREFIX);
  const tallies = tallyTags(store);
  const counts = new Map(tallies.map((t) => [t.tag, t.memories.length]));
  const tags = tallies.map((t) => t.tag);
  const pairs: LookAlike[] = [];
  for (let i = 0; i < tags.length; i++) {
    const a = tags[i] as string;
    const aWords = a.split(" ");
    for (let j = i + 1; j < tags.length; j++) {
      const b = tags[j] as string;
      const ac = counts.get(a) ?? 0;
      const bc = counts.get(b) ?? 0;
      if (ac < 2 && bc < 2) continue;
      if (notSame.has(notSameKey(a, b))) continue;
      const bWords = b.split(" ");
      const [short, long] = aWords.length <= bWords.length ? [aWords, bWords] : [bWords, aWords];
      const contained = short.length < long.length && short.every((w) => long.includes(w));
      // One letter apart on words of five or more ("color", "colour"); two on eight or more.
      // Two on five let "denver" and "enter" through on the corpus copy.
      const shorter = Math.min(a.length, b.length);
      const close = !contained && shorter >= 5 && editDistance(a, b, 2) <= (shorter >= 8 ? 2 : 1);
      if (contained || close) pairs.push({ a, b, aCount: ac, bCount: bc });
    }
  }
  return pairs.sort((x, y) => y.aCount + y.bCount - (x.aCount + x.bCount) || x.a.localeCompare(y.a)).slice(0, limit);
}

export interface TagsNightInput {
  readonly day: number;
  /** False under observer: write nothing, count what a night would do. */
  readonly apply: boolean;
  /** Card-name tags written at most. */
  readonly budget: number;
}

export interface TagsNightOutcome {
  /** False when `TAGS_NIGHT` is off: nothing was read or written. */
  readonly on: boolean;
  /** Links to named cards whose memory lacks the name as a tag. */
  readonly cardOffered: number;
  /** Card names written as tags (`via: card`); under observer, what would be. */
  readonly cardTagged: number;
  /** Links left for the next night by the budget. */
  readonly skippedForLimit: number;
  /** Stem merges recorded (`via: stem`). */
  readonly stemMerged: number;
  /** Merges whose words no memory carries any more, let go. */
  readonly mergesPruned: number;
}

/**
 * THE TAGS PHASE'S WORK (`sleep/tags.ts` hands it the day and budget). In
 * order: (1) each live memory linked to a named card carries the card's name
 * as a tag, newest memories first, `budget` at most a night; (2) tags whose
 * stem keys match are merged into the one more memories carry (`via: stem`),
 * unless the alias is already merged somewhere; (3) a merge whose alias and
 * tag are both on no memory at all is let go (review of #569: a merge is
 * keyed by word and would outlive its memories). Off (`TAGS_NIGHT`): nothing.
 */
export function nightTagWork(store: Store, input: TagsNightInput): TagsNightOutcome {
  if (!TUNABLES.TAGS_NIGHT) return { on: false, cardOffered: 0, cardTagged: 0, skippedForLimit: 0, stemMerged: 0, mergesPruned: 0 };

  // (1) card names. Every live memory's tags in ONE read, not one per link
  // (the corpus copy has 3,164 links).
  const merges = mergeMap(store);
  const uses = store.tagUses();
  const have = new Map<string, Set<string>>();
  for (const u of uses) {
    const s = have.get(u.memoryId) ?? new Set<string>();
    s.add(u.tag);
    s.add(resolveTag(merges, u.tag));
    have.set(u.memoryId, s);
  }
  const wanted = store.cardLinks().filter((l) => {
    const tag = normalizeTag(l.name);
    if (tag.length === 0) return false;
    const on = have.get(l.memoryId);
    return on === undefined || (!on.has(tag) && !on.has(resolveTag(merges, tag)));
  });
  const budget = Math.max(0, Math.floor(input.budget));
  let cardTagged = 0;
  for (const l of wanted.slice(0, budget)) {
    if (input.apply) cardTagged += store.tagMemory(l.memoryId, [l.name], "card");
    else cardTagged += 1;
  }

  // (2) stem merges
  let stemMerged = 0;
  const counts = new Map<string, number>();
  for (const u of input.apply && cardTagged > 0 ? store.tagUses() : uses) counts.set(u.tag, (counts.get(u.tag) ?? 0) + 1);
  const groups = new Map<string, string[]>();
  for (const tag of counts.keys()) groups.set(stemKey(tag), [...(groups.get(stemKey(tag)) ?? []), tag]);
  for (const words of groups.values()) {
    if (words.length < 2) continue;
    const ranked = [...words].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.length - b.length || a.localeCompare(b));
    const head = ranked[0] as string;
    for (const alias of ranked.slice(1)) {
      if (merges.has(alias) || resolveTag(merges, head) === alias) continue;
      if (input.apply && store.recordTagMerge(alias, head, "stem")) merges.set(alias, head);
      stemMerged += 1;
    }
  }

  // (3) dead merges
  let mergesPruned = 0;
  for (const m of store.tagMerges()) {
    if (store.tagInUse(m.alias) || store.tagInUse(m.tag)) continue;
    if (!input.apply || store.undoTagMerge(m.alias)) mergesPruned += 1;
  }

  return {
    on: true,
    cardOffered: wanted.length,
    cardTagged,
    skippedForLimit: Math.max(0, wanted.length - budget),
    stemMerged,
    mergesPruned,
  };
}
