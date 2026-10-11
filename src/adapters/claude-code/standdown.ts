/**
 * WHY A HOOK STOOD DOWN, IN WORDS, AND WHETHER THE OWNER SHOULD HEAR IT.
 *
 * **The gap this closes (H1, 2026-09-18).** `bin/hook.ts` has always ended a
 * failed run with one line on stderr and exit 0 — "a failed hook is a quiet
 * hook, never a failed session". The principle is right; the quiet is the
 * problem. A hook's stderr goes nowhere the owner looks, and three reviews in
 * one day hit the same wall: a fully-removed belief left a row that made
 * `Counterpart.open` throw at every session start; a missing prose file on any
 * schema row still does; a config typo that stood the adapter down was equally
 * invisible. No wake, no recall, no capture, every session — and every visible
 * surface green. The constitution's own sentence: silence must never masquerade
 * as health.
 *
 * So a stand-down is now one of two things, and this file is where they are told
 * apart:
 *
 *   - **DELIBERATE** — a directory scoped `off`, an observer with no store to
 *     read, the explicit-dir guard refusing a store nobody named. Nothing is
 *     wrong; the stand-down IS the behaviour. Quiet, exactly as before.
 *   - **A FAULT** — the store would not open, the named configuration could not
 *     be honoured. Something the owner has to fix, and until he does he has no
 *     memory. Said out loud, on the two events the host displays a
 *     `systemMessage` on (`bin/hook.ts#standDown`).
 *
 * It sits beside `doctor.ts` rather than under `bin/` because both read it: the
 * console's `Store open` finding asks the same question the hook's catch asks —
 * "would this store open the way a session opens it, and if not, in what words?"
 * — and two vocabularies for one question is how the terminal and the console
 * come to disagree about what "healthy" means (constitution 16).
 */
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isLocked } from "../../core/store/db.js";
import { assertSafeDataDir, isStoreError } from "../../core/store/index.js";
import type { StoreErrorCode } from "../../core/store/index.js";
import { SESSIONS_DIR, isSessionId } from "../sessions.js";

/** The last words of every stand-down message, and the only ones never cut. */
export const STANDDOWN_TAIL = "Run: counterparts doctor";

/**
 * How long the REASON clause may be.
 *
 * The message rides the same 10,000-character channel the notice does
 * (`doctor.ts#NOTICE_MAX_CHARS` states the host's cap), but the ceiling that
 * matters here is smaller and is about content, not transport: an error's own
 * message is the one part of this that nobody here wrote, and a stand-down line
 * that fills the terminal with somebody's stack trace is a line people learn to
 * scroll past. Two hundred characters holds a code, a path and a sentence.
 */
export const STANDDOWN_REASON_MAX_CHARS = 200;

/**
 * WHICH KIND OF FAULT — and the distinction is not cosmetic, it is what keeps
 * this from becoming wallpaper.
 *
 *   - `persistent` — the store will not open, or the configuration cannot be
 *     honoured. It will be exactly as broken next turn, and the session has no
 *     memory until somebody fixes it.
 *   - `transient` — the database was BUSY: another process held it for the
 *     moment this hook wanted it (`db.ts#isLocked`, which is also what F1's
 *     WAL conversion swallows). The turn really did nothing, and the next one
 *     will probably be fine. Measured on a fresh store on 2026-09-18, before
 *     WAL: roughly one prompt in ten. A line that says "memory is OFF for this
 *     session" about that is both untrue and, at that rate, a line people learn
 *     to scroll past.
 */
export type StandDownKind = "persistent" | "transient";

/** A stand-down worth saying out loud: a stable code, and plain words for it. */
export interface StandDownFault {
  /** A `StoreErrorCode`, or one of this file's own for a non-store failure. */
  readonly code: string;
  /** One clause of plain words. Never memory text; a path is allowed. */
  readonly reason: string;
  readonly kind: StandDownKind;
}

/** The configuration a caller NAMED could not be honoured (`config-path.ts`). */
export const CONFIG_REFUSED = "CONFIG_REFUSED";
/** A named configuration parsed but did not typecheck, so it resolved observer. */
export const CONFIG_UNREADABLE = "CONFIG_UNREADABLE";
/** Anything that is not a `StoreError` — the code is the error's own message. */
export const HOOK_FAILED = "HOOK_FAILED";

/**
 * THE STAND-DOWNS THAT STAY QUIET, and why each one is not a fault.
 *
 *   - `IMPLICIT_DEFAULT_DIR_REFUSED` / `EXPLICIT_DIR_GUARD_MALFORMED` — the
 *     explicit-dir guard. In a real session it is a fault from the owner's point
 *     of view, and it is also the NORMAL state of every agent and test shell in
 *     this project, which all export `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`.
 *     `describeGuardRefusal` already gives it a sentence with the entry point's
 *     own remedy, and the red notice has never carried it; that treatment is
 *     kept rather than turned into a red line in every hermetic shell.
 *   - `STORE_UNINITIALIZED` — an OBSERVER opened a store that is not there yet,
 *     or is a schema behind (`cli/INTERFACE-GAPS` §7). Initializing would be
 *     writing at open, which an instrument may not do, so standing down is the
 *     behaviour and not a fault. An owner hook on the same store initializes and
 *     migrates it.
 */
export function isDeliberate(err: unknown): boolean {
  return (
    isStoreError(err, "IMPLICIT_DEFAULT_DIR_REFUSED") ||
    isStoreError(err, "EXPLICIT_DIR_GUARD_MALFORMED") ||
    isStoreError(err, "STORE_UNINITIALIZED")
  );
}

/**
 * Plain words for the store codes a session's READ PATH can actually meet.
 *
 * Deliberately partial. A code with no entry gets the general sentence below,
 * which is true of every one of them; inventing prose for codes nobody has seen
 * from a hook would be a glossary that goes stale where nobody reads it.
 */
const PLAIN_WORDS: Partial<Record<StoreErrorCode, string>> = {
  MEMORY_BODY_MISSING: "a memory's row is in the store and its words are not",
  MEMORY_META_MALFORMED: "a memory's metadata is not something this build can read",
  PROSE_PAYLOAD_MISMATCH: "a row and the memory it was read for disagree about which memory it is",
  PROSE_BODY_INVALID: "a memory has a body this build cannot write",
  ID_DANGLING: "a row points at a memory that is not in the store",
  ID_CYCLE: "a revision chain in the store points back at itself",
  ID_CHAIN_TOO_DEEP: "a revision chain in the store is longer than this build follows",
  SCHEMA_AHEAD: "this store was written by a newer build than the one running",
  // The one entry that carries an INSTRUCTION, because it is the one fault a
  // reader can act on without another command: the tag is the way back in, and
  // a bare `floor/v5-last` in a JSON payload told nobody it was a thing to check
  // out (review A, NIT-2). It fits the 200-character reason cap with room.
  STORE_PRE_ROWS:
    "this store keeps its memories in files, which this build does not read — it was written before the floor changed; the build that reads it is the tag floor/v5-last",
  MIGRATION_SNAPSHOT_FAILED: "upgrade not run — the copy taken first failed; the store is unchanged",
  // An instruction too, for the same reason: the rollback that left this hold
  // printed the way on, and a session is where the owner meets it next.
  STORE_ROLLED_BACK:
    "this store was rolled back to an older version; install that version, or run counterparts rollback --upgrade-again to upgrade it again",
  SQLITE_UNAVAILABLE: "this runtime has no SQLite binding",
  DATA_DIR_FORBIDDEN: "the configured data dir is one this build refuses to open",
  STORE_UNINITIALIZED: "there is no store here yet, or it is a schema behind",
};

/** The sentence for a code with no entry above. True of all of them. */
export const OPEN_FAILED_WORDS = "the store would not open";

/**
 * A code and plain words for ANY failure — including the deliberate ones, which
 * `doctor` still has to name even though the hook stays quiet about them.
 */
/**
 * The pre-rows reason clause, which depends on WHICH pre-rows case this is.
 *
 * `PLAIN_WORDS` is a constant table and cannot look at the error; for the
 * LOCKOUT case (a v6 store an older build left its empty leftovers in) the
 * constant sentence sends the owner at `floor/v5-last` — the build that has just
 * stood down on this same directory. That is A-MAJOR-1's circle surviving in the
 * one channel the owner actually reads (third review, NEW-MINOR-1); the correct
 * sentence was on stderr and in doctor only.
 *
 * So when the refusal carries its own `remedy` — which it does exactly when this
 * directory also holds a `counterparts.sqlite` — the reason says that instead,
 * and points at the door that has the full sentence.
 */
function preRowsReason(err: unknown): string | null {
  if (!isStoreError(err, "STORE_PRE_ROWS")) return null;
  if (typeof err.detail["remedy"] !== "string") return null;
  return (
    "this directory holds this build's store AND an older build's leftovers, so it will not " +
    "open either by guess — run counterparts doctor for the names and what to move"
  );
}

/** A Node that will not hand over `node:sqlite` (review of #312): the fix is a
 *  runtime, so the reason names the runtime, the version and the way out rather
 *  than a binding nobody chose. */
function sqliteReason(err: unknown): string | null {
  if (!isStoreError(err, "SQLITE_UNAVAILABLE") || err.detail["driver"] !== "node:sqlite") return null;
  const running = typeof err.detail["running"] === "string" ? err.detail["running"] : "this version";
  return `Node ${running} can't load node:sqlite; use Node 22.15 or later, or Bun`;
}

/** The failed pre-migration copy, with what stopped it — doctor opens as an
 *  observer and never migrates, so this is the one place the why is said. */
function migrationReason(err: unknown): string | null {
  if (!isStoreError(err, "MIGRATION_SNAPSHOT_FAILED")) return null;
  const why = err.detail["reason"];
  const base = PLAIN_WORDS.MIGRATION_SNAPSHOT_FAILED ?? OPEN_FAILED_WORDS;
  // The reason first, so the 200-character cap trims the preamble, not the why.
  return typeof why === "string" && why.length > 0 ? `${why} (${base})` : base;
}

/** A rollback that stopped halfway is not "install that version": the older
 *  version would start a blank store where the database is missing. */
function rollbackReason(err: unknown): string | null {
  if (!isStoreError(err, "STORE_ROLLED_BACK") || err.detail["halfway"] !== true) return null;
  return "a rollback of this store stopped halfway; run counterparts rollback --undo, and don't install the older version first";
}

export function describeFault(err: unknown): StandDownFault {
  // TOTAL, and the reason is not theoretical politeness: this runs inside the
  // handler that exists so a hook never fails the host, and everything below
  // touches a property of an object nobody here made. A throwable with a
  // throwing `code` getter, or one with a null prototype, would throw out of the
  // handler and take the process's exit code with it. The general sentence is
  // true of every failure, so it is the right thing to fall back to.
  try {
    return readFault(err);
  } catch {
    return { code: HOOK_FAILED, reason: OPEN_FAILED_WORDS, kind: "persistent" };
  }
}

function readFault(err: unknown): StandDownFault {
  // BUSY FIRST, because a contended database arrives under several spellings —
  // a bare `Error` from either driver, or a `StoreError` wrapping one — and
  // which class it is says nothing about whether it will still be true next
  // turn. `isLocked` is `db.ts`'s own test, imported rather than mirrored.
  const kind: StandDownKind = isLocked(err) ? "transient" : "persistent";
  if (isStoreError(err)) {
    return {
      code: err.code,
      reason:
        preRowsReason(err) ??
        migrationReason(err) ??
        rollbackReason(err) ??
        sqliteReason(err) ??
        PLAIN_WORDS[err.code] ??
        OPEN_FAILED_WORDS,
      kind,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: HOOK_FAILED,
    reason: message.trim().length === 0 ? OPEN_FAILED_WORDS : message,
    kind,
  };
}

/** The fault to SAY, or null when this stand-down is one of the quiet ones. */
export function classifyStandDown(err: unknown): StandDownFault | null {
  return isDeliberate(err) ? null : describeFault(err);
}

/**
 * The ONE PATH-SHAPED FACT a repair needs, when the error carried one.
 *
 * `StoreError.detail` is ids and counts by contract (§5 G10) — never body text —
 * so taking one named field out of it is safe to print. Only `path`, because
 * that is the field the read path's own failures carry and the only one a reader
 * can act on.
 */
export function faultPath(err: unknown): string | null {
  if (!isStoreError(err)) return null;
  const path = err.detail["path"];
  return typeof path === "string" && path.length > 0 ? path : null;
}

/**
 * The ROW a store fault is about, when the fault is about one.
 *
 * `faultPath`'s counterpart on this floor. `MEMORY_BODY_MISSING` carries
 * `{ id }` and no path, because there is no file to restore — and doctor's
 * red line named the CLASS and not the row, so every session was down and the
 * owner could not find which of ~17,000 rows to act on (review B, MAJOR-3).
 * An id is the one thing that makes the fault addressable.
 */
export function faultId(err: unknown): string | null {
  if (!isStoreError(err)) return null;
  const id = err.detail["id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Whitespace collapsed: an error message is not this file's to format. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The home directory written `~`, the way every shell writes it.
 *
 * The `HOOK_FAILED` reason is a THIRD-PARTY message — `EACCES: permission
 * denied, mkdir '/Users/…/store/prose'` — and the absolute path in it is both
 * noise and the owner's name on his own screen. Only the prefix is replaced:
 * the rest of the path is what a reader acts on. The full message is still on
 * stderr, verbatim, where a diagnostic belongs.
 */
function tildeHome(text: string, home: string = homedir()): string {
  return home.length > 1 ? text.split(home).join("~") : text;
}

/**
 * THE ONE RED LINE IN THE OWNER'S TERMINAL.
 *
 * Short on purpose. It says the consequence first — memory is off — because that
 * is the fact a person scanning a session start needs, then the reason, then the
 * code a search finds, then the one command that explains the rest. Nothing from
 * a memory ever reaches it: the reason is either this file's own prose or an
 * error message, and error messages in this codebase carry codes, ids and paths.
 */
export function standDownMessage(fault: StandDownFault): string {
  const reason = tildeHome(oneLine(fault.reason));
  const said =
    reason.length <= STANDDOWN_REASON_MAX_CHARS
      ? reason
      : `${reason.slice(0, STANDDOWN_REASON_MAX_CHARS - 1)}…`;
  return `Counterparts memory is OFF for this session: ${said} (${fault.code}). ${STANDDOWN_TAIL}`;
}

/**
 * THE TWO THINGS A BUSY DATABASE SAYS, and neither of them says OFF.
 *
 * A lock at a PROMPT costs that turn: no recall was composed, nothing was
 * captured, and the next turn is very likely fine. A lock at SESSION START
 * costs the whole session's wake — nothing was injected and nothing will be,
 * because SessionStart does not come round again — so it is not a blip and is
 * said the first time it happens. Both are fixed sentences: there is exactly one
 * cause, and an error message adds nothing a reader can act on.
 */
export const BUSY_TURN_MESSAGE =
  "Counterparts skipped this turn: the memory database was busy (database is locked). " +
  "If this keeps happening, run: counterparts doctor";

export const BUSY_SESSION_START_MESSAGE =
  "Counterparts could not load memory at session start: the memory database was busy. " +
  "This session has no wake; recall will work once the database is free. " +
  "If this keeps happening, run: counterparts doctor";

/**
 * HOW MANY SKIPPED TURNS BEFORE "BUSY" STOPS MEANING TEMPORARY.
 *
 * `isLocked` is a test on an error, and an error cannot tell a 40 ms contention
 * from a lock nothing will ever release — a crashed worker, a stale `-shm` a
 * reboot left wedged, a network filesystem. Without this the wedged case is I32
 * again inside the transient branch: one soft line that says it will pass, and
 * then silence for however many turns die. Five is where a run of them stops
 * being a coincidence and is small enough that the owner hears it in the same
 * sitting; nothing downstream depends on the number.
 */
export const TRANSIENT_ESCALATE_AFTER = 5;

/** The escalation, said once. It is allowed to say OFF, because by now it is true. */
export function busyWedgedMessage(count: number): string {
  return (
    `Counterparts has skipped ${String(count)} turns this session: the memory database stays ` +
    "busy (database is locked). Memory is effectively off until that clears. " +
    "Run: counterparts doctor"
  );
}

// ── saying it once per session ──────────────────────────────────────────────

/**
 * WHAT THIS SESSION HAS ALREADY BEEN TOLD, and why it is a file.
 *
 * A store that will not open cannot remember anything, and `UserPromptSubmit`
 * fires every turn — so without a mark the owner would get the same line on
 * every prompt for the rest of the session, which is how a warning becomes
 * wallpaper. The mark therefore has to survive in something that does not need
 * the database: `<dataDir>/sessions/`, where `adapters/sessions.ts` already
 * keeps one small file per session and `adapters/expansions.ts` keeps its own.
 * It is host state, never memory (constitution 5) — an id, times, an event name,
 * a code and two counters.
 *
 * THE TWO KINDS ARE TRACKED APART. A session that met a busy database and then
 * met a store that will not open has learned two different things, and the
 * second has to be said whether or not the first was.
 *
 * Everything here swallows its own failures. An unwritable mark means the
 * message is said again next turn, which is the fail direction this whole track
 * is about: repeating is noise, and silence is I32.
 */
export const STANDDOWN_MARKER_SUFFIX = ".standdown.json";

export interface StandDownMark {
  readonly sessionId: string;
  /** When the last stand-down of this session was recorded, ISO. */
  readonly at: string;
  /** The event and code of that last one — facts, for the durable row (3) owes. */
  readonly event: string;
  readonly code: string;
  /** A PERSISTENT stand-down has been said out loud in this session. */
  readonly told: boolean;
  /**
   * The busy-database story: how many this session has met, when the last one
   * was, whether one has been said, and whether the "this is not passing"
   * escalation has been said. Two flags rather than one, because they are said
   * at two different moments and each is once.
   */
  readonly transient: {
    readonly count: number;
    readonly at: string;
    readonly told: boolean;
    readonly escalated: boolean;
  };
}

export function standDownMarkerPath(dataDir: string, sessionId: string): string | null {
  if (!isSessionId(sessionId)) return null;
  return join(dataDir, SESSIONS_DIR, `${sessionId}${STANDDOWN_MARKER_SUFFIX}`);
}

/**
 * The mark, or null on every failure — absent, unreadable, no store named.
 *
 * TOLERANT OF THE SHAPE BEFORE THIS ONE, which carried no `told` and no
 * `transient`: a file existing at all meant a persistent line had been said, so
 * that is what an absent `told` reads as. A field that is not the type it should
 * be reads as its own zero rather than rejecting the whole record; the worst a
 * wrong guess costs is one repeated line.
 */
export function readMark(dataDir: string | undefined, sessionId: string): StandDownMark | null {
  if (dataDir === undefined || dataDir.length === 0) return null;
  const path = standDownMarkerPath(dataDir, sessionId);
  if (path === null) return null;
  let raw: unknown;
  try {
    // THE WALL, ASKED ON THE READ SIDE TOO. The rule is that this repository's
    // code never touches v1's live stores — not writes them, not reads them —
    // and a `dataDir` reaches this function before anything else has validated
    // it (`Store.open` is what usually throws, and by then we are in the
    // handler). Inside the `try`, so a refusal reads as "no prior mark".
    assertSafeDataDir(dataDir);
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const t = rec["transient"];
  const trans = t !== null && typeof t === "object" ? (t as Record<string, unknown>) : {};
  return {
    sessionId: typeof rec["sessionId"] === "string" ? rec["sessionId"] : sessionId,
    at: typeof rec["at"] === "string" ? rec["at"] : "",
    event: typeof rec["event"] === "string" ? rec["event"] : "",
    code: typeof rec["code"] === "string" ? rec["code"] : "",
    told: rec["told"] === undefined ? true : rec["told"] === true,
    transient: {
      // CLAMPED, and not out of tidiness: a negative count read verbatim
      // suppresses every transient message for the life of the session, so a
      // hand-edited or half-written file could buy back exactly the silence
      // this track exists to end.
      count:
        typeof trans["count"] === "number" && Number.isFinite(trans["count"])
          ? Math.max(0, Math.floor(trans["count"]))
          : 0,
      at: typeof trans["at"] === "string" ? trans["at"] : "",
      told: trans["told"] === true,
      escalated: trans["escalated"] === true,
    },
  };
}

/**
 * Leave the mark. Returns whether it landed; never throws.
 *
 * **It may not write into a store this build refuses to open.** `said.dataDir`
 * is whatever the configuration named, and it is set BEFORE `Store.open` has
 * had a chance to refuse it — so without this line a config naming
 * `~/.bansai/anything` gets a `mkdir -p` and a file through the wall that exists
 * so nothing here can touch v1's live memory (CLAUDE.md's second standing rule).
 * It never fires on the owner's own deployment; it fires for agents, reviewers
 * and replay tooling, which is the population the guard was built for. A refusal
 * costs the mark and nothing else — the message is still shown.
 *
 * **And it is atomic, and does not follow a symlink**, which is `sessions.ts`'s
 * own rule 3 for the same directory: a temp file beside the target and a
 * `rename`, which REPLACES a symlink rather than writing through it, plus a
 * refusal if what is there is not a regular file. Same directory, so the rename
 * is a rename.
 */
export function writeMark(
  dataDir: string | undefined,
  sessionId: string,
  mark: StandDownMark,
): boolean {
  if (dataDir === undefined || dataDir.length === 0) return false;
  const path = standDownMarkerPath(dataDir, sessionId);
  if (path === null) return false;
  const tmp = `${path}.${String(process.pid)}.tmp`;
  try {
    assertSafeDataDir(dataDir);
    // `lstat`, not `stat`: the question is what is AT the path, and a symlink
    // answers for its target under `stat`. Anything but a regular file — a
    // symlink, a directory, a socket — is refused rather than replaced.
    const there = lstatSync(path, { throwIfNoEntry: false });
    if (there !== undefined && !there.isFile()) return false;
    mkdirSync(join(dataDir, SESSIONS_DIR), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(mark)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/** The two events the host DISPLAYS a `systemMessage` on. */
export type SaysSoHook = "session-start" | "user-prompt-submit";

/** What this event should print, and what the session should remember of it. */
export interface SayDecision {
  /** The message to display, or null to stay on stderr alone. */
  readonly message: string | null;
  /** The mark this event leaves. Written whether or not anything was said — a
   *  transient nobody was told about is still one this session has met. */
  readonly mark: StandDownMark;
}

/**
 * WHETHER TO SAY IT, given what this session has already been told. Pure, so the
 * rule is provable without a process and without a filesystem.
 *
 * **Persistent**: SessionStart always says it — a compaction re-fires that event
 * and the owner has just had his terminal rewritten. UserPromptSubmit says it
 * only while the session has not been told.
 *
 * **Transient**: at most once per session, and — at a PROMPT — only from the
 * SECOND one. One blip is noise at the rate a contended database produced before
 * F1's WAL conversion (roughly one prompt in ten, measured 2026-09-18); a repeat
 * inside one session is a signal. The first is recorded in the mark and stays on
 * stderr. SessionStart is the exception and says it the first time: a lock there
 * means no wake was injected at all, and that event does not come round again.
 *
 * **And once more, at `TRANSIENT_ESCALATE_AFTER`.** The soft line tells the owner
 * the database is busy and will clear. When it does not clear — a wedged lock,
 * which no test on an error can tell from a contended one — that sentence is a
 * lie and the silence after it is I32 wearing the transient branch's clothes. So
 * a session that reaches five skipped turns says so once, and that one is
 * allowed to use the word OFF, because by then it is true.
 */
export function decideSay(
  fault: StandDownFault,
  hook: SaysSoHook,
  sessionId: string,
  prior: StandDownMark | null,
  at: number = Date.now(),
): SayDecision {
  const now = new Date(at).toISOString();
  const was = prior?.transient ?? { count: 0, at: "", told: false, escalated: false };
  const base = {
    sessionId,
    at: now,
    event: hook,
    code: fault.code,
    told: prior?.told === true,
    transient: was,
  };
  if (fault.kind === "persistent") {
    const say = hook === "session-start" || !base.told;
    return { message: say ? standDownMessage(fault) : null, mark: { ...base, told: base.told || say } };
  }
  const count = was.count + 1;
  // THE ESCALATION OUTRANKS THE SOFT LINE, and is its own once: a session that
  // has already been told "busy" is exactly the session that must hear it when
  // busy turns out to be permanent.
  if (count >= TRANSIENT_ESCALATE_AFTER && !was.escalated) {
    return {
      message: busyWedgedMessage(count),
      mark: { ...base, transient: { count, at: now, told: true, escalated: true } },
    };
  }
  const say = !was.told && (hook === "session-start" || count >= 2);
  return {
    message: say
      ? hook === "session-start"
        ? BUSY_SESSION_START_MESSAGE
        : BUSY_TURN_MESSAGE
      : null,
    mark: { ...base, transient: { count, at: now, told: was.told || say, escalated: was.escalated } },
  };
}
