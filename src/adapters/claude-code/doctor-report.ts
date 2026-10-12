/** `doctor`'s report — findings ranked, graded, printed, and cut to the session-start notice (moved out of `doctor.ts`, 2026-10-11). */
import type { Severity, Finding } from "./doctor-finding.js";

// ── the reading ─────────────────────────────────────────────────────────────

const RANK: Record<Severity, number> = { red: 0, amber: 1, green: 3 };

/**
 * FOUR TIERS, THREE SEVERITIES. `OFF` sits between the ambers and the greens:
 * it is not a warning (nothing is wrong) and it is not a pass (the feature is
 * not running), and a real amber — a stale snapshot, a failed phase — must
 * never print BELOW a line saying an optional extra was never switched on.
 * The tier is computed here, once, because `reportLines`, `reportJson`, the
 * terminal renderer and the notice all read their order through this function.
 */
export function tierOf(f: Finding): number {
  return f.severity === "amber" && f.optional === true ? 2 : RANK[f.severity];
}

/** Worst first, stable within a tier — the order the report and the notice
 *  both read. */
export function worstFirst(findings: readonly Finding[]): Finding[] {
  return [...findings]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => tierOf(a.f) - tierOf(b.f) || a.i - b.i)
    .map((x) => x.f);
}

/** The four words a grade is printed as. `OFF` is dim wherever there is
 *  colour; in plain text it is just the word, which is the point (§2.4 — an
 *  absence is displayed, never merely un-highlighted). */
export type GradeWord = "RED" | "AMBER" | "OFF" | "GREEN";

export function gradeWord(f: Finding): GradeWord {
  return f.severity === "amber" && f.optional === true ? "OFF" : (f.severity.toUpperCase() as GradeWord);
}

/** How many of each word are in a reading — the summary's own arithmetic, and
 *  `--json`'s, from one place so the two cannot disagree. */
export function tally(findings: readonly Finding[]): Record<Lowercase<GradeWord>, number> {
  const out = { red: 0, amber: 0, off: 0, green: 0 };
  for (const f of findings) out[gradeWord(f).toLowerCase() as Lowercase<GradeWord>] += 1;
  return out;
}

/**
 * `0 red, 0 amber, 2 off, 5 green.` — the summary, from a tally.
 *
 * The `off` term appears only when something IS off: a store with both keys in
 * place should not be told about a column it has nothing in. "Nothing to fix."
 * is gone with the owner's answer 12 — the counts are the one line he reads to
 * the end, and a sentence that replaced them made the two arms of this report
 * say different things about the same store.
 */
export function summaryLine(t: Record<Lowercase<GradeWord>, number>): string {
  return (
    `${String(t.red)} red, ${String(t.amber)} amber` +
    (t.off === 0 ? "" : `, ${String(t.off)} off`) +
    `, ${String(t.green)} green.`
  );
}

/**
 * The two columns every doctor line lays out in — `ui.ts` holds the same pair
 * and `test/ui.test.ts` holds the two files to each other.
 *
 * WIDENED 2026-09-22 (6/12 → 7/20) because the labels changed. The line a
 * person came for is now called `Recall by meaning`, which is seventeen
 * characters, and a title wider than its column pushes its own detail out of
 * the column every other detail is in. The owner's screen is the measurement:
 * `OFF` plus four spaces, `Recall by meaning` plus three.
 */
const SEVERITY_COLUMN = 7;

const TITLE_COLUMN = 20;

/** The console's report: a table, worst first, and a fix under anything that is
 *  not green. */
export function reportLines(findings: readonly Finding[], today: string): string[] {
  const ordered = worstFirst(findings);
  const lines = [`counterparts doctor — ${today}`, ""];
  for (const f of ordered) lines.push(...findingLines(f));
  lines.push("");
  lines.push(summaryLine(tally(ordered)));
  return lines;
}

/** ONE finding, in the two columns both arms of this report lay out in — the
 *  grade word, the title, the detail, and the fix in the constant gutter. */
export function findingLines(f: Finding): string[] {
  // A TITLE AS WIDE AS THE COLUMN STILL GETS ITS SPACE (2026-09-20). `padEnd`
  // is a floor, not a gap: a title exactly `TITLE_COLUMN` long would otherwise
  // print as `GREEN Journal modewal (busy timeout 5000 ms)`.
  const title = f.title.length >= TITLE_COLUMN ? `${f.title} ` : f.title.padEnd(TITLE_COLUMN);
  const head = `${gradeWord(f).padEnd(SEVERITY_COLUMN)}${title}`;
  // AN `OFF` LINE HAS NO `fix:`. Nothing is broken, so there is nothing to fix:
  // the command is an INVITATION and it reads as one sentence with the line
  // that explains what it buys. Every other grade keeps the fix on its own
  // line, in the constant gutter, where a person scanning for what to do finds
  // every one of them in the same column.
  if (f.optional === true) return [`${head}${f.detail}${f.fix.length === 0 ? "" : `  ${f.fix}`}`];
  const out = [`${head}${f.detail}`];
  if (f.fix.length > 0) out.push(`${" ".repeat(SEVERITY_COLUMN + TITLE_COLUMN)}fix: ${f.fix}`);
  return out;
}

/**
 * The `--json` shape: ids, counts, severities. Never a credential value.
 *
 * **COMPLETE AND UNFOLDED, always** — the terminal's folded screen is a layout
 * and this is the reading. Every finding is here whatever the console did with
 * it, in the same order, with its own grade.
 *
 * `severity` STAYS THREE-VALUED and an `OFF` finding carries `optional: true`
 * beside it (the owner's answer 12, 2026-09-22). A fourth severity would have
 * moved every reader that switches on the word — the hook's notice, the
 * dashboard, a script — for a distinction only the screen needs. The counts at
 * the top do split them, because a top-level `amber: 2` beside a screen reading
 * `0 amber, 2 off` is exactly the disagreement this module exists to prevent.
 */
export function reportJson(findings: readonly Finding[], today: string): Record<string, unknown> {
  const ordered = worstFirst(findings);
  const t = tally(ordered);
  return {
    date: today,
    red: t.red,
    amber: t.amber,
    off: t.off,
    green: t.green,
    findings: ordered.map((f) => ({
      key: f.key,
      severity: f.severity,
      ...(f.optional === true ? { optional: true } : {}),
      title: f.title,
      detail: f.detail,
      fix: f.fix,
      data: f.data,
    })),
  };
}

/** True when anything is red — the console's exit code, and the notice's gate. */
export function anyRed(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === "red");
}

/** The last line of every notice, and the only part that is never truncated:
 *  the repair is not a thing to remember. */
export const NOTICE_TAIL = "run: counterparts doctor";

/**
 * How long a notice may be, in characters.
 *
 * The host caps EVERY hook output string at 10,000 characters and replaces
 * anything longer with a preview and a file path
 * (https://code.claude.com/docs/en/hooks: "Hook output strings, including
 * `additionalContext`, `systemMessage`, and plain stdout, are capped at 10,000
 * characters"). The notice rides in the same JSON object as the wake, so every
 * character it spends is a character the wake cannot have — and the wake is the
 * thing the session cannot do without. 400 is enough for a finding, its fix and
 * the tail; a finding that needs more than that needs the console, which is what
 * the tail says.
 */
export const NOTICE_MAX_CHARS = 400;

/**
 * THE ONE OR TWO LINES THE OWNER SEES IN THE TERMINAL, or null.
 *
 * RED ONLY. Amber never reaches the terminal from a hook: the owner asked for a
 * warning, not a nag, and a notice that fires on a store with one un-embedded
 * memory is a notice people learn to scroll past. The last line is always the
 * same eight characters plus the command, so the repair is never a thing to
 * remember — and it survives the cap, which the first line does not.
 */
export function noticeMessage(findings: readonly Finding[]): string | null {
  const reds = worstFirst(findings).filter((f) => f.severity === "red");
  const first = reds[0];
  if (first === undefined) return null;
  const more =
    reds.length === 1 ? "" : ` (+${reds.length - 1} more: ${reds.slice(1).map((f) => f.title).join(", ")})`;
  const fix = first.fix.length === 0 ? "" : ` ${first.fix}`;
  const head = `counterparts: ${first.title} — ${first.detail}.${fix}${more}`;
  // The tail and its newline are reserved FIRST, so what is cut is always the
  // explanation and never the way to get the whole of it.
  const room = NOTICE_MAX_CHARS - NOTICE_TAIL.length - 1;
  const line = head.length <= room ? head : `${head.slice(0, Math.max(0, room - 1))}…`;
  return `${line}\n${NOTICE_TAIL}`;
}
