import { isKnownSession, isModelId } from "../types.js";
export const HANDOFF_ROLE = "handoff";
export const HANDOFF_KIND = "place";
export const HANDOFF_WRITTEN_EVENT = "handoff.written";
export const HANDOFF_SHOWN_EVENT = "handoff.shown";
export const HANDOFF_REFUSED_EVENT = "handoff.refused";
export const HANDOFF_CLEARED_EVENT = "handoff.cleared";
export const HANDOFF_MAX_BYTES = 2048;
export const HANDOFF_EXCERPT_BYTES = 160;
export const HANDOFF_RESERVE_MAX_BYTES = 1963;
export const HANDOFF_RESERVE_MARGIN_BYTES = 48;
export const HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE = 8;
export function reserveBytes(blockBytes, budgetBytes) {
  let best = 0;
  for (const b of blockBytes) {
    if (b <= 0)
      continue;
    const want = Math.min(b + HANDOFF_RESERVE_MARGIN_BYTES, HANDOFF_RESERVE_MAX_BYTES);
    if (want * HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE <= budgetBytes && want > best)
      best = want;
  }
  return best;
}
export const HANDOFF_LIFE_DAYS = 14;
export const HANDOFF_META_SCOPE = "scope";
export const HANDOFF_META_WRITTEN_ON = "writtenOn";
export const HANDOFF_META_WRITTEN_DAY = "writtenDay";
export const HANDOFF_META_SESSION = "session";
export const HANDOFF_META_MODEL = "model";
export const HANDOFF_META_WRITTEN_AT = "writtenAt";
export const HANDOFF_META_BUILD = "build";
export const HANDOFF_VERSION_MAX_CHARS = 16;
export const HANDOFF_WAKE_SHOWN = 3;
export const HANDOFF_WAKE_LISTED = 5;
export const WAKE_MARKER = "<!-- counterparts:wake";
function sessionKey(session) {
  return typeof session === "string" && session.trim().length > 0 ? session : null;
}
function byteLengthOf(s) {
  return new TextEncoder().encode(s).length;
}
export function flatten(text) {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, (c) => /\s/u.test(c) ? " " : "").replace(/\s+/g, " ").trim();
}
export function isHandoffDoc(doc) {
  return doc.type === "schema" && doc.meta["role"] === HANDOFF_ROLE;
}
export function isHandoffRow(store, id) {
  const row = store.row(id);
  if (row === undefined || row.type !== "schema" || row.kind !== HANDOFF_KIND)
    return false;
  try {
    return isHandoffDoc(store.readProse(id));
  } catch {
    return false;
  }
}
export function handoffAuthorship(store, id) {
  try {
    if (!isHandoffRow(store, id))
      return null;
    const row = store.row(id);
    const meta = store.readProse(id).meta;
    const session = meta[HANDOFF_META_SESSION];
    const metaAt = meta[HANDOFF_META_WRITTEN_AT];
    const on = meta[HANDOFF_META_WRITTEN_ON];
    let at = typeof metaAt === "number" && Number.isFinite(metaAt) ? metaAt : null;
    try {
      const logged = store.eventLog({ name: HANDOFF_WRITTEN_EVENT, ref: id, order: "desc", limit: 1 })[0];
      if (logged !== undefined)
        at = logged.at;
    } catch {}
    if (at === null)
      at = row?.updated_at ?? row?.created_at ?? null;
    return {
      session: typeof session === "string" && session.length > 0 ? session : null,
      at,
      on: typeof on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null,
      scope: typeof meta[HANDOFF_META_SCOPE] === "string" && meta[HANDOFF_META_SCOPE].length > 0 ? meta[HANDOFF_META_SCOPE] : null
    };
  } catch {
    return null;
  }
}
export function liveHandoffRows(store) {
  const out = [];
  for (const id of store.list({ type: "schema", kind: HANDOFF_KIND, archived: false })) {
    try {
      const meta = store.readProse(id).meta;
      if (meta["role"] !== HANDOFF_ROLE)
        continue;
      const scope = meta[HANDOFF_META_SCOPE];
      const day = meta[HANDOFF_META_WRITTEN_DAY];
      const session = meta[HANDOFF_META_SESSION];
      const at = meta[HANDOFF_META_WRITTEN_AT];
      out.push({
        id,
        scope: typeof scope === "string" ? scope : "",
        writtenDay: typeof day === "number" ? day : null,
        session: typeof session === "string" && session.length > 0 ? session : null,
        writtenAt: typeof at === "number" && Number.isFinite(at) ? at : null
      });
    } catch {
      continue;
    }
  }
  return out;
}
export function handoffRows(store) {
  return liveHandoffRows(store).map((r) => r.id);
}
function newer(a, b) {
  const da = a.writtenDay ?? -1;
  const db = b.writtenDay ?? -1;
  if (da !== db)
    return da > db;
  const ta = a.writtenAt ?? -1;
  const tb = b.writtenAt ?? -1;
  if (ta !== tb)
    return ta > tb;
  return a.id > b.id;
}
function newestBy(rows, key) {
  const best = new Map;
  for (const r of rows) {
    if (r.scope.length === 0)
      continue;
    const k = key(r);
    const held = best.get(k);
    if (held === undefined || newer(r, held))
      best.set(k, r);
  }
  return best;
}
export function newestPerScope(rows) {
  return newestBy(rows, (r) => r.scope);
}
export function newestPerKey(rows) {
  return newestBy(rows, (r) => `${r.scope}\x00${r.session ?? ""}`);
}
export function findHandoffRow(store, scope, session) {
  const want = scope.trim();
  if (want.length === 0)
    return null;
  const rows = liveHandoffRows(store).filter((r) => r.scope === want && (session === undefined || r.session === (session ?? null)));
  return newestPerScope(rows).get(want)?.id ?? null;
}
export function duplicateHandoffRows(store, scope, session = null) {
  const want = scope.trim();
  if (want.length === 0)
    return [];
  const rows = liveHandoffRows(store).filter((r) => r.scope === want && r.session === session);
  const winner = newestPerScope(rows).get(want)?.id ?? null;
  return rows.filter((r) => r.id !== winner).map((r) => r.id);
}
export function readHandoff(store, scope, session) {
  const id = findHandoffRow(store, scope, session);
  if (id === null)
    return null;
  return handoffOf(store, { id, scope: scope.trim(), writtenDay: null, session: null, writtenAt: null });
}
export function liveHandoffsFor(store, scope, day, lifeDays = HANDOFF_LIFE_DAYS) {
  const want = scope.trim();
  if (want.length === 0)
    return [];
  return handoffsNewestFirst(store, liveHandoffRows(store).filter((r) => r.scope === want), day, lifeDays);
}
function handoffsNewestFirst(store, rows, day, lifeDays) {
  const kept = [...newestPerKey(rows).values()].filter((r) => r.writtenDay !== null && daysLeft(r.writtenDay, day, lifeDays) > 0).sort((a, b) => newer(a, b) ? -1 : newer(b, a) ? 1 : 0);
  const out = [];
  for (const r of kept) {
    const h = handoffOf(store, r);
    if (h !== null && !expired(h, day, lifeDays))
      out.push(h);
  }
  return out;
}
function handoffOf(store, live) {
  const id = live.id;
  let doc;
  try {
    doc = store.readProse(id);
  } catch {
    return null;
  }
  const scope = live.scope;
  const row = store.row(id);
  const writtenDay = doc.meta[HANDOFF_META_WRITTEN_DAY];
  const writtenOn = doc.meta[HANDOFF_META_WRITTEN_ON];
  const session = doc.meta[HANDOFF_META_SESSION];
  const model = doc.meta[HANDOFF_META_MODEL];
  const writtenAt = doc.meta[HANDOFF_META_WRITTEN_AT];
  const build = doc.meta[HANDOFF_META_BUILD];
  return {
    id,
    scope,
    body: doc.body,
    bytes: byteLengthOf(doc.body),
    writtenOn: typeof writtenOn === "string" ? writtenOn : "",
    writtenDay: typeof writtenDay === "number" ? writtenDay : null,
    session: typeof session === "string" && session.length > 0 ? session : null,
    model: isModelId(model) ? model : null,
    writtenAt: typeof writtenAt === "number" && Number.isFinite(writtenAt) ? writtenAt : null,
    build: isVersion(build) ? build : null,
    version: row?.revision ?? 0
  };
}
export function isVersion(v) {
  return typeof v === "string" && v.length <= HANDOFF_VERSION_MAX_CHARS && /^\d+(\.\d+){0,3}(-[0-9A-Za-z.]+)?$/.test(v);
}
export function versionOlder(a, b) {
  if (!isVersion(a) || !isVersion(b))
    return false;
  const parse = (v) => {
    const cut = v.indexOf("-");
    const core = cut < 0 ? v : v.slice(0, cut);
    return { nums: core.split(".").map(Number), tag: cut >= 0 };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0;i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const x = pa.nums[i] ?? 0;
    const y = pb.nums[i] ?? 0;
    if (x !== y)
      return x < y;
  }
  return pa.tag && !pb.tag;
}
export function staleWords(opts) {
  const parts = [];
  if (versionOlder(opts.writtenWith, opts.installed))
    parts.push(`before ${opts.installed} was installed`);
  if (opts.newerChapter === true)
    parts.push("a newer chapter here since");
  return parts.length === 0 ? null : parts.join(", and ");
}
export function expired(h, day, lifeDays = HANDOFF_LIFE_DAYS) {
  if (h.writtenDay === null)
    return true;
  return daysLeft(h.writtenDay, day, lifeDays) <= 0;
}
export function daysLeft(writtenDay, day, lifeDays = HANDOFF_LIFE_DAYS) {
  return lifeDays - (day - writtenDay);
}
export const EXCERPT_MIN_SENTENCE = 20;
export const ELLIPSIS = "…";
function isHeading(line) {
  const t = line.trim();
  return t.length === 0 || /^#{1,6}\s/.test(t) || /^[=-]{3,}$/.test(t);
}
export function excerpt(body, capBytes = HANDOFF_EXCERPT_BYTES) {
  const lines = body.split(`
`);
  const line = lines.find((l) => !isHeading(l)) ?? lines.find((l) => l.trim().length > 0) ?? body;
  const flat = flatten(line).replace(/^(?:[-*+•]|\d{1,3}[.)])\s+/u, "");
  let first = flat;
  for (const m of flat.matchAll(/[.!?](?=\s)/gu)) {
    const end = (m.index ?? 0) + 1;
    if (end < EXCERPT_MIN_SENTENCE)
      continue;
    first = flat.slice(0, end);
    break;
  }
  if (byteLengthOf(first) <= capBytes)
    return first;
  const room = Math.max(0, capBytes - byteLengthOf(ELLIPSIS));
  const bytes = new TextEncoder().encode(first);
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, room));
  const clean = prefix.replace(/�+$/u, "");
  const space = clean.lastIndexOf(" ");
  const kept = space > clean.length * 0.8 ? clean.slice(0, space) : clean;
  return `${kept.trimEnd()}${ELLIPSIS}`;
}
export const WIDEST_POINTER_SINCE = {
  written: "12-31 23:59",
  after: {
    from: "12-31 23:59",
    to: "12-31 23:59",
    writtenUp: false,
    upTo: "12-31 23:59",
    by: "nothing new",
    unwritten: 9999,
    unwrittenAfter: 0
  },
  stale: staleWords({ writtenWith: "0", installed: "9".repeat(HANDOFF_VERSION_MAX_CHARS), newerChapter: true })
};
const WIDEST_OLDER_SINCE = { written: "12-31 23:59", after: null, stale: WIDEST_POINTER_SINCE.stale ?? null };
export function modelWords(id) {
  const bare = id.replace(/^claude-/, "").replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");
  const m = /^([a-z]+)-(\d{1,2}(?:-\d{1,2})*)$/.exec(bare);
  const family = m?.[1];
  const version = m?.[2];
  if (family === undefined || version === undefined)
    return flatten(id);
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.replace(/-/g, ".")}`;
}
export function authorWords(h, reader = null) {
  return sessionWords(h.session, h.model ?? null, reader);
}
export function sessionWords(session, model, reader = null) {
  const who = session === null || session.length === 0 ? "an earlier session" : !isKnownSession(session) ? UNIDENTIFIED_SESSION_WORDS : isKnownSession(reader) && session === reader ? "this session" : `session ${flatten(session).slice(0, 8)}`;
  return model === null ? who : `${who} on ${modelWords(model)}`;
}
export const UNIDENTIFIED_SESSION_WORDS = "a session that hadn't been identified yet";
function writtenUpWords(after) {
  if (after.writtenUp)
    return "written up since";
  if (after.upTo === undefined || after.upTo === null || after.upTo.length === 0)
    return "not yet written up";
  const n = after.unwritten ?? 0;
  const tail = n === 0 ? "" : `, ${String(n)} ${n === 1 ? "piece" : "pieces"} ${after.unwrittenAfter === n ? "after" : "not yet"}`;
  if (after.by === "nothing new")
    return `nothing new to write up as of ${after.upTo}${tail}`;
  return `written up to ${after.upTo}${after.by ? ` (${after.by})` : ""}${tail}`;
}
function whenWords(h, since, author = null) {
  const by = author === null ? "" : ` by ${author}`;
  if (since === null || since.written.length === 0) {
    const on = /^\d{4}-\d{2}-\d{2}$/.test(h.writtenOn.trim()) ? h.writtenOn.trim() : "an unrecorded date";
    return `${on}${by}`;
  }
  const stale = since.stale === undefined || since.stale === null ? "" : `, ${since.stale}`;
  const written = `written ${since.written}${by}${stale}`;
  if (since.after === null)
    return written;
  return `${written}; work here ${since.after.from}–${since.after.to} since, ${writtenUpWords(since.after)}`;
}
export function pointerLine(h, capBytes = HANDOFF_EXCERPT_BYTES, since = null, author = null) {
  return `Where I left off in this directory (${whenWords(h, since, author)}): ${excerpt(h.body, capBytes)}`;
}
export function pointerDoor(h, day, lifeDays = HANDOFF_LIFE_DAYS) {
  const left = h.writtenDay === null ? lifeDays : daysLeft(h.writtenDay, day, lifeDays);
  const days = left === 1 ? "one more day" : `${Math.max(1, left)} more days`;
  return `(The whole of it is ${h.id} — expand it with the counterparts recall tool; once its work is done, retire it with session_end's retireHandoff: [id]. It stops showing after ${days} of use.)`;
}
export function pointerBlock(h, day, lifeDays = HANDOFF_LIFE_DAYS, since = null, reader = null) {
  if (expired(h, day, lifeDays))
    return null;
  const author = h.session === null ? null : authorWords(h, reader);
  return [
    flatten(pointerLine(h, HANDOFF_EXCERPT_BYTES, since, author)),
    flatten(pointerDoor(h, day, lifeDays))
  ].join(`
`);
}
export function pointerBlockMany(hs, day, opts = {}) {
  const lifeDays = opts.lifeDays ?? HANDOFF_LIFE_DAYS;
  const live = hs.filter((h) => !expired(h, day, lifeDays));
  if (live.length === 0)
    return null;
  const shown = Math.max(1, Math.min(opts.shown ?? HANDOFF_WAKE_SHOWN, live.length));
  const reader = opts.reader ?? null;
  const lines = [
    `Where the work in this directory was left off — ${live.length} handoffs, one per session, newest first:`
  ];
  live.slice(0, shown).forEach((h, i) => {
    const raw = opts.since?.[i] ?? null;
    const since = raw === null || i === 0 ? raw : { written: raw.written, after: null, stale: raw.stale ?? null };
    const when = whenWords(h, since);
    lines.push(`${i + 1}) From ${authorWords(h, reader)}, ${since === null ? `on ${when}` : when}: ${excerpt(h.body)} (${h.id})`);
  });
  const rest = live.slice(shown);
  if (rest.length > 0) {
    const named = rest.slice(0, HANDOFF_WAKE_LISTED).map((h) => {
      const on = /^\d{4}-(\d{2}-\d{2})$/.exec(h.writtenOn.trim())?.[1];
      return on === undefined ? h.id : `${h.id} (${on})`;
    });
    const unnamed = rest.length - named.length;
    lines.push(`+${rest.length} older here: ${named.join(", ")}${unnamed > 0 ? `, and ${unnamed} more` : ""}.`);
  }
  lines.push(`(Expand any of them by id with the counterparts recall tool; retire one whose work is done with session_end's retireHandoff: [id]. Each stops showing ${lifeDays} days of use after it was written.)`);
  return lines.map(flatten).join(`
`);
}
export function pointerLadder(hs, day, opts = {}) {
  const lifeDays = opts.lifeDays ?? HANDOFF_LIFE_DAYS;
  const live = hs.filter((h) => !expired(h, day, lifeDays));
  const first = live[0];
  if (first === undefined)
    return [];
  const single = pointerBlock(first, day, lifeDays, opts.since?.[0] ?? null, opts.reader ?? null);
  const out = [];
  if (live.length > 1) {
    for (let k = Math.min(HANDOFF_WAKE_SHOWN, live.length);k >= 1; k--) {
      const block = pointerBlockMany(live, day, { ...opts, shown: k });
      if (block !== null)
        out.push({ block, shown: live.slice(0, k), several: true });
    }
  }
  if (single !== null)
    out.push({ block: single, shown: [first], several: false });
  const plans = opts.plans ?? null;
  const listed = (plans?.items ?? []).slice(0, SINCE_SHOWN).map((p) => p.id);
  const withPlans = out.flatMap((rung) => {
    const line = plans === null ? null : sinceLine(plans, rung.several);
    return line === null ? [] : [{ block: `${rung.block}
${line}`, shown: rung.shown, plans: listed }];
  });
  return [...withPlans, ...out.map((rung) => ({ block: rung.block, shown: rung.shown, plans: [] }))];
}
export const PLAN_STATUSES = ["planned", "proposed", "asked"];
export const SINCE_SHOWN = 3;
export const SINCE_TITLE_BYTES = 60;
export const SINCE_SAME_ANSWER_MS = 5 * 60000;
export const SINCE_READ = 30;
export function planWord(status, unresolved) {
  if (typeof status === "string" && PLAN_STATUSES.includes(status))
    return status;
  return unresolved ? "open" : null;
}
export function sinceLine(plans, several) {
  const shown = plans.items.slice(0, SINCE_SHOWN);
  if (shown.length === 0)
    return null;
  const more = plans.more + plans.items.length - shown.length;
  const lead = several ? "Since the newest handoff here:" : "Since this handoff:";
  const list = shown.map((p) => `${p.title} (${p.word}, ${p.id})`).join("; ");
  return flatten(`${lead} ${list}${more > 0 ? `; and ${String(more)} more` : ""}.`);
}
function scopeSpellings(scope) {
  const trimmed = scope.trim();
  const bare = trimmed.replace(/\/+$/, "");
  return bare.length > 0 && bare !== trimmed ? [trimmed, bare] : [trimmed];
}

export class Handoffs {
  store;
  gate;
  observer;
  onEvent;
  nowFn;
  owner;
  settled;
  listed;
  constructor(opts) {
    this.store = opts.store;
    this.gate = opts.gate;
    this.observer = opts.observer === true;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? Date.now;
    this.owner = opts.owner === true;
    this.settled = opts.settled;
    this.listed = opts.listed;
  }
  emit(name, ref, data) {
    this.onEvent?.({
      at: this.nowFn(),
      name,
      ...ref === undefined ? {} : { ref },
      ...data === undefined ? {} : { data }
    });
  }
  read(scope, day) {
    return this.readAll(scope, day)[0] ?? null;
  }
  readAll(scope, day) {
    return liveHandoffsFor(this.store, scope, day ?? this.store.livedDay());
  }
  readAny(scope, session) {
    return readHandoff(this.store, scope, session);
  }
  anyLive(day) {
    return this.liveBlockBytes(day).length > 0;
  }
  liveBlockBytes(day) {
    return [...this.liveBlockBytesByScope(day).values()].flat();
  }
  liveBlockBytesByScope(day) {
    const d = day ?? this.store.livedDay();
    const out = new Map;
    const byScope = new Map;
    for (const row of liveHandoffRows(this.store)) {
      if (row.scope.length === 0)
        continue;
      const held = byScope.get(row.scope);
      if (held === undefined)
        byScope.set(row.scope, [row]);
      else
        held.push(row);
    }
    for (const [scope, rows] of byScope) {
      const hs = handoffsNewestFirst(this.store, rows, d, HANDOFF_LIFE_DAYS);
      const since = hs.map((_, i) => i === 0 ? WIDEST_POINTER_SINCE : WIDEST_OLDER_SINCE);
      const plans = hs[0] === undefined ? null : this.plansSince(scope, hs[0]);
      const rungs = pointerLadder(hs, d, { since, plans }).map((rung) => byteLengthOf(rung.block));
      if (rungs.length > 0)
        out.set(scope, rungs);
    }
    return out;
  }
  write(input) {
    const day = input.day ?? this.store.livedDay();
    const draft = input.body.replace(/\r\n/g, `
`).trim();
    let bytes = byteLengthOf(draft);
    const scope = input.scope.trim();
    const session = sessionKey(input.session);
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null };
    const refuse = (reason, detail = {}, extra = {}) => this.refuse(reason, { day, session, bytes, ...detail }, { ...none, ...extra });
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "write" });
      return { ...none, written: false, reason: "observer", bytes };
    }
    if (scope.length === 0 || sameDirectory(scope, this.store.dir)) {
      return refuse("no-scope", {});
    }
    if (draft.length === 0)
      return refuse("empty", {});
    if (bytes > HANDOFF_MAX_BYTES) {
      return refuse("too-large", { bytes, limit: HANDOFF_MAX_BYTES });
    }
    if (draft.includes(WAKE_MARKER))
      return refuse("forged-markers", { bytes });
    const verdict = this.gate({ text: draft, handles: [], sessionId: `handoff:${session ?? ""}` });
    if (!verdict.ok) {
      return refuse("gate-refused", { bytes, gate: verdict.gate, gateReason: verdict.reason }, { gate: { gate: verdict.gate, reason: verdict.reason } });
    }
    const text = verdict.text ?? draft;
    if (text.length === 0)
      return refuse("empty-after-gate", {});
    const redacted = text === draft ? null : { gate: "secrets", bytesBefore: bytes };
    bytes = byteLengthOf(text);
    const meta = {
      role: HANDOFF_ROLE,
      [HANDOFF_META_SCOPE]: scope,
      [HANDOFF_META_WRITTEN_ON]: this.store.today(),
      [HANDOFF_META_WRITTEN_DAY]: day,
      [HANDOFF_META_SESSION]: session,
      [HANDOFF_META_WRITTEN_AT]: this.nowFn(),
      ...isModelId(input.model) ? { [HANDOFF_META_MODEL]: input.model } : {},
      ...isVersion(input.build) ? { [HANDOFF_META_BUILD]: input.build } : {}
    };
    const existing = findHandoffRow(this.store, scope, session);
    let id;
    let version;
    try {
      if (existing === null) {
        id = this.store.put({
          type: "schema",
          kind: HANDOFF_KIND,
          title: handoffTitle(scope),
          body: text,
          meta,
          learnedOn: this.store.today()
        });
        version = 0;
      } else {
        id = existing;
        version = this.store.revise(id, {
          body: text,
          title: handoffTitle(scope),
          meta,
          reason: "handoff"
        });
      }
    } catch (err) {
      const code = err.code;
      return refuse("store-refused", { bytes, code: typeof code === "string" ? code : "UNKNOWN" });
    }
    this.store.updatePhysics(id, { lastUsedDay: day });
    for (const stale of duplicateHandoffRows(this.store, scope, session)) {
      if (stale === id)
        continue;
      try {
        this.store.archive(stale, "handoff-duplicate");
        this.emit("handoff.duplicate.retired", stale, {});
      } catch {}
    }
    this.store.appendEvent({
      name: HANDOFF_WRITTEN_EVENT,
      day,
      ref: id,
      payload: {
        session,
        bytes,
        version,
        created: existing === null,
        ...redacted === null ? {} : { redacted: true, redactedBy: redacted.gate },
        lifeDays: HANDOFF_LIFE_DAYS
      }
    });
    this.emit(HANDOFF_WRITTEN_EVENT, id, {
      bytes,
      version,
      created: existing === null
    });
    return {
      written: true,
      reason: existing === null ? "created" : "revised",
      id,
      version,
      bytes,
      gate: null,
      redacted,
      showsForDays: HANDOFF_LIFE_DAYS,
      others: this.neighbours(scope, session, day)
    };
  }
  neighbours(scope, session, day) {
    try {
      return this.readAll(scope, day).filter((h) => h.session !== session).map((h) => ({ id: h.id, session: h.session, writtenOn: h.writtenOn, excerpt: excerpt(h.body) }));
    } catch {
      return [];
    }
  }
  pointer(scope, day, since, reader) {
    return this.pointerChoices(scope, day, since, reader)[0] ?? null;
  }
  pointerChoices(scope, day, since, reader) {
    const d = day ?? this.store.livedDay();
    const hs = this.readAll(scope, d);
    const first = hs[0];
    if (first === undefined)
      return [];
    const current = hs.slice(0, HANDOFF_WAKE_SHOWN).map((h, i) => {
      try {
        return since?.(h, i === 0) ?? null;
      } catch {
        return null;
      }
    });
    const plans = this.plansSince(scope, first);
    return pointerLadder(hs, d, { since: current, reader: reader ?? null, plans }).map((rung) => ({
      block: rung.block,
      handoff: first,
      shown: rung.shown,
      live: hs.length,
      plans: rung.plans
    }));
  }
  plansSince(scope, h) {
    const none = { items: [], more: 0 };
    try {
      const after = this.writtenAt(h);
      if (after === null)
        return none;
      const ids = this.store.planCandidates({
        scopes: scopeSpellings(scope),
        after,
        statuses: PLAN_STATUSES,
        limit: SINCE_READ,
        confidential: this.owner
      });
      if (ids.length === 0)
        return none;
      const ask = (f) => {
        try {
          return f?.() ?? new Set;
        } catch {
          return new Set;
        }
      };
      const settled = ask(this.settled);
      const listed = ask(this.listed);
      const found = [];
      for (const id of ids) {
        if (settled.has(id) || listed.has(id))
          continue;
        const row = this.store.row(id);
        if (row === undefined)
          continue;
        if (h.session !== null && row.origin_session === h.session && (row.created_at ?? 0) - after <= SINCE_SAME_ANSWER_MS) {
          continue;
        }
        let doc;
        try {
          doc = this.store.readProse(id);
        } catch {
          continue;
        }
        if (typeof doc.meta["episodeId"] === "string")
          continue;
        const word = planWord(row.status ?? null, doc.meta["unresolved"] === true);
        if (word === null)
          continue;
        const title = flatten(doc.title ?? "");
        const text = excerpt(title.length > 0 ? title : doc.body, SINCE_TITLE_BYTES);
        if (text.length === 0)
          continue;
        found.push({ id, title: text, word });
      }
      return { items: found.slice(0, SINCE_SHOWN), more: Math.max(0, found.length - SINCE_SHOWN) };
    } catch {
      return none;
    }
  }
  writtenAt(h) {
    try {
      const row = this.store.eventLog({ name: HANDOFF_WRITTEN_EVENT, ref: h.id, order: "desc", limit: 1 })[0];
      return row === undefined ? h.writtenAt ?? null : row.at;
    } catch {
      return h.writtenAt ?? null;
    }
  }
  noteShown(h, opts) {
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "noteShown" });
      return;
    }
    const day = opts.day ?? this.store.livedDay();
    let seq = 0;
    try {
      seq = this.store.appendEvent({
        name: HANDOFF_SHOWN_EVENT,
        day,
        ref: h.id,
        dedupKey: `${HANDOFF_SHOWN_EVENT}:${h.id}:${day}`,
        payload: {
          session: opts.session ?? null,
          bytes: opts.bytes,
          ageDays: h.writtenDay === null ? null : day - h.writtenDay,
          version: h.version,
          ...opts.among === undefined || opts.among <= 1 ? {} : { among: opts.among },
          ...opts.plans === undefined || opts.plans <= 0 ? {} : { plans: opts.plans }
        }
      });
    } catch {}
    this.emit(HANDOFF_SHOWN_EVENT, h.id, { bytes: opts.bytes, first: seq !== 0 });
  }
  noteNoRoom(h, opts) {
    if (this.observer)
      return;
    const day = opts.day ?? this.store.livedDay();
    this.refuse("no-room", { day, session: null, bytes: opts.bytes, budget: opts.budget }, { id: h.id, version: null, gate: null, redacted: null, showsForDays: null }, `${HANDOFF_REFUSED_EVENT}:no-room:${h.id}:${day}`, h.id);
  }
  clear(scope, opts = {}) {
    const day = opts.day ?? this.store.livedDay();
    const session = sessionKey(opts.session);
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null };
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "clear" });
      return { ...none, written: false, reason: "observer", bytes: 0 };
    }
    const trimmed = scope.trim();
    if (trimmed.length === 0 || sameDirectory(trimmed, this.store.dir)) {
      return this.refuse("no-scope", { day, session, bytes: 0 }, none);
    }
    const h = readHandoff(this.store, trimmed, session);
    if (h === null) {
      return this.refuse("nothing-to-clear", { day, session, bytes: 0 }, none);
    }
    for (const id of [h.id, ...duplicateHandoffRows(this.store, trimmed, session)]) {
      this.store.archive(id, "handoff-cleared");
    }
    this.store.appendEvent({
      name: HANDOFF_CLEARED_EVENT,
      day,
      ref: h.id,
      payload: { session, bytes: h.bytes, version: h.version }
    });
    this.emit(HANDOFF_CLEARED_EVENT, h.id, { bytes: h.bytes });
    return { ...none, written: true, reason: "cleared", id: h.id, bytes: h.bytes };
  }
  retire(id, opts) {
    const day = opts.day ?? this.store.livedDay();
    const session = sessionKey(opts.session);
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null };
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "retire" });
      return { ...none, written: false, reason: "observer", bytes: 0 };
    }
    const scope = opts.scope.trim();
    if (scope.length === 0 || sameDirectory(scope, this.store.dir)) {
      return this.refuse("no-scope", { day, session, bytes: 0 }, none);
    }
    const want = id.trim();
    const live = liveHandoffRows(this.store).find((r) => r.id === want && r.scope === scope);
    const h = live === undefined ? null : handoffOf(this.store, live);
    if (h === null)
      return this.refuse("not-here", { day, session, bytes: 0 }, none);
    for (const stale of [h.id, ...duplicateHandoffRows(this.store, scope, h.session).filter((d) => d !== h.id)]) {
      this.store.archive(stale, "handoff-cleared");
    }
    this.store.appendEvent({
      name: HANDOFF_CLEARED_EVENT,
      day,
      ref: h.id,
      payload: { session, bytes: h.bytes, version: h.version, byId: true, author: h.session }
    });
    this.emit(HANDOFF_CLEARED_EVENT, h.id, { bytes: h.bytes, byId: true });
    return { ...none, written: true, reason: "cleared", id: h.id, bytes: h.bytes };
  }
  refuseWrite(reason, opts = {}) {
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null };
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "refuseWrite" });
      return { ...none, written: false, reason: "observer", bytes: 0 };
    }
    return this.refuse(reason, { day: opts.day ?? this.store.livedDay(), session: opts.session ?? null, bytes: 0 }, none);
  }
  refuse(reason, detail, base, dedupKey, ref) {
    const { day, ...payload } = detail;
    this.emit(HANDOFF_REFUSED_EVENT, ref, { reason, bytes: detail.bytes });
    try {
      this.store.appendEvent({
        name: HANDOFF_REFUSED_EVENT,
        day,
        ...ref === undefined ? {} : { ref },
        ...dedupKey === undefined ? {} : { dedupKey },
        payload: { reason, ...payload }
      });
    } catch {}
    return { ...base, written: false, reason, bytes: detail.bytes };
  }
}
function sameDirectory(a, b) {
  const norm = (s) => s.replace(/\/+$/, "");
  return norm(a.trim()) === norm(b.trim());
}
export function handoffTitle(scope) {
  return `Handoff — ${scope}`;
}
