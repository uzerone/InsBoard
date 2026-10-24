import type { WSContext } from "hono/ws";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const dataDir = resolve("../../.codex-temp", `api-only-smoke-${process.pid}`);
process.env.DATA_DIR = dataDir;
process.env.OPENAI_API_KEY = "";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
mkdirSync(dataDir, { recursive: true });
const { db, closeDatabase } = await import("../src/infrastructure/database.js");
const { providerConfigs, codexOAuthTokens } = await import("../src/infrastructure/schema.js");
const { getProviderConfig, getAuthStatus, saveProviderConfig } = await import("../src/domain/providers/provider-config.js");
const { createConfiguredImageProvider, selectConfiguredImageProviderSource } = await import("../src/domain/providers/image-provider-selection.js");
const { app, workflowWebSocketServer } = await import("../src/server/app.js");
const { createWorkflowWebSocketEvents, closeAllWorkflowSessions } = await import("../src/domain/workflow/websocket-session.js");
try {
  for (const [path, method] of [
    ["/api/agent-config", "GET"], ["/api/agent-config", "PUT"],
    ["/api/agent-conversations", "GET"], ["/api/agent-conversations/old", "PUT"],
    ["/api/agent-skills", "GET"], ["/api/agent-skills/import", "POST"],
    ["/api/agent/ws", "GET"]
  ]) {
    assert.equal((await app.request(path, { method })).status, 404, `${method} ${path} is retired`);
  }
  const events: Array<{ type: string; code?: string; }> = [];
  const socket = { readyState: 1, send: (data: string) => events.push(JSON.parse(data)), close: () => { } } as unknown as WSContext;
  const session = createWorkflowWebSocketEvents();
  session.onOpen?.(new Event("open"), socket);
  assert.equal(events.at(-1)?.type, "connected");
  for (const type of ["user_message", "revise_plan"]) {
    session.onMessage?.(new MessageEvent("message", { data: JSON.stringify({ type, text: "No planning" }) }), socket);
    assert.equal(events.at(-1)?.code, "invalid_workflow_message");
  }
  session.onMessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "ping" }) }), socket);
  assert.equal(events.at(-1)?.type, "pong");
  session.onMessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "execute_plan", planId: "missing", runId: "test" }) }), socket);
  assert.equal(events.at(-1)?.code, "unknown_workflow_plan");
  const now = new Date().toISOString();
  db.insert(codexOAuthTokens).values({ id: "default", accessToken: "obsolete-test-token", refreshToken: "obsolete-test-refresh", createdAt: now, updatedAt: now }).run();
  assert.equal(getAuthStatus().provider, "none");
  assert.equal(selectConfiguredImageProviderSource(), undefined);
  await assert.rejects(createConfiguredImageProvider(), (error: { code?: string; }) => error.code === "missing_provider");
  db.update(providerConfigs).set({ sourceOrderJson: JSON.stringify(["local-openai", "codex", "env-openai"]) }).run();
  assert.deepEqual(getProviderConfig().sourceOrder, ["local-openai", "env-openai"]);
  assert.equal(getProviderConfig().sources.length, 2);
  assert.equal("codex" in getAuthStatus(), false);
  for (const action of ["device/start", "device/poll", "logout"]) {
    const result = await app.request(`/api/auth/codex/${action}`, { method: "POST" });
    assert.equal(result.status, 404);
  }
  const invalid = await app.request("/api/provider-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceOrder: ["env-openai", "local-openai", "codex"] }) });
  assert.equal(invalid.status, 400);
  const config = saveProviderConfig({ sourceOrder: ["local-openai", "env-openai"], localOpenAI: { apiKey: "test-key-only-never-sent", baseUrl: "http://127.0.0.1:1/v1" } });
  assert.equal(config.activeSource?.id, "local-openai");
  assert.equal(JSON.stringify(config).includes("test-key-only-never-sent"), false);
  assert.equal(getAuthStatus().provider, "openai");
  const { parseGeneratePayload, parseEditPayload } = await import("../src/server/validation/images.js");
  const { createOpenAIImageProvider } = await import("../src/infrastructure/providers/image-provider.js");
  const bodies: string[] = [];
  const mock = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    bodies.push(Buffer.concat(chunks).toString());
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ data: [{ b64_json: "dGVzdA==" }] }));
  });
  await new Promise<void>(resolve => mock.listen(0, "127.0.0.1", resolve));
  try {
    const address = mock.address();
    assert.ok(address && typeof address !== "string");
    const provider = createOpenAIImageProvider({ apiKey: "test-only", baseURL: `http://127.0.0.1:${address.port}/v1`, model: "legacy-default", timeoutMs: 1000 });
    const payload = { prompt: "Test model routing", presetId: "none", size: { width: 1024, height: 1024 }, quality: "medium", outputFormat: "png", count: 1 };
    for (const model of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "vendor/custom-model"]) {
      const parsed = parseGeneratePayload({ ...payload, model });
      assert.ok(parsed.ok);
      assert.equal((await provider.generate(parsed.value)).model, model);
      assert.equal(JSON.parse(bodies.at(-1)!).model, model);
      const edit = parseEditPayload({ ...payload, model, referenceImages: [{ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=" }] });
      assert.ok(edit.ok);
      assert.equal((await provider.edit(edit.value)).model, model);
      assert.ok(bodies.at(-1)!.includes(`name="model"\r\n\r\n${model}\r\n`));
    }
    const legacy = parseGeneratePayload(payload);
    assert.ok(legacy.ok);
    assert.equal((await provider.generate(legacy.value)).model, "legacy-default");
    for (const model of ["", "has spaces", "x".repeat(201), 7]) {
      const invalid = parseGeneratePayload({ ...payload, model });
      assert.ok(!invalid.ok);
    }
  } finally {
    mock.closeAllConnections();
    await new Promise<void>((resolve, reject) => mock.close(error => error ? reject(error) : resolve()));
  }
  console.log("API-only provider, legacy priority, secret masking and removed routes checks passed");
} finally {
  closeAllWorkflowSessions();
  workflowWebSocketServer.close();
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
}
