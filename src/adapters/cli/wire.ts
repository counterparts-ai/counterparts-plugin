/**
 * `counterparts connect` / `counterparts disconnect` — the host's two files,
 * edited. (The functions are still called `wire` and `unwire`: they are the
 * verbs for what this file DOES to a settings file, and `install` calls the
 * first of them. The COMMANDS were renamed on 2026-09-22 — "connect" and
 * "disconnect" are what a person does to an AI — and neither name had ever
 * shipped, so there is no alias to keep.)
 *
 * **This is the riskiest code in the package, and the reason is one sentence:
 * every other command in this console writes files that belong to us, and this
 * one writes a file that belongs to somebody else.** `~/.claude/settings.json`
 * is a stranger's editor configuration. It may hold six other tools' hooks, a
 * permissions block, a model choice and an environment they spent an afternoon
 * on. Nothing here is allowed to cost them any of it.
 *
 * So the rules below are not style. Each one is a way this could destroy
 * something that is not ours:
 *
 *   1. **BACK UP FIRST, and say so.** Before a byte changes, the file is copied
 *      to `settings.json.counterparts-backup-<UTC stamp>` beside itself, at the
 *      same mode. A person who does not like what happened has a file to put
 *      back. `connect`'s one line says a backup was KEPT and `disconnect`'s
 *      names it in full — the asymmetry is the owner's (2026-09-22): the person
 *      connecting is three lines into their first install and the person
 *      disconnecting is the one who may want the file back.
 *   2. **EVERY OTHER KEY, AND EVERY OTHER HOOK, SURVIVES.** The merge works on
 *      the INNER hook entry — `hooks[event][i].hooks[j]` — never on the event's
 *      array and never on the `hooks` object. Another tool's entry on
 *      `SessionStart` keeps its position, its `matcher`, its `timeout` and every
 *      key we have never heard of. Hooks on one event run in parallel; ours
 *      goes BESIDE theirs.
 *   3. **IDEMPOTENT, AND REPAIRING.** An entry whose command is already exactly
 *      ours is left alone and no backup is taken — running this twice is not an
 *      event. An entry that is RECOGNISABLY ours but names a different path (an
 *      old checkout, a `counterparts-hook` shim that is no longer on PATH) is
 *      REPLACED IN PLACE rather than duplicated, and the old command is printed.
 *      The recogniser is `install.ts#HOOK_COMMAND_MARK` — the same one `doctor`
 *      reads the host with, so the two surfaces cannot disagree about what
 *      counts as ours.
 *   4. **A FILE THIS CANNOT PARSE IS A REFUSAL.** Not a rewrite, not a rescue, not
 *      "start a fresh one". It prints the block to merge by hand and changes
 *      nothing. The same for a `hooks` key that is not an object and an event
 *      whose value is not an array: a shape we do not understand is a shape we
 *      do not edit.
 *   5. **THE WRITE IS ATOMIC, AND THROUGH A SYMLINK ONLY INTO THE HOME.** Temp
 *      file in the same directory, `rename(2)` onto the target — a kill in the
 *      middle leaves the old file whole, never a truncated one. A symlinked
 *      `settings.json` (a dotfiles repository, an ordinary arrangement) is
 *      written THROUGH to its target, so the link survives; a link pointing
 *      outside the home directory is refused rather than followed, because at
 *      that point this is editing a file in a place nobody said it could.
 *   6. **`~/.claude.json` IS NEVER WRITTEN BY US.** Claude Code owns that file's
 *      shape. The MCP registration goes through `claude mcp add`, which is the
 *      host's own door. We READ the file to decide whether to call it — reading
 *      is what `doctor` already does — and we shell out to change it.
 *
 * The one thing this file cannot do anything about is said out loud instead:
 * a Claude Code session that is already open. Measured 2026-09-21 — after
 * `settings.json` changes, an open session's hooks fire on its NEXT TURN, and
 * its MCP tools appear only after Claude Code is restarted. `sessionsNote` says
 * exactly that, and counts the memory servers still running when it cheaply can
 * — by the build each one's own record names, since 2026-10-09 (`serverCensus`);
 * since 2026-09-22 the CALLER prints it, because `install` ends with its own
 * "restart Claude Code, then run doctor" line and two of them on one screen is
 * the finding this round is about.
 */
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { DATA_DIR_ENV, isWithin } from "../../core/store/index.js";
import { CONFIG_ENV, CONFIG_FLAG } from "../config-path.js";
import { isOurHookCommand } from "../host-wiring.js";
import { claudeCodeEnvMarker } from "../hosts.js";
import { parseScriptInvocation, scriptArgs, shellTokens } from "../runtime.js";
import { installedBuild, readServerRecords, sameBuild, serverBelieved } from "../sessions.js";
import type { BuildStamp, ServerRecordRead } from "../sessions.js";
import type { Io } from "./commands.js";
import {
  BIN,
  HOOK_COMMAND_MARK,
  HOST_EVENTS,
  MCP_SCRIPT,
  MCP_SERVER_NAME,
  hookCommand,
  hostConfigBase,
  hostMcpFile,
  hostSettingsDir,
  mcpCommand,
  settingsBlock,
} from "./install.js";
import { realpathDeep } from "./start-fresh.js";
import { confirm, ui } from "./ui.js";
import type { Ui, UiEnv } from "./ui.js";

// ── where the host keeps it ─────────────────────────────────────────────────

/** The user-scope settings file: the ONE this command writes. Project files
 *  (`.claude/settings.json` in a working directory) are read by `doctor` and
 *  never written here — wiring one project is not what anybody asked for.
 *  `$CLAUDE_CONFIG_DIR/settings.json` when that is set (`hostSettingsDir`,
 *  2026-10-09), never `$CLAUDE_CONFIG_DIR/.claude/settings.json`. */
export function userSettingsPath(home: string, env: UiEnv): string {
  return join(hostSettingsDir(home, env), "settings.json");
}

/** The infix a backup wears. Named, because the test and the output share it. */
export const BACKUP_INFIX = "counterparts-backup";

/** `settings.json.counterparts-backup-2026-09-21T14-03-05Z`, beside the file.
 *  Colons are stripped: a filename with them is a filename some tools cannot
 *  handle, and this one exists to be copied back by hand. */
export function backupPath(path: string, now: number): string {
  const stamp = new Date(now).toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  return `${path}.${BACKUP_INFIX}-${stamp}`;
}

/**
 * A BACKUP NEVER OVERWRITES A BACKUP. The stamp has second resolution, and two
 * writes inside one second are not hypothetical — `wire` then `unwire` is two
 * hundred milliseconds in `tools/install-loop/run.sh`. Without this, the second
 * copy landed on the first and the person's ORIGINAL pre-wire file was gone,
 * which is the one thing the backup exists to be.
 *
 * `-2`, `-3` … exactly as `start-fresh#parkedPath` numbers a parked directory,
 * and the check is the copy itself (`COPYFILE_EXCL`) rather than an
 * `existsSync` before it, so two processes racing cannot both win the name.
 */
export function copyToFreeBackup(target: string, now: number): string {
  const base = backupPath(target, now);
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base}-${String(n)}`;
    try {
      copyFileSync(target, candidate, constants.COPYFILE_EXCL);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`no free backup name beside ${target}`);
}

/**
 * `~/…` for a path under the home directory.
 *
 * It was the preview's alone until 2026-09-22 — "everything this command
 * actually does is reported in full" — and the owner's answer to finding #27 is
 * that `/Users/<you>/.claude/settings.json` on a screen is a path a person reads
 * character by character to check it is theirs, and `~/.claude/settings.json` is
 * one they recognise. So the ok lines use it too, and the backup path, which is
 * the one thing here somebody may have to type back, is still printed whole.
 */
export function tilde(path: string, home: string): string {
  const h = resolve(home);
  return path === h ? "~" : isWithin(h, path) ? `~${path.slice(h.length)}` : path;
}

// ── reading the file, and every way it can be one we will not touch ─────────

export interface SettingsSight {
  /** The path as named — what the owner sees in their own dotfiles. */
  readonly named: string;
  /** Where a write actually lands: the link's target, or `named`. */
  readonly target: string;
  readonly symlink: boolean;
  readonly exists: boolean;
  /** The permission bits to give the file back, or null when there is none yet. */
  readonly mode: number | null;
  /** The parsed object. `{}` for a file that is not there. */
  readonly value: Record<string, unknown>;
  /** How the file was laid out, so a write gives it back the same way (n1). */
  readonly format: SettingsFormat;
  /** Why this file will not be edited, or null. */
  readonly refusal: string | null;
}

/**
 * HOW A SETTINGS FILE IS LAID OUT — the three things a re-serialisation would
 * otherwise flatten (review n1, 2026-09-21: "4-space indent, tabs and CRLF all
 * become 2-space + LF").
 *
 * The CONTENT always round-tripped — keys, order, unknown values — and a backup
 * is always taken; what did not survive was the person's formatting, which is a
 * diff in their dotfiles repository they did not ask for. Everything past these
 * three (a hand-aligned array, a blank line between sections) is gone the moment
 * the file is parsed, and is named as the cost of editing JSON in NOTES.
 */
export interface SettingsFormat {
  /** One level of indentation: `"  "`, `"    "`, `"\t"`. */
  readonly indent: string;
  readonly eol: "\n" | "\r\n" | "\r";
  /** Whether the file ended with a line ending (trailing spaces after it count). */
  readonly finalNewline: boolean;
}

/** What a file that is not there yet — or is empty — is written with: two
 *  spaces, LF, one trailing newline, which is what the host's own file carries. */
export const DEFAULT_SETTINGS_FORMAT: SettingsFormat = { indent: "  ", eol: "\n", finalNewline: true };

/**
 * THE FILE'S LINE ENDING, BY MAJORITY — not by "is there a CRLF anywhere"
 * (review of #188, M1). One CRLF line pasted into an LF file used to turn the
 * whole file CRLF on the next write: five line endings changed where the file
 * had one odd one out, which is the very complaint n1 was fixing. Now the
 * ending most of the file already uses wins, and a tie goes to LF.
 */
export function majorityEol(raw: string): SettingsFormat["eol"] {
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (raw.match(/\r(?!\n)/g) ?? []).length;
  if (crlf > lf && crlf >= cr) return "\r\n";
  if (cr > lf && cr > crlf) return "\r";
  return "\n";
}

/**
 * Read the layout off the bytes. The first indented line is one level deep in
 * any file `JSON.stringify` or an editor wrote, so its leading whitespace IS the
 * unit. Anything stranger — a unit longer than ten characters (the most
 * `JSON.stringify` accepts), tabs and spaces mixed in one unit — takes the
 * default indent and keeps the line endings.
 *
 * A file on ONE line has no indent to read, and is almost always `{}` — the
 * shape a host or a person starts the file with, not a style anybody chose. It
 * gets the default layout rather than having five hook groups written onto one
 * line.
 */
export function sniffSettingsFormat(raw: string): SettingsFormat {
  const eol = majorityEol(raw);
  if (!/[\r\n]/.test(raw.trimEnd())) return { ...DEFAULT_SETTINGS_FORMAT, eol };
  // Whitespace AFTER the last line ending is still a file that ends in one:
  // `}\n  ` came back `}` with the newline dropped (review of #188, NIT).
  const finalNewline = /[\r\n][ \t]*$/.test(raw);
  const unit = /[\r\n]([ \t]+)\S/.exec(raw)?.[1];
  if (unit === undefined || unit.length > 10 || (unit.includes("\t") && unit.includes(" "))) {
    return { indent: DEFAULT_SETTINGS_FORMAT.indent, eol, finalNewline };
  }
  return { indent: unit, eol, finalNewline };
}

/**
 * The shapes of NOT-QUITE-JSON a hand-edited file takes, found by one pass that
 * knows what a string is and what a comment is — so a `//` inside a URL is not
 * a comment, a `//` inside a SINGLE-quoted value is not one either (review of
 * #188, M3: `{'apiKeyHelper': 'curl https://x'}` was diagnosed as "holds
 * comments"), and an apostrophe inside a comment is not a single-quoted string.
 *
 * `bare` is the text with every string's contents and every comment taken out
 * (a string leaves `""` behind, so a comma after it still reads as a comma
 * after a value).
 */
export function jsonNoise(raw: string): { comments: boolean; singleQuotes: boolean; bare: string } {
  let bare = "";
  let comments = false;
  let singleQuotes = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i] ?? "";
    const next = raw[i + 1] ?? "";
    if (ch === '"' || ch === "'") {
      if (ch === "'") singleQuotes = true;
      i += 1;
      while (i < raw.length && raw[i] !== ch && raw[i] !== "\n") {
        i += raw[i] === "\\" ? 2 : 1;
      }
      i += 1;
      bare += '""';
      continue;
    }
    if (ch === "/" && next === "/") {
      comments = true;
      while (i < raw.length && raw[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      comments = true;
      const close = raw.indexOf("*/", i + 2);
      i = close === -1 ? raw.length : close + 2;
      continue;
    }
    bare += ch;
    i += 1;
  }
  return { comments, singleQuotes, bare };
}

/**
 * WHY THIS FILE DID NOT PARSE, in words a person can act on — or null when it
 * is none of the shapes a hand-edited settings file usually takes (review n2).
 *
 * Still a refusal, every one: this command writes plain JSON, and writing a
 * commented file back would drop every comment in it. What changed is that the
 * refusal says what it found and what to do, where it used to print the
 * parser's own complaint about an unexpected character. It does NOT claim to
 * know what Claude Code itself accepts in this file — nobody here has checked.
 */
export function unparsedSettingsWhy(raw: string): string | null {
  if (raw.charCodeAt(0) === 0xfeff) {
    return (
      "starts with a byte-order mark — an invisible character some editors put at the top of " +
      'a file. This command reads and writes plain JSON only. Save the file as "UTF-8" rather ' +
      'than "UTF-8 with BOM" and run this again'
    );
  }
  const noise = jsonNoise(raw);
  if (noise.comments && noise.singleQuotes) {
    return (
      "holds comments (// or /* */) and single-quoted strings ('…'). This command reads and " +
      "writes plain JSON only, which allows neither, and writing this file back would drop " +
      "every comment in it. Move the comments out, put double quotes where the single ones " +
      "are, and run this again"
    );
  }
  if (noise.singleQuotes) {
    return (
      "uses single quotes ('…') around names or values, and plain JSON needs double quotes " +
      '("…"). Change them and run this again'
    );
  }
  if (noise.comments) {
    return (
      "holds comments (// or /* */). This command reads and writes plain JSON only, and " +
      "writing this file back would drop every comment in it. Move the comments out of the " +
      "file and run this again"
    );
  }
  // A comma AFTER A VALUE and before a close — `"a": 1, }` — and not the stray
  // one in `{ , }`, which is a different mistake and gets the parser's words.
  if (/[^\s{[,]\s*,\s*[}\]]/.test(noise.bare)) {
    return (
      "has a comma just before a closing } or ], which plain JSON does not allow. Remove it " +
      "and run this again"
    );
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read `~/.claude/settings.json` and decide, before anything is planned,
 * whether this is a file we are willing to write.
 *
 * Six refusals, and each one is a shape whose meaning we would be guessing at:
 * a symlink out of the home, something that is not a regular file, bytes that
 * are not JSON, a top-level value that is not an object, a `hooks` key that is
 * not an object, and one of our five events whose value is not an array.
 * Guessing about any of them means rewriting somebody's configuration into a
 * shape they did not choose.
 */
export function sightSettings(named: string, home: string): SettingsSight {
  const absent: SettingsSight = {
    named,
    target: named,
    symlink: false,
    exists: false,
    mode: null,
    value: {},
    format: DEFAULT_SETTINGS_FORMAT,
    refusal: null,
  };
  const realHome = realpathDeep(home);

  // ── THE DIRECTORY ABOVE IT IS A PATH TOO (review m3) ──────────────────────
  //
  // The symlink guard used to look only at the `settings.json` entry, so a
  // symlinked `~/.claude` pointing anywhere at all was written through in
  // silence — the output named the tilde path and the bytes landed outside the
  // home. It is where the host reads, so the intent is harmless; being unable
  // to say where somebody's hooks went is not.
  const parent = dirname(named);
  if (existsSync(parent)) {
    const realParent = realpathDeep(parent);
    if (!isWithin(realHome, realParent)) {
      return {
        ...absent,
        refusal:
          `refused: ${parent} resolves to ${realParent}, which is outside your home directory ` +
          `(${realHome}). This command will not write a settings file into a directory nobody ` +
          "named. Edit it by hand there, or point that link back inside your home.",
      };
    }
  }

  let stat;
  try {
    stat = lstatSync(named);
  } catch {
    // Not there at all. `~/.claude/` may not exist either; wiring creates both.
    return absent;
  }

  let target = named;
  let symlink = false;
  if (stat.isSymbolicLink()) {
    symlink = true;
    // `readlinkSync` FIRST, and `realpathDeep` only as the resolved spelling.
    // A DANGLING link cannot be resolved, so `realpathDeep` hands back the
    // link's own path — which made `exists: false` true, the out-of-home test
    // compare the link against itself, and the write `rename` a regular file
    // OVER the link (review m2). The link's own text is the only thing that
    // says where its author meant it to go.
    const written = readlinkSync(named);
    const pointsAt = isAbsolute(written) ? resolve(written) : resolve(dirname(named), written);
    // `realpathDeep` on the TARGET, not on the link: it resolves the deepest
    // ancestor that exists and re-appends the rest, so a dangling link still
    // gets the spelling the inside-home test needs (macOS says `/var/folders`
    // and `/private/var/folders` for one directory, and a comparison that
    // knows only one of the two silently answers "outside your home").
    target = realpathDeep(pointsAt);
    if (!isWithin(realHome, target) || target === realHome) {
      return {
        ...absent,
        target,
        symlink: true,
        exists: existsSync(target),
        refusal:
          `refused: ${named} is a symbolic link to ${target}, which is outside your home ` +
          `directory (${realHome}). Writing through it would edit a file somewhere nobody ` +
          "named, and replacing the link with a regular file would quietly detach whatever " +
          "manages it. Edit the target by hand, or point the link somewhere inside your home.",
      };
    }
    if (!existsSync(target)) {
      // A DANGLING LINK IS A REFUSAL, not a licence to create the target
      // (review m2). This file used to say the opposite. A link into a
      // directory that is not there is a dotfiles arrangement mid-restore —
      // the stow has not run, the external disk is not mounted — and writing
      // the file the link was waiting for is how a restore silently loses.
      return {
        ...absent,
        target,
        symlink: true,
        refusal:
          `refused: ${named} is a symbolic link to ${target}, and nothing is there. That is a ` +
          "dotfiles arrangement part-way through being set up, not a place to create a file: " +
          "writing it would replace the link, and whatever manages it would never see this. " +
          "Put the target in place first, or merge the block below by hand.",
      };
    }
  }

  let real;
  try {
    real = statSync(target);
  } catch {
    return { ...absent, target, symlink, exists: false };
  }
  if (!real.isFile()) {
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      refusal:
        `refused: ${target} is not a regular file. This command edits the host's settings ` +
        "file; it will not guess at what else that name might be.",
    };
  }

  const mode = real.mode & 0o777;
  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      mode,
      refusal:
        `refused: ${target} exists and could not be read (${String((err as Error).message ?? err)}). ` +
        "Nothing was changed.",
    };
  }
  // AN EMPTY FILE IS NOT A BROKEN ONE. A `touch`ed settings.json parses as
  // nothing, and refusing it would send a reader to hand-merge a block into a
  // file with no content to merge it with.
  if (raw.trim().length === 0) {
    return { ...absent, target, symlink, exists: true, mode };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const why = unparsedSettingsWhy(raw);
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      mode,
      refusal:
        why !== null
          ? `refused: ${target} ${why} — or make the change by hand. Nothing in it was touched.`
          : `refused: ${target} does not parse as JSON (${String((err as Error).message ?? err)}). ` +
            "This command will not rewrite a file it cannot read — the one there may hold every " +
            "other tool's configuration, and a fresh one written over it would lose all of it. " +
            "Fix the file, or merge the block below by hand.",
    };
  }
  const format = sniffSettingsFormat(raw);
  if (!isRecord(parsed)) {
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      mode,
      refusal:
        `refused: ${target} parses, but its top level is ${Array.isArray(parsed) ? "an array" : `a ${typeof parsed}`} ` +
        "rather than an object. A settings file this command does not recognise is one it " +
        "does not edit.",
    };
  }
  const hooks = parsed["hooks"];
  if (hooks !== undefined && !isRecord(hooks)) {
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      mode,
      value: parsed,
      refusal:
        `refused: the "hooks" key in ${target} is ${Array.isArray(hooks) ? "an array" : `a ${typeof hooks}`}, ` +
        "not an object of event names. Merging into a shape this command does not understand " +
        "is how a working configuration stops working.",
    };
  }
  if (isRecord(hooks)) {
    for (const event of HOST_EVENTS) {
      const entries = hooks[event];
      if (entries !== undefined && !Array.isArray(entries)) {
        return {
          ...absent,
          target,
          symlink,
          exists: true,
          mode,
          value: parsed,
          refusal:
            `refused: "hooks"."${event}" in ${target} is not an array. The host reads that key ` +
            "as a list of hook groups, and this command will not overwrite a value whose " +
            "meaning it cannot tell.",
        };
      }
    }
  }
  return { named, target, symlink, exists: true, mode, value: parsed, format, refusal: null };
}

// ── the merge ───────────────────────────────────────────────────────────────

export type HookChange = "added" | "replaced" | "kept" | "removed";

export interface EventChange {
  readonly event: string;
  readonly change: HookChange;
  /** The command that was there before a `replaced` or a `removed`. */
  readonly was?: string;
  /** Further entries of OURS on the same event, dropped rather than left as
   *  duplicates. A block pasted twice by hand is the ordinary cause. */
  readonly duplicatesRemoved: number;
}

export interface MergeResult {
  readonly value: Record<string, unknown>;
  readonly events: readonly EventChange[];
  /** True when the object differs from the one handed in. */
  readonly changed: boolean;
  /** How many hook entries belonging to ANYBODY ELSE were carried through
   *  untouched. Reported, because "your other hooks are still there" is the
   *  sentence a reader most wants evidence for. */
  readonly foreignKept: number;
  /** Entries that MENTION our hook inside a longer command — somebody's own
   *  wrapper. Left exactly as they are, by event, so the one line that says so
   *  can name them (review m1). */
  readonly wrapped: readonly { readonly event: string; readonly command: string }[];
}

/**
 * IS THIS COMMAND OURS TO REWRITE — `host-wiring.ts#isOurHookCommand`, which
 * is where the rule and its history now live (moved 2026-10-09 so the plugin's
 * hook and MCP server can recognise the npm wiring without importing the
 * console). Re-exported unchanged: this file and `doctor` still ask exactly the
 * same question of exactly the same function.
 */
export { isOurHookCommand };

/** Is this inner entry one this command may rewrite or remove? */
function isOurs(entry: unknown): entry is Record<string, unknown> {
  if (!isRecord(entry)) return false;
  const command = entry["command"];
  return typeof command === "string" && isOurHookCommand(command);
}

/** Does this entry MENTION us without being ours — a wrapper somebody wrote?
 *  Left exactly where it is, and reported, so the difference is visible. */
function isWrapped(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const command = entry["command"];
  return (
    typeof command === "string" && HOOK_COMMAND_MARK.test(command) && !isOurHookCommand(command)
  );
}

/**
 * Merge (or remove) our hook on the five events, PURE over the settings object.
 *
 * Nothing here reads or writes a file, so the whole merge is provable against
 * literals — which is what the adversarial cases need: a foreign hook on the
 * same event, a stale path, a duplicate, an event we do not use, a `hooks` key
 * with other tools' events in it.
 *
 * `command` is the string a `wire` installs; `unwire` ignores it.
 */
export function mergeHooks(
  settings: Record<string, unknown>,
  command: string,
  direction: "wire" | "unwire",
): MergeResult {
  const next = structuredClone(settings) as Record<string, unknown>;
  const existing = next["hooks"];
  const hooks: Record<string, unknown> = isRecord(existing) ? existing : {};
  const events: EventChange[] = [];
  const wrapped: { event: string; command: string }[] = [];
  let foreignKept = 0;
  let changed = false;

  for (const event of HOST_EVENTS) {
    const raw = hooks[event];
    const groups: unknown[] = Array.isArray(raw) ? raw : [];
    const outGroups: unknown[] = [];
    let seen = 0;
    let was: string | undefined;
    let duplicates = 0;
    let touchedGroup = false;

    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) {
        // A group shaped in a way we do not read is carried through WHOLE. It
        // is not ours to interpret and not ours to drop.
        outGroups.push(group);
        continue;
      }
      const inner = group["hooks"] as unknown[];
      const kept: unknown[] = [];
      let innerTouched = false;
      for (const entry of inner) {
        if (!isOurs(entry)) {
          kept.push(entry);
          if (isRecord(entry) && typeof entry["command"] === "string") foreignKept += 1;
          // A WRAPPER IS NOT A CANDIDATE, in either direction. It stays where
          // it is and gets named once, so a person can see that this command
          // saw it and chose not to touch it.
          if (isWrapped(entry)) {
            wrapped.push({ event, command: String((entry as Record<string, unknown>)["command"]) });
          }
          continue;
        }
        seen += 1;
        if (direction === "unwire") {
          if (was === undefined) was = String(entry["command"]);
          innerTouched = true;
          continue;
        }
        if (seen === 1) {
          was = String(entry["command"]);
          if (was === command) {
            kept.push(entry);
          } else {
            // REPLACED IN PLACE: every other key on the entry — a `timeout`,
            // anything the host adds later — is carried with it.
            kept.push({ ...entry, command });
            innerTouched = true;
          }
          continue;
        }
        // A SECOND entry of ours on one event is a duplicate, not a second
        // wiring. Dropped, and counted, rather than rewritten to the same
        // string twice.
        duplicates += 1;
        innerTouched = true;
      }
      // A group that HELD SOMETHING and now holds nothing was all ours; it goes
      // with it rather than staying as an empty `{ "hooks": [] }` the host
      // steps over every session.
      //
      // `inner.length > 0` is load-bearing and was missing until the A review:
      // a FOREIGN group that was already `{ "matcher": "x", "hooks": [] }` took
      // this branch and was deleted — somebody else's configuration, removed by
      // a command that promises never to touch it.
      if (inner.length > 0 && kept.length === 0) {
        touchedGroup = true;
        continue;
      }
      outGroups.push(innerTouched ? { ...group, hooks: kept } : group);
      if (innerTouched) touchedGroup = true;
    }

    if (direction === "wire") {
      if (seen === 0) {
        outGroups.push({ hooks: [{ type: "command", command }] });
        events.push({ event, change: "added", duplicatesRemoved: 0 });
        changed = true;
      } else if (was === command && duplicates === 0) {
        events.push({ event, change: "kept", duplicatesRemoved: 0 });
      } else {
        events.push({
          event,
          change: was === command ? "kept" : "replaced",
          ...(was === undefined ? {} : { was }),
          duplicatesRemoved: duplicates,
        });
        changed = true;
      }
      hooks[event] = outGroups;
      continue;
    }

    // ── unwire ──────────────────────────────────────────────────────────────
    //
    // NOTHING HAPPENS TO AN EVENT WE HAD NO HOOK ON. `seen > 0` guards the
    // whole block, and it was missing until the A review: an event carrying a
    // foreign `[]` had its key DELETED, so an unwire on a file with no hook of
    // ours in it reported a change and rewrote somebody else's document.
    if (seen === 0) continue;
    events.push({
      event,
      change: "removed",
      ...(was === undefined ? {} : { was }),
      duplicatesRemoved: Math.max(0, seen - 1),
    });
    changed = true;
    // The EVENT KEY goes when nothing is left on it — an empty array where ours
    // used to be is our litter in somebody else's file. (An event that was
    // ALREADY `[]` before a `wire` therefore does not come back as `[]`; an
    // empty array carries no hook, and this is the one shape a wire/unwire
    // round trip does not restore exactly.)
    if (outGroups.length === 0) delete hooks[event];
    else hooks[event] = outGroups;
  }

  if (Object.keys(hooks).length === 0) {
    // And the `hooks` key itself goes when it holds nothing. On `wire` this is
    // unreachable — five events were just written into it.
    if ("hooks" in next) delete next["hooks"];
  } else {
    next["hooks"] = hooks;
  }
  return { value: next, events, changed, foreignKept, wrapped };
}

// ── writing it ──────────────────────────────────────────────────────────────

/**
 * Exactly the bytes a settings file is written with: in the layout it already
 * had (review n1) — its indent, its line endings, its last newline or none —
 * and, for a file that is new, two-space indentation and ONE trailing newline,
 * which is what the host's own file carries and what every `git diff` of a
 * dotfiles repository expects.
 *
 * `JSON.stringify` escapes a line break inside a string as `\\n`, so every
 * literal newline in its output is a line ending and CRLF (or a bare CR) is a
 * plain replace.
 */
export function settingsBytes(
  value: Record<string, unknown>,
  format: SettingsFormat = DEFAULT_SETTINGS_FORMAT,
): string {
  const text = JSON.stringify(value, null, format.indent);
  const lines = format.eol === "\n" ? text : text.replace(/\n/g, format.eol);
  return format.finalNewline ? `${lines}${format.eol}` : lines;
}

export interface WriteOutcome {
  readonly backup: string | null;
  readonly error: string | null;
}

/**
 * Back up, then write atomically, keeping the file's mode.
 *
 * The temp file is minted in the SAME DIRECTORY, because `rename(2)` is atomic
 * within one filesystem and `EXDEV` across two — a temp file in `$TMPDIR` would
 * make this a copy, and a copy interrupted halfway is a truncated
 * `settings.json` on somebody's machine.
 */
export function writeSettings(
  sight: SettingsSight,
  value: Record<string, unknown>,
  now: number,
): WriteOutcome {
  const target = sight.target;
  const dir = dirname(target);
  let backup: string | null = null;
  let temp: string | null = null;
  try {
    mkdirSync(dir, { recursive: true });
    if (sight.exists) {
      backup = copyToFreeBackup(target, now);
      // A backup of a 0600 file must not be world-readable because `copyFile`
      // took the umask's word for it.
      if (sight.mode !== null) chmodSync(backup, sight.mode);
    }
    temp = join(dir, `.counterparts-wire-${String(process.pid)}-${String(now)}.tmp`);
    const mode = sight.mode ?? 0o644;
    writeFileSync(temp, settingsBytes(value, sight.format), { mode });
    chmodSync(temp, mode);
    renameSync(temp, target);
    return { backup, error: null };
  } catch (err) {
    if (temp !== null) {
      try {
        rmSync(temp, { force: true });
      } catch {
        /* a temp file we could not remove is litter, not a second failure */
      }
    }
    return { backup, error: String((err as Error).message ?? err) };
  }
}

// ── the MCP registration (the host's own door) ──────────────────────────────

export interface SpawnResult {
  /** The binary is not on PATH at all. */
  readonly missing: boolean;
  readonly code: number | null;
  readonly out: string;
  readonly err: string;
}

/** `claude <args>`, run and waited for. Injected everywhere, so no test ever
 *  runs the real binary (and no test needs one installed). */
export type Spawner = (args: readonly string[]) => SpawnResult;

export const CLAUDE_BIN = "claude";
/** Long enough for a cold `claude mcp add`, short enough that a wedged binary
 *  does not hold an install open forever. */
export const CLAUDE_TIMEOUT_MS = 30_000;

export function realSpawner(env: Record<string, string | undefined>): Spawner {
  return (args) => {
    // ARGUMENTS, NEVER A SHELL STRING. The store path and the config path come
    // from a file on disk and can hold anything at all; a shell would interpret
    // it. `spawnSync` with an array passes each one through whole.
    const res = spawnSync(CLAUDE_BIN, [...args], {
      encoding: "utf8",
      timeout: CLAUDE_TIMEOUT_MS,
      windowsHide: true,
      // Passed rather than inherited for the reason `doctor.ts` gives: under bun
      // a `spawnSync` with no `env` resolves the binary against the REAL
      // environment, so a caller's PATH would be ignored.
      env: env as NodeJS.ProcessEnv,
    });
    if (res.error !== undefined && res.error !== null) {
      const code = (res.error as NodeJS.ErrnoException).code ?? "";
      return {
        missing: code === "ENOENT",
        code: null,
        out: String(res.stdout ?? ""),
        err: code === "ENOENT" ? "" : String((res.error as Error).message),
      };
    }
    return {
      missing: false,
      code: res.status,
      out: String(res.stdout ?? ""),
      err: String(res.stderr ?? ""),
    };
  };
}

/** The `claude mcp add` argument vector — the array form of `install.ts`'s
 *  printed line, so the two cannot name different stores or scripts. */
export function mcpAddArgs(
  store: string,
  custom: string | undefined,
  exe: string,
  serve: string = MCP_SCRIPT,
): string[] {
  return [
    "mcp",
    "add",
    MCP_SERVER_NAME,
    "-s",
    "user",
    "-e",
    `${DATA_DIR_ENV}=${store}`,
    ...(custom === undefined || custom.length === 0 ? [] : ["-e", `${CONFIG_ENV}=${custom}`]),
    "--",
    exe,
    ...scriptArgs(serve, exe),
  ];
}

export function mcpRemoveArgs(): string[] {
  return ["mcp", "remove", MCP_SERVER_NAME, "-s", "user"];
}

export interface McpReading {
  readonly file: string;
  readonly present: boolean;
  /** Present AND pointing at this store with this runtime and this script. */
  readonly matches: boolean;
  /** True when the file exists and could not be read — a different fact from
   *  "no registration", and the one that must not read as "not installed". */
  readonly unreadable: boolean;
}

/**
 * What `~/.claude.json` says about our server. READ-ONLY, always: this file is
 * the host's own state and only `claude mcp` writes it.
 */
export function readMcp(
  home: string,
  env: UiEnv,
  store: string,
  custom: string | undefined,
  exe: string,
  serve: string = MCP_SCRIPT,
): McpReading {
  const file = hostMcpFile(hostConfigBase(home, env));
  if (!existsSync(file)) return { file, present: false, matches: false, unreadable: false };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { file, present: false, matches: false, unreadable: true };
  }
  if (!isRecord(raw)) return { file, present: false, matches: false, unreadable: true };
  const servers = raw["mcpServers"];
  if (!isRecord(servers)) return { file, present: false, matches: false, unreadable: false };
  const entry = servers[MCP_SERVER_NAME];
  if (!isRecord(entry)) return { file, present: false, matches: false, unreadable: false };
  const args = entry["args"];
  const serverEnv = entry["env"];
  const want = scriptArgs(serve, exe);
  const matches =
    entry["command"] === exe &&
    Array.isArray(args) &&
    args.length === want.length &&
    want.every((a, i) => args[i] === a) &&
    isRecord(serverEnv) &&
    serverEnv[DATA_DIR_ENV] === store &&
    (custom === undefined || custom.length === 0
      ? serverEnv[CONFIG_ENV] === undefined
      : serverEnv[CONFIG_ENV] === custom);
  return { file, present: true, matches, unreadable: false };
}

// ── who is still running ────────────────────────────────────────────────────

export interface RunningProcess {
  readonly pid: number;
  /** In the words the output uses: "an MCP server", "the worker", "a dashboard". */
  readonly what: string;
  readonly command: string;
  /** Its parent, when the look saw it. For an MCP server that is the host
   *  process that started it — Claude Code, for one of its sessions. */
  readonly ppid?: number;
}

/**
 * WHAT A LOOK FOUND, AND WHETHER IT WAS A LOOK AT ALL.
 *
 * `looked: false` is "I could not check" — no `ps`, a timeout, a sandbox that
 * refuses process listing — and it is NOT the same fact as an empty list
 * (review M3). The two were indistinguishable, so the destructive verb parked a
 * store on a box with no `ps` and said nothing about it.
 */
export interface ProcessSighting {
  readonly looked: boolean;
  readonly processes: readonly RunningProcess[];
  /**
   * EVERY process's parent (pid → ppid), not only ours — the chain from this
   * process up to the host it runs under is what tells `connect` which
   * running server is the session it was typed into (`serverCensus`).
   * Absent when the look could not say, and from a lister that does not.
   */
  readonly parents?: ReadonlyMap<number, number>;
  /**
   * Whether Claude Desktop itself is running (its app's main process, not a
   * server of ours) — `connect` will not rewrite Desktop's config file under
   * it, because Desktop rewrites that file while it runs. Absent when the
   * look could not say, and from a lister that does not.
   */
  readonly desktopRunning?: boolean;
}

/** Claude Desktop's main process on macOS: the app's own executable, not its
 *  "Claude Helper" processes and not a path that merely mentions the app. */
export const DESKTOP_APP_PROCESS = /(^|\/)Claude\.app\/Contents\/MacOS\/Claude(\s|$)/;

export type ProcessLister = () => ProcessSighting;

/**
 * The command lines that mean one of OURS is running, and NOTHING that merely
 * mentions the name.
 *
 * `pgrep -f counterparts` matches an editor with this repository open, a `tail`
 * on a log, a dev server in a directory with the word in its path — the very
 * warning `start-fresh` prints. So the needles here are the SCRIPTS, path
 * segment included, plus the two installed shims anchored at a boundary.
 */
const PROCESS_MARKS: readonly { readonly re: RegExp; readonly what: string }[] = [
  { re: /mcp[/\\]bin[/\\]serve\.(ts|mjs)/, what: "an MCP server" },
  { re: /(^|[\s"'/\\])counterparts-mcp(\s|$|")/, what: "an MCP server" },
  { re: /claude-code[/\\]bin[/\\]runner\.ts/, what: "the worker" },
  { re: /dashboard[/\\]bin[/\\]dashboard\.(ts|mjs)/, what: "a dashboard" },
  { re: /(^|[\s"'/\\])counterparts-dashboard(\s|$|")/, what: "a dashboard" },
  // The single binary (`runtime.ts#BINARY_MODES`): `…/counterparts mcp`.
  { re: /(^|[/\\])counterparts(\.exe)?"?\s+mcp(\s|$)/, what: "an MCP server" },
  { re: /(^|[/\\])counterparts(\.exe)?"?\s+runner(\s|$)/, what: "the worker" },
  { re: /(^|[/\\])counterparts(\.exe)?"?\s+dashboard(\s|$)/, what: "a dashboard" },
];

/** Which of ours, if any, this command line is. Exported for the test, which
 *  proves the false positives stay false. */
export function processMark(command: string): string | null {
  for (const mark of PROCESS_MARKS) {
    if (mark.re.test(command)) return mark.what;
  }
  return null;
}

/**
 * `ps -axwwo pid=,ppid=,command=`, filtered here rather than by `pgrep -f`. The
 * parent column (2026-10-09) is kept for every line, ours or not, so a caller
 * can walk from this process up to its host (`ProcessSighting.parents`).
 *
 * `ww` (review of #331): procps on Linux cuts `command` at `$COLUMNS` when that
 * is set, even into a pipe, and the cut can fall before the path segment
 * `processMark` needs. Unlimited width on both procps and macOS.
 *
 * **It never throws and it never fails the caller.** A machine with no `ps`, a
 * `ps` that times out, a sandbox that refuses process listing — every one of
 * them answers "I could not see any", and every caller treats that as no
 * evidence rather than as evidence of absence. This is a courtesy, not a guard.
 */
export function realProcessLister(env: Record<string, string | undefined>): ProcessLister {
  return () => {
    try {
      const res = spawnSync("ps", ["-axwwo", "pid=,ppid=,command="], {
        encoding: "utf8",
        timeout: 4000,
        windowsHide: true,
        env: env as NodeJS.ProcessEnv,
      });
      // A `ps` that is missing, that timed out, or that exited non-zero is a
      // look that did not happen. The caller decides what to do about that;
      // this only refuses to pretend it was an empty answer.
      if (res.error !== undefined && res.error !== null) return NO_LOOK;
      if (res.status !== 0) return NO_LOOK;
      const out: RunningProcess[] = [];
      const parents = new Map<number, number>();
      let desktopRunning = false;
      for (const line of String(res.stdout ?? "").split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (m === null) continue;
        const pid = Number(m[1]);
        const ppid = Number(m[2]);
        const command = m[3] ?? "";
        parents.set(pid, ppid);
        if (DESKTOP_APP_PROCESS.test(command)) desktopRunning = true;
        if (pid === process.pid) continue;
        const what = processMark(command);
        if (what === null) continue;
        out.push({ pid, what, command, ppid });
      }
      return { looked: true, processes: out, parents, desktopRunning };
    } catch {
      return NO_LOOK;
    }
  };
}

/** The answer a look that did not happen gives. */
export const NO_LOOK: ProcessSighting = { looked: false, processes: [] };

/** Ask, and never throw at the caller. A lister that blew up is a look that did
 *  not happen, which is a different fact from "nothing is running". */
export function look(lister: ProcessLister): ProcessSighting {
  try {
    return lister();
  } catch {
    return NO_LOOK;
  }
}


// ── the command ─────────────────────────────────────────────────────────────

export type Outcome = "ok" | "refused" | "failed";

export interface WireInput {
  readonly io: Io;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  /** The host configuration this install uses — its path decides `--config`. */
  readonly configPath: string;
  /** That path again, but only when it is NOT the default one: the hooks and
   *  the server then have to carry it (`install.ts#hookCommand`). */
  readonly custom: string | undefined;
  /** `dataDir` — the store the MCP server is told to open. */
  readonly store: string;
  readonly now: number;
  readonly yes: boolean;
  readonly dryRun: boolean;
  /** `process.execPath` in a real run; a fixed string in a test. */
  readonly exe: string;
  readonly spawner: Spawner;
  readonly lister: ProcessLister;
  /** `install` prints its own step heading; a bare `wire` prints one here. */
  readonly heading?: boolean;
}

export interface WireResult {
  readonly outcome: Outcome;
  /** What happened to the five hooks, in one word for the caller's summary. */
  readonly hooks: "wired" | "repaired" | "already" | "declined" | "refused" | "removed" | "none";
  readonly mcp: "added" | "re-added" | "already" | "printed" | "removed" | "absent" | "skipped";
  readonly backup: string | null;
  /**
   * FOR `unwire` ONLY: is the registration provably gone?
   *
   * True when `claude mcp remove` exited 0, or when a read of the host's own
   * file shows no registration. False when `claude` is missing, hung or angry
   * and a registration is still there — which `uninstall`'s two irreversible
   * arms treat as a refusal (review M2): the file's own argument for blocking
   * is that a pointer at a directory that is not there fails silently at every
   * session start, and that is as true of the server as of the hooks.
   */
  readonly mcpConfirmed: boolean;
}

/**
 * The SHORT preview — two lines, never the JSON. The block is what `install`
 * prints when it is not allowed to apply it; a person about to say yes wants
 * the shape of the change, not sixty lines of it.
 *
 * **It describes what WILL happen, not what the command is for.** Driven on a
 * pty (2026-09-21) it said "5 hooks -> ~/.claude/settings.json (backup first)"
 * on a re-run where the hooks were already right and only the registration was
 * missing — promising a backup that was then correctly not taken. A preview
 * that overstates is a preview people stop reading.
 */
function preview(
  u: Ui,
  sight: SettingsSight,
  home: string,
  hooksChange: string,
  mcpWord: string,
): void {
  u.hint(`${String(HOST_EVENTS.length)} hooks -> ${tilde(sight.target, home)} ${hooksChange}`);
  u.hint(`1 MCP server -> ${mcpWord}`);
}

/** What the hooks half of the preview says, from the plan rather than the verb. */
function hooksClause(changed: boolean, exists: boolean): string {
  if (!changed) return "(already there — nothing to change)";
  return exists ? "(backup first)" : "(new file)";
}

/**
 * `counterparts connect` — put the five hooks in the host's settings and
 * register the memory server.
 *
 * The order is deliberate: the hooks FIRST, because they are the half this
 * package can do by itself and the half that works without a restart; the MCP
 * registration second, because it goes through another program that may not be
 * there. A missing `claude` is not a failure — it is one printed line and a
 * zero exit.
 */
export async function wire(input: WireInput): Promise<WireResult> {
  const { io, env, home, now } = input;
  const u = ui(io, env);
  const named = userSettingsPath(home, env);
  const sight = sightSettings(named, home);
  const command = hookCommand(input.custom, input.exe);

  if (input.heading !== false) {
    u.heading("Connecting Claude Code…");
  }

  if (sight.refusal !== null) {
    io.err(sight.refusal);
    io.err("");
    io.err("Nothing was changed. The block to merge by hand, under a top-level \"hooks\" key:");
    for (const line of settingsBlock(command).split("\n")) io.err(`  ${line}`);
    return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null, mcpConfirmed: false };
  }

  const merged = mergeHooks(sight.value, command, "wire");
  const mcp = readMcp(home, env, input.store, input.custom, input.exe);
  // WHEN OUR READ OF THE HOST'S FILE FAILS, ASK THE HOST (review m8).
  //
  // The "already wired, nothing to ask" short-circuit hung on one file that the
  // host owns and may move. When it cannot be read, `claude mcp get` is the
  // question's real owner; when that cannot be reached either, the answer is
  // "not wired", which asks rather than assumes.
  const registered = mcp.unreadable ? askClaudeForRegistration(input) : mcp.matches;
  const mcpNeeded = !registered;

  // ── nothing to do ─────────────────────────────────────────────────────────
  if (!merged.changed && !mcpNeeded) {
    u.ok(
      `already connected — all ${String(HOST_EVENTS.length)} hooks and the memory tools are in place.`,
    );
    u.hint(`hooks: ${tilde(sight.target, home)}`);
    u.hint(`tools: ${tilde(mcp.file, home)} (registered as "${MCP_SERVER_NAME}")`);
    u.hint("Nothing was changed and no backup was taken.");
    return { outcome: "ok", hooks: "already", mcp: "already", backup: null, mcpConfirmed: false };
  }

  // ── say what would change ─────────────────────────────────────────────────
  //
  // ONLY WHEN SOMEBODY IS ABOUT TO BE ASKED, or when nothing will happen at all
  // (2026-09-22, finding #4's sequel). `counterparts connect` does not ask — the
  // verb is the yes — so narrating the change and then reporting it one line
  // later is the wall of text this round is about. A dry run is ALL preview, and
  // a console that will put the question owes the reader what they are agreeing
  // to.
  const replacing = merged.events.filter((e) => e.change === "replaced");
  const willAsk = !input.yes && io.prompt !== undefined;
  if (input.dryRun) {
    u.hint("dry run — nothing below has been written.");
  }
  if (input.dryRun || willAsk) {
    preview(
      u,
      sight,
      home,
      hooksClause(merged.changed, sight.exists),
      mcp.present
        ? mcp.matches
          ? "already registered"
          : "re-registered via `claude mcp add`"
        : "via `claude mcp add`",
    );
  }
  for (const e of replacing) {
    u.hint(`${e.event}: replacing a Counterparts hook that names ${e.was ?? "another path"}`);
  }
  for (const e of merged.events) {
    if (e.duplicatesRemoved > 0) {
      u.hint(`${e.event}: dropping ${String(e.duplicatesRemoved)} duplicate entr${e.duplicatesRemoved === 1 ? "y" : "ies"} of ours`);
    }
  }
  if (merged.foreignKept > 0) {
    u.hint(
      merged.foreignKept === 1
        ? "1 hook belonging to something else stays exactly where it is."
        : `${String(merged.foreignKept)} hooks belonging to something else stay exactly where they are.`,
    );
  }
  wrappedNote(u, merged.wrapped, "left exactly as it is");

  if (input.dryRun) {
    u.hint("Dry run: nothing was written and nothing was registered.");
    return { outcome: "ok", hooks: "declined", mcp: "skipped", backup: null, mcpConfirmed: false };
  }

  // ── ask ───────────────────────────────────────────────────────────────────
  //
  // A console with NO prompt at all is a pipe, a CI job or a test. It is not
  // asked and it is not wired: `install` prints the blocks there, exactly as it
  // has since day one, and `wire` says which flag means yes.
  if (!input.yes) {
    if (io.prompt === undefined) {
      io.err(
        "refused: this is not an interactive console, so nothing was asked and nothing was " +
          `connected. Run \`${BIN.cli} connect\`, which does not ask, or \`${BIN.cli} install\` ` +
          "at a terminal, where it asks first.",
      );
      return { outcome: "refused", hooks: "declined", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
    const go = await confirm(io, "Connect Claude Code now?", { default: true });
    if (!go) {
      u.hint("Not connected. Nothing was changed.");
      u.hint(`You can do it later with: ${BIN.cli} connect`);
      return { outcome: "ok", hooks: "declined", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
  }

  // ── the hooks ─────────────────────────────────────────────────────────────
  let backup: string | null = null;
  let hooksWord: WireResult["hooks"] = "already";
  /** Where the hooks ended up — the re-read file's target when there was a
   *  write, and the one already sighted when there was not. */
  let landedIn = sight.target;
  if (merged.changed) {
    // RE-READ BEFORE WRITING (commands.ts rule 2): between the preview and the
    // answer the file may have changed — another tool's installer, an editor
    // saving. The plan is re-made against what is there NOW, and a file that
    // has become unreadable in the meantime refuses rather than gets rewritten.
    const fresh = sightSettings(named, home);
    if (fresh.refusal !== null) {
      io.err(`refused after re-reading the file: ${fresh.refusal}`);
      return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
    const again = mergeHooks(fresh.value, command, "wire");
    landedIn = fresh.target;
    if (!again.changed) {
      // THE WORK WAS DONE WHILE WE ASKED (review n3). The re-read found the
      // hooks already right — another `connect`, another terminal, the person
      // pasting the block — and the first plan's "changed" is stale. Writing on
      // it took a backup and rewrote identical bytes; now nothing is written
      // and nothing is backed up, and the line below says "already in".
      u.hint("The hooks were already in place when the file was read again, so nothing was written.");
    } else {
      const wrote = writeSettings(fresh, again.value, now);
      backup = wrote.backup;
      if (wrote.error !== null) {
        io.err(`failed to write ${fresh.target}: ${wrote.error}`);
        io.err(
          wrote.backup === null
            ? "Nothing was changed."
            : `Nothing was changed; the backup taken first is at ${wrote.backup}.`,
        );
        return { outcome: "failed", hooks: "refused", mcp: "skipped", backup, mcpConfirmed: false };
      }
      hooksWord = again.events.some((e) => e.change === "replaced") ? "repaired" : "wired";
    }
  }

  // ── the MCP server ────────────────────────────────────────────────────────
  //
  // It prints only when something needs saying — `claude` missing, an exit code
  // nobody expected, a name that had to be taken over. On the ordinary path it
  // is silent and the ONE line below covers both halves.
  const mcpWord = registerMcp(input, u, mcp);

  // ── ONE LINE FOR THE WHOLE THING (2026-09-22, the owner's install screen) ──
  //
  // It was five: `backed up: …`, the hooks, the server, and the two sentences
  // about open sessions. Every fact in them is still here or still printed by
  // the arm that needed it — the backup is named by `disconnect`, which is the
  // command whose reader may want the file back, and the sessions note belongs
  // to whoever called this (a standalone `connect` prints it; `install` ends
  // with its own "restart Claude Code" line).
  const where = tilde(landedIn, home);
  const verb =
    hooksWord === "repaired" ? "repaired in" : hooksWord === "wired" ? "added to" : "already in";
  const kept = backup === null ? "" : " (backup kept)";
  const tools =
    mcpWord === "printed"
      ? null
      : mcpWord === "already"
        ? "memory tools already registered"
        : "memory tools registered";
  const hooksSaid = `${String(HOST_EVENTS.length)} hooks ${verb} ${where}${kept}`;
  u.ok(tools === null ? hooksSaid : `connected — ${hooksSaid}, ${tools}`);
  return { outcome: "ok", hooks: hooksWord, mcp: mcpWord, backup, mcpConfirmed: false };
}

/**
 * Does the HOST think our server is registered? Asked only when its own file
 * could not be read. A `claude` that is missing or angry answers "no", which
 * makes the caller ask rather than assume.
 */
function askClaudeForRegistration(input: WireInput): boolean {
  const res = input.spawner(["mcp", "get", MCP_SERVER_NAME]);
  return !res.missing && res.code === 0;
}

/**
 * Register the server through `claude mcp add`, or print the line.
 *
 * Three ways this can go, and none of them is a failure of the install:
 * registered; already registered at the same store and script; or `claude` is
 * not on this PATH, in which case the line is printed for the person and the
 * command still exits 0 — the hooks are in, and they are the half that works.
 *
 * IT SAYS NOTHING ON THE FIRST TWO (2026-09-22). The caller's one `ok` line
 * carries "memory tools registered", so a second sentence saying the same thing
 * in the builder's words is the wall of text finding #4 was about. Everything
 * UNUSUAL still speaks: a name that had to be taken over, a missing `claude`, an
 * exit code nobody expected.
 */
function registerMcp(input: WireInput, u: Ui, mcp: McpReading): WireResult["mcp"] {
  const line = mcpCommand(input.store, undefined, input.custom);
  if (mcp.matches) return "already";
  const add = (): SpawnResult => input.spawner(mcpAddArgs(input.store, input.custom, input.exe));
  let res = add();
  if (res.missing) {
    u.warn("`claude` is not on this PATH, so the MCP server was not registered.");
    u.hint("The hooks are in. Run this one line yourself, then restart Claude Code:");
    u.hint(`  ${line}`);
    return "printed";
  }
  let word: WireResult["mcp"] = "added";
  // ALREADY THERE, IN ONE FORM OR ANOTHER. Either our own read saw a
  // registration that does not match, or `claude` says the name is taken — the
  // two are the same situation seen from two sides, and the answer is the same:
  // remove the old one and add this one, out loud.
  const taken = /already exist|already configured|already added/i.test(`${res.out}\n${res.err}`);
  if (res.code !== 0 && (mcp.present || taken)) {
    u.hint(`a server named "${MCP_SERVER_NAME}" was already registered; replacing it.`);
    input.spawner(mcpRemoveArgs());
    res = add();
    word = "re-added";
  } else if (res.code === 0 && mcp.present) {
    word = "re-added";
  }
  if (res.code !== 0) {
    u.warn(`\`claude mcp add\` exited ${String(res.code ?? -1)}; the server may not be registered.`);
    const detail = `${res.err}${res.out}`.trim();
    if (detail.length > 0) for (const l of detail.split("\n").slice(0, 4)) u.hint(l);
    u.hint("Run this yourself, then restart Claude Code:");
    u.hint(`  ${line}`);
    return "printed";
  }
  return word;
}

/**
 * SOMEBODY'S OWN WRAPPER, NAMED ONCE (review m1).
 *
 * A command that ends in `counterparts-hook` runs our hook and is still their
 * line. `wire` will not overwrite it and `unwire` will not delete it, so the
 * one thing left to do is say so — otherwise a person whose wrapper survives an
 * `unwire` has a hook they cannot account for.
 */
export function wrappedNote(
  u: Ui,
  wrapped: readonly { readonly event: string; readonly command: string }[],
  verb: string,
): void {
  if (wrapped.length === 0) return;
  u.warn(
    `${String(wrapped.length)} hook${wrapped.length === 1 ? "" : "s"} run ours inside a longer ` +
      `command, so ${wrapped.length === 1 ? "it is" : "they are"} ${verb}:`,
  );
  for (const w of wrapped) u.hint(`  ${w.event}: ${w.command}`);
  u.hint("Edit those by hand if you want them changed.");
}

/**
 * WHAT AN OPEN SESSION DOES NOW — the owner asked for this by name.
 *
 * Measured on 2026-09-21: after `settings.json` changes, an ALREADY OPEN
 * session's hooks fire from its next turn, but its MCP tools do not appear
 * until Claude Code is restarted (a server keeps the code and the registration
 * it was launched with). Both halves are said, because a person who reads only
 * the first will wonder why `note` is missing.
 *
 * THE COUNT SAYS WHAT IT KNOWS (2026-10-09). It used to be every memory server
 * in the process table, called "the previous version's" — which nothing had
 * checked. The 0.3.12 release run printed "11 sessions are running the
 * previous version's memory server" over the owner's own open sessions, the
 * one it was typed into among them. Each server now goes where this store's
 * own records put it (`serverCensus`): another build than this install,
 * this build, or no record here at all — and the session the command was run
 * from is named in whichever it is in, when the process table can say which.
 */
export function sessionsNote(
  u: Ui,
  lister: ProcessLister,
  opts: {
    /** The store the connected server is told to open — where servers leave their records. */
    readonly dataDir: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly installed?: BuildStamp;
    readonly selfPid?: number;
    readonly now?: number;
  },
): void {
  u.hint("Hooks start with your next turn in any open Claude Code session.");
  u.hint("The memory tools appear after you restart Claude Code.");
  // Only the MCP servers, which is what "restart your sessions" is about. This
  // FAILS OPEN on purpose: a look that did not happen says nothing, because
  // this is a courtesy line, not a guard.
  const sight = look(lister);
  const running = sight.processes.filter((p) => p.what === "an MCP server");
  if (running.length === 0) return;
  const installed = opts.installed ?? installedBuild();
  const census = serverCensus(running, {
    dataDir: opts.dataDir,
    installed,
    ...(sight.parents === undefined ? {} : { parents: sight.parents }),
    ...(opts.selfPid === undefined ? {} : { selfPid: opts.selfPid }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });
  const here = "the session you ran this from";
  if (census.other > 0) {
    const n = census.other;
    u.hint(
      `(${String(n)} open session${n === 1 ? "" : "s"} still run${n === 1 ? "s" : ""} memory server ${census.otherVersions.join(" or ")}, ` +
        `not this install's ${installed.version ?? "build"}${census.mine === "other" ? ` — ${here} ${n === 1 ? "is that one" : "is one of them"}` : ""}: ` +
        `restart ${n === 1 ? "it, or run /mcp and Reconnect in it" : "them, or run /mcp and Reconnect in each"}.)`,
    );
  }
  if (census.current > 0) {
    const n = census.current;
    u.hint(
      `(${String(n)} open session${n === 1 ? "" : "s"} already run${n === 1 ? "s" : ""} this version` +
        `${census.mine === "current" ? `, ${here} included` : ""}.)`,
    );
  }
  if (census.unplaced > 0) {
    const n = census.unplaced;
    const more = census.other + census.current > 0 ? " more" : "";
    u.hint(
      `(${String(n)}${more} memory server${n === 1 ? " is" : "s are"} running that this store holds no current record of — ` +
        "another store's, one in a directory where memory is off, or a build from before servers recorded themselves — " +
        `so which version ${n === 1 ? "it runs" : "they run"} is not known here${census.mine === "unplaced" ? `; ${here} is ${n === 1 ? "that one" : "one of them"}` : ""}.)`,
    );
  }
  // HONEST WHEN IT CANNOT TELL. Run from inside Claude Code, that session's
  // own server is one of the ones counted; without the parent column the
  // count cannot say which, so it says that rather than guess.
  if (!census.knowsMine && claudeCodeEnvMarker(opts.env ?? {}) !== null) {
    u.hint("(This was run from inside a Claude Code session, so that session's own server is counted above; which one it is could not be told from here.)");
  }
}

/** Where the running memory servers stand, by this store's own records. */
export interface ServerCensus {
  /** Servers whose record here names another build than this install's. */
  readonly other: number;
  /** Those builds' versions, distinct, in the order first seen. */
  readonly otherVersions: readonly string[];
  /** Servers whose record here names this install's build. */
  readonly current: number;
  /** Running servers this store holds no believed record of. */
  readonly unplaced: number;
  /** Which of the three the server of the session this command runs in is in,
   *  or null when none of them could be named as its. */
  readonly mine: "other" | "current" | "unplaced" | null;
  /** Whether the look gave parents, so `mine` is an answer and not a blank. */
  readonly knowsMine: boolean;
}

/**
 * SORT THE RUNNING MEMORY SERVERS BY WHAT THIS STORE KNOWS OF THEM.
 *
 * Every server leaves `sessions/mcp-server@<pid>.json` in the store it opened
 * (`sessions.ts#recordServerLaunch`): its build, and its parent — the host
 * process that started it. A record is believed when its pid is one the
 * process table just listed AND its heartbeat is fresh (`serverBelieved`,
 * with the table as the liveness answer), so a pid the OS handed on is not
 * read as the server that left the file.
 *
 * THE SESSION THIS COMMAND RUNS IN is the one whose server's parent is one of
 * this process's own ancestors — run from Claude Code's shell, the chain goes
 * up through the shell to the very `claude` process that started that server.
 * Pid 1 is never an ancestor for this: an orphaned server is reparented to it,
 * and every process descends from it. Pure over its inputs; never throws.
 */
export function serverCensus(
  running: readonly RunningProcess[],
  input: {
    readonly dataDir: string;
    readonly installed: BuildStamp;
    readonly parents?: ReadonlyMap<number, number>;
    readonly selfPid?: number;
    readonly now?: number;
  },
): ServerCensus {
  const listed = new Set(running.map((p) => p.pid));
  const now = input.now ?? Date.now();
  const records = new Map<number, ServerRecordRead>();
  for (const r of readServerRecords(input.dataDir)) {
    if (serverBelieved(r.pid, r.refreshedAt, now, (pid) => listed.has(pid))) records.set(r.pid, r);
  }
  const ancestors = new Set<number>();
  if (input.parents !== undefined) {
    let at = input.parents.get(input.selfPid ?? process.pid);
    while (at !== undefined && at > 1 && !ancestors.has(at)) {
      ancestors.add(at);
      at = input.parents.get(at);
    }
  }
  let other = 0;
  let current = 0;
  let unplaced = 0;
  const otherVersions: string[] = [];
  let mine: ServerCensus["mine"] = null;
  for (const p of running) {
    const r = records.get(p.pid);
    const bucket: NonNullable<ServerCensus["mine"]> =
      r === undefined ? "unplaced" : sameBuild(r.build, input.installed) ? "current" : "other";
    if (bucket === "unplaced") unplaced += 1;
    else if (bucket === "current") current += 1;
    else {
      other += 1;
      const v =
        r === undefined || r.build.version === null
          ? "of an unknown version"
          : r.build.version === input.installed.version
            ? `${r.build.version} (another build of it)`
            : r.build.version;
      if (!otherVersions.includes(v)) otherVersions.push(v);
    }
    const ppid = p.ppid ?? input.parents?.get(p.pid);
    if (mine === null && ((ppid !== undefined && ancestors.has(ppid)) || (r !== undefined && ancestors.has(r.hostPid)))) mine = bucket;
  }
  return { other, otherVersions, current, unplaced, mine, knowsMine: input.parents !== undefined };
}

/**
 * `counterparts unwire` — take OUR hooks out and deregister the server.
 *
 * It removes only what the recogniser calls ours, and it is the same recogniser
 * `wire`'s repair uses, so a hook this command leaves behind is one `wire` would
 * also have left behind. Nothing belonging to another tool is read as a
 * candidate at any point.
 */
export async function unwire(input: WireInput): Promise<WireResult> {
  const { io, env, home, now } = input;
  const u = ui(io, env);
  const named = userSettingsPath(home, env);
  const sight = sightSettings(named, home);

  if (input.heading !== false) u.heading("Disconnecting Claude Code");

  if (sight.refusal !== null) {
    io.err(sight.refusal);
    io.err("Nothing was changed. Remove the Counterparts hook entries by hand.");
    return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null, mcpConfirmed: false };
  }

  const merged = mergeHooks(sight.value, "", "unwire");
  const mcp = readMcp(home, env, input.store, input.custom, input.exe);

  // `mcp.unreadable` is NOT "nothing there": that file is the host's own and a
  // read that failed is no evidence either way, which is the same stance the
  // removal below takes.
  if (!merged.changed && !mcp.present && !mcp.unreadable) {
    u.ok("nothing to disconnect: no Counterparts hooks and no memory server were found.");
    // SAID EVEN HERE: a wrapper is exactly the case where "nothing of ours"
    // needs a sentence, because the person can see a hook that mentions us and
    // would otherwise have no account of why it survived.
    wrappedNote(u, merged.wrapped, "left exactly as it is");
    u.hint(`looked in: ${sight.target}`);
    u.hint(`and in:    ${mcp.file}`);
    return { outcome: "ok", hooks: "none", mcp: "absent", backup: null, mcpConfirmed: true };
  }

  wrappedNote(u, merged.wrapped, "left exactly as it is");

  if (input.dryRun) {
    u.hint("dry run — nothing below has been written.");
    for (const e of merged.events) u.hint(`${e.event}: would remove ${e.was ?? "our hook"}`);
    u.hint(`would run: claude mcp remove ${MCP_SERVER_NAME} -s user`);
    if (merged.foreignKept > 0) {
      u.hint(
        merged.foreignKept === 1
          ? "1 hook belonging to something else would stay."
          : `${String(merged.foreignKept)} hooks belonging to something else would stay.`,
      );
    }
    return { outcome: "ok", hooks: "none", mcp: "skipped", backup: null, mcpConfirmed: false };
  }

  if (!input.yes) {
    if (io.prompt === undefined) {
      io.err(
        "refused: this is not an interactive console and nothing was confirmed. Pass --yes if " +
          "that is what you mean.",
      );
      return { outcome: "refused", hooks: "none", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
    preview(
      u,
      sight,
      home,
      merged.changed ? "(backup first)" : "(none of ours are there)",
      "removed via `claude mcp remove`",
    );
    const go = await confirm(io, "Remove the Counterparts hooks and the MCP server?", {
      default: true,
    });
    if (!go) {
      u.hint("Nothing was changed.");
      return { outcome: "ok", hooks: "declined", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
  }

  let backup: string | null = null;
  let hooksWord: WireResult["hooks"] = "none";
  if (merged.changed) {
    const fresh = sightSettings(named, home);
    if (fresh.refusal !== null) {
      io.err(`refused after re-reading the file: ${fresh.refusal}`);
      return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
    const again = mergeHooks(fresh.value, "", "unwire");
    // THE SAME RACE, THE OTHER WAY ROUND (review n3): the hooks went while the
    // question was up. Nothing to write, no backup, and the line says so.
    if (!again.changed) {
      u.ok(`no Counterparts hooks were left in ${tilde(fresh.target, home)} when it was read again.`);
    }
    const wrote = again.changed ? writeSettings(fresh, again.value, now) : { backup: null, error: null };
    backup = wrote.backup;
    if (wrote.error !== null) {
      io.err(`failed to write ${fresh.target}: ${wrote.error}`);
      io.err(backup === null ? "Nothing was changed." : `The backup taken first is at ${backup}.`);
      return { outcome: "failed", hooks: "refused", mcp: "skipped", backup, mcpConfirmed: false };
    }
    if (again.changed) {
      hooksWord = "removed";
      // THE BACKUP IS NAMED HERE, IN FULL, and not on `connect`'s line — the
      // owner's screens, 2026-09-22. This is the reader who may want their old
      // settings file back, and a path they have to reconstruct from a sentence
      // is a path they cannot type. `~/…` for the file, the whole name for the
      // copy.
      u.ok(
        `${String(again.events.length)} hook${again.events.length === 1 ? "" : "s"} removed from ` +
          `${tilde(fresh.target, home)}${backup === null ? "" : ` (backup: ${basename(backup)})`}`,
      );
    }
    if (again.foreignKept > 0) {
      u.hint(
        again.foreignKept === 1
          ? "1 hook belonging to something else was left exactly as it was."
          : `${String(again.foreignKept)} hooks belonging to something else were left exactly as they were.`,
      );
    }
  } else {
    u.ok(`no Counterparts hooks were in ${tilde(sight.target, home)}.`);
  }

  // THE REMOVE IS ATTEMPTED WHETHER OR NOT OUR READ SAW A REGISTRATION.
  //
  // `~/.claude.json` is the host's own state file — its documentation says so,
  // and `install.ts#hostMcpFile` already warns that it may move. Our read is
  // therefore evidence, not authority: a registration we cannot see is still a
  // registration, and an unwire that skipped the removal because of where it
  // looked would leave a server pointed at a store nobody is wiring any more.
  // Removing what is not there costs one exit code, which is why the brief says
  // "tolerate not found".
  let mcpWord: WireResult["mcp"] = "absent";
  // WAS IT ACTUALLY DEREGISTERED — asked, not assumed (review M2).
  //
  // `mcpConfirmed` is true only when `claude mcp remove` exited 0, or when a
  // FRESH read of the host's own file shows no registration. A missing, hung or
  // angry `claude` with a registration still on disk is false, and
  // `uninstall`'s two irreversible arms refuse on it: a server pointed at a
  // store that is no longer there fails at every session start with nothing on
  // screen, which is the same argument this file already makes for the hooks.
  let mcpConfirmed = false;
  const res = input.spawner(mcpRemoveArgs());
  const notThere = /not found|no .*server|does not exist|not configured/i.test(`${res.out}\n${res.err}`);
  // AN UNREADABLE FILE IS NOT AN ABSENT REGISTRATION.
  //
  // `readMcp` reports `present: false` when the file will not parse, and the
  // first version of this read that as "nothing is registered" — so a corrupt
  // `~/.claude.json` plus a missing `claude` confirmed the deregistration and
  // let the irreversible arm run. M2's own words are "a read of the
  // registration shows it ABSENT", and a read that failed shows nothing at all.
  const stillThere = (): boolean => {
    const fresh = readMcp(home, env, input.store, input.custom, input.exe);
    return fresh.present || fresh.unreadable;
  };
  if (res.missing) {
    mcpConfirmed = !stillThere();
    if (mcpConfirmed) {
      u.hint(`no MCP registration named "${MCP_SERVER_NAME}" was there to remove.`);
      mcpWord = "absent";
    } else {
      u.warn("`claude` is not on this PATH, so the MCP server was not deregistered.");
      u.hint(`Run it yourself: claude mcp remove ${MCP_SERVER_NAME} -s user`);
      mcpWord = "printed";
    }
  } else if (res.code === 0) {
    u.ok("memory server removed");
    mcpWord = "removed";
    mcpConfirmed = true;
  } else if (notThere || !mcp.present) {
    // `claude` says there was nothing there. Believe it, and check the file
    // too — this is the one place where two sources agreeing is cheap.
    mcpConfirmed = !stillThere();
    u.hint(`no MCP registration named "${MCP_SERVER_NAME}" was there to remove.`);
    mcpWord = "absent";
  } else {
    mcpConfirmed = !stillThere();
    u.warn(`\`claude mcp remove\` exited ${String(res.code ?? -1)}.`);
    if (!mcpConfirmed) u.hint(`Run it yourself: claude mcp remove ${MCP_SERVER_NAME} -s user`);
    mcpWord = mcpConfirmed ? "absent" : "printed";
  }

  u.hint("An open Claude Code session keeps working until you close it.");
  return { outcome: "ok", hooks: hooksWord, mcp: mcpWord, backup, mcpConfirmed };
}

