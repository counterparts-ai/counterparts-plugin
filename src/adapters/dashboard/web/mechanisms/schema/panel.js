/* Schemas, pictured (2026-10-26): the newest beliefs formed here, each with
   how many lived memories back it and go against it. */
import { esc } from "../../shared/dom.js";
import { memLink, nothingYet } from "../picture.js";

const HOW = { reflection: "formed at night", session: "formed in a session", dream: "adopted from a dream", correction: "formed from a correction" };

export function picture(p) {
  if (!p || p.beliefs.length === 0) return nothingYet("No belief has formed here yet. The night's reflection forms one when lived memories back it.");
  return '<ul class="pic-list pic-rows">' + p.beliefs.map((b) =>
    "<li>" + memLink(b, 90) + '<span class="pic-meta">' + esc(HOW[b.route] || "formed") + " on day " + esc(String(b.day)) +
      " · " + esc(String(b.support)) + " for, " + esc(String(b.against)) + " against</span></li>"
  ).join("") + "</ul>";
}
