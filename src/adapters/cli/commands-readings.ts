/** The readings: `status`, `doctor`, `probe`, `fired`, `log` and `coverage` (moved out of `commands.ts`, 2026-10-11). */
import { existsSync, statSync } from "node:fs";
import { isDay, localDate, localTime, resolveZone, todayIn } from "../../core/time.js";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { BOUNDARY_EVENT, RECALL_CREDIT_EVENT, RECALL_DECISION_EVENT } from "../../core/counterpart.js";
import { PROBE_ROW_CEILING, probeOQ4, renderProbe } from "../../core/recall/probe.js";
// `band` is imported rather than mirrored: the dashboard computes the live
// band with this exact function, and two implementations of "which band is this
// row in today" is how the two surfaces disagreed in the first place.
import { band } from "../../core/physics/index.js";
// The ONE predicate for "this row is the journal, not a memory" — the same one
// the sleep phases and the dashboard's census use. A second copy of that test
// living here is how the console drifted away from them in the first place.
import { isJournal } from "../../core/sleep/index.js";
// The deep import into box 3's own driver — the same one `snapshot.ts` and
// `export.ts` make, and filed as INTERFACE-GAPS §5. `verify`'s census needs the
// number of vectors box 3 holds, and `Store` exposes no read for it.
import { journalModeOf } from "../../core/store/db.js";
import {
  LAYOUT,
  REQUIRE_EXPLICIT_DIR_ENV,
  Store,
  StoreError,
  isStoreError,
  explicitDirSetting,
  paths,
  storeExists,
} from "../../core/store/index.js";
import type { Band, Kind } from "../../core/types.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import { defaultConfigPath } from "../config-path.js";
import type { ConfigChoice } from "../config-path.js";
// The what-fired reading, shared with `doctor` and the dashboard's health panel
// so the three surfaces cannot disagree about what "silent" means.
import { STATE_MEANING, STATE_ORDER, firedReport } from "../fired.js";
import type { FiredReport, FiredState } from "../fired.js";
// The short view over the same reading: one line per memory mechanism.
import { mechanismsLines, consoleVerdicts } from "./mechanisms.js";
// The process log `log` prints (`adapters/log/`).
import { LOG_DAYS, logDates, readLog } from "../log/index.js";
import type { LogEntry } from "../log/index.js";
// The two snapshot readers `status` shares with doctor: the DIRECTORY is what
// says how many copies you have, and a row only says what a run once wrote.
import { readSnapshotsDir, resolveSnapshotsDir } from "../snapshots.js";
// THE HOST ADAPTER'S OWN READINGS, imported rather than re-derived — the console
// reads the claude-code adapter here, and its configuration from the shared
// `../config.js` (moved out of `claude-code/` on 2026-09-30). `doctor` is
// the console's face on the file and the store that adapter owns, and a console
// with its own idea of "what counts as red" is exactly the drift I32 ran inside of.
import { SPAWN_REFUSAL_PREFIX, SPAWN_START_COUNT_KEY, SPAWN_START_DATE_KEY } from "../claude-code/hooks.js";
import { zoneBeside } from "../config.js";
import type { AdapterConfig } from "../config.js";
import {
  anyRed,
  doctorFindings,
  readCheckout,
  readCounterpartOpen,
  reportJson,
  // `reportLines` is NOT imported here any more: the plain arm reaches it from
  // inside `report.ts#printDoctorReport`, which is the one place that decides
  // between the two layouts. Two call sites would be two places to forget.
} from "../claude-code/doctor.js";
import type { CheckoutReading } from "../claude-code/doctor.js";
import { readHost, mcpCommand } from "./install.js";
import { coverageLines } from "./coverage.js";
import { readDesktop } from "./desktop.js";
import { runtimeLabel } from "../runtime.js";
import { installRoute } from "../plugin.js";
// The terminal layouts for the two readings a person checks an install with.
// Both fall back to today's exact bytes for a console that is not a terminal.
import { printStatusReport, printDoctorReport } from "./report.js";
import type { StatusBlock, StatusView } from "./report.js";
import {
  EXIT,
  openStoreAt,
  openRefusalLine,
  hostConfigFor,
  resolveDir,
  describeDirRefusal,
  customConfigPath,
} from "./commands-shared.js";
import type { Io, Parsed } from "./commands-shared.js";
import { STORE_STARTED_KEY, STORE_PREVIOUS_PARKED_KEY } from "./commands-start-fresh.js";

// ── status ──────────────────────────────────────────────────────────────────

/**
 * The census, owner-side. It opens the store in OBSERVER stance whatever the
 * console's own stance is: reading the store must not be able to change it, and
 * the store's own seam is the thing that enforces that (observer-mode G3).
 *
 * Unlike the model-facing census in `adapters/mcp/`, this one may name ids and
 * enumerate the permanent list — "everything permanent is enumerable and
 * inspectable on demand: a list, not a cadence" (§14.1 G9). The owner's console
 * is exactly where that list belongs.
 */
/** `probe-oq4` — read-only; the same store-absent and open rules as `status`. */
export function probeCommand(dir: string, io: Io, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  let store: Store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    // Explicit ceiling, read NEWEST first and turned back to oldest first: an
    // ascending read with a limit drops the newest rows — the side of the
    // table the probe exists to read.
    const decisions = store.eventLog({ name: RECALL_DECISION_EVENT, order: "desc", limit: PROBE_ROW_CEILING }).reverse();
    const credits = store.eventLog({ name: RECALL_CREDIT_EVENT, order: "desc", limit: PROBE_ROW_CEILING }).reverse();
    const rows = [...decisions, ...credits].map((r) => ({ name: r.name, day: r.day, payload: r.payload }));
    for (const line of renderProbe(probeOQ4(rows))) io.out(line);
    for (const [name, got] of [
      [RECALL_DECISION_EVENT, decisions.length],
      [RECALL_CREDIT_EVENT, credits.length],
    ] as const) {
      if (got >= PROBE_ROW_CEILING) {
        io.err(`warning: ${name} hit the ${PROBE_ROW_CEILING}-row ceiling; the oldest rows are missing from this table`);
      }
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * `mechanisms` (and its older name `fired`) — which mechanisms have actually
 * fired, and which have not.
 *
 * Two views over ONE reading. The default is the short one a regular user
 * reads: a line per memory mechanism the site names, and the plumbing in one
 * line (`mechanisms.ts`). `--all` is the full report below, unchanged.
 *
 * Read-only, and the same store-absent and open rules as `status`: it opens the
 * store in OBSERVER stance whatever the console's own stance is, because reading
 * what fired must not be able to change it.
 *
 * SILENT FIRST is the whole shape of the full report. A page that opened with
 * everything that worked would bury the one thing worth acting on — constitution
 * 11's "one that stays silent is diagnosed and fixed" needs the silences on the
 * first screen, and every group carries the one line that says what its state
 * means so the reader never has to know the vocabulary in advance.
 */
export function firedCommand(
  dir: string,
  io: Io,
  namedDir: boolean,
  now: () => number,
  all = false,
): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  let store: Store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const today = localDate(now(), store.zone());
    const report = firedReport(store, today);
    for (const line of all ? firedLines(report, true) : mechanismsLines(report, consoleVerdicts(store, today))) io.out(line);
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * The names `log` tells in the dashboard's sentence. Those sentences were
 * written for durable payloads, and only these names carry the same fields on
 * the ring as in their row — checked one by one (review of #286: `handoff.*`
 * from the ring read "showing for 0 days"). Every other name prints its data.
 */
const LOG_NARRATED: readonly string[] = [
  "adapter.boundary",
  "adapter.ask",
  "adapter.wake.injected",
  "adapter.writeup.failed",
  "remember.capture.failed",
];

/**
 * `log` — one day of the process log (`adapters/log/`), oldest first, one plain
 * line per entry: the time, which process, the session, the name, and what it
 * said. A name in `LOG_NARRATED` is told in the dashboard's sentence
 * (`dashboard/web/narrate.ts`); any other prints its data as `key=value`.
 *
 * The store is opened as an instrument, only to read the zone and to let a
 * sentence resolve the memory it names; a store that will not open still gets
 * its log printed, raw.
 */
export async function logCommand(dir: string, io: Io, dateFlag: unknown, now: () => number): Promise<number> {
  if (dateFlag !== undefined && (typeof dateFlag !== "string" || !isDay(dateFlag))) {
    io.err("refused: --date takes a day, YYYY-MM-DD.");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}.`);
    return EXIT.usage;
  }
  let store: Store | null = null;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch {
    store = null;
  }
  try {
    const zone = store?.zone() ?? resolveZone(zoneBeside(dir));
    const date = typeof dateFlag === "string" ? dateFlag : localDate(now(), zone);
    const read = readLog(dir, date);
    if (!read.exists) {
      const held = logDates(dir);
      io.out(
        `Nothing logged on ${date}.` +
          (held.length === 0
            ? " The log is empty — it fills as sessions run."
            : ` The log keeps ${String(LOG_DAYS)} days; it holds ${held.join(", ")}.`),
      );
      return EXIT.ok;
    }
    const narrator = store === null ? null : await import("../dashboard/web/narrate.js");
    for (const entry of read.entries) {
      let said: string | null = null;
      if (narrator !== null && store !== null && LOG_NARRATED.includes(entry.name)) {
        said = narrator.narrate(store, {
          seq: 0,
          at: Date.parse(entry.at),
          day: 0,
          name: entry.name,
          ref: entry.ref,
          dedup_key: null,
          payload: JSON.stringify(entry.data),
        }).text;
      }
      io.out(logEntryLine(entry, zone, said));
    }
    if (read.unreadable > 0) io.out(`(${String(read.unreadable)} line${read.unreadable === 1 ? "" : "s"} in the file could not be read)`);
    return EXIT.ok;
  } finally {
    store?.close();
  }
}

/** One entry, one line: `14:03:12  hook:stop  3f2a9c1e  adapter.boundary  <what it said>`. */
export function logEntryLine(entry: LogEntry, zone: string, said: string | null = null): string {
  const at = Date.parse(entry.at);
  const time = Number.isFinite(at) ? localTime(at, zone) : entry.at;
  const session = entry.session === null ? "-" : entry.session.slice(0, 8);
  const data = Object.entries(entry.data)
    .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`)
    .join(" ");
  const ref = entry.ref === null ? "" : ` [${entry.ref}]`;
  return `${time}  ${entry.proc.padEnd(24)}  ${session.padEnd(8)}  ${entry.name}${ref}  ${said ?? data}`.trimEnd();
}

/**
 * `coverage` — what is written up and what is not yet, for one date
 * (2026-09-30). Read-only: the store and the span buffer open as instruments,
 * and every decision is `core/coverage/`'s (`coverage.ts` prints it).
 */
export function coverageCommand(dir: string, io: Io, parsed: Parsed, now: () => number, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const asked = parsed.flags["date"];
  if (asked !== undefined && (typeof asked !== "string" || !isDay(asked))) {
    io.err("refused: --date takes a day as YYYY-MM-DD.");
    return EXIT.usage;
  }
  let store: Store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const today = localDate(now(), store.zone());
    for (const line of coverageLines({ store, date: typeof asked === "string" ? asked : today, today })) io.out(line);
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * THE STATES A STORE TOO NEW TO GRADE STILL PRINTS (2026-09-20, finding 2).
 *
 * A brand-new store opened this view with twenty-eight `never` lines and no
 * sentence saying why, which is exactly what a broken install looks like. On a
 * store younger than a lived day or two the list narrows to what HAS happened
 * and what was stopped; `never`, `blind` and `new` are all the same fact there
 * — nothing has happened yet — and saying it once is more use than saying it
 * twenty-eight times. The full list comes back on its own, and `--all` prints
 * it today.
 *
 * `disabled` and `retired` are out too, and for a different reason: they are
 * this project's own history — an emotion classifier held back until it clears
 * its precision bar, two mechanisms retired with a parallel run against a
 * system the reader has never heard of. True, worth keeping, and not the first
 * three lines a stranger should meet on day 1.
 */
const YOUNG_STATES: readonly FiredState[] = ["firing", "blocked", "quiet"];

/** The report as plain text: one mechanism per line, grouped by state. */
export function firedLines(report: FiredReport, all = false): string[] {
  const lines = [
    `what has fired — ${report.from}→${report.today}, against ${report.previousFrom}→${report.previousTo}`,
    "",
  ];
  const young = report.young && !all;
  if (young) {
    // "0 calendar days of records" beside a FIRING section that shows three
    // deposits is a strange thing to print (2026-09-20). The reading a person
    // wants on day 1 is how long this has been going, so a store whose oldest
    // row is today says "today" rather than counting zero days.
    const age =
      report.calendarDays === null
        ? "nothing has been recorded here yet"
        : report.calendarDays === 0
          ? "everything it holds was recorded today"
          : `${String(report.calendarDays)} calendar day${report.calendarDays === 1 ? "" : "s"} of records`;
    lines.push(
      `This store is on lived day ${String(report.livedDay)} — ${age}. Most mechanisms have had ` +
        `nothing to do yet, so below is only what HAS fired and anything that was stopped. The ` +
        `full roll-call of ${String(report.rows.length)} comes back on its own once the store is ` +
        "old enough for silence to mean something — or run `counterparts mechanisms --all` now.",
      "",
    );
  }
  // The blocked list FIRST: "it was stopped, and here is by what" is the more
  // actionable of the two, and it is the one that would otherwise be buried
  // inside a group the reader has to scroll to.
  if (report.wentBlocked.length > 0) {
    lines.push(`Fired last week and STOPPED this week: ${report.wentBlocked.join("; ")}`, "");
  }
  // An occasion that came and was not answered (2026-10-09): the one silence
  // among the `waiting` rows that is still a fault, said before the groups.
  if (report.missedOccasion.length > 0) {
    lines.push(`Its occasion came this week and it did not fire: ${report.missedOccasion.join("; ")}`, "");
  }
  if (report.wentQuiet.length > 0) {
    lines.push(`Fired last week and not once this week: ${report.wentQuiet.join("; ")}`, "");
  }
  for (const state of STATE_ORDER) {
    if (young && !YOUNG_STATES.includes(state)) continue;
    const rows = report.rows.filter((r) => r.state === state);
    if (rows.length === 0) continue;
    lines.push(`${state.toUpperCase()} (${String(rows.length)}) — ${STATE_MEANING[state]}`);
    for (const row of rows) {
      const when = row.lastFired === null ? "never" : row.lastFired;
      const refused =
        row.refusedInWindow === 0
          ? ""
          : `  refused ${String(row.refusedInWindow)}${row.topRefusal === null ? "" : ` (${row.topRefusal})`}`;
      lines.push(
        `  ${row.label}`,
        `    last ${when}  ·  7d ${String(row.firedInWindow)}  ·  total ${String(row.total)}${refused}  ·  ${row.evidence}`,
      );
      // The line that turns an absence into a fact: what is missing, and what
      // would fix it. Only the states that HAVE one carry it.
      if (row.note !== null) lines.push(`    ${row.note}`);
    }
    lines.push("");
  }
  const bounds: string[] = [
    `${String(report.rows.length)} mechanisms read; ` +
      STATE_ORDER.map((s) => `${String(report.counts[s])} ${s}`).join(", "),
  ];
  if (report.notRead.length > 0) {
    bounds.push(`Not read on this pass: ${report.notRead.join(", ")}.`);
  }
  if (report.truncated) {
    bounds.push("The event read hit its ceiling, so every total above is a floor, not a count.");
  }
  if (report.probesTruncated) {
    bounds.push("The id scan hit its ceiling, so every table count above is a floor.");
  }
  bounds.push(
    "Events are bounded-retention telemetry: rows past the window are swept unless a replay latch " +
      "holds them, so these are what I still have rather than everything that ever happened.",
  );
  lines.push(...bounds);
  return lines;
}

/** The newest `adapter.boundary` row's calendar date, or null. A census may not
 *  become the thing that throws, and it may not guess either. */
function newestBoundary(store: Store, livedDay: number): string | null {
  try {
    // The newest row itself: `rows.at(-1)` of an ascending read with a limit
    // was the 2,000th-oldest row of the window once it held more.
    const [last] = store.eventLog({
      name: BOUNDARY_EVENT,
      sinceDay: Math.max(0, livedDay - 30),
      order: "desc",
      limit: 1,
    });
    if (last === undefined) return null;
    const payload = JSON.parse(last.payload ?? "{}") as Record<string, unknown>;
    const date = payload["date"];
    return typeof date === "string" && date.length === 10 ? date : localDate(last.at, store.zone());
  } catch {
    return null;
  }
}

/** Is there a written self page, and how old. One line, never a byte of it. */
function pageLine(store: Store): string {
  try {
    const ids = store.list({ type: "schema", kind: "self", archived: false });
    for (const id of ids) {
      const read = store.read(id);
      if (read.doc.meta["role"] !== "page") continue;
      const revised = read.doc.meta["revisedOn"];
      return typeof revised === "string" && revised.length > 0
        ? `yes, last revised ${revised}`
        : "yes";
    }
    return "none yet";
  } catch {
    return "?";
  }
}

/** How old the newest copy of the store is, read off the DIRECTORY rather than
 *  off a row — a row says what a run once wrote, the directory says what you
 *  have (the F2 review's lesson, applied to this line too). */
function snapshotAge(dir: string): string {
  try {
    const resolved = resolveSnapshotsDir(dir, undefined);
    if (resolved.dir === null) return "nowhere to keep one";
    const disk = readSnapshotsDir(resolved.dir);
    const newest = disk.names[disk.names.length - 1];
    return newest === undefined ? "none yet" : `${newest.slice(0, 10)} (${disk.names.length} kept)`;
  } catch {
    return "?";
  }
}

export function statusCommand(
  dir: string,
  io: Io,
  namedDir: boolean,
  today: string,
  layout = false,
  // THE ENVIRONMENT, for the layout only (`report.ts`): NO_COLOR, FORCE_COLOR,
  // TERM. Never read from `process.env` down here — a suite that did would pass
  // or fail with the developer's shell (`ui.ts`'s rule). Defaulted so every
  // existing caller and test compiles and gets the plain arm.
  env: Record<string, string | undefined> = {},
): number {
  if (!storeExists(dir)) {
    // An instrument that MINTS a data dir by looking at one is a wart — and
    // since 2026-08-26 the store itself refuses it (INTERFACE-GAPS §7 closed:
    // observer + absent store is STORE_UNINITIALIZED at open). This guard
    // stays for the friendlier sentence.
    //
    // TWO THINGS CHANGED ON 2026-09-04, both from a cold-stranger reading (#11).
    //
    // It exits 1, not 0. "There is no store here" is not a census; a script
    // that asks a store what it holds and gets an answer about nothing at all
    // has not succeeded, and `set -e` around `counterparts status` sailed
    // straight past a typo'd `--dir`. `usage`, not `failed`: nothing broke —
    // the line named a place with no store in it. The sentence goes to stderr
    // for the same reason, because a non-zero exit whose only output was on
    // stdout is half a refusal.
    //
    // And the remedy carries the dir the owner actually typed. `Run
    // 'counterparts init'` after `status --dir /somewhere` would have created
    // the store in the DEFAULT place — not the one the sentence above it just
    // named — which is the worst kind of advice: it works, and it works
    // somewhere else.
    io.err(
      `No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`,
    );
    return EXIT.usage;
  }
  let store: Store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const kinds: Kind[] = ["self", "person", "entity", "skill", "place", "fact"];
    const bands: Band[] = ["episodic", "semantic", "identity"];
    const denied = new Set(store.deniedIds());
    const byKind: Record<string, number> = {};
    const byBand: Record<string, number> = {};
    const permanent: { id: string; title: string; why: string }[] = [];
    // THREE POPULATIONS, THREE LABELS. A single `live` counter that swallowed
    // all of them is how one demo store reported three different sizes on
    // 2026-09-05: the wake preface says `<n> memories` and counts
    // `type: "memory"` rows only (`self/briefing.ts#prefaceLine`,
    // `store.countMemories({ type: "memory", archived: false })`), while this
    // census walked every row and called the total "Live memories" — 143 here
    // against the preface's 121, the difference being exactly the 13 entities
    // and 9 beliefs. Both numbers were right; one of the labels was not.
    let memories = 0;
    let addedToday = 0;
    let schemas = 0;
    let journal = 0;
    let archived = 0;
    let superseded = 0;
    const day = store.livedDay();

    for (const id of store.list()) {
      const row = store.row(id);
      if (row === undefined || denied.has(id)) continue;
      if (row.archived === 1) {
        archived += 1;
        continue;
      }
      if (row.superseded_by !== null) {
        superseded += 1;
        continue;
      }
      // THE JOURNAL IS NOT A MEMORY. `store.list()` returns every row, and
      // episodes are rows — so a census that walks it and counts what is left
      // reports the journal as memories, with a `self` kind and an `episodic`
      // band it never earned. `sleep/types.ts#isJournal` is the one predicate
      // for this; PR #27 threaded it through five sleep phases and the
      // dashboard's census and missed the console. Counted on its own line
      // rather than dropped, because a number that vanished would be the same
      // bug facing the other way (§2.4: what is skipped is said out loud).
      if (isJournal(row)) {
        journal += 1;
        continue;
      }
      if (row.type === "schema") schemas += 1;
      else memories += 1;
      // THE SAME POPULATION, so the two numbers on the page cannot disagree.
      // `countMemories({ learnedOnFrom })` would have been one query and a
      // different census: it counts removed and superseded rows, and reported
      // 2 new beside `Memories: 1` the first time this line was written.
      if (row.learned_on === today) addedToday += 1;
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
      // THE LIVE BAND, computed, never the stored column. Until 2026-09-14
      // `memories.band` was a birth fossil — episodic at mint, identity at
      // promotion, and never "semantic" — so reading it reported
      // `episodic 128 / semantic 0` where the dashboard, which does this
      // arithmetic, reported `54 / 74` (LAUNCH-STATUS §I10). Same helper, same
      // day, same answer. The column is now reconciled by the decay pass (U8,
      // `sleep/decay.ts`), so it agrees after a boundary — and this stays
      // computed anyway, because it must be right BEFORE the first boundary of
      // the day and on a store whose last pass hit its budget.
      let liveBand: Band = row.band;
      try {
        liveBand = band(store.physicsOf(id), day);
      } catch {
        // A row whose physics will not read keeps its recorded band, which is
        // the dashboard's fallback too.
      }
      byBand[liveBand] = (byBand[liveBand] ?? 0) + 1;
      if (row.protected === 1 || row.promoted_identity === 1) {
        let title = "(untitled)";
        try {
          title = store.readProse(id).title ?? "(untitled)";
        } catch {
          title = "(prose unreadable)";
        }
        permanent.push({
          id,
          title,
          why: row.protected === 1 ? "protected" : "promoted to identity",
        });
      }
    }

    // ── THE NUMBERS A PERSON CAME FOR, FIRST (2026-09-20, finding 3) ────────
    //
    // This command is what `install` tells a new user to check with, and until
    // now the four numbers they wanted sat above a ten-line `Layout:` block
    // written for whoever maintains the store — "Box 1", "Box 3",
    // `assertLayout()`, `adapters/expansions.ts`, "§14.1 G9". None of those is
    // a thing the reader has any way to look up, and QUICKSTART §7 never
    // mentioned the block at all. The census leads; the prose follows; the
    // layout is behind `--layout`, where the person who wants it will ask.
    //
    // ── AND ONE READING, TWO LAYOUTS (2026-09-21, new-user finding 5) ───────
    //
    // Every fact is computed ONCE, below, and then written twice: `plain` is the
    // exact `io.out` sequence this command has always produced, kept as strings
    // rather than rebuilt (the only way to promise byte-identity is to keep the
    // bytes), and `blocks` is the same facts as labelled rows for a terminal.
    // `report.ts#printStatusReport` chooses, and a console that is not a
    // terminal never reaches the second one.
    const plain: string[] = [];
    const say = (line: string): void => {
      plain.push(line);
    };
    const lastActive = store.getMeta("lastActiveDate") || "never";
    const lastBoundary = newestBoundary(store, day) ?? "never";
    const removals = store.removalRecord().filter((r) => r.stage === "complete");
    const pageSaid = pageLine(store);
    const snapshotSaid = snapshotAge(store.dir);
    const journalMode = journalModeOf(paths.operational(store.dir));

    say(`Store: ${store.dir}`);
    say("");
    // One line, four labelled populations, and the first number is the one the
    // wake preface says. Anything that adds them into a single "live" total is
    // a surface that will disagree with the briefing the model reads.
    say(
      `Memories: ${memories}` +
        `   Beliefs and entities: ${schemas}` +
        `   Journal: ${journal} ${journal === 1 ? "episode" : "episodes"}` +
        `   Archived: ${archived}   Superseded: ${superseded}`,
    );
    const byKindSaid = kinds.map((k) => `${k} ${byKind[k] ?? 0}`).join("  ");
    const byBandSaid = bands.map((b) => `${b} ${byBand[b] ?? 0}`).join("  ");
    say(`  by kind: ${byKindSaid}   (memories + beliefs and entities)`);
    say(`  by band: ${byBandSaid}   (computed from physics today, not the stored column)`);
    say("");
    say(
      `Today (${today}): ${String(addedToday)} new` +
        `   ·   Lived day ${day}` +
        `   ·   Last active ${lastActive}` +
        `   ·   Last boundary ${lastBoundary}`,
    );
    say(
      `Self page: ${pageSaid}` +
        `   ·   Newest snapshot: ${snapshotSaid}` +
        `   ·   Journal mode: ${journalMode}` +
        `   ·   Removed: ${removals.length}` +
        `   ·   Permanent: ${permanent.length}`,
    );
    // WHERE THIS STORE CAME FROM, when it came from a fresh start (N1). Host
    // state out of box 2's meta table: a date and a path, written once by
    // `start-fresh` and by nothing else, so a store that was simply installed
    // says nothing here rather than something vague. It sits with the other
    // facts ABOUT the store rather than above the census — E2's rule is that
    // the numbers a person came for come first.
    const began = store.getMeta(STORE_STARTED_KEY);
    const previous = store.getMeta(STORE_PREVIOUS_PARKED_KEY);
    const beganSaid =
      began === undefined || began.length === 0
        ? null
        : `${began}${
            previous === undefined || previous.length === 0
              ? "  (a fresh start; nothing was parked)"
              : `   ·   the previous store is parked at ${previous}, untouched`
          }`;
    if (beganSaid !== null) say(`Began: ${beganSaid}`);
    const asides = [
      "Memories is the number the wake preface states; the journal does not decay.",
      "counterparts doctor grades all of this; counterparts mechanisms says which mechanisms are working.",
    ];
    say("");
    for (const aside of asides) say(`  ${aside}`);

    const tail: { title: string; lines: string[] }[] = [];
    if (removals.length > 0) {
      // Owner side: the id and the date, no body and no content hash — ever.
      const rows = removals.map(
        (row) => `  ${localDate(row.at, store.zone())}  ${row.memory_id}  by ${row.actor}`,
      );
      tail.push({ title: "Removed:", lines: rows });
      say("");
      say("Removed:");
      for (const line of rows) say(line);
    }
    if (permanent.length > 0) {
      const rows = permanent.map((entry) => `  ${entry.id}  ${entry.title}  — ${entry.why}`);
      tail.push({ title: "Permanent (enumerable on demand, §14.1 G9):", lines: rows });
      say("");
      say("Permanent (enumerable on demand, §14.1 G9):");
      for (const line of rows) say(line);
    }
    if (layout) {
      const rows = LAYOUT.map((entry) => {
        const present = existsSync(join(store.dir, entry.name)) ? " " : "-";
        return `  ${present} ${entry.backup ? "backed up" : "excluded "}  ${entry.name}  — ${entry.why}`;
      });
      tail.push({ title: "Layout:", lines: rows });
      say("");
      say("Layout:");
      for (const line of rows) say(line);
    }

    const blocks: StatusBlock[] = [
      {
        title: "Memory",
        rows: [
          { label: "Memories", value: String(memories) },
          { label: "Beliefs and entities", value: String(schemas) },
          { label: "Journal", value: `${journal} ${journal === 1 ? "episode" : "episodes"}` },
          { label: "Archived", value: String(archived) },
          { label: "Superseded", value: String(superseded) },
          { label: "by kind", value: byKindSaid, verbatim: true },
          { label: "by band", value: byBandSaid, verbatim: true },
        ],
        notes: [
          "by kind counts memories and beliefs and entities together.",
          "by band is computed from physics today, not from the stored column.",
        ],
      },
      {
        title: `Today — ${today}`,
        rows: [
          { label: "New today", value: String(addedToday) },
          { label: "Lived day", value: String(day) },
          { label: "Last active", value: lastActive },
          { label: "Last boundary", value: lastBoundary },
        ],
      },
      {
        title: "This store",
        rows: [
          { label: "Self page", value: pageSaid },
          { label: "Newest snapshot", value: snapshotSaid },
          { label: "Journal mode", value: journalMode },
          { label: "Removed", value: String(removals.length) },
          { label: "Permanent", value: String(permanent.length) },
          ...(beganSaid === null ? [] : [{ label: "Began", value: beganSaid }]),
        ],
      },
    ];
    const view: StatusView = { plain, dir: store.dir, blocks, notes: asides, tail };
    printStatusReport(io, env, view);
    // A STORE THAT NO SESSION CAN OPEN DOES NOT GET A GREEN CENSUS.
    //
    // `status` opens a `Store`, not a `Counterpart`, so it never runs
    // `Schemas.load` — which is what meets a faulted row and stands the session
    // down. Reviewer B hand-made the fault and watched `status` print a
    // completely normal summary and exit 0 while every session was dead
    // (MAJOR-3). The census above is still printed, because it is true; what
    // changes is that the fault is said and the exit is not success.
    const faulted = store.faultedIds();
    if (faulted.length > 0) {
      io.out("");
      io.err(
        `Rows whose words are missing: ${String(faulted.length)} — ${faulted.slice(0, 5).join(", ")}` +
          (faulted.length > 5 ? ` and ${String(faulted.length - 5)} more` : "") +
          ". Every session stands down on a store that holds one. Run: counterparts doctor.",
      );
      return EXIT.failed;
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}

// ── doctor ──────────────────────────────────────────────────────────────────

/**
 * `doctor`'s exit code when anything is RED.
 *
 * It is the same number as `EXIT.usage` and it means something else: not "you
 * typed this wrong" but "the store you asked about has a red finding". A
 * separate constant rather than a sixth member of `EXIT`, because `EXIT` is this
 * console's vocabulary for how a COMMAND went and this is a verdict about a
 * STORE. Both renderings use it, so a script can branch on `$?` without parsing
 * either.
 */
export const DOCTOR_RED_EXIT = 1;

/**
 * Is there a `claude` executable on this environment's PATH? A directory walk,
 * never a spawn — doctor must not run somebody's program to grade them. Null
 * when there is no PATH to search, which the fix line reads as "not looked".
 */
function claudeOnPath(env: Record<string, string | undefined>): boolean | null {
  const path = env["PATH"];
  if (path === undefined || path.trim().length === 0) return null;
  for (const dir of path.split(delimiter)) {
    if (dir.length === 0) continue;
    try {
      const st = statSync(join(dir, "claude"));
      if (st.isFile() && (st.mode & 0o111) !== 0) return true;
    } catch {
      /* not here */
    }
  }
  return false;
}

/** The persisted per-reason spawn refusal counters, as `doctor` wants them. */
/** The adapter's own start tally, read the way `spawnRefusalCounters` reads the
 *  refusal ones -- from the meta keys `hooks.ts` owns, because `doctor.ts`
 *  cannot import that file back. */
function spawnStartCounter(store: Store | null): { date: string | null; count: number } {
  if (store === null) return { date: null, count: 0 };
  try {
    return {
      date: store.getMeta(SPAWN_START_DATE_KEY) ?? null,
      count: Number(store.getMeta(SPAWN_START_COUNT_KEY) ?? "0"),
    };
  } catch {
    return { date: null, count: 0 };
  }
}

function spawnRefusalCounters(store: Store | null): Record<string, number> {
  if (store === null) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
    const n = Number(value);
    if (n > 0) out[key.slice(SPAWN_REFUSAL_PREFIX.length)] = n;
  }
  return out;
}

/**
 * `doctor` — the reading that would have caught I32 on day one.
 *
 * Read-only, all the way down: the store is opened in OBSERVER stance, box 3 is
 * never opened at all, and nothing here writes a row. The findings, the
 * severities and the fix sentences live in `claude-code/doctor.ts` and are the
 * SAME ones the session-start notice reads, so the terminal warning and this
 * report cannot say different things about one store.
 *
 * Two things it does differently from every other command, both deliberate:
 *
 *   1. **The store comes from the CONFIG first.** `--dir` overrides it and the
 *      environment is the last resort, because the question `doctor` answers is
 *      "is the store the HOOKS open healthy" — and through all of I29 the
 *      answer for the store the environment named was yes.
 *   2. **Nothing it grades comes from this console's shell.** The hook
 *      processes inherit none of it (measured day 0), so a reading that did
 *      would grade a machine the hooks never run on. (Until 2026-09-24 this
 *      was about the API keys, which were read from their file for exactly
 *      that reason.)
 *
 * **And what reading from the config does NOT buy it: an exemption.** With
 * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` armed, this command refuses unless a
 * human named something — `--dir`, or a configuration by `--config` /
 * `COUNTERPARTS_CONFIG`. A configuration found at the DEFAULT path names the
 * live store on every machine with an install, so honouring its `dataDir` past
 * the guard would be the guard's own failure mode wearing a diagnostic's face;
 * the first round of this PR did exactly that and was caught reading the
 * owner's live paths from an armed shell. Two doors enforce it: `run()`
 * (`implicitConfigRefusal`, the same three lines `install` uses) and the dir
 * resolution below.
 */
export function doctorCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  named?: ConfigChoice,
  checkout?: CheckoutReading,
  home?: string,
): number {
  const configPath = named?.path ?? defaultConfigPath();
  // `--dir` WITH NO NAMED CONFIGURATION, under the guard (finding 6). The store
  // was named; the default configuration beside it was not, and opening it is
  // what reaches the owner's live configuration. So it is not opened — not
  // read, not reported on, not graded — and `configFindings` prints one amber
  // naming what went unasked. Without the guard this is an ordinary run, since
  // the default config is then a place the caller is content to read.
  const unread =
    typeof parsed.flags["dir"] === "string" &&
    (named === undefined || named.source === "default") &&
    explicitDirSetting(env).armed;
  const { config, reason, unreadableKeys } = unread
    ? { config: {} as AdapterConfig, reason: "not-read" as const, unreadableKeys: undefined }
    : hostConfigFor(configPath);

  // WHICH STORE, under the guard. `--dir` is a name. A config the CALLER named
  // (`--config`, `COUNTERPARTS_CONFIG`) is a name, and the `dataDir` inside it is
  // named by extension. A config nobody named is NOT a name — and its `dataDir`
  // field is the live store on every machine with an install, which is why the
  // old shape here never reached `resolveDir` and so never met the guard at all.
  //
  // `run()` already refuses that case one door up (`implicitConfigRefusal`), and
  // this is the second door rather than the first: `doctorCommand` is reachable
  // without it — a caller inside this module, a future dispatch — and the whole
  // finding was that one missing branch let a read at the live store through.
  // The sentence is `verify`'s own, so the two doors say the same thing.
  const namedConfig = named !== undefined && named.source !== "default";
  const guard = explicitDirSetting(env);
  let dir: string;
  try {
    if (typeof parsed.flags["dir"] === "string") {
      dir = parsed.flags["dir"];
    } else if (config.dataDir !== undefined && !namedConfig && guard.armed) {
      throw new StoreError("IMPLICIT_DEFAULT_DIR_REFUSED", {
        guard: `${REQUIRE_EXPLICIT_DIR_ENV}=${guard.value}`,
        dir: config.dataDir,
      });
    } else {
      dir = config.dataDir ?? resolveDir(env);
    }
  } catch (err) {
    // The explicit-dir guard, at exactly the door `verify`'s census meets it:
    // a store nobody named is refused here too.
    io.err(describeDirRefusal(err));
    return EXIT.refused;
  }

  // The person's day: the config's zone, else the machine's (docs/time.md).
  const today = todayIn(resolveZone(config.timeZone));
  let store: Store | null = null;
  try {
    // WOULD A SESSION OPEN THIS STORE — asked FIRST, and closed again inside the
    // call, so this reading and the console's own handle never hold the same
    // database at once. It is the check the `Store` finding cannot make: that
    // finding reads the directory, and a store can pass it while
    // `Counterpart.open` throws at every session start (H1). Inside this `try`
    // rather than above it, because `doctor` is the command people run BECAUSE
    // something is wrong, and its own reading must not be the thing that throws.
    const open = storeExists(dir) ? readCounterpartOpen(dir, undefined, config.snapshots?.dir) : undefined;
    if (storeExists(dir)) {
      try {
        store = Store.open({ dir, observer: true, ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }) });
      } catch (err) {
        // A store BEHIND this build refuses an observer until a session has
        // upgraded it; the Store open line already grades that, so the rest of
        // the reading goes on without a handle rather than failing.
        // A store a rollback holds refuses every open by this build, and the
        // Rollback line says so; the rest of the reading goes on the same way.
        if (isStoreError(err, "STORE_ROLLED_BACK")) {
          store = null;
        } else if (open?.migration === undefined || !isStoreError(err, "STORE_UNINITIALIZED")) throw err;
      }
    }
    const findings = doctorFindings({
      configPath,
      configReason: reason,
      ...(unreadableKeys === undefined ? {} : { configUnreadableKeys: unreadableKeys }),
      config,
      dir,
      store,
      today,
      refusals: spawnRefusalCounters(store),
      starts: spawnStartCounter(store),
      // WHICH CHECKOUT THIS CONSOLE IS RUNNING. From a worktree it grades the
      // worktree, which is the right answer for a command somebody typed; the
      // hook grades the tree the host invokes by absolute path, which is the
      // one that is live on the owner's memory.
      checkout: checkout ?? readCheckout(),
      // DID THE TWO STEPS THE USER DOES BY HAND TAKE (finding 4). Read here
      // rather than inside `doctorFindings` for the reason `checkout` is: it is
      // four small reads of somebody else's files, outside this store, and the
      // hook must not pay for them.
      host: {
        ...readHost(home ?? homedir(), process.cwd(), env),
        // WHETHER `connect` COULD REGISTER THE MEMORY TOOLS FROM HERE, and the
        // line it prints when it cannot (go-public Phase C walk): doctor's fix
        // for a missing registration names that line rather than `connect`
        // when there is no `claude` to run. A PATH search, never a spawn.
        claudeOnPath: claudeOnPath(env),
        mcpAddLine: mcpCommand(dir, undefined, customConfigPath(named, home ?? homedir())),
        consoleRuntime: runtimeLabel(),
      },
      // CLAUDE DESKTOP'S ENTRY (2026-09-30): two small reads of the host's
      // files, like `host` above. Quiet in the report when there is none.
      desktop: readDesktop(home ?? homedir(), env),
      // HOW THIS COPY CAME (2026-10-11): the plugin's /counterparts:doctor
      // runs through `plugin-run.sh cli`, which says so in the environment.
      install: installRoute(env),
      ...(open === undefined ? {} : { open }),
    });
    if (parsed.flags["json"] === true) {
      io.out(JSON.stringify(reportJson(findings, today), null, 2));
    } else {
      // ONE READING, two layouts (2026-09-21, new-user finding 5). A console
      // that is not a terminal — every test, every pipe, the install loop —
      // still gets `reportLines` verbatim, from inside this call; see
      // `report.ts`, which exists to hold exactly that promise.
      printDoctorReport(io, env, findings, today, { all: parsed.flags["all"] === true });
    }
    return anyRed(findings) ? DOCTOR_RED_EXIT : EXIT.ok;
  } finally {
    store?.close();
  }
}
