/**
 * The MCP server: messages in, tool results out, one brain underneath.
 *
 * **It composes, it does not re-wire** (CLAUDE.md, `counterpart.ts`'s header).
 * Every durable thing this file does goes through a `Counterpart` method —
 * `captureJot`, `submitJot`, `submitSessionEnd` — so the gate battery, the
 * engine-set authorship channel, the `updates:` resolution and the observer
 * stand-down all ride along without this adapter knowing they exist. The MCP
 * tools are therefore two more entrances on `claude-code/INTERFACE-GAPS.md`
 * §4's table, and they inherit its coverage rather than needing their own.
 *
 * **The three refusals that live HERE**, because no core module can know them:
 *
 *   1. **The bound session.** `session_end` is the return channel for ONE
 *      session's Stop ask (`claude-code/INTERFACE-GAPS.md` §7). `chapter` binds
 *      by the same rules, through the same one code path. A server
 *      launched for session A may not accept session B's dump, and a server
 *      bound to nothing may not accept a bare claim — "unbound" is a refusal,
 *      not a wildcard. A host that lets a model pick the session id it writes
 *      under has handed the model the ability to write into another session's
 *      day.
 *
 *      **The lazy bind, added 2026-09-04.** Measured on the live host: Claude
 *      Code registers an MCP server from a STATIC config (command, args, env),
 *      so `--session` never arrives and every dump for the whole run was
 *      refused `no-bound-session`. So a server launched without one may bind
 *      ONCE, from the model's claim, and only when the claim is CORROBORATED by
 *      host state the model cannot write: `adapters/sessions.ts`'s registry,
 *      written by the hooks, must hold that id, it must be live, and its scope
 *      must be this server's scope. The first valid claim binds for the
 *      process's lifetime; a second, different id is refused exactly as it
 *      always was. The explicit `--session` path is unchanged and still wins:
 *      a server told which session it is never consults the registry.
 *
 *      **Claude Desktop binds per call** (2026-09-30). One server there serves
 *      every chat, so a bind frozen for the process would file every chat under
 *      the first. A Desktop call binds the live Desktop session it names, or —
 *      naming none — the most recent one, and says so; its `wake` tool writes
 *      the registry record the hooks would have (`bindDesktopCall`, `wakeTool`).
 *      **And it serves Desktop's Code tab when named** (2026-10-01): a call
 *      naming a live session the HOOKS recorded (host `claude-code`) is served
 *      as that Claude Code session for that call only — its directory, its
 *      doors — because, measured, the Code tab's counterparts tools ARE this
 *      server's (`claudeCodeSessionNamed`).
 *   2. **Stand-down over the wire** (§5 G5, scar E7/§2.4). Under observer every
 *      tool returns a result that SAYS it stood down, plus telemetry. A silent
 *      no-op would be indistinguishable from a broken server, which is the
 *      exact failure §2.4 records.
 *   3. **Owner-scoped confidentiality** (§5 G6). The host is the only thing
 *      that knows whose session this is; it says so at construction, and the
 *      value travels into `Recall`'s own owner logic rather than being
 *      re-derived from anything the model can influence.
 *
 * Telemetry is content-by-reference throughout: ids, counts, tiers, reasons.
 * No body text, no question text, no note text ever reaches an event.
 */
import { CLAIM_NOTHING_NEW, claimUnwritten } from "../../core/coverage/index.js";
import { DREW_ON_MAX_PER_BOUNDARY, MCP_OVERSIZE_EVENT, MCP_PART_EVENT, MCP_RECALL_EVENT, RECALL_CREDIT_EVENT, boundedIds } from "../../core/counterpart.js";
import { CONTRADICTION_TUNABLES, HELD_HINT, NEIGHBOURS_HINT } from "../../core/contradictions.js";
import type { Neighbour } from "../../core/contradictions.js";
import { isRecurrence, localDate, occurrenceOnOrAfter, parseCalendarDate, readableRecurrence, todayIn } from "../../core/time.js";
import type { Recurrence } from "../../core/time.js";
import type { ChapterResult, Counterpart, DepositResult, SentFacts } from "../../core/counterpart.js";
import { LAST_EXCHANGE_HANDLE, lastExchangeAnswer } from "../../core/handoff/last-exchange.js";
import { loadGateState } from "../../core/recall/index.js";
import type { SemanticSource } from "../../core/recall/index.js";
import { AUTHOR_DIMENSIONS } from "../../core/remember/index.js";
import { ABOUT_MARKS, CACHE_SCHEMA_VERSION, CORE_ABOUT_MARKS, SAID_BY, SCHEMA_VERSION, STATUSES, StoreError, checkFeelings, checkTraits, isStoreError, paths, saidByOf, schemaAhead, statusOf } from "../../core/store/index.js";
import type { AboutMark, FeelingInput, MemoryStatus, SaidBy, TraitInput } from "../../core/store/index.js";
import { isLocked } from "../../core/store/db.js";
import type { Band, Kind } from "../../core/types.js";
import { UNBOUND_SESSION, isKnownSession } from "../../core/types.js";
import { recordHandleResolution } from "../expansions.js";
import {
  canonicalScopePath,
  lookupScope,
  readScopes,
  ownEntry,
  resumeTarget,
  scopeCommand,
  scopeCommandContext,
  setScope,
  shortPath,
  stanceOfMode,
  writeScopes,
} from "../scopes.js";
import type { ScopeCommandContext, ScopeMode, ScopeRegistry, ScopeVerdict } from "../scopes.js";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

import { CODE_TAB_ENTRYPOINT, DEFAULT_HOST, DESKTOP_HOST, DESKTOP_SCOPE, claudeCodeEnvMarker, hostOfClient, wordingFor } from "../hosts.js";
import type { RefusalPlace } from "../hosts.js";
import { TUNABLES as ADAPTER_TUNABLES } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { Lifecycle, plainContextLine } from "../lifecycle.js";
import type { SessionInput } from "../lifecycle.js";
import { WORKER_RUNNER_PATH } from "../spawn.js";
import type { Spawner } from "../spawn.js";
import {
  NIGHT_RUNNER_PREFIX,
  SERVER_HEARTBEAT_MS,
  SESSION_TTL_MS,
  DESKTOP_WAKE_KEY,
  canonicalScope,
  forgetServerLaunch,
  hostOf,
  installedBuild,
  installedVersion,
  isLive,
  isSessionId,
  latestLiveSession,
  listSessions,
  manifestVersionOnDisk,
  markNothingNew,
  readSession,
  sessionOfHost,
  recordServerLaunch,
  refreshServerLaunch,
  sameScope,
  serverIsNewer,
  touchDesktopSession,
  versionNewer,
} from "../sessions.js";
import type { ServerRecord } from "../sessions.js";
import {
  JOURNAL_GLOSS,
  RECALL_BODY_CHARS,
  RECALL_MAX_IDS,
  RECALL_ID_RESULT_CHARS,
  boundById,
  deliberateRecall,
  embedQuestion,
} from "./deliberate.js";
import type { DeliberateResult } from "./deliberate.js";
import { factsRecall, renderFacts } from "./facts.js";
import { meaningRecall, renderMeaning } from "./meaning.js";
import {
  ERROR_CODES,
  failure,
  negotiateVersion,
  success,
} from "./protocol.js";
import type { Id, Request, Response } from "./protocol.js";
import { DREAMING_SETTINGS, NIGHT_RUN_FINISHES, nightNext, nightOrder } from "../../core/dream/index.js";
import type { DreamBundle, DreamingSetting, NightPart } from "../../core/dream/index.js";
import { TOOL_RESULT_CEILING, clipWire, noteLookups, wireChars } from "../../core/fit/index.js";
import type { FitMechanism } from "../../core/fit/index.js";
import { NIGHT_WRITER_TOOL, NO_PAGE_VERSION, WAKE_BUILD_KEY, pageRoomNote, pageSections, pageTooLargeDetail } from "../../core/self/index.js";
import type { PageRevision, PageWriterMode } from "../../core/self/index.js";
import { canonicalToolName, toolDefinitions, toolSpec } from "./tools.js";
import { writeUpDoor } from "./write-up.js";
import type { ToolName } from "./tools.js";
import { scriptArgs } from "../runtime.js";

export const SERVER_NAME = "counterparts";
/**
 * What `initialize` tells the client it is talking to. It is the PACKAGE's
 * version, and `test/mcp.test.ts` reads `package.json` and asserts the two are
 * the same string — a literal here that drifted would make the one number a
 * client can see about this server a lie, and the handshake is exactly where a
 * host decides whether to trust what follows. Read from a constant rather than
 * from disk so the server opens no file to answer its first message.
 */
export const SERVER_VERSION = "0.3.17";

/**
 * THE ONE LINE EVERY TOOL ANSWERS WITH when the store on disk is a schema AHEAD
 * of the code this process loaded — a newer build migrated it after this
 * server started (`call`'s schema gate). The same sentence for every tool,
 * ending in the same remedy the hook's update notice ends in.
 *
 * The remedy is the HOST's (`hosts.ts`, 2026-09-30): `/mcp` is Claude Code's
 * command, so the sentence a server hands back is built from the wording of
 * the host it serves (`McpServerOptions.host`). The constant is Claude Code's,
 * unchanged.
 */
export function staleServerRefusal(host: string = DEFAULT_HOST): string {
  return `Counterparts was updated and this server is still running the old version, so this tool did nothing. ${wordingFor(host).reconnect}`;
}
export const STALE_SERVER_REFUSAL = staleServerRefusal(DEFAULT_HOST);

/**
 * THE SAME GATE WHEN ONLY THE CACHE IS AHEAD (2026-10-11): the search cache
 * (`cache/cache.sqlite`, box 3) carries a newer build's stamp while the store
 * does not. "Was updated … reconnect" is not true there — after a rollback
 * the installed build IS this one, and a reconnect loads the same code onto
 * the same cache. What is true: a newer build wrote the cache, and it is
 * rebuildable, so either that build comes back or the cache goes. The
 * reconnect after deleting it is real: this process holds the old file open.
 * `cacheFile` is the cache's path; the `*` takes its `-wal` and `-shm` too.
 *
 * BOTH WAYS IT HAPPENS (review of #382): an update whose new build moved the
 * cache and not the store reaches this gate too, while the old server still
 * runs — there the newer build IS installed, and the reconnect alone loads
 * it. So the sentence says both, and deleting is offered only for going back.
 */
export function cacheAheadRefusal(cacheFile: string, host: string = DEFAULT_HOST): string {
  const w = wordingFor(host);
  const lower = (s: string): string => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  return `The search cache was written by a newer Counterparts build than this server runs, so this tool did nothing. If that newer build is installed, ${lower(w.reconnect)} If you went back to an older build, delete ${cacheFile}* (the search cache alone; no memory is kept there, and it is rebuilt), then ${lower(w.reconnectFirst)}.`;
}

/** The gate's refusal when the stamps could not be read at all — the same
 *  first step, in the host's words. */
export function schemaUnreadableRefusal(host: string = DEFAULT_HOST): string {
  return `This server could not read which version the memory store is at, so this tool did nothing. ${wordingFor(host).reconnectFirst}; if that does not help, run \`counterparts doctor\`.`;
}
export const SCHEMA_UNREADABLE_REFUSAL = schemaUnreadableRefusal(DEFAULT_HOST);

/** And when the store was merely busy past the wait: a retry, not a reconnect. */
export const STORE_BUSY_REFUSAL =
  "The memory store was busy, so this tool did nothing. Try again in a moment.";

/**
 * Is a stamp read off the disk AHEAD of the code? Only a plain integer above it
 * is. Absent, behind, or not a number all read as "not ahead" — today's
 * behaviour, in which an older store is the hooks' to migrate. ONE definition,
 * the store's (`core/store/cache.ts#schemaAhead`, #190), re-exported here for
 * this module's readers.
 */
export { schemaAhead } from "../../core/store/index.js";

/** What reading the two stamps said: fine, or one of the three refusals. */
type SchemaVerdict =
  | { readonly kind: "ok" }
  | { readonly kind: "busy" }
  | { readonly kind: "unreadable" }
  | {
      readonly kind: "ahead";
      readonly store: string | null;
      readonly cache: string | null;
      readonly storeAhead: boolean;
      readonly cacheAhead: boolean;
    };

/** Telemetry: ids, counts, reasons, flags. NEVER body text (store §5 G10). */
export interface McpEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface McpServerOptions {
  counterpart: Counterpart;
  /**
   * The ONE session this server may deposit under, when the host can say so at
   * launch. Absent ⇒ the lazy bind (`requireBoundSession`) is the only way in.
   */
  session?: string;
  /**
   * The project this server's sessions belong to. Absent, it is what the host
   * offered (`hostScope`): `CLAUDE_PROJECT_DIR` first — the variable the hooks
   * file a session under — then `process.cwd()`, which is MEASURED to be the
   * project directory on this host: `lsof` on four running servers, 2026-09-04,
   * showed each one's cwd was the directory its session ran in. The store's dir
   * is the last resort, and it is a bad scope —
   * every memory authored through this server carried the store path as
   * `origin_scope` for the whole run because it was the only default.
   */
  scope?: string;
  /** Is this the owner's own session? Withholding is the safe direction. */
  owner?: boolean;
  /**
   * WHAT DECIDED `owner` (2026-10-02), for `status` to say plainly: `env` —
   * `COUNTERPARTS_OWNER` or `--owner`; `config` — nothing said, so the installed
   * configuration's `owner: true` made a Claude Code launch the owner's;
   * `off` — `COUNTERPARTS_OWNER` said no (`0`, or a value it could not
   * read); `default` — nothing said and nothing made it so. Absent: `env`
   * when `owner` is true, else `default`.
   */
  ownerFrom?: "env" | "config" | "default" | "off";
  /**
   * DESKTOP'S CODE TAB IS THE OWNER'S TOO (owner ruling 2026-10-02). Desktop's
   * server opens as a guest for its chats; a call it serves as a Claude Code
   * session (`callAs`) is that session, so with this set the call is the
   * owner's — its reads and its thread close. Set by the entry point from the
   * configuration's `owner: true` when `COUNTERPARTS_OWNER` said nothing.
   */
  codeTabOwner?: boolean;
  /**
   * The embedder, for ONE purpose: embedding a deliberate question in line.
   *
   * The ruling of 2026-09-04 splits the two paths — the ambient hot path may not
   * embed (it has a 1200 ms budget and a person mid-sentence), the deliberate
   * ask may (someone typed a question and is waiting). This is that half.
   *
   * The ENTRY POINT reads the configuration and hands over an opened embedder
   * or null (`bin/serve.ts`), exactly as `bin/hook.ts` does for the hook
   * adapter. Null degrades the ask to lexical-only and the result SAYS so.
   */
  embedder?: QuestionEmbedder | null;
  /**
   * Where the hooks' live-session registry lives. Defaults to the store's own
   * data dir — the one path both adapters resolve independently and agree on.
   */
  registryDir?: string;
  /** **CAL.** Liveness window for a lazily-bound claim (`adapters/sessions.ts`). */
  sessionTtlMs?: number;
  /**
   * The most one tool result may measure, by `wireChars` of its serialized
   * `structuredContent` (`withinCeiling`). Default `TOOL_RESULT_CEILING.CHARS`;
   * a test passes a small one to reach the cut without a 40,000-character page.
   */
  resultCeilingChars?: number;
  /**
   * THE SCOPE REGISTRY this server consults — `<config dir>/scopes.json`,
   * resolved by the entry point from the same `--config` rule everything else
   * uses (`bin/serve.ts`). Absent means "nobody told us", which reads as `unset`
   * and behaves exactly as this server always has.
   *
   * It is read PER CALL rather than pinned at construction, and deliberately:
   * the file is a few hundred bytes, and a session whose directory was switched
   * back on — from the console in another terminal, or by this server's own
   * `scope` tool — must get its memory back without the host restarting the
   * process. The launch stderr line is the one thing computed once.
   */
  scopesFile?: string;
  /**
   * What the console line a scope refusal names needs to work where it is
   * typed (`scopes.ts#ScopeCommandContext`, 2026-10-10): the plugin's launcher
   * when this is the plugin's server, and `--config` when `scopesFile` is not
   * the default registry. Set by `bin/serve.ts`. Absent: the npm install's
   * `counterparts`, with `--config` only when `lifecycle.configPath` names
   * another registry.
   */
  scopeCommand?: ScopeCommandContext;
  /**
   * WHICH HOST THIS SERVER SERVES (`hosts.ts`, 2026-09-30), for the words a
   * result says about the host — today, how to reconnect after an update.
   * Absent: `DEFAULT_HOST`, Claude Code, which is every launch `bin/serve.ts`
   * makes today.
   *
   * Since PR B (2026-09-30) the CLIENT decides as well: a client that names
   * itself Claude Desktop's chat or Cowork at `initialize`
   * (`hosts.ts#hostOfClient`) turns this server into Desktop's — the `wake`
   * tool, the `claude-desktop:` place, per-call binding and the write-up ask.
   * Any other client leaves it as this option set it. `DESKTOP_HOST` here does
   * the same from construction (tests, an embedder that knows).
   */
  host?: string;
  /**
   * WHAT CLAUDE DESKTOP'S `wake` NEEDS TO RUN A SESSION START, handed in by the
   * entry point (`bin/serve.ts`) and used only once a Desktop client is seen:
   * the configuration this process read (the wake's budget, the worker's
   * plan), which file that was, and how the worker is started. Absent — a test,
   * an embedder — the wake runs on an empty configuration over this store, and
   * the worker on this runtime and `spawn.ts#WORKER_RUNNER_PATH`.
   */
  lifecycle?: {
    config?: AdapterConfig;
    configPath?: string;
    command?: string;
    args?: readonly string[];
    spawner?: Spawner;
  };
  /**
   * THE DOCTOR NOTICE for Desktop's `wake` — `claude-code/doctor.ts`'s red-only
   * line, which this library may not import, so the entry point hands over a
   * closure (`bin/serve.ts`). Null or absent: nothing to say.
   */
  wakeNotice?: () => string | null;
  /** The package version on disk now (`sessions.ts#manifestVersionOnDisk`),
   *  injectable so the update line is provable without reinstalling. */
  manifestVersion?: () => string | null;
  /** This process's environment, read once at `initialize` for Claude Code's
   *  markers (`hosts.ts#claudeCodeEnvMarker`). Injectable for a test; absent,
   *  `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * The launch directory's scope entry said `observer`, and the launch could not
   * tell whether Claude Code started it (`bin/serve.ts`, review of #294 finding
   * 2): the store was opened as a writer, and this server stands every tool
   * down itself — unless a Claude Desktop client shows up, whose place is
   * `claude-desktop:` and is read per call instead.
   */
  launchObserver?: boolean;
  onEvent?: (e: McpEvent) => void;
  now?: () => number;
}

/**
 * THE ONE LINE `initialize` CARRIES FOR A DESKTOP CLIENT (brief item 5): MCP's
 * `instructions` field. Desktop reportedly ignores it; it costs nothing, and
 * a host that reads it learns the one thing it needs to.
 */
export const DESKTOP_INSTRUCTIONS =
  "Counterparts is your memory. In every new chat, call its wake tool first — before answering anything about the person, the past, or work in progress — and once: it returns this chat's briefing, including what happened yesterday across every session, and a session id to pass on session_end, chapter, dream and reflect. Without a wake, what recall returns is a slice, not the whole record: never present it as complete. In a Claude Code session (Desktop's Code tab) the hook already woke you: do not call wake — pass your own session id, the one your wake or Stop ask names, as `session` on every call.";

/** The MCP prompt a Desktop person can pick (brief item 6). */
export const START_PROMPT = {
  name: "start-with-counterparts",
  title: "Start with Counterparts",
  description: "Wake this chat's memory before we begin.",
  text: "Before anything else, call the counterparts wake tool, read what it returns, and keep the session id it gives for this chat. Then say hello as yourself — briefly — with that memory in mind.",
} as const;

/**
 * THE ONE LINE THAT MAKES A DESKTOP DREAM LINE TRUE THERE. The day's dream line
 * is core's, and says the person was "shown … in the terminal" and that the
 * prompt goes to "a background agent (the Agent tool)". Desktop chat has
 * neither, so the wake adds this beside it rather than rewriting core's words.
 */
export const DESKTOP_DREAM_NOTE =
  "(Claude Desktop: there is no terminal here, so nobody has shown them that line — say it to them yourself, once, in your own words. And there is no background Agent tool: if they say dream, follow the prompt the launch returns yourself, here.)";

/**
 * WHAT A DESKTOP CALL THAT NAMED NO SESSION IS TOLD (2026-10-01: and a Claude
 * Code session in Desktop's Code tab, whose calls land here too and cannot be
 * told apart from a chat's, is told how to correct itself).
 */
export function desktopBindNote(session: string): string {
  return `No session was named, so this call was filed under the most recent Claude Desktop session — Desktop chat ${session}. Every tool takes "session" here: pass the id wake gave this chat, so its calls stay together — and no other chat's write-up ask reaches it. If you are a Claude Code session (Desktop's Code tab), pass your own session id — the one your wake or Stop ask names — and the call is filed under your session and its directory instead.`;
}

/** What a Desktop call that needs a session is told when none is live. */
export const NO_DESKTOP_SESSION =
  "No Claude Desktop session is live. Call the `wake` tool first: it starts this chat's session and returns its id. (In a Claude Code session — Desktop's Code tab — do not call wake: pass the session id your wake or Stop ask names.)";

/** The write-up ask a Desktop tool result carries once the session is due one. */
export function desktopWriteUpAsk(session: string): string {
  return `Counterparts: this chat has gone on a while since it was last written up. At a natural pause, hand back what caught your attention, one idea each, with session_end (session: ${session}; memories: [] only if nothing held your attention; \`updates\` anything dated or open now done), and add a chapter with the chapter tool (session: ${session}) if the chat was about something.`;
}

/** What `status` says `owner: false` means — the confused Desktop chats' question (2026-09-30). */
export const OWNER_FALSE_NOTE =
  "owner: false — confidential memories are left out of this server's answers, and an open question written in another directory cannot be closed from here. It is the ordinary setting for a Claude Desktop chat; your Claude Code sessions run as the owner unless COUNTERPARTS_OWNER=0. Nothing is wrong.";

/** The owner variable's name, for `status` (the entry point reads it, `stance-env.ts`). */
const OWNER_ENV_NAME = "COUNTERPARTS_OWNER";

/** The narrow face of `claude-code/embed-client.ts`'s `LiveEmbedder` this
 *  adapter needs — structural, so the server library imports no other adapter.
 *  (The entry point, `bin/serve.ts`, still opens the embedder through
 *  `claude-code/embed-client.ts`; its configuration comes from the shared
 *  `adapters/config.ts` since 2026-09-30.) */
export interface QuestionEmbedder {
  vector(text: string): Promise<number[] | null>;
}

/** MCP's tool-result shape. A refusal is a RESULT, never a JSON-RPC error. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

const EVENT_RING = 200;

/**
 * THE SCOPE THE HOST OFFERED, or null when it offered none.
 *
 * In order: what the launch declared (`--scope` / `COUNTERPARTS_SCOPE`), then
 * `CLAUDE_PROJECT_DIR`, then this process's working directory.
 *
 * **`CLAUDE_PROJECT_DIR` is second, and it is what makes the two adapters agree
 * without either one telling the other.** The host documents it as the project
 * root where the session started, exports it to hook processes AND to stdio MCP
 * servers, and keeps it put when the agent enters a worktree or runs `cd` — so
 * the hooks' `sessionScope` and this resolve the same string from the same
 * variable. What the server's own working directory is, this host does not
 * document at all: `lsof` on four running servers measured it as the session's
 * directory on 2026-09-04, and a measurement is what it remains. It stays as the
 * fallback it has always been.
 *
 * CANONICAL, because the scope is not only compared — it is the KEY. Span
 * streams, cursors and coverage files are named from a hash of this exact string
 * (`remember/spans.ts#keyFor`), so a deposit whose scope says `/tmp/x` claims
 * coverage in a different directory from spans captured under `/private/tmp/x`.
 * `sameScope` was already canonicalising for the BIND; this makes the filing
 * agree too.
 */
export function hostScope(
  declared: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { scope: string; source: Exclude<ScopeSource, "store"> } | null {
  if (declared !== undefined && declared.length > 0) {
    return { scope: canonicalScope(declared), source: "flag" };
  }
  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof projectDir === "string" && projectDir.length > 0) {
    return { scope: canonicalScope(projectDir), source: "project" };
  }
  try {
    const cwd = process.cwd();
    if (cwd.length > 0) return { scope: canonicalScope(cwd), source: "cwd" };
  } catch {
    /* no working directory — the caller falls through to the store's own dir */
  }
  return null;
}

/**
 * The scope default: whatever the host offered, and — only if it offered
 * nothing at all — the store's own dir.
 *
 * The last resort is a bad answer and is kept only because a server with no
 * scope at all cannot deposit: from 2026-09-03 it was the ONLY answer, so every
 * memory authored through this server was stamped with the store path instead of
 * the project. `process.cwd()` can throw (a deleted working directory), which is
 * the one case the fallback is actually for.
 */
export function resolveScope(
  declared: string | undefined,
  storeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): { scope: string; source: ScopeSource } {
  return hostScope(declared, env) ?? { scope: storeDir, source: "store" };
}

/** How this server learned which project it is serving. Reported at startup.
 *  `host`: the host has no directory, and its place is a name (Claude
 *  Desktop's `claude-desktop:`, 2026-09-30). */
export type ScopeSource = "flag" | "project" | "cwd" | "store" | "host";

/** The kind enum, for a refusal that names it (session_end). Derived from
 *  `Kind` so that adding a kind without listing it here fails `tsc`. */
/**
 * Why a page write did not land, in the words the model needs to do something
 * about it. The keys are `self/`'s own refusal vocabulary, so a reason it can
 * return and this map does not carry falls back to one plain sentence rather
 * than to silence.
 */
const PAGE_REFUSAL_DETAIL: Record<string, string> = {
  empty: "A page has to say something. Nothing worth writing is a real answer — leave the page alone instead.",
  "too-large":
    "That page is past the write ceiling (`limit` bytes, UTF-8; `bytes` is what was sent, `over` how much to take out) — a sanity bound far past the page's room. It was refused rather than cut: what gets cut at write time is the only copy. Say the same thing shorter — tighten, merge or drop what no longer holds — and send the whole page again.",
  "short-not-needed":
    "The page is within its room, so the wake shows it whole and a short version would never be read. Nothing was written.",
  "short-refused":
    "The short version was not kept (`short.reason`: past the room, the page's credential gate, or the wake's own markers), so nothing was written. Fix that and send it again.",
  "gate-refused":
    "The gate battery turned it away — most often because what was sent was nothing but a credential, or too short to be a page. Nothing was written.",
  "forged-markers":
    "That page contains the wake's own structural markers (`<!-- counterparts:wake`). Those lines are the bundle's bookkeeping, and a page carrying them reads to the next session as the end of its memory. Write the page in ordinary prose; headings are fine.",
  "version-moved":
    "Somebody else wrote the page after the version you read — another session, the owner, or the nightly writer. Nothing was written, and nothing of theirs was lost. `currentVersion` and `currentBody` here are what is actually there: fold your change into that and send it back with the new `ifVersion`.",
  "no-page":
    "You named a version and there is no page here at all — nobody wrote over you. Omit `ifVersion` to write the first page, or pass -1, which is the version a read of an empty store reports.",
  "page-appeared":
    "You wrote as if there were no page, and one has appeared since you looked. Nothing was written. `currentVersion` and `currentBody` are what is there: read it, fold your change into it, and send it back with that version.",
};

/**
 * WHAT A WRITE PAST THE PAGE'S ROOM IS TOLD (2026-10-10): the room, what
 * became of a short version, and — when none was kept — how to add one, in
 * `pageRoomNote`'s words. Nothing for a page within its room and no short
 * version sent.
 */
function pageRoomAnswer(written: PageRevision, room: number): Record<string, unknown> {
  const note = pageRoomNote(
    written,
    room,
    `call self_page again with \`short\` alone and \`ifVersion: ${String(written.version ?? NO_PAGE_VERSION)}\``,
  );
  return {
    ...(written.overRoom === null ? {} : { room: written.overRoom, overRoom: true }),
    ...(written.short === null ? {} : { short: written.short }),
    ...(note === null ? {} : { roomNote: note }),
  };
}

const KIND_SET: Record<Kind, true> = { self: true, person: true, entity: true, skill: true, place: true, fact: true };
const MEMORY_KINDS = Object.keys(KIND_SET) as readonly Kind[];

/** Sessions whose "shown" a server keeps in memory for `feelingsNow` (Desktop serves many). */
export const SEEN_SESSIONS = 32;

export class McpServer {
  readonly counterpart: Counterpart;
  /** The session the HOST named at launch, if it could. Never changes. */
  readonly launchedSession: string | null;
  /** The place this server files under. Fixed at construction — except that a
   *  Claude Desktop client turns it into `claude-desktop:` at `initialize`.
   *  The SERVER's place: a Code-tab call served as a Claude Code session reads
   *  `scope` as that session's directory for the call (`callAs`), never this. */
  private placeScope: string;
  scopeSource: ScopeSource;
  /** Did the host say this is the owner's session? Read through `owner`. */
  private readonly ownerClaimed: boolean;
  private readonly ownerFrom: "env" | "config" | "default" | "off";
  private readonly codeTabOwner: boolean;
  /** The store's own observer bit (observer-mode G7): set at open, never lifted. */
  private readonly storeObserver: boolean;
  /**
   * THE LAUNCH DIRECTORY'S `observer` ENTRY, when the launch could not tell
   * whether Claude Code started it (review of #294, finding 2; `bin/serve.ts`).
   * Applied here, per call, to every client but Claude Desktop's — whose place
   * is `claude-desktop:`, never the directory the app started it in.
   */
  private readonly launchObserver: boolean;
  /** This call's Desktop observer verdict, read once per call; null outside one. */
  private callObserver: boolean | null = null;
  /** The host this server serves, for its words about the host (`hosts.ts`).
   *  Set at construction, and by a Claude Desktop client at `initialize`. */
  host: string;
  /** The `clientInfo.name` the client sent at `initialize`, or null. */
  clientName: string | null = null;

  private readonly embedderGiven: QuestionEmbedder | null;
  private readonly registryDir: string;
  private readonly scopesFile: string | null;
  private readonly scopeCommandCtx: ScopeCommandContext | undefined;
  private readonly sessionTtlMs: number;
  private readonly resultCeilingChars: number;
  private readonly onEvent: ((e: McpEvent) => void) | undefined;
  private readonly nowFn: () => number;
  private readonly ring: McpEvent[] = [];
  /**
   * WHAT EACH SESSION WAS SHOWN through this server (2026-10-02, lane B): the
   * memories `recall` DELIVERED (not the ids left waiting) and the neighbours
   * a write showed. With the ambient recall's record for the session, it is
   * what `remember`'s `feelingsNow` may feel again. KEYED BY SESSION (review of
   * #316): Desktop's one server serves many sessions, and a Claude Code
   * process starts a new session on /clear. In memory only, the newest
   * `SEEN_SESSIONS` sessions.
   */
  private readonly seenBySession = new Map<string, Set<string>>();
  private initialized = false;
  /** The lazy bind's result: null until a claim is corroborated, then frozen. */
  private lazySession: string | null = null;
  /** This server's launch record as fixed at launch — written or not, by the
   *  scope setting — and the heartbeat that keeps it believed
   *  (`sessions.ts#SERVER_STALE_MS`). */
  private identity: ServerRecord | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** True while the scope setting says this directory is off: no record. */
  private launchOff = false;
  /** Set by the write guard when it refused a write in the current call. */
  private writeTripped: SchemaVerdict | null = null;
  /** The part this call handed, written after the net (`writePart`). */
  private partHanded: { mechanism: FitMechanism; ref: string; part: number; of: number } | null = null;
  /**
   * CLAUDE DESKTOP'S BINDING IS PER CALL (2026-09-30). One server serves every
   * Desktop chat, so the lazy bind — once, for the life of the process — would
   * file every chat under the first one's session. Instead each call binds
   * afresh (`bindDesktopCall`): the id it names, else the most recent live
   * Desktop session. Calls arrive one at a time over stdio, so one slot is
   * enough; it is cleared when the call ends.
   */
  private callSession: string | null = null;
  private callBoundBy: "named" | "most-recent" | null = null;
  private callRefusal: { reason: string; detail: string } | null = null;
  /**
   * DESKTOP'S CODE TAB, SERVED AS ITSELF (2026-10-01). Measured: a Code-tab
   * session's `mcp__counterparts__*` tools are THIS server's (Desktop's, same
   * name, shadowing the session's own). A Desktop call that names a live
   * session the hooks recorded — host `claude-code` — is served as that
   * session: `session` and `scope` read from here for the call, and nothing
   * Desktop-only (bind note, pacer, ask) touches it. Set at the top of `call`,
   * cleared in its `finally`: never sticky, so the next chat's call cannot
   * inherit it.
   */
  private callAs: { session: string; scope: string } | null = null;
  private readonly lifecycleOpts: NonNullable<McpServerOptions["lifecycle"]>;
  private lifecycleInst: Lifecycle | null = null;
  private readonly wakeNotice: (() => string | null) | undefined;
  private readonly manifestVersion: () => string | null;
  private readonly env: Readonly<Record<string, string | undefined>>;

  constructor(opts: McpServerOptions) {
    this.counterpart = opts.counterpart;
    this.launchedSession =
      opts.session !== undefined && opts.session.length > 0 ? opts.session : null;
    const scope = resolveScope(opts.scope, opts.counterpart.store.dir);
    this.placeScope = scope.scope;
    this.scopeSource = scope.source;
    this.registryDir = opts.registryDir ?? opts.counterpart.store.dir;
    this.scopesFile =
      opts.scopesFile !== undefined && opts.scopesFile.length > 0 ? opts.scopesFile : null;
    this.scopeCommandCtx = opts.scopeCommand;
    this.sessionTtlMs = opts.sessionTtlMs ?? SESSION_TTL_MS;
    this.resultCeilingChars = opts.resultCeilingChars ?? TOOL_RESULT_CEILING.CHARS;
    this.host = opts.host ?? DEFAULT_HOST;
    this.lifecycleOpts = opts.lifecycle ?? {};
    this.wakeNotice = opts.wakeNotice;
    this.manifestVersion = opts.manifestVersion ?? manifestVersionOnDisk;
    this.env = opts.env ?? process.env;
    // A server TOLD it serves Desktop takes Desktop's place from the start; the
    // one a Desktop client reveals itself to takes it at `initialize`.
    if (this.host === DESKTOP_HOST && opts.scope === undefined) {
      this.scope = DESKTOP_SCOPE;
      this.scopeSource = "host";
    }
    this.storeObserver = opts.counterpart.observer;
    this.launchObserver = opts.launchObserver === true;
    this.ownerClaimed = opts.owner === true;
    this.ownerFrom = opts.ownerFrom ?? (opts.owner === true ? "env" : "default");
    this.codeTabOwner = opts.codeTabOwner === true;
    this.embedderGiven = opts.embedder ?? null;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? ((): number => Date.now());
    // LAST in the constructor — `emit` needs `nowFn`. A scope nobody chose is
    // the bug this run measured, so which default won is on the record from the
    // first event rather than inferable only from the memories it stamped.
    this.emit("mcp.scope", undefined, {
      scope: this.scope,
      source: this.scopeSource,
      boundSession: this.launchedSession !== null,
    });
    // THE SAME CHECK AT EVERY WRITE (#187 re-review, N5): a tool checks the
    // stamps on entry, but a deposit can `await` — the embedder, at write time,
    // once per `session_end` entry — before it writes, and a migration can land
    // in that wait. The store asks this before each write it makes for this
    // server, and a stale stamp refuses the write (and so the call) there.
    this.counterpart.store.guardWrites((site) => this.writeGuard(site));
  }

  /** The place a call files under: the Claude Code session's directory for a
   *  Code-tab call this Desktop server serves as that session (`callAs`), else
   *  this server's own place. */
  get scope(): string {
    return this.callAs?.scope ?? this.placeScope;
  }

  set scope(value: string) {
    this.placeScope = value;
  }

  /** The session this server may deposit under: the host's, else the bound
   *  claim — which, for Claude Desktop, is this call's: the Claude Code session
   *  it names (`callAs`), or the Desktop session `bindDesktopCall` bound. */
  get session(): string | null {
    return this.launchedSession ?? (this.desktop ? (this.callAs?.session ?? this.callSession) : this.lazySession);
  }

  /**
   * WHOSE WORDS a result says about the PLACE (scope off / paused / on): a
   * Code-tab call served as a Claude Code session is in a directory, and
   * speaks Claude Code's. How to load a newer build stays this process's
   * host's (`this.host`): the process holding the old build is Desktop's.
   */
  private get placeHost(): string {
    return this.callAs !== null ? DEFAULT_HOST : this.host;
  }

  /**
   * IS THE BOUND SESSION A WRITE-UP RUNNER (2026-10-01)? Its id carries the
   * nightly runner's prefix, or its own record carries a grant
   * (`sessions.ts#SessionRecord.mayWriteUp`, written only by a launcher). A
   * claim in the call's `session` argument is read the same way, so an unbound
   * server is not a way round it. Never throws.
   */
  private isWriteUpRunner(claimed?: unknown): boolean {
    const ids = [this.session, typeof claimed === "string" ? claimed : null].filter((x): x is string => x !== null && x.length > 0);
    for (const id of ids) {
      if (id.startsWith(NIGHT_RUNNER_PREFIX)) return true;
      try {
        if ((readSession(this.registryDir, id)?.mayWriteUp?.length ?? 0) > 0) return true;
      } catch {
        /* an unreadable record grants nothing */
      }
    }
    return false;
  }

  /**
   * ONE PREDICATE (observer-mode G7): the store's bit, always. Beside it, for
   * Claude Desktop, what `scopes.json` says about `claude-desktop:` NOW — read
   * per call, as `off` and `paused` are, so the `scope` tool's `observer` takes
   * effect at once (review of #294, finding 2); for every other client, the
   * launch directory's `observer` when the launch deferred it here.
   */
  get observer(): boolean {
    if (this.storeObserver) return true;
    if (this.desktop) return this.callObserver ?? stanceOfMode(this.scopeVerdict().mode) === "observer";
    return this.launchObserver;
  }

  /** An observer is a non-owner regardless of what the host claimed
   *  (observer-mode G7): an instrument reading somebody's store is not them. */
  get owner(): boolean {
    return (this.ownerClaimed || (this.callAs !== null && this.codeTabOwner)) && !this.observer;
  }

  /** What `status` says decided the stance (2026-10-02), in words. */
  private ownerStance(): Record<string, unknown> {
    const from =
      this.callAs !== null && this.codeTabOwner && !this.ownerClaimed
        ? "a Claude Code session from Desktop's Code tab, which the installed configuration (owner: true) makes the owner's"
        : this.ownerFrom === "config"
          ? "the installed configuration (owner: true): this is your own Claude Code session"
          : this.ownerFrom === "env"
            ? `--owner or ${OWNER_ENV_NAME}, set on this launch`
            : this.ownerFrom === "off"
              ? `${OWNER_ENV_NAME} on this launch says not the owner's (0, off or false, or a value it could not read): the opt-out`
              : "nothing made this launch the owner's";
    return { owner: this.owner, ownerFrom: from, ...(this.owner ? {} : { ownerMeans: OWNER_FALSE_NOTE }) };
  }

  /** An instrument opens no sockets, whatever the host handed it (scar E7). */
  private get embedder(): QuestionEmbedder | null {
    return this.observer ? null : this.embedderGiven;
  }

  /** Is this server talking to Claude Desktop's chat (or Cowork)? */
  get desktop(): boolean {
    return this.host === DESKTOP_HOST;
  }

  /**
   * A CLAUDE DESKTOP CLIENT HAS SAID WHO IT IS (at `initialize`): this server
   * now serves Desktop — its place is `claude-desktop:`, whatever directory the
   * app started the process in, and its launch record says so (it was written
   * at launch under that directory, before anyone had spoken). A launch that
   * declared `--scope` keeps it: somebody named the place on purpose.
   */
  private becomeDesktop(client: string): void {
    const wasDesktop = this.desktop;
    this.host = DESKTOP_HOST;
    if (this.scopeSource !== "flag" && this.placeScope !== DESKTOP_SCOPE) {
      this.placeScope = DESKTOP_SCOPE;
      this.scopeSource = "host";
      const identity = this.identity;
      if (identity !== null) {
        forgetServerLaunch(this.registryDir, identity.pid);
        this.identity = { ...identity, scope: DESKTOP_SCOPE };
        this.beat(true);
      }
    }
    if (!wasDesktop) this.emit("mcp.host", undefined, { host: this.host, client, scope: this.scope });
  }

  events(name?: string): McpEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  // ── the wire ───────────────────────────────────────────────────────────────

  /**
   * One request in, one response out — or `null` for a notification, which is
   * answered with nothing at all.
   */
  async handle(request: Request): Promise<Response | null> {
    const id = request.id;
    const params = request.params ?? {};

    switch (request.method) {
      case "initialize": {
        if (id === undefined) return null;
        this.initialized = true;
        const version = negotiateVersion(params["protocolVersion"]);
        // WHO IS ASKING (2026-09-30): the client's own name is the one signal
        // that tells Claude Desktop's chat from Claude Code — including Claude
        // Code running in Desktop's Code tab off the very same config entry.
        const clientInfo = params["clientInfo"];
        const clientName =
          clientInfo !== null && typeof clientInfo === "object" && !Array.isArray(clientInfo)
            ? (clientInfo as Record<string, unknown>)["name"]
            : undefined;
        this.clientName = typeof clientName === "string" ? clientName.slice(0, 128) : null;
        if (hostOfClient(clientName) === DESKTOP_HOST) {
          // THE BELT: a process Claude Code started stays Claude Code's, whatever
          // its client says (`hosts.ts#claudeCodeEnvMarker`) — and the log says
          // which signal won.
          const marker = claudeCodeEnvMarker(this.env);
          if (marker === null) this.becomeDesktop(this.clientName ?? "");
          else this.emit("mcp.host.kept", undefined, { client: this.clientName, host: this.host, marker });
        }
        this.emit("mcp.initialize", undefined, {
          protocolVersion: version,
          observer: this.observer,
          owner: this.owner,
          boundSession: this.session !== null,
          ...(this.desktop ? { host: this.host } : {}),
        });
        // Everything a Claude Code client is told is exactly what it was told
        // before; a Desktop client is also told to wake, and offered the prompt.
        return success(id, {
          protocolVersion: version,
          capabilities: this.desktop
            ? { tools: { listChanged: false }, prompts: { listChanged: false } }
            : { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          ...(this.desktop ? { instructions: DESKTOP_INSTRUCTIONS } : {}),
        });
      }
      case "notifications/initialized":
      case "initialized":
        this.initialized = true;
        return null;
      case "ping":
        return id === undefined ? null : success(id, {});
      case "tools/list": {
        if (id === undefined) return null;
        const tools = toolDefinitions(this.desktop);
        this.emit("mcp.tools.list", undefined, { tools: tools.length });
        return success(id, { tools });
      }
      // THE PROMPT (brief item 6), for a Desktop client only: a Claude Code
      // client is answered exactly as before, method-not-found.
      case "prompts/list": {
        if (id === undefined) return null;
        if (!this.desktop) return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `unknown method: ${request.method}`);
        return success(id, {
          prompts: [{ name: START_PROMPT.name, title: START_PROMPT.title, description: START_PROMPT.description, arguments: [] }],
        });
      }
      case "prompts/get": {
        if (id === undefined) return null;
        if (!this.desktop) return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `unknown method: ${request.method}`);
        if (params["name"] !== START_PROMPT.name) {
          return failure(id, ERROR_CODES.INVALID_PARAMS, `unknown prompt: ${String(params["name"])}`);
        }
        this.emit("mcp.prompt", undefined, { name: START_PROMPT.name });
        return success(id, {
          description: START_PROMPT.description,
          messages: [{ role: "user", content: { type: "text", text: START_PROMPT.text } }],
        });
      }
      case "tools/call": {
        if (id === undefined) return null;
        return this.callFromParams(id, params);
      }
      default:
        if (id === undefined) return null;
        return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `unknown method: ${request.method}`);
    }
  }

  private async callFromParams(id: Id, params: Record<string, unknown>): Promise<Response> {
    const name = params["name"];
    if (typeof name !== "string") {
      return failure(id, ERROR_CODES.INVALID_PARAMS, "tools/call requires a string name");
    }
    if (toolSpec(name, this.desktop) === undefined) {
      // An unknown TOOL is a protocol fault (the client called something that
      // does not exist); an unusable ARGUMENT is the tool's own answer.
      return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `unknown tool: ${name}`);
    }
    const args = params["arguments"];
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
      return failure(id, ERROR_CODES.INVALID_PARAMS, "arguments must be an object");
    }
    const result = await this.call(name, (args as Record<string, unknown>) ?? {});
    return success(id, result as unknown as Record<string, unknown>);
  }

  // ── the tools ──────────────────────────────────────────────────────────────

  /** Direct tool invocation, transport-free. The wire calls this; so do tests. */
  async call(asked: string, args: Record<string, unknown>): Promise<ToolResult> {
    // AN OLD NAME IS SERVED AS ITS NEW ONE, before anything reads the name
    // (2026-10-10: `note` is `remember`, `tools.ts#TOOL_ALIASES`). Every
    // refusal, row and result below names the tool by its new name.
    const name = canonicalToolName(asked);
    if (name !== asked) this.emit("mcp.tool.alias", undefined, { asked, served: name });
    // THE SCHEMA GATE, FIRST OF ALL — before the scope gate, before the
    // stand-down, before any argument is looked at. See `schemaGate`.
    const stale = this.schemaGate(name);
    if (stale !== null) return stale;
    // AND AT EVERY WRITE, for a tool that waits between its entry and its
    // writes (`writeGuard`). A write the guard refused makes the whole answer
    // the gate's refusal, whatever the tool made of the error on its way out.
    // Calls arrive one at a time over stdio, so one slot is enough.
    this.writeTripped = null;
    this.partHanded = null;
    // CLAUDE DESKTOP: WHICH SESSION IS THIS CALL (2026-09-30) — bound per call,
    // before anything reads `this.session`, and let go when the call ends.
    // `wake` binds nothing: it makes the session. Nothing here writes in a place
    // set `off` (every tool but `scope` refuses there anyway), or as an observer.
    // Desktop's place is read ONCE for the call: `off` here, `observer` for
    // every stand-down check the tool makes (`observer`).
    //
    // DESKTOP'S CODE TAB (2026-10-01): a call naming a live session the HOOKS
    // recorded is served as that Claude Code session — decided FIRST, so the
    // place read just below is that session's directory (its `off`, `paused`,
    // `observer`), and so it is never a Desktop call: no bind, no pacer, no ask.
    this.callAs = this.desktop && name !== "wake" ? this.claudeCodeSessionNamed(args) : null;
    const place = this.desktop ? stanceOfMode(this.scopeVerdict().mode) : null;
    this.callObserver = place === null ? null : place === "observer";
    if (this.callAs !== null) this.emit("mcp.session.served", this.callAs.session, { tool: name, host: DEFAULT_HOST });
    const desktopCall = this.desktop && this.callAs === null && name !== "wake" && !this.observer && place !== "off";
    if (desktopCall) this.bindDesktopCall(args);
    let result: ToolResult | null = null;
    try {
      try {
        result = await this.dispatch(name, args);
      } catch (err) {
        if (this.writeTripped === null) throw err;
      }
      const tripped = this.writeTripped;
      this.writeTripped = null;
      if (tripped !== null) return this.refusalFor(name, tripped, "write");
      // THE NET LAST (2026-10-02): after the Desktop extras, which rebuild the
      // result, so nothing leaves past it; a part's row after the net. The
      // update notice before the net, so the net measures what leaves.
      const served = desktopCall ? this.afterDesktopCall(name, result as ToolResult) : (result as ToolResult);
      const out = this.withinCeiling(name, args, this.withUpdateNotice(name, served));
      this.writePart(out);
      return out;
    } finally {
      this.callSession = null;
      this.callBoundBy = null;
      this.callRefusal = null;
      this.callObserver = null;
      this.callAs = null;
    }
  }

  // ── Claude Desktop: the session a call belongs to ──────────────────────────

  /**
   * IS THIS CALL A CLAUDE CODE SESSION'S? (Desktop's Code tab, 2026-10-01.)
   * Measured live: a Code-tab session's own server stays Claude Code's, but the
   * `counterparts` tools its model sees are THIS one's — Desktop's, same name.
   * So a call naming a session is served as that Claude Code session when the
   * id names a record the HOOKS wrote (host `claude-code`; only the hooks write
   * one, so a model cannot invent it) that is live by the evidence
   * `requireBoundSession` asks — known, not ended, not silent past the TTL.
   * Its directory is the record's `scope`. Anything else — no id, a Desktop
   * id, an unknown or dead one — is not this, and `bindDesktopCall` answers it
   * as before. Reads only.
   */
  private claudeCodeSessionNamed(args: Record<string, unknown>): { session: string; scope: string } | null {
    const claimed = args["session"];
    if (typeof claimed !== "string" || !isSessionId(claimed)) return null;
    // NEVER A WRITE-UP RUNNER (review of #308): the nightly catch-up's runner
    // is served only by its own pinned server, so no id with its prefix, and no
    // record carrying a grant, is ever served through this path.
    if (claimed.startsWith(NIGHT_RUNNER_PREFIX)) return null;
    const record = readSession(this.registryDir, claimed);
    if (record === null || hostOf(record) !== DEFAULT_HOST) return null;
    if ((record.mayWriteUp?.length ?? 0) > 0) return null;
    // THE CODE TAB'S ONLY (coordinator's decision, review of #309): a terminal
    // session has its own server; Desktop's has no reason to act for it.
    if (record.entrypoint !== CODE_TAB_ENTRYPOINT) return null;
    if (!isLive(record, this.nowFn(), this.sessionTtlMs)) return null;
    if (record.scope.length === 0) return null;
    return { session: claimed, scope: record.scope };
  }

  /**
   * BIND THIS CALL (Claude Desktop, 2026-09-30). The id the call NAMES, when it
   * is a live Desktop session in this store's registry; else, when it names
   * none, the most recent live Desktop session — the wire carries no
   * conversation id, so that is the best a server shared by every chat can do,
   * and the result says it was chosen that way (`afterDesktopCall`).
   *
   * A named id that is not a live Desktop session binds nothing: the tools
   * that need a session refuse by name (`requireBoundSession`), and say to call
   * `wake`; the ones that do not (`remember`, `recall`, `status`, …) run unbound, as
   * they always could. Reads only.
   */
  private bindDesktopCall(args: Record<string, unknown>): void {
    const now = this.nowFn();
    const claimed = args["session"];
    if (typeof claimed === "string" && claimed.length > 0) {
      const record = isSessionId(claimed) ? readSession(this.registryDir, claimed) : null;
      // A CLAUDE CODE SESSION that reached here is one `claudeCodeSessionNamed`
      // turned down: outside the Code tab, or no longer live.
      if (record !== null && hostOf(record) === DEFAULT_HOST && record.entrypoint !== CODE_TAB_ENTRYPOINT) {
        this.callRefusal = {
          reason: "session-not-code-tab",
          detail: "That is a Claude Code session outside Desktop's Code tab. It has its own counterparts server; this one is Claude Desktop's, and serves a Claude Code session only from the Code tab.",
        };
        return;
      }
      if (record !== null && hostOf(record) === DEFAULT_HOST) {
        this.callRefusal = {
          reason: "session-not-live",
          detail: "That Claude Code session has ended or has been silent too long to still be writing its own day. Its memories belong to the sweep now.",
        };
        return;
      }
      if (record === null || hostOf(record) !== DESKTOP_HOST) {
        this.callRefusal = {
          reason: "session-unknown",
          detail: "No session by that id is recorded — not a Claude Desktop chat's, and not a Claude Code session's. In a Desktop chat, use the id `wake` returned for this chat, exactly, or call `wake` to start one; in a Claude Code session, use the id your wake or Stop ask names.",
        };
        return;
      }
      if (!isLive(record, now, this.sessionTtlMs)) {
        this.callRefusal = {
          reason: "session-not-live",
          detail: "That session has been quiet too long to still be this chat's. Call `wake` for a fresh session id, and use that one.",
        };
        return;
      }
      this.callSession = claimed;
      this.callBoundBy = "named";
      return;
    }
    const latest = latestLiveSession(this.registryDir, DESKTOP_HOST, now, this.sessionTtlMs);
    if (latest === null) {
      this.callRefusal = {
        reason: "session-required",
        detail: NO_DESKTOP_SESSION,
      };
      return;
    }
    this.callSession = latest.sessionId;
    this.callBoundBy = "most-recent";
  }

  /**
   * AFTER A DESKTOP CALL THAT WAS BOUND. A call that NAMED its session
   * refreshes that session's record — with no hooks, a tool call is the only
   * sign a Desktop session is alive — and moves its write-up pacer
   * (`sessions.ts#touchDesktopSession`), and only such a call carries the
   * write-up ask. A call bound by the most-recent FALLBACK moves nothing and is
   * never asked (review of #294, finding 1): it may be another chat's, and the
   * ask would tell chat A to write up chat B. Its result says it was filed that
   * way, and how to name the session instead. Fail-open: a registry that will
   * not write costs the refresh, never the call.
   */
  private afterDesktopCall(name: string, result: ToolResult): ToolResult {
    const session = this.callSession;
    if (session === null) return this.withUnboundReason(result);
    const writing = name === "session_end" || name === "chapter";
    let ask = false;
    try {
      const touched = touchDesktopSession(this.registryDir, session, {
        now: this.nowFn(),
        wroteUp: writing && result.isError !== true,
        mayAsk: !writing,
        // Only a call that NAMED its session moves that session's record or
        // carries its ask (review of #294, finding 1): a fallback-bound call
        // may be another chat's.
        named: this.callBoundBy === "named",
        askCalls: ADAPTER_TUNABLES.DESKTOP_ASK_CALLS,
        askAfterMs: ADAPTER_TUNABLES.DESKTOP_ASK_AFTER_MS,
      });
      ask = touched?.ask === true;
      this.emit("mcp.desktop.call", session, {
        tool: name,
        boundBy: this.callBoundBy,
        refreshed: touched !== null && this.callBoundBy === "named",
        calls: touched?.desk.calls ?? null,
        ask,
      });
    } catch {
      /* the refresh is host trivia; the call already happened */
    }
    const extra: Record<string, unknown> = {};
    if (this.callBoundBy === "most-recent") {
      extra["boundTo"] = session;
      extra["boundBy"] = "most-recent";
      extra["bindNote"] = desktopBindNote(session);
    }
    if (ask) extra["writeUpAsk"] = desktopWriteUpAsk(session);
    if (Object.keys(extra).length === 0) return result;
    return this.result({ ...result.structuredContent, ...extra }, result.isError === true);
  }

  /**
   * A NAMED SESSION THAT DID NOT BIND, SAID ON THE RESULT (review of #309). A
   * tool that needs a session already refuses with the reason; one that does
   * not (`remember`, `recall`, `status`, …) runs unbound under `claude-desktop:`,
   * and used to say nothing — so a Code-tab note under a stale id came back
   * `stored: true` with nobody the wiser. Now the result carries why.
   */
  private withUnboundReason(result: ToolResult): ToolResult {
    const why = this.callRefusal;
    if (why === null || result.structuredContent["reason"] === why.reason) return result;
    return this.result(
      {
        ...result.structuredContent,
        sessionRefused: why.reason,
        sessionNote: `${why.detail} So this call ran with no session, under Claude Desktop's place (claude-desktop:).`,
      },
      result.isError === true,
    );
  }

  /** The lifecycle Desktop's `wake` runs a session start with — built on first
   *  use, so a Claude Code server constructs nothing it did not before. */
  private lifecycle(): Lifecycle {
    if (this.lifecycleInst !== null) return this.lifecycleInst;
    const o = this.lifecycleOpts;
    const config: AdapterConfig = { ...(o.config ?? {}), dataDir: o.config?.dataDir ?? this.counterpart.store.dir };
    this.lifecycleInst = new Lifecycle({
      counterpart: this.counterpart,
      config,
      host: DESKTOP_HOST,
      command: o.command ?? process.execPath,
      args: o.args ?? scriptArgs(WORKER_RUNNER_PATH, o.command ?? process.execPath),
      ...(o.spawner === undefined ? {} : { spawner: o.spawner }),
      ...(o.configPath === undefined ? {} : { configPath: o.configPath }),
      scope: this.scopeVerdict(),
      now: this.nowFn,
      // The lifecycle's own ring events join this server's (the process log).
      onEvent: (e) => this.emit(e.name, undefined, e.data),
    });
    return this.lifecycleInst;
  }

  private async dispatch(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    // THE SCOPE GATE, BEFORE EVERYTHING ELSE — before the observer stand-down and
    // before any session bind. A directory somebody switched `off` gets no
    // deposits, no reads and no census, and the refusal is NAMED (`scope-off`)
    // so it is not mistaken for a broken server, an unbound session or a
    // stand-down. The one exception is `scope` itself: every other tool
    // refusing there means a door that refused too would lock from the outside,
    // and turning a directory back on from inside the session that wants it is
    // the whole point of the tool.
    if (name !== "scope") {
      const verdict = this.scopeVerdict();
      if (stanceOfMode(verdict.mode) === "off") return this.refuseScopeOff(name, verdict);
    }
    // A WRITE-UP RUNNER WRITES UP AND NOTHING ELSE (2026-10-01, review of #308,
    // HIGH). The nightly catch-up's runner is bound to the launching session's
    // directory, so an ordinary `session_end` — or a `remember`, a `chapter`, a
    // handoff — from it would mint first-hand memories there in nobody's name.
    // Any session whose record carries a grant (`mayWriteUp`), and any id with
    // the runner's prefix, may call `session_end` WITH `writeUp`, and read
    // (`recall`, `status`); everything else is refused by name.
    if (this.isWriteUpRunner(args["session"]) && !(name === "session_end" && typeof args["writeUp"] === "string" && args["writeUp"].length > 0) && name !== "recall" && name !== "status") {
      return this.refuse(name, "write-up-runner", {
        detail: "This session was started to write up other sessions, and does only that: call session_end with writeUp. It writes no memories, chapters or handoffs of its own.",
      });
    }
    switch (name) {
      case "remember":
        return this.rememberTool(args);
      case "recall":
        return await this.recallTool(args);
      case "status":
        return this.statusTool();
      case "session_end":
        return this.sessionEndTool(args);
      case "chapter":
        return this.chapterTool(args);
      case "scope":
        return this.scopeTool(args);
      case "self_page":
        return this.selfPageTool(args);
      case "dream":
        return this.dreamTool(args);
      case "wake":
        // Claude Desktop's only (`tools.ts#WAKE`). A Claude Code client never
        // reaches here over the wire (`toolSpec` refuses it first); a direct
        // call gets the same answer any tool this host does not have gets.
        return this.desktop ? this.wakeTool() : this.refuse(name, "unknown-tool", { tool: name });
      case "reflect":
        return this.reflectTool(args);
      default:
        return this.refuse(name, "unknown-tool", { tool: name });
    }
  }

  /**
   * IS THE STORE STILL THE ONE THIS CODE WAS WRITTEN FOR? — asked on every
   * tool call, because this process is the one that cannot find out any other
   * way.
   *
   * A host starts this server once per session and keeps it; the hooks are
   * fresh processes at every event. After an upgrade the hooks run the new
   * build and this server keeps the one it loaded (LAUNCH-STATUS I36). If the
   * new build migrated the store, `SCHEMA_AHEAD` — which is decided at OPEN —
   * never runs again here: this process opened the store before the migration
   * and holds the handle still. So the stamps are re-read here, on the handle
   * it already has (`Store.schemaVersions`: two primary-key reads, no write),
   * and a store or cache AHEAD of this code refuses EVERY tool — `scope` and
   * `status` included — with one sentence, before any tool body has read or
   * written a thing. Behind is not refused: an older store is the hooks' to
   * migrate, exactly as before.
   *
   * It runs BEFORE the scope gate, so in a directory switched `off` it still
   * reads the two stamps — a version number, not a memory, and nothing is
   * written — and every tool there answers this one sentence rather than some
   * `scope-off` and some not: a stale server is the more urgent thing to say.
   *
   * A read that throws refuses too, under its own reason: the point of the
   * gate is to touch nothing when this code cannot know what it is touching.
   * A LOCK is told apart from an unreadable stamp (`db.ts#isLocked`, the same
   * test the hooks' stand-down uses): a store busy past the wait gets a retry,
   * not a reconnect that would not fix it. No refusal writes — the event goes
   * to this process's ring and the host's `onEvent`, never to the store.
   *
   * Entry is not the only moment that matters, because three tools can WAIT
   * between here and their writes: `recall` embeds its question in line, and
   * `remember` and `session_end` embed at write time — once per entry, in a loop —
   * whenever this server's counterpart has a live embedder (#187 re-review,
   * N5). So the same verdict is asked again at EVERY store write, by the
   * store itself (`writeGuard`, installed in the constructor), and `recall`
   * also asks it right after its await (#187 review, MAJOR-3), before
   * `deliberateRecall` and the host-state line its handle path writes.
   *
   * Cost, measured: `NOTES.md` ("The schema gate").
   */
  private schemaGate(tool: string): ToolResult | null {
    const verdict = this.schemaVerdict();
    return verdict.kind === "ok" ? null : this.refusalFor(tool, verdict, "entry");
  }

  /** The two stamps, read now, as a verdict. Never throws. */
  private schemaVerdict(): SchemaVerdict {
    let found;
    try {
      found = this.counterpart.store.schemaVersions();
    } catch (err) {
      return { kind: isLocked(err) ? "busy" : "unreadable" };
    }
    const storeAhead = schemaAhead(found.store, SCHEMA_VERSION);
    const cacheAhead = schemaAhead(found.cache, CACHE_SCHEMA_VERSION);
    if (!storeAhead && !cacheAhead) return { kind: "ok" };
    return { kind: "ahead", store: found.store, cache: found.cache, storeAhead, cacheAhead };
  }

  /**
   * THE WRITE GUARD the store runs before each write (`Store.guardWrites`): the
   * same verdict, at the moment of the write. Anything but `ok` is remembered
   * for `call` and thrown, so the write stages nothing.
   */
  private writeGuard(site: string): void {
    const verdict = this.schemaVerdict();
    if (verdict.kind === "ok") return;
    this.writeTripped = verdict;
    throw new StoreError("SCHEMA_AHEAD", { site, refusedBy: "mcp-write-guard", verdict: verdict.kind });
  }

  /** One refusal per verdict, the same sentence whether it was caught on
   *  entry or at a write (`at` says which, for the ring). */
  private refusalFor(tool: string, verdict: Exclude<SchemaVerdict, { kind: "ok" }>, at: "entry" | "write"): ToolResult {
    if (verdict.kind === "busy") {
      this.emit("mcp.schema.busy", undefined, { tool, at });
      return this.refuse(tool, "store-busy", { detail: STORE_BUSY_REFUSAL });
    }
    if (verdict.kind === "unreadable") {
      this.emit("mcp.schema.unreadable", undefined, { tool, at });
      return this.refuse(tool, "schema-unreadable", { detail: schemaUnreadableRefusal(this.host) });
    }
    this.emit("mcp.schema.ahead", undefined, {
      tool,
      at,
      store: verdict.store,
      cache: verdict.cache,
      storeExpected: SCHEMA_VERSION,
      cacheExpected: CACHE_SCHEMA_VERSION,
    });
    return this.refuse(tool, "schema-ahead", {
      // The store's stamp ahead is a newer build this server has not loaded;
      // the cache's alone is a newer build's cache (`cacheAheadRefusal`).
      detail: verdict.storeAhead ? staleServerRefusal(this.host) : cacheAheadRefusal(paths.cache(this.counterpart.store.dir), this.host),
      store: { expected: SCHEMA_VERSION, found: verdict.store, ahead: verdict.storeAhead },
      cache: { expected: CACHE_SCHEMA_VERSION, found: verdict.cache, ahead: verdict.cacheAhead },
    });
  }

  // ── the launch record ──────────────────────────────────────────────────────

  /**
   * LEAVE THIS SERVER'S BUILD WHERE THE HOOKS CAN SEE IT — from launch
   * (`bin/serve.ts`) to exit, as `sessions/mcp-server@<pid>.json` under the
   * registry dir (`adapters/sessions.ts#recordServerLaunch`).
   *
   * It is not written into the SESSION's record, which is where the owner's
   * ruling of 2026-09-23 put it, because at launch this process does not know
   * its session: the host passes none (`bin/serve.ts`'s header), and the lazy
   * bind happens at the first Stop ask this server answers. The UserPromptSubmit
   * hook — which knows its session and runs the installed build — finds this
   * record by scope and compares (`sessions.ts#decideUpdateNotice`).
   *
   * An observer writes nothing, this included — and nothing is written while
   * this directory is set `off` or `paused` (#187 review, MAJOR-2): the refusal
   * there says "nothing is recorded or read here", the hooks write no session
   * record there (claude-code CONTRACT §19), and a notice could not reach that
   * directory anyway, because its hooks return before asking.
   *
   * THE HEARTBEAT (`beat`, every `SERVER_HEARTBEAT_MS` on an unref'd timer, so
   * it never keeps the process alive) does two things each tick. It pins the
   * record to this process rather than to a pid the OS may reuse after a hard
   * kill (`sessions.ts#serverBelieved`), by touching it. And it re-reads the
   * scope setting (#187 re-review, N2): switched `off` or `paused` since the
   * last tick, the record is taken away and not touched again; switched back
   * on — or on for the first time, for a server launched in an off directory —
   * the record is written. The record's identity (pid, host pid, start time,
   * build) is fixed at launch, so the file that comes back is the one that
   * went. `heartbeatMs: 0` turns the timer off, for a test. Never throws.
   */
  recordLaunch(opts: { pid?: number; hostPid?: number; heartbeatMs?: number } = {}): ServerRecord | null {
    if (this.observer) return null;
    this.identity = {
      pid: opts.pid ?? process.pid,
      hostPid: opts.hostPid ?? process.ppid,
      scope: canonicalScope(this.placeScope),
      startedAt: this.nowFn(),
      build: installedBuild(),
    };
    const record = this.beat(true);
    const every = opts.heartbeatMs ?? SERVER_HEARTBEAT_MS;
    if (every > 0 && this.heartbeat === null) {
      const timer = setInterval(() => {
        this.beat(false);
      }, every);
      timer.unref?.();
      this.heartbeat = timer;
    }
    this.emit("mcp.launch.recorded", undefined, {
      recorded: record !== null,
      ...(record === null ? { reason: this.launchOff ? "scope-off" : "not-written" } : {}),
      version: this.identity.build.version,
      storeSchema: SCHEMA_VERSION,
      cacheSchema: CACHE_SCHEMA_VERSION,
    });
    return record;
  }

  /**
   * One tick: the scope setting decides whether the record exists, and a record
   * that should exists gets touched (or written, if it is missing). The FIRST
   * write may make the `sessions/` directory; a tick never does
   * (`sessions.ts#refreshServerLaunch`). Never throws.
   */
  private beat(first: boolean): ServerRecord | null {
    const identity = this.identity;
    if (identity === null) return null;
    try {
      // The SERVER's place, never a call's: this tick can land while a
      // Code-tab call served as a Claude Code session is awaiting (`callAs`).
      const off = stanceOfMode(this.scopeVerdict(this.placeScope).mode) === "off";
      if (off) {
        if (!this.launchOff || first) forgetServerLaunch(this.registryDir, identity.pid);
        if (!this.launchOff && !first) this.emit("mcp.launch.scope", undefined, { recorded: false });
        this.launchOff = true;
        return null;
      }
      const wasOff = this.launchOff;
      this.launchOff = false;
      const written = first
        ? recordServerLaunch(this.registryDir, {
            scope: identity.scope,
            build: identity.build,
            pid: identity.pid,
            hostPid: identity.hostPid,
            at: identity.startedAt,
          })
        : refreshServerLaunch(this.registryDir, identity)
          ? identity
          : null;
      if (wasOff && !first) this.emit("mcp.launch.scope", undefined, { recorded: written !== null });
      return written;
    } catch {
      return null;
    }
  }

  /** Stop the heartbeat and take the launch record away at a clean exit.
   *  Best-effort, never throws. */
  forgetLaunch(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.identity === null) return;
    forgetServerLaunch(this.registryDir, this.identity.pid);
    this.identity = null;
  }

  // ── the scope registry ─────────────────────────────────────────────────────

  /**
   * What `<config dir>/scopes.json` says about THIS server's directory, read
   * fresh. Absent registry, absent file, unreadable file: all `unset`, which is
   * on — the same fail direction the hooks take, and for the same reason (a
   * tool may not fail on host trivia).
   */
  private scopeVerdict(scope: string = this.scope): ScopeVerdict {
    if (this.scopesFile === null) return { mode: "unset", matched: null, entry: null };
    return lookupScope(readScopes(this.scopesFile).registry, scope);
  }

  /** The named refusal every tool but `scope` gets in a directory set `off`. */
  private refuseScopeOff(tool: string, verdict: ScopeVerdict): ToolResult {
    this.emit("mcp.scope.off", undefined, { tool, matched: verdict.matched, mode: verdict.mode });
    const words = wordingFor(this.placeHost);
    return this.refuse(tool, "scope-off", {
      scope: this.scope,
      ...(verdict.matched === null ? {} : { setBy: verdict.matched }),
      // In the host's words (`hosts.ts`): Claude Code's name the directory and
      // the entry that set it; Desktop's name its own place. Never `.`.
      detail: (verdict.mode === "paused" ? words.pausedRefusal : words.offRefusal)(this.refusalPlace(verdict)),
    });
  }

  /**
   * THE PLACE A SCOPE REFUSAL NAMES (2026-10-10): this place and, when an
   * ancestor's entry set it, that ancestor, each with its console line built
   * here (`scopes.ts#scopeCommand`) — the folder named, the plugin's launcher
   * and `--config` when this install needs them.
   */
  private refusalPlace(verdict: ScopeVerdict): RefusalPlace {
    const ctx =
      this.scopeCommandCtx ??
      scopeCommandContext({ configPath: this.lifecycleOpts.configPath, pluginRoot: null, home: homedir() });
    const here = canonicalScopePath(this.scope);
    const entry = verdict.matched === null ? here : canonicalScopePath(verdict.matched);
    return {
      here: shortPath(here, ctx.home),
      inherited: entry === here ? null : shortPath(entry, ctx.home),
      entryCommand: (flag) => scopeCommand(entry, flag, ctx),
      hereCommand: (flag) => scopeCommand(here, flag, ctx),
    };
  }

  /**
   * `scope` — read, or set, what this directory is for (owner asks G41–G43).
   *
   * The path is `this.scope` and there is no argument for one: a model that
   * could name the directory could switch off a project it is not in. Reading
   * is allowed in every stance, including observer and `off`, because "why did
   * this session record nothing" must always be answerable; writing refuses
   * under observer exactly as every other write does.
   */
  private scopeTool(args: Record<string, unknown>): ToolResult {
    const mode = args["mode"];
    const file = this.scopesFile;
    const verdict = this.scopeVerdict();
    const read = file === null ? null : readScopes(file);

    if (mode === undefined) {
      this.emit("mcp.scope.read", undefined, { mode: verdict.mode, matched: verdict.matched });
      return this.result(
        {
          scope: this.scope,
          mode: verdict.mode,
          stance: stanceOfMode(verdict.mode),
          ...(verdict.matched === null ? {} : { setBy: verdict.matched }),
          ...(verdict.entry?.since === undefined ? {} : { since: verdict.entry.since }),
          ...(verdict.entry?.note === undefined ? {} : { note: verdict.entry.note }),
          ...(verdict.mode === "paused" ? { resumesTo: resumeTarget(verdict.entry) } : {}),
          ...(file === null ? {} : { registry: file }),
          // A registry in trouble is never silent, on any surface that has a
          // reader (#92 review, F2): entries nobody can honour read as unset,
          // which is ON, and this is the one place a model can see that.
          ...(read === null || read.error === null ? {} : { registryError: read.error }),
          ...(read === null || read.refused.length === 0
            ? {}
            : { registryRefused: read.refused.map((r) => `${r.key} (${r.detail})`) }),
          detail:
            verdict.mode === "unset"
              ? "Nothing is set for this directory or any parent, so it is on by default. Ask the user before setting it."
              : "This is what the host's scope registry says about this directory.",
        },
        false,
      );
    }

    if (typeof mode !== "string" || !["on", "observer", "off", "pause", "resume"].includes(mode)) {
      return this.refuse("scope", "mode-unusable", {
        detail: "`mode` takes on, observer, off, pause or resume — or omit it to read the setting.",
      });
    }
    // In Desktop an `observer` that comes only from `claude-desktop:`'s own
    // entry does not lock this door: the scope tool is how that entry is
    // changed back, as it is the one door an `off` leaves open. The store's own
    // observer bit still does.
    // A call served AS a Claude Code session (G21) stands where that session's
    // own server stands: its directory's `observer` locks this door too, as it
    // does in Claude Code (review of #309) — Desktop's exemption is for
    // `claude-desktop:`'s own entry only.
    if (this.desktop && this.callAs === null ? this.storeObserver : this.observer) return this.standDown("scope");
    if (file === null) {
      return this.refuse("scope", "no-registry", {
        detail:
          "This server was launched without a scope registry to write, so it can only read. Use `counterparts scope <path> --on|--observer|--off` instead.",
      });
    }
    if (read !== null && read.error !== null) {
      return this.refuse("scope", "registry-unreadable", {
        registry: file,
        detail: `The registry could not be read — ${read.error}. Nothing was changed; a person has to fix it (\`counterparts scope <path> --off --force\` replaces it).`,
      });
    }
    // ENTRIES THIS READ REFUSED (#92 review, F2). The file parses, so this tool
    // COULD write — and a write rewrites the whole file from what parsed, which
    // would silently delete another directory's `off`. A model may not make that
    // trade on somebody's behalf: it refuses, names them, and leaves it to the
    // person at the console (`counterparts scope <path> --off --force`).
    if (read !== null && read.refused.length > 0) {
      return this.refuse("scope", "registry-partly-unreadable", {
        registry: file,
        refused: read.refused.map((r) => `${r.key} (${r.detail})`),
        detail: `${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in this registry could not be read, and every write rewrites the whole file — so writing here would drop ${read.refused.length === 1 ? "it" : "them"}. Nothing was changed. Tell the user; fixing the file, or \`counterparts scope <path> --<mode> --force\`, is a person's call.`,
      });
    }

    let target: ScopeMode;
    if (mode === "resume") {
      const own = ownEntry(read?.registry ?? null, this.scope);
      if (own === null) {
        return this.refuse("scope", "nothing-to-resume", {
          detail:
            verdict.entry === null
              ? "Nothing is set for this directory, so it is already on."
              : `Nothing is set for this directory itself — it inherits ${verdict.matched ?? "?"}. Set this one directly instead.`,
        });
      }
      target = resumeTarget(own);
    } else {
      target = mode === "pause" ? "paused" : (mode as ScopeMode);
    }

    // ONE function for the change, applied to the registry this call read and —
    // if the file moved under it — to what is there now (#92 review, F3). The
    // other writer is the console `scope` command, in another process.
    const apply = (from: ScopeRegistry | null): ScopeRegistry =>
      setScope(from, this.scope, target, {
        at: new Date(this.nowFn()).toISOString(),
        // ONE RULE FOR THE NOTE ON BOTH SURFACES (#92 review, F5): an omitted
        // note CARRIES what is there, an empty string CLEARS it. The filter here
        // used to drop `""` as though it had not been given, so the console
        // cleared a note and this tool silently kept it — the same two words
        // meaning different things depending on which door you used.
        ...(typeof args["note"] === "string" ? { note: args["note"] } : {}),
      });
    const next = apply(read?.registry ?? null);
    try {
      if (read === null) writeScopes(file, next);
      else writeScopes(file, next, { basedOn: read, reapply: apply });
    } catch (err) {
      return this.refuse("scope", "registry-unwritable", {
        registry: file,
        detail: `The registry could not be written (${err instanceof Error ? err.message : String(err)}). Nothing was changed.`,
      });
    }
    this.emit("mcp.scope.set", undefined, { mode: target, scope: this.scope });
    return this.result(
      {
        set: true,
        scope: this.scope,
        mode: target,
        stance: stanceOfMode(target),
        registry: file,
        // In the HOST's words (`hosts.ts`, 2026-09-30): Claude Code's name its
        // hooks and their boundaries — the text is what it always was, and why
        // it says what it says sits beside it in the table — and Desktop,
        // which has neither, gets its own.
        detail: target === "off" || target === "paused" ? wordingFor(this.placeHost).scopeOff : wordingFor(this.placeHost).scopeOn,
      },
      false,
    );
  }

  /**
   * `remember` (was `note` until 2026-10-10) — deliberate remembering in the
   * moment; with the end-of-session ask, the only road from conversation to
   * memory since the keyless sweep came out (2026-09-24).
   *
   * Two steps, and the ORDER is the point: the words ride the buffer as their
   * own span first, then the deposit claims that span by hash. Without the
   * claim the end-of-session sweep would find the jot's own text sitting in the
   * buffer and mint it a second time, so the deliberate note would cost two
   * memories — which is how a "remember this" channel becomes a duplication
   * engine.
   */
  private async rememberTool(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("remember");
    // REMARK (2026-10-11, the about-marks lane): what an existing memory this
    // session was shown is about, changed in the moment, as me. Alone, or
    // beside anything else the call does.
    const remarkArg = args["remark"];
    if (remarkArg === undefined) return this.rememberCore(args);
    if (remarkArg === null || typeof remarkArg !== "object" || Array.isArray(remarkArg)) {
      return this.refuse("remember", "remark-malformed", { detail: "remark is one object: {id, about, why}." });
    }
    const hasText = typeof args["text"] === "string" && args["text"].trim().length > 0;
    if (!hasText && args["settle"] === undefined && args["feelingsNow"] === undefined) {
      const out = this.remarkOutcome(remarkArg as Record<string, unknown>);
      return this.result({ stored: false, reason: "remark-only", remark: out }, out["ok"] !== true);
    }
    const done = await this.rememberCore(args);
    const body = (done as { structuredContent?: Record<string, unknown> }).structuredContent;
    if (body === undefined) return done;
    const out = this.remarkOutcome(remarkArg as Record<string, unknown>);
    // An error only when nothing landed, as with a settle or a feeling now.
    return this.result({ ...body, remark: out }, (done as { isError?: boolean }).isError === true && out["ok"] !== true);
  }

  /** `remember` without its `remark`: the note, the settle, the feelings now. */
  private async rememberCore(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("remember");
    const text = args["text"];
    // SETTLE (2026-09-29, contradictions): two memories that already exist,
    // settled without writing a new one. With `text` too, both happen.
    const settleArg = args["settle"];
    if (settleArg !== undefined && (settleArg === null || typeof settleArg !== "object" || Array.isArray(settleArg))) {
      return this.refuse("remember", "settle-malformed", {
        detail: "settle is an object: {pair} or {holds, over}, with how (changed, corrected or open) and a short why.",
      });
    }
    const hasText = typeof text === "string" && text.trim().length > 0;
    // FEELINGS NOW (2026-10-02, lane B): how a memory this session was shown
    // feels now, recorded beside the first. With `text` too, both happen.
    const nowArg = args["feelingsNow"];
    if (nowArg !== undefined && !Array.isArray(nowArg)) {
      return this.refuse("remember", "feelings-now-malformed", {
        detail: "feelingsNow is a list: one object each, {id, emotion, core?, strength?, carried_by?, whose?}.",
      });
    }
    if (!hasText && settleArg === undefined && nowArg !== undefined) return this.feelingsNowOnly(nowArg as unknown[]);
    if (!hasText && settleArg !== undefined) {
      const settled = this.settleOnly(settleArg as Record<string, unknown>);
      return nowArg === undefined ? settled : this.withFeelingsNow(settled, nowArg as unknown[]);
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      return this.refuse("remember", "text-required", {});
    }
    const salience = args["salience"];
    if (salience !== undefined && (typeof salience !== "number" || !Number.isFinite(salience))) {
      return this.refuse("remember", "salience-not-a-number", {});
    }
    const dims = readDimensions(args);
    if (dims === null) {
      return this.refuse("remember", "dimension-out-of-range", {
        detail: "relevance, emotional and predictive are each a number from 0 to 1.",
      });
    }
    // THE REMINDER DATE AND HOW IT COMES BACK (2026-09-26) — checked before
    // anything is captured, so an unreadable one is a refusal that says which
    // shapes ARE readable rather than a note that lands without its date.
    const dated = readReminder(args);
    if ("refused" in dated) return this.refuse("remember", dated.refused, { detail: dated.detail });
    // Unbound, the note is filed under the session this server's host is
    // running here, found by its process (2026-10-01, `hostSession`), and
    // under nobody only when that is not exact.
    const session = this.session ?? this.hostSession() ?? UNBOUND_SESSION;

    const captured = this.counterpart.captureJot({ session, scope: this.scope, text });
    const ownSpanHash = captured.spans[0]?.hash ?? null;

    const draft: Record<string, unknown> = { content: text };
    if (typeof args["kind"] === "string") draft["kind"] = args["kind"];
    if (typeof args["title"] === "string") draft["title"] = args["title"];
    // `updates` travels as a FIELD, exactly as it does on a `session_end` entry
    // (added 2026-09-04: the Stop ask told the model to write `updates: <id>`
    // and this tool had nowhere to put it, so four notes landed as prose with no
    // link). The declaration is resolved downstream — `remember/updates.ts`
    // validates it, `mint.ts` writes the RESOLVED id — and one that resolves to
    // nothing lands unlinked rather than refusing the note.
    if (typeof args["updates"] === "string") draft["updates"] = args["updates"];
    // HOW it settles the memory it updates (2026-09-29). Validated by intake:
    // an unknown kind is refused `HOW_UNKNOWN`, and one without `updates` is dropped.
    if (args["how"] !== undefined) draft["how"] = args["how"];
    if (salience !== undefined) draft["claimed"] = salience;
    if (Object.keys(dims).length > 0) draft["salience"] = dims;
    // AN OPEN THREAD, or the closing of one (2026-10-01, lane 8): a boolean
    // rides as sent — `false` matters beside an `updates` (`closeThread`).
    if (typeof args["unresolved"] === "boolean") draft["unresolved"] = args["unresolved"];
    Object.assign(draft, dated.fields);

    const model = this.sessionModel(session);
    const feelings = readFeelings(args["feelings"]);
    if ("refused" in feelings) {
      return this.refuse("remember", "feelings-malformed", { detail: feelings.refused });
    }
    const about = readAbout(args["about"]);
    if ("refused" in about) return this.refuse("remember", "about-malformed", { detail: about.refused });
    const traits = readTraits(args["traits"]);
    if ("refused" in traits) return this.refuse("remember", "traits-malformed", { detail: traits.refused });
    // v12: when it happened, who said it, what kind — never a refusal: what
    // cannot be read is dropped and said beside the memory that landed.
    const facts = readWriteFacts(args, this.today());
    const deposit = await this.counterpart.submitJot(draft, {
      session,
      scope: this.scope,
      ownSpanHash,
      facts: facts.sent,
      // What it is about sets an unclaimed memory's default floor (2026-10-10).
      about: about.mark,
      ...(model === undefined ? {} : { model }),
      // This call's stance, which a Code-tab call on Desktop's server can hold
      // when the store opened as a guest (2026-10-02).
      owner: this.owner,
    });
    const neighbours = this.neighboursOf(deposit);
    this.markSeen(neighbours.map((n) => n.id));
    const feltNow = nowArg === undefined ? null : this.feelingsNowOutcome(nowArg as unknown[]);
    // WITH A SETTLE TOO (review of #284, M2): the call is an error only when
    // NOTHING landed — a refused note beside a settle that landed is not one,
    // so a retry does not run into `already-settled`.
    const settle = settleArg === undefined ? null : this.settleOutcome(settleArg as Record<string, unknown>);
    return this.depositResult("remember", deposit, {
      ...this.recordFeelings(deposit, feelings.inputs, model),
      ...this.recordAbout(deposit, about.mark),
      ...this.recordTraits(deposit, traits.inputs, model),
      ...reminderEcho(deposit, dated, this.today()),
      ...factsEcho(deposit, facts),
      ...this.settledOf(deposit, args["how"] !== undefined),
      ...threadOf(deposit),
      // IN THE PAYLOAD, so it rides in `structuredContent` — which is what
      // Claude Code hands the model (the #282 lesson, f387f55).
      ...(neighbours.length === 0 ? {} : { neighbours, neighboursHint: NEIGHBOURS_HINT }),
      ...(settle === null ? {} : { settle }),
      ...(feltNow === null ? {} : { feelingsNow: feltNow }),
      // AN ERROR ONLY WHEN NOTHING LANDED (review of #316): a refused note
      // beside a feeling that was recorded is not one, or the resend meets
      // `once-a-day`.
    }, settle === null && feltNow === null ? undefined : !deposit.deposited && settle?.["ok"] !== true && Number(feltNow?.["recorded"] ?? 0) === 0);
  }

  /**
   * `remember` with `feelingsNow` and no `text` (2026-10-02, lane B): record how
   * memories this session was shown feel now, and write nothing else. The
   * path is the reflection's (`Reflections#feelAgain`); an error only when
   * nothing was recorded.
   */
  private feelingsNowOnly(list: readonly unknown[]): ToolResult {
    const out = this.feelingsNowOutcome(list);
    return this.result({ stored: false, reason: "feelings-now-only", feelingsNow: out }, out["recorded"] === 0);
  }

  /**
   * WHOSE "shown" A CALL IS (review of #316): on Desktop, the session the call
   * is served as; in Claude Code, the session its host is running now (a
   * /clear starts a new one in the same process), else the bound one.
   */
  private seenKey(): string {
    if (this.desktop) return this.session ?? UNBOUND_SESSION;
    return this.hostSession() ?? this.session ?? UNBOUND_SESSION;
  }

  /** Remember that the calling session was shown these memories. */
  private markSeen(ids: readonly string[], key?: string): void {
    if (ids.length === 0) return;
    key ??= this.seenKey();
    const set = this.seenBySession.get(key) ?? new Set<string>();
    for (const id of ids) set.add(id);
    // Newest last; the oldest session is let go past the bound.
    this.seenBySession.delete(key);
    this.seenBySession.set(key, set);
    while (this.seenBySession.size > SEEN_SESSIONS) {
      const oldest = this.seenBySession.keys().next().value;
      if (oldest === undefined) break;
      this.seenBySession.delete(oldest);
    }
  }

  /** A settle-only result with the feelings now beside it. */
  private withFeelingsNow(settled: ToolResult, list: readonly unknown[]): ToolResult {
    const out = this.feelingsNowOutcome(list);
    const body = (settled as { structuredContent?: Record<string, unknown> }).structuredContent;
    if (body === undefined) return settled;
    const ok = body["settle"] !== undefined && (body["settle"] as Record<string, unknown>)["ok"] === true;
    return this.result({ ...body, feelingsNow: out }, !ok && out["recorded"] === 0);
  }

  /**
   * One `feelingsNow` list through the core, as the result carries it. What
   * this session was shown: what this server handed it (`seenHere`) and what
   * ambient recall surfaced for its session, when the session is known.
   * Never throws.
   */
  private feelingsNowOutcome(list: readonly unknown[]): Record<string, unknown> {
    try {
      const { session, shown } = this.shownToCaller();
      const model = this.sessionModel(session);
      const items = list.map((x) => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {}));
      const done = this.counterpart.reflections.feelAgain({
        session,
        shown,
        feelings: items,
        ...(model === undefined ? {} : { model }),
        // This call's stance (#317 × #318): a Code-tab call on Desktop's
        // server may feel again what its recall showed it.
        owner: this.owner,
      });
      if (!done.ok) return { recorded: 0, reason: done.reason };
      const recorded = done.feelings.filter((f) => f.ok && f.reason === "recorded-later").length;
      this.emit("mcp.remember.feelingsNow", undefined, { sent: list.length, recorded });
      return { recorded, results: done.feelings };
    } catch (err) {
      return { recorded: 0, reason: "threw", detail: String((err as Error).message ?? err) };
    }
  }

  /**
   * WHAT THE CALLING SESSION WAS SHOWN: what this server handed it
   * (`seenBySession`) and what ambient recall surfaced for its session, when
   * the session is known. Read by `feelingsNow` and `remark` alike.
   */
  private shownToCaller(): { session: string; shown: Set<string> } {
    const session = this.seenKey();
    const shown = new Set(this.seenBySession.get(session) ?? []);
    if (session !== UNBOUND_SESSION) {
      try {
        // SURFACED, not footnoted (review of #316): a title in a footnote or
        // a link's pointer is not being shown the memory.
        for (const [id, rec] of Object.entries(loadGateState(this.counterpart.store, session).state.surfaced)) {
          if (rec.tier === "surfaced") shown.add(id);
        }
      } catch {
        // The ambient record unreadable: what this server showed still counts.
      }
    }
    return { session, shown };
  }

  /**
   * One `remark` through the core (2026-10-11), as the result carries it:
   * only on a memory this session was shown (as `feelingsNow`), then
   * `Counterpart.markAbout` by `self` — the store function the owner's
   * `counterparts about` uses, which keeps a dream's or a reflection's words
   * to work or world. Never throws.
   */
  private remarkOutcome(arg: Record<string, unknown>): Record<string, unknown> {
    const id = typeof arg["id"] === "string" ? arg["id"].trim() : "";
    try {
      if (id.length === 0) return { ok: false, reason: "remark-malformed", detail: "remark needs the memory's id: {id, about, why}." };
      const { shown } = this.shownToCaller();
      if (!shown.has(id)) {
        return { ok: false, reason: "not-shown-or-gone", detail: `${id} was not shown in this session: recall it by id first, then re-mark it.` };
      }
      const out = this.counterpart.markAbout({
        id,
        mark: typeof arg["about"] === "string" ? arg["about"] : "",
        by: "self",
        why: typeof arg["why"] === "string" ? arg["why"] : null,
        owner: this.owner,
      });
      this.emit("mcp.remember.remark", id, { ok: out.ok, reason: out.ok ? (out.changed ? "marked" : "unchanged") : out.reason });
      return { ...out };
    } catch (err) {
      return { ok: false, reason: "threw", detail: String((err as Error).message ?? err) };
    }
  }

  /**
   * `remember` with `settle` and no `text` (2026-09-29): settle two memories that
   * already exist — a flagged pair, or two a write showed — and write nothing
   * else. The settle is `contradictions.ts#settle`'s, attributed to this
   * session on the trail.
   */
  private settleOnly(arg: Record<string, unknown>): ToolResult {
    const outcome = this.settleOutcome(arg);
    this.emit("mcp.remember.settle", typeof outcome["pair"] === "string" ? outcome["pair"] : undefined, {
      ok: outcome["ok"] === true,
      reason: typeof outcome["reason"] === "string" ? outcome["reason"] : null,
    });
    return this.result({ stored: false, reason: "settle-only", settle: outcome }, outcome["ok"] !== true);
  }

  /** One settle through the core, as the result carries it. Never throws. */
  private settleOutcome(arg: Record<string, unknown>): Record<string, unknown> {
    const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);
    try {
      const pair = str(arg["pair"]);
      const holds = str(arg["holds"]);
      const over = str(arg["over"]);
      const out = this.counterpart.settleContradiction({
        ...(pair === undefined ? {} : { pair }),
        ...(holds === undefined ? {} : { holds }),
        ...(over === undefined ? {} : { over }),
        how: typeof arg["how"] === "string" ? arg["how"] : "",
        why: typeof arg["why"] === "string" ? arg["why"] : null,
        actor: "session",
        actorId: this.session ?? null,
      });
      return { ...out };
    } catch (err) {
      return { ok: false, reason: "threw", detail: String((err as Error).message ?? err) };
    }
  }

  /**
   * WHAT THE `updates` DID (2026-09-29): on an ordinary memory, how it was
   * settled or why it was not; on a belief, a core memory, a current-state
   * fact, an entity or a protected memory, when the writer SENT a `how`, that
   * it was not applied and which path ran instead. Nothing when nothing was
   * declared.
   */
  private settledOf(deposit: DepositResult, sentHow: boolean): Record<string, unknown> {
    // HELD (2026-10-09, the update guard): the memory named in `updates`
    // looked unrelated, so nothing was settled or linked. Its own words come
    // back with the ask the neighbours carry, and the two ids to settle with.
    const h = deposit.held;
    if (h !== undefined) {
      return {
        settled: {
          ok: false,
          held: true,
          reason: "looks-unrelated",
          how: h.how,
          holds: deposit.memoryId,
          over: h.over,
          ...(h.title === null ? {} : { title: h.title }),
          ...(h.text === null ? {} : { text: h.text }),
          detail: HELD_HINT,
        },
      };
    }
    const r = deposit.revision;
    if (r === undefined) return {};
    const o = r.settle;
    if (o !== undefined) {
      if (!o.ok) return { settled: { ok: false, reason: o.reason, detail: o.detail } };
      return {
        settled: {
          ok: true,
          pair: o.pair,
          how: o.how,
          ...(o.how === "open" ? { with: r.targetId } : { over: o.over }),
          ...(o.faded === null ? {} : { faded: { before: o.faded.before, after: o.faded.after } }),
          ...(o.archived === null ? {} : { archived: o.archived }),
          ...(o.closed.length === 0 ? {} : { closedFlags: o.closed }),
          ...(o.note === undefined ? {} : { note: o.note }),
        },
      };
    }
    if (!sentHow) return {};
    const why =
      r.path === "belief"
        ? "the memory it updates is a belief, which changes by pressure over days"
        : r.path === "identity"
          ? `the memory it updates is a core memory, which changes by pressure over days${r.pressurePair === undefined ? "" : `; meanwhile the pair is recorded unsettled (${r.pressurePair}), so recall shows the older one as possibly out of date`}`
          : r.path === "current-state"
            ? "the memory it updates is a current-state fact, which is replaced now"
            : r.reason === "target-is-an-entity"
              ? "the memory it updates is an entity card, which only links"
              : r.reason === "protected-refuses-revision"
                ? "the memory it updates is protected by the owner"
                : `the update did not reach an ordinary memory (${r.reason})`;
    return { settled: { ok: false, applied: false, path: r.path, reason: r.reason, detail: `how was not applied: ${why}.` } };
  }

  /**
   * THE NEAREST FEW EXISTING MEMORIES of one just stored (2026-09-29), when
   * any clear the similarity bar — minus the one it updates. Ids, titles and
   * a short excerpt; empty when nothing is close or nothing was stored.
   */
  private neighboursOf(deposit: DepositResult, siblings: readonly string[] = [], room: number = CONTRADICTION_TUNABLES.NEIGHBOURS): readonly Neighbour[] {
    if (!deposit.deposited || deposit.memoryId === null || room <= 0) return [];
    // Not the memory it updates, and not a sibling written by the same call
    // (review of #284, M1): those are this writer's own words, not existing ones.
    // A held one (2026-10-09) is already shown whole, beside its own ask.
    const exclude = [deposit.revision?.targetId, deposit.mint?.updates, deposit.held?.over, ...siblings].filter((x): x is string => typeof x === "string");
    return this.counterpart.writeNeighbours(deposit.memoryId, { exclude, owner: this.owner }).slice(0, room);
  }

  /**
   * `recall` — the deeper look. Deposits no memory and touches no physics.
   * Three kinds of ask, exactly one per call:
   *
   *   - a QUESTION, with a REQUIRED `mode` (Release B, 2026-10-03): `facts`
   *     (`facts.ts`) or `meaning` (`meaning.ts`), each its own path with its
   *     own ranking and its own answer — labeled lines, shipped as `answer`;
   *   - `ids` or a `handle`: an exact address, read whole (`deliberate.ts`).
   *     They take no mode: opening a memory is not a search. A `mode` sent
   *     beside one is ignored, and the result says so.
   *
   * What it writes is host state and bookkeeping, never a memory: a handle
   * path that was answered leaves a line in `adapters/expansions.ts`'s
   * resolution log, so the boundary's credit pass can tell which memory a
   * TITLE reached (`noteHandleResolution`, `mcp/INTERFACE-GAPS` §9); a
   * question's shown memories are recorded for this session as QUOTABLE
   * (`noteAsked`), so quoting one's words in a reply credits it at the
   * boundary as quoting a loud surfacing does; and one durable `mcp.recall`
   * row (`noteRecall`).
   */
  private async recallTool(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("recall");
    const handle = args["handle"];
    // THE LAST EXCHANGE (2026-10-11): a read of this directory's span buffer.
    // It stands down under observer like the rest of recall (G5, review of #392).
    if (typeof handle === "string" && handle.trim().toLowerCase() === LAST_EXCHANGE_HANDLE && args["question"] === undefined && args["ids"] === undefined) {
      return this.lastExchangeTool();
    }
    const question = args["question"];
    const ids = args["ids"];
    if (handle !== undefined && typeof handle !== "string") {
      return this.refuse("recall", "handle-not-a-string", {});
    }
    if (question !== undefined && typeof question !== "string") {
      return this.refuse("recall", "question-not-a-string", {});
    }
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((v) => typeof v !== "string"))) {
      return this.refuse("recall", "ids-not-a-string-array", {});
    }
    // PARTS (2026-09-28): which part of each body asked for by id.
    const part = args["part"];
    if (part !== undefined && (typeof part !== "number" || !Number.isInteger(part) || part < 1)) {
      return this.refuse("recall", "part-not-a-positive-integer", {});
    }
    // PAGES (2026-10-03): which page of a question's answer.
    const page = args["page"];
    if (page !== undefined && (typeof page !== "number" || !Number.isInteger(page) || page < 1)) {
      return this.refuse("recall", "page-not-a-positive-integer", {});
    }
    const mode = args["mode"];
    if (mode !== undefined && mode !== "facts" && mode !== "meaning") {
      return this.refuse("recall", "mode-unknown", { modes: RECALL_MODE_WORDS });
    }
    const askedIds = ((ids as string[] | undefined) ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    const asked = typeof question === "string" && question.trim().length > 0;
    const addressed = (typeof handle === "string" && handle.trim().length > 0) || askedIds.length > 0;

    // A QUESTION, alone: a mode answers it.
    if (asked && !addressed) {
      if (mode === undefined) return this.refuse("recall", "mode-required", { modes: RECALL_MODE_WORDS });
      return this.askQuestion(question, mode, typeof page === "number" ? page : 1);
    }

    // Whose call this is, asked ONCE (review of #390): on Claude Code it is a
    // registry scan. Unbound, it is the very session the old
    // `this.session ?? this.hostSession()` found, so the recall is unchanged.
    const key = this.seenKey();
    const result = deliberateRecall(
      this.counterpart,
      {
        ...(typeof handle === "string" ? { handle } : {}),
        ...(typeof question === "string" ? { question } : {}),
        ...(askedIds.length > 0 ? { ids: askedIds } : {}),
      },
      { sessionId: this.session ?? key, owner: this.owner },
    );
    const resolved = this.noteHandleResolution(handle, result);
    // THE MEASUREMENT (2026-09-28): did this lookup fetch what a mechanism's
    // index offered only in part? Counted per mechanism, never the ids.
    const payload: Record<string, unknown> = {
      ...this.recallPayload(result, typeof part === "number" ? part : 1),
      ...(mode !== undefined && addressed ? { modeIgnored: "ids and handle are exact addresses; mode applies to a question only." } : {}),
    };
    // Counted from what was DELIVERED (review of #278), not what was asked:
    // an id that waited is not a lookup yet, and one is fetched whole only
    // when its last part went out.
    const delivered = result.path === "handle" ? ((payload["memories"] as { id: string; part?: number; parts?: number }[] | undefined) ?? []) : [];
    const fromIndex = delivered.length > 0 ? this.lookupsFromIndex(delivered.map((m) => ({ id: m.id, whole: (m.part ?? 1) >= (m.parts ?? 1) }))) : {};
    this.emit("mcp.recall", undefined, {
      path: result.path,
      reason: result.reason,
      // G50: did this call earn credit that `reference.ts` could not have given
      // it on its own? Ring-only, like every other number on this row.
      handleResolved: resolved,
      semantic: result.semantic,
      returned: result.memories.length,
      considered: result.considered,
      storeSize: result.storeSize,
      owner: this.owner,
      // Scar §2.4: a budget gets an event when it is APPROACHED, not only when
      // it blows. The three overflowed calls of 2026-09-04 emitted nothing.
      chars: payload["chars"] as number,
      truncated: payload["truncated"] === true,
      droppedForBudget: 0,
    });
    // Only what was DELIVERED (review of #316): an id left `waiting` was not shown.
    const deliveredIds = ((payload["memories"] as { id?: unknown }[] | undefined) ?? []).map((m) => m.id).filter((x): x is string => typeof x === "string");
    this.noteRecall(
      {
        path: result.path,
        reason: result.reason,
        semantic: result.semantic,
        considered: result.considered,
        storeSize: result.storeSize,
        expanded: result.path === "handle" ? result.memories.length : 0,
        blockedBy: addressBlocked(result),
      },
      askedIds.length,
      question,
      resolved,
      payload,
      deliveredIds,
      key,
      fromIndex,
    );
    this.markSeen(deliveredIds, key);
    const bad =
      result.reason === "no-argument" ||
      result.reason === "both-arguments" ||
      result.reason === "handle-unknown" ||
      result.reason === "ids-too-many" ||
      result.reason === "handle-confidential-withheld";
    return this.result(payload, bad);
  }

  /**
   * `recall` with the handle `last exchange` (2026-10-11; Mike's design of
   * 2026-10-10, "pull, not push"): the last thing said to ANOTHER session in
   * this server's directory and that session's last text reply, inside about
   * a day, each cut at a sentence — what the wake's "Last said here" line
   * points at, from the same reader (`Counterpart#lastExchange`). Read at the
   * call and never stored: no memory, no credit, no seen set, no durable row
   * — a ring event only. Never another directory's: the buffer it reads is
   * this one's. Never reached under observer (recall stands down, G5); and
   * the words go only to the owner's session (review of #392): a span is the
   * raw slice, which no confidential mark has reached yet (G6).
   */
  private lastExchangeTool(): ToolResult {
    if (!this.owner) {
      this.emit("mcp.recall.lastexchange", undefined, { found: false, owner: false });
      return this.result(
        {
          path: "handle",
          reason: "owner-only",
          handle: LAST_EXCHANGE_HANDLE,
          detail: "The last exchange is read only in the owner's own session.",
        },
        false,
      );
    }
    const reader = this.session ?? this.hostSession();
    const ex = this.counterpart.lastExchange({
      scope: this.scope,
      session: reader,
      sessions: () =>
        listSessions(this.registryDir).map((r) => ({
          session: r.sessionId,
          scope: r.scope,
          startedAt: r.startedAt,
          lastAt: Math.max(r.lastBoundaryAt, r.endedAt ?? 0),
          live: isLive(r, this.nowFn(), this.sessionTtlMs),
          endedAt: r.endedAt,
        })),
    });
    this.emit("mcp.recall.lastexchange", undefined, { found: ex !== null });
    if (ex === null) {
      return this.result(
        {
          path: "handle",
          reason: "no-exchange",
          handle: LAST_EXCHANGE_HANDLE,
          detail: "No exchange with another session in this folder in about the last day was captured.",
        },
        false,
      );
    }
    return this.result(
      {
        path: "handle",
        reason: "last-exchange",
        handle: LAST_EXCHANGE_HANDLE,
        ...lastExchangeAnswer(ex, { zone: this.counterpart.store.zone(), now: this.nowFn() }),
      },
      false,
    );
  }

  /**
   * A QUESTION, answered by its mode (Release B, 2026-10-03). Embedded in
   * line first — the one deliberate path allowed to (the ruling of
   * 2026-09-04) — with every way the embedding can decline said by name
   * (`deliberate.ts#embedQuestion`, which the console's `ask` shares). The
   * answer is the mode's own rendering, shipped whole as `answer`; the ids it
   * showed go to the seen set and the quotable record.
   */
  private async askQuestion(question: string, mode: "facts" | "meaning", page: number): Promise<ToolResult> {
    const embedded = await embedQuestion(this.embedder, question);
    // THE GATE AGAIN, after this tool's wait: a migration that committed
    // during the embedding's round-trip must not be recalled past.
    const moved = this.schemaGate("recall");
    if (moved !== null) return moved;
    // Asked once (review of #390), as on the address path.
    const key = this.seenKey();
    const ctx = {
      counterpart: this.counterpart,
      sessionId: this.session ?? key,
      owner: this.owner,
      ...(this.scope === undefined ? {} : { scope: this.scope }),
      vector: embedded.vector,
      semantic: embedded.semantic,
      asker: "self" as const,
    };
    let answer: string;
    let ids: readonly string[];
    let body: Record<string, unknown>;
    let row: RecallRowFields;
    if (mode === "facts") {
      const r = factsRecall(ctx, question, { page });
      answer = renderFacts(r);
      ids = r.memories.map((m) => m.id);
      body = {
        matched: r.matched,
        page: r.page,
        pages: r.pages,
        ...(r.faded > 0 ? { faded: r.faded } : {}),
      };
      row = {
        path: "question",
        reason: r.reason,
        semantic: r.semantic,
        considered: r.considered,
        storeSize: r.storeSize,
        expanded: 0,
        blockedBy: r.blockedBy,
        mode,
        matched: r.matched,
        shown: r.memories.length,
        faded: r.faded,
        page: r.page,
        ...(r.time === null ? {} : { time: r.time.anchor?.kind ?? "window" }),
      };
    } else {
      const r = meaningRecall(ctx, question, { page });
      answer = renderMeaning(r);
      ids = r.shown;
      body = { page: r.page, pages: r.pages, counts: { ...r.counts } };
      row = {
        path: "question",
        reason: r.reason,
        semantic: r.semantic,
        considered: r.counts.moments + r.counts.faded,
        storeSize: 0,
        expanded: 0,
        blockedBy: {},
        mode,
        matched: r.counts.moments,
        shown: ids.length,
        faded: r.counts.faded,
        page: r.page,
        counts: { ...r.counts },
      };
    }
    const payload: Record<string, unknown> = {
      path: "question",
      mode,
      reason: row.reason,
      semantic: row.semantic,
      ...body,
      chars: answer.length,
      answer,
      ids: [...ids],
    };
    this.emit("mcp.recall", undefined, {
      path: "question",
      mode,
      reason: row.reason,
      semantic: row.semantic,
      returned: ids.length,
      considered: row.considered,
      owner: this.owner,
      chars: answer.length,
      truncated: false,
      droppedForBudget: 0,
    });
    this.noteRecall(row, 0, question, false, payload, ids, key);
    this.markSeen(ids, key);
    this.noteAsked(ids, key);
    return this.result(payload, false);
  }

  /**
   * THE QUOTABLE RECORD (Release B, 2026-10-03): the memories a question's
   * answer showed with their words, recorded for the asking session so the
   * boundary's credit pass may count a QUOTE of one (`Counterpart#
   * creditReferences`, `reference.ts`'s verbatim window) — the owner's 09-14
   * rule, opening or quoting credits, extended to deliberate results. A list
   * shown does not credit; only a quote of its words in a reply does. Keyed
   * like the seen set (`seenKey`); nothing for a session nobody identified.
   * Never throws.
   */
  private noteAsked(ids: readonly string[], key?: string): void {
    if (ids.length === 0) return;
    const session = key ?? this.seenKey();
    if (session === UNBOUND_SESSION) return;
    this.telemetry(() => {
      this.counterpart.noteAsked(session, ids);
    });
  }

  /**
   * THE DURABLE ROW for one deliberate recall (2026-09-20, E2).
   *
   * `docs/recall-surfacing-diagnosis-2026-09-18.md`: this adapter wrote no
   * durable row at all, so "the session went looking and nothing came" and "the
   * session never went looking" were the same silence, and the fired view could
   * only call the mechanism blind. The ring emit above is unchanged — it is the
   * live debugging channel and it dies with the process; this is the fact that
   * outlives it.
   *
   * **Never the question.** `queryChars` is its LENGTH: a deliberate question
   * is the one string on this path that could carry somebody's private words,
   * and a row in a store that will be read months later may not hold it (scar
   * §2.20). The ids it DELIVERED are on it, bounded, and its session when
   * known (2026-10-11, `MCP_RECALL_EVENT`'s note) — never the ids it was asked
   * for and did not give.
   *
   * `blockedBy` DOES carry `confidential-withheld`, which the wire deliberately
   * does not (§9.1 G5). The two audiences are different: the caller may be any
   * session, and the row is the owner's own store, where the memory itself is
   * already sitting. Without it the confidentiality gate stays exactly as
   * unreadable as the inventory found it — a withholding that happened and one
   * that never had to, the same absence.
   *
   * A question's row (2026-10-03) carries its `mode`, how many matched, how
   * many were shown and how many listed faded, and the page — still counts.
   *
   * Never throws: a tool answer may not fail because its telemetry did.
   */
  private noteRecall(
    row: RecallRowFields,
    askedIds: number,
    question: unknown,
    handleResolved: boolean,
    payload: Record<string, unknown>,
    delivered: readonly string[],
    // Whose call this was, keyed like the seen set (`seenKey`, asked once by
    // the caller); absent from the row when nobody knows, so a reader falls
    // back on its own guess rather than on a sentinel.
    session: string,
    fromIndex: Partial<Record<FitMechanism, number>> = {},
  ): void {
    const byAddress = row.path === "handle";
    const shown = row.shown ?? 0;
    this.telemetry(() => {
      this.counterpart.noteAdapterEvent(MCP_RECALL_EVENT, {
        ...(session === UNBOUND_SESSION ? {} : { session }),
        path: row.path,
        reason: row.reason,
        ...(row.mode === undefined ? {} : { mode: row.mode }),
        // WHAT WAS ASKED, as shapes and sizes. Never the words.
        queryChars: typeof question === "string" ? question.trim().length : 0,
        askedIds,
        handleResolved,
        semantic: row.semantic,
        // What came back, split the way the reader's question splits: an
        // expansion answered an address, a question's answer showed results.
        surfaced: byAddress ? 0 : shown,
        expanded: byAddress ? row.expanded : 0,
        ...(row.matched === undefined ? {} : { matched: row.matched }),
        ...(row.faded === undefined ? {} : { faded: row.faded }),
        ...(row.page === undefined ? {} : { page: row.page }),
        ...(row.time === undefined ? {} : { time: row.time }),
        ...(row.counts === undefined ? {} : { counts: row.counts }),
        considered: row.considered,
        storeSize: row.storeSize,
        owner: this.owner,
        chars: payload["chars"] ?? 0,
        truncated: payload["truncated"] === true,
        droppedForBudget: 0,
        // THE POINT OF THE ROW: what kept the rest out, by name.
        blockedBy: row.blockedBy,
        // How many of the expanded ids a mechanism's index had offered only
        // in part (2026-09-28) — the lookup's use, per mechanism. Counts only.
        ...(Object.keys(fromIndex).length > 0 ? { fromIndex } : {}),
        // What it DELIVERED, by id, bounded (2026-10-11): the memories a
        // look-up opened or a question's answer showed.
        ...boundedIds(delivered),
      });
      // The ring emit above already carries this call; a telemetry write that
      // failed must not become the answer the model receives (`telemetry`).
    });
  }

  /**
   * THE HANDLE-EXPANSION CREDIT SEAM (LAUNCH-STATUS G50), the tool half.
   *
   * A deliberate expansion BY TITLE read the whole memory and earned nothing:
   * the boundary's credit pass takes its expansions from the transcript, and
   * `recall/reference.ts` credits literal `mem_…` addresses only — a title is
   * counted `unresolvedHandles` and credits nothing, because that module
   * resolves nothing fuzzily and must not start. The resolution belongs to
   * whoever performed it, which is this tool, so this tool records it
   * (`adapters/expansions.ts`) and the hook translates the transcript's own
   * handle with it.
   *
   * EVERY OUTCOME OF THIS PATH IS RECORDED, and the refusals are recorded as
   * `null` — a shadow that translates nothing and, being the newest answer,
   * overrides an earlier resolution of the same handle IN THE SAME PROJECT.
   * That is not tidiness, it is §5 G6: the log is keyed by the handle, because
   * RESOLUTION is deterministic, but a REFUSAL is not. The owner's own session
   * resolves a confidential title; a stranger's session asking the same title
   * is told nothing. `handle-unknown` and `handle-ambiguous` shadow for the same
   * reason — a title since renamed away, or gone ambiguous, must not go on
   * crediting the memory it used to name.
   *
   * **THE SHADOW IS NOT THE CONFIDENTIALITY BOUNDARY, and the first draft of
   * this method said it was.** A shadow only exists where an answer was given.
   * Three askings get no answer and leave no shadow — a call that never reached
   * `expandHandle`, a `{ handle, question }` the dispatcher refuses as
   * `both-arguments` before this path exists, and a refusal whose write failed
   * (`recordHandleResolution` returns false; it may not throw at a tool). Each
   * of those still puts the title in the transcript, so each still reaches a
   * boundary looking for a translation. What stops them is the SCOPE recorded on
   * every line, which `readHandleResolutions` filters on: another project's
   * resolution cannot answer this project's handle. `scope` is therefore
   * load-bearing here, not forensics.
   *
   * Filtering also retires the price the first draft accepted — a stranger's
   * refusal between the owner's call and the owner's Stop costing the owner the
   * credit — because that shadow now carries the stranger's scope.
   *
   * The `ids` path is out of scope: those are literal addresses the credit pass
   * already sees, and a per-id account of what each resolved to is `perId`'s
   * job, not this one's.
   *
   * Never throws and never changes the answer. A write that FAILED is not
   * symmetrical, though, and the asymmetry is worth naming: a lost RESOLUTION
   * costs credit (safe), a lost REFUSAL leaves an older resolution standing
   * where a shadow should have been (not safe). Across projects the scope filter
   * makes that moot — the older resolution belongs to a directory the next
   * boundary is not in. Within one project directory it is the residual this
   * seam is known to carry.
   */
  private noteHandleResolution(handle: unknown, result: DeliberateResult): boolean {
    if (typeof handle !== "string" || handle.trim().length === 0) return false;
    if (result.path !== "handle") return false;
    const id = resolvedIdOf(result);
    if (id === undefined) return false;
    const written = recordHandleResolution(this.registryDir, {
      handle,
      id,
      scope: this.scope,
      at: this.nowFn(),
    });
    return written && id !== null;
  }

  /**
   * THE LOOKUP LEDGER, read from the recall tool (2026-09-28): the expanded
   * ids a dream's or a reflection's latest index offered only in part.
   * `noteLookups` also marks them fetched, so a change made from one reads as
   * made from the whole. Never throws: a tool answer may not fail because its
   * measurement did.
   */
  private lookupsFromIndex(delivered: readonly { id: string; whole: boolean }[]): Partial<Record<FitMechanism, number>> {
    let counted: Partial<Record<FitMechanism, number>> = {};
    this.telemetry(() => {
      counted = noteLookups(this.counterpart.store, delivered);
    });
    return counted;
  }

  /**
   * The ADDRESS payload, BOUNDED: `handle` or `ids` answers "what did it
   * say" and ships as much body as the total budget allows, in parts. See
   * `deliberate.ts`'s size constants for the measurement that set them. (A
   * question's answer is its mode's rendering — `askQuestion`.)
   */
  private recallPayload(result: DeliberateResult, part = 1): Record<string, unknown> {
    // By address, IN PARTS (2026-09-28): each body a part at a time, the ids
    // past the total waiting by name.
    const bounded = boundById(result.memories, part);
    const lastPart = Math.max(1, ...bounded.memories.map((m) => m.parts ?? 1));
    return {
      path: result.path,
      reason: result.reason,
      semantic: result.semantic,
      considered: result.considered,
      storeSize: result.storeSize,
      returned: bounded.memories.length,
      chars: bounded.chars,
      truncated: bounded.truncated,
      ...(bounded.truncated
        ? {
            budget: `By id, a body comes in parts of ${RECALL_BODY_CHARS} characters ("part" of "parts" on each; bodyChars is the whole length).${part < lastPart ? ` Ask again with the same ids and part: ${String(part + 1)} for the next.` : " That was the last part."}`,
          }
        : {}),
      ...(bounded.waiting !== undefined
        ? {
            waiting: [...bounded.waiting],
            more: `No room for ${String(bounded.waiting.length)} of the ids in one result: ask again with ids: [${bounded.waiting.join(", ")}].`,
          }
        : {}),
      ...(result.ambiguous.length > 0 ? { ambiguous: [...result.ambiguous] } : {}),
      ...(result.perId === undefined ? {} : { perId: result.perId.map((p) => ({ ...p })) }),
      ...(result.reason === "ids-too-many"
        ? { refused: `At most ${RECALL_MAX_IDS} ids per call. Effort is not enumeration.` }
        : {}),
      ...(result.reason === "handle-confidential-withheld"
        ? {
            withheld:
              "That memory is marked confidential and this is not the owner's own session. It exists; it is not being shown.",
          }
        : {}),
      ...(result.reason === "both-arguments"
        ? { refused: "One kind of ask per call: a question (with a mode), ids, or a handle." }
        : {}),
      ...(result.reason === "no-argument"
        ? { refused: `Send a question with mode (${RECALL_MODE_WORDS}), or ids, or a handle.` }
        : {}),
      memories: bounded.memories.map((m) => ({ ...m })),
      /** The label the ruling of 2026-09-04 put on every delivered chapter,
       *  glossed once here so `journal: true` on a row is not a bare boolean the
       *  reader has to guess the meaning of (`deliberate.ts#JOURNAL_GLOSS`).
       *  CONDITIONAL, like `budget`, `refused` and `withheld` beside it: 207
       *  bytes explaining a flag that is not on any row is the wire budget spent
       *  on a word nobody read. */
      ...(bounded.memories.some((m) => m.journal) ? { journal: JOURNAL_GLOSS } : {}),
    };
  }

  /**
   * `status` — the census (§5 G7). Counts, kinds, bands, dates. No ids, no
   * bodies, and NO CONTENT HASHES: a hash of low-entropy content is
   * brute-forceable, so a hash in the record of a removal is a leak of the
   * thing removed (scar §2.20).
   *
   * The symmetry counters are the useful minimum CONTRACT §7 OQ2 names —
   * created versus exited per kind. They are the numbers that made v1's
   * pathologies visible; a store census on its own never did.
   *
   * REPLACED IS NOT EXITED (2026-09-30, U13). A row a newer reading carries — a
   * revision, a merge, a chapter's copy rebuilt when the chapter grew — is
   * counted under `replaced`, apart from the real exits (let go, removed).
   * Until then every archived row was an exit, and a store whose chapters kept
   * growing read as forgetting its self-kind memories. Which is which is
   * `core/leaving.ts`'s table, asked through `counterpart.leftAs` — the same
   * table the dashboard's archive words read.
   */
  /**
   * `wake` — CLAUDE DESKTOP'S SESSION START (2026-09-30, brief item 1).
   *
   * Desktop has no SessionStart, so this tool is it: it MINTS a session (a
   * fresh id every call — one server serves every chat, and nothing on the
   * wire says which chat is asking), writes that session's registry record
   * through the same lifecycle Claude Code's hooks use (host `claude-desktop`,
   * the place `claude-desktop:`), and returns the same briefing SessionStart
   * composes, with what rides beside it:
   *
   *   - the clock and today's plain reminders, CLAIMED here — a tool result is
   *     certain delivery, so there is no envelope that could drop them;
   *   - the first-prompt-of-the-day checks: the worker is started
   *     (`lifecycle.ts#spawnWorker`), and the day's dream line is offered when
   *     one is due and is an ASK (`wakeDreamLine`) — the headless nightly run
   *     stays Claude Code's;
   *   - the update and doctor notices, as plain lines;
   *   - the next-session write-up pointer, measured against a tool result's
   *     room (`TOOL_RESULT_CHARS`), not a hook's.
   *
   * Not here, on purpose: the first-launch scope question (there is no
   * directory to ask about), the parallel run's primacy, and the headless run.
   */
  private wakeTool(): ToolResult {
    if (this.observer) return this.standDown("wake");
    const lc = this.lifecycle();
    const store = this.counterpart.store;
    const now = this.nowFn();
    const input: SessionInput = {
      sessionId: randomUUID(),
      scope: this.scope,
      at: localDate(now, store.zone()),
    };
    lc.noteSession("start", input);
    const woke = lc.composeWake(input, this.lifecycleOpts.config?.injectionBudgetBytes);
    const plain = lc.plainFor(input);
    const told = lc.claimPlain(input, plain.due);
    const spawn = lc.spawnWorker(input);
    const dream = this.wakeDreamLine(input);
    const notices = [this.wakeUpdateLine(), this.wakeDoctorLine()].filter((l): l is string => l !== null);
    const head = `Counterparts session for this chat: ${input.sessionId}. Pass session: ${input.sessionId} on session_end, chapter, dream and reflect in this chat.`;
    const lead = [lc.nowLine(), ...told.map((r) => plainContextLine(r))].join("\n");
    const parts = [
      head,
      `${lead}\n${woke.text}`.trimEnd(),
      ...(notices.length === 0 ? [] : [notices.join("\n")]),
      ...(dream === null ? [] : [`${dream}\n${DESKTOP_DREAM_NOTE}`]),
    ];
    const body = parts.join("\n\n");
    const pointer = lc.deliverWriteUpAsk(input, Buffer.byteLength(body, "utf8"), {
      limit: ADAPTER_TUNABLES.TOOL_RESULT_CHARS,
      label: "wake",
    });
    const text = pointer.length === 0 ? body : `${body}\n\n${pointer}`;
    try {
      store.setMeta(DESKTOP_WAKE_KEY, String(now));
    } catch {
      /* a lost "last wake" is a doctor line, never a wake */
    }
    this.emit("mcp.wake", input.sessionId, {
      ok: woke.ok,
      reason: woke.reason,
      bytes: Buffer.byteLength(text, "utf8"),
      plain: told.length,
      spawned: spawn.started,
      dream: dream !== null,
      notices: notices.length,
      pointer: pointer.length > 0,
    });
    const payload: Record<string, unknown> = {
      session: input.sessionId,
      scope: this.scope,
      host: this.host,
      wake: text,
    };
    // THE BRIEFING AS TEXT, not as JSON: whichever of the two a host hands the
    // model, it reads the wake as the wake, with the id on its first line.
    return { content: [{ type: "text", text }], structuredContent: payload };
  }

  /**
   * THE DAY'S DREAM LINE, for Desktop's `wake`: offered, and CLAIMED here — a
   * tool result is certain delivery — only when it is an ask. A HEADLESS offer
   * (the owner's setting `auto`) is left unclaimed and unsaid: claiming it
   * writes `launched` on the day's row, and only the host that starts the run
   * may do that, which is Claude Code's first prompt of the day (`askLine`'s
   * rule, review of #282 finding 9). When today's headless run could not start,
   * core's offer is already an ask again, and is said here. Never throws.
   */
  private wakeDreamLine(input: SessionInput): string | null {
    if (this.observer || input.at === undefined) return null;
    try {
      const dreams = this.counterpart.dreams;
      const offer = dreams.offer({ at: input.at, session: input.sessionId });
      if (offer === null) return null;
      if (offer.headless) {
        this.emit("mcp.wake.dream", undefined, { left: "headless" });
        return null;
      }
      if (!dreams.claimOffer(offer)) return null;
      this.emit("mcp.wake.dream", undefined, { told: true, state: offer.state });
      return offer.context;
    } catch {
      return null;
    }
  }

  /**
   * "COUNTERPARTS WAS UPDATED", for a Desktop wake: the build this process
   * loaded against the package on disk now. Desktop's server is started with
   * the app and there is no per-turn hook running the installed build beside
   * it, so this process has to look for itself (`manifestVersionOnDisk`).
   *
   * AND A NEWER BUILD THAT WROTE THE STORE (2026-10-02): the build stamp on
   * the published wake (`self/behind.ts#WAKE_BUILD_KEY`) newer than this
   * process says the same, for a store shared with an install this process
   * cannot see on its own disk.
   */
  private wakeUpdateLine(): string | null {
    return this.updateReading()?.line ?? null;
  }

  /**
   * What the two checks say, or null when neither moved. `reconnect` is
   * whether reconnecting would load something newer: only when the package
   * on THIS process's disk moved. A newer stamp with this disk unchanged is
   * another install (another path, `npx`) writing the same store (review of
   * #318): reconnecting would load this same version again, so the line says
   * what happened and offers no remedy that does not work.
   */
  private updateReading(): { line: string; reconnect: boolean } | null {
    try {
      const loaded = this.identity?.build.version ?? installedVersion();
      if (loaded === null) return null;
      const onDisk = this.manifestVersion();
      if (onDisk !== null && loaded !== onDisk) {
        const stamp = (version: string): ReturnType<typeof installedBuild> => ({ ...installedBuild(), version });
        const older = serverIsNewer(stamp(loaded), stamp(onDisk));
        return { line: `Counterparts was ${older ? "changed to an older version" : "updated"}. ${wordingFor(this.host).reconnect}`, reconnect: true };
      }
      let wrote: string | null = null;
      try {
        wrote = this.counterpart.store.getMeta(WAKE_BUILD_KEY) ?? null;
      } catch {
        return null;
      }
      if (!versionNewer(wrote, loaded)) return null;
      return {
        line: `A newer Counterparts (${String(wrote)}), installed somewhere else, has written this memory store; this server is ${loaded}.`,
        reconnect: false,
      };
    } catch {
      return null;
    }
  }

  /**
   * THE SAME LINE ON EVERY OTHER RESULT (2026-10-02). A server left open
   * across an install keeps the tool list it loaded, so an argument the new
   * version added — `remember`'s `about`, `unresolved` — is dropped without a
   * word until the host reconnects, and Desktop had no notice at all outside
   * `wake`. Now every result says it, in `updated`, while the two builds
   * differ: one manifest read and one meta read per call. The line names what
   * may be lost. Never throws, never refuses: the call already ran.
   */
  private withUpdateNotice(name: string, result: ToolResult): ToolResult {
    if (name === "wake") return result;
    const reading = this.updateReading();
    if (reading === null) return result;
    this.emit("mcp.update.noticed", undefined, { tool: name, reconnect: reading.reconnect });
    const said = reading.reconnect
      ? `${reading.line} Until then this server runs the version it started with, and it ignores anything newer, such as a field added to a tool since.`
      : `${reading.line} It ignores anything newer, such as a field added to a tool since; updating this install is what brings it level.`;
    return this.result({ ...result.structuredContent, updated: said }, result.isError === true);
  }

  /** The doctor's red-only notice, from the entry point's closure. Never throws. */
  private wakeDoctorLine(): string | null {
    try {
      return this.wakeNotice?.() ?? null;
    } catch {
      return null;
    }
  }

  private statusTool(): ToolResult {
    if (this.observer) return this.standDown("status");
    const census = this.census();
    this.emit("mcp.status", undefined, {
      live: census["live"] as number,
      removed: (census["removed"] as Record<string, unknown>)["count"] as number,
    });
    return this.result(census, false);
  }

  private census(): Record<string, unknown> {
    const store = this.counterpart.store;
    const kinds: Kind[] = ["self", "person", "entity", "skill", "place", "fact"];
    const bands: Band[] = ["episodic", "semantic", "identity"];

    const denied = new Set(store.deniedIds());
    const created: Record<string, number> = {};
    const exited: Record<string, number> = {};
    const replaced: Record<string, number> = {};
    const byBand: Record<string, number> = {};
    let live = 0;
    let archived = 0;
    let superseded = 0;
    // Journal entries, counted APART. An episode is the source a memory was
    // made from, not a memory: it is outside every sleep phase
    // (`sleep/types.ts#isJournal`), so counting it among the memories would
    // report as "held" a row that neither decays nor exits. Reported rather
    // than dropped, because a number that quietly excludes something is the
    // kind of census §16 forbids.
    let journal = 0;

    for (const kind of kinds) {
      const ids = store.list({ kind });
      let born = 0;
      let gone = 0;
      let swapped = 0;
      for (const id of ids) {
        const row = store.row(id);
        if (row === undefined) continue;
        if (row.type === "episode") {
          if (row.archived === 0 && !denied.has(id)) journal += 1;
          continue;
        }
        born += 1;
        if (denied.has(id)) {
          gone += 1;
          continue;
        }
        if (row.archived === 1) {
          archived += 1;
          // An unknown reason with nothing superseding it counts as an exit:
          // never hidden under "nothing was forgotten".
          if (this.counterpart.leftAs(row.archived_reason, row.superseded_by !== null) === "replaced") swapped += 1;
          else gone += 1;
          continue;
        }
        if (row.superseded_by !== null) {
          swapped += 1;
          superseded += 1;
          continue;
        }
        live += 1;
        byBand[row.band] = (byBand[row.band] ?? 0) + 1;
      }
      created[kind] = born;
      exited[kind] = gone;
      replaced[kind] = swapped;
    }
    for (const band of bands) byBand[band] = byBand[band] ?? 0;

    // Removals: counts, kinds, dates. Never an id — the enumeration of what was
    // removed is the CLI's owner-side surface, not the model's.
    const dates = new Set<string>();
    const removedKinds: Record<string, number> = {};
    const removedIds = new Set<string>();
    for (const row of store.removalRecord()) {
      if (row.stage !== "complete") continue;
      removedIds.add(row.memory_id);
      dates.add(localDate(row.at, store.zone()));
      const kind = store.row(row.memory_id)?.kind ?? "unknown";
      removedKinds[kind] = (removedKinds[kind] ?? 0) + 1;
    }

    return {
      live,
      archived,
      superseded,
      journal,
      byKind: created,
      byBand,
      /** OQ2's symmetry counters: born versus left, per kind — and, apart from
       *  the exits, the rows a newer reading replaced. */
      symmetry: { created, exited, replaced },
      removed: {
        count: removedIds.size,
        kinds: removedKinds,
        dates: [...dates].sort(),
        note: "Counts, kinds and dates only. No ids, no bodies, no hashes.",
      },
      counts: "Every number above is MEMORIES. `journal` is the first-person episodes those memories were made from: it is the source, not a memory, and it neither decays nor is pruned. In `symmetry`, `exited` is only what left for good (let go, or removed); `replaced` is what a newer reading carries (a revision, a merge, a journal copy rebuilt when its chapter grew) — nothing there was forgotten.",
      clock: {
        livedDay: store.livedDay(),
        lastActiveDate: store.getMeta("lastActiveDate") ?? null,
      },
      stance: { observer: this.observer, ...this.ownerStance() },
    };
  }

  /**
   * `session_end` — the MEMORIES half of the Stop ask's return channel.
   *
   * Per-entry failure isolation (scar E1): one refused entry announces itself
   * and its siblings still land. A single bad item failing the whole dump is
   * how a session's memory becomes all-or-nothing at exactly the moment there
   * is no second chance to write it.
   */
  private async sessionEndTool(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("session_end");
    const bound = this.requireBoundSession(args["session"], "session_end");
    if (bound !== null) return bound;

    // THE WRITE-UP DOOR (roadmap C2) — diverted HERE, after the bind (the
    // WRITING session is this one, bound exactly as always) and before anything
    // else reads the call: a write-up never writes a handoff and never marks
    // "nothing new". Everything it does and refuses is `write-up.ts`'s.
    // ONLY A NON-EMPTY STRING diverts (PR #192 review, m1): a host or model that
    // sends unused optional fields as `null` or `""` must not have every
    // ordinary answer refused as a write-up of nobody.
    //
    // `drewOn` (2026-10-11) is read before the divert (review of #385), so a
    // write-up that names what it drew on is credited as any other answer is:
    // the writing session is this one, and so is the shown set the guard
    // reads. It is credited whatever the rest of the call does, and its
    // outcome rides out on every answer below.
    const drewOn = this.drewOnField(args["drewOn"], "session_end");
    if (typeof args["writeUp"] === "string" && args["writeUp"].length > 0) return this.writeUpField(args, drewOn);

    // THE HANDOFF FIRST, and before the memories check on purpose (E1). It is a
    // FIELD on this call and not one of the entries, so a dump whose `memories`
    // array is malformed must not also throw away the one line telling the next
    // session in this directory where the work stands. The outcome rides out on
    // the refusal too, so nothing is lost silently either way.
    //
    // A DESKTOP CALL THAT NAMED NO SESSION leaves and retires no handoff
    // (review of #295, MINOR-4, at the hosts session's ask). It was bound to
    // the most recent live Desktop session, which may be another chat's — and
    // a handoff is keyed by its session, so chat A's would revise or clear
    // chat B's. Both fields are refused by name; the rest of the call, the
    // memories included, goes through as it always did.
    const unnamed = this.callBoundBy === "most-recent";
    const handoff = unnamed ? this.unnamedHandoffField(args["handoff"]) : this.writeHandoffField(args["handoff"]);
    // Retiring others' handoffs here by id (2026-09-30) rides the same rules:
    // it lands before the memories check, it counts as landing something, and
    // its outcomes ride out beside the answer.
    const retiredRaw = args["retireHandoff"];
    let retired: Record<string, unknown>[] | null = null;
    if (!unnamed) {
      retired = this.retireHandoffField(retiredRaw);
    } else if (!(Array.isArray(retiredRaw) && retiredRaw.length === 0)) {
      const refused = this.unnamedHandoffField(retiredRaw);
      retired = refused === null ? null : [refused];
    }

    const raw = args["memories"];
    // NOTHING WORTH KEEPING IS A REAL ANSWER — and until 2026-09-21 it was not
    // one on this door (new-user finding #12). A session that learned nothing
    // durable but is leaving work half-finished sends the handoff and an empty
    // list, and got back an ERROR naming a missing field while the handoff it
    // had just asked for was already on disk. A model that reads its own result
    // learns from that to stop sending handoffs, or to invent a memory.
    //
    // Three cases, and only the first is new:
    //
    //   - A handoff LANDED (written or cleared) and there are no memories →
    //     success, saying so. `deposited` is 0 and `isError` is false, because
    //     something did land.
    //   - A handoff was sent and REFUSED (`no-scope`, `too-large`, `not-text`,
    //     `nothing-to-clear`) with no memories → nothing landed, so the refusal
    //     stands and the handoff's own outcome rides out on it.
    //   - Neither — no handoff and no memories → `memories-required`, as
    //     before. So is a `memories` that is not an array: a caller who sent the
    //     wrong TYPE wants to be told. (The published schema no longer marks
    //     `memories` required — the write-up fetch leaves it out, PR #192 m2 —
    //     so this refusal is where the rule is enforced.)
    //
    // AND A FOURTH, 2026-09-23 (B1, owner's decision 4): `memories: []` is
    // "nothing new" WHATEVER happened to the handoff — accepted, minting
    // nothing, and RECORDED, so an honest empty answer is no longer the same
    // silence as no answer at all. Only an explicit empty ARRAY: a call that
    // left the field out has not answered anything, and stays
    // `memories-required`.
    //
    // A handoff that came with it rides out beside the answer, whatever its
    // outcome (review M2: a refused handoff used to turn the whole call into
    // `memories-required`, naming a field the caller HAD sent — new-user
    // finding #12's mechanism, reopened). `nothing-to-clear` — `handoff: ""`
    // where no pointer stands — is a no-op, not an error: the field's own
    // description invites `""` exactly when the work is finished. Any other
    // refusal (`too-large`, `not-text`, `no-scope`, …) sets `isError`, because
    // something the caller sent did not land and resending it can fix that —
    // but the reason stays `nothing-new` and the answer is recorded either way.
    //
    // The record is a mark on the session's registry entry (`nothingNewAt`),
    // not a durable event row: a new durable event NAME is a core change
    // (`AdapterDurableEventName`), and the registry is where "did this session
    // answer" is already read from. Every success with no memories leaves it,
    // handoff-only included. It does not move pacing and does not need to — the
    // pacer advanced when the ask went out (`self/index.ts#openChapter`).
    const session = this.session as string;
    const landed =
      (handoff !== null && handoff["written"] === true) ||
      (retired !== null && retired.some((r) => r["written"] === true));
    const noMemories = raw === undefined || (Array.isArray(raw) && raw.length === 0);
    const emptyList = Array.isArray(raw) && raw.length === 0;
    if ((landed && noMemories) || emptyList) {
      const marked = markNothingNew(this.registryDir, session, this.nowFn()) !== null;
      // "NOTHING NEW" WRITES THE STRETCH UP (2026-09-30): a claim with no
      // proposal behind it, in `coverage.jsonl`, so the ledger reads one file —
      // in THIS project only, as a memory's claim is. A handoff alone claims nothing.
      if (emptyList) claimUnwritten(this.counterpart.spans, { session, scope: this.scope, by: CLAIM_NOTHING_NEW, ref: session });
      const handoffFailed =
        (handoff !== null && handoff["written"] !== true && handoff["reason"] !== "nothing-to-clear") ||
        // `not-here` is the retire's `nothing-to-clear`: an id already
        // retired (by its writer or another session) is not a failure to fix.
        (retired !== null && retired.some((r) => r["written"] !== true && r["reason"] !== "not-here"));
      this.emit("mcp.session_end", session, {
        entries: 0,
        deposited: 0,
        refused: 0,
        handoff: landed,
        nothingNew: true,
        recorded: marked,
      });
      return this.result(
        {
          session,
          entries: 0,
          deposited: 0,
          refused: 0,
          outcomes: [],
          reason: landed ? "handoff-only" : "nothing-new",
          // Whether the answer reached the session's record. `false` means the
          // registry could not be written (or the record was pruned): the
          // answer still stands, and the caller can see it was not kept.
          recorded: marked,
          ...(handoff === null ? {} : { handoff }),
          ...(retired === null ? {} : { retired }),
          ...(drewOn === null ? {} : { drewOn }),
        },
        handoffFailed,
      );
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      return this.refuse("session_end", "memories-required", {
        ...(handoff === null ? {} : { handoff }),
        ...(retired === null ? {} : { retired }),
        ...(drewOn === null ? {} : { drewOn }),
      });
    }
    const { outcomes, deposited, entries } = await this.depositEntries(raw, session);
    this.emit("mcp.session_end", session, {
      entries: entries.length,
      deposited,
      refused: entries.length - deposited,
      handoff: handoff === null ? false : handoff["written"] === true,
    });
    return this.result(
      {
        session,
        entries: entries.length,
        deposited,
        refused: entries.length - deposited,
        outcomes,
        // One line for the whole dump, when any entry came back with neighbours.
        ...(outcomes.some((o) => o["neighbours"] !== undefined) ? { neighboursHint: NEIGHBOURS_HINT } : {}),
        ...(handoff === null ? {} : { handoff }),
        ...(retired === null ? {} : { retired }),
        ...(drewOn === null ? {} : { drewOn }),
      },
      deposited === 0,
    );
  }

  /**
   * THE ROAD EVERY `session_end` ENTRY TAKES — a write-up's included (C2):
   * one draft per item, the gate battery through `submitSessionEnd`, and
   * per-entry isolation (scar E1). Extracted, not changed, so the write-up
   * door's memories cannot take a different road from an ordinary answer's —
   * except WHOSE words they cover, which the door says (`cover`).
   */
  private async depositEntries(
    raw: readonly unknown[],
    session: string,
    /** Whose words the entries cover (`SessionEndDepositContext.cover`). Absent: this
     *  session's own — every caller but the write-up door. */
    cover?: false | { readonly session: string },
    /** Where the memories are filed. Absent: this server's scope — every caller
     *  but a GRANTED write-up (`sessions.ts#SessionRecord.mayWriteUp`), whose
     *  memories go under the scope the subject was lived in. */
    scope?: string,
    /** A WRITE-UP's memories (2026-10-01): whose stretch they write up and the
     *  day it was lived — carried on each memory, marked second-hand. */
    writeUp?: { readonly session: string; readonly happenedOn: string | null },
  ): Promise<{ outcomes: Record<string, unknown>[]; deposited: number; duplicates: number; entries: Record<string, unknown>[] }> {
    const entries: Record<string, unknown>[] = [];
    const feelingsOf: FeelingsRead[] = [];
    const datedOf: ReminderRead[] = [];
    const aboutOf: AboutRead[] = [];
    const traitsOf: TraitsRead[] = [];
    const factsOf: FactsRead[] = [];
    const today = this.today();
    for (const item of raw) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        entries.push({ content: "" });
        feelingsOf.push({ inputs: [] });
        datedOf.push({ fields: {}, remindIgnored: false });
        aboutOf.push({ mark: null });
        traitsOf.push({ inputs: [] });
        factsOf.push({ sent: {}, dropped: [], notes: [] });
        continue;
      }
      const rec = item as Record<string, unknown>;
      const draft: Record<string, unknown> = { content: rec["content"] };
      if (typeof rec["kind"] === "string") draft["kind"] = rec["kind"];
      if (typeof rec["title"] === "string") draft["title"] = rec["title"];
      if (typeof rec["updates"] === "string") draft["updates"] = rec["updates"];
      if (rec["how"] !== undefined) draft["how"] = rec["how"];
      if (typeof rec["unresolved"] === "boolean") draft["unresolved"] = rec["unresolved"];
      if (rec["salience"] !== undefined) draft["claimed"] = rec["salience"];
      // A bad dimension does NOT fail the batch and is not silently dropped:
      // the dimensions ride into the draft and `remember/intake` refuses that
      // one entry as malformed, which is this tool's per-entry isolation rule.
      const entryDims = readDimensions(rec) ?? pickDimensions(rec);
      if (Object.keys(entryDims).length > 0) draft["salience"] = entryDims;
      // The reminder date (2026-09-26), per entry: an unreadable one refuses
      // THIS entry below, by name, and its siblings still land.
      const dated = readReminder(rec);
      if (!("refused" in dated)) Object.assign(draft, dated.fields);
      datedOf.push(dated);
      entries.push(draft);
      feelingsOf.push(readFeelings(rec["feelings"]));
      aboutOf.push(readAbout(rec["about"]));
      traitsOf.push(readTraits(rec["traits"]));
      factsOf.push(readWriteFacts(rec, today));
    }

    const outcomes: Record<string, unknown>[] = [];
    let deposited = 0;
    let duplicates = 0;
    // The ids this call has written so far, and how many neighbours it listed (M1).
    const batch: string[] = [];
    let listed = 0;
    const model = this.sessionModel();
    for (const [n, draft] of entries.entries()) {
      // Feelings that cannot be stored refuse THEIR entry before it mints, so
      // no memory lands with its feelings silently dropped; siblings still run.
      const feelings = feelingsOf[n] ?? { inputs: [] };
      if ("refused" in feelings) {
        outcomes.push({ stored: false, reason: "feelings-malformed", detail: feelings.refused });
        continue;
      }
      const dated = datedOf[n] ?? { fields: {}, remindIgnored: false };
      if ("refused" in dated) {
        outcomes.push({ stored: false, reason: dated.refused, detail: dated.detail });
        continue;
      }
      const about = aboutOf[n] ?? { mark: null };
      if ("refused" in about) {
        outcomes.push({ stored: false, reason: "about-malformed", detail: about.refused });
        continue;
      }
      // Trait nudges refuse THEIR entry before it mints, like its feelings.
      const traits = traitsOf[n] ?? { inputs: [] };
      if ("refused" in traits) {
        outcomes.push({ stored: false, reason: "traits-malformed", detail: traits.refused });
        continue;
      }
      const facts = factsOf[n] ?? { sent: {}, dropped: [], notes: [] };
      let result: DepositResult;
      try {
        result = await this.counterpart.submitSessionEnd(draft, {
          session,
          scope: scope ?? this.scope,
          owner: this.owner,
          facts: facts.sent,
          // What it is about sets an unclaimed entry's default floor (2026-10-10).
          about: about.mark,
          ...(cover === undefined ? {} : { cover }),
          ...(model === undefined ? {} : { model }),
          ...(writeUp === undefined ? {} : { writeUp }),
        });
      } catch (err) {
        // Isolation, not a lost dump: this entry failed, the rest still run.
        outcomes.push({ stored: false, reason: "threw", detail: String((err as Error).message ?? err) });
        continue;
      }
      if (result.deposited) deposited += 1;
      if (result.reason === "duplicate-content") duplicates += 1;
      // A refusal names what to fix. `malformed` alone sent the author back to
      // guess (IMPROVEMENTS U11: a kind outside the enum came back as a bare
      // "malformed"); intake's own reason rides out, and an unknown kind lists
      // the kinds that exist.
      const malformed = result.malformed ?? null;
      // Bounded per dump (M1): a long dump shares NEIGHBOURS_PER_CALL between its entries.
      const neighbours = this.neighboursOf(result, batch, Math.min(CONTRADICTION_TUNABLES.NEIGHBOURS, CONTRADICTION_TUNABLES.NEIGHBOURS_PER_CALL - listed));
      listed += neighbours.length;
      if (result.memoryId !== null) batch.push(result.memoryId);
      outcomes.push({
        stored: result.deposited,
        reason: result.reason,
        ...(result.memoryId === null ? {} : { id: result.memoryId }),
        ...(result.gate === null ? {} : { gate: result.gate }),
        ...(malformed === null ? {} : { malformed }),
        ...(malformed === "KIND_UNKNOWN" ? { kinds: [...MEMORY_KINDS] } : {}),
        ...this.recordFeelings(result, feelings.inputs, model),
        ...this.recordAbout(result, about.mark),
        ...this.recordTraits(result, traits.inputs, model),
        ...reminderEcho(result, dated, this.today()),
        ...factsEcho(result, facts),
        ...this.settledOf(result, draft["how"] !== undefined),
        ...threadOf(result),
        ...(neighbours.length === 0 ? {} : { neighbours }),
      });
    }
    return { outcomes, deposited, duplicates, entries };
  }

  /**
   * `session_end` with `writeUp` — the next-session write-up's door (C2). The
   * decisions are `write-up.ts#writeUpDoor`'s; this only binds it to this
   * server's store, scope, registry and bound session, and renders the answer.
   */
  private async writeUpField(args: Record<string, unknown>, drewOn: Record<string, unknown> | null): Promise<ToolResult> {
    const session = this.session as string;
    const out = await writeUpDoor({
      counterpart: this.counterpart,
      registryDir: this.registryDir,
      scope: this.scope,
      session,
      now: this.nowFn(),
      args,
      deposit: (raw, cover, scope, writeUp) => this.depositEntries(raw, session, cover, scope, writeUp),
    });
    const body = out.body;
    // The ref is the ENDED session's id only when it is one this registry
    // knows: the argument is model-typed, and a word shaped like an id is
    // still a word (store §5 G10; review of #286).
    const ended = args["writeUp"];
    const known = isSessionId(ended) && readSession(this.registryDir, ended) !== null;
    this.emit("mcp.write_up", known ? ended : undefined, {
      reason: out.reason,
      part: typeof body["part"] === "number" ? body["part"] : null,
      of: typeof body["of"] === "number" ? body["of"] : null,
      deposited: typeof body["deposited"] === "number" ? body["deposited"] : 0,
      marked: typeof body["marked"] === "boolean" ? body["marked"] : null,
    });
    if (out.isError && body["stored"] === false && out.reason !== "nothing-landed") {
      this.emit("mcp.refused", undefined, { tool: "session_end", reason: out.reason });
    }
    return this.result(drewOn === null ? body : { ...body, drewOn }, out.isError);
  }

  /**
   * THE `drewOn` FIELD on `session_end` and `chapter` (2026-10-11): the ids of
   * memories this session was shown that shaped what it did or said, each
   * credited at the engaged tier by `Counterpart#creditDrewOn`, which owns
   * every rule (the shown-this-session guard, the refusals by name, the cap).
   * Null when the field was not sent or sent empty. A value that is not a list
   * of strings credits nothing and says so.
   *
   * One durable `recall.credit` row per call that named anything, beside the
   * boundary's own: `source: "drewOn"`, `via` the tool, `how` aligned with
   * `ids`, `refused` as counts by reason (what `fired.ts` reads) and the
   * refused ids apart. The doctor's Credit line counts these rows.
   */
  private drewOnField(raw: unknown, via: "session_end" | "chapter"): Record<string, unknown> | null {
    if (raw === undefined || raw === null) return null;
    if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string")) {
      return { credited: [], reason: "drewOn-malformed", detail: "drewOn is a list of memory ids, as strings." };
    }
    if (raw.length === 0) return null;
    // A DESKTOP CALL THAT NAMED NO SESSION credits nothing (review of #385),
    // as it leaves no handoff: it was bound to the most recent live Desktop
    // session, which may be another chat's, and the guard would read THAT
    // chat's shown set and spend its boundary's cap.
    if (this.callBoundBy === "most-recent") {
      return {
        credited: [],
        reason: "session-unnamed",
        detail: `Name your session to say what you drew on: session: <the id wake gave this chat>. This call named none, so it was filed under the most recent Claude Desktop session (${this.session ?? "none"}), which may be another chat's.`,
      };
    }
    const session = this.session as string;
    let out: ReturnType<Counterpart["creditDrewOn"]>;
    try {
      out = this.counterpart.creditDrewOn(session, raw as string[]);
    } catch (err) {
      return { credited: [], reason: "threw", detail: String((err as Error).message ?? err) };
    }
    const byReason: Record<string, number> = {};
    for (const r of out.refused) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
    if (out.capped.length > 0) byReason["capped"] = out.capped.length;
    this.telemetry(() => {
      this.counterpart.noteAdapterEvent(RECALL_CREDIT_EVENT, {
        source: "drewOn",
        via,
        reason: out.credited.length > 0 ? "credited" : "nothing-to-credit",
        session,
        date: this.today(),
        day: out.day,
        considered: out.named,
        credited: out.credited.length,
        refused: byReason,
        ids: out.credited.slice(0, 64),
        how: out.credited.slice(0, 64).map(() => "drewOn"),
        idsTotal: out.credited.length,
        refusedIds: out.refused.slice(0, 64).map((r) => r.id),
        capped: out.capped.slice(0, 64),
      });
    });
    return {
      credited: out.credited,
      ...(out.refused.length === 0 ? {} : { refused: out.refused }),
      ...(out.capped.length === 0
        ? {}
        : { capped: out.capped, cap: `At most ${String(DREW_ON_MAX_PER_BOUNDARY)} per boundary, the first named; these were not credited.` }),
    };
  }

  /**
   * The optional `handoff` field, written or refused, as the shape the tool
   * result carries back. Null when the caller passed none — which is the
   * ordinary case, and says nothing about this directory either way.
   *
   * **Three answers, and only the first is silence.**
   *
   *   - **Absent** — the ordinary case. Nothing is written and nothing is said:
   *     leaving the field out means "leave what stands", which is right.
   *   - **Present and blank** — `handoff: ""` or `"   "`. This is a CLEAR. It is
   *     the shape a model reaches for when it means "the work here is finished",
   *     and until 2026-09-20 it was total silence while the stale pointer stood
   *     (adversarial review MAJOR-2b). It retires the directory's pointer and
   *     leaves a durable row.
   *   - **Present and not a string** — a named, durable refusal, because a
   *     caller that sent the wrong type wants to know rather than to be ignored.
   *
   * The NO-SCOPE REFUSAL IS NOW DURABLE, which is what MAJOR-2a was: the
   * short-circuit that used to live here emitted a ring-only event and wrote no
   * row, so guarantee 3 was false on the only live door. The rule is asked in
   * two places on purpose and they are not duplicates — `handoff/` refuses an
   * empty scope and a scope that IS the store's directory, as a belt no caller
   * can get past; this file asks `sameScope`, which canonicalises (`/var` →
   * `/private/var` on this host), because it is the side that has the
   * canonicaliser and knows what `scopeSource` said. Either way the durable row
   * is written by `handoff/`, which owns guarantee 3.
   */
  private writeHandoffField(raw: unknown): Record<string, unknown> | null {
    if (raw === undefined || raw === null) return null;
    let out: ReturnType<Counterpart["writeHandoff"]>;
    try {
      if (typeof raw !== "string") {
        out = this.counterpart.refuseHandoff("not-text", { session: this.session });
      } else if (
        this.scopeSource === "store" ||
        sameScope(this.scope, this.counterpart.store.dir)
      ) {
        out = this.counterpart.refuseHandoff("no-scope", { session: this.session });
      } else if (raw.trim().length === 0) {
        out = this.counterpart.clearHandoff({ scope: this.scope, session: this.session });
      } else {
        // The model rides from host state, as a chapter's does, so the wake
        // can say which session — and which model — left it (2026-09-30).
        out = this.counterpart.writeHandoff(raw, {
          scope: this.scope,
          session: this.session,
          model: this.sessionModel() ?? null,
          // The release this server is running (2026-10-01): the wake says
          // "written before 0.3.10 was installed" once a newer one is.
          build: this.identity?.build.version ?? installedVersion(),
        });
      }
    } catch (err) {
      return { written: false, reason: "threw", detail: String((err as Error).message ?? err) };
    }
    this.emit("mcp.handoff", out.id ?? undefined, {
      written: out.written,
      reason: out.reason,
      bytes: out.bytes,
    });
    return {
      written: out.written,
      reason: out.reason,
      ...(out.id === null ? {} : { id: out.id }),
      bytes: out.bytes,
      ...(out.version === null ? {} : { version: out.version }),
      ...(out.gate === null ? {} : { gate: out.gate }),
      ...(out.redacted === null ? {} : { redacted: true }),
      ...(out.showsForDays === null ? {} : { showsForDays: out.showsForDays }),
      // The other sessions' live handoffs here, so a finished one can be
      // retired in the same call (`retireHandoff`).
      ...(out.others === undefined || out.others.length === 0 ? {} : { others: out.others }),
    };
  }

  /**
   * A `handoff` or `retireHandoff` field on a Desktop call bound by the
   * most-recent fallback: refused by name, durably (`handoff/` owns the row),
   * with the words that fix it. Null when the field was not sent.
   */
  private unnamedHandoffField(raw: unknown): Record<string, unknown> | null {
    if (raw === undefined || raw === null) return null;
    const detail = `Name your session to leave or retire a handoff: session: <the id wake gave this chat> — or, in a Claude Code session (Desktop's Code tab), the id your wake or Stop ask names. This call named none, so it was filed under the most recent Claude Desktop session (${this.session ?? "none"}), which may be another chat's.`;
    try {
      const out = this.counterpart.refuseHandoff("session-unnamed", { session: this.session });
      this.emit("mcp.handoff", undefined, { written: false, reason: out.reason, bytes: 0 });
      return { written: false, reason: out.reason, bytes: 0, detail };
    } catch (err) {
      return { written: false, reason: "threw", detail: String((err as Error).message ?? err) };
    }
  }

  /**
   * The optional `retireHandoff` field — ids of handoffs in THIS directory to
   * retire, whoever wrote them (2026-09-30) — as the outcomes the tool result
   * carries back, one per id. Null when the field is absent or an empty list.
   * A lone string is read as a list of one; anything else is one `not-text`
   * refusal. The directory rule is `writeHandoffField`'s, asked the same way.
   */
  private retireHandoffField(raw: unknown): Record<string, unknown>[] | null {
    if (raw === undefined || raw === null) return null;
    const ids = typeof raw === "string" ? [raw] : raw;
    if (Array.isArray(ids) && ids.length === 0) return null;
    const outcome = (id: string | null, out: ReturnType<Counterpart["retireHandoff"]>): Record<string, unknown> => {
      this.emit("mcp.handoff.retire", out.id ?? undefined, { written: out.written, reason: out.reason });
      return { ...(id === null ? {} : { id }), written: out.written, reason: out.reason, bytes: out.bytes };
    };
    try {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
        return [outcome(null, this.counterpart.refuseHandoff("not-text", { session: this.session }))];
      }
      if (this.scopeSource === "store" || sameScope(this.scope, this.counterpart.store.dir)) {
        return [outcome(null, this.counterpart.refuseHandoff("no-scope", { session: this.session }))];
      }
      return [...new Set(ids as string[])].map((id) =>
        outcome(id, this.counterpart.retireHandoff(id, { scope: this.scope, session: this.session })),
      );
    } catch (err) {
      return [{ written: false, reason: "threw", detail: String((err as Error).message ?? err) }];
    }
  }

  /**
   * `chapter` — the journal's door (self/CONTRACT §3: *which door reaches this?*).
   *
   * It composes, like everything else here: `Counterpart.appendEpisode` runs the
   * gate, `self/` decides whether this append opens a chapter or continues the
   * one already open, and the number that comes back is the number the store
   * WROTE. The ask reads the same counter, so the two sides cannot drift the way
   * they did for a fortnight — the model wrote eleven chapters as notes while
   * the hook's count said seven.
   */
  private async chapterTool(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("chapter");
    const bound = this.requireBoundSession(args["session"], "chapter");
    if (bound !== null) return bound;
    // `drewOn` (2026-10-11): credited whatever the chapter does, and its
    // outcome rides out on every answer below, as on `session_end`.
    const drewOn = this.drewOnField(args["drewOn"], "chapter");
    const withDrewOn = drewOn === null ? {} : { drewOn };

    const text = args["text"];
    if (typeof text !== "string" || text.trim().length === 0) {
      return this.refuse("chapter", "text-required", {
        detail: "A chapter has to say something. Nothing worth writing is a real answer — say nothing at all instead.",
        ...withDrewOn,
      });
    }
    const session = this.session as string;
    const title = args["title"];
    // WHAT THE SESSION WAS ABOUT (2026-10-01, lane 8), carried to the
    // chapter's memory copy: a malformed one refuses the call before anything
    // is written, as on `remember`.
    const about = readAbout(args["about"]);
    if ("refused" in about) return this.refuse("chapter", "about-malformed", { detail: about.refused, ...withDrewOn });
    // The model the hooks last saw answer in this session. A Stop records it
    // before its ask goes out, so the chapter that answers the ask has it.
    const model = readSession(this.registryDir, session)?.model;
    let written: ChapterResult;
    try {
      written = this.counterpart.appendEpisode(session, text, {
        // The project the chapter was written in: what it writes up (`coverage/`).
        scope: this.scope,
        ...(typeof title === "string" && title.length > 0 ? { title } : {}),
        ...(model === undefined ? {} : { model }),
        ...(about.mark === null ? {} : { about: about.mark }),
      });
    } catch (err) {
      // A journal that throws must not look like a journal that refused.
      return this.refuse("chapter", "threw", { detail: String((err as Error).message ?? err), ...withDrewOn });
    }
    this.emit("mcp.chapter", written.episodeId ?? undefined, {
      session,
      stored: written.appended,
      reason: written.reason,
      chapter: written.chapter,
      created: written.created,
    });
    return this.result(
      {
        stored: written.appended,
        reason: written.reason,
        session,
        episodeId: written.episodeId,
        // From the STORE, never from the ask count.
        chapter: written.chapter,
        created: written.created,
        ...(written.gate === null ? {} : { gate: written.gate }),
        ...(about.mark === null || !written.appended ? {} : { about: about.mark }),
        ...withDrewOn,
      },
      !written.appended,
    );
  }

  /**
   * `dream` — dreaming, in phases (`core/dream/`, 2026-09-26). Every phase
   * binds the session: the dreamer is a background agent the session launched,
   * talking to this same server, and its writes belong to that session.
   * `launch` writes nothing — it hands back the prompt for the dreamer — and is
   * refused under observer stance with the rest, because a dream it launched
   * could do nothing there.
   */
  private dreamTool(args: Record<string, unknown>): ToolResult {
    const phase = args["phase"];
    if (this.observer) return this.standDown("dream");
    const bound = this.requireBoundSession(args["session"], "dream");
    if (bound !== null) return bound;
    const session = this.session as string;
    const dreams = this.counterpart.dreams;
    const at = this.counterpart.store.today();
    const refused = (reason: string, detail: string): ToolResult => this.refuse("dream", reason, { phase, detail });
    // WHAT COMES NEXT in the nightly run, in its own order (`nightOrder`).
    const nextAfter = (part: NightPart, dream: string | null): string | null => {
      const next = nightNext(part);
      if (next === "writer") return `Next, the page writer: call the dream tool with phase "writer", session: ${session}${dream === null ? "" : `, dream: ${dream}`}.`;
      if (next === "reflection") return `Now wake and reflect: call the reflect tool with phase "begin", session: ${session}, dream: ${dream ?? "<the dream id>"}. Your final message is the text its "finish" call returns.`;
      if (next === "dream") return `Next, the dream: call the dream tool with phase "begin", session: ${session}.`;
      return null;
    };
    try {
      switch (phase) {
        case "launch":
          // The day's row becomes `launched` (claimed, or flipped from an
          // accepted ask), so a run that dies before its dream begins is
          // started again (review of #271).
          dreams.launched({ at, session });
          this.emit("mcp.dream", undefined, { phase: "launch", session });
          return this.result(
            {
              phase,
              session,
              prompt: dreams.launchPrompt({ session }),
              // The relay is the hand-back line AS IT IS: it carries the dream's
              // mark, which keeps the dream out of what the sweep reads. A
              // retelling in the session's own words would carry none, and the
              // dream's title and changes would read as something that
              // happened (adversarial review of #251).
              how: "Hand `prompt` to a background agent (the Agent tool), unchanged, and carry on. When it finishes, show the owner its first line (the dream's) exactly as it came back — it carries the dream's mark, which keeps the dream out of lived memory. If a morning share follows, tell it to the owner in your own words, as a telling (\"While I slept I dreamed…\"), then call the reflect tool with phase \"told\" — never state what was dreamed as something that happened.",
            },
            false,
          );
        case "decline": {
          dreams.decline({ at, session });
          this.emit("mcp.dream", undefined, { phase: "decline", session });
          return this.result({ phase, session, snoozed: at, said: "Not today — the line will not come back until tomorrow." }, false);
        }
        case "setting": {
          // THE OWNER'S OFF SWITCH (2026-09-28): "no dreams" in conversation.
          const value = args["value"];
          if (typeof value !== "string") {
            return refused("value-required", `Pass \`value\`: auto, ask or off. It is ${dreams.setting()} now.`);
          }
          const out = dreams.setSetting(value, { by: "session", session });
          if (!out.ok) return refused(out.reason, `value is one of ${DREAMING_SETTINGS.join(", ")}. It is ${dreams.setting()} now.`);
          this.emit("mcp.dream", undefined, { phase: "setting", setting: out.setting, before: out.before });
          const said: Record<DreamingSetting, string> = {
            auto: "Dreaming on its own: once a day, the first session starts the nightly run by itself, in a separate windowless session in the background, and says so in one line. Today's run is still yours to start, if the owner asked for it.",
            ask: "Dreaming asks first: once a day, the first session shows the owner the question in the terminal and waits for their word.",
            off: "No dreams: nothing starts the nightly run and nothing asks. It can be turned back on with this phase (value ask or auto) or with counterparts dream --setting ask.",
          };
          // "No dreams" does not stop a run already going (owner decision D): said.
          const finishes = out.setting === "off" && dreams.nightRunUnderWay() ? ` ${NIGHT_RUN_FINISHES}` : "";
          return this.result({ phase, setting: out.setting, before: out.before, said: `${said[out.setting]}${finishes}` }, false);
        }
        case "begin": {
          const model = readSession(this.registryDir, session)?.model;
          // THE RUN MOVED PAST THE WRITER (review of #271): an open claim this
          // session still holds is answered `nothing-to-say` here, when the
          // writer comes before the dream in the run.
          if (nightOrder().indexOf("writer") < nightOrder().indexOf("dream")) this.counterpart.closeNightWriter({ session, phase: "the dream" });
          const out = dreams.begin({ session, scope: this.scope, ...(model === undefined ? {} : { model }) });
          if (!out.ok) {
            return refused(
              out.reason,
              out.reason === "dreamed-today"
                ? "A dream already ran today."
                : out.reason === "dreaming-now"
                  ? "Another session's dream is under way; it has the day."
                  : out.reason === "nothing-new"
                    ? "Nothing new has been lived since the last dream."
                    : "The dream did not begin.",
            );
          }
          this.emit("mcp.dream", out.bundle.dream, {
            phase: "begin",
            session,
            shown: Object.keys(out.bundle.memories).length,
            resumed: out.resumed,
          });
          const handed = this.result(
            {
              phase,
              session,
              dream: out.bundle.dream,
              ...(out.resumed ? { resumed: true } : {}),
              // IN PARTS (2026-09-28): said up front, never a silent cut.
              ...(out.bundle.parts === null ? {} : { parts: out.bundle.parts }),
              how: dreamHow(out.bundle),
              bundle: out.text,
            },
            false,
          );
          // Part 1 is the begin: its row says how many parts the run owes.
          this.notePart("dream", out.bundle.dream, 1, out.bundle.parts?.of ?? 1);
          return handed;
        }
        case "part": {
          const dream = args["dream"];
          const n = args["part"];
          if (typeof dream !== "string" || typeof n !== "number") {
            return refused("dream-and-part-required", "Pass `dream` (the id `begin` returned) and `part` (2 and up).");
          }
          const out = dreams.part({ dream, session, part: n });
          if (!out.ok) return refused(out.reason, out.detail ?? "That dream is not open for this session.");
          this.emit("mcp.dream", dream, { phase: "part", part: out.part, of: out.of });
          const handed = this.result(
            {
              phase,
              dream,
              part: out.part,
              of: out.of,
              bundle: out.text,
              ...(out.part < out.of
                ? { next: `Then part ${String(out.part + 1)}: the dream tool, phase "part", dream: ${dream}, part: ${String(out.part + 1)}.` }
                : { next: "That was the last part. Now propose your changes." }),
            },
            false,
          );
          this.notePart("dream", dream, out.part, out.of);
          return handed;
        }
        case "propose": {
          const dream = args["dream"];
          const changes = args["changes"];
          if (typeof dream !== "string" || !Array.isArray(changes)) {
            return refused("dream-and-changes-required", "Pass `dream` (the id `begin` returned) and `changes`, an array.");
          }
          const out = dreams.propose({ dream, session, changes: changes as never });
          if (!out.ok) return refused(out.reason, "That dream is not open for this session.");
          this.emit("mcp.dream", dream, { phase: "propose", applied: out.results.filter((r) => r.ok).length });
          const refusedN = out.results.filter((r) => !r.ok).length;
          return this.result(
            {
              phase,
              dream,
              results: out.results,
              // Each refusal names what tripped it (`detail`); 2026-09-28.
              ...(refusedN === 0
                ? {}
                : { again: `${String(refusedN)} change${refusedN === 1 ? " was" : "s were"} not applied (see each result's reason and detail). Fix those and propose just them again; the rest already landed.` }),
            },
            false,
          );
        }
        case "journal": {
          const dream = args["dream"];
          const text = args["text"];
          if (typeof dream !== "string" || typeof text !== "string") {
            return refused("dream-and-text-required", "Pass `dream` and the journal `text`.");
          }
          const title = args["title"];
          const out = dreams.journal({ dream, session, text, ...(typeof title === "string" ? { title } : {}) });
          if (!out.ok) return refused(out.reason, "detail" in out && out.detail !== undefined ? out.detail : "The journal was not written.");
          this.emit("mcp.dream", dream, { phase: "journal" });
          const next = nextAfter("dream", dream);
          return this.result(
            {
              phase,
              dream,
              handBack: out.handBack,
              ...(out.note === undefined ? {} : { note: out.note }),
              next: `${next ?? "Return `handBack` as your final message, unchanged."}${next === null ? "" : " If the rest of the run fails, return `handBack` unchanged as your final message instead."}`,
            },
            false,
          );
        }
        case "writer": {
          // THE NIGHTLY RUN'S PAGE WRITER (2026-09-28): the night's day to read,
          // handed through this result rather than beside the wake — the page
          // whole, no injection ceiling, no `no-room`. It is the run's FIRST
          // part (the owner's order), so the night's claim is written here, for
          // this session and this run; a claim this session already holds is
          // reused (a run started again the same day claims nothing twice).
          const dreamArg = typeof args["dream"] === "string" ? args["dream"] : null;
          const claim = this.counterpart.claimNightWriter({ session, run: dreamArg ?? `night of ${at}` });
          const out = this.counterpart.nightWriter({ session, tool: NIGHT_WRITER_TOOL });
          const next = nextAfter("writer", dreamArg);
          if (!out.ok) {
            this.emit("mcp.dream", dreamArg ?? undefined, { phase: "writer", writer: claim.reason });
            const why: Record<string, string> = {
              off: "the owner has the page writer off",
              "no-previous-day": "this store has no day before today yet",
              "no-memories": `nothing was written down on ${claim.about}`,
              "already-claimed": `${claim.about} was already written or answered`,
              "asks-spent": `${claim.about} has been offered twice already`,
            };
            return this.result(
              {
                phase,
                writer: false,
                reason: claim.reason,
                said: `No page writing tonight — ${why[claim.reason] ?? claim.reason}. Leave the page as it stands.`,
                ...(next === null ? {} : { next }),
              },
              false,
            );
          }
          this.emit("mcp.dream", dreamArg ?? undefined, { phase: "writer", about: out.about, considered: out.considered, dropped: out.dropped });
          return this.result(
            {
              phase,
              writer: true,
              about: out.about,
              ifVersion: out.version ?? NO_PAGE_VERSION,
              read: out.text,
              // THE SHORT VERSION, IN THE SAME CALL (2026-10-10; #358 had a
              // tighten-and-resend retry here, for a limit that refused): a
              // page past its room is kept, and the writer is asked for the
              // short version sessions read on a day the wake cannot hold it.
              how: `Read the block. If something about who you are moved on ${out.about}, call the self_page tool with the WHOLE page, reason, ifVersion: ${String(out.version ?? NO_PAGE_VERSION)} and session: ${session}; if nothing moved, write nothing — that is an answer too. Aim the page under ${String(this.counterpart.self.tunables.PAGE_ROOM_BYTES)} bytes; if it runs past that, send \`short\` with it in the same call — a short version under ${String(this.counterpart.self.tunables.PAGE_ROOM_BYTES)} bytes, the whole of it condensed. If the answer has a roomNote, do what it says before you go on.`,
              ...(next === null ? {} : { next: `Then: ${next}` }),
            },
            false,
          );
        }
        default:
          return refused("phase-unknown", "phase is one of launch, begin, part, propose, journal, writer, decline, setting.");
      }
    } catch (err) {
      return refused("threw", String((err as Error).message ?? err));
    }
  }

  /**
   * `reflect` — the waking self (`core/dream/reflect.ts`, 2026-09-27). Every
   * phase binds the session, as `dream` does; `launch` writes nothing.
   */
  private reflectTool(args: Record<string, unknown>): ToolResult {
    const phase = args["phase"];
    if (this.observer) return this.standDown("reflect");
    const bound = this.requireBoundSession(args["session"], "reflect");
    if (bound !== null) return bound;
    const session = this.session as string;
    const reflections = this.counterpart.reflections;
    const refused = (reason: string, detail: string): ToolResult => this.refuse("reflect", reason, { phase, detail });
    const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const part = (v: unknown): { text?: string; cites?: string[]; short?: string } | null => {
      if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
      const r = v as Record<string, unknown>;
      return {
        ...(typeof r["text"] === "string" ? { text: r["text"] } : {}),
        cites: ids(r["cites"]),
        // The page's short version (2026-10-10); the share has none.
        ...(typeof r["short"] === "string" ? { short: r["short"] } : {}),
      };
    };
    try {
      switch (phase) {
        case "launch":
          this.emit("mcp.reflect", undefined, { phase: "launch", session });
          return this.result(
            {
              phase,
              session,
              // After a dream whose run was cut off before it reflected
              // (review of #271): the reflection alone, on that dream.
              prompt: reflections.launchPrompt({ session, dream: typeof args["dream"] === "string" ? args["dream"] : null }),
              how: "Hand `prompt` to a background agent (the Agent tool), unchanged, and carry on. When it finishes, if it left a morning share, tell it to the owner in your own words, then call this tool with phase \"told\".",
            },
            false,
          );
        case "begin": {
          const model = readSession(this.registryDir, session)?.model;
          const dream = typeof args["dream"] === "string" ? args["dream"] : null;
          // The same at the reflection, when the writer comes before it.
          if (nightOrder().indexOf("writer") < nightOrder().indexOf("reflection")) this.counterpart.closeNightWriter({ session, phase: "the reflection" });
          const out = reflections.begin({ session, dream, scope: this.scope, ...(model === undefined ? {} : { model }) });
          if (!out.ok) {
            return refused(
              out.reason,
              out.reason === "reflected-today"
                ? "A reflection already finished today."
                : out.reason === "dream-not-journaled"
                  ? "That dream has not written its journal yet."
                  : "The reflection did not begin.",
            );
          }
          this.emit("mcp.reflect", out.bundle.reflection, { phase: "begin", session, shown: Object.keys(out.bundle.memories).length });
          const handed = this.result(
            {
              phase,
              session,
              reflection: out.bundle.reflection,
              questions: out.bundle.questions,
              // IN PARTS (2026-09-28): said up front, never a silent cut.
              ...(out.bundle.parts === null ? {} : { parts: out.bundle.parts }),
              // THE LOOKUP, with its number (2026-09-28; `PACK_MARGIN` holds room for it).
              how: `${out.instructions}\nWhat is shown only in part (fidelity excerpt, line or id): read it whole with the recall tool, ids: [...] — up to ${String(RECALL_MAX_IDS)} at once.`,
              bundle: out.text,
            },
            false,
          );
          this.notePart("reflection", out.bundle.reflection, 1, out.bundle.parts?.of ?? 1);
          return handed;
        }
        case "part": {
          const reflection = args["reflection"];
          const n = args["part"];
          if (typeof reflection !== "string" || typeof n !== "number") {
            return refused("reflection-and-part-required", "Pass `reflection` (the id `begin` returned) and `part` (2 and up).");
          }
          const out = reflections.part({ reflection, session, part: n });
          if (!out.ok) return refused(out.reason, out.detail ?? "That reflection is not open for this session.");
          this.emit("mcp.reflect", reflection, { phase: "part", part: out.part, of: out.of });
          const handed = this.result(
            {
              phase,
              reflection,
              part: out.part,
              of: out.of,
              bundle: out.text,
              ...(out.part < out.of ? { next: `Then part ${String(out.part + 1)}: the reflect tool, phase "part", reflection: ${reflection}, part: ${String(out.part + 1)}.` } : { next: "That was the last part. Answer the questions, then call finish." }),
            },
            false,
          );
          this.notePart("reflection", reflection, out.part, out.of);
          return handed;
        }
        case "finish": {
          const reflection = args["reflection"];
          const entry = args["entry"];
          // `entry` is required the first time; a second finish of the same
          // reflection (2026-09-28) may leave it out — the entry stands.
          if (typeof reflection !== "string" || (entry !== undefined && typeof entry !== "string")) {
            return refused("reflection-and-entry-required", "Pass `reflection` (the id `begin` returned) and your `entry`.");
          }
          const model = readSession(this.registryDir, session)?.model;
          const out = reflections.finish({
            reflection,
            session,
            ...(typeof entry === "string" ? { entry } : {}),
            ...(typeof args["title"] === "string" ? { title: args["title"] } : {}),
            cites: ids(args["cites"]),
            share: part(args["share"]),
            page: part(args["page"]),
            feelings: Array.isArray(args["feelings"]) ? (args["feelings"] as never) : [],
            about: Array.isArray(args["about"]) ? (args["about"] as never) : [],
            traits: Array.isArray(args["traits"]) ? (args["traits"] as never) : [],
            model: model ?? null,
          });
          if (!out.ok) {
            return refused(
              out.reason,
              out.detail ??
                (out.reason === "reflection-closed"
                  ? "That reflection is closed: it is not today's, or a newer one followed it. Begin a new one tomorrow."
                  : "The reflection was not written."),
            );
          }
          const o = out.outcome;
          this.emit("mcp.reflect", reflection, { phase: "finish", nothingMuch: o.nothingMuch, page: o.page.written, share: o.share.offered, again: o.again });
          return this.result(
            {
              phase,
              reflection,
              handBack: o.handBack,
              nothingMuch: o.nothingMuch,
              entry: o.entryId,
              entryNote: o.entry,
              page: o.page,
              share: o.share,
              returned: o.returned,
              feelings: o.feelings,
              about: o.about,
              ...(o.traits.length > 0 ? { traits: o.traits } : {}),
              ...(o.refusedCites.length > 0 ? { refusedCites: o.refusedCites } : {}),
              // WHAT WAS NOT WRITTEN, and that it can be sent again (2026-09-28).
              ...(o.retry === null ? {} : { again: o.retry }),
              say:
                o.retry === null
                  ? "Return `handBack` as your final message, unchanged."
                  : "Some parts were not written (see `again`). You may fix them and call finish again with the same reflection and just those parts; then return the `handBack` of your last finish call as your final message, unchanged. Never say a part was written when it was not.",
            },
            false,
          );
        }
        case "settle": {
          // THE REFLECTION MAY SETTLE (2026-09-29): two memories it was shown,
          // with a plain reason; the trail names the reflection.
          const reflection = args["reflection"];
          const holds = args["holds"];
          const over = args["over"];
          if (typeof reflection !== "string" || typeof holds !== "string" || typeof over !== "string") {
            return refused("reflection-holds-over-required", "Pass `reflection`, `holds` and `over` (two ids it was shown), `how` and `why`.");
          }
          const out = reflections.settle({
            reflection,
            session,
            holds,
            over,
            how: typeof args["how"] === "string" ? args["how"] : "",
            why: typeof args["why"] === "string" ? args["why"] : "",
          });
          this.emit("mcp.reflect", reflection, { phase: "settle", ok: out.ok });
          return this.result({ phase, reflection, settle: { ...out } }, !out.ok);
        }
        case "told": {
          const reflection = args["reflection"];
          if (typeof reflection !== "string") return refused("reflection-required", "Pass `reflection`, the id the share named.");
          const out = reflections.told({ reflection, session });
          if (!out.ok) return refused(out.reason, "Nothing to record: the share was already told, or there was none.");
          this.emit("mcp.reflect", reflection, { phase: "told", cited: out.cited });
          return this.result({ phase, reflection, told: true, cited: out.cited }, false);
        }
        default:
          return refused("phase-unknown", "phase is one of launch, begin, part, finish, settle, told.");
      }
    } catch (err) {
      return refused("threw", String((err as Error).message ?? err));
    }
  }

  /**
   * `self_page` — read the page, or write it whole.
   *
   * **It binds no session, exactly as `remember` does not.** The page is not one
   * session's account of itself the way a chapter is; it is the standing one,
   * and a session that can write a note about the world can write the page about
   * itself. The `by` field on the row says `session` for everything that comes
   * through here, and no argument can change it: the console writes `owner` and
   * the nightly writer will write `writer`, from their own doors.
   *
   * READING is allowed in every stance the tool answers in at all, including
   * observer — "what does my page say" must always be answerable — and the
   * stand-down guards the WRITE alone, which is the shape `scope` already has.
   */
  private selfPageTool(args: Record<string, unknown>): ToolResult {
    const body = args["body"];
    const short = args["short"];
    if (short !== undefined && typeof short !== "string") {
      return this.refuse("self_page", "short-not-text", {
        detail: "`short` is the short version of the page, as text — or leave it out.",
      });
    }
    if (body === undefined && short === undefined) return this.selfPageRead();
    if (this.observer) return this.standDown("self_page");
    // A NON-STRING body is a malformed call and stops here; an EMPTY one goes
    // THROUGH the seam, because the seam is what writes the durable refusal row
    // this tool's own description promises. The short-circuit that used to catch
    // both left `self_page({ body: "   " })` as the one refusal on this path
    // with no row behind it (adversarial review m4).
    if (body !== undefined && typeof body !== "string") {
      return this.refuse("self_page", "body-required", {
        detail:
          "A page has to say something. Pass the whole page as text; omit `body` entirely to read the one that is there.",
      });
    }
    const reason = args["reason"];
    const ifVersion = args["ifVersion"];
    if (
      ifVersion !== undefined &&
      (typeof ifVersion !== "number" || !Number.isInteger(ifVersion) || ifVersion < NO_PAGE_VERSION)
    ) {
      return this.refuse("self_page", "if-version-not-a-number", {
        detail:
          "`ifVersion` is the whole number the read gave you as `version` (-1 when there was no page), or leave it out.",
      });
    }
    // BIND FIRST, AND NON-FATALLY. This server is launched from a static host
    // configuration and never learns which session it serves; it binds lazily,
    // on the first tool call that carries an id (`requireBoundSession`). Every
    // other tool that needs one REFUSES without it — but this one has always
    // worked unbound, so a session claim here is honoured when it corroborates
    // and simply not honoured when it does not. The page is never refused over
    // it: what a bad claim costs is the `writer` label, and the ring says why.
    //
    // Without this, the page-writer ask could not work at all in session mode.
    // A session answering it right after its wake has called nothing else, so
    // `this.session` is null, so the registry mark is never read, so every
    // night's revision was filed as an ordinary amendment and the night read
    // as "nothing to say" — the exact inverse of the honesty this is for.
    const claimedSession = this.bindForPageWriter(args["session"]);
    // WHICH DOOR THIS IS. `by` is the door's and is not claimable from outside
    // (`self/page.ts`), so the model's word for "I am the nightly writer" is
    // worth nothing here. What the server reads instead is the mark the
    // SessionStart hook left on this session's registry record when it handed
    // over the page-writer ask, and it is a DATE: a session asked to write
    // about 09-19 writes `writer` for that run and nothing else, and a stale
    // mark cannot relabel a write made two days later (`adapters/sessions.ts`).
    const writerFor = this.pageWriterMark(claimedSession);
    const model = this.sessionModel();
    const said = typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;
    const common = {
      ...(model === undefined ? {} : { model }),
      by: writerFor === null ? ("session" as const) : ("writer" as const),
      // WHICH SESSION, when this server has one. `remember` resolves it the same
      // way; null is recorded rather than a guess (adversarial review M3).
      session: this.session,
      ...(ifVersion === undefined ? {} : { ifVersion }),
    };
    // THE SHORT VERSION (2026-10-10): beside the page, or — with no `body` —
    // added to the page as it stands, as a revision of the same text.
    const written =
      typeof body === "string"
        ? this.counterpart.revisePage(body, { ...common, reason: said ?? "amended", ...(short === undefined ? {} : { short }) })
        : this.counterpart.addPageShort(short ?? "", { ...common, ...(said === null ? {} : { reason: said }) });
    this.emit("mcp.self_page", written.id ?? undefined, {
      stored: written.written,
      reason: written.reason,
      bytes: written.bytes,
      version: written.version,
      writerFor: writerFor?.about ?? null,
      writerMode: writerFor?.mode ?? null,
    });
    // THE NIGHT'S OWN ROW, closed here because this is where the answer arrives.
    // Both arms are recorded: a refused revision is the writer having run and
    // been turned away, which is a different fact from a night that never
    // started, and only the row can tell them apart afterwards. A recording
    // failure costs the row and never the write (§5 G7).
    // A short version added on its own is not the night's page: the night's
    // row was written with the page.
    if (writerFor !== null && typeof body === "string") {
      try {
        this.counterpart.recordPageWriterRun({
          about: writerFor.about,
          mode: writerFor.mode,
          outcome: written.written ? "revised" : "refused",
          // A refusal for length carries its numbers (review of #358), so the
          // row — and the night's close, if the run moves on without a
          // shorter page — says how far over it was.
          detail: written.written
            ? ""
            : written.reason === "too-large"
              ? pageTooLargeDetail(written.bytes, this.counterpart.self.tunables.PAGE_MAX_BYTES)
              : written.reason,
          bytesAfter: written.written ? written.bytes : 0,
        });
      } catch {
        /* the page is written; the bookkeeping is not worth the answer */
      }
    }
    if (!written.written) {
      // THE CEILING, IN NUMBERS (2026-10-09): a writer told only "past the
      // limit" guesses how much to take out; told both numbers, it tightens
      // once and sends the page again.
      const limit = this.counterpart.self.tunables.PAGE_MAX_BYTES;
      return this.refuse("self_page", written.reason, {
        bytes: written.bytes,
        ...(written.reason === "too-large" ? { limit, over: written.bytes - limit } : {}),
        ...(written.short === null ? {} : { short: written.short }),
        ...(written.gate === null ? {} : { gate: written.gate }),
        // On a stale write, hand back what is actually there so the session can
        // merge rather than guess — the whole point of the check.
        ...(written.current === null
          ? {}
          : { currentVersion: written.current.version, currentBody: written.current.body }),
        detail: PAGE_REFUSAL_DETAIL[written.reason] ?? "The page was not written.",
      });
    }
    return this.result(
      {
        stored: true,
        reason: written.reason,
        id: written.id,
        version: written.version,
        bytes: written.bytes,
        // THE GATE CHANGED IT. Accepted is not the same as unaltered, and a
        // session told only `stored: true` would go on believing it wrote what
        // it sent (m1).
        ...(written.redacted === null
          ? {}
          : {
              redacted: true,
              redactedBy: written.redacted.gate,
              bytesBeforeRedaction: written.redacted.bytesBefore,
            }),
        // PAST ITS ROOM, SAID (2026-10-10): kept whole, and what sessions read
        // on a day the wake cannot hold it — its short version, or, without
        // one, its outline, with the way to add one.
        ...pageRoomAnswer(written, this.counterpart.self.tunables.PAGE_ROOM_BYTES),
        // WHEN IT WILL BE READ, precisely. The bundle every session wakes with
        // is composed by a worker and served unchanged until the next render,
        // so "it is live now" would be false for as long as this session lasts.
        // Since 2026-09-30 the write marks the wake behind and the next turn's
        // end re-renders it (`self/behind.ts`).
        appearsAtWake: "the next session's wake, once a turn has ended — the worker a turn's end starts re-renders it",
      },
      false,
    );
  }

  private selfPageRead(): ToolResult {
    const page = this.counterpart.selfPage();
    if (page === null) {
      return this.result(
        {
          present: false,
          reason: "still-forming",
          // THE VERSION OF "NOTHING", so a session that was told to pass the
          // version back can do it on a first write too. Without a value here,
          // the natural `0` was refused with a sentence saying somebody else had
          // written the page, which was untrue (adversarial review MINOR-C).
          version: NO_PAGE_VERSION,
          detail:
            "No page has been written here yet. Write one when you have something true to say about yourself; while there is nothing, the honest page says it is still forming. Pass this `version` back as `ifVersion` if you want the write refused should one appear meanwhile.",
        },
        false,
      );
    }
    return this.result(
      {
        present: true,
        body: page.body,
        bytes: page.bytes,
        // ITS ROOM AND ITS SHORT VERSION (2026-10-10): what the wake shows on a
        // day it has no room for the whole page.
        room: this.counterpart.self.tunables.PAGE_ROOM_BYTES,
        ...(page.short === null ? {} : { short: page.short.body, shortBytes: page.short.bytes }),
        revisedOn: page.revisedOn,
        by: page.by,
        version: page.version,
        // EVERY SECTION'S HEADING, in order (2026-09-28): any `##`, not only
        // Core and Lately.
        sections: pageSections(page.body).sections.map((s) => s.heading),
        stale: this.counterpart.self.pageStale(page),
        // COUNTED, not read: `selfPageVersions().length` read every archived
        // body off disk to print one number, on every read a session makes
        // (adversarial review m9).
        versions: this.counterpart.selfPageVersionCount(),
      },
      false,
    );
  }

  /**
   * The bound-session refusal, and the ONE way a server binds itself.
   *
   * Three states, in order:
   *
   *   1. **The host said so at launch** (`--session`). Unchanged and preferred:
   *      the registry is never consulted, and a claim for another id is refused.
   *   2. **Already bound** — by launch or by an earlier claim. The bind is for
   *      the process's lifetime, so a second, DIFFERENT id is refused with the
   *      reason that says why.
   *   3. **Unbound.** The claim must name an id (never inferred — see the
   *      CONTRACT's residual risk: two live sessions in one directory are
   *      distinguishable only by the id the ask named), and that id must be in
   *      the hooks' registry, live, and in THIS server's scope. Every refusal
   *      says which of the four it was, because a model that cannot tell
   *      "unknown id" from "wrong project" cannot do anything about either.
   */
  /**
   * IS THIS SESSION THE NIGHT'S WRITER, and for which day?
   *
   * `by` on a page revision is the DOOR's and is not claimable from outside
   * (`self/page.ts`), so this server may not take a tool argument's word for it.
   * The evidence, since 2026-09-28, is the NIGHTLY RUN's claim row in the
   * store — written by the run's `writer` phase, naming this session, and
   * counted only when the write names that session itself — and,
   * kept readable for older records, the mark the SessionStart
   * hook used to write (`pageWriterFor`, a DATE, on this session's registry
   * record, `adapters/sessions.ts`; nothing writes it now). Either counts only
   * while that night's claim is still open: a session that lives past
   * midnight, or one whose night has already been answered, writes as an
   * ordinary session again. Null on every other path, including an unbound
   * server, which is the direction that never over-claims. The run's claim
   * counts only for a write that names the session in its call (review of
   * #271): the run's agent shares its session's id, and the session's own
   * page edit, which names none, stays an ordinary amendment.
   */
  /**
   * A session claim on the PAGE's door: corroborated if it can be, ignored if
   * it cannot, and never a refusal.
   *
   * `requireBoundSession` is reused rather than reimplemented — it is the only
   * place that knows what corroboration means (known to the hooks' registry,
   * live, and in this server's scope) and it already emits the reason on every
   * arm. Its refusal VALUE is discarded here, which is the whole difference
   * between this door and `chapter`'s: a page amendment has never needed a
   * session and must not start being refused for lack of one.
   */
  private bindForPageWriter(claimed: unknown): string | null {
    if (typeof claimed !== "string" || claimed.length === 0) return null;
    if (this.session !== null) return this.session === claimed ? claimed : null;
    // CORROBORATE WITHOUT BINDING (S2 review, MINOR-3). The first version called
    // `requireBoundSession`, which sets `lazySession` and FREEZES it for the
    // life of the process — so a page write naming another live in-scope
    // session would have bound this server to that session, and every later
    // `remember` and `chapter` from it would have been attributed there. The page's
    // door needs one thing and one thing only: is this id a session I may
    // label a write with. That is a question, not a binding.
    const ok = this.corroborate(claimed);
    if (!ok) {
      this.emit("mcp.session.unbound", undefined, { reason: "page-writer-claim" });
      return null;
    }
    return claimed;
  }

  /** The person's calendar day now, in the store's zone (docs/time.md rule 3),
   *  off this server's injectable clock — what a past `eventDate` is told against. */
  private today(): string {
    return todayIn(this.counterpart.store.zone(), this.nowFn());
  }

  /**
   * The model the hooks last saw answer in THIS server's bound session — the
   * relay a chapter's model takes (self NOTES §24), used since 2026-09-25 for
   * the `model` column on every row a tool writes (schema v7). Undefined when
   * no session is bound (`remember` and `self_page` work unbound) or the record
   * names none; the row then records NULL rather than a guess. On the live
   * host the server is launched with no session, so a `remember` before the first
   * `chapter` / `session_end` binds it records NULL — accepted (review N3).
   */
  private sessionModel(session: string | null = this.session): string | undefined {
    if (session === null || !isKnownSession(session)) return undefined;
    try {
      return readSession(this.registryDir, session)?.model;
    } catch {
      return undefined;
    }
  }

  /**
   * THE SESSION THIS SERVER'S HOST IS RUNNING HERE, found by process
   * (2026-10-01, random-f2's items 4 and 12) — for a write or a read made
   * before any claim bound this server. The host that launched this server
   * (`identity.hostPid`, fixed at launch) is the parent of the hook that
   * opened the session (`opened.hookPpid`), so one live record in this scope
   * with that pid is this server's session (`sessions.ts#sessionOfHost`).
   * Not a bind: nothing is frozen, so a later `/clear` — a new session in the
   * same host — is found afresh, and a `chapter` claim binds as it always
   * did. Null for Claude Desktop (one server, every chat: `bindDesktopCall`),
   * for a server that recorded no launch, and whenever the match is not
   * exact. Never throws.
   */
  private hostSession(): string | null {
    // Claude Code only, by its own environment (review of #311): another
    // client's host process says nothing about Claude Code's sessions.
    if (this.desktop || this.identity === null || claudeCodeEnvMarker(this.env) === null) return null;
    const found = sessionOfHost(this.registryDir, {
      hostPid: this.identity.hostPid,
      scope: this.scope,
      now: this.nowFn(),
      launchedAt: this.identity.startedAt,
      ttlMs: this.sessionTtlMs,
    });
    // Seen, matched or not: a match nobody can see made is the failure here.
    this.emit("mcp.session.host", found ?? undefined, { matched: found !== null });
    return found;
  }

  /** Known to the hooks' registry, live, and in THIS server's scope — the same
   *  three tests `requireBoundSession` makes, asked without the side effect. */
  private corroborate(claimed: string): boolean {
    const record = readSession(this.registryDir, claimed);
    if (record === null) return false;
    if (!isLive(record, this.nowFn(), this.sessionTtlMs)) return false;
    return sameScope(record.scope, this.scope);
  }

  private pageWriterMark(
    claimedSession: string | null,
  ): { about: string; mode: PageWriterMode } | null {
    try {
      // THE NIGHTLY RUN'S CLAIM (2026-09-28), the channel the default mode
      // uses now: the claim the run's `writer` phase wrote names the session.
      // Only a write that NAMES that session in its call counts — the writer
      // instruction says to — never the session this server happens to be
      // bound to: the run binds it early, and a page edit the owner directs in
      // the same session must stay an ordinary amendment (review of #271).
      const night = claimedSession === null ? null : this.counterpart.nightClaimFor(claimedSession);
      if (night !== null) return { about: night.about, mode: night.mode };
      const about = this.pageWriterClaim(claimedSession);
      if (about === null) return null;
      // THE MODE COMES FROM THE CLAIM THIS IS CLOSING, not from the channel the
      // mark arrived by (S2 review, MINOR-2): the open claim knows which it was.
      const open = this.counterpart
        .pageWriterRuns({ about })
        .find((r) => r.outcome === "asked" || r.outcome === "started");
      if (open === undefined || !this.counterpart.pageWriterClaimOpen(about)) return null;
      return { about, mode: open.mode };
    } catch {
      return null;
    }
  }

  /**
   * The older channel the mark can arrive by, and it is not the tool call: the
   * REGISTRY mark the retired SessionStart ask wrote (nothing writes it now; it
   * is still read). Checked against the night's claim by the caller. (The
   * removed host mode's ENVIRONMENT pin, `COUNTERPARTS_PAGE_WRITER`, was the
   * other channel until 2026-09-29.)
   */
  private pageWriterClaim(claimedSession: string | null): string | null {
    // The session this call NAMED and that corroborated, else the one this
    // server was launched bound to. Never an uncorroborated claim.
    const id = claimedSession ?? this.session;
    if (id === null) return null;
    const about = readSession(this.registryDir, id)?.pageWriterFor;
    return about === undefined || about.length === 0 ? null : about;
  }

  private requireBoundSession(claimed: unknown, tool: ToolName): ToolResult | null {
    const bound = this.session;
    if (bound !== null) {
      if (claimed !== undefined && claimed !== bound) {
        this.emit("mcp.session.mismatch", undefined, {
          bound: true,
          source: this.launchedSession !== null ? "launch" : "registry",
        });
        return this.refuse(tool, "session-mismatch", {
          detail:
            "This server is already bound to a different session, for the life of the process. A dump belongs to the session that lived it.",
        });
      }
      return null;
    }

    // CLAUDE DESKTOP (2026-09-30): this call was bound, or not, by
    // `bindDesktopCall` — per call, never frozen for the process — and a call
    // it could not bind is refused here by the reason it found.
    if (this.desktop) {
      const why = this.callRefusal ?? { reason: "session-required", detail: NO_DESKTOP_SESSION };
      this.emit("mcp.session.unbound", undefined, { reason: why.reason, host: this.host });
      return this.refuse(tool, why.reason, { detail: why.detail });
    }

    if (typeof claimed !== "string" || claimed.length === 0) {
      this.emit("mcp.session.unbound", undefined, { reason: "no-claim" });
      return this.refuse(tool, "session-required", {
        detail:
          "This server was launched without a session. Pass `session` — the session id the end-of-session ask named — and it will bind to it.",
      });
    }

    const record = readSession(this.registryDir, claimed);
    if (record === null) {
      this.emit("mcp.session.unbound", undefined, { reason: "unknown" });
      return this.refuse(tool, "session-unknown", {
        detail:
          "No live session by that id has been recorded by this host's hooks. Use the id the end-of-session ask named, exactly.",
      });
    }
    if (!isLive(record, this.nowFn(), this.sessionTtlMs)) {
      this.emit("mcp.session.unbound", undefined, {
        reason: record.endedAt === null ? "stale" : "ended",
      });
      return this.refuse(tool, "session-not-live", {
        detail:
          "That session has ended or has been silent too long to still be writing its own day. Its memories belong to the sweep now.",
      });
    }
    if (!sameScope(record.scope, this.scope)) {
      this.emit("mcp.session.unbound", undefined, { reason: "scope-mismatch" });
      return this.refuse(tool, "scope-mismatch", {
        detail:
          "That session is running in a different project than this server. A dump belongs to the project that lived it.",
      });
    }

    this.lazySession = claimed;
    this.emit("mcp.session.bound", claimed, { source: "registry", scope: this.scope });
    return null;
  }

  // ── result shapes ──────────────────────────────────────────────────────────

  /**
   * The feelings half of a deposit (schema v7): written onto the memory that
   * just minted, and answered as `feelings: { stored, other? }` — `other`
   * listing each emotion kept as `other` with the wheel keys nearest it, so the
   * caller can rewrite. Nothing when none were sent or nothing minted. A throw
   * here costs the feelings, never the memory, and says so.
   */
  private recordFeelings(
    deposit: DepositResult,
    inputs: readonly FeelingInput[],
    model: string | undefined,
  ): Record<string, unknown> {
    if (inputs.length === 0) return {};
    // A note that did not land (a duplicate, a gate) takes its feelings with it
    // — and SAYS so (review N6), rather than dropping them without a word.
    if (!deposit.deposited || deposit.memoryId === null) {
      return {
        feelings: {
          stored: 0,
          reason: "memory-not-stored",
          detail: `The memory was not stored (${deposit.reason}), so its ${String(inputs.length)} feeling${inputs.length === 1 ? " was" : "s were"} not stored either.`,
        },
      };
    }
    try {
      const added = this.counterpart.addFeelings(deposit.memoryId, inputs, model === undefined ? {} : { model });
      // Two kinds of notice (emotion part A): a word kept as the writer's own
      // (`other`), with a suggestion ONLY when a wheel word is genuinely close;
      // and a word read as a wheel word (`readAs`: thankful → grateful).
      const kept = added.notices.filter((n) => n.readAs === undefined);
      const read = added.notices.filter((n) => n.readAs !== undefined);
      return {
        feelings: {
          stored: added.ids.length,
          ...(kept.length === 0
            ? {}
            : {
                other: kept.map((n) => ({
                  index: n.index,
                  word: n.word,
                  core: n.core,
                  closest: n.closest,
                  note:
                    n.closest.length === 0
                      ? `"${n.word}" is not on the feelings wheel, so it was kept as your own word.`
                      : `"${n.word}" is not on the feelings wheel, so it was kept as your own word. If you meant ${n.closest.join(" or ")}, say it that way next time.`,
                })),
              }),
          ...(read.length === 0
            ? {}
            : {
                readAs: read.map((n) => ({
                  index: n.index,
                  word: n.word,
                  as: n.readAs,
                  note: `"${n.word}" was stored as ${String(n.readAs)}.`,
                })),
              }),
          // ACCEPT AND REPAIR (2026-09-28): an emotion that carried a phrase
          // was split into the word and carried_by, rather than refused.
          ...(added.repairs.length === 0
            ? {}
            : { repaired: added.repairs.map((r) => ({ index: r.index, field: r.field, now: r.now, note: r.note })) }),
        },
      };
    } catch (err) {
      return { feelings: { stored: 0, reason: "threw", detail: String((err as Error).message ?? err) } };
    }
  }

  /**
   * The `about` half of a deposit (schema v9): what the memory is about, set
   * by the writer who just wrote it (`about_by = 'writer'`). Nothing when none
   * was sent, unless a revision carried its memory's over; said when the
   * memory did not land. A `skill` memory is the craft
   * — how I work — and is never core (`aboutMe` never reads one as a
   * candidate), so a core mark on one is stored as asked, with a note
   * (2026-09-28: it was refused `skill-is-how-i-work`).
   */
  private recordAbout(deposit: DepositResult, mark: AboutMark | null): Record<string, unknown> {
    // None sent: a revision took the mark of the memory it revises (2026-10-11), and says so.
    if (mark === null) {
      const carried = deposit.aboutCarried;
      return carried === undefined ? {} : { about: { stored: true, mark: carried.mark, carriedFrom: carried.from } };
    }
    if (!deposit.deposited || deposit.memoryId === null) {
      return { about: { stored: false, reason: "memory-not-stored" } };
    }
    try {
      const row = this.counterpart.store.row(deposit.memoryId);
      const skill = row?.kind === "skill" && (CORE_ABOUT_MARKS as readonly string[]).includes(mark);
      this.counterpart.store.setAbout(deposit.memoryId, mark, { by: "writer" });
      return {
        about: {
          stored: true,
          mark,
          ...(skill ? { note: "A skill memory is the craft — how I work — and never becomes core, whatever its mark." } : {}),
        },
      };
    } catch (err) {
      return { about: { stored: false, reason: "threw", detail: String((err as Error).message ?? err) } };
    }
  }

  /**
   * The trait half of a deposit (folded into v9): the nudges written onto
   * the memory that just minted, answered as `traits: { stored }`. Nothing
   * when none were sent; said when the memory did not land. A throw here
   * costs the nudges, never the memory, and says so.
   */
  private recordTraits(deposit: DepositResult, inputs: readonly TraitInput[], model: string | undefined): Record<string, unknown> {
    if (inputs.length === 0) return {};
    if (!deposit.deposited || deposit.memoryId === null) {
      return {
        traits: {
          stored: 0,
          reason: "memory-not-stored",
          detail: `The memory was not stored (${deposit.reason}), so its ${String(inputs.length)} trait ${inputs.length === 1 ? "nudge was" : "nudges were"} not stored either.`,
        },
      };
    }
    try {
      const added = this.counterpart.addTraits(deposit.memoryId, inputs, model === undefined ? {} : { model });
      return {
        traits: {
          stored: added.ids.length,
          // ACCEPT AND REPAIR (2026-09-28): an over-long carried_by was kept to its length.
          ...(added.repairs.length === 0 ? {} : { repaired: added.repairs.map((r) => ({ index: r.index, note: r.note })) }),
        },
      };
    } catch (err) {
      return { traits: { stored: 0, reason: "threw", detail: String((err as Error).message ?? err) } };
    }
  }

  private depositResult(tool: string, deposit: DepositResult, extra: Record<string, unknown> = {}, isError?: boolean): ToolResult {
    this.emit(`mcp.${tool}`, deposit.memoryId ?? undefined, {
      stored: deposit.deposited,
      reason: deposit.reason,
      gate: deposit.gate,
      covers: deposit.covers.length,
    });
    const lifted = deposit.mint?.lifted ?? false;
    return this.result(
      {
        stored: deposit.deposited,
        reason: deposit.reason,
        ...(deposit.memoryId === null ? {} : { id: deposit.memoryId }),
        ...(deposit.gate === null ? {} : { gate: deposit.gate }),
        ...(lifted ? { salienceLifted: true } : {}),
        ...extra,
      },
      isError ?? !deposit.deposited,
    );
  }

  /**
   * The stand-down (§5 G5, scars E7/§2.4). It is loud on purpose: a tool that
   * returned nothing under observer would be indistinguishable from a tool that
   * crashed, and v1 shipped exactly that ambiguity.
   */
  private standDown(tool: string): ToolResult {
    this.emit("mcp.observer.standdown", undefined, { tool });
    return this.result(
      {
        stoodDown: true,
        tool,
        stance: "observer",
        reason:
          "This session is an observer: it reads the store as an instrument and changes nothing in it. The tool did not run.",
      },
      true,
    );
  }

  private refuse(
    tool: string,
    reason: string,
    extra: Record<string, unknown>,
  ): ToolResult {
    this.emit("mcp.refused", undefined, { tool, reason });
    return this.result({ stored: false, tool, reason, ...extra }, true);
  }

  /**
   * THE LAST WORD ON SIZE (2026-10-02). Every result leaves through here, the
   * last step of `call`. The caps upstream (the dream's and the reflection's
   * parts, the writer's day, recall's rooms) all derive from one ceiling
   * (`fit/TOOL_RESULT_CEILING`) and should keep every result under it; this is
   * the net for the one that does not. Measured the way Claude Code measures —
   * `structuredContent` serialized, which is what it hands the model — by
   * `wireChars`, so a non-ASCII character counts toward the token line too.
   *
   * Over it, the result is NOT shipped to be spilled: its longest top-level
   * string (a bundle, the writer's block, the wake) is cut to fit, a `cut`
   * field says so in words, and one durable `mcp.result.oversize` row records
   * the tool, the phase and the sizes — never the text — so doctor goes amber.
   * A result with no long string to cut (a list) is shipped as it is, and
   * recorded the same way. A guard by a margin and a stated cut, never a
   * refusal: the part that fits still reaches the model.
   */
  private withinCeiling(name: string, args: Record<string, unknown>, result: ToolResult): ToolResult {
    const ceiling = this.resultCeilingChars;
    const sc = result.structuredContent;
    const measured = wireChars(JSON.stringify(sc));
    if (measured <= ceiling) return result;
    let field: string | null = null;
    for (const [k, v] of Object.entries(sc)) {
      if (typeof v === "string" && (field === null || v.length > (sc[field] as string).length)) field = k;
    }
    const phase = typeof args["phase"] === "string" ? args["phase"] : null;
    const noteFor = (f: string): string =>
      `This answer came to ${String(measured)} characters, more than the ${String(ceiling)} one tool answer carries whole, ` +
      `so the server cut \`${f}\` to fit: what is shown is its beginning, and the rest did not reach you. ` +
      `Work with what is here and say so; nothing was refused.`;
    // The rest of the result, measured with the note beside it. When the bulk
    // is not that string (a list), cutting it cannot bring the result under:
    // it ships as it is, recorded, rather than losing an instruction for nothing.
    const rest = field === null ? measured : wireChars(JSON.stringify({ ...sc, [field]: "", cut: noteFor(field) }));
    if (rest > ceiling) field = null;
    let out = result;
    let cutTo = measured;
    if (field !== null) {
      const value = sc[field] as string;
      const note = noteFor(field);
      // The field gets what is left — a FIXED target (review of #315: the first
      // version shrank its target each try and kept about (2−r)⁶ of what fits
      // for escaped text). The longest cut whose ESCAPED cost fits is found by
      // halving: `clipWire` keeps more as its limit grows, so the search is exact.
      const target = Math.max(0, ceiling - rest);
      const escaped = (s: string): number => wireChars(JSON.stringify(s)) - 2;
      let lo = 0;
      let hi = target;
      let kept = clipWire(value, 0);
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const tried = clipWire(value, mid);
        if (escaped(tried) <= target) {
          kept = tried;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (escaped(kept) > target) kept = "";
      const payload: Record<string, unknown> = { ...sc, [field]: kept, cut: note };
      // The text copy follows the shape it had: the wake rides as its own text,
      // everything else as the payload's JSON.
      const asText = result.content.length === 1 && result.content[0]?.text === value;
      out = {
        content: [{ type: "text", text: asText ? `${kept}\n\n${note}` : JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        ...(result.isError === true ? { isError: true } : {}),
      };
      cutTo = wireChars(JSON.stringify(payload));
    }
    this.emit("mcp.result.oversize", undefined, { tool: name, phase, chars: measured, cutTo });
    // The cut already happened; a lost row costs doctor's amber, never the answer.
    this.telemetry(() => {
      this.counterpart.noteAdapterEvent(MCP_OVERSIZE_EVENT, {
        tool: name,
        phase,
        chars: measured,
        ceiling,
        field,
        cut: field !== null,
        cutTo,
      });
    });
    return out;
  }

  /**
   * A TELEMETRY WRITE, never the answer (review of #315). The store's write
   * guard records a `busy` or `ahead` verdict in `writeTripped`, and `call`
   * turns any tripped verdict into the tool's refusal — right for a tool's own
   * write, wrong for the row a READ leaves behind (a part handed, a recall
   * counted): a lock held for a moment would turn the part into a refusal.
   * So the verdict is put back as it was, and the row is simply lost.
   */
  private telemetry(write: () => void): void {
    const before = this.writeTripped;
    try {
      write();
    } catch {
      /* evidence, never a reason to fail the call */
    } finally {
      this.writeTripped = before;
    }
  }

  /**
   * A PART HANDED (2026-10-02): one durable `mcp.part` row per part — part 1
   * being the begin — so doctor can hold the parts a begin promised against
   * the parts that were fetched. The handler only marks it (`notePart`); the
   * row is written by `call` AFTER the net (`writePart`), so `chars` is what
   * left the server and `cut` says whether the net had to act (review of
   * #315: it recorded the size from before the cut). Counts and ids only.
   */
  private notePart(mechanism: FitMechanism, ref: string, part: number, of: number): void {
    this.partHanded = { mechanism, ref, part, of };
  }

  private writePart(result: ToolResult): void {
    const p = this.partHanded;
    this.partHanded = null;
    if (p === null) return;
    const cut = typeof result.structuredContent["cut"] === "string";
    this.telemetry(() => {
      this.counterpart.noteAdapterEvent(MCP_PART_EVENT, { ...p, chars: wireChars(JSON.stringify(result.structuredContent)), cut });
    });
  }

  private result(payload: Record<string, unknown>, isError: boolean): ToolResult {
    // THE WHOLE PAYLOAD IN BOTH (2026-09-29, the first real headless run).
    // From 2026-09-28 the long `bundle` rode only in the text, with
    // `bundleChars` in its place in `structuredContent`, on the guess that a
    // host counts both copies. Claude Code (2.1.284) does not count both: when
    // a result carries `structuredContent` it hands the MODEL that — serialized
    // — and drops the text items. So every dream and reflection was shown
    // counts and no memories: the run said "the bundles came back to me as
    // counts only", and missed a contradiction it was seeded with. The text
    // stays the whole payload too, for a host that reads only the text.
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      ...(isError ? { isError: true } : {}),
    };
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const event: McpEvent = { at: this.nowFn(), name };
    if (ref !== undefined) event.ref = ref;
    if (data !== undefined) event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(event);
  }

  /** True once a client has completed the handshake. Host trivia, checkable. */
  ready(): boolean {
    return this.initialized;
  }
}

/**
 * What one handle-path answer should leave in the resolution log, as a TOTAL
 * table over the reasons that path can produce:
 *
 *   an id       — it expanded, and this is what it reached
 *   `null`      — it was asked and answered with nothing (the shadow)
 *   `undefined` — not this path's outcome at all; record nothing
 *
 * Total on purpose. A new handle-path reason added without a line here records
 * nothing rather than guessing, which fails in the under-credit direction.
 */
/**
 * THE LOOKUP, NAMED IN THE DREAM'S OWN RESULT (2026-09-28): what tonight's
 * room gave, what waits, and how to read the rest — with the number of ids
 * one recall takes. Kept short: `dreamResultChars`' margin holds room for it.
 */
export function dreamHow(bundle: Pick<DreamBundle, "queue" | "shownAs">): string {
  const q = bundle.queue;
  const s = bundle.shownAs;
  const waits = q.waiting > 0 ? ` ${String(q.waiting)} more new wait for the next night.` : "";
  const aged = q.agedOut > 0 ? ` ${String(q.agedOut)} aged out of the queue since the last dream, never dreamed.` : "";
  return (
    `Tonight: ${String(q.tonight)} of ${String(q.new)} new memories.${waits}${aged} ` +
    `Shown whole: ${String(s.whole)}; as an excerpt: ${String(s.excerpt)}; as a line: ${String(s.line)}${s.notShown > 0 ? `; related, not shown: ${String(s.notShown)}` : ""}. ` +
    `To read any whole, call the recall tool with ids: [...] — up to ${String(RECALL_MAX_IDS)} at once.`
  );
}

/**
 * THE TWO MODES, in the words a refusal teaches them with (Release B,
 * 2026-10-03). There is no default: the caller says which question it is
 * asking.
 */
export const RECALL_MODE_WORDS =
  'A question needs mode: "facts" — what happened, who said it, when, and whether it still holds (every match, ranked, with dates and speaker); or "meaning" — how something went, felt, and what it adds up to (a person, a project, us).';

/** What one recall call's durable row says (`noteRecall`). Counts only. */
interface RecallRowFields {
  readonly path: "handle" | "question" | "none";
  readonly reason: string;
  readonly semantic: string;
  readonly considered: number;
  readonly storeSize: number;
  readonly expanded: number;
  readonly blockedBy: Readonly<Record<string, number>>;
  readonly mode?: "facts" | "meaning";
  readonly matched?: number;
  readonly shown?: number;
  readonly faded?: number;
  readonly page?: number;
  /** A question that named a time: `window`, `event` or `session`. */
  readonly time?: string;
  /** Meaning mode's own counts (`MeaningResult.counts`). */
  readonly counts?: Readonly<Record<string, number>>;
}

/**
 * The address paths' refusals are their own `reason` — one per id on the
 * `ids` path, so three unknown ids read as three and not as one.
 */
function addressBlocked(result: DeliberateResult): Record<string, number> {
  const out: Record<string, number> = {};
  const reasons =
    result.path === "none"
      ? [result.reason]
      : result.perId === undefined
        ? result.reason === "expanded"
          ? []
          : [result.reason]
        : result.perId.filter((p) => p.reason !== "expanded").map((p) => p.reason);
  for (const r of reasons) out[r] = (out[r] ?? 0) + 1;
  return out;
}

function resolvedIdOf(result: DeliberateResult): string | null | undefined {
  switch (result.reason) {
    case "expanded":
      return result.memories.length === 1 ? (result.memories[0]?.id ?? null) : undefined;
    case "handle-unknown":
    case "handle-ambiguous":
    case "handle-confidential-withheld":
      return null;
    default:
      return undefined;
  }
}

/**
 * The three dimensions an author may claim, off the wire. `null` means "one of
 * them was present and unusable" — a refusal, not a silent drop, because a
 * dimension that quietly vanishes is worse than one that was never offered:
 * both leave a 0 in the row and only one of them tells anybody.
 *
 * `novelty` is deliberately not readable here. It is prediction error, computed
 * at encoding against the store's own context; an author claiming it is exactly
 * the door PR-3 closed in `remember/proposals.ts`.
 */
function readDimensions(rec: Record<string, unknown>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    const v = rec[dim];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return null;
    out[dim] = v;
  }
  return out;
}

/** The unvalidated read, used only where the refusal must be per-entry: the
 *  values ride to `remember/intake`, which refuses that entry by name. */
function pickDimensions(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    if (rec[dim] !== undefined) out[dim] = rec[dim];
  }
  return out;
}

// ── a reminder date on a tool call (2026-09-26) ─────────────────────────────

/** What `readReminder` hands back: the draft fields, and what to say about them. */
type ReminderRead =
  | {
      /** `eventDate: null` is the explicit drop (a revision's cancel); `remind`
       *  rides only when it was SENT, so a revision can tell a left-out mode
       *  from a stated one (review N7). */
      readonly fields: { eventDate?: string | null; remind?: "plain" | "quiet"; recurring?: Recurrence | null };
      /** `remind` was sent with no `eventDate`: there is nothing for it to shape
       *  — unless the memory it revises carries a date (`DepositResult.reminder`). */
      readonly remindIgnored: boolean;
      /** `recurring` was sent with no `eventDate` (2026-10-09): nothing to repeat
       *  — unless the memory it revises carries a date. */
      readonly recurringIgnored?: boolean;
    }
  | {
      readonly refused: "event-date-unreadable" | "remind-unknown" | "recurring-unknown" | "recurring-needs-day";
      readonly detail: string;
    };

const EVENT_DATE_SHAPES =
  'A day "2026-10-15", a month "2026-10", a year "2026", or a range of two days "2026-10-20..2026-10-31" (first day first). Convert "late October" or "before the 15th" into one of those yourself.';

const YEAR_ALONE_NOTE =
  "A year alone names no day, so this will not come back on its own. Give a month, a day or a range if it should.";

/** Review N8 (2026-09-26): a past date is accepted and kept, and SAID — so a
 *  wrong year can be caught by the model that wrote it. */
const DATE_PASSED_NOTE = "That date has already passed — it won't come back as a reminder.";

/**
 * `eventDate` and `remind` off a `remember` or a `session_end` entry, CHECKED
 * before anything mints: the date by `time.ts` (the one module that reads
 * dates), `remind` against its two words. Never a date parsed from prose — the
 * model writes the field (owner decision 2026-09-25/26).
 */
function readReminder(rec: Record<string, unknown>): ReminderRead {
  const rawDate = rec["eventDate"];
  const rawRemind = rec["remind"];
  const rawRule = rec["recurring"];
  if (rawRemind !== undefined && rawRemind !== null && rawRemind !== "plain" && rawRemind !== "quiet") {
    return { refused: "remind-unknown", detail: '`remind` is "plain" or "quiet".' };
  }
  // HOW OFTEN (2026-10-09): one of four words, refused by name like a date.
  if (rawRule !== undefined && rawRule !== null && !isRecurrence(rawRule)) {
    return { refused: "recurring-unknown", detail: RECURRING_WORDS };
  }
  const sent: { remind?: "plain" | "quiet"; recurring?: Recurrence | null } = {
    ...(rawRemind === "plain" || rawRemind === "quiet" ? { remind: rawRemind } : {}),
    // `null` rides as sent: a revision's "it no longer repeats".
    ...(isRecurrence(rawRule) ? { recurring: rawRule } : rawRule === null ? { recurring: null } : {}),
  };
  if (rawDate === undefined || rawDate === null) {
    return {
      fields: { ...(rawDate === null ? { eventDate: null } : {}), ...sent },
      remindIgnored: sent.remind !== undefined,
      recurringIgnored: isRecurrence(sent.recurring),
    };
  }
  const read = typeof rawDate === "string" ? parseCalendarDate(rawDate) : null;
  if (read === null) {
    return {
      refused: "event-date-unreadable",
      detail: `\`eventDate\` ${typeof rawDate === "string" ? `"${rawDate.slice(0, 64)}"` : "(not text)"} is not a date this can read. ${EVENT_DATE_SHAPES}`,
    };
  }
  if (isRecurrence(sent.recurring) && read.precision !== "day") {
    return { refused: "recurring-needs-day", detail: RECURRING_NEEDS_DAY };
  }
  return { fields: { eventDate: read.text, ...sent }, remindIgnored: false };
}

const RECURRING_WORDS =
  '`recurring` is "daily", "weekly", "monthly" or "yearly", anchored on eventDate. Every other week, "the first Monday" and the like are not kept: leave it out.';

const RECURRING_NEEDS_DAY =
  '`recurring` repeats one day, so eventDate must be a day: the first one ("1990-05-14" for a birthday, any Monday for "every Monday").';

const RECURRING_IGNORED_NOTE = "`recurring` repeats a date; with no `eventDate` there was nothing to repeat.";

const RECURRING_DROPPED_NOTE = "Not repeating any more: only a day repeats, and this date is not one, so it comes once.";

/** What to say about a recorded date: that it has already passed (its last day
 *  is before the person's today — `time.ts#todayIn` in the store's zone), or
 *  that a year alone never comes back. One note, the passed one first. */
function dateNote(eventDate: string, today: string, recurring: Recurrence | null = null): Record<string, unknown> {
  // A REPEATING date never "has passed" (2026-10-09): a birthday anchored in
  // 1990 comes round every year. Said instead: how often, and when next.
  if (recurring !== null) {
    const every = readableRecurrence(eventDate, recurring);
    const next = occurrenceOnOrAfter(eventDate, recurring, today);
    return { ...(every === "" ? {} : { every }), ...(next === null ? {} : { next: next.date }) };
  }
  const read = parseCalendarDate(eventDate);
  if (read === null) return {};
  if (read.last < today) return { note: DATE_PASSED_NOTE };
  return read.precision === "year" ? { note: YEAR_ALONE_NOTE } : {};
}

/** The reminder half of a deposit's answer: what was RECORDED — after a
 *  revision's carry-over, not merely what was sent — or why `remind` had
 *  nothing to shape. Nothing when neither field was sent or nothing minted. */
function reminderEcho(deposit: DepositResult, dated: ReminderRead, today: string): Record<string, unknown> {
  if ("refused" in dated || !deposit.deposited) return {};
  const carried = deposit.reminder;
  if (carried !== undefined) {
    const unmoved = carried.moved ? {} : { unmoved: true };
    if (carried.eventDate === null) {
      return {
        reminder: {
          cleared: true,
          from: carried.from,
          ...unmoved,
          note: "The date is dropped: neither this memory nor the one it revises will come back as a reminder.",
        },
      };
    }
    // A repeat — sent or carried — that the new date cannot take (a month or a
    // range does not repeat) is SAID, never silently lost.
    const ruleDropped = carried.recurringDropped === true;
    return {
      reminder: {
        eventDate: carried.eventDate,
        remind: carried.remind ?? "quiet",
        ...(carried.recurring === null ? {} : { recurring: carried.recurring }),
        from: carried.from,
        ...(carried.inherited.length > 0 ? { carriedOver: [...carried.inherited] } : {}),
        ...unmoved,
        ...dateNote(carried.eventDate, today, carried.recurring),
        ...(ruleDropped ? { note: RECURRING_DROPPED_NOTE } : {}),
      },
    };
  }
  const { eventDate, remind, recurring } = dated.fields;
  if (typeof eventDate === "string") {
    const rule = isRecurrence(recurring) ? recurring : null;
    return {
      reminder: {
        eventDate,
        remind: remind ?? "quiet",
        ...(rule === null ? {} : { recurring: rule }),
        ...dateNote(eventDate, today, rule),
      },
    };
  }
  // A cancel that found nothing to cancel is SAID (review of #247): silence
  // here read as success while a reminder the model meant to drop kept coming.
  if (eventDate === null && (deposit.proposal?.updates?.declared ?? null) !== null) {
    return {
      reminder: {
        cleared: false,
        note: "No date was dropped: `updates` did not reach a dated memory by its id, so nothing was cancelled.",
      },
    };
  }
  const remindNote = "`remind` shapes how a date comes back; with no `eventDate` there was nothing to shape.";
  if (dated.remindIgnored && dated.recurringIgnored === true) {
    return { reminder: { ignored: "remind, recurring", note: `${remindNote} ${RECURRING_IGNORED_NOTE}` } };
  }
  if (dated.recurringIgnored === true) return { reminder: { ignored: "recurring", note: RECURRING_IGNORED_NOTE } };
  return dated.remindIgnored ? { reminder: { ignored: "remind", note: remindNote } } : {};
}

// ── feelings on a tool call (schema v7) ─────────────────────────────────────

type FeelingsRead = { inputs: FeelingInput[] } | { refused: string };

type AboutRead = { mark: AboutMark | null } | { refused: string };

type TraitsRead = { inputs: TraitInput[] } | { refused: string };

/**
 * `traits: [{ axis, toward, strength, carried_by? }]` off a `remember` or a
 * `session_end` entry (folded into v9), read and CHECKED before anything
 * mints (`store/traits.ts#checkTraits`, pure). Absent is none; an unknown
 * axis or pole is a refusal that names the item, the reason and what is
 * allowed. Any throw is this entry's refusal, never the call's.
 */
function readTraits(raw: unknown): TraitsRead {
  try {
    if (raw === undefined || raw === null) return { inputs: [] };
    if (!Array.isArray(raw)) return { refused: "`traits` is a list of objects." };
    const inputs: TraitInput[] = [];
    for (const [i, item] of raw.entries()) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return { refused: `traits[${i}] is not an object.` };
      }
      const t = item as Record<string, unknown>;
      for (const key of ["axis", "toward"] as const) {
        if (typeof t[key] !== "string") return { refused: `traits[${i}].${key} is a word.` };
      }
      const carried = t["carried_by"];
      if (carried !== undefined && typeof carried !== "string") return { refused: `traits[${i}].carried_by is text.` };
      inputs.push({
        axis: t["axis"] as string,
        toward: t["toward"] as string,
        strength: t["strength"] as number,
        ...(carried === undefined ? {} : { carriedBy: carried }),
      });
    }
    try {
      checkTraits(inputs);
    } catch (err) {
      if (isStoreError(err, "TRAIT_INVALID")) {
        const d = (err as { detail?: Record<string, unknown> }).detail ?? {};
        const allowed = typeof d["allowed"] === "string" ? ` (one of ${d["allowed"]})` : "";
        const pole = typeof d["axisOfPole"] === "string" ? `; that word belongs to ${d["axisOfPole"]}` : "";
        return { refused: `traits[${String(d["index"])}]: ${String(d["reason"])}${allowed}${pole}.` };
      }
      throw err;
    }
    return { inputs };
  } catch (err) {
    return { refused: `traits could not be read: ${String((err as Error).message ?? err)}` };
  }
}

/** `about` on a tool call (schema v9): absent, or one of the five marks. */
/**
 * The open thread a deposit closed (`DepositResult.thread`, 2026-10-01), as a
 * result carries it: `thread: { closed: <the id it updates> }`, or the reason
 * the clear did not land. Nothing when no thread was closed.
 */
function threadOf(deposit: DepositResult): Record<string, unknown> {
  const t = deposit.thread;
  if (t === undefined) return {};
  return { thread: t.closed ? { closed: t.from } : { closed: null, from: t.from, reason: t.refused ?? "not-recorded" } };
}

/**
 * v12 (2026-10-03): THE WRITER'S THREE FIELDS off a `remember` or a
 * `session_end` entry — `occurredOn` (when it happened: read by `time.ts`,
 * the one module that reads dates), `saidBy` and `status` (against their
 * words). LOOSE FIRST: nothing here refuses the memory. What cannot be read
 * is dropped and said (`dropped`, with what to send instead); null is sent
 * as none (a revision carries nothing over for it); absent is not sent.
 * A date in the future is kept, and a note says that a date to be reminded
 * on is `eventDate`.
 */
interface FactsRead {
  readonly sent: SentFacts;
  readonly dropped: readonly { readonly field: string; readonly note: string }[];
  readonly notes: readonly string[];
}

const OCCURRED_ON_SHAPES =
  'Send it as a day "2026-09-24", a month "2026-09", a year "2026" or a range "2026-09-21..2026-09-27" — resolve "last week" or "yesterday" to one of those while you know the date.';

const OCCURRED_ON_FUTURE_NOTE =
  "occurredOn is in the future. It is kept, but it means when this happened; a date to be reminded on is eventDate.";

function readWriteFacts(rec: Record<string, unknown>, today: string): FactsRead {
  const sent: { occurredOn?: string | null; saidBy?: SaidBy | null; status?: MemoryStatus | null } = {};
  const dropped: { field: string; note: string }[] = [];
  const notes: string[] = [];
  const said = (v: unknown): string => (typeof v === "string" ? `"${v.slice(0, 64)}"` : "(not text)");
  const date = rec["occurredOn"];
  if (date === null) sent.occurredOn = null;
  else if (date !== undefined) {
    const read = parseCalendarDate(date);
    if (read === null) {
      dropped.push({ field: "occurredOn", note: `occurredOn ${said(date)} is not a date this can read, so the memory was kept without it. ${OCCURRED_ON_SHAPES}` });
    } else {
      sent.occurredOn = read.text;
      if (read.first > today) notes.push(OCCURRED_ON_FUTURE_NOTE);
    }
  }
  const by = rec["saidBy"];
  if (by === null) sent.saidBy = null;
  else if (by !== undefined) {
    const v = saidByOf(by);
    if (v === null) dropped.push({ field: "saidBy", note: `saidBy ${said(by)} is not one of ${SAID_BY.join(", ")}, so the memory was kept without it.` });
    else sent.saidBy = v;
  }
  const st = rec["status"];
  if (st === null) sent.status = null;
  else if (st !== undefined) {
    const v = statusOf(st);
    if (v === null) dropped.push({ field: "status", note: `status ${said(st)} is not one of ${STATUSES.join(", ")}, so the memory was kept without it.` });
    else sent.status = v;
  }
  return { sent, dropped, notes };
}

/** The three fields' half of a deposit's answer (v12): what was RECORDED —
 *  after a revision's carry-over — what was carried and from where, and what
 *  was dropped and why. Nothing when nothing was sent, dropped or carried. */
function factsEcho(deposit: DepositResult, read: FactsRead): Record<string, unknown> {
  const sentAny = Object.keys(read.sent).length > 0;
  if (!sentAny && read.dropped.length === 0 && deposit.facts === undefined) return {};
  const dropped = read.dropped.length === 0 ? {} : { dropped: read.dropped.map((d) => ({ field: d.field, note: d.note })) };
  if (!deposit.deposited) return { facts: { stored: false, reason: "memory-not-stored", ...dropped } };
  const f = deposit.facts;
  return {
    facts: {
      stored: true,
      ...((f?.occurredOn ?? null) === null || f === undefined ? {} : { occurredOn: f.occurredOn }),
      ...((f?.saidBy ?? null) === null || f === undefined ? {} : { saidBy: f.saidBy }),
      ...((f?.status ?? null) === null || f === undefined ? {} : { status: f.status }),
      ...(f === undefined || f.inherited.length === 0 ? {} : { carriedOver: [...f.inherited], from: f.from }),
      ...dropped,
      ...(read.notes.length === 0 ? {} : { note: read.notes.join(" ") }),
    },
  };
}

function readAbout(raw: unknown): AboutRead {
  if (raw === undefined || raw === null) return { mark: null };
  if (typeof raw !== "string" || !(ABOUT_MARKS as readonly string[]).includes(raw)) {
    return { refused: `\`about\` is one of ${ABOUT_MARKS.join(", ")}.` };
  }
  return { mark: raw as AboutMark };
}

/**
 * `feelings: [{ whose, core?, emotion, strength?, valence?, carried_by, beneath?, other_word? }]`
 * off a `remember` or a `session_end` entry, read and CHECKED before anything
 * mints (`store/feelings.ts#checkFeelings`, pure). `beneath` is another
 * feeling's index in the same list. Absent is no feelings; anything that will
 * not store is a refusal naming the item and the reason.
 */
function readFeelings(raw: unknown): FeelingsRead {
  // ANY throw is this entry's refusal, never the call's (review S2): a
  // `session_end` carries siblings that must still land.
  try {
    return readFeelingsOrThrow(raw);
  } catch (err) {
    return { refused: `feelings could not be read: ${String((err as Error).message ?? err)}` };
  }
}

function readFeelingsOrThrow(raw: unknown): FeelingsRead {
  if (raw === undefined || raw === null) return { inputs: [] };
  if (!Array.isArray(raw)) return { refused: "`feelings` is a list of objects." };
  const inputs: FeelingInput[] = [];
  for (const [i, item] of raw.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { refused: `feelings[${i}] is not an object.` };
    }
    const f = item as Record<string, unknown>;
    for (const key of ["whose", "emotion"] as const) {
      if (typeof f[key] !== "string") return { refused: `feelings[${i}].${key} is a word.` };
    }
    // v11: `core` may be left out (the word's own core), and `strength` and
    // `valence` too (the word's defaults).
    const core = f["core"];
    if (core !== undefined && core !== null && typeof core !== "string") return { refused: `feelings[${i}].core is a word.` };
    const carried = f["carried_by"];
    const other = f["other_word"];
    const valence = f["valence"];
    const strength = f["strength"];
    if (carried !== undefined && typeof carried !== "string") return { refused: `feelings[${i}].carried_by is text.` };
    if (other !== undefined && typeof other !== "string") return { refused: `feelings[${i}].other_word is a word.` };
    // AT THE DOOR, `beneath` is an INDEX into this list and nothing else (review
    // S3): an id would only be checked after the memory minted, so feelings
    // would stop being all-or-nothing with their entry.
    const beneath = f["beneath"];
    if (beneath !== undefined && beneath !== null && !(typeof beneath === "number" && Number.isInteger(beneath))) {
      return { refused: `feelings[${i}].beneath is the index of another feeling in this list.` };
    }
    inputs.push({
      whose: f["whose"] as string,
      ...(typeof core === "string" ? { core } : {}),
      emotion: f["emotion"] as string,
      ...(strength === undefined || strength === null ? {} : { strength: strength as number }),
      ...(valence === undefined || valence === null ? {} : { valence: valence as number }),
      ...(carried === undefined ? {} : { carriedBy: carried }),
      ...(other === undefined ? {} : { otherWord: other }),
      ...(beneath === undefined || beneath === null ? {} : { beneath: beneath as number }),
    });
  }
  try {
    checkFeelings(inputs);
  } catch (err) {
    if (isStoreError(err, "FEELING_INVALID")) {
      const d = (err as { detail?: Record<string, unknown> }).detail ?? {};
      const allowed = typeof d["allowed"] === "string" ? ` (one of ${d["allowed"]})` : "";
      return { refused: `feelings[${String(d["index"])}]: ${String(d["reason"])}${allowed}.` };
    }
    throw err;
  }
  return { inputs };
}

