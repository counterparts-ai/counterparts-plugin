/* "Is everything working?" — `counterparts doctor`, as a checklist with lights.

   The reading is the console's own: the page runs `doctor --json` through the
   actions seam (a READ — it writes nothing) and draws its findings, so this
   list and the terminal cannot disagree about what "healthy" means. It runs
   once when the tab is first built; "Check again" runs it again. The run is
   `shared/doctor.js`'s, which the home tab's health dot reads too. */
import { $, esc } from "../../../shared/dom.js";
import { doctorOnce, gradeOf, runDoctor, verdictOf } from "../../../shared/doctor.js";

export const markup = `
    <h2>Is everything working? <small>— the same checks as <code>counterparts doctor</code></small></h2>
    <div class="card hc" id="h-checks">
      <div class="hc-sum"><span class="hc-dot hc-grey"></span><span>Checking…</span></div>
    </div>`;

/**
 * Plain names for doctor's lines, by the finding's stable `key`. A key not
 * listed keeps doctor's own title, so a check added next month still shows.
 */
const NAMES = {
  store: "Your memory",
  host: "Connected to Claude Code",
  embedder: "Recall by meaning",
  "crash-write-up": "Session write-ups",
  snapshot: "Snapshots",
  "self-page": "Self page",
  config: "Settings file",
  checkout: "Code version",
  "store-open": "Memory opens",
  spawn: "Background worker",
  clock: "Clock",
  sweep: "Crash sweep",
  sleep: "Sleep",
  backfill: "Meaning index backfill",
  credit: "Recall credit",
  authorship: "Writing its own memories",
  journal: "Database journal",
  vectors: "Meaning vectors",
  retention: "Raw transcripts",
  "page-writer": "Self-page writer",
  "journal-copy": "Journal copy",
  fired: "Mechanisms",
  stance: "Mode",
  budget: "Time budget",
  retired: "Old settings",
  lookups: "Looked up in dreams and reflections",
  results: "What reached the model",
  wake: "Wake arrived whole",
};

/**
 * THE LINES THAT KEEP A ROW OF THEIR OWN however green they are — the
 * terminal's own allowlist (`cli/report.ts#HEADLINE`, read there and restated
 * here because a browser module cannot import it). Every other GREEN line
 * folds into one "Behind the scenes" row that opens to list them; anything
 * amber or red always gets its own row.
 */
const HEADLINE = ["store", "host", "embedder", "crash-write-up", "snapshot", "self-page"];

let state = { running: false };

/** A light for one grade. `off` is an optional feature nobody turned on;
 *  `unasked` is a check this page could not make (no configuration named). */
function dot(grade) {
  return '<span class="hc-dot hc-' + grade + '" role="img" aria-label="' +
    ({ green: "fine", amber: "look at this", red: "broken", grey: "not checked", off: "off" }[grade] || grade) + '"></span>';
}

/** Doctor leads many details with the store's path; the row reads without it. */
function plain(detail) {
  return String(detail || "").replace(/^\/\S+ — /, "").replace(/^\/\S+ /, "");
}

/** A line doctor's facts can say in plain words, by key; null keeps the detail. */
export const PLAIN = {
  // Doctor's count is memories proper (the wake's and `status`'s number); the
  // home and memories tabs count the cards for people and projects in too, so
  // this line says what it leaves out rather than show a second, smaller
  // "memories" with no reason (2026-09-28: 302 on home, 295 here).
  store: (d, detail) => {
    if (!d || typeof d.memories !== "number") return null;
    const n = d.memories;
    // Keep where the store is: doctor's detail opens with its path.
    const at = String(detail || "").split(" — ")[0];
    return (at && at !== String(detail || "") ? at + " — " : "") +
      n + (n === 1 ? " memory" : " memories") + ", not counting the cards for people and projects" +
      (/opens fine/.test(String(detail || "")) ? " · opens fine" : "");
  },
  // The self page: how long since its last rewrite, and — once that passes
  // doctor's own limit, which is what turns the row amber — that it has.
  "self-page": (d) => {
    if (!d || d.present !== true || typeof d.daysSince !== "number") return null;
    const n = d.daysSince;
    if (d.stale) {
      return "not rewritten in " + n + (n === 1 ? " day" : " days") +
        (typeof d.staleAfter === "number" ? "; this turns amber after " + d.staleAfter : "");
    }
    return "rewritten " + (n <= 0 ? "today" : n === 1 ? "yesterday" : n + " days ago") +
      (typeof d.version === "number" ? " · version " + d.version : "");
  },
  // Settings this version no longer reads. GREEN, so it folds under "all
  // fine": doctor's "you may remove them" is advice, and advice under a row
  // that says nothing needs doing read as a contradiction (Fable's review of
  // Health, 2026-09-28). Here it says what they are and that they are harmless;
  // the terminal's `doctor --all` still says where to remove them.
  retired: (d, detail) => {
    const s = String(detail || "");
    const cut = s.search(/ — ignored; you may remove /);
    if (cut <= 0) return null;
    return s.slice(0, cut) + " — harmless; nothing to do";
  },
  // Doctor's Lookups line, in words: of the memories a dream (or a
  // reflection) was shown only in part, how many it looked up (doctor's verb:
  // `fit/index.ts#noteLookups` counts every one looked up, whole or not), over
  // doctor's own window, with its nudge when none were.
  lookups: (d, detail) => {
    if (!d || typeof d.dreamNights !== "number") return null;
    const part = (looked, offered, runs, one, many) =>
      runs === 0 ? "no " + one + " measured yet"
        : looked + " of " + offered + " shown only in part were looked up, over " + runs + " " + (runs === 1 ? one : many);
    const window = /^last \d+ lived days?/.exec(String(detail || ""));
    const none = d.dreamNights + d.reflections > 0 && d.dreamOffered + d.reflectionOffered > 0 && d.dreamLooked + d.reflectionLooked === 0;
    return (window ? window[0] + " — " : "") +
      "dreams: " + part(d.dreamLooked, d.dreamOffered, d.dreamNights, "night", "nights") +
      "; reflections: " + part(d.reflectionLooked, d.reflectionOffered, d.reflections, "reflection", "reflections") +
      (none ? ". None looked up yet: if that holds, the lines may be too thin or the lookup unclear" : "") +
      (d.floor ? " (at least: more rows than were read)" : "");
  },
};

/** A finding's line: its plain words when `PLAIN` has them, else doctor's detail. */
export function lineOf(f) {
  return (PLAIN[f.key] && PLAIN[f.key](f.data, f.detail)) || plain(f.detail);
}

function row(i, f, grade, name, line) {
  return '<button type="button" class="hc-row" aria-expanded="false" data-i="' + i + '">' + dot(grade) +
    '<span class="hc-name">' + esc(name) + '</span><span class="hc-line">' + esc(line) + "</span></button>" +
    '<div class="hc-more" id="hc-more-' + i + '" hidden></div>';
}

function more(f) {
  return '<div class="hc-detail">' + esc(f.detail) + "</div>" +
    (f.fix ? '<div class="hc-fix"><b>What to do:</b> ' + esc(f.fix) + "</div>" : "") +
    '<div class="hc-key">doctor · ' + esc(f.key) + "</div>";
}

function paintFindings(report, when) {
  const box = $("h-checks");
  const rows = [];
  const details = [];
  const folded = [];
  let unasked = 0;
  for (const f of report.findings) {
    const grade = gradeOf(f);
    if (grade === "grey") unasked += 1;
    if (grade === "green" && !HEADLINE.includes(f.key)) { folded.push(f); continue; }
    const name = NAMES[f.key] || f.title;
    const line = grade === "grey"
      ? "not checked — this dashboard was opened on a store, not through its settings file"
      : lineOf(f);
    details.push(f);
    rows.push({ grade, name, line, f, order: HEADLINE.indexOf(f.key) });
  }
  // Worst first, then the headline order the terminal reads in.
  const rank = { red: 0, amber: 1, grey: 2, off: 3, green: 4 };
  rows.sort((a, b) => (rank[a.grade] - rank[b.grade]) || ((a.order < 0 ? 99 : a.order) - (b.order < 0 ? 99 : b.order)));
  const html = rows.map((r, i) => row(i, r.f, r.grade, r.name, r.line));
  const moreHtml = rows.map((r) => more(r.f));
  if (folded.length > 0) {
    const i = rows.length;
    html.push(row(i, null, "green", "Behind the scenes",
      folded.length + " background checks, all fine"));
    moreHtml.push('<ul class="hc-fold">' + folded.map((f) =>
      "<li>" + dot("green") + '<span class="hc-name">' + esc(NAMES[f.key] || f.title) + "</span>" +
      '<span class="hc-detail">' + esc(lineOf(f)) + "</span></li>").join("") + "</ul>");
  }
  const v = verdictOf(report);
  const head = dot(v.grade) + '<span class="hc-verdict">' + esc(v.words) + "</span>";
  const tail = [];
  tail.push(report.findings.length + " checks");
  if (unasked > 0) tail.push(unasked + " not checked");
  box.innerHTML =
    '<div class="hc-sum">' + head + '<span class="hc-sub">' + esc(tail.join(" · ")) + "</span></div>" +
    '<div class="hc-list">' + html.join("") + "</div>" +
    '<div class="hc-foot"><span>Checked ' + esc(when) + '</span>' +
    '<button type="button" class="act-btn hc-again" id="hc-again">Check again</button></div>';
  box.querySelectorAll(".hc-row").forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.i);
      const panel = $("hc-more-" + i);
      const open = panel.hidden;
      if (open && !panel.innerHTML) panel.innerHTML = moreHtml[i];
      panel.hidden = !open;
      b.setAttribute("aria-expanded", open ? "true" : "false");
    };
  });
  $("hc-again").onclick = run;
}

function paintProblem(message) {
  $("h-checks").innerHTML =
    '<div class="hc-sum">' + dot("grey") + '<span class="hc-verdict">Could not check</span></div>' +
    '<div class="hc-problem">' + esc(message) + "</div>" +
    '<div class="hc-foot"><span></span><button type="button" class="act-btn hc-again" id="hc-again">Try again</button></div>';
  $("hc-again").onclick = run;
}

/** Draw a reading: its findings, or why there are none. */
function paintReading(r) {
  if (r.problem !== undefined) return paintProblem(r.problem);
  paintFindings(r.report, r.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
}

/** Run `doctor --json` through the seam and draw what it said. */
export async function run() {
  if (state.running) return;
  state.running = true;
  const again = document.getElementById("hc-again");
  if (again) { again.disabled = true; again.textContent = "Checking…"; }
  try {
    paintReading(await runDoctor());
  } finally {
    state.running = false;
  }
}

/** The tab's first build: draw the reading there is, or make the first one. */
export async function runOnce() {
  paintReading(await doctorOnce());
}
