import { visibleWidth } from "./ansi.js";
export const NONE = "(none yet)";
export const NEVER = "(never run)";
export const UNRESOLVED = "(unresolved)";
export const ABSENCE_TOKENS = [NONE, NEVER, UNRESOLVED];
export const DEFAULT_WIDTH = 88;
export function heading(text, style) {
  const rule = "─".repeat(Math.max(visibleWidth(text), 1));
  return `${style.bold(text)}
${style.dim(rule)}`;
}
export function subheading(text, style) {
  return style.bold(text);
}
export function indent(text, by = 2) {
  const pad = " ".repeat(by);
  return text.split(`
`).map((line) => line.length === 0 ? line : pad + line).join(`
`);
}
export function pad(text, width) {
  const gap = width - visibleWidth(text);
  return gap <= 0 ? text : text + " ".repeat(gap);
}
export function padStart(text, width) {
  const gap = width - visibleWidth(text);
  return gap <= 0 ? text : " ".repeat(gap) + text;
}
export function truncate(text, width) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= width)
    return flat;
  return width <= 1 ? flat.slice(0, width) : `${flat.slice(0, width - 1)}…`;
}
export function table(rows, opts = {}) {
  if (rows.length === 0)
    return "";
  const gap = " ".repeat(opts.gap ?? 2);
  const right = new Set(opts.right ?? []);
  const columns = Math.max(...rows.map((r) => r.length));
  const widths = [];
  for (let c = 0;c < columns; c++) {
    widths.push(Math.max(...rows.map((r) => visibleWidth(r[c] ?? ""))));
  }
  return rows.map((row) => row.map((cell, c) => {
    const w = widths[c] ?? 0;
    if (c === row.length - 1)
      return cell;
    return right.has(c) ? padStart(cell, w) : pad(cell, w);
  }).join(gap).replace(/\s+$/, "")).join(`
`);
}
export function meter(fraction, width = 10) {
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
export function num(x, places = 2) {
  return Number.isFinite(x) ? x.toFixed(places) : "—";
}
export function columns(left, right, opts = {}) {
  const gap = opts.gap ?? 4;
  const total = opts.width ?? DEFAULT_WIDTH;
  const leftLines = left.split(`
`);
  const rightLines = right.split(`
`);
  const leftWidth = Math.max(...leftLines.map(visibleWidth), 0);
  const rightWidth = Math.max(...rightLines.map(visibleWidth), 0);
  if (leftWidth + gap + rightWidth > total) {
    return `${left}

${right}`;
  }
  const rows = Math.max(leftLines.length, rightLines.length);
  const out = [];
  for (let i = 0;i < rows; i++) {
    const l = leftLines[i] ?? "";
    const r = rightLines[i] ?? "";
    out.push(`${pad(l, leftWidth)}${" ".repeat(gap)}${r}`.replace(/\s+$/, ""));
  }
  return out.join(`
`);
}
export function stack(...blocks) {
  return blocks.filter((b) => b !== null && b.length > 0).join(`

`);
}
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
