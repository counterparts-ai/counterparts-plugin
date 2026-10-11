/**
 * Copying a store safely — the sharpest scar in this adapter's list (§2.11).
 *
 * **A canonical database is never file-copied.** v1 copied its SQLite file with
 * no checkpoint, and it was harmless *because the database was a declared
 * rebuildable cache*. Rescope 1 removed exactly that mitigation: box 2 is
 * canonical now, so the same flaw is canonical-data loss. Here the database is
 * copied by `VACUUM INTO`, which is SQLite's own consistent-snapshot operation:
 * it takes a read transaction, so a writer holding an uncommitted transaction
 * cannot tear the copy — the snapshot contains the last committed state and
 * nothing half-written. `test/cli.test.ts` proves it by holding an open write
 * transaction across the copy and reading the result back.
 *
 * **Scope is asserted against the layout, not documented** (§5 G5). `LAYOUT` in
 * `store/paths.ts` classifies every top-level path as backed-up or explicitly
 * excluded, and `Store.assertLayout()` throws on anything unclassified. This
 * module copies exactly `Store.backupSet()` — so adding a directory to the data
 * dir without classifying it breaks the build, and adding one that IS classified
 * changes the backup automatically. v1's allowlist landed hours before the
 * episode directory existed and silently omitted the canonical journal for three
 * weeks; a hand-maintained second list here would re-create that bug exactly.
 *
 * **Nothing throws at the caller** (§5 G8). A backup problem must not block a
 * consolidation cycle, so every failure is a row in the report.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  DATABASE_FILE,
  LAYOUT,
  vacuumInto,
  assertSafeDataDir,
  forbiddenRoots,
  isWithin,
  paths,
} from "../../core/store/index.js";
import type { Store } from "../../core/store/index.js";

export type CopyMethod = "vacuum-into" | "file-tree" | "skipped";

export interface CopiedEntry {
  readonly name: string;
  readonly method: CopyMethod;
  readonly ok: boolean;
  readonly files: number;
  readonly why: string;
}

export interface SnapshotReport {
  readonly ok: boolean;
  readonly target: string;
  readonly copied: readonly CopiedEntry[];
  /** Every classified-but-excluded path, with the reason from the layout. */
  readonly excluded: readonly { name: string; why: string }[];
  readonly errors: readonly string[];
}

/**
 * A path with every SYMLINK ON THE WAY TO IT resolved — the leaf itself usually
 * does not exist yet, so the nearest existing ancestor is realpath'd and the
 * tail is rejoined.
 *
 * Why it exists (f6f7 review MAJOR-4, measured): `resolve()` normalises `..` but
 * never reads the filesystem, so a target reached through a link into the store
 * was judged "outside" and written anyway — a whole export tree, memories and
 * all, landed inside `<store>/journal/`.
 *
 * A DANGLING link is refused here by name rather than left to `mkdirSync`,
 * which throws a raw `EEXIST` on one. A guard that holds because of an errno is
 * not a guard, and "file already exists" is not a sentence about safety.
 */
function realOf(path: string, what: string): string {
  const full = resolve(path);
  const tail: string[] = [];
  let at = full;
  for (;;) {
    let entry;
    try {
      entry = lstatSync(at);
    } catch {
      const up = dirname(at);
      // The filesystem root cannot be missing; stop rather than loop.
      if (up === at) return full;
      tail.unshift(basename(at));
      at = up;
      continue;
    }
    if (entry.isSymbolicLink() && !existsSync(at)) {
      throw new Error(
        `refusing a ${what} that is a dangling symlink: ${at} points at something that does not exist`,
      );
    }
    try {
      return join(realpathSync(at), ...tail);
    } catch {
      return full;
    }
  }
}

/**
 * The destination guard (§5 G3, scar §2.13). BOTH SIDES ARE RESOLVED — through
 * `..` AND through symlinks — BEFORE THEY ARE COMPARED. v1's migration guard was
 * a raw string comparison, and `--out ~/.bansai/` with a trailing slash pointed
 * it at the live store and mass-wrote about 11,000 files.
 *
 * **Both sides, and the forbidden roots too.** On macOS `$TMPDIR` is itself
 * reached through a link (`/var` → `/private/var`), so realpath'ing one side
 * only would stop every "inside the store" case from being detected and make a
 * fake-`HOME` test of the v1 roots pass vacuously.
 *
 * Two refusals people forget, and now a third: a destination INSIDE the data
 * directory would put the copy in the tree it is copying, which both recurses
 * and lands an unclassified top-level path in the store; a destination that
 * CONTAINS the store is the same problem upside down; and a destination whose
 * link lands in `~/.bansai` or `~/.claude-engram` is v1's live memory reached
 * the one way `assertSafeDataDir` alone cannot see.
 */
export function assertSafeTarget(dataDir: string, target: string): string {
  // The plain-path v1-root refusal first, on the path as typed: it is the
  // sentence the owner gets for `--out ~/.bansai/`, and it should not change
  // shape because a link was involved.
  assertSafeDataDir(target);
  const resolvedTarget = realOf(target, "destination");
  const resolvedSource = realOf(dataDir, "store");
  // …and again on the resolved path, so a link whose DESTINATION is inside a
  // live v1 store is refused by the same rule that refuses the path itself.
  assertSafeDataDir(resolvedTarget);
  for (const root of forbiddenRoots()) {
    if (isWithin(realOf(root, "store"), resolvedTarget)) {
      throw new Error(`refusing a destination inside ${root}: ${resolvedTarget}`);
    }
  }
  if (isWithin(resolvedSource, resolvedTarget)) {
    throw new Error(
      `refusing to write a copy inside the store it is copying: ${resolvedTarget}`,
    );
  }
  if (isWithin(resolvedTarget, resolvedSource)) {
    throw new Error(`refusing a destination that contains the store: ${resolvedTarget}`);
  }
  // The TYPED path is what comes back, not the realpath'd one: every caller
  // prints it and every test names it, and telling the owner his export went to
  // `/private/var/…` when he typed `/var/…` is a different kind of confusing.
  return resolve(target);
}

function copyTree(from: string, to: string): number {
  if (!existsSync(from)) return 0;
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

/**
 * Snapshot a store into `target`. The database goes through `VACUUM INTO`; every
 * other backed-up path is an ordinary file-tree copy, which is correct for plain
 * files and correct for prose.
 *
 * `store` is passed so the copy is made against the SAME layout the store
 * asserted at open — not against a directory listing this module took on its
 * own, which could disagree.
 */
export function snapshot(store: Store, target: string): SnapshotReport {
  const copied: CopiedEntry[] = [];
  const excluded: { name: string; why: string }[] = [];
  const errors: string[] = [];
  let resolvedTarget: string;
  try {
    resolvedTarget = assertSafeTarget(store.dir, target);
    // The layout is re-asserted here, not assumed from open: a directory that
    // appeared since the store opened must be classified before it is skipped.
    store.assertLayout();
    mkdirSync(resolvedTarget, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      target,
      copied: [],
      excluded: [],
      errors: [String((err as Error).message ?? err)],
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
    // The canonical database, and only it, takes the database's own route.
    // Matched against the layout's own spelling of the name, never a literal:
    // the file was `operational.sqlite` until the floor moved the bodies into
    // it, and a second spelling here would have quietly sent the canonical
    // database down the file-copy path on the day it was renamed (§2.11).
    if (entry.name === DATABASE_FILE) {
      const result = vacuumInto(paths.operational(store.dir), to);
      copied.push({
        name: entry.name,
        method: "vacuum-into",
        ok: result.ok,
        files: result.ok ? 1 : 0,
        why: result.ok
          ? "Copied through SQLite's own consistent-snapshot path, never as a file copy (scar §2.11)."
          : result.error,
      });
      if (!result.ok) errors.push(`${entry.name}: ${result.error}`);
      continue;
    }
    try {
      const files = copyTree(from, to);
      copied.push({
        name: entry.name,
        method: "file-tree",
        ok: true,
        files,
        why: entry.why,
      });
    } catch (err) {
      const message = String((err as Error).message ?? err);
      copied.push({ name: entry.name, method: "file-tree", ok: false, files: 0, why: message });
      errors.push(`${entry.name}: ${message}`);
    }
  }

  return { ok: errors.length === 0, target: resolvedTarget, copied, excluded, errors };
}

/** `VACUUM INTO` on its own connection — the store's own copy primitive, kept
 *  exported here for the callers that always found it here. */
export { vacuumInto };

/** A snapshot directory name that sorts chronologically and never collides. */
export function snapshotName(at: number): string {
  return new Date(at).toISOString().replace(/[:.]/g, "-");
}
