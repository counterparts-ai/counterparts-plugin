/**
 * The pending file — co-activation deltas ON DISK, between the process that
 * noticed them and the process that writes them down.
 *
 * **Why it exists.** `coactivate()` accumulates pair deltas in an in-process
 * buffer and `flush()` turns them into edge rows. On a host whose every hook is
 * a fresh process those two halves run in different processes: the credit pass
 * runs inside a Stop hook, and the flush runs in the detached worker that Stop
 * spawns. For the whole of the parallel run the buffer therefore died at hook
 * exit and no edge was ever written. The first fix ran the flush inside the
 * hook, which works — and puts two SQLite writes on a path that meets the
 * worker's own write lock (I38: `database is locked` in 3 of 8 runs, and an
 * adversarial probe measured 5.3 s per write under a held lock, with the drained
 * deltas recorded nowhere afterwards). This file is the other answer, and it is
 * the lesson this week already taught in `sessions.ts`: **a value one hook
 * writes and a later process reads has to be on disk.**
 *
 * So the hook appends; the worker claims, applies and removes. The hook takes no
 * database lock for association at all.
 *
 * **Where it lives, and why not the top level.** `<dataDir>/sessions/association/`.
 * `Store.assertLayout()` runs in the store's CONSTRUCTOR and refuses any
 * top-level entry it cannot classify, so a new top-level file would stop every
 * store opened by code that predates it — and after a deploy the MCP servers of
 * already-running sessions are exactly that code. `sessions/` is already
 * classified (host state, `backup: false`), `adapters/expansions.ts` already
 * keeps a log inside it for the same reason, and a SUBDIRECTORY is also out of
 * `pruneSessions`'s reach: it removes files, and its `rmSync` without
 * `recursive` leaves a directory alone.
 *
 * `SESSIONS_DIR` is spelled again here rather than imported: `adapters/` are
 * leaves and core may not import one. The name is classified in
 * `store/paths.ts` LAYOUT, and `test/sessions.test.ts` pins the two spellings
 * against each other.
 *
 * Four rules the code below mechanizes:
 *
 *   1. **Appends are appends.** One `appendFileSync` per line with `O_APPEND`,
 *      each line small, so two hook processes writing at once interleave whole
 *      lines rather than clobbering each other.
 *   2. **Nothing here throws at a caller.** A hook may not fail its host
 *      (`claude-code/CONTRACT.md` §5 G2); every entry point reports a failure
 *      in its return value instead.
 *   3. **A claim is a rename ASIDE** (the choreography `remember/spans.ts`
 *      already carries): a concurrent append lands in a fresh pending file and
 *      cannot be destroyed by the claim, and a claim whose apply failed is left
 *      where it is, for the next run to find.
 *   4. **Counts, ids and weights only.** Never a byte of any memory's text.
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import type { PairDelta } from "./edges.js";

/** The registry directory core spells for itself — see the header. */
const SESSIONS_DIR = "sessions";
/** One directory of our own inside it, so `pruneSessions` cannot reach the file. */
export const ASSOCIATION_DIR = "association";
export const PENDING_FILE = "pending.jsonl";
export const CLAIMS_DIR = "claims";

/**
 * **CAL.** Pairs per line. A line is written with one `appendFileSync` and two
 * hooks can be writing at the same moment, so it is kept far below any
 * plausible atomic-write size: sixteen pairs is well under a kilobyte at the id
 * lengths this store mints.
 */
export const PENDING_PAIRS_PER_LINE = 16;

/**
 * **CAL.** How large the pending file may get before a pass is dropped instead
 * of appended.
 *
 * A ceiling, not a target: the ordinary file is emptied by the worker seconds
 * after it is written. The owner's store shows what ordinary means — 214 credit
 * passes, six of which credited two or more memories, so a day of real work is
 * a few hundred bytes. The size is set against the OTHER end: a pass crediting
 * 64 memories at once is 2,016 pairs and measured 186 KB of lines, and a
 * megabyte leaves room for several of those on top of a worker that has not run
 * for a week.
 */
export const PENDING_MAX_BYTES = 1024 * 1024;

/**
 * **CAL.** The slack above the cap that the drop MARKERS may use. A drop is
 * counted in a line of its own (~60 bytes) so the next apply can report it;
 * past this the file takes nothing at all and the drop is in-process only.
 */
export const PENDING_MARKER_SLACK_BYTES = 16 * 1024;

/**
 * **CAL.** How long a claim may go untouched before another run takes it over.
 *
 * A claim is TOUCHED when it is taken (`claimPending` sets its mtime to the
 * claim time), so this age is time since the claim, not time since the last
 * append — `renameSync` keeps the pending file's mtime, and measured from that
 * a claim taken during a quiet stretch looked hours old the moment it was made,
 * which let a second worker steal it from a live one and apply the same deltas
 * twice (second adversarial review, 2026-09-17). The window has to outlive the
 * whole worker, not only one apply: the worker's watchdog is five minutes
 * (`adapters/config.ts` WATCHDOG_MS), a worker the watchdog killed releases
 * nothing, and a live one may still be inside its apply. Ten minutes is twice
 * that. Shorter than `remember/`'s span window on purpose: a claim that failed
 * is work already earned and waiting, and it should land soon after.
 */
export const PENDING_STALE_CLAIM_MS = 10 * 60_000;

export function associationDir(dataDir: string): string {
  return join(dataDir, SESSIONS_DIR, ASSOCIATION_DIR);
}

export function pendingPath(dataDir: string): string {
  return join(associationDir(dataDir), PENDING_FILE);
}

export function claimsDir(dataDir: string): string {
  return join(associationDir(dataDir), CLAIMS_DIR);
}

/** What one append did. `code` names the failure when there was one. */
export interface PendingAppend {
  readonly ok: boolean;
  /** Lines written — a pass is several when it carries many pairs. */
  readonly lines: number;
  /** Pairs that reached the file. */
  readonly pairs: number;
  /** Pairs the cap refused, counted in a marker line so an apply can report it. */
  readonly droppedPairs: number;
  readonly code: string | null;
}

/** One line of the file, read back. A pass may span several. */
interface PendingLine {
  readonly at: number;
  readonly day: number;
  readonly pairs: PairDelta[];
  readonly dropped: number;
}

/** A claim file, renamed aside and read. Counts, ids and weights only. */
export interface PendingClaim {
  readonly path: string;
  /** Lines carried — passes, or the fragments of a large pass. */
  readonly passes: number;
  readonly deltas: PairDelta[];
  /** The newest lived day any carried line named; the day the apply stamps. */
  readonly day: number | null;
  /** The oldest carried line's timestamp, for "how old was this work". */
  readonly oldestAt: number | null;
  /** Pairs the cap dropped while this file was the pending one. */
  readonly droppedPairs: number;
  /** Lines that were not JSON. Counted, never silently swallowed. */
  readonly corrupt: number;
}

function codeOf(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "UNKNOWN";
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Append what one credit pass buffered. Returns what landed; never throws.
 *
 * **The cap drops the NEWEST pass, and says so in a line.** Dropping the oldest
 * would mean rewriting the file, and a rewrite races every hook that is
 * appending to it — the one way this file could lose work nobody counted. A
 * delta is re-earnable by construction (the next co-activation of the same pair
 * earns it again); a lost line of somebody else's is not. The drop's count goes
 * into a marker line, so the next apply reports it instead of the loss being
 * visible only in a ring inside a process that is about to exit.
 */
export function appendPendingDeltas(
  dataDir: string,
  deltas: readonly PairDelta[],
  opts: { day: number; at: number },
): PendingAppend {
  if (deltas.length === 0) return { ok: true, lines: 0, pairs: 0, droppedPairs: 0, code: null };
  const path = pendingPath(dataDir);
  try {
    mkdirSync(associationDir(dataDir), { recursive: true });
    const size = sizeOf(path);
    if (size >= PENDING_MAX_BYTES) {
      if (size >= PENDING_MAX_BYTES + PENDING_MARKER_SLACK_BYTES) {
        return { ok: false, lines: 0, pairs: 0, droppedPairs: deltas.length, code: "PENDING_FULL" };
      }
      const marker = JSON.stringify({ at: opts.at, day: opts.day, dropped: deltas.length });
      appendFileSync(path, `${marker}\n`, { encoding: "utf8", mode: 0o600 });
      return { ok: true, lines: 1, pairs: 0, droppedPairs: deltas.length, code: "PENDING_FULL" };
    }
    let lines = 0;
    for (let i = 0; i < deltas.length; i += PENDING_PAIRS_PER_LINE) {
      const chunk = deltas.slice(i, i + PENDING_PAIRS_PER_LINE);
      const line = JSON.stringify({
        at: opts.at,
        day: opts.day,
        // A directed delta (2026-09-28) carries its b → a half as a fourth
        // element; a reader that predates it applies the first three, as a
        // symmetric pair — the delta survives, only its forward bias does not.
        p: chunk.map((d) => (d.back === undefined ? [d.a, d.b, d.delta] : [d.a, d.b, d.delta, d.back])),
      });
      appendFileSync(path, `${line}\n`, { encoding: "utf8", mode: 0o600 });
      lines += 1;
    }
    return { ok: true, lines, pairs: deltas.length, droppedPairs: 0, code: null };
  } catch (err) {
    return { ok: false, lines: 0, pairs: 0, droppedPairs: deltas.length, code: codeOf(err) };
  }
}

function parseLine(raw: string): PendingLine | null {
  let entry: unknown;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const rec = entry as Record<string, unknown>;
  const at = typeof rec["at"] === "number" ? rec["at"] : null;
  const day = typeof rec["day"] === "number" && Number.isFinite(rec["day"]) && rec["day"] >= 0 ? Math.floor(rec["day"]) : null;
  if (at === null || day === null) return null;
  const dropped = typeof rec["dropped"] === "number" ? rec["dropped"] : 0;
  const pairs: PairDelta[] = [];
  const p = rec["p"];
  if (Array.isArray(p)) {
    for (const item of p) {
      if (!Array.isArray(item) || item.length < 3) continue;
      const [a, b, delta, back] = item as [unknown, unknown, unknown, unknown];
      if (typeof a !== "string" || typeof b !== "string" || typeof delta !== "number") continue;
      if (a.length === 0 || b.length === 0 || !Number.isFinite(delta) || delta <= 0) continue;
      if (typeof back === "number" && Number.isFinite(back) && back >= 0 && back !== delta) pairs.push({ a, b, delta, back });
      else pairs.push({ a, b, delta });
    }
  }
  return { at, day, pairs, dropped };
}

function readClaim(path: string): PendingClaim {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { path, passes: 0, deltas: [], day: null, oldestAt: null, droppedPairs: 0, corrupt: 0 };
  }
  const deltas: PairDelta[] = [];
  let passes = 0;
  let corrupt = 0;
  let droppedPairs = 0;
  let day: number | null = null;
  let oldestAt: number | null = null;
  for (const raw of text.split("\n")) {
    if (raw.trim().length === 0) continue;
    const line = parseLine(raw);
    if (line === null) {
      corrupt += 1;
      continue;
    }
    passes += 1;
    droppedPairs += line.dropped;
    for (const d of line.pairs) deltas.push(d);
    day = day === null ? line.day : Math.max(day, line.day);
    oldestAt = oldestAt === null ? line.at : Math.min(oldestAt, line.at);
  }
  return { path, passes, deltas, day, oldestAt, droppedPairs, corrupt };
}

/** A claim's age is measured from the moment it was taken (see
 *  `PENDING_STALE_CLAIM_MS`). A touch that fails leaves the rename's mtime, and
 *  the claim then only looks OLDER than it is, which is the safe direction for
 *  the next run's takeover. */
function touch(path: string, now: number): void {
  try {
    utimesSync(path, now / 1000, now / 1000);
  } catch {
    /* see above */
  }
}

/**
 * Take the pending file and any claim a dead run left behind — each as its own
 * unit of work, oldest first.
 *
 * **Rename, not a lock.** The live file is renamed into `claims/`, so a hook
 * appending at that moment lands in a fresh pending file and its line cannot be
 * destroyed by this claim (the choreography `remember/spans.ts` §2 G6 carries).
 *
 * **A stale claim is re-claimed by renaming it again**, under this run's own id.
 * Two workers racing for the same orphan therefore cannot both take it: the
 * loser's rename meets an ENOENT and it moves on. A rename preserves the file's
 * mtime, so an orphan that has been passed along still reads its true age.
 *
 * Nothing here removes a file. `releasePending` does that, and only after the
 * deltas have landed — a claim whose apply failed is left exactly where it is.
 */
export function claimPending(
  dataDir: string,
  opts: { now?: number; staleMs?: number } = {},
): PendingClaim[] {
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? PENDING_STALE_CLAIM_MS;
  const id = `apc_${randomBytes(6).toString("hex")}`;
  const dir = claimsDir(dataDir);
  const claims: PendingClaim[] = [];
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return claims;
  }
  try {
    renameSync(pendingPath(dataDir), join(dir, `${id}.jsonl`));
    touch(join(dir, `${id}.jsonl`), now);
    claims.push(readClaim(join(dir, `${id}.jsonl`)));
  } catch {
    /* nothing pending, or a rename this process may not make: the orphans below
       are still worth looking for. */
  }
  let orphans: string[] = [];
  try {
    orphans = readdirSync(dir);
  } catch {
    return claims;
  }
  let taken = 0;
  for (const name of orphans) {
    if (!name.endsWith(".jsonl") || name.startsWith(`${id}.`) || name === `${id}.jsonl`) continue;
    const from = join(dir, name);
    try {
      if (now - statSync(from).mtimeMs < staleMs) continue;
      taken += 1;
      const to = join(dir, `${id}.carried${taken}.jsonl`);
      renameSync(from, to);
      touch(to, now);
      claims.push(readClaim(to));
    } catch {
      /* another run took it first, or it cannot be read: not this run's work. */
    }
  }
  return claims.sort((x, y) => (x.oldestAt ?? 0) - (y.oldestAt ?? 0));
}

/**
 * Remove a claim whose deltas have landed. Called ONLY after the apply
 * succeeded — a claim that failed stays on disk for the next run.
 *
 * The rename is the second attempt at the same job: a claim file this process
 * cannot remove would be applied again by a later run, which is the one
 * direction `associate/CONTRACT.md` §5 G4 rules out, and a file moved out of
 * `claims/` is no longer claimable. `stuck` is true when neither worked, and
 * the caller counts it rather than hiding it (`INTERFACE-GAPS.md` §3).
 */
export function releasePending(claim: PendingClaim): { released: boolean; stuck: boolean; code: string | null } {
  try {
    rmSync(claim.path, { force: true });
    return { released: true, stuck: false, code: null };
  } catch (err) {
    const code = codeOf(err);
    try {
      renameSync(claim.path, `${claim.path}.applied`);
      return { released: true, stuck: false, code };
    } catch {
      return { released: false, stuck: true, code };
    }
  }
}
