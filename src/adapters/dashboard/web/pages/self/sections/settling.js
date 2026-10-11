/* Settling into the core: a line of counts (in the core, protected, being
   argued with — each opens the list behind it), then the self map (round 3b:
   the memories about me or about us around the core, `map.js`), then what
   crossed lately (became core, sent back, nominated in a dream). Closeness to
   the core is measured by physics' own promotion rule (the view computes it;
   this only draws it). The explaining words sit behind `?`. */
import { $, esc } from "../../../shared/dom.js";
import { headline, n2, said } from "../../../shared/format.js";
import { openModal } from "../../../shared/modal.js";
import { ui } from "../state.js";
import { q, wireTips } from "../../../shared/widgets/tips.js";
import * as map from "./map.js";
import { RING_WORDS } from "./map.js";
import { storyCard } from "./stories.js";

export const markup = `
        <h2 id="self-settling-h">Settling into the core <span id="self-settling-q"></span></h2>
        <div class="card pad" id="self-settling"></div>`;

let stories = [];
let last = null;

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

export function paint(d) {
  if (d) last = d;
  d = last;
  const s = d.settling;
  stories = d.stories || [];
  $("self-settling-q").innerHTML = q("settling", "The core is what repetition and weight earned; it no longer fades. " +
    "Protected is permanent, including permanently wrong. Being argued with is a belief under pressure against the bar it has to clear to change.");

  // A list that emptied closes.
  if (ui.count && listOf(s, ui.count).length === 0) ui.count = null;

  const parts = [];
  // ── the one line of counts; each opens its list ──
  const counts = [
    ["core", s.core.length, plural(s.core.length, "in the core", "in the core")],
    ["guarded", s.guarded.length, plural(s.guarded.length, "protected", "protected")],
    ["contested", s.contested.length, plural(s.contested.length, "being argued with", "being argued with")],
  ];
  parts.push('<div class="st-counts">' + counts.map(([key, n, label]) =>
    '<button type="button" class="st-count k-' + key + (ui.count === key ? " on" : "") + '" data-count="' + key + '"' +
      (n === 0 ? " disabled" : "") + ' aria-expanded="' + (ui.count === key) + '">' + esc(label) + "</button>").join('<span class="st-sep" aria-hidden="true">·</span>') +
    "</div>");
  if (ui.count) parts.push('<div class="st-list">' + list(s, ui.count) + "</div>");

  // ── rows it could not read: always shown when it happens (never folded) ──
  if (s.unreadable.length > 0) {
    parts.push('<div class="st-warn"><b>' + plural(s.unreadable.length, "core memory", "core memories") +
      " could not be read just now:</b> " + s.unreadable.map((u) => esc(u.label)).join(" · ") + "</div>");
  }

  // ── the self map: the core and what is around it (round 3b; it replaces
  //    the list of the five closest — the picture shows closeness) ──
  parts.push(mapHead(s));

  // ── what crossed lately: became core, sent back, nominated ──
  parts.push(history(s.history));

  const box = $("self-settling");
  box.innerHTML = parts.join("");
  map.paint($("self-map"), d.map);
  box.querySelectorAll(".st-count").forEach((b) => b.addEventListener("click", () => {
    ui.count = ui.count === b.dataset.count ? null : b.dataset.count;
    paint();
  }));
  box.querySelectorAll(".st-story").forEach((b) => b.addEventListener("click", () => {
    const story = stories[Number(b.dataset.i)];
    if (story) openModal("<h3>How I changed my mind — or didn't</h3>" + storyCard(story));
  }));
  wireTips($("self-settling-q"));
  wireTips(box);
}

/**
 * WHAT CROSSED LATELY (2026-09-26): the newest crossings into the core with
 * the lane that carried each, the owner's demotions with his reason, and the
 * memories a dream nominated. Nothing is drawn when all three are empty.
 */
function history(h) {
  if (!h) return "";
  const LANE = { fast: "strongly felt, and came back", slow: "kept coming back over weeks" };
  const row = (r, tail) =>
    '<button type="button" class="st-row click" onclick="openMemory(\'' + esc(r.id) + '\')">' +
      '<span class="st-text">' + said(headline(r.text), r.confidential) + "</span>" +
      '<span class="st-hist-tail">' + esc(tail) + "</span></button>";
  const out = [];
  if (h.promoted.length > 0) {
    out.push('<h4 class="st-h">Became core</h4>' + h.promoted.map((r) =>
      row(r, "day " + r.day + (r.lane ? " · " + (LANE[r.lane] || r.lane) : ""))).join(""));
  }
  if (h.demoted.length > 0) {
    out.push('<h4 class="st-h">Sent back to ordinary fading</h4>' + h.demoted.map((r) =>
      row(r, "day " + r.day + (r.reason ? " · " + r.reason : ""))).join(""));
  }
  if (h.nominated.length > 0) {
    out.push('<h4 class="st-h">Nominated in a dream ' + q("nominated", "A dream can say a memory belongs to who I am. That is recorded here and nothing more: only coming back awake, by a lane, makes a memory core.") + "</h4>" +
      h.nominated.map((r) => row(r, "day " + r.day + (r.reason ? " · " + r.reason : ""))).join(""));
  }
  return out.length === 0 ? "" : '<div class="st-hist">' + out.join("") + "</div>";
}

function listOf(s, key) {
  return key === "core" ? s.core : key === "guarded" ? s.guarded : key === "contested" ? s.contested : [];
}

function list(s, key) {
  if (key === "contested") {
    return s.contested.map((c, i) =>
      '<button type="button" class="st-row st-story" data-i="' + i + '">' +
        '<span class="st-text"><span class="st-about">about ' + esc(c.about) + "</span>" + esc(headline(c.now)) + "</span>" +
        (c.revised
          ? '<span class="st-tag changed">changed its mind</span>'
          : '<span class="st-bar" title="pressure ' + n2(c.pressure) + " of " + n2(c.bar) + '"><span style="width:' +
              Math.round(Math.min(1, c.fraction) * 100) + '%"></span></span>') +
      "</button>").join("");
  }
  const rows = listOf(s, key);
  // When nothing protected stands in the core, the protected list IS the
  // "permanent but not in the core" list: say so once rather than twice.
  const sameRows = s.outside.length > 0 && s.outside.length === s.guarded.length;
  const note = key === "guarded" && sameRows
    ? '<p class="foot st-note">None of these has earned the core.</p>'
    : "";
  const outside = key === "guarded" && s.outside.length > 0 && !sameRows
    ? '<h4 class="st-h">Permanent but not in the core</h4>' + s.outside.map(row).join("")
    : "";
  return rows.map(row).join("") + note + outside;
}

function row(r) {
  return '<button type="button" class="st-row click" onclick="openMemory(\'' + r.id + '\')">' +
    '<span class="st-text">' + said(r.text, r.confidential) + "</span></button>";
}

/** The rule in words, for the map's `?`: the two lanes, the check, and what is counted apart. */
export function ruleWords(s) {
  const r = s.rule;
  const foot = ["Only a memory about me or about us joins the core, by one of two lanes: strongly felt (" + n2(r.needFeeling) +
    " or more) and come back at least once, " + r.needGap + " or more days after it was made; or come back on " + r.days +
    " different days over " + r.span + ". That is checked every " + r.everyDays + " lived days, at most " + r.cap + " a night. " +
    // The map's own words (round 4 of the map, 2026-09-28: three named rings,
    // no legend) — this sentence described the legend before it.
    "On the map, “" + RING_WORDS.core + "” in the middle is the core; “" + RING_WORDS.near +
    "” holds the ones ready to join at the next check or one return away; the rest of the memories “" + RING_WORDS.about +
    "” sit outside, nearer the middle the closer they are. A dot is brighter the more firmly it is held; point at one to see its links."];
  if (s.onTheWay > 0) foot.push(plural(s.onTheWay, "memory about us has", "memories about us have") + " come back at least once.");
  if (s.unused > 0) foot.push(s.unused + " more about us haven't come back yet.");
  if (s.sentBack > 0) {
    foot.push(s.sentBack + (s.sentBack === 1 ? " memory you sent back is" : " memories you sent back are") +
      " out of the core and not on the way to it, so the map leaves " + (s.sentBack === 1 ? "it" : "them") + " out.");
  }
  if (s.outOfReach > 0) {
    foot.push(s.outOfReach + (s.outOfReach === 1 ? " memory is" : " memories are") +
      " not about me or about us, so the core is not for them however often they come back.");
  }
  return foot.join(" ");
}

/** The map's heading and its slot; `map.js` draws into the slot. */
function mapHead(s) {
  return '<h4 class="st-h">Around the core ' + q("rule", ruleWords(s)) + "</h4>" +
    '<div class="sm" id="self-map"></div>';
}

/** A new width redraws the map to fit it. */
export const resize = () => map.resize();

