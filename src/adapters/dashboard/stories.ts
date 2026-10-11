/**
 * `stories` — how a belief changed its mind, told as a story.
 *
 * The keep (CONTRACT §3, review finding 1): the challenge-pressure log rendered
 * as a watchable narrative per contested belief. v1 had the arithmetic and lost
 * the explanation — the pressure NUMBER survived a restart while the story of how
 * it got there did not, which is why `schemas/` now appends every credited
 * increment to box 2's durable `events` table (SEAMS item K). This view is that
 * table, read back.
 *
 * Five things per challenge, exactly as the task states them: **lived day,
 * challenger, force, bar, verdict.**
 *
 * The verdict is DERIVED, not looked up, because there is no durable verdict
 * event — `revision.pressure` is the only event name anything in the core
 * appends today. The derivation is the same arithmetic physics used at the time:
 * `pressureAfter >= bar` is a crossing, and a crossing is a revision. When the
 * lineage confirms it, the successor is resolved at render time and printed, so
 * the story ends in what the belief BECAME rather than in a number.
 *
 * Grouping is by resolved head: a chain challenged at two generations is ONE
 * story about one belief, not two stories about two ids.
 */
import { isJournal } from "../../core/sleep/index.js";
import { PLAIN } from "./ansi.js";
import type { Style } from "./ansi.js";
import { NONE, heading, indent, num, plural, stack, subheading, table } from "./layout.js";
import { resolveRef } from "./resolve.js";
import type { DashboardSource } from "./source.js";

/** The durable increment's event name. Written by `schemas/challengeBelief` and
 *  by `core/revision.ts`'s identity arm, in the same shape — so an identity
 *  element's story renders here without this file knowing there are two. */
export const PRESSURE_EVENT = "revision.pressure";

export const DEFAULT_STORY_LIMIT = 10;

export interface StoriesOptions {
  readonly style?: Style;
  /** Tell one belief's story. Any id in the chain finds the whole chain. */
  readonly id?: string;
  readonly limit?: number;
}

/**
 * Every belief that has ever been argued with: the refs of the durable pressure
 * events, plus any row still carrying pressure (a challenge credited before the
 * durable log existed, or one whose event was pruned). Union, then grouped.
 */
export function contestedBeliefs(src: DashboardSource): string[][] {
  const store = src.store;
  const candidates = new Set<string>();
  // Newest first: past the limit it is the longest-quiet beliefs that fall out,
  // never the ones argued with this week.
  for (const row of store.eventLog({ name: PRESSURE_EVENT, order: "desc", limit: 1000 })) {
    if (row.ref !== null) candidates.add(row.ref);
  }
  for (const id of store.list()) {
    const row = store.row(id);
    // `list()` returns the whole `memories` table, episodes included. An episode
    // is a journal entry, not a belief: nothing argues with the account of a day,
    // and a pressure column it somehow carried would open a story with no
    // challenge log behind it. Skipped the way `status.ts` skips it.
    if (row === undefined || isJournal(row)) continue;
    if (row.pressure > 0) candidates.add(id);
  }

  // Group by the live head. The chain each candidate walks is what decides which
  // of them is the ROOT — the longest chain starts furthest back.
  const groups = new Map<string, { id: string; length: number }[]>();
  for (const id of candidates) {
    const chain: string[] = [];
    let cursor: string | undefined = id;
    while (cursor !== undefined && !chain.includes(cursor)) {
      chain.push(cursor);
      cursor = store.row(cursor)?.superseded_by ?? undefined;
    }
    const head = chain[chain.length - 1] ?? id;
    const group = groups.get(head) ?? [];
    group.push({ id, length: chain.length });
    groups.set(head, group);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([head, members]) => {
      const root = [...members].sort((a, b) => b.length - a.length || (a.id < b.id ? -1 : 1))[0];
      return [root?.id ?? head, head];
    });
}

export function renderStories(src: DashboardSource, opts: StoriesOptions = {}): string {
  const style = opts.style ?? PLAIN;
  const limit = opts.limit ?? DEFAULT_STORY_LIMIT;
  const groups = opts.id === undefined ? contestedBeliefs(src) : [[opts.id, opts.id]];

  if (groups.length === 0) {
    return stack(
      heading("How my beliefs have changed", style),
      style.warn(
        `${NONE} — nothing I hold has been argued with. No belief has taken a single credited challenge.`,
      ),
      "That is a real answer, not an empty panel: a store with no contested belief has never had one, and this line is how I say so.",
    );
  }

  const told = groups.slice(0, limit).map(([root]) => oneStory(src, root ?? "", style));
  const footer =
    groups.length > limit
      ? `${plural(groups.length, "contested belief")}; showing ${limit}. Ask for one with \`stories --id <id>\`.`
      : `${plural(groups.length, "contested belief")}, all shown.`;

  return stack(heading("How my beliefs have changed", style), ...told, footer);
}

// ── one belief's story ───────────────────────────────────────────────────────

function oneStory(src: DashboardSource, rootId: string, style: Style): string {
  const store = src.store;
  const story = src.schemas.story(rootId);
  const head = resolveRef(store, story.headId);
  const origin = resolveRef(store, rootId, { follow: false });

  // The entity this belief is about, resolved now — a story with no subject is
  // a column of floats.
  const entityId = (() => {
    try {
      return store.readProse(story.headId).meta["entityId"];
    } catch {
      return undefined;
    }
  })();
  const about =
    typeof entityId === "string" ? resolveRef(store, entityId).label : `${NONE} (no entity named)`;

  const revised = story.headId !== rootId;
  const facts: string[][] = [
    ["about", about],
    // UNFOLLOWED on purpose: the retained prose at the original address is what
    // "it began as" means, and it is read here, now — not carried from anywhere.
    ["it began as", origin.label],
    ["it now says", revised ? head.label : "the same thing — nothing has revised it"],
    [
      "pressure standing",
      story.pressure === 0
        ? revised
          ? `${NONE} — the revision reset it; the successor starts clean`
          : `${NONE} — the pressure has decayed, or was never credited`
        : `${num(story.pressure)} against a bar of ${num(story.bar)}` +
          (story.lastChallengedDay === null
            ? ""
            : `, last argued with on day ${story.lastChallengedDay}`),
    ],
    ["strength of the belief now", num(story.strength)],
  ];

  const beats = story.increments
    .slice()
    .sort((a, b) => a.day - b.day)
    .map((inc) => {
      const challenger = resolveRef(store, inc.challengerId, 52);
      const crossed = inc.pressureAfter >= inc.bar;
      // The lineage confirms the crossing and names what it became. Matched on
      // the TARGET's own supersession row rather than on dates: the challenge
      // day is the caller's lived day and the version day is the store's, and
      // a story must not depend on those two agreeing. A crossing with no
      // lineage row is still reported — that mismatch is worth seeing.
      const step = story.lineage.find((l) => l.id === inc.targetId && l.successorId !== null);
      const verdict = crossed
        ? step === undefined || step.successorId === null
          ? style.warn("crossed the bar — but I find no supersession recorded")
          : `${style.bold("REVISED")}, becoming ${resolveRef(store, step.successorId, 52).label}`
        : "held";
      return [
        `day ${inc.day}`,
        `challenged by ${challenger.label}`,
        `force ${num(inc.force)}`,
        `pressure ${num(inc.pressureAfter)} of ${num(inc.bar)}`,
        verdict,
      ];
    });

  const log =
    beats.length === 0
      ? indent(
          style.warn(
            `${NONE} — this belief carries pressure but I hold no credited challenge for it. Its increments predate the durable log, or were pruned.`,
          ),
        )
      : indent(table(beats));

  return stack(
    subheading(`Belief ${rootId}`, style),
    indent(table(facts)),
    `${indent(subheading("Every credited challenge, in the order it landed", style))}\n${log}`,
  );
}
