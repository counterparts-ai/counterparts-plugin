/**
 * What the sidebar reads, turned into its own terms: the dashboard's event
 * feed (which mechanisms each event proves, and whose it is), the recall block
 * the classic UserPromptSubmit hook injects, a `recall` facts answer, the
 * memory tools' calls this session, a dream, and a mechanism's recent firings.
 * Pure: no `$`.
 *
 * WHICH EVENTS ARE A MECHANISM FIRING is the dashboard's table
 * (`src/adapters/mechanism-evidence.ts`, MECHANISM_EVIDENCE): an event name,
 * sometimes a condition on its payload, and the mechanism it proves. One event
 * can prove several: a dream that merged near-copies and wrote a gist proves
 * Dreaming, Interference, Consolidation and Gist. This file keeps a copy of
 * the names and conditions, not an import — a hooks module reaches nothing
 * outside its plugin folder but through `$`. The repository's bun test
 * `test/sidebar-mechanism-drift.test.ts` fails when the copy and the table
 * disagree.
 */

import type { SidebarMeet, SidebarOnboarding, SidebarRow, SidebarSaved } from '../types';
import { MECHS, mechById } from './mechanisms';
import type { MechId } from './mechanisms';
import { cells, ellipsizeCells, headCells } from './width';

/** One event the sidebar read (the contract's SidebarRow). */
export type FeedRow = SidebarRow;

/** One event as the dashboard's activity feed narrates it (the status file carries these rows). */
export type DashEvent = {
  seq: number;
  at: number;
  day?: number;
  name: string;
  text: string;
  subject?: string | null;
  detail?: readonly { key: string; value: string }[];
};

function detail(e: DashEvent, key: string): string | undefined {
  return e.detail?.find(d => d.key === key)?.value;
}
function num(e: DashEvent, key: string): number {
  const v = Number(detail(e, key));
  return Number.isFinite(v) ? v : 0;
}
/**
 * Of the memories a deposit or a turn names, the ones carrying a recorded
 * feeling, with their feeling words (`detail.felt`, JSON `[{ id, words }]`,
 * 2026-10-14). The status file's writer reads them off the store; a row
 * without it carries none.
 */
export function feltOf(e: DashEvent): { id: string; words: string[] }[] {
  try {
    const list: unknown = JSON.parse(detail(e, 'felt') ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.flatMap(x => {
      if (x === null || typeof x !== 'object') return [];
      const { id, words } = x as { id?: unknown; words?: unknown };
      if (typeof id !== 'string' || !id.startsWith('mem_')) return [];
      return [{ id, words: Array.isArray(words) ? words.filter((w): w is string => typeof w === 'string' && w !== '') : [] }];
    });
  } catch {
    return [];
  }
}

/** `"Title…" [mem_abc]` → the title and the id. */
export function titled(value: string | null | undefined): { title: string | null; id: string | null } {
  if (value === undefined || value === null) return { title: null, id: null };
  const m = /^"([\s\S]*)"\s*\[([A-Za-z]+_[A-Za-z0-9]+)\]$/.exec(value.trim());
  if (m !== null) return { title: m[1] ?? null, id: m[2] ?? null };
  const bare = /\[([A-Za-z]+_[A-Za-z0-9]+)\]/.exec(value);
  return { title: null, id: bare?.[1] ?? null };
}

type Rule = { name: string; mech: MechId; word: string; when?: (e: DashEvent) => boolean };

/**
 * The event names that prove a mechanism fired, in the dashboard's words. An
 * event counts when any rule for its name holds. The FIRST that holds gives
 * it its word and colour (`mech`); EVERY one that holds lights (`mechs`).
 */
export const RULES: readonly Rule[] = [
  { name: 'gate.deposit', mech: 'salience', word: 'kept', when: e => num(e, 'accepted') > 0 },
  { name: 'gate.chunk', mech: 'salience', word: 'kept', when: e => num(e, 'accepted') > 0 },
  { name: 'recall.decision', mech: 'retrieval', word: 'recalled', when: e => num(e, 'surfacedCount') + num(e, 'footnoteCount') > 0 },
  // Emotion (2026-10-14): a memory saved with a feeling, a turn that brought one
  // carrying a feeling to mind (`felt`). The mood match, off by decision since
  // 2026-10-10, still lights it the day it is back on.
  { name: 'gate.deposit', mech: 'emotional', word: 'saved with a feeling', when: e => feltOf(e).length > 0 },
  { name: 'recall.decision', mech: 'emotional', word: 'came to mind', when: e => feltOf(e).length > 0 },
  { name: 'recall.decision', mech: 'emotional', word: 'brought closer', when: e => num(e, 'moodMatched') > 0 },
  // A memory a link put in front of the model (2026-10-11, Group 4).
  { name: 'recall.decision', mech: 'association', word: 'brought to mind by a link', when: e => num(e, 'linksReached') > 0 },
  { name: 'mcp.recall', mech: 'retrieval', word: 'looked up' },
  { name: 'recall.credit', mech: 'retrieval', word: 'strengthened', when: e => num(e, 'credited') > 0 },
  // Links LAID, not rows rewritten (2026-10-11, Group 4): `deposited`.
  { name: 'associate.flush', mech: 'association', word: 'linked', when: e => num(e, 'deposited') > 0 },
  { name: 'prospective.plain', mech: 'prospective', word: 'reminded' },
  { name: 'prospective.fire', mech: 'prospective', word: 'reminded' },
  { name: 'band.transition', mech: 'decay', word: 'faded', when: e => detail(e, 'site') === 'decay' && detail(e, 'direction') !== 'up' },
  { name: 'band.transition', mech: 'consolidation', word: 'rose', when: e => detail(e, 'site') === 'consolidate' },
  { name: 'memory.pruned', mech: 'decay', word: 'let go' },
  { name: 'sleep.cycle', mech: 'decay', word: 'faded', when: e => num(e, 'faded') > 0 },
  { name: 'band.promoted', mech: 'consolidation', word: 'became core' },
  { name: 'memory.merged', mech: 'consolidation', word: 'merged' },
  { name: 'dream.journaled', mech: 'dreaming', word: 'dreamed' },
  // The replay's faint trails, laid as the dream opens (2026-10-11, Group 4).
  { name: 'dream.begun', mech: 'association', word: 'linked', when: e => num(e, 'replayLinks') > 0 },
  // A change the dream made, or a core suggestion (`applied` counts both).
  { name: 'dream.changed', mech: 'dreaming', word: 'dreamed', when: e => num(e, 'applied') > 0 || num(e, 'nominate-core') > 0 },
  { name: 'dream.changed', mech: 'episodic-semantic', word: 'dreamed a pattern', when: e => num(e, 'gist') > 0 },
  { name: 'dream.changed', mech: 'interference', word: 'merged in a dream', when: e => num(e, 'merge') > 0 },
  { name: 'dream.changed', mech: 'consolidation', word: 'merged in a dream', when: e => num(e, 'merge') > 0 },
  { name: 'contradiction.flagged', mech: 'interference', word: 'flagged' },
  // A new memory read as the newer state of an older one (Group 2, the slot detector).
  { name: 'contradiction.proposed', mech: 'interference', word: 'noticed' },
  // DECLARED settles are reconsolidation's; a confirmed slot (a detected door) is
  // interference's; a dream merge's rows count as the merge (Group 2b, review 10 C6).
  { name: 'contradiction.settled', mech: 'reconsolidation', word: 'settled', when: e => detail(e, 'source') !== 'slot' && detail(e, 'source') !== 'dream-merge' },
  { name: 'contradiction.settled', mech: 'interference', word: 'replaced', when: e => detail(e, 'source') === 'slot' },
  { name: 'revision.pressure', mech: 'reconsolidation', word: 'weighed' },
];

/** The names worth asking the dashboard for one by one. */
export const RULE_NAMES: readonly string[] = [...new Set(RULES.map(r => r.name))];

/** The rules `e` proves, one a mechanism, the event's own first; none when it proves nothing. */
export function provedBy(e: DashEvent): Rule[] {
  const out: Rule[] = [];
  for (const r of RULES) {
    if (r.name !== e.name || (r.when !== undefined && !r.when(e))) continue;
    if (!out.some(o => o.mech === r.mech)) out.push(r);
  }
  return out;
}

/** A row's mechanisms, its own first (a row from before rows carried `mechs`: its own alone). */
export function mechsOf(r: SidebarRow): MechId[] {
  return Array.isArray(r.mechs) && r.mechs.length > 0 ? r.mechs : [r.mech];
}

/**
 * The events that belong to no session: the night's sleep and dreams, and
 * what they settle (fading, merging, promoting). Everything else carries the
 * session it happened in (`detail.session`), or is a session's boundary work.
 */
const NIGHT = new Set([
  'dream.journaled', 'dream.changed', 'band.transition', 'memory.pruned', 'memory.merged',
  'band.promoted', 'sleep.cycle', 'contradiction.flagged', 'contradiction.settled', 'revision.pressure',
]);

/** The titles a recall narration quotes (“…”). */
export function quotedTitles(text: string): string[] {
  return [...text.matchAll(/“([^”]+)”/g)].map(m => m[1] ?? '').filter(t => t.length > 0);
}

/**
 * A dashboard event in the sidebar's terms, or null when it proves no
 * mechanism. `session` is this session's id: its own events are `here`, the
 * night's `night`, other sessions' `other` (they never light this header's dot).
 *
 * WHOSE IT IS. An event's `session` (or, for a settle a session made, its
 * `actorId`) names it. A look-up (`mcp.recall`), a reminder
 * (`prospective.*`) and a link flush (`associate.flush`) name none yet (a
 * core follow-up: add `session` to those payloads, and the read below takes
 * it): one of those from after this session began (`since`) is taken as this
 * session's, one from before as another's.
 */
export function classify(e: DashEvent, session = '', since = 0): FeedRow | null {
  const proved = provedBy(e);
  const rule = proved[0];
  if (rule === undefined) return null;
  const m = mechById(rule.mech);
  const short = m?.short ?? rule.mech;
  // A settle or a revision a session made names it as its actor, not as `session`.
  const bySession = detail(e, 'actor') === 'session';
  const from = detail(e, 'session') ?? (bySession ? detail(e, 'actorId') : undefined);
  const mine = session !== '';
  const who: FeedRow['who'] =
    NIGHT.has(e.name) && !bySession
      ? 'night'
      : from !== undefined
        ? mine && from === session ? 'here' : 'other'
        : e.at >= since ? 'here' : 'other';
  // The memory it is about: a deposit's `memoryId`, a fade's or a promotion's subject, a settle's `over`.
  const named = [detail(e, 'memoryId'), e.subject ?? undefined, detail(e, 'over'), detail(e, 'id'), detail(e, 'targetId')]
    .map(titled)
    .find(t => t.id !== null && t.id.startsWith('mem_'));
  const dream = e.name.startsWith('dream.') && typeof e.subject === 'string' && /^drm_[A-Za-z0-9]+$/.test(e.subject) ? e.subject : undefined;
  const base: FeedRow = {
    id: `seq:${String(e.seq)}`,
    mech: rule.mech,
    mechs: proved.map(r => r.mech),
    word: rule.word,
    at: e.at,
    text: e.text,
    more: [],
    who,
    line: `${rule.word} · ${e.text}`,
    ...(named === undefined || named.id === null ? {} : { memory: { id: named.id, title: named.title } }),
    ...(dream === undefined ? {} : { dream }),
  };
  if (rule.name === 'gate.deposit' || rule.name === 'gate.chunk') {
    const accepted = num(e, 'accepted');
    const text = named?.title ?? (accepted > 1 ? `${String(accepted)} memories written down` : 'a memory');
    return { ...base, text, line: `kept · ${text}`, ...(named?.id ? { twinIds: [`mem:${named.id}`] } : {}) };
  }
  if (rule.name === 'recall.decision') {
    const turn = detail(e, 'turn');
    const n = num(e, 'surfacedCount') + num(e, 'footnoteCount');
    const said = n > 0 ? `${String(n)} came to mind` : `${String(num(e, 'moodMatched'))} brought closer by a matching mood`;
    return {
      ...base,
      text: said,
      more: quotedTitles(e.text),
      line: said,
      ...(from !== undefined && turn !== undefined ? { twinIds: [`turn:${from}:${turn}`] } : {}),
    };
  }
  return base;
}

/** A recall decision's surfaced ids, strongest first (`detail.surfaced`, a JSON list of `{ id }`). */
export function surfacedIds(e: DashEvent): string[] {
  try {
    const list: unknown = JSON.parse(detail(e, 'surfaced') ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.map(x => (x !== null && typeof x === 'object' ? (x as { id?: unknown }).id : undefined)).filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** The decision row for this session's turn `turn`, among a few of the newest. */
export function decisionFor(events: readonly DashEvent[], session: string, turn: number): DashEvent | undefined {
  return events.find(e => e.name === 'recall.decision' && detail(e, 'session') === session && Number(detail(e, 'turn')) === turn);
}

// ── times fired today, counted from the feed (a dashboard older than v0.2) ──

/**
 * Times each mechanism fired on the calendar day `date` among `rows`, as the
 * dashboard counts `firedToday`: rows, not amounts; a dream's rows once.
 * `start` is a count so far, so a poll's new rows add to it; `dreams` the
 * dreams already counted, so a dream's second row adds nothing. The caller
 * hands in each row once (the cold read stops at the seq the polls go on from).
 */
export function countToday(
  rows: readonly SidebarRow[],
  date: string,
  dateOf: (at: number) => string,
  start: Partial<Record<MechId, number | null>> = {},
  dreams: readonly string[] = [],
): { counts: Partial<Record<MechId, number | null>>; dreams: string[] } {
  const counts: Partial<Record<MechId, number | null>> = { ...start };
  for (const m of MECHS) if (counts[m.id] === undefined) counts[m.id] = m.notBuilt ? null : 0;
  const seenDreams = new Set(dreams);
  const fresh = new Map<string, Set<MechId>>();
  for (const r of rows) {
    if (dateOf(r.at) !== date) continue;
    for (const m of mechsOf(r)) {
      if (r.dream !== undefined) {
        // One dream, one firing of each mechanism it proves: its journal and its changes rows are one.
        const k = `${r.dream}:${m}`;
        if (seenDreams.has(k)) continue;
        const set = fresh.get(r.dream) ?? new Set<MechId>();
        if (set.has(m)) continue;
        set.add(m);
        fresh.set(r.dream, set);
      }
      const c = counts[m];
      if (typeof c === 'number') counts[m] = c + 1;
    }
  }
  for (const [d, ms] of fresh) for (const m of ms) seenDreams.add(`${d}:${m}`);
  return { counts, dreams: [...seenDreams] };
}

// ── a mechanism's recent firings (its panel's `activity`) ─────────────────

/** A piece of a firing's sentence: plain words, or a memory (its id, and the title the row carried, maybe cut). */
export type FiringPart = string | { id: string | null; title: string | null };

/** One thing a firing was about, before its titles are read in full: what the opened mechanism lists. */
export type Firing = {
  /** Unique among the list: `<seq>.<n>`. */
  key: string;
  seq: number;
  at: number;
  /** The group's word (`faded`, `came to mind`, `merged in a dream`). */
  word: string;
  /** The sentence, a memory's title or a few words around two. */
  parts: FiringPart[];
  /** The memory a click opens in place; null opens `text` instead. */
  memoryId: string | null;
  /** What opening a firing that names no memory shows. */
  text: string;
};

function idList(e: DashEvent, key: string): string[] {
  try {
    const list: unknown = JSON.parse(detail(e, key) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list
      .map(x => (typeof x === 'string' ? x : x !== null && typeof x === 'object' ? (x as { id?: unknown }).id : undefined))
      .filter((x): x is string => typeof x === 'string' && x.startsWith('mem_'));
  } catch {
    return [];
  }
}

/** Which of a dream's changes prove `mech`: merges for Interference and Consolidation, patterns for Gist. */
const DREAM_ACTION: Partial<Record<MechId, string>> = { interference: 'merge', consolidation: 'merge', 'episodic-semantic': 'gist' };

/**
 * What each firing of `mech` among `events` was about, newest first: the
 * memories it names, never its counts (Mike, 2026-10-10: "1 came to mind"
 * says nothing). A firing that names nothing is left out:
 *   - a recall's decision: each memory that came to mind or sat in the
 *     footnotes (`surfaced`, `footnotes` ids); a credit: each memory it
 *     strengthened (`ids`);
 *   - Emotion's deposits and turns: only the memories that carry a feeling
 *     (`felt`), each as its title and its feeling words (`Title (curious)`);
 *   - a deposit, a fade, a rise, a promotion, a prune, a reminder: its memory;
 *   - a settle: which memory holds over which; revision pressure: which
 *     argued with which;
 *   - a dream: its journal's first sentence (Dreaming); its merges
 *     (Interference, Consolidation) and patterns (Gist) from the dreams'
 *     changes, which name memories the event row only counts;
 *   - left out, nothing to name: a look-up (`mcp.recall` counts what it
 *     opened), a link flush (`associate.flush` counts pairs), a turn a link
 *     reached recall on (`recall.decision`'s `linksReached` is a count), a
 *     dream's replay links (`dream.begun` counts them), a flagged
 *     contradiction (a pair id), a sleep cycle's fades (counts).
 */
export function mechFirings(events: readonly DashEvent[], mech: MechId, dreams: readonly DashDream[] = [], limit = 8): Firing[] {
  const out: Firing[] = [];
  const push = (e: DashEvent, word: string, parts: FiringPart[], memoryId: string | null, text = e.text): void => {
    if (out.length < limit) out.push({ key: `${String(e.seq)}.${String(out.length)}`, seq: e.seq, at: e.at, word, parts, memoryId, text });
  };
  for (const e of [...events].sort((a, b) => b.seq - a.seq)) {
    if (out.length >= limit) break;
    const rule = provedBy(e).find(r => r.mech === mech);
    if (rule === undefined) continue;
    // A turn a link reached recall on counts only (2026-10-11): its row does not
    // say WHICH shown memory the link brought, so naming them all would be wrong.
    if (e.name === 'recall.decision' && mech === 'association') continue;
    // Emotion names only the memories that carry a feeling, each with its words.
    const felt = mech === 'emotional' ? feltOf(e) : [];
    if (felt.length > 0) {
      const quoted = quotedTitles(e.text);
      const own = e.name === 'gate.deposit' ? classify(e)?.memory : undefined;
      felt.forEach((f, i) => {
        const title = own?.id === f.id ? own.title : quoted.length === felt.length ? (quoted[i] ?? null) : null;
        push(e, rule.word, f.words.length > 0 ? [{ id: f.id, title }, ` (${f.words.join(', ')})`] : [{ id: f.id, title }], f.id);
      });
      continue;
    }
    if (e.name === 'recall.decision' || e.name === 'recall.credit') {
      const ids = e.name === 'recall.decision' ? [...surfacedIds(e), ...idList(e, 'footnotes')] : idList(e, 'ids');
      const quoted = quotedTitles(e.text);
      const word = e.name === 'recall.decision' && rule.word === 'recalled' ? 'came to mind' : rule.word;
      ids.forEach((id, i) => push(e, word, [{ id, title: quoted.length === ids.length ? (quoted[i] ?? null) : null }], id));
      continue;
    }
    if (e.name === 'dream.journaled' || e.name === 'dream.changed') {
      const d = dreams.find(x => x.id === e.subject);
      if (d === undefined) continue;
      if (e.name === 'dream.journaled') {
        if (typeof d.journal !== 'string' || d.journal.trim() === '') continue;
        push(e, rule.word, [firstSentence(d.journal).first], null, d.journal.replace(/\s+/g, ' ').trim());
        continue;
      }
      const action = DREAM_ACTION[mech];
      if (action === undefined) continue;
      for (const c of d.changes ?? []) {
        const m = c.action === action && c.undone !== true ? c.memories?.[0] : undefined;
        if (m === undefined || m.confidential === true) continue;
        push(e, rule.word, [{ id: m.id, title: m.text }], m.id);
      }
      continue;
    }
    if (e.name === 'contradiction.settled' || e.name === 'contradiction.proposed') {
      const holds = titled(detail(e, 'holds'));
      const over = titled(detail(e, 'over'));
      if (holds.id === null || over.id === null) continue;
      push(e, rule.word, [holds, e.name === 'contradiction.proposed' ? ' may be the newer state of ' : ' holds over ', over], holds.id);
      continue;
    }
    if (e.name === 'revision.pressure') {
      const target = titled(detail(e, 'targetId'));
      const by = titled(detail(e, 'challengerId'));
      if (target.id === null || by.id === null) continue;
      push(e, rule.word, [by, ' argued with ', target], target.id);
      continue;
    }
    if (e.name === 'mcp.recall' || e.name === 'associate.flush' || e.name === 'contradiction.flagged' || e.name === 'sleep.cycle') continue;
    const row = classify(e);
    if (row?.memory === undefined) continue;
    push(e, rule.word, [{ id: row.memory.id, title: row.memory.title }], row.memory.id);
  }
  return out;
}

/** The ids a firing names, for reading their titles whole. */
export function firingIds(f: Firing): string[] {
  return f.parts.flatMap(p => (typeof p === 'string' || p.id === null ? [] : [p.id]));
}

/**
 * A firing's sentence, with each memory's title read in full where it was
 * (`titles`, by id), else the one the row carried; null when a memory has no
 * title at all (it is left out rather than shown as an id).
 */
export function firingTitle(f: Firing, titles: Readonly<Record<string, string>>): string | null {
  let s = '';
  for (const p of f.parts) {
    if (typeof p === 'string') {
      s += p;
      continue;
    }
    const t = (p.id === null ? undefined : titles[p.id]) ?? p.title;
    if (t === null || t === '') return null;
    s += t;
  }
  return s;
}

// ── the recall block ────────────────────────────────────────────────────────

export type RecallBlock = { turn: number; surfaced: string[]; footnotes: { title: string; id: string | null }[] };

/**
 * The block `core/recall/render.ts` composes, found in any text that carries
 * it (the engine wraps hook context in a system reminder). Null when absent
 * or when it is the quiet turn's empty string. A surfaced line is the
 * memory's gist, as Claude read it; a footnote line is its title and id.
 */
export function parseRecallBlock(text: string): RecallBlock | null {
  const open = /<!--\s*counterparts:recall t=(\d+)\s*-->/.exec(text);
  if (open === null) return null;
  const rest = text.slice(open.index + open[0].length);
  const end = rest.search(/<!--\s*counterparts:recall\/end/);
  const body = end >= 0 ? rest.slice(0, end) : rest;
  const surfaced: string[] = [];
  const footnotes: { title: string; id: string | null }[] = [];
  let lane: 'none' | 'surfaced' | 'footnote' = 'none';
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === 'Came to mind:') { lane = 'surfaced'; continue; }
    if (line.startsWith('Quietly available')) { lane = 'footnote'; continue; }
    if (!line.startsWith('- ')) continue;
    const item = line.slice(2).trim();
    if (lane === 'surfaced') surfaced.push(item);
    else if (lane === 'footnote') {
      // A footnote can lead with what it is to another memory ("Earlier (now [id]): ", "Unsettled — may be out of
      // date, see [id]: ") and trail one ("(earlier: [id])", "(corrects [id])"): the title is what's between,
      // the id the first one after the lead (the sidebar showed "Earlier (now ): … [mem_…]", 2026-10-13).
      // The line is `[Linked: |Journal: ][standing lead: ]Title [id][ (pointers)]` (core/recall/render.ts), so the
      // memory's own id is the one at the end, before any trailing pointers; the lead may also be "Corrected by
      // [id]" or "Replaced by [id]", alone or joined with "; ", and may sit behind a Linked:/Journal: word.
      const end = /^(.*)\s*\[([A-Za-z]+_[A-Za-z0-9]+)\](?:\s*\([^()]*\))?$/.exec(item);
      const m = end ?? /^(.*?)\s*\[([A-Za-z]+_[A-Za-z0-9]+)\]/.exec(item);
      const front = m === null ? item : (m[1] ?? '');
      const frame = /^(?:(?:Linked|Journal):\s+)*/.exec(front)?.[0] ?? '';
      const after = front.slice(frame.length);
      const lead = /^(Earlier|Unsettled|Corrected by|Replaced by)\b[^:]*?\[[A-Za-z]+_[A-Za-z0-9]+\][^:]*:\s*/.exec(after);
      const word = lead === null ? '' : `${(lead[1] ?? '').replace(/ by$/, '')}: `;
      const title = `${frame}${word}${lead === null ? after : after.slice(lead[0].length)}`.trim();
      footnotes.push({ title, id: m === null ? null : (m[2] ?? null) });
    }
  }
  const turn = Number(open[1]);
  return { turn: Number.isFinite(turn) ? turn : 0, surfaced, footnotes };
}

// ── the memory tools, as the model calls them ──────────────────────────────

/** The two names the memory server's tools go by: the npm install's, the plugin's. */
export const SERVER_SPELLINGS = ['counterparts', 'plugin_counterparts_counterparts'] as const;

/** `mcp__counterparts__remember` → `{ server: 'counterparts', tool: 'remember' }`, ours only. */
export function ourTool(name: string): { server: string; tool: string } | null {
  for (const server of SERVER_SPELLINGS) {
    const prefix = `mcp__${server}__`;
    if (name.startsWith(prefix)) return { server, tool: name.slice(prefix.length) };
  }
  return null;
}

function firstLine(s: unknown, max = 240): string | null {
  if (typeof s !== 'string') return null;
  const line = s.trim().split('\n')[0] ?? '';
  if (line.length === 0) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A tool result's JSON payload (the server sends it whole as text). */
export function payloadOf(text: string | undefined): Record<string, unknown> | null {
  if (typeof text !== 'string') return null;
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `remember` was `note` until 2026-10-10; the old name still answers, so both save. */
const REMEMBER = new Set(['remember', 'note']);

function memoryId(v: unknown): string | null {
  return typeof v === 'string' && /^mem_[A-Za-z0-9]+$/.test(v.trim()) ? v.trim() : null;
}

/**
 * What a memory tool call that answered without error saved, as "Saved this
 * session" items in the order written; none for any other tool (a chapter
 * included: a journal entry), and for a call that stored nothing. A `remember` (or old `note`) or a `session_end` entry with `updates`
 * replaces that memory (unless `how: open`, which keeps both); its title is
 * read later, from the dashboard.
 */
export function savedItems(tool: string, args: Record<string, unknown>, resultText: string | undefined, at: number, seq: number): SidebarSaved[] {
  const ours = ourTool(tool);
  if (ours === null) return [];
  const p = payloadOf(resultText);
  if (p !== null && p['stored'] === false) return [];
  const item = (i: number, title: string, id: string | null, src: Record<string, unknown>): SidebarSaved => {
    const settled = p?.['settled'] as { ok?: unknown; held?: unknown } | undefined;
    const refused = REMEMBER.has(ours.tool) && settled !== undefined && (settled.ok === false || settled.held === true);
    const replacesId = src['how'] === 'open' || refused ? null : memoryId(src['updates']);
    const body = typeof src['text'] === 'string' ? src['text'].replace(/\s+/g, ' ').trim() : '';
    return {
      key: `live:${String(seq)}:${String(i)}`,
      id,
      title,
      at,
      replaces: null,
      replacesId,
      kind: replacesId === null ? 'new' : 'update',
      ...(body === '' ? {} : { text: body }),
    };
  };
  if (REMEMBER.has(ours.tool)) {
    const title = firstLine(args['title']) ?? firstLine(args['text']) ?? 'a note';
    return [item(0, title, memoryId(p?.['id']), args)];
  }
  // A chapter is a journal entry, not a memory saved: left out of Saved this session (Mike, 2026-10-10).
  if (ours.tool === 'session_end') {
    const list = Array.isArray(args['memories']) ? (args['memories'] as unknown[]) : [];
    if (typeof p?.['deposited'] === 'number' && p['deposited'] === 0) return [];
    return list.flatMap((m, i) => {
      const rec = m !== null && typeof m === 'object' ? (m as Record<string, unknown>) : {};
      const title = firstLine(rec['title']) ?? firstLine(rec['text']);
      return title === null ? [] : [item(i, title, null, rec)];
    });
  }
  return [];
}

/** A memory tool that saves (`remember`, the old `note`, `session_end`); a chapter is a journal entry. */
export function savesMemory(tool: string): boolean {
  return REMEMBER.has(tool) || tool === 'session_end';
}

/** A save older than this when the status file is next read (a pane hidden a while) is not played as new. */
export const SAVE_FRESH_MS = 2 * 60000;

/**
 * Whether the status file's new rows hold a save for this session that the
 * fox has not written down yet (2026-10-20): a `gate.deposit` naming the
 * session, with `accepted` > 0, written after the last save the fox heard
 * (`after`, `Director.saveAt`) and within SAVE_FRESH_MS of `now`.
 *
 * Every deposit comes through the memory tools (`session_end`, `remember`),
 * and the `tool.call` hook hears the save as the call returns, after the
 * call's rows were written: so those rows are older than `after`, and the
 * same save does not write twice (a second call inside one notepad's run
 * plays nothing more, and still moves `after`). What is left is a save that hook did not
 * see (a reload mid-call, an answer it could not read). A burst read in two
 * looks writes once: the first look's notepad is newer than the rest.
 */
export function savedSince(events: readonly DashEvent[], session: string, after: number, now: number): boolean {
  if (session === '') return false;
  return events.some(
    e =>
      e.name === 'gate.deposit' &&
      e.at > after &&
      now - e.at < SAVE_FRESH_MS &&
      num(e, 'accepted') > 0 &&
      e.detail?.some(d => (d.key === 'session' || d.key === 'actorId') && d.value === session) === true,
  );
}

/** The ids a `recall` call opened by address: its `ids`, or a `handle` that is an id. */
export function openedIds(tool: string, args: Record<string, unknown>): { ids: string[]; handle: string | null } {
  const ours = ourTool(tool);
  if (ours === null || ours.tool !== 'recall') return { ids: [], handle: null };
  const ids = Array.isArray(args['ids']) ? (args['ids'] as unknown[]).map(memoryId).filter((x): x is string => x !== null) : [];
  const handle = typeof args['handle'] === 'string' && args['handle'].trim().length > 0 ? args['handle'].trim() : null;
  const asId = memoryId(handle);
  return asId === null ? { ids, handle } : { ids: [...ids, asId], handle: null };
}

// ── a dream ────────────────────────────────────────────────────────────────

/** A dream as the status file carries it, the part the sidebar reads. */
export type DashDream = {
  id: string;
  date: string | null;
  day: number;
  state?: string;
  journal: string | null;
  counts?: Record<string, number>;
  changes?: { action: string; said: string; undone?: boolean; memories?: { id: string; text: string; confidential?: boolean }[] }[];
};

/** The journal's first sentence, and what follows it. */
export function firstSentence(journal: string): { first: string; rest: string } {
  const text = journal.replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(?:["”’)]*)(?=\s|$)/.exec(text);
  if (m === null) return { first: text, rest: '' };
  const first = text.slice(0, m[0].length).trim();
  return { first, rest: text.slice(m[0].length).trim() };
}

// ── dates ──────────────────────────────────────────────────────────────────

/** `10-09` or `2025-10-09` as `Oct 9` (with the year when one is given). */
export function shortDay(s: string): string {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(s.trim());
  if (m === null) return '';
  const month = MONTHS[Number(m[2]) - 1];
  if (month === undefined) return '';
  return `${month} ${String(Number(m[3]))}${m[1] === undefined ? '' : ` ${m[1]}`}`;
}

// ── words and times ────────────────────────────────────────────────────────

/** Word-wrap into lines of at most `w` terminal cells (a wide character counts two; a word longer than a line is cut). */
export function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word0 of text.split(/\s+/).filter(Boolean)) {
    let word = word0;
    while (cells(word) > w) {
      if (line) { out.push(line); line = ''; }
      const head = headCells(word, w) || (Array.from(word)[0] ?? '');
      out.push(head);
      word = word.slice(head.length);
    }
    if (!word) continue;
    if ((line ? cells(line) + 1 : 0) + cells(word) > w) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** A folder as a person says it: a home folder (`/Users/<name>`, `/home/<name>`) as `~`. */
export function shortDir(dir: string | null): string {
  if (dir === null) return 'this folder';
  return dir.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
}

/** `s` cut to `w` terminal cells, with an ellipsis. */
export function ellipsize(s: string, w: number): string {
  return ellipsizeCells(s, w);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The local calendar day of `at`, `YYYY-MM-DD`. */
export function dateOf(at: number): string {
  const d = new Date(at);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The time a section's heading carries: `10:25`, `8:07` (a 12-hour clock with
 * no am or pm, as the mockups have it: every time it shows is recent), or
 * `Oct 9` before today (`Jan 5 2025` in another year).
 */
export function hm(at: number, now: number): string {
  const d = new Date(at);
  if (dateOf(at) !== dateOf(now)) return humanDay(dateOf(at), now);
  const h = d.getHours() % 12;
  return `${String(h === 0 ? 12 : h)}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `2026-10-09` as `Oct 9`, or `Jan 5 2025` when it is not this year (by `now`). */
export function humanDay(iso: string, now: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m === null ? undefined : MONTHS[Number(m[2]) - 1];
  if (m === null || month === undefined) return iso;
  const year = m[1] ?? '';
  return `${month} ${String(Number(m[3]))}${year === dateOf(now).slice(0, 4) ? '' : ` ${year}`}`;
}

/** Words that, after `10-20`, make it a range of something rather than a day. */
const RANGE_UNITS =
  'lines?|cells?|columns?|cols?|rows?|items?|mins?|minutes?|secs?|seconds?|s|ms|hours?|hrs?|h|days?|weeks?|months?|years?|pages?|steps?|tests?|files?|words?|chars?|characters?|points?|pts?|px|k|x|times?|percent|people|memories|frames?|fps|of';

/**
 * A short date as the titles write it (`(10-09)`, `10-09: `, `… 10-09`),
 * rewritten as `<year>-10-09` so the ISO rules below say it: two digits a
 * side, a real month and day, standing alone. Not a date, so left as written:
 * part of a longer number or name (`2026-10-09` itself, `#10-09`, `v10-09`,
 * `0.10-09`, `10-09-2026`, `10-09.5`), a time (`10:09`, `10-09:30`), a range of something
 * (`10-20 lines`, `10-20%`), an impossible day (`13-09`, `02-30`). The year
 * is this one: a title's short date is recent, and none is shown for it.
 */
function isoShortDates(title: string, year: string): string {
  if (!/\d{2}-\d{2}/.test(title)) return title;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_#./:$~-])(\\d{2})-(\\d{2})(?![\\p{L}\\p{N}_/%-])(?![.:]\\d)(?!\\s*(?:${RANGE_UNITS})\\b)`, 'gu');
  return title.replace(re, (whole, mm: string, dd: string) => {
    const m = Number(mm);
    const d = Number(dd);
    const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    return days === undefined || d < 1 || d > days ? whole : `${year}-${mm}-${dd}`;
  });
}

/**
 * A title as the sidebar shows it (never the stored text): an ISO date that
 * only says today is dropped with what holds it (`(2026-10-10)`,
 * `2026-10-10: `, `, 2026-10-10)`), `on 2026-10-10` reads `today` and `on
 * 2026-10-10 morning` `this morning`; any
 * other ISO date is short and human, `Oct 9`, with the year only when it is
 * not this one (`Jan 5 2025`). Mike, 2026-10-10. A short date (`(10-09)`,
 * `10-09: `) reads the same way, as this year's (`isoShortDates`).
 */
export function humanDates(title: string, now: number): string {
  const today = dateOf(now);
  title = isoShortDates(title, today.slice(0, 4));
  if (!/\d{4}-\d{2}-\d{2}/.test(title)) return title;
  const t = today.replace(/-/g, '\\-');
  const out = title
    .replace(new RegExp(`\\s*\\(\\s*${t}\\s*\\)`, 'g'), '')
    .replace(new RegExp(`^\\s*${t}\\s*[:·—–-]\\s*`), '')
    .replace(new RegExp(`\\s*[:·—–-]\\s*${t}\\s*$`), '')
    .replace(new RegExp(`\\s*[,;]\\s*${t}(?=\\s*\\))`, 'g'), '')
    .replace(new RegExp(`\\(\\s*${t}\\s*[,;]\\s*`, 'g'), '(')
    .replace(new RegExp(`\\b(?:on\\s+)?${t}\\s+(morning|afternoon|evening|night)\\b`, 'g'), 'this $1')
    .replace(new RegExp(`\\b(?:on|dated)\\s+${t}\\b`, 'g'), 'today')
    .replace(new RegExp(`\\b${t}\\b`, 'g'), 'today')
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_m, iso: string) => humanDay(iso, now))
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out === '' ? title : out;
}

// ── the first meeting: core's onboarding state ─────────────────────────────

const MEET_STATES: readonly SidebarMeet[] = ['not_started', 'offered', 'later', 'done', 'skipped'];

/** Not read, or read as nothing the sidebar knows: it does nothing about the meeting. */
export const UNKNOWN_ONBOARDING: SidebarOnboarding = { meet: 'unknown', where: null, style: null };

/**
 * Core's first-meeting state as a JSON object (`{ meet, where, style }`), read
 * strictly: anything but an object whose `meet` is one of the five states is
 * unknown, so a core from before onboarding (a 404 page, an error body, a
 * renamed field) never moves the sidebar.
 */
export function parseOnboarding(text: string): SidebarOnboarding {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return UNKNOWN_ONBOARDING;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return UNKNOWN_ONBOARDING;
  const rec = raw as Record<string, unknown>;
  const meet = rec['meet'];
  if (typeof meet !== 'string' || !(MEET_STATES as readonly string[]).includes(meet)) return UNKNOWN_ONBOARDING;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  return { meet: meet as SidebarMeet, where: str(rec['where']), style: str(rec['style']) };
}

/**
 * THE ONE PLACE THE WAKE'S MARKER IS SPELLED. Core writes it on its own line
 * in every SessionStart wake (done included; `start-fresh` resets it to
 * not_started): `<!-- counterparts:onboarding meet=<state> -->`. Since
 * 2026-10-20 (core's ONE TAG, `adapters/store-id.ts`) it is a field of the
 * wake's own head tag, `<!-- counterparts:wake meet=<state> store=st_…
 * elements=… bytes=… -->`, or of `<!-- counterparts:session meet=<state> … -->`
 * in front of a wake that has no head tag; all three forms are read, so this
 * sidebar reads an older core's wake too. No marker: an older core, the
 * state unknown. Change the text here if core's changes.
 */
export const ONBOARDING_MARKER =
  /<!--\s*counterparts:(?:onboarding\s+meet=([a-z_]+)\s*|(?:wake|session)\s+(?:[a-z]+=[^\s>]+\s+)*meet=([a-z_]+)(?:\s[^>]*)?)-->/;

/** The state the wake's marker names, or null: no marker, or a state the sidebar doesn't know. */
export function parseOnboardingMarker(text: string): SidebarMeet | null {
  const m = ONBOARDING_MARKER.exec(text);
  const state = m?.[1] ?? m?.[2];
  return state !== undefined && (MEET_STATES as readonly string[]).includes(state) ? (state as SidebarMeet) : null;
}

/**
 * WHICH STORE (core #459, 2026-10-12): the wake carries
 * `<!-- counterparts:store id=st_… -->` on its own line, and the status file
 * names the store that wrote it (`storeId`). Two stores on one machine can
 * share one configuration folder, so the sidebar shows the file's numbers only
 * when the two agree; either unknown (no marker, an older core, a store whose
 * id is not minted yet: null) is "can't tell", and it carries on. Since
 * 2026-10-20 it is the `store=` field of the wake's head tag (or of the
 * `counterparts:session` tag), read as the onboarding marker's `meet=` is.
 */
export const STORE_MARKER =
  /<!--\s*counterparts:(?:store\s+id=(st_[0-9a-f]{16})\s*|(?:wake|session)\s+(?:[a-z]+=[^\s>]+\s+)*store=(st_[0-9a-f]{16})(?:\s[^>]*)?)-->/

/** The store the wake names, or null. */
export function parseStoreMarker(text: string): string | null {
  const m = STORE_MARKER.exec(text)
  return m?.[1] ?? m?.[2] ?? null
}

/** Whether a status file written by `dash`'s store belongs to another store than the wake's: only when both are known and differ. */
export function otherStore(wake: string | null, dash: string | null): boolean {
  return wake !== null && dash !== null && wake !== dash
}

/**
 * A folder where a first meeting makes sense: Counterparts on by its own
 * entry or a parent's, or unset (on by default). Not paused, off or
 * observer (nothing new is kept there), and not unknown (never acted on as on).
 */
export function canMeet(folderMode: string): boolean {
  return folderMode === 'on' || folderMode === 'unset';
}

// ── a glance before anything happens: the wake's own lines ─────────────────

/** What the sidebar shows before the session has done anything: a heading and one short text. */
export type Glance = { head: string; text: string }

/**
 * THE ONE PLACE THE WAKE'S GLANCE LINES ARE SPELLED (2026-10-15, Mike: show
 * the first that has something, in this order). Core writes them in every
 * SessionStart wake: `Last here: …` (handoff/last-here.ts), `Where I left off
 * in this directory (…): …` (handoff/index.ts), the `Coming up:` heading
 * (self/briefing.ts FRAMING.horizon) with `- <date> · <text>` items, and
 * `Yesterday, <date>: …` (handoff/last-here.ts). Change these if core's change;
 * a wake without them shows no glance, nothing else.
 */
const GLANCE_LAST = /^Last here:\s*(.+)$/m
const GLANCE_LEFT_OFF = /^Where I left off in this directory \([^)]*\):\s*(.+)$/m
const GLANCE_COMING = /^Coming up:\s*\n-\s*(.+)$/m
// "Yesterday, Oct 15: …", or since 2026-10-16 at a session start "Yesterday: …" (its date on the `Now:` line).
const GLANCE_YESTERDAY = /^Yesterday(?:, ([^:]+))?:\s*(.+)$/m
/**
 * A Coming up item's date, every way core's `datePrefix` (self/briefing.ts)
 * writes it: `due D`, `was due D`, `due D, every May 14`, `[by ]L (due D…)`,
 * `[by ]L (was due D…)`, `[by ]L (of H)`, `[by ]L` — then ` · `. The date it
 * is about comes out alone: the due date where there is one, else the learned.
 */
// Each date whole (`2026-10-15`) or, since 2026-10-16, short in the wake's year (`Oct 15`).
const COMING_DATE = /^(?:by\s+)?(?:(?:was due|due)\s+(?:yesterday,\s+)?(\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2} \d{1,2})(?:,[^·]*)?|(\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2} \d{1,2})(?:\s*\((was due|due|of)\s+(?:yesterday,\s+)?(\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2} \d{1,2})[^)]*\))?)\s*·\s*/

/** Memory, chapter and handoff ids, and the asides that only point at them: not for the person. */
function forPerson(text: string): string {
  return text
    .replace(/\((?:earlier|the whole of it is|expand)[^)]*\)/gi, '')
    .replace(/\[?\b(?:mem|epi|sch|ctr)_[0-9a-f]{6,}\b\]?,?/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[;,]\s*(?=[;,.]|$)/g, '')
    .replace(/\s+([.,;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** The first glance line the wake has, in Mike's order: where things were left, what's coming up, yesterday. */
export function parseGlance(text: string): Glance | null {
  for (const re of [GLANCE_LAST, GLANCE_LEFT_OFF]) {
    const m = re.exec(text)?.[1]
    if (m !== undefined && forPerson(m).length > 0) return { head: 'Last here', text: forPerson(m) }
  }
  const coming = GLANCE_COMING.exec(text)?.[1]
  if (coming !== undefined) {
    const t = forPerson(coming.replace(COMING_DATE, (_m, lone?: string, learned?: string, word?: string, inner?: string) =>
      `${lone ?? (word === 'of' ? learned : inner ?? learned) ?? ''} · `))
    if (t.length > 0) return { head: 'Coming up', text: t }
  }
  const y = GLANCE_YESTERDAY.exec(text)
  if (y !== null) {
    const t = forPerson(y[2] ?? '').replace(/^[\s;,]*(?:and \d+ more)?[.;\s]*$/, '')
    if (t.length > 0) return { head: y[1] === undefined ? 'Yesterday' : `Yesterday, ${y[1]}`, text: t }
  }
  return null
}
