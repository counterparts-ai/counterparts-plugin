/**
 * THE BASE DIRECTORY OF AN INSTALL, KEPT PRIVATE (2026-10-27, R1; moved out
 * of the core in the review of #657, narrowed in its re-checks).
 *
 * The core tightens only the store it opens (`core/store/private.ts`). The
 * directory around it holds the configuration and the files this package
 * writes beside it, and only an adapter can say which those are: here, from
 * the configuration this process loaded, which names `<that directory>/store`
 * as its store. A store dir that merely happens to be called `store` proves
 * nothing, and its parent is left alone.
 *
 * ONLY OUR NAMES, NEVER THE DIRECTORY'S OTHER ENTRIES: `install --config
 * ~/counterparts.json` makes `$HOME` the base, and a config in a project
 * directory makes the project the base. What is tightened is the list
 * `uninstall` reads too (`owned-names.ts#ownedKind`): the configuration and
 * its backups and temp siblings, `scopes.json`, the sidebar's files, the npm
 * marker, `store/` and `snapshots/` with their parked, blank and new siblings,
 * `rollback`'s set-aside stores, and a `debug/` of night transcripts; plus a
 * legacy `credentials.env`. Directories go whole, symbolic links are skipped.
 * In a home or a project base a file of somebody else's that happens to carry
 * one of those names is tightened too; that is the one collision left, and
 * the names are specific enough that it should not happen.
 *
 * The directory ITSELF is made `0700` only when it holds nothing but ours and
 * is not the home directory or above it, not writable by others, not sticky
 * or setgid, and owned by this account (`core/store/private.ts#closableDir`):
 * the default `~/.counterparts` is closed, a home or a project never is. A
 * base that is a symbolic link (`~/.counterparts` -> somewhere else) is read
 * and closed where it really is, on the same rules, the home compared by its
 * real path too.
 *
 * A CONFIGURED SNAPSHOTS DIRECTORY IS THE OWNER'S PLACE (round 4 of #657):
 * `snapshots.dir` set to `$HOME` or `~/Documents` is not a tree of ours, in
 * this base or anywhere else. Only `<base>/snapshots`, the one this package
 * makes, goes whole; any other is read by the core's rule
 * (`core/store/private.ts#snapshotsDirRoots`, the one a writer's open
 * applies): the snapshot-named entries whole, the directory itself only when
 * it is ours to close, nothing at all in a place snapshots are refused.
 *
 * Run by the session-start hook and by `connect` (the upgrade path); best-
 * effort and silent, gated by a few stats, never on Windows. `doctor`'s
 * Privacy line reads the same set (`installBaseRoots`).
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  DATABASE_FILE,
  DEFAULT_STORE_SUBDIR,
  closableDir,
  defaultSnapshotsDir,
  realRoot,
  rootsNeedTightening,
  storeRoots,
  tightenRoots,
} from "../core/store/index.js";
import type { Chmod, PrivateRoots, TightenReport } from "../core/store/index.js";
import { loadConfig } from "./config.js";
import { ownedKind, ownedNames } from "./owned-names.js";

export { SIDEBAR_NAMES } from "./owned-names.js";

/** The old credentials file's name (`cli/install.ts#LEGACY_CREDENTIALS_FILE`),
 *  spelled here so this leaf does not import the console. `uninstall` leaves
 *  it (a file the person may want), but it is ours to make private. */
const LEGACY_CREDENTIALS = "credentials.env";

export interface BasePaths {
  /** The base, by its real path. */
  readonly base: string;
  /** The base directory itself, when it is ours to close (see the header). */
  readonly baseIsOurs: boolean;
  /** Our entries in it that are there: files alone, directories whole. */
  readonly files: readonly string[];
  readonly trees: readonly string[];
  /** `snapshots.dir`, by its real path, when the configuration names one
   *  other than `<base>/snapshots`: read by the core's rule, wherever it is. */
  readonly snapshotsDir: string | null;
}

/** `snapshots.dir` as every entry point reads it (`config.ts#loadConfig`);
 *  absent when it names none or the file cannot be read. */
export function configuredSnapshots(configPath: string): string | undefined {
  try {
    return loadConfig(JSON.parse(readFileSync(configPath, "utf8"))).config.snapshots?.dir;
  } catch {
    return undefined;
  }
}

/** `snapshots.mirror`, the same way; never tightened (R8), only named by doctor. */
export function configuredMirror(configPath: string): string | undefined {
  try {
    const m = loadConfig(JSON.parse(readFileSync(configPath, "utf8"))).config.snapshots?.mirror;
    return m === undefined || m.trim().length === 0 ? undefined : m;
  } catch {
    return undefined;
  }
}

/** Our paths in an install's base, or null when `storeDir` is not
 *  `<dirname(configPath)>/store` with that configuration in place. */
export function installBasePaths(configPath: string, storeDir: string, home: string = homedir()): BasePaths | null {
  if (!existsSync(configPath)) return null;
  const base = realRoot(dirname(resolve(configPath)));
  const store = join(base, DEFAULT_STORE_SUBDIR);
  if (realRoot(store) !== realRoot(storeDir)) return null;
  // The configured snapshots dir, unless it is the one this package makes.
  const configured = configuredSnapshots(configPath);
  const ownDefault = defaultSnapshotsDir(store);
  const snapshotsDir =
    configured === undefined || (ownDefault !== null && realRoot(configured) === realRoot(ownDefault))
      ? null
      : realRoot(configured);
  const owned = ownedNames(
    join(base, basename(configPath)),
    snapshotsDir === null ? {} : { snapshots: { dir: snapshotsDir } },
    store,
  );
  let names: string[] = [];
  try {
    names = readdirSync(base);
  } catch {
    return null;
  }
  const files: string[] = [];
  const trees: string[] = [];
  let foreign = 0;
  for (const name of names) {
    const kind = ownedKind(name, owned, base);
    if (kind === null && name !== LEGACY_CREDENTIALS) {
      foreign += 1;
      continue;
    }
    const path = join(base, name);
    try {
      const st = lstatSync(path);
      if (st.isSymbolicLink()) continue;
      (st.isDirectory() ? trees : files).push(path);
    } catch {
      continue;
    }
  }
  return { base, baseIsOurs: foreign === 0 && closableDir(base, home), files, trees, snapshotsDir };
}

/** The same set as roots for `tightenRoots`: the base's, and the core's own
 *  (the store by its real path, ours in a configured snapshots dir), so
 *  `connect` and `doctor` cover what a writer's open does. */
export function installBaseRoots(configPath: string, storeDir: string, home: string = homedir()): PrivateRoots | null {
  const p = installBasePaths(configPath, storeDir, home);
  if (p === null) return null;
  const store = join(p.base, DEFAULT_STORE_SUBDIR);
  const core = storeRoots(store, p.snapshotsDir, home);
  const only = [...(p.baseIsOurs ? [p.base] : []), ...p.files, ...(core.only ?? [])];
  const recursive = [...core.recursive, ...p.trees.filter((t) => t !== store)];
  return { only: [...new Set(only)], recursive: [...new Set(recursive)] };
}

/** Tighten an install's base, when it is one. Null when there was nothing to do. */
export function tightenInstallBase(
  configPath: string,
  storeDir: string,
  opts: { chmod?: Chmod; platform?: string; home?: string } = {},
): TightenReport | null {
  try {
    if ((opts.platform ?? process.platform) === "win32") return null;
    const roots = installBaseRoots(configPath, storeDir, opts.home);
    if (roots === null || !rootsNeedTightening(roots, [join(realRoot(storeDir), DATABASE_FILE)])) return null;
    return tightenRoots(roots, opts.chmod);
  } catch {
    return null;
  }
}
