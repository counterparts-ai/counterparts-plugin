/** `doctor`'s reading of how the store opened — the migration, the journal — and its findings (moved out of `doctor.ts`, 2026-10-11). */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Counterpart } from "../../core/counterpart.js";
import {
  Store,
  assertPreMigrationTarget,
  isStoreError,
  paths,
  pendingMigration,
  preMigrationDir,
} from "../../core/store/index.js";
import type { EventRow } from "../../core/store/index.js";
import { BUSY_TIMEOUT_MS, journalModeOf } from "../../core/store/db.js";
import { JOURNAL_COPY_FAILED_EVENT, JOURNAL_COPY_WRITTEN_EVENT } from "../../core/self/journal-file.js";
// The same vocabulary the hook's stand-down uses, so the terminal and the
// console cannot end up with two answers to "why did it not open".
import { describeFault, faultPath, faultId } from "./standdown.js";
import { finding, newestRows, payloadOf } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

// ── will it open the way a session opens it ─────────────────────────────────

/**
 * WHETHER `Counterpart.open` SUCCEEDS — which is a different question from the
 * one the `Store` finding above answers, and the difference is the whole of H1.
 *
 * The `Store` finding reads the DIRECTORY: is there a store here, and is it the
 * one the config names. A store can pass that and still throw at every session
 * start, because opening a counterpart does more than open a database —
 * `Schemas.open` scans every `type: "schema"` row and reads each one's prose
 * file. One missing file, or one row a removal left behind, and every hook in
 * every session stands down: no wake, no recall, no capture, and until now
 * nothing said so while `doctor` printed GREEN Store on the line above.
 *
 * READ BY THE CALLER, like `readCheckout` — and for the same reason it is not
 * taken inside `doctorFindings`, which is pure over its input and never opens
 * anything. The session-start reading does not take it at all: a hook that got
 * as far as composing a notice has ALREADY opened its counterpart, so paying for
 * a second open there would buy a fact it has in hand.
 */
export interface OpenReading {
  readonly dir: string;
  readonly ok: boolean;
  /** The `StoreErrorCode` (or `HOOK_FAILED`) that came back. Null when it opened. */
  readonly code: string | null;
  /** Plain words for `code` (`standdown.ts`). Empty when it opened. */
  readonly reason: string;
  /**
   * TRUE for the one refusal that is not a fault: `STORE_UNINITIALIZED`, which
   * an OBSERVER gets on a store that does not exist yet or is a schema behind.
   * The hooks run as OWNER and initialize or migrate it, so grading this red
   * would make the console lie for the window between a deploy and the first
   * hook that follows it.
   */
  readonly migratable: boolean;
  /**
   * TRUE for the other refusal that is not a fault of the store: it was BUSY.
   * Another process held it for the moment this reading wanted it, which says
   * nothing about whether a session could open it a second later. Amber, and the
   * fix is to ask again — the same judgement the hook's transient stand-down
   * makes with the same predicate (`db.ts#isLocked`).
   */
  readonly busy: boolean;
  /** The path the error named, when it named one. Never memory text (§5 G10). */
  readonly path: string | null;
  /** The ROW the error named, when it named one — an id, never memory text.
   *  `MEMORY_BODY_MISSING` carries one and no path, because on this floor the
   *  words are the row and there is no file to restore (review B, MAJOR-3). */
  readonly id: string | null;
  /**
   * The schema upgrade the next session will run, when the store is behind —
   * and whether the copy it takes first can be made. An observer never
   * migrates, so without this the open reads fine (or merely "behind") while
   * every hook refuses `MIGRATION_SNAPSHOT_FAILED`. Absent: not behind.
   */
  readonly migration?: MigrationReading;
}

export interface MigrationReading {
  readonly found: string;
  readonly expected: number;
  /** Where the copy would go; null when there is nowhere. */
  readonly dir: string | null;
  /** Why the copy could not be made, or null when the dry run passed. */
  readonly problem: string | null;
}

/**
 * The pre-migration copy's preconditions, tried without taking it: the
 * destination passes the store's own checks, and a probe directory can be
 * made there and removed again (only what the probe itself created goes). The
 * probe's name is a `.partial-…` one, so if its removal failed the daily sweep
 * would take it.
 */
export function probePreMigration(storeDir: string, snapshotsDir?: string): MigrationReading | null {
  const dbPath = paths.operational(storeDir);
  const pending = pendingMigration(dbPath);
  if (pending === null) return null;
  const dir = preMigrationDir(dbPath, snapshotsDir);
  try {
    const real = assertPreMigrationTarget(dbPath, dir);
    const instant = new Date().toISOString().replace(/[:.]/g, "-");
    const probe = join(real, `.partial-${instant}-${String(process.pid)}`);
    const first = mkdirSync(probe, { recursive: true });
    rmSync(first ?? probe, { recursive: true, force: true });
    return { ...pending, dir, problem: null };
  } catch (err) {
    return { ...pending, dir, problem: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * "Writes nothing" here means NO STORE CONTENT. It is an observer open, so no
 * row, no prose file and no meta key changes — but any reader of a WAL database
 * touches the `-shm`, and one that finds no `-shm` or `-wal` beside the file
 * CREATES them, exactly as every other reader does (`store/paths.ts#isDatabaseSidecar`
 * is the same exception master's own suites take when they hash a store and mean
 * "nothing wrote"). Anyone comparing store directories should expect that.
 */
export function readCounterpartOpen(
  dir: string,
  /** Injectable so the failure branches are provable without a broken fixture;
   *  the fixture test is still the one that proves the real path. */
  open: (d: string) => { close: () => void } = (d) => Counterpart.open({ dir: d, observer: true }),
  /** The host configuration's `snapshots.dir`, for the pre-migration dry run. */
  snapshotsDir?: string,
): OpenReading {
  let opened: { close: () => void } | null = null;
  const migration = probePreMigration(dir, snapshotsDir);
  const behind = migration === null ? {} : { migration };
  try {
    // OBSERVER, because `doctor` is an instrument: it reads and never writes,
    // and an owner open of a store that is not there would MINT one.
    opened = open(dir);
    return {
      ...behind,
      dir,
      ok: true,
      code: null,
      reason: "",
      migratable: false,
      busy: false,
      path: null,
      id: null,
    };
  } catch (err) {
    const fault = describeFault(err);
    return {
      ...behind,
      dir,
      ok: false,
      code: fault.code,
      reason: fault.reason,
      migratable: isStoreError(err, "STORE_UNINITIALIZED"),
      busy: fault.kind === "transient",
      path: faultPath(err),
      id: faultId(err),
    };
  } finally {
    // Closed immediately, so this reading and the store the console opens next
    // never hold the same database at once.
    try {
      opened?.close();
    } catch {
      /* a close that failed is not a state of the store */
    }
  }
}

export function openFindings(reading: OpenReading): Finding[] {
  // The Rollback line says it, with what to do (`rollbackFindings`).
  if (reading.code === "STORE_ROLLED_BACK") return [];
  const data: Record<string, string | number | boolean | null> = {
    dir: reading.dir,
    ok: reading.ok,
    code: reading.code,
    busy: reading.busy,
    path: reading.path,
  };
  // A STORE BEHIND THIS BUILD is graded on what a SESSION will meet, not on
  // what this observer open met: the session copies it, then upgrades it.
  const m = reading.migration;
  if (m !== undefined) {
    const upgrade = { ...data, found: m.found, expected: m.expected, snapshotsDir: m.dir, problem: m.problem };
    return [
      m.problem !== null
        ? finding(
            "store-open",
            "red",
            "Store open",
            `${reading.dir} is on schema v${m.found} and this build needs v${m.expected}; the copy taken before the upgrade cannot be made (${m.problem}), so every hook stands down with MIGRATION_SNAPSHOT_FAILED`,
            `Make ${m.dir ?? "a snapshots directory"} writable${m.dir === null ? " and name it in snapshots.dir" : " (or point snapshots.dir at one outside the store)"}; the store is unchanged, and the previous build still opens it.`,
            upgrade,
          )
        : finding(
            "store-open",
            "amber",
            "Store open",
            `${reading.dir} is on schema v${m.found}; the next session copies it to ${m.dir ?? "?"} and upgrades it to v${m.expected}`,
            "Nothing to do: start a session, then run counterparts doctor again.",
            upgrade,
          ),
    ];
  }
  if (reading.ok) {
    return [
      finding("store-open", "green", "Store open", `${reading.dir} opens as a session opens it`, "", data),
    ];
  }
  const said = `${reading.dir}: will not open — ${reading.code ?? "?"}: ${reading.reason}`;
  if (reading.busy) {
    // NOT A STATE OF THE STORE. Another process held it for the moment this
    // reading wanted it; a second later it may open perfectly. Grading that red
    // would put an alarm on a race, which is how a diagnostic teaches its reader
    // to skip a line.
    return [
      finding(
        "store-open",
        "amber",
        "Store open",
        `${reading.dir}: the database was busy right now, so the open was not graded`,
        "Run: counterparts doctor again. If it stays busy, something is holding the store — read the Journal line.",
        data,
      ),
    ];
  }
  if (reading.migratable) {
    return [
      finding(
        "store-open",
        "amber",
        "Store open",
        `${said} — read as an instrument, which may not write at open`,
        "The next hook to run as owner initializes or migrates it; run: counterparts install if none does.",
        data,
      ),
    ];
  }
  return [
    finding(
      "store-open",
      "red",
      "Store open",
      said,
      reading.path !== null
        ? `Every session's hooks stand down here. Restore ${reading.path} — a row in this store points at it, and the read path chases it at every open.`
        : reading.id !== null
          ? // THE ROW, NAMED. On the file floor this said "restore <path>" and the
            // owner could fetch that one file from a snapshot; the words are the
            // row now, so the id is the only handle there is — and without it he
            // cannot tell which of thousands of rows to act on (review B,
            // MAJOR-3). There is no repair COMMAND for this today, so the two
            // real exits are named rather than a command invented.
            `Every session's hooks stand down here: no wake, no recall, no capture. The row the read path ` +
            `met is ${reading.id} — its words are gone and its content hash still names them, which no write ` +
            `path in this build produces. THERE MAY BE MORE THAN ONE: this names the row that threw, and ` +
            `counterparts verify --dir <store> lists every such row. Two ways out, both the owner's call: ` +
            `restore a snapshot over the store (see the Snapshot line), or remove those rows — ` +
            `counterparts remove <id> --confirm --dir <store> — which tombstones each one and lets sessions ` +
            `start again, permanently and without its words.`
          : "Every session's hooks stand down here: no wake, no recall, no capture. The code names what the read path met.",
      data,
    ),
  ];
}

/** Coverage of the semantic channel — `verify`'s two census numbers, reused. */
/**
 * Which journal mode box 2 is actually in — the one surface on which a
 * conversion that did not take becomes visible.
 *
 * `openDb` asks for WAL on a writer open and swallows a refusal, because a hook
 * must not die because the worker happened to be committing (`store/db.ts`).
 * That is right, and it is silent, so the MODE is the report. Reading it takes
 * no lock and converts nothing: this is an observer's question, and the console
 * that asks it is standing down.
 */
export function journalFindings(store: Store): Finding[] {
  const mode = journalModeOf(paths.operational(store.dir));
  const data = { mode };
  if (mode === "wal") {
    return [
      finding("journal", "green", "Journal mode", `wal (busy timeout ${BUSY_TIMEOUT_MS} ms)`, "", data),
    ];
  }
  return [
    finding(
      "journal",
      "amber",
      "Journal mode",
      `${mode}, not wal — several processes hold this store open at once, and only in wal does a reader never wait for the writer`,
      "Open one session, or run any command that writes: the next writer open converts it. If it keeps reading this, something on an older build is opening the store and setting it back.",
      data,
    ),
  ];
}

/**
 * THE JOURNAL'S MARKDOWN COPY (2026-09-20, F6) — A LINE ONLY WHEN ONE IS OWED.
 *
 * This group returns NOTHING in the ordinary case, which is the deliberate part.
 * The copy is derived: it is rewritten on every chapter and refilled at every
 * boundary, so "how many files are there" is a number nobody needs and a
 * permanently green line here would be one more row the owner learns to skip
 * (the same argument `snapshotFindings` makes about a permanently amber one).
 *
 * The one reading worth a line is a STANDING failure: the newest
 * `journal.copy.failed` row is newer than the newest `journal.copy.written`,
 * which means the last attempt did not land and the next one has not fixed it.
 * Amber, never red — the chapter itself is a row in the database and is not at
 * risk, which is exactly what the detail says.
 */
export function journalCopyFindings(store: Store): Finding[] {
  const day = store.livedDay();
  const failed = newestRows(store, JOURNAL_COPY_FAILED_EVENT, 1, day);
  if (failed.unknown || failed.rows.length === 0) return [];
  const newestFailed = failed.rows[failed.rows.length - 1] as EventRow;
  const written = newestRows(store, JOURNAL_COPY_WRITTEN_EVENT, 1, day);
  const newestWritten = written.rows[written.rows.length - 1];
  // A later success is the fix, and a fixed fault is not a line.
  if (newestWritten !== undefined && newestWritten.seq > newestFailed.seq) return [];
  const payload = payloadOf(newestFailed);
  const reason = typeof payload["reason"] === "string" ? payload["reason"] : "no reason recorded";
  const on = typeof payload["date"] === "string" ? payload["date"] : "(date unrecorded)";
  const episode = newestFailed.ref ?? "(unrecorded)";
  return [
    finding(
      "journal-copy",
      "amber",
      "Journal copy",
      `the readable copy of the journal could not be written on ${on} (${episode}: ${reason}), and nothing has written one since. The chapters themselves are rows in the database and are unharmed.`,
      "Check that the store directory is writable; the next chapter or the next session boundary writes it again, and deleting journal/ loses nothing.",
      { episode, reason, on },
    ),
  ];
}
