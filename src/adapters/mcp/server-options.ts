/** The MCP server's options, its events and results, and how it resolves the scope it serves (moved out of `server.ts`, 2026-10-11). */
import type { Counterpart } from "../../core/counterpart.js";
import type { ScopeCommandContext } from "../scopes.js";
import type { InstallRoute } from "../plugin.js";
import type { AdapterConfig } from "../config.js";
import type { Spawner } from "../spawn.js";
import { canonicalScope } from "../sessions.js";

/** What reading the two stamps said: fine, or one of the three refusals. */
export type SchemaVerdict =
  | { readonly kind: "ok" }
  | { readonly kind: "busy" }
  | { readonly kind: "unreadable" }
  | {
      readonly kind: "ahead";
      readonly store: string | null;
      readonly cache: string | null;
      readonly storeAhead: boolean;
      readonly cacheAhead: boolean;
    };

/** Telemetry: ids, counts, reasons, flags. NEVER body text (store §5 G10). */
export interface McpEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface McpServerOptions {
  counterpart: Counterpart;
  /**
   * The ONE session this server may deposit under, when the host can say so at
   * launch. Absent ⇒ the lazy bind (`requireBoundSession`) is the only way in.
   */
  session?: string;
  /**
   * The project this server's sessions belong to. Absent, it is what the host
   * offered (`hostScope`): `CLAUDE_PROJECT_DIR` first — the variable the hooks
   * file a session under — then `process.cwd()`, which is MEASURED to be the
   * project directory on this host: `lsof` on four running servers, 2026-09-04,
   * showed each one's cwd was the directory its session ran in. The store's dir
   * is the last resort, and it is a bad scope —
   * every memory authored through this server carried the store path as
   * `origin_scope` for the whole run because it was the only default.
   */
  scope?: string;
  /**
   * The embedder, for ONE purpose: embedding a deliberate question in line.
   *
   * The ruling of 2026-09-04 splits the two paths — the ambient hot path may not
   * embed (it has a 1200 ms budget and a person mid-sentence), the deliberate
   * ask may (someone typed a question and is waiting). This is that half.
   *
   * The ENTRY POINT reads the configuration and hands over an opened embedder
   * or null (`bin/serve.ts`), exactly as `bin/hook.ts` does for the hook
   * adapter. Null degrades the ask to lexical-only and the result SAYS so.
   */
  embedder?: QuestionEmbedder | null;
  /**
   * Where the hooks' live-session registry lives. Defaults to the store's own
   * data dir — the one path both adapters resolve independently and agree on.
   */
  registryDir?: string;
  /** **CAL.** Liveness window for a lazily-bound claim (`adapters/sessions.ts`). */
  sessionTtlMs?: number;
  /**
   * The most one tool result may measure, by `wireChars` of its serialized
   * `structuredContent` (`withinCeiling`). Default `TOOL_RESULT_CEILING.CHARS`;
   * a test passes a small one to reach the cut without a 40,000-character page.
   */
  resultCeilingChars?: number;
  /**
   * THE SCOPE REGISTRY this server consults — `<config dir>/scopes.json`,
   * resolved by the entry point from the same `--config` rule everything else
   * uses (`bin/serve.ts`). Absent means "nobody told us", which reads as `unset`
   * and behaves exactly as this server always has.
   *
   * It is read PER CALL rather than pinned at construction, and deliberately:
   * the file is a few hundred bytes, and a session whose directory was switched
   * back on — from the console in another terminal, or by this server's own
   * `scope` tool — must get its memory back without the host restarting the
   * process. The launch stderr line is the one thing computed once.
   */
  scopesFile?: string;
  /**
   * What the console line a scope refusal names needs to work where it is
   * typed (`scopes.ts#ScopeCommandContext`, 2026-10-10): the plugin's launcher
   * when this is the plugin's server, and `--config` when `scopesFile` is not
   * the default registry. Set by `bin/serve.ts`. Absent: the npm install's
   * `counterparts`, with `--config` only when `lifecycle.configPath` names
   * another registry.
   */
  scopeCommand?: ScopeCommandContext;
  /**
   * How this copy was installed (`plugin.ts#installRoute`), for the first
   * meeting's close — how to remove Counterparts. Set by `bin/serve.ts`.
   * Absent (a test, an embedder): not known, and the close names both routes.
   */
  install?: InstallRoute;
  /**
   * WHICH HOST THIS SERVER SERVES (`hosts.ts`, 2026-09-30), for the words a
   * result says about the host — today, how to reconnect after an update.
   * Absent: `DEFAULT_HOST`, Claude Code, which is every launch `bin/serve.ts`
   * makes today.
   *
   * Since PR B (2026-09-30) the CLIENT decides as well: a client that names
   * itself Claude Desktop's chat or Cowork at `initialize`
   * (`hosts.ts#hostOfClient`) turns this server into Desktop's — the `wake`
   * tool, the `claude-desktop:` place, per-call binding and the write-up ask.
   * Any other client leaves it as this option set it. `DESKTOP_HOST` here does
   * the same from construction (tests, an embedder that knows).
   */
  host?: string;
  /**
   * THE CLAUDE.AI TRIAL'S CANARY (2026-10-26): one invented fact, added to the
   * `initialize` `instructions` a claude.ai server sends and to nothing else —
   * no tool description carries it — so a cold question about it shows whether
   * claude.ai delivered the field. Set by `adapters/remote/bin/serve-http.ts`;
   * ignored by every other host.
   */
  canary?: string;
  /**
   * WHAT CLAUDE DESKTOP'S `wake` NEEDS TO RUN A SESSION START, handed in by the
   * entry point (`bin/serve.ts`) and used only once a Desktop client is seen:
   * the configuration this process read (the wake's budget, the worker's
   * plan), which file that was, and how the worker is started. Absent — a test,
   * an embedder — the wake runs on an empty configuration over this store, and
   * the worker on this runtime and `spawn.ts#WORKER_RUNNER_PATH`.
   */
  lifecycle?: {
    config?: AdapterConfig;
    configPath?: string;
    command?: string;
    args?: readonly string[];
    spawner?: Spawner;
  };
  /**
   * THE DOCTOR NOTICE for Desktop's `wake` — `claude-code/doctor.ts`'s red-only
   * line, which this library may not import, so the entry point hands over a
   * closure (`bin/serve.ts`). Null or absent: nothing to say. `night`: the
   * wake is a night's own (`wake` with `night: true`), which no person reads.
   */
  wakeNotice?: (opts: { night: boolean }) => string | null;
  /** The package version on disk now (`sessions.ts#manifestVersionOnDisk`),
   *  injectable so the update line is provable without reinstalling. */
  manifestVersion?: () => string | null;
  /**
   * The newest Counterparts plugin version Claude Code records for this
   * folder (`host-wiring.ts#pluginVersionRecorded`), read when a plugin
   * server meets a newer store: newer than this server is "reload", anything
   * else "update" (U1a). Injectable so the choice is provable without a real
   * `installed_plugins.json`; absent, read from the home directory.
   */
  pluginVersion?: () => string | null;
  /** This process's environment, read once at `initialize` for Claude Code's
   *  markers (`hosts.ts#claudeCodeEnvMarker`). Injectable for a test; absent,
   *  `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * The launch directory's scope entry said `observer`, and the launch could not
   * tell whether Claude Code started it (`bin/serve.ts`, review of #294 finding
   * 2): the store was opened as a writer, and this server stands every tool
   * down itself — unless a Claude Desktop client shows up, whose place is
   * `claude-desktop:` and is read per call instead.
   */
  launchObserver?: boolean;
  onEvent?: (e: McpEvent) => void;
  /**
   * Told after every tool call over the wire has its answer, before the answer
   * is written back: the tool's name. It must only SCHEDULE work (the entry
   * point arms the sidebar's status file this way, `adapters/sidebar-status.ts`)
   * — anything it does inline is time the client waits. A throw is swallowed.
   */
  afterCall?: (tool: string) => void;
  now?: () => number;
}

/** The narrow face of `claude-code/embed-client.ts`'s `LiveEmbedder` this
 *  adapter needs — structural, so the server library imports no other adapter.
 *  (The entry point, `bin/serve.ts`, still opens the embedder through
 *  `claude-code/embed-client.ts`; its configuration comes from the shared
 *  `adapters/config.ts` since 2026-09-30.) */
export interface QuestionEmbedder {
  vector(text: string): Promise<number[] | null>;
}

/** MCP's tool-result shape. A refusal is a RESULT, never a JSON-RPC error. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

export const EVENT_RING = 200;

/**
 * THE SCOPE THE HOST OFFERED, or null when it offered none.
 *
 * In order: what the launch declared (`--scope` / `COUNTERPARTS_SCOPE`), then
 * `CLAUDE_PROJECT_DIR`, then this process's working directory.
 *
 * **`CLAUDE_PROJECT_DIR` is second, and it is what makes the two adapters agree
 * without either one telling the other.** The host documents it as the project
 * root where the session started, exports it to hook processes AND to stdio MCP
 * servers, and keeps it put when the agent enters a worktree or runs `cd` — so
 * the hooks' `sessionScope` and this resolve the same string from the same
 * variable. What the server's own working directory is, this host does not
 * document at all: `lsof` on four running servers measured it as the session's
 * directory on 2026-09-04, and a measurement is what it remains. It stays as the
 * fallback it has always been.
 *
 * CANONICAL, because the scope is not only compared — it is the KEY. Span
 * streams, cursors and coverage files are named from a hash of this exact string
 * (`remember/spans.ts#keyFor`), so a deposit whose scope says `/tmp/x` claims
 * coverage in a different directory from spans captured under `/private/tmp/x`.
 * `sameScope` was already canonicalising for the BIND; this makes the filing
 * agree too.
 */
export function hostScope(
  declared: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { scope: string; source: Exclude<ScopeSource, "store"> } | null {
  if (declared !== undefined && declared.length > 0) {
    return { scope: canonicalScope(declared), source: "flag" };
  }
  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof projectDir === "string" && projectDir.length > 0) {
    return { scope: canonicalScope(projectDir), source: "project" };
  }
  try {
    const cwd = process.cwd();
    if (cwd.length > 0) return { scope: canonicalScope(cwd), source: "cwd" };
  } catch {
    /* no working directory — the caller falls through to the store's own dir */
  }
  return null;
}

/**
 * The scope default: whatever the host offered, and — only if it offered
 * nothing at all — the store's own dir.
 *
 * The last resort is a bad answer and is kept only because a server with no
 * scope at all cannot deposit: from 2026-09-03 it was the ONLY answer, so every
 * memory authored through this server was stamped with the store path instead of
 * the project. `process.cwd()` can throw (a deleted working directory), which is
 * the one case the fallback is actually for.
 */
export function resolveScope(
  declared: string | undefined,
  storeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): { scope: string; source: ScopeSource } {
  return hostScope(declared, env) ?? { scope: storeDir, source: "store" };
}

/** How this server learned which project it is serving. Reported at startup.
 *  `host`: the host has no directory, and its place is a name (Claude
 *  Desktop's `claude-desktop:`, 2026-09-30). */
export type ScopeSource = "flag" | "project" | "cwd" | "store" | "host";

/** Sessions whose "shown" a server keeps in memory for `feelingsNow` (Desktop serves many). */
export const SEEN_SESSIONS = 32;
