/**
 * `dream` and `core` — the owner's two windows onto the dreaming +
 * consolidation mechanism (2026-09-26), rendered as plain lines.
 *
 * The console decides nothing here. What a dream did, how to undo it, what the
 * core holds and how a memory leaves it are the core's (`core/dream/`,
 * `Counterpart.coreList` / `demoteCore`); this file only turns their answers
 * into lines a person reads. Pure over its inputs, like `self-page.ts`, so the
 * tests can check the words without a store.
 */
import type { Counterpart } from "../../core/counterpart.js";
import { nightPartsWords, nightRunWords } from "../../core/dream/index.js";
import type { DreamingSetting, NightRun } from "../../core/dream/index.js";
import { acceptsReflectedFeeling } from "../../core/sleep/index.js";
import type { DreamChangeRow, ReflectionRow, Store } from "../../core/store/index.js";

/** How a memory id reads in a list: its first line, or why it is not shown.
 *  Only the store is read, so `export --markdown` asks it too. */
export function memoryWords(source: { readonly store: Store }, id: string | null, max = 80): string {
  if (id === null) return "(removed by the owner)";
  const row = source.store.row(id);
  if (row === undefined) return "(no such memory)";
  if (row.confidential === 1) return "[confidential]";
  if (row.body === "") return "(removed by the owner)";
  const line = ((row.title ?? "").trim() || (row.body.split("\n").find((l) => l.trim().length > 0) ?? "")).replace(/\s+/g, " ").trim();
  const said = line.length > max ? `${line.slice(0, max - 1)}…` : line;
  return row.archived === 1 ? `${said} (archived: ${row.archived_reason ?? "archived"})` : said;
}

function countsLine(counts: Readonly<Record<string, number>>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${String(n)} ${k}`);
  return parts.length === 0 ? "no changes" : parts.join(", ");
}

/** What each dreaming setting means, in one sentence (2026-09-28; `ask` the default since 2026-09-29). */
export function dreamingSettingWords(setting: DreamingSetting): string {
  switch (setting) {
    case "auto":
      return "Once a day, the first session starts the nightly run by itself — the page writer, then a dream, then a reflection — in a separate, windowless claude -p in the background, and says so in one line; if it cannot start, the next prompt asks instead and says why. Say 'no dreams' in a session, or counterparts dream --setting off, to turn it off.";
    case "ask":
      return "Once a day, the first session shows you the question in the terminal before it starts the nightly run; say 'dream' to start it, 'dream on your own' to let it start by itself each day, or nothing and it waits. (The default.)";
    case "off":
      return "No dreams: nothing starts the nightly run and nothing asks. counterparts dream --setting ask (or auto) turns it back on.";
  }
}

/**
 * THE LATEST HEADLESS RUN, in one line (2026-09-29): its date and state, which
 * parts ran when it was partial (or done), and why it ended when it did not
 * finish.
 */
export function nightRunLine(run: NightRun): string {
  const what = run.kind === "reflection" ? "the reflection alone" : "the whole night";
  const parts = run.state === "done" || run.state === "partial" ? ` — ${nightPartsWords(run)}` : "";
  const why = run.state === "done" || run.state === "started" || (run.state === "partial" && run.reason === "unfinished") ? "" : `: ${nightRunWords(run)}`;
  return `Latest headless run: ${run.run}  ${run.date}  ${run.state} (${what})${parts}${why}`;
}

/** How many dreams `dream --list` prints without `--all`. */
export const DREAM_LIST_LIMIT = 20;

/**
 * `counterparts dream --list`: the setting (2026-09-28), then newest first,
 * one line each — the newest `DREAM_LIST_LIMIT`, or every one with `--all`
 * (`limit: "all"`). The header says how many of how many, so a list that stops
 * is never read as all there is.
 */
export function dreamListLines(counterpart: Counterpart, limit: number | "all" = DREAM_LIST_LIMIT): string[] {
  const total = counterpart.store.dreamCount();
  const dreams = counterpart.dreams.list(limit === "all" ? Math.max(1, total) : limit);
  const setting = counterpart.dreams.setting();
  const night = counterpart.dreams.nightRun();
  const head = [`Dreaming: ${setting}. ${dreamingSettingWords(setting)}`, ...(night === null ? [] : [nightRunLine(night)]), ""];
  if (dreams.length === 0) {
    return [...head, "No dreams yet."];
  }
  const out = [
    ...head,
    dreams.length < total
      ? `Dreams — newest first (${String(dreams.length)} of ${String(total)} shown; every one: counterparts dream --list --all)`
      : `Dreams — newest first (all ${String(dreams.length)})`,
    "",
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
    for (const r of reflections) out.push(`${r.id}  ${r.date ?? `lived day ${String(r.day)}`}  ${reflectionSummary(r)}`);
    out.push("", "Read one: counterparts dream --show <rfl_…>");
  }
  return out;
}

export function parseIdList(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** What became of a morning share, in the words `dream --show` and the export both use. */
export const SHARE_STATE_WORDS: Readonly<Record<string, string>> = {
  none: "no share",
  offered: "share not told yet",
  carried: "share carried to a later session",
  told: "share told",
};

/** One line: after which dream, what it did, and what became of the share. */
export function reflectionSummary(r: ReflectionRow): string {
  const parts: string[] = [];
  parts.push(r.dream_id === null ? "on its own" : `after ${r.dream_id}`);
  if (r.state !== "reflected") return `${parts.join(", ")} — begun, not finished`;
  if (r.entry_id === null) parts.push("nothing much");
  if (r.page_version !== null) parts.push("rewrote the page");
  parts.push(SHARE_STATE_WORDS[r.share_state] ?? r.share_state);
  return parts.join(", ");
}

/**
 * ONE CHANGE A DREAM MADE, in words: its line, then any lines under it (a
 * merge's originals, each "from …"). No mark and no indent: `dream --show`
 * puts its own in front, and `export --markdown` makes a list of it.
 */
export function dreamChangeWords(source: { readonly store: Store }, c: DreamChangeRow): [string, ...string[]] {
  const words = (x: string | null): string => (x === null ? "(removed by the owner)" : `${x} "${memoryWords(source, x)}"`);
  const a = c.ref;
  const b = c.ref2;
  switch (c.action) {
    case "link":
    case "contradiction":
      return [`${c.action}: ${words(a)}  ↔  ${words(b)}`];
    case "settle": {
      let how = "settled";
      try {
        const d = JSON.parse(c.detail) as { how?: unknown };
        if (typeof d.how === "string") how = d.how;
      } catch {
        how = "settled";
      }
      return [`settle (${how}): ${words(a)} holds over ${words(b)}`];
    }
    case "merge": {
      let from: string[] = [];
      try {
        const d = JSON.parse(c.detail) as { from?: unknown };
        if (Array.isArray(d.from)) from = d.from.filter((x): x is string => typeof x === "string");
      } catch {
        from = [];
      }
      return [`merge into ${words(a)}`, ...from.map((f) => `from ${words(f)}`)];
    }
    default:
      return [`${c.action}: ${words(a)}`];
  }
}

/** `counterparts dream --show <rfl_…>`: one reflection, whole. */
export function reflectionShowLines(counterpart: Counterpart, id: string): string[] | null {
  const r = counterpart.reflections.show(id);
  if (r === null) return null;
  const out = [
    `Reflection ${r.id} — ${r.date ?? `lived day ${String(r.day)}`}, ${reflectionSummary(r)}`,
    ...(r.session === null ? [] : [`  for session ${r.session}`]),
    "",
    "Asked:",
    ...parseIdList(r.questions).map((q) => `  - ${q}`),
    "",
    r.entry === null ? "Entry: (not written)" : "Entry:",
  ];
  if (r.entry !== null) for (const line of r.entry.split("\n")) out.push(`  ${line}`);
  if (r.entry_id !== null) out.push(`  (kept as memory ${r.entry_id})`);
  const cites = parseIdList(r.cites);
  if (cites.length > 0) {
    out.push("", "It rests on:");
    for (const c of cites) out.push(`  ${c} "${memoryWords(counterpart, c)}"`);
  }
  if (r.share !== null) {
    out.push("", "Morning share:", `  ${r.share}`);
  }
  if (r.page_version !== null) out.push("", `It rewrote the self page (version ${String(r.page_version)}): counterparts self-page --versions`);
  return out;
}

/** `counterparts dream --show <id>`: the journal, then every change, undone ones marked — and the reflection after it. */
export function dreamShowLines(counterpart: Counterpart, id: string): string[] | null {
  if (id.startsWith("rfl_")) return reflectionShowLines(counterpart, id);
  const shown = counterpart.dreams.show(id);
  if (shown === null) return null;
  const { dream, changes } = shown;
  const out = [
    `Dream ${dream.id} — ${dream.date ?? `lived day ${String(dream.day)}`}, ${dream.state}`,
    ...(dream.session === null ? [] : [`  for session ${dream.session}`]),
    // The headless run this dream was part of, when it is the latest (2026-09-29).
    ...((): string[] => {
      const night = counterpart.dreams.nightRun();
      return night !== null && night.dream === dream.id ? [`  ${nightRunLine(night)}`] : [];
    })(),
    "",
    dream.title === null ? "Journal: (not written)" : `Journal: "${dream.title}"`,
  ];
  if (dream.journal !== null && dream.journal.length > 0) {
    for (const line of dream.journal.split("\n")) out.push(`  ${line}`);
  }
  out.push("", changes.length === 0 ? "Changes: none." : `Changes (${String(changes.length)}):`);
  for (const c of changes) {
    const mark = c.undone === 1 ? "  [undone] " : "  ";
    const [head, ...under] = dreamChangeWords(counterpart, c);
    out.push(`${mark}${head}`);
    for (const line of under) out.push(`${mark}  ${line}`);
  }
  if (dream.state !== "undone") out.push("", `Reverse all of it: counterparts dream --undo ${dream.id}`);
  // What the waking self made of it — lived, so an undo of the dream leaves it.
  for (const r of counterpart.store.reflections({ dreamId: dream.id, limit: 3 })) {
    const lines = reflectionShowLines(counterpart, r.id);
    if (lines !== null) out.push("", ...lines);
  }
  return out;
}

/** `counterparts core --list`: the core with lanes, then nominations and demotions. */
export function coreListLines(counterpart: Counterpart): string[] {
  const { core, nominated, demoted } = counterpart.coreList();
  const out = [
    core.length === 0
      ? "The core is empty: nothing has become part of who I am yet."
      : `The core — ${String(core.length)} ${core.length === 1 ? "memory" : "memories"} that do not fade`,
  ];
  for (const m of core) {
    const how = m.lane === null ? "(before lanes, or by revision)" : `${m.lane} lane${m.day === null ? "" : `, lived day ${String(m.day)}`}`;
    const said = m.confidential ? "[confidential]" : (m.body ?? "(unreadable)");
    out.push(`  ${m.id}  ${m.kind.padEnd(6)} ${how} — ${said}`);
  }
  out.push(
    "",
    "Only a memory about me, about us or about the owner becomes core — what it is about is marked by",
    "meaning, by the writer or by a reflection (work and world are not candidates). Then: strongly felt",
    "and back after a gap (fast lane), or back on several separate days over weeks (slow lane). A",
    "reflection that cites a memory counts as it coming back. At most a few a night.",
    acceptsReflectedFeeling(counterpart.store)
      ? "Open to reflection alone: a feeling a reflection records later and a reflection citing a memory count toward the fast lane, and a reflection may re-label either way (counterparts core --reflected-feeling off to close it)."
      : "Closed to reflection alone: the fast lane needs a feeling felt at the time and an ordinary use after a gap, and a reflection may only move a memory toward work or world (counterparts core --reflected-feeling on to open it).",
  );
  if (nominated.length > 0) {
    out.push("", "Nominated by a dream (a lane still has to promote it):");
    for (const n of nominated.slice(0, 20)) {
      out.push(`  ${n.id}  lived day ${String(n.day)}${n.reason === null ? "" : ` — ${n.reason}`}${n.dream === null ? "" : ` (${n.dream})`}`);
    }
  }
  if (demoted.length > 0) {
    out.push("", "Sent back to ordinary fading by you:");
    for (const d of demoted.slice(0, 20)) out.push(`  ${d.id}  lived day ${String(d.day)}${d.reason === null ? "" : ` — ${d.reason}`}`);
  }
  if (core.length > 0) out.push("", 'Send one back: counterparts core --demote <id> --reason "..."');
  return out;
}
