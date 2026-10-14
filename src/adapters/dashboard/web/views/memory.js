import { TUNABLES, band, emotionalIntensity, promotionEligibility, rep, sal, strength } from "../../../../core/physics/index.js";
import { DREAM_MERGE_REASON } from "../../../../core/dream/index.js";
import { feelingsLine } from "../../../feelings-line.js";
import { coreContextFor, isJournal } from "../../../../core/sleep/index.js";
import { WITHHELD, gistOfDoc, reveal, revealHere } from "../reveal.js";
import { archiveWords } from "./archive-words.js";
import { fadeCurve } from "./mechanism-panel.js";
import { chapterDate, feelingsShown, isChapterMemory, liftDate, repeatsOf, stripChapterLead } from "./memory-words.js";
import { readChapterLead } from "../../../../core/self/index.js";
import { LOG_CEILING } from "./shared.js";
import { isDay, localClockZone, localDate } from "../../../../core/time.js";
export function coreRoad(verdict) {
  const onlyNoLane = verdict.blockedBy.length === 1 && verdict.blockedBy[0] === "no-lane-yet";
  const blocked = verdict.blockedBy.includes("not-about-me") ? "not-about-me" : verdict.blockedBy.includes("demoted-by-owner") ? "demoted-by-owner" : null;
  return {
    byUse: onlyNoLane,
    days: verdict.slow.days,
    required: verdict.slow.needDays,
    span: verdict.slow.span,
    needSpan: verdict.slow.needSpan,
    holdShort: verdict.slow.strength !== null && verdict.slow.strength < verdict.slow.needStrength,
    oneReturn: onlyNoLane && !verdict.fast.met && verdict.fast.intensity >= verdict.fast.needIntensity,
    needGap: verdict.fast.needGap,
    lane: verdict.lane,
    eligible: verdict.eligible,
    blocked
  };
}
export function memoryDetail(src, id) {
  const store = src.store;
  const day = store.livedDay();
  const r = reveal(store, id, 120);
  const empty = {
    found: false,
    id,
    headId: r.headId,
    askedFor: null,
    journal: false,
    title: "",
    text: "",
    confidential: false,
    revision: 0,
    contentHash: "",
    kind: "fact",
    band: "episodic",
    recordedBand: "—",
    strength: 0,
    salience: { relevance: 0, emotional: 0, predictive: 0, novelty: null, claimed: null, combined: 0 },
    repetition: 0,
    uses: 0,
    reinforcedDays: 0,
    bornDay: 0,
    lastUsedDay: 0,
    learnedOn: "—",
    happenedOn: null,
    consolidated: false,
    promoted: false,
    protected: false,
    pressure: 0,
    bar: null,
    archived: null,
    removal: store.removalRecord(id).map((x) => ({ stage: x.stage, actor: x.actor, reason: x.reason, at: x.at })),
    edges: [],
    points: [],
    versions: [],
    prospective: [],
    feelingsLine: "",
    intensity: 0,
    absence: r.label,
    chapter: false,
    day,
    curve: null,
    curveNote: null,
    useDays: [],
    promotion: {
      byUse: false,
      days: 0,
      required: TUNABLES.CORE_SLOW_DAYS,
      span: 0,
      needSpan: TUNABLES.CORE_SLOW_SPAN_DAYS,
      holdShort: false,
      oneReturn: false,
      needGap: TUNABLES.CORE_FAST_GAP_DAYS,
      lane: null,
      eligible: false,
      blocked: null
    },
    feelings: [],
    model: null,
    eventDate: null,
    createdAt: null,
    writtenOn: null,
    writtenClock: null,
    archivedWords: null,
    timeline: [],
    shownText: "",
    writtenDate: null,
    about: null,
    aboutBy: null
  };
  if (!r.present || r.headId === null)
    return empty;
  const headId = r.headId;
  let doc;
  let row;
  let physics;
  try {
    doc = store.readProse(headId);
    row = store.row(headId);
    physics = store.physicsOf(headId);
  } catch {
    return empty;
  }
  const g = gistOfDoc(doc, 120);
  const chapter = row !== undefined && isChapterMemory(row);
  const journal = row === undefined ? false : isJournal(row);
  const verdict = promotionEligibility(physics, row !== undefined ? coreContextFor(store, { ...row, id: headId }, day) : { aboutMe: false, day });
  let curve = null;
  let curveNote = null;
  if (journal || chapter)
    curveNote = "a journal chapter — kept as written, not scored";
  else if (physics.promotedIdentity === true)
    curveNote = "in the core — it doesn't fade";
  else {
    const c = fadeCurve(physics, day);
    const repeats = row === undefined || row.archived === 1 ? null : repeatsOf(row);
    const kept = physics.protected === true;
    curve = {
      day,
      ...c,
      archiveDay: repeats === null && !kept ? c.archiveDay : null,
      archiveLine: TUNABLES.PHI_PRUNE,
      semanticFloor: TUNABLES.THETA_SEM,
      repeats,
      protected: kept
    };
  }
  const points = [];
  const push = (role, target) => {
    if (typeof target !== "string")
      return;
    const rr = reveal(store, target, 80);
    points.push({ role, id: target, text: rr.text ?? rr.label });
  };
  if (row?.superseded_by !== null && row?.superseded_by !== undefined)
    push("became", row.superseded_by);
  push("hangs on", doc.meta["entityId"]);
  push("revised", doc.meta["updates"]);
  const grounded = doc.meta["groundedIn"];
  if (Array.isArray(grounded))
    for (const gid of grounded)
      push("grounded in", gid);
  return {
    found: true,
    id: headId,
    headId,
    askedFor: headId === id ? null : id,
    journal,
    title: doc.title ?? "",
    text: g.confidential ? WITHHELD : doc.body.trim(),
    confidential: g.confidential,
    revision: row?.revision ?? 0,
    contentHash: g.confidential ? "" : row?.content_hash ?? "",
    kind: physics.kind,
    band: band(physics, day),
    recordedBand: `${row?.band ?? "—"} (set day ${row?.band_day ?? "—"})`,
    strength: strength(physics, day),
    salience: {
      relevance: physics.salience.relevance,
      emotional: physics.salience.emotional,
      predictive: physics.salience.predictive,
      novelty: physics.salience.novelty,
      claimed: physics.salience.claimed ?? null,
      combined: sal(physics.salience)
    },
    repetition: rep(physics),
    uses: physics.uses,
    reinforcedDays: physics.reinforcedDays ?? 0,
    bornDay: physics.birthDay,
    lastUsedDay: physics.lastUsedDay,
    learnedOn: doc.learnedOn,
    happenedOn: doc.happenedOn ?? null,
    consolidated: physics.consolidated === true,
    promoted: physics.promotedIdentity === true,
    protected: physics.protected === true,
    pressure: physics.pressure,
    bar: physics.pressure > 0 ? barFor(src, headId) : null,
    archived: row?.archived === 1 ? row.archived_reason ?? "archived" : null,
    removal: store.removalRecord(headId).map((x) => ({ stage: x.stage, actor: x.actor, reason: x.reason, at: x.at })),
    edges: store.edgesFrom(headId).map((edge) => {
      const rr = reveal(store, edge.dst, 72);
      return { id: edge.dst, text: rr.text ?? rr.label, weight: edge.weight, confidential: rr.confidential };
    }),
    points,
    versions: store.versions(headId).map((v) => ({
      seq: v.seq,
      reason: v.reason,
      day: v.version_day,
      became: v.successor_id === null ? "revised in place" : reveal(store, v.successor_id, 72).label
    })),
    prospective: store.prospectiveFor(headId).map((p) => ({
      date: p.event_date,
      state: p.state,
      fires: p.fires,
      precision: p.precision
    })),
    feelingsLine: g.confidential ? "" : feelingsLine(store.feelingsFor(headId), day - physics.birthDay),
    intensity: emotionalIntensity(physics),
    absence: null,
    chapter,
    day,
    curve,
    curveNote,
    useDays: useDaysOf(src, headId),
    promotion: coreRoad(verdict),
    feelings: feelingsWithCarry(src, headId, g.confidential),
    model: row?.model ?? null,
    eventDate: row?.event_date ?? null,
    createdAt: row?.created_at ?? null,
    ...writtenWhen(row?.created_at ?? null, doc.learnedOn, store.zone()),
    archivedWords: row?.archived === 1 ? archiveWords(row.archived_reason ?? null, row.superseded_by !== null) : null,
    timeline: timelineOf(src, headId, doc.meta["updates"]),
    ...cardWords(doc.body.trim(), chapter, g.confidential),
    about: row?.about ?? null,
    aboutBy: row?.about === null || row?.about === undefined ? null : row.about_by ?? null
  };
}
export function writtenWhen(createdAt, learnedOn, zone) {
  if (createdAt !== null && createdAt > 0) {
    return { writtenOn: localDate(createdAt, zone) || null, writtenClock: localClockZone(createdAt, zone) || null };
  }
  return { writtenOn: isDay(learnedOn) ? learnedOn : null, writtenClock: null };
}
function useDaysOf(src, id) {
  const days = new Set;
  let rows;
  try {
    rows = src.store.eventLog({ name: "recall.credit", order: "desc", limit: LOG_CEILING });
  } catch {
    return [];
  }
  for (const e of rows) {
    if (e.payload === null || !e.payload.includes(id))
      continue;
    try {
      const p = JSON.parse(e.payload);
      const ids = p["ids"];
      if (!Array.isArray(ids) || !ids.includes(id))
        continue;
      days.add(typeof p["day"] === "number" ? p["day"] : e.day);
    } catch {}
  }
  return [...days].sort((a, b) => a - b);
}
function feelingsWithCarry(src, id, confidential) {
  const words = feelingsShown(src.store, id);
  let rows = [];
  try {
    rows = src.store.feelingsFor(id);
  } catch {
    rows = [];
  }
  return words.map((f, i) => ({ ...f, carriedBy: confidential ? "" : rows[i]?.carried_by ?? "" }));
}
function timelineOf(src, id, updates) {
  const store = src.store;
  const steps = [];
  const words = (other) => {
    const rr = revealHere(store, other, 90);
    return { text: rr.text ?? rr.label, confidential: rr.confidential };
  };
  for (const other of store.list({ archived: true })) {
    if (other === id)
      continue;
    const o = store.row(other);
    if (o === undefined || o.superseded_by !== id)
      continue;
    const v = store.versions(other).find((x) => x.successor_id === id);
    steps.push({ rel: "replaced", id: other, ...words(other), day: v?.version_day ?? null, seq: null, ...why(v?.reason ?? o.archived_reason) });
  }
  if (typeof updates === "string" && updates !== id) {
    steps.push({ rel: "corrects", id: updates, ...words(updates), day: null, seq: null, reason: null, dream: false });
  }
  let became = null;
  for (const v of store.versions(id)) {
    if (v.successor_id === null) {
      steps.push({ rel: "revised", id: null, text: "its words were rewritten in place", confidential: false, day: v.version_day, seq: v.seq, ...why(v.reason) });
    } else {
      became = { rel: "became", id: v.successor_id, ...words(v.successor_id), day: v.version_day, seq: v.seq, ...why(v.reason) };
    }
  }
  const row = store.row(id);
  if (became === null && row !== undefined && row.superseded_by !== null) {
    became = { rel: "became", id: row.superseded_by, ...words(row.superseded_by), day: null, seq: null, ...why(row.archived_reason) };
  }
  if (became !== null)
    steps.push(became);
  return steps;
}
function why(reason) {
  const r = reason ?? null;
  return { reason: r, dream: r === DREAM_MERGE_REASON };
}
function barFor(src, id) {
  try {
    return src.schemas.story(id).bar;
  } catch {
    return null;
  }
}
function cardWords(body, chapter, confidential) {
  if (confidential)
    return { shownText: WITHHELD, writtenDate: null };
  if (chapter) {
    const lead = readChapterLead(body);
    const bare = stripChapterLead(lead.rest.trim());
    return { shownText: bare.rest || lead.rest.trim() || body, writtenDate: chapterDate(lead.date) ?? bare.date };
  }
  const lifted = liftDate(body);
  return { shownText: lifted.rest, writtenDate: lifted.date };
}
