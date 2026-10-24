import { upgradeWebSocket } from "@hono/node-server";
import type { Hono } from "hono";
import { createWorkflowWebSocketEvents } from "../../domain/workflow/websocket-session.js";

export function registerWorkflowWebSocketRoutes(app: Hono): void {
  app.get(
    "/api/workflow/ws",
    upgradeWebSocket((c) => createWorkflowWebSocketEvents(c.req.query("connectionId"), c.req.query("runId")), {
      onError(error) {
        console.error("Workflow WebSocket error.", error);
      }
    })
  );
}
