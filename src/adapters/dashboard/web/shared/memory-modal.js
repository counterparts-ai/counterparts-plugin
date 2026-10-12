/* One memory, opened — from any row, dot or reference on any page. Resolved at
   the moment it is opened, so a memory that left the store says so.

   Top to bottom (round 4, 2026-09-28 — the same card on every page): the
   title and the words; how well I remember it, as a chart and one plain
   sentence; why it mattered (the bars); the day it was written, once. Then a
   folded "details": the days it was used, its standing, its feelings, what it
   is linked to, its versions, the small chips (the model among them) and the
   raw record. A part with nothing in it is left out. Under the fold, what it
   is about, and a small control that changes it (2026-10-11). */
import { act, resultHtml } from "./actions.js";
import { api, fail } from "./api.js";
import { emptyBox } from "./absence.js";
import { esc } from "./dom.js";
import { headline, n2, n3, said } from "./format.js";
import { coreRoadLine, curveStart, versionRows } from "./memory-card-words.js";
import { dateOr, dateWords } from "./dates.js";
import { FEELING_COLOURS, feelingName, feelingWord, kindMark, kindOf } from "./memory-marks.js";
import { openModal } from "./modal.js";
import { confirmTyped } from "./widgets/confirm.js";

export async function openMemory(id) {
  let d;
  try { d = await api("/api/memory?id=" + encodeURIComponent(id)); }
  catch (e) { return fail("That memory", e); }
  if (!d.found) {
    return openModal("<h3>" + esc(id) + "</h3><div class='sub'>resolved just now</div>" +
      emptyBox(d.absence || "[no longer at this address]",
        "Ids are resolved at the moment a page is drawn, so a memory that has left the store stops resolving immediately."));
  }
  openModal(memoryCard(d));
}

/** The card's markup — pure, from the `/api/memory` payload. */
export function memoryCard(d) {
  const k = kindOf(d.kind);
  const title = d.title ? esc(d.title) : d.confidential ? said(d.text, true) : esc(headline(d.shownText || d.text));
  return '<div class="mc' + (d.archived ? " mc-arch" : "") + '">' +
    '<h3 class="mc-title">' + kindMark(d.kind, false) + "<span>" + title + "</span></h3>" +
    '<div class="mc-kind">' + esc(k.label) + (d.askedFor ? " · you asked for " + esc(d.askedFor) + ", which forwards here" : "") + "</div>" +
    (d.archived ? '<div class="mc-archived">Put away — ' + esc(d.archivedWords || d.archived) + ". Kept, not deleted.</div>" : "") +
    "<div class='body'>" + (d.confidential ? '<span class="withheld">' + esc(d.text) + "</span>" : esc(d.shownText || d.text)) + "</div>" +
    (d.journal ? '<p class="mc-note">My journal, kept as written. Nothing in it fades.</p>' : "") +
    part("How well I remember", curvePart(d)) +
    part("Why it mattered", fingerprint(d)) +
    written(d) +
    footer(d) +
    "</div>";
}

/** The day it was written, once: "Written Sep 28th, 2026" — the moment it entered
 *  the store (v7 `created_at`) on the person's calendar, else the calendar day
 *  it was recorded. The server dates it (`views/memory.ts#writtenWhen`), in the
 *  zone the hooks use, so the card agrees with every other date the dashboard
 *  prints. It read the UTC day until 2026-10-09, then the browser's. */
export function writtenOn(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d.writtenOn || "")) ? d.writtenOn : null;
}

/** The details row's "written": its day and its clock, named — "Sep 30th, 2026, 11:47 MDT". */
export function writtenStamp(d) {
  const day = writtenOn(d);
  if (!day || !d.writtenClock) return null;
  return (dateWords(day, FULL) || day) + ", " + d.writtenClock;
}

/** The card is read on its own, so its dates always carry their year. */
const FULL = { year: true };

function written(d) {
  const day = writtenOn(d);
  return day ? '<p class="mc-written">Written ' + esc(dateOr(day, FULL)) + "</p>" : "";
}

/** A titled part, or nothing at all when it has nothing in it. */
function part(title, body) {
  return body ? '<section class="mc-part"><h4>' + esc(title) + "</h4>" + body + "</section>" : "";
}

const pct = (x) => Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 100) + "%";

// ── how strong: so far, and ahead if unused ────────────────────────────────

function curvePart(d) {
  if (!d.curve) return d.curveNote && !d.journal ? '<p class="mc-line">' + esc(d.curveNote) + ".</p>" : "";
  const c = d.curve;
  const W = 520, H = 120, L = 8, R = 8, T = 10, B = 20;
  const span = Math.max(1, c.to - c.from);
  const x = (day) => L + ((day - c.from) / span) * (W - L - R);
  const y = (s) => T + (1 - Math.max(0, Math.min(1, s))) * (H - T - B);
  const path = (pts) => pts.map((q, i) => (i === 0 ? "M" : "L") + x(q[0]).toFixed(1) + " " + y(q[1]).toFixed(1)).join(" ");
  const past = c.points.filter((q) => q[0] <= c.day);
  const ahead = c.points.filter((q) => q[0] >= c.day);
  const now = (c.points.find((q) => q[0] === c.day) || [c.day, d.strength])[1];
  let svg = '<svg class="mc-curve" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="strength so far, and ahead if unused">' +
    '<line class="mc-guide" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(c.archiveLine) + '" y2="' + y(c.archiveLine) + '"/>' +
    '<line class="mc-today" x1="' + x(c.day) + '" x2="' + x(c.day) + '" y1="' + T + '" y2="' + (H - B) + '"/>';
  if (past.length > 1) svg += '<path d="' + path(past) + '" class="mc-past"/>';
  if (ahead.length > 1) svg += '<path d="' + path(ahead) + '" class="mc-ahead"/>';
  svg += '<circle cx="' + x(c.day) + '" cy="' + y(now) + '" r="4" class="mc-now"/></svg>';
  const axis = '<div class="mc-axis">' + (c.from === c.day
    ? "<span>" + esc(curveStart(d)) + "</span>"
    : "<span>" + esc(curveStart(d)) + "</span><span>today</span>") + "<span>day " + c.to + "</span></div>";
  return svg + axis + '<p class="mc-line">' + esc(rememberLine(now, c)) + "</p>";
}

/** The one plain sentence under the chart (round 4): "I remember this at 41%.
 *  If nobody uses it, I'll put it away around day 67." `c` is the card's curve.
 *  The prune never lets a protected memory go (review of #343): "It's protected, so
 *  I'll keep it even if nobody uses it." A date that still repeats is kept for
 *  its next time (2026-10-09), however faint: "It comes round every May 14, so
 *  I'll keep it while it does." Both come before "soon": neither is. */
export function rememberLine(now, c) {
  const head = "I remember this at " + pct(now) + ". ";
  if (c.protected) return head + "It's protected, so I'll keep it even if nobody uses it.";
  if (c.repeats) return head + "It comes round " + c.repeats + ", so I'll keep it while it does.";
  if (c.archiveDay !== null) return head + "If nobody uses it, I'll put it away around day " + c.archiveDay + ".";
  if (now < c.archiveLine) return head + "That's low enough that I could put it away soon.";
  const ahead = c.to - c.day;
  return head + "Even if nobody uses it, I'll keep it for at least the next " + ahead + (ahead === 1 ? " day." : " days.");
}

// ── why it mattered: a four-part fingerprint ────────────────────────────────

function fingerprint(d) {
  if (d.journal || d.chapter) return "";
  const s = d.salience;
  const parts = [["relevance", s.relevance], ["feeling", s.emotional], ["changes what I expect", s.predictive], ["novelty", s.novelty]];
  if (parts.every(([, v]) => !v)) return "";
  return '<div class="mc-print">' + parts.map(([label, v]) => {
    const blind = v === null;
    return '<div class="mc-pbar" title="' + esc(label + ": " + (blind ? "not measured (nothing to compare it with yet)" : n2(v))) + '">' +
      '<span class="mc-plabel">' + esc(label) + (blind ? ' <span class="mc-dim">· not measured</span>' : "") + "</span>" +
      '<span class="mc-ptrack' + (blind ? " blind" : "") + '"><span style="width:' + (blind ? 0 : Math.round(Math.max(0, Math.min(1, v)) * 100)) + '%"></span></span>' +
      "</div>";
  }).join("") + "</div>";
}

// ── use: a strip of lived days, a dot on each day it was used ─────────────

function usePart(d) {
  if (d.journal || d.chapter) return "";
  const road = coreRoadLine(d.promotion, d.promoted);
  if (d.uses === 0 && d.useDays.length === 0 && !road) return "";
  const last = d.day;
  const first = Math.max(d.bornDay, last - 59);
  const used = new Set(d.useDays);
  if (d.uses > 0) used.add(d.lastUsedDay);
  let cells = "";
  for (let day = first; day <= last; day++) {
    const cls = "mc-cell" + (used.has(day) ? " used" : "") + (day === d.bornDay ? " born" : "") + (day === last ? " today" : "");
    cells += '<i class="' + cls + '" title="day ' + day + ' of use' + (day === d.bornDay ? " — born" : "") + (used.has(day) ? " — used" : "") + '"></i>';
  }
  const shown = [...used].filter((x) => x >= first).length;
  const lines = [];
  if (d.uses > 0) {
    lines.push("Used " + d.uses + "× over " + d.reinforcedDays + (d.reinforcedDays === 1 ? " separate day" : " separate days") +
      ", last on day " + d.lastUsedDay + " of use.");
    if (shown < d.reinforcedDays) lines.push("The log shows " + shown + " of those days; it keeps only so much.");
  } else lines.push("Not used yet.");
  if (road) lines.push(road);
  return '<div class="mc-strip" role="img" aria-label="days of use, a dot on each day it was used">' +
    (first > d.bornDay ? '<span class="mc-more">…</span>' : "") + cells + "</div>" +
    '<div class="mc-axis"><span>' + (first === d.bornDay ? "born, day " + first : "day " + first) + "</span><span>today, day " + last + "</span></div>" +
    '<p class="mc-line">' + esc(lines.join(" ")) + "</p>";
}

// ── standing, in plain words ────────────────────────────────────────────────

function standing(d) {
  const out = [];
  if (d.promoted) out.push('<span class="mbadge core">★ core</span><span>part of who I am</span>');
  if (d.protected) out.push('<span class="mbadge lock">locked</span><span>protected — nothing can revise it</span>');
  else if (!d.journal && !d.chapter) {
    out.push("<span>revisable — a strong enough correction can change it" +
      (d.pressure > 0 ? '<span class="mc-dim"> · under some pressure now (' + n2(d.pressure) + (d.bar === null ? "" : " of a bar of " + n2(d.bar)) + ")</span>" : "") +
      "</span>");
  }
  if (d.chapter) out.push('<span class="mbadge journal">journal</span><span>a journal chapter, kept as written — not scored</span>');
  return out.length ? '<ul class="mc-list">' + out.map((x) => "<li>" + x + "</li>").join("") + "</ul>" : "";
}

// ── feelings ────────────────────────────────────────────────────────────────

function feelingsPart(d) {
  // Emotion part A (#244): feeling now holds a memory higher and slows its fading.
  const held = d.intensity > 0 && !d.confidential
    ? '<p class="mc-dim">Feeling holds it higher and slows its fading (intensity ' + n2(d.intensity) + ").</p>"
    : "";
  if (!d.feelings || d.feelings.length === 0) return held;
  return '<ul class="mc-list">' + d.feelings.map((f) =>
    '<li><i class="mc-fdot" style="background:' + (FEELING_COLOURS[f.core] || "#8a95a3") + '"></i><span>' +
    (f.whose === "owner" ? "you felt " : f.whose === "self" ? "I felt " : esc(f.whose) + " felt ") + "<b>" + esc(feelingWord(f)) + "</b>" +
    '<span class="mc-dim"> · ' + esc(feelingName(f.core)) + (f.carriedBy ? " — " + esc(f.carriedBy) : "") + "</span></span></li>").join("") + "</ul>" + held;
}

// ── linked memories ────────────────────────────────────────────────────────

function ref(id, text, confidential, role) {
  return '<div class="ref" role="button" tabindex="0" onclick="openMemory(\'' + esc(id) + '\')" ' +
    "onkeydown=\"if(event.key==='Enter')openMemory('" + esc(id) + "')\">" +
    (role ? '<span class="role">' + role + "</span>" : "") + said(text, confidential) + "</div>";
}

function linked(d) {
  const around = d.points.filter((p) => p.role === "hangs on" || p.role === "grounded in")
    .map((p) => ref(p.id, p.text, false, esc(p.role)));
  const wired = d.edges.slice().sort((a, b) => b.weight - a.weight).map((e) =>
    ref(e.id, e.text, e.confidential, '<span class="mc-wbar" title="wired together: ' + n2(e.weight) + '"><span style="width:' +
      Math.round(Math.max(0, Math.min(1, e.weight)) * 100) + '%"></span></span>'));
  const all = around.concat(wired);
  return all.length ? '<div class="mc-refs">' + all.join("") + "</div>" : "";
}

// ── versions: one line of its lineage ──────────────────────────────────────

function versions(d) {
  if (!d.timeline || d.timeline.length === 0) return "";
  // The words (and the grouping of a dream's near-copies) are `versionRows`.
  const steps = versionRows(d.timeline).map((s) => {
    const when = s.day === null ? "" : "day " + s.day;
    const head = '<span class="mc-vrel">' + esc(s.label) + "</span>" +
      (when ? '<span class="mc-dim"> · ' + esc(when) + "</span>" : "") +
      (s.reason ? '<span class="mc-dim"> · ' + esc(s.reason) + "</span>" : "");
    const body = s.refs.map((r) => ref(r.id, r.text, r.confidential, "")).join("");
    return '<li class="mc-v mc-v-' + s.rel + (s.dream ? " mc-v-dream" : "") + '"><i class="mc-vdot"></i><div>' + head + body + "</div></li>";
  });
  const nowAt = d.timeline.some((s) => s.rel === "became") ? "" :
    '<li class="mc-v mc-v-now"><i class="mc-vdot"></i><div><span class="mc-vrel">this memory, as it stands</span>' +
      '<span class="mc-dim"> · revision ' + esc(String(d.revision)) + "</span></div></li>";
  return '<ol class="mc-versions">' + steps.join("") + nowAt + "</ol>";
}

// ── small chips ────────────────────────────────────────────────────────────

function chips(d) {
  const c = [];
  if (d.writtenDate) {
    c.push('<span class="mc-chip dated" title="' + (d.chapter ? "the day its journal chapter names" : "the date written at the front of the memory") +
      '">' + esc(dateOr(d.writtenDate, FULL)) + "</span>");
  }
  if (d.model) c.push('<span class="mc-chip model" title="the model that wrote these words">' + esc(d.model) + "</span>");
  if (d.eventDate) c.push('<span class="mc-chip" title="the date this memory is about">about ' + esc(dateOr(d.eventDate, FULL)) + "</span>");
  if (d.happenedOn) c.push('<span class="mc-chip" title="when it happened">happened ' + esc(dateOr(d.happenedOn, FULL)) + "</span>");
  if (d.learnedOn && d.learnedOn !== "—") {
    c.push('<span class="mc-chip" title="the calendar day it entered the store (on a migrated or seeded store, the day of the import)">recorded ' +
      esc(dateOr(d.learnedOn, FULL)) + "</span>");
  }
  c.push('<span class="mc-chip" title="the day of use it was born">day ' + esc(String(d.bornDay)) + " of use</span>");
  for (const p of d.prospective || []) {
    c.push('<span class="mc-chip" title="a reminder it holds">reminder ' + esc(dateOr(p.date, FULL)) + " · " + esc(p.state) + "</span>");
  }
  return '<div class="mc-chips">' + c.join("") + "</div>";
}

// ── the details fold, and the two buttons ──────────────────────────────────

/** Everything under "details", folded: the parts a first look doesn't need. */
function detailParts(d) {
  return part("Use", usePart(d)) +
    part("Standing", standing(d)) +
    part("Feelings", feelingsPart(d)) +
    part("Linked memories", linked(d)) +
    part("Versions", versions(d)) +
    chips(d);
}

function footer(d) {
  const kv = (k, v) => '<div class="k">' + esc(k) + '</div><div class="v">' + v + "</div>";
  const s = d.salience;
  const raw = '<div class="kv">' +
    kv("id", esc(d.id)) +
    kv("record", "rev " + esc(String(d.revision)) + " · " + esc(d.contentHash || "—")) +
    kv("band", esc(d.band) + " <span class='mc-dim'>(recorded " + esc(d.recordedBand) + ")</span>") +
    kv("strength", n3(d.strength) + " <span class='mc-dim'>· repetition " + n3(d.repetition) + "</span>") +
    kv("salience", n3(s.combined) + " <span class='mc-dim'>relevance " + n2(s.relevance) + " · emotional " + n2(s.emotional) +
      " · predictive " + n2(s.predictive) + " · novelty " + (s.novelty === null ? "blind" : n2(s.novelty)) +
      (s.claimed === null ? "" : " · claimed floor " + n2(s.claimed)) + "</span>") +
    (d.feelingsLine || d.intensity > 0 ? kv("feelings", esc(d.feelingsLine || "none recorded") + " <span class='mc-dim'>· intensity " + n2(d.intensity) + "</span>") : "") +
    kv("use", "born day " + d.bornDay + " · used " + d.uses + "× over " + d.reinforcedDays + " days · last used day " + d.lastUsedDay) +
    kv("standing", (d.consolidated ? "consolidated" : "not consolidated") + " · " + (d.promoted ? "promoted" : "not promoted") +
      " · " + (d.protected ? "protected" : "revisable") + " · pressure " + n3(d.pressure) + (d.bar === null ? "" : " / bar " + n3(d.bar))) +
    (writtenStamp(d) ? kv("written", esc(writtenStamp(d))) : "") +
    (d.archived ? kv("archived", esc(d.archived)) : "") +
    d.points.map((p) => kv(p.role, esc(p.id))).join("") +
    d.removal.map((r) => kv("removal", esc(r.stage) + " by " + esc(r.actor) + " — " + esc(r.reason || "no reason recorded"))).join("") +
    "</div>";
  return aboutControl(d) + '<div class="mc-foot">' +
    '<details class="mc-details"><summary>details</summary>' + detailParts(d) + '<h4 class="mc-rawh">The record</h4>' + raw + "</details>" +
    '<div class="mc-buttons">' +
      "<button class='copy' data-id=\"" + esc(d.id) + "\" onclick=\"copyId(this)\">copy id</button>" +
      "<button class='copy act-danger' data-id=\"" + esc(d.id) + "\" onclick=\"removeMemory(this)\">remove…</button>" +
    "</div></div><div id='remove-out'></div>";
}

// ── what it is about, and the owner's door to change it ────────────────────

/** The marks, in the order the console lists them, each with the words the card says. */
export const ABOUT_CHOICES = [
  ["me", "me — who I am"],
  ["us", "us — the two of us"],
  ["owner", "you, as a person"],
  ["work", "work — the craft"],
  ["world", "the world — anything else"],
];

const ABOUT_BY = {
  writer: "the writer, when it was written",
  reflection: "a nightly reflection",
  owner: "you",
  upgrade: "the upgrade, by its kind",
  self: "me, awake in a session",
};

/**
 * WHAT IT IS ABOUT (2026-10-11, the about-marks lane): the mark, who set it,
 * and a picker that changes it through the console's own `about` command —
 * the same store function as `counterparts about` (one path, two doors).
 * Not on a journal entry, which is not a memory. Pure: markup only.
 */
export function aboutControl(d) {
  if (d.journal) return "";
  const choice = ABOUT_CHOICES.find(([v]) => v === d.about);
  const now = choice
    ? "About " + esc(choice[1]) + ' <span class="mc-dim">· marked by ' + esc(ABOUT_BY[d.aboutBy] || d.aboutBy || "someone unrecorded") + "</span>"
    : 'Not marked <span class="mc-dim">· nobody has said what it is about yet</span>';
  const opts = (choice ? "" : '<option value="" selected disabled>mark it as…</option>') +
    ABOUT_CHOICES.map(([v, label]) => '<option value="' + v + '"' + (v === d.about ? " selected" : "") + ">" + esc(label) + "</option>").join("");
  return '<div class="mc-about"><span class="mc-about-now">' + now + "</span>" +
    '<span class="mc-about-set"><select class="mc-about-pick" aria-label="what this memory is about">' + opts + "</select>" +
    '<input class="mc-about-why" type="text" maxlength="500" placeholder="why (optional)" aria-label="why">' +
    "<button class='copy' data-id=\"" + esc(d.id) + "\" onclick=\"markAbout(this)\">mark</button></span>" +
    "</div><div id='about-out'></div>";
}

/** Change the mark: `counterparts about <id> <mark> --why …`, as the owner. */
export async function markAbout(btn) {
  const id = btn.dataset.id || "";
  const box = btn.closest(".mc-about");
  const pick = box ? box.querySelector(".mc-about-pick") : null;
  const why = box ? box.querySelector(".mc-about-why") : null;
  const out = document.getElementById("about-out");
  const show = (html) => { if (out) out.innerHTML = html; };
  const about = pick ? pick.value : "";
  if (!about) return show("<div class='act-out act-refused'>Pick what it is about first.</div>");
  btn.disabled = true;
  const r = await act("about", { id, about, why: why && why.value.trim() ? why.value.trim() : undefined });
  btn.disabled = false;
  show(resultHtml(r));
  if (r && r.ok) window.dispatchEvent(new CustomEvent("counterparts:changed"));
}

/** The id, on demand — it is how the owner addresses this memory anywhere else
 *  (`counterparts recall`, the MCP tools, a note to themselves). Failure is
 *  silent and local: a clipboard a browser refuses is not worth a console
 *  error. */
export function copyId(btn) {
  const id = btn.dataset.id || "";
  const done = () => { btn.textContent = "copied"; setTimeout(() => { btn.textContent = "copy id"; }, 1400); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(id).then(done, () => { btn.textContent = "select it above"; });
      return;
    }
  } catch (e) { /* fall through */ }
  btn.textContent = id;
}

/**
 * REMOVE, the loud way — the console's own two steps. First the dry run
 * (`counterparts remove <id>`), whose plan is shown in the confirmation; then,
 * only once the owner has typed the id back, `remove <id> --confirm`, with what
 * they typed handed to the console's own prompt.
 */
export async function removeMemory(btn) {
  const id = btn.dataset.id || "";
  const out = document.getElementById("remove-out");
  const show = (html) => { if (out) out.innerHTML = html; };
  btn.disabled = true;
  const plan = await act("remove", { id });
  btn.disabled = false;
  if (plan.error || !plan.ok) return show(resultHtml(plan));
  const typed = await confirmTyped({
    title: "Remove this memory permanently?",
    bodyHtml: "<div style='color:var(--dim);margin-bottom:6px'>What the console plans to do:</div>" + resultHtml(plan),
    phrase: id,
    action: "remove it",
  });
  if (typed === null) return show("<div class='act-out'>Nothing was removed.</div>");
  show(resultHtml({ out: ["removing…"] }));
  const r = await act("remove", { id, confirm: typed });
  show(resultHtml(r));
  // Pages that list memories re-read now, not on the next poll.
  if (r && r.ok) window.dispatchEvent(new CustomEvent("counterparts:changed"));
}

// Every row on every page opens a memory through an inline `onclick` string.
window.openMemory = openMemory;
window.copyId = copyId;
window.removeMemory = removeMemory;
window.markAbout = markAbout;
