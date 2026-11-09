/**
 * WHEN A PERSON WAS THERE, AND IN WHICH FOLDER (SO1 step 3, round 3 of #780; the
 * roadmap's ruling: one lived-day source). Read from the log's presence rows, the
 * session-start's `adapter.wake.injected`: durable, written by the wake, with its
 * `interactive` flag and the person's calendar `date`, in the store's own clock.
 * Not the session registry, which prunes a record a week after it ends and so
 * could cross a reminder a day late, or show doctor a false amber.
 *
 * Both readers use it: the crossing's lived days (`Lifecycle#plainFor`) and
 * doctor's "should it have crossed" and "was its folder there" (`fired.ts`). One
 * read by event name, bounded by the lived-day clock (a lived day is never longer
 * than a calendar day, so `days` lived days back covers at least `days` calendar
 * days). Reads only; never throws: a log that won't read is no days at all.
 */
import { WAKE_INJECTED_EVENT } from "../core/counterpart-events.js";
import type { ReadOnlyStore } from "../core/store/index.js";
import { addDays, localDate } from "../core/time.js";

/** The most rows one read takes: a busy month of session starts is a few hundred. */
const PRESENCE_ROWS = 5_000;

export interface Presence {
  /** Calendar days a person's session started, ascending. */
  readonly lived: ReadonlySet<string>;
  /** Per day, the folders those sessions were in (`projectFolder`-normalized as written), "" when the row named none. */
  readonly folders: ReadonlyMap<string, ReadonlySet<string>>;
  /** Each session's folder, as its wake row named it (absent: the row predates the field). */
  readonly sessionFolder: ReadonlyMap<string, string>;
  /** Sessions a wake row said nobody attends (for good, as doctor has always read them). */
  readonly unattended: ReadonlySet<string>;
}

export function readPresence(store: Pick<ReadOnlyStore, "eventLog" | "livedDay" | "zone">, from: string, to: string): Presence {
  const lived = new Set<string>();
  const folders = new Map<string, Set<string>>();
  const sessionFolder = new Map<string, string>();
  const unattended = new Set<string>();
  try {
    const span = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 2);
    const rows = store.eventLog({ name: WAKE_INJECTED_EVENT, sinceDay: Math.max(0, store.livedDay() - span), limit: PRESENCE_ROWS });
    const zone = store.zone();
    const seen: { date: string; session: string | null; folder: string }[] = [];
    for (const row of rows) {
      let p: Record<string, unknown> = {};
      try {
        p = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
      } catch {
        continue;
      }
      const date = typeof p["date"] === "string" && p["date"].length === 10 ? p["date"] : localDate(row.at, zone);
      const session = typeof p["session"] === "string" && p["session"].length > 0 ? p["session"] : null;
      const folder = typeof p["folder"] === "string" ? p["folder"] : "";
      if (session !== null && p["interactive"] === false) unattended.add(session);
      if (session !== null && folder.length > 0) sessionFolder.set(session, folder);
      if (p["interactive"] === false || date < from || date > to) continue;
      seen.push({ date, session, folder });
    }
    for (const r of seen) {
      if (r.session !== null && unattended.has(r.session)) continue;
      lived.add(r.date);
      let set = folders.get(r.date);
      if (set === undefined) folders.set(r.date, (set = new Set()));
      set.add(r.folder);
    }
  } catch {
    /* no days */
  }
  return { lived, folders, sessionFolder, unattended };
}

/** The window the crossing reads: its lookback and a day either side. */
export function crossingWindow(at: string, lookbackDays: number): { from: string; to: string } {
  return { from: addDays(at, -(lookbackDays + 1)), to: at };
}
