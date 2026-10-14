import { CORE_ABOUT_MARKS } from "../store/index.js";
import { localDate, localStamp, readableDate } from "../time.js";
import { isKnownSession, isModelId } from "../types.js";
import { HANDOFF_EXCERPT_BYTES, HANDOFF_LIFE_DAYS, excerpt, flatten, sessionWords } from "./index.js";
export const LAST_HERE_LIFE_DAYS = HANDOFF_LIFE_DAYS;
export const LAST_HERE_SHOWN = 2;
export const LAST_HERE_LISTED = 3;
export const LAST_HERE_TITLE_BYTES = 100;
export const LAST_HERE_NOROOM_EVENT = "handoff.lasthere.noroom";
const HEADING = /^## chapter \d+ — (?:[^\n]* · )?lived day \d+[ \t]*$/gm;
export function chaptersBySession(store, opts = {}) {
  const out = new Map;
  let ids;
  let denied;
  try {
    ids = store.list({
      type: "episode",
      archived: false,
      ...opts.fromDay === undefined ? {} : { bornFromDay: opts.fromDay }
    });
    denied = ids.length === 0 ? new Set : new Set(store.deniedIds());
  } catch {
    return out;
  }
  let copies;
  try {
    copies = store.copiesOf(ids);
  } catch {
    copies = null;
  }
  for (const id of ids) {
    if (denied.has(id))
      continue;
    try {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null || row.body.length === 0)
        continue;
      let session = row.origin_session;
      if (session === null || session.length === 0) {
        const meta = JSON.parse(row.meta || "{}");
        session = typeof meta["sessionId"] === "string" ? meta["sessionId"] : null;
      }
      if (!isKnownSession(session))
        continue;
      const createdAt = row.created_at ?? 0;
      const writtenAt = row.updated_at ?? createdAt;
      const held = out.get(session);
      if (held !== undefined && held.writtenAt >= writtenAt)
        continue;
      const { day } = latestChapter(row.body);
      const first = firstChapter(row.body);
      out.set(session, {
        id,
        session,
        model: isModelId(row.model) ? row.model : null,
        title: row.title === null || row.title.trim().length === 0 ? null : row.title,
        excerpt: excerpt(first.text),
        chapters: first.count,
        writtenAt,
        createdAt,
        writtenDay: day ?? (Number.isFinite(row.birth_day) ? row.birth_day : null),
        scope: row.origin_scope === null || row.origin_scope.length === 0 ? null : row.origin_scope,
        confidential: row.confidential === 1 || copies === null || (copies.get(id) ?? []).some((c) => c.confidential),
        aboutMe: (copies?.get(id) ?? []).some((c) => c.about !== null && CORE_ABOUT_MARKS.includes(c.about))
      });
    } catch {
      continue;
    }
  }
  return out;
}
export function latestChapter(body) {
  let last = null;
  for (const m of body.matchAll(HEADING))
    last = m;
  if (last === null)
    return { text: body, day: null };
  const day = /lived day (\d+)/.exec(last[0])?.[1];
  return { text: body.slice((last.index ?? 0) + last[0].length), day: day === undefined ? null : Number(day) };
}
export function firstChapter(body) {
  const heads = [...body.matchAll(HEADING)];
  const first = heads[0];
  if (first === undefined)
    return { text: body, count: 1 };
  const start = (first.index ?? 0) + first[0].length;
  const next = heads[1];
  return { text: body.slice(start, next === undefined ? undefined : next.index), count: heads.length };
}
export function stampWords(stamp) {
  const m = /^(\d{2})-(\d{2})(?=$| )/.exec(stamp);
  const mo = m === null ? undefined : SHORT_MONTHS[Number(m[1]) - 1];
  return m === null || mo === undefined ? stamp : `${mo} ${String(Number(m[2]))}${stamp.slice(5)}`;
}
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function chaptersOf(body) {
  const heads = [...body.matchAll(HEADING)];
  if (heads.length === 0)
    return [{ text: body, date: null, heading: null }];
  return heads.map((h, i) => {
    const start = (h.index ?? 0) + h[0].length;
    const next = heads[i + 1];
    const m = /(\d{1,2}) ([A-Za-z]{3}) (\d{4})/.exec(h[0]);
    const month = m === null ? -1 : MONTHS.indexOf((m[2] ?? "").toLowerCase());
    const date = m === null || month < 0 ? null : `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return { text: body.slice(start, next === undefined ? undefined : next.index), date, heading: h[0].trim() };
  });
}
export function chapterFor(body, window) {
  const all = chaptersOf(body);
  let index = 0;
  if (window !== null) {
    const from = window.from.slice(0, 10);
    const to = window.to.slice(0, 10);
    const hit = all.findIndex((c) => c.date !== null && c.date >= from && c.date <= to);
    if (hit >= 0)
      index = hit;
  }
  return { text: all[index]?.text ?? body, index, count: all.length };
}
const norm = (s) => s.trim().replace(/\/+$/, "");
export function chaptersHere(chapters, here, day, opts = {}) {
  const lifeDays = opts.lifeDays ?? LAST_HERE_LIFE_DAYS;
  const out = [];
  for (const chapter of chapters.values()) {
    if (opts.reader !== undefined && opts.reader !== null && chapter.session === opts.reader)
      continue;
    if (chapter.writtenDay !== null && day - chapter.writtenDay >= lifeDays)
      continue;
    const s = here.sessions.get(chapter.session);
    const isHere = chapter.scope !== null ? norm(chapter.scope) === norm(here.scope) : here.claimed.has(chapter.id) || s !== undefined;
    if (!isHere)
      continue;
    out.push({
      chapter,
      firstAt: Math.min(s?.firstAt ?? chapter.createdAt, chapter.createdAt || 1 / 0),
      lastAt: Math.max(s?.lastAt ?? 0, chapter.writtenAt)
    });
  }
  return out.sort((a, b) => b.chapter.writtenAt - a.chapter.writtenAt || (a.chapter.id < b.chapter.id ? 1 : -1));
}
function named(c) {
  return c.title === null ? `— ${c.id}` : `— "${excerpt(c.title, LAST_HERE_TITLE_BYTES)}" (${c.id})`;
}
export function lastHereBlock(entries, opts = {}) {
  const first = entries[0];
  if (first === undefined)
    return null;
  const reader = opts.reader ?? null;
  const sameDay = entries.filter((e) => e.date === first.date);
  const shown = Math.max(1, Math.min(opts.shown ?? LAST_HERE_SHOWN, sameDay.length));
  const who = (e) => sessionWords(e.chapter.session, e.chapter.model, reader);
  const lines = [
    `Last here: ${who(first)}, ${first.when} ${named(first.chapter)}.${first.chapter.excerpt.length > 0 ? ` ${excerpt(first.chapter.excerpt, HANDOFF_EXCERPT_BYTES)}` : ""}`
  ];
  for (const e of sameDay.slice(1, shown))
    lines.push(`Before it: ${who(e)}, ${e.when} ${named(e.chapter)}.`);
  const rest = sameDay.slice(shown);
  if (opts.more !== false && rest.length > 0) {
    const ids = rest.slice(0, LAST_HERE_LISTED).map((e) => e.chapter.id);
    const unnamed = rest.length - ids.length;
    lines.push(`+${rest.length} more here on ${first.date}: ${ids.join(", ")}${unnamed > 0 ? `, and ${unnamed} more` : ""}.`);
  }
  return lines.map(flatten).join(`
`);
}
export const YESTERDAY_SHOWN = 4;
export const YESTERDAY_TITLE_BYTES = 60;
const DATED_HEADING = /^## chapter \d+ — (?:([A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{4}) · )?(?:[^\n]* · )?lived day \d+[ \t]*$/gm;
export function chaptersOn(store, date, opts = {}) {
  const out = [];
  const said = readableDate(date);
  if (said.length === 0)
    return out;
  let ids;
  let denied;
  try {
    ids = store.list({ type: "episode", archived: false, ...opts.fromDay === undefined ? {} : { bornFromDay: opts.fromDay } });
    denied = ids.length === 0 ? new Set : new Set(store.deniedIds());
  } catch {
    return out;
  }
  const zone = store.zone();
  let copies;
  try {
    copies = store.copiesOf(ids);
  } catch {
    copies = null;
  }
  for (const id of ids) {
    if (denied.has(id))
      continue;
    try {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null || row.body.length === 0)
        continue;
      if (row.confidential === 1 || copies === null || (copies.get(id) ?? []).some((c) => c.confidential))
        continue;
      let dated = 0;
      let that = 0;
      for (const m of row.body.matchAll(DATED_HEADING)) {
        if (m[1] === undefined)
          continue;
        dated += 1;
        if (m[1] === said)
          that += 1;
      }
      if (dated === 0 && localDate(row.created_at ?? 0, zone) === date)
        that = 1;
      if (that === 0)
        continue;
      out.push({
        id,
        title: row.title === null || row.title.trim().length === 0 ? null : row.title,
        chapters: that,
        createdAt: row.created_at ?? 0,
        scope: row.origin_scope === null || row.origin_scope.length === 0 ? null : row.origin_scope,
        aboutMe: (copies.get(id) ?? []).some((c) => c.about !== null && CORE_ABOUT_MARKS.includes(c.about))
      });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function yesterdayLine(day, date, titles = YESTERDAY_SHOWN, hidden = 0) {
  if (day.length === 0) {
    if (hidden <= 0)
      return null;
    return flatten(`Yesterday, ${stampWords(date.slice(5))}: ${String(hidden)} session${hidden === 1 ? "" : "s"} in other projects.`);
  }
  const named = Math.min(day.length, YESTERDAY_SHOWN);
  const shown = day.slice(0, named).map((c, i) => {
    return c.title === null || i >= titles ? c.id : `"${excerpt(c.title, YESTERDAY_TITLE_BYTES)}" (${c.id})`;
  });
  const rest = day.length - shown.length + Math.max(0, hidden);
  return flatten(`Yesterday, ${stampWords(date.slice(5))}: ${shown.join("; ")}${rest > 0 ? `; and ${String(rest)} more` : ""}.`);
}
export function yesterdayShorter(day, date, hidden = 0) {
  const out = [];
  let last = yesterdayLine(day, date, YESTERDAY_SHOWN, hidden);
  for (let n = Math.min(YESTERDAY_SHOWN, day.length) - 1;n >= 0; n--) {
    const line = yesterdayLine(day, date, n, hidden);
    if (line === null || last === null || line.length >= last.length)
      continue;
    out.push(line);
    last = line;
  }
  return out;
}
export function placeWords(scope) {
  return flatten(scope.trim().replace(/\/+$/, "").replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~"));
}
export function elsewhereLine(chapter, date, reader = null) {
  const where = chapter.scope === null ? "" : ` in ${placeWords(chapter.scope)}`;
  return flatten(`About me, from another project: ${sessionWords(chapter.session, chapter.model, reader)}, ${date}${where} ${named(chapter)}.`);
}
export function lastHereLadder(entries, reader = null) {
  const out = [];
  for (const block of [
    lastHereBlock(entries, { reader }),
    lastHereBlock(entries, { reader, shown: 1 }),
    lastHereBlock(entries, { reader, shown: 1, more: false })
  ]) {
    if (block !== null && !out.includes(block))
      out.push(block);
  }
  return out;
}
export const TODAY_ELSEWHERE_MAX_DIRS = 5;
export const TODAY_ELSEWHERE_MAX_BYTES = 300;
export function todayElsewhereLines(dirs, zone) {
  const named = dirs.filter((d) => d.firstAt !== null || d.memories > 0 || d.chapter !== null).sort((a, b) => Number(b.live) - Number(a.live) || (b.lastAt ?? 0) - (a.lastAt ?? 0) || b.memories - a.memories || (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
  const clock = (at) => localStamp(at, zone).split(" ")[1] ?? "";
  const one = (d, chapters) => {
    const when = d.firstAt === null ? "" : d.live ? ` open since ${clock(d.firstAt)} (live)` : ` ${clock(d.firstAt)}–${clock(d.lastAt ?? d.firstAt)}`;
    const chapter = !chapters || d.chapter === null ? "" : ` — ${chapterWords(d.chapter)}`;
    const count = d.memories === 0 ? "" : `, ${String(d.memories)} ${d.memories === 1 ? "memory" : "memories"}`;
    return `${placeWords(d.scope)}${when}${chapter}${count}`;
  };
  return elsewhereForms("Today, elsewhere:", named, one);
}
function elsewhereForms(head, named, one) {
  if (named.length === 0)
    return null;
  const line = (k, chapters) => {
    const rest = named.length - k;
    const tail = rest === 0 ? "" : `; +${String(rest)} more`;
    return flatten(`${head} ${named.slice(0, k).map((d) => one(d, chapters)).join("; ")}${tail}.`);
  };
  const candidates = [];
  for (let k = Math.min(named.length, TODAY_ELSEWHERE_MAX_DIRS);k >= 1; k--)
    candidates.push(line(k, true), line(k, false));
  candidates.push(`${head} ${String(named.length)} other ${named.length === 1 ? "project" : "projects"}.`);
  const size = (s) => new TextEncoder().encode(s).length;
  const forms = [];
  for (const form of candidates) {
    if (size(form) > TODAY_ELSEWHERE_MAX_BYTES)
      continue;
    const last = forms[forms.length - 1];
    if (last !== undefined && size(form) >= size(last))
      continue;
    forms.push(form);
  }
  const [widest, ...shorter] = forms;
  return widest === undefined ? null : { line: widest, shorter };
}
function chapterWords(c) {
  return c.title === null ? c.id : `"${excerpt(c.title, LAST_HERE_TITLE_BYTES)}" (${c.id})`;
}
export function sinceElsewhereLines(dirs, since, zone) {
  const named = dirs.filter((d) => d.startedAt !== null || d.endedAt !== null || d.memories > 0 || d.chapter !== null).sort((a, b) => Math.max(b.startedAt ?? 0, b.endedAt ?? 0, b.chapter?.writtenAt ?? 0) - Math.max(a.startedAt ?? 0, a.endedAt ?? 0, a.chapter?.writtenAt ?? 0) || b.memories - a.memories || (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
  const clock = (at) => localStamp(at, zone).split(" ")[1] ?? "";
  const when = (at) => localDate(at, zone) === localDate(since.now, zone) ? clock(at) : localStamp(at, zone);
  const one = (d, chapters) => {
    const state = d.startedAt !== null ? ` open since ${when(d.startedAt)}` : d.live ? " open" : d.endedAt !== null ? ` ended ${when(d.endedAt)}` : "";
    const chapter = !chapters || d.chapter === null ? "" : `, chapter ${chapterWords(d.chapter)}`;
    const count = d.memories === 0 ? "" : `, ${String(d.memories)} ${d.memories === 1 ? "memory" : "memories"}`;
    return `${placeWords(d.scope)}${state}${chapter}${count}`;
  };
  const head = since.started ? `Since you started (${when(since.at)}):` : `Since ${when(since.at)}:`;
  return elsewhereForms(head, named, one);
}
