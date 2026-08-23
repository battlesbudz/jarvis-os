import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

async function main(): Promise<void> {
  const { submitAgentJob } = await import("../../agent/jobClient");
  let duplicateChecks = 0;
  let insertedInput: Record<string, unknown> | null = null;
  const retryInput = {
    userId: "user-1",
    agentType: "research" as const,
    title: "Retry research",
    prompt: "Retry the same logical work",
    input: {
      retryOfJobId: "job-failed",
      liveActionLineageKey: "job-root",
    },
  };
  const untrusted = await submitAgentJob(retryInput, {
    findDuplicate: async () => {
      duplicateChecks += 1;
      return { id: "unrelated-active-job", title: "Retry research" };
    },
    insertJob: async () => {
      throw new Error("unvalidated retries must not bypass deduplication");
    },
  });

  assert.equal(duplicateChecks, 1);
  assert.deepEqual(untrusted, { id: "unrelated-active-job", isDuplicate: true });

  const result = await submitAgentJob(retryInput, {
    findDuplicate: async () => null,
    insertJob: async (values) => {
      insertedInput = values.input;
      return "job-retry";
    },
  });

  assert.deepEqual(result, { id: "job-retry", isDuplicate: false });
  assert.equal(insertedInput?.retryOfJobId, "job-failed");
  assert.equal(insertedInput?.liveActionLineageKey, "job-root");

  duplicateChecks = 0;
  const trusted = await submitAgentJob(retryInput, {
    skipDuplicateCheck: true,
    findDuplicate: async () => {
      duplicateChecks += 1;
      return { id: "unrelated-active-job", title: "Retry research" };
    },
    insertJob: async () => "trusted-retry",
  });
  assert.deepEqual(trusted, { id: "trusted-retry", isDuplicate: false });
  assert.equal(duplicateChecks, 0, "validated retries bypass unrelated title dedupe");
}

main().then(() => console.log("Live Action retry lineage and duplicate-guard assertions passed.")).catch((error) => {
  console.error(error);
  process.exit(1);
});
