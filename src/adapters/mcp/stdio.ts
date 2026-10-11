/**
 * The stdio pump: chunks in, framed responses out.
 *
 * Split from `bin/serve.ts` so the transport is testable without a process.
 * `serveStdio` takes any async iterable of string chunks and any write
 * function, which is what lets `test/mcp.test.ts` drive real JSON-RPC framing —
 * including a message split across two chunks — over a faked stdin.
 *
 * It never throws at the caller. A handler that throws becomes a JSON-RPC
 * INTERNAL_ERROR on the wire; a server that dies mid-session takes the host's
 * tool calls with it, and a memory layer is not entitled to do that to its host
 * (the same rule `claude-code/`'s hooks follow: never fail the session).
 */
import { FrameReader, ERROR_CODES, encodeMessage, failure, parseLine } from "./protocol.js";
import type { McpServer } from "./server.js";

export interface StdioOptions {
  /** Called once per outgoing message, already newline-framed. */
  write: (chunk: string) => void;
  /** Bytes left unframed at EOF — a truncated final write, worth knowing. */
  onTruncated?: (pending: number) => void;
}

export async function serveStdio(
  // Only `handle` is used, so a stand-in that answers the protocol and nothing
  // else (`stood-down.ts`) is served by the same pump.
  server: Pick<McpServer, "handle">,
  input: AsyncIterable<string | Uint8Array>,
  opts: StdioOptions,
): Promise<void> {
  const reader = new FrameReader();
  const decoder = new TextDecoder();
  for await (const chunk of input) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    for (const line of reader.feed(text)) {
      const parsed = parseLine(line);
      if (!parsed.ok) {
        opts.write(encodeMessage(failure(parsed.id, parsed.code, parsed.message)));
        continue;
      }
      let response;
      try {
        response = await server.handle(parsed.request);
      } catch (err) {
        const id = parsed.request.id;
        if (id === undefined) continue;
        opts.write(
          encodeMessage(
            failure(id, ERROR_CODES.INTERNAL_ERROR, String((err as Error).message ?? err)),
          ),
        );
        continue;
      }
      if (response !== null) opts.write(encodeMessage(response));
    }
  }
  if (reader.pending() > 0) opts.onTruncated?.(reader.pending());
}
