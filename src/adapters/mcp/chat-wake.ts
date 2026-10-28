/**
 * THE CLAUDE.AI WAKE'S SHAPE (2026-10-26, OL1b item 2; lightly held).
 *
 * claude.ai's `wake` is the same composition as every host's — the published
 * wake assembled for this moment, the clock, today's plain reminders — laid
 * out for a chat on the web, where the model reads it once before a reply and
 * the person is waiting:
 *
 *   1. ONE SHORT SESSION LINE. Desktop's head names four tools by name;
 *      claude.ai's says once to pass the id on every later call.
 *   2. WHAT IS FOR THE PERSON FIRST: the morning share (a slot, empty until
 *      the share carry for hookless hosts lands — OL1a owns that rule), then
 *      the clock and the plain reminders due today, then the wake with its
 *      "Coming up" and "Still open" lanes moved up to just under the framing
 *      line (`chatLanesFirst`). Nothing is reworded, cut or added: the lanes
 *      move whole, and every other line keeps its place.
 *   3. NO DREAM LINE. On this host the night is the person's own routine
 *      (`dream` launch from a scheduled task); the day's dream ask, relayed
 *      in a chat, read as "say dream if you want" (trial, 2026-10-26).
 *   4. "THE SAME YOU" ONLY WHEN IT IS TRUE (`sameYouLine`): one line naming
 *      the hosts that share this store. None does yet — a claude.ai store is
 *      its own — so the server hands it nothing and the line is never printed.
 *
 * Pure text functions; the server composes and claims (`server.ts#wakeTool`).
 */
import { FRAMING, LEGACY_CONTEXT, LEGACY_FRAMING, collapsedLane } from "../../core/self/briefing.js";

/** The session line a claude.ai wake opens with. */
export function claudeAiSessionLine(session: string): string {
  return `Counterparts session ${session}: pass it as \`session\` on every later Counterparts call in this conversation.`;
}

/** The page's own last line (`core/self`): a lane heading inside the page is not a lane. */
const PAGE_END = "(End of my page.)";

/**
 * "Coming up" and then "Still open", each moved whole to just under the
 * framing line — in full, or collapsed to its one counting line. A lane is
 * its heading and every line after it up to the next blank line (lanes hold
 * no blank line; the page can, so headings are looked
 * for after the page's end line). A wake without the framing line, or without
 * either lane, comes back unchanged. Pure.
 */
export function chatLanesFirst(text: string): string {
  const lines = text.split("\n");
  const framing = lines.findIndex((l) => l === FRAMING.context || l === LEGACY_CONTEXT);
  if (framing < 0) return text;
  const pageEnd = lines.indexOf(PAGE_END, framing);
  const from = pageEnd < 0 ? framing + 1 : pageEnd + 1;
  const blocks: string[][] = [];
  // A lane the budget collapsed to its one line ("Coming up: 1 — none due
  // today, 1 overdue; recall ids: …") moves too: it is still the lane.
  const lanes = [
    { lane: "horizon", headings: [FRAMING.horizon, LEGACY_FRAMING.horizon] as readonly string[] },
    { lane: "threads", headings: [FRAMING.threads] as readonly string[] },
  ] as const;
  for (const { lane, headings } of lanes) {
    const at = lines.findIndex((l, i) => i >= from && (headings.includes(l) || collapsedLane(l) === lane) && lines[i - 1] === "");
    if (at < 0) continue;
    let end = at + 1;
    while (end < lines.length && lines[end] !== "") end += 1;
    blocks.push(lines.slice(at, end));
    // Out, with the blank line after it, so no double blank is left behind.
    lines.splice(at, end - at + (lines[end] === "" ? 1 : 0));
  }
  if (blocks.length === 0) return text;
  const moved = blocks.flatMap((b) => [...b, ""]);
  // Under the framing line: its blank line, then the lanes, then what was first.
  const head = lines.slice(0, framing + 1);
  const rest = lines.slice(framing + 1);
  const restStart = rest[0] === "" ? rest.slice(1) : rest;
  return [...head, "", ...moved, ...restStart].join("\n");
}

/**
 * THE SEAM FOR "ONE ME" (the online plan, stage 3): the line that says this is
 * the same counterpart who works with the owner elsewhere, named by the hosts
 * that share this store. Null for none — the case today, so nothing prints.
 */
export function sameYouLine(owner: string | null, sharedWith: readonly string[]): string | null {
  if (sharedWith.length === 0) return null;
  const who = owner ?? "them";
  return `You are the same you who works with ${who} in ${sharedWith.join(" and ")}: one memory.`;
}

/** What a claude.ai wake is made of, in the order it is said. */
export interface ClaudeAiWakeParts {
  readonly session: string;
  /** The morning share, carried (OL1a's): empty until that lands. */
  readonly share: readonly string[];
  /** The clock, the tag line when it rides apart, and today's plain reminders. */
  readonly lead: string;
  /** The wake itself, as composed. */
  readonly wake: string;
  readonly sameYou: string | null;
  readonly notices: readonly string[];
  readonly meet: string | null;
}

/** The claude.ai wake, laid out. Pure. */
export function claudeAiWakeText(p: ClaudeAiWakeParts): string {
  const parts = [
    claudeAiSessionLine(p.session),
    ...(p.sameYou === null ? [] : [p.sameYou]),
    ...(p.share.length === 0 ? [] : [p.share.join("\n")]),
    `${p.lead}\n${chatLanesFirst(p.wake)}`.trimEnd(),
    ...(p.notices.length === 0 ? [] : [p.notices.join("\n")]),
    ...(p.meet === null ? [] : [p.meet]),
  ];
  return parts.join("\n\n");
}
