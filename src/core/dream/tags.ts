/**
 * THE NIGHT'S TAGGING ASK (wave 2 lane B, 2026-10-21; design §1, lightly
 * held). A small child of its own after the reflection, on a small model —
 * NOT the dream's room: the dream's intake is already the night's narrowest
 * pipe (leak 2), so tagging takes none of its bundle. It is asked three
 * things, each budgeted (`schemas/tunables.ts`):
 *
 *   - untagged memories, recent and strong first: 3–5 tags each, reusing the
 *     store's words where they fit (`TAGS_BACKFILL_PER_NIGHT`);
 *   - tag pairs that look alike and that no stem joins: the same, or not?
 *     (`TAGS_MERGE_ASKS_PER_NIGHT`; it asks when unsure — a "not the same"
 *     is kept so the pair is not asked again);
 *   - cards with no subject kind: person, project, place or topic?
 *     (`TAGS_KINDS_PER_NIGHT`; who set it is kept beside it).
 *
 * The answer comes back through the dream tool (`phase: "tags"`), and
 * everything it writes is recorded as the night's (`via: night`, a meta row
 * per kind set and per run), so `undoNightTags` takes a night back. Off
 * (`TAGS_NIGHT`): the bundle is empty and nothing is written.
 *
 * Here and not in the reflection's finish: the asks are small work for a
 * small model, and a child of their own keeps the reflection's file to lane C.
 */
import { lookAlikePairs, notSameKey, resolveTag, mergeMap, SUBJECT_KIND_BY_PREFIX, TUNABLES as SCHEMAS } from "../schemas/index.js";
import type { LookAlike } from "../schemas/index.js";
import { normalizeTag, SUBJECT_KINDS } from "../store/index.js";
import type { Store, SubjectKind } from "../store/index.js";
import { screenTags } from "../tag-screen.js";
import { localDate } from "../time.js";

/** Characters of a memory's body the ask shows. */
export const TAGS_EXCERPT_CHARS = 280;
/** The store's most-carried tags shown, so the night reuses its words. */
export const TAGS_VOCABULARY = 60;

/** The kinds a card may be given at night. `self` is the one subject that is me, never asked. */
export const NIGHT_CARD_KINDS: readonly SubjectKind[] = SUBJECT_KINDS.filter((k) => k !== "self");

/** Who set a card's subject kind, and when: `schemas.subjectKind.<id>` → `{by, at, run?}`. Spelled in `schemas/tags.ts`, whose repair reads it too. */
export { SUBJECT_KIND_BY_PREFIX };
/** One night's tagging, recorded: `tags.night.<run>` → counts and when. */
export const TAGS_NIGHT_PREFIX = "tags.night.";
/** What one night's ask SHOWED (review of #576): `tags.ask.<run>` → the memory ids, pairs and card ids an answer may touch. */
export const TAGS_ASK_PREFIX = "tags.ask.";

/** The hands whose tags make a memory "tagged" (review of #576): a card's name alone does not, so named memories still get topic words. */
export const OWN_TAG_VIAS: readonly string[] = ["write", "carried", "night"];

/** One line of the bundle: whitespace — a newline above all — flattened, so no title or name can forge a line. */
function flat(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export interface TagsBundle {
  /** False when `TAGS_NIGHT` is off. */
  readonly on: boolean;
  readonly memories: readonly { readonly id: string; readonly title: string | null; readonly excerpt: string; readonly chars: number }[];
  /** How many live memories have no tag, in all. */
  readonly untagged: number;
  readonly vocabulary: readonly string[];
  readonly pairs: readonly LookAlike[];
  readonly cards: readonly { readonly id: string; readonly name: string; readonly kind: string; readonly titles: readonly string[] }[];
  /** How many cards have no subject kind, in all. */
  readonly unkinded: number;
}

/** What the night is asked tonight. Reads only. */
export function tagsBundle(store: Store): TagsBundle {
  if (!SCHEMAS.TAGS_NIGHT) return { on: false, memories: [], untagged: 0, vocabulary: [], pairs: [], cards: [], unkinded: 0 };
  const untagged = store.untaggedMemories(SCHEMAS.TAGS_BACKFILL_PER_NIGHT);
  const cards = store.unkindedCards(SCHEMAS.TAGS_KINDS_PER_NIGHT);
  return {
    on: true,
    memories: untagged.memories.map((m) => {
      const body = flat(m.body);
      return { id: m.id, title: m.title, excerpt: body.length > TAGS_EXCERPT_CHARS ? `${body.slice(0, TAGS_EXCERPT_CHARS)}…` : body, chars: body.length };
    }),
    untagged: untagged.total,
    vocabulary: store.tagCounts({ limit: TAGS_VOCABULARY }).map((t) => t.tag),
    pairs: lookAlikePairs(store, SCHEMAS.TAGS_MERGE_ASKS_PER_NIGHT),
    cards: cards.cards,
    unkinded: cards.total,
  };
}

/** What a recorded ask lets an answer touch. */
interface AskRecord {
  readonly memories: readonly string[];
  readonly pairs: readonly (readonly [string, string])[];
  readonly cards: readonly string[];
}

/**
 * THE ASK, SHOWN AND RECORDED (review of #576): the bundle, with what it
 * showed kept under the run (`tags.ask.<run>`), so the answer is bounded by
 * it — only the memories, pairs and cards shown, nothing else. A second read
 * in the same run replaces the record, and a new run's read removes the last
 * run's: one record is kept, the latest.
 */
export function askTags(store: Store, run: string): TagsBundle {
  const b = tagsBundle(store);
  if (b.on) {
    // ONE ASK KEPT (re-review of #576): an answer belongs to the run that just
    // asked, so an earlier run's record goes when a new one is written — the
    // meta table does not grow a row a night.
    for (const key of store.metaWithPrefix(TAGS_ASK_PREFIX).keys()) {
      if (key !== `${TAGS_ASK_PREFIX}${run}`) store.updateMeta(key, () => null);
    }
    const record: AskRecord = { memories: b.memories.map((m) => m.id), pairs: b.pairs.map((p) => [p.a, p.b] as const), cards: b.cards.map((c) => c.id) };
    store.setMeta(`${TAGS_ASK_PREFIX}${run}`, JSON.stringify(record));
  }
  return b;
}

function askOf(store: Store, run: string): AskRecord | null {
  try {
    const raw = store.getMeta(`${TAGS_ASK_PREFIX}${run}`);
    if (raw === undefined) return null;
    const r = JSON.parse(raw) as Partial<AskRecord>;
    return { memories: r.memories ?? [], pairs: r.pairs ?? [], cards: r.cards ?? [] };
  } catch {
    return null;
  }
}

/** The bundle as the child reads it: plain lines, each with what to answer. Every title and name is flattened to one line. */
export function renderTagsBundle(b: TagsBundle): string {
  if (!b.on) return "Tagging is switched off tonight. Nothing to do.";
  const lines: string[] = [];
  if (b.memories.length > 0) {
    lines.push(`MEMORIES WITH NO TAGS (${String(b.memories.length)} of ${String(b.untagged)}): give each 3-5 tags.`);
    for (const m of b.memories) lines.push(`- ${m.id}${m.title === null ? "" : ` | ${flat(m.title)}`} | ${m.excerpt}`);
    if (b.vocabulary.length > 0) lines.push("", `Tags already in use (reuse one when it fits): ${b.vocabulary.join(", ")}`);
  }
  if (b.pairs.length > 0) {
    lines.push("", "TAGS THAT LOOK ALIKE: is each pair one topic (same: true) or two (same: false)? Unsure is false.");
    for (const p of b.pairs) lines.push(`- "${p.a}" (${String(p.aCount)}) / "${p.b}" (${String(p.bCount)})`);
  }
  if (b.cards.length > 0) {
    lines.push("", `CARDS WITH NO KIND (${String(b.cards.length)} of ${String(b.unkinded)}): each is a person, project, place or topic.`);
    for (const c of b.cards) lines.push(`- ${c.id} | ${flat(c.name)} | named in: ${c.titles.length === 0 ? "(nothing live)" : c.titles.map(flat).join(" / ")}`);
  }
  return lines.length === 0 ? "Nothing to tag, merge or sort tonight." : lines.join("\n");
}

/** What the child sends back. Every field optional; what cannot be read is refused by item, never the whole answer. */
export interface TagsAnswer {
  readonly tagged?: unknown;
  readonly merges?: unknown;
  readonly kinds?: unknown;
}

export interface TagsApplied {
  readonly on: boolean;
  /** Memories tagged, and tags written. */
  readonly memories: number;
  readonly tags: number;
  /** Merges recorded (same) and pairs kept apart (not the same). */
  readonly merged: number;
  readonly notSame: number;
  /** Cards given a subject kind. */
  readonly kinds: number;
  /** Items not taken, with why — in the answer, so the child can see them. */
  readonly refused: readonly string[];
}

function objects(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x)) : [];
}

/** A night tag passes the one screen every door's does (`tag-screen.ts#screenTags`). */
export function screenNightTags(raw: unknown): string[] {
  const items: unknown[] = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  return [...screenTags(items).kept];
}

/**
 * THE NIGHT'S ANSWER, WRITTEN — BOUNDED BY WHAT THE ASK SHOWED (review of
 * #576; `askTags` recorded it under the run): tags only on a memory the ask
 * listed, still live, not the journal's own row, and still without a tag of
 * its own (`OWN_TAG_VIAS`: a card's name does not count; the writer's are
 * never touched); a merge only of a pair the ask listed, both still in use,
 * the one fewer memories carry read as the other (`via: night`); a "not the
 * same" kept under `NOT_SAME_PREFIX`; a kind only on a card the ask listed
 * that still has none, recorded with who set it. Nothing is taken without a
 * recorded ask. `run` names the night in every record.
 */
export function applyTagsAnswer(store: Store, answer: TagsAnswer, ctx: { readonly run: string }): TagsApplied {
  if (!SCHEMAS.TAGS_NIGHT) return { on: false, memories: 0, tags: 0, merged: 0, notSame: 0, kinds: 0, refused: ["tagging is switched off tonight"] };
  const ask = askOf(store, ctx.run);
  if (ask === null) return { on: true, memories: 0, tags: 0, merged: 0, notSame: 0, kinds: 0, refused: ["nothing was asked in this run: read the ask first (phase \"tags\" with no answers)"] };
  const shownMemories = new Set(ask.memories);
  const shownCards = new Set(ask.cards);
  const shownPair = (a: string, b: string): boolean => ask.pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const refused: string[] = [];
  let memories = 0;
  let tags = 0;
  const done = new Set<string>();
  for (const item of objects(answer.tagged)) {
    const id = typeof item["id"] === "string" ? item["id"].trim() : "";
    if (!shownMemories.has(id) || done.has(id)) {
      refused.push(`${id.length === 0 ? "(no id)" : id}: not a memory this ask showed`);
      continue;
    }
    done.add(id);
    const row = store.row(id);
    if (row === undefined || row.type !== "memory" || row.archived !== 0 || row.superseded_by !== null || row.body.length === 0 || row.source === "episode") {
      refused.push(`${id}: not a live memory`);
      continue;
    }
    if (store.tagsOf(id).some((t) => OWN_TAG_VIAS.includes(t.via))) {
      refused.push(`${id}: already tagged`);
      continue;
    }
    const words = screenNightTags(item["tags"]);
    if (words.length === 0) {
      refused.push(`${id}: no tag that could be kept`);
      continue;
    }
    tags += store.tagMemory(id, words, "night");
    memories += 1;
  }

  let merged = 0;
  let notSame = 0;
  const merges = mergeMap(store);
  const counts = new Map(store.tagCounts().map((t) => [t.tag, t.memories]));
  for (const item of objects(answer.merges)) {
    const rawA = typeof item["a"] === "string" ? normalizeTag(item["a"]) : "";
    const rawB = typeof item["b"] === "string" ? normalizeTag(item["b"]) : "";
    if (!shownPair(rawA, rawB)) {
      refused.push(`"${rawA}" / "${rawB}": not a pair this ask showed`);
      continue;
    }
    const a = resolveTag(merges, rawA);
    const b = resolveTag(merges, rawB);
    if (a.length === 0 || b.length === 0 || a === b || !store.tagInUse(a) || !store.tagInUse(b)) {
      refused.push(`"${String(item["a"] ?? "")}" / "${String(item["b"] ?? "")}": not two tags in use`);
      continue;
    }
    if (item["same"] === true) {
      const [alias, tag] = (counts.get(a) ?? 0) >= (counts.get(b) ?? 0) ? [b, a] : [a, b];
      if (store.recordTagMerge(alias, tag, "night")) {
        merges.set(alias, tag);
        merged += 1;
      }
    } else if (item["same"] === false) {
      store.setMeta(notSameKey(a, b), JSON.stringify({ by: "night", run: ctx.run, at: store.today() }));
      notSame += 1;
    } else refused.push(`"${a}" / "${b}": same is true or false`);
  }

  let kinds = 0;
  const waiting = new Set(store.unkindedCards(Number.MAX_SAFE_INTEGER, 0).cards.map((c) => c.id));
  const askable = new Set([...shownCards].filter((id) => waiting.has(id)));
  for (const item of objects(answer.kinds)) {
    const id = typeof item["id"] === "string" ? item["id"].trim() : "";
    const kind = item["kind"];
    if (!askable.has(id)) {
      refused.push(`${id.length === 0 ? "(no id)" : id}: not a card this ask showed, waiting for a kind`);
      continue;
    }
    if (typeof kind !== "string" || !(NIGHT_CARD_KINDS as readonly string[]).includes(kind)) {
      refused.push(`${id}: kind is one of ${NIGHT_CARD_KINDS.join(", ")}`);
      continue;
    }
    store.setSubjectKind(id, kind as SubjectKind);
    store.setMeta(`${SUBJECT_KIND_BY_PREFIX}${id}`, JSON.stringify({ by: "night", run: ctx.run, at: store.today(), kind }));
    askable.delete(id);
    kinds += 1;
  }

  // `at` on the store's clock (2026-10-22), the one its tags' `created_at` is
  // on: `undoTagNight` starts the next night's undo just after it.
  store.setMeta(`${TAGS_NIGHT_PREFIX}${ctx.run}`, JSON.stringify({ at: store.now(), date: store.today(), memories, tags, merged, notSame, kinds, refused: refused.length }));
  return { on: true, memories, tags, merged, notSame, kinds, refused };
}

/**
 * A NIGHT'S TAGGING TAKEN BACK: every tag the night wrote (`via: night`) at
 * or after `sinceAt` (epoch ms) — and the same tag a revision carried on from
 * it (`via: carried`, followed through the revisions that declared it,
 * `meta.updates`; review of #576) — every merge it made since, and every card kind it set on or after
 * that day that still reads as it set it — with `runs`, only the kinds those
 * runs set. Its "not the same" answers stay (they only spare a question).
 * Returns what went.
 */
export function undoNightTags(store: Store, sinceAt: number, opts: { readonly runs?: readonly string[] } = {}): { tags: number; merges: number; kinds: number } {
  let tags = 0;
  const byMemory = new Map<string, string[]>();
  for (const r of store.tagsWrittenVia("night", sinceAt)) byMemory.set(r.memoryId, [...(byMemory.get(r.memoryId) ?? []), r.tag]);
  for (const [id, words] of byMemory) {
    tags += store.untagMemory(id, words);
    // A revision that carried them on: its carried copies go too, and its
    // own revisions' after it. Followed by where a carried tag CAME FROM —
    // the memory each revision declared (`meta.updates`, `Store#revisionsOf`)
    // — not by `superseded_by`, which `remember … updates` with the default
    // `changed` leaves NULL on both rows (re-review of #576).
    const seen = new Set<string>([id]);
    const queue = store.revisionsOf(id);
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      const carried = store.tagsOf(next).filter((t) => t.via === "carried" && words.includes(t.tag)).map((t) => t.tag);
      if (carried.length === 0) continue;
      tags += store.untagMemory(next, carried);
      queue.push(...store.revisionsOf(next));
    }
  }
  let merges = 0;
  for (const m of store.tagMerges()) {
    if (m.via === "night" && m.created_at >= sinceAt && store.undoTagMerge(m.alias)) merges += 1;
  }
  let kinds = 0;
  for (const [key, value] of store.metaWithPrefix(SUBJECT_KIND_BY_PREFIX)) {
    try {
      const rec = JSON.parse(value) as { by?: unknown; at?: unknown; kind?: unknown; run?: unknown };
      const id = key.slice(SUBJECT_KIND_BY_PREFIX.length);
      if (rec.by !== "night" || typeof rec.at !== "string" || rec.at < localDate(sinceAt, store.zone())) continue;
      // Named nights (`undoTagNight`): a kind records its run, so a night
      // earlier on the same date keeps the kinds it set.
      if (opts.runs !== undefined && !opts.runs.includes(String(rec.run))) continue;
      // Only a kind still as the night set it: one changed since is someone else's now.
      if (store.row(id) === undefined || store.row(id)?.subject_kind !== rec.kind) continue;
      store.setSubjectKind(id, null);
      store.setMeta(key, JSON.stringify({ by: "undone", at: store.today() }));
      kinds += 1;
    } catch {
      /* a record that cannot be read undoes nothing */
    }
  }
  return { tags, merges, kinds };
}

/** One night's tagging as its record says (`tags.night.<run>`): when it finished, and whether the owner took it back. */
export interface TagNight {
  readonly run: string;
  /** Epoch ms the answer was applied (after its writes). */
  readonly at: number;
  readonly date: string | null;
  readonly tags: number;
  readonly merged: number;
  readonly kinds: number;
  /** The calendar date it was taken back, or null. */
  readonly undone: string | null;
}

/** Every night's tagging on record, oldest first. A record that cannot be read is left out. Reads only. */
export function tagNights(store: Store): TagNight[] {
  const out: TagNight[] = [];
  for (const [key, value] of store.metaWithPrefix(TAGS_NIGHT_PREFIX)) {
    try {
      const r = JSON.parse(value) as Record<string, unknown>;
      if (typeof r["at"] !== "number") continue;
      const n = (k: string): number => (typeof r[k] === "number" ? (r[k] as number) : 0);
      out.push({
        run: key.slice(TAGS_NIGHT_PREFIX.length),
        at: r["at"],
        date: typeof r["date"] === "string" ? r["date"] : null,
        tags: n("tags"),
        merged: n("merged"),
        kinds: n("kinds"),
        undone: typeof r["undone"] === "string" ? r["undone"] : null,
      });
    } catch {
      /* unreadable: not a night anyone can take back by name */
    }
  }
  return out.sort((a, b) => a.at - b.at || a.run.localeCompare(b.run));
}

/**
 * THE OWNER TAKES A NIGHT'S TAGGING BACK (`counterparts dream --undo-tags`,
 * 2026-10-22): `run`'s, or with none the newest not yet taken back, and —
 * because `undoNightTags` reads by time — every night after it too. Its
 * writes began after the night before it finished (a record is written once
 * its answer is applied), so that is where the undo starts. Each night it
 * reached is marked undone on its record. Null when there is no such night.
 */
export function undoTagNight(store: Store, run?: string): { readonly nights: readonly string[]; readonly tags: number; readonly merges: number; readonly kinds: number } | null {
  const nights = tagNights(store);
  const i = run === undefined ? nights.map((n) => n.undone === null).lastIndexOf(true) : nights.findIndex((n) => n.run === run);
  if (i < 0) return null;
  const sinceAt = i === 0 ? 0 : (nights[i - 1] as TagNight).at + 1;
  const reached = nights.slice(i);
  const out = undoNightTags(store, sinceAt, { runs: reached.map((n) => n.run) });
  for (const n of reached) {
    store.updateMeta(`${TAGS_NIGHT_PREFIX}${n.run}`, (cur) => {
      if (cur === undefined) return undefined;
      try {
        return JSON.stringify({ ...(JSON.parse(cur) as Record<string, unknown>), undone: store.today() });
      } catch {
        return undefined;
      }
    });
  }
  return { nights: reached.map((n) => n.run), ...out };
}

/**
 * THE TAGGING CHILD'S PROMPT: two calls to the dream tool and a short last
 * line. Composed from the store's own words, never the environment.
 */
export function tagsPrompt(input: { readonly session: string }): string {
  return [
    "You are tidying the tags of a memory store, quietly, at night. Tags are a few short words for what a memory is about — a topic, a person, a project, a place; lowercase, one to three words each; never a date, a feeling, or a word like \"memory\" or \"note\".",
    "",
    `1. Call the dream tool with phase "tags" and session: ${input.session}. It lists memories with no tags, tag pairs that look alike, and cards with no kind.`,
    `2. Call the dream tool once more with phase "tags", session: ${input.session}, and your answers:`,
    '   - `tagged`: [{"id": "<memory id>", "tags": ["...", "..."]}] — 3-5 tags each, reusing the tags already in use where they fit;',
    '   - `merges`: [{"a": "<tag>", "b": "<tag>", "same": true|false}] — same only when the two always mean one topic; when unsure, false;',
    '   - `kinds`: [{"id": "<card id>", "kind": "person"|"project"|"place"|"topic"}].',
    "   Leave out what you cannot judge. Nothing else is asked of you.",
    "3. Then end with one line saying how many you tagged, merged and sorted.",
  ].join("\n");
}
