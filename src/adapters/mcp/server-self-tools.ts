/** `McpServer`'s `dream`, `reflect` and `self_page` tools, and the page writer's binding (bodies moved out of `server.ts`, 2026-10-11; the class keeps a delegate for each). */
import { NIGHT_CHILD_ENV, NIGHT_RUN_ENV } from "../spawn.js";
import { readSession } from "../sessions.js";
import { joinStillStands } from "../../core/dream/project-ask.js";
import { RECALL_MAX_IDS } from "./deliberate.js";
import { ID_KEYS } from "../../core/fit/index.js";
import type { AliasMap } from "../../core/fit/index.js";
import { DREAMING_SETTINGS, NIGHT_RUN_FINISHES, applyTagsAnswer, askTags, nightNext, nightOrder, renderTagsBundle } from "../../core/dream/index.js";
import type { DreamingSetting, NightPart } from "../../core/dream/index.js";
import {
  NIGHT_WRITER_TOOL,
  NO_PAGE_VERSION,
  SELF_TUNABLES,
  pageSections,
  pageTooLargeDetail,
} from "../../core/self/index.js";
import type { TraceInput } from "../../core/self/page.js";
import type { PageWriterMode, PageWriterRun } from "../../core/self/index.js";
import type { ToolResult } from "./server-options.js";
import { DREAMING_OFF_REFUSAL, dreamHow, dreamLaunchHowFor, PAGE_REFUSAL_DETAIL, pageLaneAnswer, pageRoomAnswer, reflectLaunchHowFor, settingSaidFor } from "./server-words.js";
import type { McpServer } from "./server.js";

/**
 * `dream` — dreaming, in phases (`core/dream/`, 2026-09-26). Every phase
 * binds the session: the dreamer is a background agent the session launched,
 * talking to this same server, and its writes belong to that session.
 * `launch` writes nothing — it hands back the prompt for the dreamer — and is
 * refused under observer stance with the rest, because a dream it launched
 * could do nothing there.
 */
export function dreamTool(server: McpServer, args: Record<string, unknown>): ToolResult {
  const phase = args["phase"];
  if (server.observer) return server["standDown"]("dream");
  const bound = server["requireBoundSession"](args["session"], "dream");
  if (bound !== null) return bound;
  const session = server.session as string;
  // A SETTING THAT WON'T READ HOLDS THE NIGHT, before anything is claimed or begun.
  if (phase === "launch" || phase === "writer" || phase === "begin" || phase === "tags") {
    const held = server["nightHeld"]("dream", phase);
    if (held !== null) return held;
  }
  // THE NIGHT'S FENCE (`core/dream/slices.ts`): a folder that doesn't export is closed to this call.
  const closed = server.counterpart.fenceNight(server["folderOn"]());
  const dreams = server.counterpart.dreams;
  const at = server.counterpart.store.today();
  const refused = (reason: string, detail: string): ToolResult => server["refuse"]("dream", reason, { phase, detail });
  // WHAT COMES NEXT in the nightly run, in its own order (`nightOrder`).
  // The headless night's dream child stops before the reflection
  // (2026-10-11): the reflection runs after it, in a child of its own.
  const dreamChild = (server["env"][NIGHT_CHILD_ENV] ?? "").trim() === "dream";
  // THE TAGGING CHILD, BOTH WAYS (review of #576): its `tags` phase is
  // served only to it, and it is served only that phase — it reads memory
  // text it did not write, and must not reach the dream's setting, launch or
  // begin. Any other session asking for `tags` is refused.
  const tagsChild = (server["env"][NIGHT_CHILD_ENV] ?? "").trim() === "tags";
  if (tagsChild && phase !== "tags") return refused("tags-child", "This is the nightly run's tagging child: only phase \"tags\" is served here.");
  if (!tagsChild && phase === "tags") return refused("night-run-only", "The tags phase is the nightly run's tagging child's alone.");
  // THE PAGE WRITER'S OWN CHILD (2026-10-23, `self.PAGE_SPLIT`), fenced as the
  // tagging child is: it holds the dream tool for its `writer` phase alone,
  // and must not begin the dream. While the page is split the dream's child
  // is not served the writer's phase: it ran first, in its own child.
  const writerChild = (server["env"][NIGHT_CHILD_ENV] ?? "").trim() === "writer";
  if (writerChild && phase !== "writer") return refused("writer-child", "This is the nightly run's day's end child: only phase \"writer\" is served here.");
  if (dreamChild && phase === "writer" && SELF_TUNABLES.PAGE_SPLIT) return refused("writer-child-only", "Tonight day's end runs in a child of its own, before the dream: go on with the dream.");
  // "NO DREAMS" HOLDS PAST THE LAUNCH (review of #650): while the setting is
  // off, `writer` and `begin` called without a launch are refused too — over
  // the HTTP door a routine (or any caller) could otherwise skip the gated
  // launch and dream anyway. A run already under way finishes: today's row is
  // `launched` (a launch, or the hook's headless start), or this server is the
  // headless night's own (a child's or the catch-up's mark, `nightRun`).
  const offWithoutNight = (): boolean =>
    dreams.setting() === "off" && !server["nightRun"]() && server.counterpart.store.dreamAsk(at)?.state !== "launched";
  // WHOSE WORDS (review of #650): the session being served's, as `placeHost`
  // reads it — a Code-tab call on Desktop's server is a Claude Code session.
  const wordsHost: string = server["placeHost"];
  const nextAfter = (part: NightPart, dream: string | null): string | null => {
    const next = nightNext(part);
    if (writerChild) return null;
    if (dreamChild && next === "reflection") return null;
    if (dreamChild && next === "writer" && SELF_TUNABLES.PAGE_SPLIT) return null;
    if (next === "writer") return `Next, day's end: call the dream tool with phase "writer", session: ${session}${dream === null ? "" : `, dream: ${dream}`}.`;
    if (next === "reflection") return `Now wake and reflect: call the reflect tool with phase "begin", session: ${session}, dream: ${dream ?? "<the dream id>"}. Your final message is the text its "finish" call returns.`;
    if (next === "dream") return `Next, the dream: call the dream tool with phase "begin", session: ${session}.`;
    return null;
  };
  try {
    switch (phase) {
      case "launch":
        // The day's row becomes `launched` (claimed, or flipped from an
        // accepted ask), so a run that dies before its dream begins is
        // started again (review of #271).
        // "NO DREAMS" MEANS NO DREAMS (OL1d): while the setting is off, no
        // night starts from here, on any host — a claude.ai routine included.
        // A run already under way finishes (its later phases: `offWithoutNight`).
        if (dreams.setting() === "off") return refused("dreaming-off", DREAMING_OFF_REFUSAL);
        dreams.launched({ at, session });
        server["emit"]("mcp.dream", undefined, { phase: "launch", session });
        return server["result"](
          {
            phase,
            session,
            prompt: dreams.launchPrompt({ session }),
            // The relay is the hand-back line AS IT IS: it carries the dream's
            // mark, which keeps the dream out of what the sweep reads. A
            // retelling in the session's own words would carry none, and the
            // dream's title and changes would read as something that
            // happened (adversarial review of #251).
            how: dreamLaunchHowFor(wordsHost),
          },
          false,
        );
      case "undo": {
        // "UNDO THAT DREAM", SAID (2026-10-12, onboarding round 1, F): a
        // plugin install has no `counterparts dream --undo`, so the owner's
        // word reaches `Dreams.undo` here — the same reversal, never in the
        // nightly run (a dream does not undo itself).
        if (dreamChild || (server["env"][NIGHT_CHILD_ENV] ?? "").trim().length > 0) return refused("night-run", "This is the nightly run: only the owner undoes a dream.");
        const id = typeof args["dream"] === "string" ? args["dream"].trim() : "";
        if (id.length === 0) return refused("dream-required", "Pass `dream`: the id of the dream to undo (the line that told of it names it).");
        if (server.counterpart.store.dream(id) === undefined) return refused("unknown-dream", `No dream ${id} in this memory.`);
        const out = dreams.undo(id);
        if (!out.ok) return refused(out.reason, "Nothing was undone.");
        server["emit"]("mcp.dream", undefined, { phase: "undo", session, reversed: out.reversed, kept: out.kept });
        const kept = out.kept === 0 ? "" : ` ${String(out.kept)} merge${out.kept === 1 ? " was" : "s were"} left as they are: the merged memory changed since, and bringing its originals back would duplicate it.`;
        return server["result"](
          {
            phase,
            dream: id,
            reversed: out.reversed,
            kept: out.kept,
            said: `${out.reversed === 0 ? "That dream had nothing left to reverse; it is marked undone." : `Undone: ${String(out.reversed)} change${out.reversed === 1 ? "" : "s"} reversed — merged memories are back as they were, its links and gists are gone.`}${kept} Its journal entry stays, as a record that it happened.`,
          },
          false,
        );
      }
      case "decline": {
        dreams.decline({ at, session });
        server["emit"]("mcp.dream", undefined, { phase: "decline", session });
        return server["result"]({ phase, session, snoozed: at, said: "Not today — the line will not come back until tomorrow." }, false);
      }
      case "setting": {
        // THE OWNER'S OFF SWITCH (2026-09-28): "no dreams" in conversation.
        const value = args["value"];
        if (typeof value !== "string") {
          return refused("value-required", `Pass \`value\`: auto, ask or off. It is ${dreams.setting()} now.`);
        }
        const out = dreams.setSetting(value, { by: "session", session });
        if (!out.ok) return refused(out.reason, `value is one of ${DREAMING_SETTINGS.join(", ")}. It is ${dreams.setting()} now.`);
        server["emit"]("mcp.dream", undefined, { phase: "setting", setting: out.setting, before: out.before });
        // The setting is the person's wish; the host decides who starts the
        // night, so the words are the served session's host's (OL1d).
        const said: Readonly<Record<DreamingSetting, string>> = settingSaidFor(wordsHost);
        // "No dreams" does not stop a run already going (owner decision D): said.
        const finishes = out.setting === "off" && dreams.nightRunUnderWay() ? ` ${NIGHT_RUN_FINISHES}` : "";
        return server["result"]({ phase, setting: out.setting, before: out.before, said: `${said[out.setting]}${finishes}` }, false);
      }
      case "begin": {
        if (offWithoutNight()) return refused("dreaming-off", DREAMING_OFF_REFUSAL);
        const model = readSession(server["registryDir"], session)?.model;
        // THE RUN MOVED PAST THE WRITER (review of #271): an open claim this
        // session still holds is answered `nothing-to-say` here, when the
        // writer comes before the dream in the run.
        if (nightOrder().indexOf("writer") < nightOrder().indexOf("dream")) server.counterpart.closeNightWriter({ session, phase: "the dream" });
        const out = dreams.begin({ session, scope: server.scope, ...(model === undefined ? {} : { model }) });
        if (!out.ok) {
          return refused(
            out.reason,
            out.reason === "dreamed-today"
              ? "A dream already ran today."
              : out.reason === "dreaming-now"
                ? "Another session's dream is under way; it has the day."
                : out.reason === "nothing-new"
                  ? "Nothing new has been lived since the last dream."
                  : "The dream did not begin.",
          );
        }
        server["emit"]("mcp.dream", out.bundle.dream, {
          phase: "begin",
          session,
          shown: Object.keys(out.bundle.memories).length,
          resumed: out.resumed,
        });
        const handed = server["result"](
          {
            phase,
            session,
            dream: out.bundle.dream,
            ...(out.resumed ? { resumed: true } : {}),
            // IN PARTS (2026-09-28): said up front, never a silent cut.
            ...(out.bundle.parts === null ? {} : { parts: out.bundle.parts }),
            how: dreamHow(out.bundle),
            bundle: out.text,
          },
          false,
        );
        // Part 1 is the begin: its row says how many parts the run owes.
        server["notePart"]("dream", out.bundle.dream, 1, out.bundle.parts?.of ?? 1);
        return handed;
      }
      case "part": {
        const dream = args["dream"];
        const n = args["part"];
        if (typeof dream !== "string" || typeof n !== "number") {
          return refused("dream-and-part-required", "Pass `dream` (the id `begin` returned) and `part` (2 and up).");
        }
        const out = dreams.part({ dream, session, part: n });
        if (!out.ok) return refused(out.reason, out.detail ?? "That dream is not open for this session.");
        server["emit"]("mcp.dream", dream, { phase: "part", part: out.part, of: out.of });
        const handed = server["result"](
          {
            phase,
            dream,
            part: out.part,
            of: out.of,
            bundle: out.text,
            ...(out.part < out.of
              ? { next: `Then part ${String(out.part + 1)}: the dream tool, phase "part", dream: ${dream}, part: ${String(out.part + 1)}.` }
              : { next: "That was the last part. Now propose your changes." }),
          },
          false,
        );
        server["notePart"]("dream", dream, out.part, out.of);
        return handed;
      }
      case "propose": {
        const dream = args["dream"];
        const changes = args["changes"];
        if (typeof dream !== "string" || !Array.isArray(changes)) {
          return refused("dream-and-changes-required", "Pass `dream` (the id `begin` returned) and `changes`, an array.");
        }
        // SHORT IDS READ BACK (2026-10-23): a lean dream's m1… are its own,
        // for its life; real ids pass as they came.
        const aliases = dreams.aliasesOf(dream);
        const sent = aliases === null ? changes : (aliases.resolveIn(changes, ID_KEYS) as unknown[]);
        const out = dreams.propose({ dream, session, changes: sent as never });
        if (!out.ok) return refused(out.reason, "That dream is not open for this session.");
        server["emit"]("mcp.dream", dream, { phase: "propose", applied: out.results.filter((r) => r.ok).length });
        const refusedN = out.results.filter((r) => !r.ok).length;
        // Each refusal names what tripped it (`detail`); 2026-09-28.
        const again = refusedN === 0 ? {} : { again: `${String(refusedN)} change${refusedN === 1 ? " was" : "s were"} not applied (see each one's reason and detail). Fix those and propose just them again; the rest already landed.` };
        // A SHORT ANSWER (2026-10-23, lean): counts of what landed, the
        // memories it made, what was said about a landed one, and every
        // refusal whole — the per-change "ok" lines carried nothing else.
        if (aliases !== null) return server["result"]({ phase, dream, ...briefChanges(out.results, aliases), ...again }, false);
        return server["result"]({ phase, dream, results: out.results, ...again }, false);
      }
      case "journal": {
        const dream = args["dream"];
        const text = args["text"];
        if (typeof dream !== "string" || typeof text !== "string") {
          return refused("dream-and-text-required", "Pass `dream` and the journal `text`.");
        }
        const title = args["title"];
        const out = dreams.journal({ dream, session, text, ...(typeof title === "string" ? { title } : {}) });
        if (!out.ok) return refused(out.reason, "detail" in out && out.detail !== undefined ? out.detail : "The journal was not written.");
        server["emit"]("mcp.dream", dream, { phase: "journal" });
        const next = nextAfter("dream", dream);
        return server["result"](
          {
            phase,
            dream,
            handBack: out.handBack,
            ...(out.note === undefined ? {} : { note: out.note }),
            next: `${next ?? `Return \`handBack\` as your final message, unchanged.${dreamChild ? " The reflection runs after you, in a session of its own." : ""}`}${next === null ? "" : " If the rest of the run fails, return `handBack` unchanged as your final message instead."}`,
          },
          false,
        );
      }
      case "writer": {
        // THE NIGHTLY RUN'S PAGE WRITER (2026-09-28): the night's day to read,
        // handed through this result rather than beside the wake — the page
        // whole, no injection ceiling, no `no-room`. It is the run's FIRST
        // part (the owner's order), so the night's claim is written here, for
        // this session and this run; a claim this session already holds is
        // reused (a run started again the same day claims nothing twice).
        if (offWithoutNight()) return refused("dreaming-off", DREAMING_OFF_REFUSAL);
        const dreamArg = typeof args["dream"] === "string" ? args["dream"] : null;
        const claim = server.counterpart.claimNightWriter({ session, run: dreamArg ?? `night of ${at}` });
        const out = server.counterpart.nightWriter({ session, tool: NIGHT_WRITER_TOOL });
        const next = nextAfter("writer", dreamArg);
        if (!out.ok) {
          server["emit"]("mcp.dream", dreamArg ?? undefined, { phase: "writer", writer: claim.reason });
          const why: Record<string, string> = {
            off: "the owner has day's end off",
            "no-previous-day": "this store has no day before today yet",
            "no-memories": `nothing was written down on ${claim.about}`,
            "already-claimed": `${claim.about} was already written or answered`,
            "asks-spent": `${claim.about} has been offered twice already`,
          };
          return server["result"](
            {
              phase,
              writer: false,
              reason: claim.reason,
              said: `No page writing tonight — ${why[claim.reason] ?? claim.reason}. Leave the page as it stands.`,
              ...(next === null ? {} : { next }),
            },
            false,
          );
        }
        server["emit"]("mcp.dream", dreamArg ?? undefined, { phase: "writer", about: out.about, considered: out.considered, dropped: out.dropped });
        return server["result"](
          {
            phase,
            writer: true,
            about: out.about,
            ifVersion: out.version ?? NO_PAGE_VERSION,
            read: out.text,
            // HELD TO THE ROOM (2026-10-20; #358 had a tighten-and-resend
            // retry here, and 2026-10-10 a short version in the same call):
            // the room in bytes, said plainly; a page past it is sent back
            // once, with how far over, to be cut and sent again.
            how:
              `Read the block. If something about who you are moved on ${out.about}, call the self_page tool with the WHOLE page, reason, ifVersion: ${String(out.version ?? NO_PAGE_VERSION)} and session: ${session}; if nothing moved, write nothing — that is an answer too. The whole page has ${String(server.counterpart.self.tunables.PAGE_ROOM_BYTES)} bytes of room (UTF-8), and should stay thin. If self_page answers past-room, cut by \`over\` bytes or more and send the whole page again — cut, don't add a short version. If the answer has a roomNote, do what it says before you go on.` +
              // THE DAY SUMMARY (2026-10-23, lane D2, `self.DAY_SUMMARY`, read at use).
              (SELF_TUNABLES.DAY_SUMMARY ? ` ${daySummaryHow(out.about, session)}` : ""),
            ...(next === null ? {} : { next: `Then: ${next}` }),
          },
          false,
        );
      }
      case "tags": {
        // THE NIGHT'S TAGGING (2026-10-21, wave 2 lane B; `core/dream/tags.ts`):
        // without answers, what to tag, merge and sort; with them, written as
        // the night's (`via: night`), each item refused by name when it
        // cannot be taken. The run's id names the night in every record.
        const run = (server["env"][NIGHT_RUN_ENV] ?? "").trim() || `session:${session}:${at}`;
        const answered = args["tagged"] !== undefined || args["merges"] !== undefined || args["kinds"] !== undefined;
        if (!answered) {
          const b = askTags(server.counterpart.store, run, closed);
          server["emit"]("mcp.dream", undefined, { phase: "tags", on: b.on, memories: b.memories.length, untagged: b.untagged, pairs: b.pairs.length, cards: b.cards.length });
          return server["result"](
            {
              phase,
              read: renderTagsBundle(b),
              how: b.on
                ? `Answer in one call: the dream tool with phase "tags", session: ${session}, and \`tagged\`, \`merges\` and \`kinds\` as the lines ask. Leave out what you cannot judge.`
                : "Nothing to do tonight.",
            },
            false,
          );
        }
        const out = applyTagsAnswer(server.counterpart.store, { tagged: args["tagged"], merges: args["merges"], kinds: args["kinds"] }, { run });
        server["emit"]("mcp.dream", undefined, { phase: "tags", memories: out.memories, tags: out.tags, merged: out.merged, notSame: out.notSame, kinds: out.kinds, refused: out.refused.length });
        return server["result"](
          {
            phase,
            tagged: out.memories,
            tags: out.tags,
            merged: out.merged,
            keptApart: out.notSame,
            kinds: out.kinds,
            ...(out.refused.length === 0 ? {} : { refused: out.refused.slice(0, 20) }),
            said: out.on ? "Recorded. That is all tonight." : "Tagging is switched off tonight; nothing was written.",
          },
          !out.on,
        );
      }
      default:
        return refused("phase-unknown", "phase is one of launch, begin, part, propose, journal, writer, decline, setting, tags.");
    }
  } catch (err) {
    return refused("threw", String((err as Error).message ?? err));
  }
}

/**
 * `reflect` — the waking self (`core/dream/reflect.ts`, 2026-09-27). Every
 * phase binds the session, as `dream` does; `launch` writes nothing.
 */
export function reflectTool(server: McpServer, sent: Record<string, unknown>): ToolResult {
  const phase = sent["phase"];
  if (server.observer) return server["standDown"]("reflect");
  const bound = server["requireBoundSession"](sent["session"], "reflect");
  if (bound !== null) return bound;
  const session = server.session as string;
  if (phase === "launch" || phase === "begin") {
    const held = server["nightHeld"]("reflect", phase);
    if (held !== null) return held;
  }
  server.counterpart.fenceNight(server["folderOn"]());
  const reflections = server.counterpart.reflections;
  const refused = (reason: string, detail: string): ToolResult => server["refuse"]("reflect", reason, { phase, detail });
  // SHORT IDS READ BACK (2026-10-23): a lean reflection's m1… — its dream's
  // numbers, then its own — for its life, in what it writes; real ids pass
  // as they came, and words are never touched.
  const aliases = typeof sent["reflection"] === "string" && (phase === "finish" || phase === "settle") ? reflections.aliasesOf(sent["reflection"]) : null;
  const args = aliases === null ? sent : (aliases.resolveIn(sent, ID_KEYS) as Record<string, unknown>);
  // …and the answer names them short, as the reflection knows them (review of #602).
  const asShort = <T>(v: T): T => (aliases === null ? v : (JSON.parse(aliases.inText(JSON.stringify(v))) as T));
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const part = (v: unknown): { text?: string; cites?: string[]; short?: string; claims?: { text: string; cites: string[] }[] } | null => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const r = v as Record<string, unknown>;
    return {
      ...(typeof r["text"] === "string" ? { text: r["text"] } : {}),
      cites: ids(r["cites"]),
      // The page's short version (2026-10-10); the share has none.
      ...(typeof r["short"] === "string" ? { short: r["short"] } : {}),
      // The page's cites per passage (2026-10-20); the share has none.
      ...(Array.isArray(r["claims"])
        ? {
            claims: (r["claims"] as unknown[]).flatMap((c) => {
              if (c === null || typeof c !== "object" || Array.isArray(c)) return [];
              const x = c as Record<string, unknown>;
              return typeof x["text"] === "string" ? [{ text: x["text"], cites: ids(x["cites"]) }] : [];
            }),
          }
        : {}),
    };
  };
  try {
    switch (phase) {
      case "launch":
        server["emit"]("mcp.reflect", undefined, { phase: "launch", session });
        return server["result"](
          {
            phase,
            session,
            // After a dream whose run was cut off before it reflected
            // (review of #271): the reflection alone, on that dream.
            prompt: reflections.launchPrompt({ session, dream: typeof args["dream"] === "string" ? args["dream"] : null }),
            how: reflectLaunchHowFor(server["placeHost"]),
          },
          false,
        );
      case "begin": {
        const model = readSession(server["registryDir"], session)?.model;
        const dream = typeof args["dream"] === "string" ? args["dream"] : null;
        // The same at the reflection, when the writer comes before it.
        if (nightOrder().indexOf("writer") < nightOrder().indexOf("reflection")) server.counterpart.closeNightWriter({ session, phase: "the reflection" });
        const folderOn = server["folderOn"]();
        const out = reflections.begin({ session, dream, scope: server.scope, ...(model === undefined ? {} : { model }), ...(folderOn === undefined ? {} : { folderOn }) });
        if (!out.ok) {
          return refused(
            out.reason,
            out.reason === "reflected-today"
              ? "A reflection already finished today."
              : out.reason === "dream-not-journaled"
                ? "That dream has not written its journal yet."
                : "The reflection did not begin.",
          );
        }
        server["emit"]("mcp.reflect", out.bundle.reflection, { phase: "begin", session, shown: Object.keys(out.bundle.memories).length });
        const handed = server["result"](
          {
            phase,
            session,
            reflection: out.bundle.reflection,
            questions: out.bundle.questions,
            // IN PARTS (2026-09-28): said up front, never a silent cut.
            ...(out.bundle.parts === null ? {} : { parts: out.bundle.parts }),
            // THE LOOKUP, with its number (2026-09-28; `PACK_MARGIN` holds room for it).
            how: `${out.instructions}\nWhat is shown only in part (fidelity excerpt, line or id): read it whole with the recall tool, ids: [...] — up to ${String(RECALL_MAX_IDS)} at once.`,
            bundle: out.text,
          },
          false,
        );
        server["notePart"]("reflection", out.bundle.reflection, 1, out.bundle.parts?.of ?? 1);
        return handed;
      }
      case "part": {
        const reflection = args["reflection"];
        const n = args["part"];
        if (typeof reflection !== "string" || typeof n !== "number") {
          return refused("reflection-and-part-required", "Pass `reflection` (the id `begin` returned) and `part` (2 and up).");
        }
        const out = reflections.part({ reflection, session, part: n });
        if (!out.ok) return refused(out.reason, out.detail ?? "That reflection is not open for this session.");
        server["emit"]("mcp.reflect", reflection, { phase: "part", part: out.part, of: out.of });
        const handed = server["result"](
          {
            phase,
            reflection,
            part: out.part,
            of: out.of,
            bundle: out.text,
            ...(out.part < out.of ? { next: `Then part ${String(out.part + 1)}: the reflect tool, phase "part", reflection: ${reflection}, part: ${String(out.part + 1)}.` } : { next: "That was the last part. Answer the questions, then call finish." }),
          },
          false,
        );
        server["notePart"]("reflection", reflection, out.part, out.of);
        return handed;
      }
      case "finish": {
        const reflection = args["reflection"];
        const entry = args["entry"];
        // `entry` is required the first time; a second finish of the same
        // reflection (2026-09-28) may leave it out — the entry stands.
        if (typeof reflection !== "string" || (entry !== undefined && typeof entry !== "string")) {
          return refused("reflection-and-entry-required", "Pass `reflection` (the id `begin` returned) and your `entry`.");
        }
        const model = readSession(server["registryDir"], session)?.model;
        const folderOn = server["folderOn"]();
        const out = reflections.finish({
          reflection,
          session,
          ...(folderOn === undefined ? {} : { folderOn }),
          ...(typeof entry === "string" ? { entry } : {}),
          ...(typeof args["title"] === "string" ? { title: args["title"] } : {}),
          cites: ids(args["cites"]),
          share: part(args["share"]),
          ...(typeof args["line"] === "string" ? { line: args["line"] } : {}),
          page: part(args["page"]),
          feelings: Array.isArray(args["feelings"]) ? (args["feelings"] as never) : [],
          about: Array.isArray(args["about"]) ? (args["about"] as never) : [],
          core: Array.isArray(args["core"]) ? (args["core"] as never) : [],
          traits: Array.isArray(args["traits"]) ? (args["traits"] as never) : [],
          close: ids(args["close"]),
          closeNow: Array.isArray(args["closeNow"]) ? (args["closeNow"] as never) : [],
          // Beliefs (lane C, 2026-10-21): checked item by item in the core.
          ...(args["beliefs"] !== null && typeof args["beliefs"] === "object" && !Array.isArray(args["beliefs"]) ? { beliefs: args["beliefs"] as never } : {}),
          scope: server.scope,
          model: model ?? null,
        });
        if (!out.ok) {
          return refused(
            out.reason,
            out.detail ??
              (out.reason === "reflection-closed"
                ? "That reflection is closed: it is not today's, or a newer one followed it. Begin a new one tomorrow."
                : "The reflection was not written."),
          );
        }
        const o = out.outcome;
        server["emit"]("mcp.reflect", reflection, { phase: "finish", nothingMuch: o.nothingMuch, page: o.page.written, share: o.share.offered, again: o.again });
        return server["result"](
          {
            phase,
            reflection,
            handBack: o.handBack,
            nothingMuch: o.nothingMuch,
            entry: o.entryId,
            entryNote: o.entry,
            page: o.page,
            share: o.share,
            ...(o.line.reason === "no-line" ? {} : { line: o.line }),
            // A SHORT ANSWER (2026-10-23, lean): counts, notes and what was not written, part by part.
            ...(aliases === null
              ? {
                  returned: o.returned,
                  feelings: o.feelings,
                  about: o.about,
                  ...(o.traits.length > 0 ? { traits: o.traits } : {}),
                  ...(o.beliefs.births.length + o.beliefs.filings.length + o.beliefs.retire.length > 0 ? { beliefs: o.beliefs } : {}),
                }
              : {
                  returned: briefParts(o.returned.map((r) => ({ id: r.id, ok: r.counted, reason: r.reason })), aliases),
                  feelings: briefParts(o.feelings, aliases),
                  about: briefParts(o.about, aliases),
                  ...(o.traits.length > 0 ? { traits: briefParts(o.traits, aliases) } : {}),
                  ...(o.beliefs.births.length + o.beliefs.filings.length + o.beliefs.retire.length + o.beliefs.adopt.length > 0
                    ? { beliefs: { births: briefParts(o.beliefs.births, aliases), filings: briefParts(o.beliefs.filings, aliases), retire: briefParts(o.beliefs.retire, aliases), adopt: briefParts(o.beliefs.adopt, aliases) } }
                    : {}),
                }),
            ...(o.refusedCites.length > 0 ? { refusedCites: asShort(o.refusedCites) } : {}),
            ...(o.close.proposed.length > 0 || o.close.closed.length > 0 || o.close.refused.length > 0 ? { close: asShort(o.close) } : {}),
            // WHAT WAS NOT WRITTEN, and that it can be sent again (2026-09-28).
            ...(o.retry === null ? {} : { again: asShort(o.retry) }),
            say:
              o.retry === null
                ? "Return `handBack` as your final message, unchanged."
                : o.page.reason === "past-room"
                  ? "The page was sent back past its room (see `again`): cut it and call finish again with the same reflection and just page, before anything else; fix any other part in `again` the same way. Then return the `handBack` of your last finish call as your final message, unchanged. Never say a part was written when it was not."
                  : "Some parts were not written (see `again`). You may fix them and call finish again with the same reflection and just those parts; then return the `handBack` of your last finish call as your final message, unchanged. Never say a part was written when it was not.",
          },
          false,
        );
      }
      case "settle": {
        // THE REFLECTION MAY SETTLE (2026-09-29): two memories it was shown,
        // with a plain reason; the trail names the reflection.
        const reflection = args["reflection"];
        const holds = args["holds"];
        const over = args["over"];
        if (typeof reflection !== "string" || typeof holds !== "string" || typeof over !== "string") {
          return refused("reflection-holds-over-required", "Pass `reflection`, `holds` and `over` (two ids it was shown), `how` and `why`.");
        }
        const out = reflections.settle({
          reflection,
          session,
          holds,
          over,
          how: typeof args["how"] === "string" ? args["how"] : "",
          why: typeof args["why"] === "string" ? args["why"] : "",
        });
        server["emit"]("mcp.reflect", reflection, { phase: "settle", ok: out.ok });
        return server["result"]({ phase, reflection, settle: asShort({ ...out }) }, !out.ok);
      }
      case "told": {
        const reflection = args["reflection"];
        if (typeof reflection !== "string") return refused("reflection-required", "Pass `reflection`, the id the share named.");
        const out = reflections.told({ reflection, session });
        if (!out.ok) return refused(out.reason, "Nothing to record: the share was already told, or there was none.");
        server["emit"]("mcp.reflect", reflection, { phase: "told", cited: out.cited });
        return server["result"]({ phase, reflection, told: true, cited: out.cited }, false);
      }
      case "close": {
        // A YES TO THE CLOSE PROPOSALS (2026-10-16, #489 D): the owner agreed,
        // when asked in the share, that some open threads are done.
        const reflection = args["reflection"];
        const close = ids(args["close"]);
        if (typeof reflection !== "string" || close.length === 0) {
          return refused("reflection-and-close-required", "Pass `reflection` (the id the share named) and `close`: the ids the owner agreed are done.");
        }
        const out = reflections.close({ reflection, session, ids: close, scope: server.scope });
        if (!out.ok) {
          return refused(out.reason, out.reason === "nothing-proposed" ? "That reflection proposed closing nothing." : "Nothing was closed.");
        }
        server["emit"]("mcp.reflect", reflection, { phase: "close", closed: out.closed.length, refused: out.refused.length });
        return server["result"]({ phase, reflection, closed: out.closed, ...(out.already.length > 0 ? { alreadyClosed: out.already } : {}), ...(out.refused.length > 0 ? { refused: out.refused } : {}) }, out.closed.length === 0 && out.already.length === 0);
      }
      case "reopen": {
        // THE WAY BACK (2026-10-20, an experiment): the owner said a thread the
        // reflection closed itself is not done. The thread's id is enough (review
        // of #535): the reflection is the one the memory names.
        const reflection = typeof args["reflection"] === "string" && args["reflection"].length > 0 ? args["reflection"] : null;
        const reopen = ids(args["reopen"]);
        if (reopen.length === 0) {
          return refused("reopen-required", "Pass `reopen`: the ids of the threads the owner says are not done.");
        }
        const out = reflections.reopen({ reflection, session, ids: reopen, scope: server.scope });
        if (!out.ok) {
          return refused(out.reason, out.reason === "nothing-closed" ? "That reflection closed nothing itself." : "Nothing was reopened.");
        }
        server["emit"]("mcp.reflect", reflection ?? undefined, { phase: "reopen", reopened: out.reopened.length, refused: out.refused.length });
        return server["result"]({ phase, ...(reflection === null ? {} : { reflection }), reopened: out.reopened, ...(out.already.length > 0 ? { alreadyOpen: out.already } : {}), ...(out.refused.length > 0 ? { refused: out.refused } : {}) }, out.reopened.length === 0 && out.already.length === 0);
      }
      case "join": {
        // A YES TO THE SHARE'S PROJECT QUESTION (2026-10-21, wave 2 lane G):
        // the two folders it named become one project, joined by the night.
        // Only the owner's yes, in an awake session, after he heard the
        // question (review of #580): never the nightly run, never a share not
        // yet told, never a proposal that no longer stands.
        if ((server["env"][NIGHT_CHILD_ENV] ?? "").trim().length > 0 || (server["env"][NIGHT_RUN_ENV] ?? "").trim().length > 0) return refused("night-run", "This is the nightly run: only the owner's yes joins two folders.");
        const reflection = args["reflection"];
        if (typeof reflection !== "string") return refused("reflection-required", "Pass `reflection`: the id the share named.");
        const asked = reflections.joinProposal(reflection);
        if (asked === null) return refused("nothing-proposed", "That reflection asked to join no folders, or the owner's yes is already recorded.");
        if (server.counterpart.store.reflection(reflection)?.share_state !== "told") {
          return refused("share-not-told", "Tell the share first and mark it told (phase \"told\"); the yes must follow the owner hearing the question.");
        }
        const folderOn = server["folderOn"]();
        const stale = joinStillStands(server.counterpart.store, asked, { day: server.counterpart.store.livedDay(), ...(folderOn === undefined ? {} : { folderOn }) });
        if (stale !== null) return refused(stale.reason, `${stale.detail} Nothing was joined.`);
        const out = server.counterpart.joinProject({ folder: asked.folder, project: asked.into, by: "night" });
        if (!out.ok) return refused(out.reason, `${out.detail} Nothing was joined.`);
        reflections.recordJoined(reflection, out.project.id, session);
        server["emit"]("mcp.reflect", reflection, { phase: "join", changed: out.changed });
        return server["result"]({ phase, reflection, joined: out.folder, project: { id: out.project.id, name: out.project.name, folders: out.project.folders.map((f) => f.folder) }, changed: out.changed }, false);
      }
      default:
        return refused("phase-unknown", "phase is one of launch, begin, part, finish, settle, told, close, reopen, join.");
    }
  } catch (err) {
    return refused("threw", String((err as Error).message ?? err));
  }
}

/**
 * `self_page` — read the page, or write it whole.
 *
 * **It binds no session, exactly as `remember` does not.** The page is not one
 * session's account of itself the way a chapter is; it is the standing one,
 * and a session that can write a note about the world can write the page about
 * itself. The `by` field on the row says `session` for everything that comes
 * through here, and no argument can change it: the console writes `owner` and
 * the nightly writer will write `writer`, from their own doors.
 *
 * READING is allowed in every stance the tool answers in at all, including
 * observer — "what does my page say" must always be answerable — and the
 * stand-down guards the WRITE alone, which is the shape `scope` already has.
 */
export function selfPageTool(server: McpServer, args: Record<string, unknown>): ToolResult {
  const body = args["body"];
  const short = args["short"];
  if (short !== undefined && typeof short !== "string") {
    return server["refuse"]("self_page", "short-not-text", {
      detail: "`short` is the short version of the page, as text — or leave it out.",
    });
  }
  // THE DAY SUMMARY (2026-10-23, lane D2, `self.DAY_SUMMARY`): day's end's
  // few lines about the day, with its closing call — beside the page, or
  // alone when the page stands. Alone, it is not a read.
  const summaryArg = args["summary"];
  if (body === undefined && short === undefined && summaryArg === undefined) return server["selfPageRead"]();
  if (server.observer) return server["standDown"]("self_page");
  if (summaryArg !== undefined && typeof summaryArg !== "string") {
    return server["refuse"]("self_page", "summary-not-text", {
      detail: "`summary` is day's end's few lines about the day, as text — or leave it out. Nothing was written.",
    });
  }
  // A NON-STRING body is a malformed call and stops here; an EMPTY one goes
  // THROUGH the seam, because the seam is what writes the durable refusal row
  // this tool's own description promises. The short-circuit that used to catch
  // both left `self_page({ body: "   " })` as the one refusal on this path
  // with no row behind it (adversarial review m4).
  if (body !== undefined && typeof body !== "string") {
    return server["refuse"]("self_page", "body-required", {
      detail:
        "A page has to say something. Pass the whole page as text; omit `body` entirely to read the one that is there.",
    });
  }
  const reason = args["reason"];
  const ifVersion = args["ifVersion"];
  if (
    ifVersion !== undefined &&
    (typeof ifVersion !== "number" || !Number.isInteger(ifVersion) || ifVersion < NO_PAGE_VERSION)
  ) {
    return server["refuse"]("self_page", "if-version-not-a-number", {
      detail:
        "`ifVersion` is the whole number the read gave you as `version` (-1 when there was no page), or leave it out.",
    });
  }
  // BIND FIRST, AND NON-FATALLY. This server is launched from a static host
  // configuration and never learns which session it serves; it binds lazily,
  // on the first tool call that carries an id (`requireBoundSession`). Every
  // other tool that needs one REFUSES without it — but this one has always
  // worked unbound, so a session claim here is honoured when it corroborates
  // and simply not honoured when it does not. The page is never refused over
  // it: what a bad claim costs is the `writer` label, and the ring says why.
  //
  // Without this, the page-writer ask could not work at all in session mode.
  // A session answering it right after its wake has called nothing else, so
  // `this.session` is null, so the registry mark is never read, so every
  // night's revision was filed as an ordinary amendment and the night read
  // as "nothing to say" — the exact inverse of the honesty this is for.
  const claimedSession = server["bindForPageWriter"](args["session"]);
  // WHICH DOOR THIS IS. `by` is the door's and is not claimable from outside
  // (`self/page.ts`), so the model's word for "I am the nightly writer" is
  // worth nothing here. What the server reads instead is the mark the
  // SessionStart hook left on this session's registry record when it handed
  // over the page-writer ask, and it is a DATE: a session asked to write
  // about 09-19 writes `writer` for that run and nothing else, and a stale
  // mark cannot relabel a write made two days later (`adapters/sessions.ts`).
  // DAY'S END TOLD THE DAY ALONE, THEN WROTE THE PAGE ANYWAY (the edge
  // recorded at #606's merge): the alone call answered the night and closed
  // the claim, so the mark is gone — but this is still day's end, and the
  // night's row must say the page changed. Only a page, only the same
  // session on the same day, only before the dream begins (`daysEndStood`).
  const stood = typeof body === "string" ? daysEndStood(server, claimedSession) : null;
  const writerFor = server["pageWriterMark"](claimedSession) ?? (stood === null ? null : { about: stood.about, mode: stood.mode });
  // THE PAGE WRITER'S OWN CHILD (2026-10-23, `self.PAGE_SPLIT`; review of
  // #603): every page write it makes is the writer's, held to the writer's
  // lane — its first write closes the night's claim, and a resend after it
  // was labelled the session's and wrote the whole page.
  const writerChild = (server["env"][NIGHT_CHILD_ENV] ?? "").trim() === "writer";
  const model = server["sessionModel"]();
  const said = typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;
  // WHAT IT RESTS ON (2026-10-23, day's end): the memory ids the page, or
  // each sentence of it, rests on — the trace the reflection's finish already
  // sends. Only ids of memories in this store are kept; the rest are named
  // back. None sent: the trace already there is kept for the same text, as
  // before.
  const cited = pageTraceArgs(server, args);
  // THE DAY SUMMARY, AT THE DOOR (2026-10-23, lane D2): read before anything
  // is written, so a summary past its cap leaves nothing half done — the
  // page and the summary are sent again together. Kept only from day's end
  // (this session's open night claim) with the switch on; otherwise said
  // back, never dropped unsaid.
  const told = typeof summaryArg === "string" ? daySummaryArgs(server, summaryArg, args["summaryCites"], writerFor !== null) : null;
  if (told !== null && told.refusal !== null) {
    return server["refuse"]("self_page", told.refusal.reason, { ...told.refusal.numbers, detail: told.refusal.detail });
  }
  const alone = body === undefined && short === undefined;
  // With a short version alone it is not the night's answer (that row is
  // written with the page), so it is not kept there either.
  const notKept =
    told === null ? null : told.notKept ?? (typeof body !== "string" && !alone ? "A day summary goes with day's end's page, or alone when the page stands — not with a short version on its own." : null);
  if (alone && told !== null && notKept !== null) {
    return server["refuse"]("self_page", told.notKept === null ? "summary-not-kept" : told.notKeptReason, { detail: `${notKept} Nothing was written.` });
  }
  const keep = told !== null && notKept === null ? told : null;
  if (alone && keep !== null && writerFor !== null) {
    // ALONE: the night answered as the page standing, with the day told.
    return daysEndAlone(server, { writerFor, claimedSession, told: keep });
  }
  const common = {
    ...(model === undefined ? {} : { model }),
    by: writerFor === null && !writerChild ? ("session" as const) : ("writer" as const),
    // WHICH SESSION, when this server has one. `remember` resolves it the same
    // way; null is recorded rather than a guess (adversarial review M3).
    session: server.session,
    ...(ifVersion === undefined ? {} : { ifVersion }),
  };
  // THE SHORT VERSION (2026-10-10): beside the page, or — with no `body` —
  // added to the page as it stands, as a revision of the same text.
  const written =
    typeof body === "string"
      ? server.counterpart.revisePage(body, { ...common, reason: said ?? "amended", ...(short === undefined ? {} : { short }), ...(cited.trace === null ? {} : { trace: cited.trace }) })
      : server.counterpart.addPageShort(short ?? "", { ...common, ...(said === null ? {} : { reason: said }) });
  server["emit"]("mcp.self_page", written.id ?? undefined, {
    stored: written.written,
    reason: written.reason,
    bytes: written.bytes,
    version: written.version,
    writerFor: writerFor?.about ?? null,
    writerMode: writerFor?.mode ?? null,
  });
  // THE NIGHT'S OWN ROW, closed here because this is where the answer arrives.
  // Both arms are recorded: a refused revision is the writer having run and
  // been turned away, which is a different fact from a night that never
  // started, and only the row can tell them apart afterwards. A recording
  // failure costs the row and never the write (§5 G7).
  // A short version added on its own is not the night's page: the night's
  // row was written with the page.
  if (writerFor !== null && typeof body === "string") {
    try {
      server.counterpart.recordPageWriterRun({
        about: writerFor.about,
        mode: writerFor.mode,
        outcome: written.written ? "revised" : "refused",
        // A refusal for length carries its numbers (review of #358), so the
        // row — and the night's close, if the run moves on without a
        // shorter page — says how far over it was.
        detail: written.written
          ? ""
          : written.reason === "too-large"
            ? pageTooLargeDetail(written.bytes, server.counterpart.self.tunables.PAGE_MAX_BYTES)
            : written.reason === "past-room" && written.overRoom !== null
              ? `past-room: ${String(written.bytes)} bytes, ${String(written.bytes - written.overRoom)} over the ${String(written.overRoom)}-byte room`
              : written.reason,
        bytesAfter: written.written ? written.bytes : 0,
        // After a summary sent alone, the page it stood on and what the claim was handed.
        ...(stood === null ? {} : { bytesBefore: stood.bytesAfter, considered: stood.considered, omitted: stood.omitted }),
        // THE DAY SUMMARY rides on the night's own row (2026-10-23, lane D2),
        // with the session and run that told it, so the dream finds it.
        // Only on a page written (review of D2): a refused page's summary is
        // sent again with the page, and kept then.
        // Sent alone earlier (`stood`), it is carried onto this row, so the
        // night's answer and its summary stay one row; a summary sent again
        // with this page is the later telling and stands instead.
        ...(!written.written
          ? {}
          : keep !== null
            ? summaryRow(server, claimedSession, keep, stood?.run)
            : stood !== null
              ? { summary: stood.summary, summaryCites: stood.summaryCites, session: stood.session, run: stood.run }
              : {}),
      });
    } catch {
      /* the page is written; the bookkeeping is not worth the answer */
    }
  }
  // What became of a summary sent with this call, said (lane D2).
  // Day's end's page written with no summary, while day summaries are on:
  // said, since the night is answered now and its dream opens without one.
  const notSent =
    told === null && stood !== null && written.written
      ? { summary: { kept: true, about: stood.about, chars: charCount(stood.summary), cites: stood.summaryCites.length, sentEarlier: true } }
      : told === null && writerFor !== null && typeof body === "string" && written.written && SELF_TUNABLES.DAY_SUMMARY
        ? { summaryNotSent: "No day summary came with this write, so tonight's dream opens without one." }
        : {};
  const toldAnswer =
    told === null
      ? notSent
      : keep === null || writerFor === null || typeof body !== "string"
        ? { summaryNotKept: notKept ?? "A day summary is kept with day's end's write only." }
        : !written.written
          ? { summaryNotKept: "The page was not written, so neither was the summary: send it again with the page." }
          : { summary: { kept: true, about: writerFor.about, chars: charCount(keep.text), cites: keep.cites.length }, ...(keep.refused.length === 0 ? {} : { refusedSummaryCites: keep.refused }) };
  if (!written.written) {
    // THE CEILING, IN NUMBERS (2026-10-09): a writer told only "past the
    // limit" guesses how much to take out; told both numbers, it tightens
    // once and sends the page again.
    const limit = server.counterpart.self.tunables.PAGE_MAX_BYTES;
    return server["refuse"]("self_page", written.reason, {
      bytes: written.bytes,
      ...(written.reason === "too-large" ? { limit, over: written.bytes - limit } : {}),
      // HELD TO THE ROOM (2026-10-20): the room and how far over, to cut by.
      ...(written.reason === "past-room" && written.overRoom !== null
        ? { room: written.overRoom, over: written.bytes - written.overRoom }
        : {}),
      ...(written.short === null ? {} : { short: written.short }),
      ...(written.gate === null ? {} : { gate: written.gate }),
      // On a stale write, hand back what is actually there so the session can
      // merge rather than guess — the whole point of the check.
      ...(written.current === null
        ? {}
        : { currentVersion: written.current.version, currentBody: written.current.body }),
      ...toldAnswer,
      detail: PAGE_REFUSAL_DETAIL[written.reason] ?? "The page was not written.",
    });
  }
  return server["result"](
    {
      stored: true,
      reason: written.reason,
      id: written.id,
      version: written.version,
      bytes: written.bytes,
      // THE GATE CHANGED IT. Accepted is not the same as unaltered, and a
      // session told only `stored: true` would go on believing it wrote what
      // it sent (m1).
      ...(written.redacted === null
        ? {}
        : {
            redacted: true,
            redactedBy: written.redacted.gate,
            bytesBeforeRedaction: written.redacted.bytesBefore,
          }),
      // PAST ITS ROOM, SAID (2026-10-10): kept whole, and what sessions read
      // on a day the wake cannot hold it — its short version, or, without
      // one, its outline, with the way to add one.
      ...pageRoomAnswer(written, server.counterpart.self.tunables.PAGE_ROOM_BYTES),
      // HELD TO ITS LANE, SAID (2026-10-23, `self.PAGE_SPLIT`).
      ...pageLaneAnswer(written),
      // WHAT IT RESTS ON, SAID (2026-10-23): how the claims sent landed, and
      // the ids that name no memory here.
      ...(written.traced === undefined ? {} : { traced: written.traced }),
      ...(cited.refused.length === 0 ? {} : { refusedCites: cited.refused }),
      ...toldAnswer,
      // WHEN IT WILL BE READ, precisely. The bundle every session wakes with
      // is composed by a worker and served unchanged until the next render,
      // so "it is live now" would be false for as long as this session lasts.
      // Since 2026-09-30 the write marks the wake behind and the next turn's
      // end re-renders it (`self/behind.ts`).
      appearsAtWake: "the next session's wake, once a turn has ended — the worker a turn's end starts re-renders it",
    },
    false,
  );
}

/**
 * WHAT DAY'S END IS ASKED FOR, beside the page (2026-10-23, lane D2): the
 * day summary, on its one closing call — with the page, or alone when the
 * page stands. Bedtime rehearsal: the dream reads it first.
 */
export function daySummaryHow(about: string, session: string): string {
  return (
    `Then tell the day: in that same self_page call — or, only if you leave the page as it stands, in a self_page call with session: ${session} and no body, which answers the night — send \`summary\`: a few lines, first person, at most ${String(SELF_TUNABLES.DAY_SUMMARY_CHARS)} characters, about what ${about} was about and what is in motion, and \`summaryCites\`: the ids (mem_…) of the memories it rests on. ` +
    "Tonight's dream reads it first, and later reflections read it as that day's line. It is sent once, with the night's answer: a page written without one closes the night without one."
  );
}

/** Characters as a reader counts them: code points, so an emoji is one (review of D2). */
function charCount(text: string): number {
  return [...text].length;
}

/** A day summary as the door read it (2026-10-23, lane D2). */
interface DaySummaryArgs {
  readonly text: string;
  /** The memory ids it rests on that name a memory here. */
  readonly cites: readonly string[];
  /** What was sent as a cite and names no memory here, named back. */
  readonly refused: readonly string[];
  /** Why it is not kept (the switch off, not day's end), or null. */
  readonly notKept: string | null;
  readonly notKeptReason: string;
  /** Refused outright, with nothing written: empty, or past its cap. */
  readonly refusal: { readonly reason: string; readonly numbers: Record<string, number>; readonly detail: string } | null;
}

/**
 * THE DAY SUMMARY, READ AT THE DOOR (2026-10-23, lane D2). Kept only from
 * day's end — this session's open night claim — with `self.DAY_SUMMARY` on;
 * otherwise named as not kept. Past `DAY_SUMMARY_CHARS` (characters as a
 * reader counts them: code points, so an emoji is one; review of D2) it is refused with the numbers, never cut. Its
 * cites are resolved as the page's are: a night's short id read back where
 * this session holds the night's map, an id kept when it names a memory
 * here, the rest named back. Never throws.
 */
function daySummaryArgs(server: McpServer, sent: string, rawCites: unknown, fromDaysEnd: boolean): DaySummaryArgs {
  const text = sent.trim();
  const none = { text, cites: [], refused: [], refusal: null };
  if (!SELF_TUNABLES.DAY_SUMMARY) return { ...none, notKept: "Day summaries are switched off (self.DAY_SUMMARY), so it was not kept.", notKeptReason: "day-summary-off" };
  if (!fromDaysEnd) {
    return { ...none, notKept: "A day summary is day's end's, sent with its closing call in the nightly run (with session: the id its block named); this call is not that, so it was not kept.", notKeptReason: "summary-not-days-end" };
  }
  const cap = SELF_TUNABLES.DAY_SUMMARY_CHARS;
  if (text.length === 0) {
    return { ...none, notKept: null, notKeptReason: "", refusal: { reason: "summary-empty", numbers: {}, detail: "The day summary was empty. Send a few lines — what the day was about and what is in motion — or leave `summary` out. Nothing was written." } };
  }
  const chars = charCount(text);
  if (chars > cap) {
    return {
      ...none,
      notKept: null,
      notKeptReason: "",
      refusal: {
        reason: "summary-too-long",
        numbers: { chars, cap, over: chars - cap },
        detail: `The day summary is ${String(chars)} characters, ${String(chars - cap)} over its ${String(cap)}. Cut it by that much or more and send the call again, the page with it if you sent one. Nothing was written.`,
      },
    };
  }
  let aliases: AliasMap | null = null;
  try {
    aliases = server["nightAliases"]();
  } catch {
    aliases = null;
  }
  const cites: string[] = [];
  const refused: string[] = [];
  const name = (x: unknown): void => {
    const s = typeof x === "string" ? x : JSON.stringify(x) ?? String(x);
    if (!refused.includes(s)) refused.push(s);
  };
  if (rawCites !== undefined && !Array.isArray(rawCites)) name(rawCites);
  for (const x of Array.isArray(rawCites) ? (rawCites as unknown[]) : []) {
    if (typeof x !== "string" || x.trim().length === 0) {
      name(x);
      continue;
    }
    const id = aliases?.resolve(x) ?? x.trim();
    let known = false;
    try {
      known = server.counterpart.store.row(id)?.type === "memory";
    } catch {
      known = false;
    }
    if (known) {
      if (!cites.includes(id)) cites.push(id);
    } else name(x);
  }
  return { text, cites, refused, notKept: null, notKeptReason: "", refusal: null };
}

/** The day summary's fields on the night's row: its words, cites, and the session and run that told it. */
function summaryRow(server: McpServer, claimedSession: string | null, told: DaySummaryArgs, knownRun?: string): { summary: string; summaryCites: readonly string[]; session?: string; run?: string } {
  const session = claimedSession ?? server.session ?? "";
  let run = knownRun ?? "";
  try {
    if (run === "") run = session === "" ? "" : (server.counterpart.nightClaimFor(session)?.run ?? "");
  } catch {
    run = "";
  }
  return { summary: told.text, summaryCites: told.cites, ...(session === "" ? {} : { session }), ...(run === "" ? {} : { run }) };
}

/** What `daysEndAlone` writes as the row's detail, and how `daysEndStood` knows its row. */
const DAYS_END_STOOD = "day's end left the page as it stands";

/**
 * DAY'S END'S SUMMARY SENT ALONE, STILL OPEN TO ITS PAGE (the edge recorded
 * at #606's merge): the night's newest settled row is the one `daysEndAlone`
 * wrote, today, for this call's session, on the nightly run's server, and
 * no dream has begun since — so a page written now is the same day's end
 * changing its mind, and the night's answer becomes the page written. The
 * run moving on (the dream's `begin`) ends it, as the open claim's
 * `closeNightWriter` does. Null otherwise. Never throws.
 */
function daysEndStood(server: McpServer, claimedSession: string | null): PageWriterRun | null {
  try {
    if (claimedSession === null || !server["nightRun"]()) return null;
    const today = server.counterpart.self.calendarToday();
    const alone = server.counterpart
      .pageWriterRuns({})
      .find((r) => r.outcome === "nothing-to-say" && r.detail === DAYS_END_STOOD && r.session === claimedSession && r.on === today && r.summary.trim().length > 0);
    if (alone === undefined) return null;
    const settled = server.counterpart
      .pageWriterRuns({ about: alone.about })
      .find((r) => r.outcome === "revised" || r.outcome === "nothing-to-say" || r.outcome === "failed");
    if (settled === undefined || settled.at !== alone.at || settled.seq !== alone.seq) return null;
    const dream = server.counterpart.dreams.lastDream();
    if (dream !== null && dream.started_at >= alone.at) return null;
    return alone;
  } catch {
    return null;
  }
}

/**
 * DAY'S END, THE PAGE STANDING (2026-10-23, lane D2): a summary sent alone
 * answers the night as `nothing-to-say` — the page left as it stands, which
 * is an answer — on a row carrying the summary. Never throws.
 */
function daysEndAlone(
  server: McpServer,
  input: { writerFor: { about: string; mode: PageWriterMode }; claimedSession: string | null; told: DaySummaryArgs },
): ToolResult {
  let ok = false;
  try {
    const page = server.counterpart.selfPage();
    const bytes = page === null ? 0 : Buffer.byteLength(page.body, "utf8");
    const claim = input.claimedSession === null ? null : server.counterpart.nightClaimFor(input.claimedSession);
    ok = server.counterpart.recordPageWriterRun({
      about: input.writerFor.about,
      mode: input.writerFor.mode,
      outcome: "nothing-to-say",
      detail: DAYS_END_STOOD,
      bytesBefore: bytes,
      bytesAfter: bytes,
      ...(claim === null ? {} : { considered: claim.considered, omitted: claim.omitted }),
      ...summaryRow(server, input.claimedSession, input.told),
    });
  } catch {
    ok = false;
  }
  server["emit"]("mcp.self_page", undefined, { stored: false, reason: "days-end-summary", summary: ok, writerFor: input.writerFor.about, writerMode: input.writerFor.mode });
  if (!ok) {
    return server["refuse"]("self_page", "unrecorded", { detail: "The day summary could not be recorded. The page stands as it is." });
  }
  return server["result"](
    {
      stored: false,
      answered: "nothing-to-say",
      about: input.writerFor.about,
      summary: { kept: true, about: input.writerFor.about, chars: charCount(input.told.text), cites: input.told.cites.length },
      ...(input.told.refused.length === 0 ? {} : { refusedSummaryCites: input.told.refused }),
      said: `The page stands as it is, and ${input.writerFor.about} is told.`,
    },
    false,
  );
}

export function selfPageRead(server: McpServer): ToolResult {
  const page = server.counterpart.selfPage();
  if (page === null) {
    return server["result"](
      {
        present: false,
        reason: "still-forming",
        // THE VERSION OF "NOTHING", so a session that was told to pass the
        // version back can do it on a first write too. Without a value here,
        // the natural `0` was refused with a sentence saying somebody else had
        // written the page, which was untrue (adversarial review MINOR-C).
        version: NO_PAGE_VERSION,
        detail:
          "No page has been written here yet. Write one when you have something true to say about yourself; while there is nothing, the honest page says it is still forming. Pass this `version` back as `ifVersion` if you want the write refused should one appear meanwhile.",
      },
      false,
    );
  }
  return server["result"](
    {
      present: true,
      body: page.body,
      bytes: page.bytes,
      // ITS ROOM AND ITS SHORT VERSION (2026-10-10): what the wake shows on a
      // day it has no room for the whole page.
      room: server.counterpart.self.tunables.PAGE_ROOM_BYTES,
      ...(page.short === null ? {} : { short: page.short.body, shortBytes: page.short.bytes }),
      revisedOn: page.revisedOn,
      by: page.by,
      version: page.version,
      // EVERY SECTION'S HEADING, in order (2026-09-28): any `##`, not only
      // Core and Lately.
      sections: pageSections(page.body).sections.map((s) => s.heading),
      stale: server.counterpart.self.pageStale(page),
      // COUNTED, not read: `selfPageVersions().length` read every archived
      // body off disk to print one number, on every read a session makes
      // (adversarial review m9).
      versions: server.counterpart.selfPageVersionCount(),
    },
    false,
  );
}

/**
 * The bound-session refusal, and the ONE way a server binds itself.
 *
 * Three states, in order:
 *
 *   1. **The host said so at launch** (`--session`). Unchanged and preferred:
 *      the registry is never consulted, and a claim for another id is refused.
 *   2. **Already bound** — by launch or by an earlier claim. The bind is for
 *      the process's lifetime, so a second, DIFFERENT id is refused with the
 *      reason that says why.
 *   3. **Unbound.** The claim must name an id (never inferred — see the
 *      CONTRACT's residual risk: two live sessions in one directory are
 *      distinguishable only by the id the ask named), and that id must be in
 *      the hooks' registry, live, and in THIS server's scope. Every refusal
 *      says which of the four it was, because a model that cannot tell
 *      "unknown id" from "wrong project" cannot do anything about either.
 */
/**
 * IS THIS SESSION THE NIGHT'S WRITER, and for which day?
 *
 * `by` on a page revision is the DOOR's and is not claimable from outside
 * (`self/page.ts`), so this server may not take a tool argument's word for it.
 * The evidence, since 2026-09-28, is the NIGHTLY RUN's claim row in the
 * store — written by the run's `writer` phase, naming this session, and
 * counted only when the write names that session itself — and,
 * kept readable for older records, the mark the SessionStart
 * hook used to write (`pageWriterFor`, a DATE, on this session's registry
 * record, `adapters/sessions.ts`; nothing writes it now). Either counts only
 * while that night's claim is still open: a session that lives past
 * midnight, or one whose night has already been answered, writes as an
 * ordinary session again. Null on every other path, including an unbound
 * server, which is the direction that never over-claims. The run's claim
 * counts only for a write that names the session in its call (review of
 * #271): the run's agent shares its session's id, and the session's own
 * page edit, which names none, stays an ordinary amendment.
 */
/**
 * A session claim on the PAGE's door: corroborated if it can be, ignored if
 * it cannot, and never a refusal.
 *
 * `requireBoundSession` is reused rather than reimplemented — it is the only
 * place that knows what corroboration means (known to the hooks' registry,
 * live, and in this server's scope) and it already emits the reason on every
 * arm. Its refusal VALUE is discarded here, which is the whole difference
 * between this door and `chapter`'s: a page amendment has never needed a
 * session and must not start being refused for lack of one.
 */
export function bindForPageWriter(server: McpServer, claimed: unknown): string | null {
  if (typeof claimed !== "string" || claimed.length === 0) return null;
  if (server.session !== null) return server.session === claimed ? claimed : null;
  // CORROBORATE WITHOUT BINDING (S2 review, MINOR-3). The first version called
  // `requireBoundSession`, which sets `lazySession` and FREEZES it for the
  // life of the process — so a page write naming another live in-scope
  // session would have bound this server to that session, and every later
  // `remember` and `chapter` from it would have been attributed there. The page's
  // door needs one thing and one thing only: is this id a session I may
  // label a write with. That is a question, not a binding.
  const ok = server["corroborate"](claimed);
  if (!ok) {
    server["emit"]("mcp.session.unbound", undefined, { reason: "page-writer-claim" });
    return null;
  }
  return claimed;
}

/**
 * THE DREAM'S SHORT ANSWER TO `propose` (2026-10-23, lean bundles): what
 * landed, counted by what happened to it (`linked`, `replayed`,
 * `replayed-not-counted:…`); the memories a merge or a gist made; a note said
 * about one that landed; and every refusal whole, with its place in the list.
 * Ids the code wrote in a refusal or a note are put short, as the dream knows
 * them.
 */
export function briefChanges(
  results: readonly { readonly index: number; readonly action: string; readonly ok: boolean; readonly reason: string; readonly id?: string; readonly detail?: string; readonly note?: string }[],
  aliases: AliasMap,
): Record<string, unknown> {
  const landed: Record<string, number> = {};
  const made: { index: number; action: string; id: string }[] = [];
  const notes: { index: number; action: string; note: string }[] = [];
  const refused: { index: number; action: string; reason: string; detail?: string }[] = [];
  for (const r of results) {
    if (!r.ok) {
      refused.push({ index: r.index, action: r.action, reason: r.reason, ...(r.detail === undefined ? {} : { detail: aliases.inText(r.detail) }) });
      continue;
    }
    landed[r.reason] = (landed[r.reason] ?? 0) + 1;
    if ((r.reason === "merged" || r.reason === "dreamed" || r.reason === "folded") && r.id !== undefined) made.push({ index: r.index, action: r.action, id: r.id });
    if (r.note !== undefined) notes.push({ index: r.index, action: r.action, note: aliases.inText(r.note) });
  }
  return {
    landed,
    ...(made.length > 0 ? { made } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(refused.length > 0 ? { refused } : {}),
  };
}

/**
 * THE REFLECTION'S SHORT ANSWER, part by part (2026-10-23, lean bundles):
 * how many were written, a note said about one that was, and every one not
 * written whole. Ids the code wrote are put short.
 */
export function briefParts(results: readonly { readonly id: string | null; readonly ok: boolean; readonly reason: string; readonly detail?: string; readonly note?: string }[], aliases: AliasMap): Record<string, unknown> {
  const short = (id: string | null): string | null => (id === null ? null : aliases.short(id));
  const notes = results.filter((r) => r.ok && r.note !== undefined).map((r) => ({ id: short(r.id), note: aliases.inText(r.note as string) }));
  const notWritten = results.filter((r) => !r.ok).map((r) => ({ id: short(r.id), reason: r.reason, ...(r.detail === undefined ? {} : { detail: aliases.inText(r.detail) }) }));
  return { written: results.filter((r) => r.ok).length, ...(notes.length > 0 ? { notes } : {}), ...(notWritten.length > 0 ? { notWritten } : {}) };
}

/**
 * `self_page`'s `cites` and `claims` (2026-10-23, day's end): the trace the
 * page's door stores (`self/page.ts#traceFor`), the shape the reflection's
 * finish sends. An id is kept when it names a memory in this store (live or
 * not: a cite is what the sentence rested on when written); the rest come
 * back in `refused`. Null trace when neither was sent. Never throws.
 */
function pageTraceArgs(server: McpServer, args: Record<string, unknown>): { trace: TraceInput | null; refused: string[] } {
  const rawCites = args["cites"];
  const rawClaims = args["claims"];
  if (rawCites === undefined && rawClaims === undefined) return { trace: null, refused: [] };
  const refused: string[] = [];
  const known = (id: string): boolean => {
    try {
      return server.counterpart.store.row(id)?.type === "memory";
    } catch {
      return false;
    }
  };
  // What is not an id is named back too (review of D1), never dropped unsaid.
  const named = (x: unknown): void => {
    const s = typeof x === "string" ? x : JSON.stringify(x) ?? String(x);
    if (!refused.includes(s)) refused.push(s);
  };
  const ids = (v: unknown): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      named(v);
      return [];
    }
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== "string" || x.trim().length === 0) {
        named(x);
        continue;
      }
      const id = x.trim();
      if (known(id)) {
        if (!out.includes(id)) out.push(id);
      } else if (!refused.includes(id)) refused.push(id);
    }
    return out;
  };
  const cites = ids(rawCites);
  if (rawClaims !== undefined && !Array.isArray(rawClaims)) named(rawClaims);
  const claims = Array.isArray(rawClaims)
    ? rawClaims.flatMap((c): { text: string; cites: string[] }[] => {
        const r = typeof c === "object" && c !== null ? (c as Record<string, unknown>) : null;
        const text = r?.["text"];
        if (r === null || typeof text !== "string" || text.trim().length === 0) {
          named(c);
          return [];
        }
        return [{ text, cites: ids(r["cites"]) }];
      })
    : null;
  // Nothing usable sent: the trace already there stands, as with none sent.
  if (rawCites !== undefined && !Array.isArray(rawCites) && claims === null) return { trace: null, refused };
  if (rawCites === undefined && claims === null) return { trace: null, refused };
  return { trace: { cites, claims }, refused };
}
