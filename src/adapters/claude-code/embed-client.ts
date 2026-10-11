/**
 * The embedder this host opens — the local STATIC table (potion-base-8M,
 * `core/embed/static.ts`), computed in-process: no key, no network, nothing
 * leaves the machine.
 *
 * Until 2026-09-24 this file also held a paid remote seat (Voyage) and its HTTP
 * client — the chunked, bisecting, per-chunk-isolated batch call that I33 was
 * fought over. The owner removed it with the other API key (keyless only), so
 * the static tier is the only embedder there is. What the paid seat taught
 * stays where it belongs: the store's embedder IDENTITY TAG
 * (`cache_meta.embedder`, `<model>@<dim>`) still means a store whose vectors
 * came from another model is never ranked against this one's, and the
 * backfill's give-up counter still retires a text the table cannot embed.
 *
 * `LiveEmbedder` stays the seam every composition root wires — the store's
 * sync `embed` and the novelty/recall `vectors` socket — so a test can still
 * inject its own.
 */
import { StaticEmbedderError, loadStaticModel, resolveStaticWeights } from "../../core/embed/static.js";
import type { StaticModel } from "../../core/embed/static.js";
import type { Embedder, EmbedderIdentity } from "../../core/store/index.js";
import { hashText } from "../../core/store/index.js";

import type { AdapterConfig, EmbedderKind } from "../config.js";
import { bundledModelDir } from "../runtime.js";

/** One fill's failure, named — what the worker's backfill row persists as `codes`. */
export interface ChunkFailure {
  /** Index of the chunk within the fill. */
  readonly chunk: number;
  /** Where this chunk started in the caller's `texts` array. */
  readonly from: number;
  readonly count: number;
  readonly code: string;
  readonly status?: number;
  /**
   * True when the failure is THIS ONE INPUT's — the item is the poison, not the
   * run. Only then may the backfill's give-up counter move (I33).
   */
  readonly item?: boolean;
}

/** Telemetry: ids, counts, hashes, codes. Never the text being embedded. */
export type EmitFn = (name: string, data: Record<string, string | number | boolean | null>) => void;

export interface LiveEmbedder {
  /** The model id — the generation these vectors belong to. */
  readonly model: string;
  /** Which embedder this is. Absent on an injected test embedder. */
  readonly kind?: EmbedderKind;
  /**
   * Set when this embedder was ASKED FOR and could not be built — today, a
   * static table whose weights were not found or would not load (`NO_WEIGHTS`,
   * `MISSING_FILE`, `HASH_MISMATCH`, …). Such an embedder answers every ask
   * with null, carries no identity (so the store never reconciles against it),
   * and the worker's backfill writes the code into its DURABLE row
   * (`reason: "embedder-unavailable"`) — which is how a refusal that happened
   * inside a hook process, whose `onEvent` goes nowhere, reaches doctor.
   */
  readonly unavailable?: string;
  /** For the static table: which rule found the weights (`option`, `env`, `package`). */
  readonly weights?: "option" | "env" | "package";
  /**
   * The sync face `Store.open({ embed })` takes. For the static table it
   * COMPUTES, in-process — which is what puts a vector on every memory at write
   * time, in whatever process writes (roadmap C1 step 4). It carries its
   * `identity`, and the store checks that against box 3's tag once, at open.
   */
  readonly embed: Embedder;
  /** Fetch (or serve) one vector. Returns null on any refusal — never throws. */
  vector(text: string): Promise<number[] | null>;
  /** Fetch many in one batched call. Returns how many landed. Never throws. */
  warm(texts: readonly string[]): Promise<number>;
  readonly stats: () => EmbedderStats;
}

export interface EmbedderStats {
  /** Sync lookups the cache answered. */
  readonly hits: number;
  /** Sync lookups it could not — the countable `not-exercised` (replay §4). */
  readonly misses: number;
  readonly cached: number;
  /** Texts fetched from somewhere else. Always 0 for the static table. */
  readonly fetched: number;
  /** Texts that got no vector, by any cause. */
  readonly failed: number;
  /**
   * The failures of the LAST fill, verbatim — reset at the start of each one.
   * The backfill persists their codes (I33: a row that said `failed: 64` with
   * no code was unreadable). Always empty for the static table.
   */
  readonly lastFailures: readonly ChunkFailure[];
}

/**
 * Build this host's embedder, or say — by returning null — that there is none.
 * Every composition root (`openAdapter`, `bin/runner.ts`, the MCP server) goes
 * through here, so "when is there an embedder" has ONE answer rather than one
 * per entrance.
 *
 * `embedder.enabled` is the switch (an absent block reads as on —
 * `config.ts#resolveEmbedder`); an observer opens none. There is one kind, the
 * static table.
 */
export function openEmbedder(config: AdapterConfig, opts: StaticEmbedderOptions = {}): LiveEmbedder | null {
  if (config.embedder?.enabled !== true) return null;
  // An instrument computes no vectors (docs/observer-mode.md, scar E7): an
  // observer's store takes no embedder at all.
  if (config.observer === true) return null;
  return openStaticEmbedder(opts);
}

// ═══════════════════════════════════════════════════════════════════════════
// The static tier
// ═══════════════════════════════════════════════════════════════════════════

export interface StaticEmbedderOptions {
  /** An explicit weights directory; else `COUNTERPARTS_STATIC_WEIGHTS_DIR`, else the package. */
  weightsDir?: string;
  /** The environment the weights directory is resolved from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  onEvent?: EmitFn;
}

/**
 * The static table behind the `LiveEmbedder` seam, so every composition root
 * wires `embedder.embed` into the store and `embedder` into the novelty seam.
 *
 * Its sync `embed` COMPUTES. `Store.put` calls it
 * at write time, so a memory gets its vector in the process that wrote it —
 * hook, worker, console — and the semantic channel is never dark for want of
 * a worker run (recall INTERFACE-GAPS §6's residue, for this tier). The
 * worker's backfill still runs, for rows written by a process that had no
 * embedder (the MCP server's `note` today, mcp INTERFACE-GAPS §7).
 *
 * `vector()` and `warm()` never touch a network and never throw; there is no
 * cache, because there is nothing to save by keeping one.
 */
export function createStaticEmbedder(
  model: StaticModel,
  opts: { onEvent?: EmitFn; weights?: "option" | "env" | "package" } = {},
): LiveEmbedder {
  const emit = opts.onEvent ?? ((): void => {});
  let hits = 0;
  let misses = 0;
  const identity: EmbedderIdentity = { model: model.model, dim: model.dim, rebuild: "inline" };
  const compute = (text: string): number[] | null => {
    const vec = model.embed(text);
    if (vec === null) {
      misses += 1;
      // A text with no known token (empty, all symbols, an unknown script) — a
      // counted miss, never a zero vector. The hash, never the text.
      emit("embed.static.empty", { hash: hashText(text), model: model.model });
    } else hits += 1;
    return vec;
  };
  const embed: Embedder = Object.assign(compute, { identity });
  return {
    model: model.model,
    kind: "static",
    ...(opts.weights === undefined ? {} : { weights: opts.weights }),
    embed,
    vector: async (text: string): Promise<number[] | null> => (text.length === 0 ? null : compute(text)),
    // Nothing to fetch ahead of time: the sync face computes when the store
    // asks, so warming would compute every vector twice. Reports how many of
    // the texts are non-empty — the ones the store's ask can answer.
    warm: async (texts: readonly string[]): Promise<number> => texts.filter((t) => t.length > 0).length,
    stats: (): EmbedderStats => ({ hits, misses, cached: 0, fetched: 0, failed: 0, lastFailures: [] }),
  };
}

/**
 * The static table that was asked for and is not here: every ask answers null,
 * no identity (the store never reconciles against it, so nothing in box 3 is
 * touched), and `unavailable` carries the refusal's code to the worker's
 * durable backfill row. Lexical recall is untouched.
 */
export function unavailableStaticEmbedder(code: string): LiveEmbedder {
  const embed: Embedder = (): number[] | null => null;
  return {
    model: "static",
    kind: "static",
    unavailable: code,
    embed,
    vector: async (): Promise<number[] | null> => null,
    warm: async (): Promise<number> => 0,
    stats: (): EmbedderStats => ({ hits: 0, misses: 0, cached: 0, fetched: 0, failed: 0, lastFailures: [] }),
  };
}

/**
 * Load the table and wrap it — or, when it cannot, say so by NAME twice: an
 * `embed.refused` event for whoever listens, and an UNAVAILABLE embedder whose
 * code the worker writes durably (review of #190, MAJOR 3: a hook's `onEvent`
 * goes nowhere, so the event alone reached no one). A missing table is not an
 * error worth a failed hook: the brain runs lexical-only, exactly as it did
 * before.
 */
export function openStaticEmbedder(opts: StaticEmbedderOptions = {}): LiveEmbedder {
  const emit = opts.onEvent ?? ((): void => {});
  const bundled = bundledModelDir();
  const found = resolveStaticWeights({
    ...(opts.weightsDir === undefined ? {} : { dir: opts.weightsDir }),
    ...(opts.env === undefined ? {} : { env: opts.env }),
    ...(bundled === undefined ? {} : { packageDir: bundled }),
  });
  if (found === null) {
    emit("embed.refused", { code: "NO_WEIGHTS", kind: "static" });
    return unavailableStaticEmbedder("NO_WEIGHTS");
  }
  try {
    const model = loadStaticModel({ dir: found.dir });
    emit("embed.static.loaded", {
      model: model.model,
      dim: model.dim,
      source: found.source,
      ms: Math.round(model.loadMs),
    });
    return createStaticEmbedder(model, {
      weights: found.source,
      ...(opts.onEvent === undefined ? {} : { onEvent: opts.onEvent }),
    });
  } catch (err) {
    const code = err instanceof StaticEmbedderError ? err.code : "LOAD_FAILED";
    emit("embed.refused", { code, kind: "static", source: found.source });
    return unavailableStaticEmbedder(code);
  }
}
