declare module "@insboard/api" {
  import type { Hono } from "hono";
  import type { WebSocketServer } from "ws";

  export const app: Hono;
  export const workflowWebSocketServer: WebSocketServer;
  export function shutdownApiResources(): void;
}
