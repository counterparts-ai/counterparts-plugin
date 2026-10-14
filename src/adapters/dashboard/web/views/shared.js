import { band, sal, strength } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import { NEVER, NONE } from "../../layout.js";
import { gistOfDoc, reveal } from "../reveal.js";
export const FEED_LIMIT = 40;
export const LOG_CEILING = 20000;
export function census(src, opts = {}) {
  const store = src.store;
  const day = store.livedDay();
  const filter = opts.includeArchived === true ? {} : { archived: false };
  const out = [];
  for (const id of store.list(filter)) {
    const row = store.row(id);
    if (row === undefined)
      continue;
    if (isJournal(row))
      continue;
    try {
      const physics = store.physicsOf(id);
      const doc = store.readProse(id);
      const g = gistOfDoc(doc, 96);
      const live = band(physics, day);
      out.push({
        id,
        text: g.text,
        confidential: g.confidential,
        kind: row.kind,
        band: live,
        recordedBand: row.band,
        strength: strength(physics, day),
        salience: sal(physics.salience),
        uses: physics.uses,
        bornDay: physics.birthDay,
        lastUsedDay: physics.lastUsedDay,
        ageDays: Math.max(0, day - physics.birthDay),
        protected: physics.protected === true,
        promoted: physics.promotedIdentity === true,
        pressure: physics.pressure,
        archived: row.archived === 1 ? row.archived_reason ?? "archived" : null,
        schema: row.type === "schema",
        unreadable: false
      });
    } catch {
      out.push({
        id,
        text: reveal(store, id, 96).label,
        confidential: false,
        kind: row.kind,
        band: row.band,
        recordedBand: row.band,
        strength: 0,
        salience: 0,
        uses: 0,
        bornDay: 0,
        lastUsedDay: 0,
        ageDays: 0,
        protected: row.protected === 1,
        promoted: row.promoted_identity === 1,
        pressure: row.pressure,
        archived: row.archived === 1 ? row.archived_reason ?? "archived" : null,
        schema: row.type === "schema",
        unreadable: true
      });
    }
  }
  out.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  return out;
}
export function countMap(rows, key) {
  const m = new Map;
  for (const r of rows) {
    const v = r[key];
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}
export function absenceFor(count, everAsked) {
  if (count > 0)
    return null;
  return everAsked ? NONE : NEVER;
}
export function memoriesHeld(src) {
  return census(src).filter((r) => !r.schema).length;
}
export function memoriesLive(src) {
  return census(src).length;
}
export function eventCountsByName(src) {
  return new Map(src.store.eventCounts().map((c) => [c.name, c.count]));
}
