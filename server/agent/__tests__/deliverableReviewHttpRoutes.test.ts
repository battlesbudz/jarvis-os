import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { and, eq } from "drizzle-orm";
import { deliverables, users } from "@shared/schema";
import type { db as dbType } from "../../db";

if (!process.env.DATABASE_URL) {
  console.log("server/agent/__tests__/deliverableReviewHttpRoutes.test.ts: DATABASE_URL not set - skipped");
  process.exit(0);
}

type Db = typeof dbType;

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

async function insertDeliverable(db: Db, userId: string, values: {
  type: string;
  status?: string;
  title?: string;
  body?: string;
  meta?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(deliverables)
    .values({
      userId,
      agentType: "coach",
      type: values.type,
      title: values.title ?? `${values.type} test`,
      summary: null,
      body: values.body ?? "Review me.",
      meta: values.meta ?? {},
      status: values.status ?? "pending_approval",
    })
    .returning();
  return row;
}

async function run(): Promise<void> {
  const { db } = await import("../../db");
  const { authMiddleware, generateToken } = await import("../../auth");
  const { registerDeliverableReviewRoutes } = await import("../deliverableReviewHttpRoutes");

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  registerDeliverableReviewRoutes(app, { db });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  const username = `__deliverable_http_${Date.now()}`;
  const [user] = await db
    .insert(users)
    .values({ username })
    .returning({ id: users.id });
  const token = generateToken(user.id);

  try {
    const approvalGate = await insertDeliverable(db, user.id, {
      type: "approval_gate",
      body: "Jarvis wants to send an email.",
      meta: { gateId: "http_gate_1" },
    });

    const editGate = await requestJson(
      port,
      "PUT",
      `/api/deliverables/${approvalGate.id}`,
      token,
      { title: "Edited gate" },
    );
    assert.equal(editGate.status, 400, "HTTP route rejects editing approval gates");
    assert.match(String(editGate.body.error), /approve or decline/i);

    const normalDeliverable = await insertDeliverable(db, user.id, {
      type: "document",
      title: "Draft operating plan",
      body: "Original operating plan.",
    });

    const editNormal = await requestJson(
      port,
      "PUT",
      `/api/deliverables/${normalDeliverable.id}`,
      token,
      { title: "Edited operating plan", body: "Edited body." },
    );
    assert.equal(editNormal.status, 200, "HTTP route allows editing normal pending deliverables");

    const discardNormal = await requestJson(
      port,
      "POST",
      `/api/deliverables/${normalDeliverable.id}/discard`,
      token,
    );
    assert.equal(discardNormal.status, 200, "HTTP route allows discarding normal pending deliverables");

    const approvedDeliverable = await insertDeliverable(db, user.id, {
      type: "document",
      status: "approved",
      title: "Accepted operating plan",
      body: "Accepted body.",
    });

    const editApproved = await requestJson(
      port,
      "PUT",
      `/api/deliverables/${approvedDeliverable.id}`,
      token,
      { title: "Should not change" },
    );
    assert.equal(editApproved.status, 400, "HTTP route rejects editing already-approved deliverables");
    assert.match(String(editApproved.body.error), /only pending/i);

    console.log("All deliverable review HTTP route assertions passed.");
  } finally {
    await db.delete(deliverables).where(eq(deliverables.userId, user.id));
    await db.delete(users).where(and(eq(users.id, user.id), eq(users.username, username)));
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
