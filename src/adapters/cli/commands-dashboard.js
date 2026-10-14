import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { SCHEMA_VERSION, storeExists } from "../../core/store/index.js";
import { CONFIG_FLAG, defaultConfigPath } from "../config-path.js";
import { BIN, DEFAULT_STORE_DIR } from "./install.js";
import { tilde } from "./wire.js";
import { upgradeWords } from "../hosts.js";
import { hostsSeen } from "../sessions.js";
import { EXIT, hostConfigFor } from "./commands-shared.js";
import { storeId } from "../store-id.js";
export const DASHBOARD_DEFAULT_PORT = 4747;
export function dashboardLine(url) {
  return `Dashboard: ${url}  (Ctrl-C stops it)`;
}
export async function dashboardCommand(parsed, io, env, opts, named) {
  const home_ = opts.home ?? homedir();
  const configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);
  let dir;
  if (typeof parsed.flags["dir"] === "string") {
    dir = resolve(parsed.flags["dir"]);
  } else {
    if (!existsSync(configPath)) {
      io.err(`refused: there is no configuration at ${configPath}, so there is no store here to ` + `show. Run '${BIN.cli} install' first, name the configuration with ${CONFIG_FLAG} ` + "<absolute path>, or point this at a store yourself with --dir <path>.");
      return EXIT.refused;
    }
    const host = hostConfigFor(configPath);
    if (host.reason === "unreadable") {
      io.err(`refused: ${configPath} is there and will not be understood. This command reads ` + '"dataDir" out of it to know which store to show, and a file it cannot read is a ' + "question it will not answer by guessing. --dir <path> names one directly.");
      return EXIT.refused;
    }
    dir = host.config.dataDir ?? join(dirname(configPath), DEFAULT_STORE_DIR);
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}. Run '${BIN.cli} install' first` + `${typeof parsed.flags["dir"] === "string" ? `, or name another store with --dir` : ""}.`);
    return EXIT.failed;
  }
  const portFlag = parsed.flags["port"];
  let port;
  if (typeof portFlag === "string") {
    const n = Number(portFlag);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      io.err(`refused: --port ${portFlag} is not a port number (0–65535). Nothing was opened.`);
      return EXIT.refused;
    }
    port = n;
  }
  const seam = opts.dashboard ?? realDashboard(env);
  let running;
  try {
    const config = typeof parsed.flags["dir"] !== "string" || named !== undefined && named.source !== "default" ? configPath : undefined;
    running = await seam.start({
      dir,
      ...port === undefined ? {} : { port },
      ...config === undefined ? {} : { config }
    });
  } catch (err) {
    if (err.code === "EADDRINUSE") {
      const errPort = err.port;
      const taken = typeof errPort === "number" && errPort > 0 ? errPort : port ?? DASHBOARD_DEFAULT_PORT;
      const serving = await seam.storeAt?.(taken) ?? null;
      const ours = storeId(dir);
      if (serving !== null && ours !== null && serving === ours) {
        const url = `http://127.0.0.1:${String(taken)}`;
        io.out(`Dashboard: ${url}  (already running for this store; this command started nothing)`);
        io.out(`reading ${tilde(dir, home_)}`);
        if (parsed.flags["no-open"] !== true)
          seam.open?.(url);
        return EXIT.ok;
      }
      io.err(serving !== null ? `Port ${String(taken)} is already in use by a dashboard serving another store. ` + "Pass --port <n> to use another one." : `Port ${String(taken)} is already in use — a dashboard may ` + "already be running. Pass --port <n> to use another one.");
      return EXIT.failed;
    }
    throw err;
  }
  io.out(dashboardLine(running.url));
  io.out(`reading ${tilde(running.dir, home_)}`);
  if (running.upgradePending === true) {
    const words = upgradeWords(hostsSeen(running.dir));
    io.out(`this store is on an older schema; ${words.who} copies it and upgrades it to ` + `v${String(SCHEMA_VERSION)}. The page says so until then; reload it after.`);
  }
  if (parsed.flags["no-open"] !== true)
    seam.open?.(running.url);
  await (seam.until ?? untilInterrupted)();
  await running.stop();
  return EXIT.ok;
}
function realDashboard(env) {
  return {
    async start(o) {
      const { startDashboard } = await import("../dashboard/web/server.js");
      const up = await startDashboard({
        dir: o.dir,
        ...o.port === undefined ? {} : { port: o.port },
        ...o.config === undefined ? {} : { config: o.config }
      });
      return { url: up.url, dir: up.dir, upgradePending: up.upgradePending, stop: () => up.stop() };
    },
    open(url) {
      openInBrowser(url, env);
    },
    until: untilInterrupted,
    async storeAt(port) {
      const { dashboardStoreAt } = await import("../dashboard/web/probe.js");
      return dashboardStoreAt(port);
    }
  };
}
function openInBrowser(url, env) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
  if (opener === null)
    return;
  try {
    const child = spawn(opener, [url], {
      detached: true,
      stdio: "ignore",
      env
    });
    child.on("error", () => {});
    child.unref();
  } catch {}
}
function untilInterrupted() {
  return new Promise((done) => {
    process.once("SIGINT", () => {
      done();
    });
    process.once("SIGTERM", () => {
      done();
    });
  });
}
