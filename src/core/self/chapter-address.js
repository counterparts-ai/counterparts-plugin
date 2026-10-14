import { chaptersOf } from "../handoff/last-here.js";
import { CHAPTER_AT_META, chapterMoments } from "./episodes.js";
export const CHAPTER_MOMENT_GRACE_MS = 5 * 60000;
const ADDRESS = /^(epi_[^\s#/]+)#([1-9]\d*)$/;
export function chapterAddress(episodeId, n) {
  return `${episodeId}#${String(n)}`;
}
export function parseChapterAddress(text) {
  if (typeof text !== "string")
    return null;
  const m = ADDRESS.exec(text.trim());
  if (m === null)
    return null;
  return { episodeId: m[1], chapter: Number(m[2]) };
}
export function resolveChapter(store, address) {
  const parsed = parseChapterAddress(address);
  if (parsed === null)
    return { ok: false, reason: "not-an-address" };
  const row = store.row(parsed.episodeId);
  if (row === undefined || row.type !== "episode" || row.body.length === 0)
    return { ok: false, reason: "no-episode" };
  let meta = {};
  try {
    meta = store.readProse(parsed.episodeId).meta;
  } catch {
    return { ok: false, reason: "no-episode" };
  }
  const all = chaptersOf(row.body);
  const at = all[parsed.chapter - 1];
  if (at === undefined)
    return { ok: false, reason: "no-such-chapter", of: all.length };
  const { moments: written, from: momentsFrom } = chapterTimes(store, parsed.episodeId, meta, all.length, row.created_at);
  const to = written[parsed.chapter] ?? null;
  const from = parsed.chapter === 1 ? null : written[parsed.chapter - 1] ?? null;
  const session = typeof meta["sessionId"] === "string" ? meta["sessionId"] : null;
  const cuttable = to !== null && (parsed.chapter === 1 || from !== null);
  const moments = cuttable && session !== null ? momentsIn(store, session, parsed.episodeId, from, to) : [];
  return {
    ok: true,
    chapter: {
      address: chapterAddress(parsed.episodeId, parsed.chapter),
      episodeId: parsed.episodeId,
      chapter: parsed.chapter,
      of: all.length,
      heading: at.heading,
      text: at.text.trim(),
      date: at.date,
      session,
      title: row.title,
      span: { from, to },
      momentsFrom: cuttable ? momentsFrom : "unknown",
      moments
    }
  };
}
export function chapterTimesOf(store, episodeId) {
  try {
    const row = store.row(episodeId);
    if (row === undefined || row.type !== "episode" || row.body.length === 0)
      return null;
    const meta = store.readProse(episodeId).meta;
    const of = chaptersOf(row.body).length;
    const { moments, from } = chapterTimes(store, episodeId, meta, of, row.created_at);
    return { episodeId, of, moments, from };
  } catch {
    return null;
  }
}
export function chapterAt(times, at) {
  for (let k = 1;k <= times.of; k++) {
    const to = times.moments[k];
    if (to === undefined)
      continue;
    const from = k === 1 ? null : times.moments[k - 1];
    if (from === undefined)
      continue;
    const lo = from === null ? Number.NEGATIVE_INFINITY : from + CHAPTER_MOMENT_GRACE_MS;
    if (at > lo && at <= to + CHAPTER_MOMENT_GRACE_MS)
      return k;
  }
  return null;
}
function chapterTimes(store, episodeId, meta, count, createdAt) {
  const stored = meta[CHAPTER_AT_META] === undefined ? {} : chapterMoments(meta);
  const out = {};
  if (Object.keys(stored).length < count) {
    if (createdAt !== null)
      out[1] = createdAt;
    try {
      for (const v of store.versions(episodeId)) {
        if (v.reason !== "episode-chapter" || v.body.length === 0)
          continue;
        const held = chaptersOf(v.body).filter((c) => c.heading !== null).length;
        if (held >= 1 && held < count && out[held + 1] === undefined)
          out[held + 1] = v.archived_at;
      }
    } catch {}
  }
  for (const [k, v] of Object.entries(stored))
    out[Number(k)] = v;
  const from = Object.keys(stored).length > 0 ? "stored" : Object.keys(out).length > 0 ? "versions" : "unknown";
  return { moments: out, from };
}
function momentsIn(store, session, episodeId, from, to) {
  const lo = from === null ? Number.NEGATIVE_INFINITY : from + CHAPTER_MOMENT_GRACE_MS;
  const hi = to + CHAPTER_MOMENT_GRACE_MS;
  const out = [];
  try {
    for (const m of store.memoriesOfSession(session)) {
      if (m.at <= lo || m.at > hi)
        continue;
      const row = store.row(m.id);
      if (row === undefined || row.source === "episode")
        continue;
      let copy = false;
      try {
        copy = store.readProse(m.id).meta["episodeId"] === episodeId;
      } catch {
        copy = false;
      }
      if (!copy)
        out.push(m.id);
    }
  } catch {
    return [];
  }
  return out;
}
