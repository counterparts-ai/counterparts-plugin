/**
 * The hold a rollback leaves (2026-10-11, `counterparts rollback`).
 *
 * `rollback` puts a store back on the schema it had before an upgrade, from the
 * copy the upgrade took (`pre-migration.ts`). It runs on the NEW build — the
 * one that did the upgrade — and the old build is installed afterwards. Between
 * the two, anything on the new build that opens the store would upgrade it
 * again: a hook, a memory server (Claude Desktop's is not removed by
 * `disconnect`), the dashboard, `install --host claude-desktop`. And a READ is
 * not harmless either: an observer open builds this build's cache beside the
 * old store (`cache.ts#openCache` initializes a missing cache whatever the
 * stance), and the old build then withdraws recall by meaning and refuses every
 * memory tool on "cache ahead".
 *
 * So the rollback leaves this file, and while it is there and the store is
 * BEHIND this build, `Store`'s constructor refuses every open, writer or
 * observer, by name (`STORE_ROLLED_BACK`), before it creates a directory or
 * touches the database. A build older than the store's upgrade never reads the
 * file, so the build being gone back to opens the store as it always did.
 *
 * **Why a file, and why here.** A meta row would travel with whichever database
 * is in place: it would have to be written into the restored copy, and it would
 * vanish with the copy on `--undo` or reappear in a snapshot restored later. A
 * file beside the database survives the swap of the database under it. It lives
 * INSIDE `sessions/` because every top-level entry of a store is classified and
 * an unclassified one refuses the store at open (`paths.ts#LAYOUT`) — in the old
 * build too, which would then refuse the very store it was installed to read.
 * `sessions/` is host state, never backed up (so a daily snapshot taken while
 * held does not carry the hold), and both builds skip a directory inside it.
 *
 * It is released by `counterparts rollback --upgrade-again` (the store upgrades
 * there and then, from a NEW copy) or `--undo` (the newer store comes back).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { pendingMigration } from "./operational.js";
import { DATABASE_FILE } from "./paths.js";

/** `<store>/sessions/rollback/hold.json`. The directory is the store's
 *  `sessions` entry, spelled here so the core does not import an adapter. */
export const ROLLBACK_HOLD_DIR = join("sessions", "rollback");
export const ROLLBACK_HOLD_FILE = "hold.json";

export function rollbackHoldPath(storeDir: string): string {
  return join(storeDir, ROLLBACK_HOLD_DIR, ROLLBACK_HOLD_FILE);
}

/** What a rollback wrote down. Paths and names only; never memory text. */
export interface RollbackHold {
  readonly version: 1;
  /** When the rollback ran (ms). */
  readonly at: number;
  /** The schema the store was on before it (the newer one), and the one restored. */
  readonly from: string;
  readonly to: string;
  /** The pre-migration copy restored, by its name in the snapshots directory. */
  readonly snapshot: string;
  /** The snapshots directory it was read from. */
  readonly snapshotsDir: string;
  /** Where the newer store was set aside. */
  readonly aside: string;
  /** sha256 of the restored database as written, or null until it is in place.
   *  `--undo` compares it: a change means something has written since. */
  readonly restoredSha256: string | null;
  /** The package version that ran the rollback, when it could be read. */
  readonly build: string | null;
}

/**
 * The hold as written, `"unreadable"` for a file that is there and does not
 * parse (it still holds: a rollback was started, and failing toward the hold
 * is the direction that does not upgrade a store somebody took back), or null.
 */
export function readRollbackHold(storeDir: string): RollbackHold | "unreadable" | null {
  const path = rollbackHoldPath(storeDir);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "unreadable";
    const str = (k: string): string => (typeof raw[k] === "string" ? (raw[k] as string) : "");
    return {
      version: 1,
      at: typeof raw["at"] === "number" ? raw["at"] : 0,
      from: str("from"),
      to: str("to"),
      snapshot: str("snapshot"),
      snapshotsDir: str("snapshotsDir"),
      aside: str("aside"),
      restoredSha256: typeof raw["restoredSha256"] === "string" ? raw["restoredSha256"] : null,
      build: typeof raw["build"] === "string" ? raw["build"] : null,
    };
  } catch {
    return "unreadable";
  }
}

/** Written whole under a temporary name and renamed into place, so a reader
 *  never meets half a file. */
export function writeRollbackHold(storeDir: string, hold: RollbackHold): void {
  const dir = join(storeDir, ROLLBACK_HOLD_DIR);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${ROLLBACK_HOLD_FILE}.${String(process.pid)}`);
  writeFileSync(tmp, `${JSON.stringify(hold, null, 2)}\n`);
  renameSync(tmp, rollbackHoldPath(storeDir));
}

// Taking the hold away is the console's (`cli/rollback.ts#clearRollbackHold`):
// this module calls no filesystem removal, like every file in the store.

/**
 * The hold, when it HOLDS this build: the file is there, and the database is
 * absent (a rollback stopped between setting the newer one aside and putting
 * the copy in place — an open would mint a blank store) or behind this build
 * (an open would upgrade it, or build this build's cache beside it). Null
 * otherwise, including a file left over a store that is already current.
 *
 * Reads a filename, and — only when the file is there — the database's stamp
 * on its own connection without converting it (`pendingMigration`).
 */
export function rollbackHeld(storeDir: string): RollbackHold | "unreadable" | null {
  const hold = readRollbackHold(storeDir);
  if (hold === null) return null;
  const db = join(storeDir, DATABASE_FILE);
  if (!existsSync(db)) return hold;
  return pendingMigration(db) === null ? null : hold;
}
