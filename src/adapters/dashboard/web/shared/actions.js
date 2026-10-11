/* Managing, as opposed to looking: the ONE place the page sends a POST.

   Every management action (a note, a removal, a backup, …) goes to
   `/api/action/<name>` on this same origin, as JSON, carrying the per-launch
   token the server put in this page's <meta>. The server runs it through the
   console's own commands (`web/actions.ts`) — the same code and the same
   refusals as typing it in a terminal — and hands back what the console said.

   `api.js` stays GET-only: looking never goes through here, and nothing here
   is used to look. */
import { esc } from "./dom.js";

function token() {
  const meta = document.querySelector('meta[name="counterparts-action-token"]');
  return meta ? meta.getAttribute("content") || "" : "";
}

/** Run one action. Resolves to the server's report: { exit, ok, out, err,
 *  command } when the console ran, { error } when this door refused. */
export async function act(name, fields) {
  const t = token();
  if (!t) return { error: "this page was served without an action token, so it cannot act. Reload it." };
  let res;
  try {
    res = await fetch("/api/action/" + encodeURIComponent(name), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-counterparts-token": t },
      body: JSON.stringify(fields || {}),
    });
  } catch (e) {
    return { error: "the dashboard did not answer (" + (e && e.message ? e.message : String(e)) + ")" };
  }
  try { return await res.json(); }
  catch (e) { return { error: "HTTP " + res.status }; }
}

/** What the console said, as a block: the command line, then its own lines. */
export function resultHtml(r) {
  if (!r) return "";
  const lines = [];
  if (r.command) lines.push('<div class="act-cmd">$ ' + esc(r.command) + "</div>");
  for (const l of r.out || []) lines.push("<div>" + esc(l) + "</div>");
  for (const l of r.err || []) lines.push('<div class="act-err">' + esc(l) + "</div>");
  if (r.truncated) lines.push('<div class="act-err">… (the rest was cut: too long to show here)</div>');
  if (r.error) lines.push('<div class="act-err">' + esc(r.error) + "</div>");
  const tone = r.error ? "bad" : r.ok ? "good" : "refused";
  return '<div class="act-out act-' + tone + '">' + lines.join("") + "</div>";
}
