import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { wireChars } from "../core/fit/index.js";
import {
  NO_HOST_EVIDENCE,
  planRetention,
  retentionSources
} from "../core/remember/index.js";
import { isModelId } from "../core/self/index.js";
import { CACHE_SCHEMA_VERSION, SCHEMA_VERSION } from "../core/store/index.js";
import { DEFAULT_HOST, isHostName, isPseudoScope, wordingFor } from "./hosts.js";
import { packagePath } from "./runtime.js";
export const SESSIONS_DIR = "sessions";
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
export const SESSION_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;
export function hostOf(record) {
  return record.host ?? DEFAULT_HOST;
}
export const NON_INTERACTIVE_ENTRYPOINTS = new Set([
  "sdk-cli",
  "sdk-ts",
  "sdk-py",
  "mcp",
  "claude-code-github-action"
]);
export function isEntrypoint(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,48}$/.test(value);
}
export const WRITE_UP_ANSWERS = ["memories", "nothing-new"];
export function isSessionId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && value !== "." && value !== ".." && /^[A-Za-z0-9._-]+$/.test(value);
}
export function sessionsDir(dataDir) {
  return join(dataDir, SESSIONS_DIR);
}
export function sessionPath(dataDir, sessionId) {
  if (!isSessionId(sessionId))
    return null;
  return join(sessionsDir(dataDir), `${sessionId}.json`);
}
export function canonicalScope(scope) {
  if (isPseudoScope(scope))
    return scope;
  try {
    return realpathSync(resolve(scope));
  } catch {
    return resolve(scope);
  }
}
export function sameScope(a, b) {
  return canonicalScope(a) === canonicalScope(b);
}
export function isLive(record, now, ttlMs = SESSION_TTL_MS) {
  if (record.endedAt !== null)
    return false;
  return now - record.lastBoundaryAt <= ttlMs;
}
export function readSession(dataDir, sessionId) {
  const path = sessionPath(dataDir, sessionId);
  if (path === null)
    return null;
  try {
    return parseRecord(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}
export function recordSession(dataDir, input) {
  if (!isSessionId(input.sessionId))
    return null;
  const path = sessionPath(dataDir, input.sessionId);
  if (path === null)
    return null;
  const now = input.at ?? Date.now();
  const prior = readSession(dataDir, input.sessionId);
  const record = {
    sessionId: input.sessionId,
    scope: prior === null || input.phase === "start" ? canonicalScope(input.scope) : prior.scope,
    startedAt: prior?.startedAt ?? now,
    lastBoundaryAt: now,
    endedAt: input.phase === "end" ? now : input.phase === "start" ? null : prior?.endedAt ?? null,
    ...input.config !== undefined && input.config.length > 0 ? { config: input.config } : prior?.config !== undefined ? { config: prior.config } : {},
    ...input.askedScope === true || prior?.askedScope === true ? { askedScope: true } : {},
    ...input.wakeSentinel !== undefined && input.wakeSentinel.length > 0 ? { wakeSentinel: input.wakeSentinel } : prior?.wakeSentinel !== undefined ? { wakeSentinel: prior.wakeSentinel } : {},
    ...input.wakeChecked === true || prior?.wakeChecked === true ? { wakeChecked: true } : {},
    ...input.updateNoticeShown === true || prior?.updateNoticeShown === true ? { updateNoticeShown: true } : {},
    ...prior?.opened !== undefined ? { opened: prior.opened } : prior === null ? { opened: { build: installedBuild(), hookPpid: process.ppid, at: now } } : {},
    ...input.pageWriterFor !== undefined && input.pageWriterFor.length > 0 ? { pageWriterFor: input.pageWriterFor } : prior?.pageWriterFor !== undefined ? { pageWriterFor: prior.pageWriterFor } : {},
    ...input.nothingNewAt !== undefined && Number.isFinite(input.nothingNewAt) ? { nothingNewAt: input.nothingNewAt } : prior?.nothingNewAt !== undefined ? { nothingNewAt: prior.nothingNewAt } : {},
    ...input.writeUpPointer !== undefined && isSessionId(input.writeUpPointer) ? { writeUpPointer: input.writeUpPointer } : prior?.writeUpPointer !== undefined ? { writeUpPointer: prior.writeUpPointer } : {},
    ...prior?.writeUpFor !== undefined ? { writeUpFor: prior.writeUpFor } : {},
    ...isModelId(input.model) ? { model: input.model } : prior?.model !== undefined ? { model: prior.model } : {},
    ...isEntrypoint(input.entrypoint) ? { entrypoint: input.entrypoint } : prior?.entrypoint !== undefined ? { entrypoint: prior.entrypoint } : {},
    ...isHostName(input.host) ? { host: input.host } : prior?.host !== undefined ? { host: prior.host } : {},
    ...(() => {
      const granted = parseMayWriteUp(input.mayWriteUp);
      if (granted !== null)
        return { mayWriteUp: granted };
      return prior?.mayWriteUp !== undefined ? { mayWriteUp: prior.mayWriteUp } : {};
    })(),
    ...(() => {
      const desk = parseDesk(input.desk);
      if (desk !== null)
        return { desk };
      return prior?.desk !== undefined ? { desk: prior.desk } : {};
    })(),
    ...(() => {
      const seen = parseSinceSeen(input.sinceSeen);
      if (seen !== null)
        return { sinceSeen: seen };
      return prior?.sinceSeen !== undefined ? { sinceSeen: prior.sinceSeen } : {};
    })()
  };
  return writeRecord(dataDir, path, record);
}
function parseMayWriteUp(raw) {
  if (!Array.isArray(raw) || raw.length > 64)
    return null;
  if (!raw.every((id) => isSessionId(id)))
    return null;
  return [...new Set(raw)];
}
function parseDesk(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const d = raw;
  const calls = d["calls"];
  const since = d["since"];
  if (typeof calls !== "number" || !Number.isSafeInteger(calls) || calls < 0)
    return null;
  if (typeof since !== "number" || !Number.isFinite(since) || since < 0)
    return null;
  return { calls, since };
}
function parseSinceSeen(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const d = raw;
  const at = d["at"];
  const state = d["state"];
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0)
    return null;
  if (state !== "woke" && state !== "armed" && state !== "shown")
    return null;
  return { at, state };
}
export function markSinceSeen(dataDir, sessionId, seen) {
  if (parseSinceSeen(seen) === null)
    return false;
  return mergeIntoRecord(dataDir, sessionId, { sinceSeen: { at: seen.at, state: seen.state } });
}
export function grantWriteUps(dataDir, input) {
  const granted = parseMayWriteUp(input.subjects);
  if (granted === null || !isSessionId(input.runner))
    return false;
  try {
    if (readSession(dataDir, input.runner) !== null) {
      return mergeIntoRecord(dataDir, input.runner, { mayWriteUp: granted });
    }
    return recordSession(dataDir, {
      sessionId: input.runner,
      scope: input.scope,
      phase: "start",
      ...input.at === undefined ? {} : { at: input.at },
      mayWriteUp: granted
    }) !== null;
  } catch {
    return false;
  }
}
export function listSessions(dataDir) {
  const out = [];
  let names;
  try {
    names = readdirSync(sessionsDir(dataDir));
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".json") || serverPidOf(name) !== null)
      continue;
    const id = name.slice(0, -".json".length);
    const record = readSession(dataDir, id);
    if (record !== null && record.sessionId === id)
      out.push(record);
  }
  return out.sort((a, b) => b.lastBoundaryAt - a.lastBoundaryAt);
}
export function hostsSeen(dataDir) {
  try {
    return new Set(listSessions(dataDir).map(hostOf));
  } catch {
    return new Set;
  }
}
export function latestLiveSession(dataDir, host, now, ttlMs = SESSION_TTL_MS) {
  return listSessions(dataDir).find((r) => hostOf(r) === host && isLive(r, now, ttlMs)) ?? null;
}
export const HOST_MATCH_SLACK_MS = 2 * 60000;
export function sessionOfHost(dataDir, input) {
  try {
    if (!Number.isSafeInteger(input.hostPid) || input.hostPid <= 1)
      return null;
    const matches = listSessions(dataDir).filter((r) => r.opened?.hookPpid === input.hostPid && r.opened.at !== undefined && r.opened.at >= input.launchedAt - HOST_MATCH_SLACK_MS && hostOf(r) === DEFAULT_HOST && isLive(r, input.now, input.ttlMs ?? SESSION_TTL_MS) && sameScope(r.scope, input.scope));
    return matches.length === 1 ? matches[0]?.sessionId ?? null : null;
  } catch {
    return null;
  }
}
export const DESKTOP_WAKE_KEY = "adapter.desktop.wake.at";
export function touchDesktopSession(dataDir, sessionId, input) {
  const prior = readSession(dataDir, sessionId);
  if (prior === null)
    return null;
  const pace = prior.desk ?? { calls: 0, since: prior.startedAt };
  if (input.named === false)
    return { ask: false, desk: pace };
  let desk;
  let ask = false;
  if (input.wroteUp) {
    desk = { calls: 0, since: input.now };
  } else {
    const calls = pace.calls + 1;
    ask = input.mayAsk !== false && calls >= input.askCalls && input.now - pace.since >= input.askAfterMs;
    desk = ask ? { calls: 0, since: input.now } : { calls, since: pace.since };
  }
  const written = recordSession(dataDir, {
    sessionId,
    scope: prior.scope,
    phase: "boundary",
    at: input.now,
    desk
  });
  return written === null ? null : { ask, desk };
}
function writeRecord(dataDir, path, record) {
  try {
    mkdirSync(sessionsDir(dataDir), { recursive: true });
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record)}
`, { encoding: "utf8", mode: 384 });
    renameSync(tmp, path);
  } catch {
    return null;
  }
  return record;
}
export function markNothingNew(dataDir, sessionId, at = Date.now()) {
  if (sessionPath(dataDir, sessionId) === null || !Number.isFinite(at))
    return null;
  return mergeIntoRecord(dataDir, sessionId, { nothingNewAt: at }) ? readSession(dataDir, sessionId) : null;
}
export function pruneSessions(dataDir, now = Date.now(), maxAgeMs = SESSION_PRUNE_MS) {
  let removed = 0;
  try {
    for (const name of readdirSync(sessionsDir(dataDir))) {
      const full = join(sessionsDir(dataDir), name);
      try {
        const st = statSync(full);
        if (st.isDirectory())
          continue;
        const serverPid = serverPidOf(name);
        if (serverPid !== null) {
          if (serverBelieved(serverPid, st.mtimeMs, now))
            continue;
          rmSync(full, { force: true });
          removed += 1;
          continue;
        }
        if (now - st.mtimeMs <= maxAgeMs)
          continue;
        rmSync(full, { force: true });
        removed += 1;
      } catch {
        continue;
      }
    }
  } catch {
    return removed;
  }
  return removed;
}
let manifestVersion;
export function installedVersion() {
  if (manifestVersion !== undefined)
    return manifestVersion;
  manifestVersion = manifestVersionOnDisk();
  return manifestVersion;
}
export function manifestVersionOnDisk() {
  try {
    const raw = readFileSync(packagePath("package.json"), "utf8");
    const said = JSON.parse(raw)["version"];
    return typeof said === "string" && said.length > 0 ? said : null;
  } catch {
    return null;
  }
}
export function installedBuild() {
  return {
    version: installedVersion(),
    storeSchema: SCHEMA_VERSION,
    cacheSchema: CACHE_SCHEMA_VERSION
  };
}
export function sameBuild(a, b) {
  const versionMoved = a.version !== null && b.version !== null && a.version !== b.version;
  return !versionMoved && a.storeSchema === b.storeSchema && a.cacheSchema === b.cacheSchema;
}
export const RECONNECT_REMEDY = wordingFor(DEFAULT_HOST).reconnect;
export const UPDATE_NOTICE = `Counterparts was updated. ${RECONNECT_REMEDY}`;
export const CHANGED_NOTICE = `Counterparts was changed to an older version. ${RECONNECT_REMEDY}`;
export function versionNewer(a, b) {
  if (a === null || b === null)
    return false;
  const pa = /^(\d+)\.(\d+)\.(\d+)$/.exec(a);
  const pb = /^(\d+)\.(\d+)\.(\d+)$/.exec(b);
  if (pa === null || pb === null)
    return false;
  for (let i = 1;i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0)
      return d > 0;
  }
  return false;
}
export function serverIsNewer(server, installed) {
  return server.storeSchema > installed.storeSchema || server.cacheSchema > installed.cacheSchema || versionNewer(server.version, installed.version);
}
function parseBuild(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const b = raw;
  const version = b["version"] ?? null;
  const storeSchema = b["storeSchema"];
  const cacheSchema = b["cacheSchema"];
  if (version !== null && typeof version !== "string")
    return null;
  if (typeof storeSchema !== "number" || !Number.isInteger(storeSchema))
    return null;
  if (typeof cacheSchema !== "number" || !Number.isInteger(cacheSchema))
    return null;
  return { version, storeSchema, cacheSchema };
}
function parseOpened(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const o = raw;
  const build = parseBuild(o["build"]);
  const hookPpid = o["hookPpid"];
  if (build === null || typeof hookPpid !== "number" || !Number.isSafeInteger(hookPpid))
    return null;
  const at = o["at"];
  return { build, hookPpid, ...typeof at === "number" && Number.isFinite(at) ? { at } : {} };
}
function mergeIntoRecord(dataDir, sessionId, fields, drop = []) {
  const path = sessionPath(dataDir, sessionId);
  if (path === null)
    return false;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (parseRecord(raw) === null)
      return false;
    const merged = { ...raw, ...fields };
    for (const key of drop)
      delete merged[key];
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(merged)}
`, { encoding: "utf8", mode: 384 });
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}
export function stampSessionOpened(dataDir, sessionId, opened) {
  return mergeIntoRecord(dataDir, sessionId, { opened }, ["updateNoticeShown"]);
}
export const SERVER_HEARTBEAT_MS = 60000;
export const SERVER_STALE_MS = 10 * SERVER_HEARTBEAT_MS;
export function serverBelieved(pid, refreshedAt, now, alive = pidAlive) {
  return now - refreshedAt <= SERVER_STALE_MS && alive(pid);
}
const SERVER_RECORD_PREFIX = "mcp-server@";
export function serverRecordPath(dataDir, pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    return null;
  return join(sessionsDir(dataDir), `${SERVER_RECORD_PREFIX}${String(pid)}.json`);
}
function serverPidOf(name) {
  if (!name.startsWith(SERVER_RECORD_PREFIX) || !name.endsWith(".json"))
    return null;
  const digits = name.slice(SERVER_RECORD_PREFIX.length, -".json".length);
  if (!/^[1-9][0-9]*$/.test(digits))
    return null;
  const pid = Number(digits);
  return Number.isSafeInteger(pid) ? pid : null;
}
export function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}
function writeServerRecord(path, record) {
  try {
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record)}
`, { encoding: "utf8", mode: 384 });
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}
export function recordServerLaunch(dataDir, input) {
  const pid = input.pid ?? process.pid;
  const path = serverRecordPath(dataDir, pid);
  if (path === null)
    return null;
  const record = {
    pid,
    hostPid: input.hostPid ?? process.ppid,
    scope: canonicalScope(input.scope),
    startedAt: input.at ?? Date.now(),
    build: input.build
  };
  try {
    mkdirSync(sessionsDir(dataDir), { recursive: true });
  } catch {
    return null;
  }
  return writeServerRecord(path, record) ? record : null;
}
export function refreshServerLaunch(dataDir, record, now = Date.now()) {
  const path = serverRecordPath(dataDir, record.pid);
  if (path === null)
    return false;
  try {
    const at = new Date(now);
    utimesSync(path, at, at);
    return true;
  } catch {
    try {
      if (!statSync(sessionsDir(dataDir)).isDirectory())
        return false;
    } catch {
      return false;
    }
    return writeServerRecord(path, record);
  }
}
export function forgetServerLaunch(dataDir, pid = process.pid) {
  const path = serverRecordPath(dataDir, pid);
  if (path === null)
    return;
  try {
    rmSync(path, { force: true });
  } catch {}
}
export function readServerRecords(dataDir) {
  const out = [];
  let names;
  try {
    names = readdirSync(sessionsDir(dataDir));
  } catch {
    return out;
  }
  for (const name of names) {
    const pid = serverPidOf(name);
    if (pid === null)
      continue;
    try {
      const full = join(sessionsDir(dataDir), name);
      const rec = parseServerRecord(JSON.parse(readFileSync(full, "utf8")));
      if (rec !== null && rec.pid === pid)
        out.push({ ...rec, refreshedAt: statSync(full).mtimeMs });
    } catch {
      continue;
    }
  }
  return out;
}
function parseServerRecord(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const rec = raw;
  const pid = rec["pid"];
  const hostPid = rec["hostPid"];
  const scope = rec["scope"];
  const startedAt = rec["startedAt"];
  const build = parseBuild(rec["build"]);
  if (typeof pid !== "number" || !Number.isSafeInteger(pid))
    return null;
  if (typeof hostPid !== "number" || !Number.isSafeInteger(hostPid))
    return null;
  if (typeof scope !== "string" || scope.length === 0)
    return null;
  if (typeof startedAt !== "number")
    return null;
  if (build === null)
    return null;
  return { pid, hostPid, scope, startedAt, build };
}
export function decideUpdateNotice(dataDir, input) {
  const hookPpid = input.hostPid ?? process.ppid;
  const quiet = (reason, matchedBy = null, servers = 0) => ({ message: null, reason, matchedBy, servers, hookPpid });
  const due = (compared, matchedBy) => ({
    message: compared.some((s) => serverIsNewer(s.build, input.installed)) ? CHANGED_NOTICE : UPDATE_NOTICE,
    reason: "due",
    matchedBy,
    servers: compared.length,
    hookPpid
  });
  try {
    const record = readSession(dataDir, input.sessionId);
    if (record === null)
      return quiet("no-record");
    if (record.updateNoticeShown === true)
      return quiet("already-shown");
    const now = input.now ?? Date.now();
    const alive = input.alive ?? pidAlive;
    const live = readServerRecords(dataDir).filter((s) => sameScope(s.scope, record.scope) && serverBelieved(s.pid, s.refreshedAt, now, alive));
    const own = live.filter((s) => s.hostPid === hookPpid);
    if (own.length > 0) {
      return own.every((s) => sameBuild(s.build, input.installed)) ? quiet("current", "host", own.length) : due(own, "host");
    }
    if (record.opened === undefined)
      return due([], "unstamped");
    if (live.length === 0)
      return quiet("no-server");
    return live.every((s) => sameBuild(s.build, input.installed)) ? quiet("current", "scope", live.length) : due(live, "scope");
  } catch {
    return quiet("failed");
  }
}
export function markUpdateNoticeShown(dataDir, sessionId) {
  try {
    const record = readSession(dataDir, sessionId);
    if (record === null)
      return false;
    if (record.updateNoticeShown === true)
      return true;
    return mergeIntoRecord(dataDir, sessionId, { updateNoticeShown: true });
  } catch {
    return false;
  }
}
function parseRecord(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const rec = raw;
  const sessionId = rec["sessionId"];
  const scope = rec["scope"];
  const startedAt = rec["startedAt"];
  const lastBoundaryAt = rec["lastBoundaryAt"];
  const endedAt = rec["endedAt"] ?? null;
  if (!isSessionId(sessionId))
    return null;
  if (typeof scope !== "string" || scope.length === 0)
    return null;
  if (typeof startedAt !== "number" || typeof lastBoundaryAt !== "number")
    return null;
  if (endedAt !== null && typeof endedAt !== "number")
    return null;
  const config = rec["config"];
  return {
    sessionId,
    scope,
    startedAt,
    lastBoundaryAt,
    endedAt,
    ...typeof config === "string" && config.length > 0 ? { config } : {},
    ...rec["askedScope"] === true ? { askedScope: true } : {},
    ...typeof rec["wakeSentinel"] === "string" && rec["wakeSentinel"].length > 0 ? { wakeSentinel: rec["wakeSentinel"] } : {},
    ...rec["wakeChecked"] === true ? { wakeChecked: true } : {},
    ...rec["updateNoticeShown"] === true ? { updateNoticeShown: true } : {},
    ...(() => {
      const opened = parseOpened(rec["opened"]);
      return opened === null ? {} : { opened };
    })(),
    ...typeof rec["pageWriterFor"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec["pageWriterFor"]) ? { pageWriterFor: rec["pageWriterFor"] } : {},
    ...typeof rec["nothingNewAt"] === "number" && Number.isFinite(rec["nothingNewAt"]) ? { nothingNewAt: rec["nothingNewAt"] } : {},
    ...isSessionId(rec["writeUpPointer"]) ? { writeUpPointer: rec["writeUpPointer"] } : {},
    ...(() => {
      const writeUpFor = parseWriteUpFor(rec["writeUpFor"]);
      return writeUpFor === null ? {} : { writeUpFor };
    })(),
    ...isModelId(rec["model"]) ? { model: rec["model"] } : {},
    ...isEntrypoint(rec["entrypoint"]) ? { entrypoint: rec["entrypoint"] } : {},
    ...isHostName(rec["host"]) ? { host: rec["host"] } : {},
    ...(() => {
      const granted = parseMayWriteUp(rec["mayWriteUp"]);
      return granted === null ? {} : { mayWriteUp: granted };
    })(),
    ...(() => {
      const desk = parseDesk(rec["desk"]);
      return desk === null ? {} : { desk };
    })(),
    ...(() => {
      const seen = parseSinceSeen(rec["sinceSeen"]);
      return seen === null ? {} : { sinceSeen: seen };
    })()
  };
}
function parseWriteUpFor(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const w = raw;
  const session = w["session"];
  const part = w["part"];
  if (!isSessionId(session))
    return null;
  if (typeof part !== "number" || !Number.isSafeInteger(part) || part < 1)
    return null;
  const answer = w["answer"];
  return WRITE_UP_ANSWERS.includes(answer) ? { session, part, answer } : { session, part };
}
export function markWriteUpFetched(dataDir, sessionId, writeUpFor) {
  if (parseWriteUpFor(writeUpFor) === null)
    return false;
  return mergeIntoRecord(dataDir, sessionId, {
    writeUpFor: {
      session: writeUpFor.session,
      part: writeUpFor.part,
      ...writeUpFor.answer === undefined ? {} : { answer: writeUpFor.answer }
    }
  });
}
export const ASK_ROW_COUNTING = "typed";
export function hostSessionEvidence(store) {
  const dir = store.dir;
  return (session) => registryFacts(dir, session);
}
function registryFacts(dir, session) {
  const path = sessionPath(dir, session);
  if (path === null || !existsSync(path))
    return NO_HOST_EVIDENCE;
  const rec = readSession(dir, session);
  if (rec === null)
    return { open: true, endedAt: null };
  return { open: rec.endedAt === null, endedAt: rec.endedAt };
}
export function writeUpSources(store, clocks = {}) {
  return retentionSources(store, { host: hostSessionEvidence(store), ...clocks });
}
export function writeUpPlan(input) {
  return planRetention(input.spans, writeUpSources(input.store));
}
function atWork(h) {
  return h.facts.state === "active";
}
function smallWriteUpDue(h, dataDir) {
  return h.small && pointable(h, dataDir);
}
export function pointable(h, dataDir) {
  if (!h.small)
    return true;
  const path = sessionPath(dataDir, h.session);
  if (path === null || !existsSync(path))
    return false;
  const entrypoint = readSession(dataDir, h.session)?.entrypoint;
  return entrypoint === undefined || !NON_INTERACTIVE_ENTRYPOINTS.has(entrypoint);
}
export function waitingForWriteUp(h) {
  return h.owes && !h.small;
}
export function writeUpStanding(plan, dataDir, session, scope, _now, opts = {}) {
  if (!isSessionId(session))
    return { status: "unknown-session" };
  const held = plan.find((h) => h.session === session);
  const path = sessionPath(dataDir, session);
  const exists = path !== null && existsSync(path);
  if (!exists && held === undefined)
    return { status: "unknown-session" };
  if (held === undefined) {
    const record = readSession(dataDir, session);
    return record !== null && sameScope(record.scope, scope) ? { status: "owes-nothing", why: "no-text" } : { status: "other-project" };
  }
  if (atWork(held))
    return { status: "live-session" };
  const here = held.scopes.find((x) => sameScope(x, scope));
  if (here === undefined)
    return { status: "other-project" };
  if (held.facts.writtenUp)
    return { status: "already-written-up" };
  if (opts.progress?.[progressKey(session, here)]?.waiting === true)
    return { status: "already-written-up" };
  if (!held.owes) {
    const why = !held.facts.capturedText ? "no-text" : held.facts.lapsed ? "lapsed" : held.facts.unwritten === 0 ? "answered" : "below-threshold";
    return { status: "owes-nothing", why };
  }
  return { status: "owed", held, here, short: held.small };
}
export function awaitingWriteUp(plan) {
  return plan.filter((h) => waitingForWriteUp(h));
}
export function owedWriteUps(plan, dataDir, scope, now, opts = {}) {
  const out = [];
  const pointedToday = (session) => Object.entries(opts.progress ?? {}).some(([key, p]) => key.startsWith(`${session}|`) && p.handedAt > 0 && opts.pointedToday?.(p.handedAt) === true);
  const fullFirst = plan.some((h) => h.session !== opts.exclude && waitingForWriteUp(h) && !pointedToday(h.session) && claimedByOther(opts.progress ?? {}, h.session, opts.exclude, now) === null);
  for (const h of plan) {
    if (h.session === opts.exclude)
      continue;
    if (claimedByOther(opts.progress ?? {}, h.session, opts.exclude, now) !== null)
      continue;
    const eligible = waitingForWriteUp(h) || !fullFirst && smallWriteUpDue(h, dataDir);
    if (!eligible)
      continue;
    const standing = writeUpStanding(plan, dataDir, h.session, scope, now, {
      ...opts.progress === undefined ? {} : { progress: opts.progress }
    });
    if (standing.status === "owed")
      out.push({ held: h, here: standing.here, short: standing.short });
  }
  const handed = (o) => opts.progress?.[progressKey(o.held.session, o.here)]?.handedAt ?? 0;
  const tier = (o) => o.short ? 1 : handed(o) > 0 && opts.pointedToday?.(handed(o)) === true ? 2 : 0;
  return out.sort((a, b) => tier(a) !== tier(b) ? tier(a) - tier(b) : handed(a) !== handed(b) ? handed(a) - handed(b) : a.held.clockFrom !== b.held.clockFrom ? a.held.clockFrom - b.held.clockFrom : a.held.session < b.held.session ? -1 : a.held.session > b.held.session ? 1 : 0);
}
export const WRITE_UP_PART_BYTES = 24 * 1024;
export const WRITE_UP_KEPT_MARK = "[already written up]";
export const WRITE_UP_JOT_MARK = "[a note it jotted]";
export const WRITE_UP_REPLY_MARK = "[its reply]";
export const WRITE_UP_REPLY_CUT = " [… the rest of this reply is not shown]";
export const WRITE_UP_REPLY_BYTES = 1536;
const WRITE_UP_SEPARATOR = `

---

`;
function cutReply(text) {
  if (Buffer.byteLength(text, "utf8") <= WRITE_UP_REPLY_BYTES)
    return text;
  const room = WRITE_UP_REPLY_BYTES - Buffer.byteLength(WRITE_UP_REPLY_CUT, "utf8");
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > room)
      break;
    out += ch;
    bytes += b;
  }
  return out + WRITE_UP_REPLY_CUT;
}
export function writeUpEntries(spans, held, opts = {}) {
  const seen = new Set;
  const found = [];
  const before = opts.coveredBefore;
  for (const scope of held.scopes) {
    const covered = before === undefined ? spans.coveredHashes(scope) : new Set(spans.coverage(scope).filter((m) => m.at < before).map((m) => m.spanHash));
    const said = [
      ...spans.spans(scope),
      ...spans.quarantined(scope).filter((x) => x.kind !== "assistant"),
      ...spans.claimedSpans(scope),
      ...spans.assistantSpans(scope)
    ];
    for (const span of said) {
      if (span.session !== held.session || typeof span.text !== "string" || span.text.trim().length === 0)
        continue;
      if (seen.has(span.hash))
        continue;
      seen.add(span.hash);
      found.push({ span, kept: span.kind !== "assistant" && covered.has(span.hash) });
    }
  }
  found.sort((a, b) => a.span.at !== b.span.at ? a.span.at - b.span.at : a.span.from - b.span.from);
  const out = [];
  let lastKept = false;
  for (const { span, kept } of found) {
    const at = typeof span.at === "number" && Number.isFinite(span.at) ? span.at : 0;
    if (span.kind === "assistant") {
      if (lastKept)
        continue;
      out.push({ text: cutReply(span.text), kept: false, jot: false, reply: true, at });
      continue;
    }
    lastKept = kept;
    out.push({ text: span.text, kept, jot: span.kind === "jot", at });
  }
  return out;
}
export function writeUpParts(entries, chunkBytes) {
  return writeUpPartsDated(entries, chunkBytes).map((p) => p.text);
}
function partCost(text) {
  return Math.max(Buffer.byteLength(text, "utf8"), wireChars(JSON.stringify(text)) - 2);
}
export function writeUpPartsDated(entries, chunkBytes) {
  const size = Math.max(1, Math.floor(chunkBytes));
  const sep = partCost(WRITE_UP_SEPARATOR);
  const parts = [];
  let cur = "";
  let curBytes = 0;
  let curAt = 0;
  let curUnwritten = 0;
  const flush = () => {
    if (cur.length > 0)
      parts.push({ text: cur, lastAt: curAt, unwritten: curUnwritten });
    cur = "";
    curBytes = 0;
    curAt = 0;
    curUnwritten = 0;
  };
  for (const entry of entries) {
    const rendered = (entry.kept ? `${WRITE_UP_KEPT_MARK}
` : "") + (entry.jot ? `${WRITE_UP_JOT_MARK} ` : "") + (entry.reply === true ? `${WRITE_UP_REPLY_MARK} ` : "") + entry.text;
    const bytes = partCost(rendered);
    if (cur.length > 0 && curBytes + sep + bytes <= size) {
      cur += WRITE_UP_SEPARATOR + rendered;
      curBytes += sep + bytes;
      curAt = Math.max(curAt, entry.at);
      if (!entry.kept)
        curUnwritten += bytes;
      continue;
    }
    flush();
    if (bytes <= size) {
      cur = rendered;
      curBytes = bytes;
      curAt = entry.at;
      curUnwritten = entry.kept ? 0 : bytes;
      continue;
    }
    let slice = "";
    let sliceBytes = 0;
    for (const ch of rendered) {
      const b = partCost(ch);
      if (sliceBytes + b > size && slice.length > 0) {
        parts.push({ text: slice, lastAt: entry.at, unwritten: entry.kept ? 0 : sliceBytes });
        slice = "";
        sliceBytes = 0;
      }
      slice += ch;
      sliceBytes += b;
    }
    cur = slice;
    curBytes = sliceBytes;
    curAt = entry.at;
    curUnwritten = entry.kept ? 0 : sliceBytes;
  }
  flush();
  return parts;
}
export function firstUnwrittenPart(parts, from) {
  let part = Math.max(1, from);
  while (part < parts.length && (parts[part - 1]?.unwritten ?? 1) === 0)
    part += 1;
  return part;
}
export const WRITE_UP_PROGRESS_KEY = "adapter.writeup.progress";
export const WRITE_UP_CLAIM_MS = 2 * 60 * 60 * 1000;
export const NIGHT_RUNNER_PREFIX = "writeup-";
export function liveClaim(p, now) {
  const c = p?.claim;
  if (c === undefined)
    return null;
  return now - c.at < WRITE_UP_CLAIM_MS ? c : null;
}
export function claimedByOther(progress, session, by, now) {
  for (const [key, p] of Object.entries(progress)) {
    if (!key.startsWith(`${session}|`))
      continue;
    const c = liveClaim(p, now);
    if (c !== null && c.by !== by)
      return c;
  }
  return null;
}
export function progressKey(session, scope) {
  return `${session}|${scope}`;
}
export function readWriteUpProgress(store) {
  try {
    return parseWriteUpProgress(store.getMeta(WRITE_UP_PROGRESS_KEY));
  } catch {
    return {};
  }
}
function parseWriteUpProgress(text) {
  let raw;
  try {
    raw = JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const bar = key.indexOf("|");
    if (bar <= 0 || !isSessionId(key.slice(0, bar)) || value === null || typeof value !== "object")
      continue;
    const v = value;
    const chunk = v["chunk"];
    const parts = v["parts"];
    const done = v["done"];
    const handedAt = v["handedAt"];
    const answer = v["answer"];
    if (typeof chunk === "number" && Number.isSafeInteger(chunk) && chunk > 0 && typeof parts === "number" && Number.isSafeInteger(parts) && parts > 0 && typeof done === "number" && Number.isSafeInteger(done) && done >= 0) {
      out[key] = {
        chunk,
        parts,
        done,
        handedAt: typeof handedAt === "number" && Number.isFinite(handedAt) ? handedAt : 0,
        ...WRITE_UP_ANSWERS.includes(answer) ? { answer } : {},
        ...v["waiting"] === true ? { waiting: true } : {},
        ...(() => {
          const c = v["claim"];
          if (c === null || typeof c !== "object" || Array.isArray(c))
            return {};
          const r = c;
          if (!isSessionId(r["by"]) || typeof r["at"] !== "number" || !Number.isFinite(r["at"]))
            return {};
          const upTo = r["upTo"];
          return {
            claim: {
              by: r["by"],
              at: r["at"],
              ...typeof upTo === "number" && Number.isSafeInteger(upTo) && upTo > 0 ? { upTo } : {}
            }
          };
        })()
      };
    }
  }
  return out;
}
export function pruneWriteUpProgress(store, plan) {
  const owing = new Set(plan.filter((h) => h.owes).map((h) => h.session));
  let dropped = 0;
  updateWriteUpProgress(store, (all) => {
    dropped = 0;
    for (const key of Object.keys(all)) {
      if (owing.has(key.slice(0, key.indexOf("|"))))
        continue;
      delete all[key];
      dropped += 1;
    }
    return dropped > 0;
  });
  return dropped;
}
export function updateWriteUpProgress(store, fn) {
  try {
    store.updateMeta(WRITE_UP_PROGRESS_KEY, (current) => {
      const all = parseWriteUpProgress(current);
      return fn(all) ? JSON.stringify(all) : undefined;
    });
    return true;
  } catch {
    return false;
  }
}
export function claimWriteUpProgress(store, key, progress, now) {
  const session = key.slice(0, key.indexOf("|"));
  let held = false;
  const ok = updateWriteUpProgress(store, (all) => {
    held = claimedByOther(all, session, progress.claim.by, now) !== null;
    if (held)
      return false;
    all[key] = { ...progress };
    return true;
  });
  return !ok ? "failed" : held ? "claimed" : "saved";
}
export function saveWriteUpProgress(store, key, progress, opts = {}) {
  return updateWriteUpProgress(store, (all) => {
    if (opts.allOf !== undefined) {
      for (const k of Object.keys(all))
        if (k.startsWith(`${opts.allOf}|`))
          delete all[k];
    }
    if (progress === null)
      delete all[key];
    else
      all[key] = { ...progress };
    return true;
  });
}
export const WRITE_UP_POINTER_KEY = "adapter.writeup.pointer";
export function readWriteUpPointer(store) {
  try {
    const v = JSON.parse(store.getMeta(WRITE_UP_POINTER_KEY) ?? "null");
    if (v === null || typeof v !== "object")
      return null;
    const outcome = v["outcome"];
    if (outcome !== "pointed" && outcome !== "deferred")
      return null;
    const num = (k) => typeof v[k] === "number" && Number.isFinite(v[k]) ? v[k] : 0;
    return {
      at: num("at"),
      date: typeof v["date"] === "string" ? v["date"] : "",
      outcome,
      ...typeof v["reason"] === "string" ? { reason: v["reason"] } : {},
      need: num("need"),
      room: num("room"),
      ...typeof v["limit"] === "number" && Number.isFinite(v["limit"]) ? { limit: v["limit"] } : {},
      ...typeof v["beside"] === "string" && v["beside"].length > 0 ? { beside: v["beside"] } : {}
    };
  } catch {
    return null;
  }
}
export function saveWriteUpPointer(store, record) {
  try {
    store.setMeta(WRITE_UP_POINTER_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
