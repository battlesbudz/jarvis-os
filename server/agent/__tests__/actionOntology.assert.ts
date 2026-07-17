import assert from "node:assert/strict";
import { classifyActionOntology } from "../actionOntology";

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

console.log("OK: action ontology classifies ownership, approval, tools, and reasons");
