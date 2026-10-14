import { StoreError } from "./errors.js";
import { assertIdWellFormed, assertJsonSafe } from "./prose.js";
const FENCE = "---";
const PAYLOAD_KEY = "payload";
function toPayload(doc) {
  const p = {
    id: doc.id,
    type: doc.type,
    learnedOn: doc.learnedOn,
    bornDay: doc.bornDay,
    meta: doc.meta
  };
  if (doc.title !== undefined)
    p.title = doc.title;
  if (doc.happenedOn !== undefined)
    p.happenedOn = doc.happenedOn;
  if (doc.eventDate !== undefined)
    p.eventDate = doc.eventDate;
  return p;
}
function humanLines(p) {
  const lines = [`id: ${p.id}`, `type: ${p.type}`];
  if (p.title !== undefined)
    lines.push(`title: ${oneLine(p.title)}`);
  if (p.happenedOn !== undefined)
    lines.push(`happened: ${p.happenedOn}`);
  if (p.eventDate !== undefined)
    lines.push(`date: ${p.eventDate}`);
  lines.push(`learned: ${p.learnedOn}`, `bornDay: ${p.bornDay}`);
  return lines;
}
function oneLine(s) {
  return s.replace(/\r?\n/g, " ");
}
export function renderMarkdown(doc) {
  if (typeof doc.body !== "string") {
    throw new StoreError("PROSE_BODY_INVALID", { id: doc.id, reason: "body-not-string" });
  }
  assertIdWellFormed(doc.id);
  const payload = toPayload(doc);
  let json;
  try {
    json = JSON.stringify(payload);
  } catch (cause) {
    throw new StoreError("PROSE_META_UNSERIALIZABLE", {
      id: doc.id,
      reason: String(cause.message ?? cause)
    });
  }
  if (json === undefined || /[\r\n]/.test(json)) {
    throw new StoreError("PROSE_META_UNSERIALIZABLE", { id: doc.id, reason: "payload-not-one-line" });
  }
  assertJsonSafe(payload.meta, doc.id, "meta");
  const lines = [...humanLines(payload), `${PAYLOAD_KEY}: ${json}`];
  return `${FENCE}
${lines.join(`
`)}
${FENCE}
${doc.body}`;
}
