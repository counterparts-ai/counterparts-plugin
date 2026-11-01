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
import { craftSince, isWorkMemory, projectFolder, threadPlace } from "./self/work.js";
import { addDays, ageWords, daysBetween, isDay, localDate, localStamp, monthDay, stampDay, startOfLocalDay } from "./time.js";
import { settlesWhenOf } from "./types.js";
import type { Kind } from "./types.js";
import type { MemoryRow } from "./store/index.js";

/** The meta key that sets the shape for one store (`counterparts wake-shape on|off`): `on`, `off`, or absent for `self.WAKE_SHAPE`. */
export const WAKE_SHAPE_KEY = "self.wake_shape";

/** The door a section's rest goes behind. Each is a `recall` handle that lists what it counts. */
export const COMING_UP_HANDLE = "coming up";
export const HANDOFFS_HANDLE = "handoffs";
/** What an item with no date sorts as: after every date. */
export const UNDATED_LAST = "undated";
/** Where Elsewhere's rest goes (the spec's floor: no count without a door): these folders, as the section reads them (`readElsewhere`). */
export const ELSEWHERE_HANDLE = "elsewhere";

type SectionKey = "folder" | "elsewhere" | "coming" | "open" | "yesterday" | "night";
const ORDER: readonly SectionKey[] = ["folder", "elsewhere", "coming", "open", "yesterday", "night"];
/** What gives way first when the wake is over: older things to read, then the rest; the folder's own last. */
const GIVE: readonly SectionKey[] = ["elsewhere", "open", "coming", "yesterday", "night", "folder"];
/** Where spare room goes, in draft 5's order. */
const SPARE: readonly SectionKey[] = ["folder", "open", "elsewhere", "coming"];
/** The section names the host's row carries (`sec_…`), `counterpart-boundary.ts#wakeShape`'s. */
const SECTION_NAME: Readonly<Record<SectionKey, string>> = { folder: "stands", elsewhere: "elsewhere", coming: "horizon", open: "threads", yesterday: "yesterday", night: "night" };

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
}

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
    const place = threadPlace({ about: row.about ?? null, kind: row.kind as Kind, originScope: row.origin_scope ?? null, journal: false }, folders, rule);
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
    if (title.length === 0 || r.source === "episode" || (r.origin_ref ?? "").startsWith("epi_") || isNightRow(r) || (r.meta ?? "").includes('"episodeId"')) continue;
    if (!r.status && !isWorkMemory({ about: r.about ?? null, kind: r.kind as Kind, originScope: r.origin_scope ?? null, journal: false })) continue;
    // A closing batch from the handoff's own session echoes its lead.
    const at = r.created_at ?? 0;
    if (opts.handoffSession !== null && r.origin_session === opts.handoffSession && opts.handoffAt !== null && at - opts.handoffAt <= SHAPE.SINCE_OWN_SESSION_MS) continue;
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
    memories: store.countMemories({ type: "memory", archived: false }),
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
  const hs: readonly Handoff[] = scope.length === 0 ? [] : safe(() => cp.handoffs.readAll(scope), []);
  const newest = hs[0];
  const newestAt = newest === undefined ? null : safe(() => cp.handoffs.writtenAt(newest), null);
  const chaptersHere: readonly ChapterHere[] = scope.length === 0 ? [] : safe(() => cp.chaptersHereFor(scope, null, cp["chaptersInWindow"](day)).map((f) => f.chapter), []);
  const since = newest === undefined ? sinceY : (newestAt ?? startOfLocalDay(newest.writtenOn, zone));
  const lead5 = newest === undefined ? "" : leadOf(newest.body, SHAPE.LEAD_LINES, SHAPE.LEAD_BYTES).lines.join(" ");
  // A joined folder is here (`PROJECTS_TRAVEL`): its work is "Since, here", its sessions "Open here now".
  const hereFolders: readonly string[] = gate === null ? [scope] : [...gate.ours];
  const cues = safe(() => readCues(cp, at, here), [] as Cue[]);
  const cueIds = new Set(cues.map((c) => c.id));
  const later = scope.length === 0 ? null : safe(() => sinceHere(cp, scope, since, { handoffSession: newest?.session ?? null, handoffAt: newestAt, reader, lead: lead5, chapters: chaptersHere, skip: cueIds, folders: hereFolders }), null);
  const sinceAged = (later?.items ?? []).map((s) => ({ ...s, age: ageOf(s.chapter ? s.at : Math.min(s.at, factAt(s.id))) }));
  const open = safe(() => cp.self.stillOpen(day, cp["threadReader"](here?.scope, here?.exportsFrom)), { items: [], parked: 0 });
  const folders = readerFolders(cp, here);
  const rule = { craftTravels: cp.self.tunables.PROJECTS_TRAVEL, craftSince: craftSince(store) };
  const openRows = open.items
    .filter((i) => i.parked !== true)
    .map((i) => {
      const r = store.row(i.id);
      const place = r === undefined ? "personal" : threadPlace({ about: r.about ?? null, kind: r.kind as Kind, originScope: r.origin_scope ?? null, journal: false }, folders, rule);
      return { i, r, here: place === "here", at: Math.min(factAt(i.id), r?.created_at ?? Infinity) };
    })
    .sort((a, b) => Number(b.here) - Number(a.here) || b.at - a.at || (a.i.id < b.i.id ? -1 : 1));
  const summary = cp.self.tunables.YESTERDAY_FROM_SUMMARY ? safe(() => cp["daySummaryShown"](yest, here), null) : null;
  const yestHere = scope.length === 0 ? [] : safe(() => chaptersOn(store, yest, { fromDay: Math.max(0, day - LAST_HERE_LIFE_DAYS) }).filter((c) => norm(c.scope ?? "") === scope), []);
  const elsewhere = safe(() => elsewhereFacts(cp, gate, sessions, sinceY, now, reader, factAt), { list: [] as ElsewhereRow[], quiet: [] as string[] });
  const said = scope.length === 0 ? null : safe(() => saidHere(cp, scope, here, sessions, headless, chaptersHere, newest ?? null, reader, zone, now), null);
  const liveHere = sessions.filter((s) => s.live && s.session !== reader && hereFolders.includes(norm(s.scope)));
  const night = safe(() => nightWords(cp, at, here, scope), null);
  const installed = here?.installed ?? null;

  // ── the page: first claim on the room ──
  const self = cp.self.shapedSelf(room, {
    at,
    day,
    keptOut: (id) => cp["hintKeptOut"](id, here ?? {}),
    // What Elsewhere names is Elsewhere's, not a hint's: so its door can count what it counts (`readElsewhere`).
    skip: new Set([...cueIds, ...elsewhere.list.flatMap((e) => (e.id === null ? [] : [e.id]))]),
  });

  // ── the sections ──
  const spareOn = new Set<SectionKey>();
  const blockOf = (lines: readonly string[]): string => (lines.length === 0 ? "" : `${lines.join("\n")}\n\n`);

  const folderSec = (b: number, claim: ReadonlySet<string>): Sec => {
    if (scope.length === 0) return { text: "", ids: [], items: 0 };
    const leadLines = spareOn.has("folder") ? SHAPE.LEAD_LINES_SPARE : SHAPE.LEAD_LINES;
    const leadBytes = spareOn.has("folder") ? SHAPE.LEAD_BYTES_SPARE : SHAPE.LEAD_BYTES;
    const sinceLines = sinceAged.filter((s) => !claim.has(s.id));
    const tail = here?.sessions === undefined ? null : openHereLine(liveHere, at, zone);
    const olderPick = pickOlder(hs);
    const build = (n: { lead: number; since: number; older: number; said: boolean }): { lines: string[]; leadBytes: number } => {
      const out = ["Where this folder stands:"];
      let leadSize = 0;
      if (newest === undefined) out.push("No handoff here. Leave one with session_end's handoff field when you stop.");
      else {
        const lead = leadOf(newest.body, n.lead, leadBytes);
        const seat = seatOf(newest.body) ?? `session ${shortSession(newest.session)}`;
        const when = `${monthDay(newest.writtenOn)}${newestAt === null ? "" : ` ${localStamp(newestAt, zone).split(" ")[1] ?? ""}`}`;
        const written = newest.build ?? (newest.session !== null ? safe(() => here?.openedWith?.(newest.session as string) ?? null, null) : null);
        const delta = written !== null && installed !== null && versionOlder(written, installed) ? `; ${written} then, ${installed} now` : "";
        const head = `Handoff, ${seat}, ${when} (${ageOf(newestAt ?? startOfLocalDay(newest.writtenOn, zone))} old${delta}${hs.length > 1 ? `; newest of ${String(hs.length)}` : ""}). ${lead.cut ? "whole: " : ""}recall ${newest.id}`;
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
        if (newest !== undefined) out.push("Nothing here since.");
        else {
          // No handoff and a quiet day: the last chapter here, so a folder a
          // session left a while ago still says what happened in it.
          const last = chaptersHere.find((c) => c.session !== reader && ((c.title ?? "").trim().length > 0 || c.excerpt.trim().length > 0));
          out.push(last === undefined ? "Nothing here since yesterday." : `Last here: chapter "${flatten((last.title ?? "").trim() || last.excerpt)}" (${ageOf(last.writtenAt)})`);
        }
      }
      const rest = hs.length - 1;
      if (rest > 0) {
        out.push(`Older handoffs: ${String(rest)}; recall "${HANDOFFS_HANDLE}"`);
        for (const o of olderPick.slice(0, n.older)) out.push(`- ${o.seat}: ${firstRealSentence(o.h.body)} (${monthDay(o.h.writtenOn)}; ${o.h.id})`);
      }
      if (tail !== null) out.push(tail);
      if (n.said && said !== null) out.push(said.line);
      return { lines: out, leadBytes: leadSize };
    };
    const most = newest === undefined ? 1 : Math.max(1, leadOf(newest.body, leadLines, leadBytes).lines.length);
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
      const shown = list.slice(0, k).map((e) => (e.title === null ? { text: `- ${e.place} (live)`, age: "" } : { text: `- ${e.place}${e.live ? " (live)" : ""}: ${e.title}`, age: ageOf(e.fact) }));
      for (let i = 0; i < shown.length; i++) {
        const s = shown[i] as { text: string; age: string };
        out.push(s.age === "" || (i > 0 && shown[i - 1]?.age === s.age) ? s.text : `${s.text} (${s.age})`);
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
    const todayAll = live.filter((c) => c.today);
    const ranked = [...todayAll].sort(dueOrder);
    const plain = ranked.filter((c) => c.plain);
    const rest = ranked.filter((c) => !c.plain);
    const overdue = live.filter((c) => c.past && c.mine).sort((x, y) => String(y.due).localeCompare(String(x.due)));
    const laterAll = live.filter((c) => !c.today && !c.past && c.mine).sort((x, y) => String(x.due ?? UNDATED_LAST).localeCompare(String(y.due ?? UNDATED_LAST)));
    const other = live.filter((c) => !c.today && !c.mine);
    const laterCap = spareOn.has("coming") ? SHAPE.LATER_SHOWN_SPARE : SHAPE.LATER_SHOWN;
    const dueLine = (c: Cue): string => `- Due today · ${c.plain ? c.body : c.title}${c.settles === null ? "" : ` · settles when ${flatten(c.settles)}`} [${c.id}]`;
    const overdueLine = (c: Cue): string => `- ${c.due === null ? "Overdue" : `${plural(Math.max(1, daysBetween(c.due, at)), "day")} overdue`} · ${c.title} [${c.id}]`;
    const laterLine = (c: Cue): string => `- ${c.due === null ? "Soon" : monthDay(c.due)}${c.every === null ? "" : ` (${c.every})`} · ${c.title} [${c.id}]`;
    const order: { c: Cue; line: string }[] = [
      ...plain.map((c) => ({ c, line: dueLine(c) })),
      ...rest.slice(0, SHAPE.DUE_TODAY_SHOWN).map((c) => ({ c, line: dueLine(c) })),
      ...overdue.slice(0, SHAPE.OVERDUE_SHOWN).map((c) => ({ c, line: overdueLine(c) })),
      ...laterAll.slice(0, laterCap).map((c) => ({ c, line: laterLine(c) })),
    ];
    const render = (shown: readonly { c: Cue; line: string }[]): string[] => {
      const ids = new Set(shown.map((s) => s.c.id));
      const hiddenToday = todayAll.filter((c) => !ids.has(c.id)).length;
      const hereMore = [...overdue, ...laterAll].filter((c) => !ids.has(c.id)).length;
      const words = [hiddenToday > 0 ? `${String(hiddenToday)} more due today` : "", hereMore > 0 ? `${String(hereMore)} more here` : "", other.length > 0 ? `${String(other.length)} in other folders` : ""].filter((x) => x.length > 0).join(", ");
      const out = ["Coming up:", ...shown.map((s) => s.line)];
      if (words.length > 0) out.push(`(${words}; recall "${COMING_UP_HANDLE}")`);
      if (cues.length === 0) out.push("Nothing dated.");
      return out;
    };
    // Whole lines in order; a line that doesn't fit goes behind the door, and a
    // later one may still fit: a long plain reminder doesn't hide what's after it.
    const shown: { c: Cue; line: string }[] = [];
    for (const o of order) if (byteLength(blockOf(render([...shown, o]))) <= b) shown.push(o);
    const text = blockOf(render(shown));
    if (byteLength(text) > b) return { text: "", ids: [], items: 0 };
    return { text, ids: shown.map((s) => s.c.id), items: shown.length, lined: shown.map((s) => s.c.id) };
  };

  const openSec = (b: number, claim: ReadonlySet<string>): Sec => {
    const cap = spareOn.has("open") ? SHAPE.OPEN_SHOWN_SPARE : SHAPE.OPEN_SHOWN;
    const carried = openRows.filter((x) => !claim.has(x.i.id) && !cueIds.has(x.i.id));
    const lineOf = (x: (typeof carried)[number]): { text: string; age: string; tail: string } => ({
      text: `- ${x.r === undefined ? x.i.title : titleOfRow(x.r)}`,
      age: ageOf(x.at),
      tail: `${x.i.reconsidering === true ? " · a core memory being reconsidered" : ""}${x.i.settlesWhen === undefined ? "" : ` · settles when ${flatten(x.i.settlesWhen)}`} [${x.i.id}]`,
    });
    const render = (k: number): string[] => {
      const more = carried.length - k;
      const door = more > 0 || open.parked > 0 ? `(${[more > 0 ? `${String(more)} more open` : "", open.parked > 0 ? `${String(open.parked)} parked` : ""].filter((w) => w.length > 0).join(", ")}; recall "still open")` : "";
      return ["Still open:", ...aged(carried.slice(0, k).map(lineOf)), ...(door === "" ? [] : [door]), ...(carried.length === 0 && open.parked === 0 ? ["Nothing open."] : [])];
    };
    let k = Math.min(cap, carried.length);
    while (k > 0 && byteLength(blockOf(render(k))) > b) k -= 1;
    const text = blockOf(render(k));
    if (byteLength(text) > b) return { text: "", ids: [], items: 0 };
    const ids = carried.slice(0, k).map((x) => x.i.id);
    return { text, ids, items: k, lined: ids };
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

  const nightSec = (b: number): Sec => {
    if (night === null) return { text: "", ids: [], items: 0 };
    const withLine = night.own === null ? null : blockOf([night.line, night.own]);
    if (withLine !== null && byteLength(withLine) <= b) return { text: withLine, ids: [], items: 0 };
    const alone = blockOf([night.line]);
    return byteLength(alone) <= b ? { text: alone, ids: [], items: 0 } : { text: "", ids: [], items: 0 };
  };

  const fn: Readonly<Record<SectionKey, (b: number, claim: ReadonlySet<string>) => Sec>> = {
    folder: folderSec,
    elsewhere: elsewhereSec,
    coming: comingSec,
    open: openSec,
    yesterday: yesterdaySec,
    night: (b) => nightSec(b),
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

  const plainBytes = cues.filter((c) => c.plain).reduce((n, c) => n + byteLength(`- Due today · ${c.body}${c.settles === null ? "" : ` · settles when ${flatten(c.settles)}`} [${c.id}]\n`), byteLength("Coming up:\n\n"));
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
      const floor = pass === 0 && key === "coming" ? Math.min(plainBytes + SHAPE.COMING_PAST_PLAIN, byteLength(sec[key].text)) : 0;
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
    threads: sec.open.ids,
    sec,
    live: hs.length,
    since: later?.items.length ?? 0,
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
  if (w.sec.folder.saidBytes !== undefined) cp["emit"](w.sec.folder.saidBytes > 0 ? "counterpart.lastexchange.shown" : "counterpart.lastexchange.noroom", undefined, { bytes: w.sec.folder.saidBytes });
  if ((w.sec.folder.chapters ?? 0) > 0) cp["emit"]("counterpart.lasthere.shown", undefined, { bytes: 0, lines: w.sec.folder.chapters ?? 0 });
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

/** Who else is at work here now, with when they started; or that nobody is. Asked only of a host with a registry: one with none can't say. */
function openHereLine(live: readonly WakeSession[], today: string, zone: string): string {
  if (live.length === 0) return "Open here now: no other session.";
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
  const live = new Set<string>();
  for (const s of sessions) if (s.live && s.session !== reader && gate.named(s.scope)) live.add(gate.norm(s.scope));
  const list: ElsewhereRow[] = [...best.entries()].map(([key, m]) => ({ place: placeWords(key), id: m.id, title: m.title, fact: m.fact, at: m.at, live: live.has(key) }));
  for (const key of live) if (!best.has(key)) list.push({ place: placeWords(key), id: null, title: null, fact: now, at: 0, live: true });
  list.sort((a, b) => Number(b.live) - Number(a.live) || b.at - a.at || (a.place < b.place ? -1 : 1));
  // Folders worked in with no title to say: counted past the list, and named at its door.
  const named = new Set(list.map((l) => l.place));
  const quiet = new Set<string>();
  for (const { scope } of store.memoryCountsByScopeSince(sinceY)) {
    const place = placeWords(gate.norm(scope));
    if (gate.named(scope) && !named.has(place)) quiet.add(place);
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

/** "Last night", by title and door: the night's own words on what ran, no ids; and the night's own line, when it left one a reader here may read. */
function nightWords(cp: Counterpart, at: string, here: WakeHere | undefined, scope: string): { line: string; own: string | null } | null {
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
  return { line: hasNight ? `${line} Whole: recall "last night".` : line, own };
}
