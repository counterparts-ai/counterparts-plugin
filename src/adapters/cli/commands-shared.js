import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Counterpart } from "../../core/counterpart.js";
import {
  DATA_DIR_ENV,
  SCHEMA_VERSION,
  Store,
  StoreError,
  dataDir,
  describeGuardRefusal,
  DATABASE_FILE,
  describePreRowsRefusal,
  isPreRowsDatabase,
  isStoreError,
  paths
} from "../../core/store/index.js";
import { defaultConfigPath } from "../config-path.js";
import { loadConfig, withEmbedderDefault, zoneBeside } from "../config.js";
import { upgradeWords } from "../hosts.js";
import { hostsSeen, installedVersion } from "../sessions.js";
export const EXIT = {
  ok: 0,
  usage: 1,
  refused: 2,
  failed: 3
};
export function requireDirFlagForBulkWrite(dir, io, flags, label, what) {
  if (typeof flags["dir"] === "string")
    return null;
  io.err(`refused: '${label}' ${what}, and will not run against a store nobody named (it would have been ${dir}). Name the store: --dir <path>.`);
  io.err("Nothing has changed.");
  return EXIT.refused;
}
export function parse(argv) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: false,
    options: {
      dir: { type: "string" },
      out: { type: "string" },
      reason: { type: "string" },
      passphrase: { type: "string" },
      plaintext: { type: "boolean" },
      markdown: { type: "boolean" },
      "include-confidential": { type: "boolean" },
      "with-versions": { type: "boolean" },
      "into-non-empty": { type: "boolean" },
      overwrite: { type: "boolean" },
      "echo-scan": { type: "string" },
      confirm: { type: "boolean" },
      name: { type: "string" },
      embedder: { type: "boolean" },
      "no-embedder": { type: "boolean" },
      force: { type: "boolean" },
      kind: { type: "string" },
      title: { type: "string" },
      salience: { type: "string" },
      id: { type: "string" },
      json: { type: "boolean" },
      full: { type: "boolean" },
      page: { type: "string" },
      mode: { type: "string" },
      voiced: { type: "boolean" },
      apply: { type: "boolean" },
      rebuild: { type: "boolean" },
      "drop-vectors": { type: "boolean" },
      "prune-index": { type: "boolean" },
      "keep-vectors": { type: "boolean" },
      batch: { type: "string" },
      yes: { type: "boolean" },
      reowe: { type: "string" },
      budget: { type: "string" },
      config: { type: "string" },
      "dry-run": { type: "boolean" },
      confidence: { type: "string" },
      "import-day": { type: "string" },
      sample: { type: "string" },
      stdin: { type: "boolean" },
      write: { type: "boolean" },
      undo: { type: "boolean" },
      to: { type: "string" },
      "upgrade-again": { type: "boolean" },
      "nothing-is-open": { type: "boolean" },
      "no-connect": { type: "boolean" },
      park: { type: "boolean" },
      "delete-memories": { type: "boolean" },
      "keep-memories": { type: "boolean" },
      port: { type: "string" },
      "no-open": { type: "boolean" },
      file: { type: "string" },
      short: { type: "string" },
      versions: { type: "boolean" },
      version: { type: "string" },
      restore: { type: "string" },
      clear: { type: "boolean" },
      "if-version": { type: "string" },
      show: { type: "string" },
      demote: { type: "string" },
      reaffirm: { type: "string" },
      pair: { type: "string" },
      holds: { type: "string" },
      against: { type: "string" },
      how: { type: "string" },
      why: { type: "string" },
      "reflected-feeling": { type: "string" },
      setting: { type: "string" },
      date: { type: "string" },
      host: { type: "string" },
      observer: { type: "boolean" },
      help: { type: "boolean" },
      on: { type: "boolean" },
      off: { type: "boolean" },
      pause: { type: "boolean" },
      resume: { type: "boolean" },
      list: { type: "boolean" },
      note: { type: "string" }
    }
  });
  return {
    command: positionals[0],
    positional: positionals.slice(1),
    flags: values
  };
}
export function resolveDir(env) {
  return dataDir(env);
}
export function prefixedRefusal(said) {
  return said.startsWith("refused:") ? said : `refused: ${said}`;
}
export function describeDirRefusal(err, dir) {
  return describeGuardRefusal(err, `Name the store: --dir <path>, or ${DATA_DIR_ENV}.`) ?? describePreRowsRefusal(err, `Name a store with --dir <path>.`) ?? preRowsInDisguise(err, dir) ?? upgradePending(err) ?? (isStoreError(err, "STORE_ROLLED_BACK") && typeof err.detail["remedy"] === "string" ? err.detail["remedy"] : null) ?? String(err.message ?? err);
}
export function upgradePending(err) {
  if (!isStoreError(err, "STORE_UNINITIALIZED"))
    return null;
  const found = Number.parseInt(String(err.detail["found"] ?? ""), 10);
  if (!Number.isFinite(found) || found < 6 || found >= SCHEMA_VERSION)
    return null;
  const path = err.detail["path"];
  const words = upgradeWords(typeof path === "string" && path.length > 0 ? hostsSeen(dirname(path)) : new Set);
  return `this store is on schema v${String(found)}; ${words.who} copies it and upgrades it ` + `to v${String(SCHEMA_VERSION)}. Nothing to do: ${words.open}, then run this again.`;
}
export function openRefusalLine(err, dir) {
  if (dir !== undefined && preRowsInDisguise(err, dir) !== null) {
    return `could not open the store: ${describeDirRefusal(err, dir)}`;
  }
  return upgradePending(err) ?? `could not open the store: ${describeDirRefusal(err, dir)}`;
}
function preRowsInDisguise(err, dir) {
  if (dir === undefined)
    return null;
  if (!isStoreError(err, "STORE_UNINITIALIZED"))
    return null;
  if (!isPreRowsDatabase(paths.operational(dir)))
    return null;
  return describePreRowsRefusal(new StoreError("STORE_PRE_ROWS", {
    dir,
    found: DATABASE_FILE,
    expected: SCHEMA_VERSION,
    reason: "no-body-column"
  }), `Name a store with --dir <path>.`);
}
export function customConfigPath(named, home) {
  return named !== undefined && named.source !== "default" && resolve(named.path) !== defaultConfigPath(home) ? named.path : undefined;
}
export function exitFor(outcome) {
  return outcome === "ok" ? EXIT.ok : outcome === "refused" ? EXIT.refused : EXIT.failed;
}
export function openCounterpart(dir, observer = false, identity, embed) {
  const snapshotsDir = observer ? undefined : snapshotsDirBeside(dir);
  const timeZone = zoneBeside(dir);
  return Counterpart.open({
    dir,
    observer,
    build: installedVersion(),
    ...timeZone === undefined ? {} : { timeZone },
    ...identity === undefined ? {} : { identity },
    ...embed === undefined ? {} : { embed },
    ...snapshotsDir === undefined ? {} : { snapshotsDir }
  });
}
export function openStoreAt(opts) {
  const timeZone = zoneBeside(opts.dir);
  return Store.open({ ...opts, ...timeZone === undefined ? {} : { timeZone } });
}
export function snapshotsDirBeside(dir) {
  const beside = join(dir, "..", "claude-code.json");
  if (!existsSync(beside))
    return;
  try {
    return loadConfig(JSON.parse(readFileSync(beside, "utf8"))).config.snapshots?.dir;
  } catch {
    return;
  }
}
export function hostConfigFor(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    const load = loadConfig(undefined);
    return { config: load.config, reason: "absent" };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { config: { observer: true }, reason: "unreadable" };
  }
  const load = loadConfig(raw);
  return {
    config: withEmbedderDefault(load.config),
    reason: load.reason,
    ...load.unreadableKeys === undefined ? {} : { unreadableKeys: load.unreadableKeys }
  };
}
