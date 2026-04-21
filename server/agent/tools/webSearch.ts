import type { AgentTool } from "../types";
import { tavilySearch, formatSearchResults } from "../../integrations/search";

export const webSearchTool: AgentTool = {
  name: "search_web",
  description:
    "Search the web for current information — news, weather, prices, recent events, product info, anything requiring up-to-date data. Returns a short answer plus the top results.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to search for" },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    if (!process.env.TAVILY_API_KEY) {
      return { ok: false, content: "Web search is not configured.", label: "Search unavailable" };
    }
    try {
      const results = await tavilySearch(args.query);
      const formatted = formatSearchResults(results);
      console.log(`[${ctx.channel || "Agent"}] search_web "${args.query}" → ${results.results?.length || 0} results`);
      return {
        ok: true,
        content: formatted || "No results found.",
        label: `Web search: ${args.query}`,
        detail: formatted,
      };
    } catch (err: any) {
      const msg = String(err?.message || err);
      const label =
        msg.includes("401") || msg.includes("403") ? "Search auth failed" :
        msg.includes("429") ? "Search rate limited" :
        msg.includes("timeout") || msg.includes("ETIMEDOUT") ? "Search timed out" :
        "Search failed";
      return { ok: false, content: `${label}: ${msg}`, label, detail: msg };
    }
  },
};

export const researchTopicTool: AgentTool = {
  name: "research_topic",
  description:
    "Do deeper research on a topic by running 2-4 related web searches and synthesizing the findings. Use this when the user wants a briefing, summary, or 'look into X for me' — not for quick lookups (use search_web for those). Returns aggregated raw results which you should summarize for the user.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The main topic or question to research",
      },
      sub_queries: {
        type: "array",
        items: { type: "string" },
        description:
          "2-4 specific search queries that together cover the topic. If omitted, the topic itself is searched.",
      },
    },
    required: ["topic"],
  },
  async execute(args, ctx) {
    if (!process.env.TAVILY_API_KEY) {
      return { ok: false, content: "Research is not available — web search is not configured.", label: "Research unavailable" };
    }

    const queries: string[] = Array.isArray(args.sub_queries) && args.sub_queries.length > 0
      ? args.sub_queries.slice(0, 4).map(String)
      : [String(args.topic)];

    try {
      const results = await Promise.all(
        queries.map((q) =>
          tavilySearch(q, 4).catch((err) => ({ answer: `(search failed: ${err?.message || err})`, results: [] }))
        )
      );

      const sections = queries.map((q, i) => {
        const formatted = formatSearchResults(results[i] as any);
        return `### Query: ${q}\n${formatted || "(no results)"}`;
      });

      const aggregated =
        `Research findings on: ${args.topic}\n\n` + sections.join("\n\n");

      console.log(`[${ctx.channel || "Agent"}] research_topic "${args.topic}" — ${queries.length} sub-queries`);

      return {
        ok: true,
        content: aggregated,
        label: `Researched: ${args.topic}`,
        detail: `Ran ${queries.length} search${queries.length === 1 ? "" : "es"}`,
      };
    } catch (err: any) {
      return {
        ok: false,
        content: `Research failed: ${err?.message || err}`,
        label: "Research failed",
        detail: String(err?.message || err),
      };
    }
  },
};
