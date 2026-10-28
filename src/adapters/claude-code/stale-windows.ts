/**
 * OLDER WINDOWS AFTER AN UPGRADE, said once by the first watched wake that
 * finds them (U1a, 2026-10-27).
 *
 * When a newer Counterparts upgrades the memory, every Claude Code window
 * opened before it keeps running the old code — its MCP server (npm and
 * plugin), and its hooks too (plugin) — and from then on refuses or stands
 * down. Each of those says so in its own window (`update-words.ts`), but only
 * when somebody uses it, and a person returning to a window left open
 * overnight meets a refusal with no warning. The window that opened on the
 * new memory is the one place that can see the others: every running server
 * leaves its build in the session registry (`sessions.ts#readServerRecords`),
 * so the believed-live ones (`serverBelieved`) whose schema stamps are older
 * than this code's are the windows to reload.
 *
 * Counted by HOST PROCESS (`hostPid`), not by server: one window can hold
 * more than one record. This window's own host is left out (the hook's
 * parent): it is the one being told. Claude Desktop's app server (place
 * `claude-desktop:`) is named apart, in its own words.
 *
 * EACH WINDOW'S OWN STEP (review of #666): a server record says how its copy
 * came and whether it runs in Desktop's Code tab (`ServerRecord.route`,
 * `codeTab`), so a plugin window is told to reload and an npm one to
 * reconnect, whoever is telling. A record from a build before that says
 * neither, and is read with the caller's fallback (`fallback`): this
 * window's route on Claude Code, both routes from Desktop's server. Windows
 * on different routes get both routes' steps.
 *
 * Said once per store version (`STALE_WINDOWS_TOLD_KEY`, read first, then
 * claimed with `Store.updateMeta`, so two windows starting together say it
 * once and a told line writes nothing), and only at a start a person is
 * watching — the caller's rule, W1's: not the nightly run, `-p`, a compaction
 * or a resume, which would spend it on nobody. Whoever upgraded the memory
 * (this window, the nightly run, Desktop, the console), the line is the same.
 */
import { CACHE_SCHEMA_VERSION, SCHEMA_VERSION } from "../../core/store/index.js";
import type { Store } from "../../core/store/index.js";
import { DESKTOP_HOST, DESKTOP_SCOPE, isPseudoScope, wordingFor } from "../hosts.js";
import type { InstallRoute } from "../plugin.js";
import { pidAlive, readServerRecords, serverBelieved } from "../sessions.js";
import { windowStep } from "../update-words.js";

/** The store version the line was last said for (`<store>.<cache>`). */
export const STALE_WINDOWS_TOLD_KEY = "adapter.update.staleWindows.told";

/** What the line is introduced by, for the model: now, not "when it fits" — the person is about to use those windows. */
export const STALE_WINDOWS_LEAD = "Counterparts — tell your person now:";

export interface StaleWindows {
  /** Distinct host processes running a server older than this code. */
  readonly windows: number;
  /** Claude Desktop's own server is one of them. */
  readonly desktop: boolean;
  /** The route those windows' step is for: theirs when they share one, else `either`. */
  readonly route: InstallRoute;
  /** Every one of those windows is in Desktop's Code tab. */
  readonly codeTab: boolean;
}

/** What a window that does not say is taken to be. */
export interface WindowFallback {
  readonly route: InstallRoute | undefined;
  readonly codeTab: boolean;
}

/**
 * The older servers still running against this store, by window. Reads the
 * registry only; never throws (nothing readable is nothing found).
 */
export function staleWindows(input: {
  readonly dataDir: string;
  readonly now: number;
  readonly fallback: WindowFallback;
  readonly alive?: (pid: number) => boolean;
  /** A server's own pid, left out (Desktop's wake asks from inside one). */
  readonly selfPid?: number;
  /** The asking window's host process, left out (the hook's parent). */
  readonly selfHostPid?: number;
}): StaleWindows {
  const none: StaleWindows = { windows: 0, desktop: false, route: input.fallback.route ?? "either", codeTab: input.fallback.codeTab };
  try {
    const alive = input.alive ?? pidAlive;
    const older = readServerRecords(input.dataDir).filter(
      (r) =>
        r.pid !== input.selfPid &&
        (r.build.storeSchema < SCHEMA_VERSION || r.build.cacheSchema < CACHE_SCHEMA_VERSION) &&
        serverBelieved(r.pid, r.refreshedAt, input.now, alive),
    );
    const windows = new Map<number, { route: InstallRoute; codeTab: boolean }>();
    for (const r of older) {
      if (isPseudoScope(r.scope) || r.hostPid === input.selfHostPid) continue;
      const seen = windows.get(r.hostPid);
      const route = r.route ?? input.fallback.route ?? "either";
      const codeTab = r.route === undefined ? input.fallback.codeTab : r.codeTab === true;
      windows.set(r.hostPid, seen === undefined ? { route, codeTab } : { route: seen.route === route ? route : "either", codeTab: seen.codeTab && codeTab });
    }
    const each = [...windows.values()];
    const routes = new Set(each.map((w) => w.route));
    return {
      windows: each.length,
      desktop: older.some((r) => r.scope === DESKTOP_SCOPE),
      route: routes.size === 1 ? (each[0]?.route ?? "either") : "either",
      codeTab: each.length > 0 && each.every((w) => w.codeTab),
    };
  } catch {
    return none;
  }
}

/** The sentence, from what was found. Pure. */
export function staleWindowsWords(found: StaleWindows): string | null {
  if (found.windows === 0 && !found.desktop) return null;
  const parts: string[] = [];
  const step = windowStep(found.route, found.codeTab);
  if (found.windows === 1) {
    parts.push(`1 Claude Code window opened before that can't use it until it's reloaded: there, ${step}.`);
  } else if (found.windows > 1) {
    parts.push(`${String(found.windows)} Claude Code windows opened before that can't use it until they're reloaded: in each, ${step}.`);
  }
  if (found.desktop) {
    const quit = wordingFor(DESKTOP_HOST).reconnectFirst;
    parts.push(`Claude Desktop, open since before that, can't use it until you ${quit.charAt(0).toLowerCase()}${quit.slice(1)}.`);
  }
  return `${STALE_WINDOWS_LEAD} "My memory was just upgraded to a newer version. ${parts.join(" ")}"`;
}

/**
 * THE WAKE'S LINE, or null: older servers found, and this store version not
 * told yet — claimed here, so it is said by exactly one wake. The caller
 * decides the start is watched. Never throws: a claim that cannot be written
 * is no line (the next watched wake tries again).
 */
export function staleWindowsLine(input: {
  readonly store: Store;
  readonly fallback: WindowFallback;
  readonly now: number;
  readonly alive?: (pid: number) => boolean;
  readonly selfPid?: number;
  readonly selfHostPid?: number;
}): { readonly line: string; readonly found: StaleWindows } | null {
  try {
    const tag = `${String(SCHEMA_VERSION)}.${String(CACHE_SCHEMA_VERSION)}`;
    // Told already: nothing to read further, and nothing written.
    if (input.store.getMeta(STALE_WINDOWS_TOLD_KEY) === tag) return null;
    const found = staleWindows({
      dataDir: input.store.dir,
      now: input.now,
      fallback: input.fallback,
      ...(input.alive === undefined ? {} : { alive: input.alive }),
      ...(input.selfPid === undefined ? {} : { selfPid: input.selfPid }),
      ...(input.selfHostPid === undefined ? {} : { selfHostPid: input.selfHostPid }),
    });
    const line = staleWindowsWords(found);
    if (line === null) return null;
    const claimed = input.store.updateMeta(STALE_WINDOWS_TOLD_KEY, (current) => (current === tag ? undefined : tag));
    return claimed === tag ? { line, found } : null;
  } catch {
    return null;
  }
}
