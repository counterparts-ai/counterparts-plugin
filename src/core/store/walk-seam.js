import { StoreError } from "./errors.js";
import { parseMeta } from "./prose.js";
import { rowTombstoned } from "./operational.js";
export function readProseWalking(store, id, row) {
  const r = row ?? store.row(id);
  if (r === undefined)
    throw new StoreError("ID_UNKNOWN", { id });
  if (r.id !== id)
    throw new StoreError("PROSE_PAYLOAD_MISMATCH", { expected: id, found: r.id });
  if (r.body.length === 0) {
    throw new StoreError("MEMORY_BODY_MISSING", { id, tombstoned: rowTombstoned(r) });
  }
  const doc = {
    id: r.id,
    type: r.type,
    learnedOn: r.learned_on,
    bornDay: r.birth_day,
    meta: parseMeta(r.meta, r.id),
    body: r.body
  };
  if (r.title !== null)
    doc.title = r.title;
  if (r.happened_on !== null)
    doc.happenedOn = r.happened_on;
  return doc;
}
