/**
 * The whole of this adapter's colour, written here rather than depended upon.
 *
 * Two rules, both from the CONTRACT: no TUI framework and no dependency, and
 * views are plain-text renderers returning strings. Colour is therefore a pure
 * decoration applied by a `Style` object that is DISABLED BY DEFAULT — every
 * view called without a style produces the exact bytes a test asserts on, and
 * the `bin/` entry is the only place that ever turns escapes on.
 *
 * There is no semantic colour vocabulary here beyond `warn`, deliberately: the
 * absence markers in `layout.ts` are WORDS, and a reader who pipes this through
 * `less` must see the same absences a colour terminal shows. Colour may
 * emphasize what the text already says; it may never be the only place it is
 * said (scar §2.4 — absence is displayed, not merely un-highlighted).
 *
 * The escape byte is built with `String.fromCharCode` rather than written as a
 * literal: a raw control character in a source file survives exactly as long as
 * nothing ever reformats it.
 */

const CSI = `${String.fromCharCode(27)}[`;
const RESET = `${CSI}0m`;
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function wrap(code: string, s: string): string {
  return s.length === 0 ? s : `${CSI}${code}m${s}${RESET}`;
}

export interface Style {
  readonly enabled: boolean;
  bold(s: string): string;
  dim(s: string): string;
  underline(s: string): string;
  /** For a named absence and a torn marker: the two things worth an eye-catch. */
  warn(s: string): string;
  ok(s: string): string;
}

const IDENTITY = (s: string): string => s;

/** Escapes off. The default everywhere except an interactive terminal. */
export const PLAIN: Style = {
  enabled: false,
  bold: IDENTITY,
  dim: IDENTITY,
  underline: IDENTITY,
  warn: IDENTITY,
  ok: IDENTITY,
};

const COLOUR: Style = {
  enabled: true,
  bold: (s) => wrap("1", s),
  dim: (s) => wrap("2", s),
  underline: (s) => wrap("4", s),
  warn: (s) => wrap("33", s),
  ok: (s) => wrap("32", s),
};

export function style(enabled: boolean): Style {
  return enabled ? COLOUR : PLAIN;
}

/**
 * True when this process is attached to a terminal that has not asked for plain
 * output. `NO_COLOR` is honoured because the owner's terminal is not ours to
 * decide about (https://no-color.org).
 */
export function terminalWantsColour(env: NodeJS.ProcessEnv = process.env): boolean {
  const noColour = env["NO_COLOR"];
  if (typeof noColour === "string" && noColour.length > 0) return false;
  return process.stdout.isTTY === true;
}

/** Column arithmetic must measure what the eye sees, not what the bytes are. */
export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

export function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, "");
}
