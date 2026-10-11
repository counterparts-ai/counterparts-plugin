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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isDay, localDate, localTime, resolveZone, todayIn } from "../../core/time.js";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

import {
  BOUNDARY_EVENT,
  Counterpart,
  RECALL_CREDIT_EVENT,
  RECALL_DECISION_EVENT,
  STORE_EXPORT_EVENT,
} from "../../core/counterpart.js";
import { PROBE_ROW_CEILING, probeOQ4, renderProbe } from "../../core/recall/probe.js";
import { CLAIMED_DEFAULT_META_KEY } from "../../core/mint.js";
// `band` is imported rather than mirrored: the dashboard computes the live
// band with this exact function, and two implementations of "which band is this
// row in today" is how the two surfaces disagreed in the first place.
import { TUNABLES, band } from "../../core/physics/index.js";
import { LANE_ORDER, PAGE_HOST_BUDGET_BYTES, PREFACE_RESERVE_BYTES, readChapterLead, readableDate } from "../../core/self/index.js";
// The ONE predicate for "this row is the journal, not a memory" — the same one
// the sleep phases and the dashboard's census use. A second copy of that test
// living here is how the console drifted away from them in the first place.
import { TUNABLES as SLEEP_TUNABLES, isJournal } from "../../core/sleep/index.js";
// The deep import into box 3's own driver — the same one `snapshot.ts` and
// `export.ts` make, and filed as INTERFACE-GAPS §5. `verify`'s census needs the
// number of vectors box 3 holds, and `Store` exposes no read for it.
import { BUSY_TIMEOUT_MS, foldWal, journalModeOf, openDb } from "../../core/store/db.js";
import type { Db, SqlValue, WalFold } from "../../core/store/db.js";
// Box 3's own door for the vector migration: `openCache` stamps the schema
// version, `vectorFormats` counts the two shapes, `convertVectorBatch` is the
// one transactional step. The conversion arithmetic lives in `store/cache.ts`
// beside the readers it must agree with, never in a second copy here.
import { convertVectorBatch, countNonFinite, openCache, vectorFormats } from "../../core/store/cache.js";
import {
  CACHE_SCHEMA_VERSION,
  DATA_DIR_ENV,
  EMBED_FAILED_PREFIX,
  ID_PREFIX,
  LAYOUT,
  PRE_ROWS_READABLE_BY,
  REQUIRE_EXPLICIT_DIR_ENV,
  CLAIMS_ERA_CUTOFF_KEY,
  SCHEMA_VERSION,
  Store,
  StoreError,
  dataDir,
  dateOf,
  decodeVector,
  describeGuardRefusal,
  DATABASE_FILE,
  describePreRowsRefusal,
  isPreRowsDatabase,
  isStoreError,
  preRowsMarkersIn,
  encodeVector,
  explicitDirSetting,
  isWithin,
  paths,
  readRollbackHold,
  storeExists,
} from "../../core/store/index.js";
import type { Embedder, EventLogCensus, VectorFormatCensus } from "../../core/store/index.js";
import { defaultSnapshotsDir } from "../../core/store/paths.js";
import {
  upgradeAgain,
  nextStepLines,
  performRollback,
  performRollbackUndo,
  planRollback,
  planRollbackUndo,
  previousVersion,
  readHolders,
  rollbackPlanLines,
} from "./rollback.js";
// The owner-op seam's REPAIR half — the one door that un-archives, and only for
// the merge's reason. Imported HERE for the same reason `chaseRemoved` is:
// this is the directory the caller-universality test allows to reach that file.
import { MERGED_ARCHIVE_REASON, unarchiveMerged } from "../../core/store/owner-op-seam.js";
// The WALKING read, imported for the same reason and pinned by the same test:
// it skips the archived-read telemetry AND the deny-list, so it is not a `Store`
// method (`store/walk-seam.ts`). The repair plan is a look at the address.
import { readProseWalking } from "../../core/store/walk-seam.js";
import type { Band, Kind } from "../../core/types.js";
// The MCP adapter's deliberate-recall dispatcher, imported rather than
// re-implemented: a console with its own question path would be a second set of
// rules about what recall means. `mcp/deliberate.ts` imports nothing from here,
// so the direction stays one-way.
import { deliberateRecall, embedQuestion } from "../mcp/deliberate.js";
// A question at the console is answered in FACTS MODE, the MCP `recall`'s own
// path (2026-10-03), for the same reason — and in MEANING MODE, its other path,
// when `--mode meaning` asks for it (2026-10-09).
import { factsRecall, renderFacts } from "../mcp/facts.js";
import { meaningRecall, renderMeaning } from "../mcp/meaning.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import {
  CONFIG_ENV,
  CONFIG_FLAG,
  defaultConfigPath,
  implicitConfigRefusal,
  resolveConfigPath,
} from "../config-path.js";
import type { ConfigChoice, ConfigSource } from "../config-path.js";
// The scope registry — host configuration, beside the host configuration. The
// console is the surface that WRITES it; the hooks and the MCP server only read.
import {
  canonicalScopePath,
  lookupScope,
  ownEntry,
  readScopes,
  resumeTarget,
  scopesPath,
  setScope,
  stanceOfMode,
  writeScopes,
} from "../scopes.js";
import type { ScopeMode, ScopeRegistry } from "../scopes.js";
import { OBSERVER_ENV, observerFromEnv, unreadableStanceLine } from "../stance-env.js";
// The what-fired reading, shared with `doctor` and the dashboard's health panel
// so the three surfaces cannot disagree about what "silent" means.
import { STATE_MEANING, STATE_ORDER, firedReport } from "../fired.js";
import type { FiredReport, FiredState } from "../fired.js";
// The short view over the same reading: one line per memory mechanism.
import { consoleVerdicts, mechanismsLines } from "./mechanisms.js";
// The process log `log` prints (`adapters/log/`).
import { LOG_DAYS, logDates, readLog } from "../log/index.js";
import type { LogEntry } from "../log/index.js";
// The two snapshot readers `status` shares with doctor: the DIRECTORY is what
// says how many copies you have, and a row only says what a run once wrote.
import { readSnapshotsDir, resolveSnapshotsDir } from "../snapshots.js";
// THE HOST ADAPTER'S OWN READINGS, imported rather than re-derived — the console
// reads the claude-code adapter here, and its configuration from the shared
// `../config.js` (moved out of `claude-code/` on 2026-09-30). `doctor` is
// the console's face on the file and the store that adapter owns, and a console
// with its own idea of "what counts as red" is exactly the drift I32 ran inside of.
import {
  SPAWN_REFUSAL_PREFIX,
  SPAWN_START_COUNT_KEY,
  SPAWN_START_DATE_KEY,
} from "../claude-code/hooks.js";
import { loadConfig, withEmbedderDefault, zoneBeside } from "../config.js";
// The one answer to "is there an embedder", shared with the hook, the worker and
// the MCP server's entry point — `ask` embeds its question with it.
import { openEmbedder } from "../claude-code/embed-client.js";
import type { LiveEmbedder } from "../claude-code/embed-client.js";
// The local table's locator, for install's one check that the weights the new
// configuration asks for are where the hooks will look.
import { MODEL_FILE, STATIC_WEIGHTS_ENV, STATIC_WEIGHTS_PACKAGE, resolveStaticWeights } from "../../core/embed/static.js";
import type { AdapterConfig } from "../config.js";
import {
  anyRed,
  doctorFindings,
  readCheckout,
  readCounterpartOpen,
  reportJson,
  // `reportLines` is NOT imported here any more: the plain arm reaches it from
  // inside `report.ts#printDoctorReport`, which is the one place that decides
  // between the two layouts. Two call sites would be two places to forget.
} from "../claude-code/doctor.js";
import type { CheckoutReading } from "../claude-code/doctor.js";
import { exportStore } from "./export.js";
import {
  BIN,
  CONFIG_FILE,
  DEFAULT_STORE_DIR,
  HOST_EVENTS,
  MCP_SERVER_NAME,
  bringParkedBack,
  budgetRefusal,
  configObject,
  resolveEmbedderBlock,
  hookCommand,
  hostSettingsDir,
  installLayout,
  parkedSiblings,
  throwawayDefaultRefusal,
  layoutRefusal,
  mcpCommand,
  readHost,
  settingsBlock,
  writeOnce,
} from "./install.js";
import type { InstallLayout, ParkedSighting } from "./install.js";
// `removalRefusal` is step 1 of a plan on its own — the console's picker asks it
// of every search hit before it offers one, and of every pick before it asks the
// one question. It is an extraction from `planRemoval`, never a second rule.
import { ownerRemoval, planRemoval, removalRefusal } from "./removal.js";
import type { RemovalPlan } from "./removal.js";
import { repairDates } from "./repair-dates.js";
import type { Confidence } from "./repair-dates.js";
import { NO_PAGE_LINES, bodyFrom, pageLines, versionLines, writeLines } from "./self-page.js";
import { coreListLines, dreamListLines, dreamShowLines, dreamingSettingWords } from "./dream-core.js";
import { settleListLines } from "./settle.js";
import { coverageLines } from "./coverage.js";
import { catchUpCommand } from "./catch-up.js";
import type { ChildPlan, ChildResult } from "../claude-code/child.js";
import { DREAMING_SETTINGS, NIGHT_RUN_FINISHES } from "../../core/dream/index.js";
import { REFLECTED_FEELING_KEY } from "../../core/sleep/index.js";
// The console's shared manners (2026-09-21): is there a person here, ask them,
// and say one marked line back.
import { ask, confirm, isInteractive, isPromptAborted, paint, typed, ui } from "./ui.js";
import type { Ui } from "./ui.js";
// N1's own module: the plan, the refusals and the one mutating call this
// command makes. It opens no store and imports nothing from here.
import {
  BLANK_INFIX,
  OPEN_WINDOW_MS,
  PARKED_INFIX,
  configLines,
  confirmationWord,
  guardedMove,
  park,
  parkedPath,
  planLines,
  planStartFresh,
  planUndo,
  readLiveness,
  rollbackLines,
  sight,
  undoLines,
} from "./start-fresh.js";
import type { ParkStep, StartFreshPlan, UndoPlan } from "./start-fresh.js";
// A's two modules: the host's files, and leaving. They import nothing from here
// but the `Io` type, so this direction is one-way.
import { look, realProcessLister, realSpawner, sessionsNote, tilde, unwire, wire } from "./wire.js";
import { connectDesktop, desktopUnavailable, readDesktop, repairDesktop } from "./desktop.js";
import type { DesktopRepair } from "./desktop.js";
import { BINARY, bundledModelDir, packagePath, runtimeLabel } from "../runtime.js";
import { installRoute } from "../plugin.js";
import type { Binary } from "../runtime.js";
import { DESKTOP_ALWAYS_ALLOW, DESKTOP_HOST, upgradeWords } from "../hosts.js";
import { hostsSeen, installedVersion } from "../sessions.js";
import type {
  Outcome as WireOutcome,
  ProcessLister,
  Spawner,
  WireInput,
  WireResult,
} from "./wire.js";
// `humanBytes` comes from `uninstall.ts` rather than from the private one
// below: the two spell a size differently ("7.6 MB" against "7.6 MiB"), and
// the folder `install` offers to bring back is the one `uninstall --park` set
// aside — the same folder, named twice on two screens, has to carry the same
// number.
import { humanBytes as humanDiskBytes, uninstall } from "./uninstall.js";
import { NO_PAGE_VERSION } from "../../core/self/index.js";
import { snapshot, snapshotName } from "./snapshot.js";
import { feelingsLine } from "../feelings-line.js";
// The console's map and the paragraphs the old `usage()` carried. One
// direction only: `help.ts` imports nothing but types back from this file.
import { COMMAND_DETAIL, CONSOLE_FOOTER, advancedHelp, shortHelp } from "./help.js";
// The terminal layouts for the two readings a person checks an install with.
// Both fall back to today's exact bytes for a console that is not a terminal.
import { printDoctorReport, printStatusReport } from "./report.js";
import type { StatusBlock, StatusView } from "./report.js";

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

export const EXIT = {
  ok: 0,
  usage: 1,
  refused: 2,
  failed: 3,
} as const;

export interface Io {
  out(line: string): void;
  err(line: string): void;
  /** Interactive confirmation. ABSENT means non-interactive, and a destructive
   *  command refuses rather than proceeding unconfirmed. */
  prompt?: (question: string) => Promise<string>;
  /**
   * The same read WITHOUT ECHO, for a value that must not reach a scrollback
   * buffer (a secret). Optional and additive: every console that has only
   * `prompt` behaves exactly as it did, and `ui.ts`'s `askHidden` REFUSES
   * rather than fall back to the echoing reader when this is absent and stdin
   * is a terminal. `ui.ts/hiddenPrompt` builds one over real streams.
   */
  promptHidden?: (question: string) => Promise<string>;
  /**
   * WHAT THE HOST KNOWS ABOUT ITS TERMINAL — the seam `ui.ts` decides colour,
   * wrapping and interactivity from. ABSENT means "not a terminal", which is
   * the truth for every pipe and every test console, so a console that does not
   * set it keeps today's plain, unwrapped, never-asking output.
   */
  tty?: { readonly stdin: boolean; readonly stdout: boolean; readonly columns?: number };
}

export interface RunOptions {
  io: Io;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /**
   * The home directory `install` writes its configuration under. Real runs never
   * pass it; the TESTS always do, because `install` writes to
   * `~/.counterparts/claude-code.json` by design — that is the one path the
   * hooks read — and a test that used the real one would write the owner's live
   * configuration. The hermetic rule (CLAUDE.md) has no exceptions, so the seam
   * is here rather than in a mocked `os` module.
   */
  home?: string;
  /**
   * STANDARD INPUT, as a seam — `self-page --write --stdin` reads the page from
   * here.
   *
   * `isTty` is the host telling us whether a human is at the keyboard: with no
   * pipe the command REFUSES and names the two ways in, rather than hanging on
   * a terminal the owner will have to Ctrl-C. Injected so a test can prove the
   * whole path — including "the value never appears in the output" — without a
   * subprocess.
   */
  stdin?: { isTty: boolean; read: () => Promise<string> };
  /**
   * WHICH CHECKOUT IS RUNNING, for `doctor`. Real runs never pass it — the
   * reading derives itself from the running code's own path, which is the whole
   * point of the finding. The TESTS always do, because the suite runs inside a
   * git checkout that is by definition on a branch and dirty while somebody is
   * working in it, and a test whose verdict depended on that would pass and fail
   * with the developer's `git status`.
   */
  checkout?: CheckoutReading;
  /**
   * `claude`, AND `ps` — the two programs `wire`, `unwire` and `uninstall`
   * reach outside this process for.
   *
   * Real runs never pass them; `install.ts`'s own `realSpawner` / the process
   * lister are the defaults. **The TESTS always do**, and it is the same rule
   * `checkout` is here for one clause up: a test that let the interactive
   * install arm run would otherwise invoke whatever `claude` is on the
   * developer's PATH, against their own `~/.claude.json`. Nothing in this suite
   * may run the real binary, and a seam is how that is a fact rather than a
   * habit.
   */
  spawner?: Spawner;
  processes?: ProcessLister;
  /**
   * THE WEB VIEW, for `dashboard` — the same kind of seam as `spawner` above
   * and for a sharper version of the same reason: a test that let the real one
   * run would BIND A PORT on the machine running the suite. Real runs never
   * pass it and get `realDashboard()`, which loads the server module lazily.
   */
  dashboard?: DashboardSeam;
  /**
   * WHERE A NOTE IS FILED — the scope `note` stamps on what it writes. Real
   * terminal runs pass nothing and get the working directory, which is where
   * the person typing is. The dashboard passes its store's own directory: a
   * note written in the browser was not written from any project, and the
   * server's working directory is only wherever it happened to be launched.
   * (The store dir is the same "no project" answer `mcp/server.ts#resolveScope`
   * falls back to.)
   */
  scope?: string;
  /**
   * THE SINGLE BINARY (`runtime.ts#Binary`), when this console is it — the
   * program the Claude Code plugin downloads when a machine has no Bun or Node.
   * Real runs never pass it and get `BINARY`; tests pass one to drive the
   * binary's refusals from source.
   */
  binary?: Binary | null;
  /**
   * THE CATCH-UP CHILD, for `catch-up` — the same kind of seam as `spawner`:
   * a test that let the real one run would start `claude -p` on the machine
   * running the suite. Real runs never pass it.
   */
  catchUpStart?: (plan: ChildPlan) => Promise<ChildResult>;
}

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

interface Parsed {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean | undefined>;
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
  uninstall: ["config", "yes", "park", "delete-memories", "nothing-is-open"],
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
  core: ["list", "demote", "reason", "reflected-feeling"],
  settle: ["list", "pair", "holds", "against", "how", "why", "undo"],
  about: ["why"],
  coverage: ["date"],
  // `--config` because the store it opens is the one the configuration names,
  // and the child's memory server reads the same file.
  "catch-up": ["config"],
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
    "Leave: disconnect Claude Code, then say where your memory still is and how to remove the package. It never touches your memory unless you say --park (one rename, dated) or --delete-memories (which counts first and asks you to type a phrase).",
  init: "Just a store: create a data dir and PRINT the install steps. For a second store or a scratch one.",
  "start-fresh":
    "Begin again as a stranger (or --undo to put the parked store back): park the store your configuration names beside itself under a dated name, park its snapshots the same way, and create a blank store at the same path. One atomic rename each — it never copies, never deletes, and never opens the old store, not even read-only. The configuration is kept byte for byte.",
  rollback:
    "Go back to the version before an upgrade: put the store back from the copy the upgrade took first (the newest one unless --to names another), after saying what would be lost and asking you to type a word. The upgraded database and its cache are set aside beside the store, never deleted, and a hold keeps this version from upgrading or reading the store again until you install the older version, run --upgrade-again, or --undo it. It refuses while a session, a memory server or the dashboard has the store open.",
  note: "Remember this, deliberately — the same two doors the MCP tool uses.",
  ask: "Ask memory a question. Read-only.",
  recall: "Ask memory a question — the same command as `ask`, under its older name. Read-only.",
  export: "A portable copy of the store, encrypted unless you say otherwise.",
  backup: "Snapshot: prose plus the canonical DB via VACUUM INTO. The cache is excluded.",
  remove:
    "The loud removal. With nothing after it, at a terminal, it asks for a memory id or for words to search for, numbers what it finds, lets you pick one or several (or name several ids outright), shows the plan for each, and asks once before it deletes them. --confirm is the scripted door: that exact id, confirmed by typing it back. Anywhere a person cannot be asked — a pipe, a redirect, a CI job — and without --confirm, it prints the plan and changes nothing.",
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
    "The core — the memories about me, about us and about the owner that do not fade. With no flags (or --list), what it holds and which lane carried each one there, what dreams have nominated, and what you sent back; --demote <id> --reason \"...\" sends one back to ordinary fading from today, records why, and keeps the lanes from promoting it again; --reflected-feeling on|off opens or closes the core to reflection alone. On (the default): a feeling a reflection records later and a reflection citing a memory both count toward the fast lane, and a reflection may re-label what a memory is about either way — each re-label is recorded with its reason, and one into me, us or the owner is told in the next morning share. Off: nothing reaches the core on a reflection alone — the fast lane needs a feeling felt at the time (not one a reflection recorded later) and an ordinary use after a gap (not a reflection citing it), and a reflection may only move what a memory is about toward work or world. Reading works under observer; the two changes refuse there.",
  settle:
    "Two memories that disagree. With no flags (or --list), the pairs nobody has settled — a dream flags them — and the ones settled lately: how, which holds, who settled it and why; and the corrections held in the last 7 lived days (a memory said it changes or corrects one that didn't look related, so nothing was settled) that nobody has settled since, each with the command that settles it. --pair <id> --holds <memory id> --how changed|corrected|open --why \"...\" settles one as you (or --holds <id> --against <id> for two memories no dream flagged): changed — both were true at their time, the older fades once and is shown as earlier; corrected — the older was wrong, it leaves recall and stays readable by its id; open — a real disagreement, both kept and shown together. No memory is rewritten. --undo <pair> reverses a settle: the strength comes back, a corrected memory comes back into recall, and the pair is unsettled again. Reading works under observer; the two changes refuse there.",
  about:
    "What a memory is about — me (who I am), us (the two of us), owner (you, as a person), work (the craft) or world (anything else). With an id alone, its mark and who set it; with an id and a mark, it changes the mark as you, keeps --why with it, and records it the way a nightly reflection's re-mark is recorded. Unmarked, a fact written in a project (or a skill) counts as that project's work and is shown only there; me, us and owner are shown everywhere and can become part of who I am. An archived memory can be marked too (the mark counts if it comes back); an earlier version's id marks the current one. Reading works under observer; the change refuses there.",
  coverage:
    "What is written up, and what is not yet, for one date (default today): each session that captured something that day, how much of it is written up, and what is not yet written up — how many pieces, over how long, since when — and whether that is owed (the nightly run catches it up, or counterparts catch-up does now), lapsed (let go unwritten after fourteen days of use — lost to memory; nothing is deleted), under the floor, or still at work. Read-only.",
  "catch-up":
    "Write up, now, every session that ended before it was written up — what the nightly run does each morning, on demand. Oldest first, in batches, each a windowless claude -p of its own allowed one tool (session_end); it prints each batch, then what it caught up and what is left. Sessions may be open meanwhile: one still at work is left for later, one being written up elsewhere is passed over. It uses your Claude subscription like any session. At most 400 parts and an hour a run; what is left stays owed. Refuses under observer.",
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
  scope: " <path|.>",
  // The host is OPTIONAL and there is one of them: `counterparts connect` and
  // `counterparts connect claude-code` are the same command, and any other name
  // is refused with the one it knows. The synopsis says so rather than offering
  // a menu of one (owner item 3).
  connect: " [claude-code]",
  disconnect: " [claude-code]",
  help: " [advanced | <command>]",
  dream: " [--list [--all] | --show <id> | --undo <id>]",
  core: " [--demote <id> --reason \"...\" | --reflected-feeling on|off]",
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
  yes: "do not ask: take the ordinary answer to every question this command would put",
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

/**
 * THE ONE DOOR IN FRONT OF A BULK WRITE: the store is named by the `--dir`
 * FLAG, typed on this command line, or the command refuses.
 *
 * **The disagreement this ends (review of #77, 2026-09-05).** Two writing
 * commands landed the same night with two definitions of "named".
 * `migrate-cache --apply` counted `COUNTERPARTS_DATA_DIR`, so
 * `COUNTERPARTS_DATA_DIR=<store> counterparts migrate-cache --apply --yes`
 * walked through its door, reached the conversion and would have rewritten
 * every vector; `repair-dates --apply`, one command over, refused the identical
 * environment, because its guard read `flags.dir === undefined`. Two answers to
 * "did you name the store", in one console, under one `--yes` sentence
 * asserting they agreed.
 *
 * **The owner's ruling (2026-09-05).** `--yes` only ever skips an interactive
 * confirmation. A command that performs a BULK WRITE always requires the
 * `--dir` flag; neither `--yes` nor `COUNTERPARTS_DATA_DIR` stands in for it.
 * An exported variable is a shell's memory of where a store lives, not a
 * sentence somebody typed about THIS rewrite — and on a real machine what it
 * names is the owner's live memory. Ordinary per-memory commands (`note`,
 * `recall`, `remove`, `init`, `install`, `status`, and `verify`'s read-only
 * census) keep today's behaviour: the variable names their store, which is what
 * QUICKSTART §3a teaches.
 *
 * Called FIRST in each writing body, before `storeExists` and before any
 * planning read: a guard that opened the directory before refusing it has
 * already pointed the command at the store it meant to refuse.
 *
 * `label` is the invocation as the owner typed it (`repair-dates --apply`,
 * `verify --rebuild`) and `what` is the one clause saying what it would have
 * done. Returns the refusal's exit code, or `null` when the door is open.
 */
function requireDirFlagForBulkWrite(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
  label: string,
  what: string,
): number | null {
  // The same test the dispatcher uses to decide whether `--dir` named the
  // store. A bare trailing `--dir` never reaches here — `unknownFlag` refuses
  // it for want of a value — and if it ever did it would arrive as boolean
  // `true`, which is "absent" to every reader in this file, and to this one.
  if (typeof flags["dir"] === "string") return null;
  io.err(
    `refused: '${label}' ${what}, and will not run against a store nobody named (it would have been ${dir}). Name the store: --dir <path>.`,
  );
  io.err("Nothing has changed.");
  return EXIT.refused;
}

export function parse(argv: readonly string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: false,
    options: {
      dir: { type: "string" },
      out: { type: "string" },
      reason: { type: "string" },
      passphrase: { type: "string" },
      plaintext: { type: "boolean" },
      markdown: { type: "boolean" },
      "include-confidential": { type: "boolean" },
      "with-versions": { type: "boolean" },
      "into-non-empty": { type: "boolean" },
      overwrite: { type: "boolean" },
      "echo-scan": { type: "string" },
      confirm: { type: "boolean" },
      name: { type: "string" },
      embedder: { type: "boolean" },
      "no-embedder": { type: "boolean" },
      force: { type: "boolean" },
      kind: { type: "string" },
      title: { type: "string" },
      salience: { type: "string" },
      id: { type: "string" },
      json: { type: "boolean" },
      full: { type: "boolean" },
      // `ask`'s page of a facts answer (2026-10-03).
      page: { type: "string" },
      // `ask`'s mode: facts (the default) or meaning (2026-10-09).
      mode: { type: "string" },
      // `ask`'s: the question is already in the counterpart's voice (U13).
      voiced: { type: "boolean" },
      apply: { type: "boolean" },
      // `verify`'s two: the rebuild is opt-in, and dropping vectors this console
      // cannot recompute is opt-in on top of that. Declared rather than left to
      // `strict: false`, which does not make an undeclared boolean reliable.
      rebuild: { type: "boolean" },
      "drop-vectors": { type: "boolean" },
      // I13's cheap repair: take the archived and superseded rows out of the
      // text index without resetting box 3, so the embeddings survive.
      "prune-index": { type: "boolean" },
      "keep-vectors": { type: "boolean" },
      batch: { type: "string" },
      yes: { type: "boolean" },
      budget: { type: "string" },
      config: { type: "string" },
      // `repair-dates`' three. `dry-run` is a declared boolean rather than a
      // `strict: false` accident so that `--apply --dry-run` is a refusal the
      // command can see, and the two string flags are declared for the same
      // reason `budget` is: an undeclared valued flag arrives as `true`.
      // (`yes` is declared above; `migrate-cache` is the one command that takes
      // it, since repair-dates has no confirmation to skip.)
      "dry-run": { type: "boolean" },
      confidence: { type: "string" },
      "import-day": { type: "string" },
      sample: { type: "string" },
      stdin: { type: "boolean" },
      // `self-page`'s own three that are not already declared. `--file` and
      // `--version` are strings for the reason every valued flag here is: a
      // trailing `--from` would otherwise arrive as the boolean `true` and be
      // read as "no file named".
      write: { type: "boolean" },
      // `start-fresh`'s two. Declared as booleans for the same reason `rebuild`
      // is: `strict: false` does not make an undeclared boolean reliable.
      undo: { type: "boolean" },
      // `rollback`'s two (2026-10-11): which copy to put back, and the release.
      to: { type: "string" },
      "upgrade-again": { type: "boolean" },
      "nothing-is-open": { type: "boolean" },
      // The wiring three. Declared as booleans for the same reason `rebuild`
      // is: `strict: false` does not make an undeclared boolean reliable, and
      // `--delete-memories` arriving as anything but `true` would be a flag the
      // most dangerous command in the package could not see.
      "no-connect": { type: "boolean" },
      park: { type: "boolean" },
      "delete-memories": { type: "boolean" },
      // `dashboard`'s two. `--port` is a string for the reason every valued flag
      // here is: a trailing `--port` would otherwise arrive as the boolean
      // `true` and be read as "no port named", which is the right answer by
      // accident and the wrong one the moment somebody writes `--port --no-open`.
      port: { type: "string" },
      "no-open": { type: "boolean" },
      file: { type: "string" },
      // `--short <file>`, the page's short version: a string like `--file`, so
      // the spaced form carries its file. Undeclared, `--short <file>` arrived
      // as the boolean `true` with the file left over as a positional, and was
      // refused; only `--short=<file>` worked.
      short: { type: "string" },
      versions: { type: "boolean" },
      version: { type: "string" },
      restore: { type: "string" },
      clear: { type: "boolean" },
      "if-version": { type: "string" },
      // `dream --show <id>` and `core --demote <id>`: strings, so a trailing
      // flag is a refusal rather than a `true` read as "no id named". `dream
      // --undo` reuses `start-fresh`'s boolean and takes the id positionally.
      show: { type: "string" },
      demote: { type: "string" },
      // `settle`'s five valued flags (2026-09-29): strings, so a trailing flag
      // is a refusal rather than a `true` read as "none named".
      pair: { type: "string" },
      holds: { type: "string" },
      against: { type: "string" },
      how: { type: "string" },
      why: { type: "string" },
      // `core --reflected-feeling on|off` (2026-09-27): a string, so a bare
      // flag is a refusal rather than a `true` read as a choice.
      "reflected-feeling": { type: "string" },
      // `dream --setting auto|ask|off` (2026-09-28): a string, like
      // `--reflected-feeling`. `counterparts dream` prints the setting.
      setting: { type: "string" },
      // `log --date YYYY-MM-DD` (which day's file to print) and `coverage
      // --date` (which day to read): a string, so a bare flag is a refusal.
      date: { type: "string" },
      host: { type: "string" },
      observer: { type: "boolean" },
      help: { type: "boolean" },
      // `scope`'s five. Declared as booleans for the same reason `rebuild` is:
      // `strict: false` does not make an undeclared boolean reliable. `--note`
      // is a string, so a trailing `--note` is a refusal rather than a `true`
      // silently recorded as the reason a directory was turned off.
      on: { type: "boolean" },
      off: { type: "boolean" },
      pause: { type: "boolean" },
      resume: { type: "boolean" },
      list: { type: "boolean" },
      note: { type: "string" },
    },
  });
  return {
    command: positionals[0],
    positional: positionals.slice(1),
    flags: values as Record<string, string | boolean | undefined>,
  };
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

/**
 * `dataDir()` reads the environment AT CALL TIME and runs the path guard — and
 * it reads THIS invocation's environment, not the process's: the tests pass one,
 * and a caller-supplied environment is honoured without mutating the real one
 * (the old shape here swapped `COUNTERPARTS_DATA_DIR` in and out of
 * `process.env` around the call; `dataDir(env)` made that unnecessary, and it
 * means the explicit-dir guard is read from the same environment as the dir).
 */
function resolveDir(env: Record<string, string | undefined>): string {
  return dataDir(env);
}

/**
 * The store refusals the console renders as a SENTENCE rather than printing the
 * error's own line, because the reader is owed what it refused and how to
 * proceed (constitution 16), not a JSON detail. The sentences are the store's
 * (`describeGuardRefusal`, `describePreRowsRefusal`); the remedy is this
 * console's, because it is the surface that has `--dir`. Every other store
 * error keeps its `${code} ${detail}` line, asserted by code.
 *
 * Two of them now. The explicit-dir guard is one an operator armed on purpose.
 * `STORE_PRE_ROWS` joined it after review A measured what every console door
 * actually printed at a pre-rows store — the bare code and a JSON blob, with
 * the one instruction the owner is given ("Run: counterparts doctor") printing
 * the same blob. A dead end at the exact moment of the cut-over.
 */
/**
 * `refused: …` exactly once. The store's own sentences already open with the
 * word, and `init`/`install` added their own prefix in front of it (review f5c,
 * NIT-2).
 */
function prefixedRefusal(said: string): string {
  return said.startsWith("refused:") ? said : `refused: ${said}`;
}

function describeDirRefusal(err: unknown, dir?: string): string {
  return (
    describeGuardRefusal(err, `Name the store: --dir <path>, or ${DATA_DIR_ENV}.`) ??
    describePreRowsRefusal(err, `Name a store with --dir <path>.`) ??
    preRowsInDisguise(err, dir) ??
    upgradePending(err) ??
    // A rollback's hold: its remedy is the sentence, not the JSON around it.
    (isStoreError(err, "STORE_ROLLED_BACK") && typeof err.detail["remedy"] === "string" ? err.detail["remedy"] : null) ??
    String((err as Error).message ?? err)
  );
}

/**
 * A store on an OLDER schema, met by a read-only door (review N1, 2026-09-25).
 * `STORE_UNINITIALIZED` with a `found` version below this build's reads, to an
 * observer, like an empty store; it is not — it is waiting for the first
 * session, which copies it and upgrades it. Doctor's sentence, said here too.
 * WHICH session is said in the words of the hosts the store's registry has
 * seen (`hosts.ts#upgradeWords`, 2026-10-01): with only Claude Desktop there
 * is no Claude Code session to wait for.
 */
function upgradePending(err: unknown): string | null {
  if (!isStoreError(err, "STORE_UNINITIALIZED")) return null;
  const found = Number.parseInt(String(err.detail["found"] ?? ""), 10);
  // Only a store this build can migrate: v6 up. Below the floor is the
  // pre-rows refusal's sentence, never "the next session upgrades it".
  if (!Number.isFinite(found) || found < 6 || found >= SCHEMA_VERSION) return null;
  // The refusal names the database file; the registry sits beside it.
  const path = err.detail["path"];
  const words = upgradeWords(typeof path === "string" && path.length > 0 ? hostsSeen(dirname(path)) : new Set());
  return (
    `this store is on schema v${String(found)}; ${words.who} copies it and upgrades it ` +
    `to v${String(SCHEMA_VERSION)}. Nothing to do: ${words.open}, then run this again.`
  );
}

/** The line a read-only door prints when its open was refused. */
function openRefusalLine(err: unknown, dir?: string): string {
  if (dir !== undefined && preRowsInDisguise(err, dir) !== null) {
    return `could not open the store: ${describeDirRefusal(err, dir)}`;
  }
  return upgradePending(err) ?? `could not open the store: ${describeDirRefusal(err, dir)}`;
}

/**
 * The shape-lock shape, wearing `STORE_UNINITIALIZED`'s clothes.
 *
 * A door that opens as an OBSERVER never reaches the second lock: `initialize:
 * false` short-circuits on `OBSERVER_READ_FLOOR` and throws
 * `STORE_UNINITIALIZED` first. So `status` and `verify` printed a bare code and
 * a JSON blob on a v5 database renamed to `counterparts.sqlite`, while
 * `verify --rebuild`, `migrate-cache`, `init` and the hook all printed the
 * sentence — A-MINOR-3's exact complaint surviving on the other lock's shape
 * (review f5c, NEW-MINOR-3).
 *
 * Only asked when the store has already refused, and only about a file already
 * named `counterparts.sqlite` — never the owner's parked v5 store, which is
 * caught by NAME before anything opens it.
 */
function preRowsInDisguise(err: unknown, dir: string | undefined): string | null {
  if (dir === undefined) return null;
  if (!isStoreError(err, "STORE_UNINITIALIZED")) return null;
  if (!isPreRowsDatabase(paths.operational(dir))) return null;
  return describePreRowsRefusal(
    new StoreError("STORE_PRE_ROWS", {
      dir,
      found: DATABASE_FILE,
      expected: SCHEMA_VERSION,
      reason: "no-body-column",
    }),
    `Name a store with --dir <path>.`,
  );
}

// ── status ──────────────────────────────────────────────────────────────────

/**
 * The census, owner-side. It opens the store in OBSERVER stance whatever the
 * console's own stance is: reading the store must not be able to change it, and
 * the store's own seam is the thing that enforces that (observer-mode G3).
 *
 * Unlike the model-facing census in `adapters/mcp/`, this one may name ids and
 * enumerate the permanent list — "everything permanent is enumerable and
 * inspectable on demand: a list, not a cadence" (§14.1 G9). The owner's console
 * is exactly where that list belongs.
 */
/** `probe-oq4` — read-only; the same store-absent and open rules as `status`. */
function probeCommand(dir: string, io: Io, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  let store: Store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    // Explicit ceiling, read NEWEST first and turned back to oldest first: an
    // ascending read with a limit drops the newest rows — the side of the
    // table the probe exists to read.
    const decisions = store.eventLog({ name: RECALL_DECISION_EVENT, order: "desc", limit: PROBE_ROW_CEILING }).reverse();
    const credits = store.eventLog({ name: RECALL_CREDIT_EVENT, order: "desc", limit: PROBE_ROW_CEILING }).reverse();
    const rows = [...decisions, ...credits].map((r) => ({ name: r.name, day: r.day, payload: r.payload }));
    for (const line of renderProbe(probeOQ4(rows))) io.out(line);
    for (const [name, got] of [
      [RECALL_DECISION_EVENT, decisions.length],
      [RECALL_CREDIT_EVENT, credits.length],
    ] as const) {
      if (got >= PROBE_ROW_CEILING) {
        io.err(`warning: ${name} hit the ${PROBE_ROW_CEILING}-row ceiling; the oldest rows are missing from this table`);
      }
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * `mechanisms` (and its older name `fired`) — which mechanisms have actually
 * fired, and which have not.
 *
 * Two views over ONE reading. The default is the short one a regular user
 * reads: a line per memory mechanism the site names, and the plumbing in one
 * line (`mechanisms.ts`). `--all` is the full report below, unchanged.
 *
 * Read-only, and the same store-absent and open rules as `status`: it opens the
 * store in OBSERVER stance whatever the console's own stance is, because reading
 * what fired must not be able to change it.
 *
 * SILENT FIRST is the whole shape of the full report. A page that opened with
 * everything that worked would bury the one thing worth acting on — constitution
 * 11's "one that stays silent is diagnosed and fixed" needs the silences on the
 * first screen, and every group carries the one line that says what its state
 * means so the reader never has to know the vocabulary in advance.
 */
function firedCommand(
  dir: string,
  io: Io,
  namedDir: boolean,
  now: () => number,
  all = false,
): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  let store: Store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const today = localDate(now(), store.zone());
    const report = firedReport(store, today);
    for (const line of all ? firedLines(report, true) : mechanismsLines(report, consoleVerdicts(store, today))) io.out(line);
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * The names `log` tells in the dashboard's sentence. Those sentences were
 * written for durable payloads, and only these names carry the same fields on
 * the ring as in their row — checked one by one (review of #286: `handoff.*`
 * from the ring read "showing for 0 days"). Every other name prints its data.
 */
const LOG_NARRATED: readonly string[] = [
  "adapter.boundary",
  "adapter.ask",
  "adapter.wake.injected",
  "adapter.writeup.failed",
  "remember.capture.failed",
];

/**
 * `log` — one day of the process log (`adapters/log/`), oldest first, one plain
 * line per entry: the time, which process, the session, the name, and what it
 * said. A name in `LOG_NARRATED` is told in the dashboard's sentence
 * (`dashboard/web/narrate.ts`); any other prints its data as `key=value`.
 *
 * The store is opened as an instrument, only to read the zone and to let a
 * sentence resolve the memory it names; a store that will not open still gets
 * its log printed, raw.
 */
async function logCommand(dir: string, io: Io, dateFlag: unknown, now: () => number): Promise<number> {
  if (dateFlag !== undefined && (typeof dateFlag !== "string" || !isDay(dateFlag))) {
    io.err("refused: --date takes a day, YYYY-MM-DD.");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}.`);
    return EXIT.usage;
  }
  let store: Store | null = null;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch {
    store = null;
  }
  try {
    const zone = store?.zone() ?? resolveZone(zoneBeside(dir));
    const date = typeof dateFlag === "string" ? dateFlag : localDate(now(), zone);
    const read = readLog(dir, date);
    if (!read.exists) {
      const held = logDates(dir);
      io.out(
        `Nothing logged on ${date}.` +
          (held.length === 0
            ? " The log is empty — it fills as sessions run."
            : ` The log keeps ${String(LOG_DAYS)} days; it holds ${held.join(", ")}.`),
      );
      return EXIT.ok;
    }
    const narrator = store === null ? null : await import("../dashboard/web/narrate.js");
    for (const entry of read.entries) {
      let said: string | null = null;
      if (narrator !== null && store !== null && LOG_NARRATED.includes(entry.name)) {
        said = narrator.narrate(store, {
          seq: 0,
          at: Date.parse(entry.at),
          day: 0,
          name: entry.name,
          ref: entry.ref,
          dedup_key: null,
          payload: JSON.stringify(entry.data),
        }).text;
      }
      io.out(logEntryLine(entry, zone, said));
    }
    if (read.unreadable > 0) io.out(`(${String(read.unreadable)} line${read.unreadable === 1 ? "" : "s"} in the file could not be read)`);
    return EXIT.ok;
  } finally {
    store?.close();
  }
}

/** One entry, one line: `14:03:12  hook:stop  3f2a9c1e  adapter.boundary  <what it said>`. */
export function logEntryLine(entry: LogEntry, zone: string, said: string | null = null): string {
  const at = Date.parse(entry.at);
  const time = Number.isFinite(at) ? localTime(at, zone) : entry.at;
  const session = entry.session === null ? "-" : entry.session.slice(0, 8);
  const data = Object.entries(entry.data)
    .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`)
    .join(" ");
  const ref = entry.ref === null ? "" : ` [${entry.ref}]`;
  return `${time}  ${entry.proc.padEnd(24)}  ${session.padEnd(8)}  ${entry.name}${ref}  ${said ?? data}`.trimEnd();
}

/**
 * `coverage` — what is written up and what is not yet, for one date
 * (2026-09-30). Read-only: the store and the span buffer open as instruments,
 * and every decision is `core/coverage/`'s (`coverage.ts` prints it).
 */
function coverageCommand(dir: string, io: Io, parsed: Parsed, now: () => number, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const asked = parsed.flags["date"];
  if (asked !== undefined && (typeof asked !== "string" || !isDay(asked))) {
    io.err("refused: --date takes a day as YYYY-MM-DD.");
    return EXIT.usage;
  }
  let store: Store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const today = localDate(now(), store.zone());
    for (const line of coverageLines({ store, date: typeof asked === "string" ? asked : today, today })) io.out(line);
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * `dream` — what each dream did, and its undo (2026-09-26). The rules are the
 * core's (`core/dream/`); this picks one of three modes and prints lines
 * (`dream-core.ts`). Reading opens the store as an instrument; `--undo` opens
 * it in the console's stance and the core refuses it under observer.
 */
function dreamCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const show = parsed.flags["show"];
  const undo = parsed.flags["undo"] === true;
  const undoId = typeof parsed.flags["undo"] === "string" ? parsed.flags["undo"] : parsed.positional[0];
  const setting = parsed.flags["setting"];
  if (typeof show === "string" && undo) {
    io.err("refused: --show and --undo are two different things to do. Pass one.");
    return EXIT.usage;
  }
  if (setting !== undefined) {
    // THE OWNER'S SETTING (2026-09-28): the same value the dream tool's
    // `setting` phase writes ("no dreams" in conversation).
    if (typeof setting !== "string" || !(DREAMING_SETTINGS as readonly string[]).includes(setting)) {
      io.err("refused: --setting takes auto, ask or off.");
      return EXIT.usage;
    }
    if (observer) {
      io.err("refused: this console is an observer; it reads and changes nothing. Nothing was changed.");
      return EXIT.refused;
    }
    const counterpart = openCounterpart(dir, observer);
    try {
      const out = counterpart.dreams.setSetting(setting, { by: "owner" });
      if (!out.ok) {
        io.err(`refused: ${out.reason}. Nothing was changed.`);
        return EXIT.refused;
      }
      io.out(`Dreaming: ${out.setting}${out.before === out.setting ? " (it already was)" : ` (was ${out.before})`}.`);
      io.out(`  ${dreamingSettingWords(out.setting)}`);
      // Owner decision D (2026-09-29): "off" does not stop a run already going.
      if (out.setting === "off" && counterpart.dreams.nightRunUnderWay()) io.out(`  ${NIGHT_RUN_FINISHES}`);
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  if (undo) {
    if (undoId === undefined || undoId.length === 0) {
      io.err("refused: --undo needs the dream's id after it (counterparts dream --list shows them).");
      return EXIT.usage;
    }
    const counterpart = openCounterpart(dir, observer);
    try {
      if (counterpart.store.dream(undoId) === undefined) {
        io.err(`refused: no dream ${undoId} in this store. counterparts dream --list shows them.`);
        return EXIT.refused;
      }
      const out = counterpart.dreams.undo(undoId);
      if (!out.ok) {
        io.err(
          out.reason === "observer"
            ? "refused: this console is an observer; it reads and changes nothing. Nothing was undone."
            : `refused: ${out.reason}. Nothing was undone.`,
        );
        return EXIT.refused;
      }
      io.out(
        out.reversed === 0
          ? `Dream ${undoId} had nothing left to reverse; it is marked undone.`
          : `Undid dream ${undoId}: ${String(out.reversed)} ${out.reversed === 1 ? "change" : "changes"} reversed.`,
      );
      io.out("  Merged memories are back as they were, its links and gists are gone, and its replays and nominations were taken back.");
      if (out.kept > 0) {
        io.out(
          `  ${String(out.kept)} ${out.kept === 1 ? "merge was" : "merges were"} left as ${out.kept === 1 ? "it is" : "they are"}: the merged memory has changed since (revised, merged again, or removed), and bringing its originals back would duplicate it.`,
        );
      }
      io.out("  Its journal is kept, marked undone: counterparts dream --show " + undoId);
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  const counterpart = openCounterpart(dir, true);
  try {
    if (typeof show === "string") {
      const lines = dreamShowLines(counterpart, show);
      if (lines === null) {
        io.err(`refused: no dream ${show} in this store. counterparts dream --list shows them.`);
        return EXIT.refused;
      }
      for (const line of lines) io.out(line);
      return EXIT.ok;
    }
    for (const line of dreamListLines(counterpart, parsed.flags["all"] === true ? "all" : undefined)) io.out(line);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * `settle` — contradictions, the owner's door (2026-09-29). The list reads
 * under any stance; a settle and an undo go through `Counterpart
 * .settleContradiction` / `.undoContradiction`, which decide everything and
 * refuse under observer. The owner is the actor on the trail.
 */
function settleCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const str = (name: string): string | undefined => {
    const v = parsed.flags[name];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  };
  const undo = parsed.flags["undo"] === true;
  const how = str("how");
  const writing = undo || how !== undefined || str("pair") !== undefined || str("holds") !== undefined || str("against") !== undefined;
  if (undo && how !== undefined) {
    io.err("refused: --undo and --how are two different things to do. Pass one.");
    return EXIT.usage;
  }
  if (!writing) {
    const counterpart = openCounterpart(dir, true);
    try {
      for (const line of settleListLines(counterpart)) io.out(line);
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  if (observer) {
    io.err("refused: this console is an observer; it reads and changes nothing. Nothing was settled.");
    return EXIT.refused;
  }
  const counterpart = openCounterpart(dir, observer);
  try {
    if (undo) {
      const id = parsed.positional[0];
      if (id === undefined || id.length === 0) {
        io.err("refused: --undo needs the pair's id after it (counterparts settle lists them).");
        return EXIT.usage;
      }
      const out = counterpart.undoContradiction({ pair: id, actor: "owner", why: str("why") ?? null });
      if (!out.ok) {
        io.err(`refused: ${out.reason} — ${out.detail} Nothing was undone.`);
        return EXIT.refused;
      }
      io.out(
        out.state === "unsettled"
          ? `Undid the settle of ${out.pair} (${out.how ?? "settled"}); the pair is unsettled again — a question to settle.`
          : `Undid the settle of ${out.pair} (${out.how ?? "settled"}); the pair is withdrawn — nobody had flagged it, so nothing is left to settle.`,
      );
      if (out.restored !== null) io.out(`  ${out.restored}'s strength is back to what it was.`);
      if (out.unarchived !== null) io.out(`  ${out.unarchived} is back in recall.`);
      if (out.reopened.length > 0) io.out(`  Reopened too: ${out.reopened.join(", ")}.`);
      if (out.note !== undefined) io.out(`  ${out.note}`);
      return EXIT.ok;
    }
    if (how === undefined) {
      io.err("refused: say how it settles: --how changed, corrected or open.");
      return EXIT.usage;
    }
    const pair = str("pair");
    const holds = str("holds");
    const over = str("against");
    const out = counterpart.settleContradiction({
      ...(pair === undefined ? {} : { pair }),
      ...(holds === undefined ? {} : { holds }),
      ...(over === undefined ? {} : { over }),
      how,
      why: str("why") ?? null,
      actor: "owner",
    });
    if (!out.ok) {
      io.err(`refused: ${out.reason} — ${out.detail} Nothing was settled.`);
      return EXIT.refused;
    }
    io.out(
      out.how === "open"
        ? `Settled ${out.pair}: open — both memories stay, each shown with the other.`
        : `Settled ${out.pair}: ${out.how} — ${String(out.holds)} holds over ${String(out.over)}.`,
    );
    if (out.faded !== null) io.out(`  ${out.faded.id} fades once (strength ${String(out.faded.before)} → ${String(out.faded.after)}) and is shown as earlier; use can hold it.`);
    if (out.archived !== null) io.out(`  ${out.archived} leaves recall; it stays readable by its id (counterparts ask --id ${out.archived}).`);
    if (out.note !== undefined) io.out(`  ${out.note}`);
    io.out(`  Undo: counterparts settle --undo ${out.pair}`);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/** Who set a mark, in the words `about` prints. */
const ABOUT_BY_WORDS: Record<string, string> = {
  writer: "the writer, when it was written",
  reflection: "a nightly reflection",
  owner: "you",
  upgrade: "the v9 upgrade, by its kind",
  self: "me, awake in a session",
};

/**
 * `about` — what a memory is about, and the owner's door to change it
 * (2026-10-11, the about-marks lane). With an id alone it reads; with a mark
 * it goes through `Counterpart.markAbout` as the owner, which decides
 * everything and refuses under observer. The dashboard's "about" action runs
 * this same command.
 */
function aboutCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const [id, mark, ...rest] = parsed.positional;
  const why = typeof parsed.flags["why"] === "string" ? parsed.flags["why"].trim() : "";
  if (id === undefined || id.trim().length === 0) {
    io.err('refused: name a memory: counterparts about <id> [me|us|owner|work|world] [--why "..."].');
    return EXIT.usage;
  }
  if (rest.length > 0) {
    io.err(`refused: one id and one mark — "${rest.join(" ")}" is more. Put a reason in --why "...".`);
    return EXIT.usage;
  }
  if (mark === undefined) {
    if (why.length > 0) {
      io.err("refused: --why goes with a mark. Pass one, or leave it out.");
      return EXIT.usage;
    }
    const counterpart = openCounterpart(dir, true);
    try {
      // An earlier version reads as the current one, as the write marks it.
      let head = id;
      try {
        head = counterpart.store.resolve(id);
      } catch {
        /* unknown: refused below */
      }
      const row = counterpart.store.row(head);
      if (row === undefined || row.type !== "memory") {
        io.err(`refused: no memory ${id} in this store. Nothing was read.`);
        return EXIT.refused;
      }
      io.out(
        row.about === null
          ? `${head} is unmarked.`
          : `${head} is about ${row.about} — marked by ${ABOUT_BY_WORDS[row.about_by ?? ""] ?? row.about_by ?? "someone unrecorded"}.`,
      );
      if (head !== id) io.out(`  ${id} is an earlier version; this is the current one.`);
      io.out(`  Change it: counterparts about ${head} me|us|owner|work|world --why "..."`);
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  if (observer) {
    io.err("refused: this console is an observer; it reads and changes nothing. Nothing was marked.");
    return EXIT.refused;
  }
  const counterpart = openCounterpart(dir, observer);
  try {
    const out = counterpart.markAbout({ id, mark, by: "owner", why: why.length > 0 ? why : null });
    if (!out.ok) {
      io.err(`refused: ${out.detail} Nothing was marked.`);
      return EXIT.refused;
    }
    const was = out.before === null ? "unmarked" : out.before;
    io.out(
      out.changed
        ? `Marked ${out.id} about ${out.mark} (it was ${was}), as you.`
        : `${out.id} was already about ${out.mark}; it is recorded as yours now.`,
    );
    if (out.forwardedFrom !== undefined) io.out(`  ${out.forwardedFrom} is an earlier version; the current one, ${out.id}, carries the mark.`);
    if (out.why !== null) io.out(`  Why, as recorded: ${out.why}`);
    if (out.note !== undefined) io.out(`  ${out.note}`);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * `core` — what the core holds, and the owner's door out of it (2026-09-26).
 * `--demote` opens the store in the console's stance; `Counterpart.demoteCore`
 * decides everything and refuses under observer.
 */
function coreCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const demote = parsed.flags["demote"];
  const reason = parsed.flags["reason"];
  const reflected = parsed.flags["reflected-feeling"];
  if (reflected !== undefined) {
    if (reflected !== "on" && reflected !== "off") {
      io.err("refused: --reflected-feeling takes on or off.");
      return EXIT.usage;
    }
    if (observer) {
      io.err("refused: this console is an observer; it reads and changes nothing. Nothing was changed.");
      return EXIT.refused;
    }
    const counterpart = openCounterpart(dir, observer);
    try {
      counterpart.store.setMeta(REFLECTED_FEELING_KEY, reflected);
      io.out(
        reflected === "on"
          ? "On: a feeling a reflection records later and a reflection citing a memory both count toward the fast lane, and a reflection may re-label what a memory is about either way — each re-label is recorded with its reason, and one into me, us or the owner is told in the next morning share."
          : "Off: nothing reaches the core on a reflection alone — the fast lane needs a feeling felt at the time (not one a reflection recorded later) and an ordinary use after a gap (not a reflection citing it), and a reflection may only move what a memory is about toward work or world.",
      );
      io.out("  It takes effect at the next consolidation. Nothing already in the core moves.");
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  if (reason !== undefined && typeof demote !== "string") {
    io.err("refused: --reason goes with a --demote. Pass one, or leave it out.");
    return EXIT.usage;
  }
  if (typeof demote === "string") {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      io.err('refused: a demotion needs a reason — --reason "why" — and it is kept with the record.');
      return EXIT.usage;
    }
    const counterpart = openCounterpart(dir, observer);
    try {
      const out = counterpart.demoteCore(demote, { reason, actor: "owner" });
      if (!out.ok) {
        const why: Record<string, string> = {
          observer: "this console is an observer; it reads and changes nothing",
          "unknown-id": `no memory ${demote} in this store`,
          "not-core": `${demote} is not in the core (counterparts core --list shows what is)`,
          "reason-required": "a demotion needs a reason",
        };
        io.err(`refused: ${why[out.reason] ?? out.reason}. Nothing was changed.`);
        return EXIT.refused;
      }
      io.out(`Sent ${demote} back to ordinary fading, from today.`);
      io.out(`  Why, as recorded: ${reason.trim()}`);
      io.out("  It fades like any other memory now, and the core's lanes will not promote it again.");
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  const counterpart = openCounterpart(dir, true);
  try {
    for (const line of coreListLines(counterpart)) io.out(line);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * `claims-era` — the old-claims era's switch (2026-10-10; decided by Mike,
 * 2026-10-10, loosely held). With no flags it reads; `--off` deletes the
 * cutoff the curve reads (`store/operational.ts#CLAIMS_ERA_CUTOFF_KEY`), so
 * every claim reads as stored again — old explicit claims read down and old
 * defaults read up or down alike (2026-10-11); `--on` puts back the cutoff
 * first recorded. The READING is what toggles: a memory the floor prune archived
 * while the era was on stays archived (no door un-archives a `pruned` row).
 * Either takes effect at the next nightly pass (the curve's signature carries
 * the cutoff, so every next-change day is recomputed once).
 */
function claimsEraCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const on = parsed.flags["on"] === true;
  const off = parsed.flags["off"] === true;
  if (on && off) {
    io.err("refused: --on and --off are two different things to do. Pass one.");
    return EXIT.usage;
  }
  if ((on || off) && observer) {
    io.err("refused: this console is an observer; it reads and changes nothing. Nothing was changed.");
    return EXIT.refused;
  }
  const counterpart = openCounterpart(dir, observer || (!on && !off));
  try {
    const store = counterpart.store;
    const day = (ms: number): string => localDate(ms, store.zone());
    if (off) {
      store.updateMeta(CLAIMS_ERA_CUTOFF_KEY, () => null);
      io.out("Off: every claim reads as stored again. No claim was rewritten, so the reading comes back exactly.");
      io.out("  A memory let go at the floor while it was on stays archived (readable by id); turning it off does not bring it back.");
      io.out("  It takes effect at the next nightly pass. `counterparts claims-era --on` puts it back.");
      return EXIT.ok;
    }
    if (on) {
      const recorded = store.claimsEra().recorded;
      if (recorded === null) {
        io.err("refused: this store has no recorded cutoff yet; a writable open records it. Nothing was changed.");
        return EXIT.refused;
      }
      store.setMeta(CLAIMS_ERA_CUTOFF_KEY, String(recorded));
      const era = store.claimsEra();
      io.out(
        `On: memories written before ${day(recorded)} are read at today's default for what they are about — ${String(era.affected)} ${era.affected === 1 ? "memory" : "memories"} now${eraSplit(era)}.`,
      );
      io.out("  It takes effect at the next nightly pass. `counterparts claims-era --off` reads every claim as stored again.");
      return EXIT.ok;
    }
    const era = store.claimsEra();
    if (era.cutoff === null) {
      io.out(
        era.recorded === null
          ? "Off: no cutoff recorded yet (a writable open records one). Every claim reads as stored."
          : `Off: every claim reads as stored. \`counterparts claims-era --on\` reads the ones written before ${day(era.recorded)} at today's default again.`,
      );
      return EXIT.ok;
    }
    io.out(
      `On since ${day(era.cutoff)}: ${String(era.affected)} ${era.affected === 1 ? "memory" : "memories"} written before it ${era.affected === 1 ? "is" : "are"} read at today's default for what ${era.affected === 1 ? "it is" : "they are"} about${eraSplit(era)}. No claim was rewritten.`,
    );
    io.out("  Lower: a claim made under the old text, or an old default above today's. Higher: an old default below today's.");
    io.out("  An explicit claim is kept as claimed for the core, memories about the owner or us, said by the owner, protected, and dated ones still ahead or repeating, and wherever it is already at or below the default.");
    io.out("  `counterparts claims-era --off` reads every claim as stored again.");
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/** The era's two directions, in a clause (2026-10-11): empty when it reads none. */
function eraSplit(era: { affected: number; down: number; up: number }): string {
  return era.affected === 0 ? "" : ` (${String(era.down)} lower than stored, ${String(era.up)} higher)`;
}

/**
 * `self-page` — the owner's door to the written page (2026-09-18, S1).
 *
 * Four modes on one command, and they are the four questions the owner has:
 * what does it say, what did it used to say, what did version N say, and
 * replace it. Every rule about the write is the core seam's
 * (`self/#revisePage`); this decides nothing but which of the four ran.
 *
 * The store is opened in the CONSOLE's stance rather than always as an
 * observer, because `--write` is a real write. A read under observer works, and
 * a `--write` under observer refuses at the seam, which is where every other
 * write refuses (see the note on `OWNER_OPS`).
 */
async function selfPageCommand(
  dir: string,
  io: Io,
  parsed: Parsed,
  observer: boolean,
  namedDir: boolean,
  stdin?: RunOptions["stdin"],
): Promise<number> {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const write = parsed.flags["write"] === true;
  const clear = parsed.flags["clear"] === true;
  const restore = parsed.flags["restore"];
  const wantsVersions = parsed.flags["versions"] === true;
  const seq = parsed.flags["version"];
  // ONE MODE PER INVOCATION. Three of these change the page and two read it;
  // a line that names two of them means something the console would have to
  // guess at, and the store it would guess against is the owner's memory.
  const modes = [write, clear, typeof restore === "string", wantsVersions, typeof seq === "string"];
  if (modes.filter(Boolean).length > 1) {
    io.err(
      "refused: --write, --clear, --restore, --versions and --version are five different things to do. Pass one.",
    );
    return EXIT.usage;
  }
  const ifVersionFlag = parsed.flags["if-version"];
  if (ifVersionFlag !== undefined && !write) {
    io.err("refused: --if-version guards a --write. Pass it with one, or leave it out.");
    return EXIT.usage;
  }
  let ifVersion: number | undefined;
  if (typeof ifVersionFlag === "string") {
    // `none` is the value that says "I read no page", so the guard can be used
    // on a first write as well as an amendment.
    ifVersion = ifVersionFlag.trim().toLowerCase() === "none" ? NO_PAGE_VERSION : Number(ifVersionFlag);
    if (!Number.isInteger(ifVersion) || ifVersion < NO_PAGE_VERSION) {
      io.err(
        `refused: --if-version takes the version number a read printed, or 'none' for a page that was not there, not '${ifVersionFlag}'.`,
      );
      return EXIT.usage;
    }
  }

  // THE SHORT VERSION (2026-10-10): a file, read before the store opens like
  // the page. With --file or --stdin it goes beside the page; alone, it is
  // added to the page as it stands.
  const shortFlag = parsed.flags["short"];
  if (shortFlag !== undefined && (!write || typeof shortFlag !== "string")) {
    io.err("refused: --short <file> is the page's short version, and goes with --write.");
    return EXIT.usage;
  }
  let short: string | null = null;
  if (typeof shortFlag === "string") {
    const read = bodyFrom({ file: shortFlag }, () => "");
    if ("error" in read) {
      io.err(`refused: ${read.error}`);
      return read.missing === true ? EXIT.usage : EXIT.failed;
    }
    short = read.body;
  }
  const shortAlone = short !== null && parsed.flags["file"] === undefined && parsed.flags["stdin"] === undefined;

  // THE PAGE IS READ FROM STDIN BEFORE THE STORE OPENS, so a pipe that never
  // closes cannot leave a store open behind it.
  let body: string | null = null;
  if (write && !shortAlone) {
    const from = parsed.flags["file"];
    const wantsStdin = parsed.flags["stdin"] === true;
    if (typeof from === "string" && wantsStdin) {
      io.err("refused: --file and --stdin both name where the page comes from; pass one.");
      return EXIT.usage;
    }
    if (typeof from !== "string" && !wantsStdin) {
      io.err("refused: --write needs the page: --file <path>, or --stdin.");
      return EXIT.usage;
    }
    if (typeof from === "string") {
      const read = bodyFrom({ file: from }, () => "");
      if ("error" in read) {
        io.err(`refused: ${read.error}`);
        // A missing file is a command line that is wrong; one that is there and
        // will not open is the machine failing, and `EXIT.failed` exists for it.
        return read.missing === true ? EXIT.usage : EXIT.failed;
      }
      body = read.body;
    } else {
      if (stdin === undefined) {
        io.err("refused: this console has no standard input to read the page from.");
        return EXIT.usage;
      }
      if (stdin.isTty) {
        io.err(
          "refused: stdin is a terminal. Pipe the page in (cat page.md | counterparts self-page --write --stdin), or use --file <path>.",
        );
        return EXIT.usage;
      }
      body = await stdin.read();
    }
  }

  let counterpart: Counterpart;
  try {
    counterpart = openCounterpart(dir, observer);
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const cap = counterpart.self.tunables.PAGE_MAX_BYTES;
    const room = counterpart.self.tunables.PAGE_ROOM_BYTES;
    const say = (out: ReturnType<typeof writeLines>): number => {
      for (const line of out.lines) (out.ok ? io.out : io.err)(line);
      return out.ok ? EXIT.ok : EXIT.refused;
    };
    const reason = parsed.flags["reason"];
    const why = (fallback: string): string =>
      typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : fallback;

    if (write && shortAlone) {
      if (counterpart.selfPage() === null) {
        io.err("refused: there is no page to add a short version to. Write the page first (--write --file <path>), with --short beside it.");
        return EXIT.refused;
      }
      return say(
        writeLines(
          counterpart.addPageShort(short ?? "", {
            reason: why("owner added a short version"),
            by: "owner",
            ...(ifVersion === undefined ? {} : { ifVersion }),
          }),
          cap,
          room,
        ),
      );
    }
    if (write) {
      return say(
        writeLines(
          counterpart.revisePage(body ?? "", {
            reason: why("owner edit"),
            by: "owner",
            ...(ifVersion === undefined ? {} : { ifVersion }),
            ...(short === null ? {} : { short }),
          }),
          cap,
          room,
        ),
      );
    }
    if (clear) {
      // The door removal was standing in for. Nothing is destroyed: the body
      // becomes a version, the row stays live with a cleared marker, and the
      // store reads as having no page from the next call on.
      return say(writeLines(counterpart.clearPage({ reason: why("owner cleared the page") }), cap));
    }
    if (typeof restore === "string") {
      const want = Number(restore);
      if (!Number.isInteger(want) || want < 1) {
        io.err(`refused: --restore takes a version seq from 'self-page --versions', not '${restore}'.`);
        return EXIT.usage;
      }
      if (!counterpart.selfPageVersions({ bodies: false }).some((v) => v.seq === want)) {
        io.err(`refused: no version ${want}. 'self-page --versions' lists the ones there are.`);
        return EXIT.usage;
      }
      return say(writeLines(counterpart.restorePage(want, { reason: why(`restored version ${want}`) }), cap));
    }
    if (wantsVersions) {
      for (const line of versionLines(counterpart.selfPageVersions())) io.out(line);
      return EXIT.ok;
    }
    if (typeof seq === "string") {
      const want = Number(seq);
      const found = counterpart.selfPageVersions().find((v) => v.seq === want);
      if (found === undefined) {
        io.err(`refused: no version ${seq}. 'self-page --versions' lists the ones there are.`);
        return EXIT.usage;
      }
      // The header goes to STDERR, so `self-page --version 1 > file` writes the
      // page and nothing else. The owner had to hand-edit it out before, which
      // is half of why `--restore` exists.
      io.err(
        `version ${found.seq} — lived day ${found.day}, ${found.by === null ? "" : `${found.by}: `}${found.reason ?? "(reason unrecorded)"}`,
      );
      for (const line of (found.body ?? "(this version's prose could not be read)").split("\n")) io.out(line);
      return EXIT.ok;
    }
    const page = counterpart.selfPage();
    if (page === null) {
      for (const line of NO_PAGE_LINES) io.out(line);
      return EXIT.ok;
    }
    // COUNTED, not read (m9): printing one number used to read every archived
    // body off disk.
    const lines = pageLines(page, counterpart.self.pageStale(page), counterpart.selfPageVersionCount());
    for (const line of lines) io.out(line);
    return EXIT.ok;
  } finally {
    counterpart.store.close();
  }
}

/**
 * THE STATES A STORE TOO NEW TO GRADE STILL PRINTS (2026-09-20, finding 2).
 *
 * A brand-new store opened this view with twenty-eight `never` lines and no
 * sentence saying why, which is exactly what a broken install looks like. On a
 * store younger than a lived day or two the list narrows to what HAS happened
 * and what was stopped; `never`, `blind` and `new` are all the same fact there
 * — nothing has happened yet — and saying it once is more use than saying it
 * twenty-eight times. The full list comes back on its own, and `--all` prints
 * it today.
 *
 * `disabled` and `retired` are out too, and for a different reason: they are
 * this project's own history — an emotion classifier held back until it clears
 * its precision bar, two mechanisms retired with a parallel run against a
 * system the reader has never heard of. True, worth keeping, and not the first
 * three lines a stranger should meet on day 1.
 */
const YOUNG_STATES: readonly FiredState[] = ["firing", "blocked", "quiet"];

/** The report as plain text: one mechanism per line, grouped by state. */
export function firedLines(report: FiredReport, all = false): string[] {
  const lines = [
    `what has fired — ${report.from}→${report.today}, against ${report.previousFrom}→${report.previousTo}`,
    "",
  ];
  const young = report.young && !all;
  if (young) {
    // "0 calendar days of records" beside a FIRING section that shows three
    // deposits is a strange thing to print (2026-09-20). The reading a person
    // wants on day 1 is how long this has been going, so a store whose oldest
    // row is today says "today" rather than counting zero days.
    const age =
      report.calendarDays === null
        ? "nothing has been recorded here yet"
        : report.calendarDays === 0
          ? "everything it holds was recorded today"
          : `${String(report.calendarDays)} calendar day${report.calendarDays === 1 ? "" : "s"} of records`;
    lines.push(
      `This store is on lived day ${String(report.livedDay)} — ${age}. Most mechanisms have had ` +
        `nothing to do yet, so below is only what HAS fired and anything that was stopped. The ` +
        `full roll-call of ${String(report.rows.length)} comes back on its own once the store is ` +
        "old enough for silence to mean something — or run `counterparts mechanisms --all` now.",
      "",
    );
  }
  // The blocked list FIRST: "it was stopped, and here is by what" is the more
  // actionable of the two, and it is the one that would otherwise be buried
  // inside a group the reader has to scroll to.
  if (report.wentBlocked.length > 0) {
    lines.push(`Fired last week and STOPPED this week: ${report.wentBlocked.join("; ")}`, "");
  }
  // An occasion that came and was not answered (2026-10-09): the one silence
  // among the `waiting` rows that is still a fault, said before the groups.
  if (report.missedOccasion.length > 0) {
    lines.push(`Its occasion came this week and it did not fire: ${report.missedOccasion.join("; ")}`, "");
  }
  if (report.wentQuiet.length > 0) {
    lines.push(`Fired last week and not once this week: ${report.wentQuiet.join("; ")}`, "");
  }
  for (const state of STATE_ORDER) {
    if (young && !YOUNG_STATES.includes(state)) continue;
    const rows = report.rows.filter((r) => r.state === state);
    if (rows.length === 0) continue;
    lines.push(`${state.toUpperCase()} (${String(rows.length)}) — ${STATE_MEANING[state]}`);
    for (const row of rows) {
      const when = row.lastFired === null ? "never" : row.lastFired;
      const refused =
        row.refusedInWindow === 0
          ? ""
          : `  refused ${String(row.refusedInWindow)}${row.topRefusal === null ? "" : ` (${row.topRefusal})`}`;
      lines.push(
        `  ${row.label}`,
        `    last ${when}  ·  7d ${String(row.firedInWindow)}  ·  total ${String(row.total)}${refused}  ·  ${row.evidence}`,
      );
      // The line that turns an absence into a fact: what is missing, and what
      // would fix it. Only the states that HAVE one carry it.
      if (row.note !== null) lines.push(`    ${row.note}`);
    }
    lines.push("");
  }
  const bounds: string[] = [
    `${String(report.rows.length)} mechanisms read; ` +
      STATE_ORDER.map((s) => `${String(report.counts[s])} ${s}`).join(", "),
  ];
  if (report.notRead.length > 0) {
    bounds.push(`Not read on this pass: ${report.notRead.join(", ")}.`);
  }
  if (report.truncated) {
    bounds.push("The event read hit its ceiling, so every total above is a floor, not a count.");
  }
  if (report.probesTruncated) {
    bounds.push("The id scan hit its ceiling, so every table count above is a floor.");
  }
  bounds.push(
    "Events are bounded-retention telemetry: rows past the window are swept unless a replay latch " +
      "holds them, so these are what I still have rather than everything that ever happened.",
  );
  lines.push(...bounds);
  return lines;
}

/** The newest `adapter.boundary` row's calendar date, or null. A census may not
 *  become the thing that throws, and it may not guess either. */
function newestBoundary(store: Store, livedDay: number): string | null {
  try {
    // The newest row itself: `rows.at(-1)` of an ascending read with a limit
    // was the 2,000th-oldest row of the window once it held more.
    const [last] = store.eventLog({
      name: BOUNDARY_EVENT,
      sinceDay: Math.max(0, livedDay - 30),
      order: "desc",
      limit: 1,
    });
    if (last === undefined) return null;
    const payload = JSON.parse(last.payload ?? "{}") as Record<string, unknown>;
    const date = payload["date"];
    return typeof date === "string" && date.length === 10 ? date : localDate(last.at, store.zone());
  } catch {
    return null;
  }
}

/** Is there a written self page, and how old. One line, never a byte of it. */
function pageLine(store: Store): string {
  try {
    const ids = store.list({ type: "schema", kind: "self", archived: false });
    for (const id of ids) {
      const read = store.read(id);
      if (read.doc.meta["role"] !== "page") continue;
      const revised = read.doc.meta["revisedOn"];
      return typeof revised === "string" && revised.length > 0
        ? `yes, last revised ${revised}`
        : "yes";
    }
    return "none yet";
  } catch {
    return "?";
  }
}

/** How old the newest copy of the store is, read off the DIRECTORY rather than
 *  off a row — a row says what a run once wrote, the directory says what you
 *  have (the F2 review's lesson, applied to this line too). */
function snapshotAge(dir: string): string {
  try {
    const resolved = resolveSnapshotsDir(dir, undefined);
    if (resolved.dir === null) return "nowhere to keep one";
    const disk = readSnapshotsDir(resolved.dir);
    const newest = disk.names[disk.names.length - 1];
    return newest === undefined ? "none yet" : `${newest.slice(0, 10)} (${disk.names.length} kept)`;
  } catch {
    return "?";
  }
}

function statusCommand(
  dir: string,
  io: Io,
  namedDir: boolean,
  today: string,
  layout = false,
  // THE ENVIRONMENT, for the layout only (`report.ts`): NO_COLOR, FORCE_COLOR,
  // TERM. Never read from `process.env` down here — a suite that did would pass
  // or fail with the developer's shell (`ui.ts`'s rule). Defaulted so every
  // existing caller and test compiles and gets the plain arm.
  env: Record<string, string | undefined> = {},
): number {
  if (!storeExists(dir)) {
    // An instrument that MINTS a data dir by looking at one is a wart — and
    // since 2026-08-26 the store itself refuses it (INTERFACE-GAPS §7 closed:
    // observer + absent store is STORE_UNINITIALIZED at open). This guard
    // stays for the friendlier sentence.
    //
    // TWO THINGS CHANGED ON 2026-09-04, both from a cold-stranger reading (#11).
    //
    // It exits 1, not 0. "There is no store here" is not a census; a script
    // that asks a store what it holds and gets an answer about nothing at all
    // has not succeeded, and `set -e` around `counterparts status` sailed
    // straight past a typo'd `--dir`. `usage`, not `failed`: nothing broke —
    // the line named a place with no store in it. The sentence goes to stderr
    // for the same reason, because a non-zero exit whose only output was on
    // stdout is half a refusal.
    //
    // And the remedy carries the dir the owner actually typed. `Run
    // 'counterparts init'` after `status --dir /somewhere` would have created
    // the store in the DEFAULT place — not the one the sentence above it just
    // named — which is the worst kind of advice: it works, and it works
    // somewhere else.
    io.err(
      `No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`,
    );
    return EXIT.usage;
  }
  let store: Store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const kinds: Kind[] = ["self", "person", "entity", "skill", "place", "fact"];
    const bands: Band[] = ["episodic", "semantic", "identity"];
    const denied = new Set(store.deniedIds());
    const byKind: Record<string, number> = {};
    const byBand: Record<string, number> = {};
    const permanent: { id: string; title: string; why: string }[] = [];
    // THREE POPULATIONS, THREE LABELS. A single `live` counter that swallowed
    // all of them is how one demo store reported three different sizes on
    // 2026-09-05: the wake preface says `<n> memories` and counts
    // `type: "memory"` rows only (`self/briefing.ts#prefaceLine`,
    // `store.countMemories({ type: "memory", archived: false })`), while this
    // census walked every row and called the total "Live memories" — 143 here
    // against the preface's 121, the difference being exactly the 13 entities
    // and 9 beliefs. Both numbers were right; one of the labels was not.
    let memories = 0;
    let addedToday = 0;
    let schemas = 0;
    let journal = 0;
    let archived = 0;
    let superseded = 0;
    const day = store.livedDay();

    for (const id of store.list()) {
      const row = store.row(id);
      if (row === undefined || denied.has(id)) continue;
      if (row.archived === 1) {
        archived += 1;
        continue;
      }
      if (row.superseded_by !== null) {
        superseded += 1;
        continue;
      }
      // THE JOURNAL IS NOT A MEMORY. `store.list()` returns every row, and
      // episodes are rows — so a census that walks it and counts what is left
      // reports the journal as memories, with a `self` kind and an `episodic`
      // band it never earned. `sleep/types.ts#isJournal` is the one predicate
      // for this; PR #27 threaded it through five sleep phases and the
      // dashboard's census and missed the console. Counted on its own line
      // rather than dropped, because a number that vanished would be the same
      // bug facing the other way (§2.4: what is skipped is said out loud).
      if (isJournal(row)) {
        journal += 1;
        continue;
      }
      if (row.type === "schema") schemas += 1;
      else memories += 1;
      // THE SAME POPULATION, so the two numbers on the page cannot disagree.
      // `countMemories({ learnedOnFrom })` would have been one query and a
      // different census: it counts removed and superseded rows, and reported
      // 2 new beside `Memories: 1` the first time this line was written.
      if (row.learned_on === today) addedToday += 1;
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
      // THE LIVE BAND, computed, never the stored column. Until 2026-09-14
      // `memories.band` was a birth fossil — episodic at mint, identity at
      // promotion, and never "semantic" — so reading it reported
      // `episodic 128 / semantic 0` where the dashboard, which does this
      // arithmetic, reported `54 / 74` (LAUNCH-STATUS §I10). Same helper, same
      // day, same answer. The column is now reconciled by the decay pass (U8,
      // `sleep/decay.ts`), so it agrees after a boundary — and this stays
      // computed anyway, because it must be right BEFORE the first boundary of
      // the day and on a store whose last pass hit its budget.
      let liveBand: Band = row.band;
      try {
        liveBand = band(store.physicsOf(id), day);
      } catch {
        // A row whose physics will not read keeps its recorded band, which is
        // the dashboard's fallback too.
      }
      byBand[liveBand] = (byBand[liveBand] ?? 0) + 1;
      if (row.protected === 1 || row.promoted_identity === 1) {
        let title = "(untitled)";
        try {
          title = store.readProse(id).title ?? "(untitled)";
        } catch {
          title = "(prose unreadable)";
        }
        permanent.push({
          id,
          title,
          why: row.protected === 1 ? "protected" : "promoted to identity",
        });
      }
    }

    // ── THE NUMBERS A PERSON CAME FOR, FIRST (2026-09-20, finding 3) ────────
    //
    // This command is what `install` tells a new user to check with, and until
    // now the four numbers they wanted sat above a ten-line `Layout:` block
    // written for whoever maintains the store — "Box 1", "Box 3",
    // `assertLayout()`, `adapters/expansions.ts`, "§14.1 G9". None of those is
    // a thing the reader has any way to look up, and QUICKSTART §7 never
    // mentioned the block at all. The census leads; the prose follows; the
    // layout is behind `--layout`, where the person who wants it will ask.
    //
    // ── AND ONE READING, TWO LAYOUTS (2026-09-21, new-user finding 5) ───────
    //
    // Every fact is computed ONCE, below, and then written twice: `plain` is the
    // exact `io.out` sequence this command has always produced, kept as strings
    // rather than rebuilt (the only way to promise byte-identity is to keep the
    // bytes), and `blocks` is the same facts as labelled rows for a terminal.
    // `report.ts#printStatusReport` chooses, and a console that is not a
    // terminal never reaches the second one.
    const plain: string[] = [];
    const say = (line: string): void => {
      plain.push(line);
    };
    const lastActive = store.getMeta("lastActiveDate") || "never";
    const lastBoundary = newestBoundary(store, day) ?? "never";
    const removals = store.removalRecord().filter((r) => r.stage === "complete");
    const pageSaid = pageLine(store);
    const snapshotSaid = snapshotAge(store.dir);
    const journalMode = journalModeOf(paths.operational(store.dir));

    say(`Store: ${store.dir}`);
    say("");
    // One line, four labelled populations, and the first number is the one the
    // wake preface says. Anything that adds them into a single "live" total is
    // a surface that will disagree with the briefing the model reads.
    say(
      `Memories: ${memories}` +
        `   Beliefs and entities: ${schemas}` +
        `   Journal: ${journal} ${journal === 1 ? "episode" : "episodes"}` +
        `   Archived: ${archived}   Superseded: ${superseded}`,
    );
    const byKindSaid = kinds.map((k) => `${k} ${byKind[k] ?? 0}`).join("  ");
    const byBandSaid = bands.map((b) => `${b} ${byBand[b] ?? 0}`).join("  ");
    say(`  by kind: ${byKindSaid}   (memories + beliefs and entities)`);
    say(`  by band: ${byBandSaid}   (computed from physics today, not the stored column)`);
    say("");
    say(
      `Today (${today}): ${String(addedToday)} new` +
        `   ·   Lived day ${day}` +
        `   ·   Last active ${lastActive}` +
        `   ·   Last boundary ${lastBoundary}`,
    );
    say(
      `Self page: ${pageSaid}` +
        `   ·   Newest snapshot: ${snapshotSaid}` +
        `   ·   Journal mode: ${journalMode}` +
        `   ·   Removed: ${removals.length}` +
        `   ·   Permanent: ${permanent.length}`,
    );
    // WHERE THIS STORE CAME FROM, when it came from a fresh start (N1). Host
    // state out of box 2's meta table: a date and a path, written once by
    // `start-fresh` and by nothing else, so a store that was simply installed
    // says nothing here rather than something vague. It sits with the other
    // facts ABOUT the store rather than above the census — E2's rule is that
    // the numbers a person came for come first.
    const began = store.getMeta(STORE_STARTED_KEY);
    const previous = store.getMeta(STORE_PREVIOUS_PARKED_KEY);
    const beganSaid =
      began === undefined || began.length === 0
        ? null
        : `${began}${
            previous === undefined || previous.length === 0
              ? "  (a fresh start; nothing was parked)"
              : `   ·   the previous store is parked at ${previous}, untouched`
          }`;
    if (beganSaid !== null) say(`Began: ${beganSaid}`);
    const asides = [
      "Memories is the number the wake preface states; the journal does not decay.",
      "counterparts doctor grades all of this; counterparts mechanisms says which mechanisms are working.",
    ];
    say("");
    for (const aside of asides) say(`  ${aside}`);

    const tail: { title: string; lines: string[] }[] = [];
    if (removals.length > 0) {
      // Owner side: the id and the date, no body and no content hash — ever.
      const rows = removals.map(
        (row) => `  ${localDate(row.at, store.zone())}  ${row.memory_id}  by ${row.actor}`,
      );
      tail.push({ title: "Removed:", lines: rows });
      say("");
      say("Removed:");
      for (const line of rows) say(line);
    }
    if (permanent.length > 0) {
      const rows = permanent.map((entry) => `  ${entry.id}  ${entry.title}  — ${entry.why}`);
      tail.push({ title: "Permanent (enumerable on demand, §14.1 G9):", lines: rows });
      say("");
      say("Permanent (enumerable on demand, §14.1 G9):");
      for (const line of rows) say(line);
    }
    if (layout) {
      const rows = LAYOUT.map((entry) => {
        const present = existsSync(join(store.dir, entry.name)) ? " " : "-";
        return `  ${present} ${entry.backup ? "backed up" : "excluded "}  ${entry.name}  — ${entry.why}`;
      });
      tail.push({ title: "Layout:", lines: rows });
      say("");
      say("Layout:");
      for (const line of rows) say(line);
    }

    const blocks: StatusBlock[] = [
      {
        title: "Memory",
        rows: [
          { label: "Memories", value: String(memories) },
          { label: "Beliefs and entities", value: String(schemas) },
          { label: "Journal", value: `${journal} ${journal === 1 ? "episode" : "episodes"}` },
          { label: "Archived", value: String(archived) },
          { label: "Superseded", value: String(superseded) },
          { label: "by kind", value: byKindSaid, verbatim: true },
          { label: "by band", value: byBandSaid, verbatim: true },
        ],
        notes: [
          "by kind counts memories and beliefs and entities together.",
          "by band is computed from physics today, not from the stored column.",
        ],
      },
      {
        title: `Today — ${today}`,
        rows: [
          { label: "New today", value: String(addedToday) },
          { label: "Lived day", value: String(day) },
          { label: "Last active", value: lastActive },
          { label: "Last boundary", value: lastBoundary },
        ],
      },
      {
        title: "This store",
        rows: [
          { label: "Self page", value: pageSaid },
          { label: "Newest snapshot", value: snapshotSaid },
          { label: "Journal mode", value: journalMode },
          { label: "Removed", value: String(removals.length) },
          { label: "Permanent", value: String(permanent.length) },
          ...(beganSaid === null ? [] : [{ label: "Began", value: beganSaid }]),
        ],
      },
    ];
    const view: StatusView = { plain, dir: store.dir, blocks, notes: asides, tail };
    printStatusReport(io, env, view);
    // A STORE THAT NO SESSION CAN OPEN DOES NOT GET A GREEN CENSUS.
    //
    // `status` opens a `Store`, not a `Counterpart`, so it never runs
    // `Schemas.load` — which is what meets a faulted row and stands the session
    // down. Reviewer B hand-made the fault and watched `status` print a
    // completely normal summary and exit 0 while every session was dead
    // (MAJOR-3). The census above is still printed, because it is true; what
    // changes is that the fault is said and the exit is not success.
    const faulted = store.faultedIds();
    if (faulted.length > 0) {
      io.out("");
      io.err(
        `Rows whose words are missing: ${String(faulted.length)} — ${faulted.slice(0, 5).join(", ")}` +
          (faulted.length > 5 ? ` and ${String(faulted.length - 5)} more` : "") +
          ". Every session stands down on a store that holds one. Run: counterparts doctor.",
      );
      return EXIT.failed;
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}

// ── install ─────────────────────────────────────────────────────────────────

/**
 * The cold start. It writes the two things that are OURS — the store and the
 * adapter's configuration beside it — and PRINTS the two that belong to the
 * host.
 *
 * The refusal direction matters more than the happy path: an existing
 * configuration is KEPT and reported, never merged and never silently
 * rewritten, because the file it would rewrite is the one pointing at somebody's
 * live memory. `--force` is the only way past that, and it says so.
 */
function installCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  home?: string,
  named?: ConfigChoice,
  /**
   * THE HOST'S TWO STEPS, printed by default and skipped by exactly one caller.
   *
   * `start-fresh` re-uses this whole command to create its blank store — that is
   * the "invent no second install path" rule — but step 2, "register the MCP
   * server", is FALSE on that path: the store lands at the path the
   * registration already names, so there is nothing to re-register. Printing it
   * anyway would teach the owner to run a command he does not need on the one
   * day he is most likely to follow instructions literally. So the tail is
   * separable, and that caller prints its own three lines instead.
   */
  opts: {
    hostSteps?: boolean;
    nameAlreadySaid?: boolean;
    quiet?: boolean;
    /** False for the conversational arm, which has already ASKED about a
     *  parked memory (`offerParkedMemory`) and must not say it twice. */
    parkedNotice?: boolean;
    /** True for the conversational arm: a configuration this call CREATES
     *  gets the local embedder switched on when no flag said otherwise. */
    defaultEmbedder?: boolean;
  } = {},
): number {
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  // A configuration at a NON-DEFAULT LOCATION moves the whole base — config and
  // the default store beneath it (`install.ts#installLayout`).
  // The test is the PATH, not how it was named: `--config` spelling out the
  // default path is the default install, and printing a flag for it (with a
  // sentence saying it is "NOT at" the path it is at) would be false.
  const home_ = home ?? homedir();
  const custom =
    named !== undefined &&
    named.source !== "default" &&
    resolve(named.path) !== defaultConfigPath(home_)
      ? named.path
      : undefined;
  const layout = installLayout(dirFlag, env, home_, custom);
  // Before a single directory: a store that would hold its own configuration is
  // a store that never opens again.
  const refusal = layoutRefusal(layout);
  if (refusal !== null) {
    io.err(refusal);
    return EXIT.refused;
  }
  // And before that: the DEFAULT configuration is never written pointing at a
  // throwaway store (`install.ts#throwawayDefaultRefusal`). That is the shape
  // the 2026-09-04 incident took — the live `claude-code.json` rewritten with a
  // temp `dataDir`, three days of memory recorded nowhere. Independent of the
  // explicit-dir guard on purpose: the incident happened in a shell that had
  // neither the guard nor the home mock, so a refusal that needed either would
  // not have been there.
  const throwaway = throwawayDefaultRefusal(layout, env, home_);
  if (throwaway !== null) {
    io.err(throwaway);
    return EXIT.refused;
  }

  // A PARKED MEMORY IS NAMED HERE TOO, AND ONLY NAMED (review M4).
  //
  // `offerParkedMemory` asks — and it is interactive-only, so a pipe, a script,
  // CI, `--yes` and `--no-connect` at a terminal all walked past a parked
  // folder, made a blank store beside it, and said nothing at all. That is the
  // hazard this feature's own docstring names ("a second store the person does
  // not know about"), reached by the one arm that had no words for it.
  //
  // PRINTED RATHER THAN REFUSED, deliberately. A refusal would change what a
  // scripted caller's exit code means, on a path that has worked since day one
  // — `tools/install-loop/run.sh` and every CI job install into a fresh home —
  // and it would make a folder this command never touches able to stop it. Four
  // lines of stdout cannot surprise anybody; a new non-zero exit can. Nothing
  // below writes, renames or opens anything.
  if (opts.parkedNotice !== false && !existsSync(layout.base)) {
    const found = parkedSiblings(layout.base, home_);
    if (found.length > 0) {
      io.out(`Memory was set aside beside ${tilde(layout.base, home_)} and is NOT being brought back:`);
      for (const one of found) {
        io.out(
          `  ${tilde(one.path, home_)}  ${one.refusal === null ? humanDiskBytes(one.bytes) : "(cannot be brought back — run install at a terminal for the reason)"}`,
        );
      }
      io.out("This makes a SECOND, blank store beside it. To bring that one back instead,");
      io.out(`run \`${BIN.cli} install\` at a terminal: it asks first, and moves nothing on its own.`);
      io.out("");
    }
  }

  let budgetBytes: number | undefined;
  const budgetFlag = parsed.flags["budget"];
  if (typeof budgetFlag === "string" && budgetFlag.length > 0) {
    // The rule lives in `install.ts` so a caller can ask it BEFORE it acts
    // (N1 review M1 — this refusal used to land after two renames).
    const why = budgetRefusal(budgetFlag);
    if (why !== null) {
      io.err(why);
      return EXIT.refused;
    }
    budgetBytes = Number(budgetFlag);
  }
  const name = typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined;
  const force = parsed.flags["force"] === true;
  // RECALL BY MEANING, ON OR OFF — and only the local table (roadmap C3).
  //
  // `--embedder` turns it on, `--no-embedder` leaves it off, and the terminal
  // arm passes `defaultEmbedder` so a configuration it CREATES has it on
  // without a question (the table sends nothing anywhere, so there is no
  // egress to consent to). Nothing said → nothing written, and a forced
  // re-install carries the old block forward untouched — and a file with no
  // block reads as the table ON at runtime anyway
  // (`config.ts#resolveEmbedder`). Both flags at once is a line that
  // contradicts itself, and it is refused before anything exists.
  const embedderOn = parsed.flags["embedder"] === true;
  const embedderOff = parsed.flags["no-embedder"] === true;
  if (embedderOn && embedderOff) {
    io.err("refused: --embedder and --no-embedder were both given. Pick one; nothing was written.");
    return EXIT.usage;
  }
  const embedderSaid: boolean | undefined = embedderOn
    ? true
    : embedderOff
      ? false
      : opts.defaultEmbedder === true && !existsSync(layout.config)
        ? true
        : undefined;

  // The store first, and through `Store` itself, so the forbidden-root guard
  // runs before a single directory is created (scar §2.13).
  const existed = storeExists(layout.store);
  let store: Store;
  try {
    store = openStoreAt({ dir: layout.store });
  } catch (err) {
    io.err(prefixedRefusal(describeDirRefusal(err, layout.store)));
    return EXIT.refused;
  }
  const resolved = store.dir;
  store.close();

  // SEED THE CORE NOW, not at the first hook. `install` used to write the name
  // into the config and stop there — `openAdapter` passes `config.identity` to
  // `Counterpart.open`, so the core appeared only when a session first fired.
  // Two things were wrong with that. §3 says "It seeds the identity core" of a
  // command that had not yet; and `init --name` DID seed it immediately, so the
  // two commands the same page calls interchangeable produced different stores
  // (found 2026-09-04, when a captured recall reproduced one row higher than
  // the page said). Same door as `init`: `Counterpart.open`'s own option, which
  // is an ENSURE, so the hook's later call finds it and mints nothing.
  let seeded = false;
  if (name !== undefined && name.length > 0) {
    const brain = openCounterpart(resolved, false, { name });
    try {
      seeded = true;
    } finally {
      brain.close();
    }
  }

  // `--force` MAY NOT BLANK A SETTING (adversarial review B1, 2026-09-22) — the
  // argument the credentials file carried from I32 until it was removed,
  // applied to the configuration.
  //
  // The old comment below says "a config is regenerable from this command's own
  // flags". That is true only if the flags were all TYPED, and on a re-install
  // they are not: `configObject` writes `identity` only from `--name` and
  // `embedder` only from `--embedder`, so `install --force` over a working
  // install dropped the owner's name, a running third-party egress opt-in and a
  // ceiling somebody chose — silently, and on the restore path one line after
  // the screen said the parked folder came back untouched.
  //
  // So a forced write CARRIES FORWARD what the file already said, and only for
  // keys this command line did not supply: a flag still wins, and `dataDir`,
  // which this install resolved itself, is never taken from the old file,
  // because moving an install is exactly what `--force` is for. What was kept
  // is SAID, below, on both arms.
  // The block is decided against the file being REPLACED (`resolveEmbedderBlock`),
  // read before anything below writes.
  const embedderBlock = resolveEmbedderBlock({
    enabled: embedderSaid,
    configPath: layout.config,
  });
  const carried = force
    ? carryForward(layout.config, {
        budget: budgetBytes !== undefined,
        name: name !== undefined && name.length > 0,
        embedder: embedderBlock !== undefined,
      })
    : {};
  const body = configObject({
    layout,
    ...(budgetBytes === undefined ? {} : { budgetBytes }),
    ...(name === undefined ? {} : { name }),
    ...(embedderBlock === undefined ? {} : { embedder: embedderBlock }),
    carried,
  });
  const config = writeOnce(layout.config, `${JSON.stringify(body, null, 2)}\n`, { force });
  // THE STORE STEP IS SILENT ON THE CONVERSATIONAL ARM (2026-09-22, item 10).
  //
  // A person installing a memory layer did not ask to be shown three files
  // being created; the screen the owner signed off on says one thing about all
  // of it, at the end: "Your memory lives at ~/.counterparts." So the ROUTINE
  // lines go through `say`, which the interactive caller silences.
  //
  // WHAT IS NEVER SILENCED: a warning, and a refusal. `io.err` is untouched,
  // and the facts a reader would act on — a replaced configuration, and a
  // `--dir` that moved the store away from the configuration — print on both
  // arms. Quiet means fewer receipts, never a fact withheld.
  const say = opts.quiet === true ? (_line: string): void => {} : (line: string): void => { io.out(line); };
  say(existed ? `Store already present at ${resolved}.` : `Created a store at ${resolved}.`);
  // **A REPLACED CONFIGURATION IS NOT A ROUTINE RECEIPT** (review B1). Creating
  // one, or keeping one, is bookkeeping; OVERWRITING the file the hooks, the
  // worker and the MCP server all read is a fact a reader would act on, and the
  // rule stated above is "quiet means fewer receipts, never a fact withheld".
  // So this one line goes to `io.out` on both arms, and names what survived.
  if (config.what === "replaced") {
    io.out(`  replaced ${config.path}`);
    const kept = Object.keys(carried);
    if (kept.length > 0) {
      io.out(`    kept from the file it replaced: ${kept.join(", ")}.`);
      io.out("    A flag on this line would have won; none was given for those.");
    }
  } else {
    say(`  ${config.what} ${config.path}`);
  }
  // The SAME sentence `init` prints, because the two commands did the same
  // thing: a page that calls them interchangeable and then has them say it
  // differently has made the reader do the comparison.
  // The conversation (`installInteractive`) has already said this, one step up, in
  // the person's own answer; saying it twice is the wall of text the owner named.
  if (seeded && opts.nameAlreadySaid !== true) {
    say(`  identity core seeded for ${name ?? ""} — the thing this memory is about.`);
  }
  if (!isWithin(layout.base, resolved)) {
    // --dir moved the STORE. It does not move the configuration: the hooks read
    // the default path unless something NAMES another one (--config, else
    // COUNTERPARTS_CONFIG), and a hook that finds no config stands down and
    // exits 0 — so a config nothing points them at is a silence nobody debugs.
    // Said out loud rather than left for the reader to discover from an ambient
    // half that never fires.
    io.out("");
    io.out(`  --dir moved the STORE only. The configuration stays at ${config.path}:`);
    io.out(
      custom === undefined
        ? "  that is the path the hooks read when nothing names another one,"
        : `  and the printed lines below name it with ${CONFIG_FLAG} / ${CONFIG_ENV},`,
    );
    io.out(`  and it points at your store with "dataDir": "${resolved}".`);
  }
  if (config.what === "kept") {
    say("  (an existing file is never rewritten — pass --force to replace it)");
  }
  if (budgetBytes === undefined) {
    say("");
    say('  NO "injectionBudgetBytes" was written: nobody told us this host\'s ceiling');
    say("  and this package invents none (scar §2.18). Re-run with --budget <bytes>,");
    say(`  or add the key to ${config.path}.`);
  }

  if (opts.hostSteps !== false) printHostSteps(io, resolved, custom, home_);
  return EXIT.ok;
}

/**
 * WHAT A FORCED WRITE KEEPS FROM THE CONFIGURATION IT IS REPLACING (B1).
 *
 * The keys this command can write but cannot RE-DERIVE: `identity` comes only
 * from `--name`, `embedder` only from `--embedder`, and the ceiling only from
 * `--budget`. A re-install that passes none of the three is the ordinary case —
 * the owner's own 0.2.0 trial is one — and before this the three were simply
 * gone, with nothing on screen.
 *
 * Two rules in the shape of it:
 *
 *   - **A flag always wins.** A key the command line supplies is not carried,
 *     so there is no merge and no precedence to get wrong later.
 *   - **`dataDir` is NEVER carried.** This install resolved it
 *     (`installLayout`), and `--force` over a config that names somewhere else
 *     is exactly how an install is moved. Carrying it would make the move
 *     silently not happen.
 *   - **Settings this build no longer reads are not carried either** —
 *     `credentialsFile`, `models`, `crashWriteUp`, `stopAskShape` (the keys
 *     were removed on 2026-09-24). A rewrite is the natural moment to let them go.
 *
 * It reads the file with `JSON.parse` rather than `loadConfig`: what is wanted
 * is what the file SAID, key for key, not what a loader makes of it — an
 * unreadable or non-object file carries nothing, which is the same answer the
 * ordinary write path gives it.
 */
export function carryForward(
  configPath: string,
  supplied: { budget: boolean; name: boolean; embedder: boolean },
): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const was = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Every key the file holds that is NOT one of the four this command resolves
  // or is being given. Anything an owner added by hand is in here too, which is
  // the point: `--force` was typed to fix a config, not to normalise it.
  for (const [key, value] of Object.entries(was)) {
    if (key === "dataDir" || key === "owner") continue;
    if (key === "credentialsFile" || key === "models" || key === "crashWriteUp" || key === "stopAskShape") continue;
    if (key === "injectionBudgetBytes" && supplied.budget) continue;
    if (key === "identity" && supplied.name) continue;
    if (key === "embedder" && supplied.embedder) continue;
    out[key] = value;
  }
  return out;
}

/**
 * The two steps that belong to the HOST, printed and never applied — split out
 * of `installCommand` so the one caller they are false for can skip them
 * (2026-09-20, N1). Nothing here writes anything.
 */
function printHostSteps(io: Io, resolved: string, custom: string | undefined, home_: string): void {
  io.out("");
  io.out("Two steps left, and they are the HOST'S files, so they are printed, not applied.");
  io.out("Nothing below has been written and no host configuration was read.");
  io.out("");
  io.out("  1. Merge this into ~/.claude/settings.json (one script, five events):");
  io.out("");
  for (const line of settingsBlock(hookCommand(custom)).split("\n")) io.out(`     ${line}`);
  io.out("");
  io.out("     The runtime and the script are ABSOLUTE on purpose. A host's process");
  io.out("     environment is not your login shell's, so");
  io.out(`     '${BIN.hook}' on a PATH that lacks the runtime is a`);
  io.out("     hook that never runs and says nothing.");
  io.out("");
  io.out("  2. Register the MCP server, so remember, recall and session_end exist:");
  io.out("");
  io.out(`     ${mcpCommand(resolved, undefined, custom)}`);
  io.out("");
  // THE FLAG IS PRINTED ONLY WHEN IT IS NEEDED, and when it is, the output says
  // why — otherwise a reader learns the wiring as "hooks take a --config", which
  // is exactly the sentence this rule does not want them to carry away. The
  // default path IS the rule (`adapters/config-path.ts`).
  if (custom !== undefined) {
    io.out(`  Both lines carry this install's configuration, because it is NOT at`);
    io.out(`  ${defaultConfigPath(home_)} — the path all four entry points`);
    io.out(`  read when nobody says otherwise. The hook takes it as ${CONFIG_FLAG} <path>; the`);
    io.out(`  server takes it as ${CONFIG_ENV}, because this host launches MCP servers`);
    io.out("  from a static registration with no command line to write into.");
    io.out("");
  }
  // `doctor`, not `status --dir`: doctor is the "does it work" check on every
  // page since 2026-09-22, and it reads the configuration the hooks read.
  io.out(
    `  Then restart Claude Code, and check it with: ${BIN.cli} doctor${custom === undefined ? "" : ` --config ${custom}`}`,
  );
  io.out("  An MCP server keeps the code it was launched with: after an upgrade, restart");
  io.out("  every open session or the old server keeps serving.");
  io.out("");
  io.out(`  Or have it done for you: ${BIN.cli} connect`);
}

// ── install, as a short conversation ────────────────────────────────────────

/**
 * The same install, with a person in the room.
 *
 * **Everything about the files is `installCommand`'s, unchanged.** This wraps
 * it: it asks for a name, hands the same flags to the same function, connects
 * the host and ends on two lines. There is deliberately
 * no second code path that creates a store — that is the rule `start-fresh`
 * already follows ("invent no second install path"), and it is what keeps the
 * refusals (`layoutRefusal`, `throwawayDefaultRefusal`) true on this arm
 * without being restated.
 *
 * Reached only when `ui.ts#isInteractive` says there is a person who can
 * answer: stdin AND stdout are terminals, `CI` is unset, this console has a
 * prompt, and `--no-connect` was not passed. Everything else — a pipe, a
 * script, `tools/install-loop/run.sh`, every test in the suite — goes to
 * `installCommand` and gets today's bytes.
 *
 * ── WHAT 2026-09-22 CHANGED, AND WHY (the owner's items 9, 10, 11) ──────────
 *
 *   - **No step numbers.** `[1/4]` counted questions the person had not asked
 *     to be asked. The screen is now five short exchanges with blank lines
 *     between them.
 *   - **Claude Code is connected BY DEFAULT**, not offered. Ruling 1 of 09-21
 *     ("wire by default, after asking first") is replaced: a person who typed
 *     `install` has asked. `--no-connect` and every scripted console still get
 *     the printed blocks and no edit at all, which is the half that must not
 *     move.
 *   - **The store step is silent** (`quiet`), and says one thing at the end.
 *   - **`install` is the undo of `uninstall --park`**: before anything else, a
 *     parked folder beside the configuration directory is offered back.
 *
 * THE RE-RUN IS THE SECOND MOST COMMON PATH and reads as one: a store that is
 * already there greets you instead of asking your name again, and a connection
 * that is already in place says so instead of being redone.
 */
/**
 * `install --host claude-desktop` (2026-09-30, brief item 7). The store and
 * the configuration exactly as the scripted install makes them — kept when they
 * exist, as always — and then, instead of Claude Code's hooks and `claude mcp
 * add`, a `counterparts` entry merged into Claude Desktop's own config file
 * (`desktop.ts#connectDesktop`: backed up first, every other server left as it
 * was, nothing written at all when the same entry is already there). The
 * Desktop file is found under the home directory this command was given, never
 * `os.homedir()` behind its back.
 */
function installDesktop(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  home: string | undefined,
  named: ConfigChoice | undefined,
  now: () => number,
): number {
  const home_ = home ?? homedir();
  const unavailable = desktopUnavailable(process.platform, home_);
  if (unavailable !== null) {
    io.err(unavailable);
    return EXIT.refused;
  }
  const code = installCommand(parsed, io, env, home_, named, { hostSteps: false });
  if (code !== EXIT.ok) return code;
  const custom = customConfigPath(named, home_);
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  const layout = installLayout(dirFlag, env, home_, custom);
  const store = hostConfigFor(layout.config).config.dataDir ?? layout.store;
  const result = connectDesktop({
    home: home_,
    store,
    exe: process.execPath,
    ...(custom === undefined ? {} : { configPath: custom }),
    now: now(),
  });
  io.out("");
  switch (result.outcome) {
    case "already":
      io.out(`Claude Desktop: already connected — ${tilde(result.path, home_)} has this entry, and nothing was changed.`);
      return EXIT.ok;
    case "added":
    case "updated":
      io.out(`Claude Desktop: ${result.outcome === "added" ? "connected" : "entry updated"} in ${tilde(result.path, home_)}.`);
      // A REPLACED ENTRY THAT NAMED ANOTHER STORE IS NAMED (review of #294):
      // Desktop's memory moves with this line, and the old one is not gone.
      if (result.previousStore !== undefined && result.previousStore !== null && result.previousStore !== store) {
        io.out(`  It named another store before: ${result.previousStore} — that memory is still there; Desktop now uses ${store}.`);
      }
      if (result.backup !== null) io.out(`  backed up first: ${result.backup}`);
      io.out("  Every other server in that file was left as it was.");
      // Desktop rewrites its own config file while it runs, so a change made
      // under a running Desktop can be written over.
      io.out("If Claude Desktop was open while this ran, quit it and run this again — it rewrites its own config file while it runs.");
      io.out("Then open Claude Desktop. In a new chat, ask it to call the counterparts wake tool first (or pick the \"Start with Counterparts\" prompt where Desktop lists it).");
      // MEASURED 2026-10-02: a chat whose tools still asked permission never
      // called `wake`, answered from recall alone, and called that the full
      // record. Doctor cannot see the setting, so this says it.
      io.out(DESKTOP_ALWAYS_ALLOW);
      io.out(`Then run \`${BIN.cli} doctor\`: its Claude Desktop line shows the entry, and the last wake once there has been one.`);
      return EXIT.ok;
    case "refused":
      io.err(result.detail ?? "refused");
      return EXIT.refused;
    default:
      io.err(`Claude Desktop's config could not be written: ${result.detail ?? "unknown"}${result.backup === null ? "" : ` (a backup was taken first: ${result.backup})`}.`);
      return EXIT.failed;
  }
}

async function installInteractive(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
  now: () => number,
): Promise<number> {
  // CTRL-C (and, since 2026-09-22, Esc) IS NOT AN ANSWER, at ANY of this
  // conversation's questions (review m4). It used to end the process silently
  // with exit 0 — at the name prompt nothing existed yet, at the wire question
  // the store and the config both did, and a `&&`
  // chain read that zero as "installed". Every prompt reports from the
  // FILESYSTEM rather than from a flow that was abandoned halfway, which is
  // also what makes it true either side of the parked folder's one rename.
  try {
    return await installConversation(parsed, io, env, opts, named, now);
  } catch (err) {
    if (!isPromptAborted(err)) throw err;
    const home = opts.home ?? homedir();
    const custom = customConfigPath(named, home);
    const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
    const layout = installLayout(dirFlag, env, home, custom);
    const u = ui(io, env);
    u.blank();
    u.fail("stopped; nothing else was changed.");
    u.hint(
      storeExists(layout.store) ? `Your store is at ${layout.store}.` : "No store was created.",
    );
    if (existsSync(layout.config)) u.hint(`Its configuration is ${layout.config}.`);
    u.hint(`Run \`${BIN.cli} install\` again whenever you like; it picks up where this left off.`);
    return EXIT.refused;
  }
}

async function installConversation(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
  now: () => number,
): Promise<number> {
  const home_ = opts.home ?? homedir();
  const u = ui(io, env);
  const custom = customConfigPath(named, home_);
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  const layout = installLayout(dirFlag, env, home_, custom);

  u.heading(`${BIN.cli} install`);
  u.blank();

  // ── a memory that was set aside ───────────────────────────────────────────
  //
  // FIRST, before the name question: everything below reads differently once a
  // parked folder is back in place, and asking somebody their name and then
  // discovering their memory is the wrong order to meet a stranger in.
  if ((await offerParkedMemory(io, u, layout, home_)) === "stopped") return EXIT.refused;

  // ── the name ──────────────────────────────────────────────────────────────
  //
  // ASKED AFTER THE PARKED BRANCH, never before it: a folder that just came
  // back holds a store and an identity core, and a run that had already decided
  // "there is nothing here" would ask a returning owner his name and then try
  // to seed a core into a store that has one.
  const already = storeExists(layout.store);
  const flags: Record<string, string | boolean | undefined> = { ...parsed.flags };
  let name = typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined;
  if (already) {
    // THE NAME COMES OUT OF THE CONFIGURATION, not out of the store. It is the
    // same value `openAdapter` hands `Counterpart.open` as `identity`, so it IS
    // the core's name for every store this command made — and reading it costs
    // no `Store.open` at all, which matters most on the path where the store was
    // a parked folder thirty lines ago.
    const known = hostConfigFor(layout.config).config.identity?.name;
    io.out(known === undefined || known.length === 0 ? "Welcome back." : `Welcome back, ${known}.`);
    // A `--name` HERE CHANGES NOTHING, AND SAYS SO (review m2). The identity
    // core is an ENSURE — `Counterpart.open` keeps the name it has — and the
    // configuration is kept, so the flag was accepted, ignored, and invisible.
    // A flag that is silently dropped is one somebody re-passes forever.
    if (name !== undefined && name.trim().length > 0 && name.trim() !== known) {
      u.hint(
        known === undefined || known.length === 0
          ? `--name was not used: this memory already exists, and a name is only seeded when one is made.`
          : `--name was not used: this memory is already called ${known}.`,
      );
    }
  } else if (name !== undefined && name.trim().length > 0) {
    io.out(`Nice to meet you, ${name.trim()}.`);
  } else {
    const answer = (await ask(io, "What should this memory call you?")).trim();
    if (answer.length === 0) {
      name = undefined;
      delete flags["name"];
      u.hint("No name, so no identity core — the wake will have nothing to be about.");
      u.hint(`Add one later with: ${BIN.cli} init --dir ${layout.store} --name "<your name>"`);
    } else {
      name = answer;
      flags["name"] = answer;
      io.out(`Nice to meet you, ${answer}.`);
    }
  }
  // THE ZONE, SAID ONCE AND NOT ASKED (docs/time.md rule 2, 2026-09-25): times
  // follow the computer, so there is nothing to answer — but a person should
  // see which clock their memory will read, and how to pin another.
  const zoneSet = hostConfigFor(layout.config).config.timeZone;
  u.hint(
    zoneSet === undefined
      ? `Times read in ${resolveZone(undefined)}, this computer's zone — "timeZone" in the config pins another.`
      : `Times read in ${zoneSet}, as the config's "timeZone" says.`,
  );
  u.blank();

  // ── the store and the configuration — SILENTLY ────────────────────────────
  //
  // THE CEILING GETS A NUMBER ON THIS ARM ONLY. Scar §2.18 says this package
  // invents no host ceiling, and nothing about that changes for a script: the
  // non-interactive arm still ends on its "NO injectionBudgetBytes was written"
  // paragraph. What changes here is that there is a person, and the sentence
  // explaining the knob moved off this screen into `help install` (item 10) — a
  // number that works is worth more to a stranger than a paragraph of homework.
  // A `--budget` on the line still wins.
  //
  // AND IT IS INJECTED ONLY WHEN THE CONFIGURATION IS BEING CREATED (review
  // B1). An injected default is a value nobody typed, so on a forced re-install
  // it counted as "supplied", beat the carry-forward, and rewrote a ceiling
  // somebody had chosen back to 9000 — the same failure as the one the carry
  // exists to prevent, arriving through the fix for it.
  const suppliedBudget =
    typeof parsed.flags["budget"] === "string" ? parsed.flags["budget"] : undefined;
  if (suppliedBudget === undefined && !existsSync(layout.config)) {
    flags["budget"] = String(DEFAULT_BUDGET_BYTES);
  }
  const configExisted = existsSync(layout.config);
  const code = installCommand({ command: "install", positional: [], flags }, io, env, home_, named, {
    hostSteps: false,
    nameAlreadySaid: true,
    quiet: true,
    // This arm ASKED, a few lines up. The scripted arm's notice would repeat
    // the answer back at somebody who has just given it.
    parkedNotice: false,
    // RECALL BY MEANING IS ON FOR A PERSON'S NEW INSTALL (roadmap C3). The
    // local table sends nothing anywhere, so there is no egress to ask about
    // and no question on this screen; `--no-embedder` still says no. Only a
    // configuration being CREATED gets it — a re-run keeps the file it finds,
    // like every other key in it (the budget default above, same rule).
    defaultEmbedder: true,
  });
  if (code !== EXIT.ok) return code;
  // AN EMBEDDER FLAG OVER A KEPT CONFIGURATION CHANGES NOTHING, AND SAYS SO —
  // the rule `--name` follows above. Rule 2 keeps the file; the scripted arm's
  // "(an existing file is never rewritten…)" receipt is silenced on this arm,
  // so without this line the flag would be accepted, ignored and invisible.
  if (
    configExisted &&
    parsed.flags["force"] !== true &&
    (parsed.flags["embedder"] === true || parsed.flags["no-embedder"] === true)
  ) {
    u.hint(
      `${parsed.flags["embedder"] === true ? "--embedder" : "--no-embedder"} was not used: this configuration already exists and is kept. ` +
        `\`${BIN.cli} install --force ${parsed.flags["embedder"] === true ? "--embedder" : "--no-embedder"}\` rewrites it, keeping every other setting.`,
    );
  }

  // ── Claude Code ───────────────────────────────────────────────────────────
  //
  // The store the server is told about is read back OUT OF THE FILE that was
  // just written, never re-derived: `install` resolves the path through
  // `Store.open`, so the configuration is the one thing that knows where the
  // store actually landed.
  const config = hostConfigFor(layout.config).config;
  const store = config.dataDir ?? layout.store;
  const spawner = opts.spawner ?? realSpawner(env);
  const lister = opts.processes ?? realProcessLister(env);
  let wired: WireResult | null = null;
  if (!claudeCodeHere(home_, env, spawner)) {
    // NOT AN ERROR AND NOT A REFUSAL (item 9: "say so, move on"). Everything
    // this command actually owns — the store and the configuration — is done, and the one part that needs somebody else's
    // program can be done the day they have it.
    io.out("Claude Code is not on this machine, so there was nothing to connect.");
    u.hint(`When you have it, run \`${BIN.cli} connect\`.`);
  } else {
    io.out("Connecting Claude Code…");
    // `yes: true` because THE QUESTION IS GONE. Connecting is what `install`
    // does now; the opt-out is `--no-connect`, which never reaches this arm at
    // all — it makes the console non-interactive one level up.
    wired = await wire({
      io,
      env,
      home: home_,
      configPath: layout.config,
      custom,
      store,
      now: now(),
      yes: true,
      dryRun: false,
      exe: process.execPath,
      spawner,
      lister,
      heading: false,
    });
    if (wired.hooks === "declined" || wired.outcome !== "ok") {
      u.hint("Your store is made either way; connecting is the only part not done.");
      u.hint(`You can do it later with: ${BIN.cli} connect`);
    }
  }
  // CLAUDE DESKTOP'S ENTRY, REPAIRED AS `connect` REPAIRS IT (2026-10-10, left
  // open by #354): an entry `install --host claude-desktop` wrote in an older
  // shape gets today's command, by the same path and with the same refusal
  // while Desktop runs (`repairDesktopEntry`). Outside the Claude Code question
  // on purpose: Desktop's file is there or not whether Claude Code is. Only
  // this arm: the scripted install reads no host file at all.
  const desktop = repairDesktopEntry(io, env, home_, lister, false, now());
  // Left in the old shape, Desktop's entry keeps doctor's Runtime line amber.
  const desktopPending = desktop.outcome === "desktop-running" || desktop.outcome === "failed";
  // A Desktop file that does not parse was left alone too, but doctor cannot
  // read an entry in it either, so its Runtime line is green: the ending can
  // promise neither green nor amber for Desktop (review of #356).
  const desktopUnread = desktop.outcome === "refused";
  u.blank();

  // ── no keys ───────────────────────────────────────────────────────────────
  //
  // THERE ARE NO API KEYS (roadmap C3, 2026-09-23; removed outright 2026-09-24).
  // Recall by meaning runs on the local table switched on above, and a session
  // that ended before it was written up is written up by the next session in
  // that project.
  //
  // WHAT WAS SWITCHED ON IS SAID, in one line, where the key questions used to
  // be (the owner's answer to review NIT 8, 2026-09-23, his wording): recall by
  // meaning is on and runs here. Only when it is true — the table is on AND it
  // is where the hooks will look.
  //
  // When the table this configuration asks for is NOT where the hooks will
  // look, that is said instead. The weights ship as the package's one
  // dependency, so on an ordinary install this never prints — it is the
  // from-source checkout, or a dependency that did not land, and a screen that
  // ended "it should be all green" over an amber would be the silence review
  // M1 named.
  //
  // Looked for the way the hooks will look (`resolveStaticWeights`: the
  // environment variable, then the installed package), and then for the table
  // FILE in what that found — a variable naming an empty folder is not a table.
  const bundled = bundledModelDir();
  const table = resolveStaticWeights({ env, ...(bundled === undefined ? {} : { packageDir: bundled }) });
  const tableOn = config.embedder?.enabled === true;
  const tableMissing = tableOn && (table === null || !existsSync(join(table.dir, MODEL_FILE)));
  if (tableOn && !tableMissing) {
    io.out("Recall by meaning: on. A small model runs on your machine; nothing is sent anywhere.");
    u.blank();
  }
  if (tableMissing) {
    u.warn("recall by meaning is on, but its table was not found — recall will match on words only.");
    u.hint(`Install it: bun add -g ${STATIC_WEIGHTS_PACKAGE} — or set ${STATIC_WEIGHTS_ENV} to a folder holding it.`);
    u.blank();
  }

  // ── the last two lines ────────────────────────────────────────────────────
  //
  // THE FOLDER, NOT THE STORE, and `~` rather than the spelled-out home: what a
  // person wants to be able to find again is `~/.counterparts`, which holds the
  // memory and the configuration. A `--dir` that moved the store out
  // of that folder is named instead, because then the folder is not where the
  // memory lives and the sentence would be false.
  const memoryAt = isWithin(layout.base, store) ? layout.base : store;
  io.out(`Done. Your memory lives at ${tilde(memoryAt, home_)}.`);
  // "IT SHOULD BE ALL GREEN" IS A PROMISE, AND IT NEEDS BOTH HALVES (review
  // M1). It used to read `wired.hooks` alone, so an install whose `claude mcp
  // add` had just failed — warning and all, four lines up — still ended by
  // telling the person to expect a green doctor. Doctor is RED on that line,
  // and the named failure mode of this whole product is silence. The MCP half
  // is consulted too, and a connect that did not finish says WHAT is missing
  // rather than sending somebody to a doctor they have not been warned about.
  const hooksIn =
    wired !== null &&
    (wired.hooks === "wired" || wired.hooks === "repaired" || wired.hooks === "already");
  const toolsIn =
    wired !== null &&
    (wired.mcp === "added" || wired.mcp === "re-added" || wired.mcp === "already");
  const connected = wired !== null && wired.outcome === "ok" && hooksIn && toolsIn;
  if (connected && !tableMissing && !desktopPending && !desktopUnread) {
    io.out(`Restart Claude Code, then run \`${BIN.cli} doctor\` — it should be all green.`);
  } else if (hooksIn && !toolsIn) {
    io.out("The hooks are in; the memory tools are NOT registered — the line above does that.");
    io.out(`Then restart Claude Code and run \`${BIN.cli} doctor\`.`);
  } else if (connected && desktopUnread) {
    // Desktop's file is unreadable — said above. Doctor cannot see into it, so
    // "all green" would vouch for a Desktop nobody checked.
    io.out(
      `Restart Claude Code, then run \`${BIN.cli} doctor\`. Claude Desktop's config was left as it was, as said above; once it is fixed, \`${BIN.cli} connect\` brings its entry up to date.`,
    );
  } else if (connected && !desktopPending) {
    // Connected, and the one amber is the table named above.
    io.out(`Restart Claude Code, then run \`${BIN.cli} doctor\` — everything but recall by meaning should be green.`);
  } else if (connected) {
    // Connected, and Claude Desktop's entry is still in the old shape — said
    // above, with what to do. "All green" here would be false (review M1).
    io.out(
      `Restart Claude Code, then run \`${BIN.cli} doctor\` — its Runtime line stays amber until Claude Desktop's entry is rewritten, as said above.`,
    );
  } else {
    io.out(`Run \`${BIN.cli} doctor\` to see where this got to.`);
  }
  return EXIT.ok;
}

/**
 * IS CLAUDE CODE ON THIS MACHINE AT ALL? (item 9's last clause.)
 *
 * Two questions, and either one answering yes is enough, because they fail in
 * opposite directions. The DIRECTORY is what a person who has ever run Claude
 * Code has — `CLAUDE_CONFIG_DIR` moves it (and IS it, when set: not a
 * `.claude` inside it, 2026-10-09), and `install.ts#hostSettingsDir` is the one
 * place that knows so. The BINARY on PATH is what a fresh install has
 * before it has been run, and the reason `install.ts`'s own docstring exists: a
 * process's PATH is not a login shell's, so a `claude` we cannot see may still
 * be there for the person.
 *
 * Answering "no" means only that nothing here found it; it is said in one line
 * and the install carries on. The probe is spawned ONLY when the directory is
 * absent, so a machine that has Claude Code never pays for it — and a re-run on
 * a connected install never spawns anything at all.
 */
function claudeCodeHere(
  home: string,
  env: Record<string, string | undefined>,
  spawner: Spawner,
): boolean {
  if (existsSync(hostSettingsDir(home, env))) return true;
  return !spawner(["--version"]).missing;
}

// ── install as the undo of `uninstall --park` (item 11) ─────────────────────

/**
 * Offer a parked memory back, before anything else happens.
 *
 * The trial's finding #22: after `uninstall --park` the way back was a pasted
 * shell line with an `if [ -e … ] … REFUSING … mv … fi` guard in it. This is
 * that guard, in code, behind a question — and `install` is where it lives
 * because `install` is what a person runs when they come back.
 *
 * ── THE RULES, and every one of them is mechanized in `install.ts` ──────────
 *
 *   - **The parked folder is never opened.** No store, no config, no file at
 *     all: the date comes from the NAME, the size from a walk, the floor from
 *     `preRowsMarkersIn`, which reads filenames. So there is no memory count on
 *     this screen, and the screen says why rather than leaving a gap.
 *   - **Anything that cannot be brought back is named and left**, with the
 *     reason — a symlink, a folder outside this home, a store from before the
 *     rows floor, a folder whose store was parked separately.
 *   - **Nothing moves without a typed answer.** Enter is not "start blank": a
 *     blank start beside a parked folder is a second store the person does not
 *     know about. An empty or unrecognised answer is asked once more and then
 *     stops the command with nothing changed.
 *   - **One `rename`,** and its destination is re-checked immediately before
 *     the call rather than at the top of this function (scar §2.13).
 */
async function offerParkedMemory(
  io: Io,
  u: Ui,
  layout: InstallLayout,
  home: string,
): Promise<"none" | "back" | "blank" | "stopped"> {
  // A configuration directory that is THERE is an install, not a return. The
  // question is only ever asked into an empty space.
  if (existsSync(layout.base)) return "none";
  const found = parkedSiblings(layout.base, home);
  if (found.length === 0) return "none";

  for (const one of found) {
    if (one.refusal === null) continue;
    u.warn(`${tilde(one.path, home)} cannot be brought back.`);
    u.hint(one.refusal);
  }
  const usable = found.filter((one) => one.refusal === null);
  if (usable.length === 0) {
    u.hint("Nothing here can be brought back, so this is a fresh start.");
    u.blank();
    return "blank";
  }

  let chosen: string;
  if (usable.length === 1) {
    const one = usable[0] as ParkedSighting;
    const answer = await askOnce(
      io,
      u,
      `Found memory set aside on ${one.date} (${humanDiskBytes(one.bytes)}). Bring it back, or start blank? [back/blank]`,
      (raw) =>
        raw === "back" || raw === "b" || raw === "1" ? "back" : raw === "blank" ? "blank" : null,
      "Answer back or blank.",
    );
    if (answer === null) return stoppedAtParked(io);
    if (answer === "blank") return blankBeside(u, usable, home);
    chosen = one.path;
  } else {
    // "memory folders", never "memories": in this product a memory is a row,
    // and "2 memories set aside" read as two rows on the dress rehearsal.
    io.out(`Found ${String(usable.length)} memory folders set aside, newest first:`);
    for (const [i, one] of usable.entries()) {
      io.out(
        `  ${String(i + 1)}. ${tilde(one.path, home)}  set aside ${one.date}  ${humanDiskBytes(one.bytes)}`,
      );
    }
    const tags = usable.map((_, i) => String(i + 1)).join("/");
    const answer = await askOnce(
      io,
      u,
      `Bring one back, or start blank? [${tags}/blank]`,
      (raw) => {
        if (raw === "blank") return "blank";
        const n = Number(raw);
        return Number.isInteger(n) && n >= 1 && n <= usable.length ? String(n) : null;
      },
      // NAMING THE ANSWERS RATHER THAN "the words in brackets" (review n3).
      // `back` is the word the one-candidate question takes, and somebody who
      // has met that question once will type it here, where it cannot say
      // WHICH — so the re-ask spells out the numbers instead of repeating a
      // sentence that does not help.
      `Answer ${tags.split("/").join(", ")} or blank.`,
    );
    if (answer === null) return stoppedAtParked(io);
    if (answer === "blank") return blankBeside(u, usable, home);
    chosen = (usable[Number(answer) - 1] as ParkedSighting).path;
  }

  const moved = bringParkedBack(chosen, layout.base, home);
  if (!moved.ok) {
    io.err(moved.reason);
    return "stopped";
  }
  u.ok(`brought back — ${tilde(chosen, home)} -> ${tilde(layout.base, home)}`);
  u.hint("One rename. Nothing was copied and nothing was opened, so there is no count here.");
  u.blank();
  return "back";
}

/** The question, once, then once more, then nothing. `parse` returns the
 *  canonical answer, or null for "that was not one of the choices"; `retry` is
 *  the one line between the two attempts, and it NAMES the answers rather than
 *  pointing back at the brackets. */
async function askOnce(
  io: Io,
  u: Ui,
  question: string,
  parse: (raw: string) => string | null,
  retry: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = (await ask(io, question)).trim().toLowerCase();
    const answer = parse(raw);
    if (answer !== null) return answer;
    if (attempt === 0) u.hint(retry);
  }
  return null;
}

/** An answer nobody gave is not a decision. Nothing has moved at this point —
 *  the rename is the last thing that happens — so the exit can say so. */
function stoppedAtParked(io: Io): "stopped" {
  io.err("Nothing was changed, and the memory set aside is exactly where it was.");
  return "stopped";
}

/** "Start blank" is a real answer, and it is the one where saying what was NOT
 *  touched matters most: there will now be two stores on this machine. */
function blankBeside(u: Ui, usable: readonly ParkedSighting[], home: string): "blank" {
  for (const one of usable) u.hint(`${tilde(one.path, home)} is untouched, exactly as it was.`);
  u.hint(`It stays there until you move it; \`${BIN.cli} install\` will offer it again.`);
  u.blank();
  return "blank";
}

/**
 * The interactive install's ceiling, and the ONLY default this package has for
 * one (scar §2.18 holds everywhere else, the scripted arm included). It is the
 * ceiling the self page's write limit is sized against
 * (`self/briefing.ts#PAGE_HOST_BUDGET_BYTES`, 2026-10-09), read from there so
 * the two cannot drift: 9,000.
 */
const DEFAULT_BUDGET_BYTES = PAGE_HOST_BUDGET_BYTES;

/** A configuration is "custom" by its PATH, not by how it was named — the same
 *  test `installCommand` and `startFreshCommand` each make. Hoisted here so
 *  the four callers cannot drift. */
function customConfigPath(named: ConfigChoice | undefined, home: string): string | undefined {
  return named !== undefined && named.source !== "default" && resolve(named.path) !== defaultConfigPath(home)
    ? named.path
    : undefined;
}

// ── connect / disconnect / uninstall ────────────────────────────────────────

/**
 * THE HOSTS THIS CONSOLE KNOWS HOW TO CONNECT — one, and the list says so.
 *
 * The owner's ruling (2026-09-22, item 3): with one host known, `connect` names
 * it and goes. A menu of one item is a question whose answer was already on the
 * screen. The NAME is still accepted — `counterparts connect claude-code` is the
 * same command — so the day there are two, a script that named its host keeps
 * working and only the bare form has to learn to ask.
 */
export const KNOWN_HOSTS: readonly string[] = ["claude-code"];

/**
 * The console's half of the three host-editing verbs: refuse `--dir`, refuse a
 * host nobody has, resolve which configuration this invocation means, read the
 * store out of it, and hand the rest to `wire.ts` / `uninstall.ts`.
 *
 * Everything that touches a host file is in those modules. This function owns
 * exactly four decisions — which host, which configuration, which store, and how
 * an outcome maps onto an exit code — so that the exit codes stay in the one
 * file that defines them.
 */
async function hostWiringCommand(
  command: "connect" | "disconnect" | "uninstall",
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
  now: () => number,
): Promise<number> {
  // WHICH HOST, asked before anything is read. A name this console does not
  // know is a command line that does not mean what it says — and the refusal
  // NAMES the one it knows, because "unknown host" without a list is the
  // refusal that teaches nothing (constitution 16).
  const askedHost = parsed.positional[0];
  if (command !== "uninstall" && askedHost !== undefined && !KNOWN_HOSTS.includes(askedHost)) {
    io.err(
      `refused: '${command}' does not know a host called '${askedHost}'. The one it knows is ` +
        `${KNOWN_HOSTS.join(", ")} — and \`${BIN.cli} ${command}\` on its own means that one.`,
    );
    io.err("Nothing has changed.");
    return EXIT.refused;
  }

  // `--dir` is a COMMON flag, so it parses on every command. Here it would be a
  // second answer to "which install" on commands that edit a stranger's editor
  // configuration and, in one case, rename the directory holding the memory.
  if (typeof parsed.flags["dir"] === "string") {
    io.err(
      `refused: '${command}' takes no --dir. What it acts on is decided by your ` +
        "CONFIGURATION — that is the file the hooks, the worker and the MCP server read, and a " +
        `second answer on this command line is how the wrong one gets edited. Name the ` +
        `configuration instead: ${CONFIG_FLAG} <absolute path>, or ${CONFIG_ENV}.`,
    );
    io.err("Nothing has changed.");
    return EXIT.refused;
  }

  const home_ = opts.home ?? homedir();
  const configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);
  const custom = customConfigPath(named, home_);
  const present = existsSync(configPath);
  const host = hostConfigFor(configPath);
  if (present && host.reason === "unreadable") {
    io.err(
      `refused: ${configPath} is there and will not be understood. These commands read ` +
        '"dataDir" out of it to know which store to name, and a file they cannot read is a ' +
        "question they will not answer by guessing.",
    );
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  // A MISSING CONFIGURATION STOPS `connect` AND `uninstall`, AND NOT
  // `disconnect`.
  //
  // The first two need it: `connect` has to tell the server which store to open,
  // and `uninstall` has to know which directory this install's is at all. But
  // `disconnect` needs nothing out of it — it takes hooks OUT of the host's
  // settings and runs one `claude mcp remove` — and the person most likely to be
  // running it is somebody who deleted `~/.counterparts` by hand and now has
  // five hooks firing at a store that is gone. Refusing them would leave the
  // mess this command exists to clean up.
  if (!present && command !== "disconnect") {
    io.err(
      `refused: there is no configuration at ${configPath}, so there is no install here to ` +
        `${command === "uninstall" ? "remove" : command}. Run '${BIN.cli} install' first, or name ` +
        `the configuration you mean with ${CONFIG_FLAG} <absolute path>.` +
        (command === "connect"
          ? ` (\`${BIN.cli} disconnect\` does work without one: it only ever takes things out.)`
          : ""),
    );
    return EXIT.refused;
  }

  const store = host.config.dataDir ?? join(dirname(configPath), DEFAULT_STORE_DIR);
  const spawner = opts.spawner ?? realSpawner(env);
  const lister = opts.processes ?? realProcessLister(env);

  if (command === "uninstall") {
    return exitFor(
      await uninstall({
        io,
        env,
        home: home_,
        configPath,
        custom,
        // THE WHOLE CONFIGURATION, not just `dataDir`: the plan has to find the
        // snapshots directory and the store wherever the file put them, because "the directory the config sits in" is exactly
        // the reasoning the 2026-09-21 review broke.
        config: host.config,
        now: now(),
        yes: parsed.flags["yes"] === true,
        park: parsed.flags["park"] === true,
        deleteMemories: parsed.flags["delete-memories"] === true,
        nothingIsOpen: parsed.flags["nothing-is-open"] === true,
        exe: process.execPath,
        spawner,
        lister,
      }),
    );
  }

  const input: WireInput = {
    io,
    env,
    home: home_,
    configPath,
    custom,
    store,
    now: now(),
    // NO QUESTION, AND THE VERB IS THE YES (2026-09-22, item 3). `wire()` and
    // `unwire()` still hold the question — `install` is their other caller and
    // it owns when to put one — and these two commands answer it here, at the
    // call site, because somebody who typed `counterparts connect` has already
    // said what a "Connect Claude Code now? [Y/n]" would be asking them. That is
    // also why neither declares `--yes` any more: there is nothing to skip.
    yes: true,
    dryRun: parsed.flags["dry-run"] === true,
    exe: process.execPath,
    spawner,
    lister,
  };
  const result = command === "connect" ? await wire(input) : await unwire(input);
  // CLAUDE DESKTOP'S ENTRY TOO (2026-10-10): `install --host claude-desktop`
  // wrote a server command into Desktop's own file, and it needs the same
  // repair the hooks just got — but never while Desktop is open
  // (`repairDesktopEntry`).
  const desktopFailed =
    command === "connect" && repairDesktopEntry(io, env, home_, lister, input.dryRun === true, now()).outcome === "failed";
  // WHAT AN OPEN SESSION DOES NOW, printed by the CALLER (2026-09-22). `wire()`
  // used to say it itself, which put it in the middle of `install`'s screen two
  // lines above install's own "restart Claude Code, then run doctor". A
  // standalone `connect` has no such ending, so it says it here — and only when
  // something actually changed, because "restart your sessions" after "already
  // connected, nothing was changed" is advice about nothing.
  //
  // BOTH HALVES COUNT. Hooks already in place and a registration that was
  // missing is the case where the person has just gained the memory TOOLS, and
  // those are exactly the half that needs a restart; gating on the hooks alone
  // left that reader with nothing to do about it.
  if (
    command === "connect" &&
    result.outcome === "ok" &&
    (result.hooks !== "already" || result.mcp !== "already")
  ) {
    sessionsNote(ui(io, env), lister, { dataDir: store, env });
  }
  return desktopFailed && result.outcome === "ok" ? EXIT.failed : exitFor(result.outcome);
}

/**
 * CLAUDE DESKTOP'S ENTRY IN TODAY'S SHAPE — `connect`'s repair, and since
 * 2026-10-10 `install`'s at a terminal too (the other caller of `wire()`).
 * One path for both: the process look, `desktop.ts#repairDesktop` (an entry of
 * ours only, its `env` kept, backed up first, written atomically, never while
 * Desktop runs or could not be ruled out), and one line saying what happened.
 * Returns the repair; what it does to the exit is the caller's call.
 */
function repairDesktopEntry(
  io: Io,
  env: Record<string, string | undefined>,
  home_: string,
  lister: ProcessLister,
  dryRun: boolean,
  at: number,
): DesktopRepair {
  const sighting = look(lister);
  const repair = repairDesktop({
    home: home_,
    exe: process.execPath,
    desktopRunning: sighting.looked ? (sighting.desktopRunning ?? null) : null,
    dryRun,
    now: at,
  });
  sayDesktopRepair(ui(io, env), repair, home_);
  return repair;
}

/** One line about Claude Desktop's entry, or none. True when the write failed. */
function sayDesktopRepair(u: ReturnType<typeof ui>, repair: DesktopRepair, home_: string): boolean {
  const where = tilde(repair.path, home_);
  switch (repair.outcome) {
    case "none":
    case "current":
      return false;
    case "repaired":
      u.ok(
        `Claude Desktop: rewrote its counterparts entry to start the memory server the way Claude Code's now does${repair.backup === null ? "" : ` (backup: ${tilde(repair.backup, home_)})`}. It takes effect when Desktop next opens.`,
      );
      return false;
    case "would-repair":
      u.hint(`Claude Desktop: would rewrite its counterparts entry in ${where} to start the memory server the way Claude Code's does. Nothing was written.`);
      return false;
    case "desktop-running":
      u.warn(
        repair.unknownRunning === true
          ? `Claude Desktop's counterparts entry was left as it was: whether Desktop is open could not be checked, and Desktop rewrites ${where} while it runs. Quit Claude Desktop, then run \`${BIN.cli} connect\` again.`
          : `Claude Desktop is open, so its counterparts entry was left in the old shape: Desktop rewrites ${where} while it runs. Quit Claude Desktop, run \`${BIN.cli} connect\` again, then reopen it.`,
      );
      return false;
    case "refused":
      u.warn(`Claude Desktop: ${repair.detail ?? `${where} could not be read, and was left as it was.`}`);
      return false;
    case "failed":
      u.fail(`Claude Desktop's entry could not be rewritten: ${repair.detail ?? "unknown error"}`);
      return true;
  }
}

/** `wire.ts` returns words, not numbers, so that it never has to import this
 *  file's `EXIT` back and make the two modules circular. */
function exitFor(outcome: WireOutcome): number {
  return outcome === "ok" ? EXIT.ok : outcome === "refused" ? EXIT.refused : EXIT.failed;
}

// ── dashboard ───────────────────────────────────────────────────────────────

/**
 * `counterparts dashboard` — the owner's window, on the store this machine is
 * already using.
 *
 * `counterparts-dashboard serve` has existed since 2026-09-04 and REFUSES until
 * somebody names a store, for a reason that is still right: `serve` with no
 * `--dir` would have put the default store — the owner's live memory, every
 * element of it — on a socket because a flag was forgotten. That refusal is a
 * guard on a command whose author could not know which store was meant.
 *
 * This command knows. It reads the CONFIGURATION, the same file the hooks and
 * the memory tools open, so the question `serve` refuses to guess at has already
 * been answered on this machine by an install. `--dir` still names another, and
 * `--config` names another configuration; what is gone is the case where nobody
 * said anything at all.
 *
 * The server itself is not duplicated: `web/server.ts` is imported and started,
 * and everything it already guarantees — 127.0.0.1 only, a Host-header
 * allowlist, observer by construction — holds unchanged.
 */

/** A dashboard that is up, as this console needs to see it. */
export interface RunningView {
  readonly url: string;
  /** The store it opened, resolved — printed, so it is never a guess. */
  readonly dir: string;
  /** The store waits for its one-time upgrade; the page says so, and so does this. */
  readonly upgradePending?: boolean;
  stop(): Promise<void>;
}

/**
 * THE WEB VIEW AS A SEAM, for the reason `spawner` and `processes` are seams
 * one screen up: a test that drove the real one would bind a real port on the
 * machine running the suite, and a suite that binds ports fails in CI, in
 * parallel with itself, and on a developer who happens to have 4747 open.
 *
 * Real runs pass nothing and get `realDashboard()`, which imports the server
 * module lazily — so a console that never types this word never pulls the HTTP
 * server into its module graph at all. (Said that way on purpose:
 * `test/cli.test.ts` greps this whole directory for the names of the network
 * modules, and the one file in this package that may open a socket is the
 * dashboard's own server, named in `test/claude-code.test.ts`.)
 */
export interface DashboardSeam {
  start(opts: { readonly dir: string; readonly port?: number; readonly config?: string }): Promise<RunningView>;
  /** Open the person's browser. Never throws: a machine with no opener, or a
   *  desktop that refuses, is not a reason for the dashboard to fail. */
  open?(url: string): void;
  /** Resolves when the person stops it. Ctrl-C, in a real run. */
  until?(): Promise<void>;
}

/** The default port, restated rather than imported: naming it here costs one
 *  number and keeps `web/server.ts` out of the module graph of a console that
 *  is not serving anything. `test/cli.test.ts` holds the two to each other. */
export const DASHBOARD_DEFAULT_PORT = 4747;

/** The ONE line the owner asked for (2026-09-22, item 4). */
export function dashboardLine(url: string): string {
  return `Dashboard: ${url}  (Ctrl-C stops it)`;
}

/** `catch-up`: which store and which configuration, then the run (`catch-up.ts`). */
async function catchUpEntry(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
  now: () => number,
): Promise<number> {
  const home_ = opts.home ?? homedir();
  const configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);
  let config: AdapterConfig;
  let fromFile: string | undefined;
  if (typeof parsed.flags["dir"] === "string") {
    // `--dir` IS A NAME: the store alone, no configuration read beside it.
    config = { dataDir: resolve(parsed.flags["dir"]) };
  } else {
    if (!existsSync(configPath)) {
      io.err(
        `refused: there is no configuration at ${configPath}, so there is no store here to catch up. ` +
          `Run '${BIN.cli} install' first, name the configuration with ${CONFIG_FLAG} <absolute path>, or name a store with --dir <path>.`,
      );
      return EXIT.refused;
    }
    const host = hostConfigFor(configPath);
    if (host.reason === "unreadable") {
      io.err(`refused: ${configPath} is there and will not be understood, so this will not guess which store to write into. --dir <path> names one directly.`);
      return EXIT.refused;
    }
    config = { ...host.config, dataDir: host.config.dataDir ?? join(dirname(configPath), DEFAULT_STORE_DIR) };
    fromFile = configPath;
  }
  const dataDir = config.dataDir ?? "";
  if (dataDir.length === 0 || !storeExists(dataDir)) {
    io.err(`no store at ${dataDir}. Run '${BIN.cli} install' first, or name another store with --dir.`);
    return EXIT.failed;
  }
  if (config.observer === true) {
    io.err("refused: this configuration is an observer's, and a catch-up writes memories.");
    return EXIT.refused;
  }
  return await catchUpCommand({
    config: { ...config, dataDir },
    ...(fromFile === undefined ? {} : { configPath: fromFile }),
    env,
    out: (l) => io.out(l),
    err: (l) => io.err(l),
    now,
    ...(opts.catchUpStart === undefined ? {} : { start: opts.catchUpStart }),
  });
}

async function dashboardCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
): Promise<number> {
  const home_ = opts.home ?? homedir();
  const configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);

  // WHICH STORE — `--dir` if it was named, else the one the configuration names.
  let dir: string;
  if (typeof parsed.flags["dir"] === "string") {
    dir = resolve(parsed.flags["dir"]);
  } else {
    if (!existsSync(configPath)) {
      io.err(
        `refused: there is no configuration at ${configPath}, so there is no store here to ` +
          `show. Run '${BIN.cli} install' first, name the configuration with ${CONFIG_FLAG} ` +
          "<absolute path>, or point this at a store yourself with --dir <path>.",
      );
      return EXIT.refused;
    }
    const host = hostConfigFor(configPath);
    if (host.reason === "unreadable") {
      io.err(
        `refused: ${configPath} is there and will not be understood. This command reads ` +
          '"dataDir" out of it to know which store to show, and a file it cannot read is a ' +
          "question it will not answer by guessing. --dir <path> names one directly.",
      );
      return EXIT.refused;
    }
    dir = host.config.dataDir ?? join(dirname(configPath), DEFAULT_STORE_DIR);
  }

  if (!storeExists(dir)) {
    io.err(
      `no store at ${dir}. Run '${BIN.cli} install' first` +
        `${typeof parsed.flags["dir"] === "string" ? `, or name another store with --dir` : ""}.`,
    );
    return EXIT.failed;
  }

  // A PORT THAT IS NOT A PORT IS A REFUSAL, not a silent fall back to 4747: a
  // person who typed one meant it, and a dashboard that ignored it and came up
  // somewhere else is the `--dirr` silence in a smaller key.
  const portFlag = parsed.flags["port"];
  let port: number | undefined;
  if (typeof portFlag === "string") {
    const n = Number(portFlag);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      io.err(`refused: --port ${portFlag} is not a port number (0–65535). Nothing was opened.`);
      return EXIT.refused;
    }
    port = n;
  }

  const seam = opts.dashboard ?? realDashboard(env);
  let running: RunningView;
  try {
    // THE CONFIGURATION rides along for the dashboard's management actions
    // (`scope` and `rebrief` read one) — when this command resolved the store
    // through it, or when one was named outright. A bare `--dir` names a store
    // and no configuration, and the dashboard then offers no `scope`.
    const config =
      typeof parsed.flags["dir"] !== "string" || (named !== undefined && named.source !== "default")
        ? configPath
        : undefined;
    running = await seam.start({
      dir,
      ...(port === undefined ? {} : { port }),
      ...(config === undefined ? {} : { config }),
    });
  } catch (err) {
    if ((err as { code?: string }).code === "EADDRINUSE") {
      io.err(
        `Port ${String(port ?? DASHBOARD_DEFAULT_PORT)} is already in use — a dashboard may ` +
          "already be running. Pass --port <n> to use another one.",
      );
      return EXIT.failed;
    }
    throw err;
  }

  io.out(dashboardLine(running.url));
  // WHICH STORE IS ON THAT SOCKET, said out loud, every time. It is the sentence
  // `serve` has printed since the day it was written, and the reason has not
  // changed: a whole memory is being served, and "which one" must never be a
  // guess (constitution 16).
  io.out(`reading ${tilde(running.dir, home_)}`);
  if (running.upgradePending === true) {
    const words = upgradeWords(hostsSeen(running.dir));
    io.out(
      `this store is on an older schema; ${words.who} copies it and upgrades it to ` +
        `v${String(SCHEMA_VERSION)}. The page says so until then; reload it after.`,
    );
  }
  if (parsed.flags["no-open"] !== true) seam.open?.(running.url);

  await (seam.until ?? untilInterrupted)();
  await running.stop();
  return EXIT.ok;
}

/**
 * The real seam: the server module, loaded only now, and the platform's own
 * "open this" program.
 */
function realDashboard(env: Record<string, string | undefined>): DashboardSeam {
  return {
    async start(o): Promise<RunningView> {
      // LAZY, and the laziness is the point: a `counterparts status` must not
      // pull an HTTP server into its module graph to print a table.
      const { startDashboard } = await import("../dashboard/web/server.js");
      const up = await startDashboard({
        dir: o.dir,
        ...(o.port === undefined ? {} : { port: o.port }),
        ...(o.config === undefined ? {} : { config: o.config }),
      });
      return { url: up.url, dir: up.dir, upgradePending: up.upgradePending, stop: (): Promise<void> => up.stop() };
    },
    open(url: string): void {
      openInBrowser(url, env);
    },
    until: untilInterrupted,
  };
}

/**
 * Hand the address to the desktop, and NEVER FAIL BECAUSE OF IT.
 *
 * Detached and with its streams closed, so the opener's own chatter cannot land
 * in the middle of the dashboard's output and a browser that outlives this
 * process does not hold it open. Every failure — no such program, a headless
 * box, a sandbox that refuses to spawn — is silent: the address is already on
 * the screen, and a person who can read it can paste it.
 */
function openInBrowser(url: string, env: Record<string, string | undefined>): void {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
  if (opener === null) return;
  try {
    const child = spawn(opener, [url], {
      detached: true,
      stdio: "ignore",
      env: env as NodeJS.ProcessEnv,
    });
    // An ENOENT arrives as an EVENT, not as a throw, and an unhandled 'error'
    // on a child process takes the whole console down with it.
    child.on("error", () => {
      /* no opener on this machine; the address is on the screen */
    });
    child.unref();
  } catch {
    /* likewise — this is a courtesy, not a step */
  }
}

/** Until Ctrl-C. `once` rather than `on`, so a second interrupt kills the
 *  process the way an impatient person expects it to. */
function untilInterrupted(): Promise<void> {
  return new Promise<void>((done) => {
    process.once("SIGINT", () => {
      done();
    });
    process.once("SIGTERM", () => {
      done();
    });
  });
}

// ── init ────────────────────────────────────────────────────────────────────

/**
 * Create the data dir and PRINT the installation steps. It does not write a
 * host's configuration file: an installer that edits somebody's settings
 * without being asked is the same class of surprise as a memory layer that
 * writes without being asked. The steps are printed; the owner runs them.
 *
 * The forbidden-root refusal is not implemented here — `Store`'s constructor
 * calls `assertSafeDataDir` before it creates a single directory, so a `--dir`
 * aimed at v1's live store fails before anything exists (scar §2.13). This
 * function only has to not catch it.
 */
function initCommand(dir: string, io: Io, home = homedir(), name?: string): number {
  const existed = storeExists(dir);
  let store: Store;
  try {
    store = openStoreAt({ dir });
  } catch (err) {
    io.err(prefixedRefusal(describeDirRefusal(err, dir)));
    return EXIT.refused;
  }
  const resolved = store.dir;
  store.close();

  // `--name` seeds the identity core, through `Counterpart.open`'s own option —
  // the same door `install` reaches by writing `identity` into the config. §3
  // routes second and scratch stores here and then says the core has no default
  // anywhere, so an `init` that could not seed one left the documented path
  // unable to produce the thing the documentation says matters. Idempotent:
  // `ensureIdentityCore` is an ENSURE.
  let seeded = false;
  if (name !== undefined && name.length > 0) {
    const brain = openCounterpart(resolved, false, { name });
    try {
      seeded = true;
    } finally {
      brain.close();
    }
  }

  io.out(existed ? `Store already present at ${resolved}.` : `Created a store at ${resolved}.`);
  io.out(
    seeded
      ? `  identity core seeded for ${name ?? ""} — the thing this memory is about.`
      : "  no identity core: pass --name \"<your name>\" to seed one. Nothing else gives a",
  );
  if (!seeded) io.out("  store one, and the wake has nothing to be about without it.");
  io.out("");
  io.out("To install the hooks (not done for you — these edit your host's settings):");
  io.out("");
  io.out("  1. Point the host at the hook entry script for every session-ending event:");
  io.out("       SessionStart, UserPromptSubmit, Stop, SessionEnd, PreCompact");
  io.out(`       installed:  ${BIN.hook}`);
  io.out("       from a clone: bun run <repo>/src/adapters/claude-code/bin/hook.ts");
  io.out("  2. Register the MCP server so the Stop ask has a way back:");
  io.out(`       installed:  ${BIN.mcp}`);
  io.out("       from a clone: bun run <repo>/src/adapters/mcp/bin/serve.ts");
  io.out("  3. Write the adapter's configuration BESIDE the store, never inside it — the");
  io.out("     layout check refuses an unclassified file in the data dir (§5 G11):");
  io.out(`       ${join(resolved, "..", "claude-code.json")}`);
  io.out('       { "dataDir": "<this dir>", "injectionBudgetBytes": <your host\'s ceiling> }');
  io.out("");
  io.out("     WHO HONORS THAT FILE, exactly: this console reads it for the injection");
  io.out(`     ceiling ('${BIN.cli} rebrief'). The HOOKS DO NOT — with no flag they read`);
  io.out(`       ${defaultConfigPath(home)}`);
  io.out("     and nothing else, falling back to COUNTERPARTS_DATA_DIR only when that");
  io.out("     file names no store. A hook that finds no config stands down quietly and");
  io.out("     exits 0 (a Stop with a question exits 2 on purpose, and that is the only");
  io.out("     non-zero a hook produces), so a config anywhere else is an ambient half");
  io.out("     that never fires and never says so — unless you NAME it: every entry point");
  io.out(`     takes ${CONFIG_FLAG} <absolute path>, else $${CONFIG_ENV}, else that default.`);
  io.out(`     To wire the hooks for you, use '${BIN.cli} install'.`);
  io.out("");
  io.out("The injection ceiling has NO default anywhere in this package: a briefing");
  io.out("refuses to render rather than compose to a number nobody chose (scar §2.18).");
  io.out("");
  io.out(`'${BIN.cli} init' makes a STORE and nothing else — a second store, a scratch`);
  io.out(`one, a store on another disk. '${BIN.cli} install' is the cold start: it owns`);
  io.out("~/.counterparts/, writes step 3 there, and prints");
  io.out("1 and 2 filled in and ready to paste.");
  return EXIT.ok;
}

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
async function startFreshCommand(
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
    io.out("  this only means the install ends on its 'no ceiling was written' paragraph.");
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
      { hostSteps: false },
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
    io.out("  (this read the new store's record, so its `-shm` index may have been");
    io.out("   rewritten. Nothing else was touched, and the parked store was not opened.)");
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
async function rollbackCommand(
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

// ── note / recall ───────────────────────────────────────────────────────────

/**
 * `note` and `recall` on the console — the same two acts the MCP tools offer,
 * reachable without a host.
 *
 * **They go through exactly the MCP server's doors, and that is the point.** A
 * second way to write a memory would be a second set of rules about what a
 * memory is: `noteTool` captures the words into the span buffer FIRST and then
 * deposits a draft that CLAIMS that span by hash, because without the claim the
 * end-of-session sweep finds the jot's own text sitting in the buffer and mints
 * it again — a "remember this" channel that costs two memories. `recall` calls
 * `deliberateRecall`, the same dispatcher, so the console cannot drift into a
 * softer question path than the model gets.
 *
 * The embedder is shared too since 2026-09-24 (`askEmbedder`): `ask` embeds its
 * question with the local table the configuration turns on, exactly as the MCP
 * `recall` does, and says which channel answered when it could not. `note`
 * opens its store with the same embedder, so the row it writes carries a vector
 * at once and a paraphrased `ask` finds it without waiting for the worker's
 * backfill. The store reconciles the embedder's identity against box 3's tag
 * at open, so a store tagged with another model gets no vector from here.
 * Without the table the note is stored by words alone, and says nothing of it:
 * the backfill, or `doctor`, is where a missing table is named.
 *
 * Why these exist at all: the cold-stranger review of 2026-09-04 reached the end
 * of the install page having verified that a store existed and was empty, with
 * no way to test the one thing the product is for. They hand-wrote JSON-RPC.
 * Most people will not.
 */
async function noteCommand(
  dir: string,
  io: Io,
  parsed: Parsed,
  env: Record<string, string | undefined>,
  home: string,
  filedUnder?: string,
): Promise<number> {
  const text = parsed.positional.join(" ").trim();
  if (text.length === 0) {
    io.err('refused: note takes the text to remember, e.g. counterparts note "..."');
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}. Run 'counterparts install' first.`);
    return EXIT.failed;
  }
  let claimed: number | undefined;
  const salienceFlag = parsed.flags["salience"];
  if (typeof salienceFlag === "string" && salienceFlag.length > 0) {
    const n = Number(salienceFlag);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      io.err(`refused: --salience takes a number from 0 to 1, not '${salienceFlag}'.`);
      return EXIT.refused;
    }
    claimed = n;
  }

  const embedder = askEmbedder(parsed.flags, env, home);
  const counterpart = openCounterpart(dir, false, undefined, embedder?.embed);
  try {
    // THE STORE, FIRST, the way `status` names it. A write whose destination is
    // invisible is the shape the 2026-09-04 review found: a mistyped `--dir`
    // resolved to the default store, the note landed there, and the only line
    // printed was that something had been remembered.
    io.out(`Store: ${counterpart.store.dir}`);
    const session = "console";
    const scope = filedUnder ?? process.cwd();
    // Step 1 of 2, and the ORDER is the rule (see the docblock above).
    const captured = counterpart.captureJot({ session, scope, text });
    const ownSpanHash = captured.spans[0]?.hash ?? null;

    const draft: Record<string, unknown> = { content: text };
    if (typeof parsed.flags["kind"] === "string") draft["kind"] = parsed.flags["kind"];
    if (typeof parsed.flags["title"] === "string") draft["title"] = parsed.flags["title"];
    if (claimed !== undefined) draft["claimed"] = claimed;

    const deposit = await counterpart.submitJot(draft, {
      session,
      scope,
      ...(ownSpanHash === null ? {} : { ownSpanHash }),
    });
    if (!deposit.deposited) {
      io.err(
        `not stored: ${deposit.reason}${deposit.gate === null ? "" : ` (${deposit.gate})`}`,
      );
      return EXIT.refused;
    }
    io.out(`Remembered ${deposit.memoryId ?? "(no id)"} — ${deposit.reason}.`);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * THE EMBEDDER `ask` EMBEDS ITS QUESTION WITH (2026-09-24), or null when
 * recall by meaning is off.
 *
 * Until now the console passed no vector at all — a leftover from when the only
 * embedder was a network seat. The local table is local, so `ask` does what the
 * MCP server's entry point does (`mcp/bin/serve.ts#questionEmbedder`): read the
 * configuration, apply the embedder default, `openEmbedder`. Missing weights come
 * back as an UNAVAILABLE embedder whose every answer is null, and the question
 * is then answered by words and says so (`embed-failed`).
 *
 * The configuration is read for this ONE knob, the way `rebrief` reads a budget
 * number — never to locate a store — and LENIENTLY: a configuration this cannot
 * use is not a reason to refuse a question. So a `--config` or
 * `COUNTERPARTS_CONFIG` that will not resolve, or a default one the explicit-dir
 * guard says nobody named (`implicitConfigRefusal`), is not read, and the
 * default applies: the local table, on.
 */
export function askEmbedder(
  flags: Parsed["flags"],
  env: Record<string, string | undefined>,
  home: string,
): LiveEmbedder | null {
  const choice = resolveConfigPath(
    typeof flags["config"] === "string" ? [`${CONFIG_FLAG}=${flags["config"]}`] : [],
    env,
    home,
  );
  const readable = choice.refusal === null && implicitConfigRefusal(choice, env) === null;
  const config = withEmbedderDefault(readable ? hostConfigFor(choice.path).config : {});
  return openEmbedder(config, { env });
}

/** How many answers `ask` lists before `--full` (2026-09-24). */
export const ASK_SHOWN = 5;
/** How long an answer's text line runs on that list before it is cut. */
export const ASK_GIST_CHARS = 90;

/** Markdown heading marks off every line, and the whitespace collapsed. */
function plainLine(text: string): string {
  return text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "").replace(/\s+/g, " ").trim();
}

/**
 * An answer's text line on `ask`'s list: its title, or its first words — as
 * plain words. A chapter's heading (`## chapter 1 — lived day 2`, stacked or
 * not, either written form) is taken off the front, because `askMeta` says it
 * on the line underneath; heading marks go, whitespace collapses, and the line
 * is cut at `ASK_GIST_CHARS` with an ellipsis (owner, 2026-09-24).
 */
export function askGist(title: string | null, body: string): string {
  const titled = title === null ? "" : plainLine(readChapterLead(title).rest);
  const words = titled.length > 0 ? titled : plainLine(readChapterLead(body).rest);
  // A row that is ONLY a heading still gets a line: the heading, plainly.
  const said = words.length > 0 ? words : plainLine(title ?? body);
  return said.length <= ASK_GIST_CHARS ? said : `${said.slice(0, ASK_GIST_CHARS).trimEnd()}…`;
}

/**
 * The quieter line under an answer: what it is, when, and its id —
 * `self · chapter 1 · Wed 23 Sep 2026 · claude-opus-5-5 · lived day 2 · mem_0a1b2c3d4e5f`
 * (the model only where the heading names one).
 *
 * The DATE is the one the chapter's own heading names when it names one (a
 * chapter written since 2026-09-24 carries the day it was written, in the
 * person's zone). Otherwise it is `learnedOn`, the store's provenance date —
 * which is a UTC day (`store/index.ts#dateOf`), because a row keeps no instant
 * to take into any other zone.
 */
export function askMeta(
  m: { readonly id: string; readonly kind: string; readonly journal: boolean; readonly body: string },
  learnedOn: string | null,
): string {
  const lead = readChapterLead(m.body);
  const parts: string[] = [m.journal ? "journal" : m.kind];
  const [lo, hi] = [lead.chapters[0], lead.chapters[lead.chapters.length - 1]];
  if (lo !== undefined && hi !== undefined) {
    parts.push(lo === hi ? `chapter ${String(lo)}` : `chapters ${String(lo)}–${String(hi)}`);
  }
  const date = lead.date ?? (learnedOn === null ? "" : readableDate(learnedOn));
  if (date.length > 0) parts.push(date);
  if (lead.model !== null) parts.push(lead.model);
  if (lead.livedDay !== null) parts.push(`lived day ${String(lead.livedDay)}`);
  parts.push(m.id);
  return parts.join(" · ");
}

/**
 * Which channel answered, in plain words for `ask`'s header. The store's own
 * verdict has the last word: a store whose meaning index is held (another
 * model's vectors) or ahead of this build ranks on words alone whatever vector
 * it was handed — the no-mixing rule (`store/cache.ts#reconcileEmbedder`).
 */
function askChannel(
  semantic: string,
  verdict: string,
  embedder: LiveEmbedder | null,
): string {
  if (verdict === "held" || verdict === "cache-ahead" || verdict === "deferred") {
    return "by words only — this store's meaning index is on hold; see counterparts doctor";
  }
  if (semantic === "in-line") return "by meaning and words";
  if (semantic === "embedder-off") return "by words only — recall by meaning is off";
  if (embedder?.unavailable === "NO_WEIGHTS") return "by words only — the meaning table is not installed";
  if (embedder?.unavailable !== undefined) return "by words only — the meaning table could not be loaded";
  return "by words only — the question could not be embedded";
}

/** The deliberate look, in plain lines. Writes nothing of its own. */
async function recallCommand(
  dir: string,
  io: Io,
  parsed: Parsed,
  env: Record<string, string | undefined>,
  home: string,
): Promise<number> {
  // THE SPELLING THE PERSON TYPED IS THE SPELLING THEY GET BACK. `ask` is the
  // listed name and `recall` the older one, and a refusal that answered
  // `counterparts ask` with "counterparts recall takes a question" would be
  // teaching a name the page does not list (2026-09-22, item 3).
  const said = parsed.command === "recall" ? "recall" : "ask";
  const idFlag = typeof parsed.flags["id"] === "string" ? parsed.flags["id"].trim() : "";
  const question = parsed.positional.join(" ").trim();
  if (idFlag.length === 0 && question.length === 0) {
    io.err(
      `refused: ${said} takes a question, e.g. ${BIN.cli} ${said} "..." — or --id <id>.`,
    );
    return EXIT.usage;
  }
  if (idFlag.length > 0 && question.length > 0) {
    io.err("refused: a question and --id are two different asks. Send one.");
    return EXIT.usage;
  }
  // THE MODE, as the MCP `recall` takes it (2026-10-09): facts unless meaning
  // is asked for by name. Read before the store opens, so a mistyped mode is a
  // refusal rather than a facts answer to a question meant for the arc. With
  // `--id` there is no question to answer in a mode, and it is not read.
  const modeFlag = parsed.flags["mode"];
  if (modeFlag !== undefined && modeFlag !== "facts" && modeFlag !== "meaning") {
    io.err(`refused: --mode is facts or meaning, not ${typeof modeFlag === "string" ? JSON.stringify(modeFlag) : "empty"}.`);
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}. Run 'counterparts install' first.`);
    return EXIT.failed;
  }

  // THE EMBEDDER, for a question only: `--id` is an exact address, and
  // embedding it would buy nothing (the MCP path's rule).
  const embedder = question.length > 0 ? askEmbedder(parsed.flags, env, home) : null;
  // Opened WITH the embedder's identity, the way `mcp/index.ts#openServer`
  // opens the server's store: the store reconciles box 3's tag at open, so a
  // held or mismatched meaning index ranks nothing rather than a cosine across
  // two models.
  //
  // AND IN OBSERVER STANCE (owner, 2026-09-25: asking is looking, and looking
  // changes nothing). A writable open here backfilled the meaning index — on a
  // fresh store, one `ask` embedded and wrote every row's vector into box 3 —
  // and asking from the dashboard runs this same function. Under observer the
  // question is still embedded and answered; nothing is written, the cache
  // included. The backfill is the worker's and the hooks' job.
  const counterpart = openCounterpart(dir, true, undefined, embedder?.embed);
  try {
    // Same rule as `note` and `status`: say which store answered.
    if (parsed.flags["json"] !== true) io.out(`Store: ${counterpart.store.dir}`);
    // A QUESTION is answered in FACTS MODE (Release B, 2026-10-03) — the same
    // path the MCP `recall` takes with `mode: "facts"` (`mcp/facts.ts`), so
    // the console cannot drift into a softer question path than the model
    // gets. Embedded in line, and every way it can decline said by name — the
    // same call the MCP `recall` makes (`mcp/deliberate.ts#embedQuestion`).
    if (idFlag.length === 0) {
      const embedded = await embedQuestion(embedder, question);
      const page = typeof parsed.flags["page"] === "string" && /^[1-9]\d*$/.test(parsed.flags["page"]) ? { page: Number(parsed.flags["page"]) } : {};
      // MEANING MODE: the arc, the MCP `recall`'s `mode: "meaning"` path. Whose
      // "I" a question about feeling means is the one thing the console adds:
      // a question typed here is the owner's, so his; one the dashboard turned
      // into my voice (`--voiced`) is mine. Its rendering is already short, so
      // there is no list form: `--json` is the payload, anything else the answer.
      if (modeFlag === "meaning") {
        const meaning = meaningRecall(
          {
            counterpart,
            sessionId: "console",
            owner: true,
            vector: embedded.vector,
            semantic: embedded.semantic,
            asker: parsed.flags["voiced"] === true ? "self" : "owner",
          },
          question,
          page,
        );
        io.out(parsed.flags["json"] === true ? JSON.stringify(meaning, null, 2) : renderMeaning(meaning));
        return EXIT.ok;
      }
      const facts = factsRecall(
        { counterpart, sessionId: "console", owner: true, vector: embedded.vector, semantic: embedded.semantic },
        question,
        page,
      );
      if (parsed.flags["json"] === true) {
        io.out(JSON.stringify(facts, null, 2));
        return EXIT.ok;
      }
      // SHORT BY DEFAULT (2026-09-24): a header in plain words and the top
      // few, numbered, two lines each. `--full` is the facts answer as the
      // model reads it — every result's labeled lines.
      if (parsed.flags["full"] === true) {
        io.out(renderFacts(facts));
        return EXIT.ok;
      }
      printAskList(
        io,
        facts,
        askChannel(facts.semantic, counterpart.store.embedderVerdict.kind, embedder),
        said,
        {
          learnedOn: (id) => facts.memories.find((m) => m.id === id)?.learned ?? null,
          dim: paint(io, env).dim,
        },
      );
      return EXIT.ok;
    }
    const result = deliberateRecall(counterpart, { handle: idFlag }, { sessionId: "console", owner: true });
    if (parsed.flags["json"] === true) {
      io.out(JSON.stringify(result, null, 2));
      return EXIT.ok;
    }
    io.out(
      `${result.path} · ${result.reason} · ` +
        // "live rows", not "live memories": the denominator counts schemas and
        // episodes too, so a store made with `install --name` reads one higher
        // than its memory count. Naming the population is cheaper than a second
        // number, and `status` prints the split.
        `${result.storeSize} live rows · returned ${result.memories.length}`,
    );
    if (result.memories.length === 0) {
      io.out("");
      // NOTHING CAME, said as a sentence rather than as an absence. A blank
      // where a memory would have been is the one output a reader cannot tell
      // from a crash, and the reason belongs in the same breath.
      io.out(`NOTHING CAME BACK — no memory has that id or that exact title.`);
      io.out(`  Ask a question instead: ${BIN.cli} ${said} "..."`);
      return EXIT.ok;
    }
    for (const m of result.memories) {
      io.out("");
      // THE JOURNAL SAYS SO (owner ruling, 2026-09-04 — LAUNCH-STATUS §I14). A
      // chapter stays recallable and is never presented as a memory; the word
      // rides in front of the kind.
      const journal = m.journal ? "[journal] " : "";
      io.out(`  ${m.id}  ${journal}${m.kind}${m.title === null ? "" : ` — ${m.title}`}`);
      // ITS STANDING, before the words (2026-09-29): earlier, corrected by,
      // replaced by, disagrees with, unsettled — so an old memory never reads as current.
      if (m.standing !== undefined) io.out(`    (${m.standing})`);
      for (const line of m.body.split("\n")) io.out(`    ${line}`);
      // The feelings on it, `you: … · me: …` (emotion part A). Read-only, and
      // a store that cannot answer simply shows none.
      let felt = "";
      try {
        const born = counterpart.store.physicsOf(m.id).birthDay;
        felt = feelingsLine(counterpart.store.feelingsFor(m.id), counterpart.store.livedDay() - born);
      } catch {
        felt = "";
      }
      if (felt !== "") io.out(`    feelings — ${felt}`);
    }
    if (result.memories.some((m) => m.journal)) {
      io.out("");
      io.out(
        "  journal = a chapter, the first-person account a memory was made from — not a memory, and outside decay and the prune.",
      );
    }
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * `ask`'s short answer (reshaped 2026-09-24, from the owner's first reading of
 * it on a real store): a header sentence, then at most `ASK_SHOWN` answers,
 * numbered, two lines each and a blank line between — the words first
 * (`askGist`), and under them a quieter line saying what it is, when, and its
 * id (`askMeta`), dimmed on a terminal that takes colour (`ui.ts#paint`: never
 * on a pipe unless FORCE_COLOR asks, never under NO_COLOR). What `--full`
 * prints is the facts answer as the model reads it (2026-10-03): the count
 * header, and every result's labeled lines — who said it, its status, when
 * it happened and when it was learned, whether it still holds.
 *
 * The count is facts mode's `matched` — every distinct fact that matched, not
 * only the page — when the result carries it.
 */
export function printAskList(
  io: Io,
  result: {
    readonly memories: readonly { readonly id: string; readonly title: string | null; readonly kind: string; readonly journal: boolean; readonly body: string; readonly faded?: boolean }[];
    readonly considered: number;
    readonly matched?: number;
  },
  how: string,
  said: string,
  opts: {
    /** The row's provenance date, by id — `askMeta`'s fallback date. */
    readonly learnedOn?: (id: string) => string | null;
    /** How the metadata line is quietened. Absent: plain. */
    readonly dim?: (s: string) => string;
  } = {},
): void {
  const found = Math.max(result.matched ?? 0, result.memories.length);
  if (found === 0) {
    io.out(`Nothing found (${how}).`);
    // A faded match is counted in `matched` and listed with the rest (2026-10-10).
    io.out(
      result.considered === 0
        ? "  Nothing in the store came near the question, so no memory was even scored."
        : `  ${result.considered} ${result.considered === 1 ? "memory was" : "memories were"} weighed and none was close enough to show.`,
    );
    io.out(`  Try words the memory itself would use, or ask for it by id: ${BIN.cli} ${said} --id <mem_...>`);
    return;
  }
  const shown = result.memories.slice(0, ASK_SHOWN);
  const counted = `${String(found)} ${found === 1 ? "memory" : "memories"} found, ${how}.`;
  io.out(found > ASK_SHOWN ? `${counted} The top ${String(ASK_SHOWN)}:` : counted);
  const dim = opts.dim ?? ((s: string) => s);
  const numberWidth = String(shown.length).length;
  shown.forEach((m, i) => {
    const mark = `  ${String(i + 1).padStart(numberWidth)}. `;
    io.out("");
    io.out(`${mark}${askGist(m.title, m.body)}`);
    // A chapter is never presented as a memory (LAUNCH-STATUS §I14): its
    // metadata line opens with `journal`.
    io.out(`${" ".repeat(mark.length)}${dim(`${askMeta(m, opts.learnedOn?.(m.id) ?? null)}${m.faded === true ? " · faded" : ""}`)}`);
  });
  io.out("");
  io.out(
    found > ASK_SHOWN
      ? "More: --full for all of them with detail, or --id <id> for one in full."
      : "More: --full for detail, or --id <id> for one in full.",
  );
}

// ── verify ──────────────────────────────────────────────────────────────────

/**
 * What box 3 holds right now, read WITHOUT going through `Store` — because
 * `Store` has no read API for it. `unembeddedCount()` is the coverage
 * denominator (live rows with no vector), not a count of the vectors held, and
 * the census needs the latter before it may drop anything.
 *
 * The direct open is the same deep import `snapshot.ts` and `export.ts` already
 * make (INTERFACE-GAPS §5): the CLI genuinely needs the database here, not the
 * store's abstraction of it. It is gated on the file EXISTING, because `openDb`
 * creates what it opens and a census that minted box 3 by looking at it would be
 * the instrument-mints-its-subject wart all over again (§7, closed 2026-08-26).
 */
interface CacheCensus {
  readonly path: string;
  /** False when box 3 has never been built here. Nothing was opened, nothing created. */
  readonly present: boolean;
  /** Null when the file is there and its tables are not — a half-built cache. */
  readonly counts: {
    readonly embeddings: number;
    readonly indexRows: number;
    readonly lengths: number;
    readonly ranking: number;
    /** The distinct ids the token index holds, for the set diff below. */
    readonly indexed: readonly string[];
    /**
     * Which SHAPE the vectors are in — float32 BLOB (v4) or JSON text (v3).
     * A census that counted them without saying which would not answer the one
     * question `migrate-cache` exists for, and a MIXED cache (an interrupted
     * migration) has to be visible: readers tolerate it, but it is not done.
     */
    readonly vectors: VectorFormatCensus;
  } | null;
  readonly why: string | null;
}

/**
 * THE BAND OF RECORD, RECONCILED (IMPROVEMENTS U8, 2026-09-14).
 *
 * `memories.band` is canonical and the ranking cache's `band` is derived, and
 * until this PR nothing kept them together: the decay phase wrote its reading
 * into box 3 alone, so on the live store 869 rows were semantic in the cache and
 * episodic in the table while the same pass emitted `band.transition` rows
 * saying they had moved. The ruling is that the TABLE FOLLOWS PHYSICS —
 * `sleep/decay.ts` now writes each row's band back when the column disagrees —
 * and this census is how that is checked rather than believed.
 *
 * THREE NUMBERS, because they are three different facts (scar §2.4):
 *   - `rows`      — live, non-journal rows: the population the column describes.
 *     The journal is not a memory and never earns a band (`sleep/types.ts`), and
 *     an archived or superseded row is deliberately outside box 3.
 *   - `disagree`  — the column contradicts the cache. After a decay pass that was
 *     not cut short by its budget (`sleep/tunables.ts` `BUDGETS.decay`, 20,000
 *     examined rows) this is 0, and a non-zero number means either no pass has
 *     run since this shipped or the store is larger than one pass and is still
 *     catching up, a budget's worth a day.
 *   - `unranked`  — live rows box 3 has never seen. Not a disagreement: there is
 *     nothing to disagree with. "Born since the last pass" is the ordinary
 *     cause and NOT the only one — `verify --rebuild` drops the `ranking` table
 *     with the rest of box 3 (`store/cache.ts#resetCache`) and repopulates only
 *     the index, so straight after a rebuild this reads EVERY live row until the
 *     next decay pass; a decay phase killed mid-body (`CycleKilled`, the
 *     watchdog) leaves everything it had not reached unranked the same way.
 */
interface BandOfRecordCensus {
  readonly rows: number;
  readonly disagree: number;
  readonly unranked: number;
}

function bandOfRecordCensus(store: Store): BandOfRecordCensus {
  const ranking = store.rankingAll();
  const denied = new Set(store.deniedIds());
  let rows = 0;
  let disagree = 0;
  let unranked = 0;
  for (const id of store.list({ archived: false })) {
    if (denied.has(id)) continue;
    const row = store.row(id);
    if (row === undefined || isJournal(row)) continue;
    rows += 1;
    const ranked = ranking.get(id);
    if (ranked === undefined) unranked += 1;
    else if (ranked.band !== row.band) disagree += 1;
  }
  return { rows, disagree, unranked };
}

function bandOfRecordLines(c: BandOfRecordCensus): string[] {
  const out = [
    `  band of record: ${c.disagree} of ${c.rows} live rows disagree with the ranking cache` +
      `   (${c.unranked} not yet ranked)`,
  ];
  if (c.disagree > 0) {
    out.push(
      "    The decay phase writes each band move back to `memories.band` (U8), so a pass that",
      "    its budget did not cut short leaves 0 here. A number that survives several boundaries",
      "    means no boundary has run since this store was built — or that the pass is truncating.",
    );
  }
  if (c.unranked > 0) {
    out.push(
      "    Unranked rows are rows box 3 has not read yet: ones born since the last decay pass,",
      "    everything after a `verify --rebuild` (the rebuild drops the ranking table and does not",
      "    refill it), and whatever a decay phase killed mid-body never reached. The next boundary",
      "    ranks them; a count that survives one is a decay phase that is not finishing.",
    );
  }
  return out;
}

function censusCache(dir: string): CacheCensus {
  const path = paths.cache(dir);
  if (!existsSync(path)) return { path, present: false, counts: null, why: "never built" };
  let db: Db | undefined;
  try {
    db = openDb(path);
    const handle = db;
    const n = (sql: string): number => handle.get<{ n: number }>(sql)?.n ?? 0;
    return {
      path,
      present: true,
      why: null,
      counts: {
        embeddings: n("SELECT COUNT(*) AS n FROM embeddings"),
        indexRows: n("SELECT COUNT(*) AS n FROM doc_tokens"),
        lengths: n("SELECT COUNT(*) AS n FROM doc_lens"),
        ranking: n("SELECT COUNT(*) AS n FROM ranking"),
        indexed: handle
          .all<{ memory_id: string }>("SELECT DISTINCT memory_id FROM doc_tokens")
          .map((r) => r.memory_id),
        vectors: vectorFormats(handle),
      },
    };
  } catch (err) {
    return { path, present: true, counts: null, why: String((err as Error).message ?? err) };
  } finally {
    db?.close();
  }
}

/**
 * One line naming the shape box 3's vectors are in, and — when it is mixed —
 * what to run. An empty table is neither format and says so.
 */
function vectorFormatLine(v: VectorFormatCensus): string {
  if (v.total === 0) return "none held";
  const parts: string[] = [];
  if (v.float32 > 0) parts.push(`${v.float32} float32 BLOB (v4)`);
  if (v.jsonText > 0) parts.push(`${v.jsonText} JSON text (v3)`);
  if (v.other > 0) parts.push(`${v.other} unreadable`);
  const tail =
    v.jsonText > 0
      ? " — 'counterparts migrate-cache' converts them in place (dry run by default)"
      : "";
  return `${parts.join(", ")}${tail}`;
}

/**
 * `verify` — the census by default, the rebuild only when asked, and never the
 * rebuild by accident.
 *
 * **The sharp edge this exists to blunt.** `rebuildCache()` begins with
 * `resetCache`, which DROPS `embeddings` along with the rest of box 3, and this
 * console has no embedder to put them back: on the store this was found against,
 * a bare `counterparts verify` would have deleted ~13,700 vectors that each cost
 * a paid network call to recompute. `store/cache.ts` says the same thing in its
 * own voice about `backfillLengths`. Until PR #37 a bare `verify` was saved only
 * by ACCIDENT — it failed the layout check before it reached the store — and an
 * accident is not a guard.
 *
 * So the destructive half now needs `--rebuild`, and even then it refuses while
 * box 3 holds vectors nothing here can recompute, unless `--drop-vectors` says
 * out loud that losing them is the intent.
 *
 * **2026-09-05: the third door.** Refuse-unless-flag was the adapter-level
 * answer while preserving the vectors needed a core change; that change now
 * exists (`Store.rebuildCache({ keepVectors })`), so `--keep-vectors` rebuilds
 * the text index and leaves `embeddings` in place. The refusals stay exactly as
 * they were and now name it, because the safe option being available is not a
 * reason to make the destructive one quieter.
 */
/**
 * Refuse a PRE-ROWS store before this command opens anything of its own.
 *
 * `Store.open` refuses it by name, and ~20 doors get that for free because they
 * open a `Store` first. Two do not: `migrate-cache` opens box 3 directly and
 * never sees a `Store` at all, and `verify --rebuild` opens box 3 for its
 * census before it opens box 2. Review A measured both writing into a parked
 * pre-rows store's `cache/` — a `-shm` in the fixture, and on the owner's real
 * parked store a `--apply` would rewrite and VACUUM ~17,000 documents' index in
 * a store this build has declared it cannot read.
 *
 * Box 3 is rebuildable and out of the backup set, so this is not memory loss.
 * It is a door writing where the build said it would not, and a rebuild of that
 * cache after a rollback is a paid re-embed.
 */
function refusePreRows(dir: string, io: Io): number | null {
  // TWO SHAPES, and only the first is a filename question. The second is a v5
  // database wearing the v6 NAME, which `preRowsMarkersIn` cannot see — review
  // f5c measured `migrate-cache` running to completion on one, and
  // `verify --rebuild` reaching box 3 before box 2 refused it.
  const found = preRowsMarkersIn(dir);
  const detail: Record<string, string | number> = { dir, expected: SCHEMA_VERSION };
  if (found.length > 0) detail["found"] = found.join(", ");
  else if (isPreRowsDatabase(paths.operational(dir))) {
    detail["found"] = DATABASE_FILE;
    detail["reason"] = "no-body-column";
  } else return null;
  io.err(
    describePreRowsRefusal(
      new StoreError("STORE_PRE_ROWS", detail),
      "Name a store with --dir <path>.",
    ) ?? `refused: ${dir} was written before this build's floor.`,
  );
  return EXIT.failed;
}

function verifyCommand(dir: string, io: Io, flags: Record<string, string | boolean | undefined>): number {
  // THE WRITING HALF NAMES ITS STORE (2026-09-05 ruling). The census is
  // read-only and stays open to `COUNTERPARTS_DATA_DIR`; these three are not.
  // `--drop-vectors` is guarded even though it is inert without `--rebuild`,
  // because it is a standing consent to lose embeddings and must never be
  // typed at a store the owner did not name.
  const writing =
    flags["rebuild"] === true
      ? (["verify --rebuild", "drops box 3 for the whole store and builds it again"] as const)
      : flags["prune-index"] === true
        ? ([
            "verify --prune-index",
            "deletes every archived and superseded row from the text index",
          ] as const)
        : flags["retry-skipped"] === true
          ? ([
              "verify --retry-skipped",
              "clears every embed.failed counter, so the backfill offers those ids again",
            ] as const)
          : flags["drop-vectors"] === true
            ? ([
                "verify --drop-vectors",
                "stands as consent to lose embeddings this console has no embedder to recompute",
              ] as const)
            : null;
  if (writing !== null) {
    const refusal = requireDirFlagForBulkWrite(dir, io, flags, writing[0], writing[1]);
    if (refusal !== null) return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  // BEFORE box 3 is opened, on every branch: `--rebuild`'s census opens the
  // cache before it opens box 2, so the refusal arrived after a `-shm` had
  // already moved (review A, MINOR-2).
  const preRowsRefusal = refusePreRows(dir, io);
  if (preRowsRefusal !== null) return preRowsRefusal;
  if (flags["rebuild"] !== true) {
    if (flags["prune-index"] === true) return verifyPruneIndex(dir, io);
    if (flags["retry-skipped"] === true) return verifyRetrySkipped(dir, io);
    return verifyCensus(dir, io);
  }
  // Both at once is a command line that contradicts itself, and guessing which
  // half the owner meant is the one thing a guard like this may not do.
  if (flags["drop-vectors"] === true && flags["keep-vectors"] === true) {
    io.err("refused: --drop-vectors and --keep-vectors say opposite things about the same rows.");
    return EXIT.refused;
  }
  return verifyRebuild(dir, io, flags["drop-vectors"] === true, flags["keep-vectors"] === true);
}

/**
 * `--prune-index` — the CHEAP repair, and the only one for a store that holds
 * vectors.
 *
 * The text index is the index of the live store (I13, `store/cache.ts#deindexDoc`):
 * `archive` and `supersede` take a row out of it, and a store written before
 * they did still holds its dead rows' tokens, where they go on counting toward
 * document frequency against a live denominator. The repair is a pure function
 * of what both boxes already hold, so — exactly like `backfillLengths` — it must
 * not be paid for with `--rebuild`, which drops every embedding.
 */
function verifyPruneIndex(dir: string, io: Io): number {
  const store = openStoreAt({ dir });
  try {
    const removed = store.pruneDeadIndex();
    io.out(`Store: ${dir}`);
    io.out(`Dropped from the text index (archived or superseded): ${removed}`);
    io.out(
      removed === 0
        ? "The index already held live rows only."
        : "Embeddings are untouched — this repair never resets box 3.",
    );
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * `--retry-skipped` — the way BACK for an id the backfill gave up on.
 *
 * A skip is not a denial: the memory is live, recallable and lexically indexed,
 * and only its vector is missing. But the skip is self-sealing —
 * `missingVectors` stops offering the id, so the backfill never tries it, so the
 * counter that caused the skip can never be cleared by a run that lands. Until
 * this flag the only remedy was editing box 2 by hand, and `verify` printed a
 * remedy ("repair it, or rebuild box 3") that could not work: a rebuild has no
 * embedder to recompute anything and never touches meta.
 *
 * So: clear every counter, name how many, and let the next boundary's backfill
 * decide again on the evidence. It writes nothing but those rows — no prose, no
 * index, no embeddings — which is why it is the one writing verify flag that can
 * lose nothing.
 */
function verifyRetrySkipped(dir: string, io: Io): number {
  const store = openStoreAt({ dir });
  try {
    const skipped = store.skippedVectorIds();
    const held = store.metaWithPrefix(EMBED_FAILED_PREFIX);
    const moves: [string, string][] = [];
    for (const [key, value] of held) {
      if (value !== "0") moves.push([key, "0"]);
    }
    if (moves.length > 0) store.setMetaMany(moves);
    io.out(`Store: ${dir}`);
    io.out(`Embed-failure counters cleared: ${moves.length}`);
    io.out(`Back in the backfill's rotation: ${skipped.length}`);
    if (skipped.length > 0) io.out(`  ${skipped.join(", ")}`);
    io.out(
      moves.length === 0
        ? "Nothing was being skipped; the backfill was already offering every live row."
        : "Nothing else changed. If the text is still poison they will be skipped again.",
    );
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * The durable event log, as `verify` prints it: what is held, how old the
 * oldest row is, and — the number this exists for — what the next cycle's log
 * sweep would delete. Before 2026-09-05 nothing swept the log at all
 * (`sleep/NOTES.md` §13); the first sweep on a store that has never been swept
 * is a deletion somebody should be able to see the size of BEFORE it runs,
 * which is what this read-only line is for. The cap is the sleep budget itself,
 * imported rather than restated, so the number printed is the number in force.
 */
export function eventLogLines(log: EventLogCensus, zone?: string): string[] {
  const cap = SLEEP_TUNABLES.BUDGETS.log;
  const wouldDelete = Math.min(log.eligible, cap);
  const oldest =
    log.oldestDay === null || log.oldestAt === null
      ? "oldest: none"
      : `oldest: lived day ${log.oldestDay} (${localDate(log.oldestAt, zone)})`;
  return [
    `Events: ${log.rows} held (${log.latched} latched records)   ${oldest}   ` +
      `window: ${log.retentionDays} lived days (cutoff day ${log.cutoffDay})`,
    `  past the window: ${log.eligible} unlatched (the next sleep pass deletes ${wouldDelete}, cap ${cap} per pass)` +
      `, ${log.latchedPastCutoff} latched records kept`,
  ];
}

/**
 * Read-only. Opens the store in OBSERVER stance and box 3 on its own connection,
 * one after the other rather than both at once, and writes nothing canonical.
 * (Constructing a `Store` still rewrites box 3's schema-version row when it is
 * out of date — dashboard INTERFACE-GAPS §1 — which is box 3's business.)
 */
function verifyCensus(dir: string, io: Io): number {
  const store = openStoreAt({ dir, observer: true });
  let canonical: string[];
  let live: string[];
  let denied: string[];
  let unembedded: number;
  let skippedVectors: string[];
  let faulted: string[];
  let schemaVersion: string | null;
  let log: EventLogCensus;
  let bands: BandOfRecordCensus;
  try {
    canonical = store.list();
    // What the INDEX is supposed to cover, since I13: the live rows. An
    // archived or superseded row is canonical and deliberately unindexed.
    live = store.list({ archived: false });
    denied = store.deniedIds();
    unembedded = store.unembeddedCount();
    // The other half of that sum since I33: ids the backfill has given up on
    // after `EMBED_SKIP_AFTER` failed runs. They are excluded from the count
    // above on purpose — it reports what is still actionable — so leaving them
    // unprinted here would be the coverage watch quietly losing rows.
    skippedVectors = store.skippedVectorIds();
    faulted = store.faultedIds();
    schemaVersion = store.getMeta("schemaVersion") ?? null;
    log = store.eventLogCensus();
    bands = bandOfRecordCensus(store);
  } finally {
    store.close();
  }

  const cache = censusCache(dir);
  io.out(`Store: ${dir}`);
  // How the boxes are being held open, on the day WAL landed: the mode is in the
  // file header, so this says what the NEXT process will find, not what this one
  // asked for. A store still reading `delete` means no writer on THIS build has
  // opened it since the deploy — or that one on the build before it has, since
  // that one set the mode unconditionally and would have set it back.
  io.out(
    `Journal mode: ${journalModeOf(paths.operational(dir))} (busy timeout ${BUSY_TIMEOUT_MS} ms)`,
  );
  io.out(
    `Canonical rows: ${canonical.length}   live rows: ${live.length}   ` +
      `removed (deny-list): ${denied.length}`,
  );
  // WHERE THE WORDS ARE. This was two census lines counting how the two path
  // columns were spelled and how many of their files were on disk (§5 G15,
  // finding I22) — a report ON the file layout, which the floor deleted along
  // with the columns. What replaces it is a one-line statement of the floor
  // this store is on, because "prose files: none" is the fact an owner looking
  // for his markdown needs, and a store that still had any would be a store
  // this build refused to open (`STORE_PRE_ROWS`).
  io.out(
    `Floor: schema v${schemaVersion ?? "?"} · bodies in rows · prose files: none` +
      (schemaVersion === String(SCHEMA_VERSION)
        ? ""
        : ` (this build writes v${SCHEMA_VERSION})`),
  );
  // ROWS WHOSE WORDS WENT MISSING, counted beside the floor line.
  //
  // One of these stands EVERY session down (`MEMORY_BODY_MISSING` out of
  // `Schemas.load`), and before this `verify` printed a green census over it
  // and exited 0 — the owner had a dead store and two surfaces telling him it
  // was fine (review B, MAJOR-3). Named, not just counted: the id is the only
  // handle there is on this floor.
  if (faulted.length > 0) {
    io.err(
      `Rows whose words are missing: ${String(faulted.length)} — ${faulted.slice(0, 5).join(", ")}` +
        (faulted.length > 5 ? ` and ${String(faulted.length - 5)} more` : "") +
        ". Each has an empty body and a content hash that still names it, which no write path " +
        "in this build produces. A session that loads a BELIEF or reads that memory stands down: " +
        "a faulted schema row takes every session with it, an ordinary memory only the reads that " +
        "reach it. Restore a snapshot over the store, or remove that row by id to tombstone it " +
        "and let sessions start again.",
    );
  }
  for (const line of eventLogLines(log, store.zone())) io.out(line);

  // The unreadable half of this is narrow by construction: `Store.open` builds
  // box 3 on the way in, so a cache this process cannot read usually fails the
  // open above and is reported there. It is still handled, because between that
  // close and this read is a window another process can change.
  if (cache.counts === null) {
    io.out(
      cache.present
        ? `Cache: ${cache.path} — unreadable (${cache.why ?? "no reason given"}).`
        : `Cache: absent — box 3 has never been built here.`,
    );
    if (canonical.length === 0) {
      io.out("Nothing canonical to index, so nothing is missing.");
      return EXIT.ok;
    }
    io.err(
      cache.present
        ? `${canonical.length} canonical rows and a cache that would not open — retry (another process may hold it); if it is truly gone, 'counterparts verify --rebuild' builds box 3 again.`
        : `${canonical.length} canonical rows have no index — run 'counterparts verify --rebuild' to build box 3.`,
    );
    return EXIT.failed;
  }

  // A SET DIFF, not arithmetic: `indexed + denied === canonical` can agree by
  // coincidence while holding the wrong ids, and it cannot say WHICH way it is
  // wrong. Both directions are named, because an orphaned index row and an
  // unindexed memory are different problems.
  const indexed = new Set(cache.counts.indexed);
  const known = new Set(canonical);
  const liveSet = new Set(live);
  const deniedSet = new Set(denied);
  const missing = live.filter((id) => !indexed.has(id) && !deniedSet.has(id));
  const orphans = cache.counts.indexed.filter((id) => !known.has(id));
  // A THIRD state, and it needs its own name and its own repair: an id that is
  // a canonical row but not a live one, still holding token rows. It is not an
  // orphan (the row exists) and it is not missing (it is there); it is a dead
  // row voting on document frequency against a live denominator, which is I13.
  // `--rebuild` would fix it and drop every embedding on the way; the cheap
  // repair is `--prune-index`.
  const stale = cache.counts.indexed.filter((id) => known.has(id) && !liveSet.has(id));

  io.out(`Cache: ${cache.path}`);
  io.out(
    `  indexed documents: ${indexed.size}   index rows: ${cache.counts.indexRows}   ` +
      `document lengths: ${cache.counts.lengths}   ranking rows: ${cache.counts.ranking}`,
  );
  io.out(`  embeddings: ${cache.counts.embeddings}   live memories with no vector: ${unembedded}`);
  for (const line of bandOfRecordLines(bands)) io.out(line);
  if (skippedVectors.length > 0) {
    io.out(`  skipped after repeated embed failures: ${skippedVectors.length}`);
    io.out(`    ${skippedVectors.join(", ")}`);
    io.out("    Not counted above: the backfill stopped offering them, so they cannot");
    io.out("    clear themselves by landing. Repair the text if it is the cause, then");
    io.out("    counterparts verify --dir <store> --retry-skipped puts them back in the");
    io.out("    rotation for the next boundary.");
  }
  io.out(`  indexed but not live (archived or superseded): ${stale.length}`);
  io.out(`  vector format: ${vectorFormatLine(cache.counts.vectors)}`);
  if (missing.length === 0 && orphans.length === 0 && stale.length === 0) {
    io.out("The cache covers every live row and holds nothing else.");
    // A faulted row outranks a clean cache: the store does not OPEN for a
    // session, so a zero exit here would be the second surface telling the
    // owner everything is fine while every session stands down.
    return faulted.length === 0 ? EXIT.ok : EXIT.failed;
  }
  if (missing.length === 0 && orphans.length === 0) {
    io.err(
      `Cache stale: ${stale.length} indexed ids are archived or superseded and still count toward rarity — ` +
        `'counterparts verify --prune-index' drops them and keeps the embeddings.`,
    );
    return EXIT.failed;
  }
  io.err(
    `Cache incomplete: ${missing.length} live rows are not indexed, ${orphans.length} indexed ids are not canonical rows, ` +
      `${stale.length} are canonical but not live — ` +
      `'counterparts verify --rebuild' rebuilds box 3.`,
  );
  return EXIT.failed;
}

/**
 * Rebuild box 3 from canonical state and report. The database is a cache: if
 * this ever loses something canonical, the claim was false and the report is
 * where it shows. What cannot be recomputed is DECLARED, with an owner and a
 * repair, rather than silently missing (§5 G8).
 *
 * The vector count is taken BEFORE a writable store is opened, so the refusal
 * path never constructs one.
 */
function verifyRebuild(dir: string, io: Io, dropVectors: boolean, keepVectors: boolean): number {
  const cache = censusCache(dir);
  // `--keep-vectors` re-indexes the text side and leaves `embeddings` alone
  // (`Store.rebuildCache({ keepVectors })`, the core follow-up this console
  // filed in NOTES on 2026-09-04 and could not do adapter-side). Nothing is at
  // risk, so neither guard below applies — and an unreadable census is no
  // longer a reason to refuse, because the count it could not take was only
  // ever the count of what would be LOST.
  if (keepVectors) {
    const store = openStoreAt({ dir });
    try {
      const canonical = store.list().length;
      const report = store.rebuildCache({ keepVectors: true });
      io.out(`Canonical rows: ${canonical}`);
      io.out(`Re-indexed: ${report.indexed}`);
      io.out(`Skipped as removed (deny-list): ${report.skippedDenied}`);
      io.out(`Vectors kept: ${report.keptVectors}   dropped as no longer canonical: ${report.droppedVectors}`);
      io.out(`Not recomputed: ${report.unrecomputed}`);
      const accounted = report.indexed + report.skippedDenied;
      if (accounted !== canonical) {
        io.err(`MISMATCH: ${canonical} canonical rows, ${accounted} accounted for.`);
        return EXIT.failed;
      }
      io.out("Every canonical row is accounted for.");
      return EXIT.ok;
    } finally {
      store.close();
    }
  }
  // FAIL CLOSED. A count that could not be taken is not a count of zero: box 3
  // is the file the Stop-hook worker writes vectors into, so "database is
  // locked" after the busy timeout is an ordinary outcome here — and a guard
  // whose failure mode is "could not count the vectors, so dropped them" is not
  // a guard. An ABSENT cache is different and stays fine: there is nothing to lose.
  if (cache.present && cache.counts === null && !dropVectors) {
    io.err(
      `Refusing: box 3 exists but could not be read (${cache.why ?? "no reason given"}), so this console cannot tell how many embeddings --rebuild would drop — retry, pass --keep-vectors to rebuild the text index and keep them, or --drop-vectors to proceed anyway.`,
    );
    return EXIT.refused;
  }
  const held = cache.counts?.embeddings ?? 0;
  const vectors = `${held} ${held === 1 ? "embedding" : "embeddings"}`;
  if (held > 0 && !dropVectors) {
    io.err(
      `Refusing: --rebuild drops box 3 and this console has no embedder, so the ${vectors} it holds would be gone and each one costs a paid network call to recompute — pass --keep-vectors to rebuild the text index and keep them, or --drop-vectors if losing them is what you mean.`,
    );
    return EXIT.refused;
  }
  const store = openStoreAt({ dir });
  try {
    const canonical = store.list().length;
    const report = store.rebuildCache();
    io.out(`Canonical rows: ${canonical}`);
    if (held > 0) io.out(`Dropped on your say-so (--drop-vectors): ${vectors}.`);
    io.out(`Re-indexed: ${report.indexed}`);
    io.out(`Skipped as removed (deny-list): ${report.skippedDenied}`);
    io.out(`Skipped as not live (archived or superseded): ${report.skippedArchived}`);
    io.out(`Not recomputed: ${report.unrecomputed}`);
    for (const declared of report.declared) {
      io.out(`  declared: ${declared.what} — owner ${declared.owner}; repair: ${declared.repair}`);
    }
    const accounted = report.indexed + report.skippedDenied + report.skippedArchived;
    if (accounted !== canonical) {
      io.err(`MISMATCH: ${canonical} canonical rows, ${accounted} accounted for.`);
      return EXIT.failed;
    }
    io.out("Every canonical row is accounted for.");
    reclaimFreedPages(dir, io);
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * VACUUM both databases, then checkpoint — the named command a removal points at
 * when it could not do this itself.
 *
 * `cli/removal.ts#reclaim` runs the same two statements at the end of every
 * chase, because blanking a long body leaves whole OVERFLOW pages on the
 * freelist still holding the words (the third review's NEW-MAJOR-1). When that
 * is contended the removal says so and names this command — so this command has
 * to actually do it. It did not: measured, `verify --rebuild` left the residue
 * exactly where it was, because rebuilding box 3 says nothing about box 2's free
 * list.
 *
 * Runs after the rebuild has finished with the store, and never throws: a
 * failure here is a line, not a lost rebuild.
 */
function reclaimFreedPages(dir: string, io: Io): void {
  for (const [path, name] of [
    [paths.operational(dir), "the database"],
    [paths.cache(dir), "the cache"],
  ] as const) {
    if (!existsSync(path)) continue;
    let db;
    try {
      db = openDb(path);
      db.exec("VACUUM");
      db.get("PRAGMA wal_checkpoint(TRUNCATE)");
      io.out(`Reclaimed free pages in ${name}.`);
    } catch (err) {
      io.err(
        `Could not reclaim free pages in ${name} (${String((err as Error).message ?? err)}). ` +
          "Words from a removed memory may remain in pages no row points at; run this again " +
          "when nothing else is holding the store.",
      );
    } finally {
      try {
        db?.close();
      } catch {
        /* a handle that will not close has already said what it could */
      }
    }
  }
}

// ── migrate-cache ───────────────────────────────────────────────────────────

/** One line when the post-VACUUM fold could not finish: the pages are safe in
 *  `-wal`, and the file shrinks when the next writer (or checkpoint) folds it. */
function foldNote(io: Io, fold: WalFold): void {
  if (!fold.busy && fold.error === undefined) return;
  io.out(
    "The file on disk shrinks to that size once other Counterparts processes (an open session or the dashboard) let go of it.",
  );
}

/** Bytes, in the units an owner reads. Box 3 is measured in hundreds of MiB. */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/**
 * How big the database IS: `page_count * page_size`, off the open handle, which
 * is true wherever the pages happen to be sitting.
 *
 * Since WAL landed (2026-09-18) the file on disk is not the database — committed
 * pages live in the `-wal` until a checkpoint moves them in — so `statSync` alone
 * under-reports a busy cache (measured: 1.8 MiB of file with 3.7 MB in the
 * sidecar). Adding the `-wal` to the file is not the fix either, and was the
 * first cut of this: the `-wal` holds COPIES of pages the main file already
 * counts, so a fat one read as space a `VACUUM` would give back — 4,144,752
 * bytes of "reclaimable" on a cache with nothing to reclaim (review MAJOR-1).
 * What gives those bytes back is a CHECKPOINT, and a checkpoint happens on its
 * own. Two pragmas cost nothing, take no lock, and say what a VACUUM is being
 * compared against.
 */
function databaseBytes(db: Db): number {
  const pages = db.get<{ page_count: number }>("PRAGMA page_count")?.page_count ?? 0;
  const pageSize = db.get<{ page_size: number }>("PRAGMA page_size")?.page_size ?? 0;
  return pages * pageSize;
}

/**
 * How many bytes a `VACUUM` would give back, MEASURED — `VACUUM INTO` a
 * throwaway copy outside the data dir, stat it, delete it.
 *
 * The obvious cheap probe is wrong here and was tried: `PRAGMA freelist_count`
 * reads **0** on a cache whose rows were rewritten from ~12.7 KiB of text to
 * 4 KiB of blob, because the pages are not free, they are FRAGMENTED — the win
 * is defragmentation. On a store measured mid-review, `freelist_count = 0` and
 * a real `VACUUM` still took 3,756,032 bytes to 1,544,192 (59%). A probe that
 * reads zero where the answer is 59% is worse than no probe.
 *
 * `VACUUM INTO` is read-only on the source (it is what `backup` already uses),
 * and the copy lands in the OS temp dir, never beside the store — box 3's
 * directory is classified and a stray file there is a store that will not open
 * (§5 G11). Returns null when the probe cannot run, which is not an error: it
 * means this run has no number, and it says so rather than guessing one.
 */
function reclaimableBytes(db: Db): number | null {
  const probeDir = mkdtempSync(join(tmpdir(), "counterparts-vacuum-probe-"));
  const probe = join(probeDir, "compacted.sqlite");
  try {
    db.run("VACUUM INTO ?", probe);
    return Math.max(0, databaseBytes(db) - statSync(probe).size);
  } catch {
    return null;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

/** Worth compacting: more than a MiB, and more than a twentieth of the file. */
function worthCompacting(reclaimable: number | null, size: number): boolean {
  return reclaimable !== null && reclaimable > 1024 * 1024 && reclaimable > size / 20;
}

/**
 * `migrate-cache` — convert box 3's vectors from JSON text to float32 BLOBs,
 * IN PLACE, and compact the file afterwards.
 *
 * **Why this is a command and not `verify --rebuild`.** A rebuild recomputes;
 * the thing that would have to recompute here is an EMBEDDER, and this console
 * wires none — so `--rebuild` as the migration means "delete ~13,700 vectors
 * that cost a paid network call each and hope something puts them back"
 * (`cli/NOTES.md`, 2026-09-04). The information needed to write the new shape
 * is already in the old one. Converting is a read and a write of the same
 * numbers, so the migration is a conversion.
 *
 * Six properties, each one a rule this console already has:
 *
 *   1. **The dry run is READ-ONLY, not merely honest.** It opens box 3 with
 *      `openDb`, never `openCache`: the migrating constructor stamps
 *      `cache_meta.schemaVersion`, and on the v3 store this will actually be run
 *      against that one row changed the file's hash under a line that said
 *      nothing had changed. Every question the dry run asks is a `SELECT`.
 *   2. **`--apply` names its store out loud.** The destination is the `--dir`
 *      FLAG, typed on this line, and nothing else — not the default, and (since
 *      the 2026-09-05 ruling) not `COUNTERPARTS_DATA_DIR` either, which is a
 *      shell's memory rather than a sentence about this rewrite. Then it asks,
 *      `remove`-style, unless `--yes`.
 *   3. **Transactional per batch, and therefore resumable.** One transaction per
 *      `--batch` rows, not one over the whole table: box 3 is the file the
 *      Stop-hook worker writes into, `BUSY_TIMEOUT_MS` is five seconds, and a
 *      single transaction over 13.9K rows would hold the write lock for the
 *      whole rewrite. An interrupted run leaves a MIXED cache, which every
 *      reader already tolerates (`cache.ts#decodeVector`), and re-running
 *      finishes it.
 *   4. **A row that will not parse costs one row.** It is skipped, counted and
 *      NAMED, and the walk continues past it — the first version rolled its
 *      batch back and then re-selected the same row forever.
 *   5. **Idempotent, and it refuses rather than pretending.** The batch selects
 *      on `typeof(vec) = 'text'`, so a converted row is never touched twice, and
 *      `--apply` with nothing to convert AND nothing to reclaim exits REFUSED
 *      with the counts, because "I did nothing" and "I converted your store"
 *      must not look the same on a terminal.
 *   6. **Compaction is reachable on its own.** The rewrite frees space that only
 *      a `VACUUM` returns, and `VACUUM` is exactly the step most likely to fail
 *      — it takes an exclusive lock, and the worker holds box 3. So a store that
 *      is CONVERTED BUT NOT COMPACTED is a real state with a door: the dry run
 *      reports the reclaimable bytes and `--apply` compacts them. Without that
 *      door, one lost lock stranded 177 MiB behind an "already converted"
 *      refusal — the whole debt, unreachable through the tool that exists to pay
 *      it.
 *
 * It never opens a `Store`: box 3 only, gated on the file EXISTING so the
 * command cannot mint the box it migrates.
 */
async function migrateCacheCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): Promise<number> {
  const apply = flags["apply"] === true;
  // FIRST, before this command looks at a single path. `resolveDir` falls
  // through to `dataDir()`, which on the owner's machine is his live memory,
  // and this command's own PR says the merge is reversible and the `--apply`
  // is not. A guard that reads the default directory before refusing it has
  // already been pointed at the store it meant to refuse.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "migrate-cache --apply",
      "rewrites every vector in box 3",
    );
    if (refusal !== null) return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  // This command never opens a `Store`, so it never met the refusal every other
  // door gets for free (review A, MINOR-1).
  const preRowsRefusal = refusePreRows(dir, io);
  if (preRowsRefusal !== null) return preRowsRefusal;
  const path = paths.cache(dir);
  if (!existsSync(path)) {
    io.err(
      `no cache at ${path} — box 3 has never been built here, so there are no vectors to convert.`,
    );
    return EXIT.failed;
  }
  const batch = (() => {
    const raw = flags["batch"];
    if (typeof raw !== "string") return 500;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 500;
  })();

  // READ-ONLY for the report: `openDb` opens what is there and stamps nothing.
  // `openCache` — which brings an out-of-date box 3 up to the current schema —
  // is reserved for `--apply`, below, where a write is the point.
  const db = openDb(path);
  const sizeBefore = databaseBytes(db);
  let census: VectorFormatCensus;
  let stamped: string | null;
  try {
    census = vectorFormats(db);
    stamped =
      db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value ??
      null;

    io.out(`Store: ${dir}`);
    io.out(
      `Cache: ${path}  (${humanBytes(sizeBefore)}, schema ${stamped === null ? "unstamped" : `v${stamped}`}` +
        `${stamped === String(CACHE_SCHEMA_VERSION) ? "" : ` — v${CACHE_SCHEMA_VERSION} once anything opens it for writing`})`,
    );
    io.out(
      `Vectors: ${census.total}   float32 BLOB: ${census.float32}   JSON text: ${census.jsonText}` +
        (census.other > 0 ? `   unreadable: ${census.other}` : ""),
    );
    io.out(
      `  bytes in vec: JSON text ${humanBytes(census.jsonTextBytes)}, ` +
        `float32 ${humanBytes(census.float32Bytes)}`,
    );

    if (census.jsonText === 0) {
      // Converted. The remaining question is whether the file was ever
      // compacted — the step most likely to have failed, and the one the
      // "already converted" refusal used to hide.
      const reclaimable = reclaimableBytes(db);
      const worth = worthCompacting(reclaimable, sizeBefore);
      io.out("");
      if (reclaimable === null) {
        io.out("Converted. Could not measure whether the file is compacted (the probe would not run).");
      } else if (worth) {
        io.out(
          `Converted, NOT yet compacted: ${humanBytes(reclaimable)} reclaimable of ${humanBytes(sizeBefore)}.`,
        );
      } else {
        io.out(`Converted and compacted. Nothing to do.`);
      }
      if (!apply) {
        if (worth) io.out("Re-run with --apply to compact (it converts nothing — there is nothing left to convert).");
        return EXIT.ok;
      }
      if (!worth) {
        io.err(
          `Refusing: box 3 holds no JSON-text vectors and has nothing worth reclaiming — it is already float32. Nothing was written.`,
        );
        return EXIT.refused;
      }
      const ok = await confirmMigrate(io, flags, dir, `compact box 3 (${humanBytes(reclaimable ?? 0)} reclaimable)`);
      if (!ok) return EXIT.refused;
      const { sizeAfter, fold } = (() => {
        const writable = openCache(path);
        try {
          writable.exec("VACUUM");
          // Under WAL the VACUUM's pages sit in `-wal` until a checkpoint; fold
          // them so the reclaim below is true of the file on disk.
          return { sizeAfter: databaseBytes(writable), fold: foldWal(writable) };
        } finally {
          writable.close();
        }
      })();
      io.out(
        `Cache file: ${humanBytes(sizeBefore)} → ${humanBytes(sizeAfter)} ` +
          `(reclaimed ${humanBytes(Math.max(0, sizeBefore - sizeAfter))}).`,
      );
      foldNote(io, fold);
      return EXIT.ok;
    }

    // The projection is arithmetic on the rows themselves, not an average: a
    // store whose vectors are not all the same width would make a mean lie.
    const projected =
      db.get<{ b: number | null }>(
        "SELECT SUM(dim) * 4 AS b FROM embeddings WHERE typeof(vec) = 'text'",
      )?.b ?? 0;
    io.out(
      `  after conversion those ${census.jsonText} rows hold ${humanBytes(projected)} ` +
        `(${census.jsonTextBytes > 0 ? (census.jsonTextBytes / Math.max(projected, 1)).toFixed(1) : "?"}× smaller)`,
    );

    // ONE sample row, decoded both ways. Vectors are not prose, so printing a
    // few of a memory's coordinates discloses nothing a census does not.
    const sample = db.get<{ memory_id: string; dim: number; vec: SqlValue }>(
      "SELECT memory_id, dim, vec FROM embeddings WHERE typeof(vec) = 'text' ORDER BY memory_id LIMIT 1",
    );
    if (sample !== undefined) {
      try {
        const asIs = Array.from(decodeVector(sample.vec));
        const converted = Array.from(decodeVector(encodeVector(asIs)));
        const drift = asIs.reduce((m, v, i) => Math.max(m, Math.abs(v - (converted[i] ?? 0))), 0);
        const show = (v: readonly number[]): string =>
          v.slice(0, 4).map((x) => x.toPrecision(9)).join(", ");
        io.out("");
        io.out(
          `Sample: ${sample.memory_id}  dim ${sample.dim}  (${String(sample.vec).length} chars of JSON)`,
        );
        io.out(`  now:   [${show(asIs)}, …]`);
        io.out(`  after: [${show(converted)}, …]`);
        io.out(`  largest coordinate change in this row: ${drift.toExponential(3)}`);
        const nonFinite = countNonFinite(asIs);
        if (nonFinite > 0) io.out(`  ${nonFinite} non-finite coordinates in this row become 0`);
      } catch {
        io.out("");
        io.out(`Sample: ${sample.memory_id} — its vec does not parse; the migration will skip and name it.`);
      }
    }
  } finally {
    db.close();
  }

  if (!apply) {
    io.out("");
    io.out("Dry run. Nothing was changed — every question above was a read.");
    // NAME THE PROTECTION THAT EXISTS. This line used to say "take a
    // 'counterparts backup' first", which protects nothing here: box 3 is on
    // the backup set's explicit EXCLUSION list ("cache — Box 3 — rebuildable",
    // `store/paths.ts#LAYOUT`), so a snapshot taken before `--apply` contains
    // no copy of the file `--apply` rewrites. The only thing that does is a
    // copy of the file itself — and a copy of a database another process is
    // writing is not a backup (scar §2.11), which is why the sentence says
    // with nothing open rather than leaving that to be discovered.
    io.out(
      `First, copy box 3 aside — 'counterparts backup' skips the cache on purpose (it is rebuildable), so it does not cover this:`,
    );
    io.out(`  cp ${path} ${path}.bak-<date>`);
    io.out(`  cp ${path}-wal ${path}-wal.bak-<date>   (when it is there)`);
    io.out(`  (with every session closed — a copy of a database being written is not a copy of it —`);
    io.out(`   and BOTH files: since WAL the database file alone is not the database, its '-wal' holds`);
    io.out(`   every page committed since the last checkpoint, so a copy without it is silently short)`);
    io.out(`Then re-run with --apply to convert (batches of ${batch}).`);
    return EXIT.ok;
  }

  const ok = await confirmMigrate(io, flags, dir, `convert ${census.jsonText} vectors in box 3`);
  if (!ok) return EXIT.refused;

  const writable = openCache(path);
  try {
    let converted = 0;
    let coerced = 0;
    let batches = 0;
    const skipped: string[] = [];
    let after: string | undefined;
    for (;;) {
      const report = convertVectorBatch(writable, batch, after);
      if (report.examined === 0) break;
      converted += report.converted;
      coerced += report.coerced;
      skipped.push(...report.skipped);
      batches += 1;
      // Walk PAST what was examined, so a skipped row is not re-selected
      // forever. `lastId` is non-null whenever `examined > 0`.
      after = report.lastId ?? undefined;
      if (after === undefined) break;
    }
    io.out("");
    io.out(`Converted ${converted} vectors in ${batches} ${batches === 1 ? "batch" : "batches"}.`);
    if (coerced > 0) io.out(`Coerced ${coerced} non-finite coordinates to 0 (a NaN is not a coordinate).`);
    for (const id of skipped) io.out(`  SKIPPED, left exactly as it was: ${id} — its vec does not parse.`);
    const after2 = vectorFormats(writable);
    io.out(`Vectors now: float32 BLOB ${after2.float32}, JSON text ${after2.jsonText}`);
    // Free pages are not free space until the file is rewritten, and the whole
    // debt this pays is file size. VACUUM runs outside any transaction, and it
    // is the step that fails first when another process holds box 3 — so its
    // failure is REPORTED with the way back in, never swallowed.
    let vacuumed = true;
    try {
      writable.exec("VACUUM");
    } catch (err) {
      vacuumed = false;
      io.err(
        `The conversion is committed; the VACUUM that reclaims the space did not run (${String((err as Error).message ?? err)}). ` +
          `Re-run 'counterparts migrate-cache --dir ${dir} --apply' with no session open to compact it.`,
      );
    }
    const sizeAfter = databaseBytes(writable);
    if (vacuumed) {
      // Fold the VACUUM's pages out of `-wal`, so the reclaim is true on disk.
      const fold = foldWal(writable);
      io.out(
        `Cache file: ${humanBytes(sizeBefore)} → ${humanBytes(sizeAfter)} ` +
          `(reclaimed ${humanBytes(Math.max(0, sizeBefore - sizeAfter))}).`,
      );
      foldNote(io, fold);
    }
    if (skipped.length > 0) return EXIT.failed;
    return after2.jsonText === 0 && vacuumed ? EXIT.ok : EXIT.failed;
  } finally {
    writable.close();
  }
}

/**
 * The one human in the loop. `--yes` is the non-interactive door (a script, the
 * install loop); without it and without a prompt, this refuses rather than
 * proceeding unconfirmed — the console's rule 2, and the same shape `remove`
 * uses, one notch softer because this destroys no memory.
 */
async function confirmMigrate(
  io: Io,
  flags: Record<string, string | boolean | undefined>,
  dir: string,
  what: string,
): Promise<boolean> {
  if (flags["yes"] === true) return true;
  io.out("");
  io.out(`About to ${what} at ${dir}.`);
  if (io.prompt === undefined) {
    io.err("refused: this is not an interactive console — pass --yes if that is what you mean.");
    return false;
  }
  // Exactly `yes`, through `typed()`: Esc, an empty Enter and `cancel` are the
  // person stopping, and say so; anything else is "not confirmed".
  const said = await typed(io, "yes", `Type 'yes' to proceed — Esc or "cancel" to stop: `);
  if (said === "cancelled") {
    io.out("Cancelled. Nothing has changed.");
    return false;
  }
  if (said !== "typed") {
    io.err("refused: not confirmed. Nothing has changed.");
    return false;
  }
  return true;
}


// ── backup ──────────────────────────────────────────────────────────────────

function backupCommand(
  dir: string,
  io: Io,
  out: string | boolean | undefined,
  now: () => number,
): number {
  if (typeof out !== "string" || out.length === 0) {
    io.err("backup needs --out <dir>");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  // §5 G8: A BACKUP NEVER THROWS — and OPENING the store is part of the backup.
  // That is the part that threw in the field: a store held by another process's
  // write transaction answered "database is locked" before `snapshot()`'s own
  // graceful path could be reached (live-verify 2026-08-25). An open that fails
  // is now an ordinary failure report with an exit code.
  let store: Store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.out(`Snapshot: none — nothing was copied.`);
    io.err(`  ${openRefusalLine(err, dir)}`);
    return EXIT.failed;
  }
  try {
    const target = join(out, snapshotName(now()));
    const report = snapshot(store, target);
    io.out(`Snapshot: ${report.target}`);
    for (const entry of report.copied) {
      io.out(`  ${entry.ok ? "ok  " : "FAIL"} ${entry.name}  (${entry.method}, ${entry.files} files)`);
    }
    for (const entry of report.excluded) io.out(`  --   ${entry.name}  — ${entry.why}`);
    for (const error of report.errors) io.err(`  ${error}`);
    // §5 G8: a backup problem is reported, never thrown — it must not be able
    // to take a consolidation cycle down with it.
    return report.ok ? EXIT.ok : EXIT.failed;
  } finally {
    store.close();
  }
}

// ── export ──────────────────────────────────────────────────────────────────

function exportCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
  observer: boolean,
): number {
  const out = flags["out"];
  if (typeof out !== "string" || out.length === 0) {
    io.err("export needs --out <dir>");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  // AN EXPORT IS A READ, and a store this build cannot open refuses BEFORE the
  // target directory is created — nothing is touched on either side. The
  // sentence is the one every other door prints for the same refusal
  // (`describeDirRefusal` → `describePreRowsRefusal`), never a bare code and a
  // JSON blob (review f5a MINOR-3, f5c NEW-MINOR-3).
  //
  // It opens WRITABLE unless the console has stood down, for one reason: the
  // durable `store.export` row. Until it existed, an export that ran and an
  // export that never had were the same silence — the §2.4 gap the snapshot row
  // closed for the automatic copy. Under `--observer` the copy is still made and
  // the row is not, and the report says which (an instrument does not write to
  // the store it is reading, the durable row included).
  let store: Store;
  try {
    store = openStoreAt({ dir, observer });
  } catch (err) {
    io.err(`export refused: ${describeDirRefusal(err, dir)}`);
    return EXIT.refused;
  }
  try {
    const markdown = flags["markdown"] === true;
    const report = exportStore(store, {
      target: out,
      ...(typeof flags["passphrase"] === "string" ? { passphrase: flags["passphrase"] } : {}),
      ...(flags["plaintext"] === true ? { plaintext: true } : {}),
      ...(markdown ? { markdown: true } : {}),
      ...(flags["include-confidential"] === true ? { includeConfidential: true } : {}),
      ...(flags["with-versions"] === true ? { versions: true } : {}),
      ...(flags["into-non-empty"] === true ? { intoNonEmpty: true } : {}),
      ...(flags["overwrite"] === true ? { overwrite: true } : {}),
    });
    if (!report.ok) {
      io.err(report.reason);
      return EXIT.refused;
    }
    io.out(`Exported ${report.files} files (${report.bytes} bytes) to ${report.target}`);
    io.out(`Kind: ${report.kind}. Mode: ${report.mode}. ${report.reason}`);
    // WHAT THE COPY LEAVES OUT, said in the words retention makes true (remember
    // INTERFACE-GAPS §12, LAUNCH-STATUS §I3): the raw capture is not a memory,
    // no export kind carries it, and a person taking "a copy of my memory"
    // somewhere should not have to discover which half stayed behind.
    io.out(
      "Not included: spans/ — the raw captured conversation, kept 7 days after a session ends, or for as long as it waits to be written up.",
    );
    // THE DURABLE ROW. Counts and flags only: which kind, how many rows went,
    // how many confidential ones were left out, whether it was sealed. NOT the
    // target — where the owner sent his memories is more than the row needs to
    // prove the door works (§5 G10), and the terminal has already said it.
    if (!observer) {
      try {
        store.appendEvent({
          name: STORE_EXPORT_EVENT,
          day: store.livedDay(),
          payload: {
            date: store.today(),
            kind: report.kind,
            encrypted: report.mode === "encrypted",
            files: report.files,
            bytes: report.bytes,
            rows: report.rows,
            omittedConfidential: report.omittedConfidential,
            versions: flags["with-versions"] === true,
            notRendered: report.notRendered.length,
            // The nights, counted apart from `rows` (2026-10-09): the
            // dashboard reads `rows` as memories.
            dreams: report.dreams,
            reflections: report.reflections,
            omittedDreams: report.omittedDreams,
            omittedReflections: report.omittedReflections,
          },
        });
      } catch {
        /* a copy that was made is not undone by a row that could not be written */
      }
    } else {
      io.out(
        "No store.export row was written: this console is in observer stance, and an instrument does not write to the store it is reading.",
      );
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}

// ── remove ──────────────────────────────────────────────────────────────────

/**
 * THE LOUD REMOVAL, and since 2026-09-22 it has two doors into the same path
 * (the owner's answer 7 after the 0.2.0 trial).
 *
 *   - **The scripted door** — `--confirm`, or any console that cannot ask (a
 *     pipe, a CI job, a test with no answers): exactly what it did before the
 *     other door existed. The plan, then the typed-back id, or the dry run that
 *     says to re-run with `--confirm`.
 *   - **The interactive door** — a terminal with no `--confirm`: it asks for an
 *     id or for words to search for, numbers what it finds, takes a pick, and
 *     asks ONCE.
 *
 * Nothing about the destruction path changes between them, and nothing about it
 * changed to add the second: `removal.ts` still plans, records, darkens and
 * chases in that order, and this is a front door. Nothing about it is fast
 * either, and that is the design: removal has never fired in production in any
 * generation (§7 OQ2), which by scar §2.17's own criterion makes it unproven
 * rather than sound. The friction is what makes it safe to have at all.
 */
async function removeCommand(
  dir: string,
  io: Io,
  env: Record<string, string | undefined>,
  positional: readonly string[],
  flags: Record<string, string | boolean | undefined>,
  now: () => number,
): Promise<number> {
  // WHICH DOOR — `isInteractive`, the same test `install` splits on, and not a weaker one.
  //
  // The first version of this asked `io.prompt === undefined`, which is stdin
  // alone (`bin/counterparts.ts` binds the prompt on `process.stdin.isTTY`).
  // The adversarial review took that apart on the command that can least afford
  // it (B1): with stdout redirected to a file the question `readline` writes
  // goes into the FILE, so `counterparts remove <id> > log` asked nothing a
  // person could see and deleted the memory on the `y` they were typing for
  // something else — and a CI job with a pty got a live delete where it had
  // always got a dry run. `isInteractive` wants the prompt, BOTH streams to be
  // terminals, and `CI` unset, so every pipe, every redirect, every CI job and
  // every test console falls to the scripted door exactly as before.
  //
  // It also keeps the dry run reachable at a terminal — `remove <id> | cat` —
  // which is what `--strike-by-content-across-scopes`'s own help tells a person
  // to look at first.
  if (flags["confirm"] === true || !isInteractive(io, env)) {
    return removeByIdCommand(dir, io, positional[0], flags, now);
  }
  return removeInteractively(dir, io, positional, flags, now);
}

/** The two plan knobs, read once and shared by both doors. */
function removalPlanOptions(
  flags: Record<string, string | boolean | undefined>,
): { crossScopeContent: boolean; echoScanMax?: number } {
  const crossScopeContent = flags["strike-by-content-across-scopes"] === true;
  // HOW MANY EPISODES THE JOURNAL-ECHO CHECK READS. Injectable so the bound can
  // be proved REPORTED rather than silent; absent, the module's own applies.
  const echoScanRaw = typeof flags["echo-scan"] === "string" ? Number(flags["echo-scan"]) : NaN;
  return {
    crossScopeContent,
    ...(Number.isFinite(echoScanRaw) && echoScanRaw >= 0
      ? { echoScanMax: Math.floor(echoScanRaw) }
      : {}),
  };
}

/**
 * THE SCRIPTED DOOR, unchanged since before the interactive one existed: the
 * plan, then `--confirm` plus the id typed back, or a dry run that changes
 * nothing. Every sentence it prints is the sentence it printed, because a script
 * reading this output is a caller nobody can ask about a rewording.
 */
async function removeByIdCommand(
  dir: string,
  io: Io,
  raw: string | undefined,
  flags: Record<string, string | boolean | undefined>,
  now: () => number,
): Promise<number> {
  // TRIMMED, on BOTH doors and in the same place (review m4). `remove "mem_x "`
  // used to remove through one door and say `unknown-id` through the other,
  // which is a console disagreeing with itself about which id was named. It can
  // only ever turn a refusal into the removal of the id plainly typed: a lookup
  // of `"mem_x "` matches no row, here or anywhere.
  const targetId = raw?.trim();
  if (targetId === undefined || targetId.length === 0) {
    io.err("remove needs a memory id");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }

  const planOpts = removalPlanOptions(flags);

  // THE PLAN, made read-only and with no lock held (scar E5).
  const planning = openStoreAt({ dir, observer: true });
  let plan;
  try {
    plan = planRemoval(planning, targetId, planOpts);
  } finally {
    planning.close();
  }
  if (!plan.valid) {
    io.err(removalRefusalLine(plan.reason, targetId));
    return EXIT.refused;
  }

  printRemovalPlan(io, plan);

  if (flags["confirm"] !== true) {
    io.out("");
    io.out("Dry run. Nothing has changed. Re-run with --confirm to remove.");
    return EXIT.ok;
  }
  if (io.prompt === undefined) {
    io.err("refused: removal requires an interactive confirmation and this console has no prompt.");
    return EXIT.refused;
  }
  const answer = (await io.prompt(`Type the id to remove it permanently [${targetId}]: `)).trim();
  if (answer !== targetId) {
    io.err("refused: the confirmation did not match. Nothing has changed.");
    return EXIT.refused;
  }

  // RELOAD AND RE-PLAN under the writing store: the human took time, and the
  // store may not be the store the plan was made against.
  const store = openStoreAt({ dir });
  try {
    const outcome = removeOne(store, io, targetId, flags, now, planOpts, "scripted");
    return outcome === "removed" ? EXIT.ok : outcome === "refused" ? EXIT.refused : EXIT.failed;
  } finally {
    store.close();
  }
}

/**
 * ONE MEMORY, THROUGH THE ONE PATH — re-planned under the writing store, removed,
 * and reported. Both doors call this and nothing else calls `ownerRemoval`, so
 * the front door a person came through cannot change what happens to the memory
 * or what is said about it afterwards.
 *
 * `door` exists for one sentence and is not decoration. It was derived from a
 * count of what had already gone — `removedSoFar === 0` — and the adversarial
 * review (M1) showed what that costs: a refusal on the FIRST of two picks reads
 * "none gone yet" as "none will be", prints the single-target door's *"Nothing
 * has changed."*, and the loop then removes the second one. The person is told
 * nothing changed and a memory is deleted under the sentence. A report that
 * overstates what survived is the same failure as one that overstates what was
 * chased (§16 G15), pointed the other way. The door is a fact about the caller,
 * so it is passed as one.
 */
function removeOne(
  store: Store,
  io: Io,
  targetId: string,
  flags: Record<string, string | boolean | undefined>,
  now: () => number,
  planOpts: { crossScopeContent: boolean; echoScanMax?: number },
  door: "scripted" | "picked",
): "removed" | "refused" | "failed" {
  try {
    const replan = planRemoval(store, targetId, planOpts);
    if (!replan.valid) {
      io.err(
        door === "scripted"
          ? `refused after re-plan: ${replan.reason}. Nothing has changed.`
          : // NAMED, and claiming nothing about the rest of the batch: the
            // tail line at the end of the loop counts what happened, and it is
            // the only sentence in a position to be true about all of it.
            `refused after re-plan: ${replan.reason} (${targetId}). That memory is untouched.`,
      );
      return "refused";
    }
    const outcome = ownerRemoval(
      store,
      {
        targetId,
        actor: "owner",
        reason: typeof flags["reason"] === "string" ? flags["reason"] : "owner request",
        requestedAt: now(),
      },
      { ...planOpts, onEvent: (name, data) => io.out(`  ${name} ${JSON.stringify(data)}`) },
    );
    io.out("");
    io.out(`Removed ${targetId}.`);
    io.out(`  chased: ${outcome.chased.join(", ") || "nothing"}`);
    io.out(`  unchased (dark via the deny-list, never silently dropped): ${outcome.unchased.join(", ") || "nothing"}`);
    io.out(`  left on purpose (not a failure — this removal was never entitled to it): ${outcome.leftAlone.join(", ") || "nothing"}`);
    io.out(`  removal record: ${outcome.notes.length} stages appended`);
    return "removed";
  } catch (err) {
    io.err(`removal failed: ${describeDirRefusal(err)}`);
    return "failed";
  }
}

/**
 * WHAT A REMOVAL WILL AND WILL NOT REACH — the same block through both doors.
 *
 * It was the scripted door's alone until the adversarial review's M3: the person
 * at the terminal is the LESS expert caller and was getting strictly less before
 * the irreversible yes than the scripted one got. `removal.ts`'s own comment on
 * `SpanSurface.matchedBy` settles it — *"printed, because the two are not
 * equally strong and a reader deciding whether to confirm deserves to know which
 * one is about to run"* (review F4). Sharpest with
 * `--strike-by-content-across-scopes`, which the interactive door honours and
 * which chases a body through every project's buffer on the machine.
 */
function printRemovalPlan(io: Io, plan: RemovalPlan): void {
  io.out(`Removal plan for ${plan.targetId}:`);
  for (const surface of plan.surfaces) io.out(`  chase ${surface.surface}: ${surface.count}`);
  // The seventh surface, printed in ALL THREE states and ABOVE the closing
  // "Nothing has changed" line — a disclosure under the last line of a dry run
  // is a disclosure a reader has already stopped reading (cold-stranger round 3,
  // C3). `not applicable` is stated too: the silence is what made the residue
  // undiscoverable outside the README (LAUNCH-STATUS §I2). `held` is a CHASE
  // now, not a confession; only `unknown` still says NOT chased.
  io.out(
    plan.spans.state === "held"
      ? `  chased — ${plan.spans.line}`
      : plan.spans.state === "unknown"
        ? `  NOT chased — ${plan.spans.line}`
        : `  ${plan.spans.line}`,
  );
  for (const name of plan.unchasable) {
    if (name === plan.spans.line) continue; // said once, on its own line above
    io.out(`  CANNOT chase ${name} — the id goes dark via the deny-list instead`);
  }
  // LEFT ON PURPOSE, which is neither a chase nor a failure (review F6). The
  // spans sentence above already carries the count; this line is what the
  // completion report will repeat, so the two read the same.
  for (const name of plan.leftAlone) io.out(`  LEFT on purpose — ${name}`);
  // IDS ONLY (§16 G15): printing the matching text would re-leak exactly the
  // thing being removed.
  io.out(`  other memories whose text overlaps (ids only): ${plan.contamination.length}`);
  for (const id of plan.contamination) io.out(`    ${id}`);
}

/**
 * WHY AN ID CANNOT BE REMOVED, in the words both doors use.
 *
 * One refusal gets a sentence rather than a code, because it is the one that
 * means "you want a different command" rather than "that id is wrong".
 */
function removalRefusalLine(reason: RemovalPlan["reason"], targetId: string): string {
  return reason === "is-the-self-page"
    ? `refused: ${targetId} is the self page, and removal is not how a page goes away — it would tombstone the row that every session's wake and the schema index read. Unwrite it with 'counterparts self-page --clear', which keeps what it said as a version you can restore.`
    : `refused: ${reason} (${targetId})`;
}

// ── remove, the interactive door ────────────────────────────────────────────

/**
 * WHAT THIS CONSOLE TAKES FOR AN ID rather than for words to search for.
 *
 * Built from `ID_PREFIX` — the store's own table of id families — rather than
 * from a second copy of `mem|epi|sch` here, so a family added there is an id
 * here on the same day. A string shaped like an id is one: `remove
 * mem_notarealid` is a wrong id and gets told so, never quietly turned into a
 * search for the word "mem_notarealid".
 */
const MEMORY_ID_SHAPE = new RegExp(`^(?:${Object.values(ID_PREFIX).join("|")})_[0-9a-z]+$`);

/**
 * Is this one token an id? CASE-SENSITIVE, and that is the answer to review n1.
 *
 * `store.row` is case-sensitive and ids are minted lowercase (`newId`, hex), so
 * `MEM_7F29…` names no row. The two ways to handle it are to lowercase before
 * the lookup — which would let one string silently become a different row's id
 * on the one command that cannot take that back — or to say it is not an id.
 * This says it is not an id.
 */
function looksLikeMemoryId(token: string): boolean {
  return MEMORY_ID_SHAPE.test(token);
}

/** How many search hits the picker offers before it says to narrow. */
const REMOVE_SEARCH_LIMIT = 10;

/** What a candidate line gives a summary before it cuts it short. */
const REMOVE_SUMMARY_WIDTH = 64;

/**
 * The one sentence every way out of the interactive door ends with — a No, an
 * Esc, an empty answer, a second bad pick. Said in the same words every time,
 * because "did that just delete something?" is the question this door exists to
 * make unnecessary.
 */
const NOTHING_DELETED = "Cancelled. Nothing was deleted.";

/**
 * THE INTERACTIVE DOOR (owner's answer 7, 2026-09-22): a person at a terminal
 * who has a thing they want gone and does not have its id in their hand.
 *
 * Ask what, find it, show it, ask once. Everything destructive still happens in
 * `removeOne` and therefore in `removal.ts`, in the order that file's header
 * sets out; this function only decides which ids get there.
 *
 * EVERY exit that is not a removal prints `NOTHING_DELETED` and returns
 * `EXIT.refused` — on `io.out`, because it is the answer to a question this
 * console asked rather than something that went wrong, and non-zero, because a
 * wrapper script must never read a cancelled removal as a removal that happened.
 */
async function removeInteractively(
  dir: string,
  io: Io,
  positional: readonly string[],
  flags: Record<string, string | boolean | undefined>,
  now: () => number,
): Promise<number> {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const planOpts = removalPlanOptions(flags);

  let chosen: readonly string[];
  let go: boolean;
  try {
    chosen = await chooseForRemoval(dir, io, positional);
    // Empty means the picker has already said why on screen — nothing matched,
    // nothing was typed, or two answers in a row were not numbers.
    if (chosen.length === 0) return EXIT.refused;

    // THE PICK, CHECKED AND PLANNED BEFORE THE CONFIRMATION. Two reasons, and
    // the second arrived with the adversarial review (M3):
    //
    //   - a person about to be asked ONE yes/no question about N memories must
    //     not have one of them turn out to be unremovable after the others are
    //     gone;
    //   - and what they are saying yes to has to be on the screen — the
    //     surfaces, the spans sentence, what is left on purpose, how many other
    //     memories overlap. The scripted caller has always had it.
    //
    // Read-only, and CLOSED before the prompt: this console never holds a store
    // across a human (scar E5).
    const inspected = inspectForRemoval(dir, chosen, planOpts);
    if (inspected.refused !== null) {
      io.err(removalRefusalLine(inspected.refused.reason, inspected.refused.id));
      io.out(NOTHING_DELETED);
      return EXIT.refused;
    }
    for (const entry of inspected.entries) {
      io.out("");
      io.out(`  ${entry.line}`);
      printRemovalPlan(io, entry.plan);
    }
    io.out("");
    go = await confirm(
      io,
      chosen.length === 1
        ? "Delete this memory for good?"
        : `Delete these ${chosen.length} memories for good?`,
      { default: false },
    );
  } catch (err) {
    if (!isPromptAborted(err)) throw err;
    // Esc, Ctrl-C, or stdin closing under the question. The prompt helpers throw
    // rather than return a null so that a forgotten check cannot read an abort
    // as an answer (`ui.ts#PromptAborted`); here an abort means exactly what a
    // No means, and says so in the same words.
    io.out(NOTHING_DELETED);
    return EXIT.refused;
  }
  if (!go) {
    io.out(NOTHING_DELETED);
    return EXIT.refused;
  }

  // ONE writing store for the whole selection, and each memory re-planned under
  // it on its own — the human took time, and the store may have moved since the
  // lines above were printed.
  const store = openStoreAt({ dir });
  let removed = 0;
  let refused = 0;
  let failed = 0;
  try {
    for (const targetId of chosen) {
      // A REFUSAL IS REPORTED AND THE LOOP GOES ON, deliberately. The person
      // confirmed these memories; the ones after a hiccup are no less confirmed
      // than the ones before it, and the ordinary cause — another session got
      // to that id first — says nothing at all about the rest. Stopping would
      // leave them with neither a removal nor a sentence.
      const outcome = removeOne(store, io, targetId, flags, now, planOpts, "picked");
      if (outcome === "removed") removed += 1;
      else if (outcome === "refused") refused += 1;
      else failed += 1;
    }
  } finally {
    store.close();
  }
  if (refused + failed > 0) {
    // THE ONLY SENTENCE IN A POSITION TO BE TRUE ABOUT ALL OF IT, which is why
    // the per-memory refusal above claims nothing about the batch (review M1).
    io.out("");
    io.out(
      `${removed} of ${chosen.length} removed. The ${refused + failed} not removed ${refused + failed === 1 ? "is" : "are"} untouched, and named above.`,
    );
  }
  // REFUSED AND BROKEN ARE DIFFERENT ANSWERS (review m2): the scripted door
  // exits `refused` for a re-plan refusal, and a wrapper told `failed` for the
  // same condition has been told the wrong thing.
  return failed > 0 ? EXIT.failed : refused > 0 ? EXIT.refused : EXIT.ok;
}

/**
 * WHICH MEMORIES THE PERSON MEANS. Ids out; nothing here writes or deletes.
 *
 * Empty means "stop, and the reason is already printed". The caller turns that
 * into an exit code and nothing else.
 */
async function chooseForRemoval(
  dir: string,
  io: Io,
  positional: readonly string[],
): Promise<readonly string[]> {
  const typed = positional.map((word) => word.trim()).filter((word) => word.length > 0);
  const named = allIds(typed);
  // SEVERAL IDS ARE SEVERAL IDS (review m3). `remove mem_a mem_b` used to be
  // joined into one search string and answered "nothing matched" — the most
  // obvious thing a person with two ids can type, refused for looking like a
  // sentence. This door already removes several; it just had no way to be told
  // two.
  if (named !== null) return named;

  const query =
    typed.length > 0
      ? typed.join(" ")
      : (await ask(io, "Memory id, or words to search for:")).trim();
  if (query.length === 0) {
    io.out(NOTHING_DELETED);
    return [];
  }
  // The same rule for what was typed AT the question, so the two ways in agree.
  const atThePrompt = allIds(query.split(/\s+/).filter((word) => word.length > 0));
  if (atThePrompt !== null) return atThePrompt;

  const found = searchForRemoval(dir, query);
  const candidates = found.candidates;
  if (candidates.length === 0) {
    // A search that finds nothing is not a failure and is not a silence: say
    // which words were asked, so a typo is visible as a typo.
    io.out(`Nothing matched “${query}”.`);
    io.out(NOTHING_DELETED);
    return [];
  }
  io.out("");
  candidates.forEach((candidate, index) => io.out(`  ${index + 1}. ${candidate.line}`));
  // TRUNCATION IS THE SEARCH'S OWN ANSWER, not a length compared to a constant
  // (review n4): a list shortened by the skipped candidates is still a list with
  // more behind it, and the old check said nothing in exactly that case.
  if (found.truncated) {
    io.out(`  (the ${candidates.length} closest — add a word or two to narrow it)`);
  }
  io.out("");

  // ONE re-ask, then stop — the same rule `ui.ts#confirm` uses, and for the same
  // reason: a person who has typed two non-answers is not reading, and a third
  // identical question is a trap rather than a kindness. Here it stops rather
  // than taking a default, because there is no safe default for "which of these
  // do I delete".
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const picks = parsePicks(await ask(io, "Which one? (a number, or several like 1,3):"), candidates.length);
    if (picks !== null) return picks.map((n) => candidates[n - 1]?.id ?? "");
    if (attempt === 0) {
      io.out(`Answer with a number from 1 to ${candidates.length}, or several like 1,3.`);
    }
  }
  io.out(NOTHING_DELETED);
  return [];
}

/**
 * Every token of `words` as an id, or null when even one of them is not.
 *
 * All or nothing on purpose: a line that is half ids and half words is a line
 * this console cannot read two ways at once, and guessing which half was meant
 * is guessing on the one command that cannot take it back.
 */
function allIds(words: readonly string[]): readonly string[] | null {
  if (words.length === 0) return null;
  if (!words.every(looksLikeMemoryId)) return null;
  // `1,1` folds and so does this: two of the same id is one memory.
  return [...new Set(words)];
}

/**
 * The numbers in an answer, or null when the WHOLE answer cannot be read as
 * numbers in range.
 *
 * Whole, deliberately: `1,99` on a list of three is not "remove 1" with a stray
 * character, it is somebody who has misread the list, and acting on the half
 * that parsed would delete a memory on the strength of a typo. The SHAPE is
 * checked before anything is split (review n3, which found `1,` parsing as
 * `[1]` — a trailing separator is an unfinished answer, and a docstring that
 * says "refused whole" has to mean it). Duplicates fold — `1,1` is one memory —
 * and both separators the owner named work, comma and space.
 */
function parsePicks(answer: string, count: number): number[] | null {
  const trimmed = answer.trim();
  if (!/^[0-9]+(?:[ \t,]+[0-9]+)*$/.test(trimmed)) return null;
  const picked: number[] = [];
  for (const part of trimmed.split(/[\s,]+/)) {
    const n = Number(part);
    if (n < 1 || n > count) return null;
    if (!picked.includes(n)) picked.push(n);
  }
  return picked;
}

interface RemovalCandidate {
  readonly id: string;
  readonly line: string;
}

/**
 * THE SEARCH BEHIND THE PICKER — the lexical index, read-only, through the same
 * `Store.search` the recall path's token channel reads (`recall/activate.ts`)
 * and `planRemoval`'s own contamination scan already uses.
 *
 * **This prints titles, and that is not the thing §16 G15 forbids.** The
 * contamination scan returns IDS ONLY because it matches OTHER memories against
 * the doomed body: printing those would re-leak the very words being erased, to
 * somebody who had asked to see them gone. This list is the opposite direction —
 * it is the answer to words the person typed a moment ago, about memories they
 * are deciding whether to keep, and a numbered list with no titles in it is a
 * list nobody can choose from. The removal's own report still prints no body,
 * and neither does the record.
 *
 * Candidates `removalRefusal` would turn away are skipped rather than numbered:
 * an already-removed row or the self page offered as choice 3 is a choice that
 * dead-ends. It asks for more hits than it shows for exactly that reason, so the
 * skipping does not quietly shorten the list.
 */
function searchForRemoval(
  dir: string,
  query: string,
): { candidates: RemovalCandidate[]; truncated: boolean } {
  const fetch = REMOVE_SEARCH_LIMIT * 2;
  const store = openStoreAt({ dir, observer: true });
  try {
    const out: RemovalCandidate[] = [];
    const hits = store.search(query, fetch);
    let truncated = hits.length === fetch;
    for (const hit of hits) {
      if (out.length === REMOVE_SEARCH_LIMIT) {
        truncated = true;
        break;
      }
      if (removalRefusal(store, hit.id) !== null) continue;
      const row = store.row(hit.id);
      if (row === undefined) continue;
      out.push({ id: hit.id, line: candidateLine(row) });
    }
    return { candidates: out, truncated };
  } finally {
    store.close();
  }
}

/**
 * THE PICK, RE-READ — is every chosen id still removable, and what does each one
 * say it is? Read-only, and the store is closed before the caller asks anything,
 * so no lock and no handle is held across a human (scar E5).
 *
 * The first refusal stops it: a selection that cannot be carried out whole is
 * refused whole, before the single confirmation rather than in the middle of it.
 */
function inspectForRemoval(
  dir: string,
  chosen: readonly string[],
  planOpts: { crossScopeContent: boolean; echoScanMax?: number },
): {
  refused: { id: string; reason: RemovalPlan["reason"] } | null;
  entries: { line: string; plan: RemovalPlan }[];
} {
  const store = openStoreAt({ dir, observer: true });
  try {
    const entries: { line: string; plan: RemovalPlan }[] = [];
    for (const id of chosen) {
      // `planRemoval` asks `removalRefusal` first and returns on it, so the
      // refusal here is the same refusal the picker filtered on — one rule,
      // asked once more now that the person has had time to pick.
      const plan = planRemoval(store, id, planOpts);
      if (!plan.valid) return { refused: { id, reason: plan.reason }, entries: [] };
      const row = store.row(id);
      entries.push({ line: row === undefined ? id : candidateLine(row), plan });
    }
    return { refused: null, entries };
  } finally {
    store.close();
  }
}

/**
 * `mem_xxx  fact — what it is about  (2026-09-22)`, and nothing wider.
 *
 * TWO MARKERS, both of them saying what a bare kind would not:
 *
 *   - **`[journal]`** — the owner's ruling of 2026-09-04 (LAUNCH-STATUS §I14),
 *     in the same place and the same word `recall` prints it: a chapter is
 *     recallable and is never presented as a memory. The lexical index holds
 *     episode rows, so without it a day's account comes up looking like a fact
 *     under a question that says "delete this memory for good".
 *   - **`[confidential]`** — review m1. `export` omits confidential memories by
 *     default *even for the owner* and makes him pass `--include-confidential`;
 *     this list may not be the one owner-facing surface that prints one of them
 *     unmarked. With the marker on, `summaryOf` also stops falling back to the
 *     body for it: a confidential memory's first line is exactly the string
 *     that door exists to keep off a screen nobody asked to see it on.
 */
function candidateLine(row: {
  id: string;
  type: string;
  kind: string;
  title: string | null;
  body: string;
  confidential: number;
  learned_on: string;
}): string {
  const marks = `${row.type === "episode" ? "[journal] " : ""}${row.confidential === 1 ? "[confidential] " : ""}`;
  return `${row.id}  ${marks}${row.kind} — ${summaryOf(row)}  (${row.learned_on})`;
}

/**
 * The title, or the body's first line when there is no title — folded to one
 * line and cut to fit, because a candidate list whose rows wrap is a list whose
 * numbers stop lining up. The cut is at a width, not at a word: this is a label
 * for choosing by, and the memory itself is one `counterparts ask --id` away.
 *
 * **A CONFIDENTIAL memory never falls back to its body** (review m1): it is
 * `(untitled)` and the marker beside it says which kind of untitled. The line
 * is then kind, date and two markers — enough to choose by, since the person
 * searched the words that found it, and none of the words themselves.
 */
function summaryOf(row: { title: string | null; body: string; confidential: number }): string {
  const titled = row.title !== null && row.title.trim().length > 0;
  if (!titled && row.confidential === 1) return "(untitled)";
  const raw = titled ? row.title ?? "" : (row.body.split("\n").find((line) => line.trim().length > 0) ?? "");
  const one = raw.replace(/\s+/g, " ").trim();
  if (one.length === 0) return "(no words)";
  return one.length <= REMOVE_SUMMARY_WIDTH ? one : `${one.slice(0, REMOVE_SUMMARY_WIDTH - 1)}…`;
}

// ── backfill-claims ─────────────────────────────────────────────────────────

/**
 * The one-shot repair for memories minted BEFORE the authored default existed.
 *
 * Measured 2026-09-04 on the parallel-run store: 48 authored memories, every
 * one of them with relevance/emotional/predictive = 0, most with no claim — so
 * `sal(m)` was 0 and the lived channel's own deposits were the weakest things in
 * the store. New mints get the floor at the seam (`mint.ts`); these rows never
 * crossed a seam that had one.
 *
 * Three properties, all of them the console's usual ones rather than new
 * inventions: it is a DRY RUN unless `--apply`; it refuses under observer via
 * `OWNER_OPS` (an instrument does not repair the store it is reading); and it
 * touches only rows whose `source` is `authored` and whose `claimed` is NULL —
 * an explicit claim, however low, is testimony and is never overwritten.
 * Archived, superseded and removed rows are excluded: the repair is for what
 * the store is still holding.
 *
 * Each write is two durable acts plus a record: the claim onto box 2
 * (`updatePhysics`), the `claimedDefault` flag onto canonical prose (`revise`,
 * which keeps the prior version — constitution 7), and a `salience.defaulted`
 * row in the event log so the daily can count this run.
 *
 * `claimedDefault` is META, and since the floor (2026-09-20) `content_hash` is
 * `hashText(body)` — so a backfilled row's hash does NOT move when the flag
 * lands, where before the floor it did (the hash addressed the whole serialized
 * document, id and frontmatter included). Either way nothing downstream cares:
 * `sleep/dedup.ts` deliberately hashes the body itself rather than reading this
 * column, and `remember/`'s content-idempotency ledger hashes normalized content
 * and never reads it at all. What DOES move, on purpose, is the revision: the
 * flag goes on through `revise`, which keeps the prior version (constitution 7).
 */
function backfillClaimsCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): number {
  const apply = flags["apply"] === true;
  // A BULK WRITE ACROSS EVERY AUTHORED MEMORY, and until 2026-09-05 it had no
  // door at all: `COUNTERPARTS_DATA_DIR=<store> backfill-claims --apply` ran.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "backfill-claims --apply",
      "writes the default claimed floor onto every unclaimed authored memory",
    );
    if (refusal !== null) return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const floor = TUNABLES.AUTHORED_DEFAULT_CLAIM;

  // The plan is made read-only, as every plan here is (scar E5).
  const planning = openStoreAt({ dir, observer: true });
  let targets: { id: string; kind: string; dims: string }[];
  try {
    targets = backfillTargets(planning);
  } finally {
    planning.close();
  }

  io.out(`Authored memories with no claimed salience: ${targets.length}`);
  io.out(`Default floor to apply: ${floor} (physics TUNABLES.AUTHORED_DEFAULT_CLAIM)`);
  // IDS AND NUMBERS ONLY — a repair report is not a place to print bodies.
  for (const t of targets) io.out(`  ${t.id}  ${t.kind}  dims ${t.dims}`);

  if (!apply) {
    io.out("");
    io.out("Dry run. Nothing has changed. Re-run with --apply to write the floor.");
    return EXIT.ok;
  }
  if (targets.length === 0) {
    io.out("");
    io.out("Nothing to do.");
    return EXIT.ok;
  }

  const store = openStoreAt({ dir });
  let written = 0;
  const failures: string[] = [];
  try {
    // RE-CHECK under the writing store: the plan was made against a store that
    // may have moved, and this loop must not write a floor over a claim that
    // arrived in between.
    for (const target of backfillTargets(store)) {
      try {
        const physics = store.physicsOf(target.id);
        store.updatePhysics(target.id, { salience: { ...physics.salience, claimed: floor } });
        store.revise(
          target.id,
          { meta: { [CLAIMED_DEFAULT_META_KEY]: true }, reason: "salience.default" },
        );
        store.appendEvent({
          name: "salience.defaulted",
          day: store.livedDay(),
          ref: target.id,
          payload: { channel: "authored", floor, backfill: true },
        });
        written += 1;
      } catch (err) {
        failures.push(`${target.id}: ${describeDirRefusal(err)}`);
      }
    }
  } finally {
    store.close();
  }

  io.out("");
  io.out(`Applied the default floor to ${written} memories.`);
  for (const failure of failures) io.err(`  FAILED ${failure}`);
  return failures.length === 0 ? EXIT.ok : EXIT.failed;
}

/** Live, authored, unclaimed — in that order, and nothing else. */
function backfillTargets(store: Store): { id: string; kind: string; dims: string }[] {
  const denied = new Set(store.deniedIds());
  const out: { id: string; kind: string; dims: string }[] = [];
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || denied.has(id)) continue;
    if (row.archived === 1 || row.superseded_by !== null) continue;
    if (row.source !== "authored" || row.claimed !== null) continue;
    out.push({
      id,
      kind: row.kind,
      dims: `rel ${row.relevance} emo ${row.emotional} pred ${row.predictive}`,
    });
  }
  return out;
}

// ── repair-dates ────────────────────────────────────────────────────────────

/**
 * The migrated rows' dates, proposed from what the rows themselves carry.
 *
 * The console's half is thin on purpose: parse three flags, refuse a bad one by
 * name, and hand off to `repair-dates.ts`, where the evidence rules and their
 * reasons live. `--dry-run` is accepted and is the DEFAULT — it exists so the
 * safe call can be spelled out loud rather than only implied by the absence of
 * `--apply` — and passing both is a refusal, not a silent winner.
 */
function repairDatesCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): number {
  const apply = flags["apply"] === true;
  // Argument arithmetic only: this opens nothing, so it may stand in front of
  // the store door. A command line that contradicts itself should be told so.
  if (apply && flags["dry-run"] === true) {
    io.err("repair-dates: --apply and --dry-run contradict each other; pass one");
    return EXIT.usage;
  }
  // THE ONE OWNER OP THAT REWRITES THOUSANDS OF CANONICAL DOCUMENTS. A dry run on
  // the defaulted store is read-only and stays unguarded (it is how the owner
  // looks); an APPLY that nobody aimed asks to be aimed (review §4) — by `--dir`,
  // and by nothing else. `--yes` used to stand in for it here, while one command
  // over it meant "skip the typed confirmation"; the 2026-09-05 ruling is that
  // `--yes` only ever skips a confirmation, and this command has none to skip.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "repair-dates --apply",
      "rewrites the date on every migrated memory the evidence reaches",
    );
    if (refusal !== null) return refusal;
  }
  const raw = typeof flags["confidence"] === "string" ? flags["confidence"] : "high";
  if (raw !== "high" && raw !== "medium" && raw !== "low") {
    io.err(`repair-dates: --confidence must be high, medium or low (got ${raw})`);
    return EXIT.usage;
  }
  const confidence: Confidence = raw;
  const importDay = typeof flags["import-day"] === "string" ? flags["import-day"] : undefined;
  if (importDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(importDay)) {
    io.err(`repair-dates: --import-day must be YYYY-MM-DD (got ${importDay})`);
    return EXIT.usage;
  }
  const sampleRaw = typeof flags["sample"] === "string" ? Number(flags["sample"]) : undefined;
  if (sampleRaw !== undefined && (!Number.isInteger(sampleRaw) || sampleRaw < 0)) {
    io.err(`repair-dates: --sample must be a non-negative whole number`);
    return EXIT.usage;
  }
  const report = repairDates(dir, io, {
    apply,
    minConfidence: confidence,
    ...(importDay === undefined ? {} : { importDay }),
    ...(sampleRaw === undefined ? {} : { sample: sampleRaw }),
  });
  if (report === null) return EXIT.failed;
  if (report.refused !== null) return EXIT.refused;
  return report.failures.length === 0 ? EXIT.ok : EXIT.failed;
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

// ── rebrief ─────────────────────────────────────────────────────────────────

/**
 * THE OWNER'S RE-RENDER.
 *
 * The wake bundle is composed at the day's first boundary — and again when a
 * page write or a write-up puts it behind (2026-09-30) — and served unchanged
 * to every session until the next render. That is a feature — cold start
 * costs one meta read — right up until the render itself changes: the identity
 * share merged mid-day on 2026-09-04 and could not reach a single session's wake
 * until the following boundary, and an owner who wanted their wake regenerated
 * had nothing to run. This is that lever.
 *
 * Three properties, all of them the console's usual ones:
 *
 *   - It goes through the SAME renderer the sleep step uses
 *     (`core/briefing.ts#selfRenderer`, via `Counterpart.rebrief`) — a console
 *     with a second renderer is a console that can publish a bundle the
 *     boundary would never have composed.
 *   - It refuses under observer via `OWNER_OPS`: republishing is a content
 *     write, and an instrument makes none.
 *   - It advances NO sleep marker and runs no other sleep phase. Decay,
 *     consolidation, dedup and prune stay the boundary's work.
 *
 * The ceiling is the host's, never this file's (scar §2.18): `--budget`, else
 * `injectionBudgetBytes` from the host config beside the store, else a refusal
 * that names both.
 */
function rebriefCommand(
  dir: string,
  io: Io,
  budgetFlag: string | boolean | undefined,
  now: () => number,
  home?: string,
  named?: ConfigChoice,
): number {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const ceiling =
    home === undefined
      ? hostCeiling(dir, budgetFlag, homedir(), named)
      : hostCeiling(dir, budgetFlag, home, named);
  if ("refusal" in ceiling) {
    for (const line of ceiling.refusal.split("\n")) io.err(line);
    return EXIT.refused;
  }
  const counterpart = openCounterpart(dir);
  try {
    // The horizon lane asks about a calendar date; the console's own clock is
    // the only one in the room, and tests inject it.
    const at = localDate(now(), counterpart.store.zone());
    const report = counterpart.rebrief({ budgetBytes: ceiling.bytes, at });
    if (!report.rendered) {
      io.err(`refused: the render declined (${report.reason}).`);
      return EXIT.refused;
    }
    io.out(`Re-rendered the wake bundle for ${counterpart.store.dir}.`);
    io.out(`  lived day ${report.day}, horizon asked about ${at}`);
    // THE LINE THAT MAKES THE LOOKUP HONEST. It names the file, always — a
    // ceiling read out of a configuration the user never mentioned is a
    // surprise only while nobody says where it came from.
    io.out(
      ceiling.source === "--budget"
        ? `  budget ${ceiling.bytes} bytes from --budget`
        : `  budget ${ceiling.bytes} bytes from ${ceiling.source}${
            ceiling.namedBy === undefined ? "" : ` (named by ${ceiling.namedBy})`
          }`,
    );
    io.out(
      `  composed under ${report.composeBudget} — the delivery preface reserves ${PREFACE_RESERVE_BYTES}`,
    );
    io.out(`  lanes: ${LANE_ORDER.map((l) => `${l} ${report.counts[l] ?? 0}`).join("  ")}`);
    io.out(`  elements ${report.elements}, bytes ${report.bytes}`);
    io.out(
      report.published
        ? "  published — the next session wakes on this bundle."
        : "  NOT published: the store is in observer stance.",
    );
    io.out("  No sleep marker moved and no other sleep phase ran.");
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

// ── scope ───────────────────────────────────────────────────────────────────

/**
 * `counterparts scope` — which directories this memory is for (owner asks
 * G42/G43, 2026-09-10).
 *
 * **It is a HOST-CONFIG write, not a store write**, and every rule below falls
 * out of that one sentence:
 *
 *   - it takes no `--dir` and opens no store, so it runs on a machine that has
 *     not installed one yet — which is exactly when somebody wants to say "not
 *     here";
 *   - it writes `<config dir>/scopes.json`, so `--config` (and
 *     `$COUNTERPARTS_CONFIG`) moves the registry with the configuration, and a
 *     scratch install's scopes are that install's own;
 *   - it is NOT on `OWNER_OPS`, because that list refuses a COMMAND whole and
 *     an instrument must still be able to READ this file — "why did this
 *     session record nothing" is a question a stood-down console has to be able
 *     to answer. The write half refuses in the same sentence an owner op does,
 *     one function down, beside the write it guards.
 *
 * **A relative path is never stored.** The registry is read by processes a host
 * launches from a working directory nobody chose (`config-path.ts`'s whole
 * argument about `--config`), so a relative key would name a different
 * directory in each of them. `.` is the ordinary way to say "here" and is
 * resolved before anything is written; the output always names the ABSOLUTE
 * path it wrote, so the resolution is never a silent one.
 *
 * **A registry it cannot parse is never overwritten.** `--force` is the way
 * through, and it prints what it could not read first: the alternative is a
 * console that quietly replaces a file somebody hand-edited.
 */
function scopeCommand(
  parsed: Parsed,
  io: Io,
  observer: boolean,
  choice: ConfigChoice | undefined,
  now: () => number,
): number {
  const configPath = choice?.path ?? defaultConfigPath();
  const file = scopesPath(configPath);
  const flags = parsed.flags;
  const asked: { flag: string; mode: ScopeMode }[] = [
    { flag: "on", mode: "on" },
    { flag: "observer", mode: "observer" },
    { flag: "off", mode: "off" },
    { flag: "pause", mode: "paused" },
  ].filter((m) => flags[m.flag] === true) as { flag: string; mode: ScopeMode }[];
  const resuming = flags["resume"] === true;
  const listing = flags["list"] === true;

  if (asked.length + (resuming ? 1 : 0) > 1) {
    io.err(
      `refused: ${[...asked.map((a) => `--${a.flag}`), ...(resuming ? ["--resume"] : [])].join(" and ")} — a directory is in one mode at a time.`,
    );
    io.err("Nothing was written.");
    return EXIT.refused;
  }

  const read = readScopes(file);
  const unreadable = (): void => {
    io.err(`refused: ${file} could not be read — ${read.error ?? "unknown"}.`);
  };
  // THE ENTRIES THIS FILE HOLDS AND NOBODY CAN HONOUR (#92 review, F2). They are
  // named on every path through this command, read or write, because a refused
  // entry reads as unset — which is ON — and the person in front of this console
  // is the only one who can fix it.
  const sayRefused = (): void => {
    for (const entry of read.refused) {
      io.err(`  ignored: ${entry.key} — ${entry.detail}. It reads as unset, which is on.`);
    }
  };

  // ── --list: the whole registry, and the file it came from ─────────────────
  if (listing) {
    if (asked.length > 0 || resuming || parsed.positional.length > 0) {
      io.err("refused: --list prints the whole registry; it takes no path and no mode.");
      return EXIT.refused;
    }
    if (read.error !== null) {
      unreadable();
      io.err("Nothing was read. Fix the file, or replace it with `scope <path> --off --force`.");
      return EXIT.refused;
    }
    io.out(`Scopes (${file}):`);
    if (read.refused.length > 0) {
      io.err(
        `warning: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in this file could not be read:`,
      );
      sayRefused();
    }
    const entries = Object.entries(read.registry?.scopes ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    if (entries.length === 0) {
      io.out("  Nothing is set. Every directory is on by default.");
      return EXIT.ok;
    }
    for (const [path, entry] of entries) {
      const resume = entry.mode === "paused" ? ` (resumes to ${resumeTarget(entry)})` : "";
      io.out(`  ${entry.mode.padEnd(9)} ${path}${resume}`);
      io.out(`  ${" ".repeat(9)} since ${entry.since}${entry.note === undefined ? "" : ` — ${entry.note}`}`);
    }
    return EXIT.ok;
  }

  const given = parsed.positional[0];
  if (given === undefined) {
    io.err("refused: name a directory (`.` means this one), or pass --list.");
    return EXIT.usage;
  }
  const dir = canonicalScopePath(given);

  // ── no mode: what does this directory resolve to, and who said so ─────────
  if (asked.length === 0 && !resuming) {
    if (read.error !== null) {
      unreadable();
      io.err("Until it is fixed every directory reads as unset, which is on.");
      return EXIT.refused;
    }
    if (read.refused.length > 0) {
      io.err(
        `warning: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in ${file} could not be read:`,
      );
      sayRefused();
    }
    const verdict = lookupScope(read.registry, dir);
    io.out(`${dir} — ${verdict.mode === "unset" ? "unset" : verdict.mode}`);
    if (verdict.entry === null) {
      io.out("  Nothing is set for it or for any parent, so it is on (the default).");
      io.out(`  Registry: ${file}`);
      return EXIT.ok;
    }
    io.out(`  Stance: ${stanceOfMode(verdict.mode)}.`);
    io.out(
      verdict.matched === dir
        ? `  Decided by its own entry, set ${verdict.entry.since}.`
        : `  Decided by ${verdict.matched ?? "?"} (an ancestor), set ${verdict.entry.since}.`,
    );
    if (verdict.entry.mode === "paused") {
      io.out(`  --resume puts it back to ${resumeTarget(verdict.entry)}.`);
    }
    if (verdict.entry.note !== undefined) io.out(`  Note: ${verdict.entry.note}`);
    io.out(`  Registry: ${file}`);
    return EXIT.ok;
  }

  // ── the write half ────────────────────────────────────────────────────────
  if (observer) {
    // The same sentence an owner op gets, from the same reasoning: this console
    // is an instrument, and an instrument does not change what it is reading.
    // Note that on THIS command `--observer` is a mode and never a stance, so
    // the only thing that can have stood it down is `COUNTERPARTS_OBSERVER`.
    io.err(
      "refused: writing the scope registry changes this host's configuration, and this console is in observer stance. An instrument reads; it does not change the setting it is reading.",
    );
    return EXIT.refused;
  }
  if (read.error !== null && flags["force"] !== true) {
    unreadable();
    io.err("Nothing was written. Fix it by hand, or pass --force to replace it entirely.");
    return EXIT.refused;
  }
  // A WRITE WOULD DROP THE ENTRIES THIS READ REFUSED — every write rewrites the
  // whole file from what parsed — so it refuses instead, by name (#92 review,
  // F2). `--force` goes ahead and says which entries it is dropping: the good
  // ones are carried (they parsed), the named ones are gone.
  if (read.refused.length > 0) {
    if (flags["force"] !== true) {
      io.err(
        `refused: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in ${file} could not be read, and writing would drop ${read.refused.length === 1 ? "it" : "them"}:`,
      );
      sayRefused();
      io.err("Nothing was written. Fix those by hand, or pass --force to drop them.");
      return EXIT.refused;
    }
    io.err(
      `warning: --force drops ${String(read.refused.length)} unreadable ${read.refused.length === 1 ? "entry" : "entries"}:`,
    );
    sayRefused();
  }
  // `--force` starts from EMPTY, not from a half-understood file: a registry
  // that did not parse has no entries this can honestly carry forward, and
  // silently keeping the ones that happened to be readable is the shape that
  // turns an `off` into an `on`.
  const base: ScopeRegistry | null = read.error === null ? read.registry : null;

  let mode: ScopeMode;
  if (resuming) {
    const own = ownEntry(base, dir);
    if (own === null) {
      const inherited = lookupScope(base, dir);
      io.err(
        inherited.entry === null
          ? `refused: nothing is set for ${dir}, so there is nothing to resume. It is already on.`
          : `refused: nothing is set for ${dir} itself — it inherits ${inherited.matched ?? "?"}. Resume that one, or set this one directly.`,
      );
      return EXIT.refused;
    }
    if (own.mode === "on" || own.mode === "observer") {
      io.out(`${dir} is already ${own.mode}; nothing to resume, and nothing was written.`);
      return EXIT.ok;
    }
    // `--resume` restores an `off` as well as a `paused`, which is the loop the
    // owner asked for: turn a directory off, work, turn it back on. An `off`
    // never recorded what to go back to, so it goes back to `on`.
    mode = resumeTarget(own);
  } else {
    mode = asked[0]?.mode ?? "on";
  }

  // ONE function for the change, used twice: once against the registry this
  // command read, and again — by `writeScopes` — against whatever is actually
  // on disk if somebody wrote between that read and the rename (#92 review, F3).
  // The other writer is the MCP `scope` tool, in the same directory, in another
  // process, and before this the second rename simply deleted the first entry.
  const apply = (from: ScopeRegistry | null): ScopeRegistry =>
    setScope(from, dir, mode, {
      at: new Date(now()).toISOString(),
      ...(typeof flags["note"] === "string" ? { note: flags["note"] } : {}),
    });
  const next = apply(base);
  writeScopes(file, next, {
    basedOn: read,
    // `--force` over a file nobody could read starts from empty either way:
    // there is nothing in it this can honestly carry forward.
    reapply: (fresh) => apply(read.error === null ? fresh : null),
  });

  io.out(`Scope set: ${dir} — ${mode}.`);
  if (canonicalScopePath(given) !== resolve(given) || given !== dir) {
    io.out(`  ('${given}' resolved to that path; the registry only ever holds absolute ones.)`);
  }
  io.out(`  ${scopeEffect(mode, ownEntry(next, dir)?.resumeTo)}`);
  io.out(`  Written to ${file}`);
  return EXIT.ok;
}

/** What the owner just chose, in one sentence, on the surface that chose it. */
function scopeEffect(mode: ScopeMode, resumeTo: string | undefined): string {
  switch (mode) {
    case "on":
      return "Sessions there capture, deposit, wake and recall, as everywhere else.";
    case "observer":
      return "Sessions there deliver the wake and recall and record nothing; the remember, session_end and chapter tools stand down.";
    case "off":
      return "The hooks there produce no output and write nothing, and every tool refuses. `--resume` turns it back on.";
    default:
      return `Off for now. \`--resume\` puts it back to ${resumeTo ?? "on"}.`;
  }
}

/**
 * WHERE THE CONSOLE LOOKS FOR THE HOST CONFIGURATION. One rule, and the only one.
 *
 * `injectionBudgetBytes` is a host capability, and the console has no host — so
 * a command that needs it (today: `rebrief`) has to read the file the host's own
 * adapter reads. That is a real thing the console does, and the documentation
 * said for a while that it did not; a bolded claim a stranger disproved with the
 * second command past the round trip (cold-stranger review, 2026-09-04, issue 3).
 * So it is stated once, here, and every page repeats this and nothing else:
 *
 *   1. `--budget <bytes>`, when given. Nothing is read at all.
 *   2. `<dir>/../claude-code.json` — BESIDE the store. This is the deployed
 *      layout: `~/.counterparts/claude-code.json` with the store at
 *      `~/.counterparts/store`, so for a default install (1) and (2) are the
 *      same file. For a `--dir` elsewhere it is the config that names THAT store.
 *   3. `~/.counterparts/claude-code.json` — the hooks' own hardcoded path, which
 *      is where `counterparts install` always writes, because `--dir` moves the
 *      store and never the configuration.
 *
 * **Never `<dir>/claude-code.json`.** A file inside the data dir fails the layout
 * totality check (§5 G11) and the store stops opening; the `--help` said that
 * path for a while and it was never true.
 *
 * The caller PRINTS which of these answered, always — a number read out of a
 * file the user did not name is only a surprise while it is silent. `searched`
 * carries the paths so a refusal can name every place that was tried rather
 * than one of them.
 */
export interface CeilingFound {
  readonly bytes: number;
  /** `--budget`, or the absolute path of the file that answered. */
  readonly source: string;
  readonly searched: readonly string[];
  /** Set when a `--config` / `COUNTERPARTS_CONFIG` named the file that answered,
   *  so the printed line can say the number came from a file the caller chose. */
  readonly namedBy?: ConfigSource;
}
export interface CeilingMissing {
  readonly refusal: string;
  readonly searched: readonly string[];
}

export function hostCeiling(
  dir: string,
  flag: string | boolean | undefined,
  home = homedir(),
  /**
   * The configuration this invocation was TOLD to read, when it was told. A
   * named file replaces the two-step search entirely — a caller who said which
   * configuration to use did not ask for a fallback to another one, and falling
   * back would compose a briefing under a ceiling from a file they never named
   * (the same failure as the rest of this rule, one level up).
   */
  named?: ConfigChoice,
): CeilingFound | CeilingMissing {
  if (typeof flag === "string" && flag.length > 0) {
    const n = Number(flag);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        refusal: `refused: --budget takes a positive whole number of bytes, not '${flag}'.`,
        searched: [],
      };
    }
    return { bytes: n, source: "--budget", searched: [] };
  }
  const beside = join(dir, "..", "claude-code.json");
  const hooksConfig = defaultConfigPath(home);
  // De-duplicated, because on a default install these are the same file and a
  // refusal that named it twice would read as two separate misses.
  const searched =
    named !== undefined && named.source !== "default"
      ? [named.path]
      : beside === hooksConfig
        ? [beside]
        : [beside, hooksConfig];
  const namedBy = named !== undefined && named.source !== "default" ? named.source : undefined;
  for (const candidate of searched) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as Record<string, unknown>;
      const value = parsed["injectionBudgetBytes"];
      if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return {
          bytes: value,
          source: candidate,
          searched,
          ...(namedBy === undefined ? {} : { namedBy }),
        };
      }
    } catch {
      /* an unreadable host config reports no ceiling — the refusal below says so */
    }
  }
  // Scar §2.18: the ceiling is a host capability. There is no default anywhere
  // in this package and this command does not become the place there is one.
  return {
    refusal: [
      'refused: no injection ceiling. Nothing set "injectionBudgetBytes" in either place',
      "this command looks, so there is no number to compose under, and a briefing never",
      "invents one (scar §2.18). Looked, in order:",
      ...searched.map((p) => `  ${p}${existsSync(p) ? "  (present, no injectionBudgetBytes)" : "  (absent)"}`),
      "Pass --budget <bytes>, or add the key to one of those files.",
    ].join("\n"),
    searched,
  };
}

/** Exported for the caller-universality test: the console composes a brain the
 *  same way every other adapter does, and never re-wires the modules. */
export function openCounterpart(
  dir: string,
  observer = false,
  identity?: { readonly name: string },
  embed?: Embedder,
): Counterpart {
  // `identity` goes through the SAME door the host adapter uses —
  // `Counterpart.open`'s own option, which calls `self.ensureIdentityCore`. The
  // console does not get a second way to mint an identity core; it gets the
  // one way, with a name from a flag instead of from `claude-code.json`.
  // `embed` likewise: the option every composition root hands its embedder's
  // sync face through (`ask`, 2026-09-24).
  const snapshotsDir = observer ? undefined : snapshotsDirBeside(dir);
  const timeZone = zoneBeside(dir);
  return Counterpart.open({
    dir,
    observer,
    // A wake `rebrief` publishes is stamped with this build (2026-10-02).
    build: installedVersion(),
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(identity === undefined ? {} : { identity }),
    ...(embed === undefined ? {} : { embed }),
    ...(snapshotsDir === undefined ? {} : { snapshotsDir }),
  });
}

/**
 * `timeZone` from the host configuration beside the store — the same file
 * `snapshotsDirBeside` reads — so a console command names the person's day in
 * the zone the hooks use (docs/time.md, 2026-09-25). It lives in `config.ts`
 * since 2026-10-09, where the dashboard reads it too; re-exported here for the
 * console's callers.
 */
export { zoneBeside };

/** `Store.open` for the console: the config's zone beside the store rides along. */
function openStoreAt(opts: { dir: string; observer?: boolean }): Store {
  const timeZone = zoneBeside(opts.dir);
  return Store.open({ ...opts, ...(timeZone === undefined ? {} : { timeZone }) });
}

/**
 * `snapshots.dir` from the host configuration beside the store
 * (`<base>/claude-code.json`, the file `install` writes), so a migration the
 * console runs puts its copy where the worker's rotation and doctor look.
 * Absent, unreadable or unset: undefined, and the store's default applies.
 */
export function snapshotsDirBeside(dir: string): string | undefined {
  const beside = join(dir, "..", "claude-code.json");
  if (!existsSync(beside)) return undefined;
  try {
    return loadConfig(JSON.parse(readFileSync(beside, "utf8"))).config.snapshots?.dir;
  } catch {
    return undefined;
  }
}

// ── doctor ──────────────────────────────────────────────────────────────────

/**
 * `doctor`'s exit code when anything is RED.
 *
 * It is the same number as `EXIT.usage` and it means something else: not "you
 * typed this wrong" but "the store you asked about has a red finding". A
 * separate constant rather than a sixth member of `EXIT`, because `EXIT` is this
 * console's vocabulary for how a COMMAND went and this is a verdict about a
 * STORE. Both renderings use it, so a script can branch on `$?` without parsing
 * either.
 */
export const DOCTOR_RED_EXIT = 1;

/**
 * The host configuration at `path`, read the way every entry point reads it,
 * with the three readings kept distinct.
 *
 * `loadConfig(undefined)` says "absent", which is the right answer for a file
 * that is not there and the WRONG one for a file that is there and will not
 * parse — so the parse failure is caught here and named. Both resolve to a
 * config `doctor` can still report on; neither throws.
 */
function hostConfigFor(path: string): {
  config: AdapterConfig;
  reason: "loaded" | "absent" | "unreadable";
  /** The keys the loader named, when it could not read the file. */
  unreadableKeys?: readonly string[];
} {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    const load = loadConfig(undefined);
    return { config: load.config, reason: "absent" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // The same direction `loadConfig` takes for a file it cannot understand:
    // observer, and say so. A config that will not parse silences every hook.
    return { config: { observer: true }, reason: "unreadable" };
  }
  const load = loadConfig(raw);
  // THE EMBEDDER DEFAULT the hooks, the worker and the server apply
  // (`config.ts#resolveEmbedder`): an absent block is the local table.
  return {
    config: withEmbedderDefault(load.config),
    reason: load.reason,
    ...(load.unreadableKeys === undefined ? {} : { unreadableKeys: load.unreadableKeys }),
  };
}

/**
 * Is there a `claude` executable on this environment's PATH? A directory walk,
 * never a spawn — doctor must not run somebody's program to grade them. Null
 * when there is no PATH to search, which the fix line reads as "not looked".
 */
function claudeOnPath(env: Record<string, string | undefined>): boolean | null {
  const path = env["PATH"];
  if (path === undefined || path.trim().length === 0) return null;
  for (const dir of path.split(delimiter)) {
    if (dir.length === 0) continue;
    try {
      const st = statSync(join(dir, "claude"));
      if (st.isFile() && (st.mode & 0o111) !== 0) return true;
    } catch {
      /* not here */
    }
  }
  return false;
}

/** The persisted per-reason spawn refusal counters, as `doctor` wants them. */
/** The adapter's own start tally, read the way `spawnRefusalCounters` reads the
 *  refusal ones -- from the meta keys `hooks.ts` owns, because `doctor.ts`
 *  cannot import that file back. */
function spawnStartCounter(store: Store | null): { date: string | null; count: number } {
  if (store === null) return { date: null, count: 0 };
  try {
    return {
      date: store.getMeta(SPAWN_START_DATE_KEY) ?? null,
      count: Number(store.getMeta(SPAWN_START_COUNT_KEY) ?? "0"),
    };
  } catch {
    return { date: null, count: 0 };
  }
}

function spawnRefusalCounters(store: Store | null): Record<string, number> {
  if (store === null) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
    const n = Number(value);
    if (n > 0) out[key.slice(SPAWN_REFUSAL_PREFIX.length)] = n;
  }
  return out;
}

/**
 * `doctor` — the reading that would have caught I32 on day one.
 *
 * Read-only, all the way down: the store is opened in OBSERVER stance, box 3 is
 * never opened at all, and nothing here writes a row. The findings, the
 * severities and the fix sentences live in `claude-code/doctor.ts` and are the
 * SAME ones the session-start notice reads, so the terminal warning and this
 * report cannot say different things about one store.
 *
 * Two things it does differently from every other command, both deliberate:
 *
 *   1. **The store comes from the CONFIG first.** `--dir` overrides it and the
 *      environment is the last resort, because the question `doctor` answers is
 *      "is the store the HOOKS open healthy" — and through all of I29 the
 *      answer for the store the environment named was yes.
 *   2. **Nothing it grades comes from this console's shell.** The hook
 *      processes inherit none of it (measured day 0), so a reading that did
 *      would grade a machine the hooks never run on. (Until 2026-09-24 this
 *      was about the API keys, which were read from their file for exactly
 *      that reason.)
 *
 * **And what reading from the config does NOT buy it: an exemption.** With
 * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` armed, this command refuses unless a
 * human named something — `--dir`, or a configuration by `--config` /
 * `COUNTERPARTS_CONFIG`. A configuration found at the DEFAULT path names the
 * live store on every machine with an install, so honouring its `dataDir` past
 * the guard would be the guard's own failure mode wearing a diagnostic's face;
 * the first round of this PR did exactly that and was caught reading the
 * owner's live paths from an armed shell. Two doors enforce it: `run()`
 * (`implicitConfigRefusal`, the same three lines `install` uses) and the dir
 * resolution below.
 */
function doctorCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  named?: ConfigChoice,
  checkout?: CheckoutReading,
  home?: string,
): number {
  const configPath = named?.path ?? defaultConfigPath();
  // `--dir` WITH NO NAMED CONFIGURATION, under the guard (finding 6). The store
  // was named; the default configuration beside it was not, and opening it is
  // what reaches the owner's live configuration. So it is not opened — not
  // read, not reported on, not graded — and `configFindings` prints one amber
  // naming what went unasked. Without the guard this is an ordinary run, since
  // the default config is then a place the caller is content to read.
  const unread =
    typeof parsed.flags["dir"] === "string" &&
    (named === undefined || named.source === "default") &&
    explicitDirSetting(env).armed;
  const { config, reason, unreadableKeys } = unread
    ? { config: {} as AdapterConfig, reason: "not-read" as const, unreadableKeys: undefined }
    : hostConfigFor(configPath);

  // WHICH STORE, under the guard. `--dir` is a name. A config the CALLER named
  // (`--config`, `COUNTERPARTS_CONFIG`) is a name, and the `dataDir` inside it is
  // named by extension. A config nobody named is NOT a name — and its `dataDir`
  // field is the live store on every machine with an install, which is why the
  // old shape here never reached `resolveDir` and so never met the guard at all.
  //
  // `run()` already refuses that case one door up (`implicitConfigRefusal`), and
  // this is the second door rather than the first: `doctorCommand` is reachable
  // without it — a caller inside this module, a future dispatch — and the whole
  // finding was that one missing branch let a read at the live store through.
  // The sentence is `verify`'s own, so the two doors say the same thing.
  const namedConfig = named !== undefined && named.source !== "default";
  const guard = explicitDirSetting(env);
  let dir: string;
  try {
    if (typeof parsed.flags["dir"] === "string") {
      dir = parsed.flags["dir"];
    } else if (config.dataDir !== undefined && !namedConfig && guard.armed) {
      throw new StoreError("IMPLICIT_DEFAULT_DIR_REFUSED", {
        guard: `${REQUIRE_EXPLICIT_DIR_ENV}=${guard.value}`,
        dir: config.dataDir,
      });
    } else {
      dir = config.dataDir ?? resolveDir(env);
    }
  } catch (err) {
    // The explicit-dir guard, at exactly the door `verify`'s census meets it:
    // a store nobody named is refused here too.
    io.err(describeDirRefusal(err));
    return EXIT.refused;
  }

  // The person's day: the config's zone, else the machine's (docs/time.md).
  const today = todayIn(resolveZone(config.timeZone));
  let store: Store | null = null;
  try {
    // WOULD A SESSION OPEN THIS STORE — asked FIRST, and closed again inside the
    // call, so this reading and the console's own handle never hold the same
    // database at once. It is the check the `Store` finding cannot make: that
    // finding reads the directory, and a store can pass it while
    // `Counterpart.open` throws at every session start (H1). Inside this `try`
    // rather than above it, because `doctor` is the command people run BECAUSE
    // something is wrong, and its own reading must not be the thing that throws.
    const open = storeExists(dir) ? readCounterpartOpen(dir, undefined, config.snapshots?.dir) : undefined;
    if (storeExists(dir)) {
      try {
        store = Store.open({ dir, observer: true, ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }) });
      } catch (err) {
        // A store BEHIND this build refuses an observer until a session has
        // upgraded it; the Store open line already grades that, so the rest of
        // the reading goes on without a handle rather than failing.
        // A store a rollback holds refuses every open by this build, and the
        // Rollback line says so; the rest of the reading goes on the same way.
        if (isStoreError(err, "STORE_ROLLED_BACK")) {
          store = null;
        } else if (open?.migration === undefined || !isStoreError(err, "STORE_UNINITIALIZED")) throw err;
      }
    }
    const findings = doctorFindings({
      configPath,
      configReason: reason,
      ...(unreadableKeys === undefined ? {} : { configUnreadableKeys: unreadableKeys }),
      config,
      dir,
      store,
      today,
      refusals: spawnRefusalCounters(store),
      starts: spawnStartCounter(store),
      // WHICH CHECKOUT THIS CONSOLE IS RUNNING. From a worktree it grades the
      // worktree, which is the right answer for a command somebody typed; the
      // hook grades the tree the host invokes by absolute path, which is the
      // one that is live on the owner's memory.
      checkout: checkout ?? readCheckout(),
      // DID THE TWO STEPS THE USER DOES BY HAND TAKE (finding 4). Read here
      // rather than inside `doctorFindings` for the reason `checkout` is: it is
      // four small reads of somebody else's files, outside this store, and the
      // hook must not pay for them.
      host: {
        ...readHost(home ?? homedir(), process.cwd(), env),
        // WHETHER `connect` COULD REGISTER THE MEMORY TOOLS FROM HERE, and the
        // line it prints when it cannot (go-public Phase C walk): doctor's fix
        // for a missing registration names that line rather than `connect`
        // when there is no `claude` to run. A PATH search, never a spawn.
        claudeOnPath: claudeOnPath(env),
        mcpAddLine: mcpCommand(dir, undefined, customConfigPath(named, home ?? homedir())),
        consoleRuntime: runtimeLabel(),
      },
      // CLAUDE DESKTOP'S ENTRY (2026-09-30): two small reads of the host's
      // files, like `host` above. Quiet in the report when there is none.
      desktop: readDesktop(home ?? homedir(), env),
      // HOW THIS COPY CAME (2026-10-11): the plugin's /counterparts:doctor
      // runs through `plugin-run.sh cli`, which says so in the environment.
      install: installRoute(env),
      ...(open === undefined ? {} : { open }),
    });
    if (parsed.flags["json"] === true) {
      io.out(JSON.stringify(reportJson(findings, today), null, 2));
    } else {
      // ONE READING, two layouts (2026-09-21, new-user finding 5). A console
      // that is not a terminal — every test, every pipe, the install loop —
      // still gets `reportLines` verbatim, from inside this call; see
      // `report.ts`, which exists to hold exactly that promise.
      printDoctorReport(io, env, findings, today, { all: parsed.flags["all"] === true });
    }
    return anyRed(findings) ? DOCTOR_RED_EXIT : EXIT.ok;
  } finally {
    store?.close();
  }
}
