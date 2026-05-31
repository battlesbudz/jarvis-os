import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

async function main() {
  const { buildEphemeralWorkerResultDeliverable } = await import("../ephemeralWorkerDeliverable");

  const deliverable = buildEphemeralWorkerResultDeliverable(
    {
      id: "job-worker-1",
      userId: "user-1",
      agentType: "ephemeral_agent_task",
      title: "Extract meeting action items",
      prompt: "Extract action items and owners from meeting notes.",
      input: {
        workerType: "goal_task",
        ephemeralAgent: { kind: "task_worker", template: "task_worker", cleanupMode: "delete" },
      },
    },
    {
      reply: "1. Confirm vendor owner.\n2. Schedule licensing follow-up.",
      turns: 3,
      toolCalls: [{ name: "memory_search" }],
      agentId: "agent-temp-1",
      agentName: "Temporary Worker",
      attachments: [{ name: "action-items.md" }],
      ephemeral: true,
    },
    "task_worker",
  );

  assert.equal(deliverable.userId, "user-1");
  assert.equal(deliverable.jobId, "job-worker-1");
  assert.equal(deliverable.agentType, "ephemeral_agent_task");
  assert.equal(deliverable.type, "worker_result");
  assert.equal(deliverable.title, "Extract meeting action items");
  assert.equal(deliverable.status, "pending_approval");
  assert.match(deliverable.summary ?? "", /Temporary Worker completed/);
  assert.match(deliverable.body, /Confirm vendor owner/);
  assert.deepEqual(deliverable.meta, {
    workerType: "goal_task",
    ephemeralAgentKind: "task_worker",
    ephemeralAgentId: "agent-temp-1",
    cleanupMode: "delete",
    turns: 3,
    toolCallsCount: 1,
    attachments: [{ name: "action-items.md" }],
  });

  console.log("OK: ephemeral worker results are converted into reviewable deliverables");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
