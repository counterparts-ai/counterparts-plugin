/** `McpServer`'s `session_end` and `chapter` tools: the deposit, the write-up, what the session drew on, and the handoff (bodies moved out of `server.ts`, 2026-10-11; the class keeps a delegate for each). */
import { CLAIM_NOTHING_NEW, claimUnwritten } from "../../core/coverage/index.js";
import { DREW_ON_MAX_PER_BOUNDARY, RECALL_CREDIT_EVENT } from "../../core/counterpart.js";
import type { ChapterResult, Counterpart, DepositResult } from "../../core/counterpart.js";
import { CONTRADICTION_TUNABLES, NEIGHBOURS_HINT } from "../../core/reconsolidation.js";
import { installedVersion, isSessionId, markNothingNew, readSession, sameScope } from "../sessions.js";
import { writeUpDoor } from "./write-up.js";
import type { ToolResult } from "./server-options.js";
import {
  readDimensions,
  pickDimensions,
  readReminder,
  readFeelings,
  readAbout,
  readTraits,
  readWriteFacts,
  MEMORY_KINDS,
  reminderEcho,
  undatedReminderWarning,
  factsEcho,
  threadOf,
} from "./server-args.js";
import type { FeelingsRead, ReminderRead, AboutRead, TraitsRead, FactsRead } from "./server-args.js";
import type { McpServer } from "./server.js";

/**
 * `session_end` — the MEMORIES half of the Stop ask's return channel.
 *
 * Per-entry failure isolation (scar E1): one refused entry announces itself
 * and its siblings still land. A single bad item failing the whole dump is
 * how a session's memory becomes all-or-nothing at exactly the moment there
 * is no second chance to write it.
 */
export async function sessionEndTool(server: McpServer, args: Record<string, unknown>): Promise<ToolResult> {
  if (server.observer) return server["standDown"]("session_end");
  const bound = server["requireBoundSession"](args["session"], "session_end");
  if (bound !== null) return bound;

  // THE WRITE-UP DOOR (roadmap C2) — diverted HERE, after the bind (the
  // WRITING session is this one, bound exactly as always) and before anything
  // else reads the call: a write-up never writes a handoff and never marks
  // "nothing new". Everything it does and refuses is `write-up.ts`'s.
  // ONLY A NON-EMPTY STRING diverts (PR #192 review, m1): a host or model that
  // sends unused optional fields as `null` or `""` must not have every
  // ordinary answer refused as a write-up of nobody.
  //
  // `drewOn` (2026-10-11) is read before the divert (review of #385), so a
  // write-up that names what it drew on is credited as any other answer is:
  // the writing session is this one, and so is the shown set the guard
  // reads. It is credited whatever the rest of the call does, and its
  // outcome rides out on every answer below.
  const drewOn = server["drewOnField"](args["drewOn"], "session_end");
  if (typeof args["writeUp"] === "string" && args["writeUp"].length > 0) return server["writeUpField"](args, drewOn);

  // THE HANDOFF FIRST, and before the memories check on purpose (E1). It is a
  // FIELD on this call and not one of the entries, so a dump whose `memories`
  // array is malformed must not also throw away the one line telling the next
  // session in this directory where the work stands. The outcome rides out on
  // the refusal too, so nothing is lost silently either way.
  //
  // A DESKTOP CALL THAT NAMED NO SESSION leaves and retires no handoff
  // (review of #295, MINOR-4, at the hosts session's ask). It was bound to
  // the most recent live Desktop session, which may be another chat's — and
  // a handoff is keyed by its session, so chat A's would revise or clear
  // chat B's. Both fields are refused by name; the rest of the call, the
  // memories included, goes through as it always did.
  const unnamed = server["callBoundBy"] === "most-recent";
  const handoff = unnamed ? server["unnamedHandoffField"](args["handoff"]) : server["writeHandoffField"](args["handoff"]);
  // Retiring others' handoffs here by id (2026-09-30) rides the same rules:
  // it lands before the memories check, it counts as landing something, and
  // its outcomes ride out beside the answer.
  const retiredRaw = args["retireHandoff"];
  let retired: Record<string, unknown>[] | null = null;
  if (!unnamed) {
    retired = server["retireHandoffField"](retiredRaw);
  } else if (!(Array.isArray(retiredRaw) && retiredRaw.length === 0)) {
    const refused = server["unnamedHandoffField"](retiredRaw);
    retired = refused === null ? null : [refused];
  }

  const raw = args["memories"];
  // NOTHING WORTH KEEPING IS A REAL ANSWER — and until 2026-09-21 it was not
  // one on this door (new-user finding #12). A session that learned nothing
  // durable but is leaving work half-finished sends the handoff and an empty
  // list, and got back an ERROR naming a missing field while the handoff it
  // had just asked for was already on disk. A model that reads its own result
  // learns from that to stop sending handoffs, or to invent a memory.
  //
  // Three cases, and only the first is new:
  //
  //   - A handoff LANDED (written or cleared) and there are no memories →
  //     success, saying so. `deposited` is 0 and `isError` is false, because
  //     something did land.
  //   - A handoff was sent and REFUSED (`no-scope`, `too-large`, `not-text`,
  //     `nothing-to-clear`) with no memories → nothing landed, so the refusal
  //     stands and the handoff's own outcome rides out on it.
  //   - Neither — no handoff and no memories → `memories-required`, as
  //     before. So is a `memories` that is not an array: a caller who sent the
  //     wrong TYPE wants to be told. (The published schema no longer marks
  //     `memories` required — the write-up fetch leaves it out, PR #192 m2 —
  //     so this refusal is where the rule is enforced.)
  //
  // AND A FOURTH, 2026-09-23 (B1, owner's decision 4): `memories: []` is
  // "nothing new" WHATEVER happened to the handoff — accepted, minting
  // nothing, and RECORDED, so an honest empty answer is no longer the same
  // silence as no answer at all. Only an explicit empty ARRAY: a call that
  // left the field out has not answered anything, and stays
  // `memories-required`.
  //
  // A handoff that came with it rides out beside the answer, whatever its
  // outcome (review M2: a refused handoff used to turn the whole call into
  // `memories-required`, naming a field the caller HAD sent — new-user
  // finding #12's mechanism, reopened). `nothing-to-clear` — `handoff: ""`
  // where no pointer stands — is a no-op, not an error: the field's own
  // description invites `""` exactly when the work is finished. Any other
  // refusal (`too-large`, `not-text`, `no-scope`, …) sets `isError`, because
  // something the caller sent did not land and resending it can fix that —
  // but the reason stays `nothing-new` and the answer is recorded either way.
  //
  // The record is a mark on the session's registry entry (`nothingNewAt`),
  // not a durable event row: a new durable event NAME is a core change
  // (`AdapterDurableEventName`), and the registry is where "did this session
  // answer" is already read from. Every success with no memories leaves it,
  // handoff-only included. It does not move pacing and does not need to — the
  // pacer advanced when the ask went out (`self/index.ts#openChapter`).
  const session = server.session as string;
  const landed =
    (handoff !== null && handoff["written"] === true) ||
    (retired !== null && retired.some((r) => r["written"] === true));
  const noMemories = raw === undefined || (Array.isArray(raw) && raw.length === 0);
  const emptyList = Array.isArray(raw) && raw.length === 0;
  if ((landed && noMemories) || emptyList) {
    const marked = markNothingNew(server["registryDir"], session, server["nowFn"]()) !== null;
    // "NOTHING NEW" WRITES THE STRETCH UP (2026-09-30): a claim with no
    // proposal behind it, in `coverage.jsonl`, so the ledger reads one file —
    // in THIS project only, as a memory's claim is. A handoff alone claims nothing.
    if (emptyList) claimUnwritten(server.counterpart.spans, { session, scope: server.scope, by: CLAIM_NOTHING_NEW, ref: session });
    const handoffFailed =
      (handoff !== null && handoff["written"] !== true && handoff["reason"] !== "nothing-to-clear") ||
      // `not-here` is the retire's `nothing-to-clear`: an id already
      // retired (by its writer or another session) is not a failure to fix.
      (retired !== null && retired.some((r) => r["written"] !== true && r["reason"] !== "not-here"));
    server["emit"]("mcp.session_end", session, {
      entries: 0,
      deposited: 0,
      refused: 0,
      handoff: landed,
      nothingNew: true,
      recorded: marked,
    });
    return server["result"](
      {
        session,
        entries: 0,
        deposited: 0,
        refused: 0,
        outcomes: [],
        reason: landed ? "handoff-only" : "nothing-new",
        // Whether the answer reached the session's record. `false` means the
        // registry could not be written (or the record was pruned): the
        // answer still stands, and the caller can see it was not kept.
        recorded: marked,
        ...(handoff === null ? {} : { handoff }),
        ...(retired === null ? {} : { retired }),
        ...(drewOn === null ? {} : { drewOn }),
      },
      handoffFailed,
    );
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return server["refuse"]("session_end", "memories-required", {
      ...(handoff === null ? {} : { handoff }),
      ...(retired === null ? {} : { retired }),
      ...(drewOn === null ? {} : { drewOn }),
    });
  }
  const { outcomes, deposited, entries } = await server["depositEntries"](raw, session);
  server["emit"]("mcp.session_end", session, {
    entries: entries.length,
    deposited,
    refused: entries.length - deposited,
    handoff: handoff === null ? false : handoff["written"] === true,
  });
  return server["result"](
    {
      session,
      entries: entries.length,
      deposited,
      refused: entries.length - deposited,
      outcomes,
      // One line for the whole dump, when any entry came back with neighbours.
      ...(outcomes.some((o) => o["neighbours"] !== undefined) ? { neighboursHint: NEIGHBOURS_HINT } : {}),
      ...(handoff === null ? {} : { handoff }),
      ...(retired === null ? {} : { retired }),
      ...(drewOn === null ? {} : { drewOn }),
    },
    deposited === 0,
  );
}

/**
 * THE ROAD EVERY `session_end` ENTRY TAKES — a write-up's included (C2):
 * one draft per item, the gate battery through `submitSessionEnd`, and
 * per-entry isolation (scar E1). Extracted, not changed, so the write-up
 * door's memories cannot take a different road from an ordinary answer's —
 * except WHOSE words they cover, which the door says (`cover`).
 */
export async function depositEntries(
  server: McpServer,
  raw: readonly unknown[],
  session: string,
  /** Whose words the entries cover (`SessionEndDepositContext.cover`). Absent: this
   *  session's own — every caller but the write-up door. */
  cover?: false | { readonly session: string },
  /** Where the memories are filed. Absent: this server's scope — every caller
   *  but a GRANTED write-up (`sessions.ts#SessionRecord.mayWriteUp`), whose
   *  memories go under the scope the subject was lived in. */
  scope?: string,
  /** A WRITE-UP's memories (2026-10-01): whose stretch they write up and the
   *  day it was lived — carried on each memory, marked second-hand. */
  writeUp?: { readonly session: string; readonly happenedOn: string | null },): Promise<{ outcomes: Record<string, unknown>[]; deposited: number; duplicates: number; entries: Record<string, unknown>[] }> {
  const entries: Record<string, unknown>[] = [];
  const feelingsOf: FeelingsRead[] = [];
  const datedOf: ReminderRead[] = [];
  const aboutOf: AboutRead[] = [];
  const traitsOf: TraitsRead[] = [];
  const factsOf: FactsRead[] = [];
  const today = server["today"]();
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      entries.push({ content: "" });
      feelingsOf.push({ inputs: [] });
      datedOf.push({ fields: {}, remindIgnored: false });
      aboutOf.push({ mark: null });
      traitsOf.push({ inputs: [] });
      factsOf.push({ sent: {}, dropped: [], notes: [] });
      continue;
    }
    const rec = item as Record<string, unknown>;
    const draft: Record<string, unknown> = { content: rec["content"] };
    if (typeof rec["kind"] === "string") draft["kind"] = rec["kind"];
    if (typeof rec["title"] === "string") draft["title"] = rec["title"];
    if (typeof rec["updates"] === "string") draft["updates"] = rec["updates"];
    if (rec["how"] !== undefined) draft["how"] = rec["how"];
    if (typeof rec["unresolved"] === "boolean") draft["unresolved"] = rec["unresolved"];
    if (rec["salience"] !== undefined) draft["claimed"] = rec["salience"];
    // A bad dimension does NOT fail the batch and is not silently dropped:
    // the dimensions ride into the draft and `remember/intake` refuses that
    // one entry as malformed, which is this tool's per-entry isolation rule.
    const entryDims = readDimensions(rec) ?? pickDimensions(rec);
    if (Object.keys(entryDims).length > 0) draft["salience"] = entryDims;
    // The reminder date (2026-09-26), per entry: an unreadable one refuses
    // THIS entry below, by name, and its siblings still land.
    const dated = readReminder(rec);
    if (!("refused" in dated)) Object.assign(draft, dated.fields);
    datedOf.push(dated);
    entries.push(draft);
    feelingsOf.push(readFeelings(rec["feelings"]));
    aboutOf.push(readAbout(rec["about"]));
    traitsOf.push(readTraits(rec["traits"]));
    factsOf.push(readWriteFacts(rec, today));
  }

  const outcomes: Record<string, unknown>[] = [];
  let deposited = 0;
  let duplicates = 0;
  // The ids this call has written so far, and how many neighbours it listed (M1).
  const batch: string[] = [];
  let listed = 0;
  const model = server["sessionModel"]();
  for (const [n, draft] of entries.entries()) {
    // Feelings that cannot be stored refuse THEIR entry before it mints, so
    // no memory lands with its feelings silently dropped; siblings still run.
    const feelings = feelingsOf[n] ?? { inputs: [] };
    if ("refused" in feelings) {
      outcomes.push({ stored: false, reason: "feelings-malformed", detail: feelings.refused });
      continue;
    }
    const dated = datedOf[n] ?? { fields: {}, remindIgnored: false };
    if ("refused" in dated) {
      outcomes.push({ stored: false, reason: dated.refused, detail: dated.detail });
      continue;
    }
    const about = aboutOf[n] ?? { mark: null };
    if ("refused" in about) {
      outcomes.push({ stored: false, reason: "about-malformed", detail: about.refused });
      continue;
    }
    // Trait nudges refuse THEIR entry before it mints, like its feelings.
    const traits = traitsOf[n] ?? { inputs: [] };
    if ("refused" in traits) {
      outcomes.push({ stored: false, reason: "traits-malformed", detail: traits.refused });
      continue;
    }
    const facts = factsOf[n] ?? { sent: {}, dropped: [], notes: [] };
    let result: DepositResult;
    try {
      result = await server.counterpart.submitSessionEnd(draft, {
        session,
        scope: scope ?? server.scope,
        owner: server.owner,
        facts: facts.sent,
        // What it is about sets an unclaimed entry's default floor (2026-10-10).
        about: about.mark,
        // The dump's earlier entries: never read as an earlier state of this one.
        siblings: [...batch],
        ...(cover === undefined ? {} : { cover }),
        ...(model === undefined ? {} : { model }),
        ...(writeUp === undefined ? {} : { writeUp }),
      });
    } catch (err) {
      // Isolation, not a lost dump: this entry failed, the rest still run.
      outcomes.push({ stored: false, reason: "threw", detail: String((err as Error).message ?? err) });
      continue;
    }
    if (result.deposited) deposited += 1;
    if (result.reason === "duplicate-content") duplicates += 1;
    // A refusal names what to fix. `malformed` alone sent the author back to
    // guess (IMPROVEMENTS U11: a kind outside the enum came back as a bare
    // "malformed"); intake's own reason rides out, and an unknown kind lists
    // the kinds that exist.
    const malformed = result.malformed ?? null;
    // Bounded per dump (M1): a long dump shares NEIGHBOURS_PER_CALL between its entries.
    const neighbours = server["neighboursOf"](result, batch, Math.min(CONTRADICTION_TUNABLES.NEIGHBOURS, CONTRADICTION_TUNABLES.NEIGHBOURS_PER_CALL - listed), session);
    listed += neighbours.length;
    if (result.memoryId !== null) batch.push(result.memoryId);
    outcomes.push({
      stored: result.deposited,
      reason: result.reason,
      ...(result.memoryId === null ? {} : { id: result.memoryId }),
      ...(result.gate === null ? {} : { gate: result.gate }),
      ...(malformed === null ? {} : { malformed }),
      ...(malformed === "KIND_UNKNOWN" ? { kinds: [...MEMORY_KINDS] } : {}),
      ...server["recordFeelings"](result, feelings.inputs, model),
      ...server["recordAbout"](result, about.mark),
      ...server["recordTraits"](result, traits.inputs, model),
      ...reminderEcho(result, dated, server["today"]()),
      ...undatedReminderWarning(result, dated, draft["title"], draft["content"]),
      ...factsEcho(result, facts),
      ...server["settledOf"](result, draft["how"] !== undefined),
      ...threadOf(result),
      ...(neighbours.length === 0 ? {} : { neighbours }),
      ...server["slotOf"](result),
    });
  }
  return { outcomes, deposited, duplicates, entries };
}

/**
 * `session_end` with `writeUp` — the next-session write-up's door (C2). The
 * decisions are `write-up.ts#writeUpDoor`'s; this only binds it to this
 * server's store, scope, registry and bound session, and renders the answer.
 */
export async function writeUpField(server: McpServer, args: Record<string, unknown>, drewOn: Record<string, unknown> | null): Promise<ToolResult> {
  const session = server.session as string;
  const out = await writeUpDoor({
    counterpart: server.counterpart,
    registryDir: server["registryDir"],
    scope: server.scope,
    session,
    now: server["nowFn"](),
    args,
    deposit: (raw, cover, scope, writeUp) => server["depositEntries"](raw, session, cover, scope, writeUp),
  });
  const body = out.body;
  // The ref is the ENDED session's id only when it is one this registry
  // knows: the argument is model-typed, and a word shaped like an id is
  // still a word (store §5 G10; review of #286).
  const ended = args["writeUp"];
  const known = isSessionId(ended) && readSession(server["registryDir"], ended) !== null;
  server["emit"]("mcp.write_up", known ? ended : undefined, {
    reason: out.reason,
    part: typeof body["part"] === "number" ? body["part"] : null,
    of: typeof body["of"] === "number" ? body["of"] : null,
    deposited: typeof body["deposited"] === "number" ? body["deposited"] : 0,
    marked: typeof body["marked"] === "boolean" ? body["marked"] : null,
    // Parts a fetch passed over, every word in them already written up
    // (2026-10-11): what makes a fast run of empty parts legible in the log.
    skipped: typeof body["skipped"] === "number" ? body["skipped"] : 0,
  });
  if (out.isError && body["stored"] === false && out.reason !== "nothing-landed") {
    server["emit"]("mcp.refused", undefined, { tool: "session_end", reason: out.reason });
  }
  return server["result"](drewOn === null ? body : { ...body, drewOn }, out.isError);
}

/**
 * THE `drewOn` FIELD on `session_end` and `chapter` (2026-10-11): the ids of
 * memories this session was shown that shaped what it did or said, each
 * credited at the engaged tier by `Counterpart#creditDrewOn`, which owns
 * every rule (the shown-this-session guard, the refusals by name, the cap).
 * Null when the field was not sent or sent empty. A value that is not a list
 * of strings credits nothing and says so.
 *
 * One durable `recall.credit` row per call that named anything, beside the
 * boundary's own: `source: "drewOn"`, `via` the tool, `how` aligned with
 * `ids`, `refused` as counts by reason (what `fired.ts` reads) and the
 * refused ids apart. The doctor's Credit line counts these rows.
 */
export function drewOnField(server: McpServer, raw: unknown, via: "session_end" | "chapter"): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string")) {
    return { credited: [], reason: "drewOn-malformed", detail: "drewOn is a list of memory ids, as strings." };
  }
  if (raw.length === 0) return null;
  // A DESKTOP CALL THAT NAMED NO SESSION credits nothing (review of #385),
  // as it leaves no handoff: it was bound to the most recent live Desktop
  // session, which may be another chat's, and the guard would read THAT
  // chat's shown set and spend its boundary's cap.
  if (server["callBoundBy"] === "most-recent") {
    return {
      credited: [],
      reason: "session-unnamed",
      detail: `Name your session to say what you drew on: session: <the id wake gave this chat>. This call named none, so it was filed under the most recent Claude Desktop session (${server.session ?? "none"}), which may be another chat's.`,
    };
  }
  const session = server.session as string;
  let out: ReturnType<Counterpart["creditDrewOn"]>;
  try {
    // The calendar day, so a dated memory drawn on stops coming back as a
    // footnote this window (`Prospective#actedOn`, 2026-10-11).
    out = server.counterpart.creditDrewOn(session, raw as string[], { at: server["today"]() });
  } catch (err) {
    return { credited: [], reason: "threw", detail: String((err as Error).message ?? err) };
  }
  const byReason: Record<string, number> = {};
  for (const r of out.refused) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  if (out.capped.length > 0) byReason["capped"] = out.capped.length;
  server["telemetry"](() => {
    server.counterpart.noteAdapterEvent(RECALL_CREDIT_EVENT, {
      source: "drewOn",
      via,
      reason: out.credited.length > 0 ? "credited" : "nothing-to-credit",
      session,
      date: server["today"](),
      day: out.day,
      considered: out.named,
      credited: out.credited.length,
      refused: byReason,
      ids: out.credited.slice(0, 64),
      how: out.credited.slice(0, 64).map(() => "drewOn"),
      idsTotal: out.credited.length,
      refusedIds: out.refused.slice(0, 64).map((r) => r.id),
      capped: out.capped.slice(0, 64),
      // Pairs of named memories sent to be linked as one co-use (Group 4 item 1).
      linked: out.linked,
    });
  });
  return {
    credited: out.credited,
    ...(out.refused.length === 0 ? {} : { refused: out.refused }),
    ...(out.capped.length === 0
      ? {}
      : { capped: out.capped, cap: `At most ${String(DREW_ON_MAX_PER_BOUNDARY)} per boundary, the first named; these were not credited.` }),
    ...(out.actedOn.length === 0
      ? {}
      : { actedOn: out.actedOn, actedOnNote: "Dated memories you acted on: they will not come back as footnotes around this date again." }),
  };
}

/**
 * The optional `handoff` field, written or refused, as the shape the tool
 * result carries back. Null when the caller passed none — which is the
 * ordinary case, and says nothing about this directory either way.
 *
 * **Three answers, and only the first is silence.**
 *
 *   - **Absent** — the ordinary case. Nothing is written and nothing is said:
 *     leaving the field out means "leave what stands", which is right.
 *   - **Present and blank** — `handoff: ""` or `"   "`. This is a CLEAR. It is
 *     the shape a model reaches for when it means "the work here is finished",
 *     and until 2026-09-20 it was total silence while the stale pointer stood
 *     (adversarial review MAJOR-2b). It retires the directory's pointer and
 *     leaves a durable row.
 *   - **Present and not a string** — a named, durable refusal, because a
 *     caller that sent the wrong type wants to know rather than to be ignored.
 *
 * The NO-SCOPE REFUSAL IS NOW DURABLE, which is what MAJOR-2a was: the
 * short-circuit that used to live here emitted a ring-only event and wrote no
 * row, so guarantee 3 was false on the only live door. The rule is asked in
 * two places on purpose and they are not duplicates — `handoff/` refuses an
 * empty scope and a scope that IS the store's directory, as a belt no caller
 * can get past; this file asks `sameScope`, which canonicalises (`/var` →
 * `/private/var` on this host), because it is the side that has the
 * canonicaliser and knows what `scopeSource` said. Either way the durable row
 * is written by `handoff/`, which owns guarantee 3.
 */
export function writeHandoffField(server: McpServer, raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return null;
  let out: ReturnType<Counterpart["writeHandoff"]>;
  try {
    if (typeof raw !== "string") {
      out = server.counterpart.refuseHandoff("not-text", { session: server.session });
    } else if (
      server.scopeSource === "store" ||
      sameScope(server.scope, server.counterpart.store.dir)
    ) {
      out = server.counterpart.refuseHandoff("no-scope", { session: server.session });
    } else if (raw.trim().length === 0) {
      out = server.counterpart.clearHandoff({ scope: server.scope, session: server.session });
    } else {
      // The model rides from host state, as a chapter's does, so the wake
      // can say which session — and which model — left it (2026-09-30).
      out = server.counterpart.writeHandoff(raw, {
        scope: server.scope,
        session: server.session,
        model: server["sessionModel"]() ?? null,
        // The release this server is running (2026-10-01): the wake says
        // "written before 0.3.10 was installed" once a newer one is.
        build: server["identity"]?.build.version ?? installedVersion(),
      });
    }
  } catch (err) {
    return { written: false, reason: "threw", detail: String((err as Error).message ?? err) };
  }
  server["emit"]("mcp.handoff", out.id ?? undefined, {
    written: out.written,
    reason: out.reason,
    bytes: out.bytes,
  });
  return {
    written: out.written,
    reason: out.reason,
    ...(out.id === null ? {} : { id: out.id }),
    bytes: out.bytes,
    ...(out.version === null ? {} : { version: out.version }),
    ...(out.gate === null ? {} : { gate: out.gate }),
    ...(out.redacted === null ? {} : { redacted: true }),
    ...(out.showsForDays === null ? {} : { showsForDays: out.showsForDays }),
    // The other sessions' live handoffs here, so a finished one can be
    // retired in the same call (`retireHandoff`).
    ...(out.others === undefined || out.others.length === 0 ? {} : { others: out.others }),
  };
}

/**
 * A `handoff` or `retireHandoff` field on a Desktop call bound by the
 * most-recent fallback: refused by name, durably (`handoff/` owns the row),
 * with the words that fix it. Null when the field was not sent.
 */
export function unnamedHandoffField(server: McpServer, raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return null;
  const detail = `Name your session to leave or retire a handoff: session: <the id wake gave this chat> — or, in a Claude Code session (Desktop's Code tab), the id your wake or Stop ask names. This call named none, so it was filed under the most recent Claude Desktop session (${server.session ?? "none"}), which may be another chat's.`;
  try {
    const out = server.counterpart.refuseHandoff("session-unnamed", { session: server.session });
    server["emit"]("mcp.handoff", undefined, { written: false, reason: out.reason, bytes: 0 });
    return { written: false, reason: out.reason, bytes: 0, detail };
  } catch (err) {
    return { written: false, reason: "threw", detail: String((err as Error).message ?? err) };
  }
}

/**
 * The optional `retireHandoff` field — ids of handoffs in THIS directory to
 * retire, whoever wrote them (2026-09-30) — as the outcomes the tool result
 * carries back, one per id. Null when the field is absent or an empty list.
 * A lone string is read as a list of one; anything else is one `not-text`
 * refusal. The directory rule is `writeHandoffField`'s, asked the same way.
 */
export function retireHandoffField(server: McpServer, raw: unknown): Record<string, unknown>[] | null {
  if (raw === undefined || raw === null) return null;
  const ids = typeof raw === "string" ? [raw] : raw;
  if (Array.isArray(ids) && ids.length === 0) return null;
  const outcome = (id: string | null, out: ReturnType<Counterpart["retireHandoff"]>): Record<string, unknown> => {
    server["emit"]("mcp.handoff.retire", out.id ?? undefined, { written: out.written, reason: out.reason });
    return { ...(id === null ? {} : { id }), written: out.written, reason: out.reason, bytes: out.bytes };
  };
  try {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return [outcome(null, server.counterpart.refuseHandoff("not-text", { session: server.session }))];
    }
    if (server.scopeSource === "store" || sameScope(server.scope, server.counterpart.store.dir)) {
      return [outcome(null, server.counterpart.refuseHandoff("no-scope", { session: server.session }))];
    }
    return [...new Set(ids as string[])].map((id) =>
      outcome(id, server.counterpart.retireHandoff(id, { scope: server.scope, session: server.session })),
    );
  } catch (err) {
    return [{ written: false, reason: "threw", detail: String((err as Error).message ?? err) }];
  }
}

/**
 * `chapter` — the journal's door (self/CONTRACT §3: *which door reaches this?*).
 *
 * It composes, like everything else here: `Counterpart.appendEpisode` runs the
 * gate, `self/` decides whether this append opens a chapter or continues the
 * one already open, and the number that comes back is the number the store
 * WROTE. The ask reads the same counter, so the two sides cannot drift the way
 * they did for a fortnight — the model wrote eleven chapters as notes while
 * the hook's count said seven.
 */
export async function chapterTool(server: McpServer, args: Record<string, unknown>): Promise<ToolResult> {
  if (server.observer) return server["standDown"]("chapter");
  const bound = server["requireBoundSession"](args["session"], "chapter");
  if (bound !== null) return bound;
  // `drewOn` (2026-10-11): credited whatever the chapter does, and its
  // outcome rides out on every answer below, as on `session_end`.
  const drewOn = server["drewOnField"](args["drewOn"], "chapter");
  const withDrewOn = drewOn === null ? {} : { drewOn };

  const text = args["text"];
  if (typeof text !== "string" || text.trim().length === 0) {
    return server["refuse"]("chapter", "text-required", {
      detail: "A chapter has to say something. Nothing worth writing is a real answer — say nothing at all instead.",
      ...withDrewOn,
    });
  }
  const session = server.session as string;
  const title = args["title"];
  // WHAT THE SESSION WAS ABOUT (2026-10-01, lane 8), carried to the
  // chapter's memory copy: a malformed one refuses the call before anything
  // is written, as on `remember`.
  const about = readAbout(args["about"]);
  if ("refused" in about) return server["refuse"]("chapter", "about-malformed", { detail: about.refused, ...withDrewOn });
  // The model the hooks last saw answer in this session. A Stop records it
  // before its ask goes out, so the chapter that answers the ask has it.
  const model = readSession(server["registryDir"], session)?.model;
  let written: ChapterResult;
  try {
    written = server.counterpart.appendEpisode(session, text, {
      // The project the chapter was written in: what it writes up (`coverage/`).
      scope: server.scope,
      ...(typeof title === "string" && title.length > 0 ? { title } : {}),
      ...(model === undefined ? {} : { model }),
      ...(about.mark === null ? {} : { about: about.mark }),
    });
  } catch (err) {
    // A journal that throws must not look like a journal that refused.
    return server["refuse"]("chapter", "threw", { detail: String((err as Error).message ?? err), ...withDrewOn });
  }
  server["emit"]("mcp.chapter", written.episodeId ?? undefined, {
    session,
    stored: written.appended,
    reason: written.reason,
    chapter: written.chapter,
    created: written.created,
  });
  return server["result"](
    {
      stored: written.appended,
      reason: written.reason,
      session,
      episodeId: written.episodeId,
      // From the STORE, never from the ask count.
      chapter: written.chapter,
      created: written.created,
      ...(written.gate === null ? {} : { gate: written.gate }),
      ...(about.mark === null || !written.appended ? {} : { about: about.mark }),
      ...withDrewOn,
    },
    !written.appended,
  );
}
