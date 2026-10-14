import { ERROR_CODES, failure, negotiateVersion, success } from "./protocol.js";
import { SERVER_NAME, SERVER_VERSION } from "./server.js";
export function stoodDownServer(instructions) {
  return {
    handle(request) {
      const id = request.id;
      if (id === undefined)
        return Promise.resolve(null);
      const params = request.params ?? {};
      switch (request.method) {
        case "initialize":
          return Promise.resolve(success(id, {
            protocolVersion: negotiateVersion(params["protocolVersion"]),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            instructions
          }));
        case "tools/list":
          return Promise.resolve(success(id, { tools: [] }));
        case "ping":
          return Promise.resolve(success(id, {}));
        default:
          return Promise.resolve(failure(id, ERROR_CODES.METHOD_NOT_FOUND, `${request.method}: this server is standing down. ${instructions}`));
      }
    }
  };
}
