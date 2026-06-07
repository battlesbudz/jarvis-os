import assert from "node:assert/strict";
import { preflightToolGateway, preflightToolIntent } from "../index";
import type { ToolGatewayToolDescriptor } from "../toolGatewayTypes";

const availableTools: ToolGatewayToolDescriptor[] = [
  {
    name: "memory_search",
    provider: "memory",
    requiredScopes: ["memory:read"],
    riskTier: "T0",
  },
  {
    name: "send_email",
    provider: "google",
    requiredScopes: ["gmail.send"],
    riskTier: "T3",
    approvalRequired: true,
  },
  {
    name: "weather_lookup",
    provider: "weather",
    riskTier: "T0",
  },
];

{
  const result = preflightToolIntent({
    intent: {
      toolName: "memory_search",
      status: "proposed",
      riskTier: "T0",
      approvalRequired: false,
    },
    availableTools,
    auth: {
      connectedProviders: ["memory"],
      grantedScopes: ["memory:read"],
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.intent.status, "ready");
  console.log("OK: Tool Gateway preflight marks connected low-risk tools ready");
}

{
  const result = preflightToolIntent({
    intent: {
      toolName: "send_email",
      status: "proposed",
      riskTier: "T3",
      approvalRequired: true,
    },
    availableTools,
    auth: {
      connectedProviders: [],
      grantedScopes: [],
    },
  });

  assert.equal(result.status, "needs_auth");
  assert.equal(result.intent.status, "needs_auth");
  console.log("OK: Tool Gateway preflight reports missing provider auth before approval");
}

{
  const result = preflightToolIntent({
    intent: {
      toolName: "send_email",
      status: "proposed",
      riskTier: "T3",
      approvalRequired: true,
    },
    availableTools,
    auth: {
      connectedProviders: ["google"],
      grantedScopes: ["gmail.readonly"],
    },
  });

  assert.equal(result.status, "missing_scope");
  assert.deepEqual(result.missingScopes, ["gmail.send"]);
  console.log("OK: Tool Gateway preflight reports missing scopes");
}

{
  const result = preflightToolIntent({
    intent: {
      toolName: "send_email",
      status: "proposed",
      riskTier: "T3",
      approvalRequired: true,
    },
    availableTools,
    auth: {
      connectedProviders: ["google"],
      grantedScopes: ["gmail.send"],
    },
  });

  assert.equal(result.status, "approval_required");
  assert.equal(result.intent.approvalRequired, true);
  console.log("OK: Tool Gateway preflight preserves approval gates after auth checks pass");
}

{
  const result = preflightToolIntent({
    intent: {
      toolName: "daemon_action",
      status: "proposed",
      riskTier: "T3",
      approvalRequired: true,
    },
    availableTools,
  });

  assert.equal(result.status, "blocked_by_policy");
  console.log("OK: Tool Gateway preflight blocks unknown non-virtual tools");
}

{
  const result = preflightToolIntent({
    intent: {
      toolName: "weather_lookup",
      status: "proposed",
      riskTier: "T0",
      approvalRequired: false,
    },
    availableTools,
    auth: {
      connectedProviders: ["weather"],
      unavailableProviders: ["weather"],
    },
  });

  assert.equal(result.status, "provider_down");
  console.log("OK: Tool Gateway preflight reports provider outages");
}

{
  const result = preflightToolGateway({
    intents: [
      {
        toolName: "memory_search",
        status: "proposed",
        riskTier: "T0",
        approvalRequired: false,
      },
      {
        toolName: "send_email",
        status: "proposed",
        riskTier: "T3",
        approvalRequired: true,
      },
    ],
    availableTools,
    auth: {
      connectedProviders: ["memory", "google"],
      grantedScopes: ["memory:read", "gmail.send"],
    },
  });

  assert.equal(result.ready.length, 1);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0]?.status, "approval_required");
  console.log("OK: Tool Gateway preflight summarizes ready and blocked intents");
}

console.log("\nAll Tool Gateway preflight assertions passed.");
