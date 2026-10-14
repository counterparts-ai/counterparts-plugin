import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, rmdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOOK_CLAIM_LOST_EVENT } from "../../core/counterpart.js";
import { isLocked, isUnreadableDatabase, openDb } from "../../core/store/db.js";
import { sessionsDir } from "../sessions.js";
export const CLAIMS_DIR = "claims";
export const CLAIMS_FILE = "hook-claims.sqlite";
export const CLAIMS_ROW = "adapter.hook.claims";
export const CLAIM_WINDOW_MS = 15000;
export const CLAIM_KEEP = 64;
export const CLAIM_WAIT_MS = 500;
export function claimsPath(dataDir) {
  return join(sessionsDir(dataDir), CLAIMS_DIR, CLAIMS_FILE);
}
const CLAIMS_DDL = "CREATE TABLE IF NOT EXISTS claims (key TEXT PRIMARY KEY, value TEXT NOT NULL)";
function updateClaims(dataDir, fn, onWait) {
  const path = claimsPath(dataDir);
  const met = fileIdentity(path);
  let oneMore = true;
  const once = () => {
    try {
      transactClaims(path, fn);
    } catch (err) {
      if (isLocked(err))
        onWait?.("busy");
      throw err;
    }
  };
  const transact = () => {
    try {
      once();
    } catch (err) {
      if (!oneMore || !sidecarGone(err))
        throw err;
      oneMore = false;
      once();
    }
  };
  try {
    transact();
    return { setAside: null };
  } catch (err) {
    let setAside = null;
    if (fileIdentity(path) === met) {
      if (isUnreadableDatabase(err))
        setAside = setClaimsAside(path, met, onWait);
      else if (isLocked(err))
        throw err;
      else if (!awaitSetAside(path, met, onWait) && fileIdentity(path) === met)
        throw err;
    }
    transact();
    return { setAside };
  }
}
function sidecarGone(err) {
  const e = err;
  return e?.code === "SQLITE_IOERR_DELETE_NOENT" || e?.errcode === 5898;
}
export const CLAIMS_SET_ASIDE_PREFIX = "hook-claims.unreadable-";
const CLAIMS_SET_ASIDE_SUFFIX = ".sqlite";
export const SET_ASIDE_LOCK = "hook-claims.setting-aside";
const SET_ASIDE_STALE_MS = 5000;
function fileIdentity(path) {
  try {
    const st = statSync(path, { bigint: true });
    return `${String(st.dev)}:${String(st.ino)}`;
  } catch {
    return null;
  }
}
function setClaimsAside(path, met, onWait, now = Date.now()) {
  const dir = dirname(path);
  const lock = join(dir, SET_ASIDE_LOCK);
  let mine = takeSetAsideLock(lock, path, met, onWait);
  if (mine === null) {
    if (awaitSetAside(path, met, onWait))
      return null;
    mine = takeSetAsideLock(lock, path, met, onWait);
    if (mine === null) {
      awaitSetAside(path, met, onWait);
      return null;
    }
  }
  try {
    if (met === null || fileIdentity(path) !== met)
      return null;
    const name = `${CLAIMS_SET_ASIDE_PREFIX}${String(now)}${CLAIMS_SET_ASIDE_SUFFIX}`;
    const aside = join(dir, name);
    for (const sidecar of ["-wal", "-shm"]) {
      try {
        renameSync(`${path}${sidecar}`, `${aside}${sidecar}`);
      } catch {}
    }
    renameSync(path, aside);
    for (const other of readdirSync(dir)) {
      if (other.startsWith(CLAIMS_SET_ASIDE_PREFIX) && !other.startsWith(name))
        rmSync(join(dir, other), { force: true });
    }
    return aside;
  } finally {
    releaseSetAsideLock(lock, mine);
  }
}
function awaitSetAside(path, met, onWait) {
  const lock = lockAge(join(dirname(path), SET_ASIDE_LOCK));
  if (lock === null || lock.age > SET_ASIDE_STALE_MS)
    return false;
  onWait?.("set-aside");
  const until = Date.now() + CLAIM_WAIT_MS;
  while (fileIdentity(path) === met && Date.now() < until)
    sleepSync(5);
  return true;
}
function lockAge(lock) {
  try {
    const st = statSync(lock, { bigint: true });
    return { id: `${String(st.dev)}:${String(st.ino)}`, age: Math.abs(Date.now() - Number(st.mtimeMs)) };
  } catch {
    return null;
  }
}
function takeSetAsideLock(lock, path, met, onWait) {
  try {
    mkdirSync(lock);
    return { id: fileIdentity(lock) };
  } catch (err) {
    if (err?.code !== "EEXIST")
      throw err;
  }
  const judged = lockAge(lock);
  if (judged === null || judged.age <= SET_ASIDE_STALE_MS)
    return null;
  const moved = `${lock}.stale-${String(process.pid)}`;
  try {
    renameSync(lock, moved);
  } catch {
    return null;
  }
  try {
    const taken = fileIdentity(moved);
    if (taken !== judged.id) {
      renameSync(moved, lock);
      awaitSetAside(path, met, onWait);
      if (fileIdentity(path) !== met && fileIdentity(lock) === taken)
        rmdirSync(lock);
      return null;
    }
    rmdirSync(moved);
    mkdirSync(lock);
    return { id: fileIdentity(lock) };
  } catch {
    try {
      rmdirSync(moved);
    } catch {}
    return null;
  }
}
function releaseSetAsideLock(lock, held) {
  try {
    if (held.id === null || fileIdentity(lock) === held.id)
      rmdirSync(lock);
  } catch {}
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
export function claimsSetAside(dataDir) {
  let names;
  try {
    names = readdirSync(dirname(claimsPath(dataDir)));
  } catch {
    return null;
  }
  let newest = null;
  for (const name of names) {
    if (!name.startsWith(CLAIMS_SET_ASIDE_PREFIX) || !name.endsWith(CLAIMS_SET_ASIDE_SUFFIX))
      continue;
    const at = Number(name.slice(CLAIMS_SET_ASIDE_PREFIX.length, -CLAIMS_SET_ASIDE_SUFFIX.length));
    if (!Number.isFinite(at))
      continue;
    if (newest === null || at > newest.at)
      newest = { name, at };
  }
  return newest;
}
function transactClaims(path, fn) {
  mkdirSync(dirname(path), { recursive: true, mode: 448 });
  try {
    closeSync(openSync(path, "wx", 384));
  } catch {}
  const db = openDb(path, { wal: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${String(CLAIM_WAIT_MS)}`);
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA wal_autocheckpoint = 100");
    db.exec(CLAIMS_DDL);
    let committing = false;
    try {
      db.transaction(() => {
        const row = db.get("SELECT value FROM claims WHERE key = ?", CLAIMS_ROW);
        const next = fn(row?.value);
        if (next !== undefined)
          db.run("INSERT OR REPLACE INTO claims (key, value) VALUES (?, ?)", CLAIMS_ROW, next);
        committing = true;
      });
    } catch (err) {
      if (!committing || !sidecarGone(err))
        throw err;
    }
  } finally {
    db.close();
  }
}
function text(payload, field) {
  const v = payload[field];
  return typeof v === "string" ? v : "";
}
function digest(value) {
  return value.length === 0 ? "" : createHash("sha256").update(value).digest("hex").slice(0, 32);
}
export function deliveryClaimKey(name, payload) {
  const session = text(payload, "session_id");
  if (session.length === 0)
    return null;
  const parts = [
    session,
    name,
    text(payload, "prompt_id"),
    text(payload, "agent_id"),
    text(payload, "source"),
    payload["stop_hook_active"] === true ? "re-fired" : "",
    digest(text(payload, "prompt")),
    digest(text(payload, "last_assistant_message")),
    text(payload, "reason"),
    text(payload, "trigger"),
    digest(text(payload, "custom_instructions"))
  ];
  return digest(JSON.stringify(parts));
}
export function firesOnce(name, payload) {
  if (name === "session-start")
    return ["startup", "clear", "fork"].includes(text(payload, "source"));
  if (name === "user-prompt-submit")
    return text(payload, "prompt_id").length > 0;
  return false;
}
function readClaims(raw) {
  if (raw === undefined)
    return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!Array.isArray(v) || typeof v[0] !== "number" || !Number.isFinite(v[0]))
        continue;
      const at = v[0];
      const started = typeof v[2] === "number" && Number.isFinite(v[2]) ? v[2] : at;
      const ended = typeof v[3] === "number" && Number.isFinite(v[3]) ? v[3] : undefined;
      const token = typeof v[4] === "string" && v[4].length > 0 ? v[4] : undefined;
      out[k] = {
        at,
        side: typeof v[1] === "string" ? v[1] : "",
        started,
        ...ended === undefined ? {} : { ended },
        ...token === undefined ? {} : { token }
      };
    }
    return out;
  } catch {
    return {};
  }
}
function writeClaims(claims) {
  return JSON.stringify(Object.fromEntries(Object.entries(claims).map(([k, h]) => [
    k,
    h.token !== undefined ? [h.at, h.side, h.started, h.ended ?? null, h.token] : h.ended === undefined ? [h.at, h.side, h.started] : [h.at, h.side, h.started, h.ended]
  ])));
}
export function claimStep(current, attempt) {
  const { key, now, started } = attempt;
  const fresh = (h) => Math.abs(now - Math.max(h.at, h.ended ?? h.at)) < CLAIM_WINDOW_MS;
  const claims = readClaims(current);
  const held = claims[key];
  if (held !== undefined && held.token === attempt.token)
    return { next: undefined, heldBy: null };
  if (held !== undefined && fresh(held) && (attempt.once || held.ended === undefined || started < held.ended)) {
    return { next: undefined, heldBy: held.side };
  }
  const kept = Object.entries(claims).filter(([k, h]) => k !== key && fresh(h)).sort((a, b) => b[1].at - a[1].at).slice(0, CLAIM_KEEP - 1);
  return { next: writeClaims(Object.fromEntries([[key, { at: now, side: attempt.side, started, token: attempt.token }], ...kept])), heldBy: null };
}
function codeOf(err) {
  const e = err;
  if (typeof e?.errcode === "number")
    return `SQLITE_${String(e.errcode)}`;
  if (typeof e?.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(e.code))
    return e.code;
  return typeof e?.name === "string" && /^[A-Za-z0-9_]{1,40}$/.test(e.name) ? e.name : "unknown";
}
export function claimDelivery(doors, input) {
  if (input.key === null)
    return { outcome: "unclaimed", detail: "no session id" };
  if (input.observer)
    return { outcome: "unclaimed", detail: "observer" };
  const key = input.key;
  const now = input.now ?? Date.now();
  const started = input.started ?? performance.timeOrigin;
  const attempt = { key, side: input.side, now, started, once: input.once === true, token: randomBytes(6).toString("hex") };
  const seen = { heldBy: null };
  let setAside = null;
  try {
    ({ setAside } = updateClaims(doors.store.dir, (current) => {
      const step = claimStep(current, attempt);
      seen.heldBy = step.heldBy;
      return step.next;
    }, input.onWait));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const code = codeOf(err);
    return isLocked(err) ? { outcome: "unclaimed", detail, code, busy: true } : { outcome: "unclaimed", detail, code };
  }
  const rebuilt = setAside === null ? {} : { setAside };
  const winner = seen.heldBy;
  if (winner === null)
    return { outcome: "won", at: now, token: attempt.token, ...rebuilt };
  try {
    doors.noteAdapterEvent(HOOK_CLAIM_LOST_EVENT, {
      hook: input.hook,
      session: input.sessionId,
      lost: input.side,
      won: winner.length === 0 ? null : winner
    });
  } catch {}
  return { outcome: "lost", heldBy: winner, ...rebuilt };
}
export function finishClaim(doors, key, at, now = Date.now(), token) {
  let stamped = false;
  try {
    updateClaims(doors.store.dir, (current) => {
      stamped = false;
      const claims = readClaims(current);
      const held = claims[key];
      if (held === undefined || held.at !== at)
        return;
      if (token !== undefined && held.token !== undefined && held.token !== token)
        return;
      claims[key] = { ...held, ended: now };
      stamped = true;
      return writeClaims(claims);
    });
  } catch {
    return false;
  }
  return stamped;
}
