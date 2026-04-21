import type { AgentTool } from "../types";
import { tavilySearch, formatSearchResults } from "../../integrations/search";

type TavilyLikeResult = Awaited<ReturnType<typeof tavilySearch>>;
function emptyTavilyResult(answer: string): TavilyLikeResult {
  return { answer, results: [] } as TavilyLikeResult;
}

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
    const query = String(args.query || "");
    try {
      const results = await tavilySearch(query);
      const formatted = formatSearchResults(results);
      console.log(`[${ctx.channel || "Agent"}] search_web "${query}" → ${results.results?.length || 0} results`);
      return {
        ok: true,
        content: formatted || "No results found.",
        label: `Web search: ${query}`,
        detail: formatted,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
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

    const topic = String(args.topic || "");
    const subQueriesRaw = args.sub_queries;
    const queries: string[] = Array.isArray(subQueriesRaw) && subQueriesRaw.length > 0
      ? subQueriesRaw.slice(0, 4).map((q) => String(q))
      : [topic];

    try {
      const results: TavilyLikeResult[] = await Promise.all(
        queries.map((q) =>
          tavilySearch(q, 4).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            return emptyTavilyResult(`(search failed: ${msg})`);
          })
        )
      );

      const sections = queries.map((q, i) => {
        const formatted = formatSearchResults(results[i]);
        return `### Query: ${q}\n${formatted || "(no results)"}`;
      });

      const aggregated = `Research findings on: ${topic}\n\n` + sections.join("\n\n");

      console.log(`[${ctx.channel || "Agent"}] research_topic "${topic}" — ${queries.length} sub-queries`);

      return {
        ok: true,
        content: aggregated,
        label: `Researched: ${topic}`,
        detail: `Ran ${queries.length} search${queries.length === 1 ? "" : "es"}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Research failed: ${msg}`, label: "Research failed", detail: msg };
    }
  },
};
