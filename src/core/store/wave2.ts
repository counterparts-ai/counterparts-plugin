/**
 * `Store`'s reads and writes of the v14 tables (2026-10-21, wave 2's one
 * schema bump): a memory's tags and the synonym merges, a belief's support,
 * the project a folder belongs to, and what a recall turn showed. Bodies
 * only, in the shape of `reads-marks.ts`; the class keeps a delegate, and its
 * doc comment, for each, and every write enters `Store#mutate` there.
 *
 * Pre-provisioned: nothing calls these yet (lanes B–G will). Every read asks
 * `hasTable` first, so an instrument reading a v13 file (`OBSERVER_READ_FLOOR`)
 * gets "none yet" — which is what that file holds.
 */
import type { Db } from "./db.js";
import type { BeliefSupportRow, FolderProjectRow, RecallTurnRow, TagMergeRow } from "./operational.js";
import type { Store } from "./index.js";
import { emotionalIntensity, supportCredit, supportedPhysics } from "../physics/index.js";
import type { SupportFiling } from "../physics/index.js";
import { rowToPhysics } from "./operational.js";

/**
 * A tag as stored: trimmed, lowercased, inner whitespace one space. The one
 * normalization the store owns; stemming and synonyms are lane B's (`tag_merges`).
 * Empty after normalizing: not a tag.
 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, " ");
}

function ops(store: Store): Db {
  return store["ops"];
}

function has(store: Store, table: string): boolean {
  return store["hasTable"](table);
}

// ── tags ────────────────────────────────────────────────────────────────────

export function tagMemory(store: Store, memoryId: string, tags: readonly string[], via: string, at: number): number {
  if (!has(store, "memory_tags")) return 0;
  const insert = ops(store).prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag, via, created_at) VALUES (?, ?, ?, ?)");
  let added = 0;
  for (const t of new Set(tags.map(normalizeTag))) {
    if (t.length === 0) continue;
    insert.run(memoryId, t, via, at);
    added += (ops(store).get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) > 0 ? 1 : 0;
  }
  return added;
}

export function untagMemory(store: Store, memoryId: string, tags: readonly string[] | undefined): number {
  if (!has(store, "memory_tags")) return 0;
  if (tags === undefined) {
    ops(store).run("DELETE FROM memory_tags WHERE memory_id = ?", memoryId);
    return ops(store).get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
  }
  let removed = 0;
  for (const t of new Set(tags.map(normalizeTag))) {
    ops(store).run("DELETE FROM memory_tags WHERE memory_id = ? AND tag = ?", memoryId, t);
    removed += ops(store).get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
  }
  return removed;
}

export function tagsOf(store: Store, memoryId: string): { tag: string; via: string; createdAt: number }[] {
  if (!has(store, "memory_tags")) return [];
  return ops(store)
    .all<{ tag: string; via: string; created_at: number }>("SELECT tag, via, created_at FROM memory_tags WHERE memory_id = ? ORDER BY tag", memoryId)
    .map((r) => ({ tag: r.tag, via: r.via, createdAt: r.created_at }));
}

export function memoriesTagged(store: Store, tag: string, opts: { archived?: boolean } = {}): string[] {
  if (!has(store, "memory_tags")) return [];
  return ops(store)
    .all<{ memory_id: string }>(
      `SELECT t.memory_id FROM memory_tags t JOIN memories m ON m.id = t.memory_id
          WHERE t.tag = ?${opts.archived === true ? "" : " AND m.archived = 0"}
          ORDER BY t.memory_id`,
      normalizeTag(tag),
    )
    .map((r) => r.memory_id);
}

export function tagCounts(store: Store, opts: { limit?: number } = {}): { tag: string; memories: number }[] {
  if (!has(store, "memory_tags")) return [];
  return ops(store).all<{ tag: string; memories: number }>(
    `SELECT t.tag AS tag, COUNT(*) AS memories FROM memory_tags t JOIN memories m ON m.id = t.memory_id
        WHERE m.archived = 0 AND m.superseded_by IS NULL
        GROUP BY t.tag ORDER BY memories DESC, t.tag LIMIT ?`,
    opts.limit ?? -1,
  );
}

/**
 * CONCEPT EDGES, read off `memory_tags` (design §1): the tags that sit on the
 * same live memories as any of `tags`, with how many memories they share,
 * most first. A self-join on the `(tag, memory_id)` index — derived, not
 * kept, for now: a removal or an undone merge changes it with no second
 * table to keep true, and a turn's few tags cost a few index walks.
 */
export function tagNeighbours(store: Store, tags: readonly string[], opts: { limit?: number } = {}): { tag: string; together: number }[] {
  if (!has(store, "memory_tags")) return [];
  const want = [...new Set(tags.map(normalizeTag))].filter((t) => t.length > 0);
  if (want.length === 0) return [];
  const marks = want.map(() => "?").join(", ");
  return ops(store).all<{ tag: string; together: number }>(
    `SELECT b.tag AS tag, COUNT(DISTINCT a.memory_id) AS together
         FROM memory_tags a
         JOIN memory_tags b ON b.memory_id = a.memory_id AND b.tag NOT IN (${marks})
         JOIN memories m ON m.id = a.memory_id
        WHERE a.tag IN (${marks}) AND m.archived = 0 AND m.superseded_by IS NULL
        GROUP BY b.tag ORDER BY together DESC, b.tag LIMIT ?`,
    ...want,
    ...want,
    opts.limit ?? -1,
  );
}

export function recordTagMerge(store: Store, alias: string, tag: string, via: string, at: number): boolean {
  if (!has(store, "tag_merges")) return false;
  const a = normalizeTag(alias);
  const t = normalizeTag(tag);
  if (a.length === 0 || t.length === 0 || a === t) return false;
  // NO CYCLE (lane B, review of #576): a merge whose tag already reads, through
  // the merges, as the alias would close a loop. Asked inside the write's own
  // transaction, so two nights merging the pair both ways cannot both land.
  const seen = new Set<string>([t]);
  for (let next = t; ; ) {
    const row = ops(store).get<{ tag: string }>("SELECT tag FROM tag_merges WHERE alias = ?", next);
    if (row === undefined || seen.has(row.tag)) break;
    if (row.tag === a) return false;
    seen.add(row.tag);
    next = row.tag;
  }
  ops(store).run("INSERT OR REPLACE INTO tag_merges (alias, tag, via, created_at) VALUES (?, ?, ?, ?)", a, t, via, at);
  return true;
}

export function undoTagMerge(store: Store, alias: string): boolean {
  if (!has(store, "tag_merges")) return false;
  ops(store).run("DELETE FROM tag_merges WHERE alias = ?", normalizeTag(alias));
  return (ops(store).get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) > 0;
}

export function tagMerges(store: Store): TagMergeRow[] {
  if (!has(store, "tag_merges")) return [];
  return ops(store).all<TagMergeRow>("SELECT * FROM tag_merges ORDER BY alias");
}

// ── subjects ────────────────────────────────────────────────────────────────

export function subjectsOfKind(store: Store, kind: string, opts: { archived?: boolean } = {}): string[] {
  if (!store.hasColumn("memories", "subject_kind")) return [];
  return ops(store)
    .all<{ id: string }>(
      `SELECT id FROM memories WHERE subject_kind = ?${opts.archived === true ? "" : " AND archived = 0"} AND body != '' ORDER BY id`,
      kind,
    )
    .map((r) => r.id);
}

// ── belief support ──────────────────────────────────────────────────────────

export interface SupportInput {
  readonly beliefId: string;
  readonly memoryId: string;
  /** `support` or `contrary`. */
  readonly stance: "support" | "contrary";
  readonly route: string;
  /** The lived day it is filed. */
  readonly day: number;
  readonly weight: number;
}

/** One support row with WHERE IT CAME FROM — the counted memory's own day, session and folder. */
export interface SupportRead {
  readonly beliefId: string;
  readonly memoryId: string;
  readonly stance: string;
  readonly route: string;
  readonly day: number;
  readonly weight: number;
  readonly createdAt: number;
  /** The counted memory's lived birth day, session and folder (`memories`), null when it is gone. */
  readonly bornDay: number | null;
  readonly session: string | null;
  readonly scope: string | null;
}

export function fileSupport(store: Store, input: SupportInput, at: number): boolean {
  if (!has(store, "belief_support") || input.beliefId === input.memoryId) return false;
  // Only the two stances (review of #575): a word like "against" is no stance.
  if (input.stance !== "support" && input.stance !== "contrary") return false;
  ops(store).run(
    `INSERT OR IGNORE INTO belief_support (belief_id, memory_id, stance, route, day, weight, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.beliefId,
    input.memoryId,
    input.stance,
    input.route,
    input.day,
    input.weight,
    at,
  );
  return (ops(store).get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) > 0;
}

export function unfileSupport(store: Store, beliefId: string, memoryId: string): boolean {
  if (!has(store, "belief_support")) return false;
  ops(store).run("DELETE FROM belief_support WHERE belief_id = ? AND memory_id = ?", beliefId, memoryId);
  return (ops(store).get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) > 0;
}

type SupportJoin = BeliefSupportRow & { born_day: number | null; origin_session: string | null; origin_scope: string | null };

function supportRead(r: SupportJoin): SupportRead {
  return {
    beliefId: r.belief_id,
    memoryId: r.memory_id,
    stance: r.stance,
    route: r.route,
    day: r.day,
    weight: r.weight,
    createdAt: r.created_at,
    bornDay: r.born_day,
    session: r.origin_session,
    scope: r.origin_scope,
  };
}

const SUPPORT_JOIN = `SELECT s.*, m.birth_day AS born_day, m.origin_session AS origin_session, m.origin_scope AS origin_scope
     FROM belief_support s LEFT JOIN memories m ON m.id = s.memory_id`;

export function supportOf(store: Store, beliefId: string): SupportRead[] {
  if (!has(store, "belief_support")) return [];
  return ops(store).all<SupportJoin>(`${SUPPORT_JOIN} WHERE s.belief_id = ? ORDER BY s.day, s.memory_id`, beliefId).map(supportRead);
}

export function supportGivenBy(store: Store, memoryId: string): SupportRead[] {
  if (!has(store, "belief_support")) return [];
  return ops(store).all<SupportJoin>(`${SUPPORT_JOIN} WHERE s.memory_id = ? ORDER BY s.belief_id`, memoryId).map(supportRead);
}

/**
 * Where a belief's counted support is kept (lane C, physics §5.13): a box-2
 * meta row per belief, `{ sum, days }`, read beside the row
 * (`reads-memories.ts#row`) into `MemoryPhysics.support` / `supportDays`.
 * Its own place, not `uses`: a use credited by any door is never support.
 * No column for it: v14 was the wave's one bump.
 */
export const BELIEF_SUPPORT_META_PREFIX = "belief.support.";

/**
 * THE BELIEF'S SUPPORT, COUNTED AGAIN (lane C, physics §5.13): every row's
 * weight from the whole table, in filing order (`physics#supportCredit`), and
 * the belief's support, its support days and its anchor written from that
 * count (`physics#supportedPhysics`). Run inside every filing and unfiling,
 * so the belief, the table and the weights it shows never disagree. Each
 * counted memory's feeling is its strongest felt at the time
 * (`feeling_peak_lived`): a feeling a reflection records later does not make
 * its memory count more. Returns each memory's weight; empty when the table
 * or the belief is not there. ~0.3 ms a filing at 2,000 beliefs x 20 supports.
 */
export function recountSupport(store: Store, beliefId: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!has(store, "belief_support")) return out;
  const belief = store.row(beliefId);
  if (belief === undefined) return out;
  // Filing order: the day, the moment, then the order the rows went in (two in one moment keep theirs).
  const rows = ops(store).all<SupportJoin>(`${SUPPORT_JOIN} WHERE s.belief_id = ? ORDER BY s.day, s.created_at, s.rowid`, beliefId);
  const filings: SupportFiling[] = rows.map((r) => {
    const m = store.row(r.memory_id);
    const feeling = m === undefined ? 0 : emotionalIntensity({ salience: rowToPhysics(m).salience, feelingPeak: m.feeling_peak_lived ?? m.feeling_peak ?? null });
    return {
      memoryId: r.memory_id,
      stance: r.stance === "contrary" ? "contrary" : "support",
      route: r.route,
      day: r.day,
      bornDay: r.born_day,
      session: r.origin_session,
      scope: r.origin_scope,
      feeling,
    };
  });
  const credit = supportCredit(filings);
  const write = ops(store).prepare("UPDATE belief_support SET weight = ? WHERE belief_id = ? AND memory_id = ?");
  filings.forEach((f, i) => {
    const w = credit.weights[i] ?? 0;
    write.run(w, beliefId, f.memoryId);
    out.set(f.memoryId, w);
  });
  const next = supportedPhysics(rowToPhysics(belief), credit);
  ops(store).run(
    "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
    `${BELIEF_SUPPORT_META_PREFIX}${beliefId}`,
    JSON.stringify({ sum: next.support ?? 0, days: next.supportDays ?? 0 }),
  );
  ops(store).run("UPDATE memories SET last_used_day = ? WHERE id = ?", next.lastUsedDay, beliefId);
  return out;
}

// ── folders and projects ───────────────────────────────────────────────────

export function setFolderProject(store: Store, folder: string, projectId: string, via: string, at: number): void {
  if (!has(store, "folder_projects")) return;
  ops(store).run(
    "INSERT OR REPLACE INTO folder_projects (folder, project_id, via, created_at) VALUES (?, ?, ?, ?)",
    folder,
    projectId,
    via,
    at,
  );
}

export function clearFolderProject(store: Store, folder: string): boolean {
  if (!has(store, "folder_projects")) return false;
  ops(store).run("DELETE FROM folder_projects WHERE folder = ?", folder);
  return (ops(store).get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) > 0;
}

export function projectOfFolder(store: Store, folder: string): FolderProjectRow | null {
  if (!has(store, "folder_projects")) return null;
  return ops(store).get<FolderProjectRow>("SELECT * FROM folder_projects WHERE folder = ?", folder) ?? null;
}

export function folderProjects(store: Store): FolderProjectRow[] {
  if (!has(store, "folder_projects")) return [];
  return ops(store).all<FolderProjectRow>("SELECT * FROM folder_projects ORDER BY project_id, folder");
}

export function foldersOfProject(store: Store, projectId: string): string[] {
  if (!has(store, "folder_projects")) return [];
  return ops(store)
    .all<{ folder: string }>("SELECT folder FROM folder_projects WHERE project_id = ? ORDER BY folder", projectId)
    .map((r) => r.folder);
}

// ── recall turns ────────────────────────────────────────────────────────────

export interface RecallTurnInput {
  readonly sessionId: string;
  readonly turn: number;
  /** The lived day. */
  readonly day: number;
  /** How many candidates the turn weighed. */
  readonly candidates: number;
  /** The ids it showed, in order. */
  readonly shown: readonly string[];
}

export function recordRecallTurn(store: Store, input: RecallTurnInput, at: number): void {
  if (!has(store, "recall_turns")) return;
  ops(store).run(
    `INSERT OR REPLACE INTO recall_turns (session_id, turn, at, day, candidates, shown)
     VALUES (?, ?, ?, ?, ?, ?)`,
    input.sessionId,
    input.turn,
    at,
    input.day,
    input.candidates,
    JSON.stringify([...input.shown]),
  );
}

export function recallTurns(store: Store, opts: { sessionId?: string; sinceDay?: number } = {}): RecallTurnRow[] {
  if (!has(store, "recall_turns")) return [];
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.sessionId !== undefined) {
    where.push("session_id = ?");
    args.push(opts.sessionId);
  }
  if (opts.sinceDay !== undefined) {
    where.push("day >= ?");
    args.push(opts.sinceDay);
  }
  return ops(store).all<RecallTurnRow>(
    `SELECT * FROM recall_turns${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY at, session_id, turn`,
    ...args,
  );
}
