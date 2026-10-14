import { stampWords } from "../../core/handoff/last-here.js";
import { band, strength, symmetryCheck } from "../../core/physics/index.js";
import { TUNABLES as SCHEMA_TUNABLES } from "../../core/schemas/index.js";
import {
  MARKER_UNSET,
  MERGE_ARCHIVE_REASON,
  PRUNE_ARCHIVE_REASON,
  isJournal,
  readMarker
} from "../../core/sleep/index.js";
import { PLAIN } from "./ansi.js";
import {
  NEVER,
  NONE,
  heading,
  indent,
  meter,
  num,
  plural,
  stack,
  subheading,
  table
} from "./layout.js";
import { BANDS, CYCLE_PHASES, KINDS, countBy } from "./registries.js";
import { contestedBeliefs } from "./stories.js";
function tally(src, day) {
  const store = src.store;
  const out = {
    byKind: new Map,
    byBand: new Map,
    meanStrength: new Map,
    exits: new Map,
    promoted: 0,
    guarded: 0,
    contested: 0,
    everContested: contestedBeliefs(src).length,
    live: 0,
    memories: 0,
    schemas: 0,
    archived: 0,
    journal: 0
  };
  const strengths = new Map;
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined)
      continue;
    if (row.archived === 1) {
      out.archived += 1;
      const reason = row.archived_reason ?? "no reason recorded";
      out.exits.set(reason, (out.exits.get(reason) ?? 0) + 1);
      continue;
    }
    if (isJournal(row)) {
      out.journal += 1;
      continue;
    }
    out.live += 1;
    if (row.type === "schema")
      out.schemas += 1;
    else
      out.memories += 1;
    out.byKind.set(row.kind, (out.byKind.get(row.kind) ?? 0) + 1);
    if (row.promoted_identity === 1)
      out.promoted += 1;
    if (row.protected === 1)
      out.guarded += 1;
    if (row.pressure > 0)
      out.contested += 1;
    let liveBand = row.band;
    try {
      const physics = store.physicsOf(id);
      liveBand = band(physics, day);
      const list = strengths.get(row.kind) ?? [];
      list.push(strength(physics, day));
      strengths.set(row.kind, list);
    } catch {}
    out.byBand.set(liveBand, (out.byBand.get(liveBand) ?? 0) + 1);
  }
  for (const [kind, list] of strengths) {
    out.meanStrength.set(kind, list.reduce((a, b) => a + b, 0) / Math.max(1, list.length));
  }
  return out;
}
export function renderStatus(src, opts = {}) {
  const style = opts.style ?? PLAIN;
  const day = src.store.livedDay();
  const t = tally(src, day);
  const lastActive = src.store.getMeta("lastActiveDate") ?? "";
  const opening = `I have had ${plural(day, "day of use", "days of use")}` + (lastActive === "" ? "" : ` — the latest ${/^\d{4}-\d{2}-\d{2}$/.test(lastActive) ? stampWords(lastActive.slice(5)) : lastActive}`) + ". " + (t.live + t.archived + t.journal === 0 ? "I am holding nothing yet." : `I am holding ${plural(t.memories, "memory", "memories")}` + (t.schemas === 0 ? "" : `, plus ${plural(t.schemas, "belief or entity", "beliefs and entities")}`) + (t.archived === 0 ? "" : `, and ${t.archived} more sit archived`) + (t.journal === 0 ? "." : `, beside ${plural(t.journal, "journal entry", "journal entries")} that do not decay.`));
  return stack(heading("What I am, right now", style), opening, kindBlock(t, style), bandBlock(t, style), cycleBlock(src, day, style), symmetryBlock(src, style), keepBlock(t, style), briefingBlock(src, style));
}
function kindBlock(t, style) {
  const peak = Math.max(1, ...KINDS.map((k) => t.byKind.get(k) ?? 0));
  const rows = countBy(KINDS, t.byKind).map((axis) => {
    if (axis.absent)
      return [axis.axis, "0", style.warn(NONE), ""];
    const mean = t.meanStrength.get(axis.axis) ?? 0;
    return [axis.axis, String(axis.count), meter(axis.count / peak), `mean strength ${num(mean)}`];
  });
  return `${subheading("By kind — every kind I know how to hold", style)}
${indent(table(rows, { right: [1] }))}`;
}
const BAND_GLOSS = {
  episodic: "still an episode; forgettable",
  semantic: "settled into what I know",
  identity: "constitutive, and physics can still move it"
};
function bandBlock(t, style) {
  const peak = Math.max(1, ...BANDS.map((b) => t.byBand.get(b) ?? 0));
  const rows = countBy(BANDS, t.byBand).map((axis) => axis.absent ? [axis.axis, "0", style.warn(NONE), ""] : [axis.axis, String(axis.count), meter(axis.count / peak), BAND_GLOSS[axis.axis]]);
  return `${subheading("By band — how settled each memory is", style)}
${indent(table(rows, { right: [1] }))}`;
}
function cycleBlock(src, day, style) {
  const rows = CYCLE_PHASES.map((phase) => {
    const marker = readMarker(src.store, phase);
    if (marker.health === "torn") {
      return [phase, style.warn("torn marker"), style.warn(`unreadable value ${marker.raw ?? ""}`)];
    }
    if (marker.day === MARKER_UNSET)
      return [phase, style.warn(NEVER), ""];
    const age = day - marker.day;
    return [phase, `last finished day ${marker.day}`, age <= 0 ? "today" : `${plural(age, "day")} ago`];
  });
  return `${subheading("My last cycle — what finished, and when", style)}
${indent(table(rows))}`;
}
function symmetryBlock(src, style) {
  const rows = KINDS.map((kind) => {
    let up = 0;
    let down = 0;
    let unexplained = 0;
    for (const row of src.store.eventLog({ name: "band.transition", limit: 1e5 })) {
      if (row.payload === null)
        continue;
      try {
        const p = JSON.parse(row.payload);
        if (p.kind !== kind)
          continue;
        if (p.cause === "recurve")
          continue;
        if (p.direction === "up") {
          up += 1;
          if (p.cause === "unexplained")
            unexplained += 1;
        } else if (p.direction === "down")
          down += 1;
      } catch {
        continue;
      }
    }
    const verdict = symmetryCheck(kind, { up, down, unexplained });
    const counts = `${up}↑/${down}↓${unexplained > 0 ? `, ${unexplained} unexplained` : ""}`;
    const label = verdict.reason === "never-asked" ? style.warn(`never-asked (${counts})`) : verdict.reason === "within-expectation" ? `within-expectation (${counts})` : style.warn(`up-ratchet suspected (${counts})`);
    return [kind, label];
  });
  return `${subheading("Band symmetry — the up-ratchet tripwire, by reason", style)}
${indent(table(rows))}`;
}
function keepBlock(t, style) {
  const named = [
    [PRUNE_ARCHIVE_REASON, "let go at the floor"],
    [MERGE_ARCHIVE_REASON, "merged into a duplicate"],
    [SCHEMA_TUNABLES.FADE_REASON, "faded out of my vocabulary"]
  ];
  const rows = named.map(([reason, gloss]) => {
    const n = t.exits.get(reason) ?? 0;
    return [reason, n === 0 ? style.warn(NONE) : String(n), gloss];
  });
  for (const [reason, n] of t.exits) {
    if (named.some(([r]) => r === reason))
      continue;
    rows.push([reason, String(n), "recorded by whatever archived it"]);
  }
  const sentence = `${t.promoted === 0 ? "Nothing" : plural(t.promoted, "memory", "memories")} ` + `${t.promoted === 1 || t.promoted === 0 ? "has" : "have"} crossed into identity; ` + `${t.guarded === 0 ? "nothing is" : `${plural(t.guarded, "memory", "memories")} ${t.guarded === 1 ? "is" : "are"}`} protected; ` + `${t.contested === 0 ? "no belief is" : `${plural(t.contested, "belief")} ${t.contested === 1 ? "is" : "are"}`} under challenge right now.`;
  const ever = t.everContested;
  const history = ever === 0 ? "No belief has ever taken a credited challenge." : `${plural(ever, "belief")} ${ever === 1 ? "has" : "have"} been argued with at some point — \`stories\` tells each one.`;
  const body = [
    sentence,
    history,
    "",
    "Ways out, counted since birth — never a per-cycle number I do not durably hold:",
    indent(table(rows, { right: [1] }))
  ].join(`
`);
  return `${subheading("What I have kept, and what I let go", style)}
${indent(body)}`;
}
function briefingBlock(src, style) {
  const wake = src.self.wake();
  const line = wake.ok ? `I have a briefing composed and waiting: ${plural(wake.bytes, "byte")}.` : style.warn(`I have no briefing waiting to give (${wake.reason}).`);
  return `${subheading("What I would say on waking", style)}
${indent(line)}`;
}
