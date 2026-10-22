/**
 * `/api/subjects`, `/api/subject?id=` and `/api/tag?tag=` — the subjects tab
 * (wave 2 lane D, 2026-10-21; design §7): a page per subject (a person,
 * project, place, topic, or me), its strongest current beliefs with what
 * holds each up, its recent memories, and a cloud of tags and subjects.
 *
 * Split like every view here (`web/views.ts` re-exports it); the four rules
 * in that file's header hold for every line below.
 *
 * READ FROM THE STORE, NOT FROM `schemas`. `Schemas` reads its cards' meta
 * once, at its open, and the dashboard's source lives as long as the server:
 * a belief the night minted after the dashboard started would be missing from
 * `schemas.beliefs()`. The store answers what is committed now, so the cards
 * and their beliefs are read off the `schema` rows themselves (a few hundred
 * at most; one pass per request).
 *
 * Which cards have a page: every live entity card. A card whose kind of
 * subject nobody has judged yet (`subject_kind` NULL — the v14 upgrade judged
 * only people and places; lane B's night sorts the rest) is listed as "not
 * sorted yet" rather than left without a page (totality, CONTRACT §5).
 *
 * Empty is a normal state for weeks: no tags until lane B's writers run, no
 * beliefs until lane C's. Every panel names its absence, and the cloud falls
 * back to the subjects alone (sized by the memories that name them).
 */
import { band, strength } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import type { MemoryRow, ReadOnlyStore } from "../../../../core/store/index.js";
import { normalizeTag } from "../../../../core/store/wave2.js";
import type { Band, Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import type { DashboardSource } from "../../source.js";
import { reveal } from "../reveal.js";
import { feelingsShown, shownOf } from "./memory-words.js";
import type { DateFrom, FeelingShown } from "./memory-words.js";

/** The kinds of subject, in the order the tab lists them; null is "not sorted yet". */
export const SUBJECT_ORDER = ["person", "project", "place", "topic", "self"] as const;

/** What the page calls each kind. */
export const KIND_WORDS: Readonly<Record<string, string>> = {
  person: "person",
  project: "project",
  place: "place",
  topic: "topic",
  self: "me",
};

/** What the tab calls each kind's group. */
const GROUP_WORDS: Readonly<Record<string, string>> = {
  person: "People",
  project: "Projects",
  place: "Places",
  topic: "Topics",
  self: "Me",
};

/** How many beliefs a subject's page lists before it says how many more. */
export const BELIEFS_SHOWN = 12;
/** How many sources a belief line lists before it says how many more. */
export const SOURCES_SHOWN = 5;
/** How many recent memories a subject's page lists. */
export const MEMORIES_SHOWN = 12;
/** How many words the cloud holds at most. */
export const CLOUD_MAX = 60;
/** How many concept edges each cloud word carries. */
const NEAR_MAX = 6;

// ─────────────────────────────────────────────────────────────────────────────
// reading the cards and their beliefs
// ─────────────────────────────────────────────────────────────────────────────

interface Card {
  readonly id: string;
  readonly name: string;
  readonly aliases: string[];
  readonly subjectKind: string | null;
  /** The identity core: the card install names after the owner. */
  readonly owner: boolean;
  readonly row: MemoryRow;
}

interface BeliefRow {
  readonly id: string;
  readonly entityId: string;
  readonly groundedIn: string[];
  readonly row: MemoryRow;
}

function metaOf(row: MemoryRow): Record<string, unknown> {
  try {
    const m = JSON.parse(row.meta) as unknown;
    return typeof m === "object" && m !== null ? (m as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The live schema rows, split into cards and beliefs. Removed rows (deny-list, tombstone) are left out. */
function readSchemas(store: ReadOnlyStore): { cards: Card[]; beliefs: BeliefRow[] } {
  const denied = new Set(store.deniedIds());
  const cards: Card[] = [];
  const beliefs: BeliefRow[] = [];
  for (const id of store.list({ type: "schema", archived: false })) {
    if (denied.has(id)) continue;
    const row = store.row(id);
    if (row === undefined || row.body === "" || row.superseded_by !== null) continue;
    const meta = metaOf(row);
    if (meta["role"] === "entity") {
      // Undefined on a v13 file read before its upgrade (`OBSERVER_READ_FLOOR`).
      const subjectKind = row.subject_kind ?? null;
      const name = typeof meta["name"] === "string" ? meta["name"].trim() : "";
      const aliases = Array.isArray(meta["aliases"]) ? meta["aliases"].filter((a): a is string => typeof a === "string") : [];
      cards.push({
        id,
        name: name.length > 0 ? name : subjectKind === "self" ? "Me" : (row.title ?? id),
        aliases,
        subjectKind,
        owner: row.kind === "self",
        row,
      });
    } else if (meta["role"] === "belief" && typeof meta["entityId"] === "string") {
      const g = meta["groundedIn"];
      beliefs.push({
        id,
        entityId: meta["entityId"],
        groundedIn: Array.isArray(g) ? g.filter((x): x is string => typeof x === "string") : [],
        row,
      });
    }
  }
  return { cards, beliefs };
}

/** The tags a card answers to: its name and aliases, as the store normalizes a tag. */
function tagKeysOf(card: Card): string[] {
  if (card.subjectKind === "self") return [];
  return [...new Set([card.name, ...card.aliases].map(normalizeTag).filter((t) => t.length > 0))];
}

/**
 * Which subject each tag is the name of. Cards come in the order that wins a
 * shared name (the first one holding it); `bySize` puts the card more memories
 * name first, for a caller that has not ordered them.
 */
function subjectByTag(cards: readonly Card[], bySize?: ReadOnlyStore): Map<string, string> {
  let ordered = cards;
  if (bySize !== undefined) {
    const size = new Map(cards.map((c) => [c.id, bySize.memoriesNaming(c.id).length]));
    ordered = [...cards].sort((a, b) => (size.get(b.id) ?? 0) - (size.get(a.id) ?? 0));
  }
  const out = new Map<string, string>();
  for (const c of ordered) for (const k of tagKeysOf(c)) if (!out.has(k)) out.set(k, c.id);
  return out;
}

/** A memory row the subjects tab counts: live, not replaced, not the journal. One filter for every count here. */
function counted(row: MemoryRow | undefined): row is MemoryRow {
  return row !== undefined && row.archived === 0 && row.superseded_by === null && !isJournal(row);
}

/**
 * A subject's memories — what names it, and what carries its name as a tag —
 * not the card, not its own beliefs (the page lists those above), and only
 * the rows `counted` allows. The list's chip count and the page's "of N" are
 * both this, so they agree.
 */
function memoriesOf(
  store: ReadOnlyStore,
  card: Card,
  beliefs: readonly BeliefRow[],
  tagged: boolean,
): { via: Map<string, "names" | "tag" | "both">; found: { id: string; row: MemoryRow }[] } {
  const own = new Set([card.id, ...beliefs.filter((b) => b.entityId === card.id).map((b) => b.id)]);
  const via = new Map<string, "names" | "tag" | "both">();
  for (const m of store.memoriesNaming(card.id)) if (!own.has(m)) via.set(m, "names");
  if (tagged) {
    for (const k of tagKeysOf(card)) {
      for (const m of store.memoriesTagged(k)) {
        if (own.has(m)) continue;
        const was = via.get(m);
        via.set(m, was === undefined || was === "tag" ? "tag" : "both");
      }
    }
  }
  const found: { id: string; row: MemoryRow }[] = [];
  for (const m of via.keys()) {
    const row = store.row(m);
    if (counted(row)) found.push({ id: m, row });
  }
  return { via, found };
}

/**
 * The card's own words as the page shows them: a markdown heading line is
 * dropped, and the birth stub a card is minted with ("Born by mention on
 * lived day 23. Asserts nothing yet.") is internal wording, not something it
 * says — so it reads as nothing.
 */
export function cardWords(body: string): string {
  const text = body
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n")
    .trim();
  if (/^Born by mention on lived day \d+\.\s*Asserts nothing yet\.?$/i.test(text)) return "";
  return text;
}

function hasTags(store: ReadOnlyStore): boolean {
  return store.tagCounts({ limit: 1 }).length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// the tab: the cloud and every subject
// ─────────────────────────────────────────────────────────────────────────────

export interface SubjectRow {
  readonly id: string;
  readonly name: string;
  /** `person`, `project`, `place`, `topic`, `self` — or null, not sorted yet. */
  readonly kind: string | null;
  readonly owner: boolean;
  /** Live beliefs about it. */
  readonly beliefs: number;
  /** Live memories that name it (`memory_subjects`) or carry its name as a tag — the page's "of N". */
  readonly memories: number;
  /** How many live cards share its name (twins are one subject here); 1 for most. */
  readonly cards: number;
}

export interface CloudWord {
  /** `s:<id>` for a subject, `t:<tag>` for a tag. */
  readonly key: string;
  readonly word: string;
  /** The subject it opens, or null for a plain tag. */
  readonly subject: string | null;
  readonly kind: string | null;
  /** How many live memories are behind it. */
  readonly weight: number;
  /** 1 (smallest) to 5, from the weight. */
  readonly size: number;
  /** Keys of the words it most often shares memories with (concept edges), most first. */
  readonly near: string[];
}

export interface SubjectsView {
  readonly cloud: CloudWord[];
  /** Words left out of the cloud for room. */
  readonly cloudMore: number;
  /** True once any memory carries a tag; until then the cloud is subjects alone. */
  readonly tagged: boolean;
  readonly cloudAbsent: string | null;
  /** Every subject, by kind (`SUBJECT_ORDER`, then the unsorted). */
  readonly groups: { readonly kind: string | null; readonly label: string; readonly subjects: SubjectRow[] }[];
  readonly total: number;
  readonly beliefs: number;
  /** The subject that is me, when it has been made. */
  readonly self: string | null;
  readonly absent: string | null;
}

/** 1–5 by the square root of the weight between the lightest and the heaviest. */
function sizer(weights: readonly number[]): (w: number) => number {
  const lo = Math.sqrt(Math.min(...weights, Infinity));
  const hi = Math.sqrt(Math.max(...weights, 0));
  return (w) => (hi <= lo ? 3 : 1 + Math.round(((Math.sqrt(w) - lo) / (hi - lo)) * 4));
}

export function subjectsView(src: DashboardSource): SubjectsView {
  const store = src.store;
  const { cards, beliefs } = readSchemas(store);
  const beliefCount = new Map<string, number>();
  for (const b of beliefs) beliefCount.set(b.entityId, (beliefCount.get(b.entityId) ?? 0) + 1);
  const tagged = hasTags(store);
  const counts = tagged ? store.tagCounts() : [];
  const tagWeight = new Map(counts.map((c) => [c.tag, c.memories]));

  const every: SubjectRow[] = cards.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.subjectKind,
    owner: c.owner,
    beliefs: beliefCount.get(c.id) ?? 0,
    memories: memoriesOf(store, c, beliefs, tagged).found.length,
    cards: 1,
  }));
  every.sort((a, b) => b.memories - a.memories || b.beliefs - a.beliefs || a.name.localeCompare(b.name));
  // TWINS: two live cards with one name (the store holds dozens of pairs,
  // minted twice on one day) are one subject here — one chip, one word —
  // opening the heavier card, which `every` already lists first, and saying
  // how many cards it stands for. The double mint is lane B's to merge.
  const lead = new Map<string, SubjectRow>();
  const rows: SubjectRow[] = [];
  for (const r of every) {
    const key = normalizeTag(r.name);
    const first = lead.get(key);
    if (first !== undefined) {
      lead.set(key, { ...first, cards: first.cards + 1 });
      continue;
    }
    lead.set(key, r);
    rows.push(r);
  }
  for (let i = 0; i < rows.length; i++) rows[i] = lead.get(normalizeTag((rows[i] as SubjectRow).name)) as SubjectRow;
  // A tag that IS a subject's name is that subject in the cloud (the heavier
  // card, when two share a name).
  const byId = new Map(cards.map((c) => [c.id, c]));
  const tagToSubject = subjectByTag(rows.map((r) => byId.get(r.id)).filter((c): c is Card => c !== undefined));

  const groups = [...SUBJECT_ORDER, null].map((kind) => ({
    kind,
    label: kind === null ? "Not sorted yet" : (GROUP_WORDS[kind] ?? kind),
    subjects: rows.filter((r) => r.kind === kind),
  })).filter((g) => g.subjects.length > 0);

  // The cloud: every subject with something behind it, and every tag that is
  // not a subject's name. The heaviest CLOUD_MAX, then alphabetical.
  const candidates: { key: string; word: string; subject: string | null; kind: string | null; weight: number }[] = [];
  // Two cards with one name (the store has a few) are one word in the cloud:
  // the heavier, which `rows` already lists first. The list below keeps both.
  const worded = new Set<string>();
  for (const r of rows) {
    const weight = r.memories + r.beliefs;
    const word = normalizeTag(r.name);
    if (weight === 0 || worded.has(word)) continue;
    worded.add(word);
    candidates.push({ key: `s:${r.id}`, word: r.name, subject: r.id, kind: r.kind, weight });
  }
  for (const c of counts) {
    if (tagToSubject.has(c.tag)) continue;
    candidates.push({ key: `t:${c.tag}`, word: c.tag, subject: null, kind: null, weight: c.memories });
  }
  candidates.sort((a, b) => b.weight - a.weight || a.word.localeCompare(b.word));
  const kept = candidates.slice(0, CLOUD_MAX);
  const keyOfTag = (tag: string): string => {
    const s = tagToSubject.get(tag);
    return s === undefined ? `t:${tag}` : `s:${s}`;
  };
  const size = sizer(kept.map((k) => k.weight));
  const inCloud = new Set(kept.map((k) => k.key));
  const cloud: CloudWord[] = kept
    .map((k) => {
      let near: string[] = [];
      if (tagged) {
        const card = k.subject === null ? undefined : byId.get(k.subject);
        const own = card === undefined ? [k.word] : tagKeysOf(card);
        if (own.length > 0 && own.some((t) => tagWeight.has(t))) {
          near = [...new Set(store.tagNeighbours(own, { limit: NEAR_MAX * 2 }).map((n) => keyOfTag(n.tag)))]
            .filter((key) => key !== k.key && inCloud.has(key))
            .slice(0, NEAR_MAX);
        }
      }
      return { ...k, size: size(k.weight), near };
    })
    .sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: "base" }));

  const everLived = store.livedDay() > 0;
  return {
    cloud,
    cloudMore: Math.max(0, candidates.length - kept.length),
    tagged,
    cloudAbsent: cloud.length > 0 ? null : everLived ? NONE : NEVER,
    groups,
    total: rows.length,
    beliefs: beliefs.length,
    self: store.selfSubject(),
    absent: rows.length > 0 ? null : everLived ? NONE : NEVER,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// one subject's page
// ─────────────────────────────────────────────────────────────────────────────

export interface SourceLine {
  readonly id: string;
  readonly text: string;
  readonly present: boolean;
  /** `support` or `contrary`, from `belief_support`; `cited` for a `groundedIn` source not counted there. */
  readonly stance: "support" | "contrary" | "cited";
  /** How it was filed (`belief_support.route`), when it was. */
  readonly route: string | null;
  /** The lived day it was counted, when it was. */
  readonly day: number | null;
}

export interface BeliefLine {
  readonly id: string;
  readonly text: string;
  readonly strength: number;
  readonly band: Band;
  /** Memories counted for it, each once. */
  readonly support: number;
  /** Memories counted against it. */
  readonly contrary: number;
  /** Distinct lived days among what holds it up — support spread, not volume. */
  readonly supportDays: number;
  readonly sources: SourceLine[];
  /** Sources past `SOURCES_SHOWN`. */
  readonly sourcesMore: number;
  /** How it was born (`birth_route`), when recorded. */
  readonly route: string | null;
  readonly confidence: number | null;
  /** `me` / `us` / … — the row's `about` mark. */
  readonly about: string | null;
  readonly bornDay: number;
  readonly protected: boolean;
  readonly core: boolean;
  /** Pressure against it (contrary challenges), as recorded. */
  readonly pressure: number;
}

export interface SubjectMemory {
  readonly id: string;
  readonly title: string | null;
  readonly text: string;
  readonly kind: Kind;
  readonly date: string | null;
  readonly dateFrom: DateFrom | null;
  readonly core: boolean;
  readonly protected: boolean;
  readonly feelings: FeelingShown[];
  /** How it reached this page: it names the subject, carries its tag, or both. */
  readonly via: "names" | "tag" | "both";
  readonly bornDay: number;
}

export interface NearTag {
  readonly tag: string;
  readonly together: number;
  /** The subject the tag is the name of, when it is one. */
  readonly subject: string | null;
}

export type SubjectPage =
  | {
      readonly found: true;
      readonly id: string;
      readonly name: string;
      readonly aliases: string[];
      readonly kind: string | null;
      readonly kindWords: string;
      readonly owner: boolean;
      readonly self: boolean;
      /** The card's own words. */
      readonly text: string;
      readonly bornDay: number;
      readonly beliefs: BeliefLine[];
      readonly beliefsMore: number;
      readonly beliefsAbsent: string | null;
      readonly memories: SubjectMemory[];
      readonly memoriesTotal: number;
      readonly memoriesAbsent: string | null;
      /** Concept edges: the tags most often on the same memories as its name. */
      readonly near: NearTag[];
      /** True once any memory carries a tag (so an empty `near` means "none", not "not yet"). */
      readonly tagged: boolean;
    }
  | { readonly found: false; readonly id: string; readonly absent: string };

function beliefLine(store: ReadOnlyStore, b: BeliefRow, day: number): BeliefLine {
  const physics = store.physicsOf(b.id);
  const filed = store.supportOf(b.id);
  const counted = new Set(filed.map((f) => f.memoryId));
  const sources: SourceLine[] = [];
  // Support first, newest counted first; then what argues against; then a
  // cited source the support ledger has not counted.
  const ordered = [...filed].sort((x, y) => (x.stance === y.stance ? y.day - x.day : x.stance === "support" ? -1 : 1));
  for (const f of ordered) {
    const r = reveal(store, f.memoryId, 140);
    sources.push({
      id: f.memoryId,
      text: r.text ?? r.label,
      present: r.present,
      stance: f.stance === "contrary" ? "contrary" : "support",
      route: f.route,
      day: f.day,
    });
  }
  for (const g of b.groundedIn) {
    if (counted.has(g)) continue;
    counted.add(g);
    const r = reveal(store, g, 140);
    sources.push({ id: g, text: r.text ?? r.label, present: r.present, stance: "cited", route: null, day: null });
  }
  const support = filed.filter((f) => f.stance !== "contrary");
  const days = new Set(support.map((f) => f.bornDay ?? f.day));
  const row = b.row;
  return {
    id: b.id,
    text: row.body.trim(),
    strength: strength(physics, day),
    band: band(physics, day),
    support: support.length,
    contrary: filed.length - support.length,
    supportDays: days.size,
    sources: sources.slice(0, SOURCES_SHOWN),
    sourcesMore: Math.max(0, sources.length - SOURCES_SHOWN),
    route: row.birth_route ?? null,
    confidence: row.confidence ?? null,
    about: row.about ?? null,
    bornDay: physics.birthDay,
    protected: physics.protected === true,
    core: physics.promotedIdentity === true,
    pressure: physics.pressure,
  };
}

/** `id` may be `me`: the subject that is me, when it has been made. */
export function subjectView(src: DashboardSource, id: string): SubjectPage {
  const store = src.store;
  const wanted = id === "me" ? store.selfSubject() : id;
  if (wanted === null) {
    return { found: false, id, absent: `${NONE} — I have no page about myself yet; it is made with my first belief about me.` };
  }
  const { cards, beliefs } = readSchemas(store);
  const card = cards.find((c) => c.id === wanted);
  if (card === undefined) {
    if (store.row(wanted) === undefined) return { found: false, id, absent: "no subject has that id" };
    const r = reveal(store, wanted, 60);
    return { found: false, id, absent: r.present ? "that memory is not a subject" : r.label };
  }
  const day = store.livedDay();
  const tagged = hasTags(store);

  const lines = beliefs.filter((b) => b.entityId === card.id).map((b) => beliefLine(store, b, day));
  lines.sort((a, b) => b.strength - a.strength || b.support - a.support || (a.id < b.id ? -1 : 1));

  const { via, found } = memoriesOf(store, card, beliefs, tagged);
  found.sort((a, b) => b.row.birth_day - a.row.birth_day || (b.row.created_at ?? 0) - (a.row.created_at ?? 0) || (a.id < b.id ? 1 : -1));
  const memories: SubjectMemory[] = found.slice(0, MEMORIES_SHOWN).map(({ id: m, row }) => {
    const r = reveal(store, m, 200);
    const shown = shownOf(row.body, { chapter: false, learnedOn: row.learned_on, absent: !r.present, absentLabel: r.label });
    const t = row.title?.trim() ?? "";
    return {
      id: m,
      title: t.length > 0 ? t : null,
      text: shown.text,
      kind: row.kind,
      date: shown.date,
      dateFrom: shown.dateFrom,
      core: row.promoted_identity === 1,
      protected: row.protected === 1,
      feelings: feelingsShown(store, m),
      via: via.get(m) ?? "names",
      bornDay: row.birth_day,
    };
  });

  const keys = tagKeysOf(card);
  let near: NearTag[] = [];
  if (tagged && keys.length > 0) {
    const tagToSubject = subjectByTag(cards, store);
    near = store.tagNeighbours(keys, { limit: 12 }).map((n) => ({ tag: n.tag, together: n.together, subject: tagToSubject.get(n.tag) ?? null }));
  }

  const shownBeliefs = lines.slice(0, BELIEFS_SHOWN);
  return {
    found: true,
    id: card.id,
    name: card.name,
    aliases: card.aliases,
    kind: card.subjectKind,
    kindWords: card.subjectKind === null ? "not sorted yet" : (KIND_WORDS[card.subjectKind] ?? card.subjectKind),
    owner: card.owner,
    self: card.subjectKind === "self",
    text: cardWords(card.row.body),
    bornDay: card.row.birth_day,
    beliefs: shownBeliefs,
    beliefsMore: Math.max(0, lines.length - shownBeliefs.length),
    beliefsAbsent: lines.length > 0 ? null : NONE,
    memories,
    memoriesTotal: found.length,
    memoriesAbsent: found.length > 0 ? null : NONE,
    near,
    tagged,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// one tag (a cloud word that is not a subject)
// ─────────────────────────────────────────────────────────────────────────────

export interface TagView {
  readonly tag: string;
  readonly total: number;
  readonly memories: { readonly id: string; readonly text: string; readonly bornDay: number }[];
  readonly near: NearTag[];
  readonly absent: string | null;
}

export function tagView(src: DashboardSource, raw: string): TagView {
  const store = src.store;
  const tag = normalizeTag(raw);
  const ids = tag.length === 0 ? [] : store.memoriesTagged(tag);
  // The rows `counted` allows — what the cloud's weight (`tagCounts`) counts, journal aside.
  const rows = ids
    .map((id) => ({ id, row: store.row(id) }))
    .filter((x): x is { id: string; row: MemoryRow } => counted(x.row))
    .sort((a, b) => b.row.birth_day - a.row.birth_day || (a.id < b.id ? 1 : -1));
  const { cards } = readSchemas(store);
  const tagToSubject = subjectByTag(cards, store);
  return {
    tag,
    total: rows.length,
    memories: rows.slice(0, MEMORIES_SHOWN).map(({ id, row }) => {
      const r = reveal(store, id, 140);
      return { id, text: r.text ?? r.label, bornDay: row.birth_day };
    }),
    near: tag.length === 0 ? [] : store.tagNeighbours([tag], { limit: 10 }).map((n) => ({ tag: n.tag, together: n.together, subject: tagToSubject.get(n.tag) ?? null })),
    absent: rows.length > 0 ? null : NONE,
  };
}
