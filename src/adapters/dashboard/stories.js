import { isJournal } from "../../core/sleep/index.js";
import { PLAIN } from "./ansi.js";
import { NONE, heading, indent, num, plural, stack, subheading, table } from "./layout.js";
import { resolveRef } from "./resolve.js";
export const PRESSURE_EVENT = "revision.pressure";
export const DEFAULT_STORY_LIMIT = 10;
export function contestedBeliefs(src) {
  const store = src.store;
  const candidates = new Set;
  for (const row of store.eventLog({ name: PRESSURE_EVENT, order: "desc", limit: 1000 })) {
    if (row.ref !== null)
      candidates.add(row.ref);
  }
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || isJournal(row))
      continue;
    if (row.pressure > 0)
      candidates.add(id);
  }
  const groups = new Map;
  for (const id of candidates) {
    const chain = [];
    let cursor = id;
    while (cursor !== undefined && !chain.includes(cursor)) {
      chain.push(cursor);
      const r = store.row(cursor);
      cursor = r === undefined ? undefined : r.superseded_by ?? src.schemas.crossedTo(cursor);
    }
    const head = chain[chain.length - 1] ?? id;
    const group = groups.get(head) ?? [];
    group.push({ id, length: chain.length });
    groups.set(head, group);
  }
  return [...groups.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([head, members]) => {
    const root = [...members].sort((a, b) => b.length - a.length || (a.id < b.id ? -1 : 1))[0];
    return [root?.id ?? head, head];
  });
}
export function renderStories(src, opts = {}) {
  const style = opts.style ?? PLAIN;
  const limit = opts.limit ?? DEFAULT_STORY_LIMIT;
  const groups = opts.id === undefined ? contestedBeliefs(src) : [[opts.id, opts.id]];
  if (groups.length === 0) {
    return stack(heading("How my beliefs have changed", style), style.warn(`${NONE} — nothing I hold has been argued with. No belief has taken a single credited challenge.`), "That is a real answer, not an empty panel: a store with no contested belief has never had one, and this line is how I say so.");
  }
  const told = groups.slice(0, limit).map(([root]) => oneStory(src, root ?? "", style));
  const footer = groups.length > limit ? `${plural(groups.length, "contested belief")}; showing ${limit}. Ask for one with \`stories --id <id>\`.` : `${plural(groups.length, "contested belief")}, all shown.`;
  return stack(heading("How my beliefs have changed", style), ...told, footer);
}
function oneStory(src, rootId, style) {
  const store = src.store;
  const story = src.schemas.story(rootId);
  const head = resolveRef(store, story.headId);
  const origin = resolveRef(store, rootId, { follow: false });
  const entityId = (() => {
    try {
      return store.readProse(story.headId).meta["entityId"];
    } catch {
      return;
    }
  })();
  const about = typeof entityId === "string" ? resolveRef(store, entityId).label : `${NONE} (no entity named)`;
  const revised = story.headId !== rootId;
  const facts = [
    ["about", about],
    ["it began as", origin.label],
    ["it now says", revised ? head.label : "the same thing — nothing has revised it"],
    [
      "pressure standing",
      story.pressure === 0 ? revised ? `${NONE} — the revision reset it; the successor starts clean` : `${NONE} — the pressure has decayed, or was never credited` : `${num(story.pressure)} against a bar of ${num(story.bar)}` + (story.lastChallengedDay === null ? "" : `, last argued with on day ${story.lastChallengedDay}`)
    ],
    ["strength of the belief now", num(story.strength)]
  ];
  const beats = story.increments.slice().sort((a, b) => a.day - b.day).map((inc) => {
    const challenger = resolveRef(store, inc.challengerId, 52);
    const crossed = inc.pressureAfter >= inc.bar;
    const step = story.lineage.find((l) => l.id === inc.targetId && l.successorId !== null);
    const verdict = crossed ? step === undefined || step.successorId === null ? style.warn("crossed the bar — but I find no supersession recorded") : `${style.bold("REVISED")}, becoming ${resolveRef(store, step.successorId, 52).label}` : "held";
    return [
      `day ${inc.day}`,
      `challenged by ${challenger.label}`,
      `force ${num(inc.force)}`,
      `pressure ${num(inc.pressureAfter)} of ${num(inc.bar)}`,
      verdict
    ];
  });
  const log = beats.length === 0 ? indent(style.warn(`${NONE} — this belief carries pressure but I hold no credited challenge for it. Its increments predate the durable log, or were pruned.`)) : indent(table(beats));
  return stack(subheading(`Belief ${rootId}`, style), indent(table(facts)), `${indent(subheading("Every credited challenge, in the order it landed", style))}
${log}`);
}
