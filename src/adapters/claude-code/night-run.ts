/**
 * THE HEADLESS NIGHTLY RUN (2026-09-29) — the dreaming setting `auto`, done by
 * the host rather than asked of a model.
 *
 * Until 0.3.6 `auto` handed the first session's MODEL a line telling it to
 * call `dream launch` and pass the prompt to a background agent. On 2026-09-29
 * the host's auto-mode classifier refused exactly that — a hook-injected
 * instruction to start an agent, with no yes from the person in the transcript
 * — and the run lived inside whatever session happened to be first. Now the
 * HOOK starts it: nothing in the working session launches anything.
 *
 * Two processes, and why two:
 *
 *   1. the hook starts `bin/nightly.ts` DETACHED (`planNightRunner` +
 *      `spawn.ts#spawnDetached`) and returns at once — a hook lives for one
 *      event, and the session-end worker's five-minute watchdog is shorter
 *      than a run;
 *   2. that process composes the launch prompt FROM THE STORE (never through
 *      the environment, which `ps` shows), starts `claude -p` with it on
 *      STDIN (`planNightChild`), waits under its own watchdog, and records what
 *      became of the run — one row per run (`Dreams.recordNightRun`). Without a
 *      process that waits there is no row: "done", "timed out" and "could not
 *      start" need a witness.
 *
 * THE CHILD, LOCKED DOWN (owner decision B, 2026-09-29): `-p`, the prompt on
 * stdin, `--permission-mode default`, and `--allowedTools` the four
 * counterparts tools the run needs. `--allowedTools` only ADDS allow rules —
 * the user's own allow rules still apply inside the child (review of #282,
 * finding 3) — so:
 *   - the built-in tools that run commands, read or write files, reach the
 *     network or start agents are DENIED outright (`--disallowedTools`,
 *     `NIGHT_DENIED_TOOLS`; a deny beats an allow);
 *   - ONLY the counterparts MCP server loads (`--strict-mcp-config` with an
 *     `--mcp-config` naming just it — `nightMcpConfig`, the same server the
 *     install registers, `mcp/bin/serve.ts` beside this file), so no other MCP
 *     server the user allowed is reachable;
 *   - the child starts in a NEUTRAL directory, the store's own, so no
 *     project's CLAUDE.md, hooks or MCP servers load; the launching session's
 *     directory reaches the MCP server as its pinned scope instead;
 *   - `--max-turns` bounds it beside the watchdog;
 *   - `--session-id` names its session with a UUID this process chose
 *     (2026-10-09), so its transcript can be read once it exits.
 * What is left and not allowed stops at a prompt nobody can answer, which is
 * the direction this should fail in. The parent's stance variables are
 * removed from its environment; this package's own values are written last.
 *
 * SESSION BINDING (the choice, 2026-09-29): the run is ATTRIBUTED TO THE
 * SESSION THAT STARTED IT, as the in-session Agent path always was. The launch
 * prompt names that session's id, and the child's environment PINS it
 * (`COUNTERPARTS_SESSION`, `COUNTERPARTS_SCOPE`), so the child's MCP server is
 * launched bound to it (`mcp/bin/serve.ts`) rather than lazy-binding through
 * the registry — whose liveness check refused the overnight case: a session
 * left open overnight is "stale" at the morning's first prompt, because a
 * prompt is not a boundary (review of #282, finding 1). The id is our own
 * hook's, so no corroboration is lost. The child starts in the STORE's own
 * directory, a neutral one (owner decision B, `planNightChild`), without the
 * host's `CLAUDE_PROJECT_DIR`; the session's directory reaches it only as
 * `COUNTERPARTS_SCOPE`. The child's own session id — chosen after the hook is
 * gone, by the waiting process (`--session-id`, since 2026-10-09; the host
 * minted it before) — is flagged QUIET (`NIGHT_RUN_ENV`): our hooks inside it capture
 * nothing and ask nothing (`hooks.ts`), so it owes no write-up either.
 *
 * Proved against a STUB executable only. What a real machine must show — the
 * subscription login reachable from a detached process, the child's MCP
 * server binding as above, the host not refusing a nested `claude` — is
 * written in the PR, not claimed here.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { Counterpart, MCP_SPILLED_EVENT } from "../../core/counterpart.js";
import type { CounterpartEvent } from "../../core/counterpart.js";
import type { NightPart, NightRun } from "../../core/dream/index.js";
import { CONFIG_ENV as CONFIG_PATH_ENV } from "../config-path.js";
import { scriptArgs } from "../runtime.js";
import { TOOL_RESULT_CEILING } from "../../core/fit/index.js";
import { installedVersion } from "../sessions.js";
import { OBSERVER_ENV, OWNER_ENV } from "../stance-env.js";

import { TUNABLES } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { DEFAULT_HOST_COMMAND, KILL_GRACE_MS, PERMISSION_MODE, REAP_GRACE_MS, startChild } from "./child.js";
import { CATCH_UP_TOOLS, runCatchUp } from "./night-catch-up.js";
import { hostConfigDir, hostTranscriptPath, readToolSpills } from "./transcript.js";
import type { ToolSpills } from "./transcript.js";
import type { ChildPlan, ChildResult } from "./child.js";
import { DATA_DIR_ENV, SCOPE_ENV, SESSION_ENV, WATCHDOG_ENV } from "../spawn.js";
import type { SpawnPlan } from "../spawn.js";

/** The dream tool, as the host names it — whatever server prefix it carries. */
const DREAM_TOOL = /__dream$/;

/**
 * THE QUIET-CHILD FLAG, and the run's id: set on the headless run's
 * environment, read by our hooks inside it (`bin/hook.ts#toHookInput` →
 * `HookInput.nightRun`). Also how `bin/nightly.ts` learns which run it is.
 */
export const NIGHT_RUN_ENV = "COUNTERPARTS_NIGHT_RUN";
/** What the run does: `night` (writer, dream, reflection) or `reflection:<dream id>`. */
export const NIGHT_KIND_ENV = "COUNTERPARTS_NIGHT_KIND";
/** Claude Code's own name for its MCP result token line (2026-10-02). */
export const MCP_TOKENS_ENV = "MAX_MCP_OUTPUT_TOKENS";

/**
 * THE FOUR TOOLS THE RUN MAY CALL, as the host names MCP tools — the dream
 * (which also carries the page writer's phase), the reflection, the self
 * page, and recall for reading a memory whole. Nothing else.
 */
export const NIGHT_TOOLS = [
  "mcp__counterparts__dream",
  "mcp__counterparts__reflect",
  "mcp__counterparts__self_page",
  "mcp__counterparts__recall",
] as const;

/**
 * THE BUILT-IN TOOLS THE RUN MAY NEVER USE, denied outright (review of #282,
 * finding 3; owner decision B): the ones that run commands or code, read,
 * search or write files, reach the network, start agents or workflows, or
 * schedule work. `--disallowedTools` as `claude --help` (2.1.284) documents it,
 * a comma-separated list; the names are the host's own tool names, checked
 * against that build (not against a running session). NOT denied: `ToolSearch`,
 * which a host that defers MCP tools needs to reach the four above.
 */
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
  "Artifact",
] as const;

/** The MCP server's name — the `mcp__counterparts__…` in every tool name above. */
export const NIGHT_MCP_SERVER = "counterparts";

/** The MCP entry point beside this adapter — what the install registers (`cli/install.ts#MCP_SCRIPT`). */
export const NIGHT_MCP_SCRIPT = fileURLToPath(new URL("../mcp/bin/serve.ts", import.meta.url));

/**
 * THE ONE MCP SERVER THE CHILD LOADS (owner decision B): counterparts, as the
 * install registers it (`<runtime> <scriptArgs(serve.ts)>`, the data dir and the
 * configuration on its environment), plus the launching session and its
 * directory pinned — so the server binds to the run's session whatever the
 * host passes through (review of #282, finding 1). No secret in it: paths and
 * a session id.
 */
export function nightMcpConfig(input: { runtime: string; dataDir: string; configPath?: string; session: string; scope: string }): string {
  // NOT THE OWNER'S, SAID (2026-10-02): a server Claude Code starts is the
  // owner's by default now, and `claude -p` is Claude Code. The headless run
  // keeps the stance it always had — confidential memories stay out of its
  // bundles and its write-ups close no thread opened elsewhere — until that
  // is decided on its own.
  const env: Record<string, string> = { [DATA_DIR_ENV]: input.dataDir, [OWNER_ENV]: "0" };
  if (input.configPath !== undefined && input.configPath.length > 0) env[CONFIG_PATH_ENV] = input.configPath;
  if (input.session.length > 0) env[SESSION_ENV] = input.session;
  if (input.scope.length > 0) env[SCOPE_ENV] = input.scope;
  return JSON.stringify({ mcpServers: { [NIGHT_MCP_SERVER]: { type: "stdio", command: input.runtime, args: scriptArgs(NIGHT_MCP_SCRIPT, input.runtime), env } } });
}

/** The run's turn ceiling, from the configuration or the default. */
export function nightMaxTurns(config: AdapterConfig): number {
  return config.dreaming?.maxTurns ?? TUNABLES.NIGHT_MAX_TURNS;
}

/**
 * VARIABLES OF THE HOST THAT STARTED THE HOOK, removed from the child's
 * environment: its project directory (the child's MCP server would read the
 * scope from it before its own directory) and the markers that say "inside a
 * Claude Code session" (a host may refuse to start a session inside another).
 */
export const HOST_SESSION_ENV = [
  "CLAUDE_PROJECT_DIR",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  // The plugin's own two (2026-10-09, `adapters/plugin.ts`): a hook the plugin
  // launched carries them, and the child's hooks and server must learn whether
  // THEY are the plugin's from the child's host, never from this one.
  "CLAUDE_PLUGIN_ROOT",
  "CLAUDE_PLUGIN_DATA",
] as const;

export type NightKind = { readonly kind: "night" } | { readonly kind: "reflection"; readonly dream: string };

/** `night` or `reflection:<id>`, for `NIGHT_KIND_ENV`. */
export function kindValue(k: NightKind): string {
  return k.kind === "night" ? "night" : `reflection:${k.dream}`;
}

/** The reverse, forgiving: anything unreadable is the whole night. */
export function readKind(raw: string | undefined): NightKind {
  const v = (raw ?? "").trim();
  if (v.startsWith("reflection:") && v.length > "reflection:".length) return { kind: "reflection", dream: v.slice("reflection:".length) };
  return { kind: "night" };
}

// ── 1. the hook's side: the detached process that waits ────────────────────

export type NightRunnerRefusal = "OBSERVER" | "NO_DATA_DIR" | "NO_RUNNER" | "NO_SESSION";

export interface NightRunnerInput {
  readonly config: AdapterConfig;
  /** The interpreter (`process.execPath`) and the args that run `bin/nightly.ts`. */
  readonly command: string;
  readonly args: readonly string[] | undefined;
  readonly run: string;
  readonly session: string;
  readonly scope: string;
  readonly kind: NightKind;
  readonly configPath?: string;
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
}

/** The child's watchdog, from the configuration or the default. */
export function nightTimeoutMs(config: AdapterConfig): number {
  return config.dreaming?.timeoutMs ?? TUNABLES.NIGHT_RUN_MS;
}

/**
 * EVERYTHING DECIDED FOR THE DETACHED PROCESS, NOTHING STARTED. Pure, and a
 * `SpawnPlan` so `spawnDetached` starts it like the worker. Its OWN planner,
 * not `planSpawn`: that one checks the watchdog against `remember/`'s claim
 * staleness, which is about spans this process never claims — and a run's
 * watchdog is longer. The outer timeout is set past the child's watchdog and
 * both kill graces; in practice the hook exits at once and takes that timer
 * with it, so the watchdog that counts is `runNight`'s.
 */
export type NightRunnerPlan = Omit<SpawnPlan, "reason"> & { readonly reason: NightRunnerRefusal | "ready" };

export function planNightRunner(input: NightRunnerInput): NightRunnerPlan {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.baseEnv ?? process.env)) if (v !== undefined) env[k] = v;
  // The catch-up child runs first, under its own watchdog (2026-10-01).
  const timeoutMs = nightTimeoutMs(input.config) + TUNABLES.NIGHT_WRITE_UP_MS + 2 * (KILL_GRACE_MS + REAP_GRACE_MS) + 60_000;
  const args = [...(input.args ?? [])];
  const no = (reason: NightRunnerRefusal): NightRunnerPlan => ({
    ok: false,
    reason,
    command: input.command,
    args,
    env,
    timeoutMs,
    escalate: false,
  });
  if (input.config.observer === true) return no("OBSERVER");
  if (input.config.dataDir === undefined || input.config.dataDir.trim().length === 0) return no("NO_DATA_DIR");
  if (input.args === undefined || input.args.length === 0 || input.command.trim().length === 0) return no("NO_RUNNER");
  if (input.session.length === 0) return no("NO_SESSION");
  delete env[OBSERVER_ENV];
  delete env[WATCHDOG_ENV];
  env[DATA_DIR_ENV] = input.config.dataDir;
  env[SESSION_ENV] = input.session;
  env[SCOPE_ENV] = input.scope;
  env[NIGHT_RUN_ENV] = input.run;
  env[NIGHT_KIND_ENV] = kindValue(input.kind);
  if (input.configPath !== undefined && input.configPath.length > 0) env[CONFIG_PATH_ENV] = input.configPath;
  return { ok: true, reason: "ready", command: input.command, args, env, timeoutMs, escalate: false };
}

// ── 2. the detached process's side: the child and its record ───────────────

export type NightChildRefusal = "OBSERVER" | "NO_DATA_DIR" | "NO_COMMAND" | "TIMEOUT_NOT_FINITE";

export interface NightChildPlan extends ChildPlan {
  readonly ok: boolean;
  readonly reason: NightChildRefusal | "ready";
}

export interface NightChildInput {
  readonly config: AdapterConfig;
  readonly run: string;
  /** The launch prompt — on STDIN, never in argv. */
  readonly prompt: string;
  /** The launching session's directory: the child starts there, and its MCP server is pinned to it. */
  readonly scope: string;
  /** The launching session: the child's MCP server is launched bound to it. */
  readonly session: string;
  /** The runtime the MCP server runs under (`process.execPath`: bun or node, `runtime.ts`). */
  readonly runtime?: string;
  readonly configPath?: string;
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  /** TESTS ONLY: the program to start instead of `claude`. Code only — no configuration reaches it. */
  readonly command?: string;
  /** The tools it may call; absent, `NIGHT_TOOLS` (the catch-up child: `CATCH_UP_TOOLS`). */
  readonly tools?: readonly string[];
  /** Its turn ceiling and watchdog; absent, the night's own (`nightMaxTurns`, `nightTimeoutMs`). */
  readonly maxTurns?: number;
  readonly timeoutMs?: number;
  /**
   * The child's OWN session id, a fresh UUID (`--session-id`), so its
   * transcript can be found by name once it exits (2026-10-09, U14 item 3).
   * Absent, the host mints one (the catch-up child).
   */
  readonly hostSession?: string;
}

/**
 * THE `claude -p` CHILD, DECIDED. Pure. The same order as `planNightRunner`:
 * refusals first, then the environment, this package's values last.
 */
export function planNightChild(input: NightChildInput): NightChildPlan {
  const timeoutMs = input.timeoutMs ?? nightTimeoutMs(input.config);
  const command = input.command ?? DEFAULT_HOST_COMMAND;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.baseEnv ?? process.env)) if (v !== undefined) env[k] = v;
  const model = input.config.dreaming?.model;
  const dataDir = input.config.dataDir ?? "";
  const args = [
    "-p",
    "--allowedTools",
    (input.tools ?? NIGHT_TOOLS).join(","),
    "--disallowedTools",
    NIGHT_DENIED_TOOLS.join(","),
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
      ...(input.configPath === undefined ? {} : { configPath: input.configPath }),
    }),
    "--strict-mcp-config",
    ...(model === undefined ? [] : ["--model", model]),
    ...(input.hostSession === undefined || input.hostSession.length === 0 ? [] : ["--session-id", input.hostSession]),
  ];
  const plan = (ok: boolean, reason: NightChildRefusal | "ready"): NightChildPlan => ({
    ok,
    reason,
    command,
    args,
    stdin: input.prompt,
    env,
    timeoutMs,
    // A NEUTRAL DIRECTORY, the store's own (owner decision B): no project's
    // CLAUDE.md, hooks or MCP servers load in the child.
    ...(dataDir.trim().length === 0 ? {} : { cwd: dataDir }),
  });
  if (input.config.observer === true) return plan(false, "OBSERVER");
  if (input.config.dataDir === undefined || input.config.dataDir.trim().length === 0) return plan(false, "NO_DATA_DIR");
  if (command.trim().length === 0) return plan(false, "NO_COMMAND");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return plan(false, "TIMEOUT_NOT_FINITE");
  // THE RUN'S SESSION IS THE LAUNCHING ONE, pinned rather than inherited: the
  // child's MCP server reads these two at launch and binds without the
  // registry's liveness check (review of #282, finding 1). No hook reads them —
  // the child's own worker is pinned to the child's own session by `planSpawn`.
  delete env[SESSION_ENV];
  delete env[SCOPE_ENV];
  delete env[WATCHDOG_ENV];
  delete env[OBSERVER_ENV];
  for (const k of HOST_SESSION_ENV) delete env[k];
  env[DATA_DIR_ENV] = input.config.dataDir;
  env[NIGHT_RUN_ENV] = input.run;
  // THE TOKEN LINE, PINNED (2026-10-02): the env var outranks the host's remote
  // flag, so a flag that lowered it cannot spill a result the caps sized for
  // 25,000 tokens (`fit/TOOL_RESULT_CEILING`). The 50,000-character line has
  // no such pin.
  env[MCP_TOKENS_ENV] = String(TOOL_RESULT_CEILING.HOST_TOKENS);
  if (input.session.length > 0) env[SESSION_ENV] = input.session;
  if (input.scope.length > 0) env[SCOPE_ENV] = input.scope;
  if (input.configPath !== undefined && input.configPath.length > 0) env[CONFIG_PATH_ENV] = input.configPath;
  return plan(true, "ready");
}

/** Injected so a test can prove the whole path without a real child. */
export type NightStarter = (plan: ChildPlan) => Promise<ChildResult>;

export interface NightRunInput {
  /** Opens the store. Called twice — to compose and claim, then to record —
   *  so the store is not held open for the whole run. */
  readonly open: () => Counterpart;
  readonly config: AdapterConfig;
  readonly run: string;
  readonly session: string;
  readonly scope: string;
  readonly kind: NightKind;
  /** The calendar date whose run this is (the store's today when absent). */
  readonly date?: string;
  readonly configPath?: string;
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  /** TESTS ONLY — see `NightChildInput.command`. */
  readonly command?: string;
  readonly start?: NightStarter;
  /** TESTS ONLY: the catch-up child's starter (`night-catch-up.ts`); absent, a real child. */
  readonly startCatchUp?: NightStarter;
  /**
   * Where the host keeps its sessions (`<dir>/projects/…`), for the read of
   * the child's transcript; absent, the child's `CLAUDE_CONFIG_DIR` or
   * `~/.claude` (`transcript.ts#hostConfigDir`).
   */
  readonly hostConfigDir?: string;
  readonly now?: () => number;
  /** The process log's (`adapters/log/`), for what the store does not write. */
  readonly onEvent?: (e: CounterpartEvent) => void;
}

/**
 * RUN THE NIGHT, headless: compose, start, wait, record. Never throws; the
 * record it returns is the one it wrote. What happened is read from the exit
 * and from the STORE (a dream journaled, a reflection finished) — never from
 * the child's output, which is prose nobody here should parse. One thing more
 * is read from the HOST's record of the child, its transcript (2026-10-09):
 * whether the host cut any of our tool results to a preview — markers the host
 * writes in place of a result, matched there and nowhere else
 * (`transcript.ts#readToolSpills`).
 */
export async function runNight(input: NightRunInput): Promise<NightRun> {
  const now = input.now ?? ((): number => Date.now());
  const startedAt = now();
  let date = input.date ?? "";
  let prompt = "";
  // THE MORNING CATCH-UP FIRST (2026-10-01, build 3): owed stretches in any
  // directory are written up before the page writer reads the day, by a short
  // child of their own (`night-catch-up.ts`). Its time is added to the run's
  // watchdog on the row, so the gate does not read a run that is still going
  // as lost.
  let catchUpMs = 0;
  const base = (c: Counterpart | null): Omit<NightRun, "state" | "endedAt" | "reason" | "detail" | "code" | "dream" | "reflection"> => ({
    run: input.run,
    date: date.length > 0 ? date : (c?.store.today() ?? ""),
    kind: input.kind.kind,
    session: input.session,
    startedAt,
    timeoutMs: nightTimeoutMs(input.config) + catchUpMs,
  });
  const record = (run: NightRun): NightRun => {
    try {
      const c = input.open();
      try {
        c.dreams.recordNightRun(run);
      } finally {
        c.close();
      }
    } catch {
      /* a run that cannot be recorded still ran */
    }
    return run;
  };
  const ended = (fields: Pick<NightRun, "state" | "reason" | "detail" | "code"> & Partial<Pick<NightRun, "dream" | "reflection" | "parts" | "transcript" | "spills" | "requeued">>): NightRun =>
    record({ ...base(null), endedAt: now(), dream: null, reflection: null, ...fields });

  if (input.kind.kind === "night") {
    const report = await runCatchUp({
      open: input.open,
      config: input.config,
      run: input.run,
      scope: input.scope,
      plan: ({ prompt: text, runner }) =>
        planNightChild({
          config: input.config,
          run: input.run,
          prompt: text,
          scope: input.scope,
          session: runner,
          tools: CATCH_UP_TOOLS,
          maxTurns: TUNABLES.NIGHT_WRITE_UP_MAX_TURNS,
          timeoutMs: TUNABLES.NIGHT_WRITE_UP_MS,
          ...(input.configPath === undefined ? {} : { configPath: input.configPath }),
          ...(input.baseEnv === undefined ? {} : { baseEnv: input.baseEnv }),
          ...(input.command === undefined ? {} : { command: input.command }),
        }),
      start: input.startCatchUp ?? ((p: ChildPlan) => startChild(p)),
      now,
      ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
    });
    if (report !== null) catchUpMs = report.ms;
  }

  // A STORE THAT WILL NOT OPEN is not opened a second time just to say so:
  // the row stays `started`, and past its watchdog the gate reads it as LOST
  // and asks instead (review of #282, finding 4).
  let first: Counterpart;
  try {
    first = input.open();
  } catch (err) {
    return { ...base(null), state: "could-not-start", endedAt: now(), reason: "refused", detail: err instanceof Error ? err.name : "UNKNOWN", code: null, dream: null, reflection: null };
  }
  try {
    const c = first;
    try {
      if (date.length === 0) date = c.store.today();
      prompt =
        input.kind.kind === "night"
          ? c.dreams.launchPrompt({ session: input.session })
          : c.reflections.launchPrompt({ session: input.session, dream: input.kind.dream });
      // STARTED, by this process, before the child: the hook wrote `started`
      // when it launched this process; this row carries the same run on.
      c.dreams.recordNightRun({ ...base(c), state: "started", endedAt: null, reason: null, detail: null, code: null, dream: null, reflection: null });
    } finally {
      c.close();
    }
  } catch (err) {
    return ended({ state: "could-not-start", reason: "refused", detail: err instanceof Error ? err.name : "UNKNOWN", code: null });
  }
  // THE CHILD'S OWN SESSION, CHOSEN HERE (2026-10-09): so its transcript can
  // be found by name once it exits, and read for the host's cut.
  const hostSession = randomUUID();
  const childInput: NightChildInput = {
    config: input.config,
    run: input.run,
    prompt,
    scope: input.scope,
    session: input.session,
    ...(input.configPath === undefined ? {} : { configPath: input.configPath }),
    ...(input.baseEnv === undefined ? {} : { baseEnv: input.baseEnv }),
    ...(input.command === undefined ? {} : { command: input.command }),
  };
  const plan = planNightChild({ ...childInput, hostSession });
  if (!plan.ok) return ended({ state: "could-not-start", reason: "refused", detail: plan.reason, code: null });
  const where = { configDir: input.hostConfigDir ?? hostConfigDir(plan.env), id: hostSession, ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }) };

  const start = input.start ?? ((p: ChildPlan) => startChild(p));
  let result: ChildResult;
  // Whether the child that ran was the one named (review of #330, below).
  let named = true;
  try {
    const childAt = now();
    result = await start(plan);
    // A HOST THAT REFUSED THE NAME (review of #330): `--session-id` is read
    // for telemetry only, and the night must not be lost to it. A host too
    // old for the flag, or one that dropped it, exits at once on its argument
    // list — nothing begun, no transcript under the name. Exactly that is
    // retried ONCE without the flag, its cut left unchecked (`absent`). The
    // child's output is discarded (`child.ts`), so the refusal is read from
    // what it left: a quick non-zero exit, no transcript, nothing in the store.
    if (
      result.spawnCode === undefined &&
      result.code !== null &&
      result.code !== 0 &&
      !result.timedOut &&
      now() - childAt < TUNABLES.NIGHT_QUICK_EXIT_MS &&
      hostTranscriptPath(where) === null &&
      !begunSince(input.open, childAt, input.session)
    ) {
      named = false;
      result = await start(planNightChild(childInput));
    }
  } catch (err) {
    return ended({ state: "could-not-start", reason: "spawn-failed", detail: err instanceof Error ? err.name : "UNKNOWN", code: null });
  }
  const ms = now() - startedAt;
  const neverStarted = result.spawnCode !== undefined || (result.code === null && !result.timedOut && result.error !== null);

  // WHAT THE HOST CUT (2026-10-09, U14 item 3), read from the child's own
  // transcript — the host's record of what the model saw, not the child's
  // prose. A child that never started left none; one started without its
  // name left none this process can find.
  const spill: ToolSpills | null = neverStarted ? null : named ? readNightSpills(where) : { reason: "absent", results: 0, spills: [], corrupt: 0, short: false };
  if (spill !== null) {
    input.onEvent?.({
      at: now(),
      name: "adapter.night.spill",
      ref: input.run,
      data: { transcript: spill.reason, results: spill.results, spills: spill.spills.length, short: spill.short, corrupt: spill.corrupt, ...(named ? {} : { named: false }) },
    });
  }

  // WHAT THE RUN DID, from the store.
  let dream: string | null = null;
  let reflection: string | null = null;
  let began = false;
  let writerRan = false;
  let dreamed = false;
  let requeued: number | null = null;
  try {
    const c = input.open();
    try {
      const dreams = c.store.dreams({ sinceAt: startedAt, limit: 5 });
      const reflections = c.store.reflections({ limit: 5 }).filter((r) => r.started_at >= startedAt);
      began = dreams.length > 0 || reflections.length > 0;
      // The writer's phase was REACHED: it leaves a row carrying the session.
      writerRan = c.pageWriterRuns({ limit: 20 }).some((r) => r.at >= startedAt && r.session === input.session);
      dreamed = dreams.some((d) => d.state === "journaled");
      const journaled = dreams.find((d) => d.state === "journaled");
      const reflected = reflections.find((r) => r.state === "reflected");
      reflection = reflected?.id ?? null;
      dream = journaled?.id ?? reflected?.dream_id ?? (input.kind.kind === "reflection" && reflected !== undefined ? input.kind.dream : null);
      // One row per result the host cut (`counterpart.ts#MCP_SPILLED_EVENT`).
      for (const s of spill?.spills ?? []) {
        c.noteAdapterEvent(MCP_SPILLED_EVENT, { run: input.run, tool: s.tool, phase: s.phase, shape: s.shape, said: s.said });
      }
      // WHAT A CUT DREAM PART CARRIED GOES BACK IN THE QUEUE (Lane 0,
      // 2026-10-10): its new memories were composed, never seen.
      const dreamCuts = (spill?.spills ?? []).filter((s) => DREAM_TOOL.test(s.tool));
      const target = dreamCuts.find((s) => typeof s.dream === "string")?.dream ?? dreams[0]?.id ?? null;
      if (spill?.reason === "read" && dreamCuts.length > 0 && target !== null) {
        try {
          const forThis = (x: { dream?: string | null }): boolean => x.dream === undefined || x.dream === null || x.dream === target;
          requeued = c.dreams.requeueSpilled(
            target,
            dreamCuts.filter(forThis),
            (spill.whole ?? []).filter((w) => DREAM_TOOL.test(w.tool) && forThis(w)),
          ).requeued;
        } catch {
          /* the queue is not the record: the run still ended as it did */
        }
      }
    } finally {
      // THE WAKE CATCHES UP TO THE RUN (2026-09-30), whatever state it ended
      // in: the page it wrote, the dream's merges. Nothing else follows it —
      // the child is quiet — and under `auto` the day's first worker has
      // usually rendered the morning's wake before the writer wrote. The
      // host's budget came with the store (`openNightCounterpart`); without
      // one the render refuses, as everywhere. Its own try: never the record.
      try {
        c.refreshWake({ at: c.store.today(), trigger: "run-end" });
      } catch {
        /* the wake catches up at the next worker or the next lived day */
      }
      c.close();
    }
  } catch {
    /* read nothing: the exit decides alone */
  }
  // WHICH PARTS RAN (2026-09-29, owner): the dream counts once journaled, the
  // reflection once finished. All the run was for: done. Some: partial —
  // whatever the exit said, which rides along as the reason.
  const parts: NightPart[] = [...(writerRan ? ["writer" as const] : []), ...(dreamed ? ["dream" as const] : []), ...(reflection !== null ? ["reflection" as const] : [])];
  const complete = input.kind.kind === "reflection" ? reflection !== null : parts.includes("dream") && reflection !== null;
  const found = {
    dream,
    reflection,
    parts,
    ...(spill === null ? {} : { transcript: spill.reason, ...(spill.reason === "read" ? { spills: spill.spills.length } : {}) }),
    ...(requeued === null ? {} : { requeued }),
  };

  if (neverStarted) {
    const missing = result.spawnCode === "ENOENT";
    return ended({ state: "could-not-start", reason: missing ? "no-claude" : "spawn-failed", detail: result.spawnCode ?? result.error, code: null });
  }
  if (complete) return ended({ state: "done", reason: null, detail: null, code: result.code, ...found });
  if (parts.length > 0) {
    const reason = result.timedOut ? "watchdog" : result.code !== 0 ? "exit" : "unfinished";
    return ended({ state: "partial", reason, detail: result.timedOut ? result.error : null, code: result.code, ...found });
  }
  if (result.timedOut) return ended({ state: "timed-out", reason: "watchdog", detail: result.error, code: result.code, ...found });
  if (result.code !== 0) {
    if (!began && ms < TUNABLES.NIGHT_QUICK_EXIT_MS) return ended({ state: "could-not-start", reason: "quick-exit", detail: null, code: result.code });
    return ended({ state: "failed", reason: "exit", detail: null, code: result.code, ...found });
  }
  // A clean exit that began nothing could not do the job at all — the tools
  // were not there for it.
  if (!began) return ended({ state: "could-not-start", reason: "nothing-ran", detail: null, code: 0 });
  return ended({ state: "failed", reason: "unfinished", detail: null, code: 0, ...found });
}

/**
 * THE CHILD'S TRANSCRIPT, READ FOR THE HOST'S CUT (2026-10-09, U14 item 3):
 * found by the session id this process chose (`hostTranscriptPath`), judged by
 * `readToolSpills` — `absent` when the host did not write it where it keeps
 * sessions, said apart from a clean read. Never throws.
 */
export function readNightSpills(input: { configDir: string; id: string; cwd?: string }): ToolSpills {
  try {
    const path = hostTranscriptPath(input);
    return readToolSpills(path);
  } catch {
    return { reason: "unreadable", results: 0, spills: [], corrupt: 0, short: false };
  }
}

/**
 * DID A CHILD BEGIN ANYTHING since `at` — a dream, a reflection, the page
 * writer's phase (the same reads as `runNight`'s own)? A store that will not
 * open answers yes: a second child is never started on a guess.
 */
function begunSince(open: () => Counterpart, at: number, session: string): boolean {
  try {
    const c = open();
    try {
      return (
        c.store.dreams({ sinceAt: at, limit: 1 }).length > 0 ||
        c.store.reflections({ limit: 5 }).some((r) => r.started_at >= at) ||
        c.pageWriterRuns({ limit: 20 }).some((r) => r.at >= at && r.session === session)
      );
    } finally {
      c.close();
    }
  } catch {
    return true;
  }
}

/** The store as the run's process opens it — the hook's options, no embedder.
 *  `onEvent` is the process log's (`adapters/log/`), when there is one. */
export function openNightCounterpart(config: AdapterConfig, onEvent?: (e: CounterpartEvent) => void): Counterpart {
  return Counterpart.open({
    ...(config.dataDir === undefined ? {} : { dir: config.dataDir }),
    ...(config.snapshots?.dir === undefined ? {} : { snapshotsDir: config.snapshots.dir }),
    ...(config.injectionBudgetBytes === undefined ? {} : { budgetBytes: config.injectionBudgetBytes }),
    ...(config.owner === undefined ? {} : { owner: config.owner }),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    ...(config.pageWriter?.mode === undefined ? {} : { pageWriterMode: config.pageWriter.mode }),
    ...(config.identity === undefined ? {} : { identity: { name: config.identity.name, aliases: [...(config.identity.aliases ?? [])] } }),
    build: installedVersion(),
    ...(onEvent === undefined ? {} : { onEvent }),
  });
}
