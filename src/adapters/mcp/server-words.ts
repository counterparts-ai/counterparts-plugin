/** What the MCP server says: its name and version, its refusals, its notes to Claude Desktop, and the words its tools answer with (moved out of `server.ts`, 2026-10-11). */
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { CLAUDE_AI_HOST, CLAUDE_AI_SCOPE, DEFAULT_HOST, DESKTOP_HOST, DESKTOP_SCOPE, wordingFor } from "../hosts.js";
import type { InstallRoute } from "../plugin.js";
import { newerStoreRemedy, newerStoreWords, reloadStep } from "../update-words.js";
import type { NewerStoreInput } from "../update-words.js";
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
export const SERVER_VERSION = "0.3.39";

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
 * THE SAME REFUSAL WITH THE ROUTE'S STEP (U1a, 2026-10-27). "Run /mcp and
 * Reconnect" is right for an npm install, which is replaced in place, and
 * Claude Desktop's and claude.ai's servers keep their own hosts' words. For
 * the PLUGIN it loops: Claude Code keeps the old version's folder, and an
 * open window's server keeps its path until `/reload-plugins`, so Reconnect
 * starts the same old code. Those servers get the plugin's step
 * (`update-words.ts#newerStoreWords`: reload when Claude Code records a newer
 * version than this server runs, update first otherwise), and an `either`
 * server names both. A plain sentence the model can pass on.
 */
export function newerStoreRefusal(input: Omit<NewerStoreInput, "who">): string {
  const host = input.host ?? DEFAULT_HOST;
  if (host !== DEFAULT_HOST || input.route === "npm") return staleServerRefusal(host);
  const words = newerStoreWords({ ...input, who: "server" });
  return `This tool did nothing: ${words.charAt(0).toLowerCase()}${words.slice(1)}`;
}

/**
 * THE SAME GATE WHEN ONLY THE CACHE IS AHEAD (2026-10-11): the search cache
 * (`cache/cache.sqlite`, box 3) carries a newer build's stamp while the store
 * does not. "Was updated … reconnect" is not true there — after a rollback
 * the installed build IS this one, and a reconnect loads the same code onto
 * the same cache. What is true: a newer build wrote the cache, and it is
 * rebuildable, so either that build comes back or the cache goes. The
 * reconnect after deleting it is real: this process holds the old file open.
 * The rebuild is real too (review of #529, measured): a deleted cache gets its
 * vectors back on the next open, but its WORD index stays empty until
 * `verify --rebuild` re-reads the prose.
 * `cacheFile` is the cache's path; the `*` takes its `-wal` and `-shm` too.
 *
 * BOTH WAYS IT HAPPENS (review of #382): an update whose new build moved the
 * cache and not the store reaches this gate too, while the old server still
 * runs — there the newer build IS installed, and the reconnect alone loads
 * it. So the sentence says both, and deleting is offered only for going back.
 */
export function cacheAheadRefusal(cacheFile: string, host: string = DEFAULT_HOST, route?: Omit<NewerStoreInput, "who" | "host">): string {
  const w = wordingFor(host);
  const lower = (s: string): string => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  // A PLUGIN'S SERVER (U1a): Reconnect restarts its old folder, so both ways
  // end in the route's step instead — update-or-reload for the newer build,
  // a reload (or a new session) to let go of the deleted file.
  const viaPlugin = host === DEFAULT_HOST && route !== undefined && route.route !== "npm";
  const load = viaPlugin ? `${newerStoreRemedy({ ...route, who: "server", host })}.` : lower(w.reconnect);
  const restart = viaPlugin ? reloadStep(route.codeTab === true) : lower(w.reconnectFirst);
  return `The search cache was written by a newer Counterparts build than this server runs, so this tool did nothing. If that newer build is installed, ${load} If you went back to an older build, delete ${cacheFile}* (the search cache alone; no memory is kept there) and run \`counterparts verify --rebuild --keep-vectors\` to rebuild its word index, then ${restart}.`;
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
 * CLAUDE.AI'S PROMPT (2026-10-26, OL1b item 5): claude.ai lists a connector's
 * prompts in the + menu (it called `prompts/list` three times on the trial's
 * first day), so a person can start a chat with one click. The person picks
 * it, so it may ask for the call outright; it also says what to do with what
 * the wake brings, as the instruction block does.
 */
export const CLAUDE_AI_START_PROMPT = {
  name: "wake-counterparts",
  title: "Wake Counterparts",
  description: "Wake your long-term memory for this conversation before we begin.",
  text: "Before anything else, call the counterparts wake tool, read what it returns, and keep the session id it gives for this conversation. If it brings something for me — something due, something left open between us, what you dreamed — mention it briefly. Then say hello as yourself, with that memory in mind.",
} as const;

/** The one prompt a chat host offers: claude.ai's, else Desktop's. */
export function startPromptFor(host: string): { readonly name: string; readonly title: string; readonly description: string; readonly text: string } {
  return host === CLAUDE_AI_HOST ? CLAUDE_AI_START_PROMPT : START_PROMPT;
}

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

/**
 * The ratings clause (2026-10-14; Mike's call) — the same words
 * the Claude Code Stop ask carries (`claude-code/hooks.ts#RATE_CLAUSE`; the
 * adapters do not import each other, so a test holds the two equal).
 */
export const RATE_ASK_CLAUSE = "`rated` 0–3 each footnote shown since you last wrote, and each `drewOn` id";

/** The write-up ask a Desktop tool result carries once the session is due one. */
export function desktopWriteUpAsk(session: string): string {
  return `Counterparts: this chat has gone on a while since it was last written up. At a natural pause, hand back what caught your attention, one idea each, with session_end (session: ${session}; memories: [] only if nothing held your attention; \`updates\` anything dated or open now done; ${RATE_ASK_CLAUSE}), and add a chapter with the chapter tool (session: ${session}) if the chat was about something. ${PRONOUN_RULE}`;
}

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
  "past-room":
    "That page is past its room (`room` bytes, UTF-8; `bytes` is what was sent, `over` how much to take out), so tonight's first send was not written. Cut it and send the whole page again — cut, don't add a short version: keep it thin. Sent again still past the room, it is kept; not sent again, it is kept when the run ends.",
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
  "lane-empty":
    "Tonight the reflection writes `## Core` alone, and what was sent has headings but no `## Core`. Nothing was written. Send the `## Core` section (its heading and its words); every other section is kept as it stands.",
};

/**
 * WHAT A NIGHTLY DOOR IS TOLD WHEN ITS WRITE WENT PAST ITS LANE (2026-10-23,
 * `self.PAGE_SPLIT`): the sections taken from the page as it stood, by name.
 * Nothing when none was.
 */
export function pageLaneAnswer(written: PageRevision): Record<string, unknown> {
  const kept = written.laneKept ?? [];
  if (kept.length === 0) return {};
  const names = kept.map((h) => (h.startsWith("the words") ? h : `\`## ${h}\``)).join(", ");
  return {
    laneKept: [...kept],
    laneNote: `Kept as it stood: ${names}. Tonight day's end amends every section but \`## Core\`, and the reflection writes \`## Core\` alone; the rest of what you sent was written.`,
  };
}

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

/** At most this many still-dated memories are listed beside a close (2026-10-14). */
export const STILL_DATED_SHOWN = 5;

/** The line beside them (`McpServer#stillDatedNear`, 2026-10-14). */
export const STILL_DATED_HINT =
  "These nearby memories still hold a date. If one is the same obligation as the one you just closed, close it too now: remember with updates: its id and eventDate: null (or status: done). If it is something else, leave it.";

/** Beside a "done" or owner-said write that lands close to a reminder due now (`McpServer#answersReminder`, 2026-10-20). */
export const ANSWERS_HINT =
  "This looks like it answers the reminder in `answers`, which is due now. If it does, close it: remember with updates: its id, status: done, and a short text (\"Done for this week\"). A repeating one closes for this time only and comes back on its next date; eventDate: null would end it. If it is something else, leave it.";

/** Beside a write that closed a dated memory and sent no title (2026-10-14). */
export const TITLE_ASKED_NOTE =
  "No title was given, and the old memory's was not carried over: this closes it, and the old title would read as still open. A title is asked for: give a memory that closes something its own short one (\"Taxes filed\").";

/**
 * CLAUDE.AI'S `instructions` (2026-10-26, the claude.ai trial): Desktop's one
 * line, said for a chat on the web — no Code tab, no Stop ask, no end of
 * conversation this server can see. claude.ai reportedly drops the field
 * (anthropics/claude-ai-mcp#93); the trial's canary rides beside it to measure
 * exactly that (`claudeAiInstructions`).
 */
export const CLAUDE_AI_INSTRUCTIONS =
  "Counterparts is your memory. In every conversation, call its wake tool first — before answering anything, and above all anything about the person, the past, or work in progress — and once: it returns this conversation's briefing and a session id to pass as `session` on every later call in it. Without a wake, what recall returns is a slice, not the whole record: never present it as complete. Nothing tells this memory when a conversation ends, so remember what matters as it comes up, in the moment, with the remember tool.";

/**
 * The `instructions` a claude.ai server sends, with the trial's CANARY when the
 * entry point was handed one: one invented fact no tool description carries, so
 * a cold question about it shows whether claude.ai delivered this field at all.
 */
export function claudeAiInstructions(canary?: string): string {
  return canary === undefined || canary.length === 0 ? CLAUDE_AI_INSTRUCTIONS : `${CLAUDE_AI_INSTRUCTIONS}\n\n${canary}`;
}

/** What a claude.ai call that needs a session is told when none is live. */
export const NO_CLAUDE_AI_SESSION =
  "No claude.ai session is live. Call the `wake` tool first: it starts this conversation's session and returns its id.";

/** The claude.ai copy of `desktopBindNote`: no Code tab on the other end. */
export function claudeAiBindNote(session: string): string {
  return `No session was named, so this call was filed under the most recent claude.ai session — ${session}, which may be another conversation's. Every tool takes "session" here: pass the id wake gave this conversation, so its calls stay together.`;
}

/**
 * WHAT A LAUNCH RESULT SAYS TO DO WITH ITS PROMPT, on claude.ai (2026-10-26,
 * OL1c). Every other host's `how` hands the prompt to "a background agent (the
 * Agent tool)"; claude.ai has none, and its `dream` / `reflect` descriptions say
 * the prompt is followed in the same run or conversation. The rest — the
 * dream's line shown as it came back, the share told as a telling and marked
 * told — is every host's, except that a share left in the night routine waits
 * for the next conversation (the routine's own prompt says so too).
 */
export const CLAUDE_AI_DREAM_LAUNCH_HOW =
  "Follow `prompt` yourself, here, step by step, through every call it names, passing the same session. In the night routine, a morning share it leaves is for the person's next conversation: do not tell it there or mark it told. In a conversation where the person asked you to dream, show them the dream's line from the hand-back exactly as it came back — it carries the dream's mark, which keeps the dream out of lived memory — and if a morning share follows, tell it in your own words, as a telling (\"While I slept I dreamed…\"), then call the reflect tool with phase \"told\" — never state what was dreamed as something that happened.";

/** The claude.ai copy of the reflect `launch` result's `how` (see above). */
export const CLAUDE_AI_REFLECT_LAUNCH_HOW =
  "Follow `prompt` yourself, here, step by step, passing the same session. When it finishes, if it left a morning share, tell it to the person in your own words, then call this tool with phase \"told\".";

/** The claude.ai copy of `DESKTOP_DREAM_NOTE`. */
export const CLAUDE_AI_DREAM_NOTE =
  "(claude.ai: there is no terminal here, so nobody has shown them that line — say it to them yourself, once, in your own words. And there is no background Agent tool: if they say dream, follow the prompt the launch returns yourself, here.)";

/**
 * THE WORDS A HOOKLESS CHAT HOST'S RESULTS SAY ABOUT IT, by host. Desktop's
 * entry is the constants above, unchanged; claude.ai's names no Code tab.
 */
export interface ChatWords {
  /** The host as a sentence names it: "Claude Desktop", "claude.ai". */
  readonly label: string;
  /** The place its chats share. */
  readonly place: string;
  readonly instructions: string;
  readonly noSession: string;
  readonly bindNote: (session: string) => string;
  readonly dreamNote: string;
  /** The Code-tab clause a "name your session" sentence adds, or "". */
  readonly codeTabClause: string;
}

export const CHAT_WORDS: Readonly<Record<string, ChatWords>> = {
  [DESKTOP_HOST]: {
    label: "Claude Desktop",
    place: DESKTOP_SCOPE,
    instructions: DESKTOP_INSTRUCTIONS,
    noSession: NO_DESKTOP_SESSION,
    bindNote: desktopBindNote,
    dreamNote: DESKTOP_DREAM_NOTE,
    codeTabClause: " — or, in a Claude Code session (Desktop's Code tab), the id your wake or Stop ask names",
  },
  [CLAUDE_AI_HOST]: {
    label: "claude.ai",
    place: CLAUDE_AI_SCOPE,
    instructions: CLAUDE_AI_INSTRUCTIONS,
    noSession: NO_CLAUDE_AI_SESSION,
    bindNote: claudeAiBindNote,
    dreamNote: CLAUDE_AI_DREAM_NOTE,
    codeTabClause: "",
  },
};

/** The words for a chat host; Desktop's for any host without its own. */
export function chatWordsFor(host: string): ChatWords {
  return CHAT_WORDS[host] ?? (CHAT_WORDS[DESKTOP_HOST] as ChatWords);
}

/**
 * "NO DREAMS" MEANS NO DREAMS (2026-10-26, OL1d, from #649's review). While the
 * dreaming setting is `off`, a dream `launch` refuses on every host with this,
 * and so do `writer` and `begin` called without one (review of #650): no night
 * starts from the tool — not day's end, not the dream, not the reflection after
 * it. A run already under way is not stopped (owner decision D): today's row
 * says `launched`, or the server is the headless night's own (Claude Code's
 * night composes its prompt from the store, never through `launch`).
 */
export const DREAMING_OFF_REFUSAL =
  'Dreaming is off ("no dreams"), so no night starts: no day\'s end, no dream, no reflection — do not call those phases for it. Saying "dreams on" turns it back on: this tool, phase "setting", value "auto", on their word.';

/**
 * WHAT THE `setting` RESULT SAYS, by host (OL1d). The setting is the person's
 * wish; the HOST decides who starts the night. Claude Code's first session
 * starts it in the background (its words, byte for byte as before). A hookless
 * host starts nothing on its own: on claude.ai (and the hosted server, which is
 * claude.ai's host) the person's routine, or a chat on their word, runs it, and
 * no daily question is shown there; Desktop's chat says the day's question
 * itself and follows a launch's prompt in the chat, while a Claude Code
 * session on the same memory, if there is one, still starts an `auto` night.
 */
export type DreamingSettingWords = Readonly<Record<"auto" | "ask" | "off", string>>;

export const CLAUDE_CODE_SETTING_SAID: DreamingSettingWords = {
  auto: "Dreaming on its own: once a day, the first session starts the nightly run by itself, in a separate windowless session in the background, and says so in one line. Today's run is still yours to start, if the owner asked for it.",
  ask: "Dreaming asks first: once a day, the first session shows the owner the question in the terminal and waits for their word.",
  off: "No dreams: nothing starts the nightly run and nothing asks. It can be turned back on with this phase (value ask or auto) when the owner says so.",
};

export const CLAUDE_AI_SETTING_SAID: DreamingSettingWords = {
  auto: "Dreaming on: nothing here starts a night on its own — their night routine, or saying \"dream\" in a chat, runs the night (day's end, the dream, the reflection).",
  ask: "Dreaming on: claude.ai shows no daily question, so this works as auto does — their night routine, or saying \"dream\" in a chat, runs the night.",
  off: "No dreams: the night is skipped even if their routine runs — its launch is refused and says so. Saying \"dreams on\" turns it back on (this phase, value auto).",
};

export const DESKTOP_SETTING_SAID: DreamingSettingWords = {
  auto: "Dreaming on its own: this chat starts nothing by itself. If Claude Code shares this memory, its first session of a day starts the nightly run in the background; here, saying \"dream\" runs it in the chat.",
  ask: "Dreaming asks first: once a day, the first wake brings the question — say it to them once, in your own words, and wait for their word.",
  off: "No dreams: nothing starts the nightly run and nothing asks, and a launch is refused. It can be turned back on with this phase (value ask or auto) when the owner says so.",
};

/** The `setting` result's words for the server's host; Claude Code's for any host without its own. */
export function settingSaidFor(host: string): DreamingSettingWords {
  if (host === CLAUDE_AI_HOST) return CLAUDE_AI_SETTING_SAID;
  if (host === DESKTOP_HOST) return DESKTOP_SETTING_SAID;
  return CLAUDE_CODE_SETTING_SAID;
}

/** Every host but claude.ai and Desktop: the dream `launch` result's `how`, as before. */
export const DREAM_LAUNCH_HOW =
  "Hand `prompt` to a background agent (the Agent tool), unchanged, and carry on. When it finishes, show the owner its first line (the dream's) exactly as it came back — it carries the dream's mark, which keeps the dream out of lived memory. If a morning share follows, tell it to the owner in your own words, as a telling (\"While I slept I dreamed…\"), then call the reflect tool with phase \"told\" — never state what was dreamed as something that happened.";

/** Every host but claude.ai and Desktop: the reflect `launch` result's `how`, as before. */
export const REFLECT_LAUNCH_HOW =
  "Hand `prompt` to a background agent (the Agent tool), unchanged, and carry on. When it finishes, if it left a morning share, tell it to the owner in your own words, then call this tool with phase \"told\".";

/**
 * DESKTOP'S `how` (OL1d): Desktop's chat has no background Agent tool (its dream
 * note already says to follow the launch's prompt in the chat), so the result
 * says the same.
 */
export const DESKTOP_DREAM_LAUNCH_HOW =
  "Follow `prompt` yourself, here, step by step, through every call it names, passing the same session. When it finishes, show the owner the dream's line from the hand-back exactly as it came back — it carries the dream's mark, which keeps the dream out of lived memory. If a morning share follows, tell it to the owner in your own words, as a telling (\"While I slept I dreamed…\"), then call the reflect tool with phase \"told\" — never state what was dreamed as something that happened.";

export const DESKTOP_REFLECT_LAUNCH_HOW =
  "Follow `prompt` yourself, here, step by step, passing the same session. When it finishes, if it left a morning share, tell it to the owner in your own words, then call this tool with phase \"told\".";

/** The dream `launch` result's `how` for the server's host. */
export function dreamLaunchHowFor(host: string): string {
  return host === CLAUDE_AI_HOST ? CLAUDE_AI_DREAM_LAUNCH_HOW : host === DESKTOP_HOST ? DESKTOP_DREAM_LAUNCH_HOW : DREAM_LAUNCH_HOW;
}

/** The reflect `launch` result's `how` for the server's host. */
export function reflectLaunchHowFor(host: string): string {
  return host === CLAUDE_AI_HOST ? CLAUDE_AI_REFLECT_LAUNCH_HOW : host === DESKTOP_HOST ? DESKTOP_REFLECT_LAUNCH_HOW : REFLECT_LAUNCH_HOW;
}
