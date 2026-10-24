/**
 * THE SELF PAGE — one written page, the same every morning, kept in the store
 * with its versions.
 *
 * Until now "Who I am:" was a rotating list of about twenty identity elements,
 * re-ranked at every boundary, and the entity the store calls the self was a row
 * whose body was its own name. A list that changes every morning is not a self;
 * it is a query result. The owner's ruling of 2026-09-18 (plan §2 item 9): at
 * wake the self is a page of prose, written in the first person, that any woken
 * session may amend and the owner may write by hand, and that says out loud when
 * there is nothing there yet. Promotion and reinforcement still decide what
 * feeds it — they are untouched by this file; the page is where the growth
 * shows.
 *
 * **One row, through the ordinary Store API.** `put` mints it, `revise` changes
 * it (archiving the prior version first, §16 G4), `versions`/`readVersion` read
 * what it used to say. Nothing here knows whether a body is a file or a column,
 * so the floor can move underneath it (plan §3, F5) without this module noticing.
 *
 * **Where it sits, and why it survives sleep.** `type: "schema"`, `kind: "self"`,
 * `meta.role = "page"` — the same shelf the identity core sits on, one role
 * along. That placement is what keeps the sleep cycle off it, using only
 * mechanisms that already existed:
 *
 *   - `dedup` skips every schema row by name (`sleep/types.ts#isSchemaRow`), so
 *     the page is never merged into something that resembles it;
 *   - `prune` is blocked by `protected` (`physics#pruneVerdict`), which the row
 *     is born with — the page is the owner's and the self's standing ink, and
 *     the prune's own vocabulary already has a word for that;
 *   - `decay` and `consolidate` write physics columns and never prose, so the
 *     worst they can do is move a number on a row nothing ranks;
 *   - `scanActive` lists `{ type: "memory" }`, so the page can never enter a
 *     briefing lane as an element and be trimmed as one.
 *
 * Old VERSIONS of the page take the ordinary retention (owner ruling 1, 2026-09-18):
 * `pruneSupersededVersions` deletes by `version_day` alone and has no exemption
 * to make one for, which is the behaviour that ruling asked for.
 *
 * **The role is invisible to `schemas/`** — `toMetaRecord` returns null for any
 * role but entity, belief and current-state, so the page is skipped by the
 * index build rather than mis-filed in it.
 */
import { hashText } from "../store/index.js";
import type { ProseDoc, Store } from "../store/index.js";

/** The `meta.role` that makes a schema row THE page. One per store. */
export const SELF_PAGE_ROLE = "page";

/** The durable row every accepted revision leaves. Read by `fired`. */
export const SELF_PAGE_REVISED_EVENT = "self.page.revised";

/**
 * The durable row every REFUSED write leaves, beside the accepted ones rather
 * than instead of them. Owner ruling 2's corollary (2026-09-18): a cap reports
 * what it refused where the owner can see it — the 196 refused asks sat in the
 * events table unseen for a fortnight.
 */
export const SELF_PAGE_REFUSED_EVENT = "self.page.refused";

/**
 * WHO WROTE THIS REVISION, and the distinction is the reason the field exists:
 * a page the owner typed and a page a nightly writer composed are both
 * legitimate and are not the same claim. `writer` is the nightly writer —
 * sleep's quiet self-update (S2; since 2026-09-28 the first part of the
 * nightly run). `reflection` (2026-09-28) is the run's last part — waking up and
 * thinking about yourself — which had written as `writer` until then: two jobs,
 * both allowed to write the page for now, told apart in the version history.
 * The label is stored in the page's own meta, so a new one needs no schema.
 */
export const SELF_PAGE_AUTHORS = ["session", "owner", "writer", "reflection"] as const;
export type SelfPageAuthor = (typeof SELF_PAGE_AUTHORS)[number];

/**
 * The two CONVENTIONAL headed sections (spec §15 item 1). The page carries
 * them as prose — a convention, not a requirement: any `##` heading is a
 * section (2026-09-28, `pageSections`).
 */
export const PAGE_CORE_HEADING = "Core";
export const PAGE_LATELY_HEADING = "Lately";

/**
 * What a page looks like before anything has been earned — offered by the CLI
 * and named in the tool description, never written by the engine. A store with
 * no page says so; it does not get a page of placeholders minted for it.
 */
export const PAGE_TEMPLATE = [
  `## ${PAGE_CORE_HEADING}`,
  "",
  "Still forming.",
  "",
  `## ${PAGE_LATELY_HEADING}`,
  "",
  "Still forming.",
  "",
].join("\n");

/** The title the row carries, so every id-listing surface names it in words. */
export const PAGE_TITLE = "Who I am";

/**
 * ONE ROW FOR THE LIFE OF THE PAGE, cleared or not (2026-09-18, second review).
 *
 * The first design archived the row on `--clear`. That read as "no page"
 * correctly, but `revisePage` finds LIVE rows, so the next write — including the
 * `--restore <seq>` the clear message itself recommends — minted a fresh row and
 * left four versions with full attribution on a row no surface could reach. The
 * undo mechanism closed behind the owner as he walked through it.
 *
 * So a clear is an ordinary REVISION to this body, with `meta.cleared` set. The
 * row stays live and keeps its whole version chain; the body it replaced becomes
 * an ordinary version, attributed like every other. Every reader — the wake, the
 * doctor, the dashboard, the MCP read, the console — asks `readSelfPage`, which
 * returns null for a cleared row, so the store reads as having no page exactly
 * as if none had ever been written. The next write or restore revises the same
 * row and drops the flag.
 *
 * Two properties fall out, and both are asserted: there is never more than one
 * page row, live or archived; and nothing needs the event log to find the page
 * or its history (attribution still reads it, and says "unrecorded" when a row
 * has been pruned).
 */
export const PAGE_CLEARED_BODY =
  "This page has been cleared. Nothing stands here now; what it used to say is kept in this row's versions.";

/** `meta.cleared` on a page row: when, and why. Absent or null means live. */
export const PAGE_META_CLEARED = "cleared";

export interface PageCleared {
  readonly on: string;
  readonly reason: string;
}

/** The `cleared` marker on a page's prose meta, or null when the page stands. */
export function clearedMarker(meta: Record<string, unknown>): PageCleared | null {
  const raw = meta[PAGE_META_CLEARED];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  return {
    on: typeof rec["on"] === "string" ? rec["on"] : "",
    reason: typeof rec["reason"] === "string" ? rec["reason"] : "",
  };
}

/** Prose meta the page keeps beside its body — the page's own provenance. */
export const PAGE_META_REVISED_ON = "revisedOn";
export const PAGE_META_REVISED_DAY = "revisedDay";
export const PAGE_META_BY = "by";
export const PAGE_META_REASON = "reason";

/**
 * THE SHORT VERSION (2026-10-10), on the page's own prose meta: `{ body, of,
 * bytes }`, where `of` is the content hash (`store/hashText`) of the page text
 * it condenses and `bytes` that text's size. No schema change: the meta is
 * JSON on the row, written in the same `revise` as the page, and every
 * archived version keeps the meta it had — so the history carries each
 * version's short version beside it.
 *
 * TIED TO THE TEXT IT CONDENSES. `revise` MERGES meta, so a write with no
 * short version sets this to null explicitly; and a reader takes it only when
 * `of` is the hash of the body standing now (`readSelfPage`). A page
 * rewritten without one therefore falls to the mechanical rung, never to a
 * stale short version — whichever of the two guards a future path forgets.
 */
export const PAGE_META_SHORT = "short";

/** A short version, as read: only ever the one written WITH the page standing. */
export interface PageShort {
  readonly body: string;
  readonly bytes: number;
}

export interface SelfPage {
  readonly id: string;
  /** The page, verbatim. Never truncated — not here, not in the wake. */
  readonly body: string;
  readonly bytes: number;
  /** The calendar date of the last revision, `YYYY-MM-DD`; "" when unrecorded. */
  readonly revisedOn: string;
  /** The lived day of the last revision; null when unrecorded. */
  readonly revisedDay: number | null;
  readonly by: SelfPageAuthor | null;
  readonly reason: string | null;
  /** `revision` on the row: 0 for a page written once and never amended. */
  readonly version: number;
  /**
   * The short version its writer wrote WITH this text (2026-10-10), or null —
   * none was written, or the one stored condenses a different text
   * (`PAGE_META_SHORT`).
   */
  readonly short: PageShort | null;
  /**
   * What its claims rest on (2026-10-20, `PAGE_META_TRACE`), or null: none
   * was written with this text (a page from before, a session's, the owner's).
   */
  readonly trace: PageTrace | null;
}

/** The short version stored beside a body, when it condenses THAT body. Pure. */
export function shortOf(meta: Record<string, unknown>, body: string): PageShort | null {
  const raw = meta[PAGE_META_SHORT];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const text = rec["body"];
  const of = rec["of"];
  if (typeof text !== "string" || text.trim().length === 0 || typeof of !== "string") return null;
  if (of !== hashText(body)) return null;
  return { body: text, bytes: byteLengthOf(text) };
}

/**
 * THE PAGE, or null. Shaped exactly like `findIdentityCore`, and reading prose
 * for the same reason: box 2 indexes type/kind/band/archived and has no meta
 * query (schemas/INTERFACE-GAPS §2). One store has one page; the first row with
 * the role wins, and a second would be a category error no door here can make.
 */
export function findSelfPage(store: Store): string | null {
  const row = findPageRow(store);
  if (row === null) return null;
  // A CLEARED row is still the page's row — it holds the history — but it is not
  // a page. Every reader that asks "is there a page" comes through here.
  try {
    return clearedMarker(store.readProse(row).meta) === null ? row : null;
  } catch {
    return null;
  }
}

/**
 * THE PAGE'S ROW, cleared or not. The surfaces that read the page's HISTORY —
 * versions, restore — ask for this; the ones that read the PAGE ask
 * `findSelfPage`. There is at most one, by construction: `revisePage` mints only
 * when this returns null, and nothing archives it.
 */
export function findPageRow(store: Store): string | null {
  for (const id of store.list({ type: "schema", kind: "self", archived: false })) {
    try {
      if (store.readProse(id).meta["role"] === SELF_PAGE_ROLE) return id;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Is THIS id the page's row? Used by the owner's console to send `remove` one
 * door along (`self-page --clear`), and true of a CLEARED page too — a row that
 * was the page is still not a row removal should tombstone.
 */
export function isSelfPageRow(store: Store, id: string): boolean {
  const row = store.row(id);
  if (row === undefined || row.type !== "schema" || row.kind !== "self") return false;
  try {
    return store.readProse(id).meta["role"] === SELF_PAGE_ROLE;
  } catch {
    return false;
  }
}

/**
 * The page as a value, or null. To every reader in `self/` a page whose body
 * will not read is absent, never a throw (§5 G7).
 *
 * **What is upstream of that changed with the floor** (schema v6), and the note
 * this replaces was written on the floor before it. There used to be a THIRD
 * state — the page's prose FILE deleted underneath the store — and it never got
 * this far: `Schemas.load` reads every schema row at open, `readProseFile` threw
 * `PROSE_FILE_MISSING`, and `Counterpart.open` took the whole session down with
 * doctor reading RED (measured, `docs/adversarial-review-s1c-2026-09-20.md`
 * MAJOR-1). There is no file to lose now, so that state is gone with it.
 *
 * What is left is two, and `Schemas.load` tells them apart:
 *
 *   - **Tombstoned** — body and content hash both blank, which is what the
 *     owner's removal leaves (`store/operational.ts#rowTombstoned`). `load`
 *     SKIPS it and counts it, so the session still starts, and the deny-list
 *     answers anyone who asks for the id by name. A CLEARED page is a different
 *     thing again and is this function's own business: the row and its words are
 *     intact, a marker in `meta` says the owner emptied it, and the line below
 *     reads it as absent so the wake goes back to its empty-page behaviour.
 *   - **Its words went missing** — a blank body beside a real content hash, a
 *     state no write path produces. `MEMORY_BODY_MISSING` still comes out of
 *     `Schemas.load` and still stands the session down, on purpose: a store that
 *     lost a memory's words underneath itself is a fault the owner must see, not
 *     a page to quietly render as empty.
 */
export function readSelfPage(store: Store): SelfPage | null {
  const id = findPageRow(store);
  if (id === null) return null;
  let doc: ProseDoc;
  try {
    doc = store.readProse(id);
  } catch {
    return null;
  }
  // Cleared reads as absent, which is what makes the wake go back to its
  // empty-page behaviour without anything else in the tree knowing the word.
  if (clearedMarker(doc.meta) !== null) return null;
  const row = store.row(id);
  const by = doc.meta[PAGE_META_BY];
  const revisedDay = doc.meta[PAGE_META_REVISED_DAY];
  const revisedOn = doc.meta[PAGE_META_REVISED_ON];
  const reason = doc.meta[PAGE_META_REASON];
  return {
    id,
    body: doc.body,
    bytes: byteLengthOf(doc.body),
    revisedOn: typeof revisedOn === "string" ? revisedOn : "",
    revisedDay: typeof revisedDay === "number" ? revisedDay : null,
    by: isAuthor(by) ? by : null,
    reason: typeof reason === "string" && reason.length > 0 ? reason : null,
    version: row?.revision ?? 0,
    short: shortOf(doc.meta, doc.body),
    trace: traceOf(doc.meta, doc.body),
  };
}

function isAuthor(v: unknown): v is SelfPageAuthor {
  return typeof v === "string" && (SELF_PAGE_AUTHORS as readonly string[]).includes(v);
}

/** Local so this file imports no renderer; identical to `identity.ts#byteLength`. */
function byteLengthOf(s: string): number {
  return new TextEncoder().encode(s).length;
}

// ── the page's own revision line ────────────────────────────────────────────

/**
 * The longest line that can be a page's own revision line. Past it the line
 * is prose that happens to open with the words, and it stays.
 */
export const REVISED_LINE_MAX_CHARS = 160;

/** A date as a dateline states one: ISO or numeric, a month's name and a day,
 *  or the day words the writers used before the 10-01 guidance. */
const REVISED_DATE = String.raw`(?:(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:\d{4}|\d{1,2}))(?!\d)|(?:\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|today|tonight|yesterday)(?![a-z]))`;

/** "Last revised", then the date — straight after, or after "on" or a short
 *  "by …" (review of #332: without the date, "Last revised my view of …", a
 *  quoted line and a list entry were all taken). */
const REVISED_OPENING = new RegExp(
  String.raw`^last\s+revised\b[\s:,(*_\-–—]*(?:on\s+)?(?:by\s+[^,;:\n]{1,48}?[\s,]+(?:on\s+)?)?${REVISED_DATE}`,
  "iu",
);

/** A Markdown list entry: `- `, `* `, `+ `, `1. ` or `1) `. */
const LIST_ENTRY = /^\s*(?:[-*+]|\d+[.)])\s+/u;

/** A code fence's opening or closing line. */
const FENCE = /^\s{0,3}(?:```|~~~)/u;

/**
 * IS THIS LINE THE PAGE'S OWN "LAST REVISED" LINE (2026-10-09)? A whole line
 * that opens — past any wrapping of parentheses, brackets, emphasis, a quote
 * marker or a dash — with "Last revised" and a date (`REVISED_OPENING`), and
 * is short. A sentence that says the words in the middle of a paragraph is
 * not one, and neither is a line that opens with them and goes on to say
 * something else. Where it stands is `stripRevisedLines`'s to judge.
 */
export function isRevisedLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > REVISED_LINE_MAX_CHARS) return false;
  return REVISED_OPENING.test(t.replace(/^[>(\[*_\s\-–—]+/u, ""));
}

/**
 * THE PAGE WITHOUT ITS OWN "LAST REVISED" LINES (2026-10-09). The wake dates
 * the page (`briefing.ts#pageDateline`), so a page that carries its own line
 * printed two, one under the other. The writers were told not to add one
 * (`writer.ts#PAGE_WRITING_RULE`, 2026-10-01), which is guidance and checks
 * nothing, and a page that already carried the line kept printing it. Taken
 * out where the wake renders the page and where the page is written
 * (`Self#revisePage`), so a stored page heals the next time it is written.
 *
 * A dateline stands alone, so three places keep the line (review of #332):
 * inside a code fence; beside another such line, with no blank between (two
 * in a row are the page's own history); and as an entry of a list, beside
 * another entry. A lone one, at the head, the foot or between sections, goes.
 *
 * Only the line goes, and the blank line it stood behind when it stood
 * between two, so a removed line leaves no gap of two. `stripped` counts what
 * went; with none, the body is returned exactly as it came. Pure.
 */
export function stripRevisedLines(body: string): { body: string; stripped: number } {
  const lines = body.split("\n");
  let fenced = false;
  const dateline = lines.map((l) => {
    if (FENCE.test(l)) {
      fenced = !fenced;
      return false;
    }
    return !fenced && isRevisedLine(l);
  });
  const beside = (i: number): number[] =>
    [i - 1, i + 1].filter((j) => j >= 0 && j < lines.length && (lines[j] ?? "").trim() !== "");
  const kept = (i: number): boolean =>
    beside(i).some((j) => dateline[j] === true) ||
    (LIST_ENTRY.test(lines[i] ?? "") && beside(i).some((j) => LIST_ENTRY.test(lines[j] ?? "")));
  const out: string[] = [];
  let stripped = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (dateline[i] !== true || kept(i)) {
      out.push(line);
      continue;
    }
    stripped += 1;
    const before = out[out.length - 1];
    if ((before === undefined || before.trim() === "") && (lines[i + 1] ?? "x").trim() === "") i += 1;
  }
  return stripped === 0 ? { body, stripped: 0 } : { body: out.join("\n").trim(), stripped };
}

// ── what the wake prints ────────────────────────────────────────────────────
//
// THE PAGE IS NEVER CUT (2026-10-09). The wake prints the first rung of its
// ladder that fits, every rung whole text (2026-10-10, `briefing.ts#PageRung`,
// decided in `Self#pageBlock`): the page, its short version, the outline below,
// its headings, one line. The cut this section used to make (paragraph, then
// line, then bytes, with a marker naming both numbers) is gone. Its history is
// in self NOTES.

/**
 * The marker a cut page carried, in a wake published BEFORE 2026-10-09. No
 * render writes it now; kept so a reader of an old bundle (the dashboard's
 * wake costs, `views/health.ts`) can still name what that wake left out until
 * the next render replaces it.
 */
export function truncationMarker(shown: number, whole: number): string {
  return `[This page is ${whole} bytes; the wake shows the first ${shown}. Run 'counterparts self-page' to read it whole.]`;
}

// ── reading the page's own shape ────────────────────────────────────────────

/** One headed section of the page, in the page's own order. */
export interface PageSection {
  /** The heading's words, as written (without the `#`s). */
  readonly heading: string;
  /** The heading's level: 2 for `##`. */
  readonly level: number;
  /** Its words, up to the next heading of any level, trimmed. */
  readonly body: string;
}

export interface PageSections {
  /** The `## Core` section's words, or "" — the convention's first half. */
  readonly core: string;
  /** The `## Lately` section's words, or "" — the convention's second half. */
  readonly lately: string;
  /** Anything before the first heading, or the whole body when it has none. */
  readonly preamble: string;
  /** False when the page carries no heading at all — still a page, just prose. */
  readonly headed: boolean;
  /**
   * EVERY HEADED SECTION, in order (2026-09-28): "Us", "How I work", or
   * whatever the page grew — Core and Lately among them when present. A
   * surface that shows the page in parts shows all of these, so a section
   * outside the convention does not fall out.
   */
  readonly sections: readonly PageSection[];
}

/** A heading line: `#`…`######`, a space, words. `##Core` (no space) is read too, as it always was. */
const HEADING = /^(#{1,6})(?:[ \t]+(\S.*?)|[ \t]*(core|lately))[ \t]*#*[ \t]*$/i;

/**
 * Split a page at its own headings, for the surfaces that show it in parts
 * (the dashboard, the console). ANY heading makes a section (2026-09-28: only
 * Core and Lately did, so "Us" and "How I work" fell out of every view that
 * read the parts); Core and Lately are the convention, kept by name. The WAKE
 * never calls this: it prints the page as is, because a page reassembled from
 * parts is a page this engine wrote.
 */
export function pageSections(body: string): PageSections {
  const lines = body.split("\n");
  const starts: { line: number; heading: string; level: number }[] = [];
  lines.forEach((line, i) => {
    const m = HEADING.exec(line.trimEnd());
    if (m !== null) starts.push({ line: i, heading: (m[2] ?? m[3] ?? "").trim(), level: (m[1] ?? "").length });
  });
  if (starts.length === 0) {
    return { core: "", lately: "", preamble: body.trim(), headed: false, sections: [] };
  }
  const sections: PageSection[] = starts.map((s, i) => {
    const end = starts[i + 1]?.line ?? lines.length;
    return { heading: s.heading, level: s.level, body: lines.slice(s.line + 1, end).join("\n").trim() };
  });
  const named = (name: string): string => sections.find((s) => s.heading.toLowerCase() === name.toLowerCase())?.body ?? "";
  return {
    core: named(PAGE_CORE_HEADING),
    lately: named(PAGE_LATELY_HEADING),
    preamble: lines.slice(0, starts[0]?.line ?? 0).join("\n").trim(),
    headed: true,
    sections,
  };
}

// ── the mechanical version (2026-10-10) ─────────────────────────────────────

/**
 * The longest "first sentence" the outline carries, in bytes. A section that
 * opens with one longer — a paragraph with no full stop in it — shows its
 * heading alone rather than a cut of it: every rung is whole text.
 */
export const OUTLINE_SENTENCE_MAX_BYTES = 480;

/** Words whose full stop ends no sentence. Lowercased, without the stop. */
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "st", "no", "cf", "approx"]);

/** A sentence's end: `.`, `!` or `?`, any closing quotes or brackets, then a space or the end. */
const SENTENCE_END = /[.!?]["'”’)\]*_]*(?=\s|$)/gu;

/**
 * THE FIRST WHOLE SENTENCE of a section's words, or null (2026-10-10, the
 * mechanical rung). Mechanical on purpose — it reads, it does not summarise:
 * the first paragraph (or the first entry of a list that opens the section),
 * its lines joined, up to the first full stop, question or exclamation mark
 * that ends a sentence (not "e.g." or "v0.3.14"). With no such mark, the
 * whole first line. Longer than `OUTLINE_SENTENCE_MAX_BYTES`, null — never a
 * cut. Pure.
 */
export function firstSentence(text: string): string | null {
  const para = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 0);
  if (para === undefined) return null;
  const lines = para.split("\n").map((l) => l.trim());
  const first = lines[0] ?? "";
  // A list that opens the section: its first entry, which is its own line.
  // Otherwise the paragraph's lines, up to a list that follows it unbroken.
  const block: string[] = [];
  if (LIST_ENTRY.test(first)) block.push(first.replace(LIST_ENTRY, ""));
  else {
    for (const l of lines) {
      if (LIST_ENTRY.test(l)) break;
      block.push(l);
    }
  }
  const flat = block.join(" ").replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  let sentence: string | null = null;
  for (const m of flat.matchAll(SENTENCE_END)) {
    const end = (m.index ?? 0) + m[0].length;
    const before = flat.slice(0, m.index ?? 0);
    const word = (/(\S+)$/.exec(before)?.[1] ?? "").toLowerCase().replace(/^[("'“‘*_]+/u, "");
    if (m[0].startsWith(".") && (ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word))) continue;
    sentence = flat.slice(0, end);
    break;
  }
  const out = sentence ?? (LIST_ENTRY.test(first) ? flat : first.replace(/\s+/g, " "));
  if (out.length === 0 || byteLengthOf(out) > OUTLINE_SENTENCE_MAX_BYTES) return null;
  return out;
}

/** One entry of the outline: the heading as the page writes it, and its first sentence. */
export interface PageOutlineEntry {
  /** `## Core` — the heading line, as a heading. */
  readonly heading: string;
  /** Its first whole sentence, or null when it has none short enough. */
  readonly sentence: string | null;
}

export interface PageOutline {
  /** The first sentence of anything before the first heading, or of the whole page when it has none. */
  readonly lead: string | null;
  readonly entries: readonly PageOutlineEntry[];
}

/**
 * THE PAGE'S OUTLINE (2026-10-10): each `##` section's heading and its first
 * whole sentence (`firstSentence`) — the mechanical rung, for a wake with no
 * room for the page and no short version written with it. Level-two
 * headings, the page's convention; a page with none uses its highest level
 * there is. Never the WAKE's words about the page: only the page's own. Pure.
 */
export function pageOutline(body: string): PageOutline {
  const parts = pageSections(body);
  const lead = firstSentence(parts.preamble);
  if (!parts.headed) return { lead, entries: [] };
  const levels = parts.sections.map((s) => s.level);
  const level = levels.includes(2) ? 2 : Math.min(...levels);
  return {
    lead,
    entries: parts.sections
      .filter((s) => s.level === level && s.heading.length > 0)
      .map((s) => ({ heading: `${"#".repeat(s.level)} ${s.heading}`, sentence: firstSentence(s.body) })),
  };
}

/** The outline as the wake prints it, or null when there is nothing to print. Pure. */
export function outlineText(outline: PageOutline): string | null {
  const lines: string[] = [];
  if (outline.lead !== null) lines.push(outline.lead);
  for (const e of outline.entries) {
    lines.push(e.heading);
    if (e.sentence !== null) lines.push(e.sentence);
  }
  return lines.length === 0 ? null : lines.join("\n");
}

/** The headings alone, as the wake prints them, or null when the page has none. Pure. */
export function headingsText(outline: PageOutline): string | null {
  return outline.entries.length === 0 ? null : outline.entries.map((e) => e.heading).join("\n");
}

// ── what each claim rests on (2026-10-20, an experiment) ────────────────────

/**
 * THE PAGE'S TRACE, on its own prose meta: `{ of, cites, claims }`, where `of`
 * is the content hash of the page text it traces (as `PAGE_META_SHORT`'s is),
 * `cites` the memory ids the whole page rests on, and `claims` one entry per
 * sentence its writer said rests on memories: `{ of, cites }`, `of` that
 * sentence's key (`claimKey`). `claims` is null when the writer sent only the
 * whole-page list. No schema change: JSON on the row, written in the same
 * `revise`, and every archived version keeps its own.
 *
 * Mike, 10-20: a claim is a sentence, to start. A sentence no passage names
 * is a claim with no memory behind it, a hypothesis: shown as one, never
 * removed. Tied to the text like the short version: a page rewritten without
 * a trace reads as untraced, never with the last page's.
 */
export const PAGE_META_TRACE = "trace";

/** One claim of the page as read: its sentence and the ids behind it ([] for none). */
export interface PageClaim {
  readonly text: string;
  readonly cites: readonly string[];
}

/** The trace as read, only ever the one written with the text standing. */
export interface PageTrace {
  /** The ids the whole page rests on, as its writer sent them (and every claim's). */
  readonly cites: readonly string[];
  /** Every claim on the page, in order; null when its writer sent cites for the whole page only. */
  readonly claims: readonly PageClaim[] | null;
}

/** What `Self#revisePage` stores under `PAGE_META_TRACE`. */
export interface StoredTrace {
  readonly of: string;
  readonly cites: readonly string[];
  readonly claims: readonly { readonly of: string; readonly cites: readonly string[] }[] | null;
}

/** What a writer sent: the whole page's ids, and passages (a sentence or a few, as on the page) with theirs. */
export interface TraceInput {
  readonly cites: readonly string[];
  /** `text`: the words as on the page; `of`: a sentence's key instead (a restore carries the keys it stored). */
  readonly claims?: readonly { readonly text?: string; readonly of?: string; readonly cites: readonly string[] }[] | null;
}

/** Sentences inside one flat run of words, by the rule `firstSentence` uses. */
function sentencesOf(flat: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (const m of flat.matchAll(SENTENCE_END)) {
    const at = m.index ?? 0;
    const word = (/(\S+)$/.exec(flat.slice(from, at))?.[1] ?? "").toLowerCase().replace(/^[("'“‘*_]+/u, "");
    if (m[0].startsWith(".") && (ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word))) continue;
    const s = flat.slice(from, at + m[0].length).trim();
    if (s.length > 0) out.push(s);
    from = at + m[0].length;
  }
  const rest = flat.slice(from).trim();
  if (rest.length > 0) out.push(rest);
  return out;
}

/**
 * THE PAGE'S CLAIMS: its sentences, in order (2026-10-20). Headings are not
 * claims, nor is anything inside a code fence; each list entry and each
 * paragraph is split at the ends of its sentences, skipping the abbreviations
 * `firstSentence` skips. A run of words with no full stop is one claim. Pure.
 */
export function pageClaims(body: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  let fenced = false;
  const flush = (): void => {
    const flat = cur.join(" ").replace(/\s+/g, " ").trim();
    if (flat.length > 0) blocks.push(flat);
    cur = [];
  };
  for (const raw of body.split("\n")) {
    if (FENCE.test(raw)) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const line = raw.trim();
    if (line.length === 0 || HEADING.test(raw.trimEnd())) {
      flush();
      continue;
    }
    const quoted = line.replace(/^>\s?/u, "");
    if (LIST_ENTRY.test(quoted)) {
      flush();
      cur.push(quoted.replace(LIST_ENTRY, ""));
      continue;
    }
    cur.push(quoted);
  }
  flush();
  return blocks.flatMap(sentencesOf);
}

/** A claim's words as matched: emphasis, code marks and curly quotes aside, spacing and case folded. */
function claimNorm(text: string): string {
  return text
    .replace(/[*_`]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The key a sentence is stored under in a trace: the hash of its folded words. Pure. */
export function claimKey(sentence: string): string {
  return hashText(claimNorm(sentence));
}

/** The shortest opening a passage may be sent as and still name its sentence. */
export const CLAIM_PREFIX_MIN_CHARS = 24;

/**
 * WHICH SENTENCES OF `body` EACH SENT PASSAGE NAMES, and the trace to store
 * (2026-10-20). A passage names a sentence when, folded (`claimNorm`), it is
 * that sentence or an opening of it at least `CLAIM_PREFIX_MIN_CHARS` long; a
 * passage of several sentences names each, split as the page is (`pageClaims`:
 * a list mark, a quote mark or a heading quoted with it is not part of it). One
 * that names none is counted in
 * `unmatched`, and its ids stay with the whole page's. A sentence two passages
 * name rests on both's ids. Only reads the page's words, never changes them.
 * `body` is the text as stored. Pure.
 */
export function traceFor(
  body: string,
  input: TraceInput,
): { trace: StoredTrace; claims: number; cited: number; unmatched: number } {
  const sentences = pageClaims(body);
  const keys = sentences.map(claimKey);
  const norms = sentences.map(claimNorm);
  const whole = [...new Set(input.cites)];
  if (input.claims === undefined || input.claims === null) {
    return { trace: { of: hashText(body), cites: whole, claims: null }, claims: sentences.length, cited: 0, unmatched: 0 };
  }
  const behind = new Map<number, Set<string>>();
  let unmatched = 0;
  for (const c of input.claims) {
    const hit: number[] = [];
    if (typeof c.of === "string") {
      keys.forEach((k, i) => {
        if (k === c.of) hit.push(i);
      });
    } else if (typeof c.text === "string") {
      // Read by the page's own rules (review of #550): a passage quoted with
      // its list mark, its quote mark or its heading names the same sentences.
      for (const part of pageClaims(c.text).map(claimNorm)) {
        if (part.length === 0) continue;
        const free = (i: number): boolean => !hit.includes(i);
        const exact = norms.findIndex((n, i) => n === part && free(i));
        const at =
          exact >= 0 ? exact : part.length >= CLAIM_PREFIX_MIN_CHARS ? norms.findIndex((n, i) => n.startsWith(part) && free(i)) : -1;
        if (at >= 0) hit.push(at);
      }
    }
    if (hit.length === 0) {
      unmatched += 1;
      continue;
    }
    for (const i of hit) {
      const set = behind.get(i) ?? new Set<string>();
      for (const id of c.cites) set.add(id);
      behind.set(i, set);
    }
  }
  const claims = [...behind.entries()]
    .filter(([, set]) => set.size > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([i, set]) => ({ of: keys[i] as string, cites: [...set] }));
  for (const c of claims) for (const id of c.cites) if (!whole.includes(id)) whole.push(id);
  return { trace: { of: hashText(body), cites: whole, claims }, claims: sentences.length, cited: claims.length, unmatched };
}

/** The stored trace on a meta when it traces THIS body, as a revise carries it; else null. Pure. */
export function storedTraceOf(meta: Record<string, unknown>, body: string): StoredTrace | null {
  const raw = meta[PAGE_META_TRACE];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (rec["of"] !== hashText(body)) return null;
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const claims = Array.isArray(rec["claims"])
    ? (rec["claims"] as unknown[])
        .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && typeof (c as Record<string, unknown>)["of"] === "string")
        .map((c) => ({ of: c["of"] as string, cites: ids(c["cites"]) }))
    : null;
  return { of: rec["of"], cites: ids(rec["cites"]), claims };
}

/** The trace stored beside a body, when it traces THAT body, with each claim's words. Pure. */
export function traceOf(meta: Record<string, unknown>, body: string): PageTrace | null {
  const stored = storedTraceOf(meta, body);
  if (stored === null) return null;
  if (stored.claims === null) return { cites: stored.cites, claims: null };
  const byKey = new Map(stored.claims.map((c) => [c.of, c.cites]));
  return { cites: stored.cites, claims: pageClaims(body).map((text) => ({ text, cites: byKey.get(claimKey(text)) ?? [] })) };
}

// ── the page split by section (lane N1 part 2, 2026-10-23, `self.PAGE_SPLIT`) ──

/** Who writes which part of the page on a split night: the writer all but "## Core", the reflection "## Core" alone. */
export type PageLane = "writer" | "reflection";

/** What a lane's write became: the page to store, and what was taken from the page as it stands. */
export interface PageLaneSplice {
  /** The page to store. */
  readonly body: string;
  /** Sections the write changed or dropped outside its lane, taken back from the page as it stands, by heading. */
  readonly kept: readonly string[];
  /** A reflection's write with headings but no "## Core": nothing in its lane. */
  readonly empty: boolean;
}

interface LaneBlock {
  /** "" for the words before the first heading. */
  readonly heading: string;
  readonly lines: readonly string[];
}

/**
 * A page in blocks for the lanes: the words before the first heading, then
 * one block per heading — "## Core" running to the next heading of its level
 * or above, so a "###" inside it stays with it. A heading inside a code fence
 * is words. Pure.
 */
function laneBlocks(body: string): LaneBlock[] {
  const out: { heading: string; lines: string[] }[] = [{ heading: "", lines: [] }];
  let fenced = false;
  let inCore = 0;
  for (const line of body.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;
    const m = fenced ? null : HEADING.exec(line.trimEnd());
    const level = m === null ? 0 : (m[1] ?? "").length;
    if (m !== null && (inCore === 0 || level <= inCore)) {
      const heading = (m[2] ?? m[3] ?? "").trim();
      // A "# Core" (or "#Core") ends at the next "##" too (review of #603):
      // read to the next heading of its own level, it swallowed every
      // section after it.
      inCore = heading.toLowerCase() === PAGE_CORE_HEADING.toLowerCase() ? Math.max(2, level) : 0;
      out.push({ heading, lines: [line] });
      continue;
    }
    (out[out.length - 1] as { lines: string[] }).lines.push(line);
  }
  return out;
}

const isCoreBlock = (b: LaneBlock): boolean => b.heading.toLowerCase() === PAGE_CORE_HEADING.toLowerCase();
const blockText = (b: LaneBlock | undefined): string => (b === undefined ? "" : b.lines.join("\n").trim());

/**
 * The page again from its blocks, line for line — so a page none of whose
 * blocks moved comes back byte for byte (its trace and short version still
 * name it). A block brought in from the other page ends in one blank line
 * when another follows it.
 */
function joinBlocks(bs: readonly LaneBlock[], brought: LaneBlock | null): string {
  const lines: string[] = [];
  bs.forEach((b, i) => {
    if (b !== brought) {
      lines.push(...b.lines);
      return;
    }
    const own = [...b.lines];
    while (own.length > 0 && (own[own.length - 1] as string).trim().length === 0) own.pop();
    if (lines.length > 0 && (lines[lines.length - 1] as string).trim().length > 0) lines.push("");
    lines.push(...own);
    if (i < bs.length - 1) lines.push("");
  });
  return lines.join("\n").trim();
}

/**
 * ONE LANE'S WRITE, HELD TO ITS LANE (2026-10-23): what is outside the lane is
 * taken from the page as it stands, never refused (guards loose-first), and
 * named in `kept` when the write had changed or dropped it.
 *   - writer: the page as sent, with "## Core" as it stands (put back first
 *     when the write left it out). While the page has no "## Core", the
 *     writer's stands.
 *   - reflection: the page as it stands, with "## Core" as sent (added first
 *     when the page had none). A write with no heading at all is read as
 *     "## Core"'s words; one with headings but no "## Core" is `empty`.
 * With no page yet, the write is the page, whole. Pure.
 */
export function splicePageLane(sent: string, current: string | null, lane: PageLane): PageLaneSplice {
  if (current === null || current.trim().length === 0) return { body: sent, kept: [], empty: false };
  const now = laneBlocks(current);
  const got = laneBlocks(sent);
  const nowCore = coreGroup(now);
  if (lane === "writer") {
    if (nowCore === null) return { body: sent, kept: [], empty: false };
    // Every "## Core" the write carries, as one (review of #603: a second
    // one further down slipped past when only the first was compared).
    const gotCore = coreGroup(got);
    if (gotCore !== null && blockText(gotCore) === blockText(nowCore)) return { body: sent, kept: [], empty: false };
    return { body: joinBlocks(withCore(got, nowCore), nowCore), kept: [PAGE_CORE_HEADING], empty: false };
  }
  const headed = got.length > 1;
  const sentCore = headed ? coreGroup(got) : { heading: PAGE_CORE_HEADING, lines: [`## ${PAGE_CORE_HEADING}`, "", sent.trim()] };
  // Headings but no "## Core", or a "## Core" with nothing under it: nothing in its lane.
  if (sentCore === null || sentCore.lines.slice(1).join("\n").trim().length === 0) return { body: current, kept: [], empty: true };
  // Its heading as the page writes it (review of #603: a "#Core" sent once
  // made a level-1 Core every night after).
  const core: LaneBlock = { heading: PAGE_CORE_HEADING, lines: [`## ${PAGE_CORE_HEADING}`, ...sentCore.lines.slice(1)] };
  // What the write changed outside its lane: a section sent with other words
  // than the page has. One it left out is simply kept, and not named.
  const kept: string[] = [];
  if (headed) {
    for (const b of got) {
      if (isCoreBlock(b) || blockText(b).length === 0) continue;
      const theirs = now.find((n) => n.heading.toLowerCase() === b.heading.toLowerCase());
      if (blockText(b) !== blockText(theirs)) kept.push(b.heading === "" ? "the words before the first heading" : b.heading);
    }
  }
  if (nowCore !== null && now.filter(isCoreBlock).length === 1 && blockText(nowCore) === blockText(core)) return { body: current, kept, empty: false };
  return { body: joinBlocks(withCore(now, core), core), kept, empty: false };
}

/** Every Core block of a page, as one block in order (blank-line apart); null for none. */
function coreGroup(bs: readonly LaneBlock[]): LaneBlock | null {
  const cs = bs.filter(isCoreBlock);
  if (cs.length === 0) return null;
  const lines: string[] = [];
  for (const b of cs) {
    const own = [...b.lines];
    while (own.length > 0 && (own[own.length - 1] as string).trim().length === 0) own.pop();
    if (lines.length > 0) lines.push("");
    lines.push(...own);
  }
  return { heading: PAGE_CORE_HEADING, lines };
}

/** The page's blocks with every Core block taken out and `core` put where the first one stood (after the words before the first heading, when it had none). */
function withCore(bs: readonly LaneBlock[], core: LaneBlock): LaneBlock[] {
  const first = bs.findIndex(isCoreBlock);
  const rest = bs.filter((b) => !isCoreBlock(b));
  const at = first < 0 ? 1 : bs.slice(0, first).filter((b) => !isCoreBlock(b)).length;
  return [...rest.slice(0, at), core, ...rest.slice(at)];
}

/**
 * A KEPT SENTENCE KEEPS WHAT IT RESTED ON (2026-10-23, `self.PAGE_SPLIT`):
 * each sentence of the new page that the write's own trace leaves uncited,
 * and that stood word for word (`claimKey`) on the page before with ids
 * behind it, carries those ids forward — so a line the next writer kept does
 * not decay into a hypothesis. `next`: the trace the write sent (null: none);
 * `prev`: the one stored with the page before (null: none). `body` is the new
 * text as stored. Pure.
 */
export function carryTrace(body: string, next: StoredTrace | null, prev: StoredTrace | null): { trace: StoredTrace | null; carried: number } {
  if (prev === null || prev.claims === null || prev.claims.length === 0) return { trace: next, carried: 0 };
  const before = new Map(prev.claims.map((c) => [c.of, c.cites]));
  const own = new Map((next?.claims ?? []).map((c) => [c.of, c.cites]));
  const claims: { of: string; cites: readonly string[] }[] = [];
  const seen = new Set<string>();
  let carried = 0;
  for (const key of pageClaims(body).map(claimKey)) {
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = own.get(key);
    if (mine !== undefined && mine.length > 0) {
      claims.push({ of: key, cites: mine });
      continue;
    }
    const theirs = before.get(key);
    if (theirs !== undefined && theirs.length > 0) {
      claims.push({ of: key, cites: theirs });
      carried += 1;
    }
  }
  if (carried === 0) return { trace: next, carried: 0 };
  const whole = [...(next?.cites ?? [])];
  for (const c of claims) for (const id of c.cites) if (!whole.includes(id)) whole.push(id);
  return { trace: { of: hashText(body), cites: whole, claims }, carried };
}
