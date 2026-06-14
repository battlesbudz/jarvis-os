import assert from "node:assert/strict";
import { runJarvisOsSmoke } from "../osSmoke";

async function main(): Promise<void> {
  const events: string[] = [];

  const result = await runJarvisOsSmoke({
    userText: "Research local grant options and make a short report",
    readiness: "ready",
    hasApproval: false,
    queueBackgroundJob: async (job) => {
      events.push(`${job.agentType}:${job.title}`);
      return { jobId: "job_123" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "queue_background_job");
  assert.equal(result.jobId, "job_123");
  assert.deepEqual(events, ["deep_research:Research local grant options"]);

  const approvalResult = await runJarvisOsSmoke({
    userText: "Send an email to the regulator",
    readiness: "ready",
    hasApproval: false,
    queueBackgroundJob: async () => {
      throw new Error("queue should not run");
    },
  });

  assert.equal(approvalResult.ok, true);
  assert.equal(approvalResult.mode, "requires_approval");
  assert.equal(approvalResult.jobId, undefined);

  console.log("All Jarvis OS smoke assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
