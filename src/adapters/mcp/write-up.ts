/**
 * THE WRITE-UP DOOR — how a live session writes up a session that ended before
 * it was written up (roadmap C2, owner 2026-09-23).
 *
 * The SessionStart hook (`claude-code/hooks.ts`, through `lifecycle.ts#deliverWriteUpAsk`) points the
 * next session in a project at the oldest session there that owes a write-up.
 * Everything else happens here, through a `writeUp` FIELD on `session_end`
 * naming the ended session, beside the ordinary `session` (the live one, bound
 * exactly as every `session_end` is):
 *
 *   - **FETCH** — `writeUp` and NO `memories` (or `memories: []` before any
 *     fetch is on record — a host that honours a schema's `required` sends
 *     that, PR #192 review m2): the next unwritten part of that session's
 *     captured words IN THIS PROJECT, up to `WRITE_UP_PART_BYTES` (~24 KB), and
 *     the part is recorded as handed to THIS session (`writeUpFor`).
 *     The words travel here rather than beside the wake because an MCP result
 *     is not under the host's 10,000-character cap on a hook's output
 *     (`claude-code/INTERFACE-GAPS` §15). One part per session: a session that
 *     has answered its part is not handed the next — that comes at a later
 *     start. Fetching again before answering hands the same part back.
 *   - **ANSWER** — `writeUp` WITH `memories`, for the part last fetched. Each
 *     entry takes `session_end`'s own road (gate battery, redaction, authored
 *     channel, per-entry isolation) under the WRITING session's name. An EMPTY
 *     batch is a real answer here too — "nothing worth keeping", the rule the
 *     ordinary `session_end` follows — and closes the part without minting. The
 *     LAST part's answer marks the ended session written up through B3's seam,
 *     `by: "next-session"`, which starts its seven-day retention clock; how it
 *     was answered (`memories` / `nothing-new`) is recorded on the writing
 *     session's record. A write-up's memories claim NO coverage of the
 *     writer's own words (MAJOR 4): through core's `SessionEndDepositContext.cover` seam
 *     they claim nothing on an earlier part, and the ENDED session's words here
 *     on the last one.
 *
 * **One project's words at a time** (MAJOR 6). A session that left words under
 * two projects is written up in each by a session there: a writer here is
 * served, and closes, only the words filed here. The session is marked written
 * up — which B3 reads for the whole session — only when the last project's
 * share comes back; until then the finished shares wait (`waiting`).
 *
 * **A field, not a sibling tool,** and the field can be made safe: the call is
 * diverted HERE before `session_end` reads anything else, so a write-up never
 * writes a handoff and never marks the writing session "nothing new". A sibling
 * tool would have cost every person who allowlisted the server's tools one by
 * one a new approval, and the test suite pins the tool list exactly.
 *
 * **It is one of the two importers of the write-up mark** outside `remember/`
 * (`test/cli.test.ts` pins it; the other is the worker's API sweep), because
 * the mark is a deletion on a seven-day fuse. So everything below exists to
 * make sure the mark is only set on a session that owed it, by a session that
 * was handed its words.
 *
 * **What it refuses, each by name** (a refusal writes nothing — no memory, no
 * progress, no mark):
 *
 *   - `handoff-not-accepted` — a `handoff` (or a `retireHandoff`) beside
 *     `writeUp`: the pointer is THIS directory's, written by the live session
 *     for itself;
 *   - `unknown-session` — not an id, or one the hooks never recorded and the
 *     buffer holds no words for;
 *   - `live-session` — this session's own id, or one still at work (it
 *     captured something today and has not ended — `core/coverage/`);
 *   - `other-project` — ended in another directory;
 *   - `already-written-up` — so a second write-up of the same id is refused;
 *   - `owes-nothing` — `core/coverage/`'s rule says it owes nothing (`why`:
 *     below-threshold, answered, lapsed, no-text);
 *   - `not-asked` — a fetch for a session the hook did not point this one at,
 *     or memories from a session that fetched nothing of it;
 *   - `wrong-part` — an answer naming a part other than the one fetched;
 *   - `part-already-written` — the part this session fetched already came back
 *     (the next one comes at a later start);
 *   - `memories-required` — `memories` present and not a list;
 *   - `nothing-landed` — every entry of a non-empty batch was refused by the
 *     gate battery (a duplicate counts as landed: the store already holds it);
 *   - `io-failed` — the fetch could not record that it handed the part over,
 *     so it hands nothing (an answer would be refused `not-asked`).
 *
 * The first six are `sessions.ts#writeUpStanding` — the same function the
 * hook's pointer filters with, so the pointer never names a session the door
 * would refuse.
 *
 * **The granted path** (2026-09-30, the shape agreed with build 3, desktop-chat
 * design §2). A runner launched to write up OTHER sessions — build 3's headless
 * catch-up, or a later Desktop session writing up a chat that went quiet — may
 * be in another directory from them. Its OWN registry record lists them
 * (`SessionRecord.mayWriteUp`, written by the launcher through
 * `sessions.ts#grantWriteUps`, never by a tool), and for a subject listed there
 * the door's rule is exactly: listed, AND ended (`endedAt` set), AND owed per
 * `owedWriteUps` asked in the SUBJECT's scope. On that path `sameScope` against
 * this server's scope is skipped, the grant stands in for the SessionStart
 * pointer as the evidence a fetch needs, and the memories are filed under the
 * subject's scope. Everything else — parts, marks, `cover`, the refusals — is
 * the ordinary path's.
 */
import type { Counterpart } from "../../core/counterpart.js";
// THE MARK, by path — `remember/index.ts` does not re-export it (PR #189
// re-review, R1), and `test/cli.test.ts` pins who may import it.
import { WRITE_UP_BY, recordWriteUp } from "../../core/remember/write-up-seam.js";
import type { WriteUpReason } from "../../core/remember/write-up-seam.js";
import { calendarDate } from "../../core/self/index.js";
import {
  NIGHT_RUNNER_PREFIX,
  WRITE_UP_CLAIM_MS,
  WRITE_UP_KEPT_MARK,
  WRITE_UP_PART_BYTES,
  WRITE_UP_REPLY_MARK,
  claimWriteUpProgress,
  isSessionId,
  liveClaim,
  markWriteUpFetched,
  progressKey,
  readSession,
  readWriteUpProgress,
  sameScope,
  saveWriteUpProgress,
  writeUpEntries,
  writeUpParts,
  writeUpPartsDated,
  writeUpPlan,
  writeUpStanding,
} from "../sessions.js";
import type { WriteUpAnswer, WriteUpClaim, WriteUpProgress } from "../sessions.js";
import type { HeldSession } from "../../core/remember/index.js";

/** Every way the door refuses. */
export const WRITE_UP_REFUSALS = [
  "handoff-not-accepted",
  "unknown-session",
  "live-session",
  "other-project",
  "already-written-up",
  "owes-nothing",
  "not-asked",
  "wrong-part",
  "part-already-written",
  "memories-required",
  "nothing-landed",
  "io-failed",
  "claimed",
  "allowance-spent",
  "grant-expired",
] as const;
export type WriteUpRefusal = (typeof WRITE_UP_REFUSALS)[number];

/** Who the mark says wrote it up. Fixed: the next session, never free text. */
const BY: (typeof WRITE_UP_BY)[number] = "next-session";

/** What the per-entry deposit loop reports back. The loop is `session_end`'s own. */
export interface WriteUpDeposits {
  readonly outcomes: readonly Record<string, unknown>[];
  readonly deposited: number;
  /** Entries refused only because the store already holds the same content —
   *  what they say is kept, so they count as landed. */
  readonly duplicates: number;
}

export interface WriteUpDoorInput {
  readonly counterpart: Counterpart;
  /** Where the hooks' registry lives — the store's directory in production. */
  readonly registryDir: string;
  /** This server's project directory. */
  readonly scope: string;
  /** The WRITING session — the live one, already bound. */
  readonly session: string;
  readonly now: number;
  readonly args: Record<string, unknown>;
  /** `session_end`'s own per-entry loop, under the WRITING session's name,
   *  covering whose words `cover` says (`SessionEndDepositContext.cover`), and
   *  filed under `scope` when given — a GRANTED write-up's memories go where the
   *  subject was lived; absent, this server's scope. */
  readonly deposit: (
    raw: readonly unknown[],
    cover: false | { readonly session: string },
    scope: string | undefined,
    /** Whose stretch the memories write up, and the day it was LIVED
     *  (2026-10-01): each memory carries that session and date, marked
     *  second-hand (`SessionEndDepositContext.writeUp`). */
    writeUp: { readonly session: string; readonly happenedOn: string | null },
  ) => Promise<WriteUpDeposits>;
}

export interface WriteUpOutcome {
  /** A refusal's name, or what the call did. */
  readonly reason: WriteUpRefusal | "part" | "part-written" | "written-up" | "written-up-here";
  readonly isError: boolean;
  /** The tool result's body. On a fetch it carries the part's words; every
   *  other body is ids, counts and reasons. */
  readonly body: Record<string, unknown>;
}

const refused = (reason: WriteUpRefusal, detail: Record<string, unknown> = {}): WriteUpOutcome => ({
  reason,
  isError: true,
  body: { stored: false, writeUp: true, reason, ...detail },
});

const NO_DEPOSITS: WriteUpDeposits = { outcomes: [], deposited: 0, duplicates: 0 };

/** Everything one call works from, read once. */
interface Standing {
  readonly held: HeldSession;
  /** The buffer's own spelling of this project's scope. */
  readonly here: string;
  readonly key: string;
  readonly progress: WriteUpProgress | undefined;
  readonly all: Readonly<Record<string, WriteUpProgress>>;
  /**
   * TRUE ON THE GRANTED PATH (`sessions.ts#SessionRecord.mayWriteUp`): the
   * writing session's own record lists this subject, so the grant — written by
   * a launcher, never a model — stands in for the SessionStart pointer, the
   * project is the subject's rather than this server's, and the memories are
   * filed under it (`here`).
   */
  readonly granted: boolean;
}

/**
 * THE DOOR. Never throws on a refusal; a throw from the store is the caller's
 * to report, exactly as it is for an ordinary `session_end` entry.
 */
export async function writeUpDoor(input: WriteUpDoorInput): Promise<WriteUpOutcome> {
  const { args, counterpart } = input;
  const ended = args["writeUp"];
  // An empty list is an unused optional field, as `retireHandoffField` reads it
  // (PR #192 review, m1): a host that sends one must not have a write-up refused.
  const present = (v: unknown): boolean => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
  if (present(args["handoff"]) || present(args["retireHandoff"])) {
    return refused("handoff-not-accepted", {
      detail: "A handoff is this directory's pointer, written by this session for itself. Send it on its own `session_end`, without `writeUp`.",
    });
  }
  if (!isSessionId(ended)) return refused("unknown-session", { writeUp: typeof ended === "string" ? ended : null });
  if (ended === input.session) {
    return refused("live-session", { writeUp: ended, detail: "That is this session. Its own memories go on an ordinary `session_end`." });
  }

  const plan = writeUpPlan({ store: counterpart.store, spans: counterpart.spans });
  const all = readWriteUpProgress(counterpart.store);
  const record = readSession(input.registryDir, input.session);

  // THE GRANTED PATH (2026-09-30; the binding shape agreed with build 3). The
  // exact door rule: the subject is listed in the WRITING session's OWN record
  // (`mayWriteUp`, which only a launcher writes), AND it has ended, AND it is
  // owed per `owedWriteUps` — asked in the subject's own project, so the
  // `sameScope` test against THIS server's scope is skipped, and the memories
  // are filed where the subject was lived (`here`).
  let st: Standing;
  // A NIGHTLY RUNNER'S GRANT LASTS AS LONG AS ITS CLAIMS (review of #308): a
  // runner whose record ended, or that was never ended and is older than
  // `WRITE_UP_CLAIM_MS` (its process was killed), holds no grant any more.
  if (
    record?.mayWriteUp?.includes(ended) === true &&
    record.sessionId.startsWith(NIGHT_RUNNER_PREFIX) &&
    (record.endedAt !== null || input.now - record.lastBoundaryAt >= WRITE_UP_CLAIM_MS)
  ) {
    return refused("grant-expired", { writeUp: ended, detail: "This runner's grant has run out. A later night writes that session up." });
  }
  if (record?.mayWriteUp?.includes(ended) === true) {
    // "ENDED" IS THE LEDGER'S WORD (2026-10-01, #289's evidence), not the
    // registry's `endedAt`: a session that crashed with no end, and captured
    // nothing since the date changed, is not at work — `writeUpStanding`'s
    // `live-session` is exactly "still at work". And no registry record is
    // needed: where the subject was lived is read off the buffer.
    // NO FULL-FIRST GATE here: the launcher chose the subjects (the pointer's
    // rotation is for a session that can be offered only one), so a small
    // debt is not refused for a larger one waiting elsewhere.
    const held = plan.find((h) => h.session === ended);
    const subject = held === undefined ? readSession(input.registryDir, ended) : null;
    const scopes = held?.scopes ?? (subject === null ? [] : [subject.scope]);
    if (scopes.length === 0) return refused("unknown-session", { writeUp: ended });
    let found: Extract<ReturnType<typeof writeUpStanding>, { status: "owed" }> | null = null;
    let first: ReturnType<typeof writeUpStanding> | null = null;
    for (const scope of scopes) {
      const s = writeUpStanding(plan, input.registryDir, ended, scope, input.now, { progress: all });
      if (s.status === "owed") {
        found = s;
        break;
      }
      first ??= s;
    }
    if (found === null) {
      // NOT OWED, AND SAID WHY — every arm by name, never a bare refusal.
      const why = first ?? { status: "unknown-session" as const };
      if (why.status === "owes-nothing") return refused("owes-nothing", { writeUp: ended, why: why.why });
      if (why.status === "live-session") {
        return refused("live-session", { writeUp: ended, detail: "That session is still at work today. It is written up once it is not." });
      }
      return refused(why.status, { writeUp: ended });
    }
    const key = progressKey(ended, found.here);
    st = { held: found.held, here: found.here, key, progress: all[key], all, granted: true };
  } else {
    const standing = writeUpStanding(plan, input.registryDir, ended, input.scope, input.now, { progress: all });
    if (standing.status === "owes-nothing") return refused("owes-nothing", { writeUp: ended, why: standing.why });
    if (standing.status !== "owed") return refused(standing.status, { writeUp: ended });
    const key = progressKey(ended, standing.here);
    st = { held: standing.held, here: standing.here, key, progress: all[key], all, granted: false };
  }

  // CLAIM-FIRST (2026-10-01): another writer holds this stretch right now — the
  // nightly run, or a session that fetched it — so neither a fetch nor an
  // answer from here goes through. Two writers never write the same stretch.
  const held = liveClaim(st.progress, input.now);
  if (held !== null && held.by !== input.session) {
    return refused("claimed", {
      writeUp: ended,
      detail: held.by.startsWith(NIGHT_RUNNER_PREFIX)
        ? "The nightly run is writing that session up now. Nothing to do here."
        : "Another session is writing that session up now. Nothing to do here.",
    });
  }

  const mine = record?.writeUpFor?.session === ended ? record.writeUpFor : undefined;
  const raw = args["memories"];
  // A FETCH is no `memories` — or an empty list before any fetch is on record
  // (m2): a host that honours `required` sends `[]`, and with nothing fetched
  // there is nothing yet that `[]` could be the answer to.
  const fetching = raw === undefined || (Array.isArray(raw) && raw.length === 0 && mine === undefined);
  // On the granted path the grant is the evidence the pointer is otherwise.
  if (fetching) return handOver(input, ended, st, st.granted ? ended : record?.writeUpPointer, mine);
  return takeBack(input, ended, st, mine, raw);
}

// ── FETCH ───────────────────────────────────────────────────────────────────

async function handOver(
  input: WriteUpDoorInput,
  ended: string,
  st: Standing,
  pointer: string | undefined,
  mine: { part: number; answer?: WriteUpAnswer } | undefined,
): Promise<WriteUpOutcome> {
  const { counterpart } = input;
  // POINTED AT THIS SESSION, by the hook — evidence the model cannot write.
  // Without it, any live session could read any owed session's words.
  if (pointer !== ended) return refused("not-asked", { writeUp: ended });
  // THE LAST PART HERE CAME BACK AND THE MARK DID NOT LAND (an IO failure):
  // this fetch finishes it, whoever answered — nothing deposited twice (MAJOR
  // 2). Keyed on `answer`, which only the last part's answer sets, and never on
  // a part count: once the words here read as kept, their marks lengthen the
  // text and a recount can find a part more than was served (re-review, m-B).
  const p = st.progress;
  if (p !== undefined && p.answer !== undefined && p.waiting !== true) {
    return finish(input, ended, st, p.parts, p.answer, NO_DEPOSITS, true);
  }
  // ONE PART PER SESSION START on the ordinary path. A GRANTED runner goes on
  // to the next part once its last one came back (2026-10-01): its bound is
  // the launcher's allowance (`claim.upTo`), not a session start.
  const answered = mine?.answer !== undefined && (p?.done ?? 0) >= mine.part;
  if (mine?.answer !== undefined && !(st.granted && answered)) {
    return refused("part-already-written", {
      writeUp: ended,
      part: mine.part,
      detail: "This session has written up its part. The next part is handed over at a later session start here.",
    });
  }
  const current = st.granted && answered ? undefined : mine;
  const chunk = p?.chunk ?? WRITE_UP_PART_BYTES;
  const parts = writeUpParts(writeUpEntries(counterpart.spans, { session: ended, scopes: [st.here] }), chunk);
  if (parts.length === 0) return refused("owes-nothing", { writeUp: ended, why: "no-text" });
  // The same part again when this session fetched and has not answered;
  // otherwise the next one not yet written.
  const part = current?.part ?? Math.min((p?.done ?? 0) + 1, parts.length);
  // THE NIGHT'S ALLOWANCE for this subject, set by the launcher: past it, the
  // rest is left owed — for a later night, or a session in its directory.
  const own = liveClaim(p, input.now);
  const upTo = own !== null && own.by === input.session ? own.upTo : undefined;
  if (upTo !== undefined && part > upTo) {
    return refused("allowance-spent", {
      writeUp: ended,
      part,
      of: parts.length,
      detail: "Tonight's allowance for that session is spent. The rest stays owed, for a later night or a session in its directory.",
    });
  }
  const next: WriteUpProgress & { readonly claim: WriteUpClaim } = {
    ...(p ?? {}),
    chunk,
    parts: parts.length,
    done: Math.min(p?.done ?? 0, parts.length),
    handedAt: input.now,
    // CLAIMED BY THIS SESSION, from the fetch until it is written (2026-10-01).
    claim: { by: input.session, at: input.now, ...(upTo === undefined ? {} : { upTo }) },
  };
  // THE CLAIM AND THE SAVE IN ONE TRANSACTION (review of #308): a writer that
  // took the subject since this call read the map wins, and this one is told.
  const took = claimWriteUpProgress(counterpart.store, st.key, next, input.now);
  if (took === "claimed") {
    return refused("claimed", { writeUp: ended, detail: "Another writer took that session a moment ago. Nothing to do here." });
  }
  if (took === "failed") return refused("io-failed", { writeUp: ended });
  if (!markWriteUpFetched(input.registryDir, input.session, { session: ended, part })) {
    return refused("io-failed", { writeUp: ended, detail: "The part could not be recorded as handed to this session." });
  }
  return {
    reason: "part",
    isError: false,
    body: {
      writeUp: true,
      reason: "part",
      session: input.session,
      ended,
      endedOn: calendarDate(st.held.clockFrom, counterpart.store.zone()),
      part,
      of: parts.length,
      next:
        `Hand back what caught your attention in this part, one idea each, with session_end: session: ${input.session}, ` +
        `writeUp: ${ended}, part: ${String(part)}, memories: [...] — in your own words, as this session's. ` +
        `memories: [] only if nothing in it held your attention. Anything marked ${WRITE_UP_KEPT_MARK} was written up before — by that session or an earlier write-up. ` +
        `Lines marked ${WRITE_UP_REPLY_MARK} are what that session said back — context for what was said to it; you are writing it up second-hand.` +
        (part < parts.length
          ? st.granted
            ? " Then fetch the next part the same way (writeUp and no memories)."
            : " The rest comes at later session starts here."
          : ""),
      // What was said to that session here, what it jotted, and its own
      // replies, labelled (2026-10-01).
      text: parts[part - 1] as string,
    },
  };
}

// ── ANSWER ──────────────────────────────────────────────────────────────────

async function takeBack(
  input: WriteUpDoorInput,
  ended: string,
  st: Standing,
  mine: { part: number; answer?: WriteUpAnswer } | undefined,
  raw: unknown,
): Promise<WriteUpOutcome> {
  const { counterpart, args } = input;
  const p = st.progress;
  if (mine === undefined || p === undefined) {
    return refused("not-asked", { writeUp: ended, detail: "Fetch it first: the same call with no memories returns its words." });
  }
  const part = mine.part;
  // A number, or its digits: `"2"` is the part a model meant by `2`.
  const said = args["part"];
  const claimed = typeof said === "string" && /^\d+$/.test(said) ? Number(said) : said;
  if (claimed !== undefined && claimed !== part) {
    return refused("wrong-part", { writeUp: ended, part, detail: `This session was handed part ${String(part)}.` });
  }
  const final = part >= p.parts;

  // THE LAST PART CAME BACK AND ITS MARK DID NOT LAND: any session holding a
  // fetch of it finishes it, depositing nothing (MAJOR 2, m-B).
  if (p.answer !== undefined && p.waiting !== true) {
    return finish(input, ended, st, p.parts, p.answer, NO_DEPOSITS, true);
  }
  if (p.done >= part) return refused("part-already-written", { writeUp: ended, part, of: p.parts });

  if (!Array.isArray(raw)) return refused("memories-required", { writeUp: ended, part });
  // NOTHING WORTH KEEPING IS A REAL ANSWER HERE TOO (owner, 2026-09-23): the
  // part is closed without minting, and on the last part the session is marked.
  const said2: WriteUpAnswer = raw.length === 0 ? "nothing-new" : "memories";
  // WHOSE WORDS THE MEMORIES COVER (MAJOR 4, through core's `cover` seam):
  // never the writer's own. On the LAST part here, the ended session's words in
  // this project — every part has now been served, so all of them were read;
  // on an earlier part, none, or parts not yet served would read as kept.
  // THE DAY THE PART WAS LIVED (2026-10-01): its latest piece's date, in the
  // store's zone — recorded as each memory's happened date, while its learned
  // date stays the day it is written.
  const dated = writeUpPartsDated(writeUpEntries(counterpart.spans, { session: ended, scopes: [st.here] }), p.chunk);
  const livedAt = dated[part - 1]?.lastAt ?? st.held.clockFrom;
  const happenedOn = livedAt > 0 ? calendarDate(livedAt, counterpart.store.zone()) : null;
  const deposits =
    raw.length === 0
      ? NO_DEPOSITS
      : await input.deposit(raw, final ? { session: ended } : false, st.granted ? st.here : undefined, {
          session: ended,
          happenedOn,
        });
  if (said2 === "memories" && deposits.deposited === 0 && deposits.duplicates === 0) {
    return {
      reason: "nothing-landed",
      isError: true,
      body: {
        stored: false,
        writeUp: true,
        reason: "nothing-landed",
        ended,
        part,
        entries: raw.length,
        deposited: 0,
        refused: raw.length,
        outcomes: deposits.outcomes,
      },
    };
  }
  const answered = markWriteUpFetched(input.registryDir, input.session, { session: ended, part, answer: said2 });
  if (!final) {
    // An ordinary writer is done with its one part: its claim is let go, so
    // the next start here can be pointed at the rest. A granted runner keeps
    // its claim and goes on (2026-10-01).
    const { claim, ...rest } = p;
    const kept = st.granted && claim !== undefined ? { ...rest, claim: { ...claim, at: input.now } } : rest;
    const advanced = saveWriteUpProgress(counterpart.store, st.key, { ...kept, done: part });
    return {
      reason: "part-written",
      isError: false,
      body: {
        writeUp: true,
        reason: "part-written",
        answer: said2,
        session: input.session,
        ended,
        part,
        of: p.parts,
        entries: raw.length,
        deposited: deposits.deposited,
        refused: raw.length - deposits.deposited,
        outcomes: deposits.outcomes,
        // `false`: what landed stands, and the store would not take the note
        // that this part is done, so a later start may hand it over again.
        recorded: advanced && answered,
      },
    };
  }
  return finish(input, ended, st, part, said2, deposits, false);
}

/**
 * THE LAST PART HERE CAME BACK.
 *
 * The ended session's words HERE are marked kept, so a later reader — a next
 * session if it resumes and owes again, the API sweep — sees them as already
 * written up. The last part's memories claimed them already, under their own
 * proposal (`cover: { session: ended }`); this claims whatever is left — all of
 * it when the answer was an empty batch — under `writeup:<writer>`. Then:
 *
 *   - if it still holds unwritten words in ANOTHER project, this project's
 *     share WAITS (`written-up-here`): B3 reads a write-up mark for the whole
 *     session, so marking now would start the other project's clock on words
 *     nobody there has read (MAJOR 6);
 *   - otherwise it is marked written up through the seam, here only,
 *     `by: "next-session"`, and B3's seven-day clock starts. A mark that did not
 *     land leaves the session owed; the next start here points at it again and
 *     the FETCH finishes it — whoever it is — without depositing twice.
 */
function finish(
  input: WriteUpDoorInput,
  ended: string,
  st: Standing,
  part: number,
  said: WriteUpAnswer,
  deposits: WriteUpDeposits,
  retry: boolean,
): WriteUpOutcome {
  const spans = input.counterpart.spans;
  try {
    spans.claimCoverage({ scope: st.here, session: ended, proposalId: `writeup:${input.session}` });
  } catch {
    /* a kept mark that did not land costs a later reader a duplicate, never words */
  }
  const elsewhere = st.held.scopes.filter(
    (scope) =>
      !sameScope(scope, st.here) &&
      writeUpEntries(spans, { session: ended, scopes: [scope] }).length > 0 &&
      !(() => {
        const q = st.all[progressKey(ended, scope)];
        return q !== undefined && q.done >= q.parts && q.waiting === true;
      })(),
  );
  // Every part here is back: the claim is let go with it (2026-10-01).
  const { claim: _released, ...base } = st.progress ?? { chunk: WRITE_UP_PART_BYTES, parts: part, done: 0, handedAt: input.now };
  const entries = deposits.outcomes.length;
  const common = {
    writeUp: true,
    answer: said,
    session: input.session,
    ended,
    part,
    of: base.parts,
    entries,
    deposited: deposits.deposited,
    refused: entries - deposits.deposited,
    outcomes: deposits.outcomes,
  };
  if (elsewhere.length > 0) {
    saveWriteUpProgress(input.counterpart.store, st.key, { ...base, done: part, answer: said, waiting: true });
    return {
      reason: "written-up-here",
      isError: false,
      body: {
        ...common,
        reason: "written-up-here",
        marked: false,
        // Words it left in other projects wait for a session there.
        elsewhere: elsewhere.length,
      },
    };
  }
  const reasons: WriteUpReason[] = [recordWriteUp(spans, { scope: st.here, session: ended, by: BY })];
  const marked = reasons.includes("RECORDED");
  if (marked) saveWriteUpProgress(input.counterpart.store, st.key, null, { allOf: ended });
  else saveWriteUpProgress(input.counterpart.store, st.key, { ...base, done: part, answer: said });
  return {
    reason: "written-up",
    isError: !marked,
    body: {
      ...common,
      reason: "written-up",
      // Whether the ended session is now marked written up. `false` is an IO
      // failure: what landed stands, the session still owes, and the next
      // start here points at it again so the fetch can finish it.
      marked,
      ...(marked ? {} : { markReasons: [...new Set(reasons)] }),
      ...(retry ? { detail: "The last part's answer landed on an earlier call; this one only recorded the write-up." } : {}),
    },
  };
}
