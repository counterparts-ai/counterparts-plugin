import { gradeWord, reportLines, summaryLine, tally, worstFirst } from "../claude-code/doctor.js";
import { fold, ui } from "./ui.js";
function laidOut(u) {
  return u.wraps || u.color;
}
function painter(p, grade) {
  return grade === "RED" ? p.red : grade === "AMBER" ? p.yellow : grade === "OFF" ? p.dim : p.green;
}
const HEADLINE = [
  "store",
  "host",
  "desktop",
  "embedder",
  "crash-write-up",
  "snapshot",
  "self-page"
];
const BACKGROUND_KEY = "background";
const GREEN_ORDER = [
  "store",
  "host",
  "desktop",
  "embedder",
  "crash-write-up",
  BACKGROUND_KEY,
  "snapshot",
  "self-page"
];
function foldable(internals) {
  return internals.length > 0 && internals.every((f) => f.severity === "green");
}
function backgroundLine(internals) {
  const spawn = internals.find((f) => f.key === "spawn");
  const started = spawn === undefined ? null : spawn.data["startsToday"];
  const ran = typeof started === "number" && started > 0;
  return {
    key: BACKGROUND_KEY,
    severity: "green",
    title: "Background",
    detail: ran ? "the nightly worker ran today; nothing failed" : "nothing has failed; the nightly worker has not run today",
    fix: "",
    data: { folded: internals.length, startsToday: ran ? started : null }
  };
}
function greenOrder(a, b) {
  const rank = (f) => {
    const i = GREEN_ORDER.indexOf(f.key);
    return i === -1 ? GREEN_ORDER.length : i;
  };
  return rank(a) - rank(b);
}
export function printDoctorReport(io, env, findings, today, layout = {}) {
  const u = ui(io, env);
  if (!laidOut(u)) {
    for (const line of reportLines(findings, today))
      io.out(line);
    return;
  }
  const ordered = worstFirst(findings);
  const internals = ordered.filter((f) => !HEADLINE.includes(f.key));
  const folded = layout.all !== true && foldable(internals);
  const rows = folded ? [...ordered.filter((f) => HEADLINE.includes(f.key)), backgroundLine(internals)] : ordered;
  io.out(u.paint.bold(`counterparts doctor — ${today}`));
  u.blank();
  let printed = 0;
  let worst = "GREEN";
  for (const grade of ["RED", "AMBER", "OFF", "GREEN"]) {
    const group = rows.filter((f) => gradeWord(f) === grade);
    if (group.length === 0)
      continue;
    if (printed > 0)
      u.blank();
    if (printed === 0)
      worst = grade;
    printed += 1;
    const lines = grade === "GREEN" && folded ? [...group].sort(greenOrder) : group;
    for (const f of lines) {
      if (f.optional === true)
        u.statusLine(grade, f.title, `${f.detail}  ${f.fix}`.trimEnd());
      else
        u.statusLine(grade, f.title, f.detail, f.fix);
    }
  }
  u.blank();
  const summary = summaryLine(tally(rows));
  const everyLine = folded ? "   Every line: counterparts doctor --all" : "";
  io.out(painter(u.paint, worst)(summary) + u.paint.dim(everyLine));
}
function labelWidth(rows) {
  return rows.reduce((w, r) => Math.max(w, r.label.length), 0);
}
export function printStatusReport(io, env, view) {
  const u = ui(io, env);
  if (!laidOut(u)) {
    for (const line of view.plain)
      io.out(line);
    return;
  }
  const emit = (prefix, text, hanging) => u.wraps ? fold(prefix, text, u.width, hanging) : [`${prefix}${text}`];
  const aside = (text) => {
    for (const line of emit("  ", text, 2))
      io.out(u.paint.dim(line));
  };
  io.out(`${u.paint.dim("Store:")} ${u.paint.cyan(view.dir)}`);
  for (const block of view.blocks) {
    if (block.rows.length === 0)
      continue;
    u.blank();
    u.heading(block.title);
    const width = labelWidth(block.rows) + 3;
    for (const row of block.rows) {
      const prefix = `  ${row.label.padEnd(width)}`;
      if (row.verbatim === true)
        io.out(`${prefix}${row.value}`);
      else
        for (const line of emit(prefix, row.value, 2 + width))
          io.out(line);
    }
    for (const note of block.notes ?? [])
      aside(note);
  }
  if (view.notes.length > 0) {
    u.blank();
    for (const note of view.notes)
      aside(note);
  }
  for (const section of view.tail) {
    u.blank();
    u.heading(section.title);
    for (const line of section.lines)
      io.out(line);
  }
}
