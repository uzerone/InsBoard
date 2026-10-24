import type { Hono } from "hono";
import {
  exportProjectArchive,
  importProjectArchive,
  MAX_ARCHIVE_BYTES,
  ProjectArchiveError
} from "../../domain/project/project-archive.js";
import { errorResponse } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseProjectPayload } from "../validation/project.js";

let importing = false;
export function registerProjectArchiveRoutes(app: Hono): void {
  app.post("/api/project/export", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) return c.json(payload.error, 400);
    const parsed = parseProjectPayload(payload.value);
    if (!parsed.ok) return c.json(parsed.error, 400);
    try {
      const bytes = await exportProjectArchive(JSON.parse(parsed.value.snapshotJson));
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/x-insboard", "Content-Disposition": `attachment; filename="InsBoard-${new Date().toISOString().slice(0, 10)}.idb"`, "Cache-Control": "no-store" } });
    } catch (error) {
      return c.json(errorResponse("project_archive_error", error instanceof ProjectArchiveError ? error.message : "The project could not be saved. Check available disk space."), 400);
    }
  });
  app.post("/api/project/import", async (c) => {
    if (importing) return c.json(errorResponse("project_archive_error", "Another project is opening. Please wait."), 409);
    importing = true;
    try {
      const reader = c.req.raw.body?.getReader();
      if (!reader) return c.json(errorResponse("project_archive_error", "The project file is empty."), 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_ARCHIVE_BYTES) { await reader.cancel(); return c.json(errorResponse("project_archive_error", "Project files cannot exceed 512 MB."), 413); }
        chunks.push(value);
      }
      const project = await importProjectArchive(Buffer.concat(chunks));
      return c.json(project);
    } catch (error) {
      return c.json(errorResponse("project_archive_error", error instanceof ProjectArchiveError ? error.message : "The project could not be opened. Your current project is preserved."), 400);
    } finally { importing = false; }
  });
}
