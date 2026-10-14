export const DEFAULT_HOST = "claude-code";
export function isHostName(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,47}$/.test(value);
}
export const DESKTOP_HOST = "claude-desktop";
export const DESKTOP_ALWAYS_ALLOW = "In Claude Desktop, set the counterparts tools to Always allow, or a chat cannot wake on its own: Desktop asks before each tool, and until it may, the model does not call a tool nobody asked for.";
export const DESKTOP_SCOPE = "claude-desktop:";
export const CODE_TAB_ENTRYPOINT = "claude-desktop";
export function isPseudoScope(scope) {
  return /^[a-z][a-z0-9._-]+:[^/\\]*$/.test(scope);
}
export const CLAUDE_CODE_ENV_MARKERS = ["CLAUDE_PROJECT_DIR", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];
export function claudeCodeEnvMarker(env) {
  for (const name of CLAUDE_CODE_ENV_MARKERS) {
    const value = env[name];
    if (typeof value === "string" && value.length > 0)
      return name;
  }
  return null;
}
export function hostOfClient(clientName) {
  if (typeof clientName !== "string")
    return null;
  if (clientName === "claude-ai" || clientName.startsWith("local-agent-mode-"))
    return DESKTOP_HOST;
  return null;
}
export function isDesktopScratchWorkspace(dir) {
  return /\/Library\/Application Support\/Claude\/scratch-workspaces(\/|$)/.test(dir);
}
export const HOST_WORDING = {
  [DEFAULT_HOST]: {
    reconnect: "Run /mcp and Reconnect to load it.",
    reconnectFirst: "Run /mcp and Reconnect",
    scopeOff: "This directory is no longer recorded or read. The hooks will produce nothing here and every other tool will refuse until it is turned back on — including in a new session, which is the point.",
    scopeOn: "Recorded. This takes effect for the tools immediately, and for the hooks at their next boundary in this session. Nothing said before now is recorded — the conversation that happened while this directory was off or paused is passed over, not collected — and remembering starts from here.",
    offRefusal: (at) => at.inherited === null ? `Counterparts is off for this directory (${at.here}). Nothing is recorded or read here — call \`scope\` with mode \`on\`, or run \`${at.hereCommand("--on")}\`.` : `Counterparts is off for ${at.inherited}, which includes this directory (${at.here}). Nothing is recorded or read here — call \`scope\` with mode \`on\`, or run \`${at.hereCommand("--on")}\`, to turn it on here alone; \`${at.entryCommand("--on")}\` turns all of ${at.inherited} back on.`,
    pausedRefusal: (at) => at.inherited === null ? `Counterparts is paused for this directory (${at.here}). Nothing is recorded or read here until it is resumed — call \`scope\` with mode \`resume\`, or run \`${at.entryCommand("--resume")}\`.` : `Counterparts is paused for ${at.inherited}, which includes this directory (${at.here}). Nothing is recorded or read here until it is resumed — run \`${at.entryCommand("--resume")}\`. The \`scope\` tool sets only this directory: mode \`resume\` refuses here, and mode \`on\` turns this directory on alone while ${at.inherited} stays paused.`
  },
  [DESKTOP_HOST]: {
    reconnect: "Quit and reopen Claude Desktop to load it.",
    reconnectFirst: "Quit and reopen Claude Desktop",
    scopeOff: "Claude Desktop's chats are no longer recorded or read. Every other tool will refuse until it is turned back on — including in a new chat, which is the point.",
    scopeOn: "Recorded. This takes effect immediately, for every tool in every Claude Desktop chat. Nothing is collected from before now: Desktop chat keeps no transcript here, so only what is written through the tools is remembered.",
    offRefusal: (at) => `Counterparts is off for Claude Desktop's chats. Nothing is recorded or read here — call \`scope\` with mode \`on\`, or run \`${at.hereCommand("--on")}\`.`,
    pausedRefusal: (at) => `Counterparts is paused for Claude Desktop's chats. Nothing is recorded or read here until it is resumed — call \`scope\` with mode \`resume\`, or run \`${at.entryCommand("--resume")}\`.`
  }
};
export function wordingFor(host = DEFAULT_HOST) {
  return HOST_WORDING[host] ?? HOST_WORDING[DEFAULT_HOST];
}
export function upgradeWords(hosts) {
  const code = hosts.has(DEFAULT_HOST);
  const desk = hosts.has(DESKTOP_HOST);
  if (desk && !code) {
    return { who: "Claude Desktop's memory server", open: "open Claude Desktop, or start a new chat in it if it is already open" };
  }
  if (code && !desk)
    return { who: "the next Claude Code session", open: "start a Claude Code session" };
  return {
    who: "the next session, in Claude Code or Claude Desktop,",
    open: "start a Claude Code session or open Claude Desktop"
  };
}
