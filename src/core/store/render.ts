/**
 * Markdown, one direction only — the EXPORT format.
 *
 * This was `prose.ts#serializeProse`, one half of a round trip: the store wrote
 * a file and parsed it back, and the frontmatter's `payload:` line existed so
 * that a lossy YAML reading could never become the truth. Since the floor
 * (schema v6) the row is the truth and **nothing parses this back**. It is what
 * `counterparts export --markdown` writes, and what the journal's file copy
 * writes (F6/F7) — a copy for the owner and for whatever outlives this program,
 * which is exactly the argument that earned the journal its files
 * (owner, 2026-09-17 §15 item 9: "the self is being recovered from v1 right now
 * because its pages and journal were plain files that outlived their system").
 *
 * The shape is kept byte-for-byte rather than simplified, on purpose. Every
 * `.md` the owner's v2 store ever wrote is in this format, the `payload:` line
 * is what makes such a file re-readable by a future importer without guessing,
 * and G8's omitted-when-absent (a field never used emits no line at all) is a
 * property of the format, not of the writer that is gone.
 */
import { StoreError } from "./errors.js";
import { assertIdWellFormed, assertJsonSafe } from "./prose.js";
import type { ProseDoc, ProseType } from "./prose.js";

const FENCE = "---";
const PAYLOAD_KEY = "payload";

interface Payload {
  id: string;
  type: ProseType;
  title?: string;
  happenedOn?: string;
  eventDate?: string;
  learnedOn: string;
  bornDay: number;
  meta: Record<string, unknown>;
}

function toPayload(doc: ProseDoc): Payload {
  const p: Payload = {
    id: doc.id,
    type: doc.type,
    learnedOn: doc.learnedOn,
    bornDay: doc.bornDay,
    meta: doc.meta,
  };
  if (doc.title !== undefined) p.title = doc.title;
  if (doc.happenedOn !== undefined) p.happenedOn = doc.happenedOn;
  if (doc.eventDate !== undefined) p.eventDate = doc.eventDate;
  return p;
}

/** One human line per present field. Newlines are impossible here: values are scalars. */
function humanLines(p: Payload): string[] {
  const lines = [`id: ${p.id}`, `type: ${p.type}`];
  if (p.title !== undefined) lines.push(`title: ${oneLine(p.title)}`);
  if (p.happenedOn !== undefined) lines.push(`happened: ${p.happenedOn}`);
  if (p.eventDate !== undefined) lines.push(`date: ${p.eventDate}`);
  lines.push(`learned: ${p.learnedOn}`, `bornDay: ${p.bornDay}`);
  return lines;
}

function oneLine(s: string): string {
  return s.replace(/\r?\n/g, " ");
}

/** One memory as markdown: human-legible frontmatter, one machine payload line, the body below the fence. */
export function renderMarkdown(doc: ProseDoc): string {
  if (typeof doc.body !== "string") {
    throw new StoreError("PROSE_BODY_INVALID", { id: doc.id, reason: "body-not-string" });
  }
  assertIdWellFormed(doc.id);
  const payload = toPayload(doc);
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch (cause) {
    throw new StoreError("PROSE_META_UNSERIALIZABLE", {
      id: doc.id,
      reason: String((cause as Error).message ?? cause),
    });
  }
  if (json === undefined || /[\r\n]/.test(json)) {
    // JSON.stringify escapes newlines; a raw one here would mean the payload could
    // not be read back as a single line. Reject loudly, never truncate (G7).
    throw new StoreError("PROSE_META_UNSERIALIZABLE", { id: doc.id, reason: "payload-not-one-line" });
  }
  assertJsonSafe(payload.meta, doc.id, "meta");
  const lines = [...humanLines(payload), `${PAYLOAD_KEY}: ${json}`];
  return `${FENCE}\n${lines.join("\n")}\n${FENCE}\n${doc.body}`;
}
