/** `doctor`'s findings on the host — the runtime it runs on, Claude Desktop, and how the host is wired (moved out of `doctor.ts`, 2026-10-11). */
import { localStamp } from "../../core/time.js";
import { Store } from "../../core/store/index.js";
import { CLI_SCRIPT, NODE_HOOKS } from "../runtime.js";
import { DESKTOP_WAKE_KEY, hostOf, listSessions, sameScope } from "../sessions.js";
import { DESKTOP_HOST } from "../hosts.js";
import type { PluginInstallRead } from "../host-wiring.js";
import { finding } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

// ── the two steps the user does BY HAND ─────────────────────────────

/**
 * DID THE HOOKS BLOCK AND THE MCP REGISTRATION ACTUALLY TAKE (finding 4).
 *
 * `install` prints those two and applies neither, correctly: they edit somebody
 * else's editor configuration. But nothing then checked them, so a user who
 * pasted the block into a project settings file instead of the user one — or
 * never restarted — got a fully green `doctor` and total silence. The failure
 * mode of this product is silence, which is the one thing a diagnostic exists
 * to break.
 *
 * **THE READ IS THE CALLER'S** (`cli/install.ts#readHost`), for the reason
 * `checkout` and `open` are: it is four small file reads outside this store, in
 * a format that belongs to the host, and the adapters here are leaves that do
 * not import each other. What comes in carries the host's own vocabulary —
 * which events were expected, what the server is called — so this file grades
 * and keeps nothing it would have to hold in step.
 *
 * AMBER, NEVER RED, and it always says which files it read: `~/.claude.json` is
 * the host's own state file, documented as one the host writes for itself, so a
 * negative answer here is "I looked at these and did not find it", never "you
 * did not install it".
 */
export interface HostReading {
  /** The events a full install covers, in the host's spelling. */
  readonly expected: readonly string[];
  /** Which of `expected` carry a command that looks like ours. */
  readonly events: readonly string[];
  /** Events whose command names a path that is not on disk — installed, and
   *  failing silently at every session start. */
  readonly stale: readonly { event: string; path: string }[];
  /** Every settings file this read actually opened and parsed. */
  readonly settingsRead: readonly string[];
  /** Files that exist and could not be opened or parsed — not the same fact as
   *  "there is no such file", and not something to stay quiet about. */
  readonly settingsUnreadable: readonly string[];
  /** True when the MCP server is registered at user scope. */
  readonly mcp: boolean;
  readonly mcpName: string;
  readonly mcpFile: string;
  /** The MCP file exists but could not be read or parsed. */
  readonly mcpUnreadable: boolean;
  /**
   * Whether a `claude` executable is on the PATH the caller would run
   * `counterparts connect` with (the go-public Phase C walk, 2026-09-23).
   * `false` only when a PATH was there to search and held none; absent or null
   * is "not looked", and the fix line stays `counterparts connect`.
   */
  readonly claudeOnPath?: boolean | null;
  /** The exact `claude mcp add …` line `connect` prints when it cannot run it. */
  readonly mcpAddLine?: string;
  /** The runtimes the hooks and the MCP registration launch us with
   *  (`cli/install.ts#readHost`); absent when not read. */
  readonly runtimes?: readonly {
    readonly exe: string;
    /** `binary`: the single compiled binary (`runtime.ts#Binary`). */
    readonly kind: "bun" | "node" | "binary";
    readonly present: boolean;
    readonly used: readonly string[];
    /** Of `used`, the commands that let Bun read the project's `.env` or
     *  `bunfig.toml` (wired before `--no-env-file` and an empty `--config=`);
     *  absent on a reading that predates the field. */
    readonly projectEnv?: readonly string[];
  }[];
  /** The runtime this console is running under (`runtime.ts#runtimeLabel`). */
  readonly consoleRuntime?: string;
  /** The Counterparts Claude Code plugin, when Claude Code records it
   *  installed (`host-wiring.ts#pluginInstall`); absent or null when not. */
  readonly plugin?: PluginInstallRead | null;
}

/** How a Runtime row names where a command was wired: `desktop` is Claude
 *  Desktop's `counterparts` entry (`cli/install.ts#readHost`, 2026-10-10).
 *  It is read after "the" ("the Claude Desktop server was wired…"), so no
 *  possessive (review of #354). */
function useLabel(use: string): string {
  return use === "desktop" ? "Claude Desktop server" : use;
}

/** Claude Code's hooks and registration first, Claude Desktop's entry last. */
function byUse(a: string, b: string): number {
  return Number(a === "desktop") - Number(b === "desktop") || a.localeCompare(b);
}

/**
 * WHICH RUNTIME the host starts us with (2026-10-01, Node support): Bun or
 * Node, read off the commands `install` wrote, and whether that executable is
 * still there. A runtime that has gone — a removed Node version manager entry,
 * a Bun moved — fails every hook silently, exactly like a stale script path,
 * and is graded the same: amber, with `connect` (run under the runtime you
 * want) as the fix, since it rewrites the commands with the runtime running it.
 * Quiet when nothing of ours is configured: the Claude Code line says that.
 */
export function runtimeFindings(reading: HostReading): Finding[] {
  const rows = reading.runtimes ?? [];
  if (rows.length === 0) return [];
  const said = rows
    .map((r) => `${r.used.map(useLabel).join(" and ")} ${r.kind === "binary" ? "run as the single binary" : `run under ${r.kind}`} (${r.exe})`)
    .join("; ");
  // CLAUDE DESKTOP rewrites its own config file while it is open, so `connect`
  // leaves Desktop's entry alone until it is quit (`cli/desktop.ts#repairDesktop`):
  // any fix that has to reach that entry says so first.
  const quitDesktop = (uses: readonly string[]): string =>
    uses.includes("desktop") ? "Quit Claude Desktop first (it rewrites its config file while it runs). " : "";
  const reopenDesktop = (uses: readonly string[]): string => (uses.includes("desktop") ? " and reopen Claude Desktop" : "");
  const console_ = reading.consoleRuntime === undefined ? "" : `; this console is ${reading.consoleRuntime}`;
  const data: Record<string, string | number | boolean | null> = {
    runtimes: rows.map((r) => `${r.kind}:${r.exe}:${r.present ? "present" : "missing"}`).join(","),
    console: reading.consoleRuntime ?? null,
  };
  const missing = rows.filter((r) => !r.present);
  // WIRED BEFORE `--no-env-file` AND `--config=<empty-bunfig.toml>`
  // (2026-10-09): Bun loads the project's `.env` into every hook and server it
  // starts there, so a project could name another store, and runs its
  // `bunfig.toml` preload inside them. A command missing EITHER flag counts,
  // so one `connect` closes both. Amber, because it is a hole and not a fault:
  // everything still runs, and `connect` rewrites the commands (it repairs an
  // entry that is ours in an older shape).
  const readsEnv = rows.flatMap((r) => r.projectEnv ?? []);
  data["projectEnv"] = readsEnv.length === 0 ? "ignored" : [...new Set(readsEnv)].sort().join(",");
  if (missing.length === 0 && readsEnv.length > 0) {
    const what = [...new Set(readsEnv)].sort(byUse).map(useLabel).join(" and ");
    return [
      finding(
        "runtime",
        "amber",
        "Runtime",
        `${said}${console_}; the ${what} ${what.includes(" and ") ? "were" : "was"} wired before Counterparts told Bun to skip a project's .env and bunfig.toml, so a project whose .env sets COUNTERPARTS_DATA_DIR or COUNTERPARTS_CONFIG could point them at another memory, and its bunfig.toml could run its own code inside them`,
        `${quitDesktop(readsEnv)}Run: counterparts connect — it rewrites the commands with --no-env-file and an empty --config${readsEnv.includes("desktop") ? ", Claude Desktop's entry included" : ""}. Then restart Claude Code${reopenDesktop(readsEnv)}.`,
        data,
      ),
    ];
  }
  if (missing.length === 0) return [finding("runtime", "green", "Runtime", `${said}${console_}`, "", data)];
  return [
    finding(
      "runtime",
      "amber",
      "Runtime",
      `${missing.map((r) => r.exe).join(", ")} ${missing.length === 1 ? "is" : "are"} not there, so nothing that runs under ${missing.length === 1 ? "it" : "them"} fires; ${said}${console_}`,
      // `counterparts` itself runs under bun whenever bun is on PATH (the
      // launcher prefers it), so "run it under the runtime you want" would be
      // advice nobody can follow for Node. The explicit Node line is printed.
      `${quitDesktop(missing.flatMap((r) => r.used))}Run: counterparts connect — it rewrites them with the runtime it runs under (bun when bun is on PATH, else Node). To wire Node with bun also installed: node --import "${NODE_HOOKS}" "${CLI_SCRIPT}" connect. Then restart Claude Code${reopenDesktop(missing.flatMap((r) => r.used))}.`,
      data,
    ),
  ];
}

/** What the console read of Claude Desktop's config (`cli/desktop.ts#readDesktop`). */
export interface DesktopReading {
  readonly path: string;
  readonly state: "absent" | "no-entry" | "entry" | "unreadable";
  /** The store Desktop's `counterparts` entry names, or null. */
  readonly dataDir: string | null;
  /** Claude Code's own registration names `counterparts` too — the Code-tab clash. */
  readonly codeTab: boolean;
  /** The store Claude Code's registration names, or null. */
  readonly codeDataDir: string | null;
}

/**
 * THE CLAUDE DESKTOP LINE (2026-09-30, brief item 8): whether its config entry
 * is present, and when the last Desktop wake and session were. QUIET when there
 * is no entry — Desktop is optional — and never amber for that. Amber only for
 * an entry that is there and names another store than this one, directly or
 * through the Code tab's name clash (`cli/desktop.ts`'s header). Desktop
 * sessions are named as NOT MEASURED for write-ups: nothing is captured there,
 * so there is no stretch to count as written up or not — never as lost.
 */
export function desktopFindings(reading: DesktopReading, store: Store | null, dir: string): Finding[] {
  if (reading.state === "absent" || reading.state === "no-entry") return [];
  const data: Record<string, string | number | boolean | null> = {
    path: reading.path,
    state: reading.state,
    dataDir: reading.dataDir,
    codeTab: reading.codeTab,
    codeDataDir: reading.codeDataDir,
  };
  if (reading.state === "unreadable") {
    return [
      finding(
        "desktop",
        "green",
        "Claude Desktop",
        `${reading.path} could not be read as JSON, so whether Counterparts is connected there is not known`,
        "",
        data,
      ),
    ];
  }
  const same = (a: string | null, b: string | null): boolean => a === null || b === null || sameScope(a, b);
  const fix = "Run: counterparts install --host claude-desktop — then quit and reopen Claude Desktop.";
  if (!same(reading.dataDir, dir)) {
    return [
      finding(
        "desktop",
        "amber",
        "Claude Desktop",
        `connected, but its entry names a different store (${reading.dataDir ?? "?"}) from this one (${dir})`,
        fix,
        data,
      ),
    ];
  }
  if (reading.codeTab && !same(reading.dataDir, reading.codeDataDir)) {
    return [
      finding(
        "desktop",
        "amber",
        "Claude Desktop",
        `Desktop's Code tab gets its counterparts tools from Desktop's entry, which shadows ~/.claude.json's, and the two name different stores (${reading.dataDir ?? "?"} and ${reading.codeDataDir ?? "?"})`,
        fix,
        data,
      ),
    ];
  }
  // WHEN IT LAST WOKE, AND WHAT IS LIVE — one meta read and the registry's week.
  const zone = store?.zone() ?? "UTC";
  let lastWake: number | null = null;
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
    ...(lastSession === null ? [] : [`last session active ${localStamp(lastSession, zone)}`]),
    ...(desktop.length === 0
      ? []
      : [`${String(desktop.length)} Desktop ${desktop.length === 1 ? "session" : "sessions"} this week, not measured for write-ups (Desktop chat keeps no transcript)`]),
    // Measured 2026-10-01: the Code tab's counterparts tools are Desktop's
    // server, which serves a Code-tab session when the call names its id.
    ...(reading.codeTab ? ["its Code tab's counterparts tools come from this entry's server, which shadows ~/.claude.json's — both name this store, and Code-tab sessions pass their session id"] : []),
  ];
  // SAID, NOT MEASURED (2026-10-02): Desktop asks before each tool until its
  // tools are set to Always allow, and a chat whose tools still ask never
  // called `wake`. Nothing on disk says which, so the line says it every time.
  parts.push("set its counterparts tools to Always allow, or a chat cannot wake on its own (not measurable from here)");
  return [finding("desktop", "green", "Claude Desktop", parts.join("; "), "", data)];
}

export function hostFindings(reading: HostReading): Finding[] {
  const total = reading.expected.length;
  const missing = reading.expected.filter((e) => !reading.events.includes(e));
  const stale = reading.stale;
  const where = [
    reading.settingsRead.length === 0
      ? "no host settings file was readable"
      : `read ${reading.settingsRead.join(", ")}`,
    // AN UNREADABLE FILE IS SAID OUT LOUD. Dropping it silently is how a
    // mode-000 settings file reads as an absent one, and the reader is then
    // told to paste a block they have already pasted.
    reading.settingsUnreadable.length === 0
      ? ""
      : `could not read ${reading.settingsUnreadable.join(", ")}`,
  ]
    .filter((s) => s.length > 0)
    .join("; ");
  const data: Record<string, string | number | boolean | null> = {
    events: reading.events.join(","),
    missing: missing.join(","),
    stale: stale.map((s) => `${s.event}→${s.path}`).join(","),
    settingsRead: reading.settingsRead.join(","),
    settingsUnreadable: reading.settingsUnreadable.join(","),
    mcp: reading.mcp,
    mcpFile: reading.mcpFile,
  };
  // THE PLUGIN (prototype, 2026-10-09). A plugin install wires nothing in
  // these files — Claude Code loads its hooks and server from the plugin — so
  // without this the line told a plugin user "no hook of ours is connected,
  // run counterparts connect", which would wire the host twice. Enabled and
  // alone: connected. Enabled beside live npm wiring: the plugin stands down
  // (`adapters/plugin.ts`), which works, and is said, with both ways out.
  const plugin = reading.plugin !== undefined && reading.plugin !== null && reading.plugin.enabled ? reading.plugin : null;
  data["plugin"] = plugin === null ? null : plugin.id;
  const npmAny = reading.events.length > 0 || reading.mcp;
  if (plugin !== null && !npmAny) {
    return [
      finding(
        "host",
        "green",
        "Claude Code",
        `connected as the Claude Code plugin (${plugin.id}${plugin.version === null ? "" : ` ${plugin.version}`}): its ${String(total)} hooks and the memory tools load from the plugin`,
        "",
        data,
      ),
    ];
  }
  const twiceClause =
    plugin === null ? "" : `ALSO installed as the Claude Code plugin (${plugin.id}), which stands down while this wiring is live`;
  const twiceFix =
    plugin === null
      ? ""
      : `Installed twice: to keep only the plugin, run \`counterparts disconnect\` and restart Claude Code; to keep only this install, run \`claude plugin uninstall ${plugin.id}\`. Same memory either way.`;
  const mcpClause = reading.mcp
    ? `the MCP server is registered in ${reading.mcpFile}`
    : reading.mcpUnreadable
      ? `${reading.mcpFile} could not be read, so the MCP registration could not be checked`
      : `no MCP server named "${reading.mcpName}" in ${reading.mcpFile}`;

  if (missing.length === 0 && stale.length === 0 && reading.mcp) {
    if (plugin !== null) {
      return [finding("host", "amber", "Claude Code", `connected: ${String(total)} hooks and the memory tools; ${twiceClause}`, twiceFix, data)];
    }
    // THE ONE LINE THE PERSON CAME FOR: is my assistant joined up to this
    // memory? It says `connected` because that is the verb the command has
    // (`counterparts connect`), and it names the two halves — the hooks and the
    // tools — rather than a file format nobody asked about. `--json` still
    // carries every event name and every path in `data`.
    return [
      finding(
        "host",
        "green",
        "Claude Code",
        `connected: ${String(total)} hooks and the memory tools`,
        "",
        data,
      ),
    ];
  }
  // THE FIX IS `connect` NOW, NOT `install` (2026-09-21, A; renamed from `wire`
  // 2026-09-22). Until that change the only thing the package could do about a
  // missing hook was PRINT a block, so the fix line sent a reader to the command
  // that prints it and then asked them to paste. `counterparts connect` does the
  // paste: it backs the file up, merges beside whatever else is on those events,
  // and repairs an entry of ours that names a path that has moved — which is
  // precisely the `stale` case below. A fix line that names the longer way round
  // is a fix line somebody follows.
  //
  // ONE SENTENCE, whatever is wrong: the three cases below were three separate
  // fix lines that each began "Run: counterparts connect", and a reader with
  // two of them was told to run the same command twice.
  const does: string[] = [];
  if (missing.length > 0) does.push("adds the hooks beside anything already there");
  if (stale.length > 0) {
    does.push(
      `replaces the ${stale.length === 1 ? "stale entry" : "stale entries"} with the path this install actually has`,
    );
  }
  // `connect` REGISTERS THE MEMORY TOOLS BY RUNNING `claude mcp add` — so with
  // no `claude` on the PATH, "Run: counterparts connect" names the very command
  // that just failed to register them (go-public Phase C walk, 2026-09-23). In
  // that one case the fix is the line `connect` itself prints: run it wherever
  // `claude` works. The hooks half, if it is owed, is still `connect`'s.
  const cannotRegister =
    !reading.mcp && !reading.mcpUnreadable && reading.claudeOnPath === false && reading.mcpAddLine !== undefined;
  if (!reading.mcp && !reading.mcpUnreadable && !cannotRegister) does.push("registers the memory tools");
  const byHand = cannotRegister
    ? `\`claude\` is not on this PATH, so \`counterparts connect\` cannot register the memory tools: run this where \`claude\` works — ${reading.mcpAddLine ?? ""} — then restart Claude Code.`
    : "";
  const fixes = [
    ...(does.length === 0
      ? []
      : [
          `Run: counterparts connect — it backs up ~/.claude/settings.json, ${
            does.length === 1 ? does[0] : `${does.slice(0, -1).join(", ")} and ${does[does.length - 1] ?? ""}`
          }.${cannotRegister ? "" : " Then restart Claude Code."}`,
        ]),
    ...(byHand.length === 0 ? [] : [byHand]),
  ];
  // STALE FIRST. "GREEN while nothing fires" is the one outcome this line was
  // added to prevent, and a block pointing at a deleted checkout is exactly
  // that: it matches, it is installed, and every session start fails silently.
  const staleClause =
    stale.length === 0
      ? ""
      : `${stale.map((s) => s.event).join(", ")} point${stale.length === 1 ? "s" : ""} at ${stale
          .map((s) => s.path)
          .join(", ")}, which is not there`;
  const connected =
    missing.length === total
      ? `no hook of ours is connected on any of the ${String(total)} events`
      : missing.length > 0
        ? `connected on ${reading.events.join(", ")} but NOT on ${missing.join(", ")}`
        : `all ${String(total)} hook events are connected`;
  const detail = [staleClause, connected, `(${where})`, mcpClause, twiceClause]
    .filter((s) => s.length > 0)
    .join("; ")
    .replace("; (", " (");
  return [finding("host", "amber", "Claude Code", detail, [...fixes, ...(twiceFix.length === 0 ? [] : [twiceFix])].join(" "), data)];
}
