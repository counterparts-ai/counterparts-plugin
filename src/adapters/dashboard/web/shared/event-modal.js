/* One durable-log record, opened — from any feed row on any page. */
import { api, fail } from "./api.js";
import { esc } from "./dom.js";
import { openModal } from "./modal.js";

export async function openEvent(seq) {
  let d;
  try { d = await api("/api/event?seq=" + seq); } catch (e) { return fail("That event", e); }
  const e = d.event;
  openModal(
    "<h3>" + esc(e.name) + "</h3>" +
    "<div class='sub'>lived day " + e.day + " · " + esc(d.when || "") +
      " · sequence " + e.seq + (e.node ? " · " + esc(e.node) : "") + "</div>" +
    "<div class='body tone-" + e.tone + "'>" + esc(e.text) + "</div>" +
    (e.subject ? "<h4>subject</h4><div class='ref'>" + esc(e.subject) + "</div>" : "") +
    "<h4>the record itself</h4>" +
    "<div class='kv'>" + e.detail.map((p) =>
      '<div class="k">' + esc(p.key) + '</div><div class="v">' + esc(p.value) + "</div>").join("") + "</div>" +
    "<p style='color:var(--faint);font-size:10.5px;line-height:1.7'>Every value above is an id, a count, a byte figure, " +
    "a score or a closed-vocabulary reason. No memory's words and no turn of yours is ever written into this log — " +
    "which is why the names on this page had to be resolved from the store as it stands right now.</p>"
  );
}

window.openEvent = openEvent;
