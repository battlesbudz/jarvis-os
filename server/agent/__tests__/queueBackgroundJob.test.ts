import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

async function main() {
  const { buildCloudBackgroundJobInput } = await import("../cloudBackgroundEscalation");
  const { buildQueueBackgroundJobInput } = await import("../tools/queueBackgroundJobInput");
  const queueToolSource = readFileSync(
    fileURLToPath(new URL("../tools/queueBackgroundJob.ts", import.meta.url).toString()),
    "utf8",
  );
  const jobQueueSource = readFileSync(
    fileURLToPath(new URL("../jobQueue.ts", import.meta.url).toString()),
    "utf8",
  );
  const subagentsSource = readFileSync(
    fileURLToPath(new URL("../subagents.ts", import.meta.url).toString()),
    "utf8",
  );
  const harnessSource = readFileSync(
    fileURLToPath(new URL("../harness.ts", import.meta.url).toString()),
    "utf8",
  );

  {
    assert.match(queueToolSource, /one-off scoped worker/i);
    assert.match(queueToolSource, /Do not use it for normal tutoring/i);
    assert.doesNotMatch(queueToolSource, /temporary Study Agent|study help|quiz-style/i);
    console.log("OK: queue tool describes ephemeral jobs as one-off workers, not study sessions");
  }

  {
    const input = buildQueueBackgroundJobInput("ephemeral_agent_task", {
      channel: "telegram",
      originChannelId: "telegram-chat-1",
      discordChannelId: "discord-channel-1",
    });

    assert.equal(input.workerType, "goal_task");
    assert.equal(input.originChannel, "telegram");
    assert.equal(input.originChannelId, "telegram-chat-1");
    assert.equal(input.originDiscordChannelId, "discord-channel-1");
    assert.deepEqual(input.ephemeralAgent, {
      kind: "task_worker",
      template: "task_worker",
      cleanupMode: "delete",
    });
    assert.equal(input.model, undefined);
    console.log("OK: ephemeral one-off worker jobs carry worker and lifecycle metadata");
  }

  {
    const input = buildQueueBackgroundJobInput("research", {
      channel: "app",
      originChannelId: undefined,
      discordChannelId: undefined,
    });

    assert.equal(input.model, "gpt-4.1-mini");
    assert.equal(input.originChannel, "app");
    assert.equal(input.originDiscordChannelId, undefined);
    assert.equal(input.workerType, undefined);
    assert.equal(input.ephemeralAgent, undefined);
    console.log("OK: normal queued jobs keep model routing without ephemeral metadata");
  }

  {
    const input = buildQueueBackgroundJobInput(
      "research",
      {
        channel: "voice",
        originChannelId: "voice-session-1",
        discordChannelId: undefined,
      },
      buildCloudBackgroundJobInput({
        prompt: "Research this competitor and write a report.",
        provider: {
          id: "google",
          label: "Gemini",
          authType: "api_key",
          requiresBudget: true,
          hint: "Gemini API key, budget required",
        },
        budgetUsd: 3,
        approvalGateId: "gate_cloud_google",
      }),
    );

    const task = input.cloudBackgroundTask as Record<string, unknown>;
    assert.equal(input.model, "google/gemini-2.5-flash");
    assert.equal(input.originChannel, "voice");
    assert.equal(input.originChannelId, "voice-session-1");
    assert.equal(task.providerId, "google");
    assert.equal(task.providerLabel, "Gemini");
    assert.equal(task.providerAuthType, "api_key");
    assert.equal(task.approvedModel, "google/gemini-2.5-flash");
    assert.equal(task.approvalGateId, "gate_cloud_google");
    assert.equal(task.budgetUsd, 3);
    assert.equal(task.liveModelSwitch, false);
    assert.deepEqual(task.disallowedCapabilities, ["phone_control", "memory_write"]);
    console.log("OK: queue input preserves task-scoped cloud metadata without switching live chat");
  }

  {
    assert.match(jobQueueSource, /validateCloudBackgroundJobInput\(jobInput\)/);
    assert.match(jobQueueSource, /cloudBackgroundValidation\.model/);
    assert.match(jobQueueSource, /forceModel: cloudBackgroundValidation\?\.ok === true/);
    assert.match(jobQueueSource, /maxCloudBackgroundModelTurnsForBudget/);
    assert.match(jobQueueSource, /cloudBackgroundBudgetGuardForRun/);
    assert.match(jobQueueSource, /buildCompactCloudBackgroundResultPacket/);
    assert.match(jobQueueSource, /cloudBackgroundBudgetStopped/);
    assert.match(jobQueueSource, /task_scoped_cloud_approved_route_guard/);
    assert.match(jobQueueSource, /getProviderStatus\(\{ userId: job\.userId \}\)/);
    assert.match(jobQueueSource, /no longer connected with the approved/);
    assert.match(jobQueueSource, /cloudBackgroundEstimatedSpendOf\(jobInput\)/);
    assert.match(jobQueueSource, /withCloudBackgroundEstimatedSpend\(jobInput, cloudBackgroundEstimatedSpentUsd\)/);
    assert.match(jobQueueSource, /cloudBackgroundApprovalGateMatches/);
    assert.match(jobQueueSource, /schema\.agentApprovalGates/);
    assert.match(jobQueueSource, /Cloud background task approval could not be verified/);
    assert.match(jobQueueSource, /latestJobInput/);
    assert.match(jobQueueSource, /update\(schema\.agentJobs\)/);
    assert.match(jobQueueSource, /preferredAuthType: cloudBackgroundPreferredAuthType/);
    assert.match(jobQueueSource, /failJob\(job\.id, cloudBackgroundValidation\.message/);
    assert.match(queueToolSource, /CLOUD_BACKGROUND_AGENT_TYPES/);
    assert.match(queueToolSource, /providerLabelFromStatus/);
    assert.match(queueToolSource, /catalogProviderLabel/);
    assert.match(queueToolSource, /toolCallHooks\.register/);
    assert.match(queueToolSource, /Approve cloud background task/);
    assert.match(queueToolSource, /_approved_cloud_background/);
    assert.match(queueToolSource, /_approval_gate_id/);
    assert.match(queueToolSource, /approvalGateId/);
    assert.match(queueToolSource, /getProviderStatus/);
    assert.match(queueToolSource, /Cloud provider not connected/);
    assert.match(queueToolSource, /Cloud background job type unsupported/);
    assert.match(queueToolSource, /OAuth\/subscription background routing is only supported for OpenAI/);
    assert.match(queueToolSource, /CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD/);
    assert.match(subagentsSource, /forceModel: opts\.forceModel/);
    assert.match(subagentsSource, /preferredAuthType: opts\.preferredAuthType/);
    assert.match(subagentsSource, /approvalReceipt: opts\.approvalReceipt/);
    assert.match(subagentsSource, /finishReason: result\.finishReason/);
    assert.match(subagentsSource, /result\.finishReason !== "budget_stopped"/);
    assert.match(harnessSource, /forceModel \? null : await getSelectedModelPreference/);
    assert.match(harnessSource, /preferredAuthType/);
    assert.match(harnessSource, /estimateCloudBudgetUsdForTokens/);
    assert.match(harnessSource, /stopped before the next model request/);
    assert.match(harnessSource, /if \(forceModel\) return null/);
    console.log("OK: job queue validates cloud task provider and budget before worker execution");
  }

  console.log("\nAll queue background job assertions passed.");
}

void main();
