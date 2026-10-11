/**
 * JSON-RPC 2.0 over stdio — the wire, and nothing else.
 *
 * CONTRACT §5 G8: **wire-protocol framing is host trivia.** This file is where
 * that triviality is allowed to live, and it is deliberately the only file in
 * this directory that knows what a `jsonrpc` field is. `server.ts` handles
 * *messages*; `tools.ts` describes *tools*; neither of them can be broken by a
 * transport change.
 *
 * Hand-rolled, no SDK (constitution line 10, and the zero-dep default). The
 * stdio transport MCP specifies is newline-delimited JSON — one complete JSON
 * object per line, no Content-Length headers (that is LSP, a different wire).
 * A message may arrive split across chunk boundaries, so framing is a small
 * state machine rather than a `split("\n")` per chunk.
 *
 * Two rules that are behaviour, not framing, and are therefore stated here once:
 *
 *   1. A **notification** (no `id`) is answered with nothing, ever. A server
 *      that replies to a notification desynchronizes a client that is not
 *      reading for one.
 *   2. **JSON-RPC errors are for protocol faults** — bad JSON, unknown method,
 *      malformed params. A tool that ran and refused is a SUCCESSFUL response
 *      carrying `isError: true`, because the refusal is the tool's answer and
 *      the model is supposed to read it (scar §2.4: a stood-down tool must be
 *      distinguishable from a broken one — that only works if the stand-down
 *      arrives as content the model can read).
 */

export const JSONRPC_VERSION = "2.0";

/** JSON-RPC's own codes. Nothing memory-shaped belongs in this list. */
export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * Protocol revisions this server knows how to speak, newest first. Version
 * negotiation ECHOES a version the client asked for when we support it, and
 * answers with our newest when we do not — never a hard failure on an unknown
 * string, which would make a newer client unable to talk to an older server for
 * no reason (the client decides whether our answer is acceptable).
 */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL_VERSION = PROTOCOL_VERSIONS[0];

export type Id = string | number;

export interface Request {
  jsonrpc: string;
  /** Absent ⇒ a notification: answered with nothing. */
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

export interface SuccessResponse {
  jsonrpc: string;
  id: Id;
  result: Record<string, unknown>;
}

export interface ErrorResponse {
  jsonrpc: string;
  id: Id | null;
  error: { code: number; message: string; data?: Record<string, unknown> };
}

export type Response = SuccessResponse | ErrorResponse;

export function negotiateVersion(requested: unknown): string {
  if (typeof requested === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

export function success(id: Id, result: Record<string, unknown>): SuccessResponse {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function failure(
  id: Id | null,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): ErrorResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/** One message, one line. The trailing newline IS the frame. */
export function encodeMessage(message: Response | Request): string {
  return `${JSON.stringify(message)}\n`;
}

export type ParsedLine =
  | { ok: true; request: Request }
  | { ok: false; code: number; message: string; id: Id | null };

/**
 * Parse one framed line into a request. Structural validation only: whether the
 * METHOD exists and whether its params make sense is the dispatcher's business.
 */
export function parseLine(line: string): ParsedLine {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, code: ERROR_CODES.PARSE_ERROR, message: "invalid JSON", id: null };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: ERROR_CODES.INVALID_REQUEST, message: "not a JSON-RPC object", id: null };
  }
  const rec = raw as Record<string, unknown>;
  const id =
    typeof rec["id"] === "string" || typeof rec["id"] === "number" ? (rec["id"] as Id) : null;
  if (rec["jsonrpc"] !== JSONRPC_VERSION) {
    return { ok: false, code: ERROR_CODES.INVALID_REQUEST, message: "jsonrpc must be \"2.0\"", id };
  }
  if (typeof rec["method"] !== "string" || rec["method"].length === 0) {
    return { ok: false, code: ERROR_CODES.INVALID_REQUEST, message: "method must be a string", id };
  }
  const params = rec["params"];
  if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) {
    return { ok: false, code: ERROR_CODES.INVALID_PARAMS, message: "params must be an object", id };
  }
  const request: Request = { jsonrpc: JSONRPC_VERSION, method: rec["method"] };
  if (id !== null) request.id = id;
  if (params !== undefined) request.params = params as Record<string, unknown>;
  return { ok: true, request };
}

/** True for a message that must be answered with nothing at all. */
export function isNotification(request: Request): boolean {
  return request.id === undefined;
}

/**
 * The framing state machine: bytes in, complete lines out. A partial line is
 * held until its newline arrives; an empty line is not a message and is
 * dropped rather than reported as a parse error.
 */
export class FrameReader {
  private buffer = "";

  feed(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    for (;;) {
      const nl = this.buffer.indexOf("\n");
      if (nl < 0) break;
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length > 0) out.push(line);
    }
    return out;
  }

  /** Bytes held back awaiting a newline. Non-zero at EOF means a truncated write. */
  pending(): number {
    return this.buffer.length;
  }
}
