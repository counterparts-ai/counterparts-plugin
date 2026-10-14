import { plainDueOn } from "./prospective/index.js";
import { isDay, readableRecurrence } from "./time.js";
export function selfRenderer(self, opts = {}) {
  return (ctx) => {
    if (ctx.budgetBytes === undefined) {
      opts.onEvent?.("briefing.no-budget", { day: ctx.day });
      return;
    }
    const asked = opts.prospective === undefined || opts.at === undefined ? undefined : horizonFor(opts.prospective, opts.at, ctx.day);
    const horizonMore = asked?.more ?? [];
    const horizon = asked?.items;
    const result = self.boundary({
      day: ctx.day,
      budgetBytes: ctx.budgetBytes,
      ...opts.ceilingBytes === undefined ? {} : { ceilingBytes: opts.ceilingBytes },
      ...horizon === undefined ? {} : { horizon },
      ...horizonMore.length === 0 ? {} : { horizonMore },
      ...opts.yesterday === undefined ? {} : { yesterday: opts.yesterday },
      ...opts.yesterday === undefined || opts.yesterdayShorter === undefined ? {} : { yesterdayShorter: opts.yesterdayShorter },
      ...opts.lendBytes === undefined || opts.lendBytes <= 0 ? {} : { lendBytes: opts.lendBytes },
      ...opts.handoffLendBytes === undefined || opts.handoffLendBytes <= 0 ? {} : { handoffLendBytes: opts.handoffLendBytes },
      ...opts.handoffKeepBytes === undefined || opts.handoffKeepBytes <= 0 ? {} : { handoffKeepBytes: opts.handoffKeepBytes }
    });
    return { bytes: result.briefing.bytes, elements: result.briefing.elements };
  };
}
export function horizonFor(prospective, at, day) {
  const asked = prospective.horizon({ at, ...day === undefined ? {} : { day } });
  const more = (asked.more ?? []).map((i) => i.memoryId);
  const items = asked.items.map((i) => {
    if (i.eventDate === undefined)
      return { id: i.memoryId };
    const every = i.anchor === undefined || i.recurring === undefined ? "" : readableRecurrence(i.anchor, i.recurring);
    return {
      id: i.memoryId,
      due: i.eventDate,
      ...every === "" ? {} : { every },
      ...isDay(i.eventDate) && isDay(at) && i.eventDate < at ? { past: true } : {},
      ...plainDueOn(i, at) ? { plainDue: true } : {}
    };
  });
  return { items, more };
}
