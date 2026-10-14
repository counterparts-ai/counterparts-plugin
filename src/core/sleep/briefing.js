import { emptyOutcome } from "./types.js";
export function runBriefing(ctx, render, budgetBytes) {
  const out = emptyOutcome();
  if (render === undefined) {
    out.skipped["no-render-fn"] = 1;
    return { ...out, rendered: false, bytes: 0, elements: 0 };
  }
  out.examined = 1;
  if (!ctx.apply) {
    out.skipped["observer-report"] = 1;
    return { ...out, rendered: false, bytes: 0, elements: 0 };
  }
  const result = render({
    store: ctx.store,
    day: ctx.day,
    observer: false,
    ...budgetBytes === undefined ? {} : { budgetBytes }
  }) ?? {};
  out.changed = 1;
  const bytes = result.bytes ?? 0;
  const elements = result.elements ?? 0;
  ctx.event("sleep.briefing.rendered", undefined, { bytes, elements, day: ctx.day });
  return { ...out, rendered: true, bytes, elements };
}
