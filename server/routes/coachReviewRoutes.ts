import type { Express, Request, Response } from "express";
import type OpenAI from "openai";
import { desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { userPreferences } from "@shared/schema";
import { db } from "../db";
import { personalCommitmentCondition } from "../commitments/dbCommitmentRepository";

export function registerCoachMorningBriefRoute(app: Express): void {
  // Returns today's morning brief if one was generated and stored by the
  // proactive scheduler. The frontend uses this to show the exact same text
  // in the Insights chat that was already sent to Telegram/daemon - no re-generation.
  app.get("/api/coach/morning-brief", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const today = new Date().toISOString().slice(0, 10);
      const rows = await db
        .select({ data: userPreferences.data })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      const prefs = (rows[0]?.data as any) || {};
      const brief = prefs.morningBrief;
      if (brief && brief.date === today && brief.text) {
        return res.json({ text: brief.text, date: brief.date });
      }
      return res.json({ text: null });
    } catch (err) {
      console.error("Error fetching morning brief:", err);
      return res.json({ text: null });
    }
  });
}

export function registerCoachWeeklyReviewRoute(app: Express, openai: OpenAI): void {
  app.post("/api/coach/weekly-review", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { goals, stats, history } = req.body;

      let weekCommitments: any[] = [];
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        weekCommitments = await db
          .select()
          .from(schema.commitments)
          .where(personalCommitmentCondition(userId))
          .orderBy(desc(schema.commitments.extractedAt))
          .limit(30);
        weekCommitments = weekCommitments.filter((c: any) =>
          new Date(c.extractedAt).getTime() >= sevenDaysAgo.getTime()
        );
      } catch {}

      const completedHistory = (history || []).filter((h: any) => h.completed);
      const skippedHistory = (history || []).filter((h: any) => !h.completed);
      const doneCommitments = weekCommitments.filter((c: any) => c.status === "done");
      const pendingCommitments = weekCommitments.filter((c: any) => c.status === "pending");

      const prompt = `Generate a weekly productivity review. Be specific and direct.

This week's data:
- Tasks completed: ${completedHistory.length} (${completedHistory.slice(0, 10).map((h: any) => h.title).join(", ") || "none"})
- Tasks skipped/incomplete: ${skippedHistory.length} (${skippedHistory.slice(0, 10).map((h: any) => h.title).join(", ") || "none"})
- Commitments made: ${weekCommitments.length}
- Commitments fulfilled: ${doneCommitments.length} (${doneCommitments.map((c: any) => c.content).join(", ") || "none"})
- Commitments still pending: ${pendingCommitments.length} (${pendingCommitments.map((c: any) => c.content).join(", ") || "none"})
- Goals: ${(goals || []).map((g: any) => `${g.title} (${g.current}/${g.target} ${g.unit})`).join(", ") || "none"}
- Current streak: ${stats?.streak || 0} days

Return JSON:
{
  "headline": "One punchy sentence summarizing the week (max 10 words)",
  "wins": ["specific win 1", "specific win 2"],
  "patterns": ["pattern or observation 1", "pattern 2"],
  "avoided": ["thing they avoided or skipped consistently"],
  "nextWeekFocus": "One specific thing to focus on next week"
}

Return ONLY the JSON object.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || "{}";
      try {
        const parsed = JSON.parse(content);
        res.json({
          headline: parsed.headline || "Week in review",
          wins: Array.isArray(parsed.wins) ? parsed.wins : [],
          patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
          avoided: Array.isArray(parsed.avoided) ? parsed.avoided : [],
          nextWeekFocus: parsed.nextWeekFocus || "",
        });
      } catch {
        res.json({ headline: "Week in review", wins: [], patterns: [], avoided: [], nextWeekFocus: "" });
      }
    } catch (error) {
      console.error("Error generating weekly review:", error);
      res.status(500).json({ error: "Failed to generate weekly review" });
    }
  });
}
