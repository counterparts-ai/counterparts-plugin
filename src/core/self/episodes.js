import { isModelId } from "../types.js";
import { hashText } from "../store/index.js";
import { readableDate } from "./calendar.js";
export function intakeEpisode(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "NOT_AN_OBJECT" };
  }
  const rec = raw;
  const session = rec["sessionId"];
  if (typeof session !== "string" || session.trim().length === 0) {
    return { ok: false, reason: "SESSION_MISSING" };
  }
  if (rec["content"] === undefined || typeof rec["content"] !== "string") {
    return { ok: false, reason: "CONTENT_MISSING" };
  }
  if (rec["content"].trim().length === 0) {
    return { ok: false, reason: "CONTENT_EMPTY" };
  }
  const handles = rec["handles"];
  if (handles !== undefined && (!Array.isArray(handles) || handles.some((h) => typeof h !== "string"))) {
    return { ok: false, reason: "HANDLES_NOT_STRINGS" };
  }
  return { ok: true, proposal: rec };
}
export const NO_GATE = () => ({
  ok: false,
  gate: "none",
  reason: "NO_GATE_INJECTED"
});
export function stateKey(sessionId) {
  return `self.episode.${sessionId}`;
}
export function freshEpisodeState(sessionId, day) {
  return {
    sessionId,
    episodeId: null,
    chapters: 0,
    asks: 0,
    asksToday: 0,
    asksDay: null,
    appendedAtAsk: 0,
    lastAskAt: null,
    askedAtTurns: 0,
    askedAtBytes: 0,
    lastDay: day,
    ingestedKey: null,
    ingestedMemoryId: null,
    firstIngestDay: null
  };
}
export function loadEpisodeState(store, sessionId, day) {
  const raw = store.getMeta(stateKey(sessionId));
  if (raw === undefined)
    return { state: freshEpisodeState(sessionId, day), status: "absent" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || typeof parsed.chapters !== "number") {
      return { state: freshEpisodeState(sessionId, day), status: "unreadable" };
    }
    const merged = { ...freshEpisodeState(sessionId, day), ...parsed, sessionId };
    if (typeof parsed.asks !== "number")
      merged.asks = parsed.chapters;
    if (merged.episodeId === null)
      merged.chapters = 0;
    return { state: merged, status: "loaded" };
  } catch {
    return { state: freshEpisodeState(sessionId, day), status: "unreadable" };
  }
}
export function asksSpentOn(state, today) {
  return state.asksDay === today ? state.asksToday : 0;
}
export function askDue(state, substance, t, opts) {
  const sinceTurns = Math.max(0, substance.turns - state.askedAtTurns);
  const sinceBytes = Math.max(0, substance.bytes - state.askedAtBytes);
  const chapter = state.chapters + 1;
  const stretch = opts.unwritten ?? null;
  const shown = stretch === null ? {} : { unwritten: { pieces: stretch.pieces, minutes: stretch.minutes } };
  const no = (reason) => ({
    due: false,
    reason,
    chapter,
    sinceTurns,
    sinceBytes,
    ...shown
  });
  const yes = (reason) => ({ due: true, reason, chapter, sinceTurns, sinceBytes, ...shown });
  const unwrittenDue = () => {
    try {
      return stretch !== null && stretch.due(state.lastAskAt);
    } catch {
      return false;
    }
  };
  if (opts.observer)
    return no("observer");
  if (state.sessionId.trim().length === 0)
    return no("anonymous-session");
  if (asksSpentOn(state, opts.today) >= t.MAX_ASKS_PER_SESSION) {
    return unwrittenDue() ? yes("due-unwritten") : no("session-ask-cap");
  }
  if (state.asks === 0) {
    const paced = substance.turns >= t.FIRST_ASK_TURNS || substance.bytes >= t.FIRST_ASK_TEXT_BYTES;
    return paced ? yes("due-first") : unwrittenDue() ? yes("due-unwritten") : no("not-enough-substance");
  }
  const paced = sinceTurns >= t.REASK_TURNS || sinceBytes >= t.REASK_TEXT_BYTES;
  return paced ? yes("due-substance") : unwrittenDue() ? yes("due-unwritten") : no("not-enough-substance");
}
export function rebasedWatermark(state, substance) {
  if (!(substance.bytes >= state.askedAtBytes && substance.turns < state.askedAtTurns))
    return null;
  return { ...state, askedAtTurns: substance.turns };
}
export function askText(chapter) {
  return [
    chapter === 1 ? "Write this session's episode, in the first person — your voice, any length." : `Add chapter ${chapter} to this session's episode — in the moment, in your own voice.`,
    "You are the only one who can write it, and everything you don't write down is gone when the session closes.",
    "What happened, in order and in detail, the way a person keeps a diary: what was said, what was decided and why, what went wrong, what is still open — tender threads and debts without deadlines. Work status is not a thread.",
    "A line of how it felt belongs here; lessons and patterns belong to the nightly reflection.",
    "A short true episode beats a manufactured deep one; not every session changes you.",
    "Write for the next you, not as a report.",
    "When something significant happens later, append to it in the moment."
  ].join(`
`);
}
export function chapterHeading(chapter, day, date, model) {
  const said = date === undefined ? "" : readableDate(date);
  const by = model !== undefined && isModelId(model) ? model : "";
  const parts = [said, by].filter((p) => p.length > 0);
  return `## chapter ${chapter} — ${[...parts, `lived day ${day}`].join(" · ")}`;
}

export { isModelId };
export const CHAPTER_AT_META = "chapterAt";
export function chapterMoments(meta) {
  const raw = meta[CHAPTER_AT_META];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (/^\d+$/.test(k) && typeof v === "number" && Number.isFinite(v))
      out[k] = v;
  }
  return out;
}
export function chapterModels(meta) {
  const raw = meta["models"];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (/^\d+$/.test(k) && isModelId(v))
      out[k] = v;
  }
  return out;
}
const LEAD_HEADING = /^\s*#{1,6}[ \t]*chapter[ \t]+(\d+)(?:[ \t]*[—–-][ \t]*(?:([A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{4})[ \t]*·[ \t]*)?(?:([A-Za-z0-9][A-Za-z0-9._:[\]-]*)[ \t]*·[ \t]*)?lived day[ \t]+(\d+))?[ \t]*(?:\n|$)/i;
const ANY_HEADING = /^[ \t]*#{1,6}[ \t]*chapter[ \t]+(\d+)\b/gim;
export function readChapterLead(text) {
  let rest = text;
  let livedDay = null;
  let date = null;
  let model = null;
  for (let m = LEAD_HEADING.exec(rest);m !== null; m = LEAD_HEADING.exec(rest)) {
    if (livedDay === null && m[4] !== undefined)
      livedDay = Number(m[4]);
    if (date === null && m[2] !== undefined)
      date = m[2];
    if (model === null && m[3] !== undefined)
      model = m[3];
    rest = rest.slice(m[0].length);
  }
  const seen = new Set;
  for (const m of text.matchAll(ANY_HEADING))
    seen.add(Number(m[1]));
  return { chapters: [...seen].sort((a, b) => a - b), livedDay, date, model, rest: rest.trimStart() };
}
export const EPISODE_ABOUT_META = "about";
export function appendChapter(store, state, text, opts) {
  const opens = state.episodeId === null || state.asks > state.appendedAtAsk;
  const chapter = opens ? state.chapters + 1 : Math.max(1, state.chapters);
  const model = isModelId(opts.model) ? opts.model : undefined;
  const heading = chapterHeading(chapter, opts.day, opts.date, model);
  const body = `${heading}

${text.trim()}
`;
  if (state.episodeId === null) {
    const input = {
      type: "episode",
      kind: "self",
      body,
      meta: {
        sessionId: state.sessionId,
        chapters: chapter,
        ...model === undefined ? {} : { models: { [String(chapter)]: model } },
        [CHAPTER_AT_META]: { [String(chapter)]: store.now() },
        ...opts.about === undefined ? {} : { [EPISODE_ABOUT_META]: opts.about }
      },
      source: "episode",
      origin: { session: state.sessionId, ...opts.scope === undefined ? {} : { scope: opts.scope } },
      ...model === undefined ? {} : { model }
    };
    if (opts.title !== undefined)
      input.title = opts.title;
    if (opts.happenedOn !== undefined)
      input.happenedOn = opts.happenedOn;
    const id = store.put(input);
    return { episodeId: id, chapter, created: true, heading: true };
  }
  const prior = store.readProse(state.episodeId);
  const recorded = typeof prior.meta["chapters"] === "number" ? prior.meta["chapters"] : 0;
  const opensChapter = opens && chapter > recorded;
  const num = opensChapter ? chapter : Math.max(1, recorded);
  const models = chapterModels(prior.meta);
  if (opensChapter && model !== undefined)
    models[String(num)] = model;
  const moments = chapterMoments(prior.meta);
  if (opensChapter)
    moments[String(num)] = store.now();
  store.revise(state.episodeId, {
    body: `${prior.body.trimEnd()}

${opensChapter ? chapterHeading(num, opts.day, opts.date, model) + `

${text.trim()}
` : `${text.trim()}
`}`,
    meta: {
      sessionId: state.sessionId,
      chapters: Math.max(num, recorded),
      ...Object.keys(models).length === 0 ? {} : { models },
      ...Object.keys(moments).length === 0 ? {} : { [CHAPTER_AT_META]: moments },
      ...opts.about === undefined ? {} : { [EPISODE_ABOUT_META]: opts.about }
    },
    reason: opensChapter ? "episode-chapter" : "episode-append",
    ...model === undefined ? {} : { model }
  });
  return { episodeId: state.episodeId, chapter: num, created: false, heading: opensChapter };
}
export function ingestKey(episodeId, body) {
  return `${episodeId}:${hashText(body)}`;
}
export function findIngested(store, key) {
  for (const id of store.list({ type: "memory" })) {
    let doc;
    try {
      doc = store.readProse(id);
    } catch {
      continue;
    }
    if (doc.meta["episodeKey"] === key)
      return { id, doc };
  }
  return null;
}
export function memoriesForEpisode(store, episodeId) {
  const out = [];
  for (const id of store.list({ type: "memory", archived: false })) {
    try {
      if (store.readProse(id).meta["episodeId"] === episodeId)
        out.push(id);
    } catch {
      continue;
    }
  }
  return out;
}
