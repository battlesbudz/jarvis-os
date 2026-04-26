import type { Capability } from "./types";
import { checkConnectionsTool, generateReconnectLinkTool } from "../agent/tools/connections";
import { connectChannelTool } from "../agent/tools/connectChannel";

/**
 * Connections capability — tools that help users connect integrations.
 * Also registers the channel-only integrations (Outlook, Telegram, Slack,
 * WhatsApp) so the harness can inject advisory system prompt notes when
 * those delivery channels are broken (even though they have no agent tools).
 */
export const connectionsCapability: Capability = {
  id: "connections",
  label: "Connections & Channels",
  toolGroups: ["connections"],
  toolGroupOverrides: {
    check_connections:       ["connections", "system"],
    generate_reconnect_link: ["connections", "system"],
    connect_channel:         ["connections", "system"],
  },
  tools: [checkConnectionsTool, generateReconnectLinkTool, connectChannelTool],
  integrationDependencies: [
    { integrationId: "telegram",  label: "Telegram",                toolNames: [] },
    { integrationId: "slack",     label: "Slack",                   toolNames: [] },
    { integrationId: "whatsapp",  label: "WhatsApp (via Twilio)",   toolNames: [] },
  ],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
