/**
 * HOW TO GET A NEWER COUNTERPARTS INTO THIS WINDOW — the install routes'
 * steps, and what an older copy says when it meets a memory a newer one has
 * upgraded (U1a, 2026-10-27).
 *
 * A leaf, beside `hosts.ts` and `plugin.ts`, because three adapters say it and
 * adapters never import each other: the MCP server's refusal
 * (`mcp/server-words.ts`), the hook's stand-down (`claude-code/bin/hook.ts`)
 * and doctor's Store open line, plus the wake's line about older windows.
 * `claude-code/doctor-meaning.ts` re-exports the route steps it had first
 * (`PLUGIN_UPDATE`, `npmTableCommand`, `byRoute`), so doctor and W1's wake
 * line read them where they always did.
 *
 * **Why the words need the route.** An npm install is replaced in place, so an
 * old MCP server that reconnects loads the new code: "/mcp and Reconnect"
 * works there. A plugin is not: Claude Code keeps the previous version's
 * folder (for 14 days) and an open window's hooks and server keep its path
 * until `/reload-plugins`, so Reconnect starts the same old code again.
 *
 * **Why reload and update are told apart** (review of the U1 design, finding
 * 3). `/reload-plugins` loads what `installed_plugins.json` records. When that
 * is newer than the code this window runs, the window was simply never
 * reloaded; when it is not — a newer npm or Desktop install wrote the store, a
 * `--plugin-dir` copy did, or the plugin was rolled back — a reload loads this
 * same code and the refusal never clears. So the plugin's words say reload
 * only when the record is newer, and otherwise update-then-reload, which
 * works either way. Neither can loop.
 *
 * **`/reload-plugins`' two limits** (Claude Code's docs, quoted in the
 * review): it declines with a warning when the reload would force a full
 * re-read of the prompt cache (`--force` applies it anyway), and in sessions
 * without a terminal — Claude Desktop's Code tab — it reloads everything but
 * plugin MCP servers, which wait for the next session. So the step names
 * `--force` and a new session, and in the Code tab leads with the new session.
 *
 * The writer is not always "another window" — the nightly run, Claude
 * Desktop, the console or the dashboard upgrade the memory too — so no line
 * here says who did it.
 */
import { DEFAULT_HOST, wordingFor } from "./hosts.js";
import type { InstallRoute } from "./plugin.js";
import { currentRuntime } from "./runtime.js";
import type { RuntimeKind } from "./runtime.js";

// ── the install routes' steps (moved from doctor-meaning.ts, W1) ───────────

/** The plugin's way to a newer or whole copy: Claude Code's plugin manager. */
export const PLUGIN_UPDATE = "in Claude Code, /plugin → Installed → counterparts → Update now (or uninstall it and install it again)";

/**
 * THE NPM INSTALL'S WAY TO THE MEANING TABLE: install Counterparts again with
 * the runtime it runs on (README's two lines). The weights are the package's
 * own dependency and are found beside it (`resolveStaticWeights`'
 * `require.resolve`); a separate global `counterparts-model-potion` is not
 * where that looks, so naming it was a fix that fixed nothing (review of #664).
 */
export function npmTableCommand(runtime: RuntimeKind = currentRuntime()): string {
  return runtime === "node" ? "npm install -g counterparts" : "bun add -g counterparts";
}

/** The npm install's way to a NEWER copy: the same command, at `@latest`. */
export function npmUpdateCommand(runtime: RuntimeKind = currentRuntime()): string {
  return `${npmTableCommand(runtime)}@latest`;
}

/**
 * A fix that installs something, in the words of the route this copy came
 * by: the npm command, the plugin's update, or — not known — both.
 */
export function byRoute(route: InstallRoute | undefined, npm: string, plugin: string = PLUGIN_UPDATE): string {
  const r = route ?? "either";
  if (r === "npm") return npm;
  if (r === "plugin") return plugin;
  return `npm: ${npm} · plugin: ${plugin}`;
}

// ── reloading a window ─────────────────────────────────────────────────────

/** Loading the plugin's newer copy into an open Claude Code window. */
export const RELOAD_STEP = "run /reload-plugins (if it warns about the cache, /reload-plugins --force), or start a new session";

/** The same in Claude Desktop's Code tab, where `/reload-plugins` leaves the plugin's MCP server as it was. */
export const RELOAD_STEP_CODE_TAB =
  "start a new session (in Claude Desktop's Code tab, /reload-plugins doesn't restart Counterparts' memory tools)";

export function reloadStep(codeTab: boolean): string {
  return codeTab ? RELOAD_STEP_CODE_TAB : RELOAD_STEP;
}

/**
 * How an older Claude Code window loads the newer copy, by that window's
 * route: the plugin's reload, the npm server's Reconnect, or — not known —
 * both. Lower-case, no closing stop. For the wake's line about older windows
 * and the prompt's "Counterparts was updated" notice.
 */
export function windowStep(route: InstallRoute | undefined, codeTab: boolean): string {
  const reconnect = lowerFirst(wordingFor(DEFAULT_HOST).reconnectFirst);
  if (route === "npm") return reconnect;
  if (route === "plugin") return reloadStep(codeTab);
  return `for the plugin, ${reloadStep(codeTab)}; for an npm install, ${reconnect}`;
}

// ── a memory a newer copy upgraded ─────────────────────────────────────────

/**
 * What gets the newer copy into this window:
 *   - `reload` — the plugin, with a newer version recorded than this window runs;
 *   - `update` — anything else on the plugin, and an npm HOOK (which is
 *     already the installed code, so a store ahead of it means the install is
 *     the older one);
 *   - `reconnect` — an npm MCP SERVER: the install was replaced under it, and
 *     reconnecting loads it (the words it has always said).
 */
export type NewerStoreStep = "reload" | "update" | "reconnect";

export interface NewerStoreInput {
  /** How this copy came (`plugin.ts#installRoute`); `either` names both. */
  readonly route: InstallRoute;
  /** Which process says it: the MCP server keeps the code it loaded at start;
   *  a hook (or the console) is the code installed at its own path now. */
  readonly who: "server" | "hook";
  /** This copy's version (`package.json`), or null when unreadable. */
  readonly loaded: string | null;
  /** The newest plugin version Claude Code records here
   *  (`host-wiring.ts#pluginVersionRecorded`), or null. */
  readonly recorded: string | null;
  /** The version that wrote the memory, when known (the server reads the wake's build stamp). */
  readonly writer?: string | null;
  /** Claude Desktop's Code tab (`CLAUDE_CODE_ENTRYPOINT=claude-desktop`). */
  readonly codeTab?: boolean;
  /** The host whose reconnect words an npm step ends with; absent, Claude Code. */
  readonly host?: string;
  /** The runtime the npm command names; absent, this process's. */
  readonly runtime?: RuntimeKind;
}

/** `a` newer than `b`, comparing `x.y.z` only (a `-<sha>` suffix ignored). */
export function coreNewer(a: string | null, b: string | null): boolean {
  const parse = (v: string | null): number[] | null => {
    const m = v === null ? null : /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const x = parse(a);
  const y = parse(b);
  if (x === null || y === null) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/**
 * Which step, for one definite route (`either` asks both). Pure. A plugin
 * reloads only into a recorded version newer than this one AND at least as
 * new as the writer, when the writer is known (review of #666): a record of
 * 0.3.38 under a memory 0.3.39 upgraded would load code that still refuses.
 */
export function newerStoreStep(route: "npm" | "plugin", input: Pick<NewerStoreInput, "who" | "loaded" | "recorded" | "writer">): NewerStoreStep {
  if (route === "plugin") {
    const writer = input.writer ?? null;
    return coreNewer(input.recorded, input.loaded) && !coreNewer(writer, input.recorded) ? "reload" : "update";
  }
  return input.who === "server" ? "reconnect" : "update";
}

function lowerFirst(s: string): string {
  return `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
}

export function upperFirst(s: string): string {
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

/** The imperative step for one route, lower-case, no closing stop. */
function remedyFor(route: "npm" | "plugin", input: NewerStoreInput): string {
  const reload = reloadStep(input.codeTab === true);
  const step = newerStoreStep(route, input);
  if (step === "reload") return reload;
  const reconnect = lowerFirst(wordingFor(input.host ?? DEFAULT_HOST).reconnectFirst);
  if (step === "reconnect") return reconnect;
  return route === "plugin"
    ? `update Counterparts: ${PLUGIN_UPDATE}; then ${reload}`
    : `update Counterparts: in a terminal, run ${npmUpdateCommand(input.runtime)}; then ${reconnect}`;
}

/**
 * THE STEP ALONE, lower-case and without a closing stop, for a sentence that
 * has already said what happened (the cache refusal's "If that newer build is
 * installed, …"). `either` names both routes.
 */
export function newerStoreRemedy(input: NewerStoreInput): string {
  if (input.route === "either") return `for the plugin, ${remedyFor("plugin", input)}; for an npm install, ${remedyFor("npm", input)}`;
  return remedyFor(input.route, input);
}

/**
 * THE WHOLE SENTENCE: what happened, and the step that fixes it here. For a
 * person or for the model to pass on; it never names who upgraded the memory.
 */
export function newerStoreWords(input: NewerStoreInput): string {
  const upgraded = "A newer version of Counterparts";
  if (input.route === "either") {
    return `${upgraded} upgraded this memory, and this window runs an older one. ${upperFirst(newerStoreRemedy(input))}.`;
  }
  const step = newerStoreStep(input.route, input);
  if (step === "update") {
    const writer = input.writer !== undefined && input.writer !== null && input.writer.length > 0 ? ` (${input.writer})` : "";
    const loaded = input.loaded === null ? "an older one" : input.loaded;
    return `${upgraded}${writer} upgraded this memory; this one is ${loaded}. To use it here, ${remedyFor(input.route, input)}.`;
  }
  return `${upgraded} upgraded this memory, and this window still runs the old one. ${upperFirst(remedyFor(input.route, input))}.`;
}
