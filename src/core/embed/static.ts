/**
 * `embed/static` — a sentence embedder that is a lookup table, with zero
 * dependencies and no network.
 *
 * A static model (model2vec's potion family, sentence-transformers'
 * `StaticEmbedding`) is one matrix: a row per WordPiece token. A text's vector
 * is the MEAN of its tokens' rows, L2-normalized. There is no attention, no
 * position, no runtime — so the whole "model" is a BERT basic tokenizer, a
 * greedy WordPiece, a row lookup and a division, and it runs in a hook-sized
 * process in well under a millisecond per text (measured numbers live in
 * `NOTES.md` and `docs/research/static-embedder-trial-2026-09-23.md`).
 *
 * **What it is for.** The semantic channel has been dark on every store whose
 * owner never set a Voyage key — which, on 2026-09-23, is every store including
 * the owner's. A static table closes that for free: nothing leaves the machine,
 * nothing is paid for, and the vectors can be recomputed at will, which is what
 * lets `store/`'s identity check rebuild them INLINE at open.
 *
 * **What it is not.** Bag-of-words: order and negation are gone ("the test
 * touched the live store" and "the test never touched the live store" land close
 * together). It is a second channel beside the lexical one, never a replacement
 * for it — `recall/activate.ts` fuses the two, and that is the only way it is
 * used.
 *
 * **Parity target: model2vec's `StaticModel.encode` defaults**, which is what
 * the potion weights were trained and evaluated under (checked token-for-token
 * and vector-for-vector against `tokenizers` 0.23.2 + `model2vec` 0.9.0 on 21
 * adversarial strings, both models — `test/static-embed.test.ts`):
 *
 *   - HF's added-vocabulary pass runs FIRST, on the raw text: the five BERT
 *     special tokens (`[PAD]` `[UNK]` `[CLS]` `[SEP]` `[MASK]`) match verbatim
 *     anywhere — inside a word too — and become their own ids. A memory that
 *     quotes `[MASK]` is one token to the model, not three.
 *   - HF `BertNormalizer` (clean_text, handle_chinese_chars, strip accents,
 *     lowercase — in that order), then `BertPreTokenizer` (split on whitespace
 *     and punctuation), then `WordPiece` (`##` continuation, 100-char words,
 *     greedy longest-match-first). No [CLS]/[SEP] are added around the text.
 *   - `[UNK]` ids are DROPPED before pooling (model2vec's own rule).
 *   - The text is cut to `maxTokens × medianTokenLength` characters before
 *     tokenizing, and the ids to `maxTokens` after — model2vec's `max_length =
 *     512` default. A bag of words has no window of its own; the cap is kept for
 *     parity, not because the arithmetic needs it.
 *   - Mean, then L2. model2vec returns a ZERO vector for a text with no known
 *     tokens; this returns NULL (see `embed`).
 *
 * One divergence, named rather than hidden: sentence-transformers'
 * `StaticEmbedding` (static-retrieval-mrl-en-v1's home) keeps `[UNK]` in its
 * mean where this drops it, as model2vec does. It moves only a text with an
 * unknown word in it, and only by that word's share of the mean.
 *
 * Host-agnostic: `node:fs` and `node:module` only, both of which bun and Node
 * provide. No `Bun.file`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { endianness } from "node:os";
import { dirname, join } from "node:path";

/** Where an explicit weights directory comes from when no option names one. */
export const STATIC_WEIGHTS_ENV = "COUNTERPARTS_STATIC_WEIGHTS_DIR";

/**
 * The npm package that carries the potion-base-8M table. Resolved from THIS
 * file's location, so an install that has the package beside `counterparts`
 * finds it with no configuration at all.
 */
export const STATIC_WEIGHTS_PACKAGE = "counterparts-model-potion";

export const MODEL_FILE = "model.safetensors";
export const VOCAB_FILE = "vocab.txt";

/** model2vec's `encode(max_length=512)` default. See the header. */
export const DEFAULT_MAX_TOKENS = 512;

/**
 * The tensor names this loader recognizes, in the order it tries them:
 * model2vec writes `embeddings`; sentence-transformers' `StaticEmbedding`
 * writes `embedding.weight`. One 2-D table either way.
 */
export const TENSOR_NAMES: readonly string[] = ["embeddings", "embedding.weight"];

/** HF `WordPiece.max_input_chars_per_word`, in code points. */
const MAX_WORD_CHARS = 100;
const UNK_TOKEN = "[UNK]";
const CONTINUATION = "##";
/**
 * The BERT special tokens, as HF's added vocabulary matches them: verbatim,
 * case-sensitive, unnormalized, anywhere in the raw text. Only the ones the
 * vocabulary actually holds are honored.
 */
const SPECIAL_TOKENS: readonly string[] = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"];
const SPECIAL_SPLIT = /(\[(?:PAD|UNK|CLS|SEP|MASK)\])/;

export type StaticRefusal =
  /** No weights directory: no option, no env var, no installed package. */
  | "NO_WEIGHTS"
  /** A named file is not there. */
  | "MISSING_FILE"
  /** The safetensors header does not parse, or points outside the file. */
  | "BAD_SAFETENSORS"
  /** No tensor under any of `TENSOR_NAMES`, or it is not 2-D. */
  | "NO_TENSOR"
  /** A dtype this loader does not decode (F32 and F16 only). */
  | "BAD_DTYPE"
  /** The vocabulary is empty or its size disagrees with the table's rows. */
  | "BAD_VOCAB"
  /** A requested `dim` slice that is not 1..table width. */
  | "BAD_DIM"
  /**
   * The weights directory's `package.json` declares a sha256 for a file and
   * the bytes on disk do not have it: a corrupted download, or a table swapped
   * under a package that still claims the old one. Refused, never loaded — a
   * table that is not what it says would share a store's cosines with rows of
   * another generation (§2.15).
   */
  | "HASH_MISMATCH"
  /** A big-endian host: safetensors is little-endian and typed arrays use the platform's order. */
  | "BIG_ENDIAN";

export class StaticEmbedderError extends Error {
  readonly code: StaticRefusal;
  readonly detail: Record<string, string | number>;
  constructor(code: StaticRefusal, detail: Record<string, string | number> = {}) {
    super(`${code}${Object.keys(detail).length > 0 ? ` ${JSON.stringify(detail)}` : ""}`);
    this.name = "StaticEmbedderError";
    this.code = code;
    this.detail = detail;
  }
}

export interface StaticModelOptions {
  /** The directory holding `model.safetensors` and `vocab.txt`. */
  readonly dir: string;
  /**
   * A DISPLAY name only. The identity is derived from the bytes (see
   * `StaticModel.model`), never from a name somebody chose — two directories
   * holding the same table must agree, and two tables must never share a name.
   * Defaults to `counterparts.model` in the directory's `package.json`, then to
   * the identity's own name.
   */
  readonly label?: string;
  /**
   * Keep only the first `dim` columns (a Matryoshka slice — meaningful for
   * static-retrieval-mrl-en-v1, whose leading dimensions were trained to stand
   * alone). Defaults to the table's full width.
   */
  readonly dim?: number;
  /** Token cap; see `DEFAULT_MAX_TOKENS`. */
  readonly maxTokens?: number;
}

/** A loaded table. Everything a caller needs, and one method that matters. */
export interface StaticModel {
  /**
   * The table's name AS DERIVED FROM ITS BYTES (review of #190, MAJOR 5): the
   * sha256 of `model.safetensors` and of `vocab.txt`, looked up in
   * `KNOWN_TABLES` (`potion-base-8M`, `static-retrieval-mrl-en-v1`), else
   * `static-<first 12 hex of their combined hash>`. The same bytes give the
   * same name whatever directory, symlink or package they are found through;
   * different bytes never share one.
   */
  readonly model: string;
  /** For people: the package's `counterparts.model`, else `model`. Never compared. */
  readonly label: string;
  /** sha256 of `model.safetensors` and `vocab.txt`, hex. Computed at every load (~10 ms for 30 MB). */
  readonly sha256: { readonly model: string; readonly vocab: string };
  /** The OUTPUT width (after any slice). */
  readonly dim: number;
  /** `<model>@<dim>` — what `store/` records in `cache_meta.embedder`. */
  readonly identity: string;
  readonly rows: number;
  /** The table's stored width, before any slice. */
  readonly width: number;
  readonly dtype: "F32" | "F16";
  readonly tensor: string;
  /** Wall time the load took, ms — reported, because a hook pays it every turn. */
  readonly loadMs: number;
  /** Characters kept before tokenizing: `maxTokens × medianTokenLength`. */
  readonly maxChars: number;
  readonly maxTokens: number;
  /**
   * Text in, unit vector out — or NULL when the text has no known token.
   *
   * Null, not model2vec's zero vector, because a zero row in box 3 is a
   * dim-N vector every cosine reads as 0.0 similarity: "a lie with a number on
   * it", the reason `store.Embedder` has a null arm at all.
   */
  embed(text: string): number[] | null;
  /** The ids `embed` pools, after the UNK drop and the cap. For parity tests. */
  tokenIds(text: string): number[];
}

// ═══════════════════════════════════════════════════════════════════════════
// The basic tokenizer: HF BertNormalizer + BertPreTokenizer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * clean_text, first half: NUL, U+FFFD, and every "other" code point
 * (`\p{C}` = Cc, Cf, Cs, Co, Cn) EXCEPT tab, newline and carriage return, which
 * HF counts as whitespace. So `\v`, `\f` and U+0085 are REMOVED, not spaced —
 * HF's rule, kept exactly, because a vertical tab joining two words is a
 * different token stream from a space between them.
 */
const CLEAN_REMOVE = /(?![\t\n\r])[\p{C}�]/gu;
/** clean_text, second half: every remaining whitespace code point becomes a space. */
const CLEAN_SPACE = /[\t\n\r\p{White_Space}]/gu;
/** handle_chinese_chars: HF's CJK ideograph ranges, each padded with spaces. */
const CJK =
  /[\u{4E00}-\u{9FFF}\u{3400}-\u{4DBF}\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B920}-\u{2CEAF}\u{F900}-\u{FAFF}\u{2F800}-\u{2FA1F}]/gu;
const NONSPACING_MARK = /\p{Mn}/gu;
/** Non-ASCII punctuation: Unicode general category P*. Symbols (S*) are NOT punctuation to BERT. */
const UNICODE_PUNCT = /\p{P}/u;

/** ASCII punctuation (`!`–`/`, `:`–`@`, `[`–`` ` ``, `{`–`~`), as a table. */
const ASCII_PUNCT: readonly boolean[] = (() => {
  const t: boolean[] = new Array<boolean>(128).fill(false);
  for (let c = 33; c <= 47; c++) t[c] = true;
  for (let c = 58; c <= 64; c++) t[c] = true;
  for (let c = 91; c <= 96; c++) t[c] = true;
  for (let c = 123; c <= 126; c++) t[c] = true;
  return t;
})();

function isPunct(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 128) return ASCII_PUNCT[cp] === true;
  return UNICODE_PUNCT.test(ch);
}

/**
 * Lowercase PER CODE POINT, as HF's `NormalizedString::lowercase` does. JS's
 * `toLowerCase` applies the Greek final-sigma rule in context (`ΣΑΣ` → `σας`);
 * Rust's per-char mapping does not (`σασ`), and the vocabulary was built from
 * the latter. The per-char path only runs when a capital sigma is present.
 */
function lowercase(text: string): string {
  if (!text.includes("Σ")) return text.toLowerCase();
  let out = "";
  for (const ch of text) out += ch.toLowerCase();
  return out;
}

/**
 * Normalize and pre-tokenize: the string pieces WordPiece will see. Exported
 * for the parity test, which compares it against HF `tokenizers` output
 * recorded once (`test/static-embed.test.ts`).
 */
export function basicTokenize(text: string): string[] {
  let t = text.replace(CLEAN_REMOVE, "").replace(CLEAN_SPACE, " ");
  t = t.replace(CJK, (c) => ` ${c} `);
  // strip_accents (HF: `strip_accents: null` follows `lowercase: true`), THEN
  // lowercase — HF's order.
  t = t.normalize("NFD").replace(NONSPACING_MARK, "");
  t = lowercase(t);
  const out: string[] = [];
  let cur = "";
  for (const ch of t) {
    if (ch === " ") {
      if (cur.length > 0) out.push(cur);
      cur = "";
    } else if (isPunct(ch)) {
      if (cur.length > 0) out.push(cur);
      out.push(ch);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * Greedy longest-match-first WordPiece over CODE POINTS (HF counts chars, not
 * UTF-16 units — an emoji is one char there and two units here). A word with
 * no full decomposition is ONE `unk` id, never a partial one: HF's `is_bad`.
 */
export function wordpiece(word: string, vocab: ReadonlyMap<string, number>, unk: number): number[] {
  const whole = vocab.get(word);
  if (whole !== undefined) return [whole];
  const chars = Array.from(word);
  if (chars.length > MAX_WORD_CHARS) return [unk];
  const ids: number[] = [];
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
    if (found < 0) return [unk];
    ids.push(found);
    start = end;
  }
  return ids;
}

// ═══════════════════════════════════════════════════════════════════════════
// safetensors, read directly
// ═══════════════════════════════════════════════════════════════════════════

interface TensorHeader {
  readonly dtype: string;
  readonly shape: readonly number[];
  readonly data_offsets: readonly [number, number];
}

interface Table {
  readonly tensor: string;
  readonly rows: number;
  readonly width: number;
  readonly dtype: "F32" | "F16";
  readonly data: Float32Array;
}

/**
 * The format is eight little-endian bytes of header length, a JSON header, and
 * raw little-endian tensor bytes. Typed arrays use the PLATFORM's byte order,
 * which is little-endian on every target this package runs on (x86-64, arm64);
 * a big-endian host would read garbage, and none exists in the support matrix.
 */
function readTable(buf: Uint8Array): Table {
  if (buf.byteLength < 8) throw new StaticEmbedderError("BAD_SAFETENSORS", { reason: "short-file" });
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = Number(view.getBigUint64(0, true));
  if (!Number.isSafeInteger(headerLen) || headerLen <= 0 || 8 + headerLen > buf.byteLength) {
    throw new StaticEmbedderError("BAD_SAFETENSORS", { reason: "header-length" });
  }
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + headerLen))) as Record<string, unknown>;
  } catch {
    throw new StaticEmbedderError("BAD_SAFETENSORS", { reason: "header-json" });
  }
  const name = TENSOR_NAMES.find((n) => header[n] !== undefined);
  if (name === undefined) throw new StaticEmbedderError("NO_TENSOR", { tried: TENSOR_NAMES.join(",") });
  const t = header[name] as TensorHeader;
  if (!Array.isArray(t.shape) || t.shape.length !== 2) {
    throw new StaticEmbedderError("NO_TENSOR", { tensor: name, reason: "not-2d" });
  }
  const [rows, width] = t.shape as [number, number];
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
  let data: Float32Array;
  if (t.dtype === "F32") {
    // ZERO-COPY when aligned — the file buffer IS the table. `readFileSync`
    // hands back a buffer of its own for a file this size, and safetensors pads
    // its header to eight bytes, so the view is the ordinary case and the copy
    // is the fallback.
    const at = buf.byteOffset + start;
    data =
      at % 4 === 0
        ? new Float32Array(buf.buffer, at, n)
        : new Float32Array(buf.slice(start, end).buffer, 0, n);
  } else {
    const at = buf.byteOffset + start;
    const halves =
      at % 2 === 0 ? new Uint16Array(buf.buffer, at, n) : new Uint16Array(buf.slice(start, end).buffer, 0, n);
    data = decodeF16(halves);
  }
  return { tensor: name, rows, width, dtype: t.dtype, data };
}

/** IEEE-754 binary16 → binary32, through a 65,536-entry table built once. */
let F16_TABLE: Float32Array | null = null;

function f16Table(): Float32Array {
  if (F16_TABLE !== null) return F16_TABLE;
  const table = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    table[h] =
      exp === 0
        ? sign * frac * 2 ** -24
        : exp === 31
          ? frac === 0
            ? sign * Infinity
            : Number.NaN
          : sign * (1 + frac / 1024) * 2 ** (exp - 15);
  }
  F16_TABLE = table;
  return table;
}

export function decodeF16(halves: Uint16Array): Float32Array {
  const table = f16Table();
  const out = new Float32Array(halves.length);
  for (let i = 0; i < halves.length; i++) out[i] = table[halves[i] ?? 0] ?? 0;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Loading, and finding what to load
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Where the weights are, and which rule chose them — explicit option first,
 * then `COUNTERPARTS_STATIC_WEIGHTS_DIR`, then the installed
 * `counterparts-model-potion` package (resolved from THIS module, the way any
 * dependency is). Null when none answers: "no static tier here" is a state, and
 * the caller names it.
 */
export function resolveStaticWeights(
  opts: { dir?: string; env?: Record<string, string | undefined>; packageDir?: string } = {},
): { dir: string; source: "option" | "env" | "package" } | null {
  if (opts.dir !== undefined && opts.dir.length > 0) return { dir: opts.dir, source: "option" };
  const fromEnv = (opts.env ?? process.env)[STATIC_WEIGHTS_ENV];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return { dir: fromEnv.trim(), source: "env" };
  // The package's directory when the caller already knows it — the single
  // compiled binary, which carries the package's files but no `node_modules`
  // for `require.resolve` to search (adapters/runtime.ts#bundledModelDir).
  if (opts.packageDir !== undefined && opts.packageDir.length > 0) return { dir: opts.packageDir, source: "package" };
  try {
    const require = createRequire(import.meta.url);
    return { dir: dirname(require.resolve(`${STATIC_WEIGHTS_PACKAGE}/package.json`)), source: "package" };
  } catch {
    return null;
  }
}

/**
 * The tables this package knows BY THEIR BYTES: `<sha256 of model.safetensors>:<sha256 of vocab.txt>`
 * → the name a store's tag carries. A table not listed here is named from its
 * hash (`static-<12 hex>`), so it still has a stable identity of its own — it is
 * only its human name that is missing.
 *
 * static-retrieval-mrl-en-v1's vocabulary is DERIVED (Hugging Face ships only
 * `tokenizer.json`): `model.vocab` sorted by id, one token per line, trailing
 * newline — `docs/research/static-embedder-trial-2026-09-23.md`.
 */
export const KNOWN_TABLES: ReadonlyMap<string, string> = new Map([
  [
    "f65d0f325faadc1e121c319e2faa41170d3fa07d8c89abd48ca5358d9a223de2:1394523a67ddd404a825428018c0582a6998bcfa044ecbcbf1f4d71adb94c61c",
    "potion-base-8M",
  ],
  [
    "164fc63ee9f9267be7378fcbd7df99d09788a2f45244c92aa99ae5a574925716:07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3",
    "static-retrieval-mrl-en-v1",
  ],
]);

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The weights directory's `package.json`, if it has one we can read: its
 * display name and the sha256s it DECLARES. A declaration is a promise the
 * loader checks (`HASH_MISMATCH`); a missing or unreadable file declares
 * nothing.
 */
function packageClaims(dir: string): { label: string | null; sha256: Record<string, string> } {
  const pkg = join(dir, "package.json");
  if (!existsSync(pkg)) return { label: null, sha256: {} };
  try {
    const parsed = JSON.parse(readFileSync(pkg, "utf8")) as {
      counterparts?: { model?: unknown; sha256?: unknown };
    };
    const named = parsed.counterparts?.model;
    const declared = parsed.counterparts?.sha256;
    const sha256: Record<string, string> = {};
    if (declared !== null && typeof declared === "object" && !Array.isArray(declared)) {
      for (const [file, hex] of Object.entries(declared as Record<string, unknown>)) {
        if (typeof hex === "string") sha256[file] = hex.toLowerCase();
      }
    }
    return { label: typeof named === "string" && named.length > 0 ? named : null, sha256 };
  } catch {
    return { label: null, sha256: {} };
  }
}

/** Python's `int(np.median(lengths))`: the mean of the two middles on an even count, truncated. */
function medianTokenLength(tokens: readonly string[]): number {
  if (tokens.length === 0) return 1;
  const lengths = tokens.map((t) => Array.from(t).length).sort((a, b) => a - b);
  const mid = lengths.length >> 1;
  const median =
    lengths.length % 2 === 1 ? (lengths[mid] ?? 1) : ((lengths[mid - 1] ?? 1) + (lengths[mid] ?? 1)) / 2;
  return Math.max(1, Math.trunc(median));
}

export function loadStaticModel(opts: StaticModelOptions): StaticModel {
  const t0 = performance.now();
  // Named, where CONTRACT G2 used to say "in a comment": safetensors is
  // little-endian and a Float32Array view reads in the platform's order.
  if (endianness() !== "LE") throw new StaticEmbedderError("BIG_ENDIAN", { endianness: endianness() });
  const modelPath = join(opts.dir, MODEL_FILE);
  const vocabPath = join(opts.dir, VOCAB_FILE);
  if (!existsSync(modelPath)) throw new StaticEmbedderError("MISSING_FILE", { file: MODEL_FILE });
  if (!existsSync(vocabPath)) throw new StaticEmbedderError("MISSING_FILE", { file: VOCAB_FILE });

  const modelBytes = readFileSync(modelPath);
  const vocabBytes = readFileSync(vocabPath);
  // IDENTITY FROM CONTENT (review of #190, MAJOR 5). Both files: a changed
  // vocabulary changes every token id, so it is as much the table as the
  // matrix is. Checked against whatever the directory's package.json DECLARES,
  // before a byte of the table is used.
  const sha = { model: sha256Hex(modelBytes), vocab: sha256Hex(vocabBytes) };
  const claims = packageClaims(opts.dir);
  for (const [file, got] of [
    [MODEL_FILE, sha.model],
    [VOCAB_FILE, sha.vocab],
  ] as const) {
    const declared = claims.sha256[file];
    if (declared !== undefined && declared !== got) {
      throw new StaticEmbedderError("HASH_MISMATCH", { file, declared: declared.slice(0, 12), found: got.slice(0, 12) });
    }
  }

  const table = readTable(modelBytes);

  // One token per line, line number = id, trailing whitespace trimmed — HF
  // `WordPiece::read_file`, including its last-line-wins on a duplicate (neither
  // real vocabulary has one). A trailing newline is not a token.
  const lines = vocabBytes.toString("utf8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const tokens = lines.map((l) => l.trimEnd());
  if (tokens.length === 0 || tokens.length !== table.rows) {
    throw new StaticEmbedderError("BAD_VOCAB", { vocab: tokens.length, rows: table.rows });
  }
  const vocab = new Map<string, number>();
  tokens.forEach((tok, i) => {
    if (tok.length > 0) vocab.set(tok, i);
  });
  const unk = vocab.get(UNK_TOKEN) ?? -1;

  const dim = opts.dim ?? table.width;
  if (!Number.isInteger(dim) || dim < 1 || dim > table.width) {
    throw new StaticEmbedderError("BAD_DIM", { dim, width: table.width });
  }
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxChars = maxTokens * medianTokenLength(tokens);
  const model =
    KNOWN_TABLES.get(`${sha.model}:${sha.vocab}`) ?? `static-${sha256Hex(`${sha.model}:${sha.vocab}`).slice(0, 12)}`;
  const label = opts.label ?? claims.label ?? model;
  const width = table.width;
  const data = table.data;

  const specials = new Map<string, number>();
  for (const tok of SPECIAL_TOKENS) {
    const id = vocab.get(tok);
    if (id !== undefined) specials.set(tok, id);
  }

  const tokenIds = (text: string): number[] => {
    // model2vec cuts the STRING before tokenizing (in code points). The
    // UTF-16 length bounds the code-point count from above, so the common
    // short text skips the split entirely.
    const clipped = text.length <= maxChars ? text : Array.from(text).slice(0, maxChars).join("");
    // The added-vocabulary pass: only a text holding a `[` can contain one.
    const segments = clipped.includes("[") ? clipped.split(SPECIAL_SPLIT) : [clipped];
    const ids: number[] = [];
    const push = (id: number): boolean => {
      if (id === unk) return false;
      ids.push(id);
      return ids.length >= maxTokens;
    };
    for (const segment of segments) {
      const special = specials.get(segment);
      if (special !== undefined) {
        if (push(special)) return ids;
        continue;
      }
      for (const word of basicTokenize(segment)) {
        for (const id of wordpiece(word, vocab, unk)) {
          if (push(id)) return ids;
        }
      }
    }
    return ids;
  };

  const embed = (text: string): number[] | null => {
    const ids = tokenIds(text);
    if (ids.length === 0) return null;
    // Float64 accumulation: the table is single precision, the sum need not be.
    const acc = new Float64Array(dim);
    for (const id of ids) {
      const row = id * width;
      for (let d = 0; d < dim; d++) acc[d] = (acc[d] ?? 0) + (data[row + d] ?? 0);
    }
    let norm = 0;
    for (let d = 0; d < dim; d++) norm += (acc[d] ?? 0) * (acc[d] ?? 0);
    norm = Math.sqrt(norm);
    if (!(norm > 0) || !Number.isFinite(norm)) return null;
    const out = new Array<number>(dim);
    for (let d = 0; d < dim; d++) out[d] = (acc[d] ?? 0) / norm;
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
    tokenIds,
  };
}
