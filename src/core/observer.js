export function isObserver(stance) {
  if (stance === null || typeof stance !== "object")
    return true;
  const value = stance.observer;
  if (value === undefined)
    return false;
  if (typeof value !== "boolean")
    return true;
  return value;
}
