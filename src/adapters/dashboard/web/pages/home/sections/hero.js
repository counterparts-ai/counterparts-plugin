/* The headline across the top (home round 4, 2026-09-28): one line — whose
   memory this is, how many it holds, how many are new today — and beside it a
   small health dot that says doctor's reading in a few words and links to the
   Health tab. That dot is the whole of Health on Home.

   The headline is `/api/overview`'s `hero.headline`; the dot is
   `shared/doctor.js`'s reading, the same run the Health tab draws. */
import { $, esc } from "../../../shared/dom.js";
import { onDoctor, verdictOf } from "../../../shared/doctor.js";

export const markup = `
    <section class="home-top" aria-label="This memory, today">
      <p class="home-headline" id="home-headline"></p>
      <a class="home-health" id="home-health" href="#health">${dot("grey")}<span>checking…</span></a>
    </section>`;

function dot(grade) {
  return '<span class="hc-dot hc-' + grade + '" aria-hidden="true"></span>';
}

export function mount() {
  onDoctor((r) => {
    const el = $("home-health");
    if (!el) return;
    if (r.problem !== undefined) {
      el.innerHTML = dot("grey") + "<span>not checked</span>";
      el.title = "Health could not run its checks: " + r.problem;
      return;
    }
    const v = verdictOf(r.report);
    el.innerHTML = dot(v.grade) + "<span>" + esc(v.words) + "</span>";
    el.title = "The same checks as counterparts doctor — open Health";
  });
}

/** "Day 7 with Mike · 306 memories · 13 new today": each part is its own span,
 *  so a narrow screen breaks between parts, never inside one. */
export function paint(d) {
  const el = $("home-headline");
  const parts = d.hero.headline.split(" · ");
  const nodes = [];
  parts.forEach((part, i) => {
    if (i > 0) nodes.push(document.createTextNode(" "));
    const s = document.createElement("span");
    s.className = "hh-part";
    s.textContent = part + (i < parts.length - 1 ? " ·" : "");
    nodes.push(s);
  });
  el.replaceChildren(...nodes);
}

/** One of the headline's numbers — "memories" or "new today" — READ OFF THE
 *  PAGE rather than out of a variable: the flow diagram's counters were proved
 *  live while the home counts beside them were not, and a harness that asked
 *  the payload would have believed a page that never repainted.
 *  (`tools/visual-loop` and the live test call this.) */
window.homeCount = (label) => {
  const text = ($("home-headline") && $("home-headline").textContent) || "";
  const m = label === "memories" ? /(\d+) memor(?:y|ies)\b/.exec(text) : label === "new today" ? /(\d+) new today/.exec(text) : null;
  return m ? m[1] : label === "new today" && text ? "0" : "";
};
