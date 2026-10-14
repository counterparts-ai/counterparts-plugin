import { createHash } from "node:crypto";
import { realpathDeep } from "../core/store/index.js";
import { expansionSalt, readExpansionSalt } from "./expansions.js";
export const STORE_ID_PREFIX = "st_";
export const STORE_ID_RE = /^st_[0-9a-f]{16}$/;
export function storeId(dir, opts = {}) {
  const salt = opts.mint === true ? expansionSalt(dir) : readExpansionSalt(dir);
  if (salt === null)
    return null;
  const real = realpathDeep(dir);
  return STORE_ID_PREFIX + createHash("sha256").update(`counterparts-store\x00${salt}\x00${real}`, "utf8").digest("hex").slice(0, 16);
}
export function storeMarker(dir) {
  const id = storeId(dir, { mint: true });
  return id === null ? "" : `<!-- counterparts:store id=${id} -->`;
}
