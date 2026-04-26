/**
 * Channel-aware tool resolver.
 *
 * Provides a canonical mapping from display channel names (e.g. "Discord #research",
 * "Telegram", "Voice") to the registered ChannelName key, then uses the channel's
 * declared toolGroups to build a scoped AgentTool list.
 *
 * Used by coachAgent.ts (pre-harness, caller-side filter) and by the harness
 * itself (post-call-site safety gate keyed on context.channel).
 */

import type { AgentTool } from "../types";
import { filterToolsByGroups } from "./index";
import type { ToolGroup } from "./index";
import type { ChannelName } from "../../channels/types";

/** Fallback groups for channels that are not in the registry. */
const UNREGISTERED_FALLBACKS: Readonly<Record<string, ToolGroup[]>> = {
  daemon: ["coaching", "calendar", "memory", "connections", "system"],
  voice:  ["coaching", "calendar", "memory"],
};

/** Fallback for truly unrecognisable channel names. */
const UNKNOWN_CHANNEL_GROUPS: ToolGroup[] = [
  "coaching", "calendar", "email", "memory", "connections", "research",
];

/**
 * Map a display channel name (as passed via CoachReplyInput.channelName or
 * context.channel) to the canonical ChannelName registry key.
 *
 * Examples:
 *   "Discord #research"  → "discord"
 *   "Discord DM"         → "discord"
 *   "Discord"            → "discord"
 *   "Telegram"           → "telegram"
 *   "WhatsApp"           → "whatsapp"
 *   "Daemon"             → "daemon"   (not in registry, handled by fallback)
 *   "Voice"              → undefined  (not in registry, handled by fallback)
 *
 * Returns undefined for channels that have no registry entry.  Callers should
 * use UNREGISTERED_FALLBACKS / UNKNOWN_CHANNEL_GROUPS in that case.
 */
export function parseChannelKey(displayName: string): ChannelName | undefined {
  const lower = displayName.toLowerCase();

  if (lower.startsWith("discord")) return "discord";
  if (lower.startsWith("telegram")) return "telegram";
  if (lower === "whatsapp" || lower.startsWith("whatsapp")) return "whatsapp";
  if (lower === "slack") return "slack";
  if (lower === "in_app" || lower === "in-app" || lower.startsWith("in app")) return "in_app";
  // daemon/voice: no registry entry — handled by the fallback table below

  return undefined;
}

/**
 * Resolve the scoped AgentTool list for a display channel name.
 *
 * Resolution order:
 * 1. Parse display name → canonical ChannelName
 * 2. Look up the Channel object in the registry → read its toolGroups
 * 3. If the channel is not in the registry, use UNREGISTERED_FALLBACKS
 * 4. If the channel is completely unknown, use UNKNOWN_CHANNEL_GROUPS
 *
 * This function is async because it lazily imports the channel registry to
 * avoid circular module dependencies at boot time.
 */
export async function resolveChannelTools(
  displayName: string,
  hasGoogle: boolean,
): Promise<AgentTool[]> {
  const key = parseChannelKey(displayName);

  let groups: ToolGroup[] | undefined;

  if (key) {
    // Lazy import to avoid circular deps (channels/ → agent/tools → channels/)
    const { getChannel } = await import("../../channels/registry");
    const ch = getChannel(key);
    groups = ch?.toolGroups;
  }

  if (!groups) {
    const lower = displayName.toLowerCase();
    groups = UNREGISTERED_FALLBACKS[lower] ?? UNKNOWN_CHANNEL_GROUPS;
  }

  return filterToolsByGroups(groups, hasGoogle);
}
