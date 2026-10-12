/**
 * A MEMORY'S STANDING, as recall shows it (2026-09-29, contradictions) — the
 * label that says, before the words are read, that a memory is not simply
 * current: it was true once and has changed, it was corrected, it disagrees
 * with another, or it is in an unsettled pair and may be out of date. And, by
 * id only, that it was replaced.
 *
 * Read off the pair rows (`contradictions`, schema v10) and the row's own
 * forwarding address; ids only, so the label names where to look rather than
 * repeating anyone's words. A LABEL, never a filter: nothing about what is
 * recallable, ranked or gated moves here — the same rule as `FRAMING.journal`.
 * (Since 2026-10-11, Group 2, ambient recall hides a settled-over memory
 * behind its head: `recall/index.ts#headsWin` and the gate, reading `headOf`
 * below. The label is what it carries wherever it still shows.)
 *
 *   | the pair                         | this memory is… | shown as                                   |
 *   |----------------------------------|-----------------|--------------------------------------------|
 *   | settled `changed`                | over            | `Earlier (now [head]):` in front (headOf)  |
 *   |                                  | holds           | `(earlier: [over])` after                  |
 *   | settled `corrected`              | over (by id)    | `Corrected by [holds]:` in front           |
 *   |                                  | holds           | `(corrects [over])` after                  |
 *   | settled `open`                   | either          | `(disagrees with [other])` after           |
 *   | unsettled, both standing         | the OLDER       | `Unsettled — may be out of date, see [b]:` |
 *   | (by id) superseded row           | —               | `Replaced by [successor]:` in front        |
 *
 * A pair closed through another (`via`) and a withdrawn one say nothing: the
 * pair that closed it speaks for it.
 */
import type { ContradictionRow, Store } from "../store/index.js";

/** At most this many pointers of one kind on one memory. */
export const STANDING_MAX_POINTERS = 2;

export interface Standing {
  /** Words in front of the memory's text (a qualifier is read before the claim). Empty when none. */
  readonly prefix: string;
  /** A pointer after it. Empty when none. */
  readonly suffix: string;
  /** Both, as one plain sentence, for a result that carries it as a field. */
  readonly note: string;
}

type StandingStore = Pick<Store, "row" | "contradictionsOf">;

function live(store: StandingStore, id: string): boolean {
  const r = store.row(id);
  return r !== undefined && r.archived === 0 && r.superseded_by === null && !(r.body === "" && r.content_hash === "");
}

function ids(list: readonly string[]): string {
  return list.slice(0, STANDING_MAX_POINTERS).map((x) => `[${x}]`).join(", ");
}

/**
 * The standing of one memory, or null when it has none. `byId`: the caller
 * asked for this memory by its address, so a replaced row says so too.
 * `pairs`, when the caller already read them (a render reads its rows once).
 */
export function standingOf(
  store: StandingStore,
  id: string,
  opts: { byId?: boolean; pairs?: readonly ContradictionRow[] } = {},
): Standing | null {
  const pairs = (opts.pairs ?? store.contradictionsOf([id]).get(id) ?? []).filter((p) => p.via === null && p.state !== "withdrawn");
  let changedOver = false;
  const earlier: string[] = [];
  const correctedBy: string[] = [];
  const corrects: string[] = [];
  const disagrees: string[] = [];
  const unsettled: string[] = [];
  for (const p of pairs) {
    const other = p.a === id ? p.b : p.a;
    if (p.state === "settled") {
      if (p.how === "changed") {
        if (p.over === id && p.holds !== null) changedOver = true;
        else if (p.holds === id && p.over !== null) earlier.push(p.over);
      } else if (p.how === "corrected") {
        if (p.over === id && p.holds !== null) correctedBy.push(p.holds);
        else if (p.holds === id && p.over !== null) corrects.push(p.over);
      } else if (p.how === "open") {
        disagrees.push(other);
      }
    } else if (p.state === "unsettled" && p.a === id && live(store, p.a) && live(store, p.b)) {
      unsettled.push(p.b);
    }
  }
  // "Earlier (now …)" names the END of the chain, the one memory a write's
  // neighbours and the dream's bundles name too (`headOf`, review of #408):
  // on A→B→C, A reads "now [C]", not "now [B]". And `headOf`'s rule decides
  // whether it is earlier at all: its holder gone with nothing live after it,
  // it stands and carries no "Earlier".
  const head = changedOver ? headOf(store, id) : null;
  const now: string[] = head === null ? [] : [head];
  const front: string[] = [];
  const back: string[] = [];
  const said: string[] = [];
  if (opts.byId === true) {
    const row = store.row(id);
    if (row !== undefined && row.superseded_by !== null) {
      front.push(`Replaced by [${row.superseded_by}]`);
      said.push(`replaced by ${row.superseded_by}`);
    }
  }
  if (correctedBy.length > 0) {
    front.push(`Corrected by ${ids(correctedBy)}`);
    said.push(`corrected by ${correctedBy.slice(0, STANDING_MAX_POINTERS).join(", ")}`);
  }
  if (now.length > 0) {
    front.push(`Earlier (now ${ids(now)})`);
    said.push(`earlier — now ${now.slice(0, STANDING_MAX_POINTERS).join(", ")}`);
  }
  if (unsettled.length > 0) {
    front.push(`Unsettled — may be out of date, see ${ids(unsettled)}`);
    said.push(`unsettled — may be out of date, see ${unsettled.slice(0, STANDING_MAX_POINTERS).join(", ")}`);
  }
  if (earlier.length > 0) {
    back.push(`earlier: ${ids(earlier)}`);
    said.push(`earlier: ${earlier.slice(0, STANDING_MAX_POINTERS).join(", ")}`);
  }
  if (corrects.length > 0) {
    back.push(`corrects ${ids(corrects)}`);
    said.push(`corrects ${corrects.slice(0, STANDING_MAX_POINTERS).join(", ")}`);
  }
  if (disagrees.length > 0) {
    back.push(`disagrees with ${ids(disagrees)}`);
    said.push(`disagrees with ${disagrees.slice(0, STANDING_MAX_POINTERS).join(", ")}`);
  }
  if (said.length === 0) return null;
  return {
    prefix: front.length === 0 ? "" : `${front.join("; ")}: `,
    suffix: back.length === 0 ? "" : ` (${back.join("; ")})`,
    note: said.join("; "),
  };
}

// ── settled over: the head, and the one mark (2026-10-11) ──────────────────

/**
 * THE MEMORY THAT NOW HOLDS IN PLACE OF THIS ONE, or null when this one
 * still stands (2026-10-11). On 10-11 a write's neighbour list showed a
 * memory a later one had settled `changed` over by its bare title, and the
 * session repeated the rule it had replaced. So every surface that shows a
 * memory's title by its own path — not through `standingOf`'s label — asks
 * this first and marks what it shows (`earlierMark`); `standingOf`'s
 * "Earlier (now …)" names the same memory (review of #408).
 *
 * The rule is `self/index.ts#settledOver`'s, for one id: of the STANDING
 * settled pairs in which it is the `over` (a `changed` or `corrected` closed
 * through another speaks through that one), the newest — and that pair's
 * `holds` leads to a live memory, followed through its own settles and
 * through `superseded_by` to the live end. A settle speaks only about the
 * pair it names (2026-10-11, Group 3 part B; random-06, lightly held): a
 * later "B over A" says nothing about "C over B", so B stays earlier under C.
 * To make B current again, settle B over C: the settle door reorders the pair
 * it names (`reconsolidation.ts#settle`, review of #432). Until then a pair in
 * which it HOLDS re-affirmed it (#408's rule). A
 * `holds` with no live end hides nothing. A replaced row (`superseded_by`)
 * answers its live successor.
 * Bounded (a chain is walked at most `HEAD_MAX_STEPS` links, a cycle is
 * none) and never throws: a store that will not answer has settled nothing.
 */
export const HEAD_MAX_STEPS = 50;

type HeadStore = Pick<Store, "row" | "contradictionsOf">;

function liveRow(store: HeadStore, id: string): boolean {
  const r = store.row(id);
  return r !== undefined && r.archived === 0 && r.superseded_by === null && !(r.body === "" && r.content_hash === "");
}

/**
 * NEWEST BY WHEN IT WAS RAISED, not when it was answered (2026-10-11, Group
 * 2b; review of #420): a pair's `flagged_day`, then the moment it was made.
 * A late answer to an old question — a slot proposal confirmed days after a
 * newer settle over its newer memory — must not re-affirm what that newer
 * settle covered. A direct settle is raised the day it is made.
 */
export function pairOrder(a: Pick<ContradictionRow, "flagged_day" | "created_at">, b: Pick<ContradictionRow, "flagged_day" | "created_at">): number {
  return a.flagged_day - b.flagged_day || a.created_at - b.created_at;
}

/** The `holds` of the newest standing direct changed/corrected settle in which `id` is the `over`; else null. */
function newestHolder(store: HeadStore, id: string): string | null {
  const pairs = [...(store.contradictionsOf([id]).get(id) ?? [])]
    .reverse()
    .filter((p) => p.state === "settled" && p.via === null && p.over === id && p.holds !== null && (p.how === "changed" || p.how === "corrected"))
    .sort(pairOrder);
  return pairs[pairs.length - 1]?.holds ?? null;
}

export function headOf(store: HeadStore, id: string): string | null {
  try {
    const seen = new Set<string>([id]);
    // Where `id` points first: its successor when replaced, else the memory that holds over it.
    const start = store.row(id);
    if (start === undefined) return null;
    let next: string | null = start.superseded_by ?? newestHolder(store, id);
    let end: string | null = null;
    for (let steps = 0; next !== null && steps < HEAD_MAX_STEPS; steps++) {
      if (seen.has(next)) break;
      seen.add(next);
      const r = store.row(next);
      if (r === undefined) break;
      if (!liveRow(store, next)) {
        next = r.superseded_by;
        continue;
      }
      // Live: the end so far, and further when it was itself settled over.
      end = next;
      next = newestHolder(store, next);
    }
    return end === id ? null : end;
  } catch {
    return null;
  }
}

/**
 * THE ONE MARK a settled-over memory carries wherever it is shown by its own
 * title or words: `earlier (now mem_…)`, read before the words. ~30 bytes.
 */
export function earlierMark(head: string): string {
  return `earlier (now ${head})`;
}
