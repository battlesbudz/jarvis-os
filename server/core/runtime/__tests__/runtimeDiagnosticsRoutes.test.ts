import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { registerRuntimeDiagnosticsRoutes } from "../../../routes/runtimeDiagnosticsRoutes";

async function requestJson(
  port: number,
  payload: Record<string, unknown>,
) {
  const response = await fetch(`http://127.0.0.1:${port}/api/runtime/dry-run`, {
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

async function run(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = "user-runtime-route";
    next();
  });
  registerRuntimeDiagnosticsRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const previousDryRun = process.env.JARVIS_RUNTIME_DRY_RUN;
  const previousLive = process.env.JARVIS_RUNTIME_LIVE_EXECUTION;

  try {
    delete process.env.JARVIS_RUNTIME_DRY_RUN;
    delete process.env.JARVIS_RUNTIME_LIVE_EXECUTION;
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
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
