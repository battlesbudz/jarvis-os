// Tool registry — collects every typed AgentTool and exposes ready-made
// bundles for different surfaces (Telegram chat, app chat, autonomous loops).

import type { AgentTool } from "../types";
import { webSearchTool, researchTopicTool } from "./webSearch";
import { gmailActionTool, gmailDraftTool } from "./gmailActions";
import { manageTasksTool } from "./manageTasks";
import { createDocumentTool, listDocumentsTool, readDocumentTool } from "./documents";
import { driveCreateFileTool, driveListFilesTool, driveReadFileTool } from "./googleDriveTools";
import { fetchCalendarTool } from "./calendar";
import { spawnSubagentTool } from "./spawnSubagent";
import { daemonActionTool } from "./daemon";
import { checkConnectionsTool, generateReconnectLinkTool } from "./connections";
import { createCalendarEventTool } from "./calendarCreate";
import { sendEmailTool } from "./sendEmail";
import { fetchEmailsTool } from "./fetchEmails";
import { connectChannelTool } from "./connectChannel";
import { discordPostTool } from "./discordPost";
import { discordCreateChannelTool } from "./discordCreateChannel";
import { discordDeleteChannelTool } from "./discordDeleteChannel";
import { discordListChannelsTool } from "./discordListChannels";
import { scheduleJarvisTaskTool } from "./scheduleJarvisTask";
import {
  scheduleChannelReportTool,
  listChannelSchedulesTool,
  deleteChannelScheduleTool,
} from "./scheduleChannelReport";
import { youtubeSearchTool } from "./youtubeSearch";
import { registerApprovalTool } from "./registerApproval";
import { discordPinMessageTool } from "./discordPinMessage";
import { setupNamedAgentTool } from "./setupNamedAgent";
import { queueBackgroundJobTool } from "./queueBackgroundJob";
import { setupContentPipelineTool } from "./setupContentPipeline";
import { setupDiscordWorkspaceTool } from "./setupDiscordWorkspace";
import { memorySearchTool, memoryGetTool } from "./memorySearch";
import { webFetchTool } from "./webFetch";
import { sessionsListTool, sessionsHistoryTool, sessionsSendTool } from "./sessionTools";
import { speakTool } from "./tts";
import { cronCreateTool, cronListTool, cronDeleteTool, cronUpdateTool } from "./cronTools";
import {
  workflowCreateTool,
  workflowRunTool,
  workflowStatusTool,
  workflowPauseTool,
  workflowResumeTool,
  workflowListTool,
} from "./workflowTools";
import {
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
  browserExtractTool,
  browserCloseTool,
  browserSnapshotTool,
  browserWaitForTool,
  browserSelectTool,
  browserClearSessionTool,
} from "./browserTools";
import {
  buildFeatureTool,
  testToolTool,
  initToolResolver,
} from "./buildFeatureTool";

export const ALL_TOOLS: AgentTool[] = [
  webSearchTool,
  researchTopicTool,
  gmailActionTool,
  gmailDraftTool,
  fetchCalendarTool,
  createCalendarEventTool,
  manageTasksTool,
  createDocumentTool,
  listDocumentsTool,
  readDocumentTool,
  driveCreateFileTool,
  driveListFilesTool,
  driveReadFileTool,
  spawnSubagentTool,
  daemonActionTool,
  checkConnectionsTool,
  generateReconnectLinkTool,
  sendEmailTool,
  fetchEmailsTool,
  connectChannelTool,
  discordPostTool,
  discordCreateChannelTool,
  discordDeleteChannelTool,
  discordListChannelsTool,
  scheduleJarvisTaskTool,
  scheduleChannelReportTool,
  listChannelSchedulesTool,
  deleteChannelScheduleTool,
  registerApprovalTool,
  discordPinMessageTool,
  setupNamedAgentTool,
  youtubeSearchTool,
  queueBackgroundJobTool,
  setupContentPipelineTool,
  setupDiscordWorkspaceTool,
  memorySearchTool,
  memoryGetTool,
  webFetchTool,
  sessionsListTool,
  sessionsHistoryTool,
  sessionsSendTool,
  speakTool,
  cronCreateTool,
  cronListTool,
  cronDeleteTool,
  cronUpdateTool,
  workflowCreateTool,
  workflowRunTool,
  workflowStatusTool,
  workflowPauseTool,
  workflowResumeTool,
  workflowListTool,
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
  browserExtractTool,
  browserCloseTool,
  browserSnapshotTool,
  browserWaitForTool,
  browserSelectTool,
  browserClearSessionTool,
  buildFeatureTool,
  testToolTool,
];

const TOOL_INDEX = new Map(ALL_TOOLS.map((t) => [t.name, t]));

// Wire the resolver so testToolTool can look up tools without a circular import.
initToolResolver((name) => TOOL_INDEX.get(name));

export function getTool(name: string): AgentTool | undefined {
  return TOOL_INDEX.get(name);
}

/** Tool bundle for the Telegram coach loop. */
export function telegramCoachTools(opts: { hasGoogle: boolean }): AgentTool[] {
  const base: AgentTool[] = [
    webSearchTool,
    researchTopicTool,
    manageTasksTool,
    createDocumentTool,
    listDocumentsTool,
    readDocumentTool,
    queueBackgroundJobTool,
    daemonActionTool,
    checkConnectionsTool,
    generateReconnectLinkTool,
    createCalendarEventTool,
    sendEmailTool,
    fetchEmailsTool,
    connectChannelTool,
    discordPostTool,
    discordCreateChannelTool,
    discordDeleteChannelTool,
    discordListChannelsTool,
    scheduleJarvisTaskTool,
    scheduleChannelReportTool,
    listChannelSchedulesTool,
    deleteChannelScheduleTool,
    registerApprovalTool,
    discordPinMessageTool,
    setupNamedAgentTool,
    youtubeSearchTool,
    setupContentPipelineTool,
    setupDiscordWorkspaceTool,
    memorySearchTool,
    memoryGetTool,
    webFetchTool,
    sessionsListTool,
    sessionsHistoryTool,
    sessionsSendTool,
    speakTool,
    cronCreateTool,
    cronListTool,
    cronDeleteTool,
    cronUpdateTool,
    workflowCreateTool,
    workflowRunTool,
    workflowStatusTool,
    workflowPauseTool,
    workflowResumeTool,
    workflowListTool,
    browserNavigateTool,
    browserClickTool,
    browserTypeTool,
    browserScreenshotTool,
    browserExtractTool,
    browserCloseTool,
    browserSnapshotTool,
    browserWaitForTool,
    browserSelectTool,
    browserClearSessionTool,
    buildFeatureTool,
    testToolTool,
  ];
  if (opts.hasGoogle) {
    base.push(gmailActionTool, gmailDraftTool, fetchCalendarTool, driveCreateFileTool, driveListFilesTool, driveReadFileTool);
  }
  return base;
}

export {
  webSearchTool,
  researchTopicTool,
  gmailActionTool,
  gmailDraftTool,
  fetchCalendarTool,
  createCalendarEventTool,
  manageTasksTool,
  createDocumentTool,
  listDocumentsTool,
  readDocumentTool,
  driveCreateFileTool,
  driveListFilesTool,
  driveReadFileTool,
  spawnSubagentTool,
  daemonActionTool,
  checkConnectionsTool,
  generateReconnectLinkTool,
  sendEmailTool,
  fetchEmailsTool,
  connectChannelTool,
  discordPostTool,
  discordCreateChannelTool,
  discordDeleteChannelTool,
  discordListChannelsTool,
  scheduleJarvisTaskTool,
  scheduleChannelReportTool,
  listChannelSchedulesTool,
  deleteChannelScheduleTool,
  registerApprovalTool,
  discordPinMessageTool,
  setupNamedAgentTool,
  youtubeSearchTool,
  queueBackgroundJobTool,
  setupContentPipelineTool,
  setupDiscordWorkspaceTool,
  memorySearchTool,
  memoryGetTool,
  webFetchTool,
  sessionsListTool,
  sessionsHistoryTool,
  sessionsSendTool,
  speakTool,
  cronCreateTool,
  cronListTool,
  cronDeleteTool,
  cronUpdateTool,
  workflowCreateTool,
  workflowRunTool,
  workflowStatusTool,
  workflowPauseTool,
  workflowResumeTool,
  workflowListTool,
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
  browserExtractTool,
  browserCloseTool,
  browserSnapshotTool,
  browserWaitForTool,
  browserSelectTool,
  browserClearSessionTool,
  buildFeatureTool,
  testToolTool,
};
