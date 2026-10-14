import { strength } from "../physics/index.js";
import { ABOUT_SETTERS, aboutMarkOf, hashText } from "../store/index.js";
import { scanSecrets } from "../encode/secrets.js";
import {
  IDENTITY_CORE_ROLE,
  byteLength,
  RENDERED_PREFIX,
  enumerate,
  findIdentityCore,
  hintReading,
  identityCoreName,
  rankLanes,
  rankedAs,
  scanActive,
  scanOne,
  reconsideringIds,
  schemaBytes
} from "./identity.js";
import { coveredByPage } from "./covered.js";
import {
  BRIEFING_TRIM_LOG_CAP,
  FRAMING,
  LANE_ORDER,
  TRIM_ORDER,
  WAKE_SYSTEM,
  applyPreface,
  arrivingTense,
  flatten,
  isPageFrameLine,
  PAGE_FLOOR_RESERVE_BYTES,
  pageBlockBytes,
  pageDateline,
  pageEndLine,
  pageTooLargeLine,
  pageTopLine,
  PREFACE_RESERVE_BYTES,
  prefaceLine,
  readSentinel,
  render
} from "./briefing.js";
import {
  PAGE_META_BY,
  PAGE_META_REASON,
  PAGE_META_REVISED_DAY,
  PAGE_META_REVISED_ON,
  PAGE_CLEARED_BODY,
  PAGE_META_CLEARED,
  PAGE_META_SHORT,
  PAGE_TITLE,
  SELF_PAGE_REFUSED_EVENT,
  SELF_PAGE_REVISED_EVENT,
  SELF_PAGE_ROLE,
  findPageRow,
  findSelfPage,
  headingsText,
  outlineText,
  pageOutline,
  readSelfPage,
  shortOf,
  stripRevisedLines
} from "./page.js";
import {
  SELF_PAGE_WRITER_EVENT,
  dayMemories,
  nightClaimFor,
  pageWriterClaimOpen,
  pageWriterDue,
  pageWriterNight,
  pageWriterRuns,
  pageWriterStatus
} from "./writer.js";
import { COUNTER_PREFIX, FROZEN_KINDS, counterKey, decide } from "./freeze.js";
import {
  NO_GATE,
  EPISODE_ABOUT_META,
  appendChapter,
  askDue,
  askText,
  asksSpentOn,
  findIngested,
  freshEpisodeState,
  ingestKey,
  intakeEpisode,
  loadEpisodeState,
  memoriesForEpisode,
  rebasedWatermark,
  stateKey
} from "./episodes.js";
import {
  backfillJournalCopies,
  noteJournalCopy,
  syncJournalCopy
} from "./journal-file.js";
import { withTunables } from "./tunables.js";
import { calendarDate } from "./calendar.js";
import { markWakeBehind } from "./behind.js";
import { pairOrder, standingOf } from "../recall/standing.js";

export * from "./behind.js";
export * from "./briefing.js";
export * from "./calendar.js";
export * from "./journal-file.js";
export * from "./page.js";
export * from "./writer.js";
export * from "./episodes.js";
export * from "./chapter-address.js";
export * from "./freeze.js";
export * from "./identity.js";
export * from "./tunables.js";
export * from "./work.js";
export const BRIEFING_KEY = "self.briefing";
export const THREADS_SHOWN_KEY = "self.threads.shown";
export function threadsShown(store) {
  try {
    const raw = JSON.parse(store.getMeta(THREADS_SHOWN_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set;
  }
}
export const WAKE_SHOWN_KEY = "self.briefing.shown";
export function wakeShown(store) {
  try {
    const raw = JSON.parse(store.getMeta(WAKE_SHOWN_KEY) ?? "null");
    if (raw === null || typeof raw !== "object")
      return null;
    const r = raw;
    const ids = (v) => Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
    const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
    const more = r["more"] ?? {};
    const identity = ids(r["identity"]);
    const craft = ids(r["craft"]);
    const hints = ids(r["hints"]);
    const moreIdentity = ids(more["identity"] ?? []);
    const moreCraft = ids(more["craft"] ?? []);
    const moreHints = ids(more["hints"] ?? []) ?? [];
    const budget = num(r["budget"]);
    const hash = r["hash"];
    if (typeof hash !== "string" || hash.length === 0)
      return null;
    if (r["v"] !== 1 || identity === null || craft === null || hints === null || moreIdentity === null || moreCraft === null || budget === null) {
      return null;
    }
    return {
      v: 1,
      hash,
      ceiling: num(r["ceiling"]),
      budget,
      lend: num(r["lend"]) ?? 0,
      handoffLend: num(r["handoffLend"]) ?? 0,
      handoffKeep: num(r["handoffKeep"]) ?? 0,
      identity,
      craft,
      hints,
      more: { identity: moreIdentity, craft: moreCraft, hints: moreHints }
    };
  } catch {
    return null;
  }
}
export const BOOTSTRAP = "No briefing has been composed yet — this store has not lived a boundary.";
export const NO_PAGE_VERSION = -1;
export const NO_ROOM = Symbol("self-page-no-room");
const SHORT_NOT_KEPT = {
  "not-needed": "the page is within its room, so the wake shows it whole",
  "too-large": "it is past the room itself",
  "gate-refused": "the credential gate turned it away",
  "forged-markers": "it carries the wake's own markers (`<!-- counterparts:wake`)"
};
export function pageRoomNote(written, room, howToAdd) {
  const s = written.short;
  if (written.overRoom === null) {
    if (s === null || s.kept)
      return null;
    return `The short version was not kept: ${SHORT_NOT_KEPT[s.reason]}.`;
  }
  const over = `The page is ${String(written.bytes)} bytes, past its ${String(room)}-byte room. It is kept whole`;
  if (s !== null && s.kept) {
    return `${over}, and on a day the wake has no room for it, sessions read the short version (${String(s.bytes)} bytes) instead, marked as such.`;
  }
  const outline = "on a day the wake has no room for it, sessions read only each section's heading and first sentence";
  if (s === null)
    return `${over}, but ${outline}. Add a short version under ${String(room)} bytes — the whole of it, condensed: ${howToAdd}.`;
  return `${over}, but the short version was not kept (${String(s.bytes)} bytes: ${SHORT_NOT_KEPT[s.reason]}), so ${outline}. Send one under ${String(room)} bytes: ${howToAdd}.`;
}
export const WAKE_MARKER = "<!-- counterparts:wake";
function storedAs(text) {
  return new TextDecoder().decode(new TextEncoder().encode(text));
}
const FENCE_LINE = /^\s{0,3}(?:```|~~~)/u;
function ownWords(text) {
  const dated = stripRevisedLines(text);
  const lines = dated.body.split(`
`);
  const out = [];
  let fenced = false;
  let framed = 0;
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FENCE_LINE.test(line))
      fenced = !fenced;
    if (fenced || !isPageFrameLine(line)) {
      out.push(line);
      continue;
    }
    framed += 1;
    const before = out[out.length - 1];
    if ((before === undefined || before.trim() === "") && (lines[i + 1] ?? "x").trim() === "")
      i += 1;
  }
  return framed === 0 ? { ...dated, framed: 0 } : { body: out.join(`
`).trim(), stripped: dated.stripped, framed };
}
function daysBetween(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b))
    return null;
  return Math.round((b - a) / 86400000);
}
const EVENT_RING = 500;
const PAGE_REVISION_ROWS = 5000;

export class Self {
  store;
  tunables;
  observer;
  gate;
  onEvent;
  onMemoryMinted;
  retarget;
  now;
  zone;
  ring = [];
  volatileState = new Map;
  volatileCounts = new Map;
  constructor(opts) {
    this.store = opts.store;
    this.tunables = withTunables(opts.tunables ?? {});
    this.observer = opts.store.observer;
    this.gate = opts.gate ?? NO_GATE;
    this.onEvent = opts.onEvent;
    this.onMemoryMinted = opts.onMemoryMinted;
    this.retarget = opts.retarget;
    this.now = opts.now ?? (() => Date.now());
    this.zone = opts.zone;
  }
  calendarToday() {
    return calendarDate(this.store.now(), this.dayZone());
  }
  dayZone() {
    return this.zone ?? this.store.zone();
  }
  build(req) {
    return this.buildWithLanes(req).briefing;
  }
  buildWithLanes(req) {
    const all = scanActive(this.store, req.day);
    const scanned = req.omit === undefined ? all : all.filter((s) => !req.omit?.(s));
    const supplied = (req.horizon ?? []).map((h) => this.horizonRank(h, req.day));
    const horizon = [
      ...supplied.filter((r) => r.due === true),
      ...supplied.filter((r) => r.due !== true && r.near === true),
      ...supplied.filter((r) => r.due !== true && r.near !== true)
    ];
    const lanes = rankLanes(scanned, horizon, this.tunables, {
      settledOver: settledOver(this.store),
      coveredByPage: this.pageCovers(scanned),
      workAtDelivery: this.tunables.CRAFT_AT_DELIVERY,
      ...req.horizonMore === undefined || req.omit !== undefined ? {} : { horizonMore: req.horizonMore }
    });
    const docs = new Map;
    const sources = new Map;
    for (const s of scanned) {
      docs.set(s.id, s.doc);
      sources.set(s.id, s.source);
    }
    return { briefing: this.composeLanes(lanes, docs, sources, req), lanes };
  }
  assemble(req) {
    const shown = wakeShown(this.store);
    if (shown === null || shown.hash !== req.publishedHash || shown.ceiling === null || shown.ceiling !== req.ceilingBytes)
      return null;
    const day = req.day;
    const settled = settledOver(this.store);
    const docs = new Map;
    const sources = new Map;
    const note = (s) => {
      docs.set(s.id, s.doc);
      sources.set(s.id, s.source);
      return s;
    };
    const bandOf = (id) => {
      try {
        return this.store.row(id)?.band ?? null;
      } catch {
        return null;
      }
    };
    const supplied = (req.horizon ?? []).filter((h) => bandOf(h.id) !== "identity").map((h) => this.horizonRank(h, day));
    const horizon = [
      ...supplied.filter((r) => r.due === true),
      ...supplied.filter((r) => r.due !== true && r.near === true),
      ...supplied.filter((r) => r.due !== true && r.near !== true)
    ];
    const flagged = reconsideringIds(this.store);
    const openIds = [...new Set([...this.store.openThreadIds(), ...flagged])];
    const open = [];
    for (const id of openIds) {
      const s = scanOne(this.store, id, day);
      if (s === null)
        continue;
      if (s.band === "identity" && flagged.has(id))
        open.push(note({ ...s, reconsidering: true }));
      else if (s.unresolved && s.band !== "identity")
        open.push(note(s));
    }
    const fresh = rankLanes(open, horizon, this.tunables, {
      settledOver: settled,
      workAtDelivery: this.tunables.CRAFT_AT_DELIVERY,
      ...req.horizonMore === undefined ? {} : { horizonMore: req.horizonMore }
    });
    const opened = new Set(openIds);
    const arriving = new Set(fresh.horizon.map((r) => r.id));
    const carried = (ids, lane) => {
      const out = [];
      for (const id of ids) {
        if (lane !== "identity" && (opened.has(id) || arriving.has(id) || settled.has(id)))
          continue;
        if (lane === "identity" && flagged.has(id))
          continue;
        const s = scanOne(this.store, id, day);
        if (s === null || s.doc.body.trim().length === 0)
          continue;
        if (lane === "identity" !== (s.band === "identity"))
          continue;
        out.push(s);
      }
      return out;
    };
    const hintsScanned = carried([...shown.hints, ...shown.more.hints], "hints");
    const covered = hintsScanned.length === 0 ? new Set : this.pageCovers(hintsScanned);
    const lanes = {
      identity: carried(shown.identity, "identity").map((s) => rankedAs(note(s), "identity")),
      craft: carried(shown.craft, "craft").map((s) => rankedAs(note(s), "craft")),
      hints: hintsScanned.filter((s) => !covered.has(s.id)).map((s) => rankedAs(note(s), "hints")),
      threads: fresh.threads,
      horizon: fresh.horizon,
      overflow: {
        identity: [...shown.more.identity],
        craft: [...shown.more.craft],
        hints: [],
        threads: fresh.overflow?.threads ?? [],
        horizon: fresh.overflow?.horizon ?? []
      }
    };
    return this.composeLanes(lanes, docs, sources, {
      day,
      budgetBytes: shown.budget,
      ...req.horizon === undefined ? {} : { horizon: req.horizon },
      ...req.yesterday === undefined ? {} : { yesterday: req.yesterday },
      ...req.yesterdayShorter === undefined ? {} : { yesterdayShorter: req.yesterdayShorter },
      ...req.elsewhere === undefined ? {} : { elsewhere: req.elsewhere },
      ...req.elsewhereShorter === undefined ? {} : { elsewhereShorter: req.elsewhereShorter },
      ...shown.lend > 0 ? { lendBytes: shown.lend } : {},
      ...shown.handoffLend > 0 ? { handoffLendBytes: shown.handoffLend } : {},
      ...shown.handoffKeep > 0 ? { handoffKeepBytes: shown.handoffKeep } : {}
    });
  }
  composeLanes(lanes, docs, sources, req) {
    const base = req.resolve ?? ((id) => this.resolveStatement(id, docs, sources));
    const dues = new Map;
    for (const h of req.horizon ?? []) {
      if (h.due === undefined || h.due.trim() === "")
        continue;
      const every = h.every?.trim() ?? "";
      dues.set(h.id, {
        due: h.due.trim(),
        ...every === "" ? {} : { every },
        ...h.past === true ? { duePast: true } : {}
      });
    }
    const resolve = dues.size === 0 ? base : (id) => {
      const r = base(id);
      const due = dues.get(id);
      return due === undefined ? r : { ...r, ...due };
    };
    const coreName = req.omit === undefined && lanes.identity.length === 0 ? identityCoreName(this.store) : null;
    const lend = req.lendBytes === undefined || req.omit !== undefined ? 0 : Math.max(0, Math.floor(req.lendBytes));
    const choose = (below) => req.omit !== undefined && !this.tunables.PAGE_ON_EGRESS ? { block: null, took: 0 } : this.pageBlock(req.budgetBytes, lend, below);
    const renderWith = (choice) => {
      const { block, took } = choice;
      const page = block === NO_ROOM ? null : block;
      const pageExists = block !== null;
      return render(lanes, {
        budgetBytes: req.budgetBytes + took,
        pageExists,
        day: req.day,
        ...coreName === null ? {} : { coreName },
        ...page === null ? {} : { page },
        ...req.yesterday === undefined || req.omit !== undefined ? {} : { yesterday: req.yesterday },
        ...req.yesterdayShorter === undefined || req.yesterday === undefined || req.omit !== undefined ? {} : { yesterdayShorter: req.yesterdayShorter },
        ...req.lendBytes === undefined || req.omit !== undefined ? {} : { lendBytes: lend - took },
        ...req.handoffLendBytes === undefined || req.omit !== undefined ? {} : { handoffLendBytes: Math.max(0, Math.floor(req.handoffLendBytes)) },
        ...req.handoffKeepBytes === undefined || req.omit !== undefined ? {} : { handoffKeepBytes: Math.max(0, Math.floor(req.handoffKeepBytes)) },
        ...req.elsewhere === undefined || req.omit !== undefined ? {} : { elsewhere: req.elsewhere },
        ...req.elsewhereShorter === undefined || req.elsewhere === undefined || req.omit !== undefined ? {} : { elsewhereShorter: req.elsewhereShorter }
      }, resolve, this.tunables);
    };
    const chosen = choose();
    const out = renderWith(chosen);
    const due = lanes.horizon.filter((r) => r.due === true).map((r) => r.id);
    const unlisted = (o) => due.some((id) => !o.kept.horizon.includes(id));
    let current = chosen;
    while (due.length > 0 && current.took > 0 && unlisted(out) && current.block !== null && current.block !== NO_ROOM) {
      const next = choose(current.block.rung);
      if (next.block === null || next.block === NO_ROOM)
        break;
      const stepped = renderWith(next);
      if (!unlisted(stepped))
        return stepped;
      current = next;
    }
    return out;
  }
  pageCovers(scanned) {
    try {
      const page = this.page();
      if (page === null)
        return new Set;
      const cited = new Set;
      const ref = /\breflection (rfl_[0-9a-f]+)/.exec(page.reason ?? "")?.[1];
      if (page.by === "reflection" && ref !== undefined) {
        const raw = JSON.parse(this.store.reflection(ref)?.cites ?? "[]");
        if (Array.isArray(raw)) {
          for (const id of raw)
            if (typeof id === "string")
              cited.add(id);
        }
      }
      return coveredByPage(page.body, scanned, cited);
    } catch {
      return new Set;
    }
  }
  page() {
    return readSelfPage(this.store);
  }
  pageStale(page = this.page()) {
    if (page === null)
      return false;
    const days = daysBetween(page.revisedOn.trim(), this.store.today());
    return days === null ? true : days > this.tunables.PAGE_STALE_DAYS;
  }
  pageVersionCount() {
    const id = this.pageRowId();
    return id === null ? 0 : this.store.versions(id).length;
  }
  pageVersions(opts = {}) {
    const id = this.pageRowId();
    if (id === null)
      return [];
    const wrote = new Map;
    try {
      for (const row of this.store.eventLog({ name: SELF_PAGE_REVISED_EVENT, ref: id, order: "desc", limit: PAGE_REVISION_ROWS })) {
        const payload = JSON.parse(row.payload ?? "{}");
        const v = payload["version"];
        if (typeof v !== "number" || wrote.has(v))
          continue;
        wrote.set(v, {
          reason: typeof payload["reason"] === "string" ? payload["reason"] : null,
          by: typeof payload["by"] === "string" ? payload["by"] : null
        });
      }
    } catch {}
    return this.store.versions(id).slice().sort((a, b) => b.seq - a.seq).map((v) => {
      let body = null;
      if (opts.bodies !== false) {
        try {
          body = this.store.readVersion(id, v.seq).body;
        } catch {
          body = null;
        }
      }
      const wroteIt = wrote.get(v.seq - 1) ?? { reason: null, by: null };
      return {
        seq: v.seq,
        day: v.version_day,
        body,
        bytes: body === null ? null : byteLength(body),
        reason: wroteIt.reason,
        by: wroteIt.by,
        replacedBy: v.reason
      };
    });
  }
  restorePage(seq, opts = {}) {
    const id = this.pageRowId();
    const none = {
      id: null,
      version: null,
      bytes: 0,
      gate: null,
      redacted: null,
      current: null,
      overRoom: null,
      short: null
    };
    if (id === null)
      return { ...none, written: false, reason: "empty" };
    let body;
    let short = null;
    try {
      const doc = this.store.readVersion(id, seq);
      body = doc.body;
      short = shortOf(doc.meta, doc.body)?.body ?? null;
    } catch {
      return { ...none, written: false, reason: "no-such-version" };
    }
    return this.revisePage(body, {
      reason: opts.reason ?? `restored version ${seq}`,
      by: "owner",
      ...opts.day === undefined ? {} : { day: opts.day },
      ...short === null ? {} : { short }
    });
  }
  addPageShort(short, opts) {
    const page = this.page();
    const none = {
      id: null,
      version: null,
      gate: null,
      redacted: null,
      current: null,
      overRoom: null
    };
    if (this.observer) {
      this.emit("self.observer.standdown", undefined, { site: "addPageShort" });
      return { ...none, written: false, reason: "observer", bytes: 0, short: null };
    }
    const refuse = (reason, detail) => {
      this.emit("self.page.refused", undefined, { reason, by: opts.by, ...detail });
      try {
        this.store.appendEvent({
          name: SELF_PAGE_REFUSED_EVENT,
          day: opts.day ?? this.store.livedDay(),
          payload: { reason, by: opts.by, session: opts.session ?? null, ...detail }
        });
      } catch {}
    };
    if (page === null) {
      refuse("no-page", { short: true });
      return { ...none, written: false, reason: "no-page", bytes: 0, short: null };
    }
    if (short.trim().length === 0) {
      refuse("empty", { short: true });
      return { ...none, written: false, reason: "empty", bytes: 0, short: null };
    }
    if (opts.ifVersion !== undefined && opts.ifVersion !== page.version) {
      return this.revisePage(page.body, { ...opts, reason: opts.reason ?? "added a short version", short });
    }
    const verdict = this.shortVerdict(short, page.bytes, opts.by);
    if (!verdict.outcome.kept) {
      const reason = verdict.outcome.reason === "not-needed" ? "short-not-needed" : "short-refused";
      refuse(reason, { short: verdict.outcome.reason, bytes: verdict.outcome.bytes, room: verdict.outcome.room });
      return {
        ...none,
        written: false,
        reason,
        id: page.id,
        version: page.version,
        bytes: page.bytes,
        short: verdict.outcome
      };
    }
    return this.revisePage(page.body, {
      ...opts,
      ifVersion: opts.ifVersion ?? page.version,
      reason: opts.reason ?? "added a short version",
      short
    });
  }
  shortVerdict(raw, pageBytes, by) {
    const room = this.tunables.PAGE_ROOM_BYTES;
    const draft = ownWords(raw.replace(/\r\n/g, `
`).trim()).body;
    const sent = byteLength(draft);
    const out = (reason, bytes = sent, redacted = false) => ({
      outcome: { kept: false, reason, bytes, room, redacted },
      text: null
    });
    if (pageBytes <= room)
      return out("not-needed");
    if (draft.includes(WAKE_MARKER))
      return out("forged-markers");
    if (sent > room)
      return out("too-large");
    const verdict = this.gate({ text: draft, handles: [], sessionId: `page-short:${by}` });
    if (!verdict.ok)
      return out("gate-refused");
    const text = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : draft;
    const bytes = byteLength(text);
    if (bytes > room)
      return out("too-large", bytes, text !== draft);
    return { outcome: { kept: true, reason: "kept", bytes, room, redacted: text !== draft }, text };
  }
  pageRowId() {
    return findPageRow(this.store);
  }
  revisePage(body, opts) {
    const day = opts.day ?? this.store.livedDay();
    const own = ownWords(body.replace(/\r\n/g, `
`).trim());
    const draft = own.body;
    let bytes = byteLength(draft);
    const session = opts.session ?? null;
    const none = {
      id: null,
      version: null,
      gate: null,
      redacted: null,
      current: null,
      overRoom: null,
      short: null
    };
    const refuse = (reason, detail, extra = {}) => {
      this.emit("self.page.refused", undefined, { reason, by: opts.by, ...detail });
      try {
        this.store.appendEvent({
          name: SELF_PAGE_REFUSED_EVENT,
          day,
          payload: { reason, by: opts.by, session, ...detail }
        });
      } catch {}
      return { ...none, written: false, reason, bytes, ...extra };
    };
    if (this.observer) {
      this.emit("self.observer.standdown", undefined, { site: "revisePage" });
      return { ...none, written: false, reason: "observer", bytes };
    }
    if (draft.length === 0)
      return refuse("empty", { bytes: 0 });
    const limit = this.tunables.PAGE_MAX_BYTES;
    const room = this.tunables.PAGE_ROOM_BYTES;
    if (bytes > limit) {
      return refuse("too-large", { bytes, limit });
    }
    if (draft.includes(WAKE_MARKER))
      return refuse("forged-markers", { bytes });
    const before = readSelfPage(this.store);
    if (opts.ifVersion !== undefined) {
      const at = before?.version ?? NO_PAGE_VERSION;
      if (at !== opts.ifVersion) {
        const reason = before === null ? "no-page" : opts.ifVersion === NO_PAGE_VERSION ? "page-appeared" : "version-moved";
        return refuse(reason, { bytes, expected: opts.ifVersion, at }, {
          current: before === null ? null : { version: before.version, body: before.body }
        });
      }
    }
    const verdict = this.gate({ text: draft, handles: [], sessionId: `page:${opts.by}` });
    if (!verdict.ok) {
      return refuse("gate-refused", { bytes, gate: verdict.gate, gateReason: verdict.reason }, { gate: { gate: verdict.gate, reason: verdict.reason } });
    }
    const text = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : draft;
    const redacted = text === draft ? null : { gate: "secrets", bytesBefore: bytes };
    bytes = byteLength(text);
    if (bytes > limit)
      return refuse("too-large", { bytes, limit, redacted: true });
    const sent = opts.short === undefined || opts.short.trim().length === 0 ? null : this.shortVerdict(opts.short, bytes, opts.by);
    const existing = findPageRow(this.store);
    const meta = {
      role: SELF_PAGE_ROLE,
      [PAGE_META_BY]: opts.by,
      [PAGE_META_REASON]: opts.reason,
      [PAGE_META_REVISED_ON]: this.store.today(),
      [PAGE_META_REVISED_DAY]: day,
      [PAGE_META_CLEARED]: null,
      [PAGE_META_SHORT]: sent === null || sent.text === null ? null : { body: sent.text, of: hashText(storedAs(text)), bytes }
    };
    let id;
    let version;
    if (existing === null) {
      id = this.store.put({
        type: "schema",
        kind: "self",
        title: PAGE_TITLE,
        body: text,
        meta,
        learnedOn: this.store.today(),
        ...opts.model === undefined ? {} : { model: opts.model },
        physics: { protected: true }
      });
      version = 0;
    } else {
      id = existing;
      version = this.store.revise(id, {
        body: text,
        title: PAGE_TITLE,
        meta,
        reason: opts.reason,
        ...opts.model === undefined ? {} : { model: opts.model }
      });
      if (this.store.row(id)?.protected !== 1)
        this.store.updatePhysics(id, { protected: true });
    }
    this.store.appendEvent({
      name: SELF_PAGE_REVISED_EVENT,
      day,
      ref: id,
      payload: {
        by: opts.by,
        session,
        reason: opts.reason,
        bytes,
        ...redacted === null ? {} : { redacted: true, redactedBy: redacted.gate },
        version,
        created: existing === null,
        limit,
        room,
        ...sent === null ? {} : { short: sent.outcome.reason, shortBytes: sent.outcome.bytes },
        ...own.stripped === 0 ? {} : { datelines: own.stripped },
        ...own.framed === 0 ? {} : { frameLines: own.framed }
      }
    });
    this.emit("self.page.revised", id, {
      by: opts.by,
      bytes,
      version,
      created: existing === null,
      overRoom: bytes > room,
      short: sent?.outcome.reason ?? null
    });
    markWakeBehind(this.store, "page");
    return {
      written: true,
      reason: existing === null ? "created" : "revised",
      id,
      version,
      bytes,
      gate: null,
      redacted,
      current: null,
      overRoom: bytes > room ? room : null,
      short: sent?.outcome ?? null
    };
  }
  pageWriterDue(opts) {
    const night = opts.today === undefined ? pageWriterNight(this.store, this.dayZone()) : null;
    return pageWriterDue(this.store, {
      mode: opts.mode,
      today: opts.today ?? night.today,
      ...night === null ? {} : { about: night.about },
      observer: this.observer,
      asksPerDay: this.tunables.PAGE_WRITER_ASKS_PER_DAY
    });
  }
  pageWriterInput(opts) {
    const day = opts.day ?? this.store.livedDay();
    const picked = dayMemories(this.store, {
      about: opts.about,
      day,
      budgetBytes: opts.budgetBytes ?? this.tunables.PAGE_WRITER_MEMORY_BYTES,
      max: opts.max ?? this.tunables.PAGE_WRITER_MEMORY_MAX,
      ...opts.omit === undefined ? {} : { omit: opts.omit }
    });
    return {
      about: opts.about,
      today: opts.today ?? this.calendarToday(),
      page: this.page(),
      memories: picked.memories,
      dropped: picked.dropped,
      omitted: picked.omitted,
      bytes: picked.bytes
    };
  }
  recordPageWriterRun(run) {
    const day = run.day ?? this.store.livedDay();
    const payload = {
      about: run.about,
      on: this.calendarToday(),
      mode: run.mode,
      outcome: run.outcome,
      detail: run.detail ?? "",
      bytesBefore: run.bytesBefore ?? 0,
      bytesAfter: run.bytesAfter ?? 0,
      considered: run.considered ?? 0,
      omitted: run.omitted ?? 0,
      ...run.session === undefined || run.session.length === 0 ? {} : { session: run.session },
      ...run.run === undefined || run.run.length === 0 ? {} : { run: run.run }
    };
    if (this.observer) {
      this.emit("self.observer.standdown", undefined, { site: "recordPageWriterRun" });
      return false;
    }
    try {
      this.store.appendEvent({
        name: SELF_PAGE_WRITER_EVENT,
        day,
        payload,
        ...run.dedupKey === undefined ? {} : { dedupKey: run.dedupKey }
      });
    } catch {
      this.emit("self.page.writer.unrecorded", undefined, { about: run.about, outcome: run.outcome });
      return false;
    }
    this.emit("self.page.writer.ran", undefined, {
      about: run.about,
      mode: run.mode,
      outcome: run.outcome,
      bytesAfter: payload.bytesAfter
    });
    return true;
  }
  pageWriterStatus(about, today) {
    return pageWriterStatus(this.store, about, today ?? this.calendarToday());
  }
  pageWriterRuns(opts = {}) {
    return pageWriterRuns(this.store, opts);
  }
  pageWriterClaimOpen(about, today) {
    return pageWriterClaimOpen(this.store, about, today ?? this.calendarToday());
  }
  nightClaimFor(session, today) {
    return nightClaimFor(this.store, session, today ?? this.calendarToday());
  }
  clearPage(opts) {
    const day = opts.day ?? this.store.livedDay();
    const none = {
      id: null,
      version: null,
      bytes: 0,
      gate: null,
      redacted: null,
      current: null,
      overRoom: null,
      short: null
    };
    if (this.observer) {
      this.emit("self.observer.standdown", undefined, { site: "clearPage" });
      return { ...none, written: false, reason: "observer" };
    }
    const page = readSelfPage(this.store);
    if (page === null)
      return { ...none, written: false, reason: "empty" };
    const version = this.store.revise(page.id, {
      body: PAGE_CLEARED_BODY,
      meta: {
        [PAGE_META_REASON]: opts.reason,
        [PAGE_META_CLEARED]: { on: this.store.today(), reason: opts.reason },
        [PAGE_META_SHORT]: null
      },
      reason: opts.reason
    });
    this.store.appendEvent({
      name: SELF_PAGE_REVISED_EVENT,
      day,
      ref: page.id,
      payload: {
        by: "owner",
        session: null,
        reason: opts.reason,
        cleared: true,
        bytes: page.bytes,
        version,
        created: false,
        limit: this.tunables.PAGE_MAX_BYTES
      }
    });
    this.emit("self.page.revised", page.id, { by: "owner", cleared: true, version });
    markWakeBehind(this.store, "page");
    return { ...none, written: true, reason: "cleared", id: page.id, version, bytes: page.bytes };
  }
  pageBlock(budgetBytes, lend = 0, below) {
    const page = this.page();
    if (page === null)
      return { block: null, took: 0 };
    const dateline = pageDateline(page.revisedOn, this.pageStale(page), this.tunables.PAGE_STALE_DAYS);
    const own = ownWords(page.body);
    const body = own.body.length === 0 ? page.body : own.body;
    const wholeBytes = byteLength(body);
    const room = budgetBytes - PAGE_FLOOR_RESERVE_BYTES;
    const outline = pageOutline(body);
    const rung = (r, text) => text === null || text.trim().length === 0 ? null : {
      text,
      top: pageTopLine(r, wholeBytes),
      end: pageEndLine(r),
      dateline: r === "line" ? null : dateline,
      rung: r,
      truncated: r !== "whole",
      wholeBytes
    };
    const ladder = [
      rung("whole", body),
      rung("short", page.short?.body ?? null),
      rung("outline", outlineText(outline)),
      rung("headings", headingsText(outline)),
      rung("line", pageTooLargeLine(wholeBytes))
    ].filter((b) => b !== null);
    const from = below === undefined ? 0 : ladder.findIndex((b) => b.rung === below) + 1;
    for (const block of ladder.slice(from)) {
      const cost = pageBlockBytes(block);
      if (cost <= room)
        return { block, took: 0 };
      if (lend > 0 && cost <= room + lend)
        return { block, took: cost - room };
    }
    return { block: NO_ROOM, took: 0 };
  }
  boundary(req) {
    if (req.identityCore !== undefined)
      this.ensureIdentityCore(req.identityCore);
    const { briefing, lanes } = this.buildWithLanes(req);
    const schema = schemaBytes(this.store, req.day, this.tunables);
    const hash = hashText(briefing.text);
    for (const t of briefing.trimmed) {
      this.emit("self.briefing.trim", t.id, { lane: t.lane, strength: round(t.strength) });
    }
    this.emit("self.briefing.rendered", undefined, {
      day: req.day,
      bytes: briefing.bytes,
      budget: briefing.budgetBytes,
      elements: briefing.elements,
      identity: briefing.counts.identity,
      craft: briefing.counts.craft,
      threads: briefing.counts.threads,
      hints: briefing.counts.hints,
      horizon: briefing.counts.horizon,
      trimmed: briefing.trimmed.length,
      counted: Object.values(briefing.more).reduce((n, k) => n + (k ?? 0), 0),
      folded: briefing.folded,
      untold: Object.values(briefing.untold).reduce((n, k) => n + (k ?? 0), 0),
      untoldLanes: LANE_ORDER.filter((l) => (briefing.untold[l] ?? 0) > 0).join(","),
      quiet: Object.values(briefing.quiet).reduce((n, k) => n + (k ?? 0), 0),
      page: briefing.page?.bytes ?? 0,
      pageWhole: briefing.page?.wholeBytes ?? 0,
      pageTruncated: briefing.page?.truncated ?? false,
      pageRung: briefing.page?.rung ?? (this.page() === null ? "" : "none"),
      hash
    });
    if (briefing.pressure) {
      this.emit("self.briefing.pressure", undefined, {
        bytes: briefing.bytes,
        budget: briefing.budgetBytes
      });
    }
    if (briefing.overBudget) {
      this.emit("self.briefing.overbudget", undefined, {
        bytes: briefing.bytes,
        budget: briefing.budgetBytes,
        floor: true
      });
    }
    if (schema.quarantined > 0) {
      this.emit("self.schema.quarantined", undefined, {
        count: schema.quarantined,
        bytes: schema.quarantinedBytes
      });
    }
    if (schema.pressure) {
      this.emit("self.schema.pressure", undefined, {
        bytes: schema.bytes,
        at: schema.pressureAt,
        elements: schema.elements
      });
    }
    if (schema.tripped) {
      this.emit("self.schema.tripped", undefined, {
        bytes: schema.bytes,
        trip: schema.trip,
        elements: schema.elements
      });
    }
    if (this.observer) {
      this.emit("self.observer.standdown", undefined, { site: "boundary:publish" });
      return { briefing, schema, published: false, reason: "observer", hash };
    }
    this.store.setMetaMany([
      [BRIEFING_KEY, briefing.text],
      [THREADS_SHOWN_KEY, JSON.stringify(briefing.kept.threads)],
      [WAKE_SHOWN_KEY, JSON.stringify(shownRecord(briefing, lanes, req, hash))]
    ]);
    if (briefing.kept.identity.length > 0) {
      this.store.setMetaMany(briefing.kept.identity.map((id) => [`${RENDERED_PREFIX}${id}`, String(req.day)]));
    }
    this.emit("self.briefing.published", undefined, { bytes: briefing.bytes, hash });
    try {
      const displays = this.store.wakeDisplays();
      const kept = briefing.kept.hints.map((id) => ({
        id,
        load: hintReading(this.store.physicsOf(id), displays.get(id), req.day, this.tunables).nextLoad
      }));
      this.store.recordHintDisplay(req.day, kept);
    } catch (err) {
      this.emit("self.hints.display.failed", undefined, { error: err instanceof Error ? err.name : "UNKNOWN" });
    }
    this.backfillJournal(req.day);
    return { briefing, schema, published: true, reason: "published", hash };
  }
  backfillJournal(day) {
    try {
      const report = backfillJournalCopies(this.store);
      for (const result of report.results) {
        noteJournalCopy(this.store, result, { day, site: "backfill" });
      }
      if (report.written > 0 || report.failed > 0 || report.sweptTemps > 0) {
        this.emit("self.journal.backfill", undefined, {
          written: report.written,
          failed: report.failed,
          swept: report.sweptTemps,
          more: report.more
        });
      }
    } catch {}
  }
  wake(delivery, assembled) {
    const raw = assembled ?? this.store.getMeta(BRIEFING_KEY);
    if (raw === undefined) {
      this.emit("self.wake", undefined, { ok: false, reason: "absent", bytes: 0 });
      return {
        text: BOOTSTRAP,
        ok: false,
        reason: "absent",
        bytes: byteLength(BOOTSTRAP),
        sentinel: null,
        reading: null,
        preface: null
      };
    }
    if (raw.length === 0) {
      this.emit("self.wake", undefined, { ok: false, reason: "empty-read", bytes: 0 });
      return {
        text: BOOTSTRAP,
        ok: false,
        reason: "empty-read",
        bytes: 0,
        sentinel: null,
        reading: null,
        preface: null
      };
    }
    const reading = readSentinel(raw);
    const reason = !reading.present ? "sentinel-missing" : reading.intact ? "delivered" : "sentinel-mismatch";
    const preface = delivery === undefined || reason !== "delivered" ? null : prefaceLine({
      system: WAKE_SYSTEM,
      day: this.store.livedDay(),
      ...delivery.date === undefined ? {} : { date: delivery.date },
      memories: this.store.countMemories({ type: "memory", archived: false }),
      liveRows: this.store.countMemories({ archived: false }),
      ...assembled === undefined ? {} : { assembled: true }
    });
    const body = preface === null || delivery?.date === undefined ? raw : arrivingTense(raw, delivery.date, PREFACE_RESERVE_BYTES - byteLength(preface) - 1 - 2);
    const spliced = preface === null ? null : applyPreface(body, preface);
    const delivered = preface === null || spliced === null || spliced.applied ? spliced : applyPreface(raw, preface);
    this.emit("self.wake", undefined, {
      ok: reason === "delivered",
      reason,
      bytes: delivered?.bytes ?? reading.actualBytes,
      stated: reading.statedBytes,
      elements: reading.statedElements,
      preface: delivered?.applied ?? false
    });
    return {
      text: delivered?.text ?? raw,
      ok: reason === "delivered",
      reason,
      bytes: delivered?.bytes ?? reading.actualBytes,
      sentinel: delivered?.sentinel ?? reading.line,
      reading,
      preface: delivered?.applied === true ? preface : null
    };
  }
  noteDelivered(sentinelSeen, expected) {
    const ok = expected !== null && sentinelSeen === expected;
    this.emit("self.wake.delivered", undefined, {
      ok,
      sawSentinel: sentinelSeen !== null,
      expected: expected !== null
    });
    return ok;
  }
  enumerate(day) {
    return enumerate(this.store, day ?? this.store.livedDay());
  }
  ensureIdentityCore(spec) {
    const existing = findIdentityCore(this.store);
    if (existing !== null)
      return { id: existing, created: false, reason: "exists" };
    if (spec.name.trim().length === 0) {
      this.emit("self.core.skipped", undefined, { reason: "no-name" });
      return { id: null, created: false, reason: "no-name" };
    }
    if (this.observer) {
      this.emit("self.observer.standdown", undefined, { site: "ensureIdentityCore" });
      return { id: null, created: false, reason: "observer" };
    }
    const id = this.store.put({
      type: "schema",
      kind: "self",
      title: spec.name,
      body: spec.name,
      meta: {
        role: IDENTITY_CORE_ROLE,
        name: spec.name,
        aliases: [...spec.aliases ?? []]
      }
    });
    this.emit("self.core.minted", id, { aliases: (spec.aliases ?? []).length });
    return { id, created: true, reason: "created" };
  }
  schemaBytes(day) {
    return schemaBytes(this.store, day ?? this.store.livedDay(), this.tunables);
  }
  noteSelfConfirmation(occasion) {
    const day = occasion.day ?? this.store.livedDay();
    const tier = occasion.tier ?? "referenced";
    let resolvedId;
    try {
      resolvedId = this.store.resolve(occasion.elementId);
    } catch {
      this.emit("self.claim.unresolved", occasion.elementId, {
        source: occasion.source,
        direction: occasion.direction
      });
      return {
        frozen: false,
        reason: "unresolved",
        resolvedId: null,
        kind: null,
        band: null,
        reinforced: false,
        credit: null,
        strengthBefore: null,
        strengthAfter: null,
        count: 0
      };
    }
    const before = this.store.physicsOf(resolvedId);
    const row = this.store.row(resolvedId);
    const band = row?.band ?? "episodic";
    const kind = before.kind;
    const verdict = decide(kind, occasion.source, occasion.direction);
    const strengthBefore = strength(before, day);
    const wouldMove = occasion.direction === "confirm";
    const credit = !verdict.frozen && wouldMove && !this.observer ? this.store.reinforce(resolvedId, day, tier, { session: occasion.session ?? null }) : null;
    const after = this.store.physicsOf(resolvedId);
    const count = this.bumpCount(kind, verdict.frozen);
    this.emit("self.claim.repeat", resolvedId, {
      frozen: verdict.frozen,
      reason: this.observer ? "observer" : verdict.reason,
      kind,
      band,
      source: occasion.source,
      direction: occasion.direction,
      tier,
      day,
      addressed: occasion.elementId === resolvedId ? "direct" : "forwarded",
      reinforced: credit?.credited === true,
      count
    });
    if (this.observer) {
      this.emit("self.observer.standdown", resolvedId, { site: "noteSelfConfirmation" });
    }
    return {
      frozen: verdict.frozen,
      reason: this.observer ? "observer" : verdict.reason,
      resolvedId,
      kind,
      band,
      reinforced: credit?.credited === true,
      credit,
      strengthBefore,
      strengthAfter: strength(after, day),
      count
    };
  }
  claimCounts() {
    const out = {};
    for (const kind of ["self", "skill", "person", "entity", "place", "fact"]) {
      for (const frozen of [true, false]) {
        const key = counterKey(kind, frozen);
        const value = this.observer ? this.volatileCounts.get(key) ?? 0 : Number(this.store.getMeta(key) ?? "0");
        if (value > 0)
          out[key] = value;
      }
    }
    return out;
  }
  episodeState(sessionId, day) {
    const d = day ?? this.store.livedDay();
    if (this.observer) {
      return this.volatileState.get(sessionId) ?? freshEpisodeState(sessionId, d);
    }
    return loadEpisodeState(this.store, sessionId, d).state;
  }
  askDue(sessionId, substance, day, opts = {}) {
    const d = day ?? this.store.livedDay();
    return askDue(this.pacedState(sessionId, substance, d, opts).state, substance, this.tunables, {
      observer: this.observer,
      today: this.calendarToday(),
      unwritten: opts.unwritten ?? null
    });
  }
  pacedState(sessionId, substance, day, opts) {
    const state = this.episodeState(sessionId, day);
    if (opts.rebase === false || sessionId.trim().length === 0)
      return { state, rebased: false };
    const rebased = rebasedWatermark(state, substance);
    return rebased === null ? { state, rebased: false } : { state: rebased, rebased: true };
  }
  openChapter(sessionId, substance, day, opts = {}) {
    const d = day ?? this.store.livedDay();
    const today = this.calendarToday();
    const paced = this.pacedState(sessionId, substance, d, opts);
    const state = paced.state;
    if (paced.rebased) {
      this.emit("self.episode.rebased", sessionId, {
        fromTurns: this.episodeState(sessionId, d).askedAtTurns,
        toTurns: state.askedAtTurns
      });
      this.persistState(state, "rebase");
    }
    const verdict = askDue(state, substance, this.tunables, {
      observer: this.observer,
      today,
      unwritten: opts.unwritten ?? null
    });
    if (!verdict.due) {
      this.emit("self.episode.ask.skipped", sessionId, {
        reason: verdict.reason,
        chapter: verdict.chapter,
        sinceTurns: verdict.sinceTurns,
        sinceBytes: verdict.sinceBytes
      });
      return { asked: false, verdict, ask: null, chapter: verdict.chapter };
    }
    const advanced = {
      ...state,
      asks: state.asks + 1,
      asksToday: asksSpentOn(state, today) + 1,
      asksDay: today,
      lastAskAt: this.store.now(),
      askedAtTurns: substance.turns,
      askedAtBytes: substance.bytes,
      lastDay: d
    };
    this.persistState(advanced, "openChapter");
    this.emit("self.episode.ask", sessionId, {
      chapter: verdict.chapter,
      reason: verdict.reason,
      turns: substance.turns,
      bytes: substance.bytes,
      asks: advanced.asks,
      asksToday: advanced.asksToday,
      asksDay: today
    });
    return { asked: true, verdict, ask: askText(verdict.chapter), chapter: verdict.chapter };
  }
  appendChapter(sessionId, text, opts = {}) {
    const d = opts.day ?? this.store.livedDay();
    if (sessionId.trim().length === 0) {
      this.emit("self.episode.skipped", undefined, { reason: "anonymous-session" });
      return { episodeId: null, chapter: 0, created: false, heading: false, reason: "anonymous-session", copy: null };
    }
    if (this.observer) {
      this.emit("self.observer.standdown", sessionId, { site: "appendChapter" });
      return { episodeId: null, chapter: 0, created: false, heading: false, reason: "observer", copy: null };
    }
    const verdict = this.gate({ text, handles: [], sessionId });
    if (!verdict.ok) {
      this.emit("self.episode.chapter.refused", sessionId, {
        gate: verdict.gate,
        reason: verdict.reason
      });
      return { episodeId: null, chapter: 0, created: false, heading: false, reason: "gate-refused", copy: null };
    }
    const gatedText = verdict.text ?? text;
    const state = this.episodeState(sessionId, d);
    const append = {
      day: d,
      date: calendarDate(this.store.now(), this.dayZone())
    };
    if (opts.title !== undefined)
      append.title = opts.title;
    if (opts.happenedOn !== undefined)
      append.happenedOn = opts.happenedOn;
    if (opts.model !== undefined)
      append.model = opts.model;
    if (opts.scope !== undefined && opts.scope.length > 0)
      append.scope = opts.scope;
    if (opts.about !== undefined)
      append.about = opts.about;
    const written = appendChapter(this.store, state, gatedText, append);
    if (opts.about !== undefined) {
      try {
        for (const copy of this.store.copiesOf([written.episodeId]).get(written.episodeId) ?? []) {
          if (copy.about !== opts.about)
            this.store.setAbout(copy.id, opts.about, { by: "writer" });
        }
      } catch (err) {
        this.emit("self.episode.about.failed", written.episodeId, { error: err instanceof Error ? err.name : "UNKNOWN" });
      }
    }
    this.persistState({
      ...state,
      episodeId: written.episodeId,
      chapters: Math.max(state.chapters, written.chapter),
      appendedAtAsk: state.asks,
      lastDay: d
    }, "appendChapter");
    this.emit("self.episode.chapter", written.episodeId, {
      session: sessionId,
      chapter: written.chapter,
      created: written.created,
      bytes: byteLength(gatedText)
    });
    const copy = syncJournalCopy(this.store, written.episodeId);
    noteJournalCopy(this.store, copy, {
      day: d,
      chapters: written.chapter,
      site: "chapter"
    });
    this.emit("self.journal.copy", written.episodeId, {
      outcome: copy.outcome,
      bytes: copy.bytes,
      ...copy.reason === null ? {} : { reason: copy.reason }
    });
    return { ...written, reason: "appended", copy: copy.outcome };
  }
  ingestEpisode(input) {
    const intake = intakeEpisode({ content: "-", ...input });
    const none = (reason, intakeReason = null) => ({
      ingested: false,
      reason,
      memoryId: null,
      episodeId: null,
      key: null,
      archived: [],
      gate: null,
      intake: intakeReason
    });
    if (!intake.ok) {
      const reason = intake.reason === "SESSION_MISSING" ? "anonymous-session" : "malformed-input";
      this.emit("self.episode.skipped", undefined, { reason, intake: intake.reason });
      return none(reason, intake.reason);
    }
    const sessionId = input.sessionId;
    const d = input.day ?? this.store.livedDay();
    if (this.observer) {
      this.emit("self.observer.standdown", sessionId, { site: "ingestEpisode" });
      return none("observer");
    }
    const state = this.episodeState(sessionId, d);
    if (state.episodeId === null) {
      this.emit("self.episode.ingest.skipped", sessionId, { reason: "no-episode" });
      return none("no-episode");
    }
    const doc = this.store.readProse(state.episodeId);
    const key = ingestKey(state.episodeId, doc.body);
    const existing = findIngested(this.store, key);
    if (existing !== null) {
      this.emit("self.episode.ingest.skipped", state.episodeId, {
        reason: "already-ingested",
        memory: existing.id
      });
      return {
        ingested: false,
        reason: "already-ingested",
        memoryId: existing.id,
        episodeId: state.episodeId,
        key,
        archived: [],
        gate: null,
        intake: null
      };
    }
    const regrow = state.firstIngestDay !== null;
    if (regrow && d - (state.firstIngestDay ?? d) > this.tunables.REGROW_WINDOW_DAYS) {
      this.emit("self.episode.ingest.skipped", state.episodeId, {
        reason: "window-closed",
        openedOn: state.firstIngestDay,
        day: d,
        window: this.tunables.REGROW_WINDOW_DAYS
      });
      return {
        ingested: false,
        reason: "window-closed",
        memoryId: state.ingestedMemoryId,
        episodeId: state.episodeId,
        key,
        archived: [],
        gate: null,
        intake: null
      };
    }
    const handles = [...input.handles ?? []];
    const verdict = this.gate({ text: doc.body, handles, sessionId });
    if (!verdict.ok) {
      this.emit("self.episode.ingest.refused", state.episodeId, {
        gate: verdict.gate,
        reason: verdict.reason
      });
      return {
        ingested: false,
        reason: "gate-refused",
        memoryId: null,
        episodeId: state.episodeId,
        key,
        archived: [],
        gate: { gate: verdict.gate, reason: verdict.reason },
        intake: null
      };
    }
    const proposal = input;
    const body = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : doc.body;
    const put = {
      type: "memory",
      kind: "self",
      body,
      meta: { episodeId: state.episodeId, episodeKey: key, sessionId, handles },
      source: "episode",
      origin: { session: sessionId, ref: state.episodeId }
    };
    if (proposal.title !== undefined)
      put.title = proposal.title;
    else if (doc.title !== undefined && doc.title.trim().length > 0) {
      const scan = scanSecrets(doc.title.trim(), "title");
      if (scan.emptyAfterRedaction) {
        this.emit("self.episode.title.dropped", state.episodeId, { reason: "empty-after-redaction" });
      } else
        put.title = scan.redacted;
    }
    if (proposal.happenedOn !== undefined)
      put.happenedOn = proposal.happenedOn;
    else if (doc.happenedOn !== undefined)
      put.happenedOn = doc.happenedOn;
    if (proposal.salience !== undefined || proposal.claimed !== undefined) {
      put.salience = { ...proposal.salience ?? {}, claimed: proposal.claimed ?? null };
    }
    const staleCopies = memoriesForEpisode(this.store, state.episodeId);
    const carried = this.copyAbout(staleCopies, doc);
    if (carried !== null) {
      put.about = carried.mark;
      put.aboutBy = carried.by;
    }
    const memoryId = this.store.put(put);
    const archived = [];
    for (const stale of staleCopies) {
      if (stale === memoryId)
        continue;
      this.store.archive(stale, "episode-regrown");
      archived.push(stale);
    }
    let relinkFailed = 0;
    for (const stale of archived) {
      try {
        this.retarget?.(stale, memoryId, d);
      } catch {
        relinkFailed += 1;
      }
    }
    if (relinkFailed > 0) {
      this.emit("self.episode.relink.failed", state.episodeId, { memory: memoryId, failed: relinkFailed });
    }
    this.persistState({
      ...state,
      ingestedKey: key,
      ingestedMemoryId: memoryId,
      firstIngestDay: state.firstIngestDay ?? d,
      lastDay: d
    }, "ingestEpisode");
    this.emit("self.episode.ingested", state.episodeId, {
      memory: memoryId,
      regrown: regrow,
      archived: archived.length,
      handles: handles.length,
      bytes: byteLength(doc.body)
    });
    this.onMemoryMinted?.({ id: memoryId, title: put.title ?? null, body, day: d });
    return {
      ingested: true,
      reason: regrow ? "regrown" : "ingested",
      memoryId,
      episodeId: state.episodeId,
      key,
      archived,
      gate: null,
      intake: null
    };
  }
  copyAbout(staleCopies, episode) {
    try {
      for (const id of [...staleCopies].reverse()) {
        const row = this.store.row(id);
        const mark = aboutMarkOf(row?.about);
        if (mark === null)
          continue;
        const by = row?.about_by ?? "";
        return { mark, by: ABOUT_SETTERS.includes(by) ? by : "writer" };
      }
    } catch {}
    const own = aboutMarkOf(episode.meta[EPISODE_ABOUT_META]);
    return own === null ? null : { mark: own, by: "writer" };
  }
  reconcileEpisodes(day) {
    const d = day ?? this.store.livedDay();
    let considered = 0;
    let ingested = 0;
    let regrown = 0;
    let skipped = 0;
    for (const id of this.store.list({ type: "episode", archived: false })) {
      let doc;
      try {
        doc = this.store.readProse(id);
      } catch {
        continue;
      }
      const sessionId = doc.meta["sessionId"];
      if (typeof sessionId !== "string" || sessionId.trim().length === 0)
        continue;
      considered += 1;
      const state = this.episodeState(sessionId, d);
      if (state.ingestedKey === ingestKey(id, doc.body)) {
        skipped += 1;
        continue;
      }
      const out = this.ingestEpisode({ sessionId, day: d });
      if (out.reason === "ingested")
        ingested += 1;
      else if (out.reason === "regrown")
        regrown += 1;
      else
        skipped += 1;
    }
    this.emit("self.episode.reconciled", undefined, {
      considered,
      ingested,
      regrown,
      skipped,
      day: d
    });
    return { considered, ingested, regrown, skipped };
  }
  noteOrphanTail(sessionId, substance, day, opts = {}) {
    const verdict = this.askDue(sessionId, substance, day, opts);
    this.emit("self.episode.tail", sessionId, {
      sinceTurns: verdict.sinceTurns,
      sinceBytes: verdict.sinceBytes,
      boundTurns: this.tunables.REASK_TURNS,
      boundBytes: this.tunables.REASK_TEXT_BYTES,
      chapters: this.episodeState(sessionId, day).chapters
    });
    return verdict;
  }
  events(name) {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }
  horizonRank(item, day) {
    let kind = "fact";
    let bornDay = day;
    let s = 0;
    try {
      const physics = this.store.physicsOf(item.id);
      kind = physics.kind;
      bornDay = physics.birthDay;
      s = strength(physics, day);
    } catch {}
    return {
      id: item.id,
      lane: "horizon",
      kind,
      band: "episodic",
      strength: s,
      protected: false,
      bornDay,
      personScoped: false,
      lastRendered: -1,
      ...item.plainDue === true ? { due: true } : {},
      ...item.near === true ? { near: true } : {}
    };
  }
  resolveStatement(id, docs, sources) {
    let doc = docs.get(id);
    if (doc === undefined) {
      try {
        doc = this.store.readProse(id);
      } catch {
        return { statement: id };
      }
    }
    const source = sources.has(id) ? sources.get(id) ?? null : this.store.row(id)?.source ?? null;
    const paragraph = doc.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? doc.body;
    const statement = flatten(paragraph);
    const out = { statement: statement.length > 0 ? statement : id };
    try {
      const st = standingOf(this.store, id);
      if (st !== null)
        out.standing = { prefix: st.prefix, suffix: st.suffix };
    } catch {}
    try {
      if (out.standing === undefined && this.store.coreStanding(id)?.action === "reconsidering" && this.store.row(id)?.promoted_identity === 1) {
        out.standing = { prefix: `Core, being reconsidered — keep or retire it (remember core) [${id}]: `, suffix: "" };
      }
    } catch {}
    if (doc.learnedOn.trim() !== "")
      out.learnedOn = doc.learnedOn;
    if (doc.happenedOn !== undefined && doc.happenedOn.trim() !== "") {
      out.happenedOn = doc.happenedOn;
    }
    if (source === "migrated" && !repairedAtHighConfidence(doc))
      out.boundedDate = true;
    return out;
  }
  bumpCount(kind, frozen) {
    const key = counterKey(kind, frozen);
    if (this.observer) {
      const next = (this.volatileCounts.get(key) ?? 0) + 1;
      this.volatileCounts.set(key, next);
      return next;
    }
    const next = Number(this.store.getMeta(key) ?? "0") + 1;
    this.store.setMeta(key, String(next));
    return next;
  }
  persistState(state, site) {
    if (this.observer) {
      this.volatileState.set(state.sessionId, state);
      this.emit("self.observer.standdown", state.sessionId, { site: `persist:${site}` });
      return;
    }
    this.store.setMeta(stateKey(state.sessionId), JSON.stringify(state));
  }
  emit(name, ref, data) {
    const e = { at: this.now(), name };
    if (ref !== undefined)
      e.ref = ref;
    if (data !== undefined)
      e.data = data;
    this.ring.push(e);
    if (this.ring.length > EVENT_RING)
      this.ring.shift();
    this.onEvent?.(e);
  }
}
function round(n) {
  return Math.round(n * 1000) / 1000;
}
function repairedAtHighConfidence(doc) {
  const marker = doc.meta["dateRepaired"];
  if (typeof marker !== "object" || marker === null || Array.isArray(marker))
    return false;
  return marker["confidence"] === "high";
}

export { BRIEFING_TRIM_LOG_CAP, COUNTER_PREFIX, FRAMING, FROZEN_KINDS, LANE_ORDER, TRIM_ORDER };
function shownRecord(briefing, lanes, req, hash) {
  const lost = (lane) => {
    const kept = new Set(briefing.kept[lane]);
    return [...lanes[lane].map((r) => r.id), ...lanes.overflow?.[lane] ?? []].filter((id) => !kept.has(id));
  };
  const whole = (n) => Math.max(0, Math.floor(n ?? 0));
  return {
    v: 1,
    hash,
    ceiling: req.ceilingBytes === undefined || req.omit !== undefined ? null : req.ceilingBytes,
    budget: req.budgetBytes,
    lend: req.omit !== undefined ? 0 : whole(req.lendBytes),
    handoffLend: req.omit !== undefined ? 0 : whole(req.handoffLendBytes),
    handoffKeep: req.omit !== undefined ? 0 : whole(req.handoffKeepBytes),
    identity: briefing.kept.identity,
    craft: briefing.kept.craft,
    hints: briefing.kept.hints,
    more: {
      identity: lost("identity"),
      craft: lost("craft"),
      hints: lanes.hints.map((r) => r.id).filter((id) => !briefing.kept.hints.includes(id))
    }
  };
}
export function settledOver(store) {
  const out = new Set;
  try {
    const pairs = [...store.contradictions({ state: "settled", limit: 1e5 })].reverse().filter((p) => p.via === null && p.over !== null && p.holds !== null && (p.how === "changed" || p.how === "corrected")).sort(pairOrder);
    const newest = new Map;
    for (const p of pairs)
      newest.set(p.over, { role: "over", holds: p.holds });
    const live = (id) => {
      const r = store.row(id);
      return r !== undefined && r.archived === 0 && r.superseded_by === null && !(r.body === "" && r.content_hash === "");
    };
    const visiting = new Set;
    const ends = new Map;
    const liveEnd = (id, depth = 0) => {
      const known = ends.get(id);
      if (known !== undefined)
        return known;
      if (depth > 5000 || visiting.has(id))
        return null;
      visiting.add(id);
      let end = null;
      try {
        end = walk(id, depth);
      } finally {
        visiting.delete(id);
      }
      ends.set(id, end);
      return end;
    };
    const walk = (id, depth) => {
      const r = store.row(id);
      if (r === undefined)
        return null;
      if (!live(id))
        return r.superseded_by === null ? null : liveEnd(r.superseded_by, depth + 1);
      const n = newest.get(id);
      const further = n !== undefined && n.role === "over" ? liveEnd(n.holds, depth + 1) : null;
      return further ?? id;
    };
    for (const [id, n] of newest)
      if (n.role === "over" && liveEnd(n.holds) !== null)
        out.add(id);
  } catch {
    return new Set;
  }
  return out;
}
