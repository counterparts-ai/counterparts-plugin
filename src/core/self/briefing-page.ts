/**
 * THE SELF PAGE IN THE WAKE — its block, its ladder of whole rungs, the
 * lines around it and the room it is sized to, moved out of `briefing.ts` on
 * 2026-10-12 (moves only). Imported by `briefing.ts` alone, which re-exports
 * its public names (`split-parts.test.ts`).
 */
import { byteLength } from "./identity.js";
import { HANDOFF_RESERVE_MAX_BYTES, HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE } from "../handoff/index.js";
import { PREFACE_RESERVE_BYTES, groupDigits } from "./briefing-delivery.js";



/**
 * THE PAGE, IN "WHO I AM" — furniture, like the day-0 line, and for the same
 * reason: it is not a ranked element, it carries no `- ` bullet, and `counts`
 * and the sentinel's `elements=` stay true of a bundle that holds it.
 *
 * The page prints FIRST and AS IS. Not re-wrapped, not re-ordered, not
 * summarised: a page reassembled here would be a page this module wrote, and
 * what the owner and the session are promised is the thing they wrote.
 * `FRAMING.context`'s "each line opens with the date it was learned" is a claim
 * about the element lines — the day-0 line has carried no date since it shipped
 * — and the page carries its own date on its own line instead.
 */
export interface PageBlock {
  /**
   * The page as it will be injected, on the rung the room allowed
   * (`PageRung`, 2026-10-10): the whole page, the short version its writer
   * wrote with it, each section's heading and first sentence, its headings
   * alone, or the one line that says it did not fit (`pageTooLargeLine`).
   * Every rung is whole text — never part of a sentence (2026-10-09).
   */
  readonly text: string;
  /**
   * THE TOP LINE (2026-10-10, `pageTopLine`): what is below, the page's size,
   * the exact line it ends with, and both doors to the whole page — so a
   * reader whose copy was cut on the way (a host's preview) can tell. Null on
   * the one-line rung, which is its own top line.
   */
  readonly top: string | null;
  /** The page's own "last revised" line, or null when the page carries no date. */
  readonly dateline: string | null;
  /** THE END LINE (`pageEndLine`), after the dateline; null when `top` is. */
  readonly end: string | null;
  /** Which rung printed. */
  readonly rung: PageRung;
  /** True when the page did not print whole — any rung but `whole`. */
  readonly truncated: boolean;
  /** The page's own bytes, whole, whatever was rendered. */
  readonly wholeBytes: number;
}

/**
 * THE PAGE'S FALLBACK LADDER (2026-10-10), first to last; `Self#pageBlock`
 * takes the first that fits. Every rung is whole text, never a cut:
 *
 *   - `whole`    — the page, byte for byte;
 *   - `short`    — the short version the page's writer wrote WITH this
 *                  version of it (`SelfPage.short`, tied to the page's exact
 *                  text, so a page rewritten without one never shows a stale
 *                  one);
 *   - `outline`  — each `##` section's heading and its first whole sentence
 *                  (`page.ts#pageOutline`), mechanical;
 *   - `headings` — the headings alone;
 *   - `line`     — one line naming the page's size and both doors
 *                  (`pageTooLargeLine`), its own top line.
 */
export const PAGE_RUNGS = ["whole", "short", "outline", "headings", "line"] as const;
export type PageRung = (typeof PAGE_RUNGS)[number];

/**
 * The page's own date, under the page. It states the DATE and — when the page
 * has gone stale — how long the silence was allowed to be, rather than "N days
 * ago": the bundle is composed at a boundary and then served unchanged until
 * the next one, so a delta computed here goes wrong while a date does not.
 */
export function pageDateline(revisedOn: string, stale: boolean, staleDays: number): string | null {
  const on = revisedOn.trim();
  // A page with no readable date SAYS SO. Returning null printed the page with
  // no date and no staleness signal at all while every other surface called it
  // stale — the one state where the wake said less than it knew (adversarial
  // review m6). Only reachable on a hand-minted or hand-edited row.
  if (on === "" || !/^\d{4}-\d{2}-\d{2}$/.test(on) || !Number.isFinite(Date.parse(`${on}T00:00:00Z`))) {
    return "(Last revised — the page carries no readable date.)";
  }
  return stale
    ? `(Last revised ${on} — more than ${staleDays} days before this wake was composed.)`
    : `(Last revised ${on}.)`;
}

/**
 * THE ROOM THE WAKE'S OWN FURNITURE TAKES AROUND THE PAGE, in bytes — the
 * number `Self.build` subtracts from the caller's ceiling before it asks
 * whether the page fits. Structural, not tunable, and measured rather than guessed: a test
 * composes the widest plausible furniture (a six-digit day and six-digit lane
 * counts in both comment lines, the stale dateline at a six-digit threshold)
 * and asserts it fits under this.
 *
 * It exists because of the adversarial review of PR #138. The page's cap was
 * clamped to the WHOLE budget, so a long page filled the budget exactly and the
 * header, `FRAMING.context`, the heading, the dateline and the sentinel pushed
 * the composition past it — and nothing could trim it back, because the identity
 * lane is empty by then and the page is furniture the trim loop cannot pop. An
 * 8,657-byte page published `overBudget: true` at host budgets of 400, 900,
 * 2,000 and 6,000. That is scar §2.18's guarantee paying for a block of prose,
 * and it is the same measurement that kept the still-forming line out of the
 * default switch (NOTES §12a) — applied to the page this time.
 *
 * Widest measured furniture: 444 bytes. 512 is that plus room for a line to
 * gain a word.
 */
export const PAGE_FLOOR_RESERVE_BYTES = 512;

/**
 * HOW MANY OF THE DELIVERY'S RESERVES ARE HELD UNDER THE SHARE RULE
 * (`handoff/#reserveBytes`), beside the preface: the handoff pointer with its
 * "Last here" line, and "Work here" with the "Last said here" line beside it
 * (2026-10-11, one term; `counterpart.ts#wakeReserveBytes` and
 * `#workReserveBytes`). Each is at most an eighth of the ceiling and never past
 * `HANDOFF_RESERVE_MAX_BYTES`. A third reserve there is a third here, or the
 * page's limit below promises room the wake does not have — a test holds the
 * root to `deliveryReserveBound`.
 */
export const DELIVERY_SHARED_RESERVES = 2;

/**
 * THE MOST THE DELIVERY CAN HOLD BACK FROM A HOST CEILING, in bytes
 * (2026-10-09): the preface's reserve and `DELIVERY_SHARED_RESERVES` terms at
 * the share rule's widest. What the root subtracts on a given day is usually
 * less; this is the bound the page's limit is sized under. Pure.
 */
export function deliveryReserveBound(budgetBytes: number): number {
  const share = Math.max(
    0,
    Math.min(HANDOFF_RESERVE_MAX_BYTES, Math.floor(budgetBytes / HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE)),
  );
  return PREFACE_RESERVE_BYTES + DELIVERY_SHARED_RESERVES * share;
}

/**
 * THE END LINE OF EACH RUNG (2026-10-10). Fixed words, so the top line's
 * quote of it costs a known number of bytes and a reader can match it
 * exactly. Printed after the page's dateline. The one-line rung has none: it
 * is its own top line.
 */
export const PAGE_END_LINES: Readonly<Record<Exclude<PageRung, "line">, string>> = {
  whole: "(End of my page.)",
  short: "(End of the short version.)",
  outline: "(End of the outline.)",
  headings: "(End of the headings.)",
};

/** The end line a rung prints, or null for the one-line rung. */
export function pageEndLine(rung: PageRung): string | null {
  return rung === "line" ? null : PAGE_END_LINES[rung];
}

/** Both doors to the whole page, in the words every rung uses. */
const PAGE_DOORS = "the self_page tool or 'counterparts self-page'";

/**
 * THE TOP LINE OF EACH RUNG (2026-10-10): what follows, the page's size, the
 * exact line it ends with, and — if that line is missing — that it was cut
 * on the way, and both doors to the whole page. It is what protects against
 * the cuts this package does not make: a host's preview keeps the head of
 * what it was handed, so the top line survives the cut it describes.
 * `wholeBytes` is the page's own size, whatever the rung shows. Plain words,
 * for whoever reads the wake. Null on the one-line rung.
 */
export function pageTopLine(rung: PageRung, wholeBytes: number): string | null {
  const n = groupDigits(wholeBytes);
  const end = pageEndLine(rung);
  if (end === null) return null;
  const ends = `It ends with "${end}" — if you don't see that line, it was cut off`;
  switch (rung) {
    case "whole":
      return `(My page, ${n} bytes. ${ends}: read it whole with ${PAGE_DOORS}.)`;
    case "short":
      return `(The short version of my ${n}-byte page, too long for this wake. ${ends}. Read the whole page with ${PAGE_DOORS}.)`;
    case "outline":
      return `(My page is ${n} bytes, too long for this wake: here is each section's heading and first sentence. ${ends}. Read the whole page with ${PAGE_DOORS}.)`;
    case "headings":
      return `(My page is ${n} bytes, too long for this wake: here are its section headings. ${ends}. Read the whole page with ${PAGE_DOORS}.)`;
    case "line":
      return null;
  }
}

/** Each rung's top line (and the last rung's one line), as a reader finds it again. */
const PAGE_TOP_READERS: readonly (readonly [PageRung, RegExp])[] = [
  ["whole", /^\(My page, ([\d,]+) bytes\. It ends with "/],
  ["short", /^\(The short version of my ([\d,]+)-byte page, too long for this wake\./],
  ["outline", /^\(My page is ([\d,]+) bytes, too long for this wake: here is each section's heading and first sentence\./],
  ["headings", /^\(My page is ([\d,]+) bytes, too long for this wake: here are its section headings\./],
  ["line", /^\(My page is (\d+) bytes — no room for it (?:whole )?in this wake\./],
];

/**
 * WHICH RUNG A WAKE PRINTED THE PAGE ON, read back off its own words
 * (2026-10-10) — for a reader of a published bundle that has no render row
 * (the dashboard's wake costs). The first top line found, and the page's
 * size it states; null when the wake carries none (no page, or a bundle
 * published before the ladder). Kept beside `pageTopLine` so the wording and
 * its reader change together; a test round-trips every rung. Pure.
 */
export function readPageTopLine(text: string): { rung: PageRung; wholeBytes: number } | null {
  for (const line of text.split("\n")) {
    for (const [rung, re] of PAGE_TOP_READERS) {
      const m = re.exec(line);
      if (m !== null) return { rung, wholeBytes: Number((m[1] ?? "0").replace(/,/g, "")) };
    }
  }
  return null;
}

/**
 * A LINE OF THE WAKE'S OWN FRAME AROUND THE PAGE (review of #363): a rung's
 * top line or end line, or the one line, standing whole on a line of its own.
 * A session that copies its page out of the wake and back through a writer
 * would otherwise store them, and every wake after would print a stale size
 * and an end line in the middle of the page — after which a cut would look
 * whole. Left out where the page is written and where it is rendered, like
 * its datelines (`Self#ownWords`). A sentence that only mentions one is not
 * one. Pure.
 */
export function isPageFrameLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("(") || !t.endsWith(")")) return false;
  if ((Object.values(PAGE_END_LINES) as readonly string[]).includes(t)) return true;
  return PAGE_TOP_READERS.some(([, re]) => re.test(t));
}

/**
 * THE ROOM A PAGE BLOCK TAKES in "Who I am", in bytes: its top line, its text
 * and its end line, with the newlines that join them. The dateline is not
 * counted here — it is furniture, inside `PAGE_FLOOR_RESERVE_BYTES`. Pure.
 */
export function pageBlockBytes(block: Pick<PageBlock, "top" | "text" | "end">): number {
  return (
    byteLength(block.text) +
    (block.top === null ? 0 : byteLength(block.top) + 1) +
    (block.end === null ? 0 : byteLength(block.end) + 1)
  );
}

/**
 * THE MOST THE TOP AND END LINES TAKE beside the page itself, in bytes
 * (2026-10-10) — on the two rungs a writer writes for, `whole` and `short`,
 * at a size wider than the write ceiling lets the top line state (999,999
 * bytes against 16,384). Structural, not tunable, and measured: the widest is
 * the short version's, 261, and a test holds both under this. It is paid for
 * in the page's room (`pageRoomBytes`), so the room the writer is told is the
 * room the page itself has, top and end lines already counted. (The two
 * mechanical rungs' frames are wider — no writer aims at them, and the wake
 * measures every rung exactly.)
 */
export const PAGE_FRAME_RESERVE_BYTES = 264;

/**
 * THE PAGE THE WAKE PRINTS WHOLE at a host ceiling, whatever the delivery
 * reserves that day, in bytes (2026-10-09): the ceiling, less the most the
 * delivery can hold back (`deliveryReserveBound`), less the furniture the wake
 * wraps the page in (`PAGE_FLOOR_RESERVE_BYTES`), less its top and end lines
 * (`PAGE_FRAME_RESERVE_BYTES`, 2026-10-10). `Self#pageBlock` prints a page
 * whole whenever it fits the room the composition actually has, which is
 * never less than this. A short version within it prints whole the same way.
 * Grows with the ceiling. Pure.
 */
export function pageRoomBytes(hostBudgetBytes: number): number {
  return hostBudgetBytes - deliveryReserveBound(hostBudgetBytes) - PAGE_FLOOR_RESERVE_BYTES - PAGE_FRAME_RESERVE_BYTES;
}

/**
 * THE HOST CEILING THE PAGE'S LIMIT IS SIZED AGAINST, in bytes — the one
 * `install` writes when nobody names one (`adapters/cli/commands.ts`'s
 * `DEFAULT_BUDGET_BYTES` is this constant), and the one every host reads
 * today: Claude Code's hooks and Claude Desktop's `wake` tool deliver the same
 * bundle, composed at the configuration's `injectionBudgetBytes`.
 *
 * NOT a ceiling anything composes against: scar §2.18 holds, and a host that
 * reported none still composes no wake. It sizes one write limit, below.
 */
export const PAGE_HOST_BUDGET_BYTES = 9_000;

/**
 * THE SELF PAGE'S ROOM, in bytes (2026-10-09; a target, not a limit, since
 * 2026-10-10): `pageRoomBytes` at `PAGE_HOST_BUDGET_BYTES`. One number for
 * both ends, derived rather than chosen, so what the writer is told and what
 * the wake guarantees cannot drift apart: a page within it prints whole, byte
 * for byte, top and end lines included, at that ceiling or a larger one,
 * under the widest reserves the delivery can take.
 *
 * The writer is told it as a TARGET ("aim under N bytes"), and a page past it
 * is kept whole — refused only past the write ceiling (`PAGE_MAX_BYTES`,
 * 16,384). Past the room the wake steps down the ladder (`PageRung`) on a day
 * it cannot hold the page, so the writer is asked for a short version within
 * this same number, written with the page.
 *
 * Why one number: #350's second reviewer measured the old pair apart — the
 * wake's cap was `min(6,144, budget − 512)`, which under the widest reserves at
 * 9,000 is 6,078, while the writer accepted up to 16,384 — so a page between
 * them was cut. #358 then refused every page past the room, and the page's
 * history showed the stopgap losing by a few hundred bytes each time (7,012,
 * 6,767, then 6,085, each trimmed by hand).
 */
export const PAGE_ROOM_BYTES = pageRoomBytes(PAGE_HOST_BUDGET_BYTES);

/**
 * THE LAST RUNG (2026-10-09): the one short line a wake with no room for any
 * other prints instead of the page — never a fragment of it. It names the
 * page's size and both doors, so it is its own top line.
 */
export function pageTooLargeLine(bytes: number): string {
  return `(My page is ${bytes} bytes — no room for it whole in this wake. Read it with the self_page tool, or 'counterparts self-page'.)`;
}