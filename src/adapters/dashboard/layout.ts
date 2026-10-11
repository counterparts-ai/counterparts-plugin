/**
 * Plain-text layout: headings, aligned tables, meters, side-by-side columns —
 * and the ABSENCE VOCABULARY, which is the load-bearing part of this file.
 *
 * The totality test (CONTRACT §3, scar §2.17) is only as good as the marker it
 * looks for. v1's curation starvation hid because a panel with nothing in it
 * rendered as nothing at all, which reads as "quiet" rather than "never fired".
 * So every axis that has no data prints one of the tokens below, on the axis's
 * own line, and `test/dashboard.test.ts` asserts per-axis coverage against the
 * live registries rather than against a copied list.
 *
 * `NEVER` and `NONE` are different records on purpose: "was never asked" and
 * "was asked and the answer is zero" are the distinction scar §2.4 is about.
 */
import { visibleWidth } from "./ansi.js";
import type { Style } from "./ansi.js";

/** The axis exists, it has been evaluated, and its count is zero. */
export const NONE = "(none yet)";
/** The axis exists and has never run / never been asked. Not the same as zero. */
export const NEVER = "(never run)";
/** A value the store holds but this render could not resolve to anything. */
export const UNRESOLVED = "(unresolved)";

export const ABSENCE_TOKENS = [NONE, NEVER, UNRESOLVED] as const;

export const DEFAULT_WIDTH = 88;

export function heading(text: string, style: Style): string {
  const rule = "─".repeat(Math.max(visibleWidth(text), 1));
  return `${style.bold(text)}\n${style.dim(rule)}`;
}

export function subheading(text: string, style: Style): string {
  return style.bold(text);
}

export function indent(text: string, by = 2): string {
  const pad = " ".repeat(by);
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? line : pad + line))
    .join("\n");
}

export function pad(text: string, width: number): string {
  const gap = width - visibleWidth(text);
  return gap <= 0 ? text : text + " ".repeat(gap);
}

export function padStart(text: string, width: number): string {
  const gap = width - visibleWidth(text);
  return gap <= 0 ? text : " ".repeat(gap) + text;
}

/** Truncation is announced with an ellipsis — a silently cut line is a lie. */
export function truncate(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  return width <= 1 ? flat.slice(0, width) : `${flat.slice(0, width - 1)}…`;
}

export interface TableOptions {
  /** Column indexes to right-align. Numbers read wrong on the left. */
  readonly right?: readonly number[];
  readonly gap?: number;
}

/** Column-aligned rows. Widths measure VISIBLE characters, so colour is free. */
export function table(rows: readonly (readonly string[])[], opts: TableOptions = {}): string {
  if (rows.length === 0) return "";
  const gap = " ".repeat(opts.gap ?? 2);
  const right = new Set(opts.right ?? []);
  const columns = Math.max(...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < columns; c++) {
    widths.push(Math.max(...rows.map((r) => visibleWidth(r[c] ?? ""))));
  }
  return rows
    .map((row) =>
      row
        .map((cell, c) => {
          const w = widths[c] ?? 0;
          // The last cell is never padded: trailing spaces are invisible noise
          // that makes byte-for-byte assertions annoying for no reader's gain.
          if (c === row.length - 1) return cell;
          return right.has(c) ? padStart(cell, w) : pad(cell, w);
        })
        .join(gap)
        .replace(/\s+$/, ""),
    )
    .join("\n");
}

/**
 * A proportion, drawn. Deliberately coarse: this is a glance instrument, and a
 * bar precise enough to read a number off would be a number badly printed.
 */
export function meter(fraction: number, width = 10): string {
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Two decimals, always — a strength that prints as `0.6` and `0.60` on
 *  neighbouring lines makes a column unreadable. */
export function num(x: number, places = 2): string {
  return Number.isFinite(x) ? x.toFixed(places) : "—";
}

export interface ColumnsOptions {
  readonly gap?: number;
  readonly width?: number;
}

/**
 * Two blocks, side by side — the identity/protected pair, whose whole point is
 * being read TOGETHER (self/identity.ts, scar §2.19). Falls back to stacking
 * when the terminal is too narrow to hold both honestly.
 */
export function columns(left: string, right: string, opts: ColumnsOptions = {}): string {
  const gap = opts.gap ?? 4;
  const total = opts.width ?? DEFAULT_WIDTH;
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const leftWidth = Math.max(...leftLines.map(visibleWidth), 0);
  const rightWidth = Math.max(...rightLines.map(visibleWidth), 0);
  if (leftWidth + gap + rightWidth > total) {
    return `${left}\n\n${right}`;
  }
  const rows = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = leftLines[i] ?? "";
    const r = rightLines[i] ?? "";
    out.push(`${pad(l, leftWidth)}${" ".repeat(gap)}${r}`.replace(/\s+$/, ""));
  }
  return out.join("\n");
}

/** Blocks separated by exactly one blank line, empties dropped. */
export function stack(...blocks: (string | null)[]): string {
  return blocks.filter((b): b is string => b !== null && b.length > 0).join("\n\n");
}

/** `1 memory` / `2 memories` — the brain voice does not print `1 memories`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
