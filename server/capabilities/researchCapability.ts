import type { Capability } from "./types";
import { webSearchTool, researchTopicTool } from "../agent/tools/webSearch";
import { webFetchTool } from "../agent/tools/webFetch";
import { youtubeSearchTool } from "../agent/tools/youtubeSearch";
import { xSearchTool } from "../agent/tools/xSearch";

export const researchCapability: Capability = {
  id: "research",
  label: "Research & Web",
  toolGroups: ["research"],
  tools: [webSearchTool, researchTopicTool, webFetchTool, youtubeSearchTool, xSearchTool],
  configRequirements: [
    { key: "TAVILY_API_KEY", label: "Tavily Search API Key", optional: true },
    { key: "X_BEARER_TOKEN", label: "X (Twitter) API Bearer Token", optional: true },
  ],
  async healthCheck() {
    if (!process.env.TAVILY_API_KEY) {
      return { healthy: false, reason: "TAVILY_API_KEY not configured — web search unavailable" };
    }
    return { healthy: true };
  },
};
