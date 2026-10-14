import { TUNABLES as PHYSICS } from "../physics/index.js";
export const TEMPORAL_MAX_TIER = "footnoted";
export const TUNABLES = {
  SALIENCE_FLOOR: 0.6,
  LEAD_DAYS: PHYSICS.HOLD_LEAD_DAYS,
  GRACE_DAYS: PHYSICS.HOLD_GRACE_DAYS,
  CUE_STRENGTH: 0.5,
  FIRES_PER_WINDOW: 2,
  HORIZON_ITEMS: 2,
  RAMP_OPEN: 0.4,
  RAMP_CLOSE: 0.2,
  FADED_STRENGTH: PHYSICS.PHI_PRUNE,
  MAX_SESSION_WINDOWS: 200,
  MONTH_STAGGER_DAYS: 7,
  HOLD_LAST_FIRE_FOR_AFTER: true
};
export function withTunables(overrides = {}) {
  return { ...TUNABLES, ...overrides };
}
