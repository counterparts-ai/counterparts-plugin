import {
  closeSync,
  constants as FS,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync
} from "node:fs";
import { carriesDreamMark } from "../../core/dream/mark.js";
const INJECTED = /<(system-reminder|command-name|command-message|local-command-stdout|cross-session-[a-z-]+)\b/i;
const HOST_FRAMES = [
  /^<(?:task-notification|agent-message|bash-stdout|bash-stderr|local-command-caveat)\b/i,
  /^Another Claude session sent a message:/,
  /^\[Subagent hand-back\]/,
  /^\[Request interrupted by user/,
  /^[A-Z][A-Za-z]+ hook (?:success|additional context|system message):/
];
const STOP_HOOK_FEEDBACK = /^Stop hook feedback:/;
const CROSS_SESSION_MESSAGE = /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/gi;
const CROSS_SESSION_NOTICE = /^\[Cross-session idle notice\]/;
function attr(attrs, name) {
  const found = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs);
  const value = found?.[2] ?? found?.[3];
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}
export function attributePeers(text) {
  CROSS_SESSION_MESSAGE.lastIndex = 0;
  if (!CROSS_SESSION_MESSAGE.test(text)) {
    return { text, peers: 0, ownerText: text.trim().length > 0 };
  }
  let peers = 0;
  let cursor = 0;
  const outside = [];
  const parts = [];
  CROSS_SESSION_MESSAGE.lastIndex = 0;
  let match;
  while ((match = CROSS_SESSION_MESSAGE.exec(text)) !== null) {
    peers += 1;
    const before = text.slice(cursor, match.index);
    outside.push(before);
    parts.push(before);
    const attrs = match[1] ?? "";
    const who = attr(attrs, "from-name") ?? attr(attrs, "from-session") ?? "unnamed";
    parts.push(`[message from another Claude session, ${who}]: ${(match[2] ?? "").trim()}`);
    cursor = match.index + match[0].length;
  }
  const tail = text.slice(cursor);
  outside.push(tail);
  parts.push(tail);
  return { text: parts.join("").trim(), peers, ownerText: outside.join("").trim().length > 0 };
}
export const FOREIGN_MARKERS = [
  /^Stop hook feedback:\s*(?:[-*]\s*)?\[bansai\]/,
  /^\[bansai\] /,
  /<bansai-memory>/,
  /^The following is your standing self-model \(bansai\)/,
  /^bansai: your persistent memory is initializing/
];
export function classifyBlock(text) {
  const probe = text.trimStart();
  for (const marker of FOREIGN_MARKERS) {
    if (marker.test(probe))
      return "foreign";
  }
  if (STOP_HOOK_FEEDBACK.test(probe))
    return "ritual";
  if (CROSS_SESSION_NOTICE.test(probe))
    return "injected";
  return INJECTED.test(text) ? "injected" : "conversation";
}
function hostFramed(text) {
  const probe = text.trimStart();
  return HOST_FRAMES.some((frame) => frame.test(probe));
}
export function startedByHost(text) {
  if (hostFramed(text))
    return true;
  const attributed = attributePeers(text);
  return attributed.peers > 0 && !attributed.ownerText;
}
export function hostRecord(entry) {
  if (entry["isCompactSummary"] === true)
    return true;
  if (entry["isMeta"] !== true)
    return false;
  const origin = entry["origin"];
  const kind = origin !== null && typeof origin === "object" && !Array.isArray(origin) ? origin["kind"] : undefined;
  return kind !== "peer";
}
export function entryAuthor(entry, role) {
  if (role === "assistant") {
    const message = entry["message"];
    if (entry["isApiErrorMessage"] === true || message?.["model"] === "<synthetic>")
      return "host";
    return "unknown";
  }
  if (entry["isMeta"] === true || entry["isCompactSummary"] === true)
    return "host";
  const origin = entry["origin"];
  if (origin !== null && typeof origin === "object" && !Array.isArray(origin)) {
    const kind = origin["kind"];
    if (typeof kind === "string")
      return kind === "human" ? "human" : "host";
  }
  return "unknown";
}
export const STOP_ASK_OPENER = "Counterparts, before this session closes:";
const HOOK_FRAME = "[A-Z][A-Za-z]+ hook [A-Za-z ]+:\\s*(?:-\\s*)?(?:\\[[^\\n]*?\\]:\\s*)?";
const REMINDER_FRAME = "<system-reminder>\\s*";
const OPENER = STOP_ASK_OPENER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OWN_ASK = new RegExp(`^(?:${REMINDER_FRAME})?(?:${HOOK_FRAME})?${OPENER}`);
const OWN_ASK_FRAMED = new RegExp(`^(?:${REMINDER_FRAME}(?:${HOOK_FRAME})?|${HOOK_FRAME})${OPENER}`);
export const RECALL_TOOL_NAME = /(^|__)recall$/;
export function expansionIdsOf(input) {
  if (input === null || typeof input !== "object")
    return [];
  const i = input;
  const out = [];
  if (typeof i["handle"] === "string")
    out.push(i["handle"]);
  if (Array.isArray(i["ids"])) {
    for (const id of i["ids"])
      if (typeof id === "string")
        out.push(id);
  }
  return out;
}
export function readTranscript(path) {
  if (path === undefined || path.trim().length === 0) {
    return { turns: [], ok: false, reason: "absent", corrupt: 0, expansions: [] };
  }
  if (!existsSync(path))
    return { turns: [], ok: false, reason: "absent", corrupt: 0, expansions: [] };
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { turns: [], ok: false, reason: "unreadable", corrupt: 0, expansions: [] };
  }
  return parseTranscript(raw);
}
function isEntry(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function parseTranscript(raw) {
  const turns = [];
  const expansions = [];
  let corrupt = 0;
  let ordinal = -1;
  let pending = [];
  let model;
  for (const line of raw.split(`
`)) {
    if (line.trim().length === 0)
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      corrupt += 1;
      continue;
    }
    if (!isEntry(entry)) {
      corrupt += 1;
      continue;
    }
    if (entry["type"] === "attachment") {
      const queued = queuedPromptOf(entry);
      if (queued === undefined)
        continue;
      ordinal += 1;
      const pieces = blocksOf(queued, "user", "human");
      const said = typedText(pieces);
      if (said.length > 0)
        pending.push(said);
      for (const piece of pieces) {
        if (piece.text.trim().length === 0)
          continue;
        turns.push({ role: "user", text: piece.text, source: piece.source, entry: ordinal });
      }
      continue;
    }
    const message = entry["message"];
    const role = message?.["role"] ?? entry["role"];
    if (role !== "user" && role !== "assistant")
      continue;
    const content = message?.["content"] ?? entry["content"];
    const author = entryAuthor(entry, role);
    if (role === "assistant" && author !== "host" && entry["isSidechain"] !== true) {
      const said = message?.["model"];
      if (typeof said === "string" && said.length > 0)
        model = said;
    }
    const all = blocksOf(content, role, author);
    const pieces = role === "user" && hostRecord(entry) ? all.filter((p) => p.source !== "injected") : all;
    if (role === "user" && author === "human" && pending.length > 0) {
      const twin = entry["promptSource"] === "queued" ? pending.indexOf(typedText(pieces)) : -1;
      if (twin !== -1) {
        pending.splice(twin, 1);
        continue;
      }
      pending = [];
    }
    ordinal += 1;
    for (const piece of pieces) {
      if (piece.expansion !== undefined && role === "assistant" && piece.expansion.length > 0) {
        expansions.push({ atTurn: turns.length, ids: piece.expansion });
      }
      if (piece.text.trim().length === 0)
        continue;
      turns.push({ role, text: piece.text, source: piece.source, entry: ordinal });
    }
  }
  return { turns, ok: true, reason: "read", corrupt, expansions, ...model === undefined ? {} : { model } };
}
function queuedPromptOf(entry) {
  const att = entry["attachment"];
  if (!isEntry(att) || att["type"] !== "queued_command" || att["commandMode"] !== "prompt")
    return;
  if (att["isMeta"] === true || entry["isMeta"] === true)
    return;
  const origin = att["origin"];
  if (!isEntry(origin) || origin["kind"] !== "human")
    return;
  const prompt = att["prompt"];
  return typeof prompt === "string" || Array.isArray(prompt) ? prompt : undefined;
}
function typedText(pieces) {
  return pieces.filter((p) => p.source === "conversation").map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();
}
function pieceOf(text, role, author) {
  const source = classifyBlock(text);
  if (source === "foreign" || source === "ritual")
    return { text, source };
  if (carriesDreamMark(text))
    return { text, source: "dream" };
  if (role !== "user")
    return { text, source: author === "host" ? "injected" : source };
  if (author === "host") {
    if (OWN_ASK.test(text.trimStart()))
      return { text, source: "ritual" };
    const attributed = attributePeers(text);
    return { text: attributed.peers > 0 ? attributed.text : text, source: "injected" };
  }
  if (author === "human") {
    const attributed = attributePeers(text);
    const peerOnly = attributed.peers > 0 && !attributed.ownerText;
    return { text: attributed.text, source: peerOnly ? "injected" : "conversation" };
  }
  if (OWN_ASK_FRAMED.test(text.trimStart()))
    return { text, source: "ritual" };
  if (source === "conversation" && hostFramed(text))
    return { text, source: "injected" };
  const attributed = attributePeers(text);
  if (attributed.peers === 0)
    return { text, source };
  return { text: attributed.text, source: attributed.ownerText ? "conversation" : "injected" };
}
function blocksOf(content, role, author) {
  if (typeof content === "string") {
    return [pieceOf(content, role, author)];
  }
  if (!Array.isArray(content))
    return [];
  const out = [];
  for (const block of content) {
    if (block === null || typeof block !== "object")
      continue;
    const b = block;
    const type = b["type"];
    if (type === "text" && typeof b["text"] === "string") {
      out.push(pieceOf(b["text"], role, author));
      continue;
    }
    if (type === "tool_use") {
      const name = b["name"];
      const expansion = typeof name === "string" && RECALL_TOOL_NAME.test(name) ? expansionIdsOf(b["input"]) : undefined;
      out.push({ text: "", source: "tool", ...expansion === undefined ? {} : { expansion } });
    } else if (type === "tool_result") {
      out.push({ text: "", source: "tool" });
    } else if (type === "image") {
      out.push({ text: "", source: "image" });
    } else if (type === "document") {
      out.push({ text: "", source: "file" });
    }
  }
  return out;
}
export const WAKE_HEAD_MAX_BYTES = 256 * 1024;
export const WAKE_HEAD_MAX_LINES = 40;
export const COUNTERPARTS_HOOK_COMMAND = /(adapters[/\\]claude-code[/\\]bin[/\\]hook\.js|claude-code[/\\]bin[/\\]hook\.ts)(?=$|["'\s])|counterparts-hook/;
const WAKE_HEAD_PREFIX = "<!-- counterparts:wake ";
const WAKE_TAIL_PREFIX = "<!-- counterparts:wake/end ";
const WAKE_HEAD_SENTINEL = /^<!-- counterparts:wake [^>\n]*elements=(\d+) bytes=(\d+) -->/;
const WAKE_TAIL_SENTINEL = /^<!-- counterparts:wake\/end [^>\n]*elements=(\d+) bytes=(\d+) -->/;
const SENTINEL_MAX_BYTES = 400;
const ABSENT = {
  present: false,
  elements: null,
  bytes: null,
  matchesExpected: false
};
function sight(prefix, re, text, expected) {
  let first = null;
  let from = text.indexOf(prefix);
  while (from !== -1) {
    const end = Math.min(text.length, from + SENTINEL_MAX_BYTES);
    const m = re.exec(text.slice(from, end));
    if (m !== null) {
      const matchesExpected = expected !== null && m[0] === expected;
      const seen = {
        present: true,
        elements: Number(m[1]),
        bytes: Number(m[2]),
        matchesExpected
      };
      if (matchesExpected)
        return seen;
      if (first === null)
        first = seen;
    }
    from = text.indexOf(prefix, from + 1);
  }
  return first ?? ABSENT;
}
export const NO_ARRIVAL = {
  reason: "not-read",
  found: false,
  head: ABSENT,
  tail: ABSENT,
  headPrinted: ABSENT,
  tailPrinted: ABSENT,
  contentRecorded: false,
  contentBytes: 0,
  stdoutBytes: 0,
  linesRead: 0,
  bytesRead: 0,
  corrupt: 0
};
function readHead(path, maxBytes) {
  let fd;
  try {
    if (!statSync(path).isFile())
      return null;
    fd = openSync(path, FS.O_RDONLY | FS.O_NONBLOCK);
    if (!fstatSync(fd).isFile())
      return null;
    const buf = Buffer.allocUnsafe(maxBytes);
    const read = readSync(fd, buf, 0, maxBytes, 0);
    return { text: buf.toString("utf8", 0, read), bytes: read };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}
export function readWakeArrival(path, opts = {}) {
  if (path === undefined || path.trim().length === 0)
    return { ...NO_ARRIVAL, reason: "absent" };
  if (!existsSync(path))
    return { ...NO_ARRIVAL, reason: "absent" };
  const maxBytes = opts.maxBytes ?? WAKE_HEAD_MAX_BYTES;
  const maxLines = opts.maxLines ?? WAKE_HEAD_MAX_LINES;
  const command = opts.command ?? COUNTERPARTS_HOOK_COMMAND;
  const head = readHead(path, maxBytes);
  if (head === null)
    return { ...NO_ARRIVAL, reason: "unreadable" };
  const lines = head.text.split(`
`);
  if (head.bytes >= maxBytes && lines.length > 1)
    lines.pop();
  let corrupt = 0;
  let linesRead = 0;
  for (const line of lines) {
    if (linesRead >= maxLines)
      break;
    if (line.trim().length === 0)
      continue;
    linesRead += 1;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      corrupt += 1;
      continue;
    }
    if (!isEntry(entry)) {
      corrupt += 1;
      continue;
    }
    if (entry["type"] !== "attachment")
      continue;
    const att = entry["attachment"];
    if (att === null || typeof att !== "object" || Array.isArray(att))
      continue;
    const a = att;
    if (a["type"] !== "hook_success" || a["hookEvent"] !== "SessionStart")
      continue;
    if (typeof a["command"] !== "string" || !command.test(a["command"]))
      continue;
    const contentRecorded = typeof a["content"] === "string";
    const content = contentRecorded ? a["content"] : "";
    const stdout = typeof a["stdout"] === "string" ? a["stdout"] : "";
    const expect = opts.expect ?? null;
    return {
      reason: "read",
      found: true,
      head: sight(WAKE_HEAD_PREFIX, WAKE_HEAD_SENTINEL, content, null),
      tail: sight(WAKE_TAIL_PREFIX, WAKE_TAIL_SENTINEL, content, expect),
      headPrinted: sight(WAKE_HEAD_PREFIX, WAKE_HEAD_SENTINEL, stdout, null),
      tailPrinted: sight(WAKE_TAIL_PREFIX, WAKE_TAIL_SENTINEL, stdout, expect),
      contentRecorded,
      contentBytes: Buffer.byteLength(content, "utf8"),
      stdoutBytes: Buffer.byteLength(stdout, "utf8"),
      linesRead,
      bytesRead: head.bytes,
      corrupt
    };
  }
  return { ...NO_ARRIVAL, reason: "read", linesRead, bytesRead: head.bytes, corrupt };
}
export const COUNTERPARTS_TOOL = /^mcp__counterparts__/;
export const SPILL_MAX_BYTES = 64 * 1024 * 1024;
const PERSISTED = /^<persisted-output>[ \t]*\r?\n(?:Output too large \(([^)\n]{1,40})\)\. Full output saved to: |Output exceeded the [^\n]{1,40} persist limit; only the first )/;
const UNSAVED = /^<truncated-output>[ \t]*\r?\nOutput too large \(([^)\n]{1,40})\)\. It could not be saved, so only the first /;
const TOKENS = /^Error: result \((\d[\d.,'   ]{0,19} characters)[^)\n]{0,80}\) exceeds maximum allowed tokens\. (?:Output has been saved to |Failed to save output to file: )/;
const TOKEN_CUT = /\n[ \t]*\[OUTPUT TRUNCATED - exceeded \d{1,9} token limit\][ \t]*\r?\n\s*The tool output was truncated\.[^\n]{0,400}$/;
const TOKEN_CUT_TAIL = 800;
export function spillOf(content) {
  const texts = typeof content === "string" ? [content] : Array.isArray(content) ? content.flatMap((b) => isEntry(b) && b["type"] === "text" && typeof b["text"] === "string" ? [b["text"]] : []) : [];
  const first = texts[0];
  const last = texts[texts.length - 1];
  if (first === undefined || last === undefined)
    return null;
  const head = first.trimStart();
  let m = PERSISTED.exec(head);
  if (m !== null)
    return { shape: "persisted", said: m[1] ?? null };
  m = UNSAVED.exec(head);
  if (m !== null)
    return { shape: "unsaved", said: m[1] ?? null };
  m = TOKENS.exec(head);
  if (m !== null)
    return { shape: "tokens", said: m[1] ?? null };
  if (TOKEN_CUT.test(last.slice(-TOKEN_CUT_TAIL)))
    return { shape: "token-cut", said: null };
  return null;
}
export function parseToolSpills(raw, opts = {}) {
  const ours = opts.tool ?? COUNTERPARTS_TOOL;
  const calls = new Map;
  const answered = new Set;
  const cutIds = new Set;
  const spills = [];
  let corrupt = 0;
  const judge = (id, content, budget) => {
    const call = calls.get(id);
    if (call === undefined)
      return;
    answered.add(id);
    if (cutIds.has(id))
      return;
    const cut = spillOf(content);
    if (cut === null)
      return;
    cutIds.add(id);
    spills.push({ tool: call.tool, phase: call.phase, shape: budget ? "turn-budget" : cut.shape, said: cut.said, part: call.part, dream: call.dream });
  };
  for (const line of raw.split(`
`)) {
    if (line.trim().length === 0)
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      corrupt += 1;
      continue;
    }
    if (!isEntry(entry)) {
      corrupt += 1;
      continue;
    }
    if (entry["type"] === "content-replacement") {
      const swaps = entry["replacements"];
      for (const r of Array.isArray(swaps) ? swaps : []) {
        if (isEntry(r) && r["kind"] === "tool-result" && typeof r["toolUseId"] === "string")
          judge(r["toolUseId"], r["replacement"], true);
      }
      continue;
    }
    const message = entry["message"];
    const content = isEntry(message) ? message["content"] : undefined;
    if (!Array.isArray(content))
      continue;
    for (const block of content) {
      if (!isEntry(block))
        continue;
      const id = block["id"];
      const name = block["name"];
      if (block["type"] === "tool_use" && typeof id === "string" && typeof name === "string" && ours.test(name)) {
        const input = block["input"];
        const arg = (k) => isEntry(input) ? input[k] : undefined;
        const part = arg("part");
        const dream = arg("dream");
        calls.set(id, {
          tool: name,
          phase: typeof arg("phase") === "string" ? arg("phase") : null,
          part: typeof part === "number" && Number.isInteger(part) ? part : typeof part === "string" && /^\d+$/.test(part) ? Number(part) : null,
          dream: typeof dream === "string" ? dream : null
        });
        continue;
      }
      const answers = block["tool_use_id"];
      if (block["type"] !== "tool_result" || typeof answers !== "string")
        continue;
      judge(answers, block["content"], false);
    }
  }
  const whole = [];
  for (const id of answered) {
    if (cutIds.has(id))
      continue;
    const call = calls.get(id);
    if (call !== undefined)
      whole.push({ tool: call.tool, phase: call.phase, part: call.part, dream: call.dream });
  }
  return { results: answered.size, spills, whole, corrupt };
}
