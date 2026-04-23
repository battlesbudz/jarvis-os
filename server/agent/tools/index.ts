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
import { scheduleJarvisTaskTool } from "./scheduleJarvisTask";

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
  scheduleJarvisTaskTool,
];

const TOOL_INDEX = new Map(ALL_TOOLS.map((t) => [t.name, t]));

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
    spawnSubagentTool,
    daemonActionTool,
    checkConnectionsTool,
    generateReconnectLinkTool,
    createCalendarEventTool,
    sendEmailTool,
    fetchEmailsTool,
    connectChannelTool,
    discordPostTool,
    scheduleJarvisTaskTool,
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
  scheduleJarvisTaskTool,
};
