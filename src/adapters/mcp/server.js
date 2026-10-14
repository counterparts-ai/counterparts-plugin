import { MCP_OVERSIZE_EVENT, MCP_PART_EVENT, MCP_RECALL_EVENT, boundedIds } from "../../core/counterpart.js";
import { CONTRADICTION_TUNABLES, HELD_HINT, NEIGHBOURS_HINT, SLOT_HINT } from "../../core/reconsolidation.js";
import { localDate, todayIn } from "../../core/time.js";
import { LAST_EXCHANGE_HANDLE, lastExchangeAnswer } from "../../core/handoff/last-exchange.js";
import { loadGateState } from "../../core/recall/index.js";
import { AUTHOR_DIMENSIONS } from "../../core/remember/index.js";
import { CACHE_SCHEMA_VERSION, CORE_ABOUT_MARKS, SCHEMA_VERSION, StoreError, paths, schemaAhead } from "../../core/store/index.js";
import { isLocked } from "../../core/store/db.js";
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
  writeScopes
} from "../scopes.js";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { CODE_TAB_ENTRYPOINT, DEFAULT_HOST, DESKTOP_HOST, DESKTOP_SCOPE, claudeCodeEnvMarker, hostOfClient, isPseudoScope, wordingFor } from "../hosts.js";
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
  styleMemories
} from "../../core/onboarding.js";
import { TUNABLES as ADAPTER_TUNABLES } from "../config.js";
import { Lifecycle, plainContextLine } from "../lifecycle.js";
import { NIGHT_CHILD_ENV, NIGHT_RUN_ENV, WORKER_RUNNER_PATH } from "../spawn.js";
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
  versionNewer
} from "../sessions.js";
import {
  JOURNAL_GLOSS,
  RECALL_BODY_CHARS,
  RECALL_MAX_IDS,
  RECALL_ID_RESULT_CHARS,
  boundById,
  deliberateRecall,
  embedQuestion
} from "./deliberate.js";
import { factsRecall, renderFacts } from "./facts.js";
import { meaningRecall, renderMeaning } from "./meaning.js";
import {
  ERROR_CODES,
  failure,
  negotiateVersion,
  success
} from "./protocol.js";
import { TOOL_RESULT_CEILING, clipWire, lineOf, noteLookups, wireChars } from "../../core/fit/index.js";
import { WAKE_BUILD_KEY } from "../../core/self/index.js";
import { canonicalToolName, toolDefinitions, toolSpec } from "./tools.js";
import { writeUpDoor } from "./write-up.js";
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
  DESKTOP_DREAM_NOTE
} from "./server-words.js";
import { resolveScope, SEEN_SESSIONS, EVENT_RING } from "./server-options.js";
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
  resolvedIdOf
} from "./server-args.js";
import * as sessionEndPart from "./server-session-end.js";
import * as selfTools from "./server-self-tools.js";
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
  RECALL_MODE_WORDS
} from "./server-words.js";
export { hostScope, resolveScope, SEEN_SESSIONS } from "./server-options.js";
export { schemaAhead } from "../../core/store/index.js";

export class McpServer {
  counterpart;
  launchedSession;
  placeScope;
  scopeSource;
  ownerClaimed;
  ownerFrom;
  codeTabOwner;
  storeObserver;
  launchObserver;
  callObserver = null;
  host;
  clientName = null;
  embedderGiven;
  registryDir;
  scopesFile;
  scopeCommandCtx;
  install;
  sessionTtlMs;
  resultCeilingChars;
  onEvent;
  nowFn;
  ring = [];
  seenBySession = new Map;
  initialized = false;
  lazySession = null;
  identity = null;
  heartbeat = null;
  launchOff = false;
  writeTripped = null;
  partHanded = null;
  callSession = null;
  callBoundBy = null;
  callRefusal = null;
  callAs = null;
  lifecycleOpts;
  lifecycleInst = null;
  wakeNotice;
  manifestVersion;
  env;
  constructor(opts) {
    this.counterpart = opts.counterpart;
    this.launchedSession = opts.session !== undefined && opts.session.length > 0 ? opts.session : null;
    const scope = resolveScope(opts.scope, opts.counterpart.store.dir);
    this.placeScope = scope.scope;
    this.scopeSource = scope.source;
    this.registryDir = opts.registryDir ?? opts.counterpart.store.dir;
    this.scopesFile = opts.scopesFile !== undefined && opts.scopesFile.length > 0 ? opts.scopesFile : null;
    this.scopeCommandCtx = opts.scopeCommand;
    this.install = opts.install ?? "either";
    this.sessionTtlMs = opts.sessionTtlMs ?? SESSION_TTL_MS;
    this.resultCeilingChars = opts.resultCeilingChars ?? TOOL_RESULT_CEILING.CHARS;
    this.host = opts.host ?? DEFAULT_HOST;
    this.lifecycleOpts = opts.lifecycle ?? {};
    this.wakeNotice = opts.wakeNotice;
    this.manifestVersion = opts.manifestVersion ?? manifestVersionOnDisk;
    this.env = opts.env ?? process.env;
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
    this.nowFn = opts.now ?? (() => Date.now());
    this.emit("mcp.scope", undefined, {
      scope: this.scope,
      source: this.scopeSource,
      boundSession: this.launchedSession !== null
    });
    this.counterpart.store.guardWrites((site) => this.writeGuard(site));
  }
  get scope() {
    return this.callAs?.scope ?? this.placeScope;
  }
  set scope(value) {
    this.placeScope = value;
  }
  get session() {
    return this.launchedSession ?? (this.desktop ? this.callAs?.session ?? this.callSession : this.lazySession);
  }
  get placeHost() {
    return this.callAs !== null ? DEFAULT_HOST : this.host;
  }
  isWriteUpRunner(claimed) {
    const ids = [this.session, typeof claimed === "string" ? claimed : null].filter((x) => x !== null && x.length > 0);
    for (const id of ids) {
      if (id.startsWith(NIGHT_RUNNER_PREFIX))
        return true;
      try {
        if ((readSession(this.registryDir, id)?.mayWriteUp?.length ?? 0) > 0)
          return true;
      } catch {}
    }
    return false;
  }
  get observer() {
    if (this.storeObserver)
      return true;
    if (this.desktop)
      return this.callObserver ?? stanceOfMode(this.scopeVerdict().mode) === "observer";
    return this.launchObserver;
  }
  get owner() {
    return (this.ownerClaimed || this.callAs !== null && this.codeTabOwner) && !this.observer;
  }
  ownerStance() {
    const from = this.callAs !== null && this.codeTabOwner && !this.ownerClaimed ? "a Claude Code session from Desktop's Code tab, which the installed configuration (owner: true) makes the owner's" : this.ownerFrom === "config" ? "the installed configuration (owner: true): this is your own Claude Code session" : this.ownerFrom === "env" ? `--owner or ${OWNER_ENV_NAME}, set on this launch` : this.ownerFrom === "off" ? `${OWNER_ENV_NAME} on this launch says not the owner's (0, off or false, or a value it could not read): the opt-out` : "nothing made this launch the owner's";
    return { owner: this.owner, ownerFrom: from, ...this.owner ? {} : { ownerMeans: OWNER_FALSE_NOTE } };
  }
  get embedder() {
    return this.observer ? null : this.embedderGiven;
  }
  get desktop() {
    return this.host === DESKTOP_HOST;
  }
  becomeDesktop(client) {
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
    if (!wasDesktop)
      this.emit("mcp.host", undefined, { host: this.host, client, scope: this.scope });
  }
  events(name) {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }
  async handle(request) {
    const id = request.id;
    const params = request.params ?? {};
    switch (request.method) {
      case "initialize": {
        if (id === undefined)
          return null;
        this.initialized = true;
        const version = negotiateVersion(params["protocolVersion"]);
        const clientInfo = params["clientInfo"];
        const clientName = clientInfo !== null && typeof clientInfo === "object" && !Array.isArray(clientInfo) ? clientInfo["name"] : undefined;
        this.clientName = typeof clientName === "string" ? clientName.slice(0, 128) : null;
        if (hostOfClient(clientName) === DESKTOP_HOST) {
          const marker = claudeCodeEnvMarker(this.env);
          if (marker === null)
            this.becomeDesktop(this.clientName ?? "");
          else
            this.emit("mcp.host.kept", undefined, { client: this.clientName, host: this.host, marker });
        }
        this.emit("mcp.initialize", undefined, {
          protocolVersion: version,
          observer: this.observer,
          owner: this.owner,
          boundSession: this.session !== null,
          ...this.desktop ? { host: this.host } : {}
        });
        return success(id, {
          protocolVersion: version,
          capabilities: this.desktop ? { tools: { listChanged: false }, prompts: { listChanged: false } } : { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          ...this.desktop ? { instructions: DESKTOP_INSTRUCTIONS } : {}
        });
      }
      case "notifications/initialized":
      case "initialized":
        this.initialized = true;
        return null;
      case "ping":
        return id === undefined ? null : success(id, {});
      case "tools/list": {
        if (id === undefined)
          return null;
        const tools = toolDefinitions(this.desktop);
        this.emit("mcp.tools.list", undefined, { tools: tools.length });
        return success(id, { tools });
      }
      case "prompts/list": {
        if (id === undefined)
          return null;
        if (!this.desktop)
          return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `unknown method: ${request.method}`);
        return success(id, {
          prompts: [{ name: START_PROMPT.name, title: START_PROMPT.title, description: START_PROMPT.description, arguments: [] }]
        });
      }
      case "prompts/get": {
        if (id === undefined)
          return null;
        if (!this.desktop)
          return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `unknown method: ${request.method}`);
        if (params["name"] !== START_PROMPT.name) {
          return failure(id, ERROR_CODES.INVALID_PARAMS, `unknown prompt: ${String(params["name"])}`);
        }
        this.emit("mcp.prompt", undefined, { name: START_PROMPT.name });
        return success(id, {
          description: START_PROMPT.description,
          messages: [{ role: "user", content: { type: "text", text: START_PROMPT.text } }]
        });
      }
      case "tools/call": {
        if (id === undefined)
          return null;
        return this.callFromParams(id, params);
      }
      default:
        if (id === undefined)
          return null;
        return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `unknown method: ${request.method}`);
    }
  }
  async callFromParams(id, params) {
    const name = params["name"];
    if (typeof name !== "string") {
      return failure(id, ERROR_CODES.INVALID_PARAMS, "tools/call requires a string name");
    }
    if (toolSpec(name, this.desktop) === undefined) {
      return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `unknown tool: ${name}`);
    }
    const args = params["arguments"];
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
      return failure(id, ERROR_CODES.INVALID_PARAMS, "arguments must be an object");
    }
    const result = await this.call(name, args ?? {});
    return success(id, result);
  }
  async call(asked, args) {
    const name = canonicalToolName(asked);
    if (name !== asked)
      this.emit("mcp.tool.alias", undefined, { asked, served: name });
    const stale = this.schemaGate(name);
    if (stale !== null)
      return stale;
    this.writeTripped = null;
    this.partHanded = null;
    this.callAs = this.desktop && name !== "wake" ? this.claudeCodeSessionNamed(args) : null;
    const place = this.desktop ? stanceOfMode(this.scopeVerdict().mode) : null;
    this.callObserver = place === null ? null : place === "observer";
    if (this.callAs !== null)
      this.emit("mcp.session.served", this.callAs.session, { tool: name, host: DEFAULT_HOST });
    const desktopCall = this.desktop && this.callAs === null && name !== "wake" && !this.observer && place !== "off";
    if (desktopCall)
      this.bindDesktopCall(args);
    let result = null;
    try {
      try {
        result = await this.dispatch(name, args);
      } catch (err) {
        if (this.writeTripped === null)
          throw err;
      }
      const tripped = this.writeTripped;
      this.writeTripped = null;
      if (tripped !== null)
        return this.refusalFor(name, tripped, "write");
      const served = desktopCall ? this.afterDesktopCall(name, result) : result;
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
  claudeCodeSessionNamed(args) {
    const claimed = args["session"];
    if (typeof claimed !== "string" || !isSessionId(claimed))
      return null;
    if (claimed.startsWith(NIGHT_RUNNER_PREFIX))
      return null;
    const record = readSession(this.registryDir, claimed);
    if (record === null || hostOf(record) !== DEFAULT_HOST)
      return null;
    if ((record.mayWriteUp?.length ?? 0) > 0)
      return null;
    if (record.entrypoint !== CODE_TAB_ENTRYPOINT)
      return null;
    if (!isLive(record, this.nowFn(), this.sessionTtlMs))
      return null;
    if (record.scope.length === 0)
      return null;
    return { session: claimed, scope: record.scope };
  }
  bindDesktopCall(args) {
    const now = this.nowFn();
    const claimed = args["session"];
    if (typeof claimed === "string" && claimed.length > 0) {
      const record = isSessionId(claimed) ? readSession(this.registryDir, claimed) : null;
      if (record !== null && hostOf(record) === DEFAULT_HOST && record.entrypoint !== CODE_TAB_ENTRYPOINT) {
        this.callRefusal = {
          reason: "session-not-code-tab",
          detail: "That is a Claude Code session outside Desktop's Code tab. It has its own counterparts server; this one is Claude Desktop's, and serves a Claude Code session only from the Code tab."
        };
        return;
      }
      if (record !== null && hostOf(record) === DEFAULT_HOST) {
        this.callRefusal = {
          reason: "session-not-live",
          detail: "That Claude Code session has ended or has been silent too long to still be writing its own day. Its memories belong to the sweep now."
        };
        return;
      }
      if (record === null || hostOf(record) !== DESKTOP_HOST) {
        this.callRefusal = {
          reason: "session-unknown",
          detail: "No session by that id is recorded — not a Claude Desktop chat's, and not a Claude Code session's. In a Desktop chat, use the id `wake` returned for this chat, exactly, or call `wake` to start one; in a Claude Code session, use the id your wake or Stop ask names."
        };
        return;
      }
      if (!isLive(record, now, this.sessionTtlMs)) {
        this.callRefusal = {
          reason: "session-not-live",
          detail: "That session has been quiet too long to still be this chat's. Call `wake` for a fresh session id, and use that one."
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
        detail: NO_DESKTOP_SESSION
      };
      return;
    }
    this.callSession = latest.sessionId;
    this.callBoundBy = "most-recent";
  }
  afterDesktopCall(name, result) {
    const session = this.callSession;
    if (session === null)
      return this.withUnboundReason(result);
    const writing = name === "session_end" || name === "chapter";
    const held = name === "meet" || meetingHold(this.counterpart.store, session, this.nowFn()) === "running";
    let ask = false;
    try {
      const touched = touchDesktopSession(this.registryDir, session, {
        now: this.nowFn(),
        wroteUp: writing && result.isError !== true,
        mayAsk: !writing && !held,
        named: this.callBoundBy === "named",
        askCalls: ADAPTER_TUNABLES.DESKTOP_ASK_CALLS,
        askAfterMs: ADAPTER_TUNABLES.DESKTOP_ASK_AFTER_MS
      });
      ask = touched?.ask === true;
      this.emit("mcp.desktop.call", session, {
        tool: name,
        boundBy: this.callBoundBy,
        refreshed: touched !== null && this.callBoundBy === "named",
        calls: touched?.desk.calls ?? null,
        ask
      });
    } catch {}
    const extra = {};
    if (this.callBoundBy === "most-recent") {
      extra["boundTo"] = session;
      extra["boundBy"] = "most-recent";
      extra["bindNote"] = desktopBindNote(session);
    }
    if (ask)
      extra["writeUpAsk"] = desktopWriteUpAsk(session);
    if (Object.keys(extra).length === 0)
      return result;
    return this.result({ ...result.structuredContent, ...extra }, result.isError === true);
  }
  withUnboundReason(result) {
    const why = this.callRefusal;
    if (why === null || result.structuredContent["reason"] === why.reason)
      return result;
    return this.result({
      ...result.structuredContent,
      sessionRefused: why.reason,
      sessionNote: `${why.detail} So this call ran with no session, under Claude Desktop's place (claude-desktop:).`
    }, result.isError === true);
  }
  lifecycle() {
    if (this.lifecycleInst !== null)
      return this.lifecycleInst;
    const o = this.lifecycleOpts;
    const config = { ...o.config ?? {}, dataDir: o.config?.dataDir ?? this.counterpart.store.dir };
    this.lifecycleInst = new Lifecycle({
      counterpart: this.counterpart,
      config,
      host: DESKTOP_HOST,
      command: o.command ?? process.execPath,
      args: o.args ?? scriptArgs(WORKER_RUNNER_PATH, o.command ?? process.execPath),
      ...o.spawner === undefined ? {} : { spawner: o.spawner },
      ...o.configPath === undefined ? {} : { configPath: o.configPath },
      scope: this.scopeVerdict(),
      now: this.nowFn,
      onEvent: (e) => this.emit(e.name, undefined, e.data)
    });
    return this.lifecycleInst;
  }
  async dispatch(name, args) {
    if (name !== "scope") {
      const verdict = this.scopeVerdict();
      if (stanceOfMode(verdict.mode) === "off")
        return this.refuseScopeOff(name, verdict);
    }
    if (this.isWriteUpRunner(args["session"]) && !(name === "session_end" && typeof args["writeUp"] === "string" && args["writeUp"].length > 0) && name !== "recall" && name !== "status") {
      return this.refuse(name, "write-up-runner", {
        detail: "This session was started to write up other sessions, and does only that: call session_end with writeUp. It writes no memories, chapters or handoffs of its own."
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
        return this.desktop ? this.wakeTool() : this.refuse(name, "unknown-tool", { tool: name });
      case "reflect":
        return this.reflectTool(args);
      case "meet":
        return await this.meetTool(args);
      default:
        return this.refuse(name, "unknown-tool", { tool: name });
    }
  }
  schemaGate(tool) {
    const verdict = this.schemaVerdict();
    return verdict.kind === "ok" ? null : this.refusalFor(tool, verdict, "entry");
  }
  schemaVerdict() {
    let found;
    try {
      found = this.counterpart.store.schemaVersions();
    } catch (err) {
      return { kind: isLocked(err) ? "busy" : "unreadable" };
    }
    const storeAhead = schemaAhead(found.store, SCHEMA_VERSION);
    const cacheAhead = schemaAhead(found.cache, CACHE_SCHEMA_VERSION);
    if (!storeAhead && !cacheAhead)
      return { kind: "ok" };
    return { kind: "ahead", store: found.store, cache: found.cache, storeAhead, cacheAhead };
  }
  writeGuard(site) {
    const verdict = this.schemaVerdict();
    if (verdict.kind === "ok")
      return;
    this.writeTripped = verdict;
    throw new StoreError("SCHEMA_AHEAD", { site, refusedBy: "mcp-write-guard", verdict: verdict.kind });
  }
  refusalFor(tool, verdict, at) {
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
      cacheExpected: CACHE_SCHEMA_VERSION
    });
    return this.refuse(tool, "schema-ahead", {
      detail: verdict.storeAhead ? staleServerRefusal(this.host) : cacheAheadRefusal(paths.cache(this.counterpart.store.dir), this.host),
      store: { expected: SCHEMA_VERSION, found: verdict.store, ahead: verdict.storeAhead },
      cache: { expected: CACHE_SCHEMA_VERSION, found: verdict.cache, ahead: verdict.cacheAhead }
    });
  }
  recordLaunch(opts = {}) {
    if (this.observer)
      return null;
    this.identity = {
      pid: opts.pid ?? process.pid,
      hostPid: opts.hostPid ?? process.ppid,
      scope: canonicalScope(this.placeScope),
      startedAt: this.nowFn(),
      build: installedBuild()
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
      ...record === null ? { reason: this.launchOff ? "scope-off" : "not-written" } : {},
      version: this.identity.build.version,
      storeSchema: SCHEMA_VERSION,
      cacheSchema: CACHE_SCHEMA_VERSION
    });
    return record;
  }
  beat(first) {
    const identity = this.identity;
    if (identity === null)
      return null;
    try {
      const off = stanceOfMode(this.scopeVerdict(this.placeScope).mode) === "off";
      if (off) {
        if (!this.launchOff || first)
          forgetServerLaunch(this.registryDir, identity.pid);
        if (!this.launchOff && !first)
          this.emit("mcp.launch.scope", undefined, { recorded: false });
        this.launchOff = true;
        return null;
      }
      const wasOff = this.launchOff;
      this.launchOff = false;
      const written = first ? recordServerLaunch(this.registryDir, {
        scope: identity.scope,
        build: identity.build,
        pid: identity.pid,
        hostPid: identity.hostPid,
        at: identity.startedAt
      }) : refreshServerLaunch(this.registryDir, identity) ? identity : null;
      if (wasOff && !first)
        this.emit("mcp.launch.scope", undefined, { recorded: written !== null });
      return written;
    } catch {
      return null;
    }
  }
  forgetLaunch() {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.identity === null)
      return;
    forgetServerLaunch(this.registryDir, this.identity.pid);
    this.identity = null;
  }
  scopeVerdict(scope = this.scope) {
    if (this.scopesFile === null)
      return { mode: "unset", matched: null, entry: null };
    return lookupScope(readScopes(this.scopesFile).registry, scope);
  }
  refuseScopeOff(tool, verdict) {
    this.emit("mcp.scope.off", undefined, { tool, matched: verdict.matched, mode: verdict.mode });
    const words = wordingFor(this.placeHost);
    return this.refuse(tool, "scope-off", {
      scope: this.scope,
      ...verdict.matched === null ? {} : { setBy: verdict.matched },
      detail: (verdict.mode === "paused" ? words.pausedRefusal : words.offRefusal)(this.refusalPlace(verdict))
    });
  }
  refusalPlace(verdict) {
    const ctx = this.scopeCommandCtx ?? scopeCommandContext({ configPath: this.lifecycleOpts.configPath, pluginRoot: null, home: homedir() });
    const here = canonicalScopePath(this.scope);
    const entry = verdict.matched === null ? here : canonicalScopePath(verdict.matched);
    return {
      here: shortPath(here, ctx.home),
      inherited: entry === here ? null : shortPath(entry, ctx.home),
      entryCommand: (flag) => scopeCommand(entry, flag, ctx),
      hereCommand: (flag) => scopeCommand(here, flag, ctx)
    };
  }
  scopeTool(args) {
    const mode = args["mode"];
    const file = this.scopesFile;
    const verdict = this.scopeVerdict();
    const read = file === null ? null : readScopes(file);
    if (mode === undefined) {
      this.emit("mcp.scope.read", undefined, { mode: verdict.mode, matched: verdict.matched });
      return this.result({
        scope: this.scope,
        mode: verdict.mode,
        stance: stanceOfMode(verdict.mode),
        ...verdict.matched === null ? {} : { setBy: verdict.matched },
        ...verdict.entry?.since === undefined ? {} : { since: verdict.entry.since },
        ...verdict.entry?.note === undefined ? {} : { note: verdict.entry.note },
        ...verdict.mode === "paused" ? { resumesTo: resumeTarget(verdict.entry) } : {},
        ...file === null ? {} : { registry: file },
        ...read === null || read.error === null ? {} : { registryError: read.error },
        ...read === null || read.refused.length === 0 ? {} : { registryRefused: read.refused.map((r) => `${r.key} (${r.detail})`) },
        detail: verdict.mode === "unset" ? "Nothing is set for this directory or any parent, so it is on by default. Ask the user before setting it." : "This is what the host's scope registry says about this directory."
      }, false);
    }
    if (typeof mode !== "string" || !["on", "observer", "off", "pause", "resume"].includes(mode)) {
      return this.refuse("scope", "mode-unusable", {
        detail: "`mode` takes on, observer, off, pause or resume — or omit it to read the setting."
      });
    }
    if (this.desktop && this.callAs === null ? this.storeObserver : this.observer)
      return this.standDown("scope");
    if (file === null) {
      return this.refuse("scope", "no-registry", {
        detail: "This server was launched without a scope registry to write, so it can only read. Use `counterparts scope <path> --on|--observer|--off` instead."
      });
    }
    if (read !== null && read.error !== null) {
      return this.refuse("scope", "registry-unreadable", {
        registry: file,
        detail: `The registry could not be read — ${read.error}. Nothing was changed; a person has to fix it (\`counterparts scope <path> --off --force\` replaces it).`
      });
    }
    if (read !== null && read.refused.length > 0) {
      return this.refuse("scope", "registry-partly-unreadable", {
        registry: file,
        refused: read.refused.map((r) => `${r.key} (${r.detail})`),
        detail: `${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in this registry could not be read, and every write rewrites the whole file — so writing here would drop ${read.refused.length === 1 ? "it" : "them"}. Nothing was changed. Tell the user; fixing the file, or \`counterparts scope <path> --<mode> --force\`, is a person's call.`
      });
    }
    let target;
    if (mode === "resume") {
      const own = ownEntry(read?.registry ?? null, this.scope);
      if (own === null) {
        return this.refuse("scope", "nothing-to-resume", {
          detail: verdict.entry === null ? "Nothing is set for this directory, so it is already on." : `Nothing is set for this directory itself — it inherits ${verdict.matched ?? "?"}. Set this one directly instead.`
        });
      }
      target = resumeTarget(own);
    } else {
      target = mode === "pause" ? "paused" : mode;
    }
    const apply = (from) => setScope(from, this.scope, target, {
      at: new Date(this.nowFn()).toISOString(),
      ...typeof args["note"] === "string" ? { note: args["note"] } : {}
    });
    const next = apply(read?.registry ?? null);
    try {
      if (read === null)
        writeScopes(file, next);
      else
        writeScopes(file, next, { basedOn: read, reapply: apply });
    } catch (err) {
      return this.refuse("scope", "registry-unwritable", {
        registry: file,
        detail: `The registry could not be written (${err instanceof Error ? err.message : String(err)}). Nothing was changed.`
      });
    }
    this.emit("mcp.scope.set", undefined, { mode: target, scope: this.scope });
    return this.result({
      set: true,
      scope: this.scope,
      mode: target,
      stance: stanceOfMode(target),
      registry: file,
      detail: target === "off" || target === "paused" ? wordingFor(this.placeHost).scopeOff : wordingFor(this.placeHost).scopeOn
    }, false);
  }
  async meetTool(args) {
    if ((this.env[NIGHT_CHILD_ENV] ?? "").trim().length > 0) {
      return this.refuse("meet", "night-run", { detail: "This is the nightly run: there is nobody here to meet." });
    }
    const store = this.counterpart.store;
    const named = typeof args["session"] === "string" ? args["session"].trim() : "";
    const session = (named.length > 0 && this.corroborate(named) ? named : null) ?? this.session ?? this.hostSession() ?? UNBOUND_SESSION;
    const on = this.today();
    const step = args["step"];
    if (!this.observer && session !== UNBOUND_SESSION) {
      try {
        noteActive(store, session, this.nowFn());
      } catch {}
    }
    if (step === undefined) {
      let state = meetState(store);
      if (!this.observer) {
        try {
          state = noteOffered(store, { on, session, state: true });
        } catch {}
      }
      const name = this.counterpart.ownerDisplayName();
      const script = meetingInstructions({
        name,
        uninstall: uninstallRouteWords(this.install, this.desktop),
        home: memoryHomeWords(this.counterpart.store.dir, this.lifecycleOpts.configPath),
        dreaming: this.counterpart.dreams.setting(),
        folders: this.meetAsksWhere(),
        plugin: this.install === "plugin" && !this.desktop,
        state
      });
      this.emit("mcp.meet.read", undefined, { state });
      return { content: [{ type: "text", text: script }], structuredContent: { ...onboardingView(store), name, script } };
    }
    if (this.observer)
      return this.standDown("meet");
    if (typeof step !== "string" || !MEET_STEPS.includes(step)) {
      return this.refuse("meet", "step-unknown", { detail: `step is one of ${MEET_STEPS.join(", ")} — or omit it for the script.` });
    }
    const before = meetState(store);
    if (before === "not_started" || before === "later" && step !== "later" && step !== "skipped" && step !== "done")
      noteOffered(store, { on, session, state: true });
    const answer = typeof args["answer"] === "string" ? args["answer"].trim() : "";
    const done = (extra) => {
      this.emit("mcp.meet.step", undefined, { step, stored: typeof extra["stored"] === "number" ? extra["stored"] : null });
      return this.result({ recorded: step, ...onboardingView(store), ...extra }, false);
    };
    switch (step) {
      case "later":
      case "skipped":
        recordState(store, step, { on, session });
        return done({});
      case "done": {
        const writeUp = session !== UNBOUND_SESSION;
        recordState(store, "done", { on, session, writeUp });
        this.emit("mcp.meet.step", undefined, { step, stored: null });
        const view = { recorded: step, ...onboardingView(store) };
        const next = finishText({
          name: this.counterpart.ownerDisplayName(),
          dreaming: this.counterpart.dreams.setting(),
          plugin: this.install === "plugin" && !this.desktop,
          session: writeUp ? session : "<your session id, as the wake names it>"
        });
        return { content: [{ type: "text", text: next }], structuredContent: { ...view, next } };
      }
      case "where":
        return this.meetWhere(answer, done);
      case "style": {
        const choice = STYLE_CHOICES.includes(answer) ? answer : null;
        if (choice === null)
          return this.refuse("meet", "style-unknown", { detail: `answer is one of ${STYLE_CHOICES.join(", ")}.` });
        const traits = Array.isArray(args["traits"]) ? args["traits"].filter((t) => typeof t === "string") : [];
        const like = typeof args["like"] === "string" ? args["like"] : "";
        const bundle = styleMemories(choice, { traits, like, name: this.counterpart.ownerDisplayName() });
        if (!bundle.ok)
          return this.refuse("meet", "style-incomplete", { detail: bundle.detail });
        const ids = await this.meetWrite(bundle.texts);
        recordStyle(store, choice);
        return done({ option: bundle.option, stored: ids.length, ids });
      }
      case "address": {
        const made = addressMemory(answer, this.counterpart.ownerDisplayName());
        if (!made.ok)
          return this.refuse("meet", "answer-required", { detail: made.detail });
        const ids = await this.meetWrite([made.text]);
        return done({ stored: ids.length, ids });
      }
      default: {
        if (answer.length === 0) {
          return this.refuse("meet", "answer-required", { detail: "Send the answer, in your words. A skipped question is never sent: nothing is stored for it." });
        }
        const text = step === "name" ? `They like to be called ${answer}.` : answer;
        const ids = await this.meetWrite([answerText(text)]);
        if (ids[0] !== undefined)
          recordAnswer(store, step, ids[0]);
        return done({ stored: ids.length, ...ids[0] === undefined ? {} : { id: ids[0] } });
      }
    }
  }
  async meetWrite(texts) {
    const ids = [];
    for (const text of texts) {
      const r = await this.rememberTool({ text, about: "owner", saidBy: "owner" });
      const id = r.structuredContent["id"];
      if (r.structuredContent["stored"] === true && typeof id === "string")
        ids.push(id);
    }
    return ids;
  }
  meetAsksWhere() {
    const file = this.scopesFile;
    if (file === null || isPseudoScope(this.scope))
      return false;
    try {
      const read = readScopes(file);
      return read.error === null && read.refused.length === 0 && (read.registry === null || Object.keys(read.registry.scopes).length === 0);
    } catch {
      return false;
    }
  }
  meetWhere(answer, done) {
    if (answer !== "every" && answer !== "this")
      return this.refuse("meet", "where-unknown", { detail: 'answer is "every" or "this".' });
    const file = this.scopesFile;
    if (file === null || isPseudoScope(this.scope)) {
      return this.refuse("meet", "no-folder", { detail: "There is no folder setting to write here; skip this question." });
    }
    const read = readScopes(file);
    if (read.error !== null || read.refused.length > 0) {
      return this.refuse("meet", "registry-unreadable", { registry: file, detail: "The folder setting could not be read whole, so nothing was changed. Tell the user; `counterparts scope` shows what is wrong." });
    }
    const at = new Date(this.nowFn()).toISOString();
    const apply = (from) => {
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
  async rememberTool(args) {
    if (this.observer)
      return this.standDown("remember");
    const coreArg = args["core"];
    if (coreArg !== undefined) {
      if (coreArg === null || typeof coreArg !== "object" || Array.isArray(coreArg)) {
        return this.refuse("remember", "core-malformed", { detail: 'core is one object: {id, decision: "keep" | "retire", why}.' });
      }
      const rest = { ...args };
      delete rest["core"];
      const hasRest = typeof rest["text"] === "string" && rest["text"].trim().length > 0 || rest["settle"] !== undefined || rest["feelingsNow"] !== undefined || rest["remark"] !== undefined;
      const out = this.coreDecisionOutcome(coreArg);
      if (!hasRest)
        return this.result({ stored: false, reason: "core-only", core: out }, out["ok"] !== true);
      const done = await this.rememberTool(rest);
      const body = done.structuredContent;
      if (body === undefined)
        return done;
      return this.result({ ...body, core: out }, done.isError === true && out["ok"] !== true);
    }
    const remarkArg = args["remark"];
    if (remarkArg === undefined)
      return this.rememberCore(args);
    if (remarkArg === null || typeof remarkArg !== "object" || Array.isArray(remarkArg)) {
      return this.refuse("remember", "remark-malformed", { detail: "remark is one object: {id, about, why}." });
    }
    const hasText = typeof args["text"] === "string" && args["text"].trim().length > 0;
    if (!hasText && args["settle"] === undefined && args["feelingsNow"] === undefined) {
      const out = this.remarkOutcome(remarkArg);
      return this.result({ stored: false, reason: "remark-only", remark: out }, out["ok"] !== true);
    }
    const done = await this.rememberCore(args);
    const body = done.structuredContent;
    if (body === undefined)
      return done;
    const out = this.remarkOutcome(remarkArg);
    return this.result({ ...body, remark: out }, done.isError === true && out["ok"] !== true);
  }
  async rememberCore(args) {
    if (this.observer)
      return this.standDown("remember");
    const text = args["text"];
    const settleArg = args["settle"];
    if (settleArg !== undefined && (settleArg === null || typeof settleArg !== "object" || Array.isArray(settleArg))) {
      return this.refuse("remember", "settle-malformed", {
        detail: "settle is an object: {pair} or {holds, over}, with how (changed, corrected or open) and a short why."
      });
    }
    const hasText = typeof text === "string" && text.trim().length > 0;
    const nowArg = args["feelingsNow"];
    if (nowArg !== undefined && !Array.isArray(nowArg)) {
      return this.refuse("remember", "feelings-now-malformed", {
        detail: "feelingsNow is a list: one object each, {id, emotion, core?, strength?, carried_by?, whose?}."
      });
    }
    if (!hasText && settleArg === undefined && nowArg !== undefined)
      return this.feelingsNowOnly(nowArg);
    if (!hasText && settleArg !== undefined) {
      const settled = this.settleOnly(settleArg);
      return nowArg === undefined ? settled : this.withFeelingsNow(settled, nowArg);
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
        detail: "relevance, emotional and predictive are each a number from 0 to 1."
      });
    }
    const dated = readReminder(args);
    if ("refused" in dated)
      return this.refuse("remember", dated.refused, { detail: dated.detail });
    const session = this.session ?? this.hostSession() ?? UNBOUND_SESSION;
    const captured = this.counterpart.captureJot({ session, scope: this.scope, text });
    const ownSpanHash = captured.spans[0]?.hash ?? null;
    const draft = { content: text };
    if (typeof args["kind"] === "string")
      draft["kind"] = args["kind"];
    if (typeof args["title"] === "string")
      draft["title"] = args["title"];
    if (typeof args["updates"] === "string")
      draft["updates"] = args["updates"];
    if (args["how"] !== undefined)
      draft["how"] = args["how"];
    if (salience !== undefined)
      draft["claimed"] = salience;
    if (Object.keys(dims).length > 0)
      draft["salience"] = dims;
    if (typeof args["unresolved"] === "boolean")
      draft["unresolved"] = args["unresolved"];
    Object.assign(draft, dated.fields);
    const model = this.sessionModel(session);
    const feelings = readFeelings(args["feelings"]);
    if ("refused" in feelings) {
      return this.refuse("remember", "feelings-malformed", { detail: feelings.refused });
    }
    const about = readAbout(args["about"]);
    if ("refused" in about)
      return this.refuse("remember", "about-malformed", { detail: about.refused });
    const traits = readTraits(args["traits"]);
    if ("refused" in traits)
      return this.refuse("remember", "traits-malformed", { detail: traits.refused });
    const facts = readWriteFacts(args, this.today());
    const deposit = await this.counterpart.submitJot(draft, {
      session,
      scope: this.scope,
      ownSpanHash,
      facts: facts.sent,
      about: about.mark,
      ...model === undefined ? {} : { model },
      owner: this.owner
    });
    const neighbours = this.neighboursOf(deposit, [], CONTRADICTION_TUNABLES.NEIGHBOURS, session);
    this.markSeen([...neighbours.map((n) => n.id), ...deposit.slot === undefined ? [] : [deposit.slot.over]]);
    const feltNow = nowArg === undefined ? null : this.feelingsNowOutcome(nowArg);
    const settle = settleArg === undefined ? null : this.settleOutcome(settleArg);
    return this.depositResult("remember", deposit, {
      ...this.recordFeelings(deposit, feelings.inputs, model),
      ...this.recordAbout(deposit, about.mark),
      ...this.recordTraits(deposit, traits.inputs, model),
      ...reminderEcho(deposit, dated, this.today()),
      ...undatedReminderWarning(deposit, dated, args["title"], text),
      ...factsEcho(deposit, facts),
      ...this.settledOf(deposit, args["how"] !== undefined),
      ...threadOf(deposit),
      ...neighbours.length === 0 ? {} : { neighbours, neighboursHint: NEIGHBOURS_HINT },
      ...this.slotOf(deposit),
      ...settle === null ? {} : { settle },
      ...feltNow === null ? {} : { feelingsNow: feltNow }
    }, settle === null && feltNow === null ? undefined : !deposit.deposited && settle?.["ok"] !== true && Number(feltNow?.["recorded"] ?? 0) === 0);
  }
  feelingsNowOnly(list) {
    const out = this.feelingsNowOutcome(list);
    return this.result({ stored: false, reason: "feelings-now-only", feelingsNow: out }, out["recorded"] === 0);
  }
  seenKey() {
    if (this.desktop)
      return this.session ?? UNBOUND_SESSION;
    return this.hostSession() ?? this.session ?? UNBOUND_SESSION;
  }
  markSeen(ids, key) {
    if (ids.length === 0)
      return;
    key ??= this.seenKey();
    const set = this.seenBySession.get(key) ?? new Set;
    for (const id of ids)
      set.add(id);
    this.seenBySession.delete(key);
    this.seenBySession.set(key, set);
    while (this.seenBySession.size > SEEN_SESSIONS) {
      const oldest = this.seenBySession.keys().next().value;
      if (oldest === undefined)
        break;
      this.seenBySession.delete(oldest);
    }
  }
  withFeelingsNow(settled, list) {
    const out = this.feelingsNowOutcome(list);
    const body = settled.structuredContent;
    if (body === undefined)
      return settled;
    const ok = body["settle"] !== undefined && body["settle"]["ok"] === true;
    return this.result({ ...body, feelingsNow: out }, !ok && out["recorded"] === 0);
  }
  feelingsNowOutcome(list) {
    try {
      const { session, shown } = this.shownToCaller();
      const model = this.sessionModel(session);
      const items = list.map((x) => x !== null && typeof x === "object" && !Array.isArray(x) ? x : {});
      const done = this.counterpart.reflections.feelAgain({
        session,
        shown,
        feelings: items,
        ...model === undefined ? {} : { model },
        owner: this.owner
      });
      if (!done.ok)
        return { recorded: 0, reason: done.reason };
      const recorded = done.feelings.filter((f) => f.ok && f.reason === "recorded-later").length;
      this.emit("mcp.remember.feelingsNow", undefined, { sent: list.length, recorded });
      return { recorded, results: done.feelings };
    } catch (err) {
      return { recorded: 0, reason: "threw", detail: String(err.message ?? err) };
    }
  }
  shownToCaller() {
    const session = this.seenKey();
    const shown = new Set(this.seenBySession.get(session) ?? []);
    if (session !== UNBOUND_SESSION) {
      try {
        for (const [id, rec] of Object.entries(loadGateState(this.counterpart.store, session).state.surfaced)) {
          if (rec.tier === "surfaced")
            shown.add(id);
        }
      } catch {}
    }
    return { session, shown };
  }
  remarkOutcome(arg) {
    const id = typeof arg["id"] === "string" ? arg["id"].trim() : "";
    try {
      if (id.length === 0)
        return { ok: false, reason: "remark-malformed", detail: "remark needs the memory's id: {id, about, why}." };
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
        ...(this.env[NIGHT_CHILD_ENV] ?? "").trim().length > 0 || (this.env[NIGHT_RUN_ENV] ?? "").trim().length > 0 ? { night: true } : {}
      });
      this.emit("mcp.remember.remark", id, { ok: out.ok, reason: out.ok ? out.changed ? "marked" : "unchanged" : out.reason });
      return { ...out };
    } catch (err) {
      return { ok: false, reason: "threw", detail: String(err.message ?? err) };
    }
  }
  coreDecisionOutcome(arg) {
    const id = typeof arg["id"] === "string" ? arg["id"].trim() : "";
    const decision = arg["decision"];
    const why = typeof arg["why"] === "string" ? arg["why"] : "";
    try {
      if (id.length === 0)
        return { ok: false, reason: "core-malformed", detail: "core needs the memory's id: {id, decision, why}." };
      if (decision !== "keep" && decision !== "retire")
        return { ok: false, reason: "core-malformed", detail: 'decision is "keep" or "retire".' };
      const row = this.counterpart.store.row(id);
      if (row === undefined || row.confidential === 1 && !this.owner)
        return { ok: false, reason: "unknown-id", detail: `No memory ${id} in this store.` };
      const out = decision === "keep" ? this.counterpart.keepCore(id, { why, actor: "self" }) : this.counterpart.demoteCore(id, { reason: why, actor: "self" });
      const detail = {
        "reason-required": "Say why: the decision is kept with its reason.",
        "not-core": `${id} is not in the core.`,
        "unknown-id": `No memory ${id} in this store.`,
        observer: "This session is an observer: nothing was changed."
      };
      this.emit("mcp.remember.core", id, { ok: out.ok, reason: out.reason, decision });
      return out.ok ? { ok: true, reason: out.reason, id, note: decision === "keep" ? "Kept in the core; it is no longer being reconsidered for what it is." : "Retired: it fades like any other memory from today, and the core's lanes will not promote it again." } : { ok: false, reason: out.reason, detail: detail[out.reason] ?? out.reason };
    } catch (err) {
      return { ok: false, reason: "threw", detail: String(err.message ?? err) };
    }
  }
  settleOnly(arg) {
    const outcome = this.settleOutcome(arg);
    this.emit("mcp.remember.settle", typeof outcome["pair"] === "string" ? outcome["pair"] : undefined, {
      ok: outcome["ok"] === true,
      reason: typeof outcome["reason"] === "string" ? outcome["reason"] : null
    });
    return this.result({ stored: false, reason: "settle-only", settle: outcome }, outcome["ok"] !== true);
  }
  settleOutcome(arg) {
    const str = (v) => typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
    try {
      const pair = str(arg["pair"]);
      const holds = str(arg["holds"]);
      const over = str(arg["over"]);
      const out = this.counterpart.settleContradiction({
        ...pair === undefined ? {} : { pair },
        ...holds === undefined ? {} : { holds },
        ...over === undefined ? {} : { over },
        how: typeof arg["how"] === "string" ? arg["how"] : "",
        why: typeof arg["why"] === "string" ? arg["why"] : null,
        actor: "session",
        actorId: this.session ?? null
      });
      return { ...out };
    } catch (err) {
      return { ok: false, reason: "threw", detail: String(err.message ?? err) };
    }
  }
  settledOf(deposit, sentHow) {
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
          ...h.title === null ? {} : { title: h.title },
          ...h.text === null ? {} : { text: h.text },
          detail: HELD_HINT
        }
      };
    }
    const r = deposit.revision;
    if (r === undefined)
      return {};
    const o = r.settle;
    if (o !== undefined) {
      if (!o.ok)
        return { settled: { ok: false, reason: o.reason, detail: o.detail } };
      return {
        settled: {
          ok: true,
          pair: o.pair,
          how: o.how,
          ...o.how === "open" ? { with: r.targetId } : { over: o.over },
          ...o.faded === null ? {} : { faded: { before: o.faded.before, after: o.faded.after } },
          ...o.archived === null ? {} : { archived: o.archived },
          ...o.closed.length === 0 ? {} : { closedFlags: o.closed },
          ...o.note === undefined ? {} : { note: o.note }
        }
      };
    }
    if (r.reason === "target-removed") {
      return {
        settled: {
          ok: false,
          applied: false,
          path: r.path,
          reason: r.reason,
          detail: "the memory named in updates was removed, so nothing was updated; this one is stored on its own, unlinked."
        }
      };
    }
    if (!sentHow)
      return {};
    const why = r.path === "belief" ? "the memory it updates is a belief, which changes by pressure over days" : r.path === "identity" ? `the memory it updates is a core memory, which changes by pressure over days${r.pressurePair === undefined ? "" : `; meanwhile the pair is recorded unsettled (${r.pressurePair}), so recall shows the older one as possibly out of date`}` : r.path === "current-state" ? "the memory it updates is a current-state fact, which is replaced now" : r.reason === "target-is-an-entity" ? "the memory it updates is an entity card, which only links" : r.reason === "protected-refuses-revision" ? "the memory it updates is protected by the owner" : `the update did not reach an ordinary memory (${r.reason})`;
    return { settled: { ok: false, applied: false, path: r.path, reason: r.reason, detail: `how was not applied: ${why}.` } };
  }
  neighboursOf(deposit, siblings = [], room = CONTRADICTION_TUNABLES.NEIGHBOURS, session = null) {
    if (!deposit.deposited || deposit.memoryId === null || room <= 0)
      return [];
    const exclude = [deposit.revision?.targetId, deposit.mint?.updates, deposit.held?.over, deposit.slot?.over, ...siblings].filter((x) => typeof x === "string");
    return this.counterpart.writeNeighbours(deposit.memoryId, { exclude, owner: this.owner, session }).slice(0, room);
  }
  slotOf(deposit) {
    const s = deposit.slot;
    if (s === undefined)
      return {};
    const row = this.counterpart.store.row(s.over);
    const title = row === undefined || row.confidential === 1 && !this.owner ? null : row.title ?? lineOf({ body: row.body });
    return { slot: { pair: s.pair, over: s.over, ...title === null ? {} : { title }, rule: s.rule }, slotHint: SLOT_HINT };
  }
  async recallTool(args) {
    if (this.observer)
      return this.standDown("recall");
    const handle = args["handle"];
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
    const part = args["part"];
    if (part !== undefined && (typeof part !== "number" || !Number.isInteger(part) || part < 1)) {
      return this.refuse("recall", "part-not-a-positive-integer", {});
    }
    const page = args["page"];
    if (page !== undefined && (typeof page !== "number" || !Number.isInteger(page) || page < 1)) {
      return this.refuse("recall", "page-not-a-positive-integer", {});
    }
    const mode = args["mode"];
    if (mode !== undefined && mode !== "facts" && mode !== "meaning") {
      return this.refuse("recall", "mode-unknown", { modes: RECALL_MODE_WORDS });
    }
    const askedIds = (ids ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    const asked = typeof question === "string" && question.trim().length > 0;
    const addressed = typeof handle === "string" && handle.trim().length > 0 || askedIds.length > 0;
    if (asked && !addressed) {
      if (mode === undefined)
        return this.refuse("recall", "mode-required", { modes: RECALL_MODE_WORDS });
      return this.askQuestion(question, mode, typeof page === "number" ? page : 1);
    }
    const key = this.seenKey();
    const result = deliberateRecall(this.counterpart, {
      ...typeof handle === "string" ? { handle } : {},
      ...typeof question === "string" ? { question } : {},
      ...askedIds.length > 0 ? { ids: askedIds } : {}
    }, { sessionId: this.session ?? key, owner: this.owner });
    const resolved = this.noteHandleResolution(handle, result);
    const payload = {
      ...this.recallPayload(result, typeof part === "number" ? part : 1),
      ...mode !== undefined && addressed ? { modeIgnored: "ids and handle are exact addresses; mode applies to a question only." } : {}
    };
    const delivered = result.path === "handle" ? payload["memories"] ?? [] : [];
    const fromIndex = delivered.length > 0 ? this.lookupsFromIndex(delivered.map((m) => ({ id: m.id, whole: (m.part ?? 1) >= (m.parts ?? 1) }))) : {};
    this.emit("mcp.recall", undefined, {
      path: result.path,
      reason: result.reason,
      handleResolved: resolved,
      semantic: result.semantic,
      returned: result.memories.length,
      considered: result.considered,
      storeSize: result.storeSize,
      owner: this.owner,
      chars: payload["chars"],
      truncated: payload["truncated"] === true,
      droppedForBudget: 0
    });
    const deliveredIds = (payload["memories"] ?? []).map((m) => m.id).filter((x) => typeof x === "string");
    this.noteRecall({
      path: result.path,
      reason: result.reason,
      semantic: result.semantic,
      considered: result.considered,
      storeSize: result.storeSize,
      expanded: result.path === "handle" ? result.memories.length : 0,
      blockedBy: addressBlocked(result)
    }, askedIds.length, question, resolved, payload, deliveredIds, key, fromIndex);
    this.markSeen(deliveredIds, key);
    const bad = result.reason === "no-argument" || result.reason === "both-arguments" || result.reason === "handle-unknown" || result.reason === "ids-too-many" || result.reason === "handle-confidential-withheld";
    return this.result(payload, bad);
  }
  lastExchangeTool() {
    if (!this.owner) {
      this.emit("mcp.recall.lastexchange", undefined, { found: false, owner: false });
      return this.result({
        path: "handle",
        reason: "owner-only",
        handle: LAST_EXCHANGE_HANDLE,
        detail: "The last exchange is read only in the owner's own session."
      }, false);
    }
    const reader = this.session ?? this.hostSession();
    const ex = this.counterpart.lastExchange({
      scope: this.scope,
      session: reader,
      sessions: () => listSessions(this.registryDir).map((r) => ({
        session: r.sessionId,
        scope: r.scope,
        startedAt: r.startedAt,
        lastAt: Math.max(r.lastBoundaryAt, r.endedAt ?? 0),
        live: isLive(r, this.nowFn(), this.sessionTtlMs),
        endedAt: r.endedAt
      }))
    });
    this.emit("mcp.recall.lastexchange", undefined, { found: ex !== null });
    if (ex === null) {
      return this.result({
        path: "handle",
        reason: "no-exchange",
        handle: LAST_EXCHANGE_HANDLE,
        detail: "No exchange with another session in this folder in about the last day was captured."
      }, false);
    }
    return this.result({
      path: "handle",
      reason: "last-exchange",
      handle: LAST_EXCHANGE_HANDLE,
      ...lastExchangeAnswer(ex, { zone: this.counterpart.store.zone(), now: this.nowFn() })
    }, false);
  }
  async askQuestion(question, mode, page) {
    const embedded = await embedQuestion(this.embedder, question);
    const moved = this.schemaGate("recall");
    if (moved !== null)
      return moved;
    const key = this.seenKey();
    const ctx = {
      counterpart: this.counterpart,
      sessionId: this.session ?? key,
      owner: this.owner,
      ...this.scope === undefined ? {} : { scope: this.scope },
      vector: embedded.vector,
      semantic: embedded.semantic,
      asker: "self"
    };
    let answer;
    let ids;
    let body;
    let row;
    if (mode === "facts") {
      const r = factsRecall(ctx, question, { page });
      answer = renderFacts(r);
      ids = r.memories.map((m) => m.id);
      body = {
        matched: r.matched,
        page: r.page,
        pages: r.pages,
        ...r.faded > 0 ? { faded: r.faded } : {}
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
        ...r.time === null ? {} : { time: r.time.anchor?.kind ?? "window" }
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
        counts: { ...r.counts }
      };
    }
    const payload = {
      path: "question",
      mode,
      reason: row.reason,
      semantic: row.semantic,
      ...body,
      chars: answer.length,
      answer,
      ids: [...ids]
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
      droppedForBudget: 0
    });
    this.noteRecall(row, 0, question, false, payload, ids, key);
    this.markSeen(ids, key);
    this.noteAsked(ids, key);
    return this.result(payload, false);
  }
  noteAsked(ids, key) {
    if (ids.length === 0)
      return;
    const session = key ?? this.seenKey();
    if (session === UNBOUND_SESSION)
      return;
    this.telemetry(() => {
      this.counterpart.noteAsked(session, ids);
    });
  }
  noteRecall(row, askedIds, question, handleResolved, payload, delivered, session, fromIndex = {}) {
    const byAddress = row.path === "handle";
    const shown = row.shown ?? 0;
    this.telemetry(() => {
      this.counterpart.noteAdapterEvent(MCP_RECALL_EVENT, {
        ...session === UNBOUND_SESSION ? {} : { session },
        path: row.path,
        reason: row.reason,
        ...row.mode === undefined ? {} : { mode: row.mode },
        queryChars: typeof question === "string" ? question.trim().length : 0,
        askedIds,
        handleResolved,
        semantic: row.semantic,
        surfaced: byAddress ? 0 : shown,
        expanded: byAddress ? row.expanded : 0,
        ...row.matched === undefined ? {} : { matched: row.matched },
        ...row.faded === undefined ? {} : { faded: row.faded },
        ...row.page === undefined ? {} : { page: row.page },
        ...row.time === undefined ? {} : { time: row.time },
        ...row.counts === undefined ? {} : { counts: row.counts },
        considered: row.considered,
        storeSize: row.storeSize,
        owner: this.owner,
        chars: payload["chars"] ?? 0,
        truncated: payload["truncated"] === true,
        droppedForBudget: 0,
        blockedBy: row.blockedBy,
        ...Object.keys(fromIndex).length > 0 ? { fromIndex } : {},
        ...boundedIds(delivered)
      });
    });
  }
  noteHandleResolution(handle, result) {
    if (typeof handle !== "string" || handle.trim().length === 0)
      return false;
    if (result.path !== "handle")
      return false;
    const id = resolvedIdOf(result);
    if (id === undefined)
      return false;
    const written = recordHandleResolution(this.registryDir, {
      handle,
      id,
      scope: this.scope,
      at: this.nowFn()
    });
    return written && id !== null;
  }
  lookupsFromIndex(delivered) {
    let counted = {};
    this.telemetry(() => {
      counted = noteLookups(this.counterpart.store, delivered);
    });
    return counted;
  }
  recallPayload(result, part = 1) {
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
      ...bounded.truncated ? {
        budget: `By id, a body comes in parts of ${RECALL_BODY_CHARS} characters ("part" of "parts" on each; bodyChars is the whole length).${part < lastPart ? ` Ask again with the same ids and part: ${String(part + 1)} for the next.` : " That was the last part."}`
      } : {},
      ...bounded.waiting !== undefined ? {
        waiting: [...bounded.waiting],
        more: `No room for ${String(bounded.waiting.length)} of the ids in one result: ask again with ids: [${bounded.waiting.join(", ")}].`
      } : {},
      ...result.ambiguous.length > 0 ? { ambiguous: [...result.ambiguous] } : {},
      ...result.perId === undefined ? {} : { perId: result.perId.map((p) => ({ ...p })) },
      ...result.reason === "ids-too-many" ? { refused: `At most ${RECALL_MAX_IDS} ids per call. Effort is not enumeration.` } : {},
      ...result.reason === "handle-confidential-withheld" ? {
        withheld: "That memory is marked confidential and this is not the owner's own session. It exists; it is not being shown."
      } : {},
      ...result.reason === "both-arguments" ? { refused: "One kind of ask per call: a question (with a mode), ids, or a handle." } : {},
      ...result.reason === "no-argument" ? { refused: `Send a question with mode (${RECALL_MODE_WORDS}), or ids, or a handle.` } : {},
      memories: bounded.memories.map((m) => ({ ...m })),
      ...bounded.memories.some((m) => m.journal) ? { journal: JOURNAL_GLOSS } : {}
    };
  }
  wakeTool() {
    if (this.observer)
      return this.standDown("wake");
    const lc = this.lifecycle();
    const store = this.counterpart.store;
    const now = this.nowFn();
    const input = {
      sessionId: randomUUID(),
      scope: this.scope,
      at: localDate(now, store.zone())
    };
    lc.noteSession("start", input);
    const woke = lc.composeWake(input, this.lifecycleOpts.config?.injectionBudgetBytes);
    const plain = lc.plainFor(input);
    const told = lc.claimPlain(input, plain.due);
    const spawn = lc.spawnWorker(input);
    const dream = this.wakeDreamLine(input);
    const notices = [this.wakeUpdateLine(), this.wakeDoctorLine()].filter((l) => l !== null);
    const head = `Counterparts session for this chat: ${input.sessionId}. Pass session: ${input.sessionId} on session_end, chapter, dream and reflect in this chat.`;
    const lead = [lc.nowLine(), lc.onboardingMarker(input), ...told.map((r) => plainContextLine(r))].join(`
`);
    const meet = lc.onboardingLine(input);
    meet?.commit();
    const parts = [
      head,
      `${lead}
${woke.text}`.trimEnd(),
      ...notices.length === 0 ? [] : [notices.join(`
`)],
      ...dream === null ? [] : [`${dream}
${DESKTOP_DREAM_NOTE}`],
      ...meet === null ? [] : [meet.text]
    ];
    const body = parts.join(`

`);
    const pointer = lc.deliverWriteUpAsk(input, Buffer.byteLength(body, "utf8"), {
      limit: ADAPTER_TUNABLES.TOOL_RESULT_CHARS,
      label: "wake"
    });
    const text = pointer.length === 0 ? body : `${body}

${pointer}`;
    try {
      store.setMeta(DESKTOP_WAKE_KEY, String(now));
    } catch {}
    this.emit("mcp.wake", input.sessionId, {
      ok: woke.ok,
      reason: woke.reason,
      bytes: Buffer.byteLength(text, "utf8"),
      plain: told.length,
      spawned: spawn.started,
      dream: dream !== null,
      notices: notices.length,
      pointer: pointer.length > 0
    });
    const payload = {
      session: input.sessionId,
      scope: this.scope,
      host: this.host,
      wake: text
    };
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  wakeDreamLine(input) {
    if (this.observer || input.at === undefined)
      return null;
    try {
      const dreams = this.counterpart.dreams;
      const offer = dreams.offer({ at: input.at, session: input.sessionId });
      if (offer === null)
        return null;
      if (offer.headless) {
        this.emit("mcp.wake.dream", undefined, { left: "headless" });
        return null;
      }
      if (!dreams.claimOffer(offer))
        return null;
      this.emit("mcp.wake.dream", undefined, { told: true, state: offer.state });
      return offer.context;
    } catch {
      return null;
    }
  }
  wakeUpdateLine() {
    return this.updateReading()?.line ?? null;
  }
  updateReading() {
    try {
      const loaded = this.identity?.build.version ?? installedVersion();
      if (loaded === null)
        return null;
      const onDisk = this.manifestVersion();
      if (onDisk !== null && loaded !== onDisk) {
        const stamp = (version) => ({ ...installedBuild(), version });
        const older = serverIsNewer(stamp(loaded), stamp(onDisk));
        return { line: `Counterparts was ${older ? "changed to an older version" : "updated"}. ${wordingFor(this.host).reconnect}`, reconnect: true };
      }
      let wrote = null;
      try {
        wrote = this.counterpart.store.getMeta(WAKE_BUILD_KEY) ?? null;
      } catch {
        return null;
      }
      if (!versionNewer(wrote, loaded))
        return null;
      return {
        line: `A newer Counterparts (${String(wrote)}), installed somewhere else, has written this memory store; this server is ${loaded}.`,
        reconnect: false
      };
    } catch {
      return null;
    }
  }
  withUpdateNotice(name, result) {
    if (name === "wake")
      return result;
    const reading = this.updateReading();
    if (reading === null)
      return result;
    this.emit("mcp.update.noticed", undefined, { tool: name, reconnect: reading.reconnect });
    const said = reading.reconnect ? `${reading.line} Until then this server runs the version it started with, and it ignores anything newer, such as a field added to a tool since.` : `${reading.line} It ignores anything newer, such as a field added to a tool since; updating this install is what brings it level.`;
    return this.result({ ...result.structuredContent, updated: said }, result.isError === true);
  }
  wakeDoctorLine() {
    try {
      return this.wakeNotice?.() ?? null;
    } catch {
      return null;
    }
  }
  statusTool() {
    if (this.observer)
      return this.standDown("status");
    const census = this.census();
    this.emit("mcp.status", undefined, {
      live: census["live"],
      removed: census["removed"]["count"]
    });
    return this.result(census, false);
  }
  census() {
    const store = this.counterpart.store;
    const kinds = ["self", "person", "entity", "skill", "place", "fact"];
    const bands = ["episodic", "semantic", "identity"];
    const denied = new Set(store.deniedIds());
    const created = {};
    const exited = {};
    const replaced = {};
    const byBand = {};
    let live = 0;
    let archived = 0;
    let superseded = 0;
    let journal = 0;
    for (const kind of kinds) {
      const ids = store.list({ kind });
      let born = 0;
      let gone = 0;
      let swapped = 0;
      for (const id of ids) {
        const row = store.row(id);
        if (row === undefined)
          continue;
        if (row.type === "episode") {
          if (row.archived === 0 && !denied.has(id))
            journal += 1;
          continue;
        }
        born += 1;
        if (denied.has(id)) {
          gone += 1;
          continue;
        }
        if (row.archived === 1) {
          archived += 1;
          if (this.counterpart.leftAs(row.archived_reason, row.superseded_by !== null) === "replaced")
            swapped += 1;
          else
            gone += 1;
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
    for (const band of bands)
      byBand[band] = byBand[band] ?? 0;
    const dates = new Set;
    const removedKinds = {};
    const removedIds = new Set;
    for (const row of store.removalRecord()) {
      if (row.stage !== "complete")
        continue;
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
      symmetry: { created, exited, replaced },
      removed: {
        count: removedIds.size,
        kinds: removedKinds,
        dates: [...dates].sort(),
        note: "Counts, kinds and dates only. No ids, no bodies, no hashes."
      },
      counts: "Every number above is MEMORIES. `journal` is the first-person episodes those memories were made from: it is the source, not a memory, and it neither decays nor is pruned. In `symmetry`, `exited` is only what left for good (let go, or removed); `replaced` is what a newer reading carries (a revision, a merge, a journal copy rebuilt when its chapter grew) — nothing there was forgotten.",
      clock: {
        livedDay: store.livedDay(),
        lastActiveDate: store.getMeta("lastActiveDate") ?? null
      },
      stance: { observer: this.observer, ...this.ownerStance() }
    };
  }
  sessionEndTool(args) {
    return sessionEndPart.sessionEndTool(this, args);
  }
  depositEntries(raw, session, cover, scope, writeUp) {
    return sessionEndPart.depositEntries(this, raw, session, cover, scope, writeUp);
  }
  writeUpField(args, drewOn) {
    return sessionEndPart.writeUpField(this, args, drewOn);
  }
  drewOnField(raw, via) {
    return sessionEndPart.drewOnField(this, raw, via);
  }
  writeHandoffField(raw) {
    return sessionEndPart.writeHandoffField(this, raw);
  }
  unnamedHandoffField(raw) {
    return sessionEndPart.unnamedHandoffField(this, raw);
  }
  retireHandoffField(raw) {
    return sessionEndPart.retireHandoffField(this, raw);
  }
  chapterTool(args) {
    return sessionEndPart.chapterTool(this, args);
  }
  dreamTool(args) {
    return selfTools.dreamTool(this, args);
  }
  reflectTool(args) {
    return selfTools.reflectTool(this, args);
  }
  selfPageTool(args) {
    return selfTools.selfPageTool(this, args);
  }
  selfPageRead() {
    return selfTools.selfPageRead(this);
  }
  bindForPageWriter(claimed) {
    return selfTools.bindForPageWriter(this, claimed);
  }
  today() {
    return todayIn(this.counterpart.store.zone(), this.nowFn());
  }
  sessionModel(session = this.session) {
    if (session === null || !isKnownSession(session))
      return;
    try {
      return readSession(this.registryDir, session)?.model;
    } catch {
      return;
    }
  }
  hostSession() {
    if (this.desktop || this.identity === null || claudeCodeEnvMarker(this.env) === null)
      return null;
    const found = sessionOfHost(this.registryDir, {
      hostPid: this.identity.hostPid,
      scope: this.scope,
      now: this.nowFn(),
      launchedAt: this.identity.startedAt,
      ttlMs: this.sessionTtlMs
    });
    this.emit("mcp.session.host", found ?? undefined, { matched: found !== null });
    return found;
  }
  corroborate(claimed) {
    const record = readSession(this.registryDir, claimed);
    if (record === null)
      return false;
    if (!isLive(record, this.nowFn(), this.sessionTtlMs))
      return false;
    return sameScope(record.scope, this.scope);
  }
  pageWriterMark(claimedSession) {
    try {
      const night = claimedSession === null ? null : this.counterpart.nightClaimFor(claimedSession);
      if (night !== null)
        return { about: night.about, mode: night.mode };
      const about = this.pageWriterClaim(claimedSession);
      if (about === null)
        return null;
      const open = this.counterpart.pageWriterRuns({ about }).find((r) => r.outcome === "asked" || r.outcome === "started");
      if (open === undefined || !this.counterpart.pageWriterClaimOpen(about))
        return null;
      return { about, mode: open.mode };
    } catch {
      return null;
    }
  }
  pageWriterClaim(claimedSession) {
    const id = claimedSession ?? this.session;
    if (id === null)
      return null;
    const about = readSession(this.registryDir, id)?.pageWriterFor;
    return about === undefined || about.length === 0 ? null : about;
  }
  requireBoundSession(claimed, tool) {
    const bound = this.session;
    if (bound !== null) {
      if (claimed !== undefined && claimed !== bound) {
        this.emit("mcp.session.mismatch", undefined, {
          bound: true,
          source: this.launchedSession !== null ? "launch" : "registry"
        });
        return this.refuse(tool, "session-mismatch", {
          detail: "This server is already bound to a different session, for the life of the process. A dump belongs to the session that lived it."
        });
      }
      return null;
    }
    if (this.desktop) {
      const why = this.callRefusal ?? { reason: "session-required", detail: NO_DESKTOP_SESSION };
      this.emit("mcp.session.unbound", undefined, { reason: why.reason, host: this.host });
      return this.refuse(tool, why.reason, { detail: why.detail });
    }
    if (typeof claimed !== "string" || claimed.length === 0) {
      this.emit("mcp.session.unbound", undefined, { reason: "no-claim" });
      return this.refuse(tool, "session-required", {
        detail: "This server was launched without a session. Pass `session` — the session id the end-of-session ask named — and it will bind to it."
      });
    }
    const record = readSession(this.registryDir, claimed);
    if (record === null) {
      this.emit("mcp.session.unbound", undefined, { reason: "unknown" });
      return this.refuse(tool, "session-unknown", {
        detail: "No live session by that id has been recorded by this host's hooks. Use the id the end-of-session ask named, exactly."
      });
    }
    if (!isLive(record, this.nowFn(), this.sessionTtlMs)) {
      this.emit("mcp.session.unbound", undefined, {
        reason: record.endedAt === null ? "stale" : "ended"
      });
      return this.refuse(tool, "session-not-live", {
        detail: "That session has ended or has been silent too long to still be writing its own day. Its memories belong to the sweep now."
      });
    }
    if (!sameScope(record.scope, this.scope)) {
      this.emit("mcp.session.unbound", undefined, { reason: "scope-mismatch" });
      return this.refuse(tool, "scope-mismatch", {
        detail: "That session is running in a different project than this server. A dump belongs to the project that lived it."
      });
    }
    this.lazySession = claimed;
    this.emit("mcp.session.bound", claimed, { source: "registry", scope: this.scope });
    return null;
  }
  recordFeelings(deposit, inputs, model) {
    if (inputs.length === 0)
      return {};
    if (!deposit.deposited || deposit.memoryId === null) {
      return {
        feelings: {
          stored: 0,
          reason: "memory-not-stored",
          detail: `The memory was not stored (${deposit.reason}), so its ${String(inputs.length)} feeling${inputs.length === 1 ? " was" : "s were"} not stored either.`
        }
      };
    }
    try {
      const added = this.counterpart.addFeelings(deposit.memoryId, inputs, model === undefined ? {} : { model });
      const kept = added.notices.filter((n) => n.readAs === undefined);
      const read = added.notices.filter((n) => n.readAs !== undefined);
      return {
        feelings: {
          stored: added.ids.length,
          ...kept.length === 0 ? {} : {
            other: kept.map((n) => ({
              index: n.index,
              word: n.word,
              core: n.core,
              closest: n.closest,
              note: n.closest.length === 0 ? `"${n.word}" is not on the feelings wheel, so it was kept as your own word.` : `"${n.word}" is not on the feelings wheel, so it was kept as your own word. If you meant ${n.closest.join(" or ")}, say it that way next time.`
            }))
          },
          ...read.length === 0 ? {} : {
            readAs: read.map((n) => ({
              index: n.index,
              word: n.word,
              as: n.readAs,
              note: `"${n.word}" was stored as ${String(n.readAs)}.`
            }))
          },
          ...added.repairs.length === 0 ? {} : { repaired: added.repairs.map((r) => ({ index: r.index, field: r.field, now: r.now, note: r.note })) }
        }
      };
    } catch (err) {
      return { feelings: { stored: 0, reason: "threw", detail: String(err.message ?? err) } };
    }
  }
  recordAbout(deposit, mark) {
    if (mark === null) {
      const carried = deposit.aboutCarried;
      return carried === undefined ? {} : { about: { stored: true, mark: carried.mark, carriedFrom: carried.from } };
    }
    if (!deposit.deposited || deposit.memoryId === null) {
      return { about: { stored: false, reason: "memory-not-stored" } };
    }
    try {
      const row = this.counterpart.store.row(deposit.memoryId);
      const skill = row?.kind === "skill" && CORE_ABOUT_MARKS.includes(mark);
      this.counterpart.store.setAbout(deposit.memoryId, mark, { by: "writer" });
      return {
        about: {
          stored: true,
          mark,
          ...skill ? { note: "A skill memory is the craft — how I work — and never becomes core, whatever its mark." } : {}
        }
      };
    } catch (err) {
      return { about: { stored: false, reason: "threw", detail: String(err.message ?? err) } };
    }
  }
  recordTraits(deposit, inputs, model) {
    if (inputs.length === 0)
      return {};
    if (!deposit.deposited || deposit.memoryId === null) {
      return {
        traits: {
          stored: 0,
          reason: "memory-not-stored",
          detail: `The memory was not stored (${deposit.reason}), so its ${String(inputs.length)} trait ${inputs.length === 1 ? "nudge was" : "nudges were"} not stored either.`
        }
      };
    }
    try {
      const added = this.counterpart.addTraits(deposit.memoryId, inputs, model === undefined ? {} : { model });
      return {
        traits: {
          stored: added.ids.length,
          ...added.repairs.length === 0 ? {} : { repaired: added.repairs.map((r) => ({ index: r.index, note: r.note })) }
        }
      };
    } catch (err) {
      return { traits: { stored: 0, reason: "threw", detail: String(err.message ?? err) } };
    }
  }
  depositResult(tool, deposit, extra = {}, isError) {
    this.emit(`mcp.${tool}`, deposit.memoryId ?? undefined, {
      stored: deposit.deposited,
      reason: deposit.reason,
      gate: deposit.gate,
      covers: deposit.covers.length
    });
    const lifted = deposit.mint?.lifted ?? false;
    return this.result({
      stored: deposit.deposited,
      reason: deposit.reason,
      ...deposit.memoryId === null ? {} : { id: deposit.memoryId },
      ...deposit.gate === null ? {} : { gate: deposit.gate },
      ...lifted ? { salienceLifted: true } : {},
      ...extra
    }, isError ?? !deposit.deposited);
  }
  standDown(tool) {
    this.emit("mcp.observer.standdown", undefined, { tool });
    return this.result({
      stoodDown: true,
      tool,
      stance: "observer",
      reason: "This session is an observer: it reads the store as an instrument and changes nothing in it. The tool did not run."
    }, true);
  }
  refuse(tool, reason, extra) {
    this.emit("mcp.refused", undefined, { tool, reason });
    return this.result({ stored: false, tool, reason, ...extra }, true);
  }
  withinCeiling(name, args, result) {
    const ceiling = this.resultCeilingChars;
    const sc = result.structuredContent;
    const measured = wireChars(JSON.stringify(sc));
    if (measured <= ceiling)
      return result;
    let field = null;
    for (const [k, v] of Object.entries(sc)) {
      if (typeof v === "string" && (field === null || v.length > sc[field].length))
        field = k;
    }
    const phase = typeof args["phase"] === "string" ? args["phase"] : null;
    const noteFor = (f) => `This answer came to ${String(measured)} characters, more than the ${String(ceiling)} one tool answer carries whole, ` + `so the server cut \`${f}\` to fit: what is shown is its beginning, and the rest did not reach you. ` + `Work with what is here and say so; nothing was refused.`;
    const rest = field === null ? measured : wireChars(JSON.stringify({ ...sc, [field]: "", cut: noteFor(field) }));
    if (rest > ceiling)
      field = null;
    let out = result;
    let cutTo = measured;
    if (field !== null) {
      const value = sc[field];
      const note = noteFor(field);
      const target = Math.max(0, ceiling - rest);
      const escaped = (s) => wireChars(JSON.stringify(s)) - 2;
      let lo = 0;
      let hi = target;
      let kept = clipWire(value, 0);
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const tried = clipWire(value, mid);
        if (escaped(tried) <= target) {
          kept = tried;
          lo = mid + 1;
        } else
          hi = mid - 1;
      }
      if (escaped(kept) > target)
        kept = "";
      const payload = { ...sc, [field]: kept, cut: note };
      const asText = result.content.length === 1 && result.content[0]?.text === value;
      out = {
        content: [{ type: "text", text: asText ? `${kept}

${note}` : JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        ...result.isError === true ? { isError: true } : {}
      };
      cutTo = wireChars(JSON.stringify(payload));
    }
    this.emit("mcp.result.oversize", undefined, { tool: name, phase, chars: measured, cutTo });
    this.telemetry(() => {
      this.counterpart.noteAdapterEvent(MCP_OVERSIZE_EVENT, {
        tool: name,
        phase,
        chars: measured,
        ceiling,
        field,
        cut: field !== null,
        cutTo
      });
    });
    return out;
  }
  telemetry(write) {
    const before = this.writeTripped;
    try {
      write();
    } catch {} finally {
      this.writeTripped = before;
    }
  }
  notePart(mechanism, ref, part, of) {
    this.partHanded = { mechanism, ref, part, of };
  }
  writePart(result) {
    const p = this.partHanded;
    this.partHanded = null;
    if (p === null)
      return;
    const cut = typeof result.structuredContent["cut"] === "string";
    this.telemetry(() => {
      this.counterpart.noteAdapterEvent(MCP_PART_EVENT, { ...p, chars: wireChars(JSON.stringify(result.structuredContent)), cut });
    });
  }
  result(payload, isError) {
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      ...isError ? { isError: true } : {}
    };
  }
  emit(name, ref, data) {
    const event = { at: this.nowFn(), name };
    if (ref !== undefined)
      event.ref = ref;
    if (data !== undefined)
      event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING)
      this.ring.shift();
    this.onEvent?.(event);
  }
  ready() {
    return this.initialized;
  }
}
