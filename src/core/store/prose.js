import { createHash } from "node:crypto";
import { StoreError } from "./errors.js";
export const PROSE_TYPES = ["memory", "episode", "schema"];
export const ID_PREFIX = {
  memory: "mem",
  episode: "epi",
  schema: "sch"
};
export function hashText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}
export function assertIdWellFormed(id) {
  if (typeof id !== "string" || id.length === 0 || /\s|\//.test(id)) {
    throw new StoreError("ID_MALFORMED", { id: String(id) });
  }
}
export function serializeMeta(meta, id) {
  assertJsonSafe(meta, id, "meta");
  try {
    return JSON.stringify(meta) ?? "{}";
  } catch (cause) {
    throw new StoreError("PROSE_META_UNSERIALIZABLE", {
      id,
      reason: String(cause.message ?? cause)
    });
  }
}
export function parseMeta(raw, id) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new StoreError("MEMORY_META_MALFORMED", {
      id,
      reason: String(cause.message ?? cause)
    });
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}
export function assertJsonSafe(value, id, path) {
  const t = typeof value;
  if (value === null || t === "string" || t === "boolean")
    return;
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new StoreError("PROSE_META_UNSERIALIZABLE", { id, path, reason: "non-finite-number" });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, id, `${path}[${i}]`));
    return;
  }
  if (t === "object") {
    for (const [k, v] of Object.entries(value)) {
      assertJsonSafe(v, id, `${path}.${k}`);
    }
    return;
  }
  throw new StoreError("PROSE_META_UNSERIALIZABLE", { id, path, reason: `type-${t}` });
}
export function bodyForStorage(body, id) {
  if (typeof body !== "string") {
    throw new StoreError("PROSE_BODY_INVALID", { id, reason: "not-a-string" });
  }
  const stored = Buffer.from(body, "utf8").toString("utf8");
  if (stored.replace(/\0/g, "").trim().length === 0) {
    throw new StoreError("PROSE_BODY_INVALID", { id, reason: "empty" });
  }
  return stored;
}
