import type { Express, Request, RequestHandler, Response } from "express";

export function registerTranscriptDiagnoseRoutes(app: Express, authMiddleware: RequestHandler): void {
  /**
   * GET /api/transcript/diagnose?videoId=VIDEO_ID
   * Diagnoses the transcript pipeline for a specific video without spending quota.
   * Reports Gemini key status, Supadata key + native caption check, and yt-dlp availability.
   * Does NOT call Gemini (costs quota) - only checks key status and Supadata native captions.
   */
  app.get("/api/transcript/diagnose", authMiddleware, async (req: Request, res: Response) => {
    const videoId = String(req.query.videoId ?? "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId query parameter is required" });
      return;
    }

    try {
      const { getYtdlpStatus, ensureYtdlpUpgraded } = await import("../lib/transcriptCache");

      const geminiKeyConfigured = !!process.env.GOOGLE_GEMINI_API_KEY;
      const geminiKeyType = geminiKeyConfigured ? "direct" : "none";
      const geminiResult = {
        keyConfigured: geminiKeyConfigured,
        keyType: geminiKeyType,
        note: geminiKeyConfigured
          ? "Will attempt transcription as Phase 0 (direct Google AI Studio key)"
          : "Phase 0 skipped - no Gemini key configured. Set GOOGLE_GEMINI_API_KEY at https://aistudio.google.com/apikey",
      };

      const supadataKey = process.env.SUPADATA_API_KEY;
      let supadataResult: Record<string, unknown>;
      if (!supadataKey) {
        supadataResult = {
          keyConfigured: false,
          nativeCaptions: null,
          note: "Phase 0.5 skipped - SUPADATA_API_KEY not set. Get a free key at https://dash.supadata.ai",
        };
      } else {
        let nativeCaptions: boolean | null = null;
        let supadataNote = "";
        try {
          const nativeUrl = `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(videoId)}&lang=en&mode=native`;
          const nativeRes = await fetch(nativeUrl, {
            headers: { "x-api-key": supadataKey, "Content-Type": "application/json" },
          });
          if (nativeRes.ok) {
            const data = await nativeRes.json() as { content?: unknown[] | string };
            const content = data.content;
            nativeCaptions = Array.isArray(content) ? content.length > 0 : typeof content === "string" ? content.trim().length > 0 : false;
            supadataNote = nativeCaptions
              ? "Native captions found - fast, no credits. Will return immediately."
              : "Native captions empty - will use AI generation (mode=auto).";
          } else if (nativeRes.status === 404 || nativeRes.status === 400) {
            nativeCaptions = false;
            supadataNote = "No native captions - will use AI generation (mode=auto). Takes 5-10 min for long videos.";
          } else {
            const body = await nativeRes.text().catch(() => "");
            supadataNote = `Native caption check returned ${nativeRes.status}: ${body.slice(0, 200)}`;
          }
        } catch (supadataCheckErr) {
          supadataNote = `Native caption check failed: ${supadataCheckErr instanceof Error ? supadataCheckErr.message : String(supadataCheckErr)}`;
        }
        supadataResult = {
          keyConfigured: true,
          nativeCaptions,
          note: supadataNote,
        };
      }

      await ensureYtdlpUpgraded().catch(() => null);
      const ytdlpStatus = getYtdlpStatus();
      const ytdlpResult = {
        available: ytdlpStatus.available,
        cmd: ytdlpStatus.cmd,
        reason: ytdlpStatus.available
          ? "yt-dlp is installed and responding"
          : "yt-dlp is not available - audio transcription and caption download will fail. Note: cloud datacenter IPs are often blocked by YouTube, so yt-dlp success rates may be very low even when installed.",
      };

      const nativeCaptions = (supadataResult.nativeCaptions as boolean | null);
      let recommendation: string;
      if (geminiKeyConfigured && nativeCaptions !== false) {
        recommendation = "Gemini (Phase 0) is the fastest option. Supadata native captions also available.";
      } else if (geminiKeyConfigured) {
        recommendation = "Gemini (Phase 0) is the primary option. Supadata will use AI generation (mode=auto) - takes 5-10 min for long videos.";
      } else if (supadataKey && nativeCaptions === true) {
        recommendation = "Supadata native captions available - fast retrieval.";
      } else if (supadataKey) {
        recommendation = "Only Supadata AI generation is viable. Takes 5-10 min for long videos. Recommend enabling Gemini with GOOGLE_GEMINI_API_KEY.";
      } else {
        recommendation = "No cloud transcript methods available. Only local yt-dlp/Whisper pipeline remains, and cloud IPs are often blocked. Enable Gemini or Supadata.";
      }

      res.json({
        videoId,
        gemini: geminiResult,
        supadata: supadataResult,
        ytdlp: ytdlpResult,
        recommendation,
      });
    } catch (err) {
      console.error("[transcript/diagnose] failed:", err);
      res.status(500).json({ error: "Diagnose failed", detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
