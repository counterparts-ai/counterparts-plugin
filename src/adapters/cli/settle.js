import { SLOT_SOURCE, heldPairs } from "../../core/reconsolidation.js";
import { CONTRADICTION_WINDOW_DAYS } from "../claude-code/doctor.js";
import { memoryWords } from "./dream-core.js";
export const SETTLE_LIST_RECENT = 10;
function who(s) {
  if (s.actor === "owner")
    return "you";
  if (s.actor === "session")
    return `session ${s.actor_id ?? "?"}`;
  return s.actor_id === null ? s.actor : `${s.actor} ${s.actor_id}`;
}
export function settleLine(counterpart, pair) {
  const last = counterpart.store.contradictionSettles({ pairId: pair.id }).filter((s) => s.action === "settle" && s.undone === 0).pop();
  const by = last === undefined ? "" : ` — ${who(last)}, lived day ${String(last.day)}${last.why === null ? "" : `: "${last.why}"`}`;
  if (pair.via !== null)
    return `${pair.id}  closed through ${pair.via}${by}`;
  if (pair.how === "open")
    return `${pair.id}  open: ${pair.a} and ${pair.b} disagree${by}`;
  return `${pair.id}  ${pair.how ?? "settled"}: ${pair.holds ?? "?"} holds over ${pair.over ?? "?"}${by}`;
}
export function heldListLines(counterpart) {
  const store = counterpart.store;
  let held;
  try {
    held = heldPairs(store, { sinceDay: store.livedDay() - CONTRADICTION_WINDOW_DAYS + 1 }).filter((h) => !h.settledAfter);
  } catch {
    return [];
  }
  if (held.length === 0)
    return [];
  const out = [
    "",
    `Held (${String(held.length)}, last ${String(CONTRADICTION_WINDOW_DAYS)} lived days): ${held.length === 1 ? "a correction" : "corrections"} that named a memory that didn't look related, so nothing was settled. Most are a wrong pointer and need nothing; settle one that was meant.`
  ];
  for (const h of held.slice(0, SETTLE_LIST_RECENT)) {
    const how = h.how === "changed" || h.how === "corrected" ? h.how : "corrected";
    out.push(`  ${h.holds} said it ${how === "changed" ? "changes" : "corrects"} ${h.over} (lived day ${String(h.day)})`);
    out.push(`    newer: "${memoryWords(counterpart, h.holds)}"`);
    out.push(`    older: "${memoryWords(counterpart, h.over)}"`);
    out.push(`    if meant: counterparts settle --holds ${h.holds} --against ${h.over} --how ${how} --why "..."`);
  }
  if (held.length > SETTLE_LIST_RECENT)
    out.push(`  (+${String(held.length - SETTLE_LIST_RECENT)} older)`);
  return out;
}
export function settleListLines(counterpart) {
  const store = counterpart.store;
  const waiting = store.contradictions({ state: "unsettled" });
  const unsettled = waiting.filter((p) => p.source !== SLOT_SOURCE);
  const proposed = waiting.filter((p) => p.source === SLOT_SOURCE);
  const settled = store.contradictions({ state: "settled" }).slice(0, SETTLE_LIST_RECENT);
  const out = [];
  out.push(unsettled.length === 0 ? "Contradictions: nothing unsettled." : `Contradictions: ${String(unsettled.length)} unsettled — two memories that disagree, and nobody has said which holds.`);
  for (const p of unsettled) {
    const dream = p.dream_id === null ? undefined : store.dream(p.dream_id);
    const from = p.dream_id === null ? p.source : `a dream on ${dream?.date ?? "a recent night"}`;
    out.push(`  ${p.id}  (flagged by ${from})`);
    out.push(`    older: ${p.a} "${memoryWords(counterpart, p.a)}"`);
    out.push(`    newer: ${p.b} "${memoryWords(counterpart, p.b)}"`);
  }
  if (proposed.length > 0) {
    out.push("", `Proposed as a newer state (${String(proposed.length)}) — read by arithmetic, waiting for the dream to confirm; undo one if they are two things:`);
    for (const p of proposed.slice(0, SETTLE_LIST_RECENT)) {
      out.push(`  ${p.id}`);
      out.push(`    older: ${p.a} "${memoryWords(counterpart, p.a)}"`);
      out.push(`    newer: ${p.b} "${memoryWords(counterpart, p.b)}"`);
    }
    if (proposed.length > SETTLE_LIST_RECENT)
      out.push(`  (+${String(proposed.length - SETTLE_LIST_RECENT)} more)`);
  }
  if (settled.length > 0) {
    out.push("", `Settled lately (${String(settled.length)}):`);
    for (const p of settled)
      out.push(`  ${settleLine(counterpart, p)}`);
  }
  out.push(...heldListLines(counterpart));
  out.push("", 'Settle one: counterparts settle --pair <id> --holds <memory id> --how changed|corrected|open --why "..."', "  (or --holds <id> --against <id> for two memories no dream flagged). Undo one: counterparts settle --undo <pair id>");
  return out;
}
