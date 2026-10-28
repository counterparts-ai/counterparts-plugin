/**
 * WHY A NIGHT CHILD FAILED, IN ONE SHORT LINE (2026-10-27, R4).
 *
 * Night run nrn_8f332b7d176d (10-27) failed: every child exited 1 in a few
 * seconds with no tokens, and the row said only "claude exited with an error
 * (exit 1)". The children run with `--no-session-persistence`, so there is no
 * transcript, and nothing of what the host said was kept: the cause was
 * unrecoverable. (It was a sign-in lost mid-run — the owner switched Claude
 * Code accounts.)
 *
 * What a failed child said is read from what is ALREADY read of it, no new
 * flag: its own `stream-json` `result` line when its output is kept (the
 * night's named children), else a line of its STDERR (every child).
 * Measured on 2.1.311 with no sign-in: `claude -p` writes
 * `Not logged in · Please run /login` to STDOUT (a `result` line with
 * `is_error: true`, `subtype: "success"`, `terminal_reason: "api_error"`
 * under `stream-json`; the bare line in text mode) and nothing to STDERR; an
 * unknown flag goes to STDERR (`error: unknown option '--x'`).
 *
 * A result's own TEXT is read only when it is the host's API error (review of
 * #656): `terminal_reason: "api_error"`, an `api_error_status`, or the
 * measured signed-out shape (`subtype: "success"` with `is_error`). Any other
 * error result (`error_max_turns`, `error_during_execution`) may carry the
 * model's own words, so only its subtype and status are kept, with the STDERR
 * line beside them.
 *
 * The line is bounded (`CHILD_ERROR_MAX`), one line, home paths shortened to
 * `~`, and SCRUBBED by shape, not by known names (`scrubSecrets`).
 */
import { homedir } from "node:os";

import type { ChildResult } from "./child.js";

/** **CAL.** The most of a failure's line kept, characters. */
export const CHILD_ERROR_MAX = 300;

const REDACTED = "[redacted]";

/** A label that names a credential: `token`, `access_token`, `x-api-key`, `api key`, `pw`, …. */
const LABEL = String.raw`[A-Za-z_-]*(?:token|key|secret|password|passwd|pwd|pw|credentials?)|api[ _-]?key`;

/**
 * SCRUB A LINE OF ANYTHING TOKEN- OR KEY-SHAPED, by pattern:
 *   - `Authorization` with its value, scheme included (`Basic …`, `Bearer …`);
 *     everything after `Cookie:`/`Cookie=` (each name=value in it); the word
 *     after `Bearer`;
 *   - the value after a credential label — bare, JSON or quoted
 *     (`token=v`, `{"token":"v"}`, `"access_token": "v"`, `'pw': 'v'`) — with
 *     `:` or `=`; and with only a space (`x-api-key abc1…`, `api key abc1…`)
 *     when the value has a digit in it or is 16+ characters, so
 *     "Invalid API key provided" stays words;
 *   - known prefixes: `sk-…`, GitHub `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/
 *     `github_pat_…`, Slack `xox?-…`, AWS `AKIA…`;
 *   - any run of 20+ characters from `[A-Za-z0-9_\-.+/=]` with a digit in it
 *     (keys, OAuth and JWT tokens, request ids, long hashes — and, over-eager
 *     by design, a long path or host name with a digit).
 * Ordinary words, short numbers (`401`, `exit 1`) and punctuation stay.
 */
export function scrubSecrets(text: string): string {
  return (
    text
      .replace(/\b(authorization)(["']?\s*[:=]\s*["']?|\s+)(?:(?:basic|bearer|token|digest|negotiate)\s+)?[^\s"']+/gi, (_m, label: string, sep: string) => `${label}${sep}${REDACTED}`)
      .replace(/\b(cookie)(["']?\s*[:=]\s*)[^"'\n]*/gi, (_m, label: string, sep: string) => `${label}${sep}${REDACTED}`)
      .replace(/\b(bearer)(\s+)[^\s"']{6,}/gi, (_m, label: string, sep: string) => `${label}${sep}${REDACTED}`)
      .replace(new RegExp(String.raw`\b(${LABEL})(["']?\s*[:=]\s*["']?)[^\s"']+`, "gi"), (_m, label: string, sep: string) => `${label}${sep}${REDACTED}`)
      .replace(new RegExp(String.raw`\b(${LABEL})(\s+)([^\s"']{6,})`, "gi"), (m, label: string, sep: string, value: string) =>
        /\d/.test(value) || value.length >= 16 ? `${label}${sep}${REDACTED}` : m,
      )
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED)
      .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/g, REDACTED)
      .replace(/\bxox[a-z]-[A-Za-z0-9-]{8,}/g, REDACTED)
      .replace(/\bAKIA[0-9A-Z]{12,}/g, REDACTED)
      .replace(/[A-Za-z0-9_\-.+/=]{20,}/g, (run) => (/\d/.test(run) ? REDACTED : run))
  );
}

/** Home directories shortened to `~`: this user's, and any `/Users/<name>` or `/home/<name>`. */
function shortenHomes(text: string): string {
  let out = text;
  const home = homedir();
  if (home.length > 1) out = out.split(home).join("~");
  return out.replace(/\/(?:Users|home)\/[^/\s"':]+/g, "~");
}

/** One line: ANSI and OSC sequences and control characters out, whitespace collapsed, home paths shortened, scrubbed, bounded. */
export function oneLine(text: string): string {
  const flat = text
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const clean = scrubSecrets(shortenHomes(flat));
  return clean.length <= CHILD_ERROR_MAX ? clean : `${clean.slice(0, CHILD_ERROR_MAX - 1).trimEnd()}…`;
}

/** What the last `result` line says of a failure. */
interface ResultSaid {
  readonly label: string;
  /** The host's own error text, when the result is its API error; null otherwise. */
  readonly text: string | null;
  /** The result is the host's API error (`terminal_reason: "api_error"`). */
  readonly api: boolean;
  readonly status: number | string | null;
}

/** The child's last `result` line, when it says it is an error. */
function resultError(output: string | undefined): ResultSaid | null {
  const lines = (output ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] as string;
    if (!line.includes('"result"')) continue;
    let o: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      o = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o["type"] !== "result") continue;
    // The LAST result decides: a successful one says nothing of a failure
    // (its text is the model's prose), and the STDERR line is read instead.
    const rawSubtype = typeof o["subtype"] === "string" ? o["subtype"] : "";
    const isError = o["is_error"] === true;
    if (!isError && (rawSubtype === "" || rawSubtype === "success")) return null;
    const api = o["terminal_reason"] === "api_error";
    const rawStatus = o["api_error_status"];
    const status = typeof rawStatus === "number" || (typeof rawStatus === "string" && rawStatus.length > 0) ? rawStatus : null;
    // `subtype` says `success` on an error result (2.1.311, signed out): no label then.
    const subtype = rawSubtype.length > 0 && rawSubtype !== "success" ? rawSubtype : null;
    const reason = typeof o["terminal_reason"] === "string" && o["terminal_reason"].length > 0 ? o["terminal_reason"] : (subtype ?? "error");
    const label = `${reason}${status === null ? "" : ` ${String(status)}`}`;
    // ITS TEXT ONLY WHEN IT IS THE HOST'S API ERROR (review of #656).
    const hostError = api || status !== null || (rawSubtype === "success" && isError);
    const text = hostError && typeof o["result"] === "string" && o["result"].trim().length > 0 ? o["result"] : null;
    return { label, text, api, status };
  }
  return null;
}

/** The STDERR line that says why: the last one that reads as an error, else the last non-empty one. */
function stderrLine(stderr: string | undefined): string | null {
  const lines = (stderr ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const telling = lines.filter((l) => /error|denied|invalid|failed|not logged/i.test(l));
  return (telling.length > 0 ? telling[telling.length - 1] : lines[lines.length - 1]) as string;
}

/** Why a child failed: one scrubbed line, and whether it reads as a lost sign-in. */
export interface ChildFailure {
  readonly line: string;
  /**
   * A LOST SIGN-IN (R4 addendum, narrowed by review of #656): read only from
   * the host's own words — an API-error result (`terminal_reason:
   * "api_error"`, or an `api_error_status` of 401) or the STDERR line — never
   * from any other result's text.
   */
  readonly signedOut: boolean;
}

/**
 * WHY THE CHILD FAILED, or null: its `stream-json` API-error result when its
 * output was kept and ends in one; another error result's subtype and status,
 * with the STDERR line beside them; else the STDERR line. Null for a child
 * that exited 0, was stopped by a watchdog, or said nothing. Never throws.
 */
export function childFailure(result: Pick<ChildResult, "code" | "timedOut" | "output" | "stderr">): ChildFailure | null {
  try {
    if (result.timedOut || result.code === null || result.code === 0) return null;
    const said = resultError(result.output);
    const err = stderrLine(result.stderr);
    let raw: string | null;
    let signedOut = false;
    if (said !== null && said.text !== null) {
      raw = `${said.label}: ${said.text}`;
      signedOut = said.status === 401 || said.status === "401" || (said.api && signedOutShaped(said.text));
    } else if (said !== null) {
      raw = err === null ? said.label : `${said.label} — ${err}`;
      signedOut = said.status === 401 || said.status === "401" || (err !== null && signedOutShaped(err));
    } else {
      raw = err;
      signedOut = err !== null && signedOutShaped(err);
    }
    if (raw === null) return null;
    const line = oneLine(raw);
    return line.length === 0 ? null : { line, signedOut };
  } catch {
    return null;
  }
}

/** The line alone (`childFailure`), or null. */
export function childErrorText(result: Pick<ChildResult, "code" | "timedOut" | "output" | "stderr">): string | null {
  return childFailure(result)?.line ?? null;
}

/**
 * DOES A HOST ERROR READ AS A LOST SIGN-IN (2026-10-27, R4 addendum; narrowed
 * by review of #656)? "not logged in", "please run /login", "401
 * Unauthorized" or "unauthorized", `authentication_error`, an invalid API
 * key, an OAuth token expired, revoked or invalid. Not a bare "401" or a bare
 * "OAuth": "retry after 401 seconds" and "the OAuth flow" are not a sign-in.
 */
export function signedOutShaped(text: string | null | undefined): boolean {
  if (text === null || text === undefined || text.length === 0) return false;
  return /not logged in|logged out|please run \/login|\b401 unauthori[sz]ed|\bunauthori[sz]ed\b|authentication_error|authentication (failed|required)|invalid[ _-]?(x-)?api[ _-]?key|oauth[ _-]?token[^.]{0,40}\b(expired|revoked|invalid)\b|\btoken (has )?(expired|been revoked|revoked)\b/i.test(text);
}
