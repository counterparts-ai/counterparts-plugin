import { homedir } from "node:os";
import { COVERAGE_TUNABLES, lapsesSince, ledger } from "../../core/coverage/index.js";
import { dreamingSetting } from "../../core/dream/index.js";
import { SpanBuffer } from "../../core/remember/index.js";
import { localDate, localStamp, readableDate } from "../../core/time.js";
import { catchUpOf } from "../claude-code/night-catch-up.js";
import { DESKTOP_HOST } from "../hosts.js";
import { hostOf, hostSessionEvidence, listSessions, pointable } from "../sessions.js";
export const COVERAGE_LAPSE_WINDOW_DAYS = 7;
export function lengthWords(minutes) {
  if (minutes < 60)
    return `${String(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m)} min`;
}
function place(scopes) {
  const home = homedir();
  const shown = scopes.map((s) => s === home || s.startsWith(`${home}/`) ? `~${s.slice(home.length)}` : s);
  return shown.join(", ");
}
const plural = (n, one, many) => `${String(n)} ${n === 1 ? one : many}`;
function standing(e, zone, auto, person) {
  const s = e.stretch;
  if (s === null)
    return "all written up";
  const what = `not yet written up: ${plural(s.pieces, "piece", "pieces")} over ${lengthWords(s.minutes)}, since ${localStamp(s.firstAt, zone)}`;
  if (e.lapsed) {
    return `${what} — let go after ${plural(e.daysOfUseSince, "day", "days")} of use unwritten: lost to memory, no longer owed, nothing deleted`;
  }
  if (e.owed && !person)
    return `${what} — left to lapse (small; not known as a person's session): nothing asks for its write-up`;
  if (e.owed) {
    const why = e.state === "ended" ? "it ended" : "it has been quiet since the date changed";
    const who = auto ? "the nightly run catches it up" : `the next session in its project is asked to write it up${e.small ? ", one line is enough" : ""}`;
    return `${what} — owed (${why}); ${who}, or counterparts catch-up now`;
  }
  if (e.state === "active")
    return `${what} — still at work`;
  return `${what} — under the floor (${String(COVERAGE_TUNABLES.OWED_PIECES)} pieces over ` + `${String(COVERAGE_TUNABLES.OWED_SPAN_MS / 60000)} min): owes nothing`;
}
export function coverageLines(input) {
  const { store, date } = input;
  const zone = store.zone();
  const now = store.now();
  const spans = new SpanBuffer({ dir: store.dir, observer: true, now: () => now });
  const host = hostSessionEvidence(store);
  const entries = ledger(spans, { now, zone, host: (s) => ({ endedAt: host(s).endedAt }) });
  const persons = new Map;
  const person = (e) => {
    let p = persons.get(e.session);
    if (p === undefined) {
      p = pointable(e, store.dir);
      persons.set(e.session, p);
    }
    return p;
  };
  const on = entries.filter((e) => e.perDate[date] !== undefined);
  const said = readableDate(date) || date;
  let auto = false;
  try {
    auto = dreamingSetting(store) === "auto";
  } catch {
    auto = false;
  }
  const out = [];
  if (on.length === 0) {
    out.push(`${said}${date === input.today ? " (today)" : ""}: nothing captured.`);
  } else {
    const pieces = on.reduce((n, e) => n + (e.perDate[date]?.pieces ?? 0), 0);
    const written = on.reduce((n, e) => n + (e.perDate[date]?.written ?? 0), 0);
    out.push(`${said}${date === input.today ? " (today)" : ""}: ${plural(on.length, "session", "sessions")} captured something; ` + `${String(written)} of ${plural(pieces, "piece", "pieces")} that day ${written === 1 ? "is" : "are"} written up.`);
    for (const e of on) {
      const cell = e.perDate[date] ?? { pieces: 0, written: 0 };
      out.push(`  ${e.session}  ${place(e.scopes)}`, `    that day: ${String(cell.written)} of ${plural(cell.pieces, "piece", "pieces")} written up; now ${standing(e, zone, auto, person(e))}`);
    }
  }
  const desktop = listSessions(store.dir).filter((r) => hostOf(r) === DESKTOP_HOST && (localDate(r.startedAt, zone) === date || localDate(r.lastBoundaryAt, zone) === date));
  if (desktop.length > 0) {
    out.push(`Claude Desktop: ${plural(desktop.length, "session", "sessions")} that day — unmeasured: Desktop chat keeps no transcript, so what ${desktop.length === 1 ? "it" : "they"} did not write up cannot be counted (not lost; what was written through the tools is kept).`);
  }
  const owed = entries.filter((e) => e.owed && person(e));
  const lapsing = entries.filter((e) => e.owed && !person(e));
  out.push("", owed.length === 0 ? "Owed now: nothing." : `Owed now: ${plural(owed.length, "session", "sessions")} — ${owed.map((e) => `${e.session} (${plural(e.stretch?.pieces ?? 0, "piece", "pieces")})`).join(", ")}.`);
  if (lapsing.length > 0) {
    out.push(`Left to lapse (small; not known as a person's session): ${plural(lapsing.length, "session", "sessions")} — ${lapsing.map((e) => `${e.session} (${plural(e.stretch?.pieces ?? 0, "piece", "pieces")})`).join(", ")}.`);
  }
  const cu = catchUpOf(store);
  const cuDate = cu === null ? "" : localDate(cu.at, zone);
  if (cu !== null && cu.unread > 0 && (date === input.today || cuDate === date) && now - cu.at < COVERAGE_LAPSE_WINDOW_DAYS * 86400000) {
    out.push(`The last catch-up (${readableDate(cuDate) || cuDate}) left ${plural(cu.unread, "part", "parts")} unread; they stay owed.`);
  }
  const lapses = lapsesSince(store, now - COVERAGE_LAPSE_WINDOW_DAYS * 86400000).length;
  out.push(`Lapsed in the last ${String(COVERAGE_LAPSE_WINDOW_DAYS)} days: ${String(lapses)}.`);
  return out;
}
