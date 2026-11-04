/**
 * THE WAKE KNOWS YESTERDAY'S NEWS (WF1, 2026-11-03; Mike's go 14:41, ROADMAP's
 * brief; lightly held). Two reads the shaped wake (`counterpart-wake-shape.ts`)
 * and the plain reminder share, deterministic, no model:
 *
 * 1. SINCE THE LAST NIGHT: the strongest memories marked about the owner or
 *    about us written since the last night that folded news into the page, from
 *    any folder this reader may see. The page is written at night and the
 *    night runs at a day's first prompt, after that day's first wake, so a wake
 *    reads a page that is always at least a session old. What was said since
 *    (Dana's launch, d5s1; the surgery news, d2s1, read from the shop folder in
 *    d2s2) had no road into the next wake. Owner and us memories cross folders;
 *    work stays home (Elsewhere names it).
 *
 * 2. WHAT ALREADY HAPPENED: a dated item a newer memory says is done (the shop
 *    that launched a day early) is no longer due, coming up or told as a plain
 *    reminder.
 *
 * A part of the root like `counterpart-wake-shape.ts`: it reads the root's
 * private reads by `cp["…"]`, and every number is named in
 * `self/tunables.ts#WAKE_SHAPE_LIMITS`. Reads only; never throws to its caller
 * (each read has its fallback).
 */
import type { Counterpart } from "./counterpart.js";
import type { WakeHere } from "./counterpart-types.js";
import { isNightRow, memoryClosedTo, memoryFolder } from "./dream/slices.js";
import { WAKE_SHAPE_LIMITS as SHAPE } from "./self/tunables.js";
import { stemTerm } from "./store/stem.js";
import type { MemoryRow, Store } from "./store/index.js";
import { recurrenceOfRow } from "./store/shapes.js";
import { addDays, isDay, localDate, stampDay, startOfLocalDay } from "./time.js";
import { isTold } from "./told.js";

/** One line of "Since the last night". */
export interface NewsItem {
  readonly id: string;
  readonly title: string;
  /** When it was written, epoch ms. */
  readonly at: number;
  /** What it was ranked by: the larger of its salience at birth and its strongest feeling. */
  readonly strength: number;
}

/**
 * WHEN THE LAST NIGHT THAT FOLDED NEWS IN BEGAN: the newest journaled dream or
 * reflected reflection started before `before`. A night that only caught up
 * wrote no page, so it is not one. Null when none has.
 */
export function lastNightAt(store: Pick<Store, "dreams" | "reflections">, before: number): number | null {
  let at: number | null = null;
  for (const d of store.dreams({ limit: SHAPE.NEWS_NIGHTS_READ })) {
    if (d.state === "journaled" && d.undone_at === null && d.started_at < before) at = Math.max(at ?? d.started_at, d.started_at);
  }
  for (const r of store.reflections({ limit: SHAPE.NEWS_NIGHTS_READ })) {
    if (r.state === "reflected" && r.started_at < before) at = Math.max(at ?? r.started_at, r.started_at);
  }
  return at;
}

/**
 * WHERE "SINCE THE LAST NIGHT" STARTS for a wake on `at`: when the last night
 * began, or the start of today when it ran today. A night starts at a day's
 * first prompt and runs beside the session it opens, so what that session says
 * comes after it (the harness drains the night after the first turn instead,
 * where the d2s1 surgery news landed three minutes before it). Today's news is
 * never in the page. No night yet: the start of yesterday. Never further back
 * than `NEWS_MAX_DAYS`.
 */
export function newsSince(store: Pick<Store, "dreams" | "reflections" | "zone">, at: string, now: number): { since: number; night: boolean } {
  const zone = store.zone();
  const today = startOfLocalDay(at, zone);
  const night = lastNightAt(store, now);
  const anchor = night === null ? startOfLocalDay(addDays(at, -1), zone) : Math.min(night, today);
  return { since: Math.max(anchor, startOfLocalDay(addDays(at, -SHAPE.NEWS_MAX_DAYS), zone)), night: night !== null };
}

/** The larger of a row's salience at birth and its strongest feeling, 0..1. */
function strengthOf(store: Pick<Store, "feelingsFor">, row: MemoryRow): number {
  let felt = 0;
  try {
    for (const f of store.feelingsFor(row.id)) felt = Math.max(felt, f.strength);
  } catch {
    felt = 0;
  }
  return Math.max(row.birth_salience ?? 0, row.emotional ?? 0, felt);
}

/** A word, for these reads: letters only, `WORD_MIN` or more. */
const WORD = new RegExp(`[a-z]{${String(SHAPE.WORD_MIN)},}`, "g");
/** A row's words as stems, three letters or more, no digits. */
function stems(text: string): Set<string> {
  return new Set((text.toLowerCase().match(WORD) ?? []).filter((w) => !NOT_WORDS.has(w)).map(stemTerm));
}
/** Words that say when, or nothing: never what an item is about. */
const NOT_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "was", "were", "has", "had", "have", "will", "about", "after", "before", "into", "our", "her", "his", "their", "they", "she", "you", "your", "not", "nobody", "day",
  "today", "tomorrow", "yesterday", "week", "next", "last",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "wed", "thu", "fri", "sat", "sun",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
]);

/** What a row's line is called: its title, or its body's first line. */
function nameOf(row: Pick<MemoryRow, "title" | "body">): string {
  const t = (row.title ?? "").trim();
  return t.length > 0 ? t : (row.body.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
}

/**
 * "SINCE THE LAST NIGHT" for a wake on `at` read in `here`: up to
 * `NEWS_SHOWN` live memories marked about the owner or us, written after
 * `newsSince`, at least `NEWS_FLOOR` strong, strongest first (newer first on a
 * tie). Each row by the fence's own rule (`memoryClosedTo`): this folder's and
 * its project's own; another's only when that folder is on (`exportsFrom`; a
 * folder off, paused or observing keeps its rows home), and with no way to ask,
 * none. Never this session's own, a dated item ("Coming up" says it), a starter
 * memory, an open thread ("Still open" says it), the night's own rows or a
 * chapter's copy, a removed one, or one whose
 * stated day is before the window (an older fact noted again, as "Since, here"
 * reads it). Nor one in `skip`, nor one whose title is mostly a stronger one's.
 */
export function sinceLastNight(
  cp: Counterpart,
  at: string,
  here: WakeHere | undefined,
  opts: { readonly ours?: ReadonlySet<string>; readonly skip?: ReadonlySet<string> } = {},
): { items: NewsItem[]; since: number; night: boolean } {
  const store = cp.store;
  const now: number = cp["nowFn"]();
  const { since, night } = newsSince(store, at, now);
  const zone = store.zone();
  const sinceDay = startOfLocalDay(localDate(since, zone), zone);
  const norm = (s: string): string => s.trim().replace(/\/+$/, "");
  const scope = norm(here?.scope ?? "");
  const ours = opts.ours ?? new Set(scope.length === 0 ? [] : [scope]);
  const reader = here?.session ?? null;
  const rows = store.aboutUsWrittenSince(since, now, SHAPE.NEWS_READ);
  if (rows.length === 0) return { items: [], since, night };
  const denied = new Set(store.deniedIds());
  const out: NewsItem[] = [];
  for (const r of rows) {
    if (denied.has(r.id) || opts.skip?.has(r.id) === true || r.band === "identity" || isTold(r) || isNightRow(r)) continue;
    if (r.source === "episode" || (r.origin_ref ?? "").startsWith("epi_") || (r.meta ?? "").includes('"episodeId"')) continue;
    if (reader !== null && r.origin_session === reader) continue;
    // A dated item is "what's due?", an open thread "what's owed?": each has its own section.
    if ((typeof r.event_date === "string" && r.event_date.trim().length > 0) || (r.meta ?? "").includes('"unresolved":true')) continue;
    const stated = [r.occurred_on, r.happened_on, r.learned_on].filter((d): d is string => typeof d === "string" && isDay(stampDay(d)));
    if (stated.some((d) => startOfLocalDay(stampDay(d), zone) < sinceDay)) continue;
    const folder = memoryFolder(store, r);
    const home = folder !== null && ours.has(norm(folder));
    if (!home) {
      const on = here?.exportsFrom;
      if (on === undefined || folder === null || memoryClosedTo(store, r, on, scope.length === 0 ? undefined : scope)) continue;
    }
    const strength = strengthOf(store, r);
    if (strength < SHAPE.NEWS_FLOOR) continue;
    const title = nameOf(r).replace(/\s+/g, " ");
    if (title.length === 0) continue;
    out.push({ id: r.id, title, at: r.created_at ?? 0, strength });
  }
  out.sort((a, b) => b.strength - a.strength || b.at - a.at || (a.id < b.id ? -1 : 1));
  const kept: NewsItem[] = [];
  for (const n of out) {
    if (kept.length >= SHAPE.NEWS_SHOWN) break;
    const mine = stems(n.title);
    const echo = kept.some((k) => {
      const theirs = stems(k.title);
      return mine.size > 0 && [...mine].filter((w) => theirs.has(w)).length / mine.size >= SHAPE.NEWS_ECHO;
    });
    if (!echo) kept.push(n);
  }
  return { items: kept, since, night };
}

/** An item's head: its title before the first `:` or ` — `, when it has one. */
function headOf(title: string): string | null {
  const m = /^(.+?)(?::\s| — | - )/.exec(title);
  return m === null ? null : (m[1] ?? null);
}

/**
 * HAS THIS DATED ITEM ALREADY HAPPENED? A newer live memory marked done, not the
 * night's own and not a starter memory, that names the same thing says so:
 * "Shop launched: 11 pieces sold" after "Shop launch day: Saturday 7 Mar". By
 * words (stems; never a word that says when): at least `HAPPENED_SHARED` of the
 * item's, and every word of its head when its title has one ("Shop launch
 * day: …"), else at least `HAPPENED_SHARE` of them; so "Drafted the launch
 * post" settles no launch day. Its id, or null. A recurring item comes round
 * again, so it never has. A read of the done rows written since the item,
 * bounded by `HAPPENED_READ`. `open`, when given, is the reader's fence: a row
 * it may not read settles nothing. Never throws.
 *
 * WORDS ALONE SETTLE TOO MUCH (review of #734): "Dentist appointment: cleaning"
 * six days out was settled by "Dentist appointment for the kids went fine", and
 * today's vet check-up by last week's stitches-out visit. A lost reminder is
 * worse than a stale one, so the date fences it too: only an item whose day is
 * the wake's (`at`) or before can have happened, and only by a done row written,
 * and saying it happened, no earlier than `HAPPENED_EARLY_DAYS` before that day
 * (the shop launched one day early). An item with no single day never settles.
 */
export function happenedAlready(store: Store, id: string, at: string, opts: { readonly open?: (row: MemoryRow) => boolean } = {}): string | null {
  try {
    const item = store.row(id);
    if (item === undefined || item.created_at === null || item.created_at === undefined || recurrenceOfRow(item) !== null) return null;
    const due = typeof item.event_date === "string" ? stampDay(item.event_date.trim()) : "";
    if (!isDay(due) || !isDay(at) || due > at) return null;
    const earliest = addDays(due, -SHAPE.HAPPENED_EARLY_DAYS);
    const zone = store.zone();
    const name = nameOf(item);
    const want = stems(name);
    if (want.size < SHAPE.HAPPENED_SHARED) return null;
    const head = headOf(name);
    const headWords = head === null ? null : stems(head);
    for (const r of store.doneWrittenSince(item.created_at, SHAPE.HAPPENED_READ)) {
      if (r.id === id || isTold(r) || isNightRow(r) || r.band === "identity") continue;
      if (opts.open !== undefined && !opts.open(r)) continue;
      // Written, and saying it happened, near the item's day: not an earlier visit of the same name.
      if (localDate(r.created_at ?? 0, zone) < earliest) continue;
      if ([r.occurred_on, r.happened_on].some((d) => typeof d === "string" && isDay(stampDay(d)) && stampDay(d) < earliest)) continue;
      const have = stems(nameOf(r));
      const shared = [...want].filter((w) => have.has(w)).length;
      if (shared < SHAPE.HAPPENED_SHARED) continue;
      const names = headWords !== null && headWords.size > 0 ? [...headWords].every((w) => have.has(w)) : shared / want.size >= SHAPE.HAPPENED_SHARE;
      if (names) return r.id;
    }
    return null;
  } catch {
    return null;
  }
}
