import { countSkip, emptyOutcome } from "./types.js";
export function runBirths(ctx, births) {
  const out = emptyOutcome();
  if (births === undefined) {
    out.skipped["no-births-fn"] = 1;
    return { ...out, born: [] };
  }
  const r = births({ day: ctx.day, apply: ctx.apply, budget: ctx.budget });
  out.examined = r.offered;
  out.changed = ctx.apply ? r.born.length : Math.min(r.offered, ctx.budget);
  out.budgetExhausted = r.skippedForLimit > 0;
  out.skippedForBudget = r.skippedForLimit;
  for (const [reason, n] of Object.entries(r.refused))
    countSkip(out, `refused:${reason}`, n);
  for (const id of r.born) {
    ctx.event("sleep.born", id, { day: ctx.day });
  }
  ctx.event("sleep.births.sweep", undefined, {
    day: ctx.day,
    memories: r.memories,
    offered: r.offered,
    born: r.born.length,
    skippedForLimit: r.skippedForLimit
  });
  return { ...out, born: r.born };
}
