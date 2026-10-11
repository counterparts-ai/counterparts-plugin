/**
 * The log — one line per event, to a per-date file, for the processes whose
 * rings die with them.
 *
 * **Why it exists.** Every component keeps an in-memory event ring, and until
 * 2026-09-30 none of the four processes that run them wired its `onEvent`: the
 * hook, the turn-end worker, the nightly run and the MCP server. About 270 event
 * names — some 55 of them `*.failed` or `*.threw` — lived for one process and
 * went nowhere, and the worker and the nightly child run with their output
 * discarded. The durable `events` table keeps the facts doctor and the dashboard
 * read; this keeps the order things happened in, for a week, so "what happened
 * at that Stop" has an answer after the process is gone.
 *
 * **Where it lives.** `<dataDir>/sessions/log/<YYYY-MM-DD>.log`, the date the
 * person's calendar day in the store's zone. INSIDE `sessions/`, never beside
 * it: `store/paths.ts#assertLayout` makes a build that predates a new top-level
 * name refuse the whole store, and the `sessions` entry's own note says new host
 * state goes inside it. Nothing that lists `sessions/` reads a sub-directory as
 * a record (`sessions.ts` filters by name; `pruneSessions` cannot remove a
 * directory), and `test/log.test.ts` holds both.
 *
 * **What a line is.** One JSON object: the moment (`isoInstant`), which
 * process (`hook:<event>`, `worker`, `nightly`, `mcp`) and its pid, the
 * session when known, the event's name, its `ref`, and its data. Written with
 * one append per line, so four processes can share a file without tearing.
 *
 * **What goes in** is `LOGGED`, below, and nothing else. **What a value may
 * be** is the store's rule (`store/CONTRACT.md` §5 G10): ids, hashes, counts,
 * codes, kinds. `clean` holds every string to that shape, so a value that is
 * not one — a path, a sentence, an error's message — is written as its length
 * and never as itself, whoever emitted it.
 *
 * **It never fails its caller.** Every write is swallowed: a log that cost a
 * hook its turn would be the instrument breaking the thing it watches. Observer
 * writes nothing at all.
 *
 * A shared leaf beside `sessions.ts`, for the same reason that file is one:
 * three adapters use it and `mcp/INTERFACE-GAPS.md` §7 keeps adapters from
 * importing each other.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { assertSafeDataDir } from "../../core/store/index.js";
import { daysBetween, isDay, isoInstant, localDate, resolveZone } from "../../core/time.js";
import { SESSIONS_DIR } from "../sessions.js";
import { packagePath } from "../runtime.js";

/** The directory, inside `sessions/`. */
export const LOG_DIR = "log";

/**
 * **CAL.** How many calendar days a file is kept past its own: a file dated
 * more than this many days before today is deleted at the next SessionStart
 * (`pruneLog`). "Keep it for the past seven days or so" (owner, 2026-09-30).
 */
export const LOG_DAYS = 7;

/** The two names the log writes about its own process. */
export const PROCESS_START = "process.start";
export const PROCESS_END = "process.end";

/**
 * WHAT GOES IN, in one place. A working default, meant to be edited: an event
 * that turns out to matter joins here, one that turns out to be noise leaves.
 *
 * Out, on purpose: per-prompt recall and association detail (`recall.*`,
 * `counterpart.recall.decision`, `associate.*`, `adapter.recall`,
 * `mcp.recall`), the store's own bookkeeping (`store.*`, including
 * `store.event.appended`, which would double every durable row), and anything
 * the durable `events` table already answers better.
 */
export const LOGGED: { readonly names: ReadonlySet<string>; readonly suffixes: readonly string[] } = {
  names: new Set([
    PROCESS_START,
    PROCESS_END,
    // The turn's end: what was captured, and whether it was asked and why.
    "adapter.boundary",
    "adapter.ask",
    // Write-ups: the pointer offered at a start, and the answers.
    "adapter.writeup.ask",
    "adapter.writeup.deferred",
    "adapter.writeup.skipped",
    "mcp.write_up",
    "mcp.session_end",
    // Handoffs.
    "handoff.written",
    "handoff.cleared",
    "handoff.refused",
    "handoff.lasthere.noroom",
    // The nightly run: its states, and its parts.
    "adapter.night.started",
    "adapter.night.handed",
    // ...and its morning catch-up: granted, written up, left owed (2026-10-01).
    "adapter.night.writeup",
    // ...and what its own transcript said about the host's cut (2026-10-09).
    "adapter.night.spill",
    // ...and a run a session nobody watched started (2026-10-01, lane 8).
    "adapter.dream.unwatched",
    "dream.night",
    "self.page.writer.ran",
    "dream.begun",
    "dream.journaled",
    "reflection.begun",
    "reflection.finished",
    // The wake: handed to the host, re-rendered, rebuilt by hand.
    "adapter.wake.injected",
    "counterpart.self.briefing",
    "counterpart.rebrief",
    // The worker's day: the cycle, the retention pass, and its own summary.
    "counterpart.sleep.cycle",
    "runner.retention",
    "runner.done",
    // Refusals a process or a tool made by name.
    "runner.refused",
    "mcp.refused",
    // A tool result cut to the host's ceiling (2026-10-02; durable too).
    "mcp.result.oversize",
    // A hook past the host's cap, a dropped notice, a start over its ceiling
    // (2026-10-02; durable too).
    "adapter.envelope.overcap",
    "adapter.notice.dropped",
    "adapter.injection.overbudget",
  ]),
  // Every failure, and every stand-down.
  suffixes: [".failed", ".threw", ".standdown"],
};

export function logged(name: string): boolean {
  return LOGGED.names.has(name) || LOGGED.suffixes.some((s) => name.endsWith(s));
}

/** A line that records something going wrong: a `*.failed` or `*.threw`, or a
 *  process that ended by throwing. What doctor counts. */
export function isFailure(entry: { readonly name: string; readonly data?: Record<string, unknown> }): boolean {
  if (entry.name.endsWith(".failed") || entry.name.endsWith(".threw")) return true;
  return entry.name === PROCESS_END && entry.data?.["reason"] === "threw";
}

export function logDir(dataDir: string): string {
  return join(dataDir, SESSIONS_DIR, LOG_DIR);
}

export function logFile(dataDir: string, date: string): string {
  return join(logDir(dataDir), `${date}.log`);
}

// ── the content rule ─────────────────────────────────────────────────────────

/**
 * A value the log may write as itself: an id, a code, a kind, a date, a short
 * hash — letters and digits and a little punctuation, no spaces, not starting
 * with `/` or `~`, and never `..`. Anything else is a path, a sentence or an
 * error message, and `clean` writes its length instead.
 */
const PLAIN = /^(?:[A-Za-z0-9][A-Za-z0-9._:@+=,/-]{0,159})?$/;

export type LogValue = string | number | boolean | null;

function cleanValue(v: unknown): LogValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return PLAIN.test(v) && !v.includes("..") ? v : `[text:${String(v.length)}]`;
  if (Array.isArray(v)) return `[list:${String(v.length)}]`;
  if (typeof v === "object") return `[map:${String(Object.keys(v).length)}]`;
  return null;
}

/** The data, held to the content rule. Keys are the emitter's own names. */
export function clean(data: Record<string, unknown> | undefined): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  if (data === undefined) return out;
  for (const [k, v] of Object.entries(data)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(k)) continue;
    out[k] = cleanValue(v);
  }
  return out;
}

/** This package's `src/`, for an error's top frame. */
const SRC_ROOT = resolve(packagePath("src"));

/**
 * An error as the log may write it: its class, its code, and the top source
 * location in this package (`adapters/claude-code/hooks.ts:123`). NEVER its
 * message — a message can quote whatever the failing call was handed.
 */
export function errorFields(err: unknown): { error: string; code: string; where: string | null } {
  const name = err !== null && typeof err === "object" ? (err as { name?: unknown }).name : undefined;
  const code = err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  return {
    error: typeof name === "string" ? name : typeof err,
    code: typeof code === "string" ? code : typeof name === "string" ? name : "UNKNOWN",
    where: topFrame(err),
  };
}

function topFrame(err: unknown): string | null {
  const stack = err !== null && typeof err === "object" ? (err as { stack?: unknown }).stack : undefined;
  if (typeof stack !== "string") return null;
  for (const line of stack.split("\n").slice(1)) {
    const m = /\(?((?:file:\/\/)?\/[^()\s]+?\.ts):(\d+)(?::\d+)?\)?\s*$/.exec(line.trim());
    if (m === null) continue;
    const file = (m[1] ?? "").replace(/^file:\/\//, "");
    const rel = relative(SRC_ROOT, file);
    if (rel.startsWith("..") || rel.length === 0) continue;
    return `${rel}:${m[2] ?? ""}`;
  }
  return null;
}

// ── writing ──────────────────────────────────────────────────────────────────

/** An event as every ring in this package shapes one. */
export interface LogEvent {
  readonly at?: number;
  readonly name: string;
  readonly ref?: string | null;
  readonly data?: Record<string, unknown>;
}

/** One process's log. Every method is safe to call from anywhere; none throws. */
export interface ProcessLog {
  /** False for observer, for no data dir, and for a dir the store would refuse. */
  readonly on: boolean;
  /** An event from a ring — written only if `LOGGED` admits its name. Bound,
   *  so it can be handed straight to an `onEvent`. */
  readonly event: (e: LogEvent) => void;
  /** `process.start`, with whatever the caller knows about the launch. */
  readonly start: (data?: Record<string, unknown>) => void;
  /** `process.end`: how long since `openLog`, and why it ended. */
  readonly end: (reason: string, data?: Record<string, unknown>) => void;
  /** `process.end` for a process that is ending by a throw. */
  readonly threw: (err: unknown) => void;
}

export interface OpenLogOptions {
  readonly dataDir: string | undefined;
  /** `hook:<event>`, `worker`, `nightly` or `mcp`. */
  readonly proc: string;
  /** The session, when known — a function for a process that learns it late
   *  (the MCP server's lazy bind). */
  readonly session?: string | null | (() => string | null);
  /** The configuration's `timeZone`; the date in the file name is the day in
   *  this zone, as `Store#zone` resolves it. */
  readonly timeZone?: string;
  readonly observer?: boolean;
  readonly now?: () => number;
}

const OFF: ProcessLog = {
  on: false,
  event: () => {},
  start: () => {},
  end: () => {},
  threw: () => {},
};

export function openLog(opts: OpenLogOptions): ProcessLog {
  if (opts.observer === true || opts.dataDir === undefined || opts.dataDir.trim().length === 0) return OFF;
  let dataDir: string;
  try {
    dataDir = assertSafeDataDir(opts.dataDir);
  } catch {
    return OFF;
  }
  const now = opts.now ?? ((): number => Date.now());
  const zone = resolveZone(opts.timeZone);
  const began = now();
  const session = (): string | null => {
    const s = typeof opts.session === "function" ? opts.session() : opts.session;
    return s === undefined || s === null || s.length === 0 ? null : s;
  };
  let ready = false;
  const write = (at: number, name: string, ref: string | null | undefined, data: Record<string, unknown> | undefined): void => {
    try {
      // The log never makes a data dir: a store that is not there yet is the
      // store's to create, under its own guards.
      if (!ready) {
        if (!existsSync(dataDir)) return;
        mkdirSync(logDir(dataDir), { recursive: true, mode: 0o700 });
        ready = true;
      }
      const s = session();
      const line = {
        at: isoInstant(at),
        proc: opts.proc,
        pid: process.pid,
        session: s === null ? null : cleanValue(s),
        name,
        ...(ref === undefined || ref === null ? {} : { ref: cleanValue(ref) }),
        data: clean(data),
      };
      // ONE append per line. O_APPEND puts each write at the end of the file,
      // so lines from four processes interleave whole.
      appendFileSync(logFile(dataDir, localDate(at, zone)), `${JSON.stringify(line)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      // A log that failed its caller would be the instrument breaking the thing
      // it watches.
    }
  };
  const end = (reason: string, data?: Record<string, unknown>): void => {
    const at = now();
    write(at, PROCESS_END, null, { ...(data ?? {}), ms: at - began, reason });
  };
  return {
    on: true,
    event: (e) => {
      try {
        if (!logged(e.name)) return;
        write(typeof e.at === "number" ? e.at : now(), e.name, e.ref, e.data);
      } catch {
        /* never the caller's problem */
      }
    },
    start: (data) => write(now(), PROCESS_START, null, data),
    end,
    threw: (err) => end("threw", errorFields(err)),
  };
}

// ── reading ──────────────────────────────────────────────────────────────────

export interface LogEntry {
  readonly at: string;
  readonly proc: string;
  readonly pid: number | null;
  readonly session: string | null;
  readonly name: string;
  readonly ref: string | null;
  readonly data: Record<string, LogValue>;
}

export interface LogRead {
  readonly date: string;
  /** False when there is no file for that day. */
  readonly exists: boolean;
  /** In file order, which is the order they were written. */
  readonly entries: LogEntry[];
  /** Lines that would not parse — a torn tail, a hand edit. Counted, never guessed at. */
  readonly unreadable: number;
}

export function readLog(dataDir: string, date: string): LogRead {
  let text: string;
  try {
    text = readFileSync(logFile(dataDir, date), "utf8");
  } catch {
    return { date, exists: false, entries: [], unreadable: 0 };
  }
  const entries: LogEntry[] = [];
  let unreadable = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const entry = parseLine(line);
    if (entry === null) unreadable += 1;
    else entries.push(entry);
  }
  return { date, exists: true, entries, unreadable };
}

function parseLine(line: string): LogEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["at"] !== "string" || typeof r["proc"] !== "string" || typeof r["name"] !== "string") return null;
  const data = r["data"];
  return {
    at: r["at"],
    proc: r["proc"],
    pid: typeof r["pid"] === "number" ? r["pid"] : null,
    session: typeof r["session"] === "string" ? r["session"] : null,
    name: r["name"],
    ref: typeof r["ref"] === "string" ? r["ref"] : null,
    data: data !== null && typeof data === "object" && !Array.isArray(data) ? clean(data as Record<string, unknown>) : {},
  };
}

/** The dates that have a file, oldest first. */
export function logDates(dataDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(logDir(dataDir));
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".log") && isDay(n.slice(0, -4)))
    .map((n) => n.slice(0, -4))
    .sort();
}

/**
 * Delete the files dated more than `days` calendar days before `today`. Called
 * beside `pruneSessions`, at SessionStart — once a session, never a turn. A file
 * whose name is not a date is not this module's, and is left alone. Never throws.
 */
export function pruneLog(dataDir: string, today: string, days: number = LOG_DAYS): number {
  let removed = 0;
  for (const date of logDates(dataDir)) {
    try {
      if (daysBetween(date, today) <= days) continue;
      rmSync(logFile(dataDir, date), { force: true });
      removed += 1;
    } catch {
      continue;
    }
  }
  return removed;
}

/** What doctor says in one line: where, how many days, how many failures today. */
export interface LogReading {
  readonly dir: string;
  readonly days: number;
  readonly failuresToday: number;
  readonly linesToday: number;
}

export function logReading(dataDir: string, today: string): LogReading {
  const read = readLog(dataDir, today);
  return {
    dir: logDir(dataDir),
    days: logDates(dataDir).length,
    failuresToday: read.entries.filter((e) => isFailure(e)).length,
    linesToday: read.entries.length,
  };
}
