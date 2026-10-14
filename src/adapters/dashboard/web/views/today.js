import { isJournal } from "../../../../core/sleep/index.js";
import { reveal } from "../reveal.js";
import { isChapterMemory } from "./memory-words.js";
export const TODAY_LINES = 6;
export const TODAY_LOOKBACK = 30;
function writtenOn(src, from) {
  const out = new Map;
  for (const id of src.store.list({ archived: false })) {
    const row = src.store.row(id);
    if (row === undefined || row.type !== "memory" || isJournal(row) || isChapterMemory(row))
      continue;
    if (row.birth_day < from)
      continue;
    const list = out.get(row.birth_day) ?? [];
    list.push({ id, at: typeof row.created_at === "number" ? row.created_at : 0 });
    out.set(row.birth_day, list);
  }
  return out;
}
function words(src, id) {
  const r = reveal(src.store, id, 90);
  if (r.confidential)
    return { text: "", confidential: true };
  const title = r.headId === null ? null : (src.store.row(r.headId)?.title ?? "").trim();
  return { text: title || wordEnd(r.text ?? r.label), confidential: false };
}
export function wordEnd(text) {
  if (!text.endsWith("…"))
    return text;
  const cut = text.slice(0, -1).replace(/\s+\S*$/, "").replace(/[\s,;:—-]+$/, "");
  return cut.length > 0 ? `${cut}…` : text;
}
export function todayView(src) {
  const store = src.store;
  const today = store.livedDay();
  const from = Math.max(0, today - TODAY_LOOKBACK);
  const written = writtenOn(src, from);
  const promoted = store.coreEvents({ action: "promoted", limit: 200 }).filter((e) => e.day >= from);
  const dreams = store.dreams({ limit: 40 }).filter((d) => d.state === "journaled" && d.day >= from);
  const pruned = store.eventLog({ name: "memory.pruned", sinceDay: from, order: "desc", limit: 2000 });
  const specialsOn = (day) => {
    const out = [];
    for (const e of promoted) {
      if (e.day !== day)
        continue;
      const w = words(src, e.memory_id);
      out.push({
        line: {
          kind: "core",
          text: w.confidential ? "A private memory became part of who I am" : `“${w.text}” became part of who I am`,
          confidential: w.confidential,
          to: { hash: "self/settling" }
        },
        at: e.at
      });
    }
    const dream = dreams.find((d) => d.day === day);
    if (dream !== undefined) {
      const title = (dream.title ?? "").trim();
      out.push({
        line: { kind: "dream", text: title ? `Dreamed: ${title}` : "Dreamed", confidential: false, to: { hash: "self/dreams" } },
        at: dream.finished_at ?? dream.started_at
      });
    }
    const gone = pruned.filter((e) => e.day === day);
    if (gone.length > 0) {
      const w = gone.length === 1 && gone[0].ref !== null ? words(src, gone[0].ref) : null;
      out.push({
        line: {
          kind: "let-go",
          text: gone.length > 1 ? `Let go of ${gone.length} memories that had faded` : w !== null && !w.confidential && w.text ? `Let go of “${w.text}” — it had faded` : "Let go of a memory that had faded",
          confidential: false,
          to: { hash: "memories?state=archived" }
        },
        at: gone[0].at
      });
    }
    return out;
  };
  let day = today;
  let specials = specialsOn(today);
  let mine = written.get(today) ?? [];
  if (specials.length === 0 && mine.length === 0) {
    for (let d = today - 1;d >= from; d--) {
      const s = specialsOn(d);
      const w = written.get(d) ?? [];
      if (s.length > 0 || w.length > 0) {
        day = d;
        specials = s;
        mine = w;
        break;
      }
    }
  }
  const newestFirst = [...mine].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const room = Math.max(0, TODAY_LINES - specials.length - (newestFirst.length > TODAY_LINES - specials.length ? 1 : 0));
  const shown = newestFirst.slice(0, room).map((m) => {
    const w = words(src, m.id);
    return { line: { kind: "written", text: w.text, confidential: w.confidential, to: { memory: m.id } }, at: m.at };
  });
  const lines = [...specials, ...shown].sort((a, b) => b.at - a.at).map((d) => d.line);
  const rest = newestFirst.length - shown.length;
  if (rest > 0) {
    lines.push({ kind: "more", text: `and ${rest} more`, confidential: false, to: { hash: "memories?state=live" } });
  }
  return {
    day,
    label: day === today ? "Today" : day === today - 1 ? "Yesterday" : `Day ${day}`,
    fallback: day !== today,
    lines,
    newToday: (written.get(today) ?? []).length
  };
}
