import assert from "node:assert/strict";

import { DEFAULT_AGENT_PERMISSIONS, type AgentPermissions, type DiscordAgent } from "@shared/schema";

import { checkPermission, getPermittedToolNames, PermissionDeniedError } from "../agentPermissions";
import { requiresApproval } from "../approvalToolRisk";

function makeAgent(permOverrides: Partial<AgentPermissions> = {}): DiscordAgent {
  return {
    id: "test-agent-id",
    userId: "test-user-id",
    name: "Test Agent",
    role: "custom",
    persona: null,
    channelId: null,
    channelName: null,
    isActive: 1,
    loopEnabled: 0,
    loopIntervalMinutes: null,
    loopPrompt: null,
    lastLoopRun: null,
    createdAt: new Date(),
    platforms: ["discord"],
    permissions: { ...DEFAULT_AGENT_PERMISSIONS, ...permOverrides },
    memoryScope: "agent_private",
    accessGlobalMemory: false,
    allowedUsers: [],
    allowedConversations: [],
    privateMode: false,
    platformChannels: {},
    configJson: null,
    lastHeartbeatAt: null,
    stuckSince: null,
    heartbeatFailCount: 0,
    preferredModel: null,
    mentionPatterns: [],
  };
}

async function main(): Promise<void> {
  assert.equal(
    requiresApproval("create_gmail_draft"),
    true,
    "create_gmail_draft must require approval",
  );
  assert.equal(
    requiresApproval("gmail_draft"),
    true,
    "legacy gmail_draft alias must keep requiring approval",
  );

  const draftAgent = makeAgent({ can_create_email_drafts: true });
  assert.doesNotThrow(() => checkPermission(draftAgent, "create_gmail_draft"));
  assert.doesNotThrow(() => checkPermission(draftAgent, "gmail_draft"));

  const permitted = getPermittedToolNames(draftAgent);
  assert.ok(permitted.includes("create_gmail_draft"));
  assert.ok(permitted.includes("gmail_draft"));

  const noDraftAgent = makeAgent({ can_create_email_drafts: false });
  assert.throws(
    () => checkPermission(noDraftAgent, "create_gmail_draft"),
    (err) => err instanceof PermissionDeniedError && err.flag === "can_create_email_drafts",
  );

  const memoryAgent = makeAgent({ can_access_global_memory: true });
  assert.doesNotThrow(() => checkPermission(memoryAgent, "memory_save"));
  assert.ok(getPermittedToolNames(memoryAgent).includes("memory_save"));

  const noMemoryAgent = makeAgent({ can_access_global_memory: false });
  assert.throws(
    () => checkPermission(noMemoryAgent, "memory_save"),
    (err) => err instanceof PermissionDeniedError && err.flag === "can_access_global_memory",
  );

  console.log("approval consistency assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
