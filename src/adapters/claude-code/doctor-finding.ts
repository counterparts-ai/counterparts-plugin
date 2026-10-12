/** `doctor`'s finding — its shape and the small readers of the event log every check uses (moved out of `doctor.ts`, 2026-10-11). */
import { homedir } from "node:os";
import { Store } from "../../core/store/index.js";
import type { EventRow } from "../../core/store/index.js";

/** Worst first. The order of this array IS the report's order. */
export const SEVERITIES = ["red", "amber", "green"] as const;

export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  /** Stable machine name — the `--json` key and the notice's identity. */
  readonly key: string;
  readonly severity: Severity;
  /** The column heading a human reads: "Config", "Clock". */
  readonly title: string;
  /** One line of FACTS: paths, names, counts, dates. Never memory text. */
  readonly detail: string;
  /** One line naming the fix. Empty only when there is nothing to fix. */
  readonly fix: string;
  /** Ids and counts, for `--json`. Never a credential value, never prose. */
  readonly data: Record<string, string | number | boolean | null>;
  /**
   * AN OPTIONAL FEATURE THAT WAS NEVER TURNED ON — printed `OFF`, dim, and
   * counted apart from the ambers (new-user findings #24, owner's answer 12 of
   * 2026-09-22). One optional thing nobody turned on used to produce three
   * ambers on a fresh install, and a screen where nothing is wrong should not
   * carry three warnings.
   *
   * IT IS A FLAG ON AMBER, NOT A FOURTH `Severity`, and that is the whole
   * reason the JSON keeps `severity: "amber"`: every reader that switches on a
   * severity — the hook's notice, the dashboard, a script of the owner's —
   * still sees the three words it has always seen, and one that wants the new
   * distinction reads one new boolean. What DOES move is where the line sorts
   * and how it is counted, both of which live in this file (`worstFirst`,
   * `reportLines`, `reportJson`) and nowhere else.
   *
   * NEVER on a feature that WAS working and has stopped: `keyHistory` tells
   * the two apart.
   */
  readonly optional?: boolean;
}

/**
 * How many lived days back the newest-row search widens through.
 *
 * Written when `Store.eventLog` read only ASCENDING with a LIMIT, so "the
 * newest row of this name" was not a query it offered. Since #272 it is
 * (`order: "desc", limit: 1`); this ladder predates that and is left as it
 * is, because it is exact either way: a window whose result is
 * SHORTER than the limit was not truncated, so its last row is provably the
 * newest in that window. The ladder starts at today so the common case reads
 * the fewest rows, and widens only when a window is empty.
 */
const WINDOWS: readonly (number | null)[] = [0, 2, 7, 30, null];

const NEWEST_LIMIT = 4000;

/** A finding, with `data` defaulted so each group below stays one expression. */
export function finding(
  key: string,
  severity: Severity,
  title: string,
  detail: string,
  fix: string,
  data: Record<string, string | number | boolean | null> = {},
): Finding {
  return { key, severity, title, detail, fix, data };
}

/**
 * An OFF finding: an optional feature nobody has turned on. Amber underneath
 * (see `Finding.optional`), `OFF` on the screen, and the fix is always the
 * command that turns the thing on — never a JSON edit (finding #19).
 */
export function off(
  key: string,
  title: string,
  detail: string,
  fix: string,
  data: Record<string, string | number | boolean | null> = {},
): Finding {
  return { key, severity: "amber", title, detail, fix, data, optional: true };
}

/**
 * A path under the owner's home, written the way he types it (`~/…`).
 *
 * The home directory is read here rather than passed in because every caller
 * already has the same one and threading it would put an environment lookup in
 * `DoctorInput` for a cosmetic. It is COSMETIC on purpose: only `detail` and
 * `fix` are folded this way, never `data`, so `--json` keeps the absolute path
 * a script would act on. A store outside the home is returned unchanged, which
 * is every test's case — the temp directories the suite makes are not under it.
 */
export function tilde(path: string): string {
  const home = homedir();
  if (home.length === 0 || path === home) return path === home ? "~" : path;
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * The newest rows of one event name, oldest-first, at most `count` of them —
 * or `unknown`, which is a third answer and not a kind of empty.
 *
 * Exact, not approximate: see `WINDOWS`. A window that came back FULL is
 * discarded rather than trusted — its last row is the newest of the first
 * `NEWEST_LIMIT`, which is not the same claim.
 *
 * THE UNBOUNDED WINDOW IS NOT EXEMPT FROM THAT RULE, and the first round of this
 * PR made it so. Once a name held `NEWEST_LIMIT` rows all older than the widest
 * day window, every bounded window came back full and was skipped, the `null`
 * window came back full too — and it alone was trusted, so `rows.slice(-count)`
 * handed back the 4,000th-OLDEST row as "the newest". A store that swept its
 * last 4,000 sleep cycles and ran fine since would have been read off a row from
 * whenever that prefix ended: a confident wrong answer, which is the one thing a
 * diagnostic may never produce. Unknown says so instead.
 */
interface NewestRead {
  readonly rows: EventRow[];
  readonly unknown: boolean;
}

export function newestRows(store: Store, name: string, count: number, livedDay: number): NewestRead {
  for (const back of WINDOWS) {
    const rows = store.eventLog(
      back === null
        ? { name, limit: NEWEST_LIMIT }
        : { name, sinceDay: Math.max(0, livedDay - back), limit: NEWEST_LIMIT },
    );
    if (rows.length === 0) continue;
    if (rows.length >= NEWEST_LIMIT) {
      if (back !== null) continue;
      return { rows: [], unknown: true };
    }
    return { rows: rows.slice(-count), unknown: false };
  }
  return { rows: [], unknown: false };
}

/** The one sentence for a name whose newest row cannot be determined. Neutral:
 *  it names what was not read, and claims nothing about the store. */
export function undetermined(name: string): string {
  return (
    `newest ${name} row could not be determined: more than ${NEWEST_LIMIT} rows and no bounded window ` +
    "came back short, so the newest one was not read"
  );
}

export function payloadOf(row: EventRow | undefined): Record<string, unknown> {
  if (row === undefined || row.payload === null) return {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function num(p: Record<string, unknown>, key: string): number | null {
  const v = p[key];
  return typeof v === "number" ? v : null;
}

export function str(p: Record<string, unknown>, key: string): string | null {
  const v = p[key];
  return typeof v === "string" ? v : null;
}
