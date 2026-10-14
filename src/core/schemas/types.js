export const SCHEMA_ROLES = ["entity", "belief", "current-state"];
export const BIRTH_KINDS = ["person", "entity", "skill", "place"];
export function isBirthKind(kind) {
  return BIRTH_KINDS.includes(kind);
}
