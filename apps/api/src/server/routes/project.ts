import type { Hono } from "hono";
import {
  getProjectState,
  ProjectSnapshotOverwriteRejectedError,
  ProjectStoreUnavailableError,
  saveProjectSnapshot
} from "../../domain/project/project-store.js";
import { errorResponse } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { logProjectSaveRejected, parseProjectPayload } from "../validation/project.js";

export function registerProjectRoutes(app: Hono): void {
  app.get("/api/project", (c) => {
    try {
      return c.json(getProjectState());
    } catch (error) {
      if (error instanceof ProjectStoreUnavailableError) {
        return c.json(
          errorResponse(
            error.code,
            "Saved project data could not be read safely. Stop editing and restore from a backup before continuing."
          ),
          503
        );
      }

      throw error;
    }
  });

  app.put("/api/project", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      logProjectSaveRejected(payload.error, c.req.raw);
      return c.json(payload.error, 400);
    }

    const parsed = parseProjectPayload(payload.value);
    if (!parsed.ok) {
      logProjectSaveRejected(parsed.error, c.req.raw);
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(saveProjectSnapshot(parsed.value));
    } catch (error) {
      if (error instanceof ProjectSnapshotOverwriteRejectedError) {
        return c.json(
          errorResponse(
            error.code,
            "Refusing to overwrite a non-empty saved canvas with an empty snapshot. Reload the project before saving."
          ),
          409
        );
      }

      if (error instanceof ProjectStoreUnavailableError) {
        return c.json(
          errorResponse(
            error.code,
            "Saved project data could not be read safely. Stop editing and restore from a backup before continuing."
          ),
          503
        );
      }

      throw error;
    }
  });
}
