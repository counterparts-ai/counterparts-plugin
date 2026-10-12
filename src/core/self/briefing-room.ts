/**
 * THE WAKE'S ROOM — who gives way to whom when the composition is short of
 * it, moved out of `briefing.ts` on 2026-10-12 (moves only; the rules are
 * `briefing.ts#ROOM_ORDER`'s). `render` calls these after its trim loop:
 * `takeRoom` and the rescues it serves, and `tellLost`, which says every lane
 * that lost something. Imported by `briefing.ts` alone (`split-parts.test.ts`).
 */
import type { LaneName, Ranked } from "./identity.js";
import { byteLength } from "./identity.js";
import { addDays, isDay } from "../time.js";
import { TODAY_ELSEWHERE_MAX_BYTES } from "../handoff/last-here.js";
import { LANE_ORDER, ROOM_ORDER, collapsedLine, compose, flatten, foldedLine, moreLine } from "./briefing.js";
import type { BriefingRequest, Composed, IdentityBlock, Resolve, RoomLane, TrimEvent } from "./briefing.js";


/** The order lanes are offered room for their line when it was not reserved
 *  (the last resort, `tellLost`): the reverse of the trim order, so the
 *  lanes that are cut last are also told about first.
 *
 *  NEARBY'S CAP IS NOT COUNTED (2026-10-01, random-f2's item 5): what the
 *  hints lane's CAP leaves out is everything else warm in the store — "(331
 *  more nearby; recall ids …)" counted the store and named five ids nobody
 *  chose. Recall finds those by asking. What the BUDGET popped from the lane
 *  is counted (2026-10-12): at most `HINTS_MAX` hints this wake chose, each
 *  worth its id (`lostByLane`). */
const MORE_ORDER: readonly LaneName[] = [
  "identity",
  "horizon",
  "threads",
  "craft",
  "hints",
];

export type Kept = Record<LaneName, Ranked[]>;

/**
 * WHAT THE RENDER HAS COMPOSED SO FAR, rescue by rescue (2026-10-10): the trim
 * loop's composition, then each lane that took room from the lanes below it
 * (`takeRoom`). `lent` is what the composition runs past `budgetBytes` — lent
 * by "Work here" first, then by the room held for "Last here" and the handoff
 * pointer — and `pinned` the count lines already paid for, which
 * the render keeps (`tellLost`).
 */
export interface Rescued {
  readonly kept: Kept;
  readonly trimmed: TrimEvent[];
  readonly yesterday: string | undefined;
  /** The "Today, elsewhere" line as it stands (`BriefingRequest.elsewhere`). */
  readonly elsewhere: string | undefined;
  readonly pinned: Partial<Record<LaneName, string[]>>;
  readonly composed: Composed;
  readonly lent: number;
  /** True when the lanes of `pinned` that list nothing are said in the one
   *  folded line (`foldParts`): the trim loop found no room for each lane's own. A rescue may unfold it,
   *  never fold it. */
  readonly fold: boolean;
}

export interface RescueCtx {
  readonly req: BriefingRequest;
  readonly resolve: Resolve;
  readonly coreName: string | undefined;
  readonly identity: IdentityBlock;
  /** How many of Arriving's first lines no rescue below them may take
   *  (`arrivingHead`). */
  readonly head: number;
  /** The "Today, elsewhere" line's forms, widest first (`narrowerElsewhere`). */
  readonly elsewhereForms: readonly string[];
}

export function copyKept(k: Kept): Kept {
  return {
    identity: [...k.identity],
    craft: [...k.craft],
    threads: [...k.threads],
    hints: [...k.hints],
    horizon: [...k.horizon],
  };
}

/** A non-negative whole number of bytes, or 0. */
export function lendOf(n: number | undefined): number {
  return Math.max(0, Math.floor(n ?? 0));
}

/**
 * The count lines a composition carries for its pinned lanes: "N more", or —
 * a lane that lists nothing — its one collapsed line (`collapsedLine`).
 */
export function pinnedLines(pinned: Partial<Record<LaneName, readonly string[]>>, kept: Kept): Partial<Record<LaneName, string>> {
  const out: Partial<Record<LaneName, string>> = {};
  for (const lane of LANE_ORDER) {
    const ids = pinned[lane];
    if (ids === undefined || ids.length === 0) continue;
    out[lane] = lane !== "identity" && kept[lane].length === 0 ? collapsedLine(lane, ids) : moreLine(lane, ids);
  }
  return out;
}

/**
 * THE SAME COUNTS, FOLDED (2026-10-12, decided by COUNTERPARTS, lightly
 * held): a lane that still lists an item keeps its own "N more" line under
 * it ("Who I am" always does); only the lanes that list nothing go into the
 * one folded line (`foldedLine`). No fold when no lane lists nothing.
 */
export function foldParts(pinned: Partial<Record<LaneName, readonly string[]>>, kept: Kept): { more: Partial<Record<LaneName, string>>; fold?: string } {
  const listing: Partial<Record<LaneName, readonly string[]>> = {};
  const empty: Partial<Record<LaneName, readonly string[]>> = {};
  for (const lane of LANE_ORDER) {
    const ids = pinned[lane];
    if (ids === undefined || ids.length === 0) continue;
    if (lane !== "identity" && kept[lane].length === 0) empty[lane] = ids;
    else listing[lane] = ids;
  }
  const fold = foldedLine(empty);
  return fold === null ? { more: pinnedLines(listing, kept) } : { more: pinnedLines(listing, kept), fold };
}

/**
 * How many of Arriving's first lines are its HEAD (2026-10-10): every plain
 * reminder due the day the wake is read (`Ranked.due`, which `Self#build`
 * puts first), or else its first line alone. No rescue ranked below
 * `ROOM_ORDER`'s `arrivingFirst` takes them; "Still open"'s first item takes
 * the lines after them, and last of all (`takeRoom`'s `arriving` step).
 */
export function arrivingHead(horizon: readonly Pick<Ranked, "due">[]): number {
  let n = 0;
  while (horizon[n]?.due === true) n += 1;
  return Math.min(horizon.length, Math.max(1, n));
}

/** How many days ahead a dated item counts as NEAR at session start
 *  (`HorizonItem.near`; 2026-10-12, RANDOM's ruling, lightly held). */
export const ARRIVING_NEAR_DAYS = 3;

/** Whether a dated item due `due` is NEAR on `at`: from that day through
 *  `ARRIVING_NEAR_DAYS` after it. A grace day's "was due" line, behind `at`,
 *  is not (RANDOM's ruling at the review of #445, 2026-10-12, lightly held). */
export function nearDue(due: string | undefined, at: string): boolean {
  return due !== undefined && isDay(due) && isDay(at) && due >= at && due <= addDays(at, ARRIVING_NEAR_DAYS);
}

/**
 * How many of Arriving's first lines are NEAR (2026-10-12): the head, then
 * every line after it marked `near` (`Ranked.near`, set at session start
 * only, and sorted to follow the head). Zero when none is.
 */
export function arrivingNear(horizon: readonly Pick<Ranked, "due" | "near">[]): number {
  let n = 0;
  while (horizon[n]?.due === true || horizon[n]?.near === true) n += 1;
  return horizon.some((r) => r.near === true) ? n : 0;
}

/**
 * The "Today, elsewhere" line's forms the render may print, widest first:
 * each within `TODAY_ELSEWHERE_MAX_BYTES` (2026-10-10), each narrower than
 * the one before. Empty without a line.
 */
export function elsewhereFormsOf(line: string | undefined, shorter: readonly string[] | undefined): string[] {
  if (line === undefined || line.length === 0) return [];
  const out: string[] = [];
  for (const form of [line, ...(shorter ?? [])]) {
    const size = byteLength(flatten(form));
    if (form.length === 0 || size > TODAY_ELSEWHERE_MAX_BYTES) continue;
    const last = out[out.length - 1];
    if (last !== undefined && size >= byteLength(flatten(last))) continue;
    out.push(form);
  }
  return out;
}

/** The "Today, elsewhere" line's next form after `line` in `forms`, or none. */
export function narrowerElsewhere(line: string, forms: readonly string[]): string | undefined {
  const at = forms.indexOf(line);
  return at < 0 ? undefined : forms[at + 1];
}

/** The Yesterday line's shorter forms, widest first, each narrower than `line`. */
export function shorterThan(line: string | undefined, forms: readonly string[] | undefined): string[] {
  if (line === undefined) return [];
  const bytes = byteLength(line);
  return (forms ?? []).filter((s) => s.length > 0 && byteLength(s) < bytes);
}

/**
 * TAKE ROOM FROM THE LANES BELOW `target`, lowest first, as `ROOM_ORDER` says
 * (2026-10-10) — and only as much as it needs: the composition `want`, with
 * its `pinned` count lines, is tried as it stands, then again after each
 * step, and the first that fits is kept. The steps the render can take:
 *
 *   - `work` — the room held for "Work here" (`lendBytes`);
 *   - `yesterday` — the Yesterday line, one title at a time given way to its
 *     id (`yesterdayShorter`);
 *   - `handoffs` — the room held for "Last here" and the handoff pointer
 *     (`handoffLendBytes`), which the delivery gives up in its own order;
 *   - `arriving` — Arriving's lines past its head (`arrivingHead`), from the
 *     end, each a `TrimEvent` so the lane's count can still say so;
 *   - `elsewhere` — the "Today, elsewhere" line, a narrower form at a time,
 *     then none (2026-10-10; between `handoffs` and `arriving` since the
 *     review of #380). The trim loop also asks here on the line's behalf
 *     (`target` `elsewhere`) before it steps the line down;
 *   - `handoffsKept` — the room held for the newest handoff's own block
 *     (`handoffKeepBytes`): reached only by `due`, the one lane above it
 *     that takes room here (review of #367; `arrivingNear` stops below it,
 *     review of #445).
 *
 * The lanes below them are the trim loop's and are gone before any rescue
 * runs; `lastHere` is the delivery's, inside the room lent at `handoffs`; the
 * page is chosen before the lanes (`Self#build`), and gives its borrowing
 * back to `due` there. All or nothing: null when even the last step below
 * `target` leaves no room — the render is then what it was.
 */
export function takeRoom(
  target: RoomLane,
  from: Rescued,
  want: Kept,
  pinned: Partial<Record<LaneName, readonly string[]>>,
  trimmed: readonly TrimEvent[],
  ctx: RescueCtx,
  /** Folded (`from.fold`): try the one folded line before each lane's own —
   *  the trim loop's own call, so the lanes' count borrows as little as it
   *  can (2026-10-12). */
  foldFirst = false,
): Rescued | null {
  const { req } = ctx;
  const work = lendOf(req.lendBytes);
  const handoffs = lendOf(req.handoffLendBytes);
  const kept = lendOf(req.handoffKeepBytes);
  const k = copyKept(want);
  const t = [...trimmed];
  const pins: Partial<Record<LaneName, string[]>> = {};
  for (const lane of LANE_ORDER) {
    const ids = pinned[lane];
    if (ids !== undefined && ids.length > 0) pins[lane] = [...ids];
  }
  let limit = req.budgetBytes + from.lent;
  let y = from.yesterday;
  let e = from.elsewhere;
  const attempt = (): Rescued | null => {
    // Folded already (2026-10-12): each lane's own line when there is room,
    // else the one line — never a lane left without a word. `foldFirst`:
    // the one line first.
    const each = (): Composed => compose(k, req.day, ctx.resolve, ctx.coreName, ctx.identity, pinnedLines(pins, k), y, e);
    const parts = from.fold ? foldParts(pins, k) : null;
    const one = (): Composed | null =>
      parts?.fold === undefined ? null : compose(k, req.day, ctx.resolve, ctx.coreName, ctx.identity, parts.more, y, e, parts.fold);
    let fold = false;
    let c: Composed;
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
    return c.bytes <= limit
      ? { kept: k, trimmed: t, yesterday: y, elsewhere: e, pinned: pins, composed: c, lent: Math.max(0, c.bytes - req.budgetBytes), fold }
      : null;
  };
  let got = attempt();
  for (const lane of ROOM_ORDER) {
    if (got !== null || lane === target) break;
    switch (lane) {
      case "elsewhere":
        // Its titles first, then the line (2026-10-10).
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
          if (got !== null) break;
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
          if (dropped === undefined) break;
          t.push({ lane: "horizon", id: dropped.id, strength: dropped.strength });
          // The lane's count names it, first: it ranked first. Always
          // (2026-10-12): a line popped here is never popped without a word.
          pins.horizon = [dropped.id, ...(pins.horizon ?? [])];
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

/**
 * "ARRIVING:" LISTS ITS DATED ITEMS BEFORE THE FURNITURE BELOW IT KEEPS ITS
 * ROOM (2026-10-10, `ROOM_ORDER`). The trim loop pops Arriving only after
 * "Nearby", craft and "Still open" are gone, but the page, the Yesterday line
 * and the room held for the delivery's lanes are nothing it can pop — so on
 * the owner's lived day 19 his tax reminder collapsed to "Arriving: 1 — no
 * room to list them" while yesterday's titles and four handoffs printed.
 *
 * Here the lane's first `upTo` lines are listed again — as many as fit, each
 * time with the count of the rest (an item under a heading with no count
 * reads as the only one arriving). Without the count only for a plain
 * reminder due the day the wake is read (`target` `due`): it is said in full
 * whatever else happens (#442), and the render's last step folds the count
 * it could not carry into one line (2026-10-12; before that, any listed date
 * outranked the count of the others, and the rest went unsaid). The room comes from the
 * lanes below `target` (`takeRoom`). Called twice: for the lane's head at
 * its own rank (`due` or `arrivingFirst`), and — after "Still open"'s first
 * item — for the rest at `arriving`. Null when nothing was trimmed from it,
 * or nothing more fits.
 */
export function keepArriving(
  arrived: readonly Ranked[],
  overflow: readonly string[],
  upTo: number,
  target: RoomLane,
  from: Rescued,
  ctx: RescueCtx,
): Rescued | null {
  const want = Math.min(upTo, arrived.length);
  for (let n = want; n > from.kept.horizon.length; n--) {
    const listed = arrived.slice(0, n);
    const k: Kept = { ...copyKept(from.kept), horizon: [...listed] };
    const t = from.trimmed.filter((e) => !(e.lane === "horizon" && listed.some((r) => r.id === e.id)));
    // The rest, as `lostByLane` lists it: the trim's (popped from the end, so
    // reversed back), then what the lane's cap left out.
    const rest = [...t.filter((e) => e.lane === "horizon").map((e) => e.id).reverse(), ...overflow];
    const others: Partial<Record<LaneName, string[]>> = { ...from.pinned };
    delete others.horizon;
    for (const counted of rest.length === 0 ? [false] : target === "due" ? [true, false] : [true]) {
      const got = takeRoom(target, from, k, counted ? { ...others, horizon: rest } : others, t, ctx);
      if (got !== null) return got;
    }
  }
  return null;
}

/**
 * "ARRIVING:" SAYS HOW MANY MORE, BY ID, BEFORE IT LISTS A LATER LINE IN FULL
 * (review of #367, 2026-10-10). The lane's count names every dated item it
 * did not list — the trim's and those past `prospective/`'s count
 * (`BoundaryRequest.horizonMore`) — and those past the count leave no trim
 * row for doctor to read, so a count left out is a dated item silently gone.
 * Last of the rescues: when the lane lists something and has no count yet,
 * the count takes room from the lanes below `arriving` — "Work here", the
 * Yesterday line's titles, the handoffs' room — and, only when it names an
 * item past that count (one no trim row records), from Arriving's lines past
 * its head too, each named in the count it pays for. A count of the trim's
 * alone leaves the listed lines as they are: a listed date outranks it, and
 * doctor reads the trim. Null when the count is already in, there is nothing
 * to count, or no room is found.
 *
 * AND WHEN THE LANE LISTS NOTHING (2026-10-12): its one collapsed line takes
 * room the same way. The owner's 10-12 bundles carried seven dated items and
 * not a word about them — the page, borrowing "Work here", had spent the
 * room, and the line was offered only what was left.
 */
export function keepArrivingCount(overflow: readonly string[], from: Rescued, ctx: RescueCtx): Rescued | null {
  if ((from.pinned.horizon?.length ?? 0) > 0) return null;
  const rest = [...from.trimmed.filter((e) => e.lane === "horizon").map((e) => e.id).reverse(), ...overflow];
  if (rest.length === 0) return null;
  const pinned = { ...from.pinned, horizon: rest };
  // Room as the composition stands: `tellLost` says it then, as it says every lane's.
  const { req } = ctx;
  if (from.lent === 0 && compose(from.kept, req.day, ctx.resolve, ctx.coreName, ctx.identity, pinnedLines(pinned, from.kept), from.yesterday, from.elsewhere).bytes <= req.budgetBytes) {
    return null;
  }
  return takeRoom(overflow.length > 0 ? "openFirst" : "arriving", from, from.kept, pinned, from.trimmed, ctx);
}

/**
 * "STILL OPEN" KEEPS ITS FIRST ITEM, AND ITS COUNT (review of #350,
 * 2026-10-09; its place in `ROOM_ORDER` since 2026-10-10).
 *
 * The owner's wake on 10-09 read "Still open:" over "(20 more still open; …)"
 * and no item. The self page is furniture the trim cannot pop, the Yesterday
 * line is too, and `TRIM_ORDER` takes "Still open" before "Arriving" — so
 * beside a long page the lane gave up its last item while Arriving kept every
 * line. The page is not what gives way: it is the self the wake is for
 * (`Self#pageBlock`). What gives way is what `ROOM_ORDER` ranks below
 * `openFirst`, lowest first (`takeRoom`): "Work here", the Yesterday line's
 * titles, the room for "Last here" and the handoffs, and only then Arriving
 * past its head — whose first line, and every plain reminder due the day the
 * wake is read, rank above this.
 *
 * The target is the lane's first item AND its "N more" line: one item under a
 * heading with no count reads as the only thing open. All or nothing: when
 * even the last step leaves no room, the render is what it was, and a lane
 * that lists nothing says so in one line (`collapsedLine`).
 *
 * AND THE COUNT BESIDE WHAT THE TRIM KEPT (review of #358, 2026-10-09): when
 * the trim loop left the lane its items but no room for its "N more" line,
 * the count is paid for out of "Work here" and out of nothing else
 * (`openCount`, just above `work`): the items stay as the trim kept them (a
 * smaller budget still keeps a subset). Not when the count already fits as
 * the composition stands: `tellLost` says it then, as it says every
 * lane's.
 */
export function keepFirstOpen(
  arrived: readonly Ranked[],
  overflow: readonly string[],
  arrivedHorizon: number,
  from: Rescued,
  ctx: RescueCtx,
): Rescued | null {
  const first = arrived[0];
  if (first === undefined) return null;
  const kept = from.kept;
  // Arriving's FIRST line outranks it: when not even that is listed, this
  // budget has no room to rearrange.
  if (kept.threads.length === 0 && arrivedHorizon > 0 && kept.horizon.length === 0) return null;
  // What the lane lists: the items the trim kept, or — when it kept none —
  // its first item.
  const k: Kept = { ...copyKept(kept), threads: kept.threads.length > 0 ? [...kept.threads] : [first] };
  const t = from.trimmed.filter((e) => !(e.lane === "threads" && k.threads.some((l) => l.id === e.id)));
  // The rest of the lane, as `lostByLane` will list it: the trim's (popped
  // from the end, so reversed back), then what the lane's cap left out.
  const rest = [...t.filter((e) => e.lane === "threads").map((e) => e.id).reverse(), ...overflow];
  const pinned: Partial<Record<LaneName, string[]>> = { ...from.pinned, threads: rest };
  if (rest.length === 0) delete pinned.threads;
  if (kept.threads.length > 0) {
    // Items the trim kept: only their count is owed here, and only when it
    // does not fit as the composition stands.
    if (rest.length === 0) return null;
    const { req } = ctx;
    const asIs = compose(k, req.day, ctx.resolve, ctx.coreName, ctx.identity, pinnedLines(pinned, k), from.yesterday, from.elsewhere);
    if (from.lent === 0 && asIs.bytes <= req.budgetBytes) return null;
    return takeRoom("openCount", from, k, pinned, t, ctx);
  }
  return takeRoom("openFirst", from, k, pinned, t, ctx);
}

/**
 * THE LANES' LINES, SAID LAST AND CHECKED (2026-10-12): every lane that lost
 * something, counted under `limit`, the first of these that fits:
 *
 *   1. each lane's own line ("N more", or the collapsed line of a lane that
 *      lists nothing);
 *   2. the same, with the lanes that list nothing folded into one line
 *      (`foldParts`) — "Nearby" among them when it lists nothing;
 *   3. and 4. those two again without "Nearby": the least of the lanes, its
 *      count takes only room nothing else wants (decided by COUNTERPARTS,
 *      2026-10-12, lightly held). Left out, it is `quiet` — a step-down;
 *   5. and 6. the counts the last rescue composed with (`pinned`), which
 *      fit: only a due-day plain reminder listed past its lane's count
 *      (#442) leaves a lane out of them, and that lane is `untold`;
 *   7. the last resort — a floor over its budget, or a bug — each lane's own
 *      line in `MORE_ORDER` while it still fits, and what is left `untold`,
 *      which the caller records and doctor reads in red.
 *
 * Every lane but "Nearby" had its room reserved: the trim loop and every
 * rescue composed with its line.
 */
export function tellLost(ctx: {
  kept: Kept;
  lost: Partial<Record<LaneName, string[]>>;
  req: BriefingRequest;
  resolve: Resolve;
  coreName: string | undefined;
  identity: IdentityBlock;
  yesterday?: string;
  elsewhere?: string;
  limit: number;
  /** The counts the last rescue composed with, when one ran. */
  pinned?: Partial<Record<LaneName, readonly string[]>>;
}): {
  composed: Composed;
  more: Partial<Record<LaneName, number>>;
  folded: boolean;
  untold: Partial<Record<LaneName, number>>;
  quiet: Partial<Record<LaneName, number>>;
} {
  const at = (more: Partial<Record<LaneName, string>>, fold?: string): Composed =>
    compose(ctx.kept, ctx.req.day, ctx.resolve, ctx.coreName, ctx.identity, more, ctx.yesterday, ctx.elsewhere, fold);
  const countsOf = (lost: Partial<Record<LaneName, readonly string[]>>): Partial<Record<LaneName, number>> => {
    const out: Partial<Record<LaneName, number>> = {};
    for (const lane of LANE_ORDER) {
      const n = lost[lane]?.length ?? 0;
      if (n > 0) out[lane] = n;
    }
    return out;
  };
  const counts = countsOf(ctx.lost);
  const reserved = withoutNearby(ctx.lost);
  const hints = ctx.lost.hints?.length ?? 0;
  const quiet: Partial<Record<LaneName, number>> = hints > 0 ? { hints } : {};
  const tries: { lost: Partial<Record<LaneName, readonly string[]>>; fold: boolean }[] = [
    { lost: ctx.lost, fold: false },
    { lost: ctx.lost, fold: true },
    ...(hints > 0 ? [{ lost: reserved, fold: false }, { lost: reserved, fold: true }] : []),
    ...(ctx.pinned === undefined ? [] : [{ lost: ctx.pinned, fold: false }, { lost: ctx.pinned, fold: true }]),
  ];
  for (const t of tries) {
    const parts = t.fold ? foldParts(t.lost, ctx.kept) : { more: pinnedLines(t.lost, ctx.kept) };
    if (t.fold && parts.fold === undefined) continue;
    const c = at(parts.more, parts.fold);
    if (Object.keys(counts).length === 0 || c.bytes <= ctx.limit) {
      const said = countsOf(t.lost);
      const untold: Partial<Record<LaneName, number>> = {};
      for (const lane of LANE_ORDER) {
        const n = counts[lane];
        if (n !== undefined && said[lane] === undefined && lane !== "hints") untold[lane] = n;
      }
      return { composed: c, more: said, folded: parts.fold !== undefined, untold, quiet: said.hints === undefined ? quiet : {} };
    }
  }
  // The last resort: what fits, lane by lane; the rest is untold ("Nearby": quiet).
  let current = at({});
  const lines: Partial<Record<LaneName, string>> = {};
  const more: Partial<Record<LaneName, number>> = {};
  for (const lane of MORE_ORDER) {
    const ids = ctx.lost[lane];
    if (ids === undefined || ids.length === 0) continue;
    lines[lane] = lane !== "identity" && ctx.kept[lane].length === 0 ? collapsedLine(lane, ids) : moreLine(lane, ids);
    const candidate = at(lines);
    if (candidate.bytes > ctx.limit) {
      delete lines[lane];
      continue;
    }
    current = candidate;
    more[lane] = ids.length;
  }
  const untold: Partial<Record<LaneName, number>> = {};
  for (const lane of LANE_ORDER) {
    const n = counts[lane];
    if (n !== undefined && more[lane] === undefined && lane !== "hints") untold[lane] = n;
  }
  return { composed: current, more, folded: false, untold, quiet: more.hints === undefined ? quiet : {} };
}

/** The lanes whose count is reserved: every lane but "Nearby" (2026-10-12). */
export function withoutNearby<T>(lost: Partial<Record<LaneName, T>>): Partial<Record<LaneName, T>> {
  const out = { ...lost };
  delete out.hints;
  return out;
}
