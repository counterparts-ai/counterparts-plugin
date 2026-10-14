export const JSONRPC_VERSION = "2.0";
export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const LATEST_PROTOCOL_VERSION = PROTOCOL_VERSIONS[0];
export function negotiateVersion(requested) {
  if (typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}
export function success(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}
export function failure(id, code, message, data) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message, ...data === undefined ? {} : { data } }
  };
}
export function encodeMessage(message) {
  return `${JSON.stringify(message)}
`;
}
export function parseLine(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, code: ERROR_CODES.PARSE_ERROR, message: "invalid JSON", id: null };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: ERROR_CODES.INVALID_REQUEST, message: "not a JSON-RPC object", id: null };
  }
  const rec = raw;
  const id = typeof rec["id"] === "string" || typeof rec["id"] === "number" ? rec["id"] : null;
  if (rec["jsonrpc"] !== JSONRPC_VERSION) {
    return { ok: false, code: ERROR_CODES.INVALID_REQUEST, message: 'jsonrpc must be "2.0"', id };
  }
  if (typeof rec["method"] !== "string" || rec["method"].length === 0) {
    return { ok: false, code: ERROR_CODES.INVALID_REQUEST, message: "method must be a string", id };
  }
  const params = rec["params"];
  if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) {
    return { ok: false, code: ERROR_CODES.INVALID_PARAMS, message: "params must be an object", id };
  }
  const request = { jsonrpc: JSONRPC_VERSION, method: rec["method"] };
  if (id !== null)
    request.id = id;
  if (params !== undefined)
    request.params = params;
  return { ok: true, request };
}
export function isNotification(request) {
  return request.id === undefined;
}

export class FrameReader {
  buffer = "";
  feed(chunk) {
    this.buffer += chunk;
    const out = [];
    for (;; ) {
      const nl = this.buffer.indexOf(`
`);
      if (nl < 0)
        break;
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length > 0)
        out.push(line);
    }
    return out;
  }
  pending() {
    return this.buffer.length;
  }
}
