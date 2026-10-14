import { parseCalendarDate } from "../time.js";
import { eraCarriedFrom } from "./operational.js";
export const SAID_BY = ["owner", "self", "inferred"];
export const STATUSES = ["done", "planned", "proposed", "asked"];
export function saidByOf(v) {
  return typeof v === "string" && SAID_BY.includes(v) ? v : null;
}
export function statusOf(v) {
  return typeof v === "string" && STATUSES.includes(v) ? v : null;
}
export function occurredOnOf(v) {
  return parseCalendarDate(v)?.text ?? null;
}
export function confidentialByMeta(meta) {
  if (meta["confidential"] === true)
    return true;
  const klass = meta["confidentiality"];
  return typeof klass === "string" && klass !== "" && klass !== "open" && klass !== "normal";
}
export const ABOUT_MARKS = ["me", "us", "owner", "work", "world"];
export const CORE_ABOUT_MARKS = ["me", "us", "owner"];
export const IDENTITY_ABOUT_MARKS = ["me", "us"];
export const IDENTITY_KINDS = ["self", "person", "entity"];
export const PLAN_STATUSES = ["planned", "proposed", "asked"];
export const ABOUT_SETTERS = ["writer", "reflection", "owner", "upgrade", "self"];
export function aboutMarkOf(v) {
  return typeof v === "string" && ABOUT_MARKS.includes(v) ? v : null;
}
export function inheritFrom(sources, opts = {}) {
  const best = opts.best ?? sources[0];
  if (best === undefined)
    return { about: null, era: {} };
  const personal = (r) => {
    const m = aboutMarkOf(r.about);
    return m !== null && CORE_ABOUT_MARKS.includes(m);
  };
  const marked = (r) => aboutMarkOf(r.about) !== null;
  const chosen = personal(best) ? best : sources.find(personal) ?? (marked(best) ? best : sources.find(marked) ?? best);
  const mark = aboutMarkOf(chosen.about);
  const by = chosen.about_by;
  const about = mark === null ? null : { about: mark, aboutBy: typeof by === "string" && ABOUT_SETTERS.includes(by) ? by : null, from: chosen.id };
  return {
    about,
    era: opts.cutoff === undefined ? {} : eraCarriedFrom({ created_at: best.created_at ?? null, meta: best.meta ?? "" }, opts.cutoff)
  };
}
const FOLD_PERSONAL_MARKS = ["me", "us"];
export function foldMarkFrom(sources) {
  const pick = (allowed) => {
    const counts = new Map;
    for (const s of sources) {
      const m = aboutMarkOf(s.about);
      if (m === null || !allowed(m))
        continue;
      const c = counts.get(m);
      if (c === undefined)
        counts.set(m, { n: 1, first: s });
      else
        c.n += 1;
    }
    let best = null;
    for (const c of counts.values())
      if (best === null || c.n > best.n)
        best = c;
    return best?.first ?? null;
  };
  const personal = sources.filter((s) => {
    const m = aboutMarkOf(s.about);
    return m !== null && FOLD_PERSONAL_MARKS.includes(m);
  }).length;
  const chosen = personal * 2 > sources.length ? pick((m) => FOLD_PERSONAL_MARKS.includes(m)) : pick((m) => !FOLD_PERSONAL_MARKS.includes(m));
  if (chosen === null)
    return null;
  const by = chosen.about_by;
  return {
    about: aboutMarkOf(chosen.about),
    aboutBy: typeof by === "string" && ABOUT_SETTERS.includes(by) ? by : null,
    from: chosen.id
  };
}
export function carryAboutMark(ops, fromId, toId) {
  ops.run(`UPDATE memories
        SET about = (SELECT about FROM memories WHERE id = ?),
            about_by = (SELECT about_by FROM memories WHERE id = ?)
      WHERE id = ? AND about IS NULL AND (SELECT about FROM memories WHERE id = ?) IS NOT NULL`, fromId, fromId, toId, fromId);
}
export function carryWriteFacts(ops, fromId, toId) {
  for (const col of ["occurred_on", "said_by", "status"]) {
    try {
      ops.run(`UPDATE memories SET ${col} = (SELECT ${col} FROM memories WHERE id = ?)
          WHERE id = ? AND ${col} IS NULL AND (SELECT ${col} FROM memories WHERE id = ?) IS NOT NULL`, fromId, toId, fromId);
    } catch {
      return;
    }
  }
}
