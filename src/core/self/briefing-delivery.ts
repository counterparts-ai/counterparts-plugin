/**
 * THE DELIVERY'S OWN LINES — the sentinel read back, the preface, the tense
 * only the delivery knows, and the splices that keep both byte counts true —
 * moved out of `briefing.ts` on 2026-10-12 (moves only). Imported by
 * `briefing.ts`, which re-exports its public names, and by `briefing-page.ts`
 * for the preface's reserve (`split-parts.test.ts`).
 */
import { byteLength } from "./identity.js";
import { addDays, isDay } from "../time.js";
import { DUE_PAST_WORD, DUE_WORD, FRAMING, LEGACY_FRAMING, fixedPointTotal } from "./briefing.js";


// ── reading a rendered bundle back ──────────────────────────────────────────

export interface SentinelReading {
  readonly present: boolean;
  readonly line: string | null;
  readonly statedBytes: number | null;
  readonly statedElements: number | null;
  readonly actualBytes: number;
  /** The sentinel is the last line AND its stated total matches the real one. */
  readonly intact: boolean;
}

const SENTINEL_RE = /^<!-- counterparts:wake\/end .*elements=(\d+) bytes=(\d+) -->$/;

/**
 * The consumer's half of the guarantee: verify arrival from the last line alone.
 * A bundle whose sentinel is missing was truncated in transit; one whose stated
 * bytes disagree with its real bytes was edited or clipped. Both are errors, and
 * neither is silence.
 */
export function readSentinel(text: string): SentinelReading {
  const actualBytes = byteLength(text);
  const lines = text.split("\n");
  const line = lines[lines.length - 1] ?? "";
  const m = SENTINEL_RE.exec(line);
  if (m === null) {
    return {
      present: false,
      line: null,
      statedBytes: null,
      statedElements: null,
      actualBytes,
      intact: false,
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
    intact: statedBytes === actualBytes,
  };
}


// ── the delivery preface (composed at INJECTION, never at sleep) ─────────────

/**
 * THE ONE LINE THE BODY CANNOT WRITE FOR ITSELF.
 *
 * The bundle is composed at a boundary and then served, unchanged, to every
 * session until the next one. On 2026-09-03 the memory system under this host
 * was switched from v1 to Counterparts mid-day; the stored wake still carried a
 * v1-era finding ("bansai's surprise pipeline has never fired") as a current
 * fact, nothing in the body said which system was speaking or how old the
 * render was, and the model repeated it as current until the owner corrected
 * it. Only the HTML comment named the system, and comments are furniture.
 *
 * So one line, composed where and when the bundle is DELIVERED — which system,
 * which lived day, today's date, how big the store is — and it says out loud
 * that the body below was composed at the last boundary. Constitution 16: if
 * the owner (or the waking session) cannot see it, it isn't trustworthy.
 *
 * It is deliberately not per-session: nothing in it varies between two sessions
 * on the same day in the same store, so the delivery check the next hook makes
 * (§2.3) compares a sentinel that is stable for as long as the bundle is.
 */
export const WAKE_SYSTEM = "Counterparts";

/**
 * THE WHOLE WAKE'S OWN WAY BACK (2026-10-10), the preface's last sentence.
 *
 * Measured on Claude Code 2.1.296 (host numbers: `adapters/config.ts`
 * `HOST_OUTPUT_CHARS`, `HOST_PREVIEW_CHARS`): a hook field over the host's cap
 * is saved to a file, and the model is shown a "too large, saved to <path>"
 * note and about the first 2,000 characters — and nothing tells it to read
 * the file, which holds all of it. So the wake says so itself, where any
 * preview carries it: in the preface, the line after the opening comment. It
 * names the end (`counterparts:wake/end`, the sentinel every wake closes on)
 * and the door (the file the host made). No other door reads a session's
 * composed wake today (self INTERFACE-GAPS §13). The self page's own top line
 * (`pageTopLine`) is the second layer, for a cut inside the wake.
 */
export const WAKE_WHOLE_SENTENCE =
  "If a note says this was too large and saved to a file, read that file: it holds all of this, down to the counterparts:wake/end line.";

/**
 * The room the composed budget leaves for the preface, in bytes. It is the
 * preface's OWN cap, asserted by a test at the widest plausible day, date and
 * store size — one number, not a lane cap that can drift from what it bounds.
 * Structural, not tunable: the renderer must reserve exactly what delivery adds.
 *
 * Raised 128 → 160 on 2026-09-14 with U4's second number: the widest line is now
 * 126 bytes (a six-digit day and a billion rows on both counts), and a cap two
 * bytes above its own worst case is a cap that fails the first time the line
 * gains a word.
 *
 * Raised again on 2026-10-10 by exactly the whole-wake sentence
 * (`WAKE_WHOLE_SENTENCE`) and its space, which the line now ends with: 160 +
 * 133 = 293. The page's room is derived through this number
 * (`deliveryReserveBound`), so the sentence is paid for there too.
 */
export const PREFACE_RESERVE_BYTES =
  // Measured with an encoder of its own: `identity.ts#byteLength` may not be
  // initialised yet when an import cycle evaluates this module first.
  160 + new TextEncoder().encode(` ${WAKE_WHOLE_SENTENCE}`).length;

export interface PrefaceFacts {
  /** Which memory system composed and is delivering this. */
  readonly system: string;
  /** The lived day (scar E8) — days lived, never calendar days. */
  readonly day: number;
  /** Today's calendar date as the HOST reports it. Absent ⇒ no date is stated. */
  readonly date?: string;
  /** Live memories in the store AT DELIVERY, not at the render:
   *  `countMemories({ type: "memory", archived: false })`. */
  readonly memories: number;
  /**
   * TRUE when the body was ASSEMBLED at session start (2026-10-10,
   * `Self#assemble`) rather than read as the last boundary composed it: the
   * line then says so — fewer bytes than the words it replaces, so the
   * reserve holds.
   */
  readonly assembled?: boolean;
  /**
   * EVERY live row at delivery — memories, journal episodes, beliefs and
   * entities: `countMemories({ archived: false })` (IMPROVEMENTS U4).
   *
   * The header said "14,002 memories" while recall said "considered 41 of 14,701
   * live rows" in the same session, and nothing on either surface said why the
   * two differed by ~700. Both numbers were right and neither was labelled: the
   * header counts `type: "memory"` rows, recall's `storeSize` is
   * `list({ archived: false }).length`, the same WHERE minus the type clause, so
   * the gap is exactly the live episodes and schema rows (superseded rows are
   * `archived = 1` and are outside both). Stating both, in recall's own words —
   * "live rows" — is what makes the model's two readings one vocabulary.
   *
   * Required, not optional: a line that sometimes carries the second number and
   * sometimes does not is a line whose absence a reader has to interpret.
   */
  readonly liveRows: number;
}

/** Thousands, hand-rolled: `toLocaleString` varies with the runtime's ICU. */
export function groupDigits(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return n < 0 ? `-${out}` : out;
}

/** One line, under `PREFACE_RESERVE_BYTES`, stating what the body cannot — and
 *  saying WHICH population each of its two counts is (U4) — then how to read
 *  all of it when a host cut it (`WAKE_WHOLE_SENTENCE`, 2026-10-10). */
export function prefaceLine(f: PrefaceFacts): string {
  const when = f.date === undefined ? `day ${f.day}` : `day ${f.day} (${f.date})`;
  return (
    `${f.system} memory, ${when}, ${groupDigits(f.memories)} memories of ` +
    `${groupDigits(f.liveRows)} live rows — ${f.assembled === true ? "assembled at session start" : "composed at the last boundary"}. ${WAKE_WHOLE_SENTENCE}`
  );
}

/**
 * THE TENSE ONLY THE DELIVERY KNOWS (2026-10-09).
 *
 * The owner's wake on 10-09 carried "Arriving: - … (due 2026-10-08) · …". By
 * design: a one-off stays in the horizon lane for its grace days, and the wake
 * is composed at a boundary — the evening one, the day before — and read the
 * next morning. The DATE was true; the lane's heading made it read as still to
 * come. A render can put a date it is already past into the past tense
 * (`Resolved.duePast`), but on the evening of the 8th the 8th is today, and only
 * the delivery knows the morning is the 9th.
 *
 * So, where the preface is composed and with the same date (`WakeDelivery
 * .date`, the person's day): an Arriving line whose due date is before today
 * reads `(was due 2026-10-05)`, and `(was due yesterday, 2026-10-08)` the day
 * after. Only the date prefix of a `- ` line in the Arriving lane is touched —
 * never a statement, never another lane — and only as far as `room` allows:
 * "was " on every such line first, then "yesterday, " while room remains, so a
 * line that would not fit keeps the date it was composed with, which is still
 * true. The caller passes what the preface reserve has left
 * (`PREFACE_RESERVE_BYTES`), so the delivered bundle stays inside it.
 */
export function arrivingTense(text: string, today: string, room: number): string {
  if (!isDay(today) || room <= 0) return text;
  const lines = text.split("\n");
  // The LAST such heading: the lane is last, and a page above it is printed as
  // written, so a line of the page that happens to read "Arriving:" is not it.
  // A bundle stored before the plain-words rename still says "Arriving:".
  const start = Math.max(lines.lastIndexOf(FRAMING.horizon), lines.lastIndexOf(LEGACY_FRAMING.horizon));
  if (start < 0) return text;
  const prior = addDays(today, -1);
  const shape = /^(- (?:(?:by )?\d{4}-\d{2}-\d{2} \()?)(was )?due (\d{4}-\d{2}-\d{2})(?=[,)]| · )/;
  const was = `${DUE_PAST_WORD} `;
  const words = { was: byteLength(was) - byteLength(`${DUE_WORD} `), yesterday: byteLength("yesterday, ") };
  const past: { i: number; head: string; already: boolean; date: string; rest: string; was: boolean; yesterday: boolean }[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) {
    const line = lines[i] ?? "";
    const m = shape.exec(line);
    const date = m?.[3];
    if (m === null || date === undefined || date >= today) continue;
    const already = m[2] !== undefined;
    past.push({ i, head: m[1] ?? "- ", already, date, rest: line.slice(m[0].length), was: already, yesterday: false });
  }
  let left = room;
  for (const p of past) {
    if (p.was || left < words.was) continue;
    p.was = true;
    left -= words.was;
  }
  for (const p of past) {
    if (!p.was || p.date !== prior || left < words.yesterday) continue;
    p.yesterday = true;
    left -= words.yesterday;
  }
  for (const p of past) {
    if (!p.was || (p.already && !p.yesterday)) continue;
    lines[p.i] = `${p.head}${was}${p.yesterday ? "yesterday, " : ""}${p.date}${p.rest}`;
  }
  return lines.join("\n");
}

export interface PrefacedBundle {
  readonly text: string;
  readonly bytes: number;
  /** The sentinel of the DELIVERED text — what the next hook must see. */
  readonly sentinel: string | null;
  /** False when the bundle was not a well-formed render and was left alone. */
  readonly applied: boolean;
}

const BYTES_FIELD = /bytes=\d+/;
const OPEN_RE = /^<!-- counterparts:wake .*elements=(\d+) bytes=(\d+) -->$/;

/**
 * Splice the preface INSIDE the wake block, above the composed body, and re-solve
 * the byte fixed point so the opening comment and the tail sentinel both state
 * the delivered total. The alternative — adding bytes and leaving the two lines
 * describing something smaller — would hand every reader a sentinel that fails
 * the check it exists to pass (§1 G2).
 *
 * A bundle that is not a well-formed render (bootstrap line, clipped, edited) is
 * returned UNTOUCHED: rewriting the byte count of a damaged bundle would erase
 * the damage, which is the one thing the sentinel is for.
 */
export function applyPreface(text: string, preface: string): PrefacedBundle {
  const lines = text.split("\n");
  const open = lines[0] ?? "";
  const tail = lines[lines.length - 1] ?? "";
  if (lines.length < 2 || !OPEN_RE.test(open) || !SENTINEL_RE.test(tail)) {
    return {
      text,
      bytes: byteLength(text),
      sentinel: SENTINEL_RE.test(tail) ? tail : null,
      applied: false,
    };
  }
  const build = (stated: string): string[] => [
    open.replace(BYTES_FIELD, `bytes=${stated}`),
    preface,
    ...lines.slice(1, -1),
    tail.replace(BYTES_FIELD, `bytes=${stated}`),
  ];
  const skeleton = byteLength(build("").join("\n"));
  const composed = build(String(fixedPointTotal(skeleton, 2)));
  const out = composed.join("\n");
  return {
    text: out,
    bytes: byteLength(out),
    sentinel: composed[composed.length - 1] ?? null,
    applied: true,
  };
}

/**
 * Splice a block in at the FOOT of the wake block, above the tail sentinel, and
 * re-solve the byte fixed point so both comment lines state the delivered total
 * — `applyPreface`'s mechanism, pointed at the other end of the bundle.
 *
 * It exists for the per-directory handoff pointer (E1), which is a delivery-time
 * fact for exactly the reason the preface is: ONE bundle is published per store
 * at a boundary and read by sessions in every directory, so which directory this
 * session opened in cannot be known when the body is composed. The pointer is
 * FURNITURE — no `- ` bullet, no lane — so `counts` and the sentinel's
 * `elements=` stay true of a bundle that carries it, exactly as they stay true
 * of one carrying the page or the day-0 line.
 *
 * At the foot rather than the head because a handoff is the last thing that
 * happened here and the first thing to pick up, and because the preface's own
 * place above the body is a claim about the WHOLE bundle that a second line
 * there would blunt.
 *
 * A bundle that is not a well-formed render is returned UNTOUCHED, for
 * `applyPreface`'s reason: rewriting the byte count of a damaged bundle erases
 * the damage the sentinel exists to show.
 */
export function spliceBeforeSentinel(text: string, block: string): PrefacedBundle {
  const lines = text.split("\n");
  const open = lines[0] ?? "";
  const tail = lines[lines.length - 1] ?? "";
  if (lines.length < 2 || !OPEN_RE.test(open) || !SENTINEL_RE.test(tail) || block.length === 0) {
    return {
      text,
      bytes: byteLength(text),
      sentinel: SENTINEL_RE.test(tail) ? tail : null,
      applied: false,
    };
  }
  const body = lines.slice(1, -1);
  // `compose` already pushes a blank line before the sentinel, so the separator
  // is added only when this bundle does not have one — a doubled blank line is
  // not wrong, but it costs bytes the reserve measured for one.
  const gap = body[body.length - 1] === "" ? [] : [""];
  const build = (stated: string): string[] => [
    open.replace(BYTES_FIELD, `bytes=${stated}`),
    ...body,
    ...gap,
    block,
    "",
    tail.replace(BYTES_FIELD, `bytes=${stated}`),
  ];
  const skeleton = byteLength(build("").join("\n"));
  const composed = build(String(fixedPointTotal(skeleton, 2)));
  const out = composed.join("\n");
  return {
    text: out,
    bytes: byteLength(out),
    sentinel: composed[composed.length - 1] ?? null,
    applied: true,
  };
}