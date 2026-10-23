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
 * Since lane E (2026-10-22) recall reads tags twice, through the composition
 * root: a source's tags prime (`tagPartners`, recall `TAGS_PRIME`), and a
 * topic a turn names brings its beliefs to the slot (`topicsNamedIn`).
 */
import { birthKindSubjectKind, deterministicSubjectKind, normalizeTag, stemTerm } from "../store/index.js";
import type { Store, SubjectKind } from "../store/index.js";
import { TUNABLES } from "./tunables.js";

/** Who set a card's subject kind, and when: `schemas.subjectKind.<id>` → `{by, at, run?}` (the night's ask writes it; `dream/tags.ts`). */
export const SUBJECT_KIND_BY_PREFIX = "schemas.subjectKind.";

/**
 * THE REPAIR OF THE KINDS A CARD'S BIRTH KIND GAVE, once per store
 * (2026-10-22, wave 2 follow-ups): `{at, date, ids: [{id, was}]}`, written
 * when it ran — an empty list too, so it does not look again.
 */
export const KINDS_REPAIR_KEY = "schemas.kinds.repaired";

/**
 * Give back to the night the subject kinds the old rule wrote
 * (`store/operational.ts#birthKindSubjectKind`: a card's birth kind read as
 * its kind of subject, by the v14 upgrade and by inserts until 2026-10-22).
 * A row is the rule's when its kind is what the rule gives its birth kind,
 * nobody is recorded as setting it (`schemas.subjectKind.<id>`), and today's
 * rule (`deterministicSubjectKind`) does not give it the same — so the
 * identity core keeps `person`, and a project, topic or self subject (set
 * by the code that made it, never by this rule) is not read at all. Those
 * rows go back to NULL, which the night's kinds ask sorts with a model.
 * Archived cards too, as the upgrade marked them. Once per store
 * (`KINDS_REPAIR_KEY`, with each id and what it was). `apply` false (an
 * observer) counts and writes nothing. Returns how many.
 */
export function repairBirthKindSubjects(store: Store, apply: boolean): number {
  if (store.getMeta(KINDS_REPAIR_KEY) !== undefined) return 0;
  const fixed: { id: string; was: SubjectKind }[] = [];
  for (const kind of ["person", "place"] as const) {
    for (const id of store.subjectsOfKind(kind, { archived: true })) {
      if (store.getMeta(`${SUBJECT_KIND_BY_PREFIX}${id}`) !== undefined) continue;
      const row = store.row(id);
      if (row === undefined || row.subject_kind !== kind) continue;
      let meta: Record<string, unknown> | null;
      try {
        meta = JSON.parse(row.meta) as Record<string, unknown> | null;
      } catch {
        meta = null;
      }
      if (birthKindSubjectKind(row.type, row.kind, meta) !== kind) continue;
      if (deterministicSubjectKind(row.type, row.kind, meta) === kind) continue;
      fixed.push({ id, was: kind });
    }
  }
  if (!apply) return fixed.length;
  // Recorded first, as the prune and the merge record theirs: a kind taken
  // back that nobody could account for is worse than one a kill left as it was.
  store.setMeta(KINDS_REPAIR_KEY, JSON.stringify({ at: store.now(), date: store.today(), ids: fixed }));
  for (const f of fixed) store.setSubjectKind(f.id, null);
  return fixed.length;
}

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
  /** Subject kinds the old birth-kind rule wrote, given back to the night's ask (`repairBirthKindSubjects`, once per store). */
  readonly kindsRepaired: number;
}

/**
 * THE TAGS PHASE'S WORK (`sleep/tags.ts` hands it the day and budget). In
 * order: (1) each live memory linked to a named card carries the card's name
 * as a tag, newest memories first, `budget` at most a night; (2) tags whose
 * stem keys match are merged into the one more memories carry (`via: stem`),
 * unless the alias is already merged somewhere; (3) a merge whose alias and
 * tag are both on no memory at all is let go (review of #569: a merge is
 * keyed by word and would outlive its memories). Before them, once per store,
 * the kinds the old birth-kind rule wrote are given back to the night's ask
 * (`repairBirthKindSubjects`). Off (`TAGS_NIGHT`): nothing.
 */
export function nightTagWork(store: Store, input: TagsNightInput): TagsNightOutcome {
  if (!TUNABLES.TAGS_NIGHT) return { on: false, cardOffered: 0, cardTagged: 0, skippedForLimit: 0, stemMerged: 0, mergesPruned: 0, kindsRepaired: 0 };

  // (0) once per store: the kinds a card's birth kind gave go back to the
  // night's kinds ask (2026-10-22). Here, behind the same switch, because it
  // hands the cards to that ask: with the switch off nobody would sort them.
  const kindsRepaired = repairBirthKindSubjects(store, input.apply);

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
    kindsRepaired,
  };
}

// ── tags at recall (wave 2 lane E, 2026-10-22) ─────────────────────────────

/** The words a cluster reads as through the merges: canonical tag → every word that resolves to it. */
function clusterWords(merges: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const alias of merges.keys()) {
    const head = resolveTag(merges, alias);
    const words = out.get(head) ?? new Set<string>([head]);
    words.add(alias);
    out.set(head, words);
  }
  return out;
}

/**
 * TAGS AS A PRIMING PARTNER SOURCE (wave 2 lane E, 2026-10-22; recall
 * `TAGS_PRIME`): for each source memory, the live memories that carry one of
 * its tags (through the merges) at weight 1, and those that carry one of the
 * `neighbours` tags most often on the same memories as its own (B's concept
 * edges, `Store#tagNeighbours`, sharing at least two) at 0.5 — the stronger
 * one when both; recall scales them by `TAGS_PRIME_WEIGHT`. A stop tag
 * (`isStopTag`) and a tag on more than `maxTagMemories` live memories are
 * skipped: a word on everything says nothing, and it bounds the reads.
 * Shaped as recall's `TagPartnersFn`. Reads only; never throws (a source that
 * fails partners nothing).
 */
export function tagPartners(
  store: Store,
  ids: readonly string[],
  opts: { readonly maxTagMemories: number; readonly neighbours: number },
): Map<string, { id: string; weight: number }[]> {
  const out = new Map<string, { id: string; weight: number }[]>();
  if (ids.length === 0) return out;
  let merges: Map<string, string>;
  try {
    merges = mergeMap(store);
  } catch {
    return out;
  }
  const clusters = clusterWords(merges);
  const members = new Map<string, string[] | null>();
  const membersOf = (head: string): string[] | null => {
    if (members.has(head)) return members.get(head) ?? null;
    const ids = new Set<string>();
    for (const w of clusters.get(head) ?? [head]) for (const id of store.memoriesTagged(w)) ids.add(id);
    const kept = ids.size > opts.maxTagMemories ? null : [...ids];
    members.set(head, kept);
    return kept;
  };
  for (const id of new Set(ids)) {
    try {
      const own = new Set(
        store
          .tagsOf(id)
          .map((t) => resolveTag(merges, t.tag))
          .filter((t) => !isStopTag(t)),
      );
      if (own.size === 0) continue;
      const got = new Map<string, number>();
      const give = (head: string, w: number): void => {
        for (const m of membersOf(head) ?? []) if (m !== id && w > (got.get(m) ?? 0)) got.set(m, w);
      };
      const usable = [...own].filter((t) => membersOf(t) !== null);
      for (const t of usable) give(t, 1);
      if (opts.neighbours > 0 && usable.length > 0) {
        const words = usable.flatMap((t) => [...(clusters.get(t) ?? [t])]);
        const near: string[] = [];
        for (const n of store.tagNeighbours(words, { limit: opts.neighbours * 4 + words.length })) {
          const head = resolveTag(merges, n.tag);
          if (own.has(head) || near.includes(head) || isStopTag(head) || n.together < 2) continue;
          near.push(head);
          if (near.length >= opts.neighbours) break;
        }
        for (const t of near) give(t, 0.5);
      }
      if (got.size > 0) out.set(id, [...got].map(([m, w]) => ({ id: m, weight: w })));
    } catch {
      /* a source whose tags will not read partners nothing */
    }
  }
  return out;
}

/** A tag's words as the turn's would be read: tokenized and stemmed. */
function stemmedWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    .map((t) => stemTerm(t));
}

/**
 * THE TOPICS A TEXT NAMES (wave 2 lane E): the topic cards (`Store#topicCards`,
 * a topic's word and its merged words → its card) whose word — every word of
 * it, in order, stemmed as the index stems — occurs in `text`. Sorted card ids.
 * A promoted tag is a subject; this is how a turn names one.
 */
export function topicsNamedIn(text: string, topics: ReadonlyMap<string, string>): string[] {
  if (topics.size === 0 || text.trim().length === 0) return [];
  const words = stemmedWords(text);
  if (words.length === 0) return [];
  const out = new Set<string>();
  for (const [word, card] of topics) {
    if (out.has(card) || isStopTag(word)) continue;
    const want = stemmedWords(word);
    if (want.length === 0) continue;
    for (let i = 0; i + want.length <= words.length; i++) {
      if (want.every((w, j) => words[i + j] === w)) {
        out.add(card);
        break;
      }
    }
  }
  return [...out].sort();
}
