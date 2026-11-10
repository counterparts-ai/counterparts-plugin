/**
 * THE WAKE'S SHAPE (WK2, 2026-10-30; `self.WAKE_SHAPE`, off by default; the
 * shape is Mike's, approved 10-30, the build lightly held).
 *
 * The limits under the wake grew one at a time and nobody chose its shape: a
 * fixed room with the page holding over half, and every new line competing for
 * the rest, so a count with ids was what truncation looked like. This composes
 * the wake top-down instead, for one delivery, from reads only:
 *
 *   Frame                     what is this?
 *   Who I am (the page)       who am I? Whole; first claim on the room.
 *   Since the last night      what's the news the page can't know yet? (WF1)
 *   Where this folder stands  where's the work, what changed?
 *   Elsewhere                 what are other folders doing?
 *   Coming up                 what's due?
 *   Still open                what's owed?
 *   Yesterday                 how did the day go?
 *   Last night                what did the night make?
 *
 * Each section answers one question, no item appears twice (`claim`), and a
 * thing that does not fit condenses to a whole title or a door, never a bare id
 * or a cut title. Sections run in order, each with its budget and its door; then
 * ONE pass gives room back in a stated order (`GIVE`) when the wake is over, or
 * hands it on (`SPARE`) when it is under. With the switch on nothing here reads
 * `ROOM_ORDER`, `TRIM_ORDER`, the delivery's reserves or the published record.
 *
 * What a delivery gets when this returns null (no budget, no date, a ceiling too
 * small for the frame, anything that throws): the road below it in
 * `Counterpart#wake`, as if the switch were off, with a ring event saying so.
 *
 * Bytes per section are reported from here (`ShapedWake.sections`), not read
 * back off the text (`counterpart-boundary.ts#wakeShape`), so a new heading
 * cannot silently misfile them. Names only; the numbers sum to the delivered
 * bytes.
 *
 * It writes what a delivery writes today, and nothing else: `handoff.shown`, the
 * day summary's held row. No model, no embedding, no scan past what the old road
 * read.
 *
 * A part of the root like `counterpart-boundary.ts`: it reads the root's private
 * reads by `cp["…"]` as they do, rather than widen `Counterpart`'s public surface
 * for one caller, and it holds no number (`test/counterpart.test.ts`): every limit
 * is named, with its reason, in `self/tunables.ts#WAKE_SHAPE_LIMITS`.
 */
import { READ_TODAY_AT_START, horizonFor } from "./briefing.js";
import type { HorizonLine } from "./briefing.js";
import type { Counterpart } from "./counterpart.js";
import type { WakeHere, WakeSession } from "./counterpart-types.js";
import { isNightRow, memoryClosedTo } from "./dream/slices.js";
import { firstRealSentence, leadOf, modelWords, seatOf, shortSession, titleInLead, versionOlder } from "./handoff/index.js";
import type { Handoff } from "./handoff/index.js";
import { lastExchange, quoteOf, LAST_EXCHANGE_HANDLE } from "./handoff/last-exchange.js";
import { LAST_HERE_LIFE_DAYS, chaptersOn, placeWords } from "./handoff/last-here.js";
import type { ChapterHere } from "./handoff/last-here.js";
import { SHAPED_CONTEXT, WAKE_BYTE_COUNTS, flatten, fixedPointTotal, prefaceLine, WAKE_SYSTEM } from "./self/briefing.js";
import { byteLength } from "./self/identity.js";
import { readSentinel, settledOver } from "./self/index.js";
import { WAKE_SHAPE_LIMITS as SHAPE } from "./self/tunables.js";
import type { WakeDelivery, WakeResult } from "./self/index.js";
import { craftSince, isWorkMemory, projectFolder, threadPlace, type WorkRule } from "./self/work.js";
import { addDays, ageWords, daysBetween, isDay, localDate, localStamp, monthDay, stampDay, startOfLocalDay } from "./time.js";
import { settlesWhenOf } from "./types.js";
import { lastNightCloses, OPEN_CLOSE_TUNABLES } from "./open-close.js";
import { PLAIN_OTHER_NAMED, PLAIN_OTHER_TITLE_CHARS } from "./prospective/index.js";
import type { Kind } from "./types.js";
import type { MemoryRow } from "./store/index.js";
import { TOLD_SOURCE, isTold } from "./told.js";
import { OWN_PLUMBING_META_KEY } from "./remember/own-plumbing.js";
import { happenedAlready, lastNightAt, sinceLastNight } from "./counterpart-wake-news.js";
import { SET_DOWN_HANDLE, SET_DOWN_TOLD_KEY, contentWords, lineOnPage, nightSetDowns, preparePage } from "./self/set-down.js";
import type { PreparedPage } from "./self/set-down.js";
import type { NewsItem } from "./counterpart-wake-news.js";
import { NO_TERMS, noteRaised, ownerParked, raiseRecord, raisesAt, sharedWeight, termsOf, touches, waitState, weighMany } from "./owner-waits.js";
import type { TermWeights } from "./owner-waits.js";
import { hashText } from "./store/prose.js";

/** The meta key that sets the shape for one store (`self/tunables.ts#WAKE_SHAPE_KEY`, where a new install's state can read it too). */
export { WAKE_SHAPE_KEY } from "./self/tunables.js";

/** The door a section's rest goes behind. Each is a `recall` handle that lists what it counts. */
export const COMING_UP_HANDLE = "coming up";
export const HANDOFFS_HANDLE = "handoffs";
/** What an item with no date sorts as: after every date. */
export const UNDATED_LAST = "undated";
/** Where Elsewhere's rest goes (the spec's floor: no count without a door): these folders, as the section reads them (`readElsewhere`). */
export const ELSEWHERE_HANDLE = "elsewhere";

type SectionKey = "news" | "folder" | "elsewhere" | "coming" | "open" | "yesterday" | "night";
/** "Since the last night" first (WF1): the freshest thing a wake can say, and the first to claim its items. */
const ORDER: readonly SectionKey[] = ["news", "folder", "elsewhere", "coming", "open", "yesterday", "night"];
/** What gives way first when the wake is over: older things to read, then the rest; the folder's own last. */
const GIVE: readonly SectionKey[] = ["elsewhere", "open", "coming", "yesterday", "night", "news", "folder"];
/** Where spare room goes, in draft 5's order. */
const SPARE: readonly SectionKey[] = ["folder", "open", "elsewhere", "coming"];
/** The section names the host's row carries (`sec_…`), `counterpart-boundary.ts#wakeShape`'s. */
const SECTION_NAME: Readonly<Record<SectionKey, string>> = { news: "news", folder: "stands", elsewhere: "elsewhere", coming: "horizon", open: "threads", yesterday: "yesterday", night: "night" };

/** One section as composed: its text with its blank line, the ids it claims, and the items it listed. */
interface Sec {
  readonly text: string;
  readonly ids: readonly string[];
  readonly items: number;
  /** The ids a session can expand (`[id]`), for the lookup ledger. */
  readonly lined?: readonly string[];
  /** The handoffs with a line, with their bytes. */
  readonly handoffs?: readonly { readonly h: Handoff; readonly bytes: number }[];
  readonly saidBytes?: number;
  readonly chapters?: number;
  /** The night whose set-downs this section told (PG1), so the delivery records them told once. */
  readonly setDownNight?: string;
  /** The least the one pass takes it down to: its door alone, when what is behind it must be said (WK3, overdue). */
  readonly floor?: number;
  /** The item waiting on the owner this section said (SO1 step 4), recorded as raised once the wake is delivered. */
  readonly owed?: Owed;
}
type Budgets = Record<SectionKey, number>;

/** What the shaped delivery comes to. */
export interface ShapedWake {
  readonly result: WakeResult;
  readonly lined: readonly string[];
  readonly threads: readonly string[];
  readonly tagged: boolean;
  readonly sections: Readonly<Record<string, number>>;
  readonly page: string | null;
}

/** Sentence ends, as handoff/ reads them. */
const END = /[.!?](?=\s|$)/g;

function firstSentence(s: string): string {
  END.lastIndex = 0;
  const m = END.exec(s);
  return m === null ? s : s.slice(0, m.index + 1);
}

const plural = (n: number, w: string): string => `${String(n)} ${w}${n === 1 ? "" : "s"}`;
const norm = (s: string): string => s.trim().replace(/\/+$/, "");

/** A row's title whole, or its first sentence: never a title cut. */
export function titleOfRow(row: Pick<MemoryRow, "title" | "body">): string {
  const t = (row.title ?? "").trim();
  if (t.length > 0) return flatten(t);
  const first = flatten(row.body.split("\n").find((l) => l.trim().length > 0) ?? "");
  const sentence = firstSentence(first);
  if (byteLength(sentence) <= SHAPE.UNTITLED_BYTES) return sentence;
  const start = [...sentence].slice(0, SHAPE.UNTITLED_CHARS).join("");
  // At a word's end where it has words; text with no spaces has no such place.
  const space = start.lastIndexOf(" ");
  return `${(space > 0 ? start.slice(0, space) : start).trimEnd()}…`;
}

/**
 * What a horizon item is, for the reader: its row's title and words, what would
 * settle it, and whose it is. The closed fence is applied here: a work item in
 * another folder that is not on, or with no way to ask, is no item at all, and
 * not a count either.
 */
export interface Cue {
  readonly id: string;
  readonly title: string;
  /** The whole body, flat: what a plain reminder shows. */
  readonly body: string;
  readonly settles: string | null;
  readonly due: string | null;
  readonly every: string | null;
  readonly today: boolean;
  readonly past: boolean;
  readonly plain: boolean;
  /** This reader's (this folder or personal), or another folder's that may be named. */
  readonly mine: boolean;
  /** The other folder it was written in, when not `mine`. */
  readonly folder: string | null;
  /** Personal (me, us, owner, or no folder), whoever reads it: it may be told in any folder (SO1 step 3). */
  readonly personal: boolean;
}

const NO_FOLDERS: ReadonlySet<string> = new Set();

/** The folders a reader counts as here, as "Still open" reads them. */
function readerFolders(cp: Counterpart, here: WakeHere | undefined): Set<string> {
  return new Set(cp["threadReader"](here?.scope, here?.exportsFrom).folders.map(projectFolder).filter((f) => f.length > 0));
}

/** This reader's horizon, in the horizon's order, closed folders out (brief item 2: the night's fence, at a session start too). */
export function readCues(cp: Counterpart, at: string, here: WakeHere | undefined): Cue[] {
  const store = cp.store;
  const day = store.livedDay();
  const asked = horizonFor(cp.prospective, at, day, { readToday: READ_TODAY_AT_START });
  const settled = settledOver(store);
  const folders = readerFolders(cp, here);
  const rule = { craftTravels: cp.self.tunables.PROJECTS_TRAVEL, craftSince: craftSince(store) };
  const seen = new Set<string>();
  const out: Cue[] = [];
  for (const h of [...asked.items, ...asked.moreItems] as HorizonLine[]) {
    if (seen.has(h.id) || settled.has(h.id)) continue;
    seen.add(h.id);
    const row = store.row(h.id);
    if (row === undefined || row.band === "identity" || row.archived === 1) continue;
    // The fence's own rule (#697): whatever its mark, and a night's row by what it rests on.
    if (here?.exportsFrom !== undefined && memoryClosedTo(store, row, here.exportsFrom, norm(here.scope ?? ""))) continue;
    // Already happened (WF1): a newer done memory this reader may read says so (the shop that launched a day early).
    const fence = here?.exportsFrom;
    const own = norm(here?.scope ?? "");
    if (happenedAlready(store, h.id, at, { open: (r) => (fence === undefined ? norm(r.origin_scope ?? "") === own : !memoryClosedTo(store, r, fence, own)) }) !== null) continue;
    const facts = { about: row.about ?? null, kind: row.kind as Kind, originScope: row.origin_scope ?? null, journal: false };
    const place = threadPlace(facts, folders, rule);
    let folder: string | null = null;
    if (place === "out") {
      folder = cp["memoryFolder"](row) ?? row.origin_scope ?? null;
      let open = false;
      try {
        open = folder !== null && here?.exportsFrom?.(folder) === true;
      } catch {
        open = false;
      }
      if (!open) continue;
    }
    const due = h.due?.trim() ?? "";
    const today = h.today === true || due === "" || (isDay(due) && due === at);
    const past = !today && h.plainDue !== true && (h.past === true || (isDay(due) && due < at));
    out.push({
      id: h.id,
      title: titleOfRow(row),
      // A fold's last `Names:` line (#697) is for recall by id, not a list of bare ids here.
      body: flatten(row.body.replace(/\n+Names: [^\n]*\s*$/, "")),
      settles: settlesOf(row),
      due: due === "" ? null : due,
      every: h.every ?? null,
      today: today || h.plainDue === true,
      past,
      plain: h.plainDue === true,
      mine: place !== "out",
      folder: place === "out" ? folder : null,
      // Whoever reads it: what crosses to a reader with no folder crosses to every one.
      personal: threadPlace(facts, NO_FOLDERS, rule) !== "out",
    });
  }
  return out;
}

function settlesOf(row: Pick<MemoryRow, "meta">): string | null {
  try {
    return settlesWhenOf(JSON.parse(row.meta ?? "{}") as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Reader order of due today: plain first, then this folder's, each with a `settles when` first. */
function dueOrder(x: Cue, y: Cue): number {
  return Number(y.plain) - Number(x.plain) || Number(y.mine) - Number(x.mine) || Number(y.settles !== null) - Number(x.settles !== null);
}

/** A line of the handoffs' door (`recall "handoffs"`): what came after the newest here. */
export interface SinceItem {
  readonly id: string;
  readonly title: string;
  readonly status: string | null;
  readonly chapter: boolean;
  readonly at: number;
}

/**
 * WHEN A FACT WAS FIRST LEARNED: the row's earliest stated day before the day it
 * was written, and what it replaced, so re-noting can't make an old claim look
 * fresh. A same-day date would round the age up to midnight, so only an earlier
 * day counts. Falls back to when it was written: no blank ages.
 */
function factClock(cp: Counterpart, zone: string): (id: string) => number {
  const store = cp.store;
  let pairs: Map<string, string[]> | null = null;
  const before = (id: string): readonly string[] => {
    if (pairs === null) {
      pairs = new Map();
      for (const p of store.supersededPairs()) pairs.set(p.by, [...(pairs.get(p.by) ?? []), p.id]);
    }
    return pairs.get(id) ?? [];
  };
  const memo = new Map<string, number>();
  const clock = (id: string, depth: number): number => {
    const had = memo.get(id);
    if (had !== undefined) return had;
    const r = store.row(id);
    if (r === undefined) return Infinity;
    const written = r.created_at ?? Infinity;
    const writtenDay = Number.isFinite(written) ? startOfLocalDay(localDate(written, zone), zone) : Infinity;
    let at = written;
    for (const d of [r.occurred_on, r.happened_on, r.learned_on]) {
      if (typeof d !== "string" || !isDay(stampDay(d))) continue;
      const ms = startOfLocalDay(stampDay(d), zone);
      if (ms < writtenDay && ms < at) at = ms;
    }
    if (depth < SHAPE.FACT_CLOCK_DEPTH) for (const e of before(id)) at = Math.min(at, clock(e, depth + 1));
    memo.set(id, at);
    return at;
  };
  return (id) => clock(id, 0);
}

/** One age per run of lines: shown only where it differs from the line above. */
function aged(lines: readonly { text: string; age: string; tail?: string }[]): string[] {
  return lines.map((l, i) => `${l.text}${i > 0 && lines[i - 1]?.age === l.age ? "" : ` (${l.age})`}${l.tail ?? ""}`);
}

/** The memories and chapters that came after `since` in this folder, what the wake's "Since, here" and the handoffs' door say. */
export function sinceHere(
  cp: Counterpart,
  scope: string,
  since: number,
  opts: {
    readonly handoffSession: string | null;
    readonly handoffAt: number | null;
    readonly reader: string | null;
    readonly lead: string;
    readonly chapters: readonly ChapterHere[];
    /** What another section answers for: due items ("what's due?"). */
    readonly skip?: ReadonlySet<string>;
    /** Every folder that counts as here: a joined folder's work is this one's (`PROJECTS_TRAVEL`). Absent: `scope` alone. */
    readonly folders?: readonly string[];
    /** Newer handoffs that sank below the lead (WK3): their own closing batches echo them, as the lead's does. */
    readonly closing?: readonly { readonly session: string; readonly at: number }[];
  },
): { items: (SinceItem & { readonly rank: number })[]; older: number; rawLater: number; skippedInLead: number } {
  const store = cp.store;
  const zone = store.zone();
  const now = cp["nowFn"]();
  const folders = opts.folders ?? [scope];
  const rows = folders
    .flatMap((f) => store.memoriesWrittenHereSince(f, since, now, SHAPE.SINCE_READ))
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, SHAPE.SINCE_READ);
  const denied = rows.length === 0 ? new Set<string>() : new Set(store.deniedIds());
  const items: (SinceItem & { readonly rank: number })[] = [];
  let older = 0;
  let skippedInLead = 0;
  const handoffDay = opts.handoffAt === null ? null : startOfLocalDay(localDate(opts.handoffAt, zone), zone);
  for (const r of rows) {
    if (denied.has(r.id) || r.band === "identity") continue;
    // An open thread is "what's owed?", and a dated one "what's due?": each has
    // its own section below, with its age, its settles-when and its id.
    if (opts.skip?.has(r.id) === true || (r.meta ?? "").includes('"unresolved":true')) continue;
    if (opts.reader !== null && r.origin_session === opts.reader) continue;
    const title = (r.title ?? "").trim();
    if (title.length === 0 || r.source === "episode" || isTold(r) || (r.origin_ref ?? "").startsWith("epi_") || isNightRow(r) || (r.meta ?? "").includes('"episodeId"')) continue;
    // Our own plumbing (TC1, `remember/own-plumbing.ts`): kept for recall, never the folder's news.
    if ((r.meta ?? "").includes(`"${OWN_PLUMBING_META_KEY}"`)) continue;
    if (!r.status && !isWorkMemory({ about: r.about ?? null, kind: r.kind as Kind, originScope: r.origin_scope ?? null, journal: false })) continue;
    // A closing batch from the handoff's own session echoes its lead.
    const at = r.created_at ?? 0;
    if (opts.handoffSession !== null && r.origin_session === opts.handoffSession && opts.handoffAt !== null && at - opts.handoffAt <= SHAPE.SINCE_OWN_SESSION_MS) continue;
    if (opts.closing?.some((h) => r.origin_session === h.session && at >= h.at && at - h.at <= SHAPE.SINCE_OWN_SESSION_MS) === true) continue;
    // Since means changed, not written: a stated day before the handoff's is an older note.
    if (handoffDay !== null) {
      const stated = [r.occurred_on, r.happened_on, r.event_date, r.learned_on]
        .filter((d): d is string => typeof d === "string" && isDay(stampDay(d)))
        .map((d) => startOfLocalDay(stampDay(d), zone));
      if (stated.some((d) => d < handoffDay)) {
        older += 1;
        continue;
      }
    }
    const flat = flatten(title);
    if (titleInLead(flat, opts.lead, SHAPE.SINCE_IN_LEAD)) {
      skippedInLead += 1;
      continue;
    }
    items.push({ id: r.id, title: flat, status: r.status ?? null, chapter: false, at, rank: r.status === "planned" || r.status === "proposed" ? 0 : 1 });
  }
  for (const c of opts.chapters) {
    if (c.writtenAt <= since || c.session === opts.reader) continue;
    const t = (c.title ?? "").trim() || c.excerpt.trim();
    if (t.length === 0) continue;
    items.push({ id: c.id, title: flatten(t), status: null, chapter: true, at: c.writtenAt, rank: 1 });
  }
  items.sort((a, b) => a.rank - b.rank || b.at - a.at || (a.id < b.id ? -1 : 1));
  // Anything at all, replaced or archived since included: "Nothing here since" has to be true.
  return { items, older, rawLater: folders.reduce((n, f) => n + store.countWrittenHereSince(f, since, now), 0) + opts.chapters.filter((c) => c.writtenAt > since).length, skippedInLead };
}

/** `15:40`, or `10-29 15:40` on another day. */
function clockWords(at: number, today: string, zone: string): string {
  const stamp = localStamp(at, zone);
  return localDate(at, zone) === today ? (stamp.split(" ")[1] ?? stamp) : stamp;
}

/** The sessions nobody attended (`claude -p`, the SDK): never "Last said". */
export function headlessOf(sessions: readonly WakeSession[]): Set<string> {
  return new Set(sessions.filter((s) => s.headless === true).map((s) => s.session));
}

/**
 * THE SHAPED DELIVERY, or null for the road below it. Reads only, but for
 * `handoff.shown` and the day summary's held row.
 */
export function shapedDelivery(cp: Counterpart, delivery: WakeDelivery, here: WakeHere | undefined, budget: number): ShapedWake | null {
  const at = delivery.date;
  if (at === undefined || !isDay(at)) return null;
  const store = cp.store;
  const zone = store.zone();
  const now: number = cp["nowFn"]();
  const day = store.livedDay();
  const scope = norm(here?.scope ?? "");
  const reader = here?.session ?? null;
  const yest = addDays(at, -1);
  const sinceY = startOfLocalDay(yest, zone);
  const factAt = factClock(cp, zone);
  const ageOf = (ms: number): string => ageWords(ms, now);
  const gate = cp["elsewhereGate"](here);
  const safe = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
  const sessions = safe(() => here?.sessions?.() ?? [], [] as readonly WakeSession[]);
  const headless = headlessOf(sessions);

  // ── the frame ──
  const preface = prefaceLine({
    system: WAKE_SYSTEM,
    day,
    ...(delivery.date === undefined ? {} : { date: delivery.date }),
    // The lived memories are the number; the starter notes are said apart (S1; ROADMAP, 11-03).
    memories: store.countMemories({ type: "memory", archived: false, notSource: TOLD_SOURCE }),
    starter: store.countMemories({ type: "memory", archived: false, source: TOLD_SOURCE }),
    liveRows: store.countMemories({ archived: false }),
    assembled: true,
  });
  const fields = here?.headFields ?? [];
  // What the delivery adds beside the body: the preface and its newline, the
  // head's fields, and a digit's growth in the two byte counts.
  const added = byteLength(preface) + 1 + (fields.length === 0 ? 0 : byteLength(fields.join(" ")) + 1) + WAKE_BYTE_COUNTS;
  const opening = (n: number, b: string): string => `<!-- counterparts:wake elements=${String(n)} bytes=${b} -->`;
  const closing = (n: number, b: string, page: boolean): string => `<!-- counterparts:wake/end day=${String(day)}${page ? " page=1" : ""} elements=${String(n)} bytes=${b} -->`;
  const frameBytes = byteLength(opening(SHAPE.FRAME_ELEMENTS, String(SHAPE.FRAME_BYTES))) + 1 + byteLength(`${SHAPED_CONTEXT}\n\n`) + byteLength(closing(SHAPE.FRAME_ELEMENTS, String(SHAPE.FRAME_BYTES), true)) + added;
  const room = budget - frameBytes;
  if (room <= 0) return null;

  // ── the facts, once per delivery: a read that fails costs its section, never the wake ──
  // A joined folder is here (`PROJECTS_TRAVEL`): its work is "Since, here", its sessions "Open here now".
  const hereFolders: readonly string[] = gate === null ? [scope] : [...gate.ours];
  // The handoffs in the order the wake tells them (WK3): a stale wait on the
  // owner sinks, and a week-old one nothing refers to isn't listed.
  const sunkIds = new Set<string>();
  const hs: readonly Handoff[] = scope.length === 0 ? [] : safe(() => handoffsTold(cp, cp.handoffs.readAll(scope), hereFolders, now, reader, sunkIds), []);
  const newest = hs[0];
  const newestAt = newest === undefined ? null : safe(() => cp.handoffs.writtenAt(newest), null);
  const chaptersHere: readonly ChapterHere[] = scope.length === 0 ? [] : safe(() => cp.chaptersHereFor(scope, null, cp["chaptersInWindow"](day)).map((f) => f.chapter), []);
  const since = newest === undefined ? sinceY : (newestAt ?? startOfLocalDay(newest.writtenOn, zone));
  const lead5 = newest === undefined ? "" : leadOf(newest.body, SHAPE.LEAD_LINES, SHAPE.LEAD_BYTES).lines.join(" ");
  // A newer one that sank below this lead (WK3) is said, so "newest" is never untrue.
  const sunkNewer = newest === undefined || newestAt === null ? 0 : hs.filter((h) => safe(() => cp.handoffs.writtenAt(h) ?? 0, 0) > newestAt).length;
  const sunkClosing = newestAt === null ? [] : hs.flatMap((h) => {
    const t = safe(() => cp.handoffs.writtenAt(h), null);
    return h.session === null || t === null || t <= newestAt ? [] : [{ session: h.session, at: t }];
  });
  const amongWords = hs.length <= 1 ? "" : sunkNewer > 0 ? `; ${plural(sunkNewer, "newer one")} waiting on an answer, below` : `; newest of ${String(hs.length)}`;
  const cues = safe(() => readCues(cp, at, here), [] as Cue[]);
  const cueIds = new Set(cues.map((c) => c.id));
  // SHOWN EARLIER TODAY (RF1, 2026-11-04): a plain reminder already told today
  // (the told latch, `Prospective.plainToldOn`) folds into Coming up's one line
  // in every later wake, this folder's own included. The first delivery that
  // reaches it shows it whole and is what writes the latch (`claimPlain`, after
  // this compose), so a reminder nobody has been told yet is never folded. Only
  // a telling in a session that started today, with a person's entrypoint,
  // counts (review of RF1): a prompt in last night's session after midnight, an
  // agent's hand-back with nobody reading, isn't a wake anyone saw. A latch that
  // names no session, or one the registry doesn't hold, doesn't count either.
  // Never on a compaction: that session's model just lost what it was shown. A
  // dated item that isn't plain has no such record and shows as before. Only
  // what this reader would show counts (SO1 step 3): another folder's work,
  // told in its own folder, isn't "shown earlier" here, it's in other folders.
  // A telling counts for a folder's work only when it was in one of this
  // reader's folders: told anywhere else (a folderless chat, before SO1 step 3),
  // it wasn't where it can be acted on. A personal one counts wherever it was told.
  const saysHere = (c: Cue): boolean => c.mine;
  const ourFolders = readerFolders(cp, here);
  const seenToday = new Map(sessions.filter((s) => s.headless !== true && localDate(s.startedAt, zone) === at).map((s) => [s.session, projectFolder(s.scope)] as const));
  const byToday = (c: Cue) => (session: string | null): boolean => {
    if (session === null || !seenToday.has(session)) return false;
    return c.personal || ourFolders.has(seenToday.get(session) ?? "");
  };
  //
  // IN THIS SESSION'S CONTEXT, OR NOT SAID (WK3, 2026-11-09): "shown earlier"
  // pointed at nothing four mornings running: the telling was in another
  // session, which this one's model never saw. So only a telling in THIS
  // session folds (a resume, whose model has the earlier wake above it); a
  // telling in another session, or in this one before a compaction or a /clear
  // emptied its context, shows the item again by title and id (`RETOLD_SHOWN`,
  // the rest counted behind the door), never its whole body twice to the person.
  // Only a start the host names as one that keeps the context (review of #792): no
  // source is unknown, and unknown doesn't fold.
  const contextKept = here?.source === "startup" || here?.source === "resume";
  const toldToday = new Set(cues.filter((c) => c.plain && saysHere(c) && safe(() => cp.prospective.plainToldOn(c.id, at, byToday(c)), false)).map((c) => c.id));
  const shownEarlier = new Set(
    !contextKept || reader === null || !seenToday.has(reader) ? [] : cues.filter((c) => toldToday.has(c.id) && safe(() => cp.prospective.plainToldOn(c.id, at, (s) => s === reader), false)).map((c) => c.id),
  );
  const retold = new Set([...toldToday].filter((id) => !shownEarlier.has(id)));
  const later = scope.length === 0 ? null : safe(() => sinceHere(cp, scope, since, { handoffSession: newest?.session ?? null, handoffAt: newestAt, reader, lead: lead5, chapters: chaptersHere, skip: cueIds, folders: hereFolders, closing: sunkClosing }), null);
  const sinceAged = (later?.items ?? []).map((s) => ({ ...s, age: ageOf(s.chapter ? s.at : Math.min(s.at, factAt(s.id))) }));
  const open = safe(() => cp.self.stillOpen(day, cp["threadReader"](here?.scope, here?.exportsFrom), ownerParked(store, day)), { items: [], parked: 0 });
  const folders = ourFolders;
  const rule = { craftTravels: cp.self.tunables.PROJECTS_TRAVEL, craftSince: craftSince(store) };
  const openRows = open.items
    .filter((i) => i.parked !== true)
    .map((i) => {
      const r = store.row(i.id);
      const place = r === undefined ? "personal" : threadPlace({ about: r.about ?? null, kind: r.kind as Kind, originScope: r.origin_scope ?? null, journal: false }, folders, rule);
      return { i, r, here: place === "here", at: Math.min(factAt(i.id), r?.created_at ?? Infinity) };
    })
    .sort((a, b) => Number(b.here) - Number(a.here) || b.at - a.at || (a.i.id < b.i.id ? -1 : 1));
  // WAITING ON THE OWNER (SO1 step 4, revised; Mike 11-07): an `asked` item is
  // not one of Still open's lines any more (it was in every wake, never parked).
  // At most one item that waits on the owner is said per wake, the most relevant
  // to this folder's week that its backoff lets through (`owner-waits.ts`), and
  // only in a session someone attends; a sunk handoff (WK3) is a candidate too.
  const attended = reader !== null && !headless.has(reader) && !cp.observer;
  const owed = !attended
    ? null
    : safe(
        () =>
          owedOne(cp, {
            day,
            now,
            rows: openRows.filter((x) => x.r?.status === "asked" && !cueIds.has(x.i.id)).map((x) => ({ id: x.i.id, row: x.r as MemoryRow, settles: x.i.settlesWhen ?? null, at: x.at, here: x.here })),
            handoffs: joinless(
              cp,
              hs.filter((h, i) => i > 0 && sunkIds.has(h.id)),
              openRows.filter((x) => x.r?.status === "asked").map((x) => ({ id: x.i.id, text: `${x.r === undefined ? x.i.title : titleOfRow(x.r)} ${x.i.settlesWhen ?? ""}` })),
            ),
            lead: lead5,
            folders: hereFolders,
          }),
        null,
      );
  const summary = cp.self.tunables.YESTERDAY_FROM_SUMMARY ? safe(() => cp["daySummaryShown"](yest, here), null) : null;
  const yestHere = scope.length === 0 ? [] : safe(() => chaptersOn(store, yest, { fromDay: Math.max(0, day - LAST_HERE_LIFE_DAYS) }).filter((c) => norm(c.scope ?? "") === scope), []);
  const elsewhere = safe(() => elsewhereFacts(cp, gate, sessions, sinceY, now, reader, factAt), { list: [] as ElsewhereRow[], quiet: [] as string[] });
  const said = scope.length === 0 ? null : safe(() => saidHere(cp, scope, here, sessions, headless, chaptersHere, newest ?? null, reader, zone, now), null);
  const liveHere = sessions.filter((s) => s.live && s.session !== reader && hereFolders.includes(norm(s.scope)));
  // THE HANDOFF STEPS DOWN (WF1): past `HANDOFF_STEP_DOWN_MS` with a session
  // here since, it is one line with its age after what came since, not whole
  // and first (Dana's day-1 "waiting on Dana to pick a platform" led every shop
  // wake through day 6). Sessions since: the ended ones that left a chapter or
  // a memory here.
  const sinceSessions = newest === undefined || newestAt === null ? 0 : sessionsSince(cp, { at: newestAt, own: newest.session, reader, folders: hereFolders, sessions, headless, chapters: chaptersHere, now });
  // And only with something in "Since, here" to read in its place (review of #734).
  const stepDown = newestAt !== null && now - newestAt >= SHAPE.HANDOFF_STEP_DOWN_MS && sinceSessions > 0 && sinceAged.length > 0;
  const night = safe(() => nightWords(cp, at, here, scope), null);
  // WHAT THE NIGHT CLOSED ITSELF (2026-11-07, SO1 step 1): the newest
  // night's closes, from yesterday's or today's lived day, as one line under
  // "Last night" — only items this folder's Still open would carry (its own,
  // a joined folder's, a personal one), never another folder's work.
  const closedLine = safe(() => nightClosedLine(cp, day, folders, rule), null);
  // WHAT THE PAGE SET DOWN LAST NIGHT (PG1, 2026-11-09): once, on the
  // morning after, by line; never a line on the page now or in the night's
  // own words (WK3: a moment told once per wake).
  // ONE TELLING OF A MOMENT (WK3): the night's own line, less what the page or
  // day's end already says in this wake, and a clause the second morning running.
  const ownLine = night === null ? null : safe(() => ownToldOnce(cp, night, [cp.self.page()?.body ?? "", summary ?? ""]), null);
  const setDown = safe(() => setDownWakeLine(cp, now, ownLine), null);
  const installed = here?.installed ?? null;
  const news = safe(() => sinceLastNight(cp, at, here, { ours: new Set(hereFolders), skip: cueIds }), { items: [] as NewsItem[], since: 0, night: false });

  // ── the page: first claim on the room ──
  const self = cp.self.shapedSelf(room, {
    at,
    day,
    keptOut: (id) => cp["hintKeptOut"](id, here ?? {}),
    // What Elsewhere names is Elsewhere's, not a hint's: so its door can count what it counts (`readElsewhere`).
    skip: new Set([...cueIds, ...news.items.map((n) => n.id), ...elsewhere.list.flatMap((e) => (e.id === null ? [] : [e.id]))]),
  });

  // ── the sections ──
  const spareOn = new Set<SectionKey>();
  const blockOf = (lines: readonly string[]): string => (lines.length === 0 ? "" : `${lines.join("\n")}\n\n`);

  // "Since the last night" (WF1): titles only, with their ages; no door, since
  // the rest is the page's and the night's; nothing to say, no section.
  const newsSec = (b: number, claim: ReadonlySet<string>): Sec => {
    const list = news.items.filter((n) => !claim.has(n.id));
    if (list.length === 0) return { text: "", ids: [], items: 0 };
    const render = (k: number): string[] => [news.night ? "Since the last night:" : "Since yesterday:", ...aged(list.slice(0, k).map((n) => ({ text: `- ${n.title}`, age: ageOf(n.at) })))];
    let k = list.length;
    while (k > 0 && byteLength(blockOf(render(k))) > b) k -= 1;
    if (k === 0) return { text: "", ids: [], items: 0 };
    return { text: blockOf(render(k)), ids: list.slice(0, k).map((n) => n.id), items: k };
  };

  const folderSec = (b: number, claim: ReadonlySet<string>): Sec => {
    if (scope.length === 0) return { text: "", ids: [], items: 0 };
    const leadLines = spareOn.has("folder") ? SHAPE.LEAD_LINES_SPARE : SHAPE.LEAD_LINES;
    const leadBytes = spareOn.has("folder") ? SHAPE.LEAD_BYTES_SPARE : SHAPE.LEAD_BYTES;
    const sinceLines = sinceAged.filter((s) => !claim.has(s.id));
    const tail = here?.sessions === undefined ? null : openHereLine(liveHere, at, zone);
    // A sunk handoff said as Still open's ask isn't also its pointer line here (SO1 step 4: shown once).
    const olderPick = pickOlder(owed?.kind === "handoff" ? hs.filter((h) => h.id !== owed.id) : hs);
    const build = (n: { lead: number; since: number; older: number; said: boolean }): { lines: string[]; leadBytes: number } => {
      const out = ["Where this folder stands:"];
      let leadSize = 0;
      let stepped: string | null = null;
      if (newest === undefined) out.push("No handoff here. Leave one with session_end's handoff field when you stop.");
      else if (stepDown) {
        const seat = seatOf(newest.body) ?? `session ${shortSession(newest.session)}`;
        stepped = `Last handoff, ${seat}, ${monthDay(newest.writtenOn)} (${ageOf(newestAt ?? startOfLocalDay(newest.writtenOn, zone))} old; ${plural(sinceSessions, "session")} here since${amongWords}): recall ${newest.id}`;
        leadSize = byteLength(`${stepped}\n`);
      } else {
        const lead = leadOf(newest.body, n.lead, leadBytes);
        const seat = seatOf(newest.body) ?? `session ${shortSession(newest.session)}`;
        const when = `${monthDay(newest.writtenOn)}${newestAt === null ? "" : ` ${localStamp(newestAt, zone).split(" ")[1] ?? ""}`}`;
        const written = newest.build ?? (newest.session !== null ? safe(() => here?.openedWith?.(newest.session as string) ?? null, null) : null);
        const delta = written !== null && installed !== null && versionOlder(written, installed) ? `; ${written} then, ${installed} now` : "";
        const head = `Handoff, ${seat}, ${when} (${ageOf(newestAt ?? startOfLocalDay(newest.writtenOn, zone))} old${delta}${amongWords}). ${lead.cut ? "whole: " : ""}recall ${newest.id}`;
        out.push(head, ...lead.lines.map((l) => `  ${l}`));
        leadSize = byteLength(`${head}\n`) + lead.lines.reduce((x, l) => x + byteLength(`  ${l}\n`), 0);
      }
      if (sinceLines.length > 0 && n.since > 0) {
        out.push(newest === undefined ? "Since yesterday, here:" : "Since, here:");
        out.push(
          ...aged(
            sinceLines.slice(0, n.since).map((s) => ({
              text: `- ${s.status === null ? "" : `[${s.status}] `}${s.chapter ? `chapter "${s.title}"` : s.title}`,
              age: s.age,
            })),
          ),
        );
        if (sinceLines.length > n.since) out.push(`(+${String(sinceLines.length - n.since)} more; recall "${HANDOFFS_HANDLE}")`);
      } else if (sinceLines.length > 0) {
        out.push(`Since: ${plural(sinceLines.length, "item")}; recall "${HANDOFFS_HANDLE}"`);
      } else if (newest !== undefined && (later?.older ?? 0) > 0) {
        out.push(`Nothing new here; ${plural(later?.older ?? 0, "older note")} added.`);
      } else if (later !== null && later.rawLater === 0) {
        if (newest !== undefined) {
          if (!stepDown) out.push("Nothing here since.");
        }
        else {
          // No handoff and a quiet day: the last chapter here, so a folder a
          // session left a while ago still says what happened in it.
          const last = chaptersHere.find((c) => c.session !== reader && ((c.title ?? "").trim().length > 0 || c.excerpt.trim().length > 0));
          out.push(last === undefined ? "Nothing here since yesterday." : `Last here: chapter "${flatten((last.title ?? "").trim() || last.excerpt)}" (${ageOf(last.writtenAt)})`);
        }
      }
      if (stepped !== null) out.push(stepped);
      const rest = hs.length - 1;
      if (rest > 0) {
        out.push(`Older handoffs: ${String(rest)}; recall "${HANDOFFS_HANDLE}"`);
        for (const o of olderPick.slice(0, n.older)) out.push(`- ${o.seat}: ${firstRealSentence(o.h.body)} (${monthDay(o.h.writtenOn)}; ${o.h.id})`);
      }
      if (tail !== null) out.push(tail);
      if (n.said && said !== null) out.push(said.line);
      return { lines: out, leadBytes: leadSize };
    };
    const most = newest === undefined || stepDown ? 1 : Math.max(1, leadOf(newest.body, leadLines, leadBytes).lines.length);
    const n = { lead: most, since: Math.min(SHAPE.SINCE_SHOWN, sinceLines.length), older: Math.min(SHAPE.OLDER_SHOWN, olderPick.length), said: said !== null };
    const size = (): number => byteLength(blockOf(build(n).lines));
    while (size() > b && n.older > 0) n.older -= 1;
    while (size() > b && n.since > 1) n.since -= 1;
    if (size() > b && n.said) n.said = false;
    while (size() > b && n.lead > 1) n.lead -= 1;
    if (size() > b && n.since > 0) n.since = 0;
    const lines = build(n);
    const text = blockOf(lines.lines);
    if (byteLength(text) > b) return { text: "", ids: [], items: 0 };
    const shownOlder = olderPick.slice(0, n.older);
    return {
      text,
      ids: [...(newest === undefined ? [] : [newest.id]), ...sinceLines.slice(0, n.since).map((s) => s.id), ...shownOlder.map((o) => o.h.id)],
      items: n.since + shownOlder.length + (newest === undefined ? 0 : 1),
      handoffs: [...(newest === undefined ? [] : [{ h: newest, bytes: lines.leadBytes }]), ...shownOlder.map((o) => ({ h: o.h, bytes: byteLength(firstRealSentence(o.h.body)) }))],
      ...(said === null ? {} : { saidBytes: n.said ? said.bytes : 0 }),
      chapters: sinceLines.slice(0, n.since).filter((s) => s.chapter).length,
    };
  };

  // Nothing above it can claim one of these: the page was told to skip them, a
  // plain cue is a dated row and the folder's own are this project's, and neither
  // reaches `elsewhereFacts`.
  const elsewhereSec = (b: number): Sec => {
    const cap = spareOn.has("elsewhere") ? SHAPE.ELSEWHERE_SHOWN_SPARE : SHAPE.ELSEWHERE_SHOWN;
    const list = elsewhere.list;
    const total = list.length + elsewhere.quiet.length;
    if (total === 0) return { text: "", ids: [], items: 0 };
    const render = (k: number): string[] => {
      const out = ["Elsewhere:"];
      // EVERY LINE SAYS WHEN AND WHAT (WK3): its own age on each line, and a
      // live folder with nothing written says since when and that it's quiet.
      for (const e of list.slice(0, k)) {
        if (e.title === null) out.push(`- ${e.place} (live): open since ${clockWords(e.since, at, zone)}, nothing written there since yesterday`);
        else out.push(`- ${e.place}${e.live ? " (live)" : ""}: ${e.title} (${ageOf(e.fact)})`);
      }
      const rest = total - k;
      if (rest > 0) out.push(`+${plural(rest, "more folder")}; recall "${ELSEWHERE_HANDLE}"`);
      return out;
    };
    let k = Math.min(cap, list.length);
    while (k > 0 && byteLength(blockOf(render(k))) > b) k -= 1;
    if (k === 0) return { text: "", ids: [], items: 0 };
    return { text: blockOf(render(k)), ids: list.slice(0, k).flatMap((e) => (e.id === null ? [] : [e.id])), items: k };
  };

  const comingSec = (b: number, claim: ReadonlySet<string>): Sec => {
    const live = cues.filter((c) => !claim.has(c.id) || c.plain);
    // Another folder's dated work isn't due here (FS1): it's counted "in other folders", as the `coming up` door lists it.
    // A plain reminder too (SO1 step 3, 2026-11-07): another folder's work is said in its own folder, not here; a personal one (me, us, owner) is `mine` everywhere.
    const todayAll = live.filter((c) => c.today && saysHere(c));
    const ranked = [...todayAll].sort(dueOrder);
    const plain = ranked.filter((c) => c.plain && !shownEarlier.has(c.id) && !retold.has(c.id));
    const again = ranked.filter((c) => retold.has(c.id));
    const folded = live.filter((c) => shownEarlier.has(c.id)).length;
    const rest = ranked.filter((c) => !c.plain);
    const overdue = live.filter((c) => c.past && c.mine).sort((x, y) => String(y.due).localeCompare(String(x.due)));
    const laterAll = live.filter((c) => !c.today && !c.past && c.mine).sort((x, y) => String(x.due ?? UNDATED_LAST).localeCompare(String(y.due ?? UNDATED_LAST)));
    const other = live.filter((c) => !saysHere(c));
    const laterCap = spareOn.has("coming") ? SHAPE.LATER_SHOWN_SPARE : SHAPE.LATER_SHOWN;
    const settlesWords = (c: Cue): string => (c.settles === null ? "" : ` · settles when ${flatten(c.settles)}`);
    const dueLine = (c: Cue): string => `- Due today · ${c.plain ? c.body : c.title}${settlesWords(c)} [${c.id}]`;
    // Told in another session today: its title, not its whole body again (WK3).
    const againLine = (c: Cue): string => `- Due today · ${c.title}${settlesWords(c)} [${c.id}]`;
    const overdueLine = (c: Cue): string => `- ${c.due === null ? "Overdue" : `${plural(Math.max(1, daysBetween(c.due, at)), "day")} overdue`} · ${c.title} [${c.id}]`;
    const laterLine = (c: Cue): string => `- ${c.due === null ? "Soon" : monthDay(c.due)}${c.every === null ? "" : ` (${c.every})`} · ${c.title} [${c.id}]`;
    const order: { c: Cue; line: string }[] = [
      ...plain.map((c) => ({ c, line: dueLine(c) })),
      ...again.slice(0, SHAPE.RETOLD_SHOWN).map((c) => ({ c, line: againLine(c) })),
      ...rest.slice(0, SHAPE.DUE_TODAY_SHOWN).map((c) => ({ c, line: dueLine(c) })),
      ...overdue.slice(0, SHAPE.OVERDUE_SHOWN).map((c) => ({ c, line: overdueLine(c) })),
      ...laterAll.slice(0, laterCap).map((c) => ({ c, line: laterLine(c) })),
    ];
    // OTHER FOLDERS' PLAIN REMINDERS DUE TODAY BY NAME (SO1 step 3 fix round): at
    // most two, "folder: title", then "and N more", only when the line still fits.
    const otherPlain = other.filter((c) => c.plain && c.today);
    const among = [here?.scope ?? "", ...otherPlain.flatMap((c) => (c.folder === null ? [] : [c.folder]))];
    const short = (t: string): string => (t.length <= PLAIN_OTHER_TITLE_CHARS ? t : `${t.slice(0, PLAIN_OTHER_TITLE_CHARS - 1).trimEnd()}…`);
    const namedParts = otherPlain.length === 0 ? [] : [...otherPlain.slice(0, PLAIN_OTHER_NAMED).map((c) => `${c.folder === null ? "elsewhere" : placeWords(c.folder, among)}: ${short(flatten(c.title))}`), ...(otherPlain.length > PLAIN_OTHER_NAMED ? [`and ${String(otherPlain.length - PLAIN_OTHER_NAMED)} more`] : [])];
    const namedOther = namedParts.join("; ");
    // Overdue is said in other folders' count too (WK3): a count, never their lines (SO1 step 3).
    const oldestOf = (cs: readonly Cue[]): string | null => cs.reduce<string | null>((o, c) => (c.due !== null && isDay(c.due) && (o === null || c.due < o) ? c.due : o), null);
    const otherLate = other.filter((c) => c.past);
    const otherOldest = oldestOf(otherLate);
    const otherLateWords = otherLate.length === 0 ? "" : `${String(otherLate.length)} overdue${otherOldest === null ? "" : `, oldest ${monthDay(otherOldest)}`}`;
    const otherWords = (named: boolean): string => {
      const inside = [otherLateWords, ...(named ? namedParts : [])].filter((x) => x.length > 0);
      return `${String(other.length)} in other folders${inside.length === 0 ? "" : ` (${inside.join("; ")})`}`;
    };
    const render = (shown: readonly { c: Cue; line: string }[], named = false, terse = false): string[] => {
      const ids = new Set(shown.map((s) => s.c.id));
      const hiddenToday = todayAll.filter((c) => !ids.has(c.id) && !shownEarlier.has(c.id)).length;
      // OVERDUE IS SAID, NEVER FOLDED INTO "MORE HERE" (WK3): its own count, with
      // the oldest date, so eleven overdue items can't read as a few later ones.
      const lateHidden = overdue.filter((c) => !ids.has(c.id));
      const oldest = oldestOf(lateHidden);
      const lateWords = lateHidden.length === 0 ? "" : `${String(lateHidden.length)}${lateHidden.length < overdue.length ? " more" : ""} overdue${oldest === null || terse ? "" : ` (oldest ${monthDay(oldest)})`}`;
      const hereMore = laterAll.filter((c) => !ids.has(c.id)).length;
      const more = [hiddenToday > 0 ? `${String(hiddenToday)} more due today` : "", lateWords, hereMore > 0 ? `${String(hereMore)} more here` : "", other.length > 0 ? (terse ? `${String(other.length)} in other folders` : otherWords(named)) : ""].filter((x) => x.length > 0).join(", ");
      // The fold is its own clause: "2 due today, shown earlier in this session; 1 more due today; recall …".
      const words = [folded > 0 ? `${String(folded)} due today, shown earlier in this session` : "", more].filter((x) => x.length > 0).join("; ");
      // Nothing to list and nothing behind the door: no section (WF1), not "Nothing dated."
      if (shown.length === 0 && words.length === 0) return [];
      const out = ["Coming up:", ...shown.map((s) => s.line)];
      if (words.length > 0) out.push(`(${words}; recall "${COMING_UP_HANDLE}")`);
      return out;
    };
    // Whole lines in order; a line that doesn't fit goes behind the door, and a
    // later one may still fit: a long plain reminder doesn't hide what's after it.
    // A line due today comes before the overdue words (review of #792): short of
    // room, the door drops its dates and other folders' overdue count to keep it.
    const dueToday = new Set([...plain, ...again, ...rest].map((c) => c.id));
    const shown: { c: Cue; line: string }[] = [];
    let terse = false;
    for (const o of order) {
      if (byteLength(blockOf(render([...shown, o], false, terse))) <= b) shown.push(o);
      else if (!terse && dueToday.has(o.c.id) && byteLength(blockOf(render([...shown, o], false, true))) <= b) {
        terse = true;
        shown.push(o);
      }
    }
    // The names ride only in room the lines didn't need: never a line for them.
    const withNames = blockOf(render(shown, true));
    const text = !terse && namedOther !== "" && byteLength(withNames) <= b ? withNames : blockOf(render(shown, false, terse));
    // Its door alone, what the one pass keeps when an overdue item is behind it (WK3: never silent).
    // A plain reminder due today first, with the door at its tersest; else the door
    // alone when something overdue is behind it (review of #792: never the other way).
    const plainFirst = order.filter((o) => o.c.plain && dueToday.has(o.c.id));
    const floor = plainFirst.length > 0 ? byteLength(blockOf(render(plainFirst, false, true))) : overdue.length + otherLate.length === 0 ? 0 : byteLength(blockOf(render([])));
    if (byteLength(text) > b) return { text: "", ids: [], items: 0, floor };
    return { text, ids: shown.map((s) => s.c.id), items: shown.length, lined: shown.map((s) => s.c.id), floor };
  };

  const openSec = (b: number, claim: ReadonlySet<string>): Sec => {
    const cap = spareOn.has("open") ? SHAPE.OPEN_SHOWN_SPARE : SHAPE.OPEN_SHOWN;
    // What waits on the owner is said once, as `owed`, or not at all (SO1 step 4).
    const carried = openRows.filter((x) => !claim.has(x.i.id) && !cueIds.has(x.i.id) && x.r?.status !== "asked");
    // A memory another section said is said; a sunk handoff's pointer line above isn't the ask, so it is still said here.
    const owe = owed !== null && (owed.kind === "handoff" || !claim.has(owed.id)) ? owed : null;
    const oweLines = owe === null ? [] : aged([{ text: owe.text, age: ageOf(owe.at), tail: owe.tail }]);
    const lineOf = (x: (typeof carried)[number]): { text: string; age: string; tail: string } => ({
      text: `- ${x.r === undefined ? x.i.title : titleOfRow(x.r)}`,
      age: ageOf(x.at),
      tail: `${x.i.reconsidering === true ? " · a core memory being reconsidered" : ""}${x.i.settlesWhen === undefined ? "" : ` · settles when ${flatten(x.i.settlesWhen)}`} [${x.i.id}]`,
    });
    const render = (k: number): string[] => {
      const more = carried.length - k;
      const door = more > 0 || open.parked > 0 ? `(${[more > 0 ? `${String(more)} more open` : "", open.parked > 0 ? `${String(open.parked)} parked` : ""].filter((w) => w.length > 0).join(", ")}; recall "still open")` : "";
      // Nothing open and nothing parked: no section (WF1), not "Nothing open."
      if (k === 0 && door === "" && oweLines.length === 0) return [];
      return ["Still open:", ...oweLines, ...aged(carried.slice(0, k).map(lineOf)), ...(door === "" ? [] : [door])];
    };
    let k = Math.min(cap, carried.length);
    while (k > 0 && byteLength(blockOf(render(k))) > b) k -= 1;
    const text = blockOf(render(k));
    if (byteLength(text) > b) return { text: "", ids: [], items: 0 };
    const ids = [...(owe === null ? [] : [owe.id]), ...carried.slice(0, k).map((x) => x.i.id)];
    // Open threads and the lookup ledger hold memory ids: a sunk handoff's id is claimed, not lined.
    const lined = owe?.kind === "handoff" ? ids.filter((id) => id !== owe.id) : ids;
    return { text, ids, items: ids.length, lined, ...(owe === null ? {} : { owed: owe }) };
  };

  const yesterdaySec = (b: number, claim: ReadonlySet<string>): Sec => {
    if (summary !== null) {
      const whole = blockOf([`Yesterday, in day's end's words: ${flatten(summary)}`]);
      if (byteLength(whole) <= b) return { text: whole, ids: [], items: 0 };
    }
    const list = yestHere.filter((c) => !claim.has(c.id));
    if (list.length === 0) return { text: "", ids: [], items: 0 };
    const render = (k: number): string[] => {
      const out = ["Yesterday here:", ...list.slice(0, k).map((c) => `- "${flatten((c.title ?? "").trim() || "untitled")}" (${c.id})`)];
      if (list.length > k) out.push(`(+${String(list.length - k)} more; recall "${HANDOFFS_HANDLE}")`);
      return out;
    };
    let k = list.length;
    while (k > 0 && byteLength(blockOf(render(k))) > b) k -= 1;
    if (k === 0) return { text: "", ids: [], items: 0 };
    return { text: blockOf(render(k)), ids: list.slice(0, k).map((c) => c.id), items: k };
  };

  const nightSec = (b: number, claim: ReadonlySet<string>): Sec => {
    const closed = closedLine === null ? [] : [closedLine];
    const down = setDown === null ? [] : [setDown.line];
    // THE MOMENT WAS TOLD: CARRY SOMETHING ELSE FORWARD (review of #792). The
    // night's own line said only what the wake already told, so the closing
    // line is an open thread no section above showed, newest first.
    const forward = ownLine !== null || night?.own === null || night === null ? null : (openRows.find((x) => !claim.has(x.i.id) && !cueIds.has(x.i.id)) ?? null);
    const forwardLine = forward === null ? null : `Carried forward: ${forward.r === undefined ? forward.i.title : titleOfRow(forward.r)} [${forward.i.id}]`;
    const as = (f: readonly string[]): Sec => {
      const text = blockOf([...f]);
      const fwd = forward !== null && forwardLine !== null && f.includes(forwardLine) ? [forward.i.id] : [];
      return setDown !== null && f.includes(setDown.line) ? { text, ids: [...setDown.ids, ...fwd], items: fwd.length, setDownNight: setDown.night } : { text, ids: fwd, items: fwd.length, ...(fwd.length === 0 ? {} : { lined: fwd }) };
    };
    if (night === null) {
      // Widest first: what it closed and what it set down; then each alone.
      const forms = [[...closed, ...down], closed, down].filter((f) => f.length > 0);
      for (const f of forms) if (byteLength(blockOf(f)) <= b) return as(f);
      return { text: "", ids: [], items: 0 };
    }
    // Widest first: the line, the night's own words, what it closed, what it
    // set down. Short of room, what it set down goes first (recall "set down"
    // holds it), then what it closed; the night's own words, which have no
    // door, are kept longest; then the line alone.
    const own = ownLine !== null ? [ownLine] : forwardLine === null ? [] : [forwardLine];
    const forms = [
      [night.line, ...own, ...closed, ...down],
      ...(own.length === 0 || down.length === 0 ? [] : [[night.line, ...own, ...closed]]),
      ...(own.length === 0 || closed.length === 0 ? [] : [[night.line, ...own, ...down], [night.line, ...own]]),
      ...(closed.length + down.length === 0 ? [] : [[night.line, ...closed, ...down]]),
      ...(down.length === 0 ? [] : [[night.line, ...closed]]),
      [night.line],
    ];
    for (const f of forms) if (byteLength(blockOf(f)) <= b) return as(f);
    return { text: "", ids: [], items: 0 };
  };

  const fn: Readonly<Record<SectionKey, (b: number, claim: ReadonlySet<string>) => Sec>> = {
    news: newsSec,
    folder: folderSec,
    elsewhere: elsewhereSec,
    coming: comingSec,
    open: openSec,
    yesterday: yesterdaySec,
    night: nightSec,
  };

  /** Sections in order, claiming ids into one set. A plain reminder due today is Coming up's whatever else could name it. */
  const compose = (budgets: Budgets): Record<SectionKey, Sec> => {
    const claim = new Set<string>(cues.filter((c) => c.plain).map((c) => c.id));
    for (const id of self.ids) claim.add(id);
    const out = {} as Record<SectionKey, Sec>;
    for (const k of ORDER) {
      const s = fn[k](budgets[k], claim);
      for (const id of s.ids) claim.add(id);
      out[k] = s;
    }
    return out;
  };
  const used = (s: Record<SectionKey, Sec>): number => ORDER.reduce((n, k) => n + byteLength(s[k].text), 0);
  const left = room - byteLength(self.text);

  // A plain reminder's room: its whole body, or its title when told in another session (WK3).
  const plainBytes = cues.filter((c) => c.plain && saysHere(c) && !shownEarlier.has(c.id)).reduce((n, c) => n + byteLength(`- Due today · ${retold.has(c.id) ? c.title : c.body}${c.settles === null ? "" : ` · settles when ${flatten(c.settles)}`} [${c.id}]\n`), byteLength("Coming up:\n\n"));
  const summaryBytes = summary === null ? 0 : byteLength(`Yesterday, in day's end's words: ${flatten(summary)}\n\n`);
  const budgets: Budgets = { ...SHAPE.ROOM, coming: Math.max(SHAPE.ROOM.coming, plainBytes + SHAPE.COMING_PAST_PLAIN), yesterday: Math.max(SHAPE.ROOM.yesterday, summaryBytes) };
  let sec = compose(budgets);
  // ── the one pass: over, room given back in `GIVE`'s order; a plain reminder's
  // room is kept till every other section has given; a page never steps down
  // for this, it already chose its rung.
  for (const pass of [0, 1] as const) {
    for (const key of GIVE) {
      const over = used(sec) - left;
      if (over <= 0) break;
      const floor = pass === 0 && key === "coming" ? Math.min(Math.max(plainBytes + SHAPE.COMING_PAST_PLAIN, sec[key].floor ?? 0), byteLength(sec[key].text)) : Math.min(sec[key].floor ?? 0, byteLength(sec[key].text));
      budgets[key] = Math.max(floor, byteLength(sec[key].text) - over);
      sec = compose(budgets);
    }
  }
  if (used(sec) > left) {
    for (const k of ORDER) budgets[k] = 0;
    sec = compose(budgets);
  }
  // ── and under, what's spare in `SPARE`'s order ──
  for (const key of SPARE) {
    const spare = left - used(sec);
    if (spare <= 0) break;
    const was = budgets[key];
    budgets[key] = byteLength(sec[key].text) + spare;
    spareOn.add(key);
    const next = compose(budgets);
    if (used(next) <= left) {
      sec = next;
      budgets[key] = byteLength(next[key].text);
    } else {
      budgets[key] = was;
      spareOn.delete(key);
      sec = compose(budgets);
    }
  }

  // ── the wake ──
  const elements = self.elements + ORDER.reduce((n, k) => n + sec[k].items, 0);
  const bodyOf = (b: string): string =>
    `${opening(elements, b)}\n${SHAPED_CONTEXT}\n\n${self.text}${ORDER.map((k) => sec[k].text).join("")}${closing(elements, b, self.rung !== null)}`;
  const stated = fixedPointTotal(byteLength(bodyOf("")), WAKE_BYTE_COUNTS);
  const body = bodyOf(String(stated));
  if (!readSentinel(body).intact) return null;
  return finish(cp, delivery, here, budget, {
    body,
    sections: Object.fromEntries([["page", byteLength(self.text)], ...ORDER.filter((k) => sec[k].text.length > 0).map((k) => [SECTION_NAME[k], byteLength(sec[k].text)] as const)]),
    closingBytes: byteLength(closing(elements, String(stated), self.rung !== null)),
    rung: self.rung,
    lined: [...self.lined, ...ORDER.flatMap((k) => sec[k].lined ?? [])],
    threads: sec.open.lined ?? [],
    sec,
    live: hs.length,
    since: later?.items.length ?? 0,
    hs,
  });
}

/** Through the delivery's own seams: the preface, the head's fields, and what a delivery records. */
function finish(
  cp: Counterpart,
  delivery: WakeDelivery,
  here: WakeHere | undefined,
  budget: number,
  w: {
    readonly body: string;
    readonly sections: Readonly<Record<string, number>>;
    readonly closingBytes: number;
    readonly rung: string | null;
    readonly lined: readonly string[];
    readonly threads: readonly string[];
    readonly sec: Record<SectionKey, Sec>;
    readonly live: number;
    readonly since: number;
    readonly hs: readonly Handoff[];
  },
): ShapedWake | null {
  let result = cp.self.wake(delivery, w.body);
  if (!result.ok) return null;
  const fields = here?.headFields ?? [];
  let tagged = false;
  if (fields.length > 0) {
    const head = cp["headFieldsOn"](result, fields, budget);
    if (head !== null) {
      result = head;
      tagged = true;
    }
  }
  // Past the ceiling is a bug here, and the road below is known good.
  if (result.bytes > budget) return null;
  const reader = here?.session ?? null;
  w.sec.folder.handoffs?.forEach((s, i) => {
    cp.handoffs.noteShown(s.h, { bytes: s.bytes, session: reader, among: w.live, ...(i === 0 ? { plans: w.since } : {}) });
  });
  const lead = w.sec.folder.handoffs?.[0];
  // Counted by id whatever its shape, whole or the stepped-down pointer (review 2 of #792).
  if (lead !== undefined) noteLed(cp, lead.h, reader, w.hs);
  // RAISED (SO1 step 4): said in a delivered wake, in a session someone attends
  // (`owed` is only chosen there), once per item per lived day store-wide.
  const owed = w.sec.open.owed;
  if (owed !== undefined && reader !== null && !cp.observer) {
    noteRaised(cp.store, { id: owed.id, version: owed.version, kind: owed.kind, scope: owed.scope }, { day: cp.store.livedDay(), session: reader, via: "wake" });
  }
  if (w.sec.folder.saidBytes !== undefined) cp["emit"](w.sec.folder.saidBytes > 0 ? "counterpart.lastexchange.shown" : "counterpart.lastexchange.noroom", undefined, { bytes: w.sec.folder.saidBytes });
  if ((w.sec.folder.chapters ?? 0) > 0) cp["emit"]("counterpart.lasthere.shown", undefined, { bytes: 0, lines: w.sec.folder.chapters ?? 0 });
  // TOLD ONCE (PG1, review of #789): the night whose set-downs this wake
  // told, so a later session's wake doesn't tell them again.
  const toldNight = w.sec.night.setDownNight;
  if (toldNight !== undefined) {
    try {
      cp.store.setMeta(SET_DOWN_TOLD_KEY, toldNight);
    } catch {
      /* told, and not recorded: the next wake may tell it again */
    }
  }
  const others = Object.values(w.sections).reduce((n, b) => n + b, 0);
  return {
    result,
    lined: w.lined,
    threads: w.threads,
    tagged,
    sections: { head: result.bytes - others - w.closingBytes, ...w.sections, end: w.closingBytes },
    page: w.rung,
  };
}

/**
 * HOW MANY SESSIONS WORKED HERE SINCE A HANDOFF: the distinct other sessions
 * that left a chapter or a memory here after it (not the handoff's own, not
 * this reader, not one nobody attended, not the night's), and that have ended.
 * A session that only opened here, a check-in that left nothing, or one still
 * open beside this one says nothing about the handoff (review of #734: a
 * silent check-in, still live, stepped a 20-hour handoff down to a recall, with
 * nothing in "Since, here" to read instead). Never throws.
 */
function sessionsSince(
  cp: Counterpart,
  o: {
    readonly at: number;
    readonly own: string | null;
    readonly reader: string | null;
    readonly folders: readonly string[];
    readonly sessions: readonly WakeSession[];
    readonly headless: ReadonlySet<string>;
    readonly chapters: readonly ChapterHere[];
    readonly now: number;
  },
): number {
  const live = new Set(o.sessions.filter((s) => s.live).map((s) => s.session));
  const other = (s: string | null): s is string => s !== null && s.length > 0 && s !== o.own && s !== o.reader && !o.headless.has(s) && !live.has(s);
  const seen = new Set<string>();
  for (const c of o.chapters) if (c.writtenAt > o.at && other(c.session)) seen.add(c.session);
  try {
    for (const f of o.folders) for (const r of cp.store.memoriesWrittenHereSince(f, o.at, o.now, SHAPE.SINCE_READ)) if (!isNightRow(r) && !isTold(r) && other(r.origin_session ?? null)) seen.add(r.origin_session as string);
  } catch {
    /* what the chapters said */
  }
  return seen.size;
}

/** The meta key recording which sessions' wakes each live handoff led (review of #792): `{ [id]: { version, sessions } }`. */
export const HANDOFF_LED_KEY = "wake.handoff.led";

type LedRecord = Record<string, { readonly version: number; readonly sessions: readonly string[]; readonly scope?: string; readonly last?: number }>;

function ledRecord(store: Counterpart["store"]): LedRecord {
  try {
    const v = JSON.parse(store.getMeta(HANDOFF_LED_KEY) ?? "{}") as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as LedRecord) : {};
  } catch {
    return {};
  }
}

/** This session's wake led with `h`: recorded (one entry per live handoff, the sessions distinct, a few kept). Never throws. */
function noteLed(cp: Counterpart, h: Handoff, session: string | null, live: readonly Handoff[]): void {
  if (session === null || cp.observer) return;
  try {
    const was = ledRecord(cp.store);
    const keep = new Set(live.map((x) => x.id));
    const out: LedRecord = {};
    // Only this folder's gone handoffs are pruned: another folder's record stands (review 2 of #792).
    for (const [id, r] of Object.entries(was)) if (id !== h.id && (keep.has(id) || (r.scope !== undefined && r.scope !== h.scope))) out[id] = r;
    const mine = was[h.id];
    const sessions = mine === undefined || mine.version !== h.version ? [] : mine.sessions.filter((x) => x !== session);
    out[h.id] = { version: h.version, sessions: [...sessions, session].slice(-SHAPE.LEAD_SHOWN_KEPT), scope: h.scope, last: cp["nowFn"]() as number };
    cp.store.setMeta(HANDOFF_LED_KEY, JSON.stringify(out));
  } catch {
    /* a lead not recorded only sinks later */
  }
}

/** The ids a line names (`mem_…`), for what a handoff's lead points at. */
const MEMORY_ID = /\bmem_[0-9a-f]+\b/g;

/** The words a lead waits on the owner in, around the owner's name (`{owner}`): lightly held, read on invented and real leads alike. */
const WAITING_WORDS: readonly string[] = [
  "\\b(?:waiting|waits|wait) (?:on|for) {owner}\\b",
  "\\bask {owner}\\b",
  "\\b{owner}'s (?:word|yes|go|call|answer|decision|pick|choice|review|ok)\\b",
  "\\b{owner} to (?:pick|decide|choose|answer|say|confirm|review|approve|publish|run)\\b",
  // No name (review of #792: "ask for his first" led three sessions).
  "\\bask (?:for )?(?:his|her|their)\\b",
  "\\b(?:his|her|their) (?:call|word|yes|go|answer|decision)\\b",
  "\\bwhen (?:he|she|they) (?:answers?|replies|reply|decides?|says?)\\b",
];

/**
 * DOES THIS HANDOFF'S LEAD WAIT ON THE OWNER (WK3, 2026-11-09)? Its lead, whole
 * (`leadOf`, not only its first sentence), names a memory marked `asked` (the store's
 * own mark for a question to the owner), or says it waits on the owner by name
 * (`WAITING_WORDS`, or "the owner"). THE SEAM FOR SO1 STEP 4 (2026-11-09):
 * a lead it answers for that has sunk is a candidate for the wake's one
 * "Waiting on …" mention (`owedOne`), raised and backed off like an `asked`
 * memory (`owner-waits.ts`); parked, it stays sunk and is no longer said. The
 * raise events don't feed back here: a raise says it was shown, not that the
 * lead waits. Never throws.
 */
export function waitsOnOwner(store: Counterpart["store"], h: Pick<Handoff, "body">, owner: string | null): boolean {
  // The whole lead, not its first sentence (review 2 of #792: the wait sat past it).
  const lead = leadOf(h.body, SHAPE.LEAD_LINES, SHAPE.LEAD_BYTES).lines.join(" ");
  try {
    for (const id of lead.match(MEMORY_ID) ?? []) if (store.row(id)?.status === "asked") return true;
  } catch {
    /* a row that won't read answers nothing */
  }
  const names: string[] = owner !== null && owner.trim().length > 0 ? [owner.trim(), "the owner"] : ["the owner"];
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return WAITING_WORDS.some((w) => new RegExp(w.replace("{owner}", `(?:${alt})`), "iu").test(lead));
}

/** The one item waiting on the owner a wake says (SO1 step 4): its line, and what its raise records. */
interface Owed {
  readonly id: string;
  readonly version: number;
  readonly kind: "memory" | "handoff";
  readonly scope: string | null;
  /** The line before its age: "- Waiting on <owner>, …: <title>". */
  readonly text: string;
  readonly at: number;
  /** After its age: what settles it, how often it was raised, its id. */
  readonly tail: string;
}

/**
 * THE ONE THING WAITING ON THE OWNER THIS WAKE SAYS (SO1 step 4, revised; Mike
 * 11-07: "raise by relevance, not schedule"; the coordinator's 11-09 note: a
 * sunk handoff too, or it is hidden for good). Candidates: this reader's open
 * memories marked `asked` (here, or personal) and this folder's handoffs WK3
 * sank, each due by its backoff (`owner-waits.ts#waitState`: at most once a
 * week at session start, 3/7/14 lived days after each unanswered raise, then
 * parked). The most RELEVANT first: the most of its content words (title, and
 * what settles it) found in this folder's week (the lead, and the titles and
 * bodies' first lines written here in `OWNER_CONTEXT_MS`, its own row aside);
 * then this folder's before a personal one, then the oldest, then by id. No
 * model, no write. Null when none is due. Never throws.
 */
function owedOne(
  cp: Counterpart,
  o: {
    readonly day: number;
    readonly now: number;
    readonly rows: readonly { readonly id: string; readonly row: MemoryRow; readonly settles: string | null; readonly at: number; readonly here: boolean }[];
    readonly handoffs: readonly Handoff[];
    readonly lead: string;
    readonly folders: readonly string[];
  },
): Owed | null {
  const record = raiseRecord(cp.store);
  let owner: string | null = null;
  try {
    owner = cp.ownerDisplayName();
  } catch {
    owner = null;
  }
  const who = owner !== null && owner.trim().length > 0 ? owner.trim() : "the owner";
  type Cand = Owed & { readonly words: ReadonlySet<string>; readonly here: boolean };
  const cands: Cand[] = [];
  const raisedWords = (n: number): string => (n === 0 ? "" : ` · raised ${plural(n, "time")} before, unanswered`);
  for (const x of o.rows) {
    const st = waitState(raisesAt(record, x.id, x.row.revision), o.day);
    if (st.kind !== "due") continue;
    const title = titleOfRow(x.row);
    cands.push({
      id: x.id,
      version: x.row.revision,
      kind: "memory",
      scope: x.row.origin_scope ?? null,
      text: `- Waiting on ${who}, ask when it fits: ${title}`,
      at: x.at,
      tail: `${x.settles === null ? "" : ` · settles when ${flatten(x.settles)}`}${raisedWords(st.raised)} [${x.id}]`,
      words: contentWords(`${title} ${x.settles ?? ""}`),
      here: x.here,
    });
  }
  for (const h of o.handoffs) {
    const st = waitState(raisesAt(record, h.id, h.version), o.day);
    if (st.kind !== "due") continue;
    const title = titleOfRow({ title: null, body: h.body });
    cands.push({
      id: h.id,
      version: h.version,
      kind: "handoff",
      scope: h.scope,
      text: `- Waiting on ${who}, ask when it fits: ${title}`,
      at: cp.handoffs.writtenAt(h) ?? startOfLocalDay(h.writtenOn, cp.store.zone()),
      tail: ` · a handoff, below the others${raisedWords(st.raised)} [${h.id}]`,
      words: contentWords(leadOf(h.body, SHAPE.LEAD_LINES, SHAPE.LEAD_BYTES).lines.join(" ")),
      here: true,
    });
  }
  if (cands.length === 0) return null;
  // This folder's week, as words: what an item is relevant to here.
  const ids = new Set(cands.map((c) => c.id));
  let recent: MemoryRow[] = [];
  try {
    recent = o.folders.flatMap((f) => cp.store.memoriesWrittenHereSince(f, o.now - SHAPE.OWNER_CONTEXT_MS, o.now, SHAPE.SINCE_READ));
  } catch {
    recent = [];
  }
  const week = contentWords([o.lead, ...recent.filter((r) => !ids.has(r.id) && !isNightRow(r)).map((r) => `${r.title ?? ""} ${r.body.split("\n")[0] ?? ""}`)].join(" "));
  const score = (c: Cand): number => [...c.words].filter((w) => week.has(w)).length;
  const ranked = cands.map((c) => ({ c, n: score(c) })).sort((a, b) => b.n - a.n || Number(b.c.here) - Number(a.c.here) || a.c.at - b.c.at || (a.c.id < b.c.id ? -1 : 1));
  const top = ranked[0]?.c;
  if (top === undefined) return null;
  const { words: _w, here: _h, ...owed } = top;
  return owed;
}

/** The meta key caching each folder's owed items for the turn lane, per lived day (round 3 of #796): `{ [folder]: { day, fp, at, items } }`. */
export const OWNER_ITEMS_KEY = "wake.owner.items";

/** The cached list's shape, in its fingerprint: a list cached in an older shape is built again. */
const OWNER_ITEMS_SHAPE = "subject-words";

/** One item waiting on the owner, as the turn lane matches it: its line's parts and its weighed words. */
export interface OwedItem {
  readonly id: string;
  readonly version: number;
  readonly kind: "memory" | "handoff";
  readonly scope: string | null;
  readonly title: string;
  readonly needs: string | null;
  readonly at: number;
  readonly terms: TermWeights;
}

/** The owner's name and "owner", as index terms: a word every such item says, so it counts for nothing. */
function ownerAside(cp: Counterpart): { who: string; aside: ReadonlySet<string> } {
  let owner: string | null = null;
  try {
    owner = cp.ownerDisplayName();
  } catch {
    owner = null;
  }
  const who = owner !== null && owner.trim().length > 0 ? owner.trim() : "the owner";
  return { who, aside: new Set(termsOf(`${who} owner`, SHAPE.WORD_MIN).keys()) };
}

/**
 * ONE SUBJECT, ONE CHAIN (round 3 of #796: a memory raised on one day and the
 * handoff about it the next). A sunk handoff whose lead names an `asked`
 * memory among `mems`, or whose first sentence touches one's words as a turn
 * would (`touches`), is that memory's: not a candidate of its own, so the
 * memory's raise chain is the subject's. Pure but for the weighing.
 */
function handoffJoins(h: Handoff, first: TermWeights, mems: readonly { readonly id: string; readonly terms: TermWeights }[], aside: ReadonlySet<string>): boolean {
  const named = new Set(leadOf(h.body, SHAPE.LEAD_LINES, SHAPE.LEAD_BYTES).lines.join(" ").match(MEMORY_ID) ?? []);
  if (mems.some((m) => named.has(m.id))) return true;
  const words = new Set(Object.keys(first.w));
  return mems.some((m) => touches(sharedWeight(m.terms, words, aside)));
}

/** The sunk handoffs that are no `asked` memory's subject (`handoffJoins`): the wake's candidates of their own. */
function joinless(cp: Counterpart, hs: readonly Handoff[], mems: readonly { readonly id: string; readonly text: string }[]): Handoff[] {
  if (hs.length === 0 || mems.length === 0) return [...hs];
  const size = cp.store.countMemories({ archived: false });
  const { aside } = ownerAside(cp);
  const terms = weighMany(cp.store, [...mems.map((m) => m.text), ...hs.map((h) => firstRealSentence(h.body))], size);
  const weighed = mems.map((m, i) => ({ id: m.id, terms: terms[i] ?? NO_TERMS }));
  return hs.filter((h, i) => !handoffJoins(h, terms[mems.length + i] ?? NO_TERMS, weighed, aside));
}

/**
 * THE ITEMS WAITING ON THE OWNER HERE, WEIGHED (SO1 step 4, the turn lane):
 * open memories marked `asked` that this folder's Still open would carry (its
 * own, a joined folder's, or personal; not dated, whose home is Coming up),
 * each by its title and what settles it; and this folder's handoffs WK3 sank,
 * each by its lead's first sentence and the titles of the memories its lead
 * names, unless it joins an `asked` memory's chain (`handoffJoins`). Reads only.
 */
export function owedItems(cp: Counterpart, scope: string, exportsFrom?: (scope: string) => boolean): OwedItem[] {
  const store = cp.store;
  const now: number = cp["nowFn"]();
  const reader = cp["threadReader"](scope, exportsFrom);
  const folders = new Set(reader.folders.map(projectFolder).filter((f) => f.length > 0));
  const rule = { craftTravels: cp.self.tunables.PROJECTS_TRAVEL, craftSince: craftSince(store) };
  const size = store.countMemories({ archived: false });
  const { aside } = ownerAside(cp);
  const asked = store.askedOpenStamps().map((r) => r.id);
  const found: (Omit<OwedItem, "terms"> & { readonly text: string })[] = [];
  for (const f of asked.length === 0 ? [] : store.openThreadTouches({ at: store.today(), ids: asked })) {
    if (!f.asked || f.dated) continue;
    const r = store.row(f.id);
    if (r === undefined || r.status !== "asked" || r.superseded_by !== null) continue;
    if (threadPlace({ about: r.about ?? null, kind: r.kind as Kind, originScope: r.origin_scope ?? null, journal: false }, folders, rule) === "out") continue;
    let needs: string | null = null;
    try {
      needs = settlesWhenOf(store.readProse(f.id).meta);
    } catch {
      needs = null;
    }
    const title = titleOfRow(r);
    found.push({ id: f.id, version: r.revision, kind: "memory", scope: r.origin_scope ?? null, title, needs, at: r.created_at ?? now, text: `${title} ${needs ?? ""}` });
  }
  const sunk = new Set<string>();
  const hs = handoffsTold(cp, cp.handoffs.readAll(scope), [...folders], now, null, sunk).slice(1).filter((h) => sunk.has(h.id));
  // A handoff by its lead's first sentence and the titles of the memories its lead names.
  const handText = (h: Handoff): string => {
    const named = leadOf(h.body, SHAPE.LEAD_LINES, SHAPE.LEAD_BYTES).lines.join(" ").match(MEMORY_ID) ?? [];
    return [firstRealSentence(h.body), ...named.flatMap((id) => {
      const r = store.row(id);
      return r === undefined ? [] : [titleOfRow(r)];
    })].join(" ");
  };
  // One document-frequency read for every item's words, and each handoff's first sentence.
  const weights = weighMany(store, [...found.map((x) => x.text), ...hs.map((h) => firstRealSentence(h.body)), ...hs.map(handText)], size);
  const items: OwedItem[] = found.map(({ text: _t, ...x }, i) => ({ ...x, terms: weights[i] ?? NO_TERMS }));
  const mems = [...items];
  hs.forEach((h, i) => {
    if (handoffJoins(h, weights[found.length + i] ?? NO_TERMS, mems, aside)) return;
    items.push({
      id: h.id,
      version: h.version,
      kind: "handoff",
      scope: h.scope,
      title: titleOfRow({ title: null, body: h.body }),
      needs: null,
      at: cp.handoffs.writtenAt(h) ?? startOfLocalDay(h.writtenOn, store.zone()),
      terms: weights[found.length + hs.length + i] ?? NO_TERMS,
    });
  });
  return items;
}

type ItemsCache = Record<string, { readonly day: number; readonly fp: string; readonly at: number; readonly items: readonly OwedItem[] }>;

/**
 * `owedItems`, CACHED PER FOLDER PER LIVED DAY (round 3 of #796: the build
 * cost 17–23 ms a turn on a real store). Kept in meta under the folder (every
 * session there reads the same list, so asked per session it would only be
 * built more often), with a
 * fingerprint of what would change the list: the `asked` open items' ids and
 * revisions, this folder's handoffs' ids and versions, and WK3's lead record
 * (what sinks one). A write that changes any of those, or a new lived day,
 * builds it again. The cache never decides: only how often the list is read.
 */
function owedItemsCached(cp: Counterpart, scope: string, exportsFrom?: (scope: string) => boolean): OwedItem[] {
  const store = cp.store;
  const day = store.livedDay();
  const fp = hashText(JSON.stringify([OWNER_ITEMS_SHAPE, scope, store.askedOpenStamps(), cp.handoffs.readAll(scope).map((h) => [h.id, h.version]), store.getMeta(HANDOFF_LED_KEY) ?? ""]));
  let was: ItemsCache = {};
  try {
    const v = JSON.parse(store.getMeta(OWNER_ITEMS_KEY) ?? "{}") as unknown;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) was = v as ItemsCache;
  } catch {
    was = {};
  }
  const hit = was[scope];
  if (hit !== undefined && hit.day === day && hit.fp === fp && Array.isArray(hit.items)) return [...hit.items];
  const items = owedItems(cp, scope, exportsFrom);
  if (!cp.observer) {
    try {
      const { [scope]: _old, ...rest } = was;
      const kept = Object.entries(rest)
        .sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0))
        .slice(-(SHAPE.OWNER_ITEMS_KEPT - 1));
      store.setMeta(OWNER_ITEMS_KEY, JSON.stringify(Object.fromEntries([...kept, [scope, { day, fp, at: cp["nowFn"](), items }]])));
    } catch {
      /* uncached: the next turn builds it again */
    }
  }
  return items;
}

/**
 * THE RELEVANCE LANE (SO1 step 4, revised, point 2; coordinator 11-09, round 3
 * of #796): what waits on the owner comes up when the turn touches its
 * subject, in its own project, with its context. A turn with fewer than
 * `OWNER_TURN_MIN_WORDS` content words doesn't look. Touched: at least
 * `OWNER_TURN_SHARED` of the item's words in the turn, weighing together
 * `OWNER_TURN_WEIGHT` at recall's cue weight (`owner-waits.ts#touches`); the
 * owner's name counts for nothing. Due by the SAME backoff and record as the
 * wake's mention (`owner-waits.ts`), without the wake's weekly floor: 3, 7, 14
 * lived days, then parked, once per lived day store-wide. The heaviest match
 * first, then the oldest. One line, or null. The caller shows it and records
 * the raise. Never throws.
 */
export function owedForTurn(
  cp: Counterpart,
  o: { readonly text: string; readonly scope: string; readonly exportsFrom?: (scope: string) => boolean },
): { line: string; item: { id: string; version: number; kind: "memory" | "handoff"; scope: string | null } } | null {
  try {
    if (contentWords(o.text).size < SHAPE.OWNER_TURN_MIN_WORDS) return null;
    const items = owedItemsCached(cp, o.scope, o.exportsFrom);
    if (items.length === 0) return null;
    const store = cp.store;
    const day = store.livedDay();
    const now: number = cp["nowFn"]();
    const record = raiseRecord(store);
    const { who, aside } = ownerAside(cp);
    const turn = new Set(termsOf(o.text).keys());
    const hits = items
      .map((i) => ({ i, s: sharedWeight(i.terms, turn, aside), st: waitState(raisesAt(record, i.id, i.version), day, SHAPE.OWNER_RAISE_STEPS, 0) }))
      .filter((x) => x.st.kind === "due" && touches(x.s))
      .sort((a, b) => b.s.sum - a.s.sum || a.i.at - b.i.at || (a.i.id < b.i.id ? -1 : 1));
    const top = hits[0];
    if (top === undefined) return null;
    const { i } = top;
    const needs = i.needs === null ? "" : ` · needs: ${flatten(i.needs)}`;
    const raised = top.st.raised === 0 ? "" : ` · raised ${plural(top.st.raised, "time")} before, unanswered`;
    const line = `Waiting on ${who}, ask when it fits: ${i.title}${needs} · waiting ${ageWords(i.at, now)}${i.kind === "handoff" ? " (a handoff)" : ""}${raised} [${i.id}]`;
    return { line, item: { id: i.id, version: i.version, kind: i.kind, scope: i.scope } };
  } catch {
    return null;
  }
}

/**
 * THE HANDOFFS AS THE WAKE TELLS THEM (WK3, 2026-11-09; a counterpart's
 * feedback: a 47-hour-old handoff led three sessions with "ask him first", and
 * ten-day-old ones were still listed). `all` newest first, as
 * `Handoffs#readAll` gives them; `recall "handoffs"` still lists every one.
 *
 *   - Not listed: one past `HANDOFF_LISTED_MS` that nothing written since
 *     refers to by its id (a newer handoff, or a memory written in one of this
 *     reader's folders). The newest always is: the folder's last word.
 *   - Sinks below the rest, newest first among them, until it is revised: one
 *     whose lead waits on the owner (`waitsOnOwner`) and that has led
 *     `LEAD_SHOWN_SINK` wakes since its last revision, with no reply since: no
 *     memory written here after it, by another session, whose title says the
 *     lead again (`titleInLead`) or that names a memory still `asked`. A
 *     handoff that doesn't wait on the owner never sinks. Alone, it still leads.
 *
 * Never throws: what can't be read keeps the order it came in.
 */
function handoffsTold(cp: Counterpart, all: readonly Handoff[], folders: readonly string[], now: number, reader: string | null, sunkOut?: Set<string>): Handoff[] {
  if (all.length <= 1) return [...all];
  const zone = cp.store.zone();
  const at = (h: Handoff): number => cp.handoffs.writtenAt(h) ?? startOfLocalDay(h.writtenOn, zone);
  const oldest = Math.min(...all.map(at));
  let rows: MemoryRow[] = [];
  try {
    rows = folders.flatMap((f) => cp.store.memoriesWrittenHereSince(f, oldest, now, SHAPE.SINCE_READ));
  } catch {
    rows = [];
  }
  const referred = (h: Handoff): boolean =>
    all.some((o) => o.id !== h.id && at(o) > at(h) && o.body.includes(h.id)) || rows.some((r) => (r.created_at ?? 0) > at(h) && (r.body.includes(h.id) || (r.meta ?? "").includes(h.id)));
  const listed = all.filter((h, i) => i === 0 || now - at(h) < SHAPE.HANDOFF_LISTED_MS || referred(h));
  const signal = (h: Handoff): boolean => {
    // The asked ids from the whole lead; the words from its first sentence only: a
    // five-line lead shares most titles' words by chance (review 2 of #792, real store).
    const lead = firstRealSentence(h.body);
    // Only an id still marked `asked`: a later row that merely cites a lead's other ids
    // (a night's, a recap) is no answer (review 2 of #792, real store).
    const asked = (leadOf(h.body, SHAPE.LEAD_LINES, SHAPE.LEAD_BYTES).lines.join(" ").match(MEMORY_ID) ?? []).filter((id) => {
      try {
        return cp.store.row(id)?.status === "asked";
      } catch {
        return false;
      }
    });
    return rows.some(
      (r) =>
        (r.created_at ?? 0) > at(h) &&
        (h.session === null || r.origin_session !== h.session) &&
        (titleInLead(flatten(r.title ?? ""), lead, SHAPE.SINCE_IN_LEAD) || asked.some((id) => r.body.includes(id) || (r.meta ?? "").includes(id))),
    );
  };
  let owner: string | null = null;
  try {
    owner = cp.ownerDisplayName();
  } catch {
    owner = null;
  }
  // SUNK (review 3 of #792): a lead that waits on the owner AND has led at least
  // `LEAD_SHOWN_SINK` wakes since its last revision (the record's version), with
  // no reply since. Nothing else sinks by count. It stays sunk until revised,
  // whatever else is left, so two stale leads never take turns.
  const led = ledRecord(cp.store);
  const ledEnough = (h: Handoff): boolean => {
    const r = led[h.id];
    return r !== undefined && r.version === h.version && r.sessions.length >= SHAPE.LEAD_SHOWN_SINK;
  };
  const sunk = new Set(listed.filter((h) => ledEnough(h) && !signal(h) && waitsOnOwner(cp.store, h, owner)).map((h) => h.id));
  // What SO1 step 4's weekly mention reads (coordinator 11-09): a sunk one is said there, or nowhere.
  for (const id of sunk) sunkOut?.add(id);
  // Sunk ones by when each last led, latest first: the one that sank first stays at
  // the bottom when every handoff has sunk (review 3 of #792: no tie flip-flop).
  const lastLed = (h: Handoff): number => led[h.id]?.last ?? 0;
  const down = listed.filter((h) => sunk.has(h.id)).sort((x, y) => lastLed(y) - lastLed(x));
  return [...listed.filter((h) => !sunk.has(h.id)), ...down];
}

/** Up to `OLDER_SHOWN` of the older handoffs, one per seat, not the lead's, newest of each. */
function pickOlder(hs: readonly Handoff[]): { h: Handoff; seat: string }[] {
  const first = hs[0];
  if (first === undefined) return [];
  const seen = new Set<string>([seatOf(first.body) ?? `session ${shortSession(first.session)}`]);
  const out: { h: Handoff; seat: string }[] = [];
  for (const h of hs.slice(1)) {
    const seat = seatOf(h.body) ?? `session ${shortSession(h.session)}`;
    if (seen.has(seat)) continue;
    seen.add(seat);
    out.push({ h, seat });
    if (out.length >= SHAPE.OLDER_SHOWN) break;
  }
  return out;
}

/** Who else is at work here now, with when they started. Nobody: no line (WF1). Asked only of a host with a registry: one with none can't say. */
function openHereLine(live: readonly WakeSession[], today: string, zone: string): string | null {
  if (live.length === 0) return null;
  const words = [...live]
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, SHAPE.OPEN_HERE_SHOWN)
    .map((s) => `session ${shortSession(s.session)}${typeof s.model === "string" && s.model.length > 0 ? ` on ${modelWords(s.model)}` : ""} since ${clockWords(s.startedAt, today, zone)}`);
  const rest = live.length - words.length;
  return `Open here now: ${words.join("; ")}${rest > 0 ? `; and ${String(rest)} more` : ""}.`;
}

/**
 * "LAST SAID": only a person's sentence, from the last session here. An
 * unattended session's words are not a person's, so it is passed over as if it
 * had not been here (#687's review), and a session further back is not the last
 * session: a quote from there would read as what was just said.
 */
function saidHere(
  cp: Counterpart,
  scope: string,
  here: WakeHere | undefined,
  sessions: readonly WakeSession[],
  headless: ReadonlySet<string>,
  chapters: readonly ChapterHere[],
  newest: Handoff | null,
  reader: string | null,
  zone: string,
  now: number,
): { line: string; bytes: number } | null {
  if (cp.observer) return null;
  const ex = lastExchange({
    buffer: cp.spans,
    scope,
    reader,
    now,
    sessions: sessions.map((s) => ({ session: s.session, scope: s.scope, lastAt: s.lastAt })),
    skip: headless,
  });
  if (ex === null) return null;
  const others = sessions.filter((s) => norm(s.scope) === scope && s.session !== reader && !headless.has(s.session)).sort((a, b) => b.lastAt - a.lastAt);
  const lastSession = others[0]?.session ?? chapters.find((c) => c.session !== reader && !headless.has(c.session))?.session ?? newest?.session ?? null;
  const openNow = others.some((s) => s.session === ex.session && s.live);
  if (lastSession !== null && ex.session !== lastSession && !openNow) return null;
  const when = localStamp(ex.said.at, zone);
  const line = `Last said ${when}: "${quoteOf(ex.said.text)}" (recall "${LAST_EXCHANGE_HANDLE}")`;
  return { line, bytes: byteLength(line) };
}

interface ElsewhereRow {
  readonly place: string;
  readonly id: string | null;
  readonly title: string | null;
  readonly fact: number;
  readonly at: number;
  readonly live: boolean;
  /** When its earliest live session here started; 0 when none is live. */
  readonly since: number;
}

/** One block for other folders: each one's NEWEST title, so an older line can't sit under its own correction; live ones first. */
function elsewhereFacts(
  cp: Counterpart,
  gate: ReturnType<Counterpart["elsewhereGate"]>,
  sessions: readonly WakeSession[],
  sinceY: number,
  now: number,
  reader: string | null,
  factAt: (id: string) => number,
): { list: ElsewhereRow[]; quiet: string[] } {
  if (gate === null) return { list: [], quiet: [] };
  const store = cp.store;
  const best = new Map<string, { id: string; title: string; at: number; fact: number }>();
  for (const m of store.memoryTitlesByScopeSince(sinceY, { until: now + 1, perScope: SHAPE.ELSEWHERE_ROWS_READ })) {
    if (m.session !== null && m.session === reader) continue;
    if (!gate.named(m.scope) || !isWorkMemory({ about: m.about, kind: m.kind as Kind, originScope: m.scope, journal: false })) continue;
    const key = gate.norm(m.scope);
    const had = best.get(key);
    if (had !== undefined && had.at >= m.at) continue;
    const row = store.row(m.id);
    best.set(key, { id: m.id, title: row === undefined ? flatten(m.title) : titleOfRow(row), at: m.at, fact: Math.min(m.at, factAt(m.id)) });
  }
  for (const ch of cp["chaptersInWindow"](store.livedDay()).values()) {
    if (ch.scope === null || ch.writtenAt < sinceY || ch.writtenAt > now || !gate.crosses(ch)) continue;
    const t = (ch.title ?? "").trim();
    if (t.length === 0) continue;
    const key = gate.norm(ch.scope);
    const had = best.get(key);
    if (had !== undefined && had.at >= ch.writtenAt) continue;
    best.set(key, { id: ch.id, title: `chapter "${flatten(t)}"`, at: ch.writtenAt, fact: ch.writtenAt });
  }
  const live = new Map<string, number>();
  for (const s of sessions) {
    if (!s.live || s.session === reader || !gate.named(s.scope)) continue;
    const key = gate.norm(s.scope);
    live.set(key, Math.min(live.get(key) ?? s.startedAt, s.startedAt));
  }
  // Folders worked in with no title to say: counted past the list, and named at its door.
  const counted = store.memoryCountsByScopeSince(sinceY).flatMap(({ scope }) => (gate.named(scope) ? [gate.norm(scope)] : []));
  // A folder by its name; by its path only when another here or in the section has the same name (FS1).
  const among = [...best.keys(), ...live.keys(), ...counted, ...gate.ours];
  const list: ElsewhereRow[] = [...best.entries()].map(([key, m]) => ({ place: placeWords(key, among), id: m.id, title: m.title, fact: m.fact, at: m.at, live: live.has(key), since: live.get(key) ?? 0 }));
  for (const [key, started] of live) if (!best.has(key)) list.push({ place: placeWords(key, among), id: null, title: null, fact: now, at: 0, live: true, since: started });
  list.sort((a, b) => Number(b.live) - Number(a.live) || b.at - a.at || (a.place < b.place ? -1 : 1));
  const named = new Set(list.map((l) => l.place));
  const quiet = new Set<string>();
  for (const key of counted) {
    const place = placeWords(key, among);
    if (!named.has(place)) quiet.add(place);
  }
  return { list, quiet: [...quiet].sort() };
}

/** One folder at Elsewhere's door: a line the section would print with room, or a folder it only counts (`title` null, not live). */
export interface ElsewhereListed {
  readonly place: string;
  readonly id: string | null;
  readonly title: string | null;
  readonly age: string | null;
  readonly live: boolean;
}

/**
 * ELSEWHERE WITH ROOM (the `elsewhere` handle): every folder the section lists or
 * counts for this reader, in its order, by its own read, so the `+N` in a wake is
 * what lies past the lines it printed here. Reads only.
 */
export function readElsewhere(cp: Counterpart, at: string, here: WakeHere | undefined): ElsewhereListed[] {
  const zone = cp.store.zone();
  const now: number = cp["nowFn"]();
  const facts = elsewhereFacts(cp, cp["elsewhereGate"](here), here?.sessions?.() ?? [], startOfLocalDay(addDays(at, -1), zone), now, here?.session ?? null, factClock(cp, zone));
  return [
    ...facts.list.map((e) => ({ place: e.place, id: e.id, title: e.title, age: e.title === null ? null : ageWords(e.fact, now), live: e.live })),
    ...facts.quiet.map((place) => ({ place, id: null, title: null, age: null, live: false })),
  ];
}

/**
 * "Closed by the night (2): 0.3.46 ready for Mike to publish — 0.3.47
 * released [mem_…]; … Not done? …" (2026-11-07, SO1 step 1): the newest
 * night's closes (`open-close.ts#lastNightCloses`) from lived day `day - 1`
 * on, kept to what this reader's Still open would carry (`threadPlace` not
 * `out`), at most `OPEN_CLOSE_TUNABLES.MORNING_SHOWN` by title. Null when none.
 */
function nightClosedLine(cp: Counterpart, day: number, folders: ReadonlySet<string>, rule: WorkRule): string | null {
  const store = cp.store;
  const mine = lastNightCloses(store, Math.max(0, day - 1)).filter((x) => {
    const r = store.row(x.id);
    return r !== undefined && threadPlace({ about: r.about ?? null, kind: r.kind as Kind, originScope: r.origin_scope ?? null, journal: false }, folders, rule) !== "out";
  });
  if (mine.length === 0) return null;
  const max = OPEN_CLOSE_TUNABLES.MORNING_TITLE_CHARS;
  const clip = (t: string): string => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
  const named = mine.slice(0, OPEN_CLOSE_TUNABLES.MORNING_SHOWN).map((x) => {
    const r = store.row(x.id);
    return `${clip(flatten(r === undefined ? x.id : titleOfRow(r)))} — ${x.why} [${x.id}]`;
  });
  const more = mine.length - named.length;
  return `Closed by the night (${String(mine.length)}): ${named.join("; ")}${more > 0 ? `; +${String(more)} more` : ""}. One not done? The reflect tool's phase "reopen", reopen: [its id], puts it back.`;
}

/**
 * `Set down from my page last night: "Kiln logs wander: look, then fix the
 * note" (recall "set down")` (PG1, 2026-11-09): the set-downs of the newest
 * night (`counterpart-wake-news.ts#lastNightAt`, by its local date), told
 * until the next night runs, at most `SET_DOWN_SHOWN` by line, then "and N
 * more". The night runs at a day's first prompt, after that day's first wake,
 * so this reaches a later session that day and the next morning's first wake
 * — but told ONCE (review of #789): the first wake that tells a night's
 * set-downs records it (`SET_DOWN_TOLD_KEY`), and no later wake tells that
 * night's again. Only the quoted ones: named by the writer, or clearly gone; a
 * quiet one ("maybe reworded", the lines past a write's cap) is behind the
 * door only. A set-down whose line is on the page now (brought back) or in the
 * night's own words is not told (WK3). Null when there is none.
 */
function setDownWakeLine(cp: Counterpart, now: number, own: string | null): { line: string; ids: string[]; night: string } | null {
  const store = cp.store;
  const nightAt = lastNightAt(store, now);
  if (nightAt === null) return null;
  const night = localDate(nightAt, store.zone());
  if (store.getMeta(SET_DOWN_TOLD_KEY) === night) return null;
  const page = cp.self.page()?.body ?? null;
  const prepared = page === null ? null : preparePage(page);
  const ownPage = own === null ? null : preparePage(own);
  const rows = nightSetDowns(store, night).filter(
    (r) => r.quiet !== true && (prepared === null || !lineOnPage(r.line, prepared)) && (ownPage === null || !lineOnPage(r.line, ownPage)),
  );
  if (rows.length === 0) return null;
  const max = SHAPE.SET_DOWN_LINE_CHARS;
  const clip = (t: string): string => {
    const flat = flatten(t);
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
  };
  const named = rows.slice(0, SHAPE.SET_DOWN_SHOWN).map((r) => `"${clip(r.line)}"`);
  const more = rows.length - named.length;
  return {
    line: `Set down from my page last night: ${named.join("; ")}${more > 0 ? `, and ${String(more)} more` : ""} (recall "${SET_DOWN_HANDLE}")`,
    ids: rows.map((r) => r.id),
    night,
  };
}

/** "Last night", by title and door: the night's own words on what ran, no ids; and the night's own line, when it left one a reader here may read. */
function nightWords(cp: Counterpart, at: string, here: WakeHere | undefined, scope: string): { line: string; own: string | null; reflection: string | null } | null {
  const store = cp.store;
  const readable = (s: string | null): boolean => {
    if (s === null || s.trim().length === 0) return true;
    if (scope.length > 0 && norm(s) === scope) return true;
    try {
      return here?.exportsFrom?.(s) === true;
    } catch {
      return false;
    }
  };
  let reflectionId: string | null = null;
  const line = cp["nightLineFor"](at, {
    dream: (id: string) => {
      const d = store.dream(id);
      const title = d === undefined || !readable(d.scope) ? "" : (d.title ?? "").trim();
      return title.length === 0 ? "a dream" : `dream "${flatten(title)}"`;
    },
    reflection: (id: string) => {
      const r = store.reflection(id);
      if (r === undefined || !readable(r.scope)) return "a reflection";
      reflectionId = id;
      const entry = r.entry_id === null ? undefined : store.row(r.entry_id);
      const title = (entry?.title ?? "").trim().replace(/^Reflected:\s*/, "");
      return title.length === 0 ? "a reflection" : `reflection "${flatten(title)}"`;
    },
  });
  if (line === null) return null;
  const named = reflectionId === null ? undefined : store.reflection(reflectionId);
  let own: string | null = null;
  if (named !== undefined) {
    try {
      const l = (JSON.parse(named.detail ?? "{}") as { line?: unknown }).line;
      own = typeof l === "string" && l.trim().length > 0 ? flatten(l) : null;
    } catch {
      own = null;
    }
  }
  const hasNight = reflectionId !== null || /dream "| a dream| a reflection/.test(line);
  return { line: hasNight ? `${line} Whole: recall "last night".` : line, own, reflection: reflectionId };
}

/** `2026-11-07` or `11-07`; and `Nov 7`, `November 7th` (strings, so the root holds no number). */
const NUMERIC_DAY = new RegExp("\\b(?:\\d\\d\\d\\d-)?(\\d\\d?)-(\\d\\d?)\\b", "g");
const NAMED_DAY = new RegExp("\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+(\\d\\d?)(?:st|nd|rd|th)?\\b", "g");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The days a sentence names, as `MM-DD`: `2026-11-07`, `11-07`, `Nov 7`, `November 7th`. Pure. */
export function datesIn(text: string): Set<string> {
  const out = new Set<string>();
  const two = (n: number): string => (String(n).length === 1 ? `0${String(n)}` : String(n));
  for (const m of text.matchAll(NUMERIC_DAY)) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo >= 1 && mo <= MONTHS.length && d >= 1 && d <= SHAPE.MONTH_DAYS_MAX) out.add(`${two(mo)}-${two(d)}`);
  }
  for (const m of text.toLowerCase().matchAll(NAMED_DAY)) {
    const mo = MONTHS.indexOf(m[1] ?? "") + 1;
    const d = Number(m[2]);
    if (mo >= 1 && d >= 1 && d <= SHAPE.MONTH_DAYS_MAX) out.add(`${two(mo)}-${two(d)}`);
  }
  return out;
}

/**
 * THE SAME MOMENT, WHATEVER THE WORDS (review of #792: the owner's 11-09 closing
 * line paraphrased a moment the page told as a clause, and the near-verbatim
 * check passed it). A sentence and a page sentence naming the same day
 * (`datesIn`) and sharing at least `MOMENT_SHARED_WORDS` content words (dates
 * and numbers aside) tell one moment. The line has no memory of its own to
 * match by identity (a reflection's `detail.line` is text), so this is the
 * rule. Pure.
 */
export function sameMoment(sentence: string, page: PreparedPage): boolean {
  const days = datesIn(sentence);
  if (days.size === 0) return false;
  const words = [...contentWords(sentence)].filter((w) => !/\d/.test(w));
  for (const p of page.sentences) {
    if (![...datesIn(p.text)].some((d) => days.has(d))) continue;
    if (words.filter((w) => p.words.has(w)).length >= SHAPE.MOMENT_SHARED_WORDS) return true;
  }
  return false;
}

/** Where a line breaks into clauses, as set-down's clause rule reads them. */
const CLAUSE_BREAK = /\s*(?:[;:(]|—|\s-\s)\s*/u;

/**
 * ONE TELLING OF A MOMENT PER WAKE (WK3, 2026-11-09; a counterpart's feedback:
 * a slip on the page came back as the wake's last line, on its own, two
 * mornings running, and read as penance, not memory). The night's own line is
 * the wake's closing line, so it carries something forward, never a sentence
 * the wake already told: each of its sentences on the page or in day's end's
 * words (word for word, or reworded past `SET_DOWN_LIMITS.NEAR_SHARE`:
 * `self/set-down.ts#lineOnPage`) is dropped, and with none left there is no
 * line (the night's titles and its door stand alone; the reflection's row has
 * no other line to fall back to). The same moment two mornings running — a
 * sentence of the line before this one's on the same footing — is at most
 * its first clause the second morning, or nothing when it has only one.
 * A read: what was told is not recorded (PG1's set-down latch is its own).
 */
function ownToldOnce(cp: Counterpart, night: { readonly own: string | null; readonly reflection: string | null }, told: readonly string[]): string | null {
  const own = night.own;
  if (own === null) return null;
  const already = told.filter((t) => t.trim().length > 0).map((t) => preparePage(t));
  const sentences = preparePage(own).sentences.map((x) => x.text);
  // One sentence of the line telling a told moment is the line telling it (review 2 of
  // #792): its undated rest is the same moment, and alone it would be a fragment.
  const kept = sentences.length === 0 ? [own] : sentences;
  if (kept.some((x) => already.some((p) => lineOnPage(x, p) || sameMoment(x, p)))) return null;
  const line = kept.join(" ");
  const before = previousOwn(cp, night.reflection);
  if (before === null) return line;
  const prior = preparePage(before);
  if (!kept.some((x) => lineOnPage(x, prior))) return line;
  const first = (kept[0] ?? "").trim();
  const clause = first.split(CLAUSE_BREAK)[0]?.trim() ?? "";
  if (clause.length === 0 || clause === first) return null;
  return `${clause.replace(/[,.;:!?]+$/u, "")}…`;
}

/** The own line of the reflection before `id` (the newest reflected one dated before it), or null. Reads only. */
function previousOwn(cp: Counterpart, id: string | null): string | null {
  if (id === null) return null;
  const store = cp.store;
  const self = store.reflection(id);
  if (self === undefined) return null;
  for (const r of store.reflections({ limit: SHAPE.NEWS_NIGHTS_READ })) {
    if (r.id === id || r.state !== "reflected" || r.date === null || self.date === null || r.date >= self.date) continue;
    try {
      const l = (JSON.parse(store.reflection(r.id)?.detail ?? "{}") as { line?: unknown }).line;
      return typeof l === "string" && l.trim().length > 0 ? flatten(l) : null;
    } catch {
      return null;
    }
  }
  return null;
}
