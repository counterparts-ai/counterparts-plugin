/** `Store`'s reads of memories — a row, its copies and versions, the candidates and lists its readers ask for, the nearest neighbours, the claims era (bodies moved out of `store/index.ts`, 2026-10-11; the class keeps a delegate, and its doc comment, for each). */
import { calendarOverlaps, compareCalendarDates } from "../time.js";
import { LATER_FEELING_SOURCES } from "./feelings.js";
import { TUNABLES as PHYSICS_TUNABLES } from "../physics/index.js";
import { StoreError } from "./errors.js";
import {
  CLAIMS_ERA_CUTOFF_KEY,
  rowToPhysics,
  RECURRING_META,
  CLAIMS_ERA_RECORDED_KEY,
  ERA_WRITTEN_AT_META,
  reachExempt,
} from "./operational.js";
import type { MemoryRow, FeelingPeak, VersionRow, TombstoneRow, RemovalRow } from "./operational.js";
import type { ProseDoc } from "./prose.js";
import { readNeighbours, allVectors, rankAgainst, NEIGHBOURS_KEPT, writeNeighbours } from "./cache.js";
import { recurrenceOfRow } from "./shapes.js";
import type {
  StoredMemory,
  DatedMemory,
  RecurringMemory,
  RecallRow,
  Tombstone,
  RemovalNote,
} from "./shapes.js";
import { aboutMarkOf, CORE_ABOUT_MARKS, STATUSES } from "./marks.js";
import type { MemoryStatus } from "./marks.js";
import type { Store } from "./index.js";
import { BELIEF_SUPPORT_META_PREFIX } from "./wave2.js";

/** `LATER_FEELING_SOURCES` as a SQL list — the sources `feeling_peak_lived` leaves out. Constants only, never input. */
const LATER_SQL = LATER_FEELING_SOURCES.map((x) => `'${x}'`).join(", ");

/** The sources of a feeling recorded after the memory was written — what `feeling_peak` reads as how it sits now (2026-10-11). Constants only. */
const RECORDED_LATER_SQL = ["dream", ...LATER_FEELING_SOURCES].map((x) => `'${x}'`).join(", ");

const MAX_CHAIN = 32;

/** A memory row the NIGHTLY RUN wrote — a dream's gist or merge, a reflection's
 *  entry — as SQL (temporal contiguity's reads, review of #281 finding 1). */
const NIGHTLY_SQL = `(COALESCE(source, '') IN ('dreamed', 'reflection')
  OR COALESCE(origin_ref, '') LIKE 'dream:%' OR COALESCE(origin_ref, '') LIKE 'reflection:%')`;

/**
 * Does this store have `memories.birth_route` (v14)? Asked at most until the
 * answer is yes, then never again for that store: `row()` is the hottest read
 * in the code, and an uncached `PRAGMA table_info` there cost a 40k-row sleep
 * scan about a second (review of #575; `test/beliefs-support.test.ts` counts
 * the PRAGMAs). Only a yes is kept — a v13 file read before its upgrade asks
 * again, and gets its yes once the upgrade has run. Nothing removes the column.
 */
const birthRouteSeen = new WeakSet<Store>();
function hasBirthRoute(store: Store): boolean {
  if (birthRouteSeen.has(store)) return true;
  if (!store.hasColumn("memories", "birth_route")) return false;
  birthRouteSeen.add(store);
  return true;
}

export function row(store: Store, id: string): (MemoryRow & FeelingPeak) | undefined {
  // v9: `feeling_peak_lived` is the same peak WITHOUT the feelings a
  // reflection recorded later — the one the core's fast lane reads unless
  // `CORE_FAST_ACCEPTS_REFLECTED_FEELING` is set (physics §5.3). Since
  // 2026-10-02 an awake feeling-now (`awake`) is left out the same way
  // (`LATER_FEELING_SOURCES`).
  // v13 (2026-10-10): `today_date`, the store's calendar today, so the
  // dated hold (`operational.ts#datedHold`) reads off this one statement.
  // The old-claims era's cutoff rides the same way (`eraClaimOf`).
  // 2026-10-11 (Group 2, Mike): `feeling_peak` is the LATEST recording's —
  // the strongest feeling of the newest moment a feeling was recorded
  // LATER at (a feeling-now, a dream's or a reflection's: `RECORDED_LATER_SQL`;
  // a recording's feelings share one moment, so a lone strong one is not
  // averaged down by quieter ones beside it). That is how the memory sits
  // now: an apology, new information, the sting turned to clarity lowers
  // its weight. With none recorded later, the strongest felt at the time —
  // so a merge, which carries each original's feelings at their own
  // moments, reads its strongest, not its newest original's (review of
  // #420). The first is never rewritten; recall by feeling still reads every
  // one. The fast lane's `feeling_peak_lived` stays the strongest felt at
  // the time.
  return store["ops"].get<MemoryRow & FeelingPeak>(
    `SELECT m.*,
              (SELECT value FROM meta WHERE key = 'lastActiveDate') AS today_date,
              (SELECT value FROM meta WHERE key = '${CLAIMS_ERA_CUTOFF_KEY}') AS claims_era_cutoff,
              COALESCE(
                (SELECT MAX(f.strength) FROM feelings f
                  WHERE f.memory_id = m.id AND f.source IN (${RECORDED_LATER_SQL})
                    AND f.created_at = (SELECT MAX(g.created_at) FROM feelings g WHERE g.memory_id = m.id AND g.source IN (${RECORDED_LATER_SQL}))),
                (SELECT MAX(f.strength) FROM feelings f WHERE f.memory_id = m.id)) AS feeling_peak,
              (SELECT MAX(f.strength) FROM feelings f
                WHERE f.memory_id = m.id AND (f.source IS NULL OR f.source NOT IN (${LATER_SQL}))) AS feeling_peak_lived,
              ${
                // A belief's counted support (lane C), on a store with the v14
                // column; a v13 file read before its upgrade has none.
                hasBirthRoute(store)
                  ? `CASE WHEN m.birth_route IS NOT NULL THEN (SELECT value FROM meta WHERE key = '${BELIEF_SUPPORT_META_PREFIX}' || m.id) END`
                  : "NULL"
              } AS belief_support
         FROM memories m WHERE m.id = ?`,
    id,
  );
}

export function read(store: Store, id: string): StoredMemory {
  const row = store["requireRow"](id);
  const doc = store["docOf"](row);
  if (row.archived === 1) {
    // §5 G13: a read-back of archived content is an event, so "did the archival
    // mechanisms ever pay for themselves" is an answerable question in v2.
    store["emit"]("store.archived.read", id, { reason: row.archived_reason });
  }
  return {
    doc,
    physics: rowToPhysics(row),
    band: row.band,
    bandDay: row.band_day,
    archived: row.archived === 1,
    archivedReason: row.archived_reason,
    supersededBy: row.superseded_by,
    revision: row.revision,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    model: row.model,
    about: aboutMarkOf(row.about),
    aboutBy: row.about_by ?? null,
  };
}

export function resolve(store: Store, id: string): string {
  let current = id;
  const seen = new Set<string>();
  for (let depth = 0; depth <= MAX_CHAIN; depth++) {
    if (seen.has(current)) throw new StoreError("ID_CYCLE", { id, at: current });
    seen.add(current);
    if (store["isDenied"](current)) return current;
    const row = store.row(current);
    if (row === undefined) {
      throw new StoreError(current === id ? "ID_UNKNOWN" : "ID_DANGLING", { id, at: current });
    }
    if (row.superseded_by === null) return current;
    current = row.superseded_by;
  }
  throw new StoreError("ID_CHAIN_TOO_DEEP", { id, max: MAX_CHAIN });
}

export function copiesOf(store: Store, refs: readonly string[]): Map<string, { id: string; about: string | null }[]> {
  const out = new Map<string, { id: string; about: string | null }[]>();
  const unique = [...new Set(refs)];
  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK);
    const rows = store["ops"].all<{ id: string; origin_ref: string; about: string | null }>(
      `SELECT id, origin_ref, about FROM memories
          WHERE type = 'memory' AND archived = 0 AND origin_ref IN (${part.map(() => "?").join(", ")})
          ORDER BY id`,
      ...part,
    );
    for (const r of rows) {
      const held = out.get(r.origin_ref) ?? [];
      held.push({ id: r.id, about: r.about });
      out.set(r.origin_ref, held);
    }
  }
  return out;
}

export function workCandidates(store: Store, scope: string, limit: number): string[] {
  // NOT A CHAPTER'S SUMMARY (2026-10-25, review of Y1): one carries its
  // chapter's folder since Y1, and one marked `work` would take a slot here
  // only for `workHere` to drop it as a journal copy (`meta.episodeId`).
  return store["ops"]
    .all<{ id: string }>(
      `SELECT id FROM memories
          WHERE type = 'memory' AND archived = 0 AND origin_scope = ?
            AND band != 'identity' AND event_date IS NULL AND body != ''
            AND COALESCE(source, '') != 'episode'
            AND (about = 'work' OR (about IS NULL AND kind IN ('skill', 'fact', 'entity', 'place')))
          ORDER BY MAX(birth_day, last_used_day) DESC, id
          LIMIT ?`,
      scope,
      Math.max(0, Math.floor(limit)),
    )
    .map((r) => r.id);
}

export function craftCandidates(store: Store, limit: number, sinceDay: number): string[] {
  if (!Number.isFinite(sinceDay)) return [];
  return store["ops"]
    .all<{ id: string }>(
      `SELECT id FROM memories
          WHERE type = 'memory' AND archived = 0 AND kind = 'skill'
            AND (about IS NULL OR about = 'world') AND birth_day >= ?
            AND band != 'identity' AND event_date IS NULL AND body != ''
          ORDER BY MAX(birth_day, last_used_day) DESC, id
          LIMIT ?`,
      Math.floor(sinceDay),
      Math.max(0, Math.floor(limit)),
    )
    .map((r) => r.id);
}

/**
 * CO-USE, for the night's project proposal (2026-10-21, lane G): for each
 * memory born on or after lived day `sinceDay` in a directory, its folder,
 * its lived birth day, and each subject it names (`memory_subjects`; null
 * when none). Archived rows count: what was written there that day is the
 * evidence, not whether it is still held. Columns only.
 */
export function folderCoUse(store: Store, sinceDay: number): { id: string; scope: string; day: number; subject: string | null }[] {
  return store["ops"].all<{ id: string; scope: string; day: number; subject: string | null }>(
    `SELECT m.id AS id, m.origin_scope AS scope, m.birth_day AS day, s.subject_id AS subject
       FROM memories m LEFT JOIN memory_subjects s ON s.memory_id = m.id
      WHERE m.type = 'memory' AND m.origin_scope LIKE '/%' AND m.birth_day >= ? AND m.body != ''`,
    Math.floor(sinceDay),
  );
}

export function planCandidates(store: Store, input: {
  readonly scopes: readonly string[];
  readonly after: number;
  readonly statuses: readonly MemoryStatus[];
  readonly limit: number;
}): string[] {
  const scopes = input.scopes.filter((s) => s.length > 0);
  const statuses = input.statuses.filter((s) => (STATUSES as readonly string[]).includes(s));
  if (scopes.length === 0 || input.limit <= 0) return [];
  const marks = (n: number): string => Array.from({ length: n }, () => "?").join(", ");
  const status = statuses.length === 0 ? "" : `status IN (${marks(statuses.length)}) OR `;
  return store["ops"]
    .all<{ id: string }>(
      `SELECT id FROM memories
          WHERE type = 'memory' AND archived = 0 AND superseded_by IS NULL AND body != ''
            AND source = 'authored' AND origin_scope IN (${marks(scopes.length)}) AND created_at > ?
            AND (${status}meta LIKE '%"unresolved":true%')
          ORDER BY created_at DESC, id
          LIMIT ?`,
      ...scopes,
      input.after,
      ...statuses,
      Math.max(0, Math.floor(input.limit)),
    )
    .map((r) => r.id);
}

export function datedMemories(store: Store, from: string, to: string, opts: { archived?: boolean } = {}): DatedMemory[] {
  const rows = store["ops"].all<{ id: string; event_date: string }>(
    `SELECT id, event_date FROM memories
        WHERE event_date IS NOT NULL AND event_date <= ?${opts.archived === true ? "" : " AND archived = 0"}`,
    `${to}~`,
  );
  return rows
    .filter((r) => calendarOverlaps(r.event_date, from, to))
    .sort((a, b) => compareCalendarDates(a.event_date, b.event_date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({ id: r.id, eventDate: r.event_date }));
}

export function recurringMemories(store: Store, opts: { archived?: boolean } = {}): RecurringMemory[] {
  const rows = store["ops"].all<{ id: string; event_date: string; meta: string }>(
    `SELECT id, event_date, meta FROM memories
        WHERE event_date IS NOT NULL AND meta LIKE '%"${RECURRING_META}":"%'${opts.archived === true ? "" : " AND archived = 0"}
        ORDER BY id`,
  );
  const out: RecurringMemory[] = [];
  for (const r of rows) {
    const rule = recurrenceOfRow(r);
    if (rule !== null) out.push({ id: r.id, eventDate: r.event_date, recurring: rule });
  }
  return out;
}

export function recallRows(store: Store): RecallRow[] {
  const v12 = store.hasColumn("memories", "occurred_on");
  return store["ops"].all<RecallRow>(
    `SELECT id, type, kind, title, learned_on, created_at, updated_at,
              ${v12 ? "occurred_on, said_by, status" : "NULL AS occurred_on, NULL AS said_by, NULL AS status"},
              source, origin_session, origin_scope, origin_ref,
              CASE WHEN type = 'memory' THEN NULL ELSE meta END AS meta
         FROM memories
        WHERE archived = 0 AND superseded_by IS NULL AND NOT (body = '' AND content_hash = '')
        ORDER BY id`,
  );
}

export function memoriesWrittenSince(store: Store, at: number): { id: string; session: string; at: number; bornDay: number; nightly: boolean }[] {
  return store["ops"]
    .all<{ id: string; origin_session: string; created_at: number; birth_day: number; nightly: number }>(
      `SELECT id, origin_session, created_at, birth_day, ${NIGHTLY_SQL} AS nightly FROM memories
          WHERE type = 'memory' AND created_at >= ? AND origin_session IS NOT NULL
            AND archived = 0 AND superseded_by IS NULL
          ORDER BY created_at, rowid`,
      at,
    )
    .map((r) => ({ id: r.id, session: r.origin_session, at: r.created_at, bornDay: r.birth_day, nightly: r.nightly === 1 }));
}

/**
 * THE DAY'S LIVED RETURNS, row by row (2026-10-19, feedback-loop part E): one
 * per memory, day and source, at or after `sinceAt` (epoch ms) on lived days
 * from `sinceDay` — every source but the night's own (`dream`, `reflection`)
 * and the imported history (`legacy`). A denylist, so a source a later build
 * adds for waking use is read without an edit here. Ids, sources and the
 * session that earned it; nothing else.
 */
export function livedReturnsSince(store: Store, filter: { sinceAt?: number; sinceDay?: number } = {}): { memoryId: string; source: string; session: string | null }[] {
  return store["ops"]
    .all<{ memory_id: string; source: string; session: string | null }>(
      `SELECT memory_id, source, session FROM returns
          WHERE at >= ? AND day >= ? AND source NOT IN ('dream', 'reflection', 'legacy')
          ORDER BY at, memory_id`,
      filter.sinceAt ?? 0,
      filter.sinceDay ?? -2_147_483_648,
    )
    .map((r) => ({ memoryId: r.memory_id, source: r.source, session: r.session }));
}

export function memoryCountsByScopeSince(store: Store, at: number): { scope: string; count: number }[] {
  return store["ops"]
    .all<{ origin_scope: string; n: number }>(
      `SELECT origin_scope, COUNT(*) AS n FROM memories
          WHERE type = 'memory' AND created_at IS NOT NULL AND created_at >= ? AND origin_scope IS NOT NULL AND origin_scope != ''
            AND archived = 0 AND superseded_by IS NULL AND NOT ${NIGHTLY_SQL}
          GROUP BY origin_scope
          ORDER BY n DESC, origin_scope`,
      at,
    )
    .map((r) => ({ scope: r.origin_scope, count: r.n }));
}

export function memoryTitlesByScopeSince(
  store: Store,
  at: number,
  opts: { readonly until?: number; readonly perScope?: number; readonly sessions?: readonly string[] } = {},
): { id: string; scope: string; session: string | null; title: string; at: number; tier: number; about: string | null; kind: string }[] {
  const per = Math.max(0, Math.floor(opts.perScope ?? 2));
  if (per === 0) return [];
  // BY SESSION (2026-10-20): the other sessions open in one folder, each its
  // own partition, so a busy one cannot take another's titles.
  const sessions = opts.sessions === undefined ? null : [...new Set(opts.sessions.filter((x) => x.length > 0))];
  if (sessions !== null && sessions.length === 0) return [];
  const by = sessions === null ? "origin_scope" : "origin_session";
  const only = sessions === null ? "" : `AND origin_session IN (${sessions.map(() => "?").join(", ")})`;
  const status = store.hasColumn("memories", "status") ? "status" : "NULL";
  const personal = CORE_ABOUT_MARKS.map((m) => `'${m}'`).join(", ");
  const marked = STATUSES.map((m) => `'${m}'`).join(", ");
  return store["ops"]
    .all<{ id: string; origin_scope: string; origin_session: string | null; head: string; created_at: number; tier: number; about: string | null; kind: string }>(
      `SELECT id, origin_scope, origin_session, head, created_at, tier, about, kind FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY ${by} ORDER BY tier, created_at DESC, id) AS rank FROM (
           SELECT id, origin_scope, origin_session, created_at, about, kind,
                  COALESCE(NULLIF(TRIM(title), ''), SUBSTR(body, 1, 240)) AS head,
                  CASE WHEN ${status} IN (${marked}) THEN 0
                       WHEN about = 'work' OR (about IS NULL AND kind IN ('skill', 'fact', 'entity', 'place')) THEN 1
                       ELSE 2 END AS tier
             FROM memories
            WHERE type = 'memory' AND created_at IS NOT NULL AND created_at >= ? AND created_at < ?
              AND origin_scope IS NOT NULL AND origin_scope != '' ${only}
              AND archived = 0 AND superseded_by IS NULL AND body != ''
              AND band != 'identity' AND event_date IS NULL AND COALESCE(about, '') NOT IN (${personal})
              AND COALESCE(source, '') != 'episode' AND COALESCE(origin_ref, '') NOT LIKE 'epi\\_%' ESCAPE '\\'
              AND meta NOT LIKE '%"episodeId"%' AND NOT ${NIGHTLY_SQL}
              AND meta NOT LIKE '%"unresolved":true%' AND meta NOT LIKE '%"secondHand":true%'
         ) WHERE tier < 2
       ) WHERE rank <= ?
       ORDER BY origin_scope, rank`,
      at,
      opts.until ?? Number.MAX_SAFE_INTEGER,
      ...(sessions ?? []),
      per * 4,
    )
    .map((r) => ({ id: r.id, scope: r.origin_scope, session: r.origin_session, title: r.head, at: r.created_at, tier: r.tier, about: r.about, kind: r.kind }));
}

/**
 * The meta key `Store#reinforce` writes on an OPEN memory at every credited
 * use that is not a glimpse (2026-10-22, the review of #592, G1): the lived
 * day of its last real use — a rating of 1–3, `drewOn`, a quote, a claim, an
 * expansion. Not a column: meta is JSON, so no schema bump (as #591's
 * `build`). Read by `openTouchedSql`.
 */
export const OPEN_USED_DAY_META = "usedDay";

/**
 * WHEN AN OPEN THREAD WAS LAST TOUCHED, as SQL over `memories m` (2026-10-22,
 * open threads mean someone owes an answer; the review of #592, F4 and G1).
 * The latest of:
 *
 *   - its BIRTH;
 *   - its last credited USE that was more than a glimpse: `meta.usedDay`
 *     (`OPEN_USED_DAY_META`, written at the one place a use is credited,
 *     `Store#reinforce`, for every use but the `shown` glimpse). The returns
 *     table alone cannot say it: a real use on a day a reflection's return
 *     already counted is refused a return of its own, so a glimpse the next
 *     day would hide it. For the history before `usedDay` was written, the
 *     returns-based read stands beside it: `last_used_day`, unless that day's
 *     credit was a glimpse (a `shown` return row that day), then the newest
 *     `awake` / `engaged` / `ontopic` return. A rating of 0 credits nothing.
 *     The glimpse still restarts the memory's FADE (Mike, 10-19); only the
 *     carry ignores it (the coordinator's call, 10-22, lightly held). With
 *     `glimpses` (`SELF_TUNABLES.OPEN_CARRY_GLIMPSE_TOUCH`, the revert) every
 *     credited use counts: `last_used_day` as it is;
 *   - its last REVISION (`versions.version_day` — any `revise`: an `updates`
 *     that leaves it open, a reopen; kept 90 lived days, longer than any
 *     carry window).
 *
 * Not a dream's replay and not a reflection's return (a reflection that asks
 * about a stale thread cites it). Being listed under "Still open" or in the
 * reflection's `staleOpen` writes none of these.
 */
function openTouchedSql(glimpses: boolean): string {
  const used = glimpses
    ? "m.last_used_day"
    : `CASE WHEN EXISTS (SELECT 1 FROM returns g WHERE g.memory_id = m.id AND g.day = m.last_used_day AND g.source = 'shown')
           THEN COALESCE((SELECT MAX(u.day) FROM returns u WHERE u.memory_id = m.id AND u.source IN ('awake', 'engaged', 'ontopic')), m.birth_day)
           ELSE m.last_used_day END`;
  return `MAX(m.birth_day,
      ${used},
      COALESCE(CASE WHEN json_valid(m.meta) THEN CAST(json_extract(m.meta, '$.${OPEN_USED_DAY_META}') AS INTEGER) END, m.birth_day),
      COALESCE((SELECT MAX(v.version_day) FROM versions v WHERE v.memory_id = m.id), m.birth_day))`;
}

/**
 * THE OPEN THREADS AND WHEN EACH WAS LAST TOUCHED (2026-10-22): every live
 * memory the loose `unresolved` match finds (`openThreadIds`'s match,
 * answered by `memories_open`), with the lived day it was last touched
 * (`openTouchedSql`) and the two facts the carry rule reads
 * (`self/identity.ts#openCarry`, which also decides which are threads at all).
 */
export function openThreadTouches(store: Store, opts: { glimpses?: boolean } = {}): { id: string; touchedDay: number; dated: boolean; asked: boolean }[] {
  return store["ops"]
    .all<{ id: string; touched: number; event_date: string | null; status: string | null }>(
      `SELECT m.id AS id, m.event_date AS event_date, m.status AS status, ${openTouchedSql(opts.glimpses === true)} AS touched
         FROM memories m
        WHERE m.type = 'memory' AND m.archived = 0 AND m.meta LIKE '%"unresolved":true%'
        ORDER BY m.birth_day, m.id`,
    )
    .map((r) => ({ id: r.id, touchedDay: r.touched, dated: r.event_date !== null, asked: r.status === "asked" }));
}

/**
 * THIS SESSION'S OWN OPEN THREADS (2026-10-22; the review of #592, F1): the
 * open memories it WROTE (`origin_session`) or USED — a return credited to
 * it of a real use, `awake` (a rating of 2–3, a quote, an open used, a
 * claim) or `engaged` (`drewOn`). Not a glimpse (`shown`, a footnote left
 * unrated) nor a rating of 1 (`ontopic`, "not needed"): another folder's open
 * item only shown here is not this session's to close. The most recently
 * touched first (`openTouchedSql`), at most `limit`. Title, else its first
 * line. The caller decides which are threads (`self/identity.ts#openThread`).
 */
export function openThreadsOfSession(store: Store, session: string, limit: number): { id: string; title: string }[] {
  if (session.length === 0 || !(limit > 0)) return [];
  return store["ops"]
    .all<{ id: string; title: string | null; body: string }>(
      `SELECT m.id AS id, m.title AS title, m.body AS body
         FROM memories m
        WHERE m.type = 'memory' AND m.archived = 0 AND m.superseded_by IS NULL
          AND m.meta LIKE '%"unresolved":true%' AND NOT ${NIGHTLY_SQL}
          AND (m.origin_session = ?
               OR m.id IN (SELECT r.memory_id FROM returns r WHERE r.session = ? AND r.source IN ('awake', 'engaged')))
        ORDER BY ${openTouchedSql(false)} DESC, COALESCE(m.created_at, 0) DESC, m.id
        LIMIT ?`,
      session,
      session,
      Math.floor(limit),
    )
    .map((r) => ({ id: r.id, title: (r.title ?? "").trim() || (r.body.split("\n").find((l) => l.trim().length > 0) ?? "").trim() }));
}

export function memoriesOfSession(store: Store, session: string): { id: string; session: string; at: number; bornDay: number }[] {
  return store["ops"]
    .all<{ id: string; origin_session: string; created_at: number; birth_day: number }>(
      `SELECT id, origin_session, created_at, birth_day FROM memories
          WHERE type = 'memory' AND origin_session = ? AND created_at IS NOT NULL
            AND archived = 0 AND superseded_by IS NULL AND NOT ${NIGHTLY_SQL}
          ORDER BY created_at, rowid`,
      session,
    )
    .map((r) => ({ id: r.id, session: r.origin_session, at: r.created_at, bornDay: r.birth_day }));
}

/**
 * THE IDS ONE SESSION WROTE, for ambient recall's echo skip (2026-10-19,
 * feedback-loop part C): live memories with this `origin_session`, born at or
 * after `sinceAt` (epoch ms) when given — settled-over or not, since either
 * is in the conversation that wrote it. `fromDay` bounds the read on the
 * birth index (`memories_birth`) — a caller that knows the window's lived
 * days passes it, and the prompt never scans the table. The nightly run's
 * rows are left out (they carry the launching session's id; the session did
 * not write them). Ids only.
 */
export function sessionMemoryIds(store: Store, session: string, opts: { sinceAt?: number; fromDay?: number } = {}): string[] {
  return store["ops"]
    .all<{ id: string }>(
      `SELECT id FROM memories
          WHERE archived = 0 AND birth_day >= ? AND type = 'memory' AND origin_session = ?
            AND created_at IS NOT NULL AND created_at >= ?
            AND NOT ${NIGHTLY_SQL}`,
      opts.fromDay ?? -2_147_483_648,
      session,
      opts.sinceAt ?? 0,
    )
    .map((r) => r.id);
}

export function readVersion(store: Store, id: string, seq: number): ProseDoc {
  // The version row survives a removal as a lineage pointer with its content
  // pointers blanked; reading it is refused by name, never by ENOENT.
  store["refuseIfDenied"](id);
  const row = store["ops"].get<VersionRow>(
    "SELECT * FROM versions WHERE memory_id = ? AND seq = ?",
    id,
    seq,
  );
  if (row === undefined) throw new StoreError("VERSION_UNKNOWN", { id, seq });
  store["emit"]("store.version.read", id, { seq, reason: row.reason });
  return store["versionDoc"](id, row);
}

export function tombstones(store: Store): Tombstone[] {
  const rows = store["ops"].all<
    TombstoneRow & { last_stage: string | null; row_survives: number }
  >(
    `SELECT t.*,
              (SELECT r.stage FROM removal_record r
                WHERE r.memory_id = t.memory_id ORDER BY r.seq DESC LIMIT 1) AS last_stage,
              (SELECT COUNT(*) FROM memories m WHERE m.id = t.memory_id) AS row_survives
         FROM removal_tombstone t
        ORDER BY t.memory_id`,
  );
  return rows.map((r) => ({
    id: r.memory_id,
    type: r.type,
    kind: r.kind,
    band: r.band,
    wasProtected: r.protected === 1,
    wasPromotedIdentity: r.promoted_identity === 1,
    supersededBy: r.superseded_by,
    stage: (r.last_stage ?? "dark") as RemovalNote["stage"],
    at: r.at,
    rowSurvives: r.row_survives > 0,
    chased: {
      versions: r.versions,
      edges: r.edges,
      prospective: r.prospective,
      gateRows: r.gate_rows,
    },
  }));
}

export function removalRecord(store: Store, id?: string): RemovalRow[] {
  const rows =
    id === undefined
      ? store["ops"].all<RemovalRow>("SELECT * FROM removal_record ORDER BY seq")
      : store["ops"].all<RemovalRow>(
          "SELECT * FROM removal_record WHERE memory_id = ? ORDER BY seq",
          id,
        );
  store["emit"]("store.removalRecord.read", id, { rows: rows.length });
  return rows;
}

export function newMemoryIds(store: Store, filter: { sinceAt: number | null; sinceDay: number; limit?: number; beforeDay?: number }): string[] {
  // Nor a dream's own MERGES (origin `dream:<id>`): a merged memory is a
  // rewording of what a dream already saw, and counting it as new would let
  // one dream's output raise the next day's ask by itself (review of #251).
  const base = `SELECT id FROM memories
                   WHERE type = 'memory' AND archived = 0 AND superseded_by IS NULL AND protected = 0
                     AND (source IS NULL OR source != 'dreamed')
                     AND (origin_ref IS NULL OR origin_ref NOT LIKE 'dream:%')`;
  const order = "ORDER BY COALESCE(created_at, 0) DESC, birth_day DESC, id LIMIT ?";
  // SQLite reads a negative LIMIT as none.
  const limit = filter.limit ?? -1;
  const rows =
    filter.sinceAt === null
      ? filter.beforeDay === undefined
        ? store["ops"].all<{ id: string }>(`${base} AND birth_day >= ? ${order}`, filter.sinceDay, limit)
        : store["ops"].all<{ id: string }>(`${base} AND birth_day >= ? AND birth_day < ? ${order}`, filter.sinceDay, filter.beforeDay, limit)
      : store["ops"].all<{ id: string }>(
          `${base} AND (created_at > ? OR (created_at IS NULL AND birth_day > ?)) ${order}`,
          filter.sinceAt,
          filter.sinceDay,
          limit,
        );
  return rows.map((r) => r.id);
}

export function writeFieldShare(store: Store, since: number | null): { written: number; occurredOn: number; saidBy: number; status: number; all: number } | null {
  if (!store.hasColumn("memories", "occurred_on")) return null;
  const row = store["ops"].get<{ written: number; occurred_on: number; said_by: number; status: number; all_three: number }>(
    `SELECT COUNT(*) AS written,
              COALESCE(SUM(occurred_on IS NOT NULL), 0) AS occurred_on,
              COALESCE(SUM(said_by IS NOT NULL), 0) AS said_by,
              COALESCE(SUM(status IS NOT NULL), 0) AS status,
              COALESCE(SUM(occurred_on IS NOT NULL AND said_by IS NOT NULL AND status IS NOT NULL), 0) AS all_three
         FROM memories
        WHERE type = 'memory' AND body != ''
          AND (source = 'dreamed' OR (source = 'authored' AND (origin_ref IS NULL OR origin_ref NOT LIKE 'dream:%')))
          AND (? IS NULL OR created_at >= ?)`,
    since,
    since,
  );
  return {
    written: row?.written ?? 0,
    occurredOn: row?.occurred_on ?? 0,
    saidBy: row?.said_by ?? 0,
    status: row?.status ?? 0,
    all: row?.all_three ?? 0,
  };
}

export function neighbourReader(store: Store): (id: string, limit: number) => string[] | null {
  let table: { id: string; vec: Float32Array | number[] }[] | null = null;
  return (id, limit) => {
    const vec = store.vectorOf(id);
    if (vec === null) return null;
    // A vector this handle may not rank against ranks nothing — as
    // `nearestTo` answered here before: an empty list, not the word fallback.
    if (!store["rankable"](vec.length, "neighbourReader")) return [];
    const stored = readNeighbours(store["cache"], id, limit);
    // A stored list shorter than asked is still the whole list when the
    // table was that small; a short list from a store that has grown since
    // is not wrong either — what it lacks is NEWER than the memory, which
    // the dream does not show as a neighbour.
    if (stored !== null) return stored.map((h) => h.id);
    table ??= allVectors(store["cache"]);
    const hits = rankAgainst(table, vec, NEIGHBOURS_KEPT + 1).filter((h) => h.id !== id);
    if (!store.observer) {
      try {
        writeNeighbours(store["cache"], id, hits);
      } catch {
        /* box 3 is best-effort: the list is recomputed next time */
      }
    }
    return hits.slice(0, limit).map((h) => h.id);
  };
}

export function claimsEra(store: Store): { cutoff: number | null; recorded: number | null; affected: number; down: number; up: number } {
  const num = (v: string | undefined): number | null => {
    const n = v === undefined || v === "" ? Number.NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const cutoff = num(store.getMeta(CLAIMS_ERA_CUTOFF_KEY));
  const recorded = num(store.getMeta(CLAIMS_ERA_RECORDED_KEY));
  let down = 0;
  let up = 0;
  if (cutoff !== null) {
    for (const { id } of store["ops"].all<{ id: string }>(
      `SELECT id FROM memories WHERE archived = 0 AND type = 'memory' AND claimed IS NOT NULL
           AND (created_at IS NULL OR created_at < ? OR meta LIKE '%"${ERA_WRITTEN_AT_META}"%')`,
      cutoff,
    )) {
      const row = store.row(id);
      if (row === undefined || reachExempt(row) || row.claimed === null) continue;
      const era = rowToPhysics(row).eraClaim;
      if (typeof era !== "number") continue;
      if (era < row.claimed) down += 1;
      else up += 1;
    }
  }
  return { cutoff, recorded, affected: down + up, down, up };
}

export function belowReachCount(store: Store): number {
  const ranking = store.rankingAll();
  let n = 0;
  for (const r of store["ops"].all<MemoryRow>("SELECT * FROM memories WHERE archived = 0 AND type != 'episode'")) {
    if (reachExempt(r)) continue;
    const rk = ranking.get(r.id);
    if (rk !== undefined && rk.band !== "identity" && rk.strength < PHYSICS_TUNABLES.REACH) n += 1;
  }
  return n;
}

export function returnCounts(store: Store, filter: { sinceAt?: number; sinceDay?: number } = {}): {
    awake: number;
    dream: number;
    /** v9: returns a reflection counted (also lane returns, beside `awake`). */
    reflection: number;
    /** Memories with any return — not counting a glimpse or a rating of 1
     *  alone (2026-10-19: shown is not "came back"). */
    memories: number;
  } {
  const r = store["ops"].get<{ awake: number | null; dream: number | null; reflection: number | null; memories: number | null }>(
    `SELECT SUM(CASE WHEN source = 'awake' THEN 1 ELSE 0 END) AS awake,
              SUM(CASE WHEN source = 'dream' THEN 1 ELSE 0 END) AS dream,
              SUM(CASE WHEN source = 'reflection' THEN 1 ELSE 0 END) AS reflection,
              COUNT(DISTINCT CASE WHEN source NOT IN ('legacy', 'shown', 'ontopic') THEN memory_id END) AS memories
         FROM returns WHERE at >= ? AND day >= ? AND source != 'legacy'`,
    filter.sinceAt ?? 0,
    filter.sinceDay ?? -2_147_483_648,
  );
  return { awake: r?.awake ?? 0, dream: r?.dream ?? 0, reflection: r?.reflection ?? 0, memories: r?.memories ?? 0 };
}
