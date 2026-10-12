/** `dashboard`: the seam it is started through, and the command (moved out of `commands.ts`, 2026-10-11). */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { SCHEMA_VERSION, storeExists } from "../../core/store/index.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import { CONFIG_FLAG, defaultConfigPath } from "../config-path.js";
import type { ConfigChoice } from "../config-path.js";
import { BIN, DEFAULT_STORE_DIR } from "./install.js";
// A's two modules: the host's files, and leaving. They import nothing from here
// but the `Io` type, so this direction is one-way.
import { tilde } from "./wire.js";
import { upgradeWords } from "../hosts.js";
import { hostsSeen } from "../sessions.js";
import { EXIT, hostConfigFor } from "./commands-shared.js";
import type { Parsed, Io, RunOptions } from "./commands-shared.js";

// ── dashboard ───────────────────────────────────────────────────────────────

/**
 * `counterparts dashboard` — the owner's window, on the store this machine is
 * already using.
 *
 * `counterparts-dashboard serve` has existed since 2026-09-04 and REFUSES until
 * somebody names a store, for a reason that is still right: `serve` with no
 * `--dir` would have put the default store — the owner's live memory, every
 * element of it — on a socket because a flag was forgotten. That refusal is a
 * guard on a command whose author could not know which store was meant.
 *
 * This command knows. It reads the CONFIGURATION, the same file the hooks and
 * the memory tools open, so the question `serve` refuses to guess at has already
 * been answered on this machine by an install. `--dir` still names another, and
 * `--config` names another configuration; what is gone is the case where nobody
 * said anything at all.
 *
 * The server itself is not duplicated: `web/server.ts` is imported and started,
 * and everything it already guarantees — 127.0.0.1 only, a Host-header
 * allowlist, observer by construction — holds unchanged.
 */

/** A dashboard that is up, as this console needs to see it. */
export interface RunningView {
  readonly url: string;
  /** The store it opened, resolved — printed, so it is never a guess. */
  readonly dir: string;
  /** The store waits for its one-time upgrade; the page says so, and so does this. */
  readonly upgradePending?: boolean;
  stop(): Promise<void>;
}

/**
 * THE WEB VIEW AS A SEAM, for the reason `spawner` and `processes` are seams
 * one screen up: a test that drove the real one would bind a real port on the
 * machine running the suite, and a suite that binds ports fails in CI, in
 * parallel with itself, and on a developer who happens to have 4747 open.
 *
 * Real runs pass nothing and get `realDashboard()`, which imports the server
 * module lazily — so a console that never types this word never pulls the HTTP
 * server into its module graph at all. (Said that way on purpose:
 * `test/cli.test.ts` greps this whole directory for the names of the network
 * modules, and the one file in this package that may open a socket is the
 * dashboard's own server, named in `test/claude-code.test.ts`.)
 */
export interface DashboardSeam {
  start(opts: { readonly dir: string; readonly port?: number; readonly config?: string }): Promise<RunningView>;
  /** Open the person's browser. Never throws: a machine with no opener, or a
   *  desktop that refuses, is not a reason for the dashboard to fail. */
  open?(url: string): void;
  /** Resolves when the person stops it. Ctrl-C, in a real run. */
  until?(): Promise<void>;
}

/** The default port, restated rather than imported: naming it here costs one
 *  number and keeps `web/server.ts` out of the module graph of a console that
 *  is not serving anything. `test/cli.test.ts` holds the two to each other. */
export const DASHBOARD_DEFAULT_PORT = 4747;

/** The ONE line the owner asked for (2026-09-22, item 4). */
export function dashboardLine(url: string): string {
  return `Dashboard: ${url}  (Ctrl-C stops it)`;
}

export async function dashboardCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
): Promise<number> {
  const home_ = opts.home ?? homedir();
  const configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);

  // WHICH STORE — `--dir` if it was named, else the one the configuration names.
  let dir: string;
  if (typeof parsed.flags["dir"] === "string") {
    dir = resolve(parsed.flags["dir"]);
  } else {
    if (!existsSync(configPath)) {
      io.err(
        `refused: there is no configuration at ${configPath}, so there is no store here to ` +
          `show. Run '${BIN.cli} install' first, name the configuration with ${CONFIG_FLAG} ` +
          "<absolute path>, or point this at a store yourself with --dir <path>.",
      );
      return EXIT.refused;
    }
    const host = hostConfigFor(configPath);
    if (host.reason === "unreadable") {
      io.err(
        `refused: ${configPath} is there and will not be understood. This command reads ` +
          '"dataDir" out of it to know which store to show, and a file it cannot read is a ' +
          "question it will not answer by guessing. --dir <path> names one directly.",
      );
      return EXIT.refused;
    }
    dir = host.config.dataDir ?? join(dirname(configPath), DEFAULT_STORE_DIR);
  }

  if (!storeExists(dir)) {
    io.err(
      `no store at ${dir}. Run '${BIN.cli} install' first` +
        `${typeof parsed.flags["dir"] === "string" ? `, or name another store with --dir` : ""}.`,
    );
    return EXIT.failed;
  }

  // A PORT THAT IS NOT A PORT IS A REFUSAL, not a silent fall back to 4747: a
  // person who typed one meant it, and a dashboard that ignored it and came up
  // somewhere else is the `--dirr` silence in a smaller key.
  const portFlag = parsed.flags["port"];
  let port: number | undefined;
  if (typeof portFlag === "string") {
    const n = Number(portFlag);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      io.err(`refused: --port ${portFlag} is not a port number (0–65535). Nothing was opened.`);
      return EXIT.refused;
    }
    port = n;
  }

  const seam = opts.dashboard ?? realDashboard(env);
  let running: RunningView;
  try {
    // THE CONFIGURATION rides along for the dashboard's management actions
    // (`scope` and `rebrief` read one) — when this command resolved the store
    // through it, or when one was named outright. A bare `--dir` names a store
    // and no configuration, and the dashboard then offers no `scope`.
    const config =
      typeof parsed.flags["dir"] !== "string" || (named !== undefined && named.source !== "default")
        ? configPath
        : undefined;
    running = await seam.start({
      dir,
      ...(port === undefined ? {} : { port }),
      ...(config === undefined ? {} : { config }),
    });
  } catch (err) {
    if ((err as { code?: string }).code === "EADDRINUSE") {
      io.err(
        `Port ${String(port ?? DASHBOARD_DEFAULT_PORT)} is already in use — a dashboard may ` +
          "already be running. Pass --port <n> to use another one.",
      );
      return EXIT.failed;
    }
    throw err;
  }

  io.out(dashboardLine(running.url));
  // WHICH STORE IS ON THAT SOCKET, said out loud, every time. It is the sentence
  // `serve` has printed since the day it was written, and the reason has not
  // changed: a whole memory is being served, and "which one" must never be a
  // guess (constitution 16).
  io.out(`reading ${tilde(running.dir, home_)}`);
  if (running.upgradePending === true) {
    const words = upgradeWords(hostsSeen(running.dir));
    io.out(
      `this store is on an older schema; ${words.who} copies it and upgrades it to ` +
        `v${String(SCHEMA_VERSION)}. The page says so until then; reload it after.`,
    );
  }
  if (parsed.flags["no-open"] !== true) seam.open?.(running.url);

  await (seam.until ?? untilInterrupted)();
  await running.stop();
  return EXIT.ok;
}

/**
 * The real seam: the server module, loaded only now, and the platform's own
 * "open this" program.
 */
function realDashboard(env: Record<string, string | undefined>): DashboardSeam {
  return {
    async start(o): Promise<RunningView> {
      // LAZY, and the laziness is the point: a `counterparts status` must not
      // pull an HTTP server into its module graph to print a table.
      const { startDashboard } = await import("../dashboard/web/server.js");
      const up = await startDashboard({
        dir: o.dir,
        ...(o.port === undefined ? {} : { port: o.port }),
        ...(o.config === undefined ? {} : { config: o.config }),
      });
      return { url: up.url, dir: up.dir, upgradePending: up.upgradePending, stop: (): Promise<void> => up.stop() };
    },
    open(url: string): void {
      openInBrowser(url, env);
    },
    until: untilInterrupted,
  };
}

/**
 * Hand the address to the desktop, and NEVER FAIL BECAUSE OF IT.
 *
 * Detached and with its streams closed, so the opener's own chatter cannot land
 * in the middle of the dashboard's output and a browser that outlives this
 * process does not hold it open. Every failure — no such program, a headless
 * box, a sandbox that refuses to spawn — is silent: the address is already on
 * the screen, and a person who can read it can paste it.
 */
function openInBrowser(url: string, env: Record<string, string | undefined>): void {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
  if (opener === null) return;
  try {
    const child = spawn(opener, [url], {
      detached: true,
      stdio: "ignore",
      env: env as NodeJS.ProcessEnv,
    });
    // An ENOENT arrives as an EVENT, not as a throw, and an unhandled 'error'
    // on a child process takes the whole console down with it.
    child.on("error", () => {
      /* no opener on this machine; the address is on the screen */
    });
    child.unref();
  } catch {
    /* likewise — this is a courtesy, not a step */
  }
}

/** Until Ctrl-C. `once` rather than `on`, so a second interrupt kills the
 *  process the way an impatient person expects it to. */
function untilInterrupted(): Promise<void> {
  return new Promise<void>((done) => {
    process.once("SIGINT", () => {
      done();
    });
    process.once("SIGTERM", () => {
      done();
    });
  });
}
