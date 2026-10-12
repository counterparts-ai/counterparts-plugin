/** `doctor`'s reading of the checkout the hooks run from, and its finding (moved out of `doctor.ts`, 2026-10-11). */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { finding } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

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

/**
 * WHICH CODE IS LIVE. The hooks and the MCP server run whatever the install
 * tree has checked out, so an unmerged branch sitting in it is not a development
 * state — it is the memory layer the owner is using today.
 */
export function checkoutFindings(reading: CheckoutReading): Finding[] {
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
