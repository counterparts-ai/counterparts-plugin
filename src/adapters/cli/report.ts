/**
 * `adapters/cli/report.ts` — the two readings a person actually looks at,
 * rendered for a terminal.
 *
 * ── The finding ─────────────────────────────────────────────────────────────
 *
 * New-user findings #5 (2026-09-21), in the owner's words: "all prompts/
 * terminal instructions should be more user friendly, better formatted, etc. if
 * we can use color for doctor we should." `doctor` and `status` are the two
 * commands a new install is CHECKED with, and both printed a dense block of
 * long unbroken lines with no spacing and no colour.
 *
 * ── The one rule this file exists to hold ───────────────────────────────────
 *
 * **A PIPE GETS THE WHOLE READING, from the function that has always produced
 * it.** A pipe, a test console, a CI job, `tools/install-loop/run.sh`, `--json`
 * — every one of them gets every finding, in worst-first order, out of
 * `reportLines` (and the `io.out` sequence `statusCommand` already had). The
 * laid-out arm is reached only when the console has told us it is a terminal
 * (`io.tty`) or that it wants colour anyway (`FORCE_COLOR`), which is `ui.ts`'s
 * existing split between wrapping and colour.
 *
 * Until 2026-09-22 this rule was stated as "plain output never changes, not a
 * byte", and it was kept. The owner's answers of that day changed the WORDS —
 * the labels, the grades, the summary — so what transfers is the half that
 * still means something: what a script sees is complete, ordered and folded by
 * nothing. The terminal may hide a line; a pipe may not.
 *
 * That is why both functions take the findings/the view rather than the store:
 * the READING is one thing, computed once, and this file only decides how it is
 * laid out. A second renderer that recomputed anything would be a second reading
 * that could disagree with the first.
 *
 * ── Why the grouping and not just colour ────────────────────────────────────
 *
 * `reportLines` is already worst-first (`worstFirst`), and QUICKSTART §12 says
 * so — that order is kept exactly. What the terminal arm adds is a BLANK LINE
 * between the reds, the ambers and the greens, so that "how bad is it" is
 * answered by the shape of the screen before a word is read, and a message that
 * runs past the width is folded with a hanging indent instead of wrapping back
 * into column zero where it reads as a new finding.
 */

import type { Finding, GradeWord } from "../claude-code/doctor.js";
import { gradeWord, reportLines, summaryLine, tally, worstFirst } from "../claude-code/doctor.js";
import type { Io } from "./commands.js";
import type { Grade, Paint, Ui, UiEnv } from "./ui.js";
import { fold, ui } from "./ui.js";

/**
 * Does this console get the laid-out arm at all?
 *
 * Either half of `ui.ts`'s split is enough: a terminal (so the fold is wanted)
 * or colour asked for on a pipe (`FORCE_COLOR`, so the escapes are wanted). A
 * console with neither — every test, every pipe, the install loop — takes the
 * byte-identical arm, and that is the whole safety property of this file.
 */
function laidOut(u: Ui): boolean {
  return u.wraps || u.color;
}

/** The colour a grade is written in, from the one `Paint` this console has. */
function painter(p: Paint, grade: GradeWord): (s: string) => string {
  return grade === "RED" ? p.red : grade === "AMBER" ? p.yellow : grade === "OFF" ? p.dim : p.green;
}

/**
 * THE LINES THAT KEEP A ROW OF THEIR OWN however green they are — the five
 * things the owner's screen of 2026-09-22 names, plus the two optional ones.
 *
 * It is an ALLOWLIST rather than a list of what folds, and that is deliberate:
 * the owner's answer named thirteen worker-internal lines, and a fourteenth
 * added next month would otherwise arrive on a screen that is meant to hold
 * five. What a person came for is a short list and it changes rarely; what the
 * background half is made of is a long list and it changes often.
 *
 * `store-open` is NOT here: green, it is the `, opens fine` on the Memory line
 * (`doctor.ts#memoryDetail`); red or amber it prints, like every other
 * non-green, with its own code and its own repair.
 */
//
// The crash write-up's line is #192's `crash-write-up` (`doctor.ts#
// crashWriteUpFindings`). The older `crash-writeup` finding is retired (review of
// #195, MINOR 6), so it is not listed.
const HEADLINE: readonly string[] = [
  "store",
  "host",
  "desktop",
  "embedder",
  "crash-write-up",
  "snapshot",
  "self-page",
];

/**
 * The order the GREEN rows read in, once they are folded — not worst-first (they
 * are all green) but the sentence a person reads: here is your memory, here is
 * what is joined up to it, the background half ran, and these two are what it
 * left behind. Anything green and not named here follows in the reading's own
 * order.
 */
/** The key the folded line carries. Not a finding's key — nothing produced it —
 *  so it is spelled once, here, and collides with none of them. */
const BACKGROUND_KEY = "background";

// The two optional features read right after the connection when they are ON
// (roadmap C3): a fresh terminal install has recall by meaning switched on, so
// its green line belongs beside the two things it depends on, not after the
// self page.
const GREEN_ORDER: readonly string[] = [
  "store",
  "host",
  "desktop",
  "embedder",
  "crash-write-up",
  BACKGROUND_KEY,
  "snapshot",
  "self-page",
];

export interface DoctorLayout {
  /** `--all`: print every line, folding nothing. */
  readonly all?: boolean;
}

/**
 * THE FOLD (the owner's answer 12, 2026-09-22).
 *
 * Thirteen of doctor's lines are readings of the background half — Sweep,
 * Sleep, Backfill, Credit, Clock, Spawn, Journal mode, Checkout, Page writer,
 * Fired, Authorship, Mode, Store open. Each is there because a real morning
 * went wrong and nothing said so, and each is unreadable to the person who has
 * just installed this: finding #20 is the owner reading "owner: this host
 * encodes" and asking what it means.
 *
 * So when every one of them is green they become one line that says the thing
 * they collectively prove, and `doctor --all` prints them as they were. The
 * fold is ALL OR NOTHING: one amber Sweep and every internal line comes back,
 * because the value of the green ones is being able to see which of them the
 * amber sits between.
 */
function foldable(internals: readonly Finding[]): boolean {
  return internals.length > 0 && internals.every((f) => f.severity === "green");
}

/**
 * What the folded line says, and it is READ rather than assumed.
 *
 * "The nightly worker ran today" is false on a store made this morning, and a
 * diagnostic that says a thing ran when it did not is worse than one that says
 * nothing. The count comes from the Spawn line's own `startsToday`, which is
 * the adapter's latched per-date counter.
 */
function backgroundLine(internals: readonly Finding[]): Finding {
  const spawn = internals.find((f) => f.key === "spawn");
  const started = spawn === undefined ? null : spawn.data["startsToday"];
  const ran = typeof started === "number" && started > 0;
  return {
    key: BACKGROUND_KEY,
    severity: "green",
    title: "Background",
    detail: ran
      ? "the nightly worker ran today; nothing failed"
      : "nothing has failed; the nightly worker has not run today",
    fix: "",
    data: { folded: internals.length, startsToday: ran ? (started as number) : null },
  };
}

/** The green rows in the folded arm's own order. */
function greenOrder(a: Finding, b: Finding): number {
  const rank = (f: Finding): number => {
    const i = GREEN_ORDER.indexOf(f.key);
    return i === -1 ? GREEN_ORDER.length : i;
  };
  return rank(a) - rank(b);
}

/**
 * `counterparts doctor`, on a terminal.
 *
 * Worst first, then `OFF`, then the greens. One blank line between the groups.
 * The grade word in colour and also IN WORDS (the dashboard's scar §2.4 — an
 * absence is displayed, never merely un-highlighted — which is why `statusLine`
 * writes the word in both arms). The fix dim, on its own line, in the constant
 * gutter. The summary last, coloured by the worst thing on the screen, and
 * counting WHAT IS ON THE SCREEN — a summary that counted twenty lines under a
 * screen showing seven would be the reading and the layout disagreeing, which
 * is the one thing this file may not do.
 */
export function printDoctorReport(
  io: Io,
  env: UiEnv,
  findings: readonly Finding[],
  today: string,
  layout: DoctorLayout = {},
): void {
  const u = ui(io, env);
  if (!laidOut(u)) {
    // PLAIN IS ALWAYS COMPLETE. A pipe, a test console, CI, the install loop:
    // every one of them gets every finding, `--all` or not, because a script
    // that grepped for a line must not stop finding it on the day somebody's
    // store went quiet enough to fold.
    for (const line of reportLines(findings, today)) io.out(line);
    return;
  }
  const ordered = worstFirst(findings);
  const internals = ordered.filter((f) => !HEADLINE.includes(f.key));
  const folded = layout.all !== true && foldable(internals);
  const rows = folded
    ? [...ordered.filter((f) => HEADLINE.includes(f.key)), backgroundLine(internals)]
    : ordered;

  io.out(u.paint.bold(`counterparts doctor — ${today}`));
  u.blank();
  let printed = 0;
  let worst: GradeWord = "GREEN";
  for (const grade of ["RED", "AMBER", "OFF", "GREEN"] as const) {
    const group = rows.filter((f) => gradeWord(f) === grade);
    if (group.length === 0) continue;
    if (printed > 0) u.blank();
    if (printed === 0) worst = grade;
    printed += 1;
    // The reading's own order within a grade is the order the findings arrived
    // in — `worstFirst` is stable, so filtering preserves it exactly. The one
    // exception is the folded screen's greens, which read in `GREEN_ORDER`.
    const lines = grade === "GREEN" && folded ? [...group].sort(greenOrder) : group;
    for (const f of lines) {
      // AN `OFF` LINE CARRIES ITS INVITATION IN THE SENTENCE, not under a
      // `fix:` — `doctor.ts#findingLines` does the same, so the two arms of
      // this report still say the same words in the same order.
      if (f.optional === true) u.statusLine(grade as Grade, f.title, `${f.detail}  ${f.fix}`.trimEnd());
      else u.statusLine(grade as Grade, f.title, f.detail, f.fix);
    }
  }
  u.blank();
  const summary = summaryLine(tally(rows));
  // THE WAY BACK TO THE WHOLE READING, on the screen that hid some of it.
  const everyLine = folded ? "   Every line: counterparts doctor --all" : "";
  io.out(painter(u.paint, worst)(summary) + u.paint.dim(everyLine));
}

// ── status ──────────────────────────────────────────────────────────────────

/** One labelled number or fact under a heading. */
export interface StatusRow {
  readonly label: string;
  readonly value: string;
  /** Emit the value VERBATIM, never folded. For a value whose own spacing is
   *  the layout — `by kind: self 1  person 0  …` groups its pairs with double
   *  spaces, and a greedy fold rejoins on single ones and loses the grouping. */
  readonly verbatim?: boolean;
}

/** A heading and the rows beneath it. */
export interface StatusBlock {
  readonly title: string;
  readonly rows: readonly StatusRow[];
  /** Lines printed under the rows, dim and indented — the asides. */
  readonly notes?: readonly string[];
}

/**
 * Everything `status` says, as data.
 *
 * `statusCommand` computes this ONCE and hands it to whichever renderer this
 * console gets, so the two layouts cannot disagree about a number. `plain` is
 * the exact `io.out` sequence the command has always produced, carried here as
 * strings rather than rebuilt — the only way to promise byte-identity is to keep
 * the bytes.
 */
export interface StatusView {
  readonly plain: readonly string[];
  readonly dir: string;
  readonly blocks: readonly StatusBlock[];
  readonly notes: readonly string[];
  /** The tail sections — removals, permanents, layout — already formatted. */
  readonly tail: readonly { readonly title: string; readonly lines: readonly string[] }[];
}

/** The widest label in a block, so one block's values line up with each other
 *  (not with the next block's: a column that spans unrelated facts reads as a
 *  table with a meaning it does not have). */
function labelWidth(rows: readonly StatusRow[]): number {
  return rows.reduce((w, r) => Math.max(w, r.label.length), 0);
}

/**
 * `counterparts status` — the census, on a terminal.
 *
 * The 2026-09-20 rule stands and is what the blocks are ordered by: the numbers
 * a person came for come first, the prose follows, and `--layout` is last
 * because the person who wants it will ask. What this arm changes is the shape
 * only — four labelled headings and a column of counts, instead of two lines
 * 120 characters wide that a narrow terminal folds into nonsense.
 */
export function printStatusReport(io: Io, env: UiEnv, view: StatusView): void {
  const u = ui(io, env);
  if (!laidOut(u)) {
    for (const line of view.plain) io.out(line);
    return;
  }
  /** `prefix + text`, folded with a hanging indent when this console folds.
   *  A console that only asked for COLOUR keeps one logical line per item —
   *  `ui.ts` decides the two separately, and every existing grep depends on it. */
  const emit = (prefix: string, text: string, hanging: number): string[] =>
    u.wraps ? fold(prefix, text, u.width, hanging) : [`${prefix}${text}`];

  /** An aside: dim, two spaces in, folded to the same two spaces. */
  const aside = (text: string): void => {
    for (const line of emit("  ", text, 2)) io.out(u.paint.dim(line));
  };

  io.out(`${u.paint.dim("Store:")} ${u.paint.cyan(view.dir)}`);
  for (const block of view.blocks) {
    if (block.rows.length === 0) continue;
    u.blank();
    u.heading(block.title);
    // One column per BLOCK, not one for the page: a column that spanned the
    // census and the dates would read as a table with a meaning it does not have.
    const width = labelWidth(block.rows) + 3;
    for (const row of block.rows) {
      const prefix = `  ${row.label.padEnd(width)}`;
      if (row.verbatim === true) io.out(`${prefix}${row.value}`);
      else for (const line of emit(prefix, row.value, 2 + width)) io.out(line);
    }
    for (const note of block.notes ?? []) aside(note);
  }
  if (view.notes.length > 0) {
    u.blank();
    for (const note of view.notes) aside(note);
  }
  for (const section of view.tail) {
    u.blank();
    u.heading(section.title);
    for (const line of section.lines) io.out(line);
  }
}
