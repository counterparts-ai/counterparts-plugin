/**
 * A NIGHT BY ITS ID (2026-10-20): `recall` with a dream's id (`drm_…`) or a
 * reflection's (`rfl_…`) as its handle or among its ids reads a short summary
 * of that record. The wake says "I dreamed … (drm_…)" and the morning share
 * names its reflection; until now neither id opened, and the only reader was
 * the console's `dream`, which also undoes — so a session could not review
 * last night with the owner.
 *
 * READ-ONLY, AND NOT A MEMORY. A night is a row in `dreams` / `reflections`,
 * not in `memories`, so a summary rides beside `memories` on the result
 * (`DeliberateResult.nights`), never in it: nothing that credits a use, marks
 * a memory seen, or logs a title's resolution reads this field. Opening a
 * night credits nothing; opening one of the memory ids it names is an
 * ordinary open, credited as any other.
 *
 * In any session, a summary carries no memory's body but a short gist's: the
 * ids are there to open, and an open crosses recall's own boundary. (The
 * confidentiality boundary that also stood here was retired 2026-10-21.)
 *
 * Pure reads over the store; never writes, never throws past its caller.
 * (A dream's RECALL is noted by the server, `dream/recalled.ts`, so a dream
 * that is used keeps its reach — D1, 2026-10-27; reading still credits no
 * memory.)
 */
import type { Counterpart } from "../../core/counterpart.js";
import { clipWire, wireChars } from "../../core/fit/index.js";
import { dreamReach } from "../../core/dream/recalled.js";
import { DREAM_TUNABLES } from "../../core/dream/tunables.js";
import { STOPWORDS } from "../../core/recall/reference.js";
import { rowTombstoned } from "../../core/store/index.js";
import type { DreamChangeRow, DreamRow, ReflectionRow, Store } from "../../core/store/index.js";

/** How many memory ids a summary names per kind of change before it counts the rest. */
export const NIGHT_IDS_PER_KIND = 12;
/** A gist is quoted when it is at most this long; a longer one is named by id. */
export const NIGHT_GIST_CHARS = 280;
/** How much of a dream's journal a summary carries (the console prints it whole). */
export const NIGHT_JOURNAL_CHARS = 1_200;
/** How much of a reflection's entry a summary carries. */
export const NIGHT_ENTRY_CHARS = 3_000;

/**
 * WHOLE, UP TO WHAT ONE ANSWER CARRIES (review of #645). A night read whole
 * keeps its journal or entry uncut up to this many wire characters
 * (`fit#wireChars`): the longest journal a dream may write (30,000) fits, so
 * in English "whole" is whole; a text past it (another script, three to a
 * character) is cut, and `journalChars` / `entryChars` says so.
 */
export const NIGHT_WHOLE_WIRE_CHARS = 32_000;

/** Said once on a result that carries a night, so `nights` is not a bare field. */
export const NIGHTS_GLOSS =
  "A night is a dream (drm_) or a reflection (rfl_) the nightly run made: a read-only summary, not a memory. Reading it changes no memory and credits nothing (a dream read whole is noted, so it stays in reach); the memory ids it names open by id as usual. Undoing a dream is the owner's, in the console.";

/** Is this handle a night's id — a dream's or a reflection's? */
export function nightKindOf(handle: string): "dream" | "reflection" | null {
  const h = handle.trim();
  if (/^drm_[0-9a-f]+$/.test(h)) return "dream";
  if (/^rfl_[0-9a-f]+$/.test(h)) return "reflection";
  return null;
}

/** Memory ids, some of them, and how many more there were. */
export interface IdsCapped {
  readonly ids: readonly string[];
  readonly more: number;
}

export interface DreamSummary {
  readonly kind: "dream";
  /** `[dream]` (D1, 2026-10-27): wherever recall shows a dream, it says so, as `[journal]` marks a chapter. */
  readonly label: "[dream]";
  /** "dreamed, not lived: …" — told as a dream, never as something that happened. */
  readonly dreamed: string;
  readonly id: string;
  readonly date: string | null;
  readonly day: number;
  /** `begun`, `journaled`, `undone`, … as the row says. */
  readonly state: string;
  readonly title: string | null;
  /** Its journal, cut at `NIGHT_JOURNAL_CHARS`; `journalChars` is the whole length. */
  readonly journal?: string;
  readonly journalChars?: number;
  /** What it did that still stands, by kind (`dreams.counts`: undone changes are not counted). */
  readonly counts: Readonly<Record<string, number>>;
  /** Changes since undone, when there are any. */
  readonly undone?: number;
  /** The memory ids each kind of change touched, capped per kind. */
  readonly touched: Readonly<Record<string, IdsCapped>>;
  /** Its gists: the text when short, else the id alone. */
  readonly gists: readonly { id: string; text?: string; chars?: number }[];
  /** Gists past `NIGHT_IDS_PER_KIND`, counted rather than listed (a night of hundreds stays small). */
  readonly gistsMore?: number;
  /** The reflections after it, newest first. */
  readonly reflections: readonly string[];
}

export interface ReflectionSummary {
  readonly kind: "reflection";
  readonly id: string;
  readonly date: string | null;
  readonly day: number;
  /** `begun`, `reflected`. */
  readonly state: string;
  readonly title: string | null;
  /** The dream it followed, or null when it reflected on its own. */
  readonly dream: string | null;
  readonly entry: string | null;
  readonly entryChars?: number;
  /** The memory its entry became. */
  readonly entryId: string | null;
  readonly share: string | null;
  /** The night's own line (`Reflections#finish`'s `line`, NL1): absent on an older row and on a night that left it empty. */
  readonly line?: string;
  /** `none`, `offered`, `carried`, `told`. */
  readonly shareState: string;
  readonly told: boolean;
  readonly cites: IdsCapped;
  readonly closes: { readonly proposed: readonly string[]; readonly closed: readonly string[] };
  /** The self-page version it wrote, or null. */
  readonly pageVersion: number | null;
}

export type NightSummary = DreamSummary | ReflectionSummary;

export type NightRead =
  | { readonly ok: true; readonly night: NightSummary }
  | { readonly ok: false; readonly reason: "handle-unknown" };

function ids(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function detailOf(json: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function capped(list: readonly string[], max = NIGHT_IDS_PER_KIND): IdsCapped {
  const unique = [...new Set(list)];
  return { ids: unique.slice(0, max), more: Math.max(0, unique.length - max) };
}

function cut(text: string, max: number): { text: string; chars?: number } {
  if (max === Number.POSITIVE_INFINITY) {
    // Whole: uncut up to what one answer carries, measured on the wire.
    return wireChars(text) <= NIGHT_WHOLE_WIRE_CHARS ? { text } : { text: clipWire(text, NIGHT_WHOLE_WIRE_CHARS), chars: text.length };
  }
  return text.length <= max ? { text } : { text: `${text.slice(0, max - 1)}…`, chars: text.length };
}

/** The memory ids one change names: its two refs, and a merge's originals. */
function changeIds(c: DreamChangeRow): string[] {
  const out: string[] = [];
  if (c.ref !== null) out.push(c.ref);
  if (c.ref2 !== null) out.push(c.ref2);
  if (c.action === "merge") out.push(...stringList(detailOf(c.detail)["from"]));
  return out;
}

/** The key `dreams.counts` files a change under: a fold is its own kind. */
function kindOf(c: DreamChangeRow): string {
  return c.action === "gist" && detailOf(c.detail)["fold"] === true ? "fold" : c.action;
}

function dreamSummary(counterpart: Counterpart, dream: DreamRow, changes: readonly DreamChangeRow[], journalMax: number = NIGHT_JOURNAL_CHARS): DreamSummary {
  const store = counterpart.store;
  const standing = changes.filter((c) => c.undone !== 1);
  const byKind = new Map<string, string[]>();
  for (const c of standing) {
    const k = kindOf(c);
    byKind.set(k, [...(byKind.get(k) ?? []), ...changeIds(c)]);
  }
  const touched: Record<string, IdsCapped> = {};
  for (const [k, list] of byKind) touched[k] = capped(list);
  const gists: { id: string; text?: string; chars?: number }[] = [];
  let gistsMore = 0;
  for (const c of standing) {
    if ((c.action !== "gist" && c.action !== "fold") || c.ref === null) continue;
    if (gists.length >= NIGHT_IDS_PER_KIND) {
      gistsMore += 1;
      continue;
    }
    const row = store.row(c.ref);
    if (row === undefined || rowTombstoned(row)) continue;
    const body = row.body.trim();
    gists.push(body.length <= NIGHT_GIST_CHARS ? { id: c.ref, text: body } : { id: c.ref, chars: body.length });
  }
  const undone = changes.length - standing.length;
  const journal = dream.journal === null || dream.journal.trim().length === 0 ? null : cut(dream.journal.trim(), journalMax);
  return {
    kind: "dream",
    label: DREAM_LABEL,
    dreamed: dreamedLine(dream),
    id: dream.id,
    date: dream.date,
    day: dream.day,
    state: dream.state,
    title: dream.title,
    ...(journal === null ? {} : { journal: journal.text, ...(journal.chars === undefined ? {} : { journalChars: journal.chars }) }),
    counts: counterpart.dreams.counts(dream.id),
    ...(undone > 0 ? { undone } : {}),
    touched,
    gists,
    ...(gistsMore > 0 ? { gistsMore } : {}),
    reflections: store.reflections({ dreamId: dream.id, limit: 5 }).map((r) => r.id),
  };
}

function reflectionSummary(store: Store, r: ReflectionRow, entryMax: number = NIGHT_ENTRY_CHARS): ReflectionSummary {
  const d = detailOf(r.detail);
  const list = stringList;
  const title = typeof d["title"] === "string" ? d["title"] : null;
  const entry = r.entry === null ? null : cut(r.entry, entryMax);
  return {
    kind: "reflection",
    id: r.id,
    date: r.date,
    day: r.day,
    state: r.state,
    title,
    dream: r.dream_id,
    entry: entry === null ? null : entry.text,
    ...(entry?.chars === undefined ? {} : { entryChars: entry.chars }),
    entryId: r.entry_id,
    share: r.share,
    ...(typeof d["line"] === "string" && d["line"].length > 0 ? { line: d["line"] } : {}),
    shareState: r.share_state,
    told: r.share_state === "told",
    cites: capped(ids(r.cites)),
    closes: { proposed: list(d["closeProposed"]), closed: list(d["closed"]) },
    pageVersion: r.page_version,
  };
}

/**
 * ONE NIGHT, by its id: a summary, or why not. `whole` (2026-10-26, OL1b): the
 * journal and the entry uncut — a night asked for alone, by its handle, which
 * is how a chat with no console reads one (`readLastNight` too). Among `ids`
 * it stays a summary, so ten nights beside the memories stay small.
 */
export function readNight(counterpart: Counterpart, id: string, opts: { readonly whole?: boolean } = {}): NightRead {
  const kind = nightKindOf(id);
  const store = counterpart.store;
  const whole = opts.whole === true;
  try {
    if (kind === "dream") {
      const shown = counterpart.dreams.show(id.trim());
      if (shown === null) return { ok: false, reason: "handle-unknown" };
      return { ok: true, night: dreamSummary(counterpart, shown.dream, shown.changes, whole ? Number.POSITIVE_INFINITY : NIGHT_JOURNAL_CHARS) };
    }
    if (kind === "reflection") {
      const r = counterpart.reflections.show(id.trim());
      if (r === null) return { ok: false, reason: "handle-unknown" };
      return { ok: true, night: reflectionSummary(store, r, whole ? Number.POSITIVE_INFINITY : NIGHT_ENTRY_CHARS) };
    }
  } catch {
    // A read that fails answers as not found; recall never throws at a tool.
  }
  return { ok: false, reason: "handle-unknown" };
}

// ── last night, and nights a question names (2026-10-26, OL1b item 3) ────────

/**
 * THE HANDLES THAT READ THE NEWEST NIGHT WHOLE. On claude.ai there is no
 * dashboard and no console, and on the trial's first day "what was your last
 * dream?" found the reflection by meaning, not the dream; "show me the full
 * dream" could not be answered at all (a dream opened only by its exact id,
 * and then as a summary). Exact, like every handle: these words, any case.
 */
export const LAST_NIGHT_HANDLES: readonly string[] = ["last dream", "last night"];

export function isLastNightHandle(handle: unknown): boolean {
  return typeof handle === "string" && LAST_NIGHT_HANDLES.includes(handle.trim().toLowerCase());
}

/** The newest night, whole: its dream and the reflection after it. */
export interface LastNight {
  readonly dream: DreamSummary | null;
  /** Whole; or, past the room (`roomFor` in `readLastNight`), a short summary or just its id. */
  readonly reflection: ReflectionSummary | ReflectionPointer | null;
  /** How the reflection came when the two together passed the room; absent when whole. */
  readonly reflectionCut?: "summary" | "pointer";
}

/** A reflection named by id alone: the room went to the dream. */
export interface ReflectionPointer {
  readonly kind: "reflection";
  readonly id: string;
  readonly date: string | null;
  readonly title: string | null;
  readonly line?: string;
  readonly shareState: string;
  readonly told: boolean;
}

/** Room for the two parts of last night together, in wire characters, under one answer's ceiling. */
export const LAST_NIGHT_WIRE_CHARS = 36_000;

/**
 * The newest dream that wrote a journal and was not undone (else the newest
 * dream), with the newest reflection after it; with no dream at all, the
 * newest reflection — the console's `night last` rule. Journal and entry
 * whole. Pure reads; null parts when there is nothing; never throws.
 *
 * ONE ANSWER'S ROOM (review of #645): a dream may journal 30,000 characters
 * and its reflection 20,000 more, past what one tool answer carries — and the
 * server's last net cuts only a top-level string, so the two would have
 * shipped over it whole and been spilled by the host. Past `room`, the dream
 * stays whole and the reflection comes as a summary (its entry cut, and said),
 * or by id alone; its id read as a handle opens it whole on its own.
 */
export function readLastNight(counterpart: Counterpart, room: number = LAST_NIGHT_WIRE_CHARS, readable?: DreamReadable): LastNight {
  const store = counterpart.store;
  try {
    // The folder rule (D1): a dream from a folder this session may not read is
    // not its last night — filtered before the limit, so twenty unreadable
    // dreams do not hide a readable older one (review of #663).
    const recent = readableDreams(store, readable, 20);
    const dream = recent.find((d) => d.journal !== null && d.journal.trim().length > 0 && d.state !== "undone") ?? recent[0];
    const dreamRead = dream === undefined ? null : readNight(counterpart, dream.id, { whole: true });
    const after = dream === undefined ? readableReflection(store, readable) : store.reflections({ dreamId: dream.id, limit: 1 })[0];
    const reflectionRead = after === undefined ? null : readNight(counterpart, after.id, { whole: true });
    const d = dreamRead?.ok === true && dreamRead.night.kind === "dream" ? dreamRead.night : null;
    const r = reflectionRead?.ok === true && reflectionRead.night.kind === "reflection" ? reflectionRead.night : null;
    const fits = (x: unknown): boolean => wireChars(JSON.stringify({ dream: d, reflection: x })) <= room;
    if (r === null || after === undefined || fits(r)) return { dream: d, reflection: r };
    const summary = reflectionSummary(store, after);
    if (fits(summary)) return { dream: d, reflection: summary, reflectionCut: "summary" };
    const pointer: ReflectionPointer = { kind: "reflection", id: r.id, date: r.date, title: r.title, ...(r.line === undefined ? {} : { line: r.line }), shareState: r.shareState, told: r.told };
    return { dream: d, reflection: pointer, reflectionCut: "pointer" };
  } catch {
    return { dream: null, reflection: null };
  }
}

/** At most this many dreams ride beside a question's answer. */
export const QUESTION_NIGHTS_MAX = 2;
/** How many recent dreams a question's words are matched against. */
export const QUESTION_NIGHTS_LOOKBACK = 30;

/** Does the question name dreaming? */
export function asksAboutDreams(question: string): boolean {
  return /\b(dream|dreams|dreamed|dreamt|dreaming)\b/i.test(question);
}

/**
 * Does a question about dreams ask WHEN — "when did you last dream?", "why
 * haven't you dreamed lately?" (D1, Ames's case)? Then the newest dream leads,
 * whatever else its words reach.
 */
export function asksWhenDreamed(question: string): boolean {
  return asksAboutDreams(question) && /\b(last|latest|lately|recent|recently|newest|when|today|tonight|yesterday|anymore)\b/i.test(question);
}

/** Words that ask WHEN or HOW about a dream, never what it was about (beside `STOPWORDS`). */
const ASKING_ABOUT_A_DREAM: ReadonlySet<string> = new Set([
  "dream", "dreams", "dreamed", "dreamt", "dreaming", "last", "latest", "lately", "recent", "recently", "newest",
  "night", "tonight", "today", "yesterday", "week", "ago", "anymore", "ever", "tell", "haven't", "havent", "didn't",
  "didnt", "hasn't", "hasnt", "share", "remember",
]);

/**
 * What a question asks about once the dream words and the asking are out
 * ("did you dream about the greenhouse?" → "greenhouse"): the text whose
 * MEANING a question that names dreaming is matched by. Content words only:
 * measured 10-27, the residue of "when did you last dream?" ("when did you
 * last") cosined 0.49 against a work dream on the static table — function
 * words carry a direction of their own. Empty when nothing is left but the
 * asking.
 */
export function dreamlessQuestion(question: string): string {
  const kept = question
    .toLowerCase()
    .split(/[^a-z']+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !ASKING_ABOUT_A_DREAM.has(w));
  return kept.join(" ");
}

/**
 * Who may read a dream: the folder rule every crossing obeys (`server.ts#
 * folderOn`, `lifecycle.ts#chapterExports`). A dream written in this
 * session's own folder, or with none (a run that named no place), is read
 * here; one written in another folder only while that folder's setting has it
 * on. Absent: every dream (no setting file).
 */
export type DreamReadable = (scope: string | null) => boolean;

/** The scope test for one dream; never throws (a test that throws reads as "not here"). */
function readableBy(readable: DreamReadable | undefined, scope: string | null): boolean {
  if (readable === undefined) return true;
  try {
    return readable(scope);
  } catch {
    return false;
  }
}

/** A dream wrote a journal. */
function journaled(d: DreamRow): boolean {
  return d.journal !== null && d.journal.trim().length > 0;
}

/**
 * The newest `n` dreams this session may read, newest first: the folder rule
 * applied BEFORE the limit (review of #663), reading further back while the
 * rows that came were not readable. Absent rule: the newest `n`. Throws only
 * as the store does.
 */
export function readableDreams(store: Store, readable: DreamReadable | undefined, n: number): DreamRow[] {
  if (readable === undefined) return store.dreams({ limit: n });
  for (let limit = n; ; limit *= 4) {
    const rows = store.dreams({ limit });
    const kept = rows.filter((d) => readableBy(readable, d.scope));
    if (kept.length >= n || rows.length < limit) return kept.slice(0, n);
  }
}

/** The newest reflection this session may read, by the same rule. */
function readableReflection(store: Store, readable: DreamReadable | undefined): ReflectionRow | undefined {
  if (readable === undefined) return store.reflections({ limit: 1 })[0];
  for (let limit = 20; ; limit *= 4) {
    const rows = store.reflections({ limit });
    const found = rows.find((r) => readableBy(readable, r.scope));
    if (found !== undefined || rows.length < limit) return found;
  }
}

/**
 * THE DREAMS A QUESTION MAY REACH BY WHAT THEY WERE ABOUT (D1, 2026-10-27),
 * newest first, among the last `QUESTION_NIGHTS_LOOKBACK` this session may
 * read that wrote a journal and were not undone. A question that NAMES
 * dreaming reaches any of them, faded or not: a person asked about a dream
 * remembers it (review of #663). Any other question reaches only those still
 * within their reach (`dream/recalled.ts`: a dream fades fast unless it is
 * recalled or retold). Computed once per recall: the server embeds these and
 * no others, and `nightsForQuestion` matches against the same list. Never
 * throws.
 */
export function dreamCandidates(counterpart: Counterpart, naming: boolean, readable?: DreamReadable): DreamRow[] {
  const store = counterpart.store;
  try {
    const today = store.livedDay();
    return readableDreams(store, readable, QUESTION_NIGHTS_LOOKBACK).filter(
      (d) => d.state !== "undone" && journaled(d) && (naming || dreamReach(store, d, today).inReach),
    );
  } catch {
    return [];
  }
}

/**
 * The texts one dream is matched by meaning through: its title, and its
 * journal in passages (`DREAM_RECALL_PASSAGE_CHARS`, under the static table's
 * 512-token cap, so imagery past the first ~2,000 characters is read too).
 * The match is the best of them.
 */
export function dreamPassages(d: Pick<DreamRow, "title" | "journal">): string[] {
  const out: string[] = [];
  const title = d.title?.trim() ?? "";
  if (title.length > 0) out.push(title);
  const journal = d.journal?.trim() ?? "";
  const size = DREAM_TUNABLES.DREAM_RECALL_PASSAGE_CHARS;
  for (let i = 0; i < journal.length; i += size) {
    const piece = journal.slice(i, i + size).trim();
    if (piece.length > 0) out.push(piece);
  }
  return out;
}

/** Why a dream rode beside a question's answer. */
export type QuestionNightWhy = "reflection-shown" | "words" | "meaning" | "asked-when" | "names-dreams";

/** The whys that count as recalling a dream (review of #663): a prompted match, or the newest when asked when. */
export const TOUCHING_WHYS: ReadonlySet<QuestionNightWhy> = new Set<QuestionNightWhy>(["words", "meaning", "asked-when"]);

export interface QuestionNightsOptions {
  /**
   * Each reachable dream's MEANING against the question (id → cosine, the best
   * of its passages): the whole question when it does not name dreaming, the
   * question with its dream words out (`dreamlessQuestion`) when it does.
   * Absent or empty: no meaning (no embedder, or nothing left to embed).
   */
  readonly meaning?: ReadonlyMap<string, number>;
  /** The folder rule (`DreamReadable`). Absent: every dream. */
  readonly readable?: DreamReadable;
  /** `dreamCandidates` for this question, computed once by the caller. Absent: computed here. */
  readonly candidates?: readonly DreamRow[];
}

/** One dream a question reached: its summary, why, and its meaning score when one was measured. */
export interface QuestionNight {
  readonly night: DreamSummary;
  readonly why: QuestionNightWhy;
  /** The cosine against the question (`QuestionNightsOptions.meaning`), rounded; null when none was measured. */
  readonly score: number | null;
}

/**
 * DREAMS A QUESTION REACHES (2026-10-26, OL1b item 3; extended by what they
 * were ABOUT, D1, 2026-10-27). A dream is not a memory, so neither mode's
 * index finds it; it rides beside the answer, labelled, read-only. A dream
 * comes when:
 *
 *   1. the answer showed the entry of a reflection that followed it; or
 *   2. the question names dreaming and — among its recent dreams, faded or
 *      not (asked about, a dream is remembered) — its title or journal shares
 *      a content word with the question, or MEANS what the rest of the
 *      question asks at or above `DREAM_RECALL_NAMED_FLOOR`; or
 *   3. the question names dreaming: the newest dream that wrote a journal,
 *      faded or not — first when it asks WHEN (`asksWhenDreamed`: "when did
 *      you last dream?", Ames's case; why `asked-when`), else after what its
 *      content reached (why `names-dreams`); or
 *   4. the question does NOT name dreaming (D1): a dream still in reach whose
 *      meaning clears `DREAM_RECALL_MEANING_BAR` — the best one, at most
 *      `DREAM_RECALL_UNNAMED_MAX`. Words alone never carry a dream here
 *      (review of #645: they pulled work dreams beside six of eight ordinary
 *      questions), and with no embedder this rule reaches nothing.
 *
 * Every rule obeys the folder rule (`readable`). Summaries, at most
 * `QUESTION_NIGHTS_MAX`, each saying why it came. `words` is the content-word
 * reader (`reconsolidation.ts#contentWords`), handed in by the server. Reads
 * only: the server notes a dream asked about as recalled. Never throws.
 */
export function nightsForQuestion(
  counterpart: Counterpart,
  question: string,
  shownIds: readonly string[],
  words: (text: string) => Set<string>,
  opts: QuestionNightsOptions = {},
): QuestionNight[] {
  const store = counterpart.store;
  const t = DREAM_TUNABLES;
  try {
    const recent = readableDreams(store, opts.readable, QUESTION_NIGHTS_LOOKBACK).filter((d) => d.state !== "undone");
    if (recent.length === 0) return [];
    const naming = asksAboutDreams(question);
    // Named: every recent journal; unnamed: only those still in reach (`dreamCandidates`).
    const reach = opts.candidates ?? dreamCandidates(counterpart, naming, opts.readable);
    const meaning = opts.meaning ?? new Map<string, number>();
    const order: { id: string; why: QuestionNightWhy }[] = [];
    const add = (id: string, why: QuestionNightWhy): void => {
      if (!order.some((o) => o.id === id)) order.push({ id, why });
    };
    const newest = recent.find(journaled) ?? recent[0];
    if (naming && newest !== undefined && asksWhenDreamed(question)) add(newest.id, "asked-when");
    const shown = new Set(shownIds);
    if (shown.size > 0) {
      for (const r of store.reflections({ limit: QUESTION_NIGHTS_LOOKBACK })) {
        if (r.entry_id !== null && shown.has(r.entry_id) && r.dream_id !== null && recent.some((d) => d.id === r.dream_id)) add(r.dream_id, "reflection-shown");
      }
    }
    if (naming) {
      const asked = words(question);
      for (const w of ["dream", "dreams", "dreamed", "dreamt", "dreaming", "night", "last"]) for (const v of words(w)) asked.delete(v);
      const content: { id: string; why: QuestionNightWhy; score: number; at: number }[] = [];
      reach.forEach((d, at) => {
        const m = meaning.get(d.id) ?? Number.NEGATIVE_INFINITY;
        if (m >= t.DREAM_RECALL_NAMED_FLOOR) {
          content.push({ id: d.id, why: "meaning", score: m, at });
          return;
        }
        if (asked.size === 0) return;
        const have = words(`${d.title ?? ""} ${d.journal ?? ""}`);
        let shared = 0;
        for (const w of asked) if (have.has(w)) shared += 1;
        // Words rank below any meaning match: a shared word is a weaker sign than a meaning that clears the floor.
        if (shared >= 1) content.push({ id: d.id, why: "words", score: shared / 1_000, at });
      });
      content.sort((a, b) => b.score - a.score || a.at - b.at);
      for (const c of content) add(c.id, c.why);
      if (newest !== undefined) add(newest.id, "names-dreams");
    } else {
      const best = reach
        .map((d, at) => ({ id: d.id, score: meaning.get(d.id) ?? Number.NEGATIVE_INFINITY, at }))
        .filter((x) => x.score >= t.DREAM_RECALL_MEANING_BAR)
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .slice(0, t.DREAM_RECALL_UNNAMED_MAX);
      for (const b of best) add(b.id, "meaning");
    }
    const out: QuestionNight[] = [];
    for (const o of order.slice(0, QUESTION_NIGHTS_MAX)) {
      const read = readNight(counterpart, o.id);
      const m = meaning.get(o.id);
      if (read.ok && read.night.kind === "dream") out.push({ night: read.night, why: o.why, score: m === undefined ? null : Math.round(m * 1_000) / 1_000 });
    }
    return out;
  } catch {
    return [];
  }
}

// ── a dream in an answer's words (D1, 2026-10-27) ───────────────────────────

/** The label a dream carries wherever recall shows it, as `[journal]` marks a chapter. */
export const DREAM_LABEL = "[dream]" as const;

/**
 * Said once under an answer that shows a dream, as `FACTS_JOURNAL_GLOSS` is
 * under one that shows a chapter. Mike asked for a label and a line that say
 * it was dreamed (2026-10-27).
 */
export const DREAM_ANSWER_GLOSS =
  '[dream] = dreamed, not lived: a journal the nightly run wrote while it dreamed — not a memory, and not something that happened. Tell it as a dream ("I dreamed …"), never as an event; recall a drm_ id to read it whole.';

/** How much of a journal an answer line quotes. */
export const DREAM_ANSWER_EXCERPT_CHARS = 280;

/** The "dreamed, not lived" line each dream in `nights` carries beside its label. */
export function dreamedLine(night: { readonly date: string | null }): string {
  return `dreamed, not lived: a dream${night.date === null ? "" : ` on ${night.date}`}, told as "I dreamed …", never as something that happened`;
}

/**
 * The lines an answer gains for the dreams beside it: per dream, `[dream]
 * <title> · drm_… · dreamed <date> · <why>`, and — when the question asked
 * about dreams — an excerpt of its journal. Placed by `withDreamLines`.
 */
export function dreamAnswerLines(dreams: readonly { night: DreamSummary; why: string }[], excerpt = true): string[] {
  const out: string[] = [];
  for (const { night, why } of dreams) {
    const title = night.title?.trim() || "a dream with no title";
    out.push(`${DREAM_LABEL} ${title} · ${night.id} · dreamed ${night.date ?? "on an unknown date"} · ${why}`);
    if (!excerpt) continue;
    const text = (night.journal ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 0) out.push(`   ${text.length <= DREAM_ANSWER_EXCERPT_CHARS ? text : `${text.slice(0, DREAM_ANSWER_EXCERPT_CHARS - 1)}…`}`);
  }
  return out;
}

/**
 * THE ANSWER WITH ITS DREAMS IN IT (D1; placement by the coordinator's
 * decision on the review of #663).
 *
 * - A question that ASKS about dreams: the dream is the answer, so its lines
 *   and excerpt come after the answer's head (its first paragraph, the count
 *   and what was asked) and before the first result, with the gloss once at
 *   the end, as `[journal]`'s is. An answer with no paragraph break takes
 *   them after it.
 * - Any other question: the memories are the answer, so a dream comes as one
 *   line, no excerpt and no gloss, AFTER the results: there, and labelled,
 *   but not standing in front of what was asked.
 *
 * No dream: the answer unchanged.
 */
export function withDreamLines(answer: string, dreams: readonly { night: DreamSummary; why: string }[], asked = true): string {
  if (dreams.length === 0) return answer;
  const block = dreamAnswerLines(dreams, asked).join("\n");
  if (!asked) return `${answer}\n\n${block}`;
  const cut = answer.indexOf("\n\n");
  const body = cut < 0 ? `${answer}\n\n${block}` : `${answer.slice(0, cut)}\n\n${block}${answer.slice(cut)}`;
  return `${body}\n${DREAM_ANSWER_GLOSS}`;
}
