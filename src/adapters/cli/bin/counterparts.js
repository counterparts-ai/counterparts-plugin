#!/usr/bin/env -S bun --no-env-file --config=/dev/null --no-install
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BINARY, TRANSPILED } from "../../runtime.js";
import { npmWiring } from "../../host-wiring.js";
import { PACKAGE_ROOT, PLUGIN_ROOT_ENV, npmDoctorCommand, pluginDoctorLine, pluginOrigin, runningAsPlugin } from "../../plugin.js";
import { run } from "../commands.js";
import { echoPrompt, hiddenPrompt } from "../ui.js";
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
const ask = echoPrompt(process.stdin, process.stdout);
function doctorFromStoodDownPlugin() {
  if (process.argv[2] !== "doctor" || !runningAsPlugin(process.env))
    return null;
  const home = homedir();
  const cwd = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
  const wiring = npmWiring({ home, env: process.env, cwd });
  const line = pluginDoctorLine(wiring, home, pluginOrigin({ home, env: process.env, cwd }));
  if (line === null)
    return null;
  process.stdout.write(`${line}

`);
  const env = { ...process.env };
  delete env["CLAUDE_PLUGIN_ROOT"];
  const wired = npmDoctorCommand(wiring);
  const r = wired !== null ? spawnSync(wired.exe, [...wired.args], { stdio: "inherit", env }) : spawnSync("counterparts", process.argv.slice(2), { stdio: "inherit", env });
  if (r.error !== undefined) {
    process.stdout.write("The npm install's `counterparts` is not on this PATH. Run `counterparts doctor` in a terminal.\n");
    return 0;
  }
  return r.status ?? 0;
}
async function main() {
  const redirected = doctorFromStoodDownPlugin();
  if (redirected !== null)
    return redirected;
  return run(process.argv.slice(2), {
    io: {
      out: (line) => {
        process.stdout.write(`${line}
`);
      },
      err: (line) => {
        process.stderr.write(`${line}
`);
      },
      ...process.stdin.isTTY ? { prompt: ask } : {},
      promptHidden: hiddenPrompt(process.stdin, process.stdout),
      tty: {
        stdin: process.stdin.isTTY === true,
        stdout: process.stdout.isTTY === true,
        ...typeof process.stdout.columns === "number" ? { columns: process.stdout.columns } : {}
      }
    },
    stdin: { isTty: process.stdin.isTTY === true, read: readStdin }
  });
}
export function isEntryPoint(argv1, url, binary = BINARY) {
  if (argv1 === undefined || binary !== null)
    return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}
export function start() {
  if (TRANSPILED)
    process.env[PLUGIN_ROOT_ENV] = realpathSync(PACKAGE_ROOT);
  main().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${String(err.message ?? err)}
`);
    process.exit(3);
  });
}
if (isEntryPoint(process.argv[1], import.meta.url))
  start();
