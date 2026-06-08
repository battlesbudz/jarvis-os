import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { registerRuntimeDiagnosticsRoutes } from "../../../routes/runtimeDiagnosticsRoutes";
import {
  buildRuntimeDaemonAuditEnvelope,
  buildRuntimeMemoryCalibrationPreview,
  buildRuntimeScheduledTaskPreview,
} from "../index";

const QA_USER_ID = "runtime-e2e-user";
const now = "2026-06-08T23:30:00.000Z";

async function requestJson(
  port: number,
  payload: Record<string, unknown>,
  path = "/api/runtime/dry-run",
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

async function startRuntimeServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = QA_USER_ID;
    next();
  });
  registerRuntimeDiagnosticsRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { server, port };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return fn().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

function assertNoSensitiveLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(
    serialized,
    /secret-token|secret-cookie|secret-session|secret-password|secret-api-key|npm run build|rm -rf/i,
  );
}

async function run(): Promise<void> {
  const coveredPlanCases = new Set<string>();
  const { server, port } = await startRuntimeServer();

  try {
    await withEnv({
      JARVIS_RUNTIME_DRY_RUN: undefined,
      JARVIS_RUNTIME_LIVE_EXECUTION: undefined,
      JARVIS_RUNTIME_LIVE_WORKFLOWS: undefined,
      JARVIS_RUNTIME_DEFAULT_READ_ONLY: undefined,
      JARVIS_RUNTIME_KILL_SWITCH: undefined,
    }, async () => {
      const disabled = await requestJson(port, {
        eventId: "rte2e-01",
        message: "What can you do?",
        createdAt: now,
      });

      assert.equal(disabled.status, 200);
      assert.equal(disabled.body.disabled, true);
      assert.match(String(disabled.body.reason), /disabled/);
      coveredPlanCases.add("RTE2E-01");
      console.log("OK: RTE2E-01 runtime preview is default-off");
    });

    await withEnv({
      JARVIS_RUNTIME_DRY_RUN: "1",
      JARVIS_RUNTIME_LIVE_EXECUTION: undefined,
    }, async () => {
      const ready = await requestJson(port, {
        eventId: "rte2e-02",
        message: "What can you do?",
        createdAt: now,
      });

      assert.equal(ready.status, 200);
      assert.equal(ready.body.disabled, false);
      assert.equal((ready.body.report as { status?: string }).status, "ready");
      assert.equal((ready.body.report as { responseMode?: string }).responseMode, "answer");
      assert.ok((ready.body.report as { readyToolCount?: number }).readyToolCount! > 0);
      assert.equal((ready.body.report as { blockedToolCount?: number }).blockedToolCount, 0);
      coveredPlanCases.add("RTE2E-02");
      console.log("OK: RTE2E-02 runtime dry-run previews a safe general answer");

      const memory = await requestJson(port, {
        eventId: "rte2e-03",
        message: "What memory do you have about my morning planning?",
        createdAt: now,
      });

      assert.equal(memory.status, 200);
      assert.equal((memory.body.report as { intent?: string }).intent, "memory_query");
      assert.equal((memory.body.report as { approvalRequired?: boolean }).approvalRequired, false);
      coveredPlanCases.add("RTE2E-03");
      console.log("OK: RTE2E-03 runtime dry-run classifies memory lookup without writes");

      const approval = await requestJson(port, {
        eventId: "rte2e-04",
        message: "Send an email to Bill saying I will follow up tomorrow.",
        createdAt: now,
        metadata: {
          accessToken: "secret-token",
          cookie: "secret-cookie",
          sessionId: "secret-session",
          password: "secret-password",
          apiKey: "secret-api-key",
        },
        availableTools: [
          {
            name: "send_email",
            provider: "gmail",
            approvalRequired: true,
            riskTier: "T4",
          },
        ],
        auth: {
          connectedProviders: ["gmail"],
        },
      });

      assert.equal(approval.status, 200);
      assert.equal((approval.body.report as { status?: string }).status, "needs_approval");
      assert.equal((approval.body.report as { approvalRequired?: boolean }).approvalRequired, true);
      assert.ok(approval.body.approvalPreview);
      assertNoSensitiveLeak(approval.body);
      coveredPlanCases.add("RTE2E-04");
      coveredPlanCases.add("RTE2E-13");
      console.log("OK: RTE2E-04/RTE2E-13 approval preview stays redacted and side-effect free");

      const blocked = await requestJson(port, {
        eventId: "rte2e-14",
        message: "Run a desktop command.",
        createdAt: now,
        availableTools: [
          {
            name: "approval_gated_action",
            provider: "runtime",
            approvalRequired: true,
            riskTier: "T3",
          },
        ],
        auth: {
          connectedProviders: ["runtime"],
        },
        policy: {
          blockedTools: ["approval_gated_action"],
        },
      });

      assert.equal(blocked.status, 200);
      assert.equal((blocked.body.report as { status?: string }).status, "blocked");
      assert.equal((blocked.body.report as { intent?: string }).intent, "daemon_action");
      assert.match(String(blocked.body.formatted), /runtime policy/);
      coveredPlanCases.add("RTE2E-14");
      console.log("OK: RTE2E-14 policy-blocked tool stays blocked without execution");
    });

    await withEnv({
      JARVIS_RUNTIME_DRY_RUN: undefined,
      JARVIS_RUNTIME_LIVE_EXECUTION: "1",
      JARVIS_RUNTIME_LIVE_WORKFLOWS: "general-answer",
      JARVIS_RUNTIME_DEFAULT_READ_ONLY: undefined,
      JARVIS_RUNTIME_KILL_SWITCH: undefined,
    }, async () => {
      const general = await requestJson(port, {
        eventId: "rte2e-05",
        message: "What can you do?",
        createdAt: now,
      }, "/api/runtime/read-only");

      assert.equal(general.status, 200);
      assert.equal(general.body.runtimeOwned, true);
      assert.equal(general.body.runtimeWorkflowId, "general-answer");
      assert.equal((general.body.execution as { executedToolCount?: number }).executedToolCount, 0);
      assert.deepEqual((general.body.execution as { sideEffects?: unknown[] }).sideEffects, []);
      coveredPlanCases.add("RTE2E-05");
      console.log("OK: RTE2E-05 read-only route owns allowlisted general answer");

      const memoryBlocked = await requestJson(port, {
        eventId: "rte2e-06-blocked",
        message: "What memory do you have about morning planning?",
        createdAt: now,
      }, "/api/runtime/read-only");
      assert.equal(memoryBlocked.status, 409);
      assert.equal(memoryBlocked.body.runtimeOwned, false);
      assert.equal(memoryBlocked.body.runtimeWorkflowId, "memory-lookup");
    });

    await withEnv({
      JARVIS_RUNTIME_LIVE_EXECUTION: "1",
      JARVIS_RUNTIME_LIVE_WORKFLOWS: "memory-lookup",
      JARVIS_RUNTIME_DEFAULT_READ_ONLY: undefined,
      JARVIS_RUNTIME_KILL_SWITCH: undefined,
    }, async () => {
      const memoryAllowed = await requestJson(port, {
        eventId: "rte2e-06-allowed",
        message: "What memory do you have about morning planning?",
        createdAt: now,
      }, "/api/runtime/read-only");

      assert.equal(memoryAllowed.status, 200);
      assert.equal(memoryAllowed.body.runtimeOwned, true);
      assert.equal(memoryAllowed.body.runtimeWorkflowId, "memory-lookup");
      assert.equal((memoryAllowed.body.execution as { executedToolCount?: number }).executedToolCount, 0);
      coveredPlanCases.add("RTE2E-06");
      console.log("OK: RTE2E-06 migrated read-only workflows require matching allowlist");
    });

    await withEnv({
      JARVIS_RUNTIME_LIVE_EXECUTION: "1",
      JARVIS_RUNTIME_DEFAULT_READ_ONLY: "1",
      JARVIS_RUNTIME_LIVE_WORKFLOWS: undefined,
      JARVIS_RUNTIME_KILL_SWITCH: undefined,
    }, async () => {
      const risky = await requestJson(port, {
        eventId: "rte2e-07",
        message: "Send this email to Bill now.",
        createdAt: now,
      }, "/api/runtime/read-only");

      assert.equal(risky.status, 409);
      assert.equal(risky.body.runtimeOwned, false);
      assert.equal(risky.body.routeOwner, "legacy_route");
      coveredPlanCases.add("RTE2E-07");
      console.log("OK: RTE2E-07 risky work declines to the existing owner");
    });

    await withEnv({
      JARVIS_RUNTIME_LIVE_EXECUTION: "1",
      JARVIS_RUNTIME_DEFAULT_READ_ONLY: "1",
      JARVIS_RUNTIME_KILL_SWITCH: "1",
    }, async () => {
      const killed = await requestJson(port, {
        eventId: "rte2e-08",
        message: "What can you do?",
        createdAt: now,
      }, "/api/runtime/read-only");

      assert.equal(killed.status, 200);
      assert.equal(killed.body.runtimeOwned, false);
      assert.equal(killed.body.disabled, true);
      assert.match(String(killed.body.reason), /kill switch/);
      coveredPlanCases.add("RTE2E-08");
      console.log("OK: RTE2E-08 kill switch routes back to existing ownership");
    });

    {
      const memoryPreview = buildRuntimeMemoryCalibrationPreview({
        event: {
          eventId: "rte2e-09",
          source: "app",
          userId: QA_USER_ID,
          message: "Actually, remember my daily planning block starts at 8:30 now.",
          createdAt: now,
        },
        currentMemory: {
          id: "memory-planning",
          content: "User starts daily planning at 9:00.",
          confidence: 80,
          confidenceScale: "percent",
          metadata: { accessToken: "secret-token" },
        },
        correction: {
          content: "User starts daily planning at 8:30.",
          confidence: 0.96,
          metadata: { cookie: "secret-cookie" },
        },
      });

      assert.equal(memoryPreview.approvalRequired, true);
      assert.equal(memoryPreview.writeAllowed, false);
      assert.equal(memoryPreview.currentMemory?.confidence?.normalized, 0.8);
      assertNoSensitiveLeak(memoryPreview);
      coveredPlanCases.add("RTE2E-09");
      console.log("OK: RTE2E-09 memory correction preview is review-only and redacted");
    }

    {
      const daemonEnvelope = buildRuntimeDaemonAuditEnvelope({
        event: {
          eventId: "rte2e-10",
          source: "daemon",
          userId: QA_USER_ID,
          message: "Run echo JARVIS_RUNTIME_E2E on my desktop.",
          createdAt: now,
        },
        toolName: "daemon_shell",
        argsPreview: {
          command: "echo secret-token",
          sessionId: "secret-session",
        },
        resultPreview: {
          stdout: "secret-token",
          stderr: "secret-password",
        },
      });

      assert.equal(daemonEnvelope.surface, "desktop");
      assert.equal(daemonEnvelope.rawPayloadStored, false);
      assert.match(String(daemonEnvelope.args.fingerprint), /^[a-f0-9]{64}$/);
      assert.match(String(daemonEnvelope.result.fingerprint), /^[a-f0-9]{64}$/);
      assertNoSensitiveLeak(daemonEnvelope);
      coveredPlanCases.add("RTE2E-10");
      console.log("OK: RTE2E-10 daemon audit envelope avoids raw command/output storage");
    }

    {
      const reminderPreview = buildRuntimeScheduledTaskPreview({
        event: {
          eventId: "rte2e-11",
          source: "app",
          userId: QA_USER_ID,
          message: "Remind me tomorrow at 9am to call Bill runtime E2E.",
          createdAt: now,
        },
        title: "Call Bill runtime E2E",
        scheduledAt: "2026-06-09T13:00:00.000Z",
        sourceTool: "schedule_jarvis_task",
      });

      assert.equal(reminderPreview.owner, "existing_scheduler");
      assert.equal(reminderPreview.taskKind, "user_task");
      assert.equal(reminderPreview.executableByJarvis, false);
      assert.equal(reminderPreview.runtimeEnqueueAllowed, false);
      coveredPlanCases.add("RTE2E-11");
      console.log("OK: RTE2E-11 reminder preview keeps user tasks non-executable");

      const shellJobPreview = buildRuntimeScheduledTaskPreview({
        event: {
          eventId: "rte2e-12",
          source: "app",
          userId: QA_USER_ID,
          message: "Every day at 9am, run npm test in my workspace and tell me the result.",
          createdAt: now,
        },
        title: "Runtime E2E build smoke",
        scheduledAt: "daily",
        recurrence: "daily",
        taskKind: "jarvis_action",
        shellCommand: "npm run build -- --token secret-token",
        sourceTool: "cron_create",
      });

      assert.equal(shellJobPreview.owner, "existing_scheduler");
      assert.equal(shellJobPreview.executableByJarvis, true);
      assert.equal(shellJobPreview.approvalRequired, true);
      assert.equal(shellJobPreview.shellCommand.present, true);
      assert.match(String(shellJobPreview.shellCommand.fingerprint), /^[a-f0-9]{64}$/);
      assertNoSensitiveLeak(shellJobPreview);
      coveredPlanCases.add("RTE2E-12");
      console.log("OK: RTE2E-12 scheduled shell job preview fingerprints commands only");
    }

    const expectedCases = [
      "RTE2E-01",
      "RTE2E-02",
      "RTE2E-03",
      "RTE2E-04",
      "RTE2E-05",
      "RTE2E-06",
      "RTE2E-07",
      "RTE2E-08",
      "RTE2E-09",
      "RTE2E-10",
      "RTE2E-11",
      "RTE2E-12",
      "RTE2E-13",
      "RTE2E-14",
    ];
    assert.deepEqual([...coveredPlanCases].sort(), expectedCases);

    console.log("\nAll Runtime E2E Smoke assertions passed.");
  } finally {
    await closeServer(server);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
