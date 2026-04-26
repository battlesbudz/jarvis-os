// Tool registry — compatibility shim over the capability module system.
//
// This file preserves its original exported API (ALL_TOOLS, ToolGroup,
// filterToolsByGroups, telegramCoachTools, getTool, individual re-exports)
// so all existing call sites continue to work without changes.
//
// The authoritative tool list, Google-gated set, and tool-group map are now
// derived from the CapabilityRegistry (server/capabilities/). Adding a new
// tool means creating or updating a capability module — not editing this file.
//
// buildFeatureTool.ts locates `export const ALL_TOOLS`, `telegramCoachTools(`
// and `export {` by string search — those patterns are preserved below.

// ── Capability registration (must come before registry reads) ─────────────────
import "../../capabilities/index";
import { capabilityRegistry } from "../../capabilities/registry";

import type { AgentTool } from "../types";

// ── Individual tool imports — kept for the export { ... } compatibility block ─
// and direct variable references inside telegramCoachTools().
// No circular deps: individual tool files never import from this file.
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

// ── Registry-derived data (single source of truth) ────────────────────────────
// ALL_TOOLS, GOOGLE_GATED, and TOOL_GROUP_MAP are now produced from the
// capability registry rather than being maintained as parallel hardcoded lists.

// All tools registered across all capabilities (deduplicated by name).
export const ALL_TOOLS: AgentTool[] = capabilityRegistry.getAllTools();

// Set of tool names that require a valid Google OAuth token.
const GOOGLE_GATED: Set<string> = capabilityRegistry.getGoogleGatedNames();

// Map of toolName → ToolGroups[]; respects per-tool group overrides declared
// in each capability module, falling back to capability-level toolGroups.
const TOOL_GROUP_MAP: Record<string, string[]> = capabilityRegistry.buildToolGroupMap();

// ── filterToolsByGroups ────────────────────────────────────────────────────────
/**
 * Return the subset of ALL_TOOLS whose groups intersect `requestedGroups`.
 * Google-gated tools are only included when `hasGoogle` is true.
 */
export function filterToolsByGroups(
  requestedGroups: ToolGroup[],
  hasGoogle = false,
): AgentTool[] {
  const groupSet = new Set<string>(requestedGroups);
  return ALL_TOOLS.filter((tool) => {
    if (GOOGLE_GATED.has(tool.name) && !hasGoogle) return false;
    const toolGroups = TOOL_GROUP_MAP[tool.name];
    if (!toolGroups) return false; // unmapped tools are excluded from scoped bundles
    return toolGroups.some((g) => groupSet.has(g));
  });
}

// ── Tool index + resolver ──────────────────────────────────────────────────────
const TOOL_INDEX = new Map(ALL_TOOLS.map((t) => [t.name, t]));

// Wire the resolver so testToolTool can look up tools without a circular import.
initToolResolver((name) => TOOL_INDEX.get(name));

export function getTool(name: string): AgentTool | undefined {
  return TOOL_INDEX.get(name);
}

// ── telegramCoachTools ────────────────────────────────────────────────────────
/** Tool bundle for the Telegram coach loop.
 *
 * Includes all tools EXCEPT spawn_subagent (agent-internal only).
 * Google-gated tools are appended when `hasGoogle` is true.
 */
export function telegramCoachTools(opts: { hasGoogle: boolean }): AgentTool[] {
  return ALL_TOOLS.filter((tool) => {
    if (tool.name === "spawn_subagent") return false;
    if (GOOGLE_GATED.has(tool.name) && !opts.hasGoogle) return false;
    return true;
  });
}

// ── Individual re-exports (compatibility layer) ────────────────────────────────
// Other modules import specific tools from this file; preserve every export.
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
