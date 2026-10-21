/**
 * THE SIDEBAR'S STATUS FILE (2026-10-14) — what the Claude Code sidebar mod
 * (`hooks/sidebar/`) shows, written where it can read it without a network.
 *
 * The plugin directory's review holds a mod that can both fetch and run a
 * command, so the sidebar stopped asking the dashboard on 127.0.0.1:4747 and
 * reads this file with `$.fs.read` instead, on the timer it already had. The
 * dashboard keeps every endpoint (its own page uses them); only the sidebar
 * stopped calling them.
 *
 * **Where.** `<config dir>/sidebar.json`, beside `scopes.json` — the sidebar
 * already finds that directory the way the hooks find their configuration
 * (`hooks/sidebar/hooks/register.tsx#scopesFile`). NOT inside the store: every
 * top-level name there is classified (`core/store/paths.ts#LAYOUT`) and an
 * unclassified one refuses the store at open, an older build's included.
 *
 * **What.** The answers the sidebar used to ask for, computed by the same view
 * functions the dashboard serves them from: which store (`storeId`, the
 * `/api/whoami` id, so a sidebar never shows another memory's numbers), the
 * pulse, today's counts per mechanism, the newest dreams, the newest rows of
 * the activity log (and of the few names the sidebar reads deeper), each
 * mechanism's panel, and the memories those rows name — title, kind, the date
 * it was learned, and the first {@link TEXT_CAP} characters of its text.
 * Capped throughout; measured on the demo store it is
 * well under 256 KiB.
 *
 * **When.** Never on a hook's path. The detached worker writes it after every
 * boundary (Stop, SessionEnd: `claude-code/bin/runner.ts`), and the MCP server
 * a moment after it starts, after each tool call that wrote, and whenever the
 * activity log moved under it (`mcp/bin/serve.ts`). Each write opens its own
 * observer handle — the view functions refuse a writable one — and closes it.
 *
 * **How.** A temp file of this process's own, then a rename: a reader sees the
 * old file or the new one, never half of either, and two writers racing each
 * land whole. It never throws: the result says what happened.
 *
 * **The race it does not close (2026-10-15).** Each writer looks at the file
 * just before its rename and keeps a newer one of its store; two writers can
 * still both look, then both rename, and the older one lands last. Closing it
 * would take a lock around a rename; the window is a few milliseconds, the
 * next write puts it right, and the sidebar already keeps the newer file it
 * holds over an older one of the same store (`hooks/sidebar/hooks/register.tsx`).
 *
 * **A store put back (2026-10-15).** A rollback or a snapshot restore keeps
 * the store's id and lowers its log's newest seq, so a file written before it
 * stands "ahead" of the log. No writer could have seen a seq the log does not
 * have (the log only grows otherwise), so a file ahead of the log as it stands
 * is the old store's and is written over; the sidebar takes a lower seq of the
 * same store when the file is newer by more than a race could make it.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { Dashboard } from "./dashboard/index.js";
import type { DashboardSource } from "./dashboard/source.js";
import { dreamsView } from "./dashboard/web/views/dreams.js";
import { feltDetail, narrate } from "./dashboard/web/narrate.js";
import { mechanismActivity } from "./dashboard/web/views/mechanism-panel.js";
import { mechanismsView } from "./dashboard/web/views/mechanisms.js";
import { memoriesHeld } from "./dashboard/web/views/shared.js";
import { memoryDetail } from "./dashboard/web/views.js";
import { pluginInstall } from "./host-wiring.js";
import { FELT_EVENTS, feltScope, payloadOf, primeFelt } from "./mechanism-evidence.js";
import { PLUGIN_ROOT_ENV } from "./plugin.js";
import { installedVersion } from "./sessions.js";
import { storeId } from "./store-id.js";

export const SIDEBAR_FILE_NAME = "sidebar.json";
/** The file's shape. A reader that does not know a version shows nothing from it. */
export const SIDEBAR_STATUS_VERSION = 1;

/** Newest rows of the whole log: what lights the sidebar's dot and moves its counts between two files. */
export const RECENT_ROWS = 100;
/** Newest rows of the names the sidebar reads deeper (a resumed session's surfaced and saved, a mechanism's firings). */
export const NAMED_ROWS: Readonly<Record<string, number>> = {
  "recall.decision": 40,
  "gate.deposit": 40,
  "contradiction.settled": 20,
  "dream.journaled": 5,
};
/** Dreams carried (the newest is shown; a dream's firings read the changes of the few newest). */
export const DREAMS = 3;
/**
 * Memories carried, and how much of each one's text: what an opened memory
 * shows in the pane (20 lines at the docked width, 32 cells on the terminal,
 * about 38 in the desktop's font), so the pane reads as it did when it asked
 * the dashboard; a longer text ends with `more` (the rest is on the dashboard).
 */
export const MEMORY_CAP = 60;
export const TEXT_CAP = 800;
/** The memory server writes the file at least this often while it runs, moved or not. */
export const REFRESH_MS = 30 * 60_000;

/**
 * THE DASHBOARD'S ADDRESS, AS DATA (2026-10-16). The full plugin's sidebar
 * draws COUNTERPARTS as a link to the dashboard, and the sidebar's own files
 * spell no address (`test/sidebar-shows-not-acts.test.ts`), so core writes the
 * one the dashboard serves on here: the port `web/server.ts#resolvePort` takes
 * with no `--port` (`COUNTERPARTS_DASHBOARD_PORT`, else 4747), restated rather
 * than imported, as `cli/commands-dashboard.ts` does, to keep the server out of
 * this module graph (`test/sidebar-status.test.ts` holds the two together).
 * Port 0 (a random port): null, and the sidebar draws no link. Whether a
 * dashboard is running there is not known here: the write is synchronous and
 * skipped while nothing moved, so an up or down written here would go stale.
 */
export const DASHBOARD_PORT_ENV = "COUNTERPARTS_DASHBOARD_PORT";
export const DASHBOARD_PORT = 4747;

export function dashboardUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const fromEnv = Number.parseInt(env[DASHBOARD_PORT_ENV] ?? "", 10);
  const port = Number.isInteger(fromEnv) && fromEnv >= 0 && fromEnv < 65536 ? fromEnv : DASHBOARD_PORT;
  return port === 0 ? null : `http://127.0.0.1:${String(port)}`;
}

/** `<config dir>/sidebar.json` — beside the configuration, like `scopes.json`. */
export function sidebarStatusPath(configPath: string): string {
  return join(dirname(configPath), SIDEBAR_FILE_NAME);
}

/**
 * Where the store keeps the path of the status file last written for it, so a
 * removal or a fresh start finds it whatever the layout (a `dataDir` outside
 * the configuration's folder included). Host state, in `sessions/` like the
 * rest of it (`core/store/paths.ts#LAYOUT`).
 */
export function sidebarPointerPath(dataDir: string): string {
  return join(dataDir, "sessions", "sidebar-status-path");
}

/**
 * A PLUGIN LOADED FROM A FOLDER (2026-10-15). `claude --plugin-dir` beside an
 * npm install loads the sidebar, but Claude Code records nothing of it in
 * `installed_plugins.json`, and its own server stands down — so nothing said
 * the sidebar was there and the npm processes deleted its file. The stood-down
 * server is alive for exactly as long as its session, so it says so: it
 * writes this marker beside the configuration at its start and again every
 * {@link PLUGIN_PRESENCE_EVERY_MS} while it runs, and a marker newer than
 * {@link PLUGIN_PRESENCE_FRESH_MS} counts as the sidebar installed — and so
 * does an older one whose server is still running (its `pid`), within
 * {@link PLUGIN_PRESENCE_ALIVE_MS}: a laptop asleep stops the timer and not
 * the wall clock, and the first turn after waking must not delete the file.
 * Nothing removes it at exit (another session may still hold the plugin): it
 * goes stale on its own, and the file goes at the next write after that.
 *
 * The marker lands beside the configuration THIS server resolved, the default
 * one unless `COUNTERPARTS_CONFIG` says otherwise; an npm install registered
 * with a configuration elsewhere looks beside its own and does not see it (the
 * sidebar then stays empty, as before).
 */
export const PLUGIN_PRESENCE_NAME = "sidebar-plugin-here";
export const PLUGIN_PRESENCE_EVERY_MS = 10 * 60_000;
export const PLUGIN_PRESENCE_FRESH_MS = 30 * 60_000;
export const PLUGIN_PRESENCE_ALIVE_MS = 24 * 60 * 60_000;

/** `<config dir>/sidebar-plugin-here` — beside the configuration, like the status file. */
export function pluginPresencePath(configPath: string): string {
  return join(dirname(configPath), PLUGIN_PRESENCE_NAME);
}

/** The marker, written now. Only into a folder that is there (never makes one). Never throws. */
export function notePluginPresence(configPath: string, now: number = Date.now()): boolean {
  try {
    if (configPath.length === 0 || !existsSync(dirname(configPath))) return false;
    writeFileSync(pluginPresencePath(configPath), JSON.stringify({ writtenAt: now, pid: process.pid }), { encoding: "utf8", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Write the marker now and every {@link PLUGIN_PRESENCE_EVERY_MS}; the timer is unref'd. Returns its stop. */
export function keepPluginPresence(configPath: string): () => void {
  notePluginPresence(configPath);
  const t = setInterval(() => notePluginPresence(configPath), PLUGIN_PRESENCE_EVERY_MS);
  t.unref?.();
  return () => clearInterval(t);
}

/** A marker written within {@link PLUGIN_PRESENCE_FRESH_MS} of `now`. Never throws. */
export function pluginPresent(configPath: string, now: number = Date.now()): boolean {
  try {
    const v = JSON.parse(readFileSync(pluginPresencePath(configPath), "utf8")) as { writtenAt?: unknown; pid?: unknown };
    if (typeof v.writtenAt !== "number" || v.writtenAt - now >= PLUGIN_PRESENCE_FRESH_MS) return false;
    const age = now - v.writtenAt;
    if (age < PLUGIN_PRESENCE_FRESH_MS) return true;
    return age < PLUGIN_PRESENCE_ALIVE_MS && typeof v.pid === "number" && Number.isInteger(v.pid) && v.pid > 0 && alive(v.pid);
  } catch {
    return false;
  }
}

/** A process with this pid runs (signal 0 asks without sending; EPERM is somebody's, still running). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: unknown }).code === "EPERM";
  }
}

/**
 * IS THE SIDEBAR INSTALLED? The status file is written only for the plugin,
 * which carries the sidebar: this process is the plugin's (`CLAUDE_PLUGIN_ROOT`
 * set), or Claude Code's `plugins/installed_plugins.json` records a
 * `counterparts@…` install that the settings leave on, or (given the
 * configuration) a plugin loaded from a folder said it is here
 * ({@link pluginPresent}). `~/.claude.json` is never read. An npm-only install
 * gets no file.
 */
export function sidebarInstalled(
  env: Record<string, string | undefined>,
  home: string,
  configPath?: string,
  now: number = Date.now(),
): boolean {
  if ((env[PLUGIN_ROOT_ENV] ?? "").trim().length > 0) return true;
  if (configPath !== undefined && configPath.length > 0 && pluginPresent(configPath, now)) return true;
  try {
    return pluginInstall({ home, env, cwd: null })?.enabled === true;
  } catch {
    return false;
  }
}

/** The file, gone (the sidebar is not installed, or the store it showed was set aside). Never throws. */
export function removeSidebarStatus(configPath: string): boolean {
  try {
    const file = sidebarStatusPath(configPath);
    if (!existsSync(file)) return false;
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

type Row = { seq: number } & Record<string, unknown>;

export interface SidebarMemory {
  readonly title: string;
  readonly text: string;
  /** The text was cut at {@link TEXT_CAP}: the rest is on the dashboard. */
  readonly cut: boolean;
  readonly kind: string | null;
  readonly learnedOn: string | null;
  readonly journal: boolean;
}

export interface SidebarStatus {
  readonly version: number;
  /** `adapters/store-id.ts`: which store this is (an id, never the path). */
  readonly storeId: string | null;
  /** Epoch ms. */
  readonly writtenAt: number;
  /** The package version that wrote it. */
  readonly build: string | null;
  /** Where the dashboard serves when it runs ({@link dashboardUrl}); null: no address known. Added within version 1: an older reader ignores it. */
  readonly dashboard: string | null;
  readonly pulse: { readonly day: number; readonly memories: number; readonly lastSeq: number };
  /** Times each mechanism fired on the person's calendar day (`mechanismsView`). */
  readonly today: { readonly date: string; readonly counts: Readonly<Record<string, number>> } | null;
  readonly dreams: readonly unknown[];
  /** Narrated rows (`activityView`'s), newest first, each seq once. */
  readonly events: readonly Row[];
  /** Each mechanism's panel rows (`mechanismPanel`). */
  readonly panels: Readonly<Record<string, readonly Row[]>>;
  /** The memories the rows above name. */
  readonly memories: Readonly<Record<string, SidebarMemory | null>>;
}

/**
 * The detail keys the sidebar reads (`hooks/sidebar/hooks/feed.ts`: its
 * rules, `classify`, `mechFirings`, `surfacedIds`, the session seed). The rest
 * of a row's detail — a deposit's gate scores, a sleep cycle's phases — is the
 * dashboard page's, and most of a row's bytes.
 */
export const DETAIL_KEYS: ReadonlySet<string> = new Set([
  "accepted", "actor", "actorId", "applied", "cause", "challengerId", "credited", "deposited", "direction", "faded",
  "felt", "fold", "footnoteCount", "footnotes", "gist", "holds", "how", "id", "ids", "linksReached", "memoryId",
  "merge", "moodMatched", "nominate-core", "over", "replayLinks", "session", "site", "source", "surfaced", "surfacedCount", "targetId",
  "to", "turn",
]);

/** A row as the sidebar reads it: the narrated row less what only the dashboard's page draws. */
function slim(r: Row): Row {
  const out: Row = { seq: r.seq };
  for (const k of ["at", "day", "name", "text", "subject", "repeats"]) if (r[k] !== undefined) out[k] = r[k];
  if (Array.isArray(r["detail"])) {
    out["detail"] = (r["detail"] as { key?: unknown }[]).filter((d) => typeof d.key === "string" && DETAIL_KEYS.has(d.key));
  }
  return out;
}

/** Every `mem_…` id a row names, in its subject or its detail. */
const MEMORY_ID = /\bmem_[A-Za-z0-9]+\b/g;

/** The status, from an open observer source. Pure but for the reads. */
export function buildSidebarStatus(
  src: DashboardSource,
  now: number,
  build: string | null = installedVersion(),
  dashboard: string | null = dashboardUrl(),
): SidebarStatus {
  // One feeling read per batch of rows for the whole build (`feltScope`): the
  // counts, the panels and the rows below all ask which memories carry one.
  return feltScope(src.store, () => statusOf(src, now, build, dashboard));
}

function statusOf(src: DashboardSource, now: number, build: string | null, dashboard: string | null): SidebarStatus {
  const store = src.store;
  // The newest rows, narrated as the activity feed narrates them, read by name
  // and limit alone (the feed's own view also counts the whole log per call).
  // A deposit or a turn also says which of its memories carry a feeling
  // (`felt`, 2026-10-14): what lights Emotion for it in the sidebar's feed,
  // as the Emotion panel's own rows say it (`narrateForPanel`).
  const newest = (filter: { name?: string; limit: number }): Row[] => {
    const rows = store.eventLog({ ...filter, order: "desc" });
    primeFelt(store, rows);
    return rows.map((row) => {
      const line = narrate(store, row);
      if (!FELT_EVENTS.has(row.name)) return line as unknown as Row;
      const felt = feltDetail(store, payloadOf(row));
      return (felt === null ? line : { ...line, detail: [...line.detail, felt] }) as unknown as Row;
    });
  };
  const recent = newest({ limit: RECENT_ROWS });
  const p = { day: store.livedDay(), memories: memoriesHeld(src), lastSeq: recent[0]?.seq ?? 0 };
  let today: SidebarStatus["today"] = null;
  const panels: Record<string, Row[]> = {};
  try {
    const m = mechanismsView(src);
    const counts: Record<string, number> = {};
    for (const v of m.mechanisms as readonly { id: string; firedToday?: unknown }[]) {
      if (typeof v.firedToday === "number") counts[v.id] = v.firedToday;
      const activity = mechanismActivity(src, v.id) as unknown as Row[];
      if (activity.length > 0) panels[v.id] = activity.map(slim);
    }
    today = { date: m.today, counts };
  } catch {
    today = null;
  }
  const bySeq = new Map<number, Row>();
  const keep = (rows: readonly unknown[]): void => {
    for (const r of rows as readonly Row[]) if (typeof r.seq === "number" && !bySeq.has(r.seq)) bySeq.set(r.seq, slim(r));
  };
  keep(recent);
  for (const [name, limit] of Object.entries(NAMED_ROWS)) keep(newest({ name, limit }));
  const events = [...bySeq.values()].sort((a, b) => b.seq - a.seq);
  const dreams = dreamsView(src, DREAMS).dreams;

  // The memories named, newest rows first, up to the cap.
  const ids: string[] = [];
  const seen = new Set<string>();
  const collect = (v: unknown): void => {
    for (const m of JSON.stringify(v).matchAll(MEMORY_ID)) {
      if (ids.length >= MEMORY_CAP) return;
      if (!seen.has(m[0])) {
        seen.add(m[0]);
        ids.push(m[0]);
      }
    }
  };
  for (const e of events) collect(e);
  for (const rows of Object.values(panels)) collect(rows);
  collect(dreams);
  const memories: Record<string, SidebarMemory | null> = {};
  for (const id of ids) {
    try {
      const d = memoryDetail(src, id);
      if (!d.found) {
        memories[id] = null;
        continue;
      }
      const text = d.text.trim();
      memories[id] = {
        title: d.title,
        text: text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP).trimEnd()}…` : text,
        cut: text.length > TEXT_CAP,
        kind: d.journal ? null : d.kind,
        learnedOn: d.learnedOn,
        journal: d.journal,
      };
    } catch {
      memories[id] = null;
    }
  }
  return {
    version: SIDEBAR_STATUS_VERSION,
    storeId: storeId(src.store.dir),
    writtenAt: now,
    build,
    dashboard,
    pulse: { day: p.day, memories: p.memories, lastSeq: p.lastSeq },
    today,
    dreams,
    events,
    panels,
    memories,
  };
}

export interface SidebarWrite {
  readonly written: boolean;
  /** `written`, or why not: `no-config`, `same` (the file already says this seq), or the error's code. */
  readonly reason: string;
  readonly bytes: number;
  readonly ms: number;
  readonly lastSeq: number | null;
}

/** The `pulse.lastSeq` and `writtenAt` of the file as it stands, or null. */
export function readSidebarStamp(file: string): { lastSeq: number; writtenAt: number; storeId: string | null } | null {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<SidebarStatus>;
    if (v.version !== SIDEBAR_STATUS_VERSION || typeof v.pulse?.lastSeq !== "number" || typeof v.writtenAt !== "number") return null;
    return { lastSeq: v.pulse.lastSeq, writtenAt: v.writtenAt, storeId: typeof v.storeId === "string" ? v.storeId : null };
  } catch {
    return null;
  }
}

/**
 * Open the store as an observer, build the status, write it beside the
 * configuration. Never throws. `ifMoved`: skip when the file already stands at
 * the log's newest seq for this store (another session's server wrote it) —
 * unless it is older than `maxAgeMs`, so a calendar day's turn still lands. A
 * file AHEAD of that seq is a store put back (module doc) and is written over.
 */
export function writeSidebarStatus(opts: {
  readonly configPath: string;
  readonly dataDir: string;
  readonly timeZone?: string;
  readonly ifMoved?: { readonly lastSeq: number; readonly maxAgeMs: number };
  readonly now?: () => number;
  /** Tests only: called after the temp file is written, before the look at the file there. */
  readonly beforeRename?: () => void;
}): SidebarWrite {
  const clock = opts.now ?? Date.now;
  const started = clock();
  const out = (written: boolean, reason: string, bytes = 0, lastSeq: number | null = null): SidebarWrite => ({
    written,
    reason,
    bytes,
    ms: clock() - started,
    lastSeq,
  });
  if (opts.configPath.length === 0 || opts.dataDir.length === 0) return out(false, "no-config");
  const file = sidebarStatusPath(opts.configPath);
  if (!existsSync(dirname(file))) return out(false, "no-config");
  const ours = storeId(opts.dataDir);
  if (opts.ifMoved !== undefined) {
    const stamp = readSidebarStamp(file);
    // Only this store's file stands in for this store's write: two stores sharing a folder never suppress each other.
    if (stamp !== null && stamp.storeId === ours && stamp.lastSeq === opts.ifMoved.lastSeq && started - stamp.writtenAt < opts.ifMoved.maxAgeMs) {
      return out(false, "same", 0, stamp.lastSeq);
    }
  }
  let dash: Dashboard | null = null;
  // One process writes one at a time (the write is synchronous), so its pid makes the name its own; `uninstall` knows the shape.
  const tmp = `${file}.${String(process.pid)}.tmp`;
  try {
    dash = Dashboard.open({ dir: opts.dataDir, ...(opts.timeZone === undefined ? {} : { timeZone: opts.timeZone }) });
    const status = buildSidebarStatus(dash.source, clock());
    const text = JSON.stringify(status);
    // Owner-only: it holds memories' words, as the store beside it does.
    writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // a filesystem without modes: the write stands
    }
    opts.beforeRename?.();
    // Two writers racing: a file this store already wrote further on is not put back (the log only grows).
    // Unless it is further on than the log itself: a store put back (a rollback, a snapshot restored) — that file is the old store's.
    const there = readSidebarStamp(file);
    if (there !== null && there.storeId !== null && there.storeId === status.storeId && there.lastSeq > status.pulse.lastSeq) {
      const logNow = dash.source.store.eventLog({ order: "desc", limit: 1 })[0]?.seq ?? 0;
      if (there.lastSeq <= logNow) {
        rmSync(tmp, { force: true });
        return out(false, "newer", 0, there.lastSeq);
      }
    }
    renameSync(tmp, file);
    notePointer(opts.dataDir, file);
    return out(true, "written", Buffer.byteLength(text, "utf8"), status.pulse.lastSeq);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // nothing more to do
    }
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : err instanceof Error
          ? err.name
          : "UNKNOWN";
    return out(false, code);
  } finally {
    try {
      dash?.close();
    } catch {
      // closed or never opened
    }
  }
}

/**
 * The path written for this store, kept in the store's `sessions/`: rewritten
 * when it changed, and touched at every write otherwise — SessionStart's prune
 * (`sessions.ts#pruneSessions`) drops a file there a week after it last changed,
 * and a pointer kept only on change went weekly. Never throws.
 */
function notePointer(dataDir: string, file: string): void {
  try {
    const at = sidebarPointerPath(dataDir);
    if (existsSync(at) && readFileSync(at, "utf8") === file) {
      const now = new Date();
      utimesSync(at, now, now);
      return;
    }
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, file, { encoding: "utf8", mode: 0o600 });
  } catch {
    // the beside-the-store guess still covers the usual layout
  }
}

/**
 * Every status file that may show this store: the one its pointer names (the
 * last one written for it, wherever the configuration is) and the one beside
 * the store's parent (the layout `install` writes: `<config dir>/store`).
 */
export function sidebarFilesFor(storeDir: string): string[] {
  const out = [join(dirname(storeDir), SIDEBAR_FILE_NAME)];
  try {
    const named = readFileSync(sidebarPointerPath(storeDir), "utf8").trim();
    if (isAbsolute(named) && named.endsWith(`/${SIDEBAR_FILE_NAME}`) && !out.includes(named)) out.push(named);
  } catch {
    // no pointer: the usual layout only
  }
  return out;
}

/**
 * A REMOVAL'S CHASE (the console's `remove`, which calls this): the status
 * file holds a few memories' words, so a memory removed must not stay
 * readable in it until the next write. Each file that may show this store
 * (`sidebarFilesFor`) is deleted when it names the id; the next writer writes
 * it again without the memory. Never throws: the answer is a surface line for
 * the removal's report, or null when there was no file to look in.
 */
export function chaseSidebarStatus(storeDir: string, id: string): { chased: boolean; line: string } | null {
  let looked = 0;
  let deleted = 0;
  const left: string[] = [];
  for (const file of sidebarFilesFor(storeDir)) {
    try {
      if (!existsSync(file)) continue;
      looked += 1;
      if (!readFileSync(file, "utf8").includes(id)) continue;
      rmSync(file, { force: true });
      deleted += 1;
    } catch {
      left.push(file);
    }
  }
  if (left.length > 0) return { chased: false, line: `sidebar status file — ${left.join(", ")} may still name it until the next write` };
  if (looked === 0) return null;
  return {
    chased: true,
    line: deleted === 0 ? "sidebar status file (0, it did not name it)" : "sidebar status file (deleted; written again without it)",
  };
}


/**
 * The MCP server's writer: one timer at a time, never on a tool call's path
 * (each write is scheduled after the answer went out), and a cheap look at the
 * log's newest seq on an interval, so a turn's recall row, another session's
 * deposit or a night's dream reaches the file within one interval; and once
 * every {@link REFRESH_MS} whatever moved, so today's counts turn over at
 * midnight and a file older than that says no writer is running (the sidebar
 * shows its age then). Every timer is unref'd: none keeps the process alive.
 *
 * A seq LOWER than the last one written moves it too (a store put back), and
 * `wanted` is asked at each write, not once at the start: a plugin loaded from
 * a folder says it is here a moment after this server starts, and one that has
 * gone stops counting while this server still runs (the file then goes).
 */
export class SidebarStatusWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastSeq = -1;
  private lastLookAt = Date.now();
  private stopped = false;

  private readonly opts: {
    readonly configPath: string;
    readonly dataDir: string;
    readonly timeZone?: string;
    /** The log's newest seq, read cheaply on the server's own handle; null when it cannot say. */
    readonly newestSeq: () => number | null;
    /** Is the sidebar installed, asked at each write (default: yes); no removes the file instead. */
    readonly wanted?: () => boolean;
    readonly onWrite?: (w: SidebarWrite) => void;
  };

  constructor(opts: SidebarStatusWriter["opts"]) {
    this.opts = opts;
  }

  /** Write once, `delayMs` from now; a write already waiting keeps its time. */
  schedule(delayMs: number): void {
    if (this.stopped || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writeNow();
    }, delayMs);
    this.timer.unref?.();
  }

  /** Look at the log every `everyMs`; a moved one schedules a write. */
  watch(everyMs: number): void {
    if (this.stopped || this.interval !== null) return;
    this.interval = setInterval(() => {
      let seq: number | null = null;
      try {
        seq = this.opts.newestSeq();
      } catch {
        seq = null;
      }
      if ((seq !== null && seq !== this.lastSeq) || Date.now() - this.lastLookAt > REFRESH_MS) this.schedule(0);
    }, everyMs);
    this.interval.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.interval !== null) clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }

  private writeNow(): void {
    let seq: number | null = null;
    try {
      seq = this.opts.newestSeq();
    } catch {
      seq = null;
    }
    let wanted = true;
    try {
      wanted = this.opts.wanted?.() ?? true;
    } catch {
      wanted = true;
    }
    if (!wanted) {
      const removed = removeSidebarStatus(this.opts.configPath);
      this.lastLookAt = Date.now();
      if (seq !== null) this.lastSeq = seq;
      // Said only when a file went: an npm-only install would otherwise log this at every turn.
      try {
        if (removed) this.opts.onWrite?.({ written: false, reason: "removed", bytes: 0, ms: 0, lastSeq: null });
      } catch {
        // as below
      }
      return;
    }
    const w = writeSidebarStatus({
      configPath: this.opts.configPath,
      dataDir: this.opts.dataDir,
      ...(this.opts.timeZone === undefined ? {} : { timeZone: this.opts.timeZone }),
      // Another session's server may have written this very seq a moment ago.
      ...(seq === null ? {} : { ifMoved: { lastSeq: seq, maxAgeMs: 10 * 60_000 } }),
    });
    this.lastLookAt = Date.now();
    // What this server's own handle said, the value the watch compares (a log put back moves it either way);
    // the file's seq only when the handle could not say. Never a fresh open's: two handles that disagreed would rewrite every look.
    if (seq !== null) this.lastSeq = seq;
    else if (w.lastSeq !== null) this.lastSeq = w.lastSeq;
    try {
      this.opts.onWrite?.(w);
    } catch {
      // a log that will not take the line costs nothing here
    }
  }
}
