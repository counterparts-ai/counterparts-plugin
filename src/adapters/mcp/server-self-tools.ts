/** `McpServer`'s `dream`, `reflect` and `self_page` tools, and the page writer's binding (bodies moved out of `server.ts`, 2026-10-11; the class keeps a delegate for each). */
import { NIGHT_CHILD_ENV } from "../spawn.js";
import { readSession } from "../sessions.js";
import { RECALL_MAX_IDS } from "./deliberate.js";
import { DREAMING_SETTINGS, NIGHT_RUN_FINISHES, nightNext, nightOrder } from "../../core/dream/index.js";
import type { DreamingSetting, NightPart } from "../../core/dream/index.js";
import {
  NIGHT_WRITER_TOOL,
  NO_PAGE_VERSION,
  pageSections,
  pageTooLargeDetail,
} from "../../core/self/index.js";
import type { ToolResult } from "./server-options.js";
import { dreamHow, PAGE_REFUSAL_DETAIL, pageRoomAnswer } from "./server-words.js";
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
  const dreams = server.counterpart.dreams;
  const at = server.counterpart.store.today();
  const refused = (reason: string, detail: string): ToolResult => server["refuse"]("dream", reason, { phase, detail });
  // WHAT COMES NEXT in the nightly run, in its own order (`nightOrder`).
  // The headless night's dream child stops before the reflection
  // (2026-10-11): the reflection runs after it, in a child of its own.
  const dreamChild = (server["env"][NIGHT_CHILD_ENV] ?? "").trim() === "dream";
  const nextAfter = (part: NightPart, dream: string | null): string | null => {
    const next = nightNext(part);
    if (dreamChild && next === "reflection") return null;
    if (next === "writer") return `Next, the page writer: call the dream tool with phase "writer", session: ${session}${dream === null ? "" : `, dream: ${dream}`}.`;
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
            how: "Hand `prompt` to a background agent (the Agent tool), unchanged, and carry on. When it finishes, show the owner its first line (the dream's) exactly as it came back — it carries the dream's mark, which keeps the dream out of lived memory. If a morning share follows, tell it to the owner in your own words, as a telling (\"While I slept I dreamed…\"), then call the reflect tool with phase \"told\" — never state what was dreamed as something that happened.",
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
        const said: Record<DreamingSetting, string> = {
          auto: "Dreaming on its own: once a day, the first session starts the nightly run by itself, in a separate windowless session in the background, and says so in one line. Today's run is still yours to start, if the owner asked for it.",
          ask: "Dreaming asks first: once a day, the first session shows the owner the question in the terminal and waits for their word.",
          off: "No dreams: nothing starts the nightly run and nothing asks. It can be turned back on with this phase (value ask or auto) when the owner says so.",
        };
        // "No dreams" does not stop a run already going (owner decision D): said.
        const finishes = out.setting === "off" && dreams.nightRunUnderWay() ? ` ${NIGHT_RUN_FINISHES}` : "";
        return server["result"]({ phase, setting: out.setting, before: out.before, said: `${said[out.setting]}${finishes}` }, false);
      }
      case "begin": {
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
        const out = dreams.propose({ dream, session, changes: changes as never });
        if (!out.ok) return refused(out.reason, "That dream is not open for this session.");
        server["emit"]("mcp.dream", dream, { phase: "propose", applied: out.results.filter((r) => r.ok).length });
        const refusedN = out.results.filter((r) => !r.ok).length;
        return server["result"](
          {
            phase,
            dream,
            results: out.results,
            // Each refusal names what tripped it (`detail`); 2026-09-28.
            ...(refusedN === 0
              ? {}
              : { again: `${String(refusedN)} change${refusedN === 1 ? " was" : "s were"} not applied (see each result's reason and detail). Fix those and propose just them again; the rest already landed.` }),
          },
          false,
        );
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
        const dreamArg = typeof args["dream"] === "string" ? args["dream"] : null;
        const claim = server.counterpart.claimNightWriter({ session, run: dreamArg ?? `night of ${at}` });
        const out = server.counterpart.nightWriter({ session, tool: NIGHT_WRITER_TOOL });
        const next = nextAfter("writer", dreamArg);
        if (!out.ok) {
          server["emit"]("mcp.dream", dreamArg ?? undefined, { phase: "writer", writer: claim.reason });
          const why: Record<string, string> = {
            off: "the owner has the page writer off",
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
            // THE SHORT VERSION, IN THE SAME CALL (2026-10-10; #358 had a
            // tighten-and-resend retry here, for a limit that refused): a
            // page past its room is kept, and the writer is asked for the
            // short version sessions read on a day the wake cannot hold it.
            how: `Read the block. If something about who you are moved on ${out.about}, call the self_page tool with the WHOLE page, reason, ifVersion: ${String(out.version ?? NO_PAGE_VERSION)} and session: ${session}; if nothing moved, write nothing — that is an answer too. Aim the page under ${String(server.counterpart.self.tunables.PAGE_ROOM_BYTES)} bytes; if it runs past that, send \`short\` with it in the same call — a short version under ${String(server.counterpart.self.tunables.PAGE_ROOM_BYTES)} bytes, the whole of it condensed. If the answer has a roomNote, do what it says before you go on.`,
            ...(next === null ? {} : { next: `Then: ${next}` }),
          },
          false,
        );
      }
      default:
        return refused("phase-unknown", "phase is one of launch, begin, part, propose, journal, writer, decline, setting.");
    }
  } catch (err) {
    return refused("threw", String((err as Error).message ?? err));
  }
}

/**
 * `reflect` — the waking self (`core/dream/reflect.ts`, 2026-09-27). Every
 * phase binds the session, as `dream` does; `launch` writes nothing.
 */
export function reflectTool(server: McpServer, args: Record<string, unknown>): ToolResult {
  const phase = args["phase"];
  if (server.observer) return server["standDown"]("reflect");
  const bound = server["requireBoundSession"](args["session"], "reflect");
  if (bound !== null) return bound;
  const session = server.session as string;
  const reflections = server.counterpart.reflections;
  const refused = (reason: string, detail: string): ToolResult => server["refuse"]("reflect", reason, { phase, detail });
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const part = (v: unknown): { text?: string; cites?: string[]; short?: string } | null => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const r = v as Record<string, unknown>;
    return {
      ...(typeof r["text"] === "string" ? { text: r["text"] } : {}),
      cites: ids(r["cites"]),
      // The page's short version (2026-10-10); the share has none.
      ...(typeof r["short"] === "string" ? { short: r["short"] } : {}),
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
            how: "Hand `prompt` to a background agent (the Agent tool), unchanged, and carry on. When it finishes, if it left a morning share, tell it to the owner in your own words, then call this tool with phase \"told\".",
          },
          false,
        );
      case "begin": {
        const model = readSession(server["registryDir"], session)?.model;
        const dream = typeof args["dream"] === "string" ? args["dream"] : null;
        // The same at the reflection, when the writer comes before it.
        if (nightOrder().indexOf("writer") < nightOrder().indexOf("reflection")) server.counterpart.closeNightWriter({ session, phase: "the reflection" });
        const out = reflections.begin({ session, dream, scope: server.scope, ...(model === undefined ? {} : { model }) });
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
        const out = reflections.finish({
          reflection,
          session,
          ...(typeof entry === "string" ? { entry } : {}),
          ...(typeof args["title"] === "string" ? { title: args["title"] } : {}),
          cites: ids(args["cites"]),
          share: part(args["share"]),
          page: part(args["page"]),
          feelings: Array.isArray(args["feelings"]) ? (args["feelings"] as never) : [],
          about: Array.isArray(args["about"]) ? (args["about"] as never) : [],
          core: Array.isArray(args["core"]) ? (args["core"] as never) : [],
          traits: Array.isArray(args["traits"]) ? (args["traits"] as never) : [],
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
            returned: o.returned,
            feelings: o.feelings,
            about: o.about,
            ...(o.traits.length > 0 ? { traits: o.traits } : {}),
            ...(o.refusedCites.length > 0 ? { refusedCites: o.refusedCites } : {}),
            // WHAT WAS NOT WRITTEN, and that it can be sent again (2026-09-28).
            ...(o.retry === null ? {} : { again: o.retry }),
            say:
              o.retry === null
                ? "Return `handBack` as your final message, unchanged."
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
        return server["result"]({ phase, reflection, settle: { ...out } }, !out.ok);
      }
      case "told": {
        const reflection = args["reflection"];
        if (typeof reflection !== "string") return refused("reflection-required", "Pass `reflection`, the id the share named.");
        const out = reflections.told({ reflection, session });
        if (!out.ok) return refused(out.reason, "Nothing to record: the share was already told, or there was none.");
        server["emit"]("mcp.reflect", reflection, { phase: "told", cited: out.cited });
        return server["result"]({ phase, reflection, told: true, cited: out.cited }, false);
      }
      default:
        return refused("phase-unknown", "phase is one of launch, begin, part, finish, settle, told.");
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
  if (body === undefined && short === undefined) return server["selfPageRead"]();
  if (server.observer) return server["standDown"]("self_page");
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
  const writerFor = server["pageWriterMark"](claimedSession);
  const model = server["sessionModel"]();
  const said = typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;
  const common = {
    ...(model === undefined ? {} : { model }),
    by: writerFor === null ? ("session" as const) : ("writer" as const),
    // WHICH SESSION, when this server has one. `remember` resolves it the same
    // way; null is recorded rather than a guess (adversarial review M3).
    session: server.session,
    ...(ifVersion === undefined ? {} : { ifVersion }),
  };
  // THE SHORT VERSION (2026-10-10): beside the page, or — with no `body` —
  // added to the page as it stands, as a revision of the same text.
  const written =
    typeof body === "string"
      ? server.counterpart.revisePage(body, { ...common, reason: said ?? "amended", ...(short === undefined ? {} : { short }) })
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
            : written.reason,
        bytesAfter: written.written ? written.bytes : 0,
      });
    } catch {
      /* the page is written; the bookkeeping is not worth the answer */
    }
  }
  if (!written.written) {
    // THE CEILING, IN NUMBERS (2026-10-09): a writer told only "past the
    // limit" guesses how much to take out; told both numbers, it tightens
    // once and sends the page again.
    const limit = server.counterpart.self.tunables.PAGE_MAX_BYTES;
    return server["refuse"]("self_page", written.reason, {
      bytes: written.bytes,
      ...(written.reason === "too-large" ? { limit, over: written.bytes - limit } : {}),
      ...(written.short === null ? {} : { short: written.short }),
      ...(written.gate === null ? {} : { gate: written.gate }),
      // On a stale write, hand back what is actually there so the session can
      // merge rather than guess — the whole point of the check.
      ...(written.current === null
        ? {}
        : { currentVersion: written.current.version, currentBody: written.current.body }),
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
