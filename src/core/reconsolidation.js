import { randomBytes } from "node:crypto";
import { Associate } from "./associate/index.js";
import { lineOf } from "./fit/index.js";
import { band, changedFade, cosine, fadeOf, strength, unfade } from "./physics/index.js";
import { CUE_MODE_META, DATE_FROM_META, DATE_MOVED_TO_META, cueModeOf, recurrenceOf } from "./prospective/index.js";
import { earlierMark, headOf, isHandoff } from "./recall/index.js";
import { similarity } from "./remember/index.js";
import { RECURRING_META, isStoreError, rowTombstoned, statusOf } from "./store/index.js";
import { SETTLE_HOWS } from "./types.js";
export { SETTLE_HOWS } from "./types.js";
export const SETTLE_ACTORS = ["session", "dream", "reflection", "page-writer", "owner", "dream-undo", "detector"];
export const CONTRADICTION_TUNABLES = {
  WHY_CHARS: 300,
  NEIGHBOURS: 3,
  NEIGHBOUR_CANDIDATES: 8,
  NEIGHBOUR_LEXICAL: 0.4,
  NEIGHBOUR_COSINE: 0.7,
  EXCERPT_CHARS: 160,
  NEIGHBOURS_PER_CALL: 12,
  UPDATE_COSINE: 0.3,
  GUARD_BAR_QUANTILE: 0.6,
  GUARD_BAR_PAIRS: 2000,
  GUARD_BAR_SAMPLE: 400,
  GUARD_BAR_MIN_VECTORS: 50,
  HELD_TEXT_CHARS: 600,
  HELD_READ_ROWS: 5000,
  SLOT_COSINE: 0.85,
  SLOT_LINEAGE_COSINE: 0.8,
  SLOT_TITLE_COSINE: 0.85,
  SLOT_WINDOW_DAYS: 7,
  SLOT_CANDIDATES: 12,
  SLOT_FADE: 0.8,
  SLOT_PER_NIGHT: 4,
  SLOT_EXPIRY_DAYS: 14
};
export const GUARD_BAR_META = "reconsolidation.guardBar";
export const SLOT_SOURCE = "slot";
export const CORRECTED_REASON = "corrected";
export const FULFILLED_SOURCE = "fulfilled";
export const DREAM_MERGE_SOURCE = "dream-merge";
export const FOLD_SOURCE = "fold";
export const FOLD_SOURCE_CORRECTED = "fold-source-corrected";
export const PRESSURE_UNDONE_REASON = "pressure-undone";
export const CONTRADICTION_FLAGGED_EVENT = "contradiction.flagged";
export const CONTRADICTION_SETTLED_EVENT = "contradiction.settled";
export const CONTRADICTION_UNDONE_EVENT = "contradiction.undone";
export const CONTRADICTION_HELD_EVENT = "contradiction.held";
export const CONTRADICTION_PROPOSED_EVENT = "contradiction.proposed";
export const NEIGHBOURS_HINT = "These existing memories are close to what you just wrote. Is the new one the newer state of the same thing as one of them (a status moved on, a decision made, the latest release or result)? Then settle it now: remember with settle {holds: the new id, over: the old id, how: changed, why}. If it corrects one, how: corrected; if they disagree and you can't tell which holds, how: open. Otherwise do nothing.";
export const SLOT_HINT = "This reads as the newer state of the same thing as the memory in `slot`, so that one was marked as possibly out of date and faded a little, provisionally; tonight's dream confirms or undoes it. If it is, settle it now: remember with settle {holds, over, how: changed, why}. If they are two different things, do nothing.";
export const HELD_HINT = "The memory you named in updates looks unrelated to what you just wrote (few words in common, not close in meaning), so it was left as it was: not changed, not corrected, not linked. Its title and text are here. If the new memory does change or correct it, settle it now: remember with settle {holds, over, how, why}. If not, do nothing.";
function refuse(reason, detail) {
  return { ok: false, reason, detail };
}
function round(n) {
  return Math.round(n * 1000) / 1000;
}
function newPairId() {
  return `ctr_${randomBytes(6).toString("hex")}`;
}
export function feelingInvite(over, felt) {
  return `${over} still carries a feeling (${String(round(felt))}, its latest). If it sits differently now that this holds, record how it feels now — a feeling-now on ${over} (remember's feelingsNow, a dream's feeling-now, a reflection's feelings); its weight follows the latest, and the first is kept.`;
}
export function cleanWhy(why) {
  const t = (why ?? "").replace(/\s+/g, " ").trim();
  return t.length === 0 ? null : t.slice(0, CONTRADICTION_TUNABLES.WHY_CHARS);
}
export function readHow(v) {
  return typeof v === "string" && SETTLE_HOWS.includes(v) ? v : null;
}
export function pairStanding(store, pair) {
  const live = (id) => {
    const r = store.row(id);
    return r !== undefined && r.archived === 0 && r.superseded_by === null && !rowTombstoned(r);
  };
  return live(pair.a) && live(pair.b);
}
function doorRefusal(store, id) {
  const row = store.row(id);
  if (row === undefined)
    return refuse("unknown-memory", `There is no memory ${id}.`);
  if (rowTombstoned(row))
    return refuse("removed", `${id} was removed by the owner.`);
  if (row.type !== "memory") {
    return refuse("not-a-memory", `${id} is not a memory (a ${row.type} row): a belief or an entity changes through a new memory that updates it, and a journal chapter is not a claim.`);
  }
  if (row.superseded_by !== null) {
    return refuse("moved-on", `${id} was replaced by ${row.superseded_by}; settle with that one.`);
  }
  if (row.archived === 1)
    return refuse("archived", `${id} is archived (${row.archived_reason ?? "archived"}), so it is out of recall already.`);
  return null;
}
function memoryRefusal(store, id, moves) {
  const door = doorRefusal(store, id);
  if (door !== null)
    return door;
  const row = store.row(id);
  if (moves && row.protected === 1)
    return refuse("protected", `${id} is protected by the owner: it can be marked open, never changed or corrected.`);
  if (moves && (row.band === "identity" || row.promoted_identity === 1)) {
    return refuse("core-takes-pressure", `${id} is a core memory: it changes only slowly, through a new memory that updates it (pressure over days). It can be marked open now.`);
  }
  return null;
}
export function settle(store, input, opts = {}) {
  if (store.observer)
    return refuse("observer", "This session is an observer: it reads the store and writes nothing. Nothing was settled.");
  const asked = readHow(input.how);
  if (asked === null)
    return refuse("how-unknown", `how is one of ${SETTLE_HOWS.join(", ")}.`);
  let how = asked;
  const day = input.day ?? store.livedDay();
  let pair;
  let holds = input.holds?.trim() || undefined;
  let over = input.over?.trim() || undefined;
  if (input.pair !== undefined && input.pair.trim().length > 0) {
    pair = store.contradiction(input.pair.trim());
    if (pair === undefined)
      return refuse("pair-unknown", `There is no contradiction ${input.pair}.`);
    if (pair.state === "withdrawn")
      return refuse("pair-withdrawn", `${pair.id} was withdrawn: the dream that flagged it was undone.`);
    const members = [pair.a, pair.b];
    if (holds !== undefined && !members.includes(holds))
      return refuse("not-in-pair", `${holds} is not one of ${pair.id}'s two memories (${pair.a}, ${pair.b}).`);
    if (over !== undefined && !members.includes(over))
      return refuse("not-in-pair", `${over} is not one of ${pair.id}'s two memories (${pair.a}, ${pair.b}).`);
    if (holds === undefined && over !== undefined)
      holds = over === pair.a ? pair.b : pair.a;
    if (holds === undefined) {
      if (how !== "open")
        return refuse("holds-required", `Say which memory holds now: holds is ${pair.a} or ${pair.b}.`);
      holds = pair.b;
    }
    over = holds === pair.a ? pair.b : pair.a;
  } else {
    if (holds === undefined || over === undefined) {
      return refuse("holds-required", "Name the pair (pair: its id), or both memories: holds (the one that holds now) and over (the one it changes, corrects or disagrees with).");
    }
    if (holds === over)
      return refuse("same-memory", `holds and over are both ${holds}.`);
    pair = store.contradictionBetween(holds, over);
  }
  const reversalNotes = [];
  if (pair !== undefined && pair.state === "settled" && input.actor !== "owner" && isReversal(store, pair, holds, over, how, "owner") && settledByOwner(store, pair.id)) {
    return refuse("already-settled", `${pair.id} is already settled: the owner settled ${over} over ${holds}, so it stands as theirs. Tell them: they can settle ${holds} over ${over} themselves (counterparts settle --holds ${holds} --against ${over} --how changed --why "...") or undo it (counterparts settle --undo ${pair.id}).`);
  }
  if (pair !== undefined && pair.state === "settled" && isReversal(store, pair, holds, over, how, input.actor)) {
    const bad = memoryRefusal(store, over, true) ?? memoryRefusal(store, holds, false);
    if (bad !== null)
      return bad;
    const was = pair.id;
    const u = undo(store, { pair: pair.id, actor: input.actor, actorId: input.actorId ?? null, why: `reversed: ${holds} holds again over ${over}`, day }, opts.retarget === undefined ? {} : { retarget: opts.retarget });
    if (!u.ok)
      return refuse("already-settled", `${pair.id} is already settled (${over} over ${holds}) and could not be reversed: ${u.detail}`);
    reversalNotes.push(`${over} had held over ${holds} (${was}); that settle was undone and the two reordered.`);
    pair = store.contradictionBetween(holds, over);
  }
  if (pair !== undefined && pair.state === "settled") {
    const again = input.actor === "owner" ? `Undo it first — counterparts settle --undo ${pair.via ?? pair.id} — then settle again.` : `If it is settled wrongly, tell the owner: undoing a settle is theirs (counterparts settle --undo ${pair.via ?? pair.id}).`;
    const stands = pair.holds !== null && pair.over !== null ? `: ${pair.holds} holds over ${pair.over}` : "";
    return refuse("already-settled", `${pair.id} is already settled (${pair.how ?? "settled"}${pair.via === null ? "" : `, through ${pair.via}`})${stands}. ${again}`);
  }
  const guardNotes = [];
  if (how !== "open" && input.actor !== "owner") {
    const o = store.row(over);
    const h = store.row(holds);
    if (o !== undefined && h !== undefined && slotExempt(o) && !slotExempt(h)) {
      how = "open";
      guardNotes.push(`${over} is a reading or a world memory and ${holds} is not, so it was not faded: the two were kept side by side (open). If one claim in it was wrong, write that claim, corrected, as a memory of its own.`);
    }
  }
  const bad = memoryRefusal(store, over, how !== "open") ?? memoryRefusal(store, holds, false);
  if (bad !== null)
    return bad;
  return supersede(store, {
    holds,
    over,
    how,
    source: opts.source ?? "settle",
    actor: input.actor,
    actorId: input.actorId ?? null,
    why: input.why ?? null,
    day,
    ...pair === undefined ? {} : { pair },
    ...how !== asked ? { asked } : {},
    ...opts.closeFlags === undefined ? {} : { closeFlags: opts.closeFlags },
    ...opts.howSent === undefined ? {} : { howSent: opts.howSent },
    notes: [...reversalNotes, ...guardNotes]
  }, opts.retarget === undefined ? {} : { retarget: opts.retarget });
}
function settledByOwner(store, pairId) {
  try {
    const last = store.contradictionSettles({ pairId }).filter((x) => x.action === "settle" && x.undone === 0).pop();
    return last?.actor === "owner";
  } catch {
    return false;
  }
}
function isReversal(store, pair, holds, over, how, actor) {
  if (actor !== "owner" && actor !== "session")
    return false;
  if (how === "open" || pair.via !== null || pair.how !== "changed" || pair.source === "pressure")
    return false;
  if (pair.holds !== over || pair.over !== holds)
    return false;
  if (actor === "owner")
    return true;
  const o = store.row(over);
  const h = store.row(holds);
  return !(o !== undefined && h !== undefined && slotExempt(o) && !slotExempt(h));
}
export const REMINDER_SPENT_BY_META = "reminderSpentBy";
function reminderSpend(store, from, by) {
  const date = store.row(from)?.event_date ?? null;
  return date === null ? null : { from, fromMeta: { [REMINDER_SPENT_BY_META]: by }, to: null, eventDate: date, toMeta: {} };
}
function reminderCarry(store, from, to) {
  const date = store.row(from)?.event_date ?? null;
  if (date === null)
    return null;
  let mode = "quiet";
  let rule = null;
  try {
    const prose = store.readProse(from);
    mode = cueModeOf(prose);
    rule = recurrenceOf(prose);
  } catch {}
  return {
    from,
    fromMeta: { [DATE_MOVED_TO_META]: to },
    to,
    eventDate: date,
    toMeta: { [CUE_MODE_META]: mode, [DATE_FROM_META]: from, ...rule === null ? {} : { [RECURRING_META]: rule } }
  };
}
export function supersede(store, input, opts = {}) {
  if (store.observer)
    return refuse("observer", "This session is an observer: it reads the store and writes nothing. Nothing was settled.");
  const { holds, over, how } = input;
  if (holds === over)
    return refuse("same-memory", `holds and over are both ${holds}.`);
  const bad = doorRefusal(store, over) ?? doorRefusal(store, holds);
  if (bad !== null)
    return bad;
  const day = input.day ?? store.livedDay();
  const pair = input.pair;
  const notes = [...input.notes ?? []];
  const detail = {};
  if (input.asked !== undefined && input.asked !== how)
    detail["asked"] = input.asked;
  if (input.howSent !== undefined)
    detail["howSent"] = input.howSent;
  let reminder = null;
  if (how !== "open" && store.physicsOf(over).hold?.state === "pending") {
    const h = store.row(holds);
    if (statusOf(h.status ?? null) === "done") {
      reminder = reminderSpend(store, over, holds);
      if (reminder !== null) {
        detail["reminder"] = { from: over, to: null, eventDate: reminder.eventDate };
        notes.push(`${over}'s reminder (${reminder.eventDate}) was spent: ${holds} says it is done.`);
      }
    } else if (h.event_date !== null) {
      if (input.actor !== "owner") {
        return refuse("pending-date", `${over} holds a date still to come (${store.row(over)?.event_date ?? "a reminder"}) and ${holds} has a date of its own, so the reminder cannot move to it: settled over, it would go quiet. Settle open, or write the newer memory with updates: ${over}.`);
      }
    } else {
      reminder = reminderCarry(store, over, holds);
      if (reminder !== null) {
        detail["reminder"] = { from: over, to: holds, eventDate: reminder.eventDate };
        notes.push(`${over}'s reminder (${reminder.eventDate}) moved to ${holds}.`);
      }
    }
  }
  const closes = input.closeFlags === true || input.closeFlags !== false && how !== "open" ? (store.contradictionsOf([over]).get(over) ?? []).filter((c) => c.state === "unsettled" && c.id !== pair?.id).filter((c) => !(c.source === SLOT_SOURCE && provisionalOf(store, c)?.holds === over)).map((c) => c.id) : [];
  const answered = [...pair === undefined ? [] : [pair], ...closes.map((c) => store.contradiction(c)).filter((c) => c !== undefined)];
  const lifts = answered.map((c) => provisionalOf(store, c)?.fade ?? null).filter((f) => f !== null);
  const lifted = new Map;
  for (const l of lifts)
    lifted.set(l.id, unfade(lifted.get(l.id) ?? fadeOf(store.physicsOf(l.id)), l.factor));
  if (lifts.length > 0)
    detail["lifts"] = lifts;
  const overRow = store.row(over);
  let leaveCore = null;
  let decored = null;
  if (how !== "open" && (overRow.promoted_identity === 1 || overRow.band === "identity")) {
    const lastUsedDay = Math.max(overRow.last_used_day, day);
    decored = { ...store.physicsOf(over), promotedIdentity: false, lastUsedDay };
    leaveCore = { id: over, band: band(decored, day), lastUsedDay };
    detail["core"] = { band: overRow.band, bandDay: overRow.band_day ?? null, lastUsedDay: overRow.last_used_day, promoted: overRow.promoted_identity === 1 };
    notes.push(`${over} left the core: it fades now like any memory, earlier under ${holds}.`);
  }
  let fade = null;
  let faded = null;
  if (how === "changed") {
    const physics = decored ?? store.physicsOf(over);
    const base = lifted.has(over) ? { ...physics, fade: lifted.get(over) } : physics;
    const cut = changedFade(base, day, input.factor);
    if (cut === null) {
      notes.push(`${over} has nothing to cut; it keeps its place as the earlier one.`);
    } else {
      fade = { id: over, fade: cut.fade };
      faded = { id: over, before: round(strength(physics, day)), after: round(cut.after) };
      detail["fade"] = { id: over, factor: cut.factor, before: faded.before, after: faded.after };
    }
  }
  const liftPatches = [...lifted].filter(([id]) => fade === null || id !== fade.id).map(([id, f]) => ({ id, fade: f }));
  if (how !== "open" && input.source !== DREAM_MERGE_SOURCE && input.source !== REMINDER_MOVED_SOURCE && input.source !== FOLD_SOURCE) {
    const felt = store.row(over)?.feeling_peak ?? null;
    if (typeof felt === "number" && felt > 0)
      notes.push(feelingInvite(over, felt));
  }
  const archive = how === "corrected" ? { id: over, reason: CORRECTED_REASON } : null;
  const leaves = archive !== null;
  if (leaves) {
    detail["archived"] = over;
    detail["archivedReason"] = CORRECTED_REASON;
    detail["links"] = true;
  }
  const holdsCol = how === "open" ? null : holds;
  const overCol = how === "open" ? null : over;
  let pairId;
  try {
    const out = store.settleContradiction({
      ...pair === undefined ? { newId: newPairId(), x: holds, y: over, source: input.source } : { pairId: pair.id },
      how,
      holds: holdsCol,
      over: overCol,
      actor: input.actor,
      actorId: input.actorId ?? null,
      why: cleanWhy(input.why),
      day,
      fade,
      archive,
      leaveCore,
      reminder,
      closes,
      lifts: liftPatches,
      detail
    });
    pairId = out.pairId;
  } catch (err) {
    return refuse("failed", `Nothing was settled: ${isStoreError(err) ? err.code : String(err.message ?? err)}.`);
  }
  if (leaves)
    carryLinks(store, over, holds, day, opts.retarget);
  store.appendEvent({
    name: CONTRADICTION_SETTLED_EVENT,
    day,
    ref: pairId,
    payload: {
      pair: pairId,
      how,
      holds: holdsCol,
      over: overCol,
      actor: input.actor,
      actorId: input.actorId ?? null,
      source: pair?.source ?? input.source,
      ...input.howSent === undefined ? {} : { howSent: input.howSent },
      faded: faded !== null,
      archived: archive !== null,
      leftCore: leaveCore !== null,
      reminder: reminder !== null,
      closed: closes.length,
      day
    }
  });
  if (how === "corrected" && input.source !== FOLD_SOURCE) {
    const flagged = flagFoldsOf(store, over, holds, day);
    if (flagged.length > 0)
      notes.push(`${flagged.join(", ")} ${flagged.length === 1 ? "was" : "were"} folded from ${over}: flagged beside ${holds}, to read again.`);
  }
  return {
    ok: true,
    pair: pairId,
    how,
    holds: holdsCol,
    over: overCol,
    faded,
    archived: archive?.id ?? null,
    closed: closes,
    ...notes.length > 0 ? { note: notes.join(" ") } : {}
  };
}
function flagFoldsOf(store, source, corrector, day) {
  const out = [];
  try {
    for (const fold of store.foldsCiting(source)) {
      if (fold === corrector)
        continue;
      const f = flag(store, { x: fold, y: corrector, source: FOLD_SOURCE_CORRECTED, day });
      if (f.ok && f.created)
        out.push(fold);
    }
  } catch {}
  return out;
}
function withdrawFoldFlags(store, source, corrector) {
  try {
    for (const fold of store.foldsCiting(source)) {
      const p = store.contradictionBetween(fold, corrector);
      if (p !== undefined && p.state === "unsettled" && p.source === FOLD_SOURCE_CORRECTED)
        store.withdrawContradiction(p.id);
    }
  } catch {}
}
function carryLinks(store, from, to, day, retarget) {
  try {
    if (retarget !== undefined)
      retarget(from, to, day);
    else
      new Associate({ store }).retargetOnSupersede(from, to, day);
  } catch {}
}
export function settleOnWrite(store, input) {
  return settle(store, { holds: input.newId, over: input.targetId, how: input.how, actor: "session", actorId: input.actorId, day: input.day }, { closeFlags: true, source: "write", ...input.howSent === undefined ? {} : { howSent: input.howSent }, ...input.retarget === undefined ? {} : { retarget: input.retarget } });
}
export const REMINDER_MOVED_SOURCE = "reminder-moved";
export const REMINDERS_MOVED_META = "reconsolidation.remindersMoved";
export function settleMovedReminder(store, input, opts = {}) {
  if (store.observer || input.remnant === input.holder)
    return null;
  const r = store.row(input.remnant);
  if (r === undefined || r.event_date !== null || r.archived === 1 || r.superseded_by !== null)
    return null;
  if (store.contradictionBetween(input.holder, input.remnant) !== undefined)
    return null;
  const out = settle(store, { holds: input.holder, over: input.remnant, how: "changed", why: "its reminder moved to the newer memory", actor: input.actor, actorId: input.actorId ?? null, ...input.day === undefined ? {} : { day: input.day } }, { source: REMINDER_MOVED_SOURCE, ...opts.retarget === undefined ? {} : { retarget: opts.retarget } });
  return out.ok ? out : null;
}
export function settleMovedReminders(store, opts = {}) {
  if (store.observer)
    return 0;
  try {
    if (opts.force !== true && store.getMeta(REMINDERS_MOVED_META) !== undefined)
      return 0;
    const day = store.livedDay();
    let written = 0;
    let passed = 0;
    for (const id of store.idsWithMetaKey(DATE_MOVED_TO_META)) {
      let to;
      try {
        to = store.readProse(id).meta[DATE_MOVED_TO_META];
      } catch {
        continue;
      }
      if (typeof to !== "string" || headOf(store, id) !== null) {
        passed += 1;
        continue;
      }
      let holder;
      try {
        holder = store.resolve(to);
      } catch {
        passed += 1;
        continue;
      }
      const h = store.row(holder);
      if (h === undefined || h.archived === 1 || h.superseded_by !== null || rowTombstoned(h)) {
        passed += 1;
        continue;
      }
      if (settleMovedReminder(store, { remnant: id, holder, actor: "detector", day }, opts) !== null)
        written += 1;
      else
        passed += 1;
    }
    store.setMeta(REMINDERS_MOVED_META, JSON.stringify({ day, written, passed }));
    return written;
  } catch {
    return 0;
  }
}
export function flag(store, input) {
  if (store.observer)
    return { ok: false, reason: "observer", detail: "This session is an observer: nothing was flagged." };
  const day = input.day ?? store.livedDay();
  try {
    const out = store.flagContradiction({
      id: newPairId(),
      x: input.x,
      y: input.y,
      source: input.source,
      day,
      dreamId: input.dreamId ?? null,
      dreamSeq: input.dreamSeq ?? null
    });
    if (out.created) {
      store.appendEvent({
        name: CONTRADICTION_FLAGGED_EVENT,
        day,
        ref: out.id,
        payload: { pair: out.id, source: input.source, dream: input.dreamId ?? null, day }
      });
    }
    return { ok: true, pair: out.id, created: out.created, state: out.state };
  } catch (err) {
    return { ok: false, reason: "failed", detail: isStoreError(err) ? err.code : String(err.message ?? err) };
  }
}
export function undo(store, input, opts = {}) {
  if (store.observer)
    return { ok: false, reason: "observer", detail: "This session is an observer: nothing was undone." };
  const day = input.day ?? store.livedDay();
  const pair = store.contradiction(input.pair.trim());
  if (pair === undefined)
    return { ok: false, reason: "pair-unknown", detail: `There is no contradiction ${input.pair}.` };
  if (pair.via !== null) {
    return { ok: false, reason: "closed-through", detail: `${pair.id} was closed through ${pair.via}; undo that one.` };
  }
  if (pair.state === "unsettled" && pair.source === SLOT_SOURCE && provisionalOf(store, pair) !== null) {
    const w = withdrawSlot(store, { pair: pair.id, actor: input.actor, actorId: input.actorId ?? null, why: input.why ?? null, day });
    if (!w.ok)
      return { ok: false, reason: w.reason, detail: w.detail };
    return { ok: true, pair: pair.id, how: null, state: "withdrawn", restored: w.restored, unarchived: null, reopened: [] };
  }
  if (pair.state !== "settled")
    return { ok: false, reason: "not-settled", detail: `${pair.id} is ${pair.state}; there is no settle to undo.` };
  const last = store.contradictionSettles({ pairId: pair.id }).filter((s) => s.action === "settle" && s.undone === 0).pop();
  if (last === undefined)
    return { ok: false, reason: "no-settle", detail: `${pair.id} has no settle on its trail to undo.` };
  const d = settleDetail(last.detail);
  const notes = [];
  const next = new Map;
  const current = (id) => {
    if (next.has(id))
      return next.get(id);
    const r = store.row(id);
    return r === undefined ? null : typeof r.fade === "number" ? r.fade : 1;
  };
  if (d.fade !== null) {
    const f = current(d.fade.id);
    if (f !== null)
      next.set(d.fade.id, unfade(f, d.fade.factor));
  }
  for (const l of d.lifts) {
    const f = current(l.id);
    if (f !== null)
      next.set(l.id, Math.min(1, f * l.factor));
  }
  const restore = d.fade !== null && next.has(d.fade.id) ? { id: d.fade.id, fade: next.get(d.fade.id) } : null;
  const reapply = [...next].filter(([id]) => d.fade === null || id !== d.fade.id).map(([id, fade]) => ({ id, fade }));
  const reopen = d.closes.filter((c) => store.contradiction(c)?.via === pair.id);
  const crossing = pair.source === "pressure" && last.holds !== null && last.over !== null && mintedByCrossing(store, last.holds, last.over);
  const back = !crossing && wasFlagged(pair) ? "unsettled" : "withdrawn";
  let reminderBack = null;
  if (d.reminder !== null) {
    const r = d.reminder;
    const to = r.to === null ? null : store.row(r.to);
    const from = store.row(r.from);
    if (r.to === null && from !== undefined && from.event_date === null) {
      reminderBack = { to: null, toMeta: {}, from: r.from, eventDate: r.eventDate, fromMeta: { [REMINDER_SPENT_BY_META]: null } };
    } else if (r.to !== null && to !== undefined && to !== null && from !== undefined && to.event_date === r.eventDate && from.event_date === null) {
      reminderBack = { to: r.to, toMeta: { [DATE_FROM_META]: null, [CUE_MODE_META]: null, [RECURRING_META]: null }, from: r.from, eventDate: r.eventDate, fromMeta: { [DATE_MOVED_TO_META]: null } };
    } else {
      notes.push(`${r.to ?? r.from}'s date has moved on since, so the reminder stayed where it is.`);
    }
  }
  let unarchived = false;
  try {
    const out = store.undoContradictionSettle({
      pairId: pair.id,
      settleSeq: last.seq,
      actor: input.actor,
      actorId: input.actorId ?? null,
      why: cleanWhy(input.why),
      day,
      state: back,
      restore,
      reapply,
      unarchive: d.archived === null ? null : { id: d.archived, reason: d.archivedReason },
      rejoinCore: d.core === null || last.over === null ? null : { id: last.over, band: d.core.band, bandDay: d.core.bandDay, lastUsedDay: d.core.lastUsedDay, promoted: d.core.promoted },
      reopen,
      reminderBack,
      detail: { restored: restore?.id ?? null, archived: d.archived, reopened: reopen, state: back, ...reminderBack === null ? {} : { reminder: true } }
    });
    unarchived = out.unarchived;
  } catch (err) {
    return { ok: false, reason: "failed", detail: `Nothing was undone: ${isStoreError(err) ? err.code : String(err.message ?? err)}.` };
  }
  if (unarchived && d.links && last.holds !== null && d.archived !== null)
    carryLinks(store, last.holds, d.archived, day, opts.retarget);
  if (crossing && last.holds !== null) {
    try {
      if (store.row(last.holds)?.archived === 0)
        store.archive(last.holds, PRESSURE_UNDONE_REASON);
    } catch {
      notes.push(`${last.holds} could not be put away; it stands beside ${String(last.over)}.`);
    }
  }
  for (const id of back === "unsettled" ? [pair.id, ...reopen] : reopen)
    resetHabituation(store, id, day);
  if (d.archived !== null && !unarchived)
    notes.push(`${d.archived} has moved on since it was archived, so it was not brought back.`);
  if (pair.how === "corrected" && last.over !== null && last.holds !== null)
    withdrawFoldFlags(store, last.over, last.holds);
  store.appendEvent({
    name: CONTRADICTION_UNDONE_EVENT,
    day,
    ref: pair.id,
    payload: { pair: pair.id, how: pair.how, actor: input.actor, restored: restore !== null, unarchived, reopened: reopen.length, state: back, day }
  });
  return {
    ok: true,
    pair: pair.id,
    how: pair.how,
    state: back,
    restored: restore?.id ?? null,
    unarchived: unarchived ? d.archived : null,
    reopened: reopen,
    ...notes.length > 0 ? { note: notes.join(" ") } : {}
  };
}
export function wasFlagged(pair) {
  return pair.source === "dream" || pair.source === "pressure" || pair.source === SLOT_SOURCE || pair.dream_id !== null;
}
export function settleDetail(raw) {
  let d = {};
  try {
    d = JSON.parse(raw);
  } catch {
    d = {};
  }
  const f = d["fade"];
  return {
    fade: f !== undefined && typeof f.id === "string" && typeof f.factor === "number" ? { id: f.id, factor: f.factor } : null,
    archived: typeof d["archived"] === "string" ? d["archived"] : null,
    archivedReason: typeof d["archivedReason"] === "string" ? d["archivedReason"] : CORRECTED_REASON,
    links: d["links"] === true,
    reminder: reminderOf(d["reminder"]),
    core: coreOf(d["core"]),
    closes: Array.isArray(d["closes"]) ? d["closes"].filter((x) => typeof x === "string") : [],
    lifts: Array.isArray(d["lifts"]) ? d["lifts"].flatMap(fadeFactorOf) : []
  };
}
function coreOf(x) {
  if (x === null || typeof x !== "object")
    return null;
  const c = x;
  if (c.band !== "identity" && c.band !== "semantic" && c.band !== "episodic")
    return null;
  if (typeof c.lastUsedDay !== "number")
    return null;
  return { band: c.band, bandDay: typeof c.bandDay === "number" ? c.bandDay : null, lastUsedDay: c.lastUsedDay, promoted: c.promoted === true };
}
function mintedByCrossing(store, holds, over) {
  try {
    const r = store.row(holds);
    return r !== undefined && r.source === "accommodation" && store.readProse(holds).meta["revisedFrom"] === over;
  } catch {
    return false;
  }
}
function reminderOf(x) {
  if (x === null || typeof x !== "object")
    return null;
  const r = x;
  return typeof r.from === "string" && (typeof r.to === "string" || r.to === null) && typeof r.eventDate === "string" ? { from: r.from, to: r.to, eventDate: r.eventDate } : null;
}
function fadeFactorOf(x) {
  if (x === null || typeof x !== "object")
    return [];
  const f = x;
  return typeof f.id === "string" && typeof f.factor === "number" && f.factor > 0 && f.factor < 1 ? [{ id: f.id, factor: f.factor }] : [];
}
export function provisionalOf(store, pair) {
  if (pair.source !== SLOT_SOURCE)
    return null;
  const row = store.contradictionSettles({ pairId: pair.id }).filter((s) => s.action === "propose" && s.undone === 0).pop();
  if (row === undefined || row.holds === null || row.over === null)
    return null;
  let d = {};
  try {
    d = JSON.parse(row.detail);
  } catch {
    d = {};
  }
  return { seq: row.seq, holds: row.holds, over: row.over, fade: fadeFactorOf(d["fade"])[0] ?? null };
}
export function slotExempt(row) {
  return row.about === "world" || /^\s*reading\b/i.test(row.title ?? row.body);
}
export function detectSlot(store, input) {
  const T = CONTRADICTION_TUNABLES;
  try {
    const row = store.row(input.id);
    if (row === undefined || row.type !== "memory" || row.archived === 1 || row.superseded_by !== null || rowTombstoned(row))
      return null;
    if (row.source !== "authored" || slotExempt(row) || row.created_at === null)
      return null;
    const vec = store.vectorOf(input.id);
    if (vec === null)
      return null;
    const skip = new Set([input.id, ...input.exclude ?? []]);
    const session = input.session ?? null;
    const own = session === null ? [] : store.memoriesOfSession(session).map((m) => m.id);
    const near = store.neighbourReader()(input.id, T.SLOT_CANDIDATES) ?? [];
    const found = [];
    const seen = new Set;
    let ownTitle;
    for (const id of [...own, ...near]) {
      if (seen.has(id) || skip.has(id))
        continue;
      seen.add(id);
      const c = store.row(id);
      if (c === undefined || c.type !== "memory" || c.archived === 1 || c.superseded_by !== null || rowTombstoned(c))
        continue;
      if (c.source !== "authored" || c.kind !== row.kind || (c.about ?? null) !== (row.about ?? null) || slotExempt(c))
        continue;
      if (c.confidential !== row.confidential || c.event_date !== null)
        continue;
      if (c.created_at === null || c.created_at >= row.created_at || row.birth_day - c.birth_day > T.SLOT_WINDOW_DAYS)
        continue;
      if (c.protected === 1 || c.band === "identity" || c.promoted_identity === 1)
        continue;
      try {
        if (isHandoff(store.readProse(id)))
          continue;
      } catch {
        continue;
      }
      const other = store.vectorOf(id);
      if (other === null || other.length !== vec.length)
        continue;
      const cos = cosine(vec, other);
      if (cos < T.SLOT_LINEAGE_COSINE)
        continue;
      const lineage = c.status === "planned" && row.status === "done";
      let rule = cos >= T.SLOT_COSINE ? "cosine" : lineage ? "lineage" : null;
      if (rule === null && row.title !== null && c.title !== null) {
        ownTitle ??= store.textVector(row.title);
        const theirs = store.textVector(c.title);
        if (ownTitle !== null && theirs !== null && theirs.length === ownTitle.length && cosine(ownTitle, theirs) >= T.SLOT_TITLE_COSINE)
          rule = "title";
      }
      if (rule === null)
        continue;
      if (headOf(store, id) !== null || store.contradictionEverBetween(input.id, id))
        continue;
      if ((store.contradictionsOf([id]).get(id) ?? []).some((p) => p.state === "unsettled" && p.source === SLOT_SOURCE && p.a === id))
        continue;
      found.push({ over: id, cosine: round(cos), rule, sameSession: c.origin_session !== null && c.origin_session === session });
    }
    found.sort((a, b) => Number(b.sameSession) - Number(a.sameSession) || b.cosine - a.cosine || (a.over < b.over ? -1 : 1));
    return found[0] ?? null;
  } catch {
    return null;
  }
}
export function proposeSlot(store, input) {
  if (store.observer)
    return { ok: false, reason: "observer", detail: "This session is an observer: nothing was proposed." };
  const day = input.day ?? store.livedDay();
  const over = input.candidate.over;
  const bad = memoryRefusal(store, over, true) ?? memoryRefusal(store, input.holds, false);
  if (bad !== null && !bad.ok)
    return { ok: false, reason: bad.reason, detail: bad.detail };
  const physics = store.physicsOf(over);
  const cut = changedFade(physics, day, CONTRADICTION_TUNABLES.SLOT_FADE);
  const faded = cut === null ? null : { before: round(cut.before), after: round(cut.after) };
  const bandDrop = cut !== null && band(physics, day) === "semantic" && band({ ...physics, fade: cut.fade }, day) === "episodic";
  try {
    const out = store.proposeContradiction({
      id: newPairId(),
      holds: input.holds,
      over,
      source: SLOT_SOURCE,
      day,
      actor: "detector",
      actorId: input.actorId ?? null,
      fade: cut === null ? null : { id: over, fade: cut.fade },
      detail: {
        ...cut === null ? {} : { fade: { id: over, factor: cut.factor, ...faded } },
        rule: input.candidate.rule,
        cosine: input.candidate.cosine,
        sameSession: input.candidate.sameSession,
        ...input.carriedFrom === undefined ? {} : { carriedFrom: input.carriedFrom }
      }
    });
    if (!out.created)
      return { ok: false, reason: "already-a-pair", detail: `${input.holds} and ${over} are already a pair (${out.id}).` };
    if (input.carriedFrom === undefined) {
      store.appendEvent({
        name: CONTRADICTION_PROPOSED_EVENT,
        day,
        ref: out.id,
        payload: { pair: out.id, holds: input.holds, over, rule: input.candidate.rule, cosine: input.candidate.cosine, sameSession: input.candidate.sameSession, faded: faded !== null, bandDrop, day }
      });
    }
    return { ok: true, pair: out.id, holds: input.holds, over, rule: input.candidate.rule, cosine: input.candidate.cosine, faded };
  } catch (err) {
    return { ok: false, reason: "failed", detail: `Nothing was proposed: ${isStoreError(err) ? err.code : String(err.message ?? err)}.` };
  }
}
export function withdrawSlot(store, input) {
  if (store.observer)
    return { ok: false, reason: "observer", detail: "This session is an observer: nothing was withdrawn." };
  const day = input.day ?? store.livedDay();
  const pair = store.contradiction(input.pair.trim());
  if (pair === undefined)
    return { ok: false, reason: "pair-unknown", detail: `There is no contradiction ${input.pair}.` };
  const p = pair.state === "unsettled" ? provisionalOf(store, pair) : null;
  if (p === null)
    return { ok: false, reason: "not-a-proposal", detail: `${pair.id} is not a slot proposal still waiting (${pair.source}, ${pair.state}).` };
  let restore = null;
  if (p.fade !== null) {
    const r = store.row(p.fade.id);
    if (r !== undefined)
      restore = { id: p.fade.id, fade: unfade(typeof r.fade === "number" ? r.fade : 1, p.fade.factor) };
  }
  try {
    const out = store.withdrawProposal({ pairId: pair.id, proposeSeq: p.seq, actor: input.actor, actorId: input.actorId ?? null, why: cleanWhy(input.why), day, restore, detail: { restored: restore?.id ?? null } });
    store.appendEvent({
      name: CONTRADICTION_UNDONE_EVENT,
      day,
      ref: pair.id,
      payload: { pair: pair.id, how: null, actor: input.actor, restored: restore !== null, unarchived: false, reopened: 0, state: "withdrawn", proposal: true, day }
    });
    return { ok: true, pair: pair.id, restored: restore?.id ?? null, seq: out.seq };
  } catch (err) {
    return { ok: false, reason: "failed", detail: `Nothing was withdrawn: ${isStoreError(err) ? err.code : String(err.message ?? err)}.` };
  }
}
export function reinstateSlot(store, input) {
  if (store.observer)
    return false;
  const pair = store.contradiction(input.pair);
  if (pair === undefined || pair.state !== "withdrawn" || pair.source !== SLOT_SOURCE)
    return false;
  const trail = store.contradictionSettles({ pairId: pair.id });
  const w = trail.find((s) => s.seq === input.withdrawSeq && s.action === "withdraw" && s.undone === 0);
  const prop = trail.filter((s) => s.action === "propose" && s.undone === 1).pop();
  if (w === undefined || prop === undefined)
    return false;
  let fade = null;
  try {
    const f = fadeFactorOf(JSON.parse(prop.detail)["fade"])[0];
    const r = f === undefined ? undefined : store.row(f.id);
    if (f !== undefined && r !== undefined)
      fade = { id: f.id, fade: (typeof r.fade === "number" ? r.fade : 1) * f.factor };
  } catch {
    fade = null;
  }
  store.reinstateProposal({ pairId: pair.id, proposeSeq: prop.seq, withdrawSeq: w.seq, fade });
  return true;
}
export function releaseOrphanSlots(store, day = store.livedDay()) {
  if (store.observer)
    return 0;
  let n = 0;
  try {
    for (const c of store.contradictions({ state: "unsettled", limit: 1e5 })) {
      if (c.source !== SLOT_SOURCE || pairStanding(store, c))
        continue;
      const p = provisionalOf(store, c);
      if (p === null)
        continue;
      const successor = replacedBy(store, p.holds);
      const carry = successor !== null && liveMemory(store, p.over) && !store.contradictionEverBetween(successor, p.over);
      const w = withdrawSlot(store, { pair: c.id, actor: "detector", why: carry ? `its newer memory was replaced by ${String(successor)}` : "one of the two is gone", day });
      if (!w.ok)
        continue;
      n += 1;
      if (carry && successor !== null) {
        let rule = "cosine";
        let cos = 0;
        try {
          const d = JSON.parse(store.contradictionSettles({ pairId: c.id }).find((x) => x.seq === p.seq)?.detail ?? "{}");
          if (d["rule"] === "lineage" || d["rule"] === "title" || d["rule"] === "cosine")
            rule = d["rule"];
          if (typeof d["cosine"] === "number")
            cos = d["cosine"];
        } catch {}
        proposeSlot(store, { holds: successor, candidate: { over: p.over, cosine: cos, rule, sameSession: false }, actorId: null, day, carriedFrom: c.id });
      }
    }
  } catch {}
  return n;
}
function liveMemory(store, id) {
  const r = store.row(id);
  return r !== undefined && r.type === "memory" && r.archived === 0 && r.superseded_by === null && !rowTombstoned(r);
}
function replacedBy(store, id) {
  const r = store.row(id);
  if (r === undefined || r.superseded_by === null)
    return null;
  try {
    const end = store.resolve(id);
    return end !== id && liveMemory(store, end) ? end : null;
  } catch {
    return null;
  }
}
const DREAMING_SETTING_KEY = "dream.setting";
export const SLOT_EXPIRY_META = "reconsolidation.slotExpiry";
export function expireUnanswerableSlots(store, day = store.livedDay()) {
  if (store.observer)
    return 0;
  try {
    if ((store.getMeta(DREAMING_SETTING_KEY) ?? "").trim() !== "off")
      return 0;
    const last = Number(store.getMeta(SLOT_EXPIRY_META) ?? "-1");
    if (last === day)
      return 0;
    let n = 0;
    for (const c of store.contradictions({ state: "unsettled", limit: 1e5 })) {
      if (c.source !== SLOT_SOURCE || day - c.flagged_day < CONTRADICTION_TUNABLES.SLOT_EXPIRY_DAYS || provisionalOf(store, c) === null)
        continue;
      if (withdrawSlot(store, { pair: c.id, actor: "detector", why: "dreaming is off, so nothing answered it", day }).ok)
        n += 1;
    }
    store.setMeta(SLOT_EXPIRY_META, String(day));
    return n;
  } catch {
    return 0;
  }
}
export function slotsToConfirm(store, limit = CONTRADICTION_TUNABLES.SLOT_PER_NIGHT) {
  const waiting = [];
  try {
    for (const c of [...store.contradictions({ state: "unsettled", limit: 1e5 })].reverse()) {
      if (c.source !== SLOT_SOURCE || !pairStanding(store, c))
        continue;
      const p = provisionalOf(store, c);
      if (p !== null)
        waiting.push({ pair: c.id, holds: p.holds, over: p.over });
    }
  } catch {
    return { pairs: [], more: 0 };
  }
  return { pairs: waiting.slice(0, Math.max(0, limit)), more: Math.max(0, waiting.length - Math.max(0, limit)) };
}
function resetHabituation(store, pairId, day) {
  try {
    if (store.getMeta(`${MIND_SEEN_KEY_PREFIX}${pairId}`) !== undefined) {
      store.setMeta(`${MIND_SEEN_KEY_PREFIX}${pairId}`, JSON.stringify({ times: 0, day }));
    }
  } catch {}
}
const MIND_SEEN_KEY_PREFIX = "mind.seen.";
function excerptOf(body, chars) {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= chars)
    return flat;
  const hard = flat.slice(0, Math.max(0, chars - 1));
  const space = hard.lastIndexOf(" ");
  return `${space > chars * 0.6 ? hard.slice(0, space) : hard}…`;
}
export function writeNeighbours(store, input) {
  const T = CONTRADICTION_TUNABLES;
  const row = store.row(input.id);
  if (row === undefined || rowTombstoned(row))
    return [];
  const own = new Set;
  if (input.session !== undefined && input.session !== null) {
    try {
      for (const m of store.memoriesOfSession(input.session))
        if (row.birth_day - m.bornDay <= T.SLOT_WINDOW_DAYS)
          own.add(m.id);
    } catch {}
  }
  const text = `${row.title ?? ""}
${row.body}`;
  const skip = new Set([input.id, ...input.exclude ?? []]);
  const vec = (() => {
    try {
      return store.vectorOf(input.id);
    } catch {
      return null;
    }
  })();
  const cosByHit = new Map;
  const candidates = [...own];
  if (vec !== null) {
    try {
      for (const h of store.nearestTo(vec, T.NEIGHBOUR_CANDIDATES + skip.size)) {
        cosByHit.set(h.id, h.score);
        candidates.push(h.id);
      }
    } catch {}
  }
  try {
    for (const h of store.search(text, T.NEIGHBOUR_CANDIDATES + skip.size))
      candidates.push(h.id);
  } catch {}
  const scored = [];
  const seen = new Set;
  for (const id of candidates) {
    if (seen.has(id) || skip.has(id))
      continue;
    seen.add(id);
    const c = store.row(id);
    if (c === undefined || c.type !== "memory" || c.archived === 1 || c.superseded_by !== null || rowTombstoned(c))
      continue;
    if (c.confidential === 1 && !input.owner)
      continue;
    try {
      if (isHandoff(store.readProse(id)))
        continue;
    } catch {
      continue;
    }
    const lex = similarity(text, `${c.title ?? ""}
${c.body}`);
    let cos = cosByHit.get(id) ?? null;
    if (cos === null && vec !== null) {
      const other = store.vectorOf(id);
      if (other !== null && other.length === vec.length)
        cos = cosine(vec, other);
    }
    if (lex < T.NEIGHBOUR_LEXICAL && (cos === null || cos < T.NEIGHBOUR_COSINE))
      continue;
    scored.push({ id, score: Math.max(lex, cos ?? 0), row: c });
  }
  scored.sort((a, b) => Number(own.has(b.id)) - Number(own.has(a.id)) || b.score - a.score || (a.id < b.id ? -1 : 1));
  const limit = input.limit ?? T.NEIGHBOURS;
  const out = [];
  for (const s of scored) {
    if (out.length >= limit)
      break;
    const head = headOf(store, s.id);
    if (head !== null) {
      if (skip.has(head) || out.some((n) => n.id === head))
        continue;
      const h = store.row(head);
      if (h === undefined || h.confidential === 1 && !input.owner)
        continue;
    }
    out.push({
      id: s.id,
      ...head === null ? {} : { standing: earlierMark(head) },
      title: s.row.title === null || s.row.title.trim().length === 0 ? lineOf({ body: s.row.body }) || null : s.row.title,
      excerpt: excerptOf(s.row.body, T.EXCERPT_CHARS)
    });
  }
  return out;
}
const GUARD_STOP = new Set(("the and for with that this from have has had was were are been being its it's his her hers their theirs they them " + "she he him you your yours our ours who what when where which while about into onto over under after before again " + "also just very more most some any all each every other another than then there here not but can could would should " + "will did does doing done one two three new old now still only same such per via upon user user's users assistant " + "said says say mentioned mentions told tell asked asks noted shared memory memories conversation today yesterday " + "week weeks month months year years day days time times date dated " + "change changed changes changing update updated updates updating correct corrected correction latest current " + "january february march april may june july august september october november december " + "monday tuesday wednesday thursday friday saturday sunday").split(" "));
export function contentWords(text, ignore = new Set) {
  const out = new Set;
  for (const w of text.toLowerCase().split(/[^a-z']+/)) {
    const t = w.replace(/^'+|'+$/g, "").replace(/'s$/, "");
    if (t.length < 3 || GUARD_STOP.has(t) || ignore.has(t))
      continue;
    out.add(t.replace(/(ing|ed|es|s)$/, "").slice(0, 5));
  }
  return out;
}
export function updateRelatedness(input) {
  const ignore = new Set((input.ignoreNames ?? []).flatMap((n) => n.toLowerCase().split(/[^a-z']+/)).filter((w) => w.length >= 3));
  const a = contentWords(input.over, ignore);
  const b = contentWords(input.text, ignore);
  const shared = [...a].filter((w) => b.has(w));
  const x = input.overVec ?? null;
  const y = input.textVec ?? null;
  if (x !== null && y !== null && x.length > 0 && x.length === y.length) {
    const cos = cosine(x, y);
    return { related: cos >= Math.max(CONTRADICTION_TUNABLES.UPDATE_COSINE, input.bar ?? 0), by: "meaning", cosine: round(cos), shared };
  }
  return { related: a.size === 0 || shared.length > 0, by: "words", cosine: null, shared };
}
export function guardBar(store) {
  const T = CONTRADICTION_TUNABLES;
  try {
    const day = store.livedDay();
    const raw = store.getMeta(GUARD_BAR_META);
    if (raw !== undefined) {
      const v = JSON.parse(raw);
      if (v.day === day && typeof v.bar === "number" && Number.isFinite(v.bar))
        return Math.max(T.UPDATE_COSINE, v.bar);
    }
    const m = measureGuardBar(store, day);
    if (!store.observer) {
      try {
        store.setMeta(GUARD_BAR_META, JSON.stringify({ day, bar: m.bar, quantile: m.quantile, pairs: m.pairs, vectors: m.vectors }));
      } catch {}
    }
    return m.bar;
  } catch {
    return T.UPDATE_COSINE;
  }
}
export function measureGuardBar(store, day) {
  const T = CONTRADICTION_TUNABLES;
  let seed = day * 2654435761 >>> 0 || 1;
  const rand = () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 4294967296;
  };
  const ids = store.list({ type: "memory", archived: false });
  for (let i = ids.length - 1;i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const vecs = [];
  for (const id of ids) {
    if (vecs.length >= T.GUARD_BAR_SAMPLE)
      break;
    const v = store.vectorOf(id);
    if (v !== null && (vecs.length === 0 || v.length === vecs[0].length))
      vecs.push(v);
  }
  if (vecs.length < T.GUARD_BAR_MIN_VECTORS)
    return { bar: T.UPDATE_COSINE, quantile: null, pairs: 0, vectors: vecs.length };
  const cos = [];
  for (let k = 0;k < T.GUARD_BAR_PAIRS; k++) {
    const a = Math.floor(rand() * vecs.length);
    let b = Math.floor(rand() * (vecs.length - 1));
    if (b >= a)
      b += 1;
    cos.push(cosine(vecs[a], vecs[b]));
  }
  cos.sort((x, y) => x - y);
  const q = cos[Math.min(cos.length - 1, Math.floor(T.GUARD_BAR_QUANTILE * cos.length))];
  return { bar: Math.max(T.UPDATE_COSINE, round(q)), quantile: round(q), pairs: cos.length, vectors: vecs.length };
}
export function heldView(row, owner) {
  if (row.confidential === 1 && !owner)
    return { title: null, text: null };
  const title = row.title === null || row.title.trim().length === 0 ? lineOf({ body: row.body }) || null : row.title;
  return { title, text: excerptOf(row.body, CONTRADICTION_TUNABLES.HELD_TEXT_CHARS) };
}
export function heldCorrections(store, opts = {}) {
  const holds = heldPairs(store, opts);
  return {
    held: holds.length,
    settledAfter: holds.filter((h) => h.settledAfter).length,
    byMeaning: holds.filter((h) => h.by === "meaning").length,
    byWords: holds.filter((h) => h.by === "words").length
  };
}
export function heldPairs(store, opts = {}) {
  const limit = CONTRADICTION_TUNABLES.HELD_READ_ROWS;
  const read = (raw) => {
    try {
      return JSON.parse(raw ?? "{}");
    } catch {
      return {};
    }
  };
  const holds = store.eventLog({ name: CONTRADICTION_HELD_EVENT, ...opts.sinceDay === undefined ? {} : { sinceDay: opts.sinceDay }, order: "desc", limit }).map((e) => ({ seq: e.seq, day: e.day, p: read(e.payload) }));
  const from = holds.reduce((d, h) => Math.min(d, h.day), Number.POSITIVE_INFINITY);
  const settles = holds.length === 0 ? [] : store.eventLog({ name: CONTRADICTION_SETTLED_EVENT, sinceDay: from, order: "desc", limit }).map((e) => ({ seq: e.seq, p: read(e.payload) }));
  const str = (v) => typeof v === "string" ? v : "";
  return holds.map((h) => ({
    seq: h.seq,
    day: h.day,
    holds: str(h.p["holds"]),
    over: str(h.p["over"]),
    how: str(h.p["how"]),
    by: str(h.p["by"]),
    settledAfter: settles.some((s) => s.seq > h.seq && s.p["holds"] === h.p["holds"] && s.p["over"] === h.p["over"])
  }));
}
