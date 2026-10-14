import { dreamSkippedOf, nightPartsWords, nightRunWords } from "../../core/dream/index.js";
import { acceptsReflectedFeeling, reconsiderWords } from "../../core/sleep/index.js";
export function memoryWords(source, id, max = 80) {
  if (id === null)
    return "(removed by the owner)";
  const row = source.store.row(id);
  if (row === undefined)
    return "(no such memory)";
  if (row.confidential === 1)
    return "[confidential]";
  if (row.body === "")
    return "(removed by the owner)";
  const line = ((row.title ?? "").trim() || (row.body.split(`
`).find((l) => l.trim().length > 0) ?? "")).replace(/\s+/g, " ").trim();
  const said = line.length > max ? `${line.slice(0, max - 1)}…` : line;
  return row.archived === 1 ? `${said} (archived: ${row.archived_reason ?? "archived"})` : said;
}
function countsLine(counts) {
  const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${String(n)} ${k}`);
  return parts.length === 0 ? "no changes" : parts.join(", ");
}
export function dreamingSettingWords(setting) {
  switch (setting) {
    case "auto":
      return "Once a day, the first session starts the nightly run by itself — the page writer, then a dream, then a reflection — in a separate, windowless claude -p in the background, and says so in one line; if it cannot start, the next prompt asks instead and says why. Say 'no dreams' in a session, or counterparts dream --setting off, to turn it off.";
    case "ask":
      return "Once a day, the first session shows you the question in the terminal before it starts the nightly run; say 'dream' to start it, 'dream on your own' to let it start by itself each day, or nothing and it waits. (A memory with no setting reads as this; a new install starts on auto.)";
    case "off":
      return "No dreams: nothing starts the nightly run and nothing asks. counterparts dream --setting ask (or auto) turns it back on.";
  }
}
export function nightRunLine(run) {
  const what = run.kind === "reflection" ? "the reflection alone" : dreamSkippedOf(run) !== null ? "the catch-up alone" : "the whole night";
  const parts = run.state === "done" || run.state === "partial" ? ` — ${nightPartsWords(run)}` : "";
  const why = run.state === "done" || run.state === "started" || run.state === "partial" && run.reason === "unfinished" ? "" : `: ${nightRunWords(run)}`;
  return `Latest headless run: ${run.run}  ${run.date}  ${run.state} (${what})${parts}${why}`;
}
export const DREAM_LIST_LIMIT = 20;
export function dreamListLines(counterpart, limit = DREAM_LIST_LIMIT) {
  const total = counterpart.store.dreamCount();
  const dreams = counterpart.dreams.list(limit === "all" ? Math.max(1, total) : limit);
  const setting = counterpart.dreams.setting();
  const night = counterpart.dreams.nightRun();
  const head = [`Dreaming: ${setting}. ${dreamingSettingWords(setting)}`, ...night === null ? [] : [nightRunLine(night)], ""];
  if (dreams.length === 0) {
    return [...head, "No dreams yet."];
  }
  const out = [
    ...head,
    dreams.length < total ? `Dreams — newest first (${String(dreams.length)} of ${String(total)} shown; every one: counterparts dream --list --all)` : `Dreams — newest first (all ${String(dreams.length)})`,
    ""
  ];
  for (const { dream, counts } of dreams) {
    const when = dream.date ?? `lived day ${String(dream.day)}`;
    const title = dream.title === null || dream.title.length === 0 ? "(no journal)" : `"${dream.title}"`;
    out.push(`${dream.id}  ${when}  ${dream.state.padEnd(9)} ${title} — ${countsLine(counts)}`);
  }
  out.push("", "Read one: counterparts dream --show <id>    Reverse one: counterparts dream --undo <id>");
  const reflections = counterpart.reflections.list(10);
  if (reflections.length > 0) {
    out.push("", `Reflections — the waking self, newest first (${String(reflections.length)} shown)`, "");
    for (const r of reflections)
      out.push(`${r.id}  ${r.date ?? `lived day ${String(r.day)}`}  ${reflectionSummary(r)}`);
    out.push("", "Read one: counterparts dream --show <rfl_…>");
  }
  return out;
}
export function parseIdList(json) {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export const SHARE_STATE_WORDS = {
  none: "no share",
  offered: "share not told yet",
  carried: "share carried to a later session",
  told: "share told"
};
export function reflectionSummary(r) {
  const parts = [];
  parts.push(r.dream_id === null ? "on its own" : `after ${r.dream_id}`);
  if (r.state !== "reflected")
    return `${parts.join(", ")} — begun, not finished`;
  if (r.entry_id === null)
    parts.push("nothing much");
  if (r.page_version !== null)
    parts.push("rewrote the page");
  parts.push(SHARE_STATE_WORDS[r.share_state] ?? r.share_state);
  return parts.join(", ");
}
export function dreamChangeWords(source, c) {
  const words = (x) => x === null ? "(removed by the owner)" : `${x} "${memoryWords(source, x)}"`;
  const a = c.ref;
  const b = c.ref2;
  switch (c.action) {
    case "link":
    case "contradiction":
      return [`${c.action}: ${words(a)}  ↔  ${words(b)}`];
    case "settle": {
      let how = "settled";
      try {
        const d = JSON.parse(c.detail);
        if (typeof d.how === "string")
          how = d.how;
      } catch {
        how = "settled";
      }
      return [`settle (${how}): ${words(a)} holds over ${words(b)}`];
    }
    case "merge": {
      let from = [];
      try {
        const d = JSON.parse(c.detail);
        if (Array.isArray(d.from))
          from = d.from.filter((x) => typeof x === "string");
      } catch {
        from = [];
      }
      return [`merge into ${words(a)}`, ...from.map((f) => `from ${words(f)}`)];
    }
    default:
      return [`${c.action}: ${words(a)}`];
  }
}
export function reflectionShowLines(counterpart, id) {
  const r = counterpart.reflections.show(id);
  if (r === null)
    return null;
  const out = [
    `Reflection ${r.id} — ${r.date ?? `lived day ${String(r.day)}`}, ${reflectionSummary(r)}`,
    ...r.session === null ? [] : [`  for session ${r.session}`],
    "",
    "Asked:",
    ...parseIdList(r.questions).map((q) => `  - ${q}`),
    "",
    r.entry === null ? "Entry: (not written)" : "Entry:"
  ];
  if (r.entry !== null)
    for (const line of r.entry.split(`
`))
      out.push(`  ${line}`);
  if (r.entry_id !== null)
    out.push(`  (kept as memory ${r.entry_id})`);
  const cites = parseIdList(r.cites);
  if (cites.length > 0) {
    out.push("", "It rests on:");
    for (const c of cites)
      out.push(`  ${c} "${memoryWords(counterpart, c)}"`);
  }
  if (r.share !== null) {
    out.push("", "Morning share:", `  ${r.share}`);
  }
  if (r.page_version !== null)
    out.push("", `It rewrote the self page (version ${String(r.page_version)}): counterparts self-page --versions`);
  return out;
}
export function dreamShowLines(counterpart, id) {
  if (id.startsWith("rfl_"))
    return reflectionShowLines(counterpart, id);
  const shown = counterpart.dreams.show(id);
  if (shown === null)
    return null;
  const { dream, changes } = shown;
  const out = [
    `Dream ${dream.id} — ${dream.date ?? `lived day ${String(dream.day)}`}, ${dream.state}`,
    ...dream.session === null ? [] : [`  for session ${dream.session}`],
    ...(() => {
      const night = counterpart.dreams.nightRun();
      return night !== null && night.dream === dream.id ? [`  ${nightRunLine(night)}`] : [];
    })(),
    "",
    dream.title === null ? "Journal: (not written)" : `Journal: "${dream.title}"`
  ];
  if (dream.journal !== null && dream.journal.length > 0) {
    for (const line of dream.journal.split(`
`))
      out.push(`  ${line}`);
  }
  out.push("", changes.length === 0 ? "Changes: none." : `Changes (${String(changes.length)}):`);
  for (const c of changes) {
    const mark = c.undone === 1 ? "  [undone] " : "  ";
    const [head, ...under] = dreamChangeWords(counterpart, c);
    out.push(`${mark}${head}`);
    for (const line of under)
      out.push(`${mark}  ${line}`);
  }
  if (dream.state !== "undone")
    out.push("", `Reverse all of it: counterparts dream --undo ${dream.id}`);
  for (const r of counterpart.store.reflections({ dreamId: dream.id, limit: 3 })) {
    const lines = reflectionShowLines(counterpart, r.id);
    if (lines !== null)
      out.push("", ...lines);
  }
  return out;
}
export function coreListLines(counterpart) {
  const { core, nominated, demoted, reconsidering } = counterpart.coreList();
  const out = [
    core.length === 0 ? "The core is empty: nothing has become part of who I am yet." : `The core — ${String(core.length)} ${core.length === 1 ? "memory" : "memories"} that do not fade`
  ];
  for (const m of core) {
    const how = m.lane === null ? "(before lanes, or by revision)" : `${m.lane} lane${m.day === null ? "" : `, lived day ${String(m.day)}`}`;
    const said = m.confidential ? "[confidential]" : m.body ?? "(unreadable)";
    out.push(`  ${m.id}  ${m.kind.padEnd(6)} ${how} — ${said}`);
  }
  out.push("", "Only a memory about me or about us becomes core — what it is about is marked by meaning, by the", "writer or by a reflection (owner, work and world are not candidates, nor a fact, a skill or a plan).", "Then: strongly felt and back after a gap (fast lane), or it and its earlier and later states kept", "coming back — on several days, in several sessions, over a week or more inside a month (slow lane).", "A reflection that cites a memory counts as it coming back. At most a few a night.", acceptsReflectedFeeling(counterpart.store) ? "Open to reflection alone: a feeling a reflection records later and a reflection citing a memory count toward the fast lane, and a reflection may re-label either way (counterparts core --reflected-feeling off to close it)." : "Closed to reflection alone: the fast lane needs a feeling felt at the time and an ordinary use after a gap, and a reflection may only move a memory toward work or world (counterparts core --reflected-feeling on to open it).");
  if (nominated.length > 0) {
    out.push("", "Nominated by a dream (a lane still has to promote it):");
    for (const n of nominated.slice(0, 20)) {
      out.push(`  ${n.id}  lived day ${String(n.day)}${n.reason === null ? "" : ` — ${n.reason}`}${n.dream === null ? "" : ` (${n.dream})`}`);
    }
  }
  if (reconsidering.length > 0) {
    out.push("", "Being reconsidered — still core; nothing leaves without a decision, yours or mine:");
    for (const r of reconsidering)
      out.push(`  ${r.id}  since lived day ${String(r.day)} — ${reconsiderWords(r.reason)}`);
    out.push('  Keep one: counterparts core --reaffirm <id> --reason "..."  ·  send one back: --demote <id> --reason "..."');
  }
  if (demoted.length > 0) {
    out.push("", "Sent back to ordinary fading:");
    for (const d of demoted.slice(0, 20))
      out.push(`  ${d.id}  lived day ${String(d.day)}${d.reason === null ? "" : ` — ${d.reason}`}`);
  }
  if (core.length > 0)
    out.push("", 'Send one back: counterparts core --demote <id> --reason "..."');
  return out;
}
