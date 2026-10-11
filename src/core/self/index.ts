/**
 * `self/` — the autobiographical self: identity elements, the first-person
 * episode journal, and the wake briefing that restores a continuous self at
 * session start.
 *
 * The module's spine, and where each piece lives:
 *
 *   `identity.ts`  ranking by strength, the identity/protected enumeration, the
 *                  standing self-schema byte counter
 *   `briefing.ts`  the composed budget, the declared trim order, the header and
 *                  tail sentinel — no model, no network, no prompt
 *   `freeze.ts`    freeze-but-keep-counting: the lived-salience doctrine as a
 *                  pure verdict both arms compute
 *   `episodes.ts`  substance-paced chapters, live append, add-first ingestion
 *   `tunables.ts`  every knob, in one visible place — and NOT the byte budget
 *
 * Three properties are structural here and worth stating at the top.
 *
 * **RENDER and WAKE are different halves of different sessions.** `boundary()`
 * composes and publishes; `wake()` reads what was published and verifies it. The
 * briefing is the previous boundary's last content write, and wake performs no
 * computation, no model call, and no network access — nor any WRITE, which is the
 * part v1's own design left implicit and then leaned on.
 *
 * **The budget is the caller's.** `budgetBytes` is required on the request
 * because the injection ceiling is a host capability the adapter reports (scar
 * §2.18). v1's 9,000 was 90% of one host's cliff and there is deliberately no
 * such constant in this module.
 *
 * **The freeze withholds movement, never measurement.** `noteSelfConfirmation`
 * runs one walk with one set of guards and emits one event name; `frozen` is a
 * field on that event, not a different code path, so the frozen rate and the live
 * rate share a denominator (§14.2 G4).
 *
 * There is **no tool surface in this module**. v1's self-store tool is superseded
 * by experiencer authorship (contract §4): the doctrine that identity strength
 * comes from lived salience is kept whole, and the end-of-session write *is* the
 * front door it names. Authorship arrives through `remember/`; `self/` is where
 * it lands. *If a doctrine names the only legitimate inputs, those inputs must be
 * reachable by construction, not by a tool description nobody reads.*
 */
import type { Band, Kind } from "../types.js";
import { strength } from "../physics/index.js";
import type { CreditOutcome, UseTier } from "../physics/index.js";
import type { AboutMark, AboutSetter, ProseDoc, Store } from "../store/index.js";
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
  schemaBytes,
} from "./identity.js";
import { coveredByPage } from "./covered.js";
import type {
  Enumeration,
  IdentityCoreSpec,
  LaneName,
  Lanes,
  Ranked,
  Scanned,
  SchemaBytesReport,
} from "./identity.js";
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
  render,
} from "./briefing.js";
import type {
  BriefingRequest,
  BriefingResult,
  PageBlock,
  PageRung,
  Resolve,
  Resolved,
  SentinelReading,
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
  stripRevisedLines,
} from "./page.js";
import type { SelfPage, SelfPageAuthor } from "./page.js";
import {
  SELF_PAGE_WRITER_EVENT,
  dayMemories,
  nightClaimFor,
  pageWriterClaimOpen,
  pageWriterDue,
  pageWriterNight,
  pageWriterRuns,
  pageWriterStatus,
} from "./writer.js";
import type {
  PageWriterDue,
  PageWriterMode,
  PageWriterOutcome,
  PageWriterRun,
  PageWriterStatus,
  WriterInput,
} from "./writer.js";
import { COUNTER_PREFIX, FROZEN_KINDS, counterKey, decide } from "./freeze.js";
import type { ClaimDirection, ClaimSource, FreezeReason, FreezeVerdict } from "./freeze.js";
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
  stateKey,
} from "./episodes.js";
import type {
  AskVerdict,
  EpisodeGate,
  EpisodeIntakeReason,
  EpisodeProposal,
  EpisodeState,
  IngestResult,
  PaceOptions,
  Substance,
} from "./episodes.js";
import {
  backfillJournalCopies,
  noteJournalCopy,
  syncJournalCopy,
} from "./journal-file.js";
import type { JournalCopyOutcome } from "./journal-file.js";
import { withTunables } from "./tunables.js";
import type { SelfTunables } from "./tunables.js";
import { calendarDate } from "./calendar.js";
import { markWakeBehind } from "./behind.js";
import { standingOf } from "../recall/standing.js";

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

/** Telemetry: ids, counts, bytes, reasons, flags. NEVER statement text. */
export interface SelfEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

/**
 * The published briefing lives in box 2, under one key, written by one
 * transactional `setMeta` — so a concurrent read sees the old bundle or the new
 * one and never an empty string. v1's `wake.md` was the one live-read file still
 * written non-atomically, and because an empty string is falsy, an empty
 * concurrent read printed "your persistent memory is initializing" over a full
 * store: identity amnesia disguised as a fresh install (scar §2.3).
 * INTERFACE-GAPS #4 records the store-owned render file this should become.
 */
export const BRIEFING_KEY = "self.briefing";

/**
 * THE IDS THE PUBLISHED BUNDLE LISTS UNDER "Still open:" (review of #332,
 * 2026-10-09): a JSON array, written beside `BRIEFING_KEY` at each publish,
 * so a line the delivery adds — the handoff's "since" line — can leave out
 * what the wake already says is open rather than name it twice. Kept, not
 * ranked, as the identity rotation's ids are.
 */
export const THREADS_SHOWN_KEY = "self.threads.shown";

/** The ids the published bundle lists under "Still open:" — none when the
 *  key is absent (a bundle published before it) or unreadable. Never throws. */
export function threadsShown(store: Pick<Store, "getMeta">): Set<string> {
  try {
    const raw: unknown = JSON.parse(store.getMeta(THREADS_SHOWN_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * WHAT THE PUBLISHED BUNDLE SHOWED, AND IN WHAT ROOM (2026-10-10): a JSON
 * record written beside `BRIEFING_KEY` at each publish, so a session start can
 * ASSEMBLE its wake (`Self#assemble`) rather than read one composed at the last
 * turn-end. The stateful lanes stay the turn-end's — the identity rotation and
 * "Nearby", whose showing is written at publish (`recordHintDisplay`, the
 * rotation stamps) — so their ids are kept here, in order; the stateless ones
 * ("Still open", "Arriving", "Yesterday", the page) are read fresh. The room
 * is the turn-end's too: the budget the composition had and what the
 * delivery's rooms lent it, decided where reading every directory's handoffs,
 * chapters and work lines is affordable. `ceiling` is the host's reported
 * budget that room was cut from; a session start under another ceiling
 * delivers the published bundle as it is.
 */
export const WAKE_SHOWN_KEY = "self.briefing.shown";

export interface WakeShown {
  readonly v: 1;
  /** The published bundle's hash (`hashText`): the record speaks for that
   *  bundle only. */
  readonly hash: string;
  /** The host's reported budget the render was composed under, or null. */
  readonly ceiling: number | null;
  /** The composition's budget (`BriefingRequest.budgetBytes`). */
  readonly budget: number;
  readonly lend: number;
  readonly handoffLend: number;
  readonly handoffKeep: number;
  /** Kept ids, in rendered order. */
  readonly identity: readonly string[];
  readonly craft: readonly string[];
  readonly hints: readonly string[];
  /** What each list lane left out, by id — its "N more" line's. */
  readonly more: { readonly identity: readonly string[]; readonly craft: readonly string[] };
}

/** The record `WAKE_SHOWN_KEY` holds, or null — absent (a bundle published
 *  before it), unreadable, or of another version. Never throws. */
export function wakeShown(store: Pick<Store, "getMeta">): WakeShown | null {
  try {
    const raw: unknown = JSON.parse(store.getMeta(WAKE_SHOWN_KEY) ?? "null");
    if (raw === null || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const ids = (v: unknown): string[] | null =>
      Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const more = (r["more"] ?? {}) as Record<string, unknown>;
    const identity = ids(r["identity"]);
    const craft = ids(r["craft"]);
    const hints = ids(r["hints"]);
    const moreIdentity = ids(more["identity"] ?? []);
    const moreCraft = ids(more["craft"] ?? []);
    const budget = num(r["budget"]);
    const hash = r["hash"];
    if (typeof hash !== "string" || hash.length === 0) return null;
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
      more: { identity: moreIdentity, craft: moreCraft },
    };
  } catch {
    return null;
  }
}

/**
 * WHAT A SESSION START HANDS `Self#assemble` (2026-10-10): what the turn-end
 * render was handed, read again for the moment the session starts — the
 * arriving items and the Yesterday line for the session's own date — plus the
 * "Today, elsewhere" line, and the host's ceiling now. The room is the
 * published one (`WakeShown`).
 */
export interface AssembleRequest
  extends Pick<
    BriefingRequest,
    "day" | "yesterday" | "yesterdayShorter" | "elsewhere" | "elsewhereShorter"
  > {
  readonly ceilingBytes: number;
  /** The hash of the bundle published now (`hashText`): a record written
   *  beside another bundle is not this one's. */
  readonly publishedHash: string;
  readonly horizon?: readonly HorizonItem[];
  readonly horizonMore?: readonly string[];
}

/**
 * The honest bootstrap line, and the ONLY case that may be shown in place of a
 * bundle: no bundle has ever been published. A present-but-damaged bundle is an
 * error with its own reason — never this line.
 */
export const BOOTSTRAP = "No briefing has been composed yet — this store has not lived a boundary.";

export interface SelfOptions {
  store: Store;
  tunables?: Partial<SelfTunables>;
  /** Episode ingestion runs the ordinary gate battery. Absent means REFUSE. */
  gate?: EpisodeGate;
  onEvent?: (e: SelfEvent) => void;
  /** Told about each memory an episode ingestion mints, so the composition can
   *  credit the cards it names (schemas NOTES §15). */
  onMemoryMinted?: (m: { id: string; title: string | null; body: string; day: number }) => void;
  /**
   * `associate.retargetOnSupersede`, so a regrown copy inherits the links its
   * archived copy had learned (2026-10-09) — the same callback `schemas/` and
   * `dream/` are handed, injected because `self/` may not import `associate/`.
   * Absent: the new copy starts with no links (the behaviour before).
   */
  retarget?: (oldId: string, newId: string, day: number) => void;
  now?: () => number;
  /**
   * The IANA zone the CALENDAR day is taken in — the ask cap's day and the page
   * writer's night (`core/time.ts`). Absent: the STORE's zone (`Store#zone`: the
   * config's `timeZone`, else the machine's), so the day a chapter is headed
   * with and the `learned_on` its rows carry are one calendar (2026-09-25). A
   * test pins it so it passes on any machine.
   */
  zone?: string;
}

/** An arriving occasion. `prospective/` owns the ordering (INTERFACE-GAPS #3). */
export interface HorizonItem {
  readonly id: string;
  /**
   * The date the occasion is due, as `prospective/` stated it (`Arrival
   * .eventDate`), so the "Arriving:" line says when as well as when it was
   * learned (2026-10-01). Absent: the line carries the learned date alone.
   */
  readonly due?: string;
  /**
   * How often it comes round, in words, when the date repeats (`time.ts
   * #readableRecurrence`, 2026-10-09): the line says `(due 2027-05-14, every
   * May 14)`. Absent: a date that happens once.
   */
  readonly every?: string;
  /**
   * True when `due` is already behind the day the wake is composed for — a
   * one-off in its grace days (2026-10-09). The line then says `(was due …)`.
   * The caller knows that day (`core/briefing.ts#selfRenderer`); absent: not
   * past, as far as the caller said.
   */
  readonly past?: boolean;
  /**
   * A PLAIN reminder due the day the wake is read (2026-10-10): its date is
   * the day the wake is composed for, or the next — the evening boundary's
   * wake is read the next morning. The person asked to be told; the caller
   * knows the day and the cue mode (`core/briefing.ts#selfRenderer`). It
   * leads the lane, no lane below it takes its room, and the self page gives
   * its borrowing back for it (`briefing.ts#ROOM_ORDER`'s `due`).
   */
  readonly plainDue?: boolean;
}

export interface BoundaryRequest extends BriefingRequest {
  /**
   * THE HOST'S REPORTED BUDGET this composition's `budgetBytes` was cut from
   * (2026-10-10), recorded with what it showed (`WAKE_SHOWN_KEY`) so a
   * session start assembles only under the same ceiling. Absent: recorded as
   * unknown, and a session start delivers the bundle as published.
   */
  readonly ceilingBytes?: number;
  readonly horizon?: readonly HorizonItem[];
  /**
   * ARRIVING ITEMS PAST THE CALLER'S COUNT, by id (review of #367,
   * 2026-10-10): `prospective/`'s `HORIZON_ITEMS` offers the lane two, and a
   * third dated item was in no wake line and no count. They join the lane's
   * overflow, so its "N more arriving" line names them for recall. The
   * owner's wake only (ignored with `omit`).
   */
  readonly horizonMore?: readonly string[];
  /** When supplied, the boundary ensures the identity core's home row exists in
   *  the shape `schemas/` indexes. Idempotent (schemas/INTERFACE-GAPS #5). */
  readonly identityCore?: IdentityCoreSpec;
  /** Override the id → statement seam (tests, replay, the dashboard). */
  readonly resolve?: Resolve;
  /**
   * Stand an active memory OUT of this composition, before any lane sees it.
   *
   * The owner's own wake never passes one — it is the owner-facing surface and
   * shows everything the store holds (`identity.ts#rankLanes`). It exists for a
   * composition that will LEAVE THE MACHINE: `Counterpart.sweepFallback` wakes
   * the crash-fallback interpreter with the self before it reads a transcript,
   * and that prompt is an egress surface, so confidential and protected rows are
   * omitted there (constitution 6; the same stand-aside `schemas/` makes for the
   * interpreter's cards, §14.1 G2). The predicate lives with the CALLER because
   * the confidentiality class is `recall/`'s to read, not this module's.
   *
   * Filtering here rather than after ranking is deliberate: an omitted row must
   * not occupy a lane slot or a byte of the budget it will never render into.
   *
   * PASSING ONE ALSO SUPPRESSES THE DAY-0 LINE (see `build`): an empty identity
   * lane means "nothing survived the filter" here, not "this store has no self",
   * and the two must not render the same sentence.
   */
  readonly omit?: (s: Scanned) => boolean;
}

export type PublishReason = "published" | "observer";

export interface BoundaryResult {
  readonly briefing: BriefingResult;
  readonly schema: SchemaBytesReport;
  readonly published: boolean;
  readonly reason: PublishReason;
  /** Content hash of the published text — telemetry that is not the text. */
  readonly hash: string;
}

export type WakeReason =
  | "delivered"
  | "absent"
  | "empty-read"
  | "sentinel-missing"
  | "sentinel-mismatch";

export interface WakeResult {
  /** What to inject. The bootstrap line ONLY when nothing was ever published. */
  readonly text: string;
  /** True when a bundle was read and its sentinel verified against its bytes. */
  readonly ok: boolean;
  readonly reason: WakeReason;
  /** Bytes of what is INJECTED — the preface included, when one was composed. */
  readonly bytes: number;
  /** The sentinel of the injected text: with a preface, the rewritten one. */
  readonly sentinel: string | null;
  /** The integrity reading of the STORED bundle, before any preface. */
  readonly reading: SentinelReading | null;
  /** The delivery-time line, or null when none was asked for or it could not
   *  be applied (a damaged bundle is never rewritten). */
  readonly preface: string | null;
}

/**
 * What the DELIVERING host knows and the stored bundle cannot: today's date.
 * Passing this object at all is the request for a delivery preface; passing
 * nothing returns the published bundle byte for byte, which is what every
 * non-delivering reader (the dashboard, a test, replay) wants.
 */
export interface WakeDelivery {
  /** Today's calendar date as the host reports it. Absent ⇒ no date is stated. */
  readonly date?: string;
}

export interface ClaimOccasion {
  /** The address the confirmation names. It may be stale; it is resolved. */
  readonly elementId: string;
  readonly source: ClaimSource;
  readonly direction: ClaimDirection;
  readonly tier?: UseTier;
  readonly day?: number;
}

export type ClaimReason = FreezeReason | "unresolved" | "observer";

export interface ClaimOutcome {
  readonly frozen: boolean;
  readonly reason: ClaimReason;
  readonly resolvedId: string | null;
  readonly kind: Kind | null;
  readonly band: Band | null;
  /** Whether physics was asked to move anything. */
  readonly reinforced: boolean;
  readonly credit: CreditOutcome | null;
  /** Strength before and after the walk. Equal is the guarantee, not an aside. */
  readonly strengthBefore: number | null;
  readonly strengthAfter: number | null;
  /** The occasion's counter after this occasion — the measurement that survives
   *  the withheld movement (§14.2 G4). */
  readonly count: number;
}

export interface ChapterAsk {
  readonly asked: boolean;
  readonly verdict: AskVerdict;
  /** The ask text, or null when no ask is due. */
  readonly ask: string | null;
  readonly chapter: number;
}

export interface ChapterAppend {
  readonly episodeId: string | null;
  readonly chapter: number;
  readonly created: boolean;
  /** True when this append OPENED the chapter (and wrote its heading). A second
   *  append inside one chapter continues it — the live-append case (§13 G2). */
  readonly heading: boolean;
  readonly reason: "appended" | "observer" | "anonymous-session" | "gate-refused";
  /**
   * What happened to the markdown copy under `<store>/journal/` (F6). Null when
   * no chapter was written. A `failed` here is NEVER a failed append: the row is
   * canonical and landed before the copy was attempted.
   */
  readonly copy: JournalCopyOutcome | null;
}

/**
 * Why a page write did not land. Every one of them is named to the caller.
 *
 * `version-moved` is the optimistic check (adversarial review M4): a caller that
 * passes the version it READ is told when somebody else has written since, and
 * is handed the current page so it can merge rather than revert. A caller that
 * passes nothing behaves exactly as before — it is a courtesy between writers,
 * not a lock, which is what keeps it inside the owner's "no safeguards up front".
 */
export type PageRefusal =
  | "empty"
  | "too-large"
  | "gate-refused"
  | "version-moved"
  | "no-page"
  | "page-appeared"
  | "forged-markers"
  | "no-such-version"
  // A short version added on its own (`addPageShort`, 2026-10-10): not
  // needed — the page is within its room — or not kept by its gates.
  | "short-not-needed"
  | "short-refused";

/**
 * The `ifVersion` a caller passes to mean "I read NO PAGE". A version is a
 * non-negative integer, so -1 cannot collide with one, and the two ends of the
 * check then speak the same vocabulary: `present: false` on a read carries this
 * number, and passing it back is the claim "nothing was there when I looked".
 */
export const NO_PAGE_VERSION = -1;

/** `pageBlock`'s third answer: there IS a page and this ceiling has no room for
 *  a word about it. Distinct from `null`, which means there is none. */
export const NO_ROOM = Symbol("self-page-no-room");

export interface PageRevision {
  readonly written: boolean;
  /** `created` / `revised` / `cleared` when it landed; the refusal's own name
   *  when it did not, with `observer` for a stood-down instrument. */
  readonly reason: "created" | "revised" | "cleared" | PageRefusal | "observer";
  readonly id: string | null;
  /** The version this write produced — 0 for a page written for the first time. */
  readonly version: number | null;
  readonly bytes: number;
  /** Which gate refused, when one did. Null on every other outcome. */
  readonly gate: { readonly gate: string; readonly reason: string } | null;
  /**
   * ACCEPTED, AND CHANGED ON THE WAY IN. The gate battery redacts before
   * anything is stored, and until the adversarial review nothing told the
   * writer: a page carrying an API key was accepted, stored redacted, and the
   * console printed "Wrote the page — 93 bytes". The owner who wrote a file from
   * his editor was not told the file had been altered, on the one row that is
   * then read aloud at the start of every session. Null when the stored text is
   * the text that was sent.
   */
  readonly redacted: { readonly gate: string; readonly bytesBefore: number } | null;
  /** On `version-moved` only: what is actually there now, so the caller can
   *  re-read and merge instead of guessing. */
  readonly current: { readonly version: number; readonly body: string } | null;
  /**
   * WRITTEN PAST ITS ROOM (2026-10-10): the room (`PAGE_ROOM_BYTES`) when the
   * page landed larger than it — kept whole, and on a day the wake cannot hold
   * it, sessions read its short version or its outline instead. Null when it
   * is within the room, or nothing was written. The caller says so, and asks
   * for a short version when none was kept.
   */
  readonly overRoom: number | null;
  /** What became of the short version sent with it; null when none was sent. */
  readonly short: PageShortOutcome | null;
}

/**
 * WHAT BECAME OF A SHORT VERSION (2026-10-10). `kept` — stored beside this
 * version of the page; `not-needed` — the page is within its room, so the
 * wake shows it whole and a short version would never be read; `too-large` —
 * past the room itself (`room`); `gate-refused` / `forged-markers` — the
 * page's own gates, applied to it. A short version that is not kept never
 * costs the page: the page is written either way.
 */
export interface PageShortOutcome {
  readonly kept: boolean;
  readonly reason: "kept" | "not-needed" | "too-large" | "gate-refused" | "forged-markers";
  /** Its bytes as stored, or as sent when it was not kept. */
  readonly bytes: number;
  /** The room it has to fit (`PAGE_ROOM_BYTES`). */
  readonly room: number;
  /** The gate's redaction, when it changed the short version on the way in. */
  readonly redacted: boolean;
}

/** Why a short version was not kept, in the words every door says it in. */
const SHORT_NOT_KEPT: Readonly<Record<Exclude<PageShortOutcome["reason"], "kept">, string>> = {
  "not-needed": "the page is within its room, so the wake shows it whole",
  "too-large": "it is past the room itself",
  "gate-refused": "the credential gate turned it away",
  "forged-markers": "it carries the wake's own markers (`<!-- counterparts:wake`)",
};

/**
 * WHAT A WRITE IS TOLD ABOUT ITS ROOM (2026-10-10), one sentence or two, the
 * same at every door — the self_page tool, the console, the reflection —
 * each passing its own way to add a short version (`howToAdd`). Null for a
 * page within its room with no short version sent. Pure.
 */
export function pageRoomNote(
  written: Pick<PageRevision, "written" | "bytes" | "overRoom" | "short">,
  room: number,
  howToAdd: string,
): string | null {
  const s = written.short;
  if (written.overRoom === null) {
    if (s === null || s.kept) return null;
    return `The short version was not kept: ${SHORT_NOT_KEPT[s.reason as Exclude<PageShortOutcome["reason"], "kept">]}.`;
  }
  const over = `The page is ${String(written.bytes)} bytes, past its ${String(room)}-byte room. It is kept whole`;
  if (s !== null && s.kept) {
    return `${over}, and on a day the wake has no room for it, sessions read the short version (${String(s.bytes)} bytes) instead, marked as such.`;
  }
  const outline = "on a day the wake has no room for it, sessions read only each section's heading and first sentence";
  if (s === null) return `${over}, but ${outline}. Add a short version under ${String(room)} bytes — the whole of it, condensed: ${howToAdd}.`;
  return `${over}, but the short version was not kept (${String(s.bytes)} bytes: ${SHORT_NOT_KEPT[s.reason as Exclude<PageShortOutcome["reason"], "kept">]}), so ${outline}. Send one under ${String(room)} bytes: ${howToAdd}.`;
}

/** The structural markers a page body may not carry (adversarial review m3). */
export const WAKE_MARKER = "<!-- counterparts:wake";

export interface PageWriteOptions {
  /** One line saying what changed, kept with the version this write produces. */
  readonly reason: string;
  /** Which DOOR this came through. Not claimable from outside the adapter. */
  readonly by: SelfPageAuthor;
  /** WHICH SESSION, when the door knows one. Null/absent is recorded as null —
   *  the log says "unknown", never a guess. */
  readonly session?: string | null;
  /**
   * The version the caller believes it is amending. When it does not match, the
   * write is refused as `version-moved` and the answer carries what is actually
   * there. Omit it and the write behaves exactly as it always has.
   */
  readonly ifVersion?: number;
  readonly day?: number;
  /**
   * The model writing the page, from host state (schema v7's `memories.model`;
   * the prior version keeps the model that wrote IT). The MCP door reads it off
   * the session registry record; the owner's console and a door with no named
   * model leave it out, and the row records NULL.
   */
  readonly model?: string;
  /**
   * A SHORT VERSION of this page, written with it (2026-10-10): kept only when
   * the page is past its room (`PAGE_ROOM_BYTES`) and the short version is
   * within it, after the same gates the page passes. The wake shows it on a
   * day the page does not fit whole, and only while this exact text stands.
   */
  readonly short?: string;
}

export interface PageVersion {
  readonly seq: number;
  readonly day: number;
  readonly body: string | null;
  readonly bytes: number | null;
  /** The reason the write that PRODUCED this body gave. Null when no durable
   *  row survives for it. */
  readonly reason: string | null;
  /** Which door produced it, same provenance. Null when unrecorded. */
  readonly by: string | null;
  /** What `store.revise` recorded: the reason the write that REPLACED it gave. */
  readonly replacedBy: string;
}

/** A text as the store will hold it — the UTF-8 round trip `store/prose.ts#bodyForStorage`
 *  makes — so a hash taken here is the hash of what lands. */
function storedAs(text: string): string {
  return new TextDecoder().decode(new TextEncoder().encode(text));
}

/** A fenced code block's opening or closing line, as `page.ts` reads one. */
const FENCE_LINE = /^\s{0,3}(?:```|~~~)/u;

/**
 * THE PAGE IN ITS OWN WORDS (review of #363): without its own "last revised"
 * lines (`stripRevisedLines`, counted in `stripped`), and without the frame
 * the wake prints around every rung — a top line, an end line, the one line
 * (`briefing.ts#isPageFrameLine`, counted in `framed`) — which a page copied
 * out of a wake carries. Outside code fences, and only the line: when it stood
 * between two blank lines, one of them goes with it. Applied where the page
 * and its short version are written and where the page is rendered, so a
 * stored page heals the next time it is written and never prints its frame
 * twice meanwhile. Pure.
 */
function ownWords(text: string): { body: string; stripped: number; framed: number } {
  const dated = stripRevisedLines(text);
  const lines = dated.body.split("\n");
  const out: string[] = [];
  let fenced = false;
  let framed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FENCE_LINE.test(line)) fenced = !fenced;
    if (fenced || !isPageFrameLine(line)) {
      out.push(line);
      continue;
    }
    framed += 1;
    const before = out[out.length - 1];
    if ((before === undefined || before.trim() === "") && (lines[i + 1] ?? "x").trim() === "") i += 1;
  }
  return framed === 0
    ? { ...dated, framed: 0 }
    : { body: out.join("\n").trim(), stripped: dated.stripped, framed };
}

/** Whole days between two `YYYY-MM-DD` dates, or null when either is unreadable. */
function daysBetween(from: string, to: string): number | null {
  // The SHAPE is checked, not only the parse: `Date.parse` accepts a great deal
  // that is not a date this store ever wrote, and a page dated by hand is
  // exactly the case this runs on.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

const EVENT_RING = 500;
/** How many `self.page.revised` rows `pageVersions` reads, newest first. */
const PAGE_REVISION_ROWS = 5000;

export class Self {
  readonly store: Store;
  readonly tunables: SelfTunables;
  /** One predicate, one definition: the store's. Never re-derived here. */
  readonly observer: boolean;

  private readonly gate: EpisodeGate;
  private readonly onEvent: ((e: SelfEvent) => void) | undefined;
  private readonly onMemoryMinted: SelfOptions["onMemoryMinted"];
  private readonly retarget: SelfOptions["retarget"];
  private readonly now: () => number;
  private readonly zone: string | undefined;
  private readonly ring: SelfEvent[] = [];
  /** Observer-only state that may never be deposited (observer-mode G3/G6). */
  private readonly volatileState = new Map<string, EpisodeState>();
  private readonly volatileCounts = new Map<string, number>();

  constructor(opts: SelfOptions) {
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

  /**
   * TODAY, AS THE PERSON LIVES IT — the calendar date in the local zone, read off
   * the store's own provenance clock (`core/time.ts`). The ask cap and the page
   * writer's schedule read THIS. Every PROVENANCE date (`revisedOn`,
   * `learnedOn`, a clearing's `on`) reads `store.today()`, which was UTC until
   * 2026-09-25 and is now the same local day in the store's zone — so the two
   * agree unless a caller pinned `zone` apart from the store's.
   */
  calendarToday(): string {
    return calendarDate(this.store.now(), this.dayZone());
  }

  /** The zone this `Self` names days in: its own when pinned, else the store's. */
  private dayZone(): string {
    return this.zone ?? this.store.zone();
  }

  // ── the briefing ─────────────────────────────────────────────────────────

  /**
   * Compose without publishing. Pure with respect to durable state: it reads,
   * ranks and composes, and writes nothing. Exposed because "render and publish
   * are separate steps" is only a real property if the render is separately
   * callable — a private half is a promise, not a seam.
   */
  build(req: BoundaryRequest): BriefingResult {
    return this.buildWithLanes(req).briefing;
  }

  /** `build`, and the ranked lanes it composed from — what the publish keeps
   *  of the stateful lanes (`WAKE_SHOWN_KEY`). */
  private buildWithLanes(req: BoundaryRequest): { briefing: BriefingResult; lanes: Lanes } {
    const all = scanActive(this.store, req.day);
    // `omit` (see the field): the owner's wake passes none and this is a no-op;
    // a composition bound for a model call outside this machine passes one.
    const scanned = req.omit === undefined ? all : all.filter((s) => !req.omit?.(s));
    // A PLAIN REMINDER DUE THE DAY THE WAKE IS READ LEADS THE LANE (2026-10-10),
    // the rest in the order supplied: the lane trims from its end, and its
    // head is what no lane below it may take (`briefing.ts#arrivingHead`).
    const supplied: Ranked[] = (req.horizon ?? []).map((h) => this.horizonRank(h, req.day));
    const horizon: Ranked[] = [...supplied.filter((r) => r.due === true), ...supplied.filter((r) => r.due !== true)];
    const lanes: Lanes = rankLanes(scanned, horizon, this.tunables, {
      settledOver: settledOver(this.store),
      coveredByPage: this.pageCovers(scanned),
      workAtDelivery: this.tunables.CRAFT_AT_DELIVERY,
      ...(req.horizonMore === undefined || req.omit !== undefined ? {} : { horizonMore: req.horizonMore }),
    });
    const docs = new Map<string, ProseDoc>();
    // Provenance rides along from the SAME scan the docs came from: the render
    // dates a migrated element as an upper bound, and a second row read per
    // element to learn that would be a scan the boundary already paid for.
    const sources = new Map<string, string | null>();
    for (const s of scanned) {
      docs.set(s.id, s.doc);
      sources.set(s.id, s.source);
    }
    return { briefing: this.composeLanes(lanes, docs, sources, req), lanes };
  }

  /**
   * THE WAKE, ASSEMBLED AT SESSION START (2026-10-10), from reads only: no
   * scan of the store, no model, no embedding, and no write — not even the
   * rotation's stamps or Nearby's showing, which stay the turn-end's (self
   * CONTRACT §5 G1). What it reads:
   *
   *   - "Still open": the open memories (`Store#openThreadIds`), each read
   *     once and ranked as the turn-end ranks them (`rankLanes`);
   *   - "Arriving:": the caller's horizon, asked for the session's own date;
   *   - the Yesterday line: the caller's, for the session's own date;
   *   - the self page: read fresh, on the rung its room allows (`pageBlock`);
   *   - "Who I am" (without a page), craft and "Nearby": the ids the
   *     published bundle showed, in its order (`WAKE_SHOWN_KEY`), less any
   *     that has since gone, become open, arriving or settled over, or — a
   *     hint — that the page now covers;
   *   - the room: the published one, so the delivery's rooms are what the
   *     turn-end sized them to.
   *
   * Then the SAME composition as the turn-end's (`composeLanes`: `render`,
   * `ROOM_ORDER`, the page's ladder), so a session start keeps every rule
   * the published bundle keeps. Null when there is nothing to assemble from
   * — no record (a bundle an older build published), another ceiling — and
   * the caller then delivers the published bundle as it is.
   */
  assemble(req: AssembleRequest): BriefingResult | null {
    const shown = wakeShown(this.store);
    if (shown === null || shown.hash !== req.publishedHash || shown.ceiling === null || shown.ceiling !== req.ceilingBytes) return null;
    const day = req.day;
    const settled = settledOver(this.store);
    const docs = new Map<string, ProseDoc>();
    const sources = new Map<string, string | null>();
    const note = (s: Scanned): Scanned => {
      docs.set(s.id, s.doc);
      sources.set(s.id, s.source);
      return s;
    };
    const bandOf = (id: string): string | null => {
      try {
        return this.store.row(id)?.band ?? null;
      } catch {
        return null;
      }
    };
    // Arriving, as the turn-end ranks it: a due-day plain reminder first, an
    // identity element left to its own lane.
    const supplied = (req.horizon ?? []).filter((h) => bandOf(h.id) !== "identity").map((h) => this.horizonRank(h, day));
    const horizon: Ranked[] = [...supplied.filter((r) => r.due === true), ...supplied.filter((r) => r.due !== true)];
    // Still open, from the open memories alone.
    const openIds = this.store.openThreadIds();
    const open: Scanned[] = [];
    for (const id of openIds) {
      const s = scanOne(this.store, id, day);
      if (s !== null && s.unresolved && s.band !== "identity") open.push(note(s));
    }
    const fresh = rankLanes(open, horizon, this.tunables, {
      settledOver: settled,
      workAtDelivery: this.tunables.CRAFT_AT_DELIVERY,
      ...(req.horizonMore === undefined ? {} : { horizonMore: req.horizonMore }),
    });
    // The stateful lanes, as the published bundle showed them.
    const opened = new Set(openIds);
    const arriving = new Set(fresh.horizon.map((r) => r.id));
    const carried = (ids: readonly string[], lane: "identity" | "craft" | "hints"): Scanned[] => {
      const out: Scanned[] = [];
      for (const id of ids) {
        if (lane !== "identity" && (opened.has(id) || arriving.has(id) || settled.has(id))) continue;
        const s = scanOne(this.store, id, day);
        if (s === null || s.doc.body.trim().length === 0) continue;
        if ((lane === "identity") !== (s.band === "identity")) continue;
        out.push(s);
      }
      return out;
    };
    const hintsScanned = carried(shown.hints, "hints");
    const covered = hintsScanned.length === 0 ? new Set<string>() : this.pageCovers(hintsScanned);
    const lanes: Lanes = {
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
        horizon: fresh.overflow?.horizon ?? [],
      },
    };
    return this.composeLanes(lanes, docs, sources, {
      day,
      budgetBytes: shown.budget,
      ...(req.horizon === undefined ? {} : { horizon: req.horizon }),
      ...(req.yesterday === undefined ? {} : { yesterday: req.yesterday }),
      ...(req.yesterdayShorter === undefined ? {} : { yesterdayShorter: req.yesterdayShorter }),
      ...(req.elsewhere === undefined ? {} : { elsewhere: req.elsewhere }),
      ...(req.elsewhereShorter === undefined ? {} : { elsewhereShorter: req.elsewhereShorter }),
      ...(shown.lend > 0 ? { lendBytes: shown.lend } : {}),
      ...(shown.handoffLend > 0 ? { handoffLendBytes: shown.handoffLend } : {}),
      ...(shown.handoffKeep > 0 ? { handoffKeepBytes: shown.handoffKeep } : {}),
    });
  }

  /**
   * RANKED LANES TO A BRIEFING — the half of `build` after the scan, shared
   * with `assemble` (2026-10-10) so the two compose by one set of rules: the
   * page's ladder and its borrowing, `render` and `ROOM_ORDER`, and the page
   * giving its borrowing back to a due-day plain reminder. Pure: it reads the
   * page and, for a memory not in `docs`, its prose; it writes nothing.
   */
  private composeLanes(
    lanes: Lanes,
    docs: Map<string, ProseDoc>,
    sources: Map<string, string | null>,
    req: BoundaryRequest,
  ): BriefingResult {
    const base: Resolve = req.resolve ?? ((id) => this.resolveStatement(id, docs, sources));
    // An arriving occasion's due date, beside its learned one (2026-10-01).
    // A repeating one says how often, beside it (2026-10-09).
    // One already behind the day the wake is composed for says it WAS due
    // (2026-10-09).
    const dues = new Map<string, { due: string; every?: string; duePast?: boolean }>();
    for (const h of req.horizon ?? []) {
      if (h.due === undefined || h.due.trim() === "") continue;
      const every = h.every?.trim() ?? "";
      dues.set(h.id, {
        due: h.due.trim(),
        ...(every === "" ? {} : { every }),
        ...(h.past === true ? { duePast: true } : {}),
      });
    }
    const resolve: Resolve =
      dues.size === 0
        ? base
        : (id) => {
            const r = base(id);
            const due = dues.get(id);
            return due === undefined ? r : { ...r, ...due };
          };
    // THE DAY-0 LANE (NOTES §11). The lookup is guarded by the empty lane and by
    // nothing else: it reads prose, and a store with even one identity element
    // must not pay for it — nor render the line. On a store that has lived
    // boundaries this branch is unreachable, which is also why the change cannot
    // move a byte of the owner's wake.
    //
    // AND BY `omit` (2026-09-17 review). A composition that passes `omit` is by
    // definition not owner-facing, and the identity lane it sees is the
    // POST-OMIT one: a store whose identity band is entirely protected or
    // confidential would otherwise unlock this line and tell a model call — one
    // being asked to write in the first person AS this self — that no identity
    // has formed here. It would also render the core's NAME, which `omit` never
    // saw: the core is a `type: "schema"` row and `scanActive` lists
    // `type: "memory"`. Both by one clause: no day-0 line on a composition that
    // filters.
    const coreName =
      req.omit === undefined && lanes.identity.length === 0 ? identityCoreName(this.store) : null;
    // THE PAGE, cut here rather than in the renderer: the cap is a byte decision
    // that needs the caller's budget AND the page's own prose, and `briefing.ts`
    // composes rather than reads.
    //
    // **DOES IT GO OUT?** A composition that passes `omit` is by definition one
    // that will leave the machine, and the page is born `protected` — the very
    // predicate `sweepFallback` filters on. That flag is the PRUNE's vocabulary
    // and does not decide egress by itself, but the question is too close to it
    // to be answered by an accident, so it is answered by a switch:
    // `PAGE_ON_EGRESS`, default true, the owner's decision of 2026-09-17 (spec
    // §15 item 3). Turn it off and a filtering composition gets no page and
    // falls back to the identity list `omit` left standing, which is what that
    // composition carried before the page existed.
    //
    // **THE PAGE IS NOT CUT FOR THE LANES BESIDE IT** (review of #350,
    // 2026-10-09): it is the self the wake exists to carry, so a page under
    // its cap prints whole. When "Still open" would list nothing beside it,
    // the room for its first item comes out of the other lanes, in the
    // renderer (`briefing.ts#keepFirstOpen`).
    //
    // **AND IT BORROWS BEFORE IT STEPS DOWN** (review of #358, 2026-10-09; a
    // ladder since 2026-10-10, `pageBlock`): a rung that does not fit this
    // composition takes the room the delivery holds for "Work here"
    // (`lendBytes`, the owner's wake only) before the page steps down to the
    // next rung. It takes only what it needs, so a page a few bytes over its
    // room costs "Work here" a few bytes; what is left of the lend is still
    // "Still open"'s.
    const lend = req.lendBytes === undefined || req.omit !== undefined ? 0 : Math.max(0, Math.floor(req.lendBytes));
    const choose = (below?: PageRung): { block: PageBlock | typeof NO_ROOM | null; took: number } =>
      req.omit !== undefined && !this.tunables.PAGE_ON_EGRESS
        ? { block: null, took: 0 }
        : this.pageBlock(req.budgetBytes, lend, below);
    const renderWith = (choice: { block: PageBlock | typeof NO_ROOM | null; took: number }): BriefingResult => {
      const { block, took } = choice;
      // A page that will not FIT is not a page that does not EXIST: the
      // renderer is told `pageExists` so the still-forming line stays off a
      // store that has one, whatever the ceiling did (MINOR-D).
      const page = block === NO_ROOM ? null : block;
      const pageExists = block !== null;
      return render(
        lanes,
        {
          // What the page borrowed is composed into, and is no longer lent.
          budgetBytes: req.budgetBytes + took,
          pageExists,
          day: req.day,
          ...(coreName === null ? {} : { coreName }),
          ...(page === null ? {} : { page }),
          // The "Yesterday" line (2026-10-01): the owner's wake only — a
          // composition that filters (`omit`) is bound elsewhere. Its shorter
          // forms ride beside it (review of #350).
          ...(req.yesterday === undefined || req.omit !== undefined ? {} : { yesterday: req.yesterday }),
          ...(req.yesterdayShorter === undefined || req.yesterday === undefined || req.omit !== undefined
            ? {}
            : { yesterdayShorter: req.yesterdayShorter }),
          // The delivery's rooms, lent to the lanes above them in
          // `ROOM_ORDER` (review of #350; 2026-10-10): the owner's wake only,
          // which is the one delivered with work lines and handoffs.
          ...(req.lendBytes === undefined || req.omit !== undefined ? {} : { lendBytes: lend - took }),
          ...(req.handoffLendBytes === undefined || req.omit !== undefined
            ? {}
            : { handoffLendBytes: Math.max(0, Math.floor(req.handoffLendBytes)) }),
          // And the room kept for the newest handoff's own block: a due-day
          // plain reminder's alone (`ROOM_ORDER`'s `handoffsKept`).
          ...(req.handoffKeepBytes === undefined || req.omit !== undefined
            ? {}
            : { handoffKeepBytes: Math.max(0, Math.floor(req.handoffKeepBytes)) }),
          // "Today, elsewhere" (2026-10-10): asked for at session start only.
          ...(req.elsewhere === undefined || req.omit !== undefined ? {} : { elsewhere: req.elsewhere }),
          ...(req.elsewhereShorter === undefined || req.elsewhere === undefined || req.omit !== undefined
            ? {}
            : { elsewhereShorter: req.elsewhereShorter }),
        },
        resolve,
        this.tunables,
      );
    };
    const chosen = choose();
    const out = renderWith(chosen);
    // THE PAGE GIVES ITS BORROWING BACK TO A PLAIN REMINDER DUE THE DAY THE
    // WAKE IS READ (2026-10-10, `briefing.ts#ROOM_ORDER`'s `due` above
    // `pageBorrow`): when one is not listed and the page borrowed "Work here"
    // to print on its rung, the page steps down its ladder — whole texts, the
    // rung below and the next — until the reminder is listed, and no further
    // than the first rung that borrows nothing. The page within its own room
    // outranks it, so when even that does not list it, the wake stays as it
    // was composed, and doctor says so (`self.briefing`'s `trimmedLanes`).
    // Not for the "Today, elsewhere" line (review of #380): the page and its
    // borrowing outrank it, so the line takes its room in the render, from
    // the lanes below it.
    const due = lanes.horizon.filter((r) => r.due === true).map((r) => r.id);
    const unlisted = (o: BriefingResult): boolean => due.some((id) => !o.kept.horizon.includes(id));
    let current = chosen;
    while (due.length > 0 && current.took > 0 && unlisted(out) && current.block !== null && current.block !== NO_ROOM) {
      const next = choose(current.block.rung);
      if (next.block === null || next.block === NO_ROOM) break;
      const stepped = renderWith(next);
      if (!unlisted(stepped)) return stepped;
      current = next;
    }
    return out;
  }

  /**
   * The memories the self page already carries, for the Nearby lane to leave
   * out (`covered.ts`): the ones the reflection that wrote it cited, and the
   * ones whose words one paragraph of it holds. Empty with no page; never
   * throws — a page that will not read covers nothing.
   */
  private pageCovers(scanned: readonly Scanned[]): Set<string> {
    try {
      const page = this.page();
      if (page === null) return new Set();
      const cited = new Set<string>();
      const ref = /\breflection (rfl_[0-9a-f]+)/.exec(page.reason ?? "")?.[1];
      if (page.by === "reflection" && ref !== undefined) {
        const raw: unknown = JSON.parse(this.store.reflection(ref)?.cites ?? "[]");
        if (Array.isArray(raw)) for (const id of raw) if (typeof id === "string") cited.add(id);
      }
      return coveredByPage(page.body, scanned, cited);
    } catch {
      return new Set();
    }
  }

  // ── the self page ────────────────────────────────────────────────────────

  /**
   * THE PAGE, READ. Null when none has been written — never a fabricated one:
   * a store with nothing to say says so (contract §3, and the day-0 lane's own
   * reasoning). Pure: no write, no event.
   */
  page(): SelfPage | null {
    return readSelfPage(this.store);
  }

  /**
   * Has the page gone unrevised longer than the tunable allows? CALENDAR days,
   * against the store's own clock — the lived clock has run seven days across
   * fifteen calendar ones on the owner's store, so a lived window would report a
   * fortnight of silence as three days.
   */
  pageStale(page: SelfPage | null = this.page()): boolean {
    if (page === null) return false;
    // NO READABLE DATE READS AS STALE. A page whose `revisedOn` is blank or
    // unparseable — only reachable on a hand-minted or hand-edited row — used to
    // read as FRESH, which is the direction that says nothing is wrong about a
    // row nobody can date (adversarial review m6). `pageDateline` says the same
    // thing in words rather than printing nothing.
    const days = daysBetween(page.revisedOn.trim(), this.store.today());
    return days === null ? true : days > this.tunables.PAGE_STALE_DAYS;
  }

  /**
   * How many earlier states the page has — WITHOUT reading a single one of them
   * off disk.
   *
   * Three surfaces wanted only this number and were getting it from
   * `pageVersions().length`, which reads every archived body: on a page revised
   * nightly for a quarter that is ninety file reads of up to 16 KB to print one
   * digit, on every `self_page` read a session makes (adversarial review m9).
   */
  pageVersionCount(): number {
    const id = this.pageRowId();
    return id === null ? 0 : this.store.versions(id).length;
  }

  /**
   * Every earlier state of the page, newest first.
   *
   * **Each body carries the reason and the author of the write that PRODUCED
   * it**, not of the write that replaced it. `store.revise` stores the
   * REPLACING write's reason on the row it archives, so reading `VersionRow.reason`
   * straight through labelled version 1 — the first page — with the second
   * write's words, while the CURRENT page's own `Last change:` line reads the
   * row's meta and is right. Two surfaces using the same word for opposite
   * things is worse than one surface with no word (adversarial review M3). The
   * durable `self.page.revised` rows carry what is wanted: the write that
   * produced version `seq` is the one whose row says `version: seq - 1`, because
   * a revision archives the body that was standing and numbers it with the
   * revision it is making. `replacedBy` keeps the store's own value, named for
   * what it actually is.
   *
   * `bodies: false` skips the per-version file read.
   */
  pageVersions(opts: { bodies?: boolean } = {}): PageVersion[] {
    const id = this.pageRowId();
    if (id === null) return [];
    const wrote = new Map<number, { reason: string | null; by: string | null }>();
    try {
      // Newest first, with a named ceiling, and the newest row for a version
      // wins: the ascending read with the default 500 was the OLDEST rows, so
      // past it the newest versions — the ones anyone opens — read as
      // unattributed. Versions are kept for a window of lived days, so the
      // ceiling is far past what one page's revisions reach.
      for (const row of this.store.eventLog({ name: SELF_PAGE_REVISED_EVENT, ref: id, order: "desc", limit: PAGE_REVISION_ROWS })) {
        const payload = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
        const v = payload["version"];
        if (typeof v !== "number" || wrote.has(v)) continue;
        wrote.set(v, {
          reason: typeof payload["reason"] === "string" ? payload["reason"] : null,
          by: typeof payload["by"] === "string" ? payload["by"] : null,
        });
      }
    } catch {
      /* a log that will not read leaves every version unattributed, not wrong */
    }
    return this.store
      .versions(id)
      .slice()
      .sort((a, b) => b.seq - a.seq)
      .map((v) => {
        let body: string | null = null;
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
          replacedBy: v.reason,
        };
      });
  }

  /**
   * PUT A VERSION BACK, in one command. It is an ordinary revision whose body is
   * that version's, so the restore is itself versioned and itself undoable — the
   * owner never has to hand-edit a file out of `--version <seq>`'s output, which
   * is what he had to do before (the output opens with a header line, so the
   * obvious redirect wrote the header into the page).
   */
  restorePage(seq: number, opts: { reason?: string; day?: number } = {}): PageRevision {
    const id = this.pageRowId();
    const none = {
      id: null,
      version: null,
      bytes: 0,
      gate: null,
      redacted: null,
      current: null,
      overRoom: null,
      short: null,
    } as const;
    // Two different absences, named apart: no page has ever been written here,
    // and there is no version by that number. A caller reaching this seam
    // directly (S2) gets the one that is true.
    if (id === null) return { ...none, written: false, reason: "empty" };
    let body: string;
    let short: string | null = null;
    try {
      const doc = this.store.readVersion(id, seq);
      body = doc.body;
      // ITS SHORT VERSION COMES BACK WITH IT (2026-10-10), when that version
      // kept one written with its own text.
      short = shortOf(doc.meta, doc.body)?.body ?? null;
    } catch {
      return { ...none, written: false, reason: "no-such-version" };
    }
    return this.revisePage(body, {
      reason: opts.reason ?? `restored version ${seq}`,
      by: "owner",
      ...(opts.day === undefined ? {} : { day: opts.day }),
      ...(short === null ? {} : { short }),
    });
  }

  /**
   * ADD A SHORT VERSION to the page as it stands (2026-10-10) — for a writer
   * told its page landed past its room with none kept. It is an ordinary
   * revision of the same text with the short version beside it, so it is
   * versioned like every other write and the history says so. `ifVersion`, as
   * on any write, refuses it when the page moved since the caller read it.
   * Refused with nothing written when there is no page, when the page is
   * within its room (`not-needed`: the wake shows it whole), or when the short
   * version itself is not kept — a version that changed nothing is not
   * written.
   */
  addPageShort(short: string, opts: Omit<PageWriteOptions, "short" | "reason"> & { reason?: string }): PageRevision {
    const page = this.page();
    const none = {
      id: null,
      version: null,
      gate: null,
      redacted: null,
      current: null,
      overRoom: null,
    } as const;
    if (this.observer) {
      this.emit("self.observer.standdown", undefined, { site: "addPageShort" });
      return { ...none, written: false, reason: "observer", bytes: 0, short: null };
    }
    // Every refusal leaves its durable row, as `revisePage`'s do: there is no
    // silent no-op on the page's path.
    const refuse = (reason: PageRefusal, detail: Record<string, string | number | boolean>): void => {
      this.emit("self.page.refused", undefined, { reason, by: opts.by, ...detail });
      try {
        this.store.appendEvent({
          name: SELF_PAGE_REFUSED_EVENT,
          day: opts.day ?? this.store.livedDay(),
          payload: { reason, by: opts.by, session: opts.session ?? null, ...detail },
        });
      } catch {
        /* a refusal that cannot be recorded is still a refusal (§5 G7) */
      }
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
        short: verdict.outcome,
      };
    }
    // A REVISION OF THE PAGE AS IT WAS READ (review of #363): held to that
    // version even when the caller passed none, so a page another process
    // wrote since is refused (`version-moved`), never reverted to this one.
    return this.revisePage(page.body, {
      ...opts,
      ifVersion: opts.ifVersion ?? page.version,
      reason: opts.reason ?? "added a short version",
      short,
    });
  }

  /**
   * THE SHORT VERSION'S GATES (2026-10-10): the page's own, in its order —
   * its datelines left out, no wake markers, the credential battery (whose
   * redaction it takes), and the room, measured after the redaction. Kept
   * only when the page it goes with is past that room. Pure but for the gate.
   */
  private shortVerdict(
    raw: string,
    pageBytes: number,
    by: SelfPageAuthor,
  ): { outcome: PageShortOutcome; text: string | null } {
    const room = this.tunables.PAGE_ROOM_BYTES;
    const draft = ownWords(raw.replace(/\r\n/g, "\n").trim()).body;
    const sent = byteLength(draft);
    const out = (reason: PageShortOutcome["reason"], bytes = sent, redacted = false): { outcome: PageShortOutcome; text: null } => ({
      outcome: { kept: false, reason, bytes, room, redacted },
      text: null,
    });
    if (pageBytes <= room) return out("not-needed");
    if (draft.includes(WAKE_MARKER)) return out("forged-markers");
    if (sent > room) return out("too-large");
    const verdict = this.gate({ text: draft, handles: [], sessionId: `page-short:${by}` });
    if (!verdict.ok) return out("gate-refused");
    const text = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : draft;
    const bytes = byteLength(text);
    if (bytes > room) return out("too-large", bytes, text !== draft);
    return { outcome: { kept: true, reason: "kept", bytes, room, redacted: text !== draft }, text };
  }

  /**
   * The page's row id INCLUDING a cleared one, for the surfaces that read its
   * history. `findSelfPage` lists live rows only — which is what makes a cleared
   * page read as no page — so the version log needs its own lookup.
   */
  private pageRowId(): string | null {
    // ONE ROW, cleared or not — so the history is found by the same lookup that
    // finds the page, and nothing here depends on the event log. The first
    // design archived a cleared page and found it again through its
    // `self.page.revised` row; the second review proved that sleep prunes those
    // at 90 lived days and that the fallback scan then picked the WRONG cleared
    // page, whose body `--restore` would have written as the live one. That
    // whole class of question is gone with the row.
    return findPageRow(this.store);
  }

  /**
   * THE ONE SEAM that writes the page — the MCP tool, the owner's console and
   * (later) the nightly writer all arrive here, so there is one place the row
   * shape, the caps and the durable row are decided.
   *
   * Refusals are NAMED and DURABLE (owner ruling 2's corollary, 2026-09-18: a
   * cap reports what it refused where the owner will see it). There is no silent
   * no-op on this path: every call returns a reason and, unless the store itself
   * is refusing writes, leaves a row saying which it was.
   *
   * `by` is the caller's and is not claimable from the outside by anything but
   * the adapter that opened this seam — the MCP tool writes `session`, the
   * console writes `owner`, and `writer` is S2's.
   */
  revisePage(body: string, opts: PageWriteOptions): PageRevision {
    const day = opts.day ?? this.store.livedDay();
    // THE PAGE'S OWN "LAST REVISED" LINE IS LEFT OUT (2026-10-09), before the
    // caps and the gate see it: the wake dates the page, and a stored page that
    // carried one printed two. The revision row counts what went
    // (`datelines`), so a hand-written page edited here says so.
    const own = ownWords(body.replace(/\r\n/g, "\n").trim());
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
      short: null,
    } as const;
    const refuse = (
      reason: PageRefusal,
      detail: Record<string, string | number | boolean>,
      extra: Partial<PageRevision> = {},
    ): PageRevision => {
      this.emit("self.page.refused", undefined, { reason, by: opts.by, ...detail });
      try {
        this.store.appendEvent({
          name: SELF_PAGE_REFUSED_EVENT,
          day,
          // WHICH SESSION, when the door knows one. Null is written rather than
          // a guess: "a session" is what the log said before, and with five or
          // more running at once that answers nothing.
          payload: { reason, by: opts.by, session, ...detail },
        });
      } catch {
        /* a refusal that cannot be recorded is still a refusal (§5 G7) */
      }
      return { ...none, written: false, reason, bytes, ...extra };
    };

    if (this.observer) {
      // The stand-down comes FIRST and writes nothing at all, the durable row
      // included: an instrument that logged its own refusal would be changing
      // the store it is reading (observer-mode G3).
      this.emit("self.observer.standdown", undefined, { site: "revisePage" });
      return { ...none, written: false, reason: "observer", bytes };
    }
    if (draft.length === 0) return refuse("empty", { bytes: 0 });
    // THE CEILING, NOT THE ROOM (2026-10-10). `PAGE_MAX_BYTES` is the sanity
    // ceiling (16,384); the room the wake guarantees (`PAGE_ROOM_BYTES`) is a
    // target the writer is told, and a page past it is KEPT — #358 refused it,
    // a stopgap the page's history kept losing to by a few hundred bytes. On a
    // day the wake cannot hold it whole, the wake steps down a ladder of whole
    // texts (`pageBlock`). In BYTES, as the wake counts them.
    const limit = this.tunables.PAGE_MAX_BYTES;
    const room = this.tunables.PAGE_ROOM_BYTES;
    if (bytes > limit) {
      // Refused, never cut: what gets cut at write time is the only copy.
      return refuse("too-large", { bytes, limit });
    }
    // NO FORGED WAKE STRUCTURE. The page is injected verbatim and FIRST inside
    // the bundle, so a body carrying the wake's own comment markers puts an
    // end-of-memory marker in front of four real lanes for the model reading it,
    // and gives the dashboard's lane splitter a lane the store has no rows for.
    // Nothing downstream breaks — `readSentinel` reads the last line only and
    // the delivery check is already hardened — but the READING is the thing the
    // markers exist for (adversarial review m3). Only the structural markers:
    // the page is meant to carry the session's own prose, headings and all.
    if (draft.includes(WAKE_MARKER)) return refuse("forged-markers", { bytes });
    // THE OPTIMISTIC CHECK, and only when the caller asked for one (M4). Two
    // sessions that both read at 09:00 and both write at 17:00 otherwise leave
    // the second one's page standing and tell the first `stored: true`: not data
    // loss, since every lost body is a version, but silent reversion of a page
    // every session reads, which is the same felt outcome and harder to notice.
    const before = readSelfPage(this.store);
    if (opts.ifVersion !== undefined) {
      // "I READ NO PAGE" HAS A VALUE, and it is `NO_PAGE_VERSION` (-1). With no
      // page, `version` is not a number at all, so every integer mismatched and
      // the first write a careful session made — one that read `present: false`
      // and passed the natural 0 back, as the description tells it to — was
      // refused with a sentence saying somebody else had written the page. That
      // was untrue, and there was nothing handed back to merge against
      // (adversarial review MINOR-C). `no-page` and `page-appeared` name the two
      // directions apart from a genuine race.
      const at = before?.version ?? NO_PAGE_VERSION;
      if (at !== opts.ifVersion) {
        const reason: PageRefusal =
          before === null ? "no-page" : opts.ifVersion === NO_PAGE_VERSION ? "page-appeared" : "version-moved";
        return refuse(
          reason,
          { bytes, expected: opts.ifVersion, at },
          {
            current:
              before === null ? null : { version: before.version, body: before.body },
          },
        );
      }
    }
    // THE BATTERY, on the page as on the journal (SEAMS H). The page is prose
    // that will be injected into every session from here on, so a credential
    // written into it would be the most durable place on the machine to leave
    // one. `NO_GATE`'s refusal is the behaviour of a door nobody wired a battery
    // into, and it is loud rather than open.
    const verdict = this.gate({ text: draft, handles: [], sessionId: `page:${opts.by}` });
    if (!verdict.ok) {
      return refuse(
        "gate-refused",
        { bytes, gate: verdict.gate, gateReason: verdict.reason },
        { gate: { gate: verdict.gate, reason: verdict.reason } },
      );
    }
    // The GATE's text, never the draft: the battery may have redacted it.
    const text = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : draft;
    // ...and the writer is TOLD when that happened (m1).
    // An ACCEPTING verdict carries no gate name — the battery redacts in the
    // secrets gate and says so only when it refuses — so the class is named
    // here, which is the one the redaction can have come from.
    const redacted = text === draft ? null : { gate: "secrets", bytesBefore: bytes };
    bytes = byteLength(text);
    // ...and measured AGAIN after it (2026-10-09): `[REDACTED:family]` can be
    // longer than what it replaced, so a page at the ceiling could land over it.
    if (bytes > limit) return refuse("too-large", { bytes, limit, redacted: true });

    // THE SHORT VERSION, through the page's own gates (2026-10-10), and kept
    // only when this page is past its room — after the redaction, as the wake
    // will measure it. One that is not kept never costs the page.
    const sent = opts.short === undefined || opts.short.trim().length === 0 ? null : this.shortVerdict(opts.short, bytes, opts.by);

    // THE PAGE'S ROW, cleared or not: a write after a clear revives the SAME row
    // and its whole version chain rather than minting a fresh one beside it.
    // `store.revise` merges meta, so the cleared flag is dropped explicitly —
    // and so is a short version this write did not bring: one written with
    // the text before is not a short version of this one (`PAGE_META_SHORT`).
    const existing = findPageRow(this.store);
    const meta: Record<string, unknown> = {
      role: SELF_PAGE_ROLE,
      [PAGE_META_BY]: opts.by,
      [PAGE_META_REASON]: opts.reason,
      [PAGE_META_REVISED_ON]: this.store.today(),
      [PAGE_META_REVISED_DAY]: day,
      [PAGE_META_CLEARED]: null,
      [PAGE_META_SHORT]: sent === null || sent.text === null ? null : { body: sent.text, of: hashText(storedAs(text)), bytes },
    };
    let id: string;
    let version: number;
    if (existing === null) {
      id = this.store.put({
        type: "schema",
        kind: "self",
        title: PAGE_TITLE,
        body: text,
        meta,
        learnedOn: this.store.today(),
        ...(opts.model === undefined ? {} : { model: opts.model }),
        // PROTECTED AT BIRTH — the one flag that keeps the floor prune off it
        // (`physics#pruneVerdict` blocks on it by name). It is not a
        // confidentiality class and it buys no exemption anywhere else.
        physics: { protected: true },
      });
      version = 0;
    } else {
      id = existing;
      version = this.store.revise(id, {
        body: text,
        title: PAGE_TITLE,
        meta,
        reason: opts.reason,
        ...(opts.model === undefined ? {} : { model: opts.model }),
      });
      // A page written before this flag existed — or one whose row was minted by
      // hand — is put beyond the prune here rather than at some later repair.
      if (this.store.row(id)?.protected !== 1) this.store.updatePhysics(id, { protected: true });
    }
    this.store.appendEvent({
      name: SELF_PAGE_REVISED_EVENT,
      day,
      ref: id,
      payload: {
        by: opts.by,
        // WHICH SESSION WROTE IT, when the door knows one — `by` says which DOOR
        // and cannot be forged, but with five or more sessions running at once
        // "a session" answers nothing. Null when the door has no id; never a
        // guess (adversarial review M3).
        session,
        reason: opts.reason,
        bytes,
        // What the gate took out on the way in, so the log carries the fact the
        // caller was told (m1).
        ...(redacted === null ? {} : { redacted: true, redactedBy: redacted.gate }),
        version,
        created: existing === null,
        limit,
        // The room it was written against, and what became of a short
        // version sent with it (2026-10-10).
        room,
        ...(sent === null ? {} : { short: sent.outcome.reason, shortBytes: sent.outcome.bytes }),
        ...(own.stripped === 0 ? {} : { datelines: own.stripped }),
        ...(own.framed === 0 ? {} : { frameLines: own.framed }),
      },
    });
    this.emit("self.page.revised", id, {
      by: opts.by,
      bytes,
      version,
      created: existing === null,
      overRoom: bytes > room,
      short: sent?.outcome.reason ?? null,
    });
    // The wake leads with this page, so it is now behind (`behind.ts`): the
    // next process with a budget re-renders rather than the next lived day.
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
      short: sent?.outcome ?? null,
    };
  }

  // ── the nightly page writer (S2) ───────────────────────────────────────────

  /**
   * IS A RUN OWED for the day just gone? Pure — it decides, it does not claim.
   *
   * The caller that acts on `due: true` writes the claim with
   * `recordPageWriterRun({ outcome: "asked" | "started" })`, and from then on
   * this says `already-claimed`.
   */
  pageWriterDue(opts: { mode: PageWriterMode; today?: string }): PageWriterDue {
    // The night is ours to decide unless the caller named a day: the LOCAL
    // calendar, held back to a provenance date that has closed (`writer.ts#
    // pageWriterNight`). A caller that passes `today` gets the plain rule.
    const night = opts.today === undefined ? pageWriterNight(this.store, this.dayZone()) : null;
    return pageWriterDue(this.store, {
      mode: opts.mode,
      today: opts.today ?? (night as { today: string }).today,
      ...(night === null ? {} : { about: night.about }),
      observer: this.observer,
      asksPerDay: this.tunables.PAGE_WRITER_ASKS_PER_DAY,
    });
  }

  /**
   * WHAT THE WRITER IS HANDED: the page as it stands, and the day just gone,
   * bounded by `PAGE_WRITER_MEMORY_BYTES` and ordered by salience.
   *
   * `omit` is the CALLER's, exactly as `build`'s is and for the same reason —
   * the confidentiality class is `recall/`'s to read and not this module's. A
   * composition that will leave the machine passes one; what it hides is
   * counted onto the run's row rather than disappearing.
   *
   * Pure: it reads and composes. Nothing here writes.
   */
  pageWriterInput(opts: {
    about: string;
    today?: string;
    day?: number;
    budgetBytes?: number;
    max?: number;
    omit?: (m: { id: string; confidential: boolean; protectedRow: boolean }) => boolean;
  }): WriterInput {
    const day = opts.day ?? this.store.livedDay();
    const picked = dayMemories(this.store, {
      about: opts.about,
      day,
      budgetBytes: opts.budgetBytes ?? this.tunables.PAGE_WRITER_MEMORY_BYTES,
      max: opts.max ?? this.tunables.PAGE_WRITER_MEMORY_MAX,
      ...(opts.omit === undefined ? {} : { omit: opts.omit }),
    });
    return {
      about: opts.about,
      today: opts.today ?? this.calendarToday(),
      page: this.page(),
      memories: picked.memories,
      dropped: picked.dropped,
      omitted: picked.omitted,
      bytes: picked.bytes,
    };
  }

  /**
   * THE RUN'S DURABLE ROW — the only thing this mechanism writes besides the
   * page, and the page goes through `revisePage` like every other write.
   *
   * An observer records nothing (observer-mode G3: an instrument that logged
   * its own activity would be changing the store it is reading), and an append
   * that will not land costs the ROW and never the run (§5 G7).
   */
  recordPageWriterRun(run: {
    about: string;
    mode: PageWriterMode;
    outcome: PageWriterOutcome;
    detail?: string;
    bytesBefore?: number;
    bytesAfter?: number;
    considered?: number;
    omitted?: number;
    day?: number;
    /** One row per key, ever. For the rows that would otherwise repeat at every
     *  session start of every day — a deferral has no other bound. */
    dedupKey?: string;
    /** The nightly run's claim (2026-09-28): the session that claimed the night, and the run (its dream). */
    session?: string;
    run?: string;
  }): boolean {
    const day = run.day ?? this.store.livedDay();
    const payload = {
      about: run.about,
      // The date the run HAPPENED on, beside the one it is about: a claim is
      // only in flight while the day that made it is still running. The LOCAL
      // calendar day, because `pageWriterStatus`/`pageWriterClaimOpen` compare
      // it against the local `today` — one clock on both sides of the `<`.
      on: this.calendarToday(),
      mode: run.mode,
      outcome: run.outcome,
      detail: run.detail ?? "",
      bytesBefore: run.bytesBefore ?? 0,
      bytesAfter: run.bytesAfter ?? 0,
      considered: run.considered ?? 0,
      omitted: run.omitted ?? 0,
      ...(run.session === undefined || run.session.length === 0 ? {} : { session: run.session }),
      ...(run.run === undefined || run.run.length === 0 ? {} : { run: run.run }),
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
        ...(run.dedupKey === undefined ? {} : { dedupKey: run.dedupKey }),
      });
    } catch {
      this.emit("self.page.writer.unrecorded", undefined, { about: run.about, outcome: run.outcome });
      return false;
    }
    this.emit("self.page.writer.ran", undefined, {
      about: run.about,
      mode: run.mode,
      outcome: run.outcome,
      bytesAfter: payload.bytesAfter,
    });
    return true;
  }

  /** How a date came out, with the derivation named. Pure. */
  pageWriterStatus(about: string, today?: string): PageWriterStatus {
    return pageWriterStatus(this.store, about, today ?? this.calendarToday());
  }

  /** Every recorded attempt, newest first. Pure. */
  pageWriterRuns(opts: { about?: string; limit?: number } = {}): PageWriterRun[] {
    return pageWriterRuns(this.store, opts);
  }

  /** Is that night's claim still open — the question the page's door asks
   *  before it writes `by: "writer"` on a revision. Pure. */
  pageWriterClaimOpen(about: string, today?: string): boolean {
    return pageWriterClaimOpen(this.store, about, today ?? this.calendarToday());
  }

  /** The nightly run's open claim for this session, or null (2026-09-28). Pure. */
  nightClaimFor(session: string, today?: string): PageWriterRun | null {
    return nightClaimFor(this.store, session, today ?? this.calendarToday());
  }

  /**
   * UNWRITE THE PAGE — the owner's door, and only the owner's.
   *
   * The adversarial review found the dead end: `revisePage("")` refuses as
   * `empty`, the dashboard is read-only, and the only affordance an owner had
   * for "stop leading my wake with this page" was `counterparts remove <id>` —
   * which tombstones the row and, until the `schemas/` skip lands, leaves a
   * store that will not open at all. This is the door that removal was standing
   * in for.
   *
   * **How "no page" is represented, and why.** ONE ROW FOR THE LIFE OF THE PAGE:
   * the clear is an ordinary REVISION — so the body it replaces becomes an
   * ordinary version, attributed like every other — to a fixed cleared-body line,
   * with `meta.cleared` set. The row stays live and keeps its whole version
   * chain. `readSelfPage` returns null for a cleared row, so every reader — the
   * wake, the doctor, the dashboard, the MCP read, the console — sees a store
   * with no page and the wake goes back to its empty-page behaviour exactly as
   * if none had ever been written. The next write or restore revises the SAME
   * row and drops the flag.
   *
   * The first design archived the row instead, and the second review proved what
   * that cost: `revisePage` finds live rows, so the next write — including the
   * `--restore <seq>` the clear message itself recommends — minted a fresh row
   * and orphaned four versions with full attribution on a row no surface could
   * reach. The undo mechanism closed behind the owner as he walked through it.
   * Deleting was never available (not a verb `store/` has, on purpose), and
   * blanking the body would leave a live page whose text is a placeholder, which
   * is the "empty is a valid state" failure the bootstrap line exists to avoid
   * (§1 G5): a page that says nothing and a store with no page must not render
   * the same. The flag is what tells those two apart.
   *
   * It is the owner's door alone: no MCP tool reaches it. A session that could
   * unwrite the page could erase the self between two turns, and nothing about
   * a session's judgement in the moment earns that.
   */
  clearPage(opts: { reason: string; day?: number }): PageRevision {
    const day = opts.day ?? this.store.livedDay();
    const none = {
      id: null,
      version: null,
      bytes: 0,
      gate: null,
      redacted: null,
      current: null,
      overRoom: null,
      short: null,
    } as const;
    if (this.observer) {
      this.emit("self.observer.standdown", undefined, { site: "clearPage" });
      return { ...none, written: false, reason: "observer" };
    }
    const page = readSelfPage(this.store);
    if (page === null) return { ...none, written: false, reason: "empty" };
    // `revise` archives what was there FIRST, so the page that was cleared is a
    // version on this same row and `--restore <seq>` reaches it — with its
    // short version, which goes with it (2026-10-10).
    const version = this.store.revise(page.id, {
      body: PAGE_CLEARED_BODY,
      meta: {
        [PAGE_META_REASON]: opts.reason,
        [PAGE_META_CLEARED]: { on: this.store.today(), reason: opts.reason },
        [PAGE_META_SHORT]: null,
      },
      reason: opts.reason,
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
        limit: this.tunables.PAGE_MAX_BYTES,
      },
    });
    this.emit("self.page.revised", page.id, { by: "owner", cleared: true, version });
    markWakeBehind(this.store, "page");
    return { ...none, written: true, reason: "cleared", id: page.id, version, bytes: page.bytes };
  }

  /**
   * The page as the wake will print it — on the first rung of its ladder that
   * fits — and how much of `lend` it took to fit. Null when there is no page.
   * Pure.
   *
   * THE LADDER (2026-10-10, `briefing.ts#PageRung`), every rung whole text:
   * the page; the short version its writer wrote with this text; each `##`
   * section's heading and first sentence; the headings alone; one line. The
   * first four carry a top line (what this is, the page's size, the exact
   * line it ends with, both doors) and that end line after the dateline, all
   * counted (`pageBlockBytes`). #358 had two rungs, the page or the line; the
   * owner's page kept landing a few hundred bytes past the room, and a
   * session woke to one line about itself.
   *
   * THE ROOM is the caller's ceiling LESS the furniture that wake will wrap
   * the page in (`PAGE_FLOOR_RESERVE_BYTES`), and not the whole ceiling: the
   * page is furniture the trim loop cannot pop, so a page sized against the
   * whole budget puts the composition over it with nothing left to trim
   * (adversarial review B2). NOT CUT FOR THE LANES BESIDE IT (review of #350):
   * they give way to it — "Still open" gets its first item out of the other
   * lanes (`briefing.ts#keepFirstOpen`), never out of the page.
   *
   * IT BORROWS BEFORE IT STEPS DOWN (review of #358, kept): each rung that
   * does not fit is tried again with `lend` — the room the delivery holds for
   * "Work here", the first thing that gives way in `keepFirstOpen` too —
   * before the next rung down; it takes only what it needs (`took`), the rest
   * is still "Still open"'s. The page is worth more than a directory's work
   * lines, and so is the writer's own short version.
   *
   * `NO_ROOM` when not even the line fits, and not `null`: a page that does
   * not FIT and a page that does not EXIST must not reach the renderer as the
   * same thing — with `PAGE_EMPTY_SHOWS_LIST` off, `null` made a store that
   * HAS a page print "no page has been written here yet" (adversarial review
   * MINOR-D). A ceiling that small has every lane empty too, and the floor's
   * own over-budget tripwire is left for a host that really is misconfigured.
   *
   * `below` (2026-10-10): only the rungs after that one — the page stepping
   * down to give its borrowing back to a plain reminder due the day the wake
   * is read (`build`, `briefing.ts#ROOM_ORDER`).
   */
  private pageBlock(budgetBytes: number, lend = 0, below?: PageRung): { block: PageBlock | typeof NO_ROOM | null; took: number } {
    const page = this.page();
    if (page === null) return { block: null, took: 0 };
    const dateline = pageDateline(
      page.revisedOn,
      this.pageStale(page),
      this.tunables.PAGE_STALE_DAYS,
    );
    // THE PAGE'S OWN "LAST REVISED" LINE IS NOT PRINTED (2026-10-09): the
    // dateline above is the wake's, and a page that carried one of its own
    // printed two. A page that is nothing else is printed as it is. Nor the
    // wake's own frame around it, copied in from an older wake (review of
    // #363, `ownWords`): the frame below is this wake's.
    const own = ownWords(page.body);
    const body = own.body.length === 0 ? page.body : own.body;
    const wholeBytes = byteLength(body);
    const room = budgetBytes - PAGE_FLOOR_RESERVE_BYTES;
    const outline = pageOutline(body);
    const rung = (r: PageRung, text: string | null): PageBlock | null =>
      text === null || text.trim().length === 0
        ? null
        : {
            text,
            top: pageTopLine(r, wholeBytes),
            end: pageEndLine(r),
            dateline: r === "line" ? null : dateline,
            rung: r,
            truncated: r !== "whole",
            wholeBytes,
          };
    const ladder = [
      rung("whole", body),
      rung("short", page.short?.body ?? null),
      rung("outline", outlineText(outline)),
      rung("headings", headingsText(outline)),
      rung("line", pageTooLargeLine(wholeBytes)),
    ].filter((b): b is PageBlock => b !== null);
    const from = below === undefined ? 0 : ladder.findIndex((b) => b.rung === below) + 1;
    for (const block of ladder.slice(from)) {
      const cost = pageBlockBytes(block);
      if (cost <= room) return { block, took: 0 };
      if (lend > 0 && cost <= room + lend) return { block, took: cost - room };
    }
    return { block: NO_ROOM, took: 0 };
  }

  /**
   * THE SCHEDULED RECONCILER (contract §5 G12). Every derived surface owes one,
   * and "a script the owner runs occasionally" is not one: v1's identity index
   * was seeded once and the routine that would have added newly-formed elements
   * was never called at a boundary, so elements formed after seed day were
   * invisible at cold start until a human remembered to run something.
   *
   * This is that call. It re-ranks from the live store, re-composes, and
   * republishes — so a briefing cannot be stale by more than one boundary, by
   * construction rather than by diligence.
   */
  boundary(req: BoundaryRequest): BoundaryResult {
    if (req.identityCore !== undefined) this.ensureIdentityCore(req.identityCore);
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
      // WHETHER THE PAGE RENDERED, AND WHETHER IT WAS CUT. Zero and false mean
      // "no page in this render", which is what a store with none looks like;
      // without these a wake led by a 6 KB page and a wake led by nothing are
      // the same row, and the cut is the thing nobody would otherwise see.
      page: briefing.page?.bytes ?? 0,
      pageWhole: briefing.page?.wholeBytes ?? 0,
      pageTruncated: briefing.page?.truncated ?? false,
      // WHICH RUNG OF ITS LADDER IT PRINTED ON (2026-10-10) — what doctor's
      // Self page line reports. "none": a page this ceiling had no room to
      // say a word about; "": no page at all.
      pageRung: briefing.page?.rung ?? (this.page() === null ? "" : "none"),
      hash,
    });
    // A budget gets an event when APPROACHED and an event when crossed; a number
    // in a log is not a monitor (scar §2.4).
    if (briefing.pressure) {
      this.emit("self.briefing.pressure", undefined, {
        bytes: briefing.bytes,
        budget: briefing.budgetBytes,
      });
    }
    if (briefing.overBudget) {
      this.emit("self.briefing.overbudget", undefined, {
        bytes: briefing.bytes,
        budget: briefing.budgetBytes,
        floor: true,
      });
    }
    if (schema.quarantined > 0) {
      // The F8 quarantine, observable: a stood-aside row is counted, never
      // silently absent (scar §2.4).
      this.emit("self.schema.quarantined", undefined, {
        count: schema.quarantined,
        bytes: schema.quarantinedBytes,
      });
    }
    if (schema.pressure) {
      this.emit("self.schema.pressure", undefined, {
        bytes: schema.bytes,
        at: schema.pressureAt,
        elements: schema.elements,
      });
    }
    if (schema.tripped) {
      this.emit("self.schema.tripped", undefined, {
        bytes: schema.bytes,
        trip: schema.trip,
        elements: schema.elements,
      });
    }

    if (this.observer) {
      // An instrument composes and reports; it deposits nothing (scar E7).
      this.emit("self.observer.standdown", undefined, { site: "boundary:publish" });
      return { briefing, schema, published: false, reason: "observer", hash };
    }

    // ONE TRANSACTION for the bundle and what is read beside it (2026-10-10):
    // what this bundle lists as still open, so the delivery's "since" line
    // does not name it again (review of #332) — written at every publish, an
    // empty lane included, so it never describes an older bundle — and what it
    // showed of the stateful lanes and in what room, with the bundle's hash,
    // so a session start assembles around THIS bundle or not at all
    // (`assemble`).
    this.store.setMetaMany([
      [BRIEFING_KEY, briefing.text],
      [THREADS_SHOWN_KEY, JSON.stringify(briefing.kept.threads)],
      [WAKE_SHOWN_KEY, JSON.stringify(shownRecord(briefing, lanes, req, hash))],
    ]);
    // The rotation's memory: the identity ids this bundle KEPT, stamped with
    // the day. Kept, not ranked — an element the budget trimmed did not render
    // and keeps its place at the front of the next rotation.
    if (briefing.kept.identity.length > 0) {
      this.store.setMetaMany(
        briefing.kept.identity.map((id) => [`${RENDERED_PREFIX}${id}`, String(req.day)] as const),
      );
    }
    this.emit("self.briefing.published", undefined, { bytes: briefing.bytes, hash });
    // WHAT THE HINTS LANE SHOWED (v8, 2026-09-26): the kept hint ids, each with
    // the habituation load this showing leaves (`identity.ts#hintReading`), so
    // the next render rotates, and so a use while a memory is showing is known
    // not to be a return (physics §5.11). Kept, not ranked — as for identity.
    // Every other open showing is closed today. After the publish, and never
    // allowed to fail it.
    try {
      const displays = this.store.wakeDisplays();
      const kept = briefing.kept.hints.map((id) => ({
        id,
        load: hintReading(this.store.physicsOf(id), displays.get(id), req.day, this.tunables).nextLoad,
      }));
      this.store.recordHintDisplay(req.day, kept);
    } catch (err) {
      this.emit("self.hints.display.failed", undefined, { error: err instanceof Error ? err.name : "UNKNOWN" });
    }
    // THE JOURNAL'S BACKFILL (F6), and this is the only place it runs.
    //
    // A store whose `journal/` was deleted — or one whose episodes predate this
    // code, which is every store that existed before today — gets its copies
    // back here, a bounded handful per pass. It is AFTER the publish on purpose:
    // the briefing is this method's job and a slow disk must not be able to
    // delay it.
    //
    // WHERE THIS RUNS: `Self.boundary` is the consolidation cycle's last content
    // write, through `core/briefing.ts#selfRenderer` — so this is the DETACHED
    // WORKER, not the session's Stop hook (that calls `Counterpart.boundary`,
    // which is a different method). Bounded twice all the same, because the
    // worker is watchdogged and shares its cycle with decay, dedup and the
    // prune. The honest consequence is in `journal-file.ts`: a long-standing
    // store fills over many worker runs, and the chapter door is what keeps a
    // live one current.
    this.backfillJournal(req.day);
    return { briefing, schema, published: true, reason: "published", hash };
  }

  /**
   * Fill in missing journal files, a bounded pass. Never throws; an observer
   * never reaches it (the publish arm above returns first).
   */
  private backfillJournal(day: number): void {
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
          more: report.more,
        });
      }
    } catch {
      /* a derived copy never takes a boundary down (§1.5) */
    }
  }

  /**
   * WAKE: read what the previous boundary published, and verify it. No model, no
   * network, no ranking, no write — and observers receive it unchanged (§1 G8).
   *
   * Failure is never silence and never a lie: a store that has published nothing
   * gets the honest bootstrap line, and a store whose bundle is present but
   * damaged gets the bundle it has, flagged, because printing "initializing" over
   * a full store is the identity-amnesia failure this guarantee exists for.
   *
   * **The one cost, named:** a caller asking for a delivery preface also buys two
   * meta reads and one `COUNT(*)` — the store's size is a delivery-time fact and
   * a bundle rendered yesterday cannot state it. Still no ranking, no prose read,
   * no model and no write; the cost is a single aggregate, not O(store) prose,
   * and a caller that passes nothing pays exactly the old one meta row
   * (INTERFACE-GAPS #2).
   */
  wake(delivery?: WakeDelivery, assembled?: string): WakeResult {
    // A wake ASSEMBLED at session start (`assemble`, 2026-10-10) is delivered
    // in place of the published one, with the same preface and tense.
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
        preface: null,
      };
    }
    if (raw.length === 0) {
      // An empty read is an ERROR, never a silently-valid state (§1 G5).
      this.emit("self.wake", undefined, { ok: false, reason: "empty-read", bytes: 0 });
      return {
        text: BOOTSTRAP,
        ok: false,
        reason: "empty-read",
        bytes: 0,
        sentinel: null,
        reading: null,
        preface: null,
      };
    }
    const reading = readSentinel(raw);
    const reason: WakeReason = !reading.present
      ? "sentinel-missing"
      : reading.intact
        ? "delivered"
        : "sentinel-mismatch";
    // THE DELIVERY PREFACE, composed here and never at the boundary: which
    // system this is, which lived day, today's date, how big the store is now.
    // A damaged bundle is delivered exactly as found — `applyPreface` refuses to
    // rewrite a byte count that is already telling the truth about damage.
    const preface =
      delivery === undefined || reason !== "delivered"
        ? null
        : prefaceLine({
            system: WAKE_SYSTEM,
            day: this.store.livedDay(),
            ...(delivery.date === undefined ? {} : { date: delivery.date }),
            memories: this.store.countMemories({ type: "memory", archived: false }),
            // THE SECOND NUMBER, and it is recall's own denominator (U4): the
            // same filter minus the type clause, so "live rows" here and
            // `storeSize` there cannot mean two things.
            liveRows: this.store.countMemories({ archived: false }),
            ...(assembled === undefined ? {} : { assembled: true }),
          });
    // THE TENSE, at the same moment and from the same date (2026-10-09): an
    // Arriving line whose date is behind the person's today says it WAS due —
    // in what the preface's reserve leaves: the line itself, its newline, and
    // one more digit in each of the two byte counts the splice re-solves.
    const body =
      preface === null || delivery?.date === undefined
        ? raw
        : arrivingTense(raw, delivery.date, PREFACE_RESERVE_BYTES - byteLength(preface) - 1 - 2);
    // Only through the splice: a bundle `applyPreface` will not rewrite (an
    // opening line it does not recognise) is delivered exactly as found, and a
    // tensed body there would carry byte counts that no longer describe it
    // (review2 of #350).
    const spliced = preface === null ? null : applyPreface(body, preface);
    const delivered = preface === null || spliced === null || spliced.applied ? spliced : applyPreface(raw, preface);
    this.emit("self.wake", undefined, {
      ok: reason === "delivered",
      reason,
      bytes: delivered?.bytes ?? reading.actualBytes,
      stated: reading.statedBytes,
      elements: reading.statedElements,
      preface: delivered?.applied ?? false,
    });
    return {
      text: delivered?.text ?? raw,
      ok: reason === "delivered",
      reason,
      bytes: delivered?.bytes ?? reading.actualBytes,
      sentinel: delivered?.sentinel ?? reading.line,
      reading,
      preface: delivered?.applied === true ? preface : null,
    };
  }

  /**
   * The DELIVERY-side event, distinct from the render-side one (scar §2.3: "we
   * rendered it" is not "they received it"). v1 shipped eleven days of truncated
   * wakes because only the render was instrumented.
   *
   * The host calls this with what it saw where the wake's last line should be:
   * the expectation when that is what stood there, `null` when nothing did, and
   * some other string when something else did. The adapter that reads a
   * transcript passes `""` for that third case on purpose — the text around a
   * sentinel found inside a bundle is the owner's memories, and this seam needs
   * the verdict, not the line.
   */
  noteDelivered(sentinelSeen: string | null, expected: string | null): boolean {
    const ok = expected !== null && sentinelSeen === expected;
    this.emit("self.wake.delivered", undefined, {
      ok,
      sawSentinel: sentinelSeen !== null,
      expected: expected !== null,
    });
    return ok;
  }

  // ── identity, enumerated ─────────────────────────────────────────────────

  /**
   * The identity band and the protected set, side by side (constitution 16, scar
   * §2.19: everything permanent is enumerable on demand — a list, not a cadence).
   * Reads are pure: this writes nothing and logs nothing (§14.1 G8).
   */
  enumerate(day?: number): Enumeration {
    return enumerate(this.store, day ?? this.store.livedDay());
  }

  /**
   * Mint the identity core's home row, once, in the shape `schemas/` indexes:
   * `type: "schema"`, `kind: "self"`, `meta: { role: "entity", name, aliases }`
   * (schemas/INTERFACE-GAPS #5). Idempotent — a second call returns the existing
   * row and mints nothing, because a second identity core is a category error no
   * evidence could justify.
   *
   * The NAME is the caller's: this module will not invent one, and there is no
   * default. `boundary({ identityCore })` is the door that reaches this, so it is
   * not a method waiting for someone to remember it (scar §2.17).
   */
  ensureIdentityCore(spec: IdentityCoreSpec): { id: string | null; created: boolean; reason: "created" | "exists" | "observer" | "no-name" } {
    const existing = findIdentityCore(this.store);
    if (existing !== null) return { id: existing, created: false, reason: "exists" };
    if (spec.name.trim().length === 0) {
      this.emit("self.core.skipped", undefined, { reason: "no-name" });
      return { id: null, created: false, reason: "no-name" };
    }
    if (this.observer) {
      this.emit("self.observer.standdown", undefined, { site: "ensureIdentityCore" });
      return { id: null, created: false, reason: "observer" };
    }
    // Empty except its names: birth creates a PLACE for memories to attach,
    // never a claim about what is true of the thing.
    const id = this.store.put({
      type: "schema",
      kind: "self",
      title: spec.name,
      body: spec.name,
      meta: {
        role: IDENTITY_CORE_ROLE,
        name: spec.name,
        aliases: [...(spec.aliases ?? [])],
      },
    });
    this.emit("self.core.minted", id, { aliases: (spec.aliases ?? []).length });
    return { id, created: true, reason: "created" };
  }

  /** The standing self-schema counter (contract §5 G4). Pure; `boundary()` emits. */
  schemaBytes(day?: number): SchemaBytesReport {
    return schemaBytes(this.store, day ?? this.store.livedDay(), this.tunables);
  }

  // ── freeze, but keep counting ────────────────────────────────────────────

  /**
   * One walk, one event, one withheld movement.
   *
   * Everything before the single `if` is identical in both arms — resolution,
   * kind lookup, the strength reading, the counter, the event — because a frozen
   * rate measured on a different denominator would not be comparable to the live
   * one, and comparability is the whole reason the freeze keeps counting.
   */
  noteSelfConfirmation(occasion: ClaimOccasion): ClaimOutcome {
    const day = occasion.day ?? this.store.livedDay();
    const tier: UseTier = occasion.tier ?? "referenced";

    // G8: the freeze is decided on the RESOLVED element, so a confirmation
    // addressed to a superseded id still freezes.
    let resolvedId: string;
    try {
      resolvedId = this.store.resolve(occasion.elementId);
    } catch {
      this.emit("self.claim.unresolved", occasion.elementId, {
        source: occasion.source,
        direction: occasion.direction,
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
        count: 0,
      };
    }

    const before = this.store.physicsOf(resolvedId);
    const row = this.store.row(resolvedId);
    const band: Band = row?.band ?? "episodic";
    const kind = before.kind;
    const verdict: FreezeVerdict = decide(kind, occasion.source, occasion.direction);
    const strengthBefore = strength(before, day);

    // Softening is untouched on every kind (§14.2 G3, contract §5 G6) — and it
    // is not reinforcement, so it never moves through here: the verdict says
    // `live-softening` and the revision path (physics' pressure accumulator) is
    // the caller's next stop, unimpeded. Freezing both directions would make the
    // identity model unrevisable in both.
    const wouldMove = occasion.direction === "confirm";
    const credit =
      !verdict.frozen && wouldMove && !this.observer
        ? this.store.reinforce(resolvedId, day, tier)
        : null;

    const after = this.store.physicsOf(resolvedId);
    const count = this.bumpCount(kind, verdict.frozen);

    // The SAME event, from both arms, with a frozen marker: the event IS the
    // measurement; the movement is what is withheld (§14.2 G4, scar §2.4).
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
      count,
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
      count,
    };
  }

  /** Every claim counter, frozen and live, by kind. A read: writes nothing. */
  claimCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const kind of ["self", "skill", "person", "entity", "place", "fact"] as const) {
      for (const frozen of [true, false]) {
        const key = counterKey(kind, frozen);
        const value = this.observer
          ? (this.volatileCounts.get(key) ?? 0)
          : Number(this.store.getMeta(key) ?? "0");
        if (value > 0) out[key] = value;
      }
    }
    return out;
  }

  // ── episodes ─────────────────────────────────────────────────────────────

  episodeState(sessionId: string, day?: number): EpisodeState {
    const d = day ?? this.store.livedDay();
    if (this.observer) {
      return this.volatileState.get(sessionId) ?? freshEpisodeState(sessionId, d);
    }
    return loadEpisodeState(this.store, sessionId, d).state;
  }

  /** Pure: is a chapter due? No state advances, nothing is written. Reads the
   *  watermark `openChapter` would re-base to, so the two agree. */
  askDue(sessionId: string, substance: Substance, day?: number, opts: PaceOptions = {}): AskVerdict {
    const d = day ?? this.store.livedDay();
    return askDue(this.pacedState(sessionId, substance, d, opts).state, substance, this.tunables, {
      observer: this.observer,
      today: this.calendarToday(),
      unwritten: opts.unwritten ?? null,
    });
  }

  /** The session's state as the pacer should read it: re-based when it carries
   *  an old-counting watermark (`rebasedWatermark`), unless the caller says the
   *  substance is not a real count. */
  private pacedState(
    sessionId: string,
    substance: Substance,
    day: number,
    opts: PaceOptions,
  ): { state: EpisodeState; rebased: boolean } {
    const state = this.episodeState(sessionId, day);
    if (opts.rebase === false || sessionId.trim().length === 0) return { state, rebased: false };
    const rebased = rebasedWatermark(state, substance);
    return rebased === null ? { state, rebased: false } : { state: rebased, rebased: true };
  }

  /**
   * Ask for a chapter — ONE ask, and **the advance is committed before the ask
   * blocks** (§13 G3–G4), so a crash cannot re-ask in a loop. The state write
   * happens here, before the caller ever hands the text to a model.
   */
  openChapter(sessionId: string, substance: Substance, day?: number, opts: PaceOptions = {}): ChapterAsk {
    const d = day ?? this.store.livedDay();
    // The CALENDAR day the allowance is charged to, read once so the verdict and
    // the advance cannot straddle midnight (`episodes.ts#asksSpentOn` carries
    // why it is the calendar date and not the lived one). LOCAL midnight since
    // 2026-09-23 (`calendar.ts`), not UTC's.
    const today = this.calendarToday();
    // Persisted once, whether or not an ask is due, so a watermark left by an
    // older counting rule cannot hold the re-ask off (`rebasedWatermark`).
    const paced = this.pacedState(sessionId, substance, d, opts);
    const state = paced.state;
    if (paced.rebased) {
      this.emit("self.episode.rebased", sessionId, {
        fromTurns: this.episodeState(sessionId, d).askedAtTurns,
        toTurns: state.askedAtTurns,
      });
      this.persistState(state, "rebase");
    }
    const verdict = askDue(state, substance, this.tunables, {
      observer: this.observer,
      today,
      unwritten: opts.unwritten ?? null,
    });
    if (!verdict.due) {
      this.emit("self.episode.ask.skipped", sessionId, {
        reason: verdict.reason,
        chapter: verdict.chapter,
        sinceTurns: verdict.sinceTurns,
        sinceBytes: verdict.sinceBytes,
      });
      return { asked: false, verdict, ask: null, chapter: verdict.chapter };
    }
    // The ask count advances; the CHAPTER count does not. What the model wrote
    // is the only thing that may claim to be a chapter (2026-09-04: the hook's
    // count ran to 7 while the episode held none).
    const advanced: EpisodeState = {
      ...state,
      asks: state.asks + 1,
      asksToday: asksSpentOn(state, today) + 1,
      asksDay: today,
      // WHEN, as well as how many: the third arm counts its half hour and its
      // new pieces from here (`PaceOptions.unwritten`, 2026-09-30).
      lastAskAt: this.store.now(),
      askedAtTurns: substance.turns,
      askedAtBytes: substance.bytes,
      lastDay: d,
    };
    this.persistState(advanced, "openChapter");
    this.emit("self.episode.ask", sessionId, {
      chapter: verdict.chapter,
      reason: verdict.reason,
      turns: substance.turns,
      bytes: substance.bytes,
      // Asks THIS SESSION has raised in its whole life, and the ones it has
      // spent TODAY — the second is the one `MAX_ASKS_PER_SESSION` refuses on,
      // so the distance to the cap is readable in the ring. How many asks a
      // calendar DATE held ACROSS sessions is a question the durable
      // `adapter.ask` rows answer, each stamped with its date and outcome; no
      // second counter is kept for it.
      asks: advanced.asks,
      asksToday: advanced.asksToday,
      asksDay: today,
    });
    return { asked: true, verdict, ask: askText(verdict.chapter), chapter: verdict.chapter };
  }

  /**
   * Append a chapter in the moment. The episode is created on the first one and
   * revised thereafter — `store.revise` archives the prior version first, so the
   * open journal keeps every state it passed through.
   */
  appendChapter(
    sessionId: string,
    text: string,
    /** `scope`: the directory it was written in, recorded on a NEW episode's
     *  origin (2026-09-30). `about`: what the session was about — on the
     *  episode's meta, and on its live memory copy at once (2026-10-01). */
    opts: { day?: number; title?: string; happenedOn?: string; model?: string; scope?: string; about?: AboutMark } = {},
  ): ChapterAppend {
    const d = opts.day ?? this.store.livedDay();
    if (sessionId.trim().length === 0) {
      // Identity-safe join (§13 G7): every anonymous session collapses to the
      // same marker, so one session's account would pool into another's.
      this.emit("self.episode.skipped", undefined, { reason: "anonymous-session" });
      return { episodeId: null, chapter: 0, created: false, heading: false, reason: "anonymous-session", copy: null };
    }
    if (this.observer) {
      this.emit("self.observer.standdown", sessionId, { site: "appendChapter" });
      return { episodeId: null, chapter: 0, created: false, heading: false, reason: "observer", copy: null };
    }
    // Every ingestion entrance runs the battery — a chapter is canonical prose,
    // and a credential in one landed durably before this gate existed (found by
    // the composition root's caller-universality test, fixed the same day). The
    // gate's text — possibly redacted — is what gets written, never the draft.
    const verdict = this.gate({ text, handles: [], sessionId });
    if (!verdict.ok) {
      this.emit("self.episode.chapter.refused", sessionId, {
        gate: verdict.gate,
        reason: verdict.reason,
      });
      return { episodeId: null, chapter: 0, created: false, heading: false, reason: "gate-refused", copy: null };
    }
    const gatedText = verdict.text ?? text;
    const state = this.episodeState(sessionId, d);
    // The calendar day the chapter is written on, in the person's own zone —
    // the heading prints it beside the lived day (owner, 2026-09-24).
    const append: Parameters<typeof appendChapter>[3] = {
      day: d,
      date: calendarDate(this.store.now(), this.dayZone()),
    };
    if (opts.title !== undefined) append.title = opts.title;
    if (opts.happenedOn !== undefined) append.happenedOn = opts.happenedOn;
    if (opts.model !== undefined) append.model = opts.model;
    if (opts.scope !== undefined && opts.scope.length > 0) append.scope = opts.scope;
    if (opts.about !== undefined) append.about = opts.about;
    const written = appendChapter(this.store, state, gatedText, append);
    // THE MARK REACHES THE COPY NOW (2026-10-01, lane 8), not at its next
    // regrowth — which a closed window may never bring. The latest act wins:
    // a regrown copy carries its predecessor's mark (`ingestEpisode`), so a
    // reflection's later mark is kept the same way. Never fails the chapter.
    if (opts.about !== undefined) {
      try {
        // `Store#copiesOf`: the live copies with their marks, in one read.
        for (const copy of this.store.copiesOf([written.episodeId]).get(written.episodeId) ?? []) {
          if (copy.about !== opts.about) this.store.setAbout(copy.id, opts.about, { by: "writer" });
        }
      } catch (err) {
        this.emit("self.episode.about.failed", written.episodeId, { error: err instanceof Error ? err.name : "UNKNOWN" });
      }
    }
    this.persistState(
      {
        ...state,
        episodeId: written.episodeId,
        chapters: Math.max(state.chapters, written.chapter),
        // This append ANSWERS the open ask: the next one continues this chapter
        // rather than opening another (§13 G2's headline case).
        appendedAtAsk: state.asks,
        lastDay: d,
      },
      "appendChapter",
    );
    this.emit("self.episode.chapter", written.episodeId, {
      session: sessionId,
      chapter: written.chapter,
      created: written.created,
      bytes: byteLength(gatedText),
    });
    // THE MARKDOWN COPY, AFTER THE ROW AND NEVER INSTEAD OF IT (F6). The
    // chapter is committed above; this is a derived file, it cannot throw, and
    // a failure is a durable row rather than a failed `chapter` call. Written
    // per append rather than once at session end because the plan's one
    // undetermined question (§7.6) resolves that way in the code: the episode
    // row is rewritten per append, so the file is a whole-file rewrite either
    // way, and per-append is the reading that does not lose a crashed session's
    // last chapter.
    const copy = syncJournalCopy(this.store, written.episodeId);
    noteJournalCopy(this.store, copy, {
      day: d,
      chapters: written.chapter,
      site: "chapter",
    });
    this.emit("self.journal.copy", written.episodeId, {
      outcome: copy.outcome,
      bytes: copy.bytes,
      ...(copy.reason === null ? {} : { reason: copy.reason }),
    });
    return { ...written, reason: "appended", copy: copy.outcome };
  }

  /**
   * Ingest the session's episode as an ordinary self-kind memory — context and
   * source, in that order, ingested ONCE. Idempotent by identity against active
   * and archived memories; add-first on regrowth; the window closes.
   */
  ingestEpisode(
    input: EpisodeProposal | { sessionId: string; day?: number; handles?: readonly string[] },
  ): IngestResult {
    const intake = intakeEpisode({ content: "-", ...input });
    const none = (
      reason: IngestResult["reason"],
      intakeReason: EpisodeIntakeReason | null = null,
    ): IngestResult => ({
      ingested: false,
      reason,
      memoryId: null,
      episodeId: null,
      key: null,
      archived: [],
      gate: null,
      intake: intakeReason,
    });
    if (!intake.ok) {
      // The intake's own reason is carried through: an anonymous session and a
      // malformed handle list are different refusals and must read differently.
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
      // Idempotent against active AND archived, so consolidation's archival
      // decisions are not resurrected by a stray touch (§5 G10).
      this.emit("self.episode.ingest.skipped", state.episodeId, {
        reason: "already-ingested",
        memory: existing.id,
      });
      return {
        ingested: false,
        reason: "already-ingested",
        memoryId: existing.id,
        episodeId: state.episodeId,
        key,
        archived: [],
        gate: null,
        intake: null,
      };
    }
    const regrow = state.firstIngestDay !== null;
    if (regrow && d - (state.firstIngestDay ?? d) > this.tunables.REGROW_WINDOW_DAYS) {
      // The window CLOSES — the deliberate deviation from human
      // reconsolidation, which reopens on every retrieval (§13 G12).
      this.emit("self.episode.ingest.skipped", state.episodeId, {
        reason: "window-closed",
        openedOn: state.firstIngestDay,
        day: d,
        window: this.tunables.REGROW_WINDOW_DAYS,
      });
      return {
        ingested: false,
        reason: "window-closed",
        memoryId: state.ingestedMemoryId,
        episodeId: state.episodeId,
        key,
        archived: [],
        gate: null,
        intake: null,
      };
    }

    const handles = [...(input.handles ?? [])];
    const verdict = this.gate({ text: doc.body, handles, sessionId });
    if (!verdict.ok) {
      // A first-person reflection is not exempt from never durably encoding a
      // credential (§13 G8, scar §2.7).
      this.emit("self.episode.ingest.refused", state.episodeId, {
        gate: verdict.gate,
        reason: verdict.reason,
      });
      return {
        ingested: false,
        reason: "gate-refused",
        memoryId: null,
        episodeId: state.episodeId,
        key,
        archived: [],
        gate: { gate: verdict.gate, reason: verdict.reason },
        intake: null,
      };
    }

    // ADD FIRST, then archive the stale one: a failed add can never leave an
    // episode with no live memory (§13 G11).
    const proposal = input as EpisodeProposal;
    // The GATE's text, never the draft, is what becomes the memory: an episode
    // is an ordinary ingestion and the battery may have redacted it (SEAMS H).
    const body = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : doc.body;
    const put: Parameters<Store["put"]>[0] = {
      type: "memory",
      kind: "self",
      body,
      meta: { episodeId: state.episodeId, episodeKey: key, sessionId, handles },
      // The experiencer's own episode is lived testimony — the "episode"
      // channel, recorded as provenance like every other mint (F9-light).
      source: "episode",
      origin: { session: sessionId, ref: state.episodeId },
    };
    // THE COPY KEEPS THE CHAPTER'S TITLE (2026-09-30, U13). The boundary caller
    // never fills `proposal.title`, so every copy was minted untitled — a row
    // that read, in a recall result, as the less useful twin of its own chapter.
    // Nothing is invented: the chapter's own title, when it has one. A copy
    // minted before this picks the title up when its chapter next regrows.
    //
    // THE SECRETS SCAN ONLY, not the whole battery (review of #293, B3): the
    // battery's content floor (20 characters, three words) is a rule for a
    // memory's BODY, and it refused almost every real title — "Launch day",
    // "The first week". A credential is still redacted (the chapter door gates
    // only the text, so a title may carry one); a title that is nothing BUT a
    // credential is dropped, and says so.
    if (proposal.title !== undefined) put.title = proposal.title;
    else if (doc.title !== undefined && doc.title.trim().length > 0) {
      const scan = scanSecrets(doc.title.trim(), "title");
      if (scan.emptyAfterRedaction) {
        this.emit("self.episode.title.dropped", state.episodeId, { reason: "empty-after-redaction" });
      } else put.title = scan.redacted;
    }
    if (proposal.happenedOn !== undefined) put.happenedOn = proposal.happenedOn;
    else if (doc.happenedOn !== undefined) put.happenedOn = doc.happenedOn;
    if (proposal.salience !== undefined || proposal.claimed !== undefined) {
      put.salience = { ...(proposal.salience ?? {}), claimed: proposal.claimed ?? null };
    }
    // WHAT THE COPY IS ABOUT (2026-10-01, lane 8): the copy it replaces says
    // last — the chapter tool sets the mark on the live copy at once, and a
    // reflection may set one later, so the latest act is on that row — and
    // the chapter's own `about` when there is no copy yet.
    const staleCopies = memoriesForEpisode(this.store, state.episodeId);
    const carried = this.copyAbout(staleCopies, doc);
    if (carried !== null) {
      put.about = carried.mark;
      put.aboutBy = carried.by;
    }
    const memoryId = this.store.put(put);

    const archived: string[] = [];
    for (const stale of staleCopies) {
      if (stale === memoryId) continue;
      this.store.archive(stale, "episode-regrown");
      archived.push(stale);
    }
    // THE LINKS GO WITH THE WORDS (2026-10-09). An archived copy stops
    // conducting, so every link it had learned (the session's contiguity, a
    // co-use, a dream's tie) was stranded on it: 260 of a live store's 1,200
    // edge rows on 10-02. The new copy inherits them the way a dream merge's
    // memory inherits its originals' — after the archive, so one stale copy's
    // tie to another is not carried. A failure costs the links, never the copy.
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

    this.persistState(
      {
        ...state,
        ingestedKey: key,
        ingestedMemoryId: memoryId,
        firstIngestDay: state.firstIngestDay ?? d,
        lastDay: d,
      },
      "ingestEpisode",
    );
    this.emit("self.episode.ingested", state.episodeId, {
      memory: memoryId,
      regrown: regrow,
      archived: archived.length,
      handles: handles.length,
      bytes: byteLength(doc.body),
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
      intake: null,
    };
  }

  /**
   * The mark a new copy of an episode takes: the newest live copy's, with who
   * set it, else the episode's own `meta.about` (the chapter tool's, set by
   * the writer), else none. Never throws.
   */
  private copyAbout(staleCopies: readonly string[], episode: ProseDoc): { mark: AboutMark; by: AboutSetter } | null {
    try {
      for (const id of [...staleCopies].reverse()) {
        const row = this.store.row(id);
        const mark = aboutMarkOf(row?.about);
        if (mark === null) continue;
        const by = row?.about_by ?? "";
        return { mark, by: (ABOUT_SETTERS as readonly string[]).includes(by) ? (by as AboutSetter) : "writer" };
      }
    } catch {
      /* the episode's own mark, below */
    }
    const own = aboutMarkOf(episode.meta[EPISODE_ABOUT_META]);
    return own === null ? null : { mark: own, by: "writer" };
  }

  /**
   * THE DOOR THAT REACHES INGESTION (contract §3: "every identity surface owes
   * an answer to *which door reaches this?*", §5 G12: every derived surface owes
   * a SCHEDULED reconciler, asserted to run at a boundary).
   *
   * Measured 2026-09-04: `ingestEpisode` had no caller outside this module and
   * its own tests. An episode that nobody ingests is a file, not a memory — the
   * "context and source, in that order" half of §13 G6 was unreachable in
   * production for the whole run. This is that scheduled pass: every live
   * episode whose CURRENT text has not been ingested is ingested here, at the
   * boundary, before the cycle that decays and re-renders around it.
   *
   * Cheap by construction: the skip is a state read plus a hash, so an episode
   * already ingested at its current text costs no scan of the memory table.
   */
  reconcileEpisodes(day?: number): {
    considered: number;
    ingested: number;
    regrown: number;
    skipped: number;
  } {
    const d = day ?? this.store.livedDay();
    let considered = 0;
    let ingested = 0;
    let regrown = 0;
    let skipped = 0;
    for (const id of this.store.list({ type: "episode", archived: false })) {
      let doc: ProseDoc;
      try {
        doc = this.store.readProse(id);
      } catch {
        continue;
      }
      const sessionId = doc.meta["sessionId"];
      // The identity-safe join again: an episode with no session is skipped
      // outright rather than pooled into anyone's day (§13 G7).
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) continue;
      considered += 1;
      const state = this.episodeState(sessionId, d);
      if (state.ingestedKey === ingestKey(id, doc.body)) {
        skipped += 1;
        continue;
      }
      const out = this.ingestEpisode({ sessionId, day: d });
      if (out.reason === "ingested") ingested += 1;
      else if (out.reason === "regrown") regrown += 1;
      else skipped += 1;
    }
    this.emit("self.episode.reconciled", undefined, {
      considered,
      ingested,
      regrown,
      skipped,
      day: d,
    });
    return { considered, ingested, regrown, skipped };
  }

  /**
   * The orphanable tail: substance accumulated after the last ask, which no ask
   * can cover because only a blocked stop hands the model a pen and nobody knows
   * which stop is last. It is bounded by the re-ask thresholds and LOGGED, so the
   * miss is measurable before anyone debates a reconstruction fallback — the
   * right shape for an unfixable gap: bound it, measure it, don't pretend.
   */
  noteOrphanTail(sessionId: string, substance: Substance, day?: number, opts: PaceOptions = {}): AskVerdict {
    // The SAME verdict the ask would get, from the session's own state and the
    // same re-based watermark: the tail telemetry and the ask must never
    // disagree about why nothing was asked.
    const verdict = this.askDue(sessionId, substance, day, opts);
    this.emit("self.episode.tail", sessionId, {
      sinceTurns: verdict.sinceTurns,
      sinceBytes: verdict.sinceBytes,
      boundTurns: this.tunables.REASK_TURNS,
      boundBytes: this.tunables.REASK_TEXT_BYTES,
      chapters: this.episodeState(sessionId, day).chapters,
    });
    return verdict;
  }

  events(name?: string): SelfEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private horizonRank(item: HorizonItem, day: number): Ranked {
    let kind: Kind = "fact";
    let bornDay = day;
    let s = 0;
    try {
      const physics = this.store.physicsOf(item.id);
      kind = physics.kind;
      bornDay = physics.birthDay;
      s = strength(physics, day);
    } catch {
      /* an occasion whose memory has gone is still an occasion; it renders by id */
    }
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
      ...(item.plainDue === true ? { due: true } : {}),
    };
  }

  /**
   * Id → statement AND its dates, at render time only. A missing doc renders as
   * its own id, undated: there is nothing left to date it by, and inventing
   * today's date for a memory whose prose has gone is the exact lie the dates
   * exist to prevent. The dates come from the SAME read as the text, so an
   * element's age can never be one boundary older than its words.
   */
  private resolveStatement(
    id: string,
    docs: Map<string, ProseDoc>,
    sources: Map<string, string | null>,
  ): Resolved {
    let doc = docs.get(id);
    if (doc === undefined) {
      try {
        doc = this.store.readProse(id);
      } catch {
        return { statement: id };
      }
    }
    // The horizon lane's ids never went through `scanActive`, so their
    // provenance is read here — the one row read the scan did not already make.
    const source = sources.has(id) ? sources.get(id) ?? null : this.store.row(id)?.source ?? null;
    const paragraph = doc.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? doc.body;
    const statement = flatten(paragraph);
    const out: {
      statement: string;
      learnedOn?: string;
      happenedOn?: string;
      boundedDate?: boolean;
      standing?: { prefix: string; suffix: string };
    } = { statement: statement.length > 0 ? statement : id };
    // Its standing in a contradiction — the same words recall uses (review of
    // #284, S3): hints, threads and identity alike. Never fails a render.
    try {
      const st = standingOf(this.store, id);
      if (st !== null) out.standing = { prefix: st.prefix, suffix: st.suffix };
    } catch {
      /* no standing */
    }
    // Blank is how a chased row reads (`owner-op-seam`), and blank is not a date.
    if (doc.learnedOn.trim() !== "") out.learnedOn = doc.learnedOn;
    if (doc.happenedOn !== undefined && doc.happenedOn.trim() !== "") {
      out.happenedOn = doc.happenedOn;
    }
    // A MIGRATED element's encode date is an upper bound, not a claim: the
    // importer wrote the import date wherever v1 carried none, and the row does
    // not say which it did (measured live 2026-09-05 — all eleven elements read
    // the import day, a July incident among them).
    //
    // UNLESS THE ROW NOW SAYS WHICH. `counterparts repair-dates --apply` writes
    // `meta.dateRepaired` when it re-dates a migrated row from the row's own
    // evidence, and a date recovered at HIGH confidence — the v1 document's own
    // `created` field, or an engram-era id that is a millisecond timestamp — is a
    // claim again, not a bound. Only `high`: `medium` and `low` came from the
    // session, the element's statement or the source path, which are all still
    // "no later than", and hedging them is the honest render.
    if (source === "migrated" && !repairedAtHighConfidence(doc)) out.boundedDate = true;
    return out;
  }

  /**
   * The counter. One row per (kind, arm), so the frozen rate and the live rate
   * share a denominator. It is telemetry, not physics: it moves on every
   * occasion, frozen or live, and moving it is not moving the memory.
   */
  private bumpCount(kind: Kind, frozen: boolean): number {
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

  private persistState(state: EpisodeState, site: string): void {
    if (this.observer) {
      this.volatileState.set(state.sessionId, state);
      this.emit("self.observer.standdown", state.sessionId, { site: `persist:${site}` });
      return;
    }
    this.store.setMeta(stateKey(state.sessionId), JSON.stringify(state));
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const e: SelfEvent = { at: this.now(), name };
    if (ref !== undefined) e.ref = ref;
    if (data !== undefined) e.data = data;
    this.ring.push(e);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(e);
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Did `counterparts repair-dates` recover this row's date from the row's OWN
 * strongest evidence?
 *
 * The marker is prose meta, written by the repair beside the corrected date
 * (`adapters/cli/repair-dates.ts`, `DATE_REPAIRED_META`), so the document stays
 * self-describing: the claim and the reason to believe it travel together and
 * survive a copy of the store. Read STRUCTURALLY rather than by importing the
 * adapter's constant — `self/` may not import an adapter — and a shape check that
 * fails renders the bound, which is the safe direction.
 */
function repairedAtHighConfidence(doc: ProseDoc): boolean {
  const marker = doc.meta["dateRepaired"];
  if (typeof marker !== "object" || marker === null || Array.isArray(marker)) return false;
  return (marker as Record<string, unknown>)["confidence"] === "high";
}

export type {
  AskVerdict,
  Band,
  BriefingRequest,
  BriefingResult,
  ClaimDirection,
  ClaimSource,
  Enumeration,
  EpisodeGate,
  EpisodeProposal,
  EpisodeState,
  FreezeReason,
  IngestResult,
  Kind,
  LaneName,
  Lanes,
  Ranked,
  Resolve,
  Resolved,
  SchemaBytesReport,
  SentinelReading,
  Substance,
  UseTier,
};
export { BRIEFING_TRIM_LOG_CAP, COUNTER_PREFIX, FRAMING, FROZEN_KINDS, LANE_ORDER, TRIM_ORDER };

/** The `WAKE_SHOWN_KEY` record for a published briefing and its lanes. */
function shownRecord(briefing: BriefingResult, lanes: Lanes, req: BoundaryRequest, hash: string): WakeShown {
  const lost = (lane: "identity" | "craft"): string[] => {
    const kept = new Set(briefing.kept[lane]);
    return [...lanes[lane].map((r) => r.id), ...(lanes.overflow?.[lane] ?? [])].filter((id) => !kept.has(id));
  };
  const whole = (n: number | undefined): number => Math.max(0, Math.floor(n ?? 0));
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
    more: { identity: lost("identity"), craft: lost("craft") },
  };
}

/**
 * THE MEMORIES A LATER ONE HAS SETTLED OVER (2026-10-01, random-f2's item 11):
 * the `over` side of a settled `changed` or `corrected` pair, closed directly
 * (a pair closed through another speaks through that one). `rankLanes` keeps
 * them out of every lane but identity, so an answered question is not shown
 * alone as still open.
 *
 * ONLY WHILE SOMETHING LIVE HOLDS (review of #311). A memory is hidden when, in
 * the NEWEST settled pair that names it, it is the `over` — so one re-affirmed
 * by a later pair (holds there) is not hidden by the older one — and that
 * pair's `holds` leads to a live memory: followed through its own newer
 * settles and through `superseded_by` to the live end.
 * A `holds` that is archived, removed, or superseded with no live successor
 * hides nothing, and the `over` stays visible. Never throws — a store that
 * will not answer has settled nothing.
 */
export function settledOver(store: Pick<Store, "contradictions" | "row">): Set<string> {
  const out = new Set<string>();
  try {
    // Oldest first, so the newest pair naming a memory is the last one seen.
    // The store reads newest first; reversed, a tie on the clock keeps the
    // order the pairs were made in.
    const pairs = [...store.contradictions({ state: "settled", limit: 100_000 })]
      .reverse()
      .filter((p) => p.via === null && p.over !== null && p.holds !== null && (p.how === "changed" || p.how === "corrected"))
      .sort((a, b) => a.updated_at - b.updated_at || a.created_at - b.created_at);
    const newest = new Map<string, { role: "over" | "holds"; holds: string }>();
    for (const p of pairs) {
      newest.set(p.over as string, { role: "over", holds: p.holds as string });
      newest.set(p.holds as string, { role: "holds", holds: p.holds as string });
    }
    const live = (id: string): boolean => {
      const r = store.row(id);
      return r !== undefined && r.archived === 0 && r.superseded_by === null && !(r.body === "" && r.content_hash === "");
    };
    const visiting = new Set<string>();
    // Each memory's live end, once (review of #311: a 400-settle chain walked
    // its whole tail for every link). A cycle's members memoise as null.
    const ends = new Map<string, string | null>();
    // The live memory `id` leads to, not hidden itself; null when none.
    const liveEnd = (id: string, depth = 0): string | null => {
      const known = ends.get(id);
      if (known !== undefined) return known;
      if (depth > 5_000 || visiting.has(id)) return null;
      visiting.add(id);
      let end: string | null = null;
      try {
        end = walk(id, depth);
      } finally {
        visiting.delete(id);
      }
      ends.set(id, end);
      return end;
    };
    const walk = (id: string, depth: number): string | null => {
      const r = store.row(id);
      if (r === undefined) return null;
      if (!live(id)) return r.superseded_by === null ? null : liveEnd(r.superseded_by, depth + 1);
      // Live, and itself settled over by something live: that is the end.
      const n = newest.get(id);
      const further = n !== undefined && n.role === "over" ? liveEnd(n.holds, depth + 1) : null;
      return further ?? id;
    };
    for (const [id, n] of newest) if (n.role === "over" && liveEnd(n.holds) !== null) out.add(id);
  } catch {
    return new Set();
  }
  return out;
}
