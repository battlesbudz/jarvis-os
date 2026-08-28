import assert from "node:assert/strict";
import {
  createTrustedExecutionReceipt,
  isUnboundGenericAffirmative,
  resolveAndIssueTrustedExecution,
  resolveApprovalCompatibility,
  resolveTrustedExecution,
  type TrustedExecutionResolutionInput,
} from "../index";

const base: TrustedExecutionResolutionInput = {
  sourceType: "direct_command",
  authenticatedUserId: "user-1",
  sourceTurnId: "turn-1",
  sourceActionKey: "appchat:user-1:turn-1:send_email",
  taskId: "task-1",
  originChannel: "appchat",
  intent: "Send the resolved message",
  allowedActions: ["email.send"],
  allowedTargets: ["sha256:recipient"],
  riskTier: "high",
  capabilities: {
    authenticated: true,
    ownsTargets: true,
    requiredScopesPresent: true,
    providerAvailable: true,
    devicePermissionsPresent: true,
    withinLimits: true,
  },
  controls: {
    globalEnabled: true,
    userEnabled: true,
    globalEpoch: 3,
    userEpoch: 7,
    killSwitchEnabled: false,
  },
};

assert.equal(resolveTrustedExecution(base).decision, "execute");
assert.deepEqual(
  resolveTrustedExecution({ ...base, intent: "", missingMaterialFields: ["message body"] }),
  {
    decision: "clarify",
    code: "missing_material_field",
    reason: "The request needs message body, intent before execution.",
    missingFields: ["message body", "intent"],
  },
);
assert.equal(resolveTrustedExecution({ ...base, controls: { ...base.controls, killSwitchEnabled: true } }).code, "kill_switch");
assert.equal(resolveTrustedExecution({ ...base, capabilities: { ...base.capabilities, devicePermissionsPresent: false } }).code, "capability_block");
assert.equal(resolveTrustedExecution({ ...base, genericAffirmativeWithoutTask: true }).code, "generic_affirmative");
assert.equal(resolveTrustedExecution({ ...base, sourceType: "standing_grant", sourceTurnId: undefined, financialTransaction: true }).code, "standing_financial_block");
assert.equal(isUnboundGenericAffirmative("Do it", false), true);
assert.equal(isUnboundGenericAffirmative("Do it", true), false);

void (async () => {
const disabled = await resolveAndIssueTrustedExecution({
  resolution: {
    ...base,
    controls: { ...base.controls, globalEnabled: false },
    sourceType: "direct_command",
  },
  authority: {
    authenticatedUserId: "user-1",
    sourceTurnId: "turn-1",
    sourceActionKind: "email.send",
    sourceActionKey: "appchat:user-1:turn-1:send_email",
    originChannel: "appchat",
    taskId: "task-1",
    intent: "Send the resolved message",
    allowedActions: ["email.send"],
    allowedTargets: ["sha256:recipient"],
    riskTier: "high",
    maxAttemptsPerStep: 1,
    expiresAt: new Date(Date.now() + 60_000),
    compensationExpiresAt: new Date(Date.now() + 120_000),
  },
});
assert.equal(disabled.compatibilityMode, "legacy");
assert.equal(disabled.authority, undefined, "disabled path must not touch persistence or mint authority");

const now = new Date();
const receipt = createTrustedExecutionReceipt({
  authorityId: "authority-1",
  stepKey: "send",
  attemptId: "attempt-1",
  fenceToken: 1,
  userId: "user-1",
  toolName: "send_email",
  action: "email.send",
  targetFingerprint: "sha256:recipient",
  idempotencyKey: "te-step-1",
  issuedAt: new Date(now.getTime() - 1_000).toISOString(),
  expiresAt: new Date(now.getTime() + 30_000).toISOString(),
});
const validAuthority = {
  valid: true as const,
  code: "valid" as const,
  reason: "ok",
  authorityId: receipt.authorityId,
  stepKey: receipt.stepKey,
  action: receipt.action,
  targetFingerprint: receipt.targetFingerprint,
};
assert.equal(resolveApprovalCompatibility({
  trustedExecutionEnabled: false,
  authorityReferenced: true,
  receipt,
  call: { userId: "user-1", toolName: "send_email" },
  authorityValidation: validAuthority,
  now,
}).mode, "legacy_approval");
assert.equal(resolveApprovalCompatibility({
  trustedExecutionEnabled: true,
  authorityReferenced: false,
  call: { userId: "user-1", toolName: "send_email" },
  now,
}).mode, "block", "enabled adapters must not fall back to creating a channel-local approval gate");
assert.equal(resolveApprovalCompatibility({
  trustedExecutionEnabled: true,
  authorityReferenced: true,
  receipt,
  call: { userId: "user-1", toolName: "send_email" },
  authorityValidation: validAuthority,
  now,
}).mode, "trusted_execution");
assert.equal(resolveApprovalCompatibility({
  trustedExecutionEnabled: true,
  authorityReferenced: true,
  receipt,
  call: { userId: "user-2", toolName: "send_email" },
  authorityValidation: validAuthority,
  now,
}).mode, "block");
assert.equal(resolveApprovalCompatibility({
  trustedExecutionEnabled: true,
  authorityReferenced: true,
  receipt,
  call: { userId: "user-1", toolName: "send_email" },
  authorityValidation: { valid: false, code: "epoch_mismatch", reason: "revoked" },
  now,
}).mode, "block");

console.log("All Trusted Execution policy and compatibility assertions passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
