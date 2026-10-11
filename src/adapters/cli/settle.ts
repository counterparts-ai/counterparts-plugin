/**
 * `counterparts settle` — the owner's door to contradictions (2026-09-29).
 *
 * With no flags it lists what is unsettled, what was settled lately (who,
 * how, why), and the week's held corrections nobody has settled since
 * (2026-10-09); with `--pair`/`--holds`/`--over`/`--how` it settles one, as the
 * owner; `--undo <pair>` reverses a settle. Every decision is
 * `core/contradictions.ts`'s — this file only reads and prints. Reading works
 * under observer; the two changes refuse there.
 */
import { heldPairs } from "../../core/contradictions.js";
import type { HeldPair } from "../../core/contradictions.js";
import type { Counterpart } from "../../core/counterpart.js";
import type { ContradictionRow, SettleRow } from "../../core/store/index.js";
import { CONTRADICTION_WINDOW_DAYS } from "../claude-code/doctor.js";
import { memoryWords } from "./dream-core.js";

/** How many settled pairs the list shows. */
export const SETTLE_LIST_RECENT = 10;

function who(s: SettleRow): string {
  if (s.actor === "owner") return "you";
  if (s.actor === "session") return `session ${s.actor_id ?? "?"}`;
  return s.actor_id === null ? s.actor : `${s.actor} ${s.actor_id}`;
}

/** One settled pair, in words: how, which holds, who, when and why. */
export function settleLine(counterpart: Counterpart, pair: ContradictionRow): string {
  const last = counterpart.store
    .contradictionSettles({ pairId: pair.id })
    .filter((s) => s.action === "settle" && s.undone === 0)
    .pop();
  const by = last === undefined ? "" : ` — ${who(last)}, lived day ${String(last.day)}${last.why === null ? "" : `: "${last.why}"`}`;
  if (pair.via !== null) return `${pair.id}  closed through ${pair.via}${by}`;
  if (pair.how === "open") return `${pair.id}  open: ${pair.a} and ${pair.b} disagree${by}`;
  return `${pair.id}  ${pair.how ?? "settled"}: ${pair.holds ?? "?"} holds over ${pair.over ?? "?"}${by}`;
}

/**
 * HELD CORRECTIONS (2026-10-09): the writes of the last
 * `CONTRADICTION_WINDOW_DAYS` lived days — doctor's Contradictions line
 * counts the same ones — that said they changed or corrected a memory that
 * looked unrelated, so nothing was settled, and that nobody has settled by
 * hand since. No pair was written for them, so each is settled by its two ids.
 * Empty when there are none.
 */
export function heldListLines(counterpart: Counterpart): string[] {
  const store = counterpart.store;
  let held: HeldPair[];
  try {
    held = heldPairs(store, { sinceDay: store.livedDay() - CONTRADICTION_WINDOW_DAYS + 1 }).filter((h) => !h.settledAfter);
  } catch {
    return [];
  }
  if (held.length === 0) return [];
  const out = [
    "",
    `Held (${String(held.length)}, last ${String(CONTRADICTION_WINDOW_DAYS)} lived days): ${held.length === 1 ? "a correction" : "corrections"} that named a memory that didn't look related, so nothing was settled. Most are a wrong pointer and need nothing; settle one that was meant.`,
  ];
  for (const h of held.slice(0, SETTLE_LIST_RECENT)) {
    const how = h.how === "changed" || h.how === "corrected" ? h.how : "corrected";
    out.push(`  ${h.holds} said it ${how === "changed" ? "changes" : "corrects"} ${h.over} (lived day ${String(h.day)})`);
    out.push(`    newer: "${memoryWords(counterpart, h.holds)}"`);
    out.push(`    older: "${memoryWords(counterpart, h.over)}"`);
    out.push(`    if meant: counterparts settle --holds ${h.holds} --against ${h.over} --how ${how} --why "..."`);
  }
  if (held.length > SETTLE_LIST_RECENT) out.push(`  (+${String(held.length - SETTLE_LIST_RECENT)} older)`);
  return out;
}

/** What `counterparts settle` prints with no flags. */
export function settleListLines(counterpart: Counterpart): string[] {
  const store = counterpart.store;
  const unsettled = store.contradictions({ state: "unsettled" });
  const settled = store.contradictions({ state: "settled" }).slice(0, SETTLE_LIST_RECENT);
  const out: string[] = [];
  out.push(
    unsettled.length === 0
      ? "Contradictions: nothing unsettled."
      : `Contradictions: ${String(unsettled.length)} unsettled — two memories that disagree, and nobody has said which holds.`,
  );
  for (const p of unsettled) {
    const dream = p.dream_id === null ? undefined : store.dream(p.dream_id);
    const from = p.dream_id === null ? p.source : `a dream on ${dream?.date ?? "a recent night"}`;
    out.push(`  ${p.id}  (flagged by ${from})`);
    out.push(`    older: ${p.a} "${memoryWords(counterpart, p.a)}"`);
    out.push(`    newer: ${p.b} "${memoryWords(counterpart, p.b)}"`);
  }
  if (settled.length > 0) {
    out.push("", `Settled lately (${String(settled.length)}):`);
    for (const p of settled) out.push(`  ${settleLine(counterpart, p)}`);
  }
  out.push(...heldListLines(counterpart));
  out.push(
    "",
    "Settle one: counterparts settle --pair <id> --holds <memory id> --how changed|corrected|open --why \"...\"",
    "  (or --holds <id> --against <id> for two memories no dream flagged). Undo one: counterparts settle --undo <pair id>",
  );
  return out;
}
