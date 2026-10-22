/* The subjects tab (wave 2 lane D, 2026-10-21; design §7): who and what my
   memories are about, and what I believe about each.

   Two views, one tab:
     #subjects            the cloud (tags and subjects, sized by what is behind
                          them; a subject opens its page, a tag shows its
                          memories under the cloud), and every subject by kind.
     #subjects/<id>       one subject's page: its kind, name and aliases; its
                          strongest current beliefs, each with how strongly it
                          is held, how many memories hold it up, and those
                          memories; what it often comes up with; its recent
                          memories. `#subjects/me` is the page about me.

   Each thing is shown here and only here: the memory card links to a card's
   page ("Its page") and the self tab links to mine, rather than repeating them.

   LIVE. The pulse calls `refresh()` when the store moves: the view on screen is
   re-read and redrawn, the scroll position put back. */
import { api, fail } from "../../shared/api.js";
import { $, esc } from "../../shared/dom.js";
import { emptyBox } from "../../shared/absence.js";
import { n2 } from "../../shared/format.js";
import { openMemory } from "../../shared/memory-modal.js";
import { memRow, wireRows } from "../memories/row.js";
import { q, wireTips } from "../../shared/widgets/tips.js";

const markup = `
    <div id="subj-index">
      <h2 class="sp-title" id="subj-lede"></h2>
      <h2 id="subj-cloud-h">What my memories are about <span id="subj-cloud-q"></span></h2>
      <div class="card pad" id="subj-cloud"></div>
      <div id="subj-tag"></div>
      <h2 id="subj-all-h">Every subject <span id="subj-all-q"></span></h2>
      <div id="subj-all"></div>
    </div>
    <div id="subj-page" hidden></div>
  `;

/** What is on screen: the index (null) or a subject's id. */
let current = null;
/** The tag picked in the cloud, kept across a refresh. */
let pickedTag = null;

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

/** How a belief was born, in words (`memories.birth_route`). */
const ROUTE_WORDS = {
  reflection: "born in a reflection",
  session: "said in a session",
  dream: "proposed by a dream",
  correction: "from your correction",
  migrated: "carried over",
};

/** The page's anchor, read off the address: `#subjects/<id>` → id. */
function anchorOf() {
  const m = /^#subjects\/([^?]+)/.exec(location.hash || "");
  return m ? decodeURIComponent(m[1]) : null;
}

async function draw(id, force) {
  current = id;
  $("subj-index").hidden = id !== null;
  $("subj-page").hidden = id === null;
  const x = scrollX, y = scrollY;
  if (id === null) await drawIndex(force);
  else await drawPage(id, force);
  if (!force && (scrollX !== x || scrollY !== y)) scrollTo(x, y);
}

// ── the index: the cloud, then every subject ───────────────────────────────

async function drawIndex(force) {
  let d;
  try { d = await api("/api/subjects"); } catch (e) { if (force) fail("The subjects page", e); return; }
  $("subj-lede").textContent = lede(d);
  $("subj-cloud-q").innerHTML = q("subj-cloud",
    "Each word is a subject or a tag, sized by how many memories are behind it. The bright ones are subjects — " +
    "a person, project, place or topic with a page of its own; tap one to open it. The others are tags; tap one to see " +
    "its memories. Point at a word to light up the words it most often comes up with.");
  $("subj-all-q").innerHTML = q("subj-all",
    "Every subject, by kind, with how many memories name it and how many beliefs I hold about it. " +
    "A subject whose kind nobody has judged yet is \"not sorted yet\"; the night sorts them.");
  $("subj-cloud").innerHTML = cloudHtml(d);
  $("subj-all").innerHTML = allHtml(d);
  wireTips($("subj-index"));
  wireCloud($("subj-cloud"));
  await drawTag();
}

export function lede(d) {
  if (d.total === 0) return "No subjects yet. People, projects and places get a page here once my memories name them.";
  return plural(d.total, "subject", "subjects") + " · " +
    (d.beliefs === 0 ? "no beliefs about them yet" : plural(d.beliefs, "belief", "beliefs") + " about them");
}

export function cloudHtml(d) {
  if (d.cloud.length === 0) {
    return emptyBox((d.cloudAbsent || "(none yet)") + " — nothing for a cloud yet.",
      "Words appear here as my memories name people and projects, and as they carry tags.");
  }
  const words = d.cloud.map((w) => {
    // One key per line: a tag can hold spaces ("claude code").
    const near = esc(w.near.join("\n"));
    const title = w.subject
      ? (w.kind ? w.kind + " · " : "") + plural(w.weight, "memory", "memories") + " — open its page"
      : "tag · " + plural(w.weight, "memory", "memories");
    const cls = "cw s" + w.size + (w.subject ? " subj" : " tag") + (pickedTag && w.key === "t:" + pickedTag ? " on" : "");
    return w.subject
      ? '<a class="' + cls + '" href="#subjects/' + encodeURIComponent(w.subject) + '" data-key="' + esc(w.key) + '" data-near="' + near + '" title="' + esc(title) + '">' + esc(w.word) + "</a>"
      : '<button type="button" class="' + cls + '" data-tag="' + esc(w.word) + '" data-key="' + esc(w.key) + '" data-near="' + near + '" title="' + esc(title) + '">' + esc(w.word) + "</button>";
  }).join(" ");
  const note = d.tagged ? "" :
    '<p class="cloud-note">Only subjects for now: tags join the cloud once my memories carry them.</p>';
  const more = d.cloudMore > 0 ? '<p class="cloud-note">' + plural(d.cloudMore, "smaller word", "smaller words") + " left out for room.</p>" : "";
  return '<div class="cloud">' + words + "</div>" + note + more;
}

/** Point at a word: it and the words it comes up with stay lit, the rest dim. */
function wireCloud(box) {
  const cloud = box.querySelector(".cloud");
  if (!cloud) return;
  const light = (el) => {
    if (!el) { cloud.classList.remove("focus"); cloud.querySelectorAll(".lit").forEach((w) => w.classList.remove("lit")); return; }
    const near = new Set((el.dataset.near || "").split("\n").filter(Boolean));
    cloud.classList.add("focus");
    cloud.querySelectorAll(".cw").forEach((w) => w.classList.toggle("lit", w === el || near.has(w.dataset.key)));
  };
  cloud.addEventListener("mouseover", (e) => light(e.target.closest(".cw")));
  cloud.addEventListener("mouseleave", () => light(null));
  cloud.addEventListener("focusin", (e) => light(e.target.closest(".cw")));
  cloud.addEventListener("focusout", () => light(null));
  cloud.addEventListener("click", (e) => {
    const t = e.target.closest("button.cw");
    if (!t) return;
    pickedTag = pickedTag === t.dataset.tag ? null : t.dataset.tag;
    cloud.querySelectorAll("button.cw").forEach((w) => w.classList.toggle("on", w.dataset.tag === pickedTag));
    drawTag();
  });
}

/** The tag picked in the cloud: its memories and what it comes up with. */
async function drawTag() {
  const box = $("subj-tag");
  if (!pickedTag) { box.innerHTML = ""; return; }
  let t;
  try { t = await api("/api/tag?tag=" + encodeURIComponent(pickedTag)); } catch (e) { box.innerHTML = ""; return; }
  const near = t.near.length ? '<p class="subj-near"><span class="subj-k">often with</span> ' + nearHtml(t.near) + "</p>" : "";
  const rows = t.memories.length
    ? '<div class="subj-refs">' + t.memories.map((m) => ref(m.id, m.text, "")).join("") + "</div>" +
      (t.total > t.memories.length ? '<p class="cloud-note">The newest ' + t.memories.length + " of " + t.total + ".</p>" : "")
    : emptyBox((t.absent || "(none yet)") + " — no live memory carries this tag.");
  box.innerHTML = '<div class="card pad subj-tagbox"><h3>' + esc(t.tag) + ' <span class="subj-dim">· tag · ' +
    plural(t.total, "memory", "memories") + "</span></h3>" + near + rows + "</div>";
}

export function allHtml(d) {
  if (d.groups.length === 0) {
    return emptyBox((d.absent || "(none yet)") + " — no subjects yet.",
      "A person, project or place gets a card, and a page here, once my memories have named it on a few days.");
  }
  const meLink = d.self ? "" :
    '<p class="cloud-note">No page about me yet: it is made with my first belief about myself.</p>';
  return '<div class="card pad subj-groups">' + d.groups.map((g) =>
    '<div class="subj-group"><h3>' + esc(g.label) + ' <span class="subj-dim">' + g.subjects.length + "</span></h3>" +
    '<div class="subj-chips">' + g.subjects.map(chipHtml).join("") +
    "</div></div>").join("") + meLink + "</div>";
}

/** One subject in the list: its name, then what is behind it — memories that
 *  mention it (left out when there are none), beliefs, and how many cards
 *  share its name when it is more than one. */
export function chipHtml(s) {
  const parts = [];
  if (s.memories > 0) parts.push(String(s.memories));
  if (s.beliefs > 0) parts.push(plural(s.beliefs, "belief", "beliefs"));
  if (s.cards > 1) parts.push("(" + s.cards + " cards)");
  const title = plural(s.memories, "memory mentions it", "memories mention it") +
    (s.cards > 1 ? " · " + s.cards + " cards share this name" : "");
  return '<a class="subj-chip" href="#subjects/' + encodeURIComponent(s.id) + '" title="' + esc(title) + '">' + esc(s.name) +
    (parts.length ? '<span class="subj-dim"> ' + esc(parts.join(" · ")) + "</span>" : "") + "</a>";
}

// ── one subject's page ─────────────────────────────────────────────────────

async function drawPage(id, force) {
  let d;
  try { d = await api("/api/subject?id=" + encodeURIComponent(id)); } catch (e) { if (force) fail("That subject's page", e); return; }
  const box = $("subj-page");
  box.innerHTML = pageHtml(d);
  wireTips(box);
  const rows = box.querySelector(".subj-mem");
  if (rows) wireRows(rows);
}

const back = '<p class="subj-back"><a href="#subjects">← every subject</a></p>';

export function pageHtml(d) {
  if (!d.found) return back + '<h2 class="sp-title">' + esc(d.id === "me" ? "Me" : d.id) + "</h2>" + emptyBox(d.absent);
  const aka = d.aliases.length ? '<p class="subj-aka">also called ' + d.aliases.map(esc).join(", ") + "</p>" : "";
  const kind = '<span class="subj-kind' + (d.kind ? "" : " unsorted") + '">' + esc(d.self ? "me — and us" : d.kindWords) + "</span>" +
    (d.owner ? '<span class="subj-kind">the person I work with</span>' : "");
  const head = back + '<h2 class="sp-title subj-name">' + esc(d.name) + " " + kind + "</h2>" + aka +
    (d.text && !d.self && d.text.toLowerCase() !== d.name.toLowerCase() ?'<p class="subj-card" data-open="' + esc(d.id) + '">' + esc(d.text) + "</p>" : "");
  const about = d.self ? "What I believe about myself, and about us" : "What I believe about " + d.name;
  const beliefs = '<h2>' + esc(about) + " " + q("subj-beliefs",
    "Each belief is a memory of its own, born weak and earned by life: the memories that hold it up are counted once each, " +
    "and more from new days than from one. Strength is how strongly it is held today. Tap a memory to open it.") + "</h2>" +
    (d.beliefs.length
      ? '<div class="subj-beliefs">' + d.beliefs.map(beliefHtml).join("") + "</div>" +
        (d.beliefsMore > 0 ? '<p class="cloud-note">' + plural(d.beliefsMore, "weaker belief", "weaker beliefs") + " not shown.</p>" : "")
      : emptyBox((d.beliefsAbsent || "(none yet)") + " — no beliefs " + (d.self ? "about me" : "about " + d.name) + " yet.",
        "Beliefs are born at night from what keeps coming up, and grow as more memories back them."));
  const near = d.near.length
    ? '<h2>Often comes up with</h2><div class="card pad"><p class="subj-near">' + nearHtml(d.near) + "</p></div>"
    : "";
  // My memories about me and us are the self tab's; this page links there rather than repeat them.
  const mems = d.self && d.memories.length === 0
    ? '<p class="subj-back"><a href="#self">My memories about me and about us are on the self tab →</a></p>'
    : '<h2>Memories that mention ' + esc(d.self ? "me" : d.name) + (d.memoriesTotal > d.memories.length
    ? ' <span class="subj-dim">· the newest ' + d.memories.length + " of " + d.memoriesTotal + "</span>" : "") + "</h2>" +
    (d.memories.length
      ? '<div class="card subj-mem">' + d.memories.map((m) => memRow({ ...m, journal: false, archived: null, hold: null })).join("") + "</div>"
      : emptyBox((d.memoriesAbsent || "(none yet)") + " — no live memory names " + (d.self ? "me" : d.name) + " yet."));
  return head + beliefs + near + mems;
}

function beliefHtml(b) {
  const pctW = Math.round(Math.max(0, Math.min(1, b.strength)) * 100);
  const held = b.support === 0
    ? "nothing holds it up yet"
    : "held up by " + plural(b.support, "memory", "memories") + (b.supportDays > 1 ? " over " + b.supportDays + " days" : "");
  const against = b.contrary > 0 ? " · " + b.contrary + " against" : "";
  const chips = [];
  if (b.about === "us") chips.push('<span class="subj-chip2">about us</span>');
  if (b.core) chips.push('<span class="subj-chip2 core">★ core</span>');
  if (b.protected) chips.push('<span class="subj-chip2">locked</span>');
  if (b.route) chips.push('<span class="subj-chip2">' + esc(ROUTE_WORDS[b.route] || b.route) + "</span>");
  if (b.confidence !== null && b.confidence !== undefined) chips.push('<span class="subj-chip2">confidence ' + n2(b.confidence) + "</span>");
  const sources = b.sources.length
    ? '<details class="subj-src"><summary>' + plural(b.sources.length + b.sourcesMore, "memory", "memories") + " behind it</summary>" +
      '<div class="subj-refs">' + b.sources.map((s) => ref(s.id, s.text, s.stance === "support" ? "" : s.stance === "contrary" ? "against" : "cited")).join("") + "</div>" +
      (b.sourcesMore > 0 ? '<p class="cloud-note">and ' + b.sourcesMore + " more — open the belief to see them all.</p>" : "") +
      "</details>"
    : "";
  return '<div class="card pad subj-belief">' +
    '<p class="subj-btext" role="button" tabindex="0" data-open="' + esc(b.id) + '">' + esc(b.text) + "</p>" +
    '<div class="subj-bmeta"><span class="subj-meter" title="how strongly it is held today: ' + n2(b.strength) + '"><span style="width:' + pctW + '%"></span></span>' +
    '<span class="subj-strength" title="how strongly it is held today">' + n2(b.strength) + "</span>" +
    '<span class="subj-dim">' + esc(held + against) + "</span>" + chips.join("") + "</div>" +
    sources + "</div>";
}

function ref(id, text, role) {
  return '<div class="ref" role="button" tabindex="0" data-open="' + esc(id) + '">' +
    (role ? '<span class="role">' + esc(role) + "</span>" : "") + esc(text) + "</div>";
}

function nearHtml(near) {
  return near.map((n) => n.subject
    ? '<a class="subj-chip" href="#subjects/' + encodeURIComponent(n.subject) + '">' + esc(n.tag) + '<span class="subj-dim"> ' + n.together + "</span></a>"
    : '<span class="subj-chip tag">' + esc(n.tag) + '<span class="subj-dim"> ' + n.together + "</span></span>").join("");
}

/** Anything carrying `data-open` opens that memory's card (one listener for the tab). */
function wireOpen(section) {
  const open = (e) => {
    const el = e.target.closest("[data-open]");
    if (!el || !section.contains(el) || el.closest(".subj-mem")) return;
    openMemory(el.dataset.open);
  };
  section.addEventListener("click", open);
  section.addEventListener("keydown", (e) => { if (e.key === "Enter") open(e); });
}

export default {
  name: "subjects",
  mount(section) {
    section.innerHTML = markup;
    wireOpen(section);
    // A correction or a mark made on purpose: re-read now rather than on the next poll.
    addEventListener("counterparts:changed", () => { draw(current, false); });
  },
  render: () => draw(anchorOf(), true),
  /** The store moved (the pulse): re-read what is on screen. */
  refresh: () => draw(current, false),
  /** Back on the tab, or back to `#subjects` from a page: draw what the address says. */
  show: () => { const a = anchorOf(); if (a !== current) { scrollTo(0, 0); return draw(a, true); } },
  /** `#subjects/<id>` (and `#subjects/me`): that subject's page. */
  route({ anchor }) {
    if (anchor === current) return;
    scrollTo(0, 0);
    return draw(anchor, true);
  },
};
