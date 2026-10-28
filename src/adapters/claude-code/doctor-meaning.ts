/**
 * SEARCH BY MEANING THAT CANNOT RUN, said by the wake (2026-10-27, W1), and
 * the install routes doctor's Recall by meaning line shares with it.
 *
 * Why it exists: a plugin install ran for days with no meaning weights
 * (`NO_WEIGHTS`) — the plugin's dependency step had not run — and only a
 * doctor run said so. The person's counterpart could have told them, had its
 * wake carried one line. This is that line: written for the model to say to
 * its person, in words a regular user can act on, with the fix for the route
 * this copy came by (`plugin.ts#installRoute`) — the same route, and the same
 * steps, as doctor's own fix line and `install`'s hint, because all three are
 * built here.
 *
 * Cheap by construction (it is read on a hook's hot path): the durable rows
 * the worker already writes (`vectors.ts#backfillVectors`' row, the runner's
 * `adapter.runner.failed`), plus one look for the table's files on disk. It
 * never loads the weights and never starts a worker.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { EMBED_BACKFILL_EVENT, RUNNER_FAILED_EVENT } from "../../core/counterpart.js";
import type { Store } from "../../core/store/index.js";
import { MODEL_FILE, VOCAB_FILE, resolveStaticWeights } from "../../core/embed/static.js";
import { bundledModelDir } from "../runtime.js";
import type { RuntimeKind } from "../runtime.js";
import type { AdapterConfig } from "../config.js";
import type { InstallRoute } from "../plugin.js";
import { payloadOf, str } from "./doctor-finding.js";

// ── the install routes, shared with doctor.ts and `install` ────────────────

// The steps themselves live in the adapters' shared leaf since U1a
// (`../update-words.ts`): the MCP server's refusal says them too, and it may
// not import this adapter. Re-exported here, where doctor and the wake read them.
import { PLUGIN_UPDATE, byRoute, npmTableCommand } from "../update-words.js";
export { PLUGIN_UPDATE, RELOAD_STEP, byRoute, npmTableCommand, npmUpdateCommand } from "../update-words.js";

/** The plugin's way to the meaning table: its update reruns the dependency
 *  step, which needs npm (#396: a Bun-only computer has none). */
export const PLUGIN_TABLE_UPDATE = `${PLUGIN_UPDATE}; the plugin installs its files with npm, so with no npm on this computer install Node.js (https://nodejs.org) first`;

// ── the table on disk ──────────────────────────────────────────────────────

/**
 * Where this process would load the meaning table from, and whether its two
 * files are there — the same resolution the worker's embedder makes
 * (`embed-client.ts#openStaticEmbedder`), without reading a byte of either.
 * `found` is null when no rule names a directory at all; `complete` says both
 * files exist in the one that was named (the loader refuses a folder missing
 * either, `MISSING_FILE`).
 */
export function tableOnDisk(opts: { env?: Record<string, string | undefined>; packageDir?: string } = {}): {
  found: { dir: string; source: string } | null;
  complete: boolean;
} {
  const packageDir = opts.packageDir ?? bundledModelDir();
  const found = resolveStaticWeights({
    ...(opts.env === undefined ? {} : { env: opts.env }),
    ...(packageDir === undefined ? {} : { packageDir }),
  });
  if (found === null) return { found: null, complete: false };
  return { found, complete: existsSync(join(found.dir, MODEL_FILE)) && existsSync(join(found.dir, VOCAB_FILE)) };
}

// ── the wake's line ────────────────────────────────────────────────────────

/** The refusals that mean "the files are not there" — fixed by putting them
 *  there, so a table found whole now is a table restored. Every other code
 *  (`HASH_MISMATCH`, `BAD_*`, `LOAD_FAILED`, …) is files that would not load,
 *  and stands until the worker's next row says otherwise. */
const NOT_THERE: ReadonlySet<string> = new Set(["NO_WEIGHTS", "MISSING_FILE"]);

/**
 * How many dates the worker's vector step must have failed on, with no
 * backfill row since the earlier of them, before the wake says it stopped.
 * The runner latches one `adapter.runner.failed` row per step per date, and
 * its `vectors` step covers the lagged cue as well as the backfill, so one
 * failure is one bad boundary — not a feature that has stopped.
 */
export const MEANING_FAILED_DATES = 2;

/** How many of the newest runner failures are read for `vectors` ones. */
const RUNNER_FAILED_ROWS = 20;

/** Why search by meaning is not running, for the person. */
export type MeaningOff = "missing" | "unloadable" | "stopped";

/** The person's sentence for each, before the fix. First person: the model says it. */
export const MEANING_OFF_WORDS: Readonly<Record<MeaningOff, string>> = {
  missing: "My search by meaning is off on this computer (its files didn't install), so I can only find memories by their words.",
  unloadable: "My search by meaning is off on this computer (its files are there but won't load), so I can only find memories by their words.",
  stopped: "My search by meaning has stopped working on this computer, so I can only find memories by their words.",
};

/** What the line is introduced by, for the model. */
export const MEANING_OFF_LEAD = "Counterparts — tell your person when it fits, once this session:";

/** The date the `stopped` line was last told: it is said at most once a day. */
export const MEANING_STOPPED_TOLD_KEY = "adapter.meaning.stopped.told";

export interface MeaningOffInput {
  readonly config: AdapterConfig;
  readonly store: Store;
  /** How this copy came (`plugin.ts#installRoute`); absent: both routes are named. */
  readonly install?: InstallRoute;
  /** The environment the table is resolved from; absent, this process's. */
  readonly env?: Record<string, string | undefined>;
  /** The single binary's carried table; absent, `runtime.ts#bundledModelDir`. */
  readonly packageDir?: string;
  /** The runtime the npm step names; absent, this process's. */
  readonly runtime?: RuntimeKind;
}

/**
 * Why search by meaning is configured ON and cannot run here, or null:
 *
 *   - **switched off** (`embedder.enabled` not true) or an observer: null.
 *     Off by choice is not a fault, and doctor already says OFF.
 *   - `missing`: this process finds no whole table — before any boundary too,
 *     which is a fresh plugin install's first wake. A worker row that said
 *     `NO_WEIGHTS`/`MISSING_FILE` while the table IS whole now reads as
 *     restored: the wake says nothing, and the next boundary writes a new row.
 *   - `unloadable`: the worker's newest row says the table was there and
 *     would not load (any other refusal code). It stands until the next row.
 *   - `stopped`: the worker's vector step threw on `MEANING_FAILED_DATES`
 *     separate dates, with no backfill row since the earlier one.
 *
 * NOT A CASE: a backfill "stuck at 0". The static table blames every miss on
 * the memory and sets it aside on its third (`EMBED_SKIP_AFTER`), so its
 * `remaining` falls; what stays flat is the store refusing vectors (doctor's
 * held / cache-ahead lines) or lost counter writes — not a person's fix.
 *
 * The hook's environment IS the worker's (the hook starts it), so the look at
 * the disk is the same look the worker makes. Never throws: a reading that
 * fails is no line.
 */
export function meaningOff(input: MeaningOffInput): MeaningOff | null {
  if (input.config.embedder?.enabled !== true || input.config.observer === true) return null;
  try {
    const table = tableOnDisk({
      ...(input.env === undefined ? {} : { env: input.env }),
      ...(input.packageDir === undefined ? {} : { packageDir: input.packageDir }),
    });
    if (!table.complete) return "missing";
    const store = input.store;
    // The NEWEST backfill row, read straight off the log's end — never through
    // a day window, which would stop at today's rows.
    const newest = store.eventLog({ name: EMBED_BACKFILL_EVENT, order: "desc", limit: 1 })[0];
    const p = payloadOf(newest);
    if (newest !== undefined && str(p, "reason") === "embedder-unavailable") {
      const code = str(p, "codes") ?? "NO_WEIGHTS";
      return NOT_THERE.has(code) ? null : "unloadable";
    }
    const failures = store
      .eventLog({ name: RUNNER_FAILED_EVENT, order: "desc", limit: RUNNER_FAILED_ROWS })
      .filter((r) => str(payloadOf(r), "step") === "vectors");
    const dates = new Set(failures.map((r) => str(payloadOf(r), "date") ?? String(r.day)));
    const earliest = failures[MEANING_FAILED_DATES - 1];
    if (dates.size >= MEANING_FAILED_DATES && earliest !== undefined && (newest === undefined || newest.seq < earliest.seq)) {
      return "stopped";
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * THE WAKE'S ONE LINE, or null (`meaningOff`). The fix is the route's: the
 * table's install for `missing`, its reinstall for `unloadable` — doctor's own
 * steps — and doctor itself for `stopped`, whose reasons are many and are its
 * to name.
 *
 * `stopped` is said at most ONCE A DAY: with `today`, the first wake that
 * says it records the date (`MEANING_STOPPED_TOLD_KEY`), and later wakes that
 * day say nothing. `missing` and `unloadable` are said on every wake until
 * fixed: they are one install away, and the person is the one who installs.
 */
export function wakeMeaningLine(input: MeaningOffInput & { readonly today?: string }): string | null {
  const why = meaningOff(input);
  if (why === null) return null;
  if (why === "stopped" && input.today !== undefined) {
    try {
      if (input.store.getMeta(MEANING_STOPPED_TOLD_KEY) === input.today) return null;
      input.store.setMeta(MEANING_STOPPED_TOLD_KEY, input.today);
    } catch {
      // A claim that could not be written costs the once-a-day, not the line.
    }
  }
  const npm = `in a terminal, run ${npmTableCommand(input.runtime)}`;
  const fix =
    why === "missing"
      ? byRoute(input.install, npm, PLUGIN_TABLE_UPDATE)
      : why === "unloadable"
        ? byRoute(input.install, npm, PLUGIN_UPDATE)
        : byRoute(input.install, "in a terminal, run counterparts doctor", "in Claude Code, run /counterparts:doctor");
  const step = why === "stopped" ? "To see why" : "To fix it";
  return `${MEANING_OFF_LEAD} "${MEANING_OFF_WORDS[why]} ${step}: ${fix}."`;
}
