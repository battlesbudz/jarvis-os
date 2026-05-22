import assert from "node:assert/strict";
import { continueTopLevelApproval } from "../topLevelApprovalContinuation";
import type { ApprovalGate } from "../agentApproval";

function makeGate(overrides: Partial<ApprovalGate> = {}): ApprovalGate {
  const now = new Date();
  return {
    id: "gate_123",
    agentId: "coach_app:user_1",
    userId: "user_1",
    toolName: "send_email",
    toolArgs: {
      topLevelAutonomy: true,
      userText: "Send this email to the regulator",
      channelName: "Gateway",
    },
    description: "Approval needed",
    status: "approved",
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  };
}

async function main(): Promise<void> {
  {
    const jobs: Array<{
      userId: string;
      agentType: string;
      title: string;
      prompt: string;
      input?: Record<string, unknown>;
    }> = [];

    const result = await continueTopLevelApproval(makeGate(), {
      submitJob: async (job) => {
        jobs.push(job);
        return { id: "job_approved", isDuplicate: false };
      },
    });

    assert.equal(result.continued, true);
    assert.equal(result.jobId, "job_approved");
    assert.equal(result.agentType, "email");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].userId, "user_1");
    assert.equal(jobs[0].agentType, "email");
    assert.match(jobs[0].title, /Approved action/i);
    assert.match(jobs[0].prompt, /approved this top-level Jarvis action/i);
    assert.match(jobs[0].prompt, /Send this email to the regulator/i);
    assert.equal(jobs[0].input?.originApprovalGateId, "gate_123");
    assert.equal(jobs[0].input?.approvedTopLevelAction, true);
    assert.equal(jobs[0].input?.originChannel, "Gateway");
    const receipt = jobs[0].input?.approvalReceipt as Record<string, unknown> | undefined;
    assert.equal(receipt?.gateId, "gate_123");
    assert.equal(receipt?.userId, "user_1");
    assert.equal(receipt?.toolName, "send_email");
    assert.equal(receipt?.scope, "top_level_action");
    assert.equal(receipt?.originalUserText, "Send this email to the regulator");
  }

  {
    let submitCalls = 0;
    const result = await continueTopLevelApproval(
      makeGate({
        agentId: "named_agent_1",
        toolArgs: { userText: "Send this email to the regulator", channelName: "Gateway" },
      }),
      {
        submitJob: async () => {
          submitCalls += 1;
          return { id: "should_not_queue", isDuplicate: false };
        },
      },
    );

    assert.equal(result.continued, false);
    assert.equal(submitCalls, 0);
  }

  console.log("All top-level approval continuation assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
