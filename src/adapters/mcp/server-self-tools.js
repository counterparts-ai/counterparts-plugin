import { NIGHT_CHILD_ENV } from "../spawn.js";
import { readSession } from "../sessions.js";
import { RECALL_MAX_IDS } from "./deliberate.js";
import { DREAMING_SETTINGS, NIGHT_RUN_FINISHES, nightNext, nightOrder } from "../../core/dream/index.js";
import {
  NIGHT_WRITER_TOOL,
  NO_PAGE_VERSION,
  pageSections,
  pageTooLargeDetail
} from "../../core/self/index.js";
import { dreamHow, PAGE_REFUSAL_DETAIL, pageRoomAnswer } from "./server-words.js";
export function dreamTool(server, args) {
  const phase = args["phase"];
  if (server.observer)
    return server["standDown"]("dream");
  const bound = server["requireBoundSession"](args["session"], "dream");
  if (bound !== null)
    return bound;
  const session = server.session;
  const dreams = server.counterpart.dreams;
  const at = server.counterpart.store.today();
  const refused = (reason, detail) => server["refuse"]("dream", reason, { phase, detail });
  const dreamChild = (server["env"][NIGHT_CHILD_ENV] ?? "").trim() === "dream";
  const nextAfter = (part, dream) => {
    const next = nightNext(part);
    if (dreamChild && next === "reflection")
      return null;
    if (next === "writer")
      return `Next, the page writer: call the dream tool with phase "writer", session: ${session}${dream === null ? "" : `, dream: ${dream}`}.`;
    if (next === "reflection")
      return `Now wake and reflect: call the reflect tool with phase "begin", session: ${session}, dream: ${dream ?? "<the dream id>"}. Your final message is the text its "finish" call returns.`;
    if (next === "dream")
      return `Next, the dream: call the dream tool with phase "begin", session: ${session}.`;
    return null;
  };
  try {
    switch (phase) {
      case "launch":
        dreams.launched({ at, session });
        server["emit"]("mcp.dream", undefined, { phase: "launch", session });
        return server["result"]({
          phase,
          session,
          prompt: dreams.launchPrompt({ session }),
          how: 'Hand `prompt` to a background agent (the Agent tool), unchanged, and carry on. When it finishes, show the owner its first line (the dream\'s) exactly as it came back — it carries the dream\'s mark, which keeps the dream out of lived memory. If a morning share follows, tell it to the owner in your own words, as a telling ("While I slept I dreamed…"), then call the reflect tool with phase "told" — never state what was dreamed as something that happened.'
        }, false);
      case "undo": {
        if (dreamChild || (server["env"][NIGHT_CHILD_ENV] ?? "").trim().length > 0)
          return refused("night-run", "This is the nightly run: only the owner undoes a dream.");
        const id = typeof args["dream"] === "string" ? args["dream"].trim() : "";
        if (id.length === 0)
          return refused("dream-required", "Pass `dream`: the id of the dream to undo (the line that told of it names it).");
        if (server.counterpart.store.dream(id) === undefined)
          return refused("unknown-dream", `No dream ${id} in this memory.`);
        const out = dreams.undo(id);
        if (!out.ok)
          return refused(out.reason, "Nothing was undone.");
        server["emit"]("mcp.dream", undefined, { phase: "undo", session, reversed: out.reversed, kept: out.kept });
        const kept = out.kept === 0 ? "" : ` ${String(out.kept)} merge${out.kept === 1 ? " was" : "s were"} left as they are: the merged memory changed since, and bringing its originals back would duplicate it.`;
        return server["result"]({
          phase,
          dream: id,
          reversed: out.reversed,
          kept: out.kept,
          said: `${out.reversed === 0 ? "That dream had nothing left to reverse; it is marked undone." : `Undone: ${String(out.reversed)} change${out.reversed === 1 ? "" : "s"} reversed — merged memories are back as they were, its links and gists are gone.`}${kept} Its journal entry stays, as a record that it happened.`
        }, false);
      }
      case "decline": {
        dreams.decline({ at, session });
        server["emit"]("mcp.dream", undefined, { phase: "decline", session });
        return server["result"]({ phase, session, snoozed: at, said: "Not today — the line will not come back until tomorrow." }, false);
      }
      case "setting": {
        const value = args["value"];
        if (typeof value !== "string") {
          return refused("value-required", `Pass \`value\`: auto, ask or off. It is ${dreams.setting()} now.`);
        }
        const out = dreams.setSetting(value, { by: "session", session });
        if (!out.ok)
          return refused(out.reason, `value is one of ${DREAMING_SETTINGS.join(", ")}. It is ${dreams.setting()} now.`);
        server["emit"]("mcp.dream", undefined, { phase: "setting", setting: out.setting, before: out.before });
        const said = {
          auto: "Dreaming on its own: once a day, the first session starts the nightly run by itself, in a separate windowless session in the background, and says so in one line. Today's run is still yours to start, if the owner asked for it.",
          ask: "Dreaming asks first: once a day, the first session shows the owner the question in the terminal and waits for their word.",
          off: "No dreams: nothing starts the nightly run and nothing asks. It can be turned back on with this phase (value ask or auto) when the owner says so."
        };
        const finishes = out.setting === "off" && dreams.nightRunUnderWay() ? ` ${NIGHT_RUN_FINISHES}` : "";
        return server["result"]({ phase, setting: out.setting, before: out.before, said: `${said[out.setting]}${finishes}` }, false);
      }
      case "begin": {
        const model = readSession(server["registryDir"], session)?.model;
        if (nightOrder().indexOf("writer") < nightOrder().indexOf("dream"))
          server.counterpart.closeNightWriter({ session, phase: "the dream" });
        const out = dreams.begin({ session, scope: server.scope, ...model === undefined ? {} : { model } });
        if (!out.ok) {
          return refused(out.reason, out.reason === "dreamed-today" ? "A dream already ran today." : out.reason === "dreaming-now" ? "Another session's dream is under way; it has the day." : out.reason === "nothing-new" ? "Nothing new has been lived since the last dream." : "The dream did not begin.");
        }
        server["emit"]("mcp.dream", out.bundle.dream, {
          phase: "begin",
          session,
          shown: Object.keys(out.bundle.memories).length,
          resumed: out.resumed
        });
        const handed = server["result"]({
          phase,
          session,
          dream: out.bundle.dream,
          ...out.resumed ? { resumed: true } : {},
          ...out.bundle.parts === null ? {} : { parts: out.bundle.parts },
          how: dreamHow(out.bundle),
          bundle: out.text
        }, false);
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
        if (!out.ok)
          return refused(out.reason, out.detail ?? "That dream is not open for this session.");
        server["emit"]("mcp.dream", dream, { phase: "part", part: out.part, of: out.of });
        const handed = server["result"]({
          phase,
          dream,
          part: out.part,
          of: out.of,
          bundle: out.text,
          ...out.part < out.of ? { next: `Then part ${String(out.part + 1)}: the dream tool, phase "part", dream: ${dream}, part: ${String(out.part + 1)}.` } : { next: "That was the last part. Now propose your changes." }
        }, false);
        server["notePart"]("dream", dream, out.part, out.of);
        return handed;
      }
      case "propose": {
        const dream = args["dream"];
        const changes = args["changes"];
        if (typeof dream !== "string" || !Array.isArray(changes)) {
          return refused("dream-and-changes-required", "Pass `dream` (the id `begin` returned) and `changes`, an array.");
        }
        const out = dreams.propose({ dream, session, changes });
        if (!out.ok)
          return refused(out.reason, "That dream is not open for this session.");
        server["emit"]("mcp.dream", dream, { phase: "propose", applied: out.results.filter((r) => r.ok).length });
        const refusedN = out.results.filter((r) => !r.ok).length;
        return server["result"]({
          phase,
          dream,
          results: out.results,
          ...refusedN === 0 ? {} : { again: `${String(refusedN)} change${refusedN === 1 ? " was" : "s were"} not applied (see each result's reason and detail). Fix those and propose just them again; the rest already landed.` }
        }, false);
      }
      case "journal": {
        const dream = args["dream"];
        const text = args["text"];
        if (typeof dream !== "string" || typeof text !== "string") {
          return refused("dream-and-text-required", "Pass `dream` and the journal `text`.");
        }
        const title = args["title"];
        const out = dreams.journal({ dream, session, text, ...typeof title === "string" ? { title } : {} });
        if (!out.ok)
          return refused(out.reason, "detail" in out && out.detail !== undefined ? out.detail : "The journal was not written.");
        server["emit"]("mcp.dream", dream, { phase: "journal" });
        const next = nextAfter("dream", dream);
        return server["result"]({
          phase,
          dream,
          handBack: out.handBack,
          ...out.note === undefined ? {} : { note: out.note },
          next: `${next ?? `Return \`handBack\` as your final message, unchanged.${dreamChild ? " The reflection runs after you, in a session of its own." : ""}`}${next === null ? "" : " If the rest of the run fails, return `handBack` unchanged as your final message instead."}`
        }, false);
      }
      case "writer": {
        const dreamArg = typeof args["dream"] === "string" ? args["dream"] : null;
        const claim = server.counterpart.claimNightWriter({ session, run: dreamArg ?? `night of ${at}` });
        const out = server.counterpart.nightWriter({ session, tool: NIGHT_WRITER_TOOL });
        const next = nextAfter("writer", dreamArg);
        if (!out.ok) {
          server["emit"]("mcp.dream", dreamArg ?? undefined, { phase: "writer", writer: claim.reason });
          const why = {
            off: "the owner has the page writer off",
            "no-previous-day": "this store has no day before today yet",
            "no-memories": `nothing was written down on ${claim.about}`,
            "already-claimed": `${claim.about} was already written or answered`,
            "asks-spent": `${claim.about} has been offered twice already`
          };
          return server["result"]({
            phase,
            writer: false,
            reason: claim.reason,
            said: `No page writing tonight — ${why[claim.reason] ?? claim.reason}. Leave the page as it stands.`,
            ...next === null ? {} : { next }
          }, false);
        }
        server["emit"]("mcp.dream", dreamArg ?? undefined, { phase: "writer", about: out.about, considered: out.considered, dropped: out.dropped });
        return server["result"]({
          phase,
          writer: true,
          about: out.about,
          ifVersion: out.version ?? NO_PAGE_VERSION,
          read: out.text,
          how: `Read the block. If something about who you are moved on ${out.about}, call the self_page tool with the WHOLE page, reason, ifVersion: ${String(out.version ?? NO_PAGE_VERSION)} and session: ${session}; if nothing moved, write nothing — that is an answer too. Aim the page under ${String(server.counterpart.self.tunables.PAGE_ROOM_BYTES)} bytes; if it runs past that, send \`short\` with it in the same call — a short version under ${String(server.counterpart.self.tunables.PAGE_ROOM_BYTES)} bytes, the whole of it condensed. If the answer has a roomNote, do what it says before you go on.`,
          ...next === null ? {} : { next: `Then: ${next}` }
        }, false);
      }
      default:
        return refused("phase-unknown", "phase is one of launch, begin, part, propose, journal, writer, decline, setting.");
    }
  } catch (err) {
    return refused("threw", String(err.message ?? err));
  }
}
export function reflectTool(server, args) {
  const phase = args["phase"];
  if (server.observer)
    return server["standDown"]("reflect");
  const bound = server["requireBoundSession"](args["session"], "reflect");
  if (bound !== null)
    return bound;
  const session = server.session;
  const reflections = server.counterpart.reflections;
  const refused = (reason, detail) => server["refuse"]("reflect", reason, { phase, detail });
  const ids = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  const part = (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v))
      return null;
    const r = v;
    return {
      ...typeof r["text"] === "string" ? { text: r["text"] } : {},
      cites: ids(r["cites"]),
      ...typeof r["short"] === "string" ? { short: r["short"] } : {}
    };
  };
  try {
    switch (phase) {
      case "launch":
        server["emit"]("mcp.reflect", undefined, { phase: "launch", session });
        return server["result"]({
          phase,
          session,
          prompt: reflections.launchPrompt({ session, dream: typeof args["dream"] === "string" ? args["dream"] : null }),
          how: 'Hand `prompt` to a background agent (the Agent tool), unchanged, and carry on. When it finishes, if it left a morning share, tell it to the owner in your own words, then call this tool with phase "told".'
        }, false);
      case "begin": {
        const model = readSession(server["registryDir"], session)?.model;
        const dream = typeof args["dream"] === "string" ? args["dream"] : null;
        if (nightOrder().indexOf("writer") < nightOrder().indexOf("reflection"))
          server.counterpart.closeNightWriter({ session, phase: "the reflection" });
        const out = reflections.begin({ session, dream, scope: server.scope, ...model === undefined ? {} : { model } });
        if (!out.ok) {
          return refused(out.reason, out.reason === "reflected-today" ? "A reflection already finished today." : out.reason === "dream-not-journaled" ? "That dream has not written its journal yet." : "The reflection did not begin.");
        }
        server["emit"]("mcp.reflect", out.bundle.reflection, { phase: "begin", session, shown: Object.keys(out.bundle.memories).length });
        const handed = server["result"]({
          phase,
          session,
          reflection: out.bundle.reflection,
          questions: out.bundle.questions,
          ...out.bundle.parts === null ? {} : { parts: out.bundle.parts },
          how: `${out.instructions}
What is shown only in part (fidelity excerpt, line or id): read it whole with the recall tool, ids: [...] — up to ${String(RECALL_MAX_IDS)} at once.`,
          bundle: out.text
        }, false);
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
        if (!out.ok)
          return refused(out.reason, out.detail ?? "That reflection is not open for this session.");
        server["emit"]("mcp.reflect", reflection, { phase: "part", part: out.part, of: out.of });
        const handed = server["result"]({
          phase,
          reflection,
          part: out.part,
          of: out.of,
          bundle: out.text,
          ...out.part < out.of ? { next: `Then part ${String(out.part + 1)}: the reflect tool, phase "part", reflection: ${reflection}, part: ${String(out.part + 1)}.` } : { next: "That was the last part. Answer the questions, then call finish." }
        }, false);
        server["notePart"]("reflection", reflection, out.part, out.of);
        return handed;
      }
      case "finish": {
        const reflection = args["reflection"];
        const entry = args["entry"];
        if (typeof reflection !== "string" || entry !== undefined && typeof entry !== "string") {
          return refused("reflection-and-entry-required", "Pass `reflection` (the id `begin` returned) and your `entry`.");
        }
        const model = readSession(server["registryDir"], session)?.model;
        const out = reflections.finish({
          reflection,
          session,
          ...typeof entry === "string" ? { entry } : {},
          ...typeof args["title"] === "string" ? { title: args["title"] } : {},
          cites: ids(args["cites"]),
          share: part(args["share"]),
          page: part(args["page"]),
          feelings: Array.isArray(args["feelings"]) ? args["feelings"] : [],
          about: Array.isArray(args["about"]) ? args["about"] : [],
          core: Array.isArray(args["core"]) ? args["core"] : [],
          traits: Array.isArray(args["traits"]) ? args["traits"] : [],
          model: model ?? null
        });
        if (!out.ok) {
          return refused(out.reason, out.detail ?? (out.reason === "reflection-closed" ? "That reflection is closed: it is not today's, or a newer one followed it. Begin a new one tomorrow." : "The reflection was not written."));
        }
        const o = out.outcome;
        server["emit"]("mcp.reflect", reflection, { phase: "finish", nothingMuch: o.nothingMuch, page: o.page.written, share: o.share.offered, again: o.again });
        return server["result"]({
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
          ...o.traits.length > 0 ? { traits: o.traits } : {},
          ...o.refusedCites.length > 0 ? { refusedCites: o.refusedCites } : {},
          ...o.retry === null ? {} : { again: o.retry },
          say: o.retry === null ? "Return `handBack` as your final message, unchanged." : "Some parts were not written (see `again`). You may fix them and call finish again with the same reflection and just those parts; then return the `handBack` of your last finish call as your final message, unchanged. Never say a part was written when it was not."
        }, false);
      }
      case "settle": {
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
          why: typeof args["why"] === "string" ? args["why"] : ""
        });
        server["emit"]("mcp.reflect", reflection, { phase: "settle", ok: out.ok });
        return server["result"]({ phase, reflection, settle: { ...out } }, !out.ok);
      }
      case "told": {
        const reflection = args["reflection"];
        if (typeof reflection !== "string")
          return refused("reflection-required", "Pass `reflection`, the id the share named.");
        const out = reflections.told({ reflection, session });
        if (!out.ok)
          return refused(out.reason, "Nothing to record: the share was already told, or there was none.");
        server["emit"]("mcp.reflect", reflection, { phase: "told", cited: out.cited });
        return server["result"]({ phase, reflection, told: true, cited: out.cited }, false);
      }
      default:
        return refused("phase-unknown", "phase is one of launch, begin, part, finish, settle, told.");
    }
  } catch (err) {
    return refused("threw", String(err.message ?? err));
  }
}
export function selfPageTool(server, args) {
  const body = args["body"];
  const short = args["short"];
  if (short !== undefined && typeof short !== "string") {
    return server["refuse"]("self_page", "short-not-text", {
      detail: "`short` is the short version of the page, as text — or leave it out."
    });
  }
  if (body === undefined && short === undefined)
    return server["selfPageRead"]();
  if (server.observer)
    return server["standDown"]("self_page");
  if (body !== undefined && typeof body !== "string") {
    return server["refuse"]("self_page", "body-required", {
      detail: "A page has to say something. Pass the whole page as text; omit `body` entirely to read the one that is there."
    });
  }
  const reason = args["reason"];
  const ifVersion = args["ifVersion"];
  if (ifVersion !== undefined && (typeof ifVersion !== "number" || !Number.isInteger(ifVersion) || ifVersion < NO_PAGE_VERSION)) {
    return server["refuse"]("self_page", "if-version-not-a-number", {
      detail: "`ifVersion` is the whole number the read gave you as `version` (-1 when there was no page), or leave it out."
    });
  }
  const claimedSession = server["bindForPageWriter"](args["session"]);
  const writerFor = server["pageWriterMark"](claimedSession);
  const model = server["sessionModel"]();
  const said = typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;
  const common = {
    ...model === undefined ? {} : { model },
    by: writerFor === null ? "session" : "writer",
    session: server.session,
    ...ifVersion === undefined ? {} : { ifVersion }
  };
  const written = typeof body === "string" ? server.counterpart.revisePage(body, { ...common, reason: said ?? "amended", ...short === undefined ? {} : { short } }) : server.counterpart.addPageShort(short ?? "", { ...common, ...said === null ? {} : { reason: said } });
  server["emit"]("mcp.self_page", written.id ?? undefined, {
    stored: written.written,
    reason: written.reason,
    bytes: written.bytes,
    version: written.version,
    writerFor: writerFor?.about ?? null,
    writerMode: writerFor?.mode ?? null
  });
  if (writerFor !== null && typeof body === "string") {
    try {
      server.counterpart.recordPageWriterRun({
        about: writerFor.about,
        mode: writerFor.mode,
        outcome: written.written ? "revised" : "refused",
        detail: written.written ? "" : written.reason === "too-large" ? pageTooLargeDetail(written.bytes, server.counterpart.self.tunables.PAGE_MAX_BYTES) : written.reason,
        bytesAfter: written.written ? written.bytes : 0
      });
    } catch {}
  }
  if (!written.written) {
    const limit = server.counterpart.self.tunables.PAGE_MAX_BYTES;
    return server["refuse"]("self_page", written.reason, {
      bytes: written.bytes,
      ...written.reason === "too-large" ? { limit, over: written.bytes - limit } : {},
      ...written.short === null ? {} : { short: written.short },
      ...written.gate === null ? {} : { gate: written.gate },
      ...written.current === null ? {} : { currentVersion: written.current.version, currentBody: written.current.body },
      detail: PAGE_REFUSAL_DETAIL[written.reason] ?? "The page was not written."
    });
  }
  return server["result"]({
    stored: true,
    reason: written.reason,
    id: written.id,
    version: written.version,
    bytes: written.bytes,
    ...written.redacted === null ? {} : {
      redacted: true,
      redactedBy: written.redacted.gate,
      bytesBeforeRedaction: written.redacted.bytesBefore
    },
    ...pageRoomAnswer(written, server.counterpart.self.tunables.PAGE_ROOM_BYTES),
    appearsAtWake: "the next session's wake, once a turn has ended — the worker a turn's end starts re-renders it"
  }, false);
}
export function selfPageRead(server) {
  const page = server.counterpart.selfPage();
  if (page === null) {
    return server["result"]({
      present: false,
      reason: "still-forming",
      version: NO_PAGE_VERSION,
      detail: "No page has been written here yet. Write one when you have something true to say about yourself; while there is nothing, the honest page says it is still forming. Pass this `version` back as `ifVersion` if you want the write refused should one appear meanwhile."
    }, false);
  }
  return server["result"]({
    present: true,
    body: page.body,
    bytes: page.bytes,
    room: server.counterpart.self.tunables.PAGE_ROOM_BYTES,
    ...page.short === null ? {} : { short: page.short.body, shortBytes: page.short.bytes },
    revisedOn: page.revisedOn,
    by: page.by,
    version: page.version,
    sections: pageSections(page.body).sections.map((s) => s.heading),
    stale: server.counterpart.self.pageStale(page),
    versions: server.counterpart.selfPageVersionCount()
  }, false);
}
export function bindForPageWriter(server, claimed) {
  if (typeof claimed !== "string" || claimed.length === 0)
    return null;
  if (server.session !== null)
    return server.session === claimed ? claimed : null;
  const ok = server["corroborate"](claimed);
  if (!ok) {
    server["emit"]("mcp.session.unbound", undefined, { reason: "page-writer-claim" });
    return null;
  }
  return claimed;
}
