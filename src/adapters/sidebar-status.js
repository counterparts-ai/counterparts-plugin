import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { Dashboard } from "./dashboard/index.js";
import { dreamsView } from "./dashboard/web/views/dreams.js";
import { narrate } from "./dashboard/web/narrate.js";
import { mechanismActivity } from "./dashboard/web/views/mechanism-panel.js";
import { mechanismsView } from "./dashboard/web/views/mechanisms.js";
import { memoriesHeld } from "./dashboard/web/views/shared.js";
import { memoryDetail } from "./dashboard/web/views.js";
import { pluginInstall } from "./host-wiring.js";
import { PLUGIN_ROOT_ENV } from "./plugin.js";
import { installedVersion } from "./sessions.js";
import { storeId } from "./store-id.js";
export const SIDEBAR_FILE_NAME = "sidebar.json";
export const SIDEBAR_STATUS_VERSION = 1;
export const RECENT_ROWS = 100;
export const NAMED_ROWS = {
  "recall.decision": 40,
  "gate.deposit": 40,
  "contradiction.settled": 20,
  "dream.journaled": 5
};
export const DREAMS = 3;
export const MEMORY_CAP = 60;
export const TEXT_CAP = 800;
export const REFRESH_MS = 30 * 60000;
export function sidebarStatusPath(configPath) {
  return join(dirname(configPath), SIDEBAR_FILE_NAME);
}
export function sidebarPointerPath(dataDir) {
  return join(dataDir, "sessions", "sidebar-status-path");
}
export function sidebarInstalled(env, home) {
  if ((env[PLUGIN_ROOT_ENV] ?? "").trim().length > 0)
    return true;
  try {
    return pluginInstall({ home, env, cwd: null })?.enabled === true;
  } catch {
    return false;
  }
}
export function removeSidebarStatus(configPath) {
  try {
    const file = sidebarStatusPath(configPath);
    if (!existsSync(file))
      return false;
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}
export const DETAIL_KEYS = new Set([
  "accepted",
  "actor",
  "actorId",
  "applied",
  "challengerId",
  "credited",
  "deposited",
  "direction",
  "faded",
  "footnoteCount",
  "footnotes",
  "gist",
  "holds",
  "how",
  "id",
  "ids",
  "linksReached",
  "memoryId",
  "merge",
  "moodMatched",
  "over",
  "replayLinks",
  "session",
  "site",
  "source",
  "surfaced",
  "surfacedCount",
  "targetId",
  "turn"
]);
function slim(r) {
  const out = { seq: r.seq };
  for (const k of ["at", "day", "name", "text", "subject", "repeats"])
    if (r[k] !== undefined)
      out[k] = r[k];
  if (Array.isArray(r["detail"])) {
    out["detail"] = r["detail"].filter((d) => typeof d.key === "string" && DETAIL_KEYS.has(d.key));
  }
  return out;
}
const MEMORY_ID = /\bmem_[A-Za-z0-9]+\b/g;
export function buildSidebarStatus(src, now, build = installedVersion()) {
  const store = src.store;
  const newest = (filter) => store.eventLog({ ...filter, order: "desc" }).map((row) => narrate(store, row));
  const recent = newest({ limit: RECENT_ROWS });
  const p = { day: store.livedDay(), memories: memoriesHeld(src), lastSeq: recent[0]?.seq ?? 0 };
  let today = null;
  const panels = {};
  try {
    const m = mechanismsView(src);
    const counts = {};
    for (const v of m.mechanisms) {
      if (typeof v.firedToday === "number")
        counts[v.id] = v.firedToday;
      const activity = mechanismActivity(src, v.id);
      if (activity.length > 0)
        panels[v.id] = activity.map(slim);
    }
    today = { date: m.today, counts };
  } catch {
    today = null;
  }
  const bySeq = new Map;
  const keep = (rows) => {
    for (const r of rows)
      if (typeof r.seq === "number" && !bySeq.has(r.seq))
        bySeq.set(r.seq, slim(r));
  };
  keep(recent);
  for (const [name, limit] of Object.entries(NAMED_ROWS))
    keep(newest({ name, limit }));
  const events = [...bySeq.values()].sort((a, b) => b.seq - a.seq);
  const dreams = dreamsView(src, DREAMS).dreams;
  const ids = [];
  const seen = new Set;
  const collect = (v) => {
    for (const m of JSON.stringify(v).matchAll(MEMORY_ID)) {
      if (ids.length >= MEMORY_CAP)
        return;
      if (!seen.has(m[0])) {
        seen.add(m[0]);
        ids.push(m[0]);
      }
    }
  };
  for (const e of events)
    collect(e);
  for (const rows of Object.values(panels))
    collect(rows);
  collect(dreams);
  const memories = {};
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
        journal: d.journal
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
    pulse: { day: p.day, memories: p.memories, lastSeq: p.lastSeq },
    today,
    dreams,
    events,
    panels,
    memories
  };
}
export function readSidebarStamp(file) {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    if (v.version !== SIDEBAR_STATUS_VERSION || typeof v.pulse?.lastSeq !== "number" || typeof v.writtenAt !== "number")
      return null;
    return { lastSeq: v.pulse.lastSeq, writtenAt: v.writtenAt, storeId: typeof v.storeId === "string" ? v.storeId : null };
  } catch {
    return null;
  }
}
export function writeSidebarStatus(opts) {
  const clock = opts.now ?? Date.now;
  const started = clock();
  const out = (written, reason, bytes = 0, lastSeq = null) => ({
    written,
    reason,
    bytes,
    ms: clock() - started,
    lastSeq
  });
  if (opts.configPath.length === 0 || opts.dataDir.length === 0)
    return out(false, "no-config");
  const file = sidebarStatusPath(opts.configPath);
  if (!existsSync(dirname(file)))
    return out(false, "no-config");
  const ours = storeId(opts.dataDir);
  if (opts.ifMoved !== undefined) {
    const stamp = readSidebarStamp(file);
    if (stamp !== null && stamp.storeId === ours && stamp.lastSeq >= opts.ifMoved.lastSeq && started - stamp.writtenAt < opts.ifMoved.maxAgeMs) {
      return out(false, "same", 0, stamp.lastSeq);
    }
  }
  let dash = null;
  const tmp = `${file}.${String(process.pid)}.tmp`;
  try {
    dash = Dashboard.open({ dir: opts.dataDir, ...opts.timeZone === undefined ? {} : { timeZone: opts.timeZone } });
    const status = buildSidebarStatus(dash.source, clock());
    const text = JSON.stringify(status);
    writeFileSync(tmp, text, { encoding: "utf8", mode: 384 });
    try {
      chmodSync(tmp, 384);
    } catch {}
    const there = readSidebarStamp(file);
    if (there !== null && there.storeId !== null && there.storeId === status.storeId && there.lastSeq > status.pulse.lastSeq) {
      rmSync(tmp, { force: true });
      return out(false, "newer", 0, there.lastSeq);
    }
    renameSync(tmp, file);
    notePointer(opts.dataDir, file);
    return out(true, "written", Buffer.byteLength(text, "utf8"), status.pulse.lastSeq);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {}
    const code = err !== null && typeof err === "object" && typeof err.code === "string" ? err.code : err instanceof Error ? err.name : "UNKNOWN";
    return out(false, code);
  } finally {
    try {
      dash?.close();
    } catch {}
  }
}
function notePointer(dataDir, file) {
  try {
    const at = sidebarPointerPath(dataDir);
    if (existsSync(at) && readFileSync(at, "utf8") === file)
      return;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, file, { encoding: "utf8", mode: 384 });
  } catch {}
}
export function sidebarFilesFor(storeDir) {
  const out = [join(dirname(storeDir), SIDEBAR_FILE_NAME)];
  try {
    const named = readFileSync(sidebarPointerPath(storeDir), "utf8").trim();
    if (isAbsolute(named) && named.endsWith(`/${SIDEBAR_FILE_NAME}`) && !out.includes(named))
      out.push(named);
  } catch {}
  return out;
}
export function chaseSidebarStatus(storeDir, id) {
  let looked = 0;
  let deleted = 0;
  const left = [];
  for (const file of sidebarFilesFor(storeDir)) {
    try {
      if (!existsSync(file))
        continue;
      looked += 1;
      if (!readFileSync(file, "utf8").includes(id))
        continue;
      rmSync(file, { force: true });
      deleted += 1;
    } catch {
      left.push(file);
    }
  }
  if (left.length > 0)
    return { chased: false, line: `sidebar status file — ${left.join(", ")} may still name it until the next write` };
  if (looked === 0)
    return null;
  return {
    chased: true,
    line: deleted === 0 ? "sidebar status file (0, it did not name it)" : "sidebar status file (deleted; written again without it)"
  };
}

export class SidebarStatusWriter {
  timer = null;
  interval = null;
  lastSeq = -1;
  lastLookAt = Date.now();
  stopped = false;
  opts;
  constructor(opts) {
    this.opts = opts;
  }
  schedule(delayMs) {
    if (this.stopped || this.timer !== null)
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writeNow();
    }, delayMs);
    this.timer.unref?.();
  }
  watch(everyMs) {
    if (this.stopped || this.interval !== null)
      return;
    this.interval = setInterval(() => {
      let seq = null;
      try {
        seq = this.opts.newestSeq();
      } catch {
        seq = null;
      }
      if (seq !== null && seq > this.lastSeq || Date.now() - this.lastLookAt > REFRESH_MS)
        this.schedule(0);
    }, everyMs);
    this.interval.unref?.();
  }
  stop() {
    this.stopped = true;
    if (this.timer !== null)
      clearTimeout(this.timer);
    if (this.interval !== null)
      clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }
  writeNow() {
    let seq = null;
    try {
      seq = this.opts.newestSeq();
    } catch {
      seq = null;
    }
    const w = writeSidebarStatus({
      configPath: this.opts.configPath,
      dataDir: this.opts.dataDir,
      ...this.opts.timeZone === undefined ? {} : { timeZone: this.opts.timeZone },
      ...seq === null ? {} : { ifMoved: { lastSeq: seq, maxAgeMs: 10 * 60000 } }
    });
    this.lastLookAt = Date.now();
    if (w.lastSeq !== null)
      this.lastSeq = Math.max(this.lastSeq, w.lastSeq);
    else if (seq !== null)
      this.lastSeq = Math.max(this.lastSeq, seq);
    try {
      this.opts.onWrite?.(w);
    } catch {}
  }
}
