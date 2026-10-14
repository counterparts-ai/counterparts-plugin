import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";
import { grantSpanStrike } from "./owner-strike-seam.js";
import { grantWriteUp } from "./write-up-seam.js";
import { carriesDreamMark } from "../dream/mark.js";
import { hashText } from "../store/prose.js";
import { dataDir } from "../store/paths.js";
import { isObserver } from "../observer.js";
import { TUNABLES } from "./tunables.js";
export const BOUNDARY_KINDS = [
  "stop",
  "session-end",
  "pre-compaction"
];
export const WRITE_SITES = [
  "capture",
  "jot",
  "boundary",
  "claim",
  "consume",
  "restore",
  "coverage",
  "proposal",
  "sweep",
  "failure",
  "strike",
  "writeup"
];
const EVENT_RING = 500;

export class SpanBuffer {
  dir;
  root;
  observer;
  minClaimBytes;
  staleClaimMs;
  crashStaleMs;
  consumedLedgerMax;
  maxSpanFailures;
  nowFn;
  dayFn;
  onEvent;
  ring = [];
  constructor(opts = {}) {
    this.dir = opts.dir ?? dataDir();
    this.root = join(this.dir, "spans");
    this.observer = isObserver(opts);
    this.minClaimBytes = opts.minClaimBytes ?? TUNABLES.MIN_CLAIM_BYTES;
    this.staleClaimMs = opts.staleClaimMs ?? TUNABLES.STALE_CLAIM_MS;
    this.crashStaleMs = opts.crashStaleMs ?? TUNABLES.CRASH_STALE_MS;
    this.consumedLedgerMax = opts.consumedLedgerMax ?? TUNABLES.CONSUMED_LEDGER_MAX;
    this.maxSpanFailures = opts.maxSpanFailures ?? TUNABLES.MAX_SPAN_FAILURES;
    this.nowFn = opts.now ?? (() => Date.now());
    this.dayFn = opts.day ?? (() => 0);
    this.onEvent = opts.onEvent;
    const access = {
      observer: this.observer,
      scopes: () => this.scopes(),
      scopeDir: (scope) => this.scopeDir(scope),
      path: (scope, name) => this.path(scope, name),
      claimFiles: (scope) => this.claimFiles(scope),
      streamPath: (scope, kind) => this.streamPath(scope, kind),
      ensureScope: (scope) => this.ensureScope(scope),
      readLines: (file) => this.readLines(file),
      mutate: (site, fn) => this.mutate(site, fn),
      emit: (name, ref, data) => this.emit(name, ref, data),
      now: () => this.nowFn(),
      day: () => this.dayFn(),
      trimLedger: (file) => this.trimLedger(file)
    };
    grantSpanStrike(this, access);
    const { ensureScope: _ensure, day: _day, trimLedger: _trim, ...writeUpAccess } = access;
    grantWriteUp(this, writeUpAccess);
  }
  now() {
    return this.nowFn();
  }
  day() {
    return this.dayFn();
  }
  mutate(site, fn) {
    if (this.observer) {
      this.emit("remember.observer.standdown", undefined, { site });
      return { ok: false, reason: "OBSERVER", code: "OBSERVER" };
    }
    try {
      return { ok: true, value: fn() };
    } catch (err) {
      const code = errCode(err);
      this.emit("remember.write.failed", undefined, { site, code });
      return { ok: false, reason: "IO_FAILED", code };
    }
  }
  emit(name, ref, data) {
    const event = { at: this.nowFn(), name };
    if (ref !== undefined)
      event.ref = ref;
    if (data !== undefined)
      event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING)
      this.ring.shift();
    this.onEvent?.(event);
  }
  events(name) {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }
  capture(input) {
    try {
      return this.captureInner(input);
    } catch (err) {
      const code = errCode(err);
      this.emit("remember.capture.failed", undefined, { code });
      return {
        captured: false,
        reason: "IO_FAILED",
        spans: [],
        deduped: 0,
        excluded: 0,
        cursorBefore: 0,
        cursorAfter: 0
      };
    }
  }
  captureInner(input) {
    const cursorBefore = this.cursor(input.scope, input.session);
    const empty = (reason, cursorAfter = cursorBefore) => ({
      captured: false,
      reason,
      spans: [],
      deduped: 0,
      excluded: 0,
      cursorBefore,
      cursorAfter
    });
    if (this.observer) {
      this.emit("remember.observer.standdown", undefined, { site: "capture" });
      return empty("OBSERVER");
    }
    const slice = input.turns.slice(cursorBefore);
    if (slice.length === 0)
      return empty("NOTHING_NEW");
    const kept = slice.filter((t) => enters(t));
    const excluded = slice.length - kept.length;
    if (kept.length === 0) {
      const advanced = this.mutate("capture", () => this.writeCursor(input.scope, input.session, input.turns.length));
      const out = empty(advanced.ok ? "ALL_EXCLUDED" : "IO_FAILED", advanced.ok ? input.turns.length : cursorBefore);
      out.excluded = excluded;
      return out;
    }
    const at = this.nowFn();
    const day = this.dayFn();
    const drafts = [];
    for (const kind of ["conversation", "assistant"]) {
      const text = kept.filter((t) => kind === "assistant" ? t.role === "assistant" : t.role !== "assistant").map((t) => t.text).join(`

`);
      if (text.trim().length === 0)
        continue;
      drafts.push({
        hash: hashText(text),
        session: input.session,
        scope: input.scope,
        kind,
        text,
        at,
        day,
        from: cursorBefore,
        to: input.turns.length
      });
    }
    const seen = this.seenHashes(input.scope);
    const fresh = drafts.filter((s) => !seen.has(s.hash));
    const deduped = drafts.length - fresh.length;
    const written = this.mutate("capture", () => {
      this.ensureScope(input.scope);
      for (const span of fresh) {
        appendFileSync(this.streamPath(span.scope, span.kind), `${JSON.stringify(span)}
`, "utf8");
      }
      this.writeCursor(input.scope, input.session, input.turns.length);
      return fresh;
    });
    if (!written.ok) {
      const out = empty("IO_FAILED");
      out.excluded = excluded;
      out.deduped = deduped;
      return out;
    }
    for (const span of fresh) {
      this.emit("remember.span.appended", span.hash, {
        session: span.session,
        kind: span.kind,
        bytes: span.text.length,
        day: span.day
      });
    }
    if (deduped > 0) {
      this.emit("remember.span.deduped", undefined, { scope: keyFor(input.scope), count: deduped });
    }
    this.claimNotedTurn(input.scope, input.session, cursorBefore, fresh, typedAfterReply(kept));
    return {
      captured: fresh.length > 0,
      reason: fresh.length > 0 ? "APPENDED" : "DEDUPED",
      spans: fresh,
      deduped,
      excluded,
      cursorBefore,
      cursorAfter: input.turns.length
    };
  }
  claimNotedTurn(scope, session, from, fresh, later) {
    try {
      const turn = fresh.filter((s) => s.kind === "conversation");
      if (turn.length === 0)
        return;
      const notes = new Set(this.readSpans(this.streamPath(scope, "jot")).filter((s) => s.session === session && s.from === from).map((s) => s.hash));
      if (notes.size === 0)
        return;
      const marks = this.coverage(scope);
      const note = marks.filter((m) => m.own === true && m.session === session && typeof m.spanHash === "string" && notes.has(m.spanHash)).sort((a, b) => (a.at ?? 0) - (b.at ?? 0))[0];
      if (note === undefined || typeof note.proposalId !== "string")
        return;
      if (later) {
        this.emit("remember.coverage.turn.skipped", note.proposalId, { reason: "more-than-one-turn" });
        return;
      }
      const covered = new Set(marks.map((m) => m.spanHash));
      const at = this.nowFn();
      const proposalId = note.proposalId;
      const taken = turn.filter((s) => !covered.has(s.hash)).map((s) => ({ spanHash: s.hash, proposalId, session, at, own: false }));
      if (taken.length === 0)
        return;
      const out = this.mutate("coverage", () => {
        appendFileSync(this.path(scope, "coverage.jsonl"), `${taken.map((m) => JSON.stringify(m)).join(`
`)}
`, "utf8");
      });
      if (out.ok)
        this.emit("remember.coverage.claimed", proposalId, { spans: taken.length, withheld: 0, turn: true });
    } catch (err) {
      this.emit("remember.coverage.turn.failed", undefined, { code: errCode(err) });
    }
  }
  jot(input) {
    const cursorBefore = this.cursor(input.scope, input.session);
    const base = {
      captured: false,
      reason: "APPENDED",
      spans: [],
      deduped: 0,
      excluded: 0,
      cursorBefore,
      cursorAfter: cursorBefore
    };
    if (this.observer) {
      this.emit("remember.observer.standdown", undefined, { site: "jot" });
      return { ...base, reason: "OBSERVER" };
    }
    if (input.text.trim().length === 0)
      return { ...base, reason: "NOTHING_NEW" };
    const span = {
      hash: hashText(input.text),
      session: input.session,
      scope: input.scope,
      kind: "jot",
      text: input.text,
      at: this.nowFn(),
      day: this.dayFn(),
      from: cursorBefore,
      to: cursorBefore
    };
    if (this.seenHashes(input.scope).has(span.hash)) {
      this.emit("remember.span.deduped", span.hash, { scope: keyFor(input.scope), count: 1 });
      return { ...base, reason: "DEDUPED", deduped: 1 };
    }
    const written = this.mutate("jot", () => {
      this.ensureScope(span.scope);
      appendFileSync(this.streamPath(span.scope, "jot"), `${JSON.stringify(span)}
`, "utf8");
    });
    if (!written.ok)
      return { ...base, reason: "IO_FAILED" };
    this.emit("remember.span.appended", span.hash, {
      session: span.session,
      kind: "jot",
      bytes: span.text.length,
      day: span.day
    });
    return { ...base, captured: true, reason: "APPENDED", spans: [span] };
  }
  boundary(input) {
    const record = {
      session: input.session,
      scope: input.scope,
      kind: input.kind,
      at: this.nowFn(),
      day: this.dayFn(),
      askRaised: !this.observer
    };
    const written = this.mutate("boundary", () => {
      this.ensureScope(input.scope);
      appendFileSync(this.path(input.scope, "boundaries.jsonl"), `${JSON.stringify(record)}
`, "utf8");
    });
    if (written.ok) {
      this.emit("remember.boundary", input.session, { kind: input.kind, ask: record.askRaised });
    }
    return record;
  }
  cursor(scope, session) {
    const file = join(this.root, "cursors", `${keyFor(scope)}.${keyFor(session)}.json`);
    if (!existsSync(file))
      return 0;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      const value = parsed.turns;
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    } catch {
      this.emit("remember.cursor.unreadable", undefined, {
        scope: keyFor(scope),
        session: keyFor(session)
      });
      return 0;
    }
  }
  spans(scope) {
    return [
      ...this.readSpans(this.streamPath(scope, "conversation")),
      ...this.readSpans(this.streamPath(scope, "jot"))
    ].sort((a, b) => a.at - b.at);
  }
  assistantSpans(scope) {
    return this.readSpans(this.streamPath(scope, "assistant"));
  }
  boundaries(scope) {
    return this.readLines(this.path(scope, "boundaries.jsonl"));
  }
  claimedSpans(scope) {
    return this.claimFiles(scope).flatMap((file) => this.readSpans(file));
  }
  writeUps(scope) {
    return this.readLines(this.path(scope, "writeups.jsonl")).filter((r) => typeof r.session === "string" && typeof r.at === "number");
  }
  crashedSessions(scope, opts = {}) {
    const staleMs = opts.staleMs ?? this.crashStaleMs;
    const now = this.nowFn();
    const lastAt = new Map;
    const endedNormally = new Set;
    for (const b of this.boundaries(scope)) {
      if (typeof b.session !== "string")
        continue;
      const at = typeof b.at === "number" ? b.at : 0;
      lastAt.set(b.session, Math.max(lastAt.get(b.session) ?? 0, at));
      if (b.kind === "session-end")
        endedNormally.add(b.session);
    }
    const crashed = new Set;
    for (const [session, at] of lastAt) {
      if (endedNormally.has(session))
        continue;
      if (now - at >= staleMs)
        crashed.add(session);
    }
    return crashed;
  }
  crashedPending(scope, opts = {}) {
    const sessions = this.crashedSessions(scope, opts);
    if (sessions.size === 0)
      return { sessions, spans: 0, uncovered: 0 };
    const covered = this.coveredHashes(scope);
    const seen = new Set;
    let spans = 0;
    let uncovered = 0;
    const consider = (span) => {
      if (!sessions.has(span.session))
        return;
      if (seen.has(span.hash))
        return;
      seen.add(span.hash);
      spans += 1;
      if (!covered.has(span.hash))
        uncovered += 1;
    };
    for (const span of this.spans(scope))
      consider(span);
    for (const file of this.claimFiles(scope)) {
      for (const span of this.readSpans(file))
        consider(span);
    }
    return { sessions, spans, uncovered };
  }
  coverage(scope) {
    return this.readLines(this.path(scope, "coverage.jsonl"));
  }
  coveredHashes(scope) {
    return new Set(this.coverage(scope).map((c) => c.spanHash));
  }
  withheldHashes(scope) {
    return new Set(this.coverage(scope).filter((c) => c.own).map((c) => c.spanHash));
  }
  seenHashes(scope) {
    const seen = new Set;
    for (const s of this.spans(scope))
      seen.add(s.hash);
    for (const s of this.assistantSpans(scope))
      seen.add(s.hash);
    for (const file of this.claimFiles(scope)) {
      for (const s of this.readSpans(file))
        seen.add(s.hash);
    }
    for (const line of this.readLines(this.path(scope, "consumed.jsonl"))) {
      seen.add(line.hash);
    }
    return seen;
  }
  scopes() {
    const legend = this.legend();
    return [...legend.values()].sort();
  }
  coverageReport(scope) {
    const spans = this.spans(scope);
    const covered = this.coveredHashes(scope);
    const bounds = this.boundaries(scope);
    const last = bounds.length > 0 ? Math.max(...bounds.map((b) => b.at)) : null;
    const tail = last === null ? spans : spans.filter((s) => s.at > last);
    const report = {
      scope,
      spans: spans.length,
      covered: spans.filter((s) => covered.has(s.hash)).length,
      uncovered: spans.filter((s) => !covered.has(s.hash)).length,
      unaskableSpans: tail.length,
      unaskableBytes: tail.reduce((n, s) => n + s.text.length, 0),
      lastBoundaryAt: last,
      quarantined: this.quarantined(scope).length
    };
    this.emit("remember.coverage.measured", keyFor(scope), {
      spans: report.spans,
      covered: report.covered,
      uncovered: report.uncovered,
      unaskableSpans: report.unaskableSpans,
      unaskableBytes: report.unaskableBytes,
      quarantined: report.quarantined
    });
    return report;
  }
  failureCounts(scope) {
    const days = new Map;
    for (const line of this.readLines(this.path(scope, "failures.jsonl"))) {
      if (typeof line.hash !== "string")
        continue;
      const set = days.get(line.hash) ?? new Set;
      set.add(typeof line.day === "number" ? line.day : -1 - set.size);
      days.set(line.hash, set);
    }
    return new Map([...days.entries()].map(([hash, set]) => [hash, set.size]));
  }
  quarantined(scope) {
    return this.readSpans(this.path(scope, "quarantine.jsonl"));
  }
  noteFailures(scope, spans, code) {
    if (spans.length === 0)
      return { retry: [], quarantined: [] };
    const counts = this.failureCounts(scope);
    const day = this.dayFn();
    const failedToday = new Set(this.readLines(this.path(scope, "failures.jsonl")).filter((l) => typeof l.hash === "string" && l.day === day).map((l) => l.hash));
    const at = this.nowFn();
    const retry = [];
    const quarantined = [];
    for (const span of spans) {
      const n = (counts.get(span.hash) ?? 0) + (failedToday.has(span.hash) ? 0 : 1);
      counts.set(span.hash, n);
      if (n >= this.maxSpanFailures)
        quarantined.push(span);
      else
        retry.push(span);
    }
    const out = this.mutate("failure", () => {
      this.ensureScope(scope);
      const file = this.path(scope, "failures.jsonl");
      const lines = spans.map((s) => JSON.stringify({ hash: s.hash, at, day, code }));
      appendFileSync(file, `${lines.join(`
`)}
`, "utf8");
      this.trimLedger(file);
      if (quarantined.length > 0) {
        appendFileSync(this.path(scope, "quarantine.jsonl"), `${quarantined.map((s) => JSON.stringify(s)).join(`
`)}
`, "utf8");
      }
    });
    if (!out.ok)
      return { retry: [...spans], quarantined: [] };
    if (quarantined.length > 0) {
      this.emit("remember.span.quarantined", undefined, {
        scope: keyFor(scope),
        spans: quarantined.length,
        code
      });
    }
    return { retry, quarantined };
  }
  claim(scope, opts = {}) {
    if (this.observer) {
      this.emit("remember.observer.standdown", undefined, { site: "claim" });
      return { claimed: false, reason: "OBSERVER", bytes: 0 };
    }
    const minBytes = opts.minBytes ?? this.minClaimBytes;
    const staleMs = opts.staleClaimMs ?? this.staleClaimMs;
    const id = `clm_${randomBytes(6).toString("hex")}`;
    const claimPath = join(this.claimsDir(scope), `${id}.jsonl`);
    const staged = this.mutate("claim", () => {
      this.ensureScope(scope);
      mkdirSync(this.claimsDir(scope), { recursive: true });
      const live = this.streamPath(scope, "conversation");
      const jots = this.streamPath(scope, "jot");
      let any = false;
      if (existsSync(live)) {
        renameSync(live, claimPath);
        any = true;
      }
      if (existsSync(jots)) {
        const aside = join(this.claimsDir(scope), `${id}.jots.jsonl`);
        renameSync(jots, aside);
        appendFileSync(claimPath, readFileSync(aside, "utf8"), "utf8");
        rmSync(aside, { force: true });
        any = true;
      }
      return any;
    });
    if (!staged.ok) {
      return { claimed: false, reason: staged.reason === "OBSERVER" ? "OBSERVER" : "IO_FAILED", bytes: 0 };
    }
    const merged = this.mergeOrphans(scope, claimPath, id, staleMs);
    const spans = this.readSpans(claimPath);
    const bytes = spans.reduce((n, s) => n + s.text.length, 0);
    const claim = { id, scope, path: claimPath, spans, bytes, mergedOrphans: merged };
    if (spans.length === 0) {
      rmSync(claimPath, { force: true });
      return { claimed: false, reason: "EMPTY", bytes: 0 };
    }
    if (bytes < minBytes) {
      this.restore(claim);
      this.emit("remember.claim.refused", id, { reason: "BELOW_MIN_CLAIM", bytes, minBytes });
      return { claimed: false, reason: "BELOW_MIN_CLAIM", bytes };
    }
    this.emit("remember.claim", id, {
      scope: keyFor(scope),
      spans: spans.length,
      bytes,
      mergedOrphans: merged.length
    });
    return { claimed: true, claim };
  }
  consume(claim, opts = {}) {
    const skip = new Set((opts.except ?? []).map((s) => s.hash));
    const kept = claim.spans.filter((s) => !skip.has(s.hash));
    const out = this.mutate("consume", () => {
      this.ensureScope(claim.scope);
      if (kept.length > 0) {
        const file = this.path(claim.scope, "consumed.jsonl");
        const lines = kept.map((s) => JSON.stringify({ hash: s.hash, at: s.at }));
        appendFileSync(file, `${lines.join(`
`)}
`, "utf8");
        this.trimLedger(file);
      }
      rmSync(claim.path, { force: true });
    });
    if (!out.ok) {
      return { consumed: false, reason: out.reason === "OBSERVER" ? "OBSERVER" : "IO_FAILED" };
    }
    this.emit("remember.claim.consumed", claim.id, {
      spans: kept.length,
      excepted: claim.spans.length - kept.length,
      bytes: kept.reduce((n, s) => n + s.text.length, 0)
    });
    return { consumed: true, reason: "CONSUMED" };
  }
  restore(claim, only) {
    const wanted = only ?? claim.spans;
    const out = this.mutate("restore", () => {
      this.ensureScope(claim.scope);
      const held = this.seenHashesExcludingClaim(claim);
      const back = wanted.filter((s) => !held.has(s.hash));
      for (const span of back) {
        appendFileSync(this.streamPath(claim.scope, span.kind === "jot" ? "jot" : "conversation"), `${JSON.stringify(span)}
`, "utf8");
      }
      return back.length;
    });
    if (!out.ok) {
      this.emit("remember.claim.restore.failed", claim.id, { spans: wanted.length });
      return { restored: false, reason: out.reason === "OBSERVER" ? "OBSERVER" : "IO_FAILED", spans: 0 };
    }
    if (only === undefined)
      rmSync(claim.path, { force: true });
    this.emit("remember.claim.restored", claim.id, { spans: out.value, partial: only !== undefined });
    return { restored: true, reason: "RESTORED", spans: out.value };
  }
  async arc(claim, work, commit) {
    let value;
    try {
      value = await work(claim.spans);
      await commit(value);
    } catch (err) {
      const code = errCode(err);
      const restored = this.restore(claim);
      this.emit("remember.arc.failed", claim.id, { code, restored: restored.restored });
      return {
        ok: false,
        reason: restored.restored ? "RESTORED" : "RESTORE_FAILED",
        code
      };
    }
    this.consume(claim);
    this.emit("remember.arc.done", claim.id, { spans: claim.spans.length });
    return { ok: true, value };
  }
  claimCoverage(input) {
    if (this.observer) {
      this.emit("remember.observer.standdown", undefined, { site: "coverage" });
      return [];
    }
    const covered = this.coveredHashes(input.scope);
    const at = this.nowFn();
    const live = this.spans(input.scope).filter((s) => s.session === input.session && !covered.has(s.hash));
    let taken = live;
    if (input.ownTurn === true) {
      const own = live.find((s) => s.kind === "jot" && s.hash === input.ownSpanHash);
      taken = own === undefined ? [] : live.filter((s) => s === own || s.kind === "conversation" && s.from === own.from);
    }
    const marks = taken.map((s) => ({
      spanHash: s.hash,
      proposalId: input.proposalId,
      session: input.session,
      at,
      own: input.ownSpanHash !== undefined && input.ownSpanHash !== null && s.hash === input.ownSpanHash
    }));
    if (marks.length === 0)
      return [];
    const out = this.mutate("coverage", () => {
      this.ensureScope(input.scope);
      appendFileSync(this.path(input.scope, "coverage.jsonl"), `${marks.map((m) => JSON.stringify(m)).join(`
`)}
`, "utf8");
    });
    if (!out.ok)
      return [];
    this.emit("remember.coverage.claimed", input.proposalId, {
      spans: marks.length,
      withheld: marks.filter((m) => m.own).length
    });
    return marks;
  }
  recordProposal(scope, record) {
    const out = this.mutate("proposal", () => {
      this.ensureScope(scope);
      appendFileSync(this.path(scope, "proposals.jsonl"), `${JSON.stringify(record)}
`, "utf8");
    });
    return out.ok;
  }
  proposalRecords(scope) {
    return this.readLines(this.path(scope, "proposals.jsonl"));
  }
  scopeDir(scope) {
    return join(this.root, keyFor(scope));
  }
  path(scope, name) {
    return join(this.scopeDir(scope), name);
  }
  streamPath(scope, kind) {
    const name = kind === "assistant" ? "assistant.jsonl" : kind === "jot" ? "jots.jsonl" : "buffer.jsonl";
    return this.path(scope, name);
  }
  claimsDir(scope) {
    return this.path(scope, "claims");
  }
  claimFiles(scope) {
    const dir = join(this.scopeDir(scope), "claims");
    if (!existsSync(dir))
      return [];
    return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f)).sort();
  }
  ensureScope(scope) {
    const dir = this.scopeDir(scope);
    if (existsSync(dir))
      return;
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(this.root, "cursors"), { recursive: true });
    const legend = this.legend();
    legend.set(keyFor(scope), scope);
    const file = join(this.root, "scopes.json");
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(legend), null, 2), "utf8");
    renameSync(tmp, file);
  }
  legend() {
    const file = join(this.root, "scopes.json");
    if (!existsSync(file))
      return new Map;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      return new Map(Object.entries(parsed));
    } catch {
      this.emit("remember.legend.unreadable", undefined, {});
      return new Map;
    }
  }
  writeCursor(scope, session, turns) {
    const dir = join(this.root, "cursors");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${keyFor(scope)}.${keyFor(session)}.json`);
    const tmp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify({ scope, session, turns }), "utf8");
    renameSync(tmp, file);
  }
  mergeOrphans(scope, claimPath, id, staleMs) {
    const merged = [];
    const now = this.nowFn();
    const held = new Set(this.readSpans(claimPath).map((s) => s.hash));
    for (const line of this.readLines(this.path(scope, "consumed.jsonl"))) {
      held.add(line.hash);
    }
    for (const file of this.claimFiles(scope)) {
      if (file === claimPath)
        continue;
      let age = 1 / 0;
      try {
        age = now - statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (age < staleMs)
        continue;
      const spans = this.readSpans(file).filter((s) => !held.has(s.hash));
      try {
        if (spans.length > 0) {
          appendFileSync(claimPath, `${spans.map((s) => JSON.stringify(s)).join(`
`)}
`, "utf8");
          for (const s of spans)
            held.add(s.hash);
        }
        rmSync(file, { force: true });
        merged.push(file);
        this.emit("remember.claim.orphan.merged", id, { spans: spans.length, ageMs: Math.round(age) });
      } catch (err) {
        this.emit("remember.claim.orphan.failed", id, { code: errCode(err) });
      }
    }
    return merged;
  }
  seenHashesExcludingClaim(claim) {
    const held = new Set;
    for (const s of this.spans(claim.scope))
      held.add(s.hash);
    for (const file of this.claimFiles(claim.scope)) {
      if (file === claim.path)
        continue;
      for (const s of this.readSpans(file))
        held.add(s.hash);
    }
    for (const line of this.readLines(this.path(claim.scope, "consumed.jsonl"))) {
      held.add(line.hash);
    }
    return held;
  }
  trimLedger(file) {
    const lines = readFileSync(file, "utf8").split(`
`).filter((l) => l.length > 0);
    if (lines.length <= this.consumedLedgerMax)
      return;
    const keep = lines.slice(lines.length - this.consumedLedgerMax);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${keep.join(`
`)}
`, "utf8");
    renameSync(tmp, file);
    this.emit("remember.ledger.trimmed", undefined, {
      ledger: basename(file),
      dropped: lines.length - keep.length,
      kept: keep.length
    });
  }
  readSpans(file) {
    return this.readLines(file).filter((s) => typeof s.hash === "string" && typeof s.text === "string");
  }
  readLines(file) {
    if (!existsSync(file))
      return [];
    let raw = "";
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      this.emit("remember.read.failed", undefined, { code: errCode(err) });
      return [];
    }
    const out = [];
    let corrupt = 0;
    for (const line of raw.split(`
`)) {
      if (line.trim().length === 0)
        continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        corrupt += 1;
      }
    }
    if (corrupt > 0)
      this.emit("remember.line.corrupt", undefined, { count: corrupt });
    return out;
  }
}
export function enters(turn) {
  const source = turn.source ?? "conversation";
  if (source === "foreign")
    return false;
  if (source === "ritual")
    return false;
  if (source === "dream" || carriesDreamMark(turn.text))
    return false;
  return source === "conversation" || source === "injected";
}
function typedAfterReply(kept) {
  let replied = false;
  for (const t of kept) {
    if (t.role === "assistant")
      replied = true;
    else if (replied && (t.source ?? "conversation") === "conversation")
      return true;
  }
  return false;
}
export function keyFor(value) {
  return hashText(value).slice(0, 12);
}
export function errCode(err) {
  if (err !== null && typeof err === "object") {
    const code = err.code;
    if (typeof code === "string")
      return code;
    const name = err.name;
    if (typeof name === "string")
      return name;
  }
  return "UNKNOWN";
}
