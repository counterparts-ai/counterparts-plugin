import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { NIGHT_WRITE_UP_EVENT } from "../../core/counterpart.js";
import { calendarDate } from "../../core/self/index.js";
import { TUNABLES } from "../config.js";
import {
  NIGHT_RUNNER_PREFIX,
  WRITE_UP_CLAIM_MS,
  WRITE_UP_PART_BYTES,
  claimedByOther,
  firstUnwrittenPart,
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
  writeUpStanding
} from "../sessions.js";
export const CATCH_UP_TOOLS = ["mcp__counterparts__session_end"];
export const CATCH_UP_RUN_PREFIX = "cup_";
export function newCatchUpRunId() {
  return `${CATCH_UP_RUN_PREFIX}${randomBytes(6).toString("hex")}`;
}
export function catchUpRunner(run, batch = 1) {
  return batch <= 1 ? `${NIGHT_RUNNER_PREFIX}${run}` : `${NIGHT_RUNNER_PREFIX}${run}-${String(batch)}`;
}
export function plannedParts(plan) {
  return plan.subjects.reduce((n, s) => n + s.served, 0);
}
export function catchUpOwing(plan, dataDir) {
  return plan.filter((h) => h.owes && pointable(h, dataDir));
}
export function owedBefore(c, date) {
  try {
    const zone = c.store.zone();
    return catchUpOwing(writeUpPlan({ store: c.store, spans: c.spans }), c.store.dir).filter((h) => calendarDate(h.clockFrom, zone) < date).length;
  } catch {
    return null;
  }
}
export const NOTHING_OWED_BEFORE_KEY = "night.nothing-owed-before";
export function planCatchUp(c, opts) {
  const runner = opts.runner ?? catchUpRunner(opts.run);
  const maxSessions = opts.sessions ?? Number.POSITIVE_INFINITY;
  const maxBytes = opts.bytes ?? TUNABLES.NIGHT_WRITE_UP_BYTES;
  const maxParts = Math.max(1, Math.min(opts.parts ?? TUNABLES.NIGHT_WRITE_UP_BATCH_PARTS, opts.room ?? Number.POSITIVE_INFINITY));
  const dir = c.store.dir;
  const zone = c.store.zone();
  const plan = writeUpPlan({ store: c.store, spans: c.spans });
  const progress = readWriteUpProgress(c.store);
  const owing = catchUpOwing(plan, dir).sort((a, b) => a.clockFrom - b.clockFrom || (a.session < b.session ? -1 : 1));
  const subjects = [];
  let busy = 0;
  let bounded = 0;
  let total = 0;
  let taken = 0;
  for (const h of owing) {
    if (claimedByOther(progress, h.session, runner, opts.now) !== null) {
      busy += 1;
      continue;
    }
    let here = null;
    for (const scope of h.scopes) {
      const s = writeUpStanding(plan, dir, h.session, scope, opts.now, { progress });
      if (s.status === "owed") {
        here = s.here;
        break;
      }
    }
    if (here === null)
      continue;
    const p = progress[progressKey(h.session, here)];
    const chunk = p?.chunk ?? WRITE_UP_PART_BYTES;
    if (p !== undefined && p.answer !== undefined && p.waiting !== true) {
      if (subjects.length >= maxSessions || taken >= maxParts) {
        bounded += 1;
        continue;
      }
      subjects.push({ session: h.session, here, lived: calendarDate(h.clockFrom, zone), from: p.parts, upTo: p.parts, of: p.parts, bytes: 0, done: Math.min(p.done, p.parts), served: 1, passed: [] });
      taken += 1;
      continue;
    }
    const parts = writeUpPartsDated(writeUpEntries(c.spans, { session: h.session, scopes: [here] }), chunk);
    const done = Math.min(p?.done ?? 0, parts.length);
    if (done >= parts.length)
      continue;
    if (subjects.length >= maxSessions || taken >= maxParts) {
      bounded += 1;
      continue;
    }
    const from = firstUnwrittenPart(parts, done + 1);
    const passedParts = [];
    for (let k = done + 1;k < from; k++)
      passedParts.push(k);
    let upTo = from - 1;
    let served = 0;
    let bytes = 0;
    for (let k = from;k <= parts.length; k++) {
      const part = parts[k - 1];
      if (part === undefined)
        break;
      if (k > from && k < parts.length && part.unwritten === 0) {
        passedParts.push(k);
        continue;
      }
      const b = Buffer.byteLength(part.text, "utf8");
      if (taken + served >= maxParts)
        break;
      if (total + bytes + b > maxBytes && !(total === 0 && served === 0))
        break;
      served += 1;
      bytes += b;
      upTo = k;
    }
    while (passedParts.length > 0 && passedParts[passedParts.length - 1] > upTo)
      passedParts.pop();
    if (served === 0) {
      bounded += 1;
      continue;
    }
    if (upTo < parts.length)
      bounded += 1;
    total += bytes;
    taken += served;
    const first = parts[from - 1];
    subjects.push({
      session: h.session,
      here,
      lived: calendarDate(first !== undefined && first.lastAt > 0 ? first.lastAt : h.clockFrom, zone),
      from,
      upTo,
      of: parts.length,
      bytes,
      done,
      served,
      passed: passedParts
    });
  }
  return { runner, subjects, owed: owing.length, busy, bounded, bytes: total };
}
export function owedParts(c, now) {
  const dir = c.store.dir;
  const plan = writeUpPlan({ store: c.store, spans: c.spans });
  const progress = readWriteUpProgress(c.store);
  let n = 0;
  for (const h of plan) {
    if (!h.owes || !pointable(h, dir))
      continue;
    for (const scope of h.scopes) {
      const s = writeUpStanding(plan, dir, h.session, scope, now, { progress });
      if (s.status !== "owed")
        continue;
      const p = progress[progressKey(h.session, s.here)];
      if (p !== undefined && p.answer !== undefined && p.waiting !== true)
        continue;
      const parts = writeUpPartsDated(writeUpEntries(c.spans, { session: h.session, scopes: [s.here] }), p?.chunk ?? WRITE_UP_PART_BYTES);
      n += Math.max(0, parts.length - Math.min(p?.done ?? 0, parts.length));
    }
  }
  return n;
}
export function grantCatchUp(c, plan, opts) {
  const dir = c.store.dir;
  const scope = opts.scope.length > 0 ? opts.scope : dir;
  const kept = [];
  const ok = updateWriteUpProgress(c.store, (all) => {
    kept.length = 0;
    for (const s of plan.subjects) {
      if (claimedByOther(all, s.session, plan.runner, opts.now) !== null)
        continue;
      const key = progressKey(s.session, s.here);
      const p = all[key];
      all[key] = {
        ...p ?? {},
        chunk: p?.chunk ?? WRITE_UP_PART_BYTES,
        parts: s.of,
        done: Math.min(p?.done ?? 0, s.of),
        handedAt: opts.now,
        claim: { by: plan.runner, at: opts.now, upTo: s.upTo }
      };
      kept.push(s);
    }
    return kept.length > 0;
  });
  if (!ok)
    return null;
  const claimed = { ...plan, subjects: [...kept], busy: plan.busy + (plan.subjects.length - kept.length) };
  if (kept.length === 0)
    return claimed;
  try {
    if (grantWriteUps(dir, { runner: plan.runner, scope, subjects: kept.map((s) => s.session), at: opts.now }))
      return claimed;
  } catch {}
  releaseCatchUp(c, claimed, { scope: opts.scope, now: opts.now });
  return null;
}
export function endStaleRunners(dir, now) {
  let n = 0;
  try {
    for (const r of listSessions(dir)) {
      if (!r.sessionId.startsWith(NIGHT_RUNNER_PREFIX) || r.endedAt !== null)
        continue;
      if (now - r.lastBoundaryAt < WRITE_UP_CLAIM_MS)
        continue;
      grantWriteUps(dir, { runner: r.sessionId, scope: r.scope, subjects: [], at: now });
      recordSession(dir, { sessionId: r.sessionId, scope: r.scope, phase: "end", at: now });
      n += 1;
    }
  } catch {}
  return n;
}
export function releaseCatchUp(c, plan, opts) {
  const dir = c.store.dir;
  const scope = opts.scope.length > 0 ? opts.scope : dir;
  try {
    updateWriteUpProgress(c.store, (map) => {
      let changed = false;
      for (const [key, p] of Object.entries(map)) {
        if (p.claim?.by !== plan.runner)
          continue;
        const { claim: _mine, ...rest } = p;
        map[key] = rest;
        changed = true;
      }
      return changed;
    });
  } catch {}
  try {
    grantWriteUps(dir, { runner: plan.runner, scope, subjects: [], at: opts.now });
    recordSession(dir, { sessionId: plan.runner, scope, phase: "end", at: opts.now });
  } catch {}
}
export function catchUpPrompt(plan) {
  const lines = [
    "You are catching up, in a windowless session of your own: some conversations ended before they were written up, and you write them up now — second-hand, from what was said and what that session said back.",
    `Use only the counterparts session_end tool, always with session: "${plan.runner}". For each session below, in order:`,
    "1. Call session_end with writeUp: <its id> and no memories. It returns one part of that conversation.",
    '2. Call session_end with writeUp: <its id>, part: <that part>, memories: [...] — what caught your attention in it, one idea each, in your own words. Do not write again what is marked as already written up. If nothing that is not marked so is worth keeping, send memories: [] with nothing: "<one line: why>"; an empty answer without that line is refused while the part holds words not yet written up.',
    `3. Fetch again for its next part, until the answer is "written-up" or the door says this run's allowance for it is spent. Then the next session.`,
    "",
    "Sessions:",
    ...plan.subjects.map((s) => `- ${s.session}: lived ${s.lived}; ${s.upTo === s.from ? `part ${String(s.from)}` : `parts ${String(s.from)}–${String(s.upTo)}`} of ${String(s.of)}.`),
    "",
    "When every session above is done, stop. Nothing else is needed."
  ];
  return lines.join(`
`);
}
function measure(c, subjects, now) {
  const after = writeUpPlan({ store: c.store, spans: c.spans });
  const progress = readWriteUpProgress(c.store);
  let written = 0;
  let parts = 0;
  let allowed = 0;
  let passed = 0;
  let unread = 0;
  const tally = (s, reached) => {
    if (s.served === undefined || s.passed === undefined)
      return;
    const back = s.passed.filter((k) => k <= reached).length;
    passed += back;
    unread += Math.max(0, s.served - Math.max(0, reached - s.done - back));
  };
  for (const s of subjects) {
    if (writeUpStanding(after, c.store.dir, s.session, s.here, now, { progress }).status !== "owed") {
      written += 1;
      allowed += 1;
      parts += Math.max(0, s.of - s.done);
      tally(s, Math.max(s.upTo, s.done + (s.served ?? 0)));
      continue;
    }
    const p = progress[progressKey(s.session, s.here)];
    if (p !== undefined)
      parts += Math.max(0, p.done - s.done);
    if (p !== undefined && p.done >= s.upTo && p.done > s.done)
      allowed += 1;
    tally(s, Math.min(Math.max(p?.done ?? s.done, s.done), s.upTo));
  }
  const left = after.filter((h) => h.owes && pointable(h, c.store.dir)).length;
  return { written, parts, left, allowed, passed, unread };
}
async function runChild(input, plan, prompt) {
  const child = input.plan({ prompt, runner: plan.runner });
  if (!child.ok)
    return { state: "could-not-start", code: null };
  try {
    const result = await input.start(child);
    const state = result.spawnCode !== undefined || result.code === null && !result.timedOut && result.error !== null ? "could-not-start" : result.timedOut ? "timed-out" : result.code === 0 ? "done" : "failed";
    return { state, code: result.code };
  } catch {
    return { state: "could-not-start", code: null };
  }
}
export async function runCatchUp(input) {
  const startedAt = input.now();
  const deadline = startedAt + (input.totalMs ?? TUNABLES.NIGHT_WRITE_UP_TOTAL_MS);
  let room = input.parts ?? TUNABLES.NIGHT_WRITE_UP_PARTS;
  const granted = new Map;
  let batches = 0;
  let state = "done";
  let code = null;
  let parts = 0;
  let passed = 0;
  let unread = 0;
  let busy = 0;
  let bytes = 0;
  let owed = 0;
  let limit = null;
  for (;; ) {
    if (batches > 0 && room <= 0) {
      limit = "parts";
      break;
    }
    if (batches > 0 && input.now() + TUNABLES.NIGHT_WRITE_UP_MS > deadline) {
      limit = "time";
      break;
    }
    const at = input.now();
    let plan;
    let prompt = "";
    let lost = false;
    try {
      const c = input.open();
      try {
        if (batches === 0)
          endStaleRunners(c.store.dir, at);
        plan = planCatchUp(c, { run: input.run, runner: catchUpRunner(input.run, batches + 1), now: at, room });
        if (batches === 0) {
          if (plan.owed === 0)
            return null;
          owed = plan.owed;
        }
        if (plan.subjects.length > 0) {
          const claimed = grantCatchUp(c, plan, { scope: input.scope, now: at });
          if (claimed === null)
            lost = true;
          else {
            plan = claimed;
            if (plan.subjects.length > 0)
              prompt = catchUpPrompt(plan);
          }
        }
      } finally {
        c.close();
      }
    } catch {
      if (batches === 0)
        return null;
      state = "partial";
      break;
    }
    busy = plan.busy;
    if (lost) {
      state = batches === 0 ? "could-not-start" : "partial";
      break;
    }
    if (plan.subjects.length === 0) {
      if (batches === 0)
        state = "none-granted";
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
    } catch {}
    const child = await runChild(input, plan, prompt);
    code = child.code;
    let m = null;
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
    if (m !== null) {
      parts += m.parts;
      passed += m.passed;
      unread += m.unread;
    }
    if (child.state !== "done") {
      state = child.state === "could-not-start" && batches > 1 ? "partial" : child.state;
      break;
    }
    if (m === null || m.allowed < plan.subjects.length || m.parts === 0 && m.written === 0) {
      state = "partial";
      break;
    }
  }
  const endedAt = input.now();
  const report = (over) => ({
    run: input.run,
    runner: catchUpRunner(input.run),
    state,
    granted: granted.size,
    written: 0,
    parts,
    passed,
    unread,
    left: owed,
    partsLeft: null,
    bounded: 0,
    busy,
    bytes,
    ms: endedAt - startedAt,
    code,
    batches,
    limit,
    ...over
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
function record(input, report, open) {
  const data = {
    run: report.run,
    runner: report.runner,
    state: report.state,
    granted: report.granted,
    written: report.written,
    parts: report.parts,
    passed: report.passed,
    unread: report.unread,
    left: report.left,
    partsLeft: report.partsLeft,
    bounded: report.bounded,
    busy: report.busy,
    bytes: report.bytes,
    ms: report.ms,
    code: report.code,
    batches: report.batches,
    limit: report.limit
  };
  try {
    const write = (c) => {
      if (c.observer)
        return;
      c.store.appendEvent({ name: NIGHT_WRITE_UP_EVENT, day: c.store.livedDay(), ref: report.run, payload: data, dedupKey: `${NIGHT_WRITE_UP_EVENT}:${report.run}` });
    };
    if (open !== undefined)
      write(open);
    else {
      const c = input.open();
      try {
        write(c);
      } finally {
        c.close();
      }
    }
  } catch {}
  try {
    input.onEvent?.({ at: input.now(), name: NIGHT_WRITE_UP_EVENT, ref: report.run, data });
  } catch {}
  return report;
}
export function catchUpOf(store, run) {
  try {
    const rows = store.eventLog({ name: NIGHT_WRITE_UP_EVENT, order: "desc", limit: 20 });
    for (const r of rows) {
      if (run !== undefined && r.ref !== run)
        continue;
      const p = JSON.parse(r.payload ?? "{}");
      const n = (k) => typeof p[k] === "number" ? p[k] : 0;
      const state = p["state"];
      return {
        run: typeof r.ref === "string" ? r.ref : "",
        at: r.at,
        state: typeof state === "string" ? state : "done",
        granted: n("granted"),
        written: n("written"),
        parts: n("parts"),
        passed: n("passed"),
        unread: n("unread"),
        left: n("left"),
        bounded: n("bounded"),
        busy: n("busy"),
        bytes: n("bytes"),
        ms: n("ms"),
        code: typeof p["code"] === "number" ? p["code"] : null,
        partsLeft: typeof p["partsLeft"] === "number" ? p["partsLeft"] : null,
        batches: typeof p["batches"] === "number" ? p["batches"] : 1,
        limit: p["limit"] === "parts" || p["limit"] === "time" ? p["limit"] : null
      };
    }
  } catch {}
  return null;
}
export function catchUpWords(r) {
  const n = (k, one, many) => `${String(k)} ${k === 1 ? one : many}`;
  const partsLeft = typeof r.partsLeft === "number" && r.partsLeft > 0 ? `, ${n(r.partsLeft, "part", "parts")}` : "";
  const left = r.left === 0 ? "nothing left owed" : `${n(r.left, "session", "sessions")} still owed${partsLeft}`;
  if (r.state === "none-granted")
    return `nothing to take (${n(r.busy, "session was", "sessions were")} being written up elsewhere); ${left}`;
  if (r.state === "could-not-start")
    return `could not start; ${left}`;
  const how = r.state === "timed-out" ? " before its watchdog stopped it" : r.state === "failed" ? " before it failed" : r.state === "partial" ? " — it stopped before the rest (a usage limit, or it gave up)" : "";
  const over = r.bounded === 0 ? "" : r.limit === "time" ? " (it stopped at its hour)" : ` (${n(r.bounded, "was", "were")} over the run's ceiling)`;
  const passed = typeof r.passed === "number" && r.passed > 0 ? `, ${String(r.passed)} of them already written up in their own session` : "";
  const unread = typeof r.unread === "number" && r.unread > 0 ? `; ${n(r.unread, "part", "parts")} unread` : "";
  return `caught up ${String(r.written)} of ${n(r.granted, "session", "sessions")} (${n(r.parts, "part", "parts")} written${passed}${unread})${how}; ${left}${over}`;
}
