import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { DEFAULT_HOST, wordingFor } from "../hosts.js";
import { RECALL_MAX_IDS } from "./deliberate.js";
import { PRONOUN_RULE } from "../../core/onboarding.js";
import { NO_PAGE_VERSION, pageRoomNote } from "../../core/self/index.js";
export const SERVER_NAME = "counterparts";
export const SERVER_VERSION = "0.3.22";
export function staleServerRefusal(host = DEFAULT_HOST) {
  return `Counterparts was updated and this server is still running the old version, so this tool did nothing. ${wordingFor(host).reconnect}`;
}
export const STALE_SERVER_REFUSAL = staleServerRefusal(DEFAULT_HOST);
export function cacheAheadRefusal(cacheFile, host = DEFAULT_HOST) {
  const w = wordingFor(host);
  const lower = (s) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  return `The search cache was written by a newer Counterparts build than this server runs, so this tool did nothing. If that newer build is installed, ${lower(w.reconnect)} If you went back to an older build, delete ${cacheFile}* (the search cache alone; no memory is kept there, and it is rebuilt), then ${lower(w.reconnectFirst)}.`;
}
export function schemaUnreadableRefusal(host = DEFAULT_HOST) {
  return `This server could not read which version the memory store is at, so this tool did nothing. ${wordingFor(host).reconnectFirst}; if that does not help, run \`counterparts doctor\`.`;
}
export const SCHEMA_UNREADABLE_REFUSAL = schemaUnreadableRefusal(DEFAULT_HOST);
export const STORE_BUSY_REFUSAL = "The memory store was busy, so this tool did nothing. Try again in a moment.";
export const DESKTOP_INSTRUCTIONS = "Counterparts is your memory. In every new chat, call its wake tool first — before answering anything about the person, the past, or work in progress — and once: it returns this chat's briefing, including what happened yesterday across every session, and a session id to pass on session_end, chapter, dream and reflect. Without a wake, what recall returns is a slice, not the whole record: never present it as complete. In a Claude Code session (Desktop's Code tab) the hook already woke you: do not call wake — pass your own session id, the one your wake or Stop ask names, as `session` on every call.";
export const START_PROMPT = {
  name: "start-with-counterparts",
  title: "Start with Counterparts",
  description: "Wake this chat's memory before we begin.",
  text: "Before anything else, call the counterparts wake tool, read what it returns, and keep the session id it gives for this chat. Then say hello as yourself — briefly — with that memory in mind."
};
export const DESKTOP_DREAM_NOTE = "(Claude Desktop: there is no terminal here, so nobody has shown them that line — say it to them yourself, once, in your own words. And there is no background Agent tool: if they say dream, follow the prompt the launch returns yourself, here.)";
export function uninstallRouteWords(install, desktop) {
  if (install === "plugin" && !desktop)
    return "type /counterparts:uninstall in Claude Code";
  if (install === "npm" || desktop)
    return "run counterparts uninstall in a terminal";
  return "type /counterparts:uninstall in Claude Code (or, for an npm install, run counterparts uninstall in a terminal)";
}
export function memoryHomeWords(storeDir, configPath, home = homedir()) {
  const base = configPath !== undefined && configPath.length > 0 ? dirname(configPath) : basename(storeDir) === "store" ? dirname(storeDir) : storeDir;
  return base === home ? "~" : base.startsWith(`${home}/`) ? `~${base.slice(home.length)}` : base;
}
export function desktopBindNote(session) {
  return `No session was named, so this call was filed under the most recent Claude Desktop session — Desktop chat ${session}. Every tool takes "session" here: pass the id wake gave this chat, so its calls stay together — and no other chat's write-up ask reaches it. If you are a Claude Code session (Desktop's Code tab), pass your own session id — the one your wake or Stop ask names — and the call is filed under your session and its directory instead.`;
}
export const NO_DESKTOP_SESSION = "No Claude Desktop session is live. Call the `wake` tool first: it starts this chat's session and returns its id. (In a Claude Code session — Desktop's Code tab — do not call wake: pass the session id your wake or Stop ask names.)";
export function desktopWriteUpAsk(session) {
  return `Counterparts: this chat has gone on a while since it was last written up. At a natural pause, hand back what caught your attention, one idea each, with session_end (session: ${session}; memories: [] only if nothing held your attention; \`updates\` anything dated or open now done), and add a chapter with the chapter tool (session: ${session}) if the chat was about something. ${PRONOUN_RULE}`;
}
export const OWNER_FALSE_NOTE = "owner: false — confidential memories are left out of this server's answers, and an open question written in another directory cannot be closed from here. It is the ordinary setting for a Claude Desktop chat; your Claude Code sessions run as the owner unless COUNTERPARTS_OWNER=0. Nothing is wrong.";
export const OWNER_ENV_NAME = "COUNTERPARTS_OWNER";
export const PAGE_REFUSAL_DETAIL = {
  empty: "A page has to say something. Nothing worth writing is a real answer — leave the page alone instead.",
  "too-large": "That page is past the write ceiling (`limit` bytes, UTF-8; `bytes` is what was sent, `over` how much to take out) — a sanity bound far past the page's room. It was refused rather than cut: what gets cut at write time is the only copy. Say the same thing shorter — tighten, merge or drop what no longer holds — and send the whole page again.",
  "short-not-needed": "The page is within its room, so the wake shows it whole and a short version would never be read. Nothing was written.",
  "short-refused": "The short version was not kept (`short.reason`: past the room, the page's credential gate, or the wake's own markers), so nothing was written. Fix that and send it again.",
  "gate-refused": "The gate battery turned it away — most often because what was sent was nothing but a credential, or too short to be a page. Nothing was written.",
  "forged-markers": "That page contains the wake's own structural markers (`<!-- counterparts:wake`). Those lines are the bundle's bookkeeping, and a page carrying them reads to the next session as the end of its memory. Write the page in ordinary prose; headings are fine.",
  "version-moved": "Somebody else wrote the page after the version you read — another session, the owner, or the nightly writer. Nothing was written, and nothing of theirs was lost. `currentVersion` and `currentBody` here are what is actually there: fold your change into that and send it back with the new `ifVersion`.",
  "no-page": "You named a version and there is no page here at all — nobody wrote over you. Omit `ifVersion` to write the first page, or pass -1, which is the version a read of an empty store reports.",
  "page-appeared": "You wrote as if there were no page, and one has appeared since you looked. Nothing was written. `currentVersion` and `currentBody` are what is there: read it, fold your change into it, and send it back with that version."
};
export function pageRoomAnswer(written, room) {
  const note = pageRoomNote(written, room, `call self_page again with \`short\` alone and \`ifVersion: ${String(written.version ?? NO_PAGE_VERSION)}\``);
  return {
    ...written.overRoom === null ? {} : { room: written.overRoom, overRoom: true },
    ...written.short === null ? {} : { short: written.short },
    ...note === null ? {} : { roomNote: note }
  };
}
export function dreamHow(bundle) {
  const q = bundle.queue;
  const s = bundle.shownAs;
  const waits = q.waiting > 0 ? ` ${String(q.waiting)} more new wait for the next night.` : "";
  const aged = q.agedOut > 0 ? ` ${String(q.agedOut)} fell below reach since the last dream, never dreamed.` : "";
  const carried = (q.carried ?? 0) > 0 ? ` ${String(q.carried)} of the new are parts of a fold the last night could not make, put first.` : "";
  return `Tonight: ${String(q.tonight)} of ${String(q.new)} new memories.${waits}${aged}${carried} ` + `Shown whole: ${String(s.whole)}; as an excerpt: ${String(s.excerpt)}; as a line: ${String(s.line)}${s.notShown > 0 ? `; related, not shown: ${String(s.notShown)}` : ""}. ` + `To read any whole, call the recall tool with ids: [...] — up to ${String(RECALL_MAX_IDS)} at once.`;
}
export const RECALL_MODE_WORDS = 'A question needs mode: "facts" — what happened, who said it, when, and whether it still holds (every match, ranked, with dates and speaker); or "meaning" — how something went, felt, and what it adds up to (a person, a project, us).';
