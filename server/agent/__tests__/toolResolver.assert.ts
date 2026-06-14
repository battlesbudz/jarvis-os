import assert from "node:assert/strict";
import { classifyActionOntology } from "../actionOntology";
import { resolveToolsForAction } from "../toolResolver";

function resolve(text: string) {
  return resolveToolsForAction(classifyActionOntology(text));
}

function assertIncludes(values: string[], expected: string, label: string) {
  assert.ok(values.includes(expected), `${label}: expected ${expected}`);
}

function assertExcludes(values: string[], unexpected: string, label: string) {
  assert.ok(!values.includes(unexpected), `${label}: did not expect ${unexpected}`);
}

{
  const result = resolve('Can you add "Make $140 on DoorDash" as a recurring task every day?');
  assertIncludes(result.requiredToolNames, "schedule_jarvis_task", "user task");
  assertExcludes(result.requiredToolNames, "queue_background_job", "user task");
  assertIncludes(result.blockedToolNames, "cron_create", "user task blocks executable cron");
  assert.match(result.reason, /user task|personal/i);
}

{
  const result = resolve("Check my Gmail every morning and summarize important emails");
  assertIncludes(result.requiredToolNames, "connected_accounts_list", "gmail read");
  assertIncludes(result.requiredToolNames, "connected_accounts_execute", "gmail read");
  assertExcludes(result.requiredToolNames, "send_email", "gmail read");
  assertExcludes(result.blockedToolNames, "connected_accounts_execute", "gmail read allows read execution path");
}

{
  const result = resolve("Send an email to Sam saying the appointment moved");
  assertIncludes(result.requiredToolNames, "connected_accounts_execute", "email send");
  assertIncludes(result.blockedToolNames, "send_email", "email send blocks legacy direct send");
  assert.equal(result.approvalRequired, true);
}

{
  const result = resolve("Fix your scheduler bug and push it");
  assertIncludes(result.requiredToolNames, "delegate_to_codex", "code apply");
  assertIncludes(result.optionalToolNames, "list_source_files", "code apply");
  assert.equal(result.approvalRequired, true);
}

{
  const result = resolve("Deploy this to Railway");
  assertIncludes(result.requiredToolNames, "deploy_app", "system admin");
  assertIncludes(result.requiredToolNames, "project_shell", "system admin");
  assert.equal(result.approvalRequired, true);
}

{
  const result = resolve("Research NY dispensaries for outreach leads");
  assertIncludes(result.requiredToolNames, "queue_background_job", "cloud worker research");
  assertIncludes(result.optionalToolNames, "search_web", "cloud worker research");
}

{
  const result = resolve("Drive to Walmart and buy printer paper");
  assert.equal(result.requiredToolNames.length, 0);
  assertIncludes(result.blockedToolNames, "daemon_action", "blocked physical action");
  assertIncludes(result.blockedToolNames, "schedule_jarvis_task", "blocked physical action");
}

console.log("OK: tool resolver narrows tools by action ontology");
