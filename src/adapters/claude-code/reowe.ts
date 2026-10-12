/**
 * RE-OWE A KNOWN-BAD CATCH-UP (2026-10-11) — `counterparts catch-up --reowe
 * <run>`: the parts a named run closed with nothing kept, owed again, so the
 * next run reads them.
 *
 * Asked after the first live `counterparts catch-up` (run `cup_463025455d83`)
 * closed 16 of its 24 parts with `[]`, about two seconds each. Reading the run
 * showed every one of those parts was already written up before it began — the
 * sessions' own chapters and notes had claimed their words — so that run has
 * nothing to re-owe, and the door now passes such parts over. This is for the
 * run where a reader really did close words it had not written up.
 *
 * **Where it reads.** The run's own answers, part by part, are only in the
 * process log (`mcp.write_up` rows, `adapters/log/`), which keeps a week: the
 * store's progress row is deleted when a session is written up. So a run older
 * than the log is refused by name. Which of its empty parts held unwritten
 * words is read from the coverage ledger as it stood when the run began
 * (`sessions.ts#writeUpEntries`, `coveredBefore`): a part whose every word was
 * claimed before then had nothing to write, and is never re-owed.
 *
 * **What it can do, and what it refuses.** Progress is one counter per
 * session and directory (`WriteUpProgress.done`), so re-owing is moving it
 * back. That works only while the run's own words have not been claimed since:
 * the session is still owed (not marked written up) and those parts read now
 * exactly as they did. A session the run went on to mark, or whose later
 * memories claimed those words (each memory claims its session's backlog,
 * `SpanBuffer.claimCoverage`), would need the mark and the claims taken back —
 * which nothing here does (`needs-retraction`). Parts after them that deposited
 * memories would be handed back too (`after-deposits`). Words already pruned
 * cannot be re-served (`pruned`). Another writer's live claim is left alone
 * (`busy`). Every refusal is per session and said by name.
 *
 * Read-only until `applyReowe`, which only rewrites the progress row.
 */
import type { Counterpart } from "../../core/counterpart.js";
import { logDates, readLog } from "../log/index.js";
import {
  NIGHT_RUNNER_PREFIX,
  WRITE_UP_PART_BYTES,
  claimedByOther,
  progressKey,
  readWriteUpProgress,
  updateWriteUpProgress,
  writeUpEntries,
  writeUpPartsDated,
  writeUpPlan,
  writeUpStanding,
} from "../sessions.js";

/** What re-owing would do for one session the run touched. */
export type ReoweStatus =
  /** Every empty part was already written up before the run. */
  | "nothing-to-reowe"
  /** Its empty parts with unwritten words can be owed again. */
  | "reowe"
  /** Its words are no longer in the buffer. */
  | "pruned"
  /** The run (or a later writer) has claimed those words since. */
  | "needs-retraction"
  /** Parts after them deposited memories; one counter cannot skip those. */
  | "after-deposits"
  /** Another writer holds it right now. */
  | "busy";

export interface ReoweSubject {
  readonly session: string;
  /** Parts the run closed with nothing kept, by number. */
  readonly empty: readonly number[];
  /** ...of which already written up before the run began. */
  readonly kept: readonly number[];
  /** ...of which held words not yet written up. */
  readonly unwritten: readonly number[];
  /** Parts the run brought memories back for. */
  readonly deposited: readonly number[];
  readonly status: ReoweStatus;
  /** The directory share, when found. */
  readonly here: string | null;
  /** Where `done` moves back to, for `reowe`. */
  readonly resetTo: number | null;
}

export interface ReowePlan {
  readonly run: string;
  /** False when the log holds no answer of this run's. */
  readonly found: boolean;
  /** When the run began, epoch ms (its first log line). */
  readonly startedAt: number | null;
  readonly subjects: readonly ReoweSubject[];
}

/** Whether a log line's session is one of the run's runners. */
function isRunner(session: string | null, run: string): boolean {
  const base = `${NIGHT_RUNNER_PREFIX}${run}`;
  return session !== null && (session === base || (session.startsWith(`${base}-`) && /^\d+$/.test(session.slice(base.length + 1))));
}

/** The run's answers from the log: per session, part → deposited, and the part count. */
function runAnswers(dataDir: string, run: string): { startedAt: number | null; bySession: Map<string, { parts: Map<number, number>; of: number | null }> } {
  let startedAt: number | null = null;
  const bySession = new Map<string, { parts: Map<number, number>; of: number | null }>();
  for (const date of logDates(dataDir)) {
    for (const e of readLog(dataDir, date).entries) {
      const mine = isRunner(e.session, run) || e.data["run"] === run;
      if (!mine) continue;
      const at = Date.parse(e.at);
      if (Number.isFinite(at)) startedAt = startedAt === null ? at : Math.min(startedAt, at);
      if (e.name !== "mcp.write_up" || e.ref === null) continue;
      const reason = e.data["reason"];
      if (reason !== "part-written" && reason !== "written-up" && reason !== "written-up-here") continue;
      const part = e.data["part"];
      if (typeof part !== "number") continue;
      const deposited = typeof e.data["deposited"] === "number" ? e.data["deposited"] : 0;
      const s = bySession.get(e.ref) ?? { parts: new Map<number, number>(), of: null };
      s.parts.set(part, (s.parts.get(part) ?? 0) + deposited);
      if (typeof e.data["of"] === "number") s.of = e.data["of"];
      bySession.set(e.ref, s);
    }
  }
  return { startedAt, bySession };
}

/**
 * WHAT RE-OWING `run` WOULD DO, decided and nothing written. Never throws on a
 * missing or partial log: a run it cannot find is `found: false`.
 */
export function reowePlan(c: Counterpart, run: string, now: number): ReowePlan {
  const dir = c.store.dir;
  const { startedAt, bySession } = runAnswers(dir, run);
  if (startedAt === null || bySession.size === 0) return { run, found: false, startedAt, subjects: [] };
  const plan = writeUpPlan({ store: c.store, spans: c.spans });
  const progress = readWriteUpProgress(c.store);
  const subjects: ReoweSubject[] = [];
  for (const [session, answers] of [...bySession.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const empty = [...answers.parts.entries()].filter(([, d]) => d === 0).map(([k]) => k).sort((a, b) => a - b);
    const deposited = [...answers.parts.entries()].filter(([, d]) => d > 0).map(([k]) => k).sort((a, b) => a - b);
    if (empty.length === 0) continue;
    const base = { session, empty, deposited };
    const held = plan.find((h) => h.session === session);
    // THE SHARE THE RUN READ: the directory whose parts, cut as the run began,
    // number as many as the run's rows said.
    let here: string | null = null;
    let atRun: ReturnType<typeof writeUpPartsDated> = [];
    for (const scope of held?.scopes ?? []) {
      const chunk = progress[progressKey(session, scope)]?.chunk ?? WRITE_UP_PART_BYTES;
      const parts = writeUpPartsDated(writeUpEntries(c.spans, { session, scopes: [scope] }, { coveredBefore: startedAt }), chunk);
      if (parts.length === 0) continue;
      if (here === null || parts.length === answers.of) {
        here = scope;
        atRun = parts;
      }
      if (parts.length === answers.of) break;
    }
    if (here === null) {
      subjects.push({ ...base, kept: [], unwritten: [], status: "pruned", here: null, resetTo: null });
      continue;
    }
    const kept = empty.filter((k) => (atRun[k - 1]?.unwritten ?? 0) === 0);
    const unwritten = empty.filter((k) => (atRun[k - 1]?.unwritten ?? 0) > 0);
    const decided = (status: ReoweStatus, resetTo: number | null = null): void => {
      subjects.push({ ...base, kept, unwritten, status, here, resetTo });
    };
    if (unwritten.length === 0) {
      decided("nothing-to-reowe");
      continue;
    }
    const first = unwritten[0] as number;
    const key = progressKey(session, here);
    const p = progress[key];
    if (claimedByOther(progress, session, undefined, now) !== null) {
      decided("busy");
      continue;
    }
    if (writeUpStanding(plan, dir, session, here, now, { progress }).status !== "owed" || p === undefined || p.done < first) {
      decided("needs-retraction");
      continue;
    }
    if (deposited.some((k) => k > first && k <= p.done)) {
      decided("after-deposits");
      continue;
    }
    // NOTHING CLAIMED SINCE: the parts from the first one to re-owe up to where
    // progress stands read now exactly as they did when the run began.
    const nowParts = writeUpPartsDated(writeUpEntries(c.spans, { session, scopes: [here] }), p.chunk);
    let same = true;
    for (let k = first; k <= p.done; k++) if (nowParts[k - 1]?.text !== atRun[k - 1]?.text) same = false;
    if (!same) {
      decided("needs-retraction");
      continue;
    }
    decided("reowe", first - 1);
  }
  return { run, found: true, startedAt, subjects };
}

/**
 * OWE THEM AGAIN: for every `reowe` subject, progress moves back to `resetTo`
 * — in one transaction that re-reads the map and moves nothing a writer has
 * claimed or advanced past since the plan. Returns the sessions moved. Never
 * throws.
 */
export function applyReowe(c: Counterpart, plan: ReowePlan, now: number): string[] {
  const moved: string[] = [];
  updateWriteUpProgress(c.store, (all) => {
    moved.length = 0;
    for (const s of plan.subjects) {
      if (s.status !== "reowe" || s.here === null || s.resetTo === null) continue;
      if (claimedByOther(all, s.session, undefined, now) !== null) continue;
      const key = progressKey(s.session, s.here);
      const p = all[key];
      if (p === undefined || p.done < s.resetTo) continue;
      const { answer: _answered, ...rest } = p;
      all[key] = { ...rest, done: s.resetTo };
      moved.push(s.session);
    }
    return moved.length > 0;
  });
  return moved;
}

/** One session's plan in a person's words. */
export function reoweLine(s: ReoweSubject): string {
  const n = (k: number, one: string, many: string): string => `${String(k)} ${k === 1 ? one : many}`;
  const list = (ks: readonly number[]): string => ks.join(", ");
  const head = `  ${s.session}: ${n(s.empty.length, "part", "parts")} closed with nothing kept (${list(s.empty)})`;
  const split =
    s.kept.length + s.unwritten.length === 0
      ? ""
      : `; ${String(s.kept.length)} already written up before the run, ${String(s.unwritten.length)} with words not yet written up${s.unwritten.length > 0 ? ` (${list(s.unwritten)})` : ""}`;
  const what: Record<ReoweStatus, string> = {
    "nothing-to-reowe": "nothing to re-owe: the session's own chapters or notes had written them up",
    reowe: `would be owed again from part ${String((s.resetTo ?? 0) + 1)}`,
    pruned: "refused: its words are no longer kept, so there is nothing to re-serve",
    "needs-retraction":
      "refused: the run (or a later writer) has claimed those words since — marked the session written up, or a later memory took them — and taking a claim back is not built",
    "after-deposits": "refused: parts after them brought memories back, and owing these again would hand those back too",
    busy: "refused: another writer is writing it up right now; try again after",
  };
  return `${head}${split} — ${what[s.status]}.`;
}
