import { byteLength } from "./identity.js";
import {
  foldParts,
  withoutNearby,
  arrivingHead,
  arrivingNear,
  elsewhereFormsOf,
  keepArriving,
  keepArrivingCount,
  keepFirstOpen,
  lendOf,
  narrowerElsewhere,
  pinnedLines,
  shorterThan,
  takeRoom,
  tellLost
} from "./briefing-room.js";
import { pageBlockBytes } from "./briefing-page.js";
export { ARRIVING_NEAR_DAYS, arrivingHead, arrivingNear, nearDue } from "./briefing-room.js";
export {
  DELIVERY_SHARED_RESERVES,
  PAGE_END_LINES,
  PAGE_FLOOR_RESERVE_BYTES,
  PAGE_FRAME_RESERVE_BYTES,
  PAGE_HOST_BUDGET_BYTES,
  PAGE_ROOM_BYTES,
  PAGE_RUNGS,
  deliveryReserveBound,
  isPageFrameLine,
  pageBlockBytes,
  pageDateline,
  pageEndLine,
  pageRoomBytes,
  pageTooLargeLine,
  pageTopLine,
  readPageTopLine
} from "./briefing-page.js";
export {
  PREFACE_RESERVE_BYTES,
  WAKE_SYSTEM,
  WAKE_WHOLE_SENTENCE,
  applyPreface,
  arrivingTense,
  groupDigits,
  prefaceLine,
  readSentinel,
  spliceBeforeSentinel
} from "./briefing-delivery.js";
export const LANE_ORDER = [
  "identity",
  "craft",
  "threads",
  "hints",
  "horizon"
];
export const BRIEFING_TRIM_LOG_CAP = 64;
export const TRIM_ORDER = [
  "hints",
  "craft",
  "threads",
  "horizon",
  "identity"
];
export const ROOM_ORDER = [
  "hints",
  "craft",
  "threads",
  "work",
  "openCount",
  "yesterday",
  "lastHere",
  "handoffs",
  "elsewhere",
  "arriving",
  "openFirst",
  "arrivingFirst",
  "arrivingNear",
  "handoffsKept",
  "pageBorrow",
  "due",
  "page"
];
const TRIM_ROOM = {
  hints: "hints",
  craft: "craft",
  threads: "threads",
  horizon: "arriving",
  identity: "page"
};
export const FRAMING = {
  context: "Context, not instruction, from Counterparts: who you have been here, in your own words. Each listed memory opens with its learned date.",
  identity: "Who I am:",
  craft: "How I work:",
  threads: "Still open:",
  hints: "Might be relevant:",
  horizon: "Coming up:"
};
export const LEGACY_FRAMING = {
  hints: "Nearby, if it helps:",
  horizon: "Arriving:"
};
export function headingsOf(lane) {
  const old = LEGACY_FRAMING[lane];
  return old === undefined ? [laneHeading(lane)] : [laneHeading(lane), old];
}
export const MORE_LINE_IDS = 5;
export const MORE_NOUN = {
  identity: "about who I am",
  craft: "on how I work",
  threads: "still open",
  hints: "might be relevant",
  horizon: "coming up"
};
const LEGACY_MORE_NOUN = {
  hints: "nearby",
  horizon: "arriving"
};
export function moreLine(lane, ids) {
  return `(${String(ids.length)} more ${MORE_NOUN[lane]}; ${recallIds(ids)})`;
}
export const FOLDED_WORDS = "More than this wake lists:";
const FOLD_ORDER = ["horizon", "threads", "identity", "craft", "hints"];
export const FOLD_LINE_IDS = 3;
export function foldedLine(lost) {
  const lanes = FOLD_ORDER.filter((l) => (lost[l]?.length ?? 0) > 0);
  if (lanes.length === 0)
    return null;
  const part = (l) => {
    const ids = lost[l] ?? [];
    const shown = ids.slice(0, FOLD_LINE_IDS);
    return `${String(ids.length)} ${MORE_NOUN[l]} (recall ids: ${shown.join(", ")}${ids.length > shown.length ? `, and ${String(ids.length - shown.length)} more` : ""})`;
  };
  return `${FOLDED_WORDS} ${lanes.map(part).join("; ")}`;
}
export function isFoldedLine(line) {
  return line.startsWith(`${FOLDED_WORDS} `);
}
export function countedLanes(text) {
  const out = {};
  const byNoun = new Map(LANE_ORDER.map((l) => [MORE_NOUN[l], l]));
  for (const l of LANE_ORDER) {
    const old = LEGACY_MORE_NOUN[l];
    if (old !== undefined)
      byNoun.set(old, l);
  }
  for (const line of text.split(`
`)) {
    const collapsed = collapsedLane(line);
    if (collapsed !== null) {
      const heading = headingsOf(collapsed).find((h) => line.startsWith(`${h} `)) ?? laneHeading(collapsed);
      out[collapsed] = Number(/^\D*(\d+) — /.exec(line.slice(heading.length))?.[1] ?? 0);
      continue;
    }
    const more = /^\((\d+) more (.+?); recall ids/.exec(line);
    const lane = more === null ? undefined : byNoun.get(more[2] ?? "");
    if (more !== null && lane !== undefined) {
      out[lane] = Number(more[1]);
      continue;
    }
    if (!isFoldedLine(line))
      continue;
    for (const m of line.slice(FOLDED_WORDS.length + 1).matchAll(/(\d+) ([^;(]+?) \(recall ids: /g)) {
      const l = byNoun.get(m[2] ?? "");
      if (l !== undefined)
        out[l] = Number(m[1]);
    }
  }
  return out;
}
function recallIds(ids) {
  const shown = ids.slice(0, MORE_LINE_IDS);
  const which = ids.length > shown.length ? `recall ids (the first ${String(shown.length)})` : "recall ids";
  return `${which}: ${shown.join(", ")}`;
}
export const COLLAPSED_WORDS = "no room to list them in this wake";
export function collapsedLine(lane, ids) {
  return `${laneHeading(lane)} ${String(ids.length)} — ${COLLAPSED_WORDS}; ${recallIds(ids)}`;
}
export function collapsedLane(line) {
  for (const lane of LANE_ORDER) {
    for (const heading of headingsOf(lane)) {
      if (!line.startsWith(`${heading} `))
        continue;
      if (new RegExp(`^ \\d+ — ${COLLAPSED_WORDS}; recall ids`).test(line.slice(heading.length)))
        return lane;
    }
  }
  return null;
}
export function identityCoreLine(name) {
  return `This memory is for ${flatten(name)}. We've only just met. Who I am takes shape as the same things come up across different days.`;
}
export const PAGE_FORMING_LINE = "Still forming: I write this page after a few sessions, from what keeps coming up. It can be edited by hand.";
function headerLine(day, elements, bytes) {
  return `<!-- counterparts:wake day=${day} elements=${elements} bytes=${bytes} -->`;
}
function sentinelLine(day, counts, elements, bytes, page = false) {
  const lanes = LANE_ORDER.map((l) => l === "identity" && page ? `${l}=${counts[l]} page=1` : `${l}=${counts[l]}`).join(" ");
  return `<!-- counterparts:wake/end day=${day} ${lanes} elements=${elements} bytes=${bytes} -->`;
}
function laneHeading(lane) {
  switch (lane) {
    case "identity":
      return FRAMING.identity;
    case "craft":
      return FRAMING.craft;
    case "threads":
      return FRAMING.threads;
    case "hints":
      return FRAMING.hints;
    case "horizon":
      return FRAMING.horizon;
  }
}
export function flatten(text) {
  return text.replace(/\s+/g, " ").trim();
}
export const DATE_SEP = " · ";
export const DATE_BOUND = "by ";
export const DUE_WORD = "due";
export const DUE_PAST_WORD = "was due";
export function datePrefix(r) {
  const learned = (r.learnedOn ?? "").trim();
  const due = (r.due ?? "").trim();
  if (due !== "") {
    const every = (r.every ?? "").trim();
    const often = every === "" ? "" : `, ${every}`;
    const word = r.duePast === true ? DUE_PAST_WORD : DUE_WORD;
    if (learned === "" || due === learned && often === "")
      return `${word} ${due}${often}${DATE_SEP}`;
    return `${r.boundedDate === true ? DATE_BOUND : ""}${learned} (${word} ${due}${often})${DATE_SEP}`;
  }
  if (learned === "")
    return "";
  const happened = (r.happenedOn ?? "").trim();
  if (happened !== "" && happened !== learned)
    return `${learned} (of ${happened})${DATE_SEP}`;
  const bound = r.boundedDate === true ? DATE_BOUND : "";
  return `${bound}${learned}${DATE_SEP}`;
}
export function elementLine(item, resolve) {
  const r = resolve(item.id);
  const statement = flatten(r.statement);
  const standing = r.standing?.prefix ?? "";
  let date = datePrefix(r);
  const learned = (r.learnedOn ?? "").trim();
  if (standing === "" && learned !== "" && date === `${learned}${DATE_SEP}` && statement.startsWith(learned))
    date = "";
  return `- ${date}${standing}${statement}${r.standing?.suffix ?? ""}`;
}
function emptyKept() {
  return { identity: [], craft: [], threads: [], hints: [], horizon: [] };
}
function emptyCounts() {
  return { identity: 0, craft: 0, threads: 0, hints: 0, horizon: 0 };
}
export function fixedPointTotal(skeletonBytes, occurrences) {
  for (let w = 1;w <= 12; w++) {
    const total = skeletonBytes + occurrences * w;
    if (String(total).length === w)
      return total;
  }
  throw new Error(`self: byte fixed point did not converge (skeleton=${skeletonBytes})`);
}
export function compose(kept, day, resolve, coreName, identity, more = {}, yesterday, elsewhere, fold) {
  const counts = emptyCounts();
  for (const lane of LANE_ORDER)
    counts[lane] = kept[lane].length;
  const elements = LANE_ORDER.reduce((n, lane) => n + counts[lane], 0);
  const page = identity?.page ?? null;
  const forming = identity?.forming ?? null;
  const dayZero = page === null && kept.identity.length === 0 && coreName !== undefined && coreName.length > 0 ? coreName : null;
  const build = (bytes) => {
    const lines = [headerLine(day, elements, bytes), FRAMING.context];
    if (yesterday !== undefined && yesterday.length > 0)
      lines.push(flatten(yesterday));
    for (const lane of LANE_ORDER) {
      const items = kept[lane];
      if (lane === "hints" && elsewhere !== undefined && elsewhere.length > 0)
        lines.push("", flatten(elsewhere));
      if (lane === "identity") {
        const furniture = page !== null || forming !== null || dayZero !== null;
        if (items.length === 0 && !furniture && more.identity === undefined)
          continue;
        lines.push("", laneHeading(lane));
        if (page !== null) {
          if (page.top !== null)
            lines.push(page.top);
          lines.push(page.text);
          if (page.dateline !== null)
            lines.push(page.dateline);
          if (page.end !== null)
            lines.push(page.end);
        } else {
          if (forming !== null)
            lines.push(forming);
          if (dayZero !== null)
            lines.push(identityCoreLine(dayZero));
        }
        for (const item of items)
          lines.push(elementLine(item, resolve));
        if (more.identity !== undefined)
          lines.push(more.identity);
        continue;
      }
      if (lane === "craft" && fold !== undefined && fold.length > 0)
        lines.push("", fold);
      const tail = more[lane];
      if (items.length === 0 && tail === undefined)
        continue;
      if (items.length === 0 && tail !== undefined) {
        lines.push("", tail);
        continue;
      }
      lines.push("", laneHeading(lane));
      for (const item of items)
        lines.push(elementLine(item, resolve));
      if (tail !== undefined)
        lines.push(tail);
    }
    lines.push("", sentinelLine(day, counts, elements, bytes, page !== null));
    return lines.join(`
`);
  };
  const skeleton = byteLength(build(""));
  const total = fixedPointTotal(skeleton, 2);
  const stated = String(total);
  const text = build(stated);
  return {
    text,
    bytes: byteLength(text),
    header: headerLine(day, elements, stated),
    sentinel: sentinelLine(day, counts, elements, stated, page !== null),
    counts,
    elements
  };
}
function elementBytes(item, resolve) {
  return byteLength(`${elementLine(item, resolve)}
`);
}
export function identityShareBytes(budgetBytes, t) {
  return Math.floor(budgetBytes * t.IDENTITY_SHARE);
}
function withheldForShare(kept, budgetBytes, resolve, t) {
  const competing = LANE_ORDER.some((l) => l !== "identity" && kept[l].length > 0);
  if (!competing || kept.identity.length === 0)
    return [];
  const share = identityShareBytes(budgetBytes, t);
  let used = 0;
  let n = 0;
  for (const item of kept.identity) {
    const cost = elementBytes(item, resolve);
    if (n > 0 && used + cost > share)
      break;
    used += cost;
    n += 1;
  }
  return kept.identity.splice(n);
}
function lostByLane(overflow, trimmed, held, suppressList) {
  const out = {};
  for (const lane of LANE_ORDER) {
    if (lane === "identity" && suppressList)
      continue;
    const ids = [
      ...trimmed.filter((e) => e.lane === lane).map((e) => e.id).reverse(),
      ...lane === "identity" ? held.map((r) => r.id) : [],
      ...lane === "hints" ? [] : overflow?.[lane] ?? []
    ];
    if (ids.length > 0)
      out[lane] = ids;
  }
  return out;
}
export function render(lanes, req, resolve, t) {
  const kept = {
    identity: [...lanes.identity],
    craft: [...lanes.craft],
    threads: [...lanes.threads],
    hints: [...lanes.hints],
    horizon: [...lanes.horizon]
  };
  const trimmed = [];
  const coreName = lanes.identity.length === 0 ? req.coreName : undefined;
  const page = req.page ?? null;
  const exists = page !== null || req.pageExists === true;
  const suppressList = page !== null || !t.PAGE_EMPTY_SHOWS_LIST;
  if (suppressList)
    kept.identity.length = 0;
  const identity = {
    page,
    forming: !exists && !t.PAGE_EMPTY_SHOWS_LIST ? PAGE_FORMING_LINE : null
  };
  const held = withheldForShare(kept, req.budgetBytes, resolve, t);
  const forms = req.yesterday === undefined || req.yesterday.length === 0 ? [] : [req.yesterday, ...shorterThan(req.yesterday, req.yesterdayShorter)];
  const floorWith = (y) => compose(emptyKept(), req.day, resolve, coreName, identity, {}, y).bytes;
  let yesterday = forms.find((y) => floorWith(y) <= req.budgetBytes + lendOf(req.lendBytes));
  let base = yesterday === undefined ? req.budgetBytes : Math.max(req.budgetBytes, floorWith(yesterday));
  const elsewhereForms = elsewhereFormsOf(req.elsewhere, req.elsewhereShorter);
  let elsewhere = elsewhereForms[0];
  const ctx = { req, resolve, coreName, identity, head: arrivingHead(lanes.horizon), elsewhereForms };
  const lone = (lane) => lane === "threads" && kept.threads.length === 1;
  const outranksLine = (lane) => ROOM_ORDER.indexOf(lone(lane) ? "openFirst" : TRIM_ROOM[lane]) > ROOM_ORDER.indexOf("elsewhere");
  let fold = false;
  let bare = false;
  const lostNow = () => withoutNearby(lostByLane(lanes.overflow, trimmed, held, suppressList));
  const linesFor = (lost, k, folded) => folded ? foldParts(lost, k) : { more: pinnedLines(lost, k) };
  for (;; ) {
    const lost = lostNow();
    const lines = bare ? { more: {} } : linesFor(lost, kept, fold);
    const c = compose(kept, req.day, resolve, coreName, identity, lines.more, yesterday, elsewhere, lines.fold);
    const fits = c.bytes <= base;
    let cut = null;
    let stepped = false;
    if (!fits) {
      for (const lane of TRIM_ORDER) {
        if (elsewhere !== undefined && outranksLine(lane)) {
          const from = { kept, trimmed: [...trimmed], yesterday, elsewhere, pinned: lost, composed: c, lent: base - req.budgetBytes, fold };
          const got = takeRoom("elsewhere", from, kept, lost, trimmed, ctx);
          if (got === null) {
            elsewhere = narrowerElsewhere(elsewhere, elsewhereForms);
          } else {
            for (const l of LANE_ORDER)
              kept[l] = got.kept[l];
            trimmed.splice(0, trimmed.length, ...got.trimmed);
            yesterday = got.yesterday;
            base = req.budgetBytes + got.lent;
            fold = got.fold;
          }
          stepped = true;
          break;
        }
        const items = kept[lane];
        if (items.length === 0)
          continue;
        if (lane === "identity" && !fold && Object.keys(lost).length > 0) {
          const folded = linesFor(lost, kept, true);
          if (compose(kept, req.day, resolve, coreName, identity, folded.more, yesterday, elsewhere, folded.fold).bytes <= base) {
            fold = true;
            stepped = true;
            break;
          }
        }
        const dropped = items.pop();
        if (dropped === undefined)
          continue;
        cut = { lane, id: dropped.id, strength: dropped.strength };
        break;
      }
      if (cut === null && !stepped) {
        const counting = Object.keys(lost).length > 0;
        if (counting && !fold) {
          fold = true;
          continue;
        }
        if (counting && !bare) {
          const from = { kept, trimmed: [...trimmed], yesterday, elsewhere, pinned: lost, composed: c, lent: base - req.budgetBytes, fold: true };
          const got = takeRoom("arrivingFirst", from, kept, lost, trimmed, ctx, true);
          if (got === null) {
            bare = true;
          } else {
            for (const l of LANE_ORDER)
              kept[l] = got.kept[l];
            trimmed.splice(0, trimmed.length, ...got.trimmed);
            yesterday = got.yesterday;
            elsewhere = got.elsewhere;
            base = req.budgetBytes + got.lent;
            fold = got.fold;
          }
          continue;
        }
        if (elsewhere !== undefined) {
          elsewhere = narrowerElsewhere(elsewhere, elsewhereForms);
          continue;
        }
      }
    }
    if (stepped)
      continue;
    if (fits || cut === null) {
      const dueHead = lanes.horizon[0]?.due === true;
      const near = arrivingNear(lanes.horizon);
      const nearCtx = near > ctx.head ? { ...ctx, head: near } : ctx;
      const overflow = lanes.overflow;
      let state = { kept, trimmed: [...trimmed], yesterday, elsewhere, pinned: lost, composed: c, lent: base - req.budgetBytes, fold: fold || bare };
      let first = null;
      if (fits) {
        const steps = [
          (s) => keepArriving(lanes.horizon, overflow?.horizon ?? [], ctx.head, dueHead ? "due" : "arrivingFirst", s, ctx),
          (s) => keepFirstOpen(lanes.threads, overflow?.threads ?? [], lanes.horizon.length, s, ctx),
          (s) => near > 0 ? keepArriving(lanes.horizon, overflow?.horizon ?? [], near, "arrivingNear", s, nearCtx) : null,
          (s) => keepArriving(lanes.horizon, overflow?.horizon ?? [], lanes.horizon.length, "arriving", s, ctx),
          (s) => keepArrivingCount(overflow?.horizon ?? [], s, nearCtx)
        ];
        for (const step of steps) {
          const next = step(state);
          if (next === null)
            continue;
          state = next;
          first = next;
        }
      }
      if (first !== null) {
        for (const lane of LANE_ORDER)
          kept[lane] = first.kept[lane];
        trimmed.splice(0, trimmed.length, ...first.trimmed);
      }
      const said = first === null ? yesterday : first.yesterday;
      const away = first === null ? elsewhere : first.elsewhere;
      const budgetBytes = req.budgetBytes + (first?.lent ?? base - req.budgetBytes);
      if (fits && first === null && trimmed.length === 0) {
        while (held.length > 0) {
          const next = held[0];
          if (next === undefined)
            break;
          kept.identity.push(next);
          const l = linesFor(withoutNearby(lostByLane(lanes.overflow, trimmed, held.slice(1), suppressList)), kept, fold);
          if (compose(kept, req.day, resolve, coreName, identity, l.more, said, away, l.fold).bytes > req.budgetBytes) {
            kept.identity.pop();
            break;
          }
          held.shift();
        }
      }
      const told = tellLost({
        kept,
        lost: lostByLane(lanes.overflow, trimmed, held, suppressList),
        req,
        resolve,
        coreName,
        identity,
        ...said === undefined ? {} : { yesterday: said },
        ...away === undefined ? {} : { elsewhere: away },
        limit: budgetBytes,
        ...first === null ? {} : { pinned: first.pinned }
      });
      if (told.more.horizon === undefined) {
        const recorded = new Set(trimmed.filter((e) => e.lane === "horizon").map((e) => e.id));
        for (const id of lanes.overflow?.horizon ?? []) {
          if (!recorded.has(id))
            trimmed.push({ lane: "horizon", id, strength: 0 });
        }
      }
      const composed = told.composed;
      return {
        ...composed,
        budgetBytes,
        day: req.day,
        kept: {
          identity: kept.identity.map((r) => r.id),
          craft: kept.craft.map((r) => r.id),
          threads: kept.threads.map((r) => r.id),
          hints: kept.hints.map((r) => r.id),
          horizon: kept.horizon.map((r) => r.id)
        },
        trimmed,
        more: told.more,
        folded: told.folded,
        untold: told.untold,
        quiet: told.quiet,
        pressure: composed.bytes >= budgetBytes * t.BUDGET_PRESSURE,
        overBudget: !fits,
        ...away === undefined ? {} : { elsewhere: away },
        page: identity.page === null ? null : {
          bytes: pageBlockBytes(identity.page),
          truncated: identity.page.truncated,
          wholeBytes: identity.page.wholeBytes,
          rung: identity.page.rung
        }
      };
    }
    trimmed.push(cut);
  }
}
