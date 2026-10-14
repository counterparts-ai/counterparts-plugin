import { TUNABLES, pruneVerdict, strength } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import { compareCalendarDates, occurrenceOnOrAfter, readableRecurrence } from "../../../../core/time.js";
import { narrateForPanel } from "../narrate.js";
import { reveal, revealHere } from "../reveal.js";
import { feelingsShown } from "./memory-words.js";
import { MECHANISM_DAYS, MECHANISM_PROOFS, counted, payloadOf } from "./mechanisms.js";
import { LOG_CEILING, census } from "./shared.js";
export const PANEL_ACTIVITY = 4;
export const PICTURE_ROWS = 5;
const ACTIVITY_LOOKBACK = 200;
export const FADE_AHEAD = 60;
export const FADE_BEHIND = 60;
function said(src, id, width = 72) {
  const r = reveal(src.store, id, width);
  return { id, text: r.text ?? r.label, confidential: r.confidential };
}
function saidLine(m) {
  return { id: m.id, text: m.text, confidential: m.confidential };
}
export function mergeRepeats(lines) {
  const out = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (last !== undefined && last.text === line.text && last.name === line.name) {
      last.repeats += 1;
      last.fromDay = Math.min(last.fromDay, line.day);
    } else
      out.push({ ...line, repeats: 1, fromDay: line.day });
  }
  return out;
}
export function mechanismPanel(src, id) {
  const store = src.store;
  const livedDay = store.livedDay();
  const proof = MECHANISM_PROOFS.find((m) => m.id === id);
  if (proof === undefined)
    return { id, found: false, built: false, livedDay, activity: [], picture: null };
  if (proof.build === "not")
    return { id, found: true, built: false, livedDay, activity: [], picture: null };
  return { id, found: true, built: true, livedDay, activity: mechanismActivity(src, id), picture: pictureOf(src, id, livedDay) };
}
export function mechanismActivity(src, id) {
  const store = src.store;
  const proof = MECHANISM_PROOFS.find((m) => m.id === id);
  if (proof === undefined || proof.build === "not")
    return [];
  const backing = [];
  for (const p of proof.proofs) {
    for (const row of store.eventLog({ name: p.event, order: "desc", limit: ACTIVITY_LOOKBACK })) {
      if (counted(p, row, store) > 0)
        backing.push(row);
    }
  }
  const seen = new Set;
  const ordered = backing.sort((a, b) => b.seq - a.seq).filter((r) => seen.has(r.seq) ? false : (seen.add(r.seq), true));
  const lines = [];
  let groups = 0;
  let lastText = null;
  for (const row of ordered) {
    const line = narrateForPanel(id, store, row);
    if (line.text !== lastText) {
      groups += 1;
      lastText = line.text;
      if (groups > PANEL_ACTIVITY)
        break;
    }
    lines.push(line);
  }
  return mergeRepeats(lines).slice(0, PANEL_ACTIVITY);
}
function pictureOf(src, id, day) {
  switch (id) {
    case "decay":
      return decayPicture(src, day);
    case "retrieval":
      return retrievalPicture(src, day);
    case "consolidation":
      return consolidationPicture(src, day);
    case "salience":
      return saliencePicture(src, day);
    case "emotional":
      return emotionalPicture(src);
    case "association":
      return associationPicture(src);
    case "prospective":
      return prospectivePicture(src, day);
    case "dreaming":
      return dreamingPicture(src);
    case "episodic-semantic":
      return gistPicture(src);
    case "reconsolidation":
      return reconsolidationPicture(src);
    case "interference":
      return interferencePicture(src);
    default:
      return null;
  }
}
const windowStart = (day) => Math.max(0, day - (MECHANISM_DAYS - 1));
function standingDreams(src) {
  return src.store.dreams({ limit: 20 }).filter((d) => d.state !== "undone");
}
function decayPicture(src, day) {
  const store = src.store;
  const fading = census(src).filter((m) => !m.schema && !m.promoted && !m.unreadable);
  const picks = [];
  if (fading.length <= 4)
    picks.push(...fading);
  else {
    for (const q of [0, 0.35, 0.7, 1]) {
      const m = fading[Math.round(q * (fading.length - 1))];
      if (m !== undefined && !picks.includes(m))
        picks.push(m);
    }
  }
  const to = day + FADE_AHEAD;
  let from = day;
  const curves = picks.map((m) => {
    const physics = store.physicsOf(m.id);
    const curve = fadeCurve(physics, day);
    from = Math.min(from, curve.from);
    return { ...saidLine(m), kind: m.kind, band: m.band, lastUsedDay: physics.lastUsedDay, now: round(m.strength), points: curve.points, archiveDay: curve.archiveDay };
  });
  return {
    kind: "decay",
    day,
    from,
    to,
    semanticFloor: TUNABLES.THETA_SEM,
    archiveLine: TUNABLES.PHI_PRUNE,
    curves
  };
}
function idsOf(v) {
  if (!Array.isArray(v))
    return [];
  const out = [];
  for (const item of v) {
    if (typeof item === "string")
      out.push(item);
    else if (item !== null && typeof item === "object" && typeof item.id === "string") {
      out.push(item.id);
    }
  }
  return out;
}
function retrievalPicture(src, day) {
  const store = src.store;
  const turns = [];
  for (const row of store.eventLog({ name: "recall.decision", order: "desc", limit: ACTIVITY_LOOKBACK })) {
    const p = payloadOf(row);
    const surfaced = idsOf(p["surfaced"]);
    const footnotes = idsOf(p["footnotes"]);
    if (surfaced.length + footnotes.length === 0)
      continue;
    const memories = [
      ...surfaced.map((id) => ({ id, said: true })),
      ...footnotes.map((id) => ({ id, said: false }))
    ].slice(0, 6).map(({ id, said: aloud }) => ({ ...said(src, id, 64), said: aloud, usedSince: usedSince(src, id, row.day) }));
    const turn = typeof p["turn"] === "number" ? p["turn"] : 0;
    turns.push({ seq: row.seq, day: row.day, turn, memories });
    if (turns.length >= 3)
      break;
  }
  return { kind: "retrieval", turns, use: recallUse(src, day) };
}
function usedSince(src, id, day) {
  try {
    const physics = src.store.physicsOf(id);
    return physics.lastUsedDay >= day && physics.lastUsedDay > physics.birthDay;
  } catch {
    return false;
  }
}
export function recallUse(src, day, span = MECHANISM_DAYS) {
  const from = Math.max(0, day - (span - 1));
  const byDay = new Map;
  for (const row of src.store.eventLog({ name: "recall.decision", sinceDay: from, order: "desc", limit: LOG_CEILING })) {
    const p = payloadOf(row);
    let seen = byDay.get(row.day);
    if (seen === undefined) {
      seen = new Map;
      byDay.set(row.day, seen);
    }
    for (const id of idsOf(p["surfaced"]))
      seen.set(id, true);
    for (const id of idsOf(p["footnotes"]))
      if (!seen.has(id))
        seen.set(id, false);
  }
  const tally = { brought: 0, used: 0 };
  const saidT = { brought: 0, used: 0 };
  const footT = { brought: 0, used: 0 };
  const perDay = [];
  for (let d = from;d <= day; d++) {
    const seen = byDay.get(d);
    let brought = 0;
    let used = 0;
    for (const [id, aloud] of seen ?? []) {
      const u = usedSince(src, id, d);
      brought += 1;
      if (u)
        used += 1;
      const t = aloud ? saidT : footT;
      t.brought += 1;
      if (u)
        t.used += 1;
    }
    tally.brought += brought;
    tally.used += used;
    perDay.push({ day: d, brought, used });
  }
  return { ...tally, days: day - from + 1, said: saidT, footnote: footT, perDay };
}
function consolidationPicture(src, day) {
  const store = src.store;
  const since = windowStart(day);
  const counts = store.returnCounts({ sinceDay: since });
  const awake = [];
  const dream = [];
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || isJournal(row))
      continue;
    const woke = row.last_return_day !== null && row.last_return_day >= since;
    const dreamt = row.last_dream_day !== null && row.last_dream_day >= since;
    if (!woke && !dreamt)
      continue;
    const rets = store.returnsOf(id).filter((r) => r.day >= since);
    for (const [source, into] of [["awake", awake], ["dream", dream]]) {
      const mine = rets.filter((r) => r.source === source);
      if (mine.length > 0)
        into.push({ id, day: Math.max(...mine.map((r) => r.day)), times: mine.length });
    }
  }
  const merged = new Map;
  const addMerge = (id, at) => {
    const cur = merged.get(id);
    merged.set(id, { day: Math.max(cur?.day ?? at, at), times: (cur?.times ?? 0) + 1 });
  };
  let merges = 0;
  for (const row of store.eventLog({ name: "memory.merged", sinceDay: since, order: "desc", limit: LOG_CEILING })) {
    const kept = payloadOf(row)["originalId"];
    merges += 1;
    if (typeof kept === "string")
      addMerge(kept, row.day);
  }
  for (const d of standingDreams(src).filter((x) => x.day >= since)) {
    for (const c of store.dreamChanges(d.id)) {
      if (c.action !== "merge" || c.undone !== 0)
        continue;
      merges += 1;
      if (c.ref !== null)
        addMerge(c.ref, d.day);
    }
  }
  const newest = (a, b) => b.day - a.day || b.times - a.times || (a.id < b.id ? -1 : 1);
  const groups = [
    awake.sort(newest).map((r) => ({ ...r, how: "awake" })),
    [...merged.entries()].map(([id, m]) => ({ id, ...m })).sort(newest).map((r) => ({ ...r, how: "merged" })),
    dream.sort(newest).map((r) => ({ ...r, how: "dream" }))
  ];
  const seen = new Set;
  const picked = [];
  const take = (g, most) => {
    for (const r of g) {
      if (picked.length >= PICTURE_ROWS || most <= 0)
        return;
      if (seen.has(r.id))
        continue;
      seen.add(r.id);
      picked.push(r);
      most -= 1;
    }
  };
  take(groups[0], 3);
  take(groups[1], 1);
  take(groups[2], 1);
  for (const g of groups)
    take(g, PICTURE_ROWS);
  const order = { awake: 0, merged: 1, dream: 2 };
  const memories = picked.sort((a, b) => order[a.how] - order[b.how]).map((r) => ({ ...said(src, r.id), how: r.how, day: r.day, times: r.times }));
  return {
    kind: "consolidation",
    returns: { awake: counts.awake, dream: counts.dream, days: MECHANISM_DAYS },
    merges,
    memories
  };
}
function emotionalPicture(src) {
  const store = src.store;
  const out = [];
  const newestFirst = census(src).filter((m) => !m.schema && !m.unreadable).sort((a, b) => b.bornDay - a.bornDay || (a.id < b.id ? 1 : -1));
  for (const m of newestFirst) {
    const row = store.row(m.id);
    if (row === undefined)
      continue;
    const feelings = feelingsShown(store, m.id);
    if (!(row.emotional > 0 || feelings.some((f) => f.strength > 0)))
      continue;
    out.push({
      ...saidLine(m),
      bornDay: m.bornDay,
      emotional: round(row.emotional),
      feelings: [...feelings].sort((a, b) => b.strength - a.strength).slice(0, 2)
    });
    if (out.length >= PICTURE_ROWS)
      break;
  }
  return { kind: "emotional", memories: out };
}
function prospectivePicture(src, day) {
  const store = src.store;
  const since = windowStart(day);
  const rows = [
    ...store.eventLog({ name: "prospective.plain", sinceDay: since, order: "desc", limit: 200 }).map((r) => ({ r, plain: true })),
    ...store.eventLog({ name: "prospective.fire", sinceDay: since, order: "desc", limit: 200 }).map((r) => ({ r, plain: false }))
  ].sort((a, b) => b.r.seq - a.r.seq);
  const seen = new Set;
  const came = [];
  for (const { r, plain } of rows) {
    if (r.ref === null || seen.has(r.ref))
      continue;
    seen.add(r.ref);
    came.push({ ...said(src, r.ref), day: r.day, plain });
    if (came.length >= PICTURE_ROWS)
      break;
  }
  const today = store.getMeta("lastActiveDate");
  const from = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : "0001-01-01";
  for (const { r } of rows)
    if (r.ref !== null)
      seen.add(r.ref);
  const repeating = new Map;
  for (const r of store.recurringMemories()) {
    const next = occurrenceOnOrAfter(r.eventDate, r.recurring, from);
    if (next !== null)
      repeating.set(r.id, { date: next.date, repeats: readableRecurrence(r.eventDate, r.recurring) });
  }
  const ahead = [
    ...store.datedMemories(from, "9999-12-31").filter((d) => !repeating.has(d.id)).map((d) => ({ id: d.id, date: d.eventDate })),
    ...[...repeating].map(([id, r]) => ({ id, ...r }))
  ].filter((d) => !seen.has(d.id)).sort((a, b) => compareCalendarDates(a.date, b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const waiting = ahead.slice(0, Math.max(0, PICTURE_ROWS - came.length)).map((d) => ({ ...said(src, d.id), date: d.date, ...d.repeats === undefined || d.repeats === "" ? {} : { repeats: d.repeats } }));
  return { kind: "prospective", came, waiting, counts: { came: seen.size, waiting: ahead.length } };
}
const DREAM_DID = {
  merge: "merged near-copies into this",
  link: "linked it to another",
  replayed: "replayed it",
  gist: "wrote this pattern",
  contradiction: "flagged a disagreement",
  "feeling-now": "said how the feeling sits now",
  "nominate-core": "suggested it for the core"
};
function dreamingPicture(src) {
  const store = src.store;
  const last = standingDreams(src)[0];
  if (last === undefined)
    return { kind: "dreaming", dream: null, memories: [] };
  const changes = store.dreamChanges(last.id).filter((c) => c.undone === 0);
  const seen = new Set;
  const memories = [];
  for (const c of changes) {
    if (c.ref === null || seen.has(c.ref))
      continue;
    seen.add(c.ref);
    memories.push({ ...said(src, c.ref), did: DREAM_DID[c.action] ?? c.action });
    if (memories.length >= PICTURE_ROWS)
      break;
  }
  return {
    kind: "dreaming",
    dream: { id: last.id, date: last.date, day: last.day, title: last.title, changes: changes.length },
    memories
  };
}
function gistPicture(src) {
  const gists = [];
  for (const d of standingDreams(src)) {
    for (const c of src.store.dreamChanges(d.id)) {
      if (c.action !== "gist" || c.undone !== 0 || c.ref === null)
        continue;
      gists.push({ ...said(src, c.ref), day: d.day, date: d.date });
      if (gists.length >= PICTURE_ROWS)
        return { kind: "episodic-semantic", gists };
    }
  }
  return { kind: "episodic-semantic", gists };
}
function saliencePicture(src, day) {
  const since = windowStart(day);
  const written = census(src).filter((m) => !m.schema && !m.unreadable && m.bornDay >= since);
  const memories = written.sort((a, b) => b.salience - a.salience || b.bornDay - a.bornDay || (a.id < b.id ? -1 : 1)).slice(0, PICTURE_ROWS).map((m) => ({ ...saidLine(m), salience: round(m.salience), bornDay: m.bornDay, memKind: m.kind }));
  return { kind: "salience", memories, written: written.length, days: MECHANISM_DAYS };
}
function associationPicture(src) {
  const store = src.store;
  const weight = new Map;
  let links = 0;
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || isJournal(row))
      continue;
    for (const edge of store.edgesFrom(id)) {
      links += 1;
      for (const end of [id, edge.dst]) {
        const cur = weight.get(end) ?? { w: 0, d: 0 };
        cur.w += edge.weight;
        cur.d += 1;
        weight.set(end, cur);
      }
    }
  }
  const hubs = [...weight.entries()].sort((a, b) => b[1].w - a[1].w || (a[0] < b[0] ? -1 : 1)).slice(0, PICTURE_ROWS).map(([id, v]) => ({ ...said(src, id), weight: round(v.w), degree: v.d }));
  return { kind: "association", hubs, links };
}
function interferencePicture(src) {
  const pairs = src.store.contradictions({ limit: PICTURE_ROWS * 4 }).filter((p) => p.state !== "withdrawn" && p.via === null).slice(0, Math.max(1, Math.floor(PICTURE_ROWS / 2))).map((p) => ({
    id: p.id,
    day: p.settled_day ?? p.flagged_day,
    state: p.state,
    how: p.how,
    older: said(src, p.a),
    newer: said(src, p.b)
  }));
  return { kind: "interference", pairs };
}
function reconsolidationPicture(src) {
  const store = src.store;
  const revisions = store.eventLog({ name: "revision.pressure", order: "desc", limit: PICTURE_ROWS }).map((row) => {
    const p = payloadOf(row);
    const targetId = typeof p["targetId"] === "string" ? p["targetId"] : row.ref ?? "";
    const challengerId = typeof p["challengerId"] === "string" ? p["challengerId"] : "";
    const here = revealHere(store, targetId, 72);
    const pressure = typeof p["pressureAfter"] === "number" ? p["pressureAfter"] : 0;
    const bar = typeof p["bar"] === "number" ? p["bar"] : 0;
    return {
      seq: row.seq,
      day: row.day,
      target: { id: targetId, text: here.text ?? here.label, confidential: here.confidential },
      challenger: said(src, challengerId),
      pressure: round(pressure),
      bar: round(bar),
      crossed: bar > 0 && pressure >= bar
    };
  });
  return { kind: "reconsolidation", revisions };
}
export function fadeCurve(physics, day) {
  const from = Math.max(physics.lastUsedDay, day - FADE_BEHIND);
  const to = day + FADE_AHEAD;
  const points = [];
  let archiveDay = null;
  for (let d = from;d <= to; d++) {
    const s = strength(physics, d);
    points.push([d, round(s)]);
    if (archiveDay === null && d > day && s < TUNABLES.PHI_PRUNE)
      archiveDay = d;
  }
  return { from, to, points, archiveDay };
}
export function letGoDay(physics, day, horizon, recurring = false) {
  if (strength(physics, day + horizon) >= TUNABLES.PHI_PRUNE)
    return null;
  for (let d = day;d <= day + horizon; d++) {
    if (pruneVerdict(physics, d, { inLiveRevisionChain: false, recurring }).prune)
      return d;
  }
  return null;
}
function round(x) {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0;
}
