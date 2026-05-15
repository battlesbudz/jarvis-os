import assert from "node:assert/strict";
import { routeAppCoachChatAutonomy, type AppCoachChatAutonomyResult } from "../appCoachChatAutonomy";

async function main(): Promise<void> {
  const submitted: Array<{
    userId: string;
    agentType: string;
    title: string;
    prompt: string;
    input?: Record<string, unknown>;
  }> = [];
  const savedHistory: Array<{ userId: string; data: unknown[] }> = [];
  const interactions: Array<{ userId: string; channel: string; direction: string; text: string }> = [];

  const result = await routeAppCoachChatAutonomy(
    {
      userId: "user_app_1",
      messages: [
        { role: "assistant", content: "What are we working on?" },
        { role: "user", content: "research CRM options and make a report" },
      ],
      originChannel: "appchat",
    },
    {
      getReadiness: async () => "ready",
      submitJob: async (job) => {
        submitted.push({
          userId: job.userId,
          agentType: job.agentType,
          title: job.title,
          prompt: job.prompt,
          input: job.input,
        });
        return { id: "job_app_research_1", isDuplicate: false };
      },
      saveChatHistory: async (entry) => {
        savedHistory.push(entry);
      },
      logInteraction: async (entry) => {
        interactions.push(entry);
      },
      now: () => 1_700_000_000_000,
    },
  );

  assert.equal(result.handled, true);
  assert.equal(result.jobId, "job_app_research_1");
  assert.match(result.reply ?? "", /queued/i);
  assert.doesNotMatch(result.reply ?? "", /can't browse|cannot browse|I can't/i);

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].userId, "user_app_1");
  assert.equal(submitted[0].agentType, "deep_research");
  assert.equal(submitted[0].prompt, "research CRM options and make a report");
  assert.equal(submitted[0].input?.originChannel, "App Chat");
  assert.equal(submitted[0].input?.autonomyPolicy, true);

  assert.equal(savedHistory.length, 1);
  assert.equal(savedHistory[0].userId, "user_app_1");
  assert.deepEqual(savedHistory[0].data.slice(0, 2), [
    {
      id: "1700000000001",
      role: "assistant",
      content: result.reply,
    },
    {
      id: "1700000000000",
      role: "user",
      content: "research CRM options and make a report",
    },
  ]);

  assert.deepEqual(interactions, [
    {
      userId: "user_app_1",
      channel: "app_chat",
      direction: "inbound",
      text: "research CRM options and make a report",
    },
    {
      userId: "user_app_1",
      channel: "app_chat",
      direction: "outbound",
      text: result.reply,
    },
  ]);

  {
    const submittedWithFailingPersistence: Array<{ agentType: string; prompt: string }> = [];
    const originalWarn = console.warn;
    console.warn = () => {};
    let resilientResult: AppCoachChatAutonomyResult | null = null;
    try {
      resilientResult = await routeAppCoachChatAutonomy(
        {
          userId: "user_app_2",
          messages: [
            { role: "user", content: "research POS systems and make a report" },
          ],
          originChannel: "appchat",
        },
        {
          getReadiness: async () => "ready",
          submitJob: async (job) => {
            submittedWithFailingPersistence.push({
              agentType: job.agentType,
              prompt: job.prompt,
            });
            return { id: "job_app_research_2", isDuplicate: false };
          },
          saveChatHistory: async () => {
            throw new Error("db unavailable");
          },
          logInteraction: async () => {
            throw new Error("log unavailable");
          },
        },
      );
    } finally {
      console.warn = originalWarn;
    }

    assert(resilientResult);
    assert.equal(resilientResult.handled, true);
    assert.equal(resilientResult.jobId, "job_app_research_2");
    assert.match(resilientResult.reply ?? "", /queued/i);
    assert.equal(submittedWithFailingPersistence.length, 1);
    assert.equal(submittedWithFailingPersistence[0].agentType, "deep_research");
  }

  console.log("All app coach chat autonomy assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
