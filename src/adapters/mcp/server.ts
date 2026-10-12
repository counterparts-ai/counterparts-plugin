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
import { MCP_OVERSIZE_EVENT, MCP_PART_EVENT, MCP_RECALL_EVENT, boundedIds } from "../../core/counterpart.js";
import { CONTRADICTION_TUNABLES, HELD_HINT, NEIGHBOURS_HINT, SLOT_HINT } from "../../core/reconsolidation.js";
import type { Neighbour } from "../../core/reconsolidation.js";
import { localDate, todayIn } from "../../core/time.js";
import type { Recurrence } from "../../core/time.js";
import type { Counterpart, DepositResult } from "../../core/counterpart.js";
import { LAST_EXCHANGE_HANDLE, lastExchangeAnswer } from "../../core/handoff/last-exchange.js";
import { loadGateState } from "../../core/recall/index.js";
import type { SemanticSource } from "../../core/recall/index.js";
import { AUTHOR_DIMENSIONS } from "../../core/remember/index.js";
import { CACHE_SCHEMA_VERSION, CORE_ABOUT_MARKS, SCHEMA_VERSION, StoreError, paths, schemaAhead } from "../../core/store/index.js";
import type { AboutMark, FeelingInput, TraitInput } from "../../core/store/index.js";
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

import { CODE_TAB_ENTRYPOINT, DEFAULT_HOST, DESKTOP_HOST, DESKTOP_SCOPE, claudeCodeEnvMarker, hostOfClient, isPseudoScope, wordingFor } from "../hosts.js";
import type { InstallRoute } from "../plugin.js";
import {
  MEET_STEPS,
  STYLE_CHOICES,
  addressMemory,
  answerText,
  finishText,
  meetState,
  meetingHold,
  meetingInstructions,
  noteActive,
  noteOffered,
  onboardingView,
  recordAnswer,
  recordState,
  recordStyle,
  recordWhere,
  styleMemories,
} from "../../core/onboarding.js";
import type { AnswerStep, MeetStep, StyleChoice } from "../../core/onboarding.js";
import type { RefusalPlace } from "../hosts.js";
import { TUNABLES as ADAPTER_TUNABLES } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { Lifecycle, plainContextLine } from "../lifecycle.js";
import type { SessionInput } from "../lifecycle.js";
import { NIGHT_CHILD_ENV, NIGHT_RUN_ENV, WORKER_RUNNER_PATH } from "../spawn.js";
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
import { TOOL_RESULT_CEILING, clipWire, lineOf, noteLookups, wireChars } from "../../core/fit/index.js";
import type { FitMechanism } from "../../core/fit/index.js";
import { WAKE_BUILD_KEY } from "../../core/self/index.js";
import type { PageWriterMode } from "../../core/self/index.js";
import { canonicalToolName, toolDefinitions, toolSpec } from "./tools.js";
import { writeUpDoor } from "./write-up.js";
import type { ToolName } from "./tools.js";
import { scriptArgs } from "../runtime.js";
import {
  OWNER_ENV_NAME,
  OWNER_FALSE_NOTE,
  SERVER_NAME,
  SERVER_VERSION,
  DESKTOP_INSTRUCTIONS,
  START_PROMPT,
  NO_DESKTOP_SESSION,
  desktopBindNote,
  desktopWriteUpAsk,
  STORE_BUSY_REFUSAL,
  schemaUnreadableRefusal,
  staleServerRefusal,
  cacheAheadRefusal,
  uninstallRouteWords,
  memoryHomeWords,
  RECALL_MODE_WORDS,
  DESKTOP_DREAM_NOTE,
} from "./server-words.js";
import { resolveScope, SEEN_SESSIONS, EVENT_RING } from "./server-options.js";
import type {
  ScopeSource,
  QuestionEmbedder,
  McpEvent,
  SchemaVerdict,
  McpServerOptions,
  ToolResult,
} from "./server-options.js";
import {
  readDimensions,
  readReminder,
  readFeelings,
  readAbout,
  readTraits,
  readWriteFacts,
  reminderEcho,
  undatedReminderWarning,
  factsEcho,
  threadOf,
  addressBlocked,
  resolvedIdOf,
} from "./server-args.js";
import type { RecallRowFields } from "./server-args.js";
import * as sessionEndPart from "./server-session-end.js";
import * as selfTools from "./server-self-tools.js";

// What moved to the server-*.ts parts, re-exported so every import of this file still resolves.
export {
  SERVER_NAME,
  SERVER_VERSION,
  staleServerRefusal,
  STALE_SERVER_REFUSAL,
  cacheAheadRefusal,
  schemaUnreadableRefusal,
  SCHEMA_UNREADABLE_REFUSAL,
  STORE_BUSY_REFUSAL,
  DESKTOP_INSTRUCTIONS,
  START_PROMPT,
  DESKTOP_DREAM_NOTE,
  uninstallRouteWords,
  memoryHomeWords,
  desktopBindNote,
  NO_DESKTOP_SESSION,
  desktopWriteUpAsk,
  OWNER_FALSE_NOTE,
  dreamHow,
  RECALL_MODE_WORDS,
} from "./server-words.js";
export { hostScope, resolveScope, SEEN_SESSIONS } from "./server-options.js";
export type {
  McpEvent,
  McpServerOptions,
  QuestionEmbedder,
  ToolResult,
  ScopeSource,
} from "./server-options.js";

/**
 * Is a stamp read off the disk AHEAD of the code? Only a plain integer above it
 * is. Absent, behind, or not a number all read as "not ahead" — today's
 * behaviour, in which an older store is the hooks' to migrate. ONE definition,
 * the store's (`core/store/cache.ts#schemaAhead`, #190), re-exported here for
 * this module's readers.
 */
export { schemaAhead } from "../../core/store/index.js";

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
  private readonly install: InstallRoute;
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
    this.install = opts.install ?? "either";
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
    // The first meeting holds the write-up ask here too (2026-10-12): never on
    // a `meet` result, nor while the meeting runs in this chat.
    const held = name === "meet" || meetingHold(this.counterpart.store, session, this.nowFn()) === "running";
    let ask = false;
    try {
      const touched = touchDesktopSession(this.registryDir, session, {
        now: this.nowFn(),
        wroteUp: writing && result.isError !== true,
        mayAsk: !writing && !held,
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
      case "meet":
        return await this.meetTool(args);
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
   * `meet` — THE FIRST MEETING (2026-10-11, `core/onboarding.ts`). No step: the
   * script and the state, and the offer is recorded (`offered`), so neither
   * the wake's line nor the mod offers it again today. With a step:
   *
   *   - an answer (name, work, loved, problem, peeves, outside) becomes ONE
   *     memory through `remember`'s own door — about the owner, said by the
   *     owner, marked "(from onboarding)" — and its id is kept for the second
   *     session's line; a skipped question is never sent, so nothing is stored;
   *   - `style` writes a fixed bundle (or the traits Claude said back, or the
   *     person's words) as preferences about the owner, each marked, each
   *     bundle ending with the honest-pushback baseline;
   *   - `address` writes the form of address as its own preference;
   *   - `where` writes the scope registry: `/` on (every folder), or `/` off
   *     and this folder on — either way no folder is `unset` any more, so the
   *     first-launch question never fires again;
   *   - `later`, `skipped`, `done` move the state.
   *
   * Nothing here writes the identity core or any entity (CONTRACT §4): a name
   * is a memory like any other answer. Under observer it reads and writes nothing.
   */
  private async meetTool(args: Record<string, unknown>): Promise<ToolResult> {
    // NOT IN THE NIGHTLY RUN (review of #419): nobody is there to meet, and a
    // read would mark an offer under the run's session. `--allowedTools`
    // already fences it out of the child; this says so by name.
    if ((this.env[NIGHT_CHILD_ENV] ?? "").trim().length > 0) {
      return this.refuse("meet", "night-run", { detail: "This is the nightly run: there is nobody here to meet." });
    }
    const store = this.counterpart.store;
    // The session the meeting holds (2026-10-12): the one it names when the
    // hooks' registry knows it, else this server's own, else the host's.
    const named = typeof args["session"] === "string" ? args["session"].trim() : "";
    const session = (named.length > 0 && this.corroborate(named) ? named : null) ?? this.session ?? this.hostSession() ?? UNBOUND_SESSION;
    const on = this.today();
    const step = args["step"];
    // EVERY CALL IS THE MEETING STILL GOING (2026-10-12, onboarding round 1, A):
    // while it is, this session's write-up ask and the day's dream wait.
    if (!this.observer && session !== UNBOUND_SESSION) {
      try {
        noteActive(store, session, this.nowFn());
      } catch {
        /* a lost mark costs the hold, never the meeting */
      }
    }
    if (step === undefined) {
      let state = meetState(store);
      if (!this.observer) {
        try {
          state = noteOffered(store, { on, session, state: true });
        } catch {
          /* a lost mark costs the throttle, never the script */
        }
      }
      const name = this.counterpart.ownerDisplayName();
      const script = meetingInstructions({
        name,
        uninstall: uninstallRouteWords(this.install, this.desktop),
        home: memoryHomeWords(this.counterpart.store.dir, this.lifecycleOpts.configPath),
        dreaming: this.counterpart.dreams.setting(),
        folders: this.meetAsksWhere(),
        plugin: this.install === "plugin" && !this.desktop,
        state,
      });
      this.emit("mcp.meet.read", undefined, { state });
      return { content: [{ type: "text", text: script }], structuredContent: { ...onboardingView(store), name, script } };
    }
    if (this.observer) return this.standDown("meet");
    if (typeof step !== "string" || !(MEET_STEPS as readonly string[]).includes(step)) {
      return this.refuse("meet", "step-unknown", { detail: `step is one of ${MEET_STEPS.join(", ")} — or omit it for the script.` });
    }
    // A step taken is an offer made: the mod and the wake stop offering.
    // An answer after a "later" is the meeting resumed: offered again, so it holds.
    const before = meetState(store);
    if (before === "not_started" || (before === "later" && step !== "later" && step !== "skipped" && step !== "done")) noteOffered(store, { on, session, state: true });
    const answer = typeof args["answer"] === "string" ? args["answer"].trim() : "";
    const done = (extra: Record<string, unknown>): ToolResult => {
      this.emit("mcp.meet.step", undefined, { step, stored: typeof extra["stored"] === "number" ? extra["stored"] : null });
      return this.result({ recorded: step, ...onboardingView(store), ...extra }, false);
    };
    switch (step as MeetStep) {
      case "later":
      case "skipped":
        recordState(store, step as "later" | "skipped", { on, session });
        return done({});
      case "done": {
        // THE FINISH STEP HANDS OVER THE WRITE-UP (2026-10-12, A): done here,
        // in the session, in place of the end-of-turn ask the meeting held —
        // so the next Stop paces that ask and does not say it (`meetingHold`).
        const writeUp = session !== UNBOUND_SESSION;
        recordState(store, "done", { on, session, writeUp });
        this.emit("mcp.meet.step", undefined, { step, stored: null });
        const view = { recorded: step, ...onboardingView(store) };
        // Unbound, the close still comes; the write-up names the id to pass.
        const next = finishText({
          name: this.counterpart.ownerDisplayName(),
          dreaming: this.counterpart.dreams.setting(),
          plugin: this.install === "plugin" && !this.desktop,
          session: writeUp ? session : "<your session id, as the wake names it>",
        });
        return { content: [{ type: "text", text: next }], structuredContent: { ...view, next } };
      }
      case "where":
        return this.meetWhere(answer, done);
      case "style": {
        const choice = (STYLE_CHOICES as readonly string[]).includes(answer) ? (answer as StyleChoice) : null;
        if (choice === null) return this.refuse("meet", "style-unknown", { detail: `answer is one of ${STYLE_CHOICES.join(", ")}.` });
        const traits = Array.isArray(args["traits"]) ? args["traits"].filter((t): t is string => typeof t === "string") : [];
        const like = typeof args["like"] === "string" ? args["like"] : "";
        const bundle = styleMemories(choice, { traits, like, name: this.counterpart.ownerDisplayName() });
        if (!bundle.ok) return this.refuse("meet", "style-incomplete", { detail: bundle.detail });
        const ids = await this.meetWrite(bundle.texts);
        recordStyle(store, choice);
        return done({ option: bundle.option, stored: ids.length, ids });
      }
      case "address": {
        const made = addressMemory(answer, this.counterpart.ownerDisplayName());
        if (!made.ok) return this.refuse("meet", "answer-required", { detail: made.detail });
        const ids = await this.meetWrite([made.text]);
        return done({ stored: ids.length, ids });
      }
      default: {
        // An answer: name, work, loved, problem, peeves, outside.
        if (answer.length === 0) {
          return this.refuse("meet", "answer-required", { detail: "Send the answer, in your words. A skipped question is never sent: nothing is stored for it." });
        }
        const text = step === "name" ? `They like to be called ${answer}.` : answer;
        const ids = await this.meetWrite([answerText(text)]);
        if (ids[0] !== undefined) recordAnswer(store, step as AnswerStep, ids[0]);
        return done({ stored: ids.length, ...(ids[0] === undefined ? {} : { id: ids[0] }) });
      }
    }
  }

  /** Each text through `remember`'s own door: about the owner, said by the owner. The ids that landed. */
  private async meetWrite(texts: readonly string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const text of texts) {
      const r = await this.rememberTool({ text, about: "owner", saidBy: "owner" });
      const id = r.structuredContent["id"];
      if (r.structuredContent["stored"] === true && typeof id === "string") ids.push(id);
    }
    return ids;
  }

  /**
   * DOES THE SCRIPT ASK WHERE MEMORY IS ON? Only where there is a folder, and
   * only while nobody has set any folder yet (review of #419). The registry
   * lives beside the configuration, not in the store: a `start-fresh` store's
   * meeting that wrote `/` off would outlive `start-fresh --undo` and turn off
   * every folder the owner had never named; and anyone who has already set a
   * folder has answered the question their own way.
   */
  private meetAsksWhere(): boolean {
    const file = this.scopesFile;
    if (file === null || isPseudoScope(this.scope)) return false;
    try {
      const read = readScopes(file);
      return read.error === null && read.refused.length === 0 && (read.registry === null || Object.keys(read.registry.scopes).length === 0);
    } catch {
      return false;
    }
  }

  /** `where`: one `/` entry (on, or off with this folder on), written as the `scope` tool writes. */
  private meetWhere(answer: string, done: (extra: Record<string, unknown>) => ToolResult): ToolResult {
    if (answer !== "every" && answer !== "this") return this.refuse("meet", "where-unknown", { detail: 'answer is "every" or "this".' });
    const file = this.scopesFile;
    if (file === null || isPseudoScope(this.scope)) {
      return this.refuse("meet", "no-folder", { detail: "There is no folder setting to write here; skip this question." });
    }
    const read = readScopes(file);
    if (read.error !== null || read.refused.length > 0) {
      return this.refuse("meet", "registry-unreadable", { registry: file, detail: "The folder setting could not be read whole, so nothing was changed. Tell the user; `counterparts scope` shows what is wrong." });
    }
    const at = new Date(this.nowFn()).toISOString();
    const apply = (from: ScopeRegistry | null): ScopeRegistry => {
      const root = setScope(from, "/", answer === "every" ? "on" : "off", { at, note: "chosen at onboarding" });
      return answer === "every" ? root : setScope(root, this.scope, "on", { at, note: "chosen at onboarding" });
    };
    try {
      writeScopes(file, apply(read.registry), { basedOn: read, reapply: apply });
    } catch (err) {
      return this.refuse("meet", "registry-unwritable", { registry: file, detail: `The folder setting could not be written (${err instanceof Error ? err.message : String(err)}). Nothing was changed.` });
    }
    recordWhere(this.counterpart.store, answer);
    return done({ scope: this.scope, registry: file });
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
    // CORE (2026-10-11, Group 3 part A): keep or retire a core memory, as me.
    // Alone, or beside anything else the call does.
    const coreArg = args["core"];
    if (coreArg !== undefined) {
      if (coreArg === null || typeof coreArg !== "object" || Array.isArray(coreArg)) {
        return this.refuse("remember", "core-malformed", { detail: 'core is one object: {id, decision: "keep" | "retire", why}.' });
      }
      const rest = { ...args };
      delete rest["core"];
      const hasRest = (typeof rest["text"] === "string" && rest["text"].trim().length > 0) || rest["settle"] !== undefined || rest["feelingsNow"] !== undefined || rest["remark"] !== undefined;
      const out = this.coreDecisionOutcome(coreArg as Record<string, unknown>);
      if (!hasRest) return this.result({ stored: false, reason: "core-only", core: out }, out["ok"] !== true);
      const done = await this.rememberTool(rest);
      const body = (done as { structuredContent?: Record<string, unknown> }).structuredContent;
      if (body === undefined) return done;
      return this.result({ ...body, core: out }, (done as { isError?: boolean }).isError === true && out["ok"] !== true);
    }
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
    const neighbours = this.neighboursOf(deposit, [], CONTRADICTION_TUNABLES.NEIGHBOURS, session);
    this.markSeen([...neighbours.map((n) => n.id), ...(deposit.slot === undefined ? [] : [deposit.slot.over])]);
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
      ...undatedReminderWarning(deposit, dated, args["title"], text),
      ...factsEcho(deposit, facts),
      ...this.settledOf(deposit, args["how"] !== undefined),
      ...threadOf(deposit),
      // IN THE PAYLOAD, so it rides in `structuredContent` — which is what
      // Claude Code hands the model (the #282 lesson, f387f55).
      ...(neighbours.length === 0 ? {} : { neighbours, neighboursHint: NEIGHBOURS_HINT }),
      ...this.slotOf(deposit),
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
        // A night run's child: held to the owner's `--reflected-feeling` switch,
        // as the reflection is. Either mark says so — the child's name, which
        // the night's MCP configuration sets on this server, or the run's id,
        // which the run's environment carries (a catch-up child has no name).
        ...((this.env[NIGHT_CHILD_ENV] ?? "").trim().length > 0 || (this.env[NIGHT_RUN_ENV] ?? "").trim().length > 0 ? { night: true } : {}),
      });
      this.emit("mcp.remember.remark", id, { ok: out.ok, reason: out.ok ? (out.changed ? "marked" : "unchanged") : out.reason });
      return { ...out };
    } catch (err) {
      return { ok: false, reason: "threw", detail: String((err as Error).message ?? err) };
    }
  }

  /**
   * One `core` decision through the core (2026-10-11, Group 3 part A): keep a
   * core memory (`Counterpart.keepCore`) or retire it (`demoteCore`), by
   * `self`, with the why. Any core memory: the owner's and my door alike, and
   * a confidential one only in the owner's session. Never throws.
   */
  private coreDecisionOutcome(arg: Record<string, unknown>): Record<string, unknown> {
    const id = typeof arg["id"] === "string" ? arg["id"].trim() : "";
    const decision = arg["decision"];
    const why = typeof arg["why"] === "string" ? arg["why"] : "";
    try {
      if (id.length === 0) return { ok: false, reason: "core-malformed", detail: 'core needs the memory\'s id: {id, decision, why}.' };
      if (decision !== "keep" && decision !== "retire") return { ok: false, reason: "core-malformed", detail: 'decision is "keep" or "retire".' };
      const row = this.counterpart.store.row(id);
      if (row === undefined || (row.confidential === 1 && !this.owner)) return { ok: false, reason: "unknown-id", detail: `No memory ${id} in this store.` };
      const out = decision === "keep" ? this.counterpart.keepCore(id, { why, actor: "self" }) : this.counterpart.demoteCore(id, { reason: why, actor: "self" });
      const detail: Record<string, string> = {
        "reason-required": "Say why: the decision is kept with its reason.",
        "not-core": `${id} is not in the core.`,
        "unknown-id": `No memory ${id} in this store.`,
        observer: "This session is an observer: nothing was changed.",
      };
      this.emit("mcp.remember.core", id, { ok: out.ok, reason: out.reason, decision });
      return out.ok
        ? { ok: true, reason: out.reason, id, note: decision === "keep" ? "Kept in the core; it is no longer being reconsidered for what it is." : "Retired: it fades like any other memory from today, and the core's lanes will not promote it again." }
        : { ok: false, reason: out.reason, detail: detail[out.reason] ?? out.reason };
    } catch (err) {
      return { ok: false, reason: "threw", detail: String((err as Error).message ?? err) };
    }
  }

  /**
   * `remember` with `settle` and no `text` (2026-09-29): settle two memories that
   * already exist — a flagged pair, or two a write showed — and write nothing
   * else. The settle is `reconsolidation.ts#settle`'s, attributed to this
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
    // A REMOVED memory named in `updates` (review of #422): said whether or not
    // a `how` was sent — the writer named one memory, and it is not there.
    if (r.reason === "target-removed") {
      return {
        settled: {
          ok: false,
          applied: false,
          path: r.path,
          reason: r.reason,
          detail: "the memory named in updates was removed, so nothing was updated; this one is stored on its own, unlinked.",
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
  private neighboursOf(
    deposit: DepositResult,
    siblings: readonly string[] = [],
    room: number = CONTRADICTION_TUNABLES.NEIGHBOURS,
    session: string | null = null,
  ): readonly Neighbour[] {
    if (!deposit.deposited || deposit.memoryId === null || room <= 0) return [];
    // Not the memory it updates, and not a sibling written by the same call
    // (review of #284, M1): those are this writer's own words, not existing ones.
    // A held one (2026-10-09) is already shown whole, beside its own ask, and
    // a slot the detector proposed (2026-10-11) beside its own.
    const exclude = [deposit.revision?.targetId, deposit.mint?.updates, deposit.held?.over, deposit.slot?.over, ...siblings].filter((x): x is string => typeof x === "string");
    return this.counterpart.writeNeighbours(deposit.memoryId, { exclude, owner: this.owner, session }).slice(0, room);
  }

  /**
   * THE SLOT THE DETECTOR PROPOSED for a write (2026-10-11, Group 2): the
   * older memory, by id and title, and the ask — settle it now or let the
   * dream. Empty when none was proposed.
   */
  private slotOf(deposit: DepositResult): Record<string, unknown> {
    const s = deposit.slot;
    if (s === undefined) return {};
    const row = this.counterpart.store.row(s.over);
    const title = row === undefined || (row.confidential === 1 && !this.owner) ? null : (row.title ?? lineOf({ body: row.body }));
    return { slot: { pair: s.pair, over: s.over, ...(title === null ? {} : { title }), rule: s.rule }, slotHint: SLOT_HINT };
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
    const lead = [lc.nowLine(), lc.onboardingMarker(input), ...told.map((r) => plainContextLine(r))].join("\n");
    // THE FIRST MEETING'S LINE (2026-10-11): the same offer, or the second
    // session's memory, a Claude Code session start carries. A tool result is
    // certain delivery, so it is committed here.
    const meet = lc.onboardingLine(input);
    meet?.commit();
    const parts = [
      head,
      `${lead}\n${woke.text}`.trimEnd(),
      ...(notices.length === 0 ? [] : [notices.join("\n")]),
      ...(dream === null ? [] : [`${dream}\n${DESKTOP_DREAM_NOTE}`]),
      ...(meet === null ? [] : [meet.text]),
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

  private sessionEndTool(args: Record<string, unknown>): Promise<ToolResult> {
    return sessionEndPart.sessionEndTool(this, args);
  }

  private depositEntries(
    raw: readonly unknown[],
    session: string,
    cover?: false | { readonly session: string },
    scope?: string,
    writeUp?: { readonly session: string; readonly happenedOn: string | null },
  ): Promise<{ outcomes: Record<string, unknown>[]; deposited: number; duplicates: number; entries: Record<string, unknown>[] }> {
    return sessionEndPart.depositEntries(this, raw, session, cover, scope, writeUp);
  }

  private writeUpField(args: Record<string, unknown>, drewOn: Record<string, unknown> | null): Promise<ToolResult> {
    return sessionEndPart.writeUpField(this, args, drewOn);
  }

  private drewOnField(raw: unknown, via: "session_end" | "chapter"): Record<string, unknown> | null {
    return sessionEndPart.drewOnField(this, raw, via);
  }

  private writeHandoffField(raw: unknown): Record<string, unknown> | null {
    return sessionEndPart.writeHandoffField(this, raw);
  }

  private unnamedHandoffField(raw: unknown): Record<string, unknown> | null {
    return sessionEndPart.unnamedHandoffField(this, raw);
  }

  private retireHandoffField(raw: unknown): Record<string, unknown>[] | null {
    return sessionEndPart.retireHandoffField(this, raw);
  }

  private chapterTool(args: Record<string, unknown>): Promise<ToolResult> {
    return sessionEndPart.chapterTool(this, args);
  }

  private dreamTool(args: Record<string, unknown>): ToolResult {
    return selfTools.dreamTool(this, args);
  }

  private reflectTool(args: Record<string, unknown>): ToolResult {
    return selfTools.reflectTool(this, args);
  }

  private selfPageTool(args: Record<string, unknown>): ToolResult {
    return selfTools.selfPageTool(this, args);
  }

  private selfPageRead(): ToolResult {
    return selfTools.selfPageRead(this);
  }

  private bindForPageWriter(claimed: unknown): string | null {
    return selfTools.bindForPageWriter(this, claimed);
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

