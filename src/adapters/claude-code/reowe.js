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
  writeUpStanding
} from "../sessions.js";
function isRunner(session, run) {
  const base = `${NIGHT_RUNNER_PREFIX}${run}`;
  return session !== null && (session === base || session.startsWith(`${base}-`) && /^\d+$/.test(session.slice(base.length + 1)));
}
function runAnswers(dataDir, run) {
  let startedAt = null;
  const bySession = new Map;
  for (const date of logDates(dataDir)) {
    for (const e of readLog(dataDir, date).entries) {
      const mine = isRunner(e.session, run) || e.data["run"] === run;
      if (!mine)
        continue;
      const at = Date.parse(e.at);
      if (Number.isFinite(at))
        startedAt = startedAt === null ? at : Math.min(startedAt, at);
      if (e.name !== "mcp.write_up" || e.ref === null)
        continue;
      const reason = e.data["reason"];
      if (reason !== "part-written" && reason !== "written-up" && reason !== "written-up-here")
        continue;
      const part = e.data["part"];
      if (typeof part !== "number")
        continue;
      const deposited = typeof e.data["deposited"] === "number" ? e.data["deposited"] : 0;
      const s = bySession.get(e.ref) ?? { parts: new Map, of: null };
      s.parts.set(part, (s.parts.get(part) ?? 0) + deposited);
      if (typeof e.data["of"] === "number")
        s.of = e.data["of"];
      bySession.set(e.ref, s);
    }
  }
  return { startedAt, bySession };
}
export function reowePlan(c, run, now) {
  const dir = c.store.dir;
  const { startedAt, bySession } = runAnswers(dir, run);
  if (startedAt === null || bySession.size === 0)
    return { run, found: false, startedAt, subjects: [] };
  const plan = writeUpPlan({ store: c.store, spans: c.spans });
  const progress = readWriteUpProgress(c.store);
  const subjects = [];
  for (const [session, answers] of [...bySession.entries()].sort(([a], [b]) => a < b ? -1 : 1)) {
    const empty = [...answers.parts.entries()].filter(([, d]) => d === 0).map(([k]) => k).sort((a, b) => a - b);
    const deposited = [...answers.parts.entries()].filter(([, d]) => d > 0).map(([k]) => k).sort((a, b) => a - b);
    if (empty.length === 0)
      continue;
    const base = { session, empty, deposited };
    const held = plan.find((h) => h.session === session);
    let here = null;
    let atRun = [];
    for (const scope of held?.scopes ?? []) {
      const chunk = progress[progressKey(session, scope)]?.chunk ?? WRITE_UP_PART_BYTES;
      const parts = writeUpPartsDated(writeUpEntries(c.spans, { session, scopes: [scope] }, { coveredBefore: startedAt }), chunk);
      if (parts.length === 0)
        continue;
      if (here === null || parts.length === answers.of) {
        here = scope;
        atRun = parts;
      }
      if (parts.length === answers.of)
        break;
    }
    if (here === null) {
      subjects.push({ ...base, kept: [], unwritten: [], status: "pruned", here: null, resetTo: null });
      continue;
    }
    const kept = empty.filter((k) => (atRun[k - 1]?.unwritten ?? 0) === 0);
    const unwritten = empty.filter((k) => (atRun[k - 1]?.unwritten ?? 0) > 0);
    const decided = (status, resetTo = null) => {
      subjects.push({ ...base, kept, unwritten, status, here, resetTo });
    };
    if (unwritten.length === 0) {
      decided("nothing-to-reowe");
      continue;
    }
    const first = unwritten[0];
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
    const nowParts = writeUpPartsDated(writeUpEntries(c.spans, { session, scopes: [here] }), p.chunk);
    let same = true;
    for (let k = first;k <= p.done; k++)
      if (nowParts[k - 1]?.text !== atRun[k - 1]?.text)
        same = false;
    if (!same) {
      decided("needs-retraction");
      continue;
    }
    decided("reowe", first - 1);
  }
  return { run, found: true, startedAt, subjects };
}
export function applyReowe(c, plan, now) {
  const moved = [];
  updateWriteUpProgress(c.store, (all) => {
    moved.length = 0;
    for (const s of plan.subjects) {
      if (s.status !== "reowe" || s.here === null || s.resetTo === null)
        continue;
      if (claimedByOther(all, s.session, undefined, now) !== null)
        continue;
      const key = progressKey(s.session, s.here);
      const p = all[key];
      if (p === undefined || p.done < s.resetTo)
        continue;
      const { answer: _answered, ...rest } = p;
      all[key] = { ...rest, done: s.resetTo };
      moved.push(s.session);
    }
    return moved.length > 0;
  });
  return moved;
}
export function reoweLine(s) {
  const n = (k, one, many) => `${String(k)} ${k === 1 ? one : many}`;
  const list = (ks) => ks.join(", ");
  const head = `  ${s.session}: ${n(s.empty.length, "part", "parts")} closed with nothing kept (${list(s.empty)})`;
  const split = s.kept.length + s.unwritten.length === 0 ? "" : `; ${String(s.kept.length)} already written up before the run, ${String(s.unwritten.length)} with words not yet written up${s.unwritten.length > 0 ? ` (${list(s.unwritten)})` : ""}`;
  const what = {
    "nothing-to-reowe": "nothing to re-owe: the session's own chapters or notes had written them up",
    reowe: `would be owed again from part ${String((s.resetTo ?? 0) + 1)}`,
    pruned: "refused: its words are no longer kept, so there is nothing to re-serve",
    "needs-retraction": "refused: the run (or a later writer) has claimed those words since — marked the session written up, or a later memory took them — and taking a claim back is not built",
    "after-deposits": "refused: parts after them brought memories back, and owing these again would hand those back too",
    busy: "refused: another writer is writing it up right now; try again after"
  };
  return `${head}${split} — ${what[s.status]}.`;
}
