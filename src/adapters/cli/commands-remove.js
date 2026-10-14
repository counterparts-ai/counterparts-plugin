import { ID_PREFIX, Store, storeExists } from "../../core/store/index.js";
import { planRemoval, ownerRemoval, removalRefusal } from "./removal.js";
import { isInteractive, confirm, isPromptAborted, ask } from "./ui.js";
import { EXIT, openStoreAt, describeDirRefusal } from "./commands-shared.js";
export async function removeCommand(dir, io, env, positional, flags, now) {
  if (flags["confirm"] === true || !isInteractive(io, env)) {
    return removeByIdCommand(dir, io, positional[0], flags, now);
  }
  return removeInteractively(dir, io, positional, flags, now);
}
function removalPlanOptions(flags) {
  const crossScopeContent = flags["strike-by-content-across-scopes"] === true;
  const echoScanRaw = typeof flags["echo-scan"] === "string" ? Number(flags["echo-scan"]) : NaN;
  return {
    crossScopeContent,
    ...Number.isFinite(echoScanRaw) && echoScanRaw >= 0 ? { echoScanMax: Math.floor(echoScanRaw) } : {}
  };
}
async function removeByIdCommand(dir, io, raw, flags, now) {
  const targetId = raw?.trim();
  if (targetId === undefined || targetId.length === 0) {
    io.err("remove needs a memory id");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const planOpts = removalPlanOptions(flags);
  const planning = openStoreAt({ dir, observer: true });
  let plan;
  try {
    plan = planRemoval(planning, targetId, planOpts);
  } finally {
    planning.close();
  }
  if (!plan.valid) {
    io.err(removalRefusalLine(plan.reason, targetId));
    return EXIT.refused;
  }
  printRemovalPlan(io, plan);
  if (flags["confirm"] !== true) {
    io.out("");
    io.out("Dry run. Nothing has changed. Re-run with --confirm to remove.");
    return EXIT.ok;
  }
  if (io.prompt === undefined) {
    io.err("refused: removal requires an interactive confirmation and this console has no prompt.");
    return EXIT.refused;
  }
  const answer = (await io.prompt(`Type the id to remove it permanently [${targetId}]: `)).trim();
  if (answer !== targetId) {
    io.err("refused: the confirmation did not match. Nothing has changed.");
    return EXIT.refused;
  }
  const store = openStoreAt({ dir });
  try {
    const outcome = removeOne(store, io, targetId, flags, now, planOpts, "scripted");
    return outcome === "removed" ? EXIT.ok : outcome === "refused" ? EXIT.refused : EXIT.failed;
  } finally {
    store.close();
  }
}
function removeOne(store, io, targetId, flags, now, planOpts, door) {
  try {
    const replan = planRemoval(store, targetId, planOpts);
    if (!replan.valid) {
      io.err(door === "scripted" ? `refused after re-plan: ${replan.reason}. Nothing has changed.` : `refused after re-plan: ${replan.reason} (${targetId}). That memory is untouched.`);
      return "refused";
    }
    const outcome = ownerRemoval(store, {
      targetId,
      actor: "owner",
      reason: typeof flags["reason"] === "string" ? flags["reason"] : "owner request",
      requestedAt: now()
    }, { ...planOpts, onEvent: (name, data) => io.out(`  ${name} ${JSON.stringify(data)}`) });
    io.out("");
    io.out(`Removed ${targetId}.`);
    io.out(`  chased: ${outcome.chased.join(", ") || "nothing"}`);
    io.out(`  unchased (dark via the deny-list, never silently dropped): ${outcome.unchased.join(", ") || "nothing"}`);
    io.out(`  left on purpose (not a failure — this removal was never entitled to it): ${outcome.leftAlone.join(", ") || "nothing"}`);
    io.out(`  removal record: ${outcome.notes.length} stages appended`);
    return "removed";
  } catch (err) {
    io.err(`removal failed: ${describeDirRefusal(err)}`);
    return "failed";
  }
}
function printRemovalPlan(io, plan) {
  io.out(`Removal plan for ${plan.targetId}:`);
  for (const surface of plan.surfaces)
    io.out(`  chase ${surface.surface}: ${surface.count}`);
  io.out(plan.spans.state === "held" ? `  chased — ${plan.spans.line}` : plan.spans.state === "unknown" ? `  NOT chased — ${plan.spans.line}` : `  ${plan.spans.line}`);
  for (const name of plan.unchasable) {
    if (name === plan.spans.line)
      continue;
    io.out(`  CANNOT chase ${name} — the id goes dark via the deny-list instead`);
  }
  for (const name of plan.leftAlone)
    io.out(`  LEFT on purpose — ${name}`);
  io.out(`  other memories whose text overlaps (ids only): ${plan.contamination.length}`);
  for (const id of plan.contamination)
    io.out(`    ${id}`);
}
function removalRefusalLine(reason, targetId) {
  return reason === "is-the-self-page" ? `refused: ${targetId} is the self page, and removal is not how a page goes away — it would tombstone the row that every session's wake and the schema index read. Unwrite it with 'counterparts self-page --clear', which keeps what it said as a version you can restore.` : `refused: ${reason} (${targetId})`;
}
const MEMORY_ID_SHAPE = new RegExp(`^(?:${Object.values(ID_PREFIX).join("|")})_[0-9a-z]+$`);
function looksLikeMemoryId(token) {
  return MEMORY_ID_SHAPE.test(token);
}
const REMOVE_SEARCH_LIMIT = 10;
const REMOVE_SUMMARY_WIDTH = 64;
const NOTHING_DELETED = "Cancelled. Nothing was deleted.";
async function removeInteractively(dir, io, positional, flags, now) {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const planOpts = removalPlanOptions(flags);
  let chosen;
  let go;
  try {
    chosen = await chooseForRemoval(dir, io, positional);
    if (chosen.length === 0)
      return EXIT.refused;
    const inspected = inspectForRemoval(dir, chosen, planOpts);
    if (inspected.refused !== null) {
      io.err(removalRefusalLine(inspected.refused.reason, inspected.refused.id));
      io.out(NOTHING_DELETED);
      return EXIT.refused;
    }
    for (const entry of inspected.entries) {
      io.out("");
      io.out(`  ${entry.line}`);
      printRemovalPlan(io, entry.plan);
    }
    io.out("");
    go = await confirm(io, chosen.length === 1 ? "Delete this memory for good?" : `Delete these ${chosen.length} memories for good?`, { default: false });
  } catch (err) {
    if (!isPromptAborted(err))
      throw err;
    io.out(NOTHING_DELETED);
    return EXIT.refused;
  }
  if (!go) {
    io.out(NOTHING_DELETED);
    return EXIT.refused;
  }
  const store = openStoreAt({ dir });
  let removed = 0;
  let refused = 0;
  let failed = 0;
  try {
    for (const targetId of chosen) {
      const outcome = removeOne(store, io, targetId, flags, now, planOpts, "picked");
      if (outcome === "removed")
        removed += 1;
      else if (outcome === "refused")
        refused += 1;
      else
        failed += 1;
    }
  } finally {
    store.close();
  }
  if (refused + failed > 0) {
    io.out("");
    io.out(`${removed} of ${chosen.length} removed. The ${refused + failed} not removed ${refused + failed === 1 ? "is" : "are"} untouched, and named above.`);
  }
  return failed > 0 ? EXIT.failed : refused > 0 ? EXIT.refused : EXIT.ok;
}
async function chooseForRemoval(dir, io, positional) {
  const typed = positional.map((word) => word.trim()).filter((word) => word.length > 0);
  const named = allIds(typed);
  if (named !== null)
    return named;
  const query = typed.length > 0 ? typed.join(" ") : (await ask(io, "Memory id, or words to search for:")).trim();
  if (query.length === 0) {
    io.out(NOTHING_DELETED);
    return [];
  }
  const atThePrompt = allIds(query.split(/\s+/).filter((word) => word.length > 0));
  if (atThePrompt !== null)
    return atThePrompt;
  const found = searchForRemoval(dir, query);
  const candidates = found.candidates;
  if (candidates.length === 0) {
    io.out(`Nothing matched “${query}”.`);
    io.out(NOTHING_DELETED);
    return [];
  }
  io.out("");
  candidates.forEach((candidate, index) => io.out(`  ${index + 1}. ${candidate.line}`));
  if (found.truncated) {
    io.out(`  (the ${candidates.length} closest — add a word or two to narrow it)`);
  }
  io.out("");
  for (let attempt = 0;attempt < 2; attempt += 1) {
    const picks = parsePicks(await ask(io, "Which one? (a number, or several like 1,3):"), candidates.length);
    if (picks !== null)
      return picks.map((n) => candidates[n - 1]?.id ?? "");
    if (attempt === 0) {
      io.out(`Answer with a number from 1 to ${candidates.length}, or several like 1,3.`);
    }
  }
  io.out(NOTHING_DELETED);
  return [];
}
function allIds(words) {
  if (words.length === 0)
    return null;
  if (!words.every(looksLikeMemoryId))
    return null;
  return [...new Set(words)];
}
function parsePicks(answer, count) {
  const trimmed = answer.trim();
  if (!/^[0-9]+(?:[ \t,]+[0-9]+)*$/.test(trimmed))
    return null;
  const picked = [];
  for (const part of trimmed.split(/[\s,]+/)) {
    const n = Number(part);
    if (n < 1 || n > count)
      return null;
    if (!picked.includes(n))
      picked.push(n);
  }
  return picked;
}
function searchForRemoval(dir, query) {
  const fetch = REMOVE_SEARCH_LIMIT * 2;
  const store = openStoreAt({ dir, observer: true });
  try {
    const out = [];
    const hits = store.search(query, fetch);
    let truncated = hits.length === fetch;
    for (const hit of hits) {
      if (out.length === REMOVE_SEARCH_LIMIT) {
        truncated = true;
        break;
      }
      if (removalRefusal(store, hit.id) !== null)
        continue;
      const row = store.row(hit.id);
      if (row === undefined)
        continue;
      out.push({ id: hit.id, line: candidateLine(row) });
    }
    return { candidates: out, truncated };
  } finally {
    store.close();
  }
}
function inspectForRemoval(dir, chosen, planOpts) {
  const store = openStoreAt({ dir, observer: true });
  try {
    const entries = [];
    for (const id of chosen) {
      const plan = planRemoval(store, id, planOpts);
      if (!plan.valid)
        return { refused: { id, reason: plan.reason }, entries: [] };
      const row = store.row(id);
      entries.push({ line: row === undefined ? id : candidateLine(row), plan });
    }
    return { refused: null, entries };
  } finally {
    store.close();
  }
}
function candidateLine(row) {
  const marks = `${row.type === "episode" ? "[journal] " : ""}${row.confidential === 1 ? "[confidential] " : ""}`;
  return `${row.id}  ${marks}${row.kind} — ${summaryOf(row)}  (${row.learned_on})`;
}
function summaryOf(row) {
  const titled = row.title !== null && row.title.trim().length > 0;
  if (!titled && row.confidential === 1)
    return "(untitled)";
  const raw = titled ? row.title ?? "" : row.body.split(`
`).find((line) => line.trim().length > 0) ?? "";
  const one = raw.replace(/\s+/g, " ").trim();
  if (one.length === 0)
    return "(no words)";
  return one.length <= REMOVE_SUMMARY_WIDTH ? one : `${one.slice(0, REMOVE_SUMMARY_WIDTH - 1)}…`;
}
