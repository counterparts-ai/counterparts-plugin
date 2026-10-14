/**
 * WHICH RUNTIME RUNS A SCRIPT, and the arguments that say so — the one place
 * that knows the difference between Bun and Node.
 *
 * The sources are TypeScript and there is no build step (one exception: the
 * plugin directory's bundle carries them transpiled to `.js`, `TRANSPILED`
 * below, and its scripts follow `entryScript`). Bun runs them as they
 * are (`bun run <script.ts>`); Node runs them with `node-hooks.mjs` loaded first
 * (`node --import <node-hooks.mjs> <script.ts>`), which resolves the sources'
 * `./x.js` imports to `./x.ts` and strips the types. Every command this package
 * writes into a host's configuration, and every worker it spawns, is
 * `<runtime> <scriptArgs(script)>`, with the runtime the one running NOW
 * (`process.execPath`) — so `counterparts install` run under Node wires Node,
 * and under Bun wires Bun. The Bun shape was `run <script>` from 2026-09-03
 * and is `--no-env-file --config=<empty-bunfig.toml> run <script>` since
 * 2026-10-09 (below).
 *
 * The runtime is read off the executable's NAME, not off this process, so a
 * caller that passes a fixed executable (every test does) gets the shape that
 * executable needs. Anything not named `node…` is treated as Bun, which is what
 * every command written before Node support said.
 *
 * **BUN IS TOLD NOT TO READ THE PROJECT'S `.env` OR `bunfig.toml`
 * (2026-10-09).** A host starts our hooks and servers in the person's project,
 * and Bun reads two things from the WORKING DIRECTORY before any of our code
 * runs:
 *
 *   - `.env`, `.env.local` and `.env.<NODE_ENV>`, into `process.env`. A
 *     project whose `.env` set `COUNTERPARTS_DATA_DIR` or `COUNTERPARTS_CONFIG`
 *     could point Counterparts at another store — measured, for the plugin's
 *     server, which no `-e` pins, and for an npm install's hooks, which name no
 *     `--config` (scar §2.13 from a direction the spawner's pinning never
 *     covered). A variable already in the real environment still wins over a
 *     `.env` (also measured), so the hole was every variable nobody set.
 *     `--no-env-file` switches the loading off.
 *   - `bunfig.toml`, whose TOP-LEVEL `preload = [...]` runs the project's code
 *     inside our process before our entry (measured on Bun 1.3.10, through
 *     `run` and a bare script alike, the plugin's launcher included; `[run]
 *     preload` does not apply to these launches). `--config=<file>` makes Bun
 *     read that file instead, and `EMPTY_BUNFIG` is one with nothing in it but
 *     `[install] auto = "disable"`: no runtime auto-install, so a package missing
 *     from node_modules is never fetched from npm behind the person's back (the
 *     file says more). A missing one is fatal to Bun, so it ships beside this
 *     file and must stay.
 *
 * Node has neither: it reads a `.env` only when `--env-file` names one, and no
 * `bunfig.toml`. Commands written before this lack one flag or both: they
 * still parse (`parseScriptInvocation`, `projectEnv: "read"`), `doctor` names
 * them, and `counterparts connect` rewrites them.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type RuntimeKind = "bun" | "node";

/** Bun's switch that stops it loading `.env` files from the working directory. */
export const BUN_NO_ENV_FILE = "--no-env-file";

// ── the single binary (docs/single-binary.md) ──────────────────────────────
//
// `bun build --compile` (tools/single-binary/) packs every module, the model
// table and the dashboard's files into one executable that needs no Bun or Node
// on the machine — what the plugin downloads when it finds neither. Inside it,
// EVERY module's `import.meta.url` is the binary's own virtual file
// (`file:///$bunfs/root/<name>`; `B:/~BUN/root/<name>` on Windows), so a path
// computed from `import.meta.url` no longer says where a module lives, and the
// files the build embedded sit under that virtual root at their
// repository-relative paths. Everything below takes the binary as a parameter
// defaulting to `BINARY`, so a test can run every compiled branch from source.

/** The compiled binary this process is: `root`, the virtual directory its
 *  embedded files sit under; `self`, the executable on disk. */
export interface Binary {
  readonly root: string;
  readonly self: string;
}

/** The binary a module URL says this process is, or null when it is source.
 *  Pure: a test hands it a URL of either shape. */
export function binaryOf(moduleUrl: string, self: string): Binary | null {
  const path = moduleUrl.startsWith("file:") ? decodeURIComponent(new URL(moduleUrl).pathname) : moduleUrl;
  if (!/[\\/]\$bunfs[\\/]|(^|[\\/])~BUN[\\/]/.test(path)) return null;
  // The directory holding the binary's own virtual file. By hand rather than
  // `node:path`, which on a POSIX host does not split a Windows path.
  const root = path.replace(/[\\/][^\\/]*$/, "").replace(/^\/([A-Za-z]:[\\/])/, "$1");
  return { root, self };
}

/** This process, if it is the compiled binary; null from source. */
export const BINARY: Binary | null = binaryOf(import.meta.url, process.execPath);

// ── the transpiled tree (tools/plugin-bundle/build.ts --flavor directory) ──
//
// The plugin directory's bundle carries these sources transpiled one for one,
// `src/x.ts` → `src/x.js`, types and comments stripped, its entries started by
// their own shebang (2026-10-14: the directory's validator times out on ~7 MB
// of commented TypeScript). A tree is all one or all the other, so a script
// another process runs is named in source by its `.ts` path and takes the
// extension of the tree it is in from this module's own URL.

/** `.js` in the transpiled tree; `.ts` from source and in the single binary
 *  (whose entries are found by name, `binaryModeOf`). Pure: a test hands it a
 *  URL of either shape. */
export function moduleExtOf(moduleUrl: string, binary: Binary | null = BINARY): ".ts" | ".js" {
  return binary === null && /\.js$/.test(moduleUrl) ? ".js" : ".ts";
}

/** The extension this package's modules carry where they run now. */
export const MODULE_EXT: ".ts" | ".js" = moduleExtOf(import.meta.url);

/** Is this process running the transpiled tree? It exists only as the plugin
 *  directory's bundle, which has no `plugin-run.sh`: Claude Code starts its
 *  entries by their shebang. */
export const TRANSPILED: boolean = MODULE_EXT === ".js";

/**
 * A script this package starts or names, written in source by its `.ts` path
 * as a `new URL` from `import.meta.url` (a literal the bundle's tracer
 * follows), as the file this tree holds: that path from source, its `.js`
 * sibling in the transpiled tree.
 */
export function entryScript(url: URL, ext: ".ts" | ".js" = MODULE_EXT): string {
  const path = fileURLToPath(url);
  return ext === ".js" ? path.replace(/\.ts$/, ".js") : path;
}

/** Is this process (or the binary a test names) the compiled binary? */
export function isCompiled(binary: Binary | null = BINARY): boolean {
  return binary !== null;
}

/** A file of this package by its path from the package root (`/`-separated):
 *  on disk from source, among the binary's embedded files when compiled. */
export function packagePath(rel: string, binary: Binary | null = BINARY): string {
  if (binary === null) return fileURLToPath(new URL(`../../${rel}`, import.meta.url));
  const sep = binary.root.includes("\\") ? "\\" : "/";
  // Bun names an embedded file at the top of the build root `./<name>` (its
  // `[dir]` is "."), and the virtual filesystem matches names exactly
  // (measured on 1.3.10; `<binary> selfcheck`, run by every build, holds it).
  return rel.includes("/") ? [binary.root, ...rel.split("/")].join(sep) : [binary.root, ".", rel].join(sep);
}

/** The model table's directory inside the binary; undefined from source,
 *  where `core/embed/static.ts` resolves the installed package itself. */
export function bundledModelDir(binary: Binary | null = BINARY): string | undefined {
  return binary === null ? undefined : packagePath("node_modules/counterparts-model-potion", binary);
}

/** What the binary's first argument may be: the four a host runs, and the
 *  two it starts of itself (`scriptArgs`). `tools/single-binary/main.ts`
 *  dispatches on the same words. */
export const BINARY_MODES = ["hook", "mcp", "cli", "dashboard", "runner", "nightly"] as const;
export type BinaryMode = (typeof BINARY_MODES)[number];

/** Each entry script's mode, by file name — which survives the virtual paths. */
export const BINARY_MODE_OF: Readonly<Record<string, BinaryMode>> = {
  "hook.ts": "hook",
  "serve.ts": "mcp",
  "counterparts.ts": "cli",
  "dashboard.ts": "dashboard",
  "runner.ts": "runner",
  "nightly.ts": "nightly",
};

/** Does an executable's name look like the single binary? `counterparts`,
 *  `counterparts.exe`, `counterparts-0.3.14-darwin-arm64` — and not the npm
 *  shims `counterparts-hook`, `counterparts-mcp`, `counterparts-dashboard`. */
export function isBinaryName(exe: string): boolean {
  const name = exe.split(/[\\/]/).pop() ?? "";
  return /^counterparts([-.][\w.-]*)?$/i.test(name) && !/^counterparts-(hook|mcp|dashboard)(\.exe)?$/i.test(name);
}

/** An entry script's mode by its file name: the source `.ts` name, or the
 *  transpiled tree's `.js` (`BINARY_MODE_OF` keeps the source names). */
export function binaryModeOf(script: string): BinaryMode | undefined {
  return BINARY_MODE_OF[basename(script).replace(/\.js$/, ".ts")];
}

function isBinaryMode(word: string | undefined): word is BinaryMode {
  return (BINARY_MODES as readonly string[]).includes(word ?? "");
}

/** An empty `bunfig.toml`, shipped beside this file, that every Bun launch
 *  names in place of the project's own. Absolute, from this file. */
export const EMPTY_BUNFIG = fileURLToPath(new URL("./empty-bunfig.toml", import.meta.url));

/** How a Bun command names its configuration file: `--config=<path>`, ONE
 *  argument (Bun 1.3 does not read `--config <path>` as two the same way). */
export const BUN_CONFIG_PREFIX = "--config=";

/** The module Node loads before a script (`--import`). Absolute, from this file. */
export const NODE_HOOKS = fileURLToPath(new URL("./node-hooks.mjs", import.meta.url));

/** The console's own entry, for a command line that must name Node explicitly. */
export const CLI_SCRIPT = entryScript(new URL("./cli/bin/counterparts.ts", import.meta.url));

/**
 * The plugin's console by the plugin's root, as the words typed before its
 * arguments (`doctor`, `scope …`), for a line a person or a Bash call runs:
 * the launcher, `sh <root>/src/adapters/plugin-run.sh cli`, which finds a
 * runtime; or, in the plugin directory's transpiled bundle, which has no
 * launcher, the console's own entry, started by its shebang. Read off the
 * disk; a root holding neither gets the launcher's words.
 */
export function pluginConsoleWords(root: string): string[] {
  const launcher = join(root, "src", "adapters", "plugin-run.sh");
  const entry = join(root, "src", "adapters", "cli", "bin", "counterparts.js");
  if (!existsSync(launcher) && existsSync(entry)) return [entry];
  return ["sh", launcher, "cli"];
}

/** The oldest Node this has been made to run on: `module.registerHooks`
 *  (22.15 / 23.5), `stripTypeScriptTypes` and unflagged `node:sqlite` (22.13). */
export const NODE_FLOOR = "22.15";

/** The runtime this process is running under. */
export function currentRuntime(): RuntimeKind {
  return process.versions.bun === undefined ? "node" : "bun";
}

/** `bun 1.3.0`, `node 24.9.0`, or `the single binary (bun 1.3.10)` — the
 *  runtime this process is, for a reader. */
export function runtimeLabel(binary: Binary | null = BINARY): string {
  const bun = process.versions.bun;
  if (binary !== null) return `the single binary (bun ${bun ?? "?"})`;
  return bun === undefined ? `node ${process.versions.node}` : `bun ${bun}`;
}

/** The runtime an executable path names: `node`, `node24`, `node.exe` → node;
 *  anything else → bun. */
export function runtimeOf(exe: string): RuntimeKind {
  return /^node(js)?(\d[\d.]*)?(\.exe)?$/i.test(exe.split(/[\\/]/).pop() ?? "") ? "node" : "bun";
}

/** The arguments that make `exe` run `script`: `--no-env-file
 *  --config=<empty-bunfig.toml> run <script>` for Bun, `--import
 *  <node-hooks.mjs> <script>` for Node, and the script's mode alone (`hook`,
 *  `runner`, …) when `exe` is the compiled binary itself, which reads no
 *  `.env` or `bunfig.toml` (it is built with both off). */
export function scriptArgs(script: string, exe: string = process.execPath, binary: Binary | null = BINARY): string[] {
  // The compiled binary runs ITSELF in another mode: `<binary> runner`.
  const mode = binary !== null && exe === binary.self ? binaryModeOf(script) : undefined;
  if (mode !== undefined) return [mode];
  return runtimeOf(exe) === "node"
    ? ["--import", NODE_HOOKS, script]
    : [BUN_NO_ENV_FILE, `${BUN_CONFIG_PREFIX}${EMPTY_BUNFIG}`, "run", script];
}

/** A command split into its parts, when it is `<exe> <scriptArgs(script)> <rest…>`. */
export interface ScriptInvocation {
  readonly exe: string;
  /** `binary` for the single compiled binary, which is its own runtime. */
  readonly runtime: RuntimeKind | "binary";
  /** The script it runs — for the binary, the binary itself, which is the
   *  file that must be on disk for the command to run. */
  readonly script: string;
  /** The binary's mode (`hook`, `mcp`, …); absent for Bun and Node. */
  readonly mode?: BinaryMode;
  /** Whatever followed the script (`--config <path>`, flags). */
  readonly rest: readonly string[];
  /** Whether the runtime reads the project's `.env` or `bunfig.toml` into the
   *  process: `read` for a Bun command lacking `--no-env-file` or a
   *  `--config=` (written before 2026-10-09), else `ignored`. */
  readonly projectEnv: "read" | "ignored";
}

/**
 * Read `<exe> [bun flags] run [bun flags] <script> …`, `<exe> --import
 * <…node-hooks.mjs> <script> …` or `<binary> <mode> …` back out of a token
 * list — the inverse of `scriptArgs`, for the readers that must recognise what
 * the writers wrote (`wire.ts#isOurHookCommand`, doctor's runtime line, the
 * plugin's npm-wiring check). The Bun flags read are `--no-env-file` and
 * `--config=<file>`, in any order, before or after `run`. A shape missing
 * either is what installs wrote until 2026-10-09: still ours, and
 * `projectEnv: "read"`. Null for any other shape: a command this cannot read
 * is not one of ours.
 */
export function parseScriptInvocation(tokens: readonly string[]): ScriptInvocation | null {
  const exe = tokens[0] ?? "";
  if (exe.length === 0) return null;
  // `<binary> <mode> …` — what the single binary writes for itself
  // (`scriptArgs`). It reads no `.env`: it is built with the autoload off.
  if (isBinaryName(exe) && isBinaryMode(tokens[1])) {
    return { exe, runtime: "binary", script: exe, mode: tokens[1], rest: tokens.slice(2), projectEnv: "ignored" };
  }
  let at = 1;
  let noEnvFile = false;
  let ownConfig = false;
  const flags = (): void => {
    for (;;) {
      const t = tokens[at] ?? "";
      if (t === BUN_NO_ENV_FILE) noEnvFile = true;
      else if (t.startsWith(BUN_CONFIG_PREFIX) && t.length > BUN_CONFIG_PREFIX.length) ownConfig = true;
      else return;
      at += 1;
    }
  };
  flags();
  const flagged = at > 1;
  if (tokens[at] === "run") {
    at += 1;
    flags();
    const script = tokens[at] ?? "";
    if (script.length === 0) return null;
    const runtime = runtimeOf(exe);
    return {
      exe,
      runtime,
      script,
      rest: tokens.slice(at + 1),
      projectEnv: runtime === "node" || (noEnvFile && ownConfig) ? "ignored" : "read",
    };
  }
  if (flagged) return null;
  if (tokens[1] === "--import" && /(^|[/\\])node-hooks\.mjs$/.test(tokens[2] ?? "") && (tokens[3] ?? "").length > 0) {
    return { exe, runtime: "node", script: tokens[3] as string, rest: tokens.slice(4), projectEnv: "ignored" };
  }
  return null;
}

/** Is the runtime a command names actually there? An absolute path is checked
 *  on disk; a bare name (`bun`, `node`) is looked up on `PATH`. */
export function runtimePresent(exe: string, env: Record<string, string | undefined> = process.env): boolean {
  if (exe.includes("/") || exe.includes("\\")) return existsSync(exe);
  const dirs = (env["PATH"] ?? "").split(process.platform === "win32" ? ";" : ":").filter((d) => d.length > 0);
  return dirs.some((d) => existsSync(`${d}/${exe}`));
}

/** Split on whitespace, honouring double quotes — the only quoting
 *  `install.ts#shellQuote` produces, and therefore the only quoting a command
 *  we wrote can carry. A single quote is left in the token, which makes the
 *  match fail, which is the safe direction. */
export function shellTokens(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? "";
    if (ch === "\\" && quoted && i + 1 < command.length) {
      current += command[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (started || current.length > 0) out.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started || current.length > 0) out.push(current);
  return out;
}
