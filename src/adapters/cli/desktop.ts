/**
 * CLAUDE DESKTOP'S CONFIG ENTRY — `counterparts install --host claude-desktop`
 * writes it, `counterparts doctor` reads it (2026-09-30, host groundwork PR B,
 * brief items 7 and 8).
 *
 * Desktop starts its local MCP servers from ONE file,
 * `~/Library/Application Support/Claude/claude_desktop_config.json`, under
 * `mcpServers`. This merges a `counterparts` entry into it and touches nothing
 * else: the file is backed up first, beside itself (`wire.ts#copyToFreeBackup`),
 * every other server's entry is written back as it was, and the file keeps its
 * own indentation and line endings (`wire.ts#sightSettings`, the same reader
 * and refusals `connect` uses on `~/.claude/settings.json`).
 *
 * **The command is the bun-run `counterparts-mcp`, not a `.mcpb` bundle**:
 * Desktop runs bundles under its own Node, and this package is untested on
 * Node. The runtime and the script are ABSOLUTE for the reason `install.ts`
 * gives for the hooks — a host's environment is not the login shell's.
 *
 * **Nothing in the entry says "Desktop".** The server learns who it is talking
 * to from the client's own name at `initialize` (`hosts.ts#hostOfClient`). That
 * matters because Desktop's Code tab ALSO loads this file, and there the
 * client is Claude Code: the same entry must behave exactly as Claude Code's
 * own registration does. A flag saying "desktop" would be false in that tab.
 *
 * **The name clash, and why it is allowed.** In the Code tab a same-name entry
 * from this file wins over `~/.claude.json`'s `counterparts`. Both are written
 * by this package and both name the store the configuration names, so which
 * one wins changes nothing — and doctor says so, and turns amber only if the
 * two point at different stores (`readDesktop`). Measured 2026-10-01: what
 * wins is Desktop's RUNNING server (Desktop mode, shared by its chats), not a
 * Claude Code copy of this entry — so the Code-tab wake names the session id
 * and that server serves a call naming it as the Claude Code session
 * (`mcp/server.ts#claudeCodeSessionNamed`).
 *
 * The home directory is always the caller's (`install`'s `home`, a test's fake
 * one): nothing here reads `os.homedir()`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { CONFIG_ENV } from "../config-path.js";
import { scriptArgs } from "../runtime.js";
import { BIN, desktopConfigPath, hostConfigBase, hostMcpFile, isOurDesktopEntry, MCP_SCRIPT, MCP_SERVER_NAME } from "./install.js";
import { sightSettings, tilde, unparsedSettingsWhy, writeSettings } from "./wire.js";

/** The variable the server reads its store from (`mcp/bin/serve.ts#ENV.dir`). */
const DATA_DIR_VAR = "COUNTERPARTS_DATA_DIR";

/** Where Claude Desktop keeps its MCP servers (macOS) — `install.ts` holds it. */
export { desktopConfigPath };

/**
 * Why Claude Desktop cannot be connected on this platform, or null. The config
 * path above is macOS's, and that is the only one this package knows: there is
 * no Claude Desktop for Linux, and Windows keeps it elsewhere. Asked before
 * `install --host claude-desktop` makes anything, so a Linux run never creates
 * a `~/Library` it has no use for. A Desktop config folder that IS there under
 * `home` is used wherever it is — it is somebody's own, and the file it holds is
 * the one this would write.
 */
export function desktopUnavailable(platform: string = process.platform, home?: string): string | null {
  if (platform === "darwin") return null;
  if (home !== undefined && existsSync(dirname(desktopConfigPath(home)))) return null;
  return platform === "linux"
    ? "Claude Desktop is not available on Linux, so there is nothing to connect. Nothing was changed; `counterparts install` connects Claude Code."
    : `Connecting Claude Desktop is only supported on macOS so far (this is ${platform}). Nothing was changed.`;
}

/** The `mcpServers.counterparts` entry this install writes. */
export interface DesktopEntry {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** The entry for `store`, run by `exe`, with a non-default `configPath` carried in `env`. */
export function desktopEntry(store: string, exe: string, configPath?: string): DesktopEntry {
  return {
    command: exe,
    args: scriptArgs(MCP_SCRIPT, exe),
    env: {
      [DATA_DIR_VAR]: store,
      ...(configPath === undefined || configPath.length === 0 ? {} : { [CONFIG_ENV]: configPath }),
    },
  };
}

export interface DesktopConnect {
  /** `added`: a new entry; `updated`: ours was there and said something else;
   *  `already`: exactly this entry was there, and nothing was written. */
  readonly outcome: "added" | "updated" | "already" | "refused" | "failed";
  readonly path: string;
  /** The backup taken before the write, or null (no file yet, or no write). */
  readonly backup: string | null;
  /** Why it was refused or failed; null otherwise. */
  readonly detail: string | null;
  /** On `updated`: the store the replaced entry named, when it named one. */
  readonly previousStore?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Same entry, key for key — the idempotence test. */
function sameEntry(a: unknown, b: DesktopEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * MERGE OUR ENTRY INTO DESKTOP'S CONFIG. Idempotent: the same entry again
 * writes nothing and takes no backup. A file this cannot read as a JSON object,
 * or whose `mcpServers` is not an object, is refused, never rewritten. Never
 * throws.
 */
export function connectDesktop(input: {
  home: string;
  store: string;
  exe: string;
  configPath?: string;
  now: number;
}): DesktopConnect {
  const path = desktopConfigPath(input.home);
  try {
    const sight = sightSettings(path, input.home);
    if (sight.refusal !== null) return { outcome: "refused", path, backup: null, detail: sight.refusal };
    const servers = sight.value["mcpServers"];
    if (servers !== undefined && !isRecord(servers)) {
      return {
        outcome: "refused",
        path,
        backup: null,
        detail: `refused: "mcpServers" in ${path} is not an object. Nothing was changed; add the entry by hand.`,
      };
    }
    const entry = desktopEntry(input.store, input.exe, input.configPath);
    const prior = servers?.[MCP_SERVER_NAME];
    if (prior !== undefined && sameEntry(prior, entry)) return { outcome: "already", path, backup: null, detail: null };
    const value = { ...sight.value, mcpServers: { ...(servers ?? {}), [MCP_SERVER_NAME]: entry } };
    const wrote = writeSettings(sight, value, input.now);
    if (wrote.error !== null) return { outcome: "failed", path, backup: wrote.backup, detail: wrote.error };
    return prior === undefined
      ? { outcome: "added", path, backup: wrote.backup, detail: null }
      : { outcome: "updated", path, backup: wrote.backup, detail: null, previousStore: dataDirOf(prior) };
  } catch (err) {
    return { outcome: "failed", path, backup: null, detail: String((err as Error).message ?? err) };
  }
}

/** Is a `counterparts` entry in Desktop's file one this package wrote —
 *  `install.ts` holds it, because doctor's `readHost` asks it too. */
export { isOurDesktopEntry };

/** What `connect` did about Claude Desktop's entry (`repairDesktop`). */
export interface DesktopRepair {
  /**
   * `none`: no file, no entry, or an entry that is not ours; `current`: ours,
   * already in the shape this runtime writes; `repaired`: rewritten;
   * `would-repair`: the dry run's answer; `desktop-running`: Desktop is open
   * (or could not be ruled out), so the file was left as it was; `refused` /
   * `failed`: the file could not be read or written.
   */
  readonly outcome: "none" | "current" | "repaired" | "would-repair" | "desktop-running" | "refused" | "failed";
  readonly path: string;
  readonly backup: string | null;
  readonly detail: string | null;
  /** True when "running" means "could not look", not "seen running". */
  readonly unknownRunning?: boolean;
}

/**
 * REWRITE OUR DESKTOP ENTRY IN TODAY'S SHAPE (2026-10-10) — what `connect`
 * does for Claude Desktop after the hooks and Claude Code's registration.
 *
 * Only the command and its arguments change: the runtime `connect` runs under
 * and `scriptArgs`' shape for it (`--no-env-file --config=<empty bunfig> run
 * <serve.ts>` under Bun), the same repair the hooks get. Its `env` — the store
 * and the configuration it names — and every other key stay as they were:
 * a Desktop pointed at a different store is doctor's question
 * (`desktopFindings`) and `install --host claude-desktop`'s answer, never a
 * side effect of this.
 *
 * **NEVER WHILE DESKTOP RUNS.** Desktop rewrites this file while it is open,
 * so a write under it can be overwritten (measured as advice since
 * 2026-09-30: "Quit Claude Desktop BEFORE you run it"), and the server it
 * already started keeps its old command until Desktop restarts anyway. Seen
 * running — or not known, because the process list could not be read — is
 * `desktop-running`: nothing written, and the caller says to quit Desktop and
 * run `connect` again. Never throws.
 */
export function repairDesktop(input: {
  home: string;
  exe: string;
  /** From the process look (`wire.ts#ProcessSighting.desktopRunning`); null: could not look. */
  desktopRunning: boolean | null;
  dryRun: boolean;
  now: number;
}): DesktopRepair {
  const path = desktopConfigPath(input.home);
  try {
    const read = readObject(path);
    if (read.state === "absent") return { outcome: "none", path, backup: null, detail: null };
    // A FILE THAT DOES NOT PARSE IS SAID, NOT PASSED OVER (review of #354):
    // whether it holds an entry of ours cannot be told, so it is never written,
    // and the person hears why the Desktop half did nothing. An empty file is
    // not a broken one (`sightSettings`): nothing in it, nothing of ours.
    if (read.state === "unreadable") {
      const sight = sightSettings(path, input.home);
      if (sight.refusal === null) return { outcome: "none", path, backup: null, detail: null };
      return { outcome: "refused", path, backup: null, detail: unreadableWhy(path, input.home) };
    }
    const servers = read.value["mcpServers"];
    const prior = isRecord(servers) ? servers[MCP_SERVER_NAME] : undefined;
    if (!isOurDesktopEntry(prior)) return { outcome: "none", path, backup: null, detail: null };
    const want = { ...prior, command: input.exe, args: scriptArgs(MCP_SCRIPT, input.exe) };
    if (JSON.stringify(want) === JSON.stringify(prior)) return { outcome: "current", path, backup: null, detail: null };
    if (input.desktopRunning !== false) {
      return { outcome: "desktop-running", path, backup: null, detail: null, unknownRunning: input.desktopRunning === null };
    }
    if (input.dryRun) return { outcome: "would-repair", path, backup: null, detail: null };
    const sight = sightSettings(path, input.home);
    if (sight.refusal !== null) return { outcome: "refused", path, backup: null, detail: sight.refusal };
    const value = { ...sight.value, mcpServers: { ...(servers as Record<string, unknown>), [MCP_SERVER_NAME]: want } };
    const wrote = writeSettings(sight, value, input.now);
    if (wrote.error !== null) return { outcome: "failed", path, backup: wrote.backup, detail: wrote.error };
    return { outcome: "repaired", path, backup: wrote.backup, detail: null };
  } catch (err) {
    return { outcome: "failed", path, backup: null, detail: String((err as Error).message ?? err) };
  }
}

/**
 * Why `connect` left an unreadable Desktop file alone, in words a person can
 * act on: `wire.ts#unparsedSettingsWhy`'s for the shapes a hand-edited file
 * takes (comments, a trailing comma, a byte-order mark), else the parser's.
 */
function unreadableWhy(path: string, home: string): string {
  const where = tilde(path, home);
  const unsure = "connect cannot tell whether it holds a counterparts entry, so nothing in it was changed";
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return `${where} could not be read (${String((err as Error).message ?? err)}): ${unsure}.`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const why = unparsedSettingsWhy(raw);
    if (why !== null) return `${where} ${why}. Until then ${unsure}.`;
    return `${where} does not parse as JSON (${String((err as Error).message ?? err)}): ${unsure}. If you connected Claude Desktop, fix the file and run \`${BIN.cli} connect\` again.`;
  }
  return `${where} parses, but ${Array.isArray(parsed) ? "as an array" : `as a ${typeof parsed}`} rather than an object: ${unsure}.`;
}

/** What doctor reads about Claude Desktop (`claude-code/doctor.ts#DesktopReading`). */
export interface DesktopConfigReading {
  readonly path: string;
  /** `absent`: no config file; `no-entry`: a file with no `counterparts`;
   *  `entry`: ours is there; `unreadable`: a file that is not a JSON object. */
  readonly state: "absent" | "no-entry" | "entry" | "unreadable";
  /** The store the Desktop entry names (`COUNTERPARTS_DATA_DIR`), or null. */
  readonly dataDir: string | null;
  /** Whether Claude Code's own registration (`~/.claude.json`) names `counterparts` too. */
  readonly codeTab: boolean;
  /** The store Claude Code's registration names, or null. */
  readonly codeDataDir: string | null;
}

function readObject(path: string): { state: "absent" | "unreadable" | "read"; value: Record<string, unknown> } {
  if (!existsSync(path)) return { state: "absent", value: {} };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? { state: "read", value: parsed } : { state: "unreadable", value: {} };
  } catch {
    return { state: "unreadable", value: {} };
  }
}

function dataDirOf(entry: unknown): string | null {
  if (!isRecord(entry)) return null;
  const env = entry["env"];
  if (!isRecord(env)) return null;
  const dir = env[DATA_DIR_VAR];
  return typeof dir === "string" && dir.length > 0 ? dir : null;
}

/**
 * READ DESKTOP'S CONFIG FOR DOCTOR — two small file reads, never a write:
 * Desktop's own file, and Claude Code's `~/.claude.json` for the name clash.
 */
export function readDesktop(home: string, env: Record<string, string | undefined> = {}): DesktopConfigReading {
  const path = desktopConfigPath(home);
  const read = readObject(path);
  const servers = read.value["mcpServers"];
  const ours = isRecord(servers) ? servers[MCP_SERVER_NAME] : undefined;
  const code = readObject(hostMcpFile(hostConfigBase(home, env)));
  const codeServers = code.value["mcpServers"];
  const codeOurs = isRecord(codeServers) ? codeServers[MCP_SERVER_NAME] : undefined;
  return {
    path,
    state: read.state === "absent" ? "absent" : read.state === "unreadable" ? "unreadable" : ours === undefined ? "no-entry" : "entry",
    dataDir: dataDirOf(ours),
    codeTab: codeOurs !== undefined,
    codeDataDir: dataDirOf(codeOurs),
  };
}
