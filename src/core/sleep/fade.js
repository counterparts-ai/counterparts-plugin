import { countSkip, emptyOutcome } from "./types.js";
export function runFade(ctx, fade, date) {
  const out = emptyOutcome();
  if (fade === undefined) {
    out.skipped["no-fade-fn"] = 1;
    return { ...out, faded: [], anchored: 0 };
  }
  const r = fade({ day: ctx.day, date, apply: ctx.apply, budget: ctx.budget });
  out.examined = r.examined;
  out.changed = r.faded.length;
  out.budgetExhausted = r.skippedForLimit > 0;
  out.skippedForBudget = r.skippedForLimit;
  for (const [reason, n] of Object.entries(r.blocked))
    countSkip(out, `blocked:${reason}`, n);
  for (const id of r.faded) {
    ctx.event("sleep.faded", id, { day: ctx.day, applied: ctx.apply });
  }
  ctx.event("sleep.fade.sweep", undefined, {
    day: ctx.day,
    examined: r.examined,
    faded: r.faded.length,
    anchored: r.anchored
  });
  return { ...out, faded: r.faded, anchored: r.anchored };
}
