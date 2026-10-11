/* Just enough markdown to read a self page or a chapter comfortably: headings,
   lists, quotes, paragraphs, **bold**, *italic*, `code`. Everything is escaped
   FIRST, so the prose can never become markup — only the few shapes below are
   ever turned into tags. */
import { esc } from "../../shared/dom.js";

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_]+)__/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>");
}

export function renderMarkdown(text) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => { if (para.length) { out.push("<p>" + para.map(inline).join(" ") + "</p>"); para = []; } };
  const flushList = () => {
    if (list) { out.push("<" + list.tag + ">" + list.items.map((i) => "<li>" + inline(i) + "</li>").join("") + "</" + list.tag + ">"); list = null; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().startsWith("<!--")) continue;
    let m;
    if (line.trim() === "") { flushPara(); flushList(); continue; }
    if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(line))) {
      flushPara(); flushList();
      // The page's own top level is h3 here: the tab already has its headings.
      const level = Math.min(6, m[1].length + 2);
      out.push("<h" + level + ' class="md-h">' + inline(m[2]) + "</h" + level + ">");
      continue;
    }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      flushPara(); flushList();
      out.push("<blockquote>" + inline(m[1]) + "</blockquote>");
      continue;
    }
    // A continuation line of a list item stays with it.
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += " " + line.trim(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return '<div class="md">' + out.join("") + "</div>";
}
