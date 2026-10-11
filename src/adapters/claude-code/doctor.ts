/**
 * `doctor` — the one reading that says out loud whether the BACKGROUND half is
 * alive.
 *
 * **The incident this answers (I32, 2026-09-11).** For a week the detached
 * worker was refused at every boundary — `~/.counterparts/credentials.env` had
 * been rewritten to the template by a forced install, so `planSpawn` answered
 * `NO_CREDENTIAL` every time. Every VISIBLE surface read healthy: the wake
 * delivered, recall rendered, capture captured, `verify` was clean, the daily
 * graded the day ACTIVE. Meanwhile the lived-day clock was frozen at 185, no
 * sleep cycle had run since 09-04, every ask was `capped` against a day that
 * never rolled over, and nothing had been embedded. The owner learned it from a
 * session that went looking.
 *
 * #95 made the refusals durable and persisted the escalation counter — the
 * evidence exists now. This module is the READER of that evidence, and it exists
 * once so the console and the session-start notice cannot disagree about what
 * "healthy" means (constitution 16: if the owner can't see it, it isn't
 * trustworthy).
 *
 * Three rules shape it:
 *
 *   1. **It reads and never writes.** Every store call below is a read; the
 *      caller supplies an OBSERVER store or one that is already open. Nothing
 *      here opens a database, mints a directory or touches box 3.
 *   2. **Names and counts, never values.** Paths, names, counts and dates —
 *      never memory text.
 *   3. **It is on the hot path, so it is bounded.** `sessionNoticeBudgetMs`
 *      bounds the whole reading at session start, checked BETWEEN groups; what
 *      the budget cut off is reported as a finding rather than silently
 *      omitted (scar §2.4 — a door that did not open must not look like a door
 *      nobody needed).
 */
import { spawnSync } from "node:child_process";
import { addDays, isDay, localDate, resolveZone, startOfLocalDay } from "../../core/time.js";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADAPTER_ASK_EVENT,
  BOUNDARY_EVENT,
  EMBED_BACKFILL_EVENT,
  ENVELOPE_GAVE_WAY_EVENT,
  ENVELOPE_OVERCAP_EVENT,
  INJECTION_OVERBUDGET_EVENT,
  NOTICE_DROPPED_EVENT,
  GATE_CHUNK_EVENT,
  GATE_DEPOSIT_EVENT,
  HOOK_CLAIM_LOST_EVENT,
  MCP_OVERSIZE_EVENT,
  MCP_PART_EVENT,
  MCP_SPILLED_EVENT,
  RECALL_CREDIT_EVENT,
  RUNNER_FAILED_EVENT,
  SELF_BRIEFING_EVENT,
  SLEEP_CYCLE_EVENT,
  SNAPSHOT_FAILED_EVENT,
  SNAPSHOT_TAKEN_EVENT,
  SPAWN_FAILED_EVENT,
  SPAWN_REFUSED_EVENT,
  SPAWN_STARTED_EVENT,
  SWEEP_GATE_EVENT,
  WAKE_DELIVERED_EVENT,
} from "../../core/counterpart.js";
import { Counterpart } from "../../core/counterpart.js";
import {
  STORE_CREATED_KEY,
  Store,
  assertPreMigrationTarget,
  isSelfRelevantFeeling,
  isStoreError,
  paths,
  pendingMigration,
  preMigrationDir,
} from "../../core/store/index.js";
import { BUSY_TIMEOUT_MS, journalModeOf } from "../../core/store/db.js";
import { heldCorrections } from "../../core/contradictions.js";
import { CLI_SCRIPT, NODE_HOOKS, bundledModelDir } from "../runtime.js";
import { acceptsReflectedFeeling, laterFeelingWasAwake, laterFeelingWasReflections, selfRelevantFeeling } from "../../core/sleep/index.js";
import { TUNABLES as ASSOCIATE_TUNABLES, isDead, pairKey } from "../../core/associate/index.js";
import type { EventRow } from "../../core/store/index.js";
// The ask allowance the amber hint names, read rather than retyped: a number in
// a diagnostic's prose is a number that goes stale silently.
import { SELF_TUNABLES } from "../../core/self/tunables.js";
import { WORK_OVERFLOW_EVENT } from "../../core/self/work.js";
import { HANDOFF_REFUSED_EVENT } from "../../core/handoff/index.js";
import { LAST_HERE_NOROOM_EVENT } from "../../core/handoff/last-here.js";
import { TOOL_RESULT_CEILING } from "../../core/fit/index.js";
import { awakeFeelingCounts, dreamingSetting, nightPartsWords, nightRunLost, nightRunOf, nightRunWords } from "../../core/dream/index.js";
import type { DreamingSetting } from "../../core/dream/index.js";
// The page's own reader, so this line cannot drift from what the wake prints.
import { clearedMarker, findPageRow, readSelfPage } from "../../core/self/page.js";
import {
  JOURNAL_COPY_FAILED_EVENT,
  JOURNAL_COPY_WRITTEN_EVENT,
} from "../../core/self/journal-file.js";
import {
  dayBefore,
  hasDayBefore,
  lastPageWriterRun,
  pageWriterDue,
  pageWriterNight,
  pageWriterStatus,
} from "../../core/self/writer.js";
import type { AskReason } from "../../core/self/episodes.js";
// The what-fired reading, shared with the console's `fired` command and the
// dashboard's health panel so the three cannot disagree about what "silent"
// means (constitution 16, the same rule this module already keeps for "healthy").
import { STATE_MEANING, daysBetween, firedReport } from "../fired.js";
// The one name the "no configuration was read" line needs, from the module that
// owns it — so the sentence here and the refusal it replaced name the same var.
import { CONFIG_ENV } from "../config-path.js";
import {
  DEFAULT_KEEP,
  futureNamesIn,
  keepOf,
  readSnapshotsDir,
  resolveSnapshotsDir,
} from "../snapshots.js";
import { TUNABLES, pageWriterMode, resolveEmbedder, withEmbedderDefault } from "../config.js";
import type { EmbedderSource } from "../config.js";
import { MODEL_FILE, STATIC_WEIGHTS_ENV, STATIC_WEIGHTS_PACKAGE, resolveStaticWeights } from "../../core/embed/static.js";
import { DATABASE_FILE, heldExits, readRollbackHold, rollbackHeld } from "../../core/store/index.js";
// Retention's own reading and its own week, so the Raw transcripts line cannot
// promise a different number from the job that does the deleting. READ-ONLY:
// `remember/index.ts` re-exports the plan and the readers, never the deleter.
import { SpanBuffer, TUNABLES as REMEMBER_TUNABLES, lastRetentionRun } from "../../core/remember/index.js";
import { lapsesSince, ledger } from "../../core/coverage/index.js";
import type { LedgerEntry } from "../../core/coverage/index.js";
import {
  DESKTOP_WAKE_KEY,
  hostOf,
  hostSessionEvidence,
  listSessions,
  pointable,
  progressKey,
  readWriteUpPointer,
  readWriteUpProgress,
  sameScope,
  writeUpEntries,
  writeUpPlan,
} from "../sessions.js";
import { DESKTOP_HOST } from "../hosts.js";
import type { PluginInstallRead } from "../host-wiring.js";
import { localStamp } from "../../core/time.js";
import { CLAIMS_DIR, claimsSetAside } from "./claim.js";
import { catchUpOf, catchUpWords } from "./night-catch-up.js";
import type { AdapterConfig } from "../config.js";
// The same vocabulary the hook's stand-down uses, so the terminal and the
// console cannot end up with two answers to "why did it not open".
import { describeFault, faultId, faultPath } from "./standdown.js";
import { LOG_DAYS, logReading } from "../log/index.js";

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
 * How long the session-start reading may take before it stops and says so.
 *
 * 150 ms is the credit seam's own budget (`CreditReferencesInput.deadline`),
 * chosen for the same reason: this runs inside a foreground hook, and a hook
 * that costs the owner a visible pause has made the cure worse than the disease.
 * The console passes no budget at all — a person who typed `counterparts
 * doctor` is waiting on purpose.
 */
export const SESSION_NOTICE_BUDGET_MS = 150;

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

export interface DoctorInput {
  /** The host configuration file this reading is about. */
  readonly configPath: string;
  /**
   * How `loadConfig` read that file, when the caller knows. The hook resolves
   * and REFUSES a bad one before it gets here (`bin/hook.ts`), so it passes
   * null and the config finding reports only what the file named.
   */
  /**
   * `not-read` (2026-09-20, finding 6) is `--dir` with no `--config` under the
   * explicit-dir guard: the store was NAMED, so it is read, and the default
   * configuration beside it was not opened at all — because opening it is what
   * would reach the owner's live configuration. Everything that comes out of
   * a configuration then says so instead of grading a file nobody read.
   */
  readonly configReason: "loaded" | "absent" | "unreadable" | "not-read" | null;
  /**
   * The keys `loadConfig` named when it could not read the file
   * (`LoadedConfig.unreadableKeys` — today `embedder`, `embedder.enabled`,
   * `embedder.kind`). Printed on the Config line so a person can fix the one
   * key without reading the loader (review of #190, MINOR 5). Absent: the
   * reader could not name one, or the caller did not pass it.
   */
  readonly configUnreadableKeys?: readonly string[];
  readonly config: AdapterConfig;
  /** The store this reading actually read. */
  readonly dir: string;
  /** Null when there is no store at `dir` — the store findings then say so. */
  readonly store: Store | null;
  /** Today in the person's zone, `YYYY-MM-DD` — the same spelling every `date`
   *  field uses (UTC until 2026-09-25; docs/time.md). */
  readonly today: string;
  /**
   * The persisted spawn-refusal counters, `reason -> count`
   * (`adapter.spawn.refusals.<reason>` in box 2's meta).
   *
   * An INPUT rather than a read taken here, because the two callers reach them
   * differently: the adapter has `spawnRefusals()`, which also answers for an
   * observer out of its in-memory map, and the console reads the meta prefix off
   * the store. The THRESHOLD and the wording — the part that could drift — live
   * here and only here.
   */
  readonly refusals: Record<string, number>;
  /**
   * HOW MANY TIMES THE WORKER STARTED TODAY, and the date that tally is for.
   *
   * An INPUT for the same reason `refusals` is: the counter lives in the
   * adapter's own meta keys, `hooks.ts` already imports this file, and a read
   * taken here would make that a cycle. `adapter.spawn.started` is latched one
   * row per calendar date, so the ROW proves the door opened and this is the
   * only thing that says how often -- which is why the row carries no tally of
   * its own. A date that is not today is ignored rather than printed: a counter
   * stamped with yesterday answers nothing about today.
   */
  readonly starts?: { date: string | null; count: number };
  /**
   * WHICH CHECKOUT IS RUNNING (see `readCheckout`). Absent: not graded, and no
   * finding is produced at all.
   */
  readonly checkout?: CheckoutReading;
  /**
   * WHETHER THE STORE OPENS THE WAY A SESSION OPENS IT (see `readCounterpartOpen`).
   * Absent: not read, and no finding is produced at all — which is the hook's
   * case, whose counterpart is already open by the time it asks for a notice.
   */
  readonly open?: OpenReading;
  /**
   * WHETHER THE TWO STEPS THE USER DOES BY HAND ACTUALLY TOOK (finding 4).
   * Absent: not read, and no finding is produced at all — the hook's case, which
   * is already running BECAUSE the hooks are installed and has no budget for
   * four more file reads.
   */
  readonly host?: HostReading;
  /**
   * CLAUDE DESKTOP'S CONFIG ENTRY (2026-09-30), read by the console
   * (`cli/desktop.ts#readDesktop`). Absent: not read, no finding — the hook's
   * case, and Desktop's `wake`. No entry: no finding either — Desktop is
   * optional, and a line about it would be noise to everyone without it.
   */
  readonly desktop?: DesktopReading;
  /** Bound the whole reading. Absent: no bound (the console's case). */
  readonly budgetMs?: number;
  readonly now?: () => number;
}

// ── which checkout is running ───────────────────────────────────────────────

export interface CheckoutReading {
  /**
   * WHAT IS DEPLOYED, graded against the LOCAL `refs/remotes/origin/master` as
   * last fetched — never against the local `master` branch, and never by
   * fetching (this runs on a hook's hot path).
   *
   * The case that set the rule, measured 2026-09-14: a merge to origin/master
   * does NOT deploy. The install tree sat DETACHED at an older sha for thirty
   * minutes after a merge, and every hook in that window ran the old code while
   * "it's merged" was true.
   *
   *   - `master` — HEAD IS origin/master, on a branch or detached. Detached at
   *     origin/master is the intended deploy state, not a fault.
   *   - `behind` — HEAD is an ancestor of origin/master: master moved and this
   *     tree did not. Amber; the code that runs is old but it is merged code.
   *   - `branch` / `detached` — HEAD is NOT an ancestor of origin/master, so
   *     unmerged code is live. Red.
   *   - `dirty` — tracked modifications, wherever HEAD sits. Red.
   *   - `not-a-repo` — an installed package. Nothing to grade.
   *   - `unreadable` — git did not answer, or there is no `origin/master` ref to
   *     grade against. Neutral, and no durable row.
   */
  readonly reason: "master" | "behind" | "branch" | "dirty" | "detached" | "not-a-repo" | "unreadable";
  /** The directory graded. Empty when there was nothing to grade. */
  readonly root: string;
  readonly branch: string | null;
  /** Short sha, or null on an empty repository. */
  readonly head: string | null;
  /** TRACKED modifications only. */
  readonly dirty: number;
  /** How many commits origin/master is ahead, when HEAD is an ancestor of it. */
  readonly behindBy: number | null;
  /** The short sha of `refs/remotes/origin/master`, as last fetched. */
  readonly originMaster: string | null;
  /** True when HEAD IS origin/master — the deploy state, branch or not. */
  readonly atMaster: boolean;
  /**
   * True when the reading ran out of `CHECKOUT_BUDGET_MS` (or one call timed
   * out), which forces `reason` to `unreadable`. It is its own field because the
   * ring row distinguishes "git would not answer" from "git was too slow", and
   * only the second one says something about the machine.
   */
  readonly timedOut: boolean;
}

/**
 * THE PACKAGE ROOT OF THE CODE THAT IS RUNNING — derived from this module's own
 * path and from nothing else.
 *
 * It must not come from a configuration value, and the reason is the whole
 * point of the finding. The host invokes the hook by ABSOLUTE PATH out of
 * `~/.claude/settings.json`, so on the live machine that path resolves to the
 * shared install tree — which is exactly the tree that has to be graded, because
 * whatever is checked out there is what runs against the owner's memory. (It
 * happened: a peer session developed a branch in that checkout and it was live
 * for seven minutes.) A console run from a worktree resolves to the WORKTREE and
 * grades that, which is the right answer for a command somebody typed there.
 */
function runningRoot(from: string = dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** What one bounded `git` call answered. `failed` separates "git said no" from
 *  "git never answered", which are different findings. */
interface GitResult {
  readonly ok: boolean;
  readonly out: string;
  readonly failed: "missing" | "timeout" | "status" | null;
}

export type GitRunner = (args: readonly string[]) => GitResult;

/** The ceiling on ONE `git` call. Never the reading's cost: seven calls at two
 *  seconds is fourteen seconds, which is what the reviewer measured against a
 *  sleeping git shim (7.81 s) before `CHECKOUT_BUDGET_MS` existed. The budget
 *  below is what actually bounds the reading; this is the per-call cap it
 *  narrows. */
export const CHECKOUT_TIMEOUT_MS = 2000;

/**
 * THE WHOLE READING'S BUDGET — one second, and the reason it is not 150 ms.
 *
 * `readCheckout` runs BEFORE `doctorFindings`, whose own deadline starts when it
 * is entered, so the git reads were outside every budget this adapter had: up to
 * seven `spawnSync` calls, each free to take `CHECKOUT_TIMEOUT_MS`. A wedged git
 * — a network filesystem, an index.lock, a fresh cold cache — could hold a
 * foreground session start for fourteen seconds.
 *
 * It is its OWN budget rather than a share of `SESSION_NOTICE_BUDGET_MS`
 * because the two measure different things. 150 ms is right for reading a store
 * that is already open; five process spawns on a cold machine can exceed that on
 * their own, and a checkout reading that timed out every morning would report
 * `unreadable` on exactly the days the tree HAS wandered — the days the finding
 * exists for. One second is the number that is long enough to be read and short
 * enough that nobody notices it. Total worst case at session start:
 * `CHECKOUT_BUDGET_MS` + `SESSION_NOTICE_BUDGET_MS` ≈ 1.15 s.
 */
export const CHECKOUT_BUDGET_MS = 1000;

function gitIn(root: string, remainingMs: () => number, env: NodeJS.ProcessEnv): GitRunner {
  return (args: readonly string[]): GitResult => {
    const res = spawnSync("git", ["-C", root, ...args], {
      timeout: remainingMs(),
      encoding: "utf8",
      windowsHide: true,
      // The environment is passed rather than inherited by default for one
      // reason: under bun a `spawnSync` with no `env` resolves the binary against
      // the REAL environment, so a test cannot put a slow `git` on `PATH` and
      // prove the budget against a spawn that actually blocks. Passing
      // `process.env` is what inheriting already meant.
      env,
    });
    if (res.error !== undefined && res.error !== null) {
      const code = (res.error as NodeJS.ErrnoException).code ?? "";
      return { ok: false, out: "", failed: code === "ETIMEDOUT" ? "timeout" : "missing" };
    }
    if (res.signal !== null && res.signal !== undefined) return { ok: false, out: "", failed: "timeout" };
    if (res.status !== 0) return { ok: false, out: String(res.stdout ?? ""), failed: "status" };
    return { ok: true, out: String(res.stdout ?? ""), failed: null };
  };
}

/**
 * Which branch the RUNNING code is on, and whether its tree is clean.
 *
 * Read-only, bounded, and it never throws: every git call is `spawnSync` with a
 * timeout, and a git that is missing, slow or angry resolves to `unreadable`
 * rather than to an exception on a hook's hot path.
 *
 * `dirty` counts TRACKED changes only (`--untracked-files=no`), because the
 * shared tree carries untracked files by design — a working `docs/IMPROVEMENTS.md`,
 * `.claude/worktrees/` — and neither changes what runs.
 */
export const ORIGIN_MASTER = "refs/remotes/origin/master";

export function readCheckout(
  opts: {
    root?: string | null;
    git?: GitRunner;
    timeoutMs?: number;
    budgetMs?: number;
    /** Injectable clock, so the budget is provable without waiting for it. */
    now?: () => number;
    /** The environment the `git` calls run in; injectable so a test can put a
     *  slow `git` on `PATH` and measure the real spawn path. */
    env?: NodeJS.ProcessEnv;
  } = {},
): CheckoutReading {
  const root = opts.root === undefined ? runningRoot() : opts.root;
  const none = {
    branch: null,
    head: null,
    dirty: 0,
    behindBy: null,
    originMaster: null,
    atMaster: false,
    timedOut: false,
  };
  if (root === null) return { reason: "not-a-repo", root: "", ...none };
  // THE BUDGET, spent across every call rather than per call. Each git gets what
  // is LEFT of it (capped at `CHECKOUT_TIMEOUT_MS`), and once it is gone no
  // further call is made at all — a reading that has run out of time is
  // `unreadable`, which is a state this adapter already knows how to say.
  const now = opts.now ?? ((): number => Date.now());
  const ceiling = opts.timeoutMs ?? CHECKOUT_TIMEOUT_MS;
  const deadline = now() + (opts.budgetMs ?? CHECKOUT_BUDGET_MS);
  let timedOut = false;
  const run =
    opts.git ?? gitIn(root, () => Math.max(1, Math.min(ceiling, deadline - now())), opts.env ?? process.env);
  const git: GitRunner = (args) => {
    if (timedOut || now() >= deadline) {
      timedOut = true;
      return { ok: false, out: "", failed: "timeout" };
    }
    const res = run(args);
    if (res.failed === "timeout") timedOut = true;
    return res;
  };

  const gitDir = git(["rev-parse", "--git-dir"]);
  if (!gitDir.ok) {
    // `status` is git answering "this is not a repository" — an installed
    // package, and nothing to grade. Anything else is git not answering at all.
    return {
      reason: gitDir.failed === "status" ? "not-a-repo" : "unreadable",
      root,
      ...none,
      timedOut,
    };
  }
  const ref = git(["symbolic-ref", "-q", "--short", "HEAD"]);
  const branch = ref.ok && ref.out.trim().length > 0 ? ref.out.trim() : null;
  const headRead = git(["rev-parse", "--short", "HEAD"]);
  const head = headRead.ok && headRead.out.trim().length > 0 ? headRead.out.trim() : null;
  const statusRead = git(["status", "--porcelain", "--untracked-files=no"]);
  const dirty = statusRead.ok
    ? statusRead.out.split("\n").filter((l) => l.trim().length > 0).length
    : 0;
  // THE REF THAT DECIDES, read as last fetched. Fetching here would put a
  // network call on a foreground hook, which is the one thing the wake's own
  // contract forbids (§1 G1).
  const originRead = git(["rev-parse", "--short", ORIGIN_MASTER]);
  const originMaster = originRead.ok && originRead.out.trim().length > 0 ? originRead.out.trim() : null;
  if (originMaster === null || head === null) {
    // A repository with no `origin/master` (a clone with no remote, a fresh
    // init) has nothing to grade against, and an empty repository has no HEAD.
    // Neutral, and no durable row: "we could not grade it" is not a state of
    // the checkout.
    return { reason: "unreadable", root, branch, head, dirty, behindBy: null, originMaster, atMaster: false, timedOut };
  }
  const atMaster = head === originMaster;
  const ancestor = atMaster || git(["merge-base", "--is-ancestor", "HEAD", ORIGIN_MASTER]).ok;
  const countRead = ancestor && !atMaster ? git(["rev-list", "--count", `HEAD..${ORIGIN_MASTER}`]) : null;
  const behindBy =
    countRead !== null && countRead.ok ? (Number.parseInt(countRead.out.trim(), 10) || 0) : null;

  // A reading that ran out of time is not a grade. Half the calls answered and
  // half returned nothing, and "clean at origin/master" assembled out of
  // silence is the one wrong answer this finding may not give.
  if (timedOut) {
    return { reason: "unreadable", root, branch, head, dirty, behindBy, originMaster, atMaster, timedOut };
  }

  // ORDER IS THE GRADE. Tracked modifications are red wherever HEAD sits — they
  // are code that is in no branch at all. Then: at origin/master is the deploy
  // state; an ancestor of it is old-but-merged; anything else is unmerged code
  // running against the owner's memory.
  const reason: CheckoutReading["reason"] =
    dirty > 0
      ? "dirty"
      : atMaster
        ? "master"
        : ancestor
          ? "behind"
          : branch === null
            ? "detached"
            : "branch";
  return { reason, root, branch, head, dirty, behindBy, originMaster, atMaster, timedOut };
}

/** True when this reading is one the adapter records a durable row for. A
 *  package that is not a checkout, and a git that would not answer, are not
 *  states of the checkout and leave nothing behind. */
export function checkoutIsGraded(reading: CheckoutReading): boolean {
  return reading.reason !== "not-a-repo" && reading.reason !== "unreadable";
}

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

// ── the groups ──────────────────────────────────────────────────────────────

/** The Memory line for a store this build reads only after its upgrade. */
function behindFinding(dir: string, m: MigrationReading): Finding {
  // Behind because a rollback put it there, and held: no session upgrades it.
  if (rollbackHeld(dir) !== null) {
    return finding(
      "store",
      "amber",
      MEMORY_TITLE,
      `${tilde(dir)} is on schema v${m.found}, rolled back; this version leaves it alone (see Rollback)`,
      "",
      { dir, exists: true, found: m.found, expected: m.expected, rolledBack: true },
    );
  }
  return finding(
    "store",
    "amber",
    MEMORY_TITLE,
    `${tilde(dir)} is on schema v${m.found}; this build reads it once a session has upgraded it (see Store open)`,
    "",
    { dir, exists: true, found: m.found, expected: m.expected },
  );
}

/** A finding, with `data` defaulted so each group below stays one expression. */
function finding(
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
function off(
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
function tilde(path: string): string {
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

function newestRows(store: Store, name: string, count: number, livedDay: number): NewestRead {
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
function undetermined(name: string): string {
  return (
    `newest ${name} row could not be determined: more than ${NEWEST_LIMIT} rows and no bounded window ` +
    "came back short, so the newest one was not read"
  );
}

function payloadOf(row: EventRow | undefined): Record<string, unknown> {
  if (row === undefined || row.payload === null) return {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The CALENDAR date a row is about: its own field, else the wall clock it was
 *  written at. `day` is the lived-day column and answers a different question. */
/**
 * The zone this reading names days in — the config's `timeZone`, else the
 * machine's — set once at the top of `doctorFindings` (which is synchronous)
 * so the dozen `rowDate` calls below need no extra argument.
 */
let readingZone: string = resolveZone(undefined);

function rowDate(row: EventRow | undefined): string | null {
  if (row === undefined) return null;
  const p = payloadOf(row);
  return typeof p["date"] === "string" && p["date"].length > 0 ? p["date"] : localDate(row.at, readingZone);
}

function num(p: Record<string, unknown>, key: string): number | null {
  const v = p[key];
  return typeof v === "number" ? v : null;
}

function str(p: Record<string, unknown>, key: string): string | null {
  const v = p[key];
  return typeof v === "string" ? v : null;
}

/**
 * The phases of one `sleep.cycle` row that stopped at their budget, phrased.
 * Read STRUCTURALLY — an older row carries no `budgetExhausted` at all, and a
 * phase that left nothing behind carries no count, so both read as "nothing to
 * say" rather than as a zero anybody could mistake for a measurement.
 */
function budgetTruncatedPhases(p: Record<string, unknown>): string[] {
  const phases = p["phases"];
  if (!Array.isArray(phases)) return [];
  const out: string[] = [];
  for (const entry of phases as unknown[]) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e["budgetExhausted"] !== true) continue;
    const name = str(e, "phase") ?? "a phase";
    const left = num(e, "skippedForBudget");
    out.push(
      left === null
        ? `${name} ran out of budget`
        : `${name} ran out of budget (${String(left)} rows not reached this run)`,
    );
  }
  return out;
}

/** ` (embedder.kind is not one it knows)`-shaped: the keys the loader named, or
 *  nothing when it named none. */
function unreadableClause(keys: readonly string[] | undefined): string {
  if (keys === undefined || keys.length === 0) return "";
  const known = keys.map((k) =>
    k === "embedder.kind"
      ? 'embedder.kind — it must be "static"'
      : k === "embedder.enabled"
        ? "embedder.enabled — it must be true or false"
        : k === "embedder"
          ? "embedder — it must be an object"
          : k,
  );
  return ` (${known.join("; ")})`;
}

/** The config file itself: the one the hooks read, and whether it was readable. */
function configFindings(input: DoctorInput): Finding[] {
  const out: Finding[] = [];
  const reason = input.configReason;
  if (reason === "not-read") {
    // NOT A FAULT AND NOT A GRADE. `--dir` named a store; nothing named a
    // configuration, and reading the default one is what would open somebody's
    // live configuration. So the store is graded and this line says, in the
    // words the refusal used to use, exactly what to type to grade the rest.
    out.push(
      finding(
        "config",
        "amber",
        "Config",
        `not read — you named a store with --dir and no configuration, so nothing here grades ${input.configPath}: no embedder setting, no snapshot policy, no stance`,
        `To grade those too: counterparts doctor --config <absolute path> (or set ${CONFIG_ENV}).`,
        { path: input.configPath, reason },
      ),
    );
    // ONE COUNT, read once and used twice: the sentence and the row say the
    // same number because it is the same number, and rule 3 of this module —
    // it is on the hot path, so it is bounded — is kept by not asking twice.
    const held = input.store === null ? null : memoryCount(input.store);
    const behind = input.store === null ? input.open?.migration : undefined;
    out.push(
      behind !== undefined
        ? behindFinding(input.dir, behind)
        : input.store === null && rollbackHalfway(input.dir)
        ? halfwayMemoryFinding(input.dir)
        : input.store === null
        ? finding("store", "red", MEMORY_TITLE, `no store at ${tilde(input.dir)}`, "Check the path you gave --dir.", {
            dir: input.dir,
            exists: false,
          })
        : finding("store", "green", MEMORY_TITLE, memoryDetail(input, held), "", {
            dir: input.dir,
            exists: true,
            memories: held,
          }),
    );
    return out;
  }
  if (reason === "absent" || reason === "unreadable") {
    out.push(
      finding(
        "config",
        "red",
        "Config",
        `${input.configPath} — ${reason === "absent" ? "no such file" : `unreadable${unreadableClause(input.configUnreadableKeys)}, so every entry point stands down to observer`}`,
        reason === "absent"
          ? "Run: counterparts install (or point --config at the file you meant)."
          : "Fix the JSON, or restore it from claude-code.json.bak beside it.",
        {
          path: input.configPath,
          reason,
          ...(reason === "unreadable" && (input.configUnreadableKeys ?? []).length > 0
            ? { keys: (input.configUnreadableKeys ?? []).join(",") }
            : {}),
        },
      ),
    );
  } else {
    out.push(
      finding(
        "config",
        "green",
        "Config",
        `${input.configPath} — read; dataDir ${input.config.dataDir ?? "(unset: the default store)"}`,
        "",
        { path: input.configPath, reason: reason ?? "read-by-caller", dataDir: input.config.dataDir ?? null },
      ),
    );
    // SETTINGS THIS BUILD NO LONGER READS (keyless, 2026-09-24) — a quiet note,
    // GREEN, never a warning: the owner's own configuration carries
    // `credentialsFile` from the install that wrote it, and a key nobody needs
    // any more is not a fault. Printed under `--all`; nothing to do.
    const retired = input.config.retired ?? [];
    if (retired.length > 0) {
      out.push(
        finding(
          "retired",
          "green",
          "Old settings",
          `${retired.join("; ")} — ignored; you may remove ${retired.length === 1 ? "it" : "them"} from ${tilde(input.configPath)}`,
          "",
          { count: retired.length },
        ),
      );
    }
  }

  // THE STORE THE HOOKS WOULD OPEN, against the one this reading opened. I31's
  // shape: the hooks and another entry point named different stores and nothing
  // noticed, because each was internally consistent.
  const named = input.config.dataDir;
  if (input.store === null && input.open?.migration !== undefined) {
    out.push(behindFinding(input.dir, input.open.migration));
  } else if (input.store === null && rollbackHalfway(input.dir)) {
    out.push(halfwayMemoryFinding(input.dir));
  } else if (input.store === null) {
    out.push(
      finding("store", "red", MEMORY_TITLE, `no store at ${tilde(input.dir)}`, "Run: counterparts install, or name the store with --dir.", {
        dir: input.dir,
        exists: false,
      }),
    );
  } else if (named !== undefined && named !== input.dir) {
    out.push(
      finding(
        "store",
        "amber",
        MEMORY_TITLE,
        `read ${tilde(input.dir)}, but ${tilde(input.configPath)} names ${tilde(named)} — the hooks read the second one`,
        "Drop --dir (and COUNTERPARTS_DATA_DIR) to read the store the hooks use.",
        { dir: input.dir, named, exists: true },
      ),
    );
  } else {
    // One count, read once — see the `not-read` arm above.
    const held = memoryCount(input.store);
    out.push(
      finding("store", "green", MEMORY_TITLE, memoryDetail(input, held), "", {
        dir: input.dir,
        exists: true,
        memories: held,
      }),
    );
  }

  // THE STANCE IS CALLED `Mode` NOW, and it is said in the words a person can
  // act on rather than in the configuration's (finding #20: "owner: this host
  // encodes" was named as the line nobody could read). The key and the `data`
  // are untouched, so every reader of the JSON sees what it always saw.
  if (input.config.observer === true) {
    out.push(
      finding("stance", "amber", "Mode", "observer — reads memory, writes nothing", "Remove \"observer\" from the config to remember again.", {
        observer: true,
      }),
    );
  } else {
    // WHOSE SESSIONS ARE THE OWNER'S, said plainly (2026-10-02): with the
    // install's `owner: true`, the hooks, the worker and — since that day —
    // the memory server Claude Code starts (`mcp/bin/serve.ts#ownerStance`).
    const owner = input.config.owner === true;
    out.push(
      finding(
        "stance",
        "green",
        "Mode",
        owner
          ? "remembering; your Claude Code sessions are the owner's (confidential memories are said in them, and an open question can be closed from any directory); a Claude Desktop chat is not; COUNTERPARTS_OWNER=0 on the memory server's launch turns it off for the memory server, and the hooks follow this configuration"
          : "remembering; no session is the owner's (the configuration has no \"owner\": true), so confidential memories stay out of the tools' answers",
        "",
        { observer: false, owner },
      ),
    );
  }
  return out;
}

/** The column heading the store's own line reads under. It is "Memory" and not
 *  "Store" because the person reading it did not install a database. */
const MEMORY_TITLE = "Memory";

/**
 * HOW MANY MEMORIES THIS STORE HOLDS — the wake preface's own query, which is
 * the number `status` prints as `Memories:` and says so in its aside.
 *
 * ONE `SELECT COUNT(*)` over an indexed filter, never `status`'s walk of every
 * row: this line is built on the hook's hot path too, and a census that opened
 * every row would put the whole store between a session and its first word.
 */
function memoryCount(store: Store): number | null {
  try {
    return store.countMemories({ type: "memory", archived: false });
  } catch {
    // A store that will not answer still has a path worth printing, and the
    // `Store open` line is where an unreadable store is graded.
    return null;
  }
}

/**
 * `~/.counterparts/store — 32 memories, opens fine`.
 *
 * "Opens fine" is the `Store open` reading (`input.open`), said here because
 * the two facts are one sentence to a person: this is where your memory is,
 * and it works. The separate `store-open` finding stays — `doctor --all` and
 * `--json` still carry it, and a store that will NOT open prints its own line
 * with the code and the repair.
 */
function memoryDetail(input: DoctorInput, n: number | null): string {
  const held = n === null ? "" : ` — ${String(n)} ${n === 1 ? "memory" : "memories"}`;
  const opens = input.open?.ok === true ? ", opens fine" : "";
  return `${tilde(input.dir)}${held}${opens}`;
}

/**
 * RECALL BY MEANING — the local table, as ONE line.
 *
 * **The finding (#24, the owner's 0.2.0 trial).** An optional feature nobody
 * turned on used to produce three ambers — the embedder, its key, and the
 * unembedded vectors — and the fix line told him to hand-edit a JSON file
 * (#19). A person reads that as a broken install. So it is one line, and a
 * block switched off is `OFF`: optional, nothing wrong. `vectorFindings` says
 * nothing at all while the embedder is off (there is nothing to embed).
 *
 * The one grade that is not `OFF` while it is off: **switched OFF on a store
 * that HAS embedded** — something that was running has stopped. Amber, never
 * `OFF`, which would claim nobody ever turned it on.
 */
function embedderFindings(input: DoctorInput, history: KeyHistory, source: EmbedderSource): Finding[] {
  const enabled = input.config.embedder?.enabled === true;
  const data = { enabled, everEmbedded: history.embedded, source };
  // The command it names turns ANY off block on as the local table
  // (`install.ts#resolveEmbedderBlock`).
  const turnOn = `Turn on: ${EMBEDDER_ON_COMMAND}`;
  // THE STORE'S OWN VERDICT FIRST (review of #190, MAJOR 4): a hold or a newer
  // build's cache turns the channel off whatever the configuration says, and
  // it is read DURABLY — this handle is an observer and reconciles nothing.
  if (enabled) {
    const withdrawn = withdrawnFinding(input);
    if (withdrawn !== null) return [withdrawn];
    return [staticFinding(input, data)];
  }
  if (history.embedded) {
    // SAYS WHAT STILL WORKS (2026-09-20, finding 1). "No vectors, no semantic
    // channel" is true and reads as a broken install. Lexical recall is a whole
    // working channel, not a degraded mode.
    return [
      finding(
        "embedder",
        "amber",
        RECALL_TITLE,
        "off — and this store HAS embedded before, so something that was running has stopped. " +
          "Recall still matches on words; what is gone is finding a memory that says the same thing in different words",
        turnOn,
        data,
      ),
    ];
  }
  return [
    off(
      "embedder",
      RECALL_TITLE,
      "switched off in the configuration. Recall works on words; the local table lets it match meaning too, and nothing leaves this machine.",
      turnOn,
      data,
    ),
  ];
}

const RECALL_TITLE = "Recall by meaning";

/**
 * THE COMMAND THAT TURNS RECALL BY MEANING ON for a configuration that exists
 * (roadmap C3). `install` writes the block only when it creates the file, so an
 * existing one — every 0.2.0 install, the owner's included — needs `--force`
 * to be rewritten, and `--force` carries every other key forward
 * (`commands.ts#carryForward`). One sentence, printed by doctor and quoted by
 * QUICKSTART.
 */
export const EMBEDDER_ON_COMMAND = "counterparts install --force --embedder";

/** Where a static table's weights came from, in words (`resolveStaticWeights`'
 *  `source`, or the worker row's `weights`). */
function weightsFrom(source: string): string {
  if (source === "package") return `the ${STATIC_WEIGHTS_PACKAGE} package`;
  if (source === "env") return STATIC_WEIGHTS_ENV;
  if (source === "option") return "a directory named by the caller";
  return source;
}

/**
 * A HOLD, or a cache from a newer build — the two states in which the store
 * itself has taken the vector channel away (cache v5). Amber, and each names
 * its own way out; the grade is the same whichever embedder is configured,
 * because in both states nothing is ranked or embedded until somebody acts.
 */
function withdrawnFinding(input: DoctorInput): Finding | null {
  let v;
  try {
    v = input.store?.embedderVerdict;
  } catch {
    return null;
  }
  if (v === undefined) return null;
  if (v.kind === "held") {
    // Named for the hold AS IT IS (re-review MINOR B). Since 2026-09-24 the
    // model that wrote held rows — the removed Voyage seat, in practice — can
    // no longer be configured, so the one exit is to drop them.
    const from = v.recorded ?? "an older build that did not tag them (0.2.0 or earlier)";
    return finding(
      "embedder",
      "amber",
      RECALL_TITLE,
      `held — the store holds ${v.rows} vectors from ${from}, and the configuration asks for ${v.configured ?? "another model"}; ` +
        "nothing is embedded or matched by meaning until they are dropped. Recall still matches on words",
      `To match by meaning again, ${heldExits(v.recorded).replace("<store>", tilde(input.dir))}.`,
      { held: true, recorded: v.recorded, configured: v.configured, rows: v.rows },
    );
  }
  if (v.kind === "cache-ahead") {
    // The same two ways out as the server's refusal (`mcp/server.ts#
    // cacheAheadRefusal`, review of #382): "update" alone was wrong after
    // going back to an older build on purpose. This console is the older
    // build here, so both ways are open: the newer build back, or the cache
    // (rebuildable, no memory in it) gone.
    return finding(
      "embedder",
      "amber",
      RECALL_TITLE,
      `off in this process — the store's cache was written by a newer Counterparts (cache v${v.found}; this build reads v${v.expected}). Recall still matches on words`,
      `Either install the newer build again (bun add -g counterparts@latest), or, to stay on this one, delete ${tilde(input.dir)}/cache/cache.sqlite* (the search cache alone; no memory is kept there, and it is rebuilt) — then in Claude Code run /mcp → Reconnect so the server opens it.`,
      { cacheAhead: true, found: v.found, expected: v.expected },
    );
  }
  return null;
}

/**
 * THE LOCAL TABLE'S LINE (review of #190, MAJOR 3).
 *
 *   - What the WORKER saw wins: its newest backfill row says which embedder
 *     ran, where its weights came from, or — `embedder-unavailable` — the code
 *     it refused with. That row is written in the hooks' own environment, which
 *     is not the console's (I32).
 *   - With no row yet, this process looks for the table itself, and says that
 *     the first boundary will confirm it.
 */
function staticFinding(input: DoctorInput, data: Record<string, string | number | boolean | null>): Finding {
  const install = `Install the table: bun add -g ${STATIC_WEIGHTS_PACKAGE} — or set ${STATIC_WEIGHTS_ENV} in the environment Claude Code starts hooks with`;
  const row = newestBackfill(input);
  if (row !== null && str(row, "reason") === "embedder-unavailable") {
    const code = str(row, "codes") ?? "NO_WEIGHTS";
    return finding(
      "embedder",
      "amber",
      RECALL_TITLE,
      `on (a local table), but the worker could not load its weights (${code}) — nothing is embedded; recall still matches on words`,
      code === "HASH_MISMATCH" ? `The table on disk is not the one its package declares. Reinstall it: bun add -g ${STATIC_WEIGHTS_PACKAGE}` : install,
      { ...data, kind: "static", code },
    );
  }
  if (row !== null && str(row, "kind") === "static" && str(row, "weights") !== null) {
    return finding(
      "embedder",
      "green",
      RECALL_TITLE,
      `on — a local table (${str(row, "model") ?? "static"}, weights from ${weightsFrom(String(str(row, "weights")))}); nothing leaves this machine`,
      "",
      { ...data, kind: "static", weights: str(row, "weights") },
    );
  }
  const bundled = bundledModelDir();
  const found = resolveStaticWeights(bundled === undefined ? {} : { packageDir: bundled });
  // THE TABLE FILE, not just a folder: a `COUNTERPARTS_STATIC_WEIGHTS_DIR`
  // naming an empty or wrong folder is found by name and holds nothing, and a
  // green here would last until the first worker row said NO_WEIGHTS.
  if (found === null || !existsSync(join(found.dir, MODEL_FILE))) {
    return finding(
      "embedder",
      "amber",
      RECALL_TITLE,
      found === null
        ? "on (a local table), but its weights were not found — nothing will be embedded; recall still matches on words"
        : `on (a local table), but its weights were not found in ${tilde(found.dir)} (named by ${weightsFrom(found.source)}) — nothing will be embedded; recall still matches on words`,
      install,
      { ...data, kind: "static", weights: null },
    );
  }
  return finding(
    "embedder",
    "green",
    RECALL_TITLE,
    `on — a local table (weights from ${weightsFrom(found.source)}); nothing leaves this machine (the hooks confirm it when a session ends)`,
    "",
    { ...data, kind: "static", weights: found.source },
  );
}

/** The newest backfill row's payload, or null — one bounded read, never a throw. */
function newestBackfill(input: DoctorInput): Record<string, unknown> | null {
  const store = input.store;
  if (store === null) return null;
  try {
    const read = newestRows(store, EMBED_BACKFILL_EVENT, 1, store.livedDay());
    const row = read.rows[0];
    return row === undefined ? null : payloadOf(row);
  } catch {
    return null;
  }
}

/**
 * HAS THIS STORE EVER EMBEDDED (2026-09-20, finding 1).
 *
 * The discriminator between "switched off, never used" (`OFF`) and "was
 * running and has stopped" (amber) on the Recall by meaning line. The store's
 * own evidence, never a marker file: any backfill that ever embedded anything,
 * over a bounded window of the OLDEST rows, which is where a table that worked
 * and was then switched off would be. (It read the Anthropic key's history
 * too, until that key was removed on 2026-09-24.)
 */
interface KeyHistory {
  readonly embedded: boolean;
}

export function keyHistory(store: Store | null): KeyHistory {
  if (store === null) return { embedded: false };
  try {
    return {
      embedded: store
        .eventLog({ name: EMBED_BACKFILL_EVENT, limit: KEY_HISTORY_ROWS })
        .some((r) => (num(payloadOf(r), "embedded") ?? 0) > 0),
    };
  } catch {
    // A store that will not answer is not a store that says "never".
    return { embedded: false };
  }
}

/**
 * HAS THIS STORE LIVED A BOUNDARY (2026-10-11) — a backfill row or a sweep row,
 * any at all, asked directly: `newestBackfill` reads null both for "none" and
 * for "too many to say", and only the first means a store that has not yet
 * lived a boundary. The sweep row counts too (review of #393): a backfill that
 * throws every run writes no row of its own, but the sweep after it still
 * does, and that store's shortfall is a fault, not "not built yet". A store
 * that will not answer is read as having lived one, so the line keeps its amber.
 */
function livedABoundary(store: Store): boolean {
  try {
    return (
      store.eventLog({ name: EMBED_BACKFILL_EVENT, limit: 1 }).length > 0 ||
      store.eventLog({ name: SWEEP_GATE_EVENT, limit: 1 }).length > 0
    );
  } catch {
    return true;
  }
}

/** How many backfill rows the "has this store ever embedded" read looks at. */
const KEY_HISTORY_ROWS = 200;

/**
 * RAW TRANSCRIPTS — how long the captured conversation is kept, and what the
 * newest retention pass did (remember INTERFACE-GAPS §11; roadmap B3).
 *
 * The first clause is the POLICY, worded so it does not over-promise (PR #189
 * review m4, m5): the text lives in the store for a week after a session ends,
 * and each daily snapshot holds a copy of whatever was there that day, so the
 * last copy is gone only after the snapshots rotate past it too. Both numbers
 * are read — the week from `remember/`'s tunable, the snapshots from the
 * configuration's `keep` — never retyped.
 *
 * The rest is the newest `remember.prune` row, in sessions. Grades:
 *
 *   - **green** with no row at all: a store the worker has not reached yet
 *     has nothing to prune, and that is not a fault;
 *   - **amber** when the newest pass could not delete something (`failed`), or
 *     when it is a `STARTED` / `LATCH_HELD` row from a day before today — a
 *     pass that took its latch and never wrote its result;
 *   - **green** otherwise, `STARTED` today included (a pass is under way).
 *
 * "kept until written up" is a session that still owes its write-up (B3's
 * predicate); it is kept until the next session in its project writes it up.
 */
function retentionFindings(input: DoctorInput, store: Store): Finding[] {
  const TITLE = "Raw transcripts";
  const days = Math.round(REMEMBER_TUNABLES.RETENTION_MS / 86_400_000);
  const keep = keepOf(input.config.snapshots?.keep);
  const policy = `${String(days)} days after a session ends (up to ${String(days + keep)} counting the daily snapshots)`;
  const run = lastRetentionRun(store);
  const base = { retentionDays: days, snapshotKeep: keep };
  if (run === null) {
    return [finding("retention", "green", TITLE, `${policy} · not run yet`, "", { ...base, ran: false })];
  }
  const data = {
    ...base,
    ran: true,
    date: run.date,
    reason: run.reason,
    deleted: run.deleted,
    keptOwed: run.keptOwed,
    keptYoung: run.keptYoung,
    keptLive: run.keptLive,
    failed: run.failed,
  };
  const unfinished = run.reason === "STARTED" || run.reason === "LATCH_HELD";
  if (unfinished && run.date < input.today) {
    return [
      finding(
        "retention",
        "amber",
        TITLE,
        `${policy} · the pass on ${run.date} started and did not finish, and none has run since`,
        "Nothing is deleted without a finished pass. It runs again when a session ends; to watch it: counterparts doctor --all",
        data,
      ),
    ];
  }
  if (unfinished) {
    return [finding("retention", "green", TITLE, `${policy} · a pass started today`, "", data)];
  }
  const counts = `${String(run.deleted)} pruned ${run.date} · ${String(run.keptOwed)} kept until written up · ${String(run.keptLive)} still open`;
  if (run.failed > 0) {
    return [
      finding(
        "retention",
        "amber",
        TITLE,
        `${policy} · ${counts} · ${String(run.failed)} could not be deleted`,
        `The next pass tries again. Check the folder is writable: ls -ld ${tilde(input.dir)}/spans`,
        data,
      ),
    ];
  }
  return [finding("retention", "green", TITLE, `${policy} · ${counts}`, "", data)];
}

/**
 * THE ZONE IN USE, on the Clock line (docs/time.md, 2026-09-25): `(America/Denver)`,
 * and when the config names a zone this machine does not know, that too — it
 * was ignored, and this is where the owner sees it.
 */
function zoneNote(input: DoctorInput): string {
  const unknown = input.config.timeZoneUnknown;
  return unknown === undefined
    ? `(${readingZone})`
    : `(${readingZone}; timeZone "${unknown}" in the config is not a zone this machine knows, so it was ignored)`;
}

/** The two clocks, and the gap that IS I32's signature. */
function clockFindings(input: DoctorInput, store: Store): Finding[] {
  const livedDay = store.livedDay();
  const raw = store.getMeta("lastActiveDate");
  // A store that has never lived a day carries the key with an EMPTY value, and
  // "" is not the same fact as "2026-09-04": collapsing them here is how a fresh
  // store would read as a frozen one.
  const lastActive = raw === undefined || raw.length === 0 ? null : raw;
  const read = newestRows(store, BOUNDARY_EVENT, 1, livedDay);
  const boundary = rowDate(read.rows[0]);
  const data = { livedDay, lastActiveDate: lastActive, newestBoundary: boundary, today: input.today };
  // Unknown is not "(none)": an unread newest boundary cannot be compared with
  // the clock, so the comparison is not made and the line says why.
  if (read.unknown) {
    const facts =
      `lived day ${livedDay}, lastActiveDate ${lastActive ?? "(unset)"}, today ${input.today} ${zoneNote(input)} — ` +
      undetermined(BOUNDARY_EVENT);
    return [finding("clock", "green", "Clock", facts, "", data)];
  }
  const facts =
    `lived day ${livedDay}, lastActiveDate ${lastActive ?? "(unset)"}, ` +
    `newest boundary ${boundary ?? "(none)"}, today ${input.today} ${zoneNote(input)}`;
  if (boundary !== null && (lastActive === null || lastActive < boundary)) {
    return [
      finding(
        "clock",
        "amber",
        "Clock",
        `${facts} — sessions are reaching boundaries and the clock is not advancing: the worker is not running`,
        "Read the Spawn line below; a refused spawn is the usual cause.",
        data,
      ),
    ];
  }
  return [finding("clock", "green", "Clock", facts, "", data)];
}

/** The newest row of each family the background half leaves behind. */
function rowFindings(input: DoctorInput, store: Store): Finding[] {
  const livedDay = store.livedDay();
  const out: Finding[] = [];
  /**
   * WAS THERE EVER AN OPPORTUNITY? An absent row is only evidence when a
   * boundary has been reached: on a store that has never held a session there is
   * nothing for the worker to have swept, no cycle to have run and nothing to
   * have embedded, and three ambers on a fresh install teach the owner to read
   * amber as decoration.
   */
  // `unknown` means the store holds MORE than `NEWEST_LIMIT` boundary rows, so
  // it has certainly lived — the one thing this flag needs to know.
  const boundaries = newestRows(store, BOUNDARY_EVENT, 1, livedDay);
  const lived = boundaries.unknown || boundaries.rows.length > 0;
  /** The "no row yet" finding: amber once the store has lived, green before. */
  const absent = (key: string, title: string, what: string, fix: string): Finding =>
    lived
      ? finding(key, "amber", title, what, fix, { rows: 0 })
      : finding(key, "green", title, `${what} — and no boundary has been reached here yet`, "", { rows: 0 });
  /** The "we could not read the newest one" finding: neutral, never a grade. */
  const unread = (key: string, title: string, name: string): Finding =>
    finding(key, "green", title, undetermined(name), "", { unknown: true });

  const sweepRead = newestRows(store, SWEEP_GATE_EVENT, 1, livedDay);
  const sweep = sweepRead.rows[0];
  if (sweepRead.unknown) {
    out.push(unread("sweep", "Sweep", SWEEP_GATE_EVENT));
  } else if (sweep === undefined) {
    out.push(absent("sweep", "Sweep", "no sweep.gate row — no worker has reached the crash sweep here", "Read the Spawn line below."));
  } else {
    const p = payloadOf(sweep);
    const reason = str(p, "reason") ?? "(none)";
    const detail = `newest sweep.gate ${rowDate(sweep) ?? "?"}: reason ${reason}, ran ${num(p, "ran") ?? 0} of ${num(p, "scopes") ?? 0} scopes`;
    /**
     * THE SWEEP NEVER INTERPRETS HERE ANY MORE (keyless, 2026-09-24): the worker
     * writes `not-opted-in`, and a row from an older build wrote `no-credential`
     * for the same keyless day — both are the ordinary state, GREEN, with the
     * next session writing crashed sessions up.
     */
    const nextSession = reason === "not-opted-in" || reason === "no-credential";
    out.push(
      reason === "ran"
        ? finding("sweep", "green", "Sweep", detail, "", { reason, ran: num(p, "ran"), date: rowDate(sweep) })
        : nextSession
          ? finding(
              "sweep",
              "green",
              "Sweep",
              `${detail} — next session: a session that ended unwritten is written up by the next session in its project`,
              "",
              { reason, ran: num(p, "ran"), date: rowDate(sweep) },
            )
          : finding("sweep", "amber", "Sweep", detail, "The sweep stood down; the reason names why.", {
              reason,
              ran: num(p, "ran"),
              date: rowDate(sweep),
            }),
    );
  }

  const cycleRead = newestRows(store, SLEEP_CYCLE_EVENT, 1, livedDay);
  const cycle = cycleRead.rows[0];
  if (cycleRead.unknown) {
    out.push(unread("sleep", "Sleep", SLEEP_CYCLE_EVENT));
  } else if (cycle === undefined) {
    out.push(absent("sleep", "Sleep", "no sleep.cycle row — no cycle has run here since the rows existed", "Read the Spawn line below."));
  } else {
    const p = payloadOf(cycle);
    const reason = str(p, "reason") ?? "(none)";
    const failed = num(p, "failed") ?? 0;
    // WHICH PHASES RAN OUT OF ROAD, from the row's own phase entries (durable
    // since 2026-09-18). Not a severity: with a resume cursor a big store is
    // MEANT to take several nights over a full pass, and grading that amber
    // would teach the reader to ignore this line. It is here so that "the
    // consolidate pass reached a third of the store" is readable at all — the
    // fact that hid for two weeks was not that it happened but that nothing said so.
    const truncated = budgetTruncatedPhases(p);
    const detail =
      `newest sleep.cycle ${rowDate(cycle) ?? "?"}: reason ${reason}, ${failed} failed phase${failed === 1 ? "" : "s"}` +
      (str(p, "failedPhase") === null ? "" : `, died in ${String(str(p, "failedPhase"))}`) +
      (truncated.length === 0 ? "" : `; ${truncated.join(", ")}`);
    // `reason` is "ran" | "clock-failed" | "threw" (`counterpart.ts#recordSleepCycle`),
    // so anything but "ran" is a night that did not happen, not a cadence.
    const data = { reason, failed, date: rowDate(cycle), budgetTruncated: truncated.length };
    out.push(
      reason !== "ran"
        ? finding("sleep", "red", "Sleep", detail, "The nightly cycle is not completing — decay, prune, dedup and consolidate are not running.", data)
        : failed > 0
          ? finding("sleep", "amber", "Sleep", detail, "A phase failed; the row names it.", data)
          : finding("sleep", "green", "Sleep", detail, "", data),
    );
  }

  // TWO rows, because one bad backfill is a flaky provider and two in a row is
  // a poisoned input that will never clear itself (I33's whole shape: the same
  // head-64 chunk retried for 32 consecutive runs).
  const backfillRead = newestRows(store, EMBED_BACKFILL_EVENT, 2, livedDay);
  const backfills = backfillRead.rows;
  const newest = backfills[backfills.length - 1];
  if (backfillRead.unknown) {
    out.push(unread("backfill", "Backfill", EMBED_BACKFILL_EVENT));
  } else if (newest === undefined) {
    out.push(
      absent("backfill", "Backfill", "no adapter.embed.backfill row — nothing has been embedded here", "Read the Recall by meaning line."),
    );
  } else {
    const p = payloadOf(newest);
    const embedded = num(p, "embedded") ?? 0;
    const failed = num(p, "failed") ?? 0;
    const detail =
      `newest backfill ${rowDate(newest) ?? "?"}: embedded ${embedded}, failed ${failed}, ` +
      `remaining ${num(p, "remaining") ?? 0}, skipped ${num(p, "skipped") ?? 0}` +
      (str(p, "codes") === null || str(p, "codes") === "" ? "" : `, codes ${String(str(p, "codes"))}`);
    const prior = backfills.length > 1 ? payloadOf(backfills[0]) : null;
    const stalledTwice =
      embedded === 0 &&
      failed > 0 &&
      prior !== null &&
      (num(prior, "embedded") ?? 0) === 0 &&
      (num(prior, "failed") ?? 0) > 0;
    const data = { embedded, failed, remaining: num(p, "remaining"), skipped: num(p, "skipped"), codes: str(p, "codes"), date: rowDate(newest) };
    // NOT GREEN WHEN NOTHING COULD RUN (review of #190, MAJOR 4): a withdrawn
    // channel or an embedder that could not be built has `failed: 0` because it
    // never tried, which is the opposite of healthy.
    const why = str(p, "reason");
    const idle = why === "vectors-withdrawn" || why === "embedder-unavailable";
    out.push(
      idle
        ? finding(
            "backfill",
            "amber",
            "Backfill",
            `${detail} — ${why === "vectors-withdrawn" ? "the store has withdrawn the vector channel" : "the embedder could not be built"}, so nothing was tried`,
            "Read the Recall by meaning line.",
            { ...data, reason: why },
          )
        : stalledTwice
        ? finding("backfill", "red", "Backfill", `${detail} — and the run before it embedded nothing too`, "The backfill is head-of-line blocked; the codes name the fault (see I33).", data)
        : failed > 0
          ? finding("backfill", "amber", "Backfill", detail, "Some chunks failed; the codes name why.", data)
          : finding("backfill", "green", "Backfill", detail, "", data),
    );
  }

  // The BOUNDARY's newest row is the reading; a `drewOn` row (the tools' own,
  // 2026-10-11) is counted beside it, never read as the seam's verdict.
  const creditRead = newestRows(store, RECALL_CREDIT_EVENT, CREDIT_ROWS_BACK, livedDay);
  const credit =
    [...creditRead.rows].reverse().find((r) => payloadOf(r)["source"] !== DREW_ON_SOURCE) ?? creditRead.rows[creditRead.rows.length - 1];
  if (creditRead.unknown) {
    out.push(unread("credit", "Credit", RECALL_CREDIT_EVENT));
  } else if (credit !== undefined) {
    const p = payloadOf(credit);
    const reason = str(p, "reason") ?? "(none)";
    const drewOn = drewOnWeek(store, livedDay);
    const detail =
      `newest recall.credit ${rowDate(credit) ?? "?"}: reason ${reason}, credited ${num(p, "credited") ?? 0} of ${num(p, "considered") ?? 0} considered` +
      (drewOn.calls === 0 ? "" : `; drewOn ${drewOn.credited} credited of ${drewOn.named} named in ${drewOn.calls} call${drewOn.calls === 1 ? "" : "s"} over ${DREW_ON_DAYS} days`);
    const data = {
      reason,
      credited: num(p, "credited"),
      considered: num(p, "considered"),
      date: rowDate(credit),
      drewOnCalls: drewOn.calls,
      drewOnNamed: drewOn.named,
      drewOnCredited: drewOn.credited,
    };
    // `no-candidates` and `nothing-to-credit` are the ORDINARY readings until a
    // session expands or quotes something (HANDOFF, 2026-09-14); only the seam
    // itself failing is a finding.
    out.push(
      reason === "failed"
        ? finding("credit", "amber", "Credit", detail, "The credit seam threw; the row names the reason.", data)
        : finding("credit", "green", "Credit", detail, "", data),
    );
  }
  return out;
}

/** The `source` a `drewOn` field's `recall.credit` row carries (`mcp/server.ts#drewOnField`). */
const DREW_ON_SOURCE = "drewOn";
/** How many of the newest `recall.credit` rows the Credit line looks back
 *  through for the boundary's own, past any `drewOn` rows after it. */
const CREDIT_ROWS_BACK = 20;
/** The `drewOn` count's window, in lived days (for the ~10-14 check-in: is it used?). */
const DREW_ON_DAYS = 7;

/**
 * THE `drewOn` FIELD'S WEEK (2026-10-11): how many calls named memories, how
 * many ids they named, and how many of those were credited — summed from the
 * tools' own `recall.credit` rows. A read; zero when nothing used it.
 */
function drewOnWeek(store: Store, livedDay: number): { calls: number; named: number; credited: number } {
  let calls = 0;
  let named = 0;
  let credited = 0;
  try {
    for (const row of store.eventLog({ name: RECALL_CREDIT_EVENT, sinceDay: Math.max(0, livedDay - (DREW_ON_DAYS - 1)), order: "desc", limit: 5000 })) {
      const p = payloadOf(row);
      if (p["source"] !== DREW_ON_SOURCE) continue;
      calls += 1;
      named += num(p, "considered") ?? 0;
      credited += num(p, "credited") ?? 0;
    }
  } catch {
    // A count that cannot be read is left out, never guessed.
  }
  return { calls, named, credited };
}

/**
 * WHO IS DOING THE WRITING — one week of it, in plain counts.
 *
 * Finding 12 (2026-09-17): the crash fallback out-wrote the session 4.5 : 1
 * while every surface read healthy, because nobody read out how often the
 * session was OFFERED the pen and how much of the week it wrote. Both come out
 * of rows the store already keeps (constitution 11):
 *
 *   - **the asks, by `outcome`** (`adapter.ask`): `asked` went out, `paced` was
 *     refused by the pacer, `capped` by the session's allowance for the day
 *     (`reason: session-ask-cap`; rows before 2026-09-17 say `day-chapter-cap`,
 *     the old shared cap, and are counted apart in `data`);
 *   - **the answers** (`gate.deposit`);
 *   - **the memories** (`memories.source`): the week's live memories the
 *     session wrote itself, against those the fallback sweep wrote for it.
 *
 * GREEN, with counts: cap refusals and the sweep's share are not losses, and
 * the one loss it could name — a session that owes a write-up
 * (`core/coverage/`) from yesterday or earlier — is the `Write-ups` line's
 * amber. This line carries that count as detail, or says "unknown"
 * when it could not be read. The session-start reading does not read the owed
 * sessions (it walks every scope's words), so there the line omits them.
 *
 * The window is CALENDAR days, from the payload's own `date` (else the row's
 * wall clock), never the lived-day column; `sinceDay` only keeps the SQL cheap.
 */
export const AUTHORSHIP_DAYS = 7;

/** The cap in force. Declared `satisfies AskReason` so a rename in
 *  `self/episodes.ts` fails `tsc` here instead of quietly reading zero. */
const SESSION_ASK_CAP = "session-ask-cap" satisfies AskReason;

/** The shared day cap in force until 2026-09-17. Nothing writes it now. */
const DAY_CHAPTER_CAP = "day-chapter-cap";

/** The ceiling on one authorship read. A week of the owner's busiest recorded
 *  day (137 ask decisions) is two orders of magnitude inside this; a read that
 *  hits it says so rather than reporting the prefix as the whole. */
const AUTHORSHIP_LIMIT = 20000;

/**
 * THE KEY `start-fresh` WRITES, spelled out rather than imported.
 *
 * `STORE_STARTED_KEY` lives in `adapters/cli/commands.ts`, which imports THIS
 * file — so importing it back would be a cycle. `test/doctor.test.ts` holds the
 * two strings to each other, so a rename there fails a test here instead of
 * silently reading nothing one morning.
 */
const STORE_STARTED_META = "store.started";

/**
 * THE FIRST DAY THIS STORE CAN EVIDENCE, or null when it can evidence none.
 *
 * The finding (new-user findings #8, 2026-09-21): a seven-day window printed
 * `2026-09-15→2026-09-21` on a store made that morning — a week the store did
 * not exist for. The window is not wrong about what it LOOKED at; it is wrong
 * about what it could have seen, and a reader has no way to tell the two apart.
 *
 * TWO SOURCES, and both are the store's own record of ITSELF — never of what is
 * in it. The earliest of them wins, because an over-stated age costs nothing
 * (the window is simply not clamped, which is today's behaviour) while an
 * under-stated one would name a window narrower than the rows it counted:
 *
 *   1. `store.created` — one meta row, written by the open that made the file
 *      (`core/store#STORE_CREATED_KEY`).
 *   2. `store.started` — `start-fresh`'s own record of the day a blank store
 *      took a parked one's place.
 *
 * **Absent on every store made before 2026-09-21** — every store 0.1.0 made,
 * which is why finding #8 stayed open for them after 0.2.0 closed it for new
 * ones. So when neither record is there, the store's own evidence stands in
 * (2026-09-23), and the EARLIER of two readings wins:
 *
 *   3. **The oldest event row's `at`** — the moment a row was WRITTEN, on the
 *      store's own provenance clock, and the smallest one (`eventLogCensus`'s
 *      `MIN(at)`), not the first row by insertion order. Not `rowDate`: that
 *      prefers the payload's `date` field, the day the event is ABOUT.
 *   4. **The database file's birth time.** A filesystem that keeps none reports
 *      zero, or — Node's documentation allows it — the change time instead;
 *      a birth time that is not EARLIER than the change time is therefore read
 *      as "no answer" rather than trusted.
 *
 * **WHICH WAY THESE CAN BE WRONG, said plainly (review of #188, M2): YOUNGER.**
 * Each is the latest day the store could have begun, never the earliest: no
 * row is written before the store exists, and `install` writes no event, so a
 * store installed on the 3rd and first used on the 10th has its oldest row on
 * the 10th; a database restored from a copy is born the day it was copied.
 * Taking the earlier of the two answers the common case — an installed-but-idle
 * store, whose FILE was born on the 3rd — and leaves one: a store that was both
 * copied into place and idle before its first row. Its label then starts later
 * than the store did, and hides days on which nothing was invited — the very
 * silence the Authorship line exists to show. The READING is untouched either
 * way (`windowShown` moves only the words), which is why a label that can err
 * in that one case was judged worth having for every 0.1.0 store rather than
 * no label at all. Event pruning does not add a case: a row goes only at 90
 * lived days, far outside a seven-day window.
 *
 * TWO THINGS THAT LOOK LIKE SOURCES AND ARE NOT. A memory's `learned_on` — an
 * imported store carries dates from long before it existed. `livedDay` — the
 * physics clock, which the worker advances and which is 0 on a store whose
 * worker has never run.
 */
function storeFirstDay(store: Store): string | null {
  let first: string | null = null;
  for (const key of [STORE_CREATED_KEY, STORE_STARTED_META]) {
    const said = store.getMeta(key);
    if (said === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(said)) continue;
    if (first === null || said < first) first = said;
  }
  if (first !== null) return first;
  const readings = [oldestEventDay(store), databaseBirthDay(store.dir)].filter(
    (d): d is string => d !== null,
  );
  return readings.length === 0 ? null : readings.reduce((a, b) => (b < a ? b : a));
}

/** The calendar day (the person's zone) of the EARLIEST `at` among the store's
 *  event rows, or null when it has none, or none that can be read. */
function oldestEventDay(store: Store): string | null {
  try {
    const at = store.eventLogCensus().oldestAt;
    return typeof at === "number" && Number.isFinite(at) && at > 0 ? localDate(at, readingZone) : null;
  } catch {
    return null;
  }
}

/** The calendar day (the person's zone) the store's database file was born, or null when the
 *  filesystem keeps no birth time — zero, or a "birth" no earlier than the last
 *  change, which is what a filesystem without one may report instead. */
function databaseBirthDay(dir: string): string | null {
  try {
    const stat = statSync(paths.operational(dir));
    const born = stat.birthtimeMs;
    return Number.isFinite(born) && born > 0 && born < stat.ctimeMs ? localDate(born, readingZone) : null;
  } catch {
    return null;
  }
}

/**
 * The window to SAY, given the window that was read.
 *
 * Only ever moves the start FORWARD, and only into the range
 * `(windowStart, today]` — a first day at or before the window start changes
 * nothing, and one after today is a clock nobody should trust (it is also what
 * every synthetic test store looks like: rows written now, graded against a
 * `today` in the past).
 *
 * The READING is untouched: the counts are still taken over the full window, so
 * no grade and no number moves. This decides one string.
 */
function windowShown(windowStart: string, today: string, firstDay: string | null): string {
  if (firstDay === null) return windowStart;
  return firstDay > windowStart && firstDay <= today ? firstDay : windowStart;
}

/** `2026-09-15→2026-09-21`, or `since 2026-09-21` for a store one day old. */
function windowPhrase(shown: string, today: string): string {
  return shown === today ? `since ${today}` : `${shown}→${today}`;
}

/** `YYYY-MM-DD`, `back` days before `today` — label arithmetic (`time.ts`). */
function daysBefore(today: string, back: number): string {
  return isDay(today) ? addDays(today, -back) : today;
}

/** Every row of one name whose CALENDAR date is on or after `from`. */
function rowsInWindow(
  store: Store,
  name: string,
  livedDay: number,
  from: string,
): { rows: EventRow[]; truncated: boolean } {
  const all = store.eventLog({
    name,
    sinceDay: Math.max(0, livedDay - AUTHORSHIP_DAYS),
    order: "desc",
    limit: AUTHORSHIP_LIMIT,
  });
  return {
    rows: all.filter((r) => {
      const date = rowDate(r);
      return date !== null && date >= from;
    }),
    // Read newest first, so a full read is missing the window's OLDEST rows
    // rather than today's. The counts are still a floor and the line says so;
    // a confident wrong number is the one thing a diagnostic may never produce.
    truncated: all.length >= AUTHORSHIP_LIMIT,
  };
}

function authorshipFindings(input: DoctorInput, store: Store, owedReading: OwedSource): Finding[] {
  const livedDay = store.livedDay();
  // Inclusive of today: seven calendar days means today and the six before it.
  const from = daysBefore(input.today, AUTHORSHIP_DAYS - 1);
  const asks = rowsInWindow(store, ADAPTER_ASK_EVENT, livedDay, from);
  const deposits = rowsInWindow(store, GATE_DEPOSIT_EVENT, livedDay, from);
  let asked = 0;
  let capped = 0;
  let cappedBySession = 0;
  let cappedByDay = 0;
  let paced = 0;
  let unlabelled = 0;
  for (const row of asks.rows) {
    const payload = payloadOf(row);
    switch (str(payload, "outcome")) {
      case "asked":
        asked += 1;
        break;
      case "capped": {
        capped += 1;
        const reason = str(payload, "reason");
        if (reason === SESSION_ASK_CAP) cappedBySession += 1;
        else if (reason === DAY_CHAPTER_CAP) cappedByDay += 1;
        break;
      }
      case "paced":
        paced += 1;
        break;
      default:
        // Rows from before the single pacer carry no `outcome` at all. Counted
        // apart rather than folded into one of the three, and named only when
        // there are any — a bucket that is always zero is noise.
        unlabelled += 1;
    }
  }
  const authored = store.countMemories({
    type: "memory",
    archived: false,
    source: "authored",
    learnedOnFrom: from,
  });
  const fallback = store.countMemories({
    type: "memory",
    archived: false,
    source: "fallback",
    learnedOnFrom: from,
  });
  // WHAT THE LINE SAYS IT LOOKED AT (finding 8). The window READ is still the
  // full seven days — every count above and below is taken over `from` — and
  // this is the one string that changes: on a store younger than the window,
  // claiming a week it did not exist for is the diagnostic telling its reader
  // something that is not so.
  const shown = windowShown(from, input.today, storeFirstDay(store));
  // "of that week" is part of the same claim, and has to go with it.
  const span = shown === from ? "of that week" : "in that time";
  const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;
  const owed = owedReading();
  const read = owed !== null && owed !== "failed" ? owed : null;
  const owedPhrase =
    owed === null
      ? ""
      : owed === "failed"
        ? "; sessions awaiting a write-up: unknown (could not be read)"
        : owed.waiting === 0
          ? ""
          : `; ${plural(owed.waiting, "session", "sessions")} awaiting a write-up` +
            (owed.stale === 0 ? "" : `, ${String(owed.stale)} from yesterday or earlier`);
  const detail =
    `${windowPhrase(shown, input.today)}: invited to write ${plural(asked, "time", "times")}, ` +
    `${plural(paced, "Stop", "Stops")} paced out, ${String(capped)} over the day's allowance` +
    `${unlabelled === 0 ? "" : ` (${String(unlabelled)} older rows name no outcome)`}; ` +
    `${plural(deposits.rows.length, "deposit", "deposits")}; ` +
    `${String(authored)} live ${authored === 1 ? "memory" : "memories"} ${span} ${authored === 1 ? "is" : "are"} its own, ` +
    `${String(fallback)} the fallback sweep's` +
    owedPhrase +
    `${asks.truncated || deposits.truncated ? " (counts are a floor: the event read hit its limit)" : ""}`;
  const data = {
    from,
    // The window the SENTENCE names, beside the one the counts were taken over.
    shownFrom: shown,
    to: input.today,
    asked,
    capped,
    cappedBySession,
    cappedByDay,
    paced,
    unlabelled,
    deposits: deposits.rows.length,
    authored,
    fallback,
    // Null when the owed sessions were not read (the session-start reading)
    // or could not be.
    owedWaiting: read?.waiting ?? null,
    owedStale: read?.stale ?? null,
    truncated: asks.truncated || deposits.truncated,
    livedDay,
  };
  // Green, always: a session waiting too long for its write-up is the one
  // loss this line could name, and the Write-ups line already turns amber on
  // it — one loss, one amber line.
  return [finding("authorship", "green", "Authorship", detail, "", data)];
}

/**
 * WHAT FIRED — the roll-call of mechanisms, read from the rows that exist today.
 *
 * Constitution 11: done means seen firing, not merged, and the system itself
 * shows what fired and what did not. Several mechanisms merged in September ran
 * zero times on the live store and nothing said so; this is the line that would
 * have said it.
 *
 * AMBER on one comparison and never red in this first version: a mechanism that
 * fired in the PREVIOUS seven days and not once in this one. That is the only
 * signal here that says something CHANGED — a count of never-fired mechanisms is
 * a standing fact about the build, and ambering on it every morning would train
 * its reader to ignore the line that matters.
 *
 * NOT EVERY SILENCE IS ONE (2026-10-09). A one-time job that ran is `done` and
 * an occasion-driven one whose occasion has not come is `waiting`
 * (`fired.ts#Cadence`); neither can go quiet, so neither turns this line amber —
 * the owner's store went amber on a plain reminder that had not fallen due and
 * on the v8 census, which runs once. The `never` count never fed the colour,
 * only the words, and the owner-action and failure rows have left it for
 * `waiting`. The one occasion the store can SEE — a plain reminder due on a day
 * a session ran — is graded instead: due and not said is amber.
 *
 * THE SESSION-START READING DOES NOT TAKE IT. This is the only group here whose
 * SQL is not bounded by a lived day — the roll-call is a question about the
 * whole log, and the five table probes cost a query per memory on top — and a
 * hook that paid for it would have made the cure worse than the disease. The
 * between-groups budget check cannot help: a group that starts inside the budget
 * then runs as long as it likes. And it would buy nothing there, because the
 * notice carries reds only and this finding is never red. So the budgeted
 * reading says where the answer lives instead of half-reading it.
 */
function firedFindings(input: DoctorInput, store: Store): Finding[] {
  if (input.budgetMs !== undefined) {
    return [
      finding(
        "fired",
        "green",
        "Fired",
        "the roll-call of mechanisms is not read at session start: it walks the whole event log, " +
          "and a hook is not the place to pay for that",
        "",
        { read: false },
      ),
    ];
  }
  const report = firedReport(store, input.today);
  const c = report.counts;
  const blocked =
    c.blocked === 0
      ? ""
      : `, ${String(c.blocked)} ${c.blocked === 1 ? "was" : "were"} stopped by something that said so`;
  // The same clamp the Authorship line takes (finding 8), through the same
  // helper and with the same guard. `report.from` — what was READ, and what the
  // `fired` command's own header prints — is untouched; this is the wording.
  const shown = windowShown(report.from, report.today, storeFirstDay(store));
  const roll =
    `${windowPhrase(shown, report.today)}: ${String(c.firing)} of ${String(report.rows.length)} mechanisms fired ` +
    `${shown === report.from ? "this week" : "in that time"}${blocked}, ` +
    `${String(c.quiet)} ${c.quiet === 1 ? "has" : "have"} gone quiet, ` +
    `${String(c.never)} ${c.never === 1 ? "has" : "have"} never fired, ` +
    `${String(c.waiting)} ${c.waiting === 1 ? "is" : "are"} waiting for an occasion (an owner's action, a failure, a reminder falling due), ` +
    `${String(c.done)} one-time ${c.done === 1 ? "job is" : "jobs are"} done, ` +
    `${String(c.new)} ${c.new === 1 ? "is" : "are"} too new to grade, ` +
    `${String(c.blind)} ${c.blind === 1 ? "records" : "record"} nothing durable at all` +
    `${c.disabled + c.retired === 0 ? "" : ` (${String(c.disabled)} stood down, ${String(c.retired)} retired)`}` +
    `${report.notRead.length === 0 ? "" : `; ${String(report.notRead.length)} whose evidence is a table were not read on this pass`}` +
    `${report.truncated ? "; counts are a floor — the event read hit its limit" : ""}`;
  const data: Record<string, string | number | boolean | null> = {
    from: report.from,
    to: report.today,
    firing: c.firing,
    blocked: c.blocked,
    quiet: c.quiet,
    never: c.never,
    new: c.new,
    waiting: c.waiting,
    done: c.done,
    blind: c.blind,
    disabled: c.disabled,
    retired: c.retired,
    notRead: report.notRead.join(","),
    truncated: report.truncated,
    wentQuiet: report.wentQuiet.join("; "),
    wentBlocked: report.wentBlocked.join("; "),
    missedOccasion: report.missedOccasion.join("; "),
    young: report.young,
    livedDay: report.livedDay,
  };
  // TOO NEW TO GRADE (2026-09-20, finding 2). On a store younger than a lived
  // day or two, "28 have never fired" is a true sentence that reads like a
  // broken install — nothing has fired because nothing has happened yet. One
  // line saying so is more use than the roll-call, and the roll-call comes back
  // on its own. GREEN, because there is nothing here to fix.
  if (report.young) {
    return [
      finding(
        "fired",
        "green",
        "Fired",
        `this store is on lived day ${String(report.livedDay)} — too new to grade; nothing has fired ` +
          `because nothing has happened yet` +
          (c.blocked === 0 ? "" : `, though ${String(c.blocked)} was already stopped by something`),
        c.blocked === 0 ? "" : "Run: counterparts mechanisms --all — the blocked rows say by what.",
        data,
      ),
    ];
  }
  // GRADED ON BOTH LISTS. `blocked` outranks `quiet` in the state machine, so a
  // mechanism that fired last week and was turned away every day this week
  // leaves `wentQuiet` — and without `wentBlocked` this finding would have gone
  // GREEN for it. A state that says MORE must never make a diagnostic read
  // safer than it did before that state existed.
  if (report.wentQuiet.length === 0 && report.wentBlocked.length === 0 && report.missedOccasion.length === 0) {
    return [
      finding(
        "fired",
        "green",
        "Fired",
        `${roll}. Nothing that fired last week has fallen silent this week.`,
        "",
        data,
      ),
    ];
  }
  const changed = [
    report.wentBlocked.length === 0
      ? ""
      : `Fired last week and STOPPED this week: ${report.wentBlocked.join("; ")}`,
    report.missedOccasion.length === 0
      ? ""
      : `Its occasion came this week and it did not fire: ${report.missedOccasion.join("; ")}`,
    report.wentQuiet.length === 0
      ? ""
      : `Fired last week and not once this week: ${report.wentQuiet.join("; ")}`,
  ].filter((s) => s.length > 0);
  return [
    finding(
      "fired",
      "amber",
      "Fired",
      `${roll}. ${changed.join(". ")}`,
      report.wentBlocked.length > 0
        ? `Run: counterparts mechanisms --all — ${STATE_MEANING.blocked}, and the reason on the row names what to fix.`
        : report.missedOccasion.length > 0
          ? "Run: counterparts mechanisms --all — the row says what was due and not said; its occasion came, so this silence is the mechanism failing, not resting."
          : `Run: counterparts mechanisms --all — ${STATE_MEANING.quiet}, which is a wiring fault more often than a verdict.`,
      data,
    ),
  ];
}

/** The spawn seam: the persisted counters and the rows they explain. */
function spawnFindings(input: DoctorInput, store: Store): Finding[] {
  const livedDay = store.livedDay();
  const entries = Object.entries(input.refusals).filter(([, n]) => n > 0);
  entries.sort((a, b) => b[1] - a[1]);
  const worst = entries[0];
  // The COUNTERS decide this finding; these three rows only explain it. An
  // unreadable newest row says so in the clause rather than being dropped, which
  // would read as "there is no such row".
  const clause = (name: string): string | null => {
    const read = newestRows(store, name, 1, livedDay);
    if (read.unknown) return undetermined(name);
    const row = read.rows[0];
    return row === undefined ? null : `newest ${name} ${rowDate(row) ?? "?"} (${str(payloadOf(row), "reason") ?? "?"})`;
  };
  const rowClause = [clause(SPAWN_REFUSED_EVENT), clause(SPAWN_FAILED_EVENT), clause(RUNNER_FAILED_EVENT)]
    .filter((s): s is string => s !== null)
    .join("; ");
  const counts = entries.map(([reason, n]) => `${reason} ×${n}`).join(", ");
  // HOW MANY TIMES IT DID START TODAY. `adapter.spawn.started` is latched one
  // row per calendar date, so the row proves the door opened and this counter
  // is the only thing that says how often — which is why the row deliberately
  // carries no tally of its own (it would read `1` forever).
  const starts =
    input.starts !== undefined && input.starts.date === input.today && input.starts.count > 0
      ? input.starts.count
      : null;
  const startClause =
    starts === null ? "" : `; started ${String(starts)} ${starts === 1 ? "time" : "times"} today`;
  const data: Record<string, string | number | boolean | null> = {
    counters: counts,
    escalateAfter: TUNABLES.ESCALATE_AFTER,
    worstReason: worst?.[0] ?? null,
    worstCount: worst?.[1] ?? 0,
  };
  if (worst !== undefined && worst[1] >= TUNABLES.ESCALATE_AFTER) {
    return [
      finding(
        "spawn",
        "red",
        "Spawn",
        `the background worker has been refused ${worst[1]} times in a row (${worst[0]})${rowClause === "" ? "" : ` — ${rowClause}`}`,
        "Read the newest adapter.spawn.refused row; its reason names the door.",
        data,
      ),
    ];
  }
  if (entries.length > 0) {
    return [
      finding("spawn", "amber", "Spawn", `spawn refusals standing: ${counts}${rowClause === "" ? "" : ` — ${rowClause}`}`, "A spawn that starts clears every counter.", data),
    ];
  }
  // STARTED, THEN FAILED (2026-10-02, the "nobody saw it" review). The
  // counters clear on a start, so a worker that starts every boundary and then
  // throws — the wake not refreshed, the session-end pass not run — read green
  // here with its failure only named in passing. STANDING (review of #315: one
  // transient SQLITE_BUSY must not hold it amber for two days) means either
  // the same step failed on both today and yesterday, or the newest failure is
  // newer than the newest recorded start. Both rows are latched once a
  // calendar date (a step's failure, and the first start; "newer" is the
  // log's own order, `seq`), so the second reads
  // "it failed after today's first start" and clears at the next day's first
  // start unless the step fails again. Older is history, named in the clause.
  // THE LAST THREE LIVED DAYS, read as one window (2026-10-02): `newestRows`
  // stops at the first window with rows — today's — so yesterday's failure was
  // never read and "the same step, today and yesterday" could not fire on a
  // store whose days had moved. Newest first under the ceiling, then oldest
  // first, so the last row is the newest.
  let failures: EventRow[] = [];
  try {
    failures = store
      .eventLog({ name: RUNNER_FAILED_EVENT, sinceDay: Math.max(0, livedDay - 2), order: "desc", limit: RUNNER_FAILED_ROWS })
      .reverse();
  } catch {
    failures = [];
  }
  const failed = failures[failures.length - 1];
  const failedOn = rowDate(failed);
  const started = newestRows(store, SPAWN_STARTED_EVENT, 1, livedDay).rows[0];
  const yesterday = addDays(input.today, -1);
  const stepOn = (step: string | null, date: string): boolean =>
    failures.some((r) => str(payloadOf(r), "step") === step && rowDate(r) === date);
  const repeated = failed !== undefined && stepOn(str(payloadOf(failed), "step"), input.today) && stepOn(str(payloadOf(failed), "step"), yesterday);
  const sinceStart = failed !== undefined && (failedOn === input.today || failedOn === yesterday) && (started === undefined || failed.seq > started.seq);
  if (failed !== undefined && failedOn !== null && (repeated || sinceStart)) {
    const fp = payloadOf(failed);
    return [
      finding(
        "spawn",
        "amber",
        "Spawn",
        `the background worker started${startClause === "" ? "" : ` (${startClause.slice(2)})`} but failed at its ${str(fp, "step") ?? "?"} step on ${failedOn} (${str(fp, "code") ?? "?"})${rowClause === "" ? "" : ` — ${rowClause}`}`,
        "Nothing to do by hand: the next boundary runs the worker again. If it repeats, the process log (the Log line) has the error.",
        { ...data, startsToday: starts, failedStep: str(fp, "step"), failedOn },
      ),
    ];
  }
  return [
    finding(
      "spawn",
      "green",
      "Spawn",
      `no spawn refusals standing${startClause}${rowClause === "" ? "" : ` (${rowClause})`}`,
      "",
      { ...data, startsToday: starts },
    ),
  ];
}

/**
 * WHICH CODE IS LIVE. The hooks and the MCP server run whatever the install
 * tree has checked out, so an unmerged branch sitting in it is not a development
 * state — it is the memory layer the owner is using today.
 */
function checkoutFindings(reading: CheckoutReading): Finding[] {
  const data: Record<string, string | number | boolean | null> = {
    reason: reading.reason,
    root: reading.root,
    branch: reading.branch,
    head: reading.head,
    dirty: reading.dirty,
    behindBy: reading.behindBy,
    originMaster: reading.originMaster,
    atMaster: reading.atMaster,
    timedOut: reading.timedOut,
  };
  if (reading.reason === "not-a-repo") {
    return [finding("checkout", "green", "Checkout", "not a git checkout — an installed package, nothing to grade", "", data)];
  }
  if (reading.reason === "unreadable") {
    return [
      finding(
        "checkout",
        "green",
        "Checkout",
        reading.timedOut
          ? `${reading.root} — git did not answer within ${CHECKOUT_BUDGET_MS} ms, so the checkout was not graded`
          : reading.head === null
            ? `${reading.root} — git did not answer, so the checkout was not graded`
            : `${reading.root} — no ${ORIGIN_MASTER} as last fetched, so there is nothing to grade against`,
        "",
        data,
      ),
    ];
  }
  const where = `${reading.branch ?? "detached"}@${reading.head ?? "?"}`;
  if (reading.reason === "master") {
    return [
      finding("checkout", "green", "Checkout", `${reading.root} at origin/master (${where}), clean`, "", data),
    ];
  }
  if (reading.reason === "behind") {
    // AMBER, and deliberately not red: what runs is old, but it is merged code.
    // A merge to origin/master does not deploy — this tree has to move.
    return [
      finding(
        "checkout",
        "amber",
        "Checkout",
        `${where} is behind origin/master by ${String(reading.behindBy ?? 0)} commit${reading.behindBy === 1 ? "" : "s"} as last fetched — master moved and this checkout did not`,
        `Move the checkout: git -C ${reading.root} pull --ff-only (the hooks run what is in that tree, not what is on the remote).`,
        data,
      ),
    ];
  }
  const what =
    reading.reason === "dirty"
      ? `the live hooks are running a modified checkout: ${where}, ${reading.dirty} tracked file${reading.dirty === 1 ? "" : "s"} modified`
      : `the live hooks are running an unmerged checkout: ${where}, which is not an ancestor of origin/master`;
  return [
    finding(
      "checkout",
      "red",
      "Checkout",
      what,
      `Return ${reading.root} to origin/master (git -C ${reading.root} checkout master) — what is in that tree is live on the owner's memory.`,
      data,
    ),
  ];
}

/**
 * THE OPEN ITSELF — red when a session's own read path would throw here.
 *
 * The wording is the hook's: one code and one clause of plain words, so the red
 * line in the terminal and this line say the same thing about the same morning.
 */
/**
 * A rollback's hold (`store/rollback-hold.ts`), in one line, whenever one is
 * there. While it holds, it is also why the store will not open, so the Store
 * open line steps aside for it (`openFindings`).
 */
export function rollbackFindings(dir: string): Finding[] {
  const hold = readRollbackHold(dir);
  if (hold === null) return [];
  const release = `counterparts rollback --dir ${dir} --upgrade-again`;
  // Stopped halfway: the newer store is set aside and the copy never went in.
  // Red, and the older version must not come first — it has no hold to read
  // and would start a blank store here.
  if (rollbackHalfway(dir)) {
    return [
      finding(
        "rollback",
        "red",
        "Rollback",
        `a rollback stopped before its copy went in: there is no database in ${tilde(dir)}` +
          (hold === "unreadable" ? "" : `; the newer store is whole in ${tilde(hold.aside)}`),
        `Run: counterparts rollback --dir ${dir} --undo (it puts the newer store back as it was), then roll back again if you still mean to. Don't install the older version first: it would start a blank store here.`,
        { dir, holds: true, halfway: true },
      ),
    ];
  }
  if (hold === "unreadable") {
    return [
      finding(
        "rollback",
        "amber",
        "Rollback",
        `${tilde(dir)} carries a rollback hold that cannot be read; this version leaves the store alone while it is behind`,
        `Run: counterparts rollback --dir ${dir} --undo, or ${release}`,
        { dir, holds: true },
      ),
    ];
  }
  const day = localDate(hold.at);
  const holds = rollbackHeld(dir) !== null;
  return [
    holds
      ? finding(
          "rollback",
          "amber",
          "Rollback",
          `rolled back from v${hold.from} to v${hold.to} on ${day} (from ${hold.snapshot}); this version neither upgrades nor reads it, so sessions on it stand down. The newer store is in ${tilde(hold.aside)}`,
          `Install the version you went back to, then: counterparts connect && counterparts doctor. Or, to stay on this one: ${release} (upgrades it again; what was written since the rollback is kept) or counterparts rollback --dir ${dir} --undo (the newer store comes back).`,
          { dir, holds: true, from: hold.from, to: hold.to, snapshot: hold.snapshot, aside: hold.aside },
        )
      : finding(
          "rollback",
          "amber",
          "Rollback",
          `a rollback hold from ${day} is here, but the store is on this version's schema, so it holds nothing`,
          `Run: ${release} to remove it.`,
          { dir, holds: false, from: hold.from, to: hold.to },
        ),
  ];
}

/** A rollback's hold over a store with no database: it stopped before its copy went in. */
function rollbackHalfway(dir: string): boolean {
  return readRollbackHold(dir) !== null && !existsSync(join(dir, DATABASE_FILE));
}

/** The Memory line for that store: it is not "no store", and `install` is not the fix. */
function halfwayMemoryFinding(dir: string): Finding {
  return finding("store", "red", MEMORY_TITLE, `no database at ${tilde(dir)}: a rollback stopped halfway (see Rollback)`, "", {
    dir,
    exists: false,
    rolledBack: true,
  });
}

function openFindings(reading: OpenReading): Finding[] {
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
function journalFindings(store: Store): Finding[] {
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

function vectorFindings(input: DoctorInput, store: Store): Finding[] {
  // NOTHING TO EMBED, NOTHING TO SAY (finding #24). With the embedder off every
  // live memory has no vector, so this line reported the whole store as a
  // shortfall — an amber that cannot be cleared except by buying a key, beside
  // an `OFF` line that has already said the feature is not on. The coverage of
  // a channel nobody switched on is not a reading anybody needs; the moment it
  // IS on, the line comes back and counts.
  if (input.config.embedder?.enabled !== true) return [];
  const unembedded = store.unembeddedCount();
  const skipped = store.skippedVectorIds().length;
  const detail = `${unembedded} live memories with no vector, ${skipped} skipped after repeated embed failures`;
  const data = { unembedded, skipped };
  // WITHDRAWN: the count cannot fall, so the line must not say it will
  // (review of #190, MAJOR 4). The Recall by meaning line names the way out.
  const verdict = store.embedderVerdict.kind;
  // AN EMBEDDER THAT COULD NOT BE BUILT is the same case (re-review MINOR C):
  // the count cannot fall while the weights are missing, so the line says
  // why instead of promising it will.
  const newest = newestBackfill(input);
  if (newest !== null && str(newest, "reason") === "embedder-unavailable") {
    const code = str(newest, "codes") ?? "NO_WEIGHTS";
    return [
      finding(
        "vectors",
        "amber",
        "Vectors",
        `${detail} — the embedder could not be built (${code}), so this will not fall until it can`,
        "Read the Recall by meaning line.",
        { ...data, unavailable: code },
      ),
    ];
  }
  if (verdict === "held" || verdict === "cache-ahead") {
    return [
      finding(
        "vectors",
        "amber",
        "Vectors",
        `${detail} — the vector channel is withdrawn (${verdict}), so this will not fall until that is resolved`,
        "Read the Recall by meaning line.",
        { ...data, withdrawn: verdict },
      ),
    ];
  }
  if (skipped > 0) {
    return [finding("vectors", "amber", "Vectors", detail, "counterparts verify --dir <store> --retry-skipped puts the skipped ids back in the rotation.", data)];
  }
  // NOT BUILT YET IS NOT A FAULT (2026-10-11): a brand-new install read amber
  // here before its first session, in words a new user cannot act on. Every
  // backfill run and every sweep writes its row, so a store with neither has
  // never had a boundary: the vectors are built at the end of the first
  // session. A store that has lived one and still has a shortfall keeps the
  // amber below.
  if (unembedded > 0 && !livedABoundary(store)) {
    const memories = unembedded === 1 ? "1 memory" : `${unembedded} memories`;
    return [finding("vectors", "green", "Vectors", `${memories} not searchable by meaning yet — this builds after your first session`, "", data)];
  }
  if (unembedded > 0) {
    return [finding("vectors", "amber", "Vectors", detail, "The backfill embeds up to 1,000 per boundary; this number must fall run over run.", data)];
  }
  return [finding("vectors", "green", "Vectors", detail, "", data)];
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

/**
 * THE PROCESS LOG (`adapters/log/`, 2026-09-30) — where it is, how many days it
 * holds, and how many failures it recorded today. Green whatever the count: the
 * failures are each some other line's to grade, and this one says where to read
 * them (`counterparts log`). Folds into `Background` like the other greens.
 */
export function logFindings(input: DoctorInput): Finding[] {
  const r = logReading(input.dir, input.today);
  const failures = `${String(r.failuresToday)} failure${r.failuresToday === 1 ? "" : "s"} today`;
  const detail =
    r.days === 0
      ? `${tilde(r.dir)} · nothing written yet`
      : `${tilde(r.dir)} · holds ${String(r.days)} day${r.days === 1 ? "" : "s"} (kept ${String(LOG_DAYS)}) · ${failures}`;
  return [
    finding("log", "green", "Log", detail, r.failuresToday > 0 ? "Read them: counterparts log" : "", {
      dir: r.dir,
      days: r.days,
      failuresToday: r.failuresToday,
      linesToday: r.linesToday,
    }),
  ];
}

/**
 * THE SELF PAGE (2026-09-18, S1) — one line: is there one, how big, how old.
 *
 * GREEN when absent, amber when stale, and never red. A store with no page has
 * not written one yet, which is the correct state of a fresh install and on the
 * first day after this ships — absence is a fact, not a fault, and a line that
 * nags from the moment it lands is a line people learn to read past (the same
 * rule `fired.ts` states for its `blind` rows). Staleness is the reading worth
 * an amber: a page that exists and has stopped being revised means something
 * that was running has stopped.
 *
 * The reading is two row reads and a date comparison, so it sits with the cheap
 * groups rather than with `fired`.
 */
/** The meta rows the v8 upgrade and its census write (`store/operational.ts`, `sleep/upgrade.ts`). */
const V8_UPGRADE_META = "physics.v8.upgrade";
const V8_CENSUS_META = "physics.v8.census";

function metaJson(store: Store, key: string): Record<string, unknown> | null {
  const raw = store.getMeta(key);
  if (raw === undefined) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function metaNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * DID THE v8 UPGRADE MOVE ANY MEMORY DOWN? (dreaming + consolidation,
 * 2026-09-26.) The migration marks every row it finds as keeping its old
 * consolidation path and records what it found; the first sleep after it
 * measures every memory by the old arithmetic and the new. Green when that
 * census says nothing changed band down, nothing got weaker and nothing prunes
 * sooner; amber while the census has not run yet; red if any memory moved
 * down — the one thing the upgrade promised not to do. A store born at v8 has
 * no upgrade record and gets no line.
 */
export function upgradeV8Findings(store: Store): Finding[] {
  const upgrade = metaJson(store, V8_UPGRADE_META);
  if (upgrade === null) return [];
  const census = metaJson(store, V8_CENSUS_META);
  const from = typeof upgrade["from"] === "string" ? upgrade["from"] : String(upgrade["from"] ?? "?");
  const rows = metaNum(upgrade["rows"]);
  const kept = metaNum(upgrade["consolidated"]);
  const data: Record<string, string | number | boolean | null> = {
    from,
    rows,
    consolidated: kept,
    identity: metaNum(upgrade["identity"]),
    censused: census !== null,
  };
  if (census === null) {
    return [
      finding(
        "upgrade-v8",
        "amber",
        "Upgrade",
        `upgraded from schema v${from} to v8 (${String(rows)} memories kept their old consolidation path); the old-versus-new check has not run yet`,
        "Nothing to do: the next sleep measures it. counterparts doctor then says whether anything moved.",
        data,
      ),
    ];
  }
  const checked = metaNum(census["checked"]);
  const down = metaNum(census["bandDown"]);
  const weaker = metaNum(census["weaker"]);
  const sooner = metaNum(census["pruneSooner"]);
  const up = metaNum(census["bandUp"]);
  const measured = {
    ...data,
    checked,
    bandDown: down,
    bandUp: up,
    weaker,
    pruneSooner: sooner,
    pruneLater: metaNum(census["pruneLater"]),
    legacyConsolidated: metaNum(census["consolidated"]),
    v7WouldPromote: metaNum(census["v7WouldPromote"]),
  };
  // By construction the three down counts read zero: they compare each row
  // with itself, returns set aside, and returns are zero at the upgrade (the
  // arithmetic for existing rows is unchanged). The branch stays as the alarm
  // if that ever stops being true. (Adversarial review of #251.)
  if (down + weaker + sooner > 0) {
    return [
      finding(
        "upgrade-v8",
        "red",
        "Upgrade",
        `the v8 upgrade moved memories down: of ${String(checked)} checked, ${String(down)} changed band down, ${String(weaker)} got weaker, ${String(sooner)} would be let go sooner`,
        "Keep this store as it is and report it: the upgrade promised no memory would move down. The copy taken before it is in the snapshots directory.",
        measured,
      ),
    ];
  }
  // WHAT THE SELF-COMPARISON CANNOT SEE (review of #251): rows the old rules
  // were about to make core. The decision (working default 2026-09-26): they
  // are let go under the new rule — only memories about me or about us become
  // core — and take the DURABILITY route instead: the upgrade credited their
  // reinforcement days as returns, so they fade as slowly as that history
  // earns. Said, green: it is the design, not a fault.
  const road = metaNum(census["v7WouldPromote"]);
  const credited = metaNum(upgrade["legacyReturns"]);
  const roadLine =
    road > 0
      ? `; ${String(road)} ${road === 1 ? "was" : "were"} on the old road to the core and ${road === 1 ? "takes" : "take"} the durability route now (only memories about me or about us become core)`
      : "";
  const creditLine = credited > 0 ? `; ${String(credited)} had their reinforcement days counted as returns` : "";
  return [
    finding(
      "upgrade-v8",
      "green",
      "Upgrade",
      `Upgrade to v8: ${String(checked)} memories checked by the old arithmetic and the new; none changed band, none weaker, none prunes sooner; ${String(metaNum(census["consolidated"]))} kept their old consolidation${up > 0 ? `; ${String(up)} moved up a band` : ""}${creditLine}${roadLine}`,
      "",
      measured,
    ),
  ];
}

/** The meta row the v9 upgrade writes (`store/operational.ts#V9_UPGRADE_KEY`). */
const V9_UPGRADE_META = "physics.v9.upgrade";

/**
 * WHAT THE v9 UPGRADE CARRIED (2026-09-27, reflection + core by meaning),
 * informational. The core's first question moved from a kind label to a mark
 * set by meaning; the upgrade carried the old rule onto the rows it found, so
 * the candidates did not change overnight — this line says so, and how many
 * marks have been set by meaning since. Silent on a store born at v9.
 */
export function upgradeV9Findings(store: Store): Finding[] {
  const upgrade = metaJson(store, V9_UPGRADE_META);
  if (upgrade === null) return [];
  const me = metaNum(upgrade["markedMe"]);
  const owner = metaNum(upgrade["markedOwner"]);
  const candidates = metaNum(upgrade["candidates"]);
  let since = 0;
  let work = 0;
  let floor = false;
  try {
    const marks = store.coreEvents({ action: "about", limit: MARK_ROWS });
    // A FULL READ IS A FLOOR (2026-10-02), as the Reflection line's is.
    floor = marks.length >= MARK_ROWS;
    for (const e of marks) {
      since += 1;
      if ((e.reason ?? "").startsWith("work")) work += 1;
    }
  } catch {
    since = 0;
  }
  return [
    finding(
      "upgrade-v9",
      "green",
      "Upgrade",
      `Upgrade to v9: what a memory is about is now marked by meaning; the old rule was carried so nothing changed overnight — ${String(me)} self ${me === 1 ? "memory" : "memories"} marked about me, ${String(owner)} about the owner (${String(candidates)} core ${candidates === 1 ? "candidate" : "candidates"}); ${floor ? "at least " : ""}${String(since)} ${since === 1 ? "mark" : "marks"} set since (by the writer, a reflection, you or a session)${work > 0 ? `, ${floor ? "at least " : ""}${String(work)} of them "work" (out of the candidates)` : ""}${floor ? ` (only the newest ${String(MARK_ROWS)} were read)` : ""}`,
      "",
      { markedMe: me, markedOwner: owner, candidates, marksSince: since, work, marksFloor: floor },
    ),
  ];
}

/** The meta row the v10 upgrade writes (`store/operational.ts#V10_UPGRADE_KEY`). */
const V10_UPGRADE_META = "contradictions.v10.upgrade";

/**
 * WHAT THE v10 UPGRADE CARRIED (2026-09-29, contradictions), informational:
 * every dream flag that stood became an unsettled pair, raised and habituated
 * as it was. Silent on a store born at v10.
 */
export function upgradeV10Findings(store: Store): Finding[] {
  const upgrade = metaJson(store, V10_UPGRADE_META);
  if (upgrade === null) return [];
  const flags = metaNum(upgrade["flags"]);
  const pairs = metaNum(upgrade["pairs"]);
  const raised = metaNum(upgrade["raised"]);
  const standing = metaNum(upgrade["standing"]);
  return [
    finding(
      "upgrade-v10",
      "green",
      "Upgrade",
      `Upgrade to v10: a contradiction is a pair now, settled changed, corrected or open, with its record — ${String(flags)} dream ${flags === 1 ? "flag" : "flags"} carried as ${String(pairs)} unsettled ${pairs === 1 ? "pair" : "pairs"} (${String(raised)} already raised awake, ${String(standing)} with both memories still standing)`,
      "",
      { flags, pairs, raised, standing },
    ),
  ];
}

/** The meta row the v11 upgrade writes (`store/operational.ts#V11_UPGRADE_KEY`). */
const V11_UPGRADE_META = "feelings.v11.upgrade";

/**
 * WHAT THE v11 UPGRADE RE-FILED (2026-09-30, the feelings wheel v2),
 * informational: how many recorded feelings it read, how many it moved onto
 * the seven cores and from where to where. Each moved row keeps its old core
 * beside it. Silent on a store born at v11.
 */
export function upgradeV11Findings(store: Store): Finding[] {
  const upgrade = metaJson(store, V11_UPGRADE_META);
  if (upgrade === null) return [];
  const feelings = metaNum(upgrade["feelings"]);
  const refiled = metaNum(upgrade["refiled"]);
  const raw = upgrade["moves"];
  const moves: Record<string, number> = {};
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) moves[k] = metaNum(v);
  }
  const listed = Object.entries(moves)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, n]) => `${k} ${String(n)}`)
    .join(", ");
  return [
    finding(
      "upgrade-v11",
      "green",
      "Upgrade",
      `Upgrade to v11: feelings use seven cores now (happy, warm, calm, curious, sad, uneasy, angry) — ${String(refiled)} of ${String(feelings)} recorded ${feelings === 1 ? "feeling" : "feelings"} re-filed${listed.length > 0 ? ` (${listed})` : ""}, each keeping its old core beside it`,
      "",
      { feelings, refiled, moves: listed },
    ),
  ];
}

/** The meta row the v12 upgrade writes (`store/operational.ts#V12_UPGRADE_KEY`). */
const V12_UPGRADE_META = "recall.v12.upgrade";

/**
 * WRITE FIELDS (v12, 2026-10-03), informational, never amber or red: of the
 * memories written since the v12 upgrade by a door that takes the writer's
 * three fields — `note`, `session_end` (write-ups included) and a dream's
 * gist — how many say when it happened, who said it and what kind of thing
 * it is; and how many subject links there are. What the revisit a few days
 * after the upgrade reads, before recall reads the fields (Release B). A
 * store born at v12 counts every such memory; one upgraded counts from the
 * upgrade's moment. Silent on a file without the columns.
 */
export function writeFieldFindings(store: Store): Finding[] {
  let share: ReturnType<Store["writeFieldShare"]> = null;
  let links: ReturnType<Store["subjectLinkCount"]> = null;
  const upgrade = metaJson(store, V12_UPGRADE_META);
  const since = upgrade === null ? null : metaNum(upgrade["at"]) || null;
  try {
    share = store.writeFieldShare(since);
    links = store.subjectLinkCount();
  } catch {
    return [];
  }
  if (share === null) return [];
  const pct = (n: number): string => (share === null || share.written === 0 ? "0%" : `${String(Math.round((100 * n) / share.written))}%`);
  const when = since === null ? "" : ` since the v12 upgrade (${localDate(since, readingZone)})`;
  const linked =
    links === null
      ? ""
      : `; subject links: ${String(links.links)} on ${String(links.memories)} ${links.memories === 1 ? "memory" : "memories"}`;
  const detail =
    share.written === 0
      ? `no memory written${when} by remember, session_end or a dream gist yet${linked}`
      : `of ${String(share.written)} ${share.written === 1 ? "memory" : "memories"} written${when} by remember, session_end or a dream gist — when it happened ${pct(share.occurredOn)}, who said it ${pct(share.saidBy)}, what kind ${pct(share.status)}, all three ${pct(share.all)}${linked}`;
  return [
    finding("write-fields", "green", "Write fields", detail, "", {
      written: share.written,
      occurredOn: share.occurredOn,
      saidBy: share.saidBy,
      status: share.status,
      all: share.all,
      since: since ?? 0,
      links: links?.links ?? 0,
      linkedMemories: links?.memories ?? 0,
    }),
  ];
}

/**
 * THE OLD-CLAIMS ERA, informational, never amber or red (2026-10-10; decided
 * by Mike, 2026-10-10, loosely held): whether the curve reads old claims at
 * today's default, since when, and how many live memories that affects, read
 * lower and read higher (`Store#claimsEra`). Silent on a store with no cutoff ever recorded.
 */
export function claimsEraFindings(store: Store): Finding[] {
  let era: ReturnType<Store["claimsEra"]>;
  try {
    era = store.claimsEra();
  } catch {
    return [];
  }
  if (era.cutoff === null && era.recorded === null) return [];
  const n = (k: number): string => `${String(k)} ${k === 1 ? "memory" : "memories"}`;
  // Both ways since 2026-10-11: lower (an old claim, or an old default above
  // today's), higher (an old default below today's).
  const split = era.affected === 0 ? "" : ` (${String(era.down)} lower than stored, ${String(era.up)} higher)`;
  const detail =
    era.cutoff === null
      ? "off: every claim reads as stored (counterparts claims-era --on reads the old ones at today's default again)"
      : `on since ${localDate(era.cutoff, readingZone)}: ${n(era.affected)} written before it read at today's default for what ${era.affected === 1 ? "it is" : "they are"} about${split}; nothing rewritten (counterparts claims-era --off reads them as stored again; any let go meanwhile stay archived)`;
  return [
    finding("claims-era", "green", "Old claims", detail, "", {
      on: era.cutoff !== null,
      cutoff: era.cutoff,
      affected: era.affected,
      down: era.down,
      up: era.up,
    }),
  ];
}

/**
 * THE RECOGNITION LANE, informational (wheel v2, the review of #301): how
 * many memories nobody marked are on the core's fast lane only because I
 * recognised myself in them — a recognition feeling of mine, strong enough on
 * its own, felt in a session (`sleep/consolidate.ts#selfRelevantFeeling`).
 * Ids stay out; a count only. Silent at zero.
 */
export function recognitionLaneFindings(store: Store): Finding[] {
  let count = 0;
  try {
    const door = acceptsReflectedFeeling(store);
    const seen = new Set<string>();
    for (const f of store.feelingsLive()) {
      if (seen.has(f.memory_id) || !isSelfRelevantFeeling(f.emotion, f.other_word)) continue;
      seen.add(f.memory_id);
      const row = store.row(f.memory_id);
      if (row === undefined || row.promoted_identity === 1) continue;
      if (selfRelevantFeeling(store, row, door)) count += 1;
    }
  } catch {
    return [];
  }
  if (count === 0) return [];
  return [
    finding(
      "recognition-lane",
      "green",
      "Recognition",
      `${String(count)} unmarked ${count === 1 ? "memory is" : "memories are"} on the core's fast lane because I recognised myself in ${count === 1 ? "it" : "them"} (a mark would decide instead)`,
      "",
      { candidates: count },
    ),
  ];
}

/** The lived days the Contradictions line covers. */
export const CONTRADICTION_WINDOW_DAYS = 7;

/**
 * The Contradictions line's held part, plainly: "; 2 corrections held because
 * they didn't look related to the memory they named; if any were meant,
 * settle them with counterparts settle, which lists them". Empty when nothing
 * was held. Those settled by hand since are counted, and the pointer is only
 * for the ones still held — most are a wrong pointer caught, which needs nothing.
 */
export function heldLine(held: number, settledAfter: number): string {
  if (held <= 0) return "";
  const one = held === 1;
  const left = held - settledAfter;
  const head = `; ${String(held)} ${one ? "correction" : "corrections"} held because ${one ? "it" : "they"} didn't look related to the memory ${one ? "it" : "they"} named`;
  if (left <= 0) return `${head}, ${one ? "settled" : "all settled"} by hand since`;
  const since = settledAfter > 0 ? `, ${String(settledAfter)} settled by hand since` : "";
  const them = left === 1 ? "it" : "them";
  const was = left > 1 ? "any were" : one ? "it was" : held === 2 ? "the other was" : "the one left was";
  return `${head}${since}; if ${was} meant, settle ${them} with counterparts settle, which lists ${them}`;
}

/**
 * CONTRADICTIONS, informational (2026-09-29): over the last
 * `CONTRADICTION_WINDOW_DAYS` lived days, how many pairs were flagged, how
 * many settled and how (changed, corrected, open), how many undone, and who
 * settled them; and, standing now, how many are open and how many unsettled
 * (both memories still live). Read off `contradictions` and its trail — ids
 * and counts only.
 */
export function contradictionFindings(store: Store): Finding[] {
  let pairs: ReturnType<Store["contradictions"]>;
  let trail: ReturnType<Store["contradictionSettles"]>;
  let today: number;
  try {
    pairs = store.contradictions({ limit: 100_000 });
    trail = store.contradictionSettles({ limit: 100_000 });
    today = store.livedDay();
  } catch {
    return [];
  }
  const since = today - CONTRADICTION_WINDOW_DAYS + 1;
  const flagged = pairs.filter((p) => (p.source === "dream" || p.source === "pressure") && p.flagged_day >= since).length;
  const settles = trail.filter((s) => s.action === "settle" && s.day >= since);
  const kept = settles.filter((s) => s.undone === 0);
  const by = (list: readonly { how?: string | null; actor?: string }[], key: "how" | "actor"): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const x of list) {
      const k = String(x[key] ?? "?");
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const how = by(kept, "how");
  const who = by(kept, "actor");
  const undone = trail.filter((s) => s.action === "undo" && s.day >= since).length;
  const live = (id: string): boolean => {
    const r = store.row(id);
    return r !== undefined && r.archived === 0 && r.superseded_by === null && r.body !== "";
  };
  const open = pairs.filter((p) => p.state === "settled" && p.how === "open" && p.via === null).length;
  const unsettled = pairs.filter((p) => p.state === "unsettled" && live(p.a) && live(p.b)).length;
  const kinds = ["changed", "corrected", "open"].map((k) => `${String(how[k] ?? 0)} ${k}`).join(", ");
  const whoWords = Object.entries(who)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k === "owner" ? "you" : k} ${String(n)}`)
    .join(", ");
  // HELD CORRECTIONS (mcp INTERFACE-GAPS §12, closed 2026-10-09): a write that
  // said it changed or corrected a memory that looked unrelated was held, so
  // nothing was settled. Informational, like the rest of this line: a hold is
  // the guard working. Unreadable, the line goes on without it.
  let heldWords = "";
  let heldData: Record<string, number> = { held: 0, heldSettledAfter: 0, heldByMeaning: 0, heldByWords: 0 };
  try {
    const h = heldCorrections(store, { sinceDay: since });
    heldData = { held: h.held, heldSettledAfter: h.settledAfter, heldByMeaning: h.byMeaning, heldByWords: h.byWords };
    heldWords = heldLine(h.held, h.settledAfter);
  } catch {
    // An event log this cannot read: the held count is left out, not guessed.
  }
  return [
    finding(
      "contradictions",
      "green",
      "Contradictions",
      `last ${String(CONTRADICTION_WINDOW_DAYS)} lived days: ${String(flagged)} flagged, ${String(kept.length)} settled (${kinds})${kept.length > 0 ? ` by ${whoWords}` : ""}${undone > 0 ? `, ${String(undone)} undone` : ""}; standing: ${String(open)} open, ${String(unsettled)} unsettled${unsettled > 0 ? " (counterparts settle lists them)" : ""}${heldWords}`,
      "",
      {
        ...heldData,
        flagged,
        settled: kept.length,
        changed: how["changed"] ?? 0,
        corrected: how["corrected"] ?? 0,
        open: how["open"] ?? 0,
        undone,
        bySession: who["session"] ?? 0,
        byDream: who["dream"] ?? 0,
        byReflection: who["reflection"] ?? 0,
        byPageWriter: who["page-writer"] ?? 0,
        byOwner: who["owner"] ?? 0,
        standingOpen: open,
        standingUnsettled: unsettled,
      },
    ),
  ];
}

/** How many `band.promoted` rows the reflection finding reads, newest first. */
export const PROMOTED_ROWS = 5000;

/**
 * REFLECTION, informational (2026-09-27): when the waking self last
 * reflected, what it did, what became of the morning share; the week's
 * returns by source; and how many memories became core on reflection alone.
 * Never amber: a quiet week is not a fault.
 */
export function reflectionFindings(input: DoctorInput, store: Store): Finding[] {
  let last: ReturnType<Store["reflections"]>[number] | undefined;
  let returns: ReturnType<Store["returnCounts"]>;
  let alone = 0;
  // RE-LABELS BY A REFLECTION (owner ruling D2 on #256): every mark a
  // reflection changed, and apart, those that moved a memory INTO me, us or
  // the owner (a core candidate it was not before).
  let relabeled = 0;
  let movedIn = 0;
  // A promotion the fast lane made only on a feeling a reflection recorded
  // later — the half of "on reflection" the open door lets through (review
  // of #256, S4). Counted apart from `alone`; one memory can be both.
  let later = 0;
  // ...and one an ordinary session's feeling-now carried through the same
  // door (`feelingRecordedLaterBy` names `awake`, review of #317): said apart,
  // never credited to a reflection. A memory both could have carried is said
  // once, as both (review of #319).
  let laterAwake = 0;
  let laterBoth = 0;
  let promotionsUnread = false;
  let marksUnread = false;
  // Feelings recorded looking back while AWAKE (lane B, 2026-10-02): loose on purpose, so said.
  let awake = { total: 0, fast: 0, owner: 0 };
  try {
    awake = awakeFeelingCounts(store);
    last = store.reflections({ limit: 5 }).find((r) => r.state === "reflected");
    // THE PERSON'S WEEK, not the UTC one (2026-10-09): today and the six local
    // days before it, from local midnight in the reading's zone. It began at
    // UTC midnight, so in Denver a return from the evening before the week
    // counted and in Kiritimati the week's first fourteen hours did not.
    returns = store.returnCounts({ sinceAt: startOfLocalDay(addDays(input.today, -6), readingZone) });
    // Newest first with a named ceiling. The default read was the OLDEST 500
    // promotions, so the newest were the ones never counted; a read that comes
    // back full has not seen them all, and then the two counts are unknown
    // rather than a floor dressed as a total (as `newestRows` does).
    const promotions = store.eventLog({ name: "band.promoted", order: "desc", limit: PROMOTED_ROWS });
    promotionsUnread = promotions.length >= PROMOTED_ROWS;
    for (const row of promotions) {
      try {
        const p = JSON.parse(row.payload ?? "{}") as { reflectionOnly?: unknown; feelingRecordedLater?: unknown; feelingRecordedLaterBy?: unknown };
        if (p.reflectionOnly === true) alone += 1;
        const byReflection = laterFeelingWasReflections(p);
        const byAwake = laterFeelingWasAwake(p);
        if (byReflection && byAwake) laterBoth += 1;
        else if (byReflection) later += 1;
        else if (byAwake) laterAwake += 1;
      } catch {
        continue;
      }
    }
    // A FULL READ IS A FLOOR (2026-10-02), said as one, as the promotions are.
    const marks = store.coreEvents({ action: "about", limit: MARK_ROWS });
    marksUnread = marks.length >= MARK_ROWS;
    for (const e of marks) {
      if (e.actor !== "reflection") continue;
      const m = /^(\w+) \(was (\w+)\)/.exec(e.reason ?? "");
      if (m === null || m[1] === m[2]) continue;
      relabeled += 1;
      const core = (x: string | undefined): boolean => x === "me" || x === "us" || x === "owner";
      if (core(m[1]) && !core(m[2])) movedIn += 1;
    }
  } catch {
    return [];
  }
  const share: Record<string, string> = {
    none: "no share",
    offered: "its morning share not told yet",
    carried: "its morning share carried to a later session",
    told: "its morning share told",
  };
  // A SHARE STUCK AT `carried` (2026-10-02): `told` was never called, so the
  // line said "carried to a later session" forever. Now it says since when:
  // the day it was carried (`share_at`), else the reflection's own date.
  const carriedOn =
    last?.share_state !== "carried"
      ? null
      : typeof last.share_at === "number"
        ? localDate(last.share_at, readingZone)
        : (last.date ?? null);
  const carriedDays =
    carriedOn !== null && isDay(carriedOn) && isDay(input.today) ? Math.max(0, daysBetween(carriedOn, input.today)) : null;
  if (carriedDays !== null && carriedDays > 0) {
    share["carried"] = `its morning share carried to a later session ${String(carriedDays)} ${carriedDays === 1 ? "day" : "days"} ago and never told`;
  }
  const what =
    last === undefined
      ? "has not reflected yet"
      : `last reflected ${last.date ?? `lived day ${String(last.day)}`} (${last.dream_id === null ? "on its own" : "after a dream"}): ${
          last.entry_id === null ? "nothing much" : "an entry"
        }${last.page_version === null ? "" : ", the self page rewritten"}, ${share[last.share_state] ?? last.share_state}`;
  const byHow = `returns this week — awake ${String(returns.awake)}, reflection ${String(returns.reflection)}, dream ${String(returns.dream)}`;
  const aloneLine =
    (promotionsUnread
      ? `; how many became core on reflection alone is unknown: more than ${String(PROMOTED_ROWS)} promotions in the log, and only the newest ${String(PROMOTED_ROWS)} were read`
      : "") +
    (!promotionsUnread && alone > 0 ? `; ${String(alone)} ${alone === 1 ? "memory" : "memories"} became core on reflection alone` : "") +
    (!promotionsUnread && later > 0 ? `; ${String(later)} ${later === 1 ? "memory" : "memories"} became core on a feeling a reflection recorded later` : "") +
    (!promotionsUnread && laterAwake > 0
      ? `; ${String(laterAwake)} ${laterAwake === 1 ? "memory" : "memories"} became core on a feeling recorded looking back in a session`
      : "") +
    (!promotionsUnread && laterBoth > 0
      ? `; ${String(laterBoth)} ${laterBoth === 1 ? "memory" : "memories"} became core on a feeling recorded later, both a reflection's and a session's`
      : "") +
    (relabeled > 0
      ? `; ${marksUnread ? "at least " : ""}${String(relabeled)} ${relabeled === 1 ? "mark" : "marks"} changed by a reflection, ${String(movedIn)} of them into me, us or the owner${marksUnread ? ` (only the newest ${String(MARK_ROWS)} mark changes were read)` : ""}`
      : "") +
    // A lifetime count beside the week's returns, so it says "in all" (review of #317).
    (awake.total > 0
      ? `; in all, ${String(awake.total)} ${awake.total === 1 ? "feeling" : "feelings"} recorded looking back in a session, ${String(awake.fast)} at the core's fast-lane strength, ${String(awake.owner)} the owner's`
      : "");
  return [
    finding(
      "reflection",
      "green",
      "Reflection",
      `${what}; ${byHow}${aloneLine}`,
      "",
      {
        last: last?.date ?? null,
        reflection: last?.id ?? null,
        page: last?.page_version !== null && last?.page_version !== undefined,
        share: last?.share_state ?? null,
        carriedDays,
        returnsAwake: returns.awake,
        returnsReflection: returns.reflection,
        returnsDream: returns.dream,
        promotedOnReflectionAlone: promotionsUnread ? null : alone,
        promotedOnFeelingRecordedLater: promotionsUnread ? null : later,
        promotedOnAwakeFeeling: promotionsUnread ? null : laterAwake,
        promotedOnBothLaterFeelings: promotionsUnread ? null : laterBoth,
        relabeledByReflection: relabeled,
        relabeledIntoCore: movedIn,
        relabeledFloor: marksUnread,
        awakeFeelings: awake.total,
        awakeFeelingsFast: awake.fast,
        awakeFeelingsOwner: awake.owner,
      },
    ),
  ];
}

/** Mark changes the Reflection line reads, newest first; a read that comes back full is a floor. */
const MARK_ROWS = 10_000;

/** The newest `adapter.runner.failed` rows the Spawn line reads (one per step per date). */
const RUNNER_FAILED_ROWS = 20;

/** How many dreams the Dreaming line reads, newest first, to find the last one that stands. */
const DREAM_ROWS = 200;

/** How far back the lookup count reads, in lived days. */
const LOOKUP_WINDOW_DAYS = 14;

/**
 * THE LOOKUP, MEASURED (2026-09-28, build B). A dream's and a reflection's
 * bundles show most memories as a line or an excerpt and name the lookup (the
 * recall tool, by id). This counts, over the last two weeks of lived days,
 * what each offered only in part and how many of those a receiver fetched
 * whole — each id counted once per run's index (`fit/noteLookups`), from
 * what the recall result delivered, so the rows' counts sum to distinct ids
 * looked up. If it stays near none, the lines are too thin or the instruction is
 * unclear — the check against "we just truncated again". Informational:
 * green, with the numbers.
 */
export function lookupFindings(store: Store): Finding[] {
  const since = Math.max(0, store.livedDay() - LOOKUP_WINDOW_DAYS);
  const offered = { dream: 0, reflection: 0 };
  const runs = { dream: 0, reflection: 0 };
  const looked = { dream: 0, reflection: 0 };
  let unread = false;
  try {
    const begun = store.eventLog({ name: "dream.begun", sinceDay: since, order: "desc", limit: LOOKUP_ROWS });
    const recalls = store.eventLog({ name: "mcp.recall", sinceDay: since, order: "desc", limit: LOOKUP_ROWS });
    unread = begun.length >= LOOKUP_ROWS || recalls.length >= LOOKUP_ROWS;
    for (const row of begun) {
      const n = num(payloadOf(row), "offered");
      if (n === null) continue;
      runs.dream += 1;
      offered.dream += n;
    }
    for (const r of store.reflections({ limit: 60 })) {
      if (r.day < since) continue;
      try {
        const fit = (JSON.parse(r.detail) as { fit?: { offered?: unknown } }).fit;
        if (typeof fit?.offered !== "number") continue;
        runs.reflection += 1;
        offered.reflection += fit.offered;
      } catch {
        continue;
      }
    }
    for (const row of recalls) {
      const from = payloadOf(row)["fromIndex"];
      if (from === null || typeof from !== "object") continue;
      for (const m of ["dream", "reflection"] as const) {
        const v = (from as Record<string, unknown>)[m];
        if (typeof v === "number") looked[m] += v;
      }
    }
  } catch {
    return [];
  }
  const say = (m: "dream" | "reflection", runWord: string): string =>
    runs[m] === 0
      ? `${m}: no ${runWord} measured yet`
      : `${m}: ${String(looked[m])} looked up of ${String(offered[m])} offered in part, over ${String(runs[m])} ${runWord}${runs[m] === 1 ? "" : "s"}`;
  const none = runs.dream + runs.reflection > 0 && offered.dream + offered.reflection > 0 && looked.dream + looked.reflection === 0;
  return [
    finding(
      "lookups",
      "green",
      "Lookups",
      `last ${String(LOOKUP_WINDOW_DAYS)} lived days — ${say("dream", "night")}; ${say("reflection", "reflection")}` +
        (none ? ". None looked up yet: if that holds, the lines may be too thin or the lookup unclear" : "") +
        (unread ? ". More rows than were read: the counts are a floor" : ""),
      "",
      {
        dreamOffered: offered.dream,
        dreamLooked: looked.dream,
        dreamNights: runs.dream,
        reflectionOffered: offered.reflection,
        reflectionLooked: looked.reflection,
        reflections: runs.reflection,
        floor: unread,
      },
    ),
  ];
}

/** Rows each lookup read takes, newest first; a read that comes back full is a floor. */
const LOOKUP_ROWS = 2_000;

/** How far back the Wake line reads, in lived days. */
const WAKE_WINDOW_DAYS = 7;

/**
 * DID THE WAKE ARRIVE (2026-10-02, the "nobody saw it" review). At each
 * session's first prompt (or, since 2026-10-08, its first Stop when the host
 * had not yet written the file) the hook reads the transcript for the wake's tail
 * mark and writes one `adapter.wake.delivered` row with the outcome
 * (`hooks.ts#wakeOutcome`) — and until now no line read it: a wake the host
 * cut short, or that arrived as something else, was green everywhere, along
 * with the write-up and handoff pointers that ride at its end. AMBER on any
 * `truncated` in the window. `mismatch` is counted, not graded (review of
 * #315): a session resumed after its record was pruned finds the earlier
 * wake's mark, which is not a cut. `printed-unverified` (a host build that
 * does not record what it injected) and `not-found` are counted too. Silent
 * with no rows.
 *
 * AND WHAT THE WAKE COULD NOT CARRY (2026-10-02, the gaps #315 listed), as
 * clauses on the same line: a hook past the host's 10,000-character cap
 * (AMBER: the host previewed it), and, counted only, a session start over the
 * reported ceiling (the clock, Code-tab and reminder lines ride above the
 * composed wake unreserved, so a full wake does it daily — review of #318), a
 * notice dropped to keep the envelope under the cap, parts that waited for room (`adapter.envelope.gave-way`), a handoff
 * or "Last here" line with no room, and "Work here" lines that did not fit.
 */
/** How far back the `Installed twice` line looks, in lived days, and how many rows it reads. */
const CLAIM_WINDOW_DAYS = 7;
const CLAIM_ROWS = 500;

/**
 * INSTALLED TWICE, AND THE CLAIM HELD (2026-10-09, `claim.ts`). Silent unless a
 * hook stood down by claim inside the window: two wirings of Counterparts are
 * live in Claude Code, both ran an event, and the second to claim it delivered
 * nothing. The plugin stands down by itself when it can read the npm wiring
 * (`plugin.ts#hookGate`), so a row here means that reading failed — an older
 * plugin beside a newer `connect`, or two settings files naming two builds.
 * AMBER: every event still starts two hook processes, the two builds' workers
 * take turns at the store, and the claim is a BACKSTOP, not a guarantee — it
 * stops the twins it sees, and this line can count only those (the 0.3.15
 * release check measured one late twin delivering a second wake under load,
 * 2026-10-10; `claim.ts#firesOnce` closes that case for a session's first
 * start and an identified prompt). So it does not say "nothing was delivered
 * twice". One bounded read of an indexed name.
 */
export function claimFindings(store: Store, plugin: PluginInstallRead | null = null): Finding[] {
  return [...setAsideFindings(store), ...twiceFindings(store, plugin)];
}

/**
 * A CLAIMS FILE SET ASIDE (review of #359, 2026-10-10). A hook that met a
 * claims file that was not a database moved it aside and made it again
 * (`claim.ts#setClaimsAside`); the copy, named by when, is the trace. AMBER for
 * `CLAIM_WINDOW_DAYS` after: every event was still delivered, and nothing in the
 * file outlives 15 s, but until the rebuild a second wiring's twin was not
 * stopped, and a file that went bad once may be a disk that will again.
 */
function setAsideFindings(store: Store): Finding[] {
  const aside = claimsSetAside(store.dir);
  if (aside === null) return [];
  if (store.now() - aside.at > CLAIM_WINDOW_DAYS * 86_400_000) return [];
  return [
    finding(
      "claim",
      "amber",
      "Hook claims",
      `the claims file could not be read as a database on ${localStamp(aside.at, store.zone())}; a hook set it aside as sessions/${CLAIMS_DIR}/${aside.name} and made a new one, and every event was still delivered`,
      `Nothing to do if it does not happen again. The copy can be deleted; if it comes back, check the disk the store is on.`,
      { setAside: aside.name, setAsideAt: aside.at },
    ),
  ];
}

function twiceFindings(store: Store, plugin: PluginInstallRead | null): Finding[] {
  let rows: EventRow[];
  try {
    rows = store.eventLog({
      name: HOOK_CLAIM_LOST_EVENT,
      sinceDay: Math.max(0, store.livedDay() - (CLAIM_WINDOW_DAYS - 1)),
      order: "desc",
      limit: CLAIM_ROWS,
    });
  } catch {
    return [];
  }
  const newest = rows[0];
  if (newest === undefined) return [];
  const sides = new Set<string>();
  const hooks = new Set<string>();
  for (const row of rows) {
    const p = payloadOf(row);
    for (const side of [str(p, "lost"), str(p, "won")]) if (side !== null) sides.add(side);
    const hook = str(p, "hook");
    if (hook !== null) hooks.add(hook);
  }
  const who =
    sides.has("plugin") && sides.has("settings")
      ? "the Claude Code plugin's hooks and the hooks in your settings"
      : sides.has("plugin")
        ? "the Claude Code plugin's hooks, twice"
        : "two sets of hooks in your settings";
  const count = rows.length >= CLAIM_ROWS ? `${String(CLAIM_ROWS)}+` : String(rows.length);
  const fix = sides.has("plugin")
    ? `Keep one: to keep only the plugin, run \`counterparts disconnect\` and restart Claude Code; to keep only the npm install, run \`claude plugin uninstall ${plugin?.id ?? "counterparts@<marketplace>"}\`. Same memory either way.`
    : "Keep one: remove the extra Counterparts hook lines from ~/.claude/settings.json or the project's .claude/settings.json or .claude/settings.local.json (or run `counterparts disconnect` and then `counterparts connect`), then restart Claude Code.";
  return [
    finding(
      "claim",
      "amber",
      "Installed twice",
      `two Counterparts wirings are live (${who}): ${count} hook ${rows.length === 1 ? "run" : "runs"} in the last ${String(CLAIM_WINDOW_DAYS)} days found the event already taken and stood down by claim (the claim is a backstop: it counts the twins it stopped, not one that came too late for it); newest ${localStamp(newest.at, store.zone())} (${[...hooks].sort().join(", ")})`,
      fix,
      { stoodDown: rows.length, sides: [...sides].sort().join(","), hooks: [...hooks].sort().join(","), newestAt: newest.at },
    ),
  ];
}

export function wakeArrivalFindings(store: Store): Finding[] {
  const since = Math.max(0, store.livedDay() - WAKE_WINDOW_DAYS);
  let wakes: EventRow[];
  let room: WakeRoom;
  try {
    wakes = store.eventLog({ name: WAKE_DELIVERED_EVENT, sinceDay: since, order: "desc", limit: RESULTS_ROWS });
    room = wakeRoom(store, since);
  } catch {
    return [];
  }
  const counts: Record<string, number> = {};
  // A `not-found` splits three ways by what the check could read (2026-10-08).
  // ABSENT AT THE FIRST PROMPT is not a wake that failed to arrive: since about
  // 09-25 the host writes the file only after that prompt, so the rows written
  // before the check learned to wait for the Stop say this. Counted apart, and
  // out of the "N of M" — those wakes were never checked. ABSENT AT THE STOP
  // (`checkedAt: "stop"`) is different: no transcript by the end of a turn
  // means the host did not write one where it said. And UNREADABLE is a file
  // that was there and could not be opened. Both stay in the "N of M", each
  // with its own clause; counted, not graded, like `not-found` itself.
  let unread = 0;
  let noFile = 0;
  let unreadable = 0;
  for (const row of wakes) {
    const p = payloadOf(row);
    const o = str(p, "outcome") ?? "unknown";
    const transcript = str(p, "transcript");
    if (o === "not-found" && transcript === "absent") {
      if (str(p, "checkedAt") === "stop") noFile += 1;
      else unread += 1;
    } else if (o === "not-found" && transcript === "unreadable") {
      unreadable += 1;
    } else {
      counts[o] = (counts[o] ?? 0) + 1;
    }
  }
  const expected = wakes.length - (counts["no-wake-expected"] ?? 0) - unread;
  if (expected <= 0 && unread === 0 && !room.any) return [];
  const whole = counts["delivered"] ?? 0;
  const cut = counts["truncated"] ?? 0;
  const mismatched = counts["mismatch"] ?? 0;
  const unverified = counts["printed-unverified"] ?? 0;
  const missing = counts["not-found"] ?? 0;
  const window = `last ${String(WAKE_WINDOW_DAYS)} lived days`;
  const floor = wakes.length >= RESULTS_ROWS || room.floor;
  const rest =
    (mismatched > 0 ? `; ${String(mismatched)} carried another wake's mark (a session resumed after its record was let go)` : "") +
    (unverified > 0 ? `; ${String(unverified)} printed but not verifiable on this host build` : "") +
    (missing > 0 ? `; ${String(missing)} not found in the transcript` : "") +
    (noFile > 0 ? `; ${String(noFile)} had no transcript even at the end of the first turn` : "") +
    (unreadable > 0 ? `; ${String(unreadable)} ${unreadable === 1 ? "transcript" : "transcripts"} could not be read` : "") +
    (unread > 0 ? `; ${String(unread)} not checked (no transcript to read)` : "") +
    room.clauses +
    (floor ? ". More rows than were read: the counts are a floor" : "");
  const data = {
    wakes: expected,
    delivered: whole,
    cut,
    mismatch: mismatched,
    unverified,
    notFound: missing,
    noTranscriptAtStop: noFile,
    unreadable,
    notChecked: unread,
    overBudget: room.overBudget,
    overCap: room.overCap,
    noticeDropped: room.noticeDropped,
    gaveWay: Object.values(room.gaveWay).reduce((n, k) => n + k, 0),
    handoffNoRoom: room.handoffNoRoom,
    lastHereNoRoom: room.lastHereNoRoom,
    workNoRoom: room.workNoRoom,
    datedUnlisted: room.datedUnlisted,
    floor,
  };
  const head =
    expected <= 0
      ? `${window} — no wake checked on arrival`
      : `${window} — ${String(whole)} of ${String(expected)} ${expected === 1 ? "wake" : "wakes"} arrived whole`;
  if (cut === 0 && room.amber !== null) {
    return [
      finding(
        "wake",
        "amber",
        "Wake",
        `${head}${rest}`,
        room.amber,
        data,
      ),
    ];
  }
  if (cut > 0) {
    const newest = wakes.find((r) => str(payloadOf(r), "outcome") === "truncated");
    return [
      finding(
        "wake",
        "amber",
        "Wake",
        `${window} — ${String(cut)} of ${String(expected)} ${expected === 1 ? "wake" : "wakes"} reached the session cut short (newest ${rowDate(newest) ?? "?"}); ${String(whole)} arrived whole${rest}`,
        "A wake cut short loses its end, and the write-up and handoff pointers ride there. Nothing to do by hand; if it repeats, the wake is over what the host takes in one — worth reporting with this line.",
        data,
      ),
    ];
  }
  return [finding("wake", "green", "Wake", `${head}${rest}`, "", data)];
}

/** What the Wake line reads beside the arrivals: what a delivery could not carry. */
interface WakeRoom {
  readonly overBudget: number;
  readonly overCap: number;
  readonly noticeDropped: number;
  readonly gaveWay: Readonly<Record<string, number>>;
  readonly handoffNoRoom: number;
  readonly lastHereNoRoom: number;
  readonly workNoRoom: number;
  /** Wake renders that left a dated item ("Arriving:") unlisted for want of
   *  room (2026-10-10) — amber. */
  readonly datedUnlisted: number;
  /** The clauses, each led by "; ", or "". */
  readonly clauses: string;
  /** The amber's remedy, or null when nothing here is amber. */
  readonly amber: string | null;
  readonly any: boolean;
  readonly floor: boolean;
}

/** The rows since `since`, read newest first under the line's ceiling. Throws what the store throws. */
function wakeRoom(store: Store, since: number): WakeRoom {
  let floor = false;
  const read = (name: string): EventRow[] => {
    const rows = store.eventLog({ name, sinceDay: since, order: "desc", limit: RESULTS_ROWS });
    if (rows.length >= RESULTS_ROWS) floor = true;
    return rows;
  };
  const overBudget = read(INJECTION_OVERBUDGET_EVENT).length;
  const overCap = read(ENVELOPE_OVERCAP_EVENT).length;
  const noticeDropped = read(NOTICE_DROPPED_EVENT).length;
  const gaveWay: Record<string, number> = {};
  for (const row of read(ENVELOPE_GAVE_WAY_EVENT)) {
    const part = str(payloadOf(row), "part") ?? "?";
    gaveWay[part] = (gaveWay[part] ?? 0) + 1;
  }
  const handoffNoRoom = read(HANDOFF_REFUSED_EVENT).filter((r) => str(payloadOf(r), "reason") === "no-room").length;
  const lastHereNoRoom = read(LAST_HERE_NOROOM_EVENT).length;
  const workNoRoom = read(WORK_OVERFLOW_EVENT).filter((r) => str(payloadOf(r), "cause") === "room").length;
  // A DATED ITEM THE WAKE DID NOT LIST (2026-10-10): a render whose durable
  // row says "Arriving:" lost an element for want of room
  // (`self/briefing.ts#ROOM_ORDER`) — by its uncapped per-lane count, or, on
  // a row from before that count, by its trimmed list.
  const datedRows = read(SELF_BRIEFING_EVENT).filter((r) => datedUnlisted(payloadOf(r)) > 0);
  const datedUnlistedRenders = datedRows.length;
  const datedNewest = rowDate(datedRows[0]);
  const parts = Object.entries(gaveWay)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([part, n]) => `${part} ${String(n)}`);
  const times = (n: number): string => `${String(n)} ${n === 1 ? "time" : "times"}`;
  const clauses =
    // Counted, never amber (review of #318): the ceiling bounds the composed
    // wake, and the clock, Code-tab and reminder lines ride above it unreserved,
    // so a full wake goes a little over every day by design.
    (overBudget > 0 ? `; a session start sent a little more than the reported ceiling (the lines above the wake) ${times(overBudget)}` : "") +
    (overCap > 0 ? `; a hook's output passed the host's cap and was shown only as a preview ${times(overCap)}` : "") +
    (noticeDropped > 0 ? `; a notice for you was left off to keep the wake under the cap ${times(noticeDropped)}` : "") +
    (parts.length > 0 ? `; waited for room: ${parts.join(", ")}` : "") +
    (handoffNoRoom + lastHereNoRoom > 0
      ? `; no room for ${[
          handoffNoRoom > 0 ? `the handoff pointer ${times(handoffNoRoom)}` : "",
          lastHereNoRoom > 0 ? `the "Last here" line ${times(lastHereNoRoom)}` : "",
        ]
          .filter((s) => s.length > 0)
          .join(" and ")}`
      : "") +
    (workNoRoom > 0 ? `; "Work here" lines that did not fit, in ${String(workNoRoom)} ${workNoRoom === 1 ? "directory-day" : "directory-days"}` : "") +
    (datedUnlistedRenders > 0
      ? `; a dated item under "Arriving:" was not listed for want of room in ${String(datedUnlistedRenders)} ${datedUnlistedRenders === 1 ? "wake" : "wakes"}${datedNewest === null ? "" : ` (newest ${datedNewest})`}`
      : "");
  const remedies = [
    ...(datedUnlistedRenders > 0
      ? [
          "A dated item is listed before everything below it gives way — \"Work here\", the Yesterday line's titles, \"Last here\" and the handoffs — so a wake that still had no room for it is over-full: give the self page a short version or bring it under its room (`counterparts self-page`), or raise `injectionBudgetBytes`. The item is still a memory, and recall finds it.",
        ]
      : []),
    ...(overCap > 0
      ? ["Claude Code shows a hook's output past 10,000 characters only as a preview, so that output did not reach the session whole. Nothing to do by hand; if it repeats, worth reporting with this line."]
      : []),
  ];
  const amber = remedies.length === 0 ? null : remedies.join(" ");
  const any = clauses.length > 0;
  return { overBudget, overCap, noticeDropped, gaveWay, handoffNoRoom, lastHereNoRoom, workNoRoom, datedUnlisted: datedUnlistedRenders, clauses, amber, any, floor };
}

/**
 * HOW MANY DATED ITEMS ONE RENDER LEFT UNLISTED (2026-10-10), from its
 * `self.briefing` payload: the uncapped per-lane count (`trimmedLanes`), or —
 * on a row written before it — the `horizon` entries of its trimmed list.
 */
function datedUnlisted(p: Record<string, unknown>): number {
  const lanes = p["trimmedLanes"];
  if (typeof lanes === "object" && lanes !== null) {
    const n = (lanes as Record<string, unknown>)["horizon"];
    return typeof n === "number" ? n : 0;
  }
  const trimmed = p["trimmed"];
  if (!Array.isArray(trimmed)) return 0;
  return trimmed.filter((e) => typeof e === "object" && e !== null && (e as Record<string, unknown>)["lane"] === "horizon").length;
}

/** How far back the Tool results line reads, in lived days. */
const RESULTS_WINDOW_DAYS = 14;
/** Rows each of its reads takes, newest first; a read that comes back full is a floor. */
const RESULTS_ROWS = 2_000;

/**
 * WHAT REACHED THE MODEL (2026-10-02). The night of 10-02 every line here was
 * green while the dream read a third of its bundle: Claude Code saved the
 * begin and part 2 — each past its 50,000-character ceiling — to a file the
 * headless run cannot open, and the Lookups line counts look-ups, the Nightly
 * run line a run that finished. Two readings close that:
 *
 *   - an `mcp.result.oversize` row: a result came to more than the ceiling
 *     (`fit/TOOL_RESULT_CEILING`) and the server cut it there. AMBER — a cap
 *     upstream is too loose, and the model saw only the start of something.
 *   - a dream or a reflection handed in parts (its `mcp.part` row for part 1
 *     says how many) and finished without fetching every later part. AMBER —
 *     it acted on a bundle it had not read. A run still open is not judged;
 *     a run begun before parts were logged has no part-1 row and is not
 *     judged either.
 *   - an `mcp.result.spilled` row (2026-10-09, U14 item 3): the nightly run's
 *     own transcript showed a result of ours that Claude Code replaced with a
 *     short preview — its line is lower than the ceiling now (a remote flag
 *     can lower it), and the server could not see it. AMBER, like the two
 *     above: nothing to do by hand, and the night has already happened.
 *
 * Green says how many runs came in parts, the largest result handed, and
 * whether the last night's transcript was read for the host's cut. Silent on a
 * store whose window holds none of the three rows.
 */
export function resultFindings(store: Store): Finding[] {
  const since = Math.max(0, store.livedDay() - RESULTS_WINDOW_DAYS);
  let oversize: EventRow[];
  let spilled: EventRow[];
  const runs = new Map<string, { mechanism: string; of: number; fetched: Set<number>; date: string | null }>();
  let largest = 0;
  let floor = false;
  const open = new Set<string>();
  try {
    oversize = store.eventLog({ name: MCP_OVERSIZE_EVENT, sinceDay: since, order: "desc", limit: RESULTS_ROWS });
    spilled = store.eventLog({ name: MCP_SPILLED_EVENT, sinceDay: since, order: "desc", limit: RESULTS_ROWS });
    const parts = store.eventLog({ name: MCP_PART_EVENT, sinceDay: since, order: "asc", limit: RESULTS_ROWS });
    floor = oversize.length >= RESULTS_ROWS || parts.length >= RESULTS_ROWS || spilled.length >= RESULTS_ROWS;
    for (const row of parts) {
      const p = payloadOf(row);
      const ref = str(p, "ref");
      const part = num(p, "part");
      const of = num(p, "of");
      if (ref === null || part === null || of === null) continue;
      largest = Math.max(largest, num(p, "chars") ?? 0);
      // A part-1 row opens the run's count (a resumed dream's begin opens it again).
      if (part === 1) runs.set(ref, { mechanism: str(p, "mechanism") ?? "dream", of, fetched: new Set([1]), date: rowDate(row) });
      else runs.get(ref)?.fetched.add(part);
    }
    for (const d of store.dreams({ limit: RESULTS_ROWS })) if (d.state === "begun") open.add(d.id);
    for (const r of store.reflections({ limit: RESULTS_ROWS })) if (r.state !== "reflected") open.add(r.id);
  } catch {
    return [];
  }
  if (oversize.length === 0 && runs.size === 0 && spilled.length === 0) return [];
  const ceiling = TOOL_RESULT_CEILING.CHARS;
  const inParts = [...runs.entries()].filter(([, r]) => r.of > 1);
  const unread = inParts
    .filter(([ref]) => !open.has(ref))
    .map(([ref, r]) => {
      const missing: number[] = [];
      for (let k = 2; k <= r.of; k += 1) if (!r.fetched.has(k)) missing.push(k);
      return { ref, ...r, missing };
    })
    .filter((r) => r.missing.length > 0);
  const window = `last ${String(RESULTS_WINDOW_DAYS)} lived days`;
  const newest = oversize[0];
  const np = payloadOf(newest);
  const overSaid =
    newest === undefined
      ? ""
      : `${String(oversize.length)} ${oversize.length === 1 ? "result" : "results"} came to more than the ${String(ceiling)} characters one answer carries — the newest, ${str(np, "tool") ?? "a tool"}${str(np, "phase") === null ? "" : ` ${str(np, "phase") as string}`} on ${rowDate(newest) ?? "an unknown day"}, at ${String(num(np, "chars") ?? 0)}, ${np["cut"] === true ? `cut to ${String(num(np, "cutTo") ?? 0)} with a note saying so` : "shipped whole (nothing in it to cut)"}`;
  const unreadSaid =
    unread.length === 0
      ? ""
      : unread
          .map((r) => `${r.mechanism === "reflection" ? "reflection" : "dream"} ${r.ref}${r.date === null ? "" : ` (${r.date})`} was handed in ${String(r.of)} parts and finished without part${r.missing.length === 1 ? "" : "s"} ${r.missing.join(", ")}`)
          .join("; ");
  const newestSpill = spilled[0];
  const sp = payloadOf(newestSpill);
  const spillTool = (str(sp, "tool") ?? "a tool").replace(/^mcp__counterparts__/, "");
  const spillRuns = new Set(spilled.map((r) => str(payloadOf(r), "run") ?? "")).size;
  const spillSaid =
    newestSpill === undefined
      ? ""
      : `${String(spilled.length)} ${spilled.length === 1 ? "result" : "results"} of the nightly run${spillRuns > 1 ? ` (${String(spillRuns)} runs)` : ""} reached the model only as Claude Code's short preview — the newest, ${spillTool}${str(sp, "phase") === null ? "" : ` ${str(sp, "phase") as string}`} on ${rowDate(newestSpill) ?? "an unknown day"}${str(sp, "said") === null ? "" : `, at ${str(sp, "said") as string}`}`;
  // WAS THE LAST NIGHT CHECKED AT ALL (2026-10-09)? Said on the line, green or
  // amber, so a transcript the host stopped writing where it is looked for is
  // not silence that reads as "nothing cut". A last run whose own cuts the
  // amber text already names adds nothing here.
  let checked = "";
  let lastTranscript: string | null = null;
  try {
    const last = nightRunOf(store);
    lastTranscript = last?.transcript ?? null;
    if (last !== null && last.transcript !== undefined && !(last.transcript === "read" && (last.spills ?? 0) > 0)) {
      checked =
        last.transcript === "read"
          ? `; the ${last.date} run's transcript showed none of our results cut by Claude Code`
          : `; the ${last.date} run's transcript ${last.transcript === "absent" ? "was not found where Claude Code keeps sessions" : "could not be read"}, so Claude Code's cut was not checked`;
    }
  } catch {
    /* the line stands without it */
  }
  // WHY THE HOST CUT, by the newest cut's shape (review of #330): the
  // character line, the token line the run pins, or the budget for one turn.
  const spillShape = str(sp, "shape");
  const spillFix =
    spillShape === "turn-budget"
      ? "Nothing to do by hand: the run fetched several results in one turn, and together they passed Claude Code's budget for one turn, so it cut the largest to a preview. Worth reporting with this line."
      : spillShape === "tokens" || spillShape === "token-cut"
        ? `Nothing to do by hand: Claude Code's token limit on one tool result came out lower than the ${String(TOOL_RESULT_CEILING.HOST_TOKENS)} tokens the nightly run sets it to, so the night read through a keyhole. Worth reporting with this line.`
        : `Nothing to do by hand: Claude Code's limit on one tool result is lower than the ${String(ceiling)} characters Counterparts keeps them under, so the night read through a keyhole. Worth reporting with this line — the ceiling has to come down to meet it.`;
  const data = {
    ceiling,
    oversize: oversize.length,
    newestOversizeTool: str(np, "tool"),
    newestOversizeChars: num(np, "chars"),
    runsInParts: inParts.length,
    runsUnread: unread.length,
    largestPart: largest,
    spilled: spilled.length,
    newestSpillTool: str(sp, "tool"),
    lastTranscript,
    floor,
  };
  if (spillSaid.length > 0 || overSaid.length > 0 || unreadSaid.length > 0) {
    return [
      finding(
        "results",
        "amber",
        "Tool results",
        `${window} — ${[spillSaid, overSaid, unreadSaid].filter((x) => x.length > 0).join("; ")}${checked}${floor ? ". More rows than were read: the counts are a floor" : ""}`,
        spillSaid.length > 0
          ? spillFix
          : overSaid.length > 0
            ? "Nothing to do by hand: the model was told the answer was cut. It means a cap upstream lets a result grow past the ceiling — worth reporting with this line."
            : "Nothing to do by hand: the next night reads its own bundle. If it repeats, the run is skipping parts — worth reporting with this line.",
        data,
      ),
    ];
  }
  return [
    finding(
      "results",
      "green",
      "Tool results",
      `${window} — every result under ${String(ceiling)} characters; ${inParts.length === 0 ? "no bundle came in parts" : `${String(inParts.length)} ${inParts.length === 1 ? "bundle" : "bundles"} came in parts, every part read`}; the largest part handed was ${String(largest)} characters${checked}${floor ? ". More rows than were read: the counts are a floor" : ""}`,
      "",
      data,
    ),
  ];
}

/** How far back the Association line reads turns, in lived days. */
const ASSOCIATION_WINDOW_DAYS = 7;

/**
 * ASSOCIATION, MEASURED (2026-09-28, association build 1). What spreading
 * activation actually did on the last week's turns — how often it got past its
 * seeds (depth 2), how often the node budget stopped it, and how many of its
 * contributions LANDED on a candidate — and a census of the edges: how many,
 * how many still conduct, and where they came from. The source split is
 * DERIVED (the edge table records no source): an edge touching a dreamed gist
 * is a gist tie, a pair a dream's `link` named (not undone) is a dream link,
 * and the rest were learned from use. Informational: green, with the numbers.
 */
export function associationFindings(store: Store): Finding[] {
  const day = store.livedDay();
  const since = Math.max(0, day - ASSOCIATION_WINDOW_DAYS);
  let turns = 0;
  let deep = 0;
  let nodeLimit = 0;
  let landed = 0;
  let computed = 0;
  let dropped = 0;
  let allTurns = 0;
  let unread = false;
  let pointersShown = 0;
  let pointersExpanded = 0;
  let contiguityPairs = 0;
  let contiguityLanded = 0;
  let contiguityEvictedOther = 0;
  let contiguityScaled = 0;
  let contiguityExcluded = 0;
  let contiguityLost = 0;
  let contiguityFailed = 0;
  const census = { total: 0, conducting: 0, gist: 0, dream: 0, hebbian: 0 };
  try {
    const rows = store.eventLog({ name: "recall.decision", sinceDay: since, order: "desc", limit: ASSOCIATION_ROWS });
    unread = rows.length >= ASSOCIATION_ROWS;
    allTurns = rows.length;
    for (const row of rows) {
      const p = payloadOf(row);
      const d = num(p, "dropped");
      if (d !== null) dropped += d;
      const s = p["spread"];
      if (s === null || typeof s !== "object") continue;
      const sp = s as Record<string, unknown>;
      turns += 1;
      if (typeof sp["depth"] === "number" && sp["depth"] >= 2) deep += 1;
      if (sp["stop"] === "node-limit") nodeLimit += 1;
      if (typeof sp["landed"] === "number") landed += sp["landed"];
      if (typeof sp["computed"] === "number") computed += sp["computed"];
      if (typeof sp["pointersShown"] === "number") pointersShown += sp["pointersShown"];
    }
    // The other half of the pointer measurement (2026-09-28): of the quiet
    // pointers shown, how many a reply went on to expand.
    for (const row of store.eventLog({ name: "recall.credit", sinceDay: since, order: "desc", limit: ASSOCIATION_ROWS })) {
      const n = num(payloadOf(row), "pointersExpanded");
      if (n !== null) pointersExpanded += n;
    }
    // Temporal contiguity (2026-09-28): what the boundaries buffered, what of
    // it LANDED as a conducting link, and what it cost — other links evicted
    // at the nodes it touched, those nodes scaled back — from their own
    // `associate.flush` rows (review of #281, findings 2 and 9).
    for (const row of store.eventLog({ name: "associate.flush", sinceDay: since, order: "desc", limit: ASSOCIATION_ROWS })) {
      const c = payloadOf(row)["contiguity"];
      if (c === null || typeof c !== "object") continue;
      const cr = c as Record<string, unknown>;
      contiguityPairs += num(cr, "buffered") ?? 0;
      contiguityLanded += num(cr, "landed") ?? 0;
      contiguityEvictedOther += num(cr, "evictedOther") ?? 0;
      contiguityScaled += num(cr, "renormalizedNodes") ?? 0;
      contiguityExcluded += num(cr, "excluded") ?? 0;
      contiguityLost += num(cr, "lostEarlier") ?? 0;
      if (cr["reason"] === "failed") contiguityFailed += 1;
    }
    const dreamed = new Set<string>();
    const dreamPairs = new Set<string>();
    for (const dream of store.dreams({ limit: 10_000 })) {
      for (const c of store.dreamChanges(dream.id)) {
        if (c.undone !== 0 || c.ref === null) continue;
        if (c.action === "gist") dreamed.add(c.ref);
        if (c.action === "link" && c.ref2 !== null) dreamPairs.add(pairKey(c.ref, c.ref2));
      }
    }
    for (const e of store.allEdges()) {
      census.total += 1;
      if (!isDead({ src: e.src, dst: e.dst, weight: e.weight, lastDay: e.last_day }, day, ASSOCIATE_TUNABLES)) census.conducting += 1;
      if (dreamed.has(e.src) || dreamed.has(e.dst)) census.gist += 1;
      else if (dreamPairs.has(pairKey(e.src, e.dst))) census.dream += 1;
      else census.hebbian += 1;
    }
  } catch {
    return [];
  }
  const pct = (n: number): string => (turns === 0 ? "0%" : `${String(Math.round((100 * n) / turns))}%`);
  const spreadSaid =
    turns === 0
      ? `last ${String(ASSOCIATION_WINDOW_DAYS)} lived days — no spreading measured yet`
      : `last ${String(ASSOCIATION_WINDOW_DAYS)} lived days — spread got past its seeds (depth 2) on ${pct(deep)} of ${String(turns)} turns it ran; stopped at the node limit on ${pct(nodeLimit)}; ${String(landed)} of ${String(computed)} contributions landed on a candidate the cut kept; ${String(pointersShown)} quiet ${pointersShown === 1 ? "pointer" : "pointers"} shown (memories only links reached), ${String(pointersExpanded)} later expanded`;
  return [
    finding(
      "association",
      "green",
      "Association",
      `${spreadSaid}. Edges: ${String(census.total)} rows, ${String(census.conducting)} conducting — ${String(census.hebbian)} learned from use or contiguity, ${String(census.dream)} dream links, ${String(census.gist)} gist ties (derived: a row touching a dream's gist is a gist tie, a pair a dream linked is a dream link, the rest were learned from use or from memories made next to each other)` +
        `. Temporal contiguity buffered ${String(contiguityPairs)} ${contiguityPairs === 1 ? "pair" : "pairs"} of neighbouring memories at the boundaries, ${String(contiguityLanded)} landed as links; it pushed out ${String(contiguityEvictedOther)} other ${contiguityEvictedOther === 1 ? "link" : "links"} and scaled back ${String(contiguityScaled)} ${contiguityScaled === 1 ? "memory's" : "memories'"} links at full memories; ${String(contiguityExcluded)} ${contiguityExcluded === 1 ? "memory" : "memories"} the nightly run wrote left out` +
        (contiguityFailed > 0 ? `; the pass failed at ${String(contiguityFailed)} ${contiguityFailed === 1 ? "boundary" : "boundaries"}` : "") +
        (contiguityLost > 0 ? `; ${String(contiguityLost)} planned ${contiguityLost === 1 ? "pair was" : "pairs were"} lost before a flush recorded them` : "") +
        (dropped > 0 ? `. The candidate cut left out ${String(dropped)} scored memories, summed over all ${String(allTurns)} recall turns in the window` : "") +
        (unread ? ". More turns than were read: the counts are a floor" : ""),
      "",
      {
        turns,
        deep,
        nodeLimit,
        landed,
        computed,
        dropped,
        allTurns,
        pointersShown,
        pointersExpanded,
        contiguityPairs,
        contiguityLanded,
        contiguityEvictedOther,
        contiguityScaled,
        contiguityExcluded,
        contiguityLost,
        contiguityFailed,
        edges: census.total,
        conducting: census.conducting,
        hebbian: census.hebbian,
        dreamLinks: census.dream,
        gistTies: census.gist,
        floor: unread,
      },
    ),
  ];
}

/** Turn rows the Association line reads, newest first; a full read is a floor. */
const ASSOCIATION_ROWS = 5_000;

/**
 * DREAMING, informational (2026-09-26): the owner's setting (2026-09-28:
 * auto, ask or off), when the counterpart last dreamed, and what today's line
 * did — started the nightly run, asked, or was declined. Never amber: not
 * dreaming is the owner's choice, and a quiet week is not a fault.
 */
export function dreamingFindings(input: DoctorInput, store: Store): Finding[] {
  let last: ReturnType<Store["dreams"]>[number] | undefined;
  let ask: ReturnType<Store["dreamAsk"]>;
  let setting: DreamingSetting;
  try {
    // Past any run of undone dreams (2026-10-02): five newest undone read as
    // "has not dreamed yet" when the read stopped at five.
    last = store.dreams({ limit: DREAM_ROWS }).find((d) => d.state !== "undone");
    ask = store.dreamAsk(input.today);
    setting = dreamingSetting(store);
  } catch {
    return [];
  }
  const when = last === undefined ? null : (last.date ?? `lived day ${String(last.day)}`);
  const today =
    setting === "off"
      ? "off — no dreams (counterparts dream --setting ask turns it back on)"
      : ask === undefined
        ? "not started today"
        : ask.state === "declined"
          ? "asked today; the owner said not today"
          : ask.state === "launched"
            ? "started today, in the background"
            : "asked today";
  const unfinished = last !== undefined && last.state === "begun" ? `; dream ${last.id} is begun and not yet journaled` : "";
  return [
    finding(
      "dreaming",
      "green",
      "Dreaming",
      `${setting}; ${when === null ? "has not dreamed yet" : `last dreamed ${when}${last?.title ? ` — "${last.title}"` : ""}`}; ${today}${unfinished}`,
      "",
      { setting, last: when, dream: last?.id ?? null, ask: ask?.state ?? null },
    ),
  ];
}

/**
 * THE NIGHTLY RUN, headless (2026-09-29): what became of the latest run the
 * host started itself (setting `auto`) — the store's one-row record
 * (`dream/#nightRunOf`). Silent when no run was ever started and the setting
 * is not `auto`. AMBER only while the setting is `auto` and the latest run
 * did not finish (could not start, failed, timed out, or started and never
 * reported an end past its watchdog): a mechanism the owner chose is not
 * working. The fix says what to look at.
 */
export function nightRunFindings(input: DoctorInput, store: Store): Finding[] {
  let setting: DreamingSetting;
  let run: ReturnType<typeof nightRunOf>;
  let now: number;
  try {
    setting = dreamingSetting(store);
    run = nightRunOf(store);
    now = store.now();
  } catch {
    return [];
  }
  if (run === null) {
    if (setting !== "auto") return [];
    return [finding("night-run", "green", "Nightly run", "auto; no headless run yet — the first session of a day with enough new memory starts one", "", { setting, state: null })];
  }
  // ITS MORNING CATCH-UP (2026-10-01, build 3), when it had anything owed.
  const cu = catchUpOf(store, run.run);
  const caught = cu === null ? "" : `; catch-up: ${catchUpWords(cu)}`;
  const data = {
    setting,
    run: run.run,
    state: run.state,
    date: run.date,
    reason: run.reason,
    code: run.code,
    dream: run.dream,
    reflection: run.reflection,
    ...(cu === null ? {} : { catchUp: cu.state, writtenUp: cu.written, writeUpParts: cu.parts, leftOwed: cu.left }),
  };
  const mins = (ms: number): string => `${String(Math.max(1, Math.round(ms / 60_000)))} min`;
  const took = run.endedAt === null ? "" : ` after ${mins(run.endedAt - run.startedAt)}`;
  const what = run.kind === "reflection" ? "the reflection alone" : "the whole night";
  if (run.state === "done") {
    const ids = [run.dream, run.reflection].filter((x): x is string => x !== null).join(", ");
    return [finding("night-run", "green", "Nightly run", `${setting}; last run ${run.date} (${what}) finished${took}${ids.length > 0 ? ` — ${ids}` : ""}${caught}`, "", data)];
  }
  if (run.state === "partial") {
    // PART OF THE RUN RAN (2026-09-29, owner): which parts, and — when the
    // exit said more than "it stopped" — why.
    const why = run.reason === "unfinished" ? "" : ` (${nightRunWords(run)})`;
    return [
      finding(
        "night-run",
        setting === "auto" ? "amber" : "green",
        "Nightly run",
        `${setting}; the run of ${run.date} (${what}) was partial${took}: ${nightPartsWords(run)}${why}${caught}`,
        "Nothing to do by hand: a later session picks up what did not run — a dream cut off is resumed, a reflection cut off runs alone.",
        { ...data, parts: (run.parts ?? []).join(",") },
      ),
    ];
  }
  if (run.state === "started") {
    const lost = nightRunLost(run, now);
    return [
      finding(
        "night-run",
        lost && setting === "auto" ? "amber" : "green",
        "Nightly run",
        lost
          ? `${setting}; the run of ${run.date} started ${mins(now - run.startedAt)} ago and never reported an end — its process went away (a sleep, a restart, a kill)`
          : `${setting}; running now (${what}), started ${mins(now - run.startedAt)} ago`,
        lost ? "The next session asks instead of starting another headless run. If this repeats, run claude -p once by hand in a terminal to see whether it hangs (a login, an update prompt)." : "",
        data,
      ),
    ];
  }
  const words = nightRunWords(run);
  const ended = run.state === "could-not-start" ? "could not start" : run.state === "timed-out" ? "timed out" : "failed";
  const fix =
    run.reason === "no-claude"
      ? "The headless run starts claude -p: put the claude command on the PATH the hooks see, or set dreaming to ask (counterparts dream --setting ask)."
      : run.reason === "quick-exit"
        ? "Run claude -p once by hand in a terminal to see why it stops (a login, an update prompt). Meanwhile the session asks instead."
        : run.reason === "nothing-ran"
          ? "The headless run needs the counterparts MCP server registered for claude at user scope (claude mcp list shows it); the server's own mcp.session rows say whether it refused the session."
          : "A later session starts it again, or asks when it cannot. counterparts dream --setting ask stops the headless runs.";
  return [finding("night-run", setting === "auto" ? "amber" : "green", "Nightly run", `${setting}; the run of ${run.date} (${what}) ${ended}${took}: ${words}${caught}`, fix, data)];
}

export function selfPageFindings(store: Store): Finding[] {
  const page = readSelfPage(store);
  if (page === null) {
    // CLEARED is not NEVER WRITTEN. The wake says the same thing either way — it
    // has no page — but a line telling the owner nothing was ever written, about
    // a page he cleared last week, is the diagnostic getting it wrong in the one
    // place he would look to check (adversarial review MINOR-F).
    const cleared = clearedPage(store);
    if (cleared !== null) {
      return [
        finding(
          "self-page",
          "green",
          "Self page",
          `cleared ${cleared.on === "" ? "(date unrecorded)" : `on ${cleared.on}`}` +
            `${cleared.reason === "" ? "" : ` — ${cleared.reason}`}; ${cleared.versions} version${cleared.versions === 1 ? "" : "s"} kept`,
          cleared.versions > 0
            ? `Put one back with: counterparts self-page --restore ${cleared.newest}.`
            : "",
          { present: false, cleared: true, on: cleared.on, versions: cleared.versions },
        ),
      ];
    }
    return [
      finding(
        "self-page",
        "green",
        "Self page",
        "not written yet — still forming",
        "",
        { present: false, cleared: false },
      ),
    ];
  }
  const stale = pageStaleOn(page.revisedOn, store.today(), SELF_TUNABLES.PAGE_STALE_DAYS);
  const room = SELF_TUNABLES.PAGE_ROOM_BYTES;
  const overRoom = page.bytes > room;
  // WHAT THE LAST WAKE SHOWED OF IT (2026-10-02, the "nobody saw it" review;
  // a ladder of whole texts since 2026-10-10, `self/briefing.ts#PageRung`):
  // read off the newest wake render's own row. Green for the page whole or
  // the short version its writer wrote with it; amber for the outline, the
  // headings, one line or nothing — with what to do.
  const shown = lastPageRung(store);
  const said = shown === null ? "" : `; the last wake showed ${PAGE_RUNG_WORDS[shown] ?? shown}`;
  const detail =
    `${page.bytes} bytes${overRoom ? ` (past its ${String(room)}-byte room)` : ""}, version ${page.version}` +
    `${page.short === null ? "" : `, with a ${String(page.short.bytes)}-byte short version`}, last revised ${page.revisedOn === "" ? "(unrecorded)" : page.revisedOn}` +
    `${page.by === null ? "" : ` by ${page.by}`}${said}`;
  // The day count and the room ride along so a surface can say it in words
  // ("not rewritten in 16 days") without re-deriving either (dashboard health).
  const data = {
    present: true,
    bytes: page.bytes,
    version: page.version,
    revisedOn: page.revisedOn,
    stale,
    // True when the wake prints it whole at 9,000 bytes whatever it reserves.
    wakeShowsAll: !overRoom,
    room,
    hasShort: page.short !== null,
    rung: shown,
    daysSince: calendarDaysSince(page.revisedOn, store.today()),
    staleAfter: SELF_TUNABLES.PAGE_STALE_DAYS,
  };
  // WHAT TO DO when the wake stepped below the short version: give it one, or
  // bring the page under its room. A page within its room that still did not
  // fit is the ceiling's doing, not the page's.
  const short = shown === "outline" || shown === "headings" || shown === "line" || shown === "none";
  const fix = !short
    ? ""
    : overRoom
      ? `Sessions are not reading the page whole. Give it a short version under ${String(room)} bytes (the self_page tool's \`short\`), or bring it under ${String(room)} bytes: counterparts self-page --write.`
      : `The page is within its room, so the wake's ceiling is too small for it: raise injectionBudgetBytes in the configuration (9000 is the default), or give the page a short version.`;
  return [
    stale
      ? finding(
          "self-page",
          "amber",
          "Self page",
          `${detail} — stale (over ${SELF_TUNABLES.PAGE_STALE_DAYS} days)`,
          `Nothing has revised it lately: check the page writer, or amend it yourself with counterparts self-page --write.${fix === "" ? "" : ` ${fix}`}`,
          data,
        )
      : short
        ? finding("self-page", "amber", "Self page", detail, fix, data)
        : finding("self-page", "green", "Self page", detail, "", data),
  ];
}

/** How doctor names each rung the last wake printed the page on (`self/briefing.ts#PageRung`). */
const PAGE_RUNG_WORDS: Readonly<Record<string, string>> = {
  whole: "it whole",
  short: "its short version",
  outline: "only each section's heading and first sentence",
  headings: "only its section headings",
  line: "one line about it",
  none: "nothing of it — no room even for a line",
};

/**
 * THE RUNG THE NEWEST WAKE RENDER PRINTED THE PAGE ON (2026-10-10), from its
 * durable `self.briefing` row (`counterpart.ts#recordSelfBriefing`), or null
 * when no row carries one — a render before the ladder, or none yet. Never
 * throws.
 */
function lastPageRung(store: Store): string | null {
  try {
    const row = store.eventLog({ name: SELF_BRIEFING_EVENT, order: "desc", limit: 1 })[0];
    if (row === undefined) return null;
    const page = (JSON.parse(row.payload ?? "{}") as Record<string, unknown>)["page"];
    if (typeof page !== "object" || page === null) return null;
    const rung = (page as Record<string, unknown>)["rung"];
    return typeof rung === "string" && rung.length > 0 ? rung : null;
  } catch {
    return null;
  }
}

/**
 * THE NIGHTLY PAGE WRITER (2026-09-20, S2) — one line: has last night happened,
 * and what did it come to.
 *
 * **GREEN when it has never run on a store younger than a day**, and that is
 * the whole design of this line rather than a leniency. A mechanism that fires
 * once a night cannot have fired on a store installed this morning, and a line
 * that says something is wrong from the moment it lands is a line people learn
 * to read past — the same rule `fired.ts` states for its `blind` rows and the
 * same one `selfPageFindings` follows for an absent page.
 *
 * Green also for a night that read the day and had nothing to say: that is the
 * mechanism working, and it is stated in words rather than left as a silence.
 *
 * Green when it is OFF, too — a deliberate choice is not a fault — with the
 * line saying what off means. (This comment and the adapter CONTRACT used to
 * say "amber while a page stands"; the code has said green since the S2
 * review, and the words now follow the code, 2026-09-28.)
 *
 * AMBER, with a fix, on the readings that mean something has stopped: a run
 * that failed or was refused, a pageWriter block that could not be read, and
 * — since the writer moved into the nightly run (2026-09-28) — a night owed
 * for days while nightly runs went on without it. A night owed because no run
 * started (fewer than three new memories, dreaming off or declined) is the
 * ordinary state of a quiet week and stays green. Never red: nothing here can
 * cost a session its memory.
 */
export function pageWriterFindings(store: Store, config: AdapterConfig): Finding[] {
  const mode = pageWriterMode(config);
  // THE MECHANISM'S OWN NIGHT, not one this line derives (PR #189 review, M2):
  // the local calendar day, held back east of UTC to a provenance date that has
  // closed — the one function `Self`, the nightly run and this line all read, so the
  // claim's local `on` is never compared with a UTC `today`.
  const { today, about } = pageWriterNight(store);
  const last = lastPageWriterRun(store);
  const page = readSelfPage(store);
  const data = {
    mode,
    lastAbout: last?.about ?? "",
    lastOutcome: last?.outcome ?? "",
    ran: last !== null,
  };
  // A BLOCK THAT COULD NOT BE READ IS AMBER, AND IT SAYS WHICH KEY. The block is
  // lenient now (S2 review), so a typo costs the setting rather than the store's
  // memory — but a setting that silently did nothing is the other half of that
  // failure, and this is the line that stops it being silent.
  const ignored = config.pageWriter?.ignored ?? [];
  if (ignored.length > 0) {
    return [
      finding(
        "page-writer",
        "amber",
        "Page writer",
        `${mode} mode; ${ignored.join("; ")}`,
        "Fix the pageWriter block in claude-code.json. Nothing else in the file was affected, and memory is unaffected.",
        { ...data, ignored: ignored.join(" | ") },
      ),
    ];
  }
  if (mode === "off") {
    // GREEN, always. Off is a setting somebody chose, and a diagnostic that
    // grades a deliberate choice as a fault is the shape of line people learn to
    // read past — the same rule `fired.ts` states for a `disabled` mechanism.
    // The line still says what off MEANS, so nobody has to remember.
    return [
      finding(
        "page-writer",
        "green",
        "Page writer",
        page === null
          ? "off — nothing writes the self page on its own, and nothing has been written by hand either"
          : "off — the page stands, and from here it changes only when somebody writes it",
        "",
        data,
      ),
    ];
  }
  if (last === null) {
    // NEVER RUN. On a store with no yesterday that is the correct state and
    // says so; on one that has lived a day it is still green, because the
    // mechanism runs at the NEXT session start and has not been given a turn.
    const young = !hasDayBefore(store, dayBefore(about, -1));
    return [
      finding(
        "page-writer",
        "green",
        "Page writer",
        young
          ? `${mode} mode; never run — this store has no day before ${today} yet`
          : `${mode} mode; never run — it is the first part of the next nightly run, before the dream (${about})${dreamingSetting(store) === "off" ? "; dreaming is off, so the nightly run does not start" : ""}`,
        "",
        { ...data, young },
      ),
    ];
  }
  const status = pageWriterStatus(store, last.about, today);
  const when = `last ran for ${last.about}${last.on === "" ? "" : ` on ${last.on}`}`;
  // IS TONIGHT'S ALREADY OWED, AND HAS IT BEEN OWED FOR A WHILE? The failure
  // this catches is the one with no row at all behind it: an ask that will not
  // fit the host's ceiling is DEFERRED, and a deferral leaves only a ring event
  // that dies with the hook process. Without this line, a writer that stopped
  // being delivered on day 4 reads exactly like one that ran last night —
  // which is I32's shape, and the reason this line exists at all.
  const owed = pageWriterDue(store, {
    mode,
    today,
    about,
    observer: store.observer,
    asksPerDay: SELF_TUNABLES.PAGE_WRITER_ASKS_PER_DAY,
  });
  const staleFor = last.on === "" ? 0 : daysBetween(last.on, today);
  // OWED IS NOT OVERDUE on its own any more (2026-09-28). The writer runs
  // inside the nightly run, and a night with fewer than three new memories
  // runs nothing — the day carries over — so "owed for days" is the ordinary
  // state of a quiet week. It is amber only when nightly runs HAPPENED since
  // (a dream dated after the writer's last row, before today) and the writer
  // still left nothing: the run is going without it.
  const ranSince = last.on !== "" ? dreamsBetween(store, last.on, today) : 0;
  const overdue = owed.due && staleFor > PAGE_WRITER_STALE_DAYS && ranSince > 0;
  const bad = status.outcome === "failed" || status.outcome === "refused";
  const detail =
    `${mode} mode; ${when} — ${status.outcome}` +
    (status.derived ? " (derived: it was handed the day and wrote nothing)" : "") +
    (status.run !== null && status.run.detail.length > 0 && !status.derived
      ? `, ${status.run.detail}`
      : "") +
    (owed.due ? `; ${owed.about} is owed` : "") +
    (overdue ? ` and nothing has been delivered for ${String(staleFor)} days` : "");
  return [
    finding(
      "page-writer",
      bad || overdue ? "amber" : "green",
      "Page writer",
      detail,
      bad || overdue
        ? "counterparts mechanisms --all --dir <store> --observer shows the run's own row. The page writer is the first part of the nightly run, before the dream: counterparts dream shows whether the runs are happening and how each ended. counterparts self-page --write amends the page by hand meanwhile."
        : "",
      {
        ...data,
        outcome: status.outcome,
        derived: status.derived,
        owedFor: owed.due ? owed.about : "",
        staleFor,
      },
    ),
  ];
}

// `daysBetween` is `fired.ts`'s (E2, 2026-09-20) and is imported at the top of
// this file rather than written twice. S2 landed a local copy of the same four
// lines and the merge put them side by side; one definition is the rule this
// module already keeps for every other reading it shares with the fired view.
// The one behavioural difference is deliberate: the shared one can return a
// NEGATIVE when a clock has moved backwards, and `overdue` below compares with
// `>`, so a future date reads "not overdue" rather than being clamped to today.

/** Calendar days a night may be owed before the line says so. A writer that
 *  missed last night has not failed; one that has missed three has. */
export const PAGE_WRITER_STALE_DAYS = 2;

/** Dreams begun on a calendar date after `after` and before `before` (not undone). Never throws. */
function dreamsBetween(store: Store, after: string, before: string): number {
  try {
    return store.dreams({ limit: 50 }).filter((d) => d.state !== "undone" && d.date !== null && d.date > after && d.date < before).length;
  } catch {
    return 0;
  }
}

/** A page that was written and then cleared: when, why, and what is restorable.
 *  Null when no page row exists at all. */
function clearedPage(
  store: Store,
): { on: string; reason: string; versions: number; newest: number } | null {
  const id = findPageRow(store);
  if (id === null) return null;
  let marker: { on: string; reason: string } | null = null;
  try {
    marker = clearedMarker(store.readProse(id).meta);
  } catch {
    return null;
  }
  if (marker === null) return null;
  const versions = store.versions(id);
  const newest = versions.reduce((n, v) => Math.max(n, v.seq), 0);
  return { ...marker, versions: versions.length, newest };
}

/**
 * Calendar days, like every other window here. A date that is absent or does
 * not READ reads as stale — the same direction `self/#pageStale` takes, and the
 * two are asserted to agree.
 */
function pageStaleOn(revisedOn: string, today: string, limit: number): boolean {
  const days = calendarDaysSince(revisedOn, today);
  return days === null ? true : days > limit;
}

/** Calendar days from `revisedOn` to `today`; null when either does not read. */
function calendarDaysSince(revisedOn: string, today: string): number | null {
  const on = revisedOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const a = Date.parse(`${on}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * How to get a memory back. Short enough to survive being read in a panic, and
 * printed as the remedy on every Snapshot finding that is not green, because the
 * moment somebody needs it is the moment they will not go looking for it.
 */
export const RESTORE_STEPS =
  "To restore: stop every session, copy a snapshot directory to the store's path, " +
  "then counterparts verify --dir <store> --rebuild (with the embed key exported, or " +
  "the vectors are dropped and refilled over the following days). Everything comes back " +
  "with the copy — the memories, their versions and the journal are all in the database; " +
  "the search index and the vectors are rebuilt. A copy holding operational.sqlite or " +
  "prose/ is from BEFORE the floor changed and this build cannot open it: it is kept and " +
  "counted, never rotated, and the build tagged floor/v5-last reads it.";

/** How stale the newest snapshot may be before this line goes amber. A daily
 *  mechanism that has not fired for two calendar days has missed one. */
export const SNAPSHOT_STALE_DAYS = 2;

/**
 * IS THERE A RECENT COPY OF THE STORE, AND HOW MANY ARE ACTUALLY THERE.
 *
 * The one line that answers "if this database were wiped this afternoon, what
 * would come back" — so it **counts the directory**, not the row. The first
 * version of this finding read `kept` and `oldest` straight out of the newest
 * `snapshot.taken` row, and the F2 review proved what that is worth: delete every
 * copy from disk and the line still read green, "1 kept", for a full day, then
 * went amber for the wrong reason. A row says what a run once wrote. The
 * directory says what you have.
 *
 * Reading a directory listing writes nothing, so this is observer-safe.
 *
 * Amber, never red: a missing backup is not a broken memory, and a diagnostic
 * that shouts the same colour for both teaches its reader to read past the one
 * that matters.
 */
function snapshotFindings(input: DoctorInput, store: Store): Finding[] {
  const livedDay = store.livedDay();
  const resolved = resolveSnapshotsDir(input.dir, input.config.snapshots?.dir);
  const keep = keepOf(input.config.snapshots?.keep);
  // What the configuration could not read, said out loud rather than left as a
  // default nobody asked for (F2 review, MAJOR-2). It rides on every arm below.
  const ignored = input.config.snapshots?.ignored ?? [];
  const misread = ignored.length === 0 ? "" : ` — ${ignored.join("; ")}`;
  const data: Record<string, string | number | boolean | null> = {
    keep,
    where: resolved.reason,
    ignored: ignored.length === 0 ? null : ignored.join("; "),
  };
  if (resolved.dir === null) {
    // Not a fault and not a silence: this store is not the `store/` subdirectory
    // of a base directory, so there is nowhere by convention to put copies.
    return [
      finding(
        "snapshot",
        "amber",
        "Snapshots",
        `no daily snapshot is being taken: this store is not inside a base directory, so there is no default place to keep copies${misread}`,
        'Add "snapshots": { "dir": "<an absolute path outside the store>" } to the configuration.',
        data,
      ),
    ];
  }

  // THE DISK, FIRST. Everything printed below about how many copies there are
  // comes from here.
  const disk = readSnapshotsDir(resolved.dir);
  const onDisk = disk.names.length;
  const newest = disk.names[onDisk - 1] ?? null;
  const oldest = disk.names[0] ?? null;
  const future = futureNamesIn(disk.names, Date.parse(`${input.today}T00:00:00Z`)).length;
  // A correctly-named directory the layout rule does not recognise as a copy is
  // KEPT — this package never deletes what it cannot prove it made — but it is
  // never counted and never rotated either, so without this clause it would be
  // permanent, invisible residue in the one directory the owner relies on
  // (second F2 review, MAJOR-A).
  const strange =
    disk.unrecognised.length === 0
      ? ""
      : `; ${String(disk.unrecognised.length)} director${disk.unrecognised.length === 1 ? "y is" : "ies are"} named like snapshots but do not look like copies of a store, so they are not counted and will never be rotated: ${disk.unrecognised.slice(0, 3).join(", ")}${disk.unrecognised.length > 3 ? ` and ${String(disk.unrecognised.length - 3)} more` : ""}`;
  // PRE-ROWS COPIES ARE SAID, AND THEY ARE NOT A FAULT (review B, MAJOR-2 and
  // NIT-3/-4). After cut-over the owner's snapshots directory holds his old
  // floor's copies permanently: they are never rotated, because this build
  // cannot open one to know what is in it. That is the right outcome and it
  // must not read as a problem — a permanently amber Snapshot line is a line
  // people learn to skip. So it is a clause on the ordinary sentence, and the
  // grading below deliberately does not consider it.
  const older =
    disk.preRows.length === 0
      ? ""
      : `; ${String(disk.preRows.length)} older-format cop${disk.preRows.length === 1 ? "y" : "ies"} this build cannot open — kept, never rotated, read by the build tagged floor/v5-last: ${disk.preRows.slice(0, 3).join(", ")}${disk.preRows.length > 3 ? ` and ${String(disk.preRows.length - 3)} more` : ""}`;
  // The newest copy the store took before a schema migration, when there is
  // one: a clause, not a grade — it is the copy to roll an upgrade back to.
  const lastUpgrade = disk.preMigration[disk.preMigration.length - 1] ?? null;
  const upgrade = lastUpgrade === null ? "" : `; before the last schema upgrade: ${lastUpgrade}`;
  const held = {
    ...data,
    onDisk,
    newest,
    oldest,
    readable: disk.readable,
    future,
    unrecognised: disk.unrecognised.length,
    preRows: disk.preRows.length,
    preMigration: lastUpgrade,
  };

  const read = newestRows(store, SNAPSHOT_TAKEN_EVENT, 1, livedDay);
  const row = read.unknown ? undefined : read.rows[0];
  const rowDated = rowDate(row);

  // A ROW SAYS A COPY WAS MADE AND THE DIRECTORY HOLDS NONE. The loudest thing
  // this line can say, and the case the review proved read green.
  if (onDisk === 0 && (rowDated !== null || read.unknown)) {
    return [
      finding(
        "snapshot",
        "amber",
        "Snapshots",
        `${disk.readable ? "the snapshots directory is empty" : "the snapshots directory is missing or unreadable"} — but a snapshot.taken row says one was made${rowDated === null ? "" : ` on ${rowDated}`}. There is nothing to restore from.${strange}${upgrade}`,
        RESTORE_STEPS,
        { ...held, rows: 1 },
      ),
    ];
  }

  if (onDisk === 0) {
    // The same rule the row findings use: an absent copy is only evidence once a
    // boundary has been reached. On a fresh install there has been no worker run
    // to take a first one, and an amber there is decoration.
    const boundaries = newestRows(store, BOUNDARY_EVENT, 1, livedDay);
    const lived = boundaries.unknown || boundaries.rows.length > 0;
    const failed = newestRows(store, SNAPSHOT_FAILED_EVENT, 1, livedDay);
    const failedRow = failed.rows[0];
    const why =
      failedRow === undefined
        ? ""
        : ` — newest ${SNAPSHOT_FAILED_EVENT} ${rowDate(failedRow) ?? "?"} (${str(payloadOf(failedRow), "step") ?? "?"}: ${str(payloadOf(failedRow), "reason") ?? "?"})`;
    return [
      lived
        ? finding(
            "snapshot",
            "amber",
            "Snapshots",
            `no snapshot has ever been taken here${why}${strange}${upgrade}${misread}`,
            "The worker takes one after the sleep cycle; the next boundary should leave a snapshot.taken row.",
            { ...held, rows: 0 },
          )
        : finding(
            "snapshot",
            "green",
            "Snapshots",
            `no snapshot yet — and no boundary has been reached here yet${strange}${upgrade}${misread}`,
            "",
            { ...held, rows: 0 },
          ),
    ];
  }

  // Copies exist. Their own names carry the date, so the line does not depend on
  // a row at all — and when a row disagrees with the directory, it says so.
  const newestDate = (newest ?? "").slice(0, 10);
  // THE OLDEST COPY IS A `--json` FACT, NOT A SCREEN ONE (2026-09-22). "last
  // 2026-09-22, 2 kept" answers the question a person has; the oldest date only
  // matters when the rotation is being reasoned about, and `data.oldest` carries
  // it for whoever is doing that.
  const detail =
    `last ${newestDate}, ${onDisk} kept` +
    (keep === DEFAULT_KEEP ? "" : ` (keeping ${keep})`) +
    (future === 0 ? "" : `; ${future} dated in the future, holding a slot each`) +
    (rowDated !== null && rowDated > newestDate
      ? `; the newest snapshot.taken row says ${rowDated}, which is not on disk`
      : "") +
    strange +
    older +
    upgrade +
    misread;
  // Two or more calendar days back is a daily mechanism that has missed one, so
  // the boundary day itself is already amber.
  const stale = newestDate === "" || newestDate <= daysBefore(input.today, SNAPSHOT_STALE_DAYS);
  const disagrees = rowDated !== null && rowDated > newestDate;
  return [
    stale || disagrees || future > 0 || disk.unrecognised.length > 0 || ignored.length > 0
      ? finding(
          "snapshot",
          "amber",
          "Snapshots",
          stale ? `${detail} — ${SNAPSHOT_STALE_DAYS} days ago or more` : detail,
          stale
            ? "The copy is taken by the worker after a boundary; read the Spawn line below."
            : RESTORE_STEPS,
          held,
        )
      : finding("snapshot", "green", "Snapshots", detail, "", held),
  ];
}

// ── the two steps the user does BY HAND ─────────────────────────────

/**
 * DID THE HOOKS BLOCK AND THE MCP REGISTRATION ACTUALLY TAKE (finding 4).
 *
 * `install` prints those two and applies neither, correctly: they edit somebody
 * else's editor configuration. But nothing then checked them, so a user who
 * pasted the block into a project settings file instead of the user one — or
 * never restarted — got a fully green `doctor` and total silence. The failure
 * mode of this product is silence, which is the one thing a diagnostic exists
 * to break.
 *
 * **THE READ IS THE CALLER'S** (`cli/install.ts#readHost`), for the reason
 * `checkout` and `open` are: it is four small file reads outside this store, in
 * a format that belongs to the host, and the adapters here are leaves that do
 * not import each other. What comes in carries the host's own vocabulary —
 * which events were expected, what the server is called — so this file grades
 * and keeps nothing it would have to hold in step.
 *
 * AMBER, NEVER RED, and it always says which files it read: `~/.claude.json` is
 * the host's own state file, documented as one the host writes for itself, so a
 * negative answer here is "I looked at these and did not find it", never "you
 * did not install it".
 */
export interface HostReading {
  /** The events a full install covers, in the host's spelling. */
  readonly expected: readonly string[];
  /** Which of `expected` carry a command that looks like ours. */
  readonly events: readonly string[];
  /** Events whose command names a path that is not on disk — installed, and
   *  failing silently at every session start. */
  readonly stale: readonly { event: string; path: string }[];
  /** Every settings file this read actually opened and parsed. */
  readonly settingsRead: readonly string[];
  /** Files that exist and could not be opened or parsed — not the same fact as
   *  "there is no such file", and not something to stay quiet about. */
  readonly settingsUnreadable: readonly string[];
  /** True when the MCP server is registered at user scope. */
  readonly mcp: boolean;
  readonly mcpName: string;
  readonly mcpFile: string;
  /** The MCP file exists but could not be read or parsed. */
  readonly mcpUnreadable: boolean;
  /**
   * Whether a `claude` executable is on the PATH the caller would run
   * `counterparts connect` with (the go-public Phase C walk, 2026-09-23).
   * `false` only when a PATH was there to search and held none; absent or null
   * is "not looked", and the fix line stays `counterparts connect`.
   */
  readonly claudeOnPath?: boolean | null;
  /** The exact `claude mcp add …` line `connect` prints when it cannot run it. */
  readonly mcpAddLine?: string;
  /** The runtimes the hooks and the MCP registration launch us with
   *  (`cli/install.ts#readHost`); absent when not read. */
  readonly runtimes?: readonly {
    readonly exe: string;
    /** `binary`: the single compiled binary (`runtime.ts#Binary`). */
    readonly kind: "bun" | "node" | "binary";
    readonly present: boolean;
    readonly used: readonly string[];
    /** Of `used`, the commands that let Bun read the project's `.env` or
     *  `bunfig.toml` (wired before `--no-env-file` and an empty `--config=`);
     *  absent on a reading that predates the field. */
    readonly projectEnv?: readonly string[];
  }[];
  /** The runtime this console is running under (`runtime.ts#runtimeLabel`). */
  readonly consoleRuntime?: string;
  /** The Counterparts Claude Code plugin, when Claude Code records it
   *  installed (`host-wiring.ts#pluginInstall`); absent or null when not. */
  readonly plugin?: PluginInstallRead | null;
}

/** How a Runtime row names where a command was wired: `desktop` is Claude
 *  Desktop's `counterparts` entry (`cli/install.ts#readHost`, 2026-10-10).
 *  It is read after "the" ("the Claude Desktop server was wired…"), so no
 *  possessive (review of #354). */
function useLabel(use: string): string {
  return use === "desktop" ? "Claude Desktop server" : use;
}

/** Claude Code's hooks and registration first, Claude Desktop's entry last. */
function byUse(a: string, b: string): number {
  return Number(a === "desktop") - Number(b === "desktop") || a.localeCompare(b);
}

/**
 * WHICH RUNTIME the host starts us with (2026-10-01, Node support): Bun or
 * Node, read off the commands `install` wrote, and whether that executable is
 * still there. A runtime that has gone — a removed Node version manager entry,
 * a Bun moved — fails every hook silently, exactly like a stale script path,
 * and is graded the same: amber, with `connect` (run under the runtime you
 * want) as the fix, since it rewrites the commands with the runtime running it.
 * Quiet when nothing of ours is configured: the Claude Code line says that.
 */
function runtimeFindings(reading: HostReading): Finding[] {
  const rows = reading.runtimes ?? [];
  if (rows.length === 0) return [];
  const said = rows
    .map((r) => `${r.used.map(useLabel).join(" and ")} ${r.kind === "binary" ? "run as the single binary" : `run under ${r.kind}`} (${r.exe})`)
    .join("; ");
  // CLAUDE DESKTOP rewrites its own config file while it is open, so `connect`
  // leaves Desktop's entry alone until it is quit (`cli/desktop.ts#repairDesktop`):
  // any fix that has to reach that entry says so first.
  const quitDesktop = (uses: readonly string[]): string =>
    uses.includes("desktop") ? "Quit Claude Desktop first (it rewrites its config file while it runs). " : "";
  const reopenDesktop = (uses: readonly string[]): string => (uses.includes("desktop") ? " and reopen Claude Desktop" : "");
  const console_ = reading.consoleRuntime === undefined ? "" : `; this console is ${reading.consoleRuntime}`;
  const data: Record<string, string | number | boolean | null> = {
    runtimes: rows.map((r) => `${r.kind}:${r.exe}:${r.present ? "present" : "missing"}`).join(","),
    console: reading.consoleRuntime ?? null,
  };
  const missing = rows.filter((r) => !r.present);
  // WIRED BEFORE `--no-env-file` AND `--config=<empty-bunfig.toml>`
  // (2026-10-09): Bun loads the project's `.env` into every hook and server it
  // starts there, so a project could name another store, and runs its
  // `bunfig.toml` preload inside them. A command missing EITHER flag counts,
  // so one `connect` closes both. Amber, because it is a hole and not a fault:
  // everything still runs, and `connect` rewrites the commands (it repairs an
  // entry that is ours in an older shape).
  const readsEnv = rows.flatMap((r) => r.projectEnv ?? []);
  data["projectEnv"] = readsEnv.length === 0 ? "ignored" : [...new Set(readsEnv)].sort().join(",");
  if (missing.length === 0 && readsEnv.length > 0) {
    const what = [...new Set(readsEnv)].sort(byUse).map(useLabel).join(" and ");
    return [
      finding(
        "runtime",
        "amber",
        "Runtime",
        `${said}${console_}; the ${what} ${what.includes(" and ") ? "were" : "was"} wired before Counterparts told Bun to skip a project's .env and bunfig.toml, so a project whose .env sets COUNTERPARTS_DATA_DIR or COUNTERPARTS_CONFIG could point them at another memory, and its bunfig.toml could run its own code inside them`,
        `${quitDesktop(readsEnv)}Run: counterparts connect — it rewrites the commands with --no-env-file and an empty --config${readsEnv.includes("desktop") ? ", Claude Desktop's entry included" : ""}. Then restart Claude Code${reopenDesktop(readsEnv)}.`,
        data,
      ),
    ];
  }
  if (missing.length === 0) return [finding("runtime", "green", "Runtime", `${said}${console_}`, "", data)];
  return [
    finding(
      "runtime",
      "amber",
      "Runtime",
      `${missing.map((r) => r.exe).join(", ")} ${missing.length === 1 ? "is" : "are"} not there, so nothing that runs under ${missing.length === 1 ? "it" : "them"} fires; ${said}${console_}`,
      // `counterparts` itself runs under bun whenever bun is on PATH (the
      // launcher prefers it), so "run it under the runtime you want" would be
      // advice nobody can follow for Node. The explicit Node line is printed.
      `${quitDesktop(missing.flatMap((r) => r.used))}Run: counterparts connect — it rewrites them with the runtime it runs under (bun when bun is on PATH, else Node). To wire Node with bun also installed: node --import "${NODE_HOOKS}" "${CLI_SCRIPT}" connect. Then restart Claude Code${reopenDesktop(missing.flatMap((r) => r.used))}.`,
      data,
    ),
  ];
}

/** What the console read of Claude Desktop's config (`cli/desktop.ts#readDesktop`). */
export interface DesktopReading {
  readonly path: string;
  readonly state: "absent" | "no-entry" | "entry" | "unreadable";
  /** The store Desktop's `counterparts` entry names, or null. */
  readonly dataDir: string | null;
  /** Claude Code's own registration names `counterparts` too — the Code-tab clash. */
  readonly codeTab: boolean;
  /** The store Claude Code's registration names, or null. */
  readonly codeDataDir: string | null;
}

/**
 * THE CLAUDE DESKTOP LINE (2026-09-30, brief item 8): whether its config entry
 * is present, and when the last Desktop wake and session were. QUIET when there
 * is no entry — Desktop is optional — and never amber for that. Amber only for
 * an entry that is there and names another store than this one, directly or
 * through the Code tab's name clash (`cli/desktop.ts`'s header). Desktop
 * sessions are named as NOT MEASURED for write-ups: nothing is captured there,
 * so there is no stretch to count as written up or not — never as lost.
 */
function desktopFindings(reading: DesktopReading, store: Store | null, dir: string): Finding[] {
  if (reading.state === "absent" || reading.state === "no-entry") return [];
  const data: Record<string, string | number | boolean | null> = {
    path: reading.path,
    state: reading.state,
    dataDir: reading.dataDir,
    codeTab: reading.codeTab,
    codeDataDir: reading.codeDataDir,
  };
  if (reading.state === "unreadable") {
    return [
      finding(
        "desktop",
        "green",
        "Claude Desktop",
        `${reading.path} could not be read as JSON, so whether Counterparts is connected there is not known`,
        "",
        data,
      ),
    ];
  }
  const same = (a: string | null, b: string | null): boolean => a === null || b === null || sameScope(a, b);
  const fix = "Run: counterparts install --host claude-desktop — then quit and reopen Claude Desktop.";
  if (!same(reading.dataDir, dir)) {
    return [
      finding(
        "desktop",
        "amber",
        "Claude Desktop",
        `connected, but its entry names a different store (${reading.dataDir ?? "?"}) from this one (${dir})`,
        fix,
        data,
      ),
    ];
  }
  if (reading.codeTab && !same(reading.dataDir, reading.codeDataDir)) {
    return [
      finding(
        "desktop",
        "amber",
        "Claude Desktop",
        `Desktop's Code tab gets its counterparts tools from Desktop's entry, which shadows ~/.claude.json's, and the two name different stores (${reading.dataDir ?? "?"} and ${reading.codeDataDir ?? "?"})`,
        fix,
        data,
      ),
    ];
  }
  // WHEN IT LAST WOKE, AND WHAT IS LIVE — one meta read and the registry's week.
  const zone = store?.zone() ?? "UTC";
  let lastWake: number | null = null;
  try {
    const raw = store?.getMeta(DESKTOP_WAKE_KEY);
    lastWake = raw === undefined || raw === null || !Number.isFinite(Number(raw)) ? null : Number(raw);
  } catch {
    lastWake = null;
  }
  const desktop = listSessions(dir).filter((r) => hostOf(r) === DESKTOP_HOST);
  const lastSession = desktop[0]?.lastBoundaryAt ?? null;
  data["lastWake"] = lastWake;
  data["lastSession"] = lastSession;
  data["sessions"] = desktop.length;
  const parts = [
    `connected (${reading.path.split("/").pop() ?? reading.path})`,
    lastWake === null ? "no wake yet" : `last wake ${localStamp(lastWake, zone)}`,
    ...(lastSession === null ? [] : [`last session active ${localStamp(lastSession, zone)}`]),
    ...(desktop.length === 0
      ? []
      : [`${String(desktop.length)} Desktop ${desktop.length === 1 ? "session" : "sessions"} this week, not measured for write-ups (Desktop chat keeps no transcript)`]),
    // Measured 2026-10-01: the Code tab's counterparts tools are Desktop's
    // server, which serves a Code-tab session when the call names its id.
    ...(reading.codeTab ? ["its Code tab's counterparts tools come from this entry's server, which shadows ~/.claude.json's — both name this store, and Code-tab sessions pass their session id"] : []),
  ];
  // SAID, NOT MEASURED (2026-10-02): Desktop asks before each tool until its
  // tools are set to Always allow, and a chat whose tools still ask never
  // called `wake`. Nothing on disk says which, so the line says it every time.
  parts.push("set its counterparts tools to Always allow, or a chat cannot wake on its own (not measurable from here)");
  return [finding("desktop", "green", "Claude Desktop", parts.join("; "), "", data)];
}

function hostFindings(reading: HostReading): Finding[] {
  const total = reading.expected.length;
  const missing = reading.expected.filter((e) => !reading.events.includes(e));
  const stale = reading.stale;
  const where = [
    reading.settingsRead.length === 0
      ? "no host settings file was readable"
      : `read ${reading.settingsRead.join(", ")}`,
    // AN UNREADABLE FILE IS SAID OUT LOUD. Dropping it silently is how a
    // mode-000 settings file reads as an absent one, and the reader is then
    // told to paste a block they have already pasted.
    reading.settingsUnreadable.length === 0
      ? ""
      : `could not read ${reading.settingsUnreadable.join(", ")}`,
  ]
    .filter((s) => s.length > 0)
    .join("; ");
  const data: Record<string, string | number | boolean | null> = {
    events: reading.events.join(","),
    missing: missing.join(","),
    stale: stale.map((s) => `${s.event}→${s.path}`).join(","),
    settingsRead: reading.settingsRead.join(","),
    settingsUnreadable: reading.settingsUnreadable.join(","),
    mcp: reading.mcp,
    mcpFile: reading.mcpFile,
  };
  // THE PLUGIN (prototype, 2026-10-09). A plugin install wires nothing in
  // these files — Claude Code loads its hooks and server from the plugin — so
  // without this the line told a plugin user "no hook of ours is connected,
  // run counterparts connect", which would wire the host twice. Enabled and
  // alone: connected. Enabled beside live npm wiring: the plugin stands down
  // (`adapters/plugin.ts`), which works, and is said, with both ways out.
  const plugin = reading.plugin !== undefined && reading.plugin !== null && reading.plugin.enabled ? reading.plugin : null;
  data["plugin"] = plugin === null ? null : plugin.id;
  const npmAny = reading.events.length > 0 || reading.mcp;
  if (plugin !== null && !npmAny) {
    return [
      finding(
        "host",
        "green",
        "Claude Code",
        `connected as the Claude Code plugin (${plugin.id}${plugin.version === null ? "" : ` ${plugin.version}`}): its ${String(total)} hooks and the memory tools load from the plugin`,
        "",
        data,
      ),
    ];
  }
  const twiceClause =
    plugin === null ? "" : `ALSO installed as the Claude Code plugin (${plugin.id}), which stands down while this wiring is live`;
  const twiceFix =
    plugin === null
      ? ""
      : `Installed twice: to keep only the plugin, run \`counterparts disconnect\` and restart Claude Code; to keep only this install, run \`claude plugin uninstall ${plugin.id}\`. Same memory either way.`;
  const mcpClause = reading.mcp
    ? `the MCP server is registered in ${reading.mcpFile}`
    : reading.mcpUnreadable
      ? `${reading.mcpFile} could not be read, so the MCP registration could not be checked`
      : `no MCP server named "${reading.mcpName}" in ${reading.mcpFile}`;

  if (missing.length === 0 && stale.length === 0 && reading.mcp) {
    if (plugin !== null) {
      return [finding("host", "amber", "Claude Code", `connected: ${String(total)} hooks and the memory tools; ${twiceClause}`, twiceFix, data)];
    }
    // THE ONE LINE THE PERSON CAME FOR: is my assistant joined up to this
    // memory? It says `connected` because that is the verb the command has
    // (`counterparts connect`), and it names the two halves — the hooks and the
    // tools — rather than a file format nobody asked about. `--json` still
    // carries every event name and every path in `data`.
    return [
      finding(
        "host",
        "green",
        "Claude Code",
        `connected: ${String(total)} hooks and the memory tools`,
        "",
        data,
      ),
    ];
  }
  // THE FIX IS `connect` NOW, NOT `install` (2026-09-21, A; renamed from `wire`
  // 2026-09-22). Until that change the only thing the package could do about a
  // missing hook was PRINT a block, so the fix line sent a reader to the command
  // that prints it and then asked them to paste. `counterparts connect` does the
  // paste: it backs the file up, merges beside whatever else is on those events,
  // and repairs an entry of ours that names a path that has moved — which is
  // precisely the `stale` case below. A fix line that names the longer way round
  // is a fix line somebody follows.
  //
  // ONE SENTENCE, whatever is wrong: the three cases below were three separate
  // fix lines that each began "Run: counterparts connect", and a reader with
  // two of them was told to run the same command twice.
  const does: string[] = [];
  if (missing.length > 0) does.push("adds the hooks beside anything already there");
  if (stale.length > 0) {
    does.push(
      `replaces the ${stale.length === 1 ? "stale entry" : "stale entries"} with the path this install actually has`,
    );
  }
  // `connect` REGISTERS THE MEMORY TOOLS BY RUNNING `claude mcp add` — so with
  // no `claude` on the PATH, "Run: counterparts connect" names the very command
  // that just failed to register them (go-public Phase C walk, 2026-09-23). In
  // that one case the fix is the line `connect` itself prints: run it wherever
  // `claude` works. The hooks half, if it is owed, is still `connect`'s.
  const cannotRegister =
    !reading.mcp && !reading.mcpUnreadable && reading.claudeOnPath === false && reading.mcpAddLine !== undefined;
  if (!reading.mcp && !reading.mcpUnreadable && !cannotRegister) does.push("registers the memory tools");
  const byHand = cannotRegister
    ? `\`claude\` is not on this PATH, so \`counterparts connect\` cannot register the memory tools: run this where \`claude\` works — ${reading.mcpAddLine ?? ""} — then restart Claude Code.`
    : "";
  const fixes = [
    ...(does.length === 0
      ? []
      : [
          `Run: counterparts connect — it backs up ~/.claude/settings.json, ${
            does.length === 1 ? does[0] : `${does.slice(0, -1).join(", ")} and ${does[does.length - 1] ?? ""}`
          }.${cannotRegister ? "" : " Then restart Claude Code."}`,
        ]),
    ...(byHand.length === 0 ? [] : [byHand]),
  ];
  // STALE FIRST. "GREEN while nothing fires" is the one outcome this line was
  // added to prevent, and a block pointing at a deleted checkout is exactly
  // that: it matches, it is installed, and every session start fails silently.
  const staleClause =
    stale.length === 0
      ? ""
      : `${stale.map((s) => s.event).join(", ")} point${stale.length === 1 ? "s" : ""} at ${stale
          .map((s) => s.path)
          .join(", ")}, which is not there`;
  const connected =
    missing.length === total
      ? `no hook of ours is connected on any of the ${String(total)} events`
      : missing.length > 0
        ? `connected on ${reading.events.join(", ")} but NOT on ${missing.join(", ")}`
        : `all ${String(total)} hook events are connected`;
  const detail = [staleClause, connected, `(${where})`, mcpClause, twiceClause]
    .filter((s) => s.length > 0)
    .join("; ")
    .replace("; (", " (");
  return [finding("host", "amber", "Claude Code", detail, [...fixes, ...(twiceFix.length === 0 ? [] : [twiceFix])].join(" "), data)];
}

// ── the reading ─────────────────────────────────────────────────────────────

const RANK: Record<Severity, number> = { red: 0, amber: 1, green: 3 };

/**
 * FOUR TIERS, THREE SEVERITIES. `OFF` sits between the ambers and the greens:
 * it is not a warning (nothing is wrong) and it is not a pass (the feature is
 * not running), and a real amber — a stale snapshot, a failed phase — must
 * never print BELOW a line saying an optional extra was never switched on.
 * The tier is computed here, once, because `reportLines`, `reportJson`, the
 * terminal renderer and the notice all read their order through this function.
 */
export function tierOf(f: Finding): number {
  return f.severity === "amber" && f.optional === true ? 2 : RANK[f.severity];
}

/** Worst first, stable within a tier — the order the report and the notice
 *  both read. */
export function worstFirst(findings: readonly Finding[]): Finding[] {
  return [...findings]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => tierOf(a.f) - tierOf(b.f) || a.i - b.i)
    .map((x) => x.f);
}

/** The four words a grade is printed as. `OFF` is dim wherever there is
 *  colour; in plain text it is just the word, which is the point (§2.4 — an
 *  absence is displayed, never merely un-highlighted). */
export type GradeWord = "RED" | "AMBER" | "OFF" | "GREEN";

export function gradeWord(f: Finding): GradeWord {
  return f.severity === "amber" && f.optional === true ? "OFF" : (f.severity.toUpperCase() as GradeWord);
}

/** How many of each word are in a reading — the summary's own arithmetic, and
 *  `--json`'s, from one place so the two cannot disagree. */
export function tally(findings: readonly Finding[]): Record<Lowercase<GradeWord>, number> {
  const out = { red: 0, amber: 0, off: 0, green: 0 };
  for (const f of findings) out[gradeWord(f).toLowerCase() as Lowercase<GradeWord>] += 1;
  return out;
}

/**
 * `0 red, 0 amber, 2 off, 5 green.` — the summary, from a tally.
 *
 * The `off` term appears only when something IS off: a store with both keys in
 * place should not be told about a column it has nothing in. "Nothing to fix."
 * is gone with the owner's answer 12 — the counts are the one line he reads to
 * the end, and a sentence that replaced them made the two arms of this report
 * say different things about the same store.
 */
export function summaryLine(t: Record<Lowercase<GradeWord>, number>): string {
  return (
    `${String(t.red)} red, ${String(t.amber)} amber` +
    (t.off === 0 ? "" : `, ${String(t.off)} off`) +
    `, ${String(t.green)} green.`
  );
}

/**
 * THE READING. Pure over its input, worst first, and never a write.
 *
 * Groups run cheapest-and-most-diagnostic first, and the budget is checked
 * BETWEEN them: the config and the counters are answered before
 * anything walks the event log, so a reading that runs out of time still carries
 * I32's own signature.
 */
export function doctorFindings(input: DoctorInput): Finding[] {
  readingZone = resolveZone(input.config.timeZone);
  const now = input.now ?? ((): number => Date.now());
  const deadline = input.budgetMs === undefined ? null : now() + input.budgetMs;
  const unread = input.configReason === "not-read";
  // ONE BOUNDED READ, before anything else touches the store: whether this
  // store has ever embedded decides `OFF` from amber on the Recall line
  // (finding 1, finding #24). Not when no configuration was read: the Config
  // line above has already said so.
  const history = unread ? { embedded: false } : keyHistory(input.store);
  // THE EMBEDDER THE HOOKS WILL ACTUALLY RUN (config.ts#resolveEmbedder): an
  // absent block is the local table. Resolved HERE, so the lines agree with
  // the hooks whether or not the caller already applied the default — and not
  // at all when no configuration was read.
  const embedderSource = unread ? "explicit" : resolveEmbedder(input.config).source;
  if (!unread) input = { ...input, config: withEmbedderDefault(input.config) };
  const out: Finding[] = [
    ...configFindings(input),
    ...(unread ? [] : embedderFindings(input, history, embedderSource)),
    // Already READ by the caller (the git calls are its own bounded business),
    // so this costs nothing here and is answered before any store read.
    ...(input.checkout === undefined ? [] : checkoutFindings(input.checkout)),
    // Read by the caller for the same reason, and answered beside the `Store`
    // line it qualifies: "there is a store here" and "it opens" are two facts.
    ...(input.open === undefined ? [] : openFindings(input.open)),
    // A rollback's hold (2026-10-11): one file read, and only when it is there.
    ...rollbackFindings(input.dir),
    // DID THE HOST STEPS TAKE (finding 4). Also read by the caller — it is four
    // small file reads outside this store, and the hook does not pay for them.
    ...(input.host === undefined ? [] : hostFindings(input.host)),
    ...(input.host === undefined ? [] : runtimeFindings(input.host)),
    // CLAUDE DESKTOP (2026-09-30): its config entry, and when it last woke.
    ...(input.desktop === undefined ? [] : desktopFindings(input.desktop, input.store, input.dir)),
  ];
  const store = input.store;
  if (store === null) return worstFirst(out);

  // The sessions awaiting a write-up: read at most once, and only outside the
  // session-start reading (it walks every scope's captured words).
  const owedAllowed = !unread && input.budgetMs === undefined;
  let owedCache: { value: OwedReading | "failed" } | null = null;
  const owedReading: OwedSource = () => {
    if (!owedAllowed) return null;
    owedCache ??= { value: readOwed(store, input.today) };
    return owedCache.value;
  };
  const groups: (readonly [string, () => Finding[]])[] = [
    ["spawn", () => spawnFindings(input, store)],
    ["clock", () => clockFindings(input, store)],
    ["rows", () => rowFindings(input, store)],
    ["authorship", () => authorshipFindings(input, store, owedReading)],
    ["journal", () => journalFindings(store)],
    ["vectors", () => vectorFindings(input, store)],
    // The snapshot policy lives in the configuration, so with none read this
    // line would grade a default nobody chose.
    ...(unread ? [] : [["snapshot", (): Finding[] => snapshotFindings(input, store)] as const]),
    ["self-page", () => selfPageFindings(store)],
    ["page-writer", () => pageWriterFindings(store, input.config)],
    // C2's one line, `Write-ups` since 2026-09-30. Not in the session-start
    // reading: it is never red, which is all that notice prints, and it reads
    // every scope's captured words.
    ...(unread || input.budgetMs !== undefined
      ? []
      : [["crash-write-up", (): Finding[] => crashWriteUpFindings(input, store, owedReading)] as const]),
    // F6: silent unless a copy failure is standing. Two bounded event reads.
    ["journal-copy", () => journalCopyFindings(store)],
    // The process log (2026-09-30): one directory listing and today's file.
    // Not in the session-start reading: it is never red, and it reads a file.
    ...(input.budgetMs !== undefined ? [] : [["log", (): Finding[] => logFindings(input)] as const]),
    // B3's week: one bounded read of the newest `remember.prune` row. Folds into
    // `Background` while green.
    ["retention", () => retentionFindings(input, store)],
    // The v8 upgrade's proof (2026-09-26): two meta reads. Silent on a store
    // born at v8. Folds into `Background` while green.
    ["upgrade-v8", () => upgradeV8Findings(store)],
    // Dreaming (2026-09-26): informational — last dreamed, and today's ask.
    ["dreaming", () => dreamingFindings(input, store)],
    // The headless nightly run (2026-09-29): one meta read.
    ["night-run", () => nightRunFindings(input, store)],
    // v9 (2026-09-27): what the upgrade carried, and the reflection.
    ["upgrade-v9", () => upgradeV9Findings(store)],
    ["reflection", () => reflectionFindings(input, store)],
    // v10 (2026-09-29): what the upgrade carried, and the week's contradictions.
    ["upgrade-v10", () => upgradeV10Findings(store)],
    ["upgrade-v11", () => upgradeV11Findings(store)],
    // v12 (2026-10-03): the writer's three fields, and the subject links. Two aggregates.
    ["write-fields", () => writeFieldFindings(store)],
    // 2026-10-10: the old-claims era — on or off, and how many it reads at today's default (lower, higher).
    ["claims-era", () => claimsEraFindings(store)],
    ["recognition-lane", () => recognitionLaneFindings(store)],
    ["contradictions", () => contradictionFindings(store)],
    // Build B (2026-09-28): does anyone read what an index offers in part?
    ["lookups", () => lookupFindings(store)],
    // 2026-10-02: what reached the model — results past the ceiling, parts never read.
    ["results", () => resultFindings(store)],
    // 2026-10-02: whether the wake reached the session whole (`adapter.wake.delivered`).
    ["wake", () => wakeArrivalFindings(store)],
    // 2026-10-09: two wirings live, the second held off by the per-event claim.
    ["claim", () => claimFindings(store, input.host?.plugin ?? null)],
    // Association build 1 (2026-09-28): what spreading did, and the edges.
    ["association", () => associationFindings(store)],
    // LAST, and deliberately: it is the widest read here — the whole event log,
    // plus a pass over the ids for the table probes — so when the console's
    // reading is cut short this is the group that goes, and the `Budget` finding
    // below says so rather than leaving a silent gap. A budgeted reading does
    // not take it at all; see `firedFindings`.
    ["fired", () => firedFindings(input, store)],
  ];
  const skipped: string[] = [];
  for (const [name, read] of groups) {
    if (deadline !== null && now() > deadline) {
      skipped.push(name);
      continue;
    }
    out.push(...read());
  }
  if (skipped.length > 0) {
    out.push(
      finding(
        "budget",
        "amber",
        "Budget",
        `the session-start reading stopped after ${String(input.budgetMs)} ms and did not read: ${skipped.join(", ")}`,
        "Run: counterparts doctor — the console reads without a budget.",
        { skipped: skipped.join(","), budgetMs: input.budgetMs ?? 0 },
      ),
    );
  }
  return worstFirst(out);
}

// ── rendering ───────────────────────────────────────────────────────────────

/** How far back the line counts lapses, in days. */
export const WRITE_UP_LAPSE_WINDOW_DAYS = 7;

/**
 * WRITE-UPS (2026-09-30; before it, #192's `Crash write-up`, whose key it
 * keeps) — what is not written up, read off `core/coverage/`'s ledger.
 *
 * It says yesterday's state: how many sessions captured something that date
 * and how much of it is written up; how many sessions owe a write-up now; and
 * how many stretches lapsed in the last week. AMBER when a stretch from
 * yesterday or earlier is owed — the next session in that project is pointed
 * at it, so one still owed the morning after is one whose project nobody has
 * opened. Never red: nothing is deleted while a stretch is owed, and a lapse
 * deletes nothing either. The two ambers #192 added for the pointer itself —
 * deferred for room, and a session finished here waiting on another project —
 * are kept as they were.
 */
/** The ledger and the plan, read once per reading and shared by the
 *  `Write-ups` and `Authorship` lines. */
interface OwedReading {
  readonly spans: SpanBuffer;
  readonly plan: ReturnType<typeof writeUpPlan>;
  readonly entries: readonly LedgerEntry[];
  readonly now: number;
  /** Sessions that owe a write-up the pointer can offer (`coverage/`'s rule). */
  readonly waiting: number;
  /** ...of which the stretch is from yesterday or earlier. */
  readonly stale: number;
  /** Small debts the pointer never offers (no registry record, or not a
   *  person's session): they owe, and lapse with their days of use. */
  readonly unpointed: number;
}

/** `failed` when it cannot be read. It reads every scope's captured words, so
 *  the budgeted session-start reading never calls it. */
function readOwed(store: Store, today: string): OwedReading | "failed" {
  try {
    const now = store.now();
    // READ-ONLY by construction: an observer buffer writes nothing, and it
    // is the ledger's own reader that opens the files.
    const spans = new SpanBuffer({ dir: store.dir, observer: true, now: () => now });
    const plan = writeUpPlan({ store, spans });
    const zone = store.zone();
    const host = hostSessionEvidence(store);
    const entries = ledger(spans, { now, zone, host: (s) => ({ endedAt: host(s).endedAt }) });
    const all = entries.filter((e) => e.owed);
    const owed = all.filter((e) => pointable(e, store.dir));
    const stale = owed.filter((e) => e.stretch !== null && localDate(e.stretch.lastAt, zone) < today).length;
    return { spans, plan, entries, now, waiting: owed.length, stale, unpointed: all.length - owed.length };
  } catch {
    return "failed";
  }
}

/** The shared owed reading as a line asks for it: `null` when this reading
 *  does not take it (the budgeted session-start reading). */
type OwedSource = () => OwedReading | "failed" | null;

function crashWriteUpFindings(input: DoctorInput, store: Store, owedReading: OwedSource): Finding[] {
  const title = "Write-ups";
  const yesterday = isDay(input.today) ? addDays(input.today, -1) : input.today;
  let waiting: number | null = null;
  let stale = 0;
  let unpointed = 0;
  let yesterdayWords = "";
  let yesterdayData: { sessions: number; pieces: number; written: number } | null = null;
  /** Sessions FINISHED in one project and waiting on words they left in
   *  another (the door's `written-up-here`), stale ones first. */
  const shares: { session: string; here: string; elsewhere: string[]; stale: boolean }[] = [];
  try {
    const reading = owedReading();
    if (reading === null || reading === "failed") throw new Error("owed reading unavailable");
    const { spans, plan, entries } = reading;
    waiting = reading.waiting;
    stale = reading.stale;
    unpointed = reading.unpointed;
    // YESTERDAY, keyed on the pieces' own dates in the store's zone.
    const day = entries
      .map((e) => e.perDate[yesterday])
      .filter((c): c is { pieces: number; written: number } => c !== undefined);
    yesterdayData = {
      sessions: day.length,
      pieces: day.reduce((n, c) => n + c.pieces, 0),
      written: day.reduce((n, c) => n + c.written, 0),
    };
    yesterdayWords =
      day.length === 0
        ? `yesterday (${yesterday}): nothing captured`
        : `yesterday (${yesterday}): ${String(day.length)} session${day.length === 1 ? "" : "s"}, ` +
          `${String(yesterdayData.written)} of ${String(yesterdayData.pieces)} pieces written up`;
    // CLAUDE DESKTOP'S CHATS ARE UNMEASURED, NEVER LOST (2026-10-01, as
    // `counterparts coverage` says them): nothing is captured there, so the
    // ledger holds nothing for them to owe.
    const zoneY = store.zone();
    const desk = listSessions(store.dir).filter(
      (r) => hostOf(r) === DESKTOP_HOST && (localDate(r.startedAt, zoneY) === yesterday || localDate(r.lastBoundaryAt, zoneY) === yesterday),
    ).length;
    if (desk > 0) yesterdayWords += `, and ${String(desk)} Claude Desktop chat${desk === 1 ? "" : "s"} (unmeasured: no transcript)`;
    const progress = readWriteUpProgress(store);
    for (const [key, p] of Object.entries(progress)) {
      if (p.waiting !== true) continue;
      const bar = key.indexOf("|");
      const session = key.slice(0, bar);
      const here = key.slice(bar + 1);
      const h = plan.find((x) => x.session === session);
      if (h === undefined || !h.owes) continue;
      const elsewhere = h.scopes.filter(
        (scope) =>
          !sameScope(scope, here) &&
          progress[progressKey(session, scope)]?.waiting !== true &&
          writeUpEntries(spans, { session, scopes: [scope] }).length > 0,
      );
      if (elsewhere.length === 0) continue;
      const e = entries.find((x) => x.session === session);
      const from = e?.stretch === null || e === undefined ? input.today : localDate(e.stretch.lastAt, store.zone());
      shares.push({ session, here, elsewhere, stale: from < input.today });
    }
    shares.sort((a, b) => Number(b.stale) - Number(a.stale));
  } catch {
    waiting = null;
  }
  const lapses = lapsesSince(store, store.now() - WRITE_UP_LAPSE_WINDOW_DAYS * 86_400_000).length;
  const owedWords =
    waiting === null
      ? "could not read what is written up"
      : waiting === 0
        ? "nothing owed"
        : `${String(waiting)} session${waiting === 1 ? " owes" : "s owe"} a write-up` +
          (stale === 0 ? "" : `, ${String(stale)} from yesterday or earlier`);
  // THE NIGHTLY RUN'S CATCH-UP (2026-10-01): its newest row, within two days.
  let night: ReturnType<typeof catchUpOf> = null;
  try {
    const cu = catchUpOf(store);
    night = cu !== null && store.now() - cu.at < 2 * 86_400_000 ? cu : null;
  } catch {
    night = null;
  }
  const nightWords =
    night === null ? "" : `the nightly run (${localDate(night.at, store.zone())}): ${night.state === "none-granted" || night.state === "could-not-start" ? catchUpWords(night) : `wrote up ${String(night.written)} of ${String(night.granted)}`}`;
  const detail =
    [
      yesterdayWords,
      nightWords,
      owedWords,
      unpointed === 0 ? "" : `${String(unpointed)} small, not a person's session: left to lapse`,
      lapses === 0 ? "" : `${String(lapses)} lost unwritten this week`,
    ]
      .filter((w) => w.length > 0)
      .join("; ");
  const pointer = readWriteUpPointer(store);
  const data = {
    mode: "next-session",
    waiting,
    stale,
    unpointed,
    lapsedWeek: lapses,
    yesterday,
    yesterdaySessions: yesterdayData?.sessions ?? null,
    yesterdayPieces: yesterdayData?.pieces ?? null,
    yesterdayWritten: yesterdayData?.written ?? null,
    pointer: pointer?.outcome ?? null,
    pointerDate: pointer?.date ?? null,
    nightWrittenUp: night?.written ?? null,
    nightLeftOwed: night?.left ?? null,
  };
  // THE POINTER IS NOT GETTING OUT (PR #192 review, MAJOR 1 and m4): opening a
  // session there would only defer again, so the advice says why and by how much.
  if (pointer !== null && pointer.outcome === "deferred" && (waiting ?? 0) > 0) {
    const short = Math.max(0, pointer.need - pointer.room);
    // WHAT TOOK THE ROOM, named (review of #285, M3): beside a full wake the
    // first-launch question or a plain reminder can be what left the pointer
    // no room — and then the wake's budget is not the thing to lower.
    const beside = pointer.beside ?? "";
    const cap =
      pointer.limit !== undefined && pointer.limit !== TUNABLES.HOST_OUTPUT_CHARS
        ? `the ${pointer.limit.toLocaleString("en-US")}-character envelope that carries today's reminders`
        : "the host's 10,000-character cap";
    const why =
      pointer.reason === "host-cap"
        ? `the pointer did not fit on ${pointer.date}: it needs ${String(pointer.need)} bytes and the wake${beside.length === 0 ? "" : ` and ${beside}`} left ${String(Math.max(0, pointer.room))} under ${cap} (${String(short)} short)`
        : `the pointer could not be recorded on ${pointer.date} (${pointer.reason ?? "unknown"})`;
    const hostCapFix =
      beside.length === 0
        ? `The wake is too full: lower "injectionBudgetBytes" in ${tilde(input.configPath)} by ${String(short)} or more.`
        : `It was ${beside} beside the wake that took the room that morning, not the wake alone; the pointer is offered again at the next session start with room. If it keeps deferring, lower "injectionBudgetBytes" in ${tilde(input.configPath)} by ${String(short)} or more.`;
    return [
      finding(
        "crash-write-up",
        "amber",
        title,
        `${detail} — ${why}`,
        pointer.reason === "host-cap"
          ? hostCapFix
          : "The session registry under the store could not be written; read the Store line.",
        data,
      ),
    ];
  }
  // A SHARE WAITING ON ANOTHER PROJECT (re-review, m-C): name the project, and
  // say the session is finished here — opening a session HERE does nothing.
  const share = shares.find((x) => x.stale);
  if (share !== undefined) {
    const where = share.elsewhere.map((x) => tilde(x)).join(", ");
    return [
      finding(
        "crash-write-up",
        "amber",
        title,
        `${detail} — session ${share.session} is finished in ${tilde(share.here)} and waiting on words it left in ${where}` +
          (shares.length > 1 ? ` (${String(shares.length)} such sessions)` : ""),
        `Open a session in ${where}: its start points at the rest. A directory set off never will, and there is no command yet to close a session by hand.`,
        { ...data, sharesWaiting: shares.length },
      ),
    ];
  }
  if (stale > 0) {
    return [
      finding(
        "crash-write-up",
        "amber",
        title,
        detail,
        "Open a session in the project each one is in: its start points at the oldest. counterparts coverage says which. A stretch nobody writes up lapses after two more days of use — nothing is deleted, it stops being owed.",
        data,
      ),
    ];
  }
  return [finding("crash-write-up", "green", title, detail, "", data)];
}

/**
 * The two columns every doctor line lays out in — `ui.ts` holds the same pair
 * and `test/ui.test.ts` holds the two files to each other.
 *
 * WIDENED 2026-09-22 (6/12 → 7/20) because the labels changed. The line a
 * person came for is now called `Recall by meaning`, which is seventeen
 * characters, and a title wider than its column pushes its own detail out of
 * the column every other detail is in. The owner's screen is the measurement:
 * `OFF` plus four spaces, `Recall by meaning` plus three.
 */
const SEVERITY_COLUMN = 7;
const TITLE_COLUMN = 20;

/** The console's report: a table, worst first, and a fix under anything that is
 *  not green. */
export function reportLines(findings: readonly Finding[], today: string): string[] {
  const ordered = worstFirst(findings);
  const lines = [`counterparts doctor — ${today}`, ""];
  for (const f of ordered) lines.push(...findingLines(f));
  lines.push("");
  lines.push(summaryLine(tally(ordered)));
  return lines;
}

/** ONE finding, in the two columns both arms of this report lay out in — the
 *  grade word, the title, the detail, and the fix in the constant gutter. */
export function findingLines(f: Finding): string[] {
  // A TITLE AS WIDE AS THE COLUMN STILL GETS ITS SPACE (2026-09-20). `padEnd`
  // is a floor, not a gap: a title exactly `TITLE_COLUMN` long would otherwise
  // print as `GREEN Journal modewal (busy timeout 5000 ms)`.
  const title = f.title.length >= TITLE_COLUMN ? `${f.title} ` : f.title.padEnd(TITLE_COLUMN);
  const head = `${gradeWord(f).padEnd(SEVERITY_COLUMN)}${title}`;
  // AN `OFF` LINE HAS NO `fix:`. Nothing is broken, so there is nothing to fix:
  // the command is an INVITATION and it reads as one sentence with the line
  // that explains what it buys. Every other grade keeps the fix on its own
  // line, in the constant gutter, where a person scanning for what to do finds
  // every one of them in the same column.
  if (f.optional === true) return [`${head}${f.detail}${f.fix.length === 0 ? "" : `  ${f.fix}`}`];
  const out = [`${head}${f.detail}`];
  if (f.fix.length > 0) out.push(`${" ".repeat(SEVERITY_COLUMN + TITLE_COLUMN)}fix: ${f.fix}`);
  return out;
}

/**
 * The `--json` shape: ids, counts, severities. Never a credential value.
 *
 * **COMPLETE AND UNFOLDED, always** — the terminal's folded screen is a layout
 * and this is the reading. Every finding is here whatever the console did with
 * it, in the same order, with its own grade.
 *
 * `severity` STAYS THREE-VALUED and an `OFF` finding carries `optional: true`
 * beside it (the owner's answer 12, 2026-09-22). A fourth severity would have
 * moved every reader that switches on the word — the hook's notice, the
 * dashboard, a script — for a distinction only the screen needs. The counts at
 * the top do split them, because a top-level `amber: 2` beside a screen reading
 * `0 amber, 2 off` is exactly the disagreement this module exists to prevent.
 */
export function reportJson(findings: readonly Finding[], today: string): Record<string, unknown> {
  const ordered = worstFirst(findings);
  const t = tally(ordered);
  return {
    date: today,
    red: t.red,
    amber: t.amber,
    off: t.off,
    green: t.green,
    findings: ordered.map((f) => ({
      key: f.key,
      severity: f.severity,
      ...(f.optional === true ? { optional: true } : {}),
      title: f.title,
      detail: f.detail,
      fix: f.fix,
      data: f.data,
    })),
  };
}

/** True when anything is red — the console's exit code, and the notice's gate. */
export function anyRed(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === "red");
}

/** The last line of every notice, and the only part that is never truncated:
 *  the repair is not a thing to remember. */
export const NOTICE_TAIL = "run: counterparts doctor";

/**
 * How long a notice may be, in characters.
 *
 * The host caps EVERY hook output string at 10,000 characters and replaces
 * anything longer with a preview and a file path
 * (https://code.claude.com/docs/en/hooks: "Hook output strings, including
 * `additionalContext`, `systemMessage`, and plain stdout, are capped at 10,000
 * characters"). The notice rides in the same JSON object as the wake, so every
 * character it spends is a character the wake cannot have — and the wake is the
 * thing the session cannot do without. 400 is enough for a finding, its fix and
 * the tail; a finding that needs more than that needs the console, which is what
 * the tail says.
 */
export const NOTICE_MAX_CHARS = 400;

/**
 * THE ONE OR TWO LINES THE OWNER SEES IN THE TERMINAL, or null.
 *
 * RED ONLY. Amber never reaches the terminal from a hook: the owner asked for a
 * warning, not a nag, and a notice that fires on a store with one un-embedded
 * memory is a notice people learn to scroll past. The last line is always the
 * same eight characters plus the command, so the repair is never a thing to
 * remember — and it survives the cap, which the first line does not.
 */
export function noticeMessage(findings: readonly Finding[]): string | null {
  const reds = worstFirst(findings).filter((f) => f.severity === "red");
  const first = reds[0];
  if (first === undefined) return null;
  const more =
    reds.length === 1 ? "" : ` (+${reds.length - 1} more: ${reds.slice(1).map((f) => f.title).join(", ")})`;
  const fix = first.fix.length === 0 ? "" : ` ${first.fix}`;
  const head = `counterparts: ${first.title} — ${first.detail}.${fix}${more}`;
  // The tail and its newline are reserved FIRST, so what is cut is always the
  // explanation and never the way to get the whole of it.
  const room = NOTICE_MAX_CHARS - NOTICE_TAIL.length - 1;
  const line = head.length <= room ? head : `${head.slice(0, Math.max(0, room - 1))}…`;
  return `${line}\n${NOTICE_TAIL}`;
}
