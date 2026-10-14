import { EXPLICIT_DIR_ARMING_VALUES, EXPLICIT_DIR_DISARMING_VALUES } from "../core/store/index.js";
export const OBSERVER_ENV = "COUNTERPARTS_OBSERVER";
export const OWNER_ENV = "COUNTERPARTS_OWNER";
export function readEnvSwitch(env, name) {
  const raw = (env[name] ?? "").trim();
  if (raw.length === 0)
    return { state: "absent" };
  const word = raw.toLowerCase();
  if (EXPLICIT_DIR_ARMING_VALUES.includes(word))
    return { state: "on" };
  if (EXPLICIT_DIR_DISARMING_VALUES.includes(word))
    return { state: "off" };
  return { state: "malformed", value: raw };
}
export function observerFromEnv(env, flag = false, name = OBSERVER_ENV) {
  const reading = readEnvSwitch(env, name);
  if (flag)
    return { on: true, malformed: reading.state === "malformed" ? reading.value : null };
  switch (reading.state) {
    case "on":
      return { on: true, malformed: null };
    case "malformed":
      return { on: true, malformed: reading.value };
    default:
      return { on: false, malformed: null };
  }
}
export function ownerFromEnv(env, flag = false, name = OWNER_ENV) {
  const reading = readEnvSwitch(env, name);
  if (flag)
    return { on: true, malformed: reading.state === "malformed" ? reading.value : null };
  return {
    on: reading.state === "on",
    malformed: reading.state === "malformed" ? reading.value : null
  };
}
export function unreadableStanceLine(name, value, resolvedTo) {
  return `[counterparts] ${name} is set to '${value}', which is not a value this reads — ` + `${resolvedTo}. It takes ${EXPLICIT_DIR_ARMING_VALUES.join(", ")} for yes and ` + `${EXPLICIT_DIR_DISARMING_VALUES.join(", ")} for no (case and surrounding whitespace ignored).`;
}
