import assert from "node:assert/strict";
import { toolDescriptorFromAgentTool, toolDescriptorsFromAgentTools } from "../index";

{
  const descriptor = toolDescriptorFromAgentTool({ name: "memory_search" });

  assert.equal(descriptor.provider, "memory");
  assert.deepEqual(descriptor.requiredScopes, ["memory:read"]);
  assert.equal(descriptor.riskTier, "T0");
  assert.equal(descriptor.approvalRequired, false);
  console.log("OK: Agent tool adapter maps memory search to low-risk memory descriptor");
}

{
  const descriptor = toolDescriptorFromAgentTool({ name: "send_email" });

  assert.equal(descriptor.provider, "google");
  assert.deepEqual(descriptor.requiredScopes, ["gmail"]);
  assert.equal(descriptor.riskTier, "T3");
  assert.equal(descriptor.approvalRequired, true);
  console.log("OK: Agent tool adapter marks send email as Google approval-required tool");
}

{
  const descriptor = toolDescriptorFromAgentTool({ name: "daemon_action" });

  assert.equal(descriptor.provider, "runtime");
  assert.equal(descriptor.riskTier, "T3");
  assert.equal(descriptor.approvalRequired, true);
  console.log("OK: Agent tool adapter marks daemon actions approval-required");
}

{
  const descriptor = toolDescriptorFromAgentTool({ name: "project_shell" });

  assert.equal(descriptor.provider, "runtime");
  assert.deepEqual(descriptor.requiredScopes, []);
  assert.equal(descriptor.riskTier, "T3");
  assert.equal(descriptor.approvalRequired, true);
  console.log("OK: Agent tool adapter marks project shell as runtime approval-required");
}

{
  const descriptor = toolDescriptorFromAgentTool({ name: "project_write_file" });

  assert.equal(descriptor.provider, "runtime");
  assert.deepEqual(descriptor.requiredScopes, []);
  assert.equal(descriptor.riskTier, "T3");
  assert.equal(descriptor.approvalRequired, true);
  console.log("OK: Agent tool adapter does not classify project tools as GitHub");
}

{
  const descriptor = toolDescriptorFromAgentTool({ name: "merge_github_pr" });

  assert.equal(descriptor.provider, "github");
  assert.deepEqual(descriptor.requiredScopes, ["repo"]);
  assert.equal(descriptor.riskTier, "T3");
  assert.equal(descriptor.approvalRequired, true);
  console.log("OK: Agent tool adapter still recognizes explicit GitHub PR tools");
}

{
  const descriptor = toolDescriptorFromAgentTool(
    { name: "custom_partner_lookup" },
    {
      provider: "partner-api",
      requiredScopes: ["partner.read"],
      riskTier: "T1",
      approvalRequired: false,
    },
  );

  assert.equal(descriptor.provider, "partner-api");
  assert.deepEqual(descriptor.requiredScopes, ["partner.read"]);
  assert.equal(descriptor.riskTier, "T1");
  assert.equal(descriptor.approvalRequired, false);
  console.log("OK: Agent tool adapter allows explicit descriptor overrides");
}

{
  const descriptors = toolDescriptorsFromAgentTools([
    { name: "memory_search" },
    { name: "send_email" },
  ]);

  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.name),
    ["memory_search", "send_email"],
  );
  assert.equal(descriptors[1]?.approvalRequired, true);
  console.log("OK: Agent tool adapter maps tool lists");
}

console.log("\nAll Agent Tool descriptor adapter assertions passed.");
