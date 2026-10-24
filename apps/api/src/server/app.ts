import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { relative } from "node:path";
import { WebSocketServer } from "ws";
import { runtimePaths } from "../infrastructure/runtime.js";
import { errorResponse } from "./http/errors.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerGalleryRoutes } from "./routes/gallery.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerProjectArchiveRoutes } from "./routes/project-archive.js";
import { registerProjectRoutes } from "./routes/project.js";
import { registerProviderConfigRoutes } from "./routes/provider-config.js";
import { registerWorkflowWebSocketRoutes } from "./routes/workflow-ws.js";

export const workflowWebSocketServer = new WebSocketServer({ noServer: true });
export const app = createApp();

export function createApp(): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    console.error(error);
    return c.json(errorResponse("internal_error", "Internal server error."), 500);
  });

  registerCoreRoutes(app);
  registerAuthRoutes(app);
  registerProviderConfigRoutes(app);
  registerProjectRoutes(app);
  registerProjectArchiveRoutes(app);
  registerGalleryRoutes(app);
  registerAssetRoutes(app);
  registerImageRoutes(app);
  registerWorkflowWebSocketRoutes(app);

  const webDistRoot = relative(process.cwd(), runtimePaths.webDistDir) || ".";

  app.get("/api/*", (c) => c.json(errorResponse("not_found", "Not found."), 404));

  app.get("*", serveStatic({ root: webDistRoot }));
  app.get(
    "*",
    serveStatic({
      root: webDistRoot,
      path: "index.html",
      onNotFound: () => {
        console.error(`Built web bundle not found at ${runtimePaths.webDistDir}. Run pnpm build before pnpm start.`);
      }
    })
  );

  return app;
}
