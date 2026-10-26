/**
 * THE NIGHT LINE (2026-10-25, the wake-polish builder from random-5b's 10-25
 * wake; Mike's go, lightly held): one line in the wake assembled at a session
 * start saying what last night did, so a quiet night can be told from no
 * night. The counterpart's own page says "After a dream I reflect and tell
 * Mike; a quiet night says so", and until this line the wake said nothing of
 * the night at all.
 *
 *   Last night: dream drm_… made 11 links, 1 fold and 1 feeling; reflection rfl_… rewrote the page.
 *   Last night: a quiet night — dream drm_… changed nothing; reflection rfl_… had nothing much to add.
 *   Last night: a quiet night — too little new to dream on; reflection rfl_… had nothing much to add.
 *   Last night: the nightly run is under way.
 *   The night of Oct 23: dream drm_… made 4 links; reflection rfl_… wrote an entry.
 *   The night of Oct 19 was the last to run: dream drm_… made 2 links.
 *   Last night: no night ran (last: Oct 20); dreaming is off.
 *
 * What it reads is what `counterparts night` reads (`adapters/cli/dream-core.ts`):
 * the newest dream with its change counts, the newest reflection, the latest
 * headless run's row and the dreaming setting. "Last night" is the night run
 * dated `today`, the session's date — the nightly run starts at the first
 * session of a day and is dated that day. Ids, counts and a few fixed words;
 * never the dream's journal or its title (the journal stays out of the
 * surfaces a session reads, dream CONTRACT), never a word of the reflection.
 * No model. A store that has never dreamed, reflected or run a night gets no
 * line. Pure.
 *
 * BEFORE THE DAY'S RUN, THE LATEST FINISHED NIGHT, DATED (2026-10-25, the L1
 * builder; roadmap 10-25, lightly held). The run starts at the day's first
 * prompt, after the first wake is built, so the first wake of every day read
 * "none yet today (last: …)" and what the night did showed only from the
 * second session on. Now, with no run today yet and dreaming not off, the line
 * says what the latest finished night did — a journaled dream, a reflected
 * reflection, or a run that finished with its dream skipped — under its date
 * (`nightOf`): `The night of Oct 23: …`, or, older than
 * `NIGHT_LINE_STALE_DAYS`, `The night of Oct 19 was the last to run: …`. The
 * other states stand as #623 left them: under way, did not finish, dreaming
 * off, never dreamed (no line). With no finished night among the few rows
 * read, "none yet today" stays.
 */
import { dreamSkippedOf, dreamSkippedWords, nightRunLost } from "./index.js";
import type { DreamingSetting, NightRun } from "./index.js";
import { addDays, isDay, shortDay, yearOf } from "../time.js";
import { NIGHT_LINE_HEAD, NIGHT_OF_HEAD } from "../self/briefing.js";

/** What the line reads, gathered by the caller (`Counterpart#nightLineFor`). */
export interface NightFacts {
  /** The session's date, `YYYY-MM-DD` in the store's zone. */
  readonly today: string;
  readonly now: number;
  /** The newest dream and its changes by action (`Dreams#list(1)`), or null. */
  readonly dream: NightDream | null;
  /** The newest reflection (`Reflections#list(1)`), or null. */
  readonly reflection: NightReflection | null;
  /**
   * The newest few dreams and reflections, newest first (`NIGHT_LINE_READ`;
   * L1, 2026-10-25): where the latest FINISHED night is looked for before
   * the day's run. Absent: `dream` and `reflection` alone.
   */
  readonly dreams?: readonly NightDream[];
  readonly reflections?: readonly NightReflection[];
  /** The latest headless run's row (`Dreams#nightRun`), or null. */
  readonly run: NightRun | null;
  readonly setting: DreamingSetting;
}

/** A dream as the line reads it. */
export interface NightDream {
  readonly id: string;
  readonly date: string | null;
  readonly state: string;
  readonly counts: Readonly<Record<string, number>>;
}

/** A reflection as the line reads it. */
export interface NightReflection {
  readonly id: string;
  readonly date: string | null;
  readonly state: string;
  readonly entry_id: string | null;
  readonly page_version: number | null;
}

/** The line's heads: defined beside the furniture it rides in, which reads them to take the line out. */
export { NIGHT_LINE_HEAD, NIGHT_OF_HEAD };

/** How many of the newest dreams and reflections the caller reads for the latest finished night (L1). */
export const NIGHT_LINE_READ = 7;

/**
 * **CAL.** A finished night named more than this many calendar days before
 * today is said to be the last that ran (L1, 2026-10-25: "older than ~3
 * days, say so plainly"). The usual first wake of a day names the night two
 * days back (the run stamped yesterday read the day before it), so 3 lets
 * one missed day pass unremarked.
 */
export const NIGHT_LINE_STALE_DAYS = 3;

/**
 * A dream's change, as the line says it: singular and plural. `replayed` is
 * not a change the line names — a dream replays every night — and an action
 * not here is said by its own name.
 */
const CHANGE_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  link: ["link", "links"],
  merge: ["merge", "merges"],
  fold: ["fold", "folds"],
  gist: ["gist", "gists"],
  contradiction: ["contradiction flagged", "contradictions flagged"],
  settle: ["pair settled", "pairs settled"],
  slot: ["slot", "slots"],
  "feeling-now": ["feeling", "feelings"],
  "nominate-core": ["core nomination", "core nominations"],
  "belief-candidate": ["belief proposed", "beliefs proposed"],
};

/** How many of a dream's kinds of change the line names, the most first. */
export const NIGHT_LINE_CHANGES = 3;

/** `11 links, 1 fold and 1 feeling`, or null when the dream changed nothing but replays. */
export function nightChangeWords(counts: Readonly<Record<string, number>>): string | null {
  const kinds = Object.entries(counts)
    .filter(([action, n]) => action !== "replayed" && n > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (kinds.length === 0) return null;
  const said = kinds.slice(0, NIGHT_LINE_CHANGES).map(([action, n]) => {
    const w = CHANGE_WORDS[action];
    return `${String(n)} ${w === undefined ? action : n === 1 ? w[0] : w[1]}`;
  });
  const rest = kinds.length - said.length;
  if (rest > 0) said.push(`${String(rest)} more ${rest === 1 ? "kind" : "kinds"}`);
  return said.length === 1 ? (said[0] ?? "") : `${said.slice(0, -1).join(", ")} and ${said[said.length - 1] ?? ""}`;
}

/** `2026-10-24` → `Oct 24` (its own year, so `shortDay` drops it). */
function shortDate(ymd: string): string {
  return shortDay(ymd, isDay(ymd) ? yearOf(ymd) : undefined);
}

/**
 * THE DATE A NIGHT IS NAMED BY (L1, 2026-10-25): the day it READ — the
 * calendar day before the date its rows are stamped with. The run is stamped
 * with the date of the session that started it, at that day's first prompt,
 * and dreams on what came before; the reflection's timeline reads a night the
 * same way (`reflect.ts#dayBeforeDate`), and the dashboard's "The night of
 * Jul 9" names the day the run read, not the day it was recorded
 * (`dashboard/web/views/mind.ts#WriterLine.about`). After a gap the night read
 * more than that one day; it is named by the day before its stamp all the
 * same — the store keeps no lived-day-to-date map to do better.
 */
export function nightOf(stamped: string): string {
  return isDay(stamped) ? addDays(stamped, -1) : stamped;
}

/** What one night did, in parts; `quiet` when nothing it did changed anything. Null when there is nothing to say. */
function nightParts(dream: NightDream | null, reflection: NightReflection | null, run: NightRun | null): { parts: string; quiet: boolean } | null {
  // What the dream did.
  let dreamPart: string | null = null;
  let dreamQuiet = true;
  if (dream !== null) {
    if (dream.state === "undone") dreamPart = `dream ${dream.id} was undone`;
    else if (dream.state !== "journaled") {
      dreamPart = `dream ${dream.id} was begun, not finished`;
    } else {
      const did = nightChangeWords(dream.counts);
      dreamQuiet = did === null;
      dreamPart = did === null ? `dream ${dream.id} changed nothing` : `dream ${dream.id} made ${did}`;
    }
  } else {
    const skipped = run === null ? null : dreamSkippedOf(run);
    dreamPart = skipped === null ? null : dreamSkippedWords(skipped);
  }

  // What the reflection did.
  let reflectionPart: string | null = null;
  let reflectionQuiet = true;
  if (reflection !== null) {
    if (reflection.state !== "reflected") {
      reflectionPart = `reflection ${reflection.id} was begun, not finished`;
    } else if (reflection.page_version !== null) {
      reflectionQuiet = false;
      reflectionPart = `reflection ${reflection.id} rewrote the page`;
    } else if (reflection.entry_id !== null) {
      reflectionQuiet = false;
      reflectionPart = `reflection ${reflection.id} wrote an entry`;
    } else {
      reflectionPart = `reflection ${reflection.id} had nothing much to add`;
    }
  }

  const parts = [dreamPart, reflectionPart].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const quiet = dreamQuiet && reflectionQuiet && (dream === null || dream.state === "journaled") && (reflection === null || reflection.state === "reflected");
  return { parts: parts.join("; "), quiet };
}

/** `head parts.`, or `head a quiet night — parts.` */
function sayNight(head: string, night: { readonly parts: string; readonly quiet: boolean }): string {
  return night.quiet ? `${head} a quiet night — ${night.parts}.` : `${head} ${night.parts}.`;
}

/**
 * THE LATEST FINISHED NIGHT BEFORE TODAY (L1): the newest stamp date before
 * `today` on a journaled dream, a reflected reflection, or a run that ended
 * done or partial with its dream skipped (a quiet night); then that date's
 * newest dream and reflection, whatever their state, and the run when it is
 * that date's. Null when none of the rows read is one.
 */
function latestFinished(f: NightFacts): { stamped: string; dream: NightDream | null; reflection: NightReflection | null; run: NightRun | null } | null {
  const dreams = f.dreams ?? (f.dream === null ? [] : [f.dream]);
  const reflections = f.reflections ?? (f.reflection === null ? [] : [f.reflection]);
  const before = (d: string | null | undefined): d is string => typeof d === "string" && isDay(d) && d < f.today;
  const run = f.run;
  const quietRun = run !== null && before(run.date) && (run.state === "done" || run.state === "partial") && dreamSkippedOf(run) !== null;
  const dates = [
    ...dreams.filter((d) => d.state === "journaled").map((d) => d.date),
    ...reflections.filter((r) => r.state === "reflected").map((r) => r.date),
    ...(quietRun ? [run.date] : []),
  ].filter(before);
  if (dates.length === 0) return null;
  const stamped = dates.reduce((a, b) => (b > a ? b : a));
  // A finished row before an abandoned one of the same date (review of #626:
  // a retry that journaled after one left begun is that night's dream).
  return {
    stamped,
    dream: dreams.find((d) => d.date === stamped && d.state === "journaled") ?? dreams.find((d) => d.date === stamped) ?? null,
    reflection: reflections.find((r) => r.date === stamped && r.state === "reflected") ?? reflections.find((r) => r.date === stamped) ?? null,
    run: run !== null && run.date === stamped ? run : null,
  };
}

/** The line, or null when there is no night to speak of (a store that never had one). */
export function nightLine(f: NightFacts): string | null {
  const { today, run } = f;
  const dream = f.dream?.date === today ? f.dream : null;
  const reflection = f.reflection?.date === today ? f.reflection : null;
  const runToday = run !== null && run.date === today ? run : null;
  const off = f.setting === "off" ? "; dreaming is off" : "";

  // Running now: whatever it has begun is not yet what it did.
  if (runToday !== null && runToday.state === "started" && !nightRunLost(runToday, f.now)) return `${NIGHT_LINE_HEAD} the nightly run is under way.`;
  if (dream === null && reflection === null) {
    const skipped = runToday === null ? null : dreamSkippedOf(runToday);
    if (runToday !== null && skipped !== null && (runToday.state === "done" || runToday.state === "partial")) {
      return `${NIGHT_LINE_HEAD} a quiet night — ${dreamSkippedWords(skipped)}.`;
    }
    if (runToday !== null && runToday.state !== "done" && runToday.state !== "started") {
      return `${NIGHT_LINE_HEAD} the nightly run did not finish (${runToday.state}).`;
    }
    // Today's run finished with no dream, no reflection and no skip on record
    // (review of #626): a quiet night, today's — not the night before named as
    // if today's had not run.
    if (runToday !== null && runToday.state === "done") return `${NIGHT_LINE_HEAD} a quiet night — the nightly run finished with no dream and no reflection.`;
    // Started today and past its watchdog with no word (review of #623): a
    // run that began and was lost, not a night still to come.
    if (runToday !== null && runToday.state === "started") return `${NIGHT_LINE_HEAD} the nightly run did not finish (no word from it).`;
    // Nothing tonight: when the last one was.
    const dates = [f.dream?.date, f.reflection?.date, run?.date].filter((d): d is string => typeof d === "string" && d.length > 0 && d < today).sort();
    const last = dates[dates.length - 1];
    if (last === undefined) return null;
    // Dreaming on and no run today yet: the latest FINISHED night, named by
    // the day it read (L1, 2026-10-25). Dreaming off keeps #623's line.
    if (off.length === 0 && isDay(today)) {
      const night = latestFinished(f);
      const words = night === null ? null : nightParts(night.dream, night.reflection, night.run);
      if (night !== null && words !== null) {
        const of = nightOf(night.stamped);
        const stale = of < addDays(today, -NIGHT_LINE_STALE_DAYS);
        return sayNight(`${NIGHT_OF_HEAD}${shortDate(of)}${stale ? " was the last to run" : ""}:`, words);
      }
    }
    // "Yet" promises one to come; with dreaming off none is (review of #623).
    return isDay(today) && last === addDays(today, -1) && off.length === 0
      ? `${NIGHT_LINE_HEAD} none yet today (last: ${shortDate(last)})${off}.`
      : `${NIGHT_LINE_HEAD} no night ran (last: ${shortDate(last)})${off}.`;
  }

  const night = nightParts(dream, reflection, runToday);
  return night === null ? null : sayNight(NIGHT_LINE_HEAD, night);
}
