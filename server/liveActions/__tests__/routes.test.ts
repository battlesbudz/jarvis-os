import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import type { LiveActionReadService } from "../service";
import { registerLiveActionRoutes } from "../../routes/liveActionRoutes";

async function get(port: number, path: string, userId?: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: userId ? { "x-test-user": userId } : {},
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function main(): Promise<void> {
  const calls: string[] = [];
  const service: LiveActionReadService = {
    async getSnapshot(input) {
      calls.push(`snapshot:${input.userId}`);
      return { schemaVersion: 1, generatedAt: new Date().toISOString(), actions: [] };
    },
    async getDetail(userId, actionId) {
      calls.push(`detail:${userId}:${actionId}`);
      return null;
    },
  };
  const app = express();
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    if (userId) req.userId = userId;
    next();
  });
  registerLiveActionRoutes(app, { service, projectorEnabled: () => true });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  try {
    assert.equal((await get(port, "/api/live-actions")).status, 401);
    assert.equal((await get(port, "/api/live-actions?userId=other", "owner")).status, 200);
    assert.deepEqual(calls, ["snapshot:owner"], "the authenticated identity is the only snapshot owner input");
    assert.equal((await get(port, "/api/live-actions/action-from-other-user", "owner")).status, 404);
    assert.deepEqual(calls, ["snapshot:owner", "detail:owner:action-from-other-user"]);
    assert.equal((await get(port, "/api/live-actions?status=not-a-status", "owner")).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const disabledApp = express();
  disabledApp.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    if (userId) req.userId = userId;
    next();
  });
  registerLiveActionRoutes(disabledApp, { service, projectorEnabled: () => false });
  const disabledServer = http.createServer(disabledApp);
  await new Promise<void>((resolve) => disabledServer.listen(0, "127.0.0.1", resolve));
  const disabledPort = (disabledServer.address() as { port: number }).port;
  try {
    assert.equal((await get(disabledPort, "/api/live-actions", "owner")).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => disabledServer.close((error) => error ? reject(error) : resolve()));
  }
}

main().then(() => console.log("Live Action route flag and authorization assertions passed.")).catch((error) => {
  console.error(error);
  process.exit(1);
});
