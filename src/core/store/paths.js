import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, relative, isAbsolute } from "node:path";
import { StoreError, isStoreError } from "./errors.js";
export const DATA_DIR_ENV = "COUNTERPARTS_DATA_DIR";
export const REQUIRE_EXPLICIT_DIR_ENV = "COUNTERPARTS_REQUIRE_EXPLICIT_DIR";
export const DEFAULT_DATA_DIR_NAME = ".counterparts";
export const DEFAULT_STORE_SUBDIR = "store";
export const SNAPSHOTS_DIR_NAME = "snapshots";
export function defaultSnapshotsDir(storeDir) {
  const store = resolve(storeDir);
  if (basename(store) !== DEFAULT_STORE_SUBDIR)
    return null;
  return join(dirname(store), SNAPSHOTS_DIR_NAME);
}
export const DATABASE_FILE = "counterparts.sqlite";
export const FORBIDDEN_ROOT_NAMES = [".bansai", ".claude-engram"];
export function forbiddenRoots() {
  const home = homedir();
  return FORBIDDEN_ROOT_NAMES.map((n) => resolve(join(home, n)));
}
export function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
}
export function assertSafeDataDir(dir) {
  const resolved = resolve(dir);
  for (const root of forbiddenRoots()) {
    if (isWithin(root, resolved)) {
      throw new StoreError("DATA_DIR_FORBIDDEN", { root });
    }
  }
  return resolved;
}
export const EXPLICIT_DIR_ARMING_VALUES = ["1", "true", "on"];
export const EXPLICIT_DIR_DISARMING_VALUES = ["0", "false", "off"];
export function explicitDirSetting(env = process.env) {
  const value = (env[REQUIRE_EXPLICIT_DIR_ENV] ?? "").trim();
  if (value.length === 0)
    return { armed: false, malformed: null };
  const word = value.toLowerCase();
  if (EXPLICIT_DIR_ARMING_VALUES.includes(word))
    return { armed: true, value };
  if (EXPLICIT_DIR_DISARMING_VALUES.includes(word))
    return { armed: false, malformed: null };
  return { armed: false, malformed: value };
}
export function explicitDirRequired(env = process.env) {
  const setting = explicitDirSetting(env);
  if (!setting.armed && setting.malformed !== null) {
    throw new StoreError("EXPLICIT_DIR_GUARD_MALFORMED", {
      guard: REQUIRE_EXPLICIT_DIR_ENV,
      value: setting.malformed,
      accepted: EXPLICIT_DIR_ARMING_VALUES.join("|"),
      off: EXPLICIT_DIR_DISARMING_VALUES.join("|")
    });
  }
  return setting.armed;
}
export function explicitDirMalformedRefusal(value) {
  return `refused: ${REQUIRE_EXPLICIT_DIR_ENV} is set to '${value}', which this will not guess at — it arms on ` + `${EXPLICIT_DIR_ARMING_VALUES.join(", ")} and stands down on ${EXPLICIT_DIR_DISARMING_VALUES.join(", ")} ` + "(case and surrounding whitespace ignored), and a safety guard fails closed on anything else. " + "Unset it, set it to 1, or set it to 0.";
}
export function describeGuardRefusal(err, remedy) {
  if (isStoreError(err, "IMPLICIT_DEFAULT_DIR_REFUSED")) {
    return `refused: ${String(err.detail["guard"])} and no store was named, so this would have opened the ` + `default data dir, ${String(err.detail["dir"])} — on a machine with an install, somebody's live ` + `memory. ${remedy}`;
  }
  if (isStoreError(err, "EXPLICIT_DIR_GUARD_MALFORMED")) {
    return explicitDirMalformedRefusal(String(err.detail["value"]));
  }
  return null;
}
export function defaultDataDir() {
  return join(homedir(), DEFAULT_DATA_DIR_NAME, DEFAULT_STORE_SUBDIR);
}
export function dataDir(env = process.env) {
  const fromEnv = env[DATA_DIR_ENV];
  if (fromEnv && fromEnv.trim().length > 0)
    return assertSafeDataDir(fromEnv);
  const fallback = defaultDataDir();
  const setting = explicitDirSetting(env);
  if (setting.armed) {
    throw new StoreError("IMPLICIT_DEFAULT_DIR_REFUSED", {
      guard: `${REQUIRE_EXPLICIT_DIR_ENV}=${setting.value}`,
      dir: fallback,
      remedy: `name the store: pass dir (--dir on a command line, "dataDir" in a host configuration), or set ${DATA_DIR_ENV}`
    });
  }
  explicitDirRequired(env);
  return assertSafeDataDir(fallback);
}
export const LAYOUT = [
  {
    name: DATABASE_FILE,
    match: "prefix",
    backup: true,
    why: "Box 2 — the canonical database. The memories themselves live here since the floor (schema v6): bodies, their archived versions, and every structured field. Backed up as a database, never rebuilt."
  },
  {
    name: "cache",
    match: "exact",
    backup: false,
    why: "Box 3 — rebuildable embeddings/FTS. Never backed up; its loss is a re-index."
  },
  {
    name: "spans",
    match: "exact",
    backup: false,
    why: "remember/'s capture buffer: conversation text awaiting its write-up, kept 3 days after that (never more than 14). Never backed up: backups never hold conversation text (Mike, 2026-10-13)."
  },
  {
    name: "journal",
    match: "exact",
    backup: false,
    why: "The counterpart's diary, ALSO written as markdown files as each chapter lands (owner, 2026-09-17 §15 item 9) — a COPY, kept because plain files outlive the system that wrote them. The chapters themselves are rows like every other memory, so this directory is derived: it is not backed up, and a restored store regenerates every file from its rows at the next boundary. Deliberately excluded rather than merely absent: copying it put removed episodes' words into every rotating snapshot as plain greppable markdown (f6f7 review MAJOR-5)."
  },
  {
    name: "sessions",
    match: "exact",
    backup: false,
    why: "adapters/sessions.ts — the live-session registry a host's hooks leave for its tools, plus the notes one process leaves another inside it: adapters/expansions.ts' handle log and associate/pending.ts' co-activation deltas (sessions/association/). Host state, not memory: no content, and its loss costs a lazy bind or one pass's reinforcement, never a memory. New state of that kind goes INSIDE this directory rather than beside it, because `assertLayout()` runs in the store's constructor and a store opened by code that predates the name would refuse to open at all."
  }
];
export function isDatabaseSidecar(name) {
  return name.endsWith("-shm");
}
export function holdsNoData(path) {
  if (isDatabaseSidecar(path))
    return true;
  if (!path.endsWith("-wal"))
    return false;
  try {
    return statSync(path).size === 0;
  } catch {
    return true;
  }
}
export function classifyTopLevel(name) {
  return LAYOUT.find((e) => e.match === "exact" ? e.name === name : name.startsWith(e.name));
}
export function assertLayoutClassified(names) {
  for (const name of names) {
    if (!classifyTopLevel(name)) {
      throw new StoreError("LAYOUT_UNCLASSIFIED", { name });
    }
  }
}
export const paths = {
  operational: (dir) => join(dir, DATABASE_FILE),
  cacheDir: (dir) => join(dir, "cache"),
  cache: (dir) => join(dir, "cache", "cache.sqlite")
};
export const PRE_ROWS_MARKERS = ["operational.sqlite", "prose", "versions"];
export const PRE_ROWS_READABLE_BY = "floor/v5-last";
export function preRowsMarkersIn(dir) {
  const found = PRE_ROWS_MARKERS.filter((name) => existsSync(join(dir, name)));
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (!PRE_ROWS_MARKERS.some((m) => lower.startsWith(`${m}-`)))
      continue;
    if (!found.includes(entry))
      found.push(entry);
  }
  return found;
}
export function preRowsLeftoversAreEmpty(dir) {
  const holdsAFile = (at) => {
    let names;
    try {
      names = readdirSync(at);
    } catch {
      return false;
    }
    for (const name of names) {
      const full = join(at, name);
      try {
        if (statSync(full).isDirectory() ? holdsAFile(full) : true)
          return true;
      } catch {}
    }
    return false;
  };
  return !["prose", "versions"].some((d) => holdsAFile(join(dir, d)));
}
export function describePreRowsRefusal(err, remedy) {
  if (!isStoreError(err, "STORE_PRE_ROWS"))
    return null;
  const detail = err.detail;
  const dir = typeof detail["dir"] === "string" ? detail["dir"] : String(detail["path"] ?? "");
  const found = String(detail["found"] ?? "");
  const own = typeof detail["remedy"] === "string" ? detail["remedy"] : null;
  const shape = detail["reason"] === "no-body-column";
  const what = shape ? `it is a schema v${found} database under this build's own filename` : `it keeps its memories in files (${found})`;
  return `refused: ${dir} was written before this build's floor — ${what}, ` + `and this build keeps them in the database. NOTHING WAS TOUCHED. ` + (own ?? `The build that reads it is tagged ${PRE_ROWS_READABLE_BY}: check it out ` + `(git checkout ${PRE_ROWS_READABLE_BY}) to open this store, or name a store this build wrote.`) + ` ${remedy}`;
}
