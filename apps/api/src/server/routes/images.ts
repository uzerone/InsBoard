import type { Hono } from "hono";
import {
  cancelGenerationTask,
  initializeGenerationTaskManager,
  readGenerationTaskRecord,
  startReferenceImageGenerationTask,
  startTextToImageGenerationTask
} from "../../domain/generation/generation-tasks.js";
import { deleteGenerationHistory } from "../../domain/generation/image-generation.js";
import { getGenerationHistory } from "../../domain/project/project-store.js";
import { ProviderError } from "../../infrastructure/providers/image-provider.js";
import { errorResponse, providerErrorJson } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseEditPayload, parseGeneratePayload } from "../validation/images.js";

export function registerImageRoutes(app: Hono): void {
  initializeGenerationTaskManager();

  app.post("/api/images/generate", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseGeneratePayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json({ record: startTextToImageGenerationTask(parsed.value) });
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.post("/api/images/edit", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseEditPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json({ record: await startReferenceImageGenerationTask(parsed.value) });
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.get("/api/generations/:id", (c) => {
    const generationId = c.req.param("id").trim();
    const record = generationId ? readGenerationTaskRecord(generationId) : undefined;
    if (!record) {
      return c.json(errorResponse("not_found", "Generation record not found."), 404);
    }

    return c.json({ record });
  });

  app.delete("/api/generations", (c) => {
    const deletedGenerationIds = deleteGenerationHistory();
    return c.json({ deletedGenerationIds, history: getGenerationHistory() });
  });

  app.delete("/api/generations/:id", (c) => {
    const generationId = c.req.param("id").trim();
    const record = generationId ? readGenerationTaskRecord(generationId) : undefined;
    if (!record) {
      return c.json(errorResponse("not_found", "Generation record not found."), 404);
    }
    if (record.status === "pending" || record.status === "running") {
      return c.json(errorResponse("generation_in_progress", "Cancel the generation before deleting its history."), 409);
    }

    const deletedGenerationIds = deleteGenerationHistory(generationId);
    return c.json({ deletedGenerationIds, history: getGenerationHistory() });
  });

  app.post("/api/generations/:id/cancel", (c) => {
    const generationId = c.req.param("id").trim();
    const record = generationId ? cancelGenerationTask(generationId) : undefined;
    if (!record) {
      return c.json(errorResponse("not_found", "Generation record not found."), 404);
    }

    return c.json({ record });
  });
}
