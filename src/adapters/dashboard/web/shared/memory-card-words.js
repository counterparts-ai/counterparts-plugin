/* The memory card's sentences that depend on a reading of the payload — kept
   pure (no DOM, no window) so the words can be checked in `bun test`
   (2026-09-27, round 3 of the memories tab; a try, not a rule).

   Nothing here decides anything about the memory: the road to the core is the
   engine's verdict (`views/memory.ts#coreRoad`, from
   `physics#promotionEligibility`), and these functions only put it in words. */

/**
 * The road to the core, as one line — or "" when there is nothing to say
 * (already core, or not a memory that can become core).
 *
 * `p` is the card's `promotion` (`CoreRoad`). The fast lane is named when it
 * applies — felt strongly, so one real return is all it needs — and the slow
 * lane's day count only when that is the road left.
 */
export function coreRoadLine(p, promoted) {
  if (promoted || !p) return "";
  if (p.eligible && p.lane === "fast") return "Felt strongly and come back to — it has met the core's bar, and a sleep can make it core.";
  if (p.eligible && p.lane === "slow") return "It has come back on enough separate days — it has met the core's bar, and a sleep can make it core.";
  if (p.oneReturn) {
    return "Felt strongly, so one real return makes it core — coming back to it " + p.needGap +
      (p.needGap === 1 ? " lived day" : " lived days") + " or more after it was made.";
  }
  if (p.byUse) {
    const more = Math.max(0, p.required - p.days);
    const tail = more > 0 ? " — " + more + " more to go."
      : p.span < p.needSpan ? " — it needs to keep coming back a little longer."
      : p.holdShort ? " — it has come back enough, and needs to be held a little more firmly."
      : ".";
    return "Coming back on " + p.required + " separate days over " + p.needSpan + " makes it core" + tail;
  }
  if (p.blocked === "demoted-by-owner") return "You took it out of the core, so it stays out.";
  return "";
}

/**
 * Where the strength curve starts, in words. The curve starts at the last use
 * — but a memory nobody has used yet "starts" on the day it was written, and
 * that is not a use (it would sit beside "Not used yet."). A last use older
 * than the curve's window starts it on a plain day.
 */
export function curveStart(d) {
  const c = d.curve;
  if (!c) return "";
  if (c.from === c.day) return "today, day " + c.day;
  if (c.from > d.lastUsedDay) return "day " + c.from;
  return (d.uses > 0 ? "last used, day " : "written, day ") + c.from;
}

/** "fading since it was last used" — or written, when it never has been. */
export function fadingSince(d) {
  return d.uses > 0 ? "fading since it was last used" : "fading since it was written";
}

const REL = {
  replaced: "replaced this older memory",
  corrects: "corrects (the other stays as it was)",
  revised: "rewritten in place",
  became: "replaced by this newer memory",
};

/**
 * The card's Versions list, as rows. A dream folding near-copies together is
 * named as that ("near-copy merged in a dream"), and the near-copies one dream
 * merged in on one day share a row ("2 near-copies merged in a dream"), so
 * two identical titles read as cleanup rather than as mystery history.
 *
 * Each row: { rel, label, day, reason (words, or null), refs: [{ id, text, confidential }] }.
 */
export function versionRows(timeline) {
  const rows = [];
  const dreamGroups = new Map();
  for (const s of timeline || []) {
    const ref = s.id ? { id: s.id, text: s.text, confidential: !!s.confidential } : null;
    if (s.rel === "replaced" && s.dream) {
      const key = String(s.day);
      let row = dreamGroups.get(key);
      if (!row) {
        row = { rel: "replaced", dream: true, label: "", day: s.day, reason: null, refs: [] };
        dreamGroups.set(key, row);
        rows.push(row);
      }
      if (ref) row.refs.push(ref);
      continue;
    }
    const label = s.rel === "became" && s.dream ? "merged in a dream into this near-copy" : (REL[s.rel] || s.rel);
    const reason = s.dream || s.rel === "corrects" || !s.reason ? null : String(s.reason).replace(/-/g, " ");
    rows.push({ rel: s.rel, dream: !!s.dream, label, day: s.day, reason, refs: ref ? [ref] : [] });
  }
  for (const row of dreamGroups.values()) {
    const n = Math.max(1, row.refs.length);
    row.label = n === 1 ? "near-copy merged in a dream" : n + " near-copies merged in a dream";
  }
  return rows;
}
