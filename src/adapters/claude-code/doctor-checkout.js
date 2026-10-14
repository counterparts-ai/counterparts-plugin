import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { finding } from "./doctor-finding.js";
function runningRoot(from = dirname(fileURLToPath(import.meta.url))) {
  let dir = from;
  for (let i = 0;i < 8; i += 1) {
    if (existsSync(join(dir, "package.json")))
      return dir;
    const up = dirname(dir);
    if (up === dir)
      return null;
    dir = up;
  }
  return null;
}
export const CHECKOUT_TIMEOUT_MS = 2000;
export const CHECKOUT_BUDGET_MS = 1000;
function gitIn(root, remainingMs, env) {
  return (args) => {
    const res = spawnSync("git", ["-C", root, ...args], {
      timeout: remainingMs(),
      encoding: "utf8",
      windowsHide: true,
      env
    });
    if (res.error !== undefined && res.error !== null) {
      const code = res.error.code ?? "";
      return { ok: false, out: "", failed: code === "ETIMEDOUT" ? "timeout" : "missing" };
    }
    if (res.signal !== null && res.signal !== undefined)
      return { ok: false, out: "", failed: "timeout" };
    if (res.status !== 0)
      return { ok: false, out: String(res.stdout ?? ""), failed: "status" };
    return { ok: true, out: String(res.stdout ?? ""), failed: null };
  };
}
export const ORIGIN_MASTER = "refs/remotes/origin/master";
export function readCheckout(opts = {}) {
  const root = opts.root === undefined ? runningRoot() : opts.root;
  const none = {
    branch: null,
    head: null,
    dirty: 0,
    behindBy: null,
    originMaster: null,
    atMaster: false,
    timedOut: false
  };
  if (root === null)
    return { reason: "not-a-repo", root: "", ...none };
  const now = opts.now ?? (() => Date.now());
  const ceiling = opts.timeoutMs ?? CHECKOUT_TIMEOUT_MS;
  const deadline = now() + (opts.budgetMs ?? CHECKOUT_BUDGET_MS);
  let timedOut = false;
  const run = opts.git ?? gitIn(root, () => Math.max(1, Math.min(ceiling, deadline - now())), opts.env ?? process.env);
  const git = (args) => {
    if (timedOut || now() >= deadline) {
      timedOut = true;
      return { ok: false, out: "", failed: "timeout" };
    }
    const res = run(args);
    if (res.failed === "timeout")
      timedOut = true;
    return res;
  };
  const gitDir = git(["rev-parse", "--git-dir"]);
  if (!gitDir.ok) {
    return {
      reason: gitDir.failed === "status" ? "not-a-repo" : "unreadable",
      root,
      ...none,
      timedOut
    };
  }
  const ref = git(["symbolic-ref", "-q", "--short", "HEAD"]);
  const branch = ref.ok && ref.out.trim().length > 0 ? ref.out.trim() : null;
  const headRead = git(["rev-parse", "--short", "HEAD"]);
  const head = headRead.ok && headRead.out.trim().length > 0 ? headRead.out.trim() : null;
  const statusRead = git(["status", "--porcelain", "--untracked-files=no"]);
  const dirty = statusRead.ok ? statusRead.out.split(`
`).filter((l) => l.trim().length > 0).length : 0;
  const originRead = git(["rev-parse", "--short", ORIGIN_MASTER]);
  const originMaster = originRead.ok && originRead.out.trim().length > 0 ? originRead.out.trim() : null;
  if (originMaster === null || head === null) {
    return { reason: "unreadable", root, branch, head, dirty, behindBy: null, originMaster, atMaster: false, timedOut };
  }
  const atMaster = head === originMaster;
  const ancestor = atMaster || git(["merge-base", "--is-ancestor", "HEAD", ORIGIN_MASTER]).ok;
  const countRead = ancestor && !atMaster ? git(["rev-list", "--count", `HEAD..${ORIGIN_MASTER}`]) : null;
  const behindBy = countRead !== null && countRead.ok ? Number.parseInt(countRead.out.trim(), 10) || 0 : null;
  if (timedOut) {
    return { reason: "unreadable", root, branch, head, dirty, behindBy, originMaster, atMaster, timedOut };
  }
  const reason = dirty > 0 ? "dirty" : atMaster ? "master" : ancestor ? "behind" : branch === null ? "detached" : "branch";
  return { reason, root, branch, head, dirty, behindBy, originMaster, atMaster, timedOut };
}
export function checkoutIsGraded(reading) {
  return reading.reason !== "not-a-repo" && reading.reason !== "unreadable";
}
export function checkoutFindings(reading) {
  const data = {
    reason: reading.reason,
    root: reading.root,
    branch: reading.branch,
    head: reading.head,
    dirty: reading.dirty,
    behindBy: reading.behindBy,
    originMaster: reading.originMaster,
    atMaster: reading.atMaster,
    timedOut: reading.timedOut
  };
  if (reading.reason === "not-a-repo") {
    return [finding("checkout", "green", "Checkout", "not a git checkout — an installed package, nothing to grade", "", data)];
  }
  if (reading.reason === "unreadable") {
    return [
      finding("checkout", "green", "Checkout", reading.timedOut ? `${reading.root} — git did not answer within ${CHECKOUT_BUDGET_MS} ms, so the checkout was not graded` : reading.head === null ? `${reading.root} — git did not answer, so the checkout was not graded` : `${reading.root} — no ${ORIGIN_MASTER} as last fetched, so there is nothing to grade against`, "", data)
    ];
  }
  const where = `${reading.branch ?? "detached"}@${reading.head ?? "?"}`;
  if (reading.reason === "master") {
    return [
      finding("checkout", "green", "Checkout", `${reading.root} at origin/master (${where}), clean`, "", data)
    ];
  }
  if (reading.reason === "behind") {
    return [
      finding("checkout", "amber", "Checkout", `${where} is behind origin/master by ${String(reading.behindBy ?? 0)} commit${reading.behindBy === 1 ? "" : "s"} as last fetched — master moved and this checkout did not`, `Move the checkout: git -C ${reading.root} pull --ff-only (the hooks run what is in that tree, not what is on the remote).`, data)
    ];
  }
  const what = reading.reason === "dirty" ? `the live hooks are running a modified checkout: ${where}, ${reading.dirty} tracked file${reading.dirty === 1 ? "" : "s"} modified` : `the live hooks are running an unmerged checkout: ${where}, which is not an ancestor of origin/master`;
  return [
    finding("checkout", "red", "Checkout", what, `Return ${reading.root} to origin/master (git -C ${reading.root} checkout master) — what is in that tree is live on the owner's memory.`, data)
  ];
}
