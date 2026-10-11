/**
 * WHERE EVERY ENTRY POINT LOOKS FOR THE HOST CONFIGURATION. One rule, one file.
 *
 * Until 2026-09-05 there were three answers to "which `claude-code.json`?".
 * `claude-code/bin/hook.ts`, `claude-code/bin/runner.ts` and `mcp/bin/serve.ts`
 * each hard-coded `join(homedir(), ".counterparts", "claude-code.json")` and
 * took no flag; the console looked beside the store and then in the home. That
 * was recorded as LAUNCH-STATUS G1, and it cost two concrete things:
 *
 *   - the clean-room install loop could drive the console and the MCP server at
 *     a scratch install but could not drive THE HOOK anywhere except the one
 *     path its own `$HOME` produced, so "the hook honours a config" was a step
 *     nobody could write;
 *   - an agent or a reviewer on a machine that already has an install could not
 *     run those three entry points at all without redirecting `HOME` — and on
 *     2026-09-04 a critic who could not do that ran `counterparts-mcp` against
 *     the owner's live configuration (its embedder knob, its credentials file)
 *     while pointing at a scratch store.
 *
 * THE RULE, and it is the same sentence for the console, the hook, the worker
 * and the MCP server:
 *
 *   1. `--config <absolute path>`, when the command line carries one;
 *   2. else `COUNTERPARTS_CONFIG`, the flag's equivalent for a host that
 *      launches from a STATIC configuration and has no command line to write
 *      into — which is exactly how Claude Code registers an MCP server
 *      (measured 2026-09-04, `mcp/bin/serve.ts`);
 *   3. else the documented default, unchanged: `~/.counterparts/claude-code.json`
 *      for the hook, the worker and the server; and for the console, whose
 *      `--dir` may name any store, `<dir>/../claude-code.json` first and that
 *      same home path second (`cli/commands.ts#hostCeiling`).
 *
 * Two properties this file exists to keep:
 *
 *   **The default path does not move.** `hook.ts` runs on the owner's live host
 *   at the next hook event; a no-flag, no-env run must resolve exactly what it
 *   resolved before this file existed. `defaultConfigPath()` is that path and
 *   nothing else consults it.
 *
 *   **A NAMED configuration that cannot be honoured REFUSES; it never falls
 *   back.** An operator who names one has said which memory they mean. Falling
 *   back to the default on a bad path is how a scratch run writes into a live
 *   store — the failure direction this whole file is a reaction to. Three shapes
 *   refuse, at every entry point that READS a configuration: a flag with nothing
 *   after it, a relative path (`configRefusal`), and — because the first review
 *   of this rule found the hole — an absolute path to a file that is not there
 *   or does not parse (`namedConfigRefusal`). That third one is the dangerous
 *   one: a mistyped `--config /scratch/typo.json` used to be honoured silently,
 *   read as an absent config, resolved to observer, and then fall through to
 *   `dataDir()` — which on a real machine is the owner's live store.
 *
 *   **An absent DEFAULT stays ordinary.** A fresh machine has no
 *   `~/.counterparts/claude-code.json` and must still start; that path resolves
 *   to the observer default as it always did. The distinction is `source`, and
 *   it is why the check is a separate function rather than a line inside
 *   `configRefusal`: `install --config <a path>` goes through the same resolver
 *   and the file does not exist yet — writing it is the whole command.
 *
 * It sits beside `sessions.ts` for the same reason that file does: two adapters
 * need it, and neither adapter may import the other (`mcp/INTERFACE-GAPS.md`
 * §7). A sibling both may import is the shape that rule allows.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import {
  DEFAULT_DATA_DIR_NAME,
  REQUIRE_EXPLICIT_DIR_ENV,
  explicitDirMalformedRefusal,
  explicitDirSetting,
} from "../core/store/index.js";

/** The flag, spelled once. */
export const CONFIG_FLAG = "--config";

/**
 * The environment variable, spelled once. It is the FLAG'S EQUIVALENT and
 * nothing more: same meaning, same precedence order, lower priority. It exists
 * because `claude mcp add` writes a static command + env into the host's own
 * configuration, so `-e COUNTERPARTS_CONFIG=…` is the only way to tell a server
 * launched that way which file to read.
 */
export const CONFIG_ENV = "COUNTERPARTS_CONFIG";

/** The file's name under the home directory. `install` writes exactly this. */
export const CONFIG_FILE_NAME = "claude-code.json";

/**
 * The RING event a hook adapter leaves naming the file it read — ring-only, like
 * `adapter.credentials.file`, because a new DURABLE event name is a core change
 * (`core/counterpart.ts#AdapterDurableEventName`) and this one is not worth one:
 * the durable trace is the session registry record's `config` field, written
 * under the store the config actually named.
 */
export const CONFIG_FILE_EVENT = "adapter.config.file";

export type ConfigSource = typeof CONFIG_FLAG | typeof CONFIG_ENV | "default";

export interface ConfigChoice {
  /** The absolute path to read. Meaningless when `refusal` is set. */
  readonly path: string;
  /** Which of the three answered. Printed or recorded by every entry point. */
  readonly source: ConfigSource;
  /** Non-null when the caller NAMED a configuration this rule cannot honour. */
  readonly refusal: string | null;
}

/**
 * `~/.counterparts/claude-code.json` — the one default, unchanged since the
 * hooks first read it, and the only place a home directory is resolved for a
 * configuration path.
 */
export function defaultConfigPath(home: string = homedir()): string {
  return join(home, DEFAULT_DATA_DIR_NAME, CONFIG_FILE_NAME);
}

/**
 * The raw `--config` value on a command line, or undefined. Accepts both
 * `--config <path>` and `--config=<path>`; a flag with nothing usable after it
 * returns the empty string, which the resolver turns into a refusal rather than
 * into silence (the same lesson as `cli/commands.ts#unknownFlag`: a valued flag
 * that got no value is an error, not an absence).
 *
 * Hand-rolled rather than `parseArgs`, because three of the four callers parse
 * their own arguments differently and this must mean the same thing in all of
 * them.
 */
export function configFlag(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (token === CONFIG_FLAG) {
      const next = argv[i + 1];
      return next === undefined || next.startsWith("--") ? "" : next;
    }
    if (token.startsWith(`${CONFIG_FLAG}=`)) return token.slice(CONFIG_FLAG.length + 1);
  }
  return undefined;
}

/** Why this named path cannot be used, or null. Absolute is the whole rule. */
export function configRefusal(value: string, source: ConfigSource): string | null {
  const named = source === CONFIG_FLAG ? `${CONFIG_FLAG} <path>` : CONFIG_ENV;
  if (value.length === 0) {
    return `refused: ${named} was given nothing. It takes an ABSOLUTE path to a configuration file.`;
  }
  if (!isAbsolute(value)) {
    return (
      `refused: ${named} takes an ABSOLUTE path, and '${value}' is relative. ` +
      "The processes that read this file are launched by a host from a working directory " +
      "nobody chose, so a relative path names a different file in every one of them."
    );
  }
  return null;
}

/**
 * The rule itself: flag, else environment, else the default.
 *
 * `argv` is the entry point's own arguments (`process.argv.slice(2)`), `env` its
 * environment, `home` the home directory — all three injected so the whole rule
 * is provable without a process, and so a test never has to reach a real home.
 */
export function resolveConfigPath(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = {},
  home: string = homedir(),
): ConfigChoice {
  const flag = configFlag(argv);
  if (flag !== undefined) {
    const refusal = configRefusal(flag, CONFIG_FLAG);
    return { path: flag, source: CONFIG_FLAG, refusal };
  }
  const fromEnv = env[CONFIG_ENV];
  // An EMPTY variable is absent, not a refusal: a host that exports the name
  // with no value has said nothing, and `-e COUNTERPARTS_CONFIG=` is a shape a
  // registration can produce by accident. A non-empty one that is relative is a
  // refusal, because somebody meant something by it.
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    const value = fromEnv.trim();
    return { path: value, source: CONFIG_ENV, refusal: configRefusal(value, CONFIG_ENV) };
  }
  return { path: defaultConfigPath(home), source: "default", refusal: null };
}

/**
 * Is this choice a configuration somebody NAMED somewhere other than the default?
 *
 * The test is the PATH, not how it was named — the same rule `install` uses to
 * decide whether to print a flag. It matters because `spawn.ts` pins the
 * parent's resolved path onto every worker, default included: without this, a
 * machine with no `~/.counterparts/claude-code.json` (which is ordinary — the
 * hook stands up as an observer) would spawn a worker that saw a NAMED but
 * missing config and stood down, so nothing would ever sweep or sleep there.
 * Found while reviewing the missing-file refusal; the pin is right and the
 * refusal is right, and this is the line that keeps them from meeting.
 */
export function isNamed(choice: ConfigChoice, home: string = homedir()): boolean {
  return choice.source !== "default" && resolve(choice.path) !== defaultConfigPath(home);
}

/**
 * Why a NAMED configuration was not UNDERSTOOD, or null — the third arm, and the
 * only one that needs the caller's own loader.
 *
 * `loadConfig` reports `unreadable` for a file that parses but whose fields do
 * not typecheck (`"dataDir": 123`), and resolves it to `{ observer: true }` —
 * the right fail direction for a configuration nobody named, and the wrong one
 * for a file the operator pointed at: the store then falls through to the
 * default, opened as an instrument. `reason` is passed in as a string rather
 * than the adapter's own type, so this module still imports no adapter.
 */
export function namedUnreadableRefusal(
  choice: ConfigChoice,
  reason: string,
  home?: string,
): string | null {
  if (!isNamed(choice, home) || reason !== "unreadable") return null;
  const named = choice.source === CONFIG_FLAG ? `${CONFIG_FLAG} <path>` : CONFIG_ENV;
  return (
    `refused: ${named} names ${choice.path}, which could not be understood — a key in it ` +
    "does not hold the type this expects. An unreadable configuration resolves to observer " +
    "and the store falls back to the default one, which is not what you named."
  );
}

/**
 * Why a NAMED configuration cannot be read, or null — the second half of the
 * refusal, for the entry points that READ a config file (`bin/hook.ts`,
 * `bin/runner.ts`, `mcp/bin/serve.ts`).
 *
 * The hole this closes, reproduced by the review of PR #72 on 2026-09-05:
 * `counterparts-hook --config /definitely/not/here/claude-code.json` exited 0,
 * printed a wake, and wrote a store — because a read error is swallowed into
 * `loadConfig(undefined)`, which is the observer default, and the data dir then
 * falls through to `dataDir()`. On a machine with an install that is the live
 * store. A typo in the one flag that says WHICH MEMORY was the one thing nothing
 * would mention (the same sentence the console's `--dirr` refusal already
 * carries).
 *
 * Two things it deliberately does NOT do:
 *
 *   - it says nothing about the DEFAULT path. Absent there is ordinary: a fresh
 *     machine has no config and the hook must still stand up as an observer.
 *   - it is not folded into `configRefusal`, because `counterparts install
 *     --config <path>` resolves through the same rule and that file does not
 *     exist yet — creating it is the command.
 *
 * The file is read here and read again by the caller's own loader. That is one
 * extra read of a file measured in hundreds of bytes, and it keeps this module
 * free of any adapter's config schema: what it checks is "can this be read, and
 * is it a JSON object", which is the whole of what a caller needs to have been
 * true.
 */
export function namedConfigRefusal(
  choice: ConfigChoice,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
  home?: string,
): string | null {
  if (choice.refusal !== null) return choice.refusal;
  if (!isNamed(choice, home)) return null;
  const named = choice.source === CONFIG_FLAG ? `${CONFIG_FLAG} <path>` : CONFIG_ENV;
  let text: string;
  try {
    text = read(choice.path);
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "UNREADABLE";
    return (
      `refused: ${named} names ${choice.path}, which could not be read (${code}). ` +
      "A configuration you named is not one this can guess at: the default would be a " +
      "different store, and using it silently is how a scratch run writes into a live one."
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return (
      `refused: ${named} names ${choice.path}, which is not a JSON object. ` +
      "An unreadable configuration resolves to observer, and an observer that was " +
      "POINTED at a file is a stand-down nobody asked for — so this says so instead."
    );
  }
  return null;
}

/**
 * THE EXPLICIT-DIR GUARD AT THE OTHER DOOR (`store/paths.ts#REQUIRE_EXPLICIT_DIR_ENV`).
 *
 * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` makes `dataDir()` refuse its implicit
 * default. That alone leaves this module's default open, and it is the wider
 * door: a default-sourced `~/.counterparts/claude-code.json` NAMES a store — its
 * `dataDir` field, which `install` always writes — and the credentials beside
 * it, so the hook, the worker and the MCP server reach the live store and the
 * live keys without `dataDir()` ever running; and `install` writes its config
 * and credentials under that same base (`cli/install.ts#installLayout`, which
 * builds the base from `homedir()` itself). The reviewer of PR #72 named this
 * the other way into the live machine, and it is.
 *
 * So the same variable refuses the same shape here: the guard armed AND the
 * configuration resolved to the default. Null when either is false. It is a
 * separate function rather than a clause in `resolveConfigPath`, for the same
 * reason `namedConfigRefusal` is: the console's `rebrief` goes through the
 * resolver too, and its config read is a budget NUMBER for a store already
 * named by `--dir` — refusing it would teach people to unset the guard. The
 * line drawn: the guard refuses an implicit default that LOCATES A STORE or
 * WRITES THE LIVE BASE; a number read from the default config is neither.
 *
 * Callers: the three bins (chained after `namedConfigRefusal`, which already
 * stands them down on a string) and the console's `install`. Read from the
 * injected `env`, like everything else in this file. A value the guard cannot
 * read is refused HERE too, in the same sentence the store uses — but only at
 * the default, because a named configuration never consulted the guard.
 */
export function implicitConfigRefusal(
  choice: ConfigChoice,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (choice.source !== "default") return null;
  const setting = explicitDirSetting(env);
  if (!setting.armed) {
    return setting.malformed === null ? null : explicitDirMalformedRefusal(setting.malformed);
  }
  return (
    `refused: ${REQUIRE_EXPLICIT_DIR_ENV}=${setting.value} and no configuration was named, so this ` +
    `would have read the default one, ${choice.path} — which on a machine with an install names the ` +
    `live store and its credentials. Name one: ${CONFIG_FLAG} <absolute path>, or ${CONFIG_ENV}.`
  );
}

/** The one line every entry point prints or records. Path first: it is the fact. */
export function configLine(choice: ConfigChoice): string {
  return choice.source === "default"
    ? `${choice.path} (the default)`
    : `${choice.path} (named by ${choice.source})`;
}
