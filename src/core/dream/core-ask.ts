/**
 * THE CORE QUESTIONS THAT WAITED (2026-10-20, Mike's go: "i agree with your
 * recs, lightly held, lets try it and see how it goes" — an experiment).
 *
 * Measured that day on the owner's store: five core memories were flagged
 * "being reconsidered" on 10-13; by 10-20 two had an answer. The wake asks one
 * at a time, and nothing made the rest get answered. So a core memory flagged
 * `CORE_WAITING_DAYS` (7) lived days ago or more, with no decision since, is
 * offered to the nightly reflection — at most `CORE_ASK_MAX` (3) a night, the
 * least recently offered first, then the longest waiting — with its
 * unsettled pair, if it is in one, both sides shown. The reflection decides
 * keep or retire with a why where it can (`finish`'s `core`), and leaves the
 * rest. The share says what it decided in one line, with the way back
 * (`sleep/core-standing.ts#keepCore`'s restore; `remember`'s core retire).
 *
 * Reads only; the reflection writes (`reflect.ts`).
 */
import type { ContradictionRow, Store } from "../store/index.js";
import { TUNABLES as SLEEP } from "../sleep/tunables.js";

/** One waiting core memory, as the reflection's bundle carries it. */
export interface CoreAsk {
  readonly id: string;
  /** The flag's reason category (`reconsiderWords` says it). */
  readonly reason: string | null;
  /** Lived days since it was flagged. */
  readonly waited: number;
  /**
   * The unsettled pair it is in, if any: the pair's id and the other memory
   * (shown beside it). `older`: the core memory is the older of the two, the
   * one that "may be out of date".
   */
  readonly pair?: { readonly id: string; readonly other: string; readonly older: boolean };
}

/** A decision a reflection made on the core, as its row keeps it. */
export interface CoreDecided {
  readonly id: string;
  readonly decision: "keep" | "retire";
  readonly why: string;
}

type AskStore = Pick<Store, "coreReconsidering" | "contradictionsOf" | "row">;

function live(store: Pick<Store, "row">, id: string): boolean {
  const r = store.row(id);
  return r !== undefined && r.archived === 0 && r.superseded_by === null && !(r.body === "" && r.content_hash === "");
}

/** The first unsettled pair `id` is in with another memory that still stands, or null. */
export function unsettledPairOf(store: Pick<Store, "contradictionsOf" | "row">, id: string): NonNullable<CoreAsk["pair"]> | null {
  let pairs: readonly ContradictionRow[];
  try {
    pairs = store.contradictionsOf([id]).get(id) ?? [];
  } catch {
    return null;
  }
  for (const p of pairs) {
    if (p.state !== "unsettled" || p.via !== null) continue;
    const other = p.a === id ? p.b : p.a;
    if (other === id || !live(store, other)) continue;
    return { id: p.id, other, older: p.a === id };
  }
  return null;
}

/**
 * The core memories that have waited `CORE_WAITING_DAYS` lived days or more
 * for a decision, as of `day`. Oldest flag first. Empty when none, or unreadable.
 */
export function coreWaiting(store: Pick<Store, "coreReconsidering">, day: number): { id: string; reason: string | null; waited: number }[] {
  try {
    return store
      .coreReconsidering()
      .map((r) => ({ id: r.id, reason: r.reason, waited: day - r.day }))
      .filter((r) => r.waited >= SLEEP.CORE_WAITING_DAYS)
      .sort((a, b) => b.waited - a.waited || (a.id < b.id ? -1 : 1));
  } catch {
    return [];
  }
}

/** How many earlier reflections' offers the rotation reads (`coreAsks`' `lately`). */
export const CORE_ASK_LOOKBACK = 10;

/**
 * What one reflection is offered: the waiting ones `showable` lets through,
 * LEAST RECENTLY OFFERED first — `lately` is the earlier reflections' offers,
 * newest first (`CORE_ASK_LOOKBACK` of them); never offered leads, then the
 * longest ago — and among equals the longest waiting; at most `CORE_ASK_MAX`,
 * each with its unsettled pair when the other side is showable too. (Review
 * of #542: with only last night's offer to go by, seven waiting alternated
 * between the same two threes and the seventh was never offered.)
 */
export function coreAsks(store: AskStore, day: number, showable: (id: string) => boolean, lately: readonly ReadonlySet<string>[]): CoreAsk[] {
  const ago = (id: string): number => {
    const i = lately.findIndex((s) => s.has(id));
    return i < 0 ? Infinity : i;
  };
  const waiting = coreWaiting(store, day).filter((r) => showable(r.id));
  // A stable sort: `coreWaiting`'s order (longest waiting first) breaks ties.
  const ordered = [...waiting].sort((a, b) => {
    const x = ago(a.id);
    const y = ago(b.id);
    return x === y ? 0 : x < y ? 1 : -1;
  });
  return ordered.slice(0, SLEEP.CORE_ASK_MAX).map((r) => {
    const pair = unsettledPairOf(store, r.id);
    return pair !== null && showable(pair.other) ? { ...r, pair } : r;
  });
}

/**
 * THE SHARE'S CORE LINE: what the reflection decided, in one line, with the
 * way back. Null when it decided nothing. `handle` names a memory.
 */
export function coreSentence(decided: readonly CoreDecided[], handle: (id: string) => string): string | null {
  if (decided.length === 0) return null;
  const clean = (why: string): string => why.replace(/\s+/g, " ").replace(/[\s.;:,!]+$/u, "");
  const parts = decided.map((d) => `${d.decision === "keep" ? "kept" : "retired"} "${handle(d.id)}" (${d.id}) — ${clean(d.why)}`);
  const retired = decided.some((d) => d.decision === "retire");
  return `On the core, I ${parts.join("; and ")}${retired ? `; ${decided.length === 1 ? "it fades" : "what I retired fades"} like any memory now` : ""}. If ${decided.length === 1 ? "that is" : "one is"} wrong, say so and I'll undo it.`;
}

/** What the session is told to do when the owner says a core decision was wrong. Null when none. */
export function coreHow(decided: readonly CoreDecided[], who: string): string | null {
  if (decided.length === 0) return null;
  const ids = decided.map((d) => d.id).join(", ");
  return (
    `The share tells ${who} what I decided on the core (${ids}): tell it. If ${who} says one was wrong, now or in any later session: ` +
    `one I retired comes back with remember's core, {id, decision: "keep", why} (or counterparts core --reaffirm <id> --reason "..."); ` +
    `one I kept goes with decision "retire".`
  );
}
