import type { Capability } from "./types";
import { discordPostTool } from "../agent/tools/discordPost";
import { discordCreateChannelTool } from "../agent/tools/discordCreateChannel";
import { discordDeleteChannelTool } from "../agent/tools/discordDeleteChannel";
import { discordListChannelsTool } from "../agent/tools/discordListChannels";
import { discordPinMessageTool } from "../agent/tools/discordPinMessage";
import { discordSendToChannelTool } from "../agent/tools/discordSendToChannel";
import { discordRequestConfirmTool } from "../agent/tools/discordRequestConfirm";
import { setupNamedAgentTool } from "../agent/tools/setupNamedAgent";
import { setupContentPipelineTool } from "../agent/tools/setupContentPipeline";
import { setupDiscordWorkspaceTool } from "../agent/tools/setupDiscordWorkspace";
import {
  scheduleChannelReportTool,
  listChannelSchedulesTool,
  deleteChannelScheduleTool,
} from "../agent/tools/scheduleChannelReport";

const DISCORD_TOOL_NAMES = [
  "discord_request_confirm",
  "discord_post",
  "discord_create_channel",
  "discord_send_to_channel",
  "discord_delete_channel",
  "discord_list_channels",
  "discord_pin_message",
  "setup_discord_workspace",
  "setup_content_pipeline",
  "setup_named_agent",
  "schedule_channel_report",
  "list_channel_schedules",
  "delete_channel_schedule",
];

export const discordCapability: Capability = {
  id: "discord",
  label: "Discord",
  toolGroups: ["discord"],
  toolGroupOverrides: {
    setup_named_agent:      ["discord", "system"],
    schedule_channel_report: ["discord", "scheduling"],
    list_channel_schedules:  ["discord", "scheduling"],
    delete_channel_schedule: ["discord", "scheduling"],
  },
  tools: [
    discordRequestConfirmTool,
    discordPostTool,
    discordCreateChannelTool,
    discordSendToChannelTool,
    discordDeleteChannelTool,
    discordListChannelsTool,
    discordPinMessageTool,
    setupNamedAgentTool,
    setupContentPipelineTool,
    setupDiscordWorkspaceTool,
    scheduleChannelReportTool,
    listChannelSchedulesTool,
    deleteChannelScheduleTool,
  ],
  integrationDependencies: [
    {
      integrationId: "discord",
      label: "Discord",
      toolNames: DISCORD_TOOL_NAMES,
    },
  ],
  configRequirements: [
    { key: "DISCORD_BOT_TOKEN", label: "Discord Bot Token", optional: true },
    { key: "DISCORD_CLIENT_ID", label: "Discord Application Client ID", optional: true },
  ],
  async healthCheck() {
    if (!process.env.DISCORD_BOT_TOKEN) {
      return { healthy: true, reason: "Discord optional channel is disabled." };
    }
    if (!process.env.DISCORD_CLIENT_ID) {
      return {
        healthy: true,
        reason: "Discord bot token is configured; client ID is only needed for setup flows.",
      };
    }
    return { healthy: true };
  },
};
