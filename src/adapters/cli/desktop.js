import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_ENV } from "../config-path.js";
import { readsHostUserConfig, scriptArgs } from "../runtime.js";
import { BIN, desktopConfigPath, hostConfigBase, hostMcpFile, isOurDesktopEntry, MCP_SCRIPT, MCP_SERVER_NAME } from "./install.js";
import { sightSettings, tilde, unparsedSettingsWhy, writeSettings } from "./wire.js";
const DATA_DIR_VAR = "COUNTERPARTS_DATA_DIR";

export { desktopConfigPath };
export function desktopUnavailable(platform = process.platform, home) {
  if (platform === "darwin")
    return null;
  if (home !== undefined && existsSync(dirname(desktopConfigPath(home))))
    return null;
  return platform === "linux" ? "Claude Desktop is not available on Linux, so there is nothing to connect. Nothing was changed; `counterparts install` connects Claude Code." : `Connecting Claude Desktop is only supported on macOS so far (this is ${platform}). Nothing was changed.`;
}
export function desktopEntry(store, exe, configPath) {
  return {
    command: exe,
    args: scriptArgs(MCP_SCRIPT, exe),
    env: {
      [DATA_DIR_VAR]: store,
      ...configPath === undefined || configPath.length === 0 ? {} : { [CONFIG_ENV]: configPath }
    }
  };
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function sameEntry(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function connectDesktop(input) {
  const path = desktopConfigPath(input.home);
  try {
    const sight = sightSettings(path, input.home);
    if (sight.refusal !== null)
      return { outcome: "refused", path, backup: null, detail: sight.refusal };
    const servers = sight.value["mcpServers"];
    if (servers !== undefined && !isRecord(servers)) {
      return {
        outcome: "refused",
        path,
        backup: null,
        detail: `refused: "mcpServers" in ${path} is not an object. Nothing was changed; add the entry by hand.`
      };
    }
    const entry = desktopEntry(input.store, input.exe, input.configPath);
    const prior = servers?.[MCP_SERVER_NAME];
    if (prior !== undefined && sameEntry(prior, entry))
      return { outcome: "already", path, backup: null, detail: null };
    const value = { ...sight.value, mcpServers: { ...servers ?? {}, [MCP_SERVER_NAME]: entry } };
    const wrote = writeSettings(sight, value, input.now);
    if (wrote.error !== null)
      return { outcome: "failed", path, backup: wrote.backup, detail: wrote.error };
    return prior === undefined ? { outcome: "added", path, backup: wrote.backup, detail: null } : { outcome: "updated", path, backup: wrote.backup, detail: null, previousStore: dataDirOf(prior) };
  } catch (err) {
    return { outcome: "failed", path, backup: null, detail: String(err.message ?? err) };
  }
}

export { isOurDesktopEntry };
export function repairDesktop(input) {
  const path = desktopConfigPath(input.home);
  try {
    const read = readObject(path);
    if (read.state === "absent")
      return { outcome: "none", path, backup: null, detail: null };
    if (read.state === "unreadable") {
      const sight = sightSettings(path, input.home);
      if (sight.refusal === null)
        return { outcome: "none", path, backup: null, detail: null };
      return { outcome: "refused", path, backup: null, detail: unreadableWhy(path, input.home) };
    }
    const servers = read.value["mcpServers"];
    const prior = isRecord(servers) ? servers[MCP_SERVER_NAME] : undefined;
    if (!isOurDesktopEntry(prior))
      return { outcome: "none", path, backup: null, detail: null };
    const want = { ...prior, command: input.exe, args: scriptArgs(MCP_SCRIPT, input.exe) };
    if (JSON.stringify(want) === JSON.stringify(prior))
      return { outcome: "current", path, backup: null, detail: null };
    if (input.desktopRunning !== false) {
      return { outcome: "desktop-running", path, backup: null, detail: null, unknownRunning: input.desktopRunning === null };
    }
    if (input.dryRun)
      return { outcome: "would-repair", path, backup: null, detail: null };
    const sight = sightSettings(path, input.home);
    if (sight.refusal !== null)
      return { outcome: "refused", path, backup: null, detail: sight.refusal };
    const value = { ...sight.value, mcpServers: { ...servers, [MCP_SERVER_NAME]: want } };
    const wrote = writeSettings(sight, value, input.now);
    if (wrote.error !== null)
      return { outcome: "failed", path, backup: wrote.backup, detail: wrote.error };
    return { outcome: "repaired", path, backup: wrote.backup, detail: null };
  } catch (err) {
    return { outcome: "failed", path, backup: null, detail: String(err.message ?? err) };
  }
}
function unreadableWhy(path, home) {
  const where = tilde(path, home);
  const unsure = "connect cannot tell whether it holds a counterparts entry, so nothing in it was changed";
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return `${where} could not be read (${String(err.message ?? err)}): ${unsure}.`;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const why = unparsedSettingsWhy(raw);
    if (why !== null)
      return `${where} ${why}. Until then ${unsure}.`;
    return `${where} does not parse as JSON (${String(err.message ?? err)}): ${unsure}. If you connected Claude Desktop, fix the file and run \`${BIN.cli} connect\` again.`;
  }
  return `${where} parses, but ${Array.isArray(parsed) ? "as an array" : `as a ${typeof parsed}`} rather than an object: ${unsure}.`;
}
function readObject(path) {
  if (!existsSync(path))
    return { state: "absent", value: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? { state: "read", value: parsed } : { state: "unreadable", value: {} };
  } catch {
    return { state: "unreadable", value: {} };
  }
}
function dataDirOf(entry) {
  if (!isRecord(entry))
    return null;
  const env = entry["env"];
  if (!isRecord(env))
    return null;
  const dir = env[DATA_DIR_VAR];
  return typeof dir === "string" && dir.length > 0 ? dir : null;
}
export function readDesktop(home, env = {}, readsUserConfig = readsHostUserConfig()) {
  const path = desktopConfigPath(home);
  const read = readObject(path);
  const servers = read.value["mcpServers"];
  const ours = isRecord(servers) ? servers[MCP_SERVER_NAME] : undefined;
  const codeServers = readsUserConfig ? readObject(hostMcpFile(hostConfigBase(home, env))).value["mcpServers"] : undefined;
  const codeOurs = isRecord(codeServers) ? codeServers[MCP_SERVER_NAME] : undefined;
  return {
    path,
    state: read.state === "absent" ? "absent" : read.state === "unreadable" ? "unreadable" : ours === undefined ? "no-entry" : "entry",
    dataDir: dataDirOf(ours),
    codeTab: codeOurs !== undefined,
    codeDataDir: dataDirOf(codeOurs)
  };
}
