/**
 * THE MORNING CATCH-UP (2026-10-01, build 3) — the nightly run writes up owed
 * stretches, in ANY directory, before its page writer runs.
 *
 * Until now an owed stretch was written up only by the next session opened in
 * the same directory (the SessionStart pointer, two a day store-wide), so a
 * project nobody reopened within two days of use simply lapsed. The nightly run
 * already starts at the first prompt of the day, headless; this is a short
 * phase in front of it.
 *
 * **A runner of its own.** The main child is bound to the session that started
 * the night (#282's choice), and that session's record is a live session's —
 * its own write-up pointer and fetched part live there. So the catch-up gets a
 * session id of its own, `writeup-<run>` (`sessions.ts#NIGHT_RUNNER_PREFIX`),
 * and its own `claude -p` child, pinned to it, allowed one tool:
 * `session_end`. The LAUNCHER (this file, in `bin/nightly.ts`'s process) writes
 * the grant onto the runner's record (`sessions.ts#grantWriteUps`) — never a
 * model — and the MCP door (`mcp/write-up.ts`) serves only what is listed
 * there, ended (the ledger's word) and owed, and files the memories under the
 * subject's own directory.
 *
 * **Claim-first.** The launcher claims every subject it grants before the child
 * starts (`WriteUpProgress.claim`), so the SessionStart pointer passes them over
 * and a session that tries to fetch one is told the nightly run has it; a
 * subject another writer already holds is not granted. The claims are let go
 * when the child ends, whatever became of it.
 *
 * **Bounded** by `TUNABLES.NIGHT_WRITE_UP_SESSIONS` and `NIGHT_WRITE_UP_BYTES`,
 * oldest stretch first (it lapses first). The bound rides on each claim as
 * `upTo`, the last part the door will serve tonight. What it left — and what
 * the run wrote — is one durable row (`NIGHT_WRITE_UP_EVENT`), and a line in
 * the process log.
 *
 * Proved against an injected starter and a stub executable only, like the
 * night itself.
 */
import { Buffer } from "node:buffer";

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

/** The runner's session id for a run. */
export function catchUpRunner(run: string): string {
  return `${NIGHT_RUNNER_PREFIX}${run}`;
}

/** One session granted tonight: its share in one directory, and the parts. */
export interface CatchUpSubject {
  readonly session: string;
  /** The buffer's own spelling of the directory its words are in. */
  readonly here: string;
  /** The date its first part tonight was lived (store zone). */
  readonly lived: string;
  /** The parts tonight: `from`..`upTo`, of `of`. */
  readonly from: number;
  readonly upTo: number;
  readonly of: number;
  readonly bytes: number;
}

export interface CatchUpPlan {
  readonly runner: string;
  readonly subjects: readonly CatchUpSubject[];
  /** Sessions owing a write-up the run could take, before the bound. */
  readonly owed: number;
  /** ...of which another writer holds right now (not granted, not "left"). */
  readonly busy: number;
  /** Sessions the bound left wholly or partly for another night. */
  readonly bounded: number;
  readonly bytes: number;
}

/**
 * WHAT TONIGHT WRITES UP, decided and nothing written. Every session owing a
 * write-up a person's conversation left (`pointable`, the pointer's own test),
 * oldest stretch first; another writer's claim passes it over; the bound takes
 * whole parts while they fit, and always the first part of the first session.
 */
export function planCatchUp(
  c: Counterpart,
  opts: { run: string; now: number; sessions?: number; bytes?: number },
): CatchUpPlan {
  const runner = catchUpRunner(opts.run);
  const maxSessions = opts.sessions ?? TUNABLES.NIGHT_WRITE_UP_SESSIONS;
  const maxBytes = opts.bytes ?? TUNABLES.NIGHT_WRITE_UP_BYTES;
  const dir = c.store.dir;
  const zone = c.store.zone();
  const plan = writeUpPlan({ store: c.store, spans: c.spans });
  const progress = readWriteUpProgress(c.store);
  const owing = plan.filter((h) => h.owes && pointable(h, dir)).sort((a, b) => a.clockFrom - b.clockFrom || (a.session < b.session ? -1 : 1));
  const subjects: CatchUpSubject[] = [];
  let busy = 0;
  let bounded = 0;
  let total = 0;
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
    // it, depositing nothing — tonight's first fetch will.
    if (p !== undefined && p.answer !== undefined && p.waiting !== true) {
      if (subjects.length >= maxSessions) {
        bounded += 1;
        continue;
      }
      subjects.push({ session: h.session, here, lived: calendarDate(h.clockFrom, zone), from: p.parts, upTo: p.parts, of: p.parts, bytes: 0 });
      continue;
    }
    const parts = writeUpPartsDated(writeUpEntries(c.spans, { session: h.session, scopes: [here] }), chunk);
    const done = Math.min(p?.done ?? 0, parts.length);
    const remaining = parts.slice(done);
    if (remaining.length === 0) continue;
    if (subjects.length >= maxSessions) {
      bounded += 1;
      continue;
    }
    let take = 0;
    let bytes = 0;
    for (const part of remaining) {
      const b = Buffer.byteLength(part.text, "utf8");
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
    const first = remaining[0];
    subjects.push({
      session: h.session,
      here,
      lived: calendarDate(first !== undefined && first.lastAt > 0 ? first.lastAt : h.clockFrom, zone),
      from: done + 1,
      upTo: done + take,
      of: parts.length,
      bytes,
    });
  }
  return { runner, subjects, owed: owing.length, busy, bounded, bytes: total };
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
 * words come through the door.
 */
export function catchUpPrompt(plan: CatchUpPlan): string {
  const lines = [
    "You are the nightly run, before the page and the dream: some conversations ended before they were written up, and you write them up now — second-hand, from what was said and what that session said back.",
    `Use only the counterparts session_end tool, always with session: "${plan.runner}". For each session below, in order:`,
    "1. Call session_end with writeUp: <its id> and no memories. It returns one part of that conversation.",
    "2. Call session_end with writeUp: <its id>, part: <that part>, memories: [...] — what caught your attention in it, one idea each, in your own words; memories: [] only if nothing in it held your attention. Do not write again what is marked as already written up.",
    "3. Fetch again for its next part, until the answer is \"written-up\" or the door says tonight's allowance for it is spent. Then the next session.",
    "",
    "Sessions:",
    ...plan.subjects.map(
      (s) =>
        `- ${s.session}: lived ${s.lived}; ${s.upTo === s.from ? `part ${String(s.from)}` : `parts ${String(s.from)}–${String(s.upTo)}`} of ${String(s.of)} tonight.`,
    ),
    "",
    "When every session above is done, stop. Nothing else is needed.",
  ];
  return lines.join("\n");
}

/** What the catch-up did, as its row records it. */
export interface CatchUpReport {
  readonly run: string;
  readonly runner: string;
  /** `done`, `timed-out`, `failed`, `could-not-start`, or `none-granted`
   *  (everything owed was held by another writer). */
  readonly state: "done" | "partial" | "timed-out" | "failed" | "could-not-start" | "none-granted";
  readonly granted: number;
  /** Granted sessions that no longer owe a write-up (or whose share here is done). */
  readonly written: number;
  /** Parts that came back tonight. */
  readonly parts: number;
  /** Sessions still owing a write-up, store-wide, once the child ended. */
  readonly left: number;
  /** Sessions the night's bound left wholly or partly for another night. */
  readonly bounded: number;
  readonly busy: number;
  readonly bytes: number;
  readonly ms: number;
  readonly code: number | null;
}

/** How far each granted subject got: written, and parts back, read from the store. */
function measure(c: Counterpart, plan: CatchUpPlan, now: number): { written: number; parts: number; left: number; allowed: number } {
  const after = writeUpPlan({ store: c.store, spans: c.spans });
  const progress = readWriteUpProgress(c.store);
  let written = 0;
  let parts = 0;
  // Subjects that came back as far as tonight's allowance let them: written
  // up, or every part up to `upTo` done (review of #308) — a bounded night
  // that did all it was allowed is not a short one.
  let allowed = 0;
  for (const s of plan.subjects) {
    // Written up HERE: marked, its share done and waiting on another
    // directory, or owing nothing any more.
    if (writeUpStanding(after, c.store.dir, s.session, s.here, now, { progress }).status !== "owed") {
      written += 1;
      allowed += 1;
      parts += s.of - (s.from - 1);
      continue;
    }
    const p = progress[progressKey(s.session, s.here)];
    if (p !== undefined) parts += Math.max(0, p.done - (s.from - 1));
    if (p !== undefined && p.done >= s.upTo) allowed += 1;
  }
  const left = after.filter((h) => h.owes && pointable(h, c.store.dir)).length;
  return { written, parts, left, allowed };
}

export interface CatchUpInput {
  readonly open: () => Counterpart;
  readonly config: AdapterConfig;
  readonly run: string;
  /** The launching session's directory: the runner's record is filed there. */
  readonly scope: string;
  /** Decides the child (`night-run.ts#planNightChild`, with this phase's tools,
   *  turns and watchdog). */
  readonly plan: (input: { prompt: string; runner: string }) => ChildPlan & { readonly ok: boolean; readonly reason: string };
  readonly start: (plan: ChildPlan) => Promise<ChildResult>;
  readonly now: () => number;
  /** The process log (`adapters/log/`), when there is one. */
  readonly onEvent?: (e: CounterpartEvent) => void;
}

/**
 * RUN THE CATCH-UP: plan, grant and claim, start the child, wait, let go,
 * measure, record. Null when nothing was owed (no row: a quiet night is not an
 * event). Never throws.
 */
export async function runCatchUp(input: CatchUpInput): Promise<CatchUpReport | null> {
  const startedAt = input.now();
  let plan: CatchUpPlan;
  let prompt = "";
  try {
    const c = input.open();
    try {
      endStaleRunners(c.store.dir, startedAt);
      plan = planCatchUp(c, { run: input.run, now: startedAt });
      if (plan.owed === 0) return null;
      if (plan.subjects.length > 0) {
        const claimed = grantCatchUp(c, plan, { scope: input.scope, now: startedAt });
        if (claimed === null) return record(input, { ...blank(input, plan, startedAt), state: "could-not-start" });
        plan = claimed;
        if (plan.subjects.length > 0) prompt = catchUpPrompt(plan);
      }
    } finally {
      c.close();
    }
  } catch {
    return null;
  }
  if (plan.subjects.length === 0) return record(input, { ...blank(input, plan, startedAt), state: "none-granted" });

  let state: CatchUpReport["state"] = "could-not-start";
  let code: number | null = null;
  const child = input.plan({ prompt, runner: plan.runner });
  if (child.ok) {
    try {
      const result = await input.start(child);
      code = result.code;
      state =
        result.spawnCode !== undefined || (result.code === null && !result.timedOut && result.error !== null)
          ? "could-not-start"
          : result.timedOut
            ? "timed-out"
            : result.code === 0
              ? "done"
              : "failed";
    } catch {
      state = "could-not-start";
    }
  }
  const endedAt = input.now();
  try {
    const c = input.open();
    try {
      releaseCatchUp(c, plan, { scope: input.scope, now: endedAt });
      const m = measure(c, plan, endedAt);
      // A CLEAN EXIT THAT LEFT GRANTED SESSIONS UNWRITTEN is `partial`, not
      // `done` (review of #308): a child that hit a usage limit, or stopped
      // early, exits 0 all the same. Its output is not read (it is prose); the
      // count is the evidence.
      const settled = state === "done" && m.allowed < plan.subjects.length ? "partial" : state;
      const { allowed: _allowed, ...counts } = m;
      return record(input, { ...blank(input, plan, startedAt, endedAt), state: settled, code, ...counts }, c);
    } finally {
      c.close();
    }
  } catch {
    return { ...blank(input, plan, startedAt, endedAt), state, code };
  }
}

function blank(input: CatchUpInput, plan: CatchUpPlan, startedAt: number, endedAt = startedAt): CatchUpReport {
  return {
    run: input.run,
    runner: plan.runner,
    state: "none-granted",
    granted: plan.subjects.length,
    written: 0,
    parts: 0,
    left: plan.owed,
    bounded: plan.bounded,
    busy: plan.busy,
    bytes: plan.bytes,
    ms: endedAt - startedAt,
    code: null,
  };
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
    bounded: report.bounded,
    busy: report.busy,
    bytes: report.bytes,
    ms: report.ms,
    code: report.code,
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
      };
    }
  } catch {
    /* no row read is no row */
  }
  return null;
}

/** The catch-up in a person's words: "wrote up 2 of 3 sessions (5 parts); 1 session left owed". */
export function catchUpWords(r: Pick<CatchUpReport, "state" | "granted" | "written" | "parts" | "left" | "bounded" | "busy">): string {
  const n = (k: number, one: string, many: string): string => `${String(k)} ${k === 1 ? one : many}`;
  const left = r.left === 0 ? "nothing left owed" : `${n(r.left, "session", "sessions")} left owed`;
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
  const over = r.bounded > 0 ? ` (${n(r.bounded, "was", "were")} over tonight's bound)` : "";
  return `wrote up ${String(r.written)} of ${n(r.granted, "session", "sessions")} (${n(r.parts, "part", "parts")})${how}; ${left}${over}`;
}
