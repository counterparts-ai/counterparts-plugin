import { cadenceFor, readMarker, MARKER_UNSET } from "../core/sleep/index.js";
export const RECENT_IDS = 3;
const WINDOW_CEILING = 50000;
const LOOKBACK = 500;
export const FAMILIES = ["encoding", "storage", "retrieval", "transformation"];
const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
export const MECHANISM_EVIDENCE = [
  {
    id: "salience",
    family: "encoding",
    build: "built",
    proofs: [
      { key: "deposit", event: "gate.deposit", sum: "accepted", says: ["memory scored as it was written", "memories scored as they were written"] },
      { key: "chunk", event: "gate.chunk", sum: "accepted", says: ["memory scored from a crash write-up", "memories scored from a crash write-up"] }
    ]
  },
  {
    id: "emotional",
    family: "encoding",
    build: "partly",
    proofs: [
      { key: "moodMatched", event: "recall.decision", sum: "moodMatched", says: ["memory a matching mood brought closer", "memories a matching mood brought closer"] }
    ],
    census: {
      key: "weighted",
      count: (store, sinceDay) => store.emotionCensus({ sinceDay }).weighted,
      says: ["new memory held higher and fading slower for the feeling it carries", "new memories held higher and fading slower for the feeling they carry"]
    }
  },
  {
    id: "decay",
    family: "storage",
    build: "built",
    proofs: [
      { key: "faded", event: "band.transition", where: (p) => p["site"] === "decay" && p["direction"] !== "up", says: ["memory faded a band", "memories faded a band"] },
      { key: "pruned", event: "memory.pruned", says: ["memory exited (archived at the floor)", "memories exited (archived at the floor)"] },
      { key: "cards", event: "sleep.cycle", sum: "faded", says: ["unused card faded", "unused cards faded"] }
    ],
    census: {
      key: "belowReach",
      count: (store) => store.belowReachCount(),
      says: ["memory below reach now", "memories below reach now"]
    }
  },
  {
    id: "interference",
    family: "storage",
    build: "partly",
    proofs: [
      { key: "dreamMerged", event: "dream.changed", sum: "merge", stands: dreamStands, says: ["near-copy merged in a dream", "near-copies merged in a dream"] },
      { key: "flagged", event: "contradiction.flagged", says: ["pair that disagrees flagged", "pairs that disagree flagged"] },
      { key: "proposed", event: "contradiction.proposed", says: ["memory read as the newer state of an older one", "memories read as the newer state of older ones"] },
      { key: "faded", event: "contradiction.settled", where: (p) => detectedDoor(p), stands: settleStands, says: ["earlier memory faded under a newer one", "earlier memories faded under newer ones"] }
    ]
  },
  {
    id: "retrieval",
    family: "retrieval",
    build: "built",
    proofs: [
      {
        key: "turns",
        event: "recall.decision",
        where: (p) => num(p["surfacedCount"]) + num(p["footnoteCount"]) > 0,
        says: ["turn brought memories to mind", "turns brought memories to mind"]
      },
      { key: "lookups", event: "mcp.recall", says: ["deliberate look-up", "deliberate look-ups"] },
      { key: "credited", event: "recall.credit", sum: "credited", says: ["memory strengthened by being used", "memories strengthened by being used"] }
    ]
  },
  {
    id: "association",
    family: "retrieval",
    build: "partly",
    vital: "reached",
    vitalAfter: { livedDays: 14, others: 20 },
    proofs: [
      { key: "links", event: "associate.flush", sum: "deposited", says: ["link laid", "links laid"] },
      { key: "replayed", event: "dream.begun", sum: "replayLinks", says: ["faint link a dream's replay laid", "faint links a dream's replay laid"] },
      { key: "reached", event: "recall.decision", sum: "linksReached", says: ["memory a link brought to mind", "memories links brought to mind"] }
    ]
  },
  {
    id: "prospective",
    family: "retrieval",
    build: "built",
    proofs: [
      { key: "plain", event: "prospective.plain", says: ["reminder said plainly", "reminders said plainly"] },
      { key: "quiet", event: "prospective.fire", says: ["reminder came back as a quiet footnote", "reminders came back as quiet footnotes"] }
    ],
    held: {
      count: (store) => store.datedMemories("0001-01-01", "9999-12-31").length,
      says: ["dated memory held", "dated memories held"],
      none: "Nothing dated yet: a note or a memory given a date comes back around that day."
    },
    today: true
  },
  {
    id: "consolidation",
    family: "transformation",
    build: "built",
    proofs: [
      { key: "promoted", event: "band.promoted", says: ["memory became core", "memories became core"] },
      { key: "merged", event: "memory.merged", says: ["exact duplicate merged", "exact duplicates merged"] },
      { key: "dreamMerged", event: "dream.changed", sum: "merge", stands: dreamStands, says: ["near-copy merged in a dream", "near-copies merged in a dream"] },
      { key: "rose", event: "band.transition", where: (p) => p["site"] === "consolidate", says: ["memory rose a band", "memories rose a band"] }
    ],
    census: {
      key: "returns",
      count: (store, sinceDay) => {
        const r = store.returnCounts({ sinceDay });
        return r.awake + r.dream + r.reflection;
      },
      says: ["return that will make a memory fade more slowly", "returns that will make memories fade more slowly"]
    },
    schedule: "consolidate"
  },
  {
    id: "dreaming",
    family: "transformation",
    build: "built",
    proofs: [
      { key: "dreams", event: "dream.journaled", stands: dreamStands, says: ["dream", "dreams"] },
      {
        key: "changes",
        event: "dream.changed",
        sum: "applied",
        less: ["nominate-core"],
        stands: dreamStands,
        says: ["change a dream made", "changes dreams made"]
      },
      { key: "suggestions", event: "dream.changed", sum: "nominate-core", stands: dreamStands, says: ["core suggestion", "core suggestions"] }
    ],
    census: {
      key: "reflections",
      count: (store, sinceDay) => store.reflections({ limit: 500 }).filter((r) => r.state === "reflected" && r.day >= sinceDay).length,
      says: ["reflection after a dream", "reflections after dreams"]
    }
  },
  {
    id: "reconsolidation",
    family: "transformation",
    build: "built",
    proofs: [
      { key: "pressure", event: "revision.pressure", says: ["correction weighed against an old memory", "corrections weighed against old memories"] },
      { key: "settled", event: "contradiction.settled", where: (p) => !detectedDoor(p) && p["source"] !== "dream-merge", stands: settleStands, says: ["contradiction settled", "contradictions settled"] }
    ]
  },
  {
    id: "episodic-semantic",
    family: "transformation",
    build: "partly",
    proofs: [{ key: "gist", event: "dream.changed", sum: "gist", stands: dreamStands, says: ["pattern dreamed into a memory of its own", "patterns dreamed into memories of their own"] }]
  },
  {
    id: "schema",
    family: "transformation",
    build: "not",
    proofs: [],
    grey: "In development: beliefs about people and projects are not formed yet."
  }
];
export function payloadOf(row) {
  if (row.payload === null)
    return {};
  try {
    const v = JSON.parse(row.payload);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
export function firingKey(row) {
  return row.name.startsWith("dream.") && row.ref !== null ? `dream:${row.ref}` : `seq:${row.seq}`;
}
export function counted(proof, row, store) {
  const n = amount(proof, payloadOf(row));
  if (n <= 0 || proof.stands === undefined)
    return n;
  try {
    return proof.stands(store, row) ? n : 0;
  } catch {
    return n;
  }
}
function detectedDoor(p) {
  return p["source"] === "slot";
}
function settleStands(store, row) {
  return row.ref === null || store.contradiction(row.ref)?.state === "settled";
}
function dreamStands(store, row) {
  return row.ref === null || store.dream(row.ref)?.state !== "undone";
}
export function amount(proof, p) {
  if (proof.where !== undefined && !proof.where(p))
    return 0;
  if (proof.sum === undefined)
    return 1;
  let v = num(p[proof.sum]);
  for (const f of proof.less ?? [])
    v -= num(p[f]);
  return v > 0 ? v : 0;
}
function scheduleOf(store, phase, today) {
  const cadence = cadenceFor(phase);
  let lastRanDay = null;
  try {
    const m = readMarker(store, phase);
    if (m.health === "ok" && m.day !== MARKER_UNSET)
      lastRanDay = m.day;
  } catch {
    lastRanDay = null;
  }
  if (lastRanDay === null)
    return { phase, cadence, lastRanDay, nextInDays: 0, onTime: false };
  const nextInDays = Math.max(0, lastRanDay + cadence - today);
  return { phase, cadence, lastRanDay, nextInDays, onTime: today - lastRanDay <= cadence };
}
export function mechanismEvidence(store, window) {
  const contains = window.contains ?? ((row) => row.day >= window.sinceDay);
  const isToday = window.isToday ?? ((row) => row.day === window.today);
  let truncated = false;
  const windowRows = new Map;
  const rowsFor = (name) => {
    let rows = windowRows.get(name);
    if (rows === undefined) {
      const read = store.eventLog({ name, sinceDay: window.sinceDay, limit: WINDOW_CEILING, order: "desc" });
      if (read.length >= WINDOW_CEILING)
        truncated = true;
      rows = read.filter(contains);
      windowRows.set(name, rows);
    }
    return rows;
  };
  const verdicts = MECHANISM_EVIDENCE.map((m) => {
    const empty = { id: m.id, family: m.family, build: m.build };
    if (m.build === "not") {
      return { ...empty, fired: false, parts: [], events: [], today: null, firedToday: null, held: null, lastFiredDay: null, schedule: null };
    }
    const parts = [];
    const backing = [];
    let today = 0;
    const firedToday = new Set;
    for (const proof of m.proofs) {
      let total = 0;
      for (const row of rowsFor(proof.event)) {
        const n = counted(proof, row, store);
        if (n > 0) {
          total += n;
          backing.push(row);
          if (row.day === window.today)
            today += n;
          if (isToday(row))
            firedToday.add(firingKey(row));
        }
      }
      parts.push({ key: proof.key, count: total, says: proof.says });
    }
    if (m.census !== undefined) {
      let count = 0;
      try {
        count = m.census.count(store, window.sinceDay);
      } catch {}
      parts.push({ key: m.census.key, count, says: m.census.says });
    }
    let held = null;
    if (m.held !== undefined) {
      try {
        held = m.held.count(store);
      } catch {
        held = null;
      }
    }
    const anyPart = parts.some((p) => p.count > 0);
    const vitalCount = m.vital === undefined ? null : parts.find((p) => p.key === m.vital)?.count ?? 0;
    const without = anyPart && vitalCount === 0 ? m.vital : undefined;
    const others = parts.reduce((t, p) => t + (p.key === m.vital ? 0 : p.count), 0);
    const mature = m.vitalAfter === undefined || window.today >= m.vitalAfter.livedDays && others >= m.vitalAfter.others;
    const starved = without !== undefined && mature ? without : undefined;
    const young = without !== undefined && !mature ? without : undefined;
    const fired = anyPart && without === undefined;
    const events = backing.sort((a, b) => b.seq - a.seq).slice(0, RECENT_IDS).map((r) => r.seq);
    let lastFiredDay = null;
    if (!fired) {
      for (const proof of m.proofs) {
        for (const row of store.eventLog({ name: proof.event, order: "desc", limit: LOOKBACK })) {
          if (counted(proof, row, store) > 0) {
            if (lastFiredDay === null || row.day > lastFiredDay)
              lastFiredDay = row.day;
            break;
          }
        }
      }
    }
    return {
      ...empty,
      fired,
      parts,
      events,
      today: m.today === true ? today : null,
      firedToday: firedToday.size,
      held,
      lastFiredDay,
      schedule: m.schedule === undefined ? null : scheduleOf(store, m.schedule, window.today),
      ...starved === undefined ? {} : { starved },
      ...young === undefined ? {} : { young }
    };
  });
  return { verdicts, truncated };
}
export function builtCount() {
  return MECHANISM_EVIDENCE.filter((m) => m.build !== "not").length;
}
