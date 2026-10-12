/** The MCP tools' argument readers — kinds, dimensions, reminders, feelings, traits, facts, `about` — and the echoes that say back what was read (moved out of `server.ts`, 2026-10-11). */
import type { DepositResult, SentFacts } from "../../core/counterpart.js";
import { isRecurrence, occurrenceOnOrAfter, parseCalendarDate, readableRecurrence } from "../../core/time.js";
import type { Recurrence } from "../../core/time.js";
import { AUTHOR_DIMENSIONS } from "../../core/remember/index.js";
import {
  ABOUT_MARKS,
  SAID_BY,
  STATUSES,
  checkFeelings,
  checkTraits,
  isStoreError,
  saidByOf,
  statusOf,
} from "../../core/store/index.js";
import type { AboutMark, FeelingInput, MemoryStatus, SaidBy, TraitInput } from "../../core/store/index.js";
import type { Kind } from "../../core/types.js";
import type { DeliberateResult } from "./deliberate.js";

const KIND_SET: Record<Kind, true> = { self: true, person: true, entity: true, skill: true, place: true, fact: true };

export const MEMORY_KINDS = Object.keys(KIND_SET) as readonly Kind[];

/** What one recall call's durable row says (`noteRecall`). Counts only. */
export interface RecallRowFields {
  readonly path: "handle" | "question" | "none";
  readonly reason: string;
  readonly semantic: string;
  readonly considered: number;
  readonly storeSize: number;
  readonly expanded: number;
  readonly blockedBy: Readonly<Record<string, number>>;
  readonly mode?: "facts" | "meaning";
  readonly matched?: number;
  readonly shown?: number;
  readonly faded?: number;
  readonly page?: number;
  /** A question that named a time: `window`, `event` or `session`. */
  readonly time?: string;
  /** Meaning mode's own counts (`MeaningResult.counts`). */
  readonly counts?: Readonly<Record<string, number>>;
}

/**
 * The address paths' refusals are their own `reason` — one per id on the
 * `ids` path, so three unknown ids read as three and not as one.
 */
export function addressBlocked(result: DeliberateResult): Record<string, number> {
  const out: Record<string, number> = {};
  const reasons =
    result.path === "none"
      ? [result.reason]
      : result.perId === undefined
        ? result.reason === "expanded"
          ? []
          : [result.reason]
        : result.perId.filter((p) => p.reason !== "expanded").map((p) => p.reason);
  for (const r of reasons) out[r] = (out[r] ?? 0) + 1;
  return out;
}

export function resolvedIdOf(result: DeliberateResult): string | null | undefined {
  switch (result.reason) {
    case "expanded":
      return result.memories.length === 1 ? (result.memories[0]?.id ?? null) : undefined;
    case "handle-unknown":
    case "handle-ambiguous":
    case "handle-confidential-withheld":
      return null;
    default:
      return undefined;
  }
}

/**
 * The three dimensions an author may claim, off the wire. `null` means "one of
 * them was present and unusable" — a refusal, not a silent drop, because a
 * dimension that quietly vanishes is worse than one that was never offered:
 * both leave a 0 in the row and only one of them tells anybody.
 *
 * `novelty` is deliberately not readable here. It is prediction error, computed
 * at encoding against the store's own context; an author claiming it is exactly
 * the door PR-3 closed in `remember/proposals.ts`.
 */
export function readDimensions(rec: Record<string, unknown>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    const v = rec[dim];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return null;
    out[dim] = v;
  }
  return out;
}

/** The unvalidated read, used only where the refusal must be per-entry: the
 *  values ride to `remember/intake`, which refuses that entry by name. */
export function pickDimensions(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    if (rec[dim] !== undefined) out[dim] = rec[dim];
  }
  return out;
}

// ── a reminder date on a tool call (2026-09-26) ─────────────────────────────

/** What `readReminder` hands back: the draft fields, and what to say about them. */
export type ReminderRead =
  | {
      /** `eventDate: null` is the explicit drop (a revision's cancel); `remind`
       *  rides only when it was SENT, so a revision can tell a left-out mode
       *  from a stated one (review N7). */
      readonly fields: { eventDate?: string | null; remind?: "plain" | "quiet"; recurring?: Recurrence | null };
      /** `remind` was sent with no `eventDate`: there is nothing for it to shape
       *  — unless the memory it revises carries a date (`DepositResult.reminder`). */
      readonly remindIgnored: boolean;
      /** `recurring` was sent with no `eventDate` (2026-10-09): nothing to repeat
       *  — unless the memory it revises carries a date. */
      readonly recurringIgnored?: boolean;
    }
  | {
      readonly refused: "event-date-unreadable" | "remind-unknown" | "recurring-unknown" | "recurring-needs-day";
      readonly detail: string;
    };

const EVENT_DATE_SHAPES =
  'A day "2026-10-15", a month "2026-10", a year "2026", or a range of two days "2026-10-20..2026-10-31" (first day first). Convert "late October" or "before the 15th" into one of those yourself.';

const YEAR_ALONE_NOTE =
  "A year alone names no day, so this will not come back on its own. Give a month, a day or a range if it should.";

/** Review N8 (2026-09-26): a past date is accepted and kept, and SAID — so a
 *  wrong year can be caught by the model that wrote it. */
const DATE_PASSED_NOTE = "That date has already passed — it won't come back as a reminder.";

/**
 * `eventDate` and `remind` off a `remember` or a `session_end` entry, CHECKED
 * before anything mints: the date by `time.ts` (the one module that reads
 * dates), `remind` against its two words. Never a date parsed from prose — the
 * model writes the field (owner decision 2026-09-25/26).
 */
export function readReminder(rec: Record<string, unknown>): ReminderRead {
  const rawDate = rec["eventDate"];
  const rawRemind = rec["remind"];
  const rawRule = rec["recurring"];
  if (rawRemind !== undefined && rawRemind !== null && rawRemind !== "plain" && rawRemind !== "quiet") {
    return { refused: "remind-unknown", detail: '`remind` is "plain" or "quiet".' };
  }
  // HOW OFTEN (2026-10-09): one of four words, refused by name like a date.
  if (rawRule !== undefined && rawRule !== null && !isRecurrence(rawRule)) {
    return { refused: "recurring-unknown", detail: RECURRING_WORDS };
  }
  const sent: { remind?: "plain" | "quiet"; recurring?: Recurrence | null } = {
    ...(rawRemind === "plain" || rawRemind === "quiet" ? { remind: rawRemind } : {}),
    // `null` rides as sent: a revision's "it no longer repeats".
    ...(isRecurrence(rawRule) ? { recurring: rawRule } : rawRule === null ? { recurring: null } : {}),
  };
  if (rawDate === undefined || rawDate === null) {
    return {
      fields: { ...(rawDate === null ? { eventDate: null } : {}), ...sent },
      remindIgnored: sent.remind !== undefined,
      recurringIgnored: isRecurrence(sent.recurring),
    };
  }
  const read = typeof rawDate === "string" ? parseCalendarDate(rawDate) : null;
  if (read === null) {
    return {
      refused: "event-date-unreadable",
      detail: `\`eventDate\` ${typeof rawDate === "string" ? `"${rawDate.slice(0, 64)}"` : "(not text)"} is not a date this can read. ${EVENT_DATE_SHAPES}`,
    };
  }
  if (isRecurrence(sent.recurring) && read.precision !== "day") {
    return { refused: "recurring-needs-day", detail: RECURRING_NEEDS_DAY };
  }
  return { fields: { eventDate: read.text, ...sent }, remindIgnored: false };
}

const RECURRING_WORDS =
  '`recurring` is "daily", "weekly", "monthly" or "yearly", anchored on eventDate. Every other week, "the first Monday" and the like are not kept: leave it out.';

const RECURRING_NEEDS_DAY =
  '`recurring` repeats one day, so eventDate must be a day: the first one ("1990-05-14" for a birthday, any Monday for "every Monday").';

const RECURRING_IGNORED_NOTE = "`recurring` repeats a date; with no `eventDate` there was nothing to repeat.";

const RECURRING_DROPPED_NOTE = "Not repeating any more: only a day repeats, and this date is not one, so it comes once.";

/** What to say about a recorded date: that it has already passed (its last day
 *  is before the person's today — `time.ts#todayIn` in the store's zone), or
 *  that a year alone never comes back. One note, the passed one first. */
function dateNote(eventDate: string, today: string, recurring: Recurrence | null = null): Record<string, unknown> {
  // A REPEATING date never "has passed" (2026-10-09): a birthday anchored in
  // 1990 comes round every year. Said instead: how often, and when next.
  if (recurring !== null) {
    const every = readableRecurrence(eventDate, recurring);
    const next = occurrenceOnOrAfter(eventDate, recurring, today);
    return { ...(every === "" ? {} : { every }), ...(next === null ? {} : { next: next.date }) };
  }
  const read = parseCalendarDate(eventDate);
  if (read === null) return {};
  if (read.last < today) return { note: DATE_PASSED_NOTE };
  return read.precision === "year" ? { note: YEAR_ALONE_NOTE } : {};
}

/** The reminder half of a deposit's answer: what was RECORDED — after a
 *  revision's carry-over, not merely what was sent — or why `remind` had
 *  nothing to shape. Nothing when neither field was sent or nothing minted. */
export function reminderEcho(deposit: DepositResult, dated: ReminderRead, today: string): Record<string, unknown> {
  if ("refused" in dated || !deposit.deposited) return {};
  const carried = deposit.reminder;
  if (carried !== undefined) {
    const unmoved = carried.moved ? {} : { unmoved: true };
    if (carried.eventDate === null) {
      return {
        reminder: {
          cleared: true,
          from: carried.from,
          ...unmoved,
          note: "The date is dropped: neither this memory nor the one it revises will come back as a reminder.",
        },
      };
    }
    // A repeat — sent or carried — that the new date cannot take (a month or a
    // range does not repeat) is SAID, never silently lost.
    const ruleDropped = carried.recurringDropped === true;
    return {
      reminder: {
        eventDate: carried.eventDate,
        remind: carried.remind ?? "quiet",
        ...(carried.recurring === null ? {} : { recurring: carried.recurring }),
        from: carried.from,
        ...(carried.inherited.length > 0 ? { carriedOver: [...carried.inherited] } : {}),
        ...unmoved,
        ...dateNote(carried.eventDate, today, carried.recurring),
        ...(ruleDropped ? { note: RECURRING_DROPPED_NOTE } : {}),
      },
    };
  }
  const { eventDate, remind, recurring } = dated.fields;
  if (typeof eventDate === "string") {
    const rule = isRecurrence(recurring) ? recurring : null;
    return {
      reminder: {
        eventDate,
        remind: remind ?? "quiet",
        ...(rule === null ? {} : { recurring: rule }),
        ...dateNote(eventDate, today, rule),
      },
    };
  }
  // A cancel that found nothing to cancel is SAID (review of #247): silence
  // here read as success while a reminder the model meant to drop kept coming.
  if (eventDate === null && (deposit.proposal?.updates?.declared ?? null) !== null) {
    return {
      reminder: {
        cleared: false,
        note: "No date was dropped: `updates` did not reach a dated memory by its id, so nothing was cancelled.",
      },
    };
  }
  const remindNote = "`remind` shapes how a date comes back; with no `eventDate` there was nothing to shape.";
  if (dated.remindIgnored && dated.recurringIgnored === true) {
    return { reminder: { ignored: "remind, recurring", note: `${remindNote} ${RECURRING_IGNORED_NOTE}` } };
  }
  if (dated.recurringIgnored === true) return { reminder: { ignored: "recurring", note: RECURRING_IGNORED_NOTE } };
  return dated.remindIgnored ? { reminder: { ignored: "remind", note: remindNote } } : {};
}

// ── an undated reminder, said at write time (2026-10-12) ────────────────────

const REMINDER_WORD = /\bremind\b|^\s*reminder\s*:|\bdon'?t forget\b|\bfollow[- ]up\b|\bcheck back\b/im;
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_SHAPE = new RegExp(
  `\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b(?:${MONTHS})\\.? \\d{1,2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})\\b` +
    "|\\b\\d{1,2}(?:st|nd|rd|th)\\b|\\bin \\d+ (?:days?|weeks?|months?)\\b" +
    "|\\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)\\b" +
    "|\\b(?:january|february|march|april|june|july|august|september|october|november|december)\\b",
  "i",
);

/** Whether a title or text reads like a reminder: a reminder word AND a date
 *  shape. A heuristic for a WARNING only — the engine never reads a date out
 *  of the text (the 09-25 rule). */
export function readsLikeReminder(...parts: readonly (string | null | undefined)[]): boolean {
  const text = parts.filter((p): p is string => typeof p === "string").join("\n");
  return REMINDER_WORD.test(text) && DATE_SHAPE.test(text);
}

/** What to tell a writer whose stored entry reads like a reminder but carries
 *  no `eventDate` (a dated reminder only ever fires from that field). Nothing
 *  when a date was sent or cleared, or a revision carried one over. Never
 *  sets or guesses the date, never refuses. */
export function undatedReminderWarning(deposit: DepositResult, dated: ReminderRead, title: unknown, text: unknown): Record<string, unknown> {
  if ("refused" in dated || !deposit.deposited || deposit.memoryId === null) return {};
  if ("eventDate" in dated.fields || deposit.reminder !== undefined) return {};
  if (!readsLikeReminder(typeof title === "string" ? title : null, typeof text === "string" ? text : null)) return {};
  return {
    reminderHint: `this reads like a reminder but has no eventDate, so it will never come back on a date; to make it fire, revise it with updates: ${deposit.memoryId} and an eventDate`,
  };
}

// ── feelings on a tool call (schema v7) ─────────────────────────────────────

export type FeelingsRead = { inputs: FeelingInput[] } | { refused: string };

export type AboutRead = { mark: AboutMark | null } | { refused: string };

export type TraitsRead = { inputs: TraitInput[] } | { refused: string };

/**
 * `traits: [{ axis, toward, strength, carried_by? }]` off a `remember` or a
 * `session_end` entry (folded into v9), read and CHECKED before anything
 * mints (`store/traits.ts#checkTraits`, pure). Absent is none; an unknown
 * axis or pole is a refusal that names the item, the reason and what is
 * allowed. Any throw is this entry's refusal, never the call's.
 */
export function readTraits(raw: unknown): TraitsRead {
  try {
    if (raw === undefined || raw === null) return { inputs: [] };
    if (!Array.isArray(raw)) return { refused: "`traits` is a list of objects." };
    const inputs: TraitInput[] = [];
    for (const [i, item] of raw.entries()) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return { refused: `traits[${i}] is not an object.` };
      }
      const t = item as Record<string, unknown>;
      for (const key of ["axis", "toward"] as const) {
        if (typeof t[key] !== "string") return { refused: `traits[${i}].${key} is a word.` };
      }
      const carried = t["carried_by"];
      if (carried !== undefined && typeof carried !== "string") return { refused: `traits[${i}].carried_by is text.` };
      inputs.push({
        axis: t["axis"] as string,
        toward: t["toward"] as string,
        strength: t["strength"] as number,
        ...(carried === undefined ? {} : { carriedBy: carried }),
      });
    }
    try {
      checkTraits(inputs);
    } catch (err) {
      if (isStoreError(err, "TRAIT_INVALID")) {
        const d = (err as { detail?: Record<string, unknown> }).detail ?? {};
        const allowed = typeof d["allowed"] === "string" ? ` (one of ${d["allowed"]})` : "";
        const pole = typeof d["axisOfPole"] === "string" ? `; that word belongs to ${d["axisOfPole"]}` : "";
        return { refused: `traits[${String(d["index"])}]: ${String(d["reason"])}${allowed}${pole}.` };
      }
      throw err;
    }
    return { inputs };
  } catch (err) {
    return { refused: `traits could not be read: ${String((err as Error).message ?? err)}` };
  }
}

/** `about` on a tool call (schema v9): absent, or one of the five marks. */
/**
 * The open thread a deposit closed (`DepositResult.thread`, 2026-10-01), as a
 * result carries it: `thread: { closed: <the id it updates> }`, or the reason
 * the clear did not land. Nothing when no thread was closed.
 */
export function threadOf(deposit: DepositResult): Record<string, unknown> {
  const t = deposit.thread;
  if (t === undefined) return {};
  return { thread: t.closed ? { closed: t.from } : { closed: null, from: t.from, reason: t.refused ?? "not-recorded" } };
}

/**
 * v12 (2026-10-03): THE WRITER'S THREE FIELDS off a `remember` or a
 * `session_end` entry — `occurredOn` (when it happened: read by `time.ts`,
 * the one module that reads dates), `saidBy` and `status` (against their
 * words). LOOSE FIRST: nothing here refuses the memory. What cannot be read
 * is dropped and said (`dropped`, with what to send instead); null is sent
 * as none (a revision carries nothing over for it); absent is not sent.
 * A date in the future is kept, and a note says that a date to be reminded
 * on is `eventDate`.
 */
export interface FactsRead {
  readonly sent: SentFacts;
  readonly dropped: readonly { readonly field: string; readonly note: string }[];
  readonly notes: readonly string[];
}

const OCCURRED_ON_SHAPES =
  'Send it as a day "2026-09-24", a month "2026-09", a year "2026" or a range "2026-09-21..2026-09-27" — resolve "last week" or "yesterday" to one of those while you know the date.';

const OCCURRED_ON_FUTURE_NOTE =
  "occurredOn is in the future. It is kept, but it means when this happened; a date to be reminded on is eventDate.";

export function readWriteFacts(rec: Record<string, unknown>, today: string): FactsRead {
  const sent: { occurredOn?: string | null; saidBy?: SaidBy | null; status?: MemoryStatus | null } = {};
  const dropped: { field: string; note: string }[] = [];
  const notes: string[] = [];
  const said = (v: unknown): string => (typeof v === "string" ? `"${v.slice(0, 64)}"` : "(not text)");
  const date = rec["occurredOn"];
  if (date === null) sent.occurredOn = null;
  else if (date !== undefined) {
    const read = parseCalendarDate(date);
    if (read === null) {
      dropped.push({ field: "occurredOn", note: `occurredOn ${said(date)} is not a date this can read, so the memory was kept without it. ${OCCURRED_ON_SHAPES}` });
    } else {
      sent.occurredOn = read.text;
      if (read.first > today) notes.push(OCCURRED_ON_FUTURE_NOTE);
    }
  }
  const by = rec["saidBy"];
  if (by === null) sent.saidBy = null;
  else if (by !== undefined) {
    const v = saidByOf(by);
    if (v === null) dropped.push({ field: "saidBy", note: `saidBy ${said(by)} is not one of ${SAID_BY.join(", ")}, so the memory was kept without it.` });
    else sent.saidBy = v;
  }
  const st = rec["status"];
  if (st === null) sent.status = null;
  else if (st !== undefined) {
    const v = statusOf(st);
    if (v === null) dropped.push({ field: "status", note: `status ${said(st)} is not one of ${STATUSES.join(", ")}, so the memory was kept without it.` });
    else sent.status = v;
  }
  return { sent, dropped, notes };
}

/** The three fields' half of a deposit's answer (v12): what was RECORDED —
 *  after a revision's carry-over — what was carried and from where, and what
 *  was dropped and why. Nothing when nothing was sent, dropped or carried. */
export function factsEcho(deposit: DepositResult, read: FactsRead): Record<string, unknown> {
  const sentAny = Object.keys(read.sent).length > 0;
  if (!sentAny && read.dropped.length === 0 && deposit.facts === undefined) return {};
  const dropped = read.dropped.length === 0 ? {} : { dropped: read.dropped.map((d) => ({ field: d.field, note: d.note })) };
  if (!deposit.deposited) return { facts: { stored: false, reason: "memory-not-stored", ...dropped } };
  const f = deposit.facts;
  return {
    facts: {
      stored: true,
      ...((f?.occurredOn ?? null) === null || f === undefined ? {} : { occurredOn: f.occurredOn }),
      ...((f?.saidBy ?? null) === null || f === undefined ? {} : { saidBy: f.saidBy }),
      ...((f?.status ?? null) === null || f === undefined ? {} : { status: f.status }),
      ...(f === undefined || f.inherited.length === 0 ? {} : { carriedOver: [...f.inherited], from: f.from }),
      ...dropped,
      ...(read.notes.length === 0 ? {} : { note: read.notes.join(" ") }),
    },
  };
}

export function readAbout(raw: unknown): AboutRead {
  if (raw === undefined || raw === null) return { mark: null };
  if (typeof raw !== "string" || !(ABOUT_MARKS as readonly string[]).includes(raw)) {
    return { refused: `\`about\` is one of ${ABOUT_MARKS.join(", ")}.` };
  }
  return { mark: raw as AboutMark };
}

/**
 * `feelings: [{ whose, core?, emotion, strength?, valence?, carried_by, beneath?, other_word? }]`
 * off a `remember` or a `session_end` entry, read and CHECKED before anything
 * mints (`store/feelings.ts#checkFeelings`, pure). `beneath` is another
 * feeling's index in the same list. Absent is no feelings; anything that will
 * not store is a refusal naming the item and the reason.
 */
export function readFeelings(raw: unknown): FeelingsRead {
  // ANY throw is this entry's refusal, never the call's (review S2): a
  // `session_end` carries siblings that must still land.
  try {
    return readFeelingsOrThrow(raw);
  } catch (err) {
    return { refused: `feelings could not be read: ${String((err as Error).message ?? err)}` };
  }
}

function readFeelingsOrThrow(raw: unknown): FeelingsRead {
  if (raw === undefined || raw === null) return { inputs: [] };
  if (!Array.isArray(raw)) return { refused: "`feelings` is a list of objects." };
  const inputs: FeelingInput[] = [];
  for (const [i, item] of raw.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { refused: `feelings[${i}] is not an object.` };
    }
    const f = item as Record<string, unknown>;
    for (const key of ["whose", "emotion"] as const) {
      if (typeof f[key] !== "string") return { refused: `feelings[${i}].${key} is a word.` };
    }
    // v11: `core` may be left out (the word's own core), and `strength` and
    // `valence` too (the word's defaults).
    const core = f["core"];
    if (core !== undefined && core !== null && typeof core !== "string") return { refused: `feelings[${i}].core is a word.` };
    const carried = f["carried_by"];
    const other = f["other_word"];
    const valence = f["valence"];
    const strength = f["strength"];
    if (carried !== undefined && typeof carried !== "string") return { refused: `feelings[${i}].carried_by is text.` };
    if (other !== undefined && typeof other !== "string") return { refused: `feelings[${i}].other_word is a word.` };
    // AT THE DOOR, `beneath` is an INDEX into this list and nothing else (review
    // S3): an id would only be checked after the memory minted, so feelings
    // would stop being all-or-nothing with their entry.
    const beneath = f["beneath"];
    if (beneath !== undefined && beneath !== null && !(typeof beneath === "number" && Number.isInteger(beneath))) {
      return { refused: `feelings[${i}].beneath is the index of another feeling in this list.` };
    }
    inputs.push({
      whose: f["whose"] as string,
      ...(typeof core === "string" ? { core } : {}),
      emotion: f["emotion"] as string,
      ...(strength === undefined || strength === null ? {} : { strength: strength as number }),
      ...(valence === undefined || valence === null ? {} : { valence: valence as number }),
      ...(carried === undefined ? {} : { carriedBy: carried }),
      ...(other === undefined ? {} : { otherWord: other }),
      ...(beneath === undefined || beneath === null ? {} : { beneath: beneath as number }),
    });
  }
  try {
    checkFeelings(inputs);
  } catch (err) {
    if (isStoreError(err, "FEELING_INVALID")) {
      const d = (err as { detail?: Record<string, unknown> }).detail ?? {};
      const allowed = typeof d["allowed"] === "string" ? ` (one of ${d["allowed"]})` : "";
      return { refused: `feelings[${String(d["index"])}]: ${String(d["reason"])}${allowed}.` };
    }
    throw err;
  }
  return { inputs };
}
