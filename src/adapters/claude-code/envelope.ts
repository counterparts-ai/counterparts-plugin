/**
 * THE HOOK ENVELOPE'S SHAPE, in one place (2026-09-29, review of #285, S2).
 *
 * `hostDelivery` (below) prints it. A person-facing line (a plain
 * reminder, a doctor notice) reaches the terminal only inside this JSON form.
 * Since 2026-10-10 each of its fields is measured on its own against
 * `TUNABLES.HOST_OUTPUT_CHARS`, as the host measures it (`fieldsFit`, below),
 * so `hooks.ts` sizes the model's text the same way in either form and no
 * longer measures the escaped object (`escapedBytes` went with that).
 *
 * WHAT GOES OUT ON A TURN, too (2026-10-22, lane L): `deliverTurn`,
 * `hostDelivery` and their doors moved here from `bin/hook.ts`, unchanged, so
 * the package's public entry (`index.ts`) can export them without importing
 * the hook's entry script and its top-level work. `bin/hook.ts` imports them
 * back and re-exports them, so `bin/hook.ts#deliverTurn` still names them.
 */

import type { PlainReminder } from "../../core/counterpart.js";
import type { DreamOffer } from "../../core/dream/index.js";
import { TUNABLES } from "../config.js";
import { STOP_HUMAN_LINE, plainLine, withoutDream, withoutDreamNote, withoutPlain } from "./hooks.js";
import type { DreamTold, HookInput, HookName } from "./hooks.js";

/**
 * The host's own spelling of the event that carries a notice at a session's
 * start. It appears twice — as a key in the hook's event map, and as
 * `hookSpecificOutput.hookEventName` in the JSON form — and the host matches
 * that field against its own name, so the two spellings must be one constant.
 */
export const HOST_SESSION_START = "SessionStart";

/** The same, for a prompt (the update notice, plain reminders, the dream offer). */
export const HOST_USER_PROMPT_SUBMIT = "UserPromptSubmit";

/** The JSON form of an envelope: the person's line(s) and the model's context. */
export function envelopeJson(hookEventName: string, systemMessage: string, additionalContext: string): string {
  return JSON.stringify({
    systemMessage,
    hookSpecificOutput: { hookEventName, additionalContext },
  });
}

/**
 * WHAT THE JSON FORM MUST FIT: EACH FIELD, NOT THE WHOLE ENVELOPE (measured
 * 2026-10-10 on Claude Code 2.1.296; adapter NOTES, "The notice is capped").
 *
 * The host's cap (https://code.claude.com/docs/en/hooks#json-output): "A hook's
 * `additionalContext`, `systemMessage`, and `initialUserMessage` strings, and
 * its plain stdout, are capped at 10,000 characters … For JSON output, each
 * field is measured separately; plain stdout is measured whole." Measured: a
 * 10,488-character envelope in this hook's own shape (`systemMessage` 376,
 * `additionalContext` 9,910) and a 12,637-character escape-heavy one both
 * parsed, every field whole; a field past 10,000 is previewed and the JSON
 * still parses. So the JSON form's escaping costs nothing: what must fit is
 * the model's text and the person's line, each under `TUNABLES.HOST_OUTPUT_CHARS`
 * (the one place the host's number lives), in characters, as the host counts.
 *
 * Until then (2026-09-14) the rule was 9,500 characters of WHOLE envelope —
 * read from the same docs as fatal past 10,000, since a previewed object would
 * no longer parse — so on a full-wake day the notice was dropped though both
 * fields fit. Now the notice is kept whenever both fields fit, and the fallback
 * is still the plain wake: a notice that does not fit is dropped, never the
 * memory, and `counterparts doctor` still prints it.
 */
function fieldsFit(context: string, message: string): boolean {
  return context.length <= TUNABLES.HOST_OUTPUT_CHARS && message.length <= TUNABLES.HOST_OUTPUT_CHARS;
}

/**
 * HOW A DUE STOP ASK LEAVES THIS PROCESS — ONE shape (owner, 2026-09-24).
 *
 * Exit 0 and one JSON object on stdout:
 *
 *     {"systemMessage": <the person's line>,
 *      "hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": <the model's ask>}}
 *
 * The host's reference (https://code.claude.com/docs/en/hooks, read
 * 2026-09-24), Stop decision control: `hookSpecificOutput.additionalContext` is
 * "Non-error feedback for Claude. The conversation continues so Claude can act
 * on it, but unlike `decision: "block"` it is shown in the transcript as hook
 * feedback rather than a hook error" — and "It keeps the conversation going
 * through the same loop protections as `decision: "block"`, namely the
 * `stop_hook_active` input and the 8-consecutive-continuation cap". It stands
 * alone: no `decision` beside it.
 *
 * WHY THIS ONE. B1 (2026-09-23) built two shapes behind a `stopAskShape`
 * switch — the JSON `decision: "block"` and the day-0 stderr + exit 2 — and the
 * owner looked at both in a real terminal on 0.3.0: both printed the model's
 * two lines as `Stop hook error: …`, so both read as an error. This is the
 * third route, the one the docs call non-error; the switch and both earlier
 * shapes are gone. A `claude-code.json` that still carries `stopAskShape` is
 * read fine, the key ignored and named among the old settings (`config.ts`).
 *
 * What the person sees is NOT only their own line: the host's 2.1.281 bundle
 * renders an additionalContext on Stop under "Ran 1 stop hook" as
 * `Stop hook feedback: <ask>`, in the notice colour rather than the error one.
 * Quieter, not silent. `../NOTES.md` §"The Stop ask's shapes" has the record.
 */
export const HOST_STOP = "Stop";

/** The two adapter doors `deliverTurn` needs — structural, so a test can
 *  hand it doors that throw. */
export interface UpdateNoticeDoors {
  updateNotice(input: HookInput): string | null;
  markUpdateNotice(input: HookInput): boolean;
  /**
   * Claim plain reminders this delivery is certainly about to show, returning
   * the ones claimed (`ClaudeCodeAdapter#claimPlain`). Absent: nothing can be
   * claimed, so nothing is shown and every one waits for a later turn.
   */
  claimPlain?(input: HookInput, due: readonly PlainReminder[]): readonly PlainReminder[];
  /**
   * Claim the day's dream line this delivery is certainly about to show
   * (`ClaudeCodeAdapter#claimDream`). Absent: nothing can be claimed, so the
   * line is not shown and waits for a later prompt.
   */
  claimDream?(input: HookInput, offer: DreamOffer): boolean;
  /**
   * Claim a HELD dream line — a run a session nobody watched started — this
   * delivery is certainly about to show (`ClaudeCodeAdapter#claimHeld`,
   * 2026-10-01). Absent: nothing can be claimed, so it waits.
   */
  claimHeld?(input: HookInput, run: string): boolean;
  /** Claim the one-time line about `auto` set back to `ask` (`ClaudeCodeAdapter#claimDreamNote`). */
  claimDreamNote?(input: HookInput): boolean;
  /**
   * Record what this delivery left for later for want of ROOM — `plain`
   * reminders (how many), the `dream` offer, the `update-notice`
   * (`ClaudeCodeAdapter#noteGaveWay`). Absent: nothing is recorded.
   */
  noteGaveWay?(input: HookInput, part: string, count: number): void;
}

/**
 * THIS EVENT'S OUTPUT, WITH PLAIN REMINDERS AND THE UPDATE NOTICE FOLDED IN
 * FAIL-OPEN (roadmap E; #187 re-review, N4; 2026-09-26 review).
 *
 * PLAIN REMINDERS FIRST, and under the update notice's own rule — MARK ONLY
 * WHAT IS CERTAINLY LEAVING. A plain beat is spent once and never comes back,
 * so it is claimed only after the envelope is known to carry its line to the
 * terminal, and it goes ahead of every other notice (the doctor's red line
 * returns at the next start; the beat would not). A turn with no room — a full
 * wake at SessionStart — claims nothing and strips the lines from the model's
 * context too (`withoutPlain`), so the first prompt, whose envelope is small,
 * says them instead. A line whose claim is lost to another process is stripped
 * the same way.
 *
 * Then the update notice: the delivery without it is the answer whenever
 * anything about it goes wrong — a door that throws, a mark that will not
 * land, an envelope with no room for it — so it can never cost a line that
 * already fit. It is MARKED only once it is certainly leaving and SHOWN only if
 * the mark landed, so it never repeats and is never marked-but-lost; a turn
 * whose recall leaves no room marks nothing and tries again next turn.
 */
export function deliverTurn(
  name: HookName,
  result: {
    injection: string | null;
    ask: string | null;
    notices?: readonly string[];
    plain?: readonly PlainReminder[];
    dream?: DreamTold;
    dreamNote?: { notice: string; context: string };
  },
  payload: Record<string, unknown>,
  /** SessionStart's priority-ordered notices (after any plain reminders), or
   *  null. At a prompt, null: the plain lines come from `result.plain`. */
  notices: readonly (string | null)[] | null,
  doors: UpdateNoticeDoors,
  input: HookInput,
): Delivery {
  let r = result;
  let ordered = notices;
  let deferred: Delivery["dropped"] = null;
  const due = result.plain ?? [];
  if (due.length > 0) {
    // The longest run, in order, whose lines the envelope carries: a day with
    // more plain items than room says what fits and keeps the rest for later.
    let fits = 0;
    for (let k = due.length; k > 0; k--) {
      const probe = hostDelivery(name, r, payload, [due.slice(0, k).map(plainLine).join("\n")]);
      if (probe.dropped === null) {
        fits = k;
        break;
      }
      if (k === due.length) deferred = probe.dropped;
    }
    let claimed: readonly PlainReminder[] = [];
    if (fits > 0) {
      try {
        claimed = doors.claimPlain?.(input, due.slice(0, fits)) ?? [];
      } catch {
        claimed = [];
      }
    }
    // By the beat's identity, not the object's: a door may hand back copies.
    const beat = (x: PlainReminder): string => `${x.memoryId} ${x.windowKey} ${x.beat}`;
    const kept = new Set(claimed.map(beat));
    const shownPlain = due.filter((d) => kept.has(beat(d)));
    // WHAT GAVE WAY, as delivered: the reminders the envelope had no room for
    // (a lost claim race is not room, and is recorded by `claimPlain`).
    if (fits < due.length) gaveWay(doors, input, "plain", due.length - fits);
    r = withoutPlain(r, due.filter((d) => !kept.has(beat(d))));
    if (shownPlain.length > 0) ordered = [shownPlain.map(plainLine).join("\n"), ...(notices ?? [])];
  }
  // THE DAY'S DREAM LINE (2026-09-29), after the plain reminders and under
  // their rule: an ask is CLAIMED only once the envelope is known to carry the
  // person's line, and without room it waits — its model line stripped too, so
  // the model never answers a question the person was not shown. A line whose
  // day is already claimed (the headless run has started) keeps its model line
  // and only loses the terminal one.
  const told = r.dream;
  if (told !== undefined) {
    const probe = hostDelivery(name, r, payload, [...(ordered ?? []), told.notice]);
    let showDream = false;
    if (probe.dropped === null) {
      if (told.held !== undefined) {
        try {
          showDream = doors.claimHeld?.(input, told.held) ?? false;
        } catch {
          showDream = false;
        }
      } else if (told.offer === null) showDream = true;
      else {
        try {
          showDream = doors.claimDream?.(input, told.offer) ?? false;
        } catch {
          showDream = false;
        }
      }
    } else {
      if (deferred === null) deferred = probe.dropped;
      gaveWay(doors, input, "dream", 1);
    }
    if (showDream) ordered = [...(ordered ?? []), told.notice];
    else if (told.offer !== null || told.held !== undefined) r = withoutDream(r);
  }
  // THE ONE-TIME RESET LINE (owner decision A), under the same rule.
  const note = r.dreamNote;
  if (note !== undefined) {
    const probe = hostDelivery(name, r, payload, [...(ordered ?? []), note.notice]);
    let shownNote = false;
    if (probe.dropped === null) {
      try {
        shownNote = doors.claimDreamNote?.(input) ?? false;
      } catch {
        shownNote = false;
      }
    } else if (deferred === null) {
      deferred = probe.dropped;
    }
    if (shownNote) ordered = [...(ordered ?? []), note.notice];
    else r = withoutDreamNote(r);
  }
  const shown = hostDelivery(name, r, payload, ordered);
  const base = shown.dropped === null && deferred !== null ? { ...shown, dropped: deferred } : shown;
  if (name !== "user-prompt-submit") return base;
  try {
    const update = doors.updateNotice(input);
    if (update === null) return base;
    const carried = hostDelivery(name, r, payload, [...(ordered ?? []), update]);
    if (carried.dropped !== null) {
      gaveWay(doors, input, "update-notice", 1);
      return { ...base, dropped: base.dropped ?? carried.dropped };
    }
    return doors.markUpdateNotice(input) ? carried : base;
  } catch {
    return base;
  }
}

/** `doors.noteGaveWay`, fail-open: a record that cannot be made costs nothing. */
function gaveWay(doors: UpdateNoticeDoors, input: HookInput, part: string, count: number): void {
  try {
    doors.noteGaveWay?.(input, part, count);
  } catch {
    /* bookkeeping */
  }
}

/**
 * How each hook's output reaches the model on THIS host — measured, not
 * assumed (scar §2.18), on day 0 of the parallel run (2026-09-03):
 *
 *   - SessionStart / UserPromptSubmit: plain stdout with exit 0 is added to the
 *     model's context. The wake (8,859 B) arrived that way.
 *   - Stop: plain stdout with exit 0 reaches NOBODY. An ask written that way
 *     was recorded (`adapter.episode.ask asked:true`) and never seen. The one
 *     channel proven on this host is the blocking one bansai has used all along:
 *     the text on STDERR and exit code 2, which the host feeds back to the model
 *     as "Stop hook feedback" and lets it continue. The host then re-fires Stop
 *     with `stop_hook_active: true`; that re-fire must ask NOTHING or the ask
 *     loops forever (v1's anti-loop, kept here for the same reason).
 *     **Since 2026-09-24 the ask leaves by the host's documented NON-ERROR
 *     route instead** (`HOST_STOP` above): exit 0, the model's ask as
 *     `hookSpecificOutput.additionalContext`, one line for the person as
 *     `systemMessage`. Same continuation, same re-fire, same refusal of it.
 *
 * **The fourth channel, added 2026-09-14 for I32: `systemMessage`.** Documented
 * at https://code.claude.com/docs/en/hooks (formerly
 * docs.claude.com/en/docs/claude-code/hooks) and measured by the owner's own
 * probe on 2026-09-11: a SessionStart hook that exits 0 and prints JSON with a
 * top-level `systemMessage` gets that text DISPLAYED in the terminal
 * (`SessionStart:startup says: …`), non-blocking, while `additionalContext` and
 * stderr do not show. The doc also states the rule that makes this safe or
 * dangerous depending on which form you print: **when stdout parses as JSON the
 * raw stdout is NOT also added to context** — only the JSON's fields are. So the
 * wake must ride ENTIRELY in `hookSpecificOutput.additionalContext`, byte for
 * byte what plain stdout would have carried, and a day with nothing red prints
 * the plain form it has printed since day 0 rather than a JSON wrapper nobody
 * has measured on this host.
 *
 * Pure, so the test proves the channel choice without a process. `dropped` is
 * how a pure function reports the one thing it cannot do itself: the caller
 * turns it into the ring row that makes a silent terminal explicable.
 */
export interface Delivery {
  readonly stdout: string;
  readonly stderr: string;
  /** Always 0 since 2026-09-24: no event leaves by exit 2 any more. */
  readonly exitCode: 0;
  /** Non-null when a notice was left out to keep the wake whole — all of them,
   *  or (with several) the lower ones that no longer fit. */
  readonly dropped: { readonly noticeChars: number; readonly envelopeChars: number; readonly limitChars: number } | null;
  /**
   * THE PLAIN FALLBACK, CHECKED (2026-09-29, audit item 9). Set when the plain
   * stdout this prints is itself past the host's cap (`HOST_OUTPUT_CHARS`), so
   * the host will show a preview in its place. A TRIPWIRE, not a cut: by here
   * the asks are already marked as delivered and this function cannot tell a
   * wake from an ask, so it reports and the caller records it. The adapter's
   * one budget per envelope is what keeps it from happening; what can still
   * reach it is a wake composed past the cap by a misconfigured budget.
   */
  readonly overCap?: { readonly chars: number; readonly limitChars: number };
}

/** The plain form of an envelope, with the over-cap tripwire read. */
function plainOut(out: string, dropped: Delivery["dropped"]): Delivery {
  const chars = out.length;
  return chars > TUNABLES.HOST_OUTPUT_CHARS
    ? { stdout: out, stderr: "", exitCode: 0, dropped, overCap: { chars, limitChars: TUNABLES.HOST_OUTPUT_CHARS } }
    : { stdout: out, stderr: "", exitCode: 0, dropped };
}

export function hostDelivery(
  name: HookName,
  result: { injection: string | null; ask: string | null },
  payload: Record<string, unknown>,
  /**
   * The owner-facing line(s), or null: SessionStart's doctor notice and
   * registry line, UserPromptSubmit's update notice (roadmap E); every other
   * event ignores it. At SessionStart a LIST is a priority order (review M1):
   * each is added only while the envelope still fits, so a lower line can never
   * cost a higher one its place. At a prompt the lines are ALL OR NOTHING —
   * joined into one `systemMessage`, or all dropped — which is what lets
   * `deliverTurn` mark only an envelope that carried them; since 2026-09-26 that is plain reminders and the update notice.
   */
  notice: string | null | readonly (string | null)[] = null,
): Delivery {
  const ask = result.ask !== null && result.ask.length > 0 ? result.ask : null;
  if (name !== "stop") {
    const out = [result.injection ?? "", ask ?? ""].filter((s) => s.length > 0).join("\n\n");
    const notices = (typeof notice === "string" || notice === null ? [notice] : notice).filter(
      (n): n is string => n !== null && n.length > 0,
    );
    if (name === "session-start" && notices.length > 0) {
      const envelopeOf = (message: string): string => envelopeJson(HOST_SESSION_START, message, out);
      // THE WAKE WINS. Each field must fit the host's cap on its own
      // (`fieldsFit`): a wake past it is previewed in either form, and then the
      // plain form is printed and `overCap` says so. The notices go in in the
      // order given, each only while the person's field still fits.
      // `envelopeChars` stays what it was, the whole object's length — a fact
      // for the record, no longer the test.
      const kept: string[] = [];
      const left: string[] = [];
      for (const n of notices) {
        if (fieldsFit(out, [...kept, n].join("\n"))) kept.push(n);
        else left.push(n);
      }
      const dropped =
        left.length === 0
          ? null
          : {
              noticeChars: left.join("\n").length,
              envelopeChars: envelopeOf(notices.join("\n")).length,
              limitChars: TUNABLES.HOST_OUTPUT_CHARS,
            };
      if (kept.length === 0) return plainOut(out, dropped);
      return { stdout: envelopeOf(kept.join("\n")), stderr: "", exitCode: 0, dropped };
    }
    // THE UPDATE NOTICE, AT A PROMPT (roadmap E, 2026-09-23) — the same
    // envelope and the same rule: the turn's recall rides whole in
    // `additionalContext` or the notice waits. A turn with no recall prints the
    // `systemMessage` alone rather than an empty context field. A prompt with
    // no notice prints what it always has — plain text, or nothing. More than
    // one line would be JOINED into the one `systemMessage` an object carries,
    // never one replacing another, and dropped all together or not at all —
    // not SessionStart's priority order; since 2026-09-26 the plain reminders and the update notice (`deliverTurn` tries the two together and falls back to the first alone).
    if (name === "user-prompt-submit" && notices.length > 0) {
      const message = notices.join("\n");
      const envelope = JSON.stringify({
        systemMessage: message,
        ...(out.length === 0
          ? {}
          : { hookSpecificOutput: { hookEventName: HOST_USER_PROMPT_SUBMIT, additionalContext: out } }),
      });
      if (!fieldsFit(out, message)) {
        return plainOut(out, { noticeChars: message.length, envelopeChars: envelope.length, limitChars: TUNABLES.HOST_OUTPUT_CHARS });
      }
      return { stdout: envelope, stderr: "", exitCode: 0, dropped: null };
    }
    return plainOut(out, null);
  }
  // The re-fire is refused twice on purpose: the adapter asks nothing on it, and
  // this channel would not carry it even if something did.
  if (payload["stop_hook_active"] === true || ask === null) {
    return { stdout: "", stderr: "", exitCode: 0, dropped: null };
  }
  // EXIT 0, and NO `decision`: `additionalContext` on Stop continues the turn on
  // its own, as non-error feedback (the docblock at `HOST_STOP`). Exit 2 would
  // make STDERR a blocking error again, and a `decision: "block"` beside it
  // would bring back the `Stop hook error:` line this route exists to avoid.
  // One line, no trailing newline, so the whole of stdout is the object. The
  // ask is ~430 characters, far inside the host's 10,000-character cap.
  return {
    stdout: JSON.stringify({
      systemMessage: STOP_HUMAN_LINE,
      hookSpecificOutput: { hookEventName: HOST_STOP, additionalContext: ask },
    }),
    stderr: "",
    exitCode: 0,
    dropped: null,
  };
}
