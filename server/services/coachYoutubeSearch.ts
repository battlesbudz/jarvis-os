import ytSearch from "yt-search";

type CoachToolExecutionResult = {
  result: "success" | "error" | "pending";
  label: string;
  detail: string;
};

export async function executeCoachYoutubeSearch(args: any): Promise<CoachToolExecutionResult> {
  const query = String(args.query || "").trim();
  if (!query) return { result: "error", label: "query required", detail: "Provide a search query." };
  const maxResults = Math.min(Math.max(typeof args.maxResults === "number" ? args.maxResults : 8, 1), 10);
  const trendingMode = !!args.trending;
  const daysBack = typeof args.daysBack === "number" ? args.daysBack : 5;
  try {
    const searchResult = await ytSearch({ query, pageStart: 1, pageEnd: 1 });
    let videos = (searchResult.videos || []) as any[];

    if (trendingMode) {
      const daysMs = daysBack * 24 * 60 * 60 * 1000;
      videos = videos
        .map((v: any) => {
          const viewCount = typeof v.views === "number" ? v.views : parseInt(String(v.views).replace(/[^0-9]/g, ""), 10) || 0;
          let ageMs = daysBack * 24 * 60 * 60 * 1000;
          if (v.ago) {
            const agoMatch = v.ago.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
            if (agoMatch) {
              const n = parseInt(agoMatch[1], 10);
              const unit = agoMatch[2].toLowerCase();
              const unitMs: Record<string, number> = {
                second: 1000, minute: 60000, hour: 3600000,
                day: 86400000, week: 604800000, month: 2592000000, year: 31536000000,
              };
              ageMs = n * (unitMs[unit] || 86400000);
            }
          }
          const ageHours = Math.max(ageMs / 3600000, 1);
          const viewsPerHour = Math.round(viewCount / ageHours);
          return { ...v, viewCount, ageMs, viewsPerHour };
        })
        .filter((v: any) => v.ageMs <= daysMs)
        .sort((a: any, b: any) => b.viewsPerHour - a.viewsPerHour)
        .slice(0, maxResults);

      if (videos.length === 0) return { result: "error", label: "No trending results", detail: `No videos found in the last ${daysBack} days for: "${query}"` };

      const formatted = videos.map((v: any, i: number) => {
        const views = v.viewCount.toLocaleString();
        const vph = v.viewsPerHour.toLocaleString();
        const ago = v.ago || "unknown date";
        return `${i + 1}. "${v.title}"\n   Channel: ${v.author?.name || "unknown"}\n   Views/hr: ${vph} | Total: ${views} | Posted: ${ago}\n   Video ID: ${v.videoId}\n   URL: ${v.url}`;
      }).join("\n\n");

      return {
        result: "success",
        label: `YouTube trending: ${videos.length} results`,
        detail: `Trending search (views/hour): "${query}" — last ${daysBack} days\n\n${formatted}`,
      };
    }

    videos = videos.slice(0, maxResults);
    if (videos.length === 0) return { result: "error", label: "No results", detail: `No YouTube videos found for: "${query}"` };
    const formatted = videos.map((v: any, i: number) => {
      const views = typeof v.views === "number" ? v.views.toLocaleString() : (v.views || "unknown");
      const ago = v.ago || "unknown date";
      const duration = v.duration?.timestamp || v.duration || "unknown";
      return `${i + 1}. "${v.title}"\n   Channel: ${v.author?.name || "unknown"}\n   Views: ${views} | Posted: ${ago} | Duration: ${duration}\n   Video ID: ${v.videoId}\n   URL: ${v.url}`;
    }).join("\n\n");
    return {
      result: "success",
      label: `YouTube search: ${videos.length} results`,
      detail: `Search: "${query}"\n\n${formatted}\n\nTo open a video on the phone: android_browse with url='vnd.youtube://watch?v=VIDEO_ID'\nTo get its transcript: fetch_youtube_transcript with videoId='VIDEO_ID'`,
    };
  } catch (err: any) {
    return { result: "error", label: "YouTube search failed", detail: err?.message || String(err) };
  }
}
