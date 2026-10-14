import { FIRED_DAYS, daysBefore, rowDate } from "../fired.js";
import { mechanismEvidence, payloadOf } from "../mechanism-evidence.js";
export const LIGHT = {
  working: "●",
  idle: "◐",
  notBuilt: "○"
};
function part(v, ...keys) {
  let n = 0;
  for (const p of v.parts)
    if (keys.includes(p.key))
      n += p.count;
  return n;
}
function plural(n, one, many = `${one}s`) {
  return `${String(n)} ${n === 1 ? one : many}`;
}
const NOT_BUILT = (why) => () => ({
  light: LIGHT.notBuilt,
  says: `not built yet: ${why}`
});
export function calendarWindow(store, today) {
  let livedDay = 0;
  try {
    livedDay = store.livedDay();
  } catch {
    livedDay = 0;
  }
  const from = daysBefore(today, FIRED_DAYS - 1);
  const zone = store.zone();
  return {
    sinceDay: Math.max(0, livedDay - FIRED_DAYS),
    today: livedDay,
    contains: (row) => {
      const date = rowDate(row, payloadOf(row), zone);
      return date >= from && date <= today;
    }
  };
}
export function consoleVerdicts(store, today) {
  return mechanismEvidence(store, calendarWindow(store, today)).verdicts;
}
export const MEMORY_MECHANISMS = [
  {
    name: "Salience",
    group: "Encoding",
    id: "salience",
    evidence: ["deposit", "chunk-gate"],
    read: (v) => {
      const n = part(v, "deposit", "chunk");
      return v.fired ? { light: LIGHT.working, says: `${plural(n, "memory", "memories")} written and scored` } : { light: LIGHT.idle, says: "built, not firing yet: no memories written this week" };
    }
  },
  {
    name: "Emotion",
    group: "Encoding",
    id: "emotional",
    evidence: ["feelings", "emotion-weight", "mood-match"],
    read: (v, rows) => {
      const weighted = rows("emotion-weight")?.total ?? 0;
      const withFeelings = rows("feelings")?.total ?? 0;
      const newWeighted = part(v, "weighted");
      const matched = part(v, "moodMatched");
      const held = `${plural(weighted, "memory", "memories")} held higher and fading slower (${String(withFeelings)} with recorded feelings)`;
      if (v.fired) {
        const parts = [];
        if (newWeighted > 0)
          parts.push(`${plural(newWeighted, "new memory", "new memories")} carrying feeling`);
        if (matched > 0)
          parts.push(`${plural(matched, "memory", "memories")} a matching mood brought closer`);
        return { light: LIGHT.working, says: `${parts.join("; ")}; ${held}` };
      }
      return {
        light: LIGHT.idle,
        says: weighted > 0 ? `built, not firing yet this week: ${held}` : "built, not firing yet: no memory carries a feeling"
      };
    }
  },
  {
    name: "Forgetting",
    group: "Storage",
    id: "decay",
    evidence: ["decay", "prune", "fade", "sleep-cycle"],
    read: (v) => {
      if (!v.fired)
        return { light: LIGHT.idle, says: "built, not firing yet: nothing faded this week" };
      const letGo = part(v, "pruned");
      const dropped = part(v, "faded");
      const cards = part(v, "cards");
      const below = part(v, "belowReach");
      const parts = [];
      if (below > 0)
        parts.push(`${plural(below, "memory", "memories")} below reach now`);
      if (letGo > 0)
        parts.push(`${plural(letGo, "memory", "memories")} exited (archived at the floor)`);
      if (dropped > 0)
        parts.push(`${plural(dropped, "memory", "memories")} faded a band`);
      if (cards > 0)
        parts.push("unused names faded");
      if (letGo === 0)
        parts.push("nothing at the floor yet");
      return { light: LIGHT.working, says: parts.join("; ") };
    }
  },
  {
    name: "Interference",
    group: "Storage",
    id: "interference",
    evidence: ["dream-changes", "contradictions"],
    read: (v) => {
      const merged = part(v, "dreamMerged");
      const flagged = part(v, "flagged");
      const proposed = part(v, "proposed");
      const faded = part(v, "faded");
      const said = [
        ...merged > 0 ? [`${plural(merged, "near-copy", "near-copies")} merged in a dream`] : [],
        ...flagged > 0 ? [`${plural(flagged, "pair")} that disagree flagged`] : [],
        ...proposed > 0 ? [`${plural(proposed, "memory", "memories")} read as the newer state of an older one`] : [],
        ...faded > 0 ? [`${plural(faded, "earlier memory", "earlier memories")} faded under a newer one`] : []
      ];
      return v.fired && said.length > 0 ? { light: LIGHT.working, says: `partly built: ${said.join("; ")}` } : { light: LIGHT.idle, says: "partly built, not firing this week: similar memories meet in a dream and when a new one reads as the newer state of an older one; they do not compete at recall yet" };
    }
  },
  {
    name: "Retrieval",
    group: "Retrieval",
    id: "retrieval",
    evidence: ["recall-decision", "credit"],
    read: (v) => {
      if (!v.fired)
        return { light: LIGHT.idle, says: "built, not firing yet: nothing came to mind this week" };
      const turns = part(v, "turns");
      const lookups = part(v, "lookups");
      const credited = part(v, "credited");
      const parts = [];
      if (turns > 0)
        parts.push(`${plural(turns, "turn")} brought memories to mind`);
      if (lookups > 0)
        parts.push(plural(lookups, "deliberate look-up"));
      parts.push(credited > 0 ? `${plural(credited, "memory", "memories")} used and strengthened` : "nothing used yet, so nothing strengthened");
      return { light: LIGHT.working, says: parts.join("; ") };
    }
  },
  {
    name: "Association",
    group: "Retrieval",
    id: "association",
    evidence: ["association-saved", "association"],
    read: (v, rows) => {
      const saved = part(v, "links", "replayed");
      const reached = part(v, "reached");
      const held = rows("association")?.total ?? 0;
      if (v.fired) {
        return {
          light: LIGHT.working,
          says: `${plural(reached, "memory", "memories")} links brought to mind this week; ${plural(saved, "link")} laid; ${plural(held, "link")} held`
        };
      }
      if (v.starved !== undefined) {
        return { light: LIGHT.idle, says: `${plural(saved, "link")} laid this week, but none brought a memory to mind (${plural(held, "link")} held)` };
      }
      if (v.young !== undefined) {
        return { light: LIGHT.working, says: `${plural(saved, "link")} laid this week; too early for one to bring a memory to mind (${plural(held, "link")} held)` };
      }
      return {
        light: LIGHT.idle,
        says: held > 0 ? `built, not firing yet: no new links this week (${plural(held, "link")} held)` : "built, not firing yet: no links formed"
      };
    }
  },
  {
    name: "Prospective",
    group: "Retrieval",
    id: "prospective",
    evidence: ["prospective-dated", "prospective-fired", "prospective-plain"],
    read: (v, rows) => {
      const dated = v.held ?? rows("prospective-dated")?.total ?? 0;
      const quiet = part(v, "quiet");
      const plain = part(v, "plain");
      const held = `${plural(dated, "dated memory", "dated memories")} held`;
      const missed = rows("prospective-plain")?.occasionMissed ?? 0;
      const unsaid = missed > 0 ? `; ${plural(missed, "plain reminder")} due on a day a session ran and not said` : "";
      if (v.fired) {
        const parts = [];
        if (plain > 0)
          parts.push(`${String(plain)} said plainly`);
        if (quiet > 0)
          parts.push(`${String(quiet)} as quiet footnotes`);
        return {
          light: LIGHT.working,
          says: `${plural(quiet + plain, "reminder")} came back (${parts.join(", ")}); ${held}${unsaid}`
        };
      }
      if (missed > 0)
        return { light: LIGHT.idle, says: `built, but not firing: ${held}${unsaid}` };
      return dated > 0 ? { light: LIGHT.idle, says: `built, nothing due this week: ${held}` } : { light: LIGHT.idle, says: "built, nothing dated yet: a note with a date comes back around that day" };
    }
  },
  {
    name: "Consolidation",
    group: "Transformation",
    id: "consolidation",
    evidence: ["sleep-cycle", "promotion", "dedup", "returns", "dream-replays", "core-demote", "upgrade-census"],
    read: (v) => {
      if (v.fired) {
        const parts = [];
        const returns = part(v, "returns");
        const promoted = part(v, "promoted");
        const merged = part(v, "merged") + part(v, "dreamMerged");
        const rose = part(v, "rose");
        if (returns > 0)
          parts.push(`${plural(returns, "return")} made memories fade more slowly`);
        if (promoted > 0)
          parts.push(`${plural(promoted, "memory", "memories")} became core`);
        if (merged > 0)
          parts.push(`${plural(merged, "near-copy", "near-copies")} merged`);
        if (rose > 0)
          parts.push(`${plural(rose, "memory", "memories")} settled a band higher`);
        return { light: LIGHT.working, says: parts.join("; ") };
      }
      const s = v.schedule;
      if (s !== null && s.onTime && s.lastRanDay !== null) {
        const next = s.nextInDays <= 0 ? "at the next session's end" : `in ${plural(s.nextInDays, "day of use", "days of use")}`;
        return { light: LIGHT.idle, says: `built, ran on schedule with nothing to change; next run ${next}` };
      }
      return { light: LIGHT.idle, says: "built, not firing yet: nothing consolidated this week" };
    }
  },
  {
    name: "Dreaming",
    group: "Transformation",
    id: "dreaming",
    evidence: ["dream", "dream-changes", "dream-ask"],
    read: (v) => {
      const dreams = part(v, "dreams");
      const changes = part(v, "changes");
      const suggestions = part(v, "suggestions");
      const made = [...changes > 0 ? [plural(changes, "change")] : [], ...suggestions > 0 ? [plural(suggestions, "core suggestion")] : []];
      const reflections = part(v, "reflections");
      if (v.fired) {
        return {
          light: LIGHT.working,
          says: `${plural(dreams, "dream")} this week${made.length > 0 ? ` (${made.join(", ")})` : ""}${reflections > 0 ? `; ${plural(reflections, "reflection")} afterwards` : ""}`
        };
      }
      return {
        light: LIGHT.idle,
        says: v.lastFiredDay === null ? "built, not firing yet: no dream yet (a session asks, once a day, and you say yes or not today)" : `built, not firing this week: the last dream was on day ${String(v.lastFiredDay)} of use`
      };
    }
  },
  {
    name: "Reconsolidation",
    group: "Transformation",
    id: "reconsolidation",
    evidence: ["revision", "accommodation", "contradictions"],
    read: (v) => {
      const pressed = part(v, "pressure");
      const settled = part(v, "settled");
      const said = [
        ...pressed > 0 ? [`${plural(pressed, "correction")} weighed against old memories`] : [],
        ...settled > 0 ? [`${plural(settled, "contradiction")} settled`] : []
      ];
      return v.fired && said.length > 0 ? { light: LIGHT.working, says: said.join("; ") } : { light: LIGHT.idle, says: "built, not firing yet: nothing corrected or settled this week" };
    }
  },
  {
    name: "Schemas",
    group: "Transformation",
    id: "schema",
    evidence: ["entity-birth"],
    read: NOT_BUILT("nothing forms beliefs about people and projects yet")
  },
  {
    name: "Gist",
    group: "Transformation",
    id: "episodic-semantic",
    evidence: ["gist"],
    read: (v) => v.fired ? { light: LIGHT.working, says: `${plural(part(v, "gist"), "pattern")} dreamed into a memory of its own` } : { light: LIGHT.idle, says: "partly built, not firing this week: only a dream writes a gist so far" }
  }
];
export function readMechanism(m, verdicts, rows) {
  const v = verdicts.find((x) => x.id === m.id);
  if (v === undefined)
    return { light: LIGHT.notBuilt, says: "not built yet" };
  return m.read(v, rows);
}
const TROUBLE = {
  "worker-trouble": "the background worker failed or was refused",
  "snapshot-trouble": "a copy of the store could not be made"
};
export function mechanismIds() {
  return new Set(MEMORY_MECHANISMS.flatMap((m) => m.evidence));
}
export function plumbingLine(report) {
  const mine = mechanismIds();
  const plumbing = report.rows.filter((r) => !mine.has(r.id));
  const running = plumbing.filter((r) => r.state === "firing" && TROUBLE[r.id] === undefined).length;
  const failing = [];
  for (const r of plumbing) {
    const words = TROUBLE[r.id];
    if (words !== undefined && r.firedInWindow > 0)
      failing.push(words);
  }
  const head = `Plumbing: ${plural(running, "part")} running`;
  return failing.length === 0 ? `${head}, none failing.` : `${head}; failing this week: ${failing.join("; ")}.`;
}
export function mechanismsLines(report, verdicts) {
  const byId = new Map(report.rows.map((r) => [r.id, r]));
  const rows = (id) => byId.get(id);
  const width = Math.max(...MEMORY_MECHANISMS.map((m) => m.name.length)) + 2;
  const lines = [`Memory mechanisms — last 7 days (${report.from} to ${report.today}, UTC)`, ""];
  if (report.young) {
    lines.push("This memory is new, so most of these have had nothing to do yet.", "");
  }
  for (const m of MEMORY_MECHANISMS) {
    const { light, says } = readMechanism(m, verdicts, rows);
    lines.push(`${light} ${m.name.padEnd(width)}${says}`);
  }
  lines.push("", `${LIGHT.working} working this week  ${LIGHT.idle} built, not firing  ${LIGHT.notBuilt} not built yet`, plumbingLine(report), "Every detail: counterparts mechanisms --all");
  return lines;
}
