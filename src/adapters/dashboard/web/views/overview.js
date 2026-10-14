import { MARKER_UNSET, isJournal, ownerNames, readMarker } from "../../../../core/sleep/index.js";
import { NEVER, NONE } from "../../layout.js";
import { BANDS, CYCLE_PHASES } from "../../registries.js";
import { displayName } from "../ask-voice.js";
import { reveal } from "../reveal.js";
import { activityView } from "./activity.js";
import { feelingsView } from "./memories.js";
import { lastActive } from "./meta.js";
import { coreCandidates } from "./mind.js";
import { BAND_GLOSS, chapters, contestedRows, livedDays } from "./rows.js";
import { FEED_LIMIT, LOG_CEILING, absenceFor, census, countMap } from "./shared.js";
import { selfMap } from "./self-map.js";
import { todayView } from "./today.js";
export function heroHeadline(x) {
  const parts = [
    x.lived ? `Day ${x.day}${x.owner === null ? "" : ` with ${x.owner}`}` : "Nothing lived yet",
    `${x.memories} ${x.memories === 1 ? "memory" : "memories"}`
  ];
  if (x.newToday > 0)
    parts.push(`${x.newToday} new today`);
  return parts.join(" · ");
}
export function ownerName(src) {
  try {
    return displayName(ownerNames(src.store)[0] ?? null);
  } catch {
    return null;
  }
}
function homeMap(src, identity) {
  const core = identity.map((el) => {
    const r = reveal(src.store, el.id, 120);
    return { id: el.id, text: r.text ?? r.label, confidential: r.confidential, strength: el.strength };
  });
  return selfMap(src, core, coreCandidates(src, src.self.page()?.id ?? null).raw);
}
export function overviewView(src, feedLimit = FEED_LIMIT) {
  const store = src.store;
  const day = store.livedDay();
  const rows = census(src);
  const held = rows.filter((r) => !r.schema);
  const beliefs = rows.length - held.length;
  const archived = census(src, { includeArchived: true }).filter((r) => r.archived !== null);
  const journal = chapters(src, 5);
  const journalCount = store.list().filter((id) => {
    const row = store.row(id);
    return row !== undefined && isJournal(row);
  }).length;
  const e = src.self.enumerate(day);
  const wake = src.self.wake();
  const contested = contestedRows(src);
  const byBand = countMap(rows, "band");
  const peak = Math.max(1, ...BANDS.map((b) => byBand.get(b) ?? 0));
  const everLived = day > 0 || rows.length > 0 || journalCount > 0;
  const promotedDays = new Map;
  for (const row of store.eventLog({ name: "band.promoted", order: "desc", limit: LOG_CEILING })) {
    if (row.ref !== null)
      promotedDays.set(row.ref, row.day);
  }
  const tiles = [
    {
      label: "days of use",
      value: String(day),
      note: lastActive(store.getMeta("lastActiveDate")) === null ? "the clock has never moved" : `last of them ${lastActive(store.getMeta("lastActiveDate")) ?? ""}`,
      accent: "cyan",
      absent: day === 0
    },
    { label: "memories held", value: String(held.length), note: "live, journal excluded", accent: "cyan", absent: held.length === 0 },
    {
      label: "beliefs and entities",
      value: String(beliefs),
      note: "held like memories, counted apart",
      accent: "teal",
      absent: beliefs === 0
    },
    { label: "archived", value: String(archived.length), note: "held, not gone", accent: "teal", absent: archived.length === 0 },
    { label: "journal entries", value: String(journalCount), note: "chapters — these do not decay", accent: "purple", absent: journalCount === 0 },
    { label: "identity band", value: String(e.identity.length), note: "what strength earned", accent: "purple", absent: e.identity.length === 0 },
    { label: "protected", value: String(e.protected.length), note: "permanent ink, no revision reaches it", accent: "amber", absent: e.protected.length === 0 },
    {
      label: "contested beliefs",
      value: String(contested.length),
      note: contested.length === 0 ? "nothing has argued with me" : "arguments in progress or settled",
      accent: contested.some((c) => c.fraction >= 1) ? "amber" : "teal",
      absent: contested.length === 0
    },
    {
      label: "last cycle",
      value: lastCycleDay(src) === null ? NEVER : `day ${lastCycleDay(src)}`,
      note: "the newest phase marker I hold",
      accent: "teal",
      absent: lastCycleDay(src) === null
    },
    {
      label: "wake bytes",
      value: wake.ok ? String(wake.bytes) : NEVER,
      note: wake.ok ? "composed and waiting for the next session" : `nothing waiting (${wake.reason})`,
      accent: wake.ok ? "cyan" : "amber",
      absent: !wake.ok
    }
  ];
  const opening = day === 0 && rows.length === 0 ? "I have not had a day of use yet. Everything below is what I would be able to tell you, and the honest word for how much of it I know is on each panel." : `I have had ${day} ${day === 1 ? "day" : "days"} of use. I am holding ${held.length} ${held.length === 1 ? "memory" : "memories"}` + (beliefs === 0 ? "" : ` and ${beliefs} ${beliefs === 1 ? "belief or entity" : "beliefs and entities"}`) + (archived.length === 0 ? "" : `, with ${archived.length} more archived`) + (journalCount === 0 ? "." : `, beside ${journalCount} journal ${journalCount === 1 ? "entry" : "entries"} that do not decay.`);
  const memories = rows.length;
  const today = todayView(src);
  const hero = {
    headline: heroHeadline({ day, lived: !(day === 0 && rows.length === 0), owner: ownerName(src), memories, newToday: today.newToday }),
    memories,
    newToday: today.newToday
  };
  return {
    hero,
    today,
    feelings: feelingsView(src, rows),
    map: homeMap(src, e.identity),
    opening,
    tiles,
    bands: BANDS.map((b) => {
      const count = byBand.get(b) ?? 0;
      return {
        label: b,
        count,
        fraction: count / peak,
        note: BAND_GLOSS[b],
        absent: absenceFor(count, everLived)
      };
    }),
    bandNote: "Memories start episodic and climb only by being used on separate days. Most fade where they started — that is the design, not a shortfall.",
    feed: activityView(src, { limit: feedLimit, lane: "home", fold: true }).events,
    identity: e.identity.slice(0, 12).map((el) => {
      const r = reveal(store, el.id, 90);
      return {
        id: el.id,
        text: r.text ?? r.label,
        kind: el.kind,
        band: el.band,
        strength: el.strength,
        promotedDay: promotedDays.get(el.id) ?? null,
        ...livedDays(src, el.id),
        confidential: r.confidential
      };
    }),
    identityAbsent: e.identity.length === 0 ? everLived ? NONE : NEVER : null,
    guarded: e.protected.slice(0, 12).map((el) => {
      const r = reveal(store, el.id, 90);
      return {
        id: el.id,
        text: r.text ?? r.label,
        kind: el.kind,
        ...livedDays(src, el.id),
        confidential: r.confidential
      };
    }),
    guardedAbsent: e.protected.length === 0 ? everLived ? NONE : NEVER : null,
    contested,
    contestedAbsent: contested.length === 0 ? everLived ? NONE : NEVER : null,
    chapters: journal,
    chaptersAbsent: journal.length === 0 ? everLived ? NONE : NEVER : null
  };
}
function lastCycleDay(src) {
  let newest = null;
  for (const phase of CYCLE_PHASES) {
    const marker = readMarker(src.store, phase);
    if (marker.health === "torn" || marker.day === MARKER_UNSET)
      continue;
    newest = newest === null ? marker.day : Math.max(newest, marker.day);
  }
  return newest;
}
