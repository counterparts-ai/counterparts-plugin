export const TUNABLES = {
  HEBB_RATE: 0.1,
  EDGE_WEAK_CREDIT: 0,
  EDGE_CAP: 1,
  EDGE_FLOOR: 0.02,
  MAX_EDGES_PER_NODE: 32,
  MAX_OUT_WEIGHT: 4,
  S_EDGE: 30,
  EDGE_DECAY_SHAPE: "exponential",
  HOPS: 2,
  HOP_DECAY: 0.5,
  FAN_NORMALIZATION: true,
  MAX_SPREAD_NODES: 64,
  SPREAD_MIN_FRACTION: 0.02,
  CONTIGUITY_RATE: 0.06,
  CONTIGUITY_WINDOW: 1,
  CONTIGUITY_BACKWARD: 0.5,
  CONTIGUITY_LAG_DECAY: 0.5,
  CONTIGUITY_BATCH_MS: 60000,
  WRITE_LINK_WEIGHT: 0.05,
  WRITE_LINK_TURNS: 1,
  WRITE_LINK_ASKED_MS: 0,
  WRITE_LINK_MAX: 4
};
export function withTunables(overrides = {}) {
  return { ...TUNABLES, ...overrides };
}
export function tierFactor(tier, t) {
  switch (tier) {
    case "referenced":
      return 1;
    case "surfaced":
      return t.EDGE_WEAK_CREDIT;
    case "footnoted":
    default:
      return 0;
  }
}
export function pairCredit(a, b, t) {
  return t.HEBB_RATE * tierFactor(a, t) * tierFactor(b, t);
}
