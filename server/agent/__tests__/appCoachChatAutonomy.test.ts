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
  assert.match(result.reply ?? "", /Open Inbox/i);
  assert.match(result.reply ?? "", /Needs your review/i);
  assert.doesNotMatch(result.reply ?? "", /can't browse|cannot browse|I can't/i);

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].userId, "user_app_1");
  assert.equal(submitted[0].agentType, "deep_research");
  assert.equal(submitted[0].prompt, "research CRM options and make a report");
  assert.equal(submitted[0].input?.originChannel, "App Chat");
  assert.equal(submitted[0].input?.autonomyPolicy, true);

  {
    const followUpJobs: Array<{ agentType: string; prompt: string }> = [];
    const followUp = await routeAppCoachChatAutonomy(
      {
        userId: "user_app_follow_up",
        messages: [
          { role: "user", content: "Tell me about sunflower seeds." },
          { role: "assistant", content: "Sunflower seeds are nutritious and versatile." },
          { role: "user", content: "Make me a report on sunflower seeds and give it to me as a PDF." },
          { role: "assistant", content: "Here is a short inline report." },
          { role: "user", content: "No, the whole point was for you to do a background research task and give this report back to me as a file." },
        ],
        originChannel: "voice",
      },
      {
        getReadiness: async () => "ready",
        submitJob: async (job) => {
          followUpJobs.push({ agentType: job.agentType, prompt: job.prompt });
          return { id: "job_app_follow_up", isDuplicate: false };
        },
      },
    );

    assert.equal(followUp.handled, true);
    assert.equal(followUpJobs.length, 1);
    assert.equal(followUpJobs[0].agentType, "deep_research");
    assert.match(followUpJobs[0].prompt, /sunflower seeds/i);
    assert.match(followUpJobs[0].prompt, /PDF/i);
    assert.match(followUpJobs[0].prompt, /Latest user request:/);
    assert.match(followUpJobs[0].prompt, /background research task/i);
  }

  {
    const ellipticalJobs: Array<{ agentType: string; prompt: string }> = [];
    const elliptical = await routeAppCoachChatAutonomy(
      {
        userId: "user_app_elliptical_pdf",
        messages: [
          { role: "user", content: "Research sunflower seed nutrition." },
          { role: "assistant", content: "Here is the research summary." },
          { role: "user", content: "Make it a PDF" },
        ],
        originChannel: "voice",
      },
      {
        getReadiness: async () => "ready",
        submitJob: async (job) => {
          ellipticalJobs.push({ agentType: job.agentType, prompt: job.prompt });
          return { id: "job_app_elliptical_pdf", isDuplicate: false };
        },
      },
    );

    assert.equal(elliptical.handled, true, "elliptical PDF follow-ups enter the background route");
    assert.equal(ellipticalJobs.length, 1);
    assert.equal(ellipticalJobs[0].agentType, "deep_research");
    assert.match(ellipticalJobs[0].prompt, /sunflower seed nutrition/i);
    assert.match(ellipticalJobs[0].prompt, /Latest user request:\nMake it a PDF/);
  }

  for (const standaloneFileCase of [
    { text: "Write a PDF memo for the board", agentType: "writing" },
    { text: "Create a PDF project plan", agentType: "planning" },
  ]) {
    const standaloneJobs: string[] = [];
    const standalone = await routeAppCoachChatAutonomy(
      {
        userId: "user_app_standalone_file",
        messages: [{ role: "user", content: standaloneFileCase.text }],
        originChannel: "voice",
      },
      {
        getReadiness: async () => "ready",
        submitJob: async (job) => {
          standaloneJobs.push(job.agentType);
          return { id: `job_${standaloneFileCase.agentType}_file`, isDuplicate: false };
        },
      },
    );
    assert.equal(standalone.handled, true);
    assert.equal(standalone.decision.agentType, standaloneFileCase.agentType);
    assert.deepEqual(standaloneJobs, [standaloneFileCase.agentType]);
  }

  {
    let submitCalls = 0;
    const parserTask = await routeAppCoachChatAutonomy(
      {
        userId: "user_app_json_parser",
        messages: [{ role: "user", content: "Write a JSON parser for the import pipeline" }],
        originChannel: "appchat",
      },
      {
        getReadiness: async () => "ready",
        submitJob: async (job) => {
          submitCalls += 1;
          return { id: "job_json_parser", isDuplicate: false };
        },
      },
    );
    assert.equal(parserTask.handled, true);
    assert.equal(parserTask.decision.agentType, "writing");
    assert.equal(submitCalls, 1);
    assert.doesNotMatch(parserTask.reply || "", /can’t generate JSON/i);
  }

  {
    let submitCalls = 0;
    const unsupported = await routeAppCoachChatAutonomy(
      {
        userId: "user_app_csv",
        messages: [{ role: "user", content: "Create a downloadable JSON file with the findings" }],
        originChannel: "appchat",
      },
      {
        submitJob: async () => {
          submitCalls += 1;
          return { id: "not_queued", isDuplicate: false };
        },
      },
    );
    assert.equal(unsupported.handled, true);
    assert.match(unsupported.reply || "", /can’t generate JSON/i);
    assert.equal(submitCalls, 0);
  }

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
    const gatewayResult = await routeAppCoachChatAutonomy(
      {
        userId: "user_app_gateway",
        messages: [
          { role: "user", content: "Jarvis, the Codex gateway is down. Fix the gateway." },
        ],
        originChannel: "appchat",
      },
      {
        now: () => 1_700_000_010_000,
      },
    );

    assert.equal(gatewayResult.handled, true);
    assert.match(gatewayResult.reply ?? "", /Codex gateway/i);
    assert.match(gatewayResult.reply ?? "", /without using Codex/i);
    assert.match(gatewayResult.reply ?? "", /jarvis:oauth:gateway:doctor/i);
    assert.doesNotMatch(gatewayResult.reply ?? "", /queued/i);
  }

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
