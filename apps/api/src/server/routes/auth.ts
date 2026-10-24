import type { Hono } from "hono";
import { getAuthStatus } from "../../domain/providers/provider-config.js";

export function registerAuthRoutes(app: Hono): void {
  app.get("/api/auth/status", (c) => c.json(getAuthStatus()));
}
