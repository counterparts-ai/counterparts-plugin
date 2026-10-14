import { FEELINGS_WHEEL } from "../feelings-wheel.js";
import { fit, lineOf, offeredOf } from "../fit/index.js";
import { readChapterLead } from "../self/episodes.js";
export function entryKey(episode, index) {
  return `${episode}#${String(index)}`;
}
export function shownEntry(e, p) {
  return { chapter: e.chapter, day: e.day, fidelity: p.fidelity === "id" ? "line" : p.fidelity, text: p.text, chars: p.chars };
}
const HEADING_LINE = /^[ \t]*#{1,6}[ \t]*chapter[ \t]+\d+\b/i;
export function chapterEntries(body) {
  const lines = body.split(`
`);
  const chunks = [];
  let current = [];
  let bodied = false;
  for (const line of lines) {
    if (HEADING_LINE.test(line) && bodied) {
      chunks.push(current.join(`
`));
      current = [];
      bodied = false;
    }
    current.push(line);
    if (!HEADING_LINE.test(line) && line.trim().length > 0)
      bodied = true;
  }
  if (current.length > 0)
    chunks.push(current.join(`
`));
  const out = [];
  for (const chunk of chunks) {
    const lead = readChapterLead(chunk);
    const text = lead.rest.trim();
    const headed = HEADING_LINE.test(chunk.trimStart());
    if (text.length === 0 && !headed)
      continue;
    out.push({
      index: out.length,
      chapter: headed ? lead.chapters[0] ?? null : null,
      day: lead.livedDay,
      date: lead.date,
      text
    });
  }
  return out;
}
export function fitEpisodes(episodes, opts) {
  const ordered = [...episodes].sort((a, b) => b.at - a.at);
  const cands = [];
  for (const ep of ordered) {
    for (const entry of ep.fresh) {
      cands.push({
        id: entryKey(ep.row.id, entry.index),
        priority: entryImportance(entry.text, opts.owner) - entry.index * 0.000001,
        line: lineOf({ body: entry.text }, opts.lineBytes),
        whole: entry.text
      });
    }
  }
  const fitted = fit(cands, { room: opts.room, excerptChars: opts.entryChars, least: "line" });
  const placed = new Map(fitted.placed.map((p) => [p.id, p]));
  const o = offeredOf(fitted.placed);
  const offered = { whole: [...o.whole], excerpt: [...o.excerpt], line: [...o.line], id: [...o.id] };
  const chapters = [];
  const entryIndex = {};
  const reads = { ...opts.reads ?? {} };
  const unread = Object.fromEntries(Object.entries(opts.unread ?? {}).map(([k, v]) => [k, [...v]]));
  for (const ep of ordered) {
    const entries = [];
    let more = 0;
    reads[ep.row.id] = ep.earlier + ep.fresh.length;
    unread[ep.row.id] = [];
    for (const entry of ep.fresh) {
      const p = placed.get(entryKey(ep.row.id, entry.index));
      if (p === undefined) {
        more += 1;
        unread[ep.row.id]?.push(entry.index);
        continue;
      }
      entryIndex[`${ep.row.id}:${String(entries.length)}`] = entry.index;
      entries.push(shownEntry(entry, p));
    }
    if (entries.length === 0)
      continue;
    chapters.push({ id: ep.row.id, title: ep.row.title, entries, earlier: ep.earlier, ...more > 0 ? { notShown: more } : {} });
    if (ep.earlier > 0 || more > 0 || entries.some((e) => e.fidelity !== "whole"))
      offered.line.push(ep.row.id);
  }
  for (const [k, v] of Object.entries(unread))
    if (v.length === 0)
      delete unread[k];
  return { chapters, used: fitted.used, report: fitted.report, notShown: fitted.waiting.length, offered, entryIndex, reads, unread };
}
let wheelWords = null;
function feelingWords() {
  if (wheelWords === null)
    wheelWords = new Set(FEELINGS_WHEEL.map((e) => e.word.toLowerCase()));
  return wheelWords;
}
const TURNS = /\b(decided|decide|chose|choose|realized|realised|noticed|learned|surprised|surprising|unexpected|mistake|wrong|finally|first time|never|promise|agreed|changed)\b/gi;
export function entryImportance(text, owner) {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  const wheel = feelingWords();
  let feelings = 0;
  for (const w of words)
    if (w.length > 2 && wheel.has(w))
      feelings += 1;
  const names = owner.filter((n) => n.length > 1 && words.includes(n.toLowerCase())).length > 0 ? 1 : 0;
  const turns = (text.match(TURNS) ?? []).length;
  return Math.min(feelings, 5) * 0.2 + names * 0.5 + Math.min(turns, 5) * 0.3;
}
