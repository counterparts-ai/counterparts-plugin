import { byteLength } from "./identity.js";
import { addDays, isDay } from "../time.js";
import { TODAY_ELSEWHERE_MAX_BYTES } from "../handoff/last-here.js";
import { LANE_ORDER, ROOM_ORDER, collapsedLine, compose, flatten, foldedLine, moreLine } from "./briefing.js";
const MORE_ORDER = [
  "identity",
  "horizon",
  "threads",
  "craft",
  "hints"
];
export function copyKept(k) {
  return {
    identity: [...k.identity],
    craft: [...k.craft],
    threads: [...k.threads],
    hints: [...k.hints],
    horizon: [...k.horizon]
  };
}
export function lendOf(n) {
  return Math.max(0, Math.floor(n ?? 0));
}
export function pinnedLines(pinned, kept) {
  const out = {};
  for (const lane of LANE_ORDER) {
    const ids = pinned[lane];
    if (ids === undefined || ids.length === 0)
      continue;
    out[lane] = lane !== "identity" && kept[lane].length === 0 ? collapsedLine(lane, ids) : moreLine(lane, ids);
  }
  return out;
}
export function foldParts(pinned, kept) {
  const listing = {};
  const empty = {};
  for (const lane of LANE_ORDER) {
    const ids = pinned[lane];
    if (ids === undefined || ids.length === 0)
      continue;
    if (lane !== "identity" && kept[lane].length === 0)
      empty[lane] = ids;
    else
      listing[lane] = ids;
  }
  const fold = foldedLine(empty);
  return fold === null ? { more: pinnedLines(listing, kept) } : { more: pinnedLines(listing, kept), fold };
}
export function arrivingHead(horizon) {
  let n = 0;
  while (horizon[n]?.due === true)
    n += 1;
  return Math.min(horizon.length, Math.max(1, n));
}
export const ARRIVING_NEAR_DAYS = 3;
export function nearDue(due, at) {
  return due !== undefined && isDay(due) && isDay(at) && due >= at && due <= addDays(at, ARRIVING_NEAR_DAYS);
}
export function arrivingNear(horizon) {
  let n = 0;
  while (horizon[n]?.due === true || horizon[n]?.near === true)
    n += 1;
  return horizon.some((r) => r.near === true) ? n : 0;
}
export function elsewhereFormsOf(line, shorter) {
  if (line === undefined || line.length === 0)
    return [];
  const out = [];
  for (const form of [line, ...shorter ?? []]) {
    const size = byteLength(flatten(form));
    if (form.length === 0 || size > TODAY_ELSEWHERE_MAX_BYTES)
      continue;
    const last = out[out.length - 1];
    if (last !== undefined && size >= byteLength(flatten(last)))
      continue;
    out.push(form);
  }
  return out;
}
export function narrowerElsewhere(line, forms) {
  const at = forms.indexOf(line);
  return at < 0 ? undefined : forms[at + 1];
}
export function shorterThan(line, forms) {
  if (line === undefined)
    return [];
  const bytes = byteLength(line);
  return (forms ?? []).filter((s) => s.length > 0 && byteLength(s) < bytes);
}
export function takeRoom(target, from, want, pinned, trimmed, ctx, foldFirst = false) {
  const { req } = ctx;
  const work = lendOf(req.lendBytes);
  const handoffs = lendOf(req.handoffLendBytes);
  const kept = lendOf(req.handoffKeepBytes);
  const k = copyKept(want);
  const t = [...trimmed];
  const pins = {};
  for (const lane of LANE_ORDER) {
    const ids = pinned[lane];
    if (ids !== undefined && ids.length > 0)
      pins[lane] = [...ids];
  }
  let limit = req.budgetBytes + from.lent;
  let y = from.yesterday;
  let e = from.elsewhere;
  const attempt = () => {
    const each = () => compose(k, req.day, ctx.resolve, ctx.coreName, ctx.identity, pinnedLines(pins, k), y, e);
    const parts = from.fold ? foldParts(pins, k) : null;
    const one = () => parts?.fold === undefined ? null : compose(k, req.day, ctx.resolve, ctx.coreName, ctx.identity, parts.more, y, e, parts.fold);
    let fold = false;
    let c;
    const first = foldFirst ? one() : null;
    if (first !== null && first.bytes <= limit) {
      c = first;
      fold = true;
    } else {
      c = each();
      const second = c.bytes > limit && !foldFirst ? one() : null;
      if (second !== null) {
        c = second;
        fold = true;
      }
    }
    return c.bytes <= limit ? { kept: k, trimmed: t, yesterday: y, elsewhere: e, pinned: pins, composed: c, lent: Math.max(0, c.bytes - req.budgetBytes), fold } : null;
  };
  let got = attempt();
  for (const lane of ROOM_ORDER) {
    if (got !== null || lane === target)
      break;
    switch (lane) {
      case "elsewhere":
        while (got === null && e !== undefined) {
          e = narrowerElsewhere(e, ctx.elsewhereForms);
          got = attempt();
        }
        break;
      case "work":
        if (req.budgetBytes + work > limit) {
          limit = req.budgetBytes + work;
          got = attempt();
        }
        break;
      case "yesterday":
        for (const form of shorterThan(y, req.yesterdayShorter)) {
          y = form;
          got = attempt();
          if (got !== null)
            break;
        }
        break;
      case "handoffs":
        if (req.budgetBytes + work + handoffs > limit) {
          limit = req.budgetBytes + work + handoffs;
          got = attempt();
        }
        break;
      case "arriving":
        while (got === null && k.horizon.length > ctx.head) {
          const dropped = k.horizon.pop();
          if (dropped === undefined)
            break;
          t.push({ lane: "horizon", id: dropped.id, strength: dropped.strength });
          pins.horizon = [dropped.id, ...pins.horizon ?? []];
          got = attempt();
        }
        break;
      case "handoffsKept":
        if (req.budgetBytes + work + handoffs + kept > limit) {
          limit = req.budgetBytes + work + handoffs + kept;
          got = attempt();
        }
        break;
      default:
        break;
    }
  }
  return got;
}
export function keepArriving(arrived, overflow, upTo, target, from, ctx) {
  const want = Math.min(upTo, arrived.length);
  for (let n = want;n > from.kept.horizon.length; n--) {
    const listed = arrived.slice(0, n);
    const k = { ...copyKept(from.kept), horizon: [...listed] };
    const t = from.trimmed.filter((e) => !(e.lane === "horizon" && listed.some((r) => r.id === e.id)));
    const rest = [...t.filter((e) => e.lane === "horizon").map((e) => e.id).reverse(), ...overflow];
    const others = { ...from.pinned };
    delete others.horizon;
    for (const counted of rest.length === 0 ? [false] : target === "due" ? [true, false] : [true]) {
      const got = takeRoom(target, from, k, counted ? { ...others, horizon: rest } : others, t, ctx);
      if (got !== null)
        return got;
    }
  }
  return null;
}
export function keepArrivingCount(overflow, from, ctx) {
  if ((from.pinned.horizon?.length ?? 0) > 0)
    return null;
  const rest = [...from.trimmed.filter((e) => e.lane === "horizon").map((e) => e.id).reverse(), ...overflow];
  if (rest.length === 0)
    return null;
  const pinned = { ...from.pinned, horizon: rest };
  const { req } = ctx;
  if (from.lent === 0 && compose(from.kept, req.day, ctx.resolve, ctx.coreName, ctx.identity, pinnedLines(pinned, from.kept), from.yesterday, from.elsewhere).bytes <= req.budgetBytes) {
    return null;
  }
  return takeRoom(overflow.length > 0 ? "openFirst" : "arriving", from, from.kept, pinned, from.trimmed, ctx);
}
export function keepFirstOpen(arrived, overflow, arrivedHorizon, from, ctx) {
  const first = arrived[0];
  if (first === undefined)
    return null;
  const kept = from.kept;
  if (kept.threads.length === 0 && arrivedHorizon > 0 && kept.horizon.length === 0)
    return null;
  const k = { ...copyKept(kept), threads: kept.threads.length > 0 ? [...kept.threads] : [first] };
  const t = from.trimmed.filter((e) => !(e.lane === "threads" && k.threads.some((l) => l.id === e.id)));
  const rest = [...t.filter((e) => e.lane === "threads").map((e) => e.id).reverse(), ...overflow];
  const pinned = { ...from.pinned, threads: rest };
  if (rest.length === 0)
    delete pinned.threads;
  if (kept.threads.length > 0) {
    if (rest.length === 0)
      return null;
    const { req } = ctx;
    const asIs = compose(k, req.day, ctx.resolve, ctx.coreName, ctx.identity, pinnedLines(pinned, k), from.yesterday, from.elsewhere);
    if (from.lent === 0 && asIs.bytes <= req.budgetBytes)
      return null;
    return takeRoom("openCount", from, k, pinned, t, ctx);
  }
  return takeRoom("openFirst", from, k, pinned, t, ctx);
}
export function tellLost(ctx) {
  const at = (more, fold) => compose(ctx.kept, ctx.req.day, ctx.resolve, ctx.coreName, ctx.identity, more, ctx.yesterday, ctx.elsewhere, fold);
  const countsOf = (lost) => {
    const out = {};
    for (const lane of LANE_ORDER) {
      const n = lost[lane]?.length ?? 0;
      if (n > 0)
        out[lane] = n;
    }
    return out;
  };
  const counts = countsOf(ctx.lost);
  const reserved = withoutNearby(ctx.lost);
  const hints = ctx.lost.hints?.length ?? 0;
  const quiet = hints > 0 ? { hints } : {};
  const tries = [
    { lost: ctx.lost, fold: false },
    { lost: ctx.lost, fold: true },
    ...hints > 0 ? [{ lost: reserved, fold: false }, { lost: reserved, fold: true }] : [],
    ...ctx.pinned === undefined ? [] : [{ lost: ctx.pinned, fold: false }, { lost: ctx.pinned, fold: true }]
  ];
  for (const t of tries) {
    const parts = t.fold ? foldParts(t.lost, ctx.kept) : { more: pinnedLines(t.lost, ctx.kept) };
    if (t.fold && parts.fold === undefined)
      continue;
    const c = at(parts.more, parts.fold);
    if (Object.keys(counts).length === 0 || c.bytes <= ctx.limit) {
      const said = countsOf(t.lost);
      const untold = {};
      for (const lane of LANE_ORDER) {
        const n = counts[lane];
        if (n !== undefined && said[lane] === undefined && lane !== "hints")
          untold[lane] = n;
      }
      return { composed: c, more: said, folded: parts.fold !== undefined, untold, quiet: said.hints === undefined ? quiet : {} };
    }
  }
  let current = at({});
  const lines = {};
  const more = {};
  for (const lane of MORE_ORDER) {
    const ids = ctx.lost[lane];
    if (ids === undefined || ids.length === 0)
      continue;
    lines[lane] = lane !== "identity" && ctx.kept[lane].length === 0 ? collapsedLine(lane, ids) : moreLine(lane, ids);
    const candidate = at(lines);
    if (candidate.bytes > ctx.limit) {
      delete lines[lane];
      continue;
    }
    current = candidate;
    more[lane] = ids.length;
  }
  const untold = {};
  for (const lane of LANE_ORDER) {
    const n = counts[lane];
    if (n !== undefined && more[lane] === undefined && lane !== "hints")
      untold[lane] = n;
  }
  return { composed: current, more, folded: false, untold, quiet: more.hints === undefined ? quiet : {} };
}
export function withoutNearby(lost) {
  const out = { ...lost };
  delete out.hints;
  return out;
}
