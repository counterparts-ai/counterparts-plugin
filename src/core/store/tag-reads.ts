/**
 * The night's READS of tags (wave 2 lane B, 2026-10-21): what the tags phase,
 * the topic births and the tagging ask need from `memory_tags`, `tag_merges`
 * and `memory_subjects`. Reads only, in the shape of `wave2.ts`; the class
 * keeps a delegate for each. Every read asks `hasTable` first, so a v13 file
 * read by an observer reads as "none yet".
 */
import type { Db } from "./db.js";
import type { Store } from "./index.js";

function ops(store: Store): Db {
  return store["ops"];
}

function has(store: Store, table: string): boolean {
  return store["hasTable"](table);
}

/** A live memory linked to a live named card (`memory_subjects`), with the card's name: what the night tags with it. */
export interface CardLink {
  readonly memoryId: string;
  readonly cardId: string;
  readonly name: string;
}

/**
 * Every live memory's link to a live NAMED card — not the identity core (the
 * owner's name on everything about him says nothing), not a nameless subject
 * (`ensureSelfSubject`, a topic card) — with the card's name, newest memory
 * first. The caller skips the pairs whose tag is already there. The join
 * order is pinned (`CROSS JOIN`): left to choose, SQLite walked memories ×
 * cards by the `archived` index and took 2 s on the corpus copy; links first
 * is one primary-key probe each (11 ms).
 */
export function cardLinks(store: Store): CardLink[] {
  if (!has(store, "memory_subjects")) return [];
  return ops(store)
    .all<{ memory_id: string; card_id: string; meta: string }>(
      `SELECT s.memory_id AS memory_id, c.id AS card_id, c.meta AS meta
         FROM memory_subjects s
         CROSS JOIN memories c ON c.id = s.subject_id
         CROSS JOIN memories m ON m.id = s.memory_id
        WHERE c.archived = 0 AND c.kind != 'self' AND c.body != ''
          AND m.type = 'memory' AND m.archived = 0 AND m.superseded_by IS NULL AND m.body != ''
          AND ${NOT_JOURNAL}
        ORDER BY m.birth_day DESC, s.memory_id, c.id`,
    )
    .flatMap((r) => {
      const name = nameOf(r.meta);
      return name === null ? [] : [{ memoryId: r.memory_id, cardId: r.card_id, name }];
    });
}

/**
 * NOT THE JOURNAL'S OWN ROWS: a chapter's copy or summary (a `memory` row
 * with `source = 'episode'`) is a retelling of memories that are tagged on
 * their own; tagging it too would count one moment twice in a tag's weight
 * (review of #573: the cloud's weight is `tagCounts`). The night tags
 * neither; a writer never tags one (the chapter tool takes no tags).
 */
const NOT_JOURNAL = "COALESCE(m.source, '') != 'episode'";

function nameOf(meta: string): string | null {
  try {
    const m = JSON.parse(meta) as { role?: unknown; name?: unknown } | null;
    if (m === null || m.role !== "entity" || typeof m.name !== "string" || m.name.trim().length === 0) return null;
    return m.name;
  } catch {
    return null;
  }
}

/** One tag on one live memory, with what the topic bar reads of the memory. */
export interface TagUse {
  readonly tag: string;
  readonly memoryId: string;
  readonly day: number;
  readonly session: string | null;
  /** Used awake at least once (`uses > 0`). */
  readonly used: boolean;
  /** Carries a feeling (`feelings`). */
  readonly felt: boolean;
}

/** Every tag on every live memory (not archived, not superseded), with the memory's day, session, use and feeling. */
export function tagUses(store: Store): TagUse[] {
  if (!has(store, "memory_tags")) return [];
  const felt = has(store, "feelings") ? "EXISTS (SELECT 1 FROM feelings f WHERE f.memory_id = m.id)" : "0";
  return ops(store)
    .all<{ tag: string; memory_id: string; day: number; session: string | null; uses: number; felt: number }>(
      `SELECT t.tag AS tag, t.memory_id AS memory_id, m.birth_day AS day, m.origin_session AS session,
              m.uses AS uses, ${felt} AS felt
         FROM memory_tags t JOIN memories m ON m.id = t.memory_id
        WHERE m.archived = 0 AND m.superseded_by IS NULL AND m.body != ''
        ORDER BY t.tag, t.memory_id`,
    )
    .map((r) => ({ tag: r.tag, memoryId: r.memory_id, day: r.day, session: r.session, used: r.uses > 0, felt: r.felt !== 0 }));
}

/** Whether any memory at all — live, archived or superseded — carries the tag. */
export function tagInUse(store: Store, tag: string): boolean {
  if (!has(store, "memory_tags")) return false;
  return ops(store).get<{ n: number }>("SELECT 1 AS n FROM memory_tags WHERE tag = ? LIMIT 1", tag) !== undefined;
}

/** A live memory with no tag, as the night's tagging ask shows it. */
export interface UntaggedMemory {
  readonly id: string;
  readonly title: string | null;
  readonly body: string;
  readonly day: number;
}

/**
 * Live memories with no tag OF THEIR OWN — none written, carried or given at
 * night; a card's name alone does not count (review of #576: ~1,300 named
 * memories would otherwise carry only names, and no topic word) — RECENT AND
 * STRONG FIRST: newest lived day,
 * then most used, then the highest salience they were written with. How many
 * there are in all comes beside them, for the night's report.
 */
export function untaggedMemories(store: Store, limit: number): { memories: UntaggedMemory[]; total: number } {
  if (!has(store, "memory_tags")) return { memories: [], total: 0 };
  const where = `m.type = 'memory' AND m.archived = 0 AND m.superseded_by IS NULL AND m.body != '' AND ${NOT_JOURNAL}
       AND NOT EXISTS (SELECT 1 FROM memory_tags t WHERE t.memory_id = m.id AND t.via IN ('write', 'carried', 'night'))`;
  const total = ops(store).get<{ n: number }>(`SELECT COUNT(*) AS n FROM memories m WHERE ${where}`)?.n ?? 0;
  const salience = store.hasColumn("memories", "birth_salience") ? "COALESCE(m.birth_salience, 0)" : "0";
  const memories = ops(store).all<UntaggedMemory>(
    `SELECT m.id AS id, m.title AS title, m.body AS body, m.birth_day AS day FROM memories m
      WHERE ${where}
      ORDER BY m.birth_day DESC, m.uses DESC, ${salience} DESC, m.id
      LIMIT ?`,
    Math.max(0, Math.floor(limit)),
  );
  return { memories, total };
}

/** A live named card with no subject kind yet, and a few titles of what names it. */
export interface UnkindedCard {
  readonly id: string;
  readonly name: string;
  /** Its card kind (`person`, `place`, `entity`). */
  readonly kind: string;
  readonly titles: readonly string[];
}

/** Live named cards whose `subject_kind` is unset, most-linked first, each with up to `titles` titles (or openings) of its newest memories. */
export function unkindedCards(store: Store, limit: number, titles = 4): { cards: UnkindedCard[]; total: number } {
  if (!store.hasColumn("memories", "subject_kind") || !has(store, "memory_subjects")) return { cards: [], total: 0 };
  const rows = ops(store).all<{ id: string; kind: string; meta: string; links: number }>(
    `SELECT c.id AS id, c.kind AS kind, c.meta AS meta,
            (SELECT COUNT(*) FROM memory_subjects s WHERE s.subject_id = c.id) AS links
       FROM memories c
      WHERE c.type = 'schema' AND c.archived = 0 AND c.body != '' AND c.kind != 'self' AND c.subject_kind IS NULL
      ORDER BY links DESC, c.id`,
  );
  const named = rows.flatMap((r) => {
    const name = nameOf(r.meta);
    return name === null ? [] : [{ id: r.id, kind: r.kind, name }];
  });
  const cards = named.slice(0, Math.max(0, Math.floor(limit))).map((c) => ({
    ...c,
    titles: ops(store)
      .all<{ title: string | null; body: string }>(
        `SELECT m.title AS title, m.body AS body FROM memory_subjects s JOIN memories m ON m.id = s.memory_id
          WHERE s.subject_id = ? AND m.archived = 0 AND m.body != ''
          ORDER BY m.birth_day DESC, m.id LIMIT ?`,
        c.id,
        titles,
      )
      .map((m) => (m.title ?? m.body).replace(/\s+/g, " ").slice(0, 120)),
  }));
  return { cards, total: named.length };
}

/**
 * The topic cards (`subject_kind` `topic`) by the tag each was promoted from
 * (`meta.topic`) and its merged words (`meta.topicAliases`), archived ones too — a faded topic is not born again from
 * the same tag by the tally; a new memory's write is what brings tags back.
 */
export function topicCards(store: Store): Map<string, string> {
  const out = new Map<string, string>();
  if (!store.hasColumn("memories", "subject_kind")) return out;
  for (const r of ops(store).all<{ id: string; meta: string }>("SELECT id, meta FROM memories WHERE subject_kind = 'topic' ORDER BY id")) {
    try {
      const m = JSON.parse(r.meta) as { topic?: unknown; topicAliases?: unknown } | null;
      if (typeof m?.topic === "string" && m.topic.length > 0) out.set(m.topic, r.id);
      // Its merged words too: a cluster whose head word moved is still this topic.
      if (Array.isArray(m?.topicAliases)) for (const a of m.topicAliases) if (typeof a === "string" && a.length > 0 && !out.has(a)) out.set(a, r.id);
    } catch {
      /* a card whose meta cannot be read holds no topic */
    }
  }
  return out;
}

/** The tags written by one hand (`via`) at or after `sinceAt` (epoch ms): what undoing a night reads. */
export function tagsWrittenVia(store: Store, via: string, sinceAt: number): { memoryId: string; tag: string }[] {
  if (!has(store, "memory_tags")) return [];
  return ops(store)
    .all<{ memory_id: string; tag: string }>("SELECT memory_id, tag FROM memory_tags WHERE via = ? AND created_at >= ? ORDER BY memory_id, tag", via, sinceAt)
    .map((r) => ({ memoryId: r.memory_id, tag: r.tag }));
}

/**
 * The memories that declared themselves a revision of `id` — the RESOLVED id a
 * deposit writes to its meta (`mint.ts#UPDATES_META_KEY`, `"updates"`). This
 * is where a carried tag came from (`counterpart-deposit.ts#carryTags` carries
 * only from the memory a revision declared), and it holds whether or not the
 * revision superseded anything: `remember … updates` with `how: changed`
 * leaves `superseded_by` NULL on both rows (re-review of #576). Read by meta
 * text, as the store reads `unresolved` and `recurring`.
 */
export function revisionsOf(store: Store, id: string): string[] {
  if (!/^[a-z]+_[A-Za-z0-9]+$/.test(id)) return [];
  return ops(store)
    // LIKE narrows cheaply; `json_extract` makes it exact (re-review of #576):
    // LIKE alone is case-blind, reads `_` as a wildcard, and matches an
    // `updates` nested under another key.
    .all<{ id: string }>(
      `SELECT id FROM memories WHERE type = 'memory' AND meta LIKE ? AND json_extract(meta, '$.updates') = ? ORDER BY id`,
      `%"updates":"${id}"%`,
      id,
    )
    .map((r) => r.id);
}
