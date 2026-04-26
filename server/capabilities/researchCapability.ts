import type { Capability } from "./types";
import { webSearchTool, researchTopicTool } from "../agent/tools/webSearch";
import { webFetchTool } from "../agent/tools/webFetch";
import { youtubeSearchTool } from "../agent/tools/youtubeSearch";
import { youtubeTranscriptTool } from "../agent/tools/youtubeTranscript";

export const researchCapability: Capability = {
  id: "research",
  label: "Research & Web",
  toolGroups: ["research"],
  tools: [webSearchTool, researchTopicTool, webFetchTool, youtubeSearchTool, youtubeTranscriptTool],
  configRequirements: [
    { key: "TAVILY_API_KEY", label: "Tavily Search API Key", optional: true },
  ],
  async healthCheck() {
    if (!process.env.TAVILY_API_KEY) {
      return { healthy: false, reason: "TAVILY_API_KEY not configured — web search unavailable" };
    }
    return { healthy: true };
  },
};
