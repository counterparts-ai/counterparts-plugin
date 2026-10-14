import { nameRegex, wholeWordRegex } from "../../core/encode/words.js";
import { OTHER_EMOTION, wheelEntry } from "../../core/feelings-wheel.js";
import { wireChars } from "../../core/fit/index.js";
import { chaptersOf } from "../../core/handoff/last-here.js";
import { UNRESOLVED_META_KEY } from "../../core/mint.js";
import { softenedFeeling, strength } from "../../core/physics/index.js";
import { askedNames, earlierMark, feelingTokens, headOf, isFeelingFrameWord, readFeelingAsk, semanticTuning, stampCores } from "../../core/recall/index.js";
import { chapterAddress, chapterAt, chapterTimesOf, findIdentityCore, identityCoreName } from "../../core/self/index.js";
import { RECURRING_META, feelingValence, feltDay, tokenize } from "../../core/store/index.js";
import { calendarOverlaps, daysBetween, isDay, isRecurrence, localDate, occurrenceOnOrAfter, readableRecurrence } from "../../core/time.js";
import { RECALL_RESULT_CHARS, hasFaded } from "./deliberate.js";
export const MEANING_CHAPTERS_SHOWN = 8;
export const MEANING_MOMENTS_PER_CHAPTER = 3;
export const MEANING_FADED_SHOWN = 4;
export const MEANING_READINGS_SHOWN = 4;
export const MEANING_OPEN_SHOWN = 5;
export const MEANING_PATTERNS_SHOWN = 4;
export const MEANING_SEMANTIC_MAX = 100;
export const MEANING_WORDS_MAX = 200;
export const MEANING_RESULT_CHARS = RECALL_RESULT_CHARS;
const COMMON_SHARE = 0.25;
const LINE_CHARS = 220;
const TITLE_CHARS = 90;
const FRAME = new Set([
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "how",
  "whats",
  "was",
  "were",
  "is",
  "are",
  "am",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "can",
  "could",
  "will",
  "would",
  "should",
  "may",
  "ive",
  "im",
  "the",
  "an",
  "this",
  "that",
  "these",
  "those",
  "some",
  "any",
  "them",
  "they",
  "their",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "about",
  "from",
  "by",
  "as",
  "into",
  "and",
  "or",
  "but",
  "if",
  "than",
  "then",
  "not",
  "very",
  "really",
  "me",
  "my",
  "mine",
  "you",
  "your",
  "yours",
  "we",
  "us",
  "our",
  "ours",
  "it",
  "its",
  "there",
  "been",
  "since",
  "ever",
  "over",
  "time",
  "times",
  "things",
  "thing",
  "between",
  "together",
  "keeps",
  "keep",
  "coming",
  "come",
  "comes",
  "up",
  "happened",
  "happen",
  "mean",
  "means",
  "meant",
  "think",
  "felt",
  "feel",
  "feeling",
  "feelings",
  "most",
  "all",
  "so",
  "far",
  "lately",
  "recently",
  "tell",
  "story",
  "arc",
  "been",
  "know",
  "knew",
  "known",
  "remember",
  "remembered"
]);
const FEELING_FRAME_MORE = new Set([
  "owner",
  "user",
  "recent",
  "recently",
  "lately",
  "latest",
  "last",
  "today",
  "yesterday",
  "tonight",
  "now"
]);
const US_WORDS = new Set(["us", "ourselves", "together"]);
const ABOUT_BEFORE = [
  /\b(?:what|who|how)\s+(?:has|have|had|is|are|was|were)\s+$/i,
  /\bhow\s+did\s+$/i,
  /\babout\s+$/i,
  /\b(?:my|our|your)\s+(?:arc|history|story|relationship|time|work|things)\s+with\s+$/i,
  /\bbetween\s+$/i,
  /\bbetween\s+(?:you|me|him|her|them)\s+and\s+$/i
];
const ASIDE_BEFORE = /\b(?:(?:be|been|is|was|are|were|mean|means|meant|matter|matters|mattered)\s+(?:to|for)|since|after|before|until|than)\s+$/i;
const JOINED = /^(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|&)\s+)$/i;
const OWNER_AS_YOU = /\b(?:you|yourself)\b(?!['’])/gi;
const OWNER_AS_I = /\b(?:i|me|myself)\b(?!['’])/gi;
export function meaningRecall(ctx, question, opts = {}) {
  const c = ctx.counterpart;
  const store = c.store;
  const owner = ctx.owner;
  const day = ctx.day ?? safe(() => store.livedDay(), 0);
  const zone = safe(() => store.zone(), undefined);
  const today = safe(() => store.today(), localDate(Date.now(), zone));
  const vector = ctx.vector ?? null;
  const semantic = vector !== null && vector.length > 0 ? "in-line" : ctx.semantic ?? "embedder-off";
  const asker = ctx.asker ?? "self";
  const ownerName = ownerDisplayName(c);
  const whose = {
    self: asker === "self" ? "mine" : "the counterpart's",
    owner: asker === "owner" ? "mine" : ownerName === null ? "the owner's" : `${ownerName}'s`
  };
  const page = Number.isInteger(opts.page) && opts.page >= 1 ? opts.page : 1;
  const denied = new Set(safe(() => store.deniedIds(), []));
  const rows = new Map;
  const usable = (id) => {
    if (rows.has(id))
      return rows.get(id) ?? null;
    let out = null;
    try {
      const row = store.row(id);
      if (row !== undefined && row.type === "memory" && row.archived === 0 && row.superseded_by === null && !denied.has(id) && (owner || row.confidential !== 1)) {
        out = row;
      }
    } catch {
      out = null;
    }
    rows.set(id, out);
    return out;
  };
  const stamps = safe(() => store.feelingsLive(), []);
  const tokensOf = stamps.map((f) => feelingTokens(f));
  const stored = new Set(tokensOf.flatMap((x) => [...x]));
  const minLen = c.recall.tunables.MIN_CUE_LENGTH;
  const ask = safe(() => readFeelingAsk(question, { asker, ownerNames: ownerNamesLower(c), owner }, stored, minLen), null);
  const feelingAsked = ask !== null && ask.ranked;
  const felt = new Map;
  if (feelingAsked && ask !== null) {
    const every = ask.named.size === 0;
    stamps.forEach((f, i) => {
      if (ask.whose !== null && f.whose !== ask.whose)
        return;
      const answers = tokensOf[i];
      const exact = every || [...ask.named].some((w) => answers.has(w));
      const core = !exact && stampCores(f).some((x) => ask.cores.has(x));
      if (!exact && !core)
        return;
      const soft = softenedFeeling(f.strength, day - feltDay(f), feelingValence(f));
      const value = (ask.strongest ? f.strength : soft) * (exact ? 1 : 0.5);
      if (!(value > 0))
        return;
      if (usable(f.memory_id) === null)
        return;
      felt.set(f.memory_id, Math.max(felt.get(f.memory_id) ?? 0, value));
    });
  }
  const cardOf = (id) => {
    const name = safe(() => c.schemas.entity(id)?.name ?? null, null);
    if (name === null)
      return null;
    return { id, name, ids: safe(() => store.memoriesNaming(id), []).filter((m) => usable(m) !== null) };
  };
  const cards = safe(() => c.schemas.subjectsIn(question), []).map(cardOf).filter((x) => x !== null).sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
  const usAsked = tokenize(question).some((w) => US_WORDS.has(w)) || /\bbetween\s+(you\s+and\s+me|me\s+and\s+you)\b/i.test(question);
  const usIds = usAsked ? safe(() => store.list({ type: "memory", archived: false, about: "us" }), []).filter((m) => usable(m) !== null) : [];
  const usName = ownerName === null ? "us" : `us (${ownerName} and me)`;
  const held = new Map;
  const hold = (id, weight) => {
    const row = usable(id);
    if (row === null || !(weight > 0))
      return;
    const had = held.get(id);
    if (had === undefined)
      held.set(id, { row, weight });
    else
      had.weight = Math.max(had.weight, weight);
  };
  let lens = null;
  let textMatch = null;
  let lineMatch = [];
  const others = [];
  const notes = [];
  const ownerCard = safe(() => findIdentityCore(store), null);
  let cardWords = null;
  const cardWord = (word) => {
    if (cardWords === null) {
      const index = new Map;
      for (const e of safe(() => c.schemas.entities(), [])) {
        for (const w of new Set([e.name, ...e.aliases].flatMap((t) => tokenize(t))))
          index.set(w, [...index.get(w) ?? [], e.id]);
      }
      cardWords = index;
    }
    return (cardWords.get(word) ?? []).some((id) => (cardOf(id)?.ids.length ?? 0) > 0);
  };
  const subject = subjectOf(question, cards, {
    terms: (id) => cardTerms(c, id),
    ownerCard,
    ownerPronoun: feelingAsked || usAsked ? null : asker === "self" ? OWNER_AS_YOU : OWNER_AS_I,
    ownerCardOf: () => ownerCard === null ? null : cardOf(ownerCard),
    ownerNames: new Set(ownerNamesLower(c).flatMap((n) => tokenize(n))),
    cardWord
  });
  const bestCard = subject.card;
  if (bestCard !== null && subject.alike.length > 0) {
    notes.push(`it asks about ${andList([bestCard.name, ...subject.alike])} alike: this follows ${bestCard.name}, named first`);
  }
  let noCard = bestCard !== null && subject.bareAlike.length > 0 ? `No card for ${andList(subject.bareAlike)} yet; this follows ${bestCard.name}` : null;
  const bareName = bestCard === null && !feelingAsked ? subject.bare : null;
  if (bestCard !== null) {
    lens = { kind: "card", id: bestCard.id, name: bestCard.name };
    for (const id of bestCard.ids)
      hold(id, 1);
    const terms = cardTerms(c, bestCard.id);
    const res = terms.map((t) => nameRegex(t, "giu"));
    lineMatch = terms.map((t) => nameRegex(t));
    if (res.length > 0) {
      textMatch = (text) => {
        let n = 0;
        for (const re of res)
          n += (text.match(re) ?? []).length;
        return Math.min(n, 4) * 0.5;
      };
    }
    for (const x of cards)
      if (x.id !== bestCard.id)
        others.push({ name: x.name, memories: x.ids.length });
    if (usIds.length > 0)
      others.push({ name: usName, memories: usIds.length });
  } else if (bareName !== null) {
    lens = { kind: "words", name: `"${bareName}"` };
    const byWords = holdByWords(store, nameTopic(bareName), usable, hold);
    textMatch = byWords.textMatch;
    lineMatch = byWords.lineMatch;
    notes.push("matched by the name as written, not by meaning");
    for (const x of cards)
      others.push({ name: x.name, memories: x.ids.length });
    if (usIds.length > 0)
      others.push({ name: usName, memories: usIds.length });
  } else if (usIds.length > 0) {
    lens = { kind: "us", name: usName };
    for (const id of usIds)
      hold(id, 1);
    for (const x of cards)
      others.push({ name: x.name, memories: x.ids.length });
  } else if (feelingAsked && ask !== null) {
    const feelingAs = feelingName(ask.named, ask.whose, whose);
    const asked = question.replace(/\bsince\b[^?.!;]*/gi, " ");
    const proper = safe(() => askedNames(asked), new Set);
    const owners = new Set(ownerNamesLower(c).flatMap((n) => tokenize(n)));
    const topic = subject.bare !== null ? nameTopic(subject.bare) : contentWords(c, asked, minLen, ask.named, (w) => isFeelingFrameWord(w, stored, proper) || owners.has(w) || FEELING_FRAME_MORE.has(w));
    const reached = new Map;
    if (topic.words.length > 0) {
      holdByWords(store, topic, usable, (id) => {
        const v = felt.get(id);
        if (v !== undefined)
          reached.set(id, v);
      });
    }
    const topicName = `"${topic.shown.join(" ")}"`;
    if (reached.size > 0) {
      lens = { kind: "feeling", name: `${feelingAs} about ${topicName}` };
      for (const [id, v] of reached)
        hold(id, v);
      notes.push(`no card names ${topicName}: the moments that carry ${feelingAs} and say it`);
    } else {
      lens = { kind: "feeling", name: feelingAs };
      for (const [id, v] of felt)
        hold(id, v);
      if (topic.words.length > 0) {
        notes.push(`no card names ${topicName}, and no moment that carries ${feelingAs} says it: every one follows`);
      }
    }
    for (const x of cards)
      others.push({ name: x.name, memories: x.ids.length });
  } else {
    const topic = contentWords(c, question, minLen, ask?.named ?? new Set);
    const words = topic.words;
    if (words.length > 0 || vector !== null && vector.length > 0) {
      lens = { kind: "words", name: words.length > 0 ? `"${topic.shown.join(" ")}"` : "the question's meaning" };
      if (words.length > 0) {
        const byWords = holdByWords(store, topic, usable, hold);
        textMatch = byWords.textMatch;
        lineMatch = byWords.lineMatch;
      }
      if (vector !== null && vector.length > 0) {
        const floor = safe(() => semanticTuning(c.recall.tunables, store.rankingIdentity(), "inline").floor, 0.45);
        for (const h of safe(() => store.nearestTo(vector, MEANING_SEMANTIC_MAX), [])) {
          if (h.score >= floor)
            hold(h.id, Math.min(1, h.score));
        }
      }
      notes.push(`no card names it: matched by its words${vector !== null && vector.length > 0 ? " and its meaning" : ` only (meaning search off: ${semantic})`}`);
    }
    for (const x of cards)
      others.push({ name: x.name, memories: x.ids.length });
  }
  const readingIds = new Set;
  const copies = new Map;
  for (const [id, h] of held) {
    if (h.row.source === "dreamed" || h.row.source === "reflection") {
      readingIds.add(id);
      held.delete(id);
    } else if (h.row.source === "episode" && h.row.origin_ref !== null && h.row.origin_ref.startsWith("epi_")) {
      copies.set(id, h);
      held.delete(id);
    }
  }
  const strengthOf = new Map;
  const fadedIds = [];
  for (const [id] of held) {
    const physics = safe(() => store.physicsOf(id), null);
    if (physics === null)
      continue;
    strengthOf.set(id, strength(physics, day));
    if (isFaded(physics, day))
      fadedIds.push(id);
  }
  for (const id of fadedIds)
    held.delete(id);
  let feelingFilter = null;
  if (feelingAsked && ask !== null && lens !== null && lens.kind !== "feeling") {
    const kept = [...held.keys()].filter((id) => felt.has(id));
    if (kept.length > 0)
      feelingFilter = felt;
    else
      notes.push(`none of ${lens.name}'s moments carry ${feelingName(ask.named, ask.whose, whose)}: the whole arc follows`);
  }
  const episodes = episodeIndex(c, owner, denied);
  const bySession = new Map;
  for (const e of episodes) {
    if (e.session === null)
      continue;
    const list = bySession.get(e.session) ?? [];
    list.push(e);
    bySession.set(e.session, list);
  }
  const times = new Map;
  const timesOf = (id) => {
    if (!times.has(id))
      times.set(id, chapterTimesOf(store, id));
    return times.get(id) ?? null;
  };
  const entries = new Map;
  const chapterEntry = (e, k) => {
    const key = chapterAddress(e.id, k);
    let entry = entries.get(key);
    if (entry === undefined) {
      const t = timesOf(e.id);
      const date = e.chapters[k - 1]?.date ?? null;
      const at = t?.moments[k] ?? (date !== null ? Date.parse(`${date}T12:00:00Z`) : e.createdAt);
      entry = { key, kind: "chapter", episode: e, chapter: k, session: e.session, unplaced: false, at, date: date ?? localDay(at, zone), hold: 0, textHold: 0, moments: [] };
      entries.set(key, entry);
    }
    return entry;
  };
  const momentList = [...held.values()].filter((h) => feelingFilter === null || feelingFilter.has(h.row.id));
  for (const h of momentList) {
    const session = h.row.origin_session;
    const at = h.row.created_at;
    let placed = null;
    if (session !== null && at !== null) {
      for (const e of bySession.get(session) ?? []) {
        const t = timesOf(e.id);
        const k = t === null ? null : chapterAt(t, at);
        if (k !== null) {
          placed = chapterEntry(e, k);
          break;
        }
      }
    }
    if (placed === null) {
      const key = `session ${session === null || session.length === 0 ? "unrecorded" : session}`;
      placed = entries.get(key) ?? null;
      if (placed === null) {
        const unplaced = session !== null && bySession.has(session);
        placed = {
          key,
          kind: "session",
          episode: null,
          chapter: null,
          session,
          unplaced,
          at: at ?? Number.POSITIVE_INFINITY,
          date: at === null ? emptyNull(h.row.learned_on) : localDay(at, zone),
          hold: 0,
          textHold: 0,
          moments: []
        };
        entries.set(key, placed);
      }
      if (at !== null && at < placed.at) {
        placed.at = at;
        placed.date = localDay(at, zone);
      }
    }
    placed.moments.push(h);
    placed.hold += feelingFilter !== null ? feelingFilter.get(h.row.id) ?? 0 : h.weight;
  }
  if (textMatch !== null && feelingFilter === null) {
    for (const e of episodes) {
      e.chapters.forEach((ch, i) => {
        const n = textMatch(ch.text);
        if (n > 0) {
          const entry = chapterEntry(e, i + 1);
          entry.textHold += n;
          entry.hold += n;
        }
      });
    }
  } else if (feelingFilter === null) {
    const byId = new Map(episodes.map((e) => [e.id, e]));
    for (const h of copies.values()) {
      const e = byId.get(h.row.origin_ref ?? "");
      if (e === undefined)
        continue;
      const entry = chapterEntry(e, e.chapters.length);
      entry.hold += h.weight;
    }
  }
  const all = [...entries.values()].filter((e) => e.hold > 0).sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1) || a.key.localeCompare(b.key));
  const momentIds = all.flatMap((e) => e.moments.map((m) => m.row.id));
  const feelingsAll = safe(() => store.feelingsOn(momentIds), new Map);
  const marks = new Map;
  const mark = (key, m) => {
    const list = marks.get(key) ?? [];
    if (!list.includes(m))
      list.push(m);
    marks.set(key, list);
  };
  let lastSign = 0;
  for (const e of all) {
    const fs = e.moments.flatMap((m) => feelingsAll.get(m.row.id) ?? []);
    const sign = valenceSign(fs);
    if (sign !== 0) {
      if (lastSign !== 0 && sign !== lastSign)
        mark(e.key, "turn");
      lastSign = sign;
    }
  }
  const long = all.length > MEANING_CHAPTERS_SHOWN;
  if (long) {
    mark(all[0].key, "start");
    mark(all[all.length - 1].key, "end");
  }
  const ranked = long ? [...all].sort((a, b) => {
    const ra = rankOf(marks.get(a.key));
    const rb = rankOf(marks.get(b.key));
    if (ra !== rb)
      return ra - rb;
    if (b.hold !== a.hold)
      return b.hold - a.hold;
    return a.at === b.at ? 0 : b.at < a.at ? -1 : 1;
  }) : all;
  const pages = Math.max(1, Math.ceil(all.length / MEANING_CHAPTERS_SHOWN));
  const onPage = new Set(ranked.slice((page - 1) * MEANING_CHAPTERS_SHOWN, page * MEANING_CHAPTERS_SHOWN).map((e) => e.key));
  if (page > pages)
    notes.push(`page ${String(page)} is past the end: the arc has ${String(pages)} page${pages === 1 ? "" : "s"}`);
  const arc = [];
  let gap = [];
  const flush = () => {
    if (gap.length === 0)
      return;
    arc.push({ fold: true, count: gap.length, from: gap[0].date, to: gap[gap.length - 1].date });
    gap = [];
  };
  for (const e of all) {
    if (!onPage.has(e.key)) {
      gap.push(e);
      continue;
    }
    flush();
    arc.push({ fold: false, entry: showEntry(c, e, { usable, strengthOf, lineMatch, zone, feelingFilter, marks: marks.get(e.key) ?? [], day }) });
  }
  flush();
  const shownArc = arc.some((l) => !l.fold) ? arc : [];
  const faded = fadedIds.map((id) => usable(id)).filter((r) => r !== null).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)).map((r) => momentOf(r, zone));
  const subjectSet = new Set([...momentList.map((h) => h.row.id), ...fadedIds, ...copies.keys()]);
  const readingsAll = readingsFor(c, subjectSet, readingIds, usable, zone);
  const openAll = openFor(c, [...momentList.map((h) => h.row.id), ...fadedIds], usable, today, zone);
  const patterns = patternsOf(c, all, lens, feelingsAll, whose);
  const chapters = all.filter((e) => e.kind === "chapter");
  const sessions = all.filter((e) => e.kind === "session");
  const momentCount = all.reduce((n, e) => n + e.moments.length, 0);
  if (lens !== null && all.length > 0) {
    if (chapters.length === 0) {
      notes.push(sessions.some((e) => e.unplaced) ? `no chapter holds it: ${plural(momentCount, "moment")} outside any chapter` : `no chapter holds it: ${plural(momentCount, "moment")} from sessions that wrote none`);
    } else if (chapters.length <= 3) {
      const dates = chapters.map((e) => e.date).filter((d) => d !== null).sort();
      const first = dates[0];
      const last = dates[dates.length - 1];
      if (chapters.length === 1)
        notes.push("one chapter");
      else if (first !== undefined && last !== undefined && daysApart(first, last) <= 7)
        notes.push(`${plural(chapters.length, "chapter")}, all from one week`);
    }
    const feltAny = all.some((e) => e.moments.some((m) => (feelingsAll.get(m.row.id) ?? []).length > 0));
    if (!feltAny)
      notes.push("no feelings recorded");
  }
  const nothing = lens === null || all.length === 0 && faded.length === 0 && readingsAll.length === 0 && openAll.length === 0;
  if (bareName !== null) {
    noCard = nothing ? `No card for ${bareName} yet, and nothing in memory mentions ${bareName}` : `No card for ${bareName} yet; here is what mentions ${bareName}`;
  }
  const result = {
    mode: "meaning",
    reason: nothing ? "nothing-came" : "answered",
    semantic,
    noCard,
    lens,
    others: others.filter((o) => o.memories > 0),
    feeling: feelingAsked && ask !== null ? { words: [...ask.named], whose: ask.whose === null ? null : whose[ask.whose] } : null,
    counts: {
      chapters: chapters.length,
      sessions: sessions.length,
      unplaced: sessions.filter((e) => e.unplaced).length,
      moments: momentCount,
      faded: faded.length,
      readings: readingsAll.length,
      open: openAll.length
    },
    page,
    pages,
    arc: shownArc,
    faded: faded.slice(0, MEANING_FADED_SHOWN),
    readings: readingsAll.slice(-MEANING_READINGS_SHOWN),
    open: openAll.slice(0, MEANING_OPEN_SHOWN),
    patterns,
    notes,
    whose,
    shown: [],
    chars: 0,
    trimmed: false
  };
  return fit(result, opts.roomChars ?? MEANING_RESULT_CHARS);
}
function showEntry(c, e, opts) {
  const store = c.store;
  const own = [...e.moments].sort((a, b) => (opts.feelingFilter?.get(b.row.id) ?? b.weight) - (opts.feelingFilter?.get(a.row.id) ?? a.weight) || (opts.strengthOf.get(b.row.id) ?? 0) - (opts.strengthOf.get(a.row.id) ?? 0) || (a.row.created_at ?? 0) - (b.row.created_at ?? 0));
  let shown = own.slice(0, MEANING_MOMENTS_PER_CHAPTER).sort((a, b) => (a.row.created_at ?? 0) - (b.row.created_at ?? 0) || a.row.id.localeCompare(b.row.id)).map((h) => momentOf(h.row, opts.zone));
  let span = [];
  if (e.kind === "chapter" && e.episode !== null && e.session !== null && e.chapter !== null) {
    const t = chapterTimesOf(store, e.episode.id);
    if (t !== null) {
      span = safe(() => store.memoriesOfSession(e.session), []).filter((m) => chapterAt(t, m.at) === e.chapter).map((m) => opts.usable(m.id)).filter((r) => r !== null && !(r.source === "episode" && (r.origin_ref ?? "").startsWith("epi_")));
    }
  } else {
    span = e.moments.map((h) => h.row);
  }
  if (own.length === 0 && span.length > 0) {
    const have = new Set(shown.map((m) => m.id));
    const extra = span.filter((r) => !have.has(r.id)).map((r) => ({ r, p: safe(() => store.physicsOf(r.id), null) })).filter((x) => x.p !== null && !isFaded(x.p, opts.day)).map((x) => ({ r: x.r, s: strength(x.p, opts.day) })).sort((a, b) => b.s - a.s).slice(0, 2 - shown.length).map((x) => momentOf(x.r, opts.zone));
    shown = [...shown, ...extra];
  }
  shown = shown.map((m) => {
    const head = safe(() => headOf(store, m.id), null);
    if (head === null)
      return m;
    return { ...m, standing: opts.usable(head) === null ? "earlier (now a later version)" : earlierMark(head) };
  });
  const ids = [...new Set([...span.map((r) => r.id), ...e.moments.map((h) => h.row.id)])];
  const fs = [...safe(() => store.feelingsOn(ids), new Map).values()].flat();
  const ep = e.episode;
  const text = ep !== null && e.chapter !== null ? ep.chapters[e.chapter - 1]?.text ?? "" : "";
  return {
    address: e.key,
    kind: e.kind,
    unplaced: e.unplaced,
    episodeId: ep?.id ?? null,
    chapter: e.chapter,
    of: ep?.chapters.length ?? null,
    title: ep?.title ?? null,
    date: e.date,
    line: text.length === 0 ? "" : lineOf(text, opts.lineMatch, LINE_CHARS),
    hold: round2(e.hold),
    moments: shown,
    momentCount: e.moments.length,
    feelings: { self: topFeelings(fs, "self"), owner: topFeelings(fs, "owner") },
    marks: opts.marks
  };
}
function isFaded(p, day) {
  return hasFaded(p, day);
}
function topFeelings(fs, who) {
  const best = new Map;
  for (const f of fs) {
    if (f.whose !== who)
      continue;
    const word = feelingWord(f);
    best.set(word, Math.max(best.get(word) ?? 0, f.strength));
  }
  return [...best].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([word, s]) => ({ word, strength: round2(s) }));
}
function feelingWord(f) {
  if (f.emotion === OTHER_EMOTION)
    return f.other_word ?? "other";
  return wheelEntry(f.emotion)?.word ?? f.emotion.split(".").pop() ?? f.emotion;
}
function valenceSign(fs) {
  let sum = 0;
  let weight = 0;
  for (const f of fs) {
    sum += f.strength * feelingValence(f);
    weight += f.strength;
  }
  if (!(weight > 0))
    return 0;
  const v = sum / weight;
  return v > 0.15 ? 1 : v < -0.15 ? -1 : 0;
}
function rankOf(m) {
  if (m === undefined)
    return 3;
  if (m.includes("start") || m.includes("end"))
    return 0;
  if (m.includes("turn"))
    return 1;
  return 3;
}
function readingsFor(c, subject, linked, usable, zone) {
  const store = c.store;
  const out = new Map;
  for (const id of linked) {
    const r = usable(id);
    if (r !== null)
      out.set(id, r);
  }
  if (subject.size > 0) {
    for (const source of ["dreamed", "reflection"]) {
      for (const id of safe(() => store.list({ type: "memory", archived: false, source }), [])) {
        if (out.has(id))
          continue;
        const r = usable(id);
        if (r === null)
          continue;
        const meta = parseMeta(r.meta);
        const cited = source === "dreamed" ? meta["sources"] : meta["cites"];
        if (Array.isArray(cited) && cited.some((x) => typeof x === "string" && subject.has(x)))
          out.set(id, r);
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0) || a.id.localeCompare(b.id)).map((r) => ({
    id: r.id,
    by: r.source === "dreamed" ? "dreamed" : "reflected",
    date: r.created_at === null ? r.learned_on : localDay(r.created_at, zone) ?? r.learned_on,
    title: clip(oneLine(r.title ?? firstLine(r.body)), TITLE_CHARS),
    excerpt: clip(oneLine(r.body), 160)
  }));
}
function openFor(c, ids, usable, today, zone) {
  const dated = [];
  const open = [];
  for (const id of new Set(ids)) {
    const r = usable(id);
    if (r === null)
      continue;
    const title = clip(oneLine(r.title ?? firstLine(r.body)), TITLE_CHARS);
    const meta = r.event_date !== null && isDay(r.event_date) ? parseMeta(r.meta) : null;
    const rule = meta === null ? null : meta[RECURRING_META];
    if (r.event_date !== null && isRecurrence(rule)) {
      const next = occurrenceOnOrAfter(r.event_date, rule, today);
      if (next !== null) {
        dated.push({ id, title, why: "dated", date: next.date, every: readableRecurrence(r.event_date, rule), sort: next.date });
        continue;
      }
    }
    if (r.event_date !== null && calendarOverlaps(r.event_date, today, "9999-12-31")) {
      dated.push({ id, title, why: "dated", date: r.event_date, sort: r.event_date });
      continue;
    }
    if (parseMeta(r.meta)[UNRESOLVED_META_KEY] === true) {
      open.push({ id, title, why: "open", date: r.created_at === null ? emptyNull(r.learned_on) : localDay(r.created_at, zone), at: r.created_at ?? 0 });
    }
  }
  dated.sort((a, b) => a.sort.localeCompare(b.sort) || a.id.localeCompare(b.id));
  open.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return [...dated.map(({ sort: _s, ...x }) => x), ...open.map(({ at: _a, ...x }) => x)];
}
function patternsOf(c, all, lens, feelings, whose) {
  const n = all.length;
  if (n < 3)
    return { subjects: [], feelings: [] };
  const min = n <= 5 ? 2 : 3;
  const subjectIn = new Map;
  const feelingIn = new Map;
  let looked = 0;
  for (const e of all) {
    for (const h of e.moments) {
      if (looked < 600) {
        looked += 1;
        for (const s of safe(() => c.store.subjectsOf(h.row.id), [])) {
          if (lens?.kind === "card" && s === lens.id)
            continue;
          const set = subjectIn.get(s) ?? new Set;
          set.add(e.key);
          subjectIn.set(s, set);
        }
      }
      for (const f of feelings.get(h.row.id) ?? []) {
        const label = `${f.whose === "owner" ? whose.owner : whose.self} ${feelingWord(f)}`;
        const set = feelingIn.get(label) ?? new Set;
        set.add(e.key);
        feelingIn.set(label, set);
      }
    }
  }
  const subjects = [...subjectIn].filter(([, set]) => set.size >= min).map(([id, set]) => ({ label: safe(() => c.schemas.entity(id)?.name ?? null, null), entries: set.size })).filter((x) => x.label !== null).sort((a, b) => b.entries - a.entries || a.label.localeCompare(b.label)).slice(0, MEANING_PATTERNS_SHOWN).map((x) => ({ ...x, of: n }));
  const felt = [...feelingIn].filter(([, set]) => set.size >= min).map(([label, set]) => ({ label, entries: set.size, of: n })).sort((a, b) => b.entries - a.entries || a.label.localeCompare(b.label)).slice(0, MEANING_PATTERNS_SHOWN);
  return { subjects, feelings: felt };
}
function fit(r, room) {
  const levels = [
    (x) => x,
    (x) => ({ ...x, arc: mapEntries(x.arc, (e) => ({ ...e, moments: e.moments.slice(0, 2), line: clip(e.line, 140) })) }),
    (x) => ({
      ...x,
      arc: mapEntries(x.arc, (e) => ({ ...e, moments: e.moments.slice(0, 1), line: clip(e.line, 100) })),
      readings: x.readings.slice(-2).map((g) => ({ ...g, excerpt: clip(g.excerpt, 80) })),
      faded: x.faded.slice(0, 2),
      open: x.open.slice(0, 3)
    }),
    (x) => ({ ...x, patterns: { subjects: [], feelings: [] }, others: x.others.slice(0, 2), arc: mapEntries(x.arc, (e) => ({ ...e, line: clip(e.line, 60) })) })
  ];
  let cur = r;
  for (const level of levels) {
    cur = level(cur);
    const text = renderMeaning(cur);
    if (wireChars(text) <= room)
      return finish(cur, text, cur !== r);
  }
  let arc = cur.arc;
  while (arc.some((l) => !l.fold)) {
    const entries = arc.filter((l) => !l.fold);
    const victim = [...entries].sort((a, b) => a.entry.hold - b.entry.hold)[0];
    if (victim === undefined)
      break;
    arc = refold(arc, victim.entry.address);
    cur = { ...cur, arc };
    const text = renderMeaning(cur);
    if (wireChars(text) <= room)
      return finish(cur, text, true);
  }
  cur = { ...cur, readings: [], open: [], faded: [], patterns: { subjects: [], feelings: [] } };
  return finish(cur, renderMeaning(cur), true);
}
function finish(r, text, trimmed) {
  const shown = new Set;
  for (const l of r.arc) {
    if (l.fold)
      continue;
    if (l.entry.episodeId !== null)
      shown.add(l.entry.episodeId);
    for (const m of l.entry.moments)
      shown.add(m.id);
  }
  for (const m of r.faded)
    shown.add(m.id);
  for (const g of r.readings)
    shown.add(g.id);
  for (const o of r.open)
    shown.add(o.id);
  return { ...r, shown: [...shown], chars: wireChars(text), trimmed: r.trimmed || trimmed };
}
function mapEntries(arc, fn) {
  return arc.map((l) => l.fold ? l : { fold: false, entry: fn(l.entry) });
}
function refold(arc, address) {
  const out = [];
  for (const l of arc) {
    const asFold = l.fold ? l : l.entry.address === address ? { count: 1, from: l.entry.date, to: l.entry.date } : null;
    const prev = out[out.length - 1];
    if (asFold !== null && prev !== undefined && prev.fold) {
      out[out.length - 1] = { fold: true, count: prev.count + asFold.count, from: prev.from ?? asFold.from, to: asFold.to ?? prev.to };
    } else if (asFold !== null) {
      out.push({ fold: true, ...asFold });
    } else {
      out.push(l);
    }
  }
  return out;
}
export function renderMeaning(r) {
  const out = [];
  if (r.noCard !== null)
    out.push(`${r.noCard}.`);
  if (r.lens === null) {
    out.push("Nothing came: the question names no card, asks about no feeling, and none of its words reach a memory.");
    out.push("Try a person's or project's name, or facts mode for a single fact.");
    return out.join(`
`);
  }
  const head = [r.lens.name];
  if (r.counts.chapters > 0)
    head.push(plural(r.counts.chapters, "chapter"));
  const chapterless = r.counts.sessions - r.counts.unplaced;
  if (chapterless > 0)
    head.push(`${plural(chapterless, "session")} with no chapter`);
  if (r.counts.unplaced > 0)
    head.push(`${plural(r.counts.unplaced, "session")} with moments outside its chapters`);
  head.push(`${plural(r.counts.moments, "moment")}${r.counts.faded > 0 ? ` (+${String(r.counts.faded)} faded)` : ""}`);
  out.push(head.join(" · "));
  if (r.feeling !== null) {
    out.push(`feeling asked: ${r.feeling.words.length > 0 ? r.feeling.words.join(", ") : "any"} · ${r.feeling.whose ?? "both of us"}`);
  }
  const total = r.counts.chapters + r.counts.sessions;
  if (r.pages > 1) {
    const showing = r.arc.filter((l) => !l.fold).length;
    out.push(`${plural(total, "entry", "entries")} · page ${String(r.page)} of ${String(r.pages)}, showing ${String(showing)}${r.page < r.pages ? ` → page ${String(r.page + 1)}` : ""}`);
  }
  if (r.others.length > 0) {
    out.push(`also named: ${r.others.map((o) => `${o.name} (${plural(o.memories, "memory", "memories")})`).join(", ")} — ask about one by name for its arc`);
  }
  if (r.notes.length > 0)
    out.push(`note: ${r.notes.join("; ")}`);
  if (r.reason === "nothing-came") {
    out.push("Nothing holds it yet.");
    return out.join(`
`);
  }
  if (r.arc.length > 0) {
    out.push("");
    out.push("ARC (time order; a chapter opens by its episode id, a moment by its mem_ id)");
    for (const l of r.arc) {
      if (l.fold) {
        const span = l.from === null ? "" : l.to === null || l.to === l.from ? `, ${short(l.from)}` : `, ${short(l.from)} → ${short(l.to)}`;
        out.push(`  · ${plural(l.count, r.page === 1 ? "quieter entry" : "entry", r.page === 1 ? "quieter entries" : "entries")} not shown here${span}`);
        continue;
      }
      const e = l.entry;
      const where = e.kind === "chapter" ? `${e.address}${e.of !== null && e.of > 1 ? ` (chapter ${String(e.chapter)} of ${String(e.of)})` : ""}${e.title !== null ? ` "${clip(oneLine(e.title), 60)}"` : ""}` : `${e.address} · ${e.unplaced ? "not under a chapter (its chapters' moments unknown, or written after the last)" : "no chapter written"}`;
      const flags = e.marks.length > 0 ? ` · ${e.marks.join(", ")}` : "";
      out.push(`${e.date === null ? "undated" : e.date}  ${where}${flags}`);
      if (e.line.length > 0)
        out.push(`  ${e.line}`);
      const mine = e.feelings.self.map((f) => `${f.word} ${num(f.strength)}`).join(", ");
      const theirs = e.feelings.owner.map((f) => `${f.word} ${num(f.strength)}`).join(", ");
      if (mine.length > 0 || theirs.length > 0) {
        const sides = [mine.length > 0 ? `${r.whose.self}: ${mine}` : null, theirs.length > 0 ? `${r.whose.owner}: ${theirs}` : null].filter((x) => x !== null);
        out.push(`  feelings — ${sides.join(" | ")}`);
      }
      for (const m of e.moments)
        out.push(`  ${m.id}  ${m.standing === undefined ? "" : `${m.standing}: `}${m.title}`);
      if (e.momentCount > e.moments.length)
        out.push(`  (+${String(e.momentCount - e.moments.length)} more of its moments hold it)`);
    }
  }
  if (r.faded.length > 0) {
    out.push("");
    out.push(`FADED (${String(r.counts.faded)}; still readable by id)`);
    for (const m of r.faded)
      out.push(`  ${short(m.date)}  ${m.id}  ${m.title}`);
  }
  if (r.readings.length > 0) {
    out.push("");
    out.push(`EARLIER READINGS (${String(r.counts.readings)}${r.counts.readings > r.readings.length ? `, the newest ${String(r.readings.length)}` : ""})`);
    for (const g of r.readings)
      out.push(`  ${short(g.date)} ${g.by}  ${g.id}  ${g.title} — ${g.excerpt}`);
  }
  if (r.open.length > 0) {
    out.push("");
    out.push(`STILL OPEN (${String(r.counts.open)})`);
    for (const o of r.open)
      out.push(`  ${o.id}  ${o.title} · ${o.why === "dated" ? `dated ${o.date ?? "?"}${o.every === undefined ? "" : `, ${o.every}`}` : `open since ${o.date === null ? "?" : short(o.date)}`}`);
  }
  if (r.patterns.subjects.length > 0 || r.patterns.feelings.length > 0) {
    out.push("");
    out.push("RECURRING (across entries of the arc)");
    if (r.patterns.subjects.length > 0)
      out.push(`  with: ${r.patterns.subjects.map((p) => `${p.label} (${String(p.entries)} of ${String(p.of)})`).join(", ")}`);
    if (r.patterns.feelings.length > 0)
      out.push(`  feelings: ${r.patterns.feelings.map((p) => `${p.label} (${String(p.entries)} of ${String(p.of)})`).join(", ")}`);
  }
  return out.join(`
`);
}
function episodeIndex(c, owner, denied) {
  const store = c.store;
  const ids = safe(() => store.list({ type: "episode", archived: false }), []).filter((id) => !denied.has(id));
  const copies = owner ? null : safe(() => store.copiesOf(ids), null);
  const out = [];
  for (const id of ids) {
    try {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null || row.body.length === 0)
        continue;
      if (!owner && (row.confidential === 1 || copies === null || (copies.get(id) ?? []).some((x) => x.confidential)))
        continue;
      let session = row.origin_session;
      if (session === null || session.length === 0) {
        const s = parseMeta(row.meta)["sessionId"];
        session = typeof s === "string" ? s : null;
      }
      out.push({
        id,
        session,
        title: row.title === null || row.title.trim().length === 0 ? null : row.title,
        createdAt: row.created_at ?? 0,
        chapters: chaptersOf(row.body)
      });
    } catch {
      continue;
    }
  }
  return out;
}
function cardTerms(c, id) {
  try {
    const index = c.schemas.aliasIndex();
    const terms = index.termsFor(id);
    if (terms === undefined)
      return [];
    return [terms.name, ...terms.aliases].filter((t) => t.trim().length >= 2 && index.lookup(t).length === 1);
  } catch {
    return [];
  }
}
const SLOT_RANK = { about: 2, plain: 1, aside: 0 };
function mentionRank(m) {
  if (m.pronoun)
    return 1.5;
  return SLOT_RANK[m.slot] * 2 + (m.lowered ? 0 : 1);
}
function subjectOf(question, cards, o) {
  const live = cards.filter((x) => x.ids.length > 0);
  const mentions = [];
  for (const card of live) {
    for (const term of o.terms(card.id)) {
      const capital = term !== term.toLowerCase();
      for (const m of question.matchAll(nameRegex(term, "giu"))) {
        const lowered = capital && m[0] === m[0].toLowerCase();
        mentions.push({ card, at: m.index, end: m.index + m[0].length, slot: slotAt(question, m.index), pronoun: false, lowered });
      }
    }
  }
  if (o.ownerCard !== null && o.ownerPronoun !== null) {
    const asked = [...question.matchAll(o.ownerPronoun)].filter((m) => slotAt(question, m.index) === "about");
    const own = asked.length === 0 ? null : live.find((x) => x.id === o.ownerCard) ?? o.ownerCardOf();
    if (own !== null && own.ids.length > 0) {
      if (!live.includes(own))
        live.push(own);
      for (const m of asked) {
        mentions.push({ card: own, at: m.index, end: m.index + m[0].length, slot: "about", pronoun: true, lowered: false });
      }
    }
  }
  mentions.sort((a, b) => a.at - b.at || b.end - a.end);
  const kept = [];
  for (const m of mentions) {
    const prev = kept[kept.length - 1];
    if (prev !== undefined && m.at < prev.end)
      continue;
    kept.push(m);
  }
  const uncarded = uncardedNames(question, kept, o.ownerNames, o.cardWord);
  const inOrder = [...kept, ...uncarded].sort((a, b) => a.at - b.at);
  for (let i = 1;i < inOrder.length; i += 1) {
    const prev = inOrder[i - 1];
    const m = inOrder[i];
    if (JOINED.test(question.slice(prev.end, m.at)))
      m.slot = prev.slot;
  }
  const bare = (kept.length === 0 ? [] : uncarded).map((b) => ({ ...b, rank: mentionRank({ slot: b.slot, pronoun: false, lowered: false }) })).filter((b) => b.slot !== "aside");
  const bareBest = bare.reduce((r, b) => Math.max(r, b.rank), Number.NEGATIVE_INFINITY);
  const bareFirst = bare.find((b) => b.rank === bareBest)?.name ?? null;
  if (live.length === 0)
    return { card: null, alike: [], bare: bareFirst, bareAlike: [] };
  const place = new Map;
  for (const m of kept) {
    const had = place.get(m.card.id);
    const rank = mentionRank(m);
    if (had === undefined || rank > had.rank)
      place.set(m.card.id, { rank, at: m.at, length: m.end - m.at });
  }
  const placeOf = (x) => place.get(x.id) ?? { rank: -1, at: Number.POSITIVE_INFINITY, length: 0 };
  const best = Math.max(...live.map((x) => placeOf(x).rank));
  let field = live.filter((x) => placeOf(x).rank === best);
  if (bareFirst !== null && kept.every((m) => m.slot === "aside")) {
    return { card: null, alike: [], bare: bareFirst, bareAlike: [] };
  }
  if (field.length > 1 && o.ownerCard !== null)
    field = field.filter((x) => x.id !== o.ownerCard);
  field.sort((a, b) => {
    const pa = placeOf(a);
    const pb = placeOf(b);
    return pa.at - pb.at || pb.length - pa.length || b.ids.length - a.ids.length || a.name.localeCompare(b.name);
  });
  const [card, ...rest] = field;
  return {
    card: card ?? null,
    alike: rest.map((x) => x.name),
    bare: null,
    bareAlike: bare.filter((b) => b.rank >= best).map((b) => b.name)
  };
}
const CALENDAR_NAMES = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
]);
const TITLE_CASE_TELLS = new Set([
  "has",
  "have",
  "had",
  "is",
  "are",
  "was",
  "were",
  "been",
  "did",
  "does",
  "the",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "about",
  "from",
  "into",
  "than",
  "and",
  "or",
  "since",
  "what",
  "how",
  "when",
  "why",
  "where",
  "who",
  "this",
  "that",
  "it",
  "you",
  "your",
  "we",
  "our",
  "they",
  "their",
  "his",
  "her",
  "him",
  "them"
]);
function uncardedNames(question, taken, ownerNames, cardWord) {
  const proper = safe(() => askedNames(question), new Set);
  if (proper.size === 0)
    return [];
  if ([...proper].some((w) => TITLE_CASE_TELLS.has(w)))
    return [];
  const out = [];
  let run = null;
  const flush = () => {
    const r = run;
    if (r !== null)
      out.push({ name: r.parts.join(" "), at: r.at, end: r.end, slot: slotAt(question, r.at) });
    run = null;
  };
  for (const m of question.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*/g)) {
    const tok = m[0];
    const at = m.index;
    const end = at + tok.length;
    const word = tok.replace(/['’]s?$/, "");
    const low = word.toLowerCase();
    const isName = /^[A-Z]/.test(tok) && proper.has(tok.toLowerCase().replace(/['’]/g, "")) && !/\d/.test(word) && !/^[A-Z][A-Z]/.test(word) && !CALENDAR_NAMES.has(low) && !ownerNames.has(low) && !taken.some((t) => at < t.end && end > t.at) && !tokenize(word).some((w) => cardWord(w));
    const current = run;
    if (isName && current !== null && !current.closed && /^[ \t]+$/.test(question.slice(current.end, at))) {
      current.parts.push(word);
      current.end = end;
      current.closed = word !== tok;
      continue;
    }
    flush();
    if (isName)
      run = { at, end, parts: [word], closed: word !== tok };
  }
  flush();
  return out;
}
function nameTopic(name) {
  const typed = name.split(/\s+/).filter((w) => w.length > 0);
  return {
    words: typed.map((w) => w.toLowerCase()),
    names: new Map(typed.map((w) => [w.toLowerCase(), nameRegex(w, "gu")])),
    shown: [name]
  };
}
function slotAt(question, index) {
  const before = question.slice(0, index);
  if (ABOUT_BEFORE.some((re) => re.test(before)))
    return "about";
  return ASIDE_BEFORE.test(before) ? "aside" : "plain";
}
function andList(names) {
  if (names.length <= 1)
    return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
function contentWords(c, question, minLen, feelingNamed, skip = () => false) {
  const proper = safe(() => askedNames(question), new Set);
  const asTyped = new Map;
  for (const m of question.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*/g)) {
    const tok = m[0].replace(/['’]s?$/, "");
    const low = tok.toLowerCase();
    if (proper.has(low) && /^[A-Z]/.test(tok) && !asTyped.has(low))
      asTyped.set(low, tok);
  }
  const names = new Map;
  for (const [low, typed] of asTyped)
    names.set(low, nameRegex(typed, "gu"));
  const candidates = [...new Set(tokenize(question))].filter((w) => !skip(w) && (names.has(w) || w.length >= minLen && !FRAME.has(w) && !feelingNamed.has(w)));
  const out = (words) => ({ words, names, shown: words.map((w) => asTyped.get(w) ?? w) });
  if (candidates.length === 0)
    return out([]);
  const total = safe(() => c.store.countMemories({ archived: false }), 0);
  if (total < 20)
    return out(candidates);
  const df = safe(() => c.store.docFrequency(candidates), new Map);
  return out(candidates.filter((w) => names.has(w) || (df.get(w) ?? 0) <= total * COMMON_SHARE));
}
function namedCount(text, re) {
  re.lastIndex = 0;
  return (text.match(re) ?? []).length;
}
function holdByWords(store, topic, usable, hold) {
  const words = topic.words;
  const plain = words.filter((w) => !topic.names.has(w));
  const hits = safe(() => store.search(words.join(" "), MEANING_WORDS_MAX), []).filter((h) => {
    if (topic.names.size === 0)
      return true;
    const row = usable(h.id);
    if (row === null)
      return false;
    const text = `${row.title ?? ""}
${row.body}`;
    if ([...topic.names.values()].some((re) => namedCount(text, re) > 0))
      return true;
    const have = new Set(tokenize(text));
    return plain.some((w) => have.has(w));
  });
  const top = hits[0]?.score ?? 0;
  let held = 0;
  for (const h of hits) {
    if (top > 0 && usable(h.id) !== null) {
      hold(h.id, h.score / top);
      held += 1;
    }
  }
  const need = Math.max(1, Math.ceil(words.length / 2));
  const textMatch = (text) => {
    const have = new Set(tokenize(text));
    const n = words.filter((w) => {
      const re = topic.names.get(w);
      return re === undefined ? have.has(w) : namedCount(text, re) > 0;
    }).length;
    return n >= need ? n / words.length : 0;
  };
  const lineMatch = words.map((w) => {
    const re = topic.names.get(w);
    return re === undefined ? wholeWordRegex(w) : new RegExp(re.source, "u");
  });
  return { textMatch, lineMatch, held };
}
function feelingName(named, who, whose) {
  const words = [...named].filter((w) => w.length > 0);
  const what = words.length > 0 ? words.slice(0, 3).join(" / ") : "feelings";
  return who === null ? what : `${what} (${whose[who]})`;
}
function ownerDisplayName(c) {
  const name = safe(() => identityCoreName(c.store), null);
  return name === null || name.length < 2 ? null : name.split(/\s+/)[0] ?? null;
}
function ownerNamesLower(c) {
  const n = ownerDisplayName(c);
  return n === null ? [] : [n.toLowerCase()];
}
function momentOf(r, zone) {
  return {
    id: r.id,
    title: clip(oneLine(r.title !== null && r.title.trim().length > 0 ? r.title : firstLine(r.body)), TITLE_CHARS),
    date: (r.created_at === null ? null : localDay(r.created_at, zone)) ?? r.learned_on
  };
}
function lineOf(text, matchers, max) {
  const flat = oneLine(text.replace(/^#{1,6}[^\n]*$/gm, " ").replace(/[*_`>]+/g, ""));
  const sentences = flat.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const hit = sentences.find((s) => matchers.some((re) => re.test(s)));
  return clip(hit ?? sentences[0] ?? flat, max);
}
function parseMeta(meta) {
  try {
    const v = JSON.parse(meta || "{}");
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function localDay(at, zone) {
  const d = localDate(at, zone);
  return d.length === 0 ? null : d;
}
function emptyNull(s) {
  return s.length === 0 ? null : s;
}
function daysApart(a, b) {
  return safe(() => Math.abs(daysBetween(a, b)), Number.POSITIVE_INFINITY);
}
function short(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd.slice(5) : ymd;
}
function firstLine(body) {
  return body.split(`
`).find((l) => l.trim().length > 0) ?? body;
}
function oneLine(s) {
  return s.replace(/\s+/g, " ").trim();
}
function clip(s, max) {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
function plural(n, one, many = `${one}s`) {
  return `${String(n)} ${n === 1 ? one : many}`;
}
function num(x) {
  return x.toFixed(1).replace(/^0\./, ".");
}
function round2(x) {
  return Math.round(x * 100) / 100;
}
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
