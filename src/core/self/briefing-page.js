import { byteLength } from "./identity.js";
import { HANDOFF_RESERVE_MAX_BYTES, HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE } from "../handoff/index.js";
import { PREFACE_RESERVE_BYTES, groupDigits } from "./briefing-delivery.js";
export const PAGE_RUNGS = ["whole", "short", "outline", "headings", "line"];
export function pageDateline(revisedOn, stale, staleDays) {
  const on = revisedOn.trim();
  if (on === "" || !/^\d{4}-\d{2}-\d{2}$/.test(on) || !Number.isFinite(Date.parse(`${on}T00:00:00Z`))) {
    return "(Last revised — the page carries no readable date.)";
  }
  return stale ? `(Last revised ${on} — more than ${staleDays} days before this wake was composed.)` : `(Last revised ${on}.)`;
}
export const PAGE_FLOOR_RESERVE_BYTES = 512;
export const DELIVERY_SHARED_RESERVES = 2;
export function deliveryReserveBound(budgetBytes) {
  const share = Math.max(0, Math.min(HANDOFF_RESERVE_MAX_BYTES, Math.floor(budgetBytes / HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE)));
  return PREFACE_RESERVE_BYTES + DELIVERY_SHARED_RESERVES * share;
}
export const PAGE_END_LINES = {
  whole: "(End of my page.)",
  short: "(End of the short version.)",
  outline: "(End of the outline.)",
  headings: "(End of the headings.)"
};
export function pageEndLine(rung) {
  return rung === "line" ? null : PAGE_END_LINES[rung];
}
const PAGE_DOORS = "the self_page tool or 'counterparts self-page'";
export function pageTopLine(rung, wholeBytes) {
  const n = groupDigits(wholeBytes);
  const end = pageEndLine(rung);
  if (end === null)
    return null;
  const ends = `It ends with "${end}" — if you don't see that line, it was cut off`;
  switch (rung) {
    case "whole":
      return `(My page, ${n} bytes. ${ends}: read it whole with ${PAGE_DOORS}.)`;
    case "short":
      return `(The short version of my ${n}-byte page, too long for this wake. ${ends}. Read the whole page with ${PAGE_DOORS}.)`;
    case "outline":
      return `(My page is ${n} bytes, too long for this wake: here is each section's heading and first sentence. ${ends}. Read the whole page with ${PAGE_DOORS}.)`;
    case "headings":
      return `(My page is ${n} bytes, too long for this wake: here are its section headings. ${ends}. Read the whole page with ${PAGE_DOORS}.)`;
    case "line":
      return null;
  }
}
const PAGE_TOP_READERS = [
  ["whole", /^\(My page, ([\d,]+) bytes\. It ends with "/],
  ["short", /^\(The short version of my ([\d,]+)-byte page, too long for this wake\./],
  ["outline", /^\(My page is ([\d,]+) bytes, too long for this wake: here is each section's heading and first sentence\./],
  ["headings", /^\(My page is ([\d,]+) bytes, too long for this wake: here are its section headings\./],
  ["line", /^\(My page is (\d+) bytes — no room for it (?:whole )?in this wake\./]
];
export function readPageTopLine(text) {
  for (const line of text.split(`
`)) {
    for (const [rung, re] of PAGE_TOP_READERS) {
      const m = re.exec(line);
      if (m !== null)
        return { rung, wholeBytes: Number((m[1] ?? "0").replace(/,/g, "")) };
    }
  }
  return null;
}
export function isPageFrameLine(line) {
  const t = line.trim();
  if (!t.startsWith("(") || !t.endsWith(")"))
    return false;
  if (Object.values(PAGE_END_LINES).includes(t))
    return true;
  return PAGE_TOP_READERS.some(([, re]) => re.test(t));
}
export function pageBlockBytes(block) {
  return byteLength(block.text) + (block.top === null ? 0 : byteLength(block.top) + 1) + (block.end === null ? 0 : byteLength(block.end) + 1);
}
export const PAGE_FRAME_RESERVE_BYTES = 264;
export function pageRoomBytes(hostBudgetBytes) {
  return hostBudgetBytes - deliveryReserveBound(hostBudgetBytes) - PAGE_FLOOR_RESERVE_BYTES - PAGE_FRAME_RESERVE_BYTES;
}
export const PAGE_HOST_BUDGET_BYTES = 9000;
export const PAGE_ROOM_BYTES = pageRoomBytes(PAGE_HOST_BUDGET_BYTES);
export function pageTooLargeLine(bytes) {
  return `(My page is ${bytes} bytes — no room for it whole in this wake. Read it with the self_page tool, or 'counterparts self-page'.)`;
}
