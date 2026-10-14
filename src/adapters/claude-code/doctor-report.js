const RANK = { red: 0, amber: 1, green: 3 };
export function tierOf(f) {
  return f.severity === "amber" && f.optional === true ? 2 : RANK[f.severity];
}
export function worstFirst(findings) {
  return [...findings].map((f, i) => ({ f, i })).sort((a, b) => tierOf(a.f) - tierOf(b.f) || a.i - b.i).map((x) => x.f);
}
export function gradeWord(f) {
  return f.severity === "amber" && f.optional === true ? "OFF" : f.severity.toUpperCase();
}
export function tally(findings) {
  const out = { red: 0, amber: 0, off: 0, green: 0 };
  for (const f of findings)
    out[gradeWord(f).toLowerCase()] += 1;
  return out;
}
export function summaryLine(t) {
  return `${String(t.red)} red, ${String(t.amber)} amber` + (t.off === 0 ? "" : `, ${String(t.off)} off`) + `, ${String(t.green)} green.`;
}
const SEVERITY_COLUMN = 7;
const TITLE_COLUMN = 20;
export function reportLines(findings, today) {
  const ordered = worstFirst(findings);
  const lines = [`counterparts doctor — ${today}`, ""];
  for (const f of ordered)
    lines.push(...findingLines(f));
  lines.push("");
  lines.push(summaryLine(tally(ordered)));
  return lines;
}
export function findingLines(f) {
  const title = f.title.length >= TITLE_COLUMN ? `${f.title} ` : f.title.padEnd(TITLE_COLUMN);
  const head = `${gradeWord(f).padEnd(SEVERITY_COLUMN)}${title}`;
  if (f.optional === true)
    return [`${head}${f.detail}${f.fix.length === 0 ? "" : `  ${f.fix}`}`];
  const out = [`${head}${f.detail}`];
  if (f.fix.length > 0)
    out.push(`${" ".repeat(SEVERITY_COLUMN + TITLE_COLUMN)}fix: ${f.fix}`);
  return out;
}
export function reportJson(findings, today) {
  const ordered = worstFirst(findings);
  const t = tally(ordered);
  return {
    date: today,
    red: t.red,
    amber: t.amber,
    off: t.off,
    green: t.green,
    findings: ordered.map((f) => ({
      key: f.key,
      severity: f.severity,
      ...f.optional === true ? { optional: true } : {},
      title: f.title,
      detail: f.detail,
      fix: f.fix,
      data: f.data
    }))
  };
}
export function anyRed(findings) {
  return findings.some((f) => f.severity === "red");
}
export const NOTICE_TAIL = "run: counterparts doctor";
export const NOTICE_MAX_CHARS = 400;
export function noticeMessage(findings) {
  const reds = worstFirst(findings).filter((f) => f.severity === "red");
  const first = reds[0];
  if (first === undefined)
    return null;
  const more = reds.length === 1 ? "" : ` (+${reds.length - 1} more: ${reds.slice(1).map((f) => f.title).join(", ")})`;
  const fix = first.fix.length === 0 ? "" : ` ${first.fix}`;
  const head = `counterparts: ${first.title} — ${first.detail}.${fix}${more}`;
  const room = NOTICE_MAX_CHARS - NOTICE_TAIL.length - 1;
  const line = head.length <= room ? head : `${head.slice(0, Math.max(0, room - 1))}…`;
  return `${line}
${NOTICE_TAIL}`;
}
