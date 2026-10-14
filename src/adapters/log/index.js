import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertSafeDataDir } from "../../core/store/index.js";
import { daysBetween, isDay, isoInstant, localDate, resolveZone } from "../../core/time.js";
import { SESSIONS_DIR } from "../sessions.js";
import { packagePath } from "../runtime.js";
export const LOG_DIR = "log";
export const LOG_DAYS = 7;
export const PROCESS_START = "process.start";
export const PROCESS_END = "process.end";
export const LOGGED = {
  names: new Set([
    PROCESS_START,
    PROCESS_END,
    "adapter.boundary",
    "adapter.ask",
    "adapter.writeup.ask",
    "adapter.writeup.deferred",
    "adapter.writeup.skipped",
    "mcp.write_up",
    "mcp.session_end",
    "handoff.written",
    "handoff.cleared",
    "handoff.refused",
    "handoff.lasthere.noroom",
    "adapter.night.started",
    "adapter.night.handed",
    "adapter.night.writeup",
    "adapter.night.spill",
    "adapter.dream.unwatched",
    "dream.night",
    "self.page.writer.ran",
    "dream.begun",
    "dream.journaled",
    "reflection.begun",
    "reflection.finished",
    "adapter.wake.injected",
    "counterpart.self.briefing",
    "counterpart.rebrief",
    "counterpart.sleep.cycle",
    "runner.retention",
    "runner.done",
    "runner.refused",
    "mcp.refused",
    "mcp.result.oversize",
    "adapter.envelope.overcap",
    "adapter.notice.dropped",
    "adapter.injection.overbudget"
  ]),
  suffixes: [".failed", ".threw", ".standdown"]
};
export function logged(name) {
  return LOGGED.names.has(name) || LOGGED.suffixes.some((s) => name.endsWith(s));
}
export function isFailure(entry) {
  if (entry.name.endsWith(".failed") || entry.name.endsWith(".threw"))
    return true;
  return entry.name === PROCESS_END && entry.data?.["reason"] === "threw";
}
export function logDir(dataDir) {
  return join(dataDir, SESSIONS_DIR, LOG_DIR);
}
export function logFile(dataDir, date) {
  return join(logDir(dataDir), `${date}.log`);
}
const PLAIN = /^(?:[A-Za-z0-9][A-Za-z0-9._:@+=,/-]{0,159})?$/;
function cleanValue(v) {
  if (v === null || v === undefined)
    return null;
  if (typeof v === "boolean")
    return v;
  if (typeof v === "number")
    return Number.isFinite(v) ? v : null;
  if (typeof v === "string")
    return PLAIN.test(v) && !v.includes("..") ? v : `[text:${String(v.length)}]`;
  if (Array.isArray(v))
    return `[list:${String(v.length)}]`;
  if (typeof v === "object")
    return `[map:${String(Object.keys(v).length)}]`;
  return null;
}
export function clean(data) {
  const out = {};
  if (data === undefined)
    return out;
  for (const [k, v] of Object.entries(data)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(k))
      continue;
    out[k] = cleanValue(v);
  }
  return out;
}
const SRC_ROOT = resolve(packagePath("src"));
export function errorFields(err) {
  const name = err !== null && typeof err === "object" ? err.name : undefined;
  const code = err !== null && typeof err === "object" ? err.code : undefined;
  return {
    error: typeof name === "string" ? name : typeof err,
    code: typeof code === "string" ? code : typeof name === "string" ? name : "UNKNOWN",
    where: topFrame(err)
  };
}
function topFrame(err) {
  const stack = err !== null && typeof err === "object" ? err.stack : undefined;
  if (typeof stack !== "string")
    return null;
  for (const line of stack.split(`
`).slice(1)) {
    const m = /\(?((?:file:\/\/)?\/[^()\s]+?\.ts):(\d+)(?::\d+)?\)?\s*$/.exec(line.trim());
    if (m === null)
      continue;
    const file = (m[1] ?? "").replace(/^file:\/\//, "");
    const rel = relative(SRC_ROOT, file);
    if (rel.startsWith("..") || rel.length === 0)
      continue;
    return `${rel}:${m[2] ?? ""}`;
  }
  return null;
}
const OFF = {
  on: false,
  event: () => {},
  start: () => {},
  end: () => {},
  threw: () => {}
};
export function openLog(opts) {
  if (opts.observer === true || opts.dataDir === undefined || opts.dataDir.trim().length === 0)
    return OFF;
  let dataDir;
  try {
    dataDir = assertSafeDataDir(opts.dataDir);
  } catch {
    return OFF;
  }
  const now = opts.now ?? (() => Date.now());
  const zone = resolveZone(opts.timeZone);
  const began = now();
  const session = () => {
    const s = typeof opts.session === "function" ? opts.session() : opts.session;
    return s === undefined || s === null || s.length === 0 ? null : s;
  };
  let ready = false;
  const write = (at, name, ref, data) => {
    try {
      if (!ready) {
        if (!existsSync(dataDir))
          return;
        mkdirSync(logDir(dataDir), { recursive: true, mode: 448 });
        ready = true;
      }
      const s = session();
      const line = {
        at: isoInstant(at),
        proc: opts.proc,
        pid: process.pid,
        session: s === null ? null : cleanValue(s),
        name,
        ...ref === undefined || ref === null ? {} : { ref: cleanValue(ref) },
        data: clean(data)
      };
      appendFileSync(logFile(dataDir, localDate(at, zone)), `${JSON.stringify(line)}
`, { encoding: "utf8", mode: 384 });
    } catch {}
  };
  const end = (reason, data) => {
    const at = now();
    write(at, PROCESS_END, null, { ...data ?? {}, ms: at - began, reason });
  };
  return {
    on: true,
    event: (e) => {
      try {
        if (!logged(e.name))
          return;
        write(typeof e.at === "number" ? e.at : now(), e.name, e.ref, e.data);
      } catch {}
    },
    start: (data) => write(now(), PROCESS_START, null, data),
    end,
    threw: (err) => end("threw", errorFields(err))
  };
}
export function readLog(dataDir, date) {
  let text;
  try {
    text = readFileSync(logFile(dataDir, date), "utf8");
  } catch {
    return { date, exists: false, entries: [], unreadable: 0 };
  }
  const entries = [];
  let unreadable = 0;
  for (const line of text.split(`
`)) {
    if (line.trim().length === 0)
      continue;
    const entry = parseLine(line);
    if (entry === null)
      unreadable += 1;
    else
      entries.push(entry);
  }
  return { date, exists: true, entries, unreadable };
}
function parseLine(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const r = raw;
  if (typeof r["at"] !== "string" || typeof r["proc"] !== "string" || typeof r["name"] !== "string")
    return null;
  const data = r["data"];
  return {
    at: r["at"],
    proc: r["proc"],
    pid: typeof r["pid"] === "number" ? r["pid"] : null,
    session: typeof r["session"] === "string" ? r["session"] : null,
    name: r["name"],
    ref: typeof r["ref"] === "string" ? r["ref"] : null,
    data: data !== null && typeof data === "object" && !Array.isArray(data) ? clean(data) : {}
  };
}
export function logDates(dataDir) {
  let names;
  try {
    names = readdirSync(logDir(dataDir));
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(".log") && isDay(n.slice(0, -4))).map((n) => n.slice(0, -4)).sort();
}
export function pruneLog(dataDir, today, days = LOG_DAYS) {
  let removed = 0;
  for (const date of logDates(dataDir)) {
    try {
      if (daysBetween(date, today) <= days)
        continue;
      rmSync(logFile(dataDir, date), { force: true });
      removed += 1;
    } catch {
      continue;
    }
  }
  return removed;
}
export function clearLog(dataDir) {
  let removed = 0;
  let failed = 0;
  for (const date of logDates(dataDir)) {
    try {
      rmSync(logFile(dataDir, date), { force: true });
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}
export function logReading(dataDir, today) {
  const read = readLog(dataDir, today);
  return {
    dir: logDir(dataDir),
    days: logDates(dataDir).length,
    failuresToday: read.entries.filter((e) => isFailure(e)).length,
    linesToday: read.entries.length
  };
}
