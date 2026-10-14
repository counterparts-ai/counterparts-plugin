export const STANDING_MAX_POINTERS = 2;
function live(store, id) {
  const r = store.row(id);
  return r !== undefined && r.archived === 0 && r.superseded_by === null && !(r.body === "" && r.content_hash === "");
}
function ids(list) {
  return list.slice(0, STANDING_MAX_POINTERS).map((x) => `[${x}]`).join(", ");
}
export function standingOf(store, id, opts = {}) {
  const pairs = (opts.pairs ?? store.contradictionsOf([id]).get(id) ?? []).filter((p) => p.via === null && p.state !== "withdrawn");
  let changedOver = false;
  const earlier = [];
  const correctedBy = [];
  const corrects = [];
  const disagrees = [];
  const unsettled = [];
  for (const p of pairs) {
    const other = p.a === id ? p.b : p.a;
    if (p.state === "settled") {
      if (p.how === "changed") {
        if (p.over === id && p.holds !== null)
          changedOver = true;
        else if (p.holds === id && p.over !== null)
          earlier.push(p.over);
      } else if (p.how === "corrected") {
        if (p.over === id && p.holds !== null)
          correctedBy.push(p.holds);
        else if (p.holds === id && p.over !== null)
          corrects.push(p.over);
      } else if (p.how === "open") {
        disagrees.push(other);
      }
    } else if (p.state === "unsettled" && p.a === id && live(store, p.a) && live(store, p.b)) {
      unsettled.push(p.b);
    }
  }
  const head = changedOver ? headOf(store, id) : null;
  const now = head === null ? [] : [head];
  const front = [];
  const back = [];
  const said = [];
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
  if (said.length === 0)
    return null;
  return {
    prefix: front.length === 0 ? "" : `${front.join("; ")}: `,
    suffix: back.length === 0 ? "" : ` (${back.join("; ")})`,
    note: said.join("; ")
  };
}
export const HEAD_MAX_STEPS = 50;
function liveRow(store, id) {
  const r = store.row(id);
  return r !== undefined && r.archived === 0 && r.superseded_by === null && !(r.body === "" && r.content_hash === "");
}
export function pairOrder(a, b) {
  return a.flagged_day - b.flagged_day || a.created_at - b.created_at;
}
function newestHolder(store, id) {
  const pairs = [...store.contradictionsOf([id]).get(id) ?? []].reverse().filter((p) => p.state === "settled" && p.via === null && p.over === id && p.holds !== null && (p.how === "changed" || p.how === "corrected")).sort(pairOrder);
  return pairs[pairs.length - 1]?.holds ?? null;
}
export function headOf(store, id) {
  try {
    const seen = new Set([id]);
    const start = store.row(id);
    if (start === undefined)
      return null;
    let next = start.superseded_by ?? newestHolder(store, id);
    let end = null;
    for (let steps = 0;next !== null && steps < HEAD_MAX_STEPS; steps++) {
      if (seen.has(next))
        break;
      seen.add(next);
      const r = store.row(next);
      if (r === undefined)
        break;
      if (!liveRow(store, next)) {
        next = r.superseded_by;
        continue;
      }
      end = next;
      next = newestHolder(store, next);
    }
    return end === id ? null : end;
  } catch {
    return null;
  }
}
export function earlierMark(head) {
  return `earlier (now ${head})`;
}
