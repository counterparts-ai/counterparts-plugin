import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Counterpart } from "../../core/counterpart.js";
import {
  Store,
  assertPreMigrationTarget,
  isStoreError,
  paths,
  pendingMigration,
  preMigrationDir
} from "../../core/store/index.js";
import { BUSY_TIMEOUT_MS, journalModeOf } from "../../core/store/db.js";
import { JOURNAL_COPY_FAILED_EVENT, JOURNAL_COPY_WRITTEN_EVENT } from "../../core/self/journal-file.js";
import { describeFault, faultPath, faultId } from "./standdown.js";
import { finding, newestRows, payloadOf } from "./doctor-finding.js";
export function probePreMigration(storeDir, snapshotsDir) {
  const dbPath = paths.operational(storeDir);
  const pending = pendingMigration(dbPath);
  if (pending === null)
    return null;
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
export function readCounterpartOpen(dir, open = (d) => Counterpart.open({ dir: d, observer: true }), snapshotsDir) {
  let opened = null;
  const migration = probePreMigration(dir, snapshotsDir);
  const behind = migration === null ? {} : { migration };
  try {
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
      id: null
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
      id: faultId(err)
    };
  } finally {
    try {
      opened?.close();
    } catch {}
  }
}
export function openFindings(reading) {
  if (reading.code === "STORE_ROLLED_BACK")
    return [];
  const data = {
    dir: reading.dir,
    ok: reading.ok,
    code: reading.code,
    busy: reading.busy,
    path: reading.path
  };
  const m = reading.migration;
  if (m !== undefined) {
    const upgrade = { ...data, found: m.found, expected: m.expected, snapshotsDir: m.dir, problem: m.problem };
    return [
      m.problem !== null ? finding("store-open", "red", "Store open", `${reading.dir} is on schema v${m.found} and this build needs v${m.expected}; the copy taken before the upgrade cannot be made (${m.problem}), so every hook stands down with MIGRATION_SNAPSHOT_FAILED`, `Make ${m.dir ?? "a snapshots directory"} writable${m.dir === null ? " and name it in snapshots.dir" : " (or point snapshots.dir at one outside the store)"}; the store is unchanged, and the previous build still opens it.`, upgrade) : finding("store-open", "amber", "Store open", `${reading.dir} is on schema v${m.found}; the next session copies it to ${m.dir ?? "?"} and upgrades it to v${m.expected}`, "Nothing to do: start a session, then run counterparts doctor again.", upgrade)
    ];
  }
  if (reading.ok) {
    return [
      finding("store-open", "green", "Store open", `${reading.dir} opens as a session opens it`, "", data)
    ];
  }
  const said = `${reading.dir}: will not open — ${reading.code ?? "?"}: ${reading.reason}`;
  if (reading.busy) {
    return [
      finding("store-open", "amber", "Store open", `${reading.dir}: the database was busy right now, so the open was not graded`, "Run: counterparts doctor again. If it stays busy, something is holding the store — read the Journal line.", data)
    ];
  }
  if (reading.migratable) {
    return [
      finding("store-open", "amber", "Store open", `${said} — read as an instrument, which may not write at open`, "The next hook to run as owner initializes or migrates it; run: counterparts install if none does.", data)
    ];
  }
  return [
    finding("store-open", "red", "Store open", said, reading.path !== null ? `Every session's hooks stand down here. Restore ${reading.path} — a row in this store points at it, and the read path chases it at every open.` : reading.id !== null ? `Every session's hooks stand down here: no wake, no recall, no capture. The row the read path ` + `met is ${reading.id} — its words are gone and its content hash still names them, which no write ` + `path in this build produces. THERE MAY BE MORE THAN ONE: this names the row that threw, and ` + `counterparts verify --dir <store> lists every such row. Two ways out, both the owner's call: ` + `restore a snapshot over the store (see the Snapshot line), or remove those rows — ` + `counterparts remove <id> --confirm --dir <store> — which tombstones each one and lets sessions ` + `start again, permanently and without its words.` : "Every session's hooks stand down here: no wake, no recall, no capture. The code names what the read path met.", data)
  ];
}
export function journalFindings(store) {
  const mode = journalModeOf(paths.operational(store.dir));
  const data = { mode };
  if (mode === "wal") {
    return [
      finding("journal", "green", "Journal mode", `wal (busy timeout ${BUSY_TIMEOUT_MS} ms)`, "", data)
    ];
  }
  return [
    finding("journal", "amber", "Journal mode", `${mode}, not wal — several processes hold this store open at once, and only in wal does a reader never wait for the writer`, "Open one session, or run any command that writes: the next writer open converts it. If it keeps reading this, something on an older build is opening the store and setting it back.", data)
  ];
}
export function journalCopyFindings(store) {
  const day = store.livedDay();
  const failed = newestRows(store, JOURNAL_COPY_FAILED_EVENT, 1, day);
  if (failed.unknown || failed.rows.length === 0)
    return [];
  const newestFailed = failed.rows[failed.rows.length - 1];
  const written = newestRows(store, JOURNAL_COPY_WRITTEN_EVENT, 1, day);
  const newestWritten = written.rows[written.rows.length - 1];
  if (newestWritten !== undefined && newestWritten.seq > newestFailed.seq)
    return [];
  const payload = payloadOf(newestFailed);
  const reason = typeof payload["reason"] === "string" ? payload["reason"] : "no reason recorded";
  const on = typeof payload["date"] === "string" ? payload["date"] : "(date unrecorded)";
  const episode = newestFailed.ref ?? "(unrecorded)";
  return [
    finding("journal-copy", "amber", "Journal copy", `the readable copy of the journal could not be written on ${on} (${episode}: ${reason}), and nothing has written one since. The chapters themselves are rows in the database and are unharmed.`, "Check that the store directory is writable; the next chapter or the next session boundary writes it again, and deleting journal/ loses nothing.", { episode, reason, on })
  ];
}
