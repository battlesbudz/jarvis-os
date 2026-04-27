/**
 * X/Twitter Search Tool
 *
 * Searches X (Twitter) recent posts using the X API v2 recent search endpoint.
 * Returns structured results: text, author, timestamp, engagement metrics, and URL.
 *
 * Requires the X_BEARER_TOKEN environment secret.
 * Only available to agents with the research or web permission profile (can_search_web).
 */

import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";

const X_API_BASE = "https://api.twitter.com/2";

interface XTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    impression_count: number;
  };
}

interface XUser {
  id: string;
  name: string;
  username: string;
}

interface XSearchResponse {
  data?: XTweet[];
  includes?: {
    users?: XUser[];
  };
  meta?: {
    result_count: number;
    newest_id?: string;
    oldest_id?: string;
  };
  errors?: Array<{ message: string; type?: string }>;
  title?: string;
  detail?: string;
  status?: number;
}

function formatTimestamp(iso?: string): string {
  if (!iso) return "unknown time";
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    return `${diffDays}d ago`;
  } catch {
    return iso;
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatResults(tweets: XTweet[], userMap: Map<string, XUser>, query: string): string {
  if (tweets.length === 0) return `No posts found on X for: "${query}"`;

  const lines: string[] = [`**X Search: "${query}"** — ${tweets.length} result${tweets.length === 1 ? "" : "s"}\n`];

  for (let i = 0; i < tweets.length; i++) {
    const t = tweets[i];
    const user = t.author_id ? userMap.get(t.author_id) : undefined;
    const handle = user ? `@${user.username}` : "(unknown)";
    const name = user?.name || handle;
    const when = formatTimestamp(t.created_at);
    const url = `https://x.com/${user?.username || "i"}/status/${t.id}`;

    const metrics = t.public_metrics;
    const statsStr = metrics
      ? `❤️ ${formatNumber(metrics.like_count)}  🔁 ${formatNumber(metrics.retweet_count)}  💬 ${formatNumber(metrics.reply_count)}`
      : "";

    lines.push(
      `${i + 1}. **${name}** (${handle}) · ${when}\n` +
      `   ${t.text.replace(/\n+/g, " ")}\n` +
      (statsStr ? `   ${statsStr}\n` : "") +
      `   ${url}`,
    );
  }

  return lines.join("\n");
}

export const xSearchTool: AgentTool = {
  name: "x_search",
  description:
    "Search X (Twitter) for recent posts about a topic, brand, person, or event. " +
    "Returns real-time results including post text, author, timestamp, likes, retweets, and URL. " +
    "Use this when the user wants social signals, trending topics, public reactions, brand mentions, or thought-leader opinions on X. " +
    "Different from web_search — this surfaces live social conversation, not indexed web pages.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "X search query. Supports keywords, hashtags (#AI), mentions (@elonmusk), and operators like 'from:username', 'lang:en'. Example: 'OpenAI GPT-5 lang:en'",
      },
      max_results: {
        type: "number",
        description: "Number of posts to return (10–50, default 20).",
      },
      sort_order: {
        type: "string",
        enum: ["recency", "relevancy"],
        description: "Sort by 'recency' (newest first, default) or 'relevancy' (most relevant first).",
      },
    },
    required: ["query"],
  },

  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const bearerToken = process.env.X_BEARER_TOKEN;
    if (!bearerToken) {
      return {
        ok: false,
        content: "X search is not configured. The X_BEARER_TOKEN secret is missing.",
        label: "X search unavailable",
      };
    }

    const query = String(args.query || "").trim();
    if (!query) {
      return { ok: false, content: "Please provide a search query.", label: "Missing query" };
    }

    const maxResults = typeof args.max_results === "number"
      ? Math.min(Math.max(Math.round(args.max_results), 10), 50)
      : 20;

    const sortOrder = args.sort_order === "relevancy" ? "relevancy" : "recency";

    console.log(`[x_search] query="${query}" max=${maxResults} sort=${sortOrder} (user=${ctx.userId})`);

    try {
      const params = new URLSearchParams({
        query,
        max_results: String(maxResults),
        sort_order: sortOrder,
        "tweet.fields": "created_at,author_id,public_metrics",
        expansions: "author_id",
        "user.fields": "username,name",
      });

      const response = await fetch(`${X_API_BASE}/tweets/search/recent?${params.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });

      const body: XSearchResponse = await response.json() as XSearchResponse;

      // Handle API-level errors
      if (!response.ok) {
        const errTitle = body.title || "X API error";
        const errDetail = body.detail || (body.errors?.[0]?.message) || response.statusText;

        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            content: `X search authentication failed (${response.status}). Please check your X_BEARER_TOKEN.`,
            label: "X auth failed",
            detail: errDetail,
          };
        }

        if (response.status === 429) {
          return {
            ok: false,
            content: "X search rate limit reached. Please try again shortly.",
            label: "X rate limited",
          };
        }

        return {
          ok: false,
          content: `X search error (${response.status}): ${errTitle} — ${errDetail}`,
          label: "X search failed",
          detail: errDetail,
        };
      }

      const tweets = body.data ?? [];
      const users = body.includes?.users ?? [];
      const resultCount = body.meta?.result_count ?? tweets.length;

      if (resultCount === 0 || tweets.length === 0) {
        return {
          ok: true,
          content: `No recent posts found on X for: "${query}". The query may be too specific or there's no recent activity.`,
          label: `X search: no results for "${query}"`,
        };
      }

      const userMap = new Map<string, XUser>(users.map((u) => [u.id, u]));
      const formatted = formatResults(tweets, userMap, query);

      return {
        ok: true,
        content: formatted,
        label: `X search (${tweets.length} posts): ${query}`,
        detail: `Found ${tweets.length} posts, sorted by ${sortOrder}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("TimeoutError") || msg.includes("timed out") || msg.includes("ETIMEDOUT")) {
        return { ok: false, content: "X search timed out. Please try again.", label: "X search timeout" };
      }

      console.error(`[x_search] error: ${msg}`);
      return {
        ok: false,
        content: `X search failed: ${msg}`,
        label: "X search error",
        detail: msg,
      };
    }
  },
};
