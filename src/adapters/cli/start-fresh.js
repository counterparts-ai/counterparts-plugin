import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";
import {
  PRE_ROWS_READABLE_BY,
  assertSafeDataDir,
  dateOf,
  isWithin,
  preRowsMarkersIn
} from "../../core/store/index.js";
import { SESSIONS_DIR } from "../sessions.js";
export const PARKED_INFIX = "parked";
export const BLANK_INFIX = "blank";
export const OPEN_WINDOW_MS = 10 * 60000;
export function sight(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return { path, present: false, symlink: false, entries: 0 };
  }
  if (stat.isSymbolicLink())
    return { path, present: true, symlink: true, entries: 0 };
  if (!stat.isDirectory())
    return { path, present: true, symlink: false, entries: 0 };
  let entries = 0;
  try {
    entries = readdirSync(path).length;
  } catch {
    entries = 1;
  }
  return { path, present: true, symlink: false, entries };
}
export function parkRefusal(label, path, configPath, home = homedir()) {
  const written = resolve(path);
  const forbidden = forbiddenRefusal(label, written);
  if (forbidden !== null)
    return forbidden;
  const real = realpathDeep(written);
  const forbiddenReal = forbiddenRefusal(label, real);
  if (forbiddenReal !== null)
    return forbiddenReal;
  if (real === parsePath(real).root) {
    return `refused: the ${label} resolves to a filesystem root (${real}). Nothing here will rename that.`;
  }
  if (real === realpathDeep(home)) {
    return `refused: the ${label} resolves to your home directory (${real}). Nothing here will rename that.`;
  }
  if (isWithin(written, configPath)) {
    return `refused: the ${label} at ${written} CONTAINS the configuration ${configPath}. ` + "Parking it would move the file that says where your memory is, and the hooks would " + "read a path that is no longer there. The store belongs one level below the " + "configuration (`install` puts it there); move it before starting fresh.";
  }
  const seen = sight(path);
  if (seen.symlink) {
    let target = "somewhere else";
    try {
      target = realpathDeep(written);
    } catch {}
    return `refused: the ${label} at ${written} is a SYMBOLIC LINK (to ${target}). ` + "Renaming a link moves the link and leaves the real directory exactly where it is — " + "so the memories would stay live, still open to anything holding them, and no longer " + "reachable from your configuration. Park the real directory by hand, or point " + `"dataDir" at it directly.`;
  }
  return null;
}
function forbiddenRefusal(label, path) {
  try {
    assertSafeDataDir(path);
    return null;
  } catch (err) {
    const root = err !== null && typeof err === "object" && "detail" in err ? String(err.detail["root"] ?? "a live store") : "a live store";
    return `refused by name: the ${label} (${path}) is inside ${root}. ` + "That is a live memory this package never touches — not to read it, not to move it, " + "not to rename it (CLAUDE.md, the second safety rule).";
  }
}
export function pathGuard(label, written, configPath, home = homedir(), source = "the configuration") {
  const raw = written.trim();
  if (raw.length === 0) {
    return `refused: ${source} gives no path for the ${label}, so there is nothing to act on.`;
  }
  if (!isAbsolute(raw)) {
    return `refused: ${source} names "${raw}" as the ${label}, which is not an absolute path. ` + "`install` always writes an absolute one, and for a reason: the hook, the worker and " + "the MCP server are launched by a host from a working directory nobody chose, so a " + "relative path names a different directory in every one of them — and this would act " + `on whatever happened to sit at that name in ITS working directory (${resolve(raw)}). ` + "A leading `~` is a shell's idea, not a path.";
  }
  return parkRefusal(label, raw, configPath, home);
}
export function parkedSiblingRefusal(label, candidate, beside, base) {
  const path = resolve(candidate);
  if (dirname(path) !== resolve(beside)) {
    return `refused: the ${label} recorded in this store is ${path}, which does not sit beside ` + `${resolve(beside)}. A record is a row in a database, not an instruction — anything it ` + "names that is not a parked directory of this store is not a thing to rename.";
  }
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}\\.${PARKED_INFIX}-\\d{4}-\\d{2}-\\d{2}(-\\d+)?$`);
  if (!pattern.test(basename(path))) {
    return `refused: the ${label} recorded in this store is ${path}, and '${basename(path)}' is ` + `not a name this package writes — those are '${base}.${PARKED_INFIX}-<date>' with an ` + "optional '-N'. A record is a row in a database; this will not rename something " + "because a row said to.";
  }
  return null;
}
export function realpathDeep(path) {
  const resolved = resolve(path);
  let head = resolved;
  const tail = [];
  for (;; ) {
    try {
      const real = realpathSync(head);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head)
        return resolved;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}
export function parkedPath(path, infix, date, taken = existsSync) {
  const base = `${resolve(path)}.${infix}-${date}`;
  if (!taken(base))
    return base;
  for (let n = 2;n < 1000; n += 1) {
    const candidate = `${base}-${String(n)}`;
    if (!taken(candidate))
      return candidate;
  }
  throw new Error(`no free parked name beside ${path} for ${date}`);
}
export function readLiveness(storeDir, now, windowMs = OPEN_WINDOW_MS) {
  const signs = [];
  const recent = [];
  let unreadable = false;
  const sessions = join(storeDir, SESSIONS_DIR);
  let names;
  try {
    names = readdirSync(sessions);
  } catch {
    names = [];
    unreadable = existsSync(sessions);
  }
  for (const name of names) {
    if (!name.endsWith(".json"))
      continue;
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(sessions, name), "utf8"));
    } catch {
      continue;
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      continue;
    const rec = raw;
    if (rec["endedAt"] !== null && rec["endedAt"] !== undefined)
      continue;
    const last = rec["lastBoundaryAt"];
    if (typeof last !== "number")
      continue;
    const agoMs = now - last;
    if (agoMs > windowMs || agoMs < -windowMs)
      continue;
    const id = typeof rec["sessionId"] === "string" ? rec["sessionId"] : name.replace(/\.json$/, "");
    const scope = typeof rec["scope"] === "string" ? rec["scope"] : "an unrecorded directory";
    signs.push({ what: `session ${id}`, where: scope, agoMs });
  }
  for (const path of sidecarCandidates(storeDir)) {
    try {
      const agoMs = now - statSync(path).mtimeMs;
      if (agoMs > windowMs || agoMs < -windowMs)
        continue;
      recent.push({ what: basename(path), where: dirname(path), agoMs });
    } catch {
      continue;
    }
  }
  return { signs, recent, unreadable };
}
function sidecarCandidates(storeDir) {
  const out = [];
  for (const dir of [storeDir, join(storeDir, "cache")]) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith("-shm"))
          out.push(join(dir, entry.name));
      }
    } catch {
      continue;
    }
  }
  return out;
}
export function planStartFresh(input) {
  const date = dateOf(input.now);
  const home = input.home ?? homedir();
  const configPath = resolve(input.configPath);
  const empty = {
    shape: "nothing-to-park",
    configPath,
    configPresent: input.configPresent,
    date,
    parks: [],
    alreadyParked: [],
    snapshotsDir: null,
    snapshotsElsewhere: null,
    snapshotsLeft: null,
    strayTempStores: [],
    storeEntries: 0,
    preRowsMarkers: [],
    liveness: { signs: [], recent: [], unreadable: false }
  };
  if (input.configPresent && (input.dataDir === undefined || input.dataDir.trim().length === 0)) {
    return {
      ...empty,
      storeDir: "",
      refusal: `refused: ${configPath} names no "dataDir", so there is no way to know which store your ` + "hooks open — with that key absent they fall back to $COUNTERPARTS_DATA_DIR, which is a " + 'fact about a shell rather than about this file. Add "dataDir": "<absolute path>" to the ' + "configuration first (that is what `counterparts install` writes), then run this again."
    };
  }
  const written = input.dataDir === undefined ? "" : input.dataDir.trim();
  const storeDir = written.length > 0 && isAbsolute(written) ? resolve(written) : "";
  if (!input.configPresent) {
    return { ...empty, storeDir, refusal: null };
  }
  const refusal = pathGuard("store", written, configPath, home, `${configPath}'s "dataDir"`);
  if (refusal !== null) {
    return { ...empty, storeDir, shape: "park", refusal };
  }
  const store = sight(storeDir);
  const beside = join(dirname(storeDir), "snapshots");
  const configured = input.snapshotsConfigured;
  const snapshotsElsewhere = configured !== undefined && configured.trim().length > 0 && resolve(configured) !== beside ? resolve(configured) : null;
  const snapshotsDir = snapshotsElsewhere === null && basename(storeDir) === "store" ? beside : null;
  const taken = input.taken ?? existsSync;
  if (!store.present || store.entries === 0) {
    const parked = siblingsParked(storeDir, taken);
    return {
      ...empty,
      storeDir,
      snapshotsDir,
      snapshotsElsewhere,
      shape: parked.length > 0 && !store.present ? "resume" : "nothing-to-park",
      alreadyParked: parked,
      storeEntries: store.entries,
      refusal: null
    };
  }
  const snapshotsSeen = snapshotsDir === null ? null : sight(snapshotsDir);
  let snapshotsLeft = null;
  let parkSnapshots = false;
  if (snapshotsDir !== null && snapshotsSeen !== null && snapshotsSeen.present) {
    const why = parkRefusal("snapshots directory", snapshotsDir, configPath, home);
    if (why !== null) {
      snapshotsLeft = why;
    } else {
      const cross = sameFilesystemRefusal(snapshotsDir);
      if (cross !== null)
        snapshotsLeft = cross;
      else
        parkSnapshots = true;
    }
  }
  const crossDevice = sameFilesystemRefusal(storeDir);
  if (crossDevice !== null) {
    return {
      ...empty,
      storeDir,
      snapshotsDir,
      snapshotsElsewhere,
      snapshotsLeft,
      shape: "park",
      refusal: crossDevice
    };
  }
  const suffix = pairedSuffix([storeDir, ...parkSnapshots && snapshotsDir !== null ? [snapshotsDir] : []], date, taken);
  const parks = [];
  if (parkSnapshots && snapshotsDir !== null) {
    parks.push({ label: "snapshots", from: snapshotsDir, to: `${snapshotsDir}${suffix}` });
  }
  parks.push({ label: "store", from: storeDir, to: `${storeDir}${suffix}` });
  return {
    shape: "park",
    configPath,
    configPresent: input.configPresent,
    storeDir,
    date,
    parks,
    alreadyParked: [],
    snapshotsDir,
    snapshotsElsewhere,
    snapshotsLeft,
    strayTempStores: strayTempStoresBeside(storeDir),
    storeEntries: store.entries,
    preRowsMarkers: preRowsMarkersIn(storeDir),
    liveness: readLiveness(storeDir, input.now),
    refusal: null
  };
}
export function sameFilesystemRefusal(storeDir) {
  let here;
  let parent;
  try {
    here = statSync(storeDir).dev;
    parent = statSync(dirname(storeDir)).dev;
  } catch (err) {
    return `refused: could not read ${storeDir} or its parent (${String(err.message ?? err)}).`;
  }
  if (here === parent)
    return null;
  return `refused: ${storeDir} is on a different filesystem from ${dirname(storeDir)}, so moving it ` + "beside itself would be a COPY followed by a DELETE rather than one atomic rename — and this " + "command does not delete, ever. Move the store by hand with a tool you trust, verify the copy, " + `and point "dataDir" at whatever you want the new store to be.`;
}
export function pairedSuffix(paths, date, taken = existsSync) {
  const free = (suffix) => paths.every((p) => !taken(`${resolve(p)}${suffix}`));
  const base = `.${PARKED_INFIX}-${date}`;
  if (free(base))
    return base;
  for (let n = 2;n < 1000; n += 1) {
    if (free(`${base}-${String(n)}`))
      return `${base}-${String(n)}`;
  }
  throw new Error(`no free parked suffix for ${date}`);
}
export function strayTempStoresBeside(storeDir) {
  const out = [];
  try {
    const prefix = `${basename(storeDir)}.new-`;
    for (const entry of readdirSync(dirname(storeDir))) {
      if (entry.startsWith(prefix))
        out.push(join(dirname(storeDir), entry));
    }
  } catch {
    return out;
  }
  return out.sort();
}
function siblingsParked(storeDir, taken) {
  const out = [];
  try {
    const prefix = `${basename(storeDir)}.${PARKED_INFIX}-`;
    for (const entry of readdirSync(dirname(storeDir))) {
      if (entry.startsWith(prefix))
        out.push(join(dirname(storeDir), entry));
    }
  } catch {
    return out;
  }
  return out.filter((p) => taken(p)).sort();
}
export const REAL_OPS = {
  rename: (from, to) => {
    renameSync(from, to);
  }
};
export function park(steps, ops = REAL_OPS) {
  const done = [];
  for (const step of steps) {
    try {
      ops.rename(step.from, step.to);
      done.push(step);
    } catch (err) {
      const code = err !== null && typeof err === "object" && typeof err.code === "string" ? `${err.code}: ` : "";
      return { done, failed: step, error: `${code}${String(err.message ?? err)}` };
    }
  }
  return { done, failed: null, error: null };
}
export function planLines(plan, landing) {
  const out = [];
  out.push(`Configuration: ${plan.configPath}${plan.configPresent ? "" : " (not there yet)"}`);
  out.push(`Store:         ${plan.storeDir.length > 0 ? plan.storeDir : landing ?? "(unknown)"}`);
  out.push("");
  if (plan.shape === "nothing-to-park") {
    out.push(plan.configPresent ? "Nothing to park: the store your configuration names is not there, or is empty." : "There is no configuration at that path, so there is nothing to park and nothing");
    if (!plan.configPresent) {
      out.push("this command can call your memory. It will do an ordinary first install at the");
      out.push("store path above — and refuse if anything at all is already there.");
    } else {
      out.push("So this is an ordinary first install, and it says so rather than pretending");
      out.push("it moved something.");
    }
    return out;
  }
  if (plan.shape === "resume") {
    out.push("A previous run was interrupted: the store directory is gone and these are");
    out.push("parked beside it —");
    for (const p of plan.alreadyParked)
      out.push(`  ${p}`);
    out.push("");
    out.push("Nothing will be moved. This run only creates the blank store at the path");
    out.push("your configuration names, which is what that run had left to do.");
    return out;
  }
  out.push("It will rename, in this order — one atomic rename each, nothing copied,");
  out.push("nothing deleted, and the old store is never opened:");
  for (const step of plan.parks) {
    out.push(`  ${step.from}`);
    out.push(`    -> ${step.to}`);
  }
  out.push("");
  out.push("Then it will create a blank store at:");
  out.push(`  ${plan.storeDir}`);
  if (plan.strayTempStores.length > 0) {
    out.push("");
    out.push("  Beside your store are part-built stores from interrupted runs:");
    for (const stray of plan.strayTempStores)
      out.push(`    ${stray}`);
    out.push("  Nothing reads them, nothing here will use one, and nothing here will remove");
    out.push("  one. Move them aside whenever you like.");
  }
  if (plan.preRowsMarkers.length > 0) {
    out.push("");
    out.push("  This store is on the OLD FLOOR — it keeps its memories in files");
    out.push(`  (${plan.preRowsMarkers.join(", ")}).`);
    out.push("  This build cannot open it and refuses to try, by name, which is exactly why");
    out.push("  moving it is the right thing to do with it: a rename does not care what floor");
    out.push(`  a directory is on. The build that still reads it is tagged ${PRE_ROWS_READABLE_BY}.`);
  }
  if (plan.snapshotsElsewhere !== null) {
    out.push("");
    out.push(`  Snapshots are configured at ${plan.snapshotsElsewhere}, which is a directory`);
    out.push("  you pointed at rather than one this layout owns, so it is LEFT ALONE — and so");
    out.push("  is any `mirror`. The new store's rotation will share that folder with what is");
    out.push("  already in it: copies of an OLD-FLOOR store are recognised there and never");
    out.push("  deleted or counted, but copies this floor wrote do count toward `keep`, so the");
    out.push("  new store's oldest could rotate out sooner than you expect.");
  } else if (plan.snapshotsLeft !== null) {
    out.push("");
    out.push(`  The snapshots folder at ${plan.snapshotsDir ?? ""} is LEFT WHERE IT IS.`);
    out.push(`    ${plan.snapshotsLeft}`);
    out.push("  That is a reason not to MOVE it, not a reason to stop: your memory still");
    out.push("  moves, and the copies stay exactly where they are. The new store's rotation");
    out.push("  will share that folder with what is already in it.");
  } else if (plan.snapshotsDir === null) {
    out.push("");
    out.push("  No snapshots directory belongs to this layout (the store is not named");
    out.push("  'store' under a base directory), so there is none to park.");
  }
  return out;
}
export function configLines(plan) {
  if (!plan.configPresent) {
    return [
      `  ${plan.configPath}: will be CREATED by the install below.`
    ];
  }
  return [
    `  ${plan.configPath}: unchanged — "dataDir" already names ${plan.storeDir},`,
    "    and the blank store is created at that same path. Nothing in the file is",
    "    rewritten, so your credentials file, your ceiling and every other value",
    "    stay exactly as they are, byte for byte."
  ];
}
export function rollbackLines(plan, taken = existsSync, opts = {}) {
  if (plan.parks.length === 0)
    return [];
  const out = [];
  if (opts.parkTheBlankStore !== false) {
    out.push(guardedMove(plan.storeDir, parkedPath(plan.storeDir, BLANK_INFIX, plan.date, taken)));
  }
  for (const step of [...plan.parks].reverse())
    out.push(guardedMove(step.to, step.from));
  return out;
}
export function guardedMove(from, to) {
  return `  if [ -e ${shell(to)} ]; then echo "REFUSING: ${inner(to)} already exists — ` + `mv would put the source INSIDE it" >&2; false; else mv ${shell(from)} ${shell(to)}; fi`;
}
function inner(path) {
  return path.replace(/(["\\$`])/g, "\\$1");
}
function shell(path) {
  return `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}
export function planUndo(input) {
  const taken = input.taken ?? existsSync;
  const home = input.home ?? homedir();
  const configPath = resolve(input.configPath);
  const storeDir = isAbsolute(input.storeDir.trim()) ? resolve(input.storeDir.trim()) : input.storeDir.trim();
  const date = dateOf(input.now);
  const candidates = isAbsolute(storeDir) ? siblingsParked(storeDir, taken) : [];
  const empty = {
    storeDir,
    parked: null,
    candidates,
    steps: [],
    snapshotsLeft: null,
    preRows: false
  };
  const storeRefusal = pathGuard("store", input.storeDir, configPath, home, `${configPath}'s "dataDir"`);
  if (storeRefusal !== null)
    return { ...empty, refusal: storeRefusal };
  let parked = input.parked === null ? null : resolve(input.parked);
  if (parked === null) {
    if (candidates.length === 0) {
      return {
        ...empty,
        refusal: `refused: nothing beside ${storeDir} is a parked store, and the store that is there ` + "carries no record of one. There is nothing to undo."
      };
    }
    if (candidates.length > 1) {
      return {
        ...empty,
        refusal: `refused: ${String(candidates.length)} parked stores sit beside ${storeDir} and the ` + "store that is there does not say which one it replaced, so this will not guess — " + `guessing is how an empty shell gets named as somebody's memory. They are:
` + candidates.map((c) => `    ${c}`).join(`
`) + `
  Move the one you want back by hand; the printed lines from the run that made ` + "it are the exact way, and each is guarded."
      };
    }
    parked = candidates[0] ?? null;
  }
  if (parked === null || !taken(parked)) {
    return { ...empty, refusal: `refused: ${String(parked)} is not there.` };
  }
  const parkedRefusal = pathGuard("parked store", parked, configPath, home, "the record in this store") ?? parkedSiblingRefusal("parked store", parked, dirname(storeDir), basename(storeDir));
  if (parkedRefusal !== null)
    return { ...empty, refusal: parkedRefusal };
  const steps = [];
  const store = sight(storeDir);
  if (store.present) {
    steps.push({
      label: "the store that is there now",
      from: storeDir,
      to: parkedPath(storeDir, BLANK_INFIX, date, taken)
    });
  }
  steps.push({ label: "your parked memory", from: parked, to: storeDir });
  const suffix = basename(parked).slice(basename(storeDir).length);
  const snapshots = join(dirname(storeDir), "snapshots");
  const parkedSnapshots = `${snapshots}${suffix}`;
  let snapshotsLeft = null;
  const snapshotsRefusal = pathGuard("parked snapshots", parkedSnapshots, configPath, home, "this store's layout") ?? parkedSiblingRefusal("parked snapshots", parkedSnapshots, dirname(storeDir), "snapshots");
  if (taken(parkedSnapshots) && snapshotsRefusal !== null) {
    snapshotsLeft = parkedSnapshots;
  } else if (taken(parkedSnapshots)) {
    if (taken(snapshots)) {
      snapshotsLeft = parkedSnapshots;
    } else {
      steps.push({ label: "its snapshots", from: parkedSnapshots, to: snapshots });
    }
  }
  return {
    storeDir,
    parked,
    candidates,
    steps,
    snapshotsLeft,
    preRows: preRowsMarkersIn(parked).length > 0,
    refusal: null
  };
}
export function undoLines(plan) {
  const out = [`Store:  ${plan.storeDir}`, `Parked: ${plan.parked ?? "(none found)"}`, ""];
  if (plan.steps.length === 0)
    return out;
  out.push("It will rename, in this order — one atomic rename each, nothing copied,");
  out.push("nothing deleted, and nothing opened:");
  for (const step of plan.steps) {
    out.push(`  ${step.label}`);
    out.push(`    ${step.from}`);
    out.push(`      -> ${step.to}`);
  }
  if (plan.snapshotsLeft !== undefined && plan.snapshotsLeft !== null) {
    out.push("");
    out.push(`  ${plan.snapshotsLeft} is LEFT WHERE IT IS: a snapshots`);
    out.push("  folder is already back at the live name, and moving one onto the other is");
    out.push("  the merge this refuses everywhere else. Your copies are in both.");
  }
  if (plan.preRows) {
    out.push("");
    out.push("  THE STORE COMING BACK IS ON THE OLD FLOOR. This build cannot open it, so");
    out.push("  putting it back is only half the undo: the checkout has to go back too —");
    out.push(`    tools/deploy-checkout.sh --repo <your checkout> --ref ${PRE_ROWS_READABLE_BY}`);
    out.push("  and then restart Claude Code. Until that happens every session will stand");
    out.push("  down against this store, loudly and harmlessly.");
  }
  return out;
}
export function confirmationWord(plan) {
  const store = plan.parks.find((p) => p.label === "store");
  return store === undefined ? "" : basename(store.to);
}
