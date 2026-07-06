import assert from "node:assert/strict";
import {
  buildVoiceApprovalPrompt,
  classifyVoiceApprovalRisk,
  normalizeVoiceApprovalReply,
  voiceApprovalClarificationPrompt,
} from "@shared/voiceApprovalGates";

function testNaturalApprovalReplies() {
  assert.equal(normalizeVoiceApprovalReply("yes, go ahead").intent, "approve");
  assert.equal(normalizeVoiceApprovalReply("sounds good, send it").intent, "approve");
  assert.equal(normalizeVoiceApprovalReply("approve that").intent, "approve");
  console.log("OK: voice approval accepts natural approval phrases");
}

function testNaturalDenialReplies() {
  assert.equal(normalizeVoiceApprovalReply("no, cancel that").intent, "deny");
  assert.equal(normalizeVoiceApprovalReply("don't do it").intent, "deny");
  assert.equal(normalizeVoiceApprovalReply("dont send it").intent, "deny");
  assert.equal(normalizeVoiceApprovalReply("don\u2019t send it").intent, "deny");
  assert.equal(normalizeVoiceApprovalReply("not now").intent, "deny");
  console.log("OK: voice approval accepts natural denial phrases");
}

function testAmbiguousRepliesNeedOneClarification() {
  assert.equal(normalizeVoiceApprovalReply("maybe, what action?").intent, "ambiguous");
  assert.equal(normalizeVoiceApprovalReply("maybe yes").intent, "ambiguous");
  assert.equal(normalizeVoiceApprovalReply("I guess go ahead").intent, "ambiguous");
  assert.equal(normalizeVoiceApprovalReply("no, go ahead").intent, "ambiguous");
  assert.equal(voiceApprovalClarificationPrompt(), "Do you want me to approve it or cancel it?");
  console.log("OK: voice approval asks one short clarification on ambiguous replies");
}

function testLowRiskPhoneControlDoesNotRequireApproval() {
  const openApp = classifyVoiceApprovalRisk({
    tool: "android_open_app",
    requestText: "Open YouTube and search for AI videos",
  });
  assert.equal(openApp.approvalRequired, false);
  assert.equal(openApp.overlayRequired, false);
  assert.equal(openApp.riskTier, "T0");

  const readNotifications = classifyVoiceApprovalRisk({
    tool: "android_read_notifications",
    requestText: "Read my notifications and tell me what matters",
  });
  assert.equal(readNotifications.approvalRequired, false);
  assert.equal(readNotifications.riskTier, "T0");

  const readTextNotifications = classifyVoiceApprovalRisk({
    tool: "android_read_notifications",
    requestText: "Read my text notifications and tell me what matters",
  });
  assert.equal(readTextNotifications.approvalRequired, false);
  assert.equal(readTextNotifications.riskTier, "T0");

  const tapSubmit = classifyVoiceApprovalRisk({
    tool: "android_tap",
    requestText: "Tap submit on this payment form",
  });
  assert.equal(tapSubmit.approvalRequired, true);
  assert.equal(tapSubmit.riskTier, "T4");
  console.log("OK: voice approval does not over-gate low-risk phone control");
}

function testHighRiskBoundariesRequireOverlayApproval() {
  const sendEmail = classifyVoiceApprovalRisk({
    tool: "send_email",
    preview: { to: "test@example.com", subject: "Follow up" },
  });
  assert.equal(sendEmail.approvalRequired, true);
  assert.equal(sendEmail.overlayRequired, true);
  assert.equal(sendEmail.riskTier, "T4");
  assert.equal(sendEmail.prompt, "Approve sending this email to test@example.com?");

  for (const requestText of [
    "Delete this file",
    "Pay the invoice",
    "Post this publicly",
    "Change my account password",
    "Submit this form",
  ]) {
    const decision = classifyVoiceApprovalRisk({ requestText });
    assert.equal(decision.approvalRequired, true, requestText);
    assert.equal(decision.overlayRequired, true, requestText);
  }

  for (const tool of ["discord_post", "gmail_action", "daemon_action"]) {
    const decision = classifyVoiceApprovalRisk({ tool });
    assert.equal(decision.approvalRequired, true, tool);
    assert.equal(decision.overlayRequired, true, tool);
    assert.equal(decision.riskTier, "T4", tool);
  }
  console.log("OK: voice approval protects irreversible and external actions");
}

function testOverlayPromptIsOneShortSentence() {
  const prompt = buildVoiceApprovalPrompt({
    tool: "connected_accounts_execute",
    preview: { platform: "Gmail", action: "send" },
  });
  assert.equal(prompt, "Approve this connected account action in Gmail?");
  assert.equal(prompt.includes("\n"), false);
  assert.ok(prompt.length <= 80);

  const phonePrompt = buildVoiceApprovalPrompt({
    tool: "daemon_action",
    preview: { action: "android_type", text: "Thanks" },
  });
  assert.equal(phonePrompt, "Approve this phone action?");
  console.log("OK: voice approval overlay prompt is one short sentence");
}

testNaturalApprovalReplies();
testNaturalDenialReplies();
testAmbiguousRepliesNeedOneClarification();
testLowRiskPhoneControlDoesNotRequireApproval();
testHighRiskBoundariesRequireOverlayApproval();
testOverlayPromptIsOneShortSentence();
