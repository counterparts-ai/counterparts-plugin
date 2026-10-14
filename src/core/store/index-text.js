export const EMBED_FAILED_PREFIX = "embed.failed.";
export const EMBED_SKIP_AFTER = 3;
export function indexTextOf(title, body) {
  return [title ?? "", body].join(`
`);
}
export function indexText(doc) {
  return indexTextOf(doc.title, doc.body);
}
export function noVector(type, role) {
  return type === "schema" && (role === "handoff" || role === "page");
}
export function notForEmbedding(row) {
  if (row.type !== "schema")
    return false;
  try {
    return noVector(row.type, JSON.parse(row.meta)["role"]);
  } catch {
    return false;
  }
}
