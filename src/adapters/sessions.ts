/**
 * The live-session registry — host state, shared by the adapters that need it.
 *
 * **Why it exists.** Measured 2026-09-04 on the live host: Claude Code registers
 * an MCP server from a STATIC configuration (command, args, env), so
 * `mcp/bin/serve.ts` never receives `--session`. Every `session_end` call was
 * therefore refused `no-bound-session` and no session's dump ever landed — the
 * authored front door was shut for the whole run while the ask kept going out.
 * The hooks DO know the session id (the host hands it to every hook); the server
 * does not. This file is the note the hooks leave where the server can read it.
 *
 * **It is host state, never memory** (constitution 5). It carries no content: an
 * id, a scope, three timestamps, and a few marks about what this session's hooks
 * have already done — which configuration they read, which host the session
 * lives in (2026-09-30; absent is Claude Code, `hostOf`), whether the
 * first-launch question went out, the wake's sentinel of counts and whether its
 * arrival has been checked. Losing the whole directory costs a lazy bind and
 * nothing else, which is why `store/paths.ts` classifies it `backup: false`.
 * The writes are the host lifecycle's (`lifecycle.ts`) and the MCP door's.
 *
 * **Claude Desktop's chat writes here through the MCP server itself**
 * (2026-09-30): it has no hooks, so its `wake` tool writes the record (host
 * `claude-desktop`, scope `hosts.ts#DESKTOP_SCOPE`) with the same lifecycle,
 * and every tool call from that session refreshes it (`touchDesktopSession`),
 * because nothing else would. A call that names no session binds to the most
 * recent live Desktop record (`latestLiveSession`).
 *
 * **Who may write up whose session** (the binding shape agreed for build 3,
 * 2026-09-30): a runner's OWN record lists the ended sessions it was launched
 * to write up (`mayWriteUp`), written by the launcher and never by a model
 * (`grantWriteUps`); the MCP door accepts a subject only if it is listed there,
 * has ended, and is owed per `owedWriteUps` — and on that path it stores the
 * memories under the SUBJECT's scope, skipping the runner's own
 * (`mcp/write-up.ts`, `mcp/CONTRACT.md`).
 *
 * **The MCP server leaves one note of its own here** (2026-09-23):
 * `mcp-server@<pid>.json`, the build it was launched with, so the
 * UserPromptSubmit hook — which runs the INSTALLED build every turn — can tell
 * a session its server is out of date (`decideUpdateNotice`, at the bottom).
 *
 * **Where it lives.** `<dataDir>/sessions/<id>.json`, because the data dir is the
 * one path both sides already agree on — the hooks resolve it in
 * `claude-code/bin/hook.ts`, the server in `Counterpart.open`.
 *
 * **Neither adapter imports the other.** `mcp/INTERFACE-GAPS.md` §7 keeps
 * adapters as leaves; a sibling module both may import is the shape that rule
 * allows, and it is the reason this file sits beside them rather than inside
 * `claude-code/`. (True of the libraries; one entry point is the exception
 * today — `mcp/bin/serve.ts` opens its embedder through
 * `claude-code/embed-client.ts`.)
 *
 * Three rules the code below mechanizes:
 *
 *   1. **Nothing here ever throws at a caller.** A hook may not fail the host
 *      (`claude-code/CONTRACT.md` §5 G2) and a tool may not fail on host trivia.
 *      Every entry point returns `null` on any failure.
 *   2. **A session id is a FILENAME, and the MCP path takes it from a model.**
 *      `isSessionId` is the whole gate: one path segment of `[A-Za-z0-9._-]`,
 *      never `.` or `..`. An id that fails it is not looked up at all.
 *   3. **Writes are atomic** — a temp file beside the target, then `rename`,
 *      so a reader never sees half a record. Same directory, so same
 *      filesystem, so the rename is a rename.
 */
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
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { wireChars } from "../core/fit/index.js";

import {
  NO_HOST_EVIDENCE,
  planRetention,
  retentionSources,
} from "../core/remember/index.js";
import type {
  HeldSession,
  HostSessionEvidence,
  RetentionSources,
  Span,
  SpanBuffer,
} from "../core/remember/index.js";
import { isModelId } from "../core/self/index.js";
import { CACHE_SCHEMA_VERSION, SCHEMA_VERSION } from "../core/store/index.js";
import type { Store } from "../core/store/index.js";

import { DEFAULT_HOST, isHostName, isPseudoScope, wordingFor } from "./hosts.js";
import { packagePath } from "./runtime.js";

/** The one directory name. Classified in `store/paths.ts` LAYOUT. */
export const SESSIONS_DIR = "sessions";

/**
 * **CAL.** How long after its last boundary a session may still be claimed.
 *
 * Every Stop refreshes `lastBoundaryAt` — and, since 2026-10-01, every prompt
 * refreshes an existing record too (`claude-code/hooks.ts#userPromptSubmit`) —
 * and the Stop ask is delivered AT
 * a Stop — so this window never has to cover an ordinary session's length, only
 * the gap between an ask and the answer. Four hours is well past any plausible
 * think-time (a session left open over lunch still binds) and comfortably short
 * of a day, so a session that died last night cannot be claimed into today's
 * memory by a server that outlived it.
 */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * **CAL.** How long a record survives at all. Pruned on SessionStart, which is
 * once per session rather than once per turn. A week keeps the run's own
 * forensics readable (constitution 16) while bounding the directory: the files
 * are ~150 bytes and a busy week is a few hundred of them.
 */
export const SESSION_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionPhase = "start" | "boundary" | "end";

export interface SessionRecord {
  readonly sessionId: string;
  /** The project directory the session runs in — the hook's own cwd, resolved. */
  readonly scope: string;
  readonly startedAt: number;
  /** Refreshed at every boundary. Liveness is measured from HERE, not from start. */
  readonly lastBoundaryAt: number;
  /** Set once, by SessionEnd. A record with an end is never live again. */
  readonly endedAt: number | null;
  /**
   * The `claude-code.json` the HOOK that wrote this record read — absolute, and
   * present only when the hook was told (`claude-code/bin/hook.ts` resolves it
   * through `adapters/config-path.ts` and passes it in).
   *
   * It is here because a hook has no way to TELL anyone: its stdout is the
   * model's context and its stderr is a host log nobody reads. "Which config did
   * that hook use" was, until 2026-09-05, unanswerable after the fact — and it
   * is the question behind every "why is my memory empty" on a machine with more
   * than one configuration. Still host state, still no content: a path, beside
   * the id, the scope and the three timestamps.
   */
  readonly config?: string;
  /**
   * TRUE once this session has been asked the first-launch scope question
   * (G41). Set by the SessionStart hook at the moment it puts the block into
   * the model's context, and carried forward like `config`.
   *
   * It is here rather than in the scope registry because it is a fact about ONE
   * SESSION, not about the directory: the registry stays `unset` until somebody
   * answers, and asking twice in a session that resumed or compacted is the
   * thing this flag exists to stop. Still host state, still no content.
   */
  readonly askedScope?: boolean;
  /**
   * THE TAIL SENTINEL THE WAKE WAS PRINTED WITH — the expectation the delivery
   * check compares what arrived against, written by SessionStart at the moment
   * it hands the bundle to the host.
   *
   * It is here because the check runs in a DIFFERENT PROCESS. Every hook is its
   * own process; the expectation used to live in a `Map` on the adapter
   * instance, so the hook that was meant to test it always met an empty one and
   * `adapter.wake.delivered` never wrote a row in two weeks of running.
   *
   * Absent means no checkable wake was printed for this session — a cold start
   * whose bundle is the bootstrap line, or a session whose SessionStart stood
   * down — which is how "nothing was supposed to arrive" is told apart from "it
   * was lost". Still host state, still no content: the sentinel is an HTML
   * comment of counts (`<!-- counterparts:wake/end day=190 identity=3 … -->`),
   * the same numbers the durable row carries.
   */
  readonly wakeSentinel?: string;
  /**
   * TRUE once the delivery check has run for this session. It runs at the first
   * `UserPromptSubmit` and leaves one durable row; this is what keeps it from
   * re-reading the transcript on every turn afterwards. One-way, like
   * `askedScope`.
   */
  readonly wakeChecked?: boolean;
  /**
   * TRUE once this session has been told that the MCP server it is talking to
   * runs an older build than the one installed (`decideUpdateNotice` below,
   * 2026-09-23). One-way, like `askedScope`: the notice is shown once per
   * session and never every turn, and this mark is how a fresh hook process
   * knows it already was. Still host state, still no content.
   */
  readonly updateNoticeShown?: boolean;
  /**
   * WHAT THE HOOK THAT SAW THIS SESSION OPEN WAS RUNNING (2026-09-23, roadmap
   * E): the installed build, and that hook's parent process. Written by
   * whichever hook CREATES the record (`recordSession`), refreshed by
   * SessionStart when the session OPENS (startup, resume, clear, fork — never a
   * compaction, which is the same session carrying on), carried forward like
   * `config`.
   *
   * Its ABSENCE is the point: every record this build creates carries one, so
   * a record without one was written by a build before E — its MCP server may
   * be one that records nothing about itself, and the update notice speaks
   * once rather than stay silent about the one server it cannot see
   * (`decideUpdateNotice`). `hookPpid` is
   * how a person checks the host match: on a host that `exec`s its hooks it is
   * the host itself, the same pid an MCP server it started records as
   * `hostPid`. Still host state, still no content.
   */
  readonly opened?: SessionOpened;
  /**
   * THE DATE THIS SESSION WAS ASKED TO WRITE ITS PAGE ABOUT (2026-09-20, S2),
   * `YYYY-MM-DD`, in the fallback `session` mode of the nightly page writer.
   *
   * It does two jobs, and the second is why it is here rather than only in the
   * store's event log:
   *
   *   - it stops the same session being asked twice, exactly as `askedScope`
   *     does for the first-launch question;
   *   - it is what lets the MCP server write `by: "writer"` rather than
   *     `by: "session"` on the revision that comes back. `by` is the DOOR's and
   *     is not claimable from outside (`self/page.ts`), so the server may not
   *     take the model's word for which door it came through — it reads this
   *     mark, which only the SessionStart hook writes, and which names a date
   *     rather than a boolean so a stale mark cannot re-label tomorrow's write.
   *
   * Still host state, still no content: one date beside the id and the scope.
   *
   * NOTHING WRITES IT since 2026-09-28: the SessionStart writer ask was retired
   * and the writer runs inside the nightly run, whose claim is a store row
   * naming the session (`self/writer.ts#nightClaimFor`). A mark on an older
   * record is still read, and only while its night's claim is open.
   */
  readonly pageWriterFor?: string;
  /**
   * WHEN THIS SESSION LAST ANSWERED THE STOP ASK WITH "NOTHING NEW" (B1,
   * 2026-09-23) — epoch ms, written by the MCP server when `session_end` arrives
   * with `memories: []` and no handoff.
   *
   * "Nothing worth keeping is a real answer", and until now the only trace an
   * answer left was what it minted, so an honest empty answer and no answer at
   * all were the same silence. This is the difference, kept where the next
   * reader of "did this session answer its ask" will look: the owed-a-write-up
   * predicate (roadmap B3/C2) reads it beside the memories and chapters a
   * session wrote. The time rather than a flag, so it can be compared with the
   * ask it answered (`adapter.ask` rows are stamped). Newest wins.
   *
   * It does NOT touch pacing. The pacer advances at ASK time
   * (`self/index.ts#openChapter` commits `askedAtTurns`/`askedAtBytes` before
   * the ask blocks), so an answer of any kind — this one included — can never
   * cause an immediate re-ask; it only has to be recorded.
   *
   * Still host state, still no content: a number.
   */
  readonly nothingNewAt?: number;
  /**
   * THE ENDED SESSION THE SESSIONSTART HOOK POINTED THIS SESSION AT (roadmap
   * C2, 2026-09-23) — written by the hook at the moment it puts the write-up
   * pointer beside the wake. It stops a compaction re-firing SessionStart from
   * pointing again, and it is the MCP door's evidence that this session may
   * FETCH that session's words at all: only the hook writes it, and the model
   * cannot. Carried forward like `config`. Still host state: an id.
   */
  readonly writeUpPointer?: string;
  /**
   * THE PART OF AN ENDED SESSION THIS SESSION FETCHED, and how it answered —
   * written by the MCP door (`mcp/write-up.ts`) into the record's raw JSON when
   * a part is handed over, and again when its answer comes back. A session
   * that fetched nothing cannot write a part up (`not-asked`), and one that has
   * answered its part is not handed another: the rest comes at later starts.
   * Carried forward like `config`. Still host state: an id, a number, a word.
   */
  readonly writeUpFor?: WriteUpFor;
  /**
   * The model that wrote the transcript's last assistant entry, as the host
   * reports it (`claude-opus-5-5`). Refreshed at every boundary, carried like
   * `config`; the `chapter` tool reads it so each chapter records its model.
   * Still host state, still no content: an id.
   */
  readonly model?: string;
  /**
   * HOW THE HOST WAS STARTED, as it says in `CLAUDE_CODE_ENTRYPOINT` (review
   * of #285, N2): `cli` for a person at a terminal; `sdk-cli` for `claude -p`
   * (or any start with no terminal), `sdk-ts` / `sdk-py` for the Agent SDK,
   * `mcp`, `claude-code-github-action`, and others. Read from the 2.1.285 host
   * binary, not from a document: it sets the variable at startup and its
   * children inherit it. Carried like `config`. Absent on a record written
   * before, or by a host that does not set it — which reads as a person's.
   */
  readonly entrypoint?: string;
  /**
   * WHICH HOST THIS SESSION LIVES IN (`hosts.ts`, 2026-09-30): `claude-code`
   * today, written by the host lifecycle (`lifecycle.ts#Lifecycle`) on every
   * record it writes. ABSENT means Claude Code — every record written before
   * the field existed was written by its hooks — and is read that way by
   * `hostOf`, never filled in here, so a record read back is the record that
   * was written. Carried like `entrypoint`. Still host state: one word.
   */
  readonly host?: string;
  /**
   * THE ENDED SESSIONS THIS SESSION WAS LAUNCHED TO WRITE UP (2026-09-30, the
   * binding shape agreed with build 3; desktop-chat design §2). Written by the
   * LAUNCHER — a process that starts a runner session on another session's
   * behalf — through `grantWriteUps`, and never by a tool: a model cannot put
   * an id here. The MCP write-up door reads it off the WRITING session's own
   * record (`mcp/write-up.ts`): a subject listed here, ended, and owed per
   * `owedWriteUps` may be written up from any directory, and its memories are
   * stored under the subject's scope. The same pattern as `pageWriterFor`.
   *
   * Named `mayWriteUp` and not `writeUpFor`, because `writeUpFor` above is
   * already the door's mark of which PART a session fetched. Carried like
   * `config`; the newest grant wins. Still host state: ids.
   */
  readonly mayWriteUp?: readonly string[];
  /**
   * CLAUDE DESKTOP'S WRITE-UP PACER (2026-09-30), on a Desktop session's record
   * only: tool calls since `since`, which is the later of its wake, its last
   * `session_end`/`chapter`, and its last write-up ask. Desktop has no Stop
   * and no transcript, so the ask rides on a tool result once the session has
   * gone `DESKTOP_ASK_CALLS` calls and `DESKTOP_ASK_AFTER_MS` since `since`
   * (`config.ts#TUNABLES`, `touchDesktopSession`). Carried like `config`.
   */
  readonly desk?: DeskPace;
  /**
   * WHEN THIS SESSION LAST HEARD WHAT OTHER DIRECTORIES DID (2026-10-11), for
   * the per-prompt "Since you started" line (`Lifecycle#sinceLine`): `at` is
   * its wake or the last such line shown, and `state` where it is —
   * `woke` (SessionStart just delivered a wake, so the first prompt says
   * nothing), `armed` (the first prompt has passed), `shown` (a line went out
   * at `at`, so none for an hour). Written by the hooks only; carried like
   * `config`, newest wins. Still host state: a number and a word.
   */
  readonly sinceSeen?: SinceSeen;
}

/** Where a session's "Since you started" line stands (`SessionRecord.sinceSeen`). */
export interface SinceSeen {
  readonly at: number;
  readonly state: "woke" | "armed" | "shown";
}

/** Claude Desktop's write-up pacer, as a record keeps it (`SessionRecord.desk`). */
export interface DeskPace {
  /** Tool calls from this session since `since`. */
  readonly calls: number;
  /** Epoch ms: the later of the wake, the last write-up, and the last ask. */
  readonly since: number;
}

/** The host a record belongs to: its own `host`, or — absent, as on every
 *  record written before 2026-09-30 — Claude Code's (`hosts.ts#DEFAULT_HOST`). */
export function hostOf(record: Pick<SessionRecord, "host">): string {
  return record.host ?? DEFAULT_HOST;
}

/**
 * THE HOST ENTRYPOINTS THAT ARE NOT A PERSON'S INTERACTIVE CONVERSATION — a
 * short session started this way owes no one-line write-up (review of #285,
 * N2). Only these names, so an unknown or absent value is treated as a
 * person's, the direction that keeps asking rather than silently skipping.
 */
export const NON_INTERACTIVE_ENTRYPOINTS: ReadonlySet<string> = new Set([
  "sdk-cli",
  "sdk-ts",
  "sdk-py",
  "mcp",
  "claude-code-github-action",
]);

/** A host entrypoint name as the record keeps it: short, one token. */
export function isEntrypoint(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,48}$/.test(value);
}

/** The part of an ended session the MCP door handed a live one. */
export interface WriteUpFor {
  /** The ENDED session whose words were handed over. */
  readonly session: string;
  /** Which part, from 1. */
  readonly part: number;
  /** How the part came back: memories, or "nothing worth keeping" (an empty
   *  batch, which is a real answer on this door too). Absent: not yet. */
  readonly answer?: WriteUpAnswer;
}

export const WRITE_UP_ANSWERS = ["memories", "nothing-new"] as const;
export type WriteUpAnswer = (typeof WRITE_UP_ANSWERS)[number];

/**
 * One path segment, and nothing that could climb out of it. This host's ids are
 * UUIDs; the check is deliberately narrower than "no slashes" because the MCP
 * server passes a MODEL-SUPPLIED string straight into it.
 */
export function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value !== "." &&
    value !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

export function sessionsDir(dataDir: string): string {
  return join(dataDir, SESSIONS_DIR);
}

export function sessionPath(dataDir: string, sessionId: string): string | null {
  if (!isSessionId(sessionId)) return null;
  return join(sessionsDir(dataDir), `${sessionId}.json`);
}

/**
 * The physical path, for comparison. macOS reports `/private/tmp` from
 * `getcwd()` while `os.tmpdir()` says `/tmp`, and a scope comparison that got
 * that wrong would refuse every bind on this host. `realpath` first; `resolve`
 * when the path does not exist (a scope may name a directory this process
 * cannot see). A PSEUDO-SCOPE (`hosts.ts#isPseudoScope`, Claude Desktop's
 * `claude-desktop:`) is a name and comes back as it is: `resolve` would file
 * it under whichever directory each process happened to start in.
 */
export function canonicalScope(scope: string): string {
  if (isPseudoScope(scope)) return scope;
  try {
    return realpathSync(resolve(scope));
  } catch {
    return resolve(scope);
  }
}

/** Same directory, whatever each side's symlinks call it. */
export function sameScope(a: string, b: string): boolean {
  return canonicalScope(a) === canonicalScope(b);
}

/** Not ended, and its last boundary is inside the window. */
export function isLive(
  record: SessionRecord,
  now: number,
  ttlMs: number = SESSION_TTL_MS,
): boolean {
  if (record.endedAt !== null) return false;
  return now - record.lastBoundaryAt <= ttlMs;
}

export function readSession(dataDir: string, sessionId: string): SessionRecord | null {
  const path = sessionPath(dataDir, sessionId);
  if (path === null) return null;
  try {
    return parseRecord(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // Absent, unreadable, or half-written by a host that died mid-rename: all
    // three mean "no live session by that name", which is a refusal upstream.
    return null;
  }
}

/**
 * Record the session at one of its three moments. Returns the record as written,
 * or `null` if anything at all went wrong.
 *
 * The phases are not symmetric, and the asymmetry is the point:
 *
 *   - **`start` owns the scope.** It is the only phase that sets it, so a hook
 *     firing from a git worktree cannot rewrite the scope the server matched
 *     against halfway through a session.
 *   - **`boundary` creates if missing.** Sessions already running when this
 *     ships never saw a SessionStart write; requiring one would leave every
 *     live session unbindable until the owner restarted it.
 *   - **`end` is one-way.** A later boundary refreshes the clock but never
 *     clears `endedAt`: a session the host closed does not come back.
 */
export function recordSession(
  dataDir: string,
  input: {
    sessionId: string;
    scope: string;
    phase: SessionPhase;
    at?: number;
    /** The configuration the writing hook read. Carried forward when a later
     *  phase is written by a process that was told nothing. */
    config?: string;
    /** Set once, when the first-launch scope question is delivered (G41).
     *  Carried forward the same way, and never cleared by a later phase. */
    askedScope?: boolean;
    /** The sentinel the wake was printed with, written by SessionStart.
     *  Carried forward like `config`: the newest answer wins. */
    wakeSentinel?: string;
    /** Set once, when the delivery check has left its row. One-way. */
    wakeChecked?: boolean;
    /** Set once, when the update notice has been shown. One-way. */
    updateNoticeShown?: boolean;
    /** The date the nightly page writer asked this session to write about
     *  (S2). Carried forward like `config`; the newest answer wins. */
    pageWriterFor?: string;
    /** When `session_end` last answered "nothing new" (B1). Carried forward
     *  like `config`; the newest answer wins. */
    nothingNewAt?: number;
    /** The ended session the SessionStart hook pointed this one at (C2).
     *  Carried forward like `config`; the newest answer wins. */
    writeUpPointer?: string;
    /** The model that last answered. Carried like `config`; newest wins. */
    model?: string;
    /** How the host was started (`CLAUDE_CODE_ENTRYPOINT`). Carried like `config`. */
    entrypoint?: string;
    /** Which host the session lives in (`hosts.ts`). Carried like `config`;
     *  never written when nobody names one, so absent still reads as Claude Code. */
    host?: string;
    /** The ended sessions a launcher granted this one (`grantWriteUps`).
     *  Carried like `config`; the newest grant wins. */
    mayWriteUp?: readonly string[];
    /** Claude Desktop's write-up pacer (`touchDesktopSession`). Carried like `config`. */
    desk?: DeskPace;
    /** Where the "Since you started" line stands (`markSinceSeen`). Carried like `config`. */
    sinceSeen?: SinceSeen;
  },
): SessionRecord | null {
  if (!isSessionId(input.sessionId)) return null;
  const path = sessionPath(dataDir, input.sessionId);
  if (path === null) return null;
  const now = input.at ?? Date.now();
  const prior = readSession(dataDir, input.sessionId);

  const record: SessionRecord = {
    sessionId: input.sessionId,
    scope:
      prior === null || input.phase === "start" ? canonicalScope(input.scope) : prior.scope,
    startedAt: prior?.startedAt ?? now,
    lastBoundaryAt: now,
    endedAt:
      input.phase === "end" ? now : input.phase === "start" ? null : (prior?.endedAt ?? null),
    // The record is REWRITTEN whole at every phase, so a field only SessionStart
    // knew would vanish at the first Stop. This one is carried: the newest
    // answer wins, and a phase written by a process that was told nothing keeps
    // what the last one said.
    ...(input.config !== undefined && input.config.length > 0
      ? { config: input.config }
      : prior?.config !== undefined
        ? { config: prior.config }
        : {}),
    // ONE-WAY, like `endedAt`: a session that has been asked has been asked,
    // and a later phase written by a process that knows nothing about the
    // question must not un-ask it.
    ...(input.askedScope === true || prior?.askedScope === true ? { askedScope: true } : {}),
    // Carried like `config` — newest answer wins — because a SessionStart that
    // fires again inside one session (a compaction) renders a new bundle, and
    // the expectation the next check tests has to be the one last printed.
    ...(input.wakeSentinel !== undefined && input.wakeSentinel.length > 0
      ? { wakeSentinel: input.wakeSentinel }
      : prior?.wakeSentinel !== undefined
        ? { wakeSentinel: prior.wakeSentinel }
        : {}),
    // One-way, like `askedScope`: a session that has been checked has been
    // checked, and the flag is what stops the transcript being re-read at every
    // turn for the rest of the session.
    ...(input.wakeChecked === true || prior?.wakeChecked === true ? { wakeChecked: true } : {}),
    // One-way, like `askedScope`: a session that has been told has been told,
    // and a later phase written by a process that knows nothing about the
    // notice must not un-tell it — or it would come back at the next turn.
    ...(input.updateNoticeShown === true || prior?.updateNoticeShown === true
      ? { updateNoticeShown: true }
      : {}),
    // STAMPED WHEN THIS CREATES THE RECORD, carried otherwise (#187 re-review,
    // N1). Whatever phase creates a record — SessionStart, a Stop, the seal,
    // SessionEnd — it is a hook on THIS build that created it, so the record
    // carries this build: "no stamp" then means exactly one thing, a record a
    // build before E wrote, and the update notice may read it that way. A
    // session opening refreshes it (`stampSessionOpened`).
    ...(prior?.opened !== undefined
      ? { opened: prior.opened }
      : prior === null
        ? { opened: { build: installedBuild(), hookPpid: process.ppid, at: now } }
        : {}),
    // Carried like `config` rather than one-way, because it names a DATE: a
    // session that lives across midnight and is asked again gets the new date,
    // and a phase written by a process that knows nothing about the writer
    // keeps the one already there.
    ...(input.pageWriterFor !== undefined && input.pageWriterFor.length > 0
      ? { pageWriterFor: input.pageWriterFor }
      : prior?.pageWriterFor !== undefined
        ? { pageWriterFor: prior.pageWriterFor }
        : {}),
    // Carried like `config`, and it MUST be: every Stop rewrites this record
    // whole, and the Stop right after an answer is the host's re-fire, so a
    // field the hook did not know to carry would be erased within the second.
    ...(input.nothingNewAt !== undefined && Number.isFinite(input.nothingNewAt)
      ? { nothingNewAt: input.nothingNewAt }
      : prior?.nothingNewAt !== undefined
        ? { nothingNewAt: prior.nothingNewAt }
        : {}),
    // Both carried like `config`, and they MUST be: the MCP door reads them
    // after the session has gone on to Stop several times, and every Stop
    // rewrites this record whole (C2). Only the hook writes the pointer; only
    // the door writes `writeUpFor`, into the raw JSON (`markWriteUpFetched`).
    ...(input.writeUpPointer !== undefined && isSessionId(input.writeUpPointer)
      ? { writeUpPointer: input.writeUpPointer }
      : prior?.writeUpPointer !== undefined
        ? { writeUpPointer: prior.writeUpPointer }
        : {}),
    ...(prior?.writeUpFor !== undefined ? { writeUpFor: prior.writeUpFor } : {}),
    // Newest wins, so a /model switch shows at the next boundary.
    ...(isModelId(input.model)
      ? { model: input.model }
      : prior?.model !== undefined
        ? { model: prior.model }
        : {}),
    ...(isEntrypoint(input.entrypoint)
      ? { entrypoint: input.entrypoint }
      : prior?.entrypoint !== undefined
        ? { entrypoint: prior.entrypoint }
        : {}),
    // Carried like `entrypoint`: a phase written by a process that named no
    // host keeps the one already there, and a record nobody named one for has
    // none — which `hostOf` reads as Claude Code.
    ...(isHostName(input.host)
      ? { host: input.host }
      : prior?.host !== undefined
        ? { host: prior.host }
        : {}),
    // Both carried like `config`, and both MUST be: every Stop rewrites the
    // record whole, and a runner's grant has to survive its own hooks.
    ...((): { mayWriteUp?: readonly string[] } => {
      const granted = parseMayWriteUp(input.mayWriteUp);
      if (granted !== null) return { mayWriteUp: granted };
      return prior?.mayWriteUp !== undefined ? { mayWriteUp: prior.mayWriteUp } : {};
    })(),
    ...((): { desk?: DeskPace } => {
      const desk = parseDesk(input.desk);
      if (desk !== null) return { desk };
      return prior?.desk !== undefined ? { desk: prior.desk } : {};
    })(),
    // Carried like `config`, and it MUST be: every prompt rewrites the record
    // whole (`noteSession`) before the line's state is read.
    ...((): { sinceSeen?: SinceSeen } => {
      const seen = parseSinceSeen(input.sinceSeen);
      if (seen !== null) return { sinceSeen: seen };
      return prior?.sinceSeen !== undefined ? { sinceSeen: prior.sinceSeen } : {};
    })(),
  };

  return writeRecord(dataDir, path, record);
}

/** A `mayWriteUp` list, or null: an array whose every entry passes
 *  `isSessionId`, at most 64 of them. Anything else is no grant at all. */
function parseMayWriteUp(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw) || raw.length > 64) return null;
  if (!raw.every((id) => isSessionId(id))) return null;
  return [...new Set(raw as string[])];
}

/** A Desktop pacer, or null: two finite non-negative numbers. */
function parseDesk(raw: unknown): DeskPace | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const calls = d["calls"];
  const since = d["since"];
  if (typeof calls !== "number" || !Number.isSafeInteger(calls) || calls < 0) return null;
  if (typeof since !== "number" || !Number.isFinite(since) || since < 0) return null;
  return { calls, since };
}

/** A "Since you started" state, or null: a finite non-negative time and one of the three words. */
function parseSinceSeen(raw: unknown): SinceSeen | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const at = d["at"];
  const state = d["state"];
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0) return null;
  if (state !== "woke" && state !== "armed" && state !== "shown") return null;
  return { at, state };
}

/**
 * MOVE A SESSION'S "SINCE YOU STARTED" STATE (2026-10-11): into the record's
 * raw JSON (`mergeIntoRecord`), so it moves no clock and erases no field it
 * does not know. The hooks' call only — SessionStart (`woke`) and a prompt
 * (`armed`, `shown`). No record, no mark: false. Never throws.
 */
export function markSinceSeen(dataDir: string, sessionId: string, seen: SinceSeen): boolean {
  if (parseSinceSeen(seen) === null) return false;
  return mergeIntoRecord(dataDir, sessionId, { sinceSeen: { at: seen.at, state: seen.state } });
}

/**
 * GRANT A RUNNER SESSION THE ENDED SESSIONS IT WAS LAUNCHED TO WRITE UP
 * (`SessionRecord.mayWriteUp`). The LAUNCHER's call — a process that starts a
 * session on others' behalf (build 3's headless catch-up run) — and nothing a
 * tool reaches: the MCP server never calls it, so no model can list an id.
 *
 * Onto the runner's record when it exists (into the raw JSON, like every mark
 * a process other than the hooks writes); a record is created, at `scope`, when
 * the launcher writes before the runner's first hook. Returns false on any
 * failure, including a subject that is not an id. Never throws.
 */
export function grantWriteUps(
  dataDir: string,
  input: { runner: string; scope: string; subjects: readonly string[]; at?: number },
): boolean {
  const granted = parseMayWriteUp(input.subjects);
  if (granted === null || !isSessionId(input.runner)) return false;
  try {
    if (readSession(dataDir, input.runner) !== null) {
      return mergeIntoRecord(dataDir, input.runner, { mayWriteUp: granted });
    }
    return (
      recordSession(dataDir, {
        sessionId: input.runner,
        scope: input.scope,
        phase: "start",
        ...(input.at === undefined ? {} : { at: input.at }),
        mayWriteUp: granted,
      }) !== null
    );
  } catch {
    return false;
  }
}

/**
 * EVERY SESSION RECORD IN THE REGISTRY, newest activity first. The MCP
 * server's launch records beside them are not session records and are skipped
 * (`parseRecord` refuses them). Never throws: an unreadable directory is none.
 */
export function listSessions(dataDir: string): SessionRecord[] {
  const out: SessionRecord[] = [];
  let names: string[];
  try {
    names = readdirSync(sessionsDir(dataDir));
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".json") || serverPidOf(name) !== null) continue;
    const id = name.slice(0, -".json".length);
    const record = readSession(dataDir, id);
    if (record !== null && record.sessionId === id) out.push(record);
  }
  return out.sort((a, b) => b.lastBoundaryAt - a.lastBoundaryAt);
}

/**
 * THE HOSTS THIS STORE'S REGISTRY HAS SEEN THIS WEEK (2026-10-01): what a
 * read-only door names as the one that will upgrade an older store
 * (`hosts.ts#upgradeWords`). Empty when the registry holds nothing. Never
 * throws.
 */
export function hostsSeen(dataDir: string): Set<string> {
  try {
    return new Set(listSessions(dataDir).map(hostOf));
  } catch {
    return new Set();
  }
}

/**
 * THE MOST RECENT LIVE SESSION OF ONE HOST — what a Claude Desktop call that
 * names no session binds to (2026-09-30). One server serves every Desktop chat
 * and the wire carries no conversation id, so when the model does not carry
 * the id `wake` gave it, this is the best the server can know; the tool result
 * says it was chosen this way. Null when none is live.
 */
export function latestLiveSession(
  dataDir: string,
  host: string,
  now: number,
  ttlMs: number = SESSION_TTL_MS,
): SessionRecord | null {
  return listSessions(dataDir).find((r) => hostOf(r) === host && isLive(r, now, ttlMs)) ?? null;
}

/**
 * THE SESSION A HOST PROCESS IS RUNNING IN THIS DIRECTORY (2026-10-01,
 * random-f2's items 4 and 12): the one live session record, in `scope`, whose
 * opening hook's parent (`opened.hookPpid`) is `hostPid` — the process that
 * launched the memory server asking. That is the exact match the update
 * notice already uses (`decideUpdateNotice`), read the other way: a server
 * launched with no session finds the one its host is running, so a `note`
 * before the first `chapter` is filed under that session rather than under
 * nobody. EXACT OR NOTHING: none, or more than one live match (a host that
 * ran its hooks through a shell that did not `exec`, two sessions in one host
 * at once), is null, and the note stays unbound as before. Never throws.
 *
 * AND RECENT (review of #311): a pid is reused once its process is gone, so a
 * record whose host crashed could match a stranger. The record must have
 * OPENED — startup, resume, clear, fork each re-stamp it — no earlier than
 * `HOST_MATCH_SLACK_MS` before the server launched (`launchedAt`); one with
 * no time on its stamp (an older build's) is no match.
 */
export const HOST_MATCH_SLACK_MS = 2 * 60_000;

export function sessionOfHost(
  dataDir: string,
  input: { hostPid: number; scope: string; now: number; launchedAt: number; ttlMs?: number },
): string | null {
  try {
    if (!Number.isSafeInteger(input.hostPid) || input.hostPid <= 1) return null;
    const matches = listSessions(dataDir).filter(
      (r) =>
        r.opened?.hookPpid === input.hostPid &&
        r.opened.at !== undefined &&
        r.opened.at >= input.launchedAt - HOST_MATCH_SLACK_MS &&
        hostOf(r) === DEFAULT_HOST &&
        isLive(r, input.now, input.ttlMs ?? SESSION_TTL_MS) &&
        sameScope(r.scope, input.scope),
    );
    return matches.length === 1 ? (matches[0]?.sessionId ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * WHEN CLAUDE DESKTOP LAST WOKE, in box 2's meta (epoch ms, as a string) —
 * written by the MCP server's `wake`, read by doctor's Desktop line. In the
 * store rather than read off the registry, because the registry keeps a week.
 */
export const DESKTOP_WAKE_KEY = "adapter.desktop.wake.at";

/**
 * ONE TOOL CALL FROM A CLAUDE DESKTOP SESSION (2026-09-30): the record's
 * liveness refreshed — nothing else would, with no hooks — and its write-up
 * pacer moved. Returns whether this call carries the write-up ask, or null
 * when the record could not be read or written (the call goes on either way).
 *
 *   - `wroteUp` — a `session_end` or `chapter` that landed: the pacer restarts
 *     from now, and nothing is asked on it;
 *   - otherwise the call is counted, and the ask is DUE when the session has
 *     made `askCalls` calls AND `askAfterMs` has passed since the later of its
 *     wake, its last write-up and its last ask. An ask restarts the pacer too,
 *     so it is not repeated until both arms are met again.
 *
 * All of this only for a call that NAMED the session (`named`): a call bound
 * by the most-recent fallback leaves the record exactly as it was.
 *
 * Only an existing record is touched (`boundary` creates one if missing, and
 * the id reached here from a model): the caller found it live first.
 */
export function touchDesktopSession(
  dataDir: string,
  sessionId: string,
  input: {
    now: number;
    wroteUp: boolean;
    /** False on a call that must not carry the ask (a write-up that was
     *  refused): it is counted, and the ask waits for the next call. */
    mayAsk?: boolean;
    /**
     * Did the call NAME this session (review of #294, finding 1)? Only a call
     * that named it is evidence it came from this session's chat. A call bound
     * by the most-recent fallback may be another chat's, so it touches nothing:
     * no refresh (the "most recent" would flap between chats), no count, no ask.
     * Absent: named.
     */
    named?: boolean;
    askCalls: number;
    askAfterMs: number;
  },
): { ask: boolean; desk: DeskPace } | null {
  const prior = readSession(dataDir, sessionId);
  if (prior === null) return null;
  const pace = prior.desk ?? { calls: 0, since: prior.startedAt };
  if (input.named === false) return { ask: false, desk: pace };
  let desk: DeskPace;
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
    desk,
  });
  return written === null ? null : { ask, desk };
}

/** The atomic write both writers share: a temp sibling, then `rename`. */
function writeRecord(dataDir: string, path: string, record: SessionRecord): SessionRecord | null {
  try {
    mkdirSync(sessionsDir(dataDir), { recursive: true });
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    return null;
  }
  return record;
}

/**
 * MARK A "NOTHING NEW" ANSWER on a session that is already recorded (B1).
 *
 * The one write into this registry that is not a hook's, and deliberately
 * narrower than `recordSession`: it is not a phase, so it moves no clock — an
 * answer is not a boundary, and `lastBoundaryAt` is what liveness is measured
 * from. It never creates a record either: the MCP server only accepts a
 * `session_end` for a session the hooks recorded, so a missing one is a race
 * with pruning, and the honest answer is `null`, not a record with no start.
 */
export function markNothingNew(dataDir: string, sessionId: string, at: number = Date.now()): SessionRecord | null {
  if (sessionPath(dataDir, sessionId) === null || !Number.isFinite(at)) return null;
  // Into the RAW JSON (`mergeIntoRecord`), not a rewrite from the parsed
  // record: the caller is the MCP server — the long-lived process, and so the
  // one most likely to run an older build than the hooks that wrote this
  // record — and its whitelist would erase whatever a newer hook added (#187
  // review, MINOR-1).
  return mergeIntoRecord(dataDir, sessionId, { nothingNewAt: at }) ? readSession(dataDir, sessionId) : null;
}

/**
 * Drop records nobody can claim any more. Called from SessionStart only — one
 * `readdir` per session, never per turn, and never on the SessionEnd path that
 * shares a 1.5 s budget with every other hook on that event.
 *
 * Session records and the notes beside them go by AGE; an MCP server's launch
 * record goes by LIVENESS instead (`serverBelieved`), because what it describes
 * is a process, and a process is either running or not whatever the calendar
 * says.
 */
export function pruneSessions(
  dataDir: string,
  now: number = Date.now(),
  maxAgeMs: number = SESSION_PRUNE_MS,
): number {
  let removed = 0;
  try {
    for (const name of readdirSync(sessionsDir(dataDir))) {
      const full = join(sessionsDir(dataDir), name);
      try {
        // A DIRECTORY IS NEVER PRUNED HERE (review of #359): `log/`,
        // `association/` and `claims/` keep their own contents and their own
        // rules. This used to hold only because `rmSync` without `recursive`
        // throws on a directory, which is not a rule anybody wrote down.
        const st = statSync(full);
        if (st.isDirectory()) continue;
        // A SERVER RECORD is kept for exactly as long as its server is
        // believed alive — its pid running AND its heartbeat fresh
        // (`serverBelieved`) — whatever its age: a session left open for a week
        // still has a server the notice must be able to find. A pid the OS
        // handed to some other process after a hard kill stops being believed
        // once the heartbeat goes stale, and a live server whose record went
        // this way writes it again at its next beat.
        const serverPid = serverPidOf(name);
        if (serverPid !== null) {
          if (serverBelieved(serverPid, st.mtimeMs, now)) continue;
          rmSync(full, { force: true });
          removed += 1;
          continue;
        }
        if (now - st.mtimeMs <= maxAgeMs) continue;
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

// ── the MCP server's launch record, and the update notice (2026-09-23) ──────
//
// A host starts the MCP server ONCE per session and keeps it; the hooks are
// fresh processes at every event. So after an upgrade the hooks run the new
// build and the server keeps the one it loaded (LAUNCH-STATUS I36). The server
// cannot put its build into the SESSION's record at launch — it does not know
// which session it serves until the lazy bind, at the first Stop ask it answers
// (`mcp/server.ts`, refusal 1) — so it leaves its OWN record here, beside the
// session records, and the UserPromptSubmit hook, which does know its session,
// finds it by scope.

/**
 * WHAT A PROCESS WAS BUILT FROM: the package version and the two schema
 * versions its code reads and writes. Two processes sharing one store with
 * different stamps are exactly the pair the notice and the MCP schema gate are
 * about.
 */
export interface BuildStamp {
  /** `package.json#version`, or null when the manifest could not be read. */
  readonly version: string | null;
  /** Box 2's `SCHEMA_VERSION` in the code this process loaded. */
  readonly storeSchema: number;
  /** Box 3's `CACHE_SCHEMA_VERSION` in the code this process loaded. */
  readonly cacheSchema: number;
}

let manifestVersion: string | null | undefined;

/**
 * The package version, from the `package.json` beside this code — the same
 * relative step in the repository and in the installed tarball
 * (`package.json#files` ships `src/` whole). Read once per process and never
 * thrown: a manifest that cannot be read is a null, and a null is never
 * evidence of a change (`sameBuild`).
 */
export function installedVersion(): string | null {
  if (manifestVersion !== undefined) return manifestVersion;
  manifestVersion = manifestVersionOnDisk();
  return manifestVersion;
}

/**
 * The package version ON DISK NOW — the same file, read again rather than
 * remembered. For the one process that has to compare what it loaded with what
 * is installed since: Claude Desktop's MCP server, which is started with the
 * app and has no per-turn hook to run the installed build for it (its `wake`
 * says "Counterparts was updated" when the two differ). Null when unreadable.
 */
export function manifestVersionOnDisk(): string | null {
  try {
    const raw = readFileSync(packagePath("package.json"), "utf8");
    const said = (JSON.parse(raw) as Record<string, unknown>)["version"];
    return typeof said === "string" && said.length > 0 ? said : null;
  } catch {
    return null;
  }
}

/**
 * The build THIS process is running. Both sides call this one function — the
 * server at launch, the hook every turn — so the two stamps cannot differ in
 * shape, only in value.
 */
export function installedBuild(): BuildStamp {
  return {
    version: installedVersion(),
    storeSchema: SCHEMA_VERSION,
    cacheSchema: CACHE_SCHEMA_VERSION,
  };
}

/** Same build, as far as either side can tell. An unreadable version on either
 *  side is not a mismatch; the two schema numbers always are. */
export function sameBuild(a: BuildStamp, b: BuildStamp): boolean {
  const versionMoved = a.version !== null && b.version !== null && a.version !== b.version;
  return !versionMoved && a.storeSchema === b.storeSchema && a.cacheSchema === b.cacheSchema;
}

/**
 * The remedy, spelled once: the notice ends with it and so does the MCP
 * schema gate's refusal (`mcp/server.ts#STALE_SERVER_REFUSAL`). It is Claude
 * Code's words — `/mcp` is its command — so since 2026-09-30 it is read from
 * that host's entry in the wording table (`hosts.ts`), where another host
 * keeps its own; the text is unchanged.
 */
export const RECONNECT_REMEDY = wordingFor(DEFAULT_HOST).reconnect;

/** The owner's words (2026-09-23), shown once per session, never every turn. */
export const UPDATE_NOTICE = `Counterparts was updated. ${RECONNECT_REMEDY}`;

/**
 * The same line for the other direction — the INSTALLED build is older than
 * the server's, which is a downgrade or a rollback. `sameBuild` cannot tell
 * the two apart; `serverIsNewer` can, and "was updated" would be untrue.
 */
export const CHANGED_NOTICE = `Counterparts was changed to an older version. ${RECONNECT_REMEDY}`;

/** A plain `x.y.z` compare; anything else is "not newer". */
export function versionNewer(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const pa = /^(\d+)\.(\d+)\.(\d+)$/.exec(a);
  const pb = /^(\d+)\.(\d+)\.(\d+)$/.exec(b);
  if (pa === null || pb === null) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Is `server` a NEWER build than `installed` — a downgrade, seen from here? */
export function serverIsNewer(server: BuildStamp, installed: BuildStamp): boolean {
  return (
    server.storeSchema > installed.storeSchema ||
    server.cacheSchema > installed.cacheSchema ||
    versionNewer(server.version, installed.version)
  );
}

/**
 * What SessionStart stamps on a session that OPENS (`SessionRecord.opened`).
 */
export interface SessionOpened {
  readonly build: BuildStamp;
  /** The stamping hook's parent process — the host, on a host that `exec`s
   *  its hooks. Compare with a server record's `hostPid`. */
  readonly hookPpid: number;
  /** When it was stamped (2026-10-01): a host pid alone outlives its process
   *  (a crash, then pid reuse), so a match also needs the open to be recent
   *  against the server's launch (`sessionOfHost`). Absent on older records. */
  readonly at?: number;
}

function parseBuild(raw: unknown): BuildStamp | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const version = b["version"] ?? null;
  const storeSchema = b["storeSchema"];
  const cacheSchema = b["cacheSchema"];
  if (version !== null && typeof version !== "string") return null;
  if (typeof storeSchema !== "number" || !Number.isInteger(storeSchema)) return null;
  if (typeof cacheSchema !== "number" || !Number.isInteger(cacheSchema)) return null;
  return { version, storeSchema, cacheSchema };
}

function parseOpened(raw: unknown): SessionOpened | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const build = parseBuild(o["build"]);
  const hookPpid = o["hookPpid"];
  if (build === null || typeof hookPpid !== "number" || !Number.isSafeInteger(hookPpid)) return null;
  const at = o["at"];
  return { build, hookPpid, ...(typeof at === "number" && Number.isFinite(at) ? { at } : {}) };
}

/**
 * MERGE FIELDS INTO A SESSION RECORD AS IT IS ON DISK — the raw JSON, never the
 * parsed record.
 *
 * `recordSession` rewrites a record whole from `parseRecord`'s whitelist, which
 * is right for the hooks: they are always the newest code, so their whitelist
 * is the newest one. A write from anywhere else must not do that — a process
 * running an older build (the unrestarted MCP server above all) would erase
 * every field a newer hook had added. So a mark is a merge into the object as
 * found: known and unknown fields alike survive it. Only a file that parses as
 * a session record is written; nothing is created. Atomic; never throws.
 *
 * **NOT LOCKED, and that is accepted.** Every writer of a session record — the
 * hooks' `recordSession`, these marks, the MCP server's `markNothingNew` — is
 * a read-modify-write with an atomic rename at the end and no lock around it.
 * Two writers that interleave (a Stop rewriting the record while the server
 * marks `nothingNewAt`, a prompt marking `updateNoticeShown` in the same
 * instant) can lose the field the slower one did not read. The consequence is
 * bounded to that one field: an update notice shown a second time, a
 * `nothingNewAt` missing from one answer, a stamp missing until the next
 * open. The hook events of one session are sequential and the server's writes
 * follow a Stop, so the window is a coincidence of two processes within
 * milliseconds — the same class every field in this record has lived with
 * since the registry was written (#187 review, MINOR-1).
 */
function mergeIntoRecord(
  dataDir: string,
  sessionId: string,
  fields: Record<string, unknown>,
  drop: readonly string[] = [],
): boolean {
  const path = sessionPath(dataDir, sessionId);
  if (path === null) return false;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parseRecord(raw) === null) return false;
    const merged: Record<string, unknown> = { ...(raw as Record<string, unknown>), ...fields };
    for (const key of drop) delete merged[key];
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(merged)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * SessionStart's stamp, on a session that OPENS: the installed build and the
 * hook's parent pid (`SessionRecord.opened`). Merged into the record the same
 * event just wrote; never creates one. Never throws.
 *
 * It also CLEARS `updateNoticeShown` (#187 re-review, N3): an open is often a
 * new host process and so a new MCP server — a session `--resume`d onto a
 * fresh host has not been told about THAT server, and the mark from the last
 * one must not keep it silent. An in-process `/resume` keeps its server, so a
 * stale one there is announced once more — the same accepted cost as `/clear`.
 */
export function stampSessionOpened(dataDir: string, sessionId: string, opened: SessionOpened): boolean {
  return mergeIntoRecord(dataDir, sessionId, { opened }, ["updateNoticeShown"]);
}

/**
 * One running MCP server, as it described itself at launch. Host state, no
 * content: two process ids, a directory, a time and three version numbers.
 */
export interface ServerRecord {
  readonly pid: number;
  /**
   * The server's PARENT at launch — the host process that started it. A hook
   * whose own parent is the same process belongs to the same host instance,
   * and so to the session this server serves; that is the exact match. When
   * the host ran the hook through a shell that did not `exec`, the parents
   * differ and the scope is the match instead (`decideUpdateNotice`).
   */
  readonly hostPid: number;
  /** The server's scope, canonical — the same string its lazy bind compares. */
  readonly scope: string;
  readonly startedAt: number;
  readonly build: BuildStamp;
}

/** A server record as read, with the file's mtime — its last heartbeat. */
export type ServerRecordRead = ServerRecord & { readonly refreshedAt: number };

/**
 * **CAL.** How often a running server touches its record
 * (`mcp/server.ts#recordLaunch`), and how old a record may be and still be
 * believed. The pair is what pins a record to the PROCESS that wrote it, not
 * just to a pid: after a hard kill the OS may hand the pid to anything, and
 * `pidAlive` alone would then believe the record — kept by `pruneSessions` and
 * compared by every new session in that directory — for as long as the
 * stranger ran. Ten beats of slack, so a laptop that slept does not lose its
 * servers for more than one beat after waking (the server writes its record
 * again if it was pruned meanwhile).
 */
export const SERVER_HEARTBEAT_MS = 60_000;
export const SERVER_STALE_MS = 10 * SERVER_HEARTBEAT_MS;

/** Pid running AND heartbeat fresh. */
export function serverBelieved(pid: number, refreshedAt: number, now: number, alive: (pid: number) => boolean = pidAlive): boolean {
  return now - refreshedAt <= SERVER_STALE_MS && alive(pid);
}

/**
 * `sessions/mcp-server@<pid>.json`. The `@` is deliberate: it is outside
 * `isSessionId`'s alphabet, so no session id — and no string a model passes to
 * `session_end` — can ever name this file.
 */
const SERVER_RECORD_PREFIX = "mcp-server@";

export function serverRecordPath(dataDir: string, pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  return join(sessionsDir(dataDir), `${SERVER_RECORD_PREFIX}${String(pid)}.json`);
}

/** The pid a directory entry names, when it is a server record; else null. */
function serverPidOf(name: string): number | null {
  if (!name.startsWith(SERVER_RECORD_PREFIX) || !name.endsWith(".json")) return null;
  const digits = name.slice(SERVER_RECORD_PREFIX.length, -".json".length);
  if (!/^[1-9][0-9]*$/.test(digits)) return null;
  const pid = Number(digits);
  return Number.isSafeInteger(pid) ? pid : null;
}

/**
 * Is that process still running? Signal 0 delivers nothing and only asks.
 * `EPERM` is a process that exists and is somebody else's — alive.
 */
export function pidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: unknown } | null)?.code === "EPERM";
  }
}

function writeServerRecord(path: string, record: ServerRecord): boolean {
  try {
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Leave the launch record. Atomic like `recordSession`, and never throws: a
 * server whose record did not land costs this session its notice and nothing
 * else.
 */
export function recordServerLaunch(
  dataDir: string,
  input: {
    scope: string;
    build: BuildStamp;
    pid?: number;
    hostPid?: number;
    at?: number;
  },
): ServerRecord | null {
  const pid = input.pid ?? process.pid;
  const path = serverRecordPath(dataDir, pid);
  if (path === null) return null;
  const record: ServerRecord = {
    pid,
    hostPid: input.hostPid ?? process.ppid,
    scope: canonicalScope(input.scope),
    startedAt: input.at ?? Date.now(),
    build: input.build,
  };
  try {
    mkdirSync(sessionsDir(dataDir), { recursive: true });
  } catch {
    return null;
  }
  return writeServerRecord(path, record) ? record : null;
}

/**
 * THE HEARTBEAT: touch the record, or write it again if a SessionStart pruned
 * it while this process was asleep. Never creates a directory — a data dir
 * that went away (a test's temp dir, a store moved aside) is not recreated by
 * a timer. Never throws.
 */
export function refreshServerLaunch(dataDir: string, record: ServerRecord, now: number = Date.now()): boolean {
  const path = serverRecordPath(dataDir, record.pid);
  if (path === null) return false;
  try {
    const at = new Date(now);
    utimesSync(path, at, at);
    return true;
  } catch {
    try {
      if (!statSync(sessionsDir(dataDir)).isDirectory()) return false;
    } catch {
      return false;
    }
    return writeServerRecord(path, record);
  }
}

/** Take the record away at a clean exit. Best-effort: a server the host
 *  killed outright leaves its file, which stops being believed when its pid
 *  dies or its heartbeat goes stale, and is pruned at the next SessionStart. */
export function forgetServerLaunch(dataDir: string, pid: number = process.pid): void {
  const path = serverRecordPath(dataDir, pid);
  if (path === null) return;
  try {
    rmSync(path, { force: true });
  } catch {
    /* nothing to say about a file that will not go */
  }
}

/** Every server record that parses, believed or not. Never throws. */
export function readServerRecords(dataDir: string): ServerRecordRead[] {
  const out: ServerRecordRead[] = [];
  let names: string[];
  try {
    names = readdirSync(sessionsDir(dataDir));
  } catch {
    return out;
  }
  for (const name of names) {
    const pid = serverPidOf(name);
    if (pid === null) continue;
    try {
      const full = join(sessionsDir(dataDir), name);
      const rec = parseServerRecord(JSON.parse(readFileSync(full, "utf8")));
      if (rec !== null && rec.pid === pid) out.push({ ...rec, refreshedAt: statSync(full).mtimeMs });
    } catch {
      continue;
    }
  }
  return out;
}

function parseServerRecord(raw: unknown): ServerRecord | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const pid = rec["pid"];
  const hostPid = rec["hostPid"];
  const scope = rec["scope"];
  const startedAt = rec["startedAt"];
  const build = parseBuild(rec["build"]);
  if (typeof pid !== "number" || !Number.isSafeInteger(pid)) return null;
  if (typeof hostPid !== "number" || !Number.isSafeInteger(hostPid)) return null;
  if (typeof scope !== "string" || scope.length === 0) return null;
  if (typeof startedAt !== "number") return null;
  if (build === null) return null;
  return { pid, hostPid, scope, startedAt, build };
}

/** Why the notice is, or is not, due this turn — for the hook's stderr line. */
export type UpdateNoticeReason =
  /** No session record: there is nowhere to mark "shown", so nothing is due
   *  rather than something said every turn. */
  | "no-record"
  | "already-shown"
  /** No live server in this session's scope, and the session was stamped when
   *  it opened — so its server, if it has one, is one that records itself. */
  | "no-server"
  | "current"
  /** A server this session may be talking to runs another build — or the
   *  session opened before any build stamped it (`matchedBy: "unstamped"`). */
  | "due"
  /** Anything that threw. The turn goes on exactly as it would have. */
  | "failed";

export interface UpdateNoticeDecision {
  /** The line to show, or null. Non-null exactly when `reason` is `due`. */
  readonly message: string | null;
  readonly reason: UpdateNoticeReason;
  /**
   * What decided it: `host` — the servers this hook's own host process
   * started; `unstamped` — none of those, and the session opened before any
   * build stamped it; `scope` — every live server in the scope.
   */
  readonly matchedBy: "host" | "unstamped" | "scope" | null;
  readonly servers: number;
  /** The hook parent the host match was tried against. */
  readonly hookPpid: number;
}

/**
 * IS "Counterparts was updated" DUE THIS TURN? — decided by a hook running the
 * INSTALLED build, which is the whole point: it is the one process that knows
 * what "current" is. It WRITES NOTHING; `markUpdateNoticeShown` is the other
 * half, and the caller marks only once the line is actually on its way.
 *
 * In order:
 *
 *   1. The believed servers (`serverBelieved`) in this session's scope that
 *      THIS hook's host started (`hostPid` = the hook's parent) are the exact
 *      answer when there are any: due if any runs another build.
 *   2. Otherwise, a session that OPENED before any build stamped it
 *      (`SessionRecord.opened` absent) is due, once: its server was started
 *      then too, and may be one that records nothing about itself — the case
 *      of the upgrade that installs this code (MAJOR-1 of #187's review).
 *   3. Otherwise every believed server in the scope, and ANY stale one makes
 *      it due. This can speak once to a session whose own server is current
 *      while a second session in the same directory runs an old one; the
 *      advice is harmless, and it never stays silent about this session's.
 *
 * A downgrade gets `CHANGED_NOTICE` rather than "was updated". Never throws;
 * `failed` is a reason like any other.
 */
export function decideUpdateNotice(
  dataDir: string,
  input: {
    sessionId: string;
    installed: BuildStamp;
    /** This hook's parent process. Defaults to `process.ppid`. */
    hostPid?: number;
    /** Injected so a test can say which pids are running. */
    alive?: (pid: number) => boolean;
    now?: number;
  },
): UpdateNoticeDecision {
  const hookPpid = input.hostPid ?? process.ppid;
  const quiet = (
    reason: UpdateNoticeReason,
    matchedBy: UpdateNoticeDecision["matchedBy"] = null,
    servers = 0,
  ): UpdateNoticeDecision => ({ message: null, reason, matchedBy, servers, hookPpid });
  const due = (
    compared: readonly ServerRecord[],
    matchedBy: NonNullable<UpdateNoticeDecision["matchedBy"]>,
  ): UpdateNoticeDecision => ({
    message: compared.some((s) => serverIsNewer(s.build, input.installed)) ? CHANGED_NOTICE : UPDATE_NOTICE,
    reason: "due",
    matchedBy,
    servers: compared.length,
    hookPpid,
  });
  try {
    const record = readSession(dataDir, input.sessionId);
    if (record === null) return quiet("no-record");
    if (record.updateNoticeShown === true) return quiet("already-shown");
    const now = input.now ?? Date.now();
    const alive = input.alive ?? pidAlive;
    const live = readServerRecords(dataDir).filter(
      (s) => sameScope(s.scope, record.scope) && serverBelieved(s.pid, s.refreshedAt, now, alive),
    );
    const own = live.filter((s) => s.hostPid === hookPpid);
    if (own.length > 0) {
      return own.every((s) => sameBuild(s.build, input.installed)) ? quiet("current", "host", own.length) : due(own, "host");
    }
    if (record.opened === undefined) return due([], "unstamped");
    if (live.length === 0) return quiet("no-server");
    return live.every((s) => sameBuild(s.build, input.installed)) ? quiet("current", "scope", live.length) : due(live, "scope");
  } catch {
    return quiet("failed");
  }
}

/**
 * THE ONCE-PER-SESSION MARK. The caller writes it when the line is on its way
 * and SHOWS the line only if this returns true — so a mark that will not write
 * is silence rather than a notice every turn (the owner asked for a notice, not
 * a nag), and a line that could not be carried is never marked as shown.
 *
 * A merge into the record's raw JSON (`mergeIntoRecord`), so it moves no clock
 * and erases no field it does not know. No record, no mark. Never throws.
 */
export function markUpdateNoticeShown(dataDir: string, sessionId: string): boolean {
  try {
    const record = readSession(dataDir, sessionId);
    if (record === null) return false;
    if (record.updateNoticeShown === true) return true;
    return mergeIntoRecord(dataDir, sessionId, { updateNoticeShown: true });
  } catch {
    return false;
  }
}

function parseRecord(raw: unknown): SessionRecord | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const sessionId = rec["sessionId"];
  const scope = rec["scope"];
  const startedAt = rec["startedAt"];
  const lastBoundaryAt = rec["lastBoundaryAt"];
  const endedAt = rec["endedAt"] ?? null;
  if (!isSessionId(sessionId)) return null;
  if (typeof scope !== "string" || scope.length === 0) return null;
  if (typeof startedAt !== "number" || typeof lastBoundaryAt !== "number") return null;
  if (endedAt !== null && typeof endedAt !== "number") return null;
  // Optional, and never a reason to reject a record: every record written before
  // 2026-09-05 lacks it, and a registry that refused those would refuse every
  // live session on the owner's host at the moment this ships.
  const config = rec["config"];
  return {
    sessionId,
    scope,
    startedAt,
    lastBoundaryAt,
    endedAt,
    ...(typeof config === "string" && config.length > 0 ? { config } : {}),
    // Optional for the same reason `config` is: every record written before
    // 2026-09-10 lacks it, and "not asked" is exactly what its absence means.
    ...(rec["askedScope"] === true ? { askedScope: true } : {}),
    // Optional for the same reason again, and its absence is a real answer:
    // "no checkable wake was printed for this session".
    ...(typeof rec["wakeSentinel"] === "string" && rec["wakeSentinel"].length > 0
      ? { wakeSentinel: rec["wakeSentinel"] }
      : {}),
    ...(rec["wakeChecked"] === true ? { wakeChecked: true } : {}),
    // Optional for the same reason as `askedScope`, and its absence means
    // exactly "not told yet".
    ...(rec["updateNoticeShown"] === true ? { updateNoticeShown: true } : {}),
    // Optional, and its absence is the answer the notice reads: "opened before
    // any build stamped it". A malformed one reads as absent.
    ...((): { opened?: SessionOpened } => {
      const opened = parseOpened(rec["opened"]);
      return opened === null ? {} : { opened };
    })(),
    // Optional for the same reason, and read as a DATE rather than a flag: a
    // value that is not a date is no mark at all, so a hand-edited record
    // cannot talk the MCP server into writing `by: "writer"`.
    ...(typeof rec["pageWriterFor"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec["pageWriterFor"])
      ? { pageWriterFor: rec["pageWriterFor"] }
      : {}),
    // Optional for the same reason; a value that is not a finite number is no
    // mark at all.
    ...(typeof rec["nothingNewAt"] === "number" && Number.isFinite(rec["nothingNewAt"])
      ? { nothingNewAt: rec["nothingNewAt"] }
      : {}),
    // Optional for the same reason; a malformed one is no mark at all, so a
    // hand-edited record cannot talk the MCP door into accepting a write-up.
    ...(isSessionId(rec["writeUpPointer"]) ? { writeUpPointer: rec["writeUpPointer"] } : {}),
    ...((): { writeUpFor?: WriteUpFor } => {
      const writeUpFor = parseWriteUpFor(rec["writeUpFor"]);
      return writeUpFor === null ? {} : { writeUpFor };
    })(),
    // A value that is not a plain model id is no mark: it goes into a heading.
    ...(isModelId(rec["model"]) ? { model: rec["model"] } : {}),
    ...(isEntrypoint(rec["entrypoint"]) ? { entrypoint: rec["entrypoint"] } : {}),
    // Optional for the same reason, and its absence is NOT filled in here: a
    // record with no host is Claude Code's, and `hostOf` is where that is said.
    ...(isHostName(rec["host"]) ? { host: rec["host"] } : {}),
    // Optional for the same reason; a malformed grant is no grant at all, so a
    // hand-edited record cannot talk the write-up door into anything.
    ...((): { mayWriteUp?: readonly string[] } => {
      const granted = parseMayWriteUp(rec["mayWriteUp"]);
      return granted === null ? {} : { mayWriteUp: granted };
    })(),
    ...((): { desk?: DeskPace } => {
      const desk = parseDesk(rec["desk"]);
      return desk === null ? {} : { desk };
    })(),
    ...((): { sinceSeen?: SinceSeen } => {
      const seen = parseSinceSeen(rec["sinceSeen"]);
      return seen === null ? {} : { sinceSeen: seen };
    })(),
  };
}

/** A `writeUpFor` mark, or null: an id that passes `isSessionId` and a part
 *  that is a positive integer. Anything else is no mark. */
function parseWriteUpFor(raw: unknown): WriteUpFor | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const w = raw as Record<string, unknown>;
  const session = w["session"];
  const part = w["part"];
  if (!isSessionId(session)) return null;
  if (typeof part !== "number" || !Number.isSafeInteger(part) || part < 1) return null;
  const answer = w["answer"];
  return (WRITE_UP_ANSWERS as readonly unknown[]).includes(answer)
    ? { session, part, answer: answer as WriteUpAnswer }
    : { session, part };
}

/**
 * THE DOOR'S MARK on the WRITING session's record (C2): which part of which
 * ended session it was handed, and — once it comes back — how it was answered.
 * Into the RAW JSON (`mergeIntoRecord`), like every mark a process other than
 * the hooks writes, so a field a newer hook added survives it. Never creates a
 * record: the writing session is bound, so its record exists. Never throws.
 */
export function markWriteUpFetched(dataDir: string, sessionId: string, writeUpFor: WriteUpFor): boolean {
  if (parseWriteUpFor(writeUpFor) === null) return false;
  return mergeIntoRecord(dataDir, sessionId, {
    writeUpFor: {
      session: writeUpFor.session,
      part: writeUpFor.part,
      ...(writeUpFor.answer === undefined ? {} : { answer: writeUpFor.answer }),
    },
  });
}

// ── the next-session write-up (roadmap C2, 2026-09-23) ──────────────────────
//
// A session that ended before it was written up is written up by the NEXT
// session in its project: the SessionStart hook (`claude-code/hooks.ts`, through `lifecycle.ts#deliverWriteUpAsk`) hands
// the live assistant the ended session's captured words, and the MCP server's
// door (`mcp/write-up.ts`) takes the memories back and marks the old session
// written up. Two adapters, and neither imports the other — so the facts they
// both decide on live HERE, in the one sibling both may import, and are read by
// both through the same functions. If the ask and the door disagreed about
// which sessions owe, the hook would hand over a session the door refuses, at
// every start, for ever.
//
// What "owes" means is NOT decided here. It is `core/coverage/`'s rule
// (2026-09-30), read through `remember/owes.ts#planRetention`; this file only
// gathers the host's half of the facts — whether the registry holds a session
// open, and when it ended — and adds which project a session belongs to.

/**
 * What an `adapter.ask` row's `turns` counts, stamped on every row since
 * 2026-09-24: typed turns. A row without it counted both roles' text pieces,
 * so only its bytes are read.
 */
export const ASK_ROW_COUNTING = "typed";

/**
 * WHAT THIS HOST KNOWS ABOUT A SESSION, for `remember/owes.ts`: its registry
 * record — open, or ended and when. Never throws; a record that will not read
 * reads as open, the fact that KEEPS text.
 *
 * Moved here from `claude-code/bin/runner.ts` (C2) so the retention pass, the
 * SessionStart ask and the MCP door read ONE definition of the host's facts;
 * the runner re-exports it under its old name, `retentionHost`. Until
 * 2026-09-30 it also read the `adapter.ask` rows and the "nothing new" mark,
 * for the asked / answered rule `coverage/` replaced.
 */
export function hostSessionEvidence(store: Pick<Store, "dir">): (session: string) => HostSessionEvidence {
  const dir = store.dir;
  return (session) => registryFacts(dir, session);
}

/**
 * The registry's word on one session. A record with no end is OPEN — never
 * deleted (PR #189 review m10). A record that exists but will not read is
 * treated as open too: it may be a live session's, and the safe reading of
 * "cannot tell" is "keep".
 */
function registryFacts(dir: string, session: string): HostSessionEvidence {
  const path = sessionPath(dir, session);
  if (path === null || !existsSync(path)) return NO_HOST_EVIDENCE;
  const rec = readSession(dir, session);
  if (rec === null) return { open: true, endedAt: null };
  return { open: rec.endedAt === null, endedAt: rec.endedAt };
}

/**
 * THE SOURCES `remember/owes.ts` DECIDES ON, as this host supplies them. The
 * retention pass and the write-up both build theirs here, so "what may be
 * deleted" and "what the next session is asked to write" are read off one set
 * of facts (B3's rule, kept by construction).
 */
export function writeUpSources(store: Store, clocks: { retentionMs?: number; maxMs?: number } = {}): RetentionSources {
  // The clocks change only WHEN text goes, never what is owed — so the
  // write-up's readers may leave them at the defaults, and the retention pass
  // hands over the configuration's (`config.ts#retentionClocks`).
  return retentionSources(store, { host: hostSessionEvidence(store), ...clocks });
}

/** Every session the store holds text for, judged by `remember/owes.ts`. Read-only. */
export function writeUpPlan(input: { store: Store; spans: SpanBuffer }): HeldSession[] {
  return planRetention(input.spans, writeUpSources(input.store));
}

/**
 * IS THIS SESSION STILL AT WORK, for the write-up — the ledger's `active`:
 * it captured something today and has not ended (`core/coverage/`). A session
 * left open overnight is not; nor is one that ended an hour ago. No silence
 * window: the 12-hour rule this replaced (PR #192 review, MAJOR 3) is gone
 * with the asked / answered predicate it guarded.
 */
function atWork(h: HeldSession): boolean {
  return h.facts.state === "active";
}

/**
 * A SMALL debt the pointer may offer: known to the registry, a person's
 * interactive conversation (not `claude -p`, not the Agent SDK — the record's
 * `entrypoint`, review of #285 N2). A small stretch from anything else owes
 * all the same and lapses with its days of use.
 */
function smallWriteUpDue(h: HeldSession, dataDir: string): boolean {
  return h.small && pointable(h, dataDir);
}

/**
 * CAN THE POINTER EVER OFFER THIS DEBT? A full one, always; a small one only
 * as `smallWriteUpDue` says. Doctor's count reads it, so a debt the pointer
 * will never name is not reported as one waiting for it (review of #289).
 */
export function pointable(h: { readonly session: string; readonly small: boolean }, dataDir: string): boolean {
  if (!h.small) return true;
  const path = sessionPath(dataDir, h.session);
  if (path === null || !existsSync(path)) return false;
  const entrypoint = readSession(dataDir, h.session)?.entrypoint;
  return entrypoint === undefined || !NON_INTERACTIVE_ENTRYPOINTS.has(entrypoint);
}

/**
 * THE SCOPE-FREE HALF OF "WAITING FOR A WRITE-UP", one definition for the
 * pointer, the door and doctor's count: it owes a write-up that is not small.
 * (Its owing already means it is not at work.)
 */
export function waitingForWriteUp(h: HeldSession): boolean {
  return h.owes && !h.small;
}

/**
 * WHERE ONE SESSION STANDS for a write-up by a session in `scope` — the door's
 * refusals by name, and the pointer's filter. One function, both callers.
 *
 *   - `unknown-session` — not an id, or no registry record and no text anywhere;
 *   - `live-session` — it is still at work (the ledger's `active`), or it is
 *     the asking session itself;
 *   - `other-project` — it holds no words in THIS project. A session is written
 *     up where its words are: one that left words under two projects is
 *     written up in each by a session there, and neither is served the other's
 *     (MAJOR 6);
 *   - `already-written-up` — marked through the seam at or after its last
 *     words, or this project's share of it is done and another project's is
 *     not (`waiting` in the progress record);
 *   - `owes-nothing` — `coverage/`'s rule says so: written up (`answered`),
 *     under the floor (`below-threshold`), lapsed (`lapsed`), or no text;
 *   - `owed`, with `here`: the buffer's own spelling of this project's scope,
 *     and `short` when what it owes is small — one line is enough.
 */
export type WriteUpStanding =
  | { readonly status: "owed"; readonly held: HeldSession; readonly here: string; readonly short: boolean }
  | { readonly status: "unknown-session" }
  | { readonly status: "live-session" }
  | { readonly status: "other-project" }
  | { readonly status: "already-written-up" }
  | { readonly status: "owes-nothing"; readonly why: "below-threshold" | "answered" | "lapsed" | "no-text" };

export function writeUpStanding(
  plan: readonly HeldSession[],
  dataDir: string,
  session: string,
  scope: string,
  _now: number,
  opts: { progress?: Readonly<Record<string, WriteUpProgress>> } = {},
): WriteUpStanding {
  if (!isSessionId(session)) return { status: "unknown-session" };
  const held = plan.find((h) => h.session === session);
  const path = sessionPath(dataDir, session);
  const exists = path !== null && existsSync(path);
  if (!exists && held === undefined) return { status: "unknown-session" };
  if (held === undefined) {
    const record = readSession(dataDir, session);
    return record !== null && sameScope(record.scope, scope)
      ? { status: "owes-nothing", why: "no-text" }
      : { status: "other-project" };
  }
  if (atWork(held)) return { status: "live-session" };
  const here = held.scopes.find((x) => sameScope(x, scope));
  if (here === undefined) return { status: "other-project" };
  if (held.facts.writtenUp) return { status: "already-written-up" };
  if (opts.progress?.[progressKey(session, here)]?.waiting === true) return { status: "already-written-up" };
  if (!held.owes) {
    const why = !held.facts.capturedText
      ? "no-text"
      : held.facts.lapsed
        ? "lapsed"
        : held.facts.unwritten === 0
          ? "answered"
          : "below-threshold";
    return { status: "owes-nothing", why };
  }
  return { status: "owed", held, here, short: held.small };
}

/**
 * EVERY SESSION, IN ANY PROJECT, WAITING FOR A WRITE-UP that is not small —
 * `waitingForWriteUp` over the plan. Doctor's count: a project never reopened
 * is never written up, and this is where that shows until its stretch lapses.
 */
export function awaitingWriteUp(plan: readonly HeldSession[]): HeldSession[] {
  return plan.filter((h) => waitingForWriteUp(h));
}

/**
 * THE SESSIONS A NEW SESSION IN `scope` MAY BE POINTED AT, in the order they
 * are offered — every `owed` standing, minus the asking session itself.
 *
 * **Full write-ups first, then small ones** (2026-09-29): a full one not yet
 * pointed at TODAY (`pointedToday`, the caller's calendar) goes first; then the
 * small ones; then a full one already pointed at today — so a small stretch
 * gets whatever the day's allowance has left, and one full session nobody
 * writes up cannot hold every small one back for ever. **Within each, least
 * recently pointed at first, then oldest first.** A session never pointed at
 * comes before one that was, and among equals the one that ended longest ago
 * goes first. Without that key, one session nobody writes up would stand in
 * front of every other session in its project for ever.
 *
 * **A small one waits for the whole STORE** (review of #285, S1): the day's
 * allowance is one count for the store, so a small debt is offered only when
 * NO full debt anywhere — any project — is waiting and not yet pointed at
 * today. The cost, named: a full debt in a project nobody reopens holds every
 * small one back until it lapses; doctor's line shows it meanwhile.
 *
 * A small one is eligible when the host's registry KNOWS it — a session our
 * hooks saw start, which is what a person's conversation is; the unbound MCP
 * server's shared `"mcp"` id (remember NOTES §16, n2) has no record.
 */
export function owedWriteUps(
  plan: readonly HeldSession[],
  dataDir: string,
  scope: string,
  now: number,
  opts: {
    exclude?: string;
    progress?: Readonly<Record<string, WriteUpProgress>>;
    /** Was this hand-over time on the caller's today? Absent: never. */
    pointedToday?: (handedAt: number) => boolean;
  } = {},
): { held: HeldSession; here: string; short: boolean }[] {
  const out: { held: HeldSession; here: string; short: boolean }[] = [];
  const pointedToday = (session: string): boolean =>
    Object.entries(opts.progress ?? {}).some(
      ([key, p]) => key.startsWith(`${session}|`) && p.handedAt > 0 && opts.pointedToday?.(p.handedAt) === true,
    );
  // STORE-WIDE, not this project's: is a full debt anywhere still owed its
  // pointer today? (`opts.exclude` is the asking session, never a debt.)
  const fullFirst = plan.some(
    (h) =>
      h.session !== opts.exclude &&
      waitingForWriteUp(h) &&
      !pointedToday(h.session) &&
      claimedByOther(opts.progress ?? {}, h.session, opts.exclude, now) === null,
  );
  for (const h of plan) {
    if (h.session === opts.exclude) continue;
    // CLAIM-FIRST (2026-10-01): a debt another writer holds right now — the
    // nightly run, or a session that fetched it — is not offered.
    if (claimedByOther(opts.progress ?? {}, h.session, opts.exclude, now) !== null) continue;
    const eligible = waitingForWriteUp(h) || (!fullFirst && smallWriteUpDue(h, dataDir));
    if (!eligible) continue;
    const standing = writeUpStanding(plan, dataDir, h.session, scope, now, {
      ...(opts.progress === undefined ? {} : { progress: opts.progress }),
    });
    if (standing.status === "owed") out.push({ held: h, here: standing.here, short: standing.short });
  }
  const handed = (o: { held: HeldSession; here: string }): number =>
    opts.progress?.[progressKey(o.held.session, o.here)]?.handedAt ?? 0;
  const tier = (o: { held: HeldSession; here: string; short: boolean }): number =>
    o.short ? 1 : handed(o) > 0 && opts.pointedToday?.(handed(o)) === true ? 2 : 0;
  return out.sort((a, b) =>
    tier(a) !== tier(b)
      ? tier(a) - tier(b)
      : handed(a) !== handed(b)
      ? handed(a) - handed(b)
      : a.held.clockFrom !== b.held.clockFrom
        ? a.held.clockFrom - b.held.clockFrom
        : a.held.session < b.held.session
          ? -1
          : a.held.session > b.held.session
            ? 1
            : 0,
  );
}

/**
 * THE MOST OF AN ENDED SESSION'S WORDS ONE FETCH RETURNS — the owner's ~24 KB
 * per session start (2026-09-23). An MCP result is not under the hook's
 * 10,000-character cap, which is why the words travel that way and the
 * SessionStart block is only a pointer. Fixed, so "part k of N" is the same N
 * at every start.
 */
export const WRITE_UP_PART_BYTES = 24 * 1024;
/** What marks words already written up — by that session's own answer, or by
 *  an earlier write-up of it (a session written up once that resumed and owes
 *  again). The instruction is the same either way: do not write them twice. */
export const WRITE_UP_KEPT_MARK = "[already written up]";
/** What marks a note the ended session jotted, rather than something said. */
export const WRITE_UP_JOT_MARK = "[a note it jotted]";
/** What marks the ended session's OWN reply (2026-10-01, build 3): handed over
 *  labelled, so the writer can tell what was said to it from what it said. */
export const WRITE_UP_REPLY_MARK = "[its reply]";
/** What ends a reply cut at `WRITE_UP_REPLY_BYTES`. */
export const WRITE_UP_REPLY_CUT = " [… the rest of this reply is not shown]";
/**
 * **CAL.** The most of ONE reply a part carries (2026-10-01). A reply is
 * context for what was said, not the thing written up, and replies run long:
 * uncut, they would double or triple the parts a session takes. Cut at a
 * character, never inside one, and the cut says so.
 */
export const WRITE_UP_REPLY_BYTES = 1536;
const WRITE_UP_SEPARATOR = "\n\n---\n\n";

/** One piece of an ended session's captured words, in the order they came. */
export interface WriteUpEntry {
  readonly text: string;
  /** The ended session handed this back itself (a coverage mark). */
  readonly kept: boolean;
  readonly jot: boolean;
  /** The ended session's own reply (2026-10-01), already cut to
   *  `WRITE_UP_REPLY_BYTES`. Absent: something said to it, or a jot. */
  readonly reply?: boolean;
  /** When it was captured, epoch ms — what dates a part (`writeUpPartsDated`). */
  readonly at: number;
}

/** A reply cut to `WRITE_UP_REPLY_BYTES`, by code point, marked when cut. */
function cutReply(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= WRITE_UP_REPLY_BYTES) return text;
  const room = WRITE_UP_REPLY_BYTES - Buffer.byteLength(WRITE_UP_REPLY_CUT, "utf8");
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > room) break;
    out += ch;
    bytes += b;
  }
  return out + WRITE_UP_REPLY_CUT;
}

/**
 * THE WORDS AN ENDED SESSION LEFT, as `remember/owes.ts` counts them captured:
 * what was said to it and what it jotted, wherever the buffer holds them — the
 * live streams, quarantine, a claim in flight — in the scopes the caller names
 * (the pointing project's alone, MAJOR 6), deduplicated and in the order they
 * came.
 *
 * **AND ITS OWN REPLIES, labelled** (2026-10-01, build 3 — the owner's call,
 * reversing B3's "never the assistant's turns"): a write-up read from one side
 * of a conversation guessed at the other. Each reply is cut to
 * `WRITE_UP_REPLY_BYTES`, and a reply to something already written up is left
 * out with it. One function, so the hook's part count and the door's parts
 * agree. Read-only.
 */
export function writeUpEntries(
  spans: SpanBuffer,
  held: { session: string; scopes: readonly string[] },
  /** `coveredBefore` (2026-10-11, the re-owe's planner): read as kept only what
   *  was claimed BEFORE that moment, so the parts come out as a run that began
   *  then cut them. Absent: everything claimed so far. */
  opts: { readonly coveredBefore?: number } = {},
): WriteUpEntry[] {
  const seen = new Set<string>();
  const found: { span: Span; kept: boolean }[] = [];
  const before = opts.coveredBefore;
  for (const scope of held.scopes) {
    const covered =
      before === undefined ? spans.coveredHashes(scope) : new Set(spans.coverage(scope).filter((m) => m.at < before).map((m) => m.spanHash));
    const said = [
      ...spans.spans(scope),
      ...spans.quarantined(scope).filter((x) => x.kind !== "assistant"),
      ...spans.claimedSpans(scope),
      ...spans.assistantSpans(scope),
    ];
    for (const span of said) {
      if (span.session !== held.session || typeof span.text !== "string" || span.text.trim().length === 0) continue;
      if (seen.has(span.hash)) continue;
      seen.add(span.hash);
      found.push({ span, kept: span.kind !== "assistant" && covered.has(span.hash) });
    }
  }
  found.sort((a, b) => (a.span.at !== b.span.at ? a.span.at - b.span.at : a.span.from - b.span.from));
  const out: WriteUpEntry[] = [];
  // Whether the latest thing said before a reply is already written up.
  let lastKept = false;
  for (const { span, kept } of found) {
    const at = typeof span.at === "number" && Number.isFinite(span.at) ? span.at : 0;
    if (span.kind === "assistant") {
      if (lastKept) continue;
      out.push({ text: cutReply(span.text), kept: false, jot: false, reply: true, at });
      continue;
    }
    lastKept = kept;
    out.push({ text: span.text, kept, jot: span.kind === "jot", at });
  }
  return out;
}

/**
 * THE PARTS, at `chunkBytes` of words each. Whole entries where they fit; an
 * entry longer than a part is cut at a character, never inside one. Pure and
 * deterministic, so the same entries and the same size are the same parts at
 * every call — the hook counts them for the pointer, the door serves them.
 */
export function writeUpParts(entries: readonly WriteUpEntry[], chunkBytes: number): string[] {
  return writeUpPartsDated(entries, chunkBytes).map((p) => p.text);
}

/**
 * WHAT A PIECE OF A PART COSTS (2026-10-02, review of #315): the larger of its
 * UTF-8 bytes and its wire cost as it leaves — escaped inside the result's
 * JSON, a non-ASCII character as three (`fit/wireChars`) — so a part sized at
 * `chunkBytes` never meets the MCP server's net (`fit/TOOL_RESULT_CEILING`)
 * however many quotes and newlines it carries. Escaping is per character, so
 * the cost of a joined text is the sum of its pieces'.
 */
function partCost(text: string): number {
  return Math.max(Buffer.byteLength(text, "utf8"), wireChars(JSON.stringify(text)) - 2);
}

/** One part as the door serves it (`writeUpPartsDated`). */
export interface WriteUpPart {
  readonly text: string;
  /** The capture time of its latest entry, epoch ms. */
  readonly lastAt: number;
  /**
   * What in it is NOT already written up, in the same cost as the part's size
   * (2026-10-11): 0 when every entry in it carries `WRITE_UP_KEPT_MARK` — the
   * session's own chapters or memories took those words before any write-up
   * came. Such a part holds nothing to write, and the door passes it over
   * (`mcp/write-up.ts#handOver`) instead of handing a reader 24 KB of words it
   * is told not to write again.
   */
  readonly unwritten: number;
}

/**
 * The same parts, each with the capture time of its latest entry — what dates
 * the day a write-up of that part records as LIVED (`happened_on`, 2026-10-01)
 * — and how much of it is not yet written up (`unwritten`, 2026-10-11).
 */
export function writeUpPartsDated(entries: readonly WriteUpEntry[], chunkBytes: number): WriteUpPart[] {
  const size = Math.max(1, Math.floor(chunkBytes));
  const sep = partCost(WRITE_UP_SEPARATOR);
  const parts: WriteUpPart[] = [];
  let cur = "";
  let curBytes = 0;
  let curAt = 0;
  let curUnwritten = 0;
  const flush = (): void => {
    if (cur.length > 0) parts.push({ text: cur, lastAt: curAt, unwritten: curUnwritten });
    cur = "";
    curBytes = 0;
    curAt = 0;
    curUnwritten = 0;
  };
  for (const entry of entries) {
    const rendered =
      (entry.kept ? `${WRITE_UP_KEPT_MARK}\n` : "") +
      (entry.jot ? `${WRITE_UP_JOT_MARK} ` : "") +
      (entry.reply === true ? `${WRITE_UP_REPLY_MARK} ` : "") +
      entry.text;
    const bytes = partCost(rendered);
    if (cur.length > 0 && curBytes + sep + bytes <= size) {
      cur += WRITE_UP_SEPARATOR + rendered;
      curBytes += sep + bytes;
      curAt = Math.max(curAt, entry.at);
      if (!entry.kept) curUnwritten += bytes;
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
    // Longer than a part on its own: cut it, by code point. Every slice of a
    // kept entry is kept, though only the first carries the mark.
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

/**
 * THE FIRST PART WORTH HANDING OVER at or after `from` (1-based): parts that
 * hold nothing unwritten are passed over, but never the LAST part — the mark
 * is set only by a session that was handed words (`mcp/write-up.ts` header),
 * so the last part is served even when every word in it is kept. The door and
 * the catch-up's plan read the same rule, so a plan never grants a part the
 * door would pass over as its first.
 */
export function firstUnwrittenPart(parts: readonly Pick<WriteUpPart, "unwritten">[], from: number): number {
  let part = Math.max(1, from);
  while (part < parts.length && (parts[part - 1]?.unwritten ?? 1) === 0) part += 1;
  return part;
}

/**
 * HOW FAR A WRITE-UP HAS GOT, per ended session AND PROJECT (the key is
 * `progressKey`): the part size it was cut at (fixed at the first pointer, so
 * "part k of N" means the same thing at every start), how many parts that
 * made, how many have come back, when it was last pointed at or fetched, and —
 * once every part here has come back — how the last one was answered and
 * whether it is `waiting` on another project's share. ONE meta key in box 2,
 * not one per session — nothing mows meta, so a session's entries are REMOVED
 * when the door marks it, and by the pointer (`pruneWriteUpProgress`) once the
 * plan no longer holds it as owing for any other reason: the map holds the
 * write-ups in flight, and at most a day's worth of ones that ended elsewhere.
 *
 * Written by the hook (when it points) and by the MCP door (when a part is
 * fetched, and when it comes back). Not locked: two processes writing it within
 * the same millisecond can lose one update, and the cost is bounded to one part
 * handed over a second time.
 */
export const WRITE_UP_PROGRESS_KEY = "adapter.writeup.progress";

export interface WriteUpProgress {
  /** Bytes of captured words per part, fixed at the first pointer. */
  readonly chunk: number;
  /** How many parts that makes, as of the newest pointer or fetch. */
  readonly parts: number;
  /** How many parts have come back written. */
  readonly done: number;
  /** When it was last pointed at or fetched, epoch ms — what keeps one
   *  session nobody writes up from standing in front of every other. */
  readonly handedAt: number;
  /** How the LAST part here was answered, once it was — so a mark that failed
   *  can be retried by any later session without anything deposited twice. */
  readonly answer?: WriteUpAnswer;
  /** Every part HERE came back, and the session still holds unwritten words in
   *  another project: it is marked when that project's share comes back too. */
  readonly waiting?: boolean;
  /** Who is writing it up NOW (2026-10-01, claim-first): see `WriteUpClaim`. */
  readonly claim?: WriteUpClaim;
}

/**
 * WHO HOLDS A WRITE-UP WHILE IT IS BEING WRITTEN (2026-10-01, build 3) — so two
 * writers (a session's in-session catch-up and the nightly run) never write the
 * same stretch. Taken by the door at a FETCH, and by the nightly run's launcher
 * when it grants a subject to its runner; while it is young
 * (`WRITE_UP_CLAIM_MS`), any other session's fetch or answer is refused
 * `claimed`, and the SessionStart pointer passes the subject over. The runner's
 * claims are released when its run ends; a claim nobody releases runs out.
 */
export interface WriteUpClaim {
  /** The writing session (the runner's id, for the nightly run). */
  readonly by: string;
  /** When it was taken or last renewed, epoch ms. */
  readonly at: number;
  /** The last part this claim may be served — a catch-up batch's allowance for
   *  this subject (`NIGHT_WRITE_UP_BYTES`, `NIGHT_WRITE_UP_BATCH_PARTS`). Absent: no bound. */
  readonly upTo?: number;
}

/**
 * **CAL.** How long a claim holds (2026-10-01). Past the nightly catch-up's
 * child's watchdog (`TUNABLES.NIGHT_WRITE_UP_MS`; each batch claims afresh) and any plausible gap between a
 * fetch and its answer; short enough that a writer that died holds nothing
 * past the morning.
 */
export const WRITE_UP_CLAIM_MS = 2 * 60 * 60 * 1000;

/**
 * The nightly run's write-up RUNNER is a session id of its own,
 * `writeup-<run id>` (2026-10-01): its record carries the grant (`mayWriteUp`)
 * and nothing else writes there, so no live session's slot is shared with it.
 */
export const NIGHT_RUNNER_PREFIX = "writeup-";

/** The claim on this progress entry, when it is still young. */
export function liveClaim(p: WriteUpProgress | undefined, now: number): WriteUpClaim | null {
  const c = p?.claim;
  if (c === undefined) return null;
  return now - c.at < WRITE_UP_CLAIM_MS ? c : null;
}

/** Does a session OTHER than `by` hold a young claim on any share of `session`? */
export function claimedByOther(
  progress: Readonly<Record<string, WriteUpProgress>>,
  session: string,
  by: string | undefined,
  now: number,
): WriteUpClaim | null {
  for (const [key, p] of Object.entries(progress)) {
    if (!key.startsWith(`${session}|`)) continue;
    const c = liveClaim(p, now);
    if (c !== null && c.by !== by) return c;
  }
  return null;
}

/** The progress map's key: one ended session in one project. */
export function progressKey(session: string, scope: string): string {
  return `${session}|${scope}`;
}

/** Every write-up in flight. Never throws: an unreadable key is an empty map. */
export function readWriteUpProgress(store: Pick<Store, "getMeta">): Record<string, WriteUpProgress> {
  try {
    return parseWriteUpProgress(store.getMeta(WRITE_UP_PROGRESS_KEY));
  } catch {
    return {};
  }
}

/** The progress map from the meta row's text. Never throws: unreadable is empty. */
function parseWriteUpProgress(text: string | undefined): Record<string, WriteUpProgress> {
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, WriteUpProgress> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const bar = key.indexOf("|");
    if (bar <= 0 || !isSessionId(key.slice(0, bar)) || value === null || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const chunk = v["chunk"];
    const parts = v["parts"];
    const done = v["done"];
    const handedAt = v["handedAt"];
    const answer = v["answer"];
    if (
      typeof chunk === "number" && Number.isSafeInteger(chunk) && chunk > 0 &&
      typeof parts === "number" && Number.isSafeInteger(parts) && parts > 0 &&
      typeof done === "number" && Number.isSafeInteger(done) && done >= 0
    ) {
      out[key] = {
        chunk,
        parts,
        done,
        handedAt: typeof handedAt === "number" && Number.isFinite(handedAt) ? handedAt : 0,
        ...((WRITE_UP_ANSWERS as readonly unknown[]).includes(answer) ? { answer: answer as WriteUpAnswer } : {}),
        ...(v["waiting"] === true ? { waiting: true } : {}),
        ...((): { claim?: WriteUpClaim } => {
          const c = v["claim"];
          if (c === null || typeof c !== "object" || Array.isArray(c)) return {};
          const r = c as Record<string, unknown>;
          if (!isSessionId(r["by"]) || typeof r["at"] !== "number" || !Number.isFinite(r["at"])) return {};
          const upTo = r["upTo"];
          return {
            claim: {
              by: r["by"],
              at: r["at"],
              ...(typeof upTo === "number" && Number.isSafeInteger(upTo) && upTo > 0 ? { upTo } : {}),
            },
          };
        })(),
      };
    }
  }
  return out;
}

/**
 * FORGET THE WRITE-UPS THAT ENDED ANOTHER WAY (PR #192 re-review, NIT). The door
 * removes a session's entries when it marks it; a session that stops owing by
 * any other road — the API sweep's mark, its own answer after a resume, a share
 * left `waiting` when another project's mark lands — would keep them for good.
 * Called with the plan the pointer already read: every entry whose session the
 * plan no longer holds as owing is dropped. Never throws; returns how many.
 */
export function pruneWriteUpProgress(
  store: Pick<Store, "updateMeta">,
  plan: readonly HeldSession[],
): number {
  const owing = new Set(plan.filter((h) => h.owes).map((h) => h.session));
  let dropped = 0;
  updateWriteUpProgress(store, (all) => {
    dropped = 0;
    for (const key of Object.keys(all)) {
      if (owing.has(key.slice(0, key.indexOf("|")))) continue;
      delete all[key];
      dropped += 1;
    }
    return dropped > 0;
  });
  return dropped;
}

/**
 * CHANGE THE PROGRESS MAP IN ONE TRANSACTION (2026-10-01, review of #308): the
 * map is read INSIDE the write (`Store#updateMeta`, `BEGIN IMMEDIATE`), so the
 * nightly runner's MCP process and a live session's door, writing at the same
 * moment, each change the map the other left — neither loses a claim or a
 * `done`. `fn` edits `all` in place and says whether it changed anything.
 * Returns whether the write landed (or nothing needed writing); never throws.
 */
export function updateWriteUpProgress(
  store: Pick<Store, "updateMeta">,
  fn: (all: Record<string, WriteUpProgress>) => boolean,
): boolean {
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

/**
 * TAKE (or renew) A CLAIM AND SAVE ONE KEY'S PROGRESS, unless another session
 * holds a young claim on that subject — decided inside the same transaction as
 * the write, so two writers fetching at once cannot both take it (review of
 * #308). `claimed` names the holder that won.
 */
export function claimWriteUpProgress(
  store: Pick<Store, "updateMeta">,
  key: string,
  progress: WriteUpProgress & { readonly claim: WriteUpClaim },
  now: number,
): "saved" | "claimed" | "failed" {
  const session = key.slice(0, key.indexOf("|"));
  let held = false;
  const ok = updateWriteUpProgress(store, (all) => {
    held = claimedByOther(all, session, progress.claim.by, now) !== null;
    if (held) return false;
    all[key] = { ...progress };
    return true;
  });
  return !ok ? "failed" : held ? "claimed" : "saved";
}

/**
 * Set (or, with `null`, remove) one key's progress — or, with `session` and a
 * null, every key of that session. Read-modify-write of the one meta key.
 * Returns whether it landed; never throws.
 */
export function saveWriteUpProgress(
  store: Pick<Store, "updateMeta">,
  key: string,
  progress: WriteUpProgress | null,
  opts: { allOf?: string } = {},
): boolean {
  return updateWriteUpProgress(store, (all) => {
    if (opts.allOf !== undefined) {
      for (const k of Object.keys(all)) if (k.startsWith(`${opts.allOf}|`)) delete all[k];
    }
    if (progress === null) delete all[key];
    else all[key] = { ...progress };
    return true;
  });
}

/**
 * THE POINTER'S NEWEST OUTCOME — pointed, or deferred and by how much — kept
 * DURABLY in box 2's meta so doctor can say why nothing is being written up
 * (PR #192 review, MAJOR 1). One key, overwritten each time: the question it
 * answers is "is the pointer getting out", and the newest answer is the one
 * that matters. Not an event row: a new durable event NAME is a core change.
 */
export const WRITE_UP_POINTER_KEY = "adapter.writeup.pointer";

export interface WriteUpPointerRecord {
  readonly at: number;
  readonly date: string;
  readonly outcome: "pointed" | "deferred";
  /** For a deferral: why (`host-cap`, `mark-unwritten`). */
  readonly reason?: string;
  /** The bytes the pointer needed, and what the wake and other asks left. */
  readonly need: number;
  readonly room: number;
  /** The budget it was measured against when not the host's plain cap: the
   *  JSON envelope's, when a plain reminder rode (review of #285, S2). */
  readonly limit?: number;
  /** What else rode beside the wake, in words — "the first-launch question
   *  and 1 plain reminder" — so doctor names the real cause (M3). */
  readonly beside?: string;
}

export function readWriteUpPointer(store: Pick<Store, "getMeta">): WriteUpPointerRecord | null {
  try {
    const v = JSON.parse(store.getMeta(WRITE_UP_POINTER_KEY) ?? "null") as Record<string, unknown> | null;
    if (v === null || typeof v !== "object") return null;
    const outcome = v["outcome"];
    if (outcome !== "pointed" && outcome !== "deferred") return null;
    const num = (k: string): number => (typeof v[k] === "number" && Number.isFinite(v[k]) ? (v[k] as number) : 0);
    return {
      at: num("at"),
      date: typeof v["date"] === "string" ? v["date"] : "",
      outcome,
      ...(typeof v["reason"] === "string" ? { reason: v["reason"] } : {}),
      need: num("need"),
      room: num("room"),
      ...(typeof v["limit"] === "number" && Number.isFinite(v["limit"]) ? { limit: v["limit"] } : {}),
      ...(typeof v["beside"] === "string" && v["beside"].length > 0 ? { beside: v["beside"] } : {}),
    };
  } catch {
    return null;
  }
}

export function saveWriteUpPointer(store: Pick<Store, "setMeta">, record: WriteUpPointerRecord): boolean {
  try {
    store.setMeta(WRITE_UP_POINTER_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
