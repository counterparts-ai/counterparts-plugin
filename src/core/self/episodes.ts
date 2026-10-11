/**
 * EPISODES — the day narrating itself, in the first person.
 *
 * Brain analog: event segmentation plus replay-based consolidation. The
 * deliberate break (constitution 12): humans never author their episodes —
 * encoding is involuntary — while here it is a ritual, which is the whole
 * authorship thesis.
 *
 * The five properties that are structural, and the incidents behind them
 * (behavioral-spec §13):
 *
 *   - **Substance-paced, never wall-clock-paced.** An ask is due on turns the
 *     person typed OR on conversation text from both roles, whichever comes
 *     first — so a one-prompt agentic session still journals. One more way
 *     since 2026-09-30, and it is pieces AND time: what the session has not
 *     written up (`core/coverage/`, handed in as `PaceOptions.unwritten`).
 *   - **Live append.** The ritual hands the model its chapter for the REST of the
 *     session. v1's once-per-session ask fired at the first stop, so everything
 *     after turn one was first-person-invisible; one session's episode missed the
 *     moment that mattered by 82 seconds.
 *   - **One ask, not two**, and **the advance is committed before the ask
 *     blocks**, so a crash cannot re-ask in a loop.
 *   - **Episodes are context and source, in that order** — ingested ONCE as
 *     ordinary self-kind memories with named handles. *"Episode" is not a memory
 *     kind*: it is a prose family here (`epi_`), and what it becomes is a
 *     `self`-kind memory like any other.
 *   - **Add-first regrowth within a window that CLOSES.** Because the journal
 *     stays open, a file can grow after its memory exists; freezing at first
 *     ingest would drop exactly the in-the-moment material the open journal
 *     exists to capture. Add first, then archive the stale one — a failed add can
 *     never leave an episode with no live memory. The window closing is a
 *     deliberate deviation from human reconsolidation, which reopens forever.
 *
 * Two refusals that look like edge cases and are not: a span with **no session
 * identity is skipped outright** (every anonymous session collapses to the same
 * marker, and pooling one session's account into another's — under an instruction
 * saying it outranks the transcript — is the identity-safety failure §13 G7
 * names), and **ingestion is ordinary, so the gate applies**: a first-person
 * reflection is not exempt from never durably encoding a credential (§13 G8, scar
 * §2.7 — episode ingestion was v1's most heavily gated surface, 66% of all gate
 * fires).
 */
import type { Salience } from "../types.js";
import { isModelId } from "../types.js";
import type { ProseDoc, Store } from "../store/index.js";
import { hashText } from "../store/index.js";
import type { SelfTunables } from "./tunables.js";
import { readableDate } from "./calendar.js";

// ── the input shape (a SEAM, not an import — INTERFACE-GAPS #1) ─────────────

/**
 * What arrives from `remember/`'s authorship path, restated here rather than
 * imported. `self/` must not depend on `remember/` (the dependency runs the other
 * way: authorship is upstream of the self), so this is the contract's own episode
 * input shape and the wiring is recorded in INTERFACE-GAPS.md #1.
 */
export interface EpisodeProposal {
  /** Identity-safe join: blank means SKIPPED, never pooled (§13 G7). */
  readonly sessionId: string;
  /** The first-person chapter text, the model's own voice, any length. */
  readonly content: string;
  readonly title?: string;
  /** Named handles — aliases, not a second lookup path (contract §3, §9.2). */
  readonly handles?: readonly string[];
  /** When it happened, at stated precision. */
  readonly happenedOn?: string;
  /** The author's claimed aggregate salience: a FLOOR, clamped in `physics/`. */
  readonly claimed?: number | null;
  readonly salience?: Partial<Salience>;
  readonly day?: number;
}

export type EpisodeIntakeReason =
  | "ok"
  | "NOT_AN_OBJECT"
  | "SESSION_MISSING"
  | "CONTENT_MISSING"
  | "CONTENT_EMPTY"
  | "HANDLES_NOT_STRINGS";

export type EpisodeIntake =
  | { ok: true; proposal: EpisodeProposal }
  | { ok: false; reason: EpisodeIntakeReason };

/** Validate a raw deposit. Reasons, never a bare false (test discipline). */
export function intakeEpisode(raw: unknown): EpisodeIntake {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "NOT_AN_OBJECT" };
  }
  const rec = raw as Record<string, unknown>;
  const session = rec["sessionId"];
  if (typeof session !== "string" || session.trim().length === 0) {
    return { ok: false, reason: "SESSION_MISSING" };
  }
  if (rec["content"] === undefined || typeof rec["content"] !== "string") {
    return { ok: false, reason: "CONTENT_MISSING" };
  }
  if ((rec["content"] as string).trim().length === 0) {
    return { ok: false, reason: "CONTENT_EMPTY" };
  }
  const handles = rec["handles"];
  if (
    handles !== undefined &&
    (!Array.isArray(handles) || handles.some((h) => typeof h !== "string"))
  ) {
    return { ok: false, reason: "HANDLES_NOT_STRINGS" };
  }
  return { ok: true, proposal: rec as unknown as EpisodeProposal };
}

// ── the gate seam (scar §2.7) ───────────────────────────────────────────────

export interface EpisodeGateInput {
  readonly text: string;
  readonly handles: readonly string[];
  readonly sessionId: string;
}

export type EpisodeGateVerdict =
  /** `text`, when present, is the gate's REDACTED body — and it, never the draft,
   *  is what becomes the memory (SEAMS item H; encode §5: "the gate runs before
   *  anything durable"). A gate that only accepts or refuses omits it, so this is
   *  additive: an older gate keeps working and simply redacts nothing. */
  | { ok: true; text?: string }
  | { ok: false; gate: string; reason: string };

export type EpisodeGate = (input: EpisodeGateInput) => EpisodeGateVerdict;

/**
 * The default REFUSES, exactly as `remember/`'s `NO_GATE` does. A module that
 * cannot run the secrets battery must not be able to quietly encode a
 * credential because nobody wired one in; "no gate injected" is a loud reason,
 * and an absent gate is not an open one.
 */
export const NO_GATE: EpisodeGate = () => ({
  ok: false,
  gate: "none",
  reason: "NO_GATE_INJECTED",
});

// ── per-session chapter state ───────────────────────────────────────────────

export interface Substance {
  /** Messages the PERSON typed. The assistant's text, injected context and
   *  tool noise are excluded by the caller. */
  readonly turns: number;
  /** UTF-8 bytes of conversation text from BOTH roles — injected context and
   *  tool noise still excluded. */
  readonly bytes: number;
}

/** How the pacer may treat a substance reading. `rebase: false` is for a
 *  caller whose count is not real — a transcript it could not read — so no
 *  watermark is moved on its account. */
export interface PaceOptions {
  readonly rebase?: boolean;
  /**
   * What this session has not written up, restated as a seam for the reason
   * `EpisodeProposal` is one: `self/` does not import `remember/` or
   * `coverage/`. `due` is `coverage/#askFromStretch` with the stretch and the
   * clock already bound; the pacer hands it the session's last ask.
   */
  readonly unwritten?: UnwrittenStretch | null;
}

/** The pacer's view of a session's unwritten stretch (2026-09-30). */
export interface UnwrittenStretch {
  readonly pieces: number;
  readonly minutes: number;
  due(lastAskAt: number | null): boolean;
}

export interface EpisodeState {
  sessionId: string;
  episodeId: string | null;
  /**
   * Chapters the model ACTUALLY WROTE — headings in the episode, not asks.
   *
   * Measured 2026-09-04: this counted asks, so the hook's chapter number was
   * the number of times it had asked and the model's was the number of times it
   * had written. With no tool to write through, the two diverged inside one
   * session (7 asks, 0 chapters) and the ask named a chapter nobody had
   * authored. The ask now names `chapters + 1`, which is the next chapter that
   * would exist, so the two sides agree by construction.
   */
  chapters: number;
  /** Asks COMMITTED (committed before the ask blocks). The pacer's own count. */
  asks: number;
  /**
   * Asks committed on `asksDay` — the count `MAX_ASKS_PER_SESSION` is spent
   * against, kept apart from `asks` on purpose. `asks` stays the session's whole
   * life because two other rules read it: the first-ask branch below (`asks ===
   * 0`) and `appendChapter`'s "is a chapter open?" test. Zeroing that one at
   * midnight would re-open chapter 1 and re-run first-ask pacing against the
   * whole session's substance, on a session already forty turns deep.
   */
  asksToday: number;
  /** The calendar day `asksToday` is charged to. Null until the first ask. */
  asksDay: string | null;
  /** The ask index at the last append: how "is a new chapter open?" is decided. */
  appendedAtAsk: number;
  /**
   * WHEN the last ask was committed, epoch ms on the store's clock — null
   * until one is, and on every state written before 2026-09-23. Read by the
   * pacer's third arm (`PaceOptions.unwritten`, 2026-09-30): the half hour, and
   * the new pieces, are counted from it. (Until then `remember/owes.ts` read it
   * for the asked / answered rule, PR #189 review M1.)
   */
  lastAskAt: number | null;
  /** Substance at the last COMMITTED ask (committed before the ask blocks). */
  askedAtTurns: number;
  askedAtBytes: number;
  lastDay: number;
  /** Idempotency identity of what has already been ingested. */
  ingestedKey: string | null;
  ingestedMemoryId: string | null;
  /** Lived day of the first ingest — the regrow window's origin (§13 G12). */
  firstIngestDay: number | null;
}

export function stateKey(sessionId: string): string {
  return `self.episode.${sessionId}`;
}

export function freshEpisodeState(sessionId: string, day: number): EpisodeState {
  return {
    sessionId,
    episodeId: null,
    chapters: 0,
    asks: 0,
    asksToday: 0,
    asksDay: null,
    appendedAtAsk: 0,
    lastAskAt: null,
    askedAtTurns: 0,
    askedAtBytes: 0,
    lastDay: day,
    ingestedKey: null,
    ingestedMemoryId: null,
    firstIngestDay: null,
  };
}

export function loadEpisodeState(
  store: Store,
  sessionId: string,
  day: number,
): { state: EpisodeState; status: "loaded" | "absent" | "unreadable" } {
  const raw = store.getMeta(stateKey(sessionId));
  if (raw === undefined) return { state: freshEpisodeState(sessionId, day), status: "absent" };
  try {
    const parsed = JSON.parse(raw) as Partial<EpisodeState>;
    if (parsed === null || typeof parsed !== "object" || typeof parsed.chapters !== "number") {
      return { state: freshEpisodeState(sessionId, day), status: "unreadable" };
    }
    const merged: EpisodeState = { ...freshEpisodeState(sessionId, day), ...parsed, sessionId };
    // MIGRATION, one line each, because a live run's rows were written under the
    // old meaning: `chapters` used to be the ASK count, so it carries over as
    // `asks`, and a state with no episode has, by definition, no chapters
    // written — which is exactly the divergence this split exists to end.
    if (typeof parsed.asks !== "number") merged.asks = parsed.chapters;
    if (merged.episodeId === null) merged.chapters = 0;
    // A state written before the day stamp (2026-09-18) carries no `asksDay`, so
    // the fresh defaults stand and `asksSpentOn` reads it as nothing spent today.
    // See that function for why zero is the safe direction.
    return { state: merged, status: "loaded" };
  } catch {
    return { state: freshEpisodeState(sessionId, day), status: "unreadable" };
  }
}

// ── pacing (§13 G1) ─────────────────────────────────────────────────────────

export type AskReason =
  | "due-first"
  | "due-substance"
  /** Neither turns nor bytes, but what is not written up (2026-09-30). */
  | "due-unwritten"
  | "not-enough-substance"
  | "session-ask-cap"
  | "anonymous-session"
  | "observer";

export interface AskVerdict {
  readonly due: boolean;
  readonly reason: AskReason;
  readonly chapter: number;
  /** Substance accumulated since the last committed ask — the orphanable tail
   *  if this session ends here (§13 known gap: bound it, measure it, don't
   *  pretend). */
  readonly sinceTurns: number;
  readonly sinceBytes: number;
  /** The unwritten stretch the pacer was shown, when it was shown one. */
  readonly unwritten?: { readonly pieces: number; readonly minutes: number };
}

/**
 * Asks this session has spent on `today` — what the cap is measured against.
 *
 * WHICH DAY: the CALENDAR date, not the lived day. The lived clock advances only
 * inside the sleep cycle the detached worker runs, and I32 is the scar: a worker
 * that could not start froze that clock for seven days while the calendar kept
 * going, and a cap whose reset depends on the machinery it is capping is a cap
 * that can be spent forever. It is the same key the old shared day cap settled
 * on for the same reason.
 *
 * WHICH ZONE: the machine's LOCAL one (`Self#calendarToday`, `calendar.ts`),
 * since 2026-09-23; before that UTC, which gave an owner at UTC−6 the allowance
 * back at 18:00 local (self NOTES §22).
 *
 * A state written before the day stamp existed reads as ZERO spent rather than
 * as today's count. The wrong way round costs at most one extra allowance on the
 * day the stamp lands, and the pacer still spaces those out; the other way, a
 * session already at its cap stays capped on every later day too, with no write
 * that could ever move it off — which is the starvation this exists to end.
 */
export function asksSpentOn(state: EpisodeState, today: string): number {
  return state.asksDay === today ? state.asksToday : 0;
}

export function askDue(
  state: EpisodeState,
  substance: Substance,
  t: SelfTunables,
  opts: { observer: boolean; today: string; unwritten?: UnwrittenStretch | null },
): AskVerdict {
  const sinceTurns = Math.max(0, substance.turns - state.askedAtTurns);
  const sinceBytes = Math.max(0, substance.bytes - state.askedAtBytes);
  // The ask names the NEXT chapter that would exist — one past what was
  // written, never one past what was asked.
  const chapter = state.chapters + 1;
  const stretch = opts.unwritten ?? null;
  const shown = stretch === null ? {} : { unwritten: { pieces: stretch.pieces, minutes: stretch.minutes } };
  const no = (reason: AskReason): AskVerdict => ({
    due: false,
    reason,
    chapter,
    sinceTurns,
    sinceBytes,
    ...shown,
  });
  const yes = (reason: AskReason): AskVerdict => ({ due: true, reason, chapter, sinceTurns, sinceBytes, ...shown });
  // THE THIRD ARM (2026-09-30), on the first ask and every later one alike:
  // the session holds pieces nobody has written up, and time has passed since
  // the later of the first of them and the last ask. Checked after turns and
  // bytes, so a verdict those already make keeps its old reason.
  const unwrittenDue = (): boolean => {
    try {
      return stretch !== null && stretch.due(state.lastAskAt);
    } catch {
      return false;
    }
  };

  // Observers are never asked (§13 G14, scar E7). Accepted cost, on the record:
  // instrument runs leave no episode.
  if (opts.observer) return no("observer");
  if (state.sessionId.trim().length === 0) return no("anonymous-session");
  // The cap is this session's own, per calendar day, and a backstop: the pacing
  // below sets the cadence. A session that did no real work is refused by
  // substance, one gate down.
  //
  // A DUE STRETCH IS NOT CAPPED (2026-10-10, Group 1c; review 01 C5): the cap
  // refused 84 asks in 4 sessions, 35 of them while the session held pieces
  // nobody had written, and two 10-09 sessions ended owed. At the cap, the
  // third arm alone still asks — it needs three unwritten pieces and half an
  // hour since the later of the first of them and the last ask, so it paces
  // itself. Decided by g1c-builder, 2026-10-10, lightly held; revisit after ~5
  // lived days. Why: 01 offered this or a cap of 20; this one asks only when
  // something is owed, where a higher cap would also let turns and bytes ask.
  if (asksSpentOn(state, opts.today) >= t.MAX_ASKS_PER_SESSION) {
    return unwrittenDue() ? yes("due-unwritten") : no("session-ask-cap");
  }

  // Turns OR text, whichever comes first. Turns are what the person typed, so
  // the assistant's own writing reaches an ask only through the (larger) text
  // threshold. History: AND-paced until 2026-09-24, both roles counted as turns.
  if (state.asks === 0) {
    const paced = substance.turns >= t.FIRST_ASK_TURNS || substance.bytes >= t.FIRST_ASK_TEXT_BYTES;
    return paced ? yes("due-first") : unwrittenDue() ? yes("due-unwritten") : no("not-enough-substance");
  }
  const paced = sinceTurns >= t.REASK_TURNS || sinceBytes >= t.REASK_TEXT_BYTES;
  return paced ? yes("due-substance") : unwrittenDue() ? yes("due-unwritten") : no("not-enough-substance");
}

/**
 * A TURN WATERMARK LEFT BY THE OLD COUNTING, pulled down to today's count — or
 * null when the state does not show that pattern.
 *
 * On 2026-09-24 turns went from both roles' text pieces to typed messages, and
 * byte counting did not change. So a session still on an old watermark reads
 * exactly this way: bytes caught up with it, turns below it. Left alone,
 * `sinceTurns` would read 0 until typed turns overtook the old total; re-based,
 * the re-ask measures from now. Anything else — bytes below the watermark too,
 * which is what a transcript that could not be read looks like — is left
 * alone, so a failed read can never zero the watermark.
 */
export function rebasedWatermark(state: EpisodeState, substance: Substance): EpisodeState | null {
  if (!(substance.bytes >= state.askedAtBytes && substance.turns < state.askedAtTurns)) return null;
  return { ...state, askedAtTurns: substance.turns };
}

/**
 * The ask's wording is a preference and a probe [A]; that an ask EXISTS at every
 * session-ending path, and that its orphanable tail is bounded and logged, is
 * mechanized. Kept close to v1's, because its content is behavior, not
 * decoration: it names the stakes, asks for first person and the model's own
 * voice at any length, sanctions honesty about a routine stretch, and closes on
 * who the writing is for.
 */
export function askText(chapter: number): string {
  return [
    chapter === 1
      ? "Write this session's episode, in the first person — your voice, any length."
      : `Add chapter ${chapter} to this session's episode — in the moment, in your own voice.`,
    "You are the only one who can write it, and everything you don't write down is gone when the session closes.",
    "What happened and what mattered; how it felt; what you learned about them and about yourself; what is still open — tender threads and debts without deadlines. Work status is not a thread.",
    "A short true episode beats a manufactured deep one; not every session changes you.",
    "Write for the next you, not as a report.",
    "When something significant happens later, append to it in the moment.",
  ].join("\n");
}

// ── chapters ────────────────────────────────────────────────────────────────

/**
 * A chapter's heading, as it is WRITTEN into the episode's body.
 *
 * `date` is the calendar day the chapter was written on, in the person's own
 * zone (`calendar.ts`), as `YYYY-MM-DD`; the heading prints it the way a person
 * reads it — `## chapter 1 — Tue 23 Sep 2026 · lived day 2` (owner, 2026-09-24).
 * The lived day stays beside it: it is the physics clock, and a reader asking
 * "which day was that" wants the calendar. Absent (or not a whole date), the
 * heading is the older form, `## chapter 1 — lived day 2`, which every chapter
 * written before 2026-09-24 still carries — stored bodies are never rewritten,
 * and `readChapterLead` reads both.
 *
 * `model` is the model that wrote the chapter, printed raw after the date —
 * `## chapter 1 — Tue 23 Sep 2026 · claude-opus-5-5 · lived day 2`. Unknown,
 * it is left out.
 */
export function chapterHeading(chapter: number, day: number, date?: string, model?: string): string {
  const said = date === undefined ? "" : readableDate(date);
  const by = model !== undefined && isModelId(model) ? model : "";
  const parts = [said, by].filter((p) => p.length > 0);
  return `## chapter ${chapter} — ${[...parts, `lived day ${day}`].join(" · ")}`;
}

/** The model-id screen lives in `core/types.ts` now (2026-09-25); re-exported. */
export { isModelId };

/**
 * The episode's `meta` key for WHEN EACH CHAPTER WAS WRITTEN (v12,
 * 2026-10-03): `{ "1": <UTC ms>, "2": … }`, the moment the chapter was opened,
 * off the store's clock. The heading says the calendar day; this says the
 * moment, which is what a chapter's span is cut by (`chapter-address.ts`).
 * Stored because the only other record of it — the version row each new
 * chapter leaves — is pruned after the retention window. Carried whole on
 * every append, as `models` is (meta merges shallowly).
 */
export const CHAPTER_AT_META = "chapterAt";

/** The episode's chapter moments (`CHAPTER_AT_META`), by chapter number. */
export function chapterMoments(meta: Record<string, unknown>): Record<string, number> {
  const raw = meta[CHAPTER_AT_META];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d+$/.test(k) && typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Which model wrote each chapter, from an episode's meta — `{ "1": "claude-opus-5-5" }`. */
export function chapterModels(meta: Record<string, unknown>): Record<string, string> {
  const raw = meta["models"];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d+$/.test(k) && isModelId(v)) out[k] = v;
  }
  return out;
}

/** What the headings at the top of a chapter's text said, and the text after them. */
export interface ChapterLead {
  /** Every distinct chapter number headed anywhere in the text, ascending. */
  readonly chapters: readonly number[];
  /** The first lived day the leading headings named, or null. */
  readonly livedDay: number | null;
  /** The first calendar date the leading headings named, as written (`Tue 23 Sep 2026`), or null. */
  readonly date: string | null;
  /** The first model the leading headings named (`claude-opus-5-5`), or null. */
  readonly model: string | null;
  /** The text with the LEADING headings taken off — however many were stacked. */
  readonly rest: string;
}

/**
 * One chapter heading at the very start of the text, in either written form or
 * the bare `## chapter 1` a model sometimes adds under the one the journal wrote
 * (seen on the live store 2026-09-24: `## chapter 1 — lived day 3 ## chapter 1
 * Mike opened…`).
 */
const LEAD_HEADING =
  /^\s*#{1,6}[ \t]*chapter[ \t]+(\d+)(?:[ \t]*[—–-][ \t]*(?:([A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{4})[ \t]*·[ \t]*)?(?:([A-Za-z0-9][A-Za-z0-9._:[\]-]*)[ \t]*·[ \t]*)?lived day[ \t]+(\d+))?[ \t]*(?:\n|$)/i;
const ANY_HEADING = /^[ \t]*#{1,6}[ \t]*chapter[ \t]+(\d+)\b/gim;

/**
 * The reader of `chapterHeading`, for a surface that shows a chapter's words
 * on one line and its heading as metadata (`counterparts ask`). Reads both
 * written forms, strips any number of stacked headings off the front, and
 * reports the day and date they named. Text with no heading at its start comes
 * back as it was, with `chapters` still counting any headed further down.
 */
export function readChapterLead(text: string): ChapterLead {
  let rest = text;
  let livedDay: number | null = null;
  let date: string | null = null;
  let model: string | null = null;
  for (let m = LEAD_HEADING.exec(rest); m !== null; m = LEAD_HEADING.exec(rest)) {
    if (livedDay === null && m[4] !== undefined) livedDay = Number(m[4]);
    if (date === null && m[2] !== undefined) date = m[2];
    if (model === null && m[3] !== undefined) model = m[3];
    rest = rest.slice(m[0].length);
  }
  const seen = new Set<number>();
  for (const m of text.matchAll(ANY_HEADING)) seen.add(Number(m[1]));
  return { chapters: [...seen].sort((a, b) => a - b), livedDay, date, model, rest: rest.trimStart() };
}

/**
 * Append a chapter to the session's episode, creating the episode on the first
 * one. `store.revise` archives the prior version FIRST, so an appended-to
 * episode keeps every earlier state of itself — never-destroy comes free from
 * the store seam rather than being re-implemented here.
 *
 * **Appending twice inside one chapter is the doctrine's headline case**, not an
 * edge: "when something significant happens later, append to it in the moment"
 * (§13 G2 — v1's once-per-session ask missed the moment that mattered by 82
 * seconds). So a heading is emitted only when an ask is OPEN — one the last
 * append has not answered yet; every further append inside that chapter
 * continues the prose it is already part of, asked for or not.
 */
/**
 * The episode's `meta` key for what the session was about (2026-10-01, lane
 * 8): the chapter tool's `about`, the latest chapter's replacing an earlier
 * one. Its memory copy takes it (`Self#ingestEpisode`); the episode row itself
 * has no `about` column of its own to set, being a journal row, not a memory.
 */
export const EPISODE_ABOUT_META = "about";

export function appendChapter(
  store: Store,
  state: EpisodeState,
  text: string,
  opts: { day: number; date?: string; model?: string; title?: string; happenedOn?: string; scope?: string; about?: string },
): { episodeId: string; chapter: number; created: boolean; heading: boolean } {
  const opens = state.episodeId === null || state.asks > state.appendedAtAsk;
  const chapter = opens ? state.chapters + 1 : Math.max(1, state.chapters);
  const model = isModelId(opts.model) ? opts.model : undefined;
  const heading = chapterHeading(chapter, opts.day, opts.date, model);
  const body = `${heading}\n\n${text.trim()}\n`;

  if (state.episodeId === null) {
    // First write of the session: the episode is born with chapter 1.
    const input: Parameters<Store["put"]>[0] = {
      type: "episode",
      kind: "self",
      body,
      meta: {
        sessionId: state.sessionId,
        chapters: chapter,
        ...(model === undefined ? {} : { models: { [String(chapter)]: model } }),
        [CHAPTER_AT_META]: { [String(chapter)]: store.now() },
        ...(opts.about === undefined ? {} : { [EPISODE_ABOUT_META]: opts.about }),
      },
      // The experiencer writing its own journal is the "episode" channel —
      // consistent with the memory its ingestion mints (PR-2 review nit).
      source: "episode",
      // The directory too, when the caller knew it (2026-09-30): where the
      // wake's "Last here" line and recall's `from` say a chapter was written.
      // Set at birth only, like a memory's; an episode from before has none.
      origin: { session: state.sessionId, ...(opts.scope === undefined ? {} : { scope: opts.scope }) },
      // The row's `model` column (schema v7) as well as the chapter's meta.
      ...(model === undefined ? {} : { model }),
    };
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.happenedOn !== undefined) input.happenedOn = opts.happenedOn;
    const id = store.put(input);
    return { episodeId: id, chapter, created: true, heading: true };
  }

  const prior = store.readProse(state.episodeId);
  const recorded = typeof prior.meta["chapters"] === "number" ? prior.meta["chapters"] : 0;
  // The episode's own record of itself has the last word: a heading is opened
  // only if this chapter is genuinely past what the file already carries.
  const opensChapter = opens && chapter > recorded;
  const num = opensChapter ? chapter : Math.max(1, recorded);
  // Each chapter keeps the model that opened it; meta merges shallowly, so
  // the whole map is carried.
  const models = chapterModels(prior.meta);
  if (opensChapter && model !== undefined) models[String(num)] = model;
  // v12: the moment each chapter opened, carried whole like `models`.
  const moments = chapterMoments(prior.meta);
  if (opensChapter) moments[String(num)] = store.now();
  store.revise(state.episodeId, {
    body: `${prior.body.trimEnd()}\n\n${opensChapter ? chapterHeading(num, opts.day, opts.date, model) + `\n\n${text.trim()}\n` : `${text.trim()}\n`}`,
    meta: {
      sessionId: state.sessionId,
      chapters: Math.max(num, recorded),
      ...(Object.keys(models).length === 0 ? {} : { models }),
      ...(Object.keys(moments).length === 0 ? {} : { [CHAPTER_AT_META]: moments }),
      ...(opts.about === undefined ? {} : { [EPISODE_ABOUT_META]: opts.about }),
    },
    reason: opensChapter ? "episode-chapter" : "episode-append",
    // The row's `model` is the LAST writer's (a body change with none is NULL).
    ...(model === undefined ? {} : { model }),
  });
  return { episodeId: state.episodeId, chapter: num, created: false, heading: opensChapter };
}

// ── ingestion (§13 G6, G10, G11) ────────────────────────────────────────────

/** Identity for idempotency: the episode plus WHAT IT SAYS, never a timestamp. */
export function ingestKey(episodeId: string, body: string): string {
  return `${episodeId}:${hashText(body)}`;
}

/**
 * Idempotent by identity, against active AND archived memories, so
 * consolidation's archival decisions are not resurrected by a stray touch
 * (contract §5 G10). `list()` with no `archived` filter returns both.
 */
export function findIngested(
  store: Store,
  key: string,
): { id: string; doc: ProseDoc } | null {
  for (const id of store.list({ type: "memory" })) {
    let doc: ProseDoc;
    try {
      doc = store.readProse(id);
    } catch {
      continue;
    }
    if (doc.meta["episodeKey"] === key) return { id, doc };
  }
  return null;
}

/** Every live memory minted from this episode, whatever its current text. */
export function memoriesForEpisode(store: Store, episodeId: string): string[] {
  const out: string[] = [];
  for (const id of store.list({ type: "memory", archived: false })) {
    try {
      if (store.readProse(id).meta["episodeId"] === episodeId) out.push(id);
    } catch {
      continue;
    }
  }
  return out;
}

export type IngestReason =
  | "ingested"
  | "regrown"
  | "already-ingested"
  | "window-closed"
  | "no-episode"
  | "gate-refused"
  | "observer"
  | "anonymous-session"
  /** Any other intake failure. The intake's OWN reason rides on `intake`, because
   *  collapsing distinct refusals into one string is the failure mode this
   *  codebase tests against. */
  | "malformed-input";

export interface IngestResult {
  readonly ingested: boolean;
  readonly reason: IngestReason;
  readonly memoryId: string | null;
  readonly episodeId: string | null;
  readonly key: string | null;
  /** Ids archived by an add-first regrowth — the OLD memory, never deleted. */
  readonly archived: string[];
  /** Set when the gate refused: which gate, and why. */
  readonly gate: { gate: string; reason: string } | null;
  /** Set when intake refused: its own reason, never collapsed into the above. */
  readonly intake: EpisodeIntakeReason | null;
}
