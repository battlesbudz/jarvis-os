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
import { youtubeTranscriptTool } from "./youtubeTranscript";
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
import { imageGenerateTool } from "./imageGenerate";
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
  browserTabsTool,
  browserClearSessionTool,
} from "./browserTools";
import {
  buildFeatureTool,
  testToolTool,
  initToolResolver,
} from "./buildFeatureTool";

// ── Tool Groups ────────────────────────────────────────────────────────────────
// Each group represents a functional capability cluster. Channels declare which
// groups they need and the harness call-site filters ALL_TOOLS accordingly.

export type ToolGroup =
  | "coaching"    // manage_tasks, queue_background_job, daemon_action
  | "calendar"    // fetch_calendar, create_calendar_event  (Google-gated)
  | "email"       // gmail_action, gmail_draft (Google-gated), send_email, fetch_emails
  | "memory"      // memory_search, memory_get
  | "documents"   // create/list/read_document, drive_* (Google-gated)
  | "research"    // web_search, research_topic, web_fetch, youtube_search, youtube_transcript
  | "discord"     // discord_post, discord_manage, schedule_channel_report, setup_content_pipeline
  | "scheduling"  // schedule_jarvis_task, cron_*, workflow_*
  | "browser"     // browser_navigate, browser_click, …
  | "system"      // spawn_subagent, sessions_*, register_approval, build_feature, test_tool
  | "media"       // speak, image_generate
  | "connections" // check_connections, generate_reconnect_link, connect_channel

// Tools that are only included when the user has a valid Google OAuth token.
// Note: create_calendar_event is intentionally not gated — it remains available
// even without a Google token so users can still queue/log calendar intentions.
const GOOGLE_GATED = new Set([
  "gmail_action",
  "create_gmail_draft",
  "fetch_calendar",
  "drive_create_file",
  "drive_list_files",
  "drive_read_file",
]);

// Mapping: tool name → set of ToolGroups it belongs to.
const TOOL_GROUP_MAP: Record<string, ToolGroup[]> = {
  // research
  web_search:            ["research"],
  research_topic:        ["research"],
  web_fetch:             ["research"],
  youtube_search:        ["research"],
  youtube_transcript:    ["research"],

  // coaching
  manage_tasks:          ["coaching"],
  queue_background_job:  ["coaching"],
  daemon_action:         ["coaching", "system"],

  // calendar (Google-gated)
  fetch_calendar:        ["calendar"],
  create_calendar_event: ["calendar"],

  // email
  gmail_action:          ["email"],
  create_gmail_draft:    ["email"],
  send_email:            ["email"],
  fetch_emails:          ["email"],

  // memory
  memory_search:         ["memory"],
  memory_get:            ["memory"],

  // documents (drive tools are Google-gated)
  create_document:       ["documents"],
  list_documents:        ["documents"],
  read_document:         ["documents"],
  drive_create_file:     ["documents"],
  drive_list_files:      ["documents"],
  drive_read_file:       ["documents"],

  // discord
  discord_post:                ["discord"],
  discord_create_channel:      ["discord"],
  discord_delete_channel:      ["discord"],
  discord_list_channels:       ["discord"],
  discord_pin_message:         ["discord"],
  setup_discord_workspace:     ["discord"],
  setup_content_pipeline:      ["discord"],
  setup_named_agent:           ["discord", "system"],
  schedule_channel_report:     ["discord", "scheduling"],
  list_channel_schedules:      ["discord", "scheduling"],
  delete_channel_schedule:     ["discord", "scheduling"],

  // scheduling (schedule_jarvis_task is also in coaching so coaching channels get it)
  schedule_jarvis_task:  ["coaching", "scheduling"],
  cron_create:           ["scheduling"],
  cron_list:             ["scheduling"],
  cron_delete:           ["scheduling"],
  cron_update:           ["scheduling"],
  workflow_create:       ["scheduling"],
  workflow_run:          ["scheduling"],
  workflow_status:       ["scheduling"],
  workflow_pause:        ["scheduling"],
  workflow_resume:       ["scheduling"],
  workflow_list:         ["scheduling"],

  // browser
  browser_navigate:      ["browser"],
  browser_click:         ["browser"],
  browser_type:          ["browser"],
  browser_screenshot:    ["browser"],
  browser_extract:       ["browser"],
  browser_close:         ["browser"],
  browser_snapshot:      ["browser"],
  browser_wait_for:      ["browser"],
  browser_select:        ["browser"],
  browser_tabs:          ["browser"],
  browser_clear_session: ["browser"],

  // system
  spawn_subagent:            ["system"],
  check_connections:         ["connections", "system"],
  generate_reconnect_link:   ["connections", "system"],
  connect_channel:           ["connections", "system"],
  register_approval:         ["system"],
  sessions_list:             ["system"],
  sessions_history:          ["system"],
  sessions_send:             ["system"],
  build_feature:             ["system"],
  test_tool:                 ["system"],

  // media
  speak:          ["media"],
  image_generate: ["media"],
};

/**
 * Return the subset of ALL_TOOLS whose groups intersect `requestedGroups`.
 * Google-gated tools are only included when `hasGoogle` is true.
 */
export function filterToolsByGroups(
  requestedGroups: ToolGroup[],
  hasGoogle = false,
): AgentTool[] {
  const groupSet = new Set<ToolGroup>(requestedGroups);
  return ALL_TOOLS.filter((tool) => {
    if (GOOGLE_GATED.has(tool.name) && !hasGoogle) return false;
    const toolGroups = TOOL_GROUP_MAP[tool.name];
    if (!toolGroups) return false; // unmapped tools are excluded from scoped bundles
    return toolGroups.some((g) => groupSet.has(g));
  });
}

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
  youtubeTranscriptTool,
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
  browserTabsTool,
  browserClearSessionTool,
  buildFeatureTool,
  testToolTool,
  imageGenerateTool,
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
    youtubeTranscriptTool,
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
    browserTabsTool,
    browserClearSessionTool,
    buildFeatureTool,
    testToolTool,
    imageGenerateTool,
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
  youtubeTranscriptTool,
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
  browserTabsTool,
  browserClearSessionTool,
  buildFeatureTool,
  testToolTool,
  imageGenerateTool,
};
