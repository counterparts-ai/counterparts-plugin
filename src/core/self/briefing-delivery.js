import { byteLength } from "./identity.js";
import { addDays, isDay } from "../time.js";
import { DUE_PAST_WORD, DUE_WORD, FRAMING, LEGACY_FRAMING, fixedPointTotal } from "./briefing.js";
const SENTINEL_RE = /^<!-- counterparts:wake\/end .*elements=(\d+) bytes=(\d+) -->$/;
export function readSentinel(text) {
  const actualBytes = byteLength(text);
  const lines = text.split(`
`);
  const line = lines[lines.length - 1] ?? "";
  const m = SENTINEL_RE.exec(line);
  if (m === null) {
    return {
      present: false,
      line: null,
      statedBytes: null,
      statedElements: null,
      actualBytes,
      intact: false
    };
  }
  const statedElements = Number(m[1]);
  const statedBytes = Number(m[2]);
  return {
    present: true,
    line,
    statedBytes,
    statedElements,
    actualBytes,
    intact: statedBytes === actualBytes
  };
}
export const WAKE_SYSTEM = "Counterparts";
export const WAKE_WHOLE_SENTENCE = "If a note says this was too large and saved to a file, read that file: it holds all of this, down to the counterparts:wake/end line.";
export const PREFACE_RESERVE_BYTES = 160 + new TextEncoder().encode(` ${WAKE_WHOLE_SENTENCE}`).length;
export function groupDigits(n) {
  const s = String(Math.trunc(Math.abs(n)));
  let out = "";
  for (let i = 0;i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0)
      out += ",";
    out += s[i];
  }
  return n < 0 ? `-${out}` : out;
}
export function prefaceLine(f) {
  const when = f.date === undefined ? `day ${f.day}` : `day ${f.day} (${f.date})`;
  return `${f.system} memory, ${when}, ${groupDigits(f.memories)} memories of ` + `${groupDigits(f.liveRows)} live rows — ${f.assembled === true ? "assembled at session start" : "composed at the last boundary"}. ${WAKE_WHOLE_SENTENCE}`;
}
export function arrivingTense(text, today, room) {
  if (!isDay(today) || room <= 0)
    return text;
  const lines = text.split(`
`);
  const start = Math.max(lines.lastIndexOf(FRAMING.horizon), lines.lastIndexOf(LEGACY_FRAMING.horizon));
  if (start < 0)
    return text;
  const prior = addDays(today, -1);
  const shape = /^(- (?:(?:by )?\d{4}-\d{2}-\d{2} \()?)(was )?due (\d{4}-\d{2}-\d{2})(?=[,)]| · )/;
  const was = `${DUE_PAST_WORD} `;
  const words = { was: byteLength(was) - byteLength(`${DUE_WORD} `), yesterday: byteLength("yesterday, ") };
  const past = [];
  for (let i = start + 1;i < lines.length && lines[i] !== ""; i++) {
    const line = lines[i] ?? "";
    const m = shape.exec(line);
    const date = m?.[3];
    if (m === null || date === undefined || date >= today)
      continue;
    const already = m[2] !== undefined;
    past.push({ i, head: m[1] ?? "- ", already, date, rest: line.slice(m[0].length), was: already, yesterday: false });
  }
  let left = room;
  for (const p of past) {
    if (p.was || left < words.was)
      continue;
    p.was = true;
    left -= words.was;
  }
  for (const p of past) {
    if (!p.was || p.date !== prior || left < words.yesterday)
      continue;
    p.yesterday = true;
    left -= words.yesterday;
  }
  for (const p of past) {
    if (!p.was || p.already && !p.yesterday)
      continue;
    lines[p.i] = `${p.head}${was}${p.yesterday ? "yesterday, " : ""}${p.date}${p.rest}`;
  }
  return lines.join(`
`);
}
const BYTES_FIELD = /bytes=\d+/;
const OPEN_RE = /^<!-- counterparts:wake .*elements=(\d+) bytes=(\d+) -->$/;
export function applyPreface(text, preface) {
  const lines = text.split(`
`);
  const open = lines[0] ?? "";
  const tail = lines[lines.length - 1] ?? "";
  if (lines.length < 2 || !OPEN_RE.test(open) || !SENTINEL_RE.test(tail)) {
    return {
      text,
      bytes: byteLength(text),
      sentinel: SENTINEL_RE.test(tail) ? tail : null,
      applied: false
    };
  }
  const build = (stated) => [
    open.replace(BYTES_FIELD, `bytes=${stated}`),
    preface,
    ...lines.slice(1, -1),
    tail.replace(BYTES_FIELD, `bytes=${stated}`)
  ];
  const skeleton = byteLength(build("").join(`
`));
  const composed = build(String(fixedPointTotal(skeleton, 2)));
  const out = composed.join(`
`);
  return {
    text: out,
    bytes: byteLength(out),
    sentinel: composed[composed.length - 1] ?? null,
    applied: true
  };
}
export function spliceBeforeSentinel(text, block) {
  const lines = text.split(`
`);
  const open = lines[0] ?? "";
  const tail = lines[lines.length - 1] ?? "";
  if (lines.length < 2 || !OPEN_RE.test(open) || !SENTINEL_RE.test(tail) || block.length === 0) {
    return {
      text,
      bytes: byteLength(text),
      sentinel: SENTINEL_RE.test(tail) ? tail : null,
      applied: false
    };
  }
  const body = lines.slice(1, -1);
  const gap = body[body.length - 1] === "" ? [] : [""];
  const build = (stated) => [
    open.replace(BYTES_FIELD, `bytes=${stated}`),
    ...body,
    ...gap,
    block,
    "",
    tail.replace(BYTES_FIELD, `bytes=${stated}`)
  ];
  const skeleton = byteLength(build("").join(`
`));
  const composed = build(String(fixedPointTotal(skeleton, 2)));
  const out = composed.join(`
`);
  return {
    text: out,
    bytes: byteLength(out),
    sentinel: composed[composed.length - 1] ?? null,
    applied: true
  };
}
