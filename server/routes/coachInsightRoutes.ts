import type { Express, Request, Response } from "express";
import type OpenAI from "openai";
import { routeModelTurn } from "../agent/modelRouter";
import { isRetriableProviderError } from "../agent/providers/fallback";
import { extractReminderSuggestion } from "../services/reminderSuggestion";
import { getPersonaBlock } from "../services/aiCoachContextService";

export function registerCoachInsightRoutes(app: Express, openai: OpenAI): void {
  app.post("/api/coach/suggestions", async (req: Request, res: Response) => {
    let deterministicReminder: ReturnType<typeof extractReminderSuggestion> = null;
    try {
      const { lastAssistantMessage, lastUserMessage, goals } = req.body;
      if (!lastAssistantMessage) return res.json({ actions: [], followups: [] });
      deterministicReminder = extractReminderSuggestion(lastUserMessage);

      const prompt = `Analyze this coaching message and extract structured suggestions.

User's latest message:
"${typeof lastUserMessage === "string" ? lastUserMessage : ""}"

Coaching message:
"${lastAssistantMessage}"

User's active goals:
${(goals || []).map((g: any) => `- ${g.title} (${g.category})`).join('\n') || 'None set'}

Return a JSON object with:
1. "actions": array of 0-2 actionable suggestions. Four action types are supported:
   - { "type": "task", "title": string (verb phrase), "category": "fitness"/"finance"/"career"/"personal"/"social", "priority": "high"/"medium"/"low", "description": one-line context }
   - { "type": "goal", "title": string, "category": "fitness"/"finance"/"career"/"personal"/"social", "description": one-line context }
   - { "type": "reminder", "title": string, "category": "personal", "priority": "medium", "description": one-line context, "scheduledAt": string, "recurrence": optional string } - Use when the user asked for a reminder or future follow-up. scheduledAt may be natural language like "in an hour", "tomorrow at 9am", or "next Monday at 10am" if that is exactly what the user said.
   - { "type": "link", "title": string, "buttonLabel": string (short CTA <=4 words), "url": string (use "profile://connections" to open connection settings, or a full https:// URL), "category": "personal" } - Use ONLY when the message explicitly suggests connecting/reconnecting Google, Microsoft, Outlook, or Gmail.
   Only include actions that are specific and actionable. Return empty array for purely conversational messages.
2. "followups": array of exactly 3 short follow-up questions (max 7 words each) the user would naturally ask next.

Return ONLY the JSON object.`;

      const response = await routeModelTurn({
        tier: "cheap",
        messages: [{ role: "user", content: prompt }],
        maxCompletionTokens: 600,
        userId: req.userId ?? undefined,
        logPrefix: "[CoachSuggestions]",
      });

      const content = response.textContent || '{"actions":[],"followups":[]}';
      try {
        const parsed = JSON.parse(content);
        const parsedActions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 2) : [];
        const actions = deterministicReminder
          ? [deterministicReminder, ...parsedActions.filter((action: any) => action?.type !== "reminder").slice(0, 1)]
          : parsedActions;
        res.json({ actions, followups: Array.isArray(parsed.followups) ? parsed.followups.slice(0, 3) : [] });
      } catch {
        res.json({ actions: deterministicReminder ? [deterministicReminder] : [], followups: [] });
      }
    } catch (error) {
      if (isRetriableProviderError(error)) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[CoachSuggestions] optional suggestions skipped: provider backpressure (${msg.slice(0, 180)})`);
      } else {
        console.error("Error generating suggestions:", error);
      }
      res.json({ actions: deterministicReminder ? [deterministicReminder] : [], followups: [] });
    }
  });

  app.post("/api/coach/checkin", async (req: Request, res: Response) => {
    try {
      const { goals, stats, history, lifeContext, coachingMode } = req.body;
      const completedHistory = (history || []).filter((h: any) => h.completed);
      const skippedHistory = (history || []).filter((h: any) => !h.completed);
      const completionRate = history?.length > 0 ? Math.round((completedHistory.length / history.length) * 100) : 0;
      const goalsText = (goals || []).length > 0
        ? (goals as any[]).map((g: any) => `${g.title}: ${g.current}/${g.target} ${g.unit}`).join(', ')
        : 'no goals set';
      const lifeCtxText = lifeContext
        ? `\n- Priority: ${lifeContext.priorityGoal || 'not set'}` +
          (lifeContext.currentBlocker ? `\n- Known blocker: ${lifeContext.currentBlocker}` : '') +
          (lifeContext.improvementArea ? `\n- Wants to improve: ${lifeContext.improvementArea}` : '')
        : '';

      const prompt = `You are Jarvis. Write a 1-2 sentence daily note for this person.

${getPersonaBlock(coachingMode)}

Their profile:
- Streak: ${stats?.streak || 0} days, ${completionRate}% task completion this week
- Goals: ${goalsText}
- Recently completed: ${completedHistory.slice(0, 4).map((h: any) => h.title).join(', ') || 'nothing yet'}
- Recently skipped: ${skippedHistory.slice(0, 3).map((h: any) => h.title).join(', ') || 'nothing'}${lifeCtxText}

Write ONE short, specific coaching observation. Be direct - name what's working or what to fix. If they have a clear priority or blocker, reference it specifically. No greeting, no sign-off.

Return JSON: { "note": "your 1-2 sentence note here" }`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 200,
      });

      const content = response.choices[0]?.message?.content || '{"note":""}';
      try {
        const parsed = JSON.parse(content);
        res.json({ note: parsed.note || '' });
      } catch {
        res.json({ note: '' });
      }
    } catch (error) {
      console.error("Error generating check-in:", error);
      res.json({ note: '' });
    }
  });
}
