export const TUNABLES = {
  NEAR_COLLISION: "token-containment",
  MAX_BIRTHS_PER_CHUNK: 1,
  NAME_MIN_CHARS: 2,
  MENTION_TIER: "referenced",
  FADE_REASON: "faded-by-decay",
  FADE: {
    CALENDAR_FLOOR_DAYS: 180,
    CALENDAR_FLOOR_DAYS_BY_KIND: { person: 365 },
    LIVED_DWELL_FACTOR_BY_KIND: { person: 2 }
  },
  BIRTH_TALLY: {
    MIN_MEMORIES: 3,
    MIN_DAYS: 2,
    LOWER_CASE_SHARE: 0.25
  },
  FADE_ANCHOR_PREFIX: "schemas.fade.anchor.",
  REVISED_REASON: "revised-by-pressure",
  REPLACED_REASON: "replaced-by-declaration"
};
