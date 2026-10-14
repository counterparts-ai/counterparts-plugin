import { sessionsHere } from "../../core/coverage/index.js";
import { chaptersOf } from "../../core/handoff/last-here.js";
import {
  OPEN_END,
  OPEN_START,
  headOf,
  informativeness,
  localKey,
  readTimeAsk,
  semanticTuning
} from "../../core/recall/index.js";
import { STOPWORDS } from "../../core/recall/reference.js";
import { tokenize } from "../../core/store/index.js";
import { addDays, localDate, localTime, parseCalendarDate } from "../../core/time.js";
import { UNBOUND_SESSION } from "../../core/types.js";
import {
  RECALL_EXCERPT_CHARS,
  RECALL_MAX_IDS,
  RECALL_RESULT_CHARS,
  cutExcerpt,
  hasFaded,
  nightlyMade,
  provenanceParts
} from "./deliberate.js";
export const FACTS_PAGE_SIZE = 10;
export const FACTS_MEANING_CAP = 100;
export const FACTS_WEAK_FRACTION = 0.2;
export const FACTS_EARLIER_SHOWN = 2;
export const FACTS_CORRECTED_SHOWN = 3;
export const FACTS_NEAR_DUPLICATE = 0.85;
export const FACTS_ANCHOR_DAYS = 2;
export const FACTS_JOURNAL_GLOSS = "[journal] = a chapter: the first-person account memories were made from, not a memory — outside decay, dedup and the prune, and not a claim about the world the way a memory is.";
const ASKS_NOTHING = new Set([
  "remember",
  "remembered",
  "recall",
  "tell",
  "happened",
  "happen",
  "happens",
  "decide",
  "decided",
  "anything",
  "something",
  "everything",
  "ever",
  "else",
  "did",
  "does",
  "do",
  "talk",
  "talked",
  "discuss",
  "discussed",
  "mention",
  "mentioned",
  "about",
  "whats",
  "who",
  "whom",
  "whose"
]);
function contentTokens(text) {
  return [...new Set(tokenize(text))].filter((t) => !STOPWORDS.has(t) && !ASKS_NOTHING.has(t) && !/^\d{1,2}$/.test(t));
}
function learnedOf(row, zone) {
  if (row.created_at !== null && row.created_at > 0)
    return localDate(row.created_at, zone);
  return row.learned_on.length > 0 ? row.learned_on : null;
}
function metaOf(row) {
  if (row.meta === null || row.meta.length === 0)
    return {};
  try {
    const m = JSON.parse(row.meta);
    return m !== null && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}
function neverAResult(row) {
  if (row.type !== "schema")
    return false;
  const role = metaOf(row)["role"];
  return role === "page" || role === "handoff" || role === "entity";
}
function sessionOf(row) {
  if (row.origin_session !== null && row.origin_session.length > 0)
    return row.origin_session;
  if (row.type === "episode") {
    const s = metaOf(row)["sessionId"];
    return typeof s === "string" ? s : null;
  }
  return null;
}
function inWindow(row, window, clock, zone, chapterDates) {
  if (row.type === "episode" && chapterDates !== undefined && clock === null) {
    if (chapterDates(row.id).some((d) => d >= window.from && d <= window.to))
      return "learned";
  }
  if (row.occurred_on !== null) {
    const c = parseCalendarDate(row.occurred_on);
    if (c !== null)
      return c.first <= window.to && c.last >= window.from ? "event" : null;
  }
  const first = row.created_at;
  if (first === null || first <= 0) {
    const d = row.learned_on;
    return d.length > 0 && d >= window.from && d <= window.to ? "learned" : null;
  }
  const last = row.type === "episode" && row.updated_at !== null ? Math.max(first, row.updated_at) : first;
  if (clock !== null) {
    return localKey(last, zone) >= clock.from && localKey(first, zone) <= clock.to ? "learned" : null;
  }
  return localDate(last, zone) >= window.from && localDate(first, zone) <= window.to ? "learned" : null;
}
export function shortDate(ymd, today) {
  if (ymd === null || ymd.length === 0)
    return "";
  const c = parseCalendarDate(ymd);
  if (c === null)
    return ymd;
  const year = today.slice(0, 4);
  const one = (d) => d.slice(0, 4) === year ? d.slice(5) : d;
  if (c.precision === "day")
    return one(c.first);
  if (c.precision === "range")
    return `${one(c.first)}..${one(c.last)}`;
  return c.text;
}
function plainLine(text, max) {
  const flat = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0)
    return 0;
  let inter = 0;
  for (const t of a)
    if (b.has(t))
      inter += 1;
  return inter / (a.size + b.size - inter);
}
function likeness(doc) {
  const lines = new Set(doc.body.split(`
`).map((l) => tokenize(l).join(" ")).filter((l) => l.length > 0));
  return { words: new Set(tokenize(`${doc.title ?? ""}
${doc.body}`)), lines, block: blockOf(doc.body) !== null };
}
function alike(a, b) {
  return a.block || b.block ? jaccard(a.lines, b.lines) : jaccard(a.words, b.words);
}
export function factsRecall(ctx, question, opts = {}) {
  const store = ctx.counterpart.store;
  const zone = store.zone();
  const now = store.now();
  const today = localDate(now, zone);
  const day = store.livedDay();
  const page = opts.page !== undefined && Number.isInteger(opts.page) && opts.page >= 1 ? opts.page : 1;
  const denied = new Set(safe(() => store.deniedIds(), []));
  const rows = new Map;
  for (const r of safe(() => store.recallRows(), [])) {
    if (denied.has(r.id))
      continue;
    rows.set(r.id, r);
  }
  const storeSize = rows.size;
  const blockedBy = {};
  const blocked = (why) => {
    blockedBy[why] = (blockedBy[why] ?? 0) + 1;
  };
  const visible = (id) => {
    const r = rows.get(id);
    if (r === undefined || neverAResult(r))
      return;
    if (!ctx.owner && r.confidential === 1)
      return;
    return r;
  };
  const time = safe(() => readTimeAsk(question, { now, zone }), null);
  let rest = time?.rest ?? question;
  let window = time?.window ?? null;
  let anchor;
  let anchorSession = null;
  let anchorStretch = null;
  const words = (text) => {
    const tokens = contentTokens(text);
    const df = safe(() => store.docFrequency(tokens), new Map);
    const scores = new Map;
    let idfTotal = 0;
    for (const tok of tokens) {
      const n = df.get(tok) ?? 0;
      const idf = informativeness(n, storeSize);
      if (n <= 0 || idf <= 0)
        continue;
      idfTotal += idf;
      const hits = safe(() => store.search(tok, n), []);
      const top = hits[0]?.score ?? 0;
      for (const h of hits) {
        const shade = top > 0 ? 0.5 + 0.5 * (h.score / top) : 1;
        scores.set(h.id, (scores.get(h.id) ?? 0) + idf * shade);
      }
    }
    if (idfTotal > 0)
      for (const [id, s] of scores)
        scores.set(id, s / idfTotal);
    return { scores, idfTotal, tokens };
  };
  if (time?.anchor?.kind === "event") {
    const phrase = time.anchor.phrase;
    const found = words(phrase).scores;
    let best = null;
    for (const [id, score] of found) {
      if (visible(id) === undefined)
        continue;
      if (best === null || score > best.score || score === best.score && id < best.id)
        best = { id, score };
    }
    const row = best === null ? undefined : rows.get(best.id);
    const date = row === undefined ? null : parseCalendarDate(row.occurred_on ?? "")?.first ?? learnedOf(row, zone);
    if (date !== null && best !== null) {
      window = { from: addDays(date, -FACTS_ANCHOR_DAYS), to: addDays(date, FACTS_ANCHOR_DAYS) };
      anchor = { kind: "event", phrase, date, id: best.id };
    } else {
      anchor = { kind: "event", phrase, date: null };
      rest = question;
    }
  } else if (time?.anchor?.kind === "session") {
    const found = lastSession(ctx, rows, zone);
    if (found !== null) {
      window = { from: found.from, to: found.to };
      anchorSession = found.session;
      anchorStretch = found.stretch;
      anchor = { kind: "session", phrase: time.cue, date: found.from === found.to ? found.from : `${found.from}..${found.to}`, session: found.session };
    } else {
      anchor = { kind: "session", phrase: time.cue, date: null };
    }
  }
  const w = words(rest);
  const subjectIds = safe(() => ctx.counterpart.schemas?.subjectsIn(rest) ?? [], []);
  const subjects = [];
  const subjectScore = new Map;
  const unit = Math.max(w.idfTotal, informativeness(1, storeSize), 0.000000001);
  for (const s of subjectIds) {
    const members = safe(() => store.memoriesNaming(s), []);
    const name = safe(() => ctx.counterpart.schemas?.aliasIndex().termsFor(s)?.name ?? null, null) ?? s;
    subjects.push({ id: s, name });
    if (members.length === 0)
      continue;
    const weight = Math.min(1, informativeness(members.length, storeSize) / unit);
    for (const m of members)
      subjectScore.set(m, Math.max(subjectScore.get(m) ?? 0, Math.max(weight, 0.05)));
  }
  const onlyTime = window !== null && w.tokens.length === 0 && subjectIds.length === 0;
  const meaningScore = new Map;
  let meaningCapped = false;
  if (ctx.vector !== null && ctx.vector.length > 0 && !onlyTime) {
    const hits = safe(() => store.nearestTo(ctx.vector, FACTS_MEANING_CAP), []);
    const tuning = semanticTuning(ctx.counterpart.recall.tunables, safe(() => store.rankingIdentity(), null), "inline");
    const floor = tuning.floor;
    for (const h of hits) {
      if (h.score < floor)
        continue;
      meaningScore.set(h.id, floor >= 1 ? h.score : (h.score - floor) / (1 - floor));
    }
    const last = hits[hits.length - 1];
    meaningCapped = hits.length >= FACTS_MEANING_CAP && last !== undefined && last.score >= floor;
  }
  const pool = new Map;
  const add = (id, way, score) => {
    let c = pool.get(id);
    if (c === undefined) {
      c = { id, score: 0, ways: new Set, foldedEarlier: new Set };
      pool.set(id, c);
    }
    c.score += score;
    c.ways.add(way);
  };
  for (const [id, s] of w.scores)
    add(id, "words", s);
  for (const [id, s] of meaningScore)
    add(id, "meaning", s);
  for (const [id, s] of subjectScore)
    add(id, "subject", s);
  const datesHeld = new Map;
  const chapterDates = (id) => {
    const held = datesHeld.get(id);
    if (held !== undefined)
      return held;
    const dates = safe(() => chaptersOf(store.readProse(id).body).map((ch) => ch.date).filter((d) => d !== null), []);
    datesHeld.set(id, dates);
    return dates;
  };
  if (onlyTime && window !== null) {
    for (const [id, r] of rows) {
      if (r.type === "schema")
        continue;
      if (inWindow(r, window, time?.clock ?? null, zone, chapterDates) !== null)
        add(id, "time", 0.1);
    }
  }
  const ofAnchorSession = (r) => {
    if (anchorSession === null || nightlyMade(r) !== null)
      return false;
    const s = sessionOf(r);
    if (s === anchorSession)
      return true;
    return s === UNBOUND_SESSION && anchorStretch !== null && placedIn(r, anchorStretch);
  };
  const considered = pool.size;
  const beyond = new Map;
  for (const [id, c] of [...pool]) {
    const r = rows.get(id);
    if (r === undefined || neverAResult(r)) {
      pool.delete(id);
      continue;
    }
    if (!ctx.owner && r.confidential === 1) {
      blocked("confidential-withheld");
      pool.delete(id);
      continue;
    }
    if (window !== null) {
      const by = inWindow(r, window, time?.clock ?? null, zone, chapterDates);
      if (by === null) {
        beyond.set(id, c);
        pool.delete(id);
        continue;
      }
      c.timeBy = by;
      c.ways.add("time");
    }
    if (ofAnchorSession(r)) {
      c.score += 1;
      c.ways.add("session");
    }
  }
  const foldCopies = (into) => {
    for (const [id, c] of [...into]) {
      const r = rows.get(id);
      if (r.type !== "memory" || r.source !== "episode" || r.origin_ref === null || !r.origin_ref.startsWith("epi_"))
        continue;
      const chapter = r.origin_ref;
      if (visible(chapter) === undefined)
        continue;
      const to = into.get(chapter) ?? { id: chapter, score: 0, ways: new Set, foldedEarlier: new Set, ...c.timeBy === undefined ? {} : { timeBy: c.timeBy } };
      to.score = Math.max(to.score, c.score);
      for (const way of c.ways)
        to.ways.add(way);
      into.set(chapter, to);
      into.delete(id);
    }
  };
  const pairs = safe(() => store.contradictions({ limit: 1e5 }), []).filter((p) => p.via === null && p.state !== "withdrawn");
  const nowOf = new Map;
  for (const p of pairs) {
    if (p.state === "settled" && p.how === "changed" && p.over !== null && p.holds !== null)
      nowOf.set(p.over, p.holds);
  }
  const foldEarlier = (into) => {
    for (const [id, c] of [...into]) {
      let head = id;
      for (let i = 0;i < 8; i += 1) {
        const next = nowOf.get(head);
        if (next === undefined || visible(next) === undefined)
          break;
        head = next;
      }
      if (head === id)
        continue;
      const to = into.get(head) ?? { id: head, score: 0, ways: new Set, foldedEarlier: new Set, ...c.timeBy === undefined ? {} : { timeBy: c.timeBy } };
      to.score = Math.max(to.score, c.score);
      for (const way of c.ways)
        to.ways.add(way);
      to.foldedEarlier.add(id);
      into.set(head, to);
      into.delete(id);
    }
  };
  foldCopies(pool);
  foldEarlier(pool);
  foldCopies(beyond);
  foldEarlier(beyond);
  for (const id of pool.keys())
    beyond.delete(id);
  let weak = 0;
  const best = (m) => {
    let b = 0;
    for (const c of m.values())
      if (c.score > b)
        b = c.score;
    return b;
  };
  const top = best(pool);
  if (!onlyTime && top > 0) {
    for (const [id, c] of [...pool]) {
      if (c.score < FACTS_WEAK_FRACTION * top) {
        weak += 1;
        pool.delete(id);
      }
    }
  }
  const topAll = Math.max(top, best(beyond));
  let outside = 0;
  for (const c of beyond.values())
    if (onlyTime || topAll <= 0 || c.score >= FACTS_WEAK_FRACTION * topAll)
      outside += 1;
  const main = [...pool.values()];
  const fadedIds = new Set;
  for (const c of main) {
    const r = rows.get(c.id);
    if (r.type !== "memory")
      continue;
    try {
      if (hasFaded(store.physicsOf(c.id), day))
        fadedIds.add(c.id);
    } catch {}
  }
  const moment = (id) => {
    const r = rows.get(id);
    return r === undefined ? 0 : r.type === "episode" ? r.updated_at ?? r.created_at ?? 0 : r.created_at ?? 0;
  };
  const order = (a, b) => b.score - a.score || moment(b.id) - moment(a.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  main.sort(order);
  const bodies = new Map;
  const read = (id) => {
    const held = bodies.get(id);
    if (held !== undefined)
      return held;
    try {
      const doc = store.readProse(id);
      const got = { title: doc.title ?? null, body: doc.body };
      bodies.set(id, got);
      return got;
    } catch {
      return null;
    }
  };
  const kept = [];
  const keptLikeness = [];
  let duplicates = 0;
  let unreadable = 0;
  const need = page * FACTS_PAGE_SIZE;
  let walked = 0;
  for (const c of main) {
    if (kept.length >= need)
      break;
    walked += 1;
    const doc = read(c.id);
    if (doc === null) {
      unreadable += 1;
      continue;
    }
    const toks = likeness(doc);
    if (keptLikeness.some((k) => alike(k, toks) >= FACTS_NEAR_DUPLICATE)) {
      duplicates += 1;
      continue;
    }
    kept.push(c);
    keptLikeness.push(toks);
  }
  const matched = kept.length + (main.length - walked);
  if (unreadable > 0)
    blocked("unreadable");
  if (duplicates > 0)
    blockedBy["near-duplicate"] = duplicates;
  if (weak > 0)
    blockedBy["weak"] = weak;
  if (outside > 0)
    blockedBy["outside-window"] = outside;
  const shown = kept.slice((page - 1) * FACTS_PAGE_SIZE, page * FACTS_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(matched / FACTS_PAGE_SIZE));
  const fadedMatched = [...kept, ...main.slice(walked)].filter((c) => fadedIds.has(c.id)).length;
  const canName = (id) => {
    if (denied.has(id))
      return false;
    if (ctx.owner)
      return true;
    const r = rows.get(id) ?? safe(() => store.row(id), undefined);
    return r !== undefined && r.confidential !== 1;
  };
  const memories = shown.map((c) => factItem(ctx, c, rows.get(c.id), read(c.id), pairs, w.tokens, today, zone, window, canName, fadedIds.has(c.id)));
  return {
    mode: "facts",
    reason: matched === 0 ? "nothing-came" : "answered",
    semantic: ctx.vector !== null && ctx.vector.length > 0 ? "in-line" : ctx.semantic,
    matched,
    page,
    pages,
    memories,
    faded: fadedMatched,
    weak,
    duplicates,
    meaningCapped,
    time: time === null ? null : {
      cue: time.cue,
      said: anchor !== undefined ? window : time.said,
      window,
      stretch: anchor?.kind === "event" && anchor.date !== null ? FACTS_ANCHOR_DAYS : time.stretch,
      ...anchor === undefined ? {} : { anchor },
      outside
    },
    subjects,
    considered,
    storeSize,
    blockedBy,
    today
  };
}
function factItem(ctx, c, row, doc, pairs, tokens, today, zone, window, canName, faded) {
  const store = ctx.counterpart.store;
  const journal = row.type === "episode";
  let text = doc.body;
  let chapter;
  if (journal) {
    const all = chaptersOf(doc.body);
    if (all.length > 1) {
      const dated = window === null ? [] : all.map((ch, i) => ({ ch, i })).filter(({ ch }) => ch.date !== null && ch.date >= window.from && ch.date <= window.to);
      const among = dated.length > 0 ? dated : all.map((ch, i) => ({ ch, i }));
      let best = among[0]?.i ?? 0;
      let bestHits = -1;
      for (const { ch, i } of among) {
        const toks = new Set(tokenize(ch.text));
        const hits = tokens.filter((t) => toks.has(t)).length;
        if (hits > bestHits) {
          best = i;
          bestHits = hits;
        }
      }
      text = all[best]?.text ?? doc.body;
      chapter = { n: best + 1, of: all.length };
    }
  }
  const flat = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "").replace(/\s+/g, " ").trim();
  const body = cutExcerpt(flat, RECALL_EXCERPT_CHARS);
  const parts = provenanceParts(store, c.id, ctx.sessionId, ctx.counterpart.spans);
  const learned = learnedOf(row, zone);
  const lastWritten = journal && row.updated_at !== null ? localDate(row.updated_at, zone) : null;
  const learnedAt = !journal && row.created_at !== null && row.created_at > 0 ? localTime(row.created_at, zone).slice(0, 5) : "";
  const earlier = [];
  const versions = safe(() => store.versions(c.id), []);
  for (const v of [...versions].reverse()) {
    if (v.body.length === 0 || v.body === doc.body || v.reason === "episode-chapter")
      continue;
    earlier.push({
      text: plainLine(v.title ?? v.body, 60),
      learned: v.learned_on.length > 0 ? v.learned_on : null,
      changed: v.archived_at > 0 ? localDate(v.archived_at, zone) : null
    });
  }
  let corrected = 0;
  const wrong = [];
  const asked = new Set(tokens);
  const standing = [];
  let now;
  let changedOver = false;
  for (const p of pairs) {
    if (p.a !== c.id && p.b !== c.id)
      continue;
    const other = p.a === c.id ? p.b : p.a;
    if (p.state === "settled" && p.how === "changed" && p.holds === c.id && p.over !== null) {
      const o = store.row(p.over);
      if (o === undefined || !canName(p.over))
        continue;
      earlier.push({
        text: plainLine(o.title ?? o.body, 60),
        learned: o.learned_on.length > 0 ? o.learned_on : null,
        changed: localDate(p.updated_at, zone),
        id: p.over
      });
    } else if (p.state === "settled" && p.how === "changed" && p.over === c.id && p.holds !== null) {
      changedOver = true;
    } else if (p.state === "settled" && p.how === "corrected" && p.holds === c.id) {
      corrected += 1;
      const over = p.over;
      const o = over === null ? undefined : safe(() => store.row(over), undefined);
      if (over === null || o === undefined || o.body.length === 0 || !canName(over))
        continue;
      const held = new Set(tokenize(`${o.title ?? ""}
${o.body}`));
      wrong.push({
        text: plainLine(o.title ?? o.body, 60),
        learned: o.learned_on.length > 0 ? o.learned_on : null,
        corrected: localDate(p.updated_at, zone),
        id: over,
        reached: [...asked].filter((t) => held.has(t)).length
      });
    } else if (p.state === "settled" && p.how === "open") {
      if (canName(other))
        standing.push(`disagrees with ${other}`);
    } else if (p.state === "unsettled" && p.a === c.id) {
      const b = store.row(p.b);
      if (b !== undefined && b.archived === 0 && b.superseded_by === null && canName(p.b))
        standing.push(`unsettled — may be out of date, see ${p.b}`);
    }
  }
  if (changedOver) {
    const head = headOf(store, c.id);
    if (head !== null)
      now = canName(head) ? head : "a later version";
  }
  earlier.sort((a, b) => {
    const fa = a.id !== undefined && c.foldedEarlier.has(a.id) ? 0 : 1;
    const fb = b.id !== undefined && c.foldedEarlier.has(b.id) ? 0 : 1;
    return fa - fb || (b.changed ?? "").localeCompare(a.changed ?? "");
  });
  wrong.sort((a, b) => b.reached - a.reached || (b.corrected ?? "").localeCompare(a.corrected ?? "") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const correctedShown = wrong.slice(0, FACTS_CORRECTED_SHOWN).map(({ text, learned, corrected: on, id }) => ({ text, learned, corrected: on, id }));
  const title = row.title ?? doc.title;
  const block = blockOf(text);
  return {
    id: c.id,
    faded,
    title,
    line: title !== null && title.trim().length > 0 ? plainLine(title, 100) : plainLine(text, 80),
    kind: row.kind,
    journal,
    ...chapter === undefined ? {} : { chapter },
    body,
    bodyChars: doc.body.length,
    whole: body.length === flat.length && chapter === undefined,
    ...block === null ? {} : { block },
    saidBy: row.said_by,
    status: row.status,
    occurredOn: row.occurred_on,
    learned,
    ...lastWritten !== null && lastWritten !== learned ? { lastWritten } : {},
    ...learnedAt.length === 5 ? { learnedAt } : {},
    where: parts?.where ?? null,
    who: parts?.who ?? null,
    current: now === undefined,
    ...now === undefined ? {} : { now },
    earlier: earlier.slice(0, FACTS_EARLIER_SHOWN),
    earlierMore: Math.max(0, earlier.length - FACTS_EARLIER_SHOWN),
    corrected,
    ...correctedShown.length === 0 ? {} : { correctedShown },
    standing: standing.slice(0, 2),
    ways: ["words", "meaning", "subject", "session", "time"].filter((x) => c.ways.has(x)),
    ...c.timeBy === undefined ? {} : { timeBy: c.timeBy },
    score: Math.round(c.score * 1000) / 1000
  };
}
const normScope = (s) => s.trim().replace(/\/+$/, "");
function placedIn(r, s) {
  const at = r.created_at;
  if (at === null || r.origin_scope === null || normScope(r.origin_scope) !== normScope(s.scope))
    return false;
  if (at < s.firstAt || at > s.lastAt)
    return false;
  return !s.others.some((o) => at >= o.firstAt && at <= o.lastAt);
}
function lastSession(ctx, rows, zone) {
  const scope = ctx.scope?.trim() ?? "";
  if (scope.length > 0) {
    const spans = ctx.counterpart.spans;
    const here = spans === undefined ? [] : safe(() => sessionsHere(spans, scope), []);
    const stretchOf = (session, firstAt, lastAt) => ({
      scope,
      firstAt,
      lastAt,
      others: here.filter((h) => h.session !== session)
    });
    try {
      const named = ctx.counterpart.chaptersHereFor?.(scope, ctx.sessionId)[0];
      if (named !== undefined) {
        const session = named.chapter.session;
        const own = here.find((h) => h.session === session);
        return {
          session,
          from: localDate(named.firstAt, zone),
          to: localDate(named.lastAt, zone),
          stretch: stretchOf(session, own?.firstAt ?? named.firstAt, own?.lastAt ?? named.lastAt)
        };
      }
    } catch {}
    const s = here.filter((h) => h.session !== ctx.sessionId).sort((a, b) => b.lastAt - a.lastAt)[0];
    if (s !== undefined) {
      return { session: s.session, from: localDate(s.firstAt, zone), to: localDate(s.lastAt, zone), stretch: stretchOf(s.session, s.firstAt, s.lastAt) };
    }
  }
  let best = null;
  for (const r of rows.values()) {
    if (r.type !== "episode")
      continue;
    const s = sessionOf(r);
    if (s === null || s === ctx.sessionId)
      continue;
    if (best === null || (r.updated_at ?? 0) > (best.updated_at ?? 0))
      best = r;
  }
  if (best === null)
    return null;
  const session = sessionOf(best);
  const first = best.created_at ?? best.updated_at ?? 0;
  const last = best.updated_at ?? first;
  if (first <= 0)
    return null;
  return { session, from: localDate(first, zone), to: localDate(last, zone), stretch: null };
}
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
const SAID = { owner: "you said", self: "I said", inferred: "inferred" };
function channelWords(semantic) {
  if (semantic === "in-line")
    return null;
  if (semantic === "embedder-off")
    return "by words only — recall by meaning is off";
  if (semantic === "embed-failed")
    return "by words only — the question could not be embedded";
  return null;
}
function itemLines(m, i, today, excerptChars, time) {
  const out = [];
  const mark = m.journal ? "[journal] " : "";
  const ch = m.chapter === undefined ? "" : ` (chapter ${String(m.chapter.n)} of ${String(m.chapter.of)})`;
  out.push(`${String(i)}. ${mark}${m.line} · ${m.id}${ch} · ${m.ways.join(", ")}${m.faded ? " · faded: not used for a long while" : ""}`);
  if (m.journal) {
    out.push(`   my journal · written ${shortDate(m.learned, today)}${m.lastWritten === undefined || m.lastWritten === null ? "" : `..${shortDate(m.lastWritten, today)}`}${m.where === null ? "" : ` in ${m.where}`}${m.who === null ? "" : ` · ${m.who}`}`);
  } else {
    const said = m.saidBy === null ? "speaker unknown" : SAID[m.saidBy] ?? m.saidBy;
    const status = m.status ?? "status unknown";
    const occurred = m.occurredOn === null ? "no event date" : `${m.status === "planned" || m.status === "proposed" || m.status === "asked" ? "for" : "happened"} ${shortDate(m.occurredOn, today)}`;
    out.push(`   ${said} · ${status} · ${occurred}`);
    const where = m.where === null ? "" : ` in ${m.where}`;
    const who = m.who === null ? "" : ` · ${m.who}`;
    const standing = m.current ? "CURRENT" : `earlier — now ${m.now ?? "?"}`;
    const extra = m.standing.length === 0 ? "" : ` · ${m.standing.join(" · ")}`;
    const by = m.timeBy === "learned" && m.occurredOn === null ? " (in the window by this date)" : "";
    const at = time === undefined ? "" : ` ${time}`;
    out.push(`   learned ${m.learned === null ? "date unknown" : `${shortDate(m.learned, today)}${at}`}${by}${where}${who} · ${standing}${extra}`);
  }
  for (const e of m.earlier) {
    const learned = e.learned === null ? "" : ` (learned ${shortDate(e.learned, today)})`;
    const changed = e.changed === null ? "" : `, changed ${shortDate(e.changed, today)}`;
    out.push(`   earlier: "${e.text}"${learned}${changed}${e.id === undefined ? "" : ` · ${e.id}`}`);
  }
  if (m.earlierMore > 0)
    out.push(`   +${String(m.earlierMore)} more earlier`);
  const named = m.correctedShown ?? [];
  for (const e of named) {
    const learned = e.learned === null ? "" : ` (learned ${shortDate(e.learned, today)})`;
    const on = e.corrected === null ? "" : `, corrected ${shortDate(e.corrected, today)}`;
    out.push(`   corrected (was wrong): "${e.text}"${learned}${on} · ${e.id}`);
  }
  const unnamed = m.corrected - named.length;
  if (unnamed > 0) {
    out.push(named.length === 0 ? `   ${String(unnamed)} corrected version${unnamed === 1 ? "" : "s"} hidden` : `   +${String(unnamed)} more corrected (was wrong)`);
  }
  const words = m.body.length <= excerptChars ? m.body : cutExcerpt(m.body, excerptChars);
  const block = m.block !== undefined && (!m.whole || words !== m.body) ? ` (${m.block}; read whole by id)` : "";
  out.push(`   ${words}${block}`);
  return out;
}
const LIST_ITEM = /^[ \t]*(?:[-*+•]|\d{1,4}[.)])[ \t]+\S/;
const TABLE_ROW = /^[ \t]*\|.*\|[ \t]*$/;
const TABLE_RULE = /^[ \t]*\|[ \t:|-]+\|[ \t]*$/;
const LIST_MIN_ITEMS = 5;
const TABLE_MIN_ROWS = 3;
export function blockOf(text) {
  let items = 0;
  let rows = 0;
  for (const line of text.split(`
`)) {
    if (TABLE_ROW.test(line)) {
      if (!TABLE_RULE.test(line))
        rows += 1;
    } else if (LIST_ITEM.test(line))
      items += 1;
  }
  const data = Math.max(0, rows - 1);
  if (data >= TABLE_MIN_ROWS && data >= items)
    return `a table, ${String(data)} rows`;
  if (items >= LIST_MIN_ITEMS)
    return `a list, ${String(items)} items`;
  return null;
}
function sameDayTimes(memories) {
  const groups = new Map;
  for (const m of memories) {
    if (m.journal || m.learnedAt === undefined || m.learned === null)
      continue;
    let day = m.learned;
    if (m.occurredOn !== null) {
      const c = parseCalendarDate(m.occurredOn);
      if (c === null || c.precision !== "day")
        continue;
      day = c.first;
    }
    const key = `${day}|${m.learned}`;
    const g = groups.get(key);
    if (g === undefined)
      groups.set(key, [m]);
    else
      g.push(m);
  }
  const out = new Map;
  for (const g of groups.values()) {
    if (g.length < 2 || new Set(g.map((m) => m.learnedAt)).size < 2)
      continue;
    for (const m of g)
      if (m.learnedAt !== undefined)
        out.set(m.id, m.learnedAt);
  }
  return out;
}
export function renderFacts(r) {
  for (const excerpt of [RECALL_EXCERPT_CHARS, 150, 60, 0]) {
    const text = renderAt(r, r.today, excerpt);
    if (text.length <= RECALL_RESULT_CHARS || excerpt === 0)
      return text.length <= RECALL_RESULT_CHARS ? text : cutExcerpt(text, RECALL_RESULT_CHARS);
  }
  return "";
}
function renderAt(r, today, excerpt) {
  const lines = [];
  const first = (r.page - 1) * FACTS_PAGE_SIZE;
  const shown = r.memories.length;
  const after = Math.max(0, r.matched - first - shown);
  const head = [`${String(r.matched)} match`];
  if (r.page > 1)
    head.push(`page ${String(r.page)}`);
  if (shown > 0)
    head.push(r.page > 1 ? `showing ${String(first + 1)}–${String(first + shown)}` : `showing ${String(shown)}`);
  if (r.page < r.pages)
    head.push(`${after > 0 ? `${String(after)} more` : "more"} → page ${String(r.page + 1)}`);
  if (r.faded > 0)
    head.push(r.faded === r.matched ? r.matched === 1 ? "faded" : "all faded" : `${String(r.faded)} of them faded`);
  lines.push(head.join(" · "));
  if (r.time !== null) {
    const t = r.time;
    const span = (w) => w === null ? "" : w.from === OPEN_START ? `through ${shortDate(w.to, today)}` : w.to === OPEN_END ? `${shortDate(w.from, today)} onward` : w.from === w.to ? shortDate(w.from, today) : `${shortDate(w.from, today)}..${shortDate(w.to, today)}`;
    const out = t.outside > 0 ? ` · ${String(t.outside)} more match outside it` : "";
    if (t.anchor !== undefined && t.anchor.date === null) {
      lines.push(t.anchor.kind === "event" ? `time: ${t.cue} — no memory names "${t.anchor.phrase}", so nothing was filtered by time` : `time: ${t.cue} — no earlier session found, so nothing was filtered by time`);
    } else if (t.anchor !== undefined) {
      const what = t.anchor.kind === "event" ? `${t.anchor.phrase} → ${shortDate(t.anchor.date, today)}${t.anchor.id === undefined ? "" : ` (${t.anchor.id})`}` : `${t.cue} → ${shortDate(t.anchor.date, today)}${t.anchor.session === undefined ? "" : ` (session ${t.anchor.session.slice(0, 8)}, its rows first)`}`;
      const stretch = t.anchor.kind === "event" ? `, window ${span(t.window)}` : "";
      lines.push(`time: ${what}${stretch}${out}`);
    } else {
      const stretch = t.stretch > 0 ? `, stretched ${String(t.stretch)} day${t.stretch === 1 ? "" : "s"} each side` : "";
      lines.push(`time: ${t.cue} → ${span(t.said)}${stretch}${out}`);
    }
  }
  if (r.subjects.length > 0)
    lines.push(`about: ${r.subjects.map((s) => s.name).join(", ")}`);
  const channel = channelWords(r.semantic);
  if (channel !== null)
    lines.push(channel);
  const notAll = [];
  if (r.meaningCapped)
    notAll.push(`meaning search hit its cap (${String(FACTS_MEANING_CAP)})`);
  if (r.weak > 0)
    notAll.push(`${String(r.weak)} weak match${r.weak === 1 ? "" : "es"} not shown`);
  if (notAll.length > 0)
    lines.push(`may not be everything: ${notAll.join(" · ")}`);
  if (r.duplicates > 0) {
    lines.push(`${String(r.duplicates)} near-duplicate${r.duplicates === 1 ? "" : "s"} of a result shown left out`);
  }
  if (r.matched === 0) {
    lines.push("");
    lines.push("Nothing matched. Try the words the memory itself would use, a person or project it names, or a wider time.");
    return lines.join(`
`);
  }
  const times = sameDayTimes(r.memories);
  r.memories.forEach((m, i) => {
    lines.push("");
    lines.push(...itemLines(m, first + i + 1, today, excerpt, times.get(m.id)));
  });
  lines.push("");
  const foot = [];
  if (r.memories.some((m) => !m.whole))
    foot.push(`read any whole with ids: [...] (up to ${String(RECALL_MAX_IDS)})`);
  if (r.page < r.pages)
    foot.push(`page: ${String(r.page + 1)} for the next`);
  if (foot.length > 0)
    lines.push(`${foot.join(" · ")}.`);
  if (r.memories.some((m) => m.journal))
    lines.push(FACTS_JOURNAL_GLOSS);
  return lines.join(`
`).trimEnd();
}
