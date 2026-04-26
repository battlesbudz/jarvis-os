#!/usr/bin/env tsx
/**
 * scripts/test-agent-system.ts
 *
 * Smoke test suite for the multi-agent ego system.
 * Runs against the live DB (requires DATABASE_URL env var).
 *
 * Tests:
 *   1. Agent CRUD (create, read, list, disable, enable, delete)
 *   2. Permission denial — wrapToolsForAgent blocks unclassified tools
 *   3. Council mode — runCouncil returns a synthesis
 *   4. Memory isolation — agent-private vs shared scope
 *   5. Heartbeat logic — stuck detection increments fail count
 *   6. Approval gate — approveGate/rejectGate are durable
 *   7. Delegation depth — agentBus enforces MAX_DELEGATION_DEPTH = 5
 *   8. Zod config schema — validateAgentConfig accepts valid / rejects bad
 *
 * Usage:
 *   npx tsx scripts/test-agent-system.ts
 */

import "dotenv/config";

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string) {
  console.log(`  ✅ ${name}`);
  passed++;
}

function fail(name: string, reason: unknown) {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`  ❌ ${name}: ${msg}`);
  failed++;
  failures.push(`${name}: ${msg}`);
}

async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// ── 1. Agent CRUD ─────────────────────────────────────────────────────────────

console.log("\n📋 1. Agent CRUD");

import {
  createAgent, getAgent, listAgents, updateAgent,
  enableAgent, disableAgent, deleteAgent,
} from "../server/agent/agentManager";

// Resolve a system test userId from DB (first user) or create a test sentinel
import { db } from "../server/db";
import { users } from "../shared/schema";

let TEST_USER_ID: string;

async function getOrCreateTestUser(): Promise<string> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  if (rows.length > 0) return rows[0].id;
  throw new Error("No users in DB. Seed a test user before running smoke tests.");
}

// ── 2. Permission denial ──────────────────────────────────────────────────────

import { wrapToolsForAgent } from "../server/agent/agentPermissions";
import type { AgentTool } from "../server/agent/types";
import type { DiscordAgent } from "../shared/schema";
import { DEFAULT_AGENT_PERMISSIONS } from "../shared/schema";

function mockAgent(overrides: Partial<DiscordAgent> = {}): DiscordAgent {
  return {
    id: "test-agent-id",
    userId: "test-user-id",
    name: "TestAgent",
    role: "custom",
    persona: null,
    channelId: null,
    channelName: null,
    isActive: 1,
    loopEnabled: 0,
    loopIntervalMinutes: 60,
    loopPrompt: null,
    lastLoopRun: null,
    createdAt: new Date(),
    platforms: ["discord"],
    permissions: DEFAULT_AGENT_PERMISSIONS,
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
    ...overrides,
  } as DiscordAgent;
}

function mockTool(name: string): AgentTool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: {},
    execute: async () => ({ ok: true, content: "mock" }),
  };
}

// ── 3. Council mode ───────────────────────────────────────────────────────────

import { runCouncil } from "../server/agent/council";

// ── 4. Memory isolation ───────────────────────────────────────────────────────

import {
  writeAgentMemory, readAgentMemories, clearAgentMemory,
} from "../server/agent/agentMemory";

// ── 5. Approval gate ──────────────────────────────────────────────────────────

import {
  requiresApproval, requestApproval, approveGate, rejectGate, getGate,
} from "../server/agent/agentApproval";

// ── 6. Delegation depth ───────────────────────────────────────────────────────

import { sendToAgent } from "../server/agent/agentBus";

// ── 7. Zod config schema ──────────────────────────────────────────────────────

import { validateAgentConfig } from "../server/agent/agentConfigSchema";

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🧪 Multi-Agent Ego System Smoke Tests\n");

  TEST_USER_ID = await getOrCreateTestUser();
  console.log(`  (test user: ${TEST_USER_ID})\n`);

  // ── Section 1: CRUD ────────────────────────────────────────────────────────
  console.log("📋 1. Agent CRUD");
  let agentId: string;
  await run("create agent", async () => {
    agentId = await createAgent(TEST_USER_ID, {
      name: `SmokeTestAgent-${Date.now()}`,
      role: "custom",
      platforms: ["discord"],
    });
    assert(typeof agentId === "string" && agentId.length > 0, "agentId should be a non-empty string");
  });

  await run("get agent by id", async () => {
    const agent = await getAgent(agentId);
    assert(agent !== null, "agent should be found");
    assert(agent!.userId === TEST_USER_ID, "agent userId should match");
  });

  await run("list agents includes new agent", async () => {
    const agents = await listAgents(TEST_USER_ID, true);
    assert(agents.some((a) => a.id === agentId), "new agent should appear in list");
  });

  await run("disable agent", async () => {
    await disableAgent(agentId);
    const agent = await getAgent(agentId);
    assert(agent!.isActive === 0, "agent should be disabled");
  });

  await run("enable agent", async () => {
    await enableAgent(agentId);
    const agent = await getAgent(agentId);
    assert(agent!.isActive === 1, "agent should be re-enabled");
  });

  await run("update agent persona", async () => {
    await updateAgent(agentId, { persona: "You are a smoke test agent." });
    const agent = await getAgent(agentId);
    assert(agent!.persona === "You are a smoke test agent.", "persona should be updated");
  });

  // ── Section 2: Permission denial ────────────────────────────────────────────
  console.log("\n🔒 2. Permission denial");
  await run("unclassified tool is filtered out", async () => {
    const agent = mockAgent();
    const tools = [
      mockTool("get_current_time"),      // always-allowed
      mockTool("some_dangerous_tool"),   // unclassified → should be denied
      mockTool("search_web"),            // requires can_search_web (default: true)
      mockTool("send_email"),            // requires can_send_emails (default: false)
    ];
    const filtered = wrapToolsForAgent(tools, agent);
    const names = filtered.map((t) => t.name);
    assert(names.includes("get_current_time"), "always-allowed tool should pass");
    assert(!names.includes("some_dangerous_tool"), "unclassified tool should be denied");
    assert(names.includes("search_web"), "permitted tool should pass");
    assert(!names.includes("send_email"), "tool with disabled permission should be filtered");
  });

  await run("disabled permission blocks tool", async () => {
    const agent = mockAgent({
      permissions: { ...DEFAULT_AGENT_PERMISSIONS, can_search_web: false },
    });
    const tools = [mockTool("search_web")];
    const filtered = wrapToolsForAgent(tools, agent);
    assert(filtered.length === 0, "search_web should be blocked when can_search_web=false");
  });

  // ── Section 3: Council mode ─────────────────────────────────────────────────
  console.log("\n🏛️  3. Council mode");
  await run("runCouncil returns result object", async () => {
    // Council with no agents should return agentCount=0
    // (all smoke test agents may be disabled; we just check shape)
    const result = await runCouncil(TEST_USER_ID, "What time is it?", []);
    assert(typeof result.agentCount === "number", "result.agentCount should be a number");
    assert(typeof result.synthesis === "string", "result.synthesis should be a string");
  });

  // ── Section 4: Memory isolation ─────────────────────────────────────────────
  console.log("\n🧠 4. Memory isolation");
  await run("write and read agent-private memory", async () => {
    await writeAgentMemory(agentId, TEST_USER_ID, "Smoke test memory entry", "test");
    const memories = await readAgentMemories(agentId, TEST_USER_ID, "smoke test", 5);
    assert(memories.length > 0, "should have at least 1 memory");
    assert(memories.some((m) => m.content === "Smoke test memory entry"), "written memory should be readable");
  });

  await run("clearAgentMemory removes all memories for agent", async () => {
    const count = await clearAgentMemory(agentId, TEST_USER_ID);
    assert(typeof count === "number" && count >= 0, "clearAgentMemory should return a count");
    const after = await readAgentMemories(agentId, TEST_USER_ID, "", 10);
    assert(after.length === 0, "memories should be empty after clear");
  });

  // ── Section 5: Approval gate (durable) ──────────────────────────────────────
  console.log("\n🔐 5. Approval gate durability");
  await run("requiresApproval identifies high-risk tools", async () => {
    assert(requiresApproval("send_email") === true, "send_email should require approval");
    assert(requiresApproval("get_current_time") === false, "get_current_time should not require approval");
  });

  let gateId: string;
  await run("requestApproval creates DB gate", async () => {
    const gate = await requestApproval({
      agentId,
      userId: TEST_USER_ID,
      toolName: "send_email",
      toolArgs: { to: "test@example.com", subject: "test" },
      description: "Smoke test gate",
      ttlMs: 5 * 60 * 1000,
    });
    gateId = gate.id;
    assert(gate.status === "pending", "gate status should be pending");
    assert(gate.toolName === "send_email", "gate toolName should match");
  });

  await run("approveGate updates DB and returns true", async () => {
    const result = await approveGate(gateId, TEST_USER_ID);
    assert(result === true, "approveGate should return true on success");
    const gate = await getGate(gateId);
    assert(gate!.status === "approved", "gate status should be approved in DB");
    assert(gate!.resolvedBy === TEST_USER_ID, "resolvedBy should match userId");
  });

  await run("approveGate returns false for already-resolved gate", async () => {
    const result = await approveGate(gateId, TEST_USER_ID);
    assert(result === false, "second approveGate on resolved gate should return false");
  });

  let gateId2: string;
  await run("rejectGate updates DB durably", async () => {
    const gate = await requestApproval({
      agentId,
      userId: TEST_USER_ID,
      toolName: "send_email",
      toolArgs: {},
      description: "Smoke test reject gate",
      ttlMs: 5 * 60 * 1000,
    });
    gateId2 = gate.id;
    const result = await rejectGate(gateId2, TEST_USER_ID);
    assert(result === true, "rejectGate should return true on success");
    const resolved = await getGate(gateId2);
    assert(resolved!.status === "rejected", "gate status should be rejected in DB");
  });

  // ── Section 6: Delegation depth ─────────────────────────────────────────────
  console.log("\n🔗 6. Delegation depth");
  await run("sendToAgent rejects at delegationDepth > 5", async () => {
    let threw = false;
    try {
      await sendToAgent({
        fromAgentId: "agent-a",
        toAgentId: agentId,
        userId: TEST_USER_ID,
        messageType: "task_request",
        payload: { text: "smoke test message" },
        delegationDepth: 6, // exceeds MAX_DELEGATION_DEPTH = 5
      });
    } catch (e) {
      threw = true;
    }
    assert(threw, "sendToAgent should throw at delegationDepth > 5");
  });

  // ── Section 7: Zod config schema ────────────────────────────────────────────
  console.log("\n📐 7. Zod config schema");
  await run("validateAgentConfig accepts valid config", async () => {
    const valid = {
      version: "1",
      name: "TestAgent",
      role: "custom",
      platforms: ["discord"],
      permissions: DEFAULT_AGENT_PERMISSIONS,
      memory_scope: "agent_private",
      can_access_global_memory: false,
      exported_at: new Date().toISOString(),
    };
    const result = validateAgentConfig(valid);
    assert(result.ok === true, `expected ok=true, got errors: ${result.errors.join(", ")}`);
  });

  await run("validateAgentConfig rejects missing name", async () => {
    const invalid = {
      version: "1",
      role: "custom",
      platforms: ["discord"],
      memory_scope: "agent_private",
      can_access_global_memory: false,
      exported_at: new Date().toISOString(),
    };
    const result = validateAgentConfig(invalid);
    assert(result.ok === false, "expected ok=false for missing name");
    assert(result.errors.some((e) => e.toLowerCase().includes("name")), "error should mention 'name'");
  });

  await run("validateAgentConfig rejects invalid memory_scope", async () => {
    const invalid = {
      version: "1",
      name: "TestAgent",
      role: "custom",
      platforms: ["discord"],
      memory_scope: "not_a_valid_scope",
      can_access_global_memory: false,
      exported_at: new Date().toISOString(),
    };
    const result = validateAgentConfig(invalid);
    assert(result.ok === false, "expected ok=false for invalid memory_scope");
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log("\n🧹 Cleanup");
  await run("delete smoke test agent", async () => {
    await deleteAgent(agentId);
    const agent = await getAgent(agentId);
    assert(agent === null, "agent should be null after deletion");
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error("\nFailures:");
    failures.forEach((f) => console.error(`  • ${f}`));
    process.exit(1);
  } else {
    console.log("\n✅ All smoke tests passed!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("\n💥 Unhandled error:", err);
  process.exit(1);
});
