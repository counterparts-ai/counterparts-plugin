import { SCHEMA_VERSION, isStoreError } from "../../core/store/index.js";
import { upgradeWords } from "../hosts.js";
import { hostsSeen } from "../sessions.js";
export function upgradePending(err) {
  if (!isStoreError(err, "STORE_UNINITIALIZED"))
    return false;
  const found = Number.parseInt(String(err.detail["found"] ?? ""), 10);
  return Number.isFinite(found) && found >= 6 && found < SCHEMA_VERSION;
}
export function upgradePendingSentence(dir) {
  const { open } = upgradeWords(dir === null ? new Set : hostsSeen(dir));
  return `This memory needs a one-time upgrade. ${open.charAt(0).toUpperCase()}${open.slice(1)} and it will upgrade itself; then reload.`;
}
export const UPGRADE_PENDING_SENTENCE = upgradePendingSentence(null);
