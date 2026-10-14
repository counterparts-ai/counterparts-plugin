import { FrameReader, ERROR_CODES, encodeMessage, failure, parseLine } from "./protocol.js";
export async function serveStdio(server, input, opts) {
  const reader = new FrameReader;
  const decoder = new TextDecoder;
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
        if (id === undefined)
          continue;
        opts.write(encodeMessage(failure(id, ERROR_CODES.INTERNAL_ERROR, String(err.message ?? err))));
        continue;
      }
      if (response !== null)
        opts.write(encodeMessage(response));
    }
  }
  if (reader.pending() > 0)
    opts.onTruncated?.(reader.pending());
}
