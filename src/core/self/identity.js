import { createHash } from "node:crypto";
import { strength } from "../physics/index.js";
import { isWorkMemory } from "./work.js";
export function hintReading(physics, display, day, t) {
  const lastReturn = physics.lastReturnDay ?? null;
  const organicUses = display === undefined ? physics.uses : Math.min(physics.uses, display.ever_uses + (physics.returnDays ?? 0));
  const anchor = display === undefined ? physics.lastUsedDay : Math.max(physics.birthDay, display.ever_last_used, lastReturn ?? -1 / 0);
  const organic = strength({ ...physics, uses: organicUses, lastUsedDay: anchor }, day);
  let load = 0;
  let habit = "fresh";
  if (display !== undefined && display.lane === "hints") {
    const leftOn = display.closed_day;
    if (leftOn !== null && lastReturn !== null && lastReturn > leftOn) {
      habit = "reset";
    } else {
      const stepped = display.shown_day === day;
      const stored = stepped ? Math.max(0, display.load - t.HINT_STEP) : display.load;
      load = stored * Math.exp(-Math.max(0, day - display.shown_day) / t.HINT_RECOVERY_DAYS);
      habit = load > 0 ? "habituated" : "fresh";
    }
  }
  const habituation = 1 / (1 + t.HINT_HABITUATION * load);
  const sameDay = display !== undefined && habit !== "reset" && display.shown_day === day;
  const nextLoad = sameDay ? display.load : load + t.HINT_STEP;
  return { score: organic * habituation, organic, load, habituation, habit, nextLoad };
}
export const RENDERED_PREFIX = "self.rendered.";
export function lastRenderedOf(store) {
  const out = new Map;
  for (const [key, value] of store.metaWithPrefix(RENDERED_PREFIX)) {
    const day = Number.parseInt(value, 10);
    if (Number.isFinite(day))
      out.set(key.slice(RENDERED_PREFIX.length), day);
  }
  return out;
}
export function reconsideringIds(store) {
  try {
    return new Set(store.coreReconsidering().map((r) => r.id));
  } catch {
    return new Set;
  }
}
export function scanActive(store, day) {
  const out = [];
  const rendered = lastRenderedOf(store);
  const displays = store.wakeDisplays();
  const flagged = reconsideringIds(store);
  for (const id of store.list({ type: "memory", archived: false })) {
    const s = scanOne(store, id, day, rendered, displays);
    if (s !== null)
      out.push(flagged.has(id) && s.band === "identity" ? { ...s, reconsidering: true } : s);
  }
  return out;
}
export function scanOne(store, id, day, rendered = new Map, displays = new Map) {
  const row = store.row(id);
  if (row === undefined || row.archived !== 0)
    return null;
  let doc;
  let physics;
  try {
    doc = store.readProse(id);
    physics = store.physicsOf(id);
  } catch {
    return null;
  }
  const display = displays.get(id);
  return {
    id,
    kind: physics.kind,
    band: row.band,
    physics,
    doc,
    strength: strength(physics, day),
    unresolved: doc.meta["unresolved"] === true,
    source: row.source,
    lastRendered: rendered.get(id) ?? -1,
    ...display === undefined ? {} : { display },
    day,
    about: row.about ?? null,
    originScope: row.origin_scope ?? null
  };
}
function byStrength(a, b) {
  if (b.strength !== a.strength)
    return b.strength - a.strength;
  if (a.bornDay !== b.bornDay)
    return a.bornDay - b.bornDay;
  return byContentThenId(a, b);
}
function byContentThenId(a, b) {
  const ka = a.tieKey ?? "";
  const kb = b.tieKey ?? "";
  if (ka !== kb)
    return ka < kb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function byRotation(day) {
  return (a, b) => {
    const ta = a.lastRendered === day;
    const tb = b.lastRendered === day;
    if (ta !== tb)
      return ta ? -1 : 1;
    if (a.lastRendered !== b.lastRendered)
      return a.lastRendered - b.lastRendered;
    return byStrength(a, b);
  };
}
function byThreadAge(a, b) {
  if (a.personScoped !== b.personScoped)
    return a.personScoped ? -1 : 1;
  if (a.bornDay !== b.bornDay)
    return a.bornDay - b.bornDay;
  return byContentThenId(a, b);
}
function byHint(a, b) {
  const sa = a.hint?.score ?? a.strength;
  const sb = b.hint?.score ?? b.strength;
  if (sb !== sa)
    return sb - sa;
  return byStrength(a, b);
}
export function rankedAs(s, lane, hint) {
  return {
    ...hint === undefined ? {} : { hint },
    id: s.id,
    lane,
    kind: s.kind,
    band: s.band,
    strength: s.strength,
    protected: s.physics.protected,
    bornDay: s.doc.bornDay,
    tieKey: createHash("sha256").update(s.doc.body).digest("hex"),
    personScoped: s.kind === "person",
    lastRendered: s.lastRendered
  };
}
export function rankLanes(scanned, horizonIn, t, opts = {}) {
  const identity = [];
  const craft = [];
  const threads = [];
  const reconsidering = [];
  const hints = [];
  const settledOver = opts.settledOver ?? new Set;
  const inIdentity = new Set(scanned.filter((s) => s.band === "identity").map((s) => s.id));
  const horizon = horizonIn.filter((h) => !inIdentity.has(h.id) && !settledOver.has(h.id));
  const arriving = new Set(horizon.map((h) => h.id));
  for (const s of scanned) {
    if (s.band === "identity" && s.reconsidering === true) {
      reconsidering.push(rankedAs(s, "threads"));
      continue;
    }
    if (s.band === "identity") {
      identity.push(rankedAs(s, "identity"));
      continue;
    }
    if (arriving.has(s.id) || settledOver.has(s.id))
      continue;
    if (s.unresolved) {
      threads.push(rankedAs(s, "threads"));
      continue;
    }
    if (opts.workAtDelivery === true && isWorkMemory({
      about: s.about ?? null,
      kind: s.kind,
      originScope: s.originScope ?? null,
      journal: typeof s.doc.meta["episodeId"] === "string"
    })) {
      continue;
    }
    if (s.strength < t.WARM_FLOOR)
      continue;
    if (s.kind === "skill") {
      craft.push(rankedAs(s, "craft"));
      continue;
    }
    if (opts.coveredByPage?.has(s.id) === true)
      continue;
    hints.push(rankedAs(s, "hints", hintReading(s.physics, s.display, s.day ?? s.doc.bornDay, t)));
  }
  identity.sort(byRotation(scanned.find((s) => s.day !== undefined)?.day));
  craft.sort(byStrength);
  threads.sort(byThreadAge);
  reconsidering.sort(byThreadAge);
  const turn = scanned.find((s) => s.day !== undefined)?.day ?? 0;
  const turns = reconsidering.length === 0 ? 0 : (turn % reconsidering.length + reconsidering.length) % reconsidering.length;
  const rotated = [...reconsidering.slice(turns), ...reconsidering.slice(0, turns)];
  const shownFlags = Math.min(rotated.length, t.RECONSIDERING_MAX);
  threads.unshift(...rotated.slice(0, shownFlags));
  const flagsWaiting = rotated.slice(shownFlags).map((r) => r.id);
  hints.sort(byHint);
  const past = (lane, cap) => lane.slice(cap).map((r) => r.id);
  return {
    identity: identity.slice(0, t.IDENTITY_MAX),
    craft: craft.slice(0, t.CRAFT_MAX),
    threads: threads.slice(0, t.THREADS_MAX),
    hints: hints.slice(0, t.HINTS_MAX),
    horizon: horizon.slice(0, t.HORIZON_MAX),
    overflow: {
      identity: past(identity, t.IDENTITY_MAX),
      craft: past(craft, t.CRAFT_MAX),
      threads: [...past(threads, t.THREADS_MAX), ...flagsWaiting],
      hints: past(hints, t.HINTS_MAX),
      horizon: [
        ...past(horizon, t.HORIZON_MAX),
        ...(opts.horizonMore ?? []).filter((id) => !inIdentity.has(id) && !settledOver.has(id) && !arriving.has(id))
      ]
    }
  };
}
export const ABSENT_TITLE = {
  removed: "[removed]",
  unreadable: "[unreadable]"
};
const encoder = new TextEncoder;
export function byteLength(s) {
  return encoder.encode(s).length;
}
function enumerateOne(store, id, day) {
  const row = store.row(id);
  if (row === undefined)
    return null;
  let doc;
  let physics;
  try {
    doc = store.readProse(id);
    physics = store.physicsOf(id);
  } catch {
    return null;
  }
  return {
    id,
    kind: physics.kind,
    band: row.band,
    strength: strength(physics, day),
    protected: physics.protected,
    promotedIdentity: physics.promotedIdentity,
    title: doc.title ?? null,
    bytes: byteLength(doc.body),
    absent: null
  };
}
function absentElement(id, why, was) {
  return {
    id,
    kind: was.kind,
    band: was.band,
    strength: 0,
    protected: was.protected,
    promotedIdentity: was.promotedIdentity,
    title: ABSENT_TITLE[why],
    bytes: 0,
    absent: why
  };
}
export function enumerate(store, day) {
  const identity = [];
  const guarded = [];
  const absences = [];
  const denied = new Set(store.deniedIds());
  const absentFromRow = (id, where) => {
    const why = denied.has(id) ? "removed" : "unreadable";
    const row = store.row(id);
    absences.push({ id, where, why });
    return absentElement(id, why, {
      kind: row?.kind ?? "fact",
      band: row?.band ?? "episodic",
      protected: row?.protected === 1,
      promotedIdentity: row?.promoted_identity === 1
    });
  };
  for (const id of store.list({ band: "identity", archived: false })) {
    const e = enumerateOne(store, id, day);
    identity.push(e ?? absentFromRow(id, "identity"));
  }
  for (const id of store.list({ archived: false })) {
    const e = enumerateOne(store, id, day);
    if (e === null) {
      const row = store.row(id);
      if (row?.protected === 1)
        guarded.push(absentFromRow(id, "protected"));
      continue;
    }
    if (e.protected)
      guarded.push(e);
  }
  const listed = new Set([...identity, ...guarded].map((e) => e.id));
  for (const gone of store.tombstones()) {
    const was = {
      kind: gone.kind,
      band: gone.band,
      protected: gone.wasProtected,
      promotedIdentity: gone.wasPromotedIdentity
    };
    if ((gone.wasPromotedIdentity || gone.band === "identity") && !listed.has(gone.id)) {
      identity.push(absentElement(gone.id, "removed", was));
      absences.push({ id: gone.id, where: "identity", why: "removed" });
    }
    if (gone.wasProtected && !guarded.some((e) => e.id === gone.id)) {
      guarded.push(absentElement(gone.id, "removed", was));
      absences.push({ id: gone.id, where: "protected", why: "removed" });
    }
  }
  identity.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  guarded.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  absences.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.where < b.where ? -1 : 1);
  const identityIds = new Set(identity.map((e) => e.id));
  return {
    day,
    identity,
    protected: guarded,
    both: guarded.filter((e) => identityIds.has(e.id)).map((e) => e.id),
    protectedOutsideIdentity: guarded.filter((e) => !identityIds.has(e.id)).map((e) => e.id),
    absences
  };
}
export const IDENTITY_CORE_ROLE = "entity";
export function findIdentityCore(store) {
  for (const id of store.list({ type: "schema", kind: "self", archived: false })) {
    try {
      if (store.readProse(id).meta["role"] === IDENTITY_CORE_ROLE)
        return id;
    } catch {
      continue;
    }
  }
  return null;
}
export function identityCoreName(store) {
  const id = findIdentityCore(store);
  if (id === null)
    return null;
  try {
    const doc = store.readProse(id);
    const name = doc.meta["name"];
    if (typeof name === "string" && name.trim().length > 0)
      return name.trim();
    const title = (doc.title ?? "").trim();
    return title.length > 0 ? title : null;
  } catch {
    return null;
  }
}
export function schemaBytes(store, day, t) {
  const seen = new Set;
  const weighed = [];
  let quarantined = 0;
  let quarantinedBytes = 0;
  let episodes = 0;
  let episodeBytes = 0;
  let migrated = 0;
  let migratedBytes = 0;
  for (const id of [
    ...store.list({ band: "identity", archived: false }),
    ...store.list({ kind: "self", archived: false })
  ]) {
    if (seen.has(id))
      continue;
    seen.add(id);
    const row = store.row(id);
    if (row !== undefined && row.type === "episode" && row.band !== "identity" && row.protected !== 1) {
      episodes += 1;
      const e = enumerateOne(store, id, day);
      if (e !== null)
        episodeBytes += e.bytes;
      continue;
    }
    if (row !== undefined && row.source === "migrated" && row.band !== "identity" && row.protected !== 1) {
      migrated += 1;
      const m = enumerateOne(store, id, day);
      if (m !== null)
        migratedBytes += m.bytes;
      continue;
    }
    if (row !== undefined && row.source === "fallback" && row.band !== "identity" && row.protected !== 1) {
      quarantined += 1;
      const q = enumerateOne(store, id, day);
      if (q !== null)
        quarantinedBytes += q.bytes;
      continue;
    }
    const e = enumerateOne(store, id, day);
    if (e !== null)
      weighed.push({ id, bytes: e.bytes });
  }
  const bytes = weighed.reduce((n, w) => n + w.bytes, 0);
  weighed.sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1));
  const pressureAt = Math.round(t.SCHEMA_BYTES_TRIP * t.SCHEMA_BYTES_PRESSURE);
  return {
    bytes,
    elements: weighed.length,
    trip: t.SCHEMA_BYTES_TRIP,
    pressureAt,
    pressure: bytes >= pressureAt,
    tripped: bytes >= t.SCHEMA_BYTES_TRIP,
    heaviest: weighed.slice(0, 5),
    quarantined,
    quarantinedBytes,
    episodes,
    episodeBytes,
    migrated,
    migratedBytes
  };
}
