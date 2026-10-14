import { existsSync, lstatSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";
import { Store, assertSafeDataDir, dateOf, isWithin, storeExists } from "../../core/store/index.js";
import { isJournal } from "../../core/sleep/index.js";
import { SCOPES_FILE_NAME, shellWord } from "../scopes.js";
import { SIDEBAR_FILE_NAME } from "../sidebar-status.js";
import { PLUGIN_ROOT_ENV, installRoute } from "../plugin.js";
import { pluginInstall } from "../host-wiring.js";
import { pluginConsoleWords } from "../runtime.js";
import { SNAPSHOTS_DIR_NAME, resolveSnapshotsDir } from "../snapshots.js";
import { BIN, CONFIG_FILE, LEGACY_CREDENTIALS_FILE, MCP_SERVER_NAME, hostSettingsDir } from "./install.js";
import {
  OPEN_WINDOW_MS,
  PARKED_INFIX,
  pairedSuffix,
  realpathDeep,
  sameFilesystemRefusal
} from "./start-fresh.js";
import { readHolders } from "./rollback.js";
import { confirm, typed, ui } from "./ui.js";
import { look, readMcp, tilde, unwire } from "./wire.js";
export const DELETE_PHRASE = "DELETE MEMORIES";
export const DELETE_QUESTION = "Also delete all memories and related data? This can't be undone.";
export const PHRASE_PROMPT = `Type ${DELETE_PHRASE} to go ahead — Esc or "cancel" to stop: `;
export const REMOVE_PACKAGE = `bun remove -g ${BIN.cli}`;
export const REMOVE_PLUGIN = "in Claude Code, /plugin → Installed → counterparts → Uninstall";
export function consoleName(env, home) {
  if (installRoute(env) !== "plugin")
    return BIN.cli;
  return pluginConsoleWords((env[PLUGIN_ROOT_ENV] ?? "").trim()).map((w) => shellWord(w, home)).join(" ");
}
export function removeProgram(env) {
  const route = installRoute(env);
  if (route === "npm")
    return REMOVE_PACKAGE;
  if (route === "plugin")
    return REMOVE_PLUGIN;
  return `${REMOVE_PACKAGE} (npm) · ${REMOVE_PLUGIN} (plugin)`;
}
export const PLUGIN_ID_FALLBACK = "counterparts@counterparts";
export function pluginUninstallCommand(plugin, home) {
  const command = `claude plugin uninstall ${plugin?.id ?? PLUGIN_ID_FALLBACK}`;
  const scope = plugin?.scope ?? null;
  if (scope !== "project" && scope !== "local")
    return command;
  const where = plugin?.projectPath ?? null;
  return where === null ? `${command} --scope ${scope} (in the project it was installed for)` : `cd ${shellWord(where, home)} && ${command} --scope ${scope}`;
}
export function removePluginAtTerminal(env, home) {
  return pluginUninstallCommand(pluginInstall({ home, env, cwd: null }), home);
}
export const PLUGIN_BEFORE_REOPEN = "Run it here, before you open Claude Code again: while the plugin is on, its first start sets " + "Counterparts up again, with a new, empty memory folder.";
function removeProgramAfterGone(input) {
  const route = installRoute(input.env);
  if (route === "npm") {
    input.io.out(`To remove the program too: ${REMOVE_PACKAGE}`);
    const also = pluginInstall({ home: input.home, env: input.env, cwd: null });
    if (also === null || !also.enabled)
      return;
    input.io.out(`Claude Code also has the plugin: ${pluginUninstallCommand(also, input.home)}`);
    input.io.out(PLUGIN_BEFORE_REOPEN);
    return;
  }
  const plugin = removePluginAtTerminal(input.env, input.home);
  input.io.out(`To remove the program too: ${route === "plugin" ? plugin : `${REMOVE_PACKAGE} (npm) · ${plugin} (plugin)`}`);
  input.io.out(PLUGIN_BEFORE_REOPEN);
}
export const CHECKING_CLAUDE_CODE = "Checking Claude Code…";
export function forbiddenBaseRefusal(base) {
  const written = resolve(base);
  for (const spelling of [written, realpathDeep(written)]) {
    try {
      assertSafeDataDir(spelling);
    } catch (err) {
      const root = err !== null && typeof err === "object" && "detail" in err ? String(err.detail["root"] ?? "a live store") : "a live store";
      return `refused by name: ${spelling} is inside ${root}. That is a live memory this package ` + "never touches — not to read it, not to move it, not to rename it (CLAUDE.md, the " + "second safety rule).";
    }
  }
  return null;
}
export function ownedNames(configPath, config, storeDir) {
  const dir = resolve(dirname(configPath));
  const snaps = storeDir === null ? null : resolveSnapshotsDir(storeDir, config.snapshots?.dir).dir;
  return {
    config: basename(resolve(configPath)),
    scopes: SCOPES_FILE_NAME,
    snapshots: snaps !== null && resolve(dirname(snaps)) === dir ? basename(snaps) : null,
    store: storeDir !== null && resolve(dirname(storeDir)) === dir ? basename(storeDir) : null
  };
}
export function ownedKind(name, owned) {
  if (name === owned.config)
    return "config";
  if (name === owned.scopes)
    return "scopes";
  if (owned.snapshots !== null && name === owned.snapshots)
    return "snapshots";
  if (owned.store !== null && name === owned.store)
    return "store";
  if (name === SIDEBAR_FILE_NAME || /^sidebar\.json\.\d+\.tmp$/.test(name))
    return "sidecar";
  const bases = [owned.config, owned.scopes, owned.snapshots, owned.store];
  for (const base of bases) {
    if (base === null || !name.startsWith(`${base}.`))
      continue;
    const suffix = name.slice(base.length + 1);
    if (/^\d+\.tmp$/.test(suffix) || suffix === "tmp" || /^counterparts-backup-/.test(suffix) || /^(parked|blank|new)-/.test(suffix)) {
      return "sidecar";
    }
  }
  return null;
}
export function dirSize(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return 0;
  }
  if (!stat.isDirectory())
    return stat.size;
  let total = 0;
  let entries;
  try {
    entries = readdirSync(path);
  } catch {
    return total;
  }
  for (const name of entries)
    total += dirSize(join(path, name));
  return total;
}
export function walBytes(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return 0;
  }
  if (!stat.isDirectory())
    return 0;
  let entries;
  try {
    entries = readdirSync(path);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of entries) {
    const full = join(path, name);
    if (name.endsWith(".sqlite-wal") && entries.includes(name.slice(0, -"-wal".length))) {
      try {
        const log = lstatSync(full);
        if (log.isFile())
          total += log.size;
      } catch {}
    } else {
      total += walBytes(full);
    }
  }
  return total;
}
export const LOG_WORTH_SAYING = 1024 * 1024;
export function logClause(logBytes, storeBytes) {
  if (logBytes < LOG_WORTH_SAYING || logBytes * 10 < storeBytes)
    return null;
  return [
    `${humanBytes(logBytes)} of that is a database log that shrinks on its own;`,
    "nothing is lost when it does."
  ];
}
export function humanBytes(bytes) {
  if (bytes < 1024)
    return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : String(Math.round(n))} ${units[i] ?? "KB"}`;
}
export function grouped(n) {
  return n.toLocaleString("en-US");
}
export function memories(n) {
  return n === 1 ? "1 memory" : `${grouped(n)} memories`;
}
export function censusOf(base, storeDir) {
  const store = storeDir === null ? join(base, "store") : resolve(storeDir);
  if (!storeExists(store)) {
    return {
      kind: "size",
      bytes: dirSize(base),
      why: "there is no store this build recognises at the path the configuration names"
    };
  }
  try {
    const opened = Store.open({ dir: store, observer: true });
    try {
      const denied = new Set(opened.deniedIds());
      let live = 0;
      let journal = 0;
      let schemas = 0;
      for (const id of opened.list()) {
        const row = opened.row(id);
        if (row === undefined || denied.has(id))
          continue;
        if (row.archived === 1)
          continue;
        if (row.superseded_by !== null)
          continue;
        if (isJournal(row)) {
          journal += 1;
          continue;
        }
        if (row.type === "schema") {
          schemas += 1;
          continue;
        }
        live += 1;
      }
      return { kind: "memories", memories: live, journal, schemas };
    } finally {
      opened.close();
    }
  } catch (err) {
    return {
      kind: "size",
      bytes: dirSize(base),
      why: `the store would not open on this build (${String(err.message ?? err).split(`
`)[0] ?? "no detail"})`
    };
  }
}
export function censusWords(census) {
  if (census.kind === "size")
    return "the count could not be taken";
  const journal = census.journal === 0 ? "" : `, ${grouped(census.journal)} journal entr${census.journal === 1 ? "y" : "ies"}`;
  if (census.memories > 0)
    return `${memories(census.memories)}${journal}`;
  const rest = census.schemas === 0 ? "" : `, ${grouped(census.schemas)} belief${census.schemas === 1 ? "" : "s"} or entit${census.schemas === 1 ? "y" : "ies"}`;
  return `no memories in it yet${rest}${journal}`;
}
export function planUninstall(input) {
  const configPath = resolve(input.configPath);
  const configDir = resolve(dirname(configPath));
  const written = input.config.dataDir;
  const storeDir = written === undefined || written.trim().length === 0 ? null : isAbsolute(written.trim()) ? resolve(written.trim()) : null;
  const empty = {
    configDir,
    configPath,
    storeDir,
    storeInside: storeDir !== null && isWithin(configDir, storeDir),
    storeActed: false,
    entries: [],
    foreign: [],
    wholeDirectory: false,
    targets: [],
    census: null,
    bytes: 0,
    logBytes: 0,
    refusal: null
  };
  const dirRefusal = configDirRefusal(configDir, configPath, input.home, input.verb, input.env);
  if (dirRefusal !== null)
    return { ...empty, refusal: dirRefusal };
  if (written !== undefined && written.trim().length > 0 && storeDir === null) {
    return {
      ...empty,
      refusal: `refused: ${configPath} names "${written.trim()}" as its store, which is not an absolute ` + "path — it means a different directory in every process that reads it. This will not " + `${input.verb} whatever happens to sit at that name.`
    };
  }
  if (storeDir !== null && existsSync(storeDir)) {
    const storeWhy = storeRefusal(storeDir, input.home, input.verb);
    if (storeWhy !== null)
      return { ...empty, refusal: storeWhy };
  }
  const owned = ownedNames(configPath, input.config, storeDir);
  const ours = [];
  const foreign = [];
  let names;
  try {
    names = readdirSync(configDir).sort();
  } catch (err) {
    return {
      ...empty,
      refusal: `refused: ${configDir} could not be listed (${String(err.message ?? err)}).`
    };
  }
  for (const name of names) {
    const kind = ownedKind(name, owned);
    if (kind === null) {
      foreign.push(name);
      continue;
    }
    if (kind === "store")
      continue;
    const path = join(configDir, name);
    ours.push({
      path,
      kind,
      what: WHAT[kind],
      bytes: dirSize(path),
      directory: isDirectory(path)
    });
  }
  const entries = [];
  const storeActed = storeDir !== null && existsSync(storeDir);
  if (storeActed && storeDir !== null) {
    entries.push({
      path: storeDir,
      kind: "store",
      what: WHAT.store,
      bytes: dirSize(storeDir),
      directory: true
    });
  }
  entries.push(...ours);
  const wholeDirectory = foreign.length === 0;
  const storeOutside = storeActed && storeDir !== null && !isWithin(configDir, storeDir);
  const targets = wholeDirectory ? [...storeOutside && storeDir !== null ? [storeDir] : [], configDir] : entries.map((e) => e.path);
  return {
    ...empty,
    storeActed,
    entries,
    foreign,
    wholeDirectory,
    targets,
    bytes: entries.reduce((n, e) => n + e.bytes, 0),
    logBytes: storeActed && storeDir !== null ? walBytes(storeDir) : 0,
    refusal: null
  };
}
export function counted(plan) {
  return { ...plan, census: censusOf(plan.configDir, plan.storeDir) };
}
const WHAT = {
  config: "the configuration",
  scopes: "which directories memory is on for",
  snapshots: "the snapshots",
  store: "your memory",
  sidecar: "a file this package left"
};
const SHORT_WHAT = {
  config: "configuration",
  scopes: "scopes",
  snapshots: "snapshots",
  store: "your memory",
  sidecar: "files it left behind"
};
function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}
export function configDirRefusal(configDir, configPath, home, verb, env = {}) {
  const raw = configDir.trim();
  if (raw.length === 0) {
    return `refused: nothing named a directory to ${verb}.`;
  }
  if (!isAbsolute(raw)) {
    return `refused: "${raw}" is not an absolute path, so it names a different directory in every ` + `process that reads it. This will not ${verb} whatever happens to sit at that name in ` + `its own working directory (${resolve(raw)}).`;
  }
  const written = resolve(raw);
  const forbidden = forbiddenBaseRefusal(written);
  if (forbidden !== null)
    return forbidden;
  const real = realpathDeep(written);
  const realHome = realpathDeep(home);
  if (real === parsePath(real).root) {
    return `refused: ${written} resolves to a filesystem root (${real}). Nothing here will ${verb} that.`;
  }
  if (real === realHome) {
    return `refused: ${written} resolves to your home directory (${real}). Nothing here will ${verb} that.`;
  }
  if (isWithin(real, realHome)) {
    return `refused: ${written} resolves to ${real}, which CONTAINS your home directory. ` + `Nothing here will ${verb} that.`;
  }
  if (!isWithin(realHome, real)) {
    return `refused: ${written} resolves to ${real}, which is outside your home directory ` + `(${realHome}). This command acts on what an install of yours wrote; a path anywhere ` + "else is one somebody else is responsible for.";
  }
  if (real === realpathDeep(join(home, ".claude")) || real === realpathDeep(resolve(hostSettingsDir(home, env)))) {
    return `refused: ${written} is Claude Code's own configuration directory. Whatever this ` + "install put there, the settings, the project transcripts and the todos beside it are " + `the host's, and this command will not ${verb} them. Move the configuration somewhere ` + "of its own and run this again.";
  }
  if (existsSync(join(written, ".git"))) {
    return `refused: ${written} holds a .git, so it is a repository somebody is working in. ` + `This command will not ${verb} a directory whose contents are under version control ` + "alongside a configuration that happens to sit in it.";
  }
  let stat;
  try {
    stat = lstatSync(written);
  } catch {
    return `refused: ${written} is not there, so there is nothing to ${verb}.`;
  }
  if (stat.isSymbolicLink()) {
    return `refused: ${written} is a SYMBOLIC LINK (to ${real}). Renaming a link moves the link and ` + "leaves the real directory exactly where it is — and removing one removes the link while " + "the memories stay live and unreachable. Act on the real directory by hand.";
  }
  if (!stat.isDirectory()) {
    return `refused: ${written} is not a directory.`;
  }
  if (!existsSync(configPath)) {
    return `refused: ${configPath} is not there, so this is not a Counterparts install to ${verb}.`;
  }
  return null;
}
export function storeRefusal(storeDir, home, verb) {
  const written = resolve(storeDir);
  const forbidden = forbiddenBaseRefusal(written);
  if (forbidden !== null)
    return forbidden;
  const real = realpathDeep(written);
  const realHome = realpathDeep(home);
  if (real === parsePath(real).root || real === realHome || isWithin(real, realHome)) {
    return `refused: the store resolves to ${real}. Nothing here will ${verb} that.`;
  }
  if (!isWithin(realHome, real)) {
    return `refused: the store is at ${real}, outside your home directory (${realHome}). This ` + `command will not ${verb} it there. Move it by hand, or point "dataDir" somewhere of ` + "your own first.";
  }
  let stat;
  try {
    stat = lstatSync(written);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) {
    return `refused: the store at ${written} is a SYMBOLIC LINK (to ${real}). Renaming one moves the ` + "link and leaves the memories exactly where they are; removing one leaves them live and " + "unreachable. Act on the real directory by hand.";
  }
  if (!stat.isDirectory()) {
    return `refused: the store at ${written} is not a directory.`;
  }
  if (!storeExists(written)) {
    return `refused: ${written} does not look like a Counterparts store — nothing this build ` + `recognises as one is in it. This will not ${verb} a directory on the strength of a ` + `"dataDir" alone.`;
  }
  return null;
}
export function planLines(plan, verb, home, suffix = null, deleteLead = "This will delete, for good:") {
  const out = [];
  const short = (path) => tilde(path, home);
  if (verb === "park") {
    out.push("This will set aside (renamed, nothing copied, nothing deleted):");
    for (const from of plan.targets) {
      out.push(suffix === null ? `  ${short(from)}` : `  ${short(from)}  →  ${short(`${from}${suffix}`)}`);
    }
    if (plan.targets.length === 0)
      out.push("  (nothing — there is none of ours left here)");
    else {
      out.push(`     ${contentsSentence(plan)}`);
      for (const line of logClause(plan.logBytes, storeBytesOf(plan)) ?? [])
        out.push(`     ${line}`);
    }
  } else {
    out.push(deleteLead);
    const pathWidth = plan.entries.reduce((n, e) => Math.max(n, short(e.path).length), 0);
    const sizeWidth = plan.entries.reduce((n, e) => Math.max(n, humanBytes(e.bytes).length), 0);
    for (const e of plan.entries) {
      const what = e.kind === "store" && plan.census !== null ? `${e.what} — ${censusWords(plan.census)}` : e.what;
      out.push(`  ${short(e.path).padEnd(pathWidth)}  ${humanBytes(e.bytes).padEnd(sizeWidth)}   ${what}`);
      const log = e.kind === "store" ? logClause(plan.logBytes, e.bytes) : null;
      for (const line of log ?? [])
        out.push(`${" ".repeat(2 + pathWidth + 2 + sizeWidth + 3)}${line}`);
    }
    if (plan.entries.length === 0)
      out.push("  (nothing — there is none of ours left here)");
    if (plan.wholeDirectory) {
      out.push(`  and the ${short(plan.configDir)} folder itself.`);
    }
  }
  if (!plan.wholeDirectory && plan.foreign.length > 0) {
    out.push("");
    out.push(`  ${short(plan.configDir)} itself STAYS. It also holds ` + (plan.foreign.length === 1 ? "1 thing that is not ours:" : `${String(plan.foreign.length)} things that are not ours:`));
    for (const name of plan.foreign.slice(0, 12))
      out.push(`    ${name}`);
    if (plan.foreign.length > 12)
      out.push(`    … and ${String(plan.foreign.length - 12)} more`);
    out.push("  None of those is touched.");
    if (plan.foreign.includes(LEGACY_CREDENTIALS_FILE)) {
      out.push(`  (${LEGACY_CREDENTIALS_FILE} is from an older install that used API keys. Counterparts no longer reads it; delete it yourself if you like.)`);
    }
  }
  if (plan.storeDir !== null && !plan.storeInside) {
    out.push("");
    out.push(`  Your memory is NOT inside that directory — it is at ${short(plan.storeDir)},`);
    out.push(`  and it is ${verb === "park" ? "moved" : "deleted"} there, on its own line above.`);
  }
  if (plan.storeDir !== null && !plan.storeActed) {
    out.push("");
    out.push(`  There is no store at ${short(plan.storeDir)}, so no memory is ${verb === "park" ? "moved" : "deleted"}.`);
  }
  return out;
}
function storeBytesOf(plan) {
  return plan.entries.find((e) => e.kind === "store")?.bytes ?? 0;
}
function contentsSentence(plan) {
  const seen = new Set;
  const words = [];
  for (const e of plan.entries) {
    const word = SHORT_WHAT[e.kind];
    if (seen.has(word))
      continue;
    seen.add(word);
    words.push(word);
  }
  const what = words.length === 0 ? "this install's own files" : words.join(", ");
  return `${what} — ${humanBytes(plan.bytes)}`;
}
export function notTouched(plan, config, home, env) {
  const out = [
    { path: hostSettingsDir(home, env), why: "Claude Code's own files: its settings, history and transcripts" }
  ];
  if (plan.storeDir !== null) {
    const snaps = resolveSnapshotsDir(plan.storeDir, config.snapshots?.dir).dir;
    if (snaps !== null && existsSync(snaps) && !plan.targets.some((t) => isWithin(t, snaps))) {
      out.push({ path: snaps, why: "the snapshots folder your configuration names — yours to delete" });
    }
  }
  return out;
}
export function notTouchedLines(items, home) {
  if (items.length === 0)
    return [];
  const width = items.reduce((n, i) => Math.max(n, tilde(i.path, home).length), 0);
  return ["", "  Not touched:", ...items.map((i) => `    ${tilde(i.path, home).padEnd(width)}  ${i.why}`)];
}
export function openRefusal(input, storeDir, holders) {
  const sighting = look(input.lister);
  if (!sighting.looked && !input.nothingIsOpen) {
    return [
      "refused: this could not check whether anything of ours is still running — there is no " + "usable `ps` here, or it would not answer. A rename does not break an open file handle " + "and a delete does not tell a running process it has gone, so this will not proceed on " + "a look that did not happen. Close every Claude Code session, dashboard and worker, and " + "say so: --nothing-is-open."
    ];
  }
  if (sighting.processes.length > 0) {
    return [
      `refused: ${String(sighting.processes.length)} Counterparts process${sighting.processes.length === 1 ? " is" : "es are"} still running:`,
      ...sighting.processes.map((p) => `  ${p.what}, pid ${String(p.pid)}`),
      "A rename does not break an open file handle and a delete does not tell a running " + "process it has gone. Close Claude Code sessions and try again."
    ];
  }
  if (holders && storeDir !== null && existsSync(storeDir)) {
    const refusing = liveHolders(storeDir, input).filter((h) => h.refuse);
    if (refusing.length > 0) {
      return [
        "refused: this store is open in:",
        ...refusing.map((h) => `  ${h.what} — ${h.detail}`),
        "Close every Claude Code session on it, quit Claude Desktop and stop the dashboard, then " + `try again. A session that crashed or whose terminal was closed counts for ${String(Math.round(OPEN_WINDOW_MS / 60000))} ` + "minutes after its last hook."
      ];
    }
  }
  return null;
}
function liveHolders(storeDir, input) {
  return readHolders({ storeDir, configPath: input.configPath, now: input.now });
}
export async function uninstall(input) {
  const { io, env, home } = input;
  const u = ui(io, env);
  const configDir = resolve(join(input.configPath, ".."));
  const moving = input.park || input.deleteMemories;
  const verb = input.park ? "park" : "delete";
  u.heading(`${BIN.cli} uninstall${input.park ? " --park" : input.deleteMemories ? " --delete-memories" : input.keepMemories === true ? " --keep-memories" : ""}`);
  if (input.custom !== undefined)
    u.hint(`configuration: ${tilde(input.configPath, home)}`);
  u.blank();
  const forbidden = forbiddenBaseRefusal(configDir);
  if (forbidden !== null) {
    io.err(forbidden);
    io.err("Nothing has changed and nothing was read.");
    return "refused";
  }
  if (input.park && input.deleteMemories) {
    io.err("refused: --park moves your memory aside and --delete-memories destroys it. They are two " + "answers to one question, and this will not guess which one you meant.");
    return "refused";
  }
  if (input.keepMemories === true && moving) {
    io.err(`refused: --keep-memories keeps your memory where it is and --${input.park ? "park" : "delete-memories"} ` + `${input.park ? "moves it aside" : "destroys it"}. They are two answers to one question, and this will ` + "not guess which one you meant.");
    return "refused";
  }
  let plan = null;
  if (moving) {
    plan = planUninstall({ configPath: input.configPath, config: input.config, home, verb, env });
    if (plan.refusal !== null) {
      io.err(plan.refusal);
      io.err("Nothing has changed.");
      return "refused";
    }
    if (input.park) {
      for (const entry of plan.targets) {
        const cross = sameFilesystemRefusal(entry);
        if (cross !== null) {
          io.err(cross);
          io.err("Nothing has changed.");
          return "refused";
        }
      }
    }
    const open = openRefusal(input, plan.storeDir, input.deleteMemories);
    if (open !== null) {
      for (const line of open)
        io.err(line);
      io.err("Nothing has changed.");
      return "refused";
    }
    const preflight = mcpPreflight(input, home);
    if (preflight !== null) {
      io.err(preflight);
      io.err("Nothing has changed.");
      return "refused";
    }
    plan = remeasured(plan);
    if (input.deleteMemories)
      plan = counted(plan);
    for (const line of planLines(plan, input.park ? "park" : "delete", home, previewSuffix(input, plan))) {
      io.out(line);
    }
    if (input.deleteMemories) {
      for (const line of notTouchedLines(notTouched(plan, input.config, home, env), home))
        io.out(line);
    }
    u.blank();
  }
  if (input.deleteMemories && plan !== null) {
    if (io.prompt === undefined) {
      io.err("refused: --delete-memories needs a person. It has no --yes and never will: the typed " + "phrase is the whole guard, and a script that could supply it would be a script that " + "deletes somebody's memory by having the right string in it.");
      return "refused";
    }
    const stopped = await phraseGate(input, u, plan);
    if (stopped !== null)
      return stopped;
    const openAgain = openRefusal(input, plan.storeDir, true);
    if (openAgain !== null) {
      for (const line of openAgain)
        io.err(line);
      io.err("Nothing has changed.");
      return "refused";
    }
  } else if (!input.yes) {
    if (io.prompt === undefined) {
      io.err("refused: this is not an interactive console and nothing was confirmed. Pass --yes if " + "that is what you mean.");
      return "refused";
    }
    const go = await confirm(io, input.park || offers(input) ? "Claude Code will be disconnected. Go ahead?" : "Claude Code will be disconnected — your memory stays exactly where it is. Go ahead?", { default: true, hint: "(Esc or n to stop)" });
    if (!go) {
      io.out(input.park ? "Cancelled. Nothing was moved." : "Cancelled. Nothing was changed.");
      return "ok";
    }
  }
  const wireInput = {
    io,
    env,
    home,
    configPath: input.configPath,
    custom: input.custom,
    store: input.config.dataDir ?? join(configDir, "store"),
    now: input.now,
    yes: true,
    dryRun: false,
    exe: input.exe,
    spawner: input.spawner,
    lister: input.lister,
    heading: true
  };
  u.blank();
  const removed = await unwire(wireInput);
  if (removed.outcome !== "ok") {
    io.err("");
    io.err(moving ? "The wiring could not be removed, so NOTHING WAS MOVED OR DELETED — hooks pointing at " + "a directory that is not there fail at every session start, silently. Fix the above " + "and run this again." : "The wiring could not be removed. Your memory is untouched.");
    return removed.outcome;
  }
  if (moving && !removed.mcpConfirmed) {
    io.err("");
    io.err("refused: the MCP registration is still there and this could not remove it, so NOTHING " + "WAS MOVED OR DELETED. A server pointed at a store that is gone fails at every session " + "start with nothing on screen — which is the same reason the hooks are not left behind " + "either. Run the line above, then run this again.");
    io.err(`The hooks are out; \`${BIN.cli} connect\` puts them back if you want them.`);
    return "refused";
  }
  if (input.record !== undefined)
    input.record.unwired = true;
  u.blank();
  if (plan !== null && input.park)
    return parkPlan(input, u, plan);
  if (plan !== null && input.deleteMemories)
    return deletePlan(input, u, plan);
  u.heading("Your memory");
  const kept = censusOf(configDir, input.config.dataDir ?? null);
  const where = tilde(input.config.dataDir ?? join(configDir, "store"), home);
  u.ok(kept.kind === "memories" ? `${memories(kept.memories)} ${kept.memories === 1 ? "is" : "are"} still at ${where}.` : `everything is still at ${tilde(configDir, home)} (${humanBytes(kept.bytes)}).`);
  if (offers(input))
    return offerDelete(input, u, removed.mcpConfirmed);
  keptHints(input, u);
  return "ok";
}
function offers(input) {
  return !input.park && !input.deleteMemories && !input.yes && input.keepMemories !== true && input.io.prompt !== undefined;
}
function keptHints(input, u) {
  const cli = consoleName(input.env, input.home);
  u.hint("Nothing here deleted anything. To move it aside under a dated name:");
  u.hint(`  ${cli} uninstall --park`);
  u.hint("To destroy it (it prints the whole plan first, then asks you to type a phrase):");
  u.hint(`  ${cli} uninstall --delete-memories`);
  u.blank();
  input.io.out(`To remove the program too: ${removeProgram(input.env)}`);
}
async function phraseGate(input, u, plan) {
  const { io } = input;
  const census = plan.census ?? censusOf(plan.configDir, plan.storeDir);
  u.warning("nothing can bring these back afterwards.", `(${consoleName(input.env, input.home)} uninstall --park sets them aside instead of deleting.)`);
  if (census.kind === "size") {
    u.hint(`The count could not be taken: ${census.why}.`);
  }
  u.blank();
  const said = await typed(io, DELETE_PHRASE, PHRASE_PROMPT);
  if (said === "cancelled") {
    io.out("Cancelled. Nothing was deleted.");
    return "ok";
  }
  if (said !== "typed") {
    io.err(`That was not ${DELETE_PHRASE}. Nothing was deleted.`);
    return "refused";
  }
  return null;
}
async function offerDelete(input, u, mcpConfirmed) {
  const { io, home, env } = input;
  const withheld = (why) => {
    u.blank();
    io.out("Deleting your memory is not offered right now:");
    for (const line of why)
      io.out(`  ${line.replace(/^refused: /, "")}`);
    u.blank();
    keptHints(input, u);
    return "ok";
  };
  if (!mcpConfirmed) {
    return withheld([
      "the memory server is still registered (above), and a server pointed at a store that is " + "gone fails at every session start. Remove it, then run uninstall again."
    ]);
  }
  const planInput = { configPath: input.configPath, config: input.config, home, verb: "delete", env };
  let plan = planUninstall(planInput);
  if (plan.refusal !== null)
    return withheld([plan.refusal]);
  if (plan.targets.length === 0) {
    keptHints(input, u);
    return "ok";
  }
  const open = openRefusal(input, plan.storeDir, true);
  if (open !== null)
    return withheld(open);
  plan = counted(remeasured(plan));
  u.blank();
  for (const line of planLines(plan, "delete", home, null, "If you say yes, this deletes, for good:"))
    io.out(line);
  for (const line of notTouchedLines(notTouched(plan, input.config, home, env), home))
    io.out(line);
  u.blank();
  const yes = await confirm(io, DELETE_QUESTION, { default: false, hint: "(Enter keeps them)" });
  if (!yes) {
    io.out("Kept. Nothing was deleted.");
    u.blank();
    io.out(`To remove the program too: ${removeProgram(env)}`);
    return "ok";
  }
  u.blank();
  const stopped = await phraseGate(input, u, plan);
  if (stopped !== null)
    return stopped;
  const again = planUninstall(planInput);
  const openAgain = openRefusal(input, again.storeDir, true);
  const moved = again.refusal !== null || again.targets.length !== plan.targets.length || again.targets.some((t, i) => t !== plan.targets[i]);
  if (openAgain !== null || moved) {
    for (const line of openAgain ?? [again.refusal ?? "refused: what this would delete changed while you were reading it."]) {
      io.err(line);
    }
    io.err("Nothing was deleted. Run uninstall again to see the plan as it stands now.");
    return "refused";
  }
  u.blank();
  return deletePlan(input, u, { ...again, census: plan.census });
}
export function remeasured(plan) {
  const entries = plan.entries.map((e) => ({ ...e, bytes: dirSize(e.path) }));
  return {
    ...plan,
    entries,
    bytes: entries.reduce((n, e) => n + e.bytes, 0),
    logBytes: plan.storeActed && plan.storeDir !== null ? walBytes(plan.storeDir) : 0
  };
}
function previewSuffix(input, plan) {
  if (!input.park || plan.targets.length === 0)
    return null;
  try {
    return pairedSuffix([...plan.targets], dateOf(input.now));
  } catch {
    return null;
  }
}
function mcpPreflight(input, home) {
  const mcp = readMcp(home, input.env, input.config.dataDir ?? "", input.custom, input.exe);
  if (!mcp.present && !mcp.unreadable)
    return null;
  if (input.io.tty?.stdout === true) {
    input.io.out(CHECKING_CLAUDE_CODE);
    input.io.out("");
  }
  const probe = input.spawner(["mcp", "list"]);
  if (!probe.missing && probe.code === 0)
    return null;
  const why = probe.missing ? "`claude` is not on this PATH" : probe.code === null ? "`claude` did not answer" : `\`claude mcp list\` exited ${String(probe.code)}`;
  return `refused: ${mcp.file} ${mcp.unreadable ? "could not be read, so a registration may still be there" : `still registers "${MCP_SERVER_NAME}"`}, and ${why}, ` + "so it cannot be deregistered — this will not move or delete a store while something may " + "still be registered to open it. Fix that, or run " + `\`claude mcp remove ${MCP_SERVER_NAME} -s user\` yourself first, then run this again.`;
}
function parkPlan(input, u, plan) {
  const { io, home } = input;
  const date = dateOf(input.now);
  const all = [...plan.targets];
  if (all.length === 0) {
    u.heading("Nothing to park");
    u.hint("None of this install's own files is still here.");
    return "ok";
  }
  let suffix;
  try {
    suffix = pairedSuffix(all, date);
  } catch (err) {
    io.err(`refused: ${String(err.message ?? err)}`);
    io.err("Nothing has changed.");
    return "refused";
  }
  const done = [];
  for (const from of all) {
    const to = `${from}${suffix}`;
    try {
      renameSync(from, to);
      done.push({ from, to });
    } catch (err) {
      io.err(`failed to park ${from}: ${String(err.message ?? err)}`);
      io.err(done.length === 0 ? "Nothing was moved. The wiring has been removed; `counterparts connect` puts it back." : "What is listed below HAS moved; nothing else has, and nothing was deleted.");
      for (const d of done)
        io.err(`  ${d.from} -> ${d.to}`);
      return "failed";
    }
  }
  u.heading("Set aside");
  for (const d of done)
    u.ok(`${tilde(d.from, home)}  →  ${tilde(d.to, home)}`);
  if (!plan.storeActed) {
    u.hint("No memory was moved: there was no store at the path the configuration named.");
  }
  if (plan.foreign.length > 0) {
    u.hint(`${tilde(plan.configDir, home)} itself was left where it is, with everything in it that is not ours.`);
  }
  u.blank();
  io.out(`To bring it back later: ${consoleName(input.env, home)} install — it finds this folder and asks.`);
  removeProgramAfterGone(input);
  return "ok";
}
function deletePlan(input, u, plan) {
  const { io, home } = input;
  const gone = [];
  for (const path of plan.targets) {
    try {
      rmSync(path, { recursive: true, force: true });
      gone.push(path);
    } catch (err) {
      io.err(`failed to delete ${path}: ${String(err.message ?? err)}`);
      io.err("What is listed below is gone; nothing else was touched.");
      for (const g of gone)
        io.err(`  ${g}`);
      return "failed";
    }
  }
  u.heading("Deleted");
  for (const path of gone)
    u.ok(tilde(path, home));
  if (plan.storeActed) {
    u.hint(plan.census !== null && plan.census.kind === "memories" ? `${memories(plan.census.memories)} ${plan.census.memories === 1 ? "is" : "are"} gone with it.` : "Your memory went with it.");
  } else {
    u.hint("No memory was deleted: there was no store at the path the configuration named.");
  }
  if (plan.foreign.length > 0) {
    u.hint(`${tilde(plan.configDir, home)} itself is still there, with everything in it that is not ours.`);
  }
  u.hint("Nothing in this package can bring the rest back.");
  u.blank();
  removeProgramAfterGone(input);
  return "ok";
}
export const UNINSTALL_JSON_VERSION = 1;
export async function uninstallJson(input) {
  const { io, home, env } = input;
  const withConfig = ["--config", resolve(input.configPath)];
  const emit = (body) => {
    io.out(JSON.stringify({
      command: "uninstall",
      version: UNINSTALL_JSON_VERSION,
      configPath: resolve(input.configPath),
      ...body
    }));
  };
  if (input.park) {
    emit({ mode: "park", outcome: "refused", why: "--json does not park. Run `uninstall --park` at a terminal." });
    return "refused";
  }
  if (input.deleteMemories) {
    emit({
      mode: "delete",
      outcome: "refused",
      why: "--json does not delete: the phrase has to be typed by the person, at a terminal. Close " + "Claude Code, then run `uninstall` there (terminalArgs in the plan) and answer its question.",
      unwired: false
    });
    return "refused";
  }
  if (input.keepMemories === true) {
    const lines = [];
    const errors = [];
    const quiet = { out: (line) => lines.push(line), err: (line) => errors.push(line) };
    const record = { unwired: false };
    const outcome = await uninstall({ ...input, io: quiet, yes: true, record });
    emit({ mode: "keep", outcome, unwired: record.unwired, lines, errors });
    return outcome;
  }
  const forbidden = forbiddenBaseRefusal(resolve(dirname(input.configPath)));
  if (forbidden !== null) {
    emit({ mode: "plan", outcome: "refused", deletable: false, why: forbidden });
    return "refused";
  }
  let plan = planUninstall({ configPath: input.configPath, config: input.config, home, verb: "delete", env });
  const sighting = look(input.lister);
  const holders = plan.storeDir !== null && existsSync(plan.storeDir) ? readHolders({ storeDir: plan.storeDir, configPath: input.configPath, now: input.now }) : [];
  const open = plan.refusal === null ? openRefusal(input, plan.storeDir, true) : null;
  if (plan.refusal === null)
    plan = counted(plan);
  const why = plan.refusal ?? (open !== null ? open.join(`
`) : plan.targets.length === 0 ? "there is none of ours left here to delete." : null);
  const census = plan.census;
  const kept = notTouched(plan, input.config, home, env);
  emit({
    mode: "plan",
    outcome: "ok",
    deletable: why === null,
    why,
    question: DELETE_QUESTION,
    terminalArgs: ["uninstall", ...withConfig],
    keepArgs: ["uninstall", "--keep-memories", "--json", ...withConfig],
    configDir: plan.configDir,
    storeDir: plan.storeDir,
    memories: census !== null && census.kind === "memories" ? census.memories : null,
    countWhy: census !== null && census.kind === "size" ? census.why : null,
    bytes: plan.bytes,
    deletes: plan.entries.map((e) => ({
      path: e.path,
      kind: e.kind,
      what: e.what,
      bytes: e.bytes,
      directory: e.directory
    })),
    targets: plan.targets,
    wholeDirectory: plan.wholeDirectory,
    foreign: plan.foreign,
    notTouched: kept,
    running: sighting.looked ? sighting.processes.map((p) => ({ pid: p.pid, what: p.what })) : null,
    holders: holders.map((h) => ({ what: h.what, detail: h.detail, refuse: h.refuse })),
    lines: plan.refusal === null ? [
      ...planLines(plan, "delete", home, null, "If you say yes, this deletes, for good:"),
      ...notTouchedLines(kept, home)
    ] : []
  });
  return "ok";
}
