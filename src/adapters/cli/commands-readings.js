import { existsSync, statSync } from "node:fs";
import { isDay, localDate, localTime, resolveZone, todayIn } from "../../core/time.js";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { BOUNDARY_EVENT, RECALL_CREDIT_EVENT, RECALL_DECISION_EVENT } from "../../core/counterpart.js";
import { PROBE_ROW_CEILING, probeOQ4, renderProbe } from "../../core/recall/probe.js";
import { band } from "../../core/physics/index.js";
import { isJournal } from "../../core/sleep/index.js";
import { journalModeOf } from "../../core/store/db.js";
import {
  LAYOUT,
  REQUIRE_EXPLICIT_DIR_ENV,
  Store,
  StoreError,
  isStoreError,
  explicitDirSetting,
  paths,
  storeExists
} from "../../core/store/index.js";
import { defaultConfigPath } from "../config-path.js";
import { STATE_MEANING, STATE_ORDER, firedReport } from "../fired.js";
import { mechanismsLines, consoleVerdicts } from "./mechanisms.js";
import { LOG_DAYS, logDates, readLog } from "../log/index.js";
import { readSnapshotsDir, resolveSnapshotsDir } from "../snapshots.js";
import { SPAWN_REFUSAL_PREFIX, SPAWN_START_COUNT_KEY, SPAWN_START_DATE_KEY } from "../claude-code/hooks.js";
import { withBudgetDefault, zoneBeside } from "../config.js";
import {
  anyRed,
  doctorFindings,
  readCheckout,
  readCounterpartOpen,
  reportJson
} from "../claude-code/doctor.js";
import { readHost, mcpCommand } from "./install.js";
import { coverageLines } from "./coverage.js";
import { readDesktop } from "./desktop.js";
import { runtimeLabel } from "../runtime.js";
import { installRoute } from "../plugin.js";
import { printStatusReport, printDoctorReport } from "./report.js";
import {
  EXIT,
  openStoreAt,
  openRefusalLine,
  hostConfigFor,
  resolveDir,
  describeDirRefusal,
  customConfigPath
} from "./commands-shared.js";
import { STORE_STARTED_KEY, STORE_PREVIOUS_PARKED_KEY } from "./commands-start-fresh.js";
export function probeCommand(dir, io, namedDir) {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  let store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const decisions = store.eventLog({ name: RECALL_DECISION_EVENT, order: "desc", limit: PROBE_ROW_CEILING }).reverse();
    const credits = store.eventLog({ name: RECALL_CREDIT_EVENT, order: "desc", limit: PROBE_ROW_CEILING }).reverse();
    const rows = [...decisions, ...credits].map((r) => ({ name: r.name, day: r.day, payload: r.payload }));
    for (const line of renderProbe(probeOQ4(rows)))
      io.out(line);
    for (const [name, got] of [
      [RECALL_DECISION_EVENT, decisions.length],
      [RECALL_CREDIT_EVENT, credits.length]
    ]) {
      if (got >= PROBE_ROW_CEILING) {
        io.err(`warning: ${name} hit the ${PROBE_ROW_CEILING}-row ceiling; the oldest rows are missing from this table`);
      }
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}
export function firedCommand(dir, io, namedDir, now, all = false) {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  let store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const today = localDate(now(), store.zone());
    const report = firedReport(store, today);
    for (const line of all ? firedLines(report, true) : mechanismsLines(report, consoleVerdicts(store, today)))
      io.out(line);
    return EXIT.ok;
  } finally {
    store.close();
  }
}
const LOG_NARRATED = [
  "adapter.boundary",
  "adapter.ask",
  "adapter.wake.injected",
  "adapter.writeup.failed",
  "remember.capture.failed"
];
export async function logCommand(dir, io, dateFlag, now) {
  if (dateFlag !== undefined && (typeof dateFlag !== "string" || !isDay(dateFlag))) {
    io.err("refused: --date takes a day, YYYY-MM-DD.");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}.`);
    return EXIT.usage;
  }
  let store = null;
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
      io.out(`Nothing logged on ${date}.` + (held.length === 0 ? " The log is empty — it fills as sessions run." : ` The log keeps ${String(LOG_DAYS)} days; it holds ${held.join(", ")}.`));
      return EXIT.ok;
    }
    const narrator = store === null ? null : await import("../dashboard/web/narrate.js");
    for (const entry of read.entries) {
      let said = null;
      if (narrator !== null && store !== null && LOG_NARRATED.includes(entry.name)) {
        said = narrator.narrate(store, {
          seq: 0,
          at: Date.parse(entry.at),
          day: 0,
          name: entry.name,
          ref: entry.ref,
          dedup_key: null,
          payload: JSON.stringify(entry.data)
        }).text;
      }
      io.out(logEntryLine(entry, zone, said));
    }
    if (read.unreadable > 0)
      io.out(`(${String(read.unreadable)} line${read.unreadable === 1 ? "" : "s"} in the file could not be read)`);
    return EXIT.ok;
  } finally {
    store?.close();
  }
}
export function logEntryLine(entry, zone, said = null) {
  const at = Date.parse(entry.at);
  const time = Number.isFinite(at) ? localTime(at, zone) : entry.at;
  const session = entry.session === null ? "-" : entry.session.slice(0, 8);
  const data = Object.entries(entry.data).map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`).join(" ");
  const ref = entry.ref === null ? "" : ` [${entry.ref}]`;
  return `${time}  ${entry.proc.padEnd(24)}  ${session.padEnd(8)}  ${entry.name}${ref}  ${said ?? data}`.trimEnd();
}
export function coverageCommand(dir, io, parsed, now, namedDir) {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const asked = parsed.flags["date"];
  if (asked !== undefined && (typeof asked !== "string" || !isDay(asked))) {
    io.err("refused: --date takes a day as YYYY-MM-DD.");
    return EXIT.usage;
  }
  let store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const today = localDate(now(), store.zone());
    for (const line of coverageLines({ store, date: typeof asked === "string" ? asked : today, today }))
      io.out(line);
    return EXIT.ok;
  } finally {
    store.close();
  }
}
const YOUNG_STATES = ["firing", "blocked", "quiet"];
export function firedLines(report, all = false) {
  const lines = [
    `what has fired — ${report.from}→${report.today}, against ${report.previousFrom}→${report.previousTo}`,
    ""
  ];
  const young = report.young && !all;
  if (young) {
    const age = report.calendarDays === null ? "nothing has been recorded here yet" : report.calendarDays === 0 ? "everything it holds was recorded today" : `${String(report.calendarDays)} calendar day${report.calendarDays === 1 ? "" : "s"} of records`;
    lines.push(`This store is on lived day ${String(report.livedDay)} — ${age}. Most mechanisms have had nothing to do yet, so below is only what HAS fired and anything that was stopped. The full roll-call of ${String(report.rows.length)} comes back on its own once the store is ` + "old enough for silence to mean something — or run `counterparts mechanisms --all` now.", "");
  }
  if (report.wentBlocked.length > 0) {
    lines.push(`Fired last week and STOPPED this week: ${report.wentBlocked.join("; ")}`, "");
  }
  if (report.missedOccasion.length > 0) {
    lines.push(`Its occasion came this week and it did not fire: ${report.missedOccasion.join("; ")}`, "");
  }
  if (report.wentQuiet.length > 0) {
    lines.push(`Fired last week and not once this week: ${report.wentQuiet.join("; ")}`, "");
  }
  for (const state of STATE_ORDER) {
    if (young && !YOUNG_STATES.includes(state))
      continue;
    const rows = report.rows.filter((r) => r.state === state);
    if (rows.length === 0)
      continue;
    lines.push(`${state.toUpperCase()} (${String(rows.length)}) — ${STATE_MEANING[state]}`);
    for (const row of rows) {
      const when = row.lastFired === null ? "never" : row.lastFired;
      const refused = row.refusedInWindow === 0 ? "" : `  refused ${String(row.refusedInWindow)}${row.topRefusal === null ? "" : ` (${row.topRefusal})`}`;
      lines.push(`  ${row.label}`, `    last ${when}  ·  7d ${String(row.firedInWindow)}  ·  total ${String(row.total)}${refused}  ·  ${row.evidence}`);
      if (row.note !== null)
        lines.push(`    ${row.note}`);
    }
    lines.push("");
  }
  const bounds = [
    `${String(report.rows.length)} mechanisms read; ` + STATE_ORDER.map((s) => `${String(report.counts[s])} ${s}`).join(", ")
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
  bounds.push("Events are bounded-retention telemetry: rows past the window are swept unless a replay latch holds them, so these are what I still have rather than everything that ever happened.");
  lines.push(...bounds);
  return lines;
}
function newestBoundary(store, livedDay) {
  try {
    const [last] = store.eventLog({
      name: BOUNDARY_EVENT,
      sinceDay: Math.max(0, livedDay - 30),
      order: "desc",
      limit: 1
    });
    if (last === undefined)
      return null;
    const payload = JSON.parse(last.payload ?? "{}");
    const date = payload["date"];
    return typeof date === "string" && date.length === 10 ? date : localDate(last.at, store.zone());
  } catch {
    return null;
  }
}
function pageLine(store) {
  try {
    const ids = store.list({ type: "schema", kind: "self", archived: false });
    for (const id of ids) {
      const read = store.read(id);
      if (read.doc.meta["role"] !== "page")
        continue;
      const revised = read.doc.meta["revisedOn"];
      return typeof revised === "string" && revised.length > 0 ? `yes, last revised ${revised}` : "yes";
    }
    return "none yet";
  } catch {
    return "?";
  }
}
function snapshotAge(dir) {
  try {
    const resolved = resolveSnapshotsDir(dir, undefined);
    if (resolved.dir === null)
      return "nowhere to keep one";
    const disk = readSnapshotsDir(resolved.dir);
    const newest = disk.names[disk.names.length - 1];
    return newest === undefined ? "none yet" : `${newest.slice(0, 10)} (${disk.names.length} kept)`;
  } catch {
    return "?";
  }
}
export function statusCommand(dir, io, namedDir, today, layout = false, env = {}) {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  let store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const kinds = ["self", "person", "entity", "skill", "place", "fact"];
    const bands = ["episodic", "semantic", "identity"];
    const denied = new Set(store.deniedIds());
    const byKind = {};
    const byBand = {};
    const permanent = [];
    let memories = 0;
    let addedToday = 0;
    let schemas = 0;
    let journal = 0;
    let archived = 0;
    let superseded = 0;
    const day = store.livedDay();
    for (const id of store.list()) {
      const row = store.row(id);
      if (row === undefined || denied.has(id))
        continue;
      if (row.archived === 1) {
        archived += 1;
        continue;
      }
      if (row.superseded_by !== null) {
        superseded += 1;
        continue;
      }
      if (isJournal(row)) {
        journal += 1;
        continue;
      }
      if (row.type === "schema")
        schemas += 1;
      else
        memories += 1;
      if (row.learned_on === today)
        addedToday += 1;
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
      let liveBand = row.band;
      try {
        liveBand = band(store.physicsOf(id), day);
      } catch {}
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
          why: row.protected === 1 ? "protected" : "promoted to identity"
        });
      }
    }
    const plain = [];
    const say = (line) => {
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
    say(`Memories: ${memories}   Beliefs and entities: ${schemas}   Journal: ${journal} ${journal === 1 ? "episode" : "episodes"}   Archived: ${archived}   Superseded: ${superseded}`);
    const byKindSaid = kinds.map((k) => `${k} ${byKind[k] ?? 0}`).join("  ");
    const byBandSaid = bands.map((b) => `${b} ${byBand[b] ?? 0}`).join("  ");
    say(`  by kind: ${byKindSaid}   (memories + beliefs and entities)`);
    say(`  by band: ${byBandSaid}   (computed from physics today, not the stored column)`);
    say("");
    say(`Today (${today}): ${String(addedToday)} new` + `   ·   Lived day ${day}` + `   ·   Last active ${lastActive}` + `   ·   Last boundary ${lastBoundary}`);
    say(`Self page: ${pageSaid}` + `   ·   Newest snapshot: ${snapshotSaid}` + `   ·   Journal mode: ${journalMode}` + `   ·   Removed: ${removals.length}` + `   ·   Permanent: ${permanent.length}`);
    const began = store.getMeta(STORE_STARTED_KEY);
    const previous = store.getMeta(STORE_PREVIOUS_PARKED_KEY);
    const beganSaid = began === undefined || began.length === 0 ? null : `${began}${previous === undefined || previous.length === 0 ? "  (a fresh start; nothing was parked)" : `   ·   the previous store is parked at ${previous}, untouched`}`;
    if (beganSaid !== null)
      say(`Began: ${beganSaid}`);
    const asides = [
      "Memories is the number the wake preface states; the journal does not decay.",
      "counterparts doctor grades all of this; counterparts mechanisms says which mechanisms are working."
    ];
    say("");
    for (const aside of asides)
      say(`  ${aside}`);
    const tail = [];
    if (removals.length > 0) {
      const rows = removals.map((row) => `  ${localDate(row.at, store.zone())}  ${row.memory_id}  by ${row.actor}`);
      tail.push({ title: "Removed:", lines: rows });
      say("");
      say("Removed:");
      for (const line of rows)
        say(line);
    }
    if (permanent.length > 0) {
      const rows = permanent.map((entry) => `  ${entry.id}  ${entry.title}  — ${entry.why}`);
      tail.push({ title: "Permanent (enumerable on demand, §14.1 G9):", lines: rows });
      say("");
      say("Permanent (enumerable on demand, §14.1 G9):");
      for (const line of rows)
        say(line);
    }
    if (layout) {
      const rows = LAYOUT.map((entry) => {
        const present = existsSync(join(store.dir, entry.name)) ? " " : "-";
        return `  ${present} ${entry.backup ? "backed up" : "excluded "}  ${entry.name}  — ${entry.why}`;
      });
      tail.push({ title: "Layout:", lines: rows });
      say("");
      say("Layout:");
      for (const line of rows)
        say(line);
    }
    const blocks = [
      {
        title: "Memory",
        rows: [
          { label: "Memories", value: String(memories) },
          { label: "Beliefs and entities", value: String(schemas) },
          { label: "Journal", value: `${journal} ${journal === 1 ? "episode" : "episodes"}` },
          { label: "Archived", value: String(archived) },
          { label: "Superseded", value: String(superseded) },
          { label: "by kind", value: byKindSaid, verbatim: true },
          { label: "by band", value: byBandSaid, verbatim: true }
        ],
        notes: [
          "by kind counts memories and beliefs and entities together.",
          "by band is computed from physics today, not from the stored column."
        ]
      },
      {
        title: `Today — ${today}`,
        rows: [
          { label: "New today", value: String(addedToday) },
          { label: "Lived day", value: String(day) },
          { label: "Last active", value: lastActive },
          { label: "Last boundary", value: lastBoundary }
        ]
      },
      {
        title: "This store",
        rows: [
          { label: "Self page", value: pageSaid },
          { label: "Newest snapshot", value: snapshotSaid },
          { label: "Journal mode", value: journalMode },
          { label: "Removed", value: String(removals.length) },
          { label: "Permanent", value: String(permanent.length) },
          ...beganSaid === null ? [] : [{ label: "Began", value: beganSaid }]
        ]
      }
    ];
    const view = { plain, dir: store.dir, blocks, notes: asides, tail };
    printStatusReport(io, env, view);
    const faulted = store.faultedIds();
    if (faulted.length > 0) {
      io.out("");
      io.err(`Rows whose words are missing: ${String(faulted.length)} — ${faulted.slice(0, 5).join(", ")}` + (faulted.length > 5 ? ` and ${String(faulted.length - 5)} more` : "") + ". Every session stands down on a store that holds one. Run: counterparts doctor.");
      return EXIT.failed;
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}
export const DOCTOR_RED_EXIT = 1;
function claudeOnPath(env) {
  const path = env["PATH"];
  if (path === undefined || path.trim().length === 0)
    return null;
  for (const dir of path.split(delimiter)) {
    if (dir.length === 0)
      continue;
    try {
      const st = statSync(join(dir, "claude"));
      if (st.isFile() && (st.mode & 73) !== 0)
        return true;
    } catch {}
  }
  return false;
}
function spawnStartCounter(store) {
  if (store === null)
    return { date: null, count: 0 };
  try {
    return {
      date: store.getMeta(SPAWN_START_DATE_KEY) ?? null,
      count: Number(store.getMeta(SPAWN_START_COUNT_KEY) ?? "0")
    };
  } catch {
    return { date: null, count: 0 };
  }
}
function spawnRefusalCounters(store) {
  if (store === null)
    return {};
  const out = {};
  for (const [key, value] of store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
    const n = Number(value);
    if (n > 0)
      out[key.slice(SPAWN_REFUSAL_PREFIX.length)] = n;
  }
  return out;
}
export function doctorCommand(parsed, io, env, named, checkout, home) {
  const configPath = named?.path ?? defaultConfigPath();
  const unread = typeof parsed.flags["dir"] === "string" && (named === undefined || named.source === "default") && explicitDirSetting(env).armed;
  const { config, reason, unreadableKeys } = unread ? { config: {}, reason: "not-read", unreadableKeys: undefined } : hostConfigFor(configPath);
  const namedConfig = named !== undefined && named.source !== "default";
  const guard = explicitDirSetting(env);
  let dir;
  try {
    if (typeof parsed.flags["dir"] === "string") {
      dir = parsed.flags["dir"];
    } else if (config.dataDir !== undefined && !namedConfig && guard.armed) {
      throw new StoreError("IMPLICIT_DEFAULT_DIR_REFUSED", {
        guard: `${REQUIRE_EXPLICIT_DIR_ENV}=${guard.value}`,
        dir: config.dataDir
      });
    } else {
      dir = config.dataDir ?? resolveDir(env);
    }
  } catch (err) {
    io.err(describeDirRefusal(err));
    return EXIT.refused;
  }
  const today = todayIn(resolveZone(config.timeZone));
  let store = null;
  try {
    const open = storeExists(dir) ? readCounterpartOpen(dir, undefined, config.snapshots?.dir) : undefined;
    if (storeExists(dir)) {
      try {
        store = Store.open({ dir, observer: true, ...config.timeZone === undefined ? {} : { timeZone: config.timeZone } });
      } catch (err) {
        if (isStoreError(err, "STORE_ROLLED_BACK")) {
          store = null;
        } else if (open?.migration === undefined || !isStoreError(err, "STORE_UNINITIALIZED"))
          throw err;
      }
    }
    const findings = doctorFindings({
      configPath,
      configReason: reason,
      ...unreadableKeys === undefined ? {} : { configUnreadableKeys: unreadableKeys },
      config: reason === "loaded" ? withBudgetDefault(config) : config,
      dir,
      store,
      today,
      refusals: spawnRefusalCounters(store),
      starts: spawnStartCounter(store),
      checkout: checkout ?? readCheckout(),
      host: {
        ...readHost(home ?? homedir(), process.cwd(), env),
        claudeOnPath: claudeOnPath(env),
        mcpAddLine: mcpCommand(dir, undefined, customConfigPath(named, home ?? homedir())),
        consoleRuntime: runtimeLabel()
      },
      desktop: readDesktop(home ?? homedir(), env),
      install: installRoute(env),
      ...open === undefined ? {} : { open }
    });
    if (parsed.flags["json"] === true) {
      io.out(JSON.stringify(reportJson(findings, today), null, 2));
    } else {
      printDoctorReport(io, env, findings, today, { all: parsed.flags["all"] === true });
    }
    return anyRed(findings) ? DOCTOR_RED_EXIT : EXIT.ok;
  } finally {
    store?.close();
  }
}
