import { canonicalScope } from "../sessions.js";
export const EVENT_RING = 200;
export function hostScope(declared, env = process.env) {
  if (declared !== undefined && declared.length > 0) {
    return { scope: canonicalScope(declared), source: "flag" };
  }
  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof projectDir === "string" && projectDir.length > 0) {
    return { scope: canonicalScope(projectDir), source: "project" };
  }
  try {
    const cwd = process.cwd();
    if (cwd.length > 0)
      return { scope: canonicalScope(cwd), source: "cwd" };
  } catch {}
  return null;
}
export function resolveScope(declared, storeDir, env = process.env) {
  return hostScope(declared, env) ?? { scope: storeDir, source: "store" };
}
export const SEEN_SESSIONS = 32;
