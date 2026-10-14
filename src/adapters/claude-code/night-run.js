import { randomUUID } from "node:crypto";
import { Counterpart, MCP_SPILLED_EVENT } from "../../core/counterpart.js";
import { CATCH_UP_ONLY_REASONS } from "../../core/dream/index.js";
import { CONFIG_ENV as CONFIG_PATH_ENV } from "../config-path.js";
import { entryScript, scriptArgs } from "../runtime.js";
import { TOOL_RESULT_CEILING } from "../../core/fit/index.js";
import { installedVersion } from "../sessions.js";
import { OBSERVER_ENV, OWNER_ENV } from "../stance-env.js";
import { TUNABLES } from "../config.js";
import { DEFAULT_HOST_COMMAND, KILL_GRACE_MS, PERMISSION_MODE, REAP_GRACE_MS, startChild } from "./child.js";
import { CATCH_UP_TOOLS, runCatchUp } from "./night-catch-up.js";
import { parseToolSpills } from "./transcript.js";
import { DATA_DIR_ENV, NIGHT_CHILD_ENV, NIGHT_RUN_ENV, SCOPE_ENV, SESSION_ENV, WATCHDOG_ENV } from "../spawn.js";
const DREAM_TOOL = /__dream$/;

export { NIGHT_RUN_ENV };
export const NIGHT_KIND_ENV = "COUNTERPARTS_NIGHT_KIND";
export const MCP_TOKENS_ENV = "MAX_MCP_OUTPUT_TOKENS";
export const NIGHT_TOOLS = [
  "mcp__counterparts__dream",
  "mcp__counterparts__reflect",
  "mcp__counterparts__self_page",
  "mcp__counterparts__recall"
];
export const NIGHT_DENIED_TOOLS = [
  "Bash",
  "PowerShell",
  "REPL",
  "Read",
  "Write",
  "Edit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "LSP",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
  "Skill",
  "Workflow",
  "SendMessage",
  "Monitor",
  "TaskStop",
  "EnterWorktree",
  "CronCreate",
  "RemoteTrigger",
  "Artifact"
];
export const DREAM_CHILD_TOOLS = NIGHT_TOOLS.filter((t) => t !== "mcp__counterparts__reflect");
export const DREAM_CHILD_DENIED = ["mcp__counterparts__reflect"];
export const NIGHT_MCP_SERVER = "counterparts";
export const NIGHT_MCP_SCRIPT = entryScript(new URL("../mcp/bin/serve.ts", import.meta.url));
export function nightMcpConfig(input) {
  const env = { [DATA_DIR_ENV]: input.dataDir, [OWNER_ENV]: "0" };
  if (input.configPath !== undefined && input.configPath.length > 0)
    env[CONFIG_PATH_ENV] = input.configPath;
  if (input.session.length > 0)
    env[SESSION_ENV] = input.session;
  if (input.scope.length > 0)
    env[SCOPE_ENV] = input.scope;
  if (input.child !== undefined)
    env[NIGHT_CHILD_ENV] = input.child;
  if (input.run !== undefined && input.run.length > 0)
    env[NIGHT_RUN_ENV] = input.run;
  return JSON.stringify({ mcpServers: { [NIGHT_MCP_SERVER]: { type: "stdio", command: input.runtime, args: scriptArgs(NIGHT_MCP_SCRIPT, input.runtime), env } } });
}
export function nightMaxTurns(config) {
  return config.dreaming?.maxTurns ?? TUNABLES.NIGHT_MAX_TURNS;
}
export const HOST_SESSION_ENV = [
  "CLAUDE_PROJECT_DIR",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_PLUGIN_ROOT",
  "CLAUDE_PLUGIN_DATA"
];
export function kindValue(k) {
  if (k.kind === "reflection")
    return `reflection:${k.dream}`;
  return k.dreamSkipped === undefined ? "night" : `catch-up:${k.dreamSkipped}`;
}
export function readKind(raw) {
  const v = (raw ?? "").trim();
  if (v.startsWith("reflection:") && v.length > "reflection:".length)
    return { kind: "reflection", dream: v.slice("reflection:".length) };
  const why = v.startsWith("catch-up:") ? v.slice("catch-up:".length) : "";
  if (CATCH_UP_ONLY_REASONS.includes(why))
    return { kind: "night", dreamSkipped: why };
  return { kind: "night" };
}
export function nightTimeoutMs(config) {
  return config.dreaming?.timeoutMs ?? TUNABLES.NIGHT_RUN_MS;
}
export function nightChildrenTimeoutMs(config, kind) {
  const one = nightTimeoutMs(config);
  return kind === "night" ? 2 * one + KILL_GRACE_MS + REAP_GRACE_MS : one;
}
export function nightRowTimeoutMs(config, kind) {
  return nightChildrenTimeoutMs(config, kind) + (kind === "night" ? TUNABLES.NIGHT_WRITE_UP_TOTAL_MS + KILL_GRACE_MS + REAP_GRACE_MS : 0);
}
export function planNightRunner(input) {
  const env = {};
  for (const [k, v] of Object.entries(input.baseEnv ?? process.env))
    if (v !== undefined)
      env[k] = v;
  const timeoutMs = nightRowTimeoutMs(input.config, input.kind.kind) + KILL_GRACE_MS + REAP_GRACE_MS + 60000;
  const args = [...input.args ?? []];
  const no = (reason) => ({
    ok: false,
    reason,
    command: input.command,
    args,
    env,
    timeoutMs,
    escalate: false
  });
  if (input.config.observer === true)
    return no("OBSERVER");
  if (input.config.dataDir === undefined || input.config.dataDir.trim().length === 0)
    return no("NO_DATA_DIR");
  if (input.args === undefined || input.args.length === 0 || input.command.trim().length === 0)
    return no("NO_RUNNER");
  if (input.session.length === 0)
    return no("NO_SESSION");
  delete env[OBSERVER_ENV];
  delete env[WATCHDOG_ENV];
  env[DATA_DIR_ENV] = input.config.dataDir;
  env[SESSION_ENV] = input.session;
  env[SCOPE_ENV] = input.scope;
  env[NIGHT_RUN_ENV] = input.run;
  env[NIGHT_KIND_ENV] = kindValue(input.kind);
  if (input.configPath !== undefined && input.configPath.length > 0)
    env[CONFIG_PATH_ENV] = input.configPath;
  return { ok: true, reason: "ready", command: input.command, args, env, timeoutMs, escalate: false };
}
export function planNightChild(input) {
  const timeoutMs = input.timeoutMs ?? nightTimeoutMs(input.config);
  const command = input.command ?? DEFAULT_HOST_COMMAND;
  const env = {};
  for (const [k, v] of Object.entries(input.baseEnv ?? process.env))
    if (v !== undefined)
      env[k] = v;
  const model = input.config.dreaming?.model;
  const dataDir = input.config.dataDir ?? "";
  const args = [
    "-p",
    "--allowedTools",
    (input.tools ?? NIGHT_TOOLS).join(","),
    "--disallowedTools",
    [...NIGHT_DENIED_TOOLS, ...input.deny ?? []].join(","),
    "--permission-mode",
    PERMISSION_MODE,
    "--max-turns",
    String(input.maxTurns ?? nightMaxTurns(input.config)),
    "--mcp-config",
    nightMcpConfig({
      runtime: input.runtime ?? process.execPath,
      dataDir,
      session: input.session,
      scope: input.scope,
      ...input.configPath === undefined ? {} : { configPath: input.configPath },
      ...input.child === undefined ? {} : { child: input.child },
      run: input.run
    }),
    "--strict-mcp-config",
    ...model === undefined ? [] : ["--model", model],
    ...input.hostSession === undefined || input.hostSession.length === 0 ? [] : ["--session-id", input.hostSession],
    ...input.readOutput === true ? ["--output-format", "stream-json", "--verbose"] : []
  ];
  const plan = (ok, reason) => ({
    ok,
    reason,
    command,
    args,
    stdin: input.prompt,
    env,
    timeoutMs,
    ...input.readOutput === true ? { captureOutput: true } : {},
    ...dataDir.trim().length === 0 ? {} : { cwd: dataDir }
  });
  if (input.config.observer === true)
    return plan(false, "OBSERVER");
  if (input.config.dataDir === undefined || input.config.dataDir.trim().length === 0)
    return plan(false, "NO_DATA_DIR");
  if (command.trim().length === 0)
    return plan(false, "NO_COMMAND");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    return plan(false, "TIMEOUT_NOT_FINITE");
  delete env[SESSION_ENV];
  delete env[SCOPE_ENV];
  delete env[WATCHDOG_ENV];
  delete env[OBSERVER_ENV];
  for (const k of HOST_SESSION_ENV)
    delete env[k];
  env[DATA_DIR_ENV] = input.config.dataDir;
  env[NIGHT_RUN_ENV] = input.run;
  env[MCP_TOKENS_ENV] = String(TOOL_RESULT_CEILING.HOST_TOKENS);
  if (input.session.length > 0)
    env[SESSION_ENV] = input.session;
  if (input.scope.length > 0)
    env[SCOPE_ENV] = input.scope;
  if (input.configPath !== undefined && input.configPath.length > 0)
    env[CONFIG_PATH_ENV] = input.configPath;
  return plan(true, "ready");
}
export async function runNight(input) {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  let date = input.date ?? "";
  let prompt = "";
  let catchUpMs = 0;
  const children = [];
  const base = (c) => ({
    run: input.run,
    date: date.length > 0 ? date : c?.store.today() ?? "",
    kind: input.kind.kind,
    session: input.session,
    startedAt,
    timeoutMs: nightChildrenTimeoutMs(input.config, input.kind.kind) + catchUpMs
  });
  const record = (run) => {
    try {
      const c = input.open();
      try {
        c.dreams.recordNightRun(run);
      } finally {
        c.close();
      }
    } catch {}
    return run;
  };
  const ended = (fields) => record({ ...base(null), endedAt: now(), dream: null, reflection: null, ...children.length === 0 ? {} : { children: [...children] }, ...fields });
  if (input.kind.kind === "night") {
    const report = await runCatchUp({
      open: input.open,
      config: input.config,
      run: input.run,
      scope: input.scope,
      plan: ({ prompt: text, runner }) => planNightChild({
        config: input.config,
        run: input.run,
        prompt: text,
        scope: input.scope,
        session: runner,
        tools: CATCH_UP_TOOLS,
        maxTurns: TUNABLES.NIGHT_WRITE_UP_MAX_TURNS,
        timeoutMs: TUNABLES.NIGHT_WRITE_UP_MS,
        ...input.configPath === undefined ? {} : { configPath: input.configPath },
        ...input.baseEnv === undefined ? {} : { baseEnv: input.baseEnv },
        ...input.command === undefined ? {} : { command: input.command }
      }),
      start: input.startCatchUp ?? ((p) => startChild(p)),
      now,
      parts: TUNABLES.NIGHT_WRITE_UP_PARTS,
      ...input.onEvent === undefined ? {} : { onEvent: input.onEvent }
    });
    if (report !== null)
      catchUpMs = report.ms;
    if (input.kind.dreamSkipped !== undefined)
      return catchUpOnlyEnd(input, report, children, ended, (d) => date = d);
  }
  let first;
  try {
    first = input.open();
  } catch (err) {
    return { ...base(null), state: "could-not-start", endedAt: now(), reason: "refused", detail: err instanceof Error ? err.name : "UNKNOWN", code: null, dream: null, reflection: null };
  }
  try {
    const c = first;
    try {
      if (date.length === 0)
        date = c.store.today();
      prompt = input.kind.kind === "night" ? c.dreams.launchPrompt({ session: input.session, reflect: false }) : c.reflections.launchPrompt({ session: input.session, dream: input.kind.dream });
      c.dreams.recordNightRun({ ...base(c), state: "started", endedAt: null, reason: null, detail: null, code: null, dream: null, reflection: null });
    } finally {
      c.close();
    }
  } catch (err) {
    return ended({ state: "could-not-start", reason: "refused", detail: err instanceof Error ? err.name : "UNKNOWN", code: null });
  }
  const childInput = (child, text) => ({
    config: input.config,
    run: input.run,
    prompt: text,
    scope: input.scope,
    session: input.session,
    child,
    ...child === "dream" ? { tools: DREAM_CHILD_TOOLS, deny: DREAM_CHILD_DENIED } : {},
    ...input.configPath === undefined ? {} : { configPath: input.configPath },
    ...input.baseEnv === undefined ? {} : { baseEnv: input.baseEnv },
    ...input.command === undefined ? {} : { command: input.command }
  });
  const firstInput = childInput(input.kind.kind === "night" ? "dream" : "reflection", prompt);
  const check = planNightChild(firstInput);
  if (!check.ok)
    return ended({ state: "could-not-start", reason: "refused", detail: check.reason, code: null });
  const start = input.start ?? ((p) => startChild(p));
  const ran = [];
  try {
    ran.push(await runNightChild(input, firstInput, start, now));
  } catch (err) {
    return ended({ state: "could-not-start", reason: "spawn-failed", detail: err instanceof Error ? err.name : "UNKNOWN", code: null });
  }
  const one = ran[0];
  children.push(childRunOf(firstInput.child ?? "dream", one));
  if (one.neverStarted) {
    const missing = one.result.spawnCode === "ENOENT";
    return ended({ state: "could-not-start", reason: missing ? "no-claude" : "spawn-failed", detail: one.result.spawnCode ?? one.result.error, code: null });
  }
  if (input.kind.kind === "night") {
    const next = reflectionAfter(input.open, one, input.session, startedAt);
    if ("skipped" in next)
      children.push({ child: "reflection", code: null, ms: 0, skipped: next.skipped });
    else {
      const second = childInput("reflection", next.prompt);
      try {
        const two = await runNightChild(input, second, start, now);
        if (two.neverStarted)
          children.push({ child: "reflection", code: null, ms: 0, skipped: two.result.spawnCode === "ENOENT" ? "no-claude" : "spawn-failed" });
        else {
          ran.push(two);
          children.push(childRunOf("reflection", two));
        }
      } catch {
        children.push({ child: "reflection", code: null, ms: 0, skipped: "spawn-failed" });
      }
    }
  }
  const ms = now() - startedAt;
  const lastRun = ran[ran.length - 1];
  const stopped = ran.find((r) => r.result.timedOut);
  const failing = ran.find((r) => r.result.code !== 0 && !r.neverStarted);
  const result = stopped?.result ?? failing?.result ?? lastRun.result;
  const exitCode = result.code;
  const spill = mergeSpills(ran.map((r) => r.spill));
  let dream = null;
  let reflection = null;
  let began = false;
  let writerRan = false;
  let dreamed = false;
  let requeued = null;
  let unread = null;
  try {
    const c = input.open();
    try {
      const dreams = c.store.dreams({ sinceAt: startedAt, limit: 5 });
      const reflections = c.store.reflections({ limit: 5 }).filter((r) => r.started_at >= startedAt);
      began = dreams.length > 0 || reflections.length > 0;
      writerRan = c.pageWriterRuns({ limit: 20 }).some((r) => r.at >= startedAt && r.session === input.session);
      dreamed = dreams.some((d) => d.state === "journaled");
      const journaled = dreams.find((d) => d.state === "journaled");
      const reflected = reflections.find((r) => r.state === "reflected");
      reflection = reflected?.id ?? null;
      dream = journaled?.id ?? reflected?.dream_id ?? (input.kind.kind === "reflection" && reflected !== undefined ? input.kind.dream : null);
      for (const s of spill?.spills ?? []) {
        c.noteAdapterEvent(MCP_SPILLED_EVENT, { run: input.run, tool: s.tool, phase: s.phase, shape: s.shape, said: s.said });
      }
      const dreamCuts = (spill?.spills ?? []).filter((s) => DREAM_TOOL.test(s.tool));
      const target = dreamCuts.find((s) => typeof s.dream === "string")?.dream ?? dreams[0]?.id ?? null;
      if (spill?.reason === "read" && dreamCuts.length > 0 && target !== null) {
        try {
          const forThis = (x) => x.dream === undefined || x.dream === null || x.dream === target;
          requeued = c.dreams.requeueSpilled(target, dreamCuts.filter(forThis), (spill.whole ?? []).filter((w) => DREAM_TOOL.test(w.tool) && forThis(w))).requeued;
        } catch {}
      }
    } finally {
      try {
        c.refreshWake({ at: c.store.today(), trigger: "run-end" });
      } catch {}
      c.close();
    }
  } catch (err) {
    unread = errorCode(err);
  }
  const parts = [...writerRan ? ["writer"] : [], ...dreamed ? ["dream"] : [], ...reflection !== null ? ["reflection"] : []];
  const complete = input.kind.kind === "reflection" ? reflection !== null : parts.includes("dream") && reflection !== null;
  const found = {
    dream,
    reflection,
    parts,
    ...spill === null ? {} : { transcript: spill.reason, ...spill.reason === "read" ? { spills: spill.spills.length } : {} },
    ...requeued === null ? {} : { requeued }
  };
  if (complete)
    return ended({ state: "done", reason: null, detail: null, code: exitCode, ...found });
  if (parts.length > 0) {
    const reason = result.timedOut ? "watchdog" : exitCode !== 0 ? "exit" : "unfinished";
    return ended({ state: "partial", reason, detail: result.timedOut ? result.error : null, code: exitCode, ...found });
  }
  if (result.timedOut)
    return ended({ state: "timed-out", reason: "watchdog", detail: result.error, code: exitCode, ...found });
  if (exitCode !== 0) {
    if (!began && ms < TUNABLES.NIGHT_QUICK_EXIT_MS)
      return ended({ state: "could-not-start", reason: "quick-exit", detail: null, code: exitCode });
    return ended({ state: "failed", reason: "exit", detail: null, code: exitCode, ...found });
  }
  if (unread !== null)
    return ended({ state: "failed", reason: "unread", detail: unread, code: exitCode });
  if (!began)
    return ended({ state: "could-not-start", reason: "nothing-ran", detail: null, code: 0 });
  return ended({ state: "failed", reason: "unfinished", detail: null, code: 0, ...found });
}
function catchUpOnlyEnd(input, report, children, ended, setDate) {
  const skipped = input.kind.kind === "night" ? input.kind.dreamSkipped : undefined;
  if (skipped !== undefined)
    children.push({ child: "dream", code: null, ms: 0, skipped }, { child: "reflection", code: null, ms: 0, skipped });
  try {
    const c = input.open();
    try {
      if (input.date === undefined)
        setDate(c.store.today());
      c.refreshWake({ at: c.store.today(), trigger: "run-end" });
    } finally {
      c.close();
    }
  } catch {}
  const code = report?.code ?? null;
  switch (report?.state) {
    case "could-not-start":
      return ended({ state: "could-not-start", reason: "spawn-failed", detail: "catch-up", code: null });
    case "timed-out":
      return ended({ state: "timed-out", reason: "watchdog", detail: "catch-up", code });
    case "failed":
      return ended({ state: "failed", reason: "exit", detail: "catch-up", code });
    default:
      return ended({ state: "done", reason: null, detail: null, code, parts: [] });
  }
}
function childRunOf(child, out) {
  return { child, code: out.result.code, ms: out.ms, ...out.result.timedOut ? { timedOut: true } : {} };
}
async function runNightChild(input, childInput, start, now) {
  const hostSession = randomUUID();
  const plan = planNightChild({ ...childInput, hostSession, readOutput: true });
  const childAt = now();
  let result = await start(plan);
  let named = true;
  if (result.spawnCode === undefined && result.code !== null && result.code !== 0 && !result.timedOut && now() - childAt < TUNABLES.NIGHT_QUICK_EXIT_MS && (result.output ?? "").trim().length === 0 && !begunSince(input.open, childAt, input.session)) {
    named = false;
    result = await start(planNightChild(childInput));
  }
  const ms = now() - childAt;
  const neverStarted = result.spawnCode !== undefined || result.code === null && !result.timedOut && result.error !== null;
  const spill = neverStarted ? null : readNightSpills(result);
  if (spill !== null) {
    input.onEvent?.({
      at: now(),
      name: "adapter.night.spill",
      ref: input.run,
      data: { child: childInput.child ?? null, transcript: spill.reason, results: spill.results, spills: spill.spills.length, short: spill.short, corrupt: spill.corrupt, ...named ? {} : { named: false } }
    });
  }
  return { result, ms, neverStarted, spill };
}
function reflectionAfter(open, first, session, since) {
  try {
    const c = open();
    try {
      const dreams = c.store.dreams({ sinceAt: since, limit: 5 });
      const began = dreams.length > 0 || c.pageWriterRuns({ limit: 20 }).some((r) => r.at >= since && r.session === session);
      const r = first.result;
      if (!began && r.code !== 0 && !r.timedOut && first.ms < TUNABLES.NIGHT_QUICK_EXIT_MS)
        return { skipped: "quick-exit" };
      const today = c.store.today();
      if (c.store.reflections({ limit: 5 }).some((x) => x.state === "reflected" && x.date === today))
        return { skipped: "reflected-today" };
      const dream = dreams.find((d) => d.state === "journaled")?.id ?? null;
      return { prompt: c.reflections.launchPrompt({ session, dream }), dream };
    } finally {
      c.close();
    }
  } catch {
    return { skipped: "unread" };
  }
}
function mergeSpills(all) {
  const got = all.filter((s) => s !== null);
  if (got.length === 0)
    return null;
  const worst = got.find((s) => s.reason === "unreadable") ?? got.find((s) => s.reason === "absent");
  return {
    reason: worst?.reason ?? "read",
    results: got.reduce((n, s) => n + s.results, 0),
    spills: got.flatMap((s) => s.spills),
    whole: got.flatMap((s) => s.whole ?? []),
    corrupt: got.reduce((n, s) => n + s.corrupt, 0),
    short: got.some((s) => s.short)
  };
}
function errorCode(err) {
  const code = err !== null && typeof err === "object" ? err.code : undefined;
  if (typeof code === "string" && code.length > 0)
    return code;
  return err instanceof Error ? err.name : "UNKNOWN";
}
export function readNightSpills(result) {
  const none = { results: 0, spills: [], corrupt: 0, short: false };
  const out = result.output ?? "";
  if (out.trim().length === 0)
    return { reason: "absent", ...none };
  try {
    const short = result.outputShort === true;
    const text = short ? out.slice(0, Math.max(0, out.lastIndexOf(`
`))) : out;
    return { reason: "read", ...parseToolSpills(text), short };
  } catch {
    return { reason: "unreadable", ...none };
  }
}
function begunSince(open, at, session) {
  try {
    const c = open();
    try {
      return c.store.dreams({ sinceAt: at, limit: 1 }).length > 0 || c.store.reflections({ limit: 5 }).some((r) => r.started_at >= at) || c.pageWriterRuns({ limit: 20 }).some((r) => r.at >= at && r.session === session);
    } finally {
      c.close();
    }
  } catch {
    return true;
  }
}
export function openNightCounterpart(config, onEvent) {
  return Counterpart.open({
    ...config.dataDir === undefined ? {} : { dir: config.dataDir },
    ...config.snapshots?.dir === undefined ? {} : { snapshotsDir: config.snapshots.dir },
    ...config.injectionBudgetBytes === undefined ? {} : { budgetBytes: config.injectionBudgetBytes },
    ...config.owner === undefined ? {} : { owner: config.owner },
    ...config.timeZone === undefined ? {} : { timeZone: config.timeZone },
    ...config.pageWriter?.mode === undefined ? {} : { pageWriterMode: config.pageWriter.mode },
    ...config.identity === undefined ? {} : { identity: { name: config.identity.name, aliases: [...config.identity.aliases ?? []] } },
    build: installedVersion(),
    ...onEvent === undefined ? {} : { onEvent }
  });
}
