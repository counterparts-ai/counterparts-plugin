import { isKnownSession } from "../types.js";
import { strength } from "../physics/index.js";
import { RECURRING_META } from "../store/index.js";
import { addDays, daysBetween, isDay, isRecurrence, occurrenceBetween } from "../time.js";
import { derive } from "./derive.js";
import { TEMPORAL_MAX_TIER, withTunables } from "./tunables.js";
import { imminence, parseWindowKey, phaseOf, precisionOf, rampAt, recurringWindowAt, windowFor } from "./windows.js";

export * from "./derive.js";
export * from "./tunables.js";
export * from "./windows.js";
export const PROSPECTIVE_FIRE_EVENT = "prospective.fire";
export const PROSPECTIVE_REFUSED_EVENT = "prospective.fire.refused";
export const PROSPECTIVE_PLAIN_EVENT = "prospective.plain";
export const CUE_MODE_META = "remind";
export function cueModeOf(doc) {
  return doc.meta[CUE_MODE_META] === "plain" ? "plain" : "quiet";
}
export function plainDueOn(item, at) {
  if (item.mode !== "plain" || item.eventDate === undefined || !isDay(item.eventDate) || !isDay(at))
    return false;
  return item.eventDate === at || item.eventDate === addDays(at, 1);
}
export function byArrivingOrder(at) {
  const tier = (x) => plainDueOn(x, at) ? 0 : x.mode === "plain" ? 1 : 2;
  const away = (x) => {
    const d = isDay(x.eventDate) && isDay(at) ? daysBetween(at, x.eventDate) : Number.POSITIVE_INFINITY;
    return Math.abs(d);
  };
  return (a, b) => tier(a) - tier(b) || away(a) - away(b);
}

export { RECURRING_META };
export function recurrenceOf(doc) {
  const rule = doc.meta?.[RECURRING_META];
  return isRecurrence(rule) && isDay(doc.eventDate) ? rule : null;
}
export const DATE_FROM_META = "reminderFrom";
export const DATE_MOVED_TO_META = "reminderMovedTo";
export const DATE_LINEAGE_MAX = 16;
const WINDOW_STATES = ["armed", "fired", "suppressed", "expired"];
export function windowStateOf(row) {
  const s = row?.state;
  return WINDOW_STATES.find((x) => x === s) ?? "armed";
}
const CUE_ONLY_BRAKES = new Set([
  "over-fired",
  "already-fired-today",
  "held-for-after",
  "told-plainly-today",
  "session-dedup"
]);
export function contentDates(doc) {
  const v = doc.eventDate;
  if (typeof v !== "string" || v === "")
    return [];
  const rule = recurrenceOf(doc);
  return [rule === null ? { date: v } : { date: v, recurring: rule }];
}
function recurringIn(store, from, to) {
  return store.recurringMemories().filter((r) => occurrenceBetween(r.eventDate, r.recurring, from, to) !== null).map((r) => r.id);
}
function candidateSpan(at, t) {
  if (!isDay(at))
    return null;
  return { from: addDays(at, -t.GRACE_DAYS), to: addDays(at, t.LEAD_DAYS) };
}
const TIE = 0.000000001;

export class Prospective {
  store;
  tunables;
  observer;
  onEvent;
  now;
  ring = [];
  sessionFired = new Map;
  constructor(opts) {
    this.store = opts.store;
    this.tunables = withTunables(opts.tunables ?? {});
    this.observer = opts.store.observer;
    this.onEvent = opts.onEvent;
    this.now = opts.now ?? (() => Date.now());
  }
  derive(memory, dates, at) {
    return derive(memory, dates, at, this.tunables);
  }
  deriveFor(memoryId, at, extra = [], day) {
    const loaded = this.load(memoryId, extra, day ?? this.store.livedDay());
    if (loaded === null)
      return null;
    return derive(loaded.memory, loaded.dates, at, this.tunables);
  }
  arrivals(input) {
    return this.arrive(input, false);
  }
  arrive(input, lane) {
    const day = input.day ?? this.store.livedDay();
    const arrivals = [];
    const suppressed = [];
    const refused = [];
    const denied = new Set(this.store.deniedIds());
    const span = candidateSpan(input.at, this.tunables);
    const ids = new Set(span === null ? [] : this.store.datedMemories(span.from, span.to).map((d) => d.id));
    if (span !== null)
      for (const id of recurringIn(this.store, span.from, span.to))
        ids.add(id);
    for (const id of input.extraDates?.keys() ?? [])
      ids.add(id);
    let considered = 0;
    const order = new Map;
    for (const id of ids) {
      if (denied.has(id))
        continue;
      const row = this.store.row(id);
      if (row === undefined || row.superseded_by !== null)
        continue;
      const loaded = this.load(id, input.extraDates?.get(id) ?? [], day);
      if (loaded === null)
        continue;
      considered += 1;
      const p = derive(loaded.memory, loaded.dates, input.at, this.tunables);
      if (!p.eligible) {
        refused.push({ memoryId: id, reason: p.reason });
        continue;
      }
      const rows = this.firingRowsFor(id);
      const mode = cueModeOf(loaded.doc);
      const toldToday = !lane && mode === "plain" && this.plainToldOn(id, input.at);
      for (const w of p.windows) {
        const stateRow = rows.get(w.key);
        const braked = this.brakeFor(w, stateRow, {
          at: input.at,
          day,
          refractory: input.refractory === true,
          sessionId: input.sessionId
        }) ?? (toldToday ? "told-plainly-today" : null);
        const pastQuiet = mode !== "plain" && w.precision === "day" && isDay(w.eventDate) && isDay(input.at) && w.eventDate < input.at;
        const brake = lane && !pastQuiet && braked !== null && CUE_ONLY_BRAKES.has(braked) ? null : braked;
        if (brake !== null) {
          suppressed.push({ memoryId: id, windowKey: w.key, reason: brake });
          continue;
        }
        const ramp = rampAt(w, input.at, this.tunables);
        arrivals.push({
          memoryId: id,
          windowKey: w.key,
          eventDate: w.eventDate,
          precision: w.precision,
          opensOn: w.opensOn,
          peakOn: w.peakOn,
          closesOn: w.closesOn,
          ramp,
          cueWeight: this.tunables.CUE_STRENGTH * ramp,
          maxTier: TEMPORAL_MAX_TIER,
          state: windowStateOf(stateRow),
          fires: stateRow?.fires ?? 0,
          lastFiredDay: stateRow?.last_fired_day ?? null,
          strength: loaded.strength,
          mode,
          ...w.anchor === undefined || w.recurring === undefined ? {} : { anchor: w.anchor, recurring: w.recurring }
        });
        order.set(`${id} ${w.key}`, imminence(w, input.at));
      }
    }
    const soon = (a) => order.get(`${a.memoryId} ${a.windowKey}`) ?? [0, 0];
    arrivals.sort((a, b) => {
      const d = b.ramp * b.strength - a.ramp * a.strength;
      if (Math.abs(d) > TIE)
        return d;
      const [au, aw] = soon(a);
      const [bu, bw] = soon(b);
      if (au !== bu)
        return au - bu;
      if (aw !== bw)
        return aw - bw;
      return a.windowKey < b.windowKey ? -1 : a.windowKey > b.windowKey ? 1 : a.memoryId < b.memoryId ? -1 : 1;
    });
    for (const s of suppressed) {
      if (s.reason === "window-not-open")
        continue;
      this.emit("prospective.suppressed", s.memoryId, {
        window: s.windowKey,
        reason: s.reason,
        day
      });
    }
    this.emit("prospective.arrivals", undefined, {
      day,
      considered,
      arrived: arrivals.length,
      suppressed: suppressed.length,
      refused: refused.length,
      observer: this.observer
    });
    return { at: input.at, day, observer: this.observer, arrivals, suppressed, considered, refused };
  }
  horizon(input) {
    const considered = this.arrive(input, true);
    if (input.previousSessionHighAffect === true) {
      this.emit("prospective.horizon", undefined, {
        reason: "high-affect-previous-session",
        items: 0,
        arrived: considered.arrivals.length
      });
      return {
        items: [],
        more: [],
        reason: "high-affect-previous-session",
        suppressedWholesale: true,
        considered
      };
    }
    const excluded = { notDay: [], daily: [], told: [] };
    const offered = considered.arrivals.filter((a) => {
      if (a.precision !== "day")
        excluded.notDay.push(a.memoryId);
      else if (a.recurring === "daily")
        excluded.daily.push(a.memoryId);
      else if (this.toldForGood(a, input.at))
        excluded.told.push(a.memoryId);
      else
        return true;
      return false;
    });
    if (excluded.notDay.length + excluded.daily.length + excluded.told.length > 0) {
      this.emit("prospective.horizon.excluded", undefined, {
        notDay: excluded.notDay.length,
        daily: excluded.daily.length,
        told: excluded.told.length,
        notDayIds: excluded.notDay.join(","),
        dailyIds: excluded.daily.join(","),
        toldIds: excluded.told.join(",")
      });
    }
    const ordered = [...offered].sort(byArrivingOrder(input.at));
    const items = ordered.slice(0, this.tunables.HORIZON_ITEMS);
    const more = ordered.slice(items.length);
    const reason = items.length === 0 ? "nothing-arrived" : "selected";
    this.emit("prospective.horizon", undefined, {
      reason,
      items: items.length,
      more: more.length,
      arrived: considered.arrivals.length,
      ids: items.map((i) => i.memoryId).join(",")
    });
    return { items, more, reason, suppressedWholesale: false, considered };
  }
  plainDue(input) {
    if (this.observer || !isDay(input.at))
      return [];
    const at = input.at;
    const denied = new Set(this.store.deniedIds());
    const out = [];
    const due = [];
    const repeating = new Set;
    for (const r of this.store.recurringMemories()) {
      repeating.add(r.id);
      const occurrence = occurrenceBetween(r.eventDate, r.recurring, at, at);
      if (occurrence !== null) {
        due.push({ id: r.id, eventDate: occurrence });
        continue;
      }
      const last = recurringWindowAt(r.eventDate, r.recurring, at, this.tunables, r.id);
      if (last !== null && last.eventDate < at && at <= last.closesOn) {
        due.push({ id: r.id, eventDate: last.eventDate, lateUntil: last.closesOn });
      }
    }
    for (const d of this.store.datedMemories(at, at))
      if (!repeating.has(d.id))
        due.push(d);
    for (const d of this.store.datedMemories(addDays(at, -this.tunables.GRACE_DAYS), addDays(at, -1))) {
      if (repeating.has(d.id) || !isDay(d.eventDate))
        continue;
      due.push({ ...d, lateUntil: addDays(d.eventDate, this.tunables.GRACE_DAYS) });
    }
    for (const dated of due) {
      const id = dated.id;
      if (denied.has(id))
        continue;
      const row = this.store.row(id);
      if (row === undefined || row.superseded_by !== null)
        continue;
      let doc;
      try {
        doc = this.store.read(id).doc;
      } catch {
        continue;
      }
      if (doc.type === "episode" || cueModeOf(doc) !== "plain")
        continue;
      const precision = precisionOf(dated.eventDate);
      if (precision === null || precision === "year")
        continue;
      const w = windowFor(dated.eventDate, precision, this.tunables, id);
      if (w === null)
        continue;
      const late = dated.lateUntil !== undefined;
      if (late) {
        const written = doc.learnedOn.slice(0, 10);
        if (w.precision !== "day" || at <= w.lastDay || at > dated.lateUntil)
          continue;
        if (!isDay(written) || written > w.eventDate)
          continue;
      } else if (at < w.firstDay || at > w.lastDay)
        continue;
      const beat = w.precision === "day" ? "day" : at === w.lastDay ? "last-day" : "opens";
      if (this.plainTold(id, w.key, beat))
        continue;
      out.push({
        memoryId: id,
        windowKey: w.key,
        eventDate: w.eventDate,
        precision: w.precision,
        beat,
        firstDay: w.firstDay,
        lastDay: w.lastDay,
        ...late ? { late: true } : {}
      });
    }
    return [...out.filter((d) => d.late !== true), ...out.filter((d) => d.late === true)];
  }
  claimPlain(due, opts) {
    if (this.observer)
      return false;
    const day = opts.day ?? this.store.livedDay();
    try {
      const seq = this.store.appendEvent({
        name: PROSPECTIVE_PLAIN_EVENT,
        day,
        ref: due.memoryId,
        payload: {
          window: due.windowKey,
          beat: due.beat,
          precision: due.precision,
          date: opts.at,
          mode: "plain",
          ...due.late === true ? { late: true } : {},
          ...isKnownSession(opts.session) ? { session: opts.session } : {}
        },
        dedupKey: `${PROSPECTIVE_PLAIN_EVENT}:${due.memoryId}:${due.windowKey}:${due.beat}`
      });
      if (seq > 0) {
        this.emit("prospective.plain", due.memoryId, { window: due.windowKey, beat: due.beat, day });
      }
      return seq > 0;
    } catch {
      return false;
    }
  }
  occurrenceUndelivered(memoryId, windowKey) {
    if (this.observer)
      return false;
    try {
      if (recurrenceOf(this.store.read(memoryId).doc) === null)
        return false;
      if ((this.firingRowsFor(memoryId).get(windowKey)?.fires ?? 0) > 0)
        return false;
      return !this.plainTold(memoryId, windowKey, "day");
    } catch {
      return false;
    }
  }
  toldForGood(a, at) {
    if (a.mode !== "plain")
      return false;
    if (a.precision === "day" && isDay(a.eventDate) && isDay(at) && a.eventDate >= at)
      return false;
    return this.plainTold(a.memoryId, a.windowKey, a.precision === "day" ? "day" : "last-day");
  }
  plainTold(memoryId, windowKey, beat) {
    for (const id of this.lineage(memoryId)) {
      for (const e of this.plainRows(id)) {
        if (e.dedup_key === `${PROSPECTIVE_PLAIN_EVENT}:${id}:${windowKey}:${beat}`)
          return true;
      }
    }
    return false;
  }
  plainToldOn(memoryId, at) {
    for (const id of this.lineage(memoryId)) {
      for (const e of this.plainRows(id)) {
        try {
          if (JSON.parse(e.payload ?? "{}").date === at)
            return true;
        } catch {}
      }
    }
    return false;
  }
  lineage(memoryId) {
    const out = [memoryId];
    let current = memoryId;
    for (let hop = 0;hop < DATE_LINEAGE_MAX; hop++) {
      const raw = this.store.row(current)?.meta;
      if (raw === undefined)
        break;
      let from;
      try {
        from = JSON.parse(raw)[DATE_FROM_META];
      } catch {
        break;
      }
      if (typeof from !== "string" || out.includes(from))
        break;
      out.push(from);
      current = from;
    }
    return out;
  }
  firingRowsFor(memoryId) {
    const out = this.rowsFor(memoryId);
    for (const id of this.lineage(memoryId).slice(1)) {
      for (const [key, row] of this.rowsFor(id))
        if (!out.has(key))
          out.set(key, row);
    }
    return out;
  }
  plainRows(memoryId) {
    return this.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT, ref: memoryId, order: "desc", limit: 50 });
  }
  arm(memoryId, windowKey) {
    return this.write("arm", memoryId, windowKey, (parsed, row) => ({
      state: windowStateOf(row),
      fires: row?.fires ?? 0,
      lastFiredDay: row?.last_fired_day ?? null,
      eventDate: parsed.eventDate,
      precision: parsed.precision
    }));
  }
  fire(input) {
    const day = input.day ?? this.store.livedDay();
    if (this.observer) {
      this.emit("prospective.observer.standdown", input.memoryId, {
        site: "fire",
        window: input.windowKey
      });
      return { fired: false, reason: "observer", derivation: null, fires: 0, state: "armed" };
    }
    const loaded = this.load(input.memoryId, input.dates ?? [], day);
    if (loaded === null) {
      return { fired: false, reason: "unknown-memory", derivation: null, fires: 0, state: "armed" };
    }
    const p = derive(loaded.memory, loaded.dates, input.at, this.tunables);
    if (!p.eligible) {
      this.emit("prospective.fire.refused", input.memoryId, {
        window: input.windowKey,
        reason: "not-eligible",
        derivation: p.reason,
        day
      });
      this.noteRefusal(input.memoryId, input.windowKey, "not-eligible", day, p.reason);
      return { fired: false, reason: "not-eligible", derivation: p.reason, fires: 0, state: "armed" };
    }
    const w = p.windows.find((x) => x.key === input.windowKey);
    const rows = this.firingRowsFor(input.memoryId);
    const row = rows.get(input.windowKey);
    if (w === undefined) {
      this.emit("prospective.fire.refused", input.memoryId, {
        window: input.windowKey,
        reason: "window-not-derived",
        day
      });
      this.noteRefusal(input.memoryId, input.windowKey, "window-not-derived", day, null);
      return {
        fired: false,
        reason: "window-not-derived",
        derivation: null,
        fires: row?.fires ?? 0,
        state: windowStateOf(row)
      };
    }
    const brake = this.brakeFor(w, row, {
      at: input.at,
      day,
      refractory: input.refractory === true,
      sessionId: input.sessionId
    });
    if (brake !== null) {
      this.emit("prospective.fire.refused", input.memoryId, {
        window: input.windowKey,
        reason: brake,
        day
      });
      this.noteRefusal(input.memoryId, input.windowKey, brake, day, null);
      return {
        fired: false,
        reason: brake,
        derivation: null,
        fires: row?.fires ?? 0,
        state: windowStateOf(row)
      };
    }
    const fires = (row?.fires ?? 0) + 1;
    this.store.setProspective({
      memoryId: input.memoryId,
      windowKey: input.windowKey,
      eventDate: w.eventDate,
      precision: w.precision,
      state: "fired",
      fires,
      lastFiredDay: day
    });
    if (input.sessionId !== undefined)
      this.markSession(input.sessionId, input.windowKey);
    this.emit("prospective.fired", input.memoryId, {
      window: input.windowKey,
      precision: w.precision,
      fires,
      cap: this.tunables.FIRES_PER_WINDOW,
      ramp: rampAt(w, input.at, this.tunables),
      day
    });
    this.note(PROSPECTIVE_FIRE_EVENT, input.memoryId, day, {
      window: input.windowKey,
      precision: w.precision,
      fires,
      cap: this.tunables.FIRES_PER_WINDOW,
      mode: cueModeOf(loaded.doc),
      date: input.at,
      ...isKnownSession(input.sessionId) ? { session: input.sessionId } : {}
    });
    return { fired: true, reason: "fired", derivation: null, fires, state: "fired" };
  }
  noteRefusal(memoryId, windowKey, reason, day, derivation) {
    this.note(PROSPECTIVE_REFUSED_EVENT, memoryId, day, { window: windowKey, reason, derivation }, `${PROSPECTIVE_REFUSED_EVENT}:${memoryId}:${windowKey}:${reason}:${String(day)}`);
  }
  note(name, memoryId, day, payload, dedupKey) {
    if (this.observer)
      return;
    try {
      this.store.appendEvent({
        name,
        day,
        ref: memoryId,
        payload,
        ...dedupKey === undefined ? {} : { dedupKey }
      });
    } catch {}
  }
  reference(memoryId, windowKey, day) {
    const d = day ?? this.store.livedDay();
    return this.write("reference", memoryId, windowKey, (parsed, row) => ({
      state: "suppressed",
      fires: row?.fires ?? 0,
      lastFiredDay: row?.last_fired_day ?? null,
      eventDate: parsed.eventDate,
      precision: parsed.precision,
      extra: { day: d }
    }));
  }
  actedOn(memoryId, at, day) {
    if (this.observer || !isDay(at))
      return [];
    const d = day ?? this.store.livedDay();
    const loaded = this.load(memoryId, [], d);
    if (loaded === null)
      return [];
    const p = derive(loaded.memory, loaded.dates, at, this.tunables);
    if (!p.eligible)
      return [];
    const mode = cueModeOf(loaded.doc);
    const out = [];
    for (const w of p.windows) {
      if (phaseOf(w, at) !== "arrived")
        continue;
      if (mode === "plain" && !this.plainTold(memoryId, w.key, w.precision === "day" ? "day" : "last-day"))
        continue;
      if (this.reference(memoryId, w.key, d).recorded)
        out.push(w.key);
    }
    return out;
  }
  expire(memoryId, windowKey, reason = "window-closed") {
    return this.write("expire", memoryId, windowKey, (parsed, row) => ({
      state: "expired",
      fires: row?.fires ?? 0,
      lastFiredDay: row?.last_fired_day ?? null,
      eventDate: parsed.eventDate,
      precision: parsed.precision,
      extra: { why: reason }
    }));
  }
  reschedule(input) {
    if (this.observer) {
      this.emit("prospective.observer.standdown", input.memoryId, { site: "reschedule" });
      return { rescheduled: false, reason: "observer", retiredKey: null, armedKey: null };
    }
    const loaded = this.load(input.memoryId, input.dates ?? [], this.store.livedDay());
    if (loaded === null) {
      return { rescheduled: false, reason: "unknown-memory", retiredKey: null, armedKey: null };
    }
    const nextPrecision = precisionOf(input.nextDate);
    const nextWindow = nextPrecision === null ? null : windowFor(input.nextDate, nextPrecision, this.tunables, input.memoryId);
    if (nextWindow === null) {
      this.emit("prospective.reschedule.refused", input.memoryId, { reason: "malformed-date" });
      return { rescheduled: false, reason: "malformed-date", retiredKey: null, armedKey: null };
    }
    if (input.expectCurrentDate === input.nextDate) {
      this.emit("prospective.reschedule.refused", input.memoryId, { reason: "unchanged" });
      return { rescheduled: false, reason: "unchanged", retiredKey: null, armedKey: null };
    }
    const p = derive(loaded.memory, loaded.dates, input.at, this.tunables);
    const current = p.windows.find((w) => w.eventDate === input.expectCurrentDate);
    if (current === undefined) {
      this.emit("prospective.reschedule.refused", input.memoryId, {
        reason: "stale-proposal",
        expected: input.expectCurrentDate
      });
      return { rescheduled: false, reason: "stale-proposal", retiredKey: null, armedKey: null };
    }
    const rows = this.rowsFor(input.memoryId);
    const old = rows.get(current.key);
    this.store.setProspective({
      memoryId: input.memoryId,
      windowKey: current.key,
      eventDate: current.eventDate,
      precision: current.precision,
      state: "expired",
      fires: old?.fires ?? 0,
      lastFiredDay: old?.last_fired_day ?? null
    });
    this.store.setProspective({
      memoryId: input.memoryId,
      windowKey: nextWindow.key,
      eventDate: nextWindow.eventDate,
      precision: nextWindow.precision,
      state: "armed",
      fires: 0,
      lastFiredDay: null
    });
    this.emit("prospective.rescheduled", input.memoryId, {
      from: current.key,
      to: nextWindow.key,
      spentFiresRetired: old?.fires ?? 0,
      why: input.reason ?? "reschedule"
    });
    return {
      rescheduled: true,
      reason: "rescheduled",
      retiredKey: current.key,
      armedKey: nextWindow.key
    };
  }
  events(name) {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }
  brakeFor(w, row, ctx) {
    if (ctx.refractory)
      return "refractory";
    const phase = phaseOf(w, ctx.at);
    if (phase === "pending")
      return "window-not-open";
    if (phase === "passed")
      return "stale-window";
    if (row !== undefined) {
      const state = windowStateOf(row);
      if (state === "suppressed")
        return "already-referenced";
      if (state === "expired")
        return "stale-window";
      if (row.fires >= this.tunables.FIRES_PER_WINDOW)
        return "over-fired";
      if (row.last_fired_day !== null && row.last_fired_day === ctx.day) {
        return "already-fired-today";
      }
      if (this.tunables.HOLD_LAST_FIRE_FOR_AFTER && w.precision !== "day" && this.tunables.FIRES_PER_WINDOW >= 2 && row.fires >= this.tunables.FIRES_PER_WINDOW - 1 && ctx.at <= w.lastDay) {
        return "held-for-after";
      }
    }
    if (ctx.sessionId !== undefined && this.sessionFired.get(ctx.sessionId)?.has(w.key) === true) {
      return "session-dedup";
    }
    return null;
  }
  load(memoryId, extra, day) {
    const row = this.store.row(memoryId);
    if (row === undefined)
      return null;
    let read;
    try {
      read = this.store.read(memoryId);
    } catch {
      return null;
    }
    const explicit = contentDates(read.doc);
    const dates = [...explicit, ...extra];
    const seen = new Set;
    const s = strength(read.physics, day);
    return {
      memory: {
        id: memoryId,
        kind: read.physics.kind,
        salience: read.physics.salience,
        archived: read.archived,
        learnedOn: read.doc.learnedOn === "" ? null : read.doc.learnedOn,
        journal: read.doc.type === "episode",
        explicitDate: explicit.length > 0,
        faded: s <= this.tunables.FADED_STRENGTH && read.physics.hold?.state !== "pending",
        recurring: recurrenceOf(read.doc) !== null
      },
      doc: read.doc,
      dates: dates.filter((d) => seen.has(d.date) ? false : (seen.add(d.date), true)),
      strength: s
    };
  }
  rowsFor(memoryId) {
    const out = new Map;
    for (const r of this.store.prospectiveFor(memoryId))
      out.set(r.window_key, r);
    return out;
  }
  markSession(sessionId, key) {
    let set = this.sessionFired.get(sessionId);
    if (set === undefined) {
      set = new Set;
      this.sessionFired.set(sessionId, set);
    }
    if (set.size >= this.tunables.MAX_SESSION_WINDOWS) {
      const oldest = set.values().next();
      if (!oldest.done)
        set.delete(oldest.value);
    }
    set.add(key);
  }
  write(site, memoryId, windowKey, next) {
    if (this.observer) {
      this.emit("prospective.observer.standdown", memoryId, { site, window: windowKey });
      return { recorded: false, reason: "observer", state: "armed" };
    }
    const parsed = parseWindowKey(windowKey);
    if (parsed === null) {
      this.emit(`prospective.${site}.refused`, memoryId, {
        window: windowKey,
        reason: "malformed-window-key"
      });
      return { recorded: false, reason: "malformed-window-key", state: "armed" };
    }
    if (!this.store.has(memoryId)) {
      this.emit(`prospective.${site}.refused`, memoryId, {
        window: windowKey,
        reason: "unknown-memory"
      });
      return { recorded: false, reason: "unknown-memory", state: "armed" };
    }
    const row = this.rowsFor(memoryId).get(windowKey);
    const v = next(parsed, row);
    this.store.setProspective({
      memoryId,
      windowKey,
      eventDate: v.eventDate,
      precision: v.precision,
      state: v.state,
      fires: v.fires,
      lastFiredDay: v.lastFiredDay
    });
    this.emit(`prospective.${site === "arm" ? "armed" : site === "reference" ? "referenced" : "expired"}`, memoryId, {
      window: windowKey,
      state: v.state,
      fires: v.fires,
      ...v.extra ?? {}
    });
    return { recorded: true, reason: "recorded", state: v.state };
  }
  emit(name, ref, data) {
    const e = { at: this.now(), name };
    if (ref !== undefined)
      e.ref = ref;
    if (data !== undefined)
      e.data = data;
    this.ring.push(e);
    if (this.ring.length > 500)
      this.ring.shift();
    this.onEvent?.(e);
  }
}
