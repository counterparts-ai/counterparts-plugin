import { hashText } from "../store/index.js";
export const SELF_PAGE_ROLE = "page";
export const SELF_PAGE_REVISED_EVENT = "self.page.revised";
export const SELF_PAGE_REFUSED_EVENT = "self.page.refused";
export const SELF_PAGE_AUTHORS = ["session", "owner", "writer", "reflection"];
export const PAGE_CORE_HEADING = "Core";
export const PAGE_LATELY_HEADING = "Lately";
export const PAGE_TEMPLATE = [
  `## ${PAGE_CORE_HEADING}`,
  "",
  "Still forming.",
  "",
  `## ${PAGE_LATELY_HEADING}`,
  "",
  "Still forming.",
  ""
].join(`
`);
export const PAGE_TITLE = "Who I am";
export const PAGE_CLEARED_BODY = "This page has been cleared. Nothing stands here now; what it used to say is kept in this row's versions.";
export const PAGE_META_CLEARED = "cleared";
export function clearedMarker(meta) {
  const raw = meta[PAGE_META_CLEARED];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const rec = raw;
  return {
    on: typeof rec["on"] === "string" ? rec["on"] : "",
    reason: typeof rec["reason"] === "string" ? rec["reason"] : ""
  };
}
export const PAGE_META_REVISED_ON = "revisedOn";
export const PAGE_META_REVISED_DAY = "revisedDay";
export const PAGE_META_BY = "by";
export const PAGE_META_REASON = "reason";
export const PAGE_META_SHORT = "short";
export function shortOf(meta, body) {
  const raw = meta[PAGE_META_SHORT];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const rec = raw;
  const text = rec["body"];
  const of = rec["of"];
  if (typeof text !== "string" || text.trim().length === 0 || typeof of !== "string")
    return null;
  if (of !== hashText(body))
    return null;
  return { body: text, bytes: byteLengthOf(text) };
}
export function findSelfPage(store) {
  const row = findPageRow(store);
  if (row === null)
    return null;
  try {
    return clearedMarker(store.readProse(row).meta) === null ? row : null;
  } catch {
    return null;
  }
}
export function findPageRow(store) {
  for (const id of store.list({ type: "schema", kind: "self", archived: false })) {
    try {
      if (store.readProse(id).meta["role"] === SELF_PAGE_ROLE)
        return id;
    } catch {
      continue;
    }
  }
  return null;
}
export function isSelfPageRow(store, id) {
  const row = store.row(id);
  if (row === undefined || row.type !== "schema" || row.kind !== "self")
    return false;
  try {
    return store.readProse(id).meta["role"] === SELF_PAGE_ROLE;
  } catch {
    return false;
  }
}
export function readSelfPage(store) {
  const id = findPageRow(store);
  if (id === null)
    return null;
  let doc;
  try {
    doc = store.readProse(id);
  } catch {
    return null;
  }
  if (clearedMarker(doc.meta) !== null)
    return null;
  const row = store.row(id);
  const by = doc.meta[PAGE_META_BY];
  const revisedDay = doc.meta[PAGE_META_REVISED_DAY];
  const revisedOn = doc.meta[PAGE_META_REVISED_ON];
  const reason = doc.meta[PAGE_META_REASON];
  return {
    id,
    body: doc.body,
    bytes: byteLengthOf(doc.body),
    revisedOn: typeof revisedOn === "string" ? revisedOn : "",
    revisedDay: typeof revisedDay === "number" ? revisedDay : null,
    by: isAuthor(by) ? by : null,
    reason: typeof reason === "string" && reason.length > 0 ? reason : null,
    version: row?.revision ?? 0,
    short: shortOf(doc.meta, doc.body)
  };
}
function isAuthor(v) {
  return typeof v === "string" && SELF_PAGE_AUTHORS.includes(v);
}
function byteLengthOf(s) {
  return new TextEncoder().encode(s).length;
}
export const REVISED_LINE_MAX_CHARS = 160;
const REVISED_DATE = String.raw`(?:(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:\d{4}|\d{1,2}))(?!\d)|(?:\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|today|tonight|yesterday)(?![a-z]))`;
const REVISED_OPENING = new RegExp(String.raw`^last\s+revised\b[\s:,(*_\-–—]*(?:on\s+)?(?:by\s+[^,;:\n]{1,48}?[\s,]+(?:on\s+)?)?${REVISED_DATE}`, "iu");
const LIST_ENTRY = /^\s*(?:[-*+]|\d+[.)])\s+/u;
const FENCE = /^\s{0,3}(?:```|~~~)/u;
export function isRevisedLine(line) {
  const t = line.trim();
  if (t.length === 0 || t.length > REVISED_LINE_MAX_CHARS)
    return false;
  return REVISED_OPENING.test(t.replace(/^[>(\[*_\s\-–—]+/u, ""));
}
export function stripRevisedLines(body) {
  const lines = body.split(`
`);
  let fenced = false;
  const dateline = lines.map((l) => {
    if (FENCE.test(l)) {
      fenced = !fenced;
      return false;
    }
    return !fenced && isRevisedLine(l);
  });
  const beside = (i) => [i - 1, i + 1].filter((j) => j >= 0 && j < lines.length && (lines[j] ?? "").trim() !== "");
  const kept = (i) => beside(i).some((j) => dateline[j] === true) || LIST_ENTRY.test(lines[i] ?? "") && beside(i).some((j) => LIST_ENTRY.test(lines[j] ?? ""));
  const out = [];
  let stripped = 0;
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (dateline[i] !== true || kept(i)) {
      out.push(line);
      continue;
    }
    stripped += 1;
    const before = out[out.length - 1];
    if ((before === undefined || before.trim() === "") && (lines[i + 1] ?? "x").trim() === "")
      i += 1;
  }
  return stripped === 0 ? { body, stripped: 0 } : { body: out.join(`
`).trim(), stripped };
}
export function truncationMarker(shown, whole) {
  return `[This page is ${whole} bytes; the wake shows the first ${shown}. Run 'counterparts self-page' to read it whole.]`;
}
const HEADING = /^(#{1,6})(?:[ \t]+(\S.*?)|[ \t]*(core|lately))[ \t]*#*[ \t]*$/i;
export function pageSections(body) {
  const lines = body.split(`
`);
  const starts = [];
  lines.forEach((line, i) => {
    const m = HEADING.exec(line.trimEnd());
    if (m !== null)
      starts.push({ line: i, heading: (m[2] ?? m[3] ?? "").trim(), level: (m[1] ?? "").length });
  });
  if (starts.length === 0) {
    return { core: "", lately: "", preamble: body.trim(), headed: false, sections: [] };
  }
  const sections = starts.map((s, i) => {
    const end = starts[i + 1]?.line ?? lines.length;
    return { heading: s.heading, level: s.level, body: lines.slice(s.line + 1, end).join(`
`).trim() };
  });
  const named = (name) => sections.find((s) => s.heading.toLowerCase() === name.toLowerCase())?.body ?? "";
  return {
    core: named(PAGE_CORE_HEADING),
    lately: named(PAGE_LATELY_HEADING),
    preamble: lines.slice(0, starts[0]?.line ?? 0).join(`
`).trim(),
    headed: true,
    sections
  };
}
export const OUTLINE_SENTENCE_MAX_BYTES = 480;
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "st", "no", "cf", "approx"]);
const SENTENCE_END = /[.!?]["'”’)\]*_]*(?=\s|$)/gu;
export function firstSentence(text) {
  const para = text.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p.length > 0);
  if (para === undefined)
    return null;
  const lines = para.split(`
`).map((l) => l.trim());
  const first = lines[0] ?? "";
  const block = [];
  if (LIST_ENTRY.test(first))
    block.push(first.replace(LIST_ENTRY, ""));
  else {
    for (const l of lines) {
      if (LIST_ENTRY.test(l))
        break;
      block.push(l);
    }
  }
  const flat = block.join(" ").replace(/\s+/g, " ").trim();
  if (flat.length === 0)
    return null;
  let sentence = null;
  for (const m of flat.matchAll(SENTENCE_END)) {
    const end = (m.index ?? 0) + m[0].length;
    const before = flat.slice(0, m.index ?? 0);
    const word = (/(\S+)$/.exec(before)?.[1] ?? "").toLowerCase().replace(/^[("'“‘*_]+/u, "");
    if (m[0].startsWith(".") && (ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word)))
      continue;
    sentence = flat.slice(0, end);
    break;
  }
  const out = sentence ?? (LIST_ENTRY.test(first) ? flat : first.replace(/\s+/g, " "));
  if (out.length === 0 || byteLengthOf(out) > OUTLINE_SENTENCE_MAX_BYTES)
    return null;
  return out;
}
export function pageOutline(body) {
  const parts = pageSections(body);
  const lead = firstSentence(parts.preamble);
  if (!parts.headed)
    return { lead, entries: [] };
  const levels = parts.sections.map((s) => s.level);
  const level = levels.includes(2) ? 2 : Math.min(...levels);
  return {
    lead,
    entries: parts.sections.filter((s) => s.level === level && s.heading.length > 0).map((s) => ({ heading: `${"#".repeat(s.level)} ${s.heading}`, sentence: firstSentence(s.body) }))
  };
}
export function outlineText(outline) {
  const lines = [];
  if (outline.lead !== null)
    lines.push(outline.lead);
  for (const e of outline.entries) {
    lines.push(e.heading);
    if (e.sentence !== null)
      lines.push(e.sentence);
  }
  return lines.length === 0 ? null : lines.join(`
`);
}
export function headingsText(outline) {
  return outline.entries.length === 0 ? null : outline.entries.map((e) => e.heading).join(`
`);
}
