import { isJournal } from "../../../../core/sleep/index.js";
import { NONE } from "../../layout.js";
import { contestedBeliefs } from "../../stories.js";
import { reveal, revealHere } from "../reveal.js";
export const BAND_GLOSS = {
  episodic: "still an episode; forgettable, and most stay here",
  semantic: "settled into what I know",
  identity: "constitutive — and physics can still move it"
};
export function livedDays(src, id) {
  try {
    const physics = src.store.physicsOf(id);
    return { bornDay: physics.birthDay, lastUsedDay: physics.lastUsedDay };
  } catch {
    return { bornDay: 0, lastUsedDay: 0 };
  }
}
export function contestedRows(src) {
  const store = src.store;
  const out = [];
  for (const [rootId] of contestedBeliefs(src)) {
    if (rootId === undefined)
      continue;
    let story;
    try {
      story = src.schemas.story(rootId);
    } catch {
      continue;
    }
    const began = revealHere(store, rootId, FULL);
    const now = reveal(store, story.headId, FULL);
    const [beganShown, nowShown] = divergentPair(began.text ?? began.label, now.text ?? now.label);
    let about = NONE;
    try {
      const entityId = store.readProse(story.headId).meta["entityId"];
      if (typeof entityId === "string") {
        const r = reveal(store, entityId, 60);
        about = r.text ?? r.label;
      }
    } catch {
      about = NONE;
    }
    out.push({
      id: rootId,
      headId: story.headId,
      about,
      began: beganShown,
      now: nowShown,
      beganFull: began.text ?? began.label,
      nowFull: now.text ?? now.label,
      pressure: story.pressure,
      bar: story.bar,
      fraction: story.bar > 0 ? Math.min(1.4, story.pressure / story.bar) : 0,
      revised: story.headId !== rootId,
      challenges: story.increments.length,
      lastChallengedDay: story.lastChallengedDay
    });
  }
  return out.sort((a, b) => b.fraction - a.fraction || (a.id < b.id ? -1 : 1));
}
const FULL = 400;
function clipTo(text, width) {
  return text.length <= width ? text : `${text.slice(0, width - 1).trimEnd()}…`;
}
export function divergentPair(a, b, width = 150) {
  if (a === b)
    return [clipTo(a, width), clipTo(b, width)];
  let i = 0;
  const shared = Math.min(a.length, b.length);
  while (i < shared && a[i] === b[i])
    i += 1;
  let start = i;
  while (start > 0 && !/\s/.test(a[start - 1] ?? ""))
    start -= 1;
  const lead = Math.min(start, Math.floor(width / 3));
  const from = start - lead;
  const head = from > 0 ? "…" : "";
  return [`${head}${clipTo(a.slice(from), width)}`, `${head}${clipTo(b.slice(from), width)}`];
}
export function chapters(src, limit) {
  const store = src.store;
  const out = [];
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || !isJournal(row))
      continue;
    try {
      const doc = store.readProse(id);
      const body = doc.body.trim();
      const opening = firstSentences(body, 260);
      out.push({
        id,
        title: doc.title ?? "an unnamed chapter",
        day: doc.bornDay,
        bytes: new TextEncoder().encode(body).length,
        opening
      });
    } catch {
      out.push({ id, title: reveal(store, id, 60).label, day: 0, bytes: 0, opening: "" });
    }
  }
  return out.sort((a, b) => b.day - a.day || (a.id < b.id ? -1 : 1)).slice(0, limit);
}
function firstSentences(body, max) {
  const lines = body.split(`
`).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("<!--"));
  const joined = lines.join(" ");
  return joined.length <= max ? joined : `${joined.slice(0, max).trimEnd()}…`;
}
