import { serve } from "@hono/node-server";
import { pathToFileURL } from "node:url";
import { closeAllWorkflowSessions } from "./domain/workflow/websocket-session.js";
import { closeDatabase } from "./infrastructure/database.js";
import { serverConfig } from "./infrastructure/runtime.js";
import { app, workflowWebSocketServer } from "./server/app.js";

export { app, workflowWebSocketServer } from "./server/app.js";

export function shutdownApiResources(): void {
  closeAllWorkflowSessions("server_shutdown");
  workflowWebSocketServer.close();
  closeDatabase();
}

function isMainModule(): boolean {
  const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
  return entryUrl === import.meta.url;
}

if (isMainModule()) {
  const server = serve(
    {
      fetch: app.fetch,
      websocket: { server: workflowWebSocketServer },
      hostname: serverConfig.host,
      port: serverConfig.port
    },
    (info) => {
      console.log(`API listening at http://${info.address}:${info.port}`);
    }
  );

  const shutdown = (): void => {
    shutdownApiResources();
    server.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
