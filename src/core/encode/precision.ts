/**
 * The precision gate — a confabulation brake, not a truth test.
 *
 * Dates, years, and quoted strings that do not occur in the source span are
 * AUTO-HEDGED: softened, never dropped (§3). A specific date the author did not
 * get from anywhere becomes "mid-July"; a quotation the span never contained
 * keeps its words and loses its quote marks, because the words may well be a
 * fair paraphrase and only the *claim of exactness* was invented.
 *
 * Everything runs in ONE pass over the original content, and a hedge's own output
 * is never re-examined: a second pass is how "mid-July 2026" becomes
 * "mid-July around 2026".
 *
 * Ops rule (§3): "a matching key that never persists is exempt from hedging — a
 * name is not a claim." Hedging therefore applies to CONTENT only; handles and
 * aliases are matched, not asserted, so they are exempt here. They are NOT exempt
 * from the secrets gate.
 *
 * CONTRACT §5 G12: the hedge PHRASINGS are preferences (TUNABLES). That hedging
 * happens at all is not.
 */

import { redactSecrets } from "./secrets.js";
import { TUNABLES } from "./tunables.js";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_ALT = MONTHS.flatMap((m) => [m, m.slice(0, 3)]).join("|");

/**
 * Alternation order is load-bearing: a quoted region is consumed WHOLE before
 * anything inside it is considered, and a month+year is consumed before the bare
 * year inside it can be hedged separately.
 */
const SCAN = new RegExp(
  [
    `(?<dq>"[^"\\n]{1,300}")`,
    `(?<cq>“[^”\\n]{1,300}”)`,
    `(?<sq>(?<![\\p{L}\\p{N}])'[^'\\n]{1,300}'(?![\\p{L}\\p{N}]))`,
    `(?<iso>\\b\\d{4}-\\d{2}-\\d{2}\\b)`,
    `(?<md>\\b(?:${MONTH_ALT})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*\\d{4})?(?![\\p{L}\\p{N}]))`,
    `(?<my>\\b(?:${MONTH_ALT})\\.?\\s+(?:19|20)\\d{2}\\b)`,
    `(?<yr>\\b(?:19|20)\\d{2}\\b)`,
  ].join("|"),
  "gu",
);

export interface PrecisionResult {
  text: string;
  /** By kind and count. The hedged text itself is never logged (§5 G10). */
  hedges: { kind: string; count: number }[];
  fired: boolean;
}

function monthName(index: number): string {
  return MONTHS[index] ?? "";
}

function bandFor(day: number): (m: string) => string {
  if (day <= 10) return TUNABLES.HEDGE_EARLY;
  if (day <= 20) return TUNABLES.HEDGE_MID;
  return TUNABLES.HEDGE_LATE;
}

function hedgeIso(iso: string): string {
  const parts = iso.split("-");
  const year = parts[0] ?? "";
  const month = Number(parts[1] ?? "0");
  const day = Number(parts[2] ?? "0");
  const name = monthName(month - 1);
  if (name === "" || !Number.isFinite(day)) return TUNABLES.HEDGE_YEAR(year);
  return `${bandFor(day)(name)} ${year}`;
}

function hedgeMonthDay(text: string): string {
  const m = /^([A-Za-z]+)\.?\s+(\d{1,2})/.exec(text);
  const rawMonth = m?.[1] ?? "";
  const day = Number(m?.[2] ?? "0");
  const full = MONTHS.find((x) => x.toLowerCase().startsWith(rawMonth.toLowerCase()));
  if (full === undefined) return text;
  const year = /,\s*(\d{4})/.exec(text)?.[1];
  const hedged = bandFor(day)(full);
  return year === undefined ? hedged : `${hedged} ${year}`;
}

/**
 * The gate. `source` is the span the proposal was written from; anything present
 * there VERBATIM is left exactly as the author wrote it.
 */
export function hedgePrecision(content: string, source: string): PrecisionResult {
  const counts = new Map<string, number>();
  const bump = (kind: string) => counts.set(kind, (counts.get(kind) ?? 0) + 1);

  const re = new RegExp(SCAN.source, SCAN.flags);
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const whole = m[0];
    const g = m.groups ?? {};
    out += content.slice(last, m.index);
    last = m.index + whole.length;

    const quoted = g["dq"] ?? g["cq"] ?? g["sq"];
    if (quoted !== undefined) {
      const inner = quoted.slice(1, -1);
      if (source.includes(inner)) {
        out += quoted;
      } else {
        // Keeps its words, loses its quote marks: softening, never dropping.
        bump("quote");
        out += inner;
      }
      continue;
    }

    if (source.includes(whole)) {
      out += whole;
      continue;
    }

    if (g["iso"] !== undefined) {
      bump("date");
      out += hedgeIso(whole);
    } else if (g["md"] !== undefined) {
      bump("date");
      out += hedgeMonthDay(whole);
    } else if (g["my"] !== undefined) {
      // Month+year IS the hedge granularity ("mid-July"). Consumed so the bare
      // year inside it cannot be hedged a second time; left unchanged.
      out += whole;
    } else if (g["yr"] !== undefined) {
      bump("year");
      out += TUNABLES.HEDGE_YEAR(whole);
    } else {
      out += whole;
    }
  }
  out += content.slice(last);

  const hedges = [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  return {
    // Universality (scar §7): every text-returning export leaves through the gate,
    // whatever order a caller invoked things in.
    text: redactSecrets(out),
    hedges,
    fired: hedges.length > 0,
  };
}
