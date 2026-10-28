#!/usr/bin/env bun
/**
 * The MCP entry point. Speaks JSON-RPC over stdio and nothing else.
 *
 * Run by a host as, e.g.:
 *
 *   bun run <repo>/src/adapters/mcp/bin/serve.ts --session <id> --scope <dir>
 *
 * Everything host-specific arrives as an ARGUMENT or a named environment
 * variable, and the session id is one of them when the host can supply it: this
 * server deposits under exactly one session (`server.ts`, refusal 1), and being
 * TOLD which one at launch is still the preferred path.
 *
 * **Measured 2026-09-04:** Claude Code cannot use that path. Its MCP servers are
 * registered from a static configuration — command, args, env — with no per-
 * session substitution, so neither `--session` nor `COUNTERPARTS_SESSION` ever
 * arrives, and for the whole first run every dump was refused `no-bound-session`.
 * The flags below are unchanged and still win; a launch without them now falls
 * through to `server.ts`'s lazy bind against `adapters/sessions.ts`'s registry.
 *
 * `--dir` is here for the same reason `hook.ts` pins the data dir onto its
 * child: the registry is found under the data dir, so the two sides have to
 * resolve the SAME one. Absent, both fall back to `dataDir()` and agree anyway.
 *
 * Nothing in this file is a memory rule; all of it is host trivia (§5 G8).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  configLine,
  defaultConfigPath,
  implicitConfigRefusal,
  namedConfigRefusal,
  namedUnreadableRefusal,
  resolveConfigPath,
} from "../../config-path.js";
import type { ConfigChoice } from "../../config-path.js";
import {
  describeScopeTrouble,
  effectiveStance,
  lookupScope,
  readScopes,
  scopeCommandContext,
  scopesPath,
  stanceOfMode,
} from "../../scopes.js";
import { loadConfig, withEmbedderDefault } from "../../config.js";
import type { AdapterConfig } from "../../config.js";
import { openEmbedder } from "../../claude-code/embed-client.js";
import type { LiveEmbedder } from "../../claude-code/embed-client.js";
import { SESSION_NOTICE_BUDGET_MS, doctorFindings, noticeMessage, wakeMeaningLine } from "../../claude-code/doctor.js";
import { staleWindowsLine } from "../../claude-code/stale-windows.js";
import { updateLineInputHere, updateNoticeLine, urgentUpdateLine } from "../../update-check.js";
import { SPAWN_REFUSAL_PREFIX, SPAWN_START_COUNT_KEY, SPAWN_START_DATE_KEY } from "../../lifecycle.js";
import { WORKER_RUNNER_PATH } from "../../spawn.js";
import { claudeCodeEnvMarker } from "../../hosts.js";
import { localDate } from "../../../core/time.js";
import type { Store } from "../../../core/store/index.js";
import { hostScope, openServer } from "../index.js";
import { openLog } from "../../log/index.js";
import type { LogEvent, ProcessLog } from "../../log/index.js";
import { serveStdio } from "../stdio.js";
import { SidebarStatusWriter, keepPluginPresence, removeSidebarStatus, sidebarInstalled } from "../../sidebar-status.js";
import { stoodDownServer } from "../stood-down.js";
import { noteNpmLive, npmWiringForGate } from "../../npm-live.js";
import { installedVersion, manifestVersionOnDisk } from "../../sessions.js";
import { PLUGIN_ROOT_ENV, ensureFirstRun, installRoute, mcpGate, pluginOrigin, runningAsPlugin } from "../../plugin.js";
import { DATA_DIR_ENV, describeGuardRefusal } from "../../../core/store/index.js";
import { BINARY, scriptArgs } from "../../runtime.js";
import { usePrivateUmask } from "../../private-umask.js";
import type { Binary } from "../../runtime.js";
import { OBSERVER_ENV, observerFromEnv, unreadableStanceLine } from "../../stance-env.js";

/**
 * The same file `bin/hook.ts` and `bin/runner.ts` read by default. One
 * configuration for this host, four entry points — never four ideas of which
 * file answers, and since 2026-09-05 never four ideas of how to move it either:
 * `--config <absolute path>`, else `COUNTERPARTS_CONFIG`, else this
 * (`adapters/config-path.ts`).
 *
 * The environment variable matters MORE here than anywhere else. This host
 * registers an MCP server from a static configuration — command, args, env — so
 * `-e COUNTERPARTS_CONFIG=…` in the `claude mcp add` line is the only way a
 * server launched by it can be pointed at anything but the default. That is why
 * the variable exists at all.
 */
export const CONFIG_PATH = defaultConfigPath();

export const ENV = {
  session: "COUNTERPARTS_SESSION",
  scope: "COUNTERPARTS_SCOPE",
  dir: "COUNTERPARTS_DATA_DIR",
  // The stance name comes from `adapters/stance-env.ts`, not from a second
  // string literal here (G39). (`COUNTERPARTS_OWNER` stood beside it until the
  // yours/guest split was removed, 2026-10-21; nothing reads it now.)
  observer: OBSERVER_ENV,
} as const;

export interface LaunchOptions {
  session?: string;
  scope?: string;
  dir?: string;
  observer: boolean;
  /**
   * One line per stance variable this launch could not read, ready for stderr.
   * ALWAYS present, usually empty — a caller destructures it off before the
   * rest goes to `openServer`, so the stance stays a pair of booleans and the
   * complaint stays a string. Keeping it here rather than printing from inside
   * `launchOptions` is what keeps that function pure: it is the one thing in
   * this file a test can call over a fresh object with no process involved.
   */
  unreadable: readonly string[];
}

/** Flags beat environment; absent means absent, never a guessed default. */
export function launchOptions(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): LaunchOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      session: { type: "string" },
      scope: { type: "string" },
      dir: { type: "string" },
      // `--owner` is still parsed, and ignored, so an old registration that
      // passes it launches as before (the yours/guest split was removed
      // 2026-10-21; the flag goes in the release after).
      owner: { type: "boolean" },
      observer: { type: "boolean" },
      // Declared so `strict: false` does not read `--config <path>` as a boolean
      // and leave the path as a stray positional. The VALUE is resolved by
      // `serverConfigChoice` below, which is the one rule all four entry points
      // share; this declaration only keeps the parse honest.
      config: { type: "string" },
    },
    strict: false,
  });
  // THE STANCE VARIABLE IS READ THE WAY THE GUARD NEXT DOOR IS READ (G39):
  // `adapters/stance-env.ts` carries the shared reading, and junk collapses to
  // OBSERVER (`docs/observer-mode.md` G5, fail toward standing down).
  const observer = observerFromEnv(env, values["observer"] === true, ENV.observer);
  const unreadable: string[] = [];
  if (observer.malformed !== null) {
    unreadable.push(
      unreadableStanceLine(ENV.observer, observer.malformed, "standing down to observer stance"),
    );
  }
  const session = (values["session"] as string | undefined) ?? env[ENV.session];
  const scope = (values["scope"] as string | undefined) ?? env[ENV.scope];
  const dir = (values["dir"] as string | undefined) ?? env[ENV.dir];
  return {
    ...(session === undefined || session.length === 0 ? {} : { session }),
    ...(scope === undefined || scope.length === 0 ? {} : { scope }),
    ...(dir === undefined || dir.length === 0 ? {} : { dir }),
    observer: observer.on,
    unreadable,
  };
}

/**
 * The embedder this server may use, decided by the configuration this process
 * read — the local table, unless the configuration switched it off.
 *
 * It is the ONE thing this entry point adds to the server's powers, and it is
 * used for exactly one call: embedding a deliberate question.
 */
export function questionEmbedder(path = CONFIG_PATH): {
  embedder: LiveEmbedder | null;
  reason: string;
  /** The configuration's `snapshots.dir`, for the store's pre-migration copy. */
  snapshotsDir?: string;
  /** The configuration's `timeZone` (docs/time.md), when it names a real zone. */
  timeZone?: string;
  /** The configuration's `pageWriter.mode`: `off` stops the reflection's page
   *  write too (owner ruling D3 on #256). */
  pageWriterMode?: "session" | "off";
  /** The whole configuration as read (embedder default applied) — what Claude
   *  Desktop's `wake` runs its session start with (2026-09-30). */
  config: AdapterConfig;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Absent is ordinary; unreadable resolves to OBSERVER inside `loadConfig`,
    // and an observer opens no embedder at all.
    raw = undefined;
  }
  const load = loadConfig(raw);
  // THE EMBEDDER DEFAULT (config.ts#resolveEmbedder): the rule the hook and the
  // worker apply, so the server embeds a question with the table they use.
  const config = withEmbedderDefault(load.config);
  return {
    reason: load.reason,
    ...(config.snapshots?.dir === undefined ? {} : { snapshotsDir: config.snapshots.dir }),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    ...(config.pageWriter?.mode === undefined ? {} : { pageWriterMode: config.pageWriter.mode }),
    // `openEmbedder` is the ONE answer to "is there an embedder": the knob is
    // the gate and an observer gets none.
    embedder: openEmbedder(config),
    config,
  };
}

/**
 * CLAUDE DESKTOP'S DOCTOR NOTICE (2026-09-30): the red-only line Claude Code's
 * SessionStart shows the owner (`claude-code/hooks.ts#notice`), for the `wake`
 * tool to carry as a plain line. Built here because the server library may not
 * import `claude-code/`; this entry point already does. Bounded like the
 * hook's (`SESSION_NOTICE_BUDGET_MS`), and never throws — a reading that
 * failed is no line at all.
 */
export function desktopDoctorNotice(input: {
  store: Store;
  config: AdapterConfig;
  configPath: string;
  today: string;
}): string | null {
  try {
    const refusals: Record<string, number> = {};
    for (const [key, value] of input.store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
      const n = Number(value);
      if (n > 0) refusals[key.slice(SPAWN_REFUSAL_PREFIX.length)] = n;
    }
    const startsDate = input.store.getMeta(SPAWN_START_DATE_KEY) ?? null;
    const findings = doctorFindings({
      configPath: input.configPath,
      configReason: null,
      config: input.config,
      dir: input.config.dataDir ?? input.store.dir,
      store: input.store,
      today: input.today,
      refusals,
      starts: { date: startsDate, count: Number(input.store.getMeta(SPAWN_START_COUNT_KEY) ?? "0") },
      budgetMs: SESSION_NOTICE_BUDGET_MS,
      install: installRoute(process.env),
    });
    return noticeMessage(findings);
  } catch {
    return null;
  }
}

/**
 * WHAT A HOOKLESS `wake` CARRIES IN ITS NOTICE SLOT: doctor's red line
 * (`desktopDoctorNotice`) and — when search by meaning is on and cannot run —
 * the same line a Claude Code session start carries
 * (`claude-code/doctor-meaning.ts#wakeMeaningLine`), with this copy's route.
 * Null when neither has anything to say. Never throws. A night's own wake
 * (`night`) carries no meaning line: no person reads it, and the `stopped`
 * line's once-a-day would be spent on nobody. Since U1a it carries the
 * older-windows line too (`claude-code/stale-windows.ts`), between the two.
 */
export function desktopWakeNotice(input: {
  store: Store;
  config: AdapterConfig;
  configPath: string;
  today: string;
  night?: boolean;
  env?: Record<string, string | undefined>;
  /** This server's pid, whose own record is not an older window; absent, this process's. */
  selfPid?: number;
  /** The home Claude Code's records are read under; absent, this process's. */
  home?: string;
  /** The package version on disk now; absent, `sessions.ts#manifestVersionOnDisk`. */
  onDisk?: () => string | null;
}): string | null {
  let meaning: string | null = null;
  let stale: string | null = null;
  let urgent: string | null = null;
  let update: string | null = null;
  try {
    const env = input.env ?? process.env;
    meaning =
      input.night === true
        ? null
        : wakeMeaningLine({ config: input.config, store: input.store, install: installRoute(env), env, today: input.today });
    // OLDER WINDOWS AFTER AN UPGRADE (U1a, `claude-code/stale-windows.ts`):
    // the same once-per-store-version line a Claude Code start carries, above
    // W1's, and never on a night's own wake. A window whose record does not
    // say its route gets both routes' steps: this server is Desktop's (npm),
    // and says nothing about how those windows came (review of #666).
    stale =
      input.night === true
        ? null
        : (staleWindowsLine({ store: input.store, fallback: { route: "either", codeTab: false }, now: Date.now(), selfPid: input.selfPid ?? process.pid })?.line ?? null);
    // UPDATES (U1b, `adapters/update-check.ts`): the same lines a Claude Code
    // start carries, in the same order and under the same cap of three
    // maintenance lines — never on a night's own wake.
    // DESKTOP'S SERVER LIVES AS LONG AS THE APP (review of #672): the version
    // it loaded is not necessarily the one installed now. When the package on
    // disk differs from this process's, its own "was updated" line
    // (`wakeUpdateLine`) is the one to say, and an update line would tell the
    // person to install what they already have: none is said.
    const onDisk = (input.onDisk ?? manifestVersionOnDisk)();
    if (input.night !== true && onDisk === installedVersion()) {
      const lineInput = updateLineInputHere({
        store: input.store,
        configPath: input.configPath,
        config: input.config,
        route: installRoute(env),
        today: input.today,
        env,
        home: input.home ?? homedir(),
      });
      urgent = urgentUpdateLine(lineInput);
      if ([stale, urgent, meaning].filter((l) => l !== null).length < 3) update = updateNoticeLine({ ...lineInput, urgentSaid: urgent !== null });
    }
  } catch {
    meaning = null;
  }
  const lines = [desktopDoctorNotice(input), stale, urgent, meaning, update].filter((l): l is string => l !== null);
  return lines.length === 0 ? null : lines.join("\n");
}

/**
 * Which configuration this server will read, and which rule chose it. Exported
 * and injectable for the same reason `launchOptions` is: the rule is provable
 * without a process on stdin.
 *
 * **The store is NOT decided here.** It still comes from `--dir`, else
 * `COUNTERPARTS_DATA_DIR`, else the default — this file answers "whose embedder
 * knob", which is the other half of the trap QUICKSTART §11.3 names, not the
 * same half.
 */
export function serverConfigChoice(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ConfigChoice {
  return resolveConfigPath(argv, env as Record<string, string | undefined>);
}

/** The sidebar's status file: first written this long after the server starts… */
export const SIDEBAR_START_MS = 3000;
/** …this long after a tool call (one write for a burst of calls)… */
export const SIDEBAR_AFTER_CALL_MS = 1500;
/** …and the log's newest seq is looked at this often (one indexed read). */
export const SIDEBAR_WATCH_MS = 15000;

async function main(): Promise<void> {
  const { unreadable: stanceNotices, ...opts } = launchOptions(process.argv.slice(2), process.env);
  // stderr, never stdout (stdout is the JSON-RPC wire), and BEFORE the config
  // refusals: a stance variable nobody could read changed what this server may
  // do, and the transcript has to say so even on a launch that then refuses for
  // an unrelated reason (scar §2.4 — a path that discards something says what).
  for (const line of stanceNotices) process.stderr.write(`${line}\n`);
  const choice = serverConfigChoice();
  // THE PLUGIN'S PREAMBLE (`adapters/plugin.ts`), only when Claude Code started
  // this process as the Counterparts plugin's server. A live `counterparts`
  // registration from the npm install wins: this one then serves the protocol
  // and no tools, so the model is never offered every memory tool twice. And a
  // machine with no install yet gets one here, the way `counterparts install`
  // makes it — the hook may be racing to do the same, which the lock settles.
  // This process has no channel to the person, so an install it makes leaves
  // a notice instead, and the session's first SessionStart says the line
  // (`plugin.ts#firstRunNoticePath`).
  if (runningAsPlugin(process.env)) {
    const home = homedir();
    const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
    // The directory flavor reads the npm install's marker instead (`npm-live.ts`).
    const wiring = npmWiringForGate({ home, env: process.env, cwd: projectDir, configPath: choice.path, read: { hooks: false } });
    // Where the plugin was loaded from changes only the stood-down words, so it
    // is read only for them (`pluginOrigin` may read Claude Code's plugin record).
    const gate = mcpGate(wiring, home, wiring.mcp.some((m) => m.live) ? pluginOrigin({ home, env: process.env, cwd: projectDir }) : undefined);
    if (gate.standDown) {
      process.stderr.write("[counterparts] plugin server stood down: the npm install's server is registered in this host\n");
      // THE SIDEBAR IS HERE all the same (2026-10-15): a plugin loaded with
      // `--plugin-dir` is in no record the npm processes read, so this server,
      // alive for the session, keeps a marker beside the configuration and the
      // npm side's writers count it (`sidebar-status.ts#pluginPresent`). Only
      // for a configuration this launch may name.
      const stopPresence = (namedConfigRefusal(choice) ?? implicitConfigRefusal(choice)) === null ? keepPluginPresence(choice.path) : null;
      await serveStdio(stoodDownServer(gate.instructions ?? ""), process.stdin, {
        write: (chunk) => {
          process.stdout.write(chunk);
        },
      });
      stopPresence?.();
      return;
    }
    try {
      const first = ensureFirstRun({ choice, env: process.env, home });
      if (first.detail !== undefined) process.stderr.write(`[counterparts] plugin first run ${first.state}: ${first.detail}\n`);
    } catch (err) {
      process.stderr.write(`[counterparts] plugin first run threw: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  // The second refusal is the explicit-dir guard (`config-path.ts#implicitConfigRefusal`):
  // armed, an UNNAMED configuration refuses the launch too — the default one is
  // somebody's configuration and names somebody's store. Never armed on the live host.
  const refusal = namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    // A server told to read a configuration it cannot resolve — relative, or
    // absolute and not there — does not fall back to the default one: on a
    // machine with an install, that default is somebody else's. It refuses
    // to start, loudly, on stderr.
    process.stderr.write(`${refusal}\n`);
    process.exitCode = 1;
    return;
  }
  const { embedder, reason, snapshotsDir, timeZone, pageWriterMode, config } = questionEmbedder(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    process.stderr.write(`${unreadable}\n`);
    process.exitCode = 1;
    return;
  }
  // THE NPM INSTALL SAYS IT IS WIRED (`npm-live.ts`): a reading of the
  // user-level wiring, once per start, for a plugin of the directory flavor
  // beside it. Any non-plugin server's reading is true (the nightly run's,
  // Claude Desktop's), and a build that reads no Claude Code file writes none.
  if (!runningAsPlugin(process.env)) {
    noteNpmLive({ configPath: choice.path, home: homedir(), env: process.env, build: installedVersion(), force: true });
  }
  // stderr, never stdout — stdout is the JSON-RPC wire. This is this entry
  // point's "which file answered": printed at every launch, before a byte of
  // protocol, because a server reading a configuration nobody named is exactly
  // how a scratch run came to embed on the owner's key (2026-09-04).
  process.stderr.write(`[counterparts] config: ${configLine(choice)}\n`);
  // WHICH DIRECTORY, AND WHAT THE HOST WAS TOLD ABOUT IT. The registry sits
  // beside the configuration this launch resolved, so `-e COUNTERPARTS_CONFIG=…`
  // moves both together and a scratch install's scopes are its own.
  //
  // The server still STARTS in a directory set `off`: a server that refused to
  // launch is reported by this host as "MCP server failed", which is a broken
  // tool rather than a directory that asked to be left alone — and the `scope`
  // tool is what turns it back on, so it has to be reachable. Every other tool
  // refuses `scope-off`, per call, from the file as it stands at that moment.
  const scopesFile = scopesPath(choice.path);
  const scopeRead = readScopes(scopesFile);
  // THE SAME RULE THE SERVER ITSELF WILL APPLY, from the same function: the
  // launch's own `--scope`, else `CLAUDE_PROJECT_DIR` — which this host exports
  // to stdio MCP servers and to hooks alike, and which is what makes this
  // server's scope and the hooks' session scope the same string — else this
  // process's working directory. Resolved once, so the registry is consulted
  // about exactly the directory the server goes on to run in.
  const serverScope = hostScope(opts.scope)?.scope ?? process.cwd();
  const scopeVerdict = lookupScope(scopeRead.registry, serverScope);
  // THE SAME SENTENCE THE HOOK PRINTS, from the same function (#92 review, F2).
  // It was written out inline here and covered only a whole-file failure, so a
  // registry whose ENTRIES were refused — one typo'd `off` among good ones —
  // gave the operator nothing at the one moment this process can speak to them.
  const trouble = describeScopeTrouble(scopeRead, scopesFile);
  if (trouble !== null) process.stderr.write(`${trouble}\n`);
  // ONE line at launch when this directory is not an ordinary one — the only
  // channel this process has to the operator, and the difference between a
  // muted server and a broken one (scar §2.4).
  const stance = effectiveStance(opts.observer, scopeVerdict.mode);
  if (stance !== "on" || scopeVerdict.mode !== "unset") {
    process.stderr.write(
      `[counterparts] scope: ${serverScope} is ${scopeVerdict.mode}` +
        `${scopeVerdict.matched === null ? "" : ` (set by ${scopeVerdict.matched})`}` +
        ` — this server runs ${stance}.\n`,
    );
  }
  // THE PROCESS LOG (`adapters/log/`), opened once the store has resolved its
  // own directory; the forwarding closures hand it every event from the start.
  // Off for an observer, and off in a directory set `off`, like the hooks.
  let log: ProcessLog | null = null;
  const toLog = (e: LogEvent): void => log?.event(e);
  const registryObserver = stanceOfMode(scopeVerdict.mode) === "observer";
  const startedByClaudeCode = claudeCodeEnvMarker(process.env) !== null;
  // WHAT CLAUDE DESKTOP'S `wake` RUNS WITH (2026-09-30). Nothing here decides
  // the host: a Desktop client says who it is at `initialize`, and a Claude
  // Code client — Desktop's Code tab included, off this same config entry —
  // never touches any of it. Handed in so the server library imports no
  // other adapter: the configuration this process read, the worker's command,
  // and the doctor's notice, which lives in `claude-code/`.
  const launch = opts;
  // THE SIDEBAR'S STATUS FILE (2026-10-14, `adapters/sidebar-status.ts`):
  // armed below once the store is open; a tool call only schedules a write.
  let sidebar: SidebarStatusWriter | null = null;
  const server = openServer({
    ...launch,
    onEvent: toLog,
    afterCall: () => sidebar?.schedule(SIDEBAR_AFTER_CALL_MS),
    onCounterpartEvent: toLog,
    // THE COMBINATION, most restrictive wins: a registry that says `observer`
    // stands the server down even when the configuration did not, and a
    // configuration that already said so is never relaxed by a registry.
    //
    // `off` deliberately does NOT set the observer bit. Under observer every
    // tool stands down INCLUDING `scope`'s write, and `scope` is the one door
    // that has to keep working in an off directory or the switch only turns one
    // way. Nothing is at risk: every other tool refuses `scope-off` one layer
    // above, per call, before it can reach a store.
    //
    // THE REGISTRY'S `observer` IS BAKED INTO THE STORE ONLY WHEN CLAUDE CODE
    // STARTED THIS PROCESS (review of #294, finding 2): its environment then
    // names the project, and the cwd verdict is that project's. Otherwise the
    // client may be Claude Desktop, whose place is `claude-desktop:` and not
    // the directory the app started the server in — so the store opens as a
    // writer and the server applies the launch directory's `observer` itself,
    // per call, to any client but Desktop's (`McpServerOptions.launchObserver`).
    observer: opts.observer || (registryObserver && startedByClaudeCode),
    ...(registryObserver && !startedByClaudeCode && !opts.observer ? { launchObserver: true } : {}),
    scopesFile,
    // The console line a scope refusal names: the plugin's launcher when this
    // is the plugin's server, `--config` when this registry is not the default.
    scopeCommand: scopeCommandContext({
      configPath: choice.path,
      pluginRoot: runningAsPlugin(process.env) ? (process.env[PLUGIN_ROOT_ENV] ?? null) : null,
      home: homedir(),
    }),
    // How this copy came, for the first meeting's "how to remove it" (2026-10-11).
    install: installRoute(process.env),
    embedder,
    ...(snapshotsDir === undefined ? {} : { snapshotsDir }),
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(pageWriterMode === undefined ? {} : { pageWriterMode }),
    lifecycle: {
      config,
      configPath: choice.path,
      command: process.execPath,
      args: scriptArgs(WORKER_RUNNER_PATH),
    },
    // Called only from a `wake`, long after `server` below is assigned.
    // Doctor's red line, and the line for search by meaning that cannot run
    // (2026-10-27, W1), each when it has something to say.
    wakeNotice: ({ night }) => {
      const store = server.counterpart.store;
      return desktopWakeNotice({
        store,
        config,
        configPath: choice.path,
        today: localDate(Date.now(), store.zone()),
        night,
      });
    },
  });
  // THE BUILD THIS PROCESS WILL KEEP FOR THE REST OF THE SESSION, left where
  // the hooks can compare it with the installed one every turn
  // (`server.ts#recordLaunch`). Taken away again at a clean exit; a server the
  // host kills outright leaves a record that reads as dead and is pruned.
  server.recordLaunch();
  const opened = openLog({
    dataDir: server.counterpart.store.dir,
    proc: "mcp",
    session: () => server.session,
    ...(timeZone === undefined ? {} : { timeZone }),
    observer: server.observer || stance === "off",
  });
  log = opened;
  opened.start({ boundSession: server.launchedSession !== null });
  // What the Claude Code sidebar shows, written beside the configuration: a
  // few seconds after this server starts (a session's start, off the
  // SessionStart hook's path), a moment after each tool call, and whenever the
  // log moved under it (a turn's recall, another session, the night). Never
  // for an observer or in a directory set `off`, and never on a call's path.
  // Only where the sidebar is installed (the plugin): elsewhere an old file goes.
  // Asked again at each write: a plugin loaded from a folder says it is here
  // (`sidebar-status.ts#pluginPresent`) a moment after this server starts.
  // Where a writer is armed it decides at its first write (a few seconds on, time for the plugin's marker to land).
  const sidebarWanted = (): boolean => sidebarInstalled(process.env, homedir(), choice.path);
  const sidebarArmed = !server.observer && stance !== "off";
  if (!sidebarArmed && !sidebarWanted()) removeSidebarStatus(choice.path);
  if (sidebarArmed) {
    const store = server.counterpart.store;
    sidebar = new SidebarStatusWriter({
      configPath: choice.path,
      dataDir: store.dir,
      ...(timeZone === undefined ? {} : { timeZone }),
      wanted: sidebarWanted,
      newestSeq: () => store.eventLog({ order: "desc", limit: 1 })[0]?.seq ?? null,
      onWrite: (w) => toLog({ name: "mcp.sidebar", data: { written: w.written, reason: w.reason, bytes: w.bytes, ms: w.ms } }),
    });
    sidebar.schedule(SIDEBAR_START_MS);
    sidebar.watch(SIDEBAR_WATCH_MS);
  }
  try {
    await serveStdio(server, process.stdin, {
      write: (chunk) => {
        process.stdout.write(chunk);
      },
    });
    opened.end("stdin-closed");
  } catch (err) {
    opened.threw(err);
    throw err;
  } finally {
    sidebar?.stop();
    server.forgetLaunch();
    server.counterpart.close();
  }
}

/** True only when this file is the process entry point — so a test may import
 *  `launchOptions` without the server starting itself on stdin. */
export function isEntryPoint(argv1: string | undefined, url: string, binary: Binary | null = BINARY): boolean {
  // Never in the single binary, where every module shares one URL: its
  // dispatcher (tools/single-binary/main.ts) calls `start()` itself.
  if (argv1 === undefined || binary !== null) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

/** Run the server until stdin closes — what this file does as a script, and
 *  what the single binary's `mcp` mode calls. */
export function start(): void {
  usePrivateUmask();
  void main().then(
    // `process.exitCode` is 1 when the launch refused a named configuration it
    // could not honour; every other path ends 0.
    () => process.exit(process.exitCode === 1 ? 1 : 0),
    (err: unknown) => {
      // A server that cannot start SAYS why, on stderr (stdout is the wire).
      // Before this line, the gap between the two guards — a named configuration
      // that names no store, no `--dir`, no variable — was a bare exit 1 that
      // the host reports as "MCP server failed" and nothing else (#80 review).
      // The explicit-dir guard gets a sentence with THIS entry point's remedy;
      // any other failure gets its own message.
      const detail = err instanceof Error ? err.message : String(err);
      const remedy = `Name the store: --dir <path>, or ${DATA_DIR_ENV}.`;
      process.stderr.write(
        `${describeGuardRefusal(err, remedy) ?? `[counterparts] server did not start: ${detail}`}\n`,
      );
      process.exit(1);
    },
  );
}

if (isEntryPoint(process.argv[1], import.meta.url)) start();
