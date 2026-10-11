/**
 * ONE DELIVERY PER EVENT, HOWEVER MANY WIRINGS FIRE IT (2026-10-09).
 *
 * Claude Code runs every hook registered for an event — from settings and from
 * plugins alike — at the same moment, each handed the same input. When two
 * wirings of Counterparts are live (the npm install's hooks in settings and
 * the plugin's, or two settings files naming two builds), every event runs our
 * hook twice: two wakes at session start, two recall blocks per prompt, two
 * Stop asks, two boundaries, two background workers rewriting the wake bundle
 * at each other. The plugin is meant to stand down when it sees the npm wiring
 * (`adapters/plugin.ts#hookGate`), and on 2026-10-09 a plugin from an older
 * build did not recognise the newer `connect`'s hook line and didn't. That
 * reading is tolerant now (`host-wiring.ts#readOurHook`), and this is the
 * backstop for the next way it fails: the FIRST hook process to claim the
 * event does the event's whole job, and its twin exits with no output.
 *
 * THE CLAIM is one row of its OWN small database,
 * `sessions/claims/hook-claims.sqlite` (`claimsPath`), changed in one `BEGIN
 * IMMEDIATE` transaction: the second process waits and then reads what the
 * first wrote. The row holds only the claims of the last `CLAIM_WINDOW_MS` (at
 * most `CLAIM_KEEP` of them), so it never grows. Each of the claim's two writes
 * waits at most `CLAIM_WAIT_MS`.
 *
 * ITS OWN FILE, NOT THE STORE'S `meta` (2026-10-10). Until then the row lived in
 * `counterparts.sqlite`, so the claim waited on the store's one write lock, and
 * the store's busiest writer is the detached worker the previous Stop or
 * SessionEnd started: it reaches the store a bun start-up after its hook exits,
 * which is just when the NEXT hook reaches it. On a loaded machine its commits
 * held the lock for 300 to 600 ms at a time, past the claim's 500 ms, and the
 * claim gave up (`database is locked`) where the hook's other writes, which wait
 * five seconds, went through (CI on master a78e1dae; reproduced in a 2-CPU Linux
 * container). In this file the only writers are claims, each well under a
 * millisecond of work, so a claim waits on nothing but another claim, and a
 * store somebody holds costs it nothing at all. The file is host state, not
 * memory: inside `sessions/` (LAYOUT's entry says new state of that kind goes
 * there), never backed up, and nothing in it outlives the window. In a
 * directory of its own, as `log/` and `association/` are, because the sessions
 * prune removes any FILE directly in `sessions/` untouched for a week, and in
 * WAL a commit touches the log, not the database file.
 *
 * WHAT MAKES TWO PROCESSES TWINS — the same KEY, and running AT THE SAME TIME.
 *
 *   - THE KEY is what Claude Code hands every hook of one event identically: the
 *     session id, the event, and `prompt_id` (2.1.296: "UUID correlating a user
 *     prompt with all subsequent events until the next prompt"), with the prompt
 *     text (UserPromptSubmit), `source` (SessionStart), `stop_hook_active` and
 *     the last assistant message (Stop), `reason` (SessionEnd) and `trigger`
 *     (PreCompact) folded in. Text is hashed; the key is a hash, and nothing of
 *     the prompt is stored. The transcript's size is NOT in it: the host may
 *     write between the twins starting, and a key that differs between twins is
 *     no claim at all.
 *   - AT THE SAME TIME: the host starts the twins together, so each began before
 *     the other could have finished. The winner records when its process started
 *     and, as it exits, when it finished; a process with the same key that
 *     STARTED BEFORE THE HOLDER FINISHED (or while it is still running) is its
 *     twin. A process that started after the holder finished is a separate event
 *     that happens to look the same — a host with no `prompt_id` sending the same
 *     words twice, a session resumed twice in a row — and it delivers. So the
 *     time a hook takes or the store's busy timeout cannot turn a twin into a
 *     second delivery, and no repeat is ever swallowed by a clock. A slow
 *     START-UP can, and did (2026-10-10, measured under load: a twin's runtime
 *     came up 45 ms after the winner finished, and the session got two wakes).
 *     So an event the host sends ONCE per key (`firesOnce`: a session's first
 *     start, a prompt with its id) is a twin whenever it started; the rest keep
 *     the start-time rule, and there the claim is a backstop that a very late
 *     twin can still pass.
 *   - A holder that never says it finished (killed, crashed) holds for
 *     `CLAIM_WINDOW_MS` and no longer.
 *
 * FAIL-OPEN, ALWAYS. No session id, an observer, a claims file that will not
 * take the write: this process delivers. Two deliveries are a nuisance; none is
 * a session that woke up with no memory. A single wiring therefore behaves
 * exactly as before, at the cost of two small writes per event.
 *
 * A CLAIMS FILE THAT IS NOT A DATABASE IS SET ASIDE AND REBUILT, ONCE (review of
 * #359, 2026-10-10). Before, a corrupt or foreign file was a lasting fault: a
 * stderr line on every event, and the backstop off until somebody deleted it.
 * Now the write that meets one (`isUnreadableDatabase`) moves it — with its
 * `-wal` and `-shm`, so a stale log is never replayed into the new file — to
 * `hook-claims.unreadable-<epoch ms>.sqlite` beside it, keeping only the newest
 * such copy, and tries once more on a fresh file. The copy is the durable trace:
 * doctor's `Hook claims` line reads it (`claimsSetAside`). Nothing in the file
 * outlives the window, so nothing is lost but the claims of the last 15 s. The
 * event is delivered whatever happens.
 *
 * PRIVATE, AS `log/` IS: the directory is made 0700 and the file 0600 (SQLite
 * gives its `-wal` and `-shm` the database file's mode).
 *
 * WHY ONE WIRING CLAIMS TOO. A hook cannot know it has no twin: the claim is the
 * backstop for exactly the case where reading the host's wiring got it wrong
 * (2026-10-09), so it cannot be skipped on that same reading. What one wiring
 * pays is the two small writes, on a file nothing else writes.
 */
import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, rmdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { HOOK_CLAIM_LOST_EVENT } from "../../core/counterpart.js";
import { isLocked, isUnreadableDatabase, openDb } from "../../core/store/db.js";
import { sessionsDir } from "../sessions.js";
import type { HookName } from "./hooks.js";

/** The claims' own directory and database, inside the store's `sessions/`. */
export const CLAIMS_DIR = "claims";
export const CLAIMS_FILE = "hook-claims.sqlite";
/** The one row in it holding the recent claims (the key it had in `meta`). */
export const CLAIMS_ROW = "adapter.hook.claims";
/** How long a claim is kept, and the longest an unfinished one holds. */
export const CLAIM_WINDOW_MS = 15_000;
/** The most claims the row keeps, newest first — a bound on its size if a
 *  clock jumps or a burst of sessions fires at once. */
export const CLAIM_KEEP = 64;
/** How long each of the claim's two writes waits on another claim before it
 *  gives up (and the hook delivers). A twin outwaits its holder's claim — well
 *  under a millisecond of work — many times over. Only claims write the file,
 *  so the store's own writers (the worker, the MCP server, the CLI) never
 *  count against it. */
export const CLAIM_WAIT_MS = 500;

/** Where the claims live, for a store at `dataDir`. */
export function claimsPath(dataDir: string): string {
  return join(sessionsDir(dataDir), CLAIMS_DIR, CLAIMS_FILE);
}

const CLAIMS_DDL = "CREATE TABLE IF NOT EXISTS claims (key TEXT PRIMARY KEY, value TEXT NOT NULL)";

/**
 * READ, CHANGE AND WRITE THE CLAIMS ROW IN ONE `BEGIN IMMEDIATE`, on the claims
 * file's own connection, opened for this one write and closed after it. `fn`
 * gets the row as it stands inside the transaction and returns the new value,
 * or `undefined` to leave it. Throws what SQLite or the file system throws.
 *
 * Opened as the store is (`openDb`, WAL), then: wait `CLAIM_WAIT_MS`, not the
 * store's five seconds; `synchronous = NORMAL`, not the store's FULL, because
 * nothing here outlives `CLAIM_WINDOW_MS`, so a commit a power cut takes back
 * costs nothing, and in WAL NORMAL never corrupts the file. The two writes of
 * an event, measured in a 2-CPU Linux container (2026-10-10): 3-4 ms with the
 * rollback journal and FULL, about 1 ms with WAL and FULL (an fsync per commit),
 * 0.2 ms with WAL and NORMAL. The log is folded
 * every 100 pages rather than SQLite's 1000, so it stays under half a megabyte
 * beside a row of a few kilobytes.
 */
function updateClaims(
  dataDir: string,
  fn: (current: string | undefined) => string | undefined,
  onWait?: OnClaimWait,
): { readonly setAside: string | null } {
  const path = claimsPath(dataDir);
  // WHICH FILE this attempt meets, so a failure can tell "this file is bad"
  // from "a twin moved it while this attempt had it open".
  const met = fileIdentity(path);
  // A JOURNAL A TWIN REMOVED (2026-10-10): one more try, once per write
  // (`sidecarGone`). Only ever before this write's own commit: one its commit
  // met has landed (`transactClaims`), so no try reads its own claim as a twin's.
  let oneMore = true;
  const once = (): void => {
    try {
      transactClaims(path, fn);
    } catch (err) {
      // A busy timeout run out: one wait of `CLAIM_WAIT_MS` (`ClaimInput.onWait`).
      if (isLocked(err)) onWait?.("busy");
      throw err;
    }
  };
  const transact = (): void => {
    try {
      once();
    } catch (err) {
      if (!oneMore || !sidecarGone(err)) throw err;
      oneMore = false;
      once();
    }
  };
  try {
    transact();
    return { setAside: null };
  } catch (err) {
    let setAside: string | null = null;
    // A TWIN MOVED IT (review of #366) when another file, or none, holds the
    // path now: a twin that met the same bad file set it aside while this
    // attempt had it open. What the driver says then varies by platform and
    // moment (`SQLITE_IOERR_VNODE`, `SQLITE_IOERR_FSTAT`, the old file's own
    // `SQLITE_NOTADB`), so the test is the file, not the code. Then this one
    // only tries again, on the twin's file, and loses to the twin's claim.
    if (fileIdentity(path) === met) {
      if (isUnreadableDatabase(err)) setAside = setClaimsAside(path, met, onWait);
      // A LOCK IS CONTENTION, and says so at once (2026-10-11, a nit from the
      // review of #366): another claim held the file past `CLAIM_WAIT_MS` on a
      // healthy file, so the hook delivers `busy` now rather than first
      // waiting on a set-aside lock and then the busy wait once more.
      else if (isLocked(err)) throw err;
      // A twin is moving it right now (its sidecars go first, so the file is
      // still here): wait for it to be gone, then try the twin's new file. No
      // twin at work is the error's own — unless the file left while this
      // looked: a twin moves the file BEFORE it lets go of the lock, so one
      // that did both between the two looks leaves no lock but a file moved
      // (measured under load, an `SQLITE_IOERR_VNODE` delivered beside the
      // winner about 1 round in 1,500).
      else if (!awaitSetAside(path, met, onWait) && fileIdentity(path) === met) throw err;
    }
    transact();
    return { setAside };
  }
}

/**
 * SQLITE_IOERR_DELETE_NOENT: SQLite went to delete the file's rollback journal
 * and found it gone — here, a twin removed it first. Measured (2026-10-10, Linux):
 * a twin whose connection is still on the bad file a set-aside moved meets the NEW
 * file's journal by its name, finds no lock on its own file, plays the journal
 * back into the old one and deletes it, and the commit that made the journal
 * then fails with this, its pages written. Nothing is wrong with the file, so
 * the write runs once more. bun names it in `code`; `node:sqlite` gives the
 * extended number (`SQLITE_IOERR` | 23 << 8).
 */
function sidecarGone(err: unknown): boolean {
  const e = err as { code?: unknown; errcode?: unknown } | null | undefined;
  return e?.code === "SQLITE_IOERR_DELETE_NOENT" || e?.errcode === 5898;
}

/** The prefix and suffix of a claims file set aside as unreadable, beside the live one. */
export const CLAIMS_SET_ASIDE_PREFIX = "hook-claims.unreadable-";
const CLAIMS_SET_ASIDE_SUFFIX = ".sqlite";

/**
 * WHO SETS IT ASIDE: the one twin that makes this directory beside the file
 * (review of #366). Without it two twins that met the same bad file both
 * moved "the" file, and the second, a moment late, moved the first one's new
 * file and its `-wal` — measured, about 1 round in 70 under load, each a
 * second delivery. A holder that died leaves it; past `SET_ASIDE_STALE_MS`
 * the next one takes it over (`takeSetAsideLock`), and until then a lock that
 * old is no twin at work, so nothing waits on it (`awaitSetAside`).
 */
export const SET_ASIDE_LOCK = "hook-claims.setting-aside";
const SET_ASIDE_STALE_MS = 5_000;

/** The file at `path` as device and inode, or null when there is none. */
function fileIdentity(path: string): string | null {
  try {
    const st = statSync(path, { bigint: true });
    return `${String(st.dev)}:${String(st.ino)}`;
  } catch {
    return null;
  }
}

/**
 * Move the unreadable claims file (`met`, the one this attempt failed on)
 * aside, with its `-wal` and `-shm` (a stale log replayed into a new file
 * would be the corruption all over again), to
 * `hook-claims.unreadable-<epoch ms>.sqlite`, then remove any older copy: one
 * is kept, so it is evidence and never a pile. Returns the copy's path, or
 * null when a twin set it aside instead: then this waits, up to
 * `CLAIM_WAIT_MS`, for the twin to have moved it, so the caller's next try
 * meets the twin's new file. Throws when the file cannot be moved.
 *
 * Under the lock the order matters: the sidecars go while the bad file still
 * holds the path, because the moment it is gone a twin may make a new file
 * there, and nothing of that file may be moved.
 */
function setClaimsAside(path: string, met: string | null, onWait?: OnClaimWait, now: number = Date.now()): string | null {
  const dir = dirname(path);
  const lock = join(dir, SET_ASIDE_LOCK);
  let mine = takeSetAsideLock(lock, path, met, onWait);
  if (mine === null) {
    // A twin holds it: wait for the file to go. When no twin is found holding
    // it — it let go, or a twin taking over a dead holder's lock is between
    // moving that one off and making its own — try once more to take it, so a
    // twin never retries on the bad file without either waiting or moving it.
    if (awaitSetAside(path, met, onWait)) return null;
    mine = takeSetAsideLock(lock, path, met, onWait);
    if (mine === null) {
      awaitSetAside(path, met, onWait);
      return null;
    }
  }
  try {
    if (met === null || fileIdentity(path) !== met) return null;
    const name = `${CLAIMS_SET_ASIDE_PREFIX}${String(now)}${CLAIMS_SET_ASIDE_SUFFIX}`;
    const aside = join(dir, name);
    for (const sidecar of ["-wal", "-shm"]) {
      try {
        renameSync(`${path}${sidecar}`, `${aside}${sidecar}`);
      } catch {
        /* not there: nothing to carry */
      }
    }
    renameSync(path, aside);
    for (const other of readdirSync(dir)) {
      if (other.startsWith(CLAIMS_SET_ASIDE_PREFIX) && !other.startsWith(name)) rmSync(join(dir, other), { force: true });
    }
    return aside;
  } finally {
    releaseSetAsideLock(lock, mine);
  }
}

/**
 * When a twin holds the set-aside lock, wait (up to `CLAIM_WAIT_MS`) for the
 * file this attempt met to leave the path. False when no twin is setting it
 * aside, so the caller's error is its own: no lock, or one older than
 * `SET_ASIDE_STALE_MS`, a dead holder's, which no file is leaving for — so a
 * lock left by a crash never slows a busy write on a healthy file.
 */
function awaitSetAside(path: string, met: string | null, onWait?: OnClaimWait): boolean {
  const lock = lockAge(join(dirname(path), SET_ASIDE_LOCK));
  if (lock === null || lock.age > SET_ASIDE_STALE_MS) return false;
  onWait?.("set-aside");
  const until = Date.now() + CLAIM_WAIT_MS;
  while (fileIdentity(path) === met && Date.now() < until) sleepSync(5);
  return true;
}

/**
 * The lock directory at `lock` as identity and age, or null when there is none.
 * The age is the DISTANCE from now (2026-10-11, a nit from the review of #366):
 * after the clock steps back, a lock's time is in the future, and a signed age
 * would read it as fresh until the clock caught up — every claim waiting on a
 * holder that is not there, and none taking it over. Far either way is stale.
 */
function lockAge(lock: string): { readonly id: string; readonly age: number } | null {
  try {
    const st = statSync(lock, { bigint: true });
    return { id: `${String(st.dev)}:${String(st.ino)}`, age: Math.abs(Date.now() - Number(st.mtimeMs)) };
  } catch {
    return null;
  }
}

/**
 * Take the set-aside lock: make it, or take over one a dead holder left (older
 * than `SET_ASIDE_STALE_MS`). Returns the lock as made, for the release, or
 * null when a twin holds it. Throws when it cannot be made at all.
 *
 * THE TAKEOVER IS ONE TWIN'S (review of #366). Removing the old lock and making
 * a new one let two twins that both judged it stale both take it — the second's
 * removal took the first's NEW lock — and both set the file aside: measured,
 * 4 to 16 rounds in 60 delivered twice on macOS. So the old lock is first
 * renamed to a name of this process's own: of twins that judged one lock stale,
 * one rename finds it. And it is removed only if what was renamed IS the lock
 * judged stale; a twin's fresh one, made in between, is put back — and, since
 * that twin may have gone to let go of it in the instant it was moved off and
 * found nothing to remove, this one removes it once the file the twin was
 * moving (`met`, the file both met) has left the path.
 */
function takeSetAsideLock(lock: string, path: string, met: string | null, onWait?: OnClaimWait): HeldLock | null {
  try {
    mkdirSync(lock);
    return { id: fileIdentity(lock) };
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== "EEXIST") throw err;
  }
  const judged = lockAge(lock);
  if (judged === null || judged.age <= SET_ASIDE_STALE_MS) return null;
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
      if (fileIdentity(path) !== met && fileIdentity(lock) === taken) rmdirSync(lock);
      return null;
    }
    rmdirSync(moved);
    mkdirSync(lock);
    return { id: fileIdentity(lock) };
  } catch {
    try {
      rmdirSync(moved);
    } catch {
      /* gone already */
    }
    return null;
  }
}

/** The set-aside lock as this process made it: its identity, or null in the
 *  instant a twin's takeover had it moved off (and put it back). */
interface HeldLock {
  readonly id: string | null;
}

/** Let go of the lock, if it is still the one this process made: a holder
 *  whose lock was taken over (it stalled past `SET_ASIDE_STALE_MS`) must not
 *  remove the next holder's. Never throws: a lock left is taken over later. */
function releaseSetAsideLock(lock: string, held: HeldLock): void {
  try {
    if (held.id === null || fileIdentity(lock) === held.id) rmdirSync(lock);
  } catch {
    /* gone, or a twin's now: nothing of this process's to remove */
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * THE TRACE DOCTOR READS: the claims file set aside as unreadable, if one is
 * there — its file name and when it was set aside (from the name). Null when
 * none is, or the directory cannot be read. Never throws.
 */
export function claimsSetAside(dataDir: string): { readonly name: string; readonly at: number } | null {
  let names: string[];
  try {
    names = readdirSync(dirname(claimsPath(dataDir)));
  } catch {
    return null;
  }
  let newest: { name: string; at: number } | null = null;
  for (const name of names) {
    if (!name.startsWith(CLAIMS_SET_ASIDE_PREFIX) || !name.endsWith(CLAIMS_SET_ASIDE_SUFFIX)) continue;
    const at = Number(name.slice(CLAIMS_SET_ASIDE_PREFIX.length, -CLAIMS_SET_ASIDE_SUFFIX.length));
    if (!Number.isFinite(at)) continue;
    if (newest === null || at > newest.at) newest = { name, at };
  }
  return newest;
}

/** The one transaction, on a connection opened for it and closed after it. */
function transactClaims(path: string, fn: (current: string | undefined) => string | undefined): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Made 0600 before SQLite makes it 0644; its `-wal` and `-shm` take this mode.
  // A twin may make it first, and anything else wrong surfaces at the open.
  try {
    closeSync(openSync(path, "wx", 0o600));
  } catch {
    /* there already, or the open below says why not */
  }
  const db = openDb(path, { wal: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${String(CLAIM_WAIT_MS)}`);
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA wal_autocheckpoint = 100");
    db.exec(CLAIMS_DDL);
    let committing = false;
    try {
      db.transaction(() => {
        const row = db.get<{ value: string }>("SELECT value FROM claims WHERE key = ?", CLAIMS_ROW);
        const next = fn(row?.value);
        if (next !== undefined) db.run("INSERT OR REPLACE INTO claims (key, value) VALUES (?, ?)", CLAIMS_ROW, next);
        committing = true;
      });
    } catch (err) {
      // LANDED: SQLite deletes a rollback journal as the last step of a commit,
      // after the pages are written, so a commit that found its journal gone
      // (`sidecarGone`; WAL commits delete nothing, so only on a connection a
      // contended conversion left in the rollback journal) wrote the claim. A
      // try again would read that claim as a twin's and deliver nowhere.
      if (!committing || !sidecarGone(err)) throw err;
    }
  } finally {
    db.close();
  }
}

/** Which side of the doubled wiring a hook process is, for the record. */
export type ClaimSide = "plugin" | "settings";

/** The outcome: `won` delivers, `lost` exits quietly, `unclaimed` delivers
 *  because no claim could be made (no session, an observer, a failed write). */
export type ClaimOutcome = "won" | "lost" | "unclaimed";

function text(payload: Record<string, unknown>, field: string): string {
  const v = payload[field];
  return typeof v === "string" ? v : "";
}

function digest(value: string): string {
  return value.length === 0 ? "" : createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * The claim key for this event, from the input Claude Code gave the hook; null
 * when there is no session id to claim under. Pure.
 */
export function deliveryClaimKey(name: HookName, payload: Record<string, unknown>): string | null {
  const session = text(payload, "session_id");
  if (session.length === 0) return null;
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
    digest(text(payload, "custom_instructions")),
  ];
  return digest(JSON.stringify(parts));
}

/**
 * DOES THE HOST SEND THIS EVENT ONCE PER KEY? (2026-10-10, the 0.3.15 release
 * check.) A SessionStart that opens a session id — `startup`, `clear`, `fork`,
 * each a new id — and a prompt carrying its `prompt_id`, one per prompt, are
 * never sent twice. So for these a same-key process inside the window is the
 * holder's twin WHENEVER it started. Measured: with two settings wirings on a
 * machine loaded by the suite, the second hook's runtime came up 45 ms after
 * the first had finished its SessionStart, the start-time rule read a new
 * event, and the session got two wakes (1 session of 6; 5 of 5 were single on
 * a quiet machine). `resume`, `compact`, a Stop, SessionEnd, PreCompact and a
 * prompt with no id can legitimately repeat with the same key, so they keep the
 * start-time rule, and for them a twin that starts late still delivers: the
 * plugin's stand-down (`plugin.ts#hookGate`) is the main guard, the claim a
 * backstop. Pure.
 */
export function firesOnce(name: HookName, payload: Record<string, unknown>): boolean {
  if (name === "session-start") return ["startup", "clear", "fork"].includes(text(payload, "source"));
  if (name === "user-prompt-submit") return text(payload, "prompt_id").length > 0;
  return false;
}

/** One held claim: when it was made, by which side, when its process started,
 *  when it finished (absent while it runs), and the token of the one call
 *  that made it (absent in a row an older build wrote). */
interface Held {
  readonly at: number;
  readonly side: string;
  readonly started: number;
  readonly ended?: number;
  readonly token?: string;
}

function readClaims(raw: string | undefined): Record<string, Held> {
  if (raw === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, Held> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v) || typeof v[0] !== "number" || !Number.isFinite(v[0])) continue;
      const at = v[0];
      const started = typeof v[2] === "number" && Number.isFinite(v[2]) ? v[2] : at;
      const ended = typeof v[3] === "number" && Number.isFinite(v[3]) ? v[3] : undefined;
      const token = typeof v[4] === "string" && v[4].length > 0 ? v[4] : undefined;
      out[k] = {
        at,
        side: typeof v[1] === "string" ? v[1] : "",
        started,
        ...(ended === undefined ? {} : { ended }),
        ...(token === undefined ? {} : { token }),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** The row as written: `[at, side, started]`, then `ended` (null while it
 *  runs) when it has ended or carries a token, then the token. An older
 *  build reads the first four and passes over the fifth. */
function writeClaims(claims: Record<string, Held>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(claims).map(([k, h]) => [
        k,
        h.token !== undefined
          ? [h.at, h.side, h.started, h.ended ?? null, h.token]
          : h.ended === undefined
            ? [h.at, h.side, h.started]
            : [h.at, h.side, h.started, h.ended],
      ]),
    ),
  );
}

/** One claim attempt, as `claimStep` reads the row for it. */
export interface ClaimAttempt {
  readonly key: string;
  readonly side: ClaimSide;
  readonly now: number;
  readonly started: number;
  readonly once: boolean;
  /** This call's own token (`claimDelivery` makes one per call). */
  readonly token: string;
}

/**
 * WHAT ONE TRY OF A CLAIM DOES WITH THE ROW AS IT STANDS (the transaction's
 * callback, `claimDelivery`): the row to write, or `undefined` to leave it,
 * and the side that holds the event when a twin does. Pure.
 *
 * ITS OWN CLAIM IS ITS OWN (2026-10-11, from the review of #378). A write can
 * run its callback more than once (`updateClaims`: a sidecar a twin removed,
 * a file a twin set aside), and a try whose commit LANDED though the write
 * reported a failure leaves this call's claim in the row for the next try to
 * meet. Read as a twin's, the event would be delivered nowhere — both
 * processes standing down, one for the other and one for itself. The claim
 * carries the call's token, so the next try knows it: the event is this
 * call's, and the row is left as it is.
 */
export function claimStep(current: string | undefined, attempt: ClaimAttempt): { readonly next: string | undefined; readonly heldBy: string | null } {
  const { key, now, started } = attempt;
  const fresh = (h: Held): boolean => Math.abs(now - Math.max(h.at, h.ended ?? h.at)) < CLAIM_WINDOW_MS;
  const claims = readClaims(current);
  const held = claims[key];
  if (held !== undefined && held.token === attempt.token) return { next: undefined, heldBy: null };
  // A TWIN: the same event, and this process began before the holder ended
  // — or the host sends this event only once, so any same-key process in
  // the window is one, however late its runtime came up (`firesOnce`).
  if (held !== undefined && fresh(held) && (attempt.once || held.ended === undefined || started < held.ended)) {
    return { next: undefined, heldBy: held.side };
  }
  const kept = Object.entries(claims)
    .filter(([k, h]) => k !== key && fresh(h))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, CLAIM_KEEP - 1);
  return { next: writeClaims(Object.fromEntries([[key, { at: now, side: attempt.side, started, token: attempt.token }], ...kept])), heldBy: null };
}

/** What a claim needs of the counterpart: the store's directory, under which
 *  the claims file lives, and the durable event log a loss is recorded in.
 *  Structural, so a test can hand it a directory no file can be made under. */
export interface ClaimDoors {
  readonly store: { readonly dir: string };
  noteAdapterEvent(name: typeof HOOK_CLAIM_LOST_EVENT, data: Record<string, unknown>): boolean;
}

export interface ClaimInput {
  readonly hook: HookName;
  readonly key: string | null;
  readonly sessionId: string;
  readonly side: ClaimSide;
  /** Under observer nothing is written, so nothing is claimed. */
  readonly observer: boolean;
  /** When this process started (epoch ms); `performance.timeOrigin` by default. */
  readonly started?: number;
  /** The host sends this event once per key (`firesOnce`): a same-key claim in
   *  the window is a twin whenever this process started. */
  readonly once?: boolean;
  readonly now?: number;
  /** Told of each wait of up to `CLAIM_WAIT_MS` the claim sits through: a busy
   *  timeout run out on a held file, or a twin's set-aside lock waited on. For
   *  tests, which count waits where wall time on a loaded machine cannot; the
   *  hook passes none. */
  readonly onWait?: OnClaimWait;
}

/** What a claim waited on (`ClaimInput.onWait`). */
export type OnClaimWait = (wait: "busy" | "set-aside") => void;

export interface Claim {
  readonly outcome: ClaimOutcome;
  /** The winner's claim time, which `finishClaim` names. */
  readonly at?: number;
  /** The winner's token, written beside its claim, which `finishClaim` names too. */
  readonly token?: string;
  /** The side that holds the claim, when this process lost it. */
  readonly heldBy?: string;
  /** Why nothing was claimed. */
  readonly detail?: string;
  /** Set when the claim could not be written because another claim held the
   *  file past `CLAIM_WAIT_MS`: contention, which passes, not a fault. */
  readonly busy?: boolean;
  /** Why nothing was claimed, as a code the process log may write as itself
   *  (`SQLITE_BUSY`, `SQLITE_NOTADB`, `ENOTDIR`, …), where `detail` is a sentence. */
  readonly code?: string;
  /** The copy an unreadable claims file was moved to before this claim was
   *  made on a fresh one (`setClaimsAside`). */
  readonly setAside?: string;
}

/**
 * An error as a code the process log writes as itself: the driver's or the
 * file system's own (`SQLITE_NOTADB`, `EACCES`); `node:sqlite`'s number as
 * `SQLITE_<n>`; else the error's class. Never its message.
 */
function codeOf(err: unknown): string {
  const e = err as { code?: unknown; errcode?: unknown; name?: unknown } | null | undefined;
  if (typeof e?.errcode === "number") return `SQLITE_${String(e.errcode)}`;
  if (typeof e?.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(e.code)) return e.code;
  return typeof e?.name === "string" && /^[A-Za-z0-9_]{1,40}$/.test(e.name) ? e.name : "unknown";
}

/**
 * Claim this event for this process, or learn that its twin already has. A
 * loss is recorded (`adapter.hook.claim.lost`, prunable telemetry). Never
 * throws.
 */
export function claimDelivery(doors: ClaimDoors, input: ClaimInput): Claim {
  if (input.key === null) return { outcome: "unclaimed", detail: "no session id" };
  if (input.observer) return { outcome: "unclaimed", detail: "observer" };
  const key = input.key;
  const now = input.now ?? Date.now();
  const started = input.started ?? performance.timeOrigin;
  const attempt: ClaimAttempt = { key, side: input.side, now, started, once: input.once === true, token: randomBytes(6).toString("hex") };
  // Written inside the transaction's callback, read after it.
  const seen: { heldBy: string | null } = { heldBy: null };
  let setAside: string | null = null;
  try {
    ({ setAside } = updateClaims(doors.store.dir, (current) => {
      // Each try decides afresh: the callback runs again after a failed write
      // (`updateClaims`), and may meet this call's own claim (`claimStep`).
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
  if (winner === null) return { outcome: "won", at: now, token: attempt.token, ...rebuilt };
  try {
    doors.noteAdapterEvent(HOOK_CLAIM_LOST_EVENT, {
      hook: input.hook,
      session: input.sessionId,
      lost: input.side,
      won: winner.length === 0 ? null : winner,
    });
  } catch {
    // The row is the record, not the decision: the twin still stands down.
  }
  return { outcome: "lost", heldBy: winner, ...rebuilt };
}

/**
 * THE WINNER IS DONE: stamp its claim with the time it finished, so a later
 * process with the same key — one that started after this — is read as the
 * separate event it is. Only this process's own claim (same key, same `at`) is
 * touched — and, when both it and the row carry a token, the same token
 * (review of #382). A row without one is an older build's, or one an older
 * build rewrote, which drops every token: then `at` alone, as before. Never
 * throws: a stamp that does not land leaves the claim to expire.
 */
export function finishClaim(doors: Pick<ClaimDoors, "store">, key: string, at: number, now: number = Date.now(), token?: string): boolean {
  let stamped = false;
  try {
    updateClaims(doors.store.dir, (current) => {
      stamped = false;
      const claims = readClaims(current);
      const held = claims[key];
      if (held === undefined || held.at !== at) return undefined;
      if (token !== undefined && held.token !== undefined && held.token !== token) return undefined;
      claims[key] = { ...held, ended: now };
      stamped = true;
      return writeClaims(claims);
    });
  } catch {
    return false;
  }
  return stamped;
}
