/**
 * The `counterparts` command surface.
 *
 * **Brain analog: none, deliberately** (CONTRACT §2). Humans have no console on
 * their own memory — no inspection of every unfalsifiable anchor, no deliberate
 * erasure, no export. This module is the improvement over the biological
 * original that constitution lines 4 and 6 promise: the self is governed and
 * owner-visible, and the owner owns the data.
 *
 * Three rules shape everything below:
 *
 *   1. **Owner operations never run under observer.** An instrument reading a
 *      store may not initialize one, snapshot one, export one, rebuild one, or
 *      remove from one. `status` is the only read-only command and it runs in
 *      the observer stance by construction, so the console cannot train or
 *      deposit anything by being looked at (scar E7).
 *   2. **Dry run is the default for anything destructive**, with an interactive
 *      confirmation, and the plan is RE-MADE after the confirmation rather than
 *      held across it (scars §2.13, E5 — a lock is never held across a human
 *      prompt, and a plan made before a human went to make coffee is a plan
 *      about a store that may have changed).
 *   3. **Reads are pure** (§5 G9). Inspecting the census or the permanent list
 *      writes nothing and logs nothing; loudness about corruption belongs at
 *      mutation time.
 *
 * `run()` returns an exit code and never calls `process.exit`, so every command
 * is testable against a temp dir with a faked console.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { localDate } from "../../core/time.js";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

import { CLAIMED_DEFAULT_META_KEY } from "../../core/mint.js";
import {
  ID_PREFIX,
  Store,
  storeExists,
} from "../../core/store/index.js";
import { defaultSnapshotsDir } from "../../core/store/paths.js";
// The owner-op seam's REPAIR half — the one door that un-archives, and only for
// the merge's reason. Imported HERE for the same reason `chaseRemoved` is:
// this is the directory the caller-universality test allows to reach that file.
import { MERGED_ARCHIVE_REASON, unarchiveMerged } from "../../core/store/owner-op-seam.js";
// The WALKING read, imported for the same reason and pinned by the same test:
// it skips the archived-read telemetry AND the deny-list, so it is not a `Store`
// method (`store/walk-seam.ts`). The repair plan is a look at the address.
import { readProseWalking } from "../../core/store/walk-seam.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import {
  implicitConfigRefusal,
  resolveConfigPath,
} from "../config-path.js";
import { OBSERVER_ENV, observerFromEnv, unreadableStanceLine } from "../stance-env.js";
import type { LogEntry } from "../log/index.js";
import { zoneBeside } from "../config.js";
// The one answer to "is there an embedder", shared with the hook, the worker and
// the MCP server's entry point — `ask` embeds its question with it.
import { openEmbedder } from "../claude-code/embed-client.js";
import type { LiveEmbedder } from "../claude-code/embed-client.js";
import type { AdapterConfig } from "../config.js";
import type { CheckoutReading } from "../claude-code/doctor.js";
import { exportStore } from "./export.js";
import {
  BIN,
  HOST_EVENTS,
} from "./install.js";
import type { RemovalPlan } from "./removal.js";
import { repairDates } from "./repair-dates.js";
import type { Confidence } from "./repair-dates.js";
import { settleListLines } from "./settle.js";
import { coverageLines } from "./coverage.js";
import { REFLECTED_FEELING_KEY } from "../../core/sleep/index.js";
// The console's shared manners (2026-09-21): is there a person here, ask them,
// and say one marked line back.
import { confirm, isInteractive, isPromptAborted } from "./ui.js";
import type { Ui } from "./ui.js";
import type { UndoPlan } from "./start-fresh.js";
import type { DesktopRepair } from "./desktop.js";
import { BINARY, packagePath } from "../runtime.js";
import { installRoute } from "../plugin.js";
import type { Binary } from "../runtime.js";
import { DESKTOP_HOST } from "../hosts.js";
import type { UninstallInput } from "./uninstall.js";
import { NO_PAGE_VERSION } from "../../core/self/index.js";
import { feelingsLine } from "../feelings-line.js";
// The console's map and the paragraphs the old `usage()` carried. One
// direction only: `help.ts` imports nothing but types back from this file.
import { COMMAND_DETAIL, CONSOLE_FOOTER, advancedHelp, shortHelp } from "./help.js";
import {
  EXIT,
  parse,
  describeDirRefusal,
  resolveDir,
  upgradePending,
  requireDirFlagForBulkWrite,
  openStoreAt,
} from "./commands-shared.js";
import type { Io, RunOptions } from "./commands-shared.js";
import {
  doctorCommand,
  statusCommand,
  probeCommand,
  firedCommand,
  logCommand,
  coverageCommand,
} from "./commands-readings.js";
import {
  catchUpEntry,
  selfPageCommand,
  dreamCommand,
  coreCommand,
  claimsEraCommand,
  settleCommand,
  aboutCommand,
} from "./commands-self.js";
import {
  installCommand,
  installDesktop,
  installInteractive,
  hostWiringCommand,
  initCommand,
} from "./commands-install.js";
import { dashboardCommand } from "./commands-dashboard.js";
import { startFreshCommand, rollbackCommand } from "./commands-start-fresh.js";
import { noteCommand, recallCommand, backupCommand, exportCommand } from "./commands-note.js";
import { removeCommand } from "./commands-remove.js";
import { deleteCommand } from "./commands-delete.js";
import {
  verifyCommand,
  migrateCacheCommand,
  backfillClaimsCommand,
  repairDatesCommand,
} from "./commands-verify.js";
import { scopeCommand, rebriefCommand } from "./commands-scope.js";

// What moved to the commands-*.ts parts, re-exported so every import of this file still resolves.
export { EXIT, parse, openCounterpart, snapshotsDirBeside } from "./commands-shared.js";
export type { Io, RunOptions } from "./commands-shared.js";
export { logEntryLine, firedLines, DOCTOR_RED_EXIT } from "./commands-readings.js";
export { carryForward, KNOWN_HOSTS } from "./commands-install.js";
export { DASHBOARD_DEFAULT_PORT, dashboardLine } from "./commands-dashboard.js";
export type { RunningView, DashboardSeam } from "./commands-dashboard.js";
export {
  STORE_STARTED_KEY,
  STORE_STARTED_BY_KEY,
  STORE_PREVIOUS_PARKED_KEY,
} from "./commands-start-fresh.js";
export { askEmbedder, ASK_SHOWN, ASK_GIST_CHARS, askGist, askMeta, printAskList } from "./commands-note.js";
export { eventLogLines } from "./commands-verify.js";
export { hostCeiling } from "./commands-scope.js";
export type { CeilingFound, CeilingMissing } from "./commands-scope.js";

export const COMMANDS = [
  "status",
  "install",
  // The host's own two files, edited rather than printed (2026-09-21, A). They
  // sit beside `install` because `install` now calls the first of them.
  //
  // THEY WERE `wire` / `unwire` FOR ONE UNPUBLISHED WEEK. The owner renamed them
  // on 2026-09-22: "connect" and "disconnect" are what a person does to an AI,
  // and "wire" is what an electrician does to a house. Nothing shipped under the
  // old names — 0.1.0 has neither command — so there is no alias to keep, and
  // the old spellings are refused as unknown like any other word.
  "connect",
  "disconnect",
  // Leaving: the wiring comes out, and the memory stays unless you say
  // otherwise. The owner's ruling is quoted at the top of `uninstall.ts`.
  "uninstall",
  "init",
  // Starting over as a stranger, in one command: park the store beside itself,
  // blank one in its place, nothing deleted and nothing opened (2026-09-20, N1).
  "start-fresh",
  // Going back to the version before an upgrade (2026-10-11): the store is put
  // back from the copy the upgrade took, the upgraded one set aside, and a hold
  // keeps this version off it until you say otherwise. `rollback.ts`.
  "rollback",
  "note",
  // ONE COMMAND, TWO NAMES, and the reason is in `help.ts#UNLISTED`: `ask` is
  // the word a person reaches for and is the listed spelling; `recall` is the
  // word the MCP tool, `doctor` and every note written before 2026-09-22 use,
  // and it dispatches for good.
  "ask",
  "recall",
  "export",
  "backup",
  "remove",
  // Delete ONE kind of data — conversation text, backups or the activity log —
  // and nothing else (2026-10-13). `commands-delete.ts`.
  "delete",
  "verify",
  "migrate-cache",
  "backfill-claims",
  "repair-dates",
  "repair-merged-beliefs",
  // The old-claims era (2026-10-10): is it on, how many memories it reads at
  // their default, and the switch. Reads under observer; the switch refuses.
  "claims-era",
  "rebrief",
  "probe-oq4",
  // Constitution 11's last sentence as a command: which mechanisms fired this
  // week, which have gone quiet, and which record nothing at all. Read-only.
  // ONE COMMAND, TWO NAMES (2026-09-25): `mechanisms` is the listed spelling
  // and prints one line per memory mechanism; `fired` is its older name and
  // dispatches for good. `--all` on either prints the full `fired` report.
  "mechanisms",
  "fired",
  // What the four processes did, in order, one line each — the process log
  // (`adapters/log/`), a day at a time. Read-only (2026-09-30).
  "log",
  // I32's reading: whether the background half is alive. (Its partner, the
  // `credentials` command, went with the API keys on 2026-09-24.)
  "doctor",
  "scope",
  // The written page the wake leads with: read it, write it whole, and read
  // back what it used to say (2026-09-18, S1).
  "self-page",
  // Dreaming + consolidation (2026-09-26): what each dream did, and its undo;
  // what the core holds, and the owner's door out of it. Like `self-page`,
  // each both reads and writes, so neither is on `OWNER_OPS`: reading works
  // under observer, and the write refuses at the core's own seam.
  "dream",
  "core",
  // Contradictions (2026-09-29): what is unsettled and what was settled, and
  // the owner's settle and undo. Reads and writes, like `dream`; the write
  // refuses at the core's own seam under observer.
  "settle",
  // What a memory is about (2026-10-11): read its mark, or change it as the
  // owner. Reads and writes, like `settle`; the write refuses under observer
  // at the core's own door (`Counterpart.markAbout`).
  "about",
  // What is written up and what is not yet, for one date (2026-09-30,
  // `core/coverage/`). Read-only.
  "coverage",
  // Write up every ended session never written up, now (2026-10-11): the
  // nightly run's catch-up on demand, through the same launcher and child.
  "catch-up",
  // The owner's window, started on the store the CONFIGURATION names — no
  // `--dir` to get wrong, and the browser opened for you (2026-09-22, item 4).
  // `counterparts-dashboard serve` is still there and still refuses an unnamed
  // store; this is the same server with the question already answered.
  "dashboard",
  // "Did that install work?", answered by the program itself rather than by a
  // page of text (2026-09-22, finding #23 and item 1). `counterparts --version`
  // printed the whole help page, because there was no version flag at all.
  "version",
  // The console's own map, as a VERB. `counterparts help doctor` is what a
  // person types; `counterparts doctor --help` was the only way to ask, and
  // nothing said so (2026-09-21, new-user finding 4).
  "help",
] as const;
export type Command = (typeof COMMANDS)[number];

/** Commands that change durable state. Under observer, every one of them refuses. */
export const OWNER_OPS: readonly Command[] = [
  "install",
  // ALL THREE OF THE HOST-EDITING VERBS. An instrument reads; it does not put
  // hooks on somebody's editor, take them off again, or rename the directory
  // holding the memory it was pointed at. `uninstall` can delete a store, which
  // would make it the most consequential thing on this list by itself.
  "connect",
  "disconnect",
  "uninstall",
  "init",
  // It creates a store and moves one. An instrument does neither.
  "start-fresh",
  // It swaps a store's database for an older copy. Its `--undo` and
  // `--upgrade-again` are writes too.
  "rollback",
  // `note` deposits. `ask`/`recall` is a pure read and stays off this list,
  // exactly like `status`, `dashboard` and `version`: an instrument may look at
  // a memory and may not add to one. (`dashboard` opens the store through
  // `Dashboard.open`, which sets observer itself, so a stood-down console and a
  // standing one see the same page.)
  "note",
  // `export` came OFF this list on 2026-09-20 (F7), and it is the only removal
  // this list has had. An export READS the store and writes outside it — that
  // is what `assertSafeTarget` proves about its target — so the one write it
  // ever made to the store was the `store.export` row F7 added, and under
  // observer that row is simply not written and the report says so. Standing
  // the whole command down instead refused a READ, which is the one thing an
  // instrument is for; it also meant the parallel-run instruments could not
  // take a readable copy of the store they were measuring.
  //
  // `backup` stays, deliberately: it is the same shape and could follow, but it
  // has no owner ruling behind it and this change is not the place to make one.
  "backup",
  "remove",
  "delete",
  "verify",
  // Box 3 is rebuildable, and rewriting it is still a WRITE: an instrument does
  // not migrate the store it is reading.
  "migrate-cache",
  "backfill-claims",
  "repair-dates",
  // A repair is a write, and `--dry-run` does not change that: an instrument
  // that has stood down refuses the COMMAND, not just the write, so the owner
  // never gets a plan from a console that could not have carried it out.
  "repair-merged-beliefs",
  "rebrief",
  // It writes memories (through a child it starts) and the write-up marks.
  "catch-up",
  // `doctor` stays off this list beside `status` and `recall`: it is a read.
  // `self-page` is NOT here either, and for a reason of its own: the command
  // both READS and writes, and reading the page must work from an instrument —
  // "what does my page actually say" is the first question anyone asks when the
  // wake looks wrong, and a stood-down console is exactly what is running while
  // somebody is asking it. So the refusal lives at the WRITE, inside
  // `self/#revisePage`, in the same sentence every other write refuses in, and
  // a stood-down `--write` says so and changes nothing.
  //
  // `scope` is NOT here, and the omission is the ruling: it writes the HOST's
  // configuration, never a store, so the observer rule that governs it is its
  // own. An instrument may READ the registry — that is how a stood-down session
  // says why it stood down — and every WRITE through it refuses in the same
  // sentence an owner op would. The refusal therefore lives inside the command,
  // beside the write it guards, rather than on this list, which refuses a
  // command whole.
];

/**
 * WHAT THE SINGLE BINARY WILL NOT DO TO A HOST. The binary lives in the
 * plugin's data directory, which Claude Code deletes with the plugin, and the
 * plugin already runs the hooks and the memory server — so a hooks block, an
 * MCP registration or a Claude Desktop entry naming it would be a second
 * install that dies silently on uninstall. Wiring a host by hand is the npm
 * install's job.
 */
export const BINARY_CONNECT_REFUSAL =
  "This is Counterparts' single program, the one the Claude Code plugin downloads when a computer has no Bun or Node.js. " +
  "It doesn't connect hosts itself: the plugin already runs the hooks and the memory server, and anything wired to this file " +
  "would stop working when the plugin is uninstalled. To wire Claude Code or Claude Desktop by hand, install Counterparts with " +
  "npm (`npm i -g counterparts`) and run `counterparts connect` from that install.";

/**
 * THE CONSOLE'S MAP — about forty lines, grouped, one line per command.
 *
 * It was 129 lines of dense paragraphs until 2026-09-21, and it is the SECOND
 * thing a stranger types: the "did that install work?" check (new-user findings
 * #4). The detail did not go anywhere — it moved to the page that answers the
 * question it answers, `counterparts help <command>`. `help.ts` holds the split,
 * the groups and the table of what was moved where.
 */
export function usage(): string {
  return shortHelp();
}

/** What `versionLine` says when the package's own manifest is not beside the
 *  running code. It is deliberately not a number: a check that greps for one
 *  must fail rather than read a guess as a version. */
const VERSION_UNKNOWN = "(version unknown — package.json is not beside the running code)";

let readVersion: string | null = null;

/**
 * THE VERSION, out of the package's OWN `package.json`.
 *
 * Read from the running file's URL rather than from a constant, because a
 * constant is a second place to forget: this has to be the version of the code
 * that is executing, which is the whole question `counterparts --version`
 * answers after `bun add -g` (2026-09-22, finding #23). `src/adapters/cli/` is
 * three directories under the package root in the repository and in the tarball
 * alike — `package.json#files` ships `src/` whole — so one relative URL is
 * correct in both.
 *
 * It never throws: a manifest that cannot be read is reported in words, because
 * a console that crashed on "which version are you" would be answering the
 * question badly in the one place a person is checking whether it runs at all.
 */
export function packageVersion(): string {
  if (readVersion !== null) return readVersion;
  try {
    const raw = readFileSync(packagePath("package.json"), "utf8");
    const said = (JSON.parse(raw) as Record<string, unknown>)["version"];
    readVersion = typeof said === "string" && said.length > 0 ? said : VERSION_UNKNOWN;
  } catch {
    readVersion = VERSION_UNKNOWN;
  }
  return readVersion;
}

/** `counterparts 0.2.0` — the whole output of `--version`. */
export function versionLine(): string {
  return `${BIN.cli} ${packageVersion()}`;
}

/**
 * BARE `counterparts`, which is now a command rather than a mistake.
 *
 * It printed the map and exited 1 — "an invocation that named nothing is a usage
 * error" (cold-stranger review §6.10, which is really about `--help` exiting 0).
 * On 2026-09-22 the owner gave it a job: it is QUICKSTART's step 2, the thing a
 * person types straight after installing, and a documented step that exits 1
 * kills the `&&` chain the §6.10 scar was written about. So every arm here exits
 * 0.
 *
 * Three arms, and only one of them asks:
 *
 *   - **A terminal, and nothing set up here** → "No memory here yet. Set it up
 *     now? [Y/n]". Yes runs `install`; no prints the map.
 *   - **Not a terminal** → the map, plus one line naming the command that sets
 *     it up. `tools/install-loop/run.sh` runs QUICKSTART's commands with no
 *     terminal and this one MUST NOT BLOCK there: `isInteractive` is false for
 *     a pipe, a CI job and every test console, so the question is never put.
 *   - **A terminal with an install already** → the map, and no question. There
 *     is nothing to offer.
 *
 * "Set up" is read WITHOUT OPENING ANYTHING: it is the existence of the
 * configuration file, which is the same file `doctor`, the hooks and the MCP
 * server resolve. And the explicit-dir guard is asked FIRST — a shell armed with
 * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` gets the map and no question, because
 * the whole point of that variable is that nothing nobody named gets touched,
 * and "is there a config at the default path" is a question about exactly that
 * path.
 */
async function bareConsole(
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
): Promise<number> {
  const named = resolveConfigPath([], env, opts.home ?? homedir());
  const unnameable = named.refusal !== null || implicitConfigRefusal(named, env) !== null;
  const configured = !unnameable && existsSync(named.path);
  if (isInteractive(io, env) && !unnameable && !configured) {
    let go: boolean;
    try {
      go = await confirm(io, "No memory here yet. Set it up now?", { default: true });
    } catch (err) {
      if (!isPromptAborted(err)) throw err;
      io.err("");
      io.err("stopped; nothing was changed.");
      return EXIT.refused;
    }
    if (go) {
      io.out("");
      // THE SAME COMMAND, through the same door. `install` resolves its own
      // layout, its own guards and its own interactive arm, and none of that is
      // worth a second copy here — a bare `counterparts` that answered yes must
      // be indistinguishable from having typed `counterparts install`.
      return await run(["install"], opts);
    }
    io.out(usage());
    return EXIT.ok;
  }
  io.out(usage());
  if (!isInteractive(io, env)) {
    io.out(`Not set up yet? \`${BIN.cli} install\` does it, and it is safe to run again.`);
  }
  return EXIT.ok;
}

/**
 * WHICH FLAGS EACH COMMAND TAKES, and the reason this table exists at all.
 *
 * `parseArgs` runs with `strict: false` — it has to, because a strict parse
 * THROWS and this console does not hand an owner a stack trace. The cost, until
 * 2026-09-04, was that an undeclared flag was silently swallowed: a
 * cold-stranger review typed `counterparts note "…" --dirr <store2>`, got
 * `Remembered mem_… — minted.`, and found store2 still empty — the note had gone
 * to the DEFAULT store, which on a real machine is the owner's live memory, and
 * `--dirr` never appeared in the output. A typo in the one flag that says WHICH
 * STORE is the sharpest edge this console has, and it was the one thing the
 * parser would not mention.
 *
 * So: every flag is declared per command, and anything else is refused BEFORE a
 * store is opened. Two rules, both mechanized in `unknownFlag` below:
 *
 *   1. **A flag nobody declared is an error**, with the nearest declared flag
 *      named if there is a near one. Silence is what made the write invisible.
 *   2. **A flag that wants a value and got none is an error.** `strict: false`
 *      turns `--dir` at the end of a line into the BOOLEAN `true`, which every
 *      reader here treats as "absent" — the same silence one step along.
 */
export const COMMON_FLAGS: readonly string[] = ["dir", "observer", "help"];

export const COMMAND_FLAGS: Record<Command, readonly string[]> = {
  status: ["layout"],
  // `--no-connect` was `--no-wire` until 2026-09-22 (item 3 renamed the verbs,
  // item 9 made connecting the default). Both are new in 0.2.0 and neither has
  // shipped, so there is no compatibility to keep and no alias to carry.
  install: ["budget", "name", "embedder", "no-embedder", "force", "config", "no-connect", "yes", "host"],
  // `--dir` is deliberately absent from all three, exactly as it is from
  // `start-fresh`: it is a COMMON flag, so it parses either way, and these
  // commands refuse it in words rather than ignoring it. The store they name is
  // the one the CONFIGURATION names, because that is the one the hooks open.
  //
  // AND `--yes` IS GONE FROM THE FIRST TWO. It meant "do not put the question",
  // and as of 2026-09-22 there is no question: `connect` names the host and
  // goes, because typing the verb IS the yes (owner item 3). A flag that no
  // longer decides anything is a no-op, and the dashboard's own `--yes` scar
  // (`dashboard/bin/dashboard.ts`) is about exactly that; neither command has
  // ever shipped, so nothing in the world passes it. `uninstall` keeps it — it
  // still asks, and its question is about somebody's memory.
  connect: ["config", "dry-run"],
  disconnect: ["config", "dry-run"],
  uninstall: ["config", "yes", "park", "delete-memories", "keep-memories", "nothing-is-open", "json"],
  // `init` takes `--name` for the same reason `install` does: §3 routes second
  // and scratch stores here, and a store with no identity core is a store the
  // wake has nothing to say about.
  init: ["name"],
  // `--config` because the store it parks is the one a CONFIGURATION names, and
  // `--dir` is deliberately absent from this list — it is a COMMON flag, so it
  // parses either way, and the command refuses it in words rather than ignoring
  // it (the `--dirr` scar, pointed at the most dangerous verb here).
  "start-fresh": ["config", "dry-run", "yes", "nothing-is-open", "name", "undo"],
  // `--dir` names the store, as on every command but the four above; without
  // it the CONFIGURATION's `dataDir` is the store, as for `doctor`.
  rollback: ["config", "to", "undo", "upgrade-again", "dry-run", "yes"],
  // `--config` for the embedder knob only, as on `ask`: a note is embedded on
  // write with the table the configuration turns on.
  note: ["kind", "title", "salience", "config"],
  // Two names, ONE row each and the same one: a flag that worked under `recall`
  // and not under `ask` would be the rename leaking into behaviour.
  ask: ["id", "json", "full", "page", "mode", "config", "voiced"],
  recall: ["id", "json", "full", "page", "mode", "config", "voiced"],
  export: [
    "out",
    "passphrase",
    "plaintext",
    "markdown",
    "include-confidential",
    "with-versions",
    "into-non-empty",
    "overwrite",
  ],
  backup: ["out"],
  // `strike-by-content-across-scopes` is the one chase this console refuses by
  // default: a row whose provenance recorded no scope (every migrated row) can
  // only be chased in the buffer by matching its body, and matching a body
  // across every project on the machine is how one removal reaches into work
  // nobody named. The dry run lists what it WOULD match; this flag performs it.
  remove: ["confirm", "reason", "strike-by-content-across-scopes", "echo-scan"],
  // `--yes` is the door for anything that cannot be asked — a script, the
  // dashboard (which asks in the browser first).
  delete: ["yes"],
  verify: ["rebuild", "drop-vectors", "prune-index", "keep-vectors", "retry-skipped"],
  "migrate-cache": ["apply", "batch", "yes"],
  "backfill-claims": ["apply"],
  "repair-dates": ["apply", "dry-run", "confidence", "import-day", "sample"],
  // `--dry-run` is declared and does NOTHING: dry run is already the default,
  // and the owner's own runbook line spells it out. A flag that names the
  // behavior you are getting must not be refused as unknown.
  "repair-merged-beliefs": ["apply", "dry-run"],
  "claims-era": ["on", "off"],
  // `--config` belongs to the two commands that READ or WRITE a host
  // configuration, and to no others. Declaring it everywhere would say the
  // console takes it for `note` or `recall`, which read no config at all — the
  // store comes from `--dir` there and nowhere else.
  rebrief: ["budget", "config"],
  // Read-only, like `status`: rows in, a table out.
  "probe-oq4": [],
  mechanisms: ["all"],
  fired: ["all"],
  log: ["date"],
  // `doctor` takes `--config` for the same reason `rebrief` does: it reports on
  // the host configuration, and on a machine with two of them the reading is
  // about whichever one the hooks read.
  // `--all` unfolds the screen: on a terminal `doctor` folds every green
  // worker-internal line into one, and this prints them all. Shared with
  // `mechanisms` (and its older name `fired`), whose `--all` means the same
  // thing — every mechanism and every part, in full.
  doctor: ["config", "json", "all"],
  // `--config` because the registry sits BESIDE the configuration, so the flag
  // that says which configuration also says which registry. `--observer` is
  // deliberately NOT declared here: it is a common flag already, and on this
  // one command it means the MODE rather than the console's stance — see
  // `SCOPE_FLAG_HELP`, which is the sentence this command's help page prints
  // for it instead of the shared one.
  scope: ["on", "off", "pause", "resume", "list", "note", "force", "config"],
  // There is deliberately no flag that CARRIES the page: a page on the command
  // line is a page in shell history, and prose that is injected into every
  // session does not belong there.
  "self-page": ["write", "file", "stdin", "short", "reason", "versions", "version", "restore", "clear", "if-version"],
  dream: ["list", "show", "undo", "all", "setting"],
  core: ["list", "demote", "reaffirm", "reason", "reflected-feeling"],
  settle: ["list", "pair", "holds", "against", "how", "why", "undo"],
  about: ["why"],
  coverage: ["date"],
  // `--config` because the store it opens is the one the configuration names,
  // and the child's memory server reads the same file.
  "catch-up": ["config", "reowe", "dry-run", "yes"],
  // `--config` because the store it opens is the one the CONFIGURATION names —
  // that is the whole point of the command over `counterparts-dashboard serve`,
  // which refuses until you name a store. `--dir` still parses (it is common)
  // and still wins when it is given: it is a NAME, and naming a store is never
  // the mistake this command's default is there to prevent.
  dashboard: ["config", "port", "no-open"],
  // None of its own: it prints one line and opens nothing.
  version: [],
  // None of its own: it takes a COMMAND NAME, not a flag. `--help` and `--dir`
  // reach it through `COMMON_FLAGS`, and `--dir` is declared everywhere rather
  // than consulted here — this command opens nothing.
  help: [],
};

/**
 * WHAT EACH COMMAND IS, in one line — the lede of its own help page.
 *
 * `usage()` already carried these sentences, wrapped to fit a block. They are
 * declared here rather than parsed back out of it, because a help page built by
 * re-reading another help page's formatting breaks the moment somebody re-wraps
 * a line.
 */
export const COMMAND_BLURB: Record<Command, string> = {
  status: "What is held, what left, what was removed. Read-only.",
  install:
    "Cold start: create the store and write claude-code.json under ~/.counterparts/ (the path the hooks read unless --config names another). At a terminal it asks your name, turns on recall by meaning (a local table — nothing leaves this machine), connects Claude Code (counterparts disconnect undoes that), and offers back any memory a parked uninstall set aside. Anywhere else — a pipe, a script, a CI job — and with --no-connect it prints the host's hooks block and MCP line and changes nothing of the host's.",
  connect: "Connect an AI to your memory: put the five hooks in the host's settings file and register the memory tools. It backs the settings file up first and says the path, keeps every other tool's hooks exactly where they are, repairs an entry of ours that names a path that is gone, and refuses a settings file it cannot parse. Claude Code is the one host it knows today.",
  disconnect:
    "Disconnect an AI: take the Counterparts hooks back out of the host's settings file and deregister the memory server. It removes only what it recognises as ours; another tool's hooks are never candidates. Your memory is not touched.",
  uninstall:
    "Leave: disconnect Claude Code, then say where your memory still is and how to remove the package. At a terminal it then asks whether to delete your memory too (Enter keeps it; a yes asks you to type a phrase). Otherwise it never touches your memory unless you say --park (one rename, dated) or --delete-memories (which counts first and asks you to type a phrase).",
  init: "Just a store: create a data dir and PRINT the install steps. For a second store or a scratch one.",
  "start-fresh":
    "Begin again as a stranger (or --undo to put the parked store back): park the store your configuration names beside itself under a dated name, park its snapshots the same way, and create a blank store at the same path. One atomic rename each — it never copies, never deletes, and never opens the old store, not even read-only. The configuration is kept byte for byte.",
  rollback:
    "Go back to the version before an upgrade: put the store back from the copy the upgrade took first (the newest one unless --to names another), after saying what would be lost and asking you to type a word. The upgraded database and its cache are set aside beside the store, never deleted, and a hold keeps this version from upgrading or reading the store again until you install the older version, run --upgrade-again, or --undo it. It refuses while a session, a memory server or the dashboard has the store open.",
  note: "Remember this, deliberately — the same two doors the MCP tool uses.",
  ask: "Ask memory a question. Read-only.",
  recall: "Ask memory a question — the same command as `ask`, under its older name. Read-only.",
  export: "A portable copy of the store, encrypted unless you say otherwise.",
  backup: "Snapshot: the canonical DB via VACUUM INTO. The cache is excluded, and so is conversation text: backups never hold it.",
  remove:
    "The loud removal. With nothing after it, at a terminal, it asks for a memory id or for words to search for, numbers what it finds, lets you pick one or several (or name several ids outright), shows the plan for each, and asks once before it deletes them. --confirm is the scripted door: that exact id, confirmed by typing it back. Anywhere a person cannot be asked — a pipe, a redirect, a CI job — and without --confirm, it prints the plan and changes nothing.",
  delete:
    "Delete one kind of data, and nothing else: conversation-text (every word of conversation still held — sessions still owed a write-up lose theirs, and it says how many first), backups (every daily copy and every copy taken before an upgrade — rollback then has nothing to go back to) or activity-log (what the processes did, never what was said). Memories are not touched; start-fresh is their door. It prints what it would delete, then asks once at a terminal; anywhere else it changes nothing without --yes. Refuses under observer.",
  verify:
    "Census of the cache against canonical state. Read-only unless --rebuild, --prune-index or --retry-skipped. --rebuild, --prune-index, --retry-skipped and --drop-vectors require --dir.",
  "migrate-cache":
    "Convert the cache's vectors from JSON text to float32 BLOBs, in place, and compact the file. Dry run — read-only — unless --apply. --apply requires --dir.",
  "backfill-claims": "Give unclaimed AUTHORED memories the default claimed floor. Dry run unless --apply. --apply requires --dir.",
  "repair-dates":
    "Give MIGRATED memories carrying the import day their true `learned` date, read off evidence each row already holds — an engram-era id that is a millisecond timestamp, a v1 date field, a session reference, a source path. Counts by confidence and the proposed dates by count. Dry run unless --apply. --apply requires --dir.",
  "repair-merged-beliefs":
    "Put back beliefs and current-state rows the nightly dedup pass archived as duplicates of an ordinary memory. Dry run unless --apply. --apply requires --dir.",
  "claims-era":
    "The old-claims era: memories written before this build reached the store are read by the curve at today's default for what they are about (work, the world, me, the owner or us). A default the old build filled in reads at today's, higher or lower; a claim made under the old field text reads at it only when that is lower, and the core, memories about the owner or us, said by the owner, protected, and dated ones still ahead or repeating keep their claim. No claim is rewritten. With no flags it says whether the era is on, since when, and how many memories it reads lower and higher; --off reads every claim as stored again (a memory let go at the floor meanwhile stays archived, readable by id), --on puts the same cutoff back. Reading works under observer; the switch refuses there.",
  rebrief: "Re-render and republish the wake bundle NOW, through the boundary's own renderer.",
  "probe-oq4":
    "The OQ4 probe: footnotes delivered vs. later expanded, by calendar date, from recall.decision and recall.credit rows, then recall's hit rate — of what it showed, how much a reply expanded or quoted, loud, footnoted and pointer. Read-only.",
  mechanisms:
    "Is each memory mechanism working? One line per mechanism, with a light (● working this week, ◐ built but not firing, ○ not built yet) and the count from the store behind it, then the plumbing in one line that names only what is failing. --all prints the full report: every part, silent first, when it last fired, how often in the last 7 days, what it turned away, and why the store cannot tell for the ones nothing records. Read-only.",
  fired:
    "The older name of `mechanisms` — the same command, the same output. --all prints the full report. Read-only.",
  log: "What happened today, in order: one line per thing the hooks, the background worker, the nightly run and the memory tools did — failures, stand-downs, each turn's end, write-ups, the nightly run, the wake. Kept 7 days. Read-only.",
  doctor:
    "Is the background half alive? The config, the two clocks, the newest sweep, sleep, backfill and credit rows, the spawn refusals and the vector coverage — worst first, each with the line that fixes it. Read-only; exit 1 if anything is red.",
  scope:
    "Which directories this memory is for: on, observer, off, or paused until you resume it. It writes the host's own registry beside claude-code.json, opens no store, and needs no --dir. A subdirectory inherits its nearest ancestor's entry. On this one command --observer names the MODE, not the console's stance.",
  "self-page":
    "The written page the wake opens with. With no flags it prints the page, its date and its size; --write --file <path> or --write --stdin replaces it whole, keeping every earlier version; --short <file> beside them gives a page past its room the short version sessions read on a day the wake has no room for it whole (alone, with --write, it is added to the page as it stands); --versions lists those and --version <seq> prints one. Reading works under observer; writing refuses there.",
  dream:
    "What each dream did, and its undo — and what the waking self made of it. With no flags (or --list), the newest 20 dreams (--list --all for every one): date, state, title and what changed, then the recent reflections; --show <id> prints one dream's journal, every change it made and the reflection after it (--show <rfl_…> prints one reflection: its questions, entry, what it rests on and its morning share); --undo <id> reverses that dream's whole batch (merges come apart, links and gists go, replays and nominations are taken back) and keeps its journal, marked undone — a reflection is lived and stays. Reading works under observer; --undo refuses there.",
  core:
    "The core — the memories about me and about us that do not fade. With no flags (or --list), what it holds and which lane carried each one there, what dreams have nominated, what is being reconsidered, and what was sent back; --demote <id> --reason \"...\" sends one back to ordinary fading from today, records why, and keeps the lanes from promoting it again; --reaffirm <id> --reason \"...\" keeps one that is being reconsidered (it is not flagged again for what it is); --reflected-feeling on|off opens or closes the core to reflection alone. On (the default): a feeling a reflection records later and a reflection citing a memory both count toward the fast lane, and a reflection may re-label what a memory is about either way — each re-label is recorded with its reason, and one into me, us or the owner is told in the next morning share. Off: nothing reaches the core on a reflection alone — the fast lane needs a feeling felt at the time (not one a reflection recorded later) and an ordinary use after a gap (not a reflection citing it), and a reflection may only move what a memory is about toward work or world. Reading works under observer; the changes refuse there.",
  settle:
    "Two memories that disagree. With no flags (or --list), the pairs nobody has settled — a dream flags them — and the ones settled lately: how, which holds, who settled it and why; and the corrections held in the last 7 lived days (a memory said it changes or corrects one that didn't look related, so nothing was settled) that nobody has settled since, each with the command that settles it. --pair <id> --holds <memory id> --how changed|corrected|open --why \"...\" settles one as you (or --holds <id> --against <id> for two memories no dream flagged): changed — both were true at their time, the older fades once and is shown as earlier; corrected — the older was wrong, it leaves recall and stays readable by its id; open — a real disagreement, both kept and shown together. No memory is rewritten. --undo <pair> reverses a settle: the strength comes back, a corrected memory comes back into recall, and the pair is unsettled again. Reading works under observer; the two changes refuse there.",
  about:
    "What a memory is about — me (who I am), us (the two of us), owner (you, as a person), work (the craft) or world (anything else). With an id alone, its mark and who set it; with an id and a mark, it changes the mark as you, keeps --why with it, and records it the way a nightly reflection's re-mark is recorded. Unmarked, a fact written in a project (or a skill) counts as that project's work and is shown only there; me, us and owner are shown everywhere and can become part of who I am. An archived memory can be marked too (the mark counts if it comes back); an earlier version's id marks the current one. Reading works under observer; the change refuses there.",
  coverage:
    "What is written up, and what is not yet, for one date (default today): each session that captured something that day, how much of it is written up, and what is not yet written up — how many pieces, over how long, since when — and whether that is owed (the nightly run catches it up, or counterparts catch-up does now), lapsed (let go unwritten after fourteen days of use — lost to memory; its text is deleted with the rest, never more than 14 days after the session), under the floor, or still at work. Read-only.",
  "catch-up":
    "Write up, now, every session that ended before it was written up — what the nightly run does each morning, on demand. Oldest first, in batches, each a windowless claude -p of its own allowed one tool (session_end); it prints each batch, then what it caught up and what is left. Sessions may be open meanwhile: one still at work is left for later, one being written up elsewhere is passed over. It uses your Claude subscription like any session. At most 400 parts and an hour a run; what is left stays owed. A part whose every word the session's own chapters or notes already wrote up is passed over, and a part answered with nothing kept and no reason why stays owed. --reowe <run> owes again the parts a run (cup_… or nrn_…) closed with nothing kept, when their words were not yet written up: it prints the plan, then asks for the run's id typed back (--yes skips that, --dry-run stops at the plan); it reads the run from the log, which keeps a week, and refuses by name what it cannot do. Refuses under observer.",
  dashboard:
    "Open the dashboard in your browser: the web view of the store your configuration names, served on 127.0.0.1 and nowhere else. Ctrl-C stops it. Looking is read-only — it strengthens nothing and deposits nothing. What you do there on purpose (write a note, remove a memory, back up, …) runs through these same commands, and a removal asks you to type the id back.",
  version: "The version of Counterparts you have. It opens nothing.",
  help:
    "The console's own map. With no argument, the commands a person reaches for, one short line each; with 'advanced', the maintenance shelf and the three flags every command takes; with a command name, that command's whole page.",
};

/** The invocation line, where a command takes something that is not a flag. */
const COMMAND_ARGS: Partial<Record<Command, string>> = {
  note: ' "<text>"',
  ask: ' "<question>"',
  recall: ' "<question>"',
  // Three shapes, and the bare one is the door a person uses: an id, the words
  // to find one by, or nothing at all and it asks.
  remove: " [<id>… | <words>]",
  delete: " conversation-text|backups|activity-log",
  scope: " <path|.>",
  // The host is OPTIONAL and there is one of them: `counterparts connect` and
  // `counterparts connect claude-code` are the same command, and any other name
  // is refused with the one it knows. The synopsis says so rather than offering
  // a menu of one (owner item 3).
  connect: " [claude-code]",
  disconnect: " [claude-code]",
  help: " [advanced | <command>]",
  dream: " [--list [--all] | --show <id> | --undo <id>]",
  core: " [--demote <id> --reason \"...\" | --reaffirm <id> --reason \"...\" | --reflected-feeling on|off]",
  settle: " [--list | --pair <id> --holds <id> --how changed|corrected|open --why \"...\" | --undo <pair>]",
  about: " <id> [me|us|owner|work|world] [--why \"...\"]",
  coverage: " [--date YYYY-MM-DD]",
};

/**
 * COMMANDS WHOSE SYNOPSIS DOES NOT OFFER `--dir`.
 *
 * Every other command takes it. `start-fresh` turns it away in words (the store
 * parked is the one the configuration names), and `help` opens no store at all —
 * a usage line that showed the flag would be teaching the thing the refusal
 * exists to prevent, or offering a flag that does nothing. Both still accept it
 * as a common flag, and both say so under "Everywhere".
 */
const NO_DIR_IN_SYNOPSIS: readonly string[] = [
  "start-fresh",
  "help",
  // It prints one line out of `package.json` and opens nothing at all.
  "version",
  // The three host-editing verbs refuse it in the same words `start-fresh` does:
  // what they act on is decided by the CONFIGURATION, and a second answer on the
  // command line is how the wrong host file or the wrong directory gets edited.
  "connect",
  "disconnect",
  "uninstall",
];

/**
 * EVERY FLAG, IN ONE SENTENCE. Keyed by the names `COMMAND_FLAGS` and
 * `COMMON_FLAGS` already declare, so `counterparts <command> --help` prints
 * exactly what `unknownFlag` accepts — one table read twice, rather than a help
 * page and a parser that drift apart. The test walks every declared flag
 * against this record, so a flag added without a sentence fails there instead
 * of printing as a bare name.
 */
const FLAG_HELP: Record<string, string> = {
  dir: "the data directory (default: $COUNTERPARTS_DATA_DIR, else ~/.counterparts/store)",
  observer: "stand down: read-only, and every owner operation refuses",
  help: "this page — it opens nothing and writes nothing",
  budget: "the injection ceiling, in bytes",
  name: "the owner's name; it seeds the identity core",
  embedder:
    "turn recall by meaning on — the local table that ships with the package, where nothing leaves this machine. It is on by default; this is how to turn it back on after --no-embedder",
  "no-embedder": "switch recall by meaning off: recall matches on words alone",
  force: "overwrite configuration this command already wrote once",
  kind: "self, person, entity, skill, place or fact",
  title: "a title for the memory, instead of one taken from its first line",
  salience: "0..1 — how much this one matters",
  id: "one memory, by id, instead of a question",
  full: "the whole facts answer, as the model reads it: a count header and every result's labeled lines (who said it, its status, when it happened and was learned, whether it still holds) — not just the top five, one line each",
  page: "which page of the answer (ten results a page; in meaning mode, eight entries of the arc), with --full or --json",
  mode: "facts (the default): every memory that answers the question, counted and paged — or meaning: what a person, a project or a feeling has been over time, the chapters that hold it in time order",
  // TWO COMMANDS, ONE SENTENCE (`recall --json` is the MCP tool's payload,
  // `doctor --json` is the findings): the table is keyed by flag NAME, so the
  // sentence has to be true of both.
  json: "machine-readable output — the structured payload rather than the console's rendering",
  voiced:
    "the question is already in the counterpart's own voice (the dashboard's rewrite): in meaning mode its \"I\" is the counterpart, so a question about feeling asks about the counterpart's feelings; a facts answer reads no feelings and is the same either way",
  out: "the directory to write into",
  passphrase: "encrypt the export with this secret",
  plaintext: "do not encrypt the export (said on purpose, never by default)",
  markdown:
    "export the readable markdown tree instead of the database file: memories, the journal, the self page, and a file per dream and per reflection (its README says what is where)",
  "include-confidential":
    "include confidential memories in the markdown tree, and the dreams and reflections that rest on one (they are omitted, and counted, by default)",
  // NOT `--versions`: `self-page` takes both `--versions` and `--version`, and
  // the help-page totality test reads flags as substrings — an `export
  // --versions` puts the string `--version` on export's page, where it names a
  // flag export does not take.
  "with-versions": "also write out every earlier wording of every memory (markdown only)",
  "into-non-empty": "write into a directory that already holds something",
  overwrite: "replace the files this export's own paths collide with (it says which); without it a collision is a refusal",
  confirm:
    "the scripted door: this exact id, no search and no picking, confirmed by typing the id back. Without it, a terminal asks and anything else prints the plan and changes nothing",
  // TWO COMMANDS, ONE SENTENCE, as `--json` already is: `remove --reason` is
  // recorded with the removal, `self-page --reason` with the version the write
  // produces. The table is keyed by flag NAME, so the sentence is true of both.
  reason: "the reason, recorded with the change it makes",
  "strike-by-content-across-scopes":
    "for a memory whose provenance records no project: chase its words through EVERY project's capture buffer (an exact jot, never a substring). Look at what the dry run lists first",
  "echo-scan":
    "how many episodes the journal-echo check reads before it stops and says so (default 2000)",
  rebuild: "drop and rebuild the cache instead of counting it",
  "drop-vectors": "let the rebuild lose vectors this console has no embedder to recompute",
  "prune-index": "take the archived and superseded rows out of the text index, keeping the embeddings",
  "keep-vectors": "rebuild the text index and leave every vector where it is",
  "retry-skipped":
    "put the ids the backfill gave up on back in the rotation: it clears every embed.failed counter and changes nothing else",
  apply: "actually do it — without this, it is a dry run",
  layout:
    "also print which directories the store keeps and which of them a backup carries",
  // TRUE OF EVERY COMMAND THAT TAKES IT, as the table requires: `mechanisms
  // --all` (and `fired --all`) prints the full report of every part, `doctor
  // --all` prints every line including the green ones a terminal folds away.
  all:
    "print every line in full, including the parts a store this new has had nothing to do with yet",
  config:
    "an absolute path to the host configuration, instead of ~/.counterparts/claude-code.json ($COUNTERPARTS_CONFIG says the same); install WRITES it there, rebrief reads it, ask and note read whether recall by meaning is on from it, and counterparts-hook and counterparts-mcp take the same flag (the server, the same variable)",
  batch: "rows per transaction while converting (default 500)",
  "dry-run": "say the default out loud: plan and print, change nothing",
  confidence: "high, medium or low — the weakest evidence --apply is allowed to write (default high)",
  "import-day": "YYYY-MM-DD — the day the import ran, instead of the one the store recorded or shows",
  sample: "how many proposed rows to print (default 20)",
  // TWO COMMANDS, ONE SENTENCE: `log --date` and `coverage --date` (2026-09-30).
  date: "YYYY-MM-DD — another day instead of today, in the store's zone (the log keeps 7 days; coverage reads what is still held)",
  // TRUE OF EVERY COMMAND THAT PRINTS IT, which is the point (review of #77:
  // the first version said "a command that writes still requires --dir", which
  // was false of `note` and of `migrate-cache` itself). `migrate-cache` is the
  // one command left with a `--yes`, and `--apply` there does require `--dir`.
  yes: "skip the typed confirmation, and nothing else — it never stands in for --dir, which --apply requires",
  // `self-page --write` reads the page here.
  stdin: "read it from standard input (the default whenever stdin is not a terminal)",
  write: "replace the page with what --file or --stdin gives, keeping every earlier version",
  restore: "put an earlier version back, by its seq — itself a new version, itself undoable",
  clear: "unwrite the page: it is kept as a version and the wake goes back to having none",
  "if-version": "only write if the page is still at this version (or 'none' if there was no page); otherwise refuse and change nothing",
  short: "a file holding the page's short version, read on a day the wake has no room for a page past its room; with --write alone, added to the page as it stands",
  file: "the file to read the page from",
  versions: "list the earlier versions, newest first",
  version: "print one earlier version in full, by its seq from --versions",
  on: "remember here: capture, deposit, wake and recall, as everywhere else",
  off: "nothing here: the hooks produce no output and write nothing, and the tools refuse",
  pause: "off for now, remembering what to go back to",
  resume: "undo a pause (or an off): back to what it was, or on",
  list: "print the whole registry, and the file it came from",
  note: "free text recorded beside the entry, for why",
  "no-connect":
    "do not touch the host at all: print the hooks block and the registration line, and change nothing of theirs — which is also what a pipe, a script and a CI job get",
  port: "the port to serve the dashboard on (default 4747, or $COUNTERPARTS_DASHBOARD_PORT)",
  "no-open": "do not open a browser — just print the address and serve it",
  park: "move the whole directory aside under a dated name — one rename, nothing copied, nothing deleted, and the store is never opened",
  "delete-memories":
    "destroy it. It counts what is about to go, says the number, and takes a typed phrase; there is no way to answer it from a script",
  "keep-memories":
    "keep your memory and do not ask: without it, at a terminal, uninstall asks whether to delete it too once Claude Code is disconnected (Enter keeps it)",
};

/**
 * THE SENTENCE `install` PRINTS FOR `--yes` INSTEAD OF THE SHARED ONE.
 *
 * The shared sentence is about a bulk write that requires the store to be
 * named, and `install` does no bulk write.
 *
 * SINCE 2026-09-22 IT ANSWERS ALMOST NOTHING, and the sentence says so rather
 * than promising a question it no longer skips: connecting Claude Code is what
 * `install` does at a terminal (item 9), so the yes it used to take has no
 * question left. It is kept because a scripted caller passes it, and because a
 * question added later should not find the flag missing.
 */
const INSTALL_FLAG_HELP: Record<string, string> = {
  host: "claude-desktop connects Claude Desktop's chat instead of Claude Code: the store and configuration as usual, then a counterparts entry merged into Desktop's claude_desktop_config.json (backed up first, other servers untouched). Quit Claude Desktop before running it: Desktop rewrites that file while it runs. claude-code, or no --host, is the ordinary install",
  yes: "kept so a scripted caller need not change, and it answers nothing this command asks: your name and a memory a parked uninstall set aside are questions only a person can answer, and moving somebody's data is never something a flag decides",
};

/**
 * THE SENTENCES THE THREE HOST-EDITING COMMANDS PRINT INSTEAD OF THE SHARED ONES.
 *
 * Three flags would print something false on these pages. `--yes`'s shared
 * sentence is about a bulk write that requires the store to be named, which is
 * not what any of these do; `--dry-run`'s says "say the default out loud", and
 * these commands are not dry by default; and `--dir` is REFUSED here rather
 * than merely unread, for `start-fresh`'s reason — what they act on is decided
 * by the configuration, and a second answer on the command line is how the
 * wrong host file or the wrong directory gets edited.
 */
const HOST_FLAG_HELP: Record<string, string> = {
  // `connect` and `disconnect` no longer declare this one — they do not ask.
  // `uninstall` does, and this is its sentence.
  yes: "do not ask: take the ordinary answer to every question this command would put (for uninstall's question about deleting your memory, that answer is keep)",
  json: "for uninstall: one JSON object instead of the screen. Alone it is the plan — what a delete would remove and leave, and whether it can go ahead now — and changes nothing; with --keep-memories it uninstalls. It never deletes: that is typed by a person, at a terminal",
  "nothing-is-open":
    "you are asserting you have closed every session, dashboard and worker. It is the way past a check that could NOT LOOK — no usable `ps` — and never past one that found something",
  "dry-run": "print what would change and change nothing (this command is NOT dry by default)",
  dir: "REFUSED on this command: what it acts on is decided by the configuration, not by a path on this line. Name the configuration instead, with --config",
};

/**
 * THE SENTENCES `scope` PRINTS INSTEAD OF THE SHARED ONES.
 *
 * Two flags mean something else on this command and nowhere else, so its help
 * page says something else about them rather than printing a line that is
 * false. `--observer` is the collision that forced this: it is a COMMON flag
 * meaning "stand this console down", and on `scope` it names one of the four
 * modes the owner asked for by name (G42). The command therefore does NOT read
 * it as a stance — `COUNTERPARTS_OBSERVER` still does, and still refuses every
 * write here — and this table is what keeps the page honest about it.
 */
const SCOPE_FLAG_HELP: Record<string, string> = {
  observer: "reads and recalls here, records nothing — the mode, not this console's stance",
  dir: "not consulted: this command writes host configuration, never a store",
  force: "overwrite a registry this could not parse (it prints what it could not read first)",
};

/**
 * THE SAME, FOR `start-fresh`, and for the same reason: two flags would print a
 * sentence that is false of this command.
 *
 * `--dry-run` says "say the default out loud" everywhere else, because the
 * commands that take it are dry by default. This one is not — it does the thing
 * — so the shared sentence would tell a reader that running it plain changes
 * nothing, which is the opposite of true. And `--dir` is REFUSED here rather
 * than merely unread: the store is the one the configuration names.
 */
const START_FRESH_FLAG_HELP: Record<string, string> = {
  undo: "put the parked store back: park the blank one, restore the parked one and its snapshots. One rename each, nothing deleted, nothing opened, and a destination that exists is a refusal",
  "nothing-is-open":
    "with --yes on a store that has something in it: you are asserting you have closed every session, dashboard and MCP server, because nothing here can check that",
  "dry-run": "print every rename and every file this would write, and change nothing (this command is NOT dry by default)",
  dir: "REFUSED on this command: the store parked is the one your configuration names, because that is the one the hooks and the MCP server open. Name the configuration instead, with --config",
  yes: "skip the typed confirmation, and nothing else — it never stands in for closing your sessions first",
  name: "the owner's name; it seeds the NEW store's identity core, exactly as 'install --name' does",
};

/**
 * THE SENTENCE `dashboard` PRINTS FOR `--dir` INSTEAD OF THE SHARED ONE.
 *
 * Everywhere else `--dir`'s default is `$COUNTERPARTS_DATA_DIR`, else
 * `~/.counterparts/store`. Here it is neither: the whole reason this command
 * exists beside `counterparts-dashboard serve` — which REFUSES an unnamed store
 * — is that the question "which store" already has an answer on this machine,
 * and it is the one the hooks and the memory tools open. Printing the shared
 * sentence would describe a resolution this command does not use.
 */
/** `dream`'s own four: `--list` and `--undo` mean something else on other pages. */
const DREAM_FLAG_HELP: Record<string, string> = {
  list: "the recent dreams, newest first — the default",
  all: "with --list: every dream the store holds, not only the newest 20",
  show: "one dream, by id: its journal and every change it made",
  undo: "reverse one dream's whole batch, by id (the id follows the flag); its journal is kept, marked undone",
  setting:
    "auto, ask or off — the nightly run (page writer, dream, reflection). ask (the default): the first session of a day shows you the question in the terminal and waits for you to say \"dream\" (or \"dream on your own\", which turns on auto); auto: the first session of a day starts it by itself, in a separate windowless claude -p in the background, and says so in one line; off: no dreams. `counterparts dream` prints the setting.",
};

/** `settle`'s own seven (2026-09-29): `--list` and `--undo` mean something else on other pages. */
const SETTLE_FLAG_HELP: Record<string, string> = {
  list: "what is unsettled, and what was settled lately — the default",
  pair: "the pair to settle, by its id (ctr_…), as the list shows it",
  holds: "the memory that holds now (changed, corrected); with --pair, one of its two",
  against: "without --pair: the memory it changes, corrects or disagrees with",
  how: "changed (both were true at their time: the older fades once, shown as earlier), corrected (the older was wrong: out of recall, readable by its id) or open (both kept, shown together)",
  why: "why, in a short line — kept on the pair's record",
  undo: "reverse one settle, by the pair's id (the id follows the flag): strength back, a corrected memory back in recall, the pair unsettled again",
};

/** `about`'s own one (2026-10-11): `--why` is settle's flag too, and means the same. */
const ABOUT_FLAG_HELP: Record<string, string> = {
  why: "why, in a short line — kept with the mark's record",
};

/** `core`'s own four. */
const CORE_FLAG_HELP: Record<string, string> = {
  list: "what the core holds, with lanes, nominations and demotions — the default",
  demote: "send one core memory back to ordinary fading from today, by id; needs --reason",
  reaffirm: "keep one core memory that is being reconsidered, by id; needs --reason. It is not flagged again for what it is",
  reason: "why — recorded with the demotion, and shown by --list",
  "reflected-feeling": "on or off — can a memory reach the core on reflection alone? On (the default): a feeling a reflection records later and a reflection citing a memory both count toward the fast lane, and a reflection may re-label what a memory is about either way — each re-label is recorded with its reason, and one into me, us or the owner is told in the next morning share. Off: nothing reaches the core on a reflection alone — the fast lane needs a feeling felt at the time (not one a reflection recorded later) and an ordinary use after a gap (not a reflection citing it), and a reflection may only move what a memory is about toward work or world.",
};

/** `claims-era`'s own two (2026-10-10): `--on` / `--off` mean something else under `scope`. */
const CLAIMS_ERA_FLAG_HELP: Record<string, string> = {
  on: "read old claims and defaults at today's default again, from the same cutoff as before",
  off: "read every claim as stored again (no claim was rewritten); a memory let go at the floor while it was on stays archived, readable by id",
};

/** `rollback`'s own (2026-10-11): it is not dry by default, and `--undo` and
 *  `--yes` mean something narrower here. */
const ROLLBACK_FLAG_HELP: Record<string, string> = {
  to: "the pre-migration copy to put back, by its name in the snapshots folder or an absolute path; the default is the newest one taken before the upgrade to the store's version",
  undo: "put the set-aside store back and remove the hold — only while nothing has written to the restored one",
  "upgrade-again": "remove the hold and let this version upgrade the store now, from a new pre-migration copy",
  "dry-run": "print what it would do and what would be lost, and change nothing (this command is NOT dry by default)",
  yes: "for a script or a pipe, where nothing can be typed; refused at a terminal, where you type the word instead",
  dir: "the store to roll back; without it, the one your configuration names",
};

/** `catch-up`'s own (2026-10-11): `--dry-run` and `--yes` belong to `--reowe`. */
const CATCH_UP_FLAG_HELP: Record<string, string> = {
  reowe:
    "a run's id (cup_… or nrn_…): owe again the parts it closed with nothing kept while their words were not yet written up — the plan first, then the id typed back. It reads the run from the log, which keeps a week",
  "dry-run": "with --reowe: print the plan and change nothing",
  yes: "with --reowe: skip typing the run's id back, for a script or a pipe",
};

const DELETE_FLAG_HELP: Record<string, string> = {
  yes: "delete without asking — for a script or a pipe, which otherwise get the counts and nothing changed",
};

const DASHBOARD_FLAG_HELP: Record<string, string> = {
  dir: "a store to look at instead of the one your configuration names",
};

/**
 * One command's own help page: what it is, how it is invoked, and every flag it
 * takes with a sentence each.
 *
 * The gap this closes (cold-stranger review, 2026-09-04, #9): `counterparts
 * <command> --help` printed the whole console's usage, so the flags a command
 * actually takes were listed nowhere a person could ask for them — the only
 * surface that knew was the refusal you got AFTER typing one wrong. The table
 * that refusal reads is the table this page prints.
 */
export function commandHelp(command: Command): string {
  const own = COMMAND_FLAGS[command] ?? [];
  // A command may say something else about a flag it means something else by.
  // `scope` is two flags — `--observer` (the mode, not the stance) and `--dir`
  // (not consulted at all) — and `start-fresh` is three, of which `--dry-run` is
  // the one that matters: everywhere else it names the DEFAULT, and here it does
  // not. A page that printed the shared sentence would be printing something
  // false.
  const override =
    command === "scope"
      ? SCOPE_FLAG_HELP
      : command === "start-fresh"
        ? START_FRESH_FLAG_HELP
        : command === "rollback"
          ? ROLLBACK_FLAG_HELP
        : command === "install"
          ? INSTALL_FLAG_HELP
          : command === "dashboard"
            ? DASHBOARD_FLAG_HELP
          : command === "catch-up"
            ? CATCH_UP_FLAG_HELP
            : command === "connect" || command === "disconnect" || command === "uninstall"
              ? HOST_FLAG_HELP
              : command === "dream"
                ? DREAM_FLAG_HELP
                : command === "core"
                  ? CORE_FLAG_HELP
                  : command === "claims-era"
                    ? CLAIMS_ERA_FLAG_HELP
                  : command === "settle"
                    ? SETTLE_FLAG_HELP
                    : command === "about"
                      ? ABOUT_FLAG_HELP
                      : command === "delete"
                        ? DELETE_FLAG_HELP
                        : {};
  const flagLine = (name: string): string => {
    const shown = `--${name}${VALUED_FLAGS.includes(name) ? " <value>" : ""}`;
    return `  ${shown.padEnd(20)} ${override[name] ?? FLAG_HELP[name] ?? "(undocumented)"}`;
  };
  // WHAT THE OLD 129-LINE `usage()` SAID ABOUT THIS COMMAND and no blurb or
  // flag sentence does (2026-09-21, new-user finding 4). Moved rather than
  // rewritten, and pre-wrapped in `help.ts`: this page is where that detail
  // lives now, so the short map can be short without anything being lost.
  const detail = COMMAND_DETAIL[command] ?? [];
  return [
    `counterparts ${command} — ${COMMAND_BLURB[command]}`,
    "",
    // THE INVOCATION LINE DOES NOT OFFER A FLAG THE COMMAND REFUSES. Every
    // other command takes `--dir`; `start-fresh` turns it away in words (the
    // store is the one the configuration names), and `help` opens nothing at
    // all — a usage line that showed it would be teaching the thing the refusal
    // exists to prevent (`NO_DIR_IN_SYNOPSIS`).
    `  counterparts ${command}${COMMAND_ARGS[command] ?? ""}${own.length === 0 ? "" : " [flags]"}${
      NO_DIR_IN_SYNOPSIS.includes(command) ? "" : " [--dir <path>]"
    }`,
    ...(detail.length === 0 ? [] : ["", ...detail]),
    "",
    ...(own.length === 0
      ? ["This command takes no flags of its own."]
      : [`Flags for ${command}:`, ...own.map(flagLine)]),
    "",
    "Options every command takes:",
    ...COMMON_FLAGS.map(flagLine),
    "",
    ...CONSOLE_FOOTER,
  ].join("\n");
}

/** Flags whose value is a string; anything else here is a boolean switch. */
const VALUED_FLAGS: readonly string[] = [
  "dir",
  "reowe",
  "config",
  "port",
  "out",
  "reason",
  "passphrase",
  "name",
  "kind",
  "title",
  "salience",
  "id",
  "budget",
  "batch",
  "confidence",
  "import-day",
  "sample",
  "note",
  "file",
  "version",
  "restore",
  "if-version",
  "mode",
  "show",
  "demote",
  "pair",
  "holds",
  "against",
  "how",
  "why",
  "date",
  "host",
  "to",
];

/** Levenshtein, small and local. Only ever used to say "did you mean". */
function editDistance(a: string, b: string): number {
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i += 1) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min((row[j - 1] ?? 0) + 1, (rows[i - 1]?.[j] ?? 0) + 1, (rows[i - 1]?.[j - 1] ?? 0) + cost));
    }
    rows.push(row);
  }
  return rows[a.length]?.[b.length] ?? Math.max(a.length, b.length);
}

/**
 * The refusal sentence for `argv` under `command`, or null when every flag is
 * one this command declares and every valued flag was given a value.
 *
 * Pure over its arguments and exported, so the test can walk every command
 * without a store, a console or a process.
 */
export function unknownFlag(command: Command, argv: readonly string[]): string | null {
  const allowed = [...COMMON_FLAGS, ...(COMMAND_FLAGS[command] ?? [])];
  for (const token of argv) {
    if (!token.startsWith("--") || token === "--") continue;
    const [rawName, inline] = token.slice(2).split("=", 2);
    const name = rawName ?? "";
    if (name.length === 0) continue;
    if (!allowed.includes(name)) {
      // Nearest declared flag, but only when it is actually near: a suggestion
      // pulled from across the alphabet is worse than no suggestion.
      const near = allowed
        .map((f) => ({ f, d: editDistance(name, f) }))
        .filter((x) => x.d <= Math.max(2, Math.floor(x.f.length / 3)))
        .sort((a, b) => a.d - b.d)[0];
      return (
        `unknown flag --${name}` +
        (near === undefined ? "" : `; did you mean --${near.f}?`) +
        `\n  '${command}' takes: ${allowed.map((f) => `--${f}`).join(" ")}` +
        "\n  Nothing was opened and nothing was written."
      );
    }
    if (VALUED_FLAGS.includes(name) && inline === undefined) {
      const next = argv[argv.indexOf(token) + 1];
      if (next === undefined || next.startsWith("--")) {
        return (
          `--${name} needs a value, and none followed it.` +
          "\n  Nothing was opened and nothing was written."
        );
      }
    }
  }
  return null;
}

export async function run(argv: readonly string[], opts: RunOptions): Promise<number> {
  const { io } = opts;
  const env = opts.env ?? process.env;
  const now = opts.now ?? ((): number => Date.now());
  const parsed = parse(argv);

  // `--help` is an ANSWERED question, whatever else is on the line: exit 0.
  // Bare `counterparts` is an invocation that named nothing, and stays a usage
  // error. The two used to share the failing code, so the second command a
  // stranger runs set `$?` to 1 and any `set -e` script died on the help text
  // (cold-stranger review, §6.10).
  if (parsed.flags["help"] === true) {
    // A COMMAND NAMED BESIDE `--help` IS A QUESTION ABOUT THAT COMMAND.
    // `counterparts note --help` used to print the whole console's usage, which
    // answers a different question than the one asked and lists none of the
    // flags `note` takes. Bare `--help` still prints the console's usage.
    const named = parsed.command;
    if (named !== undefined && (COMMANDS as readonly string[]).includes(named)) {
      io.out(commandHelp(named as Command));
      return EXIT.ok;
    }
    io.out(usage());
    return EXIT.ok;
  }
  // `counterparts --version`, THE FLAG. The verb (`counterparts version`) is a
  // command like any other and is dispatched below, after the flag check, so a
  // typo on its line is refused like every other typo. The FLAG cannot wait for
  // that: `--version` is not a common flag, so on any command line that names a
  // command it is correctly refused as unknown — and on a line that names none,
  // `parsed.command` is undefined and the bare-console arm below would answer a
  // question nobody asked.
  //
  // `self-page --version <seq>` is untouched: that one carries a value, so it
  // parses as a STRING, and this reads only the boolean `strict: false` produces
  // for a valued flag with nothing after it.
  if (parsed.command === undefined && parsed.flags["version"] === true) {
    io.out(versionLine());
    return EXIT.ok;
  }
  if (parsed.command === undefined) {
    return await bareConsole(io, env, opts);
  }
  if (!(COMMANDS as readonly string[]).includes(parsed.command)) {
    io.err(`unknown command: ${parsed.command}`);
    io.out(usage());
    return EXIT.usage;
  }
  const command = parsed.command as Command;

  // FIRST, before the stance, before the data dir, before any store: a flag
  // this command does not take is a command line that does not mean what it
  // says, and the store it would have written to is the one nobody named.
  const badFlag = unknownFlag(command, argv);
  if (badFlag !== null) {
    for (const line of `refused: ${badFlag}`.split("\n")) io.err(line);
    return EXIT.refused;
  }

  // `counterparts help [<command>]` — the same two pages `--help` reaches,
  // reachable as a VERB, because `counterparts help doctor` is what a person
  // types (2026-09-21, new-user finding 4).
  //
  // HERE, and not further down: this command opens no store and reads no
  // configuration, so it must not pass through the stance reading or the
  // explicit-dir guard — a shell with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`
  // armed would otherwise refuse to tell somebody what the commands are. And
  // after `unknownFlag`, so `counterparts help --dirr` is refused like every
  // other typo rather than silently ignored.
  //
  // `version` is here for exactly the same reason, one line long: it reads
  // `package.json` and nothing else, and a shell with the guard armed must not
  // be refused when it asks which version is installed.
  if (command === "version") {
    io.out(versionLine());
    return EXIT.ok;
  }

  if (command === "help") {
    const asked = parsed.positional[0];
    if (asked === undefined) {
      io.out(usage());
      return EXIT.ok;
    }
    // THE SECOND PAGE, and it is not a command: `advanced` names a SHELF. It is
    // checked before the command lookup so that a command called `advanced`
    // could never be added without this line being read (2026-09-22, item 2).
    if (asked === "advanced") {
      io.out(advancedHelp());
      return EXIT.ok;
    }
    if ((COMMANDS as readonly string[]).includes(asked)) {
      io.out(commandHelp(asked as Command));
      return EXIT.ok;
    }
    // ONE LINE, then the map — the same shape an unknown command gets above,
    // because it is the same mistake and the reader needs the same list.
    io.err(`no such command: ${asked}`);
    io.out(usage());
    return EXIT.usage;
  }

  // THE STANCE VARIABLE IS READ THE WAY THE GUARD NEXT DOOR IS READ (G39).
  // This used to match `"1"` and `"true"` exactly, untrimmed, while
  // `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` — documented one directory over as the
  // set to reason from — took `1|true|on` trimmed and case-insensitive. So
  // `COUNTERPARTS_OBSERVER=on` looked like an instrument and was an owner
  // console. `adapters/stance-env.ts` is now the one reading, and it collapses
  // a value it cannot read to OBSERVER: `docs/observer-mode.md` G5, fail toward
  // standing down. On this surface that is the cheap direction — a stood-down
  // console still runs every read, and says which stance refused what.
  //
  // ONE COMMAND EXCEPTED, and it is the only exception this console has:
  // `scope --observer` names the MODE to put a directory in (the owner asked
  // for those four words by name, G42), not a stance to put this console in.
  // The two meanings cannot share one flag on one command line, so on `scope`
  // the stance comes from `COUNTERPARTS_OBSERVER` alone — which still refuses
  // every write the command makes, exactly as it refuses an owner op.
  const observerReading = observerFromEnv(
    env,
    parsed.flags["observer"] === true && command !== "scope",
  );
  const observer = observerReading.on;
  if (observerReading.malformed !== null) {
    io.err(
      unreadableStanceLine(OBSERVER_ENV, observerReading.malformed, "standing down to observer stance"),
    );
  }
  if (observer && OWNER_OPS.includes(command)) {
    // Distinguishable, not silent (scar §2.4): the console says which stance
    // refused and which command it refused, so a stood-down run is legible.
    io.err(
      `refused: '${command}' is an owner operation and this console is in observer stance. An instrument reads; it does not change the store.`,
    );
    return EXIT.refused;
  }

  // WHICH HOST CONFIGURATION THIS INVOCATION MEANS — resolved once, by the same
  // rule the hook, the worker and the MCP server use (`adapters/config-path.ts`),
  // and refused rather than guessed.
  //
  // ONLY for the two commands that read or write one. `note`, `recall`, `status`
  // and the rest touch no configuration at all, and a stale
  // `COUNTERPARTS_CONFIG` in somebody's shell must not refuse a command that
  // would never have looked at it — a guard that fires on the innocent case is
  // one people learn to unset rather than to read. (`ask` reads one knob from a
  // configuration since 2026-09-24 — whether recall by meaning is on — and so
  // resolves it LENIENTLY, in `askEmbedder`, never refusing on its account.)
  const readsConfig =
    command === "install" ||
    // The three host-editing verbs read one to learn which store to name in the
    // registration, whether the hooks have to carry `--config`, and — for
    // `uninstall` — which directory is this install's at all.
    command === "connect" ||
    command === "disconnect" ||
    command === "uninstall" ||
    // `dashboard` reads one for the same reason `doctor` does: the store worth
    // looking at is the one the hooks and the memory tools open.
    command === "dashboard" ||
    // `catch-up` reads one for the store the hooks open, and hands the same
    // file to its child's memory server.
    command === "catch-up" ||
    // `start-fresh` READS one to learn which store the hooks open, and then
    // hands the same choice to `install` so the blank store lands where the
    // file already points.
    command === "start-fresh" ||
    // `rollback` reads one for the store when no `--dir` names it, and for
    // `snapshots.dir`, where the upgrade put its copy.
    command === "rollback" ||
    command === "rebrief" ||
    // `doctor` REPORTS on a host configuration, so it resolves it by the same
    // rule as the other two.
    command === "doctor" ||
    // `scope` writes the registry that sits BESIDE the configuration, so the
    // flag that names one names the other.
    command === "scope";
  const named = readsConfig
    ? resolveConfigPath(
        typeof parsed.flags["config"] === "string" ? [`--config=${parsed.flags["config"]}`] : [],
        env,
        opts.home ?? homedir(),
      )
    : undefined;
  if (named !== undefined && named.refusal !== null) {
    io.err(named.refusal);
    return EXIT.refused;
  }

  // `install` resolves its OWN layout and must not go through `resolveDir`:
  // the store's default data dir is `~/.counterparts`, which is exactly the
  // directory this command writes two unclassifiable files into (`install.ts`
  // rule 1). Its default store is the `store/` beneath that instead.
  //
  // Which is why the explicit-dir guard has to be applied HERE by hand: the
  // layout builds `~/.counterparts` from `homedir()` and never calls `dataDir()`,
  // so `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` would otherwise leave `install` free
  // to write the live base — config and store — from a shell the
  // guard was armed in. An unnamed configuration is refused; `--config
  // <elsewhere>` moves the whole base and is the way through.
  if (command === "install") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    // THE SINGLE BINARY makes the store and the configuration — the plugin's
    // first run is exactly `install --no-connect` — and wires nothing: no
    // conversation that ends in `connect`, no Desktop entry, no printed hooks
    // block naming a file the plugin's uninstall will delete.
    const binary = opts.binary === undefined ? BINARY : opts.binary;
    if (binary !== null) {
      const hostAsked = parsed.flags["host"];
      if (hostAsked !== undefined && hostAsked !== "claude-code") {
        io.err(BINARY_CONNECT_REFUSAL);
        return EXIT.refused;
      }
      try {
        const code = installCommand(parsed, io, env, opts.home, named, { hostSteps: false });
        if (code === EXIT.ok) {
          io.out("");
          io.out("Claude Code runs this memory through the Counterparts plugin, so there is nothing to connect.");
        }
        return code;
      } catch (err) {
        io.err(`install failed: ${describeDirRefusal(err)}`);
        return EXIT.failed;
      }
    }
    // `--host claude-desktop` (2026-09-30): the store and the configuration as
    // any install makes them, then Claude Desktop's config entry instead of
    // Claude Code's hooks. No `--host`, or `--host claude-code`, is the install
    // below, untouched.
    const hostFlag = parsed.flags["host"];
    if (hostFlag !== undefined && hostFlag !== "claude-code") {
      if (hostFlag !== DESKTOP_HOST) {
        io.err(`--host takes claude-code or ${DESKTOP_HOST}; got ${JSON.stringify(hostFlag)}.`);
        return EXIT.usage;
      }
      try {
        return installDesktop(parsed, io, env, opts.home, named, now);
      } catch (err) {
        io.err(`install failed: ${describeDirRefusal(err)}`);
        return EXIT.failed;
      }
    }
    try {
      // A PERSON AT A TERMINAL GETS A CONVERSATION; EVERYTHING ELSE GETS
      // TODAY'S BYTES. `isInteractive` is false for a pipe, a CI job, the
      // install loop and every test console, so the scripted path — which is
      // every path this package has ever been measured on — is untouched.
      // `--no-connect` opts a terminal out of it too and prints the blocks.
      const interactive = isInteractive(io, env, {
        nonInteractive: parsed.flags["no-connect"] === true,
      });
      return interactive
        ? await installInteractive(parsed, io, env, opts, named, now)
        : installCommand(parsed, io, env, opts.home, named);
    } catch (err) {
      io.err(`install failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }

  // THE HOST'S OWN FILES, decided here beside `install` for the same reason
  // `start-fresh` is: what they act on comes from the CONFIGURATION, never from
  // a `--dir`, so they must not go through the generic data-dir block below.
  //
  // The explicit-dir guard applies by hand, exactly as it does to `install`:
  // the default configuration names the live store and the live base, and
  // `uninstall --park` renames the directory that file sits in.
  if (command === "connect" && (opts.binary === undefined ? BINARY : opts.binary) !== null) {
    io.err(BINARY_CONNECT_REFUSAL);
    return EXIT.refused;
  }
  if (command === "connect" || command === "disconnect" || command === "uninstall") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await hostWiringCommand(command, parsed, io, env, opts, named, now);
    } catch (err) {
      if (isPromptAborted(err)) {
        io.err("");
        io.err("stopped; nothing else was changed.");
        return EXIT.refused;
      }
      io.err(`${command} failed: ${String((err as Error).message ?? err)}`);
      // NOT "nothing was changed": a throw can land after the settings file has
      // been written, and a sentence that is false in the one case somebody is
      // reading it is worse than no sentence. What IS true is where to look.
      io.err(
        "Anything already done is named above, the backup path included. " +
          `'${BIN.cli} doctor' says what the host reads now.`,
      );
      return EXIT.failed;
    }
  }

  // `start-fresh` resolves its store from the CONFIGURATION, exactly as `doctor`
  // does and for the same reason: the store that matters is the one the hooks
  // and the MCP server open. So it is decided here, beside `install`, rather
  // than through the generic `--dir` block — which it refuses outright.
  //
  // The explicit-dir guard applies by hand for the same reason it does to
  // `install`: the default configuration NAMES the live store, and a command
  // that parks a store must never reach one nobody named.
  if (command === "start-fresh") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await startFreshCommand(parsed, io, env, opts.home, named, now);
    } catch (err) {
      io.err(`start-fresh failed: ${String((err as Error).message ?? err)}`);
      return EXIT.failed;
    }
  }

  // `scope` is decided BEFORE the data dir, like `install`,
  // and for a stronger version of the same reason: it never opens a store at
  // all. Resolving one would make a command about the HOST's configuration
  // refuse under `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` for want of a store it does
  // not use — and would put `~/.counterparts` under a command that must be
  // runnable on a machine that has no store yet. The guard still applies to the
  // thing this command DOES touch: an unnamed configuration is refused, because
  // the default one sits in the live base.
  if (command === "scope") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return scopeCommand(parsed, io, observer, named, now);
    } catch (err) {
      io.err(`scope failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }

  // `doctor` resolves its store differently from every other command, and the
  // difference is the whole point: it reads the store the CONFIG names, because
  // that is the one the hooks open. A doctor that only ever read
  // `COUNTERPARTS_DATA_DIR` would have declared the temp store healthy through
  // all of I29. So it is handled here, after the configuration is resolved and
  // before the generic `--dir` block.
  //
  // WHICH IS EXACTLY WHY THE EXPLICIT-DIR GUARD APPLIES TO IT HERE, in the same
  // three lines `install` uses. The first round of this PR left
  // this branch out and the reviewer reproduced the consequence on the owner's
  // own machine: `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 counterparts doctor`
  // resolved the DEFAULT configuration, read its `dataDir` — the live store —
  // and printed its paths, in a shell armed precisely so that nothing nobody
  // named would open. A read is not exempt: the guard is about which store gets
  // touched at all, not about who writes to it.
  if (command === "doctor") {
    // `--dir` IS A NAME (2026-09-20, finding 6). The guard exists so nothing
    // nobody named gets opened, and `--dir <store>` names one — so the refusal
    // was about the CONFIGURATION the reading would have read beside it — the
    // owner's live one. `doctorCommand` now
    // declines to read that file at all in this case and grades the store on
    // its own; the Config line says which questions therefore went unasked, and
    // what to type to ask them. On cut-over day this is the difference between
    // "point doctor at the parked store" and a refusal with nothing to do.
    const named_ = typeof parsed.flags["dir"] === "string" ? undefined : named;
    const implicit = named_ === undefined ? null : implicitConfigRefusal(named_, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return doctorCommand(parsed, io, env, named, opts.checkout, opts.home);
    } catch (err) {
      io.err(`doctor failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }

  // `rollback` resolves its store as `doctor` does: `--dir` names it, and
  // without one the configuration's `dataDir` is the store the hooks open. The
  // explicit-dir guard applies to an unnamed configuration, as it does there.
  if (command === "rollback") {
    const named_ = typeof parsed.flags["dir"] === "string" ? undefined : named;
    const implicit = named_ === undefined ? null : implicitConfigRefusal(named_, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await rollbackCommand(parsed, io, env, opts, named, now);
    } catch (err) {
      io.err(`rollback failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }

  // `catch-up` resolves its store as `dashboard` does: `--dir` names one, and
  // without it the configuration's `dataDir` — the store the hooks open, whose
  // owed sessions are the ones to write up. The explicit-dir guard applies.
  if (command === "catch-up") {
    const named_ = typeof parsed.flags["dir"] === "string" ? undefined : named;
    const implicit = named_ === undefined ? null : implicitConfigRefusal(named_, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await catchUpEntry(parsed, io, env, opts, named, now);
    } catch (err) {
      io.err(`catch-up failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }

  // `dashboard` resolves its store exactly as `doctor` does, and for the same
  // reason: the store worth looking at is the one the hooks and the memory tools
  // open, and a person who has just been told "open the dashboard in your
  // browser" should not have to learn `--dir` to do it (2026-09-22, item 4).
  //
  // `--dir` IS A NAME, so the same sentence `doctor` carries applies here: when
  // one is given, the configuration beside it is not consulted and the guard has
  // nothing to refuse.
  if (command === "dashboard") {
    const named_ = typeof parsed.flags["dir"] === "string" ? undefined : named;
    const implicit = named_ === undefined ? null : implicitConfigRefusal(named_, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await dashboardCommand(parsed, io, env, opts, named);
    } catch (err) {
      io.err(`dashboard failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }

  let dir: string;
  try {
    dir = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : resolveDir(env);
  } catch (err) {
    io.err(describeDirRefusal(err));
    return EXIT.refused;
  }

  // The console reports; it does not crash. A stack trace on the owner's
  // terminal is the least legible failure this program can produce
  // (constitution 16), and the failure that reached the field was exactly an
  // uncaught open — "database is locked" from a store another process was
  // writing (live-verify 2026-08-25). Each command still handles what it can
  // handle; this is the floor under all of them.
  try {
    switch (command) {
      case "status":
        return statusCommand(
          dir,
          io,
          typeof parsed.flags["dir"] === "string",
          // The person's day, in the zone the config beside this store names,
          // else this machine's (docs/time.md; UTC before 2026-09-25).
          localDate(now(), zoneBeside(dir)),
          parsed.flags["layout"] === true,
          env,
        );
      case "init":
        return initCommand(dir, io, opts.home, typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined);
      case "note":
        return await noteCommand(dir, io, parsed, env, opts.home ?? homedir(), opts.scope);
      // ONE COMMAND, TWO NAMES — the same function, not a forwarding shim, so
      // there is no arm where one spelling can behave differently from the other.
      case "ask":
      case "recall":
        return await recallCommand(dir, io, parsed, env, opts.home ?? homedir());
      case "verify":
        return verifyCommand(dir, io, parsed.flags);
      case "migrate-cache":
        // Whether the STORE WAS NAMED is the command's own question now, asked
        // by one shared door (`requireDirFlagForBulkWrite`) rather than by each
        // writing command in its own words. This site used to compute it, and
        // counted `COUNTERPARTS_DATA_DIR` where `repair-dates` did not.
        return await migrateCacheCommand(dir, io, parsed.flags);
      case "backup":
        return await backupCommand(dir, io, parsed.flags["out"], now);
      case "export":
        return exportCommand(dir, io, parsed.flags, observer);
      case "remove":
        // EVERY positional, not just the first: since 2026-09-22 what follows
        // `remove` may be words to search for, and `counterparts remove culvert
        // gate key` is three of them. `env` rides along because the door test is
        // `isInteractive`, which reads `CI` out of it.
        return await removeCommand(dir, io, env, parsed.positional, parsed.flags, now);
      case "delete":
        return await deleteCommand(dir, io, env, parsed.positional, parsed.flags);
      case "backfill-claims":
        return backfillClaimsCommand(dir, io, parsed.flags);
      case "repair-dates":
        return repairDatesCommand(dir, io, parsed.flags);
      case "repair-merged-beliefs":
        return repairMergedBeliefsCommand(dir, io, parsed.flags);
      case "rebrief":
        return rebriefCommand(dir, io, parsed.flags["budget"], now, opts.home, named);
      case "probe-oq4":
        return probeCommand(dir, io, typeof parsed.flags["dir"] === "string");
      case "mechanisms":
      case "fired":
        return firedCommand(
          dir,
          io,
          typeof parsed.flags["dir"] === "string",
          now,
          parsed.flags["all"] === true,
        );
      case "log":
        return await logCommand(dir, io, parsed.flags["date"], now);
      case "self-page":
        return await selfPageCommand(
          dir,
          io,
          parsed,
          observer,
          typeof parsed.flags["dir"] === "string",
          opts.stdin,
        );
      case "dream":
        return dreamCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string");
      case "core":
        return coreCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string");
      case "claims-era":
        return claimsEraCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string");
      case "settle":
        return settleCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string");
      case "about":
        return aboutCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string");
      case "coverage":
        return coverageCommand(dir, io, parsed, now, typeof parsed.flags["dir"] === "string");
    }
  } catch (err) {
    io.err(upgradePending(err) ?? `${command} failed: ${describeDirRefusal(err)}`);
    return EXIT.failed;
  }
}

// ── repair-merged-beliefs ───────────────────────────────────────────────────

/** How much of a statement a repair report prints. */
const STATEMENT_PREVIEW = 60;

/** How far back the merge log is read. `eventLog`'s own default is 500. */
const MERGE_LOG_CEILING = 100_000;

interface MergedBelief {
  readonly id: string;
  /** The entity the element hangs off, and its name when the entity is readable. */
  readonly entityId: string | null;
  readonly entityName: string | null;
  /** First 60 characters of the statement, on one line. */
  readonly statement: string;
  /** The memory it was merged into, from the durable merge record. */
  readonly originalId: string | null;
  readonly originalPreview: string | null;
  /** The lived day the merge was recorded on. */
  readonly mergedOnDay: number | null;
  /** True when the row is archived right now (false = already repaired). */
  readonly archived: boolean;
}

/**
 * THE REPAIR FOR PROBE H — beliefs the nightly dedup pass ate.
 *
 * The bug (`sleep/NOTES.md` §12, fixed the same night): a `type: "schema"` row
 * was an ordinary dedup candidate. An element whose statement is X and an
 * ordinary memory whose body is X — no revision anywhere — formed a same-hash
 * group, `mem_` sorted before `sch_` in the tie-break, and the ELEMENT was
 * archived `merged`. `beliefs(entity)` then read empty: the store had stopped
 * believing something nobody retracted. On a migrated store the DIRECTION of
 * that loss is certain — `tools/migrate/apply.ts` minted every element at the
 * import day while migrated memories kept their v1 birth day, so the memory is
 * never younger and the element always loses — and the COUNT is unknown, since
 * a collision needs two distinct v1 items whose gated text is byte-identical.
 * This command is the thing that measures it.
 *
 * Stopping the bug does not undo it. This finds what it already took and puts
 * it back, through the owner-op seam's `unarchiveMerged` — the one door that
 * un-archives, and only for `archived_reason: "merged"`.
 *
 * Two sources are unioned, because either can be the surviving evidence: the
 * `memory.merged` events whose `candidateId` is a `sch_` id (the owner's
 * read-only check, and the one that still reads true after the retention window
 * trims nothing), and the archived schema rows whose reason is the merge (which
 * survives even if the event log has rolled). Ids the owner removed are skipped
 * — the deny-list answers before this tool does.
 *
 * **What it prints, and the tension in printing it.** `backfill-claims` says
 * "IDS AND NUMBERS ONLY — a repair report is not a place to print bodies", and
 * this one prints TWO things that are not ids: the first 60 characters of each
 * statement, and the ENTITY'S NAME. A person's name is author content as
 * squarely as a statement is, and both are the same deliberate deviation. The
 * difference is what the owner has to decide: a claim restored to the store is
 * a claim the system will state in a briefing, and "restore sch_198628843ffb?"
 * is not a question anyone can answer — nor is it answerable without knowing
 * whose belief it is. This runs on the owner's own terminal, on the owner's own
 * store, at the owner's own keystroke — the same reader who could open the
 * prose file. **The durable record stays ids and numbers only**
 * (`memory.unmerged` carries no text at all, §5 G10): the deviation is
 * console-only. Recorded rather than assumed (see `cli/NOTES.md`).
 *
 * **What it does not touch: the `uses` the merge credited.** The original kept
 * `+1` and keeps it. Taking it back would rewrite a physics count whose band
 * may already have been materialized and whose crossing may already be a
 * durable `band.transition` row, to undo one use. The number is written into
 * the `memory.unmerged` record instead, so the credit is auditable rather than
 * silently reversed — and the merge record itself is left exactly where it is
 * (constitution 7: the history is the point).
 */
function repairMergedBeliefsCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): number {
  const apply = flags["apply"] === true;
  // UN-ARCHIVES ROWS IN BULK, and it too had no door before 2026-09-05.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "repair-merged-beliefs --apply",
      "un-archives every belief and current-state row the dedup pass took",
    );
    if (refusal !== null) return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }

  // The plan is made read-only, as every plan here is (scar E5).
  const planning = openStoreAt({ dir, observer: true });
  let targets: MergedBelief[];
  try {
    targets = mergedBeliefs(planning);
  } finally {
    planning.close();
  }

  const open = targets.filter((t) => t.archived);
  // WHICH STORE. `--dir` is optional and the default resolves to the owner's
  // live memory, and this is a command whose next step is `--apply`: a repair
  // that did not say what it was about to repair is the 2026-09-04 `--dirr`
  // lesson pointed at the owner's own hands. `status`, `note` and `recall`
  // print this line; `backfill-claims` does not, and should.
  io.out(`Store: ${dir}`);
  io.out(`Beliefs and current-state rows archived as duplicates: ${open.length}`);
  if (targets.length > open.length) {
    io.out(`Already restored (a merge record with a live row): ${targets.length - open.length}`);
  }
  for (const t of targets) {
    const where = t.entityName === null ? (t.entityId ?? "no entity") : t.entityName;
    const day = t.mergedOnDay === null ? "day unrecorded" : `lived day ${t.mergedOnDay}`;
    io.out(`  ${t.id}  ${where}  ${day}${t.archived ? "" : "  [already live]"}`);
    io.out(`    "${t.statement}"`);
    io.out(
      t.originalId === null
        ? "    merged into an original the log no longer names"
        : `    merged into ${t.originalId}${t.originalPreview === null ? "" : `  "${t.originalPreview}"`}`,
    );
  }

  if (!apply) {
    io.out("");
    io.out(
      open.length === 0
        ? "Dry run. Nothing to repair on this store."
        : "Dry run. Nothing has changed. Re-run with --apply to put these back.",
    );
    return EXIT.ok;
  }
  if (open.length === 0) {
    io.out("");
    io.out("Nothing to do.");
    return EXIT.ok;
  }

  const store = openStoreAt({ dir });
  let restored = 0;
  const failures: string[] = [];
  try {
    // RE-CHECK under the writing store: the plan was made against a store that
    // may have moved, and the seam refuses anything that is no longer a merge.
    for (const target of mergedBeliefs(store)) {
      if (!target.archived) continue;
      try {
        const report = unarchiveMerged(store, target.id);
        if (!report.noop) restored += 1;
      } catch (err) {
        failures.push(`${target.id}: ${describeDirRefusal(err)}`);
      }
    }
  } finally {
    store.close();
  }

  io.out("");
  io.out(`Put ${restored} elements back. The uses each merge credited stand, and are recorded.`);
  for (const failure of failures) io.err(`  FAILED ${failure}`);
  return failures.length === 0 ? EXIT.ok : EXIT.failed;
}

/** Archived schema rows the merge took, and the merge records that name them. */
function mergedBeliefs(store: Store): MergedBelief[] {
  const denied = new Set(store.deniedIds());
  const ids = new Set<string>();
  const schemaPrefix = `${ID_PREFIX["schema"]}_`;
  for (const id of store.list({ type: "schema", archived: true })) {
    const row = store.row(id);
    if (row === undefined || denied.has(id)) continue;
    if (row.archived_reason === MERGED_ARCHIVE_REASON) ids.add(id);
  }
  // `eventLog` defaults to 500 rows; a store with more merges than that would
  // silently shorten this list, so the ceiling is named rather than inherited.
  // The ARCHIVED rows above are found by `list`, which has no cap — this pass
  // adds the ones already restored, and the reason it exists at all is that a
  // merge record can outlive the archive it describes.
  for (const event of store.eventLog({ name: "memory.merged", limit: MERGE_LOG_CEILING })) {
    if (event.ref === null || !event.ref.startsWith(schemaPrefix) || denied.has(event.ref)) continue;
    const row = store.row(event.ref);
    if (row === undefined) continue;
    // ARCHIVED FOR A DIFFERENT REASON IS NOT THIS TOOL'S BUSINESS. A belief
    // restored last month and legitimately revised since is archived `revised`
    // with a successor; listing it as an open target would make the next
    // `--apply` refuse it with `UNMERGE_SUPERSEDED` and exit FAILED on a store
    // where nothing is wrong.
    if (row.archived === 1 && row.archived_reason !== MERGED_ARCHIVE_REASON) continue;
    ids.add(event.ref);
  }

  const out: MergedBelief[] = [];
  for (const id of [...ids].sort()) {
    const row = store.row(id);
    if (row === undefined) continue;
    // A WALKING read, the way `schemas/index.ts#load` reads it: the store's
    // archived-read telemetry answers "did anyone look at archived CONTENT",
    // and a repair plan is a look at the address, not at the memory.
    let doc: { body: string; meta: Record<string, unknown> } | null = null;
    try {
      doc = readProseWalking(store, id, row);
    } catch {
      doc = null;
    }
    const entityId = typeof doc?.meta["entityId"] === "string" ? doc.meta["entityId"] : null;
    const merge = mergeRecordOf(store, id);
    out.push({
      id,
      entityId,
      entityName: entityId === null ? null : entityNameOf(store, entityId),
      statement: doc === null ? "(prose unreadable)" : oneLine(doc.body, STATEMENT_PREVIEW),
      originalId: merge.originalId,
      originalPreview:
        merge.originalId === null ? null : previewOf(store, merge.originalId, STATEMENT_PREVIEW),
      mergedOnDay: merge.day,
      archived: row.archived === 1,
    });
  }
  return out;
}

/** The last `memory.merged` record naming this id, in ids and numbers. */
function mergeRecordOf(store: Store, id: string): { originalId: string | null; day: number | null } {
  const [last] = store.eventLog({ name: "memory.merged", ref: id, order: "desc", limit: 1 });
  if (last === undefined || last.payload === null) return { originalId: null, day: null };
  try {
    const parsed = JSON.parse(last.payload) as Record<string, unknown>;
    return {
      originalId: typeof parsed["originalId"] === "string" ? parsed["originalId"] : null,
      day: last.day,
    };
  } catch {
    return { originalId: null, day: last.day };
  }
}

function entityNameOf(store: Store, entityId: string): string | null {
  try {
    const name = readProseWalking(store, entityId).meta["name"];
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    // An id with no row, and prose that will not read, are the same answer here
    // — the name is unavailable. `readProseWalking` refuses the first by name,
    // so the row lookup this used to do first has nothing left to add.
    return null;
  }
}

function previewOf(store: Store, id: string, max: number): string | null {
  try {
    return oneLine(readProseWalking(store, id).body, max);
  } catch {
    return null;
  }
}

/** One line, at most `max` characters, with an ellipsis when it was cut. */
function oneLine(body: string, max: number): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/**
 * `timeZone` from the host configuration beside the store — the same file
 * `snapshotsDirBeside` reads — so a console command names the person's day in
 * the zone the hooks use (docs/time.md, 2026-09-25). It lives in `config.ts`
 * since 2026-10-09, where the dashboard reads it too; re-exported here for the
 * console's callers.
 */
export { zoneBeside };
