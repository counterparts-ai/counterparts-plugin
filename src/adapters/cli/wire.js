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
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DATA_DIR_ENV, isWithin } from "../../core/store/index.js";
import { CONFIG_ENV, CONFIG_FLAG } from "../config-path.js";
import { isOurHookCommand } from "../host-wiring.js";
import { claudeCodeEnvMarker } from "../hosts.js";
import { parseScriptInvocation, readsHostUserConfig, scriptArgs, shellTokens } from "../runtime.js";
import { installedBuild, readServerRecords, sameBuild, serverBelieved } from "../sessions.js";
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
  settingsBlock
} from "./install.js";
import { realpathDeep } from "./start-fresh.js";
import { confirm, ui } from "./ui.js";
export function userSettingsPath(home, env) {
  return join(hostSettingsDir(home, env), "settings.json");
}
export const BACKUP_INFIX = "counterparts-backup";
export function backupPath(path, now) {
  const stamp = new Date(now).toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  return `${path}.${BACKUP_INFIX}-${stamp}`;
}
export function copyToFreeBackup(target, now) {
  const base = backupPath(target, now);
  for (let n = 1;n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base}-${String(n)}`;
    try {
      copyFileSync(target, candidate, constants.COPYFILE_EXCL);
      return candidate;
    } catch (err) {
      if (err.code !== "EEXIST")
        throw err;
    }
  }
  throw new Error(`no free backup name beside ${target}`);
}
export function tilde(path, home) {
  const h = resolve(home);
  return path === h ? "~" : isWithin(h, path) ? `~${path.slice(h.length)}` : path;
}
export const DEFAULT_SETTINGS_FORMAT = { indent: "  ", eol: `
`, finalNewline: true };
export function majorityEol(raw) {
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (raw.match(/\r(?!\n)/g) ?? []).length;
  if (crlf > lf && crlf >= cr)
    return `\r
`;
  if (cr > lf && cr > crlf)
    return "\r";
  return `
`;
}
export function sniffSettingsFormat(raw) {
  const eol = majorityEol(raw);
  if (!/[\r\n]/.test(raw.trimEnd()))
    return { ...DEFAULT_SETTINGS_FORMAT, eol };
  const finalNewline = /[\r\n][ \t]*$/.test(raw);
  const unit = /[\r\n]([ \t]+)\S/.exec(raw)?.[1];
  if (unit === undefined || unit.length > 10 || unit.includes("\t") && unit.includes(" ")) {
    return { indent: DEFAULT_SETTINGS_FORMAT.indent, eol, finalNewline };
  }
  return { indent: unit, eol, finalNewline };
}
export function jsonNoise(raw) {
  let bare = "";
  let comments = false;
  let singleQuotes = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i] ?? "";
    const next = raw[i + 1] ?? "";
    if (ch === '"' || ch === "'") {
      if (ch === "'")
        singleQuotes = true;
      i += 1;
      while (i < raw.length && raw[i] !== ch && raw[i] !== `
`) {
        i += raw[i] === "\\" ? 2 : 1;
      }
      i += 1;
      bare += '""';
      continue;
    }
    if (ch === "/" && next === "/") {
      comments = true;
      while (i < raw.length && raw[i] !== `
`)
        i += 1;
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
export function unparsedSettingsWhy(raw) {
  if (raw.charCodeAt(0) === 65279) {
    return "starts with a byte-order mark — an invisible character some editors put at the top of " + 'a file. This command reads and writes plain JSON only. Save the file as "UTF-8" rather ' + 'than "UTF-8 with BOM" and run this again';
  }
  const noise = jsonNoise(raw);
  if (noise.comments && noise.singleQuotes) {
    return "holds comments (// or /* */) and single-quoted strings ('…'). This command reads and " + "writes plain JSON only, which allows neither, and writing this file back would drop " + "every comment in it. Move the comments out, put double quotes where the single ones " + "are, and run this again";
  }
  if (noise.singleQuotes) {
    return "uses single quotes ('…') around names or values, and plain JSON needs double quotes " + '("…"). Change them and run this again';
  }
  if (noise.comments) {
    return "holds comments (// or /* */). This command reads and writes plain JSON only, and " + "writing this file back would drop every comment in it. Move the comments out of the " + "file and run this again";
  }
  if (/[^\s{[,]\s*,\s*[}\]]/.test(noise.bare)) {
    return "has a comma just before a closing } or ], which plain JSON does not allow. Remove it " + "and run this again";
  }
  return null;
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function sightSettings(named, home) {
  const absent = {
    named,
    target: named,
    symlink: false,
    exists: false,
    mode: null,
    value: {},
    format: DEFAULT_SETTINGS_FORMAT,
    refusal: null
  };
  const realHome = realpathDeep(home);
  const parent = dirname(named);
  if (existsSync(parent)) {
    const realParent = realpathDeep(parent);
    if (!isWithin(realHome, realParent)) {
      return {
        ...absent,
        refusal: `refused: ${parent} resolves to ${realParent}, which is outside your home directory ` + `(${realHome}). This command will not write a settings file into a directory nobody ` + "named. Edit it by hand there, or point that link back inside your home."
      };
    }
  }
  let stat;
  try {
    stat = lstatSync(named);
  } catch {
    return absent;
  }
  let target = named;
  let symlink = false;
  if (stat.isSymbolicLink()) {
    symlink = true;
    const written = readlinkSync(named);
    const pointsAt = isAbsolute(written) ? resolve(written) : resolve(dirname(named), written);
    target = realpathDeep(pointsAt);
    if (!isWithin(realHome, target) || target === realHome) {
      return {
        ...absent,
        target,
        symlink: true,
        exists: existsSync(target),
        refusal: `refused: ${named} is a symbolic link to ${target}, which is outside your home ` + `directory (${realHome}). Writing through it would edit a file somewhere nobody ` + "named, and replacing the link with a regular file would quietly detach whatever " + "manages it. Edit the target by hand, or point the link somewhere inside your home."
      };
    }
    if (!existsSync(target)) {
      return {
        ...absent,
        target,
        symlink: true,
        refusal: `refused: ${named} is a symbolic link to ${target}, and nothing is there. That is a ` + "dotfiles arrangement part-way through being set up, not a place to create a file: " + "writing it would replace the link, and whatever manages it would never see this. " + "Put the target in place first, or merge the block below by hand."
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
      refusal: `refused: ${target} is not a regular file. This command edits the host's settings ` + "file; it will not guess at what else that name might be."
    };
  }
  const mode = real.mode & 511;
  let raw;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      mode,
      refusal: `refused: ${target} exists and could not be read (${String(err.message ?? err)}). ` + "Nothing was changed."
    };
  }
  if (raw.trim().length === 0) {
    return { ...absent, target, symlink, exists: true, mode };
  }
  let parsed;
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
      refusal: why !== null ? `refused: ${target} ${why} — or make the change by hand. Nothing in it was touched.` : `refused: ${target} does not parse as JSON (${String(err.message ?? err)}). ` + "This command will not rewrite a file it cannot read — the one there may hold every " + "other tool's configuration, and a fresh one written over it would lose all of it. " + "Fix the file, or merge the block below by hand."
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
      refusal: `refused: ${target} parses, but its top level is ${Array.isArray(parsed) ? "an array" : `a ${typeof parsed}`} ` + "rather than an object. A settings file this command does not recognise is one it " + "does not edit."
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
      refusal: `refused: the "hooks" key in ${target} is ${Array.isArray(hooks) ? "an array" : `a ${typeof hooks}`}, ` + "not an object of event names. Merging into a shape this command does not understand " + "is how a working configuration stops working."
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
          refusal: `refused: "hooks"."${event}" in ${target} is not an array. The host reads that key ` + "as a list of hook groups, and this command will not overwrite a value whose " + "meaning it cannot tell."
        };
      }
    }
  }
  return { named, target, symlink, exists: true, mode, value: parsed, format, refusal: null };
}

export { isOurHookCommand };
function isOurs(entry) {
  if (!isRecord(entry))
    return false;
  const command = entry["command"];
  return typeof command === "string" && isOurHookCommand(command);
}
function isWrapped(entry) {
  if (!isRecord(entry))
    return false;
  const command = entry["command"];
  return typeof command === "string" && HOOK_COMMAND_MARK.test(command) && !isOurHookCommand(command);
}
export function mergeHooks(settings, command, direction) {
  const next = structuredClone(settings);
  const existing = next["hooks"];
  const hooks = isRecord(existing) ? existing : {};
  const events = [];
  const wrapped = [];
  let foreignKept = 0;
  let changed = false;
  for (const event of HOST_EVENTS) {
    const raw = hooks[event];
    const groups = Array.isArray(raw) ? raw : [];
    const outGroups = [];
    let seen = 0;
    let was;
    let duplicates = 0;
    let touchedGroup = false;
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) {
        outGroups.push(group);
        continue;
      }
      const inner = group["hooks"];
      const kept = [];
      let innerTouched = false;
      for (const entry of inner) {
        if (!isOurs(entry)) {
          kept.push(entry);
          if (isRecord(entry) && typeof entry["command"] === "string")
            foreignKept += 1;
          if (isWrapped(entry)) {
            wrapped.push({ event, command: String(entry["command"]) });
          }
          continue;
        }
        seen += 1;
        if (direction === "unwire") {
          if (was === undefined)
            was = String(entry["command"]);
          innerTouched = true;
          continue;
        }
        if (seen === 1) {
          was = String(entry["command"]);
          if (was === command) {
            kept.push(entry);
          } else {
            kept.push({ ...entry, command });
            innerTouched = true;
          }
          continue;
        }
        duplicates += 1;
        innerTouched = true;
      }
      if (inner.length > 0 && kept.length === 0) {
        touchedGroup = true;
        continue;
      }
      outGroups.push(innerTouched ? { ...group, hooks: kept } : group);
      if (innerTouched)
        touchedGroup = true;
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
          ...was === undefined ? {} : { was },
          duplicatesRemoved: duplicates
        });
        changed = true;
      }
      hooks[event] = outGroups;
      continue;
    }
    if (seen === 0)
      continue;
    events.push({
      event,
      change: "removed",
      ...was === undefined ? {} : { was },
      duplicatesRemoved: Math.max(0, seen - 1)
    });
    changed = true;
    if (outGroups.length === 0)
      delete hooks[event];
    else
      hooks[event] = outGroups;
  }
  if (Object.keys(hooks).length === 0) {
    if ("hooks" in next)
      delete next["hooks"];
  } else {
    next["hooks"] = hooks;
  }
  return { value: next, events, changed, foreignKept, wrapped };
}
export function settingsBytes(value, format = DEFAULT_SETTINGS_FORMAT) {
  const text = JSON.stringify(value, null, format.indent);
  const lines = format.eol === `
` ? text : text.replace(/\n/g, format.eol);
  return format.finalNewline ? `${lines}${format.eol}` : lines;
}
export function writeSettings(sight, value, now) {
  const target = sight.target;
  const dir = dirname(target);
  let backup = null;
  let temp = null;
  try {
    mkdirSync(dir, { recursive: true });
    if (sight.exists) {
      backup = copyToFreeBackup(target, now);
      if (sight.mode !== null)
        chmodSync(backup, sight.mode);
    }
    temp = join(dir, `.counterparts-wire-${String(process.pid)}-${String(now)}.tmp`);
    const mode = sight.mode ?? 420;
    writeFileSync(temp, settingsBytes(value, sight.format), { mode });
    chmodSync(temp, mode);
    renameSync(temp, target);
    return { backup, error: null };
  } catch (err) {
    if (temp !== null) {
      try {
        rmSync(temp, { force: true });
      } catch {}
    }
    return { backup, error: String(err.message ?? err) };
  }
}
export const CLAUDE_BIN = "claude";
export const CLAUDE_TIMEOUT_MS = 30000;
export function realSpawner(env) {
  return (args) => {
    const res = spawnSync(CLAUDE_BIN, [...args], {
      encoding: "utf8",
      timeout: CLAUDE_TIMEOUT_MS,
      windowsHide: true,
      env
    });
    if (res.error !== undefined && res.error !== null) {
      const code = res.error.code ?? "";
      return {
        missing: code === "ENOENT",
        code: null,
        out: String(res.stdout ?? ""),
        err: code === "ENOENT" ? "" : String(res.error.message)
      };
    }
    return {
      missing: false,
      code: res.status,
      out: String(res.stdout ?? ""),
      err: String(res.stderr ?? "")
    };
  };
}
export function mcpAddArgs(store, custom, exe, serve = MCP_SCRIPT) {
  return [
    "mcp",
    "add",
    MCP_SERVER_NAME,
    "-s",
    "user",
    "-e",
    `${DATA_DIR_ENV}=${store}`,
    ...custom === undefined || custom.length === 0 ? [] : ["-e", `${CONFIG_ENV}=${custom}`],
    "--",
    exe,
    ...scriptArgs(serve, exe)
  ];
}
export function mcpRemoveArgs() {
  return ["mcp", "remove", MCP_SERVER_NAME, "-s", "user"];
}
export function readMcp(home, env, store, custom, exe, serve = MCP_SCRIPT, readsUserConfig = readsHostUserConfig()) {
  const file = hostMcpFile(hostConfigBase(home, env));
  if (!readsUserConfig)
    return { file, present: false, matches: false, unreadable: false, notRead: true };
  if (!existsSync(file))
    return { file, present: false, matches: false, unreadable: false };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { file, present: false, matches: false, unreadable: true };
  }
  if (!isRecord(raw))
    return { file, present: false, matches: false, unreadable: true };
  const servers = raw["mcpServers"];
  if (!isRecord(servers))
    return { file, present: false, matches: false, unreadable: false };
  const entry = servers[MCP_SERVER_NAME];
  if (!isRecord(entry))
    return { file, present: false, matches: false, unreadable: false };
  const args = entry["args"];
  const serverEnv = entry["env"];
  const want = scriptArgs(serve, exe);
  const matches = entry["command"] === exe && Array.isArray(args) && args.length === want.length && want.every((a, i) => args[i] === a) && isRecord(serverEnv) && serverEnv[DATA_DIR_ENV] === store && (custom === undefined || custom.length === 0 ? serverEnv[CONFIG_ENV] === undefined : serverEnv[CONFIG_ENV] === custom);
  return { file, present: true, matches, unreadable: false };
}
export const DESKTOP_APP_PROCESS = /(^|\/)Claude\.app\/Contents\/MacOS\/Claude(\s|$)/;
const PROCESS_MARKS = [
  { re: /(adapters[/\\]mcp[/\\]bin[/\\]serve\.js|mcp[/\\]bin[/\\]serve\.(ts|mjs))(?=$|["'\s])/, what: "an MCP server" },
  { re: /(^|[\s"'/\\])counterparts-mcp(\s|$|")/, what: "an MCP server" },
  { re: /(adapters[/\\]claude-code[/\\]bin[/\\]runner\.js|claude-code[/\\]bin[/\\]runner\.ts)(?=$|["'\s])/, what: "the worker" },
  { re: /(adapters[/\\]dashboard[/\\]bin[/\\]dashboard\.js|dashboard[/\\]bin[/\\]dashboard\.(ts|mjs))(?=$|["'\s])/, what: "a dashboard" },
  { re: /(^|[\s"'/\\])counterparts-dashboard(\s|$|")/, what: "a dashboard" },
  { re: /(^|[/\\])counterparts(\.exe)?"?\s+mcp(\s|$)/, what: "an MCP server" },
  { re: /(^|[/\\])counterparts(\.exe)?"?\s+runner(\s|$)/, what: "the worker" },
  { re: /(^|[/\\])counterparts(\.exe)?"?\s+dashboard(\s|$)/, what: "a dashboard" }
];
export function processMark(command) {
  for (const mark of PROCESS_MARKS) {
    if (mark.re.test(command))
      return mark.what;
  }
  return null;
}
export function realProcessLister(env) {
  return () => {
    try {
      const res = spawnSync("ps", ["-axwwo", "pid=,ppid=,command="], {
        encoding: "utf8",
        timeout: 4000,
        windowsHide: true,
        env
      });
      if (res.error !== undefined && res.error !== null)
        return NO_LOOK;
      if (res.status !== 0)
        return NO_LOOK;
      const out = [];
      const parents = new Map;
      let desktopRunning = false;
      for (const line of String(res.stdout ?? "").split(`
`)) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (m === null)
          continue;
        const pid = Number(m[1]);
        const ppid = Number(m[2]);
        const command = m[3] ?? "";
        parents.set(pid, ppid);
        if (DESKTOP_APP_PROCESS.test(command))
          desktopRunning = true;
        if (pid === process.pid)
          continue;
        const what = processMark(command);
        if (what === null)
          continue;
        out.push({ pid, what, command, ppid });
      }
      return { looked: true, processes: out, parents, desktopRunning };
    } catch {
      return NO_LOOK;
    }
  };
}
export const NO_LOOK = { looked: false, processes: [] };
export function look(lister) {
  try {
    return lister();
  } catch {
    return NO_LOOK;
  }
}
function preview(u, sight, home, hooksChange, mcpWord) {
  u.hint(`${String(HOST_EVENTS.length)} hooks -> ${tilde(sight.target, home)} ${hooksChange}`);
  u.hint(`1 MCP server -> ${mcpWord}`);
}
function hooksClause(changed, exists) {
  if (!changed)
    return "(already there — nothing to change)";
  return exists ? "(backup first)" : "(new file)";
}
export async function wire(input) {
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
    io.err('Nothing was changed. The block to merge by hand, under a top-level "hooks" key:');
    for (const line of settingsBlock(command).split(`
`))
      io.err(`  ${line}`);
    return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null, mcpConfirmed: false };
  }
  const merged = mergeHooks(sight.value, command, "wire");
  const mcp = readMcp(home, env, input.store, input.custom, input.exe);
  const registered = mcp.unreadable ? askClaudeForRegistration(input) : mcp.matches;
  const mcpNeeded = !registered;
  if (!merged.changed && !mcpNeeded) {
    u.ok(`already connected — all ${String(HOST_EVENTS.length)} hooks and the memory tools are in place.`);
    u.hint(`hooks: ${tilde(sight.target, home)}`);
    u.hint(`tools: ${tilde(mcp.file, home)} (registered as "${MCP_SERVER_NAME}")`);
    u.hint("Nothing was changed and no backup was taken.");
    return { outcome: "ok", hooks: "already", mcp: "already", backup: null, mcpConfirmed: false };
  }
  const replacing = merged.events.filter((e) => e.change === "replaced");
  const willAsk = !input.yes && io.prompt !== undefined;
  if (input.dryRun) {
    u.hint("dry run — nothing below has been written.");
  }
  if (input.dryRun || willAsk) {
    preview(u, sight, home, hooksClause(merged.changed, sight.exists), mcp.present ? mcp.matches ? "already registered" : "re-registered via `claude mcp add`" : "via `claude mcp add`");
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
    u.hint(merged.foreignKept === 1 ? "1 hook belonging to something else stays exactly where it is." : `${String(merged.foreignKept)} hooks belonging to something else stay exactly where they are.`);
  }
  wrappedNote(u, merged.wrapped, "left exactly as it is");
  if (input.dryRun) {
    u.hint("Dry run: nothing was written and nothing was registered.");
    return { outcome: "ok", hooks: "declined", mcp: "skipped", backup: null, mcpConfirmed: false };
  }
  if (!input.yes) {
    if (io.prompt === undefined) {
      io.err("refused: this is not an interactive console, so nothing was asked and nothing was " + `connected. Run \`${BIN.cli} connect\`, which does not ask, or \`${BIN.cli} install\` ` + "at a terminal, where it asks first.");
      return { outcome: "refused", hooks: "declined", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
    const go = await confirm(io, "Connect Claude Code now?", { default: true });
    if (!go) {
      u.hint("Not connected. Nothing was changed.");
      u.hint(`You can do it later with: ${BIN.cli} connect`);
      return { outcome: "ok", hooks: "declined", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
  }
  let backup = null;
  let hooksWord = "already";
  let landedIn = sight.target;
  if (merged.changed) {
    const fresh = sightSettings(named, home);
    if (fresh.refusal !== null) {
      io.err(`refused after re-reading the file: ${fresh.refusal}`);
      return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
    const again = mergeHooks(fresh.value, command, "wire");
    landedIn = fresh.target;
    if (!again.changed) {
      u.hint("The hooks were already in place when the file was read again, so nothing was written.");
    } else {
      const wrote = writeSettings(fresh, again.value, now);
      backup = wrote.backup;
      if (wrote.error !== null) {
        io.err(`failed to write ${fresh.target}: ${wrote.error}`);
        io.err(wrote.backup === null ? "Nothing was changed." : `Nothing was changed; the backup taken first is at ${wrote.backup}.`);
        return { outcome: "failed", hooks: "refused", mcp: "skipped", backup, mcpConfirmed: false };
      }
      hooksWord = again.events.some((e) => e.change === "replaced") ? "repaired" : "wired";
    }
  }
  const mcpWord = registerMcp(input, u, mcp);
  const where = tilde(landedIn, home);
  const verb = hooksWord === "repaired" ? "repaired in" : hooksWord === "wired" ? "added to" : "already in";
  const kept = backup === null ? "" : " (backup kept)";
  const tools = mcpWord === "printed" ? null : mcpWord === "already" ? "memory tools already registered" : "memory tools registered";
  const hooksSaid = `${String(HOST_EVENTS.length)} hooks ${verb} ${where}${kept}`;
  u.ok(tools === null ? hooksSaid : `connected — ${hooksSaid}, ${tools}`);
  return { outcome: "ok", hooks: hooksWord, mcp: mcpWord, backup, mcpConfirmed: false };
}
function askClaudeForRegistration(input) {
  const res = input.spawner(["mcp", "get", MCP_SERVER_NAME]);
  return !res.missing && res.code === 0;
}
function registerMcp(input, u, mcp) {
  const line = mcpCommand(input.store, undefined, input.custom);
  if (mcp.matches)
    return "already";
  const add = () => input.spawner(mcpAddArgs(input.store, input.custom, input.exe));
  let res = add();
  if (res.missing) {
    u.warn("`claude` is not on this PATH, so the MCP server was not registered.");
    u.hint("The hooks are in. Run this one line yourself, then restart Claude Code:");
    u.hint(`  ${line}`);
    return "printed";
  }
  let word = "added";
  const taken = /already exist|already configured|already added/i.test(`${res.out}
${res.err}`);
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
    if (detail.length > 0)
      for (const l of detail.split(`
`).slice(0, 4))
        u.hint(l);
    u.hint("Run this yourself, then restart Claude Code:");
    u.hint(`  ${line}`);
    return "printed";
  }
  return word;
}
export function wrappedNote(u, wrapped, verb) {
  if (wrapped.length === 0)
    return;
  u.warn(`${String(wrapped.length)} hook${wrapped.length === 1 ? "" : "s"} run ours inside a longer ` + `command, so ${wrapped.length === 1 ? "it is" : "they are"} ${verb}:`);
  for (const w of wrapped)
    u.hint(`  ${w.event}: ${w.command}`);
  u.hint("Edit those by hand if you want them changed.");
}
export function sessionsNote(u, lister, opts) {
  u.hint("Hooks start with your next turn in any open Claude Code session.");
  u.hint("The memory tools appear after you restart Claude Code.");
  const sight = look(lister);
  const running = sight.processes.filter((p) => p.what === "an MCP server");
  if (running.length === 0)
    return;
  const installed = opts.installed ?? installedBuild();
  const census = serverCensus(running, {
    dataDir: opts.dataDir,
    installed,
    ...sight.parents === undefined ? {} : { parents: sight.parents },
    ...opts.selfPid === undefined ? {} : { selfPid: opts.selfPid },
    ...opts.now === undefined ? {} : { now: opts.now }
  });
  const here = "the session you ran this from";
  if (census.other > 0) {
    const n = census.other;
    u.hint(`(${String(n)} open session${n === 1 ? "" : "s"} still run${n === 1 ? "s" : ""} memory server ${census.otherVersions.join(" or ")}, ` + `not this install's ${installed.version ?? "build"}${census.mine === "other" ? ` — ${here} ${n === 1 ? "is that one" : "is one of them"}` : ""}: ` + `restart ${n === 1 ? "it, or run /mcp and Reconnect in it" : "them, or run /mcp and Reconnect in each"}.)`);
  }
  if (census.current > 0) {
    const n = census.current;
    u.hint(`(${String(n)} open session${n === 1 ? "" : "s"} already run${n === 1 ? "s" : ""} this version` + `${census.mine === "current" ? `, ${here} included` : ""}.)`);
  }
  if (census.unplaced > 0) {
    const n = census.unplaced;
    const more = census.other + census.current > 0 ? " more" : "";
    u.hint(`(${String(n)}${more} memory server${n === 1 ? " is" : "s are"} running that this store holds no current record of — ` + "another store's, one in a directory where memory is off, or a build from before servers recorded themselves — " + `so which version ${n === 1 ? "it runs" : "they run"} is not known here${census.mine === "unplaced" ? `; ${here} is ${n === 1 ? "that one" : "one of them"}` : ""}.)`);
  }
  if (!census.knowsMine && claudeCodeEnvMarker(opts.env ?? {}) !== null) {
    u.hint("(This was run from inside a Claude Code session, so that session's own server is counted above; which one it is could not be told from here.)");
  }
}
export function serverCensus(running, input) {
  const listed = new Set(running.map((p) => p.pid));
  const now = input.now ?? Date.now();
  const records = new Map;
  for (const r of readServerRecords(input.dataDir)) {
    if (serverBelieved(r.pid, r.refreshedAt, now, (pid) => listed.has(pid)))
      records.set(r.pid, r);
  }
  const ancestors = new Set;
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
  const otherVersions = [];
  let mine = null;
  for (const p of running) {
    const r = records.get(p.pid);
    const bucket = r === undefined ? "unplaced" : sameBuild(r.build, input.installed) ? "current" : "other";
    if (bucket === "unplaced")
      unplaced += 1;
    else if (bucket === "current")
      current += 1;
    else {
      other += 1;
      const v = r === undefined || r.build.version === null ? "of an unknown version" : r.build.version === input.installed.version ? `${r.build.version} (another build of it)` : r.build.version;
      if (!otherVersions.includes(v))
        otherVersions.push(v);
    }
    const ppid = p.ppid ?? input.parents?.get(p.pid);
    if (mine === null && (ppid !== undefined && ancestors.has(ppid) || r !== undefined && ancestors.has(r.hostPid)))
      mine = bucket;
  }
  return { other, otherVersions, current, unplaced, mine, knowsMine: input.parents !== undefined };
}
export async function unwire(input) {
  const { io, env, home, now } = input;
  const u = ui(io, env);
  const named = userSettingsPath(home, env);
  const sight = sightSettings(named, home);
  if (input.heading !== false)
    u.heading("Disconnecting Claude Code");
  if (sight.refusal !== null) {
    io.err(sight.refusal);
    io.err("Nothing was changed. Remove the Counterparts hook entries by hand.");
    return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null, mcpConfirmed: false };
  }
  const merged = mergeHooks(sight.value, "", "unwire");
  const mcp = readMcp(home, env, input.store, input.custom, input.exe, MCP_SCRIPT, input.readsUserConfig);
  if (!merged.changed && !mcp.present && !mcp.unreadable && mcp.notRead !== true) {
    u.ok("nothing to disconnect: no Counterparts hooks and no memory server were found.");
    wrappedNote(u, merged.wrapped, "left exactly as it is");
    u.hint(`looked in: ${sight.target}`);
    u.hint(`and in:    ${mcp.file}`);
    return { outcome: "ok", hooks: "none", mcp: "absent", backup: null, mcpConfirmed: true };
  }
  wrappedNote(u, merged.wrapped, "left exactly as it is");
  if (input.dryRun) {
    u.hint("dry run — nothing below has been written.");
    for (const e of merged.events)
      u.hint(`${e.event}: would remove ${e.was ?? "our hook"}`);
    u.hint(`would run: claude mcp remove ${MCP_SERVER_NAME} -s user`);
    if (merged.foreignKept > 0) {
      u.hint(merged.foreignKept === 1 ? "1 hook belonging to something else would stay." : `${String(merged.foreignKept)} hooks belonging to something else would stay.`);
    }
    return { outcome: "ok", hooks: "none", mcp: "skipped", backup: null, mcpConfirmed: false };
  }
  if (!input.yes) {
    if (io.prompt === undefined) {
      io.err("refused: this is not an interactive console and nothing was confirmed. Pass --yes if " + "that is what you mean.");
      return { outcome: "refused", hooks: "none", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
    preview(u, sight, home, merged.changed ? "(backup first)" : "(none of ours are there)", "removed via `claude mcp remove`");
    const go = await confirm(io, "Remove the Counterparts hooks and the MCP server?", {
      default: true
    });
    if (!go) {
      u.hint("Nothing was changed.");
      return { outcome: "ok", hooks: "declined", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
  }
  let backup = null;
  let hooksWord = "none";
  if (merged.changed) {
    const fresh = sightSettings(named, home);
    if (fresh.refusal !== null) {
      io.err(`refused after re-reading the file: ${fresh.refusal}`);
      return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null, mcpConfirmed: false };
    }
    const again = mergeHooks(fresh.value, "", "unwire");
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
      u.ok(`${String(again.events.length)} hook${again.events.length === 1 ? "" : "s"} removed from ` + `${tilde(fresh.target, home)}${backup === null ? "" : ` (backup: ${basename(backup)})`}`);
    }
    if (again.foreignKept > 0) {
      u.hint(again.foreignKept === 1 ? "1 hook belonging to something else was left exactly as it was." : `${String(again.foreignKept)} hooks belonging to something else were left exactly as they were.`);
    }
  } else {
    u.ok(`no Counterparts hooks were in ${tilde(sight.target, home)}.`);
  }
  let mcpWord = "absent";
  let mcpConfirmed = false;
  const res = input.spawner(mcpRemoveArgs());
  const notThere = /not found|no .*server|does not exist|not configured/i.test(`${res.out}
${res.err}`);
  const stillThere = () => {
    const fresh = readMcp(home, env, input.store, input.custom, input.exe, MCP_SCRIPT, input.readsUserConfig);
    return fresh.present || fresh.unreadable || fresh.notRead === true;
  };
  if (res.missing && mcp.notRead === true) {
    mcpConfirmed = false;
    u.warn("`claude` is not on this PATH and this version does not read Claude Code's own configuration, so whether a memory server is still registered (an npm install's, if there is one) could not be checked.");
    u.hint(`Remove one if it is there: claude mcp remove ${MCP_SERVER_NAME} -s user — and run this again where \`claude\` is on PATH to have it checked.`);
    mcpWord = "printed";
  } else if (res.missing) {
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
  } else if (notThere || !mcp.present && mcp.notRead !== true) {
    mcpConfirmed = mcp.notRead === true || !stillThere();
    u.hint(`no MCP registration named "${MCP_SERVER_NAME}" was there to remove.`);
    mcpWord = "absent";
  } else {
    mcpConfirmed = !stillThere();
    u.warn(`\`claude mcp remove\` exited ${String(res.code ?? -1)}.`);
    if (!mcpConfirmed)
      u.hint(`Run it yourself: claude mcp remove ${MCP_SERVER_NAME} -s user`);
    mcpWord = mcpConfirmed ? "absent" : "printed";
  }
  u.hint("An open Claude Code session keeps working until you close it.");
  return { outcome: "ok", hooks: hooksWord, mcp: mcpWord, backup, mcpConfirmed };
}
