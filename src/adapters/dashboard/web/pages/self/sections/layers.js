/* The page in layers (2026-10-20, an experiment; Montaigne's idea from Mike's
   notes: he added to the Essays for twenty years instead of rewriting them).
   The page overwrites itself each night; its earlier versions are kept, under
   the ordinary retention, so this shows how each passage read across the
   versions still kept — "on Sep 22nd …, by Oct 5th …" — and how far back they
   reach. A passage is a section (its heading): the page is rewritten whole
   from memories, so a sentence seldom survives a night word for word, and a
   section does. A view only: nothing here keeps a version longer, and
   stability is a thing to look at, not a target. Also: the claims the page
   rests on no memory for, shown as hypotheses. */
import { dateWords } from "../../../shared/dates.js";
import { $, esc } from "../../../shared/dom.js";
import { q, wireTips } from "../../../shared/widgets/tips.js";

export const markup = `
      <section class="sp-card sp-layers" id="self-layers" hidden></section>`;

/** A heading line, as `self/page.ts#pageSections` reads one. */
const HEADING = /^(#{1,6})[ \t]+(\S.*?)[ \t]*#*[ \t]*$/;

/** The opening before the first heading, named as a section. */
export const OPENING = "(opening)";

/** A page's sections by heading, in order: [{ heading, body }]. Pure. */
export function sectionsOf(body) {
  const out = [];
  let cur = { heading: OPENING, lines: [] };
  for (const line of String(body || "").replace(/\r\n/g, "\n").split("\n")) {
    const m = HEADING.exec(line.trimEnd());
    if (m) {
      out.push(cur);
      cur = { heading: m[2].trim(), lines: [] };
      continue;
    }
    cur.lines.push(line);
  }
  out.push(cur);
  return out
    .map((s) => ({ heading: s.heading, body: s.lines.join("\n").trim() }))
    .filter((s) => s.heading !== OPENING || s.body.length > 0);
}

/** Folded for comparing two versions of a section: spacing aside. */
const fold = (t) => String(t || "").replace(/\s+/g, " ").trim();

/**
 * THE LAYERS: for each section any kept version has, the runs of versions it
 * read the same in, oldest first — each with the date (or lived day) it first
 * read so and its words. Sections are in the standing page's order, then
 * those it no longer has. `reach`: the oldest kept version; `pruned`: how
 * many earlier ones the ordinary retention has let go (the standing page's
 * seq is one past its version, so seqs below the oldest kept are gone). Pure.
 */
export function pageLayers(steps) {
  const kept = (steps || []).filter((s) => s.body !== null && s.body !== undefined);
  if (kept.length === 0) return { reach: null, pruned: 0, versions: 0, sections: [] };
  const byKey = new Map();
  const order = [];
  for (const s of kept) {
    const seen = new Set();
    for (const sec of sectionsOf(s.body)) {
      const key = sec.heading.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!byKey.has(key)) { byKey.set(key, { heading: sec.heading, layers: [], versions: 0 }); order.push(key); }
      const entry = byKey.get(key);
      entry.versions += 1;
      const last = entry.layers[entry.layers.length - 1];
      if (last && last.untilSeq === prevSeq(kept, s) && fold(last.text) === fold(sec.body)) { last.untilSeq = s.seq; continue; }
      entry.layers.push({ seq: s.seq, untilSeq: s.seq, date: s.date, day: s.day, text: sec.body });
    }
  }
  const standing = kept[kept.length - 1];
  const now = new Set(sectionsOf(standing.body).map((x) => x.heading.toLowerCase()));
  const sections = order.map((key) => {
    const e = byKey.get(key);
    // `inAll` (review of #550): in every kept version, so one layer means it
    // read the same throughout — not a section that came or went.
    return { heading: e.heading, standing: now.has(key), inAll: e.versions === kept.length, layers: e.layers };
  });
  sections.sort((a, b) => Number(b.standing) - Number(a.standing));
  const first = kept[0];
  return {
    reach: { seq: first.seq, date: first.date, day: first.day },
    pruned: Math.max(0, first.seq - 1),
    versions: kept.length,
    sections,
  };
}

/** The version before `s` among the kept ones (its seq), or null. */
function prevSeq(kept, s) {
  const i = kept.indexOf(s);
  return i > 0 ? kept[i - 1].seq : null;
}

/** When a layer began, in words: its date, else its lived day, else "undated". Pure. */
export function whenWords(x) {
  return dateWords(x.date) || (x.day !== null && x.day !== undefined ? "day " + x.day + " of use" : "undated");
}

/** The first sentence of a layer's words, for its one line. Pure. */
export function lead(text) {
  const flat = fold(String(text || "").replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, ""));
  const m = /^(.{1,240}?[.!?])(?=\s|$)/.exec(flat);
  if (m) return m[1];
  return flat.length > 240 ? flat.slice(0, 239) + "…" : flat;
}

/** How far back the kept versions reach, in one line. Pure. */
export function reachWords(l) {
  if (!l.reach) return "";
  const n = l.versions;
  return "The kept versions reach back to " + whenWords(l.reach) + " (" + n + (n === 1 ? " version" : " versions") +
    (l.pruned > 0 ? "; " + l.pruned + " older " + (l.pruned === 1 ? "one has" : "ones have") + " gone under the ordinary retention" : "") + ").";
}

/** One section's story across its layers, as a sentence a person says. Pure. */
export function storyWords(sec) {
  const ls = sec.layers;
  if (ls.length === 1) {
    if (!sec.standing) return "Read so on " + whenWords(ls[0]) + ", and no longer on the page.";
    return (sec.inAll === false ? "On the page since " : "Unchanged since ") + whenWords(ls[0]) + (sec.inAll === false ? ", unchanged." : ".");
  }
  return "Changed " + (ls.length - 1) + (ls.length === 2 ? " time" : " times") + (sec.standing ? "" : ", and no longer on the page") + ".";
}

export function paint(d) {
  const el = $("self-layers");
  const l = pageLayers(d.pageHistory || []);
  const t = d.page && d.page.trace ? d.page.trace : null;
  const hyp = t && t.hypotheses && t.hypotheses.length > 0 ? t.hypotheses : null;
  if (d.pageAbsent || (l.versions < 2 && !hyp)) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  // A section that changed, or came or went, has a story; one in every kept
  // version that read the same throughout is only counted (review of #550).
  const changed = l.sections.filter((s) => s.layers.length > 1 || !s.inAll);
  const still = l.sections.length - changed.length;
  const parts = [];
  if (l.versions >= 2) {
    parts.push('<h3 class="sb-h">The page in layers ' +
      q("layers", "How each section read across the page's kept versions, oldest first. The page is rewritten whole each night, so a section is the passage that can be followed; " +
        "its earlier versions are kept under the ordinary retention for old versions, so the oldest may already be gone. A view only: nothing here changes what is kept.") + "</h3>");
    parts.push('<p class="ly-reach">' + esc(reachWords(l)) + "</p>");
    for (const s of changed) {
      parts.push('<details class="ly-sec"><summary><b>' + esc(s.heading) + "</b> <span class=\"ly-say\">" + esc(storyWords(s)) + "</span></summary>" +
        s.layers.map((x, i) => '<div class="ly-layer"><span class="ly-when">' + esc((i === 0 ? "On " : "by ") + whenWords(x)) + "</span> " +
          esc(lead(x.text) || "(empty)") + "</div>").join("") + "</details>");
    }
    if (still > 0) parts.push('<p class="ly-still">' + esc(still + (still === 1 ? " section has" : " sections have") + " read the same in every kept version.") + "</p>");
  }
  if (hyp) {
    parts.push('<h3 class="sb-h">Hypotheses on the page ' +
      q("hypotheses", "Sentences on the page its writer named no memory for. They stand, as hypotheses: nothing removes them. " +
        t.claims + (t.claims === 1 ? " claim" : " claims") + " in all; " + (t.claims - hyp.length) + " rest on memories.") + "</h3>" +
      "<ul class=\"ly-hyp\">" + hyp.map((h) => "<li>" + esc(h) + "</li>").join("") + "</ul>");
  }
  el.innerHTML = parts.join("");
  wireTips(el);
}
