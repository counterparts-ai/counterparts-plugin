import { StaticEmbedderError, loadStaticModel, resolveStaticWeights } from "../../core/embed/static.js";
import { hashText } from "../../core/store/index.js";
import { bundledModelDir } from "../runtime.js";
export function openEmbedder(config, opts = {}) {
  if (config.embedder?.enabled !== true)
    return null;
  if (config.observer === true)
    return null;
  return openStaticEmbedder(opts);
}
export function createStaticEmbedder(model, opts = {}) {
  const emit = opts.onEvent ?? (() => {});
  let hits = 0;
  let misses = 0;
  const identity = { model: model.model, dim: model.dim, rebuild: "inline" };
  let last = null;
  const compute = (text) => {
    if (last !== null && last.text === text) {
      hits += 1;
      return [...last.vec];
    }
    const vec = model.embed(text);
    last = vec === null ? null : { text, vec: [...vec] };
    if (vec === null) {
      misses += 1;
      emit("embed.static.empty", { hash: hashText(text), model: model.model });
    } else
      hits += 1;
    return vec;
  };
  const embed = Object.assign(compute, { identity });
  return {
    model: model.model,
    kind: "static",
    ...opts.weights === undefined ? {} : { weights: opts.weights },
    embed,
    vector: async (text) => text.length === 0 ? null : compute(text),
    warm: async (texts) => texts.filter((t) => t.length > 0).length,
    stats: () => ({ hits, misses, cached: 0, fetched: 0, failed: 0, lastFailures: [] })
  };
}
export function unavailableStaticEmbedder(code) {
  const embed = () => null;
  return {
    model: "static",
    kind: "static",
    unavailable: code,
    embed,
    vector: async () => null,
    warm: async () => 0,
    stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 0, failed: 0, lastFailures: [] })
  };
}
export function openStaticEmbedder(opts = {}) {
  const emit = opts.onEvent ?? (() => {});
  const bundled = bundledModelDir();
  const found = resolveStaticWeights({
    ...opts.weightsDir === undefined ? {} : { dir: opts.weightsDir },
    ...opts.env === undefined ? {} : { env: opts.env },
    ...bundled === undefined ? {} : { packageDir: bundled }
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
      ms: Math.round(model.loadMs)
    });
    return createStaticEmbedder(model, {
      weights: found.source,
      ...opts.onEvent === undefined ? {} : { onEvent: opts.onEvent }
    });
  } catch (err) {
    const code = err instanceof StaticEmbedderError ? err.code : "LOAD_FAILED";
    emit("embed.refused", { code, kind: "static", source: found.source });
    return unavailableStaticEmbedder(code);
  }
}
