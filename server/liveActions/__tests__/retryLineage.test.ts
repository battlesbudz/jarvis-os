import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

async function main(): Promise<void> {
  const { submitAgentJob } = await import("../../agent/jobClient");
  let duplicateChecks = 0;
  let insertedInput: Record<string, unknown> | null = null;
  const result = await submitAgentJob({
    userId: "user-1",
    agentType: "research",
    title: "Retry research",
    prompt: "Retry the same logical work",
    input: {
      retryOfJobId: "job-failed",
      liveActionLineageKey: "job-root",
    },
  }, {
    findDuplicate: async () => {
      duplicateChecks += 1;
      return { id: "unrelated-active-job", title: "Retry research" };
    },
    insertJob: async (values) => {
      insertedInput = values.input;
      return "job-retry";
    },
  });

  assert.equal(duplicateChecks, 0, "an explicit retry must not alias to an unrelated duplicate job");
  assert.deepEqual(result, { id: "job-retry", isDuplicate: false });
  assert.equal(insertedInput?.retryOfJobId, "job-failed");
  assert.equal(insertedInput?.liveActionLineageKey, "job-root");
}

main().then(() => console.log("Live Action retry lineage and duplicate-guard assertions passed.")).catch((error) => {
  console.error(error);
  process.exit(1);
});
