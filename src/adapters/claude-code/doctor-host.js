import { localStamp } from "../../core/time.js";
import { Store } from "../../core/store/index.js";
import { CLI_SCRIPT, NODE_HOOKS } from "../runtime.js";
import { DESKTOP_WAKE_KEY, hostOf, listSessions, sameScope } from "../sessions.js";
import { DESKTOP_HOST } from "../hosts.js";
import { finding } from "./doctor-finding.js";
function useLabel(use) {
  return use === "desktop" ? "Claude Desktop server" : use;
}
function byUse(a, b) {
  return Number(a === "desktop") - Number(b === "desktop") || a.localeCompare(b);
}
export function runtimeFindings(reading) {
  const rows = reading.runtimes ?? [];
  if (rows.length === 0)
    return [];
  const said = rows.map((r) => `${r.used.map(useLabel).join(" and ")} ${r.kind === "binary" ? "run as the single binary" : `run under ${r.kind}`} (${r.exe})`).join("; ");
  const quitDesktop = (uses) => uses.includes("desktop") ? "Quit Claude Desktop first (it rewrites its config file while it runs). " : "";
  const reopenDesktop = (uses) => uses.includes("desktop") ? " and reopen Claude Desktop" : "";
  const console_ = reading.consoleRuntime === undefined ? "" : `; this console is ${reading.consoleRuntime}`;
  const data = {
    runtimes: rows.map((r) => `${r.kind}:${r.exe}:${r.present ? "present" : "missing"}`).join(","),
    console: reading.consoleRuntime ?? null
  };
  const missing = rows.filter((r) => !r.present);
  const readsEnv = rows.flatMap((r) => r.projectEnv ?? []);
  data["projectEnv"] = readsEnv.length === 0 ? "ignored" : [...new Set(readsEnv)].sort().join(",");
  if (missing.length === 0 && readsEnv.length > 0) {
    const what = [...new Set(readsEnv)].sort(byUse).map(useLabel).join(" and ");
    return [
      finding("runtime", "amber", "Runtime", `${said}${console_}; the ${what} ${what.includes(" and ") ? "were" : "was"} wired before Counterparts told Bun to skip a project's .env and bunfig.toml, so a project whose .env sets COUNTERPARTS_DATA_DIR or COUNTERPARTS_CONFIG could point them at another memory, and its bunfig.toml could run its own code inside them`, `${quitDesktop(readsEnv)}Run: counterparts connect — it rewrites the commands with --no-env-file and an empty --config${readsEnv.includes("desktop") ? ", Claude Desktop's entry included" : ""}. Then restart Claude Code${reopenDesktop(readsEnv)}.`, data)
    ];
  }
  if (missing.length === 0)
    return [finding("runtime", "green", "Runtime", `${said}${console_}`, "", data)];
  return [
    finding("runtime", "amber", "Runtime", `${missing.map((r) => r.exe).join(", ")} ${missing.length === 1 ? "is" : "are"} not there, so nothing that runs under ${missing.length === 1 ? "it" : "them"} fires; ${said}${console_}`, `${quitDesktop(missing.flatMap((r) => r.used))}Run: counterparts connect — it rewrites them with the runtime it runs under (bun when bun is on PATH, else Node). To wire Node with bun also installed: node --import "${NODE_HOOKS}" "${CLI_SCRIPT}" connect. Then restart Claude Code${reopenDesktop(missing.flatMap((r) => r.used))}.`, data)
  ];
}
export function desktopFindings(reading, store, dir) {
  if (reading.state === "absent" || reading.state === "no-entry")
    return [];
  const data = {
    path: reading.path,
    state: reading.state,
    dataDir: reading.dataDir,
    codeTab: reading.codeTab,
    codeDataDir: reading.codeDataDir
  };
  if (reading.state === "unreadable") {
    return [
      finding("desktop", "green", "Claude Desktop", `${reading.path} could not be read as JSON, so whether Counterparts is connected there is not known`, "", data)
    ];
  }
  const same = (a, b) => a === null || b === null || sameScope(a, b);
  const fix = "Run: counterparts install --host claude-desktop — then quit and reopen Claude Desktop.";
  if (!same(reading.dataDir, dir)) {
    return [
      finding("desktop", "amber", "Claude Desktop", `connected, but its entry names a different store (${reading.dataDir ?? "?"}) from this one (${dir})`, fix, data)
    ];
  }
  if (reading.codeTab && !same(reading.dataDir, reading.codeDataDir)) {
    return [
      finding("desktop", "amber", "Claude Desktop", `Desktop's Code tab gets its counterparts tools from Desktop's entry, which shadows ~/.claude.json's, and the two name different stores (${reading.dataDir ?? "?"} and ${reading.codeDataDir ?? "?"})`, fix, data)
    ];
  }
  const zone = store?.zone() ?? "UTC";
  let lastWake = null;
  try {
    const raw = store?.getMeta(DESKTOP_WAKE_KEY);
    lastWake = raw === undefined || raw === null || !Number.isFinite(Number(raw)) ? null : Number(raw);
  } catch {
    lastWake = null;
  }
  const desktop = listSessions(dir).filter((r) => hostOf(r) === DESKTOP_HOST);
  const lastSession = desktop[0]?.lastBoundaryAt ?? null;
  data["lastWake"] = lastWake;
  data["lastSession"] = lastSession;
  data["sessions"] = desktop.length;
  const parts = [
    `connected (${reading.path.split("/").pop() ?? reading.path})`,
    lastWake === null ? "no wake yet" : `last wake ${localStamp(lastWake, zone)}`,
    ...lastSession === null ? [] : [`last session active ${localStamp(lastSession, zone)}`],
    ...desktop.length === 0 ? [] : [`${String(desktop.length)} Desktop ${desktop.length === 1 ? "session" : "sessions"} this week, not measured for write-ups (Desktop chat keeps no transcript)`],
    ...reading.codeTab ? ["its Code tab's counterparts tools come from this entry's server, which shadows ~/.claude.json's — both name this store, and Code-tab sessions pass their session id"] : []
  ];
  parts.push("set its counterparts tools to Always allow, or a chat cannot wake on its own (not measurable from here)");
  return [finding("desktop", "green", "Claude Desktop", parts.join("; "), "", data)];
}
export function hostFindings(reading) {
  const total = reading.expected.length;
  const missing = reading.expected.filter((e) => !reading.events.includes(e));
  const stale = reading.stale;
  const where = [
    reading.settingsRead.length === 0 ? "no host settings file was readable" : `read ${reading.settingsRead.join(", ")}`,
    reading.settingsUnreadable.length === 0 ? "" : `could not read ${reading.settingsUnreadable.join(", ")}`
  ].filter((s) => s.length > 0).join("; ");
  const data = {
    events: reading.events.join(","),
    missing: missing.join(","),
    stale: stale.map((s) => `${s.event}→${s.path}`).join(","),
    settingsRead: reading.settingsRead.join(","),
    settingsUnreadable: reading.settingsUnreadable.join(","),
    mcp: reading.mcp,
    mcpFile: reading.mcpFile
  };
  const plugin = reading.plugin !== undefined && reading.plugin !== null && reading.plugin.enabled ? reading.plugin : null;
  data["plugin"] = plugin === null ? null : plugin.id;
  const npmAny = reading.events.length > 0 || reading.mcp;
  if (plugin !== null && !npmAny) {
    return [
      finding("host", "green", "Claude Code", `connected as the Claude Code plugin (${plugin.id}${plugin.version === null ? "" : ` ${plugin.version}`}): its ${String(total)} hooks and the memory tools load from the plugin`, "", data)
    ];
  }
  const twiceClause = plugin === null ? "" : `ALSO installed as the Claude Code plugin (${plugin.id}), which stands down while this wiring is live`;
  const twiceFix = plugin === null ? "" : `Installed twice: to keep only the plugin, run \`counterparts disconnect\` and restart Claude Code; to keep only this install, run \`claude plugin uninstall ${plugin.id}\`. Same memory either way.`;
  const mcpClause = reading.mcp ? `the MCP server is registered in ${reading.mcpFile}` : reading.mcpUnreadable ? `${reading.mcpFile} could not be read, so the MCP registration could not be checked` : `no MCP server named "${reading.mcpName}" in ${reading.mcpFile}`;
  if (missing.length === 0 && stale.length === 0 && reading.mcp) {
    if (plugin !== null) {
      return [finding("host", "amber", "Claude Code", `connected: ${String(total)} hooks and the memory tools; ${twiceClause}`, twiceFix, data)];
    }
    return [
      finding("host", "green", "Claude Code", `connected: ${String(total)} hooks and the memory tools`, "", data)
    ];
  }
  const does = [];
  if (missing.length > 0)
    does.push("adds the hooks beside anything already there");
  if (stale.length > 0) {
    does.push(`replaces the ${stale.length === 1 ? "stale entry" : "stale entries"} with the path this install actually has`);
  }
  const cannotRegister = !reading.mcp && !reading.mcpUnreadable && reading.claudeOnPath === false && reading.mcpAddLine !== undefined;
  if (!reading.mcp && !reading.mcpUnreadable && !cannotRegister)
    does.push("registers the memory tools");
  const byHand = cannotRegister ? `\`claude\` is not on this PATH, so \`counterparts connect\` cannot register the memory tools: run this where \`claude\` works — ${reading.mcpAddLine ?? ""} — then restart Claude Code.` : "";
  const fixes = [
    ...does.length === 0 ? [] : [
      `Run: counterparts connect — it backs up ~/.claude/settings.json, ${does.length === 1 ? does[0] : `${does.slice(0, -1).join(", ")} and ${does[does.length - 1] ?? ""}`}.${cannotRegister ? "" : " Then restart Claude Code."}`
    ],
    ...byHand.length === 0 ? [] : [byHand]
  ];
  const staleClause = stale.length === 0 ? "" : `${stale.map((s) => s.event).join(", ")} point${stale.length === 1 ? "s" : ""} at ${stale.map((s) => s.path).join(", ")}, which is not there`;
  const connected = missing.length === total ? `no hook of ours is connected on any of the ${String(total)} events` : missing.length > 0 ? `connected on ${reading.events.join(", ")} but NOT on ${missing.join(", ")}` : `all ${String(total)} hook events are connected`;
  const detail = [staleClause, connected, `(${where})`, mcpClause, twiceClause].filter((s) => s.length > 0).join("; ").replace("; (", " (");
  return [finding("host", "amber", "Claude Code", detail, [...fixes, ...twiceFix.length === 0 ? [] : [twiceFix]].join(" "), data)];
}
