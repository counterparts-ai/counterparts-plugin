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
  "December"
];
const MONTH_ALT = MONTHS.flatMap((m) => [m, m.slice(0, 3)]).join("|");
const SCAN = new RegExp([
  `(?<dq>"[^"\\n]{1,300}")`,
  `(?<cq>“[^”\\n]{1,300}”)`,
  `(?<sq>(?<![\\p{L}\\p{N}])'[^'\\n]{1,300}'(?![\\p{L}\\p{N}]))`,
  `(?<iso>\\b\\d{4}-\\d{2}-\\d{2}\\b)`,
  `(?<md>\\b(?:${MONTH_ALT})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*\\d{4})?(?![\\p{L}\\p{N}]))`,
  `(?<my>\\b(?:${MONTH_ALT})\\.?\\s+(?:19|20)\\d{2}\\b)`,
  `(?<yr>\\b(?:19|20)\\d{2}\\b)`
].join("|"), "gu");
function monthName(index) {
  return MONTHS[index] ?? "";
}
function bandFor(day) {
  if (day <= 10)
    return TUNABLES.HEDGE_EARLY;
  if (day <= 20)
    return TUNABLES.HEDGE_MID;
  return TUNABLES.HEDGE_LATE;
}
function hedgeIso(iso) {
  const parts = iso.split("-");
  const year = parts[0] ?? "";
  const month = Number(parts[1] ?? "0");
  const day = Number(parts[2] ?? "0");
  const name = monthName(month - 1);
  if (name === "" || !Number.isFinite(day))
    return TUNABLES.HEDGE_YEAR(year);
  return `${bandFor(day)(name)} ${year}`;
}
function hedgeMonthDay(text) {
  const m = /^([A-Za-z]+)\.?\s+(\d{1,2})/.exec(text);
  const rawMonth = m?.[1] ?? "";
  const day = Number(m?.[2] ?? "0");
  const full = MONTHS.find((x) => x.toLowerCase().startsWith(rawMonth.toLowerCase()));
  if (full === undefined)
    return text;
  const year = /,\s*(\d{4})/.exec(text)?.[1];
  const hedged = bandFor(day)(full);
  return year === undefined ? hedged : `${hedged} ${year}`;
}
export function hedgePrecision(content, source) {
  const counts = new Map;
  const bump = (kind) => counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const re = new RegExp(SCAN.source, SCAN.flags);
  let out = "";
  let last = 0;
  let m;
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
    text: redactSecrets(out),
    hedges,
    fired: hedges.length > 0
  };
}
