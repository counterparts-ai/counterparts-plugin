const CSI = `${String.fromCharCode(27)}[`;
const RESET = `${CSI}0m`;
function sgr(code, s) {
  return s.length === 0 ? s : `${CSI}${code}m${s}${RESET}`;
}
const IDENTITY = (s) => s;
export const PLAIN = {
  enabled: false,
  green: IDENTITY,
  yellow: IDENTITY,
  red: IDENTITY,
  dim: IDENTITY,
  bold: IDENTITY,
  cyan: IDENTITY
};
const COLOUR = {
  enabled: true,
  green: (s) => sgr("32", s),
  yellow: (s) => sgr("33", s),
  red: (s) => sgr("31", s),
  dim: (s) => sgr("2", s),
  bold: (s) => sgr("1", s),
  cyan: (s) => sgr("36", s)
};
export function useColor(io, env) {
  const no = env["NO_COLOR"];
  if (typeof no === "string" && no.length > 0)
    return false;
  const force = env["FORCE_COLOR"];
  if (typeof force === "string" && force.length > 0 && force !== "0")
    return true;
  if (io.tty?.stdout !== true)
    return false;
  return env["TERM"] !== "dumb";
}
export function paint(io, env) {
  return useColor(io, env) ? COLOUR : PLAIN;
}
export function isInteractive(io, env, opts = {}) {
  if (opts.nonInteractive === true)
    return false;
  if (io.prompt === undefined)
    return false;
  if (io.tty?.stdin !== true || io.tty.stdout !== true)
    return false;
  const ci = env["CI"];
  if (typeof ci === "string" && ci.length > 0)
    return false;
  return true;
}
export const FALLBACK_WIDTH = 80;
const MIN_WIDTH = 30;
export function terminalWidth(io) {
  const c = io.tty?.columns;
  if (typeof c !== "number" || !Number.isFinite(c))
    return FALLBACK_WIDTH;
  const n = Math.floor(c);
  if (n <= 0)
    return FALLBACK_WIDTH;
  return n < MIN_WIDTH ? MIN_WIDTH : n;
}
export function wraps(io) {
  return io.tty?.stdout === true;
}
export function fold(prefix, text, width, hanging) {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0)
    return [prefix.length === 0 ? "" : prefix.replace(/\s+$/, "")];
  const pad = " ".repeat(Math.max(0, hanging));
  const firstRoom = Math.max(1, width - prefix.length);
  const restRoom = Math.max(1, width - pad.length);
  const out = [];
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
export const PROMPT_CANCEL = String.fromCharCode(27);
export function isCancel(answer) {
  return answer === PROMPT_CANCEL;
}

export class PromptAborted extends Error {
  reason;
  constructor(reason, message) {
    super(message);
    this.name = "PromptAborted";
    this.reason = reason;
  }
}
export function isPromptAborted(e) {
  return e instanceof Error && e.name === "PromptAborted";
}
function stripEol(s) {
  if (s.endsWith(`\r
`))
    return s.slice(0, -2);
  if (s.endsWith(`
`) || s.endsWith("\r"))
    return s.slice(0, -1);
  return s;
}
export async function ask(io, question, opts = {}) {
  const fallback = opts.default ?? "";
  if (io.prompt === undefined)
    return fallback;
  const hint = opts.default === undefined || opts.default.length === 0 ? "" : ` [${opts.default}]`;
  const raw = stripEol(await io.prompt(`${question}${hint} `));
  if (isCancel(raw))
    throw new PromptAborted("cancelled", "cancelled.");
  return raw.length === 0 ? fallback : raw;
}
export async function confirm(io, question, opts) {
  if (io.prompt === undefined)
    return false;
  const tag = opts.default ? "[Y/n]" : "[y/N]";
  const hint = opts.hint === undefined || opts.hint.length === 0 ? "" : `   ${opts.hint}`;
  for (let attempt = 0;attempt < 2; attempt += 1) {
    const answer = stripEol(await io.prompt(`${question} ${tag}${hint} `));
    if (isCancel(answer))
      return false;
    const raw = answer.trim().toLowerCase();
    if (raw.length === 0)
      return opts.default;
    if (raw === "y" || raw === "yes")
      return true;
    if (raw === "n" || raw === "no")
      return false;
    if (attempt === 0)
      io.out("Please answer y or n.");
  }
  return opts.default;
}
export const CANCEL_WORD = "cancel";
export async function typed(io, exactPhrase, prompt) {
  if (io.prompt === undefined)
    return "mismatch";
  const raw = stripEol(await io.prompt(prompt));
  if (isCancel(raw))
    return "cancelled";
  const word = raw.trim();
  if (word.length === 0 || word.toLowerCase() === CANCEL_WORD)
    return "cancelled";
  return raw === exactPhrase ? "typed" : "mismatch";
}
export async function askHidden(io, question) {
  if (io.promptHidden !== undefined) {
    const value = stripEol(await io.promptHidden(question));
    return isCancel(value) ? "" : value;
  }
  if (io.tty?.stdin === true) {
    throw new PromptAborted("no-hidden-input", "this console cannot read a value without echoing it back");
  }
  if (io.prompt === undefined)
    return "";
  const value = stripEol(await io.prompt(question));
  return isCancel(value) ? "" : value;
}
const ETX = "\x03";
const EOT = "\x04";
const DEL = "\u007F";
const BS = "\b";
const ESC = String.fromCharCode(27);
export const ESC_WAIT_MS = 50;
function rawPrompt(input, output, options) {
  const escMs = options.escMs ?? ESC_WAIT_MS;
  return (question) => new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    let escTimer = null;
    let escape = "no";
    const drop = (event, listener) => {
      if (input.off !== undefined)
        input.off(event, listener);
      else if (input.removeListener !== undefined)
        input.removeListener(event, listener);
    };
    const disarmEsc = () => {
      if (escTimer === null)
        return;
      clearTimeout(escTimer);
      escTimer = null;
    };
    const detach = () => {
      drop("data", onData);
      drop("end", onEnd);
      drop("error", onError);
    };
    const finish = (settle) => {
      if (settled)
        return;
      settled = true;
      disarmEsc();
      detach();
      try {
        if (input.isTTY === true)
          input.setRawMode?.(false);
      } catch {}
      try {
        input.pause?.();
      } catch {}
      output.write(`
`);
      settle();
    };
    function onEnd() {
      const answer = value;
      finish(() => {
        if (options.endIsSubmit)
          resolve(answer);
        else {
          reject(new PromptAborted("interrupt", "the input ended before the question was answered."));
        }
      });
    }
    function onError() {
      finish(() => {
        reject(new PromptAborted("interrupt", "the terminal closed before the value was read."));
      });
    }
    function onData(chunk) {
      disarmEsc();
      const text = typeof chunk === "string" ? chunk : String(chunk);
      for (const ch of text) {
        if (ch === ETX) {
          finish(() => {
            reject(new PromptAborted("interrupt", "cancelled."));
          });
          return;
        }
        if (escape === "csi") {
          const c = ch.codePointAt(0) ?? 0;
          if (c >= 64 && c <= 126)
            escape = "no";
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
        if (ch === "\r" || ch === `
`) {
          const answer = value;
          finish(() => {
            resolve(answer);
          });
          return;
        }
        if (ch === EOT) {
          onEnd();
          return;
        }
        if (ch === DEL || ch === BS) {
          if (value.length > 0 && options.echo)
            output.write("\b \b");
          value = value.slice(0, -1);
          continue;
        }
        const code = ch.codePointAt(0) ?? 0;
        if (code < 32)
          continue;
        value += ch;
        if (options.echo)
          output.write(ch);
      }
      if (!settled && escape === "esc" && input.isTTY === true && escMs > 0) {
        escTimer = setTimeout(() => {
          escTimer = null;
          if (escape !== "esc")
            return;
          finish(() => {
            resolve(PROMPT_CANCEL);
          });
        }, escMs);
      }
    }
    output.write(question);
    try {
      if (input.isTTY === true)
        input.setRawMode?.(true);
    } catch {}
    input.on("data", onData);
    input.on("end", onEnd);
    input.on("error", onError);
    input.resume?.();
  });
}
export function hiddenPrompt(input, output, escMs) {
  return rawPrompt(input, output, {
    echo: false,
    endIsSubmit: true,
    ...escMs === undefined ? {} : { escMs }
  });
}
export function echoPrompt(input, output, escMs) {
  return rawPrompt(input, output, {
    echo: true,
    endIsSubmit: false,
    ...escMs === undefined ? {} : { escMs }
  });
}
const GRADE_COLUMN = 7;
const LABEL_COLUMN = 20;
const GUTTER = GRADE_COLUMN + LABEL_COLUMN;
const MARK_COLUMN = 6;
function labelCell(label) {
  return label.length >= LABEL_COLUMN ? `${label} ` : label.padEnd(LABEL_COLUMN);
}
export function ui(io, env, opts = {}) {
  const p = paint(io, env);
  const folds = wraps(io);
  const width = terminalWidth(io);
  const emit = (prefix, text, hanging) => folds ? fold(prefix, text, width, hanging) : [`${prefix}${text}`];
  const marked = (word, colour, text) => {
    const cell = word.padEnd(MARK_COLUMN);
    const lines = emit(cell, text, MARK_COLUMN);
    const first = lines[0] ?? "";
    io.out(colour(word) + first.slice(word.length));
    for (const line of lines.slice(1))
      io.out(line);
  };
  return {
    paint: p,
    color: p.enabled,
    interactive: isInteractive(io, env, opts),
    wraps: folds,
    width,
    blank() {
      io.out("");
    },
    heading(text) {
      const lines = emit("", text, 0);
      for (const line of lines)
        io.out(p.bold(line));
    },
    step(n, total, text) {
      const cell = `[${String(n)}/${String(total)}] `;
      const lines = emit(cell, text, cell.length);
      const first = lines[0] ?? "";
      io.out(p.dim(cell.trimEnd()) + first.slice(cell.trimEnd().length));
      for (const line of lines.slice(1))
        io.out(line);
    },
    ok(text) {
      marked("ok", p.green, text);
    },
    warn(text) {
      marked("warn", p.yellow, text);
    },
    fail(text) {
      marked("fail", p.red, text);
    },
    warning(text, ...more) {
      const word = "WARNING:";
      const cell = `${word} `;
      const lines = emit(cell, text, cell.length);
      const first = lines[0] ?? "";
      io.out(p.red(word) + first.slice(word.length));
      for (const line of lines.slice(1))
        io.out(line);
      const pad = " ".repeat(cell.length);
      for (const extra of more) {
        for (const line of emit(pad, extra, cell.length))
          io.out(line);
      }
    },
    hint(text) {
      const cell = " ".repeat(MARK_COLUMN);
      for (const line of emit(cell, text, MARK_COLUMN))
        io.out(p.dim(line));
    },
    statusLine(grade, label, message, fix) {
      const gradeCell = grade.padEnd(GRADE_COLUMN);
      const prefix = `${gradeCell}${labelCell(label)}`;
      const lines = emit(prefix, message, prefix.length);
      const first = lines[0] ?? "";
      const colour = grade === "GREEN" ? p.green : grade === "AMBER" ? p.yellow : grade === "OFF" ? p.dim : p.red;
      io.out(colour(grade) + first.slice(grade.length));
      for (const line of lines.slice(1))
        io.out(line);
      if (fix === undefined || fix.length === 0)
        return;
      const fixPrefix = `${" ".repeat(GUTTER)}fix: `;
      for (const line of emit(fixPrefix, fix, GUTTER + 5))
        io.out(p.dim(line));
    }
  };
}
