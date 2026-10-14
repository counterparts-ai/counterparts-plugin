import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  DATABASE_FILE,
  LAYOUT,
  vacuumInto,
  assertSafeDataDir,
  forbiddenRoots,
  isWithin,
  paths
} from "../../core/store/index.js";
function realOf(path, what) {
  const full = resolve(path);
  const tail = [];
  let at = full;
  for (;; ) {
    let entry;
    try {
      entry = lstatSync(at);
    } catch {
      const up = dirname(at);
      if (up === at)
        return full;
      tail.unshift(basename(at));
      at = up;
      continue;
    }
    if (entry.isSymbolicLink() && !existsSync(at)) {
      throw new Error(`refusing a ${what} that is a dangling symlink: ${at} points at something that does not exist`);
    }
    try {
      return join(realpathSync(at), ...tail);
    } catch {
      return full;
    }
  }
}
export function assertSafeTarget(dataDir, target) {
  assertSafeDataDir(target);
  const resolvedTarget = realOf(target, "destination");
  const resolvedSource = realOf(dataDir, "store");
  assertSafeDataDir(resolvedTarget);
  for (const root of forbiddenRoots()) {
    if (isWithin(realOf(root, "store"), resolvedTarget)) {
      throw new Error(`refusing a destination inside ${root}: ${resolvedTarget}`);
    }
  }
  if (isWithin(resolvedSource, resolvedTarget)) {
    throw new Error(`refusing to write a copy inside the store it is copying: ${resolvedTarget}`);
  }
  if (isWithin(resolvedTarget, resolvedSource)) {
    throw new Error(`refusing a destination that contains the store: ${resolvedTarget}`);
  }
  return resolve(target);
}
function copyTree(from, to) {
  if (!existsSync(from))
    return 0;
  const stat = statSync(from);
  if (!stat.isDirectory()) {
    mkdirSync(join(to, ".."), { recursive: true });
    copyFileSync(from, to);
    return 1;
  }
  mkdirSync(to, { recursive: true });
  let files = 0;
  for (const name of readdirSync(from)) {
    files += copyTree(join(from, name), join(to, name));
  }
  return files;
}
export function snapshot(store, target) {
  const copied = [];
  const excluded = [];
  const errors = [];
  let resolvedTarget;
  try {
    resolvedTarget = assertSafeTarget(store.dir, target);
    store.assertLayout();
    mkdirSync(resolvedTarget, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      target,
      copied: [],
      excluded: [],
      errors: [String(err.message ?? err)]
    };
  }
  const backupSet = new Set(store.backupSet());
  for (const entry of LAYOUT) {
    if (!backupSet.has(entry.name)) {
      excluded.push({ name: entry.name, why: entry.why });
      continue;
    }
    const from = join(store.dir, entry.name);
    const to = join(resolvedTarget, entry.name);
    if (entry.name === DATABASE_FILE) {
      const result = vacuumInto(paths.operational(store.dir), to);
      copied.push({
        name: entry.name,
        method: "vacuum-into",
        ok: result.ok,
        files: result.ok ? 1 : 0,
        why: result.ok ? "Copied through SQLite's own consistent-snapshot path, never as a file copy (scar §2.11)." : result.error
      });
      if (!result.ok)
        errors.push(`${entry.name}: ${result.error}`);
      continue;
    }
    try {
      const files = copyTree(from, to);
      copied.push({
        name: entry.name,
        method: "file-tree",
        ok: true,
        files,
        why: entry.why
      });
    } catch (err) {
      const message = String(err.message ?? err);
      copied.push({ name: entry.name, method: "file-tree", ok: false, files: 0, why: message });
      errors.push(`${entry.name}: ${message}`);
    }
  }
  return { ok: errors.length === 0, target: resolvedTarget, copied, excluded, errors };
}

export { vacuumInto };
export function snapshotName(at) {
  return new Date(at).toISOString().replace(/[:.]/g, "-");
}
