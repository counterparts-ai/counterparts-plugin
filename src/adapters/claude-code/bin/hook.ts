#!/usr/bin/env bun
/**
 * The hook entry script. ONE executable for every hook, dispatching on the
 * host's own event name.
 *
 * Run by the host as, e.g.:
 *
 *   ~/.bun/bin/bun run <repo>/src/adapters/claude-code/bin/hook.ts
 *
 * with the hook payload on stdin. It writes the context block (or nothing) to
 * stdout and ALWAYS exits 0 — a hook that fails the host is the one failure
 * mode this adapter does not have (CONTRACT §5 G2). Everything in here is host
 * trivia and may change with the host without touching a core contract (G9).
 */
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
  resolveConfigPath,
} from "../../config-path.js";
import type { ConfigChoice } from "../../config-path.js";
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
  stanceOfMode,
} from "../../scopes.js";
import type { ScopeCommandContext, ScopeRead, ScopeVerdict } from "../../scopes.js";
import { canonicalScope, isEntrypoint, readSession } from "../../sessions.js";
import { openLog } from "../../log/index.js";
import type { LogEvent, ProcessLog } from "../../log/index.js";
import { resolveZone, todayIn } from "../../../core/time.js";
import { TUNABLES, loadConfig, withEmbedderDefault } from "../../config.js";
import type { AdapterConfig } from "../../config.js";
import { HOOKS, openAdapter } from "../index.js";
import { STOP_HUMAN_LINE, plainLine, withoutDream, withoutDreamNote, withoutPlain } from "../hooks.js";
import type { PlainReminder } from "../../../core/counterpart.js";
import type { DreamTold, HookInput, HookName } from "../hooks.js";
import { NIGHT_RUN_ENV } from "../night-run.js";
import type { DreamOffer } from "../../../core/dream/index.js";
import {
  CONFIG_REFUSED,
  CONFIG_UNREADABLE,
  classifyStandDown,
  decideSay,
  readMark,
  writeMark,
} from "../standdown.js";
import type { SaysSoHook, StandDownFault } from "../standdown.js";
import { readTranscript } from "../transcript.js";
import { BINARY, scriptArgs } from "../../runtime.js";
import type { Binary } from "../../runtime.js";
import { npmWiring } from "../../host-wiring.js";
import {
  PLUGIN_ROOT_ENV,
  ensureFirstRun,
  firstRunLine,
  firstRunNoticePath,
  hookGate,
  installRoute,
  pluginOrigin,
  runningAsPlugin,
  takeFirstRunNotice,
} from "../../plugin.js";
import { claimDelivery, deliveryClaimKey, finishClaim, firesOnce } from "../claim.js";

/**
 * The host's own spellings of the two events that carry a notice — one
 * constant each, shared with `hooks.ts`, which measures the same envelope
 * before it decides what rides beside the wake (`../envelope.ts`).
 */
import { HOST_SESSION_START, HOST_USER_PROMPT_SUBMIT, envelopeJson } from "../envelope.js";
export { HOST_SESSION_START, HOST_USER_PROMPT_SUBMIT } from "../envelope.js";

/**
 * WHAT THE JSON FORM MUST FIT: EACH FIELD, NOT THE WHOLE ENVELOPE (measured
 * 2026-10-10 on Claude Code 2.1.296; adapter NOTES, "The notice is capped").
 *
 * The host's cap (https://code.claude.com/docs/en/hooks#json-output): "A hook's
 * `additionalContext`, `systemMessage`, and `initialUserMessage` strings, and
 * its plain stdout, are capped at 10,000 characters … For JSON output, each
 * field is measured separately; plain stdout is measured whole." Measured: a
 * 10,488-character envelope in this hook's own shape (`systemMessage` 376,
 * `additionalContext` 9,910) and a 12,637-character escape-heavy one both
 * parsed, every field whole; a field past 10,000 is previewed and the JSON
 * still parses. So the JSON form's escaping costs nothing: what must fit is
 * the model's text and the person's line, each under `TUNABLES.HOST_OUTPUT_CHARS`
 * (the one place the host's number lives), in characters, as the host counts.
 *
 * Until then (2026-09-14) the rule was 9,500 characters of WHOLE envelope —
 * read from the same docs as fatal past 10,000, since a previewed object would
 * no longer parse — so on a full-wake day the notice was dropped though both
 * fields fit. Now the notice is kept whenever both fields fit, and the fallback
 * is still the plain wake: a notice that does not fit is dropped, never the
 * memory, and `counterparts doctor` still prints it.
 */
function fieldsFit(context: string, message: string): boolean {
  return context.length <= TUNABLES.HOST_OUTPUT_CHARS && message.length <= TUNABLES.HOST_OUTPUT_CHARS;
}

/**
 * HOW A DUE STOP ASK LEAVES THIS PROCESS — ONE shape (owner, 2026-09-24).
 *
 * Exit 0 and one JSON object on stdout:
 *
 *     {"systemMessage": <the person's line>,
 *      "hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": <the model's ask>}}
 *
 * The host's reference (https://code.claude.com/docs/en/hooks, read
 * 2026-09-24), Stop decision control: `hookSpecificOutput.additionalContext` is
 * "Non-error feedback for Claude. The conversation continues so Claude can act
 * on it, but unlike `decision: "block"` it is shown in the transcript as hook
 * feedback rather than a hook error" — and "It keeps the conversation going
 * through the same loop protections as `decision: "block"`, namely the
 * `stop_hook_active` input and the 8-consecutive-continuation cap". It stands
 * alone: no `decision` beside it.
 *
 * WHY THIS ONE. B1 (2026-09-23) built two shapes behind a `stopAskShape`
 * switch — the JSON `decision: "block"` and the day-0 stderr + exit 2 — and the
 * owner looked at both in a real terminal on 0.3.0: both printed the model's
 * two lines as `Stop hook error: …`, so both read as an error. This is the
 * third route, the one the docs call non-error; the switch and both earlier
 * shapes are gone. A `claude-code.json` that still carries `stopAskShape` is
 * read fine, the key ignored and named among the old settings (`config.ts`).
 *
 * What the person sees is NOT only their own line: the host's 2.1.281 bundle
 * renders an additionalContext on Stop under "Ran 1 stop hook" as
 * `Stop hook feedback: <ask>`, in the notice colour rather than the error one.
 * Quieter, not silent. `../NOTES.md` §"The Stop ask's shapes" has the record.
 */
export const HOST_STOP = "Stop";

/** The host's event names, mapped to this adapter's. Host trivia, by definition. */
const HOST_HOOKS: Record<string, HookName> = {
  [HOST_SESSION_START]: "session-start",
  [HOST_USER_PROMPT_SUBMIT]: "user-prompt-submit",
  [HOST_STOP]: "stop",
  SessionEnd: "session-end",
  PreCompact: "pre-compact",
};

/**
 * Where the host's configuration for this package lives BY DEFAULT — the path
 * this file has read since it was written, unchanged, and the one the owner's
 * live host resolves at every hook event because it passes no flag.
 *
 * `--config <absolute path>` and `COUNTERPARTS_CONFIG` override it, in that
 * order (`adapters/config-path.ts` states the rule for all four entry points).
 * Neither is set on the live host; a run that sets neither resolves exactly
 * this.
 */
export const CONFIG_PATH = defaultConfigPath();

/** The worker script this hook's spawn runs. Resolved from THIS file's location,
 *  never from a working directory the host chose. */
export const RUNNER_PATH = fileURLToPath(new URL("./runner.ts", import.meta.url));
/** The headless nightly run's own process (2026-09-29, `night-run.ts`). */
export const NIGHTLY_PATH = fileURLToPath(new URL("./nightly.ts", import.meta.url));

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The configuration this process runs on.
 */
export function hostConfig(
  path = CONFIG_PATH,
): { config: AdapterConfig; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Absent is ordinary; unreadable resolves to OBSERVER inside `loadConfig`,
    // which is the fail direction observer-mode G5 requires.
    raw = undefined;
  }
  const load = loadConfig(raw);
  const loaded = load.config;
  // The data dir is RESOLVED here and carried explicitly, so the spawner has a
  // value to pin onto the child (scar §2.13). Leaving it undefined would make
  // the parent and the child resolve it independently, from an environment
  // either of them might have inherited differently.
  // `reason` travels out so the caller can tell "we understood this" from "we
  // stood down because we did not" — the difference matters only for a config
  // somebody NAMED (`namedUnreadableRefusal`).
  // THE EMBEDDER DEFAULT (config.ts#resolveEmbedder): an absent block is the
  // local table.
  return {
    config: withEmbedderDefault({ ...loaded, dataDir: loaded.dataDir ?? dataDir() }),
    reason: load.reason,
  };
}

/**
 * The configuration this hook process will read, and which of the three rules
 * chose it. Exported and injectable so the no-flag, no-env case — the ONLY case
 * the owner's live host produces — is provable without a process.
 */
export function hookConfigChoice(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ConfigChoice {
  return resolveConfigPath(argv, env as Record<string, string | undefined>);
}

/**
 * WHERE THE AGENT'S SHELL IS RIGHT NOW — the directory THIS EVENT happened in,
 * and nothing more.
 *
 * **The 2026-09-04 measurement this used to rest on is retired.** It read the
 * payload's `cwd` as "the project directory"; the host documents it as
 * "current working directory (follows Claude into worktrees)", and it does. A
 * session that walks into a git worktree — which is how every piece of work in
 * this repository is done — reports the worktree here from that turn onward. One
 * real session on 2026-09-17 had its spans filed under FOUR directories on this
 * value alone.
 *
 * So this is no longer the scope anything is FILED under. It answers exactly one
 * question — which directory the owner's registry should be consulted about for
 * this event — and the filing scope is `sessionScope` below. The payload first,
 * because the whole point is that it moves; the two fallbacks are for a payload
 * that arrived unparsable.
 */
export function eventDirectory(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof payload["cwd"] === "string" && payload["cwd"].length > 0) {
    return resolve(payload["cwd"]);
  }
  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof projectDir === "string" && projectDir.length > 0) return resolve(projectDir);
  return process.cwd();
}

/**
 * THE `SessionStart` SOURCES THAT OPEN A SESSION rather than interrupting one.
 *
 * The host fires `SessionStart` five ways and says which in `source`: `startup`,
 * `resume`, `clear`, `fork` — all of them a session beginning, in whatever
 * directory the host launched it in — and `compact`, which arrives in the MIDDLE
 * of a session whose MCP server is not relaunched. Treating a compaction as a
 * start would re-anchor a long session's scope to wherever its shell had got to,
 * which is the failure this file is fixing, arriving by another door.
 *
 * A `source` this list does not know, or none at all, does NOT re-anchor a
 * session that already has a record: the safe direction for an unrecognised
 * event is to leave the session where it is.
 */
export const FRESH_SESSION_SOURCES: readonly string[] = ["startup", "resume", "clear", "fork"];

/**
 * THE ONE DIRECTORY A SESSION IS FILED UNDER, FOR ITS WHOLE LIFE — spans,
 * boundaries, coverage, the ask's coverage read, the session registry record and
 * the worker's session state.
 *
 * **Why it is not the event's directory.** Measured on the owner's store,
 * 2026-09-17: one session's spans landed in four scope directories and its
 * boundaries in all four, while its authored deposits and their coverage marks
 * landed in ONE — because the MCP server's scope is fixed at launch and a
 * deposit only covers spans in its own scope. Everything the session wrote in
 * the other three was left uncovered, to be rewritten twelve hours later by the
 * crash fallback as though the session had died. Two worktree scopes on that
 * store hold 298 fallback memories and zero authored ones.
 *
 * **Two sources, in this order, and they agree by construction.**
 *
 *   1. **The session registry's own record** (`adapters/sessions.ts`), which
 *      SessionStart wrote and which `recordSession` refuses to rewrite after a
 *      start. It is the recorded fact of where this session began, and it is the
 *      SAME string `mcp/server.ts#requireBoundSession` matches a deposit
 *      against — so a scope taken from here cannot disagree with the server that
 *      claims coverage.
 *   2. **`CLAUDE_PROJECT_DIR`, then the payload's `cwd`, then `process.cwd()`**,
 *      for the first event of a session and for a session whose record was
 *      pruned. The host documents `CLAUDE_PROJECT_DIR` as the project root where
 *      the session started, exports it to hook processes AND to stdio MCP
 *      servers, and keeps it put when the agent enters a worktree or runs `cd` —
 *      which is exactly the property the payload's `cwd` lacks. `serve.ts` reads
 *      the same variable in the same position, which is what makes the two sides
 *      agree without either one telling the other.
 *
 * Canonical on both sides (`canonicalScope`): the record stores a realpath, so a
 * scope read back from it and one resolved fresh have to be the same string or
 * the session would split on `/tmp` versus `/private/tmp` alone — and span
 * directories are keyed by a hash of this exact string (`remember/spans.ts`).
 */
export function sessionScope(
  /** The store the session registry lives under. Absent ⇒ no record to read. */
  dataDir: string | undefined,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const sessionId = typeof payload["session_id"] === "string" ? payload["session_id"] : "";
  if (dataDir !== undefined && dataDir.length > 0 && sessionId.length > 0 && !opensASession(payload)) {
    // `readSession` answers null on every failure rather than throwing, which is
    // the rule this whole path lives by: a hook may not fail the host (§5 G2).
    const recorded = readSession(dataDir, sessionId)?.scope;
    // Canonicalised HERE rather than trusted from the file: `recordSession`
    // canonicalises on write, so this is a no-op for every record this code
    // wrote — and a record written by anything else (a hand edit, an older
    // build, a future writer) would otherwise file this session's spans under a
    // directory keyed by a hash of a string nothing else spells that way.
    if (recorded !== undefined && recorded.length > 0) return canonicalScope(recorded);
  }
  return startDirectory(payload, env);
}

/** Is this event a session BEGINNING, whose directory becomes the session's? */
function opensASession(payload: Record<string, unknown>): boolean {
  if (payload["hook_event_name"] !== HOST_SESSION_START) return false;
  const source = payload["source"];
  return typeof source === "string" && FRESH_SESSION_SOURCES.includes(source);
}

/**
 * The directory a session that has no record yet began in. `CLAUDE_PROJECT_DIR`
 * first — see `sessionScope` for why the payload's `cwd` is not good enough.
 */
export function startDirectory(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof projectDir === "string" && projectDir.length > 0) return canonicalScope(projectDir);
  if (typeof payload["cwd"] === "string" && payload["cwd"].length > 0) {
    return canonicalScope(payload["cwd"]);
  }
  return canonicalScope(process.cwd());
}

/**
 * THE SCOPE VERDICT for this event: which entry in `<config dir>/scopes.json`
 * governs, and whether the file itself could be read.
 *
 * It takes as many directories as the caller has, and answers with the MOST
 * RESTRICTIVE verdict among them (`scopes.ts#mostRestrictiveVerdict`) — because
 * one event now has two directories to answer for, the session's and the shell's,
 * and privacy follows both while filing follows only the first. The FIRST
 * directory is the session's own and wins every tie, so the `unset` that raises
 * the first-launch question is asked about the directory the session is filed
 * under rather than about wherever it happens to be standing.
 *
 * Exported and injectable because the hook's most important behaviour — `off`
 * means nothing is opened at all — is decided from it before any store exists,
 * and that has to be provable without a process.
 */
export function hookScopeVerdict(
  configPath: string,
  ...scopes: readonly string[]
): { verdict: ScopeVerdict; read: ScopeRead } {
  const read = readScopes(scopesPath(configPath));
  return { verdict: verdictOver(read, scopes), read };
}

/** The most restrictive verdict over `scopes`, first one winning ties. */
function verdictOver(read: ScopeRead, scopes: readonly string[]): ScopeVerdict {
  let verdict: ScopeVerdict = { mode: "unset", matched: null, entry: null };
  let first = true;
  for (const dir of scopes) {
    const one = lookupScope(read.registry, dir);
    verdict = first ? one : mostRestrictiveVerdict(verdict, one);
    first = false;
  }
  return verdict;
}

/**
 * A PAUSED FOLDER SAYS SO, ONCE, AT SESSION START (rulings brief #19, 2026-10-10).
 *
 * Until this a pause was as silent as `off` (§5 G19): no wake, no recall, no
 * line. On 2026-10-09 three sessions in a paused folder ran without memory for
 * ten minutes before anyone noticed. `off` stays silent — it is a deliberate
 * opt-out, and a line every session would nag — but a pause is meant to end,
 * so its SessionStart now carries one line for the person (`person`, the
 * `systemMessage` the host displays) and one for the model (`model`, as
 * `additionalContext`, so it does not act as if it remembers).
 *
 * The command has to target the entry that PAUSED it: `--resume` refuses a
 * directory that only inherits a parent's pause. So the folder is always NAMED,
 * and the command names it — never `.`, which means wherever the person types
 * it (another terminal, or a shell that moved after a compaction) and, from a
 * subfolder of the entry, is refused outright (review of #362). A plugin
 * install puts no `counterparts` on PATH (`commands/doctor.md`), so under the
 * plugin the command is the plugin's own launcher.
 *
 * And it has to reach the REGISTRY this hook read. `counterparts scope` writes
 * the `scopes.json` beside the configuration it resolves, so a hook wired with
 * `--config` (or `COUNTERPARTS_CONFIG`) somewhere other than the default's
 * directory gives the command the same `--config` (`configPath`); without it
 * the command would resume an entry in the default registry, or refuse, and
 * this folder would stay paused (review of #362).
 *
 * `whose` says which directory the verdict was taken on: the event's folder
 * (the shell's) or the session's (where it started, when that is not where the
 * shell stands). Null for anything but a pause with a matched entry. Pure.
 */
export function pausedNotice(
  verdict: ScopeVerdict,
  here: string,
  opts: {
    readonly whose: "folder" | "session";
    readonly home: string;
    readonly pluginRoot: string | null;
    /** The configuration the hook read, when its registry is not the default's; else null. */
    readonly configPath?: string | null;
  },
): { readonly person: string; readonly model: string } | null {
  if (verdict.mode !== "paused" || verdict.matched === null) return null;
  const entry = canonicalScopePath(verdict.matched);
  const own = opts.whose === "folder" && entry === canonicalScopePath(here);
  const named = shortPath(entry, opts.home);
  const where = own
    ? `in ${named}`
    : opts.whose === "folder"
      ? `for ${named}, which includes this folder`
      : `for ${named}, which covers this session`;
  // The one console line every model- and person-facing text prints (`scopes.ts#scopeCommand`).
  const command = scopeCommand(entry, "--resume", {
    home: opts.home,
    pluginRoot: opts.pluginRoot,
    configPath: opts.configPath ?? null,
  });
  return {
    person: `Counterparts memory is paused ${where}; \`${command}\` turns it back on.`,
    model:
      `Counterparts memory is paused ${where}: no memories are loaded and nothing said here is remembered ` +
      `until the person resumes it (\`${command}\`). Don't act as if you remember earlier sessions.`,
  };
}

/**
 * What a console line this hook prints needs to work where it is typed: the
 * plugin's launcher when this is the plugin's process, and `--config` when the
 * registry it read is not the default's (`scopes.ts#scopeCommandContext`).
 */
export function hookScopeContext(configPath: string, env: Record<string, string | undefined> = process.env): ScopeCommandContext {
  return scopeCommandContext({
    configPath,
    pluginRoot: runningAsPlugin(env) ? (env[PLUGIN_ROOT_ENV] ?? null) : null,
    home: homedir(),
  });
}

/**
 * Print the paused notice when this is SessionStart in a paused folder — from
 * the registry already read, writing nothing anywhere but stdout. Every other
 * event, an `off` verdict, and the headless nightly run (a windowless session
 * nobody watches, kept quiet like every other ask) print nothing.
 */
function sayPaused(
  name: HookName,
  verdict: ScopeVerdict,
  here: string,
  whose: "folder" | "session",
  payload: Record<string, unknown>,
  said: Said,
  configPath: string,
): void {
  if (name !== "session-start") return;
  if ((process.env[NIGHT_RUN_ENV] ?? "").trim().length > 0) return;
  const notice = pausedNotice(verdict, here, { whose, ...hookScopeContext(configPath) });
  if (notice === null) return;
  // The SessionStart envelope every notice rides (`hostDelivery`): the person's
  // line as `systemMessage`, the model's as `additionalContext`.
  const delivery = hostDelivery(name, { injection: notice.model, ask: null }, payload, [notice.person]);
  process.stdout.write(delivery.stdout);
  said.wroteStdout = true;
}

export function toHookInput(
  payload: Record<string, unknown>,
  opts: {
    /** The scope this session is filed under, when the caller already resolved
     *  it. Absent: resolved here, from the registry under `dataDir`. */
    readonly scope?: string;
    readonly dataDir?: string;
    readonly env?: NodeJS.ProcessEnv;
    /** The config's `timeZone`; absent, the machine's current zone. */
    readonly timeZone?: string;
  } = {},
): HookInput {
  const scope = opts.scope ?? sessionScope(opts.dataDir, payload, opts.env ?? process.env);
  const transcriptPath =
    typeof payload["transcript_path"] === "string" && payload["transcript_path"].length > 0
      ? payload["transcript_path"]
      : undefined;
  const transcript = readTranscript(transcriptPath);
  return {
    sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
    scope,
    turns: transcript.turns,
    expansions: transcript.expansions,
    // A named transcript that would not read is not an empty conversation.
    ...(transcriptPath !== undefined && !transcript.ok ? { turnsUnread: true } : {}),
    // THE PATH ITSELF, beside the parse of it. The delivery check reads the head
    // of the same file for the attachment `parseTranscript` deliberately skips
    // (`hooks.ts#checkWakeArrival`), and a parsed turn list cannot answer for
    // what the host injected.
    ...(transcriptPath === undefined ? {} : { transcriptPath }),
    // The model that last answered, for the session record (and so the chapter).
    ...(transcript.model === undefined ? {} : { model: transcript.model }),
    // The host's re-fire of a blocked Stop, carried INTO the adapter and not
    // only handled at delivery: the pass that says nothing must also advance
    // nothing (`hooks.ts#askAtStop`).
    ...(payload["stop_hook_active"] === true ? { reFired: true } : {}),
    ...(typeof payload["prompt"] === "string" ? { prompt: payload["prompt"] } : {}),
    // Why a SessionStart fired (2026-10-11): a resume is handed a short wake.
    ...(typeof payload["source"] === "string" && payload["source"].length > 0 ? { source: payload["source"] } : {}),
    // The headless nightly run's child (`night-run.ts` sets this, 2026-09-29):
    // a windowless session our hooks keep QUIET — no capture, no asks.
    ...(((opts.env ?? process.env)[NIGHT_RUN_ENV] ?? "").trim().length > 0 ? { nightRun: true } : {}),
    // HOW THE HOST WAS STARTED (review of #285, N2): the host sets
    // `CLAUDE_CODE_ENTRYPOINT` at startup — `cli` at a terminal, `sdk-cli` for
    // `claude -p` — and its hooks inherit it. Absent or odd: not carried.
    ...(isEntrypoint((opts.env ?? process.env)["CLAUDE_CODE_ENTRYPOINT"])
      ? { entrypoint: (opts.env ?? process.env)["CLAUDE_CODE_ENTRYPOINT"] as string }
      : {}),
    // IS SOMEONE THERE (2026-10-01, lane 8): the host's own word, when it
    // gives one, ahead of the entrypoint list (`hooks.ts#isInteractive`).
    ...attendedOf((opts.env ?? process.env)["CLAUDE_CODE_SESSION_ATTENDED"]),
    // THE PERSON'S DAY (docs/time.md, 2026-09-25; UTC before). It dates the
    // hook's rows, the wake preface, the prospective "today" and the date the
    // boundary hands the lived clock — which is why the lived clock can see a
    // date one day BEHIND its last on the evening of an upgrade west of UTC,
    // or after flying west: the store refuses it (`CLOCK_BACKWARDS`), the
    // cycle stays on the day it already believed, and the next local date
    // moves it on (store NOTES 2026-09-25).
    at: todayIn(resolveZone(opts.timeZone)),
  };
}

/**
 * THE TWO EVENTS THE HOST DISPLAYS A `systemMessage` ON — measured by the
 * owner's probe on 2026-09-11 and re-stated in `hostDelivery` below. Every other
 * event's stand-down has nowhere to be seen, so it stays on stderr alone.
 */
const SAYS_SO_HOOKS: readonly SaysSoHook[] = ["session-start", "user-prompt-submit"];

/** Narrowed, so the say rule is written against the two events it is about. */
function saysSo(hook: HookName): hook is SaysSoHook {
  return (SAYS_SO_HOOKS as readonly HookName[]).includes(hook);
}

/**
 * MAY THIS EVENT'S FAULT REACH THE OWNER'S TERMINAL AT ALL — the three gates,
 * ahead of the question of what to say (`standdown.ts#decideSay`).
 *
 * Exported because a close-time throw cannot be induced from a hermetic test:
 * it needs a patched tree, which is how the review that found the `didWork` gap
 * proved it. The rule is worth pinning even so, and a pure predicate is the
 * honest shape for a thing a process cannot reach.
 */
export function reachesTheOwner(
  said: Pick<Said, "hook" | "wroteStdout" | "didWork">,
): said is Pick<Said, "hook" | "wroteStdout" | "didWork"> & { hook: SaysSoHook } {
  // The work already happened, so this is the tidying-up failing: stderr's.
  if (said.didWork) return false;
  // Nothing may follow the wake, or stdout stops parsing as JSON.
  if (said.wroteStdout) return false;
  // And only where the host displays a `systemMessage` at all.
  return saysSo(said.hook);
}

/**
 * WHAT THE STAND-DOWN PATH KNOWS ABOUT THIS EVENT SO FAR.
 *
 * Filled in as `main` learns each fact, because a fault can arrive before any of
 * them is known: an unopenable store throws after the configuration is read, a
 * refused configuration throws before there is a store to mark anything in.
 */
interface Said {
  readonly hook: HookName;
  readonly sessionId: string;
  /** The store this run meant to use, once a configuration named one. */
  dataDir: string | undefined;
  /**
   * TRUE once anything has gone to stdout. Nothing may follow it: the host reads
   * stdout as JSON only when the WHOLE of it parses, so a JSON object printed
   * after the wake would turn the wake into plain text and inject the warning
   * into the model's context instead of showing it to the owner.
   */
  wroteStdout: boolean;
  /**
   * TRUE once this event's WORK IS DONE — recall composed, the turn captured,
   * the session record written. A failure after that point is not a failure of
   * the turn, and must not be reported as one.
   *
   * It is a second flag rather than a reading of `wroteStdout`, and the review
   * that found this says why: `wroteStdout` is an ORDERING guard, and on
   * SessionStart the two coincide because SessionStart always writes stdout.
   * On UserPromptSubmit they come apart — an ordinary prompt with nothing to
   * inject writes nothing — so a throw from the `close()` in the `finally`
   * below, which is I38's own shape, told the owner "skipped this turn" about a
   * turn that had just succeeded. A warning that is sometimes false is the one
   * outcome this whole track cannot afford.
   */
  didWork: boolean;
  /** This event's process log, once a configuration named a store (`adapters/log/`). */
  log?: ProcessLog;
}

/**
 * ONE LINE ON STDERR ALWAYS — AND, WHEN THIS WAS A FAULT, ONE RED LINE WHERE
 * THE OWNER WILL SEE IT.
 *
 * Exit code is untouched (0, always) and nothing else is injected: no wake, no
 * context, just the `systemMessage` the host displays. WHAT to say and WHETHER
 * to say it is `standdown.ts#decideSay`'s, which is the rule that tells a store
 * that will not open from a database that was merely busy; this function is the
 * process end of it — the two channels, the mark, and the ordering.
 *
 * `marker` is false for the two configuration refusals — the first has no store
 * at all, and the second stands down precisely so as not to touch the DEFAULT
 * store's host state on the way out (see its call site) — so those keep no count
 * and say it every turn. `standdown.ts` states why saying it again beats saying
 * nothing.
 */
function standDown(
  said: Said,
  what: { readonly line: string; readonly fault: StandDownFault | null; readonly marker: boolean },
): void {
  process.stderr.write(`[counterparts] hook stood down: ${what.line}\n`);
  const fault = what.fault;
  if (fault === null) return;
  if (!reachesTheOwner(said)) return;
  const dataDir = what.marker ? said.dataDir : undefined;
  const decision = decideSay(fault, said.hook, said.sessionId, readMark(dataDir, said.sessionId));
  // THE MARK IS WRITTEN EITHER WAY. A busy database nobody was told about is
  // still one this session has met, and the count is what decides the next one.
  writeMark(dataDir, said.sessionId, decision.mark);
  if (decision.message === null) return;
  process.stdout.write(JSON.stringify({ systemMessage: decision.message }));
  said.wroteStdout = true;
}

/**
 * A configuration refusal as a REASON clause. `config-path.ts` writes its
 * sentences to stand alone on stderr, so each opens with `refused: ` — which
 * inside this message would read "memory is OFF for this session: refused: …".
 * Said once.
 */
function refusalReason(sentence: string): string {
  const opener = "refused: ";
  return sentence.startsWith(opener) ? sentence.slice(opener.length) : sentence;
}

async function main(): Promise<void> {
  let payload: Record<string, unknown> = {};
  try {
    const text = await readStdin();
    if (text.trim().length > 0) payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* an unreadable payload is a quiet hook, never a failed session */
  }
  const name = HOST_HOOKS[String(payload["hook_event_name"] ?? "")];
  if (name === undefined || !HOOKS.includes(name)) return;

  // WHICH CONFIGURATION, decided before anything is read and refused rather
  // than guessed. A caller who named one and named it badly gets a stand-down,
  // never a silent fall-back onto the default store (`config-path.ts`).
  const choice = hookConfigChoice();
  const said: Said = {
    hook: name,
    sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
    dataDir: undefined,
    wroteStdout: false,
    didWork: false,
  };
  // THE PLUGIN'S PREAMBLE (`adapters/plugin.ts`), and only when Claude Code
  // launched this process as the Counterparts plugin. Two questions before
  // anything opens: is the npm install's wiring live in this host (then the
  // plugin stands down, and says so once, at session start), and does this
  // machine have an install at all (then the plugin makes one, the way
  // `counterparts install` does). A settings-wired hook never gets here.
  const pluginLines: string[] = [];
  if (runningAsPlugin(process.env)) {
    const home = homedir();
    const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? eventDirectory(payload);
    const gate = hookGate(
      npmWiring({ home, env: process.env, cwd: projectDir, read: { mcp: false } }),
      home,
      // Where the plugin was loaded from changes only the session-start line.
      name === "session-start" ? pluginOrigin({ home, env: process.env, cwd: projectDir }) : undefined,
    );
    if (gate.standDown) {
      process.stderr.write("[counterparts] plugin hook stood down: the npm install's hooks are live in this host\n");
      if (name === "session-start") {
        // The npm install speaks for this memory, and said its own words when
        // it was installed: a first run the plugin made beside it is not this
        // hook's to announce, now or after a later move to the plugin.
        takeFirstRunNotice(firstRunNoticePath(choice.path));
        if (gate.line !== null) process.stdout.write(JSON.stringify({ systemMessage: gate.line }));
      }
      return;
    }
    if (gate.line !== null) pluginLines.push(gate.line);
    try {
      const first = ensureFirstRun({ choice, env: process.env, home });
      if (first.detail !== undefined) process.stderr.write(`[counterparts] plugin first run ${first.state}: ${first.detail}\n`);
      if (first.line !== null) pluginLines.push(first.line);
      // THE FIRST RUN IS SAID AT THE FIRST SESSION START, whoever made it
      // (`plugin.ts#firstRunNoticePath`). The server usually has: since #342's
      // sidebar module, Claude Code runs this hook after its hooks worker
      // starts, and the server's install is done by then — so `existed` takes
      // the notice too. Only at session start, where the line can be shown; an
      // install a prompt made waits for the next one.
      if (
        name === "session-start" &&
        first.line === null &&
        (first.state === "created" || first.state === "joined" || first.state === "existed") &&
        takeFirstRunNotice(firstRunNoticePath(choice.path))
      ) {
        pluginLines.push(firstRunLine(choice.path, home));
      }
    } catch (err) {
      // A first run that threw is a stand-down further on (no configuration,
      // so the default store's guard decides), never a failed session.
      process.stderr.write(`[counterparts] plugin first run threw: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  // THE FAULT HANDLER, HERE RATHER THAN AT THE ENTRY POINT, because this is
  // where the event's own facts are in scope — which hook, which session, which
  // store — and all three are needed to say a stand-down out loud once. The
  // entry point's handler below stays exactly what it was: the last resort for
  // anything that fails before any of this is known.
  try {
    await runHook(name, payload, choice, said, pluginLines);
  } catch (err) {
    // MASTER'S EXIT CODE, RESTORED EXACTLY. On master a throw out of `main`
    // reached the entry point's rejection handler, which always exits 0 — so a
    // Stop that had set `exitCode = 2` for an ask and then threw on `close()`
    // exited 0. Catching the throw HERE let that 2 survive, which would have
    // blocked the stop and fed this hook's whole stderr back to the model as
    // Stop-hook feedback. Maybe an improvement; not this PR's to make. The one
    // thing that changes on this branch is that two displayed events gain a
    // `systemMessage`.
    process.exitCode = 0;
    said.log?.threw(err);
    const detail = err instanceof Error ? err.message : String(err);
    const remedy = `Set "dataDir" in ${choice.path}, or set ${DATA_DIR_ENV}.`;
    standDown(said, {
      line: describeGuardRefusal(err, remedy) ?? detail,
      fault: classifyStandDown(err),
      marker: true,
    });
  }
}

async function runHook(
  name: HookName,
  payload: Record<string, unknown>,
  choice: ConfigChoice,
  said: Said,
  /** The plugin's own session-start lines (first run, stale npm entries);
   *  empty for every hook the plugin did not launch. */
  pluginLines: readonly string[] = [],
): Promise<void> {
  // `namedConfigRefusal` covers the flag's own refusals AND the one the first
  // review of this rule found: an absolute path to a file that is not there was
  // honoured silently, read as an absent config, and fell through to `dataDir()`
  // — the live store on any machine with an install. An absent DEFAULT is still
  // ordinary; this only ever refuses a path somebody named.
  //
  // `implicitConfigRefusal` is the explicit-dir guard at this door: with
  // `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` an UNNAMED configuration stands the
  // hook down too, because the default one names a store. The live host never
  // sets it, so the no-flag, no-env case there resolves exactly what it did.
  //
  // ONE OF THE TWO IS A FAULT AND THE OTHER IS NOT. A configuration somebody
  // NAMED and that could not be honoured is the third of the three invisible
  // stand-downs H1 is about — a typo, and the adapter is off with nothing said.
  // The guard's refusal keeps the treatment it has: it is the normal state of
  // every agent and test shell in this project, and a red line in each of them
  // is how a warning becomes wallpaper (`standdown.ts#isDeliberate`).
  const named = namedConfigRefusal(choice);
  const refusal = named ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    // No marker: nothing has named a store yet, so there is nowhere to keep one.
    standDown(said, {
      line: refusal,
      fault:
        named === null ? null : { code: CONFIG_REFUSED, reason: refusalReason(named), kind: "persistent" },
      marker: false,
    });
    return;
  }
  // WHICH DIRECTORY, AND WHAT THIS HOST WAS TOLD ABOUT IT — decided here,
  // before a store is opened, because that ordering is the whole guarantee
  // (`../CONTRACT.md` §5 G13): a directory set `off` produces no output and no
  // write because nothing was ever constructed to produce either. An
  // unreadable registry resolves to `unset` (⇒ on, today's behaviour) and is
  // reported as a ring event once the adapter that owns the ring exists.
  //
  // THE EVENT'S OWN DIRECTORY IS CHECKED FIRST AND ALONE, and that ordering is
  // load-bearing: it is what keeps an `off` directory's silence byte-for-byte
  // what it was. Nothing has been read but the registry at this point — not the
  // configuration, not the session record — so a directory the owner opted out
  // of still costs exactly one small file read and returns. The session's own
  // directory is folded in below, once there is a store path to look it up in.
  const eventDir = eventDirectory(payload);
  const { verdict: eventVerdict, read } = hookScopeVerdict(choice.path, eventDir);
  if (stanceOfMode(eventVerdict.mode) === "off") {
    // `off` is silent on BOTH channels, deliberately. It is an opt-out, not an
    // observer stand-down: there is no store to log to without writing one, and
    // UserPromptSubmit fires every turn, so a line per event would be a
    // permanent noise floor in the host's log for a directory that asked to be
    // left alone. The record that this happened is the registry itself, which
    // `counterparts scope <path>` prints on demand.
    //
    // `paused` says ONE LINE, at SessionStart only (rulings brief #19,
    // 2026-10-10; `sayPaused`): a pause is meant to end, and on 10-09 three
    // sessions ran without memory for ten minutes before anyone noticed. It is
    // printed from what was already read — the registry — and nothing is
    // written; every other event stays as silent as `off`.
    //
    // UNLESS THE SESSION'S OWN FOLDER IS `off` (review of #362): a session that
    // started in one and whose shell stands in a paused folder is off whatever
    // this folder says, so "resume turns it back on" would be a false promise.
    // `startDirectory` is the environment and the payload — the session record
    // agrees with it by construction (`sessionScope`) — so still nothing but the
    // registry is read.
    const sessionOff =
      name === "session-start" &&
      eventVerdict.mode === "paused" &&
      lookupScope(read.registry, startDirectory(payload)).mode === "off";
    if (!sessionOff) sayPaused(name, eventVerdict, eventDir, "folder", payload, said, choice.path);
    return;
  }
  // A REGISTRY IN TROUBLE IS NOT SILENT, and that is a DIFFERENT exception from
  // the one above (#92 review, F2). `off` is silent because the owner said leave
  // this alone; a file that could not be read — or an entry in it that could not
  // — has said nothing at all, and its fail direction is `unset`, which is ON.
  // The review's measurement: one typo'd mode turned every correctly typed `off`
  // in the file on, with the only evidence a ring event in a process that lives
  // for one turn. So: one line, on SessionStart ONLY (UserPromptSubmit fires
  // every turn and this is a warning, not a nag), AFTER the `off` return above
  // so that the silence of an off directory stays byte-for-byte.
  //
  // AND WHERE THE OWNER CAN SEE IT (I40, 2026-09-23). stderr from a hook that
  // exits 0 goes to the host's debug log and nowhere else, so this line was
  // written for nobody. It now rides the SessionStart `systemMessage` — the
  // channel the doctor notice already uses, and the one the owner's probe
  // measured displaying (`SAYS_SO_HOOKS`) — AFTER that notice and only if it
  // still fits (`hostDelivery`'s priority order). The stderr copy stays, for the
  // debug log and for the morning the envelope has no room for it.
  const trouble = name === "session-start" ? describeScopeTrouble(read, scopesPath(choice.path)) : null;
  if (trouble !== null) process.stderr.write(`${trouble}\n`);
  const { config: loaded, reason } = hostConfig(choice.path);
  // THE THIRD ARM, and it is answered BEFORE anything reads under `dataDir`: a
  // named file that parses but whose fields do not typecheck resolves to
  // observer, and an observer with no `dataDir` reads the DEFAULT store.
  // Standing down is the only answer that keeps the promise the flag makes, and
  // standing down before the session registry is consulted is what keeps it from
  // touching the default store's host state on the way out. An unreadable
  // DEFAULT is unchanged — observer, as it always was.
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    // Said out loud, and with NO marker: `hostConfig` has already resolved
    // `dataDir` to the DEFAULT store, and leaving a file under it is exactly the
    // host state this stand-down exists to keep its hands off. So it says it
    // every turn instead — the cost of not touching a store this run refused.
    standDown(said, {
      line: unreadable,
      fault: { code: CONFIG_UNREADABLE, reason: refusalReason(unreadable), kind: "persistent" },
      marker: false,
    });
    return;
  }
  // From here the configuration was understood, so the store it names is the one
  // a stand-down may leave its once-per-session mark under.
  said.dataDir = loaded.dataDir;
  // THE SESSION'S OWN DIRECTORY — the one everything this event captures will be
  // FILED under, whatever directory the agent's shell has wandered into. It is
  // resolved here rather than above because its first source is the session
  // registry, which lives under the store the configuration names.
  const scope = sessionScope(loaded.dataDir, payload);
  // AND PRIVACY FOLLOWS BOTH DIRECTORIES, most restrictive winning. Filing
  // follows the session; a session that walks into a directory the owner set
  // `off` or `observer` goes at least as quiet as that directory, or the stable
  // scope would have become a way to carry capture past an opt-out. The
  // session's verdict is first, so it wins a tie and its `unset` is the one that
  // raises the first-launch question.
  const verdict = mostRestrictiveVerdict(lookupScope(read.registry, scope), eventVerdict);
  if (stanceOfMode(verdict.mode) === "off") {
    // Silent, for the same reason the event-directory return above is silent —
    // and reached only when the session's OWN directory is the one that is off,
    // which is a session whose SessionStart ran somewhere the owner opted out
    // of. Nothing has been written; the configuration and the session record
    // were read, and neither is a write. A `paused` session directory says its
    // one SessionStart line here too (a compaction, or a start whose
    // `CLAUDE_PROJECT_DIR` is paused while the shell stands elsewhere).
    sayPaused(name, verdict, scope, "session", payload, said, choice.path);
    return;
  }
  // THE COMBINATION: the most restrictive of what the configuration said and
  // what the registry says (`adapters/scopes.ts#effectiveStance`, applied here
  // by folding the registry's `observer` into the config the adapter opens on).
  // It only ever adds restriction, which is why the three private directories
  // running on an observer CONFIG are untouched by any of this.
  const config: AdapterConfig =
    verdict.mode === "observer" ? { ...loaded, observer: true } : loaded;
  // THE PROCESS LOG (`adapters/log/`) is opened once the store has, below: a
  // store this build refuses gets no lines (its stand-down marker, stderr and
  // `systemMessage` say so), and every line lands where SessionStart prunes.
  // Until then the adapter's events go through this closure to nothing.
  let log: ProcessLog | null = null;
  const toLog = (e: LogEvent): void => log?.event(e);
  const adapter = openAdapter(config, {
    command: process.execPath,
    args: scriptArgs(RUNNER_PATH),
    nightArgs: scriptArgs(NIGHTLY_PATH),
    // WHICH FILE THIS RUN READ, carried into the adapter so it can be RECORDED:
    // a hook cannot print to the owner (its stdout is the model's context), so
    // the answer goes into the session registry record and the event ring
    // instead. It is also pinned onto the worker's environment, so the child
    // reads the same file its parent did rather than resolving one of its own.
    configPath: choice.path,
    // How the first-launch question's console line must read here: the
    // plugin's launcher under the plugin, `--config` for another registry.
    scopeCommand: hookScopeContext(choice.path),
    // How this copy came, for doctor's fix lines in the session notice.
    install: installRoute(process.env),
    // The verdict travels IN: it is a fact about this process's startup, decided before anything opened, and
    // the adapter's jobs with it are to record it and — when it is `unset` — to
    // ask the question once (G41).
    scope: verdict,
    ...(read.error === null ? {} : { scopeUnreadable: read.error }),
    ...(read.refused.length === 0 ? {} : { scopeRefused: read.refused.map((r) => r.key) }),
    onEvent: toLog,
    onCounterpartEvent: toLog,
  });
  const opened = openLog({
    dataDir: adapter.counterpart.store.dir,
    proc: `hook:${name}`,
    session: said.sessionId,
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    observer: config.observer === true,
  });
  log = opened;
  said.log = opened;
  // No start line at a prompt, the most frequent event: its end carries `ms`.
  if (name !== "user-prompt-submit") opened.start();
  // ONE DELIVERY PER EVENT (`../claim.ts`, 2026-10-09). Two wirings of
  // Counterparts live in this host both run this event at once; the first to
  // claim it does the whole job — the wake, the recall, the ask, the boundary,
  // the worker — and its twin leaves here, before any of it, with no output.
  // Fail-open: no claim made is a delivery, so one wiring is exactly as it was.
  const claimKey = deliveryClaimKey(name, payload);
  const claim = claimDelivery(adapter.counterpart, {
    hook: name,
    key: claimKey,
    sessionId: said.sessionId,
    side: runningAsPlugin(process.env) ? "plugin" : "settings",
    observer: config.observer === true,
    // A session-opening start or an identified prompt is sent once, so a twin
    // whose runtime came up late is still a twin (`../claim.ts#firesOnce`).
    once: firesOnce(name, payload),
  });
  // A CLAIMS FILE THAT WAS NOT A DATABASE was set aside and rebuilt on the way
  // (review of #359): said once, here, and kept as the copy doctor reads.
  if (claim.setAside !== undefined) {
    process.stderr.write(`[counterparts] ${name}: the claims file could not be read; set aside as ${claim.setAside} and made again\n`);
  }
  if (claim.outcome === "lost") {
    process.stderr.write(
      `[counterparts] ${name} stood down by claim: another Counterparts hook (${claim.heldBy ?? "?"}) already took this event — two wirings are live in this host\n`,
    );
    try {
      adapter.counterpart.close();
    } finally {
      opened.end("claimed-elsewhere", { heldBy: claim.heldBy ?? null });
    }
    return;
  }
  // A CLAIM THAT COULD NOT BE WRITTEN goes into the process log's end line
  // either way. Only a FAULT (the claims file cannot be made, opened or written)
  // is said on stderr too, the host's debug log, where someone chasing two wakes
  // would look. Contention is not: another claim held the file past
  // `CLAIM_WAIT_MS`, it passes, and with one wiring nothing was lost.
  const unclaimed =
    claim.outcome === "unclaimed" && claim.detail !== undefined && claim.detail !== "no session id" && claim.detail !== "observer"
      ? claim.detail
      : null;
  if (unclaimed !== null && claim.busy !== true) {
    process.stderr.write(`[counterparts] ${name} delivered unclaimed: ${unclaimed}\n`);
  }
  let outcome = "ok";
  try {
    // ONE read of the transcript, shared by the hook and the notice: `toHookInput`
    // opens and parses the transcript file, and calling it twice would pay for
    // that twice on the hot path. The scope is handed IN rather than resolved
    // again: it was decided above, the registry verdict was taken on it, and two
    // resolutions of one value is the shape scar §2.13 is about.
    const input = toHookInput(payload, {
      scope,
      ...(loaded.timeZone === undefined ? {} : { timeZone: loaded.timeZone }),
    });
    const result = adapter.hook(name, input);
    outcome = result.reason;
    // THE WORK HAPPENED. Recall was composed, the turn was captured, the session
    // record was written — whatever this event's job was, `adapter.hook` has
    // done it and swallowed its own failures doing so (§5 G2). Anything that
    // throws from here on is a failure of the tidying-up, not of the turn, and
    // `standDown` keeps it to stderr.
    said.didWork = true;
    // THE NOTICE, AFTER THE WAKE AND ONLY AT SESSION START. Never on
    // user-prompt-submit: the owner asked for a warning, not a nag. `notice()`
    // is red-only, bounded, and returns null rather than throwing, so the line
    // below cannot change what the wake does on a healthy day.
    // In PRIORITY order (review M1): the doctor notice first, because it has no
    // other route to the owner; the registry line second, because it also has
    // stderr. A line that does not fit is left out, never the wake.
    //
    // AND THE UPDATE NOTICE AT A PROMPT (roadmap E, 2026-09-23), fail-open
    // (`deliverTurn`): once per session, when the MCP server this session talks
    // to runs an older build than this installed one.
    //
    // AND PLAIN REMINDERS (2026-09-26), at both events, FIRST — `deliverTurn`
    // adds them from `result.plain` and claims them only once the envelope is
    // known to carry them (2026-09-26 review): a plain beat is spent once and
    // never comes back, while the doctor's line returns at the next start.
    const delivery = deliverTurn(
      name,
      result,
      payload,
      name === "session-start" ? [adapter.notice(input), ...pluginLines, trouble] : null,
      adapter,
      input,
    );
    if (delivery.stdout.length > 0) {
      process.stdout.write(delivery.stdout);
      // Recorded, not inferred: a fault thrown after this point (the close in
      // the `finally` below is inside the same try) may not print a second
      // object, or the wake stops being JSON and lands in the model's context.
      said.wroteStdout = true;
    }
    if (delivery.stderr.length > 0) process.stderr.write(delivery.stderr);
    process.exitCode = delivery.exitCode;
    // EVERYTHING BELOW IS AFTER THE WRITE, on purpose (#187 re-review, N4): the
    // wake and the turn's recall are already out, so nothing here can cost
    // them. A SESSION THAT OPENS is stamped with the build that saw it open —
    // never a compaction, which is the same session and server carrying on.
    stampWhenOpened(payload, () => adapter.stampOpened(input));
    // A notice the envelope could not carry leaves a row rather than nothing:
    // "the terminal said nothing" and "there was nothing to say" are different
    // facts about the same morning (scar §2.4). AFTER the write since the rows
    // became durable (review of #318): a write lock may not delay the wake.
    if (delivery.dropped !== null) adapter.noteNoticeDropped(delivery.dropped);
    // PAST THE HOST'S CAP EVEN IN PLAIN FORM: the host shows a preview. Said
    // where a person can find it (the host's debug log), and on the ring.
    if (delivery.overCap !== undefined) {
      adapter.noteOverCap(delivery.overCap);
      process.stderr.write(`[counterparts] adapter.envelope.overcap: ${JSON.stringify(delivery.overCap)}\n`);
    }
    // The update notice's decisions, where a person can find them (the host's
    // debug log): its ring rows die with this process otherwise. Written only
    // on a turn that had something to decide — due, shown, dropped, failed.
    if (name === "user-prompt-submit") {
      for (const e of [...adapter.events("adapter.update.notice"), ...adapter.events("adapter.notice.dropped")]) {
        process.stderr.write(`[counterparts] ${e.name}: ${JSON.stringify(e.data)}\n`);
      }
    }
  } finally {
    // The claim says it is done, so the next event that looks the same — one
    // that starts after this — is not taken for this one's twin (`../claim.ts`).
    if (claim.outcome === "won" && claimKey !== null && claim.at !== undefined) {
      finishClaim(adapter.counterpart, claimKey, claim.at, Date.now(), claim.token);
    }
    adapter.counterpart.close();
  }
  // A throw above never reaches this line: `main`'s handler writes it instead.
  // The reason as its CODE (review of #359): the log writes a sentence as its
  // length (`[text:N]`), and a length is no reason.
  opened.end(outcome, {
    ...(unclaimed === null ? {} : { unclaimed: claim.code ?? "unknown", busy: claim.busy === true }),
    ...(claim.setAside === undefined ? {} : { claimsSetAside: true }),
  });
}

/** `CLAUDE_CODE_SESSION_ATTENDED` as `HookInput.attended`: `1`/`true` and
 *  `0`/`false`; anything else says nothing. */
export function attendedOf(raw: string | undefined): { attended?: boolean } {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "1" || v === "true") return { attended: true };
  if (v === "0" || v === "false") return { attended: false };
  return {};
}

/** The two adapter doors `deliverTurn` needs — structural, so a test can
 *  hand it doors that throw. */
export interface UpdateNoticeDoors {
  updateNotice(input: HookInput): string | null;
  markUpdateNotice(input: HookInput): boolean;
  /**
   * Claim plain reminders this delivery is certainly about to show, returning
   * the ones claimed (`ClaudeCodeAdapter#claimPlain`). Absent: nothing can be
   * claimed, so nothing is shown and every one waits for a later turn.
   */
  claimPlain?(input: HookInput, due: readonly PlainReminder[]): readonly PlainReminder[];
  /**
   * Claim the day's dream line this delivery is certainly about to show
   * (`ClaudeCodeAdapter#claimDream`). Absent: nothing can be claimed, so the
   * line is not shown and waits for a later prompt.
   */
  claimDream?(input: HookInput, offer: DreamOffer): boolean;
  /**
   * Claim a HELD dream line — a run a session nobody watched started — this
   * delivery is certainly about to show (`ClaudeCodeAdapter#claimHeld`,
   * 2026-10-01). Absent: nothing can be claimed, so it waits.
   */
  claimHeld?(input: HookInput, run: string): boolean;
  /** Claim the one-time line about `auto` set back to `ask` (`ClaudeCodeAdapter#claimDreamNote`). */
  claimDreamNote?(input: HookInput): boolean;
  /**
   * Record what this delivery left for later for want of ROOM — `plain`
   * reminders (how many), the `dream` offer, the `update-notice`
   * (`ClaudeCodeAdapter#noteGaveWay`). Absent: nothing is recorded.
   */
  noteGaveWay?(input: HookInput, part: string, count: number): void;
}

/**
 * THIS EVENT'S OUTPUT, WITH PLAIN REMINDERS AND THE UPDATE NOTICE FOLDED IN
 * FAIL-OPEN (roadmap E; #187 re-review, N4; 2026-09-26 review).
 *
 * PLAIN REMINDERS FIRST, and under the update notice's own rule — MARK ONLY
 * WHAT IS CERTAINLY LEAVING. A plain beat is spent once and never comes back,
 * so it is claimed only after the envelope is known to carry its line to the
 * terminal, and it goes ahead of every other notice (the doctor's red line
 * returns at the next start; the beat would not). A turn with no room — a full
 * wake at SessionStart — claims nothing and strips the lines from the model's
 * context too (`withoutPlain`), so the first prompt, whose envelope is small,
 * says them instead. A line whose claim is lost to another process is stripped
 * the same way.
 *
 * Then the update notice: the delivery without it is the answer whenever
 * anything about it goes wrong — a door that throws, a mark that will not
 * land, an envelope with no room for it — so it can never cost a line that
 * already fit. It is MARKED only once it is certainly leaving and SHOWN only if
 * the mark landed, so it never repeats and is never marked-but-lost; a turn
 * whose recall leaves no room marks nothing and tries again next turn.
 */
export function deliverTurn(
  name: HookName,
  result: {
    injection: string | null;
    ask: string | null;
    notices?: readonly string[];
    plain?: readonly PlainReminder[];
    dream?: DreamTold;
    dreamNote?: { notice: string; context: string };
  },
  payload: Record<string, unknown>,
  /** SessionStart's priority-ordered notices (after any plain reminders), or
   *  null. At a prompt, null: the plain lines come from `result.plain`. */
  notices: readonly (string | null)[] | null,
  doors: UpdateNoticeDoors,
  input: HookInput,
): Delivery {
  let r = result;
  let ordered = notices;
  let deferred: Delivery["dropped"] = null;
  const due = result.plain ?? [];
  if (due.length > 0) {
    // The longest run, in order, whose lines the envelope carries: a day with
    // more plain items than room says what fits and keeps the rest for later.
    let fits = 0;
    for (let k = due.length; k > 0; k--) {
      const probe = hostDelivery(name, r, payload, [due.slice(0, k).map(plainLine).join("\n")]);
      if (probe.dropped === null) {
        fits = k;
        break;
      }
      if (k === due.length) deferred = probe.dropped;
    }
    let claimed: readonly PlainReminder[] = [];
    if (fits > 0) {
      try {
        claimed = doors.claimPlain?.(input, due.slice(0, fits)) ?? [];
      } catch {
        claimed = [];
      }
    }
    // By the beat's identity, not the object's: a door may hand back copies.
    const beat = (x: PlainReminder): string => `${x.memoryId} ${x.windowKey} ${x.beat}`;
    const kept = new Set(claimed.map(beat));
    const shownPlain = due.filter((d) => kept.has(beat(d)));
    // WHAT GAVE WAY, as delivered: the reminders the envelope had no room for
    // (a lost claim race is not room, and is recorded by `claimPlain`).
    if (fits < due.length) gaveWay(doors, input, "plain", due.length - fits);
    r = withoutPlain(r, due.filter((d) => !kept.has(beat(d))));
    if (shownPlain.length > 0) ordered = [shownPlain.map(plainLine).join("\n"), ...(notices ?? [])];
  }
  // THE DAY'S DREAM LINE (2026-09-29), after the plain reminders and under
  // their rule: an ask is CLAIMED only once the envelope is known to carry the
  // person's line, and without room it waits — its model line stripped too, so
  // the model never answers a question the person was not shown. A line whose
  // day is already claimed (the headless run has started) keeps its model line
  // and only loses the terminal one.
  const told = r.dream;
  if (told !== undefined) {
    const probe = hostDelivery(name, r, payload, [...(ordered ?? []), told.notice]);
    let showDream = false;
    if (probe.dropped === null) {
      if (told.held !== undefined) {
        try {
          showDream = doors.claimHeld?.(input, told.held) ?? false;
        } catch {
          showDream = false;
        }
      } else if (told.offer === null) showDream = true;
      else {
        try {
          showDream = doors.claimDream?.(input, told.offer) ?? false;
        } catch {
          showDream = false;
        }
      }
    } else {
      if (deferred === null) deferred = probe.dropped;
      gaveWay(doors, input, "dream", 1);
    }
    if (showDream) ordered = [...(ordered ?? []), told.notice];
    else if (told.offer !== null || told.held !== undefined) r = withoutDream(r);
  }
  // THE ONE-TIME RESET LINE (owner decision A), under the same rule.
  const note = r.dreamNote;
  if (note !== undefined) {
    const probe = hostDelivery(name, r, payload, [...(ordered ?? []), note.notice]);
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
    if (shownNote) ordered = [...(ordered ?? []), note.notice];
    else r = withoutDreamNote(r);
  }
  const shown = hostDelivery(name, r, payload, ordered);
  const base = shown.dropped === null && deferred !== null ? { ...shown, dropped: deferred } : shown;
  if (name !== "user-prompt-submit") return base;
  try {
    const update = doors.updateNotice(input);
    if (update === null) return base;
    const carried = hostDelivery(name, r, payload, [...(ordered ?? []), update]);
    if (carried.dropped !== null) {
      gaveWay(doors, input, "update-notice", 1);
      return { ...base, dropped: base.dropped ?? carried.dropped };
    }
    return doors.markUpdateNotice(input) ? carried : base;
  } catch {
    return base;
  }
}

/** `doors.noteGaveWay`, fail-open: a record that cannot be made costs nothing. */
function gaveWay(doors: UpdateNoticeDoors, input: HookInput, part: string, count: number): void {
  try {
    doors.noteGaveWay?.(input, part, count);
  } catch {
    /* bookkeeping */
  }
}

/**
 * SessionStart's stamp on a session that OPENS, and nothing else: run AFTER the
 * wake is written (`main`), and swallowed if it throws — the stamp is
 * bookkeeping for the update notice, and a failed one costs that notice its
 * precision, never the wake (#187 re-review, N4).
 */
export function stampWhenOpened(payload: Record<string, unknown>, stamp: () => unknown): void {
  if (!opensASession(payload)) return;
  try {
    stamp();
  } catch {
    /* bookkeeping; see above */
  }
}

/**
 * How each hook's output reaches the model on THIS host — measured, not
 * assumed (scar §2.18), on day 0 of the parallel run (2026-09-03):
 *
 *   - SessionStart / UserPromptSubmit: plain stdout with exit 0 is added to the
 *     model's context. The wake (8,859 B) arrived that way.
 *   - Stop: plain stdout with exit 0 reaches NOBODY. An ask written that way
 *     was recorded (`adapter.episode.ask asked:true`) and never seen. The one
 *     channel proven on this host is the blocking one bansai has used all along:
 *     the text on STDERR and exit code 2, which the host feeds back to the model
 *     as "Stop hook feedback" and lets it continue. The host then re-fires Stop
 *     with `stop_hook_active: true`; that re-fire must ask NOTHING or the ask
 *     loops forever (v1's anti-loop, kept here for the same reason).
 *     **Since 2026-09-24 the ask leaves by the host's documented NON-ERROR
 *     route instead** (`HOST_STOP` above): exit 0, the model's ask as
 *     `hookSpecificOutput.additionalContext`, one line for the person as
 *     `systemMessage`. Same continuation, same re-fire, same refusal of it.
 *
 * **The fourth channel, added 2026-09-14 for I32: `systemMessage`.** Documented
 * at https://code.claude.com/docs/en/hooks (formerly
 * docs.claude.com/en/docs/claude-code/hooks) and measured by the owner's own
 * probe on 2026-09-11: a SessionStart hook that exits 0 and prints JSON with a
 * top-level `systemMessage` gets that text DISPLAYED in the terminal
 * (`SessionStart:startup says: …`), non-blocking, while `additionalContext` and
 * stderr do not show. The doc also states the rule that makes this safe or
 * dangerous depending on which form you print: **when stdout parses as JSON the
 * raw stdout is NOT also added to context** — only the JSON's fields are. So the
 * wake must ride ENTIRELY in `hookSpecificOutput.additionalContext`, byte for
 * byte what plain stdout would have carried, and a day with nothing red prints
 * the plain form it has printed since day 0 rather than a JSON wrapper nobody
 * has measured on this host.
 *
 * Pure, so the test proves the channel choice without a process. `dropped` is
 * how a pure function reports the one thing it cannot do itself: the caller
 * turns it into the ring row that makes a silent terminal explicable.
 */
export interface Delivery {
  readonly stdout: string;
  readonly stderr: string;
  /** Always 0 since 2026-09-24: no event leaves by exit 2 any more. */
  readonly exitCode: 0;
  /** Non-null when a notice was left out to keep the wake whole — all of them,
   *  or (with several) the lower ones that no longer fit. */
  readonly dropped: { readonly noticeChars: number; readonly envelopeChars: number; readonly limitChars: number } | null;
  /**
   * THE PLAIN FALLBACK, CHECKED (2026-09-29, audit item 9). Set when the plain
   * stdout this prints is itself past the host's cap (`HOST_OUTPUT_CHARS`), so
   * the host will show a preview in its place. A TRIPWIRE, not a cut: by here
   * the asks are already marked as delivered and this function cannot tell a
   * wake from an ask, so it reports and the caller records it. The adapter's
   * one budget per envelope is what keeps it from happening; what can still
   * reach it is a wake composed past the cap by a misconfigured budget.
   */
  readonly overCap?: { readonly chars: number; readonly limitChars: number };
}

/** The plain form of an envelope, with the over-cap tripwire read. */
function plainOut(out: string, dropped: Delivery["dropped"]): Delivery {
  const chars = out.length;
  return chars > TUNABLES.HOST_OUTPUT_CHARS
    ? { stdout: out, stderr: "", exitCode: 0, dropped, overCap: { chars, limitChars: TUNABLES.HOST_OUTPUT_CHARS } }
    : { stdout: out, stderr: "", exitCode: 0, dropped };
}

export function hostDelivery(
  name: HookName,
  result: { injection: string | null; ask: string | null },
  payload: Record<string, unknown>,
  /**
   * The owner-facing line(s), or null: SessionStart's doctor notice and
   * registry line, UserPromptSubmit's update notice (roadmap E); every other
   * event ignores it. At SessionStart a LIST is a priority order (review M1):
   * each is added only while the envelope still fits, so a lower line can never
   * cost a higher one its place. At a prompt the lines are ALL OR NOTHING —
   * joined into one `systemMessage`, or all dropped — which is what lets
   * `deliverTurn` mark only an envelope that carried them; since 2026-09-26 that is plain reminders and the update notice.
   */
  notice: string | null | readonly (string | null)[] = null,
): Delivery {
  const ask = result.ask !== null && result.ask.length > 0 ? result.ask : null;
  if (name !== "stop") {
    const out = [result.injection ?? "", ask ?? ""].filter((s) => s.length > 0).join("\n\n");
    const notices = (typeof notice === "string" || notice === null ? [notice] : notice).filter(
      (n): n is string => n !== null && n.length > 0,
    );
    if (name === "session-start" && notices.length > 0) {
      const envelopeOf = (message: string): string => envelopeJson(HOST_SESSION_START, message, out);
      // THE WAKE WINS. Each field must fit the host's cap on its own
      // (`fieldsFit`): a wake past it is previewed in either form, and then the
      // plain form is printed and `overCap` says so. The notices go in in the
      // order given, each only while the person's field still fits.
      // `envelopeChars` stays what it was, the whole object's length — a fact
      // for the record, no longer the test.
      const kept: string[] = [];
      const left: string[] = [];
      for (const n of notices) {
        if (fieldsFit(out, [...kept, n].join("\n"))) kept.push(n);
        else left.push(n);
      }
      const dropped =
        left.length === 0
          ? null
          : {
              noticeChars: left.join("\n").length,
              envelopeChars: envelopeOf(notices.join("\n")).length,
              limitChars: TUNABLES.HOST_OUTPUT_CHARS,
            };
      if (kept.length === 0) return plainOut(out, dropped);
      return { stdout: envelopeOf(kept.join("\n")), stderr: "", exitCode: 0, dropped };
    }
    // THE UPDATE NOTICE, AT A PROMPT (roadmap E, 2026-09-23) — the same
    // envelope and the same rule: the turn's recall rides whole in
    // `additionalContext` or the notice waits. A turn with no recall prints the
    // `systemMessage` alone rather than an empty context field. A prompt with
    // no notice prints what it always has — plain text, or nothing. More than
    // one line would be JOINED into the one `systemMessage` an object carries,
    // never one replacing another, and dropped all together or not at all —
    // not SessionStart's priority order; since 2026-09-26 the plain reminders and the update notice (`deliverTurn` tries the two together and falls back to the first alone).
    if (name === "user-prompt-submit" && notices.length > 0) {
      const message = notices.join("\n");
      const envelope = JSON.stringify({
        systemMessage: message,
        ...(out.length === 0
          ? {}
          : { hookSpecificOutput: { hookEventName: HOST_USER_PROMPT_SUBMIT, additionalContext: out } }),
      });
      if (!fieldsFit(out, message)) {
        return plainOut(out, { noticeChars: message.length, envelopeChars: envelope.length, limitChars: TUNABLES.HOST_OUTPUT_CHARS });
      }
      return { stdout: envelope, stderr: "", exitCode: 0, dropped: null };
    }
    return plainOut(out, null);
  }
  // The re-fire is refused twice on purpose: the adapter asks nothing on it, and
  // this channel would not carry it even if something did.
  if (payload["stop_hook_active"] === true || ask === null) {
    return { stdout: "", stderr: "", exitCode: 0, dropped: null };
  }
  // EXIT 0, and NO `decision`: `additionalContext` on Stop continues the turn on
  // its own, as non-error feedback (the docblock at `HOST_STOP`). Exit 2 would
  // make STDERR a blocking error again, and a `decision: "block"` beside it
  // would bring back the `Stop hook error:` line this route exists to avoid.
  // One line, no trailing newline, so the whole of stdout is the object. The
  // ask is ~430 characters, far inside the host's 10,000-character cap.
  return {
    stdout: JSON.stringify({
      systemMessage: STOP_HUMAN_LINE,
      hookSpecificOutput: { hookEventName: HOST_STOP, additionalContext: ask },
    }),
    stderr: "",
    exitCode: 0,
    dropped: null,
  };
}

/** True only when this file is the process entry point — so a test may import
 *  `toHookInput` and `hostConfig` without the script running itself. */
export function isEntryPoint(argv1: string | undefined, url: string, binary: Binary | null = BINARY): boolean {
  // Never in the single binary, where every module shares one URL: its
  // dispatcher (tools/single-binary/main.ts) calls `start()` itself.
  if (argv1 === undefined || binary !== null) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

/** Run the hook and exit — what this file does as a script, and what the
 *  single binary's `hook` mode calls. */
export function start(): void {
  void main().then(
    () => process.exit(process.exitCode === 2 ? 2 : 0),
    (err: unknown) => {
      // A failed hook is a QUIET hook, never a failed session — but a
      // stand-down stays observable (observer-mode G6). One line names it:
      // e.g. an observer stance finding no store to read (cli §7) says
      // STORE_UNINITIALIZED here instead of minting one silently.
      //
      // The explicit-dir guard gets a SENTENCE with THIS entry point's remedy:
      // a hook has no `--dir`, so the way to name its store is the `dataDir`
      // field of the file it was pointed at (the gap between the two guards —
      // a named configuration that names no store; #80 review).
      const detail = err instanceof Error ? err.message : String(err);
      const remedy = `Set "dataDir" in ${hookConfigChoice().path}, or set ${DATA_DIR_ENV}.`;
      process.stderr.write(`[counterparts] hook stood down: ${describeGuardRefusal(err, remedy) ?? detail}\n`);
      process.exit(0);
    },
  );
}

if (isEntryPoint(process.argv[1], import.meta.url)) start();
