/**
 * A SERVER THAT IS THERE AND OFFERS NOTHING — the plugin's MCP server when the
 * npm install's own `counterparts` server is already registered in this host
 * (`adapters/plugin.ts#mcpGate`).
 *
 * Why not just exit: Claude Code reports a server that exited at start-up as
 * "failed", which is a broken tool rather than a deliberate stand-down (scar
 * §2.4: a stood-down tool must be distinguishable from a broken one). So it
 * answers `initialize` with no tool capability worth having, lists no tools,
 * and puts the reason in `instructions` — the one field of a server with no
 * tools that a model, and `/mcp`, will show.
 *
 * It opens no store, reads no configuration and writes nothing: a stood-down
 * server that touched the memory would be the double-write this exists to
 * prevent.
 */
import { ERROR_CODES, failure, negotiateVersion, success } from "./protocol.js";
import type { Request, Response } from "./protocol.js";
import { SERVER_NAME, SERVER_VERSION } from "./server.js";

export interface StoodDownServer {
  handle(request: Request): Promise<Response | null>;
}

export function stoodDownServer(instructions: string): StoodDownServer {
  return {
    handle(request: Request): Promise<Response | null> {
      const id = request.id;
      // A notification is answered with nothing, ever (`protocol.ts`).
      if (id === undefined) return Promise.resolve(null);
      const params = request.params ?? {};
      switch (request.method) {
        case "initialize":
          return Promise.resolve(
            success(id, {
              protocolVersion: negotiateVersion(params["protocolVersion"]),
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
              instructions,
            }),
          );
        case "tools/list":
          return Promise.resolve(success(id, { tools: [] }));
        case "ping":
          return Promise.resolve(success(id, {}));
        default:
          return Promise.resolve(failure(id, ERROR_CODES.METHOD_NOT_FOUND, `${request.method}: this server is standing down. ${instructions}`));
      }
    },
  };
}
