/* Where archived memories went — one stacked bar, in plain words, with the
   counts. Was two panels ("ways out" and "the removal record"). Click a
   segment (or its line in the legend) to list those memories; click one to
   open its card. Nothing archived is ever deleted: an archived memory keeps
   its id and its history. */
import { $, esc } from "../../../shared/dom.js";

export const markup = `
    <h2>Where archived memories went <small>— counted since the store began; nothing leaves silently</small></h2>
    <div class="card pad ha" id="h-archive"></div>`;

/** A colour per reason; an unknown reason is grey. Non-text, so any hue the
 *  ground can carry. */
const COLOUR = {
  "handoff-cleared": "#5d7389",
  "handoff-duplicate": "#3f5063",
  "revised-by-pressure": "#b388ff",
  "replaced-by-declaration": "#8f6ae0",
  supersede: "#7057b8",
  "episode-regrown": "#00e5ff",
  "faded-by-decay": "#4a90a4",
  pruned: "#00bfa5",
  merged: "#1f8f84",
  "removed-by-owner": "#ffd740",
};
const colourOf = (r) => COLOUR[r.reason] || "#6b7480";

let current = null;
let data = null;

/** A memory archived more than once under one reason (a chapter rebuilt from
 *  the journal leaves a copy each time) is one line: how many times, after it. */
export function timesNote(m) {
  return m.times > 1 ? m.times + " times" : "";
}

/** The list's heading note: which slice it shows, in rows (as the count is). */
export function sliceNote(r) {
  const listed = typeof r.listed === "number" ? r.listed : r.items.length;
  const order = listed < r.count ? "the newest " + listed + " of " + r.count + ", newest first" : "newest first";
  return r.items.length < listed ? order + " · " + r.items.length + " different memories" : order;
}

function list(r) {
  if (!r) return "";
  const openable = r.reason !== "removed-by-owner";
  const items = r.items.map((m) => {
    const notes = [timesNote(m), m.note || ""].filter((x) => x !== "").map((x) => '<span class="ha-note">' + esc(x) + "</span>").join("");
    return openable
      ? '<button type="button" class="ha-item" onclick="openMemory(\'' + esc(m.id) + '\')">' + esc(m.label) + notes + "</button>"
      : '<div class="ha-item ha-still">' + esc(m.label) + notes + "</div>";
  }).join("");
  const listed = typeof r.listed === "number" ? r.listed : r.items.length;
  const more = listed < r.count ? '<div class="ha-more">and ' + (r.count - listed) + " older, not listed</div>" : "";
  return '<div class="ha-listhead"><span class="ha-sw" style="background:' + colourOf(r) + '"></span>' +
    esc(r.phrase) + " · " + r.count +
    '<span class="ha-note">' + esc(sliceNote(r)) + "</span>" +
    "</div>" + items + more;
}

function select(reason) {
  current = current === reason ? null : reason;
  const r = current === null ? null : data.archive.reasons.find((x) => x.reason === current);
  $("ha-list").innerHTML = list(r);
  document.querySelectorAll("#h-archive [data-reason]").forEach((el) => {
    el.classList.toggle("on", el.dataset.reason === current);
    if (el.tagName === "BUTTON") el.setAttribute("aria-pressed", el.dataset.reason === current ? "true" : "false");
  });
}

export function paint(d) {
  data = d;
  const a = d.archive;
  const box = $("h-archive");
  if (a.total === 0) {
    box.innerHTML = '<div class="ha-none">Nothing archived yet — every memory is still live.</div>' +
      '<div class="ha-legend">' + a.reasons.map((r) =>
        '<span class="ha-zero">' + esc(r.phrase) + ": 0</span>").join("") + "</div>";
    return;
  }
  const shown = a.reasons.filter((r) => r.count > 0);
  const bar = shown.map((r) =>
    '<button type="button" class="ha-seg" data-reason="' + esc(r.reason) + '" style="flex:' + r.count +
    ";background:" + colourOf(r) + '" title="' + esc(r.phrase + ": " + r.count) + '" aria-label="' +
    esc(r.phrase + ": " + r.count) + '"></button>').join("");
  const legend = a.reasons.map((r) =>
    r.count === 0
      ? '<span class="ha-key ha-zero"><span class="ha-sw ha-sw0"></span>' + esc(r.phrase) + ": 0</span>"
      : '<button type="button" class="ha-key" data-reason="' + esc(r.reason) + '" aria-pressed="false">' +
        '<span class="ha-sw" style="background:' + colourOf(r) + '"></span>' + esc(r.phrase) + ': <b>' + r.count + "</b></button>"
  ).join("");
  box.innerHTML =
    '<div class="ha-total"><b>' + a.total + "</b> archived, and every one is still here with its history</div>" +
    '<div class="ha-bar">' + bar + "</div>" +
    '<div class="ha-legend">' + legend + "</div>" +
    '<div class="ha-list" id="ha-list"></div>';
  box.querySelectorAll("[data-reason]").forEach((el) => { el.onclick = () => select(el.dataset.reason); });
  if (current !== null) { const keep = current; current = null; if (shown.some((r) => r.reason === keep)) select(keep); }
}
