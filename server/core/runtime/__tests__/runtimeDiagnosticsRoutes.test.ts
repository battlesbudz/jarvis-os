import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { registerRuntimeDiagnosticsRoutes } from "../../../routes/runtimeDiagnosticsRoutes";

async function requestJson(
  port: number,
  payload: Record<string, unknown>,
  path = "/api/runtime/dry-run",
) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
  };
}

async function startServer(userId?: string) {
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
  const port = (server.address() as { port: number }).port;
  return { server, port };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

async function run(): Promise<void> {
  const { server, port } = await startServer("user-runtime-route");
  const previousDryRun = process.env.JARVIS_RUNTIME_DRY_RUN;
  const previousLive = process.env.JARVIS_RUNTIME_LIVE_EXECUTION;
  const previousLiveWorkflows = process.env.JARVIS_RUNTIME_LIVE_WORKFLOWS;

  try {
    delete process.env.JARVIS_RUNTIME_DRY_RUN;
    delete process.env.JARVIS_RUNTIME_LIVE_EXECUTION;
    delete process.env.JARVIS_RUNTIME_LIVE_WORKFLOWS;
    const disabled = await requestJson(port, { message: "What can you do?" });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.disabled, true);
    assert.match(String(disabled.body.reason), /disabled/);

    process.env.JARVIS_RUNTIME_DRY_RUN = "1";
    const enabled = await requestJson(port, {
      message: "Send an email to Bill.",
      availableTools: [
        {
          name: "email_action",
          provider: "gmail",
          approvalRequired: true,
          riskTier: "T4",
        },
      ],
      auth: {
        connectedProviders: ["gmail"],
      },
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.disabled, false);
    assert.equal(enabled.body.previewOnly, true);
    assert.match(String(enabled.body.formatted), /Runtime preview: needs_approval/);
    assert.equal((enabled.body.report as { approvalRequired?: boolean }).approvalRequired, true);
    assert.ok(enabled.body.approvalPreview, "route returns approval preview metadata");

    process.env.JARVIS_RUNTIME_LIVE_EXECUTION = "1";
    const liveFlag = await requestJson(port, { message: "What can you do?" });
    assert.equal(liveFlag.status, 409);
    assert.match(String(liveFlag.body.error), /not supported/);

    delete process.env.JARVIS_RUNTIME_LIVE_EXECUTION;
    const missingMessage = await requestJson(port, { channel: "test" });
    assert.equal(missingMessage.status, 400);
    assert.equal(missingMessage.body.error, "message is required");

    const invalidDate = await requestJson(port, {
      message: "What can you do?",
      createdAt: "not-a-date",
    });
    assert.equal(invalidDate.status, 400);
    assert.equal(invalidDate.body.error, "Invalid runtime dry-run request");

    const ownerCheck = await requestJson(port, {
      userId: "body-user-should-not-win",
      eventId: "event-owner-check",
      message: "What can you do?",
      metadata: {
        token: "super-secret-diagnostic-token",
      },
    });
    assert.equal(ownerCheck.status, 200);
    assert.equal((ownerCheck.body.report as { userId?: string }).userId, "user-runtime-route");
    assert.doesNotMatch(JSON.stringify(ownerCheck.body), /body-user-should-not-win/);
    assert.doesNotMatch(JSON.stringify(ownerCheck.body), /super-secret-diagnostic-token/);

    const malformedSnapshots = await requestJson(port, {
      message: "Send an email to Bill.",
      availableTools: [
        {
          name: "email_action",
          provider: 123,
          requiredScopes: "gmail.send",
          riskTier: "T9",
          approvalRequired: "yes",
        },
      ],
      auth: {
        connectedProviders: ["gmail", 42],
        grantedScopes: "gmail.send",
      },
    });
    assert.equal(malformedSnapshots.status, 200);
    assert.equal((malformedSnapshots.body.report as { status?: string }).status, "needs_approval");

    const policyBlocked = await requestJson(port, {
      message: "Send an email to Bill.",
      availableTools: [
        {
          name: "approval_gated_action",
          provider: "gmail",
          approvalRequired: false,
          riskTier: "T4",
        },
      ],
      auth: {
        connectedProviders: ["gmail"],
      },
      policy: {
        blockedTools: ["approval_gated_action"],
      },
    });
    assert.equal(policyBlocked.status, 200);
    assert.equal((policyBlocked.body.report as { status?: string }).status, "blocked");
    assert.match(String(policyBlocked.body.formatted), /runtime policy/);

    delete process.env.JARVIS_RUNTIME_LIVE_EXECUTION;
    const readOnlyDisabled = await requestJson(port, { message: "What can you do?" }, "/api/runtime/read-only");
    assert.equal(readOnlyDisabled.status, 200);
    assert.equal(readOnlyDisabled.body.runtimeOwned, false);
    assert.equal(readOnlyDisabled.body.disabled, true);
    assert.equal(readOnlyDisabled.body.routeOwner, "legacy_route");

    process.env.JARVIS_RUNTIME_LIVE_EXECUTION = "1";
    delete process.env.JARVIS_RUNTIME_LIVE_WORKFLOWS;
    const readOnlyExecuted = await requestJson(port, {
      eventId: "event-read-only-route",
      userId: "body-user-should-not-win",
      message: "What can you do?",
      metadata: {
        token: "read-only-secret-token",
      },
    }, "/api/runtime/read-only");
    assert.equal(readOnlyExecuted.status, 409);
    assert.equal(readOnlyExecuted.body.runtimeOwned, false);
    assert.equal(readOnlyExecuted.body.routeOwner, "legacy_route");
    assert.equal(readOnlyExecuted.body.runtimeWorkflowId, "general-answer");

    process.env.JARVIS_RUNTIME_LIVE_WORKFLOWS = "general-answer";
    const readOnlyAllowed = await requestJson(port, {
      eventId: "event-read-only-route-allowed",
      userId: "body-user-should-not-win",
      message: "What can you do?",
      metadata: {
        token: "read-only-secret-token",
      },
    }, "/api/runtime/read-only");
    assert.equal(readOnlyAllowed.status, 200);
    assert.equal(readOnlyAllowed.body.runtimeOwned, true);
    assert.equal(readOnlyAllowed.body.routeOwner, "core_runtime");
    assert.equal(readOnlyAllowed.body.runtimeWorkflowId, "general-answer");
    assert.equal((readOnlyAllowed.body.execution as { status?: string }).status, "completed");
    assert.equal((readOnlyAllowed.body.execution as { executedToolCount?: number }).executedToolCount, 0);
    assert.equal((readOnlyAllowed.body.decision as { userId?: string }).userId, "user-runtime-route");
    assert.doesNotMatch(JSON.stringify(readOnlyAllowed.body), /body-user-should-not-win/);
    assert.doesNotMatch(JSON.stringify(readOnlyAllowed.body), /read-only-secret-token/);

    const readOnlyDeclined = await requestJson(port, {
      message: "Send an email to Bill.",
    }, "/api/runtime/read-only");
    assert.equal(readOnlyDeclined.status, 409);
    assert.equal(readOnlyDeclined.body.runtimeOwned, false);
    assert.equal(readOnlyDeclined.body.routeOwner, "legacy_route");
    assert.equal(readOnlyDeclined.body.gateStatus, "legacy_route_allowed");

    const readOnlyMissingMessage = await requestJson(port, { channel: "test" }, "/api/runtime/read-only");
    assert.equal(readOnlyMissingMessage.status, 400);
    assert.equal(readOnlyMissingMessage.body.error, "message is required");

    delete process.env.JARVIS_RUNTIME_LIVE_EXECUTION;
    delete process.env.JARVIS_RUNTIME_LIVE_WORKFLOWS;

    const unauthenticated = await startServer();
    try {
      const unauthorized = await requestJson(unauthenticated.port, { message: "What can you do?" });
      assert.equal(unauthorized.status, 401);
      assert.equal(unauthorized.body.error, "Not authenticated");
    } finally {
      await closeServer(unauthenticated.server);
    }

    console.log("All Runtime Diagnostics Route assertions passed.");
  } finally {
    if (previousDryRun === undefined) {
      delete process.env.JARVIS_RUNTIME_DRY_RUN;
    } else {
      process.env.JARVIS_RUNTIME_DRY_RUN = previousDryRun;
    }
    if (previousLive === undefined) {
      delete process.env.JARVIS_RUNTIME_LIVE_EXECUTION;
    } else {
      process.env.JARVIS_RUNTIME_LIVE_EXECUTION = previousLive;
    }
    if (previousLiveWorkflows === undefined) {
      delete process.env.JARVIS_RUNTIME_LIVE_WORKFLOWS;
    } else {
      process.env.JARVIS_RUNTIME_LIVE_WORKFLOWS = previousLiveWorkflows;
    }
    await closeServer(server);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
