/**
 * Which feed a durable event belongs in, and the small icon it carries there
 * (2026-09-26, an experiment).
 *
 * The home page's "Live activity" shows MEMORY events only: something
 * remembered; a memory got stronger, was replaced or was let go; a chapter was
 * written; a session was handed off; the night's sleep, as one line; a reminder
 * fired. Everything else — embed backfills, cursor moves, cue plumbing, the
 * clock, the worker, the copies — is housekeeping, and belongs to the flow tab's
 * feed, which keeps showing the whole durable log.
 *
 * One table, EXHAUSTIVE BY TYPE: a durable event added to the core fails `tsc`
 * here until someone has said which feed it belongs in.
 */
import type { DurableEventName } from "../registries.js";

export type Lane = "home" | "flow";

/** The icon a home line carries, so the feed can be scanned. */
export type Icon = "remembered" | "stronger" | "replaced" | "faded" | "chapter" | "sleep" | "reminder" | "handoff";

type Payload = Record<string, unknown>;

/** A lane, or a rule over the payload for the names whose rows are only
 *  sometimes about a memory. */
type LaneRule = Lane | ((p: Payload) => Lane);

const n = (p: Payload, k: string): number => (typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : 0);

/**
 * A SLEEP CHECK, not a sleep (2026-09-27, home round 3 — a try): a
 * `sleep.cycle` row whose clock found nothing to advance and whose every other
 * phase did not run — already done today or not due this cadence, in practice
 * (a phase with nothing wired to run it did not run either). A session end on
 * a day that already slept writes one of these each time (about twenty on a
 * busy day); it did nothing to any memory. A cycle where any phase ran,
 * failed, or died is a real sleep and is not a check.
 */
export function isSleepCheck(p: Payload): boolean {
  if (p["reason"] !== "ran" || n(p, "failed") > 0) return false;
  const phases = p["phases"];
  if (!Array.isArray(phases) || phases.length === 0) return false;
  let clock = false;
  for (const raw of phases) {
    if (raw === null || typeof raw !== "object") return false;
    const ph = raw as Payload;
    if (ph["phase"] === "clock") {
      if (ph["status"] !== "ran-nothing-found") return false;
      clock = true;
    } else if (ph["status"] !== "did-not-run") {
      return false;
    }
  }
  return clock;
}

export const LANES = {
  // ── memory events: home ──
  "gate.deposit": "home",
  "gate.chunk": "home",
  "band.promoted": "home",
  "band.transition": "home",
  "memory.pruned": "home",
  "memory.merged": "home",
  "memory.unmerged": "home",
  "revision.pressure": "home",
  // Contradictions (2026-09-29): a settle changes what a memory stands for;
  // a flag and an undo are the mechanism's housekeeping.
  "contradiction.settled": "home",
  "contradiction.flagged": "flow",
  "contradiction.undone": "flow",
  // A held `updates` (2026-10-09) moved nothing: housekeeping.
  "contradiction.held": "flow",
  // A session end that strengthened nothing is housekeeping — unless the credit
  // itself failed, which is a real problem about memories and stays home.
  "recall.credit": (p) =>
    n(p, "credited") > 0 || p["reason"] === "failed" || p["reason"] === "budget-exceeded" ? "home" : "flow",
  "journal.copy.written": "home",
  "journal.copy.failed": "home",
  "handoff.written": "home",
  "handoff.cleared": "home",
  // A sleep that did something is a home line; a CHECK that found nothing due
  // (`isSleepCheck`) is housekeeping.
  "sleep.cycle": (p) => (isSleepCheck(p) ? "flow" : "home"),
  "prospective.fire": "home",
  "prospective.plain": "home",
  // Dreaming and the core (2026-09-26): a dream that wrote its journal, what
  // it changed, and the owner sending a memory back out of the core are
  // things that happened to memories.
  "dream.journaled": "home",
  "dream.changed": "home",
  "dream.undone": "home",
  "band.demoted": "home",
  // ── housekeeping: flow ──
  "dream.begun": "flow",
  "dream.ask": "flow",
  "physics.upgrade.census": "flow",
  "adapter.ask": "flow",
  "adapter.authorship.ask": "flow",
  "adapter.boundary": "flow",
  "adapter.checkout": "flow",
  "adapter.embed.backfill": "flow",
  "adapter.episode.ask": "flow",
  "adapter.primacy.deliver": "flow",
  "adapter.primacy.standdown": "flow",
  "adapter.recall": "flow",
  "adapter.runner.failed": "flow",
  "adapter.writeup.failed": "flow",
  "remember.capture.failed": "flow",
  "adapter.semantic.lag": "flow",
  "adapter.spawn.failed": "flow",
  "adapter.spawn.refused": "flow",
  "adapter.hook.claim.lost": "flow",
  "adapter.spawn.started": "flow",
  "adapter.wake.delivered": "flow",
  "adapter.wake.injected": "flow",
  "associate.flush": "flow",
  "handoff.refused": "flow",
  "handoff.lasthere.noroom": "flow",
  "self.work.overflow": "flow",
  "adapter.envelope.overcap": "flow",
  "adapter.notice.dropped": "flow",
  "adapter.envelope.gave-way": "flow",
  "adapter.injection.overbudget": "flow",
  "handoff.shown": "flow",
  "mcp.recall": "flow",
  "mcp.part": "flow",
  "mcp.result.oversize": "flow",
  "mcp.result.spilled": "flow",
  "prospective.fire.refused": "flow",
  "recall.decision": "flow",
  "remember.prune": "flow",
  "coverage.owed": "flow",
  "coverage.written": "flow",
  "coverage.lapsed": "flow",
  "self.briefing": "flow",
  "self.page.refused": "flow",
  "self.page.revised": "flow",
  "self.page.writer.ran": "flow",
  "snapshot.failed": "flow",
  "snapshot.rotated": "flow",
  "snapshot.taken": "flow",
  "store.embedder.reconciled": "flow",
  "store.export": "flow",
  "sweep.gate": "flow",
  "sweep.wake": "flow",
} as const satisfies Record<DurableEventName, LaneRule>;

/** The feed a row belongs in. A name nobody mapped goes to flow. */
export function laneOf(name: string, p: Payload): Lane {
  const rule = (LANES as Record<string, LaneRule | undefined>)[name];
  if (rule === undefined) return "flow";
  return typeof rule === "function" ? rule(p) : rule;
}

/** The icon a row carries, or null for a housekeeping line. */
export function iconOf(name: string, p: Payload): Icon | null {
  switch (name) {
    case "gate.deposit":
    case "gate.chunk":
      return "remembered";
    case "band.promoted":
    case "recall.credit":
      return "stronger";
    case "band.transition":
      return p["direction"] === "up" ? "stronger" : "faded";
    case "memory.pruned":
      return "faded";
    case "memory.merged":
    case "memory.unmerged":
    case "revision.pressure":
    case "contradiction.settled":
      return "replaced";
    case "journal.copy.written":
    case "journal.copy.failed":
      return "chapter";
    case "handoff.written":
    case "handoff.cleared":
      return "handoff";
    case "sleep.cycle":
      return isSleepCheck(p) ? null : "sleep";
    case "dream.journaled":
    case "dream.changed":
    case "dream.undone":
      return "sleep";
    case "band.demoted":
      return "faded";
    case "prospective.fire":
    case "prospective.plain":
      return "reminder";
    default:
      return null;
  }
}
