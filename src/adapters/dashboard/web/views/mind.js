import { TUNABLES as PHYSICS, promotionEligibility, sal } from "../../../../core/physics/index.js";
import { isConfidential } from "../../../../core/recall/index.js";
import {
  FRAMING,
  LANE_ORDER,
  collapsedLane,
  headingsOf,
  isFoldedLine,
  FOLDED_WORDS,
  SELF_PAGE_REVISED_EVENT,
  chapterModels,
  dayBefore,
  pageSections,
  readChapterLead,
  readPageTooLargeDetail
} from "../../../../core/self/index.js";
import { TUNABLES as SLEEP, coreContextFor, isJournal, reconsiderWords } from "../../../../core/sleep/index.js";
import { NEVER, NONE } from "../../layout.js";
import { localDate } from "../../../../core/time.js";
import { WITHHELD, reveal } from "../reveal.js";
import { dateOr } from "../shared/dates.js";
import { chapters, contestedRows, livedDays } from "./rows.js";
import { coreHistory, dreamsView } from "./dreams.js";
import { selfMap } from "./self-map.js";
import { traitsView } from "./traits.js";
export function mindView(src) {
  const store = src.store;
  const day = store.livedDay();
  const e = src.self.enumerate(day);
  const wake = src.self.wake();
  const page = src.self.page();
  const sections = pageSections(page?.body ?? "");
  const everLived = day > 0 || store.list().length > 0;
  const seen = new Set(e.identity.map((el) => el.id));
  const unreadable = store.list({ band: "identity", archived: false }).filter((id) => !seen.has(id)).map((id) => ({ id, label: reveal(store, id, 72).label }));
  const shape = (el) => {
    const r = reveal(store, el.id, 120);
    return {
      id: el.id,
      text: r.text ?? r.label,
      kind: el.kind,
      band: el.band,
      strength: el.strength,
      bytes: el.bytes,
      ...livedDays(src, el.id),
      confidential: r.confidential
    };
  };
  const identity = e.identity.map(shape);
  const guarded = e.protected.map(shape);
  const outside = e.protectedOutsideIdentity.map((id) => {
    const r = reveal(store, id, 90);
    return { id, text: r.text ?? r.label };
  });
  const stories = storyViews(src);
  const read = journalChapters(src);
  const history = pageHistory(src, page);
  const candidates = coreCandidates(src, page?.id ?? null);
  return {
    opening: `Day ${day} · Who I am`,
    identity,
    identityAbsent: e.identity.length === 0 ? everLived ? NONE : NEVER : null,
    guarded,
    guardedAbsent: e.protected.length === 0 ? everLived ? NONE : NEVER : null,
    both: e.both,
    protectedOutsideIdentity: outside,
    unreadable,
    wake: {
      ok: wake.ok,
      reason: wake.reason,
      bytes: wake.bytes,
      preface: wake.preface,
      lanes: wake.ok ? wakeLanes(wake.text) : [],
      absent: wake.ok ? null : everLived ? NONE : NEVER
    },
    page: page === null ? null : {
      present: true,
      body: page.body,
      bytes: page.bytes,
      revisedOn: page.revisedOn,
      by: page.by,
      reason: page.reason,
      version: page.version,
      stale: src.self.pageStale(page),
      staleAfter: src.self.tunables.PAGE_STALE_DAYS,
      core: sections.core,
      lately: sections.lately,
      headed: sections.headed,
      sections: sections.sections.map((x) => ({ heading: x.heading, body: x.body }))
    },
    pageAbsent: page === null ? everLived ? NONE : NEVER : null,
    pageVersions: src.self.pageVersions(),
    chapters: chapters(src, 12),
    chaptersAbsent: chapters(src, 1).length === 0 ? everLived ? NONE : NEVER : null,
    stories,
    storiesAbsent: stories.length === 0 ? everLived ? NONE : NEVER : null,
    pageHistory: history,
    ...pageDays(src, history),
    settling: settlingView(src, {
      core: identity,
      guarded,
      outside,
      unreadable,
      stories,
      candidates,
      absent: everLived ? NONE : NEVER
    }),
    map: selfMap(src, identity, candidates.raw),
    traits: traitsView(src),
    wakeList: wakeList(src, wake.ok ? wake.text : null, page),
    ...journal(read, JOURNAL_LIMIT, everLived ? NONE : NEVER),
    pageBehind: pageBehind(src, page, read),
    writer: writerLine(src),
    ...dreamsPart(src)
  };
}
function dreamsPart(src) {
  const dreams = dreamsView(src);
  return { dreams, dreamsAbsent: dreams.dreams.length === 0 ? NEVER : null };
}
const TONIGHT = "Tonight's run tries again.";
const WRITER_REASON = {
  watchdog: { why: "it ran out of time", next: () => TONIGHT },
  "no-room": {
    why: "the session start had no room left to ask (the old way)",
    next: () => "It runs inside the nightly run now, where there is room.",
    more: () => "Until 2026-09-28 the page writer was asked at the start of a session, beside the wake, and only when the ask fitted what the host lets a session start with. " + "This night it did not fit, so it was held back rather than cut short. The writer runs inside the nightly run now, handed its day in a tool result, with no such limit."
  },
  "scope-question": {
    why: "the first-launch question took its turn (the old way)",
    next: () => "It runs inside the nightly run now, and waits for no question.",
    more: () => "Until 2026-09-28 a session start carried one question at most, and the first-launch question could go first. The writer runs inside the nightly run now."
  },
  off: {
    why: "the writer is switched off",
    next: () => "Turning it on (pageWriter.mode in claude-code.json) brings it back."
  },
  "host-mode": { why: "it runs in host mode, from its own windowless session" },
  observer: { why: "the session was read-only", next: () => "An ordinary session will be asked." },
  "no-previous-day": { why: "there was no earlier day to read" },
  "already-claimed": { why: "that night was already handled" },
  "asks-spent": { why: "it had already been asked as often as it may", next: () => TONIGHT },
  "no-memories": { why: "nothing was remembered that day" },
  "not-host-mode": { why: "it is not set to run on its own" }
};
export function writerReason(detail) {
  const d = detail.trim();
  if (d === "")
    return "no reason was recorded";
  const known = WRITER_REASON[d];
  if (known !== undefined)
    return known.why;
  const exit = /^exit (\S+)$/.exec(d);
  if (exit !== null)
    return `it stopped with an error (exit ${exit[1]})`;
  const large = readPageTooLargeDetail(d);
  if (large !== null) {
    return `the page it sent was ${String(large.bytes)} bytes, ${String(large.over)} over the ${String(large.limit)}-byte limit${large.then === "" ? "" : `, and was ${large.then}`}`;
  }
  return d.replace(/[-_]+/g, " ");
}
function writerNext(detail, lastNight) {
  const d = detail.trim();
  const known = WRITER_REASON[d];
  if (known !== undefined)
    return known.next === undefined ? null : known.next(lastNight);
  if (/^exit \S+$/.test(d))
    return TONIGHT;
  if (readPageTooLargeDetail(d) !== null)
    return TONIGHT;
  return null;
}
const WRITER_IS = "The page writer reads the day just gone, once a night — the first part of the nightly run, before the dream and the reflection — and rewrites the page when something about who I am moved.";
const WRITER_ABOUT = `${WRITER_IS} This is its newest night.`;
const shortDay = (iso) => dateOr(iso);
export function writerWords(status, yesterday) {
  if (status === null) {
    const none = "No run recorded yet";
    return {
      ran: false,
      about: "",
      outcome: null,
      derived: false,
      lastNight: false,
      when: "",
      what: none,
      next: null,
      line: none,
      more: `${WRITER_IS} It has not run on this store yet.`,
      absent: NEVER
    };
  }
  const detail = status.run?.detail ?? "";
  const lastNight = status.about !== "" && status.about === yesterday;
  let what;
  let next = null;
  let reasoned = false;
  switch (status.outcome) {
    case "revised":
      what = "rewrote it";
      break;
    case "nothing-to-say":
      what = status.derived ? "was handed the day and left it as is" : "read the day and kept it as is";
      break;
    case "refused":
      what = `tried, but the rewrite was turned away — ${writerReason(detail)}`;
      reasoned = true;
      break;
    case "failed":
      if (status.derived) {
        what = "started and never finished";
        next = TONIGHT;
      } else {
        what = `couldn't rewrite it — ${writerReason(detail)}`;
        next = writerNext(detail, lastNight);
        reasoned = true;
      }
      break;
    case "asked":
      what = "was handed the day in today's nightly run; no answer yet";
      break;
    case "started":
      what = "is running now";
      break;
    default:
      if (status.run === null) {
        what = "nothing ran, and nothing says why";
      } else {
        what = `not rewritten — ${writerReason(detail)}`;
        next = writerNext(detail, lastNight);
        reasoned = true;
      }
  }
  const when = lastNight ? "Last night" : status.about === "" ? "Its last run" : `The night of ${shortDay(status.about)}`;
  const on = status.run?.on ?? "";
  const recorded = isIsoDay(on) ? ` Recorded ${shortDay(on)}.` : "";
  const story = reasoned ? WRITER_REASON[detail.trim()]?.more?.(lastNight) : undefined;
  const more = WRITER_ABOUT + (story === undefined ? "" : ` ${story}`) + recorded;
  const line = `${when}: ${what}.` + (next === null ? "" : ` ${next}`);
  return { ran: true, about: status.about, outcome: status.outcome, derived: status.derived, lastNight, when, what, next, line, more, absent: null };
}
function writerLine(src) {
  try {
    const today = src.self.calendarToday();
    const last = src.self.pageWriterRuns()[0];
    if (last === undefined)
      return writerWords(null, dayBefore(today));
    return writerWords(src.self.pageWriterStatus(last.about, today), dayBefore(today));
  } catch {
    return writerWords(null, "");
  }
}
const JOURNAL_LIMIT = 60;
export const PAGE_BEHIND_LIVED_DAYS = 2;
function countOf(n, one, many) {
  return n === 1 ? `a ${one}` : `${String(n)} ${many}`;
}
export function pageBehindWords(x) {
  const when = isIsoDay(x.date) ? shortDay(x.date) : `on day ${String(x.writtenDay)} of use`;
  const parts = [x.livedDays === 1 ? "1 day of use" : `${String(x.livedDays)} days of use`];
  if (x.chapters > 0)
    parts.push(countOf(x.chapters, "chapter", "chapters"));
  if (x.dreams > 0)
    parts.push(countOf(x.dreams, "dream", "dreams"));
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Written ${when} — ${list} since.`;
}
const DREAMS_COUNTED = 1000;
function pageBehind(src, page, chapters) {
  if (page === null || page.revisedDay === null)
    return null;
  const writtenDay = page.revisedDay;
  const livedDays = src.store.livedDay() - writtenDay;
  if (livedDays < PAGE_BEHIND_LIVED_DAYS)
    return null;
  let dreams = 0;
  try {
    dreams = src.store.dreams({ limit: DREAMS_COUNTED }).filter((d) => d.day > writtenDay).length;
  } catch {}
  const x = {
    date: page.revisedOn.trim(),
    writtenDay,
    livedDays,
    chapters: chapters.filter((c) => c.day > writtenDay).length,
    dreams
  };
  return { ...x, line: pageBehindWords(x) };
}
function dateOfMs(at, zone) {
  if (!Number.isFinite(at) || at <= 0)
    return null;
  return localDate(at, zone);
}
function pageHistory(src, page) {
  const versions = src.self.pageVersions().slice().sort((a, b) => a.seq - b.seq);
  const at = new Map;
  const onDay = new Map;
  const pageId = page?.id ?? null;
  const zone = src.store.zone();
  try {
    const rows = pageId === null ? src.store.eventLog({ name: SELF_PAGE_REVISED_EVENT, order: "desc", limit: LOG_LIMIT }) : src.store.eventLog({ name: SELF_PAGE_REVISED_EVENT, ref: pageId, order: "desc", limit: LOG_LIMIT });
    for (const row of rows) {
      const payload = JSON.parse(row.payload ?? "{}");
      const v = payload["version"];
      if (typeof v === "number" && !at.has(v)) {
        at.set(v, row.at);
        onDay.set(v, row.day);
      }
    }
  } catch {}
  const steps = versions.map((v, i) => ({
    n: i + 1,
    seq: v.seq,
    current: false,
    day: onDay.get(v.seq - 1) ?? (i > 0 ? versions[i - 1].day : null),
    date: at.has(v.seq - 1) ? dateOfMs(at.get(v.seq - 1), zone) : null,
    by: v.by,
    reason: v.reason,
    body: v.body,
    bytes: v.bytes
  }));
  if (page !== null) {
    steps.push({
      n: steps.length + 1,
      seq: page.version + 1,
      current: true,
      day: page.revisedDay,
      date: page.revisedOn.length > 0 ? page.revisedOn : at.has(page.version) ? dateOfMs(at.get(page.version), zone) : null,
      by: page.by,
      reason: page.reason,
      body: page.body,
      bytes: page.bytes
    });
  }
  return steps;
}
export const LOG_LIMIT = 2000;
export const PAGE_DAYS_MAX = 90;
const WRITER_RUNS_READ = 500;
export function pageDayWords(w) {
  const what = w.what;
  const lead = /^(not |nothing )/.test(what) ? what.charAt(0).toUpperCase() + what.slice(1) : `The page writer ${what}`;
  return `${lead}.` + (w.next === null ? "" : ` ${w.next}`);
}
export function pageDayUnrecorded(today) {
  return today ? { why: "Not rewritten today; the page writer has not run yet.", more: `${WRITER_IS} It runs at most once a night, when a session starts.` } : { why: "Not rewritten, and the page writer left no record that day.", more: `${WRITER_IS} Nothing in the record says it ran on this day of use.` };
}
function pageDays(src, history) {
  const dated = history.filter((s) => s.day !== null);
  const undated = history.length - dated.length;
  if (dated.length === 0)
    return { pageDays: [], pageDaysUndated: undated, pageDaysEarlier: 0 };
  const today = src.store.livedDay();
  const first = Math.max(Math.min(...dated.map((s) => s.day)), today - (PAGE_DAYS_MAX - 1));
  let calendar = "";
  let runs = [];
  try {
    calendar = src.self.calendarToday();
    runs = src.self.pageWriterRuns({ limit: WRITER_RUNS_READ });
  } catch {}
  const yesterday = calendar === "" ? "" : dayBefore(calendar);
  const lastActive = src.store.getMeta("lastActiveDate") ?? "";
  const newestDate = isIsoDay(lastActive) ? lastActive : null;
  const cycleDate = new Map;
  try {
    for (const row of src.store.eventLog({ name: "sleep.cycle", sinceDay: first, order: "desc", limit: LOG_LIMIT })) {
      const date = JSON.parse(row.payload ?? "{}")["date"];
      if (typeof date === "string" && isIsoDay(date))
        cycleDate.set(row.day, date);
    }
  } catch {}
  const newestRun = new Map;
  for (const r of runs)
    if (!newestRun.has(r.day))
      newestRun.set(r.day, r);
  const out = [];
  for (let d = first;d <= Math.max(first, today); d += 1) {
    const steps = dated.filter((s) => s.day === d);
    const isToday = d === today && calendar !== "" && newestDate === calendar;
    const run = newestRun.get(d);
    const runDate = run !== undefined && isIsoDay(run.on) ? run.on : null;
    if (steps.length > 0) {
      const last = steps[steps.length - 1];
      out.push({
        day: d,
        date: last.date ?? runDate ?? (d === today ? newestDate : null) ?? cycleDate.get(d) ?? null,
        today: isToday,
        seqs: steps.map((s) => s.seq),
        by: last.by,
        reason: last.reason,
        why: null,
        more: null
      });
      continue;
    }
    let words;
    if (run === undefined) {
      words = pageDayUnrecorded(isToday);
    } else {
      let w;
      try {
        w = writerWords(src.self.pageWriterStatus(run.about, calendar || undefined), yesterday);
      } catch {
        w = writerWords({ about: run.about, outcome: run.outcome, derived: false, run }, yesterday);
      }
      words = { why: pageDayWords(w), more: w.more };
    }
    out.push({
      day: d,
      date: runDate ?? (d === today ? newestDate : null) ?? cycleDate.get(d) ?? null,
      today: isToday,
      seqs: [],
      by: null,
      reason: null,
      ...words
    });
  }
  return { pageDays: out, pageDaysUndated: undated, pageDaysEarlier: first - Math.min(...dated.map((s) => s.day)) };
}
export function oneReturnAway(v) {
  return v.fast.intensity >= v.fast.needIntensity && !v.fast.met && v.blockedBy.length === 1 && v.blockedBy[0] === "no-lane-yet";
}
export function coreCandidates(src, pageId) {
  const store = src.store;
  const day = store.livedDay();
  const raw = [];
  let outOfReach = 0;
  let sentBack = 0;
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || isJournal(row) || row.type === "schema" || id === pageId)
      continue;
    let p;
    try {
      p = store.physicsOf(id);
    } catch {
      continue;
    }
    if (p.promotedIdentity)
      continue;
    const ctx = coreContextFor(store, row, day);
    if (!ctx.aboutMe && ctx.selfRelevantFeeling !== true) {
      outOfReach += 1;
      continue;
    }
    const v = promotionEligibility(p, ctx);
    if (v.blockedBy.includes("demoted-by-owner")) {
      sentBack += 1;
      continue;
    }
    const returned = v.fast.gap !== null && v.fast.gap >= v.fast.needGap;
    const fast = Math.min(1, v.fast.intensity / v.fast.needIntensity) + (returned ? 1 : 0);
    const slow = Math.min(1, v.slow.days / v.slow.needDays) + Math.min(1, v.slow.span / v.slow.needSpan);
    raw.push({
      id,
      kind: p.kind,
      feeling: v.fast.intensity,
      returned,
      days: v.slow.days,
      span: v.slow.span,
      lane: v.lane,
      eligible: v.eligible,
      closeness: Math.max(fast, slow),
      oneReturnAway: oneReturnAway(v)
    });
  }
  raw.sort((a, b) => b.closeness - a.closeness || b.days - a.days || (a.id < b.id ? -1 : 1));
  return { raw, outOfReach, sentBack };
}
function settlingView(src, x) {
  const store = src.store;
  const { raw, outOfReach, sentBack } = x.candidates;
  const candidates = raw.slice(0, CANDIDATE_LIMIT).map((r) => {
    const t = reveal(store, r.id, 110);
    return {
      id: r.id,
      text: t.text ?? t.label,
      confidential: t.confidential,
      kind: r.kind,
      feeling: r.feeling,
      needFeeling: PHYSICS.CORE_FAST_FEELING,
      returned: r.returned,
      days: r.days,
      requiredDays: PHYSICS.CORE_SLOW_DAYS,
      span: r.span,
      needSpan: PHYSICS.CORE_SLOW_SPAN_DAYS,
      lane: r.lane,
      eligible: r.eligible,
      oneReturnAway: r.oneReturnAway
    };
  });
  const row = (el) => ({
    id: el.id,
    text: el.text,
    confidential: el.confidential === true,
    kind: el.kind ?? "fact"
  });
  const reconsidering = store.coreReconsidering().map((r) => {
    const t = reveal(store, r.id, 110);
    return { id: r.id, text: t.text ?? t.label, confidential: t.confidential, kind: store.row(r.id)?.kind ?? "fact", why: reconsiderWords(r.reason), day: r.day };
  });
  return {
    core: x.core.map(row),
    reconsidering,
    guarded: x.guarded.map(row),
    contested: x.stories.map((s) => ({
      id: s.id,
      about: s.about,
      now: s.nowFull,
      revised: s.revised,
      fraction: s.fraction,
      pressure: s.pressure,
      bar: s.bar
    })),
    outside: x.outside.map((o) => ({ id: o.id, text: o.text, confidential: false, kind: "fact" })),
    unreadable: x.unreadable,
    candidates,
    onTheWay: raw.filter((r) => r.days > 0).length,
    unused: raw.filter((r) => r.days === 0).length,
    outOfReach,
    sentBack,
    history: coreHistory(src),
    rule: {
      needFeeling: PHYSICS.CORE_FAST_FEELING,
      needGap: PHYSICS.CORE_FAST_GAP_DAYS,
      days: PHYSICS.CORE_SLOW_DAYS,
      sessions: PHYSICS.CORE_SLOW_SESSIONS,
      window: PHYSICS.CORE_SLOW_WINDOW_DAYS,
      span: PHYSICS.CORE_SLOW_SPAN_DAYS,
      everyDays: SLEEP.CADENCE.consolidate,
      cap: SLEEP.CORE_MAX_PER_SLEEP,
      quietDays: SLEEP.CORE_QUIET_DAYS
    },
    coreAbsent: x.core.length === 0 ? x.absent : null,
    guardedAbsent: x.guarded.length === 0 ? x.absent : null,
    contestedAbsent: x.stories.length === 0 ? x.absent : null
  };
}
const CANDIDATE_LIMIT = 5;
const PART_LABEL = {
  furniture: "headers",
  page: "self page",
  identity: "who I am",
  craft: "how I work",
  threads: "still open",
  hints: "might be relevant",
  horizon: "coming up"
};
export function wakeParts(text, hasPage) {
  const headings = new Map;
  for (const lane of LANE_ORDER)
    for (const h of headingsOf(lane))
      headings.set(h, lane);
  const bytes = new Map;
  const order = [];
  const add = (key, n) => {
    if (!bytes.has(key))
      order.push(key);
    bytes.set(key, (bytes.get(key) ?? 0) + n);
  };
  let current = "furniture";
  const lines = text.split(`
`);
  lines.forEach((raw, i) => {
    const n = new TextEncoder().encode(raw).length + (i < lines.length - 1 ? 1 : 0);
    const line = raw.trim();
    const lane = headings.get(line);
    if (lane !== undefined) {
      current = lane === "identity" && hasPage ? "page" : lane;
      add("furniture", n);
      return;
    }
    const collapsed = collapsedLane(line);
    if (collapsed !== null) {
      current = collapsed;
      add(collapsed, n);
      return;
    }
    if (line.startsWith("<!--") || line === FRAMING.context || isFoldedLine(line)) {
      add("furniture", n);
      return;
    }
    add(current, n);
  });
  return order.map((key) => ({ key, label: PART_LABEL[key] ?? key, bytes: bytes.get(key) ?? 0 })).filter((p) => p.bytes > 0);
}
export function lastRender(src) {
  try {
    const [row] = src.store.eventLog({ name: "self.briefing", order: "desc", limit: 1 });
    if (row === undefined)
      return null;
    const p = JSON.parse(row.payload ?? "{}");
    const budget = p["budget"];
    const day = p["day"];
    const list = Array.isArray(p["trimmed"]) ? p["trimmed"] : [];
    const total = typeof p["trimmedTotal"] === "number" ? p["trimmedTotal"] : list.length;
    const lanes = [];
    for (const t of list) {
      const lane = t !== null && typeof t === "object" ? t.lane : undefined;
      if (typeof lane === "string" && !lanes.includes(lane))
        lanes.push(lane);
    }
    return {
      budget: typeof budget === "number" && budget > 0 ? budget : null,
      day: typeof day === "number" ? day : null,
      trimmed: total,
      trimmedLanes: lanes
    };
  } catch {
    return null;
  }
}
export const wakePartLabel = (key) => PART_LABEL[key] ?? key;
const lineText = (item) => item.replace(/^(\S+\s·\s|by\s\S+\s·\s)/, "");
function wakeMemory(store, id) {
  const row = store.row(id);
  if (row === undefined || row.archived === 1)
    return null;
  const t = reveal(store, id, 110);
  const title = t.confidential || row.title === null || row.title.trim() === "" ? null : row.title.trim();
  return { id, text: t.text ?? t.label, title, confidential: t.confidential };
}
function arrivingOf(store, lines) {
  if (lines.length === 0)
    return [];
  const known = [];
  try {
    const ids = new Set([...store.datedMemories("0000-01-01", "9999-12-31").map((d) => d.id), ...store.prospectiveMemoryIds()]);
    for (const id of ids) {
      const row = store.row(id);
      if (row === undefined || row.archived === 1)
        continue;
      const first = row.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? row.body;
      const said = first.replace(/\s+/g, " ").trim();
      if (said.length >= 8)
        known.push({ id, said });
    }
  } catch {}
  return lines.map((line) => {
    const hit = known.find((k) => line === k.said) ?? known.find((k) => line.includes(k.said.slice(0, 80)));
    const m = hit === undefined ? null : wakeMemory(store, hit.id);
    return m ?? { id: null, text: line, title: null, confidential: false };
  });
}
function wakeList(src, text, page) {
  if (text === null)
    return { ok: false, page: null, nearby: [], nearbyLines: [], arriving: [], also: [] };
  const store = src.store;
  const lanes = wakeLanes(text);
  const lines = (lane) => lanes.filter((l) => l.lane === lane).flatMap((l) => l.items);
  const hasPage = page !== null && wakeParts(text, true).some((p) => p.key === "page");
  const rendered = lastRender(src);
  const pageLine = !hasPage || page === null ? null : {
    date: isIsoDay(page.revisedOn.trim()) ? page.revisedOn.trim() : null,
    writtenDay: page.revisedDay,
    livedDaysAgo: page.revisedDay === null ? null : Math.max(0, store.livedDay() - page.revisedDay),
    newerThanWake: page.revisedDay !== null && rendered?.day != null && page.revisedDay > rendered.day
  };
  let nearby = [];
  try {
    const open = [...store.wakeDisplays().values()].filter((r) => r.lane === "hints" && r.closed_day === null).sort((a, b) => b.shown_day - a.shown_day || (a.memory_id < b.memory_id ? -1 : 1));
    nearby = open.flatMap((r) => {
      const m = wakeMemory(store, r.memory_id);
      return m === null ? [] : [m];
    });
  } catch {}
  const also = [];
  for (const lane of ["identity", "craft", "threads"]) {
    const n = lines(lane).length;
    if (n > 0 && !(lane === "identity" && hasPage))
      also.push({ label: PART_LABEL[lane] ?? lane, lines: n });
  }
  return {
    ok: true,
    page: pageLine,
    nearby,
    nearbyLines: nearby.length > 0 ? [] : lines("hints").map(lineText),
    arriving: arrivingOf(store, lines("horizon").map(lineText)),
    also
  };
}
const CHAPTER_SPLIT = /^(?=[ \t]*#{1,6}[ \t]*chapter[ \t]+\d+)/im;
const MONTH_INDEX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function headingIso(date) {
  if (date === null)
    return null;
  const m = /^[A-Za-z]{3},?\s+(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/.exec(date.trim());
  if (m === null)
    return null;
  const month = MONTH_INDEX[m[2].toLowerCase()];
  if (month === undefined)
    return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
const isIsoDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
function journalChapters(src) {
  const store = src.store;
  const all = [];
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || !isJournal(row))
      continue;
    const rowIso = isIsoDay(row.happened_on) ? row.happened_on : isIsoDay(row.learned_on) ? row.learned_on : null;
    let doc;
    try {
      doc = store.readProse(id);
    } catch {
      all.push({ id, chapter: 1, title: reveal(store, id, 60).label, model: null, first: "", text: null, bytes: 0, confidential: false, day: 0, date: null, iso: rowIso, isoFromHeading: false });
      continue;
    }
    const withheld = isConfidential(doc);
    const models = chapterModels(doc.meta ?? {});
    const parts = doc.body.split(CHAPTER_SPLIT).filter((p) => p.trim().length > 0);
    const title = doc.title ?? "an unnamed chapter";
    parts.forEach((part, i) => {
      const lead = readChapterLead(part);
      const n = lead.chapters[0] ?? i + 1;
      const rest = lead.rest.trim();
      const first = rest.split(`
`).map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("<!--")) ?? "";
      const fromHeading = headingIso(lead.date);
      all.push({
        id,
        chapter: n,
        title: parts.length > 1 ? `${title} · chapter ${n}` : title,
        model: lead.model ?? models[String(n)] ?? null,
        first: withheld ? WITHHELD : first.length > 200 ? `${first.slice(0, 200).trimEnd()}…` : first,
        text: withheld ? null : rest,
        bytes: new TextEncoder().encode(rest).length,
        confidential: withheld,
        day: lead.livedDay ?? doc.bornDay,
        date: lead.date,
        iso: fromHeading ?? rowIso,
        isoFromHeading: fromHeading !== null
      });
    });
  }
  all.sort((a, b) => b.day - a.day || (a.id < b.id ? 1 : a.id > b.id ? -1 : b.chapter - a.chapter));
  return all;
}
function journal(all, limit, absent) {
  const sent = all.slice(0, limit);
  const days = [];
  let headed = false;
  for (const c of sent) {
    let d = days[days.length - 1];
    if (d === undefined || d.day !== c.day) {
      d = { day: c.day, date: c.date, iso: c.iso, chapters: [] };
      days.push(d);
      headed = c.isoFromHeading;
    }
    if (d.date === null && c.date !== null)
      d.date = c.date;
    if (c.iso !== null && (d.iso === null || !headed && c.isoFromHeading)) {
      d.iso = c.iso;
      headed = c.isoFromHeading;
    }
    const { day: _day, date: _date, iso: _iso, isoFromHeading: _headed, ...chapter } = c;
    d.chapters.push(chapter);
  }
  return { journal: days, journalAbsent: all.length === 0 ? absent : null, journalMore: all.length - sent.length };
}
export function wakeLanes(text) {
  const headings = new Map;
  for (const lane of LANE_ORDER)
    for (const h of headingsOf(lane))
      headings.set(h, lane);
  const lanes = [];
  let current = {
    heading: "How this arrives",
    lane: null,
    items: []
  };
  for (const raw of text.split(`
`)) {
    const line = raw.trim();
    if (line.startsWith("<!--"))
      continue;
    if (line.length === 0)
      continue;
    const lane = headings.get(line);
    const collapsed = collapsedLane(line);
    if (collapsed !== null) {
      if (current.items.length > 0)
        lanes.push(current);
      const said = headingsOf(collapsed).find((h) => line.startsWith(`${h} `)) ?? FRAMING[collapsed];
      current = { heading: FRAMING[collapsed], lane: collapsed, items: [line.slice(said.length).trim()] };
      continue;
    }
    if (isFoldedLine(line)) {
      if (current.items.length > 0)
        lanes.push(current);
      lanes.push({ heading: FOLDED_WORDS, lane: null, items: [line.slice(FOLDED_WORDS.length).trim()] });
      current = { heading: "", lane: null, items: [] };
      continue;
    }
    const mdHeading = /^#{1,6}\s+(.*)$/.exec(line);
    if (lane !== undefined || mdHeading !== null) {
      if (current.items.length > 0)
        lanes.push(current);
      current = {
        heading: lane === undefined ? mdHeading?.[1] ?? line : line,
        lane: lane ?? null,
        items: []
      };
      continue;
    }
    current.items.push(line.replace(/^[-*]\s+/, ""));
  }
  if (current.items.length > 0)
    lanes.push(current);
  return lanes;
}
function storyViews(src) {
  const store = src.store;
  return contestedRows(src).map((row) => {
    let story;
    try {
      story = src.schemas.story(row.id);
    } catch {
      return { ...row, beats: [], beatsAbsent: NONE };
    }
    const beats = story.increments.slice().sort((a, b) => a.day - b.day).map((inc) => {
      const crossed = inc.pressureAfter >= inc.bar;
      const step = story.lineage.find((l) => l.id === inc.targetId && l.successorId !== null);
      const successorId = crossed ? step?.successorId ?? null : null;
      const became = successorId === null ? null : reveal(store, successorId, 96).text;
      const verdict = crossed ? step === undefined || step.successorId === null ? "it cleared the bar — but I find no supersession recorded" : "it cleared the bar, and I changed my mind" : "under the bar — held";
      const c = reveal(store, inc.challengerId, 72);
      return {
        day: inc.day,
        challenger: c.text ?? c.label,
        force: inc.force,
        pressureAfter: inc.pressureAfter,
        bar: inc.bar,
        fraction: inc.bar > 0 ? Math.min(1.3, inc.pressureAfter / inc.bar) : 0,
        verdict,
        became,
        becameId: successorId,
        crossed
      };
    });
    return {
      ...row,
      beats,
      beatsAbsent: beats.length === 0 ? "(none yet) — this belief carries pressure but I hold no credited challenge for it: the increments predate the durable log, or were swept." : null
    };
  });
}
