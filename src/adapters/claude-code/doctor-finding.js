import { homedir } from "node:os";
import { Store } from "../../core/store/index.js";
export const SEVERITIES = ["red", "amber", "green"];
const WINDOWS = [0, 2, 7, 30, null];
const NEWEST_LIMIT = 4000;
export function finding(key, severity, title, detail, fix, data = {}) {
  return { key, severity, title, detail, fix, data };
}
export function off(key, title, detail, fix, data = {}) {
  return { key, severity: "amber", title, detail, fix, data, optional: true };
}
export function tilde(path) {
  const home = homedir();
  if (home.length === 0 || path === home)
    return path === home ? "~" : path;
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
export function newestRows(store, name, count, livedDay) {
  for (const back of WINDOWS) {
    const rows = store.eventLog(back === null ? { name, limit: NEWEST_LIMIT } : { name, sinceDay: Math.max(0, livedDay - back), limit: NEWEST_LIMIT });
    if (rows.length === 0)
      continue;
    if (rows.length >= NEWEST_LIMIT) {
      if (back !== null)
        continue;
      return { rows: [], unknown: true };
    }
    return { rows: rows.slice(-count), unknown: false };
  }
  return { rows: [], unknown: false };
}
export function undetermined(name) {
  return `newest ${name} row could not be determined: more than ${NEWEST_LIMIT} rows and no bounded window ` + "came back short, so the newest one was not read";
}
export function payloadOf(row) {
  if (row === undefined || row.payload === null)
    return {};
  try {
    const parsed = JSON.parse(row.payload);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
export function num(p, key) {
  const v = p[key];
  return typeof v === "number" ? v : null;
}
export function str(p, key) {
  const v = p[key];
  return typeof v === "string" ? v : null;
}
