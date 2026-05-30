import assert from "node:assert/strict";
import {
  DIRECT_EMAIL_APPROVAL_AGENT_ID,
  isDirectEmailApprovalGate,
  parseDirectEmailApprovalIntent,
} from "../directEmailApprovalRoute";

const parsed = parseDirectEmailApprovalIntent(
  'Draft and send an email to person@example.com with subject "Chrome E2E approval" and body "Please ignore this test." Ask me for approval before sending.',
);

assert.equal(parsed?.to, "person@example.com");
assert.equal(parsed?.subject, "Chrome E2E approval");
assert.equal(parsed?.body, "Please ignore this test.");

assert.equal(parseDirectEmailApprovalIntent("Draft an email but do not send it."), null);

assert.equal(
  isDirectEmailApprovalGate({
    id: "gate_test",
    agentId: DIRECT_EMAIL_APPROVAL_AGENT_ID,
    userId: "user_test",
    toolName: "send_email",
    toolArgs: { __directEmailApproval: true },
    description: "test",
    status: "pending",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 1000),
  }),
  true,
);

console.log("directEmailApprovalRoute assertions passed");
