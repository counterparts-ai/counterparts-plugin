import { reveal, revealHere } from "../reveal.js";
export const DREAM_LIMIT = 12;
export const CORE_HISTORY_LIMIT = 8;
const SEEN_WORDS = {
  excerpt: "seen as an excerpt",
  line: "seen only as a line",
  id: "seen only by its id",
  unseen: "not in that night's bundle"
};
function ref(src, id, here = false) {
  if (id === null)
    return null;
  const r = here ? revealHere(src.store, id, 90) : reveal(src.store, id, 90);
  return { id, text: r.text ?? r.label, confidential: r.confidential };
}
function detailOf(c) {
  try {
    const v = JSON.parse(c.detail);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
const idList = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
function changeView(src, c) {
  const d = detailOf(c);
  const memories = [];
  const fidelity = d["fidelity"] !== null && typeof d["fidelity"] === "object" ? d["fidelity"] : {};
  const push = (m) => {
    if (m === null || memories.some((x) => x.id === m.id))
      return;
    const f = fidelity[m.id];
    const seen = typeof f === "string" ? SEEN_WORDS[f] : undefined;
    memories.push(seen === undefined ? m : { ...m, seen });
  };
  let said;
  switch (c.action) {
    case "merge": {
      const { from: merged } = d;
      const originals = idList(merged);
      push(ref(src, c.ref));
      for (const f of originals)
        push(ref(src, f, true));
      said = `merged ${originals.length} near-copies into one`;
      break;
    }
    case "link":
      push(ref(src, c.ref));
      push(ref(src, c.ref2));
      said = "linked two memories";
      break;
    case "replayed":
      push(ref(src, c.ref));
      said = d["counted"] === true ? "replayed it (a return: it fades a little more slowly)" : "replayed it";
      break;
    case "gist":
      push(ref(src, c.ref));
      for (const s of idList(d["sources"]))
        push(ref(src, s));
      said = d["fold"] === true ? `folded ${String(idList(d["sources"]).length)} memories into what they add up to (${String(idList(d["faded"]).length)} faded under it)` : "wrote down a pattern, in its own words (dreamed; it starts low)";
      break;
    case "contradiction":
      push(ref(src, c.ref));
      push(ref(src, c.ref2));
      said = "flagged two memories that disagree (not settled — raised awake)";
      break;
    case "feeling-now":
      push(ref(src, c.ref));
      said = "recorded how an old feeling sits now";
      break;
    case "nominate-core":
      push(ref(src, c.ref));
      said = "nominated it for the core (only a lane promotes)";
      break;
    default:
      push(ref(src, c.ref));
      push(ref(src, c.ref2));
      said = c.action;
  }
  return { seq: c.seq, action: c.action, said, memories, undone: c.undone === 1 };
}
function dreamView(src, row) {
  const changes = src.store.dreamChanges(row.id);
  const counts = {};
  for (const c of changes) {
    if (c.undone !== 0)
      continue;
    const key = c.action === "gist" && detailOf(c)["fold"] === true ? "fold" : c.action;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return {
    id: row.id,
    date: row.date,
    day: row.day,
    state: row.state,
    title: row.title,
    journal: row.journal,
    counts,
    changes: changes.map((c) => changeView(src, c))
  };
}
export function dreamsView(src, limit = DREAM_LIMIT) {
  const shown = src.store.dreams({ limit });
  const total = Math.max(shown.length, src.store.dreamCount());
  return {
    dreams: shown.map((r) => dreamView(src, r)),
    total,
    more: total - shown.length,
    lastDreamed: shown[0] === undefined ? null : shown[0].date ?? `day ${String(shown[0].day)} of use`
  };
}
function historyRow(src, e) {
  const r = reveal(src.store, e.memory_id, 90);
  return {
    id: e.memory_id,
    text: r.text ?? r.label,
    confidential: r.confidential,
    day: e.day,
    lane: e.lane,
    reason: e.reason,
    dream: e.dream_id
  };
}
export function coreHistory(src, limit = CORE_HISTORY_LIMIT) {
  const of = (action) => src.store.coreEvents({ action, limit }).map((e) => historyRow(src, e));
  return { promoted: of("promoted"), demoted: of("demoted"), nominated: of("nominated") };
}
