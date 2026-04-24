/**
 * Discord OS Phase 2 — YouTube Search (coach agent version)
 *
 * Provides server-side YouTube video search for the coach agent,
 * used by Discord scheduled reports and any research tasks.
 *
 * Two modes:
 *  - Standard: rank by total view count (default)
 *  - Trending:  rank by views-per-hour velocity (opt-in with trending:true)
 *
 * The trending mode is ONLY activated when the user explicitly says
 * words like "trending", "viral", "gaining momentum", or "views per hour".
 */

import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";

const DAYS_BACK_DEFAULT = 5;
const MAX_RESULTS_DEFAULT = 15;

interface VideoResult {
  title: string;
  channelName: string;
  viewCount: number;
  viewsPerHour: number;
  ago: string;
  ageHours: number;
  videoId: string;
  url: string;
}

/** Parse "X days ago", "X hours ago", etc. into milliseconds */
function parseAgoToMs(ago: string, fallbackMs: number): number {
  const m = ago.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
  if (!m) return fallbackMs;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const unitMs: Record<string, number> = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  };
  return n * (unitMs[unit] ?? 86_400_000);
}

export const youtubeSearchTool: AgentTool = {
  name: "search_youtube",
  description:
    "Search YouTube server-side and return structured results: title, channel, view count, published date, video ID, and URL. " +
    "Use this for YouTube video research, competitor analysis, and finding content in any niche. " +
    "Pass trending:true ONLY when the user explicitly asks for 'trending', 'viral', 'gaining momentum', or 'views per hour' — " +
    "this sorts by views-per-hour velocity instead of total views, and filters to videos published within daysBack days. " +
    "For general YouTube search (without trending language), use standard mode (trending:false or omitted).",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "YouTube search query, e.g. 'ADHD productivity tools 2024' or 'AI video editing tutorials'",
      },
      trending: {
        type: "boolean",
        description:
          "If true, sort by views-per-hour (velocity) instead of total views. " +
          "ONLY use when the user explicitly says 'trending', 'viral', 'momentum', or 'views per hour'.",
      },
      daysBack: {
        type: "number",
        description:
          "When trending:true, only include videos published within this many days (default 5). " +
          "Use 1 for last 24h, 7 for last week.",
      },
      maxResults: {
        type: "number",
        description: "Maximum results to return (1–15, default 15).",
      },
    },
    required: ["query"],
  },

  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const query = String(args.query || "").trim();
    if (!query) {
      return { ok: false, content: "Please provide a search query.", label: "Missing query" };
    }

    const trendingMode = !!args.trending;
    const daysBack =
      typeof args.daysBack === "number" ? Math.max(args.daysBack, 1) : DAYS_BACK_DEFAULT;
    const maxResults =
      typeof args.maxResults === "number"
        ? Math.min(Math.max(args.maxResults, 1), MAX_RESULTS_DEFAULT)
        : MAX_RESULTS_DEFAULT;
    const daysMs = daysBack * 24 * 60 * 60 * 1000;

    console.log(
      `[search_youtube] query="${query}" trending=${trendingMode} daysBack=${daysBack} max=${maxResults} (user=${ctx.userId})`,
    );

    try {
      const ytSearch = (await import("yt-search")).default;
      const searchResult = await ytSearch({ query, pageStart: 1, pageEnd: 1 });
      let rawVideos: any[] = searchResult.videos || [];

      // Map raw results to typed objects
      let videos: VideoResult[] = rawVideos.map((v: any) => {
        const viewCount =
          typeof v.views === "number"
            ? v.views
            : parseInt(String(v.views || "0").replace(/[^0-9]/g, ""), 10) || 0;
        const ago = v.ago || "";
        const fallbackMs = daysBack * 24 * 60 * 60 * 1000;
        const ageMs = ago ? parseAgoToMs(ago, fallbackMs) : fallbackMs;
        const ageHours = Math.max(ageMs / 3_600_000, 1);
        const viewsPerHour = Math.round(viewCount / ageHours);
        return {
          title: v.title || "(no title)",
          channelName: v.author?.name || v.channel?.name || "unknown",
          viewCount,
          viewsPerHour,
          ago: ago || "unknown date",
          ageHours,
          videoId: v.videoId || "",
          url: v.url || `https://youtube.com/watch?v=${v.videoId}`,
        };
      });

      if (trendingMode) {
        // Filter to daysBack window and sort by views-per-hour
        videos = videos
          .filter((v) => {
            const ageMs = v.ageHours * 3_600_000;
            return ageMs <= daysMs;
          })
          .sort((a, b) => b.viewsPerHour - a.viewsPerHour)
          .slice(0, maxResults);

        if (videos.length === 0) {
          return {
            ok: false,
            content: `No trending videos found in the last ${daysBack} days for: "${query}". Try increasing daysBack or use a broader query.`,
            label: "No trending results",
          };
        }

        const tableHeader = `Rank | Title | Channel | Views/hr | Total Views | Published\n${"─".repeat(80)}`;
        const rows = videos.map((v, i) => {
          const views = v.viewCount.toLocaleString();
          const vph = v.viewsPerHour.toLocaleString();
          return `${String(i + 1).padStart(2)}. **${v.title}**\n    Channel: ${v.channelName} | Views/hr: ${vph} | Total: ${views} | Posted: ${v.ago}\n    URL: ${v.url}`;
        });

        const content = `**YouTube Trending: "${query}"** (last ${daysBack} days, sorted by views/hour)\n\n${tableHeader}\n\n${rows.join("\n\n")}`;

        return {
          ok: true,
          content,
          label: `YouTube trending (${videos.length} results): ${query}`,
        };
      }

      // Standard mode — sort by total views, no time filter
      videos = [...videos].sort((a, b) => b.viewCount - a.viewCount).slice(0, maxResults);

      if (videos.length === 0) {
        return {
          ok: false,
          content: `No YouTube videos found for: "${query}".`,
          label: "No results",
        };
      }

      const tableHeader = `Rank | Title | Channel | Total Views | Published\n${"─".repeat(70)}`;
      const rows = videos.map((v, i) => {
        const views = v.viewCount.toLocaleString();
        return `${String(i + 1).padStart(2)}. **${v.title}**\n    Channel: ${v.channelName} | Views: ${views} | Posted: ${v.ago}\n    URL: ${v.url}`;
      });

      const content = `**YouTube Search: "${query}"** (sorted by total views)\n\n${tableHeader}\n\n${rows.join("\n\n")}`;

      return {
        ok: true,
        content,
        label: `YouTube search (${videos.length} results): ${query}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[search_youtube] failed: ${msg}`);
      return {
        ok: false,
        content: `YouTube search failed: ${msg}`,
        label: "YouTube search error",
      };
    }
  },
};
