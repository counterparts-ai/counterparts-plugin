#!/usr/bin/env -S bun --no-env-file --config=/dev/null --no-install
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR_ENV, dataDir, describeGuardRefusal } from "../../../core/store/index.js";
import {
  defaultConfigPath,
  implicitConfigRefusal,
  namedConfigRefusal,
  namedUnreadableRefusal,
  resolveConfigPath
} from "../../config-path.js";
import {
  canonicalScopePath,
  describeScopeTrouble,
  lookupScope,
  mostRestrictiveVerdict,
  readScopes,
  scopeCommand,
  scopeCommandContext,
  scopesPath,
  shortPath,
  stanceOfMode
} from "../../scopes.js";
import { canonicalScope, isEntrypoint, readSession } from "../../sessions.js";
import { openLog } from "../../log/index.js";
import { resolveZone, todayIn } from "../../../core/time.js";
import { TUNABLES, loadConfig, withBudgetDefault, withEmbedderDefault } from "../../config.js";
import { HOOKS, openAdapter } from "../index.js";
import { STOP_HUMAN_LINE, plainLine, withoutDream, withoutDreamNote, withoutPlain } from "../hooks.js";
import { NIGHT_RUN_ENV } from "../night-run.js";
import {
  CONFIG_REFUSED,
  CONFIG_UNREADABLE,
  classifyStandDown,
  decideSay,
  readMark,
  writeMark
} from "../standdown.js";
import { readTranscript } from "../transcript.js";
import { BINARY, entryScript, scriptArgs } from "../../runtime.js";
import { npmWiring } from "../../host-wiring.js";
import {
  PLUGIN_ROOT_ENV,
  ensureFirstRun,
  firstRunLine,
  firstRunNoticePath,
  hookGate,
  installRoute,
  markTwiceSaid,
  pluginOrigin,
  runningAsPlugin,
  takeFirstRunNotice,
  twiceNoticePath
} from "../../plugin.js";
import { claimDelivery, deliveryClaimKey, finishClaim, firesOnce } from "../claim.js";
import { HOST_SESSION_START, HOST_USER_PROMPT_SUBMIT, envelopeJson } from "../envelope.js";
export { HOST_SESSION_START, HOST_USER_PROMPT_SUBMIT } from "../envelope.js";
function fieldsFit(context, message) {
  return context.length <= TUNABLES.HOST_OUTPUT_CHARS && message.length <= TUNABLES.HOST_OUTPUT_CHARS;
}
export const HOST_STOP = "Stop";
const HOST_HOOKS = {
  [HOST_SESSION_START]: "session-start",
  [HOST_USER_PROMPT_SUBMIT]: "user-prompt-submit",
  [HOST_STOP]: "stop",
  SessionEnd: "session-end",
  PreCompact: "pre-compact"
};
export const CONFIG_PATH = defaultConfigPath();
export const RUNNER_PATH = entryScript(new URL("./runner.ts", import.meta.url));
export const NIGHTLY_PATH = entryScript(new URL("./nightly.ts", import.meta.url));
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
export function hostConfig(path = CONFIG_PATH) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    raw = undefined;
  }
  const load = loadConfig(raw);
  const loaded = load.config;
  return {
    config: withBudgetDefault(withEmbedderDefault({ ...loaded, dataDir: loaded.dataDir ?? dataDir() })),
    reason: load.reason
  };
}
export function hookConfigChoice(argv = process.argv.slice(2), env = process.env) {
  return resolveConfigPath(argv, env);
}
export function eventDirectory(payload, env = process.env) {
  if (typeof payload["cwd"] === "string" && payload["cwd"].length > 0) {
    return resolve(payload["cwd"]);
  }
  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof projectDir === "string" && projectDir.length > 0)
    return resolve(projectDir);
  return process.cwd();
}
export const FRESH_SESSION_SOURCES = ["startup", "resume", "clear", "fork"];
export function sessionScope(dataDir, payload, env = process.env) {
  const sessionId = typeof payload["session_id"] === "string" ? payload["session_id"] : "";
  if (dataDir !== undefined && dataDir.length > 0 && sessionId.length > 0 && !opensASession(payload)) {
    const recorded = readSession(dataDir, sessionId)?.scope;
    if (recorded !== undefined && recorded.length > 0)
      return canonicalScope(recorded);
  }
  return startDirectory(payload, env);
}
function opensASession(payload) {
  if (payload["hook_event_name"] !== HOST_SESSION_START)
    return false;
  const source = payload["source"];
  return typeof source === "string" && FRESH_SESSION_SOURCES.includes(source);
}
export function startDirectory(payload, env = process.env) {
  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof projectDir === "string" && projectDir.length > 0)
    return canonicalScope(projectDir);
  if (typeof payload["cwd"] === "string" && payload["cwd"].length > 0) {
    return canonicalScope(payload["cwd"]);
  }
  return canonicalScope(process.cwd());
}
export function hookScopeVerdict(configPath, ...scopes) {
  const read = readScopes(scopesPath(configPath));
  return { verdict: verdictOver(read, scopes), read };
}
function verdictOver(read, scopes) {
  let verdict = { mode: "unset", matched: null, entry: null };
  let first = true;
  for (const dir of scopes) {
    const one = lookupScope(read.registry, dir);
    verdict = first ? one : mostRestrictiveVerdict(verdict, one);
    first = false;
  }
  return verdict;
}
export function pausedNotice(verdict, here, opts) {
  if (verdict.mode !== "paused" || verdict.matched === null)
    return null;
  const entry = canonicalScopePath(verdict.matched);
  const own = opts.whose === "folder" && entry === canonicalScopePath(here);
  const named = shortPath(entry, opts.home);
  const where = own ? `in ${named}` : opts.whose === "folder" ? `for ${named}, which includes this folder` : `for ${named}, which covers this session`;
  const command = scopeCommand(entry, "--resume", {
    home: opts.home,
    pluginRoot: opts.pluginRoot,
    configPath: opts.configPath ?? null
  });
  return {
    person: `Counterparts memory is paused ${where}; \`${command}\` turns it back on.`,
    model: `Counterparts memory is paused ${where}: no memories are loaded and nothing said here is remembered ` + `until the person resumes it (\`${command}\`). Don't act as if you remember earlier sessions.`
  };
}
export function hookScopeContext(configPath, env = process.env) {
  return scopeCommandContext({
    configPath,
    pluginRoot: runningAsPlugin(env) ? env[PLUGIN_ROOT_ENV] ?? null : null,
    home: homedir()
  });
}
function sayPaused(name, verdict, here, whose, payload, said, configPath) {
  if (name !== "session-start")
    return;
  if ((process.env[NIGHT_RUN_ENV] ?? "").trim().length > 0)
    return;
  const notice = pausedNotice(verdict, here, { whose, ...hookScopeContext(configPath) });
  if (notice === null)
    return;
  const delivery = hostDelivery(name, { injection: notice.model, ask: null }, payload, [notice.person]);
  process.stdout.write(delivery.stdout);
  said.wroteStdout = true;
}
export function toHookInput(payload, opts = {}) {
  const scope = opts.scope ?? sessionScope(opts.dataDir, payload, opts.env ?? process.env);
  const transcriptPath = typeof payload["transcript_path"] === "string" && payload["transcript_path"].length > 0 ? payload["transcript_path"] : undefined;
  const transcript = readTranscript(transcriptPath);
  return {
    sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
    scope,
    turns: transcript.turns,
    expansions: transcript.expansions,
    ...transcriptPath !== undefined && !transcript.ok ? { turnsUnread: true } : {},
    ...transcriptPath === undefined ? {} : { transcriptPath },
    ...transcript.model === undefined ? {} : { model: transcript.model },
    ...payload["stop_hook_active"] === true ? { reFired: true } : {},
    ...typeof payload["prompt"] === "string" ? { prompt: payload["prompt"] } : {},
    ...typeof payload["source"] === "string" && payload["source"].length > 0 ? { source: payload["source"] } : {},
    ...((opts.env ?? process.env)[NIGHT_RUN_ENV] ?? "").trim().length > 0 ? { nightRun: true } : {},
    ...isEntrypoint((opts.env ?? process.env)["CLAUDE_CODE_ENTRYPOINT"]) ? { entrypoint: (opts.env ?? process.env)["CLAUDE_CODE_ENTRYPOINT"] } : {},
    ...attendedOf((opts.env ?? process.env)["CLAUDE_CODE_SESSION_ATTENDED"]),
    at: todayIn(resolveZone(opts.timeZone))
  };
}
const SAYS_SO_HOOKS = ["session-start", "user-prompt-submit"];
function saysSo(hook) {
  return SAYS_SO_HOOKS.includes(hook);
}
export function reachesTheOwner(said) {
  if (said.didWork)
    return false;
  if (said.wroteStdout)
    return false;
  return saysSo(said.hook);
}
function standDown(said, what) {
  process.stderr.write(`[counterparts] hook stood down: ${what.line}
`);
  const fault = what.fault;
  if (fault === null)
    return;
  if (!reachesTheOwner(said))
    return;
  const dataDir = what.marker ? said.dataDir : undefined;
  const decision = decideSay(fault, said.hook, said.sessionId, readMark(dataDir, said.sessionId));
  writeMark(dataDir, said.sessionId, decision.mark);
  if (decision.message === null)
    return;
  process.stdout.write(JSON.stringify({ systemMessage: decision.message }));
  said.wroteStdout = true;
}
function refusalReason(sentence) {
  const opener = "refused: ";
  return sentence.startsWith(opener) ? sentence.slice(opener.length) : sentence;
}
async function main() {
  let payload = {};
  try {
    const text = await readStdin();
    if (text.trim().length > 0)
      payload = JSON.parse(text);
  } catch {}
  const name = HOST_HOOKS[String(payload["hook_event_name"] ?? "")];
  if (name === undefined || !HOOKS.includes(name))
    return;
  const choice = hookConfigChoice();
  const said = {
    hook: name,
    sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
    dataDir: undefined,
    wroteStdout: false,
    didWork: false
  };
  const pluginLines = [];
  if (runningAsPlugin(process.env)) {
    const home = homedir();
    const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? eventDirectory(payload);
    const gate = hookGate(npmWiring({ home, env: process.env, cwd: projectDir, read: { mcp: false } }), home, name === "session-start" ? pluginOrigin({ home, env: process.env, cwd: projectDir }) : undefined);
    if (gate.standDown) {
      process.stderr.write(`[counterparts] plugin hook stood down: the npm install's hooks are live in this host
`);
      if (name === "session-start") {
        takeFirstRunNotice(firstRunNoticePath(choice.path));
        if (gate.line !== null && markTwiceSaid(twiceNoticePath(choice.path, process.env))) {
          process.stdout.write(JSON.stringify({ systemMessage: gate.line }));
        }
      }
      return;
    }
    if (gate.line !== null)
      pluginLines.push(gate.line);
    try {
      const first = ensureFirstRun({ choice, env: process.env, home });
      if (first.detail !== undefined)
        process.stderr.write(`[counterparts] plugin first run ${first.state}: ${first.detail}
`);
      if (first.line !== null)
        pluginLines.push(first.line);
      if (name === "session-start" && first.line === null && (first.state === "created" || first.state === "joined" || first.state === "existed") && takeFirstRunNotice(firstRunNoticePath(choice.path))) {
        pluginLines.push(firstRunLine(choice.path, home));
      }
    } catch (err) {
      process.stderr.write(`[counterparts] plugin first run threw: ${err instanceof Error ? err.message : String(err)}
`);
    }
  }
  try {
    await runHook(name, payload, choice, said, pluginLines);
  } catch (err) {
    process.exitCode = 0;
    said.log?.threw(err);
    const detail = err instanceof Error ? err.message : String(err);
    const remedy = `Set "dataDir" in ${choice.path}, or set ${DATA_DIR_ENV}.`;
    standDown(said, {
      line: describeGuardRefusal(err, remedy) ?? detail,
      fault: classifyStandDown(err),
      marker: true
    });
  }
}
async function runHook(name, payload, choice, said, pluginLines = []) {
  const named = namedConfigRefusal(choice);
  const refusal = named ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    standDown(said, {
      line: refusal,
      fault: named === null ? null : { code: CONFIG_REFUSED, reason: refusalReason(named), kind: "persistent" },
      marker: false
    });
    return;
  }
  const eventDir = eventDirectory(payload);
  const { verdict: eventVerdict, read } = hookScopeVerdict(choice.path, eventDir);
  if (stanceOfMode(eventVerdict.mode) === "off") {
    const sessionOff = name === "session-start" && eventVerdict.mode === "paused" && lookupScope(read.registry, startDirectory(payload)).mode === "off";
    if (!sessionOff)
      sayPaused(name, eventVerdict, eventDir, "folder", payload, said, choice.path);
    return;
  }
  const trouble = name === "session-start" ? describeScopeTrouble(read, scopesPath(choice.path)) : null;
  if (trouble !== null)
    process.stderr.write(`${trouble}
`);
  const { config: loaded, reason } = hostConfig(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    standDown(said, {
      line: unreadable,
      fault: { code: CONFIG_UNREADABLE, reason: refusalReason(unreadable), kind: "persistent" },
      marker: false
    });
    return;
  }
  said.dataDir = loaded.dataDir;
  const scope = sessionScope(loaded.dataDir, payload);
  const verdict = mostRestrictiveVerdict(lookupScope(read.registry, scope), eventVerdict);
  if (stanceOfMode(verdict.mode) === "off") {
    sayPaused(name, verdict, scope, "session", payload, said, choice.path);
    return;
  }
  const config = verdict.mode === "observer" ? { ...loaded, observer: true } : loaded;
  let log = null;
  const toLog = (e) => log?.event(e);
  const adapter = openAdapter(config, {
    command: process.execPath,
    args: scriptArgs(RUNNER_PATH),
    nightArgs: scriptArgs(NIGHTLY_PATH),
    configPath: choice.path,
    scopeCommand: hookScopeContext(choice.path),
    install: installRoute(process.env),
    scope: verdict,
    ...read.error === null ? {} : { scopeUnreadable: read.error },
    ...read.refused.length === 0 ? {} : { scopeRefused: read.refused.map((r) => r.key) },
    onEvent: toLog,
    onCounterpartEvent: toLog
  });
  const opened = openLog({
    dataDir: adapter.counterpart.store.dir,
    proc: `hook:${name}`,
    session: said.sessionId,
    ...config.timeZone === undefined ? {} : { timeZone: config.timeZone },
    observer: config.observer === true
  });
  log = opened;
  said.log = opened;
  if (name !== "user-prompt-submit")
    opened.start();
  const claimKey = deliveryClaimKey(name, payload);
  const claim = claimDelivery(adapter.counterpart, {
    hook: name,
    key: claimKey,
    sessionId: said.sessionId,
    side: runningAsPlugin(process.env) ? "plugin" : "settings",
    observer: config.observer === true,
    once: firesOnce(name, payload)
  });
  if (claim.setAside !== undefined) {
    process.stderr.write(`[counterparts] ${name}: the claims file could not be read; set aside as ${claim.setAside} and made again
`);
  }
  if (claim.outcome === "lost") {
    process.stderr.write(`[counterparts] ${name} stood down by claim: another Counterparts hook (${claim.heldBy ?? "?"}) already took this event — two wirings are live in this host
`);
    try {
      adapter.counterpart.close();
    } finally {
      opened.end("claimed-elsewhere", { heldBy: claim.heldBy ?? null });
    }
    return;
  }
  const unclaimed = claim.outcome === "unclaimed" && claim.detail !== undefined && claim.detail !== "no session id" && claim.detail !== "observer" ? claim.detail : null;
  if (unclaimed !== null && claim.busy !== true) {
    process.stderr.write(`[counterparts] ${name} delivered unclaimed: ${unclaimed}
`);
  }
  let outcome = "ok";
  try {
    const input = toHookInput(payload, {
      scope,
      ...loaded.timeZone === undefined ? {} : { timeZone: loaded.timeZone }
    });
    const result = adapter.hook(name, input);
    outcome = result.reason;
    said.didWork = true;
    const delivery = deliverTurn(name, result, payload, name === "session-start" ? [adapter.notice(input), ...pluginLines, trouble] : null, adapter, input);
    if (delivery.stdout.length > 0) {
      process.stdout.write(delivery.stdout);
      said.wroteStdout = true;
    }
    if (delivery.stderr.length > 0)
      process.stderr.write(delivery.stderr);
    process.exitCode = delivery.exitCode;
    stampWhenOpened(payload, () => adapter.stampOpened(input));
    if (delivery.dropped !== null)
      adapter.noteNoticeDropped(delivery.dropped);
    if (delivery.overCap !== undefined) {
      adapter.noteOverCap(delivery.overCap);
      process.stderr.write(`[counterparts] adapter.envelope.overcap: ${JSON.stringify(delivery.overCap)}
`);
    }
    if (name === "user-prompt-submit") {
      for (const e of [...adapter.events("adapter.update.notice"), ...adapter.events("adapter.notice.dropped")]) {
        process.stderr.write(`[counterparts] ${e.name}: ${JSON.stringify(e.data)}
`);
      }
    }
  } finally {
    if (claim.outcome === "won" && claimKey !== null && claim.at !== undefined) {
      finishClaim(adapter.counterpart, claimKey, claim.at, Date.now(), claim.token);
    }
    adapter.counterpart.close();
  }
  opened.end(outcome, {
    ...unclaimed === null ? {} : { unclaimed: claim.code ?? "unknown", busy: claim.busy === true },
    ...claim.setAside === undefined ? {} : { claimsSetAside: true }
  });
}
export function attendedOf(raw) {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "1" || v === "true")
    return { attended: true };
  if (v === "0" || v === "false")
    return { attended: false };
  return {};
}
export function deliverTurn(name, result, payload, notices, doors, input) {
  let r = result;
  let ordered = notices;
  let deferred = null;
  const due = result.plain ?? [];
  if (due.length > 0) {
    let fits = 0;
    for (let k = due.length;k > 0; k--) {
      const probe = hostDelivery(name, r, payload, [due.slice(0, k).map(plainLine).join(`
`)]);
      if (probe.dropped === null) {
        fits = k;
        break;
      }
      if (k === due.length)
        deferred = probe.dropped;
    }
    let claimed = [];
    if (fits > 0) {
      try {
        claimed = doors.claimPlain?.(input, due.slice(0, fits)) ?? [];
      } catch {
        claimed = [];
      }
    }
    const beat = (x) => `${x.memoryId} ${x.windowKey} ${x.beat}`;
    const kept = new Set(claimed.map(beat));
    const shownPlain = due.filter((d) => kept.has(beat(d)));
    if (fits < due.length)
      gaveWay(doors, input, "plain", due.length - fits);
    r = withoutPlain(r, due.filter((d) => !kept.has(beat(d))));
    if (shownPlain.length > 0)
      ordered = [shownPlain.map(plainLine).join(`
`), ...notices ?? []];
  }
  const told = r.dream;
  if (told !== undefined) {
    const probe = hostDelivery(name, r, payload, [...ordered ?? [], told.notice]);
    let showDream = false;
    if (probe.dropped === null) {
      if (told.held !== undefined) {
        try {
          showDream = doors.claimHeld?.(input, told.held) ?? false;
        } catch {
          showDream = false;
        }
      } else if (told.offer === null)
        showDream = true;
      else {
        try {
          showDream = doors.claimDream?.(input, told.offer) ?? false;
        } catch {
          showDream = false;
        }
      }
    } else {
      if (deferred === null)
        deferred = probe.dropped;
      gaveWay(doors, input, "dream", 1);
    }
    if (showDream)
      ordered = [...ordered ?? [], told.notice];
    else if (told.offer !== null || told.held !== undefined)
      r = withoutDream(r);
  }
  const note = r.dreamNote;
  if (note !== undefined) {
    const probe = hostDelivery(name, r, payload, [...ordered ?? [], note.notice]);
    let shownNote = false;
    if (probe.dropped === null) {
      try {
        shownNote = doors.claimDreamNote?.(input) ?? false;
      } catch {
        shownNote = false;
      }
    } else if (deferred === null) {
      deferred = probe.dropped;
    }
    if (shownNote)
      ordered = [...ordered ?? [], note.notice];
    else
      r = withoutDreamNote(r);
  }
  const shown = hostDelivery(name, r, payload, ordered);
  const base = shown.dropped === null && deferred !== null ? { ...shown, dropped: deferred } : shown;
  if (name !== "user-prompt-submit")
    return base;
  try {
    const update = doors.updateNotice(input);
    if (update === null)
      return base;
    const carried = hostDelivery(name, r, payload, [...ordered ?? [], update]);
    if (carried.dropped !== null) {
      gaveWay(doors, input, "update-notice", 1);
      return { ...base, dropped: base.dropped ?? carried.dropped };
    }
    return doors.markUpdateNotice(input) ? carried : base;
  } catch {
    return base;
  }
}
function gaveWay(doors, input, part, count) {
  try {
    doors.noteGaveWay?.(input, part, count);
  } catch {}
}
export function stampWhenOpened(payload, stamp) {
  if (!opensASession(payload))
    return;
  try {
    stamp();
  } catch {}
}
function plainOut(out, dropped) {
  const chars = out.length;
  return chars > TUNABLES.HOST_OUTPUT_CHARS ? { stdout: out, stderr: "", exitCode: 0, dropped, overCap: { chars, limitChars: TUNABLES.HOST_OUTPUT_CHARS } } : { stdout: out, stderr: "", exitCode: 0, dropped };
}
export function hostDelivery(name, result, payload, notice = null) {
  const ask = result.ask !== null && result.ask.length > 0 ? result.ask : null;
  if (name !== "stop") {
    const out = [result.injection ?? "", ask ?? ""].filter((s) => s.length > 0).join(`

`);
    const notices = (typeof notice === "string" || notice === null ? [notice] : notice).filter((n) => n !== null && n.length > 0);
    if (name === "session-start" && notices.length > 0) {
      const envelopeOf = (message) => envelopeJson(HOST_SESSION_START, message, out);
      const kept = [];
      const left = [];
      for (const n of notices) {
        if (fieldsFit(out, [...kept, n].join(`
`)))
          kept.push(n);
        else
          left.push(n);
      }
      const dropped = left.length === 0 ? null : {
        noticeChars: left.join(`
`).length,
        envelopeChars: envelopeOf(notices.join(`
`)).length,
        limitChars: TUNABLES.HOST_OUTPUT_CHARS
      };
      if (kept.length === 0)
        return plainOut(out, dropped);
      return { stdout: envelopeOf(kept.join(`
`)), stderr: "", exitCode: 0, dropped };
    }
    if (name === "user-prompt-submit" && notices.length > 0) {
      const message = notices.join(`
`);
      const envelope = JSON.stringify({
        systemMessage: message,
        ...out.length === 0 ? {} : { hookSpecificOutput: { hookEventName: HOST_USER_PROMPT_SUBMIT, additionalContext: out } }
      });
      if (!fieldsFit(out, message)) {
        return plainOut(out, { noticeChars: message.length, envelopeChars: envelope.length, limitChars: TUNABLES.HOST_OUTPUT_CHARS });
      }
      return { stdout: envelope, stderr: "", exitCode: 0, dropped: null };
    }
    return plainOut(out, null);
  }
  if (payload["stop_hook_active"] === true || ask === null) {
    return { stdout: "", stderr: "", exitCode: 0, dropped: null };
  }
  return {
    stdout: JSON.stringify({
      systemMessage: STOP_HUMAN_LINE,
      hookSpecificOutput: { hookEventName: HOST_STOP, additionalContext: ask }
    }),
    stderr: "",
    exitCode: 0,
    dropped: null
  };
}
export function isEntryPoint(argv1, url, binary = BINARY) {
  if (argv1 === undefined || binary !== null)
    return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}
export function start() {
  main().then(() => process.exit(process.exitCode === 2 ? 2 : 0), (err) => {
    const detail = err instanceof Error ? err.message : String(err);
    const remedy = `Set "dataDir" in ${hookConfigChoice().path}, or set ${DATA_DIR_ENV}.`;
    process.stderr.write(`[counterparts] hook stood down: ${describeGuardRefusal(err, remedy) ?? detail}
`);
    process.exit(0);
  });
}
if (isEntryPoint(process.argv[1], import.meta.url))
  start();
