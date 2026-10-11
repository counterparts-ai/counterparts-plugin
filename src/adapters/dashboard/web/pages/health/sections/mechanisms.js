/* "How the memory works" — the mechanism panel, the site's Explorer with this
   store in it. It lived under the brain on the home tab until round 4
   (2026-09-28), when it moved here, to the bottom of Health: the things useful
   to the people building the memory live on this tab. Its behaviour did not
   change. The brain stayed on Home; clicking one of its regions opens this
   section with that region's mechanism picked (`#health/mechanisms?id=<id>`,
   `open` below).

   The pills are ONE small line that scrolls sideways: each carries its stage
   as a small colour mark (the site's four colours; no headings), its light
   (from `/api/mechanisms`: fired lately, waiting, quiet, not built) and, when
   only some of it is built, a "partly built" tag.

   Picking one shows it INLINE, the same three things for every mechanism, all
   about OUR memories:
     1. one big number (the light's `lead`, from the evidence line);
     2. those memories: a short list or a small picture, each opening its card
        (`mechanisms/<id>/panel.js`, fed by `/api/mechanism?id=`);
     3. one short line saying what the mechanism does (the module's `does`).
   Everything else — the site's line, the long explainer, the firing line,
   what is built and still in development, the last few firings and the link
   to the Field Guide — is behind one "how it works" fold, closed by default.

   The pick and the fold survive the page's four-second refresh: they live
   here, in module scope (the fold also in sessionStorage, for this tab's
   session), and a refresh repaints the lights and the picked panel's data
   under them. */
import { FAMILIES, MECHANISMS, PANELS, guideUrl } from "../../../mechanisms/index.js";
import { api, fail } from "../../../shared/api.js";
import { $, esc } from "../../../shared/dom.js";
import "../../../shared/memory-modal.js"; // window.openMemory, for the pictures' rows
import { renderFeed } from "../../../shared/widgets/feed.js";
import { LIGHT_WORD, light } from "../../../shared/widgets/light.js";
import { q, wireTips } from "../../../shared/widgets/tips.js";

const LEGEND =
  "The small colour mark is the stage a mechanism works in: " + FAMILIES.map((f) => f.label.toLowerCase()).join(", ") + ". " +
  "A green light fired in the last 7 lived days. A ring is waiting: its next run is ahead, or it has nothing to act on yet. " +
  "Amber is built but quiet. Grey is not built yet. \"Partly built\" means some of it works and some is still to come. " +
  "The line scrolls sideways.";

/** How each kind of memory fades and gives way to a correction, in plain words
 *  (moved here from the memories tab's kinds `?`, round 4, 2026-09-28). The
 *  ordering is the physics' κ/ι said aloud (`views/memories.ts#KIND_PLAIN`). */
export const KINDS_LINE =
  "Kinds of memory fade at different speeds. Plain facts fade fastest, things and places fairly fast, " +
  "people and what I know about myself slowly, and skills slowest of all. Facts and places are the easiest " +
  "to correct; what I know about myself is the hardest to argue me out of.";

export const markup = `
    <h2 id="h-mechanisms-h">How the memory works</h2>
    <p class="mech-kinds">${KINDS_LINE}</p>
    <section class="mech-card" id="mech-panel" aria-labelledby="mech-title">
      <div class="mech-top">
        <div class="mechs" id="mech-strip" role="group" aria-label="Memory mechanisms"></div>
        <span class="mech-legend">${q("mech-lights", LEGEND)}</span>
      </div>
      <div class="mech-body" id="mech-body"></div>
    </section>`;

/** Wire the legend's `?` and the strip's arrow keys once the markup is in the page. */
export function mount() {
  wireTips($("mech-panel"));
  $("mech-strip").addEventListener("scroll", edges, { passive: true });
  addEventListener("resize", edges);
  $("mech-strip").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    const pills = [...document.querySelectorAll("#mech-strip .mech-pill")];
    const at = pills.indexOf(document.activeElement);
    if (at < 0) return;
    const to = e.key === "Home" ? 0 : e.key === "End" ? pills.length - 1 : at + (e.key === "ArrowRight" ? 1 : -1);
    if (to < 0 || to >= pills.length) return;
    e.preventDefault();
    pills[to].focus();
  });
}

const ORDER = MECHANISMS.map((m) => m.id);
const byIdStatic = Object.fromEntries(MECHANISMS.map((m) => [m.id, m]));
const familyOf = (m) => FAMILIES.find((f) => f.key === m.family) || FAMILIES[0];

let lights = {}; // id → { status, evidence, events, lead }
let selected = null;
let panelData = {}; // id → the /api/mechanism payload last read
let asked = 0;

// THE FOLD: closed by default, and once opened it stays open for this tab's
// session — across the pulse's repaint and across picks.
const HOW_KEY = "counterparts.mechanisms.how";
let howOpen = (() => {
  try { return sessionStorage.getItem(HOW_KEY) === "1"; } catch { return false; }
})();
function setHow(open) {
  howOpen = open;
  try { sessionStorage.setItem(HOW_KEY, open ? "1" : "0"); } catch { /* private window: module scope still holds it */ }
}

const lightOf = (id) => lights[id] || { status: "grey", build: "not", evidence: "", events: [], lead: null };
/** A pill's tag: only the partly built say so. Built needs no tag; grey is not built. */
const tagOf = (id) => lightOf(id).build === "partly" ? '<span class="mech-tag">partly built</span>' : "";

function paintStrip() {
  const strip = $("mech-strip");
  const keep = strip.scrollLeft;
  strip.innerHTML = MECHANISMS.map((m) => {
    const f = familyOf(m);
    return '<button type="button" class="mech-pill' + (m.id === selected ? " is-on" : "") +
      (lightOf(m.id).build === "not" ? " is-notbuilt" : "") + '" data-id="' + esc(m.id) + '" style="--pin:' + f.color + '"' +
      ' aria-pressed="' + (m.id === selected ? "true" : "false") + '" title="' + esc(m.name + " · " + f.label) + '">' +
      '<span class="mech-stage" role="img" aria-label="' + esc(f.label) + '"></span>' +
      light(lightOf(m.id).status) + esc(m.short) + tagOf(m.id) + "</button>";
  }).join("");
  strip.scrollLeft = keep;
  for (const el of strip.querySelectorAll(".mech-pill")) {
    el.addEventListener("click", () => select(el.dataset.id));
  }
  edges();
}

/** A soft fade on the side that has more pills past it, so the line reads as scrollable. */
function edges() {
  const strip = $("mech-strip");
  if (!strip) return;
  strip.classList.toggle("more-left", strip.scrollLeft > 2);
  strip.classList.toggle("more-right", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
}

/** Bring the picked pill inside the strip's own scroll, without moving the page. */
function revealPill(id) {
  const strip = $("mech-strip");
  const el = strip && strip.querySelector('.mech-pill[data-id="' + id + '"]');
  if (!el) return;
  const left = el.offsetLeft - strip.offsetLeft;
  const right = left + el.offsetWidth;
  if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 24);
  else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 24;
  edges();
}

const bullets = (xs) => xs.length === 0 ? "" : '<ul class="mech-list">' + xs.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";

/** The big number: one number and a few words, from the light's `lead`. */
function leadHtml(l) {
  if (l.status === "grey" || !l.lead) return '<p class="mech-lead mech-lead-none">Not built yet.</p>';
  return '<p class="mech-lead"><span class="mech-n">' + esc(String(l.lead.n)) + '</span> <span class="mech-words">' + esc(l.lead.words) + "</span></p>";
}

/** The picked mechanism's panel. The words are the client module's; the light,
 *  the number, the picture and the activity are this store's. */
function paintBody() {
  const m = byIdStatic[selected];
  if (!m) return;
  const l = lightOf(m.id);
  const grey = l.status === "grey";
  const panel = PANELS[m.id];
  const data = panelData[m.id];
  $("mech-panel").style.setProperty("--reg", familyOf(m).color);
  let picture;
  if (grey) {
    picture = '<div class="mech-notbuilt">' + esc(l.evidence || "Not built yet.") + "</div>";
  } else if (!panel) {
    picture = "";
  } else if (data === undefined) {
    picture = '<p class="pic-none">reading this store…</p>';
  } else {
    picture = '<div class="mech-picture">' + panel.picture(data.picture) + "</div>";
  }
  $("mech-body").innerHTML =
    '<div class="mech-grid">' +
      '<div class="mech-main">' +
        '<h2 class="mech-name" id="mech-title">' + esc(m.name) + (l.build === "partly" ? ' <span class="mech-dev">partly built</span>' : "") + "</h2>" +
        leadHtml(l) +
        '<p class="mech-does">' + esc(m.does || "") + "</p>" +
      "</div>" +
      '<div class="mech-side">' + picture + "</div>" +
    "</div>" +
    '<details class="mech-how" id="mech-how"' + (howOpen ? " open" : "") + ">" +
      '<summary><span class="mech-how-l">how it works</span> <span class="mech-how-arrow" aria-hidden="true">↓</span></summary>' +
      '<div class="mech-how-body">' +
        '<p class="mech-quote">' + esc(m.tagline) + "</p>" +
        '<p class="mech-explainer">' + esc(m.explainer) + "</p>" +
        '<p class="mech-evidence">' + light(l.status) + " <b>" + esc(LIGHT_WORD[l.status] || "") + "</b> — " + esc(l.evidence) + "</p>" +
        '<div class="mech-foot">' +
          '<div><h3 class="mech-h">What’s built</h3>' + (bullets(m.built) || '<p class="pic-none">Nothing yet.</p>') + "</div>" +
          '<div><h3 class="mech-h">Still in development</h3>' + (bullets(m.inDevelopment) || '<p class="pic-none">Nothing outstanding for this one.</p>') + "</div>" +
        "</div>" +
        (grey ? "" : '<h3 class="mech-h">Lately</h3><div class="card feed mech-feed" id="mech-feed"></div>') +
        '<p class="mech-guide"><a href="' + esc(guideUrl(m.id)) + '" target="_blank" rel="noopener">see how it works on counterparts.ai →</a></p>' +
      "</div>" +
    "</details>";
  $("mech-how").addEventListener("toggle", (e) => setHow(e.currentTarget.open));
  if (!grey) {
    const feed = $("mech-feed");
    if (data === undefined) feed.innerHTML = '<p class="pic-none" style="padding:10px 14px">reading this store…</p>';
    else if (data.activity.length === 0) feed.innerHTML = '<p class="pic-none" style="padding:10px 14px">No firing of this one is on record yet.</p>';
    else renderFeed(feed, data.activity);
  }
  // A picture may carry its own `?` (the returns and used-rate lines); a
  // pinned one is drawn open again by `q`, so a refresh keeps it open.
  wireTips($("mech-body"));
}

async function loadPanel(id) {
  if (lightOf(id).status === "grey") return;
  const ticket = ++asked;
  let d;
  try { d = await api("/api/mechanism?id=" + encodeURIComponent(id)); } catch (e) { return fail("The " + id + " panel", e); }
  panelData[id] = d;
  if (ticket === asked && id === selected) paintBody();
}

/** Pick a mechanism (a pill, or the brain on the home tab via `open`). */
export function select(id) {
  if (!byIdStatic[id]) return;
  selected = id;
  for (const el of document.querySelectorAll("#mech-strip .mech-pill")) {
    const on = el.dataset.id === id;
    el.classList.toggle("is-on", on);
    el.setAttribute("aria-pressed", on ? "true" : "false");
  }
  revealPill(id);
  paintBody();
  loadPanel(id);
}

/** `#health/mechanisms?id=<id>` (the home tab's brain): pick it and bring the section into view. */
export function open(id) {
  if (id) select(id);
  const h = $("h-mechanisms-h");
  if (h) h.scrollIntoView({ block: "start" });
}

/** Lights in: repaint the strip. */
function paint(view) {
  lights = Object.fromEntries(view.mechanisms.map((l) => [l.id, l]));
  if (selected === null) {
    selected = ORDER.find((id) => lightOf(id).status === "green") || ORDER[0];
  }
  paintStrip();
}

export async function render() {
  let view;
  try { view = await api("/api/mechanisms"); } catch (e) { return fail("The mechanisms", e); }
  paint(view);
  revealPill(selected);
  paintBody();
  await loadPanel(selected);
}

/** The store moved: new lights, and the picked panel's data read again (the
 *  others are dropped, so picking one later reads it fresh). */
export async function refresh() {
  let view;
  try { view = await api("/api/mechanisms"); } catch (e) { return; }
  paint(view);
  const keep = panelData[selected];
  panelData = keep === undefined ? {} : { [selected]: keep };
  await loadPanel(selected);
}
