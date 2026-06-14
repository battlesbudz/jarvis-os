import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { registerRuntimeDiagnosticsRoutes } from "../../../routes/runtimeDiagnosticsRoutes";

const ROUTE_USER_ID = "runtime-e2e-automation-user";
const BODY_USER_ID = "body-user-must-not-win";
const NOW = "2026-06-08T21:00:00.000Z";

const RUNTIME_ENV_KEYS = [
  "JARVIS_RUNTIME_PREVIEW",
  "JARVIS_RUNTIME_DRY_RUN",
  "JARVIS_RUNTIME_LIVE_EXECUTION",
  "JARVIS_RUNTIME_DEFAULT_READ_ONLY",
  "JARVIS_RUNTIME_KILL_SWITCH",
  "JARVIS_RUNTIME_LIVE_WORKFLOWS",
] as const;

const SECRET_PATTERNS = [
  /runtime-secret-token/i,
  /runtime-secret-cookie/i,
  /runtime-secret-password/i,
  /runtime-secret-api-key/i,
  /runtime-secret-session/i,
  /body-user-must-not-win/i,
  /rm -rf/i,
  /npm run build/i,
];

type RuntimeEnvPatch = Partial<Record<(typeof RUNTIME_ENV_KEYS)[number], string | undefined>>;

let eventCounter = 0;

async function requestJson(
  port: number,
  path: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
  };
}

async function startRuntimeRouteServer(userId = ROUTE_USER_ID) {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      req.userId = userId;
      next();
    });
  }
  registerRuntimeDiagnosticsRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    port: (server.address() as { port: number }).port,
  };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

async function withRuntimeEnv<T>(patch: RuntimeEnvPatch, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of RUNTIME_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function assertNoSensitiveLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const pattern of SECRET_PATTERNS) {
    assert.doesNotMatch(serialized, pattern);
  }
}

function runtimePayload(message: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  eventCounter += 1;
  return {
    eventId: `runtime-e2e-auto-${eventCounter}`,
    userId: BODY_USER_ID,
    source: "app",
    message,
    createdAt: NOW,
    metadata: {
      accessToken: "runtime-secret-token",
      cookie: "runtime-secret-cookie",
      password: "runtime-secret-password",
      apiKey: "runtime-secret-api-key",
      sessionId: "runtime-secret-session",
      shellCommand: "npm run build && rm -rf /tmp/runtime-secret-token",
    },
    ...extra,
  };
}

async function assertApiRouteChecks(port: number): Promise<void> {
  await withRuntimeEnv({ JARVIS_RUNTIME_DRY_RUN: "1" }, async () => {
    const missingDryRunMessage = await requestJson(port, "/api/runtime/dry-run", { channel: "settings" });
    assert.equal(missingDryRunMessage.status, 400);
    assert.equal(missingDryRunMessage.body.error, "message is required");

    const invalidDryRunDate = await requestJson(port, "/api/runtime/dry-run", {
      message: "What can you do?",
      createdAt: "not-a-date",
    });
    assert.equal(invalidDryRunDate.status, 400);
    assert.equal(invalidDryRunDate.body.error, "Invalid runtime dry-run request");
  });

  await withRuntimeEnv({ JARVIS_RUNTIME_LIVE_EXECUTION: "1" }, async () => {
    const missingReadOnlyMessage = await requestJson(port, "/api/runtime/read-only", { channel: "settings" });
    assert.equal(missingReadOnlyMessage.status, 400);
    assert.equal(missingReadOnlyMessage.body.error, "message is required");

    const invalidReadOnlyDate = await requestJson(port, "/api/runtime/read-only", {
      message: "What can you do?",
      createdAt: "not-a-date",
    });
    assert.equal(invalidReadOnlyDate.status, 400);
    assert.equal(invalidReadOnlyDate.body.error, "Invalid runtime read-only request");
  });

  const unauthenticated = await startRuntimeRouteServer("");
  try {
    const dryRunUnauthorized = await requestJson(unauthenticated.port, "/api/runtime/dry-run", {
      message: "What can you do?",
    });
    assert.equal(dryRunUnauthorized.status, 401);
    assert.equal(dryRunUnauthorized.body.error, "Not authenticated");

    const readOnlyUnauthorized = await requestJson(unauthenticated.port, "/api/runtime/read-only", {
      message: "What can you do?",
    });
    assert.equal(readOnlyUnauthorized.status, 401);
    assert.equal(readOnlyUnauthorized.body.error, "Not authenticated");
  } finally {
    await closeServer(unauthenticated.server);
  }

  console.log("OK: Runtime E2E automation covers API route auth and request validation checks");
}

async function assertDryRunFlagMatrix(port: number): Promise<void> {
  const cases = [
    {
      name: "disabled by default",
      env: {},
      payload: runtimePayload("What can you do?"),
      expectedStatus: 200,
      assertBody: (body: Record<string, unknown>) => {
        assert.equal(body.disabled, true);
        assert.match(String(body.reason), /dry run is disabled/i);
      },
    },
    {
      name: "ready preview when dry-run flag is enabled",
      env: { JARVIS_RUNTIME_DRY_RUN: "1" },
      payload: runtimePayload("What can you do?"),
      expectedStatus: 200,
      assertBody: (body: Record<string, unknown>) => {
        assert.equal(body.disabled, false);
        assert.equal((body.report as { status?: string }).status, "ready");
        assert.equal((body.report as { responseMode?: string }).responseMode, "answer");
      },
    },
    {
      name: "approval preview for connected risky tool",
      env: { JARVIS_RUNTIME_DRY_RUN: "true" },
      payload: runtimePayload("Send an email to Bill saying I will follow up tomorrow.", {
        availableTools: [{
          name: "send_email",
          provider: "gmail",
          approvalRequired: true,
          riskTier: "T4",
        }],
        auth: { connectedProviders: ["gmail"] },
      }),
      expectedStatus: 200,
      assertBody: (body: Record<string, unknown>) => {
        assert.equal((body.report as { status?: string }).status, "needs_approval");
        assert.equal((body.report as { approvalRequired?: boolean }).approvalRequired, true);
        assert.ok(body.approvalPreview);
      },
    },
    {
      name: "blocked preview for runtime policy deny",
      env: { JARVIS_RUNTIME_DRY_RUN: "1" },
      payload: runtimePayload("Run a desktop command.", {
        availableTools: [{
          name: "approval_gated_action",
          provider: "runtime",
          approvalRequired: true,
          riskTier: "T3",
        }],
        auth: { connectedProviders: ["runtime"] },
        policy: { blockedTools: ["approval_gated_action"] },
      }),
      expectedStatus: 200,
      assertBody: (body: Record<string, unknown>) => {
        assert.equal((body.report as { status?: string }).status, "blocked");
        assert.match(String(body.formatted), /runtime policy/i);
      },
    },
    {
      name: "dry-run route refuses live execution flag",
      env: { JARVIS_RUNTIME_DRY_RUN: "1", JARVIS_RUNTIME_LIVE_EXECUTION: "1" },
      payload: runtimePayload("What can you do?"),
      expectedStatus: 409,
      assertBody: (body: Record<string, unknown>) => {
        assert.match(String(body.error), /live execution is not supported/i);
      },
    },
  ] satisfies Array<{
    name: string;
    env: RuntimeEnvPatch;
    payload: Record<string, unknown>;
    expectedStatus: number;
    assertBody: (body: Record<string, unknown>) => void;
  }>;

  for (const testCase of cases) {
    await withRuntimeEnv(testCase.env, async () => {
      const response = await requestJson(port, "/api/runtime/dry-run", testCase.payload);
      assert.equal(response.status, testCase.expectedStatus, testCase.name);
      testCase.assertBody(response.body);
      assertNoSensitiveLeak(response.body);
    });
  }

  console.log("OK: Runtime E2E automation covers dry-run flag matrix and redaction assertions");
}

async function assertReadOnlyFlagMatrix(port: number): Promise<void> {
  const cases = [
    {
      name: "read-only route disabled by default",
      env: {},
      payload: runtimePayload("What can you do?"),
      expectedStatus: 200,
      assertBody: (body: Record<string, unknown>) => {
        assert.equal(body.runtimeOwned, false);
        assert.equal(body.disabled, true);
        assert.equal(body.routeOwner, "legacy_route");
      },
    },
    {
      name: "live flag alone still declines ownership without allowlist",
      env: { JARVIS_RUNTIME_LIVE_EXECUTION: "1" },
      payload: runtimePayload("What can you do?"),
      expectedStatus: 409,
      assertBody: (body: Record<string, unknown>) => {
        assert.equal(body.runtimeOwned, false);
        assert.equal(body.routeOwner, "legacy_route");
        assert.equal(body.runtimeWorkflowId, "general-answer");
        assert.match(String(body.reason), /not enabled/i);
      },
    },
    {
      name: "explicit allowlist owns a read-only workflow",
      env: {
        JARVIS_RUNTIME_LIVE_EXECUTION: "1",
        JARVIS_RUNTIME_LIVE_WORKFLOWS: "general-answer",
      },
      payload: runtimePayload("What can you do?"),
      expectedStatus: 200,
      assertBody: (body: Record<string, unknown>) => {
        assert.equal(body.runtimeOwned, true);
        assert.equal(body.routeOwner, "core_runtime");
        assert.equal(body.runtimeWorkflowId, "general-answer");
      },
    },
    {
      name: "default read-only owns migrated safe workflows",
      env: {
        JARVIS_RUNTIME_LIVE_EXECUTION: "1",
        JARVIS_RUNTIME_DEFAULT_READ_ONLY: "1",
      },
      payload: runtimePayload("Prepare me for my next meeting."),
      expectedStatus: 200,
      assertBody: (body: Record<string, unknown>) => {
        assert.equal(body.runtimeOwned, true);
        assert.equal(body.routeOwner, "core_runtime");
        assert.equal(body.runtimeWorkflowId, "next-meeting-brief");
      },
    },
    {
      name: "kill switch overrides live/default read-only ownership",
      env: {
        JARVIS_RUNTIME_LIVE_EXECUTION: "1",
        JARVIS_RUNTIME_DEFAULT_READ_ONLY: "1",
        JARVIS_RUNTIME_KILL_SWITCH: "1",
      },
      payload: runtimePayload("What can you do?"),
      expectedStatus: 200,
      assertBody: (body: Record<string, unknown>) => {
        assert.equal(body.runtimeOwned, false);
        assert.equal(body.disabled, true);
        assert.match(String(body.reason), /kill switch/i);
      },
    },
    {
      name: "approval-required workflow stays with legacy owner",
      env: {
        JARVIS_RUNTIME_LIVE_EXECUTION: "1",
        JARVIS_RUNTIME_DEFAULT_READ_ONLY: "1",
      },
      payload: runtimePayload("Send this email to Bill."),
      expectedStatus: 409,
      assertBody: (body: Record<string, unknown>) => {
        assert.equal(body.runtimeOwned, false);
        assert.equal(body.routeOwner, "legacy_route");
        assert.equal(body.gateStatus, "legacy_route_allowed");
      },
    },
  ] satisfies Array<{
    name: string;
    env: RuntimeEnvPatch;
    payload: Record<string, unknown>;
    expectedStatus: number;
    assertBody: (body: Record<string, unknown>) => void;
  }>;

  for (const testCase of cases) {
    await withRuntimeEnv(testCase.env, async () => {
      const response = await requestJson(port, "/api/runtime/read-only", testCase.payload);
      assert.equal(response.status, testCase.expectedStatus, testCase.name);
      testCase.assertBody(response.body);
      assertNoSensitiveLeak(response.body);
    });
  }

  console.log("OK: Runtime E2E automation covers read-only route flag matrix and redaction assertions");
}

async function assertRuntimeOwnedReadOnlyWorkflows(port: number): Promise<void> {
  const workflows = [
    {
      workflowId: "general-answer",
      message: "What can you do?",
      expectedIntent: "general",
    },
    {
      workflowId: "memory-lookup",
      message: "What memory do you have about morning planning?",
      expectedIntent: "memory_query",
    },
    {
      workflowId: "email-draft-reply",
      message: "Draft a reply to this email.",
      expectedIntent: "email_draft",
    },
    {
      workflowId: "next-meeting-brief",
      message: "Prepare me for my next meeting.",
      expectedIntent: "calendar_query",
    },
  ] as const;

  for (const workflow of workflows) {
    await withRuntimeEnv({
      JARVIS_RUNTIME_LIVE_EXECUTION: "1",
      JARVIS_RUNTIME_LIVE_WORKFLOWS: workflow.workflowId,
    }, async () => {
      const response = await requestJson(
        port,
        "/api/runtime/read-only",
        runtimePayload(workflow.message),
      );
      const execution = response.body.execution as {
        status?: string;
        mode?: string;
        owner?: string;
        executedToolCount?: number;
        sideEffects?: unknown[];
      };
      const decision = response.body.decision as {
        userId?: string;
        intent?: string;
        responseMode?: string;
        approvalRequired?: boolean;
      };

      assert.equal(response.status, 200);
      assert.equal(response.body.runtimeOwned, true);
      assert.equal(response.body.routeOwner, "core_runtime");
      assert.equal(response.body.runtimeWorkflowId, workflow.workflowId);
      assert.equal(execution.status, "completed");
      assert.equal(execution.mode, "read_only");
      assert.equal(execution.owner, "core_runtime");
      assert.equal(execution.executedToolCount, 0);
      assert.deepEqual(execution.sideEffects, []);
      assert.equal(decision.userId, ROUTE_USER_ID);
      assert.equal(decision.intent, workflow.expectedIntent);
      assert.equal(decision.responseMode, "answer");
      assert.equal(decision.approvalRequired, false);
      assertNoSensitiveLeak(response.body);
    });
  }

  console.log("OK: Runtime E2E automation proves runtime-owned read-only workflow guardrails");
}

async function run(): Promise<void> {
  const { server, port } = await startRuntimeRouteServer();
  try {
    await assertApiRouteChecks(port);
    await assertDryRunFlagMatrix(port);
    await assertReadOnlyFlagMatrix(port);
    await assertRuntimeOwnedReadOnlyWorkflows(port);
    console.log("\nAll Runtime E2E Automation assertions passed.");
  } finally {
    await closeServer(server);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
