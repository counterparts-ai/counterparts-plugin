import { CORE_EMOTIONS } from "../../../../core/feelings-wheel.js";
import { TUNABLES as PHYSICS, band as bandOf, strength as strengthOf } from "../../../../core/physics/index.js";
import { isEntityCard, isJournal, ownerNames } from "../../../../core/sleep/index.js";
import { rowToPhysics } from "../../../../core/store/index.js";
import { NEVER, NONE } from "../../layout.js";
import { BANDS, KINDS } from "../../registries.js";
import { displayName } from "../ask-voice.js";
import { WITHHELD, revealHere } from "../reveal.js";
import { archiveWords } from "./archive-words.js";
import { letGoDay } from "./mechanism-panel.js";
import { feelingsShown, firstSentence, isChapterMemory, repeatsOf, shownOf } from "./memory-words.js";
import { absenceFor, census, countMap } from "./shared.js";
import { todayView } from "./today.js";
export const NEAR_LET_GO_DAYS = 14;
export const FIRM_AHEAD_DAYS = 30;
export function holdOf(physics, day, opts) {
  if (physics.promotedIdentity === true || physics.protected === true)
    return "firm";
  if (opts.prunable && letGoDay(physics, day, NEAR_LET_GO_DAYS, opts.recurring === true) !== null)
    return "fading";
  if (strengthOf(physics, day + FIRM_AHEAD_DAYS) >= PHYSICS.THETA_SEM)
    return "firm";
  return "settling";
}
const KIND_GLOSS = {
  self: "who I am — salience only, and the slowest to be argued out of",
  person: "someone I know — salience carries it, repetition does not",
  entity: "a thing in the world — both arms count",
  skill: "how to do something — repetition is nearly all of it, and it erodes slowest",
  place: "somewhere — repetition-driven, slow to erode",
  fact: "a plain fact — erodes fastest, and the cheapest to overturn"
};
const KIND_PLAIN = {
  self: { label: "About me", what: "who I am", fades: "fade slowly", corrects: "hardest to argue out of" },
  person: { label: "People", what: "someone I know", fades: "fade slowly", corrects: "hard to correct" },
  entity: { label: "Things", what: "a thing in the world", fades: "fade fairly fast", corrects: "take some arguing to correct" },
  skill: { label: "Skills", what: "how to do something", fades: "fade slowest", corrects: "easy to correct" },
  place: { label: "Places", what: "somewhere", fades: "fade fairly fast", corrects: "easy to correct" },
  fact: { label: "Facts", what: "a plain fact", fades: "fade fastest", corrects: "easiest to correct" }
};
function fadeSpeed(kappa) {
  const all = KINDS.map((k) => PHYSICS.KINDS[k].kappa);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  return hi === lo ? 1 : 0.2 + 0.8 * ((kappa - lo) / (hi - lo));
}
export function memoriesView(src, opts = {}) {
  const store = src.store;
  const day = store.livedDay();
  const rows = census(src);
  const limit = opts.limit ?? 4000;
  const byKind = countMap(rows, "kind");
  const everLived = day > 0 || rows.length > 0;
  const meanByKind = new Map;
  for (const r of rows) {
    const list = meanByKind.get(r.kind) ?? [];
    list.push(r.strength);
    meanByKind.set(r.kind, list);
  }
  const steps = 10;
  const strengthByBand = Array.from({ length: steps }, (_, i) => ({
    from: i / steps,
    to: (i + 1) / steps,
    bands: Object.fromEntries(BANDS.map((b) => [b, 0]))
  }));
  for (const r of rows) {
    const step = strengthByBand[Math.min(steps - 1, Math.max(0, Math.floor(r.strength * steps)))];
    if (step !== undefined)
      step.bands[r.band] = (step.bands[r.band] ?? 0) + 1;
  }
  const hold = { firm: 0, settling: 0, fading: 0, journal: 0 };
  for (const m of rows) {
    const row = store.row(m.id);
    if (row !== undefined && isChapterMemory(row))
      hold.journal += 1;
    else if (m.unreadable)
      hold.settling += 1;
    else {
      try {
        hold[holdOf(store.physicsOf(m.id), day, {
          prunable: row === undefined || !isEntityCard(row),
          recurring: row !== undefined && repeatsOf(row) !== null
        })] += 1;
      } catch {
        hold.settling += 1;
      }
    }
  }
  return {
    day,
    total: rows.length,
    newToday: newTodayOf(src),
    owner: ownerOf(src),
    memories: rows.filter((r) => !r.schema).length,
    schemas: rows.filter((r) => r.schema).length,
    hold,
    nearLetGoDays: NEAR_LET_GO_DAYS,
    firmAheadDays: FIRM_AHEAD_DAYS,
    feelings: feelingsView(src, rows),
    strengthByBand,
    points: rows.slice(0, limit),
    pointsAbsent: rows.length === 0 ? everLived ? NONE : NEVER : null,
    kinds: KINDS.map((kind) => {
      const count = byKind.get(kind) ?? 0;
      const list = meanByKind.get(kind) ?? [];
      const tunables = PHYSICS.KINDS[kind];
      return {
        kind,
        count,
        meanStrength: list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length,
        absent: absenceFor(count, everLived),
        wSal: tunables.wSal,
        wRep: tunables.wRep,
        kappa: tunables.kappa,
        iota: tunables.iota,
        gloss: KIND_GLOSS[kind],
        plain: KIND_PLAIN[kind] ?? { label: kind, what: KIND_GLOSS[kind] ?? kind, fades: "", corrects: "" },
        fadeSpeed: fadeSpeed(tunables.kappa)
      };
    })
  };
}
function newTodayOf(src) {
  try {
    return todayView(src).newToday;
  } catch {
    return 0;
  }
}
export function ownerOf(src) {
  try {
    return displayName(ownerNames(src.store)[0] ?? null);
  } catch {
    return null;
  }
}
export function feelingsView(src, rows = census(src)) {
  const sides = new Map(CORE_EMOTIONS.map((c) => [c, { yours: side(), mine: side() }]));
  let carrying = 0;
  for (const m of rows) {
    const felt = feelingsShown(src.store, m.id);
    if (felt.length > 0)
      carrying += 1;
    for (const f of felt) {
      const at = sides.get(f.core);
      const s = f.whose === "owner" ? at?.yours : f.whose === "self" ? at?.mine : undefined;
      if (s === undefined)
        continue;
      s.count += 1;
      s.sum += Math.max(0, Math.min(1, f.strength));
      s.words.set(f.word, (s.words.get(f.word) ?? 0) + 1);
    }
  }
  return {
    carrying,
    owner: ownerOf(src),
    cores: CORE_EMOTIONS.map((core) => {
      const at = sides.get(core) ?? { yours: side(), mine: side() };
      return { core, yours: sideOut(at.yours), mine: sideOut(at.mine) };
    })
  };
}
const side = () => ({ count: 0, sum: 0, words: new Map });
function sideOut(s) {
  return {
    count: s.count,
    sum: Math.round(s.sum * 1000) / 1000,
    words: [...s.words.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : 1))
  };
}
export const LIST_MAX = 200;
function schemaRole(meta) {
  try {
    const m = JSON.parse(meta);
    if (m["role"] === "current-state")
      return "current state";
    if (typeof m["entityId"] === "string")
      return "belief";
    return "entity";
  } catch {
    return "entity";
  }
}
function versionKey(store, row) {
  if (isChapterMemory(row)) {
    try {
      const ep = JSON.parse(row.meta)["episodeId"];
      if (typeof ep === "string")
        return `episode:${ep}`;
    } catch {}
  }
  let next = row.superseded_by;
  if (next === null)
    return null;
  const seen = new Set;
  for (let i = 0;i < 50 && !seen.has(next); i++) {
    seen.add(next);
    const r = store.row(next);
    if (r === undefined || r.superseded_by === null)
      break;
    next = r.superseded_by;
  }
  return `head:${next}`;
}
function firstLine(body, width) {
  const line = body.split(`
`).map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith("#"));
  const t = line ?? body.trim();
  return t.length > width ? `${t.slice(0, width - 1).trimEnd()}…` : t;
}
export function memoryListView(src, opts = {}) {
  const store = src.store;
  const day = store.livedDay();
  const state = opts.state === "archived" || opts.state === "all" ? opts.state : "live";
  const kind = KINDS.includes(opts.kind) ? opts.kind : null;
  const band = BANDS.includes(opts.band) ? opts.band : null;
  const limit = Math.max(1, Math.min(LIST_MAX, Math.floor(opts.limit ?? 50)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const onlyCore = opts.core === true;
  const onlyJournal = opts.journal === true;
  const sort = opts.sort === "oldest" ? "oldest" : "newest";
  const word = typeof opts.feeling === "string" ? opts.feeling.trim().toLowerCase() : "";
  const feeling = word.length > 0 && (opts.whose === "owner" || opts.whose === "self") ? { word, whose: opts.whose } : null;
  const feelingCore = feeling === null && CORE_EMOTIONS.includes(opts.feelingCore ?? "") ? opts.feelingCore : null;
  const felt = (id) => {
    if (feeling === null && feelingCore === null)
      return true;
    return feelingsShown(store, id).some((f) => feeling !== null ? f.whose === feeling.whose && f.word.toLowerCase() === feeling.word : f.core === feelingCore);
  };
  const onlyHold = opts.hold === "firm" || opts.hold === "settling" || opts.hold === "fading" ? opts.hold : null;
  const all = [];
  let live = 0;
  let archived = 0;
  for (const id of store.list({})) {
    const row = store.row(id);
    if (row === undefined || isJournal(row))
      continue;
    const isArchived = row.archived === 1;
    if (isArchived)
      archived += 1;
    else
      live += 1;
    if (state === "live" && isArchived)
      continue;
    if (state === "archived" && !isArchived)
      continue;
    let b = row.band;
    let s = 0;
    const chapter = isChapterMemory(row);
    let hold = null;
    const repeats = isArchived || chapter ? null : repeatsOf(row);
    try {
      const physics = rowToPhysics(row);
      b = bandOf(physics, day);
      s = strengthOf(physics, day);
      if (!isArchived && !chapter)
        hold = holdOf(physics, day, { prunable: !isEntityCard(row), recurring: repeats !== null });
    } catch {
      if (!isArchived && !chapter)
        hold = "settling";
    }
    all.push({
      id,
      kind: row.kind,
      band: b,
      strength: s,
      bornDay: row.birth_day,
      learnedOn: row.learned_on,
      createdAt: row.created_at ?? null,
      archived: isArchived,
      core: row.promoted_identity === 1,
      journal: chapter,
      hold,
      repeats,
      group: isArchived ? versionKey(store, row) : null,
      versions: 1,
      cores: new Set(feelingsShown(store, id).map((f) => f.core))
    });
  }
  const kinds = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const bands = Object.fromEntries(BANDS.map((b) => [b, 0]));
  let core = 0;
  let journal = 0;
  const holds = { firm: 0, settling: 0, fading: 0 };
  const feelingCounts = Object.fromEntries(CORE_EMOTIONS.map((c) => [c, 0]));
  for (const r of all) {
    for (const c of r.cores)
      feelingCounts[c] = (feelingCounts[c] ?? 0) + 1;
    if (r.hold !== null)
      holds[r.hold] += 1;
    kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
    bands[r.band] = (bands[r.band] ?? 0) + 1;
    if (r.core)
      core += 1;
    if (r.journal)
      journal += 1;
  }
  const filtered = all.filter((r) => (kind === null || r.kind === kind) && (band === null || r.band === band) && (!onlyCore || r.core) && (!onlyJournal || r.journal) && (onlyHold === null || r.hold === onlyHold) && (feelingCore !== null && feeling === null ? r.cores.has(feelingCore) : felt(r.id)));
  const newestFirst = (a, b) => b.bornDay - a.bornDay || (b.createdAt ?? -1 / 0) - (a.createdAt ?? -1 / 0) || (a.learnedOn < b.learnedOn ? 1 : a.learnedOn > b.learnedOn ? -1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  filtered.sort(newestFirst);
  const lead = new Map;
  const matching = [];
  for (const r of filtered) {
    const first = r.group === null ? undefined : lead.get(r.group);
    if (first !== undefined) {
      first.versions += 1;
      continue;
    }
    if (r.group !== null)
      lead.set(r.group, r);
    matching.push(r);
  }
  if (sort === "oldest")
    matching.reverse();
  const rows = matching.slice(offset, offset + limit).map((r) => {
    const row = store.row(r.id);
    const here = revealHere(store, r.id, 160);
    let title = null;
    let line;
    let text;
    if (!here.present)
      line = text = here.label;
    else if (here.confidential)
      line = text = WITHHELD;
    else {
      const t = row?.title ?? null;
      title = t !== null && t.trim().length > 0 ? t.trim() : null;
      line = firstLine(row?.body ?? "", 160) || here.label;
      text = "";
    }
    const shown = shownOf(row?.body ?? "", {
      chapter: r.journal,
      learnedOn: r.learnedOn,
      confidential: here.confidential || !here.present,
      withheld: text
    });
    const words = r.journal && !here.confidential && here.present ? firstSentence(shown.text) : shown.text;
    return {
      id: r.id,
      title,
      line,
      confidential: here.confidential,
      kind: r.kind,
      band: r.band,
      strength: r.strength,
      bornDay: r.bornDay,
      livedDays: Math.max(0, day - r.bornDay),
      archived: r.archived ? archiveWords(row?.archived_reason ?? null, (row?.superseded_by ?? null) !== null) : null,
      archivedReason: r.archived ? row?.archived_reason ?? null : null,
      schema: row?.type === "schema",
      schemaRole: row?.type === "schema" ? schemaRole(row.meta) : null,
      text: words || line,
      date: shown.date,
      dateFrom: shown.dateFrom,
      core: r.core,
      protected: row?.protected === 1,
      journal: r.journal,
      feelings: feelingsShown(store, r.id),
      createdAt: r.createdAt,
      hold: r.hold,
      repeats: here.confidential || !here.present ? null : r.repeats,
      versions: r.versions
    };
  });
  const everLived = day > 0 || live + archived > 0;
  return {
    day,
    state,
    kind,
    band,
    core: onlyCore,
    journal: onlyJournal,
    hold: onlyHold,
    feeling,
    feelingCore,
    sort,
    offset,
    limit,
    total: matching.length,
    counts: { live, archived, kinds, bands, core, journal, hold: holds, feelings: feelingCounts },
    rows,
    absent: matching.length === 0 ? everLived ? NONE : NEVER : null
  };
}
