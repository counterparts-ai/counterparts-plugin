import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { endianness } from "node:os";
import { dirname, join } from "node:path";
export const STATIC_WEIGHTS_ENV = "COUNTERPARTS_STATIC_WEIGHTS_DIR";
export const STATIC_WEIGHTS_PACKAGE = "counterparts-model-potion";
export const MODEL_FILE = "model.safetensors";
export const VOCAB_FILE = "vocab.txt";
export const DEFAULT_MAX_TOKENS = 512;
export const TENSOR_NAMES = ["embeddings", "embedding.weight"];
const MAX_WORD_CHARS = 100;
const UNK_TOKEN = "[UNK]";
const CONTINUATION = "##";
const SPECIAL_TOKENS = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"];
const SPECIAL_SPLIT = /(\[(?:PAD|UNK|CLS|SEP|MASK)\])/;

export class StaticEmbedderError extends Error {
  code;
  detail;
  constructor(code, detail = {}) {
    super(`${code}${Object.keys(detail).length > 0 ? ` ${JSON.stringify(detail)}` : ""}`);
    this.name = "StaticEmbedderError";
    this.code = code;
    this.detail = detail;
  }
}
const CLEAN_REMOVE = /(?![\t\n\r])[\p{C}�]/gu;
const CLEAN_SPACE = /[\t\n\r\p{White_Space}]/gu;
const CJK = /[\u{4E00}-\u{9FFF}\u{3400}-\u{4DBF}\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B920}-\u{2CEAF}\u{F900}-\u{FAFF}\u{2F800}-\u{2FA1F}]/gu;
const NONSPACING_MARK = /\p{Mn}/gu;
const UNICODE_PUNCT = /\p{P}/u;
const ASCII_PUNCT = (() => {
  const t = new Array(128).fill(false);
  for (let c = 33;c <= 47; c++)
    t[c] = true;
  for (let c = 58;c <= 64; c++)
    t[c] = true;
  for (let c = 91;c <= 96; c++)
    t[c] = true;
  for (let c = 123;c <= 126; c++)
    t[c] = true;
  return t;
})();
function isPunct(ch) {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 128)
    return ASCII_PUNCT[cp] === true;
  return UNICODE_PUNCT.test(ch);
}
function lowercase(text) {
  if (!text.includes("Σ"))
    return text.toLowerCase();
  let out = "";
  for (const ch of text)
    out += ch.toLowerCase();
  return out;
}
export function basicTokenize(text) {
  let t = text.replace(CLEAN_REMOVE, "").replace(CLEAN_SPACE, " ");
  t = t.replace(CJK, (c) => ` ${c} `);
  t = t.normalize("NFD").replace(NONSPACING_MARK, "");
  t = lowercase(t);
  const out = [];
  let cur = "";
  for (const ch of t) {
    if (ch === " ") {
      if (cur.length > 0)
        out.push(cur);
      cur = "";
    } else if (isPunct(ch)) {
      if (cur.length > 0)
        out.push(cur);
      out.push(ch);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0)
    out.push(cur);
  return out;
}
export function wordpiece(word, vocab, unk) {
  const whole = vocab.get(word);
  if (whole !== undefined)
    return [whole];
  const chars = Array.from(word);
  if (chars.length > MAX_WORD_CHARS)
    return [unk];
  const ids = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let found = -1;
    while (start < end) {
      const piece = chars.slice(start, end).join("");
      const id = vocab.get(start > 0 ? CONTINUATION + piece : piece);
      if (id !== undefined) {
        found = id;
        break;
      }
      end -= 1;
    }
    if (found < 0)
      return [unk];
    ids.push(found);
    start = end;
  }
  return ids;
}
function readTable(buf) {
  if (buf.byteLength < 8)
    throw new StaticEmbedderError("BAD_SAFETENSORS", { reason: "short-file" });
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = Number(view.getBigUint64(0, true));
  if (!Number.isSafeInteger(headerLen) || headerLen <= 0 || 8 + headerLen > buf.byteLength) {
    throw new StaticEmbedderError("BAD_SAFETENSORS", { reason: "header-length" });
  }
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + headerLen)));
  } catch {
    throw new StaticEmbedderError("BAD_SAFETENSORS", { reason: "header-json" });
  }
  const name = TENSOR_NAMES.find((n) => header[n] !== undefined);
  if (name === undefined)
    throw new StaticEmbedderError("NO_TENSOR", { tried: TENSOR_NAMES.join(",") });
  const t = header[name];
  if (!Array.isArray(t.shape) || t.shape.length !== 2) {
    throw new StaticEmbedderError("NO_TENSOR", { tensor: name, reason: "not-2d" });
  }
  const [rows, width] = t.shape;
  if (t.dtype !== "F32" && t.dtype !== "F16") {
    throw new StaticEmbedderError("BAD_DTYPE", { tensor: name, dtype: String(t.dtype) });
  }
  const bytesPer = t.dtype === "F32" ? 4 : 2;
  const [from, to] = t.data_offsets;
  const start = 8 + headerLen + from;
  const end = 8 + headerLen + to;
  if (end > buf.byteLength || to - from !== rows * width * bytesPer) {
    throw new StaticEmbedderError("BAD_SAFETENSORS", { reason: "data-offsets", tensor: name });
  }
  const n = rows * width;
  let data;
  if (t.dtype === "F32") {
    const at = buf.byteOffset + start;
    data = at % 4 === 0 ? new Float32Array(buf.buffer, at, n) : new Float32Array(buf.slice(start, end).buffer, 0, n);
  } else {
    const at = buf.byteOffset + start;
    const halves = at % 2 === 0 ? new Uint16Array(buf.buffer, at, n) : new Uint16Array(buf.slice(start, end).buffer, 0, n);
    data = decodeF16(halves);
  }
  return { tensor: name, rows, width, dtype: t.dtype, data };
}
let F16_TABLE = null;
function f16Table() {
  if (F16_TABLE !== null)
    return F16_TABLE;
  const table = new Float32Array(65536);
  for (let h = 0;h < 65536; h++) {
    const sign = h & 32768 ? -1 : 1;
    const exp = h >> 10 & 31;
    const frac = h & 1023;
    table[h] = exp === 0 ? sign * frac * 2 ** -24 : exp === 31 ? frac === 0 ? sign * (1 / 0) : Number.NaN : sign * (1 + frac / 1024) * 2 ** (exp - 15);
  }
  F16_TABLE = table;
  return table;
}
export function decodeF16(halves) {
  const table = f16Table();
  const out = new Float32Array(halves.length);
  for (let i = 0;i < halves.length; i++)
    out[i] = table[halves[i] ?? 0] ?? 0;
  return out;
}
export function resolveStaticWeights(opts = {}) {
  if (opts.dir !== undefined && opts.dir.length > 0)
    return { dir: opts.dir, source: "option" };
  const fromEnv = (opts.env ?? process.env)[STATIC_WEIGHTS_ENV];
  if (fromEnv !== undefined && fromEnv.trim().length > 0)
    return { dir: fromEnv.trim(), source: "env" };
  if (opts.packageDir !== undefined && opts.packageDir.length > 0)
    return { dir: opts.packageDir, source: "package" };
  try {
    const require = createRequire(import.meta.url);
    return { dir: dirname(require.resolve(`${STATIC_WEIGHTS_PACKAGE}/package.json`)), source: "package" };
  } catch {
    return null;
  }
}
export const KNOWN_TABLES = new Map([
  [
    "f65d0f325faadc1e121c319e2faa41170d3fa07d8c89abd48ca5358d9a223de2:1394523a67ddd404a825428018c0582a6998bcfa044ecbcbf1f4d71adb94c61c",
    "potion-base-8M"
  ],
  [
    "164fc63ee9f9267be7378fcbd7df99d09788a2f45244c92aa99ae5a574925716:07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3",
    "static-retrieval-mrl-en-v1"
  ]
]);
function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function packageClaims(dir) {
  const pkg = join(dir, "package.json");
  if (!existsSync(pkg))
    return { label: null, sha256: {} };
  try {
    const parsed = JSON.parse(readFileSync(pkg, "utf8"));
    const named = parsed.counterparts?.model;
    const declared = parsed.counterparts?.sha256;
    const sha256 = {};
    if (declared !== null && typeof declared === "object" && !Array.isArray(declared)) {
      for (const [file, hex] of Object.entries(declared)) {
        if (typeof hex === "string")
          sha256[file] = hex.toLowerCase();
      }
    }
    return { label: typeof named === "string" && named.length > 0 ? named : null, sha256 };
  } catch {
    return { label: null, sha256: {} };
  }
}
function medianTokenLength(tokens) {
  if (tokens.length === 0)
    return 1;
  const lengths = tokens.map((t) => Array.from(t).length).sort((a, b) => a - b);
  const mid = lengths.length >> 1;
  const median = lengths.length % 2 === 1 ? lengths[mid] ?? 1 : ((lengths[mid - 1] ?? 1) + (lengths[mid] ?? 1)) / 2;
  return Math.max(1, Math.trunc(median));
}
export function loadStaticModel(opts) {
  const t0 = performance.now();
  if (endianness() !== "LE")
    throw new StaticEmbedderError("BIG_ENDIAN", { endianness: endianness() });
  const modelPath = join(opts.dir, MODEL_FILE);
  const vocabPath = join(opts.dir, VOCAB_FILE);
  if (!existsSync(modelPath))
    throw new StaticEmbedderError("MISSING_FILE", { file: MODEL_FILE });
  if (!existsSync(vocabPath))
    throw new StaticEmbedderError("MISSING_FILE", { file: VOCAB_FILE });
  const modelBytes = readFileSync(modelPath);
  const vocabBytes = readFileSync(vocabPath);
  const sha = { model: sha256Hex(modelBytes), vocab: sha256Hex(vocabBytes) };
  const claims = packageClaims(opts.dir);
  for (const [file, got] of [
    [MODEL_FILE, sha.model],
    [VOCAB_FILE, sha.vocab]
  ]) {
    const declared = claims.sha256[file];
    if (declared !== undefined && declared !== got) {
      throw new StaticEmbedderError("HASH_MISMATCH", { file, declared: declared.slice(0, 12), found: got.slice(0, 12) });
    }
  }
  const table = readTable(modelBytes);
  const lines = vocabBytes.toString("utf8").split(`
`);
  if (lines.length > 0 && lines[lines.length - 1] === "")
    lines.pop();
  const tokens = lines.map((l) => l.trimEnd());
  if (tokens.length === 0 || tokens.length !== table.rows) {
    throw new StaticEmbedderError("BAD_VOCAB", { vocab: tokens.length, rows: table.rows });
  }
  const vocab = new Map;
  tokens.forEach((tok, i) => {
    if (tok.length > 0)
      vocab.set(tok, i);
  });
  const unk = vocab.get(UNK_TOKEN) ?? -1;
  const dim = opts.dim ?? table.width;
  if (!Number.isInteger(dim) || dim < 1 || dim > table.width) {
    throw new StaticEmbedderError("BAD_DIM", { dim, width: table.width });
  }
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxChars = maxTokens * medianTokenLength(tokens);
  const model = KNOWN_TABLES.get(`${sha.model}:${sha.vocab}`) ?? `static-${sha256Hex(`${sha.model}:${sha.vocab}`).slice(0, 12)}`;
  const label = opts.label ?? claims.label ?? model;
  const width = table.width;
  const data = table.data;
  const specials = new Map;
  for (const tok of SPECIAL_TOKENS) {
    const id = vocab.get(tok);
    if (id !== undefined)
      specials.set(tok, id);
  }
  const tokenIds = (text) => {
    const clipped = text.length <= maxChars ? text : Array.from(text).slice(0, maxChars).join("");
    const segments = clipped.includes("[") ? clipped.split(SPECIAL_SPLIT) : [clipped];
    const ids = [];
    const push = (id) => {
      if (id === unk)
        return false;
      ids.push(id);
      return ids.length >= maxTokens;
    };
    for (const segment of segments) {
      const special = specials.get(segment);
      if (special !== undefined) {
        if (push(special))
          return ids;
        continue;
      }
      for (const word of basicTokenize(segment)) {
        for (const id of wordpiece(word, vocab, unk)) {
          if (push(id))
            return ids;
        }
      }
    }
    return ids;
  };
  const embed = (text) => {
    const ids = tokenIds(text);
    if (ids.length === 0)
      return null;
    const acc = new Float64Array(dim);
    for (const id of ids) {
      const row = id * width;
      for (let d = 0;d < dim; d++)
        acc[d] = (acc[d] ?? 0) + (data[row + d] ?? 0);
    }
    let norm = 0;
    for (let d = 0;d < dim; d++)
      norm += (acc[d] ?? 0) * (acc[d] ?? 0);
    norm = Math.sqrt(norm);
    if (!(norm > 0) || !Number.isFinite(norm))
      return null;
    const out = new Array(dim);
    for (let d = 0;d < dim; d++)
      out[d] = (acc[d] ?? 0) / norm;
    return out;
  };
  return {
    model,
    label,
    sha256: sha,
    dim,
    identity: `${model}@${dim}`,
    rows: table.rows,
    width,
    dtype: table.dtype,
    tensor: table.tensor,
    loadMs: performance.now() - t0,
    maxChars,
    maxTokens,
    embed,
    tokenIds
  };
}
