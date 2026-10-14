import { isRecurrence, occurrenceOnOrAfter, parseCalendarDate, readableRecurrence } from "../../core/time.js";
import { AUTHOR_DIMENSIONS } from "../../core/remember/index.js";
import {
  ABOUT_MARKS,
  SAID_BY,
  STATUSES,
  checkFeelings,
  checkTraits,
  isStoreError,
  saidByOf,
  statusOf
} from "../../core/store/index.js";
const KIND_SET = { self: true, person: true, entity: true, skill: true, place: true, fact: true };
export const MEMORY_KINDS = Object.keys(KIND_SET);
export function addressBlocked(result) {
  const out = {};
  const reasons = result.path === "none" ? [result.reason] : result.perId === undefined ? result.reason === "expanded" ? [] : [result.reason] : result.perId.filter((p) => p.reason !== "expanded").map((p) => p.reason);
  for (const r of reasons)
    out[r] = (out[r] ?? 0) + 1;
  return out;
}
export function resolvedIdOf(result) {
  switch (result.reason) {
    case "expanded":
      return result.memories.length === 1 ? result.memories[0]?.id ?? null : undefined;
    case "handle-unknown":
    case "handle-ambiguous":
    case "handle-confidential-withheld":
      return null;
    default:
      return;
  }
}
export function readDimensions(rec) {
  const out = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    const v = rec[dim];
    if (v === undefined)
      continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)
      return null;
    out[dim] = v;
  }
  return out;
}
export function pickDimensions(rec) {
  const out = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    if (rec[dim] !== undefined)
      out[dim] = rec[dim];
  }
  return out;
}
const EVENT_DATE_SHAPES = 'A day "2026-10-15", a month "2026-10", a year "2026", or a range of two days "2026-10-20..2026-10-31" (first day first). Convert "late October" or "before the 15th" into one of those yourself.';
const YEAR_ALONE_NOTE = "A year alone names no day, so this will not come back on its own. Give a month, a day or a range if it should.";
const DATE_PASSED_NOTE = "That date has already passed — it won't come back as a reminder.";
export function readReminder(rec) {
  const rawDate = rec["eventDate"];
  const rawRemind = rec["remind"];
  const rawRule = rec["recurring"];
  if (rawRemind !== undefined && rawRemind !== null && rawRemind !== "plain" && rawRemind !== "quiet") {
    return { refused: "remind-unknown", detail: '`remind` is "plain" or "quiet".' };
  }
  if (rawRule !== undefined && rawRule !== null && !isRecurrence(rawRule)) {
    return { refused: "recurring-unknown", detail: RECURRING_WORDS };
  }
  const sent = {
    ...rawRemind === "plain" || rawRemind === "quiet" ? { remind: rawRemind } : {},
    ...isRecurrence(rawRule) ? { recurring: rawRule } : rawRule === null ? { recurring: null } : {}
  };
  if (rawDate === undefined || rawDate === null) {
    return {
      fields: { ...rawDate === null ? { eventDate: null } : {}, ...sent },
      remindIgnored: sent.remind !== undefined,
      recurringIgnored: isRecurrence(sent.recurring)
    };
  }
  const read = typeof rawDate === "string" ? parseCalendarDate(rawDate) : null;
  if (read === null) {
    return {
      refused: "event-date-unreadable",
      detail: `\`eventDate\` ${typeof rawDate === "string" ? `"${rawDate.slice(0, 64)}"` : "(not text)"} is not a date this can read. ${EVENT_DATE_SHAPES}`
    };
  }
  if (isRecurrence(sent.recurring) && read.precision !== "day") {
    return { refused: "recurring-needs-day", detail: RECURRING_NEEDS_DAY };
  }
  return { fields: { eventDate: read.text, ...sent }, remindIgnored: false };
}
const RECURRING_WORDS = '`recurring` is "daily", "weekly", "monthly" or "yearly", anchored on eventDate. Every other week, "the first Monday" and the like are not kept: leave it out.';
const RECURRING_NEEDS_DAY = '`recurring` repeats one day, so eventDate must be a day: the first one ("1990-05-14" for a birthday, any Monday for "every Monday").';
const RECURRING_IGNORED_NOTE = "`recurring` repeats a date; with no `eventDate` there was nothing to repeat.";
const RECURRING_DROPPED_NOTE = "Not repeating any more: only a day repeats, and this date is not one, so it comes once.";
function dateNote(eventDate, today, recurring = null) {
  if (recurring !== null) {
    const every = readableRecurrence(eventDate, recurring);
    const next = occurrenceOnOrAfter(eventDate, recurring, today);
    return { ...every === "" ? {} : { every }, ...next === null ? {} : { next: next.date } };
  }
  const read = parseCalendarDate(eventDate);
  if (read === null)
    return {};
  if (read.last < today)
    return { note: DATE_PASSED_NOTE };
  return read.precision === "year" ? { note: YEAR_ALONE_NOTE } : {};
}
export function reminderEcho(deposit, dated, today) {
  if ("refused" in dated || !deposit.deposited)
    return {};
  const carried = deposit.reminder;
  if (carried !== undefined) {
    const unmoved = carried.moved ? {} : { unmoved: true };
    if (carried.eventDate === null) {
      return {
        reminder: {
          cleared: true,
          from: carried.from,
          ...unmoved,
          note: "The date is dropped: neither this memory nor the one it revises will come back as a reminder."
        }
      };
    }
    const ruleDropped = carried.recurringDropped === true;
    return {
      reminder: {
        eventDate: carried.eventDate,
        remind: carried.remind ?? "quiet",
        ...carried.recurring === null ? {} : { recurring: carried.recurring },
        from: carried.from,
        ...carried.inherited.length > 0 ? { carriedOver: [...carried.inherited] } : {},
        ...unmoved,
        ...dateNote(carried.eventDate, today, carried.recurring),
        ...ruleDropped ? { note: RECURRING_DROPPED_NOTE } : {}
      }
    };
  }
  const { eventDate, remind, recurring } = dated.fields;
  if (typeof eventDate === "string") {
    const rule = isRecurrence(recurring) ? recurring : null;
    return {
      reminder: {
        eventDate,
        remind: remind ?? "quiet",
        ...rule === null ? {} : { recurring: rule },
        ...dateNote(eventDate, today, rule)
      }
    };
  }
  if (eventDate === null && (deposit.proposal?.updates?.declared ?? null) !== null) {
    return {
      reminder: {
        cleared: false,
        note: "No date was dropped: `updates` did not reach a dated memory by its id, so nothing was cancelled."
      }
    };
  }
  const remindNote = "`remind` shapes how a date comes back; with no `eventDate` there was nothing to shape.";
  if (dated.remindIgnored && dated.recurringIgnored === true) {
    return { reminder: { ignored: "remind, recurring", note: `${remindNote} ${RECURRING_IGNORED_NOTE}` } };
  }
  if (dated.recurringIgnored === true)
    return { reminder: { ignored: "recurring", note: RECURRING_IGNORED_NOTE } };
  return dated.remindIgnored ? { reminder: { ignored: "remind", note: remindNote } } : {};
}
const REMINDER_WORD = /\bremind\b|^\s*reminder\s*:|\bdon'?t forget\b|\bfollow[- ]up\b|\bcheck back\b/im;
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_SHAPE = new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b(?:${MONTHS})\\.? \\d{1,2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})\\b` + "|\\b\\d{1,2}(?:st|nd|rd|th)\\b|\\bin \\d+ (?:days?|weeks?|months?)\\b" + "|\\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)\\b" + "|\\b(?:january|february|march|april|june|july|august|september|october|november|december)\\b", "i");
export function readsLikeReminder(...parts) {
  const text = parts.filter((p) => typeof p === "string").join(`
`);
  return REMINDER_WORD.test(text) && DATE_SHAPE.test(text);
}
export function undatedReminderWarning(deposit, dated, title, text) {
  if ("refused" in dated || !deposit.deposited || deposit.memoryId === null)
    return {};
  if ("eventDate" in dated.fields || deposit.reminder !== undefined)
    return {};
  if (!readsLikeReminder(typeof title === "string" ? title : null, typeof text === "string" ? text : null))
    return {};
  return {
    reminderHint: `this reads like a reminder but has no eventDate, so it will never come back on a date; to make it fire, revise it with updates: ${deposit.memoryId} and an eventDate`
  };
}
export function readTraits(raw) {
  try {
    if (raw === undefined || raw === null)
      return { inputs: [] };
    if (!Array.isArray(raw))
      return { refused: "`traits` is a list of objects." };
    const inputs = [];
    for (const [i, item] of raw.entries()) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return { refused: `traits[${i}] is not an object.` };
      }
      const t = item;
      for (const key of ["axis", "toward"]) {
        if (typeof t[key] !== "string")
          return { refused: `traits[${i}].${key} is a word.` };
      }
      const carried = t["carried_by"];
      if (carried !== undefined && typeof carried !== "string")
        return { refused: `traits[${i}].carried_by is text.` };
      inputs.push({
        axis: t["axis"],
        toward: t["toward"],
        strength: t["strength"],
        ...carried === undefined ? {} : { carriedBy: carried }
      });
    }
    try {
      checkTraits(inputs);
    } catch (err) {
      if (isStoreError(err, "TRAIT_INVALID")) {
        const d = err.detail ?? {};
        const allowed = typeof d["allowed"] === "string" ? ` (one of ${d["allowed"]})` : "";
        const pole = typeof d["axisOfPole"] === "string" ? `; that word belongs to ${d["axisOfPole"]}` : "";
        return { refused: `traits[${String(d["index"])}]: ${String(d["reason"])}${allowed}${pole}.` };
      }
      throw err;
    }
    return { inputs };
  } catch (err) {
    return { refused: `traits could not be read: ${String(err.message ?? err)}` };
  }
}
export function threadOf(deposit) {
  const t = deposit.thread;
  if (t === undefined)
    return {};
  return { thread: t.closed ? { closed: t.from } : { closed: null, from: t.from, reason: t.refused ?? "not-recorded" } };
}
const OCCURRED_ON_SHAPES = 'Send it as a day "2026-09-24", a month "2026-09", a year "2026" or a range "2026-09-21..2026-09-27" — resolve "last week" or "yesterday" to one of those while you know the date.';
const OCCURRED_ON_FUTURE_NOTE = "occurredOn is in the future. It is kept, but it means when this happened; a date to be reminded on is eventDate.";
export function readWriteFacts(rec, today) {
  const sent = {};
  const dropped = [];
  const notes = [];
  const said = (v) => typeof v === "string" ? `"${v.slice(0, 64)}"` : "(not text)";
  const date = rec["occurredOn"];
  if (date === null)
    sent.occurredOn = null;
  else if (date !== undefined) {
    const read = parseCalendarDate(date);
    if (read === null) {
      dropped.push({ field: "occurredOn", note: `occurredOn ${said(date)} is not a date this can read, so the memory was kept without it. ${OCCURRED_ON_SHAPES}` });
    } else {
      sent.occurredOn = read.text;
      if (read.first > today)
        notes.push(OCCURRED_ON_FUTURE_NOTE);
    }
  }
  const by = rec["saidBy"];
  if (by === null)
    sent.saidBy = null;
  else if (by !== undefined) {
    const v = saidByOf(by);
    if (v === null)
      dropped.push({ field: "saidBy", note: `saidBy ${said(by)} is not one of ${SAID_BY.join(", ")}, so the memory was kept without it.` });
    else
      sent.saidBy = v;
  }
  const st = rec["status"];
  if (st === null)
    sent.status = null;
  else if (st !== undefined) {
    const v = statusOf(st);
    if (v === null)
      dropped.push({ field: "status", note: `status ${said(st)} is not one of ${STATUSES.join(", ")}, so the memory was kept without it.` });
    else
      sent.status = v;
  }
  return { sent, dropped, notes };
}
export function factsEcho(deposit, read) {
  const sentAny = Object.keys(read.sent).length > 0;
  if (!sentAny && read.dropped.length === 0 && deposit.facts === undefined)
    return {};
  const dropped = read.dropped.length === 0 ? {} : { dropped: read.dropped.map((d) => ({ field: d.field, note: d.note })) };
  if (!deposit.deposited)
    return { facts: { stored: false, reason: "memory-not-stored", ...dropped } };
  const f = deposit.facts;
  return {
    facts: {
      stored: true,
      ...(f?.occurredOn ?? null) === null || f === undefined ? {} : { occurredOn: f.occurredOn },
      ...(f?.saidBy ?? null) === null || f === undefined ? {} : { saidBy: f.saidBy },
      ...(f?.status ?? null) === null || f === undefined ? {} : { status: f.status },
      ...f === undefined || f.inherited.length === 0 ? {} : { carriedOver: [...f.inherited], from: f.from },
      ...dropped,
      ...read.notes.length === 0 ? {} : { note: read.notes.join(" ") }
    }
  };
}
export function readAbout(raw) {
  if (raw === undefined || raw === null)
    return { mark: null };
  if (typeof raw !== "string" || !ABOUT_MARKS.includes(raw)) {
    return { refused: `\`about\` is one of ${ABOUT_MARKS.join(", ")}.` };
  }
  return { mark: raw };
}
export function readFeelings(raw) {
  try {
    return readFeelingsOrThrow(raw);
  } catch (err) {
    return { refused: `feelings could not be read: ${String(err.message ?? err)}` };
  }
}
function readFeelingsOrThrow(raw) {
  if (raw === undefined || raw === null)
    return { inputs: [] };
  if (!Array.isArray(raw))
    return { refused: "`feelings` is a list of objects." };
  const inputs = [];
  for (const [i, item] of raw.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { refused: `feelings[${i}] is not an object.` };
    }
    const f = item;
    for (const key of ["whose", "emotion"]) {
      if (typeof f[key] !== "string")
        return { refused: `feelings[${i}].${key} is a word.` };
    }
    const core = f["core"];
    if (core !== undefined && core !== null && typeof core !== "string")
      return { refused: `feelings[${i}].core is a word.` };
    const carried = f["carried_by"];
    const other = f["other_word"];
    const valence = f["valence"];
    const strength = f["strength"];
    if (carried !== undefined && typeof carried !== "string")
      return { refused: `feelings[${i}].carried_by is text.` };
    if (other !== undefined && typeof other !== "string")
      return { refused: `feelings[${i}].other_word is a word.` };
    const beneath = f["beneath"];
    if (beneath !== undefined && beneath !== null && !(typeof beneath === "number" && Number.isInteger(beneath))) {
      return { refused: `feelings[${i}].beneath is the index of another feeling in this list.` };
    }
    inputs.push({
      whose: f["whose"],
      ...typeof core === "string" ? { core } : {},
      emotion: f["emotion"],
      ...strength === undefined || strength === null ? {} : { strength },
      ...valence === undefined || valence === null ? {} : { valence },
      ...carried === undefined ? {} : { carriedBy: carried },
      ...other === undefined ? {} : { otherWord: other },
      ...beneath === undefined || beneath === null ? {} : { beneath }
    });
  }
  try {
    checkFeelings(inputs);
  } catch (err) {
    if (isStoreError(err, "FEELING_INVALID")) {
      const d = err.detail ?? {};
      const allowed = typeof d["allowed"] === "string" ? ` (one of ${d["allowed"]})` : "";
      return { refused: `feelings[${String(d["index"])}]: ${String(d["reason"])}${allowed}.` };
    }
    throw err;
  }
  return { inputs };
}
