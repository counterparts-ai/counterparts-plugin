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
import { existsSync, readFileSync, realpathSync } from "node:fs";
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
 * Does this build read Claude Code's user configuration, `~/.claude.json`
 * (`$CLAUDE_CONFIG_DIR/.claude.json`)? Yes everywhere but the transpiled tree,
 * the plugin directory's bundle (2026-10-14, owner's decision): there nothing
 * opens that file. What that build gives up, every reader gated on this says:
 * the plugin cannot read the npm install's wiring to stand down beside it (it
 * stands down by the npm install's own marker instead, since 2026-10-15:
 * `npm-live.ts`, docs/plugin.md), doctor has
 * no MCP-registration line and no Desktop Code-tab clash, and an uninstall
 * that may delete or move the store has only `claude mcp remove`'s word that a
 * `-s user` registration is gone (with no `claude`, it says the line to run and
 * does not count it gone; one that keeps the store removes it only when no
 * npm install's `counterparts` is on PATH, `wire.ts#leftWhy`). The
 * stand-down check (`host-wiring.ts#npmWiring`) reads nothing at all in this
 * build, the settings files' hooks included; doctor, connect and uninstall
 * still read the settings files, and `plugins/installed_plugins.json` is
 * still read. `transpiled` is a test's seam.
 */
export function readsHostUserConfig(transpiled: boolean = TRANSPILED): boolean {
  return !transpiled;
}

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

/**
 * The package version the single binary was BUILT from, handed in by its
 * entry (`tools/single-binary/main.ts`) before any mode runs; null from source.
 * `cli/commands.ts#packageVersion` reads the embedded `package.json` first and
 * this only when that fails, which it does on Windows: Bun lists the file as
 * `B:/~BUN/root/./package.json` and then answers ENOENT for that very name
 * (W1, 2026-11-09, CI's windows-x64 selfcheck).
 */
let builtVersion: string | null = null;
export function setBuiltVersion(version: string): void {
  builtVersion = version;
}
export function builtVersionOf(): string | null {
  return builtVersion;
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
export function scriptArgs(
  script: string,
  exe: string = process.execPath,
  binary: Binary | null = BINARY,
  platform: string = process.platform,
): string[] {
  // The compiled binary runs ITSELF in another mode: `<binary> runner`.
  const mode = binary !== null && exe === binary.self ? binaryModeOf(script) : undefined;
  if (mode !== undefined) return [mode];
  return runtimeOf(exe) === "node"
    ? ["--import", platform === "win32" ? windowsFileUrl(NODE_HOOKS) : NODE_HOOKS, script]
    : [BUN_NO_ENV_FILE, `${BUN_CONFIG_PREFIX}${EMPTY_BUNFIG}`, "run", script];
}

// ── Windows (W1, 2026-11-09) ─────────────────────────────────────────────────
//
// Claude Code on native Windows runs a hook's command string in Git Bash when
// Git for Windows is installed, else in PowerShell (code.claude.com/docs/en/hooks,
// "How shell-form commands are run"), and spawns an MCP server's `command` with
// its `args` directly. So what `connect` writes there has to read the same in
// both shells, which is what these do (`claude-code/NOTES.md`, "Windows"):
//
//   - `--import` takes a module SPECIFIER, and Node reads `C:\…\node-hooks.mjs`
//     as a URL with the scheme `c:` (ERR_UNSUPPORTED_ESM_URL_SCHEME). On win32
//     it is given as a `file:///C:/…` URL; POSIX keeps the plain path every
//     existing hook line carries.
//   - Paths are written with `/`: Windows takes them, and neither shell then
//     has a backslash to read as an escape.
//   - The runtime is written by its bare NAME (`node`) when that name on PATH
//     is the very executable running now. PowerShell will not run a quoted
//     first word without `&` (which bash refuses), and the default Node lives
//     in `C:/Program Files/…`, which needs quotes. On Windows a host's PATH is
//     the one the person set for their account, not a login shell's, so scar
//     §2.18 (the host's PATH is not the shell's) is not the hazard it is on
//     macOS. When the name finds another file (links followed; a version
//     manager's shim is another file), the path is written in the form the
//     shell Claude Code uses there runs (`windowsHookWord`), and `connect` and
//     doctor say it runs in that shell only.

/** A Windows path as a `file:` URL, by hand, so it is the same on every host
 *  (a test runs it on macOS): `C:\a b\x.mjs` → `file:///C:/a%20b/x.mjs`. */
export function windowsFileUrl(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const rooted = slashed.startsWith("/") ? slashed : `/${slashed}`;
  return `file://${encodeURI(rooted).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
}

/** A path as a host command on `platform` names it: `/`-separated on win32,
 *  unchanged elsewhere. */
export function hostPath(path: string, platform: string = process.platform): string {
  return platform === "win32" ? path.replace(/\\/g, "/") : path;
}

/** Where a bare command name resolves on `PATH` — trying each `PATHEXT`
 *  extension on win32, where `node` is `node.exe` on disk — or null. */
export function whichOnPath(
  name: string,
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const win = platform === "win32";
  // Windows spells it `Path`, and a copy of `process.env` is no longer
  // case-blind about it.
  const key = (wanted: string): string | undefined =>
    env[wanted] ?? (win ? Object.entries(env).find(([k]) => k.toUpperCase() === wanted)?.[1] : undefined);
  const dirs = (key("PATH") ?? "").split(win ? ";" : ":").filter((d) => d.length > 0);
  // On win32 only the PATHEXT spellings, unless the name carries its own: npm
  // puts an extensionless sh script beside every `x.cmd` (for Git Bash), and
  // Windows can't start that file (CI 11-09: `claude` was found as it and
  // read as missing).
  const exts = win
    ? /\.[A-Za-z0-9]+$/.test(name)
      ? [""]
      : (key("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((e) => e.length > 0).map((e) => e.toLowerCase())
    : [""];
  for (const d of dirs) {
    for (const ext of exts) {
      const candidate = `${d.replace(/[\\/]+$/, "")}${win ? "\\" : "/"}${name}${ext}`;
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * HOW TO START A COMMAND BY NAME ON WINDOWS, with its arguments kept one each:
 * the file to spawn and the arguments to give it, or null when the name is not
 * on PATH or is something this cannot start without a shell.
 *
 * A native `.exe` is spawned as it is. An npm-installed command is a `.cmd`
 * batch file (`claude.cmd` for an npm install of Claude Code), which Node will
 * not spawn without a shell (EINVAL since 20.12), and a shell would re-read
 * every argument — a night child's `--mcp-config` JSON, its system prompt.
 * npm writes those files one way (`cmd-shim`): the target is the quoted
 * `"%dp0%\…"` path, run by the program the target's shebang named. So the
 * target is read out of the file: an `.exe` is spawned directly, a script is
 * given to `node` (the one on PATH, as the shim does). W1, 2026-11-09.
 */
export function windowsLaunch(
  name: string,
  args: readonly string[],
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
  read: (path: string) => string = (p) => readFileSync(p, "utf8"),
): { file: string; args: string[] } | null {
  const found = whichOnPath(name, env, "win32", exists);
  if (found === null) return null;
  if (!/\.(cmd|bat)$/i.test(found)) return { file: found, args: [...args] };
  let text: string;
  try {
    text = read(found);
  } catch {
    return null;
  }
  // The LAST quoted `%dp0%` path: a Node bin's shim names `"%dp0%\node.exe"`
  // first (`IF EXIST …`), its target last (measured on Claude Code's, CI 11-09).
  // Older npm and pnpm spell the directory `%~dp0` (read-cmd-shim reads both).
  const target = [...text.matchAll(/"%(?:dp0%|~dp0)\\([^"]+)"/g)].pop()?.[1];
  if (target === undefined) return null;
  const dir = found.replace(/[\\/][^\\/]*$/, "");
  const file = `${dir}\\${target}`;
  if (!exists(file)) return null;
  if (/\.exe$/i.test(file)) return { file, args: [...args] };
  if (!/\.(c|m)?js$/i.test(file)) return null;
  const node = whichOnPath("node", env, "win32", exists);
  return node === null ? null : { file: node, args: [file, ...args] };
}

/** A path with links resolved (`realpathSync.native`), or as given when it
 *  can't be. */
function realOrSelf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** The runtime as a host command on `platform` names it: on win32 its bare
 *  name when that name on PATH resolves (links followed) to this very file,
 *  else its `/` path; the path unchanged elsewhere. Under a version manager
 *  (Volta, nvm-windows) `node` on PATH is the manager's shim, another file:
 *  then the path, which `windowsHookWord` writes so a shell can run it. */
export function hostExe(
  exe: string,
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
  real: (path: string) => string = realOrSelf,
): string {
  if (platform !== "win32") return exe;
  const name = (exe.split(/[\\/]/).pop() ?? "").replace(/\.exe$/i, "");
  const same = (a: string, b: string): boolean =>
    hostPath(real(a), "win32").toLowerCase() === hostPath(real(b), "win32").toLowerCase();
  if (/^[A-Za-z0-9_-]+$/.test(name)) {
    const found = whichOnPath(name, env, platform, exists);
    if (found !== null && same(found, exe)) return name;
  }
  return hostPath(exe, platform);
}

/**
 * Does Claude Code on this Windows machine have Git Bash to run hooks in? The
 * lookup its docs give (code.claude.com/docs/en/troubleshoot-install):
 * `CLAUDE_CODE_GIT_BASH_PATH`, then `C:\Program Files\Git` and its `(x86)`
 * twin, then the Git for Windows that `git` on PATH belongs to.
 */
export function gitBashOnWindows(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): boolean {
  const named = (env["CLAUDE_CODE_GIT_BASH_PATH"] ?? "").trim();
  if (named.length > 0 && exists(named)) return true;
  if (exists("C:\\Program Files\\Git\\bin\\bash.exe") || exists("C:\\Program Files (x86)\\Git\\bin\\bash.exe")) return true;
  const git = whichOnPath("git", env, "win32", exists);
  // `…\Git\cmd\git.exe` (or `…\Git\bin\git.exe`): Git Bash is `…\Git\bin\bash.exe`.
  return git !== null && exists(`${git.replace(/[\\/][^\\/]+[\\/][^\\/]+$/, "")}\\bin\\bash.exe`);
}

/**
 * THE FIRST WORD OF A WINDOWS HOOK LINE, and whether it runs in both shells
 * Claude Code may use there (Git Bash, else PowerShell):
 *
 *   - `name`: `node` by name. Both run it.
 *   - `plain`: a `/` path with no space or shell character, unquoted. Both.
 *   - `bash`: a path that needs quotes, quoted, with Git Bash present: bash
 *     runs it; PowerShell would read a quoted first word as a string.
 *   - `powershell`: the same with no Git Bash: `& "path"`, PowerShell's call
 *     operator, which bash refuses. (`shellTokens` reads the `&` away.)
 *
 * The last two are written for the shell present at `connect`; installing or
 * removing Git for Windows afterwards breaks them, which `connect` and doctor
 * say (`windowsHookFit`).
 */
export type WindowsHookForm = "name" | "plain" | "bash" | "powershell";
export function windowsHookWord(
  command: string,
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): { word: string; form: WindowsHookForm } {
  if (/^[A-Za-z0-9_-]+$/.test(command)) return { word: command, form: "name" };
  if (/^[A-Za-z0-9_.:/+-]+$/.test(command)) return { word: command, form: "plain" };
  const quoted = `"${command}"`;
  return gitBashOnWindows(env, exists) ? { word: quoted, form: "bash" } : { word: `& ${quoted}`, form: "powershell" };
}

/** What a person is told when a Windows hook line names its runtime by a path
 *  only one shell runs (`windowsHookWord`); null when both run it. */
export function windowsHookFit(form: WindowsHookForm, exe: string): string | null {
  if (form === "name" || form === "plain") return null;
  const shell = form === "bash" ? "Git Bash" : "PowerShell";
  return `the hooks name Node by its path (${exe}), because \`node\` on PATH is another file (a version manager's shim, or another Node); that line runs in ${shell} only, the shell Claude Code uses on this machine now. If Git for Windows is installed or removed later, run counterparts connect again. To make it run in both, put this Node first on PATH and connect again.`;
}

/** What a host is told to run for `script`: the command and its arguments,
 *  for the platform (`hostExe`, `hostPath`, `scriptArgs`). Every writer of a
 *  hook line or an MCP registration goes through this, and every reader that
 *  checks one against what it should be. */
export function hostInvocation(
  script: string,
  exe: string = process.execPath,
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): { command: string; args: string[] } {
  const args = scriptArgs(script, exe, BINARY, platform).map((a) => hostPath(a, platform));
  return { command: hostExe(exe, platform, env, exists), args };
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
export function runtimePresent(
  exe: string,
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): boolean {
  if (exe.includes("/") || exe.includes("\\")) return existsSync(exe);
  // On win32 a bare `node` is `node.exe` on disk (`PATHEXT`).
  return whichOnPath(exe, env, platform) !== null;
}

/** Split on whitespace, honouring double quotes — the only quoting
 *  `install.ts#shellQuote` produces, and therefore the only quoting a command
 *  we wrote can carry. A single quote is left in the token, which makes the
 *  match fail, which is the safe direction.
 *
 *  Inside the quotes a backslash escapes only what it escapes there in bash —
 *  `"`, `\`, `$` and a backtick — and is otherwise itself (2026-11-09, W1): a
 *  hand-typed Windows line, `"C:\Users\me\counterparts.exe" hook`, keeps its
 *  backslashes, and everything `shellQuote` writes reads back as before. */
export function shellTokens(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? "";
    if (ch === "\\" && quoted && i + 1 < command.length && '"\\$`'.includes(command[i + 1] ?? "")) {
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
  // A leading lone `&` is PowerShell's call operator, which a Windows hook line
  // carries before a quoted runtime when there is no Git Bash
  // (`windowsHookWord`): the command is what follows it. No bash line begins so.
  if (out[0] === "&" && out.length > 1) out.shift();
  return out;
}
