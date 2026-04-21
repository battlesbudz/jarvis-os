// Tool registry — collects every typed AgentTool and exposes ready-made
// bundles for different surfaces (Telegram chat, app chat, autonomous loops).

import type { AgentTool } from "../types";
import { webSearchTool, researchTopicTool } from "./webSearch";
import { gmailActionTool } from "./gmailActions";
import { manageTasksTool } from "./manageTasks";
import { createDocumentTool, listDocumentsTool, readDocumentTool } from "./documents";
import { driveCreateFileTool, driveListFilesTool, driveReadFileTool } from "./googleDriveTools";

export const ALL_TOOLS: AgentTool[] = [
  webSearchTool,
  researchTopicTool,
  gmailActionTool,
  manageTasksTool,
  createDocumentTool,
  listDocumentsTool,
  readDocumentTool,
  driveCreateFileTool,
  driveListFilesTool,
  driveReadFileTool,
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
  ];
  if (opts.hasGoogle) {
    base.push(gmailActionTool, driveCreateFileTool, driveListFilesTool, driveReadFileTool);
  }
  return base;
}

export {
  webSearchTool,
  researchTopicTool,
  gmailActionTool,
  manageTasksTool,
  createDocumentTool,
  listDocumentsTool,
  readDocumentTool,
  driveCreateFileTool,
  driveListFilesTool,
  driveReadFileTool,
};
