/* The last sleep cycle, as one line with a dot per step. */
import { dateWords } from "../../../shared/dates.js";
import { $, esc } from "../../../shared/dom.js";

export const markup = `
    <div class="card pad hcy" id="h-cycle"></div>`;

/* The day comes dated from the server, in the person's zone (`views/health.ts`,
   `cycle.on` and `cycle.today`), so it agrees with every other date on the
   page; it read the browser's calendar until 2026-10-09. */
export function when(c) {
  if (c.today) return "today";
  if (c.on) return "on " + (dateWords(c.on) || c.on) + " (lived day " + c.day + ")";
  return "on lived day " + c.day;
}

const WORD = { ran: "finished in the last cycle", waiting: "not due yet", behind: "behind — last finished on lived day ", never: "has never run", torn: "its marker is unreadable" };

export function paint(d) {
  const c = d.cycle;
  const dots = c.phases.map((p) => {
    const tone = p.state === "ran" ? "green" : p.state === "waiting" ? "grey" : p.state === "never" && c.day === null ? "grey" : "amber";
    const said =
      p.state === "behind" ? WORD.behind + p.day
      : p.state === "waiting" ? WORD.waiting + (p.nextInDays === null ? "" : p.nextInDays === 0 ? " — due at the next sleep" : " — next in " + p.nextInDays + " lived day" + (p.nextInDays === 1 ? "" : "s"))
      : WORD[p.state];
    const title = p.phase + " — " + p.gloss + " (" + said + ")";
    return '<span class="hcy-dot hc-dot hc-' + tone + '" title="' + esc(title) + '" role="img" aria-label="' + esc(title) + '"></span>';
  }).join("");
  let line;
  if (c.day === null) line = "Sleep hasn't run yet — it runs after a session ends";
  else if (c.ran + (c.waiting ?? 0) === c.total) line = "Sleep last ran " + when(c) + ": all " + c.ran + " due steps" + (c.waiting ? " (" + c.waiting + " not due yet)" : "");
  else line = "Sleep last ran " + when(c) + ": " + c.ran + " of " + (c.total - (c.waiting ?? 0)) + " due steps finished";
  $("h-cycle").innerHTML = '<span class="hcy-line">' + esc(line) + '</span><span class="hcy-dots">' + dots + "</span>";
}
