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
 * recallable, ranked or gated moves — the same rule as `FRAMING.journal`.
 *
 *   | the pair                         | this memory is… | shown as                                   |
 *   |----------------------------------|-----------------|--------------------------------------------|
 *   | settled `changed`                | over            | `Earlier (now [holds]):` in front          |
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
  const now: string[] = [];
  const earlier: string[] = [];
  const correctedBy: string[] = [];
  const corrects: string[] = [];
  const disagrees: string[] = [];
  const unsettled: string[] = [];
  for (const p of pairs) {
    const other = p.a === id ? p.b : p.a;
    if (p.state === "settled") {
      if (p.how === "changed") {
        if (p.over === id && p.holds !== null) now.push(p.holds);
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
