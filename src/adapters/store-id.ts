/**
 * WHICH STORE THIS IS, without saying where it is (2026-10-12, Mike's
 * fresh-user trial). On one machine two stores — a throwaway trial store and
 * the person's real one — can both try dashboard port 4747, and the sidebar
 * mod read the real store's dashboard during a trial: read-only, but the wrong
 * store. So the dashboard says which store it serves (`/api/whoami`, and a
 * `store` field on `/api/onboarding`), and the session-start wake says which
 * store this session's hooks opened (`storeMarker`); the mod compares the two.
 *
 * THE ID: `st_` and the first 16 hex of a sha256 over the store's own secret
 * salt (the per-store handle salt, G58, `expansions.ts#expansionSalt`: 16
 * random bytes in `sessions/expansions.salt`) and its resolved, symlink-free
 * data dir. Keyed by the salt, so nobody who guesses the path
 * (`/Users/<name>/.counterparts`) can confirm it from the id, which rides in
 * every wake and so in transcripts (review of #459). With the dir too, so a
 * copy of a store at another path reads as another store, the safe answer for
 * the mod's question ("is this my store's dashboard?"). No store format
 * change: the salt file already exists for any store that has expanded a
 * handle, and the wake (a writer) mints it if a store has none yet. A reader
 * that never writes (the dashboard) only reads it, and answers null until a
 * wake has minted it. The same on every open of the same directory, by any
 * process; different between two stores; never carries the path.
 */
import { createHash } from "node:crypto";
import { realpathDeep } from "../core/store/index.js";
import { expansionSalt, readExpansionSalt } from "./expansions.js";

/** What every id starts with, so a reader can tell one from any other token. */
export const STORE_ID_PREFIX = "st_";

/** The id's shape: the prefix and 16 lowercase hex. */
export const STORE_ID_RE = /^st_[0-9a-f]{16}$/;

/**
 * The store id for the data dir `dir` (the store's own `dir`), or null when
 * the store's salt is not there (the default, a reader that never writes) or
 * cannot be read or made (`mint: true`). Never throws for a path that does not
 * exist yet.
 */
export function storeId(dir: string, opts: { readonly mint?: boolean } = {}): string | null {
  const salt = opts.mint === true ? expansionSalt(dir) : readExpansionSalt(dir);
  if (salt === null) return null;
  const real = realpathDeep(dir);
  return STORE_ID_PREFIX + createHash("sha256").update(`counterparts-store\0${salt}\0${real}`, "utf8").digest("hex").slice(0, 16);
}

/**
 * THE WAKE'S STORE MARKER: `<!-- counterparts:store id=st_… -->`, on its own
 * line right under the first meeting's marker (`core/onboarding.ts#
 * onboardingMarker`) on a Claude Code session-start wake, so the mod learns
 * from the hook's own context which store this session opened, before any
 * dashboard is up. The wake is a writer, so it mints the salt if the store has
 * none yet; empty when even that fails (no marker beats a wrong one).
 */
export function storeMarker(dir: string): string {
  const id = storeId(dir, { mint: true });
  return id === null ? "" : `<!-- counterparts:store id=${id} -->`;
}
