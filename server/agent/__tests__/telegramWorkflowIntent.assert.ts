import assert from "node:assert/strict";
import { shouldTryTelegramAgentSdkWorkflow } from "../../telegramWorkflowIntent";

assert.equal(
  shouldTryTelegramAgentSdkWorkflow("reply with FAST ROUTE OK"),
  false,
  "plain reply-with commands must stay out of Agent SDK email workflows",
);
assert.equal(
  shouldTryTelegramAgentSdkWorkflow("please reply with hello world"),
  false,
  "plain reply-with wording is a chat command, not an email draft request",
);
assert.equal(
  shouldTryTelegramAgentSdkWorkflow("Draft a reply to this email but do not send it."),
  true,
  "explicit email reply drafts should still use the Agent SDK golden workflow",
);
assert.equal(
  shouldTryTelegramAgentSdkWorkflow("Draft and send an email to sam@example.com saying hello."),
  true,
  "explicit draft-and-send email requests should still use the approval workflow",
);
assert.equal(
  shouldTryTelegramAgentSdkWorkflow("Set a reminder tomorrow morning to follow up with Bill."),
  true,
  "explicit internal reminders should still use the Agent SDK golden workflow",
);

console.log("OK: Telegram Agent SDK workflow intent avoids reply-with false positives");
