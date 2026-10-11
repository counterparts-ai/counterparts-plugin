/**
 * THE CATCH-UP (2026-10-01, build 3; everything owed since 2026-10-11) — the
 * nightly run writes up owed stretches, in ANY directory, before its page
 * writer runs; `counterparts catch-up` does the same on demand.
 *
 * Until build 3 an owed stretch was written up only by the next session opened
 * in the same directory (the SessionStart pointer, two a day store-wide), so a
 * project nobody reopened within two days of use simply lapsed. Until
 * 2026-10-11 the night took at most four sessions and 96 KB, and new sessions
 * still spent their start on other sessions' words; now the night takes
 * everything owed and, where it runs, the pointer is retired
 * (`hooks.ts#writeUpPointerRetired`).
 *
 * **A runner of its own.** The main child is bound to the session that started
 * the night (#282's choice), and that session's record is a live session's —
 * its own write-up pointer and fetched part live there. So the catch-up gets a
 * session id of its own, `writeup-<run>` (`sessions.ts#NIGHT_RUNNER_PREFIX`),
 * and its own `claude -p` child, pinned to it, allowed one tool:
 * `session_end`. The LAUNCHER (this file, in `bin/nightly.ts`'s process or the
 * `catch-up` command's) writes the grant onto the runner's record
 * (`sessions.ts#grantWriteUps`) — never a model — and the MCP door
 * (`mcp/write-up.ts`) serves only what is listed there, ended (the ledger's
 * word) and owed, and files the memories under the subject's own directory.
 *
 * **Claim-first.** The launcher claims every subject it grants before the child
 * starts (`WriteUpProgress.claim`), so the SessionStart pointer passes them over
 * and a session that tries to fetch one is told the nightly run has it; a
 * subject another writer already holds is not granted. The claims are let go
 * when the child ends, whatever became of it.
 *
 * **In batches, each a fresh child** (2026-10-11): one child takes at most
 * `NIGHT_WRITE_UP_BYTES` and `NIGHT_WRITE_UP_BATCH_PARTS`, oldest stretch first
 * (it lapses first) — every fetched part stays in a child's context, so a
 * fresh one per batch keeps it small. The batch rides on each claim as `upTo`,
 * the last part the door serves that child; the next batch goes on from there,
 * under a runner of its own (`writeup-<run>-2`, …). The run stops when nothing
 * is owed, when a child ends short, at the sanity ceiling
 * (`NIGHT_WRITE_UP_PARTS` a night, `CATCH_UP_COMMAND_PARTS` for the command)
 * or before a child could outlast the run's watchdog
 * (`NIGHT_WRITE_UP_TOTAL_MS`). What it wrote and what it left — sessions AND
 * parts — is one durable row (`NIGHT_WRITE_UP_EVENT`), and a line in the
 * process log.
 *
 * Proved against an injected starter and a stub executable only, like the
 * night itself.
 */
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";

import { NIGHT_WRITE_UP_EVENT } from "../../core/counterpart.js";
import type { Counterpart, CounterpartEvent } from "../../core/counterpart.js";
import { calendarDate } from "../../core/self/index.js";
import { TUNABLES } from "../config.js";
import type { AdapterConfig } from "../config.js";
import {
  NIGHT_RUNNER_PREFIX,
  WRITE_UP_CLAIM_MS,
  WRITE_UP_PART_BYTES,
  claimedByOther,
  grantWriteUps,
  listSessions,
  pointable,
  progressKey,
  readWriteUpProgress,
  recordSession,
  updateWriteUpProgress,
  writeUpEntries,
  writeUpPartsDated,
  writeUpPlan,
  writeUpStanding,
} from "../sessions.js";
import type { WriteUpProgress } from "../sessions.js";
import type { ChildPlan, ChildResult } from "./child.js";

/** The one tool the catch-up child may call, as the host names it. */
export const CATCH_UP_TOOLS = ["mcp__counterparts__session_end"] as const;

/** A `counterparts catch-up` run's id begins so (the night's: `nrn_`). */
export const CATCH_UP_RUN_PREFIX = "cup_";

/** A fresh id for a `counterparts catch-up` run. */
export function newCatchUpRunId(): string {
  return `${CATCH_UP_RUN_PREFIX}${randomBytes(6).toString("hex")}`;
}

/** The runner's session id for a run's batch: `writeup-<run>` for the first,
 *  `writeup-<run>-2` and on for the rest, each its own record and grant. */
export function catchUpRunner(run: string, batch = 1): string {
  return batch <= 1 ? `${NIGHT_RUNNER_PREFIX}${run}` : `${NIGHT_RUNNER_PREFIX}${run}-${String(batch)}`;
}

/** One session granted to a batch: its share in one directory, and the parts. */
export interface CatchUpSubject {
  readonly session: string;
  /** The buffer's own spelling of the directory its words are in. */
  readonly here: string;
  /** The date its first part in this batch was lived (store zone). */
  readonly lived: string;
  /** The parts in this batch: `from`..`upTo`, of `of`. */
  readonly from: number;
  readonly upTo: number;
  readonly of: number;
  readonly bytes: number;
  /** Parts already written before this batch (review of #401): what the batch
   *  is measured against, so a share that did not move counts no progress —
   *  `from - 1`, except for a last part answered whose mark did not land,
   *  where every part is already done and only the mark is owed. */
  readonly done: number;
}

export interface CatchUpPlan {
  readonly runner: string;
  readonly subjects: readonly CatchUpSubject[];
  /** Sessions owing a write-up the run could take, before the batch's bound. */
  readonly owed: number;
  /** ...of which another writer holds right now (not granted, not "left"). */
  readonly busy: number;
  /** Sessions the batch's bound left wholly or partly for the next batch. */
  readonly bounded: number;
  readonly bytes: number;
}

/** Parts a plan hands its child. */
export function plannedParts(plan: Pick<CatchUpPlan, "subjects">): number {
  return plan.subjects.reduce((n, s) => n + (s.upTo - s.from + 1), 0);
}

/**
 * WHAT ONE BATCH WRITES UP, decided and nothing written. Every session owing a
 * write-up a person's conversation left (`pointable`, the pointer's own test),
 * oldest stretch first; another writer's claim passes it over; the bound takes
 * whole parts while they fit — bytes (`NIGHT_WRITE_UP_BYTES`), parts
 * (`NIGHT_WRITE_UP_BATCH_PARTS`, and `room`, what is left of the run's
 * ceiling) and, when given, sessions — and always the first part of the first
 * session.
 */
export function planCatchUp(
  c: Counterpart,
  opts: { run: string; now: number; runner?: string; sessions?: number; bytes?: number; parts?: number; room?: number },
): CatchUpPlan {
  const runner = opts.runner ?? catchUpRunner(opts.run);
  const maxSessions = opts.sessions ?? Number.POSITIVE_INFINITY;
  const maxBytes = opts.bytes ?? TUNABLES.NIGHT_WRITE_UP_BYTES;
  const maxParts = Math.max(1, Math.min(opts.parts ?? TUNABLES.NIGHT_WRITE_UP_BATCH_PARTS, opts.room ?? Number.POSITIVE_INFINITY));
  const dir = c.store.dir;
  const zone = c.store.zone();
  const plan = writeUpPlan({ store: c.store, spans: c.spans });
  const progress = readWriteUpProgress(c.store);
  const owing = plan.filter((h) => h.owes && pointable(h, dir)).sort((a, b) => a.clockFrom - b.clockFrom || (a.session < b.session ? -1 : 1));
  const subjects: CatchUpSubject[] = [];
  let busy = 0;
  let bounded = 0;
  let total = 0;
  let taken = 0;
  for (const h of owing) {
    if (claimedByOther(progress, h.session, runner, opts.now) !== null) {
      busy += 1;
      continue;
    }
    // The share the door will serve first: the first directory, in the
    // session's own order, where it is owed.
    let here: string | null = null;
    for (const scope of h.scopes) {
      const s = writeUpStanding(plan, dir, h.session, scope, opts.now, { progress });
      if (s.status === "owed") {
        here = s.here;
        break;
      }
    }
    if (here === null) continue;
    const p = progress[progressKey(h.session, here)];
    const chunk = p?.chunk ?? WRITE_UP_PART_BYTES;
    // A LAST PART ALREADY ANSWERED whose mark did not land: one fetch finishes
    // it, depositing nothing — the batch's first fetch will.
    if (p !== undefined && p.answer !== undefined && p.waiting !== true) {
      if (subjects.length >= maxSessions || taken >= maxParts) {
        bounded += 1;
        continue;
      }
      subjects.push({ session: h.session, here, lived: calendarDate(h.clockFrom, zone), from: p.parts, upTo: p.parts, of: p.parts, bytes: 0, done: Math.min(p.done, p.parts) });
      taken += 1;
      continue;
    }
    const parts = writeUpPartsDated(writeUpEntries(c.spans, { session: h.session, scopes: [here] }), chunk);
    const done = Math.min(p?.done ?? 0, parts.length);
    const remaining = parts.slice(done);
    if (remaining.length === 0) continue;
    if (subjects.length >= maxSessions || taken >= maxParts) {
      bounded += 1;
      continue;
    }
    let take = 0;
    let bytes = 0;
    for (const part of remaining) {
      const b = Buffer.byteLength(part.text, "utf8");
      if (taken + take >= maxParts) break;
      if (total + bytes + b > maxBytes && !(total === 0 && take === 0)) break;
      take += 1;
      bytes += b;
    }
    if (take === 0) {
      bounded += 1;
      continue;
    }
    if (take < remaining.length) bounded += 1;
    total += bytes;
    taken += take;
    const first = remaining[0];
    subjects.push({
      session: h.session,
      here,
      lived: calendarDate(first !== undefined && first.lastAt > 0 ? first.lastAt : h.clockFrom, zone),
      from: done + 1,
      upTo: done + take,
      of: parts.length,
      bytes,
      done,
    });
  }
  return { runner, subjects, owed: owing.length, busy, bounded, bytes: total };
}

/**
 * PARTS STILL OWED, store-wide: for every session owing a write-up a person's
 * conversation left, the parts not yet written in each directory it owes in.
 * What the row's `partsLeft` says. Reads every owed session's words once.
 */
export function owedParts(c: Counterpart, now: number): number {
  const dir = c.store.dir;
  const plan = writeUpPlan({ store: c.store, spans: c.spans });
  const progress = readWriteUpProgress(c.store);
  let n = 0;
  for (const h of plan) {
    if (!h.owes || !pointable(h, dir)) continue;
    for (const scope of h.scopes) {
      const s = writeUpStanding(plan, dir, h.session, scope, now, { progress });
      if (s.status !== "owed") continue;
      const p = progress[progressKey(h.session, s.here)];
      if (p !== undefined && p.answer !== undefined && p.waiting !== true) continue;
      const parts = writeUpPartsDated(writeUpEntries(c.spans, { session: h.session, scopes: [s.here] }), p?.chunk ?? WRITE_UP_PART_BYTES);
      n += Math.max(0, parts.length - Math.min(p?.done ?? 0, parts.length));
    }
  }
  return n;
}

/**
 * THE CLAIMS, THEN THE GRANT, written by the launcher before the child starts.
 * The claims are taken in ONE transaction that re-reads the map (review of
 * #308): a subject another writer took since `planCatchUp` read it is passed
 * over and counted `busy`, never claimed twice. Then the runner is granted
 * exactly what it holds. Returns the plan as claimed; null when nothing could
 * be written (and then nothing is left claimed or granted). Never throws.
 */
export function grantCatchUp(c: Counterpart, plan: CatchUpPlan, opts: { scope: string; now: number }): CatchUpPlan | null {
  const dir = c.store.dir;
  const scope = opts.scope.length > 0 ? opts.scope : dir;
  const kept: CatchUpSubject[] = [];
  const ok = updateWriteUpProgress(c.store, (all) => {
    kept.length = 0;
    for (const s of plan.subjects) {
      if (claimedByOther(all, s.session, plan.runner, opts.now) !== null) continue;
      const key = progressKey(s.session, s.here);
      const p: WriteUpProgress | undefined = all[key];
      all[key] = {
        ...(p ?? {}),
        chunk: p?.chunk ?? WRITE_UP_PART_BYTES,
        parts: s.of,
        done: Math.min(p?.done ?? 0, s.of),
        handedAt: opts.now,
        claim: { by: plan.runner, at: opts.now, upTo: s.upTo },
      };
      kept.push(s);
    }
    return kept.length > 0;
  });
  if (!ok) return null;
  const claimed: CatchUpPlan = { ...plan, subjects: [...kept], busy: plan.busy + (plan.subjects.length - kept.length) };
  if (kept.length === 0) return claimed;
  try {
    if (grantWriteUps(dir, { runner: plan.runner, scope, subjects: kept.map((s) => s.session), at: opts.now })) return claimed;
  } catch {
    /* let go below */
  }
  releaseCatchUp(c, claimed, { scope: opts.scope, now: opts.now });
  return null;
}

/**
 * END A RUNNER NOBODY ENDED (review of #308): a nightly process killed in its
 * catch-up leaves its runner's record open with its grant. At the next run's
 * start, every runner record still open past `WRITE_UP_CLAIM_MS` is ended and
 * its grant withdrawn (its claims have already run out). The door refuses such
 * a grant on its own too (`mcp/write-up.ts`). Returns how many. Never throws.
 */
export function endStaleRunners(dir: string, now: number): number {
  let n = 0;
  try {
    for (const r of listSessions(dir)) {
      if (!r.sessionId.startsWith(NIGHT_RUNNER_PREFIX) || r.endedAt !== null) continue;
      if (now - r.lastBoundaryAt < WRITE_UP_CLAIM_MS) continue;
      grantWriteUps(dir, { runner: r.sessionId, scope: r.scope, subjects: [], at: now });
      recordSession(dir, { sessionId: r.sessionId, scope: r.scope, phase: "end", at: now });
      n += 1;
    }
  } catch {
    /* the door refuses a stale grant whatever happens here */
  }
  return n;
}

/**
 * LET GO when the child has ended, whatever became of it: the runner's claims
 * (the progress stays — what came back stays done), its grant, and its record,
 * which ends. Never throws.
 */
export function releaseCatchUp(c: Counterpart, plan: CatchUpPlan, opts: { scope: string; now: number }): void {
  const dir = c.store.dir;
  const scope = opts.scope.length > 0 ? opts.scope : dir;
  try {
    updateWriteUpProgress(c.store, (map) => {
      let changed = false;
      for (const [key, p] of Object.entries(map)) {
        if (p.claim?.by !== plan.runner) continue;
        const { claim: _mine, ...rest } = p;
        map[key] = rest;
        changed = true;
      }
      return changed;
    });
  } catch {
    /* a claim nobody lets go runs out (`WRITE_UP_CLAIM_MS`) */
  }
  try {
    grantWriteUps(dir, { runner: plan.runner, scope, subjects: [], at: opts.now });
    recordSession(dir, { sessionId: plan.runner, scope, phase: "end", at: opts.now });
  } catch {
    /* the record is pruned with the week */
  }
}

/**
 * THE CATCH-UP CHILD'S PROMPT: the runner's id, the sessions in order, and the
 * one way to write each up. Ids, dates and counts — no words of anyone's; the
 * words come through the door. The same for the night and the command.
 */
export function catchUpPrompt(plan: CatchUpPlan): string {
  const lines = [
    "You are catching up, in a windowless session of your own: some conversations ended before they were written up, and you write them up now — second-hand, from what was said and what that session said back.",
    `Use only the counterparts session_end tool, always with session: "${plan.runner}". For each session below, in order:`,
    "1. Call session_end with writeUp: <its id> and no memories. It returns one part of that conversation.",
    "2. Call session_end with writeUp: <its id>, part: <that part>, memories: [...] — what caught your attention in it, one idea each, in your own words; memories: [] only if nothing in it held your attention. Do not write again what is marked as already written up.",
    "3. Fetch again for its next part, until the answer is \"written-up\" or the door says this run's allowance for it is spent. Then the next session.",
    "",
    "Sessions:",
    ...plan.subjects.map(
      (s) =>
        `- ${s.session}: lived ${s.lived}; ${s.upTo === s.from ? `part ${String(s.from)}` : `parts ${String(s.from)}–${String(s.upTo)}`} of ${String(s.of)}.`,
    ),
    "",
    "When every session above is done, stop. Nothing else is needed.",
  ];
  return lines.join("\n");
}

/** What the catch-up did, as its row records it. */
export interface CatchUpReport {
  readonly run: string;
  /** The first batch's runner (`catchUpRunner(run)`); later ones add `-2`, …. */
  readonly runner: string;
  /** `done`, `partial` (a child ended short), `timed-out`, `failed`,
   *  `could-not-start`, or `none-granted` (everything owed was held by another
   *  writer). */
  readonly state: "done" | "partial" | "timed-out" | "failed" | "could-not-start" | "none-granted";
  /** Sessions granted (a share in one directory each, across every batch). */
  readonly granted: number;
  /** Granted sessions that no longer owe a write-up (or whose share here is done). */
  readonly written: number;
  /** Parts that came back in this run. */
  readonly parts: number;
  /** Sessions still owing a write-up, store-wide, once the run ended. */
  readonly left: number;
  /** ...and their parts not yet written (2026-10-11): what is really left, so
   *  a long session written part-way never reads as nothing done. Null on a
   *  row from before it was counted. */
  readonly partsLeft: number | null;
  /** Sessions the run's ceiling or watchdog left wholly or partly owed. */
  readonly bounded: number;
  readonly busy: number;
  readonly bytes: number;
  readonly ms: number;
  readonly code: number | null;
  /** Children started (2026-10-11). */
  readonly batches: number;
  /** What stopped the run while something was still owed: the parts ceiling
   *  (`parts`), the run's watchdog (`time`), or nothing. */
  readonly limit: "parts" | "time" | null;
}

/** A session's share granted in this run, its batches merged: from its first
 *  batch's first part to its last batch's last. */
interface Granted {
  readonly session: string;
  readonly here: string;
  readonly from: number;
  readonly upTo: number;
  readonly of: number;
  /** Parts written before its first batch. */
  readonly done: number;
}

/** How far each granted share got: written, and parts back, read from the store. */
function measure(c: Counterpart, subjects: readonly Granted[], now: number): { written: number; parts: number; left: number; allowed: number } {
  const after = writeUpPlan({ store: c.store, spans: c.spans });
  const progress = readWriteUpProgress(c.store);
  let written = 0;
  let parts = 0;
  // Shares that came back as far as their allowance let them: written up, or
  // every part up to `upTo` done (review of #308) — a batch that did all it
  // was allowed is not a short one.
  let allowed = 0;
  for (const s of subjects) {
    // Written up HERE: marked, its share done and waiting on another
    // directory, or owing nothing any more.
    if (writeUpStanding(after, c.store.dir, s.session, s.here, now, { progress }).status !== "owed") {
      written += 1;
      allowed += 1;
      parts += Math.max(0, s.of - s.done);
      continue;
    }
    // Progress is what MOVED (review of #401): a last part answered whose mark
    // did not land is already `done >= upTo` before the batch, and a child that
    // touched nothing must not read as a part written — or the run re-grants
    // it, batch after batch, to the ceiling.
    const p = progress[progressKey(s.session, s.here)];
    if (p !== undefined) parts += Math.max(0, p.done - s.done);
    if (p !== undefined && p.done >= s.upTo && p.done > s.done) allowed += 1;
  }
  const left = after.filter((h) => h.owes && pointable(h, c.store.dir)).length;
  return { written, parts, left, allowed };
}

export interface CatchUpInput {
  readonly open: () => Counterpart;
  readonly config: AdapterConfig;
  /** The run's id: the night's `nrn_…`, or the command's `cup_…`. */
  readonly run: string;
  /** Where the runners' records are filed: the launching session's directory,
   *  or the store's own for the command. */
  readonly scope: string;
  /** Decides one child (`night-run.ts#planNightChild`, with this phase's tools,
   *  turns and watchdog). */
  readonly plan: (input: { prompt: string; runner: string }) => ChildPlan & { readonly ok: boolean; readonly reason: string };
  readonly start: (plan: ChildPlan) => Promise<ChildResult>;
  readonly now: () => number;
  /** The run's sanity ceiling, parts: the night's `NIGHT_WRITE_UP_PARTS`,
   *  the command's `CATCH_UP_COMMAND_PARTS`; absent, the night's. */
  readonly parts?: number;
  /** The run's watchdog, ms; absent, `NIGHT_WRITE_UP_TOTAL_MS`. */
  readonly totalMs?: number;
  /** Told each batch as it is granted, before its child starts (the command
   *  prints it). Never the run's problem if it throws. */
  readonly onBatch?: (b: { readonly batch: number; readonly plan: CatchUpPlan }) => void;
  /** The process log (`adapters/log/`), when there is one. */
  readonly onEvent?: (e: CounterpartEvent) => void;
}

/** One child, started and waited on: what became of it. */
async function runChild(input: CatchUpInput, plan: CatchUpPlan, prompt: string): Promise<{ state: CatchUpReport["state"]; code: number | null }> {
  const child = input.plan({ prompt, runner: plan.runner });
  if (!child.ok) return { state: "could-not-start", code: null };
  try {
    const result = await input.start(child);
    const state =
      result.spawnCode !== undefined || (result.code === null && !result.timedOut && result.error !== null)
        ? "could-not-start"
        : result.timedOut
          ? "timed-out"
          : result.code === 0
            ? "done"
            : "failed";
    return { state, code: result.code };
  } catch {
    return { state: "could-not-start", code: null };
  }
}

/**
 * RUN THE CATCH-UP: batch after batch — plan, grant and claim, start the
 * child, wait, let go, measure — until nothing is owed, a child ends short, or
 * the ceiling or the watchdog says stop; then record. Null when nothing was
 * owed (no row: a quiet night is not an event). Never throws.
 */
export async function runCatchUp(input: CatchUpInput): Promise<CatchUpReport | null> {
  const startedAt = input.now();
  const deadline = startedAt + (input.totalMs ?? TUNABLES.NIGHT_WRITE_UP_TOTAL_MS);
  let room = input.parts ?? TUNABLES.NIGHT_WRITE_UP_PARTS;
  const granted = new Map<string, Granted>();
  let batches = 0;
  let state: CatchUpReport["state"] = "done";
  let code: number | null = null;
  let parts = 0;
  let busy = 0;
  let bytes = 0;
  let owed = 0;
  let limit: CatchUpReport["limit"] = null;
  for (;;) {
    // THE CEILING AND THE WATCHDOG, before each child after the first: no
    // child starts that the parts left could not pay for, or that could run
    // past the run's watchdog.
    if (batches > 0 && room <= 0) {
      limit = "parts";
      break;
    }
    if (batches > 0 && input.now() + TUNABLES.NIGHT_WRITE_UP_MS > deadline) {
      limit = "time";
      break;
    }
    const at = input.now();
    let plan: CatchUpPlan;
    let prompt = "";
    let lost = false;
    try {
      const c = input.open();
      try {
        if (batches === 0) endStaleRunners(c.store.dir, at);
        plan = planCatchUp(c, { run: input.run, runner: catchUpRunner(input.run, batches + 1), now: at, room });
        if (batches === 0) {
          if (plan.owed === 0) return null;
          owed = plan.owed;
        }
        if (plan.subjects.length > 0) {
          const claimed = grantCatchUp(c, plan, { scope: input.scope, now: at });
          if (claimed === null) lost = true;
          else {
            plan = claimed;
            if (plan.subjects.length > 0) prompt = catchUpPrompt(plan);
          }
        }
      } finally {
        c.close();
      }
    } catch {
      if (batches === 0) return null;
      state = "partial";
      break;
    }
    busy = plan.busy;
    if (lost) {
      // Nothing could be claimed or granted: nothing is left held.
      state = batches === 0 ? "could-not-start" : "partial";
      break;
    }
    if (plan.subjects.length === 0) {
      if (batches === 0) state = "none-granted";
      break;
    }
    batches += 1;
    bytes += plan.bytes;
    room -= plannedParts(plan);
    for (const s of plan.subjects) {
      const key = progressKey(s.session, s.here);
      const was = granted.get(key);
      granted.set(key, { session: s.session, here: s.here, from: was?.from ?? s.from, upTo: s.upTo, of: s.of, done: was?.done ?? s.done });
    }
    try {
      input.onBatch?.({ batch: batches, plan });
    } catch {
      /* never the run's problem */
    }
    const child = await runChild(input, plan, prompt);
    code = child.code;
    let m: ReturnType<typeof measure> | null = null;
    try {
      const c = input.open();
      try {
        releaseCatchUp(c, plan, { scope: input.scope, now: input.now() });
        m = measure(c, plan.subjects, input.now());
      } finally {
        c.close();
      }
    } catch {
      m = null;
    }
    if (m !== null) parts += m.parts;
    // A LATER CHILD THAT COULD NOT START ends a run that already wrote: the
    // run stopped short (`partial`), it did not fail to start.
    if (child.state !== "done") {
      state = child.state === "could-not-start" && batches > 1 ? "partial" : child.state;
      break;
    }
    // A CLEAN EXIT THAT LEFT GRANTED SESSIONS UNWRITTEN is `partial`, not
    // `done` (review of #308): a child that hit a usage limit, or stopped
    // early, exits 0 all the same. Its output is not read (it is prose); the
    // count is the evidence. And a batch that brought nothing back starts no
    // other: the next would be granted the same parts.
    if (m === null || m.allowed < plan.subjects.length || (m.parts === 0 && m.written === 0)) {
      state = "partial";
      break;
    }
  }
  const endedAt = input.now();
  const report = (over: Partial<CatchUpReport>): CatchUpReport => ({
    run: input.run,
    runner: catchUpRunner(input.run),
    state,
    granted: granted.size,
    written: 0,
    parts,
    left: owed,
    partsLeft: null,
    bounded: 0,
    busy,
    bytes,
    ms: endedAt - startedAt,
    code,
    batches,
    limit,
    ...over,
  });
  try {
    const c = input.open();
    try {
      const m = measure(c, [...granted.values()], endedAt);
      const partsLeft = m.left === 0 ? 0 : owedParts(c, endedAt);
      const stopped = m.left > 0 ? limit : null;
      return record(input, report({ written: m.written, left: m.left, partsLeft, limit: stopped, bounded: stopped === null ? 0 : Math.max(0, m.left - busy) }), c);
    } finally {
      c.close();
    }
  } catch {
    return record(input, report({}));
  }
}

/** The row, and the log line. Never throws; returns the report either way. */
function record(input: CatchUpInput, report: CatchUpReport, open?: Counterpart): CatchUpReport {
  const data = {
    run: report.run,
    runner: report.runner,
    state: report.state,
    granted: report.granted,
    written: report.written,
    parts: report.parts,
    left: report.left,
    partsLeft: report.partsLeft,
    bounded: report.bounded,
    busy: report.busy,
    bytes: report.bytes,
    ms: report.ms,
    code: report.code,
    batches: report.batches,
    limit: report.limit,
  };
  try {
    const write = (c: Counterpart): void => {
      if (c.observer) return;
      c.store.appendEvent({ name: NIGHT_WRITE_UP_EVENT, day: c.store.livedDay(), ref: report.run, payload: data, dedupKey: `${NIGHT_WRITE_UP_EVENT}:${report.run}` });
    };
    if (open !== undefined) write(open);
    else {
      const c = input.open();
      try {
        write(c);
      } finally {
        c.close();
      }
    }
  } catch {
    /* the catch-up happened whether or not its row landed */
  }
  try {
    input.onEvent?.({ at: input.now(), name: NIGHT_WRITE_UP_EVENT, ref: report.run, data });
  } catch {
    /* never the run's problem */
  }
  return report;
}

/** The newest catch-up row, as doctor reads it — for a run, or the latest. */
export function catchUpOf(
  store: Pick<Counterpart["store"], "eventLog">,
  run?: string,
): (Omit<CatchUpReport, "run" | "runner"> & { readonly run: string; readonly at: number }) | null {
  try {
    const rows = store.eventLog({ name: NIGHT_WRITE_UP_EVENT, order: "desc", limit: 20 });
    for (const r of rows) {
      if (run !== undefined && r.ref !== run) continue;
      const p = JSON.parse(r.payload ?? "{}") as Record<string, unknown>;
      const n = (k: string): number => (typeof p[k] === "number" ? (p[k] as number) : 0);
      const state = p["state"];
      return {
        run: typeof r.ref === "string" ? r.ref : "",
        at: r.at,
        state: (typeof state === "string" ? state : "done") as CatchUpReport["state"],
        granted: n("granted"),
        written: n("written"),
        parts: n("parts"),
        left: n("left"),
        bounded: n("bounded"),
        busy: n("busy"),
        bytes: n("bytes"),
        ms: n("ms"),
        code: typeof p["code"] === "number" ? (p["code"] as number) : null,
        partsLeft: typeof p["partsLeft"] === "number" ? (p["partsLeft"] as number) : null,
        batches: typeof p["batches"] === "number" ? (p["batches"] as number) : 1,
        limit: p["limit"] === "parts" || p["limit"] === "time" ? p["limit"] : null,
      };
    }
  } catch {
    /* no row read is no row */
  }
  return null;
}

/**
 * The catch-up in a person's words: "caught up 2 of 3 sessions (14 parts
 * written); 1 session still owed, 6 parts". A session counts as caught up once
 * its last part is written; the parts say how far a long one got.
 */
export function catchUpWords(
  r: Pick<CatchUpReport, "state" | "granted" | "written" | "parts" | "left" | "bounded" | "busy"> & {
    readonly partsLeft?: number | null;
    readonly limit?: CatchUpReport["limit"];
  },
): string {
  const n = (k: number, one: string, many: string): string => `${String(k)} ${k === 1 ? one : many}`;
  const partsLeft = typeof r.partsLeft === "number" && r.partsLeft > 0 ? `, ${n(r.partsLeft, "part", "parts")}` : "";
  const left = r.left === 0 ? "nothing left owed" : `${n(r.left, "session", "sessions")} still owed${partsLeft}`;
  if (r.state === "none-granted") return `nothing to take (${n(r.busy, "session was", "sessions were")} being written up elsewhere); ${left}`;
  if (r.state === "could-not-start") return `could not start; ${left}`;
  const how =
    r.state === "timed-out"
      ? " before its watchdog stopped it"
      : r.state === "failed"
        ? " before it failed"
        : r.state === "partial"
          ? " — it stopped before the rest (a usage limit, or it gave up)"
          : "";
  const over =
    r.bounded === 0
      ? ""
      : r.limit === "time"
        ? " (it stopped at its hour)"
        : ` (${n(r.bounded, "was", "were")} over the run's ceiling)`;
  return `caught up ${String(r.written)} of ${n(r.granted, "session", "sessions")} (${n(r.parts, "part", "parts")} written)${how}; ${left}${over}`;
}
