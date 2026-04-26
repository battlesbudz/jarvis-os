import type { AgentTool } from "../types";
import { tavilySearch, formatSearchResults } from "../../integrations/search";
import type { SearchResult } from "../../integrations/search";
import { callBrowserTool } from "../mcp/playwrightMcpClient";

type TavilyLikeResult = Awaited<ReturnType<typeof tavilySearch>>;
function emptyTavilyResult(answer: string): TavilyLikeResult {
  return { answer, results: [] } as TavilyLikeResult;
}

const JS_SPARSE_THRESHOLD = 200;
const MAX_BROWSER_FALLBACK = 2;

// SSRF guard for the browser fallback — mirrors the one in browserTools.ts
const BLOCKED_SEARCH_HOSTS = /^(localhost|0\.0\.0\.0|metadata\.google\.internal|169\.254\.169\.254)$/i;
const PRIVATE_IP_PATTERNS = [
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
];

function isSafeSearchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_SEARCH_HOSTS.test(host)) return false;
    if (host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (PRIVATE_IP_PATTERNS.some((rx) => rx.test(host))) return false;
    return true;
  } catch { return false; }
}

/**
 * For search results with very short content (likely JS-rendered pages where
 * Tavily's crawler got little text), attempt to retrieve richer content via
 * the Playwright MCP browser.  At most MAX_BROWSER_FALLBACK URLs are fetched
 * to keep latency reasonable.
 */
async function enrichSparseResults(
  results: SearchResult[],
  userId: string,
): Promise<SearchResult[]> {
  const enriched = [...results];
  let attempts = 0;
  for (let i = 0; i < enriched.length && attempts < MAX_BROWSER_FALLBACK; i++) {
    if (enriched[i].content.trim().length >= JS_SPARSE_THRESHOLD) continue;
    const url = enriched[i].url;
    if (!isSafeSearchUrl(url)) continue;
    try {
      await callBrowserTool(userId, "browser_navigate", { url });
      const snap = await callBrowserTool(userId, "browser_snapshot", {});
      const text = snap.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("\n")
        .trim()
        .slice(0, 2000);
      if (text.length > enriched[i].content.length) {
        enriched[i] = { ...enriched[i], content: text };
      }
    } catch {
      /* best-effort — don't fail research if browser fallback errors */
    }
    attempts++;
  }
  return enriched;
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
      const rawResults: TavilyLikeResult[] = await Promise.all(
        queries.map((q) =>
          tavilySearch(q, 4).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            return emptyTavilyResult(`(search failed: ${msg})`);
          })
        )
      );

      // Enrich sparse (likely JS-rendered) results via Playwright MCP browser fallback.
      // Flatten → enrich (max 2 URLs total) → re-map back per query.
      const allResults = rawResults.flatMap((r) => r.results);
      const enrichedAll = await enrichSparseResults(allResults, ctx.userId);
      let offset = 0;
      const enrichedByQuery: TavilyLikeResult[] = rawResults.map((r) => {
        const count = r.results.length;
        const slice = enrichedAll.slice(offset, offset + count);
        offset += count;
        return { ...r, results: slice };
      });

      const sections = queries.map((q, i) => {
        const formatted = formatSearchResults(enrichedByQuery[i]);
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
