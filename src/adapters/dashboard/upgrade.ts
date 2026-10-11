/**
 * A store waiting for its one-time schema upgrade, as the dashboard meets it.
 * Its own small module so the terminal views can say the sentence without
 * loading the web server.
 */
import { SCHEMA_VERSION, isStoreError } from "../../core/store/index.js";
import { upgradeWords } from "../hosts.js";
import { hostsSeen } from "../sessions.js";

/**
 * A store on an OLDER schema this build can upgrade (v6 up): an observer meets
 * it as `STORE_UNINITIALIZED` with a `found` version, and it is waiting for the
 * first Claude Code session to copy and upgrade it. The dashboard is an
 * observer and never upgrades anything, so it says so and waits.
 */
export function upgradePending(err: unknown): boolean {
  if (!isStoreError(err, "STORE_UNINITIALIZED")) return false;
  const found = Number.parseInt(String(err.detail["found"] ?? ""), 10);
  return Number.isFinite(found) && found >= 6 && found < SCHEMA_VERSION;
}

/**
 * The sentence a store waiting for its upgrade gets, on the page and in the
 * terminal — in the words of the hosts the store's registry has seen
 * (`hosts.ts#upgradeWords`, 2026-10-01): a person with only Claude Desktop has
 * no Claude Code session to open.
 */
export function upgradePendingSentence(dir: string | null): string {
  const { open } = upgradeWords(dir === null ? new Set() : hostsSeen(dir));
  return `This memory needs a one-time upgrade. ${open.charAt(0).toUpperCase()}${open.slice(1)} and it will upgrade itself; then reload.`;
}

/** The sentence when no store directory is known: it names both hosts. */
export const UPGRADE_PENDING_SENTENCE = upgradePendingSentence(null);

