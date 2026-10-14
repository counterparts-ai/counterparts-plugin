import { appendFileSync, existsSync } from "node:fs";
export const WRITE_UP_BY = ["next-session", "owner", "api"];
const GRANTS = new WeakMap;
export function grantWriteUp(buffer, access) {
  GRANTS.set(buffer, access);
}
function textFiles(access, scope) {
  const kinds = ["conversation", "jot", "assistant"];
  return [
    ...kinds.map((kind) => access.streamPath(scope, kind)),
    access.path(scope, "quarantine.jsonl"),
    ...access.claimFiles(scope)
  ];
}
export function recordWriteUp(buffer, input) {
  const access = GRANTS.get(buffer);
  if (access === undefined)
    throw new Error("WRITE_UP_UNGRANTED");
  if (access.observer) {
    access.mutate("writeup", () => {
      return;
    });
    return "OBSERVER";
  }
  if (!WRITE_UP_BY.includes(input.by))
    return "BAD_BY";
  if (!access.scopes().includes(input.scope) || !existsSync(access.scopeDir(input.scope))) {
    return "UNKNOWN_SCOPE";
  }
  const holds = textFiles(access, input.scope).some((file) => access.readLines(file).some((s) => s.session === input.session && typeof s.text === "string"));
  if (!holds)
    return "NO_TEXT";
  const record = { session: input.session, at: access.now(), by: input.by };
  const out = access.mutate("writeup", () => {
    appendFileSync(access.path(input.scope, "writeups.jsonl"), `${JSON.stringify(record)}
`, "utf8");
  });
  if (!out.ok)
    return out.reason === "OBSERVER" ? "OBSERVER" : "IO_FAILED";
  access.emit("remember.writeup", input.session, { by: input.by });
  return "RECORDED";
}
