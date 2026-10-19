/**
 * THE OQ4 PROBE — is the "quietly available / ignorable" framing actually
 * ignorable to a model? (CONTRACT §7, open question 4; v1 shipped the phrasing
 * as a deliberate probe and never measured it.)
 *
 * The measurement, from rows the store already keeps and nothing else:
 *
 *   `recall.decision`  — per turn, the footnote ids DELIVERED (`footnotes[].id`)
 *   `recall.credit`    — per session-ending boundary, the ids the assistant
 *                        EXPANDED through deliberate recall (`expandedIds`)
 *
 * For each session: footnotes delivered (distinct ids), and how many of those
 * the assistant expanded IN THE SAME SESSION — the one behaviour the header is
 * meant to invite or not. "Same session", not "later": the rows carry no turn
 * order across the two names, so an id expanded on turn 2 and footnoted on
 * turn 9 counts; the bias is the same on both sides of the before/after.
 * Aggregated by calendar date so a change to the header (one string,
 * `render.ts#FRAMING.footnoteHeader`) reads as a before/after on the same
 * table. No model, no prose, no ranking; ids and counts only.
 *
 * A day is MEASURED only when at least one `recall.credit` row exists for it.
 * `expandedIds` reached the credit row with the credit seam (2026-09-14); a
 * day with decision rows and no credit rows prints "-", not 0.000 — nothing
 * recorded what was expanded, so nothing is known. Zero and unknown never
 * share a glyph.
 *
 * THE HIT RATE (2026-10-09) rides the same rows: a `recall.credit` row now
 * scores the ambient showings since the session's last boundary that judged —
 * loud, footnoted and pointer, and how many of each no reply expanded or
 * quoted (`shownNotUsed` holds their ids; `probeMemoryHits`, below, reads them per
 * memory and per lane, 2026-10-10). The probe sums the lanes over the rows that carry the counts. Rows from before
 * carry none and are left out, so the line says how many boundaries it rests on.
 *
 * What this does NOT claim: causation. A session that expanded nothing may
 * have had nothing worth expanding. The probe answers "did the behaviour move
 * when the string moved", which is the question OQ4 asks, and leaves the
 * ruling to the owner.
 */

/**
 * Rows a console fetches per event name. The store's `eventLog` defaults to
 * 500, oldest first, which would silently drop the NEWEST rows — the step-1
 * side of the table — once the log grows past it (review of #104, H1). The
 * dashboard reads under the same ceiling.
 */
export const PROBE_ROW_CEILING = 20_000;

export interface ProbeRow {
  readonly name: string;
  readonly day: number;
  /** JSON as stored. Unparseable rows are counted, never thrown on. */
  readonly payload: string | null;
}

export interface ProbeSession {
  readonly session: string;
  readonly date: string | null;
  readonly turns: number;
  readonly footnotesDelivered: number;
  readonly loudDelivered: number;
  readonly expanded: number;
  /** Footnote ids delivered in this session that were also expanded in it. */
  readonly footnotesExpanded: number;
  /** `recall.credit` rows seen for this session; 0 means expansion was never recorded. */
  readonly credits: number;
}

export interface ProbeDay {
  readonly date: string;
  readonly sessions: number;
  readonly turns: number;
  readonly footnotesDelivered: number;
  readonly footnotesExpanded: number;
  readonly expanded: number;
  /** `recall.credit` rows on this date. A day with none is unmeasured. */
  readonly credits: number;
  /** footnotesExpanded / footnotesDelivered; null when nothing was delivered
   *  OR when no credit row exists for the day (unmeasured, not zero). */
  readonly ratio: number | null;
}

export interface ProbeReport {
  readonly sessions: ProbeSession[];
  readonly days: ProbeDay[];
  readonly decisions: number;
  readonly credits: number;
  readonly unparseable: number;
  /** Over MEASURED days only (at least one credit row). */
  readonly totals: {
    readonly footnotesDelivered: number;
    readonly footnotesExpanded: number;
    readonly ratio: number | null;
  };
  /** Days with decision rows and no credit row, and the footnotes they delivered. */
  readonly unmeasured: { readonly days: number; readonly footnotesDelivered: number };
  /**
   * RECALL'S HIT RATE (2026-10-09): what the boundaries that score their
   * showings say — each ambient showing scored once, at the first boundary
   * after it, as used (expanded or quoted) or not, by lane. Credit rows from
   * before carry no score and are not counted here: `boundaries` 0 is unknown,
   * not a rate of zero.
   */
  readonly hits: {
    readonly boundaries: number;
    readonly shown: { readonly loud: number; readonly footnotes: number; readonly pointers: number };
    readonly unused: { readonly loud: number; readonly footnotes: number; readonly pointers: number };
  };
}

/** A finite count off a payload, or null when the row does not carry it. */
function count(p: Record<string, unknown>, key: string): number | null {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

interface Acc {
  session: string;
  date: string | null;
  turns: number;
  footnotes: Set<string>;
  loud: Set<string>;
  expanded: Set<string>;
  credits: number;
}

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string") out.push(x);
    else if (x !== null && typeof x === "object" && typeof (x as { id?: unknown }).id === "string") {
      out.push((x as { id: string }).id);
    }
  }
  return out;
}

export function probeOQ4(rows: readonly ProbeRow[]): ProbeReport {
  const acc = new Map<string, Acc>();
  let decisions = 0;
  let credits = 0;
  let unparseable = 0;
  let scored = 0;
  const shown = { loud: 0, footnotes: 0, pointers: 0 };
  const unused = { loud: 0, footnotes: 0, pointers: 0 };
  const get = (session: string, date: string | null): Acc => {
    let a = acc.get(session);
    if (a === undefined) {
      a = { session, date, turns: 0, footnotes: new Set(), loud: new Set(), expanded: new Set(), credits: 0 };
      acc.set(session, a);
    }
    if (a.date === null && date !== null) a.date = date;
    return a;
  };
  for (const row of rows) {
    if (row.name !== "recall.decision" && row.name !== "recall.credit") continue;
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(row.payload ?? "") as Record<string, unknown>;
      if (p === null || typeof p !== "object") throw new Error("not an object");
    } catch {
      unparseable += 1;
      continue;
    }
    const session = typeof p["session"] === "string" ? p["session"] : null;
    if (session === null) {
      unparseable += 1;
      continue;
    }
    // A `drewOn` field's row (2026-10-11) is the tools', not a boundary's:
    // it expands nothing and scores no showings, so it is not a credit pass.
    if (row.name === "recall.credit" && p["source"] === "drewOn") continue;
    const date = typeof p["date"] === "string" ? p["date"] : null;
    const a = get(session, date);
    if (row.name === "recall.decision") {
      decisions += 1;
      a.turns += 1;
      for (const id of ids(p["footnotes"])) a.footnotes.add(id);
      for (const id of ids(p["surfaced"])) a.loud.add(id);
    } else {
      credits += 1;
      a.credits += 1;
      for (const id of ids(p["expandedIds"])) a.expanded.add(id);
      // A row scores its showings only when it carries all six counts.
      const lanes = [
        ["loud", "shownLoud", "unusedLoud"],
        ["footnotes", "shownFootnotes", "unusedFootnotes"],
        ["pointers", "shownPointers", "unusedPointers"],
      ] as const;
      const got = lanes.map(([, s, u]) => [count(p, s), count(p, u)] as const);
      if (got.every(([s, u]) => s !== null && u !== null)) {
        scored += 1;
        lanes.forEach(([lane], i) => {
          shown[lane] += got[i]?.[0] ?? 0;
          unused[lane] += got[i]?.[1] ?? 0;
        });
      }
    }
  }

  const sessions: ProbeSession[] = [];
  for (const a of acc.values()) {
    let hit = 0;
    for (const id of a.footnotes) if (a.expanded.has(id)) hit += 1;
    sessions.push({
      session: a.session,
      date: a.date,
      turns: a.turns,
      footnotesDelivered: a.footnotes.size,
      loudDelivered: a.loud.size,
      expanded: a.expanded.size,
      footnotesExpanded: hit,
      credits: a.credits,
    });
  }
  sessions.sort((x, y) => (x.date ?? "").localeCompare(y.date ?? "") || x.session.localeCompare(y.session));

  const byDay = new Map<string, { sessions: number; turns: number; fd: number; fe: number; ex: number; cr: number }>();
  for (const s of sessions) {
    const key = s.date ?? "undated";
    const d = byDay.get(key) ?? { sessions: 0, turns: 0, fd: 0, fe: 0, ex: 0, cr: 0 };
    d.sessions += 1;
    d.turns += s.turns;
    d.fd += s.footnotesDelivered;
    d.fe += s.footnotesExpanded;
    d.ex += s.expanded;
    d.cr += s.credits;
    byDay.set(key, d);
  }
  const days: ProbeDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      sessions: d.sessions,
      turns: d.turns,
      footnotesDelivered: d.fd,
      footnotesExpanded: d.fe,
      expanded: d.ex,
      credits: d.cr,
      ratio: d.fd === 0 || d.cr === 0 ? null : d.fe / d.fd,
    }));

  const measured = days.filter((d) => d.credits > 0);
  const fd = measured.reduce((n, d) => n + d.footnotesDelivered, 0);
  const fe = measured.reduce((n, d) => n + d.footnotesExpanded, 0);
  const unmeasuredDays = days.filter((d) => d.credits === 0);
  return {
    sessions,
    days,
    decisions,
    credits,
    unparseable,
    totals: { footnotesDelivered: fd, footnotesExpanded: fe, ratio: fd === 0 ? null : fe / fd },
    unmeasured: {
      days: unmeasuredDays.length,
      footnotesDelivered: unmeasuredDays.reduce((n, d) => n + d.footnotesDelivered, 0),
    },
    hits: { boundaries: scored, shown, unused },
  };
}

/** The table a console prints. One line per day, then the totals over measured days. */
export function renderProbe(report: ProbeReport): string[] {
  const lines: string[] = [];
  lines.push("OQ4 probe — footnotes delivered vs. later expanded, by calendar date");
  lines.push(`rows: ${report.decisions} recall.decision, ${report.credits} recall.credit, ${report.unparseable} unparseable`);
  lines.push("");
  lines.push("date        sessions  turns  footnotes  expanded-footnotes  expanded-total  credits  ratio");
  for (const d of report.days) {
    lines.push(
      `${d.date.padEnd(11)} ${String(d.sessions).padStart(8)}  ${String(d.turns).padStart(5)}  ${String(d.footnotesDelivered).padStart(9)}  ${String(d.footnotesExpanded).padStart(18)}  ${String(d.expanded).padStart(14)}  ${String(d.credits).padStart(7)}  ${d.ratio === null ? "   -" : d.ratio.toFixed(3)}`,
    );
  }
  lines.push("");
  const t = report.totals;
  lines.push(
    `measured: ${t.footnotesDelivered} footnotes delivered, ${t.footnotesExpanded} expanded in the same session${t.ratio === null ? "" : ` (${(t.ratio * 100).toFixed(1)}%)`}`,
  );
  if (report.unmeasured.days > 0) {
    lines.push(
      `unmeasured: ${report.unmeasured.days} day(s) with no recall.credit row, ${report.unmeasured.footnotesDelivered} footnotes delivered — "-" is unknown, not zero`,
    );
  }
  lines.push("");
  const h = report.hits;
  if (h.boundaries === 0) {
    lines.push("hit rate: - (no recall.credit row scores what recall showed yet)");
  } else {
    const lane = (name: string, s: number, u: number): string =>
      `${name} ${s - u} of ${s} used${s === 0 ? "" : ` (${(((s - u) / s) * 100).toFixed(1)}%)`}`;
    lines.push(
      `hit rate, over ${h.boundaries} boundar${h.boundaries === 1 ? "y" : "ies"} that scored what recall showed: ${[
        lane("loud", h.shown.loud, h.unused.loud),
        lane("footnotes", h.shown.footnotes, h.unused.footnotes),
        lane("pointers", h.shown.pointers, h.unused.pointers),
      ].join(", ")}`,
    );
  }
  return lines;
}

/** The lane a showing came through, as the `recall.decision` row records it. */
export type ShowingLane = "loud" | "footnotes" | "pointers";

type LaneCounts = Record<ShowingLane, { sessions: number; ignored: number }>;

/** One memory's score: the scored sessions that showed it, and in how many of
 *  those no reply expanded or quoted it. */
export interface MemoryHit {
  readonly id: string;
  readonly sessions: number;
  readonly ignored: number;
  readonly byLane: Readonly<LaneCounts>;
}

export interface MemoryHitReport {
  /** Most ignored first, then by id. */
  readonly memories: MemoryHit[];
  /** The same counts summed by lane, over every memory. */
  readonly byLane: Readonly<LaneCounts>;
  /** Sessions that showed something: counted; left out because no credit row
   *  scored them; left out because a row's id list was cut at its cap (its
   *  misses are not all named). */
  readonly sessions: { readonly scored: number; readonly unscored: number; readonly truncated: number };
  /** Showings in counted sessions after the session's last judged turn (no
   *  boundary has read their reply yet): left out, counted. */
  readonly unjudgedShowings: number;
}

/**
 * RECALL'S HIT RATE PER MEMORY AND PER LANE (Hawkins 2a, 2026-10-10): the
 * per-memory read the credit row's `shownNotUsed` was written for (2026-10-09).
 * Pure, over the same rows `probeOQ4` takes. Nothing reads it to act.
 *
 * Decided by b2+f8 (Mike asked 2026-10-10), lightly held: ignoring is measured
 * first and has no effect on strength; if anything acts on it later it lowers
 * how readily a memory surfaces (habituation), not its strength. Decide after
 * the ~10-14 check-in.
 *
 * The unit is a memory in a session. `recall.decision` rows say what was shown
 * and through which lane (`surfaced` is loud; a footnote with `via: "link"` is
 * a quiet pointer); the lane kept is the last showing's, as the gate state the
 * credit pass scores keeps it. The session's `recall.credit` rows say which of
 * those no reply expanded or quoted (`shownNotUsed`). Listed on any of the
 * session's boundaries is ignored in that session, even when a later reply
 * opened it: the score is of the reply it was shown for.
 *
 * A session counts only when one of its credit rows carries the list and none
 * cut it short (`shownNotUsedTotal` above the list's length). Leaving a session
 * out says unknown; counting it would turn an unnamed miss into a hit.
 *
 * The same holds inside a counted session (review of #373): a boundary scores
 * the showings up to its `judgedThrough`, and one that read no reply does not
 * move it. A showing whose turn is past the session's highest `judgedThrough`
 * (the reply not read yet, the session still open, a host that closed without
 * a boundary) was never scored, so it is left out and counted
 * (`unjudgedShowings`); a session none of whose showings were scored is
 * unscored. Not caught: a showing the gate state lost before a boundary
 * scored it (its record cap, a reset) reads as a hit.
 */
export function probeMemoryHits(rows: readonly ProbeRow[]): MemoryHitReport {
  const shownIn = new Map<string, Map<string, { lane: ShowingLane; turn: number | null }>>();
  const missedIn = new Map<string, Set<string>>();
  const judgedIn = new Map<string, number>();
  const truncated = new Set<string>();
  for (const row of rows) {
    if (row.name !== "recall.decision" && row.name !== "recall.credit") continue;
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(row.payload ?? "") as Record<string, unknown>;
    } catch {
      continue;
    }
    if (p === null || typeof p !== "object") continue;
    const session = typeof p["session"] === "string" ? p["session"] : null;
    if (session === null) continue;
    if (row.name === "recall.decision") {
      let lanes = shownIn.get(session);
      if (lanes === undefined) {
        lanes = new Map();
        shownIn.set(session, lanes);
      }
      const turn = count(p, "turn");
      for (const id of ids(p["surfaced"])) lanes.set(id, { lane: "loud", turn });
      const foot = p["footnotes"];
      if (Array.isArray(foot)) {
        for (const f of foot) {
          if (typeof f === "string") lanes.set(f, { lane: "footnotes", turn });
          else if (f !== null && typeof f === "object" && typeof (f as { id?: unknown }).id === "string") {
            const e = f as { id: string; via?: unknown };
            lanes.set(e.id, { lane: e.via === "link" ? "pointers" : "footnotes", turn });
          }
        }
      }
      continue;
    }
    if (!Array.isArray(p["shownNotUsed"])) continue;
    const listed = ids(p["shownNotUsed"]);
    const total = count(p, "shownNotUsedTotal");
    if (total !== null && total > listed.length) truncated.add(session);
    const through = count(p, "judgedThrough");
    if (through !== null) judgedIn.set(session, Math.max(judgedIn.get(session) ?? 0, through));
    let missed = missedIn.get(session);
    if (missed === undefined) {
      missed = new Set();
      missedIn.set(session, missed);
    }
    for (const id of listed) missed.add(id);
  }

  const zero = (): LaneCounts => ({
    loud: { sessions: 0, ignored: 0 },
    footnotes: { sessions: 0, ignored: 0 },
    pointers: { sessions: 0, ignored: 0 },
  });
  const per = new Map<string, { sessions: number; ignored: number; byLane: LaneCounts }>();
  const byLane = zero();
  let scored = 0;
  let unscored = 0;
  let cut = 0;
  let unjudgedShowings = 0;
  for (const [session, lanes] of shownIn) {
    const missed = missedIn.get(session);
    if (missed === undefined) {
      unscored += 1;
      continue;
    }
    if (truncated.has(session)) {
      cut += 1;
      continue;
    }
    const through = judgedIn.get(session) ?? 0;
    const judged = [...lanes].filter(([, s]) => s.turn !== null && s.turn <= through);
    if (judged.length === 0) {
      unscored += 1;
      continue;
    }
    scored += 1;
    unjudgedShowings += lanes.size - judged.length;
    for (const [id, { lane }] of judged) {
      let m = per.get(id);
      if (m === undefined) {
        m = { sessions: 0, ignored: 0, byLane: zero() };
        per.set(id, m);
      }
      const miss = missed.has(id) ? 1 : 0;
      m.sessions += 1;
      m.ignored += miss;
      m.byLane[lane].sessions += 1;
      m.byLane[lane].ignored += miss;
      byLane[lane].sessions += 1;
      byLane[lane].ignored += miss;
    }
  }
  const memories: MemoryHit[] = [...per.entries()]
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => b.ignored - a.ignored || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { memories, byLane, sessions: { scored, unscored, truncated: cut }, unjudgedShowings };
}

// ── ratings (2026-10-14; Mike's call; counted as use since 2026-10-19, an experiment) ──

/** The lanes a rating is filed under (`rated.ts#RatedLane`), in print order. */
const RATING_LANES = ["loud", "footnotes", "pointers", "asked", "opened"] as const;
type RatingLane = (typeof RATING_LANES)[number];
type Scores = [number, number, number, number];

export interface RatingLaneStats {
  /** Memories shown in a session through this lane (one per memory per session). */
  readonly shown: number;
  /** Of those, how many the session rated (its last score counts). */
  readonly rated: number;
  /** rated / shown; null when nothing was shown. */
  readonly coverage: number | null;
  /** How many rated 0, 1, 2 and 3. */
  readonly scores: Readonly<Scores>;
  /** Rated memories also named in `drewOn` at that boundary, and how many of those scored 2 or 3. */
  readonly drewOn: { readonly rated: number; readonly high: number };
}

export interface RatingDay {
  readonly date: string;
  readonly sessions: number;
  readonly lanes: Readonly<Record<RatingLane, RatingLaneStats>>;
}

export interface RatingReport {
  /** `recall.rated` rows read, and rows of the four names that would not parse. */
  readonly rows: number;
  readonly unparseable: number;
  /** By the session's calendar date ("undated" when no row said one). */
  readonly days: RatingDay[];
  readonly totals: Readonly<Record<RatingLane, RatingLaneStats>>;
  /** Ids named in `drewOn` at a rating boundary and not rated there. */
  readonly drewOnUnrated: number;
  /**
   * Agreement with the credit pass's used / shown-not-used score (2026-10-09),
   * over ambient showings a credit row judged and the session rated: scores by
   * used and by ignored, and how many agree (used and 2–3, or ignored and 0–1).
   */
  readonly usage: { readonly used: Readonly<Scores>; readonly ignored: Readonly<Scores>; readonly agree: number; readonly of: number };
  /** What the rows themselves recorded at each ask: ambient showings since the
   *  session's previous rating, and how many of those were rated. */
  readonly boundaries: { readonly shown: number; readonly rated: number };
  /** Sessions left out because they come before ratings began (no rating row, dated
   *  before the first one, or undated). */
  readonly before: number;
}

function parsePayload(row: ProbeRow): Record<string, unknown> | null {
  try {
    const p = JSON.parse(row.payload ?? "") as unknown;
    return p !== null && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function into<T>(m: Map<string, T>, k: string, make: () => T): T {
  let v = m.get(k);
  if (v === undefined) {
    v = make();
    m.set(k, v);
  }
  return v;
}

/** The sum of an object's finite numbers (a lane-count object), 0 otherwise. */
function laneSum(v: unknown): number {
  if (v === null || typeof v !== "object") return 0;
  let t = 0;
  for (const x of Object.values(v as Record<string, unknown>)) if (typeof x === "number" && Number.isFinite(x)) t += x;
  return t;
}

/**
 * THE RATINGS READER (2026-10-14; Mike's call, lightly held; the scores count
 * as use since 2026-10-19, an experiment — `rated.ts`):
 * per calendar date and per lane, what sessions were shown, how much of it
 * they rated, the score distribution, and how the scores sit beside the two
 * other signals — `drewOn` (expected 2–3) and the credit pass's used /
 * shown-not-used. Pure, over the store's rows; this reader acts on nothing.
 *
 * Rows read: `recall.rated` (the ratings), `recall.decision` (the ambient
 * showings, by lane), `mcp.recall` (a question's answer is `asked`, an
 * address's is `opened`) and `recall.credit` (the used score, as
 * `probeMemoryHits` reads it). The unit is a memory in a session, its lane by
 * the core's precedence: ambient first, then asked, then opened. A memory
 * rated in a lane no row here showed (a `remember` result's neighbours, which
 * only the server's own seen set holds) is counted shown in the lane its
 * rating names. A session's last score for a memory counts.
 */
export function probeRatings(rows: readonly ProbeRow[]): RatingReport {
  type Unit = { lane: RatingLane; turn: number | null };
  type Score = { score: number; lane: RatingLane; drewOn: boolean };
  const shownIn = new Map<string, Map<string, Unit>>();
  const askedIn = new Map<string, Set<string>>();
  const openedIn = new Map<string, Set<string>>();
  const dateOf = new Map<string, string>();
  const scoreIn = new Map<string, Map<string, Score>>();
  const missedIn = new Map<string, Set<string>>();
  const judgedIn = new Map<string, number>();
  const truncated = new Set<string>();
  let ratedRows = 0;
  let unparseable = 0;
  let drewOnUnrated = 0;
  /** The calendar date of the earliest rating row: before it, ratings did not exist. */
  let firstRated: string | null = null;
  let before = 0;
  const boundaries = { shown: 0, rated: 0 };
  for (const row of rows) {
    if (row.name !== "recall.rated" && row.name !== "recall.decision" && row.name !== "recall.credit" && row.name !== "mcp.recall") continue;
    const p = parsePayload(row);
    if (p === null) {
      unparseable += 1;
      continue;
    }
    const session = typeof p["session"] === "string" ? p["session"] : null;
    if (session === null) continue;
    const date = typeof p["date"] === "string" ? p["date"] : null;
    if (date !== null && !dateOf.has(session)) dateOf.set(session, date);
    if (row.name === "recall.decision") {
      const lanes = into(shownIn, session, () => new Map<string, Unit>());
      const turn = count(p, "turn");
      for (const id of ids(p["surfaced"])) lanes.set(id, { lane: "loud", turn });
      const foot = p["footnotes"];
      if (Array.isArray(foot)) {
        for (const f of foot) {
          if (typeof f === "string") lanes.set(f, { lane: "footnotes", turn });
          else if (f !== null && typeof f === "object" && typeof (f as { id?: unknown }).id === "string") {
            const e = f as { id: string; via?: unknown };
            lanes.set(e.id, { lane: e.via === "link" ? "pointers" : "footnotes", turn });
          }
        }
      }
    } else if (row.name === "mcp.recall") {
      const to = p["path"] === "question" ? askedIn : p["path"] === "handle" ? openedIn : null;
      if (to === null) continue;
      const set = into(to, session, () => new Set<string>());
      for (const id of ids(p["ids"])) set.add(id);
    } else if (row.name === "recall.credit") {
      if (p["source"] === "drewOn" || !Array.isArray(p["shownNotUsed"])) continue;
      const listed = ids(p["shownNotUsed"]);
      const total = count(p, "shownNotUsedTotal");
      if (total !== null && total > listed.length) truncated.add(session);
      const through = count(p, "judgedThrough");
      if (through !== null) judgedIn.set(session, Math.max(judgedIn.get(session) ?? 0, through));
      const missed = into(missedIn, session, () => new Set<string>());
      for (const id of listed) missed.add(id);
    } else {
      ratedRows += 1;
      if (date !== null && (firstRated === null || date < firstRated)) firstRated = date;
      const scores = into(scoreIn, session, () => new Map<string, Score>());
      const list = p["ratings"];
      if (Array.isArray(list)) {
        for (const r of list) {
          if (r === null || typeof r !== "object") continue;
          const e = r as { id?: unknown; score?: unknown; lane?: unknown; drewOn?: unknown };
          if (typeof e.id !== "string" || typeof e.score !== "number" || !Number.isInteger(e.score) || e.score < 0 || e.score > 3) continue;
          const lane = (RATING_LANES as readonly unknown[]).includes(e.lane) ? (e.lane as RatingLane) : "opened";
          scores.set(e.id, { score: e.score, lane, drewOn: e.drewOn === true });
        }
      }
      const unratedDrew = p["drewOnUnrated"];
      if (Array.isArray(unratedDrew)) drewOnUnrated += unratedDrew.length;
      const cov = p["coverage"];
      if (cov !== null && typeof cov === "object") {
        boundaries.shown += laneSum((cov as Record<string, unknown>)["shown"]);
        boundaries.rated += laneSum((cov as Record<string, unknown>)["rated"]);
      }
    }
  }

  type Mut = { shown: number; rated: number; scores: Scores; drewOn: { rated: number; high: number } };
  const zeroLanes = (): Record<RatingLane, Mut> =>
    Object.fromEntries(RATING_LANES.map((l) => [l, { shown: 0, rated: 0, scores: [0, 0, 0, 0], drewOn: { rated: 0, high: 0 } }])) as Record<RatingLane, Mut>;
  const byDay = new Map<string, { sessions: number; lanes: Record<RatingLane, Mut> }>();
  const totals = zeroLanes();
  const usage = { used: [0, 0, 0, 0] as Scores, ignored: [0, 0, 0, 0] as Scores, agree: 0, of: 0 };
  const sessions = new Set<string>([...shownIn.keys(), ...askedIn.keys(), ...openedIn.keys(), ...scoreIn.keys()]);
  for (const session of sessions) {
    // FROM WHEN RATINGS BEGAN (review of #492): a session with no rating row
    // counts only when it is dated on or after the first rating row's date;
    // one from before could not have rated, and would drag coverage to zero.
    const sessionDate = dateOf.get(session);
    if (!scoreIn.has(session) && (firstRated === null || sessionDate === undefined || sessionDate < firstRated)) {
      before += 1;
      continue;
    }
    const units = new Map<string, Unit>(shownIn.get(session) ?? []);
    for (const id of askedIn.get(session) ?? []) if (!units.has(id)) units.set(id, { lane: "asked", turn: null });
    for (const id of openedIn.get(session) ?? []) if (!units.has(id)) units.set(id, { lane: "opened", turn: null });
    const scores = scoreIn.get(session) ?? new Map<string, Score>();
    for (const [id, s] of scores) if (!units.has(id)) units.set(id, { lane: s.lane, turn: null });
    const day = into(byDay, dateOf.get(session) ?? "undated", () => ({ sessions: 0, lanes: zeroLanes() }));
    day.sessions += 1;
    const missed = truncated.has(session) ? undefined : missedIn.get(session);
    const through = judgedIn.get(session) ?? 0;
    for (const [id, u] of units) {
      const s = scores.get(id);
      for (const lanes of [day.lanes, totals]) {
        const l = lanes[u.lane];
        l.shown += 1;
        if (s === undefined) continue;
        l.rated += 1;
        l.scores[s.score] = (l.scores[s.score] ?? 0) + 1;
        if (s.drewOn) {
          l.drewOn.rated += 1;
          if (s.score >= 2) l.drewOn.high += 1;
        }
      }
      // The used score: only an ambient showing a credit row judged.
      if (s === undefined || missed === undefined || u.turn === null || u.turn > through) continue;
      if (u.lane !== "loud" && u.lane !== "footnotes" && u.lane !== "pointers") continue;
      const ignored = missed.has(id);
      const into4 = ignored ? usage.ignored : usage.used;
      into4[s.score] = (into4[s.score] ?? 0) + 1;
      usage.of += 1;
      if ((ignored && s.score <= 1) || (!ignored && s.score >= 2)) usage.agree += 1;
    }
  }
  const freeze = (lanes: Record<RatingLane, Mut>): Record<RatingLane, RatingLaneStats> =>
    Object.fromEntries(
      RATING_LANES.map((l) => {
        const m = lanes[l];
        // Loud lines show no id and are not asked for: no coverage, only what was rated.
        const coverage = l === "loud" || m.shown === 0 ? null : m.rated / m.shown;
        const stats: RatingLaneStats = { shown: m.shown, rated: m.rated, coverage, scores: m.scores, drewOn: m.drewOn };
        return [l, stats];
      }),
    ) as Record<RatingLane, RatingLaneStats>;
  const days: RatingDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, sessions: d.sessions, lanes: freeze(d.lanes) }));
  return { rows: ratedRows, unparseable, days, totals: freeze(totals), drewOnUnrated, usage, boundaries, before };
}

/** The ratings table a console prints: one line per date per lane that showed something, then the agreements. */
export function renderRatings(report: RatingReport): string[] {
  const lines: string[] = [];
  lines.push("Ratings — what sessions scored of what they were shown, 0–3 (counted as use since 2026-10-19), by calendar date and lane");
  if (report.rows === 0) {
    lines.push("ratings: - (no recall.rated row yet)");
    return lines;
  }
  const pct = (v: number | null): string => (v === null ? "     -" : `${(v * 100).toFixed(1).padStart(5)}%`);
  const line = (date: string, lane: string, l: RatingLaneStats): string =>
    `${date.padEnd(11)} ${lane.padEnd(9)} ${String(l.shown).padStart(5)}  ${String(l.rated).padStart(5)}  ${pct(l.coverage)}  ${l.scores.map((n) => String(n).padStart(4)).join("")}  ${String(l.drewOn.rated).padStart(6)}`;
  lines.push(
    `rows: ${report.rows} recall.rated${report.unparseable > 0 ? `, ${report.unparseable} unparseable` : ""}${report.before > 0 ? `; ${report.before} session(s) from before ratings began left out` : ""}`,
  );
  lines.push("");
  lines.push("date        lane      shown  rated  covered    0   1   2   3  drewOn");
  for (const d of report.days) {
    for (const lane of RATING_LANES) {
      const l = d.lanes[lane];
      if (l.shown > 0) lines.push(line(d.date, lane, l));
    }
  }
  lines.push("");
  for (const lane of RATING_LANES) {
    const l = report.totals[lane];
    if (l.shown > 0) lines.push(line("total", lane, l));
  }
  lines.push("");
  const drew = RATING_LANES.reduce(
    (a, l) => ({ rated: a.rated + report.totals[l].drewOn.rated, high: a.high + report.totals[l].drewOn.high }),
    { rated: 0, high: 0 },
  );
  lines.push(
    `drewOn: ${drew.rated} rated, ${drew.high} of them 2–3${drew.rated === 0 ? "" : ` (${((drew.high / drew.rated) * 100).toFixed(1)}%)`}; ${report.drewOnUnrated} named and not rated`,
  );
  const u = report.usage;
  lines.push(
    u.of === 0
      ? "used vs rated: - (no rated showing a credit row judged)"
      : `used vs rated, over ${u.of} judged showings: used scored [${u.used.join(", ")}], ignored scored [${u.ignored.join(", ")}]; agree ${u.agree} (${((u.agree / u.of) * 100).toFixed(1)}%: used and 2–3, or ignored and 0–1)`,
  );
  const b = report.boundaries;
  lines.push(
    `at the asks: ${b.rated} of ${b.shown} ambient showings since each session's last rating were rated${b.shown === 0 ? "" : ` (${((b.rated / b.shown) * 100).toFixed(1)}%)`}`,
  );
  return lines;
}
