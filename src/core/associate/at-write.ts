/**
 * Write-time links — a new memory gets a faint link to what was in mind when
 * it was written (Group 4 item 2, 2026-10-11; bench item 5). A PURE planner:
 * each new memory with what was in mind when it was written in (for a memory
 * written in the moment, what recall showed its session on the write's own
 * turn; a write-up's memories have nothing, `Counterpart#linkAtWrite`),
 * proposed pairs out. It reads no store and writes nothing; the
 * boundary hands the pairs to `Associate.propose` at `WRITE_LINK_WEIGHT`, so
 * they land only where there is room and never evict what use has learned.
 *
 * The analog is the temporal context model again (`contiguity.ts`): what is
 * active in mind when an item is encoded becomes its context, and later cues
 * it. It is WEAK on purpose: what recall shows is often noise to the reply
 * (G1b's hand-read precision of footnotes was 0.17–0.33), so a trail laid here
 * is a faint one that use must confirm before it conducts much — the ants
 * rule. A memory the session NAMES in `drewOn` gets the strong deposit
 * instead (`Counterpart#creditDrewOn`).
 *
 * Rules the code mechanizes:
 *
 *   1. **What was in mind, nearest first.** The caller orders each memory's
 *      `inMind` (what a deliberate question showed near its write when that is
 *      on, then the recent turns' showings, newest turn first) and this keeps the first
 *      `WRITE_LINK_MAX`.
 *   2. **Never to itself, never to a memory written in the same pass** (the
 *      session's own new memories are contiguity's), each pair once.
 */
import type { AssociateTunables } from "./tunables.js";

/** One new memory, with what was in mind when it was written, nearest first. */
export interface AtWriteMemory {
  readonly id: string;
  readonly inMind: readonly string[];
}

export interface AtWritePlan {
  /** Pairs to propose, a = the new memory, in the order planned. */
  readonly pairs: readonly { a: string; b: string }[];
  /** New memories with at least one pair. */
  readonly memories: number;
}

export function planAtWrite(
  memories: readonly AtWriteMemory[],
  t: AssociateTunables,
): AtWritePlan {
  const fresh = new Set(memories.map((m) => m.id));
  const seen = new Set<string>();
  const pairs: { a: string; b: string }[] = [];
  let linked = 0;
  for (const m of memories) {
    let n = 0;
    for (const other of m.inMind) {
      if (n >= t.WRITE_LINK_MAX) break;
      if (other === m.id || fresh.has(other)) continue;
      const key = m.id < other ? `${m.id}|${other}` : `${other}|${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ a: m.id, b: other });
      n += 1;
    }
    if (n > 0) linked += 1;
  }
  return { pairs, memories: linked };
}
