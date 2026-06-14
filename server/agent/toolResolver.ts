import type { ActionOntologyDecision, ActionType } from "./actionOntology";

export interface ToolResolution {
  requiredToolNames: string[];
  optionalToolNames: string[];
  blockedToolNames: string[];
  approvalRequired: boolean;
  reason: string;
}

const CONNECTED_ACCOUNT_TOOLS = [
  "connected_accounts_list",
  "connected_accounts_search_tools",
  "connected_accounts_get_tool_schema",
  "connected_accounts_execute",
];

const LEGACY_EXTERNAL_WRITE_TOOLS = ["send_email", "create_gmail_draft", "gmail_action", "fetch_emails", "fetch_calendar", "create_calendar_event"];
const EXECUTABLE_SCHEDULING_TOOLS = ["cron_create", "queue_background_job", "daemon_action"];

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function resolution(input: Omit<ToolResolution, "requiredToolNames" | "optionalToolNames" | "blockedToolNames"> & {
  requiredToolNames?: string[];
  optionalToolNames?: string[];
  blockedToolNames?: string[];
}): ToolResolution {
  return {
    requiredToolNames: unique(input.requiredToolNames ?? []),
    optionalToolNames: unique(input.optionalToolNames ?? []),
    blockedToolNames: unique(input.blockedToolNames ?? []),
    approvalRequired: input.approvalRequired,
    reason: input.reason,
  };
}

export function resolveToolsForAction(decision: ActionOntologyDecision): ToolResolution {
  const actionType: ActionType = decision.actionType;

  switch (actionType) {
    case "user_task":
    case "jarvis_reminder":
      return resolution({
        requiredToolNames: ["schedule_jarvis_task"],
        blockedToolNames: EXECUTABLE_SCHEDULING_TOOLS,
        approvalRequired: decision.approvalRequired,
        reason: "Personal tasks and reminders should expose only user-task scheduling tools, not autonomous execution tools.",
      });

    case "jarvis_read":
      return resolution({
        requiredToolNames: CONNECTED_ACCOUNT_TOOLS,
        optionalToolNames: ["memory_search", "memory_get", "memory_save", "search_web", "research_topic", "browser_navigate"],
        blockedToolNames: LEGACY_EXTERNAL_WRITE_TOOLS.filter((tool) => tool !== "fetch_emails" && tool !== "fetch_calendar"),
        approvalRequired: decision.approvalRequired,
        reason: "Read-only connected-account work should use the connected account discovery and execute path with read-capable schemas.",
      });

    case "jarvis_draft":
      return resolution({
        requiredToolNames: CONNECTED_ACCOUNT_TOOLS,
        optionalToolNames: ["memory_search", "memory_get", "memory_save"],
        blockedToolNames: ["send_email", "gmail_action"],
        approvalRequired: decision.approvalRequired,
        reason: "Drafting can use connected-account context but should not expose direct send tools.",
      });

    case "jarvis_external_write":
      return resolution({
        requiredToolNames: CONNECTED_ACCOUNT_TOOLS,
        blockedToolNames: LEGACY_EXTERNAL_WRITE_TOOLS,
        approvalRequired: true,
        reason: "External writes must use the connected-account execution path and require approval before side effects.",
      });

    case "jarvis_code_proposal":
    case "jarvis_code_apply":
      return resolution({
        requiredToolNames: ["delegate_to_codex"],
        optionalToolNames: ["build_feature", "list_source_files", "read_source_file", "propose_code_change", "project_shell"],
        blockedToolNames: ["connected_accounts_execute", "daemon_action"],
        approvalRequired: true,
        reason: "Code ownership work should be scoped through Codex/self-edit tools with approval before writes, commits, pushes, or deploys.",
      });

    case "cloud_worker_task":
      return resolution({
        requiredToolNames: ["queue_background_job"],
        optionalToolNames: ["search_web", "research_topic", "browser_navigate", "browser_extract"],
        approvalRequired: decision.approvalRequired,
        reason: "Scoped long-running work should be queued to a worker with only the narrow tools needed for the task.",
      });

    case "system_admin":
      return resolution({
        requiredToolNames: ["deploy_app", "project_shell"],
        optionalToolNames: ["jarvis_self_diagnose", "search_web"],
        blockedToolNames: ["connected_accounts_execute", "send_email", "daemon_action"],
        approvalRequired: true,
        reason: "System administration touches deployment, infrastructure, database, or secrets and requires approval.",
      });

    case "blocked_physical_action":
      return resolution({
        blockedToolNames: ["schedule_jarvis_task", "cron_create", "queue_background_job", "daemon_action", "connected_accounts_execute"],
        approvalRequired: false,
        reason: "Physical-world actions are blocked because Jarvis cannot perform them with software tools.",
      });

    case "unknown":
    default:
      return resolution({
        approvalRequired: decision.approvalRequired,
        reason: "No narrow tool set is available until the action type is understood.",
      });
  }
}
