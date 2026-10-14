import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  PRE_ROWS_READABLE_BY,
  dateOf,
  DATABASE_FILE,
  readRollbackHold,
  storeExists
} from "../../core/store/index.js";
import { defaultSnapshotsDir } from "../../core/store/paths.js";
import {
  readHolders,
  upgradeAgain,
  planRollbackUndo,
  performRollbackUndo,
  planRollback,
  rollbackPlanLines,
  previousVersion,
  nextStepLines,
  performRollback
} from "./rollback.js";
import { CONFIG_ENV, CONFIG_FLAG, defaultConfigPath } from "../config-path.js";
import { zoneBeside } from "../config.js";
import { installLayout, CONFIG_FILE, budgetRefusal, BIN, MCP_SERVER_NAME } from "./install.js";
import { typed } from "./ui.js";
import {
  planStartFresh,
  planLines,
  sight,
  configLines,
  rollbackLines,
  guardedMove,
  parkedPath,
  BLANK_INFIX,
  confirmationWord,
  park,
  planUndo,
  undoLines,
  readLiveness,
  PARKED_INFIX,
  OPEN_WINDOW_MS
} from "./start-fresh.js";
import { realProcessLister } from "./wire.js";
import { installedVersion } from "../sessions.js";
import { EXIT, hostConfigFor, openStoreAt, snapshotsDirBeside } from "./commands-shared.js";
import { installCommand } from "./commands-install.js";
import { MODULE_EXT } from "../runtime.js";
export const STORE_STARTED_KEY = "store.started";
export const STORE_STARTED_BY_KEY = "store.started.by";
export const STORE_PREVIOUS_PARKED_KEY = "store.previous.parked";
export async function startFreshCommand(parsed, io, env, home, named, now) {
  if (typeof parsed.flags["dir"] === "string") {
    io.err("refused: 'start-fresh' takes no --dir. The store it parks is the one your CONFIGURATION " + "names, because that is the one your hooks and your MCP server open — a second answer on " + "this command line is exactly how the wrong store would get moved. Name the configuration " + `instead: ${CONFIG_FLAG} <absolute path>, or ${CONFIG_ENV}.`);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const home_ = home ?? homedir();
  const configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);
  const custom = named !== undefined && named.source !== "default" && resolve(named.path) !== defaultConfigPath(home_) ? named.path : undefined;
  const present = existsSync(configPath);
  const host = hostConfigFor(configPath);
  if (present && host.reason === "unreadable") {
    io.err(`refused: ${configPath} is there and will not be understood. This command has to read ` + '"dataDir" out of it to know which store to park, and a file it cannot read is a question ' + "it will not answer by guessing. Fix the file, then run this again.");
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  if (present && host.reason === "absent") {
    io.err(`refused: ${configPath} exists but could not be read (a permission, most likely). ` + "This command has to read it to know which store to park.");
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  if (parsed.flags["undo"] === true) {
    return await startFreshUndo(parsed, io, configPath, present, host.config.dataDir, now, home_);
  }
  const name = typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined;
  if (name !== undefined && (name.trim().length === 0 || /[\n\r\u0000]/.test(name))) {
    io.err("refused: --name is the owner's name, seeded into the new store's identity core. " + "Blank, or carrying a newline or a null, it is not one.");
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const dryRun = parsed.flags["dry-run"] === true;
  const at = now();
  const coldStore = installLayout(undefined, {}, home_, custom).store;
  const planInput = {
    configPath,
    configPresent: present,
    dataDir: host.config.dataDir,
    snapshotsConfigured: host.config.snapshots?.dir,
    home: home_
  };
  const plan = planStartFresh({ ...planInput, now: at });
  const landing = plan.storeDir.length > 0 ? plan.storeDir : coldStore;
  io.out("counterparts start-fresh — park this memory and begin on a blank one.");
  io.out("Nothing is ever deleted, and the parked store is never opened.");
  io.out("");
  for (const line of planLines(plan, landing))
    io.out(line);
  if (plan.refusal !== null) {
    io.out("");
    io.err(plan.refusal);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  if (!present) {
    const there = sight(landing);
    if (there.present && there.entries > 0) {
      io.out("");
      io.err(`refused: there is no configuration at ${configPath}, so this would have been an ` + `ordinary first install — but ${landing} already holds something ` + `(${String(there.entries)} entries). This command will not create a store on top of ` + "one nobody named, and it will not park one the configuration does not point at. " + (custom === undefined ? "Name the configuration that belongs to that store: " : "Check the path you typed — a configuration one character off names a directory " + "that is not yours to start fresh in: ") + `${CONFIG_FLAG} <absolute path>.`);
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
    if (existsSync(join(dirname(configPath), CONFIG_FILE)) && custom !== undefined) {
      io.out("");
      io.err(`refused: ${configPath} is not there, but ${join(dirname(configPath), CONFIG_FILE)} is — ` + "so the path you named is one character away from a configuration that exists. This " + "command will not treat a typo as a request to install a second memory beside the " + "first one.");
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
  }
  io.out("");
  io.out("The configuration:");
  for (const line of configLines(plan))
    io.out(line);
  const ceiling = host.config.injectionBudgetBytes;
  const ceilingOk = present && ceiling !== undefined && budgetRefusal(String(ceiling)) === null;
  if (present && ceiling !== undefined && !ceilingOk) {
    io.out("");
    io.out(`  Note: "injectionBudgetBytes": ${String(ceiling)} is not a whole number of bytes, so`);
    io.out("  it is not handed to the install. Your configuration is kept exactly as it is —");
    io.out("  and the hooks read it as they always have.");
  }
  const rollback = rollbackLines(plan, existsSync, { parkTheBlankStore: false });
  if (rollback.length > 0) {
    io.out("");
    io.out("The way back, printed BEFORE anything moves, so it is on your screen even if");
    io.out("this is interrupted. Each line REFUSES rather than moving one directory inside");
    io.out("another, which is what a bare `mv` does.");
    io.out("");
    io.out("  If it stops before it prints 'parked store:', NOTHING HAS MOVED — your memory");
    io.out(`  is still at ${plan.storeDir}. The only thing left behind is a part-built store`);
    io.out("  called <store>.new-<number>; moving it aside is enough, and nothing reads it.");
    io.out("");
    io.out("  If it stops after that, these put it back:");
    for (const line of rollback)
      io.out(line);
    io.out("  ...and if a blank store has appeared at the store path by then, park it first:");
    io.out(guardedMove(plan.storeDir, parkedPath(plan.storeDir, BLANK_INFIX, plan.date)));
    io.out("");
    io.out(`  (or simply: ${BIN.cli} start-fresh --undo. Nothing here deletes anything.)`);
  }
  if (dryRun) {
    io.out("");
    io.out("Dry run. Nothing has been moved and nothing has been written.");
    return EXIT.ok;
  }
  if (plan.shape === "park") {
    const word = confirmationWord(plan);
    io.out("");
    io.out("CLOSE EVERY CLAUDE CODE SESSION AND EVERY DASHBOARD FIRST.");
    io.out("  A running session's hooks and its MCP server hold this store open by its");
    io.out("  file handle. A rename does not break a handle: they would go on writing");
    io.out("  into the PARKED directory, which is the one thing that could stop it being");
    io.out("  byte-identical to this moment.");
    io.out("");
    io.out("  NOTHING HERE CAN CHECK THAT FOR YOU. A dashboard and an MCP server leave no");
    io.out("  live-session record at all, and a session sitting idle writes nothing — so");
    io.out("  they are invisible to every test this command can cheaply make. You are the");
    io.out("  only instrument that can answer, which is what this question is.");
    io.out("");
    io.out("  What you CAN check, in another terminal:");
    io.out("    pgrep -fl counterparts");
    io.out(`  Look for lines running one of OURS — serve${MODULE_EXT} (an MCP server), dashboard${MODULE_EXT},`);
    io.out(`  hook${MODULE_EXT}, runner${MODULE_EXT} (the worker). Every one of those is holding the store open.`);
    io.out("  IGNORE anything that merely has the word in a path: `pgrep -f` matches the");
    io.out("  whole command line, so an editor, a `tail`, a dev server in a directory with");
    io.out("  this name in it will all show up and none of them matters. This command will");
    io.out("  be in the list too.");
    const stop = livenessRefusal(io, plan);
    if (stop !== null)
      return stop;
    if (parsed.flags["yes"] === true && plan.storeEntries > 0 && parsed.flags["nothing-is-open"] !== true) {
      io.err("");
      io.err(`refused: --yes on a store with ${String(plan.storeEntries)} things in it. --yes skips the ` + "typed confirmation, and on a real store that confirmation is the only check that can " + "catch a dashboard or an MCP server holding it open — neither leaves a record this can " + "read. Type the name when asked, or, if you have genuinely closed everything and mean " + "to run this unattended, say so: --yes --nothing-is-open.");
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
    if (parsed.flags["yes"] !== true) {
      if (io.prompt === undefined) {
        io.err("");
        io.err("refused: this is not an interactive console and nothing was confirmed. Pass --yes if " + "that is what you mean — and close your sessions first, because nothing here can check " + "that for you.");
        io.err("Nothing has changed.");
        return EXIT.refused;
      }
      const said = await typed(io, word, `Type the parked name to go ahead [${word}] — Esc or "cancel" to stop: `);
      if (said === "cancelled") {
        io.out("Cancelled. Nothing has changed.");
        return EXIT.ok;
      }
      if (said !== "typed") {
        io.err("refused: the confirmation did not match. Nothing has changed.");
        return EXIT.refused;
      }
    }
  }
  const final = planStartFresh({ ...planInput, now: at });
  if (final.refusal !== null) {
    io.err(`refused after re-reading the directory: ${final.refusal}`);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const drifted = parksDiffer(plan.parks, final.parks);
  if (drifted !== null) {
    io.err("");
    io.err(`refused: the ground moved while this was waiting for you — ${drifted}. The plan printed ` + "above is not the plan that would run now, and running a plan you did not read is how a " + "rollback block ends up naming the wrong directory. Nothing has changed; run it again.");
    return EXIT.refused;
  }
  if (final.shape === "park") {
    const stop = livenessRefusal(io, final, "after re-reading the directory", false);
    if (stop !== null)
      return stop;
  }
  const parking = final.parks.length > 0;
  const installTarget = parking ? freeTempStore(final.storeDir) : landing;
  io.out("");
  io.out(parking ? "Building the blank store beside your memory first, so that nothing is moved until" : "Creating the blank store. This is 'counterparts install', run for you:");
  if (parking) {
    io.out("there is a store ready to take its place. This is 'counterparts install':");
  }
  io.out("");
  const existedBefore = storeExists(installTarget);
  const installFlags = { dir: installTarget };
  if (name !== undefined && name.length > 0)
    installFlags["name"] = name;
  if (ceilingOk)
    installFlags["budget"] = String(ceiling);
  let code;
  try {
    code = installCommand({ command: "install", positional: [], flags: installFlags }, io, env, home_, named, { hostSteps: false, newInstall: "start-fresh" });
  } catch (err) {
    io.err(`the install failed: ${String(err.message ?? err)}`);
    code = EXIT.failed;
  }
  if (code !== EXIT.ok) {
    io.err("");
    io.err("The install did not complete, so NOTHING WAS MOVED — your memory is exactly where it " + `was, at ${final.storeDir.length > 0 ? final.storeDir : landing}.` + (parking ? ` A part-built store may be left at ${installTarget}; it is not yours and nothing reads it.` : ""));
    return code;
  }
  let parkedStore = null;
  if (parking) {
    io.out("");
    const outcome = park(final.parks);
    for (const step of outcome.done)
      io.out(`  parked ${step.label}: ${step.from} -> ${step.to}`);
    const store = outcome.done.find((s) => s.label === "store");
    parkedStore = store === undefined ? null : store.to;
    if (outcome.failed !== null) {
      io.err(`failed to park ${outcome.failed.label}: ${outcome.error ?? "no detail"}`);
      io.err(outcome.done.length === 0 ? `Nothing has changed. The blank store built for this run is at ${installTarget}.` : "What is listed above HAS moved; nothing else has, and nothing was deleted.");
      printWayBack(io, final, outcome.done.map((s) => s.label), installTarget);
      return EXIT.failed;
    }
    try {
      renameSync(installTarget, final.storeDir);
    } catch (err) {
      io.err("");
      io.err(`the blank store could not be moved into place: ${String(err.message ?? err)}`);
      io.err(`Something appeared at ${final.storeDir} between the rename and this step — a hook or a ` + "worker that was still running is the likely one. NOTHING WAS DELETED and nothing was " + "merged. Exactly three directories exist right now:");
      io.err(`  your memory, parked and untouched:  ${parkedStore ?? "(not parked)"}`);
      io.err(`  whatever appeared at the store path: ${final.storeDir}`);
      io.err(`  the blank store this run built:      ${installTarget}`);
      io.err("Close everything, look at the middle one, and move it aside by hand; then either move " + "the blank store into place or put your memory back with the lines below.");
      printWayBack(io, final, outcome.done.map((st) => st.label), installTarget);
      return EXIT.failed;
    }
  }
  const created = parking ? final.storeDir : installTarget;
  const previous = parkedStore ?? soleParked(final);
  if (!existedBefore) {
    try {
      const store = openStoreAt({ dir: created });
      try {
        const entries = [
          [STORE_STARTED_KEY, final.date],
          [STORE_STARTED_BY_KEY, "start-fresh"]
        ];
        if (previous !== null)
          entries.push([STORE_PREVIOUS_PARKED_KEY, previous]);
        store.setMetaMany(entries);
      } finally {
        store.close();
      }
    } catch (err) {
      io.err(`  (could not record this store's beginning: ${String(err.message ?? err)} — the ` + "store itself is fine, and `status` will simply not mention the date.)");
    }
  }
  io.out("");
  io.out("Done. What is left is yours to do:");
  io.out("");
  io.out(`  1. Probably nothing to re-register. Your store is still at`);
  io.out(`       ${created}`);
  io.out("     — the blank one is at the same path the old one was, and this command");
  io.out("     never touched your configuration. So if the MCP server was registered the");
  io.out(`     way 'install' prints it (-e COUNTERPARTS_DATA_DIR=<that path>), it already`);
  io.out("     names the right store. This cannot read your host's files to check:");
  io.out(`       claude mcp get ${MCP_SERVER_NAME}`);
  io.out("     says what it was actually registered with.");
  io.out("  2. RESTART CLAUDE CODE. Every session that was open holds the old store by a");
  io.out("     file handle, and a handle does not follow a rename. Until they restart,");
  io.out("     they are still writing into the parked directory.");
  if (previous !== null) {
    io.out(`  3. Your previous memory is at:`);
    io.out(`       ${previous}`);
    io.out("     It was never opened, never copied and never deleted.");
    io.out(`     To go back:  ${BIN.cli} start-fresh --undo${custom === undefined ? "" : ` ${CONFIG_FLAG} ${configPath}`}`);
  } else if (final.alreadyParked.length > 1) {
    io.out(`  3. There is more than one parked store beside this one, and nothing here can`);
    io.out("     tell which of them holds your memory, so the record says nothing rather");
    io.out("     than guessing. They are:");
    for (const p of final.alreadyParked)
      io.out(`       ${p}`);
  }
  if (name === undefined || name.length === 0) {
    io.out("");
    io.out("  The new store has NO identity core: nothing else gives a store one, and the");
    io.out("  wake has nothing to be about without it. To seed one (it is an ensure, so");
    io.out("  it only adds the core):");
    io.out(`    ${BIN.cli} init --dir ${created} --name "<your name>"`);
    io.out("  Or pass --name to this command next time.");
  }
  printWayBack(io, final, ["store", "snapshots"], null);
  io.out("");
  io.out(`Then: ${BIN.cli} status --dir ${created}`);
  return EXIT.ok;
}
async function startFreshUndo(parsed, io, configPath, configPresent, dataDir, now, home_) {
  if (!configPresent || dataDir === undefined || dataDir.trim().length === 0) {
    io.err(`refused: ${configPath} ${configPresent ? 'names no "dataDir"' : "is not there"}, so there is ` + "no way to know which store to put one back at.");
    return EXIT.refused;
  }
  const written = dataDir.trim();
  const storeDir = isAbsolute(written) ? resolve(written) : written;
  const at = now();
  const readRecord = () => {
    try {
      const store = openStoreAt({ dir: storeDir, observer: true });
      try {
        return store.getMeta(STORE_PREVIOUS_PARKED_KEY) ?? null;
      } finally {
        store.close();
      }
    } catch {
      return null;
    }
  };
  const recorded = isAbsolute(storeDir) ? readRecord() : null;
  const plan = planUndo({ storeDir: written, parked: recorded, configPath, now: at, home: home_ });
  io.out(`${BIN.cli} start-fresh --undo — put the parked store back.`);
  io.out("Nothing is deleted, and the parked store is never opened.");
  io.out("");
  for (const line of undoLines(plan))
    io.out(line);
  if (plan.refusal !== null) {
    io.out("");
    for (const line of plan.refusal.split(`
`))
      io.err(line);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const vacated = new Set;
  for (const step of plan.steps) {
    if (existsSync(step.to) && !vacated.has(step.to)) {
      io.out("");
      io.err(`refused: ${step.to} already exists, so putting ${step.from} back there would either ` + "fail or, with a bare `mv`, nest one directory inside the other. Move it aside by hand " + "and run this again. Nothing has changed.");
      return EXIT.refused;
    }
    vacated.add(step.from);
  }
  const livePlan = {
    ...EMPTY_LIVENESS_PLAN,
    storeDir,
    date: dateOf(at),
    configPath,
    liveness: readLiveness(storeDir, at)
  };
  if (parsed.flags["dry-run"] === true) {
    livenessRefusal(io, livePlan);
    io.out("");
    io.out("Dry run. Nothing has been moved.");
    io.out("  (this read the new store's record, so its `-shm` index may have been");
    io.out("   rewritten, and a log left in its `-wal` folded into its database file.");
    io.out("   No memory in it changed, and the parked store was not opened.)");
    return EXIT.ok;
  }
  {
    const stop = livenessRefusal(io, livePlan);
    if (stop !== null)
      return stop;
  }
  const displaced = sight(storeDir);
  if (parsed.flags["yes"] === true && displaced.entries > 0 && parsed.flags["nothing-is-open"] !== true) {
    io.err("");
    io.err(`refused: --yes on an undo that displaces a store with ${String(displaced.entries)} things ` + "in it. The typed confirmation is the only check that catches a dashboard or an MCP " + "server holding it open. Type the name when asked, or say the other sentence too: " + "--yes --nothing-is-open.");
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  if (parsed.flags["yes"] !== true) {
    if (io.prompt === undefined) {
      io.err("");
      io.err("refused: this is not an interactive console and nothing was confirmed. Pass --yes.");
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
    io.out("");
    io.out("Close every Claude Code session and every dashboard first — the same reason as");
    io.out("before: a rename does not break a file handle.");
    const word = basename(plan.parked ?? storeDir);
    const said = await typed(io, word, `Type the parked name to go ahead [${word}] — Esc or "cancel" to stop: `);
    if (said === "cancelled") {
      io.out("Cancelled. Nothing has changed.");
      return EXIT.ok;
    }
    if (said !== "typed") {
      io.err("refused: the confirmation did not match. Nothing has changed.");
      return EXIT.refused;
    }
  }
  const finalPlan = planUndo({
    storeDir: written,
    parked: isAbsolute(storeDir) ? readRecord() : null,
    configPath,
    now: at,
    home: home_
  });
  if (finalPlan.refusal !== null) {
    io.err(`refused after re-reading the directory: ${finalPlan.refusal}`);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const drift = undoStepsDiffer(plan.steps, finalPlan.steps);
  if (drift !== null) {
    io.err("");
    io.err(`refused: the ground moved while this was waiting for you — ${drift}. Nothing has ` + "changed; run it again and read the plan that prints.");
    return EXIT.refused;
  }
  io.out("");
  const outcome = park(finalPlan.steps.map((st) => ({ label: st.label, from: st.from, to: st.to })));
  for (const step of outcome.done)
    io.out(`  moved ${step.label}: ${step.from} -> ${step.to}`);
  if (outcome.failed !== null) {
    io.err(`failed to move ${outcome.failed.label}: ${outcome.error ?? "no detail"}`);
    io.err("What is listed above HAS moved; nothing else has, and nothing was deleted.");
    io.out("");
    io.out("Undoing what this run managed, each line refusing rather than nesting:");
    for (const step of [...outcome.done].reverse())
      io.out(guardedMove(step.to, step.from));
    return EXIT.failed;
  }
  io.out("");
  io.out("Done. Your memory is back at:");
  io.out(`  ${storeDir}`);
  if (plan.preRows) {
    io.out("");
    io.out("  IT IS AN OLD-FLOOR STORE, so this build cannot open it. The checkout has to");
    io.out("  go back too, or every session will stand down against it:");
    io.out(`    tools/deploy-checkout.sh --repo <your checkout> --ref ${PRE_ROWS_READABLE_BY}`);
  }
  const displacedTo = outcome.done.find((st) => st.label.startsWith("the store that is there"));
  if (displacedTo !== undefined) {
    io.out("");
    io.out("The store this displaced is PARKED, not removed. To put THAT one back:");
    io.out(guardedMove(storeDir, `${storeDir}.${PARKED_INFIX}-${dateOf(at)}`));
    io.out(guardedMove(displacedTo.to, storeDir));
    io.out("  (there is no --undo of an --undo: the displaced store wears a `blank-` name,");
    io.out("   which nothing reads as a parked store. These two lines are the way.)");
  }
  io.out("");
  io.out("Restart Claude Code: the sessions that are open still hold the other store.");
  return EXIT.ok;
}
function undoStepsDiffer(before, after) {
  if (before.length !== after.length) {
    return `there ${after.length === 1 ? "is" : "are"} now ${String(after.length)} move(s), not ${String(before.length)}`;
  }
  for (let i = 0;i < before.length; i += 1) {
    const a = before[i];
    const b = after[i];
    if (a === undefined || b === undefined)
      continue;
    if (a.from !== b.from || a.to !== b.to) {
      return `${a.label} would now move ${b.from} -> ${b.to}, not ${a.from} -> ${a.to}`;
    }
  }
  return null;
}
const EMPTY_LIVENESS_PLAN = {
  shape: "park",
  configPresent: true,
  parks: [],
  alreadyParked: [],
  snapshotsDir: null,
  snapshotsElsewhere: null,
  snapshotsLeft: null,
  strayTempStores: [],
  storeEntries: 0,
  preRowsMarkers: [],
  refusal: null
};
function freeTempStore(storeDir) {
  const base = `${storeDir}.new-${String(process.pid)}`;
  if (!existsSync(base))
    return base;
  for (let n = 2;n < 1000; n += 1) {
    if (!existsSync(`${base}-${String(n)}`))
      return `${base}-${String(n)}`;
  }
  throw new Error(`no free temporary name beside ${storeDir}`);
}
function parksDiffer(before, after) {
  if (before.length !== after.length) {
    return `there ${after.length === 1 ? "is" : "are"} now ${String(after.length)} thing(s) to move, not ${String(before.length)}`;
  }
  for (let i = 0;i < before.length; i += 1) {
    const a = before[i];
    const b = after[i];
    if (a === undefined || b === undefined)
      continue;
    if (a.from !== b.from)
      return `${a.label} would now be moved from ${b.from}, not ${a.from}`;
    if (a.to !== b.to)
      return `${a.label} would now be parked at ${b.to}, not ${a.to}`;
  }
  return null;
}
function soleParked(plan) {
  return plan.alreadyParked.length === 1 ? plan.alreadyParked[0] ?? null : null;
}
function printWayBack(io, plan, done, tempStore) {
  const moved = plan.parks.filter((p) => done.includes(p.label));
  if (moved.length === 0 && tempStore === null)
    return;
  io.out("");
  io.out("The way back, as it actually stands now — each line refuses rather than moving");
  io.out("one directory inside another:");
  const storeBack = moved.some((m) => m.label === "store");
  if (storeBack && sight(plan.storeDir).present) {
    io.out(guardedMove(plan.storeDir, parkedPath(plan.storeDir, BLANK_INFIX, plan.date)));
  }
  for (const step of [...moved].reverse())
    io.out(guardedMove(step.to, step.from));
  if (tempStore !== null && existsSync(tempStore)) {
    io.out(`  # the part-built store from this run, yours to remove: ${tempStore}`);
  }
  io.out(`  (or: ${BIN.cli} start-fresh --undo)`);
}
function livenessRefusal(io, plan, when = "", showRecent = true) {
  const minutes = String(Math.round(OPEN_WINDOW_MS / 60000));
  if (plan.liveness.signs.length === 0) {
    if (showRecent && plan.liveness.recent.length > 0) {
      io.out("");
      io.out(`  Something WROTE to this store in the last ${minutes} minutes:`);
      for (const sign of plan.liveness.recent) {
        io.out(`    ${sign.what} — ${String(Math.round(sign.agoMs / 1000))}s ago`);
      }
      io.out("  That is not proof anything has it open — these files outlive a clean close —");
      io.out("  and it is not proof they do not. It is one more reason to be sure.");
    }
    if (showRecent && plan.liveness.unreadable) {
      io.out("");
      io.out("  (the live-session registry would not list, so nothing here can say whether a");
      io.out("   session is attached. Close everything before you answer.)");
    }
    return null;
  }
  io.out("");
  io.err(`refused${when === "" ? "" : ` ${when}`}: a Claude Code session's hooks ran against this ` + `store in the last ${minutes} minutes and the host never ended it, so it is very likely ` + "still open:");
  for (const sign of plan.liveness.signs) {
    io.err(`  ${sign.what} — ${sign.where} (${String(Math.round(sign.agoMs / 1000))}s ago)`);
  }
  io.err("A rename does not break an open file handle: that session's hooks and its MCP server " + "would go on writing into the PARKED directory, and it would stop being the " + "byte-identical copy this command promises. Close every Claude Code session and the " + `dashboard, wait ${minutes} minutes, and run this again.`);
  io.err("Nothing has changed.");
  return EXIT.refused;
}
export async function rollbackCommand(parsed, io, env, opts, named, now) {
  const home_ = opts.home ?? homedir();
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  let storeDir;
  let configPath;
  let snapshotsConfigured;
  if (dirFlag !== undefined) {
    storeDir = dirFlag;
    configPath = join(dirname(resolve(dirFlag)), CONFIG_FILE);
    snapshotsConfigured = snapshotsDirBeside(resolve(dirFlag));
  } else {
    configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);
    const host = existsSync(configPath) ? hostConfigFor(configPath) : null;
    const dataDir = host?.reason === "loaded" ? host.config.dataDir : undefined;
    if (dataDir === undefined || dataDir.trim().length === 0) {
      io.err(`refused: ${host === null ? `there is no configuration at ${configPath}` : `${configPath} names no store this can read`}, ` + "so there is no telling which store to roll back. Name it: --dir <absolute path to the store>.");
      return EXIT.refused;
    }
    storeDir = dataDir.trim();
    snapshotsConfigured = host?.config.snapshots?.dir;
  }
  const absolute = isAbsolute(storeDir) ? resolve(storeDir) : storeDir;
  const snapshotsDir = snapshotsConfigured !== undefined && snapshotsConfigured.trim().length > 0 ? resolve(snapshotsConfigured) : isAbsolute(storeDir) ? defaultSnapshotsDir(absolute) : null;
  const lister = opts.processes ?? realProcessLister(env);
  const dryRun = parsed.flags["dry-run"] === true;
  const undo = parsed.flags["undo"] === true;
  const allow = parsed.flags["upgrade-again"] === true;
  const to = typeof parsed.flags["to"] === "string" ? parsed.flags["to"] : undefined;
  if ([undo, allow, to !== undefined].filter(Boolean).length > 1) {
    io.err("refused: --undo, --upgrade-again and --to are three different things; pass one of them.");
    return EXIT.usage;
  }
  const holdersRefusal = (at, sayMaybe = true) => {
    const holders = readHolders({ storeDir: absolute, configPath, now: at, lister });
    const refusing = holders.filter((h) => h.refuse);
    const maybe = holders.filter((h) => !h.refuse);
    if (sayMaybe && maybe.length > 0) {
      io.out("");
      io.out("  Running, and maybe on this store (its command line does not say which):");
      for (const h of maybe)
        io.out(`    ${h.what} — ${h.detail}`);
      io.out("  If one of them is on this store, stop it before you go on.");
    }
    if (refusing.length === 0)
      return null;
    io.out("");
    io.err("refused: this store is open in:");
    for (const h of refusing)
      io.err(`  ${h.what} — ${h.detail}`);
    io.err("Close every Claude Code session on it, quit Claude Desktop, stop the dashboard " + "(and wait for a background run to finish), then run this again. Nothing has changed.");
    io.err(`A session that crashed or whose terminal was closed counts for ${String(Math.round(OPEN_WINDOW_MS / 60000))} minutes after its last hook, ` + "and a memory server only while its process runs, so a record left behind stops counting by itself.");
    return EXIT.refused;
  };
  const tz = zoneBeside(absolute);
  if (allow) {
    io.out(`${BIN.cli} rollback --upgrade-again — let this version upgrade the store again.`);
    io.out(`Store: ${absolute}`);
    const hold = isAbsolute(storeDir) ? readRollbackHold(absolute) : null;
    if (hold === null) {
      io.err(`refused: ${absolute} carries no rollback hold, so there is nothing to allow.`);
      return EXIT.refused;
    }
    if (!existsSync(join(absolute, DATABASE_FILE))) {
      io.err(`refused: there is no database in ${absolute}: the rollback stopped before its copy went in, so there is ` + `nothing to upgrade, and an upgrade here would start a blank store. Run: ${BIN.cli} rollback --undo --dir ${absolute}`);
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
    const stop = holdersRefusal(now());
    if (stop !== null)
      return stop;
    if (dryRun) {
      io.out("Dry run: this would remove the hold and, if the store is behind this version, upgrade it");
      io.out(`now, after a new copy to ${snapshotsDir ?? "the snapshots folder"}. Nothing has changed.`);
      return EXIT.ok;
    }
    const { migration } = upgradeAgain({
      storeDir: absolute,
      ...snapshotsDir === null ? {} : { snapshotsDir },
      ...tz === undefined ? {} : { timeZone: tz }
    });
    io.out(migration === null ? "The hold is removed. The store was already on this version's schema, so nothing was upgraded." : `Upgraded v${migration.from} -> v${String(migration.to)}, after a new copy: ${join(migration.dir, migration.snapshot)}. The hold is removed.`);
    return EXIT.ok;
  }
  if (undo) {
    io.out(`${BIN.cli} rollback --undo — put the set-aside store back.`);
    const plan = planRollbackUndo({ storeDir, configPath, home: home_ });
    io.out(`Store: ${plan.storeDir}`);
    if (plan.hold !== null)
      io.out(`Set aside: ${plan.hold.aside}`);
    if (plan.refusal !== null) {
      io.err(plan.refusal);
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
    const stop = holdersRefusal(now());
    if (stop !== null)
      return stop;
    if (dryRun) {
      io.out("Dry run: the restored store has not been written since, so it would be replaced by the");
      io.out("set-aside one, the cache with it, and the hold removed. Nothing has changed.");
      return EXIT.ok;
    }
    const outcome = performRollbackUndo(plan);
    for (const line of outcome.done)
      io.out(`  ${line}`);
    if (!outcome.ok) {
      io.err(`undo stopped: ${outcome.error ?? "?"}. What moved is listed above; the hold is still there.`);
      return EXIT.failed;
    }
    io.out("The newer store is back and the hold is removed. This version opens it as before.");
    return EXIT.ok;
  }
  const at = now();
  const input = { storeDir, snapshotsDir, configPath, home: home_, now: at, ...to === undefined ? {} : { to } };
  const plan = planRollback(input);
  io.out(`${BIN.cli} rollback — put this store back the way it was before its last upgrade.`);
  io.out("");
  for (const line of rollbackPlanLines(plan))
    io.out(line);
  if (plan.refusal !== null || plan.copy === null) {
    io.out("");
    io.err(plan.refusal ?? "refused: nothing to roll back to.");
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const stop = holdersRefusal(at);
  if (stop !== null)
    return stop;
  const previous = previousVersion(plan.storeDir, plan.copy.from);
  if (dryRun) {
    io.out("");
    for (const line of nextStepLines(plan, previous, BIN.cli))
      io.out(line);
    io.out("");
    io.out("Dry run. Nothing has changed.");
    return EXIT.ok;
  }
  const word = `rollback-to-v${plan.copy.from}`;
  if (io.prompt !== undefined) {
    if (parsed.flags["yes"] === true) {
      io.err("");
      io.err(`refused: --yes at a terminal. Type the word when asked instead; --yes is for a script or a pipe.`);
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
    io.out("");
    io.out("Close every Claude Code session, Claude Desktop and the dashboard first: a session sitting");
    io.out("idle writes nothing, so nothing here can see it.");
    const said = await typed(io, word, `Type ${word} to go ahead — Esc or "cancel" to stop: `);
    if (said === "cancelled") {
      io.out("Cancelled. Nothing has changed.");
      return EXIT.ok;
    }
    if (said !== "typed") {
      io.err("refused: the confirmation did not match. Nothing has changed.");
      return EXIT.refused;
    }
  } else if (parsed.flags["yes"] !== true) {
    io.err("");
    io.err(`refused: this is not an interactive console and nothing was confirmed. Pass --yes if that is what you mean.`);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const final = planRollback(input);
  if (final.refusal !== null || final.copy?.name !== plan.copy.name || final.aside !== plan.aside) {
    io.err(`refused after re-reading the store: ${final.refusal ?? "the copy or the store changed while this waited"}`);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const again = holdersRefusal(now(), false);
  if (again !== null)
    return again;
  const outcome = performRollback(final, at, installedVersion());
  io.out("");
  for (const line of outcome.done)
    io.out(`  ${line}`);
  if (!outcome.ok) {
    io.err(outcome.done.length === 0 ? `rollback stopped before anything moved: ${outcome.error ?? "?"}. Nothing has changed.` : `rollback stopped: ${outcome.error ?? "?"}. What moved is listed above, into ${final.aside}; ` + "the hold is in place, so this version will not open the store. " + `To put the newer store back: ${BIN.cli} rollback --undo --dir ${final.storeDir}`);
    return EXIT.failed;
  }
  io.out("");
  io.out(`Rolled back to schema v${final.copy?.from ?? "?"}. The newer store is in ${final.aside}.`);
  io.out("");
  for (const line of nextStepLines(final, previous, BIN.cli))
    io.out(line);
  return EXIT.ok;
}
