/** `start-fresh`, its `--undo`, and `rollback` (moved out of `commands.ts`, 2026-10-11). */
import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  PRE_ROWS_READABLE_BY,
  dateOf,
  DATABASE_FILE,
  readRollbackHold,
  storeExists,
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
  performRollback,
} from "./rollback.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import { CONFIG_ENV, CONFIG_FLAG, defaultConfigPath } from "../config-path.js";
import type { ConfigChoice } from "../config-path.js";
import { zoneBeside } from "../config.js";
import { installLayout, CONFIG_FILE, budgetRefusal, BIN, MCP_SERVER_NAME } from "./install.js";
// The console's shared manners (2026-09-21): is there a person here, ask them,
// and say one marked line back.
import { typed } from "./ui.js";
// N1's own module: the plan, the refusals and the one mutating call this
// command makes. It opens no store and imports nothing from here.
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
  OPEN_WINDOW_MS,
} from "./start-fresh.js";
import type { StartFreshPlan, ParkStep } from "./start-fresh.js";
// A's two modules: the host's files, and leaving. They import nothing from here
// but the `Io` type, so this direction is one-way.
import { realProcessLister } from "./wire.js";
import { installedVersion } from "../sessions.js";
import { EXIT, hostConfigFor, openStoreAt, snapshotsDirBeside } from "./commands-shared.js";
import type { Parsed, Io, RunOptions } from "./commands-shared.js";
import { installCommand } from "./commands-install.js";

// ── start-fresh ─────────────────────────────────────────────────────────────

/** Box 2's meta keys this command writes into the NEW store. Host state: a
 *  date and a path, no content, no identity, never a memory. `status` reads
 *  them; nothing else in the package does. */
export const STORE_STARTED_KEY = "store.started";

export const STORE_STARTED_BY_KEY = "store.started.by";

export const STORE_PREVIOUS_PARKED_KEY = "store.previous.parked";

/**
 * `start-fresh` — park this store and begin on a blank one (2026-09-20, N1).
 *
 * The rules and the reasons are in `start-fresh.ts`; this function is the
 * console's half: read the configuration, print the plan, refuse or ask, do the
 * renames, hand the blank store to `install`, and say what to do next.
 *
 * **The plan is MADE TWICE.** Once to print, and again after the human has
 * answered — `commands.ts` rule 2, and it matters more here than anywhere else
 * in this file: between the prompt and the rename a session can start, a hook
 * can write, and a parked name can be taken. A plan held across a person is a
 * plan about a store that may have changed.
 */
export async function startFreshCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  home: string | undefined,
  named: ConfigChoice | undefined,
  now: () => number,
): Promise<number> {
  // `--dir` is a COMMON flag, so it parses on every command. Here it would be a
  // second answer to "which store", on the one command where a wrong answer
  // moves seventeen thousand memories. Refused in words.
  if (typeof parsed.flags["dir"] === "string") {
    io.err(
      "refused: 'start-fresh' takes no --dir. The store it parks is the one your CONFIGURATION " +
        "names, because that is the one your hooks and your MCP server open — a second answer on " +
        "this command line is exactly how the wrong store would get moved. Name the configuration " +
        `instead: ${CONFIG_FLAG} <absolute path>, or ${CONFIG_ENV}.`,
    );
    io.err("Nothing has changed.");
    return EXIT.refused;
  }

  const home_ = home ?? homedir();
  const configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);
  // The same test `install` uses: a configuration is "custom" by its PATH, not
  // by how it was named.
  const custom =
    named !== undefined && named.source !== "default" && resolve(named.path) !== defaultConfigPath(home_)
      ? named.path
      : undefined;

  const present = existsSync(configPath);
  const host = hostConfigFor(configPath);
  if (present && host.reason === "unreadable") {
    io.err(
      `refused: ${configPath} is there and will not be understood. This command has to read ` +
        '"dataDir" out of it to know which store to park, and a file it cannot read is a question ' +
        "it will not answer by guessing. Fix the file, then run this again.",
    );
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  if (present && host.reason === "absent") {
    io.err(
      `refused: ${configPath} exists but could not be read (a permission, most likely). ` +
        "This command has to read it to know which store to park.",
    );
    io.err("Nothing has changed.");
    return EXIT.refused;
  }

  // ── THE WAY BACK, AS A COMMAND (review M3) ───────────────────────────────
  //
  // The printed `mv` lines are guarded and correct, and they are still a shell
  // one-liner somebody pastes at the worst moment of their week. This does the
  // same three moves with the same discipline — one `rename` each, nothing
  // deleted, nothing opened, a destination that exists is a refusal — and it
  // knows which store was parked, because the store that replaced it says so.
  if (parsed.flags["undo"] === true) {
    return await startFreshUndo(parsed, io, configPath, present, host.config.dataDir, now, home_);
  }

  const name = typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined;
  // `--name` reaches `install`'s identity seed and nothing else — it is a NAME,
  // never a path — but an unvalidated string printed back as "identity core
  // seeded for ../../escape" reads like something happened to a path (review
  // n2). One line, and it refuses rather than mangling what the owner typed.
  if (name !== undefined && (name.trim().length === 0 || /[\n\r\u0000]/.test(name))) {
    io.err(
      "refused: --name is the owner's name, seeded into the new store's identity core. " +
        "Blank, or carrying a newline or a null, it is not one.",
    );
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const dryRun = parsed.flags["dry-run"] === true;

  // ── THE DATE IS FROZEN FOR THE WHOLE RUN (review M2) ──────────────────────
  //
  // Every parked name, the record, and the rollback lines are built from it.
  // The command deliberately sends the owner to another terminal to run
  // `pgrep`, so the UTC day CAN turn over while it waits — and it did, in the
  // review: the block on his screen named `…parked-2026-09-20` and the renames
  // went to `…parked-2026-09-21`, so all three printed lines named paths that
  // did not exist. One `now()`, read once, settles it.
  const at = now();

  // ── WHERE `install` WOULD LAND WHEN THERE IS NO CONFIGURATION (review B1) ──
  //
  // THE BLOCKER, and it is worth the paragraph. An absent configuration used to
  // mean "a machine with nothing on it", so `storeDir` was `""`, the pin below
  // was skipped, and `installLayout` fell back to `$COUNTERPARTS_DATA_DIR` —
  // else `~/.counterparts/store`, the LIVE store. One mistyped character
  // (`claude-code.jsonn`) was enough: the reviewer watched `status` go from
  // `Memories: 2` to "This store began on 2026-09-20" on a store that did not,
  // and with the variable exported it minted a blank store in a decoy directory.
  // Nothing was deleted, and it is still the I29 class — a store nobody named,
  // written to — aimed at his real memory.
  //
  // So the cold arm computes its landing place UP FRONT, from the CONFIGURATION'S
  // OWN DIRECTORY and an EMPTY environment, so `$COUNTERPARTS_DATA_DIR` cannot
  // redirect it; prints it; pins it; and refuses if anything is there at all.
  const coldStore = installLayout(undefined, {}, home_, custom).store;

  const planInput = {
    configPath,
    configPresent: present,
    dataDir: host.config.dataDir,
    snapshotsConfigured: host.config.snapshots?.dir,
    home: home_,
  };
  const plan = planStartFresh({ ...planInput, now: at });
  const landing = plan.storeDir.length > 0 ? plan.storeDir : coldStore;

  io.out("counterparts start-fresh — park this memory and begin on a blank one.");
  io.out("Nothing is ever deleted, and the parked store is never opened.");
  io.out("");
  for (const line of planLines(plan, landing)) io.out(line);
  if (plan.refusal !== null) {
    io.out("");
    io.err(plan.refusal);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }

  // The cold arm's own refusal: `install` is about to create a store at
  // `landing`, and on this arm nobody named it — so anything there at all is a
  // store this command was not asked to touch.
  if (!present) {
    const there = sight(landing);
    if (there.present && there.entries > 0) {
      io.out("");
      io.err(
        `refused: there is no configuration at ${configPath}, so this would have been an ` +
          `ordinary first install — but ${landing} already holds something ` +
          `(${String(there.entries)} entries). This command will not create a store on top of ` +
          "one nobody named, and it will not park one the configuration does not point at. " +
          (custom === undefined
            ? "Name the configuration that belongs to that store: "
            : "Check the path you typed — a configuration one character off names a directory " +
              "that is not yours to start fresh in: ") +
          `${CONFIG_FLAG} <absolute path>.`,
      );
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
    if (existsSync(join(dirname(configPath), CONFIG_FILE)) && custom !== undefined) {
      io.out("");
      io.err(
        `refused: ${configPath} is not there, but ${join(dirname(configPath), CONFIG_FILE)} is — ` +
          "so the path you named is one character away from a configuration that exists. This " +
          "command will not treat a typo as a request to install a second memory beside the " +
          "first one.",
      );
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
  }

  io.out("");
  io.out("The configuration:");
  for (const line of configLines(plan)) io.out(line);

  // ── EVERYTHING `install` WILL BE HANDED, VALIDATED NOW (review M1) ────────
  //
  // `loadConfig`'s `num()` accepts any finite positive number, and
  // `installCommand` requires a whole one — so a fractional
  // `injectionBudgetBytes` loaded fine everywhere else and refused HERE, after
  // both renames, leaving the configuration pointing at nothing. The ceiling
  // passthrough only exists to suppress a paragraph (the file is kept either
  // way), so a value `install` would refuse is simply not passed, and the
  // paragraph is a cheaper thing to lose than the window is to widen.
  //
  // The order below closes that window for good regardless: the blank store is
  // built BEFORE anything is parked.
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
    for (const line of rollback) io.out(line);
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

  // Only the parking arm needs a human. Creating a store where there is none —
  // the first-install and the resume arms — writes nothing anybody can lose.
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
    io.out("  Look for lines running one of OURS — serve.ts (an MCP server), dashboard.ts,");
    io.out("  hook.ts, runner.ts (the worker). Every one of those is holding the store open.");
    io.out("  IGNORE anything that merely has the word in a path: `pgrep -f` matches the");
    io.out("  whole command line, so an editor, a `tail`, a dev server in a directory with");
    io.out("  this name in it will all show up and none of them matters. This command will");
    io.out("  be in the list too.");
    const stop = livenessRefusal(io, plan);
    if (stop !== null) return stop;

    // ── `--yes` IS NOT ENOUGH ON A STORE WITH SOMETHING IN IT ───────────────
    //
    // `--yes` exists for a script and for the install loop, where the store is
    // a throwaway. On a machine with a real memory the typed confirmation is
    // the ONLY instrument that catches the idle dashboard — the review found
    // two of them holding the live store open while it was writing that
    // sentence. So `--yes` alone, on a non-empty store, is exactly the
    // combination that defeats the one guard that works. The second flag is
    // not ceremony: it is the sentence `--yes` does not say.
    if (parsed.flags["yes"] === true && plan.storeEntries > 0 && parsed.flags["nothing-is-open"] !== true) {
      io.err("");
      io.err(
        `refused: --yes on a store with ${String(plan.storeEntries)} things in it. --yes skips the ` +
          "typed confirmation, and on a real store that confirmation is the only check that can " +
          "catch a dashboard or an MCP server holding it open — neither leaves a record this can " +
          "read. Type the name when asked, or, if you have genuinely closed everything and mean " +
          "to run this unattended, say so: --yes --nothing-is-open.",
      );
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
    if (parsed.flags["yes"] !== true) {
      if (io.prompt === undefined) {
        io.err("");
        io.err(
          "refused: this is not an interactive console and nothing was confirmed. Pass --yes if " +
            "that is what you mean — and close your sessions first, because nothing here can check " +
            "that for you.",
        );
        io.err("Nothing has changed.");
        return EXIT.refused;
      }
      // `typed()`, not a hand-rolled compare (cli CONTRACT 36): Esc, an empty
      // Enter and the word `cancel` are a person deciding against it, said back
      // in the sentence every typed confirmation uses, and they exit 0.
      const said = await typed(
        io,
        word,
        `Type the parked name to go ahead [${word}] — Esc or "cancel" to stop: `,
      );
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

  // ── RE-READ THE GROUND, AND REFUSE IF IT MOVED (review M2) ────────────────
  //
  // The human took time. A session may have started; something may have taken
  // the parked name this plan chose. Re-reading is right — but the old shape
  // then EXECUTED the second plan while the rollback block on his screen came
  // from the first, and the review reproduced exactly that: a decoy took the
  // name, the rename went to `-2`, and the printed "way back" restored the
  // decoy. Rather than silently running a different plan, this refuses and says
  // what changed. Nothing has moved at that point, so running it again is free.
  const final = planStartFresh({ ...planInput, now: at });
  if (final.refusal !== null) {
    io.err(`refused after re-reading the directory: ${final.refusal}`);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const drifted = parksDiffer(plan.parks, final.parks);
  if (drifted !== null) {
    io.err("");
    io.err(
      `refused: the ground moved while this was waiting for you — ${drifted}. The plan printed ` +
        "above is not the plan that would run now, and running a plan you did not read is how a " +
        "rollback block ends up naming the wrong directory. Nothing has changed; run it again.",
    );
    return EXIT.refused;
  }
  if (final.shape === "park") {
    // The warning half was printed above the question; repeating it under the
    // answer would read as a second finding.
    const stop = livenessRefusal(io, final, "after re-reading the directory", false);
    if (stop !== null) return stop;
  }

  // ── THE BLANK STORE IS BUILT BEFORE ANYTHING IS PARKED (review M1, M4) ────
  //
  // Two findings close here, and the order is the whole fix.
  //
  // M1: `install` could refuse AFTER both renames, leaving the configuration
  // pointing at nothing. Built first, an install that refuses costs a temporary
  // directory and nothing else — the store has not moved.
  //
  // M4: the window between the park and the install was wide enough for a real
  // SessionStart hook to MINT a store at `dataDir` (the reviewer fired one and
  // watched `store/` reappear with a database, a cache and a sessions
  // directory). That is the collision the rollback's `mv` then nests into. The
  // blank store is built in a sibling — same filesystem, so the move into place
  // is one atomic rename — and the window is now two renames wide instead of a
  // whole `install`.
  //
  // The cold and resume arms park nothing, so they install straight at the
  // landing place and skip all of this.
  const parking = final.parks.length > 0;
  const installTarget = parking ? freeTempStore(final.storeDir) : landing;

  io.out("");
  io.out(
    parking
      ? "Building the blank store beside your memory first, so that nothing is moved until"
      : "Creating the blank store. This is 'counterparts install', run for you:",
  );
  if (parking) {
    io.out("there is a store ready to take its place. This is 'counterparts install':");
  }
  io.out("");
  // WAS THERE A STORE HERE BEFORE THIS RUN? Asked HERE, of the path `install`
  // is about to land on, and it is the whole of B1's last clause.
  //
  // On the parking arm `installTarget` is a temp sibling, so this is false by
  // construction. On the RESUME and cold arms it is the live path — and a hook
  // can mint a store there between the plan and this line (M4's exact
  // reproduction). `install` would then print "Store already present" and the
  // record below would stamp "began today" into a store this run did not make,
  // on a surface the owner reads and cannot unset from the console.
  const existedBefore = storeExists(installTarget);
  const installFlags: Record<string, string | boolean | undefined> = { dir: installTarget };
  if (name !== undefined && name.length > 0) installFlags["name"] = name;
  if (ceilingOk) installFlags["budget"] = String(ceiling);
  // WRAPPED, because a THROW here would reach `run()`'s outer catch and print
  // `start-fresh failed: …` — true, and missing the one sentence that matters.
  let code: number;
  try {
    code = installCommand(
      { command: "install", positional: [], flags: installFlags },
      io,
      env,
      home_,
      named,
      { hostSteps: false, newInstall: "start-fresh" },
    );
  } catch (err) {
    io.err(`the install failed: ${String((err as Error).message ?? err)}`);
    code = EXIT.failed;
  }
  if (code !== EXIT.ok) {
    io.err("");
    io.err(
      "The install did not complete, so NOTHING WAS MOVED — your memory is exactly where it " +
        `was, at ${final.storeDir.length > 0 ? final.storeDir : landing}.` +
        (parking ? ` A part-built store may be left at ${installTarget}; it is not yours and nothing reads it.` : ""),
    );
    return code;
  }

  // ── the renames ───────────────────────────────────────────────────────────
  let parkedStore: string | null = null;
  if (parking) {
    io.out("");
    const outcome = park(final.parks);
    for (const step of outcome.done) io.out(`  parked ${step.label}: ${step.from} -> ${step.to}`);
    const store = outcome.done.find((s) => s.label === "store");
    parkedStore = store === undefined ? null : store.to;
    if (outcome.failed !== null) {
      io.err(`failed to park ${outcome.failed.label}: ${outcome.error ?? "no detail"}`);
      io.err(
        outcome.done.length === 0
          ? `Nothing has changed. The blank store built for this run is at ${installTarget}.`
          : "What is listed above HAS moved; nothing else has, and nothing was deleted.",
      );
      printWayBack(io, final, outcome.done.map((s) => s.label), installTarget);
      return EXIT.failed;
    }

    // THE ONE REMAINING WINDOW, and what happens if something got into it.
    // `rename` onto a non-empty directory fails rather than merging, which is
    // exactly the behaviour wanted: if a hook minted a store here in the last
    // two syscalls, this REFUSES and names all three directories rather than
    // burying one inside another.
    try {
      renameSync(installTarget, final.storeDir);
    } catch (err) {
      io.err("");
      io.err(
        `the blank store could not be moved into place: ${String((err as Error).message ?? err)}`,
      );
      io.err(
        `Something appeared at ${final.storeDir} between the rename and this step — a hook or a ` +
          "worker that was still running is the likely one. NOTHING WAS DELETED and nothing was " +
          "merged. Exactly three directories exist right now:",
      );
      io.err(`  your memory, parked and untouched:  ${parkedStore ?? "(not parked)"}`);
      io.err(`  whatever appeared at the store path: ${final.storeDir}`);
      io.err(`  the blank store this run built:      ${installTarget}`);
      io.err(
        "Close everything, look at the middle one, and move it aside by hand; then either move " +
          "the blank store into place or put your memory back with the lines below.",
      );
      // EVERY step that moved, not just the store: `outcome.done` carries the
      // snapshots too by this point, and a way back missing its line is the
      // stale-block problem M2 is about, one branch over.
      printWayBack(io, final, outcome.done.map((st) => st.label), installTarget);
      return EXIT.failed;
    }
  }

  const created = parking ? final.storeDir : installTarget;

  // ── the record the new store keeps of its own beginning ───────────────────
  //
  // Box 2's meta table, which is this store's general-purpose key space. NOT a
  // memory, not an identity element, not a durable event.
  //
  // WRITTEN ONLY WHEN THIS RUN MADE THE STORE (review B1). Stamping "began on"
  // into a store that was already there is a falsehood on a surface the owner
  // reads and cannot unset from the console.
  //
  // AND THE PREVIOUS STORE IS NAMED ONLY WHEN IT IS KNOWN (review M4). The
  // resume arm used to take the newest parked NAME, which on a machine where a
  // hook had minted a half store was `…-2` — an empty shell — while the real
  // memory sat in the directory before it. More than one candidate now means
  // the record says nothing and the output lists them all.
  const previous = parkedStore ?? soleParked(final);
  if (!existedBefore) {
    try {
      const store = openStoreAt({ dir: created });
      try {
        const entries: [string, string][] = [
          [STORE_STARTED_KEY, final.date],
          [STORE_STARTED_BY_KEY, "start-fresh"],
        ];
        if (previous !== null) entries.push([STORE_PREVIOUS_PARKED_KEY, previous]);
        store.setMetaMany(entries);
      } finally {
        store.close();
      }
    } catch (err) {
      // A record that would not write must not undo a cut-over that worked.
      io.err(
        `  (could not record this store's beginning: ${String((err as Error).message ?? err)} — the ` +
          "store itself is fine, and `status` will simply not mention the date.)",
      );
    }
  }

  // ── what to do next ───────────────────────────────────────────────────────
  io.out("");
  io.out("Done. What is left is yours to do:");
  io.out("");
  // WHAT THIS COMMAND KNOWS, AND WHAT IT DOES NOT. It never reads
  // `~/.claude/…` — `install` prints the host's two steps and refuses to touch
  // them, and this inherits that.
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
    for (const p of final.alreadyParked) io.out(`       ${p}`);
  }
  if (name === undefined || name.length === 0) {
    io.out("");
    io.out("  The new store has NO identity core: nothing else gives a store one, and the");
    io.out("  wake has nothing to be about without it. To seed one (it is an ensure, so");
    io.out("  it only adds the core):");
    io.out(`    ${BIN.cli} init --dir ${created} --name "<your name>"`);
    io.out("  Or pass --name to this command next time.");
  }
  // THE WAY BACK, AS IT ACTUALLY STANDS (review M2). The block above the
  // confirmation was printed from the plan that was READ; this one is printed
  // from the plan that RAN, after it ran, so the two can never disagree.
  printWayBack(io, final, ["store", "snapshots"], null);
  io.out("");
  io.out(`Then: ${BIN.cli} status --dir ${created}`);
  return EXIT.ok;
}

/**
 * `start-fresh --undo` — put the parked store back.
 *
 * The same discipline as the forward direction, and for the same reason: one
 * `rename` per directory, nothing copied, nothing deleted, nothing opened that
 * belongs to the parked store — and every path either direction renames goes
 * through the SAME guard ring (`start-fresh.ts#pathGuard`), which is the fix
 * for the confirmation review's BLOCKER: this was new code that ran none of the
 * forward direction's refusals and would rename inside `~/.bansai`.
 *
 * The blank store is PARKED rather than removed — but its name is
 * `store.blank-<date>`, which nothing reads as a parked store, so there is no
 * `--undo` of an `--undo`. The two guarded lines that do it by hand are printed
 * at the end of a successful run instead.
 *
 * WHICH parked store it puts back is read from the record the forward run left
 * in the store that is there now (`store.previous.parked`) — the one directory
 * that run actually moved. When that cannot be had, `planUndo` falls back to
 * the siblings on disk and refuses when there is more than one, because
 * guessing the newest NAME is exactly how the review found an empty shell being
 * named as somebody's memory.
 */
async function startFreshUndo(
  parsed: Parsed,
  io: Io,
  configPath: string,
  configPresent: boolean,
  dataDir: string | undefined,
  now: () => number,
  home_: string,
): Promise<number> {
  if (!configPresent || dataDir === undefined || dataDir.trim().length === 0) {
    io.err(
      `refused: ${configPath} ${configPresent ? 'names no "dataDir"' : "is not there"}, so there is ` +
        "no way to know which store to put one back at.",
    );
    return EXIT.refused;
  }
  const written = dataDir.trim();
  const storeDir = isAbsolute(written) ? resolve(written) : written;

  // THE DATE IS FROZEN HERE TOO, for the reason the forward direction freezes
  // it: the human is asked a question, and the UTC day can turn over while they
  // answer (confirmation review MINOR-2).
  const at = now();

  // The record, from the store that is there NOW — and it is DATA, not an
  // instruction: `planUndo` puts it through the same ring the forward direction
  // runs and then through the shape rule. Reading it is the one open in this
  // path, of the NEW store, as an observer.
  const readRecord = (): string | null => {
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
  for (const line of undoLines(plan)) io.out(line);
  if (plan.refusal !== null) {
    io.out("");
    for (const line of plan.refusal.split("\n")) io.err(line);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }

  // EVERY DESTINATION, CHECKED BEFORE THE FIRST MOVE — against the ground AS IT
  // WILL BE when that step runs, not as it is now. Step 1 parks the blank store,
  // which is precisely what frees the path step 2 needs; a check that read the
  // directory as it stands would refuse its own plan. So a destination is only a
  // problem when nothing earlier in the plan is about to vacate it.
  const vacated = new Set<string>();
  for (const step of plan.steps) {
    if (existsSync(step.to) && !vacated.has(step.to)) {
      io.out("");
      io.err(
        `refused: ${step.to} already exists, so putting ${step.from} back there would either ` +
          "fail or, with a bare `mv`, nest one directory inside the other. Move it aside by hand " +
          "and run this again. Nothing has changed.",
      );
      return EXIT.refused;
    }
    vacated.add(step.from);
  }

  // ── THE SAME LIVE-SESSION CHECK THE FORWARD DIRECTION RUNS ───────────────
  //
  // Confirmation review MAJOR-2: `--undo` called `readLiveness` nowhere, so a
  // fresh un-ended session record that refuses the forward command outright —
  // even under `--yes --nothing-is-open` — let the undo move both directories.
  // The store it displaces is a real one too: on the owner's machine it is a
  // week of new memories with a dashboard attached.
  const livePlan: StartFreshPlan = {
    ...EMPTY_LIVENESS_PLAN,
    storeDir,
    date: dateOf(at),
    configPath,
    liveness: readLiveness(storeDir, at),
  };

  if (parsed.flags["dry-run"] === true) {
    livenessRefusal(io, livePlan);
    io.out("");
    io.out("Dry run. Nothing has been moved.");
    // SAID, because it is true and a careful reader checking bytes will find it
    // (confirmation review MINOR-4): reading the record opens the NEW store as
    // an observer, and SQLite rewrites its shared-memory index when it does.
    // And since `Db.close()` really closes (2026-10-11, review of #438): when
    // that read is the LAST connection on the file, SQLite folds any log left
    // in the `-wal` into the database file as it closes. No row changes; the
    // file's bytes can, so the sentence no longer says nothing else was touched.
    io.out("  (this read the new store's record, so its `-shm` index may have been");
    io.out("   rewritten, and a log left in its `-wal` folded into its database file.");
    io.out("   No memory in it changed, and the parked store was not opened.)");
    return EXIT.ok;
  }
  {
    const stop = livenessRefusal(io, livePlan);
    if (stop !== null) return stop;
  }
  // THE SAME RULE AS THE FORWARD DIRECTION, and for the same reason: the store
  // being displaced here is a real one too — a week of new memories, held open
  // by the same idle dashboard that leaves no record. An undo is not a smaller
  // act than a start.
  const displaced = sight(storeDir);
  if (parsed.flags["yes"] === true && displaced.entries > 0 && parsed.flags["nothing-is-open"] !== true) {
    io.err("");
    io.err(
      `refused: --yes on an undo that displaces a store with ${String(displaced.entries)} things ` +
        "in it. The typed confirmation is the only check that catches a dashboard or an MCP " +
        "server holding it open. Type the name when asked, or say the other sentence too: " +
        "--yes --nothing-is-open.",
    );
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
    // THE PARKED NAME, not the store's. `store` is what every store is called,
    // so typing it back proves nothing; the dated parked name is the thing on
    // the screen that has to have been read.
    const word = basename(plan.parked ?? storeDir);
    const said = await typed(
      io,
      word,
      `Type the parked name to go ahead [${word}] — Esc or "cancel" to stop: `,
    );
    if (said === "cancelled") {
      io.out("Cancelled. Nothing has changed.");
      return EXIT.ok;
    }
    if (said !== "typed") {
      io.err("refused: the confirmation did not match. Nothing has changed.");
      return EXIT.refused;
    }
  }

  // ── RE-READ THE GROUND (confirmation review MINOR-2) ─────────────────────
  //
  // M2's lesson, applied to this direction: a plan held across a person is a
  // plan about a store that may have changed. The date is frozen, so the only
  // thing that can differ is the ground itself.
  const finalPlan = planUndo({
    storeDir: written,
    parked: isAbsolute(storeDir) ? readRecord() : null,
    configPath,
    now: at,
    home: home_,
  });
  if (finalPlan.refusal !== null) {
    io.err(`refused after re-reading the directory: ${finalPlan.refusal}`);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const drift = undoStepsDiffer(plan.steps, finalPlan.steps);
  if (drift !== null) {
    io.err("");
    io.err(
      `refused: the ground moved while this was waiting for you — ${drift}. Nothing has ` +
        "changed; run it again and read the plan that prints.",
    );
    return EXIT.refused;
  }

  io.out("");
  const outcome = park(
    finalPlan.steps.map((st) => ({ label: st.label, from: st.from, to: st.to })),
  );
  for (const step of outcome.done) io.out(`  moved ${step.label}: ${step.from} -> ${step.to}`);
  if (outcome.failed !== null) {
    io.err(`failed to move ${outcome.failed.label}: ${outcome.error ?? "no detail"}`);
    io.err("What is listed above HAS moved; nothing else has, and nothing was deleted.");
    // THE WAY BACK, which this branch used to print not at all (confirmation
    // review MINOR-1). The forward direction prints it in both of its
    // stop-partway branches; a half-done undo leaves the owner with nothing at
    // `dataDir` and a directory whose name says it is the disposable one.
    io.out("");
    io.out("Undoing what this run managed, each line refusing rather than nesting:");
    for (const step of [...outcome.done].reverse()) io.out(guardedMove(step.to, step.from));
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
  // THE WAY BACK FROM AN UNDO (confirmation review MINOR-3). The blank store is
  // parked as `store.blank-<date>`, which `siblingsParked` never matches and no
  // record names — so a second `--undo` correctly refuses, and until now
  // nothing said how to get it back. It is two guarded lines, printed.
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

/** What changed between the undo plan that was read and the one that would run. */
function undoStepsDiffer(
  before: readonly { label: string; from: string; to: string }[],
  after: readonly { label: string; from: string; to: string }[],
): string | null {
  if (before.length !== after.length) {
    return `there ${after.length === 1 ? "is" : "are"} now ${String(after.length)} move(s), not ${String(before.length)}`;
  }
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i];
    const b = after[i];
    if (a === undefined || b === undefined) continue;
    if (a.from !== b.from || a.to !== b.to) {
      return `${a.label} would now move ${b.from} -> ${b.to}, not ${a.from} -> ${a.to}`;
    }
  }
  return null;
}

/** The fields `livenessRefusal` reads, and nothing else — so the undo can reuse
 *  it without pretending to be a forward plan. */
const EMPTY_LIVENESS_PLAN = {
  shape: "park" as const,
  configPresent: true,
  parks: [],
  alreadyParked: [],
  snapshotsDir: null,
  snapshotsElsewhere: null,
  snapshotsLeft: null,
  strayTempStores: [],
  storeEntries: 0,
  preRowsMarkers: [],
  refusal: null,
};

/**
 * A free `store.new-<pid>` beside the store — the sibling the blank store is
 * built in before it is moved into place. A sibling, so the move is one atomic
 * rename on one filesystem.
 */
function freeTempStore(storeDir: string): string {
  const base = `${storeDir}.new-${String(process.pid)}`;
  if (!existsSync(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    if (!existsSync(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
  }
  throw new Error(`no free temporary name beside ${storeDir}`);
}

/** What changed between the plan that was read and the plan that would run, or
 *  null when they are the same set of renames. */
function parksDiffer(before: readonly ParkStep[], after: readonly ParkStep[]): string | null {
  if (before.length !== after.length) {
    return `there ${after.length === 1 ? "is" : "are"} now ${String(after.length)} thing(s) to move, not ${String(before.length)}`;
  }
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i];
    const b = after[i];
    if (a === undefined || b === undefined) continue;
    if (a.from !== b.from) return `${a.label} would now be moved from ${b.from}, not ${a.from}`;
    if (a.to !== b.to) return `${a.label} would now be parked at ${b.to}, not ${a.to}`;
  }
  return null;
}

/** The one parked sibling, or null when there is none or more than one. */
function soleParked(plan: StartFreshPlan): string | null {
  return plan.alreadyParked.length === 1 ? (plan.alreadyParked[0] ?? null) : null;
}

/**
 * The way back, printed from the plan that RAN — after the renames, and in
 * every branch that stops partway (review M2, n1).
 *
 * `done` is the labels that actually moved, so a run that parked snapshots and
 * failed on the store does not print a line whose source does not exist.
 */
function printWayBack(
  io: Io,
  plan: StartFreshPlan,
  done: readonly string[],
  tempStore: string | null,
): void {
  const moved = plan.parks.filter((p) => done.includes(p.label));
  if (moved.length === 0 && tempStore === null) return;
  io.out("");
  io.out("The way back, as it actually stands now — each line refuses rather than moving");
  io.out("one directory inside another:");
  const storeBack = moved.some((m) => m.label === "store");
  if (storeBack && sight(plan.storeDir).present) {
    io.out(guardedMove(plan.storeDir, parkedPath(plan.storeDir, BLANK_INFIX, plan.date)));
  }
  for (const step of [...moved].reverse()) io.out(guardedMove(step.to, step.from));
  if (tempStore !== null && existsSync(tempStore)) {
    io.out(`  # the part-built store from this run, yours to remove: ${tempStore}`);
  }
  io.out(`  (or: ${BIN.cli} start-fresh --undo)`);
}

/**
 * The open-store reading, printed and coded once for both passes over the
 * ground. Null when nothing the registry knows about says the store is in use.
 *
 * TWO GRADES, because the evidence comes in two grades (`start-fresh.ts`
 * §`readLiveness`). A live SESSION RECORD refuses. A fresh `-shm` is only
 * printed: measured on this build, the WAL sidecars survive a clean close, so
 * that file is recent after any console command at all — including the `doctor`
 * somebody ran a minute before typing this one. A guard that fired on the
 * innocent case is one people learn to work around.
 */
function livenessRefusal(io: Io, plan: StartFreshPlan, when = "", showRecent = true): number | null {
  const minutes = String(Math.round(OPEN_WINDOW_MS / 60_000));
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
  io.err(
    `refused${when === "" ? "" : ` ${when}`}: a Claude Code session's hooks ran against this ` +
      `store in the last ${minutes} minutes and the host never ended it, so it is very likely ` +
      "still open:",
  );
  for (const sign of plan.liveness.signs) {
    io.err(`  ${sign.what} — ${sign.where} (${String(Math.round(sign.agoMs / 1000))}s ago)`);
  }
  io.err(
    "A rename does not break an open file handle: that session's hooks and its MCP server " +
      "would go on writing into the PARKED directory, and it would stop being the " +
      "byte-identical copy this command promises. Close every Claude Code session and the " +
      `dashboard, wait ${minutes} minutes, and run this again.`,
  );
  io.err("Nothing has changed.");
  return EXIT.refused;
}

// ── rollback ────────────────────────────────────────────────────────────────

/**
 * `rollback` — the console's half of `rollback.ts`: which store, which
 * snapshots folder, the plan printed, what holds the store refused, the word
 * typed, the plan made again, the moves, and the next steps.
 */
export async function rollbackCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
  now: () => number,
): Promise<number> {
  const home_ = opts.home ?? homedir();
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  let storeDir: string;
  let configPath: string;
  let snapshotsConfigured: string | undefined;
  if (dirFlag !== undefined) {
    // `--dir` is a name; the configuration consulted is the one BESIDE it,
    // where `install` puts it, never the default one.
    storeDir = dirFlag;
    configPath = join(dirname(resolve(dirFlag)), CONFIG_FILE);
    snapshotsConfigured = snapshotsDirBeside(resolve(dirFlag));
  } else {
    configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);
    const host = existsSync(configPath) ? hostConfigFor(configPath) : null;
    const dataDir = host?.reason === "loaded" ? host.config.dataDir : undefined;
    if (dataDir === undefined || dataDir.trim().length === 0) {
      io.err(
        `refused: ${host === null ? `there is no configuration at ${configPath}` : `${configPath} names no store this can read`}, ` +
          "so there is no telling which store to roll back. Name it: --dir <absolute path to the store>.",
      );
      return EXIT.refused;
    }
    storeDir = dataDir.trim();
    snapshotsConfigured = host?.config.snapshots?.dir;
  }
  const absolute = isAbsolute(storeDir) ? resolve(storeDir) : storeDir;
  const snapshotsDir =
    snapshotsConfigured !== undefined && snapshotsConfigured.trim().length > 0
      ? resolve(snapshotsConfigured)
      : isAbsolute(storeDir)
        ? defaultSnapshotsDir(absolute)
        : null;
  const lister = opts.processes ?? realProcessLister(env);
  const dryRun = parsed.flags["dry-run"] === true;
  const undo = parsed.flags["undo"] === true;
  const allow = parsed.flags["upgrade-again"] === true;
  const to = typeof parsed.flags["to"] === "string" ? parsed.flags["to"] : undefined;
  if ([undo, allow, to !== undefined].filter(Boolean).length > 1) {
    io.err("refused: --undo, --upgrade-again and --to are three different things; pass one of them.");
    return EXIT.usage;
  }

  // WHAT HOLDS THE STORE, said, and refused when it is evidence about THIS one.
  const holdersRefusal = (at: number, sayMaybe = true): number | null => {
    const holders = readHolders({ storeDir: absolute, configPath, now: at, lister });
    const refusing = holders.filter((h) => h.refuse);
    const maybe = holders.filter((h) => !h.refuse);
    if (sayMaybe && maybe.length > 0) {
      io.out("");
      io.out("  Running, and maybe on this store (its command line does not say which):");
      for (const h of maybe) io.out(`    ${h.what} — ${h.detail}`);
      io.out("  If one of them is on this store, stop it before you go on.");
    }
    if (refusing.length === 0) return null;
    io.out("");
    io.err("refused: this store is open in:");
    for (const h of refusing) io.err(`  ${h.what} — ${h.detail}`);
    io.err(
      "Close every Claude Code session on it, quit Claude Desktop, stop the dashboard " +
        "(and wait for a background run to finish), then run this again. Nothing has changed.",
    );
    io.err(
      `A session that crashed or whose terminal was closed counts for ${String(Math.round(OPEN_WINDOW_MS / 60_000))} minutes after its last hook, ` +
        "and a memory server only while its process runs, so a record left behind stops counting by itself.",
    );
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
      io.err(
        `refused: there is no database in ${absolute}: the rollback stopped before its copy went in, so there is ` +
          `nothing to upgrade, and an upgrade here would start a blank store. Run: ${BIN.cli} rollback --undo --dir ${absolute}`,
      );
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
    const stop = holdersRefusal(now());
    if (stop !== null) return stop;
    if (dryRun) {
      io.out("Dry run: this would remove the hold and, if the store is behind this version, upgrade it");
      io.out(`now, after a new copy to ${snapshotsDir ?? "the snapshots folder"}. Nothing has changed.`);
      return EXIT.ok;
    }
    const { migration } = upgradeAgain({
      storeDir: absolute,
      ...(snapshotsDir === null ? {} : { snapshotsDir }),
      ...(tz === undefined ? {} : { timeZone: tz }),
    });
    io.out(
      migration === null
        ? "The hold is removed. The store was already on this version's schema, so nothing was upgraded."
        : `Upgraded v${migration.from} -> v${String(migration.to)}, after a new copy: ${join(migration.dir, migration.snapshot)}. The hold is removed.`,
    );
    return EXIT.ok;
  }

  if (undo) {
    io.out(`${BIN.cli} rollback --undo — put the set-aside store back.`);
    const plan = planRollbackUndo({ storeDir, configPath, home: home_ });
    io.out(`Store: ${plan.storeDir}`);
    if (plan.hold !== null) io.out(`Set aside: ${plan.hold.aside}`);
    if (plan.refusal !== null) {
      io.err(plan.refusal);
      io.err("Nothing has changed.");
      return EXIT.refused;
    }
    const stop = holdersRefusal(now());
    if (stop !== null) return stop;
    if (dryRun) {
      io.out("Dry run: the restored store has not been written since, so it would be replaced by the");
      io.out("set-aside one, the cache with it, and the hold removed. Nothing has changed.");
      return EXIT.ok;
    }
    const outcome = performRollbackUndo(plan);
    for (const line of outcome.done) io.out(`  ${line}`);
    if (!outcome.ok) {
      io.err(`undo stopped: ${outcome.error ?? "?"}. What moved is listed above; the hold is still there.`);
      return EXIT.failed;
    }
    io.out("The newer store is back and the hold is removed. This version opens it as before.");
    return EXIT.ok;
  }

  // ── the rollback itself ──
  const at = now();
  const input = { storeDir, snapshotsDir, configPath, home: home_, now: at, ...(to === undefined ? {} : { to }) };
  const plan = planRollback(input);
  io.out(`${BIN.cli} rollback — put this store back the way it was before its last upgrade.`);
  io.out("");
  for (const line of rollbackPlanLines(plan)) io.out(line);
  if (plan.refusal !== null || plan.copy === null) {
    io.out("");
    io.err(plan.refusal ?? "refused: nothing to roll back to.");
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const stop = holdersRefusal(at);
  if (stop !== null) return stop;
  const previous = previousVersion(plan.storeDir, plan.copy.from);
  if (dryRun) {
    io.out("");
    for (const line of nextStepLines(plan, previous, BIN.cli)) io.out(line);
    io.out("");
    io.out("Dry run. Nothing has changed.");
    return EXIT.ok;
  }

  // THE TYPED WORD, as `start-fresh` asks for one — and `--yes` only where
  // nothing can be typed. At a terminal it is refused: the word is the check.
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

  // MADE AGAIN after the person answered, and refused if the ground moved.
  const final = planRollback(input);
  if (final.refusal !== null || final.copy?.name !== plan.copy.name || final.aside !== plan.aside) {
    io.err(`refused after re-reading the store: ${final.refusal ?? "the copy or the store changed while this waited"}`);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  // The "maybe" half was said above the question; once is enough.
  const again = holdersRefusal(now(), false);
  if (again !== null) return again;

  const outcome = performRollback(final, at, installedVersion());
  io.out("");
  for (const line of outcome.done) io.out(`  ${line}`);
  if (!outcome.ok) {
    io.err(
      outcome.done.length === 0
        ? `rollback stopped before anything moved: ${outcome.error ?? "?"}. Nothing has changed.`
        : `rollback stopped: ${outcome.error ?? "?"}. What moved is listed above, into ${final.aside}; ` +
            "the hold is in place, so this version will not open the store. " +
            `To put the newer store back: ${BIN.cli} rollback --undo --dir ${final.storeDir}`,
    );
    return EXIT.failed;
  }
  io.out("");
  io.out(`Rolled back to schema v${final.copy?.from ?? "?"}. The newer store is in ${final.aside}.`);
  io.out("");
  for (const line of nextStepLines(final, previous, BIN.cli)) io.out(line);
  return EXIT.ok;
}
