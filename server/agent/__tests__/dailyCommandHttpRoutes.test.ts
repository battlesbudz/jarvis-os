import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { and, eq } from "drizzle-orm";
import { agentJobs, orchestrationTraces, plans, userPreferences, users } from "@shared/schema";
import { buildMindTracePersistenceRecord } from "../mindTraceRecorder";

if (!process.env.DATABASE_URL) {
  console.log("server/agent/__tests__/dailyCommandHttpRoutes.test.ts: DATABASE_URL not set - skipped");
  process.exit(0);
}

async function requestJson(
  port: number,
  method: string,
  path: string,
  token: string,
  payload?: Record<string, unknown>,
) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
  };
}

async function run(): Promise<void> {
  const { db } = await import("../../db");
  const { authMiddleware, generateToken } = await import("../../auth");
  const { registerDailyCommandRoutes } = await import("../../dailyCommand/routes");
  const { registerMindTraceRoutes } = await import("../../routes/mindTraceRoutes");

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  registerDailyCommandRoutes(app);
  registerMindTraceRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  const username = `__daily_command_http_${Date.now()}`;
  const [user] = await db
    .insert(users)
    .values({ username })
    .returning({ id: users.id });
  const token = generateToken(user.id);

  try {
    const add = await requestJson(port, "PATCH", "/api/daily-command/plan", token, {
      op: "add_task",
      task: {
        title: "HTTP route task",
        priority: "high",
        category: "daily-command-test",
        sourceIntent: "daily_command_http_route_test",
      },
    });
    assert.equal(add.status, 200, "daily plan PATCH add_task succeeds");
    const addBody = add.body as { plan?: { tasks?: { id: string; title: string }[] } };
    const taskId = addBody.plan?.tasks?.[0]?.id;
    assert.ok(taskId, "add_task returns the inserted task");

    const update = await requestJson(port, "PATCH", "/api/daily-command/plan", token, {
      ops: [
        { op: "update_task", taskId, updates: { title: "Updated HTTP route task", duration: 30 } },
        { op: "complete_task", taskId, completed: true },
      ],
    });
    assert.equal(update.status, 200, "daily plan PATCH batched ops succeed");
    const updateTasks = (update.body as { plan?: { tasks?: { id: string; title: string; completed?: boolean; duration?: unknown }[] } }).plan?.tasks ?? [];
    assert.equal(updateTasks[0]?.title, "Updated HTTP route task");
    assert.equal(updateTasks[0]?.completed, true);
    assert.equal(updateTasks[0]?.duration, 30);

    const snapshot = await requestJson(port, "GET", "/api/daily-command/today", token);
    assert.equal(snapshot.status, 200, "daily command snapshot route succeeds");
    assert.equal((snapshot.body as { status?: string }).status, "ready");
    assert.equal(
      ((snapshot.body as { plan?: { tasks?: unknown[] } }).plan?.tasks ?? []).length,
      1,
      "snapshot includes patched plan task",
    );

    const traceRecord = buildMindTracePersistenceRecord({
      traceId: `http_trace_${Date.now()}`,
      userId: user.id,
      userRequest: "Find my memory and draft the update.",
      channel: "app",
      turns: 1,
      finishReason: "stop",
      reply: "Draft ready.",
      durationMs: 15,
      toolCalls: [
        {
          name: "memory_search",
          args: { query: "daily command" },
          result: {
            ok: true,
            label: "Memory search: daily command",
            detail: "1 memories retrieved",
            content: "[1] [long_term/semantic] (preferences, confidence: 88%) User wants reliable daily planning.",
          },
          durationMs: 5,
        },
      ],
    });
    await db.insert(orchestrationTraces).values(traceRecord);

    const traces = await requestJson(port, "GET", "/api/mind-trace/recent?limit=5", token);
    assert.equal(traces.status, 200, "mind trace recent route succeeds");
    const traceRows = (traces.body as { traces?: { traceId?: string; memoriesRetrieved?: unknown[]; toolsCalled?: unknown[] }[] }).traces ?? [];
    const persisted = traceRows.find((trace) => trace.traceId === traceRecord.traceId);
    assert.ok(persisted, "mind trace route returns persisted harness trace");
    assert.equal(persisted?.memoriesRetrieved?.length, 1, "persisted trace exposes retrieved memory metadata");
    assert.equal(persisted?.toolsCalled?.length, 1, "persisted trace exposes tool events");

    console.log("All daily command and Mind Trace HTTP route assertions passed.");
  } finally {
    await db.delete(orchestrationTraces).where(eq(orchestrationTraces.userId, user.id));
    await db.delete(agentJobs).where(eq(agentJobs.userId, user.id));
    await db.delete(plans).where(eq(plans.userId, user.id));
    await db.delete(userPreferences).where(eq(userPreferences.userId, user.id));
    await db.delete(users).where(and(eq(users.id, user.id), eq(users.username, username)));
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
