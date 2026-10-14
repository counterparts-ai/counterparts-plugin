#!/usr/bin/env -S bun --no-env-file --config=/dev/null --no-install
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
  resolveConfigPath
} from "../../config-path.js";
import {
  describeScopeTrouble,
  effectiveStance,
  lookupScope,
  readScopes,
  scopeCommandContext,
  scopesPath,
  stanceOfMode
} from "../../scopes.js";
import { loadConfig, withEmbedderDefault } from "../../config.js";
import { openEmbedder } from "../../claude-code/embed-client.js";
import { SESSION_NOTICE_BUDGET_MS, doctorFindings, noticeMessage } from "../../claude-code/doctor.js";
import { SPAWN_REFUSAL_PREFIX, SPAWN_START_COUNT_KEY, SPAWN_START_DATE_KEY } from "../../lifecycle.js";
import { WORKER_RUNNER_PATH } from "../../spawn.js";
import { claudeCodeEnvMarker } from "../../hosts.js";
import { localDate } from "../../../core/time.js";
import { hostScope, openServer } from "../index.js";
import { openLog } from "../../log/index.js";
import { serveStdio } from "../stdio.js";
import { stoodDownServer } from "../stood-down.js";
import { npmWiring } from "../../host-wiring.js";
import { PLUGIN_ROOT_ENV, ensureFirstRun, installRoute, mcpGate, pluginOrigin, runningAsPlugin } from "../../plugin.js";
import { DATA_DIR_ENV, describeGuardRefusal } from "../../../core/store/index.js";
import { BINARY, scriptArgs } from "../../runtime.js";
import {
  OBSERVER_ENV,
  OWNER_ENV,
  observerFromEnv,
  ownerFromEnv,
  readEnvSwitch,
  unreadableStanceLine
} from "../../stance-env.js";
export const CONFIG_PATH = defaultConfigPath();
export const ENV = {
  session: "COUNTERPARTS_SESSION",
  scope: "COUNTERPARTS_SCOPE",
  dir: "COUNTERPARTS_DATA_DIR",
  owner: OWNER_ENV,
  observer: OBSERVER_ENV
};
export function launchOptions(argv, env) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      session: { type: "string" },
      scope: { type: "string" },
      dir: { type: "string" },
      owner: { type: "boolean" },
      observer: { type: "boolean" },
      config: { type: "string" }
    },
    strict: false
  });
  const observer = observerFromEnv(env, values["observer"] === true, ENV.observer);
  const owner = ownerFromEnv(env, values["owner"] === true, ENV.owner);
  const unreadable = [];
  if (observer.malformed !== null) {
    unreadable.push(unreadableStanceLine(ENV.observer, observer.malformed, "standing down to observer stance"));
  }
  if (owner.malformed !== null) {
    unreadable.push(unreadableStanceLine(ENV.owner, owner.malformed, "this launch is NOT owner-stanced"));
  }
  const ownerSaid = values["owner"] === true ? "flag" : readEnvSwitch(env, ENV.owner).state === "absent" ? "unset" : "env";
  const session = values["session"] ?? env[ENV.session];
  const scope = values["scope"] ?? env[ENV.scope];
  const dir = values["dir"] ?? env[ENV.dir];
  return {
    ...session === undefined || session.length === 0 ? {} : { session },
    ...scope === undefined || scope.length === 0 ? {} : { scope },
    ...dir === undefined || dir.length === 0 ? {} : { dir },
    owner: owner.on,
    ownerSaid,
    observer: observer.on,
    unreadable
  };
}
export function ownerStance(launch, config, startedByClaudeCode) {
  if (launch.ownerSaid !== "unset")
    return { owner: launch.owner, ownerFrom: launch.owner ? "env" : "off", codeTabOwner: false };
  const byConfig = config.owner === true && config.observer !== true;
  const owner = byConfig && startedByClaudeCode;
  return { owner, ownerFrom: owner ? "config" : "default", codeTabOwner: byConfig };
}
export function questionEmbedder(path = CONFIG_PATH) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    raw = undefined;
  }
  const load = loadConfig(raw);
  const config = withEmbedderDefault(load.config);
  return {
    reason: load.reason,
    ...config.snapshots?.dir === undefined ? {} : { snapshotsDir: config.snapshots.dir },
    ...config.timeZone === undefined ? {} : { timeZone: config.timeZone },
    ...config.pageWriter?.mode === undefined ? {} : { pageWriterMode: config.pageWriter.mode },
    embedder: openEmbedder(config),
    config
  };
}
export function desktopDoctorNotice(input) {
  try {
    const refusals = {};
    for (const [key, value] of input.store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
      const n = Number(value);
      if (n > 0)
        refusals[key.slice(SPAWN_REFUSAL_PREFIX.length)] = n;
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
      install: installRoute(process.env)
    });
    return noticeMessage(findings);
  } catch {
    return null;
  }
}
export function serverConfigChoice(argv = process.argv.slice(2), env = process.env) {
  return resolveConfigPath(argv, env);
}
async function main() {
  const { unreadable: stanceNotices, ...opts } = launchOptions(process.argv.slice(2), process.env);
  for (const line of stanceNotices)
    process.stderr.write(`${line}
`);
  const choice = serverConfigChoice();
  if (runningAsPlugin(process.env)) {
    const home = homedir();
    const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
    const gate = mcpGate(npmWiring({ home, env: process.env, cwd: projectDir, read: { hooks: false } }), home, pluginOrigin({ home, env: process.env, cwd: projectDir }));
    if (gate.standDown) {
      process.stderr.write(`[counterparts] plugin server stood down: the npm install's server is registered in this host
`);
      await serveStdio(stoodDownServer(gate.instructions ?? ""), process.stdin, {
        write: (chunk) => {
          process.stdout.write(chunk);
        }
      });
      return;
    }
    try {
      const first = ensureFirstRun({ choice, env: process.env, home });
      if (first.detail !== undefined)
        process.stderr.write(`[counterparts] plugin first run ${first.state}: ${first.detail}
`);
    } catch (err) {
      process.stderr.write(`[counterparts] plugin first run threw: ${err instanceof Error ? err.message : String(err)}
`);
    }
  }
  const refusal = namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    process.stderr.write(`${refusal}
`);
    process.exitCode = 1;
    return;
  }
  const { embedder, reason, snapshotsDir, timeZone, pageWriterMode, config } = questionEmbedder(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    process.stderr.write(`${unreadable}
`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`[counterparts] config: ${configLine(choice)}
`);
  const scopesFile = scopesPath(choice.path);
  const scopeRead = readScopes(scopesFile);
  const serverScope = hostScope(opts.scope)?.scope ?? process.cwd();
  const scopeVerdict = lookupScope(scopeRead.registry, serverScope);
  const trouble = describeScopeTrouble(scopeRead, scopesFile);
  if (trouble !== null)
    process.stderr.write(`${trouble}
`);
  const stance = effectiveStance(opts.observer, scopeVerdict.mode);
  if (stance !== "on" || scopeVerdict.mode !== "unset") {
    process.stderr.write(`[counterparts] scope: ${serverScope} is ${scopeVerdict.mode}` + `${scopeVerdict.matched === null ? "" : ` (set by ${scopeVerdict.matched})`}` + ` — this server runs ${stance}.
`);
  }
  let log = null;
  const toLog = (e) => log?.event(e);
  const registryObserver = stanceOfMode(scopeVerdict.mode) === "observer";
  const startedByClaudeCode = claudeCodeEnvMarker(process.env) !== null;
  const { ownerSaid, ...launch } = opts;
  const ownerSays = ownerStance({ owner: launch.owner, ownerSaid }, config, startedByClaudeCode);
  const server = openServer({
    ...launch,
    ...ownerSays,
    onEvent: toLog,
    onCounterpartEvent: toLog,
    observer: opts.observer || registryObserver && startedByClaudeCode,
    ...registryObserver && !startedByClaudeCode && !opts.observer ? { launchObserver: true } : {},
    scopesFile,
    scopeCommand: scopeCommandContext({
      configPath: choice.path,
      pluginRoot: runningAsPlugin(process.env) ? process.env[PLUGIN_ROOT_ENV] ?? null : null,
      home: homedir()
    }),
    install: installRoute(process.env),
    embedder,
    ...snapshotsDir === undefined ? {} : { snapshotsDir },
    ...timeZone === undefined ? {} : { timeZone },
    ...pageWriterMode === undefined ? {} : { pageWriterMode },
    lifecycle: {
      config,
      configPath: choice.path,
      command: process.execPath,
      args: scriptArgs(WORKER_RUNNER_PATH)
    },
    wakeNotice: () => {
      const store = server.counterpart.store;
      return desktopDoctorNotice({
        store,
        config,
        configPath: choice.path,
        today: localDate(Date.now(), store.zone())
      });
    }
  });
  server.recordLaunch();
  const opened = openLog({
    dataDir: server.counterpart.store.dir,
    proc: "mcp",
    session: () => server.session,
    ...timeZone === undefined ? {} : { timeZone },
    observer: server.observer || stance === "off"
  });
  log = opened;
  opened.start({ boundSession: server.launchedSession !== null });
  try {
    await serveStdio(server, process.stdin, {
      write: (chunk) => {
        process.stdout.write(chunk);
      }
    });
    opened.end("stdin-closed");
  } catch (err) {
    opened.threw(err);
    throw err;
  } finally {
    server.forgetLaunch();
    server.counterpart.close();
  }
}
export function isEntryPoint(argv1, url, binary = BINARY) {
  if (argv1 === undefined || binary !== null)
    return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}
export function start() {
  main().then(() => process.exit(process.exitCode === 1 ? 1 : 0), (err) => {
    const detail = err instanceof Error ? err.message : String(err);
    const remedy = `Name the store: --dir <path>, or ${DATA_DIR_ENV}.`;
    process.stderr.write(`${describeGuardRefusal(err, remedy) ?? `[counterparts] server did not start: ${detail}`}
`);
    process.exit(1);
  });
}
if (isEntryPoint(process.argv[1], import.meta.url))
  start();
