export const PROBE_ROW_CEILING = 20000;
function count(p, key) {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function ids(v) {
  if (!Array.isArray(v))
    return [];
  const out = [];
  for (const x of v) {
    if (typeof x === "string")
      out.push(x);
    else if (x !== null && typeof x === "object" && typeof x.id === "string") {
      out.push(x.id);
    }
  }
  return out;
}
export function probeOQ4(rows) {
  const acc = new Map;
  let decisions = 0;
  let credits = 0;
  let unparseable = 0;
  let scored = 0;
  const shown = { loud: 0, footnotes: 0, pointers: 0 };
  const unused = { loud: 0, footnotes: 0, pointers: 0 };
  const get = (session, date) => {
    let a = acc.get(session);
    if (a === undefined) {
      a = { session, date, turns: 0, footnotes: new Set, loud: new Set, expanded: new Set, credits: 0 };
      acc.set(session, a);
    }
    if (a.date === null && date !== null)
      a.date = date;
    return a;
  };
  for (const row of rows) {
    if (row.name !== "recall.decision" && row.name !== "recall.credit")
      continue;
    let p;
    try {
      p = JSON.parse(row.payload ?? "");
      if (p === null || typeof p !== "object")
        throw new Error("not an object");
    } catch {
      unparseable += 1;
      continue;
    }
    const session = typeof p["session"] === "string" ? p["session"] : null;
    if (session === null) {
      unparseable += 1;
      continue;
    }
    if (row.name === "recall.credit" && p["source"] === "drewOn")
      continue;
    const date = typeof p["date"] === "string" ? p["date"] : null;
    const a = get(session, date);
    if (row.name === "recall.decision") {
      decisions += 1;
      a.turns += 1;
      for (const id of ids(p["footnotes"]))
        a.footnotes.add(id);
      for (const id of ids(p["surfaced"]))
        a.loud.add(id);
    } else {
      credits += 1;
      a.credits += 1;
      for (const id of ids(p["expandedIds"]))
        a.expanded.add(id);
      const lanes = [
        ["loud", "shownLoud", "unusedLoud"],
        ["footnotes", "shownFootnotes", "unusedFootnotes"],
        ["pointers", "shownPointers", "unusedPointers"]
      ];
      const got = lanes.map(([, s, u]) => [count(p, s), count(p, u)]);
      if (got.every(([s, u]) => s !== null && u !== null)) {
        scored += 1;
        lanes.forEach(([lane], i) => {
          shown[lane] += got[i]?.[0] ?? 0;
          unused[lane] += got[i]?.[1] ?? 0;
        });
      }
    }
  }
  const sessions = [];
  for (const a of acc.values()) {
    let hit = 0;
    for (const id of a.footnotes)
      if (a.expanded.has(id))
        hit += 1;
    sessions.push({
      session: a.session,
      date: a.date,
      turns: a.turns,
      footnotesDelivered: a.footnotes.size,
      loudDelivered: a.loud.size,
      expanded: a.expanded.size,
      footnotesExpanded: hit,
      credits: a.credits
    });
  }
  sessions.sort((x, y) => (x.date ?? "").localeCompare(y.date ?? "") || x.session.localeCompare(y.session));
  const byDay = new Map;
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
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({
    date,
    sessions: d.sessions,
    turns: d.turns,
    footnotesDelivered: d.fd,
    footnotesExpanded: d.fe,
    expanded: d.ex,
    credits: d.cr,
    ratio: d.fd === 0 || d.cr === 0 ? null : d.fe / d.fd
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
      footnotesDelivered: unmeasuredDays.reduce((n, d) => n + d.footnotesDelivered, 0)
    },
    hits: { boundaries: scored, shown, unused }
  };
}
export function renderProbe(report) {
  const lines = [];
  lines.push("OQ4 probe — footnotes delivered vs. later expanded, by calendar date");
  lines.push(`rows: ${report.decisions} recall.decision, ${report.credits} recall.credit, ${report.unparseable} unparseable`);
  lines.push("");
  lines.push("date        sessions  turns  footnotes  expanded-footnotes  expanded-total  credits  ratio");
  for (const d of report.days) {
    lines.push(`${d.date.padEnd(11)} ${String(d.sessions).padStart(8)}  ${String(d.turns).padStart(5)}  ${String(d.footnotesDelivered).padStart(9)}  ${String(d.footnotesExpanded).padStart(18)}  ${String(d.expanded).padStart(14)}  ${String(d.credits).padStart(7)}  ${d.ratio === null ? "   -" : d.ratio.toFixed(3)}`);
  }
  lines.push("");
  const t = report.totals;
  lines.push(`measured: ${t.footnotesDelivered} footnotes delivered, ${t.footnotesExpanded} expanded in the same session${t.ratio === null ? "" : ` (${(t.ratio * 100).toFixed(1)}%)`}`);
  if (report.unmeasured.days > 0) {
    lines.push(`unmeasured: ${report.unmeasured.days} day(s) with no recall.credit row, ${report.unmeasured.footnotesDelivered} footnotes delivered — "-" is unknown, not zero`);
  }
  lines.push("");
  const h = report.hits;
  if (h.boundaries === 0) {
    lines.push("hit rate: - (no recall.credit row scores what recall showed yet)");
  } else {
    const lane = (name, s, u) => `${name} ${s - u} of ${s} used${s === 0 ? "" : ` (${((s - u) / s * 100).toFixed(1)}%)`}`;
    lines.push(`hit rate, over ${h.boundaries} boundar${h.boundaries === 1 ? "y" : "ies"} that scored what recall showed: ${[
      lane("loud", h.shown.loud, h.unused.loud),
      lane("footnotes", h.shown.footnotes, h.unused.footnotes),
      lane("pointers", h.shown.pointers, h.unused.pointers)
    ].join(", ")}`);
  }
  return lines;
}
export function probeMemoryHits(rows) {
  const shownIn = new Map;
  const missedIn = new Map;
  const judgedIn = new Map;
  const truncated = new Set;
  for (const row of rows) {
    if (row.name !== "recall.decision" && row.name !== "recall.credit")
      continue;
    let p;
    try {
      p = JSON.parse(row.payload ?? "");
    } catch {
      continue;
    }
    if (p === null || typeof p !== "object")
      continue;
    const session = typeof p["session"] === "string" ? p["session"] : null;
    if (session === null)
      continue;
    if (row.name === "recall.decision") {
      let lanes = shownIn.get(session);
      if (lanes === undefined) {
        lanes = new Map;
        shownIn.set(session, lanes);
      }
      const turn = count(p, "turn");
      for (const id of ids(p["surfaced"]))
        lanes.set(id, { lane: "loud", turn });
      const foot = p["footnotes"];
      if (Array.isArray(foot)) {
        for (const f of foot) {
          if (typeof f === "string")
            lanes.set(f, { lane: "footnotes", turn });
          else if (f !== null && typeof f === "object" && typeof f.id === "string") {
            const e = f;
            lanes.set(e.id, { lane: e.via === "link" ? "pointers" : "footnotes", turn });
          }
        }
      }
      continue;
    }
    if (!Array.isArray(p["shownNotUsed"]))
      continue;
    const listed = ids(p["shownNotUsed"]);
    const total = count(p, "shownNotUsedTotal");
    if (total !== null && total > listed.length)
      truncated.add(session);
    const through = count(p, "judgedThrough");
    if (through !== null)
      judgedIn.set(session, Math.max(judgedIn.get(session) ?? 0, through));
    let missed = missedIn.get(session);
    if (missed === undefined) {
      missed = new Set;
      missedIn.set(session, missed);
    }
    for (const id of listed)
      missed.add(id);
  }
  const zero = () => ({
    loud: { sessions: 0, ignored: 0 },
    footnotes: { sessions: 0, ignored: 0 },
    pointers: { sessions: 0, ignored: 0 }
  });
  const per = new Map;
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
  const memories = [...per.entries()].map(([id, m]) => ({ id, ...m })).sort((a, b) => b.ignored - a.ignored || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { memories, byLane, sessions: { scored, unscored, truncated: cut }, unjudgedShowings };
}
