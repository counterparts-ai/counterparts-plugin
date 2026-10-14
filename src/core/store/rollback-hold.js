import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pendingMigration } from "./operational.js";
import { DATABASE_FILE } from "./paths.js";
export const ROLLBACK_HOLD_DIR = join("sessions", "rollback");
export const ROLLBACK_HOLD_FILE = "hold.json";
export function rollbackHoldPath(storeDir) {
  return join(storeDir, ROLLBACK_HOLD_DIR, ROLLBACK_HOLD_FILE);
}
export function readRollbackHold(storeDir) {
  const path = rollbackHoldPath(storeDir);
  if (!existsSync(path))
    return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      return "unreadable";
    const str = (k) => typeof raw[k] === "string" ? raw[k] : "";
    return {
      version: 1,
      at: typeof raw["at"] === "number" ? raw["at"] : 0,
      from: str("from"),
      to: str("to"),
      snapshot: str("snapshot"),
      snapshotsDir: str("snapshotsDir"),
      aside: str("aside"),
      restoredSha256: typeof raw["restoredSha256"] === "string" ? raw["restoredSha256"] : null,
      build: typeof raw["build"] === "string" ? raw["build"] : null
    };
  } catch {
    return "unreadable";
  }
}
export function writeRollbackHold(storeDir, hold) {
  const dir = join(storeDir, ROLLBACK_HOLD_DIR);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${ROLLBACK_HOLD_FILE}.${String(process.pid)}`);
  writeFileSync(tmp, `${JSON.stringify(hold, null, 2)}
`);
  renameSync(tmp, rollbackHoldPath(storeDir));
}
export function rollbackHeld(storeDir) {
  const hold = readRollbackHold(storeDir);
  if (hold === null)
    return null;
  const db = join(storeDir, DATABASE_FILE);
  if (!existsSync(db))
    return hold;
  return pendingMigration(db) === null ? null : hold;
}
