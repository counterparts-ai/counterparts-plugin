/**
 * `counterparts coverage [--date YYYY-MM-DD]` — what is written up, and what
 * is not yet, for one date (2026-09-30).
 *
 * Plain words for the date (default today, in the store's zone): each session
 * that captured something that date, how much of it is written up, what is
 * not yet written up (pieces, how long, since when), and whether that is owed,
 * lapsed, under the floor or still at work. Every decision is
 * `core/coverage/`'s — this file reads the ledger and prints it. Read-only:
 * the store and the buffer are opened as instruments.
 */
import { homedir } from "node:os";

import { COVERAGE_TUNABLES, lapsesSince, ledger } from "../../core/coverage/index.js";
import { dreamingSetting } from "../../core/dream/index.js";
import type { LedgerEntry } from "../../core/coverage/index.js";
import { SpanBuffer } from "../../core/remember/index.js";
import type { Store } from "../../core/store/index.js";
import { localDate, localStamp, readableDate } from "../../core/time.js";
import { catchUpOf } from "../claude-code/night-catch-up.js";
import { DESKTOP_HOST } from "../hosts.js";
import { hostOf, hostSessionEvidence, listSessions, pointable } from "../sessions.js";

/** How far back the closing line counts lapses, in days. */
export const COVERAGE_LAPSE_WINDOW_DAYS = 7;

/** Minutes as a person reads a length of time: "40 min", "2 h 10 min". */
export function lengthWords(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m)} min`;
}

function place(scopes: readonly string[]): string {
  const home = homedir();
  const shown = scopes.map((s) => (s === home || s.startsWith(`${home}/`) ? `~${s.slice(home.length)}` : s));
  return shown.join(", ");
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** What is not written up in one session, and what that means now. `person`:
 *  whether a write-up is ever asked for it (`sessions.ts#pointable`, the filter
 *  the catch-up and doctor read) — a small stretch from `claude -p` or the SDK
 *  is not. */
function standing(e: LedgerEntry, zone: string, auto: boolean, person: boolean): string {
  const s = e.stretch;
  if (s === null) return "all written up";
  const what = `not yet written up: ${plural(s.pieces, "piece", "pieces")} over ${lengthWords(s.minutes)}, since ${localStamp(s.firstAt, zone)}`;
  if (e.lapsed) {
    return `${what} — let go after ${plural(e.daysOfUseSince, "day", "days")} of use unwritten: lost to memory, no longer owed, nothing deleted`;
  }
  if (e.owed && !person) return `${what} — left to lapse (small; not known as a person's session): nothing asks for its write-up`;
  if (e.owed) {
    const why = e.state === "ended" ? "it ended" : "it has been quiet since the date changed";
    // WHO CATCHES IT UP (2026-10-11): under dreaming `auto` the nightly run
    // does, and the SessionStart pointer is retired; otherwise the next
    // session in its project is asked. The command does it now either way.
    const who = auto ? "the nightly run catches it up" : `the next session in its project is asked to write it up${e.small ? ", one line is enough" : ""}`;
    return `${what} — owed (${why}); ${who}, or counterparts catch-up now`;
  }
  if (e.state === "active") return `${what} — still at work`;
  return (
    `${what} — under the floor (${String(COVERAGE_TUNABLES.OWED_PIECES)} pieces over ` +
    `${String(COVERAGE_TUNABLES.OWED_SPAN_MS / 60_000)} min): owes nothing`
  );
}

/** The lines `counterparts coverage` prints for `date`. */
export function coverageLines(input: { store: Store; date: string; today: string }): string[] {
  const { store, date } = input;
  const zone = store.zone();
  const now = store.now();
  // READ-ONLY by construction: an observer buffer writes nothing.
  const spans = new SpanBuffer({ dir: store.dir, observer: true, now: () => now });
  const host = hostSessionEvidence(store);
  const entries = ledger(spans, { now, zone, host: (s) => ({ endedAt: host(s).endedAt }) });
  // ONE FILTER for "is a write-up ever asked for it" (2026-10-11): the one
  // the catch-up and doctor read, so this command never lists as owed what
  // they rightly let lapse.
  const persons = new Map<string, boolean>();
  const person = (e: LedgerEntry): boolean => {
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
  const out: string[] = [];
  if (on.length === 0) {
    out.push(`${said}${date === input.today ? " (today)" : ""}: nothing captured.`);
  } else {
    const pieces = on.reduce((n, e) => n + (e.perDate[date]?.pieces ?? 0), 0);
    const written = on.reduce((n, e) => n + (e.perDate[date]?.written ?? 0), 0);
    out.push(
      `${said}${date === input.today ? " (today)" : ""}: ${plural(on.length, "session", "sessions")} captured something; ` +
        `${String(written)} of ${plural(pieces, "piece", "pieces")} that day ${written === 1 ? "is" : "are"} written up.`,
    );
    for (const e of on) {
      const cell = e.perDate[date] ?? { pieces: 0, written: 0 };
      out.push(
        `  ${e.session}  ${place(e.scopes)}`,
        `    that day: ${String(cell.written)} of ${plural(cell.pieces, "piece", "pieces")} written up; now ${standing(e, zone, auto, person(e))}`,
      );
    }
  }
  // CLAUDE DESKTOP'S SESSIONS ARE UNMEASURED, NEVER LOST (2026-09-30). Nothing
  // is captured in Desktop chat — no transcript reaches this machine — so the
  // ledger above holds no stretch for them to owe or to have written up; they
  // are counted here from the registry (which keeps a week) and named as what
  // they are. What they wrote through the tools is in memory like anything else.
  const desktop = listSessions(store.dir).filter(
    (r) => hostOf(r) === DESKTOP_HOST && (localDate(r.startedAt, zone) === date || localDate(r.lastBoundaryAt, zone) === date),
  );
  if (desktop.length > 0) {
    out.push(
      `Claude Desktop: ${plural(desktop.length, "session", "sessions")} that day — unmeasured: Desktop chat keeps no transcript, so what ${desktop.length === 1 ? "it" : "they"} did not write up cannot be counted (not lost; what was written through the tools is kept).`,
    );
  }
  const owed = entries.filter((e) => e.owed && person(e));
  const lapsing = entries.filter((e) => e.owed && !person(e));
  out.push(
    "",
    owed.length === 0
      ? "Owed now: nothing."
      : `Owed now: ${plural(owed.length, "session", "sessions")} — ${owed
          .map((e) => `${e.session} (${plural(e.stretch?.pieces ?? 0, "piece", "pieces")})`)
          .join(", ")}.`,
  );
  if (lapsing.length > 0) {
    out.push(
      `Left to lapse (small; not known as a person's session): ${plural(lapsing.length, "session", "sessions")} — ${lapsing
        .map((e) => `${e.session} (${plural(e.stretch?.pieces ?? 0, "piece", "pieces")})`)
        .join(", ")}.`,
    );
  }
  // PARTS A CATCH-UP LEFT UNREAD (2026-10-11): handed to its reader and not
  // brought back — an empty answer with no reason, or never reached. They stay
  // owed, so they are in the line above too; this says why they are. Only
  // for today, or for the date that run was on: the newest run is not a
  // past date's (review of #435).
  const cu = catchUpOf(store);
  const cuDate = cu === null ? "" : localDate(cu.at, zone);
  if (cu !== null && cu.unread > 0 && (date === input.today || cuDate === date) && now - cu.at < COVERAGE_LAPSE_WINDOW_DAYS * 86_400_000) {
    out.push(`The last catch-up (${readableDate(cuDate) || cuDate}) left ${plural(cu.unread, "part", "parts")} unread; they stay owed.`);
  }
  const lapses = lapsesSince(store, now - COVERAGE_LAPSE_WINDOW_DAYS * 86_400_000).length;
  out.push(`Lapsed in the last ${String(COVERAGE_LAPSE_WINDOW_DAYS)} days: ${String(lapses)}.`);
  return out;
}
