/**
 * Topic/workspace context provider — registered into the contextRegistry.
 *
 * When a user is messaging from a Discord workspace channel that has been
 * assigned to a specific life area (topic), this provider injects a brief
 * context block into the system prompt so the agent stays focused on that area.
 *
 * Only active for `platform === "discord"` with a non-null `channelId`.
 *
 * Priority: 100 (runs after date/time and calendar providers).
 */

import { contextRegistry } from "../contextRegistry";
import { db } from "../../db";
import { channelLinks } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getTopicForChannel, WORKSPACE_TOPICS, type WorkspaceMeta } from "../../discord/workspace";

contextRegistry.register(
  async (input) => {
    if (input.platform !== "discord" || !input.channelId) return;

    try {
      // Load the Discord channel link to access workspace metadata.
      const [link] = await db
        .select()
        .from(channelLinks)
        .where(and(eq(channelLinks.userId, input.userId), eq(channelLinks.channel, "discord")))
        .limit(1);

      if (!link?.meta) return;

      const workspace = (link.meta as { workspace?: WorkspaceMeta }).workspace;
      if (!workspace) return;

      const topic = getTopicForChannel(workspace, input.channelId);
      if (!topic) return;

      const topicName =
        topic.name.charAt(0).toUpperCase() + topic.name.slice(1);

      return {
        systemContext:
          `[Workspace channel: ${topic.emoji} ${topicName}. ` +
          `${topic.description} ` +
          `Keep your response focused on this life area unless the user explicitly asks about something else.]`,
      };
    } catch {
      // Non-blocking — if the workspace lookup fails just skip the context.
      return;
    }
  },
  { priority: 100 },
);

export { WORKSPACE_TOPICS };
