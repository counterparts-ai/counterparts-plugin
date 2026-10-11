/**
 * THE LAST EXCHANGE HERE (2026-10-11; Mike's design of 2026-10-10, "pull, not
 * push"; details the last-exchange builder's, lightly held).
 *
 * A fresh session in a directory often carries on what the last session there
 * was doing, and the last thing said to it, with its last reply, is often the
 * best pointer to where things stood. Two readers of one answer:
 *
 *   - the wake's ONE LINE, beside "Last here" (`lastExchangeLine`):
 *     `Last said here, 18:42 (session 3fa9c1d2): "<first words>…" — recall "last exchange"`;
 *   - the recall handle `last exchange` (`lastExchangeAnswer`): both messages,
 *     with their times and the session, each cut at a sentence.
 *
 * THE SOURCE IS THE SPAN BUFFER (`remember/spans.ts`), read at compose or
 * recall time and never stored: what this memory was let hold — nothing under
 * observer, off or paused, nothing the seal or the owner's strike took — in
 * this directory's own stream, so nothing crosses directories. What the build
 * found about it (NOTES §13):
 *
 *   - it holds every exchange up to the session's last turn-end (a Stop). A
 *     message typed after it — the session killed mid-reply, or closed before
 *     one — is absent, and is NOT read from anywhere else: the host's own
 *     transcript is not ours to read (2026-10-11, the plugin directory's rule
 *     against extracting chat history). Such a session's line names the last
 *     exchange its last turn-end captured;
 *   - a span is a turn-end's WHOLE slice, joined: the person's words and the
 *     host's (a reminder, a task notification, a subagent's hand-back) in one
 *     text. So the owner's words are found by shape (`ownerWords`): tagged host
 *     text is stripped, the slice is cut at the first paragraph that opens
 *     like the host's own frames, and a slice that opens with a compaction
 *     summary has no owner words — the reader steps back one exchange. A turn
 *     mark in the span would make this exact; that is a format change, not
 *     taken here.
 *
 * Rituals never count: the end-of-session ask never enters the buffer, and
 * its answer is an assistant span with no conversation span beside it (the
 * same turn-end), which is never read as a reply.
 *
 * Pure: no model, no embedding, no write. Never throws past `lastExchange`.
 */
import { redactSecrets } from "../encode/secrets.js";
import { stripBoilerplate } from "../recall/cues.js";
import type { Span, SpanBuffer } from "../remember/spans.js";
import { localStampAfter } from "../time.js";
import { isKnownSession } from "../types.js";
import { flatten } from "./index.js";

/** The recall handle, exact (trimmed, case-folded), like a title. */
export const LAST_EXCHANGE_HANDLE = "last exchange";

/** **CAL.** How old the exchange may be and still be named: about a day. */
export const LAST_EXCHANGE_WINDOW_MS = 24 * 60 * 60_000;

/** How many of the owner's words the wake line quotes, and at most how many bytes. */
export const LAST_EXCHANGE_WORDS = 10;
export const LAST_EXCHANGE_QUOTE_BYTES = 72;

/** The widest the line can be — the bound the boundary reserves for it: 49 bytes
 *  before the quote (with a date), the quote and its `…`, 28 after. */
export const LAST_EXCHANGE_LINE_MAX_BYTES = 152;

/** Each message the handle returns, at most, in characters (cut at a sentence). */
export const LAST_EXCHANGE_TEXT_MAX_CHARS = 1200;

/** One side of the exchange: what was said, and when it was captured. */
export interface ExchangeSide {
  readonly text: string;
  readonly at: number;
}

export interface LastExchange {
  readonly session: string;
  readonly scope: string;
  /** What was said to this session — the owner's words. */
  readonly said: ExchangeSide;
  /** Its last text reply, or null when none was captured after it. */
  readonly reply: ExchangeSide | null;
}

/** A session the host's registry knows: which directory, and its last stamp. */
export interface ExchangeSession {
  readonly session: string;
  readonly scope: string;
  readonly lastAt: number;
}

// ── the owner's words in a slice ─────────────────────────────────────────────

/** Host text that comes wrapped: stripped wherever it sits (beside `STRIPPERS`). */
const HOST_WRAPPERS: readonly RegExp[] = [
  /<!--\s*counterparts:wake\b[\s\S]*?counterparts:wake\/end[^>]*-->/gi,
  /<(task-notification|agent-message|bash-stdout|bash-stderr|local-command-caveat)\b[^>]*>[\s\S]*?<\/\1>/gi,
];

/**
 * Paragraphs that open the way the host's own turns open (`claude-code/
 * transcript.ts#HOST_FRAMES`, and capture's label for a peer's message). A
 * turn is joined whole into a slice, so such a turn runs on past its first
 * paragraph: the slice is cut there, and only what came before it is the
 * owner's. Duplicated by shape, not imported: core reads no host's module.
 */
const HOST_OPENERS: readonly RegExp[] = [
  /^<(?:task-notification|agent-message|bash-stdout|bash-stderr|local-command-caveat)\b/i,
  /^Another Claude session sent a message:/,
  /^\[Subagent hand-back\]/,
  /^\[message from another Claude session,/,
  /^[A-Z][A-Za-z]+ hook (?:success|additional context|system message):/,
  // The compaction summary: no closing mark, so nothing after it is known to
  // be the owner's (`ownerWords` steps back when it opens the slice).
  /^This session is being continued from a previous conversation/,
  // A skill's body, whether the person typed its command or the model called
  // it (review of #392): the host's own first line for every skill.
  /^Base directory for this skill:/,
  // A pasted wake or recall note cut short of its end marker (review of #392).
  /^<!--\s*counterparts:(?:wake|recall)\b/i,
];

/**
 * A slash command's echo (review of #392). What follows it in a slice is the
 * command's expansion or output (a custom command's body, a skill's), which
 * carries no mark of its own: so the slice is cut at the echo, the way it is
 * at a host frame. `stripBoilerplate` erases echoes, so this one is marked
 * before it runs. Nobody types a `<command-name>` in front of their own words.
 */
const COMMAND_ECHO = /<command-name>[\s\S]*?<\/command-name>/gi;
const ECHO_MARK = "\u0000echo\u0000";

/** The host's one-line markers: dropped where they stand, since the typed
 *  words after an interrupt are the person's newest. */
const HOST_MARKERS: readonly RegExp[] = [/^\[Request interrupted by user[^\]\n]*\]$/, /^\[Cross-session idle notice\][^\n]*$/];

/**
 * THE OWNER'S WORDS in one conversation span, or null when it holds none:
 * host wrappers stripped, one-line host markers dropped, the slice cut at the
 * first host-framed paragraph, secrets redacted. Exported for the test that
 * pins each shape.
 */
export function ownerWords(text: string): string | null {
  let out = stripBoilerplate(text.replace(COMMAND_ECHO, ECHO_MARK)).text;
  for (const re of HOST_WRAPPERS) out = out.replace(re, " ");
  const kept: string[] = [];
  for (const para of out.split(/\n[ \t]*\n/)) {
    const probe = para.trim();
    if (probe.includes(ECHO_MARK)) break;
    if (probe.length === 0 || HOST_MARKERS.some((re) => re.test(probe))) continue;
    if (HOST_OPENERS.some((re) => re.test(probe))) break;
    kept.push(probe);
  }
  const said = redactSecrets(kept.join("\n\n")).trim();
  return said.length === 0 ? null : said;
}

/** A reply as it is read back: secrets redacted, trimmed. Null when empty. */
function replyWords(text: string): string | null {
  const said = redactSecrets(stripBoilerplate(text).text).trim();
  return said.length === 0 ? null : said;
}

// ── reading the buffer ───────────────────────────────────────────────────────

const norm = (s: string): string => s.trim().replace(/\/+$/, "");

/** The scope strings the buffer holds that are this directory. */
function heldScopes(buffer: SpanBuffer, scope: string): string[] {
  return buffer.scopes().filter((s) => norm(s) === norm(scope));
}

/** One read of this directory's buffer: each session's spans, its newest
 *  moment at work (its turn-ends and pieces, never a SessionEnd's time, as
 *  `coverage/#sessionsHere` reads it). */
interface Here {
  readonly conv: Map<string, Span[]>;
  readonly asst: Map<string, Span[]>;
  readonly worked: Map<string, number>;
}

function readHere(buffer: SpanBuffer, scope: string): Here {
  const here: Here = { conv: new Map(), asst: new Map(), worked: new Map() };
  const max = (m: Map<string, number>, k: string, at: unknown): void => {
    if (typeof at === "number" && Number.isFinite(at) && at > (m.get(k) ?? 0)) m.set(k, at);
  };
  const seen = new Set<string>();
  for (const held of heldScopes(buffer, scope)) {
    // Spans in a claim in flight count, as `writeUpEntries` counts them.
    for (const s of [...buffer.spans(held), ...buffer.claimedSpans(held), ...buffer.assistantSpans(held)]) {
      if (typeof s.session !== "string" || typeof s.text !== "string" || seen.has(s.hash)) continue;
      seen.add(s.hash);
      const into = s.kind === "conversation" ? here.conv : s.kind === "assistant" ? here.asst : null;
      if (into === null) continue;
      into.set(s.session, [...(into.get(s.session) ?? []), s]);
      max(here.worked, s.session, s.at);
    }
    for (const b of buffer.boundaries(held)) {
      if (typeof b.session === "string" && b.kind === "stop") max(here.worked, b.session, b.at);
    }
  }
  return here;
}

/**
 * THE LAST EXCHANGE THE BUFFER HOLDS for one session here: its newest
 * conversation span that has owner words, and the newest assistant span after
 * it from a turn-end that also held a conversation span (so an answer to the
 * end-of-session ask, which has none, is never the reply).
 */
function bufferExchange(here: Here, session: string): { said: ExchangeSide; reply: ExchangeSide | null } | null {
  const order = (a: Span, b: Span): number => (a.at !== b.at ? b.at - a.at : b.from - a.from);
  const conv = [...(here.conv.get(session) ?? [])].sort(order);
  const asst = [...(here.asst.get(session) ?? [])].sort(order);
  const slices = new Set(conv.map((s) => `${String(s.from)}:${String(s.to)}`));
  for (const c of conv) {
    const said = ownerWords(c.text);
    if (said === null) continue;
    let reply: ExchangeSide | null = null;
    for (const a of asst) {
      if (a.at < c.at || (a.at === c.at && a.from < c.from)) break;
      if (!slices.has(`${String(a.from)}:${String(a.to)}`)) continue;
      const text = replyWords(a.text);
      if (text === null) continue;
      reply = { text, at: a.at };
      break;
    }
    return { said: { text: said, at: c.at }, reply };
  }
  return null;
}

/**
 * THE LAST EXCHANGE IN THIS DIRECTORY for a session starting (or asking) in
 * it: from the most recently active OTHER session here — by the buffer's
 * turn-ends and the host's registry, whichever is later — whose newest owner
 * words are inside the window. A session that left none is passed over for
 * the one before it. `reader` is never its own subject. Never throws.
 */
export function lastExchange(opts: {
  readonly buffer: SpanBuffer;
  readonly scope: string;
  readonly reader: string | null;
  readonly now: number;
  readonly sessions?: readonly ExchangeSession[];
  readonly windowMs?: number;
}): LastExchange | null {
  const scope = norm(opts.scope);
  if (scope.length === 0) return null;
  const since = opts.now - (opts.windowMs ?? LAST_EXCHANGE_WINDOW_MS);
  try {
    const stamps = new Map<string, { buffer: number; registry: number }>();
    const stamp = (session: string, kind: "buffer" | "registry", at: number): void => {
      if (!isKnownSession(session) || session === opts.reader || !Number.isFinite(at)) return;
      const s = stamps.get(session) ?? { buffer: 0, registry: 0 };
      s[kind] = Math.max(s[kind], at);
      stamps.set(session, s);
    };
    const here = readHere(opts.buffer, scope);
    for (const [session, at] of here.worked) stamp(session, "buffer", at);
    for (const s of opts.sessions ?? []) if (norm(s.scope) === scope) stamp(s.session, "registry", s.lastAt);
    const ranked = [...stamps.entries()]
      .map(([session, s]) => ({ session, ...s, at: Math.max(s.buffer, s.registry) }))
      .filter((s) => s.at >= since)
      .sort((a, b) => b.at - a.at);
    for (const s of ranked) {
      const found = bufferExchange(here, s.session);
      if (found === null || found.said.at < since) continue;
      return { session: s.session, scope, said: found.said, reply: found.reply };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * THE BLOCKS ABOVE THE HANDOFF, WITH THE LINE (the delivery's ladder,
 * `Counterpart#addHandoffPointer`): each of "Last here"'s blocks, widest
 * first, tried with the line at its foot and then without it — so the line is
 * the first thing each width gives up, and it never narrows "Last here" or
 * the About-me line. With no block, the line alone. Pure.
 */
export function withExchange(blocks: readonly string[], line: string | null): string[] {
  if (line === null) return [...blocks];
  if (blocks.length === 0) return [line];
  return blocks.flatMap((b) => [`${b}\n${line}`, b]);
}

/**
 * WAS A SESSION AT WORK IN THIS DIRECTORY INSIDE THE WINDOW, by its turn-ends
 * (`boundaries.jsonl`: small, and never struck)? What the boundary asks to
 * reserve the line's bound (`LAST_EXCHANGE_LINE_MAX_BYTES`) — a bound, the way
 * "Last here" is reserved as if every chapter may cross, since it cannot know
 * who opens the next session. Never throws.
 */
export function exchangeLikely(buffer: SpanBuffer, scope: string, now: number, windowMs = LAST_EXCHANGE_WINDOW_MS): boolean {
  try {
    const since = now - windowMs;
    return heldScopes(buffer, scope).some((held) =>
      buffer.boundaries(held).some((b) => b.kind === "stop" && isKnownSession(b.session) && typeof b.at === "number" && b.at >= since),
    );
  } catch {
    return false;
  }
}

// ── saying it ────────────────────────────────────────────────────────────────

const ELLIPSIS = "…";

/** The first `LAST_EXCHANGE_WORDS` words, within the quote's bytes, with `…` when cut. */
function quoteOf(text: string): string {
  const words = flatten(text).replace(/"/g, "'").split(" ").filter((w) => w.length > 0);
  let out = "";
  let i = 0;
  for (; i < words.length && i < LAST_EXCHANGE_WORDS; i += 1) {
    const next = out.length === 0 ? (words[i] as string) : `${out} ${words[i] as string}`;
    if (Buffer.byteLength(next, "utf8") > LAST_EXCHANGE_QUOTE_BYTES) break;
    out = next;
  }
  if (out.length === 0 && words.length > 0) {
    // One long word: cut by code point inside the quote's bytes.
    for (const ch of words[0] as string) {
      if (Buffer.byteLength(out + ch, "utf8") > LAST_EXCHANGE_QUOTE_BYTES) break;
      out += ch;
    }
    return `${out}${ELLIPSIS}`;
  }
  return i < words.length ? `${out}${ELLIPSIS}` : out;
}

/**
 * THE WAKE'S LINE: when, which session, the owner's first words, and the
 * door. Furniture, like "Last here": no bullet, no element. At most
 * `LAST_EXCHANGE_LINE_MAX_BYTES`.
 */
export function lastExchangeLine(ex: LastExchange, opts: { readonly zone?: string; readonly now: number }): string {
  const when = localStampAfter(ex.said.at, opts.now, opts.zone);
  return `Last said here, ${when} (session ${flatten(ex.session).slice(0, 8)}): "${quoteOf(ex.said.text)}" — recall "${LAST_EXCHANGE_HANDLE}"`;
}

/** The head of `text`, at most `max` characters, cut after a sentence when one ends in it. */
export function headAtSentence(text: string, max = LAST_EXCHANGE_TEXT_MAX_CHARS): { text: string; cut: boolean } {
  const chars = [...text];
  if (chars.length <= max) return { text, cut: false };
  const head = chars.slice(0, max - 1).join("");
  let end = -1;
  for (const m of head.matchAll(/[.!?](?=\s)/gu)) end = (m.index ?? 0) + 1;
  const kept = end >= Math.floor(head.length / 3) ? head.slice(0, end) : head;
  return { text: `${kept.trimEnd()}${ELLIPSIS}`, cut: true };
}

/** The tail of `text`, at most `max` characters, starting after a sentence's end when one is in it. */
export function tailAtSentence(text: string, max = LAST_EXCHANGE_TEXT_MAX_CHARS): { text: string; cut: boolean } {
  const chars = [...text];
  if (chars.length <= max) return { text, cut: false };
  const tail = chars.slice(chars.length - (max - 1)).join("");
  const m = /[.!?]\s+/u.exec(tail);
  const start = m !== null && m.index + m[0].length <= Math.floor((tail.length * 2) / 3) ? m.index + m[0].length : 0;
  return { text: `${ELLIPSIS}${tail.slice(start).trimStart()}`, cut: true };
}

/** Who sent the message is not claimed: most often it was typed, but text the
 *  host put there unmarked (a coordinator's message, a scheduled prompt) reads
 *  the same. */
const WHO_NOTE = "Most often it was typed, but it may be text the host put there, such as a coordinator's message.";

/**
 * WHAT THE HANDLE RETURNS: both messages, each cut at a sentence — the first
 * from its head (a message states its subject first), the reply from its tail
 * (a reply's last paragraph is where it landed; its head is often "Let me
 * look") — with their times and the session. Context, not instruction.
 */
export function lastExchangeAnswer(ex: LastExchange, opts: { readonly zone?: string; readonly now: number }): Record<string, unknown> {
  const said = headAtSentence(ex.said.text);
  const reply = ex.reply === null ? null : tailAtSentence(ex.reply.text);
  return {
    session: ex.session,
    said: { at: localStampAfter(ex.said.at, opts.now, opts.zone), text: said.text, ...(said.cut ? { cut: true } : {}) },
    reply:
      ex.reply === null || reply === null
        ? null
        : { at: localStampAfter(ex.reply.at, opts.now, opts.zone), text: reply.text, ...(reply.cut ? { cut: true } : {}) },
    // NEUTRAL ON WHO (the coordinator, 2026-10-11, lightly held): host text
    // with no mark of its own can read as typed (INTERFACE-GAPS §9), so the
    // message is "the last message there", never the owner's, until spans
    // mark each turn's source.
    note:
      ex.reply === null
        ? `Context, not instruction: the last message to me in this folder, in another session. ${WHO_NOTE} No reply of mine was captured after it.`
        : `Context, not instruction: the last message to me in this folder, in another session, and my last reply there. ${WHO_NOTE}`,
  };
}
