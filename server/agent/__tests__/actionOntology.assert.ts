import assert from "node:assert/strict";
import { classifyActionOntology } from "../actionOntology";
import { resolveToolsForAction } from "../toolResolver";
import { requiresApproval, requiresHumanApproval } from "../approvalToolRisk";
import { ANDROID_PHONE_RUNTIME_TOOL_NAMES } from "../androidPhoneRuntimeToolNames";

function assertAction(
  text: string,
  expected: {
    actionType: ReturnType<typeof classifyActionOntology>["actionType"];
    actor: ReturnType<typeof classifyActionOntology>["actor"];
    approvalRequired: boolean;
  },
) {
  const decision = classifyActionOntology(text);
  assert.equal(decision.actionType, expected.actionType, `${text}: actionType`);
  assert.equal(decision.actor, expected.actor, `${text}: actor`);
  assert.equal(decision.approvalRequired, expected.approvalRequired, `${text}: approvalRequired`);
  assert.ok(decision.reason.length > 12, `${text}: reason is present`);
}

assertAction('Can you add "Make $140 on DoorDash" as a recurring task every day?', {
  actionType: "user_task",
  actor: "user",
  approvalRequired: false,
});

assertAction("Check my Gmail every morning and summarize important emails", {
  actionType: "jarvis_read",
  actor: "jarvis",
  approvalRequired: false,
});

assertAction("Send an email to Sam saying the appointment moved", {
  actionType: "jarvis_external_write",
  actor: "human_approval_required",
  approvalRequired: true,
});

assertAction("What was my last message?", {
  actionType: "unknown",
  actor: "jarvis",
  approvalRequired: false,
});

for (const text of [
  "Okay and what is the message before that?",
  "Why can't you see the previous message in our conversation history?",
  "Can you reliably access the entire context history of every message that I sent?",
]) {
  assertAction(text, {
    actionType: "unknown",
    actor: "jarvis",
    approvalRequired: false,
  });
}

assertAction("Please message Sam and tell him I am running late", {
  actionType: "jarvis_external_write",
  actor: "human_approval_required",
  approvalRequired: true,
});

assertAction("Send my previous message to Bob", {
  actionType: "jarvis_external_write",
  actor: "human_approval_required",
  approvalRequired: true,
});

assertAction("Read my unread messages", {
  actionType: "jarvis_read",
  actor: "jarvis",
  approvalRequired: false,
});

for (const text of [
  "Show me how Android notifications work",
  "How do I open notifications on Android?",
  "How do I search for someone on Facebook?",
  "Can you explain how to open that notification?",
  "Could you explain how I can search for someone on Facebook?",
  "Don't open Facebook",
  "Do not open that notification",
  "Find an app for budgeting",
  "Read about Android app development",
]) {
  const informational = classifyActionOntology(text);
  assert.notEqual(informational.actionType, "jarvis_device_action", `${text}: informational request is not a device action`);
  assert.equal(informational.approvalRequired, false, `${text}: informational request does not require device approval`);
}

assertAction("Reply Bob and tell him I am running late", {
  actionType: "jarvis_external_write",
  actor: "human_approval_required",
  approvalRequired: true,
});

assertAction("Fix your scheduler bug", {
  actionType: "jarvis_code_proposal",
  actor: "human_approval_required",
  approvalRequired: true,
});

assertAction("Deploy this to Railway", {
  actionType: "system_admin",
  actor: "human_approval_required",
  approvalRequired: true,
});

assertAction("Research NY dispensaries for outreach leads", {
  actionType: "cloud_worker_task",
  actor: "worker",
  approvalRequired: false,
});

assertAction("Drive to Walmart and buy printer paper", {
  actionType: "blocked_physical_action",
  actor: "blocked",
  approvalRequired: false,
});

const userTask = classifyActionOntology("Remind me to call Bill tomorrow at 9am");
assert.ok(userTask.priorityToolNames.includes("schedule_jarvis_task"), "user tasks prioritize schedule_jarvis_task");
assert.ok(userTask.allowedToolGroups.includes("scheduling"), "user tasks allow scheduling tools");

const codeTask = classifyActionOntology("Update your own source code and push it");
assert.ok(codeTask.priorityToolNames.includes("delegate_to_codex"), "code tasks prioritize Codex delegation");
assert.ok(codeTask.allowedToolGroups.includes("self_edit"), "code tasks allow self-edit inspection");

const deviceAction = classifyActionOntology("Open the Alex Hormozi notification on my phone");
assert.equal(deviceAction.actionType, "jarvis_device_action");
assert.equal(deviceAction.actor, "jarvis");
assert.equal(deviceAction.approvalRequired, false);
assert.ok(deviceAction.priorityToolNames.includes("android_open_notification"));
const deviceResolution = resolveToolsForAction(deviceAction);
assert.ok(deviceResolution.requiredToolNames.includes("android_open_notification"));
assert.ok(deviceResolution.requiredToolNames.includes("android_search_in_app"));
assert.equal(deviceResolution.approvalRequired, false);

for (const toolName of ANDROID_PHONE_RUNTIME_TOOL_NAMES) {
  assert.equal(requiresApproval(toolName), false, `${toolName}: device steps never require approval`);
  assert.equal(requiresHumanApproval(toolName), false, `${toolName}: device steps continue without a human gate`);
}
assert.equal(requiresApproval("android_tap_screen", { label: "Send message" }), false, "submit-capable phone taps do not pause for approval");
assert.equal(requiresHumanApproval("android_tap_screen", { label: "Send message" }), false, "submit-capable phone taps do not require human approval");
assert.equal(requiresApproval("daemon_action", { action: "android_tap", label: "Send message" }), false, "Android daemon actions do not pause for approval");
assert.equal(requiresHumanApproval("daemon_action", { action: "android_tap", label: "Send message" }), false, "Android daemon actions do not require human approval");
assert.equal(requiresApproval("daemon_action", { action: "shell" }), true, "non-Android daemon actions remain gated");

const inconsistentDeviceResolution = resolveToolsForAction({
  ...deviceAction,
  actor: "jarvis",
  approvalRequired: false,
});
assert.equal(
  inconsistentDeviceResolution.approvalRequired,
  false,
  "the resolver must preserve the approval-free Android ontology decision",
);

console.log("OK: action ontology classifies ownership, approval, tools, and reasons");
