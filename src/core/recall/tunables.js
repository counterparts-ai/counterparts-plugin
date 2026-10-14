export const TUNABLES = {
  MIN_CUE_LENGTH: 3,
  MAX_CUES: 24,
  PER_CUE_FETCH: 24,
  CUE_FETCH_MIN_IDF: 0,
  AMBIGUOUS_WEIGHT: 0.5,
  CARRY_DECAY: 0.5,
  CUE_TF_SATURATION: 1,
  CUE_LENGTH_NORM: 0.5,
  CUE_LENGTH_ONE_SIDED: true,
  CUE_DOC_CAP: 3,
  SEMANTIC_WEIGHT: 1,
  SEMANTIC_SEED_FLOOR: 0.45,
  SEMANTIC_TOP_M: 8,
  SEMANTIC_BY_IDENTITY: {
    "potion-base-8M@256": { inline: { floor: 0.15, weight: 6 }, lagged: { floor: 0.05, weight: 1 } },
    "voyage-3-large": { inline: { floor: 0.45, weight: 1 }, lagged: { floor: 0.45, weight: 1 } }
  },
  ARRIVAL_WEIGHT: 0.15,
  SNR_GLOBAL: 1.6,
  SNR_STRONG: 2.5,
  FLOOR_GLOBAL_UNITS: 0.2,
  FLOOR_STRONG_BY_KIND_UNITS: {},
  FLOOR_STRONG_DEFAULT_UNITS: 4.5,
  MIN_CUE_FRACTION: 0.5,
  SAL_BAR_WEIGHT: 0.5,
  SAL_SORT_WEIGHT: 0.5,
  MAX_CANDIDATES: 24,
  COLD_START_MIN_STORE: 15,
  COLD_START_FLOOR_UNITS: 0.4,
  COLD_START_MAX_CANDIDATES: 3,
  MIN_BACKGROUND_SAMPLE: 3,
  NEAR_DUPLICATE: 0.85,
  MAX_SURFACED: 1,
  MAX_FOOTNOTES: 6,
  LINK_POINTERS_MAX: 2,
  LINK_POINTER_MIN_FRACTION: 0.05,
  SPREAD_SEEDS: 24,
  HOP_CEILING: 1,
  AFFECT_MIN_EMOTION: 0.7,
  AFFECT_REFRACTORY_TURNS: 2,
  MOOD_WINDOW_HOURS: 3,
  MOOD_MIN_STRENGTH: 0.3,
  MOOD_SAME_WEIGHT: 0,
  MOOD_CROSS_WEIGHT: 0,
  MOOD_VALENCE_SPAN: 0.5,
  MOOD_LOW_LOW_WEIGHT: 0.25,
  FEELING_CUE_UNITS: 4,
  FEELING_CANDIDATES_MAX: 6,
  BUDGET_BYTES: 2048,
  GIST_BYTES: 240,
  FOOTNOTE_TITLE_BYTES: 150,
  BUDGET_PRESSURE: 0.9,
  BUDGET_MS: 1200,
  MAX_SESSION_RECORDS: 200
};
export function withTunables(overrides = {}) {
  return { ...TUNABLES, ...overrides };
}
export function semanticTuning(t, identity, path) {
  const table = t.SEMANTIC_BY_IDENTITY;
  if (identity !== null) {
    const at = identity.lastIndexOf("@");
    const suffix = at > 0 ? identity.slice(at + 1) : "";
    const model = /^[1-9][0-9]*$/.test(suffix) ? identity.slice(0, at) : identity;
    const profile = Object.hasOwn(table, identity) ? table[identity] : Object.hasOwn(table, model) ? table[model] : undefined;
    if (profile !== undefined)
      return profile[path];
  }
  return { floor: t.SEMANTIC_SEED_FLOOR, weight: t.SEMANTIC_WEIGHT };
}
export function strongFloor(t, kind, unit) {
  return (t.FLOOR_STRONG_BY_KIND_UNITS[kind] ?? t.FLOOR_STRONG_DEFAULT_UNITS) * unit;
}
