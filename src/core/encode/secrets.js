export const REDACTION_MARK = "[REDACTED:";
export const REDACTION_RE = /\[REDACTED:[a-z0-9-]+\]/g;
const NOT_REDACTED = "(?!\\[REDACTED:)";
const SCHEME_TAIL = "[a-z0-9+.-]{0,32}";
const AWS_SECRET_SHAPE = "(?:(?<![A-Za-z0-9/+=~.])|(?<=(?:^|[^A-Za-z0-9/+=~.])[A-Za-z_][A-Za-z0-9_]{0,40}=))" + NOT_REDACTED + "(?!/(?:Users|home|usr|var|tmp|opt|etc|private|Volumes|mnt|srv|root|Library|Applications|System)/)" + "(?=[A-Za-z0-9/+=]{0,39}[A-Z])(?=[A-Za-z0-9/+=]{0,39}[a-z])(?=[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=]))";
const AWS_SECRET_TOKEN_AFTER_ID = AWS_SECRET_SHAPE + "(?<=\\[REDACTED:aws-access-key-id\\][\\s\\S]{0,200})([A-Za-z0-9/+=]{40})";
const AWS_SECRET_TOKEN_BEFORE_ID = AWS_SECRET_SHAPE + "([A-Za-z0-9/+=]{40})(?=[\\s\\S]{0,200}\\[REDACTED:aws-access-key-id\\])";
const PLAIN_WORDS = /^(?:true|false|null|none|nil|yes|no|on|off|undefined)$/i;
const CODE_REFERENCE = /^[A-Za-z_$][A-Za-z_$]*(?:(?:(?:\.|::|->)[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]\n]{0,60}\]|\([^)\n]{0,80}\))+[[(]?|[[(])[,;]?$/;
const TYPE_NAME = /^(?:str|int|bytes|bool|float|dict|list|tuple|set|object|Any|None|SecretStr|SecretBytes|string|number|boolean|[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+)[,;]?$/;
const PASSWORD_NAME = /(?:password|passwd|pwd)$/i;
function isSetting(value, match, name) {
  const quoted = /^["']/.test(value);
  const v = quoted ? value.slice(1, -1) : value.replace(/[,;]+$/, "");
  if (PLAIN_WORDS.test(v))
    return true;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(v)) {
    return !(PASSWORD_NAME.test(name) && v.replace(/\D/g, "").length >= 6);
  }
  if (quoted)
    return false;
  if (CODE_REFERENCE.test(v))
    return true;
  const sep = /[:=]/.exec(match.slice(name.length))?.[0];
  return sep === ":" && TYPE_NAME.test(v);
}
const ASSIGNED_SEPARATOR = `(?:["']?\\s*[:=]|\\s*(?:\\|\\||\\?\\?))\\s*`;
const NOT_A_PLACEHOLDER = `(?!["']?\\[REDACTED:)`;
const PASSWORD_VALUE = `("[^"\\n]{4,}"|'[^'\\n]{4,}'|[^\\s"'\\n]{4,})`;
const CREDENTIAL_VALUE = `("[^"\\n]{4,}"|'[^'\\n]{4,}'|[^\\s"'\\n,;]{6,})`;
export const SECRET_FAMILIES = [
  {
    family: "private-key-block",
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    value: 0,
    why: "PEM/OpenSSH private key, whole block."
  },
  {
    family: "private-key-header",
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
    value: 0,
    why: "A truncated key block is still a key block: never let the header through."
  },
  {
    family: "aws-access-key-id",
    re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
    value: 0,
    why: "AWS key id prefixes."
  },
  {
    family: "aws-secret-access-key",
    re: new RegExp("(?<![A-Za-z0-9])((?:aws[_ \\t-]?secret[_ \\t-]?(?:access[_ \\t-]?)?key|secret[_ \\t-]?access[_ \\t-]?key)" + "(?:[ \\t]*\\[[^\\]\\n]{0,24}\\])?" + `(?:["']?\\]?[ \\t]*(?:[:=>]|,|\\|\\||\\?\\?)[ \\t]*["']?|["']?[ \\t]+["']?))` + NOT_REDACTED + "((?=[A-Za-z0-9/+=]{0,200}?[0-9/+])(?=[A-Za-z0-9/+=]{0,200}?[A-Za-z])[A-Za-z0-9/+=]{16,}" + "|(?=[A-Za-z]{0,39}[A-Z])(?=[A-Za-z]{0,39}[a-z])[A-Za-z]{40}(?![A-Za-z0-9/+=]))", "gi"),
    value: 2,
    propagate: true,
    why: "An AWS secret access key under its own name (env, credentials file, CLI, Dockerfile, code, JSON, XML)."
  },
  {
    family: "aws-secret-access-key",
    re: new RegExp(AWS_SECRET_TOKEN_AFTER_ID, "g"),
    value: 1,
    propagate: true,
    why: "An AWS secret access key written after its key id."
  },
  {
    family: "aws-secret-access-key",
    re: new RegExp(AWS_SECRET_TOKEN_BEFORE_ID, "g"),
    value: 1,
    propagate: true,
    why: "An AWS secret access key written before its key id."
  },
  {
    family: "google-api-key",
    re: /\bAIza[0-9A-Za-z_-]{30,}/g,
    value: 0,
    why: "The v1 incident's own shape (scar §7a): 3 live keys, 17 traces."
  },
  {
    family: "github-token",
    re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
    value: 0,
    why: "GitHub PAT / OAuth / refresh token prefixes."
  },
  {
    family: "gitlab-token",
    re: /\bglpat-[A-Za-z0-9_-]{16,}/g,
    value: 0,
    why: "GitLab personal access token."
  },
  {
    family: "npm-token",
    re: /\bnpm_[A-Za-z0-9]{30,}\b/g,
    value: 0,
    why: "npm automation token."
  },
  {
    family: "slack-token",
    re: /\bxox[abprse]-[A-Za-z0-9-]{10,}/g,
    value: 0,
    why: "Slack bot/user/app tokens."
  },
  {
    family: "stripe-key",
    re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
    value: 0,
    why: "Stripe secret/restricted keys."
  },
  {
    family: "model-provider-key",
    re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,
    value: 0,
    why: "Anthropic / OpenAI style `sk-` keys."
  },
  {
    family: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g,
    value: 0,
    why: "A signed JWT is a bearer credential."
  },
  {
    family: "bearer-token",
    re: new RegExp(`\\bBearer\\s+${NOT_REDACTED}([A-Za-z0-9._~+/-]{16,}=*)`, "gi"),
    value: 1,
    why: "Authorization header pasted into a note."
  },
  {
    family: "url-credentials",
    re: new RegExp(`\\b([a-z]${SCHEME_TAIL}://[^\\s/:@]+):${NOT_REDACTED}([^\\s/@]+)@`, "gi"),
    value: 2,
    why: "user:password@host — connection strings are the classic silent leak."
  },
  {
    family: "url-path-token",
    re: new RegExp(`\\b[a-z]${SCHEME_TAIL}://[^\\s"'<>]{0,512}/` + "(?:login|logout|auth|magic|magic-?link|token|invite|reset|verify|otp|signin|sso|session)" + `[a-z-]*(?:/[a-z-]{1,24})?/${NOT_REDACTED}` + "(?![a-z]+(?:-[a-z]+)*(?![A-Za-z0-9_~-]))" + "([A-Za-z0-9_~-]{12,})(?![A-Za-z0-9_~-])", "gi"),
    value: 1,
    why: "A magic-login / invite / reset link carries its bearer token as a URL path " + "segment. The 2026-08-26 replay review found a live staff login link minted " + "whole (its Gap A: `url-credentials` only matches user:pass@host). Scoped to " + "auth-shaped path words so a commit hash in a repo URL does not fire it."
  },
  {
    family: "assigned-credential",
    re: new RegExp("(?<![A-Za-z0-9])(pgpassword|password|passwd|pwd)\\b" + ASSIGNED_SEPARATOR + NOT_A_PLACEHOLDER + PASSWORD_VALUE, "gi"),
    value: 2,
    propagate: true,
    skip: isSetting,
    why: "A password under its own name, in any of the ways code and config spell it."
  },
  {
    family: "assigned-credential",
    re: new RegExp("(?<![A-Za-z0-9])(api[_-]?key|apikey|access[_-]?key|secret[_-]?key[_-]?base|secret[_-]?key|" + "client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|" + "bearer[_-]?token|secret|token|credentials?)\\b" + ASSIGNED_SEPARATOR + NOT_A_PLACEHOLDER + CREDENTIAL_VALUE, "gi"),
    value: 2,
    propagate: true,
    skip: isSetting,
    why: "The catch-all assignment form. Keeps the KEY NAME, redacts only the value: a name is not a claim (§3, the ops rule)."
  },
  {
    family: "assigned-credential",
    re: new RegExp("((?<=[a-z0-9])(?:Password|Passwd|Pwd|Secret|Token|ApiKey|SecretKey|AccessKey|PrivateKey|Credentials?)" + "|(?<![A-Za-z0-9])[A-Z][A-Z0-9]*(?:PASSWORD|PASSWD))\\b" + ASSIGNED_SEPARATOR + NOT_A_PLACEHOLDER + PASSWORD_VALUE, "g"),
    value: 2,
    propagate: true,
    skip: (value, match, name) => isSetting(value, match, name) || !/(?:password|passwd|pwd)$/i.test(name) && value.replace(/^["']|["']$/g, "").length < 6,
    why: "A credential under a camelCase or glued name."
  }
];
function redactOne(text, p, hit, captured) {
  const re = new RegExp(p.re.source, p.re.flags);
  return text.replace(re, (...args) => {
    const match = String(args[0] ?? "");
    const mark = `[REDACTED:${p.family}]`;
    if (p.value === 0) {
      hit();
      captured?.(match);
      return mark;
    }
    const raw = args[p.value];
    const val = typeof raw === "string" ? raw : "";
    const name = typeof args[1] === "string" ? args[1] : "";
    if (val.length > 0 && p.skip?.(val, match, name) === true)
      return match;
    hit();
    if (val.length === 0)
      return mark;
    captured?.(val);
    const at = match.lastIndexOf(val);
    if (at < 0)
      return mark;
    return `${match.slice(0, at)}${mark}${match.slice(at + val.length)}`;
  });
}
function unquote(value) {
  return /^(["']).*\1$/s.test(value) ? value.slice(1, -1) : value.replace(/[,;]+$/, "");
}
function propagatable(value) {
  if (value.length < 8 || /\s/.test(value))
    return false;
  return /\d/.test(value) || /[a-z]/.test(value) && /[A-Z]/.test(value) || /[^A-Za-z0-9._-]/.test(value);
}
const COPY_FENCE = /[A-Za-z0-9+]/;
function replaceLiteral(text, value, mark) {
  let out = "";
  let from = 0;
  for (let at = text.indexOf(value);at !== -1; at = text.indexOf(value, at + 1)) {
    if (at < from)
      continue;
    const before = at > 0 ? text[at - 1] ?? "" : "";
    const after = text[at + value.length] ?? "";
    if (COPY_FENCE.test(before) || COPY_FENCE.test(after))
      continue;
    out += text.slice(from, at) + mark();
    from = at + value.length;
  }
  return from === 0 ? text : out + text.slice(from);
}
export function stripRedactions(text) {
  return text.replace(new RegExp(REDACTION_RE.source, REDACTION_RE.flags), " ");
}
export function scanSecrets(text, site = "body") {
  const counts = new Map;
  const bump = (family) => {
    counts.set(family, (counts.get(family) ?? 0) + 1);
  };
  const spread = new Map;
  let out = text;
  for (const p of SECRET_FAMILIES) {
    out = redactOne(out, p, () => bump(p.family), p.propagate === true ? (value) => {
      const set = spread.get(p.family) ?? new Set;
      set.add(value);
      spread.set(p.family, set);
    } : undefined);
  }
  if (spread.size > 0) {
    const familyOf = new Map;
    for (const [family, values] of spread) {
      for (const value of values) {
        const bare = unquote(value);
        if (propagatable(bare))
          familyOf.set(bare, family);
      }
    }
    for (const [value, family] of [...familyOf.entries()].sort((a, b) => b[0].length - a[0].length)) {
      out = replaceLiteral(out, value, () => {
        bump(family);
        return `[REDACTED:${family}]`;
      });
    }
  }
  const findings = [...counts.entries()].map(([family, count]) => ({
    family,
    count,
    site
  }));
  const residue = stripRedactions(out).replace(/[^\p{L}\p{N}]/gu, "");
  return {
    redacted: out,
    findings,
    fired: findings.length > 0,
    emptyAfterRedaction: findings.length > 0 && residue.length === 0
  };
}
export function redactSecrets(text) {
  return scanSecrets(text).redacted;
}
export function containsSecret(text) {
  return scanSecrets(text).fired;
}
