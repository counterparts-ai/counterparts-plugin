const n = (p, k) => typeof p[k] === "number" && Number.isFinite(p[k]) ? p[k] : 0;
export function isSleepCheck(p) {
  if (p["reason"] !== "ran" || n(p, "failed") > 0)
    return false;
  const phases = p["phases"];
  if (!Array.isArray(phases) || phases.length === 0)
    return false;
  let clock = false;
  for (const raw of phases) {
    if (raw === null || typeof raw !== "object")
      return false;
    const ph = raw;
    if (ph["phase"] === "clock") {
      if (ph["status"] !== "ran-nothing-found")
        return false;
      clock = true;
    } else if (ph["status"] !== "did-not-run") {
      return false;
    }
  }
  return clock;
}
export const LANES = {
  "gate.deposit": "home",
  "gate.chunk": "home",
  "band.promoted": "home",
  "band.transition": "home",
  "memory.pruned": "home",
  "memory.merged": "home",
  "memory.unmerged": "home",
  "revision.pressure": "home",
  "contradiction.settled": "home",
  "contradiction.flagged": "flow",
  "contradiction.undone": "flow",
  "contradiction.held": "flow",
  "contradiction.proposed": "flow",
  "recall.credit": (p) => n(p, "credited") > 0 || p["reason"] === "failed" || p["reason"] === "budget-exceeded" ? "home" : "flow",
  "journal.copy.written": "home",
  "journal.copy.failed": "home",
  "handoff.written": "home",
  "handoff.cleared": "home",
  "sleep.cycle": (p) => isSleepCheck(p) ? "flow" : "home",
  "prospective.fire": "home",
  "prospective.plain": "home",
  "dream.journaled": "home",
  "dream.changed": "home",
  "dream.undone": "home",
  "band.demoted": "home",
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
  "sweep.wake": "flow"
};
export function laneOf(name, p) {
  const rule = LANES[name];
  if (rule === undefined)
    return "flow";
  return typeof rule === "function" ? rule(p) : rule;
}
export function iconOf(name, p) {
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
