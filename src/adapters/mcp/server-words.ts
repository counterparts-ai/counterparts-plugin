/** What the MCP server says: its name and version, its refusals, its notes to Claude Desktop, and the words its tools answer with (moved out of `server.ts`, 2026-10-11). */
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { DEFAULT_HOST, wordingFor } from "../hosts.js";
import type { InstallRoute } from "../plugin.js";
import { RECALL_MAX_IDS } from "./deliberate.js";
import type { DreamBundle } from "../../core/dream/index.js";
import { PRONOUN_RULE } from "../../core/onboarding.js";
import { NO_PAGE_VERSION, pageRoomNote } from "../../core/self/index.js";
import type { PageRevision } from "../../core/self/index.js";

export const SERVER_NAME = "counterparts";

/**
 * What `initialize` tells the client it is talking to. It is the PACKAGE's
 * version, and `test/mcp.test.ts` reads `package.json` and asserts the two are
 * the same string — a literal here that drifted would make the one number a
 * client can see about this server a lie, and the handshake is exactly where a
 * host decides whether to trust what follows. Read from a constant rather than
 * from disk so the server opens no file to answer its first message.
 */
export const SERVER_VERSION = "0.3.20";

/**
 * THE ONE LINE EVERY TOOL ANSWERS WITH when the store on disk is a schema AHEAD
 * of the code this process loaded — a newer build migrated it after this
 * server started (`call`'s schema gate). The same sentence for every tool,
 * ending in the same remedy the hook's update notice ends in.
 *
 * The remedy is the HOST's (`hosts.ts`, 2026-09-30): `/mcp` is Claude Code's
 * command, so the sentence a server hands back is built from the wording of
 * the host it serves (`McpServerOptions.host`). The constant is Claude Code's,
 * unchanged.
 */
export function staleServerRefusal(host: string = DEFAULT_HOST): string {
  return `Counterparts was updated and this server is still running the old version, so this tool did nothing. ${wordingFor(host).reconnect}`;
}

export const STALE_SERVER_REFUSAL = staleServerRefusal(DEFAULT_HOST);

/**
 * THE SAME GATE WHEN ONLY THE CACHE IS AHEAD (2026-10-11): the search cache
 * (`cache/cache.sqlite`, box 3) carries a newer build's stamp while the store
 * does not. "Was updated … reconnect" is not true there — after a rollback
 * the installed build IS this one, and a reconnect loads the same code onto
 * the same cache. What is true: a newer build wrote the cache, and it is
 * rebuildable, so either that build comes back or the cache goes. The
 * reconnect after deleting it is real: this process holds the old file open.
 * `cacheFile` is the cache's path; the `*` takes its `-wal` and `-shm` too.
 *
 * BOTH WAYS IT HAPPENS (review of #382): an update whose new build moved the
 * cache and not the store reaches this gate too, while the old server still
 * runs — there the newer build IS installed, and the reconnect alone loads
 * it. So the sentence says both, and deleting is offered only for going back.
 */
export function cacheAheadRefusal(cacheFile: string, host: string = DEFAULT_HOST): string {
  const w = wordingFor(host);
  const lower = (s: string): string => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  return `The search cache was written by a newer Counterparts build than this server runs, so this tool did nothing. If that newer build is installed, ${lower(w.reconnect)} If you went back to an older build, delete ${cacheFile}* (the search cache alone; no memory is kept there, and it is rebuilt), then ${lower(w.reconnectFirst)}.`;
}

/** The gate's refusal when the stamps could not be read at all — the same
 *  first step, in the host's words. */
export function schemaUnreadableRefusal(host: string = DEFAULT_HOST): string {
  return `This server could not read which version the memory store is at, so this tool did nothing. ${wordingFor(host).reconnectFirst}; if that does not help, run \`counterparts doctor\`.`;
}

export const SCHEMA_UNREADABLE_REFUSAL = schemaUnreadableRefusal(DEFAULT_HOST);

/** And when the store was merely busy past the wait: a retry, not a reconnect. */
export const STORE_BUSY_REFUSAL =
  "The memory store was busy, so this tool did nothing. Try again in a moment.";

/**
 * THE ONE LINE `initialize` CARRIES FOR A DESKTOP CLIENT (brief item 5): MCP's
 * `instructions` field. Desktop reportedly ignores it; it costs nothing, and
 * a host that reads it learns the one thing it needs to.
 */
export const DESKTOP_INSTRUCTIONS =
  "Counterparts is your memory. In every new chat, call its wake tool first — before answering anything about the person, the past, or work in progress — and once: it returns this chat's briefing, including what happened yesterday across every session, and a session id to pass on session_end, chapter, dream and reflect. Without a wake, what recall returns is a slice, not the whole record: never present it as complete. In a Claude Code session (Desktop's Code tab) the hook already woke you: do not call wake — pass your own session id, the one your wake or Stop ask names, as `session` on every call.";

/** The MCP prompt a Desktop person can pick (brief item 6). */
export const START_PROMPT = {
  name: "start-with-counterparts",
  title: "Start with Counterparts",
  description: "Wake this chat's memory before we begin.",
  text: "Before anything else, call the counterparts wake tool, read what it returns, and keep the session id it gives for this chat. Then say hello as yourself — briefly — with that memory in mind.",
} as const;

/**
 * THE ONE LINE THAT MAKES A DESKTOP DREAM LINE TRUE THERE. The day's dream line
 * is core's, and says the person was "shown … in the terminal" and that the
 * prompt goes to "a background agent (the Agent tool)". Desktop chat has
 * neither, so the wake adds this beside it rather than rewriting core's words.
 */
export const DESKTOP_DREAM_NOTE =
  "(Claude Desktop: there is no terminal here, so nobody has shown them that line — say it to them yourself, once, in your own words. And there is no background Agent tool: if they say dream, follow the prompt the launch returns yourself, here.)";

/**
 * HOW TO REMOVE COUNTERPARTS, for the first meeting's close: the console's
 * `counterparts uninstall` for an npm install (and Desktop, which is wired by
 * it), the plugin's `/counterparts:uninstall` inside Claude Code; both when
 * this process cannot tell. Each asks before it deletes the memories.
 */
export function uninstallRouteWords(install: InstallRoute, desktop: boolean): string {
  if (install === "plugin" && !desktop) return "type /counterparts:uninstall in Claude Code";
  if (install === "npm" || desktop) return "run counterparts uninstall in a terminal";
  return "type /counterparts:uninstall in Claude Code (or, for an npm install, run counterparts uninstall in a terminal)";
}

/** Where the memory lives, as a person types it: the folder the configuration sits in (`~/.counterparts`), else the store's. */
export function memoryHomeWords(storeDir: string, configPath: string | undefined, home: string = homedir()): string {
  const base = configPath !== undefined && configPath.length > 0 ? dirname(configPath) : basename(storeDir) === "store" ? dirname(storeDir) : storeDir;
  return base === home ? "~" : base.startsWith(`${home}/`) ? `~${base.slice(home.length)}` : base;
}

/**
 * WHAT A DESKTOP CALL THAT NAMED NO SESSION IS TOLD (2026-10-01: and a Claude
 * Code session in Desktop's Code tab, whose calls land here too and cannot be
 * told apart from a chat's, is told how to correct itself).
 */
export function desktopBindNote(session: string): string {
  return `No session was named, so this call was filed under the most recent Claude Desktop session — Desktop chat ${session}. Every tool takes "session" here: pass the id wake gave this chat, so its calls stay together — and no other chat's write-up ask reaches it. If you are a Claude Code session (Desktop's Code tab), pass your own session id — the one your wake or Stop ask names — and the call is filed under your session and its directory instead.`;
}

/** What a Desktop call that needs a session is told when none is live. */
export const NO_DESKTOP_SESSION =
  "No Claude Desktop session is live. Call the `wake` tool first: it starts this chat's session and returns its id. (In a Claude Code session — Desktop's Code tab — do not call wake: pass the session id your wake or Stop ask names.)";

/** The write-up ask a Desktop tool result carries once the session is due one. */
export function desktopWriteUpAsk(session: string): string {
  return `Counterparts: this chat has gone on a while since it was last written up. At a natural pause, hand back what caught your attention, one idea each, with session_end (session: ${session}; memories: [] only if nothing held your attention; \`updates\` anything dated or open now done), and add a chapter with the chapter tool (session: ${session}) if the chat was about something. ${PRONOUN_RULE}`;
}

/** What `status` says `owner: false` means — the confused Desktop chats' question (2026-09-30). */
export const OWNER_FALSE_NOTE =
  "owner: false — confidential memories are left out of this server's answers, and an open question written in another directory cannot be closed from here. It is the ordinary setting for a Claude Desktop chat; your Claude Code sessions run as the owner unless COUNTERPARTS_OWNER=0. Nothing is wrong.";

/** The owner variable's name, for `status` (the entry point reads it, `stance-env.ts`). */
export const OWNER_ENV_NAME = "COUNTERPARTS_OWNER";

/** The kind enum, for a refusal that names it (session_end). Derived from
 *  `Kind` so that adding a kind without listing it here fails `tsc`. */
/**
 * Why a page write did not land, in the words the model needs to do something
 * about it. The keys are `self/`'s own refusal vocabulary, so a reason it can
 * return and this map does not carry falls back to one plain sentence rather
 * than to silence.
 */
export const PAGE_REFUSAL_DETAIL: Record<string, string> = {
  empty: "A page has to say something. Nothing worth writing is a real answer — leave the page alone instead.",
  "too-large":
    "That page is past the write ceiling (`limit` bytes, UTF-8; `bytes` is what was sent, `over` how much to take out) — a sanity bound far past the page's room. It was refused rather than cut: what gets cut at write time is the only copy. Say the same thing shorter — tighten, merge or drop what no longer holds — and send the whole page again.",
  "short-not-needed":
    "The page is within its room, so the wake shows it whole and a short version would never be read. Nothing was written.",
  "short-refused":
    "The short version was not kept (`short.reason`: past the room, the page's credential gate, or the wake's own markers), so nothing was written. Fix that and send it again.",
  "gate-refused":
    "The gate battery turned it away — most often because what was sent was nothing but a credential, or too short to be a page. Nothing was written.",
  "forged-markers":
    "That page contains the wake's own structural markers (`<!-- counterparts:wake`). Those lines are the bundle's bookkeeping, and a page carrying them reads to the next session as the end of its memory. Write the page in ordinary prose; headings are fine.",
  "version-moved":
    "Somebody else wrote the page after the version you read — another session, the owner, or the nightly writer. Nothing was written, and nothing of theirs was lost. `currentVersion` and `currentBody` here are what is actually there: fold your change into that and send it back with the new `ifVersion`.",
  "no-page":
    "You named a version and there is no page here at all — nobody wrote over you. Omit `ifVersion` to write the first page, or pass -1, which is the version a read of an empty store reports.",
  "page-appeared":
    "You wrote as if there were no page, and one has appeared since you looked. Nothing was written. `currentVersion` and `currentBody` are what is there: read it, fold your change into it, and send it back with that version.",
};

/**
 * WHAT A WRITE PAST THE PAGE'S ROOM IS TOLD (2026-10-10): the room, what
 * became of a short version, and — when none was kept — how to add one, in
 * `pageRoomNote`'s words. Nothing for a page within its room and no short
 * version sent.
 */
export function pageRoomAnswer(written: PageRevision, room: number): Record<string, unknown> {
  const note = pageRoomNote(
    written,
    room,
    `call self_page again with \`short\` alone and \`ifVersion: ${String(written.version ?? NO_PAGE_VERSION)}\``,
  );
  return {
    ...(written.overRoom === null ? {} : { room: written.overRoom, overRoom: true }),
    ...(written.short === null ? {} : { short: written.short }),
    ...(note === null ? {} : { roomNote: note }),
  };
}

/**
 * What one handle-path answer should leave in the resolution log, as a TOTAL
 * table over the reasons that path can produce:
 *
 *   an id       — it expanded, and this is what it reached
 *   `null`      — it was asked and answered with nothing (the shadow)
 *   `undefined` — not this path's outcome at all; record nothing
 *
 * Total on purpose. A new handle-path reason added without a line here records
 * nothing rather than guessing, which fails in the under-credit direction.
 */
/**
 * THE LOOKUP, NAMED IN THE DREAM'S OWN RESULT (2026-09-28): what tonight's
 * room gave, what waits, and how to read the rest — with the number of ids
 * one recall takes. Kept short: `dreamResultChars`' margin holds room for it.
 */
export function dreamHow(bundle: Pick<DreamBundle, "queue" | "shownAs">): string {
  const q = bundle.queue;
  const s = bundle.shownAs;
  const waits = q.waiting > 0 ? ` ${String(q.waiting)} more new wait for the next night.` : "";
  // Since 2026-10-11 (Group 3 part C) a memory leaves the queue when it falls
  // below reach, and a refused fold's parts come back carried.
  const aged = q.agedOut > 0 ? ` ${String(q.agedOut)} fell below reach since the last dream, never dreamed.` : "";
  const carried = (q.carried ?? 0) > 0 ? ` ${String(q.carried)} of the new are parts of a fold the last night could not make, put first.` : "";
  return (
    `Tonight: ${String(q.tonight)} of ${String(q.new)} new memories.${waits}${aged}${carried} ` +
    `Shown whole: ${String(s.whole)}; as an excerpt: ${String(s.excerpt)}; as a line: ${String(s.line)}${s.notShown > 0 ? `; related, not shown: ${String(s.notShown)}` : ""}. ` +
    `To read any whole, call the recall tool with ids: [...] — up to ${String(RECALL_MAX_IDS)} at once.`
  );
}

/**
 * THE TWO MODES, in the words a refusal teaches them with (Release B,
 * 2026-10-03). There is no default: the caller says which question it is
 * asking.
 */
export const RECALL_MODE_WORDS =
  'A question needs mode: "facts" — what happened, who said it, when, and whether it still holds (every match, ranked, with dates and speaker); or "meaning" — how something went, felt, and what it adds up to (a person, a project, us).';
