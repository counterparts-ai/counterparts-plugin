/**
 * `mechanisms` — the short answer to "is my memory working?", one line per
 * memory mechanism the site names.
 *
 * **Why it exists** (2026-09-25). The owner ran `counterparts fired` and got 57
 * rows mixing the eleven mechanisms with plumbing, sorted by state, in code
 * words — and rows like "NEVER: a copy of the store could not be made" read as
 * alarms when they are good news. This view is the page a regular user reads;
 * `--all` still prints the full `fired` report, unchanged, for the diagnosis.
 *
 * **Whether a mechanism fired is not this file's call** (2026-09-26, an
 * experiment). It asks `mechanism-evidence.ts`, the one judgement the dashboard's
 * lights ask too, so the two can no longer disagree about which rows count. The
 * WORDS and the WINDOW stay this console's own: seven calendar days, the same
 * window the `fired` report counts over, and its own phrasing.
 *
 * The plumbing line still reads the `fired` report's rows.
 *
 * The truth per mechanism is `docs/research/mechanism-audit-2026-09-24.md`.
 */
import type { EventRow, ReadOnlyStore } from "../../core/store/index.js";
import { FIRED_DAYS, daysBefore, rowDate } from "../fired.js";
import type { FiredReport, FiredRow } from "../fired.js";
import { mechanismEvidence, payloadOf } from "../mechanism-evidence.js";
import type { EvidenceWindow, Verdict } from "../mechanism-evidence.js";

/** The three lights. */
export const LIGHT = {
  working: "●",
  idle: "◐",
  notBuilt: "○",
} as const;
export type Light = (typeof LIGHT)[keyof typeof LIGHT];

export type Group = "Encoding" | "Storage" | "Retrieval" | "Transformation";

/** The `fired` report's rows, by `MECHANISMS` id — for totals the words carry. */
type Rows = (id: string) => FiredRow | undefined;

export interface MemoryMechanism {
  readonly name: string;
  readonly group: Group;
  /** The `mechanism-evidence.ts` id whose verdict decides the light. */
  readonly id: string;
  /** `MECHANISMS` ids this line accounts for — kept off the plumbing line. */
  readonly evidence: readonly string[];
  /** The light and one plain line, from the shared verdict (and the report's
   *  totals, for the words only). */
  readonly read: (v: Verdict, rows: Rows) => { light: Light; says: string };
}

/** A proof's count inside the window, summed over the named keys. */
function part(v: Verdict, ...keys: string[]): number {
  let n = 0;
  for (const p of v.parts) if (keys.includes(p.key)) n += p.count;
  return n;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

const NOT_BUILT = (why: string) => (): { light: Light; says: string } => ({
  light: LIGHT.notBuilt,
  says: `not built yet: ${why}`,
});

/**
 * THE CONSOLE'S WINDOW: seven CALENDAR days, today included, in the store's
 * zone — the same window the `fired` report counts over. The lived-day bound
 * only keeps the read cheap (a lived day is never longer than a calendar day).
 */
export function calendarWindow(store: ReadOnlyStore, today: string): EvidenceWindow {
  let livedDay = 0;
  try {
    livedDay = store.livedDay();
  } catch {
    livedDay = 0;
  }
  const from = daysBefore(today, FIRED_DAYS - 1);
  const zone = store.zone();
  return {
    sinceDay: Math.max(0, livedDay - FIRED_DAYS),
    today: livedDay,
    contains: (row: EventRow) => {
      const date = rowDate(row, payloadOf(row), zone);
      return date >= from && date <= today;
    },
  };
}

/** The shared verdicts over the console's window. */
export function consoleVerdicts(store: ReadOnlyStore, today: string): Verdict[] {
  return mechanismEvidence(store, calendarWindow(store, today)).verdicts;
}

/**
 * THE TWELVE (Dreaming joined the eleven on 2026-09-26, beside Consolidation),
 * in the site's four groups and its order. Whether each one fired
 * is `mechanism-evidence.ts`'s call, shared with the dashboard; the words are
 * this console's own.
 */
export const MEMORY_MECHANISMS: readonly MemoryMechanism[] = [
  // ── Encoding ──
  {
    name: "Salience",
    group: "Encoding",
    id: "salience",
    evidence: ["deposit", "chunk-gate"],
    read: (v) => {
      const n = part(v, "deposit", "chunk");
      return v.fired
        ? { light: LIGHT.working, says: `${plural(n, "memory", "memories")} written and scored` }
        : { light: LIGHT.idle, says: "built, not firing yet: no memories written this week" };
    },
  },
  {
    name: "Emotion",
    group: "Encoding",
    id: "emotional",
    evidence: ["feelings", "emotion-weight", "mood-match"],
    // Emotion part A (2026-09-26): a memory's strongest feeling lifts it and
    // slows its fading, and a recorded mood lifts matching memories in recall.
    read: (v, rows) => {
      const weighted = rows("emotion-weight")?.total ?? 0;
      const withFeelings = rows("feelings")?.total ?? 0;
      const newWeighted = part(v, "weighted");
      const matched = part(v, "moodMatched");
      const held = `${plural(weighted, "memory", "memories")} held higher and fading slower (${String(withFeelings)} with recorded feelings)`;
      if (v.fired) {
        const parts: string[] = [];
        if (newWeighted > 0) parts.push(`${plural(newWeighted, "new memory", "new memories")} carrying feeling`);
        if (matched > 0) parts.push(`${plural(matched, "memory", "memories")} a matching mood brought closer`);
        return { light: LIGHT.working, says: `${parts.join("; ")}; ${held}` };
      }
      return {
        light: LIGHT.idle,
        says:
          weighted > 0
            ? `built, not firing yet this week: ${held}`
            : "built, not firing yet: no memory carries a feeling",
      };
    },
  },
  // ── Storage ──
  {
    name: "Forgetting",
    group: "Storage",
    id: "decay",
    evidence: ["decay", "prune", "fade", "sleep-cycle"],
    read: (v) => {
      if (!v.fired) return { light: LIGHT.idle, says: "built, not firing yet: nothing faded this week" };
      const letGo = part(v, "pruned");
      const dropped = part(v, "faded");
      const cards = part(v, "cards");
      const below = part(v, "belowReach");
      const parts: string[] = [];
      // Below reach and exited, counted apart (2026-10-10, review 03 C3).
      if (below > 0) parts.push(`${plural(below, "memory", "memories")} below reach now`);
      if (letGo > 0) parts.push(`${plural(letGo, "memory", "memories")} exited (archived at the floor)`);
      if (dropped > 0) parts.push(`${plural(dropped, "memory", "memories")} faded a band`);
      if (cards > 0) parts.push("unused names faded");
      if (letGo === 0) parts.push("nothing at the floor yet");
      return { light: LIGHT.working, says: parts.join("; ") };
    },
  },
  {
    name: "Interference",
    group: "Storage",
    id: "interference",
    evidence: ["dream-changes", "contradictions"],
    read: (v) => {
      const merged = part(v, "dreamMerged");
      const flagged = part(v, "flagged");
      const faded = part(v, "faded");
      const said = [
        ...(merged > 0 ? [`${plural(merged, "near-copy", "near-copies")} merged in a dream`] : []),
        ...(flagged > 0 ? [`${plural(flagged, "pair")} that disagree flagged`] : []),
        ...(faded > 0 ? [`${plural(faded, "earlier memory", "earlier memories")} faded under a newer one`] : []),
      ];
      return v.fired && said.length > 0
        ? { light: LIGHT.working, says: `partly built: ${said.join("; ")}` }
        : { light: LIGHT.idle, says: "partly built, not firing this week: similar memories meet in a dream and when one is settled changed; they do not compete at recall yet" };
    },
  },
  // ── Retrieval ──
  {
    name: "Retrieval",
    group: "Retrieval",
    id: "retrieval",
    evidence: ["recall-decision", "credit"],
    read: (v) => {
      if (!v.fired) return { light: LIGHT.idle, says: "built, not firing yet: nothing came to mind this week" };
      const turns = part(v, "turns");
      const lookups = part(v, "lookups");
      const credited = part(v, "credited");
      const parts: string[] = [];
      if (turns > 0) parts.push(`${plural(turns, "turn")} brought memories to mind`);
      if (lookups > 0) parts.push(plural(lookups, "deliberate look-up"));
      parts.push(
        credited > 0
          ? `${plural(credited, "memory", "memories")} used and strengthened`
          : "nothing used yet, so nothing strengthened",
      );
      return { light: LIGHT.working, says: parts.join("; ") };
    },
  },
  {
    name: "Association",
    group: "Retrieval",
    id: "association",
    evidence: ["association-saved", "association"],
    read: (v, rows) => {
      const saved = part(v, "links");
      const held = rows("association")?.total ?? 0;
      if (v.fired) {
        return { light: LIGHT.working, says: `${plural(saved, "link")} written this week; ${plural(held, "link")} held` };
      }
      return {
        light: LIGHT.idle,
        says:
          held > 0
            ? `built, not firing yet: no new links this week (${plural(held, "link")} held)`
            : "built, not firing yet: no links formed",
      };
    },
  },
  {
    name: "Prospective",
    group: "Retrieval",
    id: "prospective",
    evidence: ["prospective-dated", "prospective-fired", "prospective-plain"],
    // Built end to end since 2026-09-26. With nothing dated it is still built,
    // just holding nothing — so it is idle, never "not built" (2026-09-26).
    read: (v, rows) => {
      const dated = v.held ?? rows("prospective-dated")?.total ?? 0;
      const quiet = part(v, "quiet");
      const plain = part(v, "plain");
      const held = `${plural(dated, "dated memory", "dated memories")} held`;
      // A PLAIN REMINDER DUE AND NOT SAID (2026-10-09): the `fired` report's
      // occasion check, so "nothing due this week" is never said of a week
      // when something was due and went unsaid.
      const missed = rows("prospective-plain")?.occasionMissed ?? 0;
      const unsaid = missed > 0 ? `; ${plural(missed, "plain reminder")} due on a day a session ran and not said` : "";
      if (v.fired) {
        const parts: string[] = [];
        if (plain > 0) parts.push(`${String(plain)} said plainly`);
        if (quiet > 0) parts.push(`${String(quiet)} as quiet footnotes`);
        return {
          light: LIGHT.working,
          says: `${plural(quiet + plain, "reminder")} came back (${parts.join(", ")}); ${held}${unsaid}`,
        };
      }
      if (missed > 0) return { light: LIGHT.idle, says: `built, but not firing: ${held}${unsaid}` };
      return dated > 0
        ? { light: LIGHT.idle, says: `built, nothing due this week: ${held}` }
        : { light: LIGHT.idle, says: "built, nothing dated yet: a note with a date comes back around that day" };
    },
  },
  // ── Transformation ──
  {
    name: "Consolidation",
    group: "Transformation",
    id: "consolidation",
    evidence: ["sleep-cycle", "promotion", "dedup", "returns", "dream-replays", "core-demote", "upgrade-census"],
    read: (v) => {
      if (v.fired) {
        const parts: string[] = [];
        const returns = part(v, "returns");
        const promoted = part(v, "promoted");
        const merged = part(v, "merged") + part(v, "dreamMerged");
        const rose = part(v, "rose");
        if (returns > 0) parts.push(`${plural(returns, "return")} made memories fade more slowly`);
        if (promoted > 0) parts.push(`${plural(promoted, "memory", "memories")} became core`);
        if (merged > 0) parts.push(`${plural(merged, "near-copy", "near-copies")} merged`);
        if (rose > 0) parts.push(`${plural(rose, "memory", "memories")} settled a band higher`);
        return { light: LIGHT.working, says: parts.join("; ") };
      }
      const s = v.schedule;
      if (s !== null && s.onTime && s.lastRanDay !== null) {
        const next = s.nextInDays <= 0 ? "at the next session's end" : `in ${plural(s.nextInDays, "lived day")}`;
        return { light: LIGHT.idle, says: `built, ran on schedule with nothing to change; next run ${next}` };
      }
      return { light: LIGHT.idle, says: "built, not firing yet: nothing consolidated this week" };
    },
  },
  {
    name: "Dreaming",
    group: "Transformation",
    id: "dreaming",
    evidence: ["dream", "dream-changes", "dream-ask"],
    read: (v) => {
      const dreams = part(v, "dreams");
      const changes = part(v, "changes");
      // Said apart from the changes: a nomination moves nothing until a lane promotes it awake.
      const suggestions = part(v, "suggestions");
      const made = [...(changes > 0 ? [plural(changes, "change")] : []), ...(suggestions > 0 ? [plural(suggestions, "core suggestion")] : [])];
      const reflections = part(v, "reflections");
      if (v.fired) {
        return {
          light: LIGHT.working,
          says: `${plural(dreams, "dream")} this week${made.length > 0 ? ` (${made.join(", ")})` : ""}${
            reflections > 0 ? `; ${plural(reflections, "reflection")} afterwards` : ""
          }`,
        };
      }
      return {
        light: LIGHT.idle,
        says:
          v.lastFiredDay === null
            ? "built, not firing yet: no dream yet (a session asks, once a day, and you say yes or not today)"
            : `built, not firing this week: the last dream was on lived day ${String(v.lastFiredDay)}`,
      };
    },
  },
  {
    name: "Reconsolidation",
    group: "Transformation",
    id: "reconsolidation",
    evidence: ["revision", "accommodation", "contradictions"],
    read: (v) => {
      const pressed = part(v, "pressure");
      const settled = part(v, "settled");
      const said = [
        ...(pressed > 0 ? [`${plural(pressed, "correction")} weighed against old memories`] : []),
        ...(settled > 0 ? [`${plural(settled, "contradiction")} settled`] : []),
      ];
      return v.fired && said.length > 0
        ? { light: LIGHT.working, says: said.join("; ") }
        : { light: LIGHT.idle, says: "built, not firing yet: nothing corrected or settled this week" };
    },
  },
  {
    name: "Schemas",
    group: "Transformation",
    id: "schema",
    // Entity cards are built; beliefs about them have no live producer.
    evidence: ["entity-birth"],
    read: NOT_BUILT("nothing forms beliefs about people and projects yet"),
  },
  {
    name: "Gist",
    group: "Transformation",
    id: "episodic-semantic",
    evidence: ["gist"],
    // PARTLY (2026-09-26): a dream can write the pattern it sees as a gist.
    read: (v) =>
      v.fired
        ? { light: LIGHT.working, says: `${plural(part(v, "gist"), "pattern")} dreamed into a memory of its own` }
        : { light: LIGHT.idle, says: "partly built, not firing this week: only a dream writes a gist so far" },
  },
];

/** One line's reading: the shared verdict for its id, in the console's words. */
export function readMechanism(
  m: MemoryMechanism,
  verdicts: readonly Verdict[],
  rows: Rows,
): { light: Light; says: string } {
  const v = verdicts.find((x) => x.id === m.id);
  if (v === undefined) return { light: LIGHT.notBuilt, says: "not built yet" };
  return m.read(v, rows);
}

/**
 * THE PLUMBING ROWS WHOSE FIRING MEANS SOMETHING FAILED, with the words to say
 * it in. Every other plumbing row — a failure that never happened, an owner
 * action never taken, a part blind by design — is not a problem, and the one
 * line never makes it read like one.
 */
const TROUBLE: Readonly<Record<string, string>> = {
  "worker-trouble": "the background worker failed or was refused",
  "snapshot-trouble": "a copy of the store could not be made",
};

/** Every `MECHANISMS` id the eleven account for; the rest are plumbing. */
export function mechanismIds(): Set<string> {
  return new Set(MEMORY_MECHANISMS.flatMap((m) => m.evidence));
}

/** The plumbing line: how many parts ran this week, and only what failed. */
export function plumbingLine(report: FiredReport): string {
  const mine = mechanismIds();
  const plumbing = report.rows.filter((r) => !mine.has(r.id));
  const running = plumbing.filter((r) => r.state === "firing" && TROUBLE[r.id] === undefined).length;
  const failing: string[] = [];
  for (const r of plumbing) {
    const words = TROUBLE[r.id];
    // No count: some of these rows are latched one per reason per day, so a
    // number here would read as attempts and understate them.
    if (words !== undefined && r.firedInWindow > 0) failing.push(words);
  }
  const head = `Plumbing: ${plural(running, "part")} running`;
  return failing.length === 0
    ? `${head}, none failing.`
    : `${head}; failing this week: ${failing.join("; ")}.`;
}

/** The whole short view, as plain lines: one per mechanism in the site's four
 *  groups and order, then the plumbing in one line. */
export function mechanismsLines(report: FiredReport, verdicts: readonly Verdict[]): string[] {
  const byId = new Map(report.rows.map((r) => [r.id, r]));
  const rows: Rows = (id) => byId.get(id);
  const width = Math.max(...MEMORY_MECHANISMS.map((m) => m.name.length)) + 2;
  const lines = [`Memory mechanisms — last 7 days (${report.from} to ${report.today}, UTC)`, ""];
  if (report.young) {
    lines.push("This memory is new, so most of these have had nothing to do yet.", "");
  }
  for (const m of MEMORY_MECHANISMS) {
    const { light, says } = readMechanism(m, verdicts, rows);
    lines.push(`${light} ${m.name.padEnd(width)}${says}`);
  }
  lines.push(
    "",
    `${LIGHT.working} working this week  ${LIGHT.idle} built, not firing  ${LIGHT.notBuilt} not built yet`,
    plumbingLine(report),
    "Every detail: counterparts mechanisms --all",
  );
  return lines;
}
