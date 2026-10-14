import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isLocked } from "../../core/store/db.js";
import { assertSafeDataDir, isStoreError } from "../../core/store/index.js";
import { SESSIONS_DIR, isSessionId } from "../sessions.js";
export const STANDDOWN_TAIL = "Run: counterparts doctor";
export const STANDDOWN_REASON_MAX_CHARS = 200;
export const CONFIG_REFUSED = "CONFIG_REFUSED";
export const CONFIG_UNREADABLE = "CONFIG_UNREADABLE";
export const HOOK_FAILED = "HOOK_FAILED";
export function isDeliberate(err) {
  return isStoreError(err, "IMPLICIT_DEFAULT_DIR_REFUSED") || isStoreError(err, "EXPLICIT_DIR_GUARD_MALFORMED") || isStoreError(err, "STORE_UNINITIALIZED");
}
const PLAIN_WORDS = {
  MEMORY_BODY_MISSING: "a memory's row is in the store and its words are not",
  MEMORY_META_MALFORMED: "a memory's metadata is not something this build can read",
  PROSE_PAYLOAD_MISMATCH: "a row and the memory it was read for disagree about which memory it is",
  PROSE_BODY_INVALID: "a memory has a body this build cannot write",
  ID_DANGLING: "a row points at a memory that is not in the store",
  ID_CYCLE: "a revision chain in the store points back at itself",
  ID_CHAIN_TOO_DEEP: "a revision chain in the store is longer than this build follows",
  SCHEMA_AHEAD: "this store was written by a newer build than the one running",
  STORE_PRE_ROWS: "this store keeps its memories in files, which this build does not read — it was written before the floor changed; the build that reads it is the tag floor/v5-last",
  MIGRATION_SNAPSHOT_FAILED: "upgrade not run — the copy taken first failed; the store is unchanged",
  STORE_ROLLED_BACK: "this store was rolled back to an older version; install that version, or run counterparts rollback --upgrade-again to upgrade it again",
  SQLITE_UNAVAILABLE: "this runtime has no SQLite binding",
  DATA_DIR_FORBIDDEN: "the configured data dir is one this build refuses to open",
  STORE_UNINITIALIZED: "there is no store here yet, or it is a schema behind"
};
export const OPEN_FAILED_WORDS = "the store would not open";
function preRowsReason(err) {
  if (!isStoreError(err, "STORE_PRE_ROWS"))
    return null;
  if (typeof err.detail["remedy"] !== "string")
    return null;
  return "this directory holds this build's store AND an older build's leftovers, so it will not " + "open either by guess — run counterparts doctor for the names and what to move";
}
function sqliteReason(err) {
  if (!isStoreError(err, "SQLITE_UNAVAILABLE") || err.detail["driver"] !== "node:sqlite")
    return null;
  const running = typeof err.detail["running"] === "string" ? err.detail["running"] : "this version";
  return `Node ${running} can't load node:sqlite; use Node 22.15 or later, or Bun`;
}
function migrationReason(err) {
  if (!isStoreError(err, "MIGRATION_SNAPSHOT_FAILED"))
    return null;
  const why = err.detail["reason"];
  const base = PLAIN_WORDS.MIGRATION_SNAPSHOT_FAILED ?? OPEN_FAILED_WORDS;
  return typeof why === "string" && why.length > 0 ? `${why} (${base})` : base;
}
function rollbackReason(err) {
  if (!isStoreError(err, "STORE_ROLLED_BACK") || err.detail["halfway"] !== true)
    return null;
  return "a rollback of this store stopped halfway; run counterparts rollback --undo, and don't install the older version first";
}
export function describeFault(err) {
  try {
    return readFault(err);
  } catch {
    return { code: HOOK_FAILED, reason: OPEN_FAILED_WORDS, kind: "persistent" };
  }
}
function readFault(err) {
  const kind = isLocked(err) ? "transient" : "persistent";
  if (isStoreError(err)) {
    return {
      code: err.code,
      reason: preRowsReason(err) ?? migrationReason(err) ?? rollbackReason(err) ?? sqliteReason(err) ?? PLAIN_WORDS[err.code] ?? OPEN_FAILED_WORDS,
      kind
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: HOOK_FAILED,
    reason: message.trim().length === 0 ? OPEN_FAILED_WORDS : message,
    kind
  };
}
export function classifyStandDown(err) {
  return isDeliberate(err) ? null : describeFault(err);
}
export function faultPath(err) {
  if (!isStoreError(err))
    return null;
  const path = err.detail["path"];
  return typeof path === "string" && path.length > 0 ? path : null;
}
export function faultId(err) {
  if (!isStoreError(err))
    return null;
  const id = err.detail["id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}
function oneLine(text) {
  return text.replace(/\s+/g, " ").trim();
}
function tildeHome(text, home = homedir()) {
  return home.length > 1 ? text.split(home).join("~") : text;
}
export function standDownMessage(fault) {
  const reason = tildeHome(oneLine(fault.reason));
  const said = reason.length <= STANDDOWN_REASON_MAX_CHARS ? reason : `${reason.slice(0, STANDDOWN_REASON_MAX_CHARS - 1)}…`;
  return `Counterparts memory is OFF for this session: ${said} (${fault.code}). ${STANDDOWN_TAIL}`;
}
export const BUSY_TURN_MESSAGE = "Counterparts skipped this turn: the memory database was busy (database is locked). " + "If this keeps happening, run: counterparts doctor";
export const BUSY_SESSION_START_MESSAGE = "Counterparts could not load memory at session start: the memory database was busy. " + "This session has no wake; recall will work once the database is free. " + "If this keeps happening, run: counterparts doctor";
export const TRANSIENT_ESCALATE_AFTER = 5;
export function busyWedgedMessage(count) {
  return `Counterparts has skipped ${String(count)} turns this session: the memory database stays ` + "busy (database is locked). Memory is effectively off until that clears. " + "Run: counterparts doctor";
}
export const STANDDOWN_MARKER_SUFFIX = ".standdown.json";
export function standDownMarkerPath(dataDir, sessionId) {
  if (!isSessionId(sessionId))
    return null;
  return join(dataDir, SESSIONS_DIR, `${sessionId}${STANDDOWN_MARKER_SUFFIX}`);
}
export function readMark(dataDir, sessionId) {
  if (dataDir === undefined || dataDir.length === 0)
    return null;
  const path = standDownMarkerPath(dataDir, sessionId);
  if (path === null)
    return null;
  let raw;
  try {
    assertSafeDataDir(dataDir);
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const rec = raw;
  const t = rec["transient"];
  const trans = t !== null && typeof t === "object" ? t : {};
  return {
    sessionId: typeof rec["sessionId"] === "string" ? rec["sessionId"] : sessionId,
    at: typeof rec["at"] === "string" ? rec["at"] : "",
    event: typeof rec["event"] === "string" ? rec["event"] : "",
    code: typeof rec["code"] === "string" ? rec["code"] : "",
    told: rec["told"] === undefined ? true : rec["told"] === true,
    transient: {
      count: typeof trans["count"] === "number" && Number.isFinite(trans["count"]) ? Math.max(0, Math.floor(trans["count"])) : 0,
      at: typeof trans["at"] === "string" ? trans["at"] : "",
      told: trans["told"] === true,
      escalated: trans["escalated"] === true
    }
  };
}
export function writeMark(dataDir, sessionId, mark) {
  if (dataDir === undefined || dataDir.length === 0)
    return false;
  const path = standDownMarkerPath(dataDir, sessionId);
  if (path === null)
    return false;
  const tmp = `${path}.${String(process.pid)}.tmp`;
  try {
    assertSafeDataDir(dataDir);
    const there = lstatSync(path, { throwIfNoEntry: false });
    if (there !== undefined && !there.isFile())
      return false;
    mkdirSync(join(dataDir, SESSIONS_DIR), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(mark)}
`, { encoding: "utf8", mode: 384 });
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}
export function decideSay(fault, hook, sessionId, prior, at = Date.now()) {
  const now = new Date(at).toISOString();
  const was = prior?.transient ?? { count: 0, at: "", told: false, escalated: false };
  const base = {
    sessionId,
    at: now,
    event: hook,
    code: fault.code,
    told: prior?.told === true,
    transient: was
  };
  if (fault.kind === "persistent") {
    const say = hook === "session-start" || !base.told;
    return { message: say ? standDownMessage(fault) : null, mark: { ...base, told: base.told || say } };
  }
  const count = was.count + 1;
  if (count >= TRANSIENT_ESCALATE_AFTER && !was.escalated) {
    return {
      message: busyWedgedMessage(count),
      mark: { ...base, transient: { count, at: now, told: true, escalated: true } }
    };
  }
  const say = !was.told && (hook === "session-start" || count >= 2);
  return {
    message: say ? hook === "session-start" ? BUSY_SESSION_START_MESSAGE : BUSY_TURN_MESSAGE : null,
    mark: { ...base, transient: { count, at: now, told: was.told || say, escalated: was.escalated } }
  };
}
