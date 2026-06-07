import {
  matchesAgentSdkEmailDraftOnlyWorkflow,
  matchesAgentSdkEmailWorkflow,
  matchesAgentSdkReminderWorkflow,
} from "../src/agent/agentRunner";

export function shouldTryTelegramAgentSdkWorkflow(rawUserText: string): boolean {
  return matchesAgentSdkReminderWorkflow(rawUserText)
    || matchesAgentSdkEmailWorkflow(rawUserText)
    || matchesAgentSdkEmailDraftOnlyWorkflow(rawUserText);
}
