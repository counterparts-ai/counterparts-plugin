import { TUNABLES as PHYSICS_TUNABLES, consolidationEligibility, promote, promotionEligibility, strength } from "../physics/index.js";
import { IDENTITY_ABOUT_MARKS, IDENTITY_KINDS, LATER_FEELING_SOURCES, PLAN_STATUSES, defaultStrength, isSelfRelevantFeeling } from "../store/index.js";
import { rowToPhysics } from "../store/operational.js";
import { weighCore } from "./core-standing.js";
import { readCursor, resumeIndex, writeCursor } from "./markers.js";
import { PROMOTION_RECORD_PREFIX, TUNABLES } from "./tunables.js";
import { countSkip, emptyOutcome, isJournal } from "./types.js";
const CONSOLIDATE_PHASE = "consolidate";
export const CONSOLIDATION_SKIPS = [
  "archived",
  "removed",
  "journal",
  "not-legacy",
  "already-consolidated",
  "born-today",
  "below-semantic-floor"
];
export function promotionRecordKey(id) {
  return `${PROMOTION_RECORD_PREFIX}${id}`;
}
function isThePage(store, id) {
  try {
    return store.read(id).doc.meta["role"] === "page";
  } catch {
    return false;
  }
}
export function ownerNames(store) {
  const out = [];
  for (const id of store.list({ type: "schema", kind: "self", archived: false })) {
    try {
      const meta = store.read(id).doc.meta;
      if (meta["role"] !== "entity")
        continue;
      const add = (v) => {
        if (typeof v === "string" && v.trim().length >= 2)
          out.push(v.trim().toLowerCase());
      };
      add(meta["name"]);
      const aliases = meta["aliases"];
      if (Array.isArray(aliases))
        for (const a of aliases)
          add(a);
    } catch {
      continue;
    }
  }
  return [...new Set(out)];
}
function names(text, owner) {
  const lower = text.toLowerCase();
  for (const n of owner) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(lower))
      return true;
  }
  return false;
}
export function aboutMe(store, row, owner) {
  return identityBlock(store, row) === null;
}
export function identityBlock(store, row, opts = {}) {
  const mark = aboutMark(store, row);
  const unmarkedOk = opts.unmarkedPasses === true && (mark === null || mark === undefined);
  if (!unmarkedOk && (typeof mark !== "string" || !IDENTITY_ABOUT_MARKS.includes(mark)))
    return "not-about-me-or-us";
  if (!IDENTITY_KINDS.includes(row.kind))
    return "not-a-core-kind";
  if (isPlan(store, row))
    return "a-plan";
  return null;
}
function isPlan(store, row) {
  let status = row.status;
  if (status === undefined) {
    try {
      status = store.row?.(row.id)?.status ?? null;
    } catch {
      status = null;
    }
  }
  return typeof status === "string" && PLAN_STATUSES.includes(status);
}
function aboutMark(store, row) {
  if (row.about !== undefined)
    return row.about;
  try {
    return store.read(row.id).about ?? null;
  } catch {
    return;
  }
}
export function selfRelevantFeeling(store, row, acceptsReflected) {
  if (!IDENTITY_KINDS.includes(row.kind) || store.feelingsFor === undefined)
    return false;
  if (aboutMark(store, row) !== null || isPlan(store, row))
    return false;
  try {
    return store.feelingsFor(row.id).some((f) => f.whose === "self" && feelingIsStrong(f) && (f.source === null || f.source === "session" || LATER_FEELING_SOURCES.includes(f.source) && acceptsReflected) && isSelfRelevantFeeling(f.emotion, f.other_word));
  } catch {
    return false;
  }
}
export function feelingIsStrong(f) {
  if (!(f.strength >= 0))
    return false;
  if (f.strength >= PHYSICS_TUNABLES.CORE_FAST_FEELING)
    return true;
  const ownDefault = defaultStrength(f.core, f.emotion, f.other_word ?? null);
  return f.strength >= PHYSICS_TUNABLES.CORE_FAST_RELATIVE_FLOOR && f.strength - ownDefault >= PHYSICS_TUNABLES.CORE_FAST_ABOVE_DEFAULT - 0.000000001;
}
export function stronglyFelt(store, id, acceptsReflected) {
  if (store.feelingsFor === undefined)
    return false;
  try {
    return store.feelingsFor(id).some((f) => (acceptsReflected || !LATER_FEELING_SOURCES.includes(f.source)) && feelingIsStrong(f));
  } catch {
    return false;
  }
}
export function laterFeelingCarriers(store, id) {
  if (store.feelingsFor === undefined)
    return;
  try {
    const rows = store.feelingsFor(id);
    const out = [];
    for (const src of LATER_FEELING_SOURCES) {
      if (src !== "reflection" && src !== "awake")
        continue;
      if (rows.some((f) => f.source === src && feelingIsStrong(f)))
        out.push(src);
    }
    return out.length === 0 ? undefined : out;
  } catch {
    return;
  }
}
export function laterFeelingWasReflections(rec) {
  if (rec.feelingRecordedLater !== true)
    return false;
  const by = rec.feelingRecordedLaterBy;
  return !Array.isArray(by) || by.includes("reflection");
}
export function laterFeelingWasAwake(rec) {
  const by = rec.feelingRecordedLaterBy;
  return rec.feelingRecordedLater === true && Array.isArray(by) && by.includes("awake");
}
export function namesOwner(store, row, owner) {
  if (row.kind !== "person" || owner.length === 0)
    return false;
  try {
    const doc = store.read(row.id).doc;
    const meta = doc.meta;
    const fields = [doc.title ?? "", doc.body, String(meta["name"] ?? ""), String(meta["entity"] ?? "")];
    return fields.some((f) => f.length > 0 && names(f, owner));
  } catch {
    return false;
  }
}
export const REFLECTED_FEELING_KEY = "core.fast.acceptsReflectedFeeling";
export function acceptsReflectedFeeling(store) {
  const v = store.getMeta(REFLECTED_FEELING_KEY);
  if (v === "1" || v === "true" || v === "on")
    return true;
  if (v === "0" || v === "false" || v === "off")
    return false;
  return PHYSICS_TUNABLES.CORE_FAST_ACCEPTS_REFLECTED_FEELING;
}
export const SLOT_WALK_MAX = 12;
export function slotOf(store, id) {
  const out = [id];
  if (store.contradictionsOf === undefined)
    return out;
  const seen = new Set(out);
  for (let i = 0;i < out.length && out.length < SLOT_WALK_MAX; i++) {
    let pairs = [];
    try {
      pairs = store.contradictionsOf([out[i]]).get(out[i]) ?? [];
    } catch {
      pairs = [];
    }
    for (const p of pairs) {
      const sameThing = p.state === "settled" && p.how === "changed";
      if (!sameThing)
        continue;
      for (const other of [p.a, p.b]) {
        if (seen.has(other) || out.length >= SLOT_WALK_MAX)
          continue;
        seen.add(other);
        const r = store.row(other);
        if (r === undefined || r.archived === 1)
          continue;
        out.push(other);
      }
    }
  }
  return out;
}
const RECURRENCE_SOURCES = { awake: "full", reflection: "full", engaged: "engaged" };
function isFoldRow(row) {
  if (row.source !== "dreamed" || typeof row.meta !== "string" || !row.meta.includes('"fold"'))
    return false;
  try {
    return JSON.parse(row.meta)["fold"] === true;
  } catch {
    return false;
  }
}
const NOT_REENCODING = new Set(["dreamed", "reflection"]);
export function coreRecurrence(store, id, day) {
  const members = slotOf(store, id);
  const rows = members.map((m) => ({ id: m, row: store.row(m) }));
  let earlier = false;
  try {
    earlier = (store.contradictionsOf?.([id]).get(id) ?? []).some((p) => p.state === "settled" && p.how === "changed" && p.over === id);
  } catch {
    earlier = false;
  }
  let firstBorn = null;
  for (const { id: m, row } of rows) {
    if (row === undefined)
      continue;
    const r = rows.find((x) => x.id === firstBorn)?.row;
    if (firstBorn === null || r === undefined || row.birth_day < r.birth_day || row.birth_day === r.birth_day && (row.created_at ?? 0) < (r.created_at ?? 0))
      firstBorn = m;
  }
  let foldAt = null;
  for (const { row } of rows) {
    if (row === undefined || !isFoldRow(row))
      continue;
    const at = row.created_at ?? 0;
    if (foldAt === null || at < foldAt.at)
      foldAt = { at, day: row.birth_day };
  }
  const beforeFold = (row) => foldAt !== null && !isFoldRow(row) && (row.created_at ?? 0) < foldAt.at;
  const evidence = [];
  let anchored = false;
  for (const { id: m, row } of rows) {
    if (row === undefined)
      continue;
    const folded = beforeFold(row);
    let returns = [];
    try {
      returns = store.returnsOf?.(m) ?? [];
    } catch {
      returns = [];
    }
    for (const r of returns) {
      const kind = RECURRENCE_SOURCES[r.source];
      if (kind === undefined || typeof r.day !== "number")
        continue;
      if (folded && foldAt !== null && (typeof r.at === "number" ? r.at < foldAt.at : r.day <= foldAt.day))
        continue;
      if (m === id)
        anchored = true;
      evidence.push({ day: r.day, weight: kind === "full" ? 1 : PHYSICS_TUNABLES.ENGAGED_RECURRENCE_WEIGHT, session: r.session ?? null });
    }
    if (m !== firstBorn && !folded && !NOT_REENCODING.has(row.source ?? ""))
      evidence.push({ day: row.birth_day, weight: 1, session: row.origin_session ?? null });
  }
  const from = day - PHYSICS_TUNABLES.CORE_SLOW_WINDOW_DAYS;
  const byDay = new Map;
  const sessions = new Set;
  const namedDays = new Set;
  let lastEver = null;
  for (const e of evidence) {
    if (e.day > day)
      continue;
    lastEver = lastEver === null ? e.day : Math.max(lastEver, e.day);
    if (e.day <= from)
      continue;
    byDay.set(e.day, Math.max(byDay.get(e.day) ?? 0, e.weight));
    if (e.session !== null) {
      sessions.add(e.session);
      namedDays.add(e.day);
    }
  }
  let unnamed = 0;
  for (const d of byDay.keys())
    if (!namedDays.has(d))
      unnamed += 1;
  const days = [...byDay.keys()];
  let total = 0;
  let full = 0;
  for (const w of byDay.values()) {
    total += w;
    if (w >= 1)
      full += 1;
  }
  return {
    days: Math.round(total * 1000) / 1000,
    fullDays: full,
    sessions: sessions.size + unnamed,
    first: days.length === 0 ? null : Math.min(...days),
    last: days.length === 0 ? null : Math.max(...days),
    anchored,
    lastEver,
    ...earlier ? { earlier: true } : {}
  };
}
export function coreContextFor(store, row, day, opts = {}) {
  const reflected = opts.acceptsReflectedFeeling ?? acceptsReflectedFeeling(store);
  const about = aboutMe(store, row);
  const recognized = !about && selfRelevantFeeling(store, row, reflected);
  const candidate = about || recognized;
  const felt = candidate && stronglyFelt(store, row.id, reflected);
  const recurrence = candidate ? coreRecurrence(store, row.id, day) : undefined;
  return {
    aboutMe: about,
    ...recurrence === undefined ? {} : { recurrence },
    ...recognized ? { selfRelevantFeeling: true } : {},
    ...felt ? { stronglyFelt: true } : {},
    demoted: candidate ? store.coreDemoted?.(row.id) ?? false : false,
    acceptsReflectedFeeling: reflected,
    ...reflected || !candidate ? {} : { organicReturnDay: lastOrganicReturnDay(store, row.id) },
    day
  };
}
export function runConsolidate(ctx) {
  const out = emptyOutcome();
  for (const skip of CONSOLIDATION_SKIPS)
    out.skipped[skip] = 0;
  const promotionBlocked = {};
  const consolidated = [];
  const promoted = [];
  const reconsidering = [];
  const reaffirmed = [];
  const block = (reason) => {
    promotionBlocked[reason] = (promotionBlocked[reason] ?? 0) + 1;
    countSkip(out, `promotion:${reason}`);
  };
  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  const ids = store.list();
  const reflected = acceptsReflectedFeeling(store);
  const start = resumeIndex(ids, readCursor(store, CONSOLIDATE_PHASE));
  let visited = 0;
  let stoppedAt = null;
  const eligible = [];
  while (visited < ids.length) {
    if (out.examined >= ctx.budget) {
      out.budgetExhausted = true;
      out.skippedForBudget = ids.length - visited;
      break;
    }
    const id = ids[(start + visited) % ids.length];
    const index = visited + 1;
    visited += 1;
    stoppedAt = id;
    const row = store.row(id);
    if (row === undefined)
      continue;
    if (denied.has(id)) {
      countSkip(out, "removed");
      continue;
    }
    if (row.archived === 1) {
      countSkip(out, "archived");
      continue;
    }
    if (isJournal(row)) {
      countSkip(out, "journal");
      continue;
    }
    out.examined += 1;
    let p = rowToPhysics(row);
    const eligibility = consolidationEligibility(p, day);
    if (!eligibility.eligible) {
      countSkip(out, eligibility.reason);
    } else {
      if (ctx.apply)
        store.updatePhysics(id, { consolidated: true });
      p = { ...p, consolidated: true };
      consolidated.push(id);
      out.changed += 1;
      ctx.event("sleep.consolidated", id, { kind: p.kind, day });
      ctx.step("item", { index, id });
    }
    if (row.type === "schema" && row.kind === "self" && isThePage(store, id)) {
      block("self-page");
      continue;
    }
    if (p.promotedIdentity) {
      block("already-identity");
      const w = weighCore(store, row, day);
      if (w !== null) {
        if (ctx.apply)
          store.appendCoreEvent?.({ memoryId: id, action: w.action, day, reason: w.reason, actor: "sleep" });
        if (w.action === "reconsidering")
          reconsidering.push({ id, reason: w.reason });
        else
          reaffirmed.push(id);
        ctx.event(w.action === "reconsidering" ? "sleep.core.reconsidering" : "sleep.core.reaffirmed", id, { reason: w.reason, day });
      }
      continue;
    }
    const outcome = promote(p, day, coreContextFor(store, row, day, { acceptsReflectedFeeling: reflected }));
    if (!outcome.promoted || outcome.crossing === null) {
      for (const reason of outcome.verdict.blockedBy)
        block(reason);
      continue;
    }
    eligible.push({ id, index, crossing: outcome.crossing, strength: strength(p, day), physics: p });
  }
  eligible.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  const cap = TUNABLES.CORE_MAX_PER_SLEEP;
  for (const [i, e] of eligible.entries()) {
    if (i >= cap) {
      block("cap");
      continue;
    }
    const sources = returnSourcesOf(store, e.id);
    const closed = reflected ? promotionEligibility(e.physics, { aboutMe: true, day, acceptsReflectedFeeling: false, stronglyFelt: stronglyFelt(store, e.id, false) }) : null;
    const later = closed !== null && !closed.fast.met && !closed.slow.met;
    const by = later ? laterFeelingCarriers(store, e.id) : undefined;
    const record = {
      id: e.id,
      ...e.crossing,
      returnSources: sources,
      reflectionOnly: sources.reflection > 0 && sources.awake === 0,
      feelingRecordedLater: later,
      ...by === undefined ? {} : { feelingRecordedLaterBy: by }
    };
    if (ctx.apply) {
      store.setMeta(promotionRecordKey(e.id), JSON.stringify(record));
      store.appendEvent?.({
        name: record.event,
        day,
        ref: e.id,
        dedupKey: promotionRecordKey(e.id),
        payload: { ...record }
      });
      store.appendCoreEvent?.({ memoryId: e.id, action: "promoted", day, lane: record.lane, actor: "sleep" });
      store.updatePhysics(e.id, { promotedIdentity: true });
      store.setBand(e.id, "identity", day);
    }
    promoted.push(record);
    out.changed += 1;
    ctx.event("sleep.promoted", e.id, {
      kind: record.kind,
      lane: record.lane,
      intensity: record.intensity,
      returnDays: record.returnDays,
      day
    });
    ctx.step("item", { index: e.index, id: e.id });
  }
  if (ctx.apply && stoppedAt !== null)
    writeCursor(store, CONSOLIDATE_PHASE, stoppedAt);
  return { ...out, consolidated, promoted, reconsidering, reaffirmed, promotionBlocked };
}
function lastOrganicReturnDay(store, id) {
  let last = null;
  try {
    for (const r of store.returnsOf?.(id) ?? []) {
      if (r.source === "awake" && typeof r.day === "number" && (last === null || r.day > last))
        last = r.day;
    }
  } catch {}
  return last;
}
function returnSourcesOf(store, id) {
  let awake = 0;
  let reflection = 0;
  try {
    for (const r of store.returnsOf?.(id) ?? []) {
      if (r.source === "awake")
        awake += 1;
      else if (r.source === "reflection")
        reflection += 1;
    }
  } catch {}
  return { awake, reflection };
}
