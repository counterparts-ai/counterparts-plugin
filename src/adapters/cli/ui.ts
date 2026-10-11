/**
 * `adapters/cli/ui.ts` — the console's shared primitives: asking, colour, layout.
 *
 * Every interactive command the 0.2 install flow adds (wiring, uninstall, the
 * credential prompts, the reshaped `--help` and `doctor`) is built out of this
 * one file, so that a person meets ONE set of manners rather than four. Zero
 * runtime dependencies, as the rest of this package: the escapes are eight
 * strings and the line reader is `Io`.
 *
 * ── The four rules the whole module exists to hold ──────────────────────────
 *
 *   1. **Not a terminal → exactly as before.** `isInteractive` is false for a
 *      pipe, a CI job and every test console, and nothing here wraps, colours or
 *      asks when it is false. A command that gates on it keeps its current bytes
 *      for every scripted caller — the install loop included.
 *   2. **`NO_COLOR` is obeyed** (https://no-color.org), and so is `TERM=dumb`.
 *      Colour may only emphasize what the words already say: the dashboard's
 *      scar §2.4 — an absence is DISPLAYED, never merely un-highlighted — and a
 *      grade word (`GREEN`/`AMBER`/`RED`) is written out in both arms.
 *   3. **A hidden value is never echoed and never written.** `askHidden` returns
 *      it and writes nothing but the question and one newline. It is not passed
 *      to `io.out`, `io.err`, an error message, or a log — a secret that reaches
 *      a console has reached a scrollback buffer.
 *   4. **Nothing proceeds unconfirmed.** With no `io.prompt`, `confirm` is
 *      `false` and `typed` is `"mismatch"` whatever their default says — the
 *      same stance `Io.prompt`'s own docstring takes. `ask` alone falls back to
 *      its default, because a name is not a consent.
 *   5. **Esc cancels, everywhere, and the prompt says so** (owner, 2026-09-22,
 *      finding #21: "once the typed-phrase prompt is up there is no visible way
 *      out"). One reader produces one answer — `PROMPT_CANCEL` — and each asking
 *      function decides what cancelling MEANS for it: `confirm` is no, `typed`
 *      is `"cancelled"`, `ask` throws, `askHidden` is an empty answer, which is
 *      already its word for "skip".
 *
 * ── Wrapping and colour are decided separately, on purpose ──────────────────
 *
 * Wrapping keys off `io.tty.stdout`; colour keys off `useColor`, which
 * `FORCE_COLOR` can turn on for a pipe. So a coloured pipe still gets ONE
 * logical line per item and every existing `grep` in the suite and in
 * `tools/install-loop/run.sh` keeps working.
 *
 * ── The seam, and the one trap in it ────────────────────────────────────────
 *
 * Everything reads the console through `Io` (`commands.ts`), extended here-ward
 * with two OPTIONAL members — `promptHidden` and `tty` — so every existing
 * caller and every existing test compiles and behaves unchanged. Absent `tty`
 * means "no terminal", which is the truth for all of them.
 *
 * THE TRAP: a test that drives the interactive arm by setting
 * `tty: { stdin: true, stdout: true }` must ALSO supply `promptHidden`, or
 * `askHidden` refuses (`PromptAborted`, reason `no-hidden-input`) rather than
 * fall back to the echoing reader. That refusal is rule 3 defending itself: the
 * fallback to `io.prompt` is offered only to a console that has told us it is
 * not a terminal, where there is no terminal to echo to.
 */

import type { Io } from "./commands.js";

/** The environment, as `RunOptions` passes it. Never read from `process.env`
 *  here: a suite that did would pass or fail with the developer's shell. */
export type UiEnv = Record<string, string | undefined>;

// ── colour ──────────────────────────────────────────────────────────────────

// Built from the code point rather than written as a literal, exactly as
// `dashboard/ansi.ts` does: a raw control byte in a source file survives only
// as long as nothing reformats the file.
const CSI = `${String.fromCharCode(27)}[`;
const RESET = `${CSI}0m`;

function sgr(code: string, s: string): string {
  return s.length === 0 ? s : `${CSI}${code}m${s}${RESET}`;
}

/** The six colours this console has. Anything a command wants to say beyond
 *  them, it says in words. */
export interface Paint {
  readonly enabled: boolean;
  green(s: string): string;
  yellow(s: string): string;
  red(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  cyan(s: string): string;
}

const IDENTITY = (s: string): string => s;

/** Escapes off — the default for every pipe, every test and every `NO_COLOR`. */
export const PLAIN: Paint = {
  enabled: false,
  green: IDENTITY,
  yellow: IDENTITY,
  red: IDENTITY,
  dim: IDENTITY,
  bold: IDENTITY,
  cyan: IDENTITY,
};

const COLOUR: Paint = {
  enabled: true,
  green: (s) => sgr("32", s),
  yellow: (s) => sgr("33", s),
  red: (s) => sgr("31", s),
  dim: (s) => sgr("2", s),
  bold: (s) => sgr("1", s),
  cyan: (s) => sgr("36", s),
};

/**
 * Should this run colour its output?
 *
 * The precedence is fixed and tested in both orders:
 *
 *   1. `NO_COLOR` set to anything non-empty → **no**, whatever else is true.
 *      The VALUE is never interpreted: `NO_COLOR=0` means no colour, because the
 *      standard is about the variable's presence. (Empty string is treated as
 *      unset — the reading `dashboard/ansi.ts` already takes, and one repo
 *      should not hold two definitions of one variable.)
 *   2. `FORCE_COLOR` set, non-empty and not `"0"` → **yes**, even on a pipe.
 *      This does NOT turn wrapping on; see the file docstring.
 *   3. Otherwise: stdout is a terminal and `TERM` is not `dumb`.
 */
export function useColor(io: Io, env: UiEnv): boolean {
  const no = env["NO_COLOR"];
  if (typeof no === "string" && no.length > 0) return false;
  const force = env["FORCE_COLOR"];
  if (typeof force === "string" && force.length > 0 && force !== "0") return true;
  if (io.tty?.stdout !== true) return false;
  return env["TERM"] !== "dumb";
}

/** The `Paint` for this console and this environment. */
export function paint(io: Io, env: UiEnv): Paint {
  return useColor(io, env) ? COLOUR : PLAIN;
}

// ── am I talking to a person? ───────────────────────────────────────────────

export interface InteractiveOptions {
  /** The command's own `--yes` / `--no-input` / `--no-wire`: the caller has
   *  said it does not want to be asked, and that outranks the terminal. */
  readonly nonInteractive?: boolean;
}

/**
 * True only when there is a person at a keyboard who can answer.
 *
 * Four conjuncts, and every one of them has to hold: the caller did not opt out,
 * this console can actually ask (`io.prompt`), stdin AND stdout are terminals,
 * and `CI` is unset. stdout matters as much as stdin: a run whose answers come
 * from a terminal but whose output is being captured is a script, and a question
 * it never sees is a hang.
 */
export function isInteractive(io: Io, env: UiEnv, opts: InteractiveOptions = {}): boolean {
  if (opts.nonInteractive === true) return false;
  if (io.prompt === undefined) return false;
  if (io.tty?.stdin !== true || io.tty.stdout !== true) return false;
  const ci = env["CI"];
  if (typeof ci === "string" && ci.length > 0) return false;
  return true;
}

// ── width and wrapping ──────────────────────────────────────────────────────

/** The width assumed when the terminal will not say. */
export const FALLBACK_WIDTH = 80;

/** Narrower than this and wrapping does more harm than the long line. */
const MIN_WIDTH = 30;

/**
 * How wide to lay out for. Only ever the terminal's own report; `COLUMNS` is
 * not read, because a stale export is worse than the fallback.
 *
 * ZERO IS NOT A WIDTH, IT IS "I DO NOT KNOW". A pty that has not been given a
 * window size starts 0×0 and a terminal in the middle of being resized can
 * report the same, so a number at or below zero — and a number that is not one
 * at all — takes `FALLBACK_WIDTH`, not the floor. The floor is for a terminal
 * that has told us something and told us something tiny: 4 columns is a real
 * answer, and folding to four is worse than folding to thirty. Measured on a
 * real pty, 2026-09-21: every line came out folded to thirty characters.
 */
export function terminalWidth(io: Io): number {
  const c = io.tty?.columns;
  if (typeof c !== "number" || !Number.isFinite(c)) return FALLBACK_WIDTH;
  const n = Math.floor(c);
  if (n <= 0) return FALLBACK_WIDTH;
  return n < MIN_WIDTH ? MIN_WIDTH : n;
}

/** Wrapping happens for a terminal and nowhere else, so a pipe and a test get
 *  one logical line per item and every existing `grep` keeps working. */
export function wraps(io: Io): boolean {
  return io.tty?.stdout === true;
}

/**
 * `prefix + text`, folded to `width` with a hanging indent of `hanging` spaces.
 *
 * Greedy, on runs of whitespace, and a token longer than the room available is
 * emitted WHOLE on a line of its own — a path or a URL is worse broken than
 * over-long, and a wrapper that could not place a token would otherwise loop.
 * Only the TEXT is folded; `prefix` is placed verbatim on the first line, so a
 * caller that built a padded column keeps it.
 */
export function fold(prefix: string, text: string, width: number, hanging: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [prefix.length === 0 ? "" : prefix.replace(/\s+$/, "")];
  const pad = " ".repeat(Math.max(0, hanging));
  const firstRoom = Math.max(1, width - prefix.length);
  const restRoom = Math.max(1, width - pad.length);
  const out: string[] = [];
  let line = "";
  let room = firstRoom;
  for (const word of words) {
    if (line.length === 0) {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= room) {
      line = `${line} ${word}`;
      continue;
    }
    out.push(out.length === 0 ? prefix + line : pad + line);
    line = word;
    room = restRoom;
  }
  out.push(out.length === 0 ? prefix + line : pad + line);
  return out;
}

// ── asking ──────────────────────────────────────────────────────────────────

export type AbortReason = "interrupt" | "no-hidden-input" | "cancelled";

/**
 * WHAT A CANCELLED READ COMES BACK AS.
 *
 * A bare ESC cannot be part of an answer — every reader here drops the control
 * characters and swallows escape sequences whole — so one raw ESC byte is a
 * value no typist can produce and no scripted console will ever hold. It
 * travels back through `Io.prompt`'s ordinary `string` rather than a second
 * channel, so a console that knows nothing about cancelling (every test
 * console, every pipe) is unchanged, and each asking function below decides for
 * itself what cancelling means.
 */
export const PROMPT_CANCEL = String.fromCharCode(27);

/** Did this answer come back cancelled? Compare BEFORE trimming: ESC is not
 *  whitespace, but a caller that lowercases and trims first is one line away
 *  from a sentinel that no longer matches. */
export function isCancel(answer: string): boolean {
  return answer === PROMPT_CANCEL;
}

/**
 * A question that did not get an answer and must not be treated as one.
 *
 * Thrown rather than returned as a null, deliberately: a forgotten check on a
 * nullable return turns Ctrl-C into "the person skipped it", which for a key
 * prompt means an install that silently continues without the key the person was
 * in the middle of cancelling. Uncaught, it still exits non-zero through the
 * `bin/` entry's own rejection handler.
 */
export class PromptAborted extends Error {
  readonly reason: AbortReason;
  constructor(reason: AbortReason, message: string) {
    super(message);
    this.name = "PromptAborted";
    this.reason = reason;
  }
}

/** `instanceof` across module instances is not a thing to rely on; the name is. */
export function isPromptAborted(e: unknown): e is PromptAborted {
  return e instanceof Error && e.name === "PromptAborted";
}

/** ONE trailing end-of-line and nothing else. Not `trim()`: what a person typed
 *  between the prompt and the newline is what they meant, and a typed
 *  confirmation compares exactly. */
function stripEol(s: string): string {
  if (s.endsWith("\r\n")) return s.slice(0, -2);
  if (s.endsWith("\n") || s.endsWith("\r")) return s.slice(0, -1);
  return s;
}

export interface AskOptions {
  /** Shown as `[default]` and returned for an empty answer. */
  readonly default?: string;
}

/**
 * One line of free text.
 *
 * The question is used VERBATIM and a space is appended, so the caller owns its
 * own punctuation; a default is shown as `[…]` before it. With no console to ask
 * (a pipe, a test with no scripted answers) the default comes back — a name or a
 * budget is a value, not a consent, so falling back is honest here and is not in
 * `confirm`.
 *
 * **Esc ABORTS THE COMMAND** rather than taking the default (owner, 2026-09-22,
 * item 8). A default is what somebody who pressed Enter meant; somebody who
 * pressed Esc meant to leave, and the callers of this one are mid-install, where
 * "carry on with the default name" is the opposite of the answer.
 */
export async function ask(io: Io, question: string, opts: AskOptions = {}): Promise<string> {
  const fallback = opts.default ?? "";
  if (io.prompt === undefined) return fallback;
  const hint = opts.default === undefined || opts.default.length === 0 ? "" : ` [${opts.default}]`;
  const raw = stripEol(await io.prompt(`${question}${hint} `));
  if (isCancel(raw)) throw new PromptAborted("cancelled", "cancelled.");
  return raw.length === 0 ? fallback : raw;
}

export interface ConfirmOptions {
  /** Required: an unanswerable yes/no has to know which way Enter goes. */
  readonly default: boolean;
  /**
   * Printed after the tag, with its own parentheses, for a question whose Esc
   * is worth saying out loud: `Go ahead? [Y/n]   (Esc or n to stop)`.
   *
   * OPT-IN, not automatic. On `Add an Anthropic key? [y/N]` Esc, Enter and `n`
   * all mean the same thing and the hint would be noise on the busiest screen
   * in the package (the owner's own install screen, 2026-09-22, shows a bare
   * tag); on a question whose default is YES and whose yes moves somebody's
   * data, the way out has to be on the line.
   */
  readonly hint?: string;
}

/**
 * Yes or no, with the default in capitals — `[Y/n]` or `[y/N]`.
 *
 * `y`/`yes`/`n`/`no` in any case, Enter for the default, and ONE re-ask on
 * anything else before the default is taken: a person who has typed two
 * non-answers is not reading, and a third identical question is a trap rather
 * than a kindness.
 *
 * **Esc is NO**, whatever the default is, and it is not one of the two attempts:
 * a person reaching for the way out has answered the question.
 *
 * **With no `io.prompt` this is `false`, never the default.** Every caller of
 * this function is about to do something to somebody's machine; `Io`'s own
 * docstring already says an absent prompt means a destructive command refuses
 * rather than proceeds, and a `{ default: true }` that wired a stranger's
 * settings.json over a pipe would be that rule failing quietly.
 */
export async function confirm(io: Io, question: string, opts: ConfirmOptions): Promise<boolean> {
  if (io.prompt === undefined) return false;
  const tag = opts.default ? "[Y/n]" : "[y/N]";
  const hint = opts.hint === undefined || opts.hint.length === 0 ? "" : `   ${opts.hint}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = stripEol(await io.prompt(`${question} ${tag}${hint} `));
    // BEFORE `trim().toLowerCase()`: ESC survives both today, and a sentinel
    // that depends on that is a sentinel one edit from silently meaning "the
    // default".
    if (isCancel(answer)) return false;
    const raw = answer.trim().toLowerCase();
    if (raw.length === 0) return opts.default;
    if (raw === "y" || raw === "yes") return true;
    if (raw === "n" || raw === "no") return false;
    if (attempt === 0) io.out("Please answer y or n.");
  }
  return opts.default;
}

/** What came back from a typed confirmation. THREE answers, not two: the
 *  person who stopped and the person who typed the wrong thing are told
 *  different sentences and get different exit codes. */
export type TypedAnswer = "typed" | "cancelled" | "mismatch";

/** The word that cancels a typed confirmation, in any case. `DELETE MEMORIES`
 *  is a phrase you cannot answer by reflex; there has to be one you can. */
export const CANCEL_WORD = "cancel";

/**
 * The typed confirmation `uninstall --delete-memories` guards itself with:
 * `"typed"` only when what came back IS the phrase.
 *
 * Case-sensitive, and nothing is trimmed but the trailing end-of-line, so
 * `DELETE MEMORIES ` is not `DELETE MEMORIES`. That is the whole point of asking
 * for a phrase instead of a letter: it cannot be answered by reflex.
 *
 * **THREE WAYS OUT, and all three are `"cancelled"`** — Esc, an empty Enter, and
 * the word `cancel` (owner, 2026-09-22, finding #21: a prompt this loud with no
 * visible way out is one people answer by closing the terminal). An empty Enter
 * used to be a mismatch, which told somebody who had decided against it that
 * they had typed the phrase wrong.
 *
 * With no `io.prompt` this is `"mismatch"` — never `"typed"`, which is rule 4.
 * Every caller checks for a console of its own first, because "there is nobody
 * here" deserves its own sentence rather than "that was not the phrase".
 */
export async function typed(io: Io, exactPhrase: string, prompt: string): Promise<TypedAnswer> {
  if (io.prompt === undefined) return "mismatch";
  const raw = stripEol(await io.prompt(prompt));
  if (isCancel(raw)) return "cancelled";
  const word = raw.trim();
  if (word.length === 0 || word.toLowerCase() === CANCEL_WORD) return "cancelled";
  return raw === exactPhrase ? "typed" : "mismatch";
}

/**
 * A secret, read without echo.
 *
 * Three consoles, three behaviours:
 *
 *   - `io.promptHidden` present → that, and only that.
 *   - absent, and stdin is a TERMINAL → **refuse** (`PromptAborted`,
 *     `no-hidden-input`). Falling back to the echoing reader here would put an
 *     API key in a scrollback buffer, which is the one thing this function
 *     exists to prevent.
 *   - absent, and not a terminal (a test console, a pipe) → `io.prompt`, or `""`
 *     when there is none. There is no terminal to echo to.
 *
 * Empty means SKIP and is an ordinary answer: every key this console asks for is
 * optional. The value is returned and nowhere else — not printed, not logged,
 * not put in an error.
 *
 * **Esc IS an empty answer here** rather than an abort: this prompt's own word
 * for "not now" is already Enter-on-empty, and the two gestures mean the same
 * thing in front of an optional key. Nothing is written either way.
 */
export async function askHidden(io: Io, question: string): Promise<string> {
  if (io.promptHidden !== undefined) {
    const value = stripEol(await io.promptHidden(question));
    return isCancel(value) ? "" : value;
  }
  if (io.tty?.stdin === true) {
    throw new PromptAborted(
      "no-hidden-input",
      "this console cannot read a value without echoing it back",
    );
  }
  if (io.prompt === undefined) return "";
  const value = stripEol(await io.prompt(question));
  return isCancel(value) ? "" : value;
}

// ── the readers themselves ──────────────────────────────────────────────────

/** The half of `process.stdin` this needs, as a seam a test can supply. */
export interface RawInput {
  readonly isTTY?: boolean | undefined;
  setRawMode?(mode: boolean): void;
  resume?(): void;
  pause?(): void;
  on(event: string, listener: (chunk: unknown) => void): void;
  off?(event: string, listener: (chunk: unknown) => void): void;
  removeListener?(event: string, listener: (chunk: unknown) => void): void;
}

/** The half of `process.stdout` this needs. */
export interface RawOutput {
  write(s: string): void;
}

const ETX = "\u0003"; // Ctrl-C
const EOT = "\u0004"; // Ctrl-D
const DEL = "\u007f";
const BS = "\b";
const ESC = String.fromCharCode(27);

/** How long a bare ESC waits to find out whether it was an arrow key. */
export const ESC_WAIT_MS = 50;

interface RawOptions {
  /** Write each character back as it is typed. False for a secret. */
  readonly echo: boolean;
  /**
   * Does the end of the stream RESOLVE with what has been typed?
   *
   * True for the hidden reader, where an EOF is the same submit Ctrl-D is.
   * FALSE for the echoing one, and that is review m4 with a second coat of
   * paint: this reader answers `confirm`, whose Enter-on-empty is a yes on half
   * the screens in the package, so a stdin that closed under us must not come
   * back as "they pressed Enter".
   */
  readonly endIsSubmit: boolean;
  /** Overridable so a test does not sit out the real wait. */
  readonly escMs?: number;
}

/**
 * The one character loop, in two dresses: `hiddenPrompt` and `echoPrompt`.
 *
 * What it has to get right, and why each one is here:
 *
 *   - **Enter in raw mode is `\r`, not `\n`.** A reader waiting for `\n` hangs
 *     on a real terminal forever.
 *   - **A paste arrives as one chunk**, key and newline together, so the loop
 *     is per character and stops at the first end-of-line.
 *   - **Backspace** (`\x7f` and `\b`) must work, or a typo in a 100-character
 *     key can only be fixed by starting the command again. When it echoes, it
 *     erases: `\b \b`, which is backspace, overwrite, backspace.
 *   - **`setEncoding` is never called.** It is sticky on `process.stdin`, and
 *     `bin/counterparts.ts` reads the same stream for `credentials set`.
 *   - **The terminal is restored on every exit path** — Enter, Esc, Ctrl-C,
 *     Ctrl-D, `end`, `error` — and the listener is detached and the stream
 *     paused, or the process does not exit.
 *   - **An `error` is not a submit.** A stream that FAILED halfway through a key
 *     aborts, because resolving the half writes a truncated credential that
 *     reads as present.
 *   - **Ctrl-C works from every state**, escape sequence included.
 *   - Control and escape bytes below `0x20` are DROPPED rather than stored, and
 *     an escape sequence is swallowed whole, so an arrow key does not end up
 *     inside a credential.
 *   - **A BARE ESC CANCELS** (2026-09-22, item 8) — and it cannot be recognised
 *     the moment it arrives, because an arrow key starts with the same byte.
 *     So: an ESC with something after it in the same chunk is the head of a
 *     sequence and is swallowed as before; an ESC that ENDS a chunk starts a
 *     short timer, and if nothing has arrived when it fires, the person pressed
 *     Escape. `ESC_WAIT_MS` is the usual terminal answer to the usual terminal
 *     ambiguity; the timer is cleared by the next byte and by every exit path,
 *     so it can neither fire late nor hold the process open.
 */
function rawPrompt(
  input: RawInput,
  output: RawOutput,
  options: RawOptions,
): (question: string) => Promise<string> {
  const escMs = options.escMs ?? ESC_WAIT_MS;
  return (question: string) =>
    new Promise<string>((resolve, reject) => {
      let value = "";
      let settled = false;
      /** The pending "was that ESC on its own?" timer, or null. */
      let escTimer: ReturnType<typeof setTimeout> | null = null;
      /**
       * WHERE THE ESCAPE-SEQUENCE READER IS.
       *
       * An arrow key sends `ESC [ A`. Dropping only the ESC byte — which is all
       * a "below 0x20" rule does — leaves `[A` INSIDE the value, where nothing
       * echoes it and nobody can see it: a credential silently wrong. So the
       * sequence is swallowed whole: `csi` after `ESC [` or `ESC O`, consuming
       * until a final byte in `@`..`~`; `esc` after a bare ESC, swallowing one
       * more character.
       */
      let escape: "no" | "esc" | "csi" = "no";

      const drop = (event: string, listener: (chunk: unknown) => void): void => {
        if (input.off !== undefined) input.off(event, listener);
        else if (input.removeListener !== undefined) input.removeListener(event, listener);
      };

      const disarmEsc = (): void => {
        if (escTimer === null) return;
        clearTimeout(escTimer);
        escTimer = null;
      };

      const detach = (): void => {
        drop("data", onData);
        drop("end", onEnd);
        drop("error", onError);
      };

      /** The ONE way out: restore, detach, newline, then settle. */
      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        disarmEsc();
        detach();
        try {
          if (input.isTTY === true) input.setRawMode?.(false);
        } catch {
          /* a terminal that will not leave raw mode is not a reason to lose the
             answer, and there is nothing further this can do about it */
        }
        try {
          input.pause?.();
        } catch {
          /* likewise */
        }
        // The newline the echo would have written. Never the value.
        output.write("\n");
        settle();
      };

      /** End of input. For the hidden reader an EOF is a submit — the same
       *  answer Ctrl-D gives. For the echoing one it is not an answer at all
       *  (`RawOptions.endIsSubmit`). */
      function onEnd(): void {
        const answer = value;
        finish(() => {
          if (options.endIsSubmit) resolve(answer);
          else {
            reject(
              new PromptAborted("interrupt", "the input ended before the question was answered."),
            );
          }
        });
      }

      /**
       * A STREAM ERROR IS NOT A SUBMIT.
       *
       * Bound to `end` too until the U0 review caught it: a stream that failed
       * halfway through a key would have resolved with the half, and
       * `credentials set` would have written a truncated credential that reads
       * as present and fails at every boundary. The same shape as I32, minted
       * fresh. It aborts instead, and the caller's own `PromptAborted` handling
       * covers it.
       */
      function onError(): void {
        finish(() => {
          reject(new PromptAborted("interrupt", "the terminal closed before the value was read."));
        });
      }

      function onData(chunk: unknown): void {
        // ANYTHING AT ALL ANSWERS THE "WAS THAT ESC ALONE?" QUESTION, so the
        // timer is cleared before the byte is even looked at.
        disarmEsc();
        // Decoded here rather than through `setEncoding`, which would be sticky
        // on the shared stream. Keys are ASCII; a multi-byte character split
        // across two chunks is the known and accepted limit.
        const text = typeof chunk === "string" ? chunk : String(chunk);
        for (const ch of text) {
          // CTRL-C IS CHECKED FIRST, FROM EVERY STATE. Below the escape machine
          // it was swallowed as "the character after a bare ESC", so a person
          // who pressed an arrow key and then gave up could not give up.
          if (ch === ETX) {
            finish(() => {
              reject(new PromptAborted("interrupt", "cancelled."));
            });
            return;
          }
          if (escape === "csi") {
            const c = ch.codePointAt(0) ?? 0;
            // The FINAL byte of a CSI sequence is `@`..`~`; everything before it
            // is a parameter or an intermediate.
            if (c >= 0x40 && c <= 0x7e) escape = "no";
            continue;
          }
          if (escape === "esc") {
            escape = ch === "[" || ch === "O" ? "csi" : "no";
            continue;
          }
          if (ch === ESC) {
            escape = "esc";
            continue;
          }
          if (ch === "\r" || ch === "\n") {
            const answer = value;
            finish(() => {
              resolve(answer);
            });
            return;
          }
          if (ch === EOT) {
            // Ctrl-D is the end of the input, so it answers the same way the
            // end of the stream does: a submit for the hidden reader, and not
            // an answer at all for the echoing one.
            onEnd();
            return;
          }
          if (ch === DEL || ch === BS) {
            // ERASE, not just forget: backspace alone moves the cursor left and
            // leaves the character on the screen, so what is displayed and what
            // is held part company at the first typo.
            if (value.length > 0 && options.echo) output.write("\b \b");
            value = value.slice(0, -1);
            continue;
          }
          // Everything below a space is a control or the start of an escape
          // sequence, and none of it belongs in a credential.
          const code = ch.codePointAt(0) ?? 0;
          if (code < 0x20) continue;
          value += ch;
          if (options.echo) output.write(ch);
        }
        // AN ESC AT THE END OF A CHUNK IS THE AMBIGUOUS ONE. Mid-chunk it was
        // already decided above — something followed it, so it was a sequence.
        // Only a terminal is asked this question: a stream that is not one
        // delivers whole sequences and has no keyboard behind it to wait for.
        if (!settled && escape === "esc" && input.isTTY === true && escMs > 0) {
          escTimer = setTimeout(() => {
            escTimer = null;
            if (escape !== "esc") return;
            finish(() => {
              resolve(PROMPT_CANCEL);
            });
          }, escMs);
        }
      }

      output.write(question);
      try {
        if (input.isTTY === true) input.setRawMode?.(true);
      } catch {
        /* no raw mode available: the read still works, the terminal may echo,
           and that is the host's own doing rather than something to hide */
      }
      input.on("data", onData);
      input.on("end", onEnd);
      input.on("error", onError);
      input.resume?.();
    });
}

/**
 * Build a `promptHidden` over real streams: raw mode, no echo, no dependency.
 *
 * Bound in `bin/counterparts.ts` since 2026-09-21, where `credentials set` and
 * the install's key prompts read through it. Esc comes back as `PROMPT_CANCEL`,
 * which `askHidden` reads as the skip this prompt already offers.
 */
export function hiddenPrompt(
  input: RawInput,
  output: RawOutput,
  escMs?: number,
): (question: string) => Promise<string> {
  return rawPrompt(input, output, {
    echo: false,
    endIsSubmit: true,
    ...(escMs === undefined ? {} : { escMs }),
  });
}

/**
 * Build an `Io.prompt` over real streams — the same reader, echoing.
 *
 * It replaces `node:readline` at the entry point, and the reason is one word
 * long: Esc. `readline` hands us a line and nothing else, so a terminal it owns
 * cannot tell an Escape from an arrow key, and every prompt in the package was
 * a room with no visible door (owner, 2026-09-22, finding #21). Everything
 * `readline` was doing for us is thirty lines above: `\r` is Enter, backspace
 * erases, a paste arrives whole, Ctrl-C aborts, and a stdin that closes under
 * the question is not an answer to it (review m4 — the bug that ended an
 * install with exit 0 and no store).
 *
 * NOT bound for a pipe, and nothing here should be: it is a raw-mode reader for
 * a person at a keyboard. Off a terminal `Io.prompt` stays absent and every gate
 * in this file is false, which is what keeps a scripted run scripted.
 */
export function echoPrompt(
  input: RawInput,
  output: RawOutput,
  escMs?: number,
): (question: string) => Promise<string> {
  return rawPrompt(input, output, {
    echo: true,
    endIsSubmit: false,
    ...(escMs === undefined ? {} : { escMs }),
  });
}

// ── layout ──────────────────────────────────────────────────────────────────

/** `OFF` is doctor's fourth word: an optional feature nobody turned on. It is
 *  DIM, never coloured — nothing is wrong, and a warning colour on a line that
 *  says "this is optional" is the thing findings #24 asked us to stop doing. */
export type Grade = "GREEN" | "AMBER" | "RED" | "OFF";

/**
 * The two columns `statusLine` lays out in, and they are NOT free numbers:
 * they are `claude-code/doctor.ts`'s `SEVERITY_COLUMN` and `TITLE_COLUMN`, so
 * that a doctor line rendered here is byte-identical to `reportLines`'s when
 * wrapping is off. `test/ui.test.ts` holds the two files to each other, and
 * they widened together on 2026-09-22 when the labels became words a person
 * reads ("Recall by meaning") instead of internal names ("Embedder").
 */
const GRADE_COLUMN = 7;
const LABEL_COLUMN = 20;
const GUTTER = GRADE_COLUMN + LABEL_COLUMN;

/** The six-space gutter `ok`/`warn`/`fail`/`hint` share, so a run of them reads
 *  as one column of words and one column of messages. */
const MARK_COLUMN = 6;

/** A label as wide as its column still gets its space: `padEnd` is a floor, not
 *  a gap (doctor's 2026-09-20 fix, kept identical here). */
function labelCell(label: string): string {
  return label.length >= LABEL_COLUMN ? `${label} ` : label.padEnd(LABEL_COLUMN);
}

/**
 * The console's layout, bound to one `Io` and one environment.
 *
 * Every method WRITES — to `io.out`, all of them, `fail` included. The error
 * channel stays what it already is in this console: a refusal, `io.err`, the
 * word `refused:` and an exit code. Splitting one flow's step lines across two
 * file descriptors by severity is the surprise, not the consistency.
 */
export interface Ui {
  readonly paint: Paint;
  /** Whether colour is on — for a caller that wants to paint something itself. */
  readonly color: boolean;
  /** Whether a person can be asked. `nonInteractive` is folded in already. */
  readonly interactive: boolean;
  /** Whether long lines are folded. False for every pipe and every test. */
  readonly wraps: boolean;
  /** The width being laid out for. `FALLBACK_WIDTH` when nobody said. */
  readonly width: number;
  /** One empty line. The only spacing primitive; groups are separated by it. */
  blank(): void;
  /** A short bold title over a group. */
  heading(text: string): void;
  /** `[2/5] Wiring Claude Code` — the counter dim, the text plain. */
  step(n: number, total: number, text: string): void;
  ok(text: string): void;
  warn(text: string): void;
  fail(text: string): void;
  /**
   * `WARNING: …`, the word in red, further lines indented under it.
   *
   * NOT `fail`, and that is the owner's finding #25 (2026-09-22): the screen
   * read `fail  WARNING: this will delete 32 memories`, and a `fail` tag in
   * front of a warning about what a command is ABOUT to do says something
   * failed. Nothing has failed; this is the last thing anybody reads before
   * they decide.
   */
  warning(text: string, ...more: readonly string[]): void;
  /** An aside under the line above it: dim, and indented into the gutter. */
  hint(text: string): void;
  /** A doctor-shaped line: the grade in colour, the label in its column, a
   *  SHORT message, and the fix on its own indented dim line. */
  statusLine(grade: Grade, label: string, message: string, fix?: string): void;
}

export function ui(io: Io, env: UiEnv, opts: InteractiveOptions = {}): Ui {
  const p = paint(io, env);
  const folds = wraps(io);
  const width = terminalWidth(io);

  /** `prefix + text`, folded only when this console folds. */
  const emit = (prefix: string, text: string, hanging: number): string[] =>
    folds ? fold(prefix, text, width, hanging) : [`${prefix}${text}`];

  /** A marked line — `ok`, `warn`, `fail` — with the word painted and the
   *  padding computed from the PLAIN word, so the column is not thrown out by
   *  the escapes around it. */
  const marked = (word: string, colour: (s: string) => string, text: string): void => {
    const cell = word.padEnd(MARK_COLUMN);
    const lines = emit(cell, text, MARK_COLUMN);
    const first = lines[0] ?? "";
    io.out(colour(word) + first.slice(word.length));
    for (const line of lines.slice(1)) io.out(line);
  };

  return {
    paint: p,
    color: p.enabled,
    interactive: isInteractive(io, env, opts),
    wraps: folds,
    width,

    blank(): void {
      io.out("");
    },

    heading(text: string): void {
      const lines = emit("", text, 0);
      for (const line of lines) io.out(p.bold(line));
    },

    step(n: number, total: number, text: string): void {
      const cell = `[${String(n)}/${String(total)}] `;
      const lines = emit(cell, text, cell.length);
      const first = lines[0] ?? "";
      io.out(p.dim(cell.trimEnd()) + first.slice(cell.trimEnd().length));
      for (const line of lines.slice(1)) io.out(line);
    },

    ok(text: string): void {
      marked("ok", p.green, text);
    },

    warn(text: string): void {
      marked("warn", p.yellow, text);
    },

    fail(text: string): void {
      marked("fail", p.red, text);
    },

    warning(text: string, ...more: readonly string[]): void {
      const word = "WARNING:";
      const cell = `${word} `;
      const lines = emit(cell, text, cell.length);
      const first = lines[0] ?? "";
      io.out(p.red(word) + first.slice(word.length));
      for (const line of lines.slice(1)) io.out(line);
      // The lines under it are a continuation of the sentence, so they sit in
      // the same column the sentence starts in rather than in the mark gutter.
      const pad = " ".repeat(cell.length);
      for (const extra of more) {
        for (const line of emit(pad, extra, cell.length)) io.out(line);
      }
    },

    hint(text: string): void {
      const cell = " ".repeat(MARK_COLUMN);
      for (const line of emit(cell, text, MARK_COLUMN)) io.out(p.dim(line));
    },

    statusLine(grade: Grade, label: string, message: string, fix?: string): void {
      const gradeCell = grade.padEnd(GRADE_COLUMN);
      const prefix = `${gradeCell}${labelCell(label)}`;
      const lines = emit(prefix, message, prefix.length);
      const first = lines[0] ?? "";
      const colour =
        grade === "GREEN" ? p.green : grade === "AMBER" ? p.yellow : grade === "OFF" ? p.dim : p.red;
      io.out(colour(grade) + first.slice(grade.length));
      for (const line of lines.slice(1)) io.out(line);
      if (fix === undefined || fix.length === 0) return;
      // The fix indent is the CONSTANT gutter, not `prefix.length`: an
      // over-long label pushes its own line out and leaves the fix where every
      // other fix on the screen is — which is what `reportLines` does.
      const fixPrefix = `${" ".repeat(GUTTER)}fix: `;
      for (const line of emit(fixPrefix, fix, GUTTER + 5)) io.out(p.dim(line));
    },
  };
}
