import type { ToolGroup } from "./tools/index";

export type ActionType =
  | "user_task"
  | "jarvis_reminder"
  | "jarvis_read"
  | "jarvis_draft"
  | "jarvis_external_write"
  | "jarvis_code_proposal"
  | "jarvis_code_apply"
  | "cloud_worker_task"
  | "system_admin"
  | "blocked_physical_action"
  | "unknown";

export type ActionActor = "user" | "jarvis" | "worker" | "human_approval_required" | "blocked";

export interface ActionOntologyDecision {
  actionType: ActionType;
  actor: ActionActor;
  approvalRequired: boolean;
  allowedToolGroups: ToolGroup[];
  priorityToolNames: string[];
  reason: string;
}

function decision(input: ActionOntologyDecision): ActionOntologyDecision {
  return input;
}

function has(text: string, re: RegExp): boolean {
  return re.test(text);
}

export function classifyActionOntology(text: string): ActionOntologyDecision {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return decision({
      actionType: "unknown",
      actor: "jarvis",
      approvalRequired: false,
      allowedToolGroups: [],
      priorityToolNames: [],
      reason: "No user request text was available to classify.",
    });
  }

  if (
    has(lower, /\b(add|create|put|schedule|remind me|reminder|todo|to-do|task|habit|every day|daily|follow up)\b/) &&
    has(lower, /\b(doordash|drive|call|errand|work out|exercise|clean|shop|buy groceries)\b/)
  ) {
    return decision({
      actionType: "user_task",
      actor: "user",
      approvalRequired: false,
      allowedToolGroups: ["coaching", "scheduling"],
      priorityToolNames: ["schedule_jarvis_task"],
      reason: "The request schedules or tracks a human-owned task; Jarvis should record it for the user and not execute it.",
    });
  }

  if (
    has(lower, /\b(drive|go to|walk to|pick up|deliver|doordash|uber eats|instacart|buy|purchase|pay)\b/) &&
    has(lower, /\b(walmart|store|paper|food|groceries|doordash|car|body|physical|in person|in-person)\b/)
  ) {
    return decision({
      actionType: "blocked_physical_action",
      actor: "blocked",
      approvalRequired: false,
      allowedToolGroups: ["coaching"],
      priorityToolNames: [],
      reason: "The request requires physical-world presence, money, driving, or user-owned action that Jarvis cannot perform.",
    });
  }

  if (has(lower, /\b(deploy|railway|environment variables?|env vars?|database|migration|production|server|startup|tailscale|secrets?)\b/)) {
    return decision({
      actionType: "system_admin",
      actor: "human_approval_required",
      approvalRequired: true,
      allowedToolGroups: ["app_build", "mcp", "system"],
      priorityToolNames: ["deploy_app", "project_shell", "jarvis_self_diagnose"],
      reason: "The request touches deployment, infrastructure, database, secrets, or production system administration.",
    });
  }

  if (has(lower, /\b(push|commit|merge|apply|write|edit|change|fix|debug|build|implement|update)\b/) && has(lower, /\b(code|source|repo|repository|bug|feature|tool|yourself|your own|jarvis)\b/)) {
    return decision({
      actionType: has(lower, /\b(apply|write|edit|change|push|commit|merge)\b/) ? "jarvis_code_apply" : "jarvis_code_proposal",
      actor: "human_approval_required",
      approvalRequired: true,
      allowedToolGroups: ["system", "self_edit", "app_build", "mcp"],
      priorityToolNames: ["delegate_to_codex", "build_feature", "list_source_files", "read_source_file", "propose_code_change"],
      reason: "The request asks Jarvis to inspect, change, or ship source code, which requires a scoped code workflow and approval.",
    });
  }

  if (has(lower, /\b(send|post|publish|reply|respond|message|schedule a meeting|book|cancel|reschedule)\b/)) {
    return decision({
      actionType: has(lower, /\b(draft|write a draft|compose)\b/) && !has(lower, /\b(send|post|publish)\b/) ? "jarvis_draft" : "jarvis_external_write",
      actor: has(lower, /\b(draft|write a draft|compose)\b/) && !has(lower, /\b(send|post|publish)\b/) ? "jarvis" : "human_approval_required",
      approvalRequired: !has(lower, /\b(draft|write a draft|compose)\b/) || has(lower, /\b(send|post|publish)\b/),
      allowedToolGroups: ["email", "calendar", "mcp"],
      priorityToolNames: ["connected_accounts_list", "connected_accounts_search_tools", "connected_accounts_get_tool_schema", "connected_accounts_execute"],
      reason: "The request touches external communication or connected-account writes, so sending or changing data needs approval.",
    });
  }

  if (has(lower, /\b(research|investigate|find|look up|search|prospects?|leads?|outreach list)\b/)) {
    return decision({
      actionType: has(lower, /\b(leads?|prospects?|outreach|research)\b/) ? "cloud_worker_task" : "jarvis_read",
      actor: has(lower, /\b(leads?|prospects?|outreach|research)\b/) ? "worker" : "jarvis",
      approvalRequired: false,
      allowedToolGroups: ["research", "browser"],
      priorityToolNames: ["queue_background_job", "search_web", "research_topic", "browser_navigate"],
      reason: "The request is information gathering or research and can be handled by read/search tools or a scoped worker.",
    });
  }

  if (has(lower, /\b(check|read|summari[sz]e|review)\b/) && has(lower, /\b(email|gmail|inbox|calendar|events?|messages?)\b/)) {
    return decision({
      actionType: "jarvis_read",
      actor: "jarvis",
      approvalRequired: false,
      allowedToolGroups: ["email", "calendar", "mcp"],
      priorityToolNames: ["connected_accounts_list", "connected_accounts_search_tools", "connected_accounts_get_tool_schema", "connected_accounts_execute"],
      reason: "The request is read-only connected-account work, so Jarvis can retrieve and summarize without an external write.",
    });
  }

  if (has(lower, /\b(remind me|reminder|todo|to-do|task|habit|every day|daily|follow up)\b/)) {
    return decision({
      actionType: "user_task",
      actor: "user",
      approvalRequired: false,
      allowedToolGroups: ["coaching", "scheduling"],
      priorityToolNames: ["schedule_jarvis_task"],
      reason: "The request is a personal task, habit, reminder, or follow-up owned by the user rather than executable Jarvis work.",
    });
  }

  return decision({
    actionType: "unknown",
    actor: "jarvis",
    approvalRequired: false,
    allowedToolGroups: [],
    priorityToolNames: [],
    reason: "No specific action ownership rule matched, so normal chat handling should decide the next step.",
  });
}
